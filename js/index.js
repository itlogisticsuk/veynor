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

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = `notice ${type}`;

    window.clearTimeout(window.__dashboardToastTimer);
    window.__dashboardToastTimer = window.setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6000);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    client = sb();
    return client;
  }

  async function safeQuery(label, callback, fallback) {
    try {
      return await callback();
    } catch (error) {
      console.warn(`[dashboard] ${label} skipped:`, error.message);
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

  function isClosedStatus(value) {
    return [
      "delivered",
      "closed",
      "cancelled",
      "paid",
      "archived"
    ].includes(normalize(value));
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
      toNumber(order.volume_m3, 0)
    );
  }

  function getCustomerName(order) {
    return (
      order.customers?.name ||
      order.customer_name ||
      order.retail_name ||
      "Unknown"
    );
  }

  function getRetailerName(order) {
    return (
      order.retail_name ||
      order.delivery_name ||
      order.customer_name ||
      "—"
    );
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

  async function loadOrders(cid) {
    return safeQuery("orders", async () => {
      const attempts = [
        `
          id, company_id, customer_id, order_number, status, warehouse_status,
          transport_status, overall_status, planning_release, planning_colli,
          planning_volume_m3, total_order_volume_m3, volume_m3,
          delivery_lat, delivery_lng, delivery_city, delivery_postcode,
          delivery_country, transport_type, route_id, delivered_at,
          actual_delivery_date, confirmed_delivery_date, requested_delivery_date,
          created_at, retail_name, customer_name,
          customers (id, name, customer_code)
        `,
        `
          id, company_id, customer_id, order_number, status, warehouse_status,
          transport_status, planning_release, planning_colli, planning_volume_m3,
          delivery_lat, delivery_lng, delivery_city, delivery_postcode,
          delivery_country, transport_type, route_id, delivered_at,
          confirmed_delivery_date, requested_delivery_date,
          created_at, retail_name, customer_name,
          customers (id, name, customer_code)
        `,
        `
          id, company_id, customer_id, order_number, status, warehouse_status,
          transport_status, planning_release, planning_colli, planning_volume_m3,
          delivery_lat, delivery_lng, delivery_city, delivery_postcode,
          delivery_country, transport_type, route_id, delivered_at,
          confirmed_delivery_date, requested_delivery_date,
          created_at, retail_name, customer_name
        `,
        `
          id, company_id, customer_id, order_number, status,
          planning_release, planning_colli, planning_volume_m3,
          delivery_lat, delivery_lng, delivery_city, delivery_postcode,
          transport_type, route_id, created_at
        `
      ];

      let lastError = null;

      for (const selectText of attempts) {
        const { data, error } = await client
          .from("orders")
          .select(selectText)
          .eq("company_id", cid);

        if (!error) {
          console.log("[dashboard] orders loaded:", data?.length || 0);
          return data || [];
        }

        lastError = error;
        console.warn("[dashboard] orders select fallback failed:", error.message);
      }

      throw lastError || new Error("Orders could not be loaded.");
    }, []);
  }

  async function loadItems(cid) {
    return safeQuery("items", async () => {
      const { data, error } = await client
        .from("items")
        .select("id, status, company_id, created_at")
        .eq("company_id", cid);

      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadProducts(cid) {
    return safeQuery("products", async () => {
      const { data, error } = await client
        .from("products")
        .select("id, volume_m3, weight_kg, net_weight_kg, company_id")
        .eq("company_id", cid);

      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadRoutes(cid) {
    return safeQuery("routes", async () => {
      const { data, error } = await client
        .from("routes")
        .select("id, company_id, planned_date, created_at, route_status, status")
        .eq("company_id", cid);

      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadVehicles(cid) {
    return safeQuery("vehicles", async () => {
      const { data, error } = await client
        .from("vehicles")
        .select("*")
        .eq("company_id", cid);

      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadInvoices(cid) {
    return safeQuery("invoices", async () => {
      const { data, error } = await client
        .from("invoices")
        .select("id, company_id, invoice_date, due_date, total_amount, subtotal, vat_amount, status, created_at")
        .eq("company_id", cid);

      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadOrderDocuments(cid) {
    return safeQuery("order_documents", async () => {
      const { data, error } = await client
        .from("order_documents")
        .select("id, company_id, order_id, document_type, document_status, file_url, created_at")
        .eq("company_id", cid);

      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadEvents(cid) {
    return safeQuery("warehouse_events", async () => {
      const { data, error } = await client
        .from("warehouse_events")
        .select("id, event_type, entity_type, reference_no, source_module, old_status, new_status, created_at")
        .eq("company_id", cid)
        .order("created_at", { ascending: false })
        .limit(8);

      if (error) throw error;
      return data || [];
    }, []);
  }

  async function loadProductOwners(cid) {
    return safeQuery("product owner profiles", async () => {
      let profiles = [];

      const { data: settingsRow, error: settingsError } = await client
        .from("settings")
        .select("setting_value")
        .eq("company_id", cid)
        .eq("setting_key", PRODUCT_OWNER_PROFILES_KEY)
        .maybeSingle();

      if (!settingsError && settingsRow?.setting_value) {
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

      const { data: customers, error: customersError } = await client
        .from("customers")
        .select("id, name, customer_code")
        .eq("company_id", cid);

      if (customersError) throw customersError;

      return profiles.map(profile => {
        const searchValues = [
          profile.trading_name,
          profile.name,
          profile.customer_code,
          profile.default_import_name,
          profile.key
        ].map(normalize).filter(Boolean);

        const customer = (customers || []).find(c => {
          const customerValues = [
            c.name,
            c.customer_code
          ].map(normalize).filter(Boolean);

          return searchValues.some(search =>
            customerValues.some(cv =>
              cv === search ||
              cv.includes(search) ||
              search.includes(cv)
            )
          );
        });

        const dashboardUrl = customer?.id
          ? `./customer-dashboard.html?customer_id=${encodeURIComponent(customer.id)}`
          : `./customer-dashboard.html?product_owner=${encodeURIComponent(profile.key || profile.customer_code || profile.name)}`;

        return {
          id: customer?.id || profile.key || profile.customer_code,
          key: profile.key || profile.customer_code || "",
          name: profile.trading_name || profile.name || "Product Owner",
          legal_name: profile.name || "",
          customer_code: profile.customer_code || profile.key || "",
          dashboard_url: dashboardUrl
        };
      });
    }, []);
  }

  async function loadDepotSettings(cid) {
    return safeQuery("depot settings", async () => {
      const attempts = [
        { table: "company_settings" },
        { table: "settings" }
      ];

      for (const attempt of attempts) {
        const { data, error } = await client
          .from(attempt.table)
          .select("setting_key, setting_value")
          .eq("company_id", cid)
          .in("setting_key", [
            "home_depot_name",
            "home_depot_lat",
            "home_depot_lng"
          ]);

        if (!error && Array.isArray(data)) {
          const map = new Map(data.map(row => [row.setting_key, row.setting_value]));

          return {
            name: map.get("home_depot_name") || "Depot",
            lat: toNumber(map.get("home_depot_lat"), null),
            lng: toNumber(map.get("home_depot_lng"), null)
          };
        }
      }

      return {
        name: "Depot",
        lat: null,
        lng: null
      };
    }, {
      name: "Depot",
      lat: null,
      lng: null
    });
  }

  function calculateMetrics(rows) {
    const {
      orders,
      items,
      products,
      routes,
      vehicles,
      invoices,
      orderDocuments
    } = rows;

    const today = todayIso();
    const monthStart = monthStartIso();

    const openOrders = orders.filter(isOpenOrder);
    const openWithCoords = openOrders.filter(hasCoordinates);

    const releasedOrders = orders.filter(o =>
      o.planning_release === true ||
      normalize(o.planning_release) === "true"
    );

    const readyPlanning = orders.filter(o =>
      normalize(o.status) === "ready_for_planning" ||
      normalize(o.status) === "ready_for_picking" ||
      o.planning_release === true ||
      normalize(o.planning_release) === "true"
    );

    const awaitingGoods = orders.filter(o => {
      const status = normalize(o.status);
      const wh = normalize(o.warehouse_status);

      return ["imported", "matching_review"].includes(status) ||
        ["awaiting_goods", "partial_stock"].includes(wh);
    });

    const fullyMatched = orders.filter(o => {
      const status = normalize(o.status);
      const wh = normalize(o.warehouse_status);

      return ["ready_for_picking", "ready_for_planning"].includes(status) ||
        ["stock_complete", "picked"].includes(wh);
    });

    const plannedOrders = openOrders.filter(o =>
      normalize(o.status) === "planned" ||
      normalize(o.transport_status) === "planned" ||
      Boolean(o.route_id)
    );

    const deliveredToday = orders.filter(o => {
      const dateValue = o.delivered_at || o.actual_delivery_date || o.confirmed_delivery_date;
      return dateValue && String(dateValue).slice(0, 10) === today;
    });

    const routesToday = routes.filter(r => {
      const dateValue = r.planned_date || r.created_at;
      return dateValue && String(dateValue).slice(0, 10) === today;
    });

    const podDocs = orderDocuments.filter(d => normalize(d.document_type) === "pod");
    const podOrderIds = new Set(
      podDocs
        .filter(d => d.file_url || ["generated", "signed", "sent"].includes(normalize(d.document_status)))
        .map(d => String(d.order_id))
    );

    const deliveredOrders = orders.filter(o =>
      isClosedStatus(o.status) ||
      normalize(o.transport_status) === "delivered"
    );

    const podsMissing = deliveredOrders.filter(o => !podOrderIds.has(String(o.id))).length;

    const stockUnits = items.length;
    const stockAvailable = items.filter(i => normalize(i.status) === "in_stock").length;
    const stockReserved = items.filter(i => normalize(i.status) === "reserved").length;
    const stockPickedLoaded = items.filter(i =>
      ["picked", "loaded", "shipped"].includes(normalize(i.status))
    ).length;
    const stockBlocked = items.filter(i =>
      ["missing", "damaged", "cancelled"].includes(normalize(i.status))
    ).length;

    const productsMissingData = products.filter(p =>
      toNumber(p.volume_m3, 0) <= 0 ||
      (toNumber(p.weight_kg, 0) <= 0 && toNumber(p.net_weight_kg, 0) <= 0)
    ).length;

    const releasedWithCoords = releasedOrders.filter(hasCoordinates).length;
    const missingCoords = releasedOrders.filter(o => !hasCoordinates(o)).length;
    const charterOrders = openOrders.filter(o => normalize(o.transport_type) === "charter").length;
    const activeVehicles = vehicles.filter(hasActivePlannerVehicle).length;

    const monthInvoices = invoices.filter(inv => {
      const dateValue = inv.invoice_date || inv.created_at;
      return dateValue && new Date(dateValue).toISOString() >= monthStart;
    });

    const revenueMonth = monthInvoices.reduce((sum, inv) => {
      return sum + (
        toNumber(inv.total_amount, 0) ||
        toNumber(inv.subtotal, 0) + toNumber(inv.vat_amount, 0)
      );
    }, 0);

    const openInvoices = invoices.filter(inv =>
      ["generated", "sent", "partially_paid"].includes(normalize(inv.status))
    ).length;

    const paidInvoices = invoices.filter(inv =>
      normalize(inv.status) === "paid"
    ).length;

    const overdueInvoices = invoices.filter(inv => {
      const status = normalize(inv.status);
      if (["paid", "closed"].includes(status)) return false;
      if (!inv.due_date) return false;
      return String(inv.due_date).slice(0, 10) < today;
    }).length;

    const completionBase = openOrders.length || 1;
    const completionCount = openOrders.filter(o =>
      ["planned", "loaded", "delivered", "closed"].includes(normalize(o.status)) ||
      ["planned", "loaded", "delivered"].includes(normalize(o.transport_status)) ||
      Boolean(o.route_id)
    ).length;

    const completionPct = Math.round((completionCount / completionBase) * 100);
    const openVolume = openOrders.reduce((sum, order) => sum + getOrderVolume(order), 0);

    return {
      openOrders: openOrders.length,
      openWithCoords: openWithCoords.length,
      openMissingCoords: openOrders.length - openWithCoords.length,
      openVolume,

      readyPlanning: readyPlanning.length,
      routesToday: routesToday.length,
      podsMissing,
      revenueMonth,

      awaitingGoods: awaitingGoods.length,
      fullyMatched: fullyMatched.length,
      plannedOrders: plannedOrders.length,
      deliveredToday: deliveredToday.length,
      completionPct,

      stockUnits,
      stockAvailable,
      stockReserved,
      stockPickedLoaded,
      stockBlocked,
      productsMissingData,

      releasedOrders: releasedOrders.length,
      releasedWithCoords,
      missingCoords,
      charterOrders,
      activeVehicles,

      openInvoices,
      paidInvoices,
      overdueInvoices,
      monthInvoices: monthInvoices.length
    };
  }

  function renderKpis(m) {
    setText("kpiOpenOrders", formatNumber(m.openOrders));
    setText("kpiStockUnits", formatNumber(m.stockUnits));
    setText("kpiReadyPlanning", formatNumber(m.readyPlanning));
    setText("kpiMapPoints", formatNumber(m.openWithCoords));
    setText("kpiPodsMissing", formatNumber(m.podsMissing));
    setText("kpiRevenueMonth", formatMoney(m.revenueMonth));

    setText("mapOpenMarkers", formatNumber(m.openWithCoords));
    setText("mapMissingGeo", formatNumber(m.openMissingCoords));
    setText("mapOpenVolume", formatNumber(m.openVolume, 2));

    setText("snapAwaitingGoods", formatNumber(m.awaitingGoods));
    setText("snapFullyMatched", formatNumber(m.fullyMatched));
    setText("snapPlannedOrders", formatNumber(m.plannedOrders));
    setText("snapDeliveredToday", formatNumber(m.deliveredToday));

    setText("completionPct", `${m.completionPct}%`);
    setText("completionText", `${m.completionPct}% of open orders are planned or delivered.`);

    const bar = byId("completionBar");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, m.completionPct))}%`;

    setText("routeReleased", formatNumber(m.releasedOrders));
    setText("routeWithCoords", `${formatNumber(m.releasedWithCoords)} / ${formatNumber(m.releasedOrders)}`);
    setText("routeVehicles", formatNumber(m.activeVehicles));
    setText("routeCharter", formatNumber(m.charterOrders));
  }

  function renderAlerts(m) {
    const alerts = [];

    if (m.awaitingGoods > 0) {
      alerts.push({
        type: "warning",
        title: "Orders awaiting goods",
        sub: "Stock is not complete yet.",
        count: m.awaitingGoods
      });
    }

    if (m.openMissingCoords > 0) {
      alerts.push({
        type: "warning",
        title: "Open orders not shown on map",
        sub: "Open orders exist without valid UK latitude / longitude.",
        count: m.openMissingCoords
      });
    }

    if (m.missingCoords > 0) {
      alerts.push({
        type: "danger",
        title: "Released orders missing coordinates",
        sub: "These cannot be planned correctly on the map.",
        count: m.missingCoords
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

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="3">No open orders found.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${formatNumber(row.orders)}</td>
        <td>${formatNumber(row.volume, 2)} m³</td>
      </tr>
    `).join("");
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
        labels: ["Planned / delivered", "Open remaining"],
        datasets: [{
          data: [
            m.completionPct,
            Math.max(0, 100 - m.completionPct)
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: { position: "bottom" }
        }
      }
    });

    renderChart("stockStatusChart", {
      type: "bar",
      data: {
        labels: ["Available", "Reserved", "Picked / Loaded", "Blocked"],
        datasets: [{
          label: "Stock items",
          data: [
            m.stockAvailable,
            m.stockReserved,
            m.stockPickedLoaded,
            m.stockBlocked
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });

    renderChart("financeChart", {
      type: "bar",
      data: {
        labels: ["Revenue", "Open invoices", "Paid", "Overdue"],
        datasets: [{
          label: "Finance",
          data: [
            m.revenueMonth,
            m.openInvoices,
            m.paidInvoices,
            m.overdueInvoices
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataIndex === 0) return formatMoney(ctx.parsed.y);
                return formatNumber(ctx.parsed.y);
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  function getMarkerColour(order) {
    const transport = normalize(order.transport_type);

    if (transport === "charter") return "#f59e0b";
    if (transport === "own_transport" || order.planning_release === true) return "#16a34a";
    return "#2563eb";
  }

  function markerPopup(order) {
    return `
      <div style="display:grid;gap:5px;min-width:210px;">
        <strong>${escapeHtml(order.order_number || "Order")}</strong>
        <div>${escapeHtml(getCustomerName(order))}</div>
        <div>${escapeHtml(getRetailerName(order))}</div>
        <div>${escapeHtml(order.delivery_city || "—")} · ${escapeHtml(order.delivery_postcode || "—")}</div>
        <div>${formatNumber(order.planning_colli || 0)} colli · ${formatNumber(getOrderVolume(order), 2)} m³</div>
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

    const openOrders = orders.filter(isOpenOrder);
    const boundsPoints = [];

    if (depot && depot.lat !== null && depot.lng !== null) {
      depotMarker = L.circleMarker([depot.lat, depot.lng], {
        radius: 10,
        weight: 3,
        color: "#ffffff",
        fillColor: "#dc2626",
        fillOpacity: 1
      }).addTo(dashboardMap);

      depotMarker.bindPopup(`
        <div style="display:grid;gap:4px;min-width:160px;">
          <strong>${escapeHtml(depot.name || "Depot")}</strong>
          <div>${formatNumber(depot.lat, 6)}, ${formatNumber(depot.lng, 6)}</div>
        </div>
      `);

      boundsPoints.push([depot.lat, depot.lng]);
    }

    openOrders.forEach(order => {
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
    byId("btnRefreshDashboard")?.addEventListener("click", async () => {
      await loadDashboard();
    });

    byId("btnFitDashboardMap")?.addEventListener("click", fitDashboardMap);

    document.querySelectorAll("[data-go]").forEach(card => {
      card.addEventListener("click", () => {
        const url = card.getAttribute("data-go");
        if (url) window.location.href = url;
      });
    });

    window.addEventListener("resize", () => {
      if (dashboardMap) dashboardMap.invalidateSize(true);
    });
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
        vehicles,
        invoices,
        orderDocuments,
        events,
        productOwners,
        depot
      ] = await Promise.all([
        loadOrders(cid),
        loadItems(cid),
        loadProducts(cid),
        loadRoutes(cid),
        loadVehicles(cid),
        loadInvoices(cid),
        loadOrderDocuments(cid),
        loadEvents(cid),
        loadProductOwners(cid),
        loadDepotSettings(cid)
      ]);

      const metrics = calculateMetrics({
        orders,
        items,
        products,
        routes,
        vehicles,
        invoices,
        orderDocuments
      });

      renderKpis(metrics);
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