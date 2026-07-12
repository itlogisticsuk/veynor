(function () {
  "use strict";

  const DEBUG = true;

  let client = null;
  let companyId = null;

  let allOrders = [];
  let filteredOrders = [];
  let allRoutes = [];
  let allStops = [];
  let activeVehicles = [];
  let driverUsers = [];
  let selectedOrderIds = [];
  let selectedPlanningDate = "";
let warehouseCostSettings = {
  handlingInPerColli: 0,
  handlingOutPerColli: 0,
  storagePerM3: 0,
  vasPerColli: 0
};

  const expandedVehicleIds = new Set();
  const expandedRouteIds = new Set();
const signedNoticeOrderIds = new Set();

  let draggedStopId = null;

  function log(...args) {
    if (DEBUG) console.log("[available-vehicles.js]", ...args);
  }

  function byId(id) {
    return document.getElementById(id);
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

    el.textContent = message || "";
    el.className = `notice ${type}`;

    clearTimeout(window.__availableVehiclesToastTimer);
    window.__availableVehiclesToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6500);
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    client = sb();
    return client;
  }

  function getCompanyId() {
    if (companyId) return companyId;

    companyId =
      window.VeynorPlannerData?.companyId ||
      window.VeynorOrdersPlanner?.getCompanyId?.() ||
      null;

    return companyId;
  }

  function getVehicleName(vehicle) {
    return (
      vehicle?.name ||
      vehicle?.vehicle_name ||
      vehicle?.registration ||
      vehicle?.vehicle_code ||
      "Vehicle"
    );
  }

  function getVehicleRegistration(vehicle) {
    return (
      vehicle?.registration ||
      vehicle?.vehicle_registration ||
      vehicle?.vehicle_code ||
      vehicle?.code ||
      "—"
    );
  }

  function getVehicleType(vehicle) {
    return vehicle?.vehicle_type || vehicle?.type || "vehicle";
  }

  function getVehicleCapacity(vehicle) {
    return Math.max(
      toNumber(vehicle?.capacity_m3, 0),
      toNumber(vehicle?.max_volume_m3, 0),
      toNumber(vehicle?.volume_capacity_m3, 0)
    );
  }

  function getDriverById(driverId) {
    if (!driverId) return null;

    return driverUsers.find(driver =>
      String(driver.id) === String(driverId) ||
      String(driver.auth_user_id) === String(driverId) ||
      String(driver.profile_id) === String(driverId)
    ) || null;
  }

  function getDriverName(driver) {
    return driver?.full_name || driver?.email || "Driver";
  }

  function getDriverEmail(driver) {
    return driver?.email || "";
  }

  function getDriverNameById(driverId) {
    const driver = getDriverById(driverId);
    return driver ? getDriverName(driver) : "";
  }

  function getDriverEmailById(driverId) {
    const driver = getDriverById(driverId);
    return driver ? getDriverEmail(driver) : "";
  }

  function getRouteDriverId(route) {
    return route?.driver_user_id || route?.driver_profile_id || "";
  }

  function getRouteDriverName(route) {
    return route?.driver_name || getDriverNameById(getRouteDriverId(route)) || "No driver";
  }

  function getRouteLabel(route) {
    return (
      route?.route_code ||
      route?.route_number ||
      route?.route_name ||
      route?.name ||
      "Route"
    );
  }

  function getRouteDate(route) {
    return route?.planned_delivery_date || route?.route_date || "";
  }

  function getOrderById(orderId) {
    return allOrders.find(order => String(order.id) === String(orderId)) || null;
  }

  function getStopsForRoute(routeId) {
    return allStops
      .filter(stop => String(stop.route_id) === String(routeId))
      .sort((a, b) =>
        toNumber(a.stop_sequence || a.stop_number, 0) -
        toNumber(b.stop_sequence || b.stop_number, 0)
      );
  }

  function getOrdersForRoute(routeId) {
    return getStopsForRoute(routeId)
      .map(stop => getOrderById(stop.order_id))
      .filter(Boolean);
  }

  function getRoutesForVehicle(vehicle) {
    if (!vehicle) return [];

    return allRoutes.filter(route => {
      const routeDate = getRouteDate(route);

      if (selectedPlanningDate && routeDate && routeDate !== selectedPlanningDate) {
        return false;
      }

      return (
        String(route.vehicle_id || "") === String(vehicle.id) ||
        String(route.assigned_vehicle_id || "") === String(vehicle.id) ||
        normalize(route.vehicle_name || "") === normalize(getVehicleName(vehicle)) ||
        normalize(route.assigned_vehicle_name || "") === normalize(getVehicleName(vehicle)) ||
        normalize(route.vehicle_registration || "") === normalize(getVehicleRegistration(vehicle))
      );
    });
  }

  function getPrimaryRouteForVehicle(vehicle) {
    const routes = getRoutesForVehicle(vehicle);
    if (!routes.length) return null;

    return routes
      .slice()
      .sort((a, b) => {
        const ad = String(getRouteDate(a) || "");
        const bd = String(getRouteDate(b) || "");
        return ad.localeCompare(bd);
      })[0];
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

  function getOrderVolume(order) {
    return toNumber(order?.planning_volume_m3 ?? order?.volume_m3, 0);
  }

  function getOrderColli(order) {
    return toNumber(order?.planning_colli, 0);
  }

function getOrderWeight(order) {
  const storedWeight =
    toNumber(order?.total_order_weight_kg, 0) ||
    toNumber(order?.weight_kg, 0);

  if (storedWeight > 0) {
    return storedWeight;
  }

  const lines = Array.isArray(order?.order_lines)
    ? order.order_lines
    : [];

  return lines.reduce((sum, line) => {
    const quantity = Math.max(
      0,
      toNumber(line?.quantity_ordered, 0)
    );

    const lineWeight =
      toNumber(line?.total_line_weight_kg, 0) ||
      (
        toNumber(line?.unit_weight_kg, 0) *
        quantity
      ) ||
      (
        toNumber(line?.products?.weight_kg, 0) *
        quantity
      ) ||
      (
        toNumber(line?.products?.net_weight_kg, 0) *
        quantity
      );

    return sum + lineWeight;
  }, 0);
}

  function getRetailerName(order, stop = null) {
    return (
      order?.retailer_name ||
      order?.retail_name ||
      order?.shop_name ||
      order?.delivery_name ||
      order?.recipient_name ||
      stop?.stop_name ||
      stop?.city ||
      "—"
    );
  }

function getProductOwnerDisplayCode(order) {
  const code = String(
    order?.product_owner_display_code ||
    order?.product_owner_code ||
    ""
  )
    .trim()
    .toUpperCase();

  return code || "—";
}

function getCustomerOrderLabel(order) {
  const po = order?.purchase_order ? `PO ${order.purchase_order}` : "";
  const ref = order?.external_reference ? `Ref ${order.external_reference}` : "";

  return [po, ref].filter(Boolean).join(" · ");
}

  function getRouteSummary(route) {
  const stops = getStopsForRoute(route.id);
  const orders = getOrdersForRoute(route.id);

  const totalStops =
    stops.length ||
    toNumber(route?.planned_stops, 0) ||
    toNumber(route?.total_stops, 0);

  const totalOrders =
    orders.length ||
    toNumber(route?.planned_orders, 0);

  const totalVolume =
    stops.reduce((sum, stop) => sum + toNumber(stop.planned_volume_m3, 0), 0) ||
    orders.reduce((sum, order) => sum + getOrderVolume(order), 0) ||
    toNumber(route?.planned_volume_m3 ?? route?.total_volume_m3, 0);

  const totalColli =
    stops.reduce((sum, stop) => sum + toNumber(stop.planned_colli, 0), 0) ||
    orders.reduce((sum, order) => sum + getOrderColli(order), 0);

  const distanceKm =
    toNumber(route?.estimated_distance_km, 0) ||
    toNumber(route?.planned_distance_km, 0);

  const distanceMiles =
    toNumber(route?.estimated_distance_miles, 0) ||
    distanceKm * 0.621371;

  const totalHours =
    toNumber(route?.estimated_total_hours, 0) ||
    (
      toNumber(route?.estimated_drive_hours, 0) +
      toNumber(route?.estimated_service_hours, 0)
    );

  const revenue =
    toNumber(route?.estimated_revenue_gbp, 0) ||
    orders.reduce((sum, order) => sum + getOrderRevenue(order), 0);

  const fuelCost = toNumber(route?.estimated_cost_fuel_gbp, 0);
  const fuelLitres = toNumber(route?.estimated_fuel_litres, 0);

  const transportCost =
    toNumber(route?.estimated_cost_total_gbp, 0) ||
    toNumber(route?.total_cost_gbp, 0);

const warehouseCost =
  toNumber(route?.estimated_cost_warehouse_gbp, 0) ||
  getRouteWarehouseCost(route);

const cost = transportCost;
  const result = revenue - cost;

  return {
    totalStops,
    totalOrders,
    totalVolume,
    totalColli,
    distanceKm,
    distanceMiles,
    totalHours,
    fuelCost,
    fuelLitres,
    transportCost,
    warehouseCost,
    revenue,
    cost,
    result
  };
}

function getRouteWarehouseCost(route) {

  const orders = getOrdersForRoute(route.id);

  const colli = orders.reduce(
    (sum, order) => sum + getOrderColli(order),
    0
  );

  const volume = orders.reduce(
    (sum, order) => sum + getOrderVolume(order),
    0
  );

  return (
    (colli * warehouseCostSettings.handlingInPerColli) +
    (colli * warehouseCostSettings.handlingOutPerColli) +
    (volume * warehouseCostSettings.storagePerM3)
  );
}

  function getSelectedOrdersSummary() {
    const orders = selectedOrderIds
      .map(id => getOrderById(id))
      .filter(Boolean);

    return {
      orders,
      count: orders.length,
      volume: orders.reduce((sum, order) => sum + getOrderVolume(order), 0),
      colli: orders.reduce((sum, order) => sum + getOrderColli(order), 0)
    };
  }

  function driverOptionsHtml(selectedId = "") {
    const selected = String(selectedId || "");

    return [
      `<option value="">No driver assigned</option>`,
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

  function vehicleOptionsHtml(selectedId = "") {
    const selected = String(selectedId || "");

    return [
      `<option value="">No vehicle assigned</option>`,
      ...activeVehicles.map(vehicle => {
        const label = [
          getVehicleName(vehicle),
          getVehicleRegistration(vehicle)
        ].filter(Boolean).join(" · ");

        return `
          <option value="${escapeHtml(vehicle.id)}" ${String(vehicle.id) === selected ? "selected" : ""}>
            ${escapeHtml(label)}
          </option>
        `;
      })
    ].join("");
  }

  function getStatusValueFromStop(stop, order = null) {
    return normalize(
      stop?.delivery_status ||
      stop?.status ||
      order?.delivery_status ||
      order?.transport_status ||
      order?.status ||
      "planned"
    );
  }

  function isDeliveredStatus(value) {
    const v = normalize(value);
    return ["delivered", "completed"].includes(v);
  }

  function isIssueStatus(value) {
    const v = normalize(value);
    return ["delivery_issue", "partial_delivery", "partially_delivered", "issue"].includes(v);
  }

  function isFailedStatus(value) {
    const v = normalize(value);
    return ["failed_delivery", "not_delivered", "returned", "delivery_failed", "failed"].includes(v);
  }

  function statusClassFromValue(value) {
    const v = normalize(value);

    if (isDeliveredStatus(v)) return "done";
    if (isIssueStatus(v)) return "issue";
    if (isFailedStatus(v)) return "failed";
    if (["sent_to_driver"].includes(v)) return "sent";
    if (["out_for_delivery", "loaded", "dispatched", "on_transport"].includes(v)) return "active";

    return "planned";
  }

  function routeStatusClass(route) {
    const status = normalize(route?.route_status || route?.status || "planned");
    return statusClassFromValue(status);
  }

  function getRouteCompletionStatus(route) {
    const stops = getStopsForRoute(route.id);

    if (!stops.length) return normalize(route?.route_status || route?.status || "planned");

    const values = stops.map(stop => getStatusValueFromStop(stop, getOrderById(stop.order_id)));

    if (values.some(isFailedStatus)) return "failed_delivery";
    if (values.some(isIssueStatus)) return "delivery_issue";
    if (values.every(isDeliveredStatus)) return "delivered";
    if (values.some(v => ["out_for_delivery", "loaded", "sent_to_driver"].includes(v))) return "out_for_delivery";

    return normalize(route?.route_status || route?.status || "planned");
  }

  function routeDotClass(vehicle) {
    const routes = getRoutesForVehicle(vehicle);
    if (!routes.length) return "free";

    const values = routes.map(getRouteCompletionStatus);

    if (values.some(isFailedStatus)) return "failed";
    if (values.some(isIssueStatus)) return "issue";
    if (values.every(isDeliveredStatus)) return "done";

    return "active";
  }

  function injectStyles() {
    if (byId("availableVehiclesStyles")) return;

    const style = document.createElement("style");
    style.id = "availableVehiclesStyles";
    style.textContent = `
      .av-stack{display:grid;gap:10px;}
.av-owner-badge{
  width:28px;
  height:28px;
  border-radius:999px;
  display:inline-grid;
  place-items:center;
  flex:0 0 auto;
  background:#475467;
  color:#fff;
  font-size:9px;
  font-weight:900;
  letter-spacing:.2px;
  line-height:1;
  box-shadow:none;
}

.av-owner-badge[title]{
  cursor:help;
}
      .av-day-head{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border:1px solid var(--border);background:#fbfdff;border-radius:10px;padding:10px 12px;}
      .av-day-title{font-size:13px;font-weight:900;color:#111827;}
      .av-day-sub{font-size:11.5px;color:#6b7280;margin-top:3px;}
      .av-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
      .av-mini{border:1px solid var(--border);border-radius:9px;background:#fff;padding:8px 10px;display:grid;gap:2px;}
      .av-mini span{font-size:9.5px;font-weight:900;text-transform:uppercase;color:#6b7280;}
      .av-mini strong{font-size:13px;font-weight:900;color:#111827;}

      .av-vehicle{border:1px solid var(--border);border-radius:10px;background:#fff;overflow:hidden;}
      .av-vehicle.has-route{border-color:#93c5fd;box-shadow:0 0 0 1px rgba(37,99,235,.12);}
      .av-vehicle-head{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:11px 12px;background:#fff;}
      .av-vehicle-title{display:flex;gap:8px;align-items:center;min-width:0;}
      .av-dot{width:11px;height:11px;border-radius:999px;background:#94a3b8;flex:0 0 auto;box-shadow:0 0 0 3px rgba(148,163,184,.15);}
      .av-dot.free{background:#94a3b8;}
      .av-dot.active{background:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.18);}
      .av-dot.done{background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.18);}
      .av-dot.issue{background:#f59e0b;box-shadow:0 0 0 4px rgba(245,158,11,.20);}
      .av-dot.failed{background:#dc2626;box-shadow:0 0 0 4px rgba(220,38,38,.18);}
      .av-name-row{display:flex;gap:6px;align-items:center;min-width:0;flex-wrap:wrap;}
      .av-name{font-size:13px;font-weight:900;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;}
      .av-driver-inline{font-size:11px;font-weight:900;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:2px 7px;white-space:nowrap;}
      .av-route-inline{font-size:10.5px;font-weight:900;color:#166534;background:#dcfce7;border:1px solid #86efac;border-radius:999px;padding:2px 7px;white-space:nowrap;}
      .av-sub{font-size:11px;color:#6b7280;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .av-actions{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;}
      .av-btn{height:30px;border-radius:8px;border:1px solid var(--border);background:#fff;color:#111827;padding:0 10px;font-size:11.5px;font-weight:800;cursor:pointer;}
      .av-btn:hover{background:#f8fafc;}
      .av-btn.primary{background:var(--primary);border-color:var(--primary);color:#fff;}
      .av-btn.success{background:#16a34a;border-color:#16a34a;color:#fff;}
      .av-btn.warning{background:#f59e0b;border-color:#f59e0b;color:#fff;}
.av-btn.danger{
  background:#f87171;
  border-color:#f87171;
  color:#fff;
}

.av-btn.danger:hover{
  background:#ef4444;
  border-color:#ef4444;
}

.av-btn.danger:hover{
  background:#dc2626;
  border-color:#dc2626;
}
      .av-btn.small{height:26px;padding:0 8px;font-size:10.5px;}

      .av-route-list{display:grid;gap:8px;padding:10px 12px;border-top:1px solid var(--border);background:#fafafa;}
      .av-route{border:1px solid var(--border);border-radius:9px;background:#fff;overflow:hidden;}
      .av-route.open{border-color:#93c5fd;}
      .av-route-head{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px;}
      .av-route-title{font-size:12.5px;font-weight:900;color:#111827;display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
      .av-route-sub{font-size:11px;color:#6b7280;margin-top:3px;line-height:1.35;}
      .av-route-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;padding:0 10px 10px;}
      .av-kpi{border:1px solid #e5e7eb;border-radius:8px;background:#fbfdff;padding:7px 8px;display:grid;gap:2px;}
      .av-kpi span{font-size:9px;font-weight:900;text-transform:uppercase;color:#6b7280;}
      .av-kpi strong{font-size:12px;font-weight:900;color:#111827;}
      .av-route-extra{display:none;border-top:1px solid var(--border);padding:10px;background:#fff;}
      .av-route.open .av-route-extra{display:grid;gap:10px;}

      .av-status{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:900;border:1px solid transparent;white-space:nowrap;}
      .av-status.planned{background:#dbeafe;color:#1d4ed8;border-color:#93c5fd;}
      .av-status.sent{background:#ede9fe;color:#6d28d9;border-color:#c4b5fd;}
      .av-status.active{background:#fef3c7;color:#b45309;border-color:#fcd34d;}
      .av-status.done{background:#dcfce7;color:#166534;border-color:#86efac;}
      .av-status.issue{background:#ffedd5;color:#c2410c;border-color:#fdba74;}
      .av-status.failed{background:#fee2e2;color:#b91c1c;border-color:#fca5a5;}

      .av-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
      .av-field{display:grid;gap:5px;}
      .av-field label{font-size:10.5px;font-weight:900;color:#374151;}
      .av-input,.av-select{width:100%;border:1px solid var(--border);border-radius:8px;background:#fff;padding:8px 10px;font-size:12px;}

      .av-stops-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}
      .av-stops-title{font-size:12px;font-weight:900;color:#111827;}
      .av-stops{display:grid;gap:6px;}
      .av-stop{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fbfdff;}
      .av-stop[draggable="true"]{cursor:grab;}
      .av-stop.dragging{opacity:.45;border-style:dashed;}
      .av-stop.drop-target{border-color:#2563eb;background:#eff6ff;}
      .av-stop.done{background:#f0fdf4;border-color:#86efac;}
      .av-stop.issue{background:#fff7ed;border-color:#fdba74;}
      .av-stop.failed{background:#fef2f2;border-color:#fca5a5;}
      .av-stop-no{width:26px;height:26px;border-radius:999px;background:#111827;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:900;}
      .av-stop-no.done{background:#16a34a;}
      .av-stop-no.issue{background:#f59e0b;}
      .av-stop-no.failed{background:#dc2626;}
      .av-stop-title{font-size:12px;font-weight:900;color:#111827;}
      .av-stop-sub{font-size:11px;color:#6b7280;margin-top:2px;line-height:1.35;}
      .av-stop-actions{display:flex;gap:5px;align-items:center;justify-content:flex-end;flex-wrap:wrap;}
      .av-drag-hint{font-size:10.5px;color:#6b7280;font-weight:800;}
      .av-empty{border:1px dashed var(--border);border-radius:10px;padding:14px;color:#6b7280;font-size:12px;line-height:1.5;background:#fff;}

/* =========================================================
   FDS / CARRIER LAYOUT
   Alleen van toepassing op externe carriers
   ========================================================= */

.av-vehicle.av-carrier-vehicle.has-route{
  border-color:#d9e0e8;
  box-shadow:none;
}

.av-vehicle.av-carrier-vehicle .av-vehicle-head{
  padding:13px 14px;
}

.av-vehicle.av-carrier-vehicle .av-route-inline{
  background:#eef7ef;
  border-color:#c8e6cc;
  color:#28723a;
}

.av-route-list.av-carrier-route-list{
  padding:12px;
  gap:12px;
  background:#f8fafc;
  border-top:1px solid #e7ebf0;
}

.av-carrier-panel{
  border:0;
  border-radius:0;
  background:transparent;
  overflow:visible;
}

.av-carrier-panel .av-route-head{
  padding:0 0 2px;
  border:0;
}

.av-carrier-summary{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  width:100%;
}

.av-carrier-summary-main{
  min-width:0;
}

.av-carrier-title-row{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}

.av-carrier-title{
  font-size:13px;
  font-weight:900;
  color:#172033;
}

.av-carrier-count{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:22px;
  padding:2px 8px;
  border-radius:999px;
  background:#eef7ef;
  border:1px solid #c8e6cc;
  color:#28723a;
  font-size:10px;
  font-weight:900;
  white-space:nowrap;
}

.av-carrier-totals{
  margin-top:4px;
  font-size:11px;
  line-height:1.45;
  color:#667085;
}

/* Documents section */

.av-carrier-documents{
  border:1px solid #dfe5ec;
  border-radius:11px;
  background:#fff;
  overflow:hidden;
}

.av-carrier-documents-head{
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px 13px;
  border-bottom:1px solid #edf0f4;
}

.av-carrier-documents-icon{
  width:28px;
  height:28px;
  border-radius:8px;
  display:grid;
  place-items:center;
  flex:0 0 auto;
  background:#eff6ff;
  color:#2563eb;
  font-size:15px;
  font-weight:900;
}

.av-carrier-documents-title{
  font-size:12.5px;
  font-weight:900;
  color:#172033;
}

.av-carrier-documents-sub{
  margin-top:2px;
  font-size:10.5px;
  color:#667085;
}

.av-carrier-documents-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
  padding:10px;
}

.av-carrier-document-btn{
  width:100%;
  min-height:38px;
  height:auto;
  padding:7px 9px;
  background:#fff;
  border-color:#d9e0e8;
  color:#344054;
  line-height:1.25;
}

.av-carrier-document-btn:hover{
  background:#f8fafc;
  border-color:#b8c2cf;
}

.av-carrier-document-btn.primary-document{
  color:#175cd3;
}

.av-signed-notice{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin:0 10px 10px;
  padding:10px 11px;
  border:1px solid #d9e6dc;
  border-radius:9px;
  background:#f7fbf8;
}

.av-signed-notice-main{
  display:flex;
  align-items:center;
  gap:9px;
  min-width:0;
}

.av-signed-notice-icon{
  width:27px;
  height:27px;
  border-radius:999px;
  display:grid;
  place-items:center;
  flex:0 0 auto;
  background:#3f9b55;
  color:#fff;
  font-size:14px;
  font-weight:900;
}

.av-signed-notice-title{
  font-size:11.5px;
  font-weight:900;
  color:#1f2937;
}

.av-signed-notice-sub{
  margin-top:2px;
  font-size:10px;
  color:#667085;
}

.av-signed-replace{
  background:#fff;
  border-color:#cfd8e3;
  color:#344054;
}

/* Charter order section */

.av-charter-section{
  border:1px solid #dfe5ec;
  border-radius:11px;
  background:#fff;
  overflow:hidden;
}

.av-charter-section-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  padding:12px 13px;
  border-bottom:1px solid #e7ebf0;
}

.av-charter-section-title{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  font-size:12.5px;
  font-weight:900;
  color:#172033;
}

.av-charter-section-sub{
  margin-top:4px;
  font-size:10.5px;
  color:#667085;
}

.av-charter-list{
  display:block;
  background:#fff;
}

.av-charter-row{
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  gap:10px;
  align-items:center;
  min-height:76px;
  padding:10px 11px;
  border:0;
  border-bottom:1px solid #e7ebf0;
  border-radius:0;
  background:#fff;
}

.av-charter-row:last-child{
  border-bottom:0;
}

.av-charter-row:hover{
  background:#fafbfc;
}

.av-charter-arrow{
  width:25px;
  height:25px;
  border-radius:999px;
  display:grid;
  place-items:center;
  flex:0 0 auto;
  border:1px solid #d9e0e8;
  background:#fff;
  color:#344054;
  font-size:17px;
  font-weight:700;
  line-height:1;
}

.av-charter-content{
  min-width:0;
}

.av-charter-title{
  color:#172033;
  font-size:11.8px;
  font-weight:900;
  line-height:1.35;
}

.av-charter-reference{
  margin-top:3px;
  color:#667085;
  font-size:10.5px;
  line-height:1.35;
}

.av-charter-details{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  margin-top:5px;
  color:#667085;
  font-size:10.5px;
  line-height:1.35;
}

.av-charter-status{
  display:inline-flex;
  align-items:center;
  min-height:20px;
  padding:2px 7px;
  border-radius:999px;
  border:1px solid #fed7aa;
  background:#fff7ed;
  color:#c2410c;
  font-size:9.5px;
  font-weight:800;
  white-space:nowrap;
}

.av-charter-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:7px;
  flex-wrap:nowrap;
}

.av-owner-badge{
  width:28px;
  height:28px;
  border-radius:999px;
  display:inline-grid;
  place-items:center;
  flex:0 0 auto;
  background:#475467;
  color:#fff;
  font-size:9px;
  font-weight:900;
  letter-spacing:.1px;
  line-height:1;
  box-shadow:none;
}

.av-owner-badge[title]{
  cursor:help;
}

.av-charter-remove{
  min-width:58px;
}

@media(max-width:1200px){
  .av-carrier-documents-grid{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}

@media(max-width:720px){
  .av-carrier-summary,
  .av-charter-section-head{
    display:grid;
    grid-template-columns:1fr;
  }

  .av-carrier-documents-grid{
    grid-template-columns:1fr;
  }

  .av-charter-row{
    grid-template-columns:auto minmax(0,1fr);
  }

  .av-charter-actions{
    grid-column:1 / -1;
    justify-content:flex-end;
    padding-left:35px;
  }
}

/* =========================================================
   OWN TRANSPORT ROUTES
   Rustige stijl, passend bij het FDS-paneel
   ========================================================= */

.av-own-route{
  border:1px solid #dfe5ec;
  border-radius:11px;
  background:#fff;
  overflow:hidden;
  box-shadow:none;
}

.av-own-route.open{
  border-color:#a9c7ff;
  box-shadow:0 0 0 1px rgba(37,99,235,.06);
}

.av-own-route-head{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:14px;
  align-items:start;
  padding:13px 14px 10px;
}

.av-own-route-heading{
  min-width:0;
}

.av-own-route-title-row{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}

.av-own-route-title{
    font-size:15px;
  font-weight:900;
  color:#172033;
}

.av-own-route-meta{
  margin-top:4px;
  color:#667085;
  font-size:10.8px;
  line-height:1.4;
}

.av-own-route-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:7px;
  flex-wrap:wrap;
}

.av-own-action-btn{
  min-height:31px;
  height:auto;
  padding:6px 11px;
  border:1px solid #d7dee8;
  border-radius:8px;
  background:#fff;
  color:#344054;
  font-size:11.8px;
  font-weight:800;
  cursor:pointer;
}

.av-own-action-btn:hover{
  background:#f8fafc;
  border-color:#b7c0cc;
}

.av-own-action-send{
  border-color:#a7d7b7;
  color:#18753a;
}

.av-own-action-send:hover{
  background:#f3faf5;
  border-color:#78c190;
}

.av-own-action-remove{
  border-color:#f5b5b5;
  color:#c83c3c;
}

.av-own-action-remove:hover{
  background:#fff5f5;
  border-color:#ef8f8f;
}

/* Status badges */

.av-own-route .av-status{
  min-height:20px;
  padding:2px 7px;
  font-size:9.5px;
  line-height:1;
}

.av-own-route .av-status.planned{
  background:#f4f7fb;
  border-color:#cfd9e8;
  color:#35567e;
}

.av-own-route .av-status.sent{
  background:#f5f3ff;
  border-color:#d7d0f4;
  color:#65559b;
}

.av-own-route .av-status.active{
  background:#fff8eb;
  border-color:#f5d9a7;
  color:#9b621b;
}

.av-own-route .av-status.done{
  background:#f0f9f2;
  border-color:#bfe3c7;
  color:#287b3e;
}

.av-own-route .av-status.issue{
  background:#fff7ed;
  border-color:#fed7aa;
  color:#b45309;
}

.av-own-route .av-status.failed{
  background:#fff2f2;
  border-color:#f3b6b6;
  color:#b83939;
}

/* KPI's */

.av-own-route-kpis{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:7px;
  padding:0 14px 12px;
}

.av-own-route-kpi{
  min-width:0;
  border:1px solid #dfe5ec;
  border-radius:8px;
  background:#fbfcfe;
  padding:8px 9px;
}

.av-own-route-kpi span{
  display:block;
  color:#667085;
  font-size:10px;
  font-weight:900;
  line-height:1.2;
  text-transform:uppercase;
}

.av-own-route-kpi strong{
  display:block;
  margin-top:3px;
  color:#172033;
  font-size:14px;
  font-weight:900;
  line-height:1.2;
}

.av-own-route-kpi.result-positive strong{
  color:#16823b;
}

.av-own-route-kpi.result-negative strong{
  color:#c2410c;
}

.av-own-route-cost-toggle{
  cursor:pointer;
}

.av-own-route-cost-toggle:hover{
  background:#f7f9fc;
}

/* Cost breakdown */

.av-own-cost-panel{
  display:none;
  margin:0 14px 12px;
  padding:13px;
  border:1px solid #dfe5ec;
  border-radius:9px;
  background:#fff;
}

.av-own-cost-panel.visible{
  display:block;
}

.av-own-cost-title{
  margin-bottom:10px;
  color:#172033;
  font-size:12.5px;
  font-weight:900;
}

.av-own-cost-grid{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  column-gap:18px;
  row-gap:5px;
  color:#344054;
  font-size:12.3px;
  line-height:1.25;
}

.av-own-cost-grid .value{
  text-align:right;
  white-space:nowrap;
}

.av-own-cost-divider{
  grid-column:1 / -1;
  height:1px;
  margin:5px 0 2px;
  background:#e7ebf0;
}

.av-own-cost-total{
    color:#172033;
    font-weight:900;
    font-size:13px;
}

.av-own-cost-result-positive{
    color:#16823b;
    font-weight:900;
    font-size:13px;
}

.av-own-cost-result-negative{
    color:#c2410c;
    font-weight:900;
    font-size:13px;
}

/* Opengeklapte route */

.av-own-route-extra{
  display:none;
  border-top:1px solid #e7ebf0;
  padding:13px 14px 14px;
  background:#fff;
}

.av-own-route.open .av-own-route-extra{
  display:grid;
  gap:15px;
}

/* Assignment */

.av-own-assignment{
  background:#fff;
}

.av-own-section-title{
  margin-bottom:3px;
  color:#172033;
  font-size:14px;
  font-weight:900;
}

.av-own-section-sub{
  color:#667085;
  font-size:11.5px;
  line-height:1.4;
}

.av-own-assignment-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:10px 12px;
  margin-top:10px;
}

.av-own-field{
  display:grid;
  gap:5px;
}

.av-own-field label{
  color:#344054;
  font-size:11px;
  font-weight:900;
}

.av-own-field .av-input,
.av-own-field .av-select{
  min-height:35px;
  padding:7px 9px;
  border:1px solid #d7dee8;
  border-radius:8px;
  background:#fff;
  color:#172033;
  font-size:12px;
}

.av-own-assignment-footer{
  display:flex;
  justify-content:flex-end;
  margin-top:10px;
}

.av-own-save-btn{
  min-width:120px;
}

/* Route order */

.av-own-stops-section{
  border-top:1px solid #edf0f4;
  padding-top:13px;
}

.av-own-stops-head{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
  margin-bottom:9px;
}

.av-own-stops-list{
  display:block;
  border:1px solid #dfe5ec;
  border-radius:9px;
  background:#fff;
  overflow:hidden;
}

.av-own-stop{
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  gap:10px;
  align-items:center;
  min-height:68px;
  padding:9px 10px;
  border:0;
  border-bottom:1px solid #e7ebf0;
  border-radius:0;
  background:#fff;
}

.av-own-stop:last-child{
  border-bottom:0;
}

.av-own-stop:hover{
  background:#fafbfc;
}

.av-own-stop.dragging{
  opacity:.45;
  background:#f4f7fb;
}

.av-own-stop.drop-target{
  background:#f3f7ff;
  box-shadow:inset 3px 0 0 #6695e8;
}

.av-own-stop-number{
  width:25px;
  height:25px;
  border:1px solid #d7dee8;
  border-radius:999px;
  display:grid;
  place-items:center;
  background:#fff;
  color:#475467;
  font-size:10px;
  font-weight:900;
}

.av-own-stop-content{
  min-width:0;
}

.av-own-stop-title{
  color:#172033;
  font-size:13px;
  font-weight:900;
  line-height:1.35;
}

.av-own-stop-ref{
  margin-top:2px;
  color:#667085;
  font-size:11px;
  line-height:1.35;
}

.av-own-stop-detail{
  display:flex;
  align-items:center;
  gap:5px;
  flex-wrap:wrap;
  margin-top:3px;
  color:#667085;
  font-size:10px;
  line-height:1.35;
}

.av-own-stop-status{
  color:#287b3e;
  font-weight:900;
}

.av-own-stop-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:6px;
  flex-wrap:nowrap;
}

.av-stop-action-btn{
  min-height:27px;
  height:auto;
  padding:4px 8px;
  border:1px solid #d7dee8;
  border-radius:7px;
  background:#fff;
  color:#475467;
  font-size:9.5px;
  font-weight:800;
  cursor:pointer;
}

.av-stop-action-btn:hover{
  background:#f8fafc;
}

.av-stop-action-delivered{
  border-color:#add7ba;
  color:#18753a;
}

.av-stop-action-issue{
  border-color:#f0d09b;
  color:#9c6216;
}

.av-stop-action-failed{
  border-color:#efb4b4;
  color:#b83b3b;
}

/* Eigen voertuigheader minder blauw */

.av-vehicle:not(.av-carrier-vehicle) .av-btn.primary{
  background:#fff;
  border-color:#d7dee8;
  color:#344054;
}

.av-vehicle:not(.av-carrier-vehicle) .av-btn.primary:hover{
  background:#f8fafc;
  border-color:#b7c0cc;
}

.av-vehicle:not(.av-carrier-vehicle) .av-driver-inline{
  background:#f4f7fb;
  border-color:#d0dbea;
  color:#3d5f89;
}

.av-vehicle:not(.av-carrier-vehicle) .av-route-inline{
  background:#f0f8f2;
  border-color:#c6e4ce;
  color:#287b3e;
}

@media(max-width:1200px){
  .av-own-route-kpis{
    grid-template-columns:repeat(3,minmax(0,1fr));
  }
}

@media(max-width:760px){
  .av-own-route-head{
    grid-template-columns:1fr;
  }

  .av-own-route-actions{
    justify-content:flex-start;
  }

  .av-own-route-kpis{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }

  .av-own-assignment-grid{
    grid-template-columns:1fr;
  }

  .av-own-stop{
    grid-template-columns:auto minmax(0,1fr);
  }

  .av-own-stop-actions{
    grid-column:1 / -1;
    justify-content:flex-end;
    padding-left:35px;
  }
}

      @media(max-width:920px){
        .av-day-head,.av-vehicle-head,.av-route-head,.av-form-grid{grid-template-columns:1fr;}
        .av-summary,.av-route-kpis{grid-template-columns:1fr;}
        .av-actions,.av-stop-actions{justify-content:flex-start;}
        .av-stop{grid-template-columns:auto 1fr;}
        .av-stop-actions{grid-column:1 / -1;}
      }
    `;
    document.head.appendChild(style);
  }

  function syncFromPlannerData(data = null) {
    const src = data || window.VeynorPlannerData || {};

    companyId = src.companyId || companyId;
    allOrders = Array.isArray(src.allOrders) ? src.allOrders : [];
    filteredOrders = Array.isArray(src.filteredOrders) ? src.filteredOrders : [];
    allRoutes = Array.isArray(src.allRoutes) ? src.allRoutes : [];
    allStops = Array.isArray(src.allStops) ? src.allStops : [];
    activeVehicles = Array.isArray(src.activeVehicles) ? src.activeVehicles : [];
    driverUsers = Array.isArray(src.driverUsers) ? src.driverUsers : [];

    selectedOrderIds = Array.isArray(src.selectedOrderIds)
      ? src.selectedOrderIds.map(String)
      : Array.from(src.selectedOrderIds || []).map(String);

    selectedPlanningDate = src.selectedPlanningDate || selectedPlanningDate || new Date().toISOString().slice(0, 10);
  }

async function loadSignedFdsNoticeStatus() {
  const db = ensureClient();
  const cid = getCompanyId();

  signedNoticeOrderIds.clear();

  if (!cid) return;

  const { data, error } = await db
    .from("order_documents")
    .select("order_id")
    .eq("company_id", cid)
    .eq("document_type", "fds_signed_collection_notice");

  if (error) {
    console.warn(
      "Signed FDS notice status could not be loaded:",
      error.message
    );
    return;
  }

  (data || []).forEach(documentRow => {
    if (documentRow.order_id) {
      signedNoticeOrderIds.add(String(documentRow.order_id));
    }
  });
}

  function render() {
  injectStyles();
  syncFromPlannerData();

  const mount =
    byId("availableVehiclesModule") ||
    byId("availableVehiclesList");

  if (!mount) return;

  if (!activeVehicles.length) {
    mount.innerHTML = `
      <div class="av-empty">
        No fleet vehicles or carriers available. Check Settings → Transport and make sure resources are active and enabled for planning.
      </div>
    `;
    return;
  }

  const selectedSummary = getSelectedOrdersSummary();

  const dayRoutes = allRoutes.filter(route => {
    const date = getRouteDate(route);
    return !selectedPlanningDate || !date || date === selectedPlanningDate;
  });

  mount.innerHTML = `
    <div class="av-stack">
      <div class="av-day-head">
        <div>
          <div class="av-day-title">Available Fleet & Carriers</div>
          <div class="av-day-sub">
            ${formatNumber(dayRoutes.length)} route(s)
            · ${formatNumber(selectedSummary.count)} selected order(s)
          </div>
        </div>

        <div class="av-summary">
          <div class="av-mini">
            <span>Selected</span>
            <strong>${formatNumber(selectedSummary.count)}</strong>
          </div>

          <div class="av-mini">
            <span>Volume</span>
            <strong>${formatNumber(selectedSummary.volume, 2)} m³</strong>
          </div>

          <div class="av-mini">
            <span>Colli</span>
            <strong>${formatNumber(selectedSummary.colli)}</strong>
          </div>
        </div>
      </div>

      ${activeVehicles.map(renderVehicle).join("")}
    </div>
  `;

  bindEvents(mount);
}

function getCarrierOrderDate(order) {
  return (
    order.planned_route_date ||
    order.expected_delivery_date ||
    order.confirmed_delivery_date ||
    ""
  );
}

function getCarrierOrders(vehicle) {
  return allOrders.filter(order => {
    const orderDate = getCarrierOrderDate(order);

    return (
      normalize(order.transport_type) === "charter" &&
      normalize(order.status) === "export_for_charter" &&
      !order.route_id &&
      String(order.carrier_vehicle_id || "") === String(vehicle.id) &&
      (
        !selectedPlanningDate ||
        !orderDate ||
        orderDate === selectedPlanningDate
      )
    );
  });
}

function renderCarrierOrders(vehicle) {
  const orders = getCarrierOrders(vehicle);

  if (!orders.length) {
    return `
      <div class="av-empty">
        No charter orders assigned to this carrier.
      </div>
    `;
  }

  const hasSignedNotice = orders.some(order =>
    signedNoticeOrderIds.has(String(order.id))
  );

  const volume = orders.reduce(
    (sum, order) => sum + getOrderVolume(order),
    0
  );

  const colli = orders.reduce(
    (sum, order) => sum + getOrderColli(order),
    0
  );

  const weight = orders.reduce(
    (sum, order) => sum + getOrderWeight(order),
    0
  );

  return `
    <div class="av-route av-carrier-panel">

      <div class="av-route-head">
        <div class="av-carrier-summary">
          <div class="av-carrier-summary-main">
            <div class="av-carrier-title-row">
              <span class="av-carrier-title">
                Charter orders for ${escapeHtml(getVehicleName(vehicle))}
              </span>

              <span class="av-carrier-count">
                ${formatNumber(orders.length)} orders
              </span>
            </div>

            <div class="av-carrier-totals">
              Total:
              ${formatNumber(colli)} colli
              · ${formatNumber(volume, 2)} m³
              · ${formatNumber(weight, 0)} kg
            </div>
          </div>
        </div>
      </div>

      <div class="av-carrier-documents">
        <div class="av-carrier-documents-head">
          <div class="av-carrier-documents-icon">
            ▤
          </div>

          <div>
            <div class="av-carrier-documents-title">
              Documents
            </div>

            <div class="av-carrier-documents-sub">
              Create and download documents for FDS.
            </div>
          </div>
        </div>

        <div class="av-carrier-documents-grid">
          <button
            class="av-btn av-carrier-document-btn primary-document"
            type="button"
            data-fds-notice="${escapeHtml(vehicle.id)}"
          >
            FDS Notice PDF
          </button>

          ${
            !hasSignedNotice
              ? `
                <button
                  class="av-btn av-carrier-document-btn"
                  type="button"
                  data-fds-upload-signed="${escapeHtml(vehicle.id)}"
                >
                  Upload Signed Notice
                </button>
              `
              : ""
          }

          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            data-fds-upload-input="${escapeHtml(vehicle.id)}"
            hidden
          >

          <button
            class="av-btn av-carrier-document-btn"
            type="button"
            data-fds-delivery-notes="${escapeHtml(vehicle.id)}"
          >
            Generate Delivery Notes
          </button>

          <button
            class="av-btn av-carrier-document-btn"
            type="button"
            data-fds-labels="${escapeHtml(vehicle.id)}"
          >
            Generate Labels
          </button>
        </div>

        ${
          hasSignedNotice
            ? `
              <div class="av-signed-notice">
                <div class="av-signed-notice-main">
                  <div class="av-signed-notice-icon">
                    ✓
                  </div>

                  <div>
                    <div class="av-signed-notice-title">
                      Signed Notice
                    </div>

                    <div class="av-signed-notice-sub">
                      A signed FDS notice is linked to these orders.
                    </div>
                  </div>
                </div>

                <button
                  class="av-btn av-signed-replace"
                  type="button"
                  data-fds-upload-signed="${escapeHtml(vehicle.id)}"
                >
                  Replace
                </button>
              </div>
            `
            : ""
        }
      </div>

      <div class="av-charter-section">
        <div class="av-charter-section-head">
          <div>
            <div class="av-charter-section-title">
              Charter orders for ${escapeHtml(getVehicleName(vehicle))}

              <span class="av-carrier-count">
                ${formatNumber(orders.length)} orders
              </span>
            </div>

            <div class="av-charter-section-sub">
              Total:
              ${formatNumber(volume, 2)} m³
              · ${formatNumber(weight, 0)} kg
            </div>
          </div>
        </div>

        <div class="av-charter-list">
          ${orders.map(order => {
            const customerOrderLabel = getCustomerOrderLabel(order);

            return `
              <div class="av-charter-row">
                <span class="av-charter-arrow">
                  ›
                </span>

                <div class="av-charter-content">
                  <div class="av-charter-title">
                    ${escapeHtml(order.order_number || "—")}
                    ·
                    ${escapeHtml(getRetailerName(order))}
                  </div>

                  ${
                    customerOrderLabel
                      ? `
                        <div class="av-charter-reference">
                          ${escapeHtml(customerOrderLabel)}
                        </div>
                      `
                      : ""
                  }

                  <div class="av-charter-details">
                    <span>
                      ${escapeHtml(order.delivery_city || "—")}
                      · ${escapeHtml(order.delivery_postcode || "—")}
                    </span>

                    <span>·</span>

                    <span>
                      ${formatNumber(getOrderColli(order))} colli
                    </span>

                    <span>·</span>

                    <span>
                      ${formatNumber(getOrderVolume(order), 2)} m³
                    </span>

                    <span>·</span>

                    <span>
                      ${formatNumber(getOrderWeight(order), 0)} kg
                    </span>

                    <span class="av-charter-status">
                      Export for Charter
                    </span>
                  </div>
                </div>

                <div class="av-charter-actions">
                  <span
                    class="av-owner-badge"
                    title="${escapeHtml(
                      order.product_owner_name ||
                      "Unknown product owner"
                    )}"
                  >
                    ${escapeHtml(getProductOwnerDisplayCode(order))}
                  </span>

                  <button
                    class="av-btn small danger av-charter-remove"
                    type="button"
                    data-remove-charter="${escapeHtml(order.id)}"
                  >
                    Remove
                  </button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
}
  function renderVehicle(vehicle) {
    const vehicleId = String(vehicle.id);
const routes = getRoutesForVehicle(vehicle);
const carrierOrders = getCarrierOrders(vehicle);
const expanded = expandedVehicleIds.has(vehicleId);
const capacity = getVehicleCapacity(vehicle);
const primaryRoute = getPrimaryRouteForVehicle(vehicle);
const hasRoute = routes.length > 0 || carrierOrders.length > 0;
const highlightVehicle =
  routes.length > 0 ||
  (getVehicleType(vehicle) === "carrier" && carrierOrders.length > 0);
    const dotClass = routeDotClass(vehicle);
    const driverName = primaryRoute ? getRouteDriverName(primaryRoute) : "";
    const routeLabel = primaryRoute ? getRouteLabel(primaryRoute) : "";

    return `
      <div
  class="av-vehicle ${
    getVehicleType(vehicle) === "carrier"
      ? "av-carrier-vehicle"
      : ""
  } ${highlightVehicle ? "has-route" : ""}"
  data-vehicle-id="${escapeHtml(vehicleId)}"
>
        <div class="av-vehicle-head">
          <div class="av-vehicle-title">
            <span class="av-dot ${escapeHtml(dotClass)}"></span>

            <div>
<div class="av-name-row">
  <span class="av-name">
    ${getVehicleType(vehicle) === "carrier" ? "🏢 " : "🚚 "}
    ${escapeHtml(getVehicleName(vehicle))}
  </span>
${
  hasRoute
    ? `<span class="av-route-inline">${
        getVehicleType(vehicle) === "carrier"
          ? `${carrierOrders.length} Charter Orders`
          : escapeHtml(routeLabel)
      }</span>`
    : ""
}
  ${hasRoute && getVehicleType(vehicle) !== "carrier" ? `<span class="av-driver-inline">${escapeHtml(driverName)}</span>` : ""}
</div>

<div class="av-sub">
  ${
    getVehicleType(vehicle) === "carrier"
      ? `External Carrier · ${formatNumber(routes.length)} route(s) · ${formatNumber(carrierOrders.length)} charter order(s)`
      : `${escapeHtml(getVehicleType(vehicle))}
        · ${escapeHtml(getVehicleRegistration(vehicle))}
        · ${capacity ? `${formatNumber(capacity, 1)} m³` : "capacity unknown"}
        · ${formatNumber(routes.length)} route(s)`
  }
</div>
            </div>
          </div>

          <div class="av-actions">
            <button class="av-btn primary" type="button" data-select-vehicle="${escapeHtml(vehicleId)}">Use</button>
            <button class="av-btn" type="button" data-toggle-vehicle="${escapeHtml(vehicleId)}">${expanded ? "Hide" : "Open"}</button>
          </div>
        </div>

        ${
          expanded
            ? `
              <div
  class="av-route-list ${
    getVehicleType(vehicle) === "carrier"
      ? "av-carrier-route-list"
      : ""
  }"
>
                ${
                  getVehicleType(vehicle) === "carrier"
  ? `
      ${renderCarrierOrders(vehicle)}
      ${routes.length ? routes.map(route => renderRoute(route, vehicle)).join("") : ""}
    `
  : (
      routes.length
        ? routes.map(route => renderRoute(route, vehicle)).join("")
        : `<div class="av-empty">No route assigned to this vehicle for this planning date.</div>`
    )
                }
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  function renderRoute(route, vehicle) {
  const summary = getRouteSummary(route);
  const routeId = String(route.id);
  const open = expandedRouteIds.has(routeId);
  const routeStatus = getRouteCompletionStatus(route);
  const statusClass = statusClassFromValue(routeStatus);

  const resultClass =
    summary.result > 0
      ? "result-positive"
      : summary.result < 0
      ? "result-negative"
      : "";

  return `
    <div
      class="av-route av-own-route ${open ? "open" : ""}"
      data-route-id="${escapeHtml(routeId)}"
    >
      <div class="av-own-route-head">
        <div class="av-own-route-heading">
          <div class="av-own-route-title-row">
            <span class="av-own-route-title">
              ${escapeHtml(getRouteLabel(route))}
            </span>

            <span class="av-status ${escapeHtml(statusClass)}">
              ${escapeHtml(titleCase(routeStatus))}
            </span>
          </div>

          <div class="av-own-route-meta">
            ${escapeHtml(formatDate(getRouteDate(route)))}
            · Driver: ${escapeHtml(getRouteDriverName(route))}
            · ${escapeHtml(
              formatTime(route.planned_start_time || route.start_time)
            )}
            → ${escapeHtml(
              formatTime(route.planned_end_time || route.end_time)
            )}
          </div>
        </div>

        <div class="av-own-route-actions">
          <button
            class="av-own-action-btn"
            type="button"
            data-toggle-route="${escapeHtml(routeId)}"
          >
            ${open ? "Close" : "Details"}
          </button>

          <button
            class="av-own-action-btn"
            type="button"
            data-add-selected-route="${escapeHtml(routeId)}"
          >
            Add selected
          </button>

          <button
            class="av-own-action-btn av-own-action-send"
            type="button"
            data-send-driver="${escapeHtml(routeId)}"
          >
            Send
          </button>

          <button
            class="av-own-action-btn av-own-action-remove"
            type="button"
            data-remove-route="${escapeHtml(routeId)}"
          >
            Remove
          </button>
        </div>
      </div>

      <div class="av-own-route-kpis">
        <div class="av-own-route-kpi">
          <span>Stops</span>
          <strong>${formatNumber(summary.totalStops)}</strong>
        </div>

        <div class="av-own-route-kpi">
          <span>Volume</span>
          <strong>${formatNumber(summary.totalVolume, 1)} m³</strong>
        </div>

        <div class="av-own-route-kpi">
          <span>Miles</span>
          <strong>${formatNumber(summary.distanceMiles, 1)} mi</strong>
        </div>

        <div class="av-own-route-kpi">
          <span>Hours</span>
          <strong>${formatNumber(summary.totalHours, 1)} h</strong>
        </div>

        <div class="av-own-route-kpi">
          <span>Revenue</span>
          <strong>${formatMoney(summary.revenue)}</strong>
        </div>

        <div
          class="av-own-route-kpi av-own-route-cost-toggle"
          data-route-cost="${escapeHtml(routeId)}"
        >
          <span>Cost ▼</span>
          <strong>${formatMoney(summary.cost)}</strong>
        </div>

        <div class="av-own-route-kpi ${resultClass}">
          <span>Result</span>
          <strong>${formatMoney(summary.result)}</strong>
        </div>
      </div>

      <div
        class="av-own-cost-panel"
        id="cost-breakdown-${escapeHtml(routeId)}"
      >
        <div class="av-own-cost-title">
          Route Cost Breakdown
        </div>

        <div class="av-own-cost-grid">
          <div>Fuel Cost</div>
          <div class="value">
            ${formatMoney(route.estimated_cost_fuel_gbp || 0)}
          </div>

          <div>Fuel Used</div>
          <div class="value">
            ${formatNumber(route.estimated_fuel_litres || 0, 1)} L
          </div>

          <div>Vehicle Cost</div>
          <div class="value">
            ${formatMoney(route.estimated_cost_vehicle_gbp || 0)}
          </div>

          <div>Driver Cost</div>
          <div class="value">
            ${formatMoney(route.estimated_cost_labour_gbp || 0)}
          </div>

          <div>Warehouse Cost</div>
          <div class="value">
            ${formatMoney(summary.warehouseCost)}
          </div>

          <div>Total Miles</div>
          <div class="value">
            ${formatNumber(summary.distanceMiles, 1)} mi
          </div>

          <div>Total Hours</div>
          <div class="value">
            ${formatNumber(summary.totalHours, 1)} h
          </div>

          <div class="av-own-cost-divider"></div>

          <div class="av-own-cost-total">Total Cost</div>
          <div class="value av-own-cost-total">
            ${formatMoney(summary.cost)}
          </div>

          <div class="av-own-cost-total">Revenue</div>
          <div class="value av-own-cost-total">
            ${formatMoney(summary.revenue)}
          </div>

          <div class="av-own-cost-total">Result</div>
          <div class="value ${
            summary.result >= 0
              ? "av-own-cost-result-positive"
              : "av-own-cost-result-negative"
          }">
            ${formatMoney(summary.result)}
          </div>
        </div>
      </div>

      <div class="av-own-route-extra">
        ${renderRouteAssignment(route, vehicle)}
        ${renderRouteStops(route)}
      </div>
    </div>
  `;
}

function renderRouteAssignment(route, vehicle) {
  const routeId = String(route.id);

  const vehicleId =
    route.vehicle_id ||
    route.assigned_vehicle_id ||
    vehicle?.id ||
    "";

  const driverId = getRouteDriverId(route);

  const routeDate =
    getRouteDate(route) ||
    selectedPlanningDate;

  const start = formatTime(
    route.planned_start_time ||
    route.start_time ||
    "08:00"
  ).replace("—", "");

  const end = formatTime(
    route.planned_end_time ||
    route.end_time ||
    ""
  ).replace("—", "");

  return `
    <div class="av-own-assignment">
      <div class="av-own-section-title">
        Assignment
      </div>

      <div class="av-own-section-sub">
        Change the vehicle, driver, delivery date and ETA status for this route.
      </div>

      <div class="av-own-assignment-grid">
        <div class="av-own-field">
          <label>Vehicle</label>

          <select
            class="av-select"
            data-field="vehicle_id"
            data-route-id="${escapeHtml(routeId)}"
          >
            ${vehicleOptionsHtml(vehicleId)}
          </select>
        </div>

        <div class="av-own-field">
          <label>Driver</label>

          <select
            class="av-select"
            data-field="driver_user_id"
            data-route-id="${escapeHtml(routeId)}"
          >
            ${driverOptionsHtml(driverId)}
          </select>
        </div>

        <div class="av-own-field">
          <label>Delivery Date</label>

          <input
            class="av-input"
            type="date"
            value="${escapeHtml(routeDate || "")}"
            data-field="planned_delivery_date"
            data-route-id="${escapeHtml(routeId)}"
          />
        </div>

        <div class="av-own-field">
          <label>Start Time</label>

          <input
            class="av-input"
            type="time"
            value="${escapeHtml(start || "")}"
            data-field="planned_start_time"
            data-route-id="${escapeHtml(routeId)}"
          />
        </div>

        <div class="av-own-field">
          <label>End Time</label>

          <input
            class="av-input"
            type="time"
            value="${escapeHtml(end || "")}"
            data-field="planned_end_time"
            data-route-id="${escapeHtml(routeId)}"
          />
        </div>

        <div class="av-own-field">
          <label>ETA</label>

          <select
            class="av-select"
            data-field="eta_finalized"
            data-route-id="${escapeHtml(routeId)}"
          >
            <option
              value="false"
              ${route.eta_finalized === true ? "" : "selected"}
            >
              Planned only
            </option>

            <option
              value="true"
              ${route.eta_finalized === true ? "selected" : ""}
            >
              Confirmed to customer
            </option>
          </select>
        </div>
      </div>

      <div class="av-own-assignment-footer">
        <button
          class="av-own-action-btn av-own-save-btn"
          type="button"
          data-save-route="${escapeHtml(routeId)}"
        >
          Save Assignment
        </button>
      </div>
    </div>
  `;
}

function renderRouteStops(route) {
  const stops = getStopsForRoute(route.id);
  const routeId = String(route.id);

  if (!stops.length) {
    return `
      <div class="av-empty">
        No route stops found for this route.
      </div>
    `;
  }

  return `
    <div class="av-own-stops-section">
      <div class="av-own-stops-head">
        <div>
          <div class="av-own-section-title">
            Route order
          </div>

          <div class="av-own-section-sub">
            Drag stops to change their order, then save the new sequence.
          </div>
        </div>

        <button
          class="av-own-action-btn"
          type="button"
          data-save-stop-order="${escapeHtml(routeId)}"
        >
          Save order
        </button>
      </div>

      <div
        class="av-stops av-own-stops-list"
        data-route-stops="${escapeHtml(routeId)}"
      >
        ${stops.map(stop => renderStop(stop)).join("")}
      </div>
    </div>
  `;
}

function renderStop(stop) {
  const order = getOrderById(stop.order_id);

  const statusValue =
    getStatusValueFromStop(stop, order);

  const stopNumber =
    stop.stop_sequence ||
    stop.stop_number ||
    "—";

  const eta = formatTime(
    stop.planned_arrival_time ||
    stop.arrival_eta ||
    stop.eta ||
    stop.planned_time
  );

  const city =
    stop.city ||
    order?.delivery_city ||
    "—";

  const postcode =
    stop.postcode ||
    order?.delivery_postcode ||
    "—";

  const customerOrderLabel =
    getCustomerOrderLabel(order);

  const title =
    order?.order_number ||
    stop.stop_name ||
    "Stop";

  const retailer =
    getRetailerName(order, stop);

  return `
    <div
      class="av-stop av-own-stop"
      draggable="true"
      data-stop-id="${escapeHtml(stop.id)}"
      data-route-id="${escapeHtml(stop.route_id)}"
    >
      <div class="av-stop-no av-own-stop-number">
        ${escapeHtml(stopNumber)}
      </div>

      <div class="av-own-stop-content">
        <div class="av-own-stop-title">
          ${escapeHtml(title)}
          ·
          ${escapeHtml(retailer)}
        </div>

        ${
          customerOrderLabel
            ? `
              <div class="av-own-stop-ref">
                ${escapeHtml(customerOrderLabel)}
              </div>
            `
            : ""
        }

        <div class="av-own-stop-detail">
          <span>
            ${escapeHtml(city)}
            · ${escapeHtml(postcode)}
          </span>

          <span>·</span>

          <span>
            ETA ${escapeHtml(eta)}
          </span>

          <span>·</span>

          <span>
            Status:
            <span class="av-own-stop-status">
              ${escapeHtml(titleCase(statusValue))}
            </span>
          </span>
        </div>
      </div>

      <div class="av-stop-actions av-own-stop-actions">
        <button
          class="av-stop-action-btn av-stop-action-delivered"
          type="button"
          data-manual-delivered="${escapeHtml(stop.id)}"
        >
          Delivered
        </button>

        <button
          class="av-stop-action-btn av-stop-action-issue"
          type="button"
          data-manual-issue="${escapeHtml(stop.id)}"
        >
          Issue
        </button>

        <button
          class="av-stop-action-btn av-stop-action-failed"
          type="button"
          data-manual-failed="${escapeHtml(stop.id)}"
        >
          Failed
        </button>
      </div>
    </div>
  `;
}

function bindEvents(mount) {

  mount.querySelectorAll("[data-select-vehicle]").forEach(button => {
    button.addEventListener("click", () => {
      const vehicleId = button.dataset.selectVehicle || "";

      window.dispatchEvent(new CustomEvent("veynor:vehicle-selected", {
        detail: { vehicleId }
      }));

      showToast("Vehicle selected for new planning.", "ok");
    });
  });

  mount.querySelectorAll("[data-add-selected-route]").forEach(button => {
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("veynor:add-selected-to-route", {
        detail: {
          routeId: button.dataset.addSelectedRoute
        }
      }));
    });
  });

  mount.querySelectorAll("[data-toggle-vehicle]").forEach(button => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.toggleVehicle || "");
      if (!id) return;

      if (expandedVehicleIds.has(id)) {
        expandedVehicleIds.delete(id);
      } else {
        expandedVehicleIds.add(id);
      }

      render();
    });
  });

  mount.querySelectorAll("[data-toggle-route]").forEach(button => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.toggleRoute || "");
      if (!id) return;

      if (expandedRouteIds.has(id)) {
        expandedRouteIds.delete(id);
      } else {
        expandedRouteIds.add(id);
      }

      render();
    });
  });

mount.querySelectorAll("[data-route-cost]").forEach(card => {
  card.addEventListener("click", () => {
    const routeId = card.dataset.routeCost;

    const panel = document.getElementById(
      `cost-breakdown-${routeId}`
    );

    if (!panel) return;

    panel.classList.toggle("visible");
  });
});

  mount.querySelectorAll("[data-save-route]").forEach(button => {
    button.addEventListener("click", async () => {
      await saveRouteAssignment(button.dataset.saveRoute);
    });
  });

  mount.querySelectorAll("[data-send-driver]").forEach(button => {
    button.addEventListener("click", async () => {
      await sendRouteToDriver(button.dataset.sendDriver);
    });
  });

  mount.querySelectorAll("[data-remove-route]").forEach(button => {
    button.addEventListener("click", async () => {
      await removeRoute(button.dataset.removeRoute);
    });
  });

  mount.querySelectorAll("[data-remove-charter]").forEach(button => {
    button.addEventListener("click", async () => {
      await removeCharterOrder(button.dataset.removeCharter);
    });
  });

  mount.querySelectorAll("[data-save-stop-order]").forEach(button => {
    button.addEventListener("click", async () => {
      await saveStopOrder(button.dataset.saveStopOrder);
    });
  });

  mount.querySelectorAll("[data-manual-delivered]").forEach(button => {
    button.addEventListener("click", async () => {
      await manuallyCompleteStop(
        button.dataset.manualDelivered,
        "delivered"
      );
    });
  });

  mount.querySelectorAll("[data-manual-issue]").forEach(button => {
    button.addEventListener("click", async () => {
      await manuallyCompleteStop(
        button.dataset.manualIssue,
        "delivery_issue"
      );
    });
  });

  mount.querySelectorAll("[data-manual-failed]").forEach(button => {
    button.addEventListener("click", async () => {
      await manuallyCompleteStop(
        button.dataset.manualFailed,
        "failed_delivery"
      );
    });
  });

  bindDragAndDrop(mount);
  mount.querySelectorAll("[data-fds-notice]").forEach(button => {
    button.addEventListener("click", async () => {
      await generateFdsNoticePdf(button.dataset.fdsNotice);
    });
  });

mount.querySelectorAll("[data-fds-upload-signed]").forEach(button => {
  button.addEventListener("click", () => {
    const vehicleId = button.dataset.fdsUploadSigned;

    const input = mount.querySelector(
      `[data-fds-upload-input="${CSS.escape(String(vehicleId))}"]`
    );

    input?.click();
  });
});

mount.querySelectorAll("[data-fds-upload-input]").forEach(input => {
  input.addEventListener("change", async () => {
    const vehicleId = input.dataset.fdsUploadInput;
    const file = input.files?.[0];

    if (!file) return;

    await uploadSignedFdsNotice(vehicleId, file);
    input.value = "";
  });
});

  mount.querySelectorAll("[data-fds-delivery-notes]").forEach(button => {
    button.addEventListener("click", async () => {
      await generateFdsDeliveryNotes(button.dataset.fdsDeliveryNotes);
    });
  });

mount.querySelectorAll("[data-fds-labels]").forEach(button => {
  button.addEventListener("click", async () => {
    await generateFdsDeliveryLabels(button.dataset.fdsLabels);
  });
});


}


  function bindDragAndDrop(mount) {
    mount.querySelectorAll(".av-stop[draggable='true']").forEach(stopEl => {
      stopEl.addEventListener("dragstart", event => {
        draggedStopId = stopEl.dataset.stopId || "";
        stopEl.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedStopId);
      });

      stopEl.addEventListener("dragend", () => {
        draggedStopId = null;
        stopEl.classList.remove("dragging");
        mount.querySelectorAll(".av-stop").forEach(el => el.classList.remove("drop-target"));
      });

      stopEl.addEventListener("dragover", event => {
        event.preventDefault();
        stopEl.classList.add("drop-target");
      });

      stopEl.addEventListener("dragleave", () => {
        stopEl.classList.remove("drop-target");
      });

      stopEl.addEventListener("drop", event => {
        event.preventDefault();
        stopEl.classList.remove("drop-target");

        const sourceId = draggedStopId || event.dataTransfer.getData("text/plain");
        const targetId = stopEl.dataset.stopId || "";

        if (!sourceId || !targetId || sourceId === targetId) return;

        moveStopElement(sourceId, targetId);
      });
    });
  }

  function moveStopElement(sourceId, targetId) {
    const source = document.querySelector(`.av-stop[data-stop-id="${CSS.escape(String(sourceId))}"]`);
    const target = document.querySelector(`.av-stop[data-stop-id="${CSS.escape(String(targetId))}"]`);

    if (!source || !target) return;

    const list = target.closest(".av-stops");
    if (!list) return;

    const children = Array.from(list.querySelectorAll(".av-stop"));
    const sourceIndex = children.indexOf(source);
    const targetIndex = children.indexOf(target);

    if (sourceIndex < 0 || targetIndex < 0) return;

    if (sourceIndex < targetIndex) {
      target.after(source);
    } else {
      target.before(source);
    }

    renumberStopElements(list);
  }

  function renumberStopElements(list) {
    Array.from(list.querySelectorAll(".av-stop")).forEach((el, index) => {
      const no = el.querySelector(".av-stop-no");
      if (no) no.textContent = String(index + 1);
    });
  }

  async function saveStopOrder(routeId) {
    try {
      const db = ensureClient();
      const cid = getCompanyId();

      if (!cid) throw new Error("Company id missing.");
      if (!routeId) throw new Error("Route id missing.");

      const list = document.querySelector(`[data-route-stops="${CSS.escape(String(routeId))}"]`);
      if (!list) throw new Error("Route stop list not found.");

      const stopIds = Array.from(list.querySelectorAll(".av-stop"))
        .map(el => el.dataset.stopId)
        .filter(Boolean);

      if (!stopIds.length) throw new Error("No stops found.");

      for (let index = 0; index < stopIds.length; index++) {
        const stopId = stopIds[index];

        const { error } = await db
          .from("route_stops")
          .update({
            stop_sequence: index + 1,
            stop_number: index + 1
          })
          .eq("company_id", cid)
          .eq("id", stopId);

        if (error) throw error;
      }

      showToast("Route order saved.", "ok");
      notifyRoutesChanged();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not save route order.", "err");
    }
  }

  function getRouteFormValues(routeId) {
    const selector = `[data-route-id="${CSS.escape(String(routeId))}"]`;

    const vehicleId = document.querySelector(`${selector}[data-field="vehicle_id"]`)?.value || "";
    const driverId = document.querySelector(`${selector}[data-field="driver_user_id"]`)?.value || "";
    const plannedDeliveryDate = document.querySelector(`${selector}[data-field="planned_delivery_date"]`)?.value || selectedPlanningDate;
    const plannedStartTime = document.querySelector(`${selector}[data-field="planned_start_time"]`)?.value || "";
    const plannedEndTime = document.querySelector(`${selector}[data-field="planned_end_time"]`)?.value || "";
    const etaFinalized = document.querySelector(`${selector}[data-field="eta_finalized"]`)?.value === "true";

    return {
      vehicleId,
      driverId,
      plannedDeliveryDate,
      plannedStartTime,
      plannedEndTime,
      etaFinalized
    };
  }

async function saveRouteAssignment(routeId) {
  try {
    const db = ensureClient();
    const cid = getCompanyId();

    if (!cid) throw new Error("Company id missing.");
    if (!routeId) throw new Error("Route id missing.");

    const values = getRouteFormValues(routeId);
    const vehicle = activeVehicles.find(v => String(v.id) === String(values.vehicleId));
    const driver = getDriverById(values.driverId);

    const routePayload = {
      vehicle_id: values.vehicleId || null,
      assigned_vehicle_id: values.vehicleId || null,
      vehicle_name: vehicle ? getVehicleName(vehicle) : null,
      assigned_vehicle_name: vehicle ? getVehicleName(vehicle) : null,
      vehicle_registration: vehicle ? getVehicleRegistration(vehicle) : null,
      driver_user_id: values.driverId || null,
      driver_profile_id: values.driverId || null,
      driver_name: driver ? getDriverName(driver) : null,
      driver_email: driver ? getDriverEmail(driver) : null,
      planned_delivery_date: values.plannedDeliveryDate || null,
      route_date: values.plannedDeliveryDate || null,
      planned_start_time: values.plannedStartTime || null,
      planned_end_time: values.plannedEndTime || null,
      eta_finalized: values.etaFinalized,
      route_status: "planned"
    };

    const { error: routeError } = await db
      .from("routes")
      .update(routePayload)
      .eq("company_id", cid)
      .eq("id", routeId);

    if (routeError) throw routeError;

    const stops = getStopsForRoute(routeId);
    const orderIds = stops.map(stop => stop.order_id).filter(Boolean);

    if (orderIds.length) {
      const orderPayload = {
        driver_user_id: values.driverId || null,
        driver_profile_id: values.driverId || null,
        driver_name: driver ? getDriverName(driver) : null,
        driver_email: driver ? getDriverEmail(driver) : null,
        expected_delivery_date: values.plannedDeliveryDate || null,
        planned_route_date: values.plannedDeliveryDate || null,
        delivery_eta_status: values.etaFinalized ? "confirmed" : "planned",
        status: "planned",
        transport_status: "planned",
        transport_type: "own_transport"
      };

      const { error: orderError } = await db
        .from("orders")
        .update(orderPayload)
        .eq("company_id", cid)
        .in("id", orderIds);

      if (orderError) throw orderError;
    }

    showToast("Route assignment saved.", "ok");
    notifyRoutesChanged();

  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not save route assignment.", "err");
  }
}

  async function sendRouteToDriver(routeId) {
    try {
      const db = ensureClient();
      const cid = getCompanyId();

      if (!cid) throw new Error("Company id missing.");

      const route = allRoutes.find(row => String(row.id) === String(routeId));
      if (!route) throw new Error("Route not found.");

      const driverId = getRouteDriverId(route);

      if (!driverId) {
        showToast("Assign a driver before sending this route.", "err");
        expandedRouteIds.add(String(routeId));
        render();
        return;
      }

      const orderIds = getStopsForRoute(routeId).map(stop => stop.order_id).filter(Boolean);

      if (!orderIds.length) {
        showToast("This route has no orders.", "err");
        return;
      }

      const now = new Date().toISOString();

      const { error: routeError } = await db
        .from("routes")
        .update({
          route_status: "sent_to_driver",
          sent_to_driver_at: now
        })
        .eq("company_id", cid)
        .eq("id", routeId);

      if (routeError) throw routeError;

      const { error: stopError } = await db
        .from("route_stops")
        .update({
          status: "sent_to_driver",
          delivery_status: "sent_to_driver"
        })
        .eq("company_id", cid)
        .eq("route_id", routeId);

      if (stopError) throw stopError;

      const { error: orderError } = await db
        .from("orders")
        .update({
          status: "sent_to_driver",
          transport_status: "sent_to_driver",
          sent_to_driver_at: now,
          driver_user_id: driverId,
          driver_profile_id: driverId,
          driver_name: getRouteDriverName(route),
          driver_email: route.driver_email || getDriverEmailById(driverId)
        })
        .eq("company_id", cid)
        .in("id", orderIds);

      if (orderError) throw orderError;

      showToast("Route sent to driver app.", "ok");
      notifyRoutesChanged();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not send route to driver.", "err");
    }
  }

  async function manuallyCompleteStop(stopId, status) {
  try {
    const db = ensureClient();
    const cid = getCompanyId();

    if (!cid) throw new Error("Company id missing.");

    const stop = allStops.find(s => String(s.id) === String(stopId));
    if (!stop) throw new Error("Stop not found.");

    const route = allRoutes.find(r => String(r.id) === String(stop.route_id));
    const now = new Date().toISOString();

    const orderStatus =
      status === "delivered"
        ? "delivered"
        : status === "delivery_issue"
        ? "delivery_issue"
        : "failed_delivery";

    // -----------------------------
    // Update ONLY this route stop
    // -----------------------------
    const { error: stopError } = await db
      .from("route_stops")
      .update({
        status: orderStatus,
        delivery_status: orderStatus,
        completed_at: now,
        delivery_time: now,
        delivery_date: now.slice(0, 10)
      })
      .eq("company_id", cid)
      .eq("id", stop.id);

    if (stopError) throw stopError;

    // -----------------------------
    // Update ONLY this order
    // -----------------------------
    const orderPayload = {
      status: orderStatus,
      transport_status: orderStatus,
      warehouse_status:
        orderStatus === "delivered"
          ? "delivered"
          : "planned",

      overall_status: orderStatus,

      confirmed_delivery_date:
        orderStatus === "delivered"
          ? now.slice(0, 10)
          : null,

      last_activity_at: now
    };

    const { error: orderError } = await db
      .from("orders")
      .update(orderPayload)
      .eq("company_id", cid)
      .eq("id", stop.order_id);

    if (orderError) throw orderError;

    // -----------------------------
    // Update route status
    // -----------------------------
    if (route) {
      await updateRouteStatusAfterStopChange(route.id);
    }

    // -----------------------------
    // Refresh planner + OCC
    // -----------------------------
notifyRoutesChanged();

// Refresh Operations Control Center
if (window.OCCReloadOrders) {
    await window.OCCReloadOrders();
}

// Refresh planner
if (window.VeynorAvailableVehicles?.refresh) {
    window.VeynorAvailableVehicles.refresh();
}

    showToast(
      `Order marked as ${orderStatus.replaceAll("_", " ")}.`,
      "ok"
    );

  } catch (error) {
    console.error(error);
    showToast(
      error.message || "Could not update delivery status.",
      "err"
    );
  }
}


  async function updateRouteStatusAfterStopChange(routeId) {
    const db = ensureClient();
    const cid = getCompanyId();

    const { data: stops, error } = await db
      .from("route_stops")
      .select("id,status,delivery_status")
      .eq("company_id", cid)
      .eq("route_id", routeId);

    if (error) throw error;

    const values = (stops || []).map(stop => normalize(stop.delivery_status || stop.status || "planned"));

    let routeStatus = "sent_to_driver";

    if (values.length && values.every(isDeliveredStatus)) routeStatus = "delivered";
    else if (values.some(isFailedStatus)) routeStatus = "failed_delivery";
    else if (values.some(isIssueStatus)) routeStatus = "delivery_issue";
    else if (values.some(v => ["out_for_delivery", "loaded", "sent_to_driver"].includes(v))) routeStatus = "out_for_delivery";

const routePayload = {
  route_status: routeStatus,
  updated_at: new Date().toISOString()
};

if (routeStatus === "delivered") {
  routePayload.completed_at = new Date().toISOString();

  if ("actual_delivery_date" in (route || {})) {
    routePayload.actual_delivery_date = new Date().toISOString().slice(0, 10);
  }

  if ("completed_by" in (route || {})) {
    routePayload.completed_by = currentUser?.id || null;
  }
}

const { error: routeError } = await db
  .from("routes")
  .update(routePayload)
  .eq("company_id", cid)
  .eq("id", routeId);

if (routeError) throw routeError;
}

async function removeRoute(routeId) {
    try {
      const db = ensureClient();
      const cid = getCompanyId();

      if (!cid) throw new Error("Company id missing.");

      const route = allRoutes.find(row => String(row.id) === String(routeId));
      if (!route) throw new Error("Route not found.");

      const ok = window.confirm(`Remove route ${getRouteLabel(route)} and return orders to planning?`);
      if (!ok) return;

      const orderIds = getStopsForRoute(routeId).map(stop => stop.order_id).filter(Boolean);

      if (orderIds.length) {
        const { error: orderError } = await db
          .from("orders")
          .update({
            route_id: null,
            status: "ready_for_planning",
            transport_status: null,
            transport_type: "unassigned",
            driver_user_id: null,
            driver_profile_id: null,
            driver_name: null,
            driver_email: null,
            sent_to_driver_at: null,
            expected_delivery_date: null,
            planned_route_date: null,
            delivery_eta_from: null,
            delivery_eta_to: null,
            delivery_eta_status: "pending"
          })
          .eq("company_id", cid)
          .in("id", orderIds);

        if (orderError) throw orderError;
      }

      const { error: stopError } = await db
        .from("route_stops")
        .delete()
        .eq("company_id", cid)
        .eq("route_id", routeId);

      if (stopError) throw stopError;

      const { error: routeError } = await db
        .from("routes")
        .delete()
        .eq("company_id", cid)
        .eq("id", routeId);

      if (routeError) throw routeError;

      expandedRouteIds.delete(String(routeId));

      showToast("Route removed.", "ok");
      notifyRoutesChanged();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not remove route.", "err");
    }
  }

async function removeCharterOrder(orderId) {
  try {
    const db = ensureClient();
    const cid = getCompanyId();

    if (!cid) throw new Error("Company id missing.");
    if (!orderId) throw new Error("Order id missing.");

    const ok = window.confirm(
      "Return this order to Own Transport planning?"
    );

    if (!ok) return;

    const { error } = await db
      .from("orders")
      .update({
        transport_type: "own_transport",
        status: "ready_for_planning",
        carrier_vehicle_id: null,
        route_id: null,
        transport_status: null,
        planned_route_date: null,
        expected_delivery_date: null,
        driver_user_id: null,
        driver_profile_id: null,
        driver_name: null,
        driver_email: null,
        delivery_eta_from: null,
        delivery_eta_to: null,
        delivery_eta_status: "pending"
      })
      .eq("company_id", cid)
      .eq("id", orderId);

    if (error) throw error;

    showToast("Order returned to planning.", "ok");
    notifyRoutesChanged();

  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not remove charter order.", "err");
  }
}

async function generateFdsNoticePdf(vehicleId) {
  try {
    const db = ensureClient();
    const cid = getCompanyId();

    const vehicle = activeVehicles.find(v => String(v.id) === String(vehicleId));
    const baseOrders = vehicle ? getCarrierOrders(vehicle) : [];

    if (!vehicle) throw new Error("Carrier not found.");
    if (!baseOrders.length) throw new Error("No FDS orders found.");

    if (!window.FdsNoticeGenerator?.generate) {
      throw new Error("FDS Notice Generator not loaded.");
    }

    const orderIds = baseOrders.map(order => order.id);

    const { data: fullOrders, error } = await db
      .from("orders")
.select(`
  *,
  order_lines (
    id,
    quantity_ordered,
    line_type,
    packages_per_unit,
    total_packages,
    requested_package_no,
    requested_package_total,
    unit_weight_kg,
    total_line_weight_kg,
    products (
      id,
      weight_kg,
      net_weight_kg,
      package_count,
      packages_per_unit,
      package_1_qty,
      package_2_qty,
      package_3_qty
    )
  )
`)
      .eq("company_id", cid)
      .in("id", orderIds);

    if (error) throw error;

    const fullOrderMap = new Map(
      (fullOrders || []).map(order => [String(order.id), order])
    );

    const orders = baseOrders.map(order => ({
      ...order,
      ...(fullOrderMap.get(String(order.id)) || {})
    }));

    await window.FdsNoticeGenerator.generate({
      vehicle,
      orders,
      logoUrl: ""
    });

    showToast("FDS Notice PDF generated.", "ok");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not generate FDS Notice PDF.", "err");
  }
}

async function uploadSignedFdsNotice(vehicleId, file) {
  const button = document.querySelector(
    `[data-fds-upload-signed="${CSS.escape(String(vehicleId))}"]`
  );

  const oldText = button?.textContent || "Upload Signed Notice";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Uploading... ⏳";
    }

    const db = ensureClient();
    const cid = getCompanyId();

    if (!cid) throw new Error("Company id missing.");
    if (!file) throw new Error("No file selected.");

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png"
    ];

    if (!allowedTypes.includes(file.type)) {
      throw new Error("Upload a PDF, JPG or PNG file.");
    }

    const maxSize = 15 * 1024 * 1024;

    if (file.size > maxSize) {
      throw new Error("The file may not be larger than 15 MB.");
    }

    const vehicle = activeVehicles.find(
      row => String(row.id) === String(vehicleId)
    );

    if (!vehicle) throw new Error("Carrier not found.");

    const orders = getCarrierOrders(vehicle);

    if (!orders.length) {
      throw new Error("No FDS orders found.");
    }

    const extension =
      file.name.split(".").pop()?.toLowerCase() ||
      (file.type === "application/pdf" ? "pdf" : "jpg");

    const timestamp = Date.now();
    const datePart = new Date().toISOString().slice(0, 10);

    const fileName =
      `FDS-Signed-Collection-Notice-${datePart}-${timestamp}.${extension}`;

    const storagePath =
      `${cid}/fds-signed-notices/${datePart}/${fileName}`;

    showToast("Uploading signed FDS notice...", "ok");

    const { error: uploadError } = await db.storage
      .from("order-documents")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = db.storage
      .from("order-documents")
      .getPublicUrl(storagePath);

    const fileUrl = publicUrlData?.publicUrl || "";

    if (!fileUrl) {
      throw new Error("The uploaded file URL could not be created.");
    }

    const now = new Date().toISOString();

    for (const order of orders) {
      const payload = {
        company_id: cid,
        customer_id: order.customer_id || null,
        order_id: order.id,
        document_type: "fds_signed_collection_notice",
        document_number: `FDS-${datePart}`,
        document_status: "signed",
        file_url: fileUrl,
        storage_path: storagePath,
        customer_visible: false,
        updated_at: now
      };

      const { data: existing, error: findError } = await db
        .from("order_documents")
        .select("id")
        .eq("order_id", order.id)
        .eq("document_type", "fds_signed_collection_notice")
        .maybeSingle();

      if (findError) throw findError;

      if (existing?.id) {
        const { error: updateError } = await db
          .from("order_documents")
          .update(payload)
          .eq("id", existing.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await db
          .from("order_documents")
          .insert({
            ...payload,
            created_at: now
          });

        if (insertError) throw insertError;
      }
    }

orders.forEach(order => {
  signedNoticeOrderIds.add(String(order.id));
});

if (button) {
  button.textContent = "Signed Notice ✓";
  button.classList.remove("warning");
  button.classList.add("success");
}

showToast(
  `Signed FDS notice linked to ${orders.length} order(s).`,
  "ok"
);  } catch (error) {
    console.error(error);

    showToast(
      error.message || "Could not upload signed FDS notice.",
      "err"
    );

    if (button) {
      button.textContent = oldText;
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function generateFdsDeliveryNotes(vehicleId) {
  const button = document.querySelector(
    `[data-fds-delivery-notes="${CSS.escape(String(vehicleId))}"]`
  );
  const oldText = button?.textContent || "Generate Delivery Notes";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Generating... ⏳";
    }

    const db = ensureClient();
    const cid = getCompanyId();

    const vehicle = activeVehicles.find(v => String(v.id) === String(vehicleId));
    if (!vehicle) throw new Error("Carrier not found.");

    const orders = getCarrierOrders(vehicle);
    if (!orders.length) throw new Error("No FDS orders found.");

    if (!window.DeliveryNoteGenerator?.generate) {
      throw new Error("Delivery Note Generator is not loaded.");
    }

    if (!window.PDFLib?.PDFDocument) {
      throw new Error("pdf-lib is not loaded.");
    }

    showToast("Generating and combining delivery notes...", "ok");

    const pdfUrls = [];

    for (const order of orders) {
      try {
        const uploaded = await window.DeliveryNoteGenerator.generate(order, db, cid);
        if (uploaded?.fileUrl) pdfUrls.push(uploaded.fileUrl);
      } catch (error) {
        console.warn(`Delivery note skipped for ${order.order_number}:`, error.message);
      }
    }

    if (!pdfUrls.length) throw new Error("No delivery note PDFs were generated.");

    const mergedPdf = await window.PDFLib.PDFDocument.create();

    for (const url of pdfUrls) {
      const response = await fetch(url);
      if (!response.ok) continue;

      const bytes = await response.arrayBuffer();
      const pdf = await window.PDFLib.PDFDocument.load(bytes);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    }

    const mergedBytes = await mergedPdf.save();
    const blob = new Blob([mergedBytes], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `FDS Delivery Notes ${today}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    showToast("FDS delivery notes downloaded.", "ok");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not generate delivery notes.", "err");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText;
    }
  }
}

async function generateFdsDeliveryLabels(vehicleId) {
  const button = document.querySelector(
    `[data-fds-labels="${CSS.escape(String(vehicleId))}"]`
  );
  const oldText = button?.textContent || "Generate Labels";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Generating... ⏳";
    }

    const vehicle = activeVehicles.find(v => String(v.id) === String(vehicleId));
    if (!vehicle) throw new Error("Carrier not found.");

    const orders = getCarrierOrders(vehicle);
    if (!orders.length) throw new Error("No FDS orders found.");

    if (!window.DeliveryLabelGenerator?.generate) {
      throw new Error("Delivery Label Generator is not loaded.");
    }

    if (!window.PDFLib?.PDFDocument) {
      throw new Error("pdf-lib is not loaded.");
    }

    showToast("Generating labels...", "ok");

    const pdfUrls = [];

    for (const order of orders) {
      try {
        const uploaded = await window.DeliveryLabelGenerator.generate(order.id);
        if (uploaded?.fileUrl) pdfUrls.push(uploaded.fileUrl);
      } catch (error) {
        console.warn(`Labels skipped for ${order.order_number}:`, error.message);
      }
    }

    if (!pdfUrls.length) throw new Error("No label PDFs were generated.");

    showToast("Combining labels...", "ok");

    const mergedPdf = await window.PDFLib.PDFDocument.create();

    for (const url of pdfUrls) {
      const response = await fetch(url);
      if (!response.ok) continue;

      const bytes = await response.arrayBuffer();
      const pdf = await window.PDFLib.PDFDocument.load(bytes);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    }

    const mergedBytes = await mergedPdf.save();
    const blob = new Blob([mergedBytes], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `FDS Delivery Labels ${today}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    showToast("FDS labels downloaded.", "ok");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not generate labels.", "err");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText;
    }
  }
}

  function notifyRoutesChanged() {
    window.dispatchEvent(new CustomEvent("veynor:routes-changed"));
  }

  function refresh() {
    render();
  }

async function init() {
  try {
ensureClient();
injectStyles();
syncFromPlannerData();

await loadSignedFdsNoticeStatus();

render();

setTimeout(async () => {
  syncFromPlannerData();
  await loadSignedFdsNoticeStatus();
  render();
}, 800);
    byId("btnVehicleModuleRefresh")?.addEventListener("click", () => {
      notifyRoutesChanged();
    });

window.addEventListener(
  "veynor:planner-data-changed",
  async event => {
    syncFromPlannerData(event.detail);
    await loadSignedFdsNoticeStatus();
    render();
  }
);
    window.addEventListener("veynor:planner-selection-changed", event => {
      const detail = event.detail || {};

      selectedOrderIds = Array.isArray(detail.selectedOrderIds)
        ? detail.selectedOrderIds.map(String)
        : [];

      render();
    });

    log("Available Vehicles module loaded.");

  } catch (error) {
    console.error(error);
    showToast(
      error.message || "Could not load available vehicles module.",
      "err"
    );
  }
}

window.VeynorAvailableVehicles = {
  refresh,
  sendRouteToDriver,
  saveRouteAssignment,
  removeRoute,
  saveStopOrder,
  manuallyCompleteStop,
  generateFdsNoticePdf,

  getDashboardSummary() {
    syncFromPlannerData();

    const today = new Date().toISOString().slice(0, 10);

    const todayRoutes = allRoutes.filter(route => {
      const date = getRouteDate(route);
      return date && date === today;
    });

    const routeSummaries = todayRoutes.map(route => {
      const summary = getRouteSummary(route);

      return {
        id: route.id,
        label: getRouteLabel(route),
        stops: summary.totalStops,
        volume: summary.totalVolume,
        revenue: summary.revenue,
        cost: summary.cost,
        result: summary.result
      };
    });

    const fdsVehicle = activeVehicles.find(vehicle =>
      getVehicleType(vehicle) === "carrier" ||
      normalize(getVehicleName(vehicle)) === "fds"
    );

    const fdsOrders = fdsVehicle ? getCarrierOrders(fdsVehicle) : [];

    return {
      todayRoutes: routeSummaries,
      todayRouteTotals: {
        count: routeSummaries.length,
        revenue: routeSummaries.reduce((sum, row) => sum + row.revenue, 0),
        cost: routeSummaries.reduce((sum, row) => sum + row.cost, 0),
        result: routeSummaries.reduce((sum, row) => sum + row.result, 0)
      },
      fds: {
        count: fdsOrders.length,
        colli: fdsOrders.reduce((sum, order) => sum + getOrderColli(order), 0),
        volume: fdsOrders.reduce((sum, order) => sum + getOrderVolume(order), 0),
        weight: fdsOrders.reduce((sum, order) => sum + getOrderWeight(order), 0),
        orders: fdsOrders.map(order => ({
          id: order.id,
          order_number: order.order_number,
          retailer: getRetailerName(order),
          city: order.delivery_city,
          postcode: order.delivery_postcode,
          colli: getOrderColli(order),
          volume: getOrderVolume(order),
          weight: getOrderWeight(order)
        }))
      }
    };
  }
};

document.addEventListener("DOMContentLoaded", init);
})();