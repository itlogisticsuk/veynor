(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const DEBUG = true;

  const DELIVERY_SUCCESS_STATUSES = new Set(["delivered", "completed"]);
  const DELIVERY_ISSUE_STATUSES = new Set(["delivery_issue", "partial_delivery", "partially_delivered", "issue"]);
  const DELIVERY_FAILED_STATUSES = new Set(["failed_delivery", "not_delivered", "returned", "cancelled_delivery", "delivery_failed"]);
  const STOCK_COMPLETE_STATUSES = new Set(["stock_complete", "ready_for_picking", "picked", "ready_for_loading"]);

  let client = null;
  let companyId = null;

  let allOrders = [];
  let filteredOrders = [];
  let allRoutes = [];
  let allStops = [];
  let activeVehicles = [];
  let driverUsers = [];
let storedDeliveryGroups = [];
let productOwnerProfiles = [];
let warehouseCostSettings = {
  handlingInPerColli: 0,
  handlingOutPerColli: 0,
  storagePerM3: 0,
  vasPerColli: 0
};

  let selectedOrderId = null;
  let selectedVehicleId = "";
  let selectedDriverId = "";
  let selectedPlanningDate = todayIso();

  const selectedOrderIds = new Set();

  const orderSortState = {
    key: "requested",
    direction: "asc"
  };

  function log(...args) {
    if (DEBUG) console.log("[orders.js]", ...args);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";

    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatMoney(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "£0.00";

    return `£${num.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatDate(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return d.toLocaleDateString("en-GB");
  }

  function formatTime(value) {
    if (!value) return "—";

    const text = String(value).trim();

    if (/^\d{1,2}:\d{2}$/.test(text)) return text;
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) return text.slice(0, 5);

    const d = new Date(value);

    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    return text;
  }

  function titleCase(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || (type === "err" ? "Unknown error." : "Done.");
    el.className = `notice ${type}`;

    clearTimeout(window.__ordersToastTimer);
    window.__ordersToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6500);
  }

  function hasCoordinates(order) {
    const lat = toNumber(order?.delivery_lat, NaN);
    const lng = toNumber(order?.delivery_lng, NaN);
    return Number.isFinite(lat) && Number.isFinite(lng);
  }

  function getOrderVolume(order) {
    return toNumber(order?.planning_volume_m3 ?? order?.volume_m3, 0);
  }

function makeRetailerCode(postcode, retailerName) {
  const pc = String(postcode || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");

  const name = String(retailerName || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);

  return `${pc || "NOPC"}-${name || "RET"}`;
}

function getDeliveryGroupKey(order) {
  const postcode = String(order.delivery_postcode || "")
    .toUpperCase()
    .replace(/\s+/g, "");

  const retailerCode =
    order.retailer_code ||
    makeRetailerCode(order.delivery_postcode, getRetailerName(order));

  return [
    order.customer_id || "",
    retailerCode,
    postcode
  ].join("|");
}

function markBelowMinimumOrders() {
  const groups = new Map();

  allOrders.forEach(order => {
    order.belowMinimumVolume = false;

    const state = getCompletionState(order);

const status = normalize(order.status || "");
const warehouseStatus = normalize(order.warehouse_status || "");
const overallStatus = normalize(order.overall_status || "");

const isReady =
  ["stock_complete", "planned", "ready_for_planning", "ready_for_picking"].includes(state) ||
  ["stock_complete", "planned", "ready_for_planning", "ready_for_picking"].includes(status) ||
  ["stock_complete", "planned", "ready_for_planning", "ready_for_picking"].includes(warehouseStatus) ||
  ["stock_complete", "planned", "ready_for_planning", "ready_for_picking"].includes(overallStatus) ||
  order.planning_release === true;

if (!isReady) return;

    const key = getDeliveryGroupKey(order);
    const volume = getOrderVolume(order);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        volume: 0,
        ids: []
      });
    }

    const group = groups.get(key);
    group.volume += volume;
    group.ids.push(String(order.id));
  });

  groups.forEach(group => {
    const stored = storedDeliveryGroups.find(row =>
      row.group_key === group.key
    );

    const approved = normalize(stored?.status) === "approved";

    if (approved) return;

    if (group.volume > 0 && group.volume < 1.25) {
      allOrders.forEach(order => {
        if (group.ids.includes(String(order.id))) {
          order.belowMinimumVolume = true;
        }
      });
    }
  });
}

  function getOrderColli(order) {
    return toNumber(order?.planning_colli, 0);
  }

  function getOrderRevenue(order) {
    return Math.max(
      toNumber(order?.estimated_revenue_gbp, 0),
      toNumber(order?.total_customer_charge, 0),
      toNumber(order?.customer_charge_gbp, 0),
      toNumber(order?.revenue_gbp, 0),
      toNumber(order?.order_revenue_gbp, 0),
      toNumber(order?.__line_revenue_gbp, 0)
    );
  }

  function getRetailerName(order) {
    return (
      order?.retailer_name ||
      order?.retail_name ||
      order?.shop_name ||
      order?.delivery_name ||
      order?.delivery_contact_name ||
      order?.customer_reference_name ||
      order?.customer_name_raw ||
      order?.customer_display_name ||
      order?.end_customer_name ||
      order?.consignee_name ||
      order?.delivery_company ||
      order?.delivery_address_name ||
      order?.recipient_name ||
      order?.customer_name ||
      "—"
    );
  }

  function getProductOwnerName(order) {
    return (
      order?.product_owner_name ||
      order?.customer_name ||
      order?.customers?.name ||
      "—"
    );
  }

  function getOrderById(orderId) {
    return allOrders.find(row => String(row.id) === String(orderId)) || null;
  }

  function getRouteById(routeId) {
    return allRoutes.find(row => String(row.id) === String(routeId)) || null;
  }

  function getDriverById(driverId) {
    if (!driverId) return null;

    return driverUsers.find(row =>
      String(row.id) === String(driverId) ||
      String(row.auth_user_id) === String(driverId) ||
      String(row.profile_id) === String(driverId)
    ) || null;
  }

  function getDriverName(driver) {
    return driver?.full_name || driver?.email || "Driver";
  }

  function getDriverNameById(driverId) {
    const driver = getDriverById(driverId);
    return driver ? getDriverName(driver) : "";
  }

  function getRouteDriverId(route) {
    return route?.driver_user_id || route?.driver_profile_id || "";
  }

  function getOrderDriverId(order) {
    return order?.driver_user_id || order?.driver_profile_id || "";
  }

  function getOrderDriverName(order) {
    if (order?.driver_name) return order.driver_name;

    const route = order?.route_id ? getRouteById(order.route_id) : null;
    if (route?.driver_name) return route.driver_name;

    const id = route ? getRouteDriverId(route) : getOrderDriverId(order);
    return getDriverNameById(id) || "—";
  }

  function getRouteLabel(routeId) {
    if (!routeId) return "No route";

    const route = getRouteById(routeId);

    return (
      route?.route_code ||
      route?.route_number ||
      route?.route_name ||
      route?.name ||
      "Assigned"
    );
  }

  function getExpectedDelivery(order) {
    const route = order.route_id ? getRouteById(order.route_id) : null;

    return (
      order.expected_delivery_date ||
      order.confirmed_delivery_date ||
      order.planned_route_date ||
      route?.planned_delivery_date ||
      route?.route_date ||
      ""
    );
  }

  function getEtaText(order) {
    if (order.delivery_eta_from && order.delivery_eta_to) {
      return `${formatTime(order.delivery_eta_from)} - ${formatTime(order.delivery_eta_to)}`;
    }

    const stop = allStops.find(row => String(row.order_id) === String(order.id));

    if (stop?.planned_arrival_time) return formatTime(stop.planned_arrival_time);
    if (stop?.arrival_eta) return formatTime(stop.arrival_eta);

    return titleCase(order.delivery_eta_status || "pending");
  }

  function isDelivered(order) {
    return DELIVERY_SUCCESS_STATUSES.has(normalize(order.status)) ||
      DELIVERY_SUCCESS_STATUSES.has(normalize(order.transport_status)) ||
      DELIVERY_SUCCESS_STATUSES.has(normalize(order.delivery_status));
  }

  function isIssue(order) {
    return DELIVERY_ISSUE_STATUSES.has(normalize(order.status)) ||
      DELIVERY_ISSUE_STATUSES.has(normalize(order.transport_status)) ||
      DELIVERY_ISSUE_STATUSES.has(normalize(order.delivery_status));
  }

  function isFailed(order) {
    return DELIVERY_FAILED_STATUSES.has(normalize(order.status)) ||
      DELIVERY_FAILED_STATUSES.has(normalize(order.transport_status)) ||
      DELIVERY_FAILED_STATUSES.has(normalize(order.delivery_status));
  }

  function isStockComplete(order) {
    return STOCK_COMPLETE_STATUSES.has(normalize(order.status)) ||
      STOCK_COMPLETE_STATUSES.has(normalize(order.warehouse_status)) ||
      normalize(order.overall_status) === "stock_complete";
  }

  function getCompletionState(order) {
    if (isDelivered(order)) return "delivered";
    if (isIssue(order)) return "issue";
    if (isFailed(order)) return "failed";
    if (isStockComplete(order)) return "stock_complete";
    return "open";
  }

  function completionLabel(order) {
    const state = getCompletionState(order);
    if (state === "delivered") return "Delivered";
    if (state === "issue") return "Issue / partial";
    if (state === "failed") return "Failed";
    if (state === "stock_complete") return "Stock complete";
    return "Open";
  }

  function completionClass(order) {
    const state = getCompletionState(order);
    if (state === "delivered") return "completion-delivered";
    if (state === "issue") return "completion-issue";
    if (state === "failed") return "completion-failed";
    if (state === "stock_complete") return "completion-stock";
    return "completion-open";
  }

  function rowClass(order) {
    if (isDelivered(order)) return "order-row-delivered";
    if (isIssue(order)) return "order-row-issue";
    if (isFailed(order)) return "order-row-failed";
    return "";
  }

  function statusPillClass(value) {
    const v = normalize(value || "ready_for_planning");
    return `status-${v.replace(/[^a-z0-9_]/g, "")}`;
  }

function statusPillStyle(value, order = {}) {
  const status = normalize(value);
  const transport = normalize(order.transport_type);

  if (status === "export_for_charter" || transport === "charter") {
    return 'style="background:#fff7ed;color:#c2410c;border-color:#fed7aa;"';
  }

  if (transport === "own_transport" || status === "planned") {
    return 'style="background:#dcfce7;color:#15803d;border-color:#bbf7d0;"';
  }

  if (status === "ready_for_planning" || status === "ready_for_picking") {
    return 'style="background:#dbeafe;color:#1d4ed8;border-color:#bfdbfe;"';
  }

  return "";
}

  function transportPillClass(value) {
    const v = normalize(value || "unassigned");
    if (v === "own_transport") return "transport-own";
    if (v === "charter") return "transport-charter";
    return "transport-unassigned";
  }

  function getManualRouteDeliveryDate() {
    return byId("manualRouteDeliveryDate")?.value || selectedPlanningDate || todayIso();
  }

  function getManualRouteStartTime() {
    return byId("manualRouteStartTime")?.value || "08:00";
  }

  function getManualFinalizeEta() {
    return !!byId("manualFinalizeEta")?.checked;
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    companyId = data.id;
    return companyId;
  }

  async function loadDepotSettings() {
    const cid = await getCompanyId();

    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", cid);

    if (error) throw error;

    const map = new Map((data || []).map(row => [row.setting_key, row.setting_value || ""]));
warehouseCostSettings = {
  handlingInPerColli: toNumber(map.get("warehouse_handling_in_per_colli_gbp"), 0),
  handlingOutPerColli: toNumber(map.get("warehouse_handling_out_per_colli_gbp"), 0),
  storagePerM3: toNumber(map.get("warehouse_storage_per_m3_gbp"), 0),
  vasPerColli: toNumber(map.get("warehouse_repack_per_colli_gbp"), 0)
};

    const depotLat = Number(map.get("home_depot_lat"));
    const depotLng = Number(map.get("home_depot_lng"));

    if (Number.isFinite(depotLat) && Number.isFinite(depotLng)) {
      window.depotMapPoint = {
        name: map.get("home_depot_name") || "Home Depot",
        latitude: depotLat,
        longitude: depotLng
      };
    } else {
      window.depotMapPoint = null;
    }
  }

  async function loadDrivers() {
    const cid = await getCompanyId();

    const { data, error } = await client
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        company_id,
        full_name,
        role,
        phone,
        is_active,
        email,
        is_driver,
        use_in_planning,
        default_vehicle_id
      `)
      .eq("company_id", cid)
      .eq("is_active", true);

    if (error) {
      console.warn("[orders.js] Could not load drivers:", error.message);
      driverUsers = [];
      return;
    }

    driverUsers = (data || [])
      .filter(row => {
        const role = normalize(row.role || "");
        return row.is_driver === true || role === "driver" || role === "chauffeur";
      })
      .filter(row => row.use_in_planning !== false)
      .map(row => ({
        profile_id: row.id,
        id: row.auth_user_id || row.id,
        auth_user_id: row.auth_user_id || row.id,
        company_id: row.company_id,
        full_name: row.full_name || row.email || "Driver",
        email: row.email || "",
        phone: row.phone || "",
        role: row.role || "driver",
        is_driver: row.is_driver === true,
        is_active: row.is_active !== false,
        use_in_planning: row.use_in_planning !== false,
        default_vehicle_id: row.default_vehicle_id || ""
      }))
      .sort((a, b) => getDriverName(a).localeCompare(getDriverName(b)));
  }

  async function loadActiveVehicles() {
    const cid = await getCompanyId();

    const { data, error } = await client
      .from("vehicles")
      .select("*")
      .eq("company_id", cid);

    if (error) throw error;

    activeVehicles = (data || [])
      .filter(row => row.active !== false)
      .filter(row => row.is_active !== false)
      .filter(row => row.use_in_planning !== false)
      .map(row => ({
        ...row,
        capacity_m3: toNumber(row.capacity_m3 ?? row.max_volume_m3, 0)
      }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    log("Active vehicles loaded:", activeVehicles);
  }
async function loadProductOwnerProfiles() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("settings")
    .select("setting_value")
    .eq("company_id", cid)
    .eq("setting_key", "product_owner_profiles")
    .maybeSingle();

  if (error) {
    console.warn(
      "[orders.js] Product owner profiles could not be loaded:",
      error.message
    );

    productOwnerProfiles = [];
    return;
  }

  try {
    const parsed = JSON.parse(data?.setting_value || "[]");

    productOwnerProfiles = Array.isArray(parsed)
      ? parsed
      : [];
  } catch (error) {
    console.warn(
      "[orders.js] Product owner profiles contain invalid JSON:",
      error
    );

    productOwnerProfiles = [];
  }
}

function getProductOwnerProfile(customerCode) {
  const code = normalize(customerCode);

  if (!code) return null;

  return productOwnerProfiles.find(profile =>
    normalize(profile?.customer_code) === code
  ) || null;
}

async function loadStoredDeliveryGroups() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("delivery_groups")
    .select("*")
    .eq("company_id", cid);

  if (error) {
    console.warn("[orders.js] Delivery groups skipped:", error.message);
    storedDeliveryGroups = [];
    return;
  }

  storedDeliveryGroups = data || [];
}

async function loadOrders() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("orders")
    .select(`
      *,
      customers (
        id,
        name,
        customer_code
      )
    `)
    .eq("company_id", cid)
    .in("status", [
      "ready_for_planning",
      "ready_for_picking",
      "planned",
      "sent_to_driver",
      "out_for_delivery",
      "loaded",
      "delivered",
      "delivery_issue",
      "partial_delivery",
      "failed_delivery",
      "not_delivered",
      "returned",
      "export_for_charter"
    ])
    .order("requested_delivery_date", {
      ascending: true,
      nullsFirst: false
    })
    .order("order_number", {
      ascending: true
    });

  if (error) throw error;

  allOrders = (data || []).map(row => {
    const customerCode =
      row.customers?.customer_code ||
      "";

    const ownerProfile =
      getProductOwnerProfile(customerCode);

    return {
      ...row,

      product_owner_name:
        row.customers?.name ||
        row.customer_name ||
        "—",

      product_owner_code:
        customerCode,

      product_owner_display_code:
        ownerProfile?.display_code ||
        customerCode ||
        "—",

      customer_name:
        row.customers?.name ||
        row.customer_name ||
        "—",

      retailer_name:
        getRetailerName(row),

      __line_revenue_gbp: 0,
      belowMinimumVolume: false
    };
  });

  markBelowMinimumOrders();

  await loadOrderRevenueOverlay();
}
  async function loadOrderRevenueOverlay() {
    const cid = await getCompanyId();
    const ids = allOrders.map(row => row.id).filter(Boolean);
    if (!ids.length) return;

    const { data, error } = await client
      .from("order_lines")
      .select(`
        id,
        order_id,
        quantity,
        total_customer_charge,
        total_line_charge,
        line_total_gbp,
        revenue_gbp,
        products (
          id,
          total_customer_charge,
          transport_tariff,
          handling_tariff,
          admin_tariff,
          storage_tariff
        )
      `)
      .eq("company_id", cid)
      .in("order_id", ids);

    if (error) {
      console.warn("[orders.js] Revenue overlay skipped:", error.message);
      return;
    }

    const revenueByOrder = new Map();

    (data || []).forEach(line => {
      const orderId = String(line.order_id || "");
      if (!orderId) return;

const qty =
  toNumber(line.quantity_ordered, 0) ||
  1;

      const direct =
        toNumber(line.total_customer_charge, 0) ||
        toNumber(line.total_line_charge, 0) ||
        toNumber(line.line_total_gbp, 0) ||
        toNumber(line.revenue_gbp, 0);

      const productUnit =
        toNumber(line.products?.total_customer_charge, 0) ||
        (
          toNumber(line.products?.transport_tariff, 0) +
          toNumber(line.products?.handling_tariff, 0) +
          toNumber(line.products?.admin_tariff, 0) +
          toNumber(line.products?.storage_tariff, 0)
        );

      const revenue = direct > 0 ? direct : productUnit * qty;

      revenueByOrder.set(orderId, (revenueByOrder.get(orderId) || 0) + revenue);
    });

    allOrders = allOrders.map(order => ({
      ...order,
      __line_revenue_gbp: revenueByOrder.get(String(order.id)) || 0
    }));
  }

  async function loadRoutes() {
    const cid = await getCompanyId();

    const { data, error } = await client
      .from("routes")
      .select("*")
      .eq("company_id", cid)
      .order("route_date", { ascending: true, nullsFirst: false })
      .order("route_code", { ascending: true });

    if (error) throw error;

    allRoutes = data || [];
  }

  async function loadRouteStops() {
    const cid = await getCompanyId();

    const { data, error } = await client
      .from("route_stops")
      .select("*")
      .eq("company_id", cid)
      .order("route_id", { ascending: true })
      .order("stop_number", { ascending: true, nullsFirst: false })
      .order("stop_sequence", { ascending: true, nullsFirst: false });

    if (error) throw error;

    allStops = data || [];
  }

  function driverOptionsHtml(selectedId = "", firstLabel = "Use vehicle default driver") {
    const selected = String(selectedId || "");

    return [
      `<option value="">${escapeHtml(firstLabel)}</option>`,
      ...driverUsers.map(driver => {
        const id = driver.auth_user_id || driver.id;
        const label = `${getDriverName(driver)}${driver.email && normalize(getDriverName(driver)) !== normalize(driver.email) ? ` · ${driver.email}` : ""}`;

        return `
          <option value="${escapeHtml(id)}" ${String(id) === selected ? "selected" : ""}>
            ${escapeHtml(label)}
          </option>
        `;
      })
    ].join("");
  }

  function vehicleOptionsHtml(selectedId = "", firstLabel = "Auto / no fixed vehicle") {
    const selected = String(selectedId || "");

    return [
      `<option value="">${escapeHtml(firstLabel)}</option>`,
      ...activeVehicles.map(vehicle => {
        const label = [
          vehicle.name || vehicle.vehicle_name || "Vehicle",
          vehicle.vehicle_code || "",
          vehicle.registration || "",
          vehicle.capacity_m3 ? `${formatNumber(vehicle.capacity_m3, 1)} m³` : ""
        ].filter(Boolean).join(" · ");

        return `
          <option value="${escapeHtml(vehicle.id)}" ${String(vehicle.id) === selected ? "selected" : ""}>
            ${escapeHtml(label)}
          </option>
        `;
      })
    ].join("");
  }

  function renderSelects() {
    const manualVehicle = byId("manualVehicleSelect");
    if (manualVehicle) {
      const current = selectedVehicleId || manualVehicle.value || "";
      manualVehicle.innerHTML = vehicleOptionsHtml(current);
      manualVehicle.value = current;
    }

    const manualDriver = byId("manualDriverSelect");
    if (manualDriver) {
      const current = selectedDriverId || manualDriver.value || "";
      manualDriver.innerHTML = driverOptionsHtml(current);
      manualDriver.value = current;
    }

    const date = byId("manualRouteDeliveryDate");
    if (date && !date.value) date.value = selectedPlanningDate;

    const time = byId("manualRouteStartTime");
    if (time && !time.value) time.value = "08:00";
  }

  function sortValue(order, key) {
    if (key === "order") return normalize(order.order_number);
    if (key === "product_owner") return normalize(getProductOwnerName(order));
    if (key === "retailer") return normalize(getRetailerName(order));
    if (key === "city") return normalize(order.delivery_city);
    if (key === "postcode") return normalize(order.delivery_postcode);
    if (key === "colli") return getOrderColli(order);
    if (key === "volume") return getOrderVolume(order);
    if (key === "revenue") return getOrderRevenue(order);
    if (key === "coords") return hasCoordinates(order) ? 1 : 0;
    if (key === "status") return normalize(order.status);
    if (key === "completion") return normalize(getCompletionState(order));
    if (key === "transport") return normalize(order.transport_type);
    if (key === "route") return normalize(getRouteLabel(order.route_id));
    if (key === "driver") return normalize(getOrderDriverName(order));
    if (key === "expected") return getExpectedDelivery(order) ? new Date(getExpectedDelivery(order)).getTime() : 0;
    if (key === "eta") return normalize(getEtaText(order));
    if (key === "requested") return order.requested_delivery_date ? new Date(order.requested_delivery_date).getTime() : 0;
    return normalize(order.order_number);
  }

  function sortOrders() {
    const direction = orderSortState.direction === "desc" ? -1 : 1;

    filteredOrders.sort((a, b) => {
      const av = sortValue(a, orderSortState.key);
      const bv = sortValue(b, orderSortState.key);

      if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;

      return String(av).localeCompare(String(bv), "en", {
        numeric: true,
        sensitivity: "base"
      }) * direction;
    });
  }

  function updateSortIndicators() {
    document.querySelectorAll("[data-sort-indicator]").forEach(el => {
      const key = el.getAttribute("data-sort-indicator");

      el.textContent = key === orderSortState.key
        ? (orderSortState.direction === "asc" ? "▲" : "▼")
        : "";
    });
  }

  function applyFilters() {
  const q = normalize(byId("orderSearch")?.value || "");
  const status = normalize(byId("filterStatus")?.value || "");
  const completion = normalize(byId("filterCompletion")?.value || "");
  const routeFilter = normalize(byId("filterRoute")?.value || "");
  const transport = normalize(byId("filterTransport")?.value || "");
  const hideCompleted = !!byId("toggleHideCompleted")?.checked;
  const coordsOnly = !!byId("toggleOnlyWithCoordinates")?.checked;

  filteredOrders = allOrders.filter(order => {
    if (isDelivered(order)) return false;

    if (q) {
      const haystack = [
        order.order_number,
        order.external_reference,
        order.purchase_order,
        getProductOwnerName(order),
        getRetailerName(order),
        order.delivery_city,
        order.delivery_postcode,
        order.delivery_address_1,
        order.delivery_address_2,
        getOrderDriverName(order)
      ].join(" ").toLowerCase();

      if (!haystack.includes(q)) return false;
    }

    if (status && normalize(order.status) !== status) return false;

    if (completion) {
      const state = getCompletionState(order);
      if (completion === "open" && state !== "open" && state !== "stock_complete") return false;
      if (completion === "stock_complete" && state !== "stock_complete") return false;
      if (completion === "delivered" && state !== "delivered") return false;
      if (completion === "issue" && state !== "issue") return false;
      if (completion === "failed" && state !== "failed") return false;
    }

    if (routeFilter === "planned" && !order.route_id) return false;
    if (routeFilter === "unplanned" && order.route_id) return false;

    if (transport) {
      const value = normalize(order.transport_type || "unassigned");
      if (value !== transport) return false;
    }

    if (hideCompleted && (isDelivered(order) || isIssue(order) || isFailed(order))) return false;
    if (coordsOnly && !hasCoordinates(order)) return false;

    return true;
  });

  Array.from(selectedOrderIds).forEach(id => {
    if (!allOrders.some(row => String(row.id) === String(id))) {
      selectedOrderIds.delete(id);
    }
  });

  sortOrders();
  updateCheckAllState();
  setText("resultsMeta", `${formatNumber(filteredOrders.length)} orders shown`);
}

  function updateCheckAllState() {
    const checkAll = byId("checkAllOrders");
    if (!checkAll) return;

    const visibleIds = filteredOrders.map(row => String(row.id));
    const selectedVisible = visibleIds.filter(id => selectedOrderIds.has(id));

    checkAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    checkAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  }

  function renderKpis() {
  const today = todayIso();

  const futureRoutes = allRoutes.filter(route => {
    const date = getRouteDateValue(route);
    return date && date >= today;
  });

  const futureRouteIds = new Set(
    futureRoutes.map(route => String(route.id))
  );

  const futureStops = allStops.filter(stop =>
    futureRouteIds.has(String(stop.route_id))
  );

  const revenue = futureRoutes.reduce((sum, route) => sum + getRouteRevenue(route), 0);
  const cost = futureRoutes.reduce((sum, route) => sum + getRouteCost(route), 0);
  const result = revenue - cost;
  const margin = revenue ? (result / revenue) * 100 : 0;

  setText("kpiReleasedOrders", formatNumber(allOrders.filter(row => row.planning_release).length));
  setText("kpiCoordsOrders", formatNumber(allOrders.filter(hasCoordinates).length));

  setText("kpiPlannedOrders", formatNumber(futureRoutes.length));
  setText("kpiRoutes", formatNumber(futureRoutes.length));

  setText("kpiStops", formatNumber(futureStops.length));
  setText("kpiRevenue", formatMoney(revenue));
  setText("kpiResult", formatMoney(result));
  setText("kpiMargin", `${formatNumber(margin, 1)}%`);

  setText("kpiDelivered", formatNumber(allOrders.filter(isDelivered).length));
  setText("kpiDeliveryIssues", formatNumber(allOrders.filter(isIssue).length));
  setText("kpiFailedDeliveries", formatNumber(allOrders.filter(isFailed).length));
  setText("kpiSelectedOrders", formatNumber(selectedOrderIds.size));
}

  function renderSelectionSummary() {
    const selectedOrders = [...selectedOrderIds].map(id => getOrderById(id)).filter(Boolean);

    const selectedRevenue = selectedOrders.reduce((sum, row) => sum + getOrderRevenue(row), 0);
    const selectedVolume = selectedOrders.reduce((sum, row) => sum + getOrderVolume(row), 0);
    const selectedColli = selectedOrders.reduce((sum, row) => sum + getOrderColli(row), 0);
    const selectedCompleted = selectedOrders.filter(row => isDelivered(row) || isIssue(row) || isFailed(row)).length;

    setText("selectedOrdersCount", formatNumber(selectedOrders.length));
    setText("selectedRevenue", formatMoney(selectedRevenue));
    setText("selectedVolume", `${formatNumber(selectedVolume, 2)} m³`);
    setText("selectedColli", formatNumber(selectedColli));
    setText("selectedCompletedCount", formatNumber(selectedCompleted));
    setText("selectedDeliveryDate", formatDate(getManualRouteDeliveryDate()));

    if (!selectedVehicleId) {
      setText("selectedVehicleName", "Auto");
    } else {
      const vehicle = activeVehicles.find(row => String(row.id) === String(selectedVehicleId));
      setText("selectedVehicleName", vehicle?.name || vehicle?.vehicle_name || "Auto");
    }

    if (!selectedDriverId) setText("selectedDriverName", "Vehicle default");
    else setText("selectedDriverName", getDriverNameById(selectedDriverId) || "Vehicle default");

    renderKpis();
  }

  function renderOrdersTable() {
    const tbody = byId("ordersTableBody");
    if (!tbody) return;

    updateSortIndicators();

    if (!filteredOrders.length) {
      tbody.innerHTML = `<tr><td colspan="18">No orders match the current filters.</td></tr>`;
      updateCheckAllState();
      return;
    }

    tbody.innerHTML = filteredOrders.map(order => {
      const selected = selectedOrderIds.has(String(order.id));

      return `
        <tr data-order-id="${escapeHtml(order.id)}" class="${escapeHtml(rowClass(order))} ${String(selectedOrderId) === String(order.id) ? "active" : ""}">
          <td class="checkbox-cell">
            <input class="order-check" type="checkbox" data-order-id="${escapeHtml(order.id)}" ${selected ? "checked" : ""}/>
          </td>

          <td>
  <strong>${escapeHtml(order.order_number || "—")}</strong>

  ${
    order.external_reference
      ? `<span class="subline">Supplier Ref: ${escapeHtml(order.external_reference)}</span>`
      : ""
  }

  <span class="subline">PO: ${escapeHtml(order.purchase_order || "—")}</span>
</td>

          <td>
            ${escapeHtml(getProductOwnerName(order))}
            <span class="subline">Product owner</span>
          </td>

          <td>
            ${escapeHtml(getRetailerName(order))}
            <span class="subline">${escapeHtml(order.delivery_address_1 || "")}</span>
          </td>

          <td>${escapeHtml(order.delivery_city || "—")}</td>
          <td>${escapeHtml(order.delivery_postcode || "—")}</td>
          <td>${formatNumber(getOrderColli(order))}</td>
          <td>${formatNumber(getOrderVolume(order), 2)} m³</td>
          <td>${formatMoney(getOrderRevenue(order))}</td>

          <td>
            <span class="${hasCoordinates(order) ? "coord-ok" : "coord-missing"}">
              ${hasCoordinates(order) ? "OK" : "Missing"}
            </span>
          </td>

          <td>
            <span class="status-pill ${statusPillClass(order.status)}" ${statusPillStyle(order.status, order)}>
              ${escapeHtml(titleCase(order.status || "—"))}
            </span>
          </td>

          <td>
            <span class="completion-pill ${completionClass(order)}">
              ${escapeHtml(completionLabel(order))}
            </span>
          </td>

          <td>
            <span class="transport-pill ${transportPillClass(order.transport_type)}">
              ${escapeHtml(titleCase(order.transport_type || "unassigned"))}
            </span>
          </td>

          <td>${escapeHtml(getRouteLabel(order.route_id))}</td>
          <td>${escapeHtml(getOrderDriverName(order))}</td>
          <td>${escapeHtml(formatDate(getExpectedDelivery(order)))}</td>
          <td>${escapeHtml(getEtaText(order))}</td>
          <td>${escapeHtml(formatDate(order.requested_delivery_date))}</td>
        </tr>
      `;
    }).join("");

    bindTableEvents();
    updateCheckAllState();
  }

  function bindTableEvents() {
    const tbody = byId("ordersTableBody");
    if (!tbody) return;

    tbody.querySelectorAll("tr[data-order-id]").forEach(row => {
      row.addEventListener("click", event => {
        if (event.target.closest("input")) return;
        selectedOrderId = row.dataset.orderId;
        renderOrdersTable();
        renderMap();
      });
    });

    tbody.querySelectorAll(".order-check").forEach(input => {
      input.addEventListener("click", event => event.stopPropagation());

      input.addEventListener("change", () => {
        const id = String(input.dataset.orderId);

        if (input.checked) selectedOrderIds.add(id);
        else selectedOrderIds.delete(id);

        renderSelectionSummary();
        renderOrdersTable();
        renderMap();
        notifySelectionChanged();
      });
    });
  }

  function renderAll() {
	updatePlanningDateHeader();
    applyFilters();
    renderKpis();
    renderSelectionSummary();
    renderOrdersTable();
    renderMap();
    notifyDataChanged();
  }

  function renderMap() {
    window.ordersMapRows = filteredOrders.filter(order => {
  if (!order.route_id) return true;

  const route = getRouteById(order.route_id);
  return getRouteDateValue(route) === selectedPlanningDate;
});
   const selectedDateRoutes = allRoutes.filter(route =>
  getRouteDateValue(route) === selectedPlanningDate
);

const selectedDateRouteIds = new Set(
  selectedDateRoutes.map(route => String(route.id))
);

const selectedDateStops = allStops.filter(stop =>
  selectedDateRouteIds.has(String(stop.route_id))
);

window.allRouteStopsMapRows = selectedDateStops;
window.visibleRoutesMapRows = selectedDateRoutes;
    window.activeVehiclesMapRows = activeVehicles;
    window.selectedOrderIdsForMap = [...selectedOrderIds];
    window.selectedRouteIdForMap = null;
    window.orderMapFilters = {
      ownTransportOnly: normalize(byId("filterTransport")?.value || "") === "own_transport",
      charterOnly: normalize(byId("filterTransport")?.value || "") === "charter"
    };

    if (window.OrdersMap?.reload) window.OrdersMap.reload();
    else if (typeof window.reloadOrdersMap === "function") window.reloadOrdersMap();
  }

  function notifyDataChanged() {
    window.ordersMapRows = filteredOrders;
    window.allRouteStopsMapRows = allStops;
    window.activeVehiclesMapRows = activeVehicles;
    window.selectedOrderIdsForMap = [...selectedOrderIds];

const planningOrders = allOrders.filter(order => {
  if (normalize(order.transport_type) !== "charter") {
    return true;
  }

  const planningDate =
    order.planned_route_date ||
    order.expected_delivery_date ||
    "";

  return (
    !planningDate ||
    planningDate === selectedPlanningDate
  );
});

const filteredPlanningOrders = filteredOrders.filter(order => {
  if (normalize(order.transport_type) !== "charter") {
    return true;
  }

  const planningDate =
    order.planned_route_date ||
    order.expected_delivery_date ||
    "";

  return (
    !planningDate ||
    planningDate === selectedPlanningDate
  );
});

window.VeynorPlannerData = {
  companyId,
  allOrders: planningOrders,
  filteredOrders: filteredPlanningOrders,
      allRoutes,
      allStops,
      activeVehicles,
      driverUsers,
      selectedOrderIds: [...selectedOrderIds],
      selectedVehicleId,
      selectedDriverId,
      selectedPlanningDate
    };

    window.dispatchEvent(new CustomEvent("veynor:planner-data-changed", {
      detail: window.VeynorPlannerData
    }));
  }

  function notifySelectionChanged() {
    window.VeynorPlannerSelection = {
      selectedOrderIds: [...selectedOrderIds],
      selectedVehicleId,
      selectedDriverId,
      selectedPlanningDate,
      selectedOrders: [...selectedOrderIds].map(id => getOrderById(id)).filter(Boolean)
    };

    window.dispatchEvent(new CustomEvent("veynor:planner-selection-changed", {
      detail: window.VeynorPlannerSelection
    }));
  }

async function refreshAll() {
  await loadDepotSettings();
  await loadProductOwnerProfiles();
  await loadDrivers();
  await loadActiveVehicles();
  await loadRoutes();
  await loadRouteStops();
  await loadStoredDeliveryGroups();
  await loadOrders();

    renderSelects();
    renderAll();

    if (window.VeynorAvailableVehicles?.refresh) {
      window.VeynorAvailableVehicles.refresh();
    }
  }

function closePlanningModal() {
  const modal = byId("planningConfirmModal");
  if (modal) modal.remove();
}

function openCarrierConfirmModal() {
  const selectedIds = [...selectedOrderIds];

  if (!selectedIds.length) {
    showToast("Select at least one order first.", "err");
    return;
  }

  const vehicle = activeVehicles.find(v => String(v.id) === String(selectedVehicleId));

  if (!vehicle) {
    showToast("Select FDS / carrier first.", "err");
    return;
  }

  const selectedOrders = selectedIds
    .map(id => getOrderById(id))
    .filter(Boolean);

  const volume = selectedOrders.reduce((sum, order) => sum + getOrderVolume(order), 0);
  const colli = selectedOrders.reduce((sum, order) => sum + getOrderColli(order), 0);
  const revenue = selectedOrders.reduce((sum, order) => sum + getOrderRevenue(order), 0);

  closePlanningModal();

  const modal = document.createElement("div");
  modal.id = "planningConfirmModal";

  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="width:min(560px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.32);overflow:hidden;">
        
        <div style="padding:18px 20px;border-bottom:1px solid var(--border);background:#f8fafc;">
          <h2 style="margin:0;font-size:18px;font-weight:950;">Confirm Carrier Assignment</h2>
          <p style="margin:6px 0 0;color:var(--muted);font-size:12.5px;">
            Assign selected orders to ${escapeHtml(vehicle.name || vehicle.vehicle_name || "carrier")} without creating a route.
          </p>
        </div>

        <div style="padding:18px 20px;display:grid;gap:14px;">
          <div class="field">
            <label>Carrier Collection / Delivery Date</label>
            <input id="modalCarrierDate" class="input" type="date" value="${escapeHtml(getManualRouteDeliveryDate())}">
          </div>

          <div style="border:1px solid var(--border);border-radius:14px;padding:14px;background:#fbfdff;display:grid;gap:8px;">
            <strong>${escapeHtml(vehicle.name || vehicle.vehicle_name || "FDS")}</strong>
            <div>Action: <strong>Assign to carrier only</strong></div>
            <div>Route creation: <strong style="color:#dc2626;">No route will be created</strong></div>
            <div>Status after confirmation: <strong>Export for Charter</strong></div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            <div class="mini-card">
              <div class="mini-label">Orders</div>
              <div class="mini-value">${formatNumber(selectedOrders.length)}</div>
            </div>
            <div class="mini-card">
              <div class="mini-label">Colli</div>
              <div class="mini-value">${formatNumber(colli)}</div>
            </div>
            <div class="mini-card">
              <div class="mini-label">Volume</div>
              <div class="mini-value">${formatNumber(volume, 2)} m³</div>
            </div>
          </div>

          <div class="mini-card">
            <div class="mini-label">Revenue</div>
            <div class="mini-value">${formatMoney(revenue)}</div>
          </div>
        </div>

        <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;background:#fff;">
          <button id="modalCancelPlanning" class="planner-btn" type="button">Cancel</button>
          <button id="modalConfirmCarrier" class="planner-btn primary" type="button">Assign to Carrier</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  byId("modalCancelPlanning")?.addEventListener("click", closePlanningModal);

  byId("modalConfirmCarrier")?.addEventListener("click", async () => {
    const date = byId("modalCarrierDate")?.value || getManualRouteDeliveryDate();

    const dateInput = byId("manualRouteDeliveryDate");
    if (dateInput) dateInput.value = date;

    selectedPlanningDate = date;

    closePlanningModal();

    await assignSelectedToCarrierNoRoute(date);
  });
}

async function openPlanningConfirmModal() {
  const selectedIds = [...selectedOrderIds];

  if (!selectedIds.length) {
    showToast("Select at least one order first.", "err");
    return;
  }

  const selectedOrders = selectedIds
    .map(id => getOrderById(id))
    .filter(Boolean);

  const vehicle = activeVehicles.find(v => String(v.id) === String(selectedVehicleId));

  const volume = selectedOrders.reduce((sum, order) => sum + getOrderVolume(order), 0);
  const colli = selectedOrders.reduce((sum, order) => sum + getOrderColli(order), 0);
  const revenue = selectedOrders.reduce((sum, order) => sum + getOrderRevenue(order), 0);

  const capacity = vehicle
    ? toNumber(vehicle.capacity_m3 ?? vehicle.max_volume_m3 ?? vehicle.volume_capacity_m3, 0)
    : 0;

  const remaining = capacity - volume;
  const fillPct = capacity ? (volume / capacity) * 100 : 0;

  closePlanningModal();

  const modal = document.createElement("div");
  modal.id = "planningConfirmModal";
  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="width:min(560px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.32);overflow:hidden;">
        
        <div style="padding:18px 20px;border-bottom:1px solid var(--border);background:#f8fafc;">
          <h2 style="margin:0;font-size:18px;font-weight:950;">Confirm Route Planning</h2>
          <p style="margin:6px 0 0;color:var(--muted);font-size:12.5px;">
            Check date, time and vehicle capacity before creating the route.
          </p>
        </div>

        <div style="padding:18px 20px;display:grid;gap:14px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="field">
              <label>Route Date</label>
              <input id="modalRouteDate" class="input" type="date" value="${escapeHtml(getManualRouteDeliveryDate())}">
            </div>

            <div class="field">
              <label>Start Time</label>
              <input id="modalRouteStartTime" class="input" type="time" value="${escapeHtml(getManualRouteStartTime())}">
            </div>
          </div>

          <div style="border:1px solid var(--border);border-radius:14px;padding:14px;background:#fbfdff;display:grid;gap:8px;">
            <strong>${escapeHtml(vehicle ? (vehicle.name || vehicle.vehicle_name || "Vehicle") : "No vehicle selected")}</strong>

            <div>Capacity: <strong>${capacity ? formatNumber(capacity, 2) + " m³" : "Unknown"}</strong></div>
            <div>Selected volume: <strong>${formatNumber(volume, 2)} m³</strong></div>
            <div>
              ${
                capacity
                  ? remaining >= 0
                    ? `Remaining: <strong style="color:#16a34a;">${formatNumber(remaining, 2)} m³</strong>`
                    : `Over capacity: <strong style="color:#dc2626;">${formatNumber(Math.abs(remaining), 2)} m³</strong>`
                  : `<strong style="color:#dc2626;">No vehicle capacity found</strong>`
              }
            </div>
            <div>Fill rate: <strong>${capacity ? formatNumber(fillPct, 1) + "%" : "—"}</strong></div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            <div class="mini-card">
              <div class="mini-label">Orders</div>
              <div class="mini-value">${formatNumber(selectedOrders.length)}</div>
            </div>
            <div class="mini-card">
              <div class="mini-label">Colli</div>
              <div class="mini-value">${formatNumber(colli)}</div>
            </div>
            <div class="mini-card">
              <div class="mini-label">Revenue</div>
              <div class="mini-value">${formatMoney(revenue)}</div>
            </div>
          </div>

          ${
            capacity && remaining < 0
              ? `<div class="notice err" style="display:block;">Warning: selected volume is over vehicle capacity.</div>`
              : ""
          }
        </div>

        <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;background:#fff;">
          <button id="modalCancelPlanning" class="planner-btn" type="button">Cancel</button>
          <button id="modalConfirmPlanning" class="planner-btn primary" type="button">Create Route</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  byId("modalCancelPlanning")?.addEventListener("click", closePlanningModal);

  byId("modalConfirmPlanning")?.addEventListener("click", async () => {
    const date = byId("modalRouteDate")?.value || todayIso();
    const time = byId("modalRouteStartTime")?.value || "08:00";

    const dateInput = byId("manualRouteDeliveryDate");
    const timeInput = byId("manualRouteStartTime");

    if (dateInput) dateInput.value = date;
    if (timeInput) timeInput.value = time;

    selectedPlanningDate = date;

    closePlanningModal();

    renderSelectionSummary();
    notifySelectionChanged();
    notifyDataChanged();

    await planSelectedOrders();
  });
}

  async function planSelectedOrders() {
    try {
      const selectedIds = [...selectedOrderIds];

      if (!selectedIds.length) {
        showToast("Select at least one order first.", "err");
        return;
      }

      if (!window.VeynorPlanningEngine?.planRoutes && !window.PlanningEngine?.run) {
        showToast("Planning engine is not loaded.", "err");
        return;
      }

      showToast("Planning selected orders...", "ok");

      const planner = window.VeynorPlanningEngine?.planRoutes || window.PlanningEngine.run;

      const result = await planner({
        order_ids: selectedIds,
        preferred_vehicle_id: selectedVehicleId || null,
        vehicle_id: selectedVehicleId || null,
        driver_user_id: selectedDriverId || null,
        route_delivery_date: getManualRouteDeliveryDate(),
        planned_delivery_date: getManualRouteDeliveryDate(),
        planned_start_time: getManualRouteStartTime(),
        start_time: getManualRouteStartTime(),
        finalize_eta: getManualFinalizeEta(),
        eta_finalized: getManualFinalizeEta()
      });

      log("Planning result:", result);

      selectedOrderIds.clear();
      selectedOrderId = null;

      await refreshAll();

      showToast(result?.message || "Selected orders planned.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Planning failed.", "err");
    }
  }

async function exportSelectedForCharter() {
  try {
    const selectedIds = [...selectedOrderIds];

    if (!selectedIds.length) {
      showToast("Select at least one order first.", "err");
      return;
    }

    if (!selectedVehicleId) {
      showToast("Select FDS / carrier first.", "err");
      return;
    }

    await assignSelectedToCarrierNoRoute(
      getManualRouteDeliveryDate()
    );
  } catch (error) {
    console.error(error);

    showToast(
      error.message ||
      "Could not export selected orders for charter.",
      "err"
    );
  }
}

function isSelectedVehicleCarrier() {
  const vehicle = activeVehicles.find(
    row =>
      String(row.id) ===
      String(selectedVehicleId)
  );

  return normalize(
    vehicle?.vehicle_type ||
    vehicle?.type
  ) === "carrier";
}
async function assignSelectedToCarrierNoRoute(carrierDate = null) {
  try {
    const selectedIds = [...selectedOrderIds];

    if (!selectedIds.length) {
      showToast("Select at least one order first.", "err");
      return;
    }

    if (!selectedVehicleId) {
      showToast("Select FDS / carrier first.", "err");
      return;
    }

    const vehicle = activeVehicles.find(v =>
      String(v.id) === String(selectedVehicleId)
    );

    if (!vehicle || normalize(vehicle.vehicle_type || vehicle.type) !== "carrier") {
      showToast("Selected resource is not a carrier.", "err");
      return;
    }

    const cid = await getCompanyId();
    const date = carrierDate || getManualRouteDeliveryDate();

    const { error } = await client
      .from("orders")
      .update({
        transport_type: "charter",
        status: "export_for_charter",
        route_id: null,
        carrier_vehicle_id: selectedVehicleId,
        transport_status: "export_for_charter",
planned_route_date: date || null,
fds_collection_date: date || null,

expected_delivery_date: null,
confirmed_delivery_date: null,
        driver_user_id: null,
        driver_profile_id: null,
        driver_name: null,
        driver_email: null,
        delivery_eta_from: null,
        delivery_eta_to: null,
        delivery_eta_status: "carrier",
        last_activity_at: new Date().toISOString()
      })
      .eq("company_id", cid)
      .in("id", selectedIds);

    if (error) throw error;

    selectedOrderIds.clear();
    selectedOrderId = null;

    await refreshAll();

    showToast(
      `Selected orders assigned to ${vehicle.name || vehicle.vehicle_name || "carrier"} without route.`,
      "ok"
    );
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not assign orders to carrier.", "err");
  }
}
function getRouteDateValue(route) {
  return route?.planned_delivery_date || route?.route_date || "";
}

function getRoutesForPlanningDate(date) {
  return allRoutes.filter(route => getRouteDateValue(route) === date);
}

function getOrdersForRoute(route) {
  const routeId = String(route?.id || "");

  const orderIds = allStops
    .filter(stop => String(stop.route_id) === routeId)
    .map(stop => String(stop.order_id || ""))
    .filter(Boolean);

  return orderIds
    .map(id => getOrderById(id))
    .filter(Boolean);
}

function getRouteWarehouseCost(route) {
  const orders = getOrdersForRoute(route);

  const colli = orders.reduce((sum, order) => sum + getOrderColli(order), 0);
  const volume = orders.reduce((sum, order) => sum + getOrderVolume(order), 0);

  const handlingIn = colli * warehouseCostSettings.handlingInPerColli;
  const handlingOut = colli * warehouseCostSettings.handlingOutPerColli;
  const storage = volume * warehouseCostSettings.storagePerM3;
  const vas = 0;

  return handlingIn + handlingOut + storage + vas;
}

function getRouteCost(route) {
  const transportCost = Math.max(
    toNumber(route?.estimated_cost_total_gbp, 0),
    toNumber(route?.total_cost_gbp, 0)
  );

  return transportCost + getRouteWarehouseCost(route);
}

function getRouteRevenue(route) {
  const routeRevenue = Math.max(
    toNumber(route?.estimated_revenue_gbp, 0),
    toNumber(route?.total_revenue_gbp, 0),
    toNumber(route?.revenue_gbp, 0)
  );

  if (routeRevenue > 0) return routeRevenue;

  const routeOrders = allStops
    .filter(stop => String(stop.route_id) === String(route.id))
    .map(stop => getOrderById(stop.order_id))
    .filter(Boolean);

  return routeOrders.reduce((sum, order) => sum + getOrderRevenue(order), 0);
}

function getRouteVolume(route) {
  return Math.max(
    toNumber(route?.planned_volume_m3, 0),
    toNumber(route?.total_volume_m3, 0)
  );
}

function updatePlanningDateHeader() {
  const routes = getRoutesForPlanningDate(selectedPlanningDate);

  const revenue = routes.reduce((sum, route) => sum + getRouteRevenue(route), 0);
  const cost = routes.reduce((sum, route) => sum + getRouteCost(route), 0);
  const result = revenue - cost;
  const volume = routes.reduce((sum, route) => sum + getRouteVolume(route), 0);

  setText("planningDateLabel", formatDate(selectedPlanningDate));
  setText("planningRoutesCount", formatNumber(routes.length));
  setText("planningRevenue", formatMoney(revenue));
  setText("planningCost", formatMoney(cost));
  setText("planningResult", formatMoney(result));

  const volumeEl = byId("planningVolume");
  if (volumeEl) volumeEl.textContent = `${formatNumber(volume, 2)} m³`;
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

function closeReplanRouteModal() {
  const modal = byId("replanRouteModal");
  if (modal) modal.remove();
}

function askRecalculateRoute(routeId) {
  openReplanRouteModal(routeId);
}

function openReplanRouteModal(routeId) {
  const route = getRouteById(routeId);

  if (!route) {
    showToast("Route not found.", "err");
    return;
  }

  closeReplanRouteModal();

  const beforeMiles = toNumber(route.estimated_distance_miles, 0);
  const beforeCost = getRouteCost(route);
  const beforeHours = toNumber(route.estimated_total_hours, 0);
  const beforeResult = getRouteRevenue(route) - beforeCost;

  const modal = document.createElement("div");
  modal.id = "replanRouteModal";
  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="width:min(620px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.32);overflow:hidden;">
        
        <div style="padding:18px 20px;border-bottom:1px solid var(--border);background:#f8fafc;">
          <h2 style="margin:0;font-size:18px;font-weight:950;">Replan Route?</h2>
          <p id="replanStatusText" style="margin:6px 0 0;color:var(--muted);font-size:12.5px;">
            Recalculate stop order, ETA, miles and costs.
          </p>
        </div>

        <div style="padding:18px 20px;display:grid;gap:12px;">
          <div class="mini-card">
            <div class="mini-label">Route</div>
            <div class="mini-value">${escapeHtml(getRouteLabel(routeId))}</div>
          </div>

          <div id="replanProgressWrap" style="display:none;width:100%;height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
            <div id="replanProgressBar" style="width:0%;height:100%;background:#2563eb;transition:width .35s ease;"></div>
          </div>

          <div id="replanResultBox" style="display:none;border:1px solid var(--border);border-radius:14px;padding:14px;background:#fbfdff;line-height:1.8;"></div>
        </div>

        <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;background:#fff;">
          <button id="modalSkipReplan" class="planner-btn" type="button">Skip</button>
          <button id="modalConfirmReplan" class="planner-btn primary" type="button">Replan Route</button>
          <button id="modalCloseReplan" class="planner-btn primary" type="button" style="display:none;">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const skipBtn = byId("modalSkipReplan");
  const confirmBtn = byId("modalConfirmReplan");
  const closeBtn = byId("modalCloseReplan");
  const statusText = byId("replanStatusText");
  const progressWrap = byId("replanProgressWrap");
  const progressBar = byId("replanProgressBar");
  const resultBox = byId("replanResultBox");

  skipBtn?.addEventListener("click", async () => {
    closeReplanRouteModal();
    await refreshAll();
    showToast("Orders added. Route was not replanned.", "ok");
  });

  closeBtn?.addEventListener("click", async () => {
    closeReplanRouteModal();
    await refreshAll();
  });

  confirmBtn?.addEventListener("click", async () => {
    try {
      if (!window.VeynorPlanningEngine?.replanExistingRoute) {
        showToast("Planning Engine replan function is not loaded.", "err");
        return;
      }

      skipBtn.style.display = "none";
      confirmBtn.style.display = "none";
      progressWrap.style.display = "block";
      progressBar.style.width = "35%";
      statusText.textContent = "Replanning route...";

      const result = await window.VeynorPlanningEngine.replanExistingRoute({
        route_id: routeId,
        finalize_eta: true
      });

      progressBar.style.width = "100%";
      statusText.textContent = "Route replanned successfully.";

      const after = result?.after || {};
      const diff = result?.difference || {};

      const afterMiles = toNumber(after.miles, beforeMiles);
   const oldCost = toNumber(result?.before?.cost, beforeCost);
const newCost = toNumber(result?.after?.cost, beforeCost);
const costDiff = newCost - oldCost;

const afterHours = toNumber(after.hours, beforeHours);

const afterResult = beforeResult - costDiff;

      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <strong>Replan result</strong>

        <div>Miles: <strong>${formatNumber(beforeMiles, 2)}</strong> → <strong>${formatNumber(afterMiles, 2)}</strong> 
          <span>${formatSignedNumber(diff.miles)}</span>
        </div>

        <div>Hours: <strong>${formatNumber(beforeHours, 2)}</strong> → <strong>${formatNumber(afterHours, 2)}</strong> 
          <span>${formatSignedNumber(diff.hours)}</span>
        </div>

        <div>Cost: <strong>${formatMoney(oldCost)}</strong> → <strong>${formatMoney(newCost)}</strong> 
  <span>${formatSignedMoney(costDiff)}</span>
</div>

        <div>Result: <strong>${formatMoney(beforeResult)}</strong> → <strong>${formatMoney(afterResult)}</strong></div>
      `;

      closeBtn.style.display = "inline-flex";
      showToast(result?.message || "Route replanned.", "ok");
    } catch (error) {
      console.error(error);

      progressBar.style.width = "100%";
      statusText.textContent = "Replan failed.";

      resultBox.style.display = "block";
      resultBox.innerHTML = `
        <strong style="color:#b91c1c;">${escapeHtml(error.message || "Could not replan route.")}</strong>
      `;

      closeBtn.style.display = "inline-flex";
      showToast(error.message || "Could not replan route.", "err");
    }
  });
}

function formatSignedNumber(value) {
  const n = Number(value || 0);
  if (n > 0) return `(+${formatNumber(n, 2)})`;
  if (n < 0) return `(${formatNumber(n, 2)})`;
  return `(0.00)`;
}

function formatSignedMoney(value) {
  const n = Number(value || 0);
  if (n > 0) return `(+${formatMoney(n)})`;
  if (n < 0) return `(-${formatMoney(Math.abs(n))})`;
  return `(£0.00)`;
}
async function addSelectedOrdersToExistingRoute(routeId) {
  try {
    const selectedIds = [...selectedOrderIds];

    if (!selectedIds.length) {
      showToast("Select one or more orders first.", "err");
      return;
    }

    if (!routeId) {
      showToast("Route not found.", "err");
      return;
    }

    const cid = await getCompanyId();
    const route = getRouteById(routeId);

    if (!route) {
      showToast("Route not found in planner data.", "err");
      return;
    }

    const existingStops = allStops.filter(stop =>
      String(stop.route_id) === String(routeId)
    );

    const existingOrderIds = new Set(
      existingStops.map(stop => String(stop.order_id))
    );

    const ordersToAdd = selectedIds
      .map(id => getOrderById(id))
      .filter(Boolean)
      .filter(order => !existingOrderIds.has(String(order.id)));

    if (!ordersToAdd.length) {
      showToast("Selected orders are already on this route.", "err");
      return;
    }

    const maxStop = existingStops.reduce((max, stop) => {
      return Math.max(
        max,
        toNumber(stop.stop_sequence || stop.stop_number, 0)
      );
    }, 0);

const cleanOrdersToAdd = ordersToAdd.filter(order =>
  !existingOrderIds.has(String(order.id))
);

if (!cleanOrdersToAdd.length) {
  showToast("Selected orders are already on this route.", "err");
  return;
}

    const stopRows = cleanOrdersToAdd.map((order, index) => ({
      company_id: cid,
      route_id: routeId,
      order_id: order.id,
      stop_sequence: maxStop + index + 1,
      stop_number: maxStop + index + 1,
      stop_name: getRetailerName(order),
      city: order.delivery_city || null,
      postcode: order.delivery_postcode || null,
      latitude: order.delivery_lat || null,
      longitude: order.delivery_lng || null,
      planned_volume_m3: getOrderVolume(order),
      planned_colli: getOrderColli(order),
      status: "planned"
    }));

    if (stopRows.length) {
  const { error: stopError } = await client
    .from("route_stops")
    .insert(stopRows);

  if (stopError) throw stopError;
}

    const routeDate = getRouteDateValue(route);

    const { error: orderError } = await client
      .from("orders")
      .update({
        route_id: routeId,
        status: "planned",
        transport_status: "planned",
        transport_type: "own_transport",
        planned_route_date: routeDate || null,
        expected_delivery_date: routeDate || null
      })
      .eq("company_id", cid)
      .in("id", cleanOrdersToAdd.map(order => order.id));

    if (orderError) throw orderError;

   const { data: routeTotals, error: totalsError } = await client
  .from("route_stops")
  .select("planned_volume_m3, planned_colli")
  .eq("company_id", cid)
  .eq("route_id", routeId);

if (totalsError) throw totalsError;

const realStops = (routeTotals || []).length;

const realVolume = (routeTotals || []).reduce(
  (sum, row) => sum + toNumber(row.planned_volume_m3, 0),
  0
);

const realColli = (routeTotals || []).reduce(
  (sum, row) => sum + toNumber(row.planned_colli, 0),
  0
);

const allRouteOrders = [
  ...existingStops
    .map(stop => getOrderById(stop.order_id))
    .filter(Boolean),
  ...cleanOrdersToAdd
];

const realRevenue = allRouteOrders.reduce(
  (sum, order) => sum + getOrderRevenue(order),
  0
);

const realCost = getRouteCost(route);
const realProfit = realRevenue - realCost;

const { error: routeError } = await client
  .from("routes")
  .update({
    total_stops: realStops,
    planned_stops: realStops,
    total_volume_m3: Number(realVolume.toFixed(3)),
    planned_volume_m3: Number(realVolume.toFixed(3)),
    planned_colli: Number(realColli),
    estimated_revenue_gbp: Number(realRevenue.toFixed(2)),
    estimated_profit_gbp: Number(realProfit.toFixed(2))
  })
  .eq("company_id", cid)
  .eq("id", routeId);

if (routeError) throw routeError;

    selectedOrderIds.clear();

    await refreshAll();

await refreshAll();

showToast(`${cleanOrdersToAdd.length} order(s) added to route.`, "ok");
askRecalculateRoute(routeId);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not add orders to route.", "err");
  }
}
  
function openPlanningCalendarModal() {
  const routesByDate = new Map();

  allRoutes.forEach(route => {
    const date = getRouteDateValue(route);
    if (!date) return;

    if (!routesByDate.has(date)) {
      routesByDate.set(date, { routes: 0, volume: 0, revenue: 0, cost: 0 });
    }

    const row = routesByDate.get(date);
    row.routes += 1;
    row.volume += getRouteVolume(route);
    row.revenue += getRouteRevenue(route);
    row.cost += getRouteCost(route);
  });

  const rows = [...routesByDate.entries()]
    .filter(([date]) => date >= todayIso())
    .sort(([a], [b]) => a.localeCompare(b));

  const modal = document.createElement("div");
  modal.id = "planningCalendarModal";
  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="width:min(720px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.32);overflow:hidden;">
        <div style="padding:18px 20px;border-bottom:1px solid var(--border);background:#f8fafc;display:flex;justify-content:space-between;gap:12px;">
          <div>
            <h2 style="margin:0;font-size:18px;font-weight:950;">Planning Calendar</h2>
            <p style="margin:6px 0 0;color:var(--muted);font-size:12.5px;">Future planned routes by day.</p>
          </div>
          <button id="closePlanningCalendar" class="planner-btn" type="button">Close</button>
        </div>

        <div style="padding:14px 20px;max-height:520px;overflow:auto;">
          ${
            rows.length
              ? rows.map(([date, row]) => `
                <button
                  type="button"
                  data-calendar-date="${escapeHtml(date)}"
                  style="width:100%;text-align:left;border:1px solid var(--border);background:#fff;border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer;display:grid;grid-template-columns:1.2fr .7fr .8fr .8fr;gap:10px;align-items:center;"
                >
                  <strong>${escapeHtml(formatDate(date))}</strong>
                  <span>${formatNumber(row.routes)} route(s)</span>
                  <span>${formatNumber(row.volume, 2)} m³</span>
                  <span>${formatMoney(row.revenue - row.cost)}</span>
                </button>
              `).join("")
              : `<div class="notice err" style="display:block;">No future planned routes found.</div>`
          }
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  byId("closePlanningCalendar")?.addEventListener("click", () => modal.remove());

  modal.querySelectorAll("[data-calendar-date]").forEach(button => {
    button.addEventListener("click", () => {
      setPlanningDate(button.dataset.calendarDate);
      modal.remove();
    });
  });
}
    function bindEvents() {
    [
      "orderSearch",
      "filterStatus",
      "filterCompletion",
      "filterRoute",
      "filterTransport",
      "toggleHideCompleted",
      "toggleOnlyWithCoordinates"
    ].forEach(id => {
      const el = byId(id);
      if (!el) return;
      el.addEventListener("input", renderAll);
      el.addEventListener("change", renderAll);
    });

    byId("manualVehicleSelect")?.addEventListener("change", event => {
      selectedVehicleId = event.target.value || "";
      window.pendingPreferredVehicleId = selectedVehicleId;
      renderSelectionSummary();
      notifySelectionChanged();
    });

    byId("manualDriverSelect")?.addEventListener("change", event => {
      selectedDriverId = event.target.value || "";
      renderSelectionSummary();
      notifySelectionChanged();
    });

    byId("manualRouteDeliveryDate")?.addEventListener("change", event => {
      selectedPlanningDate = event.target.value || todayIso();
      renderSelectionSummary();
      notifySelectionChanged();
      notifyDataChanged();
    });

    byId("manualRouteStartTime")?.addEventListener("change", notifySelectionChanged);
    byId("manualFinalizeEta")?.addEventListener("change", notifySelectionChanged);
function setPlanningDate(date) {
  selectedPlanningDate = date || todayIso();

  const dateInput = byId("manualRouteDeliveryDate");
  if (dateInput) dateInput.value = selectedPlanningDate;

  renderAll();

  if (window.VeynorAvailableVehicles?.refresh) {
    window.VeynorAvailableVehicles.refresh();
  }
}

byId("prevPlanningDay")?.addEventListener("click", () => {
  const d = new Date(`${selectedPlanningDate}T12:00:00`);
  d.setDate(d.getDate() - 1);
  setPlanningDate(d.toISOString().slice(0, 10));
});

byId("nextPlanningDay")?.addEventListener("click", () => {
  const d = new Date(`${selectedPlanningDate}T12:00:00`);
  d.setDate(d.getDate() + 1);
  setPlanningDate(d.toISOString().slice(0, 10));
});

byId("todayPlanningBtn")?.addEventListener("click", () => {
  setPlanningDate(todayIso());
});
byId("planningCalendarBtn")?.addEventListener("click", openPlanningCalendarModal);
    byId("checkAllOrders")?.addEventListener("change", event => {
      const checked = !!event.target.checked;

      filteredOrders.forEach(order => {
        const id = String(order.id);
        if (checked) selectedOrderIds.add(id);
        else selectedOrderIds.delete(id);
      });

      renderSelectionSummary();
      renderOrdersTable();
      renderMap();
      notifySelectionChanged();
    });

    byId("btnClearSelection")?.addEventListener("click", () => {
      selectedOrderIds.clear();
      selectedOrderId = null;
      renderSelectionSummary();
      renderOrdersTable();
      renderMap();
      notifySelectionChanged();
      showToast("Selection cleared.", "ok");
    });

    byId("btnRefreshPlanner")?.addEventListener("click", async () => {
      try {
        await refreshAll();
        showToast("Planner refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Refresh failed.", "err");
      }
    });

byId("btnAutoPlanRoutes")?.addEventListener("click", () => {
  if (isSelectedVehicleCarrier()) {
    openCarrierConfirmModal();
    return;
  }

  openPlanningConfirmModal();
});

    byId("btnExportCharter")?.addEventListener("click", exportSelectedForCharter);

    byId("btnFitUkMap")?.addEventListener("click", () => {
      if (window.OrdersMap?.fitUk) window.OrdersMap.fitUk();
      else if (typeof window.fitOrdersMapUk === "function") window.fitOrdersMapUk();
    });

    byId("btnRefreshMap")?.addEventListener("click", renderMap);

    document.querySelectorAll("[data-sort-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort-key");

        if (orderSortState.key === key) {
          orderSortState.direction = orderSortState.direction === "asc" ? "desc" : "asc";
        } else {
          orderSortState.key = key;
          orderSortState.direction = "asc";
        }

        sortOrders();
        renderOrdersTable();
      });
    });

    window.addEventListener("veynor:map-selection-changed", event => {
      const ids = Array.isArray(event.detail?.selectedOrderIds)
        ? event.detail.selectedOrderIds
        : [];

      selectedOrderIds.clear();
      ids.forEach(id => selectedOrderIds.add(String(id)));

      renderSelectionSummary();
      renderOrdersTable();
      notifySelectionChanged();
      notifyDataChanged();
    });

window.addEventListener("veynor:map-send-to-planner", async event => {
  const ids = Array.isArray(event.detail?.selectedOrderIds)
    ? event.detail.selectedOrderIds
    : [];

  selectedOrderIds.clear();
  ids.forEach(id => selectedOrderIds.add(String(id)));

  if (event.detail?.selectedVehicleId) {
    selectedVehicleId = event.detail.selectedVehicleId;
    window.pendingPreferredVehicleId = selectedVehicleId;

    const vehicleSelect = byId("manualVehicleSelect");
    if (vehicleSelect) vehicleSelect.value = selectedVehicleId;
  }

  renderSelectionSummary();
  renderOrdersTable();
  notifySelectionChanged();
  notifyDataChanged();

  if (isSelectedVehicleCarrier()) {
    openCarrierConfirmModal();
    return;
  }

  openPlanningConfirmModal();
});

    window.addEventListener("veynor:vehicle-selected", event => {
  selectedVehicleId = event.detail?.vehicleId || "";
  window.pendingPreferredVehicleId = selectedVehicleId;

  const select = byId("manualVehicleSelect");
  if (select) select.value = selectedVehicleId;

  renderSelectionSummary();
  notifySelectionChanged();
  notifyDataChanged();
});

window.addEventListener("veynor:add-selected-to-route", async event => {
  await addSelectedOrdersToExistingRoute(
    event.detail?.routeId
  );
});

window.addEventListener("veynor:routes-changed", async () => {
  await refreshAll();
});
  }

  async function init() {
    try {
      if (typeof sb !== "function") {
        throw new Error("Supabase helper sb() is not available.");
      }

      client = sb();

      bindEvents();
      await refreshAll();

      showToast("Orders planner loaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not load orders planner.", "err");
    }
  }

  window.VeynorOrdersPlanner = {
    refresh: refreshAll,
    getCompanyId: () => companyId,
    getOrders: () => allOrders,
    getFilteredOrders: () => filteredOrders,
    getRoutes: () => allRoutes,
    getStops: () => allStops,
    getVehicles: () => activeVehicles,
    getDrivers: () => driverUsers,
    getSelectedOrderIds: () => [...selectedOrderIds],
    planSelectedOrders,
    clearSelection: () => {
      selectedOrderIds.clear();
      renderAll();
      notifySelectionChanged();
    },
    selectOrders: ids => {
      selectedOrderIds.clear();
      (ids || []).forEach(id => selectedOrderIds.add(String(id)));
      renderAll();
      notifySelectionChanged();
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();