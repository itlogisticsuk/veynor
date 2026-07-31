(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";

const DEFAULT_BELLSTONE_FUEL_SURCHARGE_PCT = 8.5;
const DEFAULT_FDS_FUEL_SURCHARGE_PCT = 8.0;

/*
 * Interne operationele pickingkosten.
 * Bellstone wordt volgens het producttarief gefactureerd,
 * maar intern rekenen we £2 per besteld product.
 */
const DEFAULT_PICKING_COST_PER_PRODUCT_GBP = 2.0;

let client = null;
let companyId = null;
let charts = {};

let transportViewMode = "total";
let orderCostFilter = "all";

let expandedTransportRoutes = new Set();

let expandedOrderCostSections = new Set([
  "orderCostPendingSection"
]);

/*
 * Tijdelijke selectie en verdeling voor één FDS-factuur.
 * Deze data wordt pas definitief opgeslagen wanneer een order
 * wordt bevestigd.
 */
let selectedFdsInvoiceOrders = new Set();
let fdsDraftAllocations = new Map();

  const state = {
    customers: [],
    orders: [],
    routes: [],
    stops: [],
    invoices: [],
    settings: {},
    routeRows: [],
    orderRows: [],
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

  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function money(value) {
    return "£" + toNumber(value).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function num(value, digits = 0) {
    return toNumber(value).toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function pct(value) {
    return `${num(toNumber(value) * 100, 1)}%`;
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

    el.textContent = message || "";
    el.className = `notice ${type}`;

    clearTimeout(window.__analyticsToastTimer);
    window.__analyticsToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5500);
  }

  function normal(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function resultClass(value) {
    const n = toNumber(value, 0);
    if (n < 0) return "orange";
    return "green";
  }

  function getDateRange() {
    const preset = byId("periodPreset")?.value || "this_month";
    const now = new Date();

    let from = new Date(now.getFullYear(), now.getMonth(), 1);
    let to = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    if (preset === "today") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    if (preset === "this_week") {
      const day = now.getDay() || 7;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    if (preset === "last_week") {
      const day = now.getDay() || 7;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - 6);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    }

    if (preset === "last_month") {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    if (preset === "this_year") {
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear() + 1, 0, 1);
    }

    if (preset === "custom") {
      const f = byId("dateFrom")?.value;
      const t = byId("dateTo")?.value;

      if (f) from = new Date(f + "T00:00:00");
      if (t) to = new Date(t + "T23:59:59");
    }

    return { from, to };
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

    if (level === "day") return d.toISOString().slice(0, 10);

    if (level === "week") {
      const temp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = temp.getUTCDay() || 7;
      temp.setUTCDate(temp.getUTCDate() + 4 - day);

      const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);

      return `${temp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }

    if (level === "quarter") {
      return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
    }

    if (level === "year") return String(d.getFullYear());

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

  async function loadData() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const [
      customersRes,
      ordersRes,
      routesRes,
      stopsRes,
      invoicesRes,
      settingsRes
    ] = await Promise.all([
      db.from("customers")
        .select("id,name,customer_code,customer_type")
        .eq("company_id", cid),

      db.from("orders")
        .select(`
          *,
          customers (
            id,
            name,
            customer_code
          ),
          order_lines (
            id,
            order_id,
            quantity_ordered,
            line_type,
            tariff_storage,
            tariff_admin,
            tariff_handling,
            tariff_transport,
            total_customer_charge,
            total_volume_m3,
            total_line_volume_m3,
            unit_volume_m3
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
        .eq("company_id", cid),

      db.from("settings")
        .select("setting_key,setting_value")
        .eq("company_id", cid)
    ]);

    [customersRes, ordersRes, routesRes, stopsRes, invoicesRes, settingsRes].forEach(res => {
      if (res.error) console.warn("[analytics.js]", res.error.message);
    });

    state.customers = customersRes.data || [];
    state.orders = ordersRes.data || [];
    state.routes = routesRes.data || [];
    state.stops = stopsRes.data || [];
    state.invoices = invoicesRes.data || [];
    state.settings = Object.fromEntries(
      (settingsRes.data || []).map(row => [row.setting_key, row.setting_value])
    );

    renderCustomerFilter();
    processAll();
  }

  function renderCustomerFilter() {
    const select = byId("customerFilter");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">All customers</option>` +
      state.customers
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || "Unnamed")}</option>`)
        .join("");

    if (current) select.value = current;
  }

  function customerName(order) {
    return order?.customers?.name || order?.customer_name || "Unknown";
  }

  function retailerName(order) {
    return (
      order?.retail_name ||
      order?.retailer_name ||
      order?.delivery_name ||
      order?.delivery_company ||
      order?.customer_name ||
      "—"
    );
  }

function orderDate(order) {
  return (
    order?.confirmed_delivery_date ||
    order?.pod_completed_at ||
    order?.planned_route_date ||
    order?.expected_delivery_date ||
    order?.requested_delivery_date ||
    order?.order_date ||
    order?.created_at
  );
}

  function routeDate(route) {
    return (
      route?.planned_delivery_date ||
      route?.route_date ||
      route?.planned_date ||
      route?.created_at
    );
  }

  function getLines(order) {
    return Array.isArray(order?.order_lines) ? order.order_lines : [];
  }

  function lineQty(line) {
    return Math.max(
      toNumber(line?.quantity_ordered, 0),
      toNumber(line?.quantity, 0),
      1
    );
  }

  function lineVolume(line) {
    const qty = lineQty(line);

    return (
      toNumber(line?.total_line_volume_m3, 0) ||
      toNumber(line?.total_volume_m3, 0) ||
      toNumber(line?.unit_volume_m3, 0) * qty
    );
  }

  function orderVolume(order) {
    return (
      toNumber(order?.planning_volume_m3, 0) ||
      toNumber(order?.total_order_volume_m3, 0) ||
      toNumber(order?.volume_m3, 0) ||
      getLines(order).reduce((sum, line) => sum + lineVolume(line), 0)
    );
  }

  function orderColli(order) {
    return (
      toNumber(order?.planning_colli, 0) ||
      toNumber(order?.total_colli, 0) ||
      toNumber(order?.colli, 0) ||
      getLines(order).reduce((sum, line) => sum + lineQty(line), 0)
    );
  }

  function sumLineField(order, field) {
    return getLines(order).reduce((sum, line) => {
      return sum + toNumber(line?.[field], 0);
    }, 0);
  }

function orderAdminRevenue(order) {
  return Math.max(
    toNumber(order?.total_admin_tariff, 0),
    toNumber(order?.admin_revenue_gbp, 0),
    toNumber(order?.admin_total, 0),
    sumLineField(order, "tariff_admin")
  );
}

/*
 * Storage revenue zoals aan de product owner wordt gefactureerd.
 */
function orderStorageRevenue(order) {
  return Math.max(
    toNumber(order?.total_storage_tariff, 0),
    toNumber(order?.storage_revenue_gbp, 0),
    sumLineField(order, "tariff_storage")
  );
}

/*
 * tariff_handling wordt binnen de productmaster en productlijst
 * functioneel als Pick gebruikt.
 */
function orderPickingRevenue(order) {
  return Math.max(
    toNumber(order?.total_handling_tariff, 0),
    toNumber(order?.handling_revenue_gbp, 0),
    toNumber(order?.picking_revenue_gbp, 0),
    sumLineField(order, "tariff_handling")
  );
}

/*
 * Warehouse revenue bevat storage en picking.
 * Admin revenue blijft apart onderdeel van de totale omzet.
 */
function orderWarehouseRevenue(order) {
  return (
    orderStorageRevenue(order) +
    orderPickingRevenue(order)
  );
}

function orderProductQuantity(order) {
  return getLines(order).reduce((sum, line) => {
    const quantity = Math.max(
      0,
      toNumber(
        line?.quantity_ordered ??
        line?.quantity,
        0
      )
    );

    return sum + quantity;
  }, 0);
}

function orderTransportBaseRevenue(order) {
  return Math.max(
    toNumber(order?.total_transport_tariff, 0),
    toNumber(order?.transport_revenue_gbp, 0),
    toNumber(order?.transport_total, 0),
    toNumber(order?.transport_charge_gbp, 0),
    sumLineField(order, "tariff_transport")
  );
}

function bellstoneFuelSurchargePct(order) {
  return Math.max(
    toNumber(
      order?.transport_fuel_surcharge_pct,
      0
    ),
    toNumber(
      state.settings.transport_fuel_surcharge_pct,
      0
    ),
    DEFAULT_BELLSTONE_FUEL_SURCHARGE_PCT
  );
}

function fdsFuelSurchargePct(order) {
  return Math.max(
    toNumber(
      order?.fds_fuel_surcharge_pct,
      0
    ),
    toNumber(
      state.settings.fds_fuel_surcharge_pct,
      0
    ),
    DEFAULT_FDS_FUEL_SURCHARGE_PCT
  );
}

function orderFuelSurchargeRevenue(order) {
  const stored = toNumber(
    order?.transport_fuel_surcharge_revenue_gbp,
    0
  );

  if (stored > 0) {
    return stored;
  }

  return (
    orderTransportBaseRevenue(order) *
    (
      bellstoneFuelSurchargePct(order) /
      100
    )
  );
}

function orderTransportRevenue(order) {
  return (
    orderTransportBaseRevenue(order) +
    orderFuelSurchargeRevenue(order)
  );
}

function orderTotalRevenue(order) {
  const calculated =
    orderStorageRevenue(order) +
    orderAdminRevenue(order) +
    orderPickingRevenue(order) +
    orderTransportRevenue(order);

  return Math.max(
    calculated,
    toNumber(order?.estimated_revenue_gbp, 0),
    toNumber(order?.total_customer_charge, 0),
    toNumber(order?.customer_charge_gbp, 0),
    toNumber(order?.revenue_gbp, 0)
  );
}

function warehouseRates() {
  return {
    storageRate: toNumber(
      state.settings.warehouse_storage_per_m3_gbp,
      0
    ),

    pickingRate: toNumber(
      state.settings.warehouse_picking_per_product_gbp,
      DEFAULT_PICKING_COST_PER_PRODUCT_GBP
    ) || DEFAULT_PICKING_COST_PER_PRODUCT_GBP
  };
}

/*
 * Operationele warehousekosten:
 *
 * - Storage cost
 * - Picking cost £2 per besteld product
 *
 * Handling-in, handling-out en VAS worden hier niet meer
 * als aparte operationele kosten meegenomen.
 */
function calcWarehouseCost(order) {
  const rates = warehouseRates();

  const volume =
    orderVolume(order);

  const productQuantity =
    orderProductQuantity(order);

  const storage =
    volume * rates.storageRate;

  const picking =
    productQuantity * rates.pickingRate;

  const total =
    storage + picking;

  return {
    productQuantity,

    storage,
    picking,

    /*
     * Deze blijven op nul staan voor compatibiliteit met
     * bestaande tabellen en functies.
     */
    handlingIn: 0,
    handlingOut: 0,
    vas: 0,

    total
  };
}

  function routeLabel(route) {
    return route?.route_code || route?.route_name || route?.name || "Route";
  }

  function routeTransportType(route) {
    const value = normal(route?.transport_type || route?.route_type || route?.carrier_type || "");

    if (["fds", "charter", "carrier", "third_party"].includes(value)) return "fds";
    return "own_transport";
  }

  function orderTransportType(order, route = null) {
    const value = normal(order?.transport_type || route?.transport_type || route?.route_type || "");

    if (["fds", "charter", "carrier", "third_party"].includes(value)) return "fds";
    return "own_transport";
  }

function isOrderRelevantForAnalytics(order) {
  const status = normal(
    order?.overall_status ||
    order?.status ||
    ""
  );

  const transportStatus = normal(
    order?.transport_status ||
    ""
  );

  const transportType = normal(
    order?.transport_type ||
    ""
  );

  const isDelivered =
    ["delivered", "completed", "complete"].includes(status) ||
    ["delivered", "completed"].includes(transportStatus) ||
    Boolean(order?.confirmed_delivery_date) ||
    Boolean(order?.pod_completed_at);

  if (isDelivered) {
    return true;
  }

  if (Boolean(order?.route_id)) {
    return true;
  }

  const isCarrier =
    ["fds", "charter", "carrier", "third_party"].includes(
      transportType
    );

  const carrierStatus =
    [
      "export_for_charter",
      "planned",
      "on_transport",
      "in_transit",
      "allocated"
    ].includes(status);

  return (
    isCarrier &&
    (
      carrierStatus ||
      Boolean(order?.carrier_vehicle_id)
    )
  );
}

  function getStopsForRoute(routeId) {
    return state.stops.filter(stop => String(stop.route_id) === String(routeId));
  }

  function getOrderById(id) {
    return state.orders.find(order => String(order.id) === String(id)) || null;
  }

  function getOrdersForRoute(routeId) {
    return getStopsForRoute(routeId)
      .map(stop => getOrderById(stop.order_id))
      .filter(Boolean);
  }

  function routeWarehouseCost(route) {
    return toNumber(route?.estimated_cost_warehouse_gbp, 0);
  }

  function routeTotalCost(route) {
    return Math.max(
      toNumber(route?.actual_total_cost_gbp, 0),
      toNumber(route?.actual_transport_cost_gbp, 0) + routeWarehouseCost(route),
      toNumber(route?.estimated_cost_total_gbp, 0),
      toNumber(route?.total_cost_gbp, 0),
      toNumber(route?.estimated_total_cost_gbp, 0)
    );
  }

  function routeTransportCost(route) {
    const actual = toNumber(route?.actual_transport_cost_gbp, 0);
    if (actual > 0) return actual;

    return Math.max(0, routeTotalCost(route) - routeWarehouseCost(route));
  }

  function filteredRouteSource() {
    const range = getDateRange();
    const customerId = byId("customerFilter")?.value || "";
    const transportFilter = byId("transportTypeFilter")?.value || "";

    return state.routes.filter(route => {
      if (!inRange(routeDate(route), range)) return false;

      const type = routeTransportType(route);

      if (transportFilter && normal(transportFilter) !== type) return false;
      if (transportViewMode !== "total" && normal(transportViewMode) !== type) return false;

      if (customerId) {
        const orders = getOrdersForRoute(route.id);
        if (!orders.some(order => String(order.customer_id || "") === String(customerId))) {
          return false;
        }
      }

      return true;
    });
  }

  function filteredOrderSource() {
    const range = getDateRange();
    const customerId = byId("customerFilter")?.value || "";
    const transportFilter = byId("transportTypeFilter")?.value || "";

    return state.orders.filter(order => {
      if (!isOrderRelevantForAnalytics(order)) return false;
      if (customerId && String(order.customer_id || "") !== String(customerId)) return false;
      if (!inRange(orderDate(order), range)) return false;

      const route = state.routes.find(r => String(r.id) === String(order.route_id || ""));
      const type = orderTransportType(order, route);

      if (transportFilter && normal(transportFilter) !== type) return false;
      if (transportViewMode !== "total" && normal(transportViewMode) !== type) return false;

      return true;
    });
  }

  function buildRouteRows() {
    state.routeRows = filteredRouteSource().map(route => {
      const orders = getOrdersForRoute(route.id);
      const stops = getStopsForRoute(route.id);

      const warehouseCost =
        routeWarehouseCost(route) ||
        orders.reduce((sum, order) => sum + calcWarehouseCost(order).total, 0);

      const transportCost = routeTransportCost(route);
      const totalCost = transportCost + warehouseCost;

      const adminRevenue = orders.reduce((sum, order) => sum + orderAdminRevenue(order), 0);
      const warehouseRevenue = orders.reduce((sum, order) => sum + orderWarehouseRevenue(order), 0);
      const transportBaseRevenue = orders.reduce((sum, order) => sum + orderTransportBaseRevenue(order), 0);
      const fuelSurchargeRevenue = orders.reduce((sum, order) => sum + orderFuelSurchargeRevenue(order), 0);
      const transportRevenue = transportBaseRevenue + fuelSurchargeRevenue;
      const totalRevenue = adminRevenue + warehouseRevenue + transportRevenue;

      const forecastResult = totalRevenue - totalCost;

      const actualTransportCost = toNumber(route?.actual_transport_cost_gbp, 0);
      const actualTotalCost = actualTransportCost > 0
        ? actualTransportCost + warehouseCost
        : totalCost;

      const actualResult = totalRevenue - actualTotalCost;

      return {
        source: route,
        routeId: route.id,
        route: routeLabel(route),
        date: routeDate(route),
        vehicle: route.vehicle_name || route.assigned_vehicle_name || "—",
        driver: route.driver_name || "—",
        status: route.route_status || route.status || "planned",
        transportType: routeTransportType(route),

        orders,
        stops,
        ordersCount: orders.length || toNumber(route.planned_orders, 0),
        stopsCount: stops.length || toNumber(route.total_stops || route.planned_stops, 0),
        volume: toNumber(route.planned_volume_m3 || route.total_volume_m3, 0),
        miles: toNumber(route.actual_distance_miles, 0) || toNumber(route.estimated_distance_miles, 0),
        hours: toNumber(route.actual_total_hours, 0) || toNumber(route.estimated_total_hours, 0),

        adminRevenue,
        warehouseRevenue,
        transportBaseRevenue,
        fuelSurchargeRevenue,
        transportRevenue,
        totalRevenue,

        warehouseCost,
        transportCost,
        totalCost,

        actualTransportCost,
        actualTotalCost,

        forecastResult,
        actualResult,
        result: actualTransportCost > 0 ? actualResult : forecastResult,
        margin: totalRevenue ? (actualTransportCost > 0 ? actualResult : forecastResult) / totalRevenue : 0
      };
    });
  }

function buildOrderRows() {
  const routeRowsById = new Map(
    state.routeRows.map(row => [
      String(row.routeId),
      row
    ])
  );

  state.orderRows = filteredOrderSource().map(order => {
    const routeRow = routeRowsById.get(
      String(order.route_id || "")
    );

    const route =
      routeRow?.route ||
      (
        normal(order.transport_type) === "charter"
          ? "FDS / Charter"
          : "—"
      );

    const transportType =
      orderTransportType(
        order,
        routeRow?.source
      );

    /*
     * Omzet
     */
    const storageRevenue =
      orderStorageRevenue(order);

    const adminRevenue =
      orderAdminRevenue(order);

    const pickingRevenue =
      orderPickingRevenue(order);

    const warehouseRevenue =
      storageRevenue +
      pickingRevenue;

    const transportBaseRevenue =
      orderTransportBaseRevenue(order);

    const fuelSurchargeRevenue =
      orderFuelSurchargeRevenue(order);

    const transportRevenue =
      transportBaseRevenue +
      fuelSurchargeRevenue;

    const totalRevenue =
      storageRevenue +
      adminRevenue +
      pickingRevenue +
      transportRevenue;

    /*
     * Operationele warehousekosten
     */
    const warehouseCostParts =
      calcWarehouseCost(order);

    const storageCost =
      warehouseCostParts.storage;

    const pickingCost =
      warehouseCostParts.picking;

    const warehouseCost =
      storageCost +
      pickingCost;

    /*
     * Geschatte eigen transportkosten.
     * Dit is alleen een suggestie totdat de gebruiker bevestigt.
     */
    const routeOrderCount =
      routeRow?.ordersCount || 0;

    const ownSuggestedCost =
      routeRow && routeOrderCount
        ? routeRow.transportCost / routeOrderCount
        : toNumber(
            order.transport_cost_gbp,
            0
          );

    /*
     * Eventueel al aanwezige FDS-bedragen worden alleen als
     * suggestie getoond zolang ze niet bevestigd zijn.
     */
    const fdsBaseCost =
      toNumber(
        order.fds_base_cost_gbp,
        0
      );

    const storedFdsFuelCost =
      toNumber(
        order.fds_fuel_surcharge_cost_gbp,
        0
      );

    const estimatedFdsFuelCost =
      storedFdsFuelCost > 0
        ? storedFdsFuelCost
        : (
            fdsBaseCost *
            (
              fdsFuelSurchargePct(order) /
              100
            )
          );

    const storedFdsTotalCost =
      toNumber(
        order.fds_total_cost_gbp,
        0
      );

    const fdsSuggestedCost =
      storedFdsTotalCost > 0
        ? storedFdsTotalCost
        : (
            fdsBaseCost +
            estimatedFdsFuelCost
          );

    const suggestedTransportCost =
      transportType === "fds"
        ? fdsSuggestedCost
        : ownSuggestedCost;

    /*
     * Bevestigde werkelijke transportkosten.
     */
    const transportCostConfirmed =
      Boolean(
        order.transport_cost_confirmed_at
      );

    const actualTransportCost =
      transportCostConfirmed
        ? toNumber(
            order.actual_transport_cost_gbp,
            0
          )
        : 0;

    /*
     * Voor algemene Analytics-tabbladen wordt vóór bevestiging
     * nog de suggestie getoond. De Confirmed-secties gebruiken
     * uitsluitend actualTransportCost.
     */
    const transportCost =
      transportCostConfirmed
        ? actualTransportCost
        : suggestedTransportCost;

    const warehouseResult =
      warehouseRevenue -
      warehouseCost;

    const transportResult =
      transportRevenue -
      transportCost;

    const totalCost =
      warehouseCost +
      transportCost;

    const totalResult =
      totalRevenue -
      totalCost;

    return {
      order,

      orderId:
        order.id,

      orderNumber:
        order.order_number ||
        order.sales_order_number ||
        order.so_number ||
        "—",

      ack:
        order.ack_number ||
        order.external_reference ||
        order.supplier_order_number ||
        "—",

      po:
        order.purchase_order ||
        order.po_number ||
        "—",

      retailer:
        retailerName(order),

      customer:
        customerName(order),

      status:
        order.status ||
        "—",

      route,
      transportType,

      packages:
        orderColli(order),

      colli:
        orderColli(order),

      volume:
        orderVolume(order),

      productQuantity:
        warehouseCostParts.productQuantity,

      /*
       * Revenue
       */
      storageRevenue,
      adminRevenue,
      pickingRevenue,
      warehouseRevenue,

      transportBaseRevenue,
      fuelSurchargeRevenue,
      transportRevenue,

      totalRevenue,

      /*
       * Operational cost
       */
      storageCost,
      pickingCost,
      warehouseCostParts,
      warehouseCost,

      /*
       * Transport cost
       */
      suggestedTransportCost,
      actualTransportCost,
      transportCostConfirmed,

      transportCostSource:
        order.transport_cost_source ||
        "",

      transportCostReference:
        order.transport_cost_reference ||
        "",

      transportCostConfirmedAt:
        order.transport_cost_confirmed_at ||
        null,

      transportCost,

      /*
       * Result
       */
      adminResult:
        adminRevenue,

      warehouseResult,
      transportResult,

      totalCost,
      totalResult,

      margin:
        totalRevenue
          ? totalResult / totalRevenue
          : 0,

      /*
       * FDS detail
       */
      fdsBaseCost,
      fdsFuelSurchargeCost:
        storedFdsFuelCost,

      fdsTotalCost:
        storedFdsTotalCost
    };
  });
}

  function buildPeriodRows() {
    const map = new Map();

    function ensure(key) {
      if (!map.has(key)) {
        map.set(key, {
          period: key,
          orders: 0,
          routes: 0,

          adminRevenue: 0,
          warehouseRevenue: 0,
          warehouseCost: 0,
          transportBaseRevenue: 0,
          fuelSurchargeRevenue: 0,
          transportRevenue: 0,
          transportCost: 0,
          totalRevenue: 0,
          totalCost: 0
        });
      }

      return map.get(key);
    }

    state.orderRows.forEach(row => {
      const key = periodKey(orderDate(row.order));
      const p = ensure(key);

      p.orders += 1;
      p.adminRevenue += row.adminRevenue;
      p.warehouseRevenue += row.warehouseRevenue;
      p.warehouseCost += row.warehouseCost;
      p.transportBaseRevenue += row.transportBaseRevenue;
      p.fuelSurchargeRevenue += row.fuelSurchargeRevenue;
      p.transportRevenue += row.transportRevenue;
      p.transportCost += row.transportCost;
      p.totalRevenue += row.totalRevenue;
      p.totalCost += row.totalCost;
    });

    state.routeRows.forEach(row => {
      const key = periodKey(row.date);
      ensure(key).routes += 1;
    });

    state.periodRows = Array.from(map.values())
      .map(row => ({
        ...row,
        adminResult: row.adminRevenue,
        warehouseResult: row.warehouseRevenue - row.warehouseCost,
        transportResult: row.transportRevenue - row.transportCost,
        totalResult: row.totalRevenue - row.totalCost,
        margin: row.totalRevenue ? (row.totalRevenue - row.totalCost) / row.totalRevenue : 0
      }))
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }

  function processAll() {
    buildRouteRows();
    buildOrderRows();
    buildPeriodRows();

    renderKpis();
    renderTables();
    renderCharts();
  }

  function renderKpis() {
    const totalRevenue = state.orderRows.reduce((s, r) => s + r.totalRevenue, 0);
    const totalCost = state.orderRows.reduce((s, r) => s + r.totalCost, 0);
    const totalResult = totalRevenue - totalCost;

    const adminRevenue = state.orderRows.reduce((s, r) => s + r.adminRevenue, 0);
    const whRevenue = state.orderRows.reduce((s, r) => s + r.warehouseRevenue, 0);
    const whCost = state.orderRows.reduce((s, r) => s + r.warehouseCost, 0);
    const trRevenue = state.orderRows.reduce((s, r) => s + r.transportRevenue, 0);
    const trCost = state.orderRows.reduce((s, r) => s + r.transportCost, 0);

    setText("kpiTotalRevenue", money(totalRevenue));
    setText("kpiTotalCost", money(totalCost));
    setText("kpiTotalResult", money(totalResult));
    setText("kpiTotalMargin", pct(totalRevenue ? totalResult / totalRevenue : 0));
    setText("kpiRoutes", num(state.routeRows.length));
    setText("kpiOrders", num(state.orderRows.length));

    setText("profitWarehouseResult", money(whRevenue - whCost));
    setText("profitTransportResult", money(trRevenue - trCost));
    setText("profitLossOrders", num(state.orderRows.filter(r => r.totalResult < 0).length));

    setText("whRevenue", money(whRevenue));
    setText("whCost", money(whCost));
    setText("whMargin", pct(whRevenue ? (whRevenue - whCost) / whRevenue : 0));

    const trBaseRevenue = state.orderRows.reduce((s, r) => s + r.transportBaseRevenue, 0);
    const trFuelRevenue = state.orderRows.reduce((s, r) => s + r.fuelSurchargeRevenue, 0);
    const trResult = trRevenue - trCost;

    const ownRows = state.orderRows.filter(r => r.transportType === "own_transport");
    const fdsRows = state.orderRows.filter(r => r.transportType === "fds");

    const ownRevenue = ownRows.reduce((s, r) => s + r.transportRevenue, 0);
    const ownCost = ownRows.reduce((s, r) => s + r.transportCost, 0);
    const ownResult = ownRevenue - ownCost;

    const fdsRevenue = fdsRows.reduce((s, r) => s + r.transportRevenue, 0);
    const fdsCost = fdsRows.reduce((s, r) => s + r.transportCost, 0);
    const fdsResult = fdsRevenue - fdsCost;

    const transportRows = state.orderRows.filter(row => row.transportRevenue > 0);

    const avgCostOrder = transportRows.length ? trCost / transportRows.length : 0;
    const avgResultOrder = transportRows.length ? trResult / transportRows.length : 0;

    setText("trTotalRevenue", money(trRevenue));
    setText("trBaseRevenue", money(trBaseRevenue));
    setText("trFuelSurchargeRevenue", money(trFuelRevenue));
    setText("trTotalCost", money(trCost));
    setText("trTotalResult", money(trResult));
    setText("trTotalMargin", pct(trRevenue ? trResult / trRevenue : 0));

    setText("trOwnRevenue", money(ownRevenue));
    setText("trOwnCost", money(ownCost));
    setText("trOwnResult", money(ownResult));
    setText("trOwnMargin", pct(ownRevenue ? ownResult / ownRevenue : 0));

    setText("trFdsRevenue", money(fdsRevenue));
    setText("trFdsCost", money(fdsCost));
    setText("trFdsResult", money(fdsResult));
    setText("trFdsMargin", pct(fdsRevenue ? fdsResult / fdsRevenue : 0));

    setText("trAvgCostOrder", money(avgCostOrder));
    setText("trAvgResultOrder", money(avgResultOrder));

    const invoiceRevenue = state.invoices.reduce((sum, invoice) => {
      return sum + Math.max(
        toNumber(invoice.total_inc_vat, 0),
        toNumber(invoice.total_amount, 0),
        toNumber(invoice.total_ex_vat, 0)
      );
    }, 0);

    setText("finRevenue", money(invoiceRevenue));
    setText("finEstimatedRevenue", money(totalRevenue));
    setText("finEstimatedResult", money(totalResult));
    setText("adminRevenue", money(adminRevenue));
  }

  function emptyRow(cols, text) {
    return `<tr><td colspan="${cols}">${escapeHtml(text)}</td></tr>`;
  }

function renderTables() {
  renderPeriodProfitTable();
  renderRouteProfitTable();
  renderOrderProfitTables();

  /*
   * Nieuw Orders-tabblad met drie aparte secties.
   */
  renderOrderCostSections();

  renderWarehouseResultTable();
  renderTransportResultTable();
  renderCustomerProfitTable();
  renderFinanceResultTable();
}

  function renderPeriodProfitTable() {
    const body = byId("periodProfitTableBody");
    if (!body) return;

    body.innerHTML = state.periodRows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.period)}</strong></td>
        <td>${num(row.orders)}</td>
        <td>${num(row.routes)}</td>
        <td>${money(row.warehouseRevenue)}</td>
        <td>${money(row.warehouseCost)}</td>
        <td>${money(row.warehouseResult)}</td>
        <td>${money(row.transportBaseRevenue)}</td>
        <td>${money(row.fuelSurchargeRevenue)}</td>
        <td>${money(row.transportRevenue)}</td>
        <td>${money(row.transportCost)}</td>
        <td>${money(row.transportResult)}</td>
        <td>${money(row.adminRevenue)}</td>
        <td><strong>${money(row.totalRevenue)}</strong></td>
        <td><strong>${money(row.totalCost)}</strong></td>
        <td><span class="pill ${resultClass(row.totalResult)}">${money(row.totalResult)}</span></td>
        <td>${pct(row.margin)}</td>
      </tr>
    `).join("") || emptyRow(16, "No period result found.");
  }

  function renderRouteProfitTable() {
    const body = byId("routeProfitTableBody");
    if (!body) return;

    body.innerHTML = state.routeRows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.route)}</strong></td>
        <td>${escapeHtml(String(row.date || "—").slice(0, 10))}</td>
        <td>${escapeHtml(row.vehicle)}</td>
        <td>${escapeHtml(row.driver)}</td>
        <td>${num(row.ordersCount)}</td>
        <td>${num(row.stopsCount)}</td>
        <td>${num(row.volume, 2)} m³</td>
        <td>${money(row.warehouseRevenue)}</td>
        <td>${money(row.transportRevenue)}</td>
        <td><strong>${money(row.totalRevenue)}</strong></td>
        <td>${money(row.warehouseCost)}</td>
        <td>${money(row.transportCost)}</td>
        <td><strong>${money(row.totalCost)}</strong></td>
        <td><span class="pill ${resultClass(row.result)}">${money(row.result)}</span></td>
        <td>${pct(row.margin)}</td>
        <td><span class="pill">${escapeHtml(row.status)}</span></td>
      </tr>
    `).join("") || emptyRow(16, "No route profitability found.");
  }

function renderOrderProfitTables() {
  const profitBody =
    byId("orderProfitTableBody");

  if (!profitBody) return;

  profitBody.innerHTML =
    state.orderRows.map(row => `
      <tr>
        <td>
          <strong>
            ${escapeHtml(row.orderNumber)}
          </strong>
        </td>

        <td>
          ${escapeHtml(row.retailer)}
        </td>

        <td>
          ${escapeHtml(row.customer)}
        </td>

        <td>
          ${escapeHtml(row.route)}
        </td>

        <td>
          ${escapeHtml(row.transportType)}
        </td>

        <td>
          ${num(row.colli)}
        </td>

        <td>
          ${num(row.volume, 2)} m³
        </td>

        <td>
          ${money(row.warehouseRevenue)}
        </td>

        <td>
          ${money(row.transportRevenue)}
        </td>

        <td>
          <strong>
            ${money(row.totalRevenue)}
          </strong>
        </td>

        <td>
          ${money(row.warehouseCost)}
        </td>

        <td>
          ${money(row.transportCost)}
          ${
            row.transportCostConfirmed
              ? `
                <span class="subline">
                  Confirmed
                </span>
              `
              : `
                <span class="subline">
                  Estimated
                </span>
              `
          }
        </td>

        <td>
          <strong>
            ${money(row.totalCost)}
          </strong>
        </td>

        <td>
          ${money(row.warehouseResult)}
        </td>

        <td>
          ${money(row.transportResult)}
        </td>

        <td>
          <span class="pill ${resultClass(row.totalResult)}">
            ${money(row.totalResult)}
          </span>
        </td>

        <td>
          ${pct(row.margin)}
        </td>
      </tr>
    `).join("") ||
    emptyRow(
      17,
      "No order profitability found."
    );
}

function sumOrderRows(rows, field) {
  return rows.reduce(
    (sum, row) =>
      sum + toNumber(row?.[field], 0),
    0
  );
}

function getFilteredOrderCostRows(rows) {
  if (orderCostFilter === "own_transport") {
    return rows.filter(
      row => row.transportType === "own_transport"
    );
  }

  if (orderCostFilter === "carrier") {
    return rows.filter(
      row => row.transportType === "fds"
    );
  }

  return rows;
}

function confirmedOrderTotals(rows) {
  const totalRevenue =
    sumOrderRows(
      rows,
      "totalRevenue"
    );

  const warehouseCost =
    sumOrderRows(
      rows,
      "warehouseCost"
    );

  const actualTransportCost =
    sumOrderRows(
      rows,
      "actualTransportCost"
    );

  const totalCost =
    warehouseCost +
    actualTransportCost;

  const totalResult =
    totalRevenue -
    totalCost;

  const margin =
    totalRevenue
      ? totalResult / totalRevenue
      : 0;

  return {
    orders: rows.length,

    totalRevenue,
    warehouseCost,
    actualTransportCost,

    totalCost,
    totalResult,
    margin
  };
}

function confirmedResultForRow(row) {
  const totalCost =
    row.warehouseCost +
    row.actualTransportCost;

  const totalResult =
    row.totalRevenue -
    totalCost;

  const margin =
    row.totalRevenue
      ? totalResult / row.totalRevenue
      : 0;

  return {
    totalCost,
    totalResult,
    margin
  };
}

async function saveConfirmedTransportCost(
  orderId,
  amount,
  reference = "",
  carrierDetails = null
) {
  const row =
    state.orderRows.find(item =>
      String(item.orderId) ===
      String(orderId)
    );

  if (!row) {
    throw new Error(
      "Order not found in Analytics."
    );
  }

  const cost =
    toNumber(amount, NaN);

  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error(
      "Enter a valid transport cost of 0 or higher."
    );
  }

  const confirmedAt =
    new Date().toISOString();

  const isCarrier =
    row.transportType === "fds";

  const payload = {
    actual_transport_cost_gbp:
      Number(cost.toFixed(2)),

    transport_cost_confirmed_at:
      confirmedAt,

    transport_cost_source:
      isCarrier
        ? "carrier_manual"
        : "own_transport_manual",

    transport_cost_reference:
      String(reference || "").trim() ||
      null
  };

  /*
   * Carrierbedragen ook in bestaande FDS-velden bewaren.
   * Zo blijven andere delen van Analytics compatibel.
   */
  if (isCarrier && carrierDetails) {
    payload.fds_base_cost_gbp =
      Number(
        toNumber(
          carrierDetails.base,
          0
        ).toFixed(2)
      );

    payload.fds_fuel_surcharge_cost_gbp =
      Number(
        toNumber(
          carrierDetails.fuel,
          0
        ).toFixed(2)
      );

    payload.fds_total_cost_gbp =
      Number(cost.toFixed(2));
  }

  const { error } =
    await ensureClient()
      .from("orders")
      .update(payload)
      .eq("id", orderId)
      .eq("company_id", companyId);

  if (error) throw error;

  Object.assign(
    row.order,
    payload
  );

  selectedFdsInvoiceOrders.delete(
    String(orderId)
  );

  fdsDraftAllocations.delete(
    String(orderId)
  );

  processAll();
}

async function removeTransportCostConfirmation(
  orderId
) {
  const row =
    state.orderRows.find(item =>
      String(item.orderId) ===
      String(orderId)
    );

  if (!row) {
    throw new Error(
      "Order not found in Analytics."
    );
  }

  const payload = {
    actual_transport_cost_gbp:
      null,

    transport_cost_confirmed_at:
      null,

    transport_cost_source:
      null,

    transport_cost_reference:
      null
  };

  const { error } =
    await ensureClient()
      .from("orders")
      .update(payload)
      .eq("id", orderId)
      .eq("company_id", companyId);

  if (error) throw error;

  Object.assign(
    row.order,
    payload
  );

  processAll();
}

function revenueBreakdownHtml(row) {
  return `
    <div class="order-finance-breakdown">
      <span>Storage</span>
      <span>${money(row.storageRevenue)}</span>

      <span>Admin</span>
      <span>${money(row.adminRevenue)}</span>

      <span>Picking</span>
      <span>${money(row.pickingRevenue)}</span>

      <span>Transport Base</span>
      <span>${money(row.transportBaseRevenue)}</span>

      <span>Fuel Revenue</span>
      <span>${money(row.fuelSurchargeRevenue)}</span>

      <span class="order-finance-total">
        Total Revenue
      </span>

      <span class="order-finance-total">
        ${money(row.totalRevenue)}
      </span>
    </div>
  `;
}

function operationalCostHtml(row) {
  return `
    <div class="order-finance-breakdown">
      <span>Storage Cost</span>
      <span>${money(row.storageCost)}</span>

      <span>
        Picking Cost
        <small>
          (${num(row.productQuantity)} × £2)
        </small>
      </span>

      <span>${money(row.pickingCost)}</span>

      <span class="order-finance-total">
        Warehouse Cost
      </span>

      <span class="order-finance-total">
        ${money(row.warehouseCost)}
      </span>
    </div>
  `;
}

function pendingOrderCellHtml(row) {
  return `
    <div class="order-cost-order-cell">
      <span class="order-cost-order-number">
        ${escapeHtml(row.orderNumber)}
      </span>

      <span class="order-cost-order-sub">
        ACK: ${escapeHtml(row.ack)}
      </span>

      <span class="order-cost-order-sub">
        PO: ${escapeHtml(row.po)}
      </span>
    </div>
  `;
}

function updateFdsAllocationSummary() {
  const selectedRows =
    Array.from(
      selectedFdsInvoiceOrders
    )
      .map(orderId =>
        state.orderRows.find(row =>
          String(row.orderId) ===
          String(orderId)
        )
      )
      .filter(Boolean);

  const baseTotal =
    selectedRows.reduce(
      (sum, row) => {
        const draft =
          fdsDraftAllocations.get(
            String(row.orderId)
          );

        return sum + toNumber(
          draft?.base,
          0
        );
      },
      0
    );

  const fuelTotal =
    selectedRows.reduce(
      (sum, row) => {
        const draft =
          fdsDraftAllocations.get(
            String(row.orderId)
          );

        return sum + toNumber(
          draft?.fuel,
          0
        );
      },
      0
    );

  const finalTotal =
    baseTotal +
    fuelTotal;

  setText(
    "fdsSelectedOrderCount",
    `${selectedRows.length} order${
      selectedRows.length === 1
        ? ""
        : "s"
    }`
  );

  setText(
    "fdsSelectedBaseTotal",
    money(baseTotal)
  );

  setText(
    "fdsSelectedFuelTotal",
    money(fuelTotal)
  );

  setText(
    "fdsSelectedFinalTotal",
    money(finalTotal)
  );

  const baseTotalInput =
    byId("fdsInvoiceBaseTotal");

  if (baseTotalInput) {
    baseTotalInput.value =
      money(baseTotal);
  }
}

function renderPendingTransportRows(rows) {
  const body =
    byId("pendingTransportCostBody");

  if (!body) return;

  body.innerHTML =
    rows.map(row => {
      const isCarrier =
        row.transportType === "fds";

      const orderId =
        String(row.orderId);

      const draft =
        fdsDraftAllocations.get(
          orderId
        ) || {};

      const selected =
        selectedFdsInvoiceOrders.has(
          orderId
        );

      const ownInputValue =
        !isCarrier &&
        row.suggestedTransportCost > 0
          ? row.suggestedTransportCost.toFixed(2)
          : "";

      const baseValue =
        isCarrier
          ? (
              draft.base !== undefined
                ? toNumber(draft.base, 0).toFixed(2)
                : ""
            )
          : ownInputValue;

      const fuelValue =
        isCarrier
          ? toNumber(draft.fuel, 0)
          : 0;

      const finalValue =
        isCarrier
          ? (
              draft.final !== undefined
                ? toNumber(draft.final, 0)
                : toNumber(baseValue, 0)
            )
          : toNumber(baseValue, 0);

      return `
        <tr
          data-order-cost-row="${escapeHtml(orderId)}"
          data-order-cost-type="${
            isCarrier
              ? "carrier"
              : "own_transport"
          }"
        >
          <td>
            ${
              isCarrier
                ? `
                  <input
                    type="checkbox"
                    data-fds-order-select="${escapeHtml(orderId)}"
                    ${selected ? "checked" : ""}
                    aria-label="Select carrier order"
                  >
                `
                : "—"
            }
          </td>

          <td>
            ${pendingOrderCellHtml(row)}
          </td>

          <td>
            ${escapeHtml(row.retailer)}
          </td>

          <td>
            <span class="order-cost-type ${
              isCarrier
                ? "carrier"
                : "own"
            }">
              ${
                isCarrier
                  ? "Carrier / FDS"
                  : "Own Transport"
              }
            </span>
          </td>

          <td class="order-cost-money">
            ${money(row.transportRevenue)}
          </td>

          <td class="order-cost-money">
            ${
              row.suggestedTransportCost > 0
                ? money(
                    row.suggestedTransportCost
                  )
                : "—"
            }
          </td>

          <td>
            <div class="order-cost-input-wrap">
              <span class="order-cost-currency">
                £
              </span>

              <input
                class="order-cost-input"
                type="number"
                min="0"
                step="0.01"
                value="${escapeHtml(baseValue)}"
                placeholder="0.00"
                data-order-base-cost
              >
            </div>
          </td>

          <td
            class="order-cost-money"
            data-order-fuel-cost
          >
            ${money(fuelValue)}
          </td>

          <td
            class="order-cost-money"
            data-order-final-cost
          >
            ${money(finalValue)}
          </td>

          <td>
            <input
              class="order-cost-reference-input"
              type="text"
              value="${escapeHtml(
                draft.reference ||
                row.transportCostReference ||
                ""
              )}"
              placeholder="${
                isCarrier
                  ? "Invoice / FDS reference"
                  : "Route / cost reference"
              }"
              data-order-cost-reference
            >
          </td>

          <td>
            <div class="order-cost-action-group">
              <button
                class="order-cost-confirm-btn"
                type="button"
                data-confirm-order-cost="${escapeHtml(orderId)}"
              >
                Confirm
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("") ||
    emptyRow(
      11,
      "All transport costs in this selection have been confirmed."
    );
}

function renderConfirmedTransportRows(
  rows,
  bodyId,
  carrierMode
) {
  const body =
    byId(bodyId);

  if (!body) return;

  body.innerHTML =
    rows.map(row => {
      const result =
        confirmedResultForRow(row);
const transportResult =
  row.transportRevenue -
  row.actualTransportCost;

const transportMargin =
  row.transportRevenue
    ? transportResult /
      row.transportRevenue
    : 0;

      return `
        <tr data-order-cost-row="${escapeHtml(row.orderId)}">
          <td>
            ${pendingOrderCellHtml(row)}
          </td>

          <td>
            ${escapeHtml(row.retailer)}
          </td>

          <td>
            ${revenueBreakdownHtml(row)}
          </td>

          <td>
            ${operationalCostHtml(row)}
          </td>

          <td>
            <div class="order-cost-input-wrap">
              <span class="order-cost-currency">
                £
              </span>

              <input
                class="order-cost-input"
                type="number"
                min="0"
                step="0.01"
                value="${row.actualTransportCost.toFixed(2)}"
                data-order-actual-cost
              >
            </div>
          </td>

<td class="order-cost-money">
  ${money(row.transportRevenue)}
</td>

<td>
  <span class="pill ${resultClass(transportResult)}">
    ${money(transportResult)}
  </span>
</td>

<td>
  ${pct(transportMargin)}
</td>

<td class="order-cost-money">
  ${money(row.totalRevenue)}
</td>

<td class="order-cost-money">
  ${money(result.totalCost)}
</td>

<td>
  <span class="pill ${resultClass(result.totalResult)}">
    ${money(result.totalResult)}
  </span>
</td>

<td>
  ${pct(result.margin)}
</td>

          <td>
            <input
              class="order-cost-reference-input"
              type="text"
              value="${escapeHtml(row.transportCostReference)}"
              placeholder="${
                carrierMode
                  ? "Invoice / carrier reference"
                  : "Route / cost reference"
              }"
              data-order-cost-reference
            >
          </td>

          <td>
            <div class="order-cost-action-group">
              <button
                class="order-cost-save-btn"
                type="button"
                data-save-order-cost="${escapeHtml(row.orderId)}"
              >
                Save
              </button>

              <button
                class="order-cost-unconfirm-btn"
                type="button"
                data-unconfirm-order-cost="${escapeHtml(row.orderId)}"
              >
                Undo
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("") ||
    emptyRow(
      14,
      carrierMode
        ? "No confirmed carrier orders found."
        : "No confirmed own transport orders found."
    );
}

function renderOrderCostSummary(
  prefix,
  rows
) {
  const totals =
    confirmedOrderTotals(rows);

  setText(
    `${prefix}Orders`,
    num(totals.orders)
  );

  setText(
    `${prefix}Revenue`,
    money(totals.totalRevenue)
  );

  setText(
    `${prefix}WarehouseCost`,
    money(totals.warehouseCost)
  );

  setText(
    `${prefix}Cost`,
    money(totals.actualTransportCost)
  );

  setText(
    `${prefix}Result`,
    money(totals.totalResult)
  );

  setText(
    `${prefix}Margin`,
    pct(totals.margin)
  );
}

function restoreOrderCostAccordionState() {
  [
    "orderCostPendingSection",
    "orderCostOwnSection",
    "orderCostCarrierSection"
  ].forEach(id => {
    const element =
      byId(id);

    if (!element) return;

    element.open =
      expandedOrderCostSections.has(id);

    element.ontoggle = () => {
      if (element.open) {
        expandedOrderCostSections.add(id);
      } else {
        expandedOrderCostSections.delete(id);
      }
    };
  });
}

function bindOrderCostFilterButtons() {
  const buttons = {
    all: byId("btnOrderCostAll"),
    own_transport: byId("btnOrderCostOwn"),
    carrier: byId("btnOrderCostCarrier")
  };

  Object.entries(buttons).forEach(
    ([mode, button]) => {
      if (!button) return;

      button.classList.toggle(
        "active",
        orderCostFilter === mode
      );

      button.onclick = () => {
        orderCostFilter = mode;

        renderOrderCostSections();
      };
    }
  );

  const panel =
    byId("fdsInvoiceAllocationPanel");

  panel?.classList.toggle(
    "open",
    orderCostFilter === "carrier"
  );
}

function bindPendingBaseInputs() {
  document
    .querySelectorAll(
      "#pendingTransportCostBody [data-order-base-cost]"
    )
    .forEach(input => {
      input.addEventListener(
        "input",
        () => {
          const rowElement =
            input.closest(
              "[data-order-cost-row]"
            );

          if (!rowElement) return;

          const orderId =
            String(
              rowElement.dataset.orderCostRow ||
              ""
            );

          const type =
            rowElement.dataset.orderCostType;

          if (type !== "carrier") {
            const finalCell =
              rowElement.querySelector(
                "[data-order-final-cost]"
              );

            if (finalCell) {
              finalCell.textContent =
                money(input.value);
            }

            return;
          }

          const previous =
            fdsDraftAllocations.get(orderId) ||
            {};

          const base =
            Math.max(
              0,
              toNumber(input.value, 0)
            );

          const fuel =
            toNumber(previous.fuel, 0);

          fdsDraftAllocations.set(
            orderId,
            {
              ...previous,
              base,
              fuel,
              final: base + fuel
            }
          );

          updateFdsAllocationSummary();
        }
      );
    });
}

function bindFdsSelectionActions() {
  document
    .querySelectorAll(
      "[data-fds-order-select]"
    )
    .forEach(checkbox => {
      checkbox.addEventListener(
        "change",
        () => {
          const orderId =
            String(
              checkbox.dataset.fdsOrderSelect ||
              ""
            );

          if (checkbox.checked) {
            selectedFdsInvoiceOrders.add(
              orderId
            );
          } else {
            selectedFdsInvoiceOrders.delete(
              orderId
            );
          }

          updateFdsAllocationSummary();
        }
      );
    });

  byId("btnApplyFdsFuel")?.addEventListener(
    "click",
    () => {
      const selectedIds =
        Array.from(
          selectedFdsInvoiceOrders
        );

      if (!selectedIds.length) {
        showToast(
          "Select at least one carrier order.",
          "err"
        );

        return;
      }

      const invoiceReference =
        String(
          byId("fdsInvoiceReference")?.value ||
          ""
        ).trim();

      const fuelTotal =
        Math.max(
          0,
          toNumber(
            byId("fdsFuelSurchargeAmount")?.value,
            0
          )
        );

      const rows =
        selectedIds.map(orderId => {
          const rowElement =
            document.querySelector(
              `[data-order-cost-row="${CSS.escape(orderId)}"]`
            );

          const baseInput =
            rowElement?.querySelector(
              "[data-order-base-cost]"
            );

          return {
            orderId,
            rowElement,
            base:
              Math.max(
                0,
                toNumber(
                  baseInput?.value,
                  0
                )
              )
          };
        });

      const baseTotal =
        rows.reduce(
          (sum, row) =>
            sum + row.base,
          0
        );

      if (baseTotal <= 0) {
        showToast(
          "Enter the base carrier cost for the selected orders first.",
          "err"
        );

        return;
      }

      let allocatedFuel = 0;

      rows.forEach((row, index) => {
        const isLast =
          index === rows.length - 1;

        const fuel =
          isLast
            ? Number(
                (
                  fuelTotal -
                  allocatedFuel
                ).toFixed(2)
              )
            : Number(
                (
                  fuelTotal *
                  (
                    row.base /
                    baseTotal
                  )
                ).toFixed(2)
              );

        allocatedFuel += fuel;

        const final =
          Number(
            (
              row.base +
              fuel
            ).toFixed(2)
          );

        fdsDraftAllocations.set(
          row.orderId,
          {
            base: row.base,
            fuel,
            final,
            reference:
              invoiceReference
          }
        );

        const fuelCell =
          row.rowElement?.querySelector(
            "[data-order-fuel-cost]"
          );

        const finalCell =
          row.rowElement?.querySelector(
            "[data-order-final-cost]"
          );

        const referenceInput =
          row.rowElement?.querySelector(
            "[data-order-cost-reference]"
          );

        if (fuelCell) {
          fuelCell.textContent =
            money(fuel);
        }

        if (finalCell) {
          finalCell.textContent =
            money(final);
        }

        if (
          referenceInput &&
          invoiceReference
        ) {
          referenceInput.value =
            invoiceReference;
        }
      });

      updateFdsAllocationSummary();

      showToast(
        "FDS fuel surcharge distributed automatically.",
        "ok"
      );
    }
  );

  byId("btnClearFdsAllocation")?.addEventListener(
    "click",
    () => {
      selectedFdsInvoiceOrders.clear();
      fdsDraftAllocations.clear();

      const invoiceInput =
        byId("fdsInvoiceReference");

      const fuelInput =
        byId("fdsFuelSurchargeAmount");

      if (invoiceInput) {
        invoiceInput.value = "";
      }

      if (fuelInput) {
        fuelInput.value = "";
      }

      renderOrderCostSections();
    }
  );
}

function bindOrderCostActions() {
  document
    .querySelectorAll(
      "[data-confirm-order-cost]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          const orderId =
            String(
              button.dataset.confirmOrderCost ||
              ""
            );

          const rowElement =
            button.closest(
              "[data-order-cost-row]"
            );

          const type =
            rowElement?.dataset.orderCostType;

          const baseInput =
            rowElement?.querySelector(
              "[data-order-base-cost]"
            );

          const referenceInput =
            rowElement?.querySelector(
              "[data-order-cost-reference]"
            );

          const base =
            Math.max(
              0,
              toNumber(
                baseInput?.value,
                0
              )
            );

          const draft =
            fdsDraftAllocations.get(
              orderId
            );

          const fuel =
            type === "carrier"
              ? toNumber(
                  draft?.fuel,
                  0
                )
              : 0;

          const final =
            type === "carrier"
              ? (
                  draft?.final !== undefined
                    ? toNumber(
                        draft.final,
                        base
                      )
                    : base
                )
              : base;

          button.disabled = true;

          const oldText =
            button.textContent;

          button.textContent =
            "Saving...";

          try {
            await saveConfirmedTransportCost(
              orderId,
              final,
              referenceInput?.value || "",
              type === "carrier"
                ? {
                    base,
                    fuel
                  }
                : null
            );

            showToast(
              "Transport cost confirmed and results recalculated.",
              "ok"
            );
          } catch (error) {
            console.error(error);

            showToast(
              error.message ||
              "Transport cost could not be confirmed.",
              "err"
            );

            button.disabled = false;
            button.textContent =
              oldText;
          }
        }
      );
    });

  document
    .querySelectorAll(
      "[data-save-order-cost]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          const orderId =
            String(
              button.dataset.saveOrderCost ||
              ""
            );

          const rowElement =
            button.closest(
              "[data-order-cost-row]"
            );

          const costInput =
            rowElement?.querySelector(
              "[data-order-actual-cost]"
            );

          const referenceInput =
            rowElement?.querySelector(
              "[data-order-cost-reference]"
            );

          button.disabled = true;

          try {
            await saveConfirmedTransportCost(
              orderId,
              costInput?.value,
              referenceInput?.value || ""
            );

            showToast(
              "Confirmed transport cost updated.",
              "ok"
            );
          } catch (error) {
            console.error(error);

            showToast(
              error.message ||
              "Transport cost could not be updated.",
              "err"
            );

            button.disabled = false;
          }
        }
      );
    });

  document
    .querySelectorAll(
      "[data-unconfirm-order-cost]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          const orderId =
            String(
              button.dataset.unconfirmOrderCost ||
              ""
            );

          const approved =
            window.confirm(
              "Return this order to Transport Cost to Confirm?"
            );

          if (!approved) return;

          button.disabled = true;

          try {
            await removeTransportCostConfirmation(
              orderId
            );

            showToast(
              "Transport cost confirmation removed.",
              "ok"
            );
          } catch (error) {
            console.error(error);

            showToast(
              error.message ||
              "Confirmation could not be removed.",
              "err"
            );

            button.disabled = false;
          }
        }
      );
    });
}

function renderOrderCostSections() {
  const allPendingRows =
    state.orderRows.filter(
      row => !row.transportCostConfirmed
    );

  const allConfirmedOwnRows =
    state.orderRows.filter(
      row =>
        row.transportCostConfirmed &&
        row.transportType === "own_transport"
    );

  const allConfirmedCarrierRows =
    state.orderRows.filter(
      row =>
        row.transportCostConfirmed &&
        row.transportType === "fds"
    );

  const pendingRows =
    getFilteredOrderCostRows(
      allPendingRows
    );

  const confirmedOwnRows =
    getFilteredOrderCostRows(
      allConfirmedOwnRows
    );

  const confirmedCarrierRows =
    getFilteredOrderCostRows(
      allConfirmedCarrierRows
    );

  setText(
    "pendingTransportOrders",
    num(pendingRows.length)
  );

  setText(
    "pendingTransportRevenue",
    money(
      sumOrderRows(
        pendingRows,
        "totalRevenue"
      )
    )
  );

  setText(
    "pendingSuggestedCost",
    money(
      sumOrderRows(
        pendingRows,
        "suggestedTransportCost"
      )
    )
  );

  renderOrderCostSummary(
    "confirmedOwn",
    confirmedOwnRows
  );

  renderOrderCostSummary(
    "confirmedCarrier",
    confirmedCarrierRows
  );

  renderPendingTransportRows(
    pendingRows
  );

  renderConfirmedTransportRows(
    confirmedOwnRows,
    "confirmedOwnTransportBody",
    false
  );

  renderConfirmedTransportRows(
    confirmedCarrierRows,
    "confirmedCarrierTransportBody",
    true
  );

  bindOrderCostFilterButtons();
  restoreOrderCostAccordionState();

  bindPendingBaseInputs();
  bindFdsSelectionActions();
  bindOrderCostActions();

  updateFdsAllocationSummary();
}

function renderWarehouseResultTable() {
  const body =
    byId("warehouseResultTableBody");

  if (!body) return;

  body.innerHTML =
    state.orderRows.map(row => `
      <tr>
        <td>
          <strong>
            ${escapeHtml(row.orderNumber)}
          </strong>
        </td>

        <td>
          ${escapeHtml(row.retailer)}
        </td>

        <td>
          ${num(row.productQuantity)}
        </td>

        <td>
          ${num(row.volume, 2)} m³
        </td>

        <td>
          ${money(row.storageRevenue)}
        </td>

        <td>
          ${money(row.adminRevenue)}
        </td>

        <td>
          ${money(row.pickingRevenue)}
        </td>

        <td>
          ${money(row.storageCost)}
        </td>

        <td>
          ${money(row.pickingCost)}
        </td>

        <td>
          <strong>
            ${money(row.warehouseCost)}
          </strong>
        </td>

        <td>
          <strong>
            ${money(
              row.storageRevenue +
              row.adminRevenue +
              row.pickingRevenue
            )}
          </strong>
        </td>

        <td>
          <span class="pill ${
            resultClass(
              (
                row.storageRevenue +
                row.adminRevenue +
                row.pickingRevenue
              ) -
              row.warehouseCost
            )
          }">
            ${money(
              (
                row.storageRevenue +
                row.adminRevenue +
                row.pickingRevenue
              ) -
              row.warehouseCost
            )}
          </span>
        </td>
      </tr>
    `).join("") ||
    emptyRow(
      12,
      "No warehouse result found."
    );
}

  function renderTransportResultTable() {
    const wrap = byId("transportRouteList");
    if (!wrap) return;

    const fdsOrders = state.orderRows.filter(row => row.transportType === "fds");

    const fdsVirtualRow = fdsOrders.length
      ? {
          routeId: "fds-charter",
          route: "FDS / Charter",
          date: "FDS batch",
          transportType: "fds",
          vehicle: "FDS",
          driver: "External",
          orders: fdsOrders.map(row => row.order),
          ordersCount: fdsOrders.length,
          stopsCount: 0,
          miles: 0,
          hours: 0,
          transportBaseRevenue: fdsOrders.reduce((s, r) => s + r.transportBaseRevenue, 0),
          fuelSurchargeRevenue: fdsOrders.reduce((s, r) => s + r.fuelSurchargeRevenue, 0),
          transportRevenue: fdsOrders.reduce((s, r) => s + r.transportRevenue, 0),
          transportCost: fdsOrders.reduce((s, r) => s + r.transportCost, 0)
        }
      : null;

    let rows = transportViewMode === "total"
      ? [...state.routeRows]
      : state.routeRows.filter(row => row.transportType === transportViewMode);

    if (fdsVirtualRow && (transportViewMode === "total" || transportViewMode === "fds")) {
      rows = [...rows, fdsVirtualRow];
    }

    if (!rows.length) {
      wrap.innerHTML = `<div style="padding:14px;">No transport result found.</div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table transport-master-table">
        <thead>
          <tr>
            <th style="width:40px;"></th>
            <th style="width:180px;">Route / Batch</th>
            <th style="width:100px;">Date</th>
            <th style="width:120px;">Type</th>
            <th style="width:90px;">Vehicle</th>
            <th style="width:90px;">Driver</th>
            <th style="width:60px;">Orders</th>
            <th style="width:60px;">Stops</th>
            <th style="width:70px;">Miles</th>
            <th style="width:70px;">Hours</th>
            <th style="width:95px;">Base Rev</th>
            <th style="width:90px;">Fuel</th>
            <th style="width:95px;">Revenue</th>
            <th style="width:95px;">Cost</th>
            <th style="width:100px;">Result</th>
            <th style="width:70px;">Margin</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(row => {
            const open = expandedTransportRoutes.has(String(row.routeId));
            const margin = row.transportRevenue
              ? (row.transportRevenue - row.transportCost) / row.transportRevenue
              : 0;

            const orderRows = row.orders.map(order => {
              const orderRow = state.orderRows.find(r => String(r.orderId) === String(order.id));
              if (!orderRow) return "";

              return `
                <tr class="transport-order-row">
                  <td></td>
                  <td colspan="2"><strong>${escapeHtml(orderRow.orderNumber)}</strong></td>
                  <td colspan="3">${escapeHtml(orderRow.retailer)}</td>
                  <td>${num(orderRow.colli)}</td>
                  <td>${num(orderRow.volume, 2)} m³</td>
                  <td colspan="2"></td>
                  <td>${money(orderRow.transportBaseRevenue)}</td>
                  <td>${money(orderRow.fuelSurchargeRevenue)}</td>
                  <td>${money(orderRow.transportRevenue)}</td>
                  <td>${money(orderRow.transportCost)}</td>
                  <td>
                    <span class="pill ${resultClass(orderRow.transportResult)}">
                      ${money(orderRow.transportResult)}
                    </span>
                  </td>
                  <td>${pct(orderRow.transportRevenue ? orderRow.transportResult / orderRow.transportRevenue : 0)}</td>
                </tr>
              `;
            }).join("");

            return `
              <tr class="transport-route-row" data-transport-route="${escapeHtml(row.routeId)}">
                <td>
                  <button class="transport-expand-btn" type="button" data-transport-expand="${escapeHtml(row.routeId)}">
                    ${open ? "−" : "+"}
                  </button>
                </td>
                <td><strong>${escapeHtml(row.route)}</strong></td>
                <td>${escapeHtml(String(row.date || "—").slice(0, 10))}</td>
                <td>${escapeHtml(row.transportType === "fds" ? "FDS / Charter" : "Own Transport")}</td>
                <td>${escapeHtml(row.vehicle)}</td>
                <td>${escapeHtml(row.driver)}</td>
                <td>${num(row.ordersCount)}</td>
                <td>${num(row.stopsCount)}</td>
                <td>${num(row.miles, 1)}</td>
                <td>${num(row.hours, 1)}</td>
                <td>${money(row.transportBaseRevenue)}</td>
                <td>${money(row.fuelSurchargeRevenue)}</td>
                <td>${money(row.transportRevenue)}</td>
                <td>${money(row.transportCost)}</td>
                <td>
                  <span class="pill ${resultClass(row.transportRevenue - row.transportCost)}">
                    ${money(row.transportRevenue - row.transportCost)}
                  </span>
                </td>
                <td>${pct(margin)}</td>
              </tr>

              ${
                open
                  ? `
                    <tr>
                      <td colspan="16">
                        <div class="transport-order-detail">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th></th>
                                <th>Order</th>
                                <th>Retailer</th>
                                <th>Packages</th>
                                <th>Volume</th>
                                <th>Base Revenue</th>
                                <th>Fuel Surcharge</th>
                                <th>Transport Revenue</th>
                                <th>Allocated Cost</th>
                                <th>Transport Result</th>
                                <th>Margin</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${orderRows || emptyRow(11, "No orders found for this route.")}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  `
                  : ""
              }
            `;
          }).join("")}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll("[data-transport-expand]").forEach(button => {
      button.addEventListener("click", () => {
        const id = String(button.dataset.transportExpand || "");

        if (expandedTransportRoutes.has(id)) {
          expandedTransportRoutes.delete(id);
        } else {
          expandedTransportRoutes.add(id);
        }

        renderTransportResultTable();
      });
    });
  }

  function renderCustomerProfitTable() {
    const body = byId("customerProfitTableBody");
    if (!body) return;

    const map = new Map();

    state.orderRows.forEach(row => {
      const key = row.customer || "Unknown";

      if (!map.has(key)) {
        map.set(key, {
          customer: key,
          orders: 0,
          routes: new Set(),
          adminRevenue: 0,
          warehouseRevenue: 0,
          warehouseCost: 0,
          transportRevenue: 0,
          transportCost: 0,
          totalRevenue: 0,
          totalCost: 0
        });
      }

      const r = map.get(key);

      r.orders += 1;
      if (row.route && row.route !== "—") r.routes.add(row.route);
      r.adminRevenue += row.adminRevenue;
      r.warehouseRevenue += row.warehouseRevenue;
      r.warehouseCost += row.warehouseCost;
      r.transportRevenue += row.transportRevenue;
      r.transportCost += row.transportCost;
      r.totalRevenue += row.totalRevenue;
      r.totalCost += row.totalCost;
    });

    const rows = Array.from(map.values())
      .map(row => ({
        ...row,
        result: row.totalRevenue - row.totalCost,
        margin: row.totalRevenue ? (row.totalRevenue - row.totalCost) / row.totalRevenue : 0
      }))
      .sort((a, b) => b.result - a.result);

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.customer)}</strong></td>
        <td>${num(row.orders)}</td>
        <td>${num(row.routes.size)}</td>
        <td>${money(row.warehouseRevenue)}</td>
        <td>${money(row.warehouseCost)}</td>
        <td>${money(row.transportRevenue)}</td>
        <td>${money(row.transportCost)}</td>
        <td><strong>${money(row.totalRevenue)}</strong></td>
        <td><strong>${money(row.totalCost)}</strong></td>
        <td><span class="pill ${resultClass(row.result)}">${money(row.result)}</span></td>
        <td>${pct(row.margin)}</td>
      </tr>
    `).join("") || emptyRow(11, "No customer result found.");
  }

  function renderFinanceResultTable() {
    const body = byId("financeResultTableBody");
    if (!body) return;

    const map = new Map();

    state.orderRows.forEach(row => {
      const key = row.customer || "Unknown";

      if (!map.has(key)) {
        map.set(key, {
          customer: key,
          invoices: 0,
          orders: 0,
          warehouseRevenue: 0,
          transportRevenue: 0,
          totalRevenue: 0,
          totalCost: 0
        });
      }

      const r = map.get(key);

      r.orders += 1;
      r.warehouseRevenue += row.warehouseRevenue;
      r.transportRevenue += row.transportRevenue;
      r.totalRevenue += row.totalRevenue;
      r.totalCost += row.totalCost;
    });

    state.invoices.forEach(invoice => {
      const customer = state.customers.find(c => String(c.id) === String(invoice.customer_id));
      const key = customer?.name || "Unknown";

      if (map.has(key)) map.get(key).invoices += 1;
    });

    const rows = Array.from(map.values())
      .map(row => ({
        ...row,
        result: row.totalRevenue - row.totalCost,
        margin: row.totalRevenue ? (row.totalRevenue - row.totalCost) / row.totalRevenue : 0
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.customer)}</strong></td>
        <td>${num(row.invoices)}</td>
        <td>${num(row.orders)}</td>
        <td>${money(row.warehouseRevenue)}</td>
        <td>${money(row.transportRevenue)}</td>
        <td><strong>${money(row.totalRevenue)}</strong></td>
        <td><strong>${money(row.totalCost)}</strong></td>
        <td><span class="pill ${resultClass(row.result)}">${money(row.result)}</span></td>
        <td>${pct(row.margin)}</td>
      </tr>
    `).join("") || emptyRow(9, "No finance result found.");
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function makeChart(id, type, labels, datasets) {
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
        }
      }
    });
  }

  function renderCharts() {
    const labels = state.periodRows.map(row => row.period);

    makeChart("chartResultTrend", "line", labels, [
      { label: "Revenue", data: state.periodRows.map(row => row.totalRevenue), tension: 0.35 },
      { label: "Cost", data: state.periodRows.map(row => row.totalCost), tension: 0.35 },
      { label: "Result", data: state.periodRows.map(row => row.totalResult), tension: 0.35 }
    ]);

    const warehouseRevenue = state.orderRows.reduce((sum, row) => sum + row.warehouseRevenue, 0);
    const transportRevenue = state.orderRows.reduce((sum, row) => sum + row.transportRevenue, 0);
    const adminRevenue = state.orderRows.reduce((sum, row) => sum + row.adminRevenue, 0);

    makeChart("chartRevenueMix", "doughnut", ["Warehouse", "Transport", "Admin"], [
      { label: "Revenue", data: [warehouseRevenue, transportRevenue, adminRevenue] }
    ]);
  }

  function updateGlobalKpiVisibility(activeTab) {
    const globalKpis = byId("globalKpiGrid");
    if (!globalKpis) return;

    globalKpis.style.display = activeTab === "transport" ? "none" : "";
  }

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));

        button.classList.add("active");
        byId(`tab-${button.dataset.tab}`)?.classList.add("active");

        updateGlobalKpiVisibility(button.dataset.tab);

        setTimeout(renderCharts, 50);
      });
    });
  }

  function bindTransportSwitch() {
    const totalBtn = byId("btnTransportTotal");
    const ownBtn = byId("btnTransportOwn");
    const fdsBtn = byId("btnTransportFds");

    function apply(mode) {
      transportViewMode = mode;

      totalBtn?.classList.toggle("active", mode === "total");
      ownBtn?.classList.toggle("active", mode === "own_transport");
      fdsBtn?.classList.toggle("active", mode === "fds");

      renderTransportResultTable();
    }

    totalBtn?.addEventListener("click", () => apply("total"));
    ownBtn?.addEventListener("click", () => apply("own_transport"));
    fdsBtn?.addEventListener("click", () => apply("fds"));
  }

  function exportCsv() {
    const rows = state.orderRows;

    const csv = [
      [
        "Order",
        "Retailer",
        "Customer",
        "Route",
        "Transport Type",
        "Admin Revenue",
        "Warehouse Revenue",
        "Warehouse Cost",
        "Transport Base Revenue",
        "Fuel Surcharge Revenue",
        "Transport Revenue",
        "Transport Cost",
        "Total Revenue",
        "Total Cost",
        "Total Result",
        "Margin"
      ],
      ...rows.map(row => [
        row.orderNumber,
        row.retailer,
        row.customer,
        row.route,
        row.transportType,
        row.adminRevenue,
        row.warehouseRevenue,
        row.warehouseCost,
        row.transportBaseRevenue,
        row.fuelSurchargeRevenue,
        row.transportRevenue,
        row.transportCost,
        row.totalRevenue,
        row.totalCost,
        row.totalResult,
        row.margin
      ])
    ].map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "veynor-profitability.csv";
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

    [
      "resultLevel",
      "periodPreset",
      "dateFrom",
      "dateTo",
      "customerFilter",
      "transportTypeFilter"
    ].forEach(id => {
      byId(id)?.addEventListener("change", processAll);
    });
  }

  async function init() {
    bindTabs();
    bindActions();
    bindTransportSwitch();
    updateGlobalKpiVisibility("overview");

    try {
      await loadData();
      showToast("Analytics loaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Analytics could not load.", "err");
    }
  }

window.VeynorAnalytics = {
  getClient: ensureClient,

  getCompanyId: async () => {
    return getCompanyId();
  },

  getOrders: () => {
    return state.orders;
  },

  getOrderRows: () => {
    return state.orderRows;
  },

  refresh: async () => {
    await loadData();
  },

  recalculate: () => {
    processAll();
  },

  toast: (message, type = "ok") => {
    showToast(message, type);
  }
};

  document.addEventListener("DOMContentLoaded", init);
})();