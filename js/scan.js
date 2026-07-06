(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const OUTBOUND_STATUS = "manual_outbound";
  const OUTBOUND_STATUSES = ["manual_outbound", "picked", "loaded", "shipped", "closed", "cancelled", "damaged", "missing"];

  let client = null;
  let companyId = null;

  let products = [];
  let productOwners = [];
  let warehouses = [];
  let locations = [];

  let activeWarehouse = null;
  let activeLocation = null;

  let inboundHistory = [];
  let outboundHistory = [];

  let linesToday = 0;
  let unitsIn = 0;
  let unitsOut = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function cleanCode(value) {
    return normalize(value).replace(/[^a-z0-9]/g, "");
  }

  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function nowTime() {
    return new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = `notice ${type}`;

    clearTimeout(window.__scanToastTimer);
    window.__scanToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5000);
  }

function showProgress(title, current, total, subText) {
  const box = byId("scanProgressBox");
  const titleEl = byId("scanProgressTitle");
  const textEl = byId("scanProgressText");
  const barEl = byId("scanProgressBar");
  const subEl = byId("scanProgressSub");

  if (!box || !barEl || !textEl) return;

  const safeTotal = Math.max(1, Number(total || 1));
  const safeCurrent = Math.max(0, Math.min(Number(current || 0), safeTotal));
  const pct = Math.round((safeCurrent / safeTotal) * 100);

  box.style.display = "block";
  if (titleEl) titleEl.textContent = title || "Booking stock...";
  textEl.textContent = `${pct}%`;
  barEl.style.width = `${pct}%`;

  if (subEl) {
    subEl.textContent = subText || `${safeCurrent} of ${safeTotal} processed`;
  }
}

function hideProgress(delay = 900) {
  window.clearTimeout(window.__scanProgressTimer);
  window.__scanProgressTimer = window.setTimeout(() => {
    const box = byId("scanProgressBox");
    const bar = byId("scanProgressBar");

    if (box) box.style.display = "none";
    if (bar) bar.style.width = "0%";
  }, delay);
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
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

  function parseScan(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    if (raw.includes(":")) {
      const parts = raw.split(":");
      return parts[parts.length - 1].trim();
    }

    return raw;
  }

function parsePackageInfo(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, "");

  const match = compact.match(/(?:^|[-_])(?:pkg|package|colli|box)?(\d{1,2})[\/](\d{1,2})$/i);
  if (!match) return null;

  const packageNo = Number(match[1]);
  const packageTotal = Number(match[2]);

  if (!Number.isInteger(packageNo) || !Number.isInteger(packageTotal)) return null;
  if (packageNo < 1 || packageTotal < 1 || packageNo > packageTotal) return null;

  return {
    package_no: packageNo,
    package_total: packageTotal,
    package_label: `${packageNo}/${packageTotal}`
  };
}

  function ownerName(product) {
    return product?.customers?.name || "—";
  }

  function warehouseLabel(row) {
    return row?.name || row?.code || "—";
  }

  function locationLabel(row) {
    return row?.code || row?.location_code || row?.name || "—";
  }

  function packageProfile(product) {
    const flags = [
      toNumber(product.package_1_qty, 0),
      toNumber(product.package_2_qty, 0),
      toNumber(product.package_3_qty, 0)
    ];

    let total = flags.filter(v => v > 0).length;

    if (!total) {
      total = Math.max(1, Math.round(toNumber(product.packages_per_unit, 1)));
    }

    total = Math.max(1, Math.min(9, total));

    return Array.from({ length: total }, (_, i) => ({
      package_no: i + 1,
      package_total: total,
      package_label: `${i + 1}/${total}`
    }));
  }

  function buildUniqueSku(product, setIndex, packageNo, packageTotal) {
    const sku = String(product.sku_base || "SKU").replace(/[^a-zA-Z0-9_-]/g, "");
    const d = new Date();

    const stamp =
      d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0") +
      String(d.getHours()).padStart(2, "0") +
      String(d.getMinutes()).padStart(2, "0") +
      String(d.getSeconds()).padStart(2, "0");

    return `${sku}-IN-${stamp}-${String(setIndex).padStart(3, "0")}-PKG${packageNo}OF${packageTotal}`;
  }

  function mutationFromItem(product, item) {
    const label = item.package_label || (
      item.package_no && item.package_total
        ? `${item.package_no}/${item.package_total}`
        : "1/1"
    );

    return `${product.sku_base || "SKU"} · Package ${label}`;
  }

  function updateKpis(mode, lastScanText) {
    setText("kpiLinesToday", formatNumber(linesToday));
    setText("kpiUnitsIn", formatNumber(unitsIn));
    setText("kpiUnitsOut", formatNumber(unitsOut));
    setText("kpiMode", mode || "Scan In");
    setText("kpiLastScan", lastScanText || "No scan yet");
  }

  function updateActiveState() {
    setText("activeWarehouseLabel", activeWarehouse ? warehouseLabel(activeWarehouse) : "No warehouse scanned");
    setText("activeLocationLabel", activeLocation ? locationLabel(activeLocation) : "No location scanned");

    const ref = byId("referenceInput")?.value?.trim();
    setText("activeReferenceLabel", ref || "No reference");

    const whSelect = byId("manualWarehouse");
    if (whSelect && activeWarehouse) whSelect.value = activeWarehouse.id;

    renderLocationOptions();

    const locSelect = byId("manualLocation");
    if (locSelect && activeLocation) locSelect.value = activeLocation.id;
  }

  async function logWarehouseEvent(eventInput) {
    if (!window.EventLog?.logWarehouseEvent) return;

    try {
      await window.EventLog.logWarehouseEvent(eventInput);
    } catch (error) {
      console.warn("Event log skipped:", error.message);
    }
  }

  async function loadWarehouses() {
    const cid = await getCompanyId();

    const { data, error } = await ensureClient()
      .from("warehouses")
      .select("*")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) throw error;

    warehouses = data || [];

    const select = byId("manualWarehouse");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">No warehouse selected</option>` +
      warehouses.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(warehouseLabel(w))}</option>`).join("");

    if (current && warehouses.some(w => String(w.id) === String(current))) {
      select.value = current;
    }
  }

  async function loadLocations() {
    const cid = await getCompanyId();

    const { data, error } = await ensureClient()
      .from("warehouse_locations")
      .select("*")
      .eq("company_id", cid)
      .order("code", { ascending: true });

    if (error) throw error;

    locations = data || [];
    renderLocationOptions();
  }

  function renderLocationOptions() {
    const select = byId("manualLocation");
    if (!select) return;

    const current = select.value || "";

    const rows = activeWarehouse
      ? locations.filter(l => String(l.warehouse_id) === String(activeWarehouse.id))
      : locations;

    select.innerHTML =
      `<option value="">No location selected</option>` +
      rows.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(locationLabel(l))}</option>`).join("");

    if (current && rows.some(l => String(l.id) === String(current))) {
      select.value = current;
    }
  }

  async function loadProducts() {
    const cid = await getCompanyId();

    const { data, error } = await ensureClient()
      .from("products")
      .select(`
        *,
        customers (
          id,
          name
        )
      `)
      .eq("company_id", cid)
      .order("sku_base", { ascending: true });

    if (error) throw error;

    products = data || [];

    const owners = new Map();

    products.forEach(p => {
      if (p.customer_id && p.customers?.name) {
        owners.set(String(p.customer_id), {
          id: p.customer_id,
          name: p.customers.name
        });
      }
    });

    productOwners = Array.from(owners.values()).sort((a, b) =>
      String(a.name).localeCompare(String(b.name), "en-GB")
    );

    renderProductOwners();
    renderProducts();
  }

  function renderProductOwners() {
    const select = byId("productOwnerFilter");
    if (!select) return;

    const current = select.value || "";

    select.innerHTML =
      `<option value="">All product owners</option>` +
      productOwners.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join("");

    if (current && productOwners.some(o => String(o.id) === String(current))) {
      select.value = current;
    }
  }

  function filteredProducts() {
    const q = normalize(byId("productSearch")?.value || "");
    const ownerId = byId("productOwnerFilter")?.value || "";

    return products.filter(p => {
      if (ownerId && String(p.customer_id) !== String(ownerId)) return false;

      if (q) {
        const haystack = [
          p.sku_base,
          p.sku,
          p.barcode,
          p.barcode_value,
          p.name,
          p.description,
          ownerName(p)
        ].join(" ").toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }

  function renderProducts() {
    const tbody = byId("productsBody");
    if (!tbody) return;

    const rows = filteredProducts();

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4">No products found.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.slice(0, 150).map(p => {
      const packages = packageProfile(p).map(x => x.package_label).join(" + ");

      return `
        <tr data-sku="${escapeHtml(p.sku_base || "")}">
          <td><strong>${escapeHtml(p.sku_base || "—")}</strong><span class="subline">${escapeHtml(packages)}</span></td>
          <td>${escapeHtml(p.name || "—")}</td>
          <td>${escapeHtml(ownerName(p))}</td>
          <td>${formatNumber(p.volume_m3, 3)}</td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("tr[data-sku]").forEach(row => {
      row.addEventListener("click", () => {
        const sku = row.dataset.sku || "";

        if (byId("manualSku")) byId("manualSku").value = sku;

        if (byId("mainScanInput")) {
          byId("mainScanInput").value = sku;
          byId("mainScanInput").focus();
        }

        if (byId("outboundSku")) byId("outboundSku").value = sku;
      });
    });
  }

  function findWarehouse(scanValue) {
    const code = cleanCode(parseScan(scanValue));

    return warehouses.find(w =>
      cleanCode(w.name) === code ||
      cleanCode(w.code) === code ||
      cleanCode(w.barcode) === code
    ) || null;
  }

  function findLocation(scanValue) {
    const code = cleanCode(parseScan(scanValue));

    const rows = activeWarehouse
      ? locations.filter(l => String(l.warehouse_id) === String(activeWarehouse.id))
      : locations;

    return rows.find(l =>
      cleanCode(l.code) === code ||
      cleanCode(l.location_code) === code ||
      cleanCode(l.name) === code ||
      cleanCode(l.barcode) === code
    ) || null;
  }

  function stripPackageSuffix(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[-_ ]?(?:pkg|package|colli|box)?\d{1,2}[\/\-]\d{1,2}$/i, "");
  }

  function findProduct(scanValue) {
    const raw = parseScan(scanValue);
    const withoutPackage = stripPackageSuffix(raw);
    const code = cleanCode(withoutPackage);
    const ownerId = byId("productOwnerFilter")?.value || "";

    return products.find(p => {
      if (ownerId && String(p.customer_id) !== String(ownerId)) return false;

      const candidates = [
        p.sku_base,
        p.sku,
        p.barcode,
        p.barcode_value,
        p.qr_value,
        p.qr_code_value
      ]
        .filter(Boolean)
        .map(cleanCode)
        .filter(Boolean);

      return candidates.some(c => code === c);
    }) || null;
  }

  async function findOpenSetForPackage(product, packageInfo, reference, excludePhysicalIds = new Set()) {
  const cid = await getCompanyId();

  const { data, error } = await ensureClient()
    .from("items")
    .select(`
      id,
      physical_product_id,
      package_no,
      package_total,
      status,
      inbound_reference,
      created_at,
      stock_set_id
    `)
    .eq("company_id", cid)
    .eq("product_id", product.id)
    .eq("package_total", packageInfo.package_total)
    .eq("status", "in_stock")
    .not("physical_product_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (error) throw error;

  const groups = new Map();

  (data || []).forEach(item => {
    const key = String(item.physical_product_id || "");
    if (!key) return;
    if (excludePhysicalIds.has(key)) return;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  for (const [physicalId, rows] of groups.entries()) {
    const hasSamePackage = rows.some(r =>
      Number(r.package_no) === Number(packageInfo.package_no)
    );

    if (hasSamePackage) continue;

    const total = Number(rows[0]?.package_total || packageInfo.package_total);
    if (rows.length >= total) continue;

    if (reference) {
      const refKey = normalize(reference);
      const sameRef = rows.some(r => normalize(r.inbound_reference || "") === refKey);
      if (!sameRef) continue;
    }

    return physicalId;
  }

  return uuid();
}

  function packageNumbersComplete(rows, packageTotal) {
    const present = new Set(rows.map(r => Number(r.package_no || 1)));

    return Array.from({ length: packageTotal }, (_, i) => i + 1)
      .every(no => present.has(no));
  }

  function rowIsActiveStock(row) {
    return !OUTBOUND_STATUSES.includes(normalize(row?.status));
  }

  async function refreshStockSetStatus(physicalProductId) {
    if (!physicalProductId) return;

    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("items")
      .select(`
        id,
        company_id,
        product_id,
        warehouse_id,
        location_id,
        package_no,
        package_total,
        status,
        physical_product_id,
        stock_set_id,
        products (
          id,
          sku_base,
          volume_m3,
          weight_kg,
          net_weight_kg
        )
      `)
      .eq("company_id", cid)
      .eq("physical_product_id", physicalProductId);

    if (error) throw error;

    const rows = data || [];
    if (!rows.length) return;

    const activeRows = rows.filter(rowIsActiveStock);
    const product = rows[0]?.products || {};
    const productId = rows[0]?.product_id || null;

    if (!productId) throw new Error("Cannot create stock set: product_id is missing.");

    const packageTotal = Math.max(
      1,
      ...rows.map(r => Number(r.package_total || 1))
    );

    const complete = packageNumbersComplete(activeRows, packageTotal);
    const setStatus = complete ? "complete" : "incomplete";
    const allItemIds = rows.map(r => r.id).filter(Boolean);

    if (allItemIds.length) {
      const { error: statusError } = await db
        .from("items")
        .update({ stock_set_status: setStatus })
        .in("id", allItemIds);

      if (statusError) throw statusError;
    }

    if (!complete) return;

    const activeItemIds = activeRows.map(r => r.id).filter(Boolean);
    const packageCount = activeRows.length;
    const existingLinkedId = activeRows.find(r => r.stock_set_id)?.stock_set_id || null;

    let stockSetId = existingLinkedId;

    if (!stockSetId) {
      const { data: existingSet, error: existingError } = await db
        .from("stock_sets")
        .select("id")
        .eq("company_id", cid)
        .eq("physical_product_id", physicalProductId)
        .maybeSingle();

      if (existingError) throw existingError;

      stockSetId = existingSet?.id || null;
    }

const weightKg = activeRows.reduce(
  (sum, row) => sum + toNumber(row.weight_kg, 0),
  0
);

const volumeM3 = activeRows.reduce(
  (sum, row) => sum + toNumber(row.volume_m3, 0),
  0
);

    const warehouseId = activeRows[0]?.warehouse_id || rows[0]?.warehouse_id || null;
    const locationId = activeRows[0]?.location_id || rows[0]?.location_id || null;

    if (!stockSetId) {
      const { count, error: countError } = await db
        .from("stock_sets")
        .select("id", { count: "exact", head: true })
        .eq("company_id", cid)
        .eq("product_id", productId);

      if (countError) throw countError;

      const setCode = `C-${product.sku_base || "SKU"}-${String((count || 0) + 1).padStart(6, "0")}`;

      const { data: insertedSet, error: insertError } = await db
        .from("stock_sets")
        .insert({
          company_id: cid,
          product_id: productId,
          physical_product_id: physicalProductId,
          set_code: setCode,
          status: "complete",
          package_total: packageTotal,
          package_count: packageCount,
          volume_m3: volumeM3,
          weight_kg: weightKg,
          warehouse_id: warehouseId,
          location_id: locationId,
          created_at: nowIso(),
          updated_at: nowIso()
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      if (!insertedSet?.id) throw new Error("Stock set insert succeeded, but no id was returned.");

      stockSetId = insertedSet.id;
    } else {
      const { error: updateSetError } = await db
        .from("stock_sets")
        .update({
          status: "complete",
          package_total: packageTotal,
          package_count: packageCount,
          volume_m3: volumeM3,
          weight_kg: weightKg,
          warehouse_id: warehouseId,
          location_id: locationId,
          updated_at: nowIso()
        })
        .eq("id", stockSetId);

      if (updateSetError) throw updateSetError;
    }

    if (!stockSetId) throw new Error("Stock set id missing after create/update.");

    const { error: linkError } = await db
      .from("items")
      .update({
        stock_set_id: stockSetId,
        stock_set_status: "complete"
      })
      .in("id", activeItemIds);

    if (linkError) throw linkError;
  }

  function buildItemRow({
    cid,
    product,
    physicalId,
    packageInfo,
    setIndex,
    reference,
    inboundDate
  }) {
    const packageTotal = packageInfo.package_total || 1;
    const packageNo = packageInfo.package_no || 1;
    const packageLabel = packageInfo.package_label || `${packageNo}/${packageTotal}`;

    const uniqueSku = buildUniqueSku(
      product,
      setIndex,
      packageNo,
      packageTotal
    );

    let volumePerPackage = 0;
let weightPerPackage = 0;

switch (packageNo) {

  case 1:
    volumePerPackage =
      toNumber(product.package_1_volume_m3, 0) ||
      toNumber(product.volume_m3, 0) / packageTotal;

    weightPerPackage =
      toNumber(product.package_1_weight_kg, 0) ||
      toNumber(product.weight_kg, 0) / packageTotal;
    break;

  case 2:
    volumePerPackage =
      toNumber(product.package_2_volume_m3, 0) ||
      toNumber(product.volume_m3, 0) / packageTotal;

    weightPerPackage =
      toNumber(product.package_2_weight_kg, 0) ||
      toNumber(product.weight_kg, 0) / packageTotal;
    break;

  case 3:
    volumePerPackage =
      toNumber(product.package_3_volume_m3, 0) ||
      toNumber(product.volume_m3, 0) / packageTotal;

    weightPerPackage =
      toNumber(product.package_3_weight_kg, 0) ||
      toNumber(product.weight_kg, 0) / packageTotal;
    break;

  default:
    volumePerPackage =
      toNumber(product.volume_m3, 0) / packageTotal;

    weightPerPackage =
      toNumber(product.weight_kg, 0) / packageTotal;

}

    return {
      company_id: cid,
      product_id: product.id,
      warehouse_id: activeWarehouse.id,
      location_id: activeLocation.id,
      storage_mutation_id: uniqueSku,
      sku_unique: uniqueSku,
      status: "in_stock",
      volume_m3: volumePerPackage,
      weight_kg: weightPerPackage,
      inbound_reference: reference || null,
      inbound_date: inboundDate,
      received_at: inboundDate,
      physical_product_id: physicalId,
      package_no: packageNo,
      package_total: packageTotal,
      package_label: packageLabel,
      stock_set_key: `${product.id}:${physicalId}`,
      stock_set_status: packageTotal === 1 ? "complete" : "incomplete"
    };
  }

 async function bookInboundCompleteProducts(product, qty = 1) {
  if (!activeWarehouse) throw new Error("Scan or select a warehouse first.");
  if (!activeLocation) throw new Error("Scan or select a location first.");

  const cid = await getCompanyId();
  const reference = byId("referenceInput")?.value?.trim() || "";
  const inboundDate = nowIso();
  const count = Math.max(1, Math.round(toNumber(qty, 1)));
  const profile = packageProfile(product);
  const totalPackages = count * profile.length;

  showProgress(
    "Booking stock...",
    0,
    totalPackages,
    `Preparing ${count} product(s) / ${totalPackages} package(s) for ${product.sku_base}`
  );
  await nextFrame();

  const rows = [];
  const physicalIds = [];

  for (let setIndex = 1; setIndex <= count; setIndex++) {
    const physicalId = uuid();
    physicalIds.push(physicalId);

    profile.forEach(pkg => {
      rows.push(buildItemRow({
        cid,
        product,
        physicalId,
        packageInfo: pkg,
        setIndex,
        reference,
        inboundDate
      }));
    });

    showProgress(
      "Preparing stock rows...",
      Math.min(rows.length, totalPackages),
      totalPackages,
      `${rows.length} of ${totalPackages} package row(s) prepared`
    );

    if (setIndex % 5 === 0) await nextFrame();
  }

  showProgress("Saving stock...", 0, totalPackages, "Sending packages to Supabase...");
  await nextFrame();

  const { data, error } = await ensureClient()
    .from("items")
    .insert(rows)
    .select(`
      id,
      sku_unique,
      storage_mutation_id,
      status,
      package_no,
      package_total,
      package_label,
      physical_product_id,
      stock_set_status,
      created_at
    `);

  if (error) {
    hideProgress(0);
    throw error;
  }

  const inserted = data || [];

  for (let i = 0; i < physicalIds.length; i++) {
    showProgress(
      "Finalising stock sets...",
      i + 1,
      physicalIds.length,
      `${i + 1} of ${physicalIds.length} product set(s) checked`
    );

    await refreshStockSetStatus(physicalIds[i]);

    if (i % 3 === 0) await nextFrame();
  }

  inserted.forEach(item => pushInboundHistory(product, item, reference));

  linesToday += 1;
  unitsIn += inserted.length;

  renderInboundHistory();
  updateKpis("Scan In", `${product.sku_base} booked in · ${inserted.length} packages`);

  showProgress(
    "Completed",
    totalPackages,
    totalPackages,
    `${inserted.length} package(s) booked in for ${product.sku_base}`
  );

  showToast(`${count} complete product(s) / ${inserted.length} package(s) booked in for ${product.sku_base}.`, "ok");

  for (const item of inserted) {
    await logWarehouseEvent({
      company_id: cid,
      event_type: "item_received",
      entity_type: "item",
      entity_id: item.id,
      reference_no: item.sku_unique || product.sku_base,
      source_module: "scan-in",
      old_status: null,
      new_status: "in_stock",
      payload: {
        product_id: product.id,
        sku_base: product.sku_base,
        warehouse_id: activeWarehouse.id,
        location_id: activeLocation.id,
        inbound_reference: reference || null,
        physical_product_id: item.physical_product_id,
        package_no: item.package_no,
        package_total: item.package_total,
        package_label: item.package_label
      }
    });
  }

  hideProgress();
}

  async function bookInboundLoosePackage(product, packageInfo, qty = 1) {
  if (!activeWarehouse) throw new Error("Scan or select a warehouse first.");
  if (!activeLocation) throw new Error("Scan or select a location first.");

  const cid = await getCompanyId();
  const reference = byId("referenceInput")?.value?.trim() || "";
  const inboundDate = nowIso();
  const count = Math.max(1, Math.round(toNumber(qty, 1)));

  const rows = [];
  const physicalIds = [];
  const usedPhysicalIds = new Set();

  for (let i = 1; i <= count; i++) {
    const physicalId = await findOpenSetForPackage(
      product,
      packageInfo,
      reference,
      usedPhysicalIds
    );

    usedPhysicalIds.add(String(physicalId));
    physicalIds.push(physicalId);

    rows.push(buildItemRow({
      cid,
      product,
      physicalId,
      packageInfo,
      setIndex: i,
      reference,
      inboundDate
    }));
  }

  const { data, error } = await ensureClient()
    .from("items")
    .insert(rows)
    .select(`
      id,
      sku_unique,
      storage_mutation_id,
      status,
      package_no,
      package_total,
      package_label,
      physical_product_id,
      stock_set_status,
      created_at
    `);

  if (error) throw error;

  const inserted = data || [];
  const uniquePhysicalIds = [...new Set(physicalIds)];

 for (const physicalId of uniquePhysicalIds) {
  try {
    await refreshStockSetStatus(physicalId);
  } catch (error) {
    console.warn("Stock set refresh skipped:", error.message);
  }
}

  inserted.forEach(item => pushInboundHistory(product, item, reference));

  linesToday += 1;
  unitsIn += inserted.length;

  renderInboundHistory();
  updateKpis("Scan In", `${product.sku_base} ${packageInfo.package_label} booked in`);
  showToast(`${inserted.length} package(s) ${packageInfo.package_label} booked in for ${product.sku_base}.`, "ok");

  for (const item of inserted) {
    await logWarehouseEvent({
      company_id: cid,
      event_type: "item_received",
      entity_type: "item",
      entity_id: item.id,
      reference_no: item.sku_unique || product.sku_base,
      source_module: "scan-in",
      old_status: null,
      new_status: "in_stock",
      payload: {
        product_id: product.id,
        sku_base: product.sku_base,
        warehouse_id: activeWarehouse.id,
        location_id: activeLocation.id,
        inbound_reference: reference || null,
        physical_product_id: item.physical_product_id,
        package_no: item.package_no,
        package_total: item.package_total,
        package_label: item.package_label
      }
    });
  }
}

  function pushInboundHistory(product, item, reference) {
    inboundHistory.unshift({
      time: nowTime(),
      warehouse: warehouseLabel(activeWarehouse),
      location: locationLabel(activeLocation),
      sku: product.sku_base,
      product: product.name,
      owner: ownerName(product),
      mutation: mutationFromItem(product, item),
      reference,
      status: item.stock_set_status === "complete" ? "complete package" : "in_stock"
    });

    inboundHistory = inboundHistory.slice(0, 100);
  }

  async function handleInboundScan(rawValue) {
    const value = parseScan(rawValue);
    if (!value) return;

    const warehouse = findWarehouse(value);

    if (warehouse) {
      activeWarehouse = warehouse;
      activeLocation = null;

      updateActiveState();
      updateKpis("Scan In", `Warehouse ${warehouseLabel(warehouse)}`);
      showToast(`Warehouse selected: ${warehouseLabel(warehouse)}. Scan a location next.`, "ok");
      return;
    }

    const location = findLocation(value);

    if (location) {
      if (activeWarehouse && String(location.warehouse_id) !== String(activeWarehouse.id)) {
        throw new Error(`Location ${locationLabel(location)} does not belong to active warehouse ${warehouseLabel(activeWarehouse)}.`);
      }

      activeLocation = location;

      updateActiveState();
      updateKpis("Scan In", `Location ${locationLabel(location)}.`);
      showToast(`Location selected: ${locationLabel(location)}.`, "ok");
      return;
    }

    const product = findProduct(value);

    if (!product) {
      throw new Error(`No warehouse, location or SKU found for scan: ${value}`);
    }

    const pkg = parsePackageInfo(value);

    if (pkg) {
      await bookInboundLoosePackage(product, pkg, byId("manualQty")?.value || 1);
      return;
    }

    await bookInboundCompleteProducts(product, byId("manualQty")?.value || 1);
  }

  function renderInboundHistory() {
    const tbody = byId("inboundHistoryBody");
    if (!tbody) return;

    if (!inboundHistory.length) {
      tbody.innerHTML = `<tr><td colspan="9">No inbound scans yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = inboundHistory.map(row => `
      <tr>
        <td>${escapeHtml(row.time)}</td>
        <td>${escapeHtml(row.warehouse)}</td>
        <td>${escapeHtml(row.location)}</td>
        <td><strong>${escapeHtml(row.sku)}</strong></td>
        <td>${escapeHtml(row.product || "—")}</td>
        <td>${escapeHtml(row.owner || "—")}</td>
        <td>${escapeHtml(row.mutation || "—")}</td>
        <td>${escapeHtml(row.reference || "—")}</td>
        <td><span class="soft-pill green">${escapeHtml(row.status || "in_stock")}</span></td>
      </tr>
    `).join("");
  }

  async function getCompleteAvailableSets(product, qty) {
    const cid = await getCompanyId();
    const profile = packageProfile(product);
    const packageTotal = profile.length;

    const { data, error } = await ensureClient()
      .from("items")
      .select(`
        id,
        sku_unique,
        storage_mutation_id,
        status,
        product_id,
        physical_product_id,
        package_no,
        package_total,
        created_at
      `)
      .eq("company_id", cid)
      .eq("product_id", product.id)
      .eq("status", "in_stock")
      .eq("package_total", packageTotal)
      .not("physical_product_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(1000);

    if (error) throw error;

    const groups = new Map();

    (data || []).forEach(row => {
      const key = String(row.physical_product_id || "");
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    const complete = [];

    for (const [physicalId, rows] of groups.entries()) {
      const present = new Set(rows.map(r => Number(r.package_no || 1)));
      const isComplete = profile.every(pkg => present.has(pkg.package_no));

      if (isComplete) {
        complete.push({ physicalId, rows });
      }
    }

    return complete.slice(0, qty);
  }

  async function bookOutboundManual() {
    const sku = byId("outboundSku")?.value?.trim() || "";
    const qty = Math.max(1, Math.round(toNumber(byId("outboundQty")?.value, 1)));
    const reference = byId("outboundReference")?.value?.trim() || "";

    const product = findProduct(sku);
    if (!product) throw new Error(`SKU ${sku} not found.`);

    const cid = await getCompanyId();
    const completeSets = await getCompleteAvailableSets(product, qty);

    if (completeSets.length < qty) {
      throw new Error(`Only ${completeSets.length} complete product(s) available for ${product.sku_base}. Incomplete/overstock packages are not booked out.`);
    }

    const rows = completeSets.flatMap(set => set.rows);
    const ids = rows.map(r => r.id);
    const outboundDate = nowIso();

    const { error: updateError } = await ensureClient()
      .from("items")
      .update({
        status: OUTBOUND_STATUS,
        shipped_at: outboundDate
      })
      .in("id", ids);

    if (updateError) throw updateError;

    outboundHistory.unshift({
      time: nowTime(),
      sku: product.sku_base,
      product: product.name,
      qty: rows.length,
      reference,
      status: `${qty} complete product(s) / ${rows.length} packages`
    });

    outboundHistory = outboundHistory.slice(0, 100);

    linesToday += 1;
    unitsOut += rows.length;

    renderOutboundHistory();
    updateKpis("Scan Out", `${product.sku_base} booked out`);
    showToast(`${qty} complete product(s) / ${rows.length} package(s) booked out for ${product.sku_base}.`, "ok");

    for (const item of rows) {
      await logWarehouseEvent({
        company_id: cid,
        event_type: "item_manual_outbound",
        entity_type: "item",
        entity_id: item.id,
        reference_no: item.sku_unique || product.sku_base,
        source_module: "scan-out",
        old_status: "in_stock",
        new_status: OUTBOUND_STATUS,
        payload: {
          product_id: product.id,
          sku_base: product.sku_base,
          outbound_reference: reference || null,
          physical_product_id: item.physical_product_id,
          package_no: item.package_no,
          package_total: item.package_total
        }
      });
    }
  }

  function renderOutboundHistory() {
    const tbody = byId("outboundHistoryBody");
    if (!tbody) return;

    if (!outboundHistory.length) {
      tbody.innerHTML = `<tr><td colspan="6">No outbound scans yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = outboundHistory.map(row => `
      <tr>
        <td>${escapeHtml(row.time)}</td>
        <td><strong>${escapeHtml(row.sku)}</strong></td>
        <td>${escapeHtml(row.product || "—")}</td>
        <td>${escapeHtml(row.qty || 1)}</td>
        <td>${escapeHtml(row.reference || "—")}</td>
        <td><span class="soft-pill orange">${escapeHtml(row.status || OUTBOUND_STATUS)}</span></td>
      </tr>
    `).join("");
  }

  function renderPicklistsPlaceholder() {
    const tbody = byId("picklistsBody");
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            Picklists are ready for the next step. Matching must reserve complete physical products only, then pick/load all linked packages.
          </div>
        </td>
      </tr>
    `;
  }

  function switchTab(panelId) {
    document.querySelectorAll(".scan-tab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.scanTab === panelId);
    });

    document.querySelectorAll(".tab-panel").forEach(panel => {
      panel.classList.toggle("active", panel.id === panelId);
    });

    if (panelId === "scanInPanel") {
      updateKpis("Scan In", byId("kpiLastScan")?.textContent || "No scan yet");
      setTimeout(() => byId("mainScanInput")?.focus(), 50);
    }

    if (panelId === "scanOutPanel") {
      updateKpis("Scan Out", byId("kpiLastScan")?.textContent || "No scan yet");
      setTimeout(() => byId("outboundSku")?.focus(), 50);
    }

    if (panelId === "picklistsPanel") {
      updateKpis("Picklists", byId("kpiLastScan")?.textContent || "No scan yet");
      renderPicklistsPlaceholder();
    }
  }

  function clearInboundState() {
    activeWarehouse = null;
    activeLocation = null;

    if (byId("manualWarehouse")) byId("manualWarehouse").value = "";
    if (byId("manualLocation")) byId("manualLocation").value = "";

    updateActiveState();
    byId("mainScanInput")?.focus();
  }

  function bindEvents() {
    document.querySelectorAll("[data-scan-tab]").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.scanTab));
    });

    byId("mainScanInput")?.addEventListener("keydown", async event => {
      if (event.key !== "Enter") return;
      event.preventDefault();

      try {
        const value = byId("mainScanInput").value;
        await handleInboundScan(value);
        byId("mainScanInput").value = "";
        byId("mainScanInput").focus();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Scan failed.", "err");
        byId("mainScanInput").select();
      }
    });

   byId("btnBookInManual")?.addEventListener("click", async () => {
  try {
    const value = byId("mainScanInput")?.value || "";

    await handleInboundScan(value);

    byId("mainScanInput").value = "";
    byId("mainScanInput").focus();

  } catch (error) {
    console.error(error);
    showToast(error.message || "Manual book-in failed.", "err");
  }
});

    byId("manualWarehouse")?.addEventListener("change", () => {
      const id = byId("manualWarehouse").value || "";
      activeWarehouse = warehouses.find(w => String(w.id) === String(id)) || null;
      activeLocation = null;
      updateActiveState();
    });

    byId("manualLocation")?.addEventListener("change", () => {
      const id = byId("manualLocation").value || "";
      activeLocation = locations.find(l => String(l.id) === String(id)) || null;
      updateActiveState();
    });

    byId("referenceInput")?.addEventListener("input", updateActiveState);

    byId("btnClearInboundState")?.addEventListener("click", clearInboundState);

    byId("btnRefreshScanData")?.addEventListener("click", async () => {
      try {
        await loadAllData();
        showToast("Scan data refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Refresh failed.", "err");
      }
    });

    byId("productSearch")?.addEventListener("input", renderProducts);
    byId("productOwnerFilter")?.addEventListener("change", renderProducts);

    byId("btnBookOutManual")?.addEventListener("click", async () => {
      try {
        await bookOutboundManual();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Manual outbound failed.", "err");
      }
    });

    byId("btnClearOutbound")?.addEventListener("click", () => {
      if (byId("outboundSku")) byId("outboundSku").value = "";
      if (byId("outboundQty")) byId("outboundQty").value = "1";
      if (byId("outboundReference")) byId("outboundReference").value = "";
      byId("outboundSku")?.focus();
    });

    byId("outboundSku")?.addEventListener("keydown", async event => {
      if (event.key !== "Enter") return;
      event.preventDefault();

      try {
        await bookOutboundManual();
        byId("outboundSku").value = "";
        byId("outboundQty").value = "1";
        byId("outboundSku").focus();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Manual outbound failed.", "err");
      }
    });

    byId("btnRefreshPicklists")?.addEventListener("click", renderPicklistsPlaceholder);
  }

  async function loadAllData() {
    await getCompanyId();

    await Promise.all([
      loadWarehouses(),
      loadLocations(),
      loadProducts()
    ]);

    updateActiveState();
    renderPicklistsPlaceholder();
  }

  async function init() {
    try {
      ensureClient();
      bindEvents();
      await loadAllData();
      updateKpis("Scan In", "No scan yet");
      byId("mainScanInput")?.focus();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Scan page failed to load.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();