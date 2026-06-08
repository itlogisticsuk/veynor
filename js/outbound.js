(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const CANCELLED_ALLOCATION_STATUS = "cancelled";

  let client = null;
  let companyId = null;

  let allOutboundItems = [];
  let filteredOutboundItems = [];
  let selectedOutboundId = null;

  let customers = [];
  let warehouses = [];
  let locations = [];

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

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";

    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }) + " " + d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function fileDateStamp() {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("");
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = `notice ${type}`;

    window.clearTimeout(window.__outboundToastTimer);
    window.__outboundToastTimer = window.setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6500);
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

  function shortSku(item) {
    return item.sku_base || item.products?.sku_base || String(item.sku_unique || "").split("-IN-")[0] || "—";
  }

  function mutationDisplay(item, fallbackIndex = 1) {
    const sku = shortSku(item);
    const raw = item.sku_unique || item.storage_mutation_id || "";

    const match = String(raw).match(/-(\d{1,6})$/);
    if (match) return `${sku}-${Number(match[1])}`;

    return `${sku}-${fallbackIndex || 1}`;
  }

  function getInboundDate(item) {
    return item.inbound_date || item.received_at || item.created_at || null;
  }

  function getOutboundDate(item) {
    return (
      item.shipped_at ||
      item.loaded_at ||
      item.picked_at ||
      item.updated_at ||
      item.created_at ||
      null
    );
  }

  function getOutboundType(item) {
    const status = normalize(item.status);

    if (item.outbound_type) return item.outbound_type;
    if (status === "manual_outbound" || status === "booked_out") return "manual";
    if (status === "shipped") return "shipped";
    if (status === "loaded") return "loaded";
    if (status === "picked") return "picklist";
    if (item.order_number || item.linked_order_id) return "picklist";

    return "manual";
  }

  function outboundTypePill(item) {
    const type = normalize(getOutboundType(item));

    if (type === "manual") return `<span class="soft-pill gray">Manual</span>`;
    if (type === "picklist") return `<span class="soft-pill blue">Picklist</span>`;
    if (type === "loaded") return `<span class="soft-pill orange">Loaded</span>`;
    if (type === "shipped") return `<span class="soft-pill green">Shipped</span>`;

    return `<span class="soft-pill purple">${escapeHtml(type || "Outbound")}</span>`;
  }

  function getWarehouseName(id) {
    if (!id) return "";
    return warehouses.find(w => String(w.id) === String(id))?.name || "";
  }

  function getLocationCode(id) {
    if (!id) return "";
    return locations.find(l => String(l.id) === String(id))?.code || "";
  }

  function getOwnerName(item) {
    return item.products?.customers?.name || "";
  }

  function getProductName(item) {
    return item.products?.name || "";
  }

  function getSkuBase(item) {
    return item.products?.sku_base || "";
  }

  async function loadCustomers() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("customers")
      .select("id, name")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) {
      console.warn("Customers skipped:", error.message);
      customers = [];
      renderCustomerFilter();
      return;
    }

    customers = data || [];
    renderCustomerFilter();
  }

  async function loadWarehouses() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("warehouses")
      .select("id, name")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) {
      console.warn("Warehouses skipped:", error.message);
      warehouses = [];
      return;
    }

    warehouses = data || [];
  }

  async function loadLocations() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("warehouse_locations")
      .select("id, code, warehouse_id")
      .eq("company_id", cid)
      .order("code", { ascending: true });

    if (error) {
      console.warn("Locations skipped:", error.message);
      locations = [];
      return;
    }

    locations = data || [];
  }

  function renderCustomerFilter() {
    const select = byId("outboundCustomer");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">All Product Owners</option>` +
      customers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");

    if (current && customers.some(c => String(c.id) === String(current))) {
      select.value = current;
    }
  }

  async function loadOutbound() {
    const db = ensureClient();
    const cid = await getCompanyId();

    await Promise.all([
      loadCustomers(),
      loadWarehouses(),
      loadLocations()
    ]);

    const { data, error } = await db
      .from("items")
      .select(`
        id,
        company_id,
        product_id,
        warehouse_id,
        location_id,
        storage_mutation_id,
        sku_unique,
        serial_number,
        batch_number,
        status,
        volume_m3,
        weight_kg,
        received_at,
        reserved_at,
        picked_at,
        loaded_at,
        shipped_at,
        created_at,
        updated_at,
        linked_order_id,
        shipment_id,
        inbound_reference,
        inbound_date,
        products (
          id,
          sku_base,
          name,
          description,
          volume_m3,
          weight_kg,
          customer_id,
          customers (
            id,
            name
          )
        )
      `)
      .eq("company_id", cid)
      .in("status", ["picked", "loaded", "shipped", "booked_out", "manual_outbound"])
      .order("created_at", { ascending: false });

    if (error) throw error;

    allOutboundItems = (data || []).map(row => {
      const productVolume = toNumber(row.products?.volume_m3, 0);
      const productWeight = toNumber(row.products?.weight_kg, 0);

      return {
        ...row,
        linked_order_id: row.linked_order_id || null,
        order_number: "",
        external_reference: "",
        purchase_order: "",
        shipment_id: row.shipment_id || null,
        shipment_number: "",
        sku_base: getSkuBase(row),
        product_name: getProductName(row),
        product_description: row.products?.description || "",
        customer_id: row.products?.customer_id || "",
        customer_name: getOwnerName(row),
        warehouse_name: getWarehouseName(row.warehouse_id),
        location_code: getLocationCode(row.location_id),
        inbound_reference: row.inbound_reference || row.batch_number || "",
        inbound_date: row.inbound_date || row.received_at || row.created_at || null,
        outbound_date: getOutboundDate(row),
        volume_m3: toNumber(row.volume_m3, productVolume),
        weight_kg: toNumber(row.weight_kg, productWeight)
      };
    });

    await applyOrderOverlay();

    selectedOutboundId = allOutboundItems[0]?.id || null;

    applyFilters(false);
  }

  async function applyOrderOverlay() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const itemIds = allOutboundItems.map(i => i.id).filter(Boolean);
    if (!itemIds.length) return;

    const { data, error } = await db
      .from("order_allocations")
      .select(`
        id,
        company_id,
        item_id,
        order_line_id,
        allocation_status,
        allocated_at,
        order_lines (
          id,
          order_id,
          orders (
            id,
            order_number,
            external_reference,
            purchase_order
          )
        )
      `)
      .eq("company_id", cid)
      .in("item_id", itemIds)
      .neq("allocation_status", CANCELLED_ALLOCATION_STATUS);

    if (error) {
      console.warn("Order overlay skipped:", error.message);
      return;
    }

    const allocationByItem = new Map();

    (data || []).forEach(row => {
      if (!row.item_id) return;

      const current = allocationByItem.get(String(row.item_id));
      const currentTime = new Date(current?.allocated_at || 0).getTime();
      const newTime = new Date(row.allocated_at || 0).getTime();

      if (!current || newTime >= currentTime) {
        allocationByItem.set(String(row.item_id), row);
      }
    });

    allOutboundItems = allOutboundItems.map(item => {
      const alloc = allocationByItem.get(String(item.id));

      if (!alloc) return item;

      const order = alloc.order_lines?.orders || {};
      const orderId = alloc.order_lines?.order_id || order.id || item.linked_order_id || "";
      const orderNo = order.order_number || order.external_reference || order.purchase_order || orderId || "";

      return {
        ...item,
        linked_order_id: orderId,
        order_number: orderNo,
        external_reference: order.external_reference || "",
        purchase_order: order.purchase_order || "",
        allocation_id: alloc.id,
        allocation_status: alloc.allocation_status || ""
      };
    });
  }

  function applyFilters(keepSelection = true) {
    const search = normalize(byId("outboundSearch")?.value || "");
    const customerId = byId("outboundCustomer")?.value || "";
    const outboundType = normalize(byId("outboundType")?.value || "");
    const fromDate = byId("outboundFromDate")?.value || "";
    const toDate = byId("outboundToDate")?.value || "";

    filteredOutboundItems = allOutboundItems.filter(item => {
      if (customerId && String(item.customer_id) !== String(customerId)) return false;

      if (outboundType && normalize(getOutboundType(item)) !== outboundType) return false;

      const outboundDate = getOutboundDate(item);
      const outboundTime = outboundDate ? new Date(outboundDate).getTime() : 0;

      if (fromDate) {
        const fromTime = new Date(`${fromDate}T00:00:00`).getTime();
        if (outboundTime < fromTime) return false;
      }

      if (toDate) {
        const toTime = new Date(`${toDate}T23:59:59`).getTime();
        if (outboundTime > toTime) return false;
      }

      if (search) {
        const haystack = [
          item.sku_unique,
          item.storage_mutation_id,
          item.inbound_reference,
          item.sku_base,
          item.product_name,
          item.product_description,
          item.customer_name,
          item.warehouse_name,
          item.location_code,
          item.order_number,
          item.external_reference,
          item.purchase_order,
          item.status,
          item.linked_order_id
        ].join(" ").toLowerCase();

        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    sortOutboundItems();

    if (!keepSelection || !filteredOutboundItems.some(row => String(row.id) === String(selectedOutboundId))) {
      selectedOutboundId = filteredOutboundItems[0]?.id || null;
    }

    setKpis();
    renderTable();
    renderDetail();
    renderSummary();
  }

  function sortOutboundItems() {
    const sort = byId("outboundSort")?.value || "outbound_desc";

    filteredOutboundItems.sort((a, b) => {
      const textSort = (x, y) => String(x || "").localeCompare(String(y || ""), "en-GB");
      const outboundA = new Date(getOutboundDate(a) || 0).getTime();
      const outboundB = new Date(getOutboundDate(b) || 0).getTime();

      if (sort === "outbound_asc") return outboundA - outboundB;
      if (sort === "sku_asc") return textSort(shortSku(a), shortSku(b));
      if (sort === "order_asc") return textSort(a.order_number, b.order_number);
      if (sort === "volume_desc") return toNumber(b.volume_m3, 0) - toNumber(a.volume_m3, 0);
      if (sort === "weight_desc") return toNumber(b.weight_kg, 0) - toNumber(a.weight_kg, 0);

      return outboundB - outboundA;
    });

    filteredOutboundItems = filteredOutboundItems.map((item, index) => ({
      ...item,
      display_sku: shortSku(item),
      display_mutation: mutationDisplay(item, index + 1)
    }));
  }

  function setKpis() {
    const total = allOutboundItems.length;
    const manual = allOutboundItems.filter(i => normalize(getOutboundType(i)) === "manual").length;
    const picklist = allOutboundItems.filter(i => normalize(getOutboundType(i)) === "picklist").length;
    const volume = allOutboundItems.reduce((sum, i) => sum + toNumber(i.volume_m3, 0), 0);
    const weight = allOutboundItems.reduce((sum, i) => sum + toNumber(i.weight_kg, 0), 0);

    setText("kpiOutboundTotal", formatNumber(total));
    setText("kpiOutboundManual", formatNumber(manual));
    setText("kpiOutboundPicklist", formatNumber(picklist));
    setText("kpiOutboundVolume", formatNumber(volume, 3));
    setText("kpiOutboundWeight", formatNumber(weight, 1));
  }

  function renderSummary() {
    const orders = new Set(
      filteredOutboundItems
        .map(i => i.order_number || i.linked_order_id || "")
        .filter(Boolean)
    ).size;

    const volume = filteredOutboundItems.reduce((sum, i) => sum + toNumber(i.volume_m3, 0), 0);
    const weight = filteredOutboundItems.reduce((sum, i) => sum + toNumber(i.weight_kg, 0), 0);

    setText("summaryOutboundRows", formatNumber(filteredOutboundItems.length));
    setText("summaryOutboundOrders", formatNumber(orders));
    setText("summaryOutboundVolume", formatNumber(volume, 3));
    setText("summaryOutboundWeight", formatNumber(weight, 1));

    setText("outboundResultsMeta", `Showing ${formatNumber(filteredOutboundItems.length)} outbound items`);
  }

  function renderTable() {
    const tbody = byId("outboundTableBody");
    if (!tbody) return;

    if (!filteredOutboundItems.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11">
            <div class="empty-state">No outbound history found for the selected filters.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filteredOutboundItems.map(item => {
      const active = String(item.id) === String(selectedOutboundId) ? "active" : "";

      return `
        <tr class="${active}" data-outbound-id="${escapeHtml(item.id)}">
          <td>
            <span class="sku-link">${escapeHtml(item.display_sku || shortSku(item))}</span>
          </td>

          <td>
            <span class="mut-id">${escapeHtml(item.display_mutation || mutationDisplay(item))}</span>
          </td>

          <td>
            <strong>${escapeHtml(item.product_name || "—")}</strong>
            <span class="subline">${escapeHtml(item.product_description || "")}</span>
          </td>

          <td>${escapeHtml(item.customer_name || "—")}</td>
          <td>${outboundTypePill(item)}</td>
          <td>${escapeHtml(item.order_number || item.external_reference || item.linked_order_id || "—")}</td>
          <td>${escapeHtml(item.inbound_reference || "—")}</td>
          <td>${formatNumber(item.volume_m3, 3)}</td>
          <td>${formatNumber(item.weight_kg, 1)}</td>
          <td>${escapeHtml(formatDateTime(getInboundDate(item)))}</td>
          <td>${escapeHtml(formatDateTime(getOutboundDate(item)))}</td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("tr[data-outbound-id]").forEach(row => {
      row.addEventListener("click", () => {
        selectedOutboundId = row.getAttribute("data-outbound-id");
        renderTable();
        renderDetail();
      });
    });
  }

  function getSelectedOutboundItem() {
    return filteredOutboundItems.find(item => String(item.id) === String(selectedOutboundId))
      || allOutboundItems.find(item => String(item.id) === String(selectedOutboundId))
      || null;
  }

  function renderDetail() {
    const container = byId("outboundDetail");
    if (!container) return;

    const item = getSelectedOutboundItem();

    if (!item) {
      container.innerHTML = `
        <div class="detail-empty">
          Select an outbound row to view item, order, inbound and outbound details.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div>
        <div class="detail-code">${escapeHtml(shortSku(item))}</div>
        <div class="subline">${escapeHtml(item.product_name || "—")} · ${escapeHtml(item.display_mutation || mutationDisplay(item))}</div>
      </div>

      <div class="detail-grid">
        <div class="detail-box">
          <div class="detail-label">Product Owner</div>
          <div class="detail-value">${escapeHtml(item.customer_name || "—")}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Outbound Type</div>
          <div class="detail-value">${outboundTypePill(item)}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Linked Order</div>
          <div class="detail-value">${escapeHtml(item.order_number || item.external_reference || item.linked_order_id || "—")}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Reference</div>
          <div class="detail-value">${escapeHtml(item.inbound_reference || "—")}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Inbound Date</div>
          <div class="detail-value">${escapeHtml(formatDateTime(getInboundDate(item)))}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Outbound Date</div>
          <div class="detail-value">${escapeHtml(formatDateTime(getOutboundDate(item)))}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Warehouse</div>
          <div class="detail-value">${escapeHtml(item.warehouse_name || "—")}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Location</div>
          <div class="detail-value">${escapeHtml(item.location_code || "—")}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Original SKU</div>
          <div class="detail-value">${escapeHtml(item.sku_unique || "—")}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Status</div>
          <div class="detail-value">${escapeHtml(item.status || "—")}</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Volume</div>
          <div class="detail-value">${formatNumber(item.volume_m3, 3)} m³</div>
        </div>

        <div class="detail-box">
          <div class="detail-label">Weight</div>
          <div class="detail-value">${formatNumber(item.weight_kg, 1)} kg</div>
        </div>
      </div>
    `;
  }

  function outboundExportRows(items) {
    return (items || []).map((item, index) => ({
      "Product Owner": item.customer_name || "",
      "SKU": shortSku(item),
      "Product": item.product_name || "",
      "Description": item.product_description || "",
      "Mutation": item.display_mutation || mutationDisplay(item, index + 1),
      "Original Unique SKU": item.sku_unique || "",
      "Outbound Type": getOutboundType(item),
      "Status": item.status || "",
      "Linked Order": item.order_number || item.external_reference || item.linked_order_id || "",
      "Reference": item.inbound_reference || "",
      "Warehouse": item.warehouse_name || "",
      "Location": item.location_code || "",
      "Volume m3": toNumber(item.volume_m3, 0),
      "Weight kg": toNumber(item.weight_kg, 0),
      "Inbound Date": formatDateTime(getInboundDate(item)),
      "Outbound Date": formatDateTime(getOutboundDate(item))
    }));
  }

  function selectedExportFormat() {
    return document.querySelector('input[name="outboundExportFormat"]:checked')?.value || "xlsx";
  }

  function selectedExportScope() {
    return document.querySelector('input[name="outboundExportScope"]:checked')?.value || "filtered";
  }

  function exportFileName(ext) {
    return `veynor-outbound-history-${fileDateStamp()}.${ext}`;
  }

  function getRowsForExport() {
    const scope = selectedExportScope();
    return scope === "all" ? allOutboundItems : filteredOutboundItems;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();

    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportCsv(rows) {
    const data = outboundExportRows(rows);

    if (!data.length) {
      showToast("No outbound rows available for export.", "err");
      return;
    }

    const headers = Object.keys(data[0]);

    const csvRows = [
      headers.join(";"),
      ...data.map(row => headers.map(header => {
        const value = String(row[header] ?? "");
        return `"${value.replace(/"/g, '""')}"`;
      }).join(";"))
    ];

    const blob = new Blob(["\ufeff" + csvRows.join("\n")], {
      type: "text/csv;charset=utf-8;"
    });

    downloadBlob(blob, exportFileName("csv"));
  }

  function exportExcel(rows) {
    const data = outboundExportRows(rows);

    if (!data.length) {
      showToast("No outbound rows available for export.", "err");
      return;
    }

    if (!window.XLSX) {
      showToast("XLSX library is not loaded.", "err");
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    ws["!cols"] = Object.keys(data[0]).map(key => ({
      wch: Math.min(Math.max(key.length + 4, 14), 34)
    }));

    XLSX.utils.book_append_sheet(wb, ws, "Outbound History");
    XLSX.writeFile(wb, exportFileName("xlsx"));
  }

  function exportPdf(rows) {
    const data = outboundExportRows(rows);

    if (!data.length) {
      showToast("No outbound rows available for export.", "err");
      return;
    }

    if (!window.jspdf?.jsPDF) {
      showToast("jsPDF library is not loaded.", "err");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4"
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Veynor Outbound History Export", 14, 15);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Exported: ${new Date().toLocaleString("en-GB")}`, 14, 21);
    doc.text(`Rows: ${data.length}`, 14, 26);

    const columns = [
      "Product Owner",
      "SKU",
      "Product",
      "Mutation",
      "Outbound Type",
      "Linked Order",
      "Reference",
      "Volume m3",
      "Weight kg",
      "Inbound Date",
      "Outbound Date"
    ];

    const body = data.map(row => columns.map(col => row[col] ?? ""));

    doc.autoTable({
      head: [columns],
      body,
      startY: 32,
      styles: {
        fontSize: 7,
        cellPadding: 1.6,
        overflow: "linebreak"
      },
      headStyles: {
        fillColor: [18, 103, 255],
        textColor: 255,
        fontStyle: "bold"
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      margin: {
        left: 8,
        right: 8
      }
    });

    doc.save(exportFileName("pdf"));
  }

  function confirmOutboundExport() {
    const rows = getRowsForExport();

    if (!rows.length) {
      showToast("No outbound rows available for this export selection.", "err");
      return;
    }

    const format = selectedExportFormat();

    if (format === "csv") exportCsv(rows);
    else if (format === "pdf") exportPdf(rows);
    else exportExcel(rows);

    closeOutboundExportModal();
    showToast(`${formatNumber(rows.length)} outbound row(s) exported.`, "ok");
  }

  function openOutboundExportModal() {
    const modal = byId("outboundExportModal");
    if (!modal) return;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeOutboundExportModal() {
    const modal = byId("outboundExportModal");
    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function bindExportEvents() {
    byId("btnOpenOutboundExport")?.addEventListener("click", openOutboundExportModal);
    byId("btnCloseOutboundExport")?.addEventListener("click", closeOutboundExportModal);
    byId("btnCancelOutboundExport")?.addEventListener("click", closeOutboundExportModal);
    byId("btnConfirmOutboundExport")?.addEventListener("click", confirmOutboundExport);

    byId("outboundExportModal")?.addEventListener("click", event => {
      if (event.target?.id === "outboundExportModal") closeOutboundExportModal();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeOutboundExportModal();
    });
  }

  function bindEvents() {
    [
      "outboundSearch",
      "outboundCustomer",
      "outboundType",
      "outboundFromDate",
      "outboundToDate",
      "outboundSort"
    ].forEach(id => {
      byId(id)?.addEventListener("input", () => applyFilters(true));
      byId(id)?.addEventListener("change", () => applyFilters(true));
    });

    byId("btnRefreshOutbound")?.addEventListener("click", async () => {
      try {
        await loadOutbound();
        showToast("Outbound history refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Refresh failed.", "err");
      }
    });

    byId("btnClearOutboundFilters")?.addEventListener("click", () => {
      [
        "outboundSearch",
        "outboundCustomer",
        "outboundType",
        "outboundFromDate",
        "outboundToDate",
        "outboundSort"
      ].forEach(id => {
        const el = byId(id);
        if (!el) return;
        el.value = id === "outboundSort" ? "outbound_desc" : "";
      });

      applyFilters(false);
    });

    bindExportEvents();
  }

  async function init() {
    try {
      ensureClient();
      bindEvents();
      await loadOutbound();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Outbound History failed to load.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();