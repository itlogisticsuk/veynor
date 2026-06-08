(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const OWNER_PROFILES_KEY = "product_owner_profiles";

  let client = null;
  let companyId = null;

  let settingsMap = new Map();
  let ownerProfiles = [];

  let selectedExcelFile = null;
  let selectedPdfFile = null;
  let rawRows = [];
  let groupedOrders = [];
  let selectedOrderNo = null;
  let currentSourceKind = "";
  let lastPdfText = "";

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

    return dedupeAddressParts([
      address.address1,
      address.address2,
      address.address3,
      address.city,
      address.county,
      address.postcode,
      address.country
    ]).join(", ");
  }

  function buildEmptyOrder() {
    const owner = getSelectedProductOwner();

    return {
      sourceKind: currentSourceKind || "unknown",
      sourceType: "",

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

    const missingSku = order.lines.filter(l => !l.itemCode).length;
    if (missingSku) notes.push(`${missingSku} line(s) missing SKU`);

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

  function findLine(lines, regex) {
    return lines.find(line => regex.test(line)) || "";
  }

  function extractPostcode(text) {
    const match = String(text || "").match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    return match ? match[1].toUpperCase().replace(/\s+/, " ") : "";
  }

  function extractOrderNumber(lines, text) {
    const ack = String(text || "").match(/\b(ACK\d+)\b/i);
    if (ack) return ack[1].toUpperCase();

    const orderLine = findLine(lines, /ORDER\s*#/i);
    const match = orderLine.match(/\b([A-Z]{2,}\d+)\b/i);
    return match ? match[1].toUpperCase() : "";
  }

  function extractOrderDate(lines, text) {
    const match = String(text || "").match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\s+(ACK\d+)\b/i);
    if (match) return parseDateToIso(match[1]);

    const dateLine = findLine(lines, /\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
    const dateMatch = dateLine.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
    return dateMatch ? parseDateToIso(dateMatch[0]) : null;
  }

  function extractPurchaseOrder(text) {
    const match = String(text || "").match(/Purchase\s+Order\s*:\s*(PO\s*\d+)/i);
    return match ? match[1].replace(/\s+/, " ").trim().toUpperCase() : "";
  }

  function splitBillShipBlock(lines) {
    const start = lines.findIndex(line => /BILL\s+TO\s+SHIP\s+TO/i.test(cleanText(line)));
    const end = lines.findIndex(line => /^Item\s+Description\s+Shipped\s+Volume/i.test(cleanText(line)));

    if (start < 0 || end <= start) {
      return { billLines: [], shipLines: [] };
    }

    const block = lines
      .slice(start + 1, end)
      .map(line => cleanText(line).replace(/,$/, ""))
      .filter(Boolean)
      .filter(line => !/^accounts@/i.test(line))
      .filter(line => !/^\+?\d[\d\s().-]{5,}$/i.test(line));

    const ukIndexes = block
      .map((line, index) => /^UK$/i.test(line) ? index : -1)
      .filter(index => index >= 0);

    if (ukIndexes.length >= 2) {
      return {
        billLines: block.slice(0, ukIndexes[0] + 1),
        shipLines: block.slice(ukIndexes[0] + 1, ukIndexes[1] + 1)
      };
    }

    return { billLines: block, shipLines: block };
  }

  function parseAddressBlock(blockLines, allLines) {
    const address = buildEmptyAddress();

    const lines = (blockLines || [])
      .map(line => cleanText(line).replace(/,$/, ""))
      .filter(Boolean);

    const emailLine = allLines.find(line =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(cleanText(line))
    ) || "";

    const phoneLine = allLines.find(line =>
      /^\+?\d[\d\s().-]{5,}$/i.test(cleanText(line))
    ) || "";

    address.email = cleanText(emailLine);
    address.phone = cleanText(phoneLine);

    address.contactName = dedupeRepeatedWords(lines[0] || "");
    address.companyName = dedupeRepeatedWords(lines[1] || lines[0] || "");

    const addressOnly = lines
      .slice(2)
      .filter(line => !/^UK$/i.test(line));

    const uniqueAddressLines = [];
    const seen = new Set();

    addressOnly.forEach(line => {
      const cleaned = cleanText(line).replace(/,+$/g, "").trim();
      const key = dedupeKey(cleaned);

      if (!cleaned || !key || seen.has(key)) return;

      seen.add(key);
      uniqueAddressLines.push(cleaned);
    });

    address.address1 = uniqueAddressLines[0] || "";
    address.address2 = uniqueAddressLines[1] || "";

    const postcodeLine = uniqueAddressLines.find(line => extractPostcode(line)) || "";
    const postcode = extractPostcode(postcodeLine || uniqueAddressLines.join(" "));

    address.postcode = postcode;

    if (postcodeLine && postcode) {
      const withoutPostcode = postcodeLine
        .replace(new RegExp(postcode, "i"), "")
        .trim()
        .replace(/,$/, "");

      const parts = withoutPostcode
        .split(",")
        .map(cleanText)
        .filter(Boolean);

      address.city = parts[0] || "";
      address.county = parts[1] || "";
    }

    address.address3 = uniqueAddressLines
      .slice(2)
      .filter(line => !extractPostcode(line))
      .join(", ");

    address.country = getDefaultCountry();

    return address;
  }

  function parsePdfAddresses(lines) {
    const split = splitBillShipBlock(lines);
    const billToFromPdf = parseAddressBlock(split.billLines, lines);
    const shipTo = parseAddressBlock(split.shipLines.length ? split.shipLines : split.billLines, lines);

    return { billToFromPdf, shipTo };
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
    let current = "";

    raw.forEach(line => {
      const clean = cleanText(line);

      if (/^[A-Z0-9]{3,}\b/.test(clean)) {
        if (current) rows.push(current);
        current = clean;
      } else if (current) {
        current += " " + clean;
      }
    });

    if (current) rows.push(current);

    const skipZeroQty = getCheckbox("optSkipZeroQtyPdfLines", true);

    return rows.map((row, index) => {
      const skuMatch = row.match(/^([A-Z0-9]{3,})\b\s*(.*)$/);

      if (!skuMatch) {
        return {
          itemRaw: row,
          itemBrand: "",
          itemCode: "",
          description: row,
          quantity: 0,
          unitVolume: 0,
          unitWeight: 0,
          totalVolume: 0,
          totalWeight: 0,
          sourceRow: index + 1,
          parseError: "Could not parse PDF product line"
        };
      }

      const sku = skuMatch[1].trim();
      const rest = cleanText(skuMatch[2]);
      const numbers = [...rest.matchAll(/\b(-?\d+)\s+(\d+(?:[.,]\d+)?)\b/g)];

      if (!numbers.length) {
        return {
          itemRaw: row,
          itemBrand: "",
          itemCode: sku,
          description: rest,
          quantity: 0,
          unitVolume: 0,
          unitWeight: 0,
          totalVolume: 0,
          totalWeight: 0,
          sourceRow: index + 1,
          parseError: "Could not find shipped quantity and volume"
        };
      }

      const last = numbers[numbers.length - 1];
      const qty = Math.round(toNumber(last[1], 0));
      const totalVolume = toNumber(last[2], 0);
      const unitVolume = qty > 0 ? totalVolume / qty : 0;

      const description = cleanText(
        rest.slice(0, last.index) + " " + rest.slice(last.index + last[0].length)
      );

      return {
        itemRaw: row,
        itemBrand: description.split(" ")[0] || "",
        itemCode: sku,
        description,
        quantity: qty,
        unitVolume,
        unitWeight: 0,
        totalVolume,
        totalWeight: 0,
        sourceRow: index + 1,
        parseError: ""
      };
    }).filter(line => {
      if (line.parseError) return true;
      if (skipZeroQty && toNumber(line.quantity, 0) <= 0) return false;
      return true;
    });
  }

  function extractTotalVolume(text) {
    const match = String(text || "").match(/Total\s+Volume\s+(\d+(?:[.,]\d+)?)/i);
    return match ? toNumber(match[1], 0) : 0;
  }

  function parsePackingSlip(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean);

    const { billToFromPdf, shipTo } = parsePdfAddresses(lines);
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
    if (!selectedPdfFile) {
      showToast("Select or drop a PDF packing slip first.", "err");
      return;
    }

    if (!getSelectedProductOwner()) {
      showToast("Select a product owner first.", "err");
      return;
    }

    currentSourceKind = "pdf";
    setProgress(true, 10, "Reading PDF...");

    lastPdfText = await extractPdfText(selectedPdfFile);

    const textArea = byId("pdfExtractedText");
    if (textArea) textArea.value = lastPdfText;

    setProgress(true, 45, "Parsing packing slip...");

    rawRows = lastPdfText.split(/\r?\n/).filter(Boolean);
    groupedOrders = parsePackingSlip(lastPdfText);
    selectedOrderNo = groupedOrders[0]?.orderNumber || null;

    setProgress(true, 65, "Checking existing orders...");
    await markExistingOrders();

    setProgress(true, 80, "Checking product master...");
    await markMissingProducts();

    renderAll();
    setProgress(false);

    const missingCount = getAllMissingProductSkus().length;
    const warningText = missingCount ? ` ${missingCount} SKU(s) are not in product master.` : "";

    showToast(`${groupedOrders.length} order(s) found from PDF ${selectedPdfFile.name}.${warningText}`, missingCount ? "err" : "ok");
  }

  async function markExistingOrders() {
    if (!groupedOrders.length) return;

    const cid = await getCompanyId();
    const orderNumbers = groupedOrders.map(o => o.orderNumber).filter(Boolean);

    if (!orderNumbers.length) return;

    const { data, error } = await client
      .from("orders")
      .select("id, order_number")
      .eq("company_id", cid)
      .in("order_number", orderNumbers);

    if (error) throw error;

    const existingMap = new Map((data || []).map(r => [String(r.order_number), r.id]));

    groupedOrders = groupedOrders.map(o => ({
      ...o,
      existing: existingMap.has(String(o.orderNumber)),
      existingOrderId: existingMap.get(String(o.orderNumber)) || null,
      importAnyway: false
    }));
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
      tbody.innerHTML = `<tr><td colspan="15">Upload an Excel file or PDF packing slip and click Read.</td></tr>`;
      return;
    }

    tbody.innerHTML = groupedOrders.map(order => {
      const disabled = (!order.existing || order.imported || order.notes.length) ? "disabled" : "";
      const checked = order.importAnyway ? "checked" : "";
      const exampleLine = order.lines.find(l => l.itemCode) || order.lines[0] || {};
      const source = order.sourceKind || currentSourceKind || "—";
      const retailerCode = makeRetailerCode(order.shipTo?.postcode || order.postcode, order.retailName || order.customerName);

      const warningText = (order.warnings || []).join(" · ");
      const noteText =
        order.importMessage ||
        order.notes.join(" · ") ||
        warningText ||
        order.memo ||
        (order.existing ? "Manual confirmation required" : "—");

      return `
        <tr data-order-no="${escapeHtml(order.orderNumber)}" class="${String(selectedOrderNo) === String(order.orderNumber) ? "active" : ""}">
          <td>
            ${order.existing ? `
              <label class="checkbox-row" style="margin:0;">
                <input class="import-anyway-check" type="checkbox" data-order-no="${escapeHtml(order.orderNumber)}" ${checked} ${disabled}/>
                <span>Import anyway</span>
              </label>
            ` : `<span class="pill pill-ok">New</span>`}
          </td>
          <td>${escapeHtml(source)}</td>
          <td>
            <strong>${escapeHtml(order.orderNumber || "—")}</strong>
            <span class="subline">PO: ${escapeHtml(order.purchaseOrder || "Unknown")}</span>
          </td>
          <td>${escapeHtml(order.purchaseOrder || "Unknown")}</td>
          <td>
            <strong>${escapeHtml(order.retailName || order.customerName || "—")}</strong>
            <span class="subline">Retailer / delivery customer</span>
            <span class="subline">Retailer Code: ${escapeHtml(retailerCode)}</span>
            ${order.contactName ? `<span class="subline">Contact: ${escapeHtml(order.contactName)}</span>` : ""}
          </td>
          <td class="address-cell">
            ${escapeHtml(order.invoiceAddressText || "—")}
            <span class="subline">From Settings / Product Owner</span>
          </td>
          <td class="address-cell">
            ${escapeHtml(order.deliveryAddressText || "—")}
            <span class="subline">Retailer delivery address</span>
          </td>
          <td class="date-cell">${escapeHtml(displayDate(order.dueDate || order.orderDate))}</td>
          <td>${formatNumber(order.lines.length)}</td>
          <td>${formatNumber(order.totalQty)}</td>
          <td>${formatNumber(order.uniqueSkus)}</td>
          <td>${formatVolume(order.totalVolume)}</td>
          <td>
            <strong>${escapeHtml(exampleLine.itemCode || "—")}</strong>
            <span class="subline">${escapeHtml(exampleLine.itemBrand || "")}</span>
          </td>
          <td>${statusPill(order)}</td>
          <td>${escapeHtml(noteText)}</td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("tr[data-order-no]").forEach(tr => {
      tr.addEventListener("click", event => {
        if (event.target.closest("input")) return;
        selectedOrderNo = tr.dataset.orderNo;
        renderAll();
      });
    });

    tbody.querySelectorAll(".import-anyway-check").forEach(input => {
      input.addEventListener("click", event => event.stopPropagation());
      input.addEventListener("change", () => {
        const order = groupedOrders.find(o => String(o.orderNumber) === String(input.dataset.orderNo));
        if (order) order.importAnyway = input.checked;
        renderAll();
      });
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
      list.innerHTML = order.lines.map(line => {
        const isMissing = (order.missingProductSkus || []).some(sku => normalize(sku) === normalize(line.itemCode));

        return `
          <div class="line-card">
            <div class="line-title">
              SKU ${escapeHtml(line.itemCode || "Missing SKU")} · Qty ${formatNumber(line.quantity)}
              ${isMissing ? `<span class="pill pill-warn" style="margin-left:6px;">Not in product master</span>` : ""}
            </div>
            <div class="line-sub">Description: ${escapeHtml(line.description || "No description")}</div>
            <div class="line-sub">Raw item: ${escapeHtml(line.itemRaw || "—")}</div>
            <div class="line-sub">Unit volume: ${formatNumber(line.unitVolume, 3)} m³ · Total volume: ${formatNumber(line.totalVolume, 3)} m³</div>
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

    return new Map((data || []).map(row => [String(row.sku_base), row]));
  }

  function enrichLineWithProductData(line, productMap) {
    const sku = String(line.itemCode || "").trim();
    const product = productMap.get(sku) || null;
    const qty = Math.round(toNumber(line.quantity, 0));

    const unitVolume = toNumber(line.unitVolume, 0) || toNumber(product?.volume_m3, 0);
    const totalVolume = toNumber(line.totalVolume, 0) || qty * unitVolume;

    const unitWeight =
      toNumber(line.unitWeight, 0) ||
      toNumber(product?.weight_kg, 0) ||
      toNumber(product?.net_weight_kg, 0);

    const totalWeight = qty * unitWeight;

    const storageTotal = qty * toNumber(product?.storage_tariff, 0);
    const adminTotal = qty * toNumber(product?.admin_tariff, 0);
    const handlingTotal = qty * toNumber(product?.handling_tariff, 0);
    const transportTotal = qty * toNumber(product?.transport_tariff, 0);

    const s2uTotal =
      toNumber(product?.total_s2u_fees, 0) > 0
        ? qty * toNumber(product?.total_s2u_fees, 0)
        : storageTotal + adminTotal + handlingTotal;

    const customerChargeTotal =
      toNumber(product?.total_customer_charge, 0) > 0
        ? qty * toNumber(product?.total_customer_charge, 0)
        : s2uTotal + transportTotal;

    return {
      ...line,
      productSnapshot: product,
      productMissing: !product,
      quantity: qty,
      unitVolume,
      totalVolume,
      unitWeight,
      totalWeight,
      tariff_storage: storageTotal,
      tariff_admin: adminTotal,
      tariff_handling: handlingTotal,
      tariff_transport: transportTotal,
      total_s2u_fees: s2uTotal,
      total_customer_charge: customerChargeTotal
    };
  }

  async function insertOrder(order, cid) {
    const owner = getSelectedProductOwner();
    if (!owner) throw new Error("No product owner selected.");

    const productOwnerName = dedupeRepeatedWords(owner.name || owner.trading_name || order.productOwnerName || "");
    const retailerName = dedupeRepeatedWords(order.retailName || order.customerName);

    const productOwnerId = await getOrCreateProductOwnerCustomer(owner, cid);
    const billingAddressId = await getOrCreateOwnerBillingAddress(owner, productOwnerId);

    const productMap = await loadProductCostMap(cid, order.lines);
    const enrichedLines = order.lines.map(line => enrichLineWithProductData(line, productMap));

    const missingSkus = [...new Set(
      enrichedLines
        .filter(line => line.productMissing && line.itemCode)
        .map(line => String(line.itemCode).trim())
    )];

    const totalQty = enrichedLines.reduce((sum, line) => sum + toNumber(line.quantity, 0), 0);
    const calculatedVolume = enrichedLines.reduce((sum, line) => sum + toNumber(line.totalVolume, 0), 0);

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

      order_number: order.orderNumber,
      external_reference: order.externalReference || order.orderNumber,
      purchase_order: order.purchaseOrder || null,
      source_type: order.sourceType || getFieldValue("defaultSourceType", "manual_import"),

      status: getDefaultStatus(),
      planning_release: false,
      planning_only: false,

      planning_colli: totalQty,
      planning_volume_m3: round3(totalVolume),
      volume_m3: round3(totalVolume),

      total_order_colli: totalQty,
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
      delivery_address_2: dedupeAddressParts([order.shipTo.address2, order.shipTo.address3]).join(", ") || null,
      delivery_city: dedupeRepeatedWords(order.shipTo.city) || null,
      delivery_postcode: dedupeRepeatedWords(order.shipTo.postcode) || null,
      delivery_country: dedupeRepeatedWords(order.shipTo.country || getDefaultCountry()),
      delivery_region: dedupeRepeatedWords(order.shipTo.county) || null,

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
        product_id: line.productSnapshot?.id || null,

        line_number: index + 1,
        sku_base: String(line.itemCode || "").trim() || null,
        description: line.description || line.itemRaw || null,

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
          line.productSnapshot?.id
            ? "Product linked at import"
            : "WARNING: No matching product found in product master at import"
        ].filter(Boolean).join(" | ") || null
      };
    });

    if (!linePayloads.length) {
      throw new Error(`No order lines to insert for ${order.orderNumber}.`);
    }

    const { data: insertedLines, error: lineError } = await client
      .from("order_lines")
      .insert(linePayloads)
      .select("id");

    if (lineError) throw lineError;

    return {
      orderId: insertedOrder.id,
      customerId: productOwnerId,
      lineCount: insertedLines?.length || 0,
      missingSkus
    };
  }

  async function uploadSupplierPackingSlip(orderId, orderNumber, customerId = null) {
    if (!selectedPdfFile || !orderId) return null;

    const cid = await getCompanyId();

    const safeOrder = String(orderNumber || orderId)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    const fileName = `supplier-packing-slip-${safeOrder}.pdf`;
    const storagePath = `${cid}/${orderId}/${fileName}`;

    const { error: uploadError } = await client.storage
      .from("order-documents")
      .upload(storagePath, selectedPdfFile, {
        contentType: "application/pdf",
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: publicData } = client.storage
      .from("order-documents")
      .getPublicUrl(storagePath);

    const fileUrl = publicData?.publicUrl || "";

    const documentPayload = {
      company_id: cid,
      customer_id: customerId,
      order_id: orderId,
      document_type: "supplier_packing_slip",
      document_number: orderNumber || null,
      document_status: "received",
      file_url: fileUrl,
      storage_path: storagePath,
      customer_visible: false
    };

    const { error: docError } = await client
      .from("order_documents")
     .insert(documentPayload);

    if (docError) throw docError;

    return {
      storagePath,
      fileUrl
    };
  }

  async function importOrders() {
    if (!groupedOrders.length) {
      showToast("Read a file first.", "err");
      return;
    }

    if (!getSelectedProductOwner()) {
      showToast("Select a product owner first.", "err");
      return;
    }

    const cid = await getCompanyId();

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let linesWritten = 0;
    let supplierPackingSlipsLinked = 0;
    const missingProductsAfterImport = new Set();

    setProgress(true, 0, "Starting import...");

    for (let i = 0; i < groupedOrders.length; i++) {
      const order = groupedOrders[i];
      const pct = Math.round(((i + 1) / groupedOrders.length) * 100);

      setProgress(true, pct, `Importing ${order.orderNumber} (${i + 1}/${groupedOrders.length})...`);

      if (order.notes.length) {
        order.importMessage = order.notes.join(" · ");
        skipped++;
        renderAll();
        continue;
      }

      if (order.existing && getCheckbox("optSkipExisting", true) && !order.importAnyway) {
        order.importMessage = "Skipped: order number already exists.";
        skipped++;
        renderAll();
        continue;
      }

      try {
        const result = await insertOrder(order, cid);

        if (order.sourceKind === "pdf") {
          try {
            await uploadSupplierPackingSlip(
              result.orderId,
              order.orderNumber,
              result.customerId || null
            );

            supplierPackingSlipsLinked++;
          } catch (pdfError) {
            console.error("Supplier packing slip upload failed", pdfError);
          }
        }

        order.imported = true;
        order.failed = false;

        if (result.missingSkus?.length) {
          result.missingSkus.forEach(sku => missingProductsAfterImport.add(sku));
          order.importMessage = `${result.lineCount} order line(s) written. Missing product(s): ${result.missingSkus.join(", ")}.`;
        } else {
          order.importMessage = `${result.lineCount} order line(s) written.`;
        }

        if (order.sourceKind === "pdf") {
          order.importMessage += supplierPackingSlipsLinked
            ? " Supplier packing slip linked."
            : " Supplier packing slip upload checked.";
        }

        imported++;
        linesWritten += result.lineCount;
      } catch (error) {
        console.error("FULL IMPORT ERROR", error);
        order.failed = true;
        order.imported = false;
        order.importMessage = error.message || JSON.stringify(error);
        failed++;
      }

      renderAll();
    }

    setProgress(false);

    const missingList = [...missingProductsAfterImport].sort((a, b) => a.localeCompare(b));
    const missingText = missingList.length ? ` Missing products: ${missingList.join(", ")}.` : "";
    const pdfText = supplierPackingSlipsLinked ? ` Supplier packing slips linked: ${supplierPackingSlipsLinked}.` : "";

    showToast(
      `Import complete. Imported: ${imported}, lines written: ${linesWritten}, skipped: ${skipped}, failed: ${failed}.${pdfText}${missingText}`,
      failed || missingList.length ? "err" : "ok"
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
    selectedPdfFile = null;
    currentSourceKind = "";
    lastPdfText = "";

    const excelInput = byId("ordersImportFile");
    if (excelInput) excelInput.value = "";

    const pdfInput = byId("packingSlipPdfFile");
    if (pdfInput) pdfInput.value = "";

    setText("fileStatus", "No file selected.");
    setText("excelFileStatus", "No Excel file selected.");
    setText("pdfFileStatus", "No PDF file selected.");

    const textArea = byId("pdfExtractedText");
    if (textArea) textArea.value = "";

    const panel = byId("pdfTextPanel");
    if (panel) panel.style.display = "none";

    renderAll();
  }

  function togglePdfTextPanel() {
    const panel = byId("pdfTextPanel");
    const textArea = byId("pdfExtractedText");
    if (!panel || !textArea) return;

    textArea.value = lastPdfText || "No PDF text extracted yet.";
    panel.style.display = panel.style.display === "none" || !panel.style.display ? "grid" : "none";
  }

  function setSelectedPdfFile(file) {
    if (!file) {
      showToast("No PDF file detected.", "err");
      return;
    }

    const fileName = String(file.name || "").toLowerCase();
    const fileType = String(file.type || "").toLowerCase();

    if (!fileName.endsWith(".pdf") && fileType !== "application/pdf") {
      showToast("Only PDF files are allowed for packing slip import.", "err");
      return;
    }

    selectedPdfFile = file;
    setText("pdfFileStatus", `${file.name} selected`);
    showToast(`PDF selected: ${file.name}`, "ok");
  }

  function bindPdfDropZone() {
    const dropZone = byId("pdfDropZone");
    const input = byId("packingSlipPdfFile");

    if (!dropZone || !input) {
      console.warn("PDF dropzone or file input not found.");
      return;
    }

    function preventDefaults(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
      dropZone.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    ["dragenter", "dragover"].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.add("drag-over");
      }, false);
    });

    ["dragleave", "drop"].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove("drag-over");
      }, false);
    });

    dropZone.addEventListener("drop", event => {
      const files = event.dataTransfer?.files;

      if (!files || !files.length) {
        showToast("No file found in drop.", "err");
        return;
      }

      setSelectedPdfFile(files[0]);
    }, false);

    input.addEventListener("change", event => {
      const file = event.target.files?.[0] || null;
      setSelectedPdfFile(file);
    });
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

  function bindEvents() {
    const excelInput = byId("ordersImportFile");
    if (excelInput) {
      excelInput.addEventListener("change", e => {
        selectedExcelFile = e.target.files?.[0] || null;
        setText("excelFileStatus", selectedExcelFile ? `${selectedExcelFile.name} selected` : "No Excel file selected.");
      });
    }

    byId("productOwnerName")?.addEventListener("change", async () => {
      groupedOrders = groupedOrders.map(finalizeOrder);

      if (groupedOrders.length) {
        try {
          await markMissingProducts();
        } catch (error) {
          console.warn("Product check after owner change skipped:", error.message);
        }
      }

      renderAll();
    });

    bindPdfDropZone();

    firstEl(["btnReadExcelFile", "btnReadFile"])?.addEventListener("click", async () => {
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

    byId("btnReadPdfFile")?.addEventListener("click", async () => {
      try {
        await readPdfFile();
      } catch (error) {
        console.error(error);
        setProgress(false);
        showToast(error.message || "Could not read PDF file.", "err");
      }
    });

    byId("btnShowPdfText")?.addEventListener("click", togglePdfTextPanel);

    byId("btnImportOrders")?.addEventListener("click", async () => {
      try {
        await importOrders();
      } catch (error) {
        console.error(error);
        setProgress(false);
        showToast(error.message || "Import failed.", "err");
      }
    });

    byId("btnClearPreview")?.addEventListener("click", clearPreview);

    ["optSkipExisting", "optSkipZeroQtyPdfLines", "optUsePdfTotalVolume"].forEach(id => {
      byId(id)?.addEventListener("change", renderAll);
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

      bindEvents();
      renderAll();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Order import page failed to load.", "err");
    }
  });
})();