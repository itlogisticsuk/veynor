(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const VAT_RATE = 0.20;

  let client = null;
  let companyId = null;

  let customers = [];
  let invoiceRows = [];
  let documentRows = [];
  let ordersById = new Map();

  let allInvoices = [];
  let filteredInvoices = [];
  let expandedInvoiceKeys = new Set();

  const sortState = {
    key: "date",
    direction: "desc"
  };

  function byId(id) {
    return document.getElementById(id);
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

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
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

  function dateKey(value) {
    if (!value) return "";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";

    return d.toISOString().slice(0, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = "notice " + type;

    window.clearTimeout(window.__billingToastTimer);
    window.__billingToastTimer = window.setTimeout(() => {
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

  function getProductOwnerNameById(customerId) {
    if (!customerId) return "—";
    return customers.find(c => String(c.id) === String(customerId))?.name || "—";
  }

  function getProductOwnerName(order, fallbackCustomerId = "") {
    return (
      order?.customers?.name ||
      getProductOwnerNameById(fallbackCustomerId || order?.customer_id) ||
      "—"
    );
  }

  function getRetailerName(order) {
    return (
      order?.retail_name ||
      order?.customer_name ||
      "—"
    );
  }

  function getOrderNumber(order) {
    return order?.order_number || order?.external_reference || "—";
  }

  function getAddressText(order) {
    return [
      order?.delivery_address_1,
      order?.delivery_address_2,
      order?.delivery_city,
      order?.delivery_region,
      order?.delivery_postcode,
      order?.delivery_country
    ].filter(Boolean).join(", ") || "—";
  }

  function normalizeStatus(value) {
    const v = normalize(value || "generated");

    if (v === "invoice_generated") return "generated";
    if (v === "invoice_sent") return "sent";
    if (v === "not_invoiced") return "generated";
    if (v === "part_paid") return "partially_paid";

    return v || "generated";
  }

  function statusLabel(value) {
    const v = normalizeStatus(value || "generated");

    const map = {
      generated: "Generated",
      sent: "Sent",
      paid: "Paid",
      partially_paid: "Partially paid",
      overdue: "Overdue"
    };

    return map[v] || String(value || "Generated").replaceAll("_", " ");
  }

  function statusClass(value) {
    const v = normalizeStatus(value);

    if (v === "paid") return "status-pill status-paid";
    if (v === "sent") return "status-pill status-sent";
    if (v === "overdue") return "status-pill status-overdue";
    if (v === "partially_paid") return "status-pill status-partially_paid";
    if (v === "generated") return "status-pill status-generated";

    return "status-pill status-missing";
  }

  function pill(value) {
    return `<span class="${statusClass(value)}">${escapeHtml(statusLabel(value))}</span>`;
  }

  function emptyTotals() {
    return {
      pick: 0,
      warehouse: 0,
      admin: 0,
      transport: 0,
      net: 0,
      vat: 0,
      gross: 0,
      colli: 0,
      volume: 0
    };
  }

  function addTotals(a, b) {
    return {
      pick: round2(a.pick + b.pick),
      warehouse: round2(a.warehouse + b.warehouse),
      admin: round2(a.admin + b.admin),
      transport: round2(a.transport + b.transport),
      net: round2(a.net + b.net),
      vat: round2(a.vat + b.vat),
      gross: round2(a.gross + b.gross),
      colli: round2(a.colli + b.colli),
      volume: round2(a.volume + b.volume)
    };
  }

  function calculateOrderRevenue(order) {
    const pick = round2(toNumber(order?.total_handling_tariff, 0));
    const warehouse = round2(toNumber(order?.total_storage_tariff, 0));
    const admin = round2(toNumber(order?.total_admin_tariff, 0));
    const transport = round2(toNumber(order?.total_transport_tariff, 0));

    const calculatedNet = round2(pick + warehouse + admin + transport);
    const explicitNet = round2(toNumber(order?.total_customer_charge, 0));
    const net = explicitNet > 0 ? explicitNet : calculatedNet;

    const vat = round2(net * VAT_RATE);
    const gross = round2(net + vat);

    return {
      pick,
      warehouse,
      admin,
      transport,
      net,
      vat,
      gross,
      colli: toNumber(order?.total_order_colli, 0) || toNumber(order?.planning_colli, 0),
      volume: toNumber(order?.total_order_volume_m3, 0) || toNumber(order?.planning_volume_m3, 0)
    };
  }

  function isProductOwner(customer) {
    return normalize(customer?.customer_type) === "product_owner";
  }

  async function loadCustomers() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("customers")
      .select("id, name, customer_code, customer_type, vat_number, billing_email")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) {
      console.warn("Customer filter skipped:", error.message);
      customers = [];
      renderCustomerFilter();
      return;
    }

    customers = (data || []).filter(isProductOwner);
    renderCustomerFilter();
  }

  function renderCustomerFilter() {
    const select = byId("filterCustomer");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">All product owners</option>` +
      customers.map(c => {
        const label = c.customer_code ? `${c.name} (${c.customer_code})` : c.name;
        return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
      }).join("");

    if (current && customers.some(c => String(c.id) === String(current))) {
      select.value = current;
    }
  }

  async function loadInvoicesRows() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("invoices")
      .select(`
        id,
        company_id,
        customer_id,
        invoice_number,
        invoice_date,
        due_date,
        total_amount,
        vat_amount,
        status,
        pdf_url,
        created_at,
        file_url,
        storage_path,
        subtotal
      `)
      .eq("company_id", cid)
      .order("created_at", { ascending: false });

    if (error) throw error;

    invoiceRows = data || [];
  }

  async function loadInvoiceDocuments() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("order_documents")
      .select(`
        id,
        company_id,
        customer_id,
        order_id,
        document_type,
        document_number,
        document_status,
        file_url,
        storage_path,
        sent_to_email,
        sent_at,
        customer_visible,
        created_at,
        updated_at
      `)
      .eq("company_id", cid)
      .eq("document_type", "invoice")
      .order("created_at", { ascending: false });

    if (error) throw error;

    documentRows = data || [];
  }

  async function loadOrdersForDocuments() {
    const orderIds = [...new Set(
      documentRows
        .map(doc => doc.order_id)
        .filter(Boolean)
    )];

    ordersById = new Map();

    if (!orderIds.length) return;

    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("orders")
      .select(`
        id,
        company_id,
        customer_id,
        order_number,
        external_reference,
        source_type,
        order_date,
        requested_delivery_date,
        status,
        delivery_city,
        delivery_postcode,
        notes,
        imported_at,
        created_at,
        delivery_country,
        delivery_region,
        delivery_lat,
        delivery_lng,
        transport_type,
        charter_name,
        planning_colli,
        planning_volume_m3,
        import_mode,
        planning_only,
        route_id,
        planning_release,
        released_to_planning_at,
        released_to_planning_by,
        requires_low_emission,
        volume_m3,
        weight_kg,
        requires_ulez,
        requires_small_vehicle,
        city_tonnage_limit,
        service_minutes,
        delivery_address_1,
        delivery_address_2,
        purchase_order,
        retail_name,
        warehouse_status,
        transport_status,
        finance_status,
        overall_status,
        last_activity_at,
        confirmed_delivery_date,
        total_order_colli,
        total_order_volume_m3,
        total_order_weight_kg,
        matched_colli,
        matched_volume_m3,
        matched_weight_kg,
        total_storage_tariff,
        total_admin_tariff,
        total_handling_tariff,
        total_transport_tariff,
        total_s2u_fees,
        total_customer_charge,
        memo,
        customers (
          id,
          name,
          customer_code,
          customer_type,
          vat_number,
          billing_email
        )
      `)
      .eq("company_id", cid)
      .in("id", orderIds);

    if (error) throw error;

    ordersById = new Map((data || []).map(order => [String(order.id), order]));
  }

  function invoiceDocumentMatchesInvoice(doc, invoice) {
    const docNo = normalize(doc.document_number || "");
    const invNo = normalize(invoice.invoice_number || "");

    if (docNo && invNo && docNo === invNo) return true;

    const docFile = normalize(doc.file_url || doc.storage_path || "");
    const invFile = normalize(invoice.file_url || invoice.pdf_url || invoice.storage_path || "");

    if (docFile && invFile && docFile === invFile) return true;

    return false;
  }

  function buildInvoicesFromInvoiceRows() {
    const groups = [];

    invoiceRows.forEach(inv => {
      const key = String(inv.invoice_number || inv.id);

      const docs = documentRows.filter(doc => invoiceDocumentMatchesInvoice(doc, inv));

      const orders = docs
        .map(doc => ordersById.get(String(doc.order_id)))
        .filter(Boolean)
        .filter((order, index, arr) => arr.findIndex(o => String(o.id) === String(order.id)) === index);

      let totals = emptyTotals();

      orders.forEach(order => {
        totals = addTotals(totals, calculateOrderRevenue(order));
      });

      const subtotal = toNumber(inv.subtotal, 0);
      const vatAmount = toNumber(inv.vat_amount, 0);
      const totalAmount = toNumber(inv.total_amount, 0);

      if (totals.net <= 0 && subtotal > 0) {
        totals.net = round2(subtotal);
        totals.vat = round2(vatAmount || subtotal * VAT_RATE);
        totals.gross = round2(totalAmount || totals.net + totals.vat);
      }

      if (totals.net > 0 && totals.vat <= 0) {
        totals.vat = round2(totals.net * VAT_RATE);
        totals.gross = round2(totals.net + totals.vat);
      }

      if (totals.gross <= 0 && totalAmount > 0) {
        totals.gross = round2(totalAmount);
      }

      const firstOrder = orders[0] || null;
      const customerId = inv.customer_id || firstOrder?.customer_id || docs[0]?.customer_id || "";

      groups.push({
        key,
        source: "invoices",
        invoice_id: inv.id,
        invoice_number: inv.invoice_number || "Invoice",
        invoice_date: inv.invoice_date || inv.created_at,
        due_date: inv.due_date || "",
        status: normalizeStatus(inv.status || docs[0]?.document_status || "generated"),
        file_url: inv.file_url || inv.pdf_url || docs[0]?.file_url || "",
        pdf_url: inv.pdf_url || inv.file_url || docs[0]?.file_url || "",
        storage_path: inv.storage_path || docs[0]?.storage_path || "",
        created_at: inv.created_at,
        customer_id: customerId,
        customer_name: firstOrder
          ? getProductOwnerName(firstOrder, customerId)
          : getProductOwnerNameById(customerId),
        invoices: [inv],
        docs,
        orders,
        order_count: orders.length,
        totals
      });
    });

    return groups;
  }

  function buildInvoicesFromUnmatchedDocuments(existingKeys) {
    const groups = [];

    documentRows.forEach(doc => {
      const matchedInvoice = invoiceRows.some(inv => invoiceDocumentMatchesInvoice(doc, inv));
      if (matchedInvoice) return;

      const invoiceNo = doc.document_number || doc.storage_path || doc.id;
      const key = String(invoiceNo);

      if (existingKeys.has(key)) return;

      const order = ordersById.get(String(doc.order_id));
      const orders = order ? [order] : [];

      let totals = emptyTotals();

      orders.forEach(row => {
        totals = addTotals(totals, calculateOrderRevenue(row));
      });

      const customerId = doc.customer_id || order?.customer_id || "";

      groups.push({
        key,
        source: "order_documents",
        invoice_id: "",
        invoice_number: invoiceNo,
        invoice_date: doc.created_at,
        due_date: "",
        status: normalizeStatus(doc.document_status || order?.finance_status || "generated"),
        file_url: doc.file_url || "",
        pdf_url: doc.file_url || "",
        storage_path: doc.storage_path || "",
        created_at: doc.created_at,
        customer_id: customerId,
        customer_name: order
          ? getProductOwnerName(order, customerId)
          : getProductOwnerNameById(customerId),
        invoices: [],
        docs: [doc],
        orders,
        order_count: orders.length,
        totals
      });
    });

    return groups;
  }

  function buildBillingRows() {
    const fromInvoices = buildInvoicesFromInvoiceRows();
    const existingKeys = new Set(fromInvoices.map(row => row.key));
    const fromDocs = buildInvoicesFromUnmatchedDocuments(existingKeys);

    allInvoices = [...fromInvoices, ...fromDocs];
  }

  async function loadBilling() {
    ensureClient();

    await getCompanyId();
    await loadCustomers();
    await Promise.all([
      loadInvoicesRows(),
      loadInvoiceDocuments()
    ]);

    await loadOrdersForDocuments();

    buildBillingRows();
    applyFilters(false);
    sortInvoices();
    renderAll();

    showToast("Billing refreshed.", "ok");
  }

  function getSearchText(invoice) {
    return [
      invoice.invoice_number,
      invoice.customer_name,
      invoice.file_url,
      invoice.pdf_url,
      invoice.storage_path,
      invoice.status,
      ...invoice.orders.map(order => [
        getOrderNumber(order),
        getProductOwnerName(order),
        getRetailerName(order),
        getAddressText(order),
        order.delivery_postcode,
        order.delivery_city
      ].join(" "))
    ].join(" ").toLowerCase();
  }

  function applyFilters(render = true) {
    const q = normalize(byId("filterSearch")?.value || "");
    const customerId = byId("filterCustomer")?.value || "";
    const status = normalizeStatus(byId("filterStatus")?.value || "");
    const from = byId("filterDateFrom")?.value || "";
    const to = byId("filterDateTo")?.value || "";

    filteredInvoices = allInvoices.filter(invoice => {
      if (customerId && String(invoice.customer_id) !== String(customerId)) return false;
      if (status && normalizeStatus(invoice.status) !== status) return false;

      const invDate = dateKey(invoice.invoice_date || invoice.created_at);

      if (from && invDate && invDate < from) return false;
      if (to && invDate && invDate > to) return false;

      if (q && !getSearchText(invoice).includes(q)) return false;

      return true;
    });

    sortInvoices();

    if (render) renderAll();
  }

  function getSortValue(invoice, key) {
    if (key === "invoice") return normalize(invoice.invoice_number);
    if (key === "customer") return normalize(invoice.customer_name);
    if (key === "orders") return invoice.order_count || 0;
    if (key === "date") return new Date(invoice.invoice_date || invoice.created_at || 0).getTime();
    if (key === "pick") return invoice.totals.pick;
    if (key === "warehouse") return invoice.totals.warehouse;
    if (key === "admin") return invoice.totals.admin;
    if (key === "transport") return invoice.totals.transport;
    if (key === "net") return invoice.totals.net;
    if (key === "gross") return invoice.totals.gross;
    if (key === "status") return normalize(invoice.status);

    return "";
  }

  function sortInvoices() {
    const dir = sortState.direction === "asc" ? 1 : -1;

    filteredInvoices.sort((a, b) => {
      const av = getSortValue(a, sortState.key);
      const bv = getSortValue(b, sortState.key);

      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }

      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  function renderSortIndicators() {
    document.querySelectorAll("[data-sort-indicator]").forEach(el => {
      const key = el.getAttribute("data-sort-indicator");

      el.textContent = key === sortState.key
        ? (sortState.direction === "asc" ? "▲" : "▼")
        : "";
    });
  }

  function visibleTotals() {
    return filteredInvoices.reduce((sum, invoice) => {
      return addTotals(sum, invoice.totals);
    }, emptyTotals());
  }

  function renderKpis() {
    const totals = visibleTotals();

    setText("kpiInvoices", formatNumber(filteredInvoices.length));
    setText("kpiPick", formatMoney(totals.pick));
    setText("kpiWarehouse", formatMoney(totals.warehouse));
    setText("kpiAdmin", formatMoney(totals.admin));
    setText("kpiTransport", formatMoney(totals.transport));
    setText("kpiTotalExVat", formatMoney(totals.net));
    setText("kpiTotalIncVat", formatMoney(totals.gross));

    setText("footPick", formatMoney(totals.pick));
    setText("footWarehouse", formatMoney(totals.warehouse));
    setText("footAdmin", formatMoney(totals.admin));
    setText("footTransport", formatMoney(totals.transport));
    setText("footNet", formatMoney(totals.net));
    setText("footVat", formatMoney(totals.vat));
    setText("footGross", formatMoney(totals.gross));

    setText("resultsMeta", `${formatNumber(filteredInvoices.length)} invoice(s) shown`);
  }

  function renderInvoiceDetail(invoice) {
    const totals = invoice.totals;

    const ordersHtml = invoice.orders.length
      ? invoice.orders.map(order => {
          const t = calculateOrderRevenue(order);

          return `
            <div class="order-line">
              <div>
                <div class="order-line-title">${escapeHtml(getOrderNumber(order))}</div>
                <div class="order-line-sub">
                  Product Owner: ${escapeHtml(getProductOwnerName(order, invoice.customer_id))}
                </div>
                <div class="order-line-sub">
                  Retailer / Ship To: ${escapeHtml(getRetailerName(order))}
                </div>
                <div class="order-line-sub">${escapeHtml(getAddressText(order))}</div>
              </div>

              <div class="money-cell">
                ${formatMoney(t.pick)}
                <span class="subline">Pick</span>
              </div>

              <div class="money-cell">
                ${formatMoney(t.warehouse)}
                <span class="subline">Warehouse</span>
              </div>

              <div class="money-cell">
                ${formatMoney(t.admin)}
                <span class="subline">Admin</span>
              </div>

              <div class="money-cell">
                ${formatMoney(t.transport)}
                <span class="subline">Transport</span>
              </div>

              <div class="total-cell">
                ${formatMoney(t.net)}
                <span class="subline">Excl. VAT</span>
              </div>
            </div>
          `;
        }).join("")
      : `<div class="order-line"><div>No linked orders found.</div></div>`;

    return `
      <tr class="invoice-detail-row ${expandedInvoiceKeys.has(invoice.key) ? "open" : ""}" data-detail-key="${escapeHtml(invoice.key)}">
        <td class="invoice-detail-cell" colspan="14">
          <div class="invoice-detail">
            <div class="detail-grid">
              <div class="detail-box">
                <div class="detail-label">Invoice</div>
                <div class="detail-value">${escapeHtml(invoice.invoice_number)}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Product Owner</div>
                <div class="detail-value">${escapeHtml(invoice.customer_name || "—")}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Orders</div>
                <div class="detail-value">${formatNumber(invoice.order_count)}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Colli</div>
                <div class="detail-value">${formatNumber(totals.colli)}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Volume</div>
                <div class="detail-value">${formatNumber(totals.volume, 2)} m³</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Due Date</div>
                <div class="detail-value">${escapeHtml(formatDate(invoice.due_date))}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Storage Path</div>
                <div class="detail-value">${escapeHtml(invoice.storage_path || "—")}</div>
              </div>
            </div>

            <div>
              <div class="detail-label" style="margin-bottom:8px;">Linked orders</div>
              <div class="orders-list">
                ${ordersHtml}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function renderTable() {
    const tbody = byId("billingBody");
    if (!tbody) return;

    if (!filteredInvoices.length) {
      tbody.innerHTML = `<tr><td colspan="14">No invoices found.</td></tr>`;
      renderSortIndicators();
      return;
    }

    tbody.innerHTML = filteredInvoices.map(invoice => {
      const t = invoice.totals;
      const isOpen = expandedInvoiceKeys.has(invoice.key);
      const downloadUrl = invoice.file_url || invoice.pdf_url || "";

      const downloadHtml = downloadUrl
        ? `<a class="mini-btn" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener">Download</a>`
        : `<span class="mini-btn" style="opacity:.55;cursor:not-allowed;">No PDF</span>`;

      return `
        <tr data-invoice-key="${escapeHtml(invoice.key)}">
          <td>
            <button class="mini-btn" type="button" data-action="toggle" data-invoice-key="${escapeHtml(invoice.key)}">
              ${isOpen ? "−" : "+"}
            </button>
          </td>

          <td>
            <div class="invoice-main">${escapeHtml(invoice.invoice_number || "—")}</div>
            <span class="subline">${escapeHtml(invoice.storage_path || "")}</span>
          </td>

          <td>
            <strong>${escapeHtml(invoice.customer_name || "—")}</strong>
            <span class="subline">Product owner</span>
            <span class="subline">${escapeHtml(invoice.customer_id || "")}</span>
          </td>

          <td>
            <strong>${formatNumber(invoice.order_count)}</strong>
            <span class="subline">${escapeHtml(invoice.orders.map(getOrderNumber).join(", "))}</span>
          </td>

          <td>
            ${escapeHtml(formatDate(invoice.invoice_date || invoice.created_at))}
            <span class="subline">Due: ${escapeHtml(formatDate(invoice.due_date))}</span>
          </td>

          <td class="money-cell">${formatMoney(t.pick)}</td>
          <td class="money-cell">${formatMoney(t.warehouse)}</td>
          <td class="money-cell">${formatMoney(t.admin)}</td>
          <td class="money-cell">${formatMoney(t.transport)}</td>
          <td class="total-cell">${formatMoney(t.net)}</td>
          <td class="money-cell">${formatMoney(t.vat)}</td>
          <td class="total-cell">${formatMoney(t.gross)}</td>

          <td>${pill(invoice.status)}</td>

          <td>
            <div class="mini-actions">
              ${downloadHtml}
              <button class="mini-btn" type="button" data-action="sent" data-invoice-key="${escapeHtml(invoice.key)}">Mark sent</button>
              <button class="mini-btn" type="button" data-action="paid" data-invoice-key="${escapeHtml(invoice.key)}">Mark paid</button>
            </div>
          </td>
        </tr>

        ${renderInvoiceDetail(invoice)}
      `;
    }).join("");

    tbody.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", async event => {
        event.stopPropagation();

        const action = button.getAttribute("data-action");
        const key = button.getAttribute("data-invoice-key");
        const invoice = allInvoices.find(row => String(row.key) === String(key));

        if (!invoice) return;

        try {
          if (action === "toggle") {
            toggleInvoice(key);
            return;
          }

          if (action === "sent") {
            await markInvoiceSent(invoice);
            return;
          }

          if (action === "paid") {
            await markInvoicePaid(invoice);
            return;
          }
        } catch (error) {
          console.error(error);
          showToast(error.message || "Billing action failed.", "err");
        }
      });
    });

    tbody.querySelectorAll("tr[data-invoice-key]").forEach(row => {
      row.addEventListener("click", () => {
        toggleInvoice(row.getAttribute("data-invoice-key"));
      });
    });

    renderSortIndicators();
  }

  function toggleInvoice(key) {
    if (expandedInvoiceKeys.has(key)) {
      expandedInvoiceKeys.delete(key);
    } else {
      expandedInvoiceKeys.add(key);
    }

    renderTable();
  }

  async function markInvoiceSent(invoice) {
    const db = ensureClient();
    const cid = await getCompanyId();

    const invoiceIds = invoice.invoices.map(row => row.id).filter(Boolean);
    const docIds = invoice.docs.map(row => row.id).filter(Boolean);
    const orderIds = invoice.orders.map(row => row.id).filter(Boolean);

    if (invoiceIds.length) {
      const { error } = await db
        .from("invoices")
        .update({ status: "sent" })
        .in("id", invoiceIds)
        .eq("company_id", cid);

      if (error) throw error;
    }

    if (docIds.length) {
      const { error } = await db
        .from("order_documents")
        .update({
          document_status: "sent",
          sent_at: nowIso(),
          updated_at: nowIso()
        })
        .in("id", docIds)
        .eq("company_id", cid);

      if (error) throw error;
    }

    if (orderIds.length) {
      const { error } = await db
        .from("orders")
        .update({
          finance_status: "invoice_sent",
          overall_status: "invoiced",
          last_activity_at: nowIso()
        })
        .in("id", orderIds)
        .eq("company_id", cid);

      if (error) throw error;
    }

    await loadBilling();
    showToast(`Invoice ${invoice.invoice_number} marked as sent.`, "ok");
  }

  async function markInvoicePaid(invoice) {
    const db = ensureClient();
    const cid = await getCompanyId();

    const invoiceIds = invoice.invoices.map(row => row.id).filter(Boolean);
    const orderIds = invoice.orders.map(row => row.id).filter(Boolean);

    if (invoiceIds.length) {
      const { error } = await db
        .from("invoices")
        .update({ status: "paid" })
        .in("id", invoiceIds)
        .eq("company_id", cid);

      if (error) throw error;
    }

    if (orderIds.length) {
      const { error } = await db
        .from("orders")
        .update({
          finance_status: "paid",
          overall_status: "closed",
          last_activity_at: nowIso()
        })
        .in("id", orderIds)
        .eq("company_id", cid);

      if (error) throw error;
    }

    await loadBilling();
    showToast(`Invoice ${invoice.invoice_number} marked as paid.`, "ok");
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function exportCsv() {
    if (!filteredInvoices.length) {
      showToast("No invoices to export.", "err");
      return;
    }

    const rows = [
      [
        "Invoice",
        "Product Owner",
        "Orders",
        "Invoice Date",
        "Due Date",
        "Status",
        "Pick",
        "Warehouse",
        "Admin",
        "Transport",
        "Total Excl VAT",
        "VAT",
        "Total Incl VAT",
        "PDF URL"
      ]
    ];

    filteredInvoices.forEach(invoice => {
      rows.push([
        invoice.invoice_number,
        invoice.customer_name,
        invoice.orders.map(getOrderNumber).join(" | "),
        dateKey(invoice.invoice_date || invoice.created_at),
        dateKey(invoice.due_date),
        statusLabel(invoice.status),
        invoice.totals.pick,
        invoice.totals.warehouse,
        invoice.totals.admin,
        invoice.totals.transport,
        invoice.totals.net,
        invoice.totals.vat,
        invoice.totals.gross,
        invoice.file_url || invoice.pdf_url || ""
      ]);
    });

    const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `billing-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function resetFilters() {
    [
      "filterSearch",
      "filterCustomer",
      "filterStatus",
      "filterDateFrom",
      "filterDateTo"
    ].forEach(id => {
      const el = byId(id);
      if (el) el.value = "";
    });

    applyFilters();
  }

  function bindEvents() {
    [
      "filterSearch",
      "filterCustomer",
      "filterStatus",
      "filterDateFrom",
      "filterDateTo"
    ].forEach(id => {
      const el = byId(id);
      if (!el) return;

      el.addEventListener("input", () => applyFilters());
      el.addEventListener("change", () => applyFilters());
    });

    document.querySelectorAll("[data-sort-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort-key");

        if (sortState.key === key) {
          sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
        } else {
          sortState.key = key;
          sortState.direction = "asc";
        }

        sortInvoices();
        renderAll();
      });
    });

    byId("btnRefreshBilling")?.addEventListener("click", async () => {
      try {
        await loadBilling();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not refresh billing.", "err");
      }
    });

    byId("btnResetFilters")?.addEventListener("click", resetFilters);
    byId("btnExportCsv")?.addEventListener("click", exportCsv);
  }

  function renderAll() {
    renderKpis();
    renderTable();
  }

  async function init() {
    try {
      ensureClient();
      bindEvents();
      await loadBilling();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Billing page failed to load.", "err");

      const tbody = byId("billingBody");
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="14">${escapeHtml(error.message || "Billing page failed to load.")}</td>
          </tr>
        `;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();