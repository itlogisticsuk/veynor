(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const DEFAULT_PRODUCT_OWNER = "Bellstone";
  const OWNER_PROFILES_KEY = "product_owner_profiles";

  const SMALL_LABEL_W_MM = 89;
  const SMALL_LABEL_H_MM = 36;

  let client = null;
  let companyId = null;

  let customers = [];
  let allCustomers = [];
  let ownerProfiles = [];
  let importOwnerOptions = [];
  let allProducts = [];
  let filteredProducts = [];
  let selectedImportFile = null;
  let productColumns = new Set();

  let selectedLabelProduct = null;
  let generatedLabelNodes = [];

  const DEFAULT_OWNER_NAMES = ["bellstone", "zoy", "zoe"];

  const OPTIONAL_FIELDS = [
    "category",
    "barcode_value",
    "qr_value",
    "length_cm",
    "width_cm",
    "height_cm",
    "default_location_prefix",
    "storage_tariff",
    "transport_tariff",
    "handling_tariff",
    "admin_tariff",
    "net_weight_kg",
    "packages_per_unit",
    "package_count",
   "package_1_qty",
"package_2_qty",
"package_3_qty",
"package_1_weight_kg",
"package_2_weight_kg",
"package_3_weight_kg",
"package_1_volume_m3",
"package_2_volume_m3",
"package_3_volume_m3",
"total_s2u_fees",
    "total_customer_charge",
    "is_active"
  ];

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

  function compactKey(value) {
    return normalize(value).replace(/[^a-z0-9]/g, "");
  }

  function toNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;

    const text = String(value)
      .replace(/£/g, "")
      .replace(/,/g, ".")
      .replace(/\s/g, "")
      .trim();

    if (!text) return fallback;

    const num = Number(text);
    return Number.isFinite(num) ? num : fallback;
  }

  function toInteger(value, fallback = 0) {
    const num = Math.round(toNumber(value, fallback));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
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
    return `£${formatNumber(value, 2)}`;
  }

  function todayUk() {
    return new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = `notice ${type}`;

    window.clearTimeout(window.__productsToastTimer);
    window.__productsToastTimer = window.setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 9000);
  }

  function ensureClient() {
    if (client) return client;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
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

  function productHasColumn(column) {
    return productColumns.has(column);
  }

  function getProductValue(row, field, fallback = "") {
    return row && Object.prototype.hasOwnProperty.call(row, field) ? row[field] : fallback;
  }

  function getOwnerName(row) {
    return row?.customers?.name || row?.customer_name || "—";
  }

  function extractBrandFromDescription(description) {
    const text = String(description || "");
    const match = text.match(/Brand\/range:\s*([^|]+)/i);
    return match ? match[1].trim() : "";
  }

  function getBrand(row) {
    return getProductValue(row, "category", "") || extractBrandFromDescription(row?.description);
  }

  function calculatePackageCountFromParts(package1, package2, package3) {
    const p1 = toInteger(package1, 0);
    const p2 = toInteger(package2, 0);
    const p3 = toInteger(package3, 0);

    let count = 0;
    if (p1 > 0) count += 1;
    if (p2 > 0) count += 1;
    if (p3 > 0) count += 1;

    return count || 1;
  }

  function getPackagesPerUnit(row) {
    const p1 = toInteger(getProductValue(row, "package_1_qty", 0), 0);
    const p2 = toInteger(getProductValue(row, "package_2_qty", 0), 0);
    const p3 = toInteger(getProductValue(row, "package_3_qty", 0), 0);

    const derivedFromParts = [p1, p2, p3].filter(v => v > 0).length;
    if (derivedFromParts > 0) return derivedFromParts;

    const packagesPerUnit = toInteger(getProductValue(row, "packages_per_unit", 0), 0);
    if (packagesPerUnit > 0) return packagesPerUnit;

    const packageCount = toInteger(getProductValue(row, "package_count", 0), 0);
    if (packageCount > 0) return packageCount;

    return 1;
  }

  function getPackageBreakdown(row) {
    const p1 = toInteger(getProductValue(row, "package_1_qty", 0), 0);
    const p2 = toInteger(getProductValue(row, "package_2_qty", 0), 0);
    const p3 = toInteger(getProductValue(row, "package_3_qty", 0), 0);

    if (p1 || p2 || p3) return `${formatNumber(p1)} / ${formatNumber(p2)} / ${formatNumber(p3)}`;

    const packages = getPackagesPerUnit(row);
    if (packages <= 1) return "1 / 0 / 0";
    if (packages === 2) return "1 / 1 / 0";
    return "1 / 1 / 1";
  }

  function getPackageLabel(row, packageNo) {
    const total = getPackagesPerUnit(row);
    const no = Math.min(Math.max(1, Number(packageNo || 1)), total);
    return `${no}/${total}`;
  }

  function makePackageBarcode(row, packageNo) {
    const sku = row?.sku_base || "SKU";
    return `${sku}-${getPackageLabel(row, packageNo)}`;
  }

function productHasTariff(row) {
  const ownerName = normalize(getOwnerName(row));
  const isZoyProduct = ownerName.includes("zoy") || normalize(getBrand(row)).includes("zoy");

  if (isZoyProduct) {
    return (
      toNumber(getProductValue(row, "storage_tariff", 0), 0) > 0 &&
      toNumber(getProductValue(row, "transport_tariff", 0), 0) > 0
    );
  }

  return (
    toNumber(getProductValue(row, "storage_tariff", 0), 0) > 0 &&
    toNumber(getProductValue(row, "admin_tariff", 0), 0) > 0 &&
    toNumber(getProductValue(row, "handling_tariff", 0), 0) > 0 &&
    toNumber(getProductValue(row, "transport_tariff", 0), 0) > 0
  );
}

function getMissingProductInfo(row) {
  const missing = [];
  const ownerName = normalize(getOwnerName(row));
  const isZoyProduct = ownerName.includes("zoy") || normalize(getBrand(row)).includes("zoy");

  if (!row?.sku_base) missing.push("SKU");
  if (!row?.name) missing.push("name");
  if (toNumber(row?.volume_m3, 0) <= 0) missing.push("volume");
  if (toNumber(row?.weight_kg, 0) <= 0) missing.push("gross weight");
  if (toNumber(getProductValue(row, "net_weight_kg", 0), 0) <= 0) missing.push("net weight");

  if (toNumber(getProductValue(row, "storage_tariff", 0), 0) <= 0) missing.push("storage");
  if (!isZoyProduct && toNumber(getProductValue(row, "admin_tariff", 0), 0) <= 0) missing.push("admin");
  if (!isZoyProduct && toNumber(getProductValue(row, "handling_tariff", 0), 0) <= 0) missing.push("pick");
  if (toNumber(getProductValue(row, "transport_tariff", 0), 0) <= 0) missing.push("transport");

  return missing;
}

  function productIsComplete(row) {
    return getMissingProductInfo(row).length === 0;
  }

  function productStatusBadge(row) {
    const missing = getMissingProductInfo(row);

    if (!missing.length) {
      return `<span class="soft-badge" style="background:#ecfdf5;border-color:#bbf7d0;color:#047857;">Complete</span>`;
    }

    return `
      <span class="soft-badge" title="Missing: ${escapeHtml(missing.join(", "))}" style="background:#fff7ed;border-color:#fed7aa;color:#c2410c;">
        ⚠ Missing info
      </span>
      <span class="subline">${escapeHtml(missing.slice(0, 3).join(", "))}${missing.length > 3 ? "..." : ""}</span>
    `;
  }

  function getDefaultOwnerCustomerId() {
    const direct = customers.find(c => normalize(c.name).includes(normalize(DEFAULT_PRODUCT_OWNER)));
    if (direct?.id) return direct.id;
    return customers[0]?.id || "";
  }

  async function loadOwnerProfiles() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data } = await db
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", cid)
      .eq("setting_key", OWNER_PROFILES_KEY)
      .maybeSingle();

    try {
      const parsed = JSON.parse(data?.setting_value || "[]");
      ownerProfiles = Array.isArray(parsed) ? parsed : [];
    } catch {
      ownerProfiles = [];
    }
  }

  function ownerProfileName(profile) {
    return (
      profile?.name ||
      profile?.trading_name ||
      profile?.default_source_name ||
      profile?.customer_code ||
      ""
    ).trim();
  }

  function customerMatchesOwnerProfile(customer, profile) {
    const customerName = compactKey(customer?.name || "");
    const customerCode = compactKey(customer?.customer_code || "");

    const keys = [
      profile?.name,
      profile?.trading_name,
      profile?.customer_code,
      profile?.default_source_name
    ].map(compactKey).filter(Boolean);

    if (!customerName && !customerCode) return false;

    return keys.some(key =>
      key === customerName ||
      key === customerCode ||
      customerName.includes(key) ||
      key.includes(customerName)
    );
  }

  function customerLooksLikeProductOwner(customer) {
    if (customer?.customer_type === "product_owner") return true;

    const name = normalize(customer?.name || "");
    if (!name) return false;

    if (DEFAULT_OWNER_NAMES.some(owner => name.includes(owner))) return true;

    return ownerProfiles.some(profile => customerMatchesOwnerProfile(customer, profile));
  }

  function buildImportOwnerOptions() {
    const options = [];
    const usedKeys = new Set();

    customers.forEach(customer => {
      const key = compactKey(customer.name || customer.id);
      if (usedKeys.has(key)) return;

      options.push({
        type: "customer",
        value: `customer:${customer.id}`,
        customerId: customer.id,
        label: customer.name,
        name: customer.name
      });

      usedKeys.add(key);
    });

    ownerProfiles.forEach(profile => {
      const name = ownerProfileName(profile);
      if (!name) return;

      const key = compactKey(name);
      if (usedKeys.has(key)) return;

      const matchingCustomer = allCustomers.find(customer => customerMatchesOwnerProfile(customer, profile));

      options.push({
        type: matchingCustomer?.id ? "customer" : "profile",
        value: matchingCustomer?.id ? `customer:${matchingCustomer.id}` : `profile:${key}`,
        customerId: matchingCustomer?.id || "",
        label: name,
        name
      });

      usedKeys.add(key);
    });

    importOwnerOptions = options.sort((a, b) => a.label.localeCompare(b.label));
  }

  async function loadCustomers() {
    const db = ensureClient();
    const cid = await getCompanyId();

    await loadOwnerProfiles();

    const { data, error } = await db
      .from("customers")
      .select("id, name, customer_type, customer_code")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) throw error;

    allCustomers = data || [];

    customers = allCustomers.filter(customerLooksLikeProductOwner);

    if (!customers.length) {
      customers = allCustomers.filter(c =>
        DEFAULT_OWNER_NAMES.some(owner => normalize(c.name).includes(owner))
      );
    }

    buildImportOwnerOptions();
    renderCustomerSelects();
  }

  function renderCustomerSelects() {
    const formSelect = byId("productCustomer");
    const filterSelect = byId("filterProductCustomer");
    const importSelect = byId("productsImportOwner");

    if (formSelect) {
      const current = formSelect.value || "";
      formSelect.innerHTML =
        `<option value="">Select product owner</option>` +
        customers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");

      formSelect.value = current && customers.some(c => String(c.id) === String(current))
        ? current
        : getDefaultOwnerCustomerId();
    }

    if (filterSelect) {
      const current = filterSelect.value || "";
      filterSelect.innerHTML =
        `<option value="">All product owners</option>` +
        customers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");

      if (current && customers.some(c => String(c.id) === String(current))) {
        filterSelect.value = current;
      }
filterSelect.addEventListener("change", applyFilters);
    }

    if (importSelect) {
      const current = importSelect.value || "";
importSelect.innerHTML =
  `<option value="">All product owners</option>` +
        importOwnerOptions.map(owner => `
          <option value="${escapeHtml(owner.value)}">${escapeHtml(owner.label)}</option>
        `).join("");

      if (current && importOwnerOptions.some(o => o.value === current)) {
        importSelect.value = current;
      } else {
        const bellstone = importOwnerOptions.find(o => normalize(o.label).includes("bellstone"));
        importSelect.value = bellstone?.value || importOwnerOptions[0]?.value || "";
      }
    }
  }

  async function ensureImportOwnerCustomerId() {
    const select = byId("productsImportOwner");
    const selected = select?.value || "";

    if (!selected) throw new Error("Select a Product Owner before importing.");

    if (selected.startsWith("customer:")) {
      const id = selected.replace("customer:", "");
      if (!id) throw new Error("Selected Product Owner has no customer record.");
      return id;
    }

    const option = importOwnerOptions.find(o => o.value === selected);
    const ownerName = option?.name || option?.label || "";

    if (!ownerName) throw new Error("Selected Product Owner could not be resolved.");

    const existing = allCustomers.find(c =>
      compactKey(c.name) === compactKey(ownerName) ||
      compactKey(ownerName).includes(compactKey(c.name)) ||
      compactKey(c.name).includes(compactKey(ownerName))
    );

    if (existing?.id) return existing.id;

    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("customers")
      .insert({
        company_id: cid,
        name: ownerName,
        customer_type: "product_owner"
      })
      .select("id, name, customer_type, customer_code")
      .single();

    if (error) throw error;
    if (!data?.id) throw new Error("Could not create Product Owner customer record.");

    allCustomers.push(data);
    customers.push(data);
    buildImportOwnerOptions();
    renderCustomerSelects();

    return data.id;
  }

  async function loadProducts() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
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

    allProducts = data || [];

    productColumns = new Set([
      "id",
      "company_id",
      "customer_id",
      "sku_base",
      "name",
      "description",
      "volume_m3",
      "weight_kg",
      ...OPTIONAL_FIELDS
    ]);

    allProducts.forEach(row => {
      Object.keys(row || {}).forEach(key => {
        if (key !== "customers") productColumns.add(key);
      });
    });

    renderCategoryFilter();
    applyFilters();
  }

  function renderCategoryFilter() {
    const select = byId("filterProductCategory");
    if (!select) return;

    const current = select.value || "";
    const brands = [...new Set(allProducts.map(getBrand).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    select.innerHTML =
      `<option value="">All brands / ranges</option>` +
      brands.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

    if (current) select.value = current;
  }

  function applyFilters() {
    const q = normalize(byId("productSearch")?.value || "");
    const ownerId = byId("filterProductCustomer")?.value || "";
    const brand = normalize(byId("filterProductCategory")?.value || "");
    const completeness = byId("filterProductCompleteness")?.value || "";

    filteredProducts = allProducts.filter(row => {
      if (ownerId && String(row.customer_id) !== String(ownerId)) return false;
      if (brand && normalize(getBrand(row)) !== brand) return false;

      const volume = toNumber(row.volume_m3, 0);
      const weight = toNumber(row.weight_kg, 0);
      const hasTariff = productHasTariff(row);
      const missing = getMissingProductInfo(row);

      if (completeness === "complete" && missing.length > 0) return false;
      if (completeness === "incomplete" && missing.length === 0) return false;
      if (completeness === "missing_volume" && volume > 0) return false;
      if (completeness === "missing_weight" && weight > 0) return false;
      if (completeness === "with_tariff" && !hasTariff) return false;
      if (completeness === "missing_tariff" && hasTariff) return false;

      if (q) {
        const haystack = [
          row.sku_base,
          row.name,
          row.description,
          getBrand(row),
          getProductValue(row, "barcode_value", ""),
          getProductValue(row, "qr_value", ""),
          getOwnerName(row),
          missing.join(" ")
        ].join(" ").toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    renderAll();
  }

  function renderKpis() {
    const total = allProducts.length;
    const withVolume = allProducts.filter(p => toNumber(p.volume_m3, 0) > 0).length;
    const missingVolume = allProducts.filter(p => toNumber(p.volume_m3, 0) <= 0).length;
    const withTariffs = allProducts.filter(productHasTariff).length;

    const avgVolume = total
      ? allProducts.reduce((sum, p) => sum + toNumber(p.volume_m3, 0), 0) / total
      : 0;

    const avgCharge = total
      ? allProducts.reduce((sum, p) => {
          return sum + toNumber(getProductValue(p, "total_customer_charge", 0), 0);
        }, 0) / total
      : 0;

    if (byId("kpiProductsTotal")) byId("kpiProductsTotal").textContent = formatNumber(total);
    if (byId("kpiProductsVolume")) byId("kpiProductsVolume").textContent = formatNumber(withVolume);
    if (byId("kpiProductsMissingVolume")) byId("kpiProductsMissingVolume").textContent = formatNumber(missingVolume);
    if (byId("kpiProductsTariffs")) byId("kpiProductsTariffs").textContent = formatNumber(withTariffs);
    if (byId("kpiProductsAvgVolume")) byId("kpiProductsAvgVolume").textContent = formatNumber(avgVolume, 3);
    if (byId("kpiProductsAvgCharge")) byId("kpiProductsAvgCharge").textContent = formatMoney(avgCharge);
  }

  function renderProductsTable() {
    const tbody = byId("productsTableBody");
    if (!tbody) return;

    if (!filteredProducts.length) {
      tbody.innerHTML = `<tr><td colspan="16">No products found.</td></tr>`;
      if (byId("productsResultsMeta")) byId("productsResultsMeta").textContent = "0 products shown";
      return;
    }

    tbody.innerHTML = filteredProducts.map(row => {
      const sku = row.sku_base || "—";
      const barcode = getProductValue(row, "barcode_value", "") || sku;
      const packagesPerUnit = getPackagesPerUnit(row);
      const breakdown = getPackageBreakdown(row);

      return `
        <tr data-product-id="${escapeHtml(row.id)}">
          <td>
            <span class="sku-cell">${escapeHtml(sku)}</span>
            <span class="subline">${escapeHtml(row.id || "")}</span>
          </td>
          <td>
            <strong>${escapeHtml(row.name || "—")}</strong>
            <span class="subline">${escapeHtml(row.description || "")}</span>
          </td>
          <td>${escapeHtml(getOwnerName(row))}</td>
          <td>${productStatusBadge(row)}</td>
          <td><span class="soft-badge">${escapeHtml(getBrand(row) || "General")}</span></td>
          <td>${formatNumber(row.volume_m3, 3)}</td>
          <td>${formatNumber(getProductValue(row, "net_weight_kg", 0), 1)}</td>
          <td>${formatNumber(row.weight_kg, 1)}</td>
          <td>${formatMoney(getProductValue(row, "storage_tariff", 0))}</td>
          <td>${formatMoney(getProductValue(row, "admin_tariff", 0))}</td>
          <td>${formatMoney(getProductValue(row, "handling_tariff", 0))}</td>
          <td>${formatMoney(getProductValue(row, "transport_tariff", 0))}</td>
          <td>${formatMoney(getProductValue(row, "total_customer_charge", 0))}</td>
          <td>
            <strong>${formatNumber(packagesPerUnit)}</strong>
            <span class="subline">${escapeHtml(breakdown)}</span>
          </td>
          <td>${escapeHtml(barcode)}</td>
          <td>
            <div class="quick-actions">
              <button class="mini-btn" type="button" data-action="edit" data-product-id="${escapeHtml(row.id)}">Edit</button>
              <button class="mini-btn primary" type="button" data-action="stock-label" data-product-id="${escapeHtml(row.id)}">Stock Label</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("[data-action='edit']").forEach(btn => {
      btn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const row = allProducts.find(
          p => String(p.id) === String(btn.dataset.productId)
        );

        if (!row) {
          showToast("Product not found.", "err");
          return;
        }

        fillForm(row);

        byId("productModalTitle").textContent = "Edit Product";
        byId("productModal").classList.add("open");
      });
    });

    tbody.querySelectorAll("[data-action='stock-label']").forEach(btn => {
      btn.addEventListener("click", event => {
        event.stopPropagation();
        const row = allProducts.find(p => String(p.id) === String(btn.dataset.productId));
        if (row) openStockLabelModal(row);
      });
    });

    tbody.querySelectorAll("tr[data-product-id]").forEach(tr => {
      tr.addEventListener("click", () => {
        const row = allProducts.find(p => String(p.id) === String(tr.datasetProductId));
        if (row) fillForm(row);
      });
    });

    if (byId("productsResultsMeta")) {
      byId("productsResultsMeta").textContent = `${formatNumber(filteredProducts.length)} products shown`;
    }
  }

  function getFormData() {
    const package1 = toInteger(byId("package1Qty")?.value, 0);
    const package2 = toInteger(byId("package2Qty")?.value, 0);
    const package3 = toInteger(byId("package3Qty")?.value, 0);

    const derivedPackages = calculatePackageCountFromParts(package1, package2, package3);
    const manualPackages = byId("productPackagesPerUnit")
      ? toInteger(byId("productPackagesPerUnit")?.value, derivedPackages)
      : derivedPackages;

    return {
      customer_id: byId("productCustomer")?.value || "",
      sku_base: String(byId("productSku")?.value || "").trim(),
      name: String(byId("productName")?.value || "").trim(),
      category: String(byId("productCategory")?.value || "").trim(),
      barcode_value: String(byId("productBarcode")?.value || "").trim(),
      qr_value: String(byId("productQr")?.value || "").trim(),
      description: String(byId("productDescription")?.value || "").trim(),
      volume_m3: toNumber(byId("productVolume")?.value, 0),
      net_weight_kg: toNumber(byId("productNetWeight")?.value, 0),
      weight_kg: toNumber(byId("productWeight")?.value, 0),
      default_location_prefix: String(byId("productLocationPrefix")?.value || "").trim(),
      storage_tariff: toNumber(byId("tariffStorage")?.value, 0),
      admin_tariff: toNumber(byId("tariffAdmin")?.value, 0),
      handling_tariff: toNumber(byId("tariffHandling")?.value, 0),
      transport_tariff: toNumber(byId("tariffTransport")?.value, 0),
      total_customer_charge: toNumber(byId("totalCustomerCharge")?.value, 0),
      packages_per_unit: Math.max(1, manualPackages || 1),
      package_count: Math.max(1, manualPackages || derivedPackages || 1),
      package_1_qty: package1,
      package_2_qty: package2,
      package_3_qty: package3
    };
  }

  function validateForm(data) {
    if (!data.customer_id) throw new Error("Select Bellstone, Zoy or another product owner.");
    if (!data.sku_base) throw new Error("SKU is required.");
    if (!data.name) throw new Error("Product name is required.");
    if (data.packages_per_unit < 1) throw new Error("Packages per unit must be at least 1.");
  }

  function buildDbPayload(data, cid) {
    const totalS2uFees =
      toNumber(data.storage_tariff, 0) +
      toNumber(data.admin_tariff, 0) +
      toNumber(data.handling_tariff, 0);

    const payload = {
      company_id: cid,
      customer_id: data.customer_id,
      sku_base: data.sku_base,
      name: data.name,
      description: data.description || null,
      volume_m3: data.volume_m3 || 0,
      weight_kg: data.weight_kg || 0
    };

    OPTIONAL_FIELDS.forEach(field => {
      if (!productHasColumn(field)) return;

      if (field === "category") payload[field] = data.category || null;
      if (field === "barcode_value") payload[field] = data.barcode_value || data.sku_base;
      if (field === "qr_value") payload[field] = data.qr_value || data.sku_base;
      if (field === "default_location_prefix") payload[field] = data.default_location_prefix || null;
      if (field === "storage_tariff") payload[field] = data.storage_tariff || 0;
      if (field === "admin_tariff") payload[field] = data.admin_tariff || 0;
      if (field === "handling_tariff") payload[field] = data.handling_tariff || 0;
      if (field === "transport_tariff") payload[field] = data.transport_tariff || 0;
      if (field === "net_weight_kg") payload[field] = data.net_weight_kg || 0;

      if (field === "packages_per_unit") payload[field] = data.packages_per_unit || 1;
      if (field === "package_count") payload[field] = data.package_count || data.packages_per_unit || 1;
     if (field === "package_1_qty") payload[field] = data.package_1_qty || 0;
if (field === "package_2_qty") payload[field] = data.package_2_qty || 0;
if (field === "package_3_qty") payload[field] = data.package_3_qty || 0;

if (field === "package_1_weight_kg") payload[field] = data.package_1_weight_kg || 0;
if (field === "package_2_weight_kg") payload[field] = data.package_2_weight_kg || 0;
if (field === "package_3_weight_kg") payload[field] = data.package_3_weight_kg || 0;

if (field === "package_1_volume_m3") payload[field] = data.package_1_volume_m3 || 0;
if (field === "package_2_volume_m3") payload[field] = data.package_2_volume_m3 || 0;
if (field === "package_3_volume_m3") payload[field] = data.package_3_volume_m3 || 0;

if (field === "total_s2u_fees") payload[field] = totalS2uFees;
      if (field === "total_customer_charge") payload[field] = data.total_customer_charge || 0;
      if (field === "is_active") payload[field] = true;
    });

    return payload;
  }

  async function saveProduct() {
    const db = ensureClient();
    const cid = await getCompanyId();
    const data = getFormData();

    validateForm(data);

    const payload = buildDbPayload(data, cid);

    const { data: existing, error: existingError } = await db
      .from("products")
      .select("id")
      .eq("company_id", cid)
      .eq("sku_base", data.sku_base)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing?.id) {
      const { error } = await db.from("products").update(payload).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("products").insert(payload);
      if (error) throw error;
    }

    showToast("Product saved.", "ok");
    clearForm();
    await loadProducts();
  }

  function fillForm(row) {
    if (!row) return;

    if (byId("productCustomer")) byId("productCustomer").value = row.customer_id || getDefaultOwnerCustomerId();
    if (byId("productSku")) byId("productSku").value = row.sku_base || "";
    if (byId("productName")) byId("productName").value = row.name || "";
    if (byId("productCategory")) byId("productCategory").value = getBrand(row) || "";
    if (byId("productBarcode")) byId("productBarcode").value = getProductValue(row, "barcode_value", "") || row.sku_base || "";
    if (byId("productQr")) byId("productQr").value = getProductValue(row, "qr_value", "") || row.sku_base || "";
    if (byId("productDescription")) byId("productDescription").value = row.description || "";
    if (byId("productVolume")) byId("productVolume").value = row.volume_m3 ?? "";
    if (byId("productNetWeight")) byId("productNetWeight").value = getProductValue(row, "net_weight_kg", "") ?? "";
    if (byId("productWeight")) byId("productWeight").value = row.weight_kg ?? "";
    if (byId("productLocationPrefix")) byId("productLocationPrefix").value = getProductValue(row, "default_location_prefix", "") || "";
    if (byId("tariffStorage")) byId("tariffStorage").value = getProductValue(row, "storage_tariff", "") ?? "";
    if (byId("tariffAdmin")) byId("tariffAdmin").value = getProductValue(row, "admin_tariff", "") ?? "";
    if (byId("tariffHandling")) byId("tariffHandling").value = getProductValue(row, "handling_tariff", "") ?? "";
    if (byId("tariffTransport")) byId("tariffTransport").value = getProductValue(row, "transport_tariff", "") ?? "";
    if (byId("totalCustomerCharge")) byId("totalCustomerCharge").value = getProductValue(row, "total_customer_charge", "") ?? "";

    if (byId("productPackagesPerUnit")) byId("productPackagesPerUnit").value = getPackagesPerUnit(row);
    if (byId("package1Qty")) byId("package1Qty").value = getProductValue(row, "package_1_qty", "") ?? "";
    if (byId("package2Qty")) byId("package2Qty").value = getProductValue(row, "package_2_qty", "") ?? "";
    if (byId("package3Qty")) byId("package3Qty").value = getProductValue(row, "package_3_qty", "") ?? "";
  }

  function clearForm() {
    [
      "productSku",
      "productName",
      "productCategory",
      "productBarcode",
      "productQr",
      "productDescription",
      "productVolume",
      "productNetWeight",
      "productWeight",
      "productLocationPrefix",
      "tariffStorage",
      "tariffAdmin",
      "tariffTransport",
      "tariffHandling",
      "totalCustomerCharge",
      "productPackagesPerUnit",
      "package1Qty",
      "package2Qty",
      "package3Qty"
    ].forEach(id => {
      const el = byId(id);
      if (el) el.value = "";
    });

    if (byId("productCustomer")) byId("productCustomer").value = getDefaultOwnerCustomerId();
  }

  function openStockLabelModal(row) {
    selectedLabelProduct = row;
    generatedLabelNodes = [];

    const modal = byId("stockLabelModal");
    const preview = byId("stockLabelPreviewArea");

    if (preview) preview.innerHTML = "";
    if (byId("btnDownloadStockLabelPdf")) byId("btnDownloadStockLabelPdf").disabled = true;

    renderStockModalProduct(row);
    renderPackageSelect(row);
    updateStockModalBarcode(row);

    if (modal) modal.classList.add("open");

    generateStockLabels();
  }

  function closeStockLabelModal() {
    byId("stockLabelModal")?.classList.remove("open");
  }

  function renderStockModalProduct(row) {
    const productName = row?.name || "Product";
    const sku = row?.sku_base || "SKU";
    const owner = getOwnerName(row);
    const packages = getPackagesPerUnit(row);

    if (byId("stockModalProductName")) byId("stockModalProductName").textContent = productName;
    if (byId("stockModalProductSub")) {
      byId("stockModalProductSub").textContent = `${sku} · ${owner} · ${packages} package(s) per unit`;
    }
  }

  function renderPackageSelect(row) {
    const select = byId("stockLabelPackageSelect");
    if (!select) return;

    const total = row ? getPackagesPerUnit(row) : 1;

    select.innerHTML = Array.from({ length: total }, (_, index) => {
      const no = index + 1;
      return `<option value="${no}">${no}/${total}</option>`;
    }).join("");
  }

  function updateStockModalBarcode(row) {
    if (!row) return;

    const packageNo = toInteger(byId("stockLabelPackageSelect")?.value, 1);
    const barcode = makePackageBarcode(row, packageNo);

    if (byId("stockModalBarcode")) byId("stockModalBarcode").value = barcode;
  }

  function buildSmallStockLabelHtml(row, packageNo) {
    const sku = row.sku_base || "SKU";
    const productName = row.name || "Product";
    const packageLabel = getPackageLabel(row, packageNo);
    const packageSku = makePackageBarcode(row, packageNo);
    const volume = toNumber(row.volume_m3, 0);
    const weight = toNumber(row.weight_kg, 0);
    const uniqueId = `small_lbl_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    return `
      <div class="small-stock-label dynamic-small-label" data-label-id="${uniqueId}" data-barcode="${escapeHtml(packageSku)}">
        <div class="small-left">
          <div class="small-brand-row">
            <div class="small-logo-box">
              <div>SOFA</div>
              <div>2U</div>
            </div>
            <div class="small-product-title">
              <div class="small-sku-main">${escapeHtml(sku)}</div>
              <div class="small-product-name">${escapeHtml(productName)}</div>
            </div>
          </div>

          <div class="small-divider"></div>
          <div class="small-package-no">${escapeHtml(packageLabel)}</div>
          <div class="small-divider"></div>

          <div class="small-metrics">
            <div>${formatNumber(weight, 1)} kg</div>
            <div>${formatNumber(volume, 3)} m³</div>
          </div>
        </div>

        <div class="small-right">
          <div class="small-barcode-wrap">
            <svg id="bc_${uniqueId}" class="small-barcode"></svg>
            <div class="small-barcode-line"></div>
            <div class="small-barcode-text">${escapeHtml(packageSku)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function injectSmallLabelCss() {
    if (document.getElementById("smallStockLabelCss")) return;

    const style = document.createElement("style");
    style.id = "smallStockLabelCss";

    style.textContent = `
      .dynamic-small-label{
        width:89mm;
        height:36mm;
        background:#fff;
        border:1px solid #d9dee7;
        border-radius:2mm;
        box-sizing:border-box;
        overflow:hidden;
        font-family:Arial,sans-serif;
        color:#111827;
        display:grid;
        grid-template-columns:48mm 41mm;
      }

      .small-left{
        padding:2mm 2.2mm;
        border-right:0.25mm solid #c8a76a;
        box-sizing:border-box;
        display:grid;
        grid-template-rows:auto 1px auto 1px auto;
        gap:0.9mm;
        min-width:0;
      }

      .small-brand-row{
        display:grid;
        grid-template-columns:8mm 1fr;
        gap:2mm;
        align-items:start;
        min-width:0;
      }

      .small-logo-box{
        width:8mm;
        height:8mm;
        border:0.25mm solid #c8a76a;
        border-radius:1mm;
        background:#16202c;
        color:#c8a76a;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        font-size:2.3mm;
        font-weight:900;
        line-height:0.95;
        flex:none;
      }

      .small-product-title{min-width:0;}

      .small-sku-main{
        font-size:6.4mm;
        font-weight:900;
        line-height:0.95;
        letter-spacing:-0.15mm;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        max-width:100%;
      }

      .small-product-name{
        margin-top:0.6mm;
        font-size:3.1mm;
        font-weight:800;
        line-height:1.05;
        max-height:7mm;
        overflow:hidden;
        text-transform:uppercase;
      }

      .small-divider{
        height:0.2mm;
        background:#c8a76a;
        opacity:.8;
      }

      .small-package-no{
        font-size:4.8mm;
        font-weight:900;
        line-height:1;
        letter-spacing:-0.1mm;
        display:flex;
        align-items:center;
        gap:1.2mm;
        white-space:nowrap;
      }

      .small-package-no::before{
        content:"Package";
        font-size:2.5mm;
        color:#9a7a3f;
        letter-spacing:0;
        font-weight:900;
        text-transform:uppercase;
      }

      .small-metrics{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:1.5mm;
        font-size:3mm;
        font-weight:900;
        line-height:1;
        align-items:end;
      }

      .small-metrics div{white-space:nowrap;}

      .small-metrics div + div{
        border-left:0.2mm solid #c8a76a;
        padding-left:1.5mm;
      }

      .small-right{
        padding:6mm 2.5mm 2mm;
        display:flex;
        justify-content:center;
        align-items:center;
        box-sizing:border-box;
      }

      .small-barcode-wrap{
        width:36mm;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:1.4mm;
      }

      .small-barcode{
        width:36mm;
        height:14mm;
        display:block;
      }

      .small-barcode-line{
        width:36mm;
        height:0.2mm;
        background:#c8a76a;
      }

      .small-barcode-text{
        width:36mm;
        font-size:3mm;
        font-weight:900;
        text-align:center;
        line-height:1;
        white-space:nowrap;
        overflow:visible;
        text-overflow:clip;
        letter-spacing:0;
      }
    `;

    document.head.appendChild(style);
  }

  function drawCodesForLabel(labelNode) {
    const labelId = labelNode.getAttribute("data-label-id");
    const barcodeText = labelNode.getAttribute("data-barcode") || "SKU";

    const barcodeSvg = labelNode.querySelector(`#bc_${CSS.escape(labelId)}`);

    if (barcodeSvg && typeof JsBarcode !== "undefined") {
      JsBarcode(barcodeSvg, barcodeText, {
        format: "CODE128",
        displayValue: false,
        height: 52,
        width: 1.3,
        margin: 0
      });
    }
  }

  function generateStockLabels() {
    const row = selectedLabelProduct;

    if (!row) {
      showToast("Select a product first.", "err");
      return;
    }

    injectSmallLabelCss();

    const area = byId("stockLabelPreviewArea");
    if (!area) return;

    const packageNo = toInteger(byId("stockLabelPackageSelect")?.value, 1);
    const qty = Math.max(1, Math.min(500, toInteger(byId("stockLabelQty")?.value, 1)));

    updateStockModalBarcode(row);

    area.innerHTML = Array.from({ length: qty }, () => buildSmallStockLabelHtml(row, packageNo)).join("");
    generatedLabelNodes = Array.from(area.querySelectorAll(".small-stock-label"));

    generatedLabelNodes.forEach(drawCodesForLabel);

    if (byId("btnDownloadStockLabelPdf")) {
      byId("btnDownloadStockLabelPdf").disabled = generatedLabelNodes.length === 0;
    }

    showToast(`${generatedLabelNodes.length} stock label(s) generated.`, "ok");
  }

  async function downloadStockLabelPdf() {
    if (!generatedLabelNodes.length) {
      showToast("Generate a stock label first.", "err");
      return;
    }

    if (!window.jspdf?.jsPDF || typeof html2canvas === "undefined") {
      showToast("PDF libraries are not loaded.", "err");
      return;
    }

    const btn = byId("btnDownloadStockLabelPdf");
    if (btn) btn.disabled = true;

    try {
      const { jsPDF } = window.jspdf;

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: [SMALL_LABEL_W_MM, SMALL_LABEL_H_MM]
      });

      for (let i = 0; i < generatedLabelNodes.length; i++) {
        const node = generatedLabelNodes[i];

        const canvas = await html2canvas(node, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true
        });

        const img = canvas.toDataURL("image/png");

        if (i > 0) pdf.addPage([SMALL_LABEL_W_MM, SMALL_LABEL_H_MM], "landscape");
        pdf.addImage(img, "PNG", 0, 0, SMALL_LABEL_W_MM, SMALL_LABEL_H_MM);
      }

      const sku = selectedLabelProduct?.sku_base || "stock-label";
      const packageNo = toInteger(byId("stockLabelPackageSelect")?.value, 1);

      pdf.save(`sofa2u-stock-label-${sku}-package-${packageNo}.pdf`);
      showToast("PDF downloaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not create PDF.", "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function headerKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\+/g, " plus ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildHeaderMap(headerArray) {
    const map = new Map();

    (headerArray || []).forEach((header, index) => {
      const key = headerKey(header);
      if (key) map.set(key, index);
    });

    return map;
  }

  function findColumn(headerMap, patternGroups) {
    for (const patterns of patternGroups) {
      for (const [key, index] of headerMap.entries()) {
        if (patterns.every(pattern => key.includes(pattern))) return index;
      }
    }

    return -1;
  }

  function getCell(rowArray, index) {
    if (index < 0) return "";
    return rowArray[index] ?? "";
  }

  function firstNonEmpty(values) {
    return values.find(v => String(v ?? "").trim() !== "") ?? "";
  }

  function parseSku(value) {
    const raw = String(value || "").trim();
    if (!raw) return { brand: "", sku: "" };

    if (raw.includes(":")) {
      const parts = raw.split(":");
      return {
        brand: parts[0].trim(),
        sku: parts.slice(1).join(":").trim()
      };
    }

    return { brand: "", sku: raw };
  }

  function countPackagesFromRow(rowArray, headerMap) {
    const ctn1Index = findColumn(headerMap, [
      ["box1", "gross", "weight"],
      ["box", "1", "gross", "weight"],
      ["ctn", "1", "gross", "weight"],
      ["carton", "1", "gross", "weight"]
    ]);

    const ctn2Index = findColumn(headerMap, [
      ["box2", "gross", "weight"],
      ["box", "2", "gross", "weight"],
      ["ctn", "2", "gross", "weight"],
      ["carton", "2", "gross", "weight"]
    ]);

    const ctn3Index = findColumn(headerMap, [
      ["box3", "gross", "weight"],
      ["box", "3", "gross", "weight"],
      ["ctn", "3", "gross", "weight"],
      ["carton", "3", "gross", "weight"]
    ]);

    const ctn1 = ctn1Index >= 0 ? toNumber(rowArray[ctn1Index], 0) : 0;
    const ctn2 = ctn2Index >= 0 ? toNumber(rowArray[ctn2Index], 0) : 0;
    const ctn3 = ctn3Index >= 0 ? toNumber(rowArray[ctn3Index], 0) : 0;

    let packageCount = 1;
    if (ctn2 > 0) packageCount = 2;
    if (ctn3 > 0) packageCount = 3;

    return {
      packages_per_unit: packageCount,
      package_count: packageCount,
      package_1_qty: ctn1 > 0 || packageCount >= 1 ? 1 : 0,
      package_2_qty: ctn2 > 0 ? 1 : 0,
      package_3_qty: ctn3 > 0 ? 1 : 0
    };
  }

  function cell(rowArray, colNumber) {
  return rowArray[colNumber - 1] ?? "";
}

function mapBellstoneProductRow(rowArray, headerMap) {
  const brand = String(cell(rowArray, 1) || "").trim();
  const sku = String(cell(rowArray, 2) || "").trim();
  const nadaSku = String(cell(rowArray, 3) || "").trim();
  const description = String(cell(rowArray, 4) || "").trim();

  const volume = toNumber(cell(rowArray, 5), 0);

  const ctn1Length = toNumber(cell(rowArray, 6), 0);
  const ctn1Width = toNumber(cell(rowArray, 7), 0);
  const ctn1Height = toNumber(cell(rowArray, 8), 0);

  const ctn2Length = toNumber(cell(rowArray, 9), 0);
  const ctn2Width = toNumber(cell(rowArray, 10), 0);
  const ctn2Height = toNumber(cell(rowArray, 11), 0);

  const ctn3Length = toNumber(cell(rowArray, 12), 0);
  const ctn3Width = toNumber(cell(rowArray, 13), 0);
  const ctn3Height = toNumber(cell(rowArray, 14), 0);

  const netWeight = toNumber(cell(rowArray, 15), 0);
  const grossWeight = toNumber(cell(rowArray, 16), 0);

  const box1 = toNumber(cell(rowArray, 17), 0);
  const box2 = toNumber(cell(rowArray, 18), 0);
  const box3 = toNumber(cell(rowArray, 19), 0);

  const storage = toNumber(cell(rowArray, 21), 0);
  const admin = toNumber(cell(rowArray, 22), 0);
  const pick = toNumber(cell(rowArray, 23), 0);
  const transport = toNumber(cell(rowArray, 26), 0);

  const ctn1Volume = ctn1Length && ctn1Width && ctn1Height
    ? round2((ctn1Length * ctn1Width * ctn1Height) / 1000000)
    : 0;

  const ctn2Volume = ctn2Length && ctn2Width && ctn2Height
    ? round2((ctn2Length * ctn2Width * ctn2Height) / 1000000)
    : 0;

  const ctn3Volume = ctn3Length && ctn3Width && ctn3Height
    ? round2((ctn3Length * ctn3Width * ctn3Height) / 1000000)
    : 0;

  const packageCount =
    box3 > 0 || ctn3Volume > 0 ? 3 :
    box2 > 0 || ctn2Volume > 0 ? 2 :
    1;

  const fallbackVolumePerPackage = packageCount > 0
    ? round2(volume / packageCount)
    : volume;

  return {
    sku_base: sku,
    brand,
    name: nadaSku || description || sku,
    description: description || nadaSku || sku,
    barcode_value: sku,
    qr_value: sku,

    volume_m3: volume,
    net_weight_kg: netWeight,
    weight_kg: grossWeight,

    storage_tariff: storage,
    admin_tariff: admin,
    handling_tariff: pick,
    transport_tariff: transport,

    total_s2u_fees: round2(storage + admin + pick),
    total_customer_charge: round2(storage + admin + pick + transport),

    packages_per_unit: packageCount,
    package_count: packageCount,

    package_1_qty: packageCount >= 1 ? 1 : 0,
    package_2_qty: packageCount >= 2 ? 1 : 0,
    package_3_qty: packageCount >= 3 ? 1 : 0,

    package_1_weight_kg: box1,
    package_2_weight_kg: box2,
    package_3_weight_kg: box3,

    package_1_volume_m3: ctn1Volume || fallbackVolumePerPackage,
    package_2_volume_m3: packageCount >= 2 ? (ctn2Volume || fallbackVolumePerPackage) : 0,
    package_3_volume_m3: packageCount >= 3 ? (ctn3Volume || fallbackVolumePerPackage) : 0,

    default_location_prefix: ""
  };
}  

function getSelectedImportOwnerLabel() {
  const select = byId("productsImportOwner");
  const selected = select?.value || "";
  const option = importOwnerOptions.find(o => o.value === selected);
  return normalize(option?.label || option?.name || "");
}

function isZoyImport() {
  return getSelectedImportOwnerLabel().includes("zoy");
}

function mapProductImportRow(rowArray, headerMap) {
  if (isZoyImport()) {
    return mapZoyProductRow(rowArray, headerMap);
  }

  return mapBellstoneProductRow(rowArray, headerMap);
}

function mapZoyProductRow(rowArray, headerMap) {
  const sku = String(cell(rowArray, 2) || "").trim();
  const specification = String(cell(rowArray, 3) || "").trim();

  const productSize = String(cell(rowArray, 4) || "").trim();
  const packingSize = String(cell(rowArray, 5) || "").trim();

const caseCbm = toNumber(cell(rowArray, 6), 0);
const caseWeight = toNumber(cell(rowArray, 7), 0);
const hasCbmOrWeight = caseCbm > 0 || caseWeight > 0;

  const loading40hc = toNumber(cell(rowArray, 8), 0);

  const totalS2uCharge = toNumber(cell(rowArray, 9), 0);
  const singlesDelivery = toNumber(cell(rowArray, 10), 0);
  const fullArticDelivery = toNumber(cell(rowArray, 11), 0);

  // BELANGRIJK: deze kolom wordt de prijs in Veynor
  const deliveredCostSingles = toNumber(cell(rowArray, 12), 0);

  const deliveredCostFullArtic = toNumber(cell(rowArray, 13), 0);
  const notes = String(cell(rowArray, 14) || "").trim();

  return {
    sku_base: sku,
    brand: "Zoy",
    name: specification || sku,

    description: [
      specification,
      productSize ? `Product size: ${productSize}` : "",
      packingSize ? `Packing size: ${packingSize}` : "",
      loading40hc ? `40HC loading: ${loading40hc}` : "",
      fullArticDelivery ? `Full artic delivery: £${fullArticDelivery}` : "",
      deliveredCostFullArtic ? `Delivered cost full artic: £${deliveredCostFullArtic}` : "",
      notes
    ].filter(Boolean).join(" | "),

    barcode_value: sku,
    qr_value: sku,

    volume_m3: caseCbm,
    net_weight_kg: caseWeight,
    weight_kg: caseWeight,

storage_tariff: totalS2uCharge,
admin_tariff: 0,
handling_tariff: 0,
transport_tariff: singlesDelivery,

    total_s2u_fees: round2(totalS2uCharge),

    // Dit is Total S2U Delivered Cost Singles
    total_customer_charge: round2(deliveredCostSingles),

    packages_per_unit: 1,
    package_count: 1,

    package_1_qty: 1,
    package_2_qty: 0,
    package_3_qty: 0,

    package_1_weight_kg: caseWeight,
    package_2_weight_kg: 0,
    package_3_weight_kg: 0,

    package_1_volume_m3: caseCbm,
    package_2_volume_m3: 0,
    package_3_volume_m3: 0,

    default_location_prefix: ""
  };
}

async function readImportRows() {
    if (!selectedImportFile) throw new Error("Select an Excel or CSV file first.");
    if (typeof XLSX === "undefined") throw new Error("XLSX library is not loaded.");

    const buffer = await selectedImportFile.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
let sheet;

if (isZoyImport()) {
    sheet = workbook.Sheets["Quote template"];
} else {
    sheet = workbook.Sheets[workbook.SheetNames[0]];
}

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) return [];

const headerIndex = rows.findIndex(row => {
  const joined = row.map(v => String(v).toLowerCase()).join(" ");

  if (isZoyImport()) {
    return (
      joined.includes("product code") &&
      joined.includes("case cbm") &&
      joined.includes("case weight")
    );
  }

  return (
    joined.includes("sku") &&
    (
      joined.includes("cbm") ||
      joined.includes("storage") ||
      joined.includes("delivery cost")
    )
  );
});

    const headerArray = headerIndex >= 0 ? rows[headerIndex] : rows[0];
    const headerMap = buildHeaderMap(headerArray);

return rows
      .slice(headerIndex >= 0 ? headerIndex + 1 : 1)
      .map(row => mapProductImportRow(row, headerMap))
      .filter(row => row.sku_base && row.name);
  }

  async function importProducts() {
    const db = ensureClient();
    const cid = await getCompanyId();
    const ownerId = await ensureImportOwnerCustomerId();
if (byId("filterProductCustomer")) {
  byId("filterProductCustomer").value = ownerId;
}

    const mapped = await readImportRows();

    if (!mapped.length) throw new Error("No valid product rows found. SKU is required.");

    let inserted = 0;
    let updated = 0;
    let incomplete = 0;
    let skipped = 0;

    for (const row of mapped) {
      if (!ownerId) {
        skipped += 1;
        continue;
      }

      const data = {
        customer_id: ownerId,
        sku_base: row.sku_base,
        name: row.name,
        category: row.brand,
        barcode_value: row.barcode_value || row.sku_base,
        qr_value: row.qr_value || row.sku_base,
        description: row.description || null,
        volume_m3: row.volume_m3,
        net_weight_kg: row.net_weight_kg,
        weight_kg: row.weight_kg,
        default_location_prefix: row.default_location_prefix,
        storage_tariff: row.storage_tariff,
        admin_tariff: row.admin_tariff,
        handling_tariff: row.handling_tariff,
        transport_tariff: row.transport_tariff,
        total_customer_charge: row.total_customer_charge,
        packages_per_unit: row.packages_per_unit || row.package_count || 1,
package_count: row.package_count || row.packages_per_unit || 1,
package_1_qty: row.package_1_qty,
package_2_qty: row.package_2_qty,
package_3_qty: row.package_3_qty,

package_1_weight_kg: row.package_1_weight_kg,
package_2_weight_kg: row.package_2_weight_kg,
package_3_weight_kg: row.package_3_weight_kg,

package_1_volume_m3: row.package_1_volume_m3,
package_2_volume_m3: row.package_2_volume_m3,
package_3_volume_m3: row.package_3_volume_m3
      };

      const payload = buildDbPayload(data, cid);

      if (productHasColumn("total_s2u_fees")) {
        payload.total_s2u_fees = row.total_s2u_fees || 0;
      }

      if (getMissingProductInfo(payload).length > 0) incomplete += 1;

      const { data: existing, error: existingError } = await db
        .from("products")
        .select("id")
        .eq("company_id", cid)
        .eq("sku_base", row.sku_base)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing?.id) {
        const { error } = await db.from("products").update(payload).eq("id", existing.id);
        if (error) throw error;
        updated += 1;
      } else {
        const { error } = await db.from("products").insert(payload);
        if (error) throw error;
        inserted += 1;
      }
    }

    showToast(`${inserted} products created, ${updated} updated, ${incomplete} incomplete, ${skipped} skipped.`, "ok");
    await loadCustomers();
    await loadProducts();
if (byId("filterProductCustomer")) {
  byId("filterProductCustomer").value = ownerId;
  applyFilters();
}
  }

  function downloadTemplate() {
    if (typeof XLSX === "undefined") {
      showToast("XLSX library is not loaded.", "err");
      return;
    }

    const rows = [{
      "SKU": "CRO0804",
      "Description": "Cromwell Storage bed King size",
      "Original CBM": 0.760,
      "Net weight": 70,
      "Gross weight": 75,
      "Box1 Gross Weight": 25,
      "Box2 Gross Weight": 25,
      "Box3 Gross Weight": 25,
      "Storage": 0,
      "Admin": 0,
      "Pick Pack Load": 0,
      "Delivery Cost UK (S2U) - Mainland UK": 0
    }];

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "products-pricing-import-template.xlsx");
  }

  function clearFilters() {
    if (byId("productSearch")) byId("productSearch").value = "";
    if (byId("filterProductCustomer")) byId("filterProductCustomer").value = "";
    if (byId("filterProductCategory")) byId("filterProductCategory").value = "";
    if (byId("filterProductCompleteness")) byId("filterProductCompleteness").value = "";
    applyFilters();
  }

  function renderAll() {
    renderKpis();
    renderProductsTable();
  }

  function bindEvents() {
    byId("productSearch")?.addEventListener("input", applyFilters);
    byId("filterProductCustomer")?.addEventListener("change", applyFilters);
byId("productsImportOwner")?.addEventListener("change", () => {
  const selected = byId("productsImportOwner")?.value || "";
  const filter = byId("filterProductCustomer");

  if (!filter) return;

  if (!selected) {
    filter.value = "";
    applyFilters();
    return;
  }

  if (selected.startsWith("customer:")) {
    filter.value = selected.replace("customer:", "");
    applyFilters();
  }
});
    byId("filterProductCategory")?.addEventListener("change", applyFilters);
    byId("filterProductCompleteness")?.addEventListener("change", applyFilters);

    byId("btnRefreshProducts")?.addEventListener("click", async () => {
      try {
        await loadCustomers();
        await loadProducts();
        showToast("Products refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message, "err");
      }
    });

    byId("btnClearProductFilters")?.addEventListener("click", clearFilters);

    byId("btnOpenProductModal")?.addEventListener("click", () => {
      clearForm();
      byId("productModalTitle").textContent = "New Product";
      byId("productModal")?.classList.add("open");
    });

    byId("btnCloseProductModal")?.addEventListener("click", () => {
      byId("productModal")?.classList.remove("open");
    });

    byId("productModal")?.addEventListener("click", event => {
      if (event.target?.id === "productModal") {
        byId("productModal").classList.remove("open");
      }
    });

    byId("btnSaveProduct")?.addEventListener("click", async () => {
      try {
        await saveProduct();
        byId("productModal")?.classList.remove("open");
      } catch (error) {
        console.error(error);
        showToast(error.message, "err");
      }
    });

    byId("btnClearProductForm")?.addEventListener("click", clearForm);

    byId("productsImportFile")?.addEventListener("change", event => {
      selectedImportFile = event.target.files?.[0] || null;

      const label = byId("excelFileStatus");
      if (label) {
        label.textContent = selectedImportFile
          ? `${selectedImportFile.name} selected`
          : "No file selected";
      }
    });

    byId("btnImportProducts")?.addEventListener("click", async () => {
      try {
        await importProducts();
      } catch (error) {
        console.error(error);
        showToast(error.message, "err");
      }
    });

    byId("btnDownloadTemplate")?.addEventListener("click", downloadTemplate);

    byId("btnCloseStockLabelModal")?.addEventListener("click", closeStockLabelModal);

    byId("stockLabelModal")?.addEventListener("click", event => {
      if (event.target?.id === "stockLabelModal") {
        closeStockLabelModal();
      }
    });

    byId("stockLabelPackageSelect")?.addEventListener("change", () => {
      if (selectedLabelProduct) {
        updateStockModalBarcode(selectedLabelProduct);
        generateStockLabels();
      }
    });

    byId("stockLabelQty")?.addEventListener("change", () => {
      if (selectedLabelProduct) {
        generateStockLabels();
      }
    });

    byId("btnGenerateStockLabel")?.addEventListener("click", generateStockLabels);
    byId("btnDownloadStockLabelPdf")?.addEventListener("click", downloadStockLabelPdf);
  }

  async function init() {
    try {
      ensureClient();
      bindEvents();

      await loadCustomers();
      await loadProducts();

      clearForm();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Products page failed to load.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();