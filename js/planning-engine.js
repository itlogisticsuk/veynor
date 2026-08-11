(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const DEBUG = true;
  const OSRM_BASE_URL = "https://router.project-osrm.org";

  const DEFAULT_SETTINGS = {
    average_speed_kmh: 50,
    stop_time_minutes: 15,
    distance_factor: 1.25,
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
    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    return data.id;
  }

  async function loadSettings(client, companyId) {
    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId);

    if (error) throw error;

    const settings = { ...DEFAULT_SETTINGS };

    (data || []).forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });

    settings.average_speed_kmh = toNumber(settings.average_speed_kmh || settings.planner_average_speed_kmh, DEFAULT_SETTINGS.average_speed_kmh);
    settings.stop_time_minutes = toNumber(settings.stop_time_minutes || settings.planner_stop_time_minutes, DEFAULT_SETTINGS.stop_time_minutes);
    settings.distance_factor = toNumber(settings.distance_factor || settings.planner_distance_factor, DEFAULT_SETTINGS.distance_factor);
    settings.max_route_volume_m3 = toNumber(settings.max_route_volume_m3, DEFAULT_SETTINGS.max_route_volume_m3);
    settings.max_route_stops = toNumber(settings.max_route_stops, DEFAULT_SETTINGS.max_route_stops);
    settings.max_orders_per_route = toNumber(settings.max_orders_per_route, DEFAULT_SETTINGS.max_orders_per_route);
    settings.max_route_duration_hours = toNumber(settings.max_route_duration_hours, DEFAULT_SETTINGS.max_route_duration_hours);
    settings.max_cost_per_order_gbp = toNumber(settings.max_cost_per_order_gbp, DEFAULT_SETTINGS.max_cost_per_order_gbp);
    settings.labour_cost_per_hour_gbp = toNumber(settings.labour_cost_per_hour_gbp, DEFAULT_SETTINGS.labour_cost_per_hour_gbp);
settings.vehicle_cost_per_hour_gbp = toNumber(
  settings.vehicle_cost_per_hour_gbp,
  DEFAULT_SETTINGS.vehicle_cost_per_hour_gbp
);
    settings.diesel_price_per_litre_gbp_inc_vat = toNumber(
      settings.diesel_price_per_litre_gbp_inc_vat,
      DEFAULT_SETTINGS.diesel_price_per_litre_gbp_inc_vat
    );

settings.warehouse_handling_in_per_colli_gbp = toNumber(
  settings.warehouse_handling_in_per_colli_gbp,
  DEFAULT_SETTINGS.warehouse_handling_in_per_colli_gbp
);

settings.warehouse_handling_out_per_colli_gbp = toNumber(
  settings.warehouse_handling_out_per_colli_gbp,
  DEFAULT_SETTINGS.warehouse_handling_out_per_colli_gbp
);

settings.warehouse_storage_per_m3_gbp = toNumber(
  settings.warehouse_storage_per_m3_gbp,
  DEFAULT_SETTINGS.warehouse_storage_per_m3_gbp
);

settings.warehouse_repack_per_colli_gbp = toNumber(
  settings.warehouse_repack_per_colli_gbp,
  DEFAULT_SETTINGS.warehouse_repack_per_colli_gbp
);

    settings.default_departure_time = settings.default_departure_time || settings.planner_default_departure_time || DEFAULT_SETTINGS.default_departure_time;
    settings.default_transport_type = settings.default_transport_type || DEFAULT_SETTINGS.default_transport_type;

    settings.depot_name = settings.home_depot_name || settings.depot_name || DEFAULT_SETTINGS.depot_name;
    settings.depot_lat = toNumber(settings.home_depot_lat ?? settings.depot_lat, null);
    settings.depot_lng = toNumber(settings.home_depot_lng ?? settings.depot_lng, null);

    settings.min_fill_rate_default = toNumber(settings.min_fill_rate_default, DEFAULT_SETTINGS.min_fill_rate_default);

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

    if (error) throw error;

    return (data || [])
      .filter(v => v.active !== false && v.is_active !== false && v.use_in_planning !== false)
      .map(v => ({
        ...v,
        capacity_m3: getVehicleCapacity(v),
        max_stops: toNumber(v.max_stops, DEFAULT_SETTINGS.max_route_stops),
        max_route_hours: toNumber(v.max_route_hours, DEFAULT_SETTINGS.max_route_duration_hours),
vehicle_cost_per_hour_gbp: toNumber(
  v.vehicle_cost_per_hour_gbp ?? v.cost_per_hour_gbp,
  settings.vehicle_cost_per_hour_gbp
),
        labour_cost_per_hour_gbp: toNumber(v.labour_cost_per_hour_gbp, DEFAULT_SETTINGS.labour_cost_per_hour_gbp),
        average_speed_kmh: toNumber(v.average_speed_kmh, DEFAULT_SETTINGS.average_speed_kmh),
        fuel_litres_per_100km: toNumber(v.fuel_litres_per_100km, 10)
      }))
      .sort((a, b) => getVehicleCapacity(a) - getVehicleCapacity(b));
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
    return toNumber(order?.planning_volume_m3 ?? order?.volume_m3, 0);
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
      .in("status", [
        "ready_for_planning",
        "ready_for_picking"
      ])
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
    if (!Array.isArray(stops) || !stops.length) return null;

    const points = [depot, ...stops, depot];

    const coords = points
      .map(p => `${Number(p.longitude)},${Number(p.latitude)}`)
      .join(";");

    const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=false&steps=false`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM request failed: ${res.status}`);

    const json = await res.json();

    if (json.code !== "Ok" || !json.routes?.length) {
      throw new Error(`OSRM route failed: ${json.code || "Unknown error"}`);
    }

    const route = json.routes[0];

    return {
      distanceKm: route.distance / 1000,
      distanceMiles: kmToMiles(route.distance / 1000),
      driveHours: route.duration / 3600,
      legs: route.legs || []
    };
  }

  async function summarizeRoute(orders, settings, depot, vehicle = null) {
    const stops = nearestNeighbour(
      orders.map(order => makeStop(order, settings)),
      settings,
      depot
    );

    let distanceKm = routeDistanceKmFallback(stops, settings, depot);
    let distanceMiles = kmToMiles(distanceKm);
    let driveHours = distanceKm / Math.max(
      1,
      vehicle ? getVehicleSpeed(vehicle, settings) : settings.average_speed_kmh
    );

    let osrm = null;

    try {
      osrm = await fetchOsrmRoute(stops, depot);
      if (osrm) {
        distanceKm = osrm.distanceKm;
        distanceMiles = osrm.distanceMiles;
        driveHours = osrm.driveHours;
      }
    } catch (err) {
      console.warn("[planning-engine.js] OSRM fallback to haversine:", err.message || err);
    }

    const serviceHours = stops.reduce(
      (sum, stop) => sum + toNumber(stop.service_minutes, settings.stop_time_minutes) / 60,
      0
    );

    const totalHours = driveHours + serviceHours;
    const totalVolume = orders.reduce((sum, order) => sum + getOrderVolume(order), 0);
    const totalColli = orders.reduce((sum, order) => sum + getOrderColli(order), 0);
    const totalOrders = orders.length;
    const totalStops = stops.length;

    const labourRate = vehicle
      ? toNumber(vehicle.labour_cost_per_hour_gbp, settings.labour_cost_per_hour_gbp)
      : settings.labour_cost_per_hour_gbp;

const vehicleRate = vehicle
  ? toNumber(vehicle.vehicle_cost_per_hour_gbp, settings.vehicle_cost_per_hour_gbp)
  : settings.vehicle_cost_per_hour_gbp;

    const dieselPriceExVat =
      toNumber(settings.diesel_price_per_litre_gbp_inc_vat, 1.55) / 1.20;

    const fuelUsage = toNumber(vehicle?.fuel_litres_per_100km, 10);
    const fuelLitres = (distanceKm / 100) * fuelUsage;
    const fuelCost = fuelLitres * dieselPriceExVat;

const labourCost = totalHours * labourRate;
const vehicleCost = totalHours * vehicleRate;

const warehouseHandlingInCost =
  totalColli * settings.warehouse_handling_in_per_colli_gbp;

const warehouseHandlingOutCost =
  totalColli * settings.warehouse_handling_out_per_colli_gbp;

const warehouseStorageCost =
  totalVolume * settings.warehouse_storage_per_m3_gbp;

const warehouseVasCost =
  totalColli * settings.warehouse_repack_per_colli_gbp;

const warehouseCost =
  warehouseHandlingInCost +
  warehouseHandlingOutCost +
  warehouseStorageCost +
  warehouseVasCost;

const totalCost =
  labourCost +
  vehicleCost +
  fuelCost +
  warehouseCost;

    const capacity = vehicle ? getVehicleCapacity(vehicle) : 0;
    const fillRate = capacity > 0 ? totalVolume / capacity : 0;

    return {
      stops,
      osrm,
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
      costPerOrder: totalOrders ? totalCost / totalOrders : 0,
      costPerStop: totalStops ? totalCost / totalStops : 0,
      fillRate
    };
  }

  async function quickSummaryForLimits(orders, settings, depot) {
    const stops = nearestNeighbour(
      orders.map(order => makeStop(order, settings)),
      settings,
      depot
    );

    const distanceKm = routeDistanceKmFallback(stops, settings, depot);
    const driveHours = distanceKm / Math.max(1, settings.average_speed_kmh);
    const serviceHours = stops.reduce((sum, stop) => sum + toNumber(stop.service_minutes, settings.stop_time_minutes) / 60, 0);

    return {
      totalVolume: orders.reduce((sum, order) => sum + getOrderVolume(order), 0),
      totalOrders: orders.length,
      totalStops: stops.length,
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
    const capacity = getVehicleCapacity(vehicle);
    const minFill = getVehicleMinFill(vehicle, settings);
    const fill = capacity > 0 ? summary.totalVolume / capacity : 0;

    let penalty = 0;
    if (!vehicleCanTake(vehicle, summary, settings)) penalty += 999999;
    if (summary.totalVolume > 0 && fill < minFill) penalty += 5000;

    return summary.totalCost + penalty + ((1 - fill) * 100);
  }

  async function chooseVehicle(vehicles, orders, settings, depot, preferredVehicleId = null) {
    if (preferredVehicleId) {
      const preferred = vehicles.find(v => String(v.id) === String(preferredVehicleId));
      if (preferred) return preferred;
    }

    const scored = await Promise.all(
      vehicles.map(async vehicle => {
        const summary = await summarizeRoute(orders, settings, depot, vehicle);
        return { vehicle, summary, score: vehicleScore(vehicle, summary, settings) };
      })
    );

    return scored.sort((a, b) => a.score - b.score)[0]?.vehicle || null;
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

  async function buildTiming(stops, settings, vehicle, depot, routeDate, startTime) {
    let currentMinutes = timeToMinutes(startTime || settings.default_departure_time);

    let legs = [];

    try {
      const osrm = await fetchOsrmRoute(stops, depot);
      legs = osrm?.legs || [];
    } catch (err) {
      console.warn("[planning-engine.js] OSRM timing fallback:", err.message || err);
    }

    let currentLat = depot.latitude;
    let currentLng = depot.longitude;

    const rows = stops.map((stop, index) => {
      let driveMinutes;

      if (legs[index]?.duration) {
        driveMinutes = Math.round(legs[index].duration / 60);
      } else {
        const km = estimateRoadKm(
          haversineKm(currentLat, currentLng, stop.latitude, stop.longitude),
          settings
        );

        driveMinutes = Math.round((km / getVehicleSpeed(vehicle || {}, settings)) * 60);
      }

      currentMinutes += driveMinutes;

      const arrival = minutesToHHMM(currentMinutes);
      const serviceMinutes = toNumber(stop.service_minutes, settings.stop_time_minutes);

      currentMinutes += serviceMinutes;
      const departure = minutesToHHMM(currentMinutes);

      currentLat = stop.latitude;
      currentLng = stop.longitude;

      return {
        order_id: stop.order_id,
        stop_sequence: index + 1,
        stop_number: index + 1,
        arrival_eta: arrival,
        departure_eta: departure,
        planned_arrival_time: arrival,
        planned_departure_time: departure,
        eta: hhmmToIso(routeDate, arrival),
        etd: hhmmToIso(routeDate, departure),
        planned_time: arrival,
        estimated_drive_minutes: driveMinutes,
        service_minutes: serviceMinutes
      };
    });

    let returnMinutes = 0;

    if (stops.length) {
      const returnLeg = legs[stops.length];

      if (returnLeg?.duration) {
        returnMinutes = Math.round(returnLeg.duration / 60);
      } else {
        const lastStop = stops[stops.length - 1];
        const returnKm = estimateRoadKm(
          haversineKm(lastStop.latitude, lastStop.longitude, depot.latitude, depot.longitude),
          settings
        );

        returnMinutes = Math.round((returnKm / getVehicleSpeed(vehicle || {}, settings)) * 60);
      }
    }

    return {
      stops: rows,
      return_minutes: returnMinutes,
      route_end_time: minutesToHHMM(currentMinutes + returnMinutes)
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
          service_minutes: t.service_minutes || settings.stop_time_minutes,

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

    const created = await insertRoutes(client, companyId, plannedRoutes, settings, depot, drivers, args);

    log("Planning complete:", created);

    return {
      ok: true,
      message: `${created.length} route(s) created.`,
      created_routes: created,
      planned_orders: orders.length
    };
  }

  async function previewSelection(args = {}) {
    const client = db();
    const companyId = await getCompanyId(client);
    const settings = await loadSettings(client, companyId);
    const depot = depotPoint(settings);
    const vehicles = await loadVehicles(client, companyId, settings);
    const orders = await loadOrders(client, companyId, args);

    const vehicle = await chooseVehicle(
      vehicles,
      orders,
      settings,
      depot,
      args.preferred_vehicle_id || args.vehicle_id || null
    );

    const summary = await summarizeRoute(orders, settings, depot, vehicle);

    return {
      ok: true,
      selected_orders: orders.length,
      suggested_vehicle: vehicle,
      summary
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
        service_minutes: t.service_minutes || settings.stop_time_minutes,

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
          t.service_minutes ||
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

window.PlanningEngine = {
  run,
  previewSelection,
  syncRouteDeliveryData,
  replanExistingRoute,
  recalculateExistingRouteTiming
};

window.VeynorPlanningEngine = {
  planRoutes: run,
  run,
  previewSelection,
  syncRouteDeliveryData,
  replanExistingRoute,
  recalculateExistingRouteTiming
};
})();