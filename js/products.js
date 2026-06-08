(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const DEFAULT_PRODUCT_OWNER = "Bellstone";
  const OWNER_PROFILES_KEY = "product_owner_profiles";
  const LABEL_W_MM = 140;
  const LABEL_H_MM = 110;

  let client = null;
  let companyId = null;

  let customers = [];
  let allCustomers = [];
  let ownerProfiles = [];
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

  function toNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;

    const text = String(value)
      .replace(/£/g, "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .trim();

    if (!text) return fallback;

    const num = Number(text);
    return Number.isFinite(num) ? num : fallback;
  }

  function toInteger(value, fallback = 0) {
    const num = Math.round(toNumber(value, fallback));
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
    }, 7000);
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

  function customerLooksLikeProductOwner(customer) {
    const name = normalize(customer?.name || "");
    if (!name) return false;

    if (DEFAULT_OWNER_NAMES.some(owner => name.includes(owner))) return true;

    return ownerProfiles.some(owner => {
      const possibleNames = [
        owner.name,
        owner.trading_name,
        owner.customer_code,
        owner.default_source_name
      ].map(normalize).filter(Boolean);

      return possibleNames.some(ownerName => name.includes(ownerName) || ownerName.includes(name));
    });
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

  async function loadCustomers() {
    const db = ensureClient();
    const cid = await getCompanyId();

    await loadOwnerProfiles();

    const { data, error } = await db
      .from("customers")
      .select("id, name, customer_type")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) throw error;

    allCustomers = data || [];
    customers = allCustomers.filter(
  customer => customer.customer_type === "product_owner"
);

    if (!customers.length) {
      customers = allCustomers.filter(c =>
        DEFAULT_OWNER_NAMES.some(owner => normalize(c.name).includes(owner))
      );
    }

    renderCustomerSelects();
  }

  function renderCustomerSelects() {
    const formSelect = byId("productCustomer");
    const filterSelect = byId("filterProductCustomer");

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
    }
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

  function productHasTariff(row) {
    return (
      toNumber(getProductValue(row, "storage_tariff", 0), 0) > 0 ||
      toNumber(getProductValue(row, "admin_tariff", 0), 0) > 0 ||
      toNumber(getProductValue(row, "handling_tariff", 0), 0) > 0 ||
      toNumber(getProductValue(row, "transport_tariff", 0), 0) > 0
    );
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

      if (completeness === "complete" && (!volume || !weight)) return false;
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
          getOwnerName(row)
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
      tbody.innerHTML = `<tr><td colspan="15">No products found.</td></tr>`;
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
        event.stopPropagation();
        const row = allProducts.find(p => String(p.id) === String(btn.dataset.productId));
        if (row) fillForm(row);
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
        const row = allProducts.find(p => String(p.id) === String(tr.dataset.productId));
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

  function buildStockLabelHtml(row, packageNo) {
  const sku = row.sku_base || "SKU";
  const owner = getOwnerName(row);
  const productName = row.name || "Product";
  const packageLabel = getPackageLabel(row, packageNo);
  const packageSku = makePackageBarcode(row, packageNo);
  const barcode = makePackageBarcode(row, packageNo);
  const volume = toNumber(row.volume_m3, 0);
  const weight = toNumber(row.weight_kg, 0);
  const uniqueId = `lbl_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return `
    <div class="stock-label clean-stock-label" data-label-id="${uniqueId}" data-barcode="${escapeHtml(barcode)}">
      <div class="clean-top">
        <div class="clean-brand">
          <div class="clean-logo">SOFA<span>2U</span></div>
          <div class="clean-sub">WAREHOUSE SERVICES</div>
        </div>
        <div class="clean-status">IN STOCK</div>
      </div>

      <div class="clean-body">
        <div class="clean-product">
          <div>
            <div class="stock-k">Product</div>
            <div class="clean-product-name">${escapeHtml(productName)}</div>
          </div>
          <div>
            <div class="stock-k">Product Code</div>
            <div class="clean-product-code">${escapeHtml(sku)}</div>
          </div>
        </div>

        <div class="clean-divider"></div>

        <div class="clean-scan-row">
          <div>
            <div class="stock-k">Package SKU</div>
            <div class="clean-package-sku">${escapeHtml(packageSku)}</div>
          </div>

          <div>
            <div class="stock-k center">Barcode</div>
            <svg id="bc_${uniqueId}" class="clean-barcode"></svg>
            <div class="barcode-text">${escapeHtml(barcode)}</div>
          </div>

          <div>
            <div class="stock-k center">QR Code</div>
            <div class="clean-qr" id="qr_${uniqueId}"></div>
          </div>
        </div>

        <div class="clean-divider"></div>

        <div class="clean-info-row">
          <div>
            <div class="stock-k">Volume</div>
            <div class="clean-info-value">${formatNumber(volume, 3)} m³</div>
          </div>
          <div>
            <div class="stock-k">Weight</div>
            <div class="clean-info-value">${formatNumber(weight, 1)} kg</div>
          </div>
          <div>
            <div class="stock-k">Received</div>
            <div class="clean-info-value">${escapeHtml(todayUk())}</div>
          </div>
        </div>

        <div class="clean-divider"></div>

        <div class="clean-owner-row">
          <div>
            <div class="stock-k">Owner</div>
            <div class="clean-owner">${escapeHtml(owner)}</div>
          </div>
          <div>
            <div class="stock-k">Package</div>
            <div class="clean-owner">${escapeHtml(packageLabel)}</div>
          </div>
        </div>
      </div>

      <div class="clean-footer">
        <span>Property of ${escapeHtml(owner)}</span>
        <span>www.sofa2u.co.uk</span>
      </div>
    </div>
  `;
}

  function injectCleanLabelCss() {
  if (document.getElementById("cleanStockLabelCss")) return;

  const style = document.createElement("style");
  style.id = "cleanStockLabelCss";

  style.textContent = `
    .clean-stock-label{
      width:140mm;
      height:110mm;
      background:#ffffff;
      border:1px solid #d9dee7;
      border-radius:10px;
      overflow:hidden;
      font-family:Arial,sans-serif;
      color:#111827;
      display:grid;
      grid-template-rows:24mm 74mm 12mm;
      box-sizing:border-box;
    }

    /* TOP HEADER */

    .clean-top{
      display:grid;
      grid-template-columns:1fr 45mm;
      background:#16202c;
      color:#fff;
    }

    .clean-brand{
      padding:7mm 8mm 0;
      display:flex;
      flex-direction:column;
      justify-content:flex-start;
    }

    .clean-logo{
      font-size:24px;
      line-height:1;
      letter-spacing:7px;
      color:#d7b177;
      white-space:nowrap;
      font-weight:300;
    }

    .clean-logo span{
      color:#ffffff;
    }

    .clean-sub{
      margin-top:3mm;
      font-size:9px;
      letter-spacing:3px;
      color:#ffffff;
      white-space:nowrap;
      font-weight:700;
    }

    .clean-status{
      background:#2f6b3b;
      display:flex;
      align-items:center;
      justify-content:center;
      text-align:center;
      font-size:15px;
      font-weight:900;
      letter-spacing:.02em;
    }

    /* BODY */

    .clean-body{
  padding:6mm 8mm 4mm;

  display:grid;

  grid-template-rows:
    16mm
    1px
    25mm
    1px
    13mm
    1px
    9mm;

  gap:3mm;

  overflow:hidden;

  align-content:start;

  box-sizing:border-box;

  background:#ffffff;

  width:100%;

  min-height:0;

  position:relative;
}

    .stock-k{
      font-size:8.5px;
      font-weight:900;
      color:#2f6b3b;
      text-transform:uppercase;
      letter-spacing:.05em;
      margin-bottom:1.4mm;
      line-height:1;
    }

    .stock-k.center{
      text-align:center;
    }

    /* PRODUCT ROW */

    .clean-product{
      display:grid;
      grid-template-columns:1.3fr .7fr;
      gap:8mm;
      align-items:start;
    }

    .clean-product > div + div{
      border-left:1px solid #d9dee7;
      padding-left:7mm;
      min-height:100%;
      box-sizing:border-box;
    }

    .clean-product-name{
      font-size:18px;
      font-weight:900;
      line-height:1.15;
      letter-spacing:-0.02em;
      overflow-wrap:anywhere;
    }

    .clean-product-code{
      font-size:18px;
      font-weight:900;
      line-height:1.15;
      overflow-wrap:anywhere;
    }

    /* DIVIDER */

    .clean-divider{
      height:1px;
      background:#d9dee7;
      width:100%;
    }

    /* BARCODE + QR */

    .clean-scan-row{
      display:grid;
      grid-template-columns:.9fr 1fr 26mm;
      gap:6mm;
      align-items:center;
    }

    .clean-scan-row > div + div{
      border-left:1px solid #d9dee7;
      padding-left:5mm;
      min-height:100%;
      box-sizing:border-box;
    }

    .clean-package-sku{
      font-size:22px;
      font-weight:900;
      line-height:1;
      letter-spacing:-0.03em;
      overflow-wrap:anywhere;
    }

    .clean-barcode{
      width:100%;
      height:16mm;
      display:block;
    }

    .barcode-text{
      text-align:center;
      font-size:8.5px;
      margin-top:1mm;
      line-height:1;
      letter-spacing:.03em;
      color:#374151;
    }

    .clean-qr{
      width:21mm;
      height:21mm;
      display:flex;
      align-items:center;
      justify-content:center;
      margin:auto;
    }

    /* METRICS */

    .clean-info-row{
      display:grid;
      grid-template-columns:repeat(3,1fr);
      gap:5mm;
      align-items:center;
    }

    .clean-info-row > div{
      display:grid;
      grid-template-columns:12mm 1fr;
      gap:3mm;
      align-items:center;
      min-height:12mm;
      padding-right:4mm;
      border-right:1px dashed #d9dee7;
      box-sizing:border-box;
    }

    .clean-info-row > div:last-child{
      border-right:none;
      padding-right:0;
    }

    .metric-icon{
      width:10mm;
      height:10mm;
      border-radius:999px;
      background:#eef2f2;
      color:#2f6b3b;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:15px;
      font-weight:900;
      flex:none;
    }

    .clean-info-value{
      font-size:14px;
      font-weight:900;
      line-height:1.08;
      overflow-wrap:anywhere;
    }

    /* OWNER */

    .clean-owner-row{
      display:grid;
      grid-template-columns:1fr 28mm;
      gap:8mm;
      align-items:start;
    }

    .clean-owner{
      font-size:13px;
      font-weight:900;
      line-height:1.12;
      overflow-wrap:anywhere;
    }

    /* FOOTER */

    .clean-footer{
      background:#2f6b3b;
      color:#ffffff;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding:0 8mm;
      font-size:9px;
      font-weight:900;
      box-sizing:border-box;
      overflow:hidden;
    }

    .clean-footer span{
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
  `;

  document.head.appendChild(style);
}

  function drawCodesForLabel(labelNode) {
    const labelId = labelNode.getAttribute("data-label-id");
    const barcodeText = labelNode.getAttribute("data-barcode") || "SKU";

    const barcodeSvg = labelNode.querySelector(`#bc_${CSS.escape(labelId)}`);
    const qrEl = labelNode.querySelector(`#qr_${CSS.escape(labelId)}`);

    if (barcodeSvg && typeof JsBarcode !== "undefined") {
      JsBarcode(barcodeSvg, barcodeText, {
        format: "CODE128",
        displayValue: false,
        height: 62,
        width: 1.45,
        margin: 0
      });
    }

    if (qrEl && typeof QRCode !== "undefined") {
      qrEl.innerHTML = "";
      new QRCode(qrEl, {
        text: barcodeText,
        width: 92,
        height: 92,
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  }

  function generateStockLabels() {
    const row = selectedLabelProduct;

    if (!row) {
      showToast("Select a product first.", "err");
      return;
    }

    injectCleanLabelCss();

    const area = byId("stockLabelPreviewArea");
    if (!area) return;

    const packageNo = toInteger(byId("stockLabelPackageSelect")?.value, 1);
    const qty = Math.max(1, Math.min(500, toInteger(byId("stockLabelQty")?.value, 1)));

    updateStockModalBarcode(row);

    area.innerHTML = Array.from({ length: qty }, () => buildStockLabelHtml(row, packageNo)).join("");
    generatedLabelNodes = Array.from(area.querySelectorAll(".stock-label"));

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
        format: [LABEL_W_MM, LABEL_H_MM]
      });

      for (let i = 0; i < generatedLabelNodes.length; i++) {
        const node = generatedLabelNodes[i];

        const canvas = await html2canvas(node, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true
        });

        const img = canvas.toDataURL("image/png");

        if (i > 0) pdf.addPage([LABEL_W_MM, LABEL_H_MM], "landscape");
        pdf.addImage(img, "PNG", 0, 0, LABEL_W_MM, LABEL_H_MM);
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

  function rowValueByLetter(rowArray, letter) {
    const index = letter.toUpperCase().charCodeAt(0) - 65;
    return rowArray[index] ?? "";
  }

  function firstNonEmpty(values) {
    return values.find(v => String(v ?? "").trim() !== "") ?? "";
  }

  function findHeaderIndex(headerArray, patterns) {
    return headerArray.findIndex(header => {
      const h = normalize(header)
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9 ]/g, "");

      return patterns.every(pattern => h.includes(pattern));
    });
  }

  function countPackagesFromRow(rowArray, headerArray) {
    const ctn1Index = findHeaderIndex(headerArray, ["gross", "weight", "ctn", "1"]);
    const ctn2Index = findHeaderIndex(headerArray, ["gross", "weight", "ctn", "2"]);
    const ctn3Index = findHeaderIndex(headerArray, ["gross", "weight", "ctn", "3"]);

    const ctn1 = ctn1Index >= 0 ? toNumber(rowArray[ctn1Index], 0) : 0;
    const ctn2 = ctn2Index >= 0 ? toNumber(rowArray[ctn2Index], 0) : 0;
    const ctn3 = ctn3Index >= 0 ? toNumber(rowArray[ctn3Index], 0) : 0;

    let packageCount = 1;
    if (ctn2 > 0) packageCount = 2;
    if (ctn3 > 0) packageCount = 3;

    return {
      packages_per_unit: packageCount,
      package_count: packageCount,
      package_1_qty: ctn1 > 0 ? 1 : 0,
      package_2_qty: ctn2 > 0 ? 1 : 0,
      package_3_qty: ctn3 > 0 ? 1 : 0
    };
  }

  function mapPricingWorksheetRow(rowArray, headerArray) {
    const skuRaw = rowValueByLetter(rowArray, "B");
    const parsedSku = parseSku(skuRaw);

    const name = firstNonEmpty([
      rowValueByLetter(rowArray, "C"),
      rowValueByLetter(rowArray, "A"),
      parsedSku.sku
    ]);

    const brand = parsedSku.brand || "";

    const storage = toNumber(rowValueByLetter(rowArray, "G"), 0);
    const admin = toNumber(rowValueByLetter(rowArray, "H"), 0);
    const pick = toNumber(rowValueByLetter(rowArray, "I"), 0);
    const transport = toNumber(rowValueByLetter(rowArray, "L"), 0);
    const totalCharge = toNumber(rowValueByLetter(rowArray, "M"), 0);

    const packages = countPackagesFromRow(rowArray, headerArray);

    return {
      ownerName: DEFAULT_PRODUCT_OWNER,
      sku_base: parsedSku.sku,
      brand,
      name: String(name || parsedSku.sku || "").trim(),
      description: String(name || "").trim(),
      barcode_value: parsedSku.sku,
      qr_value: parsedSku.sku,
      volume_m3: toNumber(rowValueByLetter(rowArray, "D"), 0),
      net_weight_kg: toNumber(rowValueByLetter(rowArray, "E"), 0),
      weight_kg: toNumber(rowValueByLetter(rowArray, "F"), 0),
      storage_tariff: storage,
      admin_tariff: admin,
      handling_tariff: pick,
      transport_tariff: transport,
      total_s2u_fees: storage + admin + pick,
      total_customer_charge: totalCharge,
      packages_per_unit: packages.packages_per_unit,
      package_count: packages.package_count,
      package_1_qty: packages.package_1_qty,
      package_2_qty: packages.package_2_qty,
      package_3_qty: packages.package_3_qty,
      default_location_prefix: ""
    };
  }

  async function readImportRows() {
    if (!selectedImportFile) throw new Error("Select an Excel or CSV file first.");
    if (typeof XLSX === "undefined") throw new Error("XLSX library is not loaded.");

    const buffer = await selectedImportFile.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) return [];

    const headerIndex = rows.findIndex(row => {
      const joined = row.map(v => String(v).toLowerCase()).join(" ");
      return (
        joined.includes("sku") ||
        joined.includes("cbm") ||
        joined.includes("gross weight") ||
        joined.includes("packing gross weight")
      );
    });

    const headerArray = headerIndex >= 0 ? rows[headerIndex] : rows[0];

    return rows
      .slice(headerIndex >= 0 ? headerIndex + 1 : 1)
      .map(row => mapPricingWorksheetRow(row, headerArray))
      .filter(row => row.sku_base && row.name);
  }

  function findCustomerIdByName(name) {
    const clean = normalize(name || DEFAULT_PRODUCT_OWNER);

    const customer = customers.find(c =>
      normalize(c.name).includes(clean) || clean.includes(normalize(c.name))
    );

    return customer?.id || getDefaultOwnerCustomerId();
  }

  async function importProducts() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const mapped = await readImportRows();

    if (!mapped.length) throw new Error("No valid product rows found. SKU in column B is required.");

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of mapped) {
      const ownerId = findCustomerIdByName(row.ownerName || DEFAULT_PRODUCT_OWNER);

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
        package_3_qty: row.package_3_qty
      };

      const payload = buildDbPayload(data, cid);

      if (productHasColumn("total_s2u_fees")) {
        payload.total_s2u_fees = row.total_s2u_fees || 0;
      }

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

    showToast(`${inserted} products created, ${updated} updated, ${skipped} skipped.`, "ok");
    await loadProducts();
  }

  function downloadTemplate() {
    if (typeof XLSX === "undefined") {
      showToast("XLSX library is not loaded.", "err");
      return;
    }

    const rows = [{
      "A Product": "Cromwell Storage bed King size",
      "B SKU": "CRO0804",
      "C Description": "Cromwell Storage bed King size",
      "D CBM": 0.760,
      "E Net Weight kg": 70,
      "F Gross Weight kg": 75,
      "G Storage": 0,
      "H Admin": 0,
      "I Pick": 0,
      "L Transport": 0,
      "M Total Customer Charge": 0,
      "Packages Per Unit": 3,
      "Packing gross weight ctn 1": 25,
      "Packing gross weight ctn 2": 25,
      "Packing gross weight ctn 3": 25
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

    byId("btnSaveProduct")?.addEventListener("click", async () => {
      try {
        await saveProduct();
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
      if (event.target?.id === "stockLabelModal") closeStockLabelModal();
    });

    byId("stockLabelPackageSelect")?.addEventListener("change", () => {
      if (selectedLabelProduct) {
        updateStockModalBarcode(selectedLabelProduct);
        generateStockLabels();
      }
    });

    byId("stockLabelQty")?.addEventListener("change", () => {
      if (selectedLabelProduct) generateStockLabels();
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