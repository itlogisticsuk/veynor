(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const OWNER_PROFILES_KEY = "product_owner_profiles";

  let client = null;
  let companyId = null;

  let settingsMap = new Map();
  let ownerProfiles = [];
let retailerList = [];
let productList = [];

  let selectedExcelFile = null;
  let selectedPdfFiles = [];
  let rawRows = [];
  let groupedOrders = [];
  let selectedOrderNo = null;
  let currentSourceKind = "";
  let lastPdfText = "";
let manualProducts = [];
let manualRetailers = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function firstEl(ids) {
    for (const id of ids) {
      const el = byId(id);
      if (el) return el;
    }
    return null;
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

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function dedupeKey(value) {
    return normalize(value).replace(/[^a-z0-9]/g, "");
  }

  function dedupeRepeatedWords(value) {
    let text = cleanText(value);
    if (!text) return "";

    text = text.replace(/\s*,\s*/g, ", ").replace(/,+$/g, "").trim();

    const commaParts = text.split(",").map(p => cleanText(p)).filter(Boolean);
    const uniqueParts = [];
    const seenParts = new Set();

    commaParts.forEach(part => {
      const key = dedupeKey(part);
      if (!key || seenParts.has(key)) return;
      seenParts.add(key);
      uniqueParts.push(part);
    });

    text = uniqueParts.join(", ");

    const words = text.split(" ");
    const half = Math.floor(words.length / 2);

    if (words.length > 1 && words.length % 2 === 0) {
      const left = words.slice(0, half).join(" ");
      const right = words.slice(half).join(" ");

      if (dedupeKey(left) === dedupeKey(right)) {
        return left;
      }
    }

    return text;
  }
function splitContactFromAddressParts(parts = []) {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneRegex = /(?:\+?\d[\d\s().-]{7,}\d)/;

  const addressParts = [];
  let email = "";
  let phone = "";

  (parts || []).forEach(part => {
    const text = cleanText(part).replace(/,$/, "");
    if (!text) return;

    const emailMatch = text.match(emailRegex);
    const phoneMatch = text.match(phoneRegex);
    const digitCount = text.replace(/\D/g, "").length;

    if (emailMatch) {
      email = email || emailMatch[0];
      return;
    }

    if (phoneMatch && digitCount >= 9) {
      phone = phone || phoneMatch[0];
      return;
    }

    addressParts.push(text);
  });

  return { addressParts, email, phone };
}
  function dedupeAddressParts(parts) {
    const seen = new Set();
    const result = [];

    parts.forEach(part => {
      const cleaned = dedupeRepeatedWords(part);
      const key = dedupeKey(cleaned);
      if (!cleaned || !key || seen.has(key)) return;
      seen.add(key);
      result.push(cleaned);
    });

    return result;
  }

  function toNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;

    const text = String(value)
      .replace("£", "")
      .replace(",", ".")
      .trim();

    const num = Number(text);
    return Number.isFinite(num) ? num : fallback;
  }

  function round3(value) {
    return Number(toNumber(value, 0).toFixed(3));
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

  function formatVolume(value) {
    return `${formatNumber(value, 2)} m³`;
  }

function normalizeStockPriorityLevel(value) {
  const level = Math.round(toNumber(value, 0));

  if (level === 200) return 200;
  if (level === 100) return 100;

  return 0;
}

function getStockPriorityLabel(value) {
  const level = normalizeStockPriorityLevel(value);

  if (level === 200) return "Critical";
  if (level === 100) return "Priority";

  return "Normal";
}

function getStockPriorityClass(value) {
  const level = normalizeStockPriorityLevel(value);

  if (level === 200) return "has-critical";
  if (level === 100) return "has-priority";

  return "";
}

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = "notice " + type;

    window.clearTimeout(window.__importToastTimer);
    window.__importToastTimer = window.setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 9000);
  }

  function setProgress(open, pct = 0, text = "") {
    const wrap = byId("progressWrap");
    const bar = byId("progressBar");
    const textEl = byId("progressText");

    if (wrap) wrap.classList.toggle("open", !!open);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (textEl) textEl.textContent = text || "";
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value ?? "";
  }

  function getFieldValue(ids, fallback = "") {
    const el = Array.isArray(ids) ? firstEl(ids) : byId(ids);
    return String(el?.value ?? fallback).trim();
  }

  function getCheckbox(id, fallback = false) {
    const el = byId(id);
    if (!el) return fallback;
    return !!el.checked;
  }

  function displayDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB");
  }

  function parseDateToIso(value) {
    if (!value) return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }

    if (typeof value === "number" && window.XLSX?.SSF) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
    }

    const s = String(value).trim();
    if (!s) return null;

    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
    }

    const direct = new Date(s);
    if (!Number.isNaN(direct.getTime())) {
      return direct.toISOString().slice(0, 10);
    }

    return s;
  }

  function makeRetailerCode(postcode, retailerName) {
    const pc = String(postcode || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9]/g, "");

    const name = String(retailerName || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3);

    return `${pc || "NOPC"}-${name || "RET"}`;
  }

  function getDefaultCountry() {
    return getFieldValue("defaultCountry", "United Kingdom") || "United Kingdom";
  }

  function getDefaultStatus() {
    return getFieldValue("defaultStatus", "imported") || "imported";
  }

  function getExcelSourceType() {
    return (
      getFieldValue("excelSourceType", "") ||
      getFieldValue("defaultSourceType", "") ||
      "sales_order_excel"
    );
  }

  function getPdfSourceType() {
    return (
      getFieldValue("pdfSourceType", "") ||
      getFieldValue("defaultSourceType", "") ||
      "packing_slip_pdf"
    );
  }

  function getValue(row, aliases) {
    const keys = Object.keys(row || {});
    for (const alias of aliases) {
      const found = keys.find(k => normalize(k) === normalize(alias));
      if (found) return row[found];
    }
    return "";
  }

  function parseSupplierSku(value) {
    const raw = String(value || "").trim();
    if (!raw) return { raw: "", brand: "", sku: "" };

    if (raw.includes(":")) {
      const parts = raw.split(":");
      return {
        raw,
        brand: parts[0].trim(),
        sku: parts.slice(1).join(":").trim()
      };
    }

    return { raw, brand: "", sku: raw };
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Tenant "${TENANT_NAME}" not found in companies.`);

    companyId = data.id;
    return companyId;
  }

  async function loadSettings() {
    const cid = await getCompanyId();

    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", cid);

    if (error) throw error;

    settingsMap = new Map((data || []).map(row => [row.setting_key, row.setting_value ?? ""]));

    const raw = settingsMap.get(OWNER_PROFILES_KEY);

    if (!raw) {
      ownerProfiles = [];
      renderProductOwnerSelect();
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      ownerProfiles = Array.isArray(parsed) ? parsed : [];
    } catch {
      ownerProfiles = [];
    }

    renderProductOwnerSelect();
  }

  function renderProductOwnerSelect() {
    const select = byId("productOwnerName");
    if (!select) return;

    if (!ownerProfiles.length) {
      select.innerHTML = `<option value="">No product owners configured in Settings</option>`;
      select.disabled = true;
      showToast("No product owners found. Add Bellstone/Zoy in Settings first.", "err");
      return;
    }

    select.disabled = false;

    select.innerHTML = ownerProfiles.map(owner => {
      const label = owner.trading_name || owner.name || owner.customer_code || owner.key || "Product owner";
      const value = owner.key || owner.customer_code || owner.trading_name || owner.name || label;

      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join("");

    const defaultOwner =
      settingsMap.get("system_default_product_owner") ||
      settingsMap.get("default_product_owner") ||
      ownerProfiles[0]?.key ||
      "";

    const match = ownerProfiles.find(owner => {
      return [
        owner.key,
        owner.name,
        owner.trading_name,
        owner.customer_code,
        owner.default_source_name
      ].map(normalize).includes(normalize(defaultOwner));
    });

    select.value = match?.key || ownerProfiles[0]?.key || "";
  }

function isZoyOwner() {
  const owner = getSelectedProductOwner();
  const text = normalize([
    owner?.key,
    owner?.name,
    owner?.trading_name,
    owner?.customer_code,
    owner?.default_source_name
  ].filter(Boolean).join(" "));

  return text.includes("zoy");
}

  function getSelectedProductOwner() {
    const selected = getFieldValue("productOwnerName", "");

    if (!ownerProfiles.length) return null;

    const match = ownerProfiles.find(profile => {
      return [
        profile.key,
        profile.name,
        profile.trading_name,
        profile.default_source_name,
        profile.customer_code
      ].map(normalize).includes(normalize(selected));
    });

    return match || ownerProfiles[0] || null;
  }

  function buildEmptyAddress() {
  return {
    contactName: "",
    companyName: "",

    address1: "",
    address2: "",
    address3: "",
    address4: "",

    city: "",
    county: "",

    postcode: "",
    country: getDefaultCountry(),

    email: "",
    phone: ""
  };
}

  function ownerToBillingAddress(owner) {
    return {
      contactName: "",
      companyName: owner?.name || owner?.trading_name || "",
      address1: owner?.address1 || "",
      address2: owner?.address2 || "",
      address3: "",
      city: owner?.city || "",
      county: "",
      postcode: owner?.postcode || "",
      country: owner?.country || getDefaultCountry(),
      email: owner?.invoice_email || "",
      phone: owner?.phone || ""
    };
  }

  function formatAddress(address) {
    if (!address) return "";

    const cleaned = splitContactFromAddressParts([
  address.address1,
  address.address2,
  address.address3,
  address.city,
  address.county,
  address.postcode,
  address.country
]);

return dedupeAddressParts(cleaned.addressParts).join(", ");
  }

  function buildEmptyOrder() {
    const owner = getSelectedProductOwner();

    return {
sourceKind: currentSourceKind || "unknown",
sourceType: "",

movementType: "delivery",

orderNumber: "",
      externalReference: "",
      purchaseOrder: "",

      orderDate: null,
      dueDate: null,

      retailName: "",
      customerName: "",
      productOwnerName: owner?.trading_name || owner?.name || "",

      contactName: "",

      invoiceAddressText: "",
      deliveryAddressText: "",

      address1: "",
      address2: "",
      address3: "",
      city: "",
      state: "",
      postcode: "",
      country: getDefaultCountry(),

      email: "",
      phone: "",

      billTo: ownerToBillingAddress(owner),
      shipTo: buildEmptyAddress(),

      sosAccount: "",
      memo: "",
      pdfTotalVolume: 0,

      lines: [],
      notes: [],
      warnings: [],
      missingProductSkus: [],

      existing: false,
      existingOrderId: null,
      importAnyway: false,
      imported: false,
      failed: false,
      importMessage: ""
    };
  }

  function validateOrder(order) {
    const notes = [];

    if (!getSelectedProductOwner()) notes.push("No product owner selected");
    if (!order.orderNumber) notes.push("Missing order number");
    if (!order.retailName) notes.push("Missing retailer/shop name");
    if (!order.productOwnerName) notes.push("Missing product owner");
    if (!order.lines.length) notes.push("No product lines");
    if (!order.postcode && !order.city) notes.push("Missing city/postcode");

const isCollection =
  normalize(order.movementType) ===
  "collection";

const missingSku =
  order.lines.filter(
    line => !line.itemCode
  ).length;

if (
  !isCollection &&
  missingSku
) {
  notes.push(
    `${missingSku} line(s) missing SKU`
  );
}

    const invalidQty = order.lines.filter(l => Math.round(toNumber(l.quantity, 0)) <= 0).length;
    if (invalidQty) notes.push(`${invalidQty} line(s) invalid quantity`);

    return notes;
  }

  function finalizeOrder(order) {
    const owner = getSelectedProductOwner();

    order.productOwnerName = owner?.trading_name || owner?.name || "";
    order.billTo = ownerToBillingAddress(owner);

    const totalQty = order.lines.reduce((sum, line) => {
      return sum + Math.round(toNumber(line.quantity, 0));
    }, 0);

    const lineVolume = order.lines.reduce((sum, line) => {
      return sum + toNumber(line.totalVolume, 0);
    }, 0);

    const uniqueSkus = new Set(order.lines.map(l => l.itemCode).filter(Boolean)).size;

    order.retailName = dedupeRepeatedWords(order.retailName);
    order.customerName = dedupeRepeatedWords(order.customerName);
    order.contactName = dedupeRepeatedWords(order.contactName);

    order.billTo.companyName = dedupeRepeatedWords(order.billTo.companyName);
    order.billTo.contactName = dedupeRepeatedWords(order.billTo.contactName);
    order.shipTo.companyName = dedupeRepeatedWords(order.shipTo.companyName);
    order.shipTo.contactName = dedupeRepeatedWords(order.shipTo.contactName);

    const finalOrder = {
      ...order,
      totalQty,
      uniqueSkus,
      totalVolume: toNumber(order.pdfTotalVolume, 0) || lineVolume,
      invoiceAddressText: formatAddress(order.billTo),
      deliveryAddressText: formatAddress(order.shipTo),
      notes: [],
      warnings: order.warnings || [],
      missingProductSkus: order.missingProductSkus || []
    };

    finalOrder.notes = validateOrder(finalOrder);
    return finalOrder;
  }

  function mapExcelSourceRow(row) {
    const itemRaw = String(getValue(row, ["Item", "ItemCode", "SKU", "Sku", "Product Code"])).trim();
    const parsedItem = parseSupplierSku(itemRaw);
    const qty = toNumber(getValue(row, ["Quantity", "Qty", "QTY", "Shipped"]), 1);
    const volume = toNumber(getValue(row, ["Volume", "Volume m3", "Volume_m3", "Total Volume"]), 0);
    const unitVolume = qty > 0 && volume > 0 ? volume / qty : volume;

    return {
      orderDate: parseDateToIso(getValue(row, ["OrderDate", "Order Date", "Date"])),
      dueDate: parseDateToIso(getValue(row, ["DueDate", "Due Date", "Requested Delivery Date", "Delivery Date"])),
      salesOrderNumber: String(getValue(row, ["SalesOrderNumber", "Sales Order Number", "OrderNumber", "Order Number", "ORDER #"])).trim(),
      purchaseOrder: String(getValue(row, ["Purchase Order", "PurchaseOrder", "PO", "PO Number", "Customer PO"])).trim(),
      customer: String(getValue(row, ["Customer", "CustomerName", "Customer Name", "Retailer", "Retailer Name"])).trim(),
      itemRaw,
      itemBrand: parsedItem.brand,
      itemCode: parsedItem.sku,
      description: String(getValue(row, ["Description", "ItemName", "Item Name"])).trim(),
      quantity: qty,
      unitVolume,
      totalVolume: qty > 0 && unitVolume > 0 ? qty * unitVolume : volume,
      memo: String(getValue(row, ["Memo", "Notes"])).trim(),
      address1: String(getValue(row, ["ShipAddressLine1", "Address1", "Address Line 1"])).trim(),
      address2: String(getValue(row, ["ShipAddressLine2", "Address2", "Address Line 2"])).trim(),
      address3: String(getValue(row, ["ShipAddressLine3", "Address3", "Address Line 3"])).trim(),
      city: String(getValue(row, ["ShipCity", "City"])).trim(),
      state: String(getValue(row, ["ShipState", "County", "State"])).trim(),
      postcode: String(getValue(row, ["ShipZip", "Postcode", "Postal Code", "Zip"])).trim(),
      sosAccount: String(getValue(row, ["SosAccount", "Account"])).trim(),
      country: getDefaultCountry()
    };
  }

  function groupExcelRows(rows) {
    const mapped = rows
      .map(mapExcelSourceRow)
      .filter(r => r.salesOrderNumber || r.customer || r.itemRaw || r.itemCode);

    const groups = new Map();

    mapped.forEach((r, index) => {
      const key = r.salesOrderNumber || `MISSING-${index + 1}`;

      if (!groups.has(key)) {
        const shipTo = {
          ...buildEmptyAddress(),
          contactName: r.customer,
          companyName: r.customer,
          address1: r.address1,
          address2: r.address2,
          address3: r.address3,
          city: r.city,
          county: r.state,
          postcode: r.postcode,
          country: r.country
        };

        groups.set(key, {
          ...buildEmptyOrder(),
          sourceKind: "excel",
          sourceType: getExcelSourceType(),
          orderNumber: key,
          externalReference: key,
          orderDate: r.orderDate,
          dueDate: r.dueDate,
          purchaseOrder: r.purchaseOrder,
          retailName: r.customer,
          customerName: r.customer,
          contactName: r.customer,
          sosAccount: r.sosAccount,
          address1: r.address1,
          address2: r.address2,
          address3: r.address3,
          city: r.city,
          state: r.state,
          postcode: r.postcode,
          country: r.country,
          shipTo,
          memo: r.memo
        });
      }

      const order = groups.get(key);

      [
        "orderDate", "dueDate", "purchaseOrder", "retailName", "customerName",
        "contactName", "sosAccount", "address1", "address2", "address3",
        "city", "state", "postcode", "country", "memo"
      ].forEach(field => {
        if (!order[field] && r[field]) order[field] = r[field];
      });

      order.lines.push({
        itemRaw: r.itemRaw,
        itemBrand: r.itemBrand,
        itemCode: r.itemCode,
        description: r.description,
        quantity: Math.round(r.quantity || 1),
        unitVolume: toNumber(r.unitVolume, 0),
        totalVolume: toNumber(r.totalVolume, 0),
        sourceRow: index + 2
      });
    });

    return Array.from(groups.values()).map(finalizeOrder);
  }

  async function readExcelFile() {
    if (!selectedExcelFile) {
      showToast("Select an Excel or CSV file first.", "err");
      return;
    }

    if (!window.XLSX) throw new Error("XLSX library is not loaded.");

    currentSourceKind = "excel";
    setProgress(true, 10, "Reading Excel file...");

    const buffer = await selectedExcelFile.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    groupedOrders = groupExcelRows(rawRows);
    selectedOrderNo = groupedOrders[0]?.orderNumber || null;

    setProgress(true, 55, "Checking existing orders...");
    await markExistingOrders();

    setProgress(true, 75, "Checking product master...");
    await markMissingProducts();

    renderAll();
    setProgress(false);

    const missingCount = getAllMissingProductSkus().length;
    const warningText = missingCount ? ` ${missingCount} SKU(s) are not in product master.` : "";

    showToast(`${groupedOrders.length} unique order(s) found from ${rawRows.length} Excel row(s).${warningText}`, missingCount ? "err" : "ok");
  }

 async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js is not loaded.");

  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();

    const items = (content.items || [])
      .map(item => ({
        str: item.str || "",
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0
      }))
      .filter(item => String(item.str).trim());

    items.sort((a, b) => {
      if (Math.abs(b.y - a.y) > 3) return b.y - a.y;
      return a.x - b.x;
    });

    const lines = [];
    let currentY = null;
    let currentLine = [];

    items.forEach(item => {
      if (currentY === null || Math.abs(item.y - currentY) <= 3) {
        currentLine.push(item.str);
        currentY = currentY === null ? item.y : currentY;
      } else {
        lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim());
        currentLine = [item.str];
        currentY = item.y;
      }
    });

    if (currentLine.length) {
      lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim());
    }

    pages.push(lines.join("\n"));
  }

  return pages.join("\n");
}

async function extractPdfStructured(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js is not loaded.");

  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();

  return (content.items || [])
    .map(item => ({
      text: cleanText(item.str || ""),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0
    }))
    .filter(item => item.text);
}

function splitPdfAddressesByPosition(items) {
  items = items || [];

  const combinedHeader = items.find(item =>
    /BILL\s+TO\s+SHIP\s+TO/i.test(item.text)
  );

  const billHeader = items.find(item =>
    /^BILL\s+TO$/i.test(item.text) || /BILL\s+TO/i.test(item.text)
  );

  const shipHeader = items.find(item =>
    /^SHIP\s+TO$/i.test(item.text) || /SHIP\s+TO/i.test(item.text)
  );

  const header = combinedHeader || billHeader || shipHeader;

  const itemHeader = items.find(item =>
    /^Item/i.test(item.text) || /Item\s+Description\s+Shipped\s+Volume/i.test(item.text)
  );

  if (!header || !itemHeader) {
    return { billLines: [], shipLines: [] };
  }

  const topY = header.y;
  const bottomY = itemHeader.y;

  const addressItems = items.filter(item =>
    item.y < topY - 2 &&
    item.y > bottomY + 2
  );

  if (!addressItems.length) {
    return { billLines: [], shipLines: [] };
  }

  const minX = Math.min(...addressItems.map(item => item.x));
  const maxX = Math.max(...addressItems.map(item => item.x));
  const splitX = (minX + maxX) / 2;

  const billItems = addressItems.filter(item => item.x < splitX);
  const shipItems = addressItems.filter(item => item.x >= splitX);

  function groupLines(list) {
    const rows = [];

    list
      .slice()
      .sort((a, b) => {
        if (Math.abs(b.y - a.y) > 3) return b.y - a.y;
        return a.x - b.x;
      })
      .forEach(item => {
        let row = rows.find(r => Math.abs(r.y - item.y) <= 3);

        if (!row) {
          row = { y: item.y, parts: [] };
          rows.push(row);
        }

        row.parts.push(item);
      });

    return rows
      .sort((a, b) => b.y - a.y)
      .map(row =>
        row.parts
          .sort((a, b) => a.x - b.x)
          .map(p => p.text)
          .join(" ")
          .replace(/^,\s*/, "")
          .replace(/,$/, "")
          .trim()
      )
      .filter(Boolean);
  }

  return {
    billLines: groupLines(billItems),
    shipLines: groupLines(shipItems)
  };
}

function findLine(lines, regex) {
    return lines.find(line => regex.test(line)) || "";
  }

  function extractPostcode(text) {
    const match = String(text || "").match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    return match ? match[1].toUpperCase().replace(/\s+/, " ") : "";
  }

function extractOrderNumber(lines, text) {
  const fullText = String(text || "");

  /*
   * Herken:
   * ACK1211
   * ACK1211-1
   * REP1429
   * REP1429-2
   * DIS1442
   */
  let match = fullText.match(
    /\b((?:ACK|REP|DIS)\s*-?\s*\d+(?:-\d+)?)\b/i
  );

  if (match) {
    return match[1]
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  /*
   * Voorbeeld:
   * 04/08/2026 ACK1211-1
   */
  match = fullText.match(
    /\b\d{1,2}\/\d{1,2}\/\d{4}\s+([A-Z]{2,}\s*-?\s*\d+(?:-\d+)?)\b/i
  );

  if (match) {
    return match[1]
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  /*
   * ORDER #
   */
  match = fullText.match(
    /ORDER\s*#(?:\s+\d{1,2}\/\d{1,2}\/\d{4})?\s+([A-Z]{2,}\s*-?\s*\d+(?:-\d+)?)/i
  );

  if (match) {
    return match[1]
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  return "";
}

function extractOrderDate(lines, text) {
  const fullText = String(text || "");

  let match = fullText.match(
    /DATE\s*(?:ORDER\s*#)?\s*[\r\n\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i
  );

  if (match) {
    return parseDateToIso(match[1]);
  }

  match = fullText.match(
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/
  );

  if (match) {
    return parseDateToIso(match[1]);
  }

  return null;
}

function extractPurchaseOrder(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .find(line => /Purchase\s+Order\s*:/i.test(line));

  if (!line) return "";

  return line
    .replace(/.*Purchase\s+Order\s*:/i, "")
    .trim();
}

function splitBillShipBlock(lines) {
  const start = lines.findIndex(line =>
    /BILL\s+TO\s+SHIP\s+TO/i.test(cleanText(line))
  );

  const end = lines.findIndex(line =>
    /^Item\s+Description\s+Shipped\s+Volume/i.test(cleanText(line))
  );

  if (start < 0 || end <= start) {
    return { billLines: [], shipLines: [] };
  }

  const block = lines
    .slice(start + 1, end)
    .map(line => cleanText(line).replace(/^,\s*/, "").replace(/,$/, ""))
    .filter(Boolean);

  const firstLine = block[0] || "";

  const secondStart = block.findIndex((line, index) =>
    index > 0 && normalize(line) === normalize(firstLine)
  );

  if (secondStart > 0) {
    return {
      billLines: block.slice(0, secondStart),
      shipLines: block.slice(secondStart).filter(line => {
        const txt = cleanText(line);
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(txt)) return false;
        if (/^\+?\d[\d\s().-]{7,}\d$/i.test(txt)) return false;
        return true;
      })
    };
  }

  return {
    billLines: [],
    shipLines: block
  };
}
function parseAddressBlock(blockLines, allLines) {
  const address = buildEmptyAddress();

  const lines = (blockLines || [])
    .map(line => cleanText(line).replace(/^,\s*/, "").replace(/,$/, ""))
    .filter(Boolean);

  const split = splitContactFromAddressParts(lines);
  const addressLinesOnly = split.addressParts;

  const emailLine = allLines.find(line =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(cleanText(line))
  ) || "";

  const phoneLine = allLines.find(line =>
    /^\+?\d[\d\s().-]{5,}$/i.test(cleanText(line))
  ) || "";

  address.email = cleanText(emailLine || split.email);
  address.phone = cleanText(phoneLine || split.phone);

  address.contactName =
    dedupeRepeatedWords(addressLinesOnly[0] || "");

  address.companyName =
    dedupeRepeatedWords(addressLinesOnly[1] || addressLinesOnly[0] || "");

  const addressOnly = addressLinesOnly
    .slice(2)
    .filter(line => !/^(UK|United Kingdom)$/i.test(line));

  const uniqueAddressLines = [];
  const seen = new Set();

const billToRejectKeys = new Set([
  "277wenningtonrd",
  "pr97tw",
  "southport",
  "essex",
  "southportessexpr97tw"
]);

  addressOnly.forEach(line => {
    const cleaned = cleanText(line)
  .replace(/^United Kingdom\s*/i, "")
  .replace(/\s*United Kingdom$/i, "")
  .trim();
    const key = dedupeKey(cleaned);

  if (!cleaned || !key || seen.has(key) || billToRejectKeys.has(key)) return;

    seen.add(key);
    uniqueAddressLines.push(cleaned);
  });

  const postcodeLineIndex =
    uniqueAddressLines.findIndex(line => extractPostcode(line));

  const postcodeLine =
    postcodeLineIndex >= 0
      ? uniqueAddressLines[postcodeLineIndex]
      : "";

  address.postcode =
    extractPostcode(
      postcodeLine || uniqueAddressLines.join(" ")
    );

if (postcodeLineIndex >= 0) {
  const postcodeLine = uniqueAddressLines[postcodeLineIndex];

  const postcode = extractPostcode(postcodeLine);
  const cityFromPostcodeLine = cleanText(
    postcodeLine.replace(postcode, "").replace(/,+$/g, "")
  );

  address.city = cityFromPostcodeLine || "";

  const remaining = uniqueAddressLines.filter((_, idx) =>
    idx !== postcodeLineIndex
  );

  address.address1 = remaining[0] || "";
  address.address2 = remaining[1] || "";
  address.address3 = remaining[2] || "";
  address.address4 = remaining.slice(3).join(", ");
}

 else {

    address.address1 = uniqueAddressLines[0] || "";
address.address2 = uniqueAddressLines[1] || "";
address.address3 = uniqueAddressLines[2] || "";
address.address4 = uniqueAddressLines.slice(3).join(", ");

  }

  address.country = getDefaultCountry();

  return address;
}

function parsePdfAddresses(lines) {
  const structuredItems = window.__lastPdfStructuredItems || [];
  const split = splitPdfAddressesByPosition(structuredItems);

  if (!split.shipLines.length) {
    throw new Error("SHIP TO block could not be read by PDF position.");
  }

  return {
    billToFromPdf: parseAddressBlock(split.billLines, lines),
    shipTo: parseAddressBlock(split.shipLines, lines)
  };
}
  function extractItemLines(lines) {
    const start = lines.findIndex(line => /^Item\s+Description\s+Shipped\s+Volume/i.test(cleanText(line)));
    if (start < 0) return [];

    const result = [];

    for (let i = start + 1; i < lines.length; i++) {
      const line = cleanText(lines[i]);

      if (!line) continue;
      if (/^Total\s+Volume/i.test(line)) break;
if (/^Total\s+\d+/i.test(line)) break;
if (/Customer Notes/i.test(line)) break;
if (/All deliveries must/i.test(line)) break;
      if (/^Purchase\s+Order/i.test(line)) break;
      if (/^Shipped\s+Via/i.test(line)) break;
      if (/^Tracking\s+Number/i.test(line)) break;

      result.push(line);
    }

    return result;
  }

function parsePdfProductLines(lines) {
  const raw = extractItemLines(lines);
  const rows = [];

  let currentRow = null;

  const skuRegex = /^([A-Z0-9]{3,})\b\s*(.*)$/;
  const valuesOnlyRegex =
    /^(-?\d+)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)$/;

  const completeRowRegex =
    /^([A-Z0-9]{3,})\b\s+(.*?)\s+(-?\d+)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)$/;

  raw.forEach((rawLine, rawIndex) => {
    const line = cleanText(rawLine);

    if (!line) return;

    /*
     * Situatie 1:
     * SKU, omschrijving, quantity, volume en gewicht
     * staan allemaal op dezelfde regel.
     */
    const completeMatch = line.match(completeRowRegex);

    if (completeMatch) {
      if (currentRow) {
        rows.push(currentRow);
        currentRow = null;
      }

      rows.push({
        itemRaw: line,
        itemBrand: "",
        itemCode: completeMatch[1].trim(),
        description: cleanText(completeMatch[2]),
        quantity: Math.round(toNumber(completeMatch[3], 0)),
        totalVolume: toNumber(completeMatch[4], 0),
        totalWeight: toNumber(completeMatch[5], 0),
        sourceRow: rawIndex + 1,
        parseError: ""
      });

      return;
    }

    /*
     * Situatie 2:
     * Nieuwe productregel begint met een SKU,
     * maar de cijfers staan mogelijk later.
     */
    const skuMatch = line.match(skuRegex);

    if (skuMatch) {
      if (currentRow) {
        rows.push(currentRow);
      }

      currentRow = {
        itemRaw: line,
        itemBrand: "",
        itemCode: skuMatch[1].trim(),
        descriptionParts: [
          cleanText(skuMatch[2])
        ].filter(Boolean),
        quantity: null,
        totalVolume: null,
        totalWeight: null,
        sourceRow: rawIndex + 1,
        parseError: ""
      };

      return;
    }

    /*
     * Situatie 3:
     * Regels zoals:
     * 1 0.74 85.9
     */
    const valuesMatch = line.match(valuesOnlyRegex);

    if (valuesMatch && currentRow) {
      currentRow.quantity =
        Math.round(toNumber(valuesMatch[1], 0));

      currentRow.totalVolume =
        toNumber(valuesMatch[2], 0);

      currentRow.totalWeight =
        toNumber(valuesMatch[3], 0);

      currentRow.itemRaw += ` ${line}`;

      rows.push(currentRow);
      currentRow = null;

      return;
    }

    /*
     * Situatie 4:
     * Een extra regel van de omschrijving,
     * bijvoorbeeld "Dew Haze".
     */
    if (currentRow) {
      currentRow.descriptionParts.push(line);
      currentRow.itemRaw += ` ${line}`;
    }
  });

  if (currentRow) {
    rows.push(currentRow);
  }

  const skipZeroQty =
    getCheckbox("optSkipZeroQtyPdfLines", true);

  return rows
    .map((row, index) => {
      /*
       * Regels die al compleet waren.
       */
      if (
        !Array.isArray(row.descriptionParts)
      ) {
        const qty =
          Math.round(toNumber(row.quantity, 0));

        const totalVolume =
          toNumber(row.totalVolume, 0);

        const totalWeight =
          toNumber(row.totalWeight, 0);

        const description =
          cleanText(row.description || "");

        return {
          itemRaw: row.itemRaw,
          itemBrand:
            description.split(" ")[0] || "",
          itemCode: row.itemCode,
          description,
          quantity: qty,
          unitVolume:
            qty > 0
              ? totalVolume / qty
              : 0,
          unitWeight:
            qty > 0
              ? totalWeight / qty
              : 0,
          totalVolume,
          totalWeight,
          sourceRow:
            row.sourceRow || index + 1,
          parseError: ""
        };
      }

      const description =
        cleanText(
          row.descriptionParts.join(" ")
        );

      const qty =
        Math.round(
          toNumber(row.quantity, 0)
        );

      const totalVolume =
        toNumber(row.totalVolume, 0);

      const totalWeight =
        toNumber(row.totalWeight, 0);

      const hasAllValues =
        row.quantity !== null &&
        row.totalVolume !== null &&
        row.totalWeight !== null;

      if (!hasAllValues) {
        return {
          itemRaw: row.itemRaw,
          itemBrand:
            description.split(" ")[0] || "",
          itemCode: row.itemCode,
          description,
          quantity: 0,
          unitVolume: 0,
          unitWeight: 0,
          totalVolume: 0,
          totalWeight: 0,
          sourceRow:
            row.sourceRow || index + 1,
          parseError:
            "Could not find shipped quantity, volume and weight"
        };
      }

      return {
        itemRaw: row.itemRaw,
        itemBrand:
          description.split(" ")[0] || "",
        itemCode: row.itemCode,
        description,
        quantity: qty,
        unitVolume:
          qty > 0
            ? totalVolume / qty
            : 0,
        unitWeight:
          qty > 0
            ? totalWeight / qty
            : 0,
        totalVolume,
        totalWeight,
        sourceRow:
          row.sourceRow || index + 1,
        parseError: ""
      };
    })
    .filter(line => {
      if (line.parseError) return true;

      if (
        skipZeroQty &&
        toNumber(line.quantity, 0) <= 0
      ) {
        return false;
      }

      return true;
    });
}
  function extractTotalVolume(text) {
    const match = String(text || "").match(/Total\s+Volume\s+(\d+(?:[.,]\d+)?)/i);
    return match ? toNumber(match[1], 0) : 0;
  }

function addDaysToIsoDate(isoDate, days) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate || null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function resolveZoyCustomerItemSku(customerItemText) {
  const text = normalize(customerItemText)
    .replace(/\s+/g, " ")
    .trim();

  const aliases = [
    {
      match: /utah\s+chair/i,
      sku: "5578/1"
    },
    {
      match: /utah\s+(?:2|two)\s*seater/i,
      sku: "5578/2"
    },
    {
      match: /utah\s+(?:3|three)\s*seater/i,
      sku: "5578/3"
    }
  ];

  const alias = aliases.find(row => row.match.test(text));
  return alias?.sku || "";
}

function deriveZoyInternalSku(supplierSku, customerItem = "") {
  const supplier = String(supplierSku || "")
    .trim()
    .toUpperCase();

  /*
   * Voorbeelden:
   * RD5578DX51D  -> 5578/1
   * RD5578DX52D  -> 5578/2
   * RD5578DX53D  -> 5578/3
   * RD5256IF51D  -> 5256/1
   * RD5256IF52DM -> 5256/2
   */
  const modelMatch = supplier.match(/^RD(\d{4})/i);

  if (!modelMatch) {
    return resolveZoyCustomerItemSku(customerItem);
  }

  const model = modelMatch[1];

  /*
   * 51 = chair
   * 52 = 2-seater
   * 53 = 3-seater
   */
  const typeMatch = supplier.match(/5([123])(?=[A-Z]|$)/i);

  if (typeMatch) {
    return `${model}/${typeMatch[1]}`;
  }

  const customerText = normalize(customerItem);

  if (/\bchair\b/i.test(customerText)) {
    return `${model}/1`;
  }

  if (
    /\b(?:2|two)\s*(?:str|seater)\b/i.test(customerText)
  ) {
    return `${model}/2`;
  }

  if (
    /\b(?:3|three)\s*(?:str|seater)\b/i.test(customerText)
  ) {
    return `${model}/3`;
  }

  return model;
}

function parseZoyProductLines(lines) {
  const productLines = [];

  const startIndex = lines.findIndex(line => {
    const value = cleanText(line);

    return (
      /ZOY ITEM#/i.test(value) &&
      /QTY/i.test(value)
    );
  });

  if (startIndex < 0) {
    return productLines;
  }

  const relevantLines = [];

  for (
    let index = startIndex + 1;
    index < lines.length;
    index++
  ) {
    const line = cleanText(lines[index]);

    if (!line) continue;

    if (
      /^Total\b/i.test(line) ||
      /^REMARK\b/i.test(line)
    ) {
      break;
    }

    relevantLines.push(line);
  }

  let buffer = "";

  relevantLines.forEach((line, index) => {
    /*
     * Shipping surcharge is geen productregel.
     */
    if (
      /^Surcharge\b/i.test(line) ||
      /Shipping Surcharge/i.test(line)
    ) {
      buffer = "";
      return;
    }

    buffer = cleanText(
      [buffer, line]
        .filter(Boolean)
        .join(" ")
    );

    /*
     * Voorbeeld:
     *
     * Henley Henley 2str RD5256IF52DM
     * 2str Power reclining 1 1 £329.00 £329.00
     *
     * PDF.js kan dit als één of meerdere regels uitlezen.
     */
    const match = buffer.match(
      /^(.+?)\s+(RD[A-Z0-9]+)\s+(.+?)\s+(\d+)\s+(\d+)\s+£\s*([\d,.]+)\s+£\s*([\d,.]+)$/i
    );

    if (!match) {
      return;
    }

    const customerItemRaw = cleanText(match[1]);
    const supplierSku = cleanText(match[2]).toUpperCase();
    const productDescription = cleanText(match[3]);

    const quantity = Math.max(
      1,
      Math.round(
        toNumber(match[4], 1)
      )
    );

    const packagesFromPdf = Math.max(
      1,
      Math.round(
        toNumber(match[5], quantity)
      )
    );

    /*
     * "Henley Henley 2str"
     * wordt "Henley 2str".
     */
    const customerItem = customerItemRaw.replace(
      /^([A-Za-z0-9_-]+)\s+\1\b/i,
      "$1"
    );

    const internalSku = deriveZoyInternalSku(
      supplierSku,
      customerItem
    );

    productLines.push({
      itemRaw: buffer,
      itemBrand: "Zoy",

      itemCode: internalSku,
      customerItem,
      supplierSku,

      description: cleanText(
        `${customerItem} - ${productDescription}`
      ),

      quantity,
      packagesFromPdf,

      unitVolume: 0,
      unitWeight: 0,
      totalVolume: 0,
      totalWeight: 0,

      sourceRow: index + 1,

      parseError: internalSku
        ? ""
        : `Could not derive product SKU from ${supplierSku}`
    });

    buffer = "";
  });

  return productLines;
}

function parseZoyPdfOrder(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(cleanText)
    .filter(Boolean);

  const fullText = lines.join("\n");
  const structuredItems =
    window.__lastPdfStructuredItems || [];

  function getValueRightOfLabel(labelRegex) {
    const label = structuredItems.find(item =>
      labelRegex.test(cleanText(item.text))
    );

    if (!label) {
      return "";
    }

    const candidates = structuredItems
      .filter(item =>
        item.x > label.x &&
        Math.abs(item.y - label.y) <= 5 &&
        cleanText(item.text)
      )
      .sort((a, b) => a.x - b.x);

    return cleanText(candidates[0]?.text || "");
  }

  /*
   * Ordergegevens.
   */
  const orderDateRaw =
    getValueRightOfLabel(/^Order date:?$/i) ||
    (
      fullText.match(
        /Order date:\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i
      ) || []
    )[1] ||
    "";

  const customerOrderNo =
    getValueRightOfLabel(/^Customer order No:?$/i);

  const zoyReference =
    getValueRightOfLabel(/^Zoy reference No:?$/i);

  const leadTimeRaw =
    getValueRightOfLabel(/^Estimated lead time:?$/i);

  const orderDate = parseDateToIso(orderDateRaw);

  const leadWeeksMatch =
    String(leadTimeRaw || "").match(/(\d+)/);

  const leadWeeks = leadWeeksMatch
    ? Math.max(
        0,
        Math.round(
          toNumber(leadWeeksMatch[1], 3)
        )
      )
    : 3;

  const dueDate = orderDate
    ? addDaysToIsoDate(
        orderDate,
        leadWeeks * 7
      )
    : null;

  /*
   * Retailerregel zoeken.
   *
   * In deze PDF:
   * Richard F Mackay, 60 Stevenson Rd,
   * Edinburgh EH11 2SG
   */
  const customerLine = lines.find(line =>
    extractPostcode(line) &&
    !/HONG KONG|CANMOV|HANG WAI|TUEN MUN/i.test(line) &&
    !/^Unit\s+/i.test(line)
  ) || "";

  const retailName =
    dedupeRepeatedWords(
      customerLine.split(",")[0] || ""
    ) ||
    "Unknown retailer";

  /*
   * Afleveradres zoeken.
   *
   * In deze PDF:
   * Unit 4/3 Borthwick View, Loanhead,
   * Edinburgh, EH20 9QH
   */
  const deliveryStartIndex = lines.findIndex(line =>
    /^Unit\s+/i.test(line) ||
    (
      /Deliveries:/i.test(line) &&
      extractPostcode(line)
    )
  );

  let deliveryEndIndex = lines.findIndex(
    (line, index) =>
      index > deliveryStartIndex &&
      (
        /Terms of payment:/i.test(line) ||
        /^ZOY ITEM#/i.test(line) ||
        /^Henley\b/i.test(line) ||
        /^Utah\b/i.test(line)
      )
  );

  if (deliveryEndIndex < 0) {
    deliveryEndIndex = lines.length;
  }

  const retailerBlock =
    deliveryStartIndex >= 0
      ? cleanText(
          lines
            .slice(
              deliveryStartIndex,
              deliveryEndIndex
            )
            .join(" ")
        )
      : customerLine;

  const postcode = extractPostcode(
    retailerBlock ||
    customerLine ||
    fullText
  );

  const email =
    (
      fullText.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
      ) || []
    ).find(value =>
      !/zoy-living|zoyuk|ordersuk/i.test(value)
    ) || "";

  const phone =
    (
      retailerBlock.match(
        /(?:\+?\d[\d\s().-]{7,}\d)/
      ) || []
    )[0] || "";

  const cityMatch =
    retailerBlock.match(
      /,\s*([^,]+),?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i
    );

  const city = cleanText(
    cityMatch?.[1] || ""
  );

  const shipTo = {
    ...buildEmptyAddress(),

    contactName: retailName,
    companyName: retailName,

    address1: retailerBlock,
    address2: "",
    address3: "",
    address4: "",

    city,
    county: "",

    postcode,
    country: getDefaultCountry(),

    email,
    phone
  };

  /*
   * Productregels uitlezen.
   */
  const productLines =
    parseZoyProductLines(lines);

  /*
   * Orderobject opbouwen.
   */
  const order = {
    ...buildEmptyOrder(),

    sourceKind: "pdf",
    sourceType: "zoy_order_ack_pdf",

    orderNumber: zoyReference,
    externalReference: zoyReference,
    purchaseOrder: customerOrderNo,

    orderDate,
    dueDate,

    retailName,
    customerName: retailName,
    contactName: retailName,

    address1: shipTo.address1,
    address2: shipTo.address2,
    address3: shipTo.address3,

    city: shipTo.city,
    state: shipTo.county,
    postcode: shipTo.postcode,
    country: shipTo.country,

    email: shipTo.email,
    phone: shipTo.phone,

    shipTo,

    memo: [
      customerOrderNo
        ? `Customer order No: ${customerOrderNo}`
        : "",

      zoyReference
        ? `Zoy reference No: ${zoyReference}`
        : "",

      `Estimated lead time: ${leadWeeks} weeks`
    ]
      .filter(Boolean)
      .join(" | "),

    pdfTotalVolume: 0,
    lines: productLines
  };

  const finalOrder =
    finalizeOrder(order);

  const parseErrors = productLines
    .map(line => line.parseError)
    .filter(Boolean);

  finalOrder.notes = [
    ...new Set([
      ...(finalOrder.notes || []),
      ...parseErrors
    ])
  ];

  return [finalOrder];
}

  function parsePackingSlip(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean);

    const { billToFromPdf, shipTo } = parsePdfAddresses(lines);
console.log("=== BILL TO ===");
console.log(billToFromPdf);

console.log("=== SHIP TO ===");
console.log(shipTo);

console.log("=== PDF LINES ===");
console.log(lines);
console.log("BILL TO", billToFromPdf);
console.log("SHIP TO", shipTo);
console.log(lines);
    const orderNumber = extractOrderNumber(lines, text);
    const orderDate = extractOrderDate(lines, text);
    const purchaseOrder = extractPurchaseOrder(text);
    const pdfTotalVolume = extractTotalVolume(text);
    const productLines = parsePdfProductLines(lines);

    const retailName = dedupeRepeatedWords(shipTo.companyName || shipTo.contactName || "Unknown retailer");
    const contactName = dedupeRepeatedWords(shipTo.contactName || "");

    const order = {
      ...buildEmptyOrder(),
      sourceKind: "pdf",
      sourceType: getPdfSourceType(),
      orderNumber,
      externalReference: orderNumber,
      purchaseOrder,
      orderDate,
      dueDate: orderDate,

      retailName,
      customerName: retailName,
      contactName,

      address1: shipTo.address1,
      address2: shipTo.address2,
      address3: shipTo.address3,
      city: shipTo.city,
      state: shipTo.county,
      postcode: shipTo.postcode,
      country: shipTo.country,
      email: shipTo.email || billToFromPdf.email,
      phone: shipTo.phone || billToFromPdf.phone,

      shipTo,

      memo: purchaseOrder ? `Purchase Order: ${purchaseOrder}` : "",
      pdfTotalVolume,
      lines: productLines
    };

    const parseErrors = productLines.filter(line => line.parseError).map(line => line.parseError);
    const finalOrder = finalizeOrder(order);
    finalOrder.notes = [...new Set([...(finalOrder.notes || []), ...parseErrors])];

    return [finalOrder];
  }

 async function readPdfFile() {
  if (!selectedPdfFiles.length) {
    showToast(
      "Select or drop one or more PDF packing slips first.",
      "err"
    );
    return;
  }

  if (!getSelectedProductOwner()) {
    showToast(
      "Select a product owner first.",
      "err"
    );
    return;
  }

  currentSourceKind = "pdf";

  const allOrders = [];
  const allRawRows = [];
  const extractedTexts = [];

  for (let fileIndex = 0; fileIndex < selectedPdfFiles.length; fileIndex++) {
    const pdfFile = selectedPdfFiles[fileIndex];

    const startPct = Math.round(
      (fileIndex / selectedPdfFiles.length) * 60
    );

    setProgress(
      true,
      Math.max(5, startPct),
      `Reading PDF ${fileIndex + 1}/${selectedPdfFiles.length}: ${pdfFile.name}`
    );

    try {
      /*
       * De bestaande parser gebruikt deze global voor
       * de positionele BILL TO / SHIP TO herkenning.
       * Daarom zetten we hem per PDF opnieuw.
       */
      window.__lastPdfStructuredItems =
        await extractPdfStructured(pdfFile);

      const pdfText =
        await extractPdfText(pdfFile);

      extractedTexts.push(
        `===== ${pdfFile.name} =====\n${pdfText}`
      );

      const pdfRows = pdfText
        .split(/\r?\n/)
        .filter(Boolean);

      allRawRows.push(...pdfRows);

      /*
       * Zoy houdt zijn eigen parser.
       * Bellstone gebruikt de bestaande packing slip parser.
       */
      const parsedOrders = isZoyOwner()
        ? parseZoyPdfOrder(pdfText)
        : parsePackingSlip(pdfText);

      /*
       * Cruciaal voor bulkimport:
       * iedere order onthoudt uit welke PDF hij afkomstig is.
       */
      parsedOrders.forEach(order => {
        order.sourcePdfFile = pdfFile;
        order.sourcePdfName = pdfFile.name;

        allOrders.push(order);
      });

    } catch (error) {
      console.error(
        `PDF parsing failed for ${pdfFile.name}`,
        error
      );

      /*
       * Eén fout PDF-bestand mag de andere PDF's
       * niet blokkeren.
       */
      const failedOrder = {
        ...buildEmptyOrder(),
        sourceKind: "pdf",
        sourceType: getPdfSourceType(),
        orderNumber: `ERROR-${fileIndex + 1}`,
        externalReference: `ERROR-${fileIndex + 1}`,
        sourcePdfFile: pdfFile,
        sourcePdfName: pdfFile.name,
        failed: true,
        notes: [
          `Could not read ${pdfFile.name}: ${error.message || "Unknown PDF error"}`
        ],
        warnings: [],
        lines: []
      };

      allOrders.push(failedOrder);
    }
  }

  /*
   * Pas nadat alle bestanden zijn gelezen vervangen we
   * de preview. Zo komen alle PDF-orders samen in één overzicht.
   */
  groupedOrders = allOrders;
  rawRows = allRawRows;

  lastPdfText = extractedTexts.join(
    "\n\n"
  );

  const textArea =
    byId("pdfExtractedText");

  if (textArea) {
    textArea.value = lastPdfText;
  }

  setProgress(
    true,
    65,
    "Loading product data..."
  );

  /*
   * Volume, gewicht, packages en tarieven voor alle
   * geïmporteerde PDF-orders in één keer ophalen.
   */
  await enrichPreviewOrdersWithProductData();

  selectedOrderNo =
    groupedOrders[0]?.orderNumber ||
    null;

  setProgress(
    true,
    78,
    "Checking existing orders..."
  );

  await markExistingOrders();

  setProgress(
    true,
    90,
    "Checking product master..."
  );

  await markMissingProducts();

  renderAll();

  setProgress(
    false
  );

  const missingCount =
    getAllMissingProductSkus().length;

  const warningText =
    missingCount
      ? ` ${missingCount} SKU(s) are not in product master.`
      : "";

  const failedCount =
    groupedOrders.filter(order =>
      order.failed ||
      (order.notes || []).some(note =>
        String(note).startsWith("Could not read ")
      )
    ).length;

  const failedText =
    failedCount
      ? ` ${failedCount} PDF(s) could not be parsed correctly.`
      : "";

  showToast(
    `${groupedOrders.length} order(s) found from ${selectedPdfFiles.length} PDF file(s).${warningText}${failedText}`,
    missingCount || failedCount ? "err" : "ok"
  );
}


function getSalesOrderPrefix() {
  return settingsMap.get("sales_order_prefix") || "SO-";
}

function getSalesOrderPadding() {
  return Math.max(1, Math.round(toNumber(settingsMap.get("sales_order_padding"), 5)));
}

function getNextSalesOrderNumber() {
  return Math.max(1, Math.round(toNumber(settingsMap.get("next_sales_order_number"), 1)));
}

function formatSalesOrderNumber(number) {
  return `${getSalesOrderPrefix()}${String(number).padStart(getSalesOrderPadding(), "0")}`;
}

async function reserveSalesOrderNumber() {
  const cid = await getCompanyId();
  const current = getNextSalesOrderNumber();
  const soNumber = formatSalesOrderNumber(current);
  const next = String(current + 1);

  const { error } = await client
    .from("settings")
    .upsert({
      company_id: cid,
      setting_key: "next_sales_order_number",
      setting_value: next
    }, { onConflict: "company_id,setting_key" });

  if (error) throw error;

  settingsMap.set("next_sales_order_number", next);

  return soNumber;
}

  async function markExistingOrders() {
  if (!groupedOrders.length) return;

  const cid = await getCompanyId();

  const refs = groupedOrders
    .map(o => o.externalReference || o.orderNumber)
    .filter(Boolean);

  if (!refs.length) return;

  const { data, error } = await client
    .from("orders")
    .select("id, order_number, external_reference")
    .eq("company_id", cid)
    .in("external_reference", refs);

  if (error) throw error;

  const existingMap = new Map(
    (data || []).map(r => [String(r.external_reference), r])
  );

  groupedOrders = groupedOrders.map(o => {
    const ref = String(o.externalReference || o.orderNumber || "");
    const existing = existingMap.get(ref);

    return {
      ...o,
      existing: !!existing,
      existingOrderId: existing?.id || null,
      existingOrderNumber: existing?.order_number || null,
      importAnyway: false
    };
  });
}

  async function markMissingProducts() {
    if (!groupedOrders.length) return;

    const cid = await getCompanyId();
    const owner = getSelectedProductOwner();

    const skus = [...new Set(
      groupedOrders
        .flatMap(order => order.lines || [])
        .map(line => String(line.itemCode || "").trim())
        .filter(Boolean)
    )];

    if (!skus.length) return;

    let query = client
      .from("products")
      .select("id, sku_base, customer_id")
      .eq("company_id", cid)
      .in("sku_base", skus);

    const { data, error } = await query;

    if (error) throw error;

    const foundSkus = new Set((data || []).map(row => normalize(row.sku_base)));

groupedOrders = groupedOrders.map(order => {

  if (
    normalize(order.movementType) ===
    "collection"
  ) {
    return {
      ...order,
      missingProductSkus: [],
      warnings: []
    };
  }

  const missing = [...new Set(
        (order.lines || [])
          .map(line => String(line.itemCode || "").trim())
          .filter(sku => sku && !foundSkus.has(normalize(sku)))
      )];

      return {
        ...order,
        missingProductSkus: missing,
        warnings: missing.length
          ? [`Product(s) not found in master data for selected product owner: ${missing.join(", ")}`]
          : []
      };
    });
  }

  function getAllMissingProductSkus() {
    return [...new Set(
      groupedOrders
        .flatMap(order => order.missingProductSkus || [])
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
  }

  function canImportOrder(order) {
    if (order.notes.length) return false;
    if (order.imported) return false;
    if (order.existing && getCheckbox("optSkipExisting", true) && !order.importAnyway) return false;
    return true;
  }

  function statusPill(order) {
    if (order.imported) return `<span class="pill pill-ok">Imported</span>`;
    if (order.failed) return `<span class="pill pill-err">Failed</span>`;
    if (order.existing && order.importAnyway) return `<span class="pill pill-blue">Import confirmed</span>`;
    if (order.existing) return `<span class="pill pill-warn">Already exists</span>`;
    if (order.notes.length) return `<span class="pill pill-err">Check</span>`;
    if (order.missingProductSkus?.length) return `<span class="pill pill-warn">Product warning</span>`;
    return `<span class="pill pill-ok">Ready</span>`;
  }

  function renderKpis() {
    const existing = groupedOrders.filter(o => o.existing).length;
    const ready = groupedOrders.filter(canImportOrder).length;
    const skus = new Set();

    groupedOrders.forEach(order => {
      order.lines.forEach(line => {
        if (line.itemCode) skus.add(line.itemCode);
      });
    });

    setText("kpiRows", formatNumber(rawRows.length));
    setText("kpiOrders", formatNumber(groupedOrders.length));
    setText("kpiLines", formatNumber(groupedOrders.reduce((sum, o) => sum + o.lines.length, 0)));
    setText("kpiSkus", formatNumber(skus.size));
    setText("kpiReady", formatNumber(ready));
    setText("kpiExisting", formatNumber(existing));

    const missingSkus = getAllMissingProductSkus();
    const sourceLabel = currentSourceKind ? `Source: ${currentSourceKind.toUpperCase()}` : "Source: —";
    const productWarning = missingSkus.length ? ` · Missing products: ${missingSkus.length}` : "";

    setText("previewMeta", groupedOrders.length ? `${formatNumber(groupedOrders.length)} unique order(s)${productWarning}` : "No preview loaded.");
    setText("previewSourceLabel", sourceLabel);
  }

function renderTable() {
  const tbody = byId("ordersPreviewBody");

  if (!tbody) return;

  if (!groupedOrders.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="15">
          Upload an Excel file or PDF packing slip and click Read.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML = groupedOrders.map(order => {
    const disabled =
      !order.existing ||
      order.imported ||
      order.notes.length
        ? "disabled"
        : "";

    const checked =
      order.importAnyway
        ? "checked"
        : "";

    const exampleLine =
      order.lines.find(line => line.itemCode) ||
      order.lines[0] ||
      {};

    const source =
      order.sourceKind ||
      currentSourceKind ||
      "—";

    const retailerCode =
      makeRetailerCode(
        order.shipTo?.postcode ||
        order.postcode,
        order.retailName ||
        order.customerName
      );

    const warningText =
      (order.warnings || []).join(" · ");

    const noteText =
      order.importMessage ||
      order.notes.join(" · ") ||
      warningText ||
      order.memo ||
      (
        order.existing
          ? "Manual confirmation required"
          : "—"
      );

    return `
      <tr
        data-order-no="${escapeHtml(order.orderNumber)}"
        class="${
          String(selectedOrderNo) ===
          String(order.orderNumber)
            ? "active"
            : ""
        }"
      >
        <td>
          ${
            order.existing
              ? `
                <label
                  class="checkbox-row"
                  style="margin:0;"
                >
                  <input
                    class="import-anyway-check"
                    type="checkbox"
                    data-order-no="${escapeHtml(order.orderNumber)}"
                    ${checked}
                    ${disabled}
                  />

                  <span>
                    Import anyway
                  </span>
                </label>
              `
              : `
                <span class="pill pill-ok">
                  New
                </span>
              `
          }
        </td>

        <td>
          ${escapeHtml(source)}
        </td>

        <td>
          <strong>
            ${escapeHtml(order.orderNumber || "—")}
          </strong>

          <span class="subline">
            PO: ${escapeHtml(order.purchaseOrder || "Unknown")}
          </span>
        </td>

        <td>
          ${escapeHtml(order.purchaseOrder || "Unknown")}
        </td>

        <td>
          <strong>
            ${escapeHtml(
              order.retailName ||
              order.customerName ||
              "—"
            )}
          </strong>

          <span class="subline">
            Retailer / delivery customer
          </span>

          <span class="subline">
            Retailer Code:
            ${escapeHtml(retailerCode)}
          </span>

          ${
            order.contactName
              ? `
                <span class="subline">
                  Contact:
                  ${escapeHtml(order.contactName)}
                </span>
              `
              : ""
          }
        </td>

        <td class="address-cell">
          ${escapeHtml(
            order.invoiceAddressText ||
            "—"
          )}

          <span class="subline">
            From Settings / Product Owner
          </span>
        </td>

        <td class="address-cell">
          ${escapeHtml(
            order.deliveryAddressText ||
            "—"
          )}

          <span class="subline">
            Retailer delivery address
          </span>
        </td>

        <!--
          Dit is uitsluitend de echte orderdatum uit de PDF.
          Voor deze Zoy-order is dat 23/07/2026.
        -->
        <td class="date-cell">
          ${escapeHtml(
            displayDate(order.orderDate)
          )}
        </td>

        <td>
          ${formatNumber(order.lines.length)}
        </td>

        <td>
          ${formatNumber(order.totalQty)}
        </td>

        <td>
          ${formatNumber(order.uniqueSkus)}
        </td>

        <td>
          ${formatVolume(order.totalVolume)}
        </td>

        <td>
          <strong>
            ${escapeHtml(
              exampleLine.itemCode ||
              "—"
            )}
          </strong>

          <span class="subline">
            ${escapeHtml(
              exampleLine.itemBrand ||
              ""
            )}
          </span>
        </td>

        <td>
          ${statusPill(order)}
        </td>

        <td>
          ${escapeHtml(noteText)}
        </td>
      </tr>
    `;
  }).join("");

  tbody
    .querySelectorAll("tr[data-order-no]")
    .forEach(tr => {
      tr.addEventListener(
        "click",
        event => {
          if (event.target.closest("input")) {
            return;
          }

          selectedOrderNo =
            tr.dataset.orderNo;

          renderAll();
        }
      );
    });

  tbody
    .querySelectorAll(".import-anyway-check")
    .forEach(input => {
      input.addEventListener(
        "click",
        event => {
          event.stopPropagation();
        }
      );

      input.addEventListener(
        "change",
        () => {
          const order =
            groupedOrders.find(row =>
              String(row.orderNumber) ===
              String(input.dataset.orderNo)
            );

          if (order) {
            order.importAnyway =
              input.checked;
          }

          renderAll();
        }
      );
    });
}

  function renderDetail() {
    const order = groupedOrders.find(o => String(o.orderNumber) === String(selectedOrderNo));
    const empty = byId("detailEmpty");
    const body = byId("detailBody");

    if (!order) {
      if (empty) empty.style.display = "";
      if (body) body.style.display = "none";
      return;
    }

    if (empty) empty.style.display = "none";
    if (body) body.style.display = "grid";

    const retailerCode = makeRetailerCode(order.shipTo?.postcode || order.postcode, order.retailName || order.customerName);

    setText("detailOrderNo", order.orderNumber || "—");
    setText("detailCustomer", `${order.retailName || order.customerName || "—"} · Product owner: ${order.productOwnerName || "—"}`);
    setText("detailSource", order.sourceType || order.sourceKind || "—");
    setText("detailPurchaseOrder", order.purchaseOrder || "Unknown");
    setText("detailOrderDate", displayDate(order.orderDate));
    setText("detailDueDate", displayDate(order.dueDate || order.orderDate));
    setText("detailLinesCount", formatNumber(order.lines.length));
    setText("detailQty", formatNumber(order.totalQty));
    setText("detailVolume", formatVolume(order.totalVolume));
    setText("detailPostcode", order.postcode || "—");
    setText("detailAddress", order.deliveryAddressText || "—");
    setText("detailCustomerCode", retailerCode);

    const detailMemoParts = [
      `Product owner: ${order.productOwnerName || "—"}`,
      order.memo || "",
      order.warnings?.length ? `Warnings: ${order.warnings.join(" · ")}` : "",
      order.missingProductSkus?.length ? `Missing products: ${order.missingProductSkus.join(", ")}` : ""
    ].filter(Boolean);

    setText("detailMemo", detailMemoParts.join(" | ") || "—");

    const list = byId("detailLineList");
    if (list) {
list.innerHTML = order.lines.map((line, lineIndex) => {
  const isMissing = (order.missingProductSkus || []).some(
    sku => normalize(sku) === normalize(line.itemCode)
  );

  const priorityLevel = normalizeStockPriorityLevel(
    line.stockPriorityLevel
  );

  return `
    <div class="line-card ${getStockPriorityClass(priorityLevel)}">
      <div class="line-title">
        SKU ${escapeHtml(line.itemCode || "Missing SKU")} · Qty ${formatNumber(line.quantity)}

        ${
          isMissing
            ? `<span class="pill pill-warn" style="margin-left:6px;">Not in product master</span>`
            : ""
        }

        ${
          priorityLevel > 0
            ? `
              <span
                class="pill ${priorityLevel === 200 ? "pill-err" : "pill-warn"}"
                style="margin-left:6px;"
              >
                ${escapeHtml(getStockPriorityLabel(priorityLevel))}
              </span>
            `
            : ""
        }
      </div>

<div class="line-priority-top">
  <div>
    <div class="line-priority-label">Stock Priority</div>
    <div class="line-priority-help">
      Controls which order receives incoming stock first.
    </div>
  </div>

  

      <div class="line-sub">
        Description: ${escapeHtml(line.description || "No description")}
      </div>

      <div class="line-sub">
        Raw item: ${escapeHtml(line.itemRaw || "—")}
      </div>

      <div class="line-sub">
        Unit volume: ${formatNumber(line.unitVolume, 3)} m³ ·
        Total volume: ${formatNumber(line.totalVolume, 3)} m³
      </div>


        </div>

       <select
  class="select line-priority-select ${
    priorityLevel === 200
      ? "priority-critical"
      : priorityLevel === 100
        ? "priority-high"
        : "priority-normal"
  }"
  data-stock-priority-line-index="${lineIndex}"
>
          <option value="0" ${priorityLevel === 0 ? "selected" : ""}>
            Normal
          </option>

          <option value="100" ${priorityLevel === 100 ? "selected" : ""}>
            Priority
          </option>

          <option value="200" ${priorityLevel === 200 ? "selected" : ""}>
            Critical
          </option>
        </select>
      </div>
    </div>
  `;
}).join("");
    }
  }

  function renderAll() {
    renderKpis();
    renderTable();
    renderDetail();
  }

async function getOrCreateProductOwnerCustomer(owner, cid) {
  if (!owner) throw new Error("No product owner selected.");

    const ownerName = dedupeRepeatedWords(owner.name || owner.trading_name || "");
    const customerCode = String(owner.customer_code || owner.default_source_name || owner.trading_name || ownerName)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "_");

    if (!ownerName) throw new Error("Selected product owner has no name in Settings.");

    const { data: existing, error: selectError } = await client
      .from("customers")
      .select("id, name, customer_code")
      .eq("company_id", cid)
      .or(`customer_code.eq.${customerCode},name.ilike.${ownerName}`)
      .limit(1);

    if (selectError) throw selectError;

    const payload = {
      company_id: cid,
      name: ownerName,
      customer_code: customerCode,
      is_active: true
    };

    if (owner.invoice_email) payload.billing_email = owner.invoice_email;
    if (owner.ops_email) payload.email = owner.ops_email;
    if (owner.vat) payload.vat_number = owner.vat;

    if (existing?.[0]?.id) {
      const { error: updateError } = await client
        .from("customers")
        .update(payload)
        .eq("id", existing[0].id);

      if (updateError) console.warn("Product owner update skipped:", updateError.message);
      return existing[0].id;
    }

    const { data, error } = await client
      .from("customers")
      .insert(payload)
      .select("id")
      .single();

    if (error) throw error;
    return data.id;
  }

  async function getOrCreateOwnerBillingAddress(owner, customerId) {
    const address = ownerToBillingAddress(owner);

    const hasAddress =
      address.address1 ||
      address.address2 ||
      address.address3 ||
      address.city ||
      address.postcode;

    if (!hasAddress) return null;

    const street = dedupeAddressParts([
      address.address1,
      address.address2,
      address.address3
    ]).join(", ");

    const { data: existing, error: selectError } = await client
      .from("customer_addresses")
      .select("id")
      .eq("customer_id", customerId)
      .eq("address_type", "billing")
      .eq("is_default", true)
      .limit(1);

    if (selectError) console.warn("Billing address lookup skipped:", selectError.message);

    const payload = {
      customer_id: customerId,
      address_type: "billing",
      contact_name: dedupeRepeatedWords(address.contactName) || null,
      company_name: dedupeRepeatedWords(address.companyName) || null,
      street: street || null,
      postal_code: dedupeRepeatedWords(address.postcode) || null,
      city: dedupeRepeatedWords(address.city) || null,
      county: dedupeRepeatedWords(address.county) || null,
      country: dedupeRepeatedWords(address.country || getDefaultCountry()),
      is_default: true
    };

    if (existing?.[0]?.id) {
      const { error: updateError } = await client
        .from("customer_addresses")
        .update(payload)
        .eq("id", existing[0].id);

      if (updateError) console.warn("Billing address update skipped:", updateError.message);
      return existing[0].id;
    }

    const { data, error } = await client
      .from("customer_addresses")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.warn("Billing address insert skipped:", error.message);
      return null;
    }

    return data?.id || null;
  }

  async function loadProductCostMap(cid, lines) {
    const skus = [...new Set(
      (lines || [])
        .map(line => String(line.itemCode || "").trim())
        .filter(Boolean)
    )];

    if (!skus.length) return new Map();

    const { data, error } = await client
      .from("products")
.select(`
  id,
  sku_base,
  volume_m3,
  weight_kg,
  net_weight_kg,
  package_count,
  packages_per_unit,
  storage_tariff,
  admin_tariff,
  handling_tariff,
  transport_tariff,
  total_s2u_fees,
  total_customer_charge
`)
      .eq("company_id", cid)
      .in("sku_base", skus);

    if (error) {
      console.warn("Product tariff lookup skipped:", error.message);
      return new Map();
    }

    const productMap = new Map();

(data || []).forEach(row => {
  const rawSku = String(row.sku_base || "").trim();

  if (!rawSku) return;

  productMap.set(rawSku, row);
  productMap.set(normalize(rawSku), row);
});

return productMap;
  }

 function enrichLineWithProductData(
  line,
  productMap,
  preserveManualTariffs = false
) {
  const sku = String(
    line.itemCode || ""
  ).trim();

  const product =
    productMap.get(sku) ||
    productMap.get(normalize(sku)) ||
    null;

  const qty = Math.max(
    0,
    Math.round(
      toNumber(
        line.quantity,
        0
      )
    )
  );

  /*
   * Volume en gewicht
   *
   * Als volume / gewicht al op de regel staat,
   * gebruiken we dat.
   *
   * Anders gebruiken we de productmaster.
   */
  const unitVolume =
    toNumber(
      line.unitVolume,
      0
    ) ||
    toNumber(
      product?.volume_m3,
      0
    );

  const totalVolume =
    toNumber(
      line.totalVolume,
      0
    ) ||
    qty * unitVolume;

  const unitWeight =
    toNumber(
      line.unitWeight,
      0
    ) ||
    toNumber(
      product?.weight_kg,
      0
    ) ||
    toNumber(
      product?.net_weight_kg,
      0
    );

  const totalWeight =
    toNumber(
      line.totalWeight,
      0
    ) ||
    qty * unitWeight;

  /*
   * Packages
   */
  const packagesPerUnit = Math.max(
    1,
    Math.round(
      toNumber(
        product?.packages_per_unit ||
        product?.package_count ||
        1,
        1
      )
    )
  );

  const totalPackages =
    qty * packagesPerUnit;

  /*
   * TARIEVEN
   *
   * PDF / Excel:
   *   Qty × productmastertarief
   *
   * Manual Order:
   *   Qty × handmatig ingevuld tarief
   *
   * Hierdoor kan bij Manual Order bijvoorbeeld
   * Transport = 0 blijven, terwijl Storage,
   * Admin en Handling wel correct × Qty gaan.
   */

  const storageTotal =
    preserveManualTariffs
      ? qty * toNumber(
          line.tariff_storage,
          0
        )
      : qty * toNumber(
          product?.storage_tariff ||
          product?.tariff_storage,
          0
        );

  const adminTotal =
    preserveManualTariffs
      ? qty * toNumber(
          line.tariff_admin,
          0
        )
      : qty * toNumber(
          product?.admin_tariff,
          0
        );

  const handlingTotal =
    preserveManualTariffs
      ? qty * toNumber(
          line.tariff_handling,
          0
        )
      : qty * toNumber(
          product?.handling_tariff ||
          product?.tariff_handling,
          0
        );

  const transportTotal =
    preserveManualTariffs
      ? qty * toNumber(
          line.tariff_transport,
          0
        )
      : qty * toNumber(
          product?.transport_tariff ||
          product?.tariff_transport,
          0
        );

  /*
   * S2U fees
   *
   * Manual:
   * Storage + Admin + Handling.
   *
   * PDF / Excel:
   * Gebruik total_s2u_fees uit de productmaster
   * wanneer aanwezig. Anders rekenen we hem zelf.
   */
  const s2uTotal =
    preserveManualTariffs
      ? (
          storageTotal +
          adminTotal +
          handlingTotal
        )
      : (
          toNumber(
            product?.total_s2u_fees,
            0
          ) > 0
            ? qty * toNumber(
                product.total_s2u_fees,
                0
              )
            : (
                storageTotal +
                adminTotal +
                handlingTotal
              )
        );

  /*
   * Totale charge naar de product owner.
   *
   * Manual:
   * S2U fees + het handmatige transportbedrag.
   *
   * PDF / Excel:
   * Productmaster total_customer_charge gebruiken
   * wanneer aanwezig.
   */
  const customerChargeTotal =
    preserveManualTariffs
      ? (
          s2uTotal +
          transportTotal
        )
      : (
          toNumber(
            product?.total_customer_charge,
            0
          ) > 0
            ? qty * toNumber(
                product.total_customer_charge,
                0
              )
            : (
                s2uTotal +
                transportTotal
              )
        );

  return {
    ...line,

    productSnapshot:
      product,

    productMissing:
      !product,

    quantity:
      qty,

    packagesPerUnit,
    totalPackages,

    unitVolume,
    totalVolume,

    unitWeight,
    totalWeight,

    tariff_storage:
      storageTotal,

    tariff_admin:
      adminTotal,

    tariff_handling:
      handlingTotal,

    tariff_transport:
      transportTotal,

    total_s2u_fees:
      s2uTotal,

    total_customer_charge:
      customerChargeTotal
  };
}


async function enrichPreviewOrdersWithProductData() {
  if (!groupedOrders.length) return;

  const cid = await getCompanyId();

  const allLines = groupedOrders.flatMap(
    order => order.lines || []
  );

  const productMap = await loadProductCostMap(
    cid,
    allLines
  );

  groupedOrders = groupedOrders.map(order => {
    const enrichedLines = (order.lines || []).map(line =>
      enrichLineWithProductData(
        line,
        productMap
      )
    );

    return finalizeOrder({
      ...order,
      lines: enrichedLines,

      /*
       * De Zoy-PDF bevat geen logistiek totaalvolume.
       * Daarom moet het previewvolume uit de productmaster komen.
       */
      pdfTotalVolume: 0
    });
  });
}

async function insertOrder(order, cid) {
  const owner = getSelectedProductOwner();

  if (!owner) {
    throw new Error("No product owner selected.");
  }

  const isCollection =
    normalize(order.movementType) ===
    "collection";

    const productOwnerName = dedupeRepeatedWords(owner.name || owner.trading_name || order.productOwnerName || "");
    const retailerName = dedupeRepeatedWords(order.retailName || order.customerName);

    const productOwnerId = await getOrCreateProductOwnerCustomer(owner, cid);
    const billingAddressId = await getOrCreateOwnerBillingAddress(owner, productOwnerId);

const productMap =
  await loadProductCostMap(
    cid,
    order.lines
  );

const preserveManualTariffs =
  normalize(order.sourceKind) ===
  "manual";

const enrichedLines =
  order.lines.map(line =>
    enrichLineWithProductData(
      line,
      productMap,
      preserveManualTariffs
    )
  );

    const missingSkus = [...new Set(
      enrichedLines
        .filter(line => line.productMissing && line.itemCode)
        .map(line => String(line.itemCode).trim())
    )];

const totalQty = enrichedLines.reduce(
  (sum, line) =>
    sum + toNumber(line.quantity, 0),
  0
);

const totalPackages = enrichedLines.reduce(
  (sum, line) =>
    sum + toNumber(
      line.totalPackages,
      line.quantity
    ),
  0
);

const calculatedVolume = enrichedLines.reduce(
  (sum, line) =>
    sum + toNumber(line.totalVolume, 0),
  0
);

    const totalVolume =
      getCheckbox("optUsePdfTotalVolume", true) &&
      order.sourceKind === "pdf" &&
      toNumber(order.pdfTotalVolume, 0) > 0
        ? toNumber(order.pdfTotalVolume, 0)
        : calculatedVolume;

    const totalWeight = enrichedLines.reduce((sum, line) => sum + toNumber(line.totalWeight, 0), 0);
    const totalStorage = enrichedLines.reduce((sum, line) => sum + toNumber(line.tariff_storage, 0), 0);
    const totalAdmin = enrichedLines.reduce((sum, line) => sum + toNumber(line.tariff_admin, 0), 0);
    const totalHandling = enrichedLines.reduce((sum, line) => sum + toNumber(line.tariff_handling, 0), 0);
    const totalTransport = enrichedLines.reduce((sum, line) => sum + toNumber(line.tariff_transport, 0), 0);
    const totalS2uFees = enrichedLines.reduce((sum, line) => sum + toNumber(line.total_s2u_fees, 0), 0);
    const totalCustomerCharge = enrichedLines.reduce((sum, line) => sum + toNumber(line.total_customer_charge, 0), 0);

    const orderPayload = {
      company_id: cid,
      customer_id: productOwnerId,
      retail_name: retailerName || null,

     order_number: await reserveSalesOrderNumber(),
      external_reference: order.externalReference || order.orderNumber,
      purchase_order: order.purchaseOrder || null,
      source_type: order.sourceType || getFieldValue("defaultSourceType", "manual_import"),
movement_type:
  isCollection
    ? "collection"
    : "delivery",

status:
  isCollection
    ? "imported"
    : getDefaultStatus(),

planning_release: false,

planning_only: false,
      planning_colli: totalPackages,
      planning_volume_m3: round3(totalVolume),
      volume_m3: round3(totalVolume),

      total_order_colli: totalPackages,
      total_order_volume_m3: round3(totalVolume),
      total_order_weight_kg: round3(totalWeight),

      matched_colli: 0,
      matched_volume_m3: 0,
      matched_weight_kg: 0,

      total_storage_tariff: round2(totalStorage),
      total_admin_tariff: round2(totalAdmin),
      total_handling_tariff: round2(totalHandling),
      total_transport_tariff: round2(totalTransport),
      total_s2u_fees: round2(totalS2uFees),
      total_customer_charge: round2(totalCustomerCharge),

      requested_delivery_date: order.dueDate || order.orderDate || null,
      order_date: order.orderDate || null,
      imported_at: new Date().toISOString(),

      delivery_address_id: null,
      billing_address_id: billingAddressId,

      delivery_address_1: dedupeRepeatedWords(order.shipTo.address1) || null,
delivery_address_2: dedupeRepeatedWords(order.shipTo.address2) || null,
delivery_address_3: dedupeRepeatedWords(order.shipTo.address3) || null,
delivery_address_4: dedupeRepeatedWords(order.shipTo.address4) || null,
delivery_city: dedupeRepeatedWords(order.shipTo.city) || null,
delivery_postcode: dedupeRepeatedWords(order.shipTo.postcode) || null,
delivery_country: dedupeRepeatedWords(order.shipTo.country || getDefaultCountry()),
delivery_region: null,

      transport_type: "own_transport",
      memo: order.memo || null,

      notes: [
        `Product owner: ${productOwnerName}`,
        retailerName ? `Retailer delivery name: ${retailerName}` : "",
        order.contactName ? `Retailer contact: ${dedupeRepeatedWords(order.contactName)}` : "",
        order.email ? `Retailer email: ${order.email}` : "",
        order.phone ? `Retailer phone: ${order.phone}` : "",
        billingAddressId ? "Billing address linked to product owner from settings" : "Billing address not linked",
        "Retailer was not created as S2U customer",
        missingSkus.length ? `Product(s) not found in master data: ${missingSkus.join(", ")}` : ""
      ].filter(Boolean).join(" | ") || null
    };

    const { data: insertedOrder, error: orderError } = await client
      .from("orders")
      .insert(orderPayload)
      .select("id")
      .single();

    if (orderError) throw orderError;

    const linePayloads = enrichedLines.map((line, index) => {
  const qty = Math.round(toNumber(line.quantity, 0));
  const unitVolume = toNumber(line.unitVolume, 0);
  const totalLineVolume = toNumber(line.totalVolume, 0);
  const unitWeight = toNumber(line.unitWeight, 0);
  const totalLineWeight = toNumber(line.totalWeight, 0);

  return {
    company_id: cid,
    order_id: insertedOrder.id,
product_id:
  isCollection
    ? null
    : line.productSnapshot?.id || null,

    line_number: index + 1,
    sku_base: String(line.itemCode || "").trim() || null,
    description: line.description || line.itemRaw || null,

    requested_package_no: line.requested_package_no || null,
    requested_package_total: line.requested_package_total || null,
    requested_package_label:
      line.packageChoice === "full"
        ? null
        : line.packageChoice,

    quantity_ordered: qty,
    quantity_allocated: 0,
    quantity_shipped: 0,

    unit_volume_m3: round3(unitVolume),
    total_volume_m3: round3(totalLineVolume),
    total_line_volume_m3: round3(totalLineVolume),

    unit_weight_kg: round3(unitWeight),
    total_line_weight_kg: round3(totalLineWeight),

    matched_quantity: 0,
    matched_volume_m3: 0,
    matched_weight_kg: 0,

    tariff_storage: round2(line.tariff_storage),
    tariff_admin: round2(line.tariff_admin),
    tariff_handling: round2(line.tariff_handling),
    tariff_transport: round2(line.tariff_transport),
    total_s2u_fees: round2(line.total_s2u_fees),
    total_customer_charge: round2(line.total_customer_charge),

    notes: [
      line.description || "",
      line.itemRaw ? `Original item: ${line.itemRaw}` : "",
      order.purchaseOrder ? `Purchase Order: ${order.purchaseOrder}` : "",
      line.packageChoice && line.packageChoice !== "full"
        ? `Requested package: ${line.packageChoice}`
        : "",
isCollection
  ? "COLLECTION - no stock/product allocation required"
  : (
      line.productSnapshot?.id
        ? "Product linked at import"
        : "WARNING: No matching product found in product master at import"
    )
    ].filter(Boolean).join(" | ") || null
  };
});

    if (!linePayloads.length) {
      throw new Error(`No order lines to insert for ${order.orderNumber}.`);
    }

const { data: insertedLines, error: lineError } = await client
  .from("order_lines")
  .insert(linePayloads)
  .select("id, line_number");

    if (lineError) throw lineError;

    let priorityCount = 0;

    const insertedLineMap = new Map(
      (insertedLines || []).map(insertedLine => [
        Number(insertedLine.line_number),
        insertedLine
      ])
    );

    for (let index = 0; index < enrichedLines.length; index++) {
      const sourceLine = enrichedLines[index];

      const priorityLevel =
        normalizeStockPriorityLevel(
          sourceLine.stockPriorityLevel
        );

      if (priorityLevel <= 0) continue;

      const insertedLine =
        insertedLineMap.get(index + 1);

      if (!insertedLine?.id) {
        throw new Error(
          `Could not connect stock priority to line ${index + 1}.`
        );
      }

      const { error: priorityError } =
        await client.rpc(
          "set_order_line_stock_priority",
          {
            p_order_line_id: insertedLine.id,
            p_priority_level: priorityLevel,
            p_reason:
              `Priority selected during order import for ${
                sourceLine.itemCode || "product"
              }.`
          }
        );

      if (priorityError) throw priorityError;

      priorityCount++;
    }

return {
  orderId: insertedOrder.id,
  customerId: productOwnerId,
  lineCount: insertedLines?.length || 0,
  priorityCount,
  missingSkus
};
  }

 async function uploadSupplierPackingSlip(
  orderId,
  orderNumber,
  customerId = null,
  pdfFile = null
) {
  if (!pdfFile || !orderId) {
    return null;
  }

  const cid = await getCompanyId();

  const safeOrder = String(
    orderNumber || orderId
  )
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

  const fileName =
    `supplier-packing-slip-${safeOrder}.pdf`;

  const storagePath =
    `${cid}/${orderId}/${fileName}`;

  const { error: uploadError } =
    await client.storage
      .from("order-documents")
      .upload(
        storagePath,
        pdfFile,
        {
          contentType: "application/pdf",
          upsert: true
        }
      );

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicData } =
    client.storage
      .from("order-documents")
      .getPublicUrl(
        storagePath
      );

  const fileUrl =
    publicData?.publicUrl || "";

  const documentPayload = {
    company_id: cid,
    customer_id: customerId,
    order_id: orderId,

    document_type:
      "supplier_packing_slip",

    document_number:
      orderNumber || null,

    document_status:
      "received",

    file_url:
      fileUrl,

    storage_path:
      storagePath,

    customer_visible:
      false
  };

  const { error: docError } =
    await client
      .from("order_documents")
      .insert(
        documentPayload
      );

  if (docError) {
    throw docError;
  }

  return {
    storagePath,
    fileUrl
  };
}

async function createOrderImportedNotification(order, result, companyId) {
  try {
    await client
      .from("system_notifications")
      .insert({
        company_id: companyId,
        customer_id: result.customerId || null,

        recipient_role: null,

        notification_type: "order_imported",

        title: "New Order Imported",

        message:
          `Order ${order.orderNumber || "Unknown"} has been imported for ${order.retailName || "the retailer"}.`,

        severity: "info",

        entity_type: "order",
        entity_id: result.orderId,

        action_url: `./operations-control-center.html?order_id=${result.orderId}`,

        is_read: false,
        popup_shown: false
      });

  } catch (error) {
    console.warn("Order import notification could not be created:", error.message);
  }
}

 async function importOrders() {
  if (!groupedOrders.length) {
    showToast(
      "Read a file first.",
      "err"
    );
    return;
  }

  if (!getSelectedProductOwner()) {
    showToast(
      "Select a product owner first.",
      "err"
    );
    return;
  }

  const cid =
    await getCompanyId();

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let linesWritten = 0;
  let supplierPackingSlipsLinked = 0;

  const missingProductsAfterImport =
    new Set();

  setProgress(
    true,
    0,
    "Starting import..."
  );

  for (
    let i = 0;
    i < groupedOrders.length;
    i++
  ) {
    const order =
      groupedOrders[i];

    const pct =
      Math.round(
        ((i + 1) / groupedOrders.length) *
        100
      );

    setProgress(
      true,
      pct,
      `Importing ${order.orderNumber} (${i + 1}/${groupedOrders.length})...`
    );

    if (order.notes.length) {
      order.importMessage =
        order.notes.join(" · ");

      skipped++;

      renderAll();
      continue;
    }

    if (
      order.existing &&
      getCheckbox(
        "optSkipExisting",
        true
      ) &&
      !order.importAnyway
    ) {
      order.importMessage =
        "Skipped: order number already exists.";

      skipped++;

      renderAll();
      continue;
    }

    try {
      const result =
        await insertOrder(
          order,
          cid
        );

      await createOrderImportedNotification(
        order,
        result,
        cid
      );

      let packingSlipLinked =
        false;

      if (
        order.sourceKind === "pdf" &&
        order.sourcePdfFile
      ) {
        try {
          await uploadSupplierPackingSlip(
            result.orderId,
            order.orderNumber,
            result.customerId || null,
            order.sourcePdfFile
          );

          supplierPackingSlipsLinked++;
          packingSlipLinked = true;

        } catch (pdfError) {
          console.error(
            `Supplier packing slip upload failed for ${order.orderNumber}`,
            pdfError
          );
        }
      }

      order.imported = true;
      order.failed = false;

      if (
        result.missingSkus?.length
      ) {
        result.missingSkus.forEach(
          sku =>
            missingProductsAfterImport.add(
              sku
            )
        );

        order.importMessage =
          `${result.lineCount} order line(s) written. ` +
          `Missing product(s): ${result.missingSkus.join(", ")}.`;

      } else {
        order.importMessage =
          `${result.lineCount} order line(s) written.`;
      }

      if (
        result.priorityCount > 0
      ) {
        order.importMessage +=
          ` Stock priority set on ${result.priorityCount} ` +
          `product line${result.priorityCount === 1 ? "" : "s"}.`;
      }

      if (
        order.sourceKind === "pdf"
      ) {
        order.importMessage +=
          packingSlipLinked
            ? " Supplier packing slip linked."
            : " Supplier packing slip upload checked.";
      }

      imported++;
      linesWritten +=
        result.lineCount;

    } catch (error) {
      console.error(
        "FULL IMPORT ERROR",
        error
      );

      order.failed = true;
      order.imported = false;

      order.importMessage =
        error.message ||
        JSON.stringify(error);

      failed++;
    }

    renderAll();
  }

  setProgress(
    false
  );

  const missingList =
    [
      ...missingProductsAfterImport
    ].sort(
      (a, b) =>
        a.localeCompare(b)
    );

  const missingText =
    missingList.length
      ? ` Missing products: ${missingList.join(", ")}.`
      : "";

  const pdfText =
    supplierPackingSlipsLinked
      ? ` Supplier packing slips linked: ${supplierPackingSlipsLinked}.`
      : "";

  showToast(
    `Import complete. Imported: ${imported}, lines written: ${linesWritten}, skipped: ${skipped}, failed: ${failed}.${pdfText}${missingText}`,
    failed || missingList.length
      ? "err"
      : "ok"
  );

  await markExistingOrders();
  await markMissingProducts();

  renderAll();
}

function clearPreview() {
  rawRows = [];
  groupedOrders = [];
  selectedOrderNo = null;

  selectedExcelFile = null;
  selectedPdfFiles = [];

  currentSourceKind = "";
  lastPdfText = "";

  const excelInput =
    byId("ordersImportFile");

  if (excelInput) {
    excelInput.value = "";
  }

  const pdfInput =
    byId("packingSlipPdfFile");

  if (pdfInput) {
    pdfInput.value = "";
  }

  setText(
    "fileStatus",
    "No file selected."
  );

  setText(
    "excelFileStatus",
    "No Excel file selected."
  );

  setText(
    "pdfFileStatus",
    "No PDF files selected."
  );

  const textArea =
    byId("pdfExtractedText");

  if (textArea) {
    textArea.value = "";
  }

  const panel =
    byId("pdfTextPanel");

  if (panel) {
    panel.style.display =
      "none";
  }

  renderAll();
}

  function togglePdfTextPanel() {
    const panel = byId("pdfTextPanel");
    const textArea = byId("pdfExtractedText");
    if (!panel || !textArea) return;

    textArea.value = lastPdfText || "No PDF text extracted yet.";
    panel.style.display = panel.style.display === "none" || !panel.style.display ? "grid" : "none";
  }

 function setSelectedPdfFiles(files) {
  const incoming =
    Array.from(files || []);

  if (!incoming.length) {
    showToast(
      "No PDF files detected.",
      "err"
    );
    return;
  }

  const validFiles = [];
  const invalidFiles = [];

  incoming.forEach(file => {
    const fileName =
      String(
        file?.name || ""
      ).toLowerCase();

    const fileType =
      String(
        file?.type || ""
      ).toLowerCase();

    const isPdf =
      fileName.endsWith(".pdf") ||
      fileType === "application/pdf";

    if (isPdf) {
      validFiles.push(file);
    } else {
      invalidFiles.push(file);
    }
  });

  if (!validFiles.length) {
    showToast(
      "Only PDF files are allowed for packing slip import.",
      "err"
    );
    return;
  }

  /*
   * De nieuwe selectie vervangt de vorige selectie.
   * Daardoor weet je altijd exact welke batch je gaat lezen.
   */
  selectedPdfFiles =
    validFiles;

  const names =
    validFiles.map(
      file => file.name
    );

  const statusText =
    validFiles.length === 1
      ? `${names[0]} selected`
      : `${validFiles.length} PDF files selected`;

  setText(
    "pdfFileStatus",
    statusText
  );

  if (
    invalidFiles.length
  ) {
    showToast(
      `${validFiles.length} PDF file(s) selected. ${invalidFiles.length} non-PDF file(s) ignored.`,
      "err"
    );
  } else {
    showToast(
      validFiles.length === 1
        ? `PDF selected: ${names[0]}`
        : `${validFiles.length} PDF files selected.`,
      "ok"
    );
  }
}

function bindPdfDropZone() {
  const dropZone =
    byId("pdfDropZone");

  const input =
    byId("packingSlipPdfFile");

  if (!dropZone || !input) {
    console.warn(
      "PDF dropzone or file input not found."
    );
    return;
  }

  /*
   * Hierdoor werkt Choose File direct ook met meerdere
   * bestanden, zelfs voordat we de HTML aanpassen.
   */
  input.multiple = true;

  function preventDefaults(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  [
    "dragenter",
    "dragover",
    "dragleave",
    "drop"
  ].forEach(eventName => {
    dropZone.addEventListener(
      eventName,
      preventDefaults,
      false
    );

    document.body.addEventListener(
      eventName,
      preventDefaults,
      false
    );
  });

  [
    "dragenter",
    "dragover"
  ].forEach(eventName => {
    dropZone.addEventListener(
      eventName,
      () => {
        dropZone.classList.add(
          "drag-over"
        );
      },
      false
    );
  });

  [
    "dragleave",
    "drop"
  ].forEach(eventName => {
    dropZone.addEventListener(
      eventName,
      () => {
        dropZone.classList.remove(
          "drag-over"
        );
      },
      false
    );
  });

  dropZone.addEventListener(
    "drop",
    event => {
      const files =
        event.dataTransfer?.files;

      if (
        !files ||
        !files.length
      ) {
        showToast(
          "No files found in drop.",
          "err"
        );
        return;
      }

      setSelectedPdfFiles(
        files
      );
    },
    false
  );

  input.addEventListener(
    "change",
    event => {
      const files =
        event.target.files;

      setSelectedPdfFiles(
        files
      );
    }
  );
}

  function hideDeprecatedOptions() {
    const createProducts = byId("optCreateProducts");
    if (createProducts) {
      createProducts.checked = false;
      createProducts.disabled = true;

      const label = createProducts.closest("label");
      if (label) {
        label.style.opacity = "0.55";
        label.title = "Products are not created automatically. Missing SKUs are shown as warnings after import.";
      }
    }

    const createRetailers = byId("optCreateRetailCustomers");
    if (createRetailers) {
      createRetailers.checked = false;
      createRetailers.disabled = true;

      const label = createRetailers.closest("label");
      if (label) {
        label.style.opacity = "0.75";
        label.title = "Retailers are not created as Sofa2U customers. They are stored on the order as delivery information.";
      }
    }
  }

async function getSelectedProductOwnerCustomerId(cid) {
  const owner = getSelectedProductOwner();
  if (!owner) return null;

  if (owner.customer_id) return owner.customer_id;

  const ownerText = [
    owner.name,
    owner.trading_name,
    owner.customer_code,
    owner.key,
    owner.default_source_name
  ].filter(Boolean).join(" ").toLowerCase();

  const { data, error } = await client
    .from("customers")
    .select("id, name, customer_code")
    .eq("company_id", cid)
    .limit(1000);

  if (error) throw error;

  const match = (data || []).find(row => {
    const rowText = `${row.name || ""} ${row.customer_code || ""}`.toLowerCase();

    if (ownerText.includes("zoy") && rowText.includes("zoy")) return true;
    if (ownerText.includes("bellstone") && rowText.includes("bellstone")) return true;

    return false;
  });

  return match?.id || null;
}

function fillManualOwnerFields() {
  const owner = getSelectedProductOwner();
  if (!owner) return;

  const isOtherCustomer = byId("manualUnknownOwner")?.checked;

  if (byId("manualOwnerSelect")) {
    byId("manualOwnerSelect").value =
      owner.key ||
      owner.customer_code ||
      owner.trading_name ||
      owner.name ||
      "";
  }

  if (!isOtherCustomer) {
    if (byId("manualCustomerName")) {
      byId("manualCustomerName").value = owner.name || owner.trading_name || "";
    }

    if (byId("manualCustomerCode")) {
      byId("manualCustomerCode").value = owner.customer_code || owner.key || "";
    }

    if (byId("manualCustomerEmail")) {
      byId("manualCustomerEmail").value =
        owner.invoice_email ||
        owner.ops_email ||
        owner.ack_email ||
        "";
    }

    if (byId("manualCustomerPhone")) {
      byId("manualCustomerPhone").value = owner.phone || "";
    }

    if (byId("manualCustomerAddress1")) {
      byId("manualCustomerAddress1").value = owner.address1 || "";
    }

    if (byId("manualCustomerAddress2")) {
      byId("manualCustomerAddress2").value = owner.address2 || "";
    }

    if (byId("manualCustomerCity")) {
      byId("manualCustomerCity").value = owner.city || "";
    }

    if (byId("manualCustomerPostcode")) {
      byId("manualCustomerPostcode").value = owner.postcode || "";
    }

    if (byId("manualCustomerCountry")) {
      byId("manualCustomerCountry").value = owner.country || getDefaultCountry();
    }
  }
}

async function loadManualProducts() {
  const cid = await getCompanyId();
  const ownerId = await getSelectedProductOwnerCustomerId(cid);

  manualProducts = [];

  if (!ownerId) {
    renderManualProductOptions();
    showToast("No product owner customer found for selected owner.", "err");
    return;
  }

  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("company_id", cid)
    .eq("customer_id", ownerId)
    .order("sku_base", { ascending: true });

  if (error) {
    console.warn("Manual products skipped:", error.message);
    renderManualProductOptions();
    return;
  }

  manualProducts = data || [];
  renderManualProductOptions();
}

function renderManualProductOptions() {
  const list = byId("manualProductOptions");
  if (!list) return;

  list.innerHTML = manualProducts.map(p => `
    <option value="${escapeHtml(p.sku_base || "")}">
      ${escapeHtml(p.name || p.description || "")}
    </option>
  `).join("");
}

function findManualProduct(sku) {
  return manualProducts.find(p => normalize(p.sku_base) === normalize(sku)) || null;
}

function fillManualLineFromSku(input) {
  const row = input.closest(".manual-line-row");
  if (!row) return;

  const product = findManualProduct(input.value);
  if (!product) return;

  const packageTotal = Math.max(1, Math.round(toNumber(product.package_count || product.packages_per_unit || 1, 1)));
  const packageSelect = row.querySelector(".manualPackageChoice");

  if (packageSelect) {
    packageSelect.innerHTML =
      `<option value="full">Full Product (${packageTotal}/${packageTotal})</option>` +
      Array.from({ length: packageTotal }, (_, index) => {
        const no = index + 1;
        return `<option value="${no}/${packageTotal}">Package ${no}/${packageTotal}</option>`;
      }).join("");
  }

  row.querySelector(".manualDescription").value = product.description || product.name || "";
  row.querySelector(".manualVolume").value = product.volume_m3 || 0;
  row.querySelector(".manualWeight").value = product.weight_kg || product.net_weight_kg || 0;

  row.querySelector(".manualStorageTariff").value = product.storage_tariff || product.tariff_storage || 0;
  row.querySelector(".manualAdminTariff").value = product.admin_tariff || 0;
  row.querySelector(".manualHandlingTariff").value = product.handling_tariff || product.tariff_handling || 0;
  row.querySelector(".manualTransportTariff").value = product.transport_tariff || product.tariff_transport || 0;

  const missing = row.querySelector(".manualProductMissing");
  const hint = row.querySelector(".manualProductHint");

  if (missing) missing.checked = false;
  if (hint) hint.textContent = "Product found in master data.";
}

function syncManualOwnerSelect() {
  const select = byId("manualOwnerSelect");
  if (!select) return;

  select.innerHTML = ownerProfiles.map(owner => {
    const label = owner.trading_name || owner.name || owner.customer_code || owner.key || "Product owner";
    const value = owner.key || owner.customer_code || owner.trading_name || owner.name || "";

    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }).join("");

  select.value = getFieldValue("productOwnerName", "");
}

function toggleManualUnknownOwnerFields() {
  const checkbox = byId("manualUnknownOwner");
  const fields = byId("manualUnknownOwnerFields");
  if (!checkbox || !fields) return;

  fields.classList.toggle("hidden", !checkbox.checked);
  fillManualOwnerFields();
}

async function openManualOrderModal() {
  syncManualOwnerSelect();
  fillManualOwnerFields();
  toggleManualUnknownOwnerFields();
const movementSelect =
  byId("manualMovementType");

if (movementSelect) {
  movementSelect.value = "delivery";
}

  await loadManualProducts();

  byId("manualOrderModal")?.classList.add("open");

  const dateInput = byId("manualRequestedDate");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  const orderInput = byId("manualOrderNumber");
  if (orderInput && !orderInput.value) {
    orderInput.value = `MAN-${Date.now().toString().slice(-6)}`;
  }
}

function closeManualOrderModal() {
  byId("manualOrderModal")?.classList.remove("open");
}

async function loadManualRetailers() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("orders")
    .select(`
      retail_name,
      delivery_address_1,
      delivery_address_2,
      delivery_city,
      delivery_postcode,
      delivery_country
    `)
    .eq("company_id", cid)
    .not("retail_name", "is", null)
    .order("retail_name", { ascending: true })
    .limit(1000);

  if (error) {
    console.warn("Manual retailers skipped:", error.message);
    manualRetailers = [];
    renderManualRetailerOptions();
    return;
  }

  const map = new Map();

  (data || []).forEach(row => {
    const key = normalize(`${row.retail_name}|${row.delivery_postcode}`);
    if (!key || map.has(key)) return;

    map.set(key, {
      name: row.retail_name || "",
      contact: "",
      address1: row.delivery_address_1 || "",
      address2: row.delivery_address_2 || "",
      city: row.delivery_city || "",
      postcode: row.delivery_postcode || "",
      country: row.delivery_country || getDefaultCountry()
    });
  });

  manualRetailers = Array.from(map.values()).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "en-GB")
  );

  renderManualRetailerOptions();
}

function renderManualRetailerOptions() {
  const select = byId("manualRetailerSelect");
  if (!select) return;

  select.innerHTML =
    `<option value="">New Retailer / Manual Entry</option>` +
    manualRetailers.map((r, index) => `
      <option value="${index}">
        ${escapeHtml(r.name)}${r.postcode ? ` · ${escapeHtml(r.postcode)}` : ""}
      </option>
    `).join("");
}

function fillManualRetailerFromSelect() {
  const select = byId("manualRetailerSelect");
  if (!select || select.value === "") return;

  const retailer = manualRetailers[Number(select.value)];
  if (!retailer) return;

  byId("manualRetailerName").value = retailer.name || "";
  byId("manualContactName").value = retailer.contact || "";
  byId("manualAddress1").value = retailer.address1 || "";
  byId("manualAddress2").value = retailer.address2 || "";
  byId("manualCity").value = retailer.city || "";
  byId("manualPostcode").value = retailer.postcode || "";
  byId("manualCountry").value = retailer.country || getDefaultCountry();
}

function addManualLine() {
  const wrap = byId("manualLines");
  if (!wrap) return;

  wrap.insertAdjacentHTML("beforeend", `
    <div class="manual-line-row">
      <div class="manual-line-main">
        <div class="field">
          <label>SKU</label>
          <input class="input manualSku" list="manualProductOptions" placeholder="Search or enter SKU"/>
        </div>

        <div class="field">
          <label>Description</label>
          <input class="input manualDescription" placeholder="Description"/>
        </div>

        <div class="field">
          <label>Qty</label>
          <input class="input manualQty" type="number" min="1" value="1"/>
        </div>

        <div class="field">
          <label>Package</label>
          <select class="select manualPackageChoice">
            <option value="full">Full Product</option>
          </select>
        </div>

        <div class="field">
          <label>Volume m³</label>
          <input class="input manualVolume" type="number" step="0.001" min="0" value="0"/>
        </div>

        <div class="field">
          <label>Weight kg</label>
          <input class="input manualWeight" type="number" step="0.001" min="0" value="0"/>
        </div>

        <button class="icon-btn btnRemoveManualLine" type="button">×</button>
      </div>

      <div class="manual-line-finance">
        <div class="field">
          <label>Storage Tariff</label>
          <input class="input manualStorageTariff" type="number" step="0.01" min="0" value="0"/>
        </div>

        <div class="field">
          <label>Admin Tariff</label>
          <input class="input manualAdminTariff" type="number" step="0.01" min="0" value="0"/>
        </div>

        <div class="field">
          <label>Handling Tariff</label>
          <input class="input manualHandlingTariff" type="number" step="0.01" min="0" value="0"/>
        </div>

        <div class="field">
          <label>Transport Tariff</label>
          <input class="input manualTransportTariff" type="number" step="0.01" min="0" value="0"/>
        </div>
      </div>

      <div class="manual-line-flags">
        <label class="checkbox-row">
          <input type="checkbox" class="manualProductMissing"/>
          <span>Product not in master data</span>
        </label>

        <span class="section-sub manualProductHint">Select an existing SKU or enter a new SKU manually.</span>
      </div>
    </div>
  `);
}

function getManualLines() {
  return Array.from(document.querySelectorAll("#manualLines .manual-line-row"))
    .map((row, index) => {
      const sku = row.querySelector(".manualSku")?.value.trim() || "";
      const description = row.querySelector(".manualDescription")?.value.trim() || "";
      const qty = Math.max(1, Math.round(toNumber(row.querySelector(".manualQty")?.value, 1)));
      const unitVolume = toNumber(row.querySelector(".manualVolume")?.value, 0);
      const unitWeight = toNumber(row.querySelector(".manualWeight")?.value, 0);

      const packageChoice = row.querySelector(".manualPackageChoice")?.value || "full";
      const packageParts = packageChoice !== "full" ? packageChoice.split("/") : [];

      return {
        itemRaw: sku,
        itemBrand: "",
        itemCode: sku,
        description,
        quantity: qty,
        unitVolume,
        totalVolume: qty * unitVolume,
        unitWeight,
        totalWeight: qty * unitWeight,
        packageChoice,
        requested_package_no: packageParts.length ? toNumber(packageParts[0], null) : null,
        requested_package_total: packageParts.length ? toNumber(packageParts[1], null) : null,
        tariff_storage: toNumber(row.querySelector(".manualStorageTariff")?.value, 0),
        tariff_admin: toNumber(row.querySelector(".manualAdminTariff")?.value, 0),
        tariff_handling: toNumber(row.querySelector(".manualHandlingTariff")?.value, 0),
        tariff_transport: toNumber(row.querySelector(".manualTransportTariff")?.value, 0),
        sourceRow: index + 1
      };
    })
    .filter(line => line.itemCode || line.description);
}

async function saveManualOrder() {
  const orderNumber = getFieldValue("manualOrderNumber", "");
  const retailerName = getFieldValue("manualRetailerName", "");
  const postcode = getFieldValue("manualPostcode", "");
  const city = getFieldValue("manualCity", "");
  const lines = getManualLines();
const movementType =
  getFieldValue(
    "manualMovementType",
    "delivery"
  );

  if (!orderNumber) return showToast("Manual order number is required.", "err");
  if (!retailerName) return showToast("Retailer / shop name is required.", "err");
  if (!postcode && !city) return showToast("City or postcode is required.", "err");
  if (!lines.length) return showToast("Add at least one product line.", "err");

  currentSourceKind = "manual";

  const shipTo = {
    ...buildEmptyAddress(),
    contactName: getFieldValue("manualContactName", ""),
    companyName: retailerName,
    address1: getFieldValue("manualAddress1", ""),
    address2: getFieldValue("manualAddress2", ""),
    address3: getFieldValue("manualAddress3", ""),
    address4: getFieldValue("manualAddress4", ""),
    city,
    postcode,
    country: getFieldValue("manualCountry", getDefaultCountry())
  };

let manualOrder = {
  ...buildEmptyOrder(),

  sourceKind: "manual",

  sourceType:
    movementType === "collection"
      ? "manual_collection"
      : "manual_order",

  movementType,

  orderNumber,
    externalReference: orderNumber,
    purchaseOrder: getFieldValue("manualPurchaseOrder", ""),
    orderDate: new Date().toISOString().slice(0, 10),
    dueDate: getFieldValue("manualRequestedDate", ""),
    retailName: retailerName,
    customerName: retailerName,
    contactName: getFieldValue("manualContactName", ""),
    address1: shipTo.address1,
    address2: shipTo.address2,
    address3: shipTo.address3,
    city: shipTo.city,
    postcode: shipTo.postcode,
    country: shipTo.country,
    shipTo,
    memo: getFieldValue("manualMemo", ""),
    lines
  };

  manualOrder = finalizeOrder(manualOrder);

  groupedOrders = [manualOrder];
  rawRows = lines;
  selectedOrderNo = manualOrder.orderNumber;

  await markExistingOrders();
  await markMissingProducts();

  renderAll();
  closeManualOrderModal();

  showToast("Manual order added to preview. Click Import Previewed Orders to save it.", "ok");
}

function bindEvents() {

  byId("detailLineList")?.addEventListener("change", event => {
    const select = event.target.closest(
      "[data-stock-priority-line-index]"
    );

    if (!select) return;

    const order = groupedOrders.find(
      row =>
        String(row.orderNumber) ===
        String(selectedOrderNo)
    );

    if (!order) return;

    const lineIndex = Number(
      select.dataset.stockPriorityLineIndex
    );

    if (
      !Number.isInteger(lineIndex) ||
      !order.lines?.[lineIndex]
    ) {
      return;
    }

    order.lines[lineIndex].stockPriorityLevel =
      normalizeStockPriorityLevel(select.value);

    renderDetail();
  });
  const excelInput = byId("ordersImportFile");

  if (excelInput) {
    excelInput.addEventListener("change", event => {
      selectedExcelFile = event.target.files?.[0] || null;
      setText(
        "excelFileStatus",
        selectedExcelFile ? `${selectedExcelFile.name} selected` : "No Excel file selected."
      );
    });
  }

  byId("manualOwnerSelect")?.addEventListener("change", async event => {
    event.preventDefault();

    const mainOwnerSelect = byId("productOwnerName");
    if (mainOwnerSelect) mainOwnerSelect.value = event.target.value;

    fillManualOwnerFields();
    await loadManualProducts();
  });

  byId("manualLines")?.addEventListener("change", event => {
    const input = event.target.closest(".manualSku");
    if (!input) return;
    fillManualLineFromSku(input);
  });

  byId("manualRetailerSelect")?.addEventListener("change", fillManualRetailerFromSelect);
  byId("manualUnknownOwner")?.addEventListener("change", toggleManualUnknownOwnerFields);

  byId("productOwnerName")?.addEventListener("change", async () => {
    fillManualOwnerFields();
    await loadManualProducts();

    groupedOrders = groupedOrders.map(finalizeOrder);
    renderAll();
  });

  bindPdfDropZone();

  firstEl(["btnReadExcelFile", "btnReadFile"])?.addEventListener("click", async event => {
    event.preventDefault();

    try {
      if (!getSelectedProductOwner()) {
        showToast("Select a product owner first.", "err");
        return;
      }

      await readExcelFile();
    } catch (error) {
      console.error(error);
      setProgress(false);
      showToast(error.message || "Could not read Excel file.", "err");
    }
  });

  byId("btnReadPdfFile")?.addEventListener("click", async event => {
    event.preventDefault();

    try {
      await readPdfFile();
    } catch (error) {
      console.error(error);
      setProgress(false);
      showToast(error.message || "Could not read PDF file.", "err");
    }
  });

  byId("btnShowPdfText")?.addEventListener("click", event => {
    event.preventDefault();
    togglePdfTextPanel();
  });

  byId("btnImportOrders")?.addEventListener("click", async event => {
    event.preventDefault();

    try {
      await importOrders();
    } catch (error) {
      console.error(error);
      setProgress(false);
      showToast(error.message || "Import failed.", "err");
    }
  });

  byId("btnClearPreview")?.addEventListener("click", event => {
    event.preventDefault();
    clearPreview();
  });

  ["optSkipExisting", "optSkipZeroQtyPdfLines", "optUsePdfTotalVolume"].forEach(id => {
    byId(id)?.addEventListener("change", renderAll);
  });

  byId("btnOpenManualOrder")?.addEventListener("click", async event => {
    event.preventDefault();

    try {
      await openManualOrderModal();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Manual order popup could not be opened.", "err");
    }
  });

  byId("btnCloseManualOrder")?.addEventListener("click", event => {
    event.preventDefault();
    closeManualOrderModal();
  });

  byId("btnCancelManualOrder")?.addEventListener("click", event => {
    event.preventDefault();
    closeManualOrderModal();
  });

  byId("btnAddManualLine")?.addEventListener("click", event => {
    event.preventDefault();
    addManualLine();
  });

  byId("manualOrderModal")?.addEventListener("click", event => {
    if (event.target.id === "manualOrderModal") {
      closeManualOrderModal();
    }
  });

  byId("manualLines")?.addEventListener("click", event => {
    const btn = event.target.closest(".btnRemoveManualLine");
    if (!btn) return;

    event.preventDefault();

    const rows = document.querySelectorAll("#manualLines .manual-line-row");
    if (rows.length <= 1) {
      showToast("At least one product line is required.", "err");
      return;
    }

    btn.closest(".manual-line-row")?.remove();
  });

  byId("btnSaveManualOrder")?.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await saveManualOrder();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Manual order could not be created.", "err");
    }
  });

  hideDeprecatedOptions();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    client = sb();

    await getCompanyId();
    await loadSettings();
    await loadManualProducts();
    await loadManualRetailers();

    bindEvents();
    renderAll();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Order import page failed to load.", "err");
  }
});
})();