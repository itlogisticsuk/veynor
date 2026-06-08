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

  const DAMAGE_NOTE = "All goods must be checked for damage and reported within 5 days of delivery.";

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

function dedupeAddressLines(lines) {
  const seen = new Set();

  return (lines || [])
    .map(v => String(v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(line => {
      const key = line
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      if (!key || seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
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

  function addDays(value, days) {
    const d = new Date(value);
    d.setDate(d.getDate() + days);
    return d;
  }

  function getAckCreatedDate() {
    return new Date();
  }

  function getMemo(order) {
    return cleanText(order?.memo || "");
  }

  function getOrderLines(order) {
    return Array.isArray(order?.order_lines) ? order.order_lines : [];
  }

  function getProductOwnerName(order) {
    return cleanText(order?.customers?.name || order?.product_owner_name || order?.customer_name || "—");
  }

  function getShipToName(order) {
    return cleanText(order?.retail_name || order?.retailer_name || "—");
  }

  function getLineWarehouseCost(line) {
    return round2(
      toNumber(line.tariff_storage, 0) +
      toNumber(line.tariff_admin, 0) +
      toNumber(line.tariff_handling, 0)
    );
  }

  function getLineTransportCost(line) {
    return round2(toNumber(line.tariff_transport, 0));
  }

  function getLineTotal(line) {
    const explicitTotal = toNumber(line.total_customer_charge, 0);
    if (explicitTotal > 0) return round2(explicitTotal);
    return round2(getLineWarehouseCost(line) + getLineTransportCost(line));
  }

  function safeFilePart(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
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

  async function loadCompanySettings(client, companyId) {
    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId);

    if (error) {
      console.warn("ACK company settings skipped:", error.message);
      return {
        company: { ...FALLBACK_COMPANY },
        vatRate: DEFAULT_VAT_RATE,
        ackLeadDays: DEFAULT_ACK_LEAD_DAYS
      };
    }

    const map = new Map((data || []).map(row => [row.setting_key, row.setting_value ?? ""]));

    return {
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
      ackLeadDays: Math.round(toNumber(map.get("ack_lead_days") || map.get("default_ack_lead_days"), DEFAULT_ACK_LEAD_DAYS))
    };
  }

  async function loadProductOwnerProfile(client, customerId, order) {
    if (!customerId) {
      throw new Error("Cannot generate ACK: order has no product owner/customer_id.");
    }

    const { data: customer, error: customerError } = await client
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) throw customerError;
    if (!customer?.id) throw new Error("Cannot generate ACK: product owner/customer not found.");

    let address = null;

    const { data: addresses, error: addressError } = await client
      .from("customer_addresses")
      .select("*")
      .eq("customer_id", customerId)
      .order("is_default", { ascending: false })
      .limit(1);

    if (!addressError && addresses?.length) {
      address = addresses[0];
    }

    return {
      id: customer.id,
      name: customer.name || getProductOwnerName(order),
      customerCode: customer.customer_code || "",
      vat: customer.vat_number || customer.vat || "",
      email: customer.billing_email || customer.email || "",
      address1: address?.street || customer.address1 || customer.address_1 || "",
      address2: address?.address2 || customer.address2 || customer.address_2 || "",
      city: address?.city || customer.city || "",
      county: address?.county || customer.county || "",
      postcode: address?.postal_code || address?.postcode || customer.postcode || "",
      country: address?.country || customer.country || "United Kingdom"
    };
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

  function drawHeader(doc, order, ctx, logoDataUrl) {
    const company = ctx.company;
    const ackDate = getAckCreatedDate();
    const expectedDate = addDays(ackDate, ctx.ackLeadDays || DEFAULT_ACK_LEAD_DAYS);

    const logoAdded = addLogo(doc, logoDataUrl, 14, 12, 48, 24);

    setDark(doc);

    if (!logoAdded) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.text(company.displayName || company.name, 14, 24);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Order Acknowledgement", 196, 22, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    doc.text(`Order No: ${order.order_number || "—"}`, 196, 33, { align: "right" });
    doc.text(`Order Date: ${formatDate(ackDate)}`, 196, 40, { align: "right" });
    doc.text(`Expected Delivery Date: ${formatDate(expectedDate)}`, 196, 47, { align: "right" });
    doc.text(`Your Reference: ${order.purchase_order || "Unknown"} / ${order.order_number || "—"}`, 196, 54, { align: "right" });

    const infoY = logoAdded ? 45 : 34;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(company.name, 14, infoY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(cleanText(company.address), 14, infoY + 6);

    doc.setFont("helvetica", "bold");
    doc.text("Phone", 14, infoY + 15);
    doc.setFont("helvetica", "normal");
    doc.text(company.phone, 28, infoY + 15);

    doc.setFont("helvetica", "bold");
    doc.text("Email", 78, infoY + 15);
    doc.setFont("helvetica", "normal");
    doc.text(company.email, 92, infoY + 15);

    doc.setFont("helvetica", "bold");
    doc.text(`VAT No ${company.vat}`, 14, infoY + 23);
  }

  function drawAddressBlock(doc, title, lines, x, y, width, height) {
    doc.setFillColor(247, 247, 247);
    doc.rect(x - 2, y - 6, width + 4, height, "F");

    doc.setDrawColor(210, 210, 210);
    doc.rect(x - 2, y - 6, width + 4, height);

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(title, x, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    const wrapped = splitText(
      doc,
      lines.map(cleanText).filter(Boolean).join("\n"),
      width - 4
    );

    let lineY = y + 7;

    wrapped.forEach(line => {
      if (lineY < y + height - 9) {
        doc.text(line, x, lineY);
        lineY += 5;
      }
    });

    return lineY;
  }

  function drawBillToAndShipTo(doc, order, ctx) {
    const billTo = ctx.productOwner;

    const billToLines = [
      billTo.name,
      billTo.address1,
      billTo.address2,
      billTo.city,
      billTo.county,
      billTo.postcode,
      billTo.country,
      billTo.vat ? `VAT No: ${billTo.vat}` : ""
    ];

   const shipToLines = dedupeAddressLines([
  order.retail_name,
  order.delivery_address_1,
  order.delivery_address_2,
  order.delivery_city,
  order.delivery_region,
  order.delivery_postcode,
  order.delivery_country
]);

    drawAddressBlock(doc, "Bill To:", billToLines, 14, 84, 78, 52);
    drawAddressBlock(doc, "Ship To:", shipToLines, 112, 84, 78, 52);
  }

  function drawTableHeader(doc, y) {
    setDark(doc);

    doc.setFillColor(245, 245, 245);
    doc.rect(14, y - 6, 182, 10, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);

    doc.text("SKU", 14, y);
    doc.text("Product Description", 36, y);
    doc.text("Quantity", 103, y);
    doc.text("Warehouse Costs", 124, y);
    doc.text("Transport Costs", 158, y);
    doc.text("Total", 188, y);

    doc.setDrawColor(80, 80, 80);
    doc.line(14, y + 4, 196, y + 4);

    return y + 11;
  }

  function maybeAddNewPage(doc, y, order, ctx, logoDataUrl) {
    if (y <= 258) return y;

    doc.addPage();
    drawHeader(doc, order, ctx, logoDataUrl);
    return drawTableHeader(doc, 76);
  }

  function drawTotalsBlock(doc, y, totals, ctx) {
    const subtotal = round2(totals.warehouse + totals.transport);
    const vatRate = toNumber(ctx.vatRate, DEFAULT_VAT_RATE);
    const vat = round2(subtotal * vatRate);
    const total = round2(subtotal + vat);

    doc.setDrawColor(80, 80, 80);
    doc.line(14, y, 196, y);

    y += 10;

    const labelX = 138;
    const valueX = 184;

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text("Order Total", labelX, y);

    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    doc.text("Warehouse Costs", labelX, y);
    doc.text(formatMoney(totals.warehouse), valueX, y, { align: "right" });

    y += 7;

    doc.text("Transport Costs", labelX, y);
    doc.text(formatMoney(totals.transport), valueX, y, { align: "right" });

    y += 7;

    doc.text("Subtotal", labelX, y);
    doc.text(formatMoney(subtotal), valueX, y, { align: "right" });

    y += 7;

    doc.text(`VAT ${Math.round(vatRate * 100)}%`, labelX, y);
    doc.text(formatMoney(vat), valueX, y, { align: "right" });

    y += 7;

    doc.setFont("helvetica", "bold");
    doc.text("Total", labelX, y);
    doc.text(formatMoney(total), valueX, y, { align: "right" });

    return y + 12;
  }

  function drawMemoAndDamageNote(doc, y, memo) {
    y += 4;

    if (memo) {
      doc.setFillColor(247, 247, 247);
      doc.rect(14, y - 5, 182, 23, "F");

      doc.setDrawColor(210, 210, 210);
      doc.rect(14, y - 5, 182, 23);

      setDark(doc);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Memo", 18, y + 1);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const memoLines = splitText(doc, memo, 170);
      doc.text(memoLines.slice(0, 2), 18, y + 8);

      y += 25;
    }

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.7);
    doc.text(DAMAGE_NOTE, 14, y);

    return y + 8;
  }

  function drawBusinessFooter(doc, company) {
    const pageCount = doc.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);

      doc.setDrawColor(180, 180, 180);
      doc.line(14, 276, 196, 276);

      setMuted(doc);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);

      const footerLine1 = company.footerText || `${company.name}  ${company.address}`;
      const footerLine2 = `Phone ${company.phone}   Email ${company.email}   VAT No ${company.vat}`;

      doc.text(footerLine1, 105, 282, { align: "center" });
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

    drawHeader(doc, order, ctx, logoDataUrl);
    drawBillToAndShipTo(doc, order, ctx);

    let y = 152;
    y = drawTableHeader(doc, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const totals = {
      warehouse: 0,
      transport: 0
    };

    const lines = getOrderLines(order);

    lines.forEach(line => {
      y = maybeAddNewPage(doc, y, order, ctx, logoDataUrl);

      const sku = cleanText(line.sku_base || line.products?.sku_base || "—");
      const description = cleanText(line.description || line.products?.description || line.products?.name || "—");
      const qty = toNumber(line.quantity_ordered, 0);

      const warehouseCost = getLineWarehouseCost(line);
      const transportCost = getLineTransportCost(line);
      const total = getLineTotal(line);

      totals.warehouse += warehouseCost;
      totals.transport += transportCost;

      const descriptionLines = splitText(doc, description, 62);
      const rowHeight = Math.max(8, descriptionLines.length * 4.3);

      setDark(doc);
      doc.text(sku, 14, y);
      doc.text(descriptionLines, 36, y);
      doc.text(String(qty), 103, y);
      doc.text(formatMoney(warehouseCost), 124, y);
      doc.text(formatMoney(transportCost), 158, y);
      doc.text(formatMoney(total), 188, y);

      y += rowHeight;
    });

    y += 8;
    y = maybeAddNewPage(doc, y, order, ctx, logoDataUrl);
    y = drawTotalsBlock(doc, y, totals, ctx);

    const memo = getMemo(order);
    y = maybeAddNewPage(doc, y + 4, order, ctx, logoDataUrl);
    drawMemoAndDamageNote(doc, y, memo);

    drawBusinessFooter(doc, ctx.company);

    return doc.output("blob");
  }

  async function uploadPdf(client, companyId, order, blob) {
    const orderPart = safeFilePart(order.order_number || order.id);
    const fileName = `acknowledgement-${orderPart}.pdf`;
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
      document_number: `ACK-${order.order_number || String(order.id).slice(0, 8)}`,
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

    const ctx = await loadCompanySettings(client, companyId);
    ctx.productOwner = await loadProductOwnerProfile(client, order.customer_id, order);

    const blob = await createPdfBlob(order, ctx);
    const uploaded = await uploadPdf(client, companyId, order, blob);

    await upsertDocumentRecord(client, companyId, order, uploaded);

    await createActivity(
      client,
      companyId,
      order,
      "ACK document generated and uploaded"
    );

    await client
      .from("orders")
      .update({
        last_activity_at: new Date().toISOString()
      })
      .eq("id", order.id);

    return uploaded;
  }

  window.AcknowledgementGenerator = {
    generate
  };
})();