(function () {
  "use strict";

  const DEBUG = true;
  const OSRM_BASE_URL = "https://router.project-osrm.org";

  const DEFAULT_SETTINGS = {
    average_speed_kmh: 50,
stop_time_minutes: 15,
unloading_time_mode: "fixed",
unloading_extra_minutes_per_order: 5,
unloading_volume_threshold_m3: 1.5,
unloading_extra_minutes_per_m3: 5,
unloading_volume_rounding: "proportional",    distance_factor: 1.25,
    max_route_volume_m3: 65,
    max_route_stops: 12,
    max_orders_per_route: 12,
    max_route_duration_hours: 9,
    max_cost_per_order_gbp: 125,
    labour_cost_per_hour_gbp: 38.5,
vehicle_cost_per_hour_gbp: 0,
diesel_price_per_litre_gbp_inc_vat: 1.55,

warehouse_handling_in_per_colli_gbp: 0,
warehouse_handling_out_per_colli_gbp: 0,
warehouse_storage_per_m3_gbp: 0,
warehouse_repack_per_colli_gbp: 0,
    default_departure_time: "08:00",
    default_transport_type: "own_transport",
    min_fill_rate_default: 0.75,
    depot_name: "Home Depot",
    depot_lat: null,
    depot_lng: null
  };

  function log(...args) {
    if (DEBUG) console.log("[planning-engine.js]", ...args);
  }

  function db() {
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    return sb();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

function settingNumber(
  settings,
  primaryKey,
  alternativeKey,
  fallback
) {
  const primary = settings[primaryKey];

  if (
    primary !== null &&
    primary !== undefined &&
    primary !== ""
  ) {
    return toNumber(primary, fallback);
  }

  if (alternativeKey) {
    const alternative = settings[alternativeKey];

    if (
      alternative !== null &&
      alternative !== undefined &&
      alternative !== ""
    ) {
      return toNumber(alternative, fallback);
    }
  }

  return fallback;
}

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

function getEarliestPlanningDate(order) {
  return String(
    order?.earliest_planning_date ||
    ""
  ).slice(0, 10);
}

function validatePlanningDate(
  orders,
  routeDate
) {
  const selectedDate =
    String(
      routeDate || ""
    ).slice(0, 10);

  const blocked =
    (
      orders || []
    ).filter(order => {
      const earliestDate =
        getEarliestPlanningDate(order);

      return (
        earliestDate &&
        selectedDate < earliestDate
      );
    });

  if (!blocked.length) {
    return;
  }

  const first =
    blocked[0];

  throw new Error(
    `${first.order_number} can only be planned from ` +
    `${getEarliestPlanningDate(first)}.`
  );
}

  function timeToMinutes(value) {
    const m = String(value || "08:00").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return 480;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function minutesToHHMM(total) {
    const mins = Math.max(0, Math.round(total));
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function hhmmToIso(date, time) {
    return `${date || todayIso()}T${String(time || "08:00").slice(0, 5)}:00`;
  }

  function kmToMiles(km) {
    return km * 0.621371;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const r = 6371;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

    return r * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  function estimateRoadKm(km, settings) {
    return km * toNumber(settings.distance_factor, DEFAULT_SETTINGS.distance_factor);
  }

  function buildRouteCode(dateIso, index) {
    return `RT-${String(dateIso || todayIso()).replaceAll("-", "")}-${String(index).padStart(3, "0")}`;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  async function getCompanyId(client) {
  const possibleIds = [
    window.VeynorPlannerData?.companyId,
    window.VeynorOrdersPlanner?.getCompanyId?.()
  ];

  const companyId = possibleIds.find(
    value =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)
  );

  if (!companyId) {
    throw new Error(
      "Active tenant could not be resolved. " +
      "Please wait until the planner has loaded."
    );
  }

  const { data, error } = await client
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;

  if (!data?.id) {
    throw new Error(
      "Active tenant was not found or is not accessible."
    );
  }

  return data.id;
}

async function loadSettings(client, companyId) {
  const { data, error } = await client
    .from("settings")
    .select("setting_key, setting_value")
    .eq("company_id", companyId);

  if (error) throw error;

  const databaseSettings = {};

  for (const row of data || []) {
    if (!row.setting_key) continue;
    databaseSettings[row.setting_key] = row.setting_value;
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...databaseSettings
  };

  const numericSettings = [
    ["average_speed_kmh", "planner_average_speed_kmh"],
["stop_time_minutes", "planner_stop_time_minutes"],
["unloading_extra_minutes_per_order", null],
["unloading_volume_threshold_m3", null],
["unloading_extra_minutes_per_m3", null],
    ["distance_factor", "planner_distance_factor"],
    ["max_route_volume_m3", null],
    ["max_route_stops", null],
    ["max_orders_per_route", null],
    ["max_route_duration_hours", null],
    ["max_cost_per_order_gbp", null],
    ["labour_cost_per_hour_gbp", null],
    ["vehicle_cost_per_hour_gbp", null],
    ["diesel_price_per_litre_gbp_inc_vat", null],
    ["warehouse_handling_in_per_colli_gbp", null],
    ["warehouse_handling_out_per_colli_gbp", null],
    ["warehouse_storage_per_m3_gbp", null],
    ["warehouse_repack_per_colli_gbp", null],
    ["min_fill_rate_default", null]
  ];

  for (const [key, alternativeKey] of numericSettings) {
    settings[key] = settingNumber(
      databaseSettings,
      key,
      alternativeKey,
      DEFAULT_SETTINGS[key]
    );
  }

  settings.default_departure_time =
    databaseSettings.default_departure_time ||
    databaseSettings.planner_default_departure_time ||
    DEFAULT_SETTINGS.default_departure_time;

  settings.default_transport_type =
    databaseSettings.default_transport_type ||
    DEFAULT_SETTINGS.default_transport_type;

  settings.depot_name =
    databaseSettings.home_depot_name ||
    databaseSettings.depot_name ||
    DEFAULT_SETTINGS.depot_name;

  settings.depot_lat = toNumber(
    databaseSettings.home_depot_lat ??
    databaseSettings.depot_lat,
    null
  );

  settings.depot_lng = toNumber(
    databaseSettings.home_depot_lng ??
    databaseSettings.depot_lng,
    null
  );

  settings.unloading_time_mode =
    databaseSettings.unloading_time_mode ||
    DEFAULT_SETTINGS.unloading_time_mode;

  settings.unloading_volume_rounding =
    databaseSettings.unloading_volume_rounding ||
    DEFAULT_SETTINGS.unloading_volume_rounding;

  return settings;
}

  async function loadDrivers(client, companyId) {
    const { data, error } = await client
      .from("user_profiles")
      .select("id, auth_user_id, company_id, full_name, email, role, is_active, is_driver, use_in_planning")
      .eq("company_id", companyId)
      .eq("is_active", true);

    if (error) return [];

    return (data || [])
      .filter(row => {
        const role = normalize(row.role);
        return row.is_driver === true || role === "driver" || role === "chauffeur";
      })
      .filter(row => row.use_in_planning !== false)
      .map(row => ({
        id: row.auth_user_id || row.id,
        profile_id: row.id,
        auth_user_id: row.auth_user_id || row.id,
        full_name: row.full_name || row.email || "Driver",
        email: row.email || ""
      }));
  }

  function getVehicleCapacity(vehicle) {
    return Math.max(
      toNumber(vehicle?.capacity_m3, 0),
      toNumber(vehicle?.max_volume_m3, 0),
      toNumber(vehicle?.volume_capacity_m3, 0)
    );
  }

  function getVehicleSpeed(vehicle, settings) {
    return Math.max(1, toNumber(vehicle?.average_speed_kmh, settings.average_speed_kmh));
  }

  function getVehicleMinFill(vehicle, settings) {
    const direct = vehicle?.minimum_fill_rate ?? vehicle?.min_fill_rate;
    const n = toNumber(direct, settings.min_fill_rate_default);
    return n > 1 ? n / 100 : n;
  }

  function getVehicleDriverId(vehicle) {
    return vehicle?.driver_user_id || vehicle?.default_driver_user_id || vehicle?.default_driver_profile_id || "";
  }

async function loadVehicles(client, companyId, settings) {
  const { data, error } = await client
    .from("vehicles")
    .select("*")
    .eq("company_id", companyId);

  if (error) {
    throw error;
  }

  function read(value, fallback, label) {
    const selected =
      value == null || String(value).trim() === ""
        ? fallback
        : value;

    const number = Number(
      String(selected).replace(",", ".")
    );

    if (!Number.isFinite(number) || number < 0) {
      throw new Error(
        `Invalid vehicle setting: ${label}.`
      );
    }

    return number;
  }

  return (data || [])
    .filter(vehicle =>
      vehicle.active !== false &&
      vehicle.is_active !== false &&
      vehicle.use_in_planning !== false
    )
    .map(vehicle => ({
      ...vehicle,

      capacity_m3: getVehicleCapacity(vehicle),

      max_stops: read(
        vehicle.max_stops,
        settings.max_route_stops,
        "max_stops"
      ),

      max_route_hours: read(
        vehicle.max_route_hours,
        settings.max_route_duration_hours,
        "max_route_hours"
      ),

      vehicle_cost_per_hour_gbp: read(
        vehicle.vehicle_cost_per_hour_gbp ??
          vehicle.cost_per_hour_gbp,
        settings.vehicle_cost_per_hour_gbp,
        "vehicle_cost_per_hour_gbp"
      ),

      labour_cost_per_hour_gbp: read(
        vehicle.labour_cost_per_hour_gbp,
        settings.labour_cost_per_hour_gbp,
        "labour_cost_per_hour_gbp"
      ),

      average_speed_kmh: read(
        vehicle.average_speed_kmh,
        settings.average_speed_kmh,
        "average_speed_kmh"
      ),

      fuel_litres_per_100km: read(
        vehicle.fuel_litres_per_100km,
        10,
        "fuel_litres_per_100km"
      )
    }))
    .sort((a, b) =>
      getVehicleCapacity(a) - getVehicleCapacity(b)
    );
}

  function getLat(row) {
    const n = Number(row?.delivery_lat ?? row?.latitude);
    return Number.isFinite(n) ? n : null;
  }

  function getLng(row) {
    const n = Number(row?.delivery_lng ?? row?.longitude);
    return Number.isFinite(n) ? n : null;
  }

  function hasCoords(row) {
    return getLat(row) !== null && getLng(row) !== null;
  }

function getOrderVolume(order) {
  return toNumber(
    order?.total_order_volume_m3 ??
    order?.volume_m3 ??
    order?.planning_volume_m3,
    0
  );
}

  function getOrderColli(order) {
    return toNumber(order?.planning_colli, 0);
  }

  async function loadOrders(client, companyId, args = {}) {
    let query = client
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name
        )
      `)
      .eq("company_id", companyId)
.eq("planning_release", true)
.is("route_id", null)
.or(
  "status.in.(ready_for_planning,ready_for_picking)," +
  "and(manual_completion_override.eq.true," +
  "status.in.(imported,stock_complete,awaiting_goods,order_received))"
)
      .order("requested_delivery_date", { ascending: true, nullsFirst: false })
      .order("order_number", { ascending: true });

    const ids = Array.isArray(args.order_ids) ? args.order_ids.filter(Boolean) : [];
    if (ids.length) query = query.in("id", ids);

    const { data, error } = await query;
    if (error) throw error;

    return (data || [])
      .map(row => ({
        ...row,
        customer_name: row.customers?.name || row.customer_name || "—",
        product_owner_name: row.customers?.name || row.customer_name || "—"
      }))
      .filter(hasCoords);
  }


function calculateUnloadingMinutes({
  orderCount = 1,
  volumeM3 = 0,
  settings = {},
  mode = null,
  manualMinutes = null
} = {}) {
  if (manualMinutes !== null && manualMinutes !== undefined && manualMinutes !== "") {
    const manual = Number(manualMinutes);

    if (!Number.isFinite(manual) || manual < 0) {
      throw new Error("Invalid manual unloading time.");
    }

    return Math.ceil(manual);
  }

  const method = mode || settings.unloading_time_mode || "fixed";

  if (!["fixed", "orders", "volume", "combined"].includes(method)) {
    throw new Error("Invalid unloading calculation method.");
  }

  const read = (value, fallback) => {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }

    const parsed = Number(String(value).replace(",", "."));

    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("Invalid unloading setting.");
    }

    return parsed;
  };

  const base = read(settings.stop_time_minutes, 15);
  const extraPerOrder = read(
    settings.unloading_extra_minutes_per_order, 5
  );
  const threshold = read(
    settings.unloading_volume_threshold_m3, 1.5
  );
  const extraPerM3 = read(
    settings.unloading_extra_minutes_per_m3, 5
  );

  const count = read(orderCount, 1);
  const volume = read(volumeM3, 0);

  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Order count must be a positive integer.");
  }

  const additionalOrders = Math.max(0, count - 1);
  const additionalVolume = Math.max(0, volume - threshold);

  const volumeUnits =
    settings.unloading_volume_rounding === "round_up"
      ? Math.ceil(additionalVolume)
      : additionalVolume;

  let minutes = base;

  if (method === "orders" || method === "combined") {
    minutes += additionalOrders * extraPerOrder;
  }

  if (method === "volume" || method === "combined") {
    minutes += volumeUnits * extraPerM3;
  }

  return Math.ceil(minutes);
}


function groupOrdersByDeliveryLocation(
  orders = [],
  settings = {},
  options = {}
) {
  const groups = new Map();

  const normalizePart = value =>
    String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");

  for (const order of orders) {
    if (!order?.id) {
      throw new Error("Order without ID encountered.");
    }

    const addressId = String(order.delivery_address_id || "").trim();

    const postcode = normalizePart(order.delivery_postcode)
      .replace(/\s+/g, "");

    const address = [
      normalizePart(order.delivery_address_1),
      normalizePart(order.delivery_address_2),
      normalizePart(order.delivery_address_3),
      normalizePart(order.delivery_address_4)
    ].filter(Boolean).join("|");

    const country = normalizePart(order.delivery_country);

    // Use the saved delivery address ID where available.
    // Otherwise require a complete address and postcode.
    // Never group unrelated orders solely by postcode.
    const key = addressId
      ? `ADDRESS_ID:${addressId}`
      : address && postcode
        ? `ADDRESS:${country}|${postcode}|${address}`
        : `ORDER:${order.id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        delivery_address_id: addressId || null,
        name:
          order.retail_name ||
          order.retailer_name ||
          order.delivery_city ||
          order.order_number ||
          "Delivery location",
        postcode: order.delivery_postcode || "",
        city: order.delivery_city || "",
        latitude: order.delivery_lat,
        longitude: order.delivery_lng,
        orders: [],
        order_ids: [],
        order_count: 0,
        volume_m3: 0,
        colli: 0
      });
    }

    const group = groups.get(key);

    group.orders.push(order);
    group.order_ids.push(String(order.id));
    group.order_count++;

group.volume_m3 += getOrderVolume(order);

    group.colli += Number(
      order.planning_colli ??
      order.total_order_colli ??
      0
    );
  }

  return [...groups.values()].map(group => {
    if (
      !Number.isFinite(group.volume_m3) ||
      !Number.isFinite(group.colli)
    ) {
      throw new Error(
        `Invalid volume or colli at ${group.postcode}.`
      );
    }

    const manualMinutes =
      options.manualMinutesByLocation?.[group.key] ?? null;

    const mode =
      options.modeByLocation?.[group.key] ||
      options.mode ||
      null;

    return {
      ...group,
      unloading_mode: mode || settings.unloading_time_mode || "fixed",
      service_minutes: calculateUnloadingMinutes({
        orderCount: group.order_count,
        volumeM3: group.volume_m3,
        settings,
        mode,
        manualMinutes
      })
    };
  });
}


function prepareLocationStops(
  orders,
  settings,
  requestedOrderIds = null,
  options = {}
) {
  const groups = groupOrdersByDeliveryLocation(
    orders,
    settings,
    options
  );

  const orderPosition = new Map(
    (requestedOrderIds || orders.map(o => o.id))
      .map((id, index) => [String(id), index])
  );

  // Keep orders belonging to one delivery location together.
  groups.sort((a, b) => {
    const firstA = Math.min(
      ...a.order_ids.map(id => orderPosition.get(String(id)) ?? Infinity)
    );
    const firstB = Math.min(
      ...b.order_ids.map(id => orderPosition.get(String(id)) ?? Infinity)
    );
    return firstA - firstB;
  });

  const stops = [];

  for (const group of groups) {
    const groupOrders = [...group.orders].sort(
      (a, b) =>
        (orderPosition.get(String(a.id)) ?? Infinity) -
        (orderPosition.get(String(b.id)) ?? Infinity)
    );

    groupOrders.forEach((order, index) => {
      stops.push({
        ...makeStop(order, settings),

        location_key: group.key,
        location_order_count: group.order_count,
        location_volume_m3: group.volume_m3,

        // Only the first order carries the location's
        // total unloading time. The others carry zero.
        service_minutes:
          index === 0 ? group.service_minutes : 0
      });
    });
  }

  return {
    stops,
    locations: groups,
    totalServiceMinutes: groups.reduce(
      (sum, group) => sum + group.service_minutes,
      0
    )
  };
}


  function makeStop(order, settings) {
    return {
      order_id: order.id,
      order_number: order.order_number || "",
      stop_name: order.retailer_name || order.delivery_name || order.customer_name || order.order_number || "Stop",

      address_1: order.delivery_address_1 || "",
      address_2: order.delivery_address_2 || "",
      address_3: order.delivery_address_3 || "",
      address_4: order.delivery_address_4 || "",

      city: order.delivery_city || "",
      postcode: order.delivery_postcode || "",
      country: order.delivery_country || "United Kingdom",

      latitude: getLat(order),
      longitude: getLng(order),
      service_minutes: toNumber(order.service_minutes, settings.stop_time_minutes),
      planning_volume_m3: getOrderVolume(order),
      planning_colli: getOrderColli(order)
    };
  }

  function depotPoint(settings) {
    if (settings.depot_lat === null || settings.depot_lng === null) {
      throw new Error("Depot latitude/longitude missing in Settings.");
    }

    return {
      name: settings.depot_name,
      latitude: Number(settings.depot_lat),
      longitude: Number(settings.depot_lng)
    };
  }

  function nearestNeighbour(stops, settings, depot) {
    const remaining = [...stops];
    const ordered = [];
    let current = depot;

    while (remaining.length) {
      let bestIndex = 0;
      let bestKm = Infinity;

      remaining.forEach((stop, index) => {
        const km = estimateRoadKm(
          haversineKm(current.latitude, current.longitude, stop.latitude, stop.longitude),
          settings
        );

        if (km < bestKm) {
          bestKm = km;
          bestIndex = index;
        }
      });

      const next = remaining.splice(bestIndex, 1)[0];
      ordered.push(next);
      current = next;
    }

    return ordered;
  }

  function routeDistanceKmFallback(stops, settings, depot) {
    if (!stops.length) return 0;

    let total = 0;
    let current = depot;

    stops.forEach(stop => {
      total += estimateRoadKm(
        haversineKm(current.latitude, current.longitude, stop.latitude, stop.longitude),
        settings
      );
      current = stop;
    });

    total += estimateRoadKm(
      haversineKm(current.latitude, current.longitude, depot.latitude, depot.longitude),
      settings
    );

    return total;
  }

async function fetchOsrmRoute(stops, depot) {
  if (!Array.isArray(stops) || !stops.length) {
    return null;
  }

  const points = [
    depot,
    ...stops,
    depot
  ];

  const coordinates = points.map(point => {
    const rawLat = point?.latitude;
    const rawLng = point?.longitude;

    const lat = Number(rawLat);
    const lng = Number(rawLng);

    if (
      rawLat == null ||
      rawLng == null ||
      String(rawLat).trim() === "" ||
      String(rawLng).trim() === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new Error(
        "Invalid coordinates for road routing."
      );
    }

    return `${lng},${lat}`;
  }).join(";");

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 12000);

  try {
    const url =
      `${OSRM_BASE_URL}/route/v1/driving/` +
      coordinates +
      "?overview=full&geometries=geojson&steps=false";

    const response = await fetch(url, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `OSRM request failed: ${response.status}`
      );
    }

    const result = await response.json();

    const route = result.routes?.[0];

    if (
      result.code !== "Ok" ||
      !route ||
      !Number.isFinite(route.distance) ||
      route.distance < 0 ||
      !Number.isFinite(route.duration) ||
      route.duration < 0 ||
      !Array.isArray(route.legs) ||
      route.legs.length !== points.length - 1 ||
      route.legs.some(leg =>
        !Number.isFinite(leg.duration) ||
        leg.duration < 0
      )
    ) {
      throw new Error(
        "OSRM returned incomplete route or timing data."
      );
    }


    // Validate full OSRM road geometry.
    const geometry = route.geometry;

    if (
      geometry?.type !== "LineString" ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length < 2 ||
      geometry.coordinates.some(point =>
        !Array.isArray(point) ||
        point.length < 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        point[0] < -180 ||
        point[0] > 180 ||
        point[1] < -90 ||
        point[1] > 90
      )
    ) {
      throw new Error(
        "OSRM returned invalid route geometry."
      );
    }



    const legSeconds = route.legs.reduce(
      (sum, leg) => sum + leg.duration,
      0
    );

    const tolerance = Math.max(
      1,
      route.duration * 0.000001
    );

    if (
      Math.abs(legSeconds - route.duration) > tolerance
    ) {
      throw new Error(
        "OSRM route duration does not match its leg durations."
      );
    }


    return {
      distanceKm: route.distance / 1000,

      distanceMiles: kmToMiles(
        route.distance / 1000
      ),

      driveHours: route.duration / 3600,

      // Full road geometry for emission zone detection.
      // GeoJSON coordinates: [longitude, latitude].
      geometry: {
        type: "LineString",
        coordinates: geometry.coordinates
      },

      legs: route.legs
    };


  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "OSRM request timed out after 12 seconds."
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}
 
async function summarizeRoute(
  orders,
  settings,
  depot,
  vehicle = null,
  options = {}
) {
  if (!Array.isArray(orders) || !orders.length) {
    throw new Error("No orders available for route summary.");
  }

  const prepared = prepareLocationStops(
    orders,
    settings,
    options.stop_order_ids || null,
    options
  );

  let locations = prepared.locations;

  // Only optimize when the planner has not supplied
  // a specific manual stop order.
  if (!options.preserveOrder) {
    locations = nearestNeighbour(
      locations,
      settings,
      depot
    );
  }

  const locationPosition = new Map(
    locations.map((location, index) => [
      location.key,
      index
    ])
  );

  const originalPosition = new Map(
    (options.stop_order_ids || orders.map(o => o.id))
      .map((id, index) => [String(id), index])
  );

  const stops = [...prepared.stops].sort((a, b) => {
    const locationDifference =
      locationPosition.get(a.location_key) -
      locationPosition.get(b.location_key);

    if (locationDifference !== 0) {
      return locationDifference;
    }

    return (
      (originalPosition.get(String(a.order_id)) ?? Infinity) -
      (originalPosition.get(String(b.order_id)) ?? Infinity)
    );
  });

  let distanceKm = routeDistanceKmFallback(
    locations,
    settings,
    depot
  );

  let distanceMiles = kmToMiles(distanceKm);

  let driveHours =
    distanceKm /
    Math.max(
      1,
      vehicle
        ? getVehicleSpeed(vehicle, settings)
        : settings.average_speed_kmh
    );

  let osrm = null;
  let routingSource = "estimated";

  try {
    osrm = await fetchOsrmRoute(locations, depot);

    if (osrm) {
      distanceKm = osrm.distanceKm;
      distanceMiles = osrm.distanceMiles;
      driveHours = osrm.driveHours;
      routingSource = "osrm";
    }
  } catch (error) {
    console.warn(
      "[PlanningEngine] Route summary fallback:",
      error
    );
  }

  const serviceHours =
    prepared.totalServiceMinutes / 60;

  const totalHours = driveHours + serviceHours;

  const totalVolume = orders.reduce(
    (sum, order) => sum + getOrderVolume(order),
    0
  );

  const totalColli = orders.reduce(
    (sum, order) => sum + getOrderColli(order),
    0
  );

  const totalOrders = orders.length;
  const totalStops = locations.length;

  const labourRate = toNumber(
    vehicle?.labour_cost_per_hour_gbp,
    settings.labour_cost_per_hour_gbp
  );

  const vehicleRate = toNumber(
    vehicle?.vehicle_cost_per_hour_gbp,
    settings.vehicle_cost_per_hour_gbp
  );

  const fuelUsage = toNumber(
    vehicle?.fuel_litres_per_100km,
    10
  );

  const dieselExVat =
    toNumber(
      settings.diesel_price_per_litre_gbp_inc_vat,
      1.55
    ) / 1.20;

  const fuelLitres =
    (distanceKm / 100) * fuelUsage;

  const fuelCost = fuelLitres * dieselExVat;
  const labourCost = totalHours * labourRate;
  const vehicleCost = totalHours * vehicleRate;

  const warehouseHandlingInCost =
    totalColli *
    toNumber(settings.warehouse_handling_in_per_colli_gbp);

  const warehouseHandlingOutCost =
    totalColli *
    toNumber(settings.warehouse_handling_out_per_colli_gbp);

  const warehouseStorageCost =
    totalVolume *
    toNumber(settings.warehouse_storage_per_m3_gbp);

  const warehouseVasCost =
    totalColli *
    toNumber(settings.warehouse_repack_per_colli_gbp);

  const warehouseCost =
    warehouseHandlingInCost +
    warehouseHandlingOutCost +
    warehouseStorageCost +
    warehouseVasCost;

  const totalCost =
    fuelCost +
    labourCost +
    vehicleCost +
    warehouseCost;

  const capacity = vehicle
    ? getVehicleCapacity(vehicle)
    : 0;

  const fillRate = capacity > 0
    ? totalVolume / capacity
    : 0;

  return {
    stops,
    locations,
    osrm,
    routingSource,

    totalVolume,
    totalColli,
    totalOrders,
    totalStops,

    distanceKm,
    distanceMiles,
    driveHours,
    serviceHours,
    totalHours,

    fuelCost,
    fuelLitres,
    labourCost,
    vehicleCost,

    warehouseHandlingInCost,
    warehouseHandlingOutCost,
    warehouseStorageCost,
    warehouseVasCost,
    warehouseCost,

    totalCost,

    costPerOrder: totalOrders
      ? totalCost / totalOrders
      : 0,

    costPerStop: totalStops
      ? totalCost / totalStops
      : 0,

    fillRate
  };
}


/* ==========================================================
   VEYNOR — EMISSION ZONE ASSESSMENT
   ========================================================== */

function emissionSettingEnabled(value, fallback = true) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return ["true", "1", "yes", "on", "enabled"]
    .includes(String(value).trim().toLowerCase());
}


function getEmissionZonePreferences(settings) {
  const raw = settings.emission_zone_preferences;

  if (!raw) return {};

  try {
    const parsed =
      typeof raw === "string"
        ? JSON.parse(raw)
        : raw;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    return parsed;

  } catch (error) {
    console.warn(
      "[PlanningEngine] Invalid emission zone preferences:",
      error
    );

    return {};
  }
}


async function assessEmissionZones(
  client,
  settings,
  locations,
  osrm
) {
  const deliveryEnabled = emissionSettingEnabled(
    settings.emission_alert_delivery
  );

  const routeEnabled = emissionSettingEnabled(
    settings.emission_alert_route
  );

const zonePreferences =
  getEmissionZonePreferences(settings);

const zoneEnabled = zoneCode =>
  zonePreferences[String(zoneCode || "").toUpperCase()] !== false;

  const result = {
    delivery_zones: [],
    route_zones: [],
    warnings: [],
    checked: false,
    errors: []
  };

  if (!deliveryEnabled && !routeEnabled) {
    result.checked = true;
    return result;
  }

  const requests = [];

  if (deliveryEnabled && locations.length) {
    const payload = locations.map((location, index) => ({
      location_key: String(
        location.key || location.location_key || index
      ),
      latitude: Number(location.latitude),
      longitude: Number(location.longitude)
    }));

    requests.push(
      client.rpc("check_emission_zone_deliveries", {
        p_locations: payload
      }).then(({ data, error }) => {
        if (error) throw error;
        result.delivery_zones = (data || []).filter(
  zone => zoneEnabled(zone.zone_code)
);
      }).catch(error => {
        result.errors.push(
          "Delivery zone check failed: " + error.message
        );
      })
    );
  }

  if (routeEnabled && osrm?.geometry) {
    requests.push(
      client.rpc("check_emission_zone_route", {
        p_geometry: osrm.geometry
      }).then(({ data, error }) => {
        if (error) throw error;
        result.route_zones = (data || []).filter(
  zone => zoneEnabled(zone.zone_code)
);
      }).catch(error => {
        result.errors.push(
          "Route zone check failed: " + error.message
        );
      })
    );
  } else if (routeEnabled) {
    result.errors.push(
      "Route emission zone check unavailable: no OSRM geometry."
    );
  }

  await Promise.all(requests);

  for (const zone of result.delivery_zones) {
    result.warnings.push(
      `Delivery ${zone.location_key} is inside ${zone.zone_name}.`
    );
  }

  for (const zone of result.route_zones) {
    const miles =
      Number(zone.distance_inside_meters || 0) / 1609.344;

    result.warnings.push(
      `Route crosses ${zone.zone_name} (${miles.toFixed(2)} miles).`
    );
  }

  result.checked = result.errors.length === 0;

  return result;
}


async function quickSummaryForLimits(
  orders,
  settings,
  depot
) {
  if (!Array.isArray(orders) || !orders.length) {
    return {
      totalVolume: 0,
      totalOrders: 0,
      totalStops: 0,
      totalHours: 0
    };
  }

  const prepared = prepareLocationStops(
    orders,
    settings
  );

  const locations = nearestNeighbour(
    prepared.locations,
    settings,
    depot
  );

  const distanceKm = routeDistanceKmFallback(
    locations,
    settings,
    depot
  );

  const driveHours =
    distanceKm /
    Math.max(1, settings.average_speed_kmh);

  const serviceHours =
    prepared.totalServiceMinutes / 60;

  return {
    totalVolume: orders.reduce(
      (sum, order) => sum + getOrderVolume(order),
      0
    ),

    totalOrders: orders.length,
    totalStops: locations.length,

    distanceKm,
    driveHours,
    serviceHours,

    totalHours: driveHours + serviceHours
  };
}

  function withinSettingsLimits(summary, settings) {
    if (summary.totalVolume > settings.max_route_volume_m3) return false;
    if (summary.totalStops > settings.max_route_stops) return false;
    if (summary.totalOrders > settings.max_orders_per_route) return false;
    if (summary.totalHours > settings.max_route_duration_hours) return false;
    return true;
  }

  function vehicleCanTake(vehicle, summary, settings) {
    if (!vehicle) return false;
    if (summary.totalVolume > getVehicleCapacity(vehicle)) return false;
    if (summary.totalStops > toNumber(vehicle.max_stops, settings.max_route_stops)) return false;
    if (summary.totalHours > toNumber(vehicle.max_route_hours, settings.max_route_duration_hours)) return false;
    return true;
  }

function vehicleScore(vehicle, summary, settings) {
  if (!vehicleCanTake(vehicle, summary, settings)) {
    return Infinity;
  }

  const capacity = getVehicleCapacity(vehicle);

  const minFill = getVehicleMinFill(
    vehicle,
    settings
  );

  const fillRate = capacity > 0
    ? summary.totalVolume / capacity
    : 0;

  const cost = toNumber(
    summary.totalCost,
    Infinity
  );

  if (!Number.isFinite(cost)) {
    return Infinity;
  }

  let penalty = 0;

  if (
    summary.totalVolume > 0 &&
    fillRate < minFill
  ) {
    penalty += 5000;
  }

  const unusedCapacityPenalty =
    Math.max(0, 1 - fillRate) * 100;

  return cost + penalty + unusedCapacityPenalty;
}

async function chooseVehicle(
  vehicles,
  orders,
  settings,
  depot,
  preferredVehicleId = null
) {
  if (!Array.isArray(vehicles) || !vehicles.length) {
    return null;
  }

  if (!Array.isArray(orders) || !orders.length) {
    return null;
  }

  if (preferredVehicleId) {
    const preferred = vehicles.find(
      vehicle =>
        String(vehicle.id) ===
        String(preferredVehicleId)
    );

    if (!preferred) {
      throw new Error(
        "Selected vehicle was not found."
      );
    }

    const summary = await summarizeRoute(
      orders,
      settings,
      depot,
      preferred
    );

    if (!vehicleCanTake(preferred, summary, settings)) {
      throw new Error(
        "Selected vehicle cannot take this route. " +
        `Volume: ${summary.totalVolume.toFixed(2)} m³ / ` +
        `${getVehicleCapacity(preferred).toFixed(2)} m³. ` +
        `Stops: ${summary.totalStops}. ` +
        `Hours: ${summary.totalHours.toFixed(2)}.`
      );
    }

    return preferred;
  }

  const candidates = await Promise.all(
    vehicles.map(async vehicle => {
      try {
        const summary = await summarizeRoute(
          orders,
          settings,
          depot,
          vehicle
        );

        if (!vehicleCanTake(vehicle, summary, settings)) {
          return null;
        }

        return {
          vehicle,
          summary,
          score: vehicleScore(
            vehicle,
            summary,
            settings
          )
        };
      } catch (error) {
        console.warn(
          "[PlanningEngine] Vehicle evaluation failed:",
          vehicle.id,
          error
        );

        return null;
      }
    })
  );

  const valid = candidates.filter(Boolean);

  if (!valid.length) {
    return null;
  }

  valid.sort((a, b) => a.score - b.score);

  return valid[0].vehicle;
}

  async function buildClusters(orders, settings, routeDate, depot, manualOnly = false) {
    if (manualOnly) {
      return [{
        routeCode: buildRouteCode(routeDate, 1),
        routeDate,
        plannedDeliveryDate: routeDate,
        orders: [...orders]
      }];
    }

    const remaining = [...orders].sort((a, b) => getOrderVolume(b) - getOrderVolume(a));
    const clusters = [];

    while (remaining.length) {
      let cluster = [];

      for (let i = 0; i < remaining.length;) {
        const test = [...cluster, remaining[i]];
        const summary = await quickSummaryForLimits(test, settings, depot);

        if (!cluster.length || withinSettingsLimits(summary, settings)) {
          cluster = test;
          remaining.splice(i, 1);
        } else {
          i++;
        }
      }

      if (cluster.length) clusters.push(cluster);
      else break;
    }

    return clusters.map((ordersInCluster, index) => ({
      routeCode: buildRouteCode(routeDate, index + 1),
      routeDate,
      plannedDeliveryDate: routeDate,
      orders: ordersInCluster
    }));
  }

  function resolveDriver(vehicle, drivers, args = {}) {
    const wantedId = args.driver_user_id || args.driver_profile_id || getVehicleDriverId(vehicle);
    const driver = drivers.find(d =>
      String(d.id) === String(wantedId) ||
      String(d.auth_user_id) === String(wantedId) ||
      String(d.profile_id) === String(wantedId)
    );

    return {
      driver_user_id: wantedId || null,
      driver_profile_id: wantedId || null,
      driver_name: driver?.full_name || vehicle?.driver_name || vehicle?.default_driver_name || null,
      driver_email: driver?.email || vehicle?.driver_email || vehicle?.default_driver_email || null
    };
  }


async function buildTiming(
  stops,
  settings,
  vehicle,
  depot,
  routeDate,
  startTime,
  sharedRouting = undefined
) {
  const startMinutes = timeToMinutes(
    startTime || settings.default_departure_time
  );

  let currentMinutes = startMinutes;

  if (!Array.isArray(stops) || !stops.length) {
    return {
      stops: [],
      return_minutes: 0,
      route_end_time: minutesToHHMM(currentMinutes),
      total_hours: 0,
      routing_source: "estimated"
    };
  }

  const locations = [];

  stops.forEach((stop, index) => {
    const key =
      stop.location_key ||
      `INDIVIDUAL:${stop.order_id || index}`;

    const previous =
      locations[locations.length - 1];

    const serviceMinutes = toNumber(
      stop.service_minutes,
      settings.stop_time_minutes
    );

    if (
      !Number.isFinite(serviceMinutes) ||
      serviceMinutes < 0
    ) {
      throw new Error(
        "Invalid service time in route timing."
      );
    }

    if (previous && previous.key === key) {
      previous.members.push({
        stop,
        index
      });

      previous.serviceMinutes += serviceMinutes;

    } else {
      locations.push({
        key,

        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),

        members: [{
          stop,
          index
        }],

        serviceMinutes
      });
    }
  });

  let osrm = null;
  let routingSource = "estimated";

  if (sharedRouting !== undefined) {
    // Workspace: dezelfde resultaten als de samenvatting.
    // Bij een geschatte samenvatting blijft de timing geschat.
    if (sharedRouting.routingSource === "osrm") {
      osrm = sharedRouting.osrm;
      routingSource = "osrm";
    }

  } else {
    // Bestaande aanroepen zonder gedeelde samenvatting.
    try {
      osrm = await fetchOsrmRoute(
        locations,
        depot
      );

      if (osrm) {
        routingSource = "osrm";
      }

    } catch (error) {
      console.warn(
        "[PlanningEngine] Timing fallback:",
        error
      );
    }
  }

  const legs = osrm?.legs || [];

  if (
    routingSource === "osrm" &&
    (
      legs.length !== locations.length + 1 ||
      legs.some(leg =>
        !Number.isFinite(leg.duration) ||
        leg.duration < 0
      )
    )
  ) {
    throw new Error(
      "Shared road timing data is incomplete."
    );
  }

  function estimatedMinutes(from, to) {
    const km = estimateRoadKm(
      haversineKm(
        from.latitude,
        from.longitude,
        to.latitude,
        to.longitude
      ),
      settings
    );

    return (
      km /
      getVehicleSpeed(vehicle || {}, settings) *
      60
    );
  }

  function isoAt(totalMinutes) {
    const rounded = Math.max(
      0,
      Math.round(totalMinutes)
    );

    const dayOffset = Math.floor(
      rounded / 1440
    );

    const date = new Date(
      `${String(routeDate || todayIso()).slice(0, 10)}T00:00:00Z`
    );

    if (!Number.isFinite(date.getTime())) {
      throw new Error(
        "Invalid route date."
      );
    }

    date.setUTCDate(
      date.getUTCDate() + dayOffset
    );

    return (
      `${date.toISOString().slice(0, 10)}T` +
      `${minutesToHHMM(rounded)}:00`
    );
  }

  const rows = new Array(stops.length);

  let previousPoint = depot;

  locations.forEach((location, locationIndex) => {
    const driveMinutes =
      routingSource === "osrm"
        ? legs[locationIndex].duration / 60
        : estimatedMinutes(previousPoint, location);

    // Bewaar de nauwkeurigheid tijdens het optellen.
    // Alleen de weergegeven tijden worden afgerond.
    currentMinutes += driveMinutes;

    const arrivalMinutes = currentMinutes;

    currentMinutes += location.serviceMinutes;

    const departureMinutes = currentMinutes;

    location.members.forEach(
      ({ stop, index }, memberIndex) => {
        rows[index] = {
          order_id: stop.order_id,

          stop_sequence: index + 1,
          stop_number: index + 1,

          arrival_eta: minutesToHHMM(
            arrivalMinutes
          ),

          departure_eta: minutesToHHMM(
            departureMinutes
          ),

          planned_arrival_time: minutesToHHMM(
            arrivalMinutes
          ),

          planned_departure_time: minutesToHHMM(
            departureMinutes
          ),

          eta: isoAt(arrivalMinutes),
          etd: isoAt(departureMinutes),

          planned_time: minutesToHHMM(
            arrivalMinutes
          ),

          estimated_drive_minutes:
            memberIndex === 0
              ? Math.round(driveMinutes)
              : 0,

          service_minutes: toNumber(
            stop.service_minutes,
            0
          )
        };
      }
    );

    previousPoint = location;
  });

  const returnMinutes =
    routingSource === "osrm"
      ? legs[locations.length].duration / 60
      : estimatedMinutes(previousPoint, depot);

  const endMinutes =
    currentMinutes + returnMinutes;

  return {
    stops: rows,

    return_minutes: Math.round(
      returnMinutes
    ),

    route_end_time: minutesToHHMM(
      endMinutes
    ),

    route_end_datetime: isoAt(
      endMinutes
    ),

    total_hours:
      (endMinutes - startMinutes) / 60,

    routing_source: routingSource
  };
}

  function etaWindow(arrival, before = 60, after = 60) {
    const base = timeToMinutes(arrival);

    return {
      from: minutesToHHMM(base - before),
      to: minutesToHHMM(base + after)
    };
  }

  async function insertRoutes(client, companyId, routes, settings, depot, drivers, args = {}) {
    const created = [];
    const finalizeEta = args.finalize_eta === true || args.eta_finalized === true;
    const routeDate = args.planned_delivery_date || args.route_delivery_date || args.delivery_date || todayIso();
    const startTime = args.planned_start_time || args.start_time || settings.default_departure_time;

    for (const route of routes) {
      const vehicle = route.vehicle;
      const summary = route.summary;
      const timingResult = await buildTiming(route.stops, settings, vehicle, depot, routeDate, startTime);
      const timing = timingResult.stops;
      const endTime = timingResult.route_end_time || startTime;
      const driver = resolveDriver(vehicle, drivers, args);

      const routePayload = {
        company_id: companyId,
        route_code: route.routeCode,
        route_name: route.routeCode,
        name: route.routeCode,

        route_date: routeDate,
        planned_delivery_date: routeDate,
        planned_start_time: startTime,
        planned_end_time: endTime,

        status: "planned",
        route_status: "planned",
        transport_type: settings.default_transport_type,

        eta_finalized: finalizeEta,
        customer_notification_sent: false,

        vehicle_id: vehicle?.id || null,
        assigned_vehicle_id: vehicle?.id || null,
        vehicle_name: vehicle?.name || vehicle?.vehicle_name || null,
        assigned_vehicle_name: vehicle?.name || vehicle?.vehicle_name || null,
        vehicle_type: vehicle?.vehicle_type || null,
        vehicle_registration: vehicle?.registration || vehicle?.vehicle_code || null,
        assigned_vehicle_capacity_m3: getVehicleCapacity(vehicle),
        assigned_vehicle_speed_kmh: getVehicleSpeed(vehicle || {}, settings),

        driver_user_id: driver.driver_user_id,
        driver_profile_id: driver.driver_profile_id,
        driver_name: driver.driver_name,
        driver_email: driver.driver_email,

        planned_volume_m3: Number(summary.totalVolume.toFixed(2)),
        total_volume_m3: Number(summary.totalVolume.toFixed(2)),
        planned_orders: summary.totalOrders,
        planned_stops: summary.totalStops,
        total_stops: summary.totalStops,

        estimated_distance_km: Number(summary.distanceKm.toFixed(2)),
        estimated_distance_miles: Number(summary.distanceMiles.toFixed(2)),
        estimated_drive_hours: Number(summary.driveHours.toFixed(2)),
        estimated_service_hours: Number(summary.serviceHours.toFixed(2)),
        estimated_total_hours: Number(summary.totalHours.toFixed(2)),
        estimated_cost_fuel_gbp: Number(summary.fuelCost.toFixed(2)),
        estimated_fuel_litres: Number(summary.fuelLitres.toFixed(2)),
        estimated_cost_labour_gbp: Number(summary.labourCost.toFixed(2)),
estimated_cost_vehicle_gbp: Number(summary.vehicleCost.toFixed(2)),
estimated_cost_warehouse_gbp: Number(summary.warehouseCost.toFixed(2)),
estimated_cost_total_gbp: Number(summary.totalCost.toFixed(2)),
        cost_per_order_gbp: Number(summary.costPerOrder.toFixed(2)),
        cost_per_stop_gbp: Number(summary.costPerStop.toFixed(2)),
        fill_rate: Number(summary.fillRate.toFixed(4)),
        min_fill_rate: Number(getVehicleMinFill(vehicle, settings).toFixed(4)),
        underfilled: summary.fillRate < getVehicleMinFill(vehicle, settings),
        cost_limit_warning: summary.costPerOrder > settings.max_cost_per_order_gbp
      };

      const { data: insertedRoute, error: routeError } = await client
        .from("routes")
        .insert(routePayload)
        .select("*")
        .single();

      if (routeError) throw routeError;

      const stopRows = route.stops.map((stop, index) => {
        const t = timing[index] || {};

        return {
          company_id: companyId,
          route_id: insertedRoute.id,
          order_id: stop.order_id,
          stop_sequence: index + 1,
          stop_number: index + 1,
          stop_name: stop.stop_name,

          address_1: stop.address_1 || null,
          address_2: stop.address_2 || null,
          address_3: stop.address_3 || null,
          address_4: stop.address_4 || null,

          city: stop.city || null,
          postcode: stop.postcode || null,
          country: stop.country || null,

          latitude: stop.latitude,
          longitude: stop.longitude,

          eta: t.eta || null,
          etd: t.etd || null,
          arrival_eta: t.arrival_eta || null,
          departure_eta: t.departure_eta || null,
          planned_arrival_time: t.planned_arrival_time || null,
          planned_departure_time: t.planned_departure_time || null,
          planned_time: t.planned_time || null,

          estimated_drive_minutes: t.estimated_drive_minutes || 0,
          service_minutes: t.service_minutes ?? settings.stop_time_minutes,

          planned_volume_m3: toNumber(stop.planning_volume_m3, 0),
          planned_colli: toNumber(stop.planning_colli, 0),

          status: "planned",
          delivery_status: "planned"
        };
      });

      if (stopRows.length) {
        const { error: stopError } = await client
          .from("route_stops")
          .insert(stopRows);

        if (stopError) throw stopError;
      }

      for (const order of route.orders) {
        const index = route.stops.findIndex(stop => String(stop.order_id) === String(order.id));
        const t = timing[index] || {};
        const window = t.planned_arrival_time ? etaWindow(t.planned_arrival_time, 60, 60) : { from: null, to: null };

        const updatePayload = {
          route_id: insertedRoute.id,
          status: "planned",
          transport_type: settings.default_transport_type,

          planned_route_date: routeDate,
          expected_delivery_date: routeDate,
          delivery_eta_status: finalizeEta ? "confirmed" : "planned",

          delivery_eta_from: finalizeEta ? window.from : null,
          delivery_eta_to: finalizeEta ? window.to : null,

          driver_user_id: driver.driver_user_id,
          driver_profile_id: driver.driver_profile_id,
          driver_name: driver.driver_name,
          driver_email: driver.driver_email
        };

        const { error: orderError } = await client
          .from("orders")
          .update(updatePayload)
          .eq("company_id", companyId)
          .eq("id", order.id);

        if (orderError) throw orderError;
      }

      created.push(insertedRoute);
    }

    return created;
  }

  async function run(args = {}) {
    const client = db();
    const companyId = await getCompanyId(client);
    const settings = await loadSettings(client, companyId);
    const depot = depotPoint(settings);
    const drivers = await loadDrivers(client, companyId);
    const vehicles = await loadVehicles(client, companyId, settings);
const orders =
  await loadOrders(
    client,
    companyId,
    args
  );

const routeDate =
  args.planned_delivery_date ||
  args.route_delivery_date ||
  args.delivery_date ||
  todayIso();

validatePlanningDate(
  orders,
  routeDate
);

if (!orders.length) {
      return {
        ok: false,
        message: "No plan-ready orders found. Check status, planning release, route_id and coordinates.",
        created_routes: []
      };
    }

    if (!vehicles.length) {
      throw new Error("No active vehicles available. Check Settings > Vehicles.");
    }

    const manualOnly = Array.isArray(args.order_ids) && args.order_ids.length > 0;

    const clusters = await buildClusters(orders, settings, routeDate, depot, manualOnly);

    const plannedRoutes = await Promise.all(clusters.map(async cluster => {
      const vehicle = await chooseVehicle(
        vehicles,
        cluster.orders,
        settings,
        depot,
        args.preferred_vehicle_id || args.vehicle_id || null
      );

      if (!vehicle) throw new Error("No suitable vehicle found for selected orders.");

      const summary = await summarizeRoute(cluster.orders, settings, depot, vehicle);

      return {
        ...cluster,
        vehicle,
        summary,
        stops: summary.stops
      };
    }));


/* ==========================================================
   VEYNOR — EMISSION CHECK BEFORE ROUTE CREATION
   ========================================================== */

const emissionResults = [];

for (const plannedRoute of plannedRoutes) {
  const assessment = await assessEmissionZones(
    client,
    settings,
    plannedRoute.summary.locations,
    plannedRoute.summary.osrm
  );

  const deliveryZones = assessment.delivery_zones || [];
  const routeZones = assessment.route_zones || [];

  const uniqueZoneCodes = new Set([
    ...deliveryZones.map(zone => zone.zone_code),
    ...routeZones.map(zone => zone.zone_code)
  ].filter(Boolean));

  emissionResults.push({
    route_code: plannedRoute.routeCode,
    vehicle_id: plannedRoute.vehicle?.id || null,
    checked: assessment.checked,

    delivery_zones: deliveryZones,
    route_zones: routeZones,

    unique_zone_count: uniqueZoneCodes.size,

    warnings: [
      ...assessment.warnings,
      ...assessment.errors
    ],

    routing_source:
      plannedRoute.summary.routingSource
  });
}

/* ==========================================================
   CREATE ROUTES — EXISTING FUNCTIONALITY
   ========================================================== */

const created = await insertRoutes(
  client,
  companyId,
  plannedRoutes,
  settings,
  depot,
  drivers,
  args
);

log("Planning complete:", created);

return {
  ok: true,
  message: `${created.length} route(s) created.`,
  created_routes: created,
  planned_orders: orders.length,

  emission_zones: emissionResults,

  emission_warning_count:
    emissionResults.reduce(
      (total, route) =>
        total + route.warnings.length,
      0
    ),

  emission_check_complete:
    emissionResults.every(
      route => route.checked
    )
};

  }


async function previewSelection(args = {}) {
  const client = db();

  const companyId = await getCompanyId(client);
  const settings = await loadSettings(client, companyId);
  const depot = depotPoint(settings);

  const vehicles = await loadVehicles(
    client,
    companyId,
    settings
  );

  const orders = await loadOrders(
    client,
    companyId,
    args
  );

  if (!orders.length) {
    return {
      ok: false,
      message: "No eligible orders found for preview.",
      selected_orders: 0,
      suggested_vehicle: null,
      summary: null,
      emission_zones: null
    };
  }

  const vehicle = await chooseVehicle(
    vehicles,
    orders,
    settings,
    depot,
    args.preferred_vehicle_id ||
      args.vehicle_id ||
      null
  );

  const summary = await summarizeRoute(
    orders,
    settings,
    depot,
    vehicle
  );

  // Check delivery points and actual OSRM road geometry.
  const emissionAssessment = await assessEmissionZones(
    client,
    settings,
    summary.locations,
    summary.osrm
  );

  const deliveryZones = emissionAssessment.delivery_zones || [];
  const routeZones = emissionAssessment.route_zones || [];

  const affectedLocationKeys = new Set(
    deliveryZones.map(zone =>
      String(zone.location_key)
    )
  );

  const affectedOrderIds = new Set();

  for (const location of summary.locations) {
    if (
      affectedLocationKeys.has(
        String(location.key)
      )
    ) {
      for (const orderId of location.order_ids || []) {
        affectedOrderIds.add(String(orderId));
      }
    }
  }

  const uniqueZoneCodes = new Set([
    ...deliveryZones.map(zone => zone.zone_code),
    ...routeZones.map(zone => zone.zone_code)
  ].filter(Boolean));

  const warnings = [
    ...emissionAssessment.warnings,
    ...emissionAssessment.errors.map(
      error => `Emission zone check: ${error}`
    )
  ];

  if (summary.routingSource !== "osrm") {
    warnings.push(
      "Road routing unavailable. Distance and timing are estimated."
    );
  }

  return {
    ok: true,

    selected_orders: orders.length,
    suggested_vehicle: vehicle,
    summary,

    routing_source: summary.routingSource,

    emission_zones: {
      ...emissionAssessment,

      affected_orders: affectedOrderIds.size,
      affected_order_ids: [...affectedOrderIds],

      unique_zone_count: uniqueZoneCodes.size,

      has_emission_zones:
        deliveryZones.length > 0 ||
        routeZones.length > 0,

      route_crosses_zone:
        routeZones.length > 0,

      delivery_inside_zone:
        deliveryZones.length > 0
    },

    warnings
  };
}

  async function syncRouteDeliveryData(routeId) {
    const client = db();
    const companyId = await getCompanyId(client);

    const { data: route, error: routeError } = await client
      .from("routes")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", routeId)
      .maybeSingle();

    if (routeError) throw routeError;
    if (!route) throw new Error("Route not found.");

    const { data: stops, error: stopError } = await client
      .from("route_stops")
      .select("*")
      .eq("company_id", companyId)
      .eq("route_id", routeId);

    if (stopError) throw stopError;

    const orderIds = (stops || []).map(stop => stop.order_id).filter(Boolean);

    if (!orderIds.length) {
      return { ok: true, message: "No orders linked to route." };
    }

    const payload = {
      expected_delivery_date: route.planned_delivery_date || route.route_date || null,
      planned_route_date: route.planned_delivery_date || route.route_date || null,
      delivery_eta_status: route.eta_finalized ? "confirmed" : "planned",
      driver_user_id: route.driver_user_id || null,
      driver_profile_id: route.driver_profile_id || null,
      driver_name: route.driver_name || null,
      driver_email: route.driver_email || null
    };

    const { error } = await client
      .from("orders")
      .update(payload)
      .eq("company_id", companyId)
      .in("id", orderIds);

    if (error) throw error;

    return {
      ok: true,
      message: `${orderIds.length} order(s) synced with route delivery data.`
    };
  }

  async function replanExistingRoute(args = {}) {
  throw new Error(
    "Legacy route replanning is temporarily disabled. " +
    "Use Route Workspace when safe route editing is available."
  );
    const routeRef = args.route_id || args.routeId || args.route_code || args.routeCode;
    if (!routeRef) throw new Error("Route id or route code missing.");

    const client = db();
    const companyId = await getCompanyId(client);
    const settings = await loadSettings(client, companyId);
    const depot = depotPoint(settings);

    let routeQuery = client
      .from("routes")
      .select("*")
      .eq("company_id", companyId)
      .limit(1);

    routeQuery = isUuid(routeRef)
      ? routeQuery.eq("id", routeRef)
      : routeQuery.eq("route_code", routeRef);

    const { data: routesFound, error: routeError } = await routeQuery;
    if (routeError) throw routeError;

    const route = routesFound?.[0];
    if (!route) throw new Error("Route not found.");

    const routeId = route.id;

    const { data: stops, error: stopError } = await client
      .from("route_stops")
      .select("*")
      .eq("company_id", companyId)
      .eq("route_id", routeId);

    if (stopError) throw stopError;
    if (!stops?.length) return { ok: true, message: "Route has no stops." };

    const { data: routeVehicle } = await client
      .from("vehicles")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", route.vehicle_id || route.assigned_vehicle_id)
      .maybeSingle();

    const vehicle = {
      ...(routeVehicle || {}),
      id: route.vehicle_id || route.assigned_vehicle_id || routeVehicle?.id || null,
      name: route.vehicle_name || route.assigned_vehicle_name || routeVehicle?.name || null,
      capacity_m3: route.assigned_vehicle_capacity_m3 || routeVehicle?.capacity_m3 || routeVehicle?.max_volume_m3 || settings.max_route_volume_m3,
      average_speed_kmh: route.assigned_vehicle_speed_kmh || routeVehicle?.average_speed_kmh || settings.average_speed_kmh,
      vehicle_cost_per_hour_gbp:
  routeVehicle?.vehicle_cost_per_hour_gbp ||
  routeVehicle?.cost_per_hour_gbp ||
  route.vehicle_cost_per_hour_gbp ||
  route.estimated_cost_vehicle_gbp ||
  settings.vehicle_cost_per_hour_gbp,
      labour_cost_per_hour_gbp: routeVehicle?.labour_cost_per_hour_gbp || route.labour_cost_per_hour_gbp || settings.labour_cost_per_hour_gbp,
      fuel_litres_per_100km: routeVehicle?.fuel_litres_per_100km || route.fuel_litres_per_100km || 10
    };

    const routeDate = route.planned_delivery_date || route.route_date || todayIso();
    const startTime = route.planned_start_time || settings.default_departure_time;
    const finalizeEta = args.finalize_eta === true || args.eta_finalized === true;

    const cleanStops = stops
      .filter(stop => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude)))
      .map(stop => ({
        ...stop,
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        service_minutes: toNumber(stop.service_minutes, settings.stop_time_minutes),
        planning_volume_m3: toNumber(stop.planned_volume_m3, 0),
        planning_colli: toNumber(stop.planned_colli, 0)
      }));

    const orderedStops = nearestNeighbour(cleanStops, settings, depot);
    const timingResult = await buildTiming(orderedStops, settings, vehicle, depot, routeDate, startTime);
    const timing = timingResult.stops;
    const plannedEndTime = timingResult.route_end_time || startTime;

    const { error: deleteStopsError } = await client
      .from("route_stops")
      .delete()
      .eq("company_id", companyId)
      .eq("route_id", routeId);

    if (deleteStopsError) throw deleteStopsError;

    const newStopRows = orderedStops.map((stop, index) => {
      const t = timing[index] || {};

      return {
        company_id: companyId,
        route_id: routeId,
        order_id: stop.order_id,
        stop_sequence: index + 1,
        stop_number: index + 1,
        stop_name: stop.stop_name || stop.order_number || "Stop",

        address_1: stop.address_1 || null,
        address_2: stop.address_2 || null,
        address_3: stop.address_3 || null,
        address_4: stop.address_4 || null,
        city: stop.city || null,
        postcode: stop.postcode || null,
        country: stop.country || "United Kingdom",

        latitude: stop.latitude,
        longitude: stop.longitude,

        eta: t.eta || null,
        etd: t.etd || null,
        arrival_eta: t.arrival_eta || null,
        departure_eta: t.departure_eta || null,
        planned_arrival_time: t.planned_arrival_time || null,
        planned_departure_time: t.planned_departure_time || null,
        planned_time: t.planned_time || null,

        estimated_drive_minutes: t.estimated_drive_minutes || 0,
service_minutes:
  t.service_minutes ??
  settings.stop_time_minutes,

planned_volume_m3: stop.planning_volume_m3 || 0,
        planned_colli: stop.planning_colli || 0,

        status: "planned",
        delivery_status: "planned"
      };
    });

    if (newStopRows.length) {
      const { error: insertStopsError } = await client
        .from("route_stops")
        .insert(newStopRows);

      if (insertStopsError) throw insertStopsError;
    }

    for (let i = 0; i < orderedStops.length; i++) {
      const stop = orderedStops[i];
      const t = timing[i] || {};
      const windowEta = t.planned_arrival_time
        ? etaWindow(t.planned_arrival_time, 60, 60)
        : { from: null, to: null };

      if (!stop.order_id) continue;

      const { error: orderError } = await client
        .from("orders")
        .update({
          route_id: routeId,
          status: "planned",
          transport_status: "planned",
          planned_route_date: routeDate,
          expected_delivery_date: routeDate,
          delivery_eta_status: finalizeEta ? "confirmed" : "planned",
          delivery_eta_from: finalizeEta ? windowEta.from : null,
          delivery_eta_to: finalizeEta ? windowEta.to : null,
          last_activity_at: new Date().toISOString()
        })
        .eq("company_id", companyId)
        .eq("id", stop.order_id);

      if (orderError) throw orderError;
    }

    const summary = await summarizeRoute(
      orderedStops.map(stop => ({
        id: stop.order_id,
        delivery_lat: stop.latitude,
        delivery_lng: stop.longitude,
        planning_volume_m3: stop.planning_volume_m3,
        planning_colli: stop.planning_colli,
        service_minutes: stop.service_minutes
      })),
      settings,
      depot,
      vehicle
    );

    const { error: updateRouteError } = await client
      .from("routes")
      .update({
        planned_end_time: plannedEndTime,
        planned_volume_m3: Number(summary.totalVolume.toFixed(2)),
        total_volume_m3: Number(summary.totalVolume.toFixed(2)),
        planned_orders: orderedStops.length,
        planned_stops: orderedStops.length,
        total_stops: orderedStops.length,

        estimated_distance_km: Number(summary.distanceKm.toFixed(2)),
        estimated_distance_miles: Number(summary.distanceMiles.toFixed(2)),
        estimated_drive_hours: Number(summary.driveHours.toFixed(2)),
        estimated_service_hours: Number(summary.serviceHours.toFixed(2)),
        estimated_total_hours: Number(summary.totalHours.toFixed(2)),

        estimated_cost_fuel_gbp: Number(summary.fuelCost.toFixed(2)),
        estimated_fuel_litres: Number(summary.fuelLitres.toFixed(2)),
        estimated_cost_labour_gbp: Number(summary.labourCost.toFixed(2)),
estimated_cost_vehicle_gbp: Number(summary.vehicleCost.toFixed(2)),
estimated_cost_warehouse_gbp: Number(summary.warehouseCost.toFixed(2)),
estimated_cost_total_gbp: Number(summary.totalCost.toFixed(2)),
        cost_per_order_gbp: Number(summary.costPerOrder.toFixed(2)),
        cost_per_stop_gbp: Number(summary.costPerStop.toFixed(2)),

        route_status: "planned",
        eta_finalized: finalizeEta
      })
      .eq("company_id", companyId)
      .eq("id", routeId);

    if (updateRouteError) throw updateRouteError;

    return {
      ok: true,
      message: `${orderedStops.length} stop(s) replanned.`,
      before: {
        miles: Number(route.estimated_distance_miles || 0),
        hours: Number(route.estimated_total_hours || 0),
        cost: Number(route.estimated_cost_total_gbp || 0)
      },
      after: {
        miles: Number(summary.distanceMiles.toFixed(2)),
        hours: Number(summary.totalHours.toFixed(2)),
        cost: Number(summary.totalCost.toFixed(2))
      },
      difference: {
        miles: Number((summary.distanceMiles - Number(route.estimated_distance_miles || 0)).toFixed(2)),
        hours: Number((summary.totalHours - Number(route.estimated_total_hours || 0)).toFixed(2)),
        cost: Number((summary.totalCost - Number(route.estimated_cost_total_gbp || 0)).toFixed(2))
      }
    };
  }

async function recalculateExistingRouteTiming(args = {}) {
  const routeRef =
    args.route_id ||
    args.routeId ||
    args.route_code ||
    args.routeCode;

  if (!routeRef) {
    throw new Error("Route id or route code missing.");
  }

  const client = db();
  const companyId = await getCompanyId(client);
  const settings = await loadSettings(client, companyId);
  const depot = depotPoint(settings);

  // ---------------------------------------------------------
  // 1. Route ophalen
  // ---------------------------------------------------------

  let routeQuery = client
    .from("routes")
    .select("*")
    .eq("company_id", companyId)
    .limit(1);

  routeQuery = isUuid(routeRef)
    ? routeQuery.eq("id", routeRef)
    : routeQuery.eq("route_code", routeRef);

  const {
    data: routesFound,
    error: routeError
  } = await routeQuery;

  if (routeError) throw routeError;

  const route = routesFound?.[0];

  if (!route) {
    throw new Error("Route not found.");
  }

  const routeId = route.id;

  // ---------------------------------------------------------
  // 2. Stops ophalen in HUIDIGE handmatige volgorde
  // ---------------------------------------------------------

  const {
    data: stops,
    error: stopError
  } = await client
    .from("route_stops")
    .select("*")
    .eq("company_id", companyId)
    .eq("route_id", routeId)
    .order("stop_sequence", { ascending: true });

  if (stopError) throw stopError;

  if (!stops?.length) {
    return {
      ok: true,
      message: "Route has no stops."
    };
  }

  // ---------------------------------------------------------
  // 3. Voertuig ophalen
  // ---------------------------------------------------------

  const vehicleId =
    route.vehicle_id ||
    route.assigned_vehicle_id ||
    null;

  let routeVehicle = null;

  if (vehicleId) {
    const {
      data,
      error: vehicleError
    } = await client
      .from("vehicles")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", vehicleId)
      .maybeSingle();

    if (vehicleError) {
      console.warn(
        "[planning-engine.js] Vehicle could not be loaded:",
        vehicleError
      );
    }

    routeVehicle = data || null;
  }

  const vehicle = {
    ...(routeVehicle || {}),

    id:
      vehicleId ||
      routeVehicle?.id ||
      null,

    name:
      route.vehicle_name ||
      route.assigned_vehicle_name ||
      routeVehicle?.name ||
      null,

    average_speed_kmh:
      route.assigned_vehicle_speed_kmh ||
      routeVehicle?.average_speed_kmh ||
      settings.average_speed_kmh
  };

  // ---------------------------------------------------------
  // 4. Datum + starttijd
  // ---------------------------------------------------------

  const routeDate =
    route.planned_delivery_date ||
    route.route_date ||
    todayIso();

  const startTime =
    route.planned_start_time ||
    settings.default_departure_time;

  // ---------------------------------------------------------
  // 5. HUIDIGE volgorde behouden
  //
  // BELANGRIJK:
  // HIER GEEN nearestNeighbour() gebruiken.
  // ---------------------------------------------------------

  const orderedStops = [...stops]
    .filter(stop =>
      Number.isFinite(Number(stop.latitude)) &&
      Number.isFinite(Number(stop.longitude))
    )
    .sort(
      (a, b) =>
        Number(a.stop_sequence || 0) -
        Number(b.stop_sequence || 0)
    )
    .map(stop => ({
      ...stop,

      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),

      service_minutes: toNumber(
        stop.service_minutes,
        settings.stop_time_minutes
      )
    }));

  if (!orderedStops.length) {
    throw new Error(
      "No route stops with valid coordinates found."
    );
  }

  // ---------------------------------------------------------
  // 6. ETA opnieuw berekenen via bestaande buildTiming()
  // ---------------------------------------------------------

  const timingResult = await buildTiming(
    orderedStops,
    settings,
    vehicle,
    depot,
    routeDate,
    startTime
  );

  const timing = timingResult.stops || [];

  // ---------------------------------------------------------
  // 7. Nieuwe tijden naar route_stops schrijven
  // ---------------------------------------------------------

  for (let i = 0; i < orderedStops.length; i++) {
    const stop = orderedStops[i];
    const t = timing[i];

    if (!t) continue;

    const {
      error: updateStopError
    } = await client
      .from("route_stops")
      .update({
        stop_sequence: i + 1,
        stop_number: i + 1,

        eta: t.eta || null,
        etd: t.etd || null,

        arrival_eta:
          t.arrival_eta || null,

        departure_eta:
          t.departure_eta || null,

        planned_arrival_time:
          t.planned_arrival_time || null,

        planned_departure_time:
          t.planned_departure_time || null,

        planned_time:
          t.planned_time || null,

        estimated_drive_minutes:
          t.estimated_drive_minutes || 0,

service_minutes:
  t.service_minutes ??
  settings.stop_time_minutes
      })
      .eq("company_id", companyId)
      .eq("id", stop.id);

    if (updateStopError) {
      throw updateStopError;
    }

    // -------------------------------------------------------
    // 8. Eventuele bevestigde ETA-window op order aanpassen
    // -------------------------------------------------------

    if (stop.order_id) {
      const windowEta =
        t.planned_arrival_time
          ? etaWindow(
              t.planned_arrival_time,
              60,
              60
            )
          : {
              from: null,
              to: null
            };

      const orderPayload = {
        planned_route_date: routeDate,
        expected_delivery_date: routeDate,
        delivery_eta_status:
          route.eta_finalized
            ? "confirmed"
            : "planned",

        last_activity_at:
          new Date().toISOString()
      };

      if (route.eta_finalized) {
        orderPayload.delivery_eta_from =
          windowEta.from;

        orderPayload.delivery_eta_to =
          windowEta.to;
      }

      const {
        error: orderError
      } = await client
        .from("orders")
        .update(orderPayload)
        .eq("company_id", companyId)
        .eq("id", stop.order_id);

      if (orderError) {
        throw orderError;
      }
    }
  }

  // ---------------------------------------------------------
  // 9. End Time route aanpassen
  // ---------------------------------------------------------

  const {
    error: routeUpdateError
  } = await client
    .from("routes")
    .update({
      planned_end_time:
        timingResult.route_end_time ||
        startTime
    })
    .eq("company_id", companyId)
    .eq("id", routeId);

  if (routeUpdateError) {
    throw routeUpdateError;
  }

  return {
    ok: true,

    message:
      `${orderedStops.length} stop ETA(s) recalculated.`,

    route_id: routeId,

    start_time: startTime,

    route_end_time:
      timingResult.route_end_time ||
      startTime,

    stops: timing
  };
}


async function previewRouteChanges(args = {}) {
  const client = db();

  const companyId = await getCompanyId(client);

  const settings = await loadSettings(
    client,
    companyId
  );

  const depot = depotPoint(settings);

  const routeId =
    args.route_id ||
    args.routeId ||
    null;

  let existingRoute = null;
  let existingStopRows = [];

  // ----------------------------------------------------------
  // Bestaande route en stopvolgorde
  // ----------------------------------------------------------

  if (routeId) {
    const { data, error } = await client
      .from("routes")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", routeId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(
        "Existing route not found."
      );
    }

    existingRoute = data;

    const {
      data: stopData,
      error: stopError
    } = await client
      .from("route_stops")
      .select("order_id, stop_sequence")
      .eq("company_id", companyId)
      .eq("route_id", routeId)
      .order("stop_sequence", {
        ascending: true
      });

    if (stopError) throw stopError;

    existingStopRows = stopData || [];
  }

  const routeDate =
    args.route_date ||
    args.planned_delivery_date ||
    existingRoute?.planned_delivery_date ||
    existingRoute?.route_date ||
    todayIso();

  const startTime =
    args.start_time ||
    args.planned_start_time ||
    existingRoute?.planned_start_time ||
    settings.default_departure_time;

  const vehicleId =
    args.vehicle_id ||
    args.preferred_vehicle_id ||
    existingRoute?.vehicle_id ||
    existingRoute?.assigned_vehicle_id ||
    null;

  const vehicles = await loadVehicles(
    client,
    companyId,
    settings
  );

  const vehicle = vehicles.find(v =>
    String(v.id) === String(vehicleId)
  );

  if (!vehicle) {
    throw new Error(
      "A valid vehicle must be selected for route simulation."
    );
  }

  // ----------------------------------------------------------
  // Orders laden
  // ----------------------------------------------------------

  const requestedIds = Array.isArray(args.order_ids)
    ? args.order_ids.map(String)
    : null;

  const existingIds = existingStopRows
    .map(stop => stop.order_id)
    .filter(Boolean)
    .map(String);

  let orders = [];

  if (Array.isArray(args.orders)) {
    orders = args.orders.map(order => ({
      ...order
    }));

  } else {
    const ids = requestedIds || existingIds;

    if (ids.length) {
      if (new Set(ids).size !== ids.length) {
        throw new Error(
          "Duplicate order IDs are not allowed."
        );
      }

      const { data, error } = await client
        .from("orders")
        .select("*")
        .eq("company_id", companyId)
        .in("id", ids);

      if (error) throw error;

      const orderMap = new Map(
        (data || []).map(order => [
          String(order.id),
          order
        ])
      );

      orders = ids.map(id => {
        const order = orderMap.get(id);

        if (!order) {
          throw new Error(
            `Order ${id} could not be loaded.`
          );
        }

        return order;
      });
    }
  }

  if (!orders.length) {
    throw new Error(
      "No orders selected for simulation."
    );
  }

  const orderIds = orders.map(order =>
    String(order.id)
  );

  if (new Set(orderIds).size !== orders.length) {
    throw new Error(
      "Duplicate orders are not allowed."
    );
  }

  const missingCoordinates = orders.filter(
    order => !hasCoords(order)
  );

  if (missingCoordinates.length) {
    throw new Error(
      `${missingCoordinates.length} order(s) have no valid coordinates.`
    );
  }

  validatePlanningDate(
    orders,
    routeDate
  );

  // ----------------------------------------------------------
  // Conceptvolgorde controleren
  // ----------------------------------------------------------

  const stopOrderIds = Array.isArray(args.stop_order_ids)
    ? args.stop_order_ids.map(String)
    : [
        ...existingIds.filter(id =>
          orderIds.includes(id)
        ),

        ...orderIds.filter(id =>
          !existingIds.includes(id)
        )
      ];

  if (
    stopOrderIds.length !== orderIds.length ||
    new Set(stopOrderIds).size !== orderIds.length ||
    stopOrderIds.some(id => !orderIds.includes(id))
  ) {
    throw new Error(
      "Stop order must contain every selected order exactly once."
    );
  }

  const options = {
    preserveOrder: true,

    stop_order_ids: stopOrderIds,

    mode: args.unloading_mode || null,

    modeByLocation:
      args.mode_by_location || {},

    manualMinutesByLocation:
      args.manual_minutes_by_location || {}
  };

  // ----------------------------------------------------------
  // Samenvatting en timing met dezelfde routinggegevens
  // ----------------------------------------------------------

  const summary = await summarizeRoute(
    orders,
    settings,
    depot,
    vehicle,
    options
  );

  const orderedStops = summary.stops;
  const locations = summary.locations;

  const timingResult = await buildTiming(
    orderedStops,
    settings,
    vehicle,
    depot,
    routeDate,
    startTime,
    summary
  );

  if (
    Math.abs(
      timingResult.total_hours - summary.totalHours
    ) > 1 / 3600
  ) {
    throw new Error(
      "Route summary and stop timing are inconsistent."
    );
  }

  const distanceKm = summary.distanceKm;
  const driveHours = summary.driveHours;
  const serviceHours = summary.serviceHours;
  const totalHours = summary.totalHours;

  const volume = summary.totalVolume;

  const capacity = getVehicleCapacity(
    vehicle
  );

  const fillRate = capacity > 0
    ? volume / capacity
    : 0;

  // ----------------------------------------------------------
  // Bedrijfs- en voertuiglimieten
  // ----------------------------------------------------------

  function readLimit(value, fallback, label) {
    const selected =
      value == null || String(value).trim() === ""
        ? fallback
        : value;

    const number = Number(
      String(selected).replace(",", ".")
    );

    if (!Number.isFinite(number) || number < 0) {
      throw new Error(
        `Invalid route limit: ${label}.`
      );
    }

    return number;
  }

  const companyMaxStops = readLimit(
    settings.max_route_stops,
    DEFAULT_SETTINGS.max_route_stops,
    "max_route_stops"
  );

  const companyMaxHours = readLimit(
    settings.max_route_duration_hours,
    DEFAULT_SETTINGS.max_route_duration_hours,
    "max_route_duration_hours"
  );

  const companyMaxVolume = readLimit(
    settings.max_route_volume_m3,
    DEFAULT_SETTINGS.max_route_volume_m3,
    "max_route_volume_m3"
  );

  const maxStops = Math.min(
    companyMaxStops,

    readLimit(
      vehicle.max_stops,
      companyMaxStops,
      "vehicle.max_stops"
    )
  );

  const maxHours = Math.min(
    companyMaxHours,

    readLimit(
      vehicle.max_route_hours,
      companyMaxHours,
      "vehicle.max_route_hours"
    )
  );

  const maxOrders = readLimit(
    settings.max_orders_per_route,
    DEFAULT_SETTINGS.max_orders_per_route,
    "max_orders_per_route"
  );

  const maxVolume = Math.min(
    capacity,
    companyMaxVolume
  );

  // ----------------------------------------------------------
  // Blokkerende fouten en informatieve waarschuwingen
  // ----------------------------------------------------------


const warnings = [];
const validationErrors = [];

// Assess emission zones using the same OSRM route
// as the route preview.
const emissionAssessment = await assessEmissionZones(
  client,
  settings,
  locations,
  summary.osrm
);

warnings.push(...emissionAssessment.warnings);

if (emissionAssessment.errors.length) {
  warnings.push(
    ...emissionAssessment.errors.map(
      message => `Emission zone check: ${message}`
    )
  );
}


  function block(message) {
    validationErrors.push(message);
    warnings.push(message);
  }

  if (capacity <= 0) {
    block(
      "Vehicle has no valid loading capacity."
    );

  } else if (volume > capacity) {
    block(
      `Vehicle capacity exceeded by ${(volume - capacity).toFixed(2)} m³.`
    );
  }

  if (volume > companyMaxVolume) {
    block(
      `Company maximum route volume exceeded: ${volume.toFixed(2)}/${companyMaxVolume.toFixed(2)} m³.`
    );
  }

  if (locations.length > maxStops) {
    block(
      `Maximum delivery locations exceeded: ${locations.length}/${maxStops}.`
    );
  }

  if (orders.length > maxOrders) {
    block(
      `Maximum orders exceeded: ${orders.length}/${maxOrders}.`
    );
  }

  if (totalHours > maxHours) {
    block(
      `Maximum route hours exceeded: ${totalHours.toFixed(2)}/${maxHours.toFixed(2)}.`
    );
  }

  if (summary.routingSource !== "osrm") {
    warnings.push(
      "Road routing unavailable. Distance and timing are estimated."
    );
  }

  const conflictingOrders = orders.filter(order =>
    order.route_id &&
    String(order.route_id) !== String(routeId || "")
  );

  if (conflictingOrders.length) {
    block(
      `${conflictingOrders.length} order(s) belong to another route.`
    );
  }

  const lockedStatuses = new Set([
    "sent_to_driver",
    "out_for_delivery",
    "loaded",
    "delivered",
    "pod_completed",
    "closed",
    "cancelled"
  ]);

  const lockedOrders = orders.filter(order =>
    lockedStatuses.has(
      String(order.status || "").toLowerCase()
    )
  );

  if (lockedOrders.length) {
    block(
      `${lockedOrders.length} order(s) require review before editing.`
    );
  }

  // ----------------------------------------------------------
  // Lage belading: waarschuwing, geen blokkade
  // ----------------------------------------------------------

  const configuredFill = readLimit(
    vehicle.minimum_fill_rate ?? vehicle.min_fill_rate,
    settings.min_fill_rate_default,
    "minimum_fill_rate"
  );

  const minimumFillRate = configuredFill > 1
    ? configuredFill / 100
    : configuredFill;

  if (minimumFillRate > 1) {
    throw new Error(
      "Minimum fill rate cannot exceed 100%."
    );
  }

  const underfilled =
    capacity > 0 &&
    fillRate < minimumFillRate;

  if (underfilled) {
    warnings.push(
      `Low vehicle fill rate: ${(fillRate * 100).toFixed(1)}%; target ${(minimumFillRate * 100).toFixed(1)}%.`
    );
  }

  const remainingCapacityM3 =
    capacity - volume;

  const remainingCapacityPercent = capacity > 0
    ? Math.max(0, (1 - fillRate) * 100)
    : 0;

  const valid =
    validationErrors.length === 0;

  // ----------------------------------------------------------
  // Opgeslagen totalen: ontbrekende waarden blijven onbekend
  // ----------------------------------------------------------

  function storedNumber(value) {
    if (
      value == null ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const number = Number(
      String(value).replace(",", ".")
    );

    return Number.isFinite(number)
      ? number
      : null;
  }

  const before = existingRoute
    ? {
        distance_km: storedNumber(
          existingRoute.estimated_distance_km
        ),

        total_hours: storedNumber(
          existingRoute.estimated_total_hours
        ),

        volume_m3: storedNumber(
          existingRoute.planned_volume_m3 ??
          existingRoute.total_volume_m3
        ),

        total_cost_gbp: storedNumber(
          existingRoute.estimated_cost_total_gbp
        )
      }
    : null;

  // ----------------------------------------------------------
  // Nieuwe berekende totalen
  // ----------------------------------------------------------

  const after = {
    distance_km: Number(
      distanceKm.toFixed(2)
    ),

    distance_miles: Number(
      kmToMiles(distanceKm).toFixed(2)
    ),

    drive_hours: Number(
      driveHours.toFixed(2)
    ),

    service_hours: Number(
      serviceHours.toFixed(2)
    ),

    total_hours: Number(
      totalHours.toFixed(2)
    ),

    volume_m3: Number(
      volume.toFixed(2)
    ),

    colli: summary.totalColli,

    orders: orders.length,
    stops: locations.length,
    order_stop_records: orderedStops.length,

    capacity_m3: capacity,

    fill_rate: Number(
      fillRate.toFixed(4)
    ),

    fill_percent: Number(
      (fillRate * 100).toFixed(2)
    ),

    remaining_capacity_m3: Number(
      remainingCapacityM3.toFixed(2)
    ),

    remaining_capacity_percent: Number(
      remainingCapacityPercent.toFixed(2)
    ),

    fuel_litres: Number(
      summary.fuelLitres.toFixed(2)
    ),

    fuel_cost_gbp: Number(
      summary.fuelCost.toFixed(2)
    ),

    labour_cost_gbp: Number(
      summary.labourCost.toFixed(2)
    ),

    vehicle_cost_gbp: Number(
      summary.vehicleCost.toFixed(2)
    ),

    warehouse_cost_gbp: Number(
      summary.warehouseCost.toFixed(2)
    ),

    total_cost_gbp: Number(
      summary.totalCost.toFixed(2)
    ),

    cost_per_order_gbp: Number(
      summary.costPerOrder.toFixed(2)
    ),

    cost_per_stop_gbp: Number(
      summary.costPerStop.toFixed(2)
    ),

    route_end_time:
      timingResult.route_end_time,

    route_end_datetime:
      timingResult.route_end_datetime,

    minimum_fill_rate: minimumFillRate,

    underfilled
  };

  // ----------------------------------------------------------
  // Verschillen ten opzichte van de opgeslagen route
  // ----------------------------------------------------------

  const difference = before
    ? {}
    : null;

  if (before) {
    for (const key of [
      "distance_km",
      "total_hours",
      "volume_m3",
      "total_cost_gbp"
    ]) {
      difference[key] = before[key] == null
        ? null
        : Number(
            (after[key] - before[key]).toFixed(2)
          );
    }
  }

  // ----------------------------------------------------------
  // Preview teruggeven
  // ----------------------------------------------------------

  return {
    ok: true,

    valid,

    can_save:
      valid &&
      summary.routingSource === "osrm",

    simulation: true,
    saved: false,

    routing_source:
      summary.routingSource,

    timing_source:
      timingResult.routing_source,

    validation_errors:
      validationErrors,

    limits: {
      max_stops: maxStops,
      max_orders: maxOrders,
      max_hours: maxHours,
      max_volume_m3: maxVolume
    },

    route_id: existingRoute?.id || null,

    route_code:
      existingRoute?.route_code || null,

    route_date: routeDate,
    start_time: startTime,

    vehicle: {
      id: vehicle.id,

      name:
        vehicle.name ||
        vehicle.vehicle_name ||
        "",

      capacity_m3: capacity
    },

    unloading_mode:
      options.mode ||
      settings.unloading_time_mode ||
      "fixed",

warnings,

emission_zones: emissionAssessment,

before,
after,
difference,

    locations: locations.map((location, index) => ({
      location_key: location.key,
      location_sequence: index + 1,

      name: location.name,
      city: location.city,
      postcode: location.postcode,

      latitude: location.latitude,
      longitude: location.longitude,

      order_ids: location.order_ids,
      order_count: location.order_count,

      volume_m3: Number(
        location.volume_m3.toFixed(2)
      ),

      colli: location.colli,

      unloading_mode:
        location.unloading_mode,

      service_minutes:
        location.service_minutes,

      manual_override:
        options.manualMinutesByLocation[
          location.key
        ] != null
    })),

    stops: orderedStops.map((stop, index) => ({
      ...stop,

      stop_sequence: index + 1,
      stop_number: index + 1,

      ...(timingResult.stops[index] || {})
    }))
  };
}

async function saveRouteChanges(args = {}) {
  const routeId = args.route_id || args.routeId;

  if (!routeId) {
    throw new Error("Route ID is required.");
  }

  const preview = await previewRouteChanges(args);

  if (!preview.valid) {
    throw new Error(
      "Route cannot be saved: " +
      preview.warnings.join(" ")
    );
  }

  if (preview.routing_source !== "osrm") {
    throw new Error(
      "Route cannot be saved without a verified road calculation."
    );
  }

  // Opslaan blijft geblokkeerd totdat de databasefunctie
  // is gecontroleerd en veilig beschikbaar is gemaakt.
  return {
    ok: true,
    ready_to_save: true,
    saved: false,
    route_id: routeId,
    preview,
    message:
      "Route validated successfully. Database saving is not yet enabled."
  };
}

window.PlanningEngine = {
  run,
  previewSelection,
  previewRouteChanges,
  saveRouteChanges,
  syncRouteDeliveryData,
  replanExistingRoute,
  recalculateExistingRouteTiming
};

window.VeynorPlanningEngine = {
  calculateUnloadingMinutes,
  groupOrdersByDeliveryLocation,

  planRoutes: run,
  run,
  previewSelection,
  previewRouteChanges,
  saveRouteChanges,
};})();