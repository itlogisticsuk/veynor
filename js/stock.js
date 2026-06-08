(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const STOCK_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
  const CANCELLED_ALLOCATION_STATUS = "cancelled";
  const OUTBOUND_STATUSES = ["picked", "loaded", "shipped", "closed"];

  let client = null;
  let companyId = null;
  let currentUser = null;
  let currentProfile = null;

  let allStockItems = [];
  let filteredStockItems = [];
  let groupedStock = [];

  let customers = [];
  let warehouses = [];
  let locations = [];

  let selectedStockId = null;
  const selectedItemIds = new Set();

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

    window.clearTimeout(window.__stockToastTimer);
    window.__stockToastTimer = window.setTimeout(() => {
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

  async function loadCurrentProfile() {
    const db = ensureClient();

    const { data: sessionData, error: sessionError } = await db.auth.getUser();
    if (sessionError) throw sessionError;

    currentUser = sessionData?.user || null;

    if (!currentUser?.id) {
      window.location.replace("/login.html");
      throw new Error("Not authenticated.");
    }

    let result = await db
      .from("user_profiles")
      .select("id, auth_user_id, role, is_active, company_id, customer_id, retailer_code")
      .eq("id", currentUser.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!result.data && !result.error) {
      result = await db
        .from("user_profiles")
        .select("id, auth_user_id, role, is_active, company_id, customer_id, retailer_code")
        .eq("auth_user_id", currentUser.id)
        .eq("is_active", true)
        .maybeSingle();
    }

    if (result.error) throw result.error;
    if (!result.data?.id) throw new Error("No active user profile found.");

    currentProfile = result.data;
    companyId = currentProfile.company_id || null;
    document.body.classList.add(`role-${normalize(currentProfile.role)}`);
  }

  function isTenantRole() {
    return ["veynor_admin", "tenant_admin", "tenant_user"].includes(normalize(currentProfile?.role));
  }

  function isProductOwnerRole() {
    return ["product_owner_admin", "product_owner_user"].includes(normalize(currentProfile?.role));
  }

  function isRetailerRole() {
    return normalize(currentProfile?.role) === "retailer_user";
  }

  function canManageStock() {
    return isTenantRole();
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    if (currentProfile?.company_id) {
      companyId = currentProfile.company_id;
      return companyId;
    }

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
    return item.sku_base || item.products?.sku_base || item.sku_unique?.split("-IN-")[0] || "—";
  }

  function mutationDisplay(item, fallbackIndex = 0) {
    const sku = shortSku(item);

    const candidates = [
      item.storage_mutation_id,
      item.sku_unique
    ].filter(Boolean);

    for (const value of candidates) {
      const match = String(value).match(/-(\d{1,6})$/);
      if (match) return `${sku}-${Number(match[1])}`;
    }

    return `${sku}-${fallbackIndex || 1}`;
  }

  function statusClass(status) {
    const safe = normalize(status || "in_stock").replace(/[^a-z0-9_]/g, "");

    if (safe === "reserved") return "status-ready_for_picking";
    if (safe === "picked") return "status-planned";
    if (safe === "loaded") return "status-loaded";
    if (safe === "shipped" || safe === "closed") return "status-closed";
    if (["missing", "damaged", "cancelled"].includes(safe)) return "status-cancelled";

    return "status-imported";
  }

  function statusLabel(status) {
    const safe = normalize(status || "in_stock");

    const map = {
      in_stock: "In Stock",
      reserved: "Reserved",
      picked: "Picked",
      loaded: "Loaded",
      shipped: "Shipped",
      closed: "Closed",
      missing: "Missing",
      damaged: "Damaged",
      cancelled: "Cancelled"
    };

    return map[safe] || String(status || "In Stock").replaceAll("_", " ");
  }

  function statusPill(status) {
    return `<span class="status-pill ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>`;
  }

  function isOutboundStatus(itemOrStatus) {
    const status = typeof itemOrStatus === "string"
      ? normalize(itemOrStatus)
      : normalize(itemOrStatus?.status);

    return OUTBOUND_STATUSES.includes(status);
  }

  function allocationPill(item) {
    const status = normalize(item.status);

    if (status === "loaded" || item.shipment_id) {
      return `<span class="soft-pill green">On Shipment</span>`;
    }

    if (status === "picked") {
      return `<span class="soft-pill orange">Picked / Outbound</span>`;
    }

    if (status === "reserved" || item.linked_order_id) {
      return `<span class="soft-pill orange">Linked to Order</span>`;
    }

    if (["damaged", "missing", "cancelled"].includes(status)) {
      return `<span class="soft-pill gray">Blocked</span>`;
    }

    return `<span class="soft-pill green">Available</span>`;
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

  function getInboundDate(item) {
    return item.inbound_date || item.created_at || null;
  }

  function isAvailable(item) {
    return normalize(item.status) === "in_stock";
  }

  function isReserved(item) {
    return normalize(item.status) === "reserved" || !!item.linked_order_id;
  }

  function isBlocked(item) {
    return ["missing", "damaged", "cancelled"].includes(normalize(item.status));
  }

  function linkedOrderDisplay(item) {
    if (!item.order_number && !item.linked_order_id) return "—";

    const orderNo = item.order_number || item.linked_order_id || "Order";
    const retailer = item.retailer_name || "";
    const po = item.purchase_order || "";

    return `
      <span class="stock-link">${escapeHtml(orderNo)}</span>
      ${retailer ? `<span class="subline">${escapeHtml(retailer)}</span>` : ""}
      ${po ? `<span class="subline">PO: ${escapeHtml(po)}</span>` : ""}
    `;
  }

  async function loadCustomers() {
    const db = ensureClient();
    const cid = await getCompanyId();

    let query = db
      .from("customers")
      .select("id, name, customer_type")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (isProductOwnerRole() && currentProfile?.customer_id) {
      query = query.eq("id", currentProfile.customer_id);
    }

    const { data, error } = await query;

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
    const select = byId("stockCustomer");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">All Product Owners</option>` +
      customers.map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
      ).join("");

    if (isProductOwnerRole() && currentProfile?.customer_id) {
      select.value = currentProfile.customer_id;
      select.disabled = true;
      return;
    }

    if (current && customers.some(c => String(c.id) === String(current))) {
      select.value = current;
    }
  }

  async function loadStock() {
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
        inbound_reference,
        inbound_date,
        status,
        reserved_at,
        picked_at,
        loaded_at,
        shipped_at,
        created_at,
        volume_m3,
        weight_kg,
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
      .order("created_at", { ascending: false });

    if (error) throw error;

    allStockItems = (data || [])
      .filter(row => !isOutboundStatus(row))
      .map(row => {
        const productVolume = toNumber(row.products?.volume_m3, 0);
        const productWeight = toNumber(row.products?.weight_kg, 0);

        return {
          ...row,
          linked_order_id: null,
          order_number: "",
          retailer_name: "",
          purchase_order: "",
          shipment_id: null,
          shipment_number: "",
          sku_base: getSkuBase(row),
          product_name: getProductName(row),
          product_description: row.products?.description || "",
          customer_id: row.products?.customer_id || "",
          customer_name: getOwnerName(row),
          warehouse_name: getWarehouseName(row.warehouse_id),
          location_code: getLocationCode(row.location_id),
          inbound_reference: row.inbound_reference || "",
          inbound_date: row.inbound_date || row.created_at || null,
          volume_m3: toNumber(row.volume_m3, productVolume),
          weight_kg: toNumber(row.weight_kg, productWeight)
        };
      });

    if (isProductOwnerRole() && currentProfile?.customer_id) {
      allStockItems = allStockItems.filter(item => String(item.customer_id) === String(currentProfile.customer_id));
    }

    await applyAllocationOverlay();

    selectedItemIds.clear();

    setKpis();
    applyFilters(false);
    renderExportProductOptions();
    applyRoleVisibility();
  }

  async function applyAllocationOverlay() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const itemIds = allStockItems.map(i => i.id).filter(Boolean);
    if (!itemIds.length) return;

    const { data: allocations, error } = await db
      .from("order_allocations")
      .select(`
        id,
        item_id,
        order_line_id,
        allocation_status,
        allocated_at
      `)
      .eq("company_id", cid)
      .in("item_id", itemIds)
      .neq("allocation_status", CANCELLED_ALLOCATION_STATUS);

    if (error) {
      console.warn("Allocation overlay skipped:", error.message);
      return;
    }

    const orderLineIds = [...new Set((allocations || []).map(a => a.order_line_id).filter(Boolean))];
    if (!orderLineIds.length) return;

    const { data: lines, error: lineError } = await db
      .from("order_lines")
      .select("id, order_id")
      .in("id", orderLineIds);

    if (lineError) {
      console.warn("Order line lookup skipped:", lineError.message);
      return;
    }

    const orderIds = [...new Set((lines || []).map(l => l.order_id).filter(Boolean))];
    if (!orderIds.length) return;

    const { data: orders, error: orderError } = await db
      .from("orders")
      .select(`
        id,
        order_number,
        external_reference,
        purchase_order,
        retail_name,
        delivery_name,
        delivery_company,
        recipient_name
      `)
      .in("id", orderIds);

    if (orderError) {
      console.warn("Order lookup skipped:", orderError.message);
      return;
    }

    const lineById = new Map((lines || []).map(line => [String(line.id), line]));
    const orderById = new Map((orders || []).map(order => [String(order.id), order]));

    const allocationByItem = new Map();

    (allocations || []).forEach(alloc => {
      if (!alloc.item_id) return;

      const current = allocationByItem.get(String(alloc.item_id));

      if (!current) {
        allocationByItem.set(String(alloc.item_id), alloc);
        return;
      }

      const currentTime = new Date(current.allocated_at || 0).getTime();
      const newTime = new Date(alloc.allocated_at || 0).getTime();

      if (newTime > currentTime) {
        allocationByItem.set(String(alloc.item_id), alloc);
      }
    });

    allStockItems = allStockItems.map(item => {
      const alloc = allocationByItem.get(String(item.id));
      if (!alloc) return item;

      const line = lineById.get(String(alloc.order_line_id));
      const order = orderById.get(String(line?.order_id || ""));

      if (!line || !order) return item;

      const orderNo =
        order.order_number ||
        order.external_reference ||
        order.id ||
        "";

      const retailer =
        order.retail_name ||
        order.delivery_company ||
        order.delivery_name ||
        order.recipient_name ||
        "";

      return {
        ...item,
        linked_order_id: order.id,
        order_number: orderNo,
        retailer_name: retailer,
        purchase_order: order.purchase_order || "",
        allocation_id: alloc.id,
        allocation_status: alloc.allocation_status || "reserved",
        reserved_at: item.reserved_at || alloc.allocated_at || null,
        status: normalize(item.status) === "in_stock" ? "reserved" : item.status
      };
    });
  }

  function applyRoleVisibility() {
    const manager = canManageStock();

    [
      "btnSelectAllVisible",
      "btnSelectNone",
      "btnRemoveReservation",
      "btnMarkPicked",
      "btnMarkLoaded",
      "btnRunMatch"
    ].forEach(id => {
      const el = byId(id);
      if (el) el.style.display = manager ? "" : "none";
    });

    document.querySelectorAll(".tenant-only-stock").forEach(el => {
      el.style.display = manager ? "" : "none";
    });
  }

  function setKpis() {
    const total = allStockItems.length;
    const groups = groupItems(allStockItems).length;
    const available = allStockItems.filter(isAvailable).length;
    const reserved = allStockItems.filter(isReserved).length;
    const blocked = allStockItems.filter(isBlocked).length;

    setText("kpiSkuGroups", formatNumber(groups));
    setText("kpiStockTotal", formatNumber(total));
    setText("kpiStockAvailable", formatNumber(available));
    setText("kpiStockReserved", formatNumber(reserved));
    setText("kpiStockBlocked", formatNumber(blocked));

    setText("summaryAvailable", formatNumber(available));
    setText("summaryLinked", formatNumber(reserved));
    setText("summaryShipments", "0");
    setText("summaryBlocked", formatNumber(blocked));
  }

  function groupItems(items) {
    const map = new Map();

    items.forEach(item => {
      const key = item.product_id || item.sku_base || item.product_name || "unknown";

      if (!map.has(key)) {
        map.set(key, {
          key,
          product_id: item.product_id || "",
          sku_base: item.sku_base || "—",
          product_name: item.product_name || "Unknown product",
          product_description: item.product_description || "",
          customer_name: item.customer_name || "—",
          customer_id: item.customer_id || "",
          total: 0,
          available: 0,
          reserved: 0,
          blocked: 0,
          volume_m3: 0,
          weight_kg: 0,
          items: []
        });
      }

      const group = map.get(key);

      group.items.push(item);
      group.total += 1;
      group.volume_m3 += toNumber(item.volume_m3, 0);
      group.weight_kg += toNumber(item.weight_kg, 0);

      if (isAvailable(item)) group.available += 1;
      if (isReserved(item)) group.reserved += 1;
      if (isBlocked(item)) group.blocked += 1;
    });

    Array.from(map.values()).forEach(group => {
      group.items = group.items.map((item, index) => ({
        ...item,
        display_sku: shortSku(item),
        display_mutation: mutationDisplay(item, index + 1)
      }));
    });

    return Array.from(map.values());
  }

  function sortGroups(groups) {
    const sort = byId("stockSort")?.value || "sku_asc";
    const rows = [...groups];

    const textSort = (a, b) => String(a || "").localeCompare(String(b || ""), "en-GB");

    if (sort === "sku_asc") rows.sort((a, b) => textSort(a.sku_base, b.sku_base));
    else if (sort === "product_asc") rows.sort((a, b) => textSort(a.product_name, b.product_name));
    else if (sort === "total_desc") rows.sort((a, b) => b.total - a.total || textSort(a.sku_base, b.sku_base));
    else if (sort === "available_desc") rows.sort((a, b) => b.available - a.available || textSort(a.sku_base, b.sku_base));
    else if (sort === "reserved_desc") rows.sort((a, b) => b.reserved - a.reserved || textSort(a.sku_base, b.sku_base));

    rows.forEach(group => {
      group.items.sort((a, b) => {
        const ta = new Date(getInboundDate(a) || 0).getTime();
        const tb = new Date(getInboundDate(b) || 0).getTime();
        return tb - ta;
      });

      group.items = group.items.map((item, index) => ({
        ...item,
        display_sku: shortSku(item),
        display_mutation: mutationDisplay(item, index + 1)
      }));
    });

    return rows;
  }

  function applyFilters(keepSelection = true) {
    const search = normalize(byId("stockSearch")?.value || "");
    const customerId = byId("stockCustomer")?.value || "";
    const status = normalize(byId("stockStatus")?.value || "");
    const availability = byId("stockAvailability")?.value || "";

    filteredStockItems = allStockItems.filter(item => {
      if (customerId && String(item.customer_id) !== String(customerId)) return false;
      if (status && normalize(item.status) !== status) return false;

      if (availability === "available" && !isAvailable(item)) return false;
      if (availability === "allocated" && !["reserved"].includes(normalize(item.status))) return false;
      if (availability === "blocked" && !isBlocked(item)) return false;

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
          item.retailer_name,
          item.purchase_order,
          item.status,
          item.linked_order_id
        ].join(" ").toLowerCase();

        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    const visibleIds = new Set(filteredStockItems.map(i => String(i.id)));

    Array.from(selectedItemIds).forEach(id => {
      if (!visibleIds.has(String(id))) selectedItemIds.delete(id);
    });

    if (!keepSelection || !filteredStockItems.some(row => String(row.id) === String(selectedStockId))) {
      selectedStockId = filteredStockItems[0]?.id || null;
    }

    groupedStock = sortGroups(groupItems(filteredStockItems));

    renderGroups();
    renderDetail();
    renderSelectionSummary();
    renderExportProductOptions();
    applyRoleVisibility();
  }

  function makeGroupHtml(group, index) {
    return `
      <article class="stock-group" data-group-index="${index}">
        <button class="stock-group-head" type="button" aria-expanded="false">
          <div class="sg-sku">${escapeHtml(group.sku_base)}</div>
          <div class="sg-info">
            <b>${escapeHtml(group.product_name)}</b>
            <div class="sub">${escapeHtml(group.customer_name)}${group.product_description ? " · " + escapeHtml(group.product_description) : ""}</div>
            <div class="sg-meta">
              <span class="soft-pill">${formatNumber(group.total)} physical rows</span>
              <span class="soft-pill green">${formatNumber(group.available)} available</span>
              <span class="soft-pill orange">${formatNumber(group.reserved)} reserved</span>
              ${group.blocked ? `<span class="soft-pill gray">${formatNumber(group.blocked)} blocked</span>` : ""}
            </div>
          </div>
          <div class="sg-stat total"><div class="n">${formatNumber(group.total)}</div><div class="t">Total</div></div>
          <div class="sg-stat available"><div class="n">${formatNumber(group.available)}</div><div class="t">Available</div></div>
          <div class="sg-stat reserved"><div class="n">${formatNumber(group.reserved)}</div><div class="t">Reserved</div></div>
          <div class="sg-arrow">⌄</div>
        </button>

        <div class="stock-group-body">
          <div class="group-mini-grid">
            <div class="mini-kpi"><div class="label">Total rows</div><div class="value">${formatNumber(group.total)}</div></div>
            <div class="mini-kpi"><div class="label">Available</div><div class="value">${formatNumber(group.available)}</div></div>
            <div class="mini-kpi"><div class="label">Reserved / linked</div><div class="value">${formatNumber(group.reserved)}</div></div>
            <div class="mini-kpi"><div class="label">Total volume</div><div class="value">${formatNumber(group.volume_m3, 3)} m³</div></div>
          </div>

          ${
            canManageStock()
              ? `
                <div class="group-action-bar tenant-only-stock">
                  <label class="check-row">
                    <input class="row-check" type="checkbox" data-select-group="${escapeHtml(group.key)}"/>
                    Select all rows in this product group
                  </label>

                  <div class="bulk-actions">
                    <button class="btn" type="button" data-group-action="remove_reservation" data-group-key="${escapeHtml(group.key)}">Remove Reservation</button>
                    <button class="btn" type="button" data-group-action="picked" data-group-key="${escapeHtml(group.key)}">Mark Picked</button>
                    <button class="btn" type="button" data-group-action="loaded" data-group-key="${escapeHtml(group.key)}">Mark Loaded</button>
                  </div>
                </div>
              `
              : ""
          }

          <div class="table-wrap">
            <table class="stock-detail-table">
              <thead>
                <tr>
                  ${canManageStock() ? `<th class="tenant-only-stock">Select</th>` : ""}
                  <th>SKU</th>
                  <th>Mutation</th>
                  <th>Status</th>
                  <th>Allocation</th>
                  <th>Linked Order</th>
                  <th>Reference</th>
                  <th>Location</th>
                  <th>m³</th>
                  <th>kg</th>
                  <th>Inbound Date</th>
                  ${canManageStock() ? `<th class="tenant-only-stock">Actions</th>` : ""}
                </tr>
              </thead>
              <tbody>
                ${group.items.map(item => makeItemRowHtml(item)).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    `;
  }

  function makeItemRowHtml(item) {
    const active = String(item.id) === String(selectedStockId) ? "active" : "";
    const checked = selectedItemIds.has(String(item.id)) ? "checked" : "";

    return `
      <tr class="${active}" data-stock-id="${escapeHtml(item.id)}">
        ${canManageStock() ? `<td class="tenant-only-stock"><input class="row-check" type="checkbox" data-select-item="${escapeHtml(item.id)}" ${checked}/></td>` : ""}

        <td>
          <span class="stock-link">${escapeHtml(item.display_sku || shortSku(item))}</span>
          <span class="subline">${escapeHtml(item.product_name || "—")}</span>
        </td>

        <td>
          <span class="mut-id">${escapeHtml(item.display_mutation || mutationDisplay(item))}</span>
          <span class="subline">${escapeHtml(item.sku_unique || "—")}</span>
        </td>

        <td>${statusPill(item.status)}</td>
        <td>${allocationPill(item)}</td>
        <td>${linkedOrderDisplay(item)}</td>
        <td>${escapeHtml(item.inbound_reference || "—")}</td>
        <td>${escapeHtml(item.location_code || "—")}<span class="subline">${escapeHtml(item.warehouse_name || "—")}</span></td>
        <td>${formatNumber(item.volume_m3, 3)}</td>
        <td>${formatNumber(item.weight_kg, 1)}</td>
        <td>${escapeHtml(formatDateTime(getInboundDate(item)))}</td>

        ${
          canManageStock()
            ? `
              <td class="tenant-only-stock">
                <div class="bulk-actions">
                  <button class="mini-btn" type="button" data-row-action="remove_reservation" data-stock-id="${escapeHtml(item.id)}">Unreserve</button>
                  <button class="mini-btn" type="button" data-row-action="picked" data-stock-id="${escapeHtml(item.id)}">Picked</button>
                  <button class="mini-btn" type="button" data-row-action="loaded" data-stock-id="${escapeHtml(item.id)}">Loaded</button>
                </div>
              </td>
            `
            : ""
        }
      </tr>
    `;
  }

  function renderGroups() {
    const container = byId("stockGroupList");
    if (!container) return;

    if (!groupedStock.length) {
      container.innerHTML = `<div class="empty-state">No stock found for the selected filters.</div>`;
      return;
    }

    container.innerHTML = groupedStock.map((group, index) => makeGroupHtml(group, index)).join("");
    bindGroupEvents();
    syncSelectionUi();
    applyRoleVisibility();
  }

  function bindGroupEvents() {
    document.querySelectorAll(".stock-group-head").forEach(button => {
      button.addEventListener("click", () => {
        const group = button.closest(".stock-group");
        const open = group.classList.toggle("open");
        button.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    document.querySelectorAll("tr[data-stock-id]").forEach(row => {
      row.addEventListener("click", event => {
        if (event.target.closest("button") || event.target.closest("input")) return;
        selectedStockId = row.getAttribute("data-stock-id");
        renderGroups();
        renderDetail();
      });
    });

    if (!canManageStock()) return;

    document.querySelectorAll("[data-select-item]").forEach(input => {
      input.addEventListener("change", () => {
        const id = input.getAttribute("data-select-item");
        if (input.checked) selectedItemIds.add(String(id));
        else selectedItemIds.delete(String(id));
        syncSelectionUi();
      });
    });

    document.querySelectorAll("[data-select-group]").forEach(input => {
      input.addEventListener("change", () => {
        const key = input.getAttribute("data-select-group");
        const group = groupedStock.find(g => String(g.key) === String(key));
        if (!group) return;

        group.items.forEach(item => {
          if (input.checked) selectedItemIds.add(String(item.id));
          else selectedItemIds.delete(String(item.id));
        });

        syncSelectionUi();
      });
    });

    document.querySelectorAll("[data-row-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const action = button.getAttribute("data-row-action");
        const stockId = button.getAttribute("data-stock-id");

        try {
          await handleStockAction(action, stockId);
        } catch (error) {
          console.error(error);
          showToast(error.message || "Stock action failed.", "err");
        }
      });
    });

    document.querySelectorAll("[data-group-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const action = button.getAttribute("data-group-action");
        const key = button.getAttribute("data-group-key");
        const group = groupedStock.find(g => String(g.key) === String(key));
        if (!group) return;

        try {
          await bulkAction(action, group.items.map(i => i.id));
        } catch (error) {
          console.error(error);
          showToast(error.message || "Group action failed.", "err");
        }
      });
    });
  }

  function syncSelectionUi() {
    if (!canManageStock()) {
      selectedItemIds.clear();
      renderSelectionSummary();
      return;
    }

    document.querySelectorAll("[data-select-item]").forEach(input => {
      const id = input.getAttribute("data-select-item");
      input.checked = selectedItemIds.has(String(id));
    });

    document.querySelectorAll("[data-select-group]").forEach(input => {
      const key = input.getAttribute("data-select-group");
      const group = groupedStock.find(g => String(g.key) === String(key));

      if (!group || !group.items.length) {
        input.checked = false;
        return;
      }

      input.checked = group.items.every(item => selectedItemIds.has(String(item.id)));
    });

    renderSelectionSummary();
  }

  function renderSelectionSummary() {
    const selectedCount = selectedItemIds.size;
    const base = `Showing ${formatNumber(filteredStockItems.length)} stock items in ${formatNumber(groupedStock.length)} SKU groups`;

    setText("stockResultsMeta", selectedCount ? `${base} · Selected ${formatNumber(selectedCount)}` : base);
  }

  function getSelectedStockItem() {
    return filteredStockItems.find(item => String(item.id) === String(selectedStockId))
      || allStockItems.find(item => String(item.id) === String(selectedStockId))
      || null;
  }

  function movementHistory(item) {
    return [
      { title: "Inbound", sub: formatDateTime(getInboundDate(item)) },
      { title: "Reserved", sub: formatDateTime(item.reserved_at) },
      { title: "Picked", sub: formatDateTime(item.picked_at) },
      { title: "Loaded", sub: formatDateTime(item.loaded_at) },
      { title: "Shipped", sub: formatDateTime(item.shipped_at) }
    ].filter(row => row.sub !== "—");
  }

  function renderDetail() {
    const container = byId("stockDetail");
    if (!container) return;

    const item = getSelectedStockItem();

    if (!item) {
      container.innerHTML = `
        <div class="detail-empty">
          Select a stock item from an opened product group to view details, linked order and movement history.
        </div>
      `;
      return;
    }

    const history = movementHistory(item);

    container.innerHTML = `
      <div>
        <div class="detail-code">${escapeHtml(shortSku(item))}</div>
        <div class="subline">${escapeHtml(item.product_name || "—")} · ${escapeHtml(item.display_mutation || mutationDisplay(item))}</div>
      </div>

      <div class="detail-grid">
        <div class="detail-box"><div class="detail-label">Product Owner</div><div class="detail-value">${escapeHtml(item.customer_name || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Status</div><div class="detail-value">${statusPill(item.status)}</div></div>
        <div class="detail-box"><div class="detail-label">Warehouse</div><div class="detail-value">${escapeHtml(item.warehouse_name || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Location</div><div class="detail-value">${escapeHtml(item.location_code || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Linked Order</div><div class="detail-value">${linkedOrderDisplay(item)}</div></div>
        <div class="detail-box"><div class="detail-label">Reference</div><div class="detail-value">${escapeHtml(item.inbound_reference || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Inbound Date</div><div class="detail-value">${escapeHtml(formatDateTime(getInboundDate(item)))}</div></div>
        <div class="detail-box"><div class="detail-label">Original Code</div><div class="detail-value">${escapeHtml(item.sku_unique || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Volume</div><div class="detail-value">${formatNumber(item.volume_m3, 3)} m³</div></div>
        <div class="detail-box"><div class="detail-label">Weight</div><div class="detail-value">${formatNumber(item.weight_kg, 1)} kg</div></div>
      </div>

      <div>
        <div class="detail-label" style="margin-bottom:8px;">Movement History</div>
        <div class="history-list">
          ${
            history.length
              ? history.map(row => `
                <div class="history-item">
                  <div class="history-title">${escapeHtml(row.title)}</div>
                  <div class="history-sub">${escapeHtml(row.sub)}</div>
                </div>
              `).join("")
              : `<div class="history-item"><div class="history-title">No movement history</div><div class="history-sub">No activity timestamps available.</div></div>`
          }
        </div>
      </div>

      ${
        canManageStock()
          ? `
            <div class="bulk-actions tenant-only-stock">
              <button class="btn" data-detail-action="in_stock" data-stock-id="${escapeHtml(item.id)}" type="button">Mark In Stock</button>
              <button class="btn" data-detail-action="reserved" data-stock-id="${escapeHtml(item.id)}" type="button">Mark Reserved</button>
              <button class="btn" data-detail-action="picked" data-stock-id="${escapeHtml(item.id)}" type="button">Mark Picked</button>
              <button class="btn" data-detail-action="loaded" data-stock-id="${escapeHtml(item.id)}" type="button">Mark Loaded</button>
              <button class="btn" data-detail-action="damaged" data-stock-id="${escapeHtml(item.id)}" type="button">Mark Damaged</button>
              <button class="btn btn-primary" data-detail-action="remove_reservation" data-stock-id="${escapeHtml(item.id)}" type="button">Remove Reservation</button>
            </div>
          `
          : ""
      }
    `;

    if (!canManageStock()) return;

    container.querySelectorAll("[data-detail-action]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await handleStockAction(
            button.getAttribute("data-detail-action"),
            button.getAttribute("data-stock-id")
          );
        } catch (error) {
          console.error(error);
          showToast(error.message || "Stock action failed.", "err");
        }
      });
    });
  }

  async function logEventIfAvailable(eventInput) {
    if (!window.EventLog?.logWarehouseEvent) return;

    try {
      await window.EventLog.logWarehouseEvent(eventInput);
    } catch (error) {
      console.warn("Event log skipped:", error.message);
    }
  }

  async function updateItemStatus(stockId, newStatus) {
    if (!canManageStock()) throw new Error("You do not have permission to change stock.");

    const db = ensureClient();
    const cid = await getCompanyId();

    const item = allStockItems.find(row => String(row.id) === String(stockId));
    if (!item) throw new Error("Item not found.");

    const now = new Date().toISOString();
    const payload = { status: newStatus };

    if (newStatus === "in_stock") {
      payload.reserved_at = null;
      payload.picked_at = null;
      payload.loaded_at = null;
      payload.shipped_at = null;
    }

    if (newStatus === "reserved") payload.reserved_at = now;
    if (newStatus === "picked") payload.picked_at = now;
    if (newStatus === "loaded") payload.loaded_at = now;
    if (newStatus === "shipped") payload.shipped_at = now;

    const { error } = await db
      .from("items")
      .update(payload)
      .eq("id", stockId);

    if (error) throw error;

    await logEventIfAvailable({
      company_id: cid,
      event_type: "item_status_changed",
      entity_type: "item",
      entity_id: stockId,
      reference_no: item.sku_unique || item.storage_mutation_id || item.sku_base || null,
      source_module: "current-stock",
      old_status: item.status || null,
      new_status: newStatus,
      payload: {
        product_id: item.product_id || null,
        linked_order_id: item.linked_order_id || null,
        order_number: item.order_number || null,
        retailer_name: item.retailer_name || null,
        inbound_reference: item.inbound_reference || null
      }
    });
  }

  async function removeReservation(stockId) {
    if (!canManageStock()) throw new Error("You do not have permission to change stock.");

    const db = ensureClient();
    const cid = await getCompanyId();

    const item = allStockItems.find(row => String(row.id) === String(stockId));
    if (!item) throw new Error("Item not found.");

    const { error: allocError } = await db
      .from("order_allocations")
      .update({
        allocation_status: CANCELLED_ALLOCATION_STATUS
      })
      .eq("item_id", stockId)
      .neq("allocation_status", CANCELLED_ALLOCATION_STATUS);

    if (allocError) {
      console.warn("Allocation cancellation skipped:", allocError.message);
    }

    const { error } = await db
      .from("items")
      .update({
        status: "in_stock",
        reserved_at: null,
        picked_at: null,
        loaded_at: null,
        shipped_at: null
      })
      .eq("id", stockId);

    if (error) throw error;

    await logEventIfAvailable({
      company_id: cid,
      event_type: "item_unreserved",
      entity_type: "item",
      entity_id: stockId,
      reference_no: item.sku_unique || item.storage_mutation_id || item.sku_base || null,
      source_module: "current-stock",
      old_status: item.status || null,
      new_status: "in_stock",
      payload: {
        product_id: item.product_id || null,
        linked_order_id: item.linked_order_id || null,
        order_number: item.order_number || null,
        retailer_name: item.retailer_name || null,
        inbound_reference: item.inbound_reference || null
      }
    });
  }

  async function handleStockAction(action, stockId) {
    if (!stockId) throw new Error("No stock item selected.");

    if (action === "remove_reservation") {
      await removeReservation(stockId);
      showToast("Reservation removed.", "ok");
      await loadStock();
      return;
    }

    await updateItemStatus(stockId, action);

    if (isOutboundStatus(action)) {
      showToast(`Item marked as ${statusLabel(action)} and moved to Outbound.`, "ok");
    } else {
      showToast(`Item marked as ${statusLabel(action)}.`, "ok");
    }

    await loadStock();
  }

  async function bulkAction(action, stockIds) {
    if (!canManageStock()) throw new Error("You do not have permission to change stock.");

    const ids = (stockIds || []).filter(Boolean);

    if (!ids.length) {
      showToast("No stock items selected.", "err");
      return;
    }

    const confirmText =
      action === "remove_reservation"
        ? `Remove reservation from ${ids.length} selected item(s)?`
        : isOutboundStatus(action)
          ? `Mark ${ids.length} selected item(s) as ${statusLabel(action)} and move them to Outbound?`
          : `Mark ${ids.length} selected item(s) as ${statusLabel(action)}?`;

    if (!window.confirm(confirmText)) return;

    for (const id of ids) {
      if (action === "remove_reservation") {
        await removeReservation(id);
      } else {
        await updateItemStatus(id, action);
      }
    }

    selectedItemIds.clear();

    if (isOutboundStatus(action)) {
      showToast(`${formatNumber(ids.length)} item(s) moved to Outbound.`, "ok");
    } else {
      showToast(`${formatNumber(ids.length)} item(s) updated.`, "ok");
    }

    await loadStock();
  }

  async function runMatchFromStock() {
    if (!canManageStock()) throw new Error("You do not have permission to run matching.");

    if (!window.AllocationEngine?.run) {
      throw new Error("AllocationEngine is not loaded. Add /js/allocation-engine.js before /js/stock.js.");
    }

    showToast("Running match module...", "ok");

    const result = await window.AllocationEngine.run({
      dryRun: false
    });

    await loadStock();

    const created =
      result?.allocations_created ??
      result?.allocationsCreated ??
      result?.created ??
      0;

    showToast(`Match complete. ${formatNumber(created)} item(s) reserved.`, "ok");
  }

  function exportAvailabilityLabel(item) {
    const status = normalize(item.status);

    if (status === "loaded" || item.shipment_id) return "On Shipment";
    if (status === "picked") return "Picked / Outbound";
    if (status === "reserved" || item.linked_order_id) return "Linked to Order";
    if (["damaged", "missing", "cancelled"].includes(status)) return "Blocked";

    return "Available";
  }

  function stockExportRows(items) {
    return (items || []).map((item, index) => ({
      "Product Owner": item.customer_name || "",
      "SKU": shortSku(item),
      "Product": item.product_name || "",
      "Description": item.product_description || "",
      "Mutation": item.display_mutation || mutationDisplay(item, index + 1),
      "Original Unique SKU": item.sku_unique || "",
      "Original Mutation ID": item.storage_mutation_id || "",
      "Status": statusLabel(item.status),
      "Availability": exportAvailabilityLabel(item),
      "Linked Order": item.order_number || "",
      "Retailer": item.retailer_name || "",
      "Purchase Order": item.purchase_order || "",
      "Reference": item.inbound_reference || "",
      "Warehouse": item.warehouse_name || "",
      "Location": item.location_code || "",
      "Volume m3": toNumber(item.volume_m3, 0),
      "Weight kg": toNumber(item.weight_kg, 0),
      "Inbound Date": formatDateTime(getInboundDate(item)),
      "Reserved": formatDateTime(item.reserved_at),
      "Picked": formatDateTime(item.picked_at),
      "Loaded": formatDateTime(item.loaded_at),
      "Shipped": formatDateTime(item.shipped_at)
    }));
  }

  function selectedExportFormat() {
    return document.querySelector('input[name="stockExportFormat"]:checked')?.value || "xlsx";
  }

  function selectedExportScope() {
    return document.querySelector('input[name="stockExportScope"]:checked')?.value || "filtered";
  }

  function exportFileName(ext) {
    return `veynor-current-stock-${fileDateStamp()}.${ext}`;
  }

  function getRowsForExport() {
    const scope = selectedExportScope();

    if (scope === "all") return allStockItems;

    if (scope === "selected") {
      const ids = new Set(Array.from(selectedItemIds).map(String));
      return allStockItems.filter(item => ids.has(String(item.id)));
    }

    if (scope === "product") {
      const key = byId("stockExportProduct")?.value || "";
      if (!key) return [];

      const sourceGroups = groupItems(allStockItems);
      const group = sourceGroups.find(g => String(g.key) === String(key));
      return group?.items || [];
    }

    return filteredStockItems;
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
    const data = stockExportRows(rows);

    if (!data.length) {
      showToast("No stock rows available for export.", "err");
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
    const data = stockExportRows(rows);

    if (!data.length) {
      showToast("No stock rows available for export.", "err");
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

    XLSX.utils.book_append_sheet(wb, ws, "Current Stock");
    XLSX.writeFile(wb, exportFileName("xlsx"));
  }

  function exportPdf(rows) {
    const data = stockExportRows(rows);

    if (!data.length) {
      showToast("No stock rows available for export.", "err");
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
    doc.text("Veynor Current Stock Export", 14, 15);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Exported: ${new Date().toLocaleString("en-GB")}`, 14, 21);
    doc.text(`Rows: ${data.length}`, 14, 26);

    const columns = [
      "Product Owner",
      "SKU",
      "Product",
      "Mutation",
      "Status",
      "Availability",
      "Linked Order",
      "Retailer",
      "Purchase Order",
      "Reference",
      "Warehouse",
      "Location",
      "Volume m3",
      "Weight kg",
      "Inbound Date"
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

  function confirmStockExport() {
    const rows = getRowsForExport();

    if (!rows.length) {
      showToast("No stock rows available for this export selection.", "err");
      return;
    }

    const format = selectedExportFormat();

    if (format === "csv") exportCsv(rows);
    else if (format === "pdf") exportPdf(rows);
    else exportExcel(rows);

    closeStockExportModal();
    showToast(`${formatNumber(rows.length)} stock row(s) exported.`, "ok");
  }

  function openStockExportModal() {
    renderExportProductOptions();

    const modal = byId("stockExportModal");
    if (!modal) return;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    toggleExportProductRow();
  }

  function closeStockExportModal() {
    const modal = byId("stockExportModal");
    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function toggleExportProductRow() {
    const scope = selectedExportScope();
    const row = byId("stockExportProductRow");
    if (!row) return;

    row.classList.toggle("open", scope === "product");
  }

  function renderExportProductOptions() {
    const select = byId("stockExportProduct");
    if (!select) return;

    const current = select.value || "";
    const groups = sortGroups(groupItems(allStockItems));

    select.innerHTML =
      `<option value="">Select product</option>` +
      groups.map(group => {
        const label = `${group.sku_base} · ${group.product_name} · ${group.total} rows`;
        return `<option value="${escapeHtml(group.key)}">${escapeHtml(label)}</option>`;
      }).join("");

    if (current && groups.some(group => String(group.key) === String(current))) {
      select.value = current;
    }
  }

  function bindExportEvents() {
    byId("btnOpenStockExport")?.addEventListener("click", openStockExportModal);
    byId("btnCloseStockExport")?.addEventListener("click", closeStockExportModal);
    byId("btnCancelStockExport")?.addEventListener("click", closeStockExportModal);
    byId("btnConfirmStockExport")?.addEventListener("click", confirmStockExport);

    byId("stockExportModal")?.addEventListener("click", event => {
      if (event.target?.id === "stockExportModal") closeStockExportModal();
    });

    document.querySelectorAll('input[name="stockExportScope"]').forEach(input => {
      input.addEventListener("change", toggleExportProductRow);
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeStockExportModal();
    });
  }

  function bindEvents() {
    [
      "stockSearch",
      "stockCustomer",
      "stockStatus",
      "stockAvailability",
      "stockSort"
    ].forEach(id => {
      byId(id)?.addEventListener("input", () => applyFilters(true));
      byId(id)?.addEventListener("change", () => applyFilters(true));
    });

    byId("btnRefreshStock")?.addEventListener("click", async () => {
      try {
        await loadStock();
        showToast("Current stock refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Refresh failed.", "err");
      }
    });

    byId("btnClearStockFilters")?.addEventListener("click", () => {
      ["stockSearch", "stockCustomer", "stockStatus", "stockAvailability", "stockSort"].forEach(id => {
        const el = byId(id);
        if (!el) return;
        el.value = id === "stockSort" ? "sku_asc" : "";
      });

      selectedItemIds.clear();
      applyFilters(false);
    });

    if (canManageStock()) {
      byId("btnSelectAllVisible")?.addEventListener("click", () => {
        filteredStockItems.forEach(item => selectedItemIds.add(String(item.id)));
        syncSelectionUi();
      });

      byId("btnSelectNone")?.addEventListener("click", () => {
        selectedItemIds.clear();
        syncSelectionUi();
      });

      byId("btnRemoveReservation")?.addEventListener("click", () => {
        bulkAction("remove_reservation", Array.from(selectedItemIds));
      });

      byId("btnMarkPicked")?.addEventListener("click", () => {
        bulkAction("picked", Array.from(selectedItemIds));
      });

      byId("btnMarkLoaded")?.addEventListener("click", () => {
        bulkAction("loaded", Array.from(selectedItemIds));
      });

      byId("btnRunMatch")?.addEventListener("click", async () => {
        try {
          await runMatchFromStock();
        } catch (error) {
          console.error(error);
          showToast(error.message || "Run Match failed.", "err");
        }
      });
    }

    bindExportEvents();
  }

  async function init() {
    try {
      ensureClient();
      await loadCurrentProfile();
      bindEvents();
      await loadStock();

      window.clearInterval(window.__stockRefreshInterval);
      window.__stockRefreshInterval = window.setInterval(() => {
        loadStock().catch(error => console.warn("Stock auto-refresh skipped:", error.message));
      }, STOCK_REFRESH_INTERVAL_MS);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Current Stock failed to load.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
