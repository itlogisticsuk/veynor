(function () {
  "use strict";

  const DOCUMENT_BUCKET = "order-documents";

  function sbClient() {
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    return sb();
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
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
    const fallback = {
      name: "Sofa2U Ltd",
      displayName: "Sofa2U",
      address: "860-862 Garratt Lane, London, SW17 0NB",
      phone: "+44 (0) 7894 469947",
      email: "sales@sofa2u.co.uk",
      vat: "GB 368 665 249",
      logoUrl: "",
      footerText: ""
    };

    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId);

    if (error) {
      console.warn("Credit note settings skipped:", error.message);
      return fallback;
    }

    const map = new Map((data || []).map(row => [row.setting_key, row.setting_value ?? ""]));

    return {
      name: map.get("main_company_name") || fallback.name,
      displayName: map.get("main_display_name") || fallback.displayName,
      registration: map.get("main_company_registration") || "",
      address: map.get("main_address") || fallback.address,
      phone: map.get("main_phone") || fallback.phone,
      email: map.get("main_email") || fallback.email,
      vat: map.get("main_vat") || fallback.vat,
      logoUrl: map.get("main_logo_url") || "",
      footerText: map.get("document_footer_text") || ""
    };
  }

  async function loadProductOwner(client, customerId) {
  if (!customerId) return null;

  const { data: customer, error: customerError } = await client
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) throw customerError;

  let address = null;

  const { data: addresses } = await client
    .from("customer_addresses")
    .select("*")
    .eq("customer_id", customerId)
    .order("is_default", { ascending: false })
    .limit(1);

  if (addresses?.length) address = addresses[0];

  return {
    id: customer.id,
    name: customer.name || customer.trading_name || "Product Owner",
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

  async function loadCreditOrder(client, companyId, orderId) {
    const { data, error } = await client
      .from("orders")
      .select(`
        id,
        company_id,
        customer_id,
        order_number,
        order_type,
        external_reference,
        order_date,
        requested_delivery_date,
        retail_name,
        delivery_address_1,
        delivery_address_2,
        delivery_address_3,
        delivery_city,
        delivery_postcode,
        delivery_country,
        memo,
        notes,
        is_credit,
        credit_for_order_id,
        credit_reason,
        credit_created_at,
        customers (
          id,
          name,
          customer_code
        ),
        order_lines (
          id,
          line_number,
          sku_base,
          description,
          quantity_ordered,
          total_customer_charge,
          manual_description,
          manual_amount_gbp,
          is_credit_line,
          notes
        )
      `)
      .eq("id", orderId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Credit order not found.");

    return data;
  }

  async function loadOriginalOrderNumber(client, creditOrder) {
    if (!creditOrder.credit_for_order_id) return "";

    const { data, error } = await client
      .from("orders")
      .select("order_number")
      .eq("id", creditOrder.credit_for_order_id)
      .maybeSingle();

    if (error) {
      console.warn("Original order lookup skipped:", error.message);
      return "";
    }

    return data?.order_number || "";
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
      console.warn("Logo could not be loaded:", error.message);
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
      console.warn("Logo addImage failed:", error.message);
      return false;
    }
  }

  function getRetailerName(order) {
    return clean(order.retail_name || "—");
  }

  function getDeliveryAddress(order) {
    return [
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_address_3,
      order.delivery_city,
      order.delivery_postcode,
      order.delivery_country || "United Kingdom"
    ].filter(Boolean).map(clean).join(", ");
  }

  function getLineAmount(line) {
    return round2(
      toNumber(line.total_customer_charge, 0) ||
      toNumber(line.manual_amount_gbp, 0)
    );
  }

  function getCreditTotal(order) {
    return round2((order.order_lines || []).reduce((sum, line) => {
      return sum + getLineAmount(line);
    }, 0));
  }

  function drawHeader(doc, company, logoDataUrl, creditNo, originalOrderNo) {
    doc.setFillColor(17, 24, 39);
    doc.rect(0, 0, 210, 17, "F");

    doc.setFillColor(184, 148, 95);
    doc.rect(0, 17, 210, 2.2, "F");

    const logoAdded = addLogo(doc, logoDataUrl, 14, 25, 48, 22);

    setDark(doc);

    if (!logoAdded) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.text(company.displayName || company.name, 14, 34);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.text("Credit Note", 196, 34, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Credit Note No: ${creditNo}`, 196, 45, { align: "right" });
    if (originalOrderNo) {
      doc.text(`Credit for Order: ${originalOrderNo}`, 196, 52, { align: "right" });
    }
    doc.text(`Date: ${formatDate(new Date())}`, 196, 59, { align: "right" });

    const infoY = logoAdded ? 53 : 43;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(company.name, 14, infoY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(clean(company.address), 14, infoY + 6);

    doc.setFont("helvetica", "bold");
    doc.text("Phone", 14, infoY + 15);
    doc.setFont("helvetica", "normal");
    doc.text(company.phone || "—", 28, infoY + 15);

    doc.setFont("helvetica", "bold");
    doc.text("Email", 78, infoY + 15);
    doc.setFont("helvetica", "normal");
    doc.text(company.email || "—", 92, infoY + 15);

    doc.setFont("helvetica", "bold");
    doc.text(`VAT No ${company.vat || "—"}`, 14, infoY + 23);
  }

  function drawCreditTo(doc, y, productOwner, order) {
    doc.setFillColor(248, 249, 251);
    doc.roundedRect(14, y - 6, 86, 58, 2, 2, "F");

    doc.setDrawColor(220, 224, 231);
    doc.roundedRect(14, y - 6, 86, 58, 2, 2);

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Credit To", 19, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);

const lines = [
  productOwner?.name,
  productOwner?.address1,
  productOwner?.address2,
  productOwner?.city,
  productOwner?.county,
  productOwner?.postcode,
  productOwner?.country || "United Kingdom",
  productOwner?.vat ? `VAT No: ${productOwner.vat}` : ""
].filter(Boolean);

    let lineY = y + 8;

    lines.forEach(line => {
      if (lineY <= y + 44) {
        doc.text(clean(line), 19, lineY);
        lineY += 5;
      }
    });
  }

  function drawOrderBox(doc, y, order, originalOrderNo) {
    doc.setFillColor(248, 249, 251);
    doc.roundedRect(110, y - 6, 86, 58, 2, 2, "F");

    doc.setDrawColor(220, 224, 231);
    doc.roundedRect(110, y - 6, 86, 58, 2, 2);

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Credit Details", 115, y);

    const rows = [
      ["Credit note", order.order_number],
      ["Original order", originalOrderNo || "—"],
      ["Retailer", getRetailerName(order)],
      ["Postcode", order.delivery_postcode || "—"],
      ["Reason", order.credit_reason || "—"]
    ];

    let rowY = y + 9;

    rows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(label, 115, rowY);

      doc.setFont("helvetica", "normal");
      doc.text(splitText(doc, clean(value), 46).slice(0, 1), 148, rowY);

      rowY += 7;
    });
  }

  function drawLines(doc, y, order) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setDark(doc);
    doc.text("Credit Lines", 14, y);

    y += 8;

    doc.setFillColor(245, 245, 245);
    doc.rect(14, y - 6, 182, 10, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.text("SKU", 16, y);
    doc.text("Description", 42, y);
    doc.text("Qty", 142, y, { align: "right" });
    doc.text("Credit Amount", 194, y, { align: "right" });

    doc.setDrawColor(80, 80, 80);
    doc.line(14, y + 4, 196, y + 4);

    y += 12;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);

    (order.order_lines || []).forEach(line => {
      if (y > 250) {
        doc.addPage();
        y = 28;
      }

      const sku = clean(line.sku_base || "MANUAL");
      const desc = clean(line.manual_description || line.description || line.notes || "Credit line");
      const qty = toNumber(line.quantity_ordered, 0);
      const amount = getLineAmount(line);

      const descLines = splitText(doc, desc, 90);
      const rowHeight = Math.max(8, descLines.length * 4);

      doc.setFont("helvetica", "bold");
      doc.text(sku, 16, y);

      doc.setFont("helvetica", "normal");
      doc.text(descLines, 42, y);
      doc.text(String(qty), 142, y, { align: "right" });
      doc.text(formatMoney(amount), 194, y, { align: "right" });

      y += rowHeight + 2;
    });

    y += 6;
    doc.setDrawColor(80, 80, 80);
    doc.line(130, y, 196, y);

    y += 9;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Total Credit", 142, y);
    doc.text(formatMoney(getCreditTotal(order)), 194, y, { align: "right" });

    return y;
  }

  function drawNotes(doc, y, order) {
    if (y > 230) {
      doc.addPage();
      y = 30;
    }

    y += 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Notes", 14, y);

    y += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);

    const notes = [
      "This credit note confirms the credit value to be included as a negative line on the weekly invoice.",
      order.credit_reason ? `Reason: ${order.credit_reason}` : "",
      order.memo || ""
    ].filter(Boolean).join("\n");

    doc.text(splitText(doc, notes, 180), 14, y);
  }

  function drawFooter(doc, company) {
    const pageCount = doc.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);

      doc.setDrawColor(215, 215, 215);
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

  async function createPdfBlob(order, company, productOwner, originalOrderNo) {
    if (!window.jspdf?.jsPDF) {
      throw new Error("jsPDF is not loaded. Add jsPDF before credit-note-generator.js.");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const logoDataUrl = await urlToDataUrl(company.logoUrl);

    drawHeader(doc, company, logoDataUrl, order.order_number, originalOrderNo);
    drawCreditTo(doc, 92, productOwner, order);
    drawOrderBox(doc, 92, order, originalOrderNo);

    let y = 165;
    y = drawLines(doc, y, order);
    drawNotes(doc, y, order);
    drawFooter(doc, company);

    return doc.output("blob");
  }

  async function uploadPdf(client, companyId, creditNo, blob) {
    const fileName = `${safeFilePart(creditNo)}_credit_note.pdf`;
    const storagePath = `${companyId}/credit-notes/${fileName}`;

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

  async function upsertCreditNoteDocument(client, companyId, order, uploaded) {
    const { data: existing, error: existingError } = await client
      .from("order_documents")
      .select("id")
      .eq("order_id", order.id)
      .eq("document_type", "credit_note")
      .maybeSingle();

    if (existingError) throw existingError;

    const payload = {
      company_id: companyId,
      customer_id: order.customer_id || null,
      order_id: order.id,
      document_type: "credit_note",
      document_number: order.order_number,
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
    return data.id;
  }

  async function insertActivity(client, companyId, order, uploaded) {
    try {
      await client.from("order_activity_log").insert({
        company_id: companyId,
        customer_id: order.customer_id || null,
        order_id: order.id,
        activity_type: "credit_note_generated",
        old_status: null,
        new_status: "generated",
        description: `Credit note ${order.order_number} generated`,
        created_by: "manual",
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.warn("Credit note activity skipped:", error.message);
    }
  }

  async function generate(orderId, clientArg, companyIdArg) {
    const client = clientArg || sbClient();
    const companyId = companyIdArg;

    if (!companyId) throw new Error("Company ID is missing.");
    if (!orderId) throw new Error("Credit order ID is missing.");

    const order = await loadCreditOrder(client, companyId, orderId);

    if (!order.is_credit && order.order_type !== "credit") {
      throw new Error("Selected order is not a credit order.");
    }

    const company = await loadCompanySettings(client, companyId);
    const productOwner = await loadProductOwner(client, order.customer_id);
    const originalOrderNo = await loadOriginalOrderNumber(client, order);

    const blob = await createPdfBlob(order, company, productOwner, originalOrderNo);
    const uploaded = await uploadPdf(client, companyId, order.order_number, blob);

    if (!uploaded.fileUrl || !uploaded.storagePath) {
      throw new Error("Credit note PDF was uploaded, but no file URL/storage path was returned.");
    }

    const documentId = await upsertCreditNoteDocument(client, companyId, order, uploaded);
    await insertActivity(client, companyId, order, uploaded);

    return {
      documentId,
      documentNumber: order.order_number,
      ...uploaded
    };
  }

  window.CreditNoteGenerator = {
    generate
  };
})();