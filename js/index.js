(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const PRODUCT_OWNER_PROFILES_KEY = "product_owner_profiles";

  const UK_BOUNDS = [
    [49.5, -8.8],
    [60.9, 2.2]
  ];

  let client = null;
  let companyId = null;
  let dashboardMap = null;
  let dashboardMapLayer = null;
  let depotMarker = null;
let selectedFdsDate = "";

/*
 * Stock Value popup data.
 * Wordt iedere keer bijgewerkt wanneer
 * het dashboard opnieuw geladen wordt.
 */
let stockValueData = null;

const charts = {};

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
    if (value === null || value === undefined || value === "") return fallback;
    const num = Number(String(value).replace(",", "."));
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
    const d = new Date(String(value).slice(0, 10));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB");
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function monthStartIso() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  function getNextFridayIso() {
    const d = new Date();
    const day = d.getDay();
    const diff = (5 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
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

    window.clearTimeout(window.__dashboardToastTimer);
    window.__dashboardToastTimer = window.setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5000);
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    client = sb();
    return client;
  }

  async function safeQuery(label, callback, fallback = []) {
    try {
      return await callback();
    } catch (error) {
      console.warn(`[dashboard] ${label} skipped:`, error?.message || error);
      return fallback;
    }
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    const db = ensureClient();
    const { data, error } = await db
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    companyId = data.id;
    return companyId;
  }

  async function loadTable(tableName, cid, selectText = "*", options = {}) {
    return safeQuery(tableName, async () => {
      let q = client
        .from(tableName)
        .select(selectText)
        .eq("company_id", cid);

      if (options.orderBy) {
        q = q.order(options.orderBy, { ascending: options.ascending ?? false });
      }

      if (options.limit) {
        q = q.limit(options.limit);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadOrders(cid) {
    return loadTable("orders", cid, "*");
  }

async function loadItems(cid) {
  return safeQuery(
    "current stock items",
    async () => {

      const allItems = [];
      const pageSize = 1000;

      let from = 0;

      while (true) {

        const to =
          from + pageSize - 1;

        const {
          data,
          error
        } =
          await client
            .from("items")
            .select("*")
            .eq(
              "company_id",
              cid
            )
            .range(
              from,
              to
            );


        if (error) {
          throw error;
        }


        const batch =
          data || [];


        allItems.push(
          ...batch
        );


        /*
         * Minder dan 1000 ontvangen =
         * laatste pagina bereikt.
         */
        if (
          batch.length <
          pageSize
        ) {
          break;
        }


        from +=
          pageSize;
      }


      return allItems;
    },
    []
  );
}

function isDashboardStockItem(item) {
  const status =
    normalize(
      item?.status
    );


  /*
   * NIET meetellen:
   *
   * reserved = al verkocht / toegewezen
   * picked   = warehousevoorraad verlaten
   * loaded   = geladen
   * shipped  = verzonden
   * missing  = niet fysiek aanwezig
   * cancelled = vervallen
   */
  const excludedStatuses =
    new Set([
      "reserved",
      "picked",
      "loaded",
      "shipped",
      "missing",
      "cancelled"
    ]);


  if (
    excludedStatuses.has(
      status
    )
  ) {
    return false;
  }


  /*
   * Geblokkeerde voorraad telt WEL mee.
   *
   * Dus bijvoorbeeld damaged / blocked
   * blijft fysieke warehouse stock.
   */
  return true;
}

  async function loadProducts(cid) {
    return loadTable("products", cid, "*");
  }

  async function loadRoutes(cid) {
    return loadTable("routes", cid, "*");
  }

  async function loadRouteStops(cid) {
    return loadTable("route_stops", cid, "*");
  }

  async function loadVehicles(cid) {
    return loadTable("vehicles", cid, "*");
  }

  async function loadInvoices(cid) {
    return loadTable("invoices", cid, "*");
  }

  async function loadOrderDocuments(cid) {
    return loadTable("order_documents", cid, "*");
  }

async function loadDeliveryGroups(cid) {
  return loadTable("delivery_groups", cid, "*");
}

  async function loadOrderLines(cid) {
    return safeQuery("order lines", async () => {
      const attempts = [
        `
          *,
          products (
            id,
            weight_kg,
            net_weight_kg,
            gross_weight_kg,
            volume_m3
          )
        `,
        "*"
      ];

      let lastError = null;

      for (const selectText of attempts) {
        const { data, error } = await client
          .from("order_lines")
          .select(selectText)
          .eq("company_id", cid);

        if (!error) return data || [];
        lastError = error;
      }

      throw lastError;
    }, []);
  }

  async function loadEvents(cid) {
    return loadTable("warehouse_events", cid, "*", {
      orderBy: "created_at",
      ascending: false,
      limit: 8
    });
  }

  async function loadProductOwners(cid) {
    return safeQuery("product owner profiles", async () => {
      let profiles = [];

      const { data: settingsRow } = await client
        .from("settings")
        .select("setting_value")
        .eq("company_id", cid)
        .eq("setting_key", PRODUCT_OWNER_PROFILES_KEY)
        .maybeSingle();

      if (settingsRow?.setting_value) {
        try {
          profiles = JSON.parse(settingsRow.setting_value || "[]");
        } catch {
          profiles = [];
        }
      }

      if (!Array.isArray(profiles) || !profiles.length) {
        profiles = [
          {
            key: "bellstone",
            name: "Bellstone Furniture Distributors Ltd",
            trading_name: "Bellstone",
            customer_code: "BELLSTONE"
          },
          {
            key: "zoy",
            name: "Zoy",
            trading_name: "Zoy",
            customer_code: "ZOY"
          }
        ];
      }

      const customers = await loadTable("customers", cid, "*");

      return profiles.map(profile => {
        const searchValues = [
          profile.trading_name,
          profile.name,
          profile.customer_code,
          profile.default_import_name,
          profile.key
        ].map(normalize).filter(Boolean);

        const customer = customers.find(c => {
          const customerValues = [c.name, c.customer_code].map(normalize).filter(Boolean);
          return searchValues.some(search =>
            customerValues.some(cv => cv === search || cv.includes(search) || search.includes(cv))
          );
        });

        return {
          id: customer?.id || profile.key || profile.customer_code || profile.name,
          key: profile.key || profile.customer_code || "",
          name: profile.trading_name || profile.name || "Product Owner",
          legal_name: profile.name || "",
          customer_code: profile.customer_code || profile.key || "",
          dashboard_url: customer?.id
            ? `./customer-dashboard.html?customer_id=${encodeURIComponent(customer.id)}`
            : `./customer-dashboard.html?product_owner=${encodeURIComponent(profile.key || profile.customer_code || profile.name || "")}`
        };
      });
    }, []);
  }

  async function loadDepotSettings(cid) {
    return safeQuery("depot settings", async () => {
      for (const table of ["company_settings", "settings"]) {
        const { data, error } = await client
          .from(table)
          .select("setting_key, setting_value")
          .eq("company_id", cid)
          .in("setting_key", ["home_depot_name", "home_depot_lat", "home_depot_lng"]);

        if (!error && Array.isArray(data)) {
          const map = new Map(data.map(row => [row.setting_key, row.setting_value]));
          return {
            name: map.get("home_depot_name") || "Depot",
            lat: toNumber(map.get("home_depot_lat"), null),
            lng: toNumber(map.get("home_depot_lng"), null)
          };
        }
      }

      return { name: "Depot", lat: null, lng: null };
    }, { name: "Depot", lat: null, lng: null });
  }

  function isClosedStatus(value) {
    return ["delivered", "closed", "cancelled", "paid", "archived", "pod_completed"].includes(normalize(value));
  }

  function isOpenOrder(order) {
    const values = [
      order.status,
      order.warehouse_status,
      order.transport_status,
      order.overall_status
    ].map(normalize);

    return !values.some(isClosedStatus);
  }

  function isDeliveredOrder(order) {
    return [
      order.status,
      order.transport_status,
      order.warehouse_status,
      order.overall_status
    ].map(normalize).some(v => ["delivered", "closed", "pod_completed"].includes(v));
  }

  function hasCoordinates(order) {
    const lat = Number(order.delivery_lat);
    const lng = Number(order.delivery_lng);

    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= 49 &&
      lat <= 61 &&
      lng >= -9 &&
      lng <= 3
    );
  }

  function getOrderVolume(order) {
    return (
      toNumber(order.planning_volume_m3, 0) ||
      toNumber(order.total_order_volume_m3, 0) ||
      toNumber(order.total_volume_m3, 0) ||
      toNumber(order.volume_m3, 0)
    );
  }

  function getOrderColli(order) {
    return (
      toNumber(order.planning_colli, 0) ||
      toNumber(order.total_order_colli, 0) ||
      toNumber(order.total_colli, 0) ||
      toNumber(order.colli, 0)
    );
  }

  function getOrderRevenueDirect(order) {
    return Math.max(
      toNumber(order.estimated_revenue_gbp, 0),
      toNumber(order.total_customer_charge, 0),
      toNumber(order.customer_charge_gbp, 0),
      toNumber(order.revenue_gbp, 0),
      toNumber(order.order_revenue_gbp, 0),
      toNumber(order.transport_revenue_gbp, 0),
      toNumber(order.total_charge_gbp, 0),
      toNumber(order.total_order_charge, 0)
    );
  }

  function getLineRevenue(line) {
    return Math.max(
      toNumber(line.total_customer_charge, 0),
      toNumber(line.total_line_charge, 0),
      toNumber(line.line_total_gbp, 0),
      toNumber(line.revenue_gbp, 0),
      toNumber(line.transport_tariff_gbp, 0),
      toNumber(line.total_line_revenue_gbp, 0)
    );
  }

function getOrderWarehouseRevenue(order) {
  return (
    toNumber(order.total_storage_tariff, 0) +
    toNumber(order.total_handling_tariff, 0) +
    toNumber(order.total_admin_tariff, 0)
  );
}

function getOrderTransportRevenue(order) {
  return toNumber(
    order.total_transport_tariff,
    0
  );
}

function getInvoiceDocuments(invoice, orderDocuments) {
  const invoiceNumber = normalize(
    invoice.invoice_number || ""
  );

  if (!invoiceNumber) return [];

  return orderDocuments.filter(document =>
    normalize(document.document_type) === "invoice" &&
    normalize(document.document_number) === invoiceNumber
  );
}

function calculateMonthlyRevenueBreakdown(rows, monthInvoices) {
  let warehouseRevenue = 0;
  let transportRevenue = 0;
  let deliveryGroupSurcharge = 0;
  let invoiceSubtotal = 0;

  const countedOrderIds = new Set();

  monthInvoices.forEach(invoice => {
    invoiceSubtotal += toNumber(
      invoice.subtotal,
      0
    );

    const documents = getInvoiceDocuments(
      invoice,
      rows.orderDocuments
    );

    const orderIds = [
      ...new Set(
        documents
          .map(document => String(document.order_id || ""))
          .filter(Boolean)
      )
    ];

    orderIds.forEach(orderId => {
      const uniqueKey =
        `${invoice.id || invoice.invoice_number}|${orderId}`;

      if (countedOrderIds.has(uniqueKey)) {
        return;
      }

      countedOrderIds.add(uniqueKey);

      const order = rows.orders.find(row =>
        String(row.id) === String(orderId)
      );

      if (!order) return;

      warehouseRevenue +=
        getOrderWarehouseRevenue(order);

      transportRevenue +=
        getOrderTransportRevenue(order);
    });

    deliveryGroupSurcharge += (
      rows.deliveryGroups || []
    )
      .filter(group =>
        String(group.invoice_id || "") ===
        String(invoice.id || "")
      )
      .reduce(
        (sum, group) =>
          sum +
          toNumber(
            group.applied_surcharge ??
            group.calculated_surcharge,
            0
          ),
        0
      );
  });

  warehouseRevenue = Math.round(
    (warehouseRevenue + Number.EPSILON) * 100
  ) / 100;

  transportRevenue = Math.round(
    (transportRevenue + Number.EPSILON) * 100
  ) / 100;

  deliveryGroupSurcharge = Math.round(
    (deliveryGroupSurcharge + Number.EPSILON) * 100
  ) / 100;

  invoiceSubtotal = Math.round(
    (invoiceSubtotal + Number.EPSILON) * 100
  ) / 100;

  const fuelSurcharge = Math.round(
    (
      invoiceSubtotal -
      warehouseRevenue -
      transportRevenue -
      deliveryGroupSurcharge +
      Number.EPSILON
    ) * 100
  ) / 100;

  return {
    revenueExVat: invoiceSubtotal,
    warehouseRevenue,
    transportRevenue,
    fuelSurcharge,
    deliveryGroupSurcharge
  };
}

  function getOrderRevenue(order, orderLinesByOrder) {
    const direct = getOrderRevenueDirect(order);
    if (direct > 0) return direct;

    const lines = orderLinesByOrder.get(String(order.id)) || [];
    return lines.reduce((sum, line) => sum + getLineRevenue(line), 0);
  }

  function getOrderWeight(order, orderLinesByOrder) {
    const direct =
      toNumber(order.planning_weight_kg, 0) ||
      toNumber(order.total_order_weight_kg, 0) ||
      toNumber(order.total_weight_kg, 0) ||
      toNumber(order.weight_kg, 0) ||
      toNumber(order.matched_weight_kg, 0);

    if (direct > 0) return direct;

    const lines = orderLinesByOrder.get(String(order.id)) || [];

    return lines.reduce((sum, line) => {
      const qty =
        toNumber(line.quantity_ordered, 0) ||
        toNumber(line.quantity, 0) ||
        toNumber(line.qty, 0) ||
        1;

      const total =
        toNumber(line.total_line_weight_kg, 0) ||
        toNumber(line.total_weight_kg, 0);

      const unit =
        toNumber(line.unit_weight_kg, 0) ||
        toNumber(line.weight_kg, 0) ||
        toNumber(line.products?.weight_kg, 0) ||
        toNumber(line.products?.net_weight_kg, 0) ||
        toNumber(line.products?.gross_weight_kg, 0);

      return sum + (total || unit * qty);
    }, 0);
  }

  function getCustomerName(order) {
    return (
      order.customers?.name ||
      order.customer_name ||
      order.customer ||
      order.product_owner_name ||
      order.retail_name ||
      "Unknown"
    );
  }

  function getRetailerName(order) {
    return (
      order.retail_name ||
      order.retailer_name ||
      order.delivery_name ||
      order.shop_name ||
      order.customer_name ||
      "—"
    );
  }

  function getRouteDate(route) {
    return (
      route.planned_delivery_date ||
      route.route_date ||
      route.planned_date ||
      route.delivery_date ||
      ""
    );
  }

  function getRouteLabel(route) {
    return (
      route.route_code ||
      route.route_number ||
      route.route_name ||
      route.name ||
      "Route"
    );
  }

  function getRouteCost(route) {
    return Math.max(
      toNumber(route.estimated_cost_total_gbp, 0),
      toNumber(route.total_cost_gbp, 0),
      toNumber(route.cost_gbp, 0),
      toNumber(route.estimated_transport_cost_gbp, 0)
    );
  }

  function getRouteRevenueDirect(route) {
    return Math.max(
      toNumber(route.estimated_revenue_gbp, 0),
      toNumber(route.total_revenue_gbp, 0),
      toNumber(route.revenue_gbp, 0),
      toNumber(route.planned_revenue_gbp, 0)
    );
  }

  function createIndexes(rows) {
    const {
      orders,
      orderLines,
      routeStops
    } = rows;

    const ordersById = new Map();
    orders.forEach(order => ordersById.set(String(order.id), order));

    const orderLinesByOrder = new Map();
    orderLines.forEach(line => {
      const key = String(line.order_id || "");
      if (!key) return;
      if (!orderLinesByOrder.has(key)) orderLinesByOrder.set(key, []);
      orderLinesByOrder.get(key).push(line);
    });

    const stopsByRoute = new Map();
    routeStops.forEach(stop => {
      const key = String(stop.route_id || "");
      if (!key) return;
      if (!stopsByRoute.has(key)) stopsByRoute.set(key, []);
      stopsByRoute.get(key).push(stop);
    });

    stopsByRoute.forEach(list => {
      list.sort((a, b) =>
        toNumber(a.stop_sequence || a.stop_number, 0) -
        toNumber(b.stop_sequence || b.stop_number, 0)
      );
    });

    return {
      ordersById,
      orderLinesByOrder,
      stopsByRoute
    };
  }

  function getOrdersForRoute(route, rows, indexes) {
    const routeId = String(route.id);
    const byStop = (indexes.stopsByRoute.get(routeId) || [])
      .map(stop => indexes.ordersById.get(String(stop.order_id)))
      .filter(Boolean);

    const byOrderRouteId = rows.orders.filter(order => String(order.route_id || "") === routeId);

    const map = new Map();
    [...byStop, ...byOrderRouteId].forEach(order => map.set(String(order.id), order));
    return [...map.values()];
  }

  function getRouteSummary(route, rows, indexes) {
    const stops = indexes.stopsByRoute.get(String(route.id)) || [];
    const routeOrders = getOrdersForRoute(route, rows, indexes);

    const totalStops =
      stops.length ||
      toNumber(route.total_stops, 0) ||
      toNumber(route.planned_stops, 0) ||
      routeOrders.length;

    const totalVolume =
      stops.reduce((sum, stop) => sum + toNumber(stop.planned_volume_m3, 0), 0) ||
      routeOrders.reduce((sum, order) => sum + getOrderVolume(order), 0) ||
      toNumber(route.planned_volume_m3, 0) ||
      toNumber(route.total_volume_m3, 0);

    const totalColli =
      stops.reduce((sum, stop) => sum + toNumber(stop.planned_colli, 0), 0) ||
      routeOrders.reduce((sum, order) => sum + getOrderColli(order), 0) ||
      toNumber(route.planned_colli, 0) ||
      toNumber(route.total_colli, 0);

    const revenue =
      getRouteRevenueDirect(route) ||
      routeOrders.reduce((sum, order) => sum + getOrderRevenue(order, indexes.orderLinesByOrder), 0);

    const cost = getRouteCost(route);
    const result =
      toNumber(route.estimated_profit_gbp, NaN) ||
      toNumber(route.result_gbp, NaN) ||
      revenue - cost;

    return {
      id: route.id,
      label: getRouteLabel(route),
      date: getRouteDate(route),
      status: route.route_status || route.status || "planned",
      stops: totalStops,
      volume: totalVolume,
      colli: totalColli,
      miles: toNumber(route.estimated_distance_miles, 0) || toNumber(route.estimated_distance_km, 0) * 0.621371,
      hours: toNumber(route.estimated_total_hours, 0),
      revenue,
      cost,
      result,
      orders: routeOrders
    };
  }

  function hasActivePlannerVehicle(vehicle) {
    const flags = [
      vehicle.use_in_planning,
      vehicle.active,
      vehicle.is_active
    ];

    return !flags.some(value => {
      const v = normalize(value);
      return value === false || value === 0 || ["false", "0", "no", "off", "inactive"].includes(v);
    });
  }

  function getVehicleName(vehicle) {
    return (
      vehicle.name ||
      vehicle.vehicle_name ||
      vehicle.registration ||
      vehicle.vehicle_code ||
      "Vehicle"
    );
  }

  function getVehicleType(vehicle) {
    return normalize(vehicle.vehicle_type || vehicle.type || "");
  }

  function getCarrierVehicle(vehicles) {
    return vehicles.find(vehicle =>
      getVehicleType(vehicle) === "carrier" ||
      normalize(getVehicleName(vehicle)) === "fds" ||
      normalize(vehicle.name).includes("fds")
    ) || null;
  }

  function getCarrierOrderDate(order) {
    return (
      order.planned_route_date ||
      order.expected_delivery_date ||
      order.confirmed_delivery_date ||
      order.requested_delivery_date ||
      ""
    );
  }

  function getFdsOrders(rows, indexes, dateFilter = "") {
    const carrier = getCarrierVehicle(rows.vehicles);

    return rows.orders.filter(order => {
      const status = normalize(order.status);
      const transport = normalize(order.transport_type);
      const orderDate = getCarrierOrderDate(order);
      const carrierMatch = !carrier || !order.carrier_vehicle_id || String(order.carrier_vehicle_id) === String(carrier.id);

      const isFds =
        transport === "charter" ||
        transport === "fds" ||
        status === "export_for_charter";

      return (
        isFds &&
        status !== "delivered" &&
        !order.route_id &&
        carrierMatch &&
        (!dateFilter || !orderDate || String(orderDate).slice(0, 10) === dateFilter)
      );
    }).sort((a, b) => String(a.order_number || "").localeCompare(String(b.order_number || "")));
  }

  function getFdsDates(rows) {
    const dates = new Set();

    rows.orders.forEach(order => {
      const status = normalize(order.status);
      const transport = normalize(order.transport_type);
      const isFds = transport === "charter" || transport === "fds" || status === "export_for_charter";
      if (!isFds || order.route_id || status === "delivered") return;

      const date = String(getCarrierOrderDate(order) || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
    });

    return [...dates].sort();
  }

  function calculateMetrics(rows, indexes) {
    const today = todayIso();
    const monthStart = monthStartIso();

    const openOrders = rows.orders.filter(isOpenOrder);
    const openWithCoords = openOrders.filter(hasCoordinates);

    const readyPlanning = openOrders.filter(order => {
      const status = normalize(order.status);
      const transportStatus = normalize(order.transport_status);
      const transport = normalize(order.transport_type);

      const ready = ["ready_for_planning", "ready_for_picking"].includes(status);
      const alreadyPlanned =
        Boolean(order.route_id) ||
        status === "planned" ||
        transportStatus === "planned";

      const charter =
        transport === "charter" ||
        transport === "fds" ||
        status === "export_for_charter" ||
        transportStatus === "export_for_charter";

      return ready && !alreadyPlanned && !charter;
    });

    const awaitingGoods = openOrders.filter(order => {
      const status = normalize(order.status);
      const wh = normalize(order.warehouse_status);
      return ["imported", "matching_review"].includes(status) ||
        ["awaiting_goods", "partial_stock"].includes(wh);
    });

    const fullyMatched = openOrders.filter(order => {
      const status = normalize(order.status);
      const wh = normalize(order.warehouse_status);
      return ["ready_for_picking", "ready_for_planning"].includes(status) ||
        ["stock_complete", "picked"].includes(wh);
    });

    const plannedOrders = openOrders.filter(order =>
      Boolean(order.route_id) ||
      normalize(order.status) === "planned" ||
      normalize(order.transport_status) === "planned"
    );

    const deliveredToday = rows.orders.filter(order => {
      const dateValue = order.delivered_at || order.actual_delivery_date || order.confirmed_delivery_date;
      return dateValue && String(dateValue).slice(0, 10) === today;
    });

    const routeSummariesToday = rows.routes
      .filter(route => String(getRouteDate(route)).slice(0, 10) === today)
      .map(route => getRouteSummary(route, rows, indexes));

    const podDocs = rows.orderDocuments.filter(doc => {
      const type = normalize(doc.document_type);
      return type === "pod" || type === "signed_delivery_note" || type.includes("pod");
    });

    const podOrderIds = new Set(
      podDocs
        .filter(doc => doc.file_url || ["generated", "signed", "sent"].includes(normalize(doc.document_status)))
        .map(doc => String(doc.order_id))
    );

    const deliveredOrders = rows.orders.filter(isDeliveredOrder);
    const podsMissing = deliveredOrders.filter(order => !podOrderIds.has(String(order.id))).length;

    const productsMissingData = rows.products.filter(product =>
      toNumber(product.volume_m3, 0) <= 0 ||
      (
        toNumber(product.weight_kg, 0) <= 0 &&
        toNumber(product.net_weight_kg, 0) <= 0 &&
        toNumber(product.gross_weight_kg, 0) <= 0
      )
    ).length;

    const monthInvoices = rows.invoices.filter(invoice => {
      const dateValue = invoice.invoice_date || invoice.created_at;
      return dateValue && new Date(dateValue).toISOString() >= monthStart;
    });

const monthlyRevenue =
  calculateMonthlyRevenueBreakdown(
    rows,
    monthInvoices
  );

const revenueMonth =
  monthlyRevenue.revenueExVat;

    const openInvoices = rows.invoices.filter(invoice =>
      ["generated", "sent", "partially_paid"].includes(normalize(invoice.status))
    ).length;

    const paidInvoices = rows.invoices.filter(invoice => normalize(invoice.status) === "paid").length;

    const overdueInvoices = rows.invoices.filter(invoice => {
      const status = normalize(invoice.status);
      if (["paid", "closed"].includes(status)) return false;
      if (!invoice.due_date) return false;
      return String(invoice.due_date).slice(0, 10) < today;
    }).length;

const dashboardStockItems =
  rows.items.filter(
    isDashboardStockItem
  );


const stockAvailable =
  rows.items.filter(
    item =>
      normalize(
        item.status
      ) ===
      "in_stock"
  ).length;


const stockReserved =
  rows.items.filter(
    item =>
      normalize(
        item.status
      ) ===
      "reserved"
  ).length;


const stockPickedLoaded =
  rows.items.filter(
    item =>
      [
        "picked",
        "loaded",
        "shipped"
      ].includes(
        normalize(
          item.status
        )
      )
  ).length;


/*
 * Blocked stock is physically still
 * in the warehouse and therefore
 * remains part of Units in Stock.
 */
const stockBlocked =
  rows.items.filter(
    item =>
      [
        "damaged",
        "blocked"
      ].includes(
        normalize(
          item.status
        )
      )
  ).length;

    const releasedOrders = openOrders.filter(order =>
      order.planning_release === true ||
      normalize(order.planning_release) === "true" ||
      ["ready_for_planning", "ready_for_picking", "planned"].includes(normalize(order.status))
    );

    const completionBase = openOrders.length || 1;
    const completionCount = openOrders.filter(order =>
      Boolean(order.route_id) ||
      ["planned", "loaded"].includes(normalize(order.status)) ||
      ["planned", "loaded"].includes(normalize(order.transport_status))
    ).length;

    const completionPct = Math.round((completionCount / completionBase) * 100);
    const openVolume = openOrders.reduce((sum, order) => sum + getOrderVolume(order), 0);

 return {
  openOrders: openOrders.length,
  openWithCoords: openWithCoords.length,
  openMissingCoords:
    openOrders.length - openWithCoords.length,
  openVolume,

  readyPlanning: readyPlanning.length,
  plannedOrders: plannedOrders.length,
  podsMissing,

  revenueMonth,
  transportRevenueMonth:
    monthlyRevenue.transportRevenue,
  warehouseRevenueMonth:
    monthlyRevenue.warehouseRevenue,
  fuelSurchargeMonth:
    monthlyRevenue.fuelSurcharge,
  deliveryGroupSurchargeMonth:
    monthlyRevenue.deliveryGroupSurcharge,

  awaitingGoods: awaitingGoods.length,

      awaitingGoods: awaitingGoods.length,
      fullyMatched: fullyMatched.length,
      deliveredToday: deliveredToday.length,
      completionPct,

stockUnits:
  dashboardStockItems.length,
      stockAvailable,
      stockReserved,
      stockPickedLoaded,
      stockBlocked,
      productsMissingData,

      releasedOrders: releasedOrders.length,
      releasedWithCoords: releasedOrders.filter(hasCoordinates).length,
      missingCoords: releasedOrders.filter(order => !hasCoordinates(order)).length,
      charterOrders: openOrders.filter(order => {
        const status = normalize(order.status);
        const transport = normalize(order.transport_type);
        return transport === "charter" || transport === "fds" || status === "export_for_charter";
      }).length,
      activeVehicles: rows.vehicles.filter(hasActivePlannerVehicle).length,

      openInvoices,
      paidInvoices,
      overdueInvoices,
      monthInvoices: monthInvoices.length,

      routeSummariesToday
    };
  }

/* =========================================================
   STOCK VALUE
   ========================================================= */

function isCurrentPhysicalStockItem(item) {
  const status =
    normalize(item?.status);

  /*
   * Alleen items die fysiek nog in het warehouse
   * aanwezig zijn.
   *
   * Shipped / cancelled / missing tellen niet mee.
   */
  return ![
    "shipped",
    "cancelled",
    "missing"
  ].includes(status);
}


function getStockProductId(item) {
  return String(
    item?.product_id ||
    ""
  );
}


function getStockPackageNo(item) {
  return Math.max(
    1,
    Math.round(
      toNumber(
        item?.package_no,
        1
      )
    )
  );
}


function getStockPackageTotal(item, product) {
  return Math.max(
    1,
    Math.round(
      toNumber(
        item?.package_total,
        0
      ) ||
      toNumber(
        product?.package_count,
        0
      ) ||
      toNumber(
        product?.packages_per_unit,
        0
      ) ||
      1
    )
  );
}


function getStockOwner(product, productOwners) {
  const productCustomerId =
    String(
      product?.customer_id ||
      ""
    );

  /*
   * Eerst exacte customer_id proberen.
   */
  let owner =
    (productOwners || []).find(
      row =>
        String(
          row?.id ||
          ""
        ) ===
        productCustomerId
    );


  if (owner) {
    return owner;
  }


  /*
   * Fallback via eventuele owner velden
   * op het product.
   */
  const productOwnerText =
    normalize(
      [
        product?.product_owner,
        product?.product_owner_name,
        product?.customer_name,
        product?.customer_code
      ]
        .filter(Boolean)
        .join(" ")
    );


  owner =
    (productOwners || []).find(
      row => {
        const ownerValues = [
          row?.name,
          row?.legal_name,
          row?.customer_code,
          row?.key
        ]
          .map(normalize)
          .filter(Boolean);

        return ownerValues.some(
          value =>
            productOwnerText &&
            (
              productOwnerText === value ||
              productOwnerText.includes(value) ||
              value.includes(productOwnerText)
            )
        );
      }
    );


  if (owner) {
    return owner;
  }


  return {
    id:
      productCustomerId ||
      "unknown",

    key:
      "unknown",

    name:
      product?.customer_name ||
      product?.product_owner_name ||
      "Unknown Product Owner",

    legal_name:
      "",

    customer_code:
      ""
  };
}


function calculateCompleteStockUnits(
  productItems,
  product
) {
  if (!productItems.length) {
    return 0;
  }


  /*
   * Hoeveel packages horen bij één compleet product?
   */
  const packageTotal =
    Math.max(
      1,
      ...productItems.map(
        item =>
          getStockPackageTotal(
            item,
            product
          )
      ),
      Math.round(
        toNumber(
          product?.package_count,
          0
        )
      ),
      Math.round(
        toNumber(
          product?.packages_per_unit,
          0
        )
      )
    );


  /*
   * Product bestaat uit één package.
   *
   * Dan is ieder fysiek item één compleet product.
   */
  if (packageTotal <= 1) {
    return productItems.length;
  }


  /*
   * Voor multi-package producten tellen we
   * hoeveel van ieder package aanwezig zijn.
   *
   * Voorbeeld:
   *
   * 1/2 = 20
   * 2/2 = 18
   *
   * Complete products = 18.
   */
  const packageCounts =
    new Map();


  for (
    let packageNo = 1;
    packageNo <= packageTotal;
    packageNo++
  ) {
    packageCounts.set(
      packageNo,
      0
    );
  }


  productItems.forEach(
    item => {
      const packageNo =
        getStockPackageNo(
          item
        );

      packageCounts.set(
        packageNo,
        (
          packageCounts.get(
            packageNo
          ) ||
          0
        ) + 1
      );
    }
  );


  const counts =
    Array.from(
      packageCounts.values()
    );


  if (!counts.length) {
    return 0;
  }


  return Math.min(
    ...counts
  );
}


function calculateStockValue(
  items,
  products,
  productOwners
) {
const currentItems =
  (items || []).filter(
    isDashboardStockItem
  );


  const productsById =
    new Map(
      (products || []).map(
        product => [
          String(product.id),
          product
        ]
      )
    );


  /*
   * Groepeer fysieke items per product.
   */
  const itemsByProduct =
    new Map();


  currentItems.forEach(
    item => {
      const productId =
        getStockProductId(
          item
        );

      if (!productId) {
        return;
      }


      if (
        !itemsByProduct.has(
          productId
        )
      ) {
        itemsByProduct.set(
          productId,
          []
        );
      }


      itemsByProduct
        .get(productId)
        .push(item);
    }
  );


  const ownerMap =
    new Map();


  let totalCompleteProducts =
    0;

  let totalStorage =
    0;

  let totalAdmin =
    0;

  let totalHandling =
    0;


  itemsByProduct.forEach(
    (
      productItems,
      productId
    ) => {
      const product =
        productsById.get(
          productId
        );


      if (!product) {
        return;
      }


      const completeUnits =
        calculateCompleteStockUnits(
          productItems,
          product
        );


      if (
        completeUnits <= 0
      ) {
        return;
      }


      const storageRate =
        toNumber(
          product.storage_tariff,
          0
        );


      const adminRate =
        toNumber(
          product.admin_tariff,
          0
        );


      const handlingRate =
        toNumber(
          product.handling_tariff,
          0
        );


      const storage =
        completeUnits *
        storageRate;


      const admin =
        completeUnits *
        adminRate;


      const handling =
        completeUnits *
        handlingRate;


      const total =
        storage +
        admin +
        handling;


      const owner =
        getStockOwner(
          product,
          productOwners
        );


      const ownerKey =
        String(
          owner.id ||
          owner.key ||
          owner.customer_code ||
          owner.name ||
          "unknown"
        );


      if (
        !ownerMap.has(
          ownerKey
        )
      ) {
        ownerMap.set(
          ownerKey,
          {
            key:
              ownerKey,

            name:
              owner.name ||
              "Unknown Product Owner",

            legalName:
              owner.legal_name ||
              "",

            customerCode:
              owner.customer_code ||
              "",

            productCount:
              0,

            packages:
              0,

            units:
              0,

            storage:
              0,

            admin:
              0,

            handling:
              0,

            total:
              0,

            products:
              []
          }
        );
      }


      const ownerRow =
        ownerMap.get(
          ownerKey
        );


      ownerRow.productCount +=
        1;

      ownerRow.packages +=
        productItems.length;

      ownerRow.units +=
        completeUnits;

      ownerRow.storage +=
        storage;

      ownerRow.admin +=
        admin;

      ownerRow.handling +=
        handling;

      ownerRow.total +=
        total;


      ownerRow.products.push({
        sku:
          product.sku_base ||
          productItems[0]?.sku_base ||
          "—",

        name:
          product.name ||
          product.description ||
          "Product",

        packages:
          productItems.length,

        units:
          completeUnits,

        storageRate,
        adminRate,
        handlingRate,

        storage,
        admin,
        handling,
        total
      });


      totalCompleteProducts +=
        completeUnits;

      totalStorage +=
        storage;

      totalAdmin +=
        admin;

      totalHandling +=
        handling;
    }
  );


  const owners =
    Array.from(
      ownerMap.values()
    )
      .map(
        owner => ({
          ...owner,

          products:
            owner.products.sort(
              (a, b) =>
                String(
                  a.sku
                ).localeCompare(
                  String(
                    b.sku
                  ),
                  "en-GB",
                  {
                    numeric:
                      true
                  }
                )
            )
        })
      )
      .sort(
        (a, b) =>
          b.total -
          a.total
      );


  return {
    physicalPackages:
      currentItems.length,

    completeProducts:
      totalCompleteProducts,

    ownerCount:
      owners.length,

    storage:
      totalStorage,

    admin:
      totalAdmin,

    handling:
      totalHandling,

    total:
      totalStorage +
      totalAdmin +
      totalHandling,

    owners
  };
}


function renderStockValueSummary() {
  const data =
    stockValueData;


  if (!data) {
    return;
  }


  setText(
    "stockValuePhysicalPackages",
    formatNumber(
      data.physicalPackages
    )
  );


  setText(
    "stockValueCompleteProducts",
    formatNumber(
      data.completeProducts
    )
  );


  setText(
    "stockValueGrandTotal",
    formatMoney(
      data.total
    )
  );


  setText(
    "stockValueOwnerCount",
    formatNumber(
      data.ownerCount
    )
  );


  setText(
    "stockValueTotalProducts",
    formatNumber(
      data.owners.reduce(
        (sum, owner) =>
          sum +
          owner.productCount,
        0
      )
    )
  );


  setText(
    "stockValueTotalUnits",
    formatNumber(
      data.completeProducts
    )
  );


  setText(
    "stockValueTotalStorage",
    formatMoney(
      data.storage
    )
  );


  setText(
    "stockValueTotalAdmin",
    formatMoney(
      data.admin
    )
  );


  setText(
    "stockValueTotalHandling",
    formatMoney(
      data.handling
    )
  );


  setText(
    "stockValueTotalValue",
    formatMoney(
      data.total
    )
  );


  const body =
    byId(
      "stockValueOwnerBody"
    );


  if (body) {
    if (
      !data.owners.length
    ) {
      body.innerHTML = `
        <tr>
          <td colspan="8">
            No current stock found.
          </td>
        </tr>
      `;

    } else {
      body.innerHTML =
        data.owners
          .map(
            owner => `
              <tr>
                <td>
                  <strong>
                    ${escapeHtml(
                      owner.name
                    )}
                  </strong>

                  ${
                    owner.customerCode
                      ? `
                        <div
                          style="
                            margin-top:2px;
                            color:#94a3b8;
                            font-size:10px;
                          "
                        >
                          ${escapeHtml(
                            owner.customerCode
                          )}
                        </div>
                      `
                      : ""
                  }
                </td>

                <td class="num">
                  ${formatNumber(
                    owner.productCount
                  )}
                </td>

                <td class="num">
                  ${formatNumber(
                    owner.units
                  )}
                </td>

                <td class="num">
                  ${formatMoney(
                    owner.storage
                  )}
                </td>

                <td class="num">
                  ${formatMoney(
                    owner.admin
                  )}
                </td>

                <td class="num">
                  ${formatMoney(
                    owner.handling
                  )}
                </td>

                <td class="num">
                  <strong>
                    ${formatMoney(
                      owner.total
                    )}
                  </strong>
                </td>

                <td class="num">
                  <button
                    type="button"
                    class="stock-value-small-btn"
                    data-stock-owner-detail="${escapeHtml(
                      owner.key
                    )}"
                  >
                    View
                  </button>
                </td>
              </tr>
            `
          )
          .join("");
    }
  }


  setText(
    "stockValueUpdated",
    `Calculated ${new Date().toLocaleString(
      "en-GB"
    )}`
  );
}


function renderStockValueOwnerDetail(
  ownerKey
) {
  if (!stockValueData) {
    return;
  }


  const owner =
    stockValueData.owners.find(
      row =>
        String(
          row.key
        ) ===
        String(
          ownerKey
        )
    );


  if (!owner) {
    return;
  }


  const section =
    byId(
      "stockValueDetailSection"
    );


  const body =
    byId(
      "stockValueDetailBody"
    );


  setText(
    "stockValueDetailTitle",
    owner.name
  );


  setText(
    "stockValueDetailSub",
    `Warehouse value by SKU · ${formatNumber(
      owner.units
    )} complete products · ${formatMoney(
      owner.total
    )}`
  );


  if (body) {
    body.innerHTML =
      owner.products
        .map(
          product => `
            <tr>

              <td>
                <strong>
                  ${escapeHtml(
                    product.sku
                  )}
                </strong>
              </td>

              <td>
                ${escapeHtml(
                  product.name
                )}
              </td>

              <td class="num">
                ${formatNumber(
                  product.packages
                )}
              </td>

              <td class="num">
                ${formatNumber(
                  product.units
                )}
              </td>

              <td class="num">
                ${formatMoney(
                  product.storage
                )}

                <div
                  style="
                    color:#94a3b8;
                    font-size:9px;
                  "
                >
                  ${formatMoney(
                    product.storageRate
                  )} / unit
                </div>
              </td>

              <td class="num">
                ${formatMoney(
                  product.admin
                )}

                <div
                  style="
                    color:#94a3b8;
                    font-size:9px;
                  "
                >
                  ${formatMoney(
                    product.adminRate
                  )} / unit
                </div>
              </td>

              <td class="num">
                ${formatMoney(
                  product.handling
                )}

                <div
                  style="
                    color:#94a3b8;
                    font-size:9px;
                  "
                >
                  ${formatMoney(
                    product.handlingRate
                  )} / unit
                </div>
              </td>

              <td class="num">
                <strong>
                  ${formatMoney(
                    product.total
                  )}
                </strong>
              </td>

            </tr>
          `
        )
        .join("");
  }


  if (section) {
    section.style.display =
      "block";

    section.scrollIntoView({
      behavior:
        "smooth",

      block:
        "nearest"
    });
  }
}


function openStockValueModal() {
  const modal =
    byId(
      "stockValueModal"
    );


  if (!modal) {
    return;
  }


  const loading =
    byId(
      "stockValueLoading"
    );


  const content =
    byId(
      "stockValueContent"
    );


  const error =
    byId(
      "stockValueError"
    );


  modal.classList.add(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  document.body.style.overflow =
    "hidden";


  if (error) {
    error.style.display =
      "none";
  }


  if (!stockValueData) {
    if (loading) {
      loading.style.display =
        "block";
    }

    if (content) {
      content.style.display =
        "none";
    }

    return;
  }


  if (loading) {
    loading.style.display =
      "none";
  }


  if (content) {
    content.style.display =
      "block";
  }


  const detail =
    byId(
      "stockValueDetailSection"
    );


  if (detail) {
    detail.style.display =
      "none";
  }


  renderStockValueSummary();
}


function closeStockValueModal() {
  const modal =
    byId(
      "stockValueModal"
    );


  if (!modal) {
    return;
  }


  modal.classList.remove(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  document.body.style.overflow =
    "";
}

  function renderKpis(m) {
    setText("kpiOpenOrders", formatNumber(m.openOrders));
    setText("kpiStockUnits", formatNumber(m.stockUnits));
    setText("kpiReadyPlanning", formatNumber(m.readyPlanning));
    setText("kpiPlannedOrders", formatNumber(m.plannedOrders));
    setText("kpiPodsMissing", formatNumber(m.podsMissing));
    setText("kpiRevenueMonth", formatMoney(m.revenueMonth));
setText(
  "kpiTransportRevenueMonth",
  formatMoney(m.transportRevenueMonth)
);

setText(
  "kpiWarehouseRevenueMonth",
  formatMoney(m.warehouseRevenueMonth)
);

setText(
  "kpiFuelSurchargeMonth",
  formatMoney(m.fuelSurchargeMonth)
);

setText(
  "kpiDeliveryGroupSurchargeMonth",
  formatMoney(m.deliveryGroupSurchargeMonth)
);

    setText("mapOpenMarkers", formatNumber(m.openWithCoords));
    setText("mapMissingGeo", formatNumber(m.openMissingCoords));
    setText("mapOpenVolume", formatNumber(m.openVolume, 2));

    setText("snapAwaitingGoods", formatNumber(m.awaitingGoods));
    setText("snapFullyMatched", formatNumber(m.fullyMatched));
    setText("snapPlannedOrders", formatNumber(m.plannedOrders));
    setText("snapDeliveredToday", formatNumber(m.deliveredToday));

    setText("completionPct", `${m.completionPct}%`);
    setText("completionText", `${m.completionPct}% of open orders are planned or on route.`);

    const bar = byId("completionBar");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, m.completionPct))}%`;

    setText("routeReleased", formatNumber(m.releasedOrders));
    setText("routeWithCoords", `${formatNumber(m.releasedWithCoords)} / ${formatNumber(m.releasedOrders)}`);
    setText("routeVehicles", formatNumber(m.activeVehicles));
    setText("routeCharter", formatNumber(m.charterOrders));
  }

  function renderTodayRoutes(routeSummaries) {
    const revenue = routeSummaries.reduce((sum, route) => sum + route.revenue, 0);
    const cost = routeSummaries.reduce((sum, route) => sum + route.cost, 0);
    const result = revenue - cost;

    setText("todayRoutesCount", formatNumber(routeSummaries.length));
    setText("todayRoutesRevenue", formatMoney(revenue));
    setText("todayRoutesCost", formatMoney(cost));
    setText("todayRoutesResult", formatMoney(result));

    const list = byId("todayRoutesList");
    if (!list) return;

    if (!routeSummaries.length) {
      list.innerHTML = `
        <div class="activity-row">
          <div class="activity-main">
            <div class="activity-title">No routes today</div>
            <div class="activity-sub">Nothing planned for today.</div>
          </div>
        </div>
      `;
      return;
    }

list.innerHTML = `
  <details class="activity-row" style="display:block;">
    <summary style="cursor:pointer;font-weight:950;color:#07152f;">
      Show today's routes (${formatNumber(routeSummaries.length)})
    </summary>

    <div style="display:grid;gap:9px;margin-top:12px;">
      ${routeSummaries.map(route => `
        <div class="activity-row">
          <div class="activity-main">
            <div class="activity-title">${escapeHtml(route.label)}</div>
            <div class="activity-sub">
              ${formatNumber(route.stops)} stops
              · ${formatNumber(route.volume, 2)} m³
              · ${formatMoney(route.revenue)} revenue
              · ${formatMoney(route.cost)} cost
            </div>
          </div>
          <div class="summary-number" style="color:${route.result >= 0 ? "#16a34a" : "#dc2626"};">
            ${formatMoney(route.result)}
          </div>
        </div>
      `).join("")}
    </div>
  </details>
`;
  }

  function renderFdsDateSelector(dates, currentDate) {
    const host = byId("fdsPlanningDate");
    if (!host) return;

    const allDates = dates.length ? dates : [currentDate || getNextFridayIso()];
    const options = allDates.map(date => `
      <option value="${escapeHtml(date)}" ${date === currentDate ? "selected" : ""}>
        ${escapeHtml(formatDate(date))}
      </option>
    `).join("");

    host.innerHTML = `
      <select id="fdsDateSelect" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:11px;font-weight:800;background:#fff;">
        ${options}
      </select>
    `;

    byId("fdsDateSelect")?.addEventListener("change", event => {
      selectedFdsDate = event.target.value;
      loadDashboard();
    });
  }

  function renderFdsPlanning(rows, indexes) {
    const dates = getFdsDates(rows);
    const defaultDate = dates.includes(getNextFridayIso())
      ? getNextFridayIso()
      : dates[0] || getNextFridayIso();

    const date = selectedFdsDate || defaultDate;
    selectedFdsDate = date;

    renderFdsDateSelector(dates, date);

    const orders = getFdsOrders(rows, indexes, date);

    const colli = orders.reduce((sum, order) => sum + getOrderColli(order), 0);
    const volume = orders.reduce((sum, order) => sum + getOrderVolume(order), 0);
    const weight = orders.reduce((sum, order) => sum + getOrderWeight(order, indexes.orderLinesByOrder), 0);

    setText("fdsOrdersCount", formatNumber(orders.length));
    setText("fdsPlanningVolume", `${formatNumber(volume, 2)} m³`);
    setText("fdsPlanningColli", formatNumber(colli));
    setText("fdsPlanningWeight", `${formatNumber(weight, 0)} kg`);

    const list = byId("fdsPlanningList");
    if (!list) return;

    if (!orders.length) {
      list.innerHTML = `
        <div class="activity-row">
          <div class="activity-main">
            <div class="activity-title">No FDS orders</div>
            <div class="activity-sub">No charter handover currently planned for ${escapeHtml(formatDate(date))}.</div>
          </div>
        </div>
      `;
      return;
    }

list.innerHTML = `
  <details class="activity-row warning" style="display:block;">
    <summary style="cursor:pointer;font-weight:950;color:#07152f;">
      Show S2U / FDS orders (${formatNumber(orders.length)})
    </summary>

    <div style="display:grid;gap:9px;margin-top:12px;">
      ${orders.slice(0, 12).map(order => {
        const weightKg = getOrderWeight(order, indexes.orderLinesByOrder);

        return `
          <div class="activity-row warning">
            <div class="activity-main">
              <div class="activity-title">
                ${escapeHtml(order.order_number || "—")} · ${escapeHtml(getRetailerName(order))}
              </div>
              <div class="activity-sub">
                ${escapeHtml(order.delivery_city || "—")}
                · ${escapeHtml(order.delivery_postcode || "—")}
                · ${formatNumber(getOrderColli(order))} colli
                · ${formatNumber(getOrderVolume(order), 2)} m³
                · ${formatNumber(weightKg, 0)} kg
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  </details>
`;
  }

  function renderAlerts(m) {
    const alerts = [];

    if (m.openMissingCoords > 0) {
      alerts.push({
        type: "warning",
        title: "Open orders not shown on map",
        sub: "Open orders exist without valid UK latitude / longitude.",
        count: m.openMissingCoords
      });
    }

    if (m.podsMissing > 0) {
      alerts.push({
        type: "warning",
        title: "PODs missing",
        sub: "Delivered orders without POD document.",
        count: m.podsMissing
      });
    }

    if (m.productsMissingData > 0) {
      alerts.push({
        type: "warning",
        title: "Products missing volume / weight",
        sub: "This can affect matching, planning and billing.",
        count: m.productsMissingData
      });
    }

    if (m.overdueInvoices > 0) {
      alerts.push({
        type: "danger",
        title: "Overdue invoices",
        sub: "Invoices past due date.",
        count: m.overdueInvoices
      });
    }

    if (!alerts.length) {
      alerts.push({
        type: "ok",
        title: "No critical alerts",
        sub: "Operations look stable at the moment.",
        count: "OK"
      });
    }

    const list = byId("alertsList");
    if (!list) return;

    list.innerHTML = alerts.map(alert => `
      <div class="alert-row ${alert.type}">
        <div class="alert-main">
          <div class="alert-title">${escapeHtml(alert.title)}</div>
          <div class="alert-sub">${escapeHtml(alert.sub)}</div>
        </div>
        <div class="alert-number">${escapeHtml(alert.count)}</div>
      </div>
    `).join("");
  }

  function renderRecentActivity(events) {
    const list = byId("recentActivity");
    if (!list) return;

    if (!events.length) {
      list.innerHTML = `
        <div class="activity-row">
          <div class="activity-main">
            <div class="activity-title">No recent events found</div>
            <div class="activity-sub">Warehouse event logging has no recent rows.</div>
          </div>
        </div>
      `;
      return;
    }

    list.innerHTML = events.map(event => `
      <div class="activity-row">
        <div class="activity-main">
          <div class="activity-title">${escapeHtml(event.event_type || "Event")}</div>
          <div class="activity-sub">
            ${escapeHtml(event.reference_no || event.entity_type || "—")}
            · ${escapeHtml(event.source_module || "system")}
            · ${escapeHtml(formatDateTime(event.created_at))}
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderTopCustomers(orders) {
    const body = byId("topCustomersBody");
    if (!body) return;

    const openOrders = orders.filter(isOpenOrder);
    const map = new Map();

    openOrders.forEach(order => {
      const name = getCustomerName(order);

      if (!map.has(name)) {
        map.set(name, {
          name,
          orders: 0,
          volume: 0
        });
      }

      const row = map.get(name);
      row.orders += 1;
      row.volume += getOrderVolume(order);
    });

    const rows = [...map.values()]
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8);

    body.innerHTML = rows.length
      ? rows.map(row => `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${formatNumber(row.orders)}</td>
            <td>${formatNumber(row.volume, 2)} m³</td>
          </tr>
        `).join("")
      : `<tr><td colspan="3">No open orders found.</td></tr>`;
  }

  function customerInitials(name) {
    const text = String(name || "").trim();
    if (!text) return "PO";

    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  function renderCustomerDashboardLinks(productOwners) {
    const box = byId("customerDashboardLinks");
    if (!box) return;

    if (!productOwners.length) {
      box.innerHTML = `
        <div class="activity-row">
          <div class="activity-main">
            <div class="activity-title">No Product Owners found</div>
            <div class="activity-sub">Add Bellstone, Zoy or other product owners in Settings.</div>
          </div>
        </div>
      `;
      return;
    }

    box.innerHTML = productOwners.map(owner => `
      <a class="customer-dashboard-card" href="${escapeHtml(owner.dashboard_url)}">
        <div class="customer-dashboard-top">
          <div class="customer-avatar">${escapeHtml(customerInitials(owner.name))}</div>
          <div class="customer-dashboard-arrow">→</div>
        </div>
        <strong>${escapeHtml(owner.name || "Product Owner")}</strong>
        <span>${escapeHtml(owner.legal_name || owner.customer_code || "Product Owner Dashboard")}</span>
      </a>
    `).join("");
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      charts[id] = null;
    }
  }

  function renderChart(id, config) {
    const canvas = byId(id);
    if (!canvas || !window.Chart) return;
    destroyChart(id);
    charts[id] = new Chart(canvas, config);
  }

  function renderCharts(m) {
    renderChart("completionChart", {
      type: "doughnut",
      data: {
        labels: ["Planned / on route", "Open remaining"],
        datasets: [{
          data: [m.completionPct, Math.max(0, 100 - m.completionPct)]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: { legend: { position: "bottom" } }
      }
    });

    renderChart("stockStatusChart", {
      type: "bar",
      data: {
        labels: ["Available", "Reserved", "Picked / Loaded", "Blocked"],
        datasets: [{
          label: "Stock items",
          data: [m.stockAvailable, m.stockReserved, m.stockPickedLoaded, m.stockBlocked]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });

    renderChart("financeChart", {
      type: "bar",
      data: {
        labels: ["Revenue", "Open invoices", "Paid", "Overdue"],
        datasets: [{
          label: "Finance",
          data: [m.revenueMonth, m.openInvoices, m.paidInvoices, m.overdueInvoices]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ctx.dataIndex === 0 ? formatMoney(ctx.parsed.y) : formatNumber(ctx.parsed.y)
            }
          }
        },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  function getMarkerColour(order) {
    const status = normalize(order.status);
    const transport = normalize(order.transport_type);

    if (transport === "charter" || transport === "fds" || status === "export_for_charter") return "#f59e0b";
    if (transport === "own_transport" || status === "planned" || Boolean(order.route_id)) return "#16a34a";
    return "#2563eb";
  }

  function markerPopup(order) {
    return `
      <div style="display:grid;gap:5px;min-width:210px;">
        <strong>${escapeHtml(order.order_number || "Order")}</strong>
        <div>${escapeHtml(getCustomerName(order))}</div>
        <div>${escapeHtml(getRetailerName(order))}</div>
        <div>${escapeHtml(order.delivery_city || "—")} · ${escapeHtml(order.delivery_postcode || "—")}</div>
        <div>${formatNumber(getOrderColli(order))} colli · ${formatNumber(getOrderVolume(order), 2)} m³</div>
        <div>${escapeHtml((order.transport_type || "unassigned").replaceAll("_", " "))}</div>
      </div>
    `;
  }

  function initDashboardMap() {
    const el = byId("dashboardMap");
    if (!el || typeof L === "undefined") return;
    if (dashboardMap) return;

    dashboardMap = L.map(el, {
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(dashboardMap);

    dashboardMapLayer = L.layerGroup().addTo(dashboardMap);
    dashboardMap.fitBounds(UK_BOUNDS);

    setTimeout(() => dashboardMap.invalidateSize(true), 250);
    setTimeout(() => dashboardMap.invalidateSize(true), 800);
  }

  function renderDashboardMap(orders, depot) {
    initDashboardMap();
    if (!dashboardMap || !dashboardMapLayer) return;

    dashboardMapLayer.clearLayers();

    if (depotMarker) {
      dashboardMap.removeLayer(depotMarker);
      depotMarker = null;
    }

    const boundsPoints = [];

    if (
      depot &&
      Number.isFinite(Number(depot.lat)) &&
      Number.isFinite(Number(depot.lng))
    ) {
      const lat = Number(depot.lat);
      const lng = Number(depot.lng);

      depotMarker = L.circleMarker([lat, lng], {
        radius: 10,
        weight: 3,
        color: "#ffffff",
        fillColor: "#dc2626",
        fillOpacity: 1
      }).addTo(dashboardMap);

      depotMarker.bindPopup(`
        <div style="display:grid;gap:4px;min-width:160px;">
          <strong>${escapeHtml(depot.name || "Depot")}</strong>
          <div>${formatNumber(lat, 6)}, ${formatNumber(lng, 6)}</div>
        </div>
      `);

      boundsPoints.push([lat, lng]);
    }

    orders.filter(isOpenOrder).forEach(order => {
      if (!hasCoordinates(order)) return;

      const lat = Number(order.delivery_lat);
      const lng = Number(order.delivery_lng);

      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        weight: 2,
        color: "#ffffff",
        fillColor: getMarkerColour(order),
        fillOpacity: 0.95
      });

      marker.bindPopup(markerPopup(order));
      dashboardMapLayer.addLayer(marker);
      boundsPoints.push([lat, lng]);
    });

    if (boundsPoints.length > 1) {
      dashboardMap.fitBounds(L.latLngBounds(boundsPoints).pad(0.16));
    } else {
      dashboardMap.fitBounds(UK_BOUNDS);
    }

    setTimeout(() => dashboardMap.invalidateSize(true), 150);
  }

  function fitDashboardMap() {
    if (!dashboardMap) return;

    const layers = [];

    if (dashboardMapLayer) {
      dashboardMapLayer.eachLayer(layer => {
        if (typeof layer.getLatLng === "function") layers.push(layer.getLatLng());
      });
    }

    if (depotMarker && typeof depotMarker.getLatLng === "function") {
      layers.push(depotMarker.getLatLng());
    }

    if (layers.length > 1) {
      dashboardMap.fitBounds(L.latLngBounds(layers).pad(0.16));
    } else {
      dashboardMap.fitBounds(UK_BOUNDS);
    }
  }

function bindEvents() {
  /*
   * Normal dashboard controls
   */
  byId(
    "btnRefreshDashboard"
  )?.addEventListener(
    "click",
    loadDashboard
  );


  byId(
    "btnFitDashboardMap"
  )?.addEventListener(
    "click",
    fitDashboardMap
  );


  /*
   * Normal dashboard navigation cards
   */
  document
    .querySelectorAll(
      "[data-go]"
    )
    .forEach(
      card => {
        card.addEventListener(
          "click",
          () => {
            const url =
              card.getAttribute(
                "data-go"
              );

            if (url) {
              window.location.href =
                url;
            }
          }
        );
      }
    );


  /*
   * =====================================================
   * STOCK VALUE MODAL
   * =====================================================
   */

  const stockCard =
    byId(
      "stockValueKpiCard"
    );


  /*
   * Click Units in Stock
   */
  stockCard?.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      openStockValueModal();
    }
  );


  /*
   * Keyboard accessibility:
   * Enter / Space also opens modal.
   */
  stockCard?.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();

        openStockValueModal();
      }
    }
  );


  /*
   * X button
   */
  byId(
    "stockValueCloseBtn"
  )?.addEventListener(
    "click",
    closeStockValueModal
  );


  /*
   * Close button in footer
   */
  byId(
    "stockValueModalCloseBtn"
  )?.addEventListener(
    "click",
    closeStockValueModal
  );


  /*
   * Click dark background
   */
  document
    .querySelectorAll(
      "[data-stock-value-close]"
    )
    .forEach(
      element => {
        element.addEventListener(
          "click",
          closeStockValueModal
        );
      }
    );


  /*
   * Hide product detail
   */
  byId(
    "stockValueHideDetailBtn"
  )?.addEventListener(
    "click",
    () => {
      const section =
        byId(
          "stockValueDetailSection"
        );

      if (section) {
        section.style.display =
          "none";
      }
    }
  );


  /*
   * Product Owner View buttons.
   *
   * These buttons are created dynamically,
   * so event delegation is used.
   */
  byId(
    "stockValueOwnerBody"
  )?.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest(
          "[data-stock-owner-detail]"
        );

      if (!button) {
        return;
      }


      const ownerKey =
        button.getAttribute(
          "data-stock-owner-detail"
        );


      if (ownerKey) {
        renderStockValueOwnerDetail(
          ownerKey
        );
      }
    }
  );


  /*
   * ESC closes popup
   */
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape"
      ) {
        const modal =
          byId(
            "stockValueModal"
          );

        if (
          modal?.classList.contains(
            "open"
          )
        ) {
          closeStockValueModal();
        }
      }
    }
  );


  /*
   * Existing map resize logic
   */
  window.addEventListener(
    "resize",
    () => {
      if (dashboardMap) {
        dashboardMap.invalidateSize(
          true
        );
      }
    }
  );
}

  async function loadDashboard() {
    try {
      ensureClient();
      const cid = await getCompanyId();

      setText("dashboardDateLabel", new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }));

  const [
  orders,
  items,
  products,
  routes,
  routeStops,
  vehicles,
  invoices,
  orderDocuments,
  orderLines,
  deliveryGroups,
  events,
  productOwners,
  depot
] = await Promise.all([
        loadOrders(cid),
        loadItems(cid),
        loadProducts(cid),
        loadRoutes(cid),
        loadRouteStops(cid),
        loadVehicles(cid),
        loadInvoices(cid),
        loadOrderDocuments(cid),
        loadOrderLines(cid),
loadDeliveryGroups(cid),
        loadEvents(cid),
        loadProductOwners(cid),
        loadDepotSettings(cid)
      ]);

const rows = {
  orders,
  items,
  products,
  routes,
  routeStops,
  vehicles,
  invoices,
  orderDocuments,
  orderLines,
  deliveryGroups
};

const indexes =
  createIndexes(
    rows
  );


const metrics =
  calculateMetrics(
    rows,
    indexes
  );


/*
 * =====================================================
 * CALCULATE CURRENT STOCK VALUE
 * =====================================================
 *
 * Uses:
 * - physical stock items
 * - products
 * - product owners
 *
 * The result is stored globally so opening
 * the popup does not need another database query.
 */
stockValueData =
  calculateStockValue(
    items,
    products,
    productOwners
  );


renderKpis(
  metrics
);
      renderTodayRoutes(metrics.routeSummariesToday);
      renderFdsPlanning(rows, indexes);
      renderAlerts(metrics);
      renderRecentActivity(events);
      renderTopCustomers(orders);
      renderCustomerDashboardLinks(productOwners);
      renderCharts(metrics);
      renderDashboardMap(orders, depot);

      showToast("Dashboard refreshed.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Dashboard failed to load.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    initDashboardMap();
    await loadDashboard();
  });
})();