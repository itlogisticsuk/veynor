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

  async function loadOrders() {
    const cid = await getCompanyId();

    const { data, error } = await client
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name
        )
      `)
      .eq("company_id", cid)
      .eq("planning_release", true)
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
      .order("requested_delivery_date", { ascending: true, nullsFirst: false })
      .order("order_number", { ascending: true });

    if (error) throw error;

    allOrders = (data || []).map(row => ({
      ...row,
      product_owner_name: row.customers?.name || row.customer_name || "—",
      customer_name: row.customers?.name || row.customer_name || "—",
      retailer_name: getRetailerName(row),
      __line_revenue_gbp: 0
    }));

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
        quantity_ordered,
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

      const qty = toNumber(line.quantity_ordered, 0) || toNumber(line.quantity, 0) || 1;

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
      if (q) {
        const haystack = [
          order.order_number,
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
      if (!allOrders.some(row => String(row.id) === String(id))) selectedOrderIds.delete(id);
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
    setText("kpiReleasedOrders", formatNumber(allOrders.filter(row => row.planning_release).length));
    setText("kpiStockComplete", formatNumber(allOrders.filter(isStockComplete).length));
    setText("kpiCoordsOrders", formatNumber(allOrders.filter(hasCoordinates).length));
    setText("kpiPlannedOrders", formatNumber(allOrders.filter(row => row.route_id).length));
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
            <span class="status-pill ${statusPillClass(order.status)}">
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
    applyFilters();
    renderKpis();
    renderSelectionSummary();
    renderOrdersTable();
    renderMap();
    notifyDataChanged();
  }

  function renderMap() {
    window.ordersMapRows = filteredOrders;
    window.allRouteStopsMapRows = allStops;
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

    window.VeynorPlannerData = {
      companyId,
      allOrders,
      filteredOrders,
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
    await loadDrivers();
    await loadActiveVehicles();
    await loadRoutes();
    await loadRouteStops();
    await loadOrders();

    renderSelects();
    renderAll();

    if (window.VeynorAvailableVehicles?.refresh) {
      window.VeynorAvailableVehicles.refresh();
    }
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

      const cid = await getCompanyId();

      const { error } = await client
        .from("orders")
        .update({
          transport_type: "charter",
          status: "export_for_charter",
          route_id: null,
          last_activity_at: new Date().toISOString()
        })
        .eq("company_id", cid)
        .in("id", selectedIds);

      if (error) throw error;

      selectedOrderIds.clear();
      await refreshAll();

      showToast("Selected orders marked for charter.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not export for charter.", "err");
    }
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

    byId("btnAutoPlanRoutes")?.addEventListener("click", planSelectedOrders);
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

      await planSelectedOrders();
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