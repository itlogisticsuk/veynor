(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let companyId = null;
  let selectedCustomerId = null;
  let selectedCustomer = null;

  let rawOrders = [];
  let filteredOrders = [];

  const charts = {};

  const ROLE = {
    VEYNOR_ADMIN: "veynor_admin",
    TENANT_ADMIN: "tenant_admin",
    TENANT_USER: "tenant_user",
    PRODUCT_OWNER_ADMIN: "product_owner_admin",
    PRODUCT_OWNER_USER: "product_owner_user",
    RETAILER_USER: "retailer_user"
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
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

  function formatPercent(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0%";
    return `${Math.round(num)}%`;
  }

  function formatDays(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num) || num <= 0) return "—";
    return `${formatNumber(num, 1)}d`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB");
  }

  function monthKey(value) {
    if (!value) return "Unknown";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Unknown";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(key) {
    if (!key || key === "Unknown") return "Unknown";
    const [year, month] = key.split("-").map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
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

    window.clearTimeout(window.__customerDashToast);
    window.__customerDashToast = window.setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5500);
  }

  function isTenantRole() {
    return [
      ROLE.VEYNOR_ADMIN,
      ROLE.TENANT_ADMIN,
      ROLE.TENANT_USER
    ].includes(normalize(currentProfile?.role));
  }

  function isProductOwnerRole() {
    return [
      ROLE.PRODUCT_OWNER_ADMIN,
      ROLE.PRODUCT_OWNER_USER
    ].includes(normalize(currentProfile?.role));
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  async function loadProfile() {
    const { data: userData, error: userError } = await client.auth.getUser();

    if (userError) throw userError;

    currentUser = userData?.user || null;

    if (!currentUser?.id) {
      window.location.href = "/login.html";
      throw new Error("Not authenticated.");
    }

    const { data, error } = await client
      .from("user_profiles")
      .select(`
        *,
        companies (
          id,
          name
        ),
        customers (
          id,
          name,
          customer_code
        )
      `)
      .eq("id", currentUser.id)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("No active profile found.");

    currentProfile = data;
    companyId = data.company_id || null;

    if (!companyId && normalize(data.role) === ROLE.VEYNOR_ADMIN) {
      const { data: company, error: companyError } = await client
        .from("companies")
        .select("id, name")
        .eq("name", TENANT_NAME)
        .maybeSingle();

      if (companyError) throw companyError;
      if (!company?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

      companyId = company.id;
    }
  }

  async function resolveCustomer() {
    if (isProductOwnerRole()) {
      selectedCustomerId = currentProfile.customer_id;
    } else if (isTenantRole()) {
      selectedCustomerId = getQueryParam("customer_id") || null;
    }

    if (!selectedCustomerId) {
      if (isTenantRole()) {
        await loadCustomerPicker();
        return;
      }

      throw new Error("No customer selected.");
    }

    const { data, error } = await client
      .from("customers")
      .select("id, name, customer_code, billing_email")
      .eq("id", selectedCustomerId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Selected customer not found.");

    selectedCustomer = data;

    setText("customerName", selectedCustomer.name || "Customer");
    setText(
      "customerMeta",
      selectedCustomer.customer_code
        ? `Customer code: ${selectedCustomer.customer_code}`
        : "Customer portal"
    );

    if (isTenantRole()) {
      await loadCustomerPicker();
      const select = byId("customerSelect");
      if (select) select.value = selectedCustomerId;
    }
  }

  async function loadCustomerPicker() {
    const wrap = byId("adminCustomerPickerWrap");
    const select = byId("customerSelect");

    if (!isTenantRole() || !wrap || !select) return;

    wrap.style.display = "";

    const { data, error } = await client
      .from("customers")
      .select("id, name, customer_code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });

    if (error) throw error;

    const rows = data || [];

    select.innerHTML = rows.length
      ? rows.map(row => `
          <option value="${escapeHtml(row.id)}">
            ${escapeHtml(row.name || "Customer")}${row.customer_code ? ` · ${escapeHtml(row.customer_code)}` : ""}
          </option>
        `).join("")
      : `<option value="">No customers found</option>`;

    if (!selectedCustomerId && rows[0]?.id) {
      selectedCustomerId = rows[0].id;
      selectedCustomer = rows[0];
      setText("customerName", selectedCustomer.name || "Customer");
      setText(
        "customerMeta",
        selectedCustomer.customer_code
          ? `Customer code: ${selectedCustomer.customer_code}`
          : "Customer portal"
      );
    }

    if (selectedCustomerId) select.value = selectedCustomerId;
  }

  function getOrderLines(order) {
    return Array.isArray(order.order_lines) ? order.order_lines : [];
  }

  function getDoc(order, type) {
    return (order.order_documents || []).find(doc =>
      normalize(doc.document_type) === normalize(type)
    ) || null;
  }

  function hasDocument(order, type) {
    const doc = getDoc(order, type);
    return !!doc?.file_url || ["generated", "sent", "signed"].includes(normalize(doc?.document_status));
  }

  function getLineRequiredQty(line) {
    return toNumber(line.quantity_ordered || 0, 0);
  }

  function getLineMatchedQty(line) {
    const allocations = (line.order_allocations || []).filter(allocation =>
      !["cancelled", "removed", "unreserved"].includes(normalize(allocation.allocation_status))
    );

    return allocations.length;
  }

  function getProductCompleteness(order) {
    const lines = getOrderLines(order);

    const required = lines.reduce((sum, line) => sum + getLineRequiredQty(line), 0);
    const matched = lines.reduce((sum, line) => {
      const req = getLineRequiredQty(line);
      return sum + Math.min(getLineMatchedQty(line), req);
    }, 0);

    const missing = Math.max(0, required - matched);
    const pct = required > 0 ? Math.min(100, Math.round((matched / required) * 100)) : 0;

    let status = "none";
    if (required > 0 && missing <= 0) status = "complete";
    if (required > 0 && missing > 0) status = "missing";

    return { required, matched, missing, pct, status };
  }

  function getRetailerName(order) {
    return cleanText(order.retail_name || order.retailer_name || order.delivery_name || "—");
  }

  function getPostcode(order) {
    return cleanText(order.delivery_postcode || "—");
  }

  function deriveFinanceStatus(order) {
    const explicit = normalize(order.finance_status || "");
    const invoice = getDoc(order, "invoice");

    if (normalize(invoice?.document_status) === "sent") return "invoice_sent";
    if (invoice?.file_url || normalize(invoice?.document_status) === "generated") return "invoice_generated";
    if (explicit && explicit !== "not_invoiced") return explicit;

    return "not_invoiced";
  }

  function deriveLifecycleStatus(order) {
    const financeStatus = deriveFinanceStatus(order);

    if (financeStatus === "paid") return "closed";
    if (["invoice_generated", "invoice_sent"].includes(financeStatus)) return "invoiced";

    const status = normalize(order.status || "");
    const warehouseStatus = normalize(order.warehouse_status || "");
    const transportStatus = normalize(order.transport_status || "");
    const overall = normalize(order.overall_status || "");

    if (["delivery_issue", "returned", "failed_delivery", "issue"].includes(overall)) return "issue";

    if (
      status === "delivered" ||
      warehouseStatus === "delivered" ||
      transportStatus === "delivered"
    ) {
      return "delivered";
    }

    if (
      ["loaded", "dispatched", "out_for_delivery", "on_transport"].includes(status) ||
      ["loaded", "dispatched", "out_for_delivery", "on_transport"].includes(transportStatus)
    ) {
      return "on_transport";
    }

    if (warehouseStatus === "picked") return "picked";

    const completeness = getProductCompleteness(order);

    if (completeness.required > 0 && completeness.missing <= 0) return "stock_complete";
    if (completeness.required > 0 && completeness.missing > 0) return "awaiting_goods";

    if (warehouseStatus === "partial_stock") return "awaiting_goods";
    if (warehouseStatus === "ready_for_loading") return "picked";

    return "order_received";
  }

  function getExpectedDate(order) {
    return order.confirmed_delivery_date || order.expected_delivery_date || order.requested_delivery_date || "";
  }

  function getDeliveredDate(order) {
    return order.delivered_at || order.actual_delivery_date || order.delivery_completed_at || "";
  }

  function getCompleteDate(order) {
    return order.stock_completed_at || order.goods_complete_at || order.ready_for_planning_at || "";
  }

  function dayDiff(start, end) {
    if (!start || !end) return null;

    const a = new Date(start);
    const b = new Date(end);

    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;

    return Math.max(0, (b.getTime() - a.getTime()) / 86400000);
  }

  function enrichOrder(order) {
    const completeness = getProductCompleteness(order);
    const lifecycle = deriveLifecycleStatus(order);

    return {
      ...order,
      retailer_display: getRetailerName(order),
      postcode_display: getPostcode(order),
      expected_delivery_display: getExpectedDate(order),
      delivered_date_display: getDeliveredDate(order),
      complete_date_display: getCompleteDate(order),
      product_completeness: completeness,
      lifecycle_status: lifecycle,
      finance_status_derived: deriveFinanceStatus(order)
    };
  }

  function dateRangeStart() {
    const value = byId("dateRange")?.value || "90";

    if (value === "all") return null;

    const days = Number(value);
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);

    return d;
  }

  async function loadOrders() {
    if (!selectedCustomerId) {
      rawOrders = [];
      filteredOrders = [];
      renderAll();
      return;
    }

    const { data, error } = await client
      .from("orders")
      .select(`
        *,
        order_documents (
          id,
          document_type,
          document_number,
          document_status,
          file_url,
          customer_visible,
          created_at,
          updated_at
        ),
        order_lines (
          id,
          order_id,
          quantity_ordered,
          product_id,
          sku_base,
          description,
          products (
            id,
            sku_base,
            name,
            description
          ),
          order_allocations (
            id,
            allocation_status
          )
        )
      `)
      .eq("company_id", companyId)
      .eq("customer_id", selectedCustomerId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    rawOrders = (data || []).map(enrichOrder);
    applyFilters();
    renderAll();
  }

  function applyFilters() {
    const q = normalize(byId("searchInput")?.value || "");
    const status = normalize(byId("statusFilter")?.value || "");
    const start = dateRangeStart();

    filteredOrders = rawOrders.filter(order => {
      if (status && order.lifecycle_status !== status) return false;

      if (start) {
        const created = new Date(order.created_at || order.order_date || order.requested_delivery_date || "");
        if (!Number.isNaN(created.getTime()) && created < start) return false;
      }

      if (q) {
        const haystack = [
          order.order_number,
          order.external_reference,
          order.purchase_order,
          order.retailer_display,
          order.delivery_postcode,
          order.delivery_city,
          order.status
        ].join(" ").toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }

  function isOpen(order) {
    return !["delivered", "invoiced", "closed"].includes(order.lifecycle_status);
  }

  function isDeliveredThisMonth(order) {
    const date = order.delivered_date_display || order.confirmed_delivery_date || order.updated_at;
    if (!date) return false;

    const d = new Date(date);
    const now = new Date();

    if (Number.isNaN(d.getTime())) return false;

    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() &&
      ["delivered", "invoiced", "closed"].includes(order.lifecycle_status);
  }

  function isAttention(order) {
    if (!isOpen(order)) return false;

    const c = order.product_completeness;
    if (c?.missing > 0) return true;

    const expected = getExpectedDate(order);
    if (!expected) return true;

    const d = new Date(expected);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!Number.isNaN(d.getTime()) && d < today) return true;

    return false;
  }

  function attentionReason(order) {
    const reasons = [];

    if (order.product_completeness?.missing > 0) {
      reasons.push("Missing products");
    }

    const expected = getExpectedDate(order);

    if (!expected) {
      reasons.push("No expected date");
    } else {
      const d = new Date(expected);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (!Number.isNaN(d.getTime()) && d < today && isOpen(order)) {
        reasons.push("Expected date passed");
      }
    }

    return reasons.join(", ") || "Attention required";
  }

  function statusLabel(status) {
    const map = {
      order_received: "Order received",
      awaiting_goods: "Awaiting goods",
      stock_complete: "Stock complete",
      picked: "Picked",
      on_transport: "On transport",
      delivered: "Delivered",
      invoiced: "Invoiced",
      closed: "Closed",
      issue: "Issue"
    };

    return map[normalize(status)] || cleanText(status).replaceAll("_", " ");
  }

  function statusPill(status) {
    const s = normalize(status);
    let cls = "gray";

    if (["order_received"].includes(s)) cls = "";
    if (["awaiting_goods"].includes(s)) cls = "orange";
    if (["stock_complete", "picked"].includes(s)) cls = "green";
    if (["on_transport"].includes(s)) cls = "";
    if (["delivered", "invoiced", "closed"].includes(s)) cls = "green";
    if (["issue"].includes(s)) cls = "red";

    return `<span class="pill ${cls}">${escapeHtml(statusLabel(s))}</span>`;
  }

  function renderKpis() {
    const orders = filteredOrders;
    const open = orders.filter(isOpen);
    const awaiting = orders.filter(o => o.lifecycle_status === "awaiting_goods");
    const complete = orders.filter(o => ["stock_complete", "picked"].includes(o.lifecycle_status));
    const missingQty = orders.reduce((sum, o) => sum + toNumber(o.product_completeness?.missing, 0), 0);
    const deliveredMonth = orders.filter(isDeliveredThisMonth);
    const attention = orders.filter(isAttention);

    const openWithDates = open.filter(o => !!getExpectedDate(o));
    const confirmedPct = open.length ? (openWithDates.length / open.length) * 100 : 0;

    const podAvailable = orders.filter(o => hasDocument(o, "pod")).length;
    const invoicesAvailable = orders.filter(o => hasDocument(o, "invoice")).length;
    const retailers = new Set(orders.map(o => normalize(o.retailer_display)).filter(Boolean));

    const completeLeadTimes = orders
      .map(o => dayDiff(o.complete_date_display, o.delivered_date_display))
      .filter(v => v !== null);

    const importLeadTimes = orders
      .map(o => dayDiff(o.created_at || o.order_date, o.delivered_date_display))
      .filter(v => v !== null);

    const avgComplete = completeLeadTimes.length
      ? completeLeadTimes.reduce((a, b) => a + b, 0) / completeLeadTimes.length
      : 0;

    const avgImport = importLeadTimes.length
      ? importLeadTimes.reduce((a, b) => a + b, 0) / importLeadTimes.length
      : 0;

    setText("kpiOpenOrders", formatNumber(open.length));
    setText("kpiAwaitingGoods", formatNumber(awaiting.length));
    setText("kpiStockComplete", formatNumber(complete.length));
    setText("kpiMissingProducts", formatNumber(missingQty));
    setText("kpiDeliveredMonth", formatNumber(deliveredMonth.length));
    setText("kpiAvgLeadComplete", formatDays(avgComplete));
    setText("kpiAvgLeadImport", formatDays(avgImport));
    setText("kpiConfirmedDates", formatPercent(confirmedPct));
    setText("kpiPodAvailable", formatNumber(podAvailable));
    setText("kpiInvoicesAvailable", formatNumber(invoicesAvailable));
    setText("kpiRetailers", formatNumber(retailers.size));
    setText("kpiAttention", formatNumber(attention.length));
  }

  function groupByMonth() {
    const months = new Map();

    filteredOrders.forEach(order => {
      const key = monthKey(order.created_at || order.order_date);

      if (!months.has(key)) {
        months.set(key, {
          imported: 0,
          complete: 0,
          delivered: 0,
          avgLead: []
        });
      }

      const row = months.get(key);
      row.imported++;

      if (["stock_complete", "picked", "on_transport", "delivered", "invoiced", "closed"].includes(order.lifecycle_status)) {
        row.complete++;
      }

      if (["delivered", "invoiced", "closed"].includes(order.lifecycle_status)) {
        row.delivered++;
      }

      const lead = dayDiff(order.created_at || order.order_date, order.delivered_date_display);

      if (lead !== null) {
        row.avgLead.push(lead);
      }
    });

    return [...months.entries()]
      .filter(([key]) => key !== "Unknown")
      .sort(([a], [b]) => a.localeCompare(b));
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      charts[id] = null;
    }
  }

  function makeChart(id, config) {
    const canvas = byId(id);
    if (!canvas || !window.Chart) return;

    destroyChart(id);
    charts[id] = new Chart(canvas, config);
  }

  function renderCharts() {
    const monthly = groupByMonth();
    const labels = monthly.map(([key]) => monthLabel(key));

    makeChart("orderFlowChart", {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Imported",
            data: monthly.map(([, row]) => row.imported),
            tension: 0.35
          },
          {
            label: "Stock complete",
            data: monthly.map(([, row]) => row.complete),
            tension: 0.35
          },
          {
            label: "Delivered",
            data: monthly.map(([, row]) => row.delivered),
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });

    makeChart("deliveryPerformanceChart", {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Delivered",
            data: monthly.map(([, row]) => row.delivered)
          },
          {
            label: "Avg days import → delivered",
            data: monthly.map(([, row]) => {
              if (!row.avgLead.length) return 0;
              return row.avgLead.reduce((a, b) => a + b, 0) / row.avgLead.length;
            }),
            type: "line",
            tension: 0.35,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } }
        }
      }
    });

    const complete = filteredOrders.filter(o => o.product_completeness?.status === "complete").length;
    const missing = filteredOrders.filter(o => o.product_completeness?.status === "missing").length;
    const none = filteredOrders.filter(o => o.product_completeness?.status === "none").length;

    makeChart("stockReadinessChart", {
      type: "doughnut",
      data: {
        labels: ["Complete", "Missing", "No lines"],
        datasets: [
          {
            data: [complete, missing, none]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" }
        }
      }
    });

    const packing = filteredOrders.filter(o => hasDocument(o, "packing_slip")).length;
    const pod = filteredOrders.filter(o => hasDocument(o, "pod")).length;
    const invoice = filteredOrders.filter(o => hasDocument(o, "invoice")).length;

    makeChart("documentAvailabilityChart", {
      type: "bar",
      data: {
        labels: ["Packing Slip", "POD", "Invoice"],
        datasets: [
          {
            label: "Available",
            data: [packing, pod, invoice]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  function renderStatusBreakdown() {
    const box = byId("statusBreakdownList");
    if (!box) return;

    const rows = [
      "order_received",
      "awaiting_goods",
      "stock_complete",
      "picked",
      "on_transport",
      "delivered",
      "invoiced",
      "closed"
    ].map(status => ({
      status,
      count: filteredOrders.filter(o => o.lifecycle_status === status).length
    })).filter(row => row.count > 0);

    const max = Math.max(...rows.map(r => r.count), 1);

    box.innerHTML = rows.length
      ? rows.map(row => `
          <div class="status-row">
            <div class="status-name">${escapeHtml(statusLabel(row.status))}</div>
            <div class="status-bar">
              <div class="status-fill" style="width:${Math.round((row.count / max) * 100)}%"></div>
            </div>
            <div class="status-count">${formatNumber(row.count)}</div>
          </div>
        `).join("")
      : `
        <div class="status-row">
          <div class="status-name">No data</div>
          <div class="status-bar"><div class="status-fill" style="width:0%"></div></div>
          <div class="status-count">0</div>
        </div>
      `;
  }

  function renderAttentionOrders() {
    const body = byId("attentionOrdersBody");
    if (!body) return;

    const rows = filteredOrders
      .filter(isAttention)
      .slice(0, 12);

    body.innerHTML = rows.length
      ? rows.map(order => `
          <tr>
            <td><strong>${escapeHtml(order.order_number || "—")}</strong></td>
            <td>${escapeHtml(order.retailer_display || "—")}</td>
            <td>${statusPill(order.lifecycle_status)}</td>
            <td>${formatNumber(order.product_completeness?.missing || 0)}</td>
            <td>${escapeHtml(formatDate(getExpectedDate(order)))}</td>
            <td>${escapeHtml(attentionReason(order))}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="6">No attention orders found.</td></tr>`;
  }

  function renderRecentOrders() {
    const body = byId("recentOrdersBody");
    if (!body) return;

    const rows = filteredOrders.slice(0, 25);

    body.innerHTML = rows.length
      ? rows.map(order => {
          const c = order.product_completeness || {};
          const docs = [
            hasDocument(order, "packing_slip") ? "Packing Slip" : "",
            hasDocument(order, "pod") ? "POD" : "",
            hasDocument(order, "invoice") ? "Invoice" : ""
          ].filter(Boolean);

          return `
            <tr>
              <td><strong>${escapeHtml(order.order_number || "—")}</strong></td>
              <td>${escapeHtml(order.purchase_order || order.external_reference || "—")}</td>
              <td>${escapeHtml(order.retailer_display || "—")}</td>
              <td>${escapeHtml(order.postcode_display || "—")}</td>
              <td>${statusPill(order.lifecycle_status)}</td>
              <td>${formatNumber(c.matched || 0)} / ${formatNumber(c.required || 0)}</td>
              <td>${escapeHtml(formatDate(order.requested_delivery_date))}</td>
              <td>${escapeHtml(formatDate(getExpectedDate(order)))}</td>
              <td>${docs.length ? escapeHtml(docs.join(", ")) : "—"}</td>
            </tr>
          `;
        }).join("")
      : `<tr><td colspan="9">No recent orders found.</td></tr>`;
  }

  function renderTopRetailers() {
    const body = byId("topRetailersBody");
    if (!body) return;

    const map = new Map();

    filteredOrders.forEach(order => {
      const key = `${normalize(order.retailer_display)}|${normalize(order.postcode_display)}`;

      if (!map.has(key)) {
        map.set(key, {
          retailer: order.retailer_display || "—",
          postcode: order.postcode_display || "—",
          open: 0,
          missing: 0,
          nextDates: []
        });
      }

      const row = map.get(key);

      if (isOpen(order)) row.open++;

      row.missing += toNumber(order.product_completeness?.missing, 0);

      const expected = getExpectedDate(order);
      if (expected && isOpen(order)) row.nextDates.push(expected);
    });

    const rows = [...map.values()]
      .filter(row => row.open > 0 || row.missing > 0)
      .sort((a, b) => b.open - a.open || b.missing - a.missing)
      .slice(0, 12);

    body.innerHTML = rows.length
      ? rows.map(row => {
          const nextDate = row.nextDates
            .map(d => new Date(d))
            .filter(d => !Number.isNaN(d.getTime()))
            .sort((a, b) => a - b)[0];

          return `
            <tr>
              <td><strong>${escapeHtml(row.retailer)}</strong></td>
              <td>${escapeHtml(row.postcode)}</td>
              <td>${formatNumber(row.open)}</td>
              <td>${formatNumber(row.missing)}</td>
              <td>${escapeHtml(nextDate ? formatDate(nextDate) : "—")}</td>
            </tr>
          `;
        }).join("")
      : `<tr><td colspan="5">No retailer activity found.</td></tr>`;
  }

  function renderDocumentQueue() {
    const body = byId("documentQueueBody");
    if (!body) return;

    const rows = filteredOrders
      .filter(order =>
        hasDocument(order, "packing_slip") ||
        hasDocument(order, "pod") ||
        hasDocument(order, "invoice") ||
        ["delivered", "invoiced", "closed"].includes(order.lifecycle_status)
      )
      .slice(0, 20);

    body.innerHTML = rows.length
      ? rows.map(order => `
          <tr>
            <td><strong>${escapeHtml(order.order_number || "—")}</strong></td>
            <td>${hasDocument(order, "packing_slip") ? `<span class="pill green">Available</span>` : `<span class="pill gray">Pending</span>`}</td>
            <td>${hasDocument(order, "pod") ? `<span class="pill green">Available</span>` : `<span class="pill gray">Pending</span>`}</td>
            <td>${hasDocument(order, "invoice") ? `<span class="pill green">Available</span>` : `<span class="pill gray">Pending</span>`}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="4">No document activity found.</td></tr>`;
  }

  function renderInsights() {
    const box = byId("insightList");
    if (!box) return;

    const open = filteredOrders.filter(isOpen);
    const missing = filteredOrders.filter(o => o.product_completeness?.missing > 0);
    const deliveredMonth = filteredOrders.filter(isDeliveredThisMonth);
    const attention = filteredOrders.filter(isAttention);
    const withExpected = open.filter(o => !!getExpectedDate(o));
    const expectedPct = open.length ? Math.round((withExpected.length / open.length) * 100) : 0;

    const insights = [
      {
        title: "Open order position",
        text: `${formatNumber(open.length)} visible order(s) are currently open for this customer.`
      },
      {
        title: "Stock readiness",
        text: `${formatNumber(missing.length)} order(s) currently have missing product quantities.`
      },
      {
        title: "Delivery visibility",
        text: `${formatPercent(expectedPct)} of open orders have an expected or confirmed delivery date.`
      },
      {
        title: "Monthly deliveries",
        text: `${formatNumber(deliveredMonth.length)} order(s) have been delivered in the current month.`
      },
      {
        title: "Attention queue",
        text: attention.length
          ? `${formatNumber(attention.length)} order(s) require customer-facing follow-up.`
          : "No customer-facing attention items are currently visible."
      }
    ];

    box.innerHTML = insights.map(item => `
      <div class="insight-item">
        <div class="insight-title">${escapeHtml(item.title)}</div>
        <div class="insight-text">${escapeHtml(item.text)}</div>
      </div>
    `).join("");
  }

  function renderAll() {
    renderKpis();
    renderCharts();
    renderStatusBreakdown();
    renderAttentionOrders();
    renderRecentOrders();
    renderTopRetailers();
    renderDocumentQueue();
    renderInsights();
  }

  function bindEvents() {
    byId("dateRange")?.addEventListener("change", () => {
      applyFilters();
      renderAll();
    });

    byId("statusFilter")?.addEventListener("change", () => {
      applyFilters();
      renderAll();
    });

    byId("searchInput")?.addEventListener("input", () => {
      applyFilters();
      renderAll();
    });

    byId("refreshBtn")?.addEventListener("click", async () => {
      try {
        await loadOrders();
        showToast("Dashboard refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not refresh dashboard.", "err");
      }
    });

    byId("customerSelect")?.addEventListener("change", async event => {
      try {
        selectedCustomerId = event.target.value || null;

        if (!selectedCustomerId) return;

        const selectedOption = event.target.options[event.target.selectedIndex];
        setText("customerName", selectedOption?.textContent?.split("·")[0]?.trim() || "Customer");
        setText("customerMeta", "Customer selected by admin");

        const url = new URL(window.location.href);
        url.searchParams.set("customer_id", selectedCustomerId);
        window.history.replaceState({}, "", url.toString());

        await loadOrders();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not switch customer.", "err");
      }
    });
  }

  async function init() {
    try {
      if (typeof sb !== "function") {
        throw new Error("Supabase helper sb() is not available.");
      }

      client = sb();

      await loadProfile();

      if (!isTenantRole() && !isProductOwnerRole()) {
        throw new Error("This dashboard is only available for Veynor, Sofa2U or product owner accounts.");
      }

      await resolveCustomer();
      bindEvents();
      await loadOrders();

      showToast("Customer dashboard loaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not load customer dashboard.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();