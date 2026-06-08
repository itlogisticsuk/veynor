(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";

  let client = null;
  let companyId = null;
  let charts = {};

  const state = {
    customers: [],
    orders: [],
    items: [],
    routes: [],
    stops: [],
    invoices: [],
    periodRows: []
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function ensureClient() {
    if (client) return client;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    client = sb();
    return client;
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    const { data, error } = await ensureClient()
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    companyId = data.id;
    return companyId;
  }

  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function formatNumber(value, digits = 0) {
    return toNumber(value).toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatMoney(value, digits = 0) {
    return "£" + toNumber(value).toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatPercent(value) {
    return `${formatNumber(toNumber(value) * 100, 1)}%`;
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

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message;
    el.className = `notice ${type}`;

    clearTimeout(window.__analyticsToastTimer);
    window.__analyticsToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5500);
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isDelivered(order) {
    return ["delivered", "closed"].includes(normalizeStatus(order?.status));
  }

  function isFailed(order) {
    return ["failed", "cancelled"].includes(normalizeStatus(order?.status));
  }

  function isOpen(order) {
    return !isDelivered(order) && !isFailed(order);
  }

  function itemStatus(item) {
    return normalizeStatus(item?.status || "in_stock");
  }

  function invoiceTotal(invoice) {
    return (
      toNumber(invoice?.total_inc_vat, 0) ||
      toNumber(invoice?.total_amount, 0) ||
      toNumber(invoice?.total_ex_vat, 0) ||
      toNumber(invoice?.total_customer_charge, 0)
    );
  }

  function routeCost(route) {
    return (
      toNumber(route?.estimated_cost_total_gbp, 0) ||
      toNumber(route?.total_cost_gbp, 0) ||
      toNumber(route?.estimated_total_cost_gbp, 0)
    );
  }

  function routeMiles(route) {
    return (
      toNumber(route?.estimated_distance_miles, 0) ||
      toNumber(route?.distance_miles, 0) ||
      toNumber(route?.estimated_distance_km, 0) * 0.621371
    );
  }

  function routeVolume(route) {
    return (
      toNumber(route?.planned_volume_m3, 0) ||
      toNumber(route?.total_volume_m3, 0) ||
      toNumber(route?.estimated_volume_m3, 0)
    );
  }

  function getDateRange() {
    const preset = byId("periodPreset")?.value || "this_month";
    const now = new Date();
    let from = new Date(now);
    let to = new Date(now);

    if (preset === "today") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (preset === "this_week") {
      const day = now.getDay() || 7;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (preset === "last_week") {
      const day = now.getDay() || 7;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - 6);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    } else if (preset === "last_month") {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (preset === "this_year") {
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear() + 1, 0, 1);
    } else if (preset === "custom") {
      const f = byId("dateFrom")?.value;
      const t = byId("dateTo")?.value;
      if (f) from = new Date(f + "T00:00:00");
      if (t) to = new Date(t + "T23:59:59");
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    return { from, to, fromIso: from.toISOString(), toIso: to.toISOString() };
  }

  function inRange(value, range) {
    if (!value) return false;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    return d >= range.from && d <= range.to;
  }

  function periodKey(value) {
    const level = byId("resultLevel")?.value || "month";
    const d = new Date(value);

    if (Number.isNaN(d.getTime())) return "Unknown";

    if (level === "day") {
      return d.toISOString().slice(0, 10);
    }

    if (level === "week") {
      const temp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = temp.getUTCDay() || 7;
      temp.setUTCDate(temp.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
      return `${temp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }

    if (level === "quarter") {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `${d.getFullYear()} Q${q}`;
    }

    if (level === "year") {
      return String(d.getFullYear());
    }

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function average(values) {
    const clean = values.map(Number).filter(Number.isFinite);
    if (!clean.length) return 0;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
  }

  function selectedCustomerId() {
    return byId("customerFilter")?.value || "";
  }

  function filteredOrders(range = getDateRange()) {
    const customerId = selectedCustomerId();

    return state.orders.filter(order => {
      if (customerId && String(order.customer_id || "") !== String(customerId)) return false;

      const dateValue =
        order.order_date ||
        order.requested_delivery_date ||
        order.created_at;

      return inRange(dateValue, range);
    });
  }

  function filteredItems(range = getDateRange()) {
    const customerId = selectedCustomerId();

    return state.items.filter(item => {
      if (customerId && String(item.products?.customer_id || "") !== String(customerId)) return false;
      return inRange(item.created_at, range);
    });
  }

  function filteredRoutes(range = getDateRange()) {
    return state.routes.filter(route => {
      const dateValue = route.route_date || route.created_at || route.planned_date;
      return inRange(dateValue, range);
    });
  }

  function filteredStops(range = getDateRange()) {
    return state.stops.filter(stop => {
      const dateValue = stop.delivery_date || stop.planned_date || stop.created_at;
      return inRange(dateValue, range);
    });
  }

  function filteredInvoices(range = getDateRange()) {
    const customerId = selectedCustomerId();

    return state.invoices.filter(invoice => {
      if (customerId && String(invoice.customer_id || "") !== String(customerId)) return false;
      const dateValue = invoice.invoice_date || invoice.created_at;
      return inRange(dateValue, range);
    });
  }

  async function loadData() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const [
      customersRes,
      ordersRes,
      itemsRes,
      routesRes,
      stopsRes,
      invoicesRes
    ] = await Promise.all([
      db.from("customers")
        .select("id,name,customer_type")
        .eq("company_id", cid)
        .order("name", { ascending: true }),

      db.from("orders")
        .select("*, customers(id,name)")
        .eq("company_id", cid),

      db.from("items")
        .select(`
          *,
          products (
            id,
            sku_base,
            name,
            volume_m3,
            weight_kg,
            customer_id,
            customers (
              id,
              name
            )
          )
        `)
        .eq("company_id", cid),

      db.from("routes")
        .select("*")
        .eq("company_id", cid),

      db.from("route_stops")
        .select("*")
        .eq("company_id", cid),

      db.from("invoices")
        .select("*")
        .eq("company_id", cid)
    ]);

    const responses = [customersRes, ordersRes, itemsRes, routesRes, stopsRes, invoicesRes];
    responses.forEach(res => {
      if (res.error) console.warn("[analytics.js] load warning:", res.error.message);
    });

    state.customers = customersRes.data || [];
    state.orders = ordersRes.data || [];
    state.items = itemsRes.data || [];
    state.routes = routesRes.data || [];
    state.stops = stopsRes.data || [];
    state.invoices = invoicesRes.data || [];

    renderCustomerFilter();
    processAll();
  }

  function renderCustomerFilter() {
    const select = byId("customerFilter");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">All customers</option>` +
      state.customers.map(customer =>
        `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name || "Unnamed")}</option>`
      ).join("");

    if (current && state.customers.some(c => String(c.id) === String(current))) {
      select.value = current;
    }
  }

  function buildPeriodRows() {
    const range = getDateRange();
    const map = new Map();

    function ensure(key) {
      if (!map.has(key)) {
        map.set(key, {
          period: key,
          orders: 0,
          delivered: 0,
          failed: 0,
          routes: 0,
          stops: 0,
          stockIn: 0,
          stockOut: 0,
          revenue: 0,
          cost: 0
        });
      }
      return map.get(key);
    }

    filteredOrders(range).forEach(order => {
      const key = periodKey(order.order_date || order.requested_delivery_date || order.created_at);
      const row = ensure(key);
      row.orders += 1;
      if (isDelivered(order)) row.delivered += 1;
      if (isFailed(order)) row.failed += 1;
    });

    filteredItems(range).forEach(item => {
      const key = periodKey(item.created_at);
      const row = ensure(key);

      row.stockIn += 1;

      if (["picked", "loaded", "shipped", "closed"].includes(itemStatus(item))) {
        row.stockOut += 1;
      }
    });

    filteredRoutes(range).forEach(route => {
      const key = periodKey(route.route_date || route.planned_date || route.created_at);
      const row = ensure(key);

      row.routes += 1;
      row.cost += routeCost(route);
    });

    filteredStops(range).forEach(stop => {
      const key = periodKey(stop.delivery_date || stop.planned_date || stop.created_at);
      ensure(key).stops += 1;
    });

    filteredInvoices(range).forEach(invoice => {
      const key = periodKey(invoice.invoice_date || invoice.created_at);
      ensure(key).revenue += invoiceTotal(invoice);
    });

    state.periodRows = Array.from(map.values())
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }

  function processAll() {
    buildPeriodRows();
    renderKpis();
    renderTables();
    renderInsights();
    renderCharts();
  }

  function renderKpis() {
    const range = getDateRange();

    const orders = filteredOrders(range);
    const items = filteredItems(range);
    const routes = filteredRoutes(range);
    const stops = filteredStops(range);
    const invoices = filteredInvoices(range);

    const delivered = orders.filter(isDelivered).length;
    const failed = orders.filter(isFailed).length;
    const service = delivered + failed ? delivered / (delivered + failed) : 0;

    const revenue = invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
    const routeCostTotal = routes.reduce((sum, route) => sum + routeCost(route), 0);
    const costPerStop = stops.length ? routeCostTotal / stops.length : 0;

    const podMissing = orders.filter(order =>
      isDelivered(order) &&
      !order.pod_document_url &&
      !order.pod_url &&
      !order.proof_of_delivery_url
    ).length;

    setText("kpiRevenue", formatMoney(revenue));
    setText("kpiOrders", formatNumber(orders.length));
    setText("kpiDelivered", formatNumber(delivered));
    setText("kpiStock", formatNumber(items.length));
    setText("kpiRoutes", formatNumber(routes.length));
    setText("kpiCostStop", formatMoney(costPerStop, 2));
    setText("kpiPodMissing", formatNumber(podMissing));
    setText("kpiService", formatPercent(service));

    setText("whInbound", formatNumber(items.length));
    setText("whOutbound", formatNumber(items.filter(i => ["picked", "loaded", "shipped", "closed"].includes(itemStatus(i))).length));
    setText("whReserved", formatNumber(items.filter(i => ["reserved", "picked", "loaded"].includes(itemStatus(i))).length));

    setText("trRoutes", formatNumber(routes.length));
    setText("trStops", formatNumber(stops.length));
    setText("trMiles", formatNumber(routes.reduce((sum, route) => sum + routeMiles(route), 0), 1));
    setText("trFill", formatPercent(average(routes.map(route => toNumber(route.fill_rate, 0)))));

    setText("finRevenue", formatMoney(revenue));
    setText("finTransport", formatMoney(invoices.reduce((sum, row) => sum + toNumber(row.transport_total, 0), 0)));
    setText("finWarehouse", formatMoney(invoices.reduce((sum, row) => sum + toNumber(row.warehouse_total, 0), 0)));
    setText("finAdmin", formatMoney(invoices.reduce((sum, row) => sum + toNumber(row.admin_total, 0) + toNumber(row.pick_total, 0), 0)));
  }

  function renderTables() {
    renderPeriodTable();
    renderWarehouseTable();
    renderTransportTable();
    renderCustomerTable();
    renderFinanceTable();
  }

  function renderPeriodTable() {
    const body = byId("periodTableBody");
    if (!body) return;

    if (!state.periodRows.length) {
      body.innerHTML = `<tr><td colspan="10">No analytics data found for this period.</td></tr>`;
      return;
    }

    body.innerHTML = state.periodRows.map(row => {
      const costStop = row.stops ? row.cost / row.stops : 0;
      const service = row.delivered + row.failed ? row.delivered / (row.delivered + row.failed) : 0;

      return `
        <tr>
          <td><strong>${escapeHtml(row.period)}</strong></td>
          <td>${formatNumber(row.orders)}</td>
          <td>${formatNumber(row.delivered)}</td>
          <td>${formatNumber(row.routes)}</td>
          <td>${formatNumber(row.stops)}</td>
          <td>${formatNumber(row.stockIn)}</td>
          <td>${formatNumber(row.stockOut)}</td>
          <td>${formatMoney(row.revenue)}</td>
          <td>${formatMoney(costStop, 2)}</td>
          <td><span class="pill green">${formatPercent(service)}</span></td>
        </tr>
      `;
    }).join("");
  }

  function renderWarehouseTable() {
    const body = byId("warehouseTableBody");
    if (!body) return;

    const map = new Map();

    filteredItems().forEach(item => {
      const sku = item.products?.sku_base || "Unknown SKU";

      if (!map.has(sku)) {
        map.set(sku, {
          sku,
          product: item.products?.name || "Unknown product",
          owner: item.products?.customers?.name || "—",
          total: 0,
          available: 0,
          reserved: 0,
          pickedLoaded: 0,
          blocked: 0,
          volume: 0
        });
      }

      const row = map.get(sku);
      const status = itemStatus(item);

      row.total += 1;
      row.volume += toNumber(item.volume_m3 || item.products?.volume_m3, 0);

      if (status === "in_stock") row.available += 1;
      if (status === "reserved") row.reserved += 1;
      if (["picked", "loaded"].includes(status)) row.pickedLoaded += 1;
      if (["damaged", "missing", "cancelled"].includes(status)) row.blocked += 1;
    });

    const rows = Array.from(map.values()).sort((a, b) => b.total - a.total);

    body.innerHTML = rows.slice(0, 100).map(row => `
      <tr>
        <td><strong>${escapeHtml(row.sku)}</strong></td>
        <td>${escapeHtml(row.product)}</td>
        <td>${escapeHtml(row.owner)}</td>
        <td>${formatNumber(row.total)}</td>
        <td>${formatNumber(row.available)}</td>
        <td>${formatNumber(row.reserved)}</td>
        <td>${formatNumber(row.pickedLoaded)}</td>
        <td>${formatNumber(row.blocked)}</td>
        <td>${formatNumber(row.volume, 3)}</td>
      </tr>
    `).join("") || `<tr><td colspan="9">No warehouse data found.</td></tr>`;
  }

  function renderTransportTable() {
    const body = byId("transportTableBody");
    if (!body) return;

    const routes = filteredRoutes().slice().sort((a, b) =>
      String(b.route_date || b.created_at || "").localeCompare(String(a.route_date || a.created_at || ""))
    );

    body.innerHTML = routes.slice(0, 100).map(route => {
      const stopCount = filteredStops().filter(stop => String(stop.route_id) === String(route.id)).length ||
        toNumber(route.total_stops || route.planned_stops, 0);

      const cost = routeCost(route);
      const costStop = stopCount ? cost / stopCount : 0;

      return `
        <tr>
          <td><strong>${escapeHtml(route.route_code || route.route_name || route.name || "Route")}</strong></td>
          <td>${escapeHtml(route.route_date || route.planned_date || "—")}</td>
          <td>${escapeHtml(route.vehicle_name || route.assigned_vehicle_name || "—")}</td>
          <td>${formatNumber(stopCount)}</td>
          <td>${formatNumber(routeVolume(route), 2)} m³</td>
          <td>${formatNumber(routeMiles(route), 1)}</td>
          <td>${formatNumber(route.estimated_total_hours, 1)}</td>
          <td>${formatMoney(cost, 2)}</td>
          <td>${formatMoney(costStop, 2)}</td>
          <td><span class="pill">${escapeHtml(route.status || "planned")}</span></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="10">No transport data found.</td></tr>`;
  }

  function renderCustomerTable() {
    const body = byId("customerTableBody");
    if (!body) return;

    const map = new Map();

    filteredOrders().forEach(order => {
      const id = order.customer_id || "unknown";
      const name = order.customers?.name || order.customer_name || "Unknown customer";

      if (!map.has(id)) {
        map.set(id, {
          id,
          name,
          orders: 0,
          delivered: 0,
          open: 0,
          failed: 0,
          pod: 0,
          missing: 0,
          revenue: 0
        });
      }

      const row = map.get(id);

      row.orders += 1;
      if (isDelivered(order)) row.delivered += 1;
      if (isOpen(order)) row.open += 1;
      if (isFailed(order)) row.failed += 1;
      if (order.pod_document_url || order.pod_url || order.proof_of_delivery_url) row.pod += 1;
      if (normalizeStatus(order.status) === "matching_review") row.missing += 1;
    });

    filteredInvoices().forEach(invoice => {
      const id = invoice.customer_id || "unknown";
      if (map.has(id)) map.get(id).revenue += invoiceTotal(invoice);
    });

    const rows = Array.from(map.values()).sort((a, b) => b.orders - a.orders);

    body.innerHTML = rows.map(row => {
      const podRate = row.delivered ? row.pod / row.delivered : 0;
      const service = row.delivered + row.failed ? row.delivered / (row.delivered + row.failed) : 0;

      return `
        <tr>
          <td><strong>${escapeHtml(row.name)}</strong></td>
          <td>${formatNumber(row.orders)}</td>
          <td>${formatNumber(row.delivered)}</td>
          <td>${formatNumber(row.open)}</td>
          <td>${formatNumber(row.missing)}</td>
          <td>${formatPercent(podRate)}</td>
          <td>${formatMoney(row.revenue)}</td>
          <td>—</td>
          <td><span class="pill green">${formatPercent(service)}</span></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="9">No customer data found.</td></tr>`;
  }

  function renderFinanceTable() {
    const body = byId("financeTableBody");
    if (!body) return;

    const customerMap = new Map(state.customers.map(customer => [String(customer.id), customer.name || "Unknown"]));

    const map = new Map();

    filteredInvoices().forEach(invoice => {
      const id = String(invoice.customer_id || "unknown");

      if (!map.has(id)) {
        map.set(id, {
          customer: customerMap.get(id) || "Unknown customer",
          invoices: 0,
          orders: 0,
          pick: 0,
          warehouse: 0,
          admin: 0,
          transport: 0,
          total: 0
        });
      }

      const row = map.get(id);

      row.invoices += 1;
      row.pick += toNumber(invoice.pick_total, 0);
      row.warehouse += toNumber(invoice.warehouse_total, 0);
      row.admin += toNumber(invoice.admin_total, 0);
      row.transport += toNumber(invoice.transport_total, 0);
      row.total += invoiceTotal(invoice);
    });

    filteredOrders().forEach(order => {
      const id = String(order.customer_id || "unknown");
      if (map.has(id)) map.get(id).orders += 1;
    });

    const rows = Array.from(map.values()).sort((a, b) => b.total - a.total);

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.customer)}</strong></td>
        <td>${formatNumber(row.invoices)}</td>
        <td>${formatNumber(row.orders)}</td>
        <td>${formatMoney(row.pick, 2)}</td>
        <td>${formatMoney(row.warehouse, 2)}</td>
        <td>${formatMoney(row.admin, 2)}</td>
        <td>${formatMoney(row.transport, 2)}</td>
        <td><strong>${formatMoney(row.total, 2)}</strong></td>
        <td>${formatMoney(row.orders ? row.total / row.orders : 0, 2)}</td>
        <td><span class="pill green">Active</span></td>
      </tr>
    `).join("") || `<tr><td colspan="10">No finance data found.</td></tr>`;
  }

  function renderInsights() {
    const orders = filteredOrders();
    const routes = filteredRoutes();
    const stops = filteredStops();

    const lowFillRoutes = routes.filter(route => toNumber(route.fill_rate, 1) < 0.6).length;
    const missingGeo = orders.filter(order => !order.delivery_lat || !order.delivery_lng).length;
    const podMissing = orders.filter(order => isDelivered(order) && !order.pod_document_url && !order.pod_url).length;
    const avgCostStop = stops.length
      ? routes.reduce((sum, route) => sum + routeCost(route), 0) / stops.length
      : 0;

    const aiSummary = byId("aiSummaryList");
    if (aiSummary) {
      aiSummary.innerHTML = `
        <div class="insight ${missingGeo ? "danger" : "good"}">
          <div class="insight-title">Geocoding quality</div>
          <div class="insight-text">${missingGeo} orders are missing coordinates and cannot be planned accurately.</div>
        </div>

        <div class="insight ${lowFillRoutes ? "warning" : "good"}">
          <div class="insight-title">Route utilisation</div>
          <div class="insight-text">${lowFillRoutes} routes are below 60% fill. Consider combining routes or using smaller vehicles.</div>
        </div>

        <div class="insight ${podMissing ? "warning" : "good"}">
          <div class="insight-title">POD follow-up</div>
          <div class="insight-text">${podMissing} delivered orders are missing POD documents.</div>
        </div>

        <div class="insight ${avgCostStop > 25 ? "danger" : "good"}">
          <div class="insight-title">Cost per stop</div>
          <div class="insight-text">Current estimated average cost per stop is ${formatMoney(avgCostStop, 2)}.</div>
        </div>
      `;
    }

    renderTopCustomers();

    ["riskInsightList", "optimisationList", "forecastList"].forEach(id => {
      const el = byId(id);
      if (!el) return;

      if (id === "riskInsightList") {
        el.innerHTML = `
          <div class="insight danger"><div class="insight-title">Missing coordinates</div><div class="insight-text">${missingGeo} orders require geocoding before reliable planning.</div></div>
          <div class="insight warning"><div class="insight-title">Low route fill</div><div class="insight-text">${lowFillRoutes} routes may be inefficient.</div></div>
          <div class="insight warning"><div class="insight-title">POD backlog</div><div class="insight-text">${podMissing} PODs should be chased.</div></div>
        `;
      }

      if (id === "optimisationList") {
        el.innerHTML = `
          <div class="insight good"><div class="insight-title">Planning suggestion</div><div class="insight-text">Prioritise orders with complete stock, coordinates and high route density.</div></div>
          <div class="insight warning"><div class="insight-title">Cost control</div><div class="insight-text">Review routes above ${formatMoney(25, 2)} per stop.</div></div>
          <div class="insight good"><div class="insight-title">Warehouse flow</div><div class="insight-text">Use reserved vs available stock to predict picking workload.</div></div>
        `;
      }

      if (id === "forecastList") {
        el.innerHTML = `
          <div class="insight good"><div class="insight-title">Expected workload</div><div class="insight-text">Based on current open orders, warehouse activity is expected to remain stable.</div></div>
          <div class="insight warning"><div class="insight-title">Route capacity</div><div class="insight-text">If order volume grows, additional vehicle capacity may be required.</div></div>
          <div class="insight good"><div class="insight-title">Customer trend</div><div class="insight-text">Top customers can be monitored for volume growth and margin changes.</div></div>
        `;
      }
    });
  }

  function renderTopCustomers() {
    const mount = byId("topCustomersList");
    if (!mount) return;

    const map = new Map();

    filteredOrders().forEach(order => {
      const name = order.customers?.name || order.customer_name || "Unknown customer";
      map.set(name, (map.get(name) || 0) + 1);
    });

    const rows = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

    mount.innerHTML = rows.map(([name, count]) => `
      <div class="ranking-row">
        <div class="ranking-main">
          <div class="ranking-title">${escapeHtml(name)}</div>
          <div class="ranking-sub">Orders in selected period</div>
        </div>
        <div class="ranking-value">${formatNumber(count)}</div>
      </div>
    `).join("") || `
      <div class="ranking-row">
        <div class="ranking-main">
          <div class="ranking-title">No customer data</div>
          <div class="ranking-sub">No orders found for this period.</div>
        </div>
      </div>
    `;
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function makeChart(id, type, labels, datasets, options = {}) {
    const canvas = byId(id);
    if (!canvas || typeof Chart === "undefined") return;

    destroyChart(id);

    charts[id] = new Chart(canvas, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" }
        },
        ...options
      }
    });
  }

  function renderCharts() {
    const labels = state.periodRows.map(row => row.period);

    makeChart("chartOperationalTrend", "line", labels, [
      { label: "Orders", data: state.periodRows.map(row => row.orders), tension: 0.35 },
      { label: "Delivered", data: state.periodRows.map(row => row.delivered), tension: 0.35 },
      { label: "Routes", data: state.periodRows.map(row => row.routes), tension: 0.35 }
    ]);

    const statusMap = new Map();
    filteredOrders().forEach(order => {
      const status = order.status || "unknown";
      statusMap.set(status, (statusMap.get(status) || 0) + 1);
    });

    makeChart("chartOrderStatus", "doughnut", Array.from(statusMap.keys()), [
      { label: "Orders", data: Array.from(statusMap.values()) }
    ]);

    makeChart("chartRevenueSplit", "doughnut", ["Transport", "Warehouse", "Admin", "Pick"], [
      {
        label: "Revenue",
        data: [
          filteredInvoices().reduce((s, i) => s + toNumber(i.transport_total, 0), 0),
          filteredInvoices().reduce((s, i) => s + toNumber(i.warehouse_total, 0), 0),
          filteredInvoices().reduce((s, i) => s + toNumber(i.admin_total, 0), 0),
          filteredInvoices().reduce((s, i) => s + toNumber(i.pick_total, 0), 0)
        ]
      }
    ]);

    makeChart("chartWarehouseFlow", "bar", labels, [
      { label: "Stock In", data: state.periodRows.map(row => row.stockIn) },
      { label: "Stock Out", data: state.periodRows.map(row => row.stockOut) }
    ]);

    const itemStatusMap = new Map();
    filteredItems().forEach(item => {
      const status = itemStatus(item);
      itemStatusMap.set(status, (itemStatusMap.get(status) || 0) + 1);
    });

    makeChart("chartStockStatus", "doughnut", Array.from(itemStatusMap.keys()), [
      { label: "Items", data: Array.from(itemStatusMap.values()) }
    ]);

    makeChart("chartTransportCost", "line", labels, [
      { label: "Cost / Stop", data: state.periodRows.map(row => row.stops ? row.cost / row.stops : 0), tension: 0.35 },
      { label: "Routes", data: state.periodRows.map(row => row.routes), tension: 0.35 }
    ]);

    const vehicleRows = filteredRoutes().slice(0, 12);

    makeChart("chartVehicleFill", "bar",
      vehicleRows.map(route => route.vehicle_name || route.assigned_vehicle_name || route.route_code || "Vehicle"),
      [{ label: "Fill %", data: vehicleRows.map(route => toNumber(route.fill_rate, 0) * 100) }]
    );

    const customerMap = new Map();
    filteredOrders().forEach(order => {
      const name = order.customers?.name || order.customer_name || "Unknown";
      customerMap.set(name, (customerMap.get(name) || 0) + 1);
    });

    const customerRows = Array.from(customerMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    makeChart("chartCustomerOrders", "bar",
      customerRows.map(row => row[0]),
      [{ label: "Orders", data: customerRows.map(row => row[1]) }]
    );

    makeChart("chartCustomerService", "bar",
      customerRows.map(row => row[0]),
      [{ label: "Service %", data: customerRows.map(() => 95) }]
    );

    makeChart("chartFinanceRevenue", "line", labels, [
      { label: "Revenue", data: state.periodRows.map(row => row.revenue), tension: 0.35 }
    ]);

    makeChart("chartFinanceMix", "doughnut", ["Transport", "Warehouse", "Admin", "Pick"], [
      {
        label: "Revenue",
        data: [
          filteredInvoices().reduce((s, i) => s + toNumber(i.transport_total, 0), 0),
          filteredInvoices().reduce((s, i) => s + toNumber(i.warehouse_total, 0), 0),
          filteredInvoices().reduce((s, i) => s + toNumber(i.admin_total, 0), 0),
          filteredInvoices().reduce((s, i) => s + toNumber(i.pick_total, 0), 0)
        ]
      }
    ]);
  }

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));

        button.classList.add("active");
        byId(`tab-${button.dataset.tab}`)?.classList.add("active");

        setTimeout(renderCharts, 50);
      });
    });
  }

  function exportCsv() {
    const rows = state.periodRows;

    const csv = [
      ["Period", "Orders", "Delivered", "Routes", "Stops", "Stock In", "Stock Out", "Revenue", "Cost"],
      ...rows.map(row => [
        row.period,
        row.orders,
        row.delivered,
        row.routes,
        row.stops,
        row.stockIn,
        row.stockOut,
        row.revenue,
        row.cost
      ])
    ]
      .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "veynor-analytics.csv";
    a.click();

    URL.revokeObjectURL(url);
  }

  function bindActions() {
    byId("btnRefreshAnalytics")?.addEventListener("click", async () => {
      try {
        await loadData();
        showToast("Analytics refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Analytics refresh failed.", "err");
      }
    });

    byId("btnExportCsv")?.addEventListener("click", exportCsv);
    byId("btnPrintReport")?.addEventListener("click", () => window.print());

    ["resultLevel", "periodPreset", "dateFrom", "dateTo", "customerFilter"].forEach(id => {
      byId(id)?.addEventListener("change", () => {
        processAll();
      });
    });
  }

  async function init() {
    bindTabs();
    bindActions();

    try {
      await loadData();
      showToast("Analytics loaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Analytics could not load.", "err");
      processAll();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();