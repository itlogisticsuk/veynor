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

  const expandedVehicleIds = new Set();
  const expandedRouteIds = new Set();

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

const fuelCost =
  toNumber(route?.estimated_cost_fuel_gbp, 0);

const fuelLitres =
  toNumber(route?.estimated_fuel_litres, 0);

const cost =
  toNumber(route?.estimated_cost_total_gbp, 0) ||
  toNumber(route?.total_cost_gbp, 0);

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
      revenue,
      cost,
      result
    };
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
      .av-btn.danger{background:#dc2626;border-color:#dc2626;color:#fff;}
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
        No vehicles available. Check Settings → Transport and make sure vehicles are active and enabled for planning.
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
          <div class="av-day-title">Available Vehicles</div>
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

  function renderVehicle(vehicle) {
    const vehicleId = String(vehicle.id);
    const routes = getRoutesForVehicle(vehicle);
    const expanded = expandedVehicleIds.has(vehicleId);
    const capacity = getVehicleCapacity(vehicle);
    const primaryRoute = getPrimaryRouteForVehicle(vehicle);
    const hasRoute = routes.length > 0;
    const dotClass = routeDotClass(vehicle);
    const driverName = primaryRoute ? getRouteDriverName(primaryRoute) : "";
    const routeLabel = primaryRoute ? getRouteLabel(primaryRoute) : "";

    return `
      <div class="av-vehicle ${hasRoute ? "has-route" : ""}" data-vehicle-id="${escapeHtml(vehicleId)}">
        <div class="av-vehicle-head">
          <div class="av-vehicle-title">
            <span class="av-dot ${escapeHtml(dotClass)}"></span>

            <div>
              <div class="av-name-row">
                <span class="av-name">${escapeHtml(getVehicleName(vehicle))}</span>
                ${hasRoute ? `<span class="av-route-inline">${escapeHtml(routeLabel)}</span>` : ""}
                ${hasRoute ? `<span class="av-driver-inline">${escapeHtml(driverName)}</span>` : ""}
              </div>

              <div class="av-sub">
                ${escapeHtml(getVehicleType(vehicle))}
                · ${escapeHtml(getVehicleRegistration(vehicle))}
                · ${capacity ? `${formatNumber(capacity, 1)} m³` : "capacity unknown"}
                · ${formatNumber(routes.length)} route(s)
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
              <div class="av-route-list">
                ${
                  routes.length
                    ? routes.map(route => renderRoute(route, vehicle)).join("")
                    : `<div class="av-empty">No route assigned to this vehicle for this planning date.</div>`
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

    return `
      <div class="av-route ${open ? "open" : ""}" data-route-id="${escapeHtml(routeId)}">
        <div class="av-route-head">
          <div>
            <div class="av-route-title">
              ${escapeHtml(getRouteLabel(route))}
              <span class="av-status ${escapeHtml(statusClass)}">${escapeHtml(titleCase(routeStatus))}</span>
            </div>

            <div class="av-route-sub">
              ${escapeHtml(formatDate(getRouteDate(route)))}
              · Driver: ${escapeHtml(getRouteDriverName(route))}
              · ${escapeHtml(formatTime(route.planned_start_time || route.start_time))}
              → ${escapeHtml(formatTime(route.planned_end_time || route.end_time))}
            </div>
          </div>

          <div class="av-actions">
            <button class="av-btn" type="button" data-toggle-route="${escapeHtml(routeId)}">${open ? "Close" : "Details"}</button>
            <button class="av-btn primary" type="button" data-add-selected-route="${escapeHtml(routeId)}">Add selected</button>
<button class="av-btn success" type="button" data-send-driver="${escapeHtml(routeId)}">Send</button>
<button class="av-btn danger" type="button" data-remove-route="${escapeHtml(routeId)}">Remove</button>
          </div>
        </div>

        <div class="av-route-kpis">
  <div class="av-kpi">
    <span>Stops</span>
    <strong>${formatNumber(summary.totalStops)}</strong>
  </div>

  <div class="av-kpi">
    <span>Volume</span>
    <strong>${formatNumber(summary.totalVolume, 1)} m³</strong>
  </div>

  <div class="av-kpi">
    <span>Miles</span>
    <strong>${formatNumber(summary.distanceMiles, 1)} mi</strong>
  </div>

  <div class="av-kpi">
    <span>Hours</span>
    <strong>${formatNumber(summary.totalHours, 1)} h</strong>
  </div>

  <div class="av-kpi">
    <span>Revenue</span>
    <strong>${formatMoney(summary.revenue)}</strong>
  </div>

  <div class="av-kpi av-cost-breakdown-toggle"
       data-route-cost="${route.id}"
       style="cursor:pointer;">
    <span>Cost ▼</span>
    <strong>${formatMoney(summary.cost)}</strong>
  </div>

  <div class="av-kpi">
    <span>Result</span>
    <strong>${formatMoney(summary.result)}</strong>
  </div>
</div>

<div class="av-cost-breakdown"
     id="cost-breakdown-${route.id}"
     style="display:none;margin:10px;padding:12px;border:1px solid var(--border);border-radius:8px;background:#fafafa;">

  <div style="font-weight:900;margin-bottom:10px;">
    Route Cost Breakdown
  </div>

  <div style="display:grid;grid-template-columns:1fr auto;gap:4px;">
   <div>Fuel Cost</div>
<div>${formatMoney(route.estimated_cost_fuel_gbp || 0)}</div>

<div>Fuel Used</div>
<div>${formatNumber(route.estimated_fuel_litres || 0, 1)} L</div>

<div>Vehicle Cost</div>
<div>${formatMoney(route.estimated_cost_vehicle_gbp || 0)}</div>

<div>Driver Cost</div>
<div>${formatMoney(route.estimated_cost_labour_gbp || 0)}</div>

    <div>Total Miles</div>
    <div>${formatNumber(summary.distanceMiles, 1)} mi</div>

    <div>Total Hours</div>
    <div>${formatNumber(summary.totalHours, 1)} h</div>

    <div style="font-weight:900;margin-top:8px;">Total Cost</div>
    <div style="font-weight:900;margin-top:8px;">
      ${formatMoney(summary.cost)}
    </div>

    <div style="font-weight:900;">Revenue</div>
    <div style="font-weight:900;">
      ${formatMoney(summary.revenue)}
    </div>

    <div style="font-weight:900;">Result</div>
    <div style="font-weight:900;color:${summary.result >= 0 ? '#16a34a' : '#dc2626'};">
      ${formatMoney(summary.result)}
    </div>
  </div>
</div>

        <div class="av-route-extra">
          ${renderRouteAssignment(route, vehicle)}
          ${renderRouteStops(route)}
        </div>
      </div>
    `;
  }

  function renderRouteAssignment(route, vehicle) {
    const routeId = String(route.id);
    const vehicleId = route.vehicle_id || route.assigned_vehicle_id || vehicle?.id || "";
    const driverId = getRouteDriverId(route);
    const routeDate = getRouteDate(route) || selectedPlanningDate;
    const start = formatTime(route.planned_start_time || route.start_time || "08:00").replace("—", "");
    const end = formatTime(route.planned_end_time || route.end_time || "").replace("—", "");

    return `
      <div class="av-form-grid">
        <div class="av-field">
          <label>Vehicle</label>
          <select class="av-select" data-field="vehicle_id" data-route-id="${escapeHtml(routeId)}">
            ${vehicleOptionsHtml(vehicleId)}
          </select>
        </div>

        <div class="av-field">
          <label>Driver</label>
          <select class="av-select" data-field="driver_user_id" data-route-id="${escapeHtml(routeId)}">
            ${driverOptionsHtml(driverId)}
          </select>
        </div>

        <div class="av-field">
          <label>Delivery Date</label>
          <input class="av-input" type="date" value="${escapeHtml(routeDate || "")}" data-field="planned_delivery_date" data-route-id="${escapeHtml(routeId)}"/>
        </div>

        <div class="av-field">
          <label>Start Time</label>
          <input class="av-input" type="time" value="${escapeHtml(start || "")}" data-field="planned_start_time" data-route-id="${escapeHtml(routeId)}"/>
        </div>

        <div class="av-field">
          <label>End Time</label>
          <input class="av-input" type="time" value="${escapeHtml(end || "")}" data-field="planned_end_time" data-route-id="${escapeHtml(routeId)}"/>
        </div>

        <div class="av-field">
          <label>ETA</label>
          <select class="av-select" data-field="eta_finalized" data-route-id="${escapeHtml(routeId)}">
            <option value="false" ${route.eta_finalized === true ? "" : "selected"}>Planned only</option>
            <option value="true" ${route.eta_finalized === true ? "selected" : ""}>Confirmed to customer</option>
          </select>
        </div>
      </div>

      <div class="av-actions">
        <button class="av-btn primary" type="button" data-save-route="${escapeHtml(routeId)}">Save Assignment</button>
      </div>
    `;
  }

  function renderRouteStops(route) {
    const stops = getStopsForRoute(route.id);
    const routeId = String(route.id);

    if (!stops.length) {
      return `<div class="av-empty">No route stops found for this route.</div>`;
    }

    return `
      <div class="av-stops-head">
        <div>
          <div class="av-stops-title">Route order</div>
          <div class="av-drag-hint">Drag stops to change the order. Then press Save order.</div>
        </div>

        <button class="av-btn primary" type="button" data-save-stop-order="${escapeHtml(routeId)}">
          Save order
        </button>
      </div>

      <div class="av-stops" data-route-stops="${escapeHtml(routeId)}">
        ${stops.map(stop => renderStop(stop)).join("")}
      </div>
    `;
  }

  function renderStop(stop) {
  const order = getOrderById(stop.order_id);
  const statusValue = getStatusValueFromStop(stop, order);
  const cls = statusClassFromValue(statusValue);
  const stopNumber = stop.stop_sequence || stop.stop_number || "—";
  const eta = formatTime(
    stop.planned_arrival_time ||
    stop.arrival_eta ||
    stop.eta ||
    stop.planned_time
  );

  const city = stop.city || order?.delivery_city || "—";
  const postcode = stop.postcode || order?.delivery_postcode || "—";
  const title = order?.order_number || stop.stop_name || "Stop";
  const retailer = getRetailerName(order, stop);

  return `
    <div
      class="av-stop ${escapeHtml(cls)}"
      draggable="true"
      data-stop-id="${escapeHtml(stop.id)}"
      data-route-id="${escapeHtml(stop.route_id)}"
    >
      <div class="av-stop-no ${escapeHtml(cls)}">
        ${escapeHtml(stopNumber)}
      </div>

      <div>
        <div class="av-stop-title">
          ${escapeHtml(title)} · ${escapeHtml(retailer)}
        </div>

        <div class="av-stop-sub">
          ${escapeHtml(city)}
          · ${escapeHtml(postcode)}
          · ETA ${escapeHtml(eta)}
        </div>

        <div class="av-stop-sub">
          Status:
          <span class="av-status ${escapeHtml(cls)}">
            ${escapeHtml(titleCase(statusValue))}
          </span>
        </div>
      </div>

      <div class="av-stop-actions">
        <button
          class="av-btn small success"
          type="button"
          data-manual-delivered="${escapeHtml(stop.id)}"
        >
          Delivered
        </button>

        <button
          class="av-btn small warning"
          type="button"
          data-manual-issue="${escapeHtml(stop.id)}"
        >
          Issue
        </button>

        <button
          class="av-btn small danger"
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
      const panel = document.getElementById(`cost-breakdown-${routeId}`);

      if (!panel) return;

      panel.style.display =
        panel.style.display === "none"
          ? "block"
          : "none";
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
        status === "delivered" ? "delivered" :
        status === "delivery_issue" ? "delivery_issue" :
        "failed_delivery";

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
        .eq("id", stopId);

      if (stopError) throw stopError;

      const { error: orderError } = await db
        .from("orders")
        .update({
          status: orderStatus,
          transport_status: orderStatus,
          delivery_status: orderStatus,
          last_activity_at: now,
          delivered_at: orderStatus === "delivered" ? now : null
        })
        .eq("company_id", cid)
        .eq("id", stop.order_id);

      if (orderError) throw orderError;

      if (route) {
        await updateRouteStatusAfterStopChange(route.id);
      }

      showToast(`Order marked as ${orderStatus.replaceAll("_", " ")}.`, "ok");
      notifyRoutesChanged();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not update delivery status.", "err");
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

    const { error: routeError } = await db
      .from("routes")
      .update({
        route_status: routeStatus
      })
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

  function notifyRoutesChanged() {
    window.dispatchEvent(new CustomEvent("veynor:routes-changed"));
  }

  function refresh() {
    render();
  }

  function init() {
    try {
      ensureClient();
      injectStyles();

      byId("btnVehicleModuleRefresh")?.addEventListener("click", () => {
        notifyRoutesChanged();
      });

      window.addEventListener("veynor:planner-data-changed", event => {
        syncFromPlannerData(event.detail);
        render();
      });

      window.addEventListener("veynor:planner-selection-changed", event => {
        const detail = event.detail || {};
        selectedOrderIds = Array.isArray(detail.selectedOrderIds)
          ? detail.selectedOrderIds.map(String)
          : [];
        render();
      });

      render();
      setTimeout(render, 800);

      log("Available Vehicles module loaded.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not load available vehicles module.", "err");
    }
  }

  window.VeynorAvailableVehicles = {
    refresh,
    sendRouteToDriver,
    saveRouteAssignment,
    removeRoute,
    saveStopOrder,
    manuallyCompleteStop
  };

  document.addEventListener("DOMContentLoaded", init);
})();