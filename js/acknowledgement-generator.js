(function () {
  "use strict";

  const DOCUMENT_BUCKET = "order-documents";
  const DEFAULT_VAT_RATE = 0.20;
  const DEFAULT_ACK_LEAD_DAYS = 21;

  const FALLBACK_COMPANY = {
    name: "Sofa2U Ltd",
    displayName: "Sofa2U",
    address: "860-862 Garratt Lane, London, SW17 0NB",
    phone: "+44 (0) 7894 469947",
    email: "sales@sofa2u.co.uk",
    vat: "GB 368 665 249",
    logoUrl: "",
    footerText: ""
  };

  const DEFAULT_PRICING = {
    fuel_surcharge_percent: "8.5",
    surcharge_edinburgh_glasgow_percent: "20",
    surcharge_highlands_islands_percent: "40",
    pricing_ireland_mode: "price_on_request",
    pricing_ack_note: "Prices shown exclude fuel surcharge. Fuel surcharge will be added on the weekly invoice."
  };

  const DAMAGE_NOTE = "All goods must be checked for damage and reported within 5 days of delivery.";

  const PAGE = {
    left: 14,
    right: 196,
    width: 182,
    bottom: 268,
    footerY: 278
  };

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function formatMoney(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "£ 0.00";

    return `£ ${num.toLocaleString("en-GB", {
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

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";

    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function addDays(value, days) {
    const d = new Date(value);
    d.setDate(d.getDate() + days);
    return d;
  }

  function splitText(doc, text, width) {
    return doc.splitTextToSize(String(text || ""), width);
  }

  function setDark(doc) {
    doc.setTextColor(34, 34, 34);
  }

  function setMuted(doc) {
    doc.setTextColor(90, 90, 90);
  }

  function safeFilePart(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function dedupeAddressLines(lines) {
    const seen = new Set();

    return (lines || [])
      .map(v => String(v || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter(line => {
        const key = line.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function removeContactLinesFromAddress(lines) {
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const phoneRegex = /(?:\+?\d[\d\s().-]{7,}\d)/;

    return (lines || [])
      .map(cleanText)
      .filter(Boolean)
      .filter(line => !emailRegex.test(line))
      .filter(line => {
        const digitCount = line.replace(/\D/g, "").length;
        return !(phoneRegex.test(line) && digitCount >= 9);
      });
  }

  function getMemo(order) {
    return cleanText(order?.memo || "");
  }

  function getSupplierReference(order) {
    const so = cleanText(order?.order_number || "");
    const ref = cleanText(order?.external_reference || "");

    if (!ref || ref === so) return "";
    return ref;
  }

  function getOrderLines(order) {
    return Array.isArray(order?.order_lines) ? order.order_lines : [];
  }

  function getProductOwnerName(order) {
    return cleanText(order?.customers?.name || order?.product_owner_name || order?.customer_name || "—");
  }
function isZoyOrder(order, ctx = {}) {
  return (
    normalize(ctx?.productOwner?.key) === "zoy" ||
    normalize(ctx?.productOwner?.customerCode) === "zoy" ||
    normalize(ctx?.productOwner?.customer_code) === "zoy" ||
    normalize(ctx?.productOwner?.default_source_name) === "zoy" ||
    normalize(ctx?.productOwner?.tradingName).includes("zoy") ||
    normalize(ctx?.productOwner?.trading_name).includes("zoy") ||
    normalize(order?.customers?.customer_code) === "zoy"
  );
}

  function getShipToName(order) {
    return cleanText(order?.retail_name || order?.retailer_name || order?.delivery_name || "—");
  }

  function getLineSku(line) {
    return cleanText(line.sku_base || line.products?.sku_base || "—");
  }

  function getLineDescription(line) {
    return cleanText(
      line.description ||
      line.products?.description ||
      line.products?.name ||
      "—"
    );
  }

  function getLineQty(line) {
    return toNumber(line.quantity_ordered || line.quantity || 0, 0);
  }

  function getProductPackageCount(product) {
    const packageCount = toNumber(product?.package_count, 0);
    if (packageCount > 0) return Math.max(1, Math.round(packageCount));

    const packagesPerUnit = toNumber(product?.packages_per_unit, 0);
    if (packagesPerUnit > 0) return Math.max(1, Math.round(packagesPerUnit));

    const flags = [
      toNumber(product?.package_1_qty, 0),
      toNumber(product?.package_2_qty, 0),
      toNumber(product?.package_3_qty, 0),
      toNumber(product?.package1_qty, 0),
      toNumber(product?.package2_qty, 0),
      toNumber(product?.package3_qty, 0)
    ];

    const count = flags.filter(v => v > 0).length;
    return Math.max(1, count || 1);
  }

  function isServiceLine(line) {
    return (
      toNumber(line.requested_package_no, 0) > 0 &&
      toNumber(line.requested_package_total, 0) > 0
    );
  }

  function getLinePackageCount(line) {
    const qty = Math.max(0, Math.round(getLineQty(line)));

    if (isServiceLine(line)) return qty;

    return qty * getProductPackageCount(line.products || {});
  }

  function getPackageLabel(line) {
    const qty = Math.max(1, Math.round(getLineQty(line) || 1));

    if (isServiceLine(line)) {
      const label =
        line.requested_package_label ||
        `${Math.round(toNumber(line.requested_package_no, 0))}/${Math.round(toNumber(line.requested_package_total, 0))}`;

      return qty <= 1 ? label : `${label} × ${qty}`;
    }

    const packageTotal = getProductPackageCount(line.products || {});
    const labels = Array.from(
      { length: packageTotal },
      (_, index) => `${index + 1}/${packageTotal}`
    );

    return qty <= 1 ? labels.join(" & ") : `${labels.join(" & ")} × ${qty}`;
  }

function getServiceWarning(line, order) {

  // Zoy orders krijgen deze melding nooit
  if (isZoyOrder(order)) return "";

  if (!isServiceLine(line)) return "";

  const label =
    line.requested_package_label ||
    `${Math.round(toNumber(line.requested_package_no, 0))}/${Math.round(toNumber(line.requested_package_total, 0))}`;

  return `SERVICE / PARTIAL ORDER: This acknowledgement relates to package ${label} only. Remaining packages are not part of this order.`;
}

  function getTotalProducts(order) {
    return getOrderLines(order).reduce((sum, line) => sum + getLineQty(line), 0);
  }

  function getTotalPackages(order) {
    return getOrderLines(order).reduce((sum, line) => sum + getLinePackageCount(line), 0);
  }

  function getSettingsObject(map) {
    const obj = {};
    map.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  function calculatePricing(order, settings) {
    if (window.VeynorPricing?.calculateOrderPricing) {
      return window.VeynorPricing.calculateOrderPricing(order, settings);
    }

    const lines = getOrderLines(order);

    const warehouse = round2(lines.reduce((sum, line) => {
      return sum +
        toNumber(line.tariff_storage, 0) +
        toNumber(line.tariff_admin, 0) +
        toNumber(line.tariff_handling, 0);
    }, 0));

    const transport = round2(lines.reduce((sum, line) => {
      return sum + toNumber(line.tariff_transport, 0);
    }, 0));

    return {
      warehouse,
      baseTransport: transport,
      regionalSurcharge: 0,
      transport,
      subtotalExFuel: round2(warehouse + transport),
      totalExFuel: round2(warehouse + transport),
      priceOnRequest: false,
      regional: {
        code: "standard",
        label: "Standard UK mainland",
        percent: 0,
        priceOnRequest: false,
        note: ""
      },
      note: ""
    };
  }

  function getLineWarehouseCost(line) {
    if (window.VeynorPricing?.getLineWarehouseCost) {
      return window.VeynorPricing.getLineWarehouseCost(line);
    }

    return round2(
      toNumber(line.tariff_storage, 0) +
      toNumber(line.tariff_admin, 0) +
      toNumber(line.tariff_handling, 0)
    );
  }

  function getLineTransportCost(line, regional) {
    if (regional?.priceOnRequest) return null;

    if (window.VeynorPricing?.getLineTransportCost) {
      return window.VeynorPricing.getLineTransportCost(line, regional);
    }

    return round2(toNumber(line.tariff_transport, 0));
  }

  function getLineTotal(line, regional) {
    if (regional?.priceOnRequest) return null;

    return round2(
      getLineWarehouseCost(line) +
      getLineTransportCost(line, regional)
    );
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function urlToDataUrl(url) {
    if (!url) return "";

    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`Logo fetch failed: ${res.status}`);
      const blob = await res.blob();
      return await blobToDataUrl(blob);
    } catch (error) {
      console.warn("Logo could not be loaded for ACK:", error.message);
      return "";
    }
  }

  function getImageFormat(dataUrl) {
    const lower = String(dataUrl || "").toLowerCase();
    if (lower.includes("image/jpeg") || lower.includes("image/jpg")) return "JPEG";
    if (lower.includes("image/webp")) return "WEBP";
    return "PNG";
  }

  function addLogo(doc, logoDataUrl, x, y, maxW, maxH) {
    if (!logoDataUrl) return false;

    try {
      const props = doc.getImageProperties(logoDataUrl);
      const ratio = props.width / props.height;

      let w = maxW;
      let h = w / ratio;

      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }

      doc.addImage(logoDataUrl, getImageFormat(logoDataUrl), x, y, w, h);
      return true;
    } catch (error) {
      console.warn("ACK logo addImage failed:", error.message);
      return false;
    }
  }

  async function loadCompanySettings(client, companyId) {
    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId);

    if (error) {
      console.warn("ACK company settings skipped:", error.message);
      return {
        settings: { ...DEFAULT_PRICING },
        company: { ...FALLBACK_COMPANY },
        vatRate: DEFAULT_VAT_RATE,
        ackLeadDays: DEFAULT_ACK_LEAD_DAYS,
        pricingAckNote: DEFAULT_PRICING.pricing_ack_note
      };
    }

    const map = new Map((data || []).map(row => [row.setting_key, row.setting_value ?? ""]));
    const settings = {
      ...DEFAULT_PRICING,
      ...getSettingsObject(map)
    };

    return {
      settings,
      company: {
        name: map.get("main_company_name") || FALLBACK_COMPANY.name,
        displayName: map.get("main_display_name") || FALLBACK_COMPANY.displayName,
        address: map.get("main_address") || FALLBACK_COMPANY.address,
        phone: map.get("main_phone") || FALLBACK_COMPANY.phone,
        email: map.get("main_email") || FALLBACK_COMPANY.email,
        vat: map.get("main_vat") || FALLBACK_COMPANY.vat,
        logoUrl: map.get("main_logo_url") || FALLBACK_COMPANY.logoUrl,
        footerText: map.get("document_footer_text") || FALLBACK_COMPANY.footerText
      },
      vatRate: toNumber(map.get("tax_default_vat_rate") || map.get("doc_vat_rate"), DEFAULT_VAT_RATE),
      ackLeadDays: Math.round(toNumber(map.get("ack_lead_days") || map.get("default_ack_lead_days") || map.get("doc_ack_lead_days"), DEFAULT_ACK_LEAD_DAYS)),
      pricingAckNote: map.get("pricing_ack_note") || DEFAULT_PRICING.pricing_ack_note
    };
  }

async function loadProductOwnerProfile(client, customerId, order, settings = {}) {
  const ownerName = normalize(getProductOwnerName(order));
  const ownerCode = normalize(order?.customers?.customer_code || "");

  let profiles = [];

  try {
    profiles = JSON.parse(settings.product_owner_profiles || "[]");
  } catch {
    profiles = [];
  }

  const profile = profiles.find(p => {
    const values = [
      p.key,
      p.name,
      p.trading_name,
      p.customer_code,
      p.default_source_name
    ].filter(Boolean).map(normalize);

    return values.some(value =>
      value &&
      (
        value === ownerName ||
        value === ownerCode ||
        ownerName.includes(value) ||
        value.includes(ownerName)
      )
    );
  });

  if (profile) {
    return {
      id: customerId || null,
      ...profile,
      name: profile.name || profile.trading_name || getProductOwnerName(order),
      tradingName: profile.trading_name || "",
      customerCode: profile.customer_code || ""
    };
  }

  const { data: customer, error: customerError } = await client
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!customer?.id) throw new Error("Cannot generate ACK: product owner/customer not found.");

  return {
    id: customer.id,
    name: customer.name || getProductOwnerName(order),
    customerCode: customer.customer_code || "",
    vat: customer.vat_number || customer.vat || "",
    email: customer.billing_email || customer.email || "",
    address1: customer.address1 || customer.address_1 || "",
    address2: customer.address2 || customer.address_2 || "",
    city: customer.city || "",
    county: customer.county || "",
    postcode: customer.postcode || "",
    country: customer.country || "United Kingdom"
  };
}

  async function loadFreshOrderForAck(client, companyId, orderId) {
    const { data, error } = await client
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name,
          customer_code,
          customer_type,
          vat_number,
          billing_email
        ),
        order_documents (
          id,
          document_type,
          document_number,
          document_status,
          file_url,
          storage_path,
          created_at,
          updated_at
        ),
        order_lines (
          id,
          order_id,
          quantity_ordered,
          requested_package_no,
          requested_package_total,
          requested_package_label,
          product_id,
          sku_base,
          description,
          unit_volume_m3,
          total_volume_m3,
          total_line_volume_m3,
          tariff_storage,
          tariff_admin,
          tariff_handling,
          tariff_transport,
          total_customer_charge,
          products (
            id,
            sku_base,
            name,
            description,
            volume_m3,
            weight_kg,
            net_weight_kg,
            package_count,
            package_1_qty,
            package_2_qty,
            package_3_qty,
            packages_per_unit
          )
        )
      `)
      .eq("company_id", companyId)
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  function drawHeader(doc, order, ctx, logoDataUrl, compact = false) {
    const company = ctx.company;
    const ackDate = new Date();
    const expectedDate = addDays(ackDate, ctx.ackLeadDays || DEFAULT_ACK_LEAD_DAYS);
    const supplierRef = getSupplierReference(order);

    const logoAdded = addLogo(doc, logoDataUrl, 14, 9, 35, 18);

    setDark(doc);

    if (!logoAdded) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(company.displayName || company.name, 14, 18);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Order Acknowledgement", 196, 18, { align: "right" });

    doc.setFontSize(8);
    doc.text(`Order No: ${order.order_number || "—"}`, 196, 28, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);

    let y = 36;

    if (supplierRef) {
      doc.text(`Supplier Ref: ${supplierRef}`, 196, y, { align: "right" });
      y += 5.4;
    }

    doc.text(`Purchase Order: ${order.purchase_order || "Unknown"}`, 196, y, { align: "right" });
    y += 5.4;
    doc.text(`Order Date: ${formatDate(ackDate)}`, 196, y, { align: "right" });
    y += 5.4;
    doc.text(`Expected Delivery: ${formatDate(expectedDate)}`, 196, y, { align: "right" });

    if (compact) return;

    const infoY = 32;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(company.name, 14, infoY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(cleanText(company.address), 14, infoY + 5);

    doc.setFont("helvetica", "bold");
    doc.text("Phone", 14, infoY + 12);
    doc.setFont("helvetica", "normal");
    doc.text(company.phone, 27, infoY + 12);

    doc.setFont("helvetica", "bold");
    doc.text("Email", 70, infoY + 12);
    doc.setFont("helvetica", "normal");
    doc.text(company.email, 82, infoY + 12);

    doc.setFont("helvetica", "bold");
    doc.text(`VAT No ${company.vat}`, 14, infoY + 19);
  }

  function drawAddressBlock(doc, title, lines, x, y, width, height) {
    doc.setFillColor(248, 248, 248);
    doc.rect(x - 2, y - 5, width + 4, height, "F");

    doc.setDrawColor(215, 215, 215);
    doc.rect(x - 2, y - 5, width + 4, height);

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(title, x, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.4);

    const wrapped = splitText(
      doc,
      lines.map(cleanText).filter(Boolean).join("\n"),
      width - 4
    );

    let lineY = y + 5.2;

    wrapped.forEach(line => {
      if (lineY < y + height - 7) {
        doc.text(line, x, lineY);
        lineY += 4;
      }
    });
  }

  function drawBillToAndShipTo(doc, order, ctx) {
    const billTo = ctx.productOwner;

    const billToLines = dedupeAddressLines([
      billTo.name,
      billTo.address1,
      billTo.address2,
      billTo.city,
      billTo.county,
      billTo.postcode,
      billTo.country,
      billTo.vat ? `VAT No: ${billTo.vat}` : ""
    ]);

    const shipToLines = dedupeAddressLines(removeContactLinesFromAddress([
      getShipToName(order),
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_address_3,
      order.delivery_address_4,
      order.delivery_city,
      order.delivery_region,
      order.delivery_postcode,
      order.delivery_country || "United Kingdom"
    ]));

    drawAddressBlock(doc, "Bill To:", billToLines, 14, 62, 78, 36);
    drawAddressBlock(doc, "Ship To:", shipToLines, 112, 62, 78, 36);
  }

function drawTableHeader(doc, y, order, ctx = {}) {
  const zoy = isZoyOrder(order, ctx);

  setDark(doc);

  doc.setFillColor(245, 245, 245);
  doc.rect(14, y - 5, 182, 8.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);

  doc.text("SKU", 14, y);
  doc.text("Product Description", 33, y);
  doc.text("Qty", 104, y, { align: "right" });
  doc.text("Packages", 122, y);

  if (zoy) {
    doc.text("Price", 166, y, { align: "right" });
    doc.text("Total", 194, y, { align: "right" });
  } else {
    doc.text("Warehouse", 146, y, { align: "right" });
    doc.text("Transport", 166, y, { align: "right" });
    doc.text("Total", 194, y, { align: "right" });
  }

  doc.setDrawColor(85, 85, 85);
  doc.line(14, y + 3.3, 196, y + 3.3);

  return y + 8.5;
}

  function maybeAddNewPage(doc, y, order, ctx, logoDataUrl, withTableHeader = true) {
    if (y <= PAGE.bottom) return y;

    doc.addPage();
    drawHeader(doc, order, ctx, logoDataUrl, true);

    if (withTableHeader) {
      return drawTableHeader(doc, 58, order, ctx);
    }

    return 58;
  }

  function drawServiceWarningBox(doc, y, warning) {
    const warningLines = splitText(doc, warning, 172);
    const boxHeight = Math.max(9, warningLines.length * 3.3 + 5);

    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(253, 186, 116);
    doc.roundedRect(14, y - 4, 182, boxHeight, 1.6, 1.6, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(194, 65, 12);
    doc.text(warningLines.slice(0, 3), 17, y + 0.8);

    setDark(doc);

    return y + boxHeight + 2;
  }

  function drawPriceOnRequestBox(doc, y, ctx, order, logoDataUrl) {
    y = maybeAddNewPage(doc, y, order, ctx, logoDataUrl, false);

    const text = "This delivery area is price on request. Final transport pricing must be confirmed manually before invoicing.";
    const lines = splitText(doc, text, 172);

    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(253, 186, 116);
    doc.roundedRect(14, y - 4, 182, 12, 1.8, 1.8, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(194, 65, 12);
    doc.text(lines.slice(0, 2), 17, y + 1.2);

    setDark(doc);

    return y + 14;
  }

  function drawLines(doc, order, ctx, logoDataUrl, pricing) {
    let y = 108;
    y = drawTableHeader(doc, y, order, ctx);

    const lines = getOrderLines(order);
    const regional = pricing.regional || {};

    if (!lines.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      doc.text("No product lines found for this order.", 14, y);
      return { y: y + 7 };
    }

    lines.forEach(line => {
      y = maybeAddNewPage(doc, y, order, ctx, logoDataUrl, true);

      const sku = getLineSku(line);
      const description = getLineDescription(line);
      const qty = getLineQty(line);
      const packageCount = getLinePackageCount(line);
      const packageLabel = getPackageLabel(line);
      const warning = getServiceWarning(line, order);

const zoy = isZoyOrder(order, ctx);

const warehouseCost = getLineWarehouseCost(line);
const transportCost = getLineTransportCost(line, regional);

const unitPrice = round2(toNumber(line.total_customer_charge, 0));
const lineTotal = round2(unitPrice * qty);

const total = zoy
  ? lineTotal
  : getLineTotal(line, regional);

      const descLines = splitText(doc, description, 56).slice(0, 3);
      const packageWord = packageCount === 1 ? "package" : "packages";
      const packageLines = splitText(doc, `${packageCount} ${packageWord}`, 24);
      const labelLines = splitText(doc, packageLabel, 24).slice(0, 2);

      const rowHeight = Math.max(
        7,
        descLines.length * 3.25,
        (packageLines.length + labelLines.length) * 3.15
      );

      setDark(doc);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);

      doc.text(sku, 14, y);
      doc.text(descLines, 33, y);
      doc.text(formatNumber(qty, 0), 96, y, { align: "right" });

      doc.setFont("helvetica", "bold");
      doc.text(packageLines, 110, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.1);
      doc.text(labelLines, 110, y + 3.4);

      doc.setFontSize(6.8);
if (zoy) {

  doc.text(formatMoney(unitPrice), 166, y, {
    align: "right"
  });

  doc.text(formatMoney(lineTotal), 194, y, {
    align: "right"
  });

} else {

  doc.text(formatMoney(warehouseCost), 146, y, {
    align: "right"
  });

  doc.text(
    regional.priceOnRequest
      ? "POR"
      : formatMoney(transportCost),
    166,
    y,
    {
      align: "right"
    }
  );

  doc.text(
    regional.priceOnRequest
      ? "POR"
      : formatMoney(total),
    194,
    y,
    {
      align: "right"
    }
  );

}

      y += rowHeight + 1;

      if (warning) {
        y = maybeAddNewPage(doc, y + 1, order, ctx, logoDataUrl, false);
        y = drawServiceWarningBox(doc, y, warning);
      }
    });

    if (regional.priceOnRequest) {
      y = drawPriceOnRequestBox(doc, y + 2, ctx, order, logoDataUrl);
    }

    return { y: y + 3 };
  }

  function drawPricingNoteBox(doc, y, ctx, order, logoDataUrl) {
    const note = cleanText(ctx.productOwner?.pricing_ack_note || ctx.pricingAckNote || "");
    if (!note) return y;

    y = maybeAddNewPage(doc, y + 2, order, ctx, logoDataUrl, false);

    const lines = splitText(doc, note, 172);
    const boxHeight = Math.max(10, lines.length * 3.4 + 5);

    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(191, 219, 254);
    doc.roundedRect(14, y - 4, 182, boxHeight, 1.8, 1.8, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.9);
    doc.setTextColor(29, 78, 216);
    doc.text(lines.slice(0, 3), 17, y + 1);

    setDark(doc);

    return y + boxHeight + 3;
  }

  function drawRegionalNote(doc, y, pricing, ctx, order, logoDataUrl) {
    const regional = pricing.regional || {};
    const note = cleanText(regional.note || "");

    if (!note || regional.priceOnRequest) return y;

    y = maybeAddNewPage(doc, y + 2, order, ctx, logoDataUrl, false);

    const lines = splitText(doc, note, 172);
    const boxHeight = Math.max(9, lines.length * 3.3 + 5);

    doc.setFillColor(245, 243, 255);
    doc.setDrawColor(221, 214, 254);
    doc.roundedRect(14, y - 4, 182, boxHeight, 1.8, 1.8, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(109, 40, 217);
    doc.text(lines.slice(0, 3), 17, y + 1);

    setDark(doc);

    return y + boxHeight + 3;
  }

function drawTotalsBlock(doc, y, pricing, ctx, order, logoDataUrl) {
  y = maybeAddNewPage(doc, y, order, ctx, logoDataUrl, false);

  const zoy = isZoyOrder(order, ctx);
  const regional = pricing.regional || {};

  const totalProducts = getTotalProducts(order);
  const totalPackages = getTotalPackages(order);

  doc.setDrawColor(90, 90, 90);
  doc.line(14, y, 196, y);

  y += 7;

  const labelX = 118;
  const valueX = 194;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);

  doc.text("Total Products", labelX, y);
  doc.text(formatNumber(totalProducts, 0), valueX, y, { align: "right" });

  y += 5;

  doc.text("Total Packages", labelX, y);
  doc.text(formatNumber(totalPackages, 0), valueX, y, { align: "right" });

  y += 7;

  if (zoy) {
    const subtotal = round2(
      getOrderLines(order).reduce((sum, line) => {
        const qty = getLineQty(line);
        const unitPrice = toNumber(line.total_customer_charge, 0);
        return sum + qty * unitPrice;
      }, 0)
    );

    const regionalSurcharge = round2(toNumber(pricing.regionalSurcharge, 0));
    const total = round2(subtotal + regionalSurcharge);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.text("Order Total", labelX, y);

    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);

    doc.text("Subtotal", labelX, y);
    doc.text(formatMoney(subtotal), valueX, y, { align: "right" });

    if (!regional.priceOnRequest && regionalSurcharge > 0) {
      y += 5.2;

      doc.text(
        `Transport surcharge (${regional.label} ${formatNumber(regional.percent, 0)}%)`,
        labelX,
        y
      );

      doc.text(formatMoney(regionalSurcharge), valueX, y, { align: "right" });
    }

    y += 5.8;

    doc.setFont("helvetica", "bold");
    doc.text("Subtotal excl. VAT", labelX, y);
    doc.text(formatMoney(total), valueX, y, { align: "right" });

    y = drawRegionalNote(doc, y + 7, pricing, ctx, order, logoDataUrl);

    return y + 2;
  }

  const subtotal = regional.priceOnRequest
    ? null
    : round2(pricing.warehouse + pricing.transport);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.text("Order Total", labelX, y);

  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);

  doc.text("Warehouse Costs", labelX, y);
  doc.text(formatMoney(pricing.warehouse), valueX, y, { align: "right" });

  y += 5.2;

  doc.text("Transport Costs", labelX, y);
  doc.text(
    regional.priceOnRequest ? "Price on Request" : formatMoney(pricing.transport),
    valueX,
    y,
    { align: "right" }
  );

  if (!regional.priceOnRequest && pricing.regionalSurcharge > 0) {
    y += 5.2;

    doc.text(
      `Transport surcharge (${regional.label} ${formatNumber(regional.percent, 0)}%)`,
      labelX,
      y
    );

    doc.text(formatMoney(pricing.regionalSurcharge), valueX, y, { align: "right" });
  }

  y += 5.8;

  doc.setFont("helvetica", "bold");
  doc.text("Subtotal excl. VAT", labelX, y);
  doc.text(
    regional.priceOnRequest ? "Price on Request" : formatMoney(subtotal),
    valueX,
    y,
    { align: "right" }
  );

  y = drawRegionalNote(doc, y + 7, pricing, ctx, order, logoDataUrl);
  y = drawPricingNoteBox(doc, y, ctx, order, logoDataUrl);

  return y + 2;
}
function drawMemoAndDamageNote(doc, y, order, ctx, logoDataUrl) {
  y = maybeAddNewPage(doc, y + 1, order, ctx, logoDataUrl, false);

  const memo = getMemo(order);

  if (memo) {
    const memoLines = splitText(doc, memo, 170).slice(0, 3);
    const boxHeight = Math.max(10, memoLines.length * 3.5 + 6);

    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(210, 210, 210);
    doc.roundedRect(14, y - 4, 182, boxHeight, 1.6, 1.6, "FD");

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.text("Memo", 17, y + 1);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(memoLines, 37, y + 1);

    y += boxHeight + 2;
  }

  y = maybeAddNewPage(doc, y + 1, order, ctx, logoDataUrl, false);

  setDark(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);

  const noteLines = splitText(doc, DAMAGE_NOTE, 180);
  doc.text(noteLines.slice(0, 2), 14, y);

  return y + 5;
}

  function drawBusinessFooter(doc, company) {
    const pageCount = doc.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);

      doc.setDrawColor(185, 185, 185);
      doc.line(14, 277, 196, 277);

      setMuted(doc);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);

      const footerLine1 = company.footerText || `${company.name}  ${company.address}`;
      const footerLine2 = `Phone ${company.phone}   Email ${company.email}   VAT No ${company.vat}`;

      doc.text(footerLine1, 105, 282.5, { align: "center" });
      doc.text(footerLine2, 105, 287, { align: "center" });

      setDark(doc);
    }
  }

async function createPdfBlob(order, ctx) {
  if (!window.jspdf?.jsPDF) {
    throw new Error("jsPDF is not loaded. Add jsPDF before acknowledgement-generator.js in the HTML.");
  }

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const logoDataUrl = await urlToDataUrl(ctx.company.logoUrl);

  const pricing = calculatePricing(order, {
    ...(ctx.settings || {}),

    regional_surcharge_enabled:
      ctx.productOwner?.regional_surcharge_enabled ??
      ctx.settings?.regional_surcharge_enabled,

    surcharge_edinburgh_glasgow_percent:
      ctx.productOwner?.surcharge_edinburgh_glasgow_percent ??
      ctx.settings?.surcharge_edinburgh_glasgow_percent,

    surcharge_highlands_islands_percent:
      ctx.productOwner?.surcharge_highlands_islands_percent ??
      ctx.settings?.surcharge_highlands_islands_percent,

    pricing_ireland_mode:
      ctx.productOwner?.pricing_ireland_mode ??
      ctx.settings?.pricing_ireland_mode,

    fuel_surcharge_enabled:
      ctx.productOwner?.fuel_surcharge_enabled ??
      ctx.settings?.fuel_surcharge_enabled,

    fuel_surcharge_percent:
      ctx.productOwner?.fuel_surcharge_percent ??
      ctx.settings?.fuel_surcharge_percent
  });

ctx.pricing = pricing;

console.log("Product owner:", ctx.productOwner);
console.log("Order:", order);
console.log("Is Zoy:", isZoyOrder(order, ctx));

  drawHeader(doc, order, ctx, logoDataUrl, false);
  drawBillToAndShipTo(doc, order, ctx);

  const result = drawLines(doc, order, ctx, logoDataUrl, pricing);
  let y = drawTotalsBlock(doc, result.y, pricing, ctx, order, logoDataUrl);
  y = drawMemoAndDamageNote(doc, y, order, ctx, logoDataUrl);

  drawBusinessFooter(doc, ctx.company);

  return doc.output("blob");
}

  async function uploadPdf(client, companyId, order, blob) {
const soPart = safeFilePart(order.order_number || order.id);
const ackPart = safeFilePart(order.external_reference || "");

const versionPart = Date.now();

const fileName = ackPart
  ? `Acknowledgement ${soPart} ${ackPart} ${versionPart}.pdf`
  : `Acknowledgement ${soPart} ${versionPart}.pdf`;

const storagePath = `${companyId}/${order.id}/${fileName}`;

    const { error } = await client.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, blob, {
        contentType: "application/pdf",
        upsert: true
      });

    if (error) throw error;

    const { data } = client.storage
      .from(DOCUMENT_BUCKET)
      .getPublicUrl(storagePath);

    return {
      storagePath,
      fileUrl: data?.publicUrl || ""
    };
  }

  async function upsertDocumentRecord(client, companyId, order, uploaded) {
    const existing = (order.order_documents || [])
      .find(doc => normalize(doc.document_type) === "acknowledgement");

    const payload = {
      company_id: companyId,
      customer_id: order.customer_id || null,
      order_id: order.id,
      document_type: "acknowledgement",
      document_number: order.order_number || String(order.id).slice(0, 8),
      document_status: "generated",
      file_url: uploaded.fileUrl,
      storage_path: uploaded.storagePath,
      customer_visible: true,
      updated_at: new Date().toISOString()
    };

    if (existing?.id) {
      const { error } = await client
        .from("order_documents")
        .update(payload)
        .eq("id", existing.id);

      if (error) throw error;
      return existing.id;
    }

    const { data, error } = await client
      .from("order_documents")
      .insert({
        ...payload,
        created_at: new Date().toISOString()
      })
      .select("id")
      .single();

    if (error) throw error;
    return data?.id || null;
  }

  async function createActivity(client, companyId, order, description) {
    const { error } = await client
      .from("order_activity_log")
      .insert({
        company_id: companyId,
        customer_id: order.customer_id || null,
        order_id: order.id,
        activity_type: "document_generated",
        old_status: "not_generated",
        new_status: "generated",
        description,
        created_by: "manual"
      });

    if (error) {
      console.warn("Activity log insert skipped:", error.message);
    }
  }

  async function generate(order, client, companyId) {
    if (!order?.id) throw new Error("Cannot generate ACK: order is missing.");
    if (!client) throw new Error("Cannot generate ACK: Supabase client is missing.");
    if (!companyId) throw new Error("Cannot generate ACK: companyId is missing.");

    const freshOrder = await loadFreshOrderForAck(client, companyId, order.id);
    const workingOrder = freshOrder || order;

    const ctx = await loadCompanySettings(client, companyId);
ctx.productOwner = await loadProductOwnerProfile(
  client,
  workingOrder.customer_id,
  workingOrder,
  ctx.settings || {}
);

    const blob = await createPdfBlob(workingOrder, ctx);
    const uploaded = await uploadPdf(client, companyId, workingOrder, blob);

    if (!uploaded.fileUrl || !uploaded.storagePath) {
      throw new Error("ACK PDF was uploaded, but no file URL/storage path was returned.");
    }

    await upsertDocumentRecord(client, companyId, workingOrder, uploaded);

    await createActivity(
      client,
      companyId,
      workingOrder,
      "ACK document generated and uploaded"
    );

await client
  .from("orders")
  .update({
    last_activity_at: new Date().toISOString()
  })
  .eq("id", workingOrder.id);

//-----------------------------------------------------
// Message Center Notification
//-----------------------------------------------------

try {

  await client
    .from("system_notifications")
    .insert({

      company_id: companyId,
      customer_id: workingOrder.customer_id,

      recipient_role: null,

      notification_type: "ack_generated",

      title: "New Acknowledgement",

 message:
  `Acknowledgement PDF is now available for order ${workingOrder.order_number || "Unknown"}.`,

      severity: "info",

      entity_type: "order",
      entity_id: workingOrder.id,

      action_url: uploaded.fileUrl,

      is_read: false,
      popup_shown: false

    });

} catch (error) {

  console.warn(
    "ACK notification could not be created:",
    error.message
  );

}
console.log("ACK notification should be created now");
return uploaded;
  }

  window.AcknowledgementGenerator = {
    generate
  };
})();