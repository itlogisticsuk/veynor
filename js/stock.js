(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const STOCK_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
  const CANCELLED_ALLOCATION_STATUS = "cancelled";
  const OUTBOUND_STATUSES = ["picked", "loaded", "shipped", "closed", "manual_outbound"];

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
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
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

  function canManageStock() {
    return isTenantRole();
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    if (currentProfile?.company_id) {
      companyId = currentProfile.company_id;
      return companyId;
    }

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

  function shortSku(item) {
    return item.sku_base || item.products?.sku_base || item.sku_unique?.split("-IN-")[0] || "—";
  }

  function packageLabel(item) {
    const no = toNumber(item.package_no, 1);
    const total = toNumber(item.package_total, 1);
    return item.package_label || `${no}/${total}`;
  }

  function mutationDisplay(item, fallbackIndex = 0) {
    const sku = shortSku(item);
    const label = item.package_label || packageLabel(item);

    if (item.storage_mutation_id) return `${sku} · ${label}`;
    if (item.sku_unique) return `${sku} · ${label}`;

    return `${sku}-${fallbackIndex || 1} · ${label}`;
  }

  function statusClass(status) {
    const safe = normalize(status || "in_stock").replace(/[^a-z0-9_]/g, "");

    if (safe === "reserved") return "status-ready_for_picking";
    if (safe === "picked") return "status-planned";
    if (safe === "loaded") return "status-loaded";
    if (safe === "shipped" || safe === "closed" || safe === "manual_outbound") return "status-closed";
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
      manual_outbound: "Manual Outbound",
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

  function isAvailable(item) {
    return normalize(item.status) === "in_stock";
  }

  function isReserved(item) {
    return normalize(item.status) === "reserved" || !!item.linked_order_id;
  }

  function isBlocked(item) {
    return ["missing", "damaged", "cancelled"].includes(normalize(item.status));
  }

  function allocationPill(item) {
    const status = normalize(item.status);

    if (status === "loaded" || item.shipment_id) return `<span class="soft-pill green">On Shipment</span>`;
    if (status === "picked") return `<span class="soft-pill orange">Picked</span>`;
    if (status === "reserved" || item.linked_order_id) return `<span class="soft-pill orange">Linked</span>`;
    if (["damaged", "missing", "cancelled"].includes(status)) return `<span class="soft-pill gray">Blocked</span>`;

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

  function linkedOrderDisplay(item) {
    if (!item.order_number && !item.linked_order_id) return "—";

    const orderNo = item.order_number || item.linked_order_id || "Order";
    const retailer = item.retailer_name || "";
    const po = item.purchase_order || "";
    const supplierRef = item.supplier_reference || "";

    return `
      <span class="stock-link">${escapeHtml(orderNo)}</span>
      ${supplierRef ? `<span class="subline">Supplier Ref: ${escapeHtml(supplierRef)}</span>` : ""}
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
      .select("id, code, warehouse_id, location_code")
      .eq("company_id", cid)
      .order("code", { ascending: true });

    if (error) {
      console.warn("Locations skipped:", error.message);
      locations = [];
      return;
    }

    locations = (data || []).map(row => ({
      ...row,
      code: row.code || row.location_code || ""
    }));
  }

  function renderCustomerFilter() {
    const select = byId("stockCustomer");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">All Product Owners</option>` +
      customers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");

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
      physical_product_id,
      package_no,
      package_total,
      package_label,
      stock_set_status,
      stock_set_key,
      stock_set_id,
      products (
        id,
        sku_base,
        name,
        description,
        volume_m3,
        weight_kg,
customer_id,
sales_unit_name,
sales_units_per_package,
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
      const packageTotal = Math.max(1, toNumber(row.package_total, 1));

      return {
        ...row,
        linked_order_id: null,
        order_number: "",
        retailer_name: "",
        purchase_order: "",
        shipment_id: null,
        shipment_number: "",
        supplier_reference: "",
        sku_base: getSkuBase(row),
        product_name: getProductName(row),
        product_description: row.products?.description || "",
        customer_id: row.products?.customer_id || "",
        customer_name: getOwnerName(row),
        warehouse_name: getWarehouseName(row.warehouse_id),
        location_code: getLocationCode(row.location_id),
        inbound_reference: row.inbound_reference || "",
        inbound_date: row.inbound_date || row.created_at || null,
volume_m3: toNumber(row.volume_m3, 0) || (productVolume / packageTotal),
weight_kg: toNumber(row.weight_kg, 0) || (productWeight / packageTotal),

product_volume_m3: productVolume,
product_weight_kg: productWeight,
sales_unit_name: row.products?.sales_unit_name || "Units",
sales_units_per_package: toNumber(row.products?.sales_units_per_package, 1) || 1,
        physical_product_id: row.physical_product_id || "",
        package_no: Math.max(1, toNumber(row.package_no, 1)),
        package_total: packageTotal,
        package_label: row.package_label || `${Math.max(1, toNumber(row.package_no, 1))}/${packageTotal}`,
        stock_set_status: row.stock_set_status || "",
        stock_set_key: row.stock_set_key || "",
        stock_set_id: row.stock_set_id || ""
      };
    });

  if (isProductOwnerRole() && currentProfile?.customer_id) {
    allStockItems = allStockItems.filter(item =>
      String(item.customer_id) === String(currentProfile.customer_id)
    );
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

  const itemIds = allStockItems.map(i => i.id).filter(Boolean);
  const stockSetIds = [...new Set(allStockItems.map(i => i.stock_set_id).filter(Boolean))];

  if (!itemIds.length && !stockSetIds.length) return;

  function chunks(arr, size = 80) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  let allocations = [];

  for (const part of chunks(itemIds, 80)) {
    const { data, error } = await db
      .from("order_allocations")
      .select("id,item_id,stock_set_id,order_line_id,allocation_status,allocated_at")
      .in("item_id", part)
      .neq("allocation_status", CANCELLED_ALLOCATION_STATUS);

    if (error) {
      console.warn("Allocation item chunk skipped:", error.message);
      continue;
    }

    allocations = allocations.concat(data || []);
  }

  for (const part of chunks(stockSetIds, 80)) {
    const { data, error } = await db
      .from("order_allocations")
      .select("id,item_id,stock_set_id,order_line_id,allocation_status,allocated_at")
      .in("stock_set_id", part)
      .neq("allocation_status", CANCELLED_ALLOCATION_STATUS);

    if (error) {
      console.warn("Allocation stock_set chunk skipped:", error.message);
      continue;
    }

    allocations = allocations.concat(data || []);
  }

  const uniqueAllocations = new Map();
  allocations.forEach(alloc => {
    if (alloc.id) uniqueAllocations.set(String(alloc.id), alloc);
  });
  allocations = [...uniqueAllocations.values()];

  const orderLineIds = [...new Set(allocations.map(a => a.order_line_id).filter(Boolean))];
  if (!orderLineIds.length) return;

  let lines = [];

  for (const part of chunks(orderLineIds, 80)) {
    const { data, error } = await db
      .from("order_lines")
      .select("id,order_id")
      .in("id", part);

    if (error) {
      console.warn("Order line chunk skipped:", error.message);
      continue;
    }

    lines = lines.concat(data || []);
  }

  const orderIds = [...new Set(lines.map(l => l.order_id).filter(Boolean))];
  if (!orderIds.length) return;

  let orders = [];

  for (const part of chunks(orderIds, 80)) {
    const { data, error } = await db
      .from("orders")
      .select("id,order_number,external_reference,purchase_order,retail_name")
      .in("id", part);

    if (error) {
      console.warn("Order chunk skipped:", error.message);
      continue;
    }

    orders = orders.concat(data || []);
  }

  const lineById = new Map(lines.map(line => [String(line.id), line]));
  const orderById = new Map(orders.map(order => [String(order.id), order]));
  const itemById = new Map(allStockItems.map(item => [String(item.id), item]));

  const allocationByItem = new Map();
  const allocationByStockSet = new Map();
  const allocationByPhysicalProduct = new Map();

  allocations.forEach(alloc => {
    if (alloc.item_id) {
      allocationByItem.set(String(alloc.item_id), alloc);

      const allocatedItem = itemById.get(String(alloc.item_id));
      if (allocatedItem?.physical_product_id) {
        allocationByPhysicalProduct.set(String(allocatedItem.physical_product_id), alloc);
      }
    }

    if (alloc.stock_set_id) {
      allocationByStockSet.set(String(alloc.stock_set_id), alloc);
    }
  });

  allStockItems = allStockItems.map(item => {
const alloc =
  allocationByItem.get(String(item.id)) ||
  allocationByStockSet.get(String(item.stock_set_id || "")) ||
  allocationByPhysicalProduct.get(String(item.physical_product_id || ""));

    if (!alloc) return item;

    const line = lineById.get(String(alloc.order_line_id));
    const order = orderById.get(String(line?.order_id || ""));

    if (!line || !order) return item;

    return {
      ...item,
      linked_order_id: order.id,
      order_number: order.order_number || order.external_reference || order.id || "",
      supplier_reference: order.external_reference || "",
      retailer_name: order.retail_name || "",
      purchase_order: order.purchase_order || "",
      allocation_id: alloc.id,
      allocation_status: alloc.allocation_status || "reserved",
      reserved_at: item.reserved_at || alloc.allocated_at || null,
      status: normalize(item.status) === "in_stock" ? "reserved" : item.status
    };
  });
}
  function activePackages(items) {
    return (items || []).filter(item => !isBlocked(item) && !isOutboundStatus(item));
  }

  function calculateCompleteness(items) {
    const active = activePackages(items);
    const totalPackages = Math.max(1, ...active.map(item => toNumber(item.package_total, 1)));

    const availableByPackage = {};
    const reservedByPackage = {};
    const allByPackage = {};

    for (let i = 1; i <= totalPackages; i++) {
      availableByPackage[i] = 0;
      reservedByPackage[i] = 0;
      allByPackage[i] = 0;
    }

    active.forEach(item => {
      const no = Math.min(Math.max(1, toNumber(item.package_no, 1)), totalPackages);
      allByPackage[no] += 1;
      if (isAvailable(item)) availableByPackage[no] += 1;
      if (isReserved(item)) reservedByPackage[no] += 1;
    });

    const completeProducts = Math.min(...Object.values(allByPackage));
    const availableComplete = Math.min(...Object.values(availableByPackage));
    const reservedComplete = Math.min(...Object.values(reservedByPackage));

    const overstock = [];
    const missing = [];

    for (let i = 1; i <= totalPackages; i++) {
      const extra = allByPackage[i] - completeProducts;
      if (extra > 0) {
        overstock.push({
          package_no: i,
          package_total: totalPackages,
          qty: extra,
          label: `${extra}x package ${i}/${totalPackages}`
        });
      }
    }

    overstock.forEach(row => {
      for (let i = 1; i <= totalPackages; i++) {
        if (i === row.package_no) continue;
        const shortage = row.qty;
        missing.push({
          package_no: i,
          package_total: totalPackages,
          qty: shortage,
          label: `${shortage}x package ${i}/${totalPackages}`
        });
      }
    });

    return {
      totalPackages: active.length,
      packageTotal: totalPackages,
      completeProducts,
      availableComplete,
      reservedComplete,
      overstock,
      missing,
      allByPackage,
      availableByPackage,
      reservedByPackage
    };
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
          physicalPackages: 0,
        completeProducts: 0,
salesUnits: 0,
available: 0,
availableSalesUnits: 0,
reserved: 0,
blocked: 0,
sales_unit_name: "Units",
sales_units_per_package: 1,
          incomplete: 0,
          overstock: [],
          missing: [],
          volume_m3: 0,
          weight_kg: 0,
          items: []
        });
      }

      const group = map.get(key);

      group.items.push(item);
      group.total += 1;
      group.physicalPackages += 1;
     group.product_volume_m3 = toNumber(item.product_volume_m3 || item.products?.volume_m3, 0);
group.product_weight_kg = toNumber(item.product_weight_kg || item.products?.weight_kg, 0);
group.sales_unit_name = item.sales_unit_name || "Units";
group.sales_units_per_package = toNumber(item.sales_units_per_package, 1) || 1;

      if (isReserved(item)) group.reserved += 1;
      if (isBlocked(item)) group.blocked += 1;
    });

    Array.from(map.values()).forEach(group => {
      const completeness = calculateCompleteness(group.items);

      group.completeness = completeness;
     group.completeProducts = completeness.completeProducts;
group.available = completeness.availableComplete;
group.reservedComplete = completeness.reservedComplete;

group.salesUnits = group.completeProducts * group.sales_units_per_package;
group.availableSalesUnits = group.available * group.sales_units_per_package;
      group.incomplete = completeness.overstock.reduce((sum, row) => sum + row.qty, 0);
group.complete_volume_m3 = group.completeProducts * toNumber(group.product_volume_m3, 0);
group.available_complete_volume_m3 = group.available * toNumber(group.product_volume_m3, 0);
group.complete_weight_kg = group.completeProducts * toNumber(group.product_weight_kg, 0);
group.available_complete_weight_kg = group.available * toNumber(group.product_weight_kg, 0);
group.physical_volume_m3 = group.complete_volume_m3;
group.physical_weight_kg = group.complete_weight_kg;
      group.overstock = completeness.overstock;
      group.missing = completeness.missing;

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
    else if (sort === "total_desc") rows.sort((a, b) => b.physicalPackages - a.physicalPackages || textSort(a.sku_base, b.sku_base));
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

  function setKpis() {
    const groups = groupItems(allStockItems);
    const totalPackages = allStockItems.length;
    const availableComplete = groups.reduce((sum, group) => sum + group.available, 0);
    const reservedPackages = allStockItems.filter(isReserved).length;
    const blocked = allStockItems.filter(isBlocked).length;
    const pickedLoaded = allStockItems.filter(item => ["picked", "loaded"].includes(normalize(item.status))).length;

    setText("kpiSkuGroups", formatNumber(groups.length));
    setText("kpiStockTotal", formatNumber(totalPackages));
    setText("kpiStockAvailable", formatNumber(availableComplete));
    setText("kpiStockReserved", formatNumber(reservedPackages));
    setText("kpiStockBlocked", formatNumber(blocked));

    setText("summaryAvailable", formatNumber(availableComplete));
    setText("summaryLinked", formatNumber(reservedPackages));
    setText("summaryShipments", formatNumber(pickedLoaded));
    setText("summaryBlocked", formatNumber(blocked));
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
      if (availability === "allocated" && !isReserved(item)) return false;
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
          item.supplier_reference,
          item.retailer_name,
          item.purchase_order,
          item.status,
          item.linked_order_id,
          item.package_label,
          item.physical_product_id
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

  function overstockText(group) {
    if (!group.overstock?.length) return "No overstock";
    return group.overstock.map(row => row.label).join(", ");
  }

  function missingText(group) {
    if (!group.missing?.length) return "No missing packages";
    return group.missing.map(row => row.label).join(", ");
  }

  function makeGroupHtml(group, index) {
    return `
      <article class="stock-group" data-group-index="${index}">
        <button class="stock-group-head" type="button" aria-expanded="false">
          <div class="sg-sku">${escapeHtml(group.sku_base)}</div>

          <div class="sg-info">
            <b>${escapeHtml(group.product_name)}</b>
            <div class="subline">${escapeHtml(group.customer_name)}${group.product_description ? " · " + escapeHtml(group.product_description) : ""}</div>
            <div class="sg-meta">
              <span class="soft-pill blue">${formatNumber(group.physicalPackages)} physical packages</span>
              <span class="soft-pill green">${formatNumber(group.salesUnits)} ${escapeHtml(group.sales_unit_name)}</span>
              ${group.incomplete ? `<span class="soft-pill orange">Overstock: ${escapeHtml(overstockText(group))}</span>` : ""}
              ${group.blocked ? `<span class="soft-pill gray">${formatNumber(group.blocked)} blocked</span>` : ""}
            </div>
          </div>

          <div class="sg-stat total"><div class="n">${formatNumber(group.physicalPackages)}</div><div class="t">Packages</div></div>
          <div class="sg-stat available"><div class="n">${formatNumber(group.salesUnits)}</div><div class="t">${escapeHtml(group.sales_unit_name === "Units" || group.sales_unit_name === "Unit" ? "Complete" : group.sales_unit_name)}</div></div>
<div class="sg-stat reserved"><div class="n">${formatNumber(group.availableSalesUnits)}</div><div class="t">Available</div></div>
          <div class="sg-stat extra"><div class="n">${formatNumber(group.incomplete)}</div><div class="t">Overstock</div></div>
          <div class="sg-arrow">⌄</div>
        </button>

        <div class="stock-group-body">
          <div class="group-summary">
            <div class="kpi-box"><div class="kpi-label">Physical Packages</div><div class="kpi-value">${formatNumber(group.physicalPackages)}</div></div>
            <div class="kpi-box"><div class="kpi-label">Complete Products</div><div class="kpi-value">${formatNumber(group.completeProducts)}</div></div>
            <div class="kpi-box"><div class="kpi-label">Available Complete</div><div class="kpi-value">${formatNumber(group.available)}</div></div>
            <div class="kpi-box"><div class="kpi-label">Reserved Packages</div><div class="kpi-value">${formatNumber(group.reserved)}</div></div>
            <div class="kpi-box"><div class="kpi-label">Overstock</div><div class="kpi-value">${formatNumber(group.incomplete)}</div></div>
            <div class="kpi-box"><div class="kpi-label">Total Volume</div><div class="kpi-value">${formatNumber(group.complete_volume_m3, 3)} m³</div></div>
          </div>

          ${
            group.overstock?.length
              ? `<div class="note-box">Overstock: ${escapeHtml(overstockText(group))}. Missing to complete: ${escapeHtml(missingText(group))}.</div>`
              : ""
          }

          ${
            canManageStock()
              ? `
                <div class="group-action-bar tenant-only-stock">
                  <label class="check-row">
                    <input class="row-check" type="checkbox" data-select-group="${escapeHtml(group.key)}"/>
                    Select all packages in this product group
                  </label>

                  <div class="stock-actions">
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
                  <th>SKU / Package</th>
                  <th>Mutation</th>
                  <th>Set ID</th>
                  <th>Status</th>
                  <th>Allocation</th>
                  <th>Linked Order</th>
                  <th>Reference</th>
                  <th>Location</th>
                  <th>Product m³</th>
<th>Product kg</th>
<th>Package m³</th>
<th>Package kg</th>
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
          <span class="subline">Package ${escapeHtml(packageLabel(item))} · ${escapeHtml(item.product_name || "—")}</span>
        </td>

        <td>
          <span class="mut-id">${escapeHtml(item.display_mutation || mutationDisplay(item))}</span>
          <span class="subline">${escapeHtml(item.sku_unique || "—")}</span>
        </td>

        <td>
          <span class="mut-id">${escapeHtml(item.physical_product_id || "—")}</span>
          <span class="subline">${escapeHtml(item.stock_set_status || "—")}</span>
        </td>

        <td>${statusPill(item.status)}</td>
        <td>${allocationPill(item)}</td>
        <td>${linkedOrderDisplay(item)}</td>
        <td>${escapeHtml(item.inbound_reference || "—")}</td>
        <td>${escapeHtml(item.location_code || "—")}<span class="subline">${escapeHtml(item.warehouse_name || "—")}</span></td>
<td>${formatNumber(item.product_volume_m3, 3)}</td>
<td>${formatNumber(item.product_weight_kg, 1)}</td>
<td>${formatNumber(item.volume_m3, 3)}</td>
<td>${formatNumber(item.weight_kg, 1)}</td>
        <td>${escapeHtml(formatDateTime(getInboundDate(item)))}</td>

        ${
          canManageStock()
            ? `
              <td class="tenant-only-stock">
                <div class="stock-actions">
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
    const completeProducts = groupedStock.reduce((sum, group) => sum + group.completeProducts, 0);
    const base = `Showing ${formatNumber(filteredStockItems.length)} physical package(s) in ${formatNumber(groupedStock.length)} SKU group(s) · ${formatNumber(completeProducts)} complete product(s)`;

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
        <div class="detail-code">${escapeHtml(shortSku(item))} · Package ${escapeHtml(packageLabel(item))}</div>
        <div class="subline">${escapeHtml(item.product_name || "—")} · ${escapeHtml(item.display_mutation || mutationDisplay(item))}</div>
      </div>

      <div class="detail-grid">
        <div class="detail-box"><div class="detail-label">Product Owner</div><div class="detail-value">${escapeHtml(item.customer_name || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Status</div><div class="detail-value">${statusPill(item.status)}</div></div>
        <div class="detail-box"><div class="detail-label">Barn</div><div class="detail-value">${escapeHtml(item.warehouse_name || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Location</div><div class="detail-value">${escapeHtml(item.location_code || "—")}</div></div>
        <div class="detail-box"><div class="detail-label">Package</div><div class="detail-value">${escapeHtml(packageLabel(item))}</div></div>
        <div class="detail-box"><div class="detail-label">Set ID</div><div class="detail-value">${escapeHtml(item.physical_product_id || "—")}</div></div>
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
            <div class="stock-actions tenant-only-stock">
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
        inbound_reference: item.inbound_reference || null,
        package_no: item.package_no || null,
        package_total: item.package_total || null,
        physical_product_id: item.physical_product_id || null
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
      .update({ allocation_status: CANCELLED_ALLOCATION_STATUS })
      .eq("item_id", stockId)
      .neq("allocation_status", CANCELLED_ALLOCATION_STATUS);

    if (allocError) console.warn("Allocation cancellation skipped:", allocError.message);

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
      showToast(`Package marked as ${statusLabel(action)} and moved to Outbound.`, "ok");
    } else {
      showToast(`Package marked as ${statusLabel(action)}.`, "ok");
    }

    await loadStock();
  }

  async function bulkAction(action, stockIds) {
    if (!canManageStock()) throw new Error("You do not have permission to change stock.");

    const ids = (stockIds || []).filter(Boolean);

    if (!ids.length) {
      showToast("No stock packages selected.", "err");
      return;
    }

    const confirmText =
      action === "remove_reservation"
        ? `Remove reservation from ${ids.length} selected package(s)?`
        : isOutboundStatus(action)
          ? `Mark ${ids.length} selected package(s) as ${statusLabel(action)} and move them to Outbound?`
          : `Mark ${ids.length} selected package(s) as ${statusLabel(action)}?`;

    if (!window.confirm(confirmText)) return;

    for (const id of ids) {
      if (action === "remove_reservation") await removeReservation(id);
      else await updateItemStatus(id, action);
    }

    selectedItemIds.clear();

    showToast(`${formatNumber(ids.length)} package(s) updated.`, "ok");
    await loadStock();
  }

  async function runMatchFromStock() {
    if (!canManageStock()) throw new Error("You do not have permission to run matching.");

    if (!window.AllocationEngine?.run) {
      throw new Error("AllocationEngine is not loaded. Add /js/allocation-engine.js before /js/stock.js.");
    }

    showToast("Running match module...", "ok");

    const result = await window.AllocationEngine.run({ dryRun: false });

    await loadStock();

    const created =
      result?.allocations_created ??
      result?.allocationsCreated ??
      result?.created ??
      0;

    showToast(`Match complete. ${formatNumber(created)} package(s) reserved.`, "ok");
  }

  function exportAvailabilityLabel(item) {
    const status = normalize(item.status);

    if (status === "loaded" || item.shipment_id) return "On Shipment";
    if (status === "picked") return "Picked / Outbound";
    if (status === "reserved" || item.linked_order_id) return "Linked to Order";
    if (["damaged", "missing", "cancelled"].includes(status)) return "Blocked";

    return "Available";
  }

function stockProjectExportRows(items) {
  const groups = sortGroups(groupItems(items || []));

  return groups.map(group => {
    const packageCounts = {};

    (group.items || []).forEach(item => {
      const label = packageLabel(item);
      packageCounts[label] = (packageCounts[label] || 0) + 1;
    });

    return {
      "SKU": group.sku_base || "",
      "Product": group.product_name || "",
      "Description": group.product_description || "",
      "1/1": packageCounts["1/1"] || 0,
      "1/2": packageCounts["1/2"] || 0,
      "2/2": packageCounts["2/2"] || 0,
      "1/3": packageCounts["1/3"] || 0,
      "2/3": packageCounts["2/3"] || 0,
      "3/3": packageCounts["3/3"] || 0,
      "Packages": group.physicalPackages || 0,
      "Complete Products": group.completeProducts || 0,
      "Sales Unit": group.sales_unit_name || "Units",
      "Sales Units": group.salesUnits || 0
    };
  });
}

  function stockExportRows(items) {
    return (items || []).map((item, index) => ({
      "Product Owner": item.customer_name || "",
      "SKU": shortSku(item),
      "Product": item.product_name || "",
      "Description": item.product_description || "",
      "Package": packageLabel(item),
      "Physical Product ID": item.physical_product_id || "",
      "Set Status": item.stock_set_status || "",
      "Mutation": item.display_mutation || mutationDisplay(item, index + 1),
      "Original Unique SKU": item.sku_unique || "",
      "Original Mutation ID": item.storage_mutation_id || "",
      "Status": statusLabel(item.status),
      "Availability": exportAvailabilityLabel(item),
      "Linked Order": item.order_number || "",
      "Supplier Reference": item.supplier_reference || "",
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

function safeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function exportFileName(ext) {
  if (selectedExportScope() === "project") {
    const name = safeFileName(byId("stockExportProjectName")?.value || "");
    return `${name || "Bellstone Import"}.${ext}`;
  }

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
const data = selectedExportScope() === "project"
  ? stockProjectExportRows(rows)
  : stockExportRows(rows);

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
const data = selectedExportScope() === "project"
  ? stockProjectExportRows(rows)
  : stockExportRows(rows);

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
      wch: Math.min(Math.max(key.length + 4, 14), 36)
    }));

    XLSX.utils.book_append_sheet(wb, ws, "Current Stock");
    XLSX.writeFile(wb, exportFileName("xlsx"));
  }

function exportPdf(rows) {
  const isProject = selectedExportScope() === "project";

  const data = isProject
    ? stockProjectExportRows(rows)
    : stockExportRows(rows);

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

  const projectName = byId("stockExportProjectName")?.value?.trim() || "";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(isProject ? "Bellstone Import" : "Veynor Current Stock Export", 14, 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  if (isProject && projectName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(projectName, 14, 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Exported: ${new Date().toLocaleString("en-GB")}`, 14, 28);
    doc.text(`Rows: ${data.length}`, 14, 33);
  } else {
    doc.text(`Exported: ${new Date().toLocaleString("en-GB")}`, 14, 21);
    doc.text(`Rows: ${data.length}`, 14, 26);
  }

  const columns = isProject
    ? [
        "SKU",
        "Product",
        "Description",
        "1/1",
        "1/2",
        "2/2",
        "1/3",
        "2/3",
        "3/3",
        "Packages",
        "Complete Products",
        "Sales Unit",
        "Sales Units"
      ]
    : [
        "Product Owner",
        "SKU",
        "Product",
        "Package",
        "Physical Product ID",
        "Status",
        "Availability",
        "Linked Order",
        "Retailer",
        "Reference",
        "Warehouse",
        "Location",
        "Inbound Date"
      ];

  const body = data.map(row => columns.map(col => row[col] ?? ""));

  doc.autoTable({
    head: [columns],
    body,
    startY: isProject ? 39 : 32,
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
if (selectedExportScope() === "project") {
  const projectName = byId("stockExportProjectName")?.value?.trim() || "";

  if (!projectName) {
    showToast("Enter a project / container name first.", "err");
    return;
  }
}

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
        const label = `${group.sku_base} · ${group.product_name} · ${group.physicalPackages} package(s) · ${group.completeProducts} complete`;
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