(function () {
  "use strict";

  const POD_BUCKET = "pod-assets";

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

  const DEFAULT_DAMAGE_NOTE =
    "All goods must be checked for damage and reported within 5 days of delivery.";

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatNumber(value, digits = 2) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function safeFilePart(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "file";
  }

  function getImageFormat(dataUrl) {
    const lower = String(dataUrl || "").toLowerCase();
    if (lower.includes("image/jpeg") || lower.includes("image/jpg")) return "JPEG";
    if (lower.includes("image/webp")) return "WEBP";
    return "PNG";
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
      if (!res.ok) throw new Error("Image fetch failed");
      const blob = await res.blob();
      return await blobToDataUrl(blob);
    } catch (error) {
      console.warn("Image skipped:", error.message);
      return "";
    }
  }

  function getOrderNumber(order) {
    return cleanText(order.order_number || order.external_reference || order.id || "—");
  }

  function getProductOwnerName(order) {
    return cleanText(order.customers?.name || order.customer_name || "Product Owner");
  }

  function getRetailerName(order) {
    return cleanText(
      order.retail_name ||
      order.retailer_name ||
      order.delivery_name ||
      order.delivery_company ||
      order.recipient_name ||
      "—"
    );
  }

  function getShipToLines(order) {
    return [
      getRetailerName(order),
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_city,
      order.delivery_region,
      order.delivery_postcode,
      order.delivery_country || "United Kingdom"
    ].filter(Boolean).map(cleanText);
  }

  function getOrderLines(order) {
    return Array.isArray(order.order_lines) ? order.order_lines : [];
  }

  function getLineSku(line) {
    return cleanText(line.sku_base || line.products?.sku_base || "—");
  }

  function getLineDescription(line) {
    return cleanText(line.description || line.products?.description || line.products?.name || "—");
  }

  function getLineQty(line) {
    return toNumber(line.quantity_ordered || line.quantity || 0, 0);
  }

  function getLineVolume(line) {
    const explicit =
      toNumber(line.total_line_volume_m3, 0) ||
      toNumber(line.total_volume_m3, 0) ||
      toNumber(line.volume_m3, 0);

    if (explicit > 0) return explicit;

    const qty = getLineQty(line);
    const unit = toNumber(line.unit_volume_m3, 0) || toNumber(line.products?.volume_m3, 0);
    return qty * unit;
  }

  async function loadCompanySettings(client, companyId) {
    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId);

    if (error) {
      console.warn("Settings skipped:", error.message);
      return {
        company: { ...FALLBACK_COMPANY },
        ownerProfiles: [],
        damageNote: DEFAULT_DAMAGE_NOTE
      };
    }

    const map = new Map((data || []).map(row => [row.setting_key, row.setting_value ?? ""]));

    let ownerProfiles = [];
    try {
      ownerProfiles = JSON.parse(map.get("product_owner_profiles") || "[]");
      if (!Array.isArray(ownerProfiles)) ownerProfiles = [];
    } catch {
      ownerProfiles = [];
    }

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
      ownerProfiles,
      damageNote:
        map.get("text_damage_reporting_note") ||
        map.get("doc_damage_note") ||
        DEFAULT_DAMAGE_NOTE
    };
  }

  async function loadProductOwnerProfile(client, order, ownerProfiles) {
    const fallbackName = getProductOwnerName(order);

    if (!order.customer_id) {
      return {
        name: fallbackName,
        tradingName: fallbackName,
        customerCode: "",
        vat: "",
        address1: "",
        address2: "",
        city: "",
        postcode: "",
        country: "United Kingdom",
        logoUrl: ""
      };
    }

    const { data: customer } = await client
      .from("customers")
      .select("*")
      .eq("id", order.customer_id)
      .maybeSingle();

    const customerName = customer?.name || fallbackName;
    const customerCode = customer?.customer_code || "";

    const profile = (ownerProfiles || []).find(owner => {
      const keys = [
        owner.key,
        owner.name,
        owner.trading_name,
        owner.customer_code,
        owner.default_source_name
      ].map(normalize).filter(Boolean);

      return keys.includes(normalize(customerName)) ||
        keys.includes(normalize(customerCode)) ||
        keys.some(k => normalize(customerName).includes(k) || k.includes(normalize(customerName)));
    }) || null;

    return {
      name: profile?.name || customer?.name || fallbackName,
      tradingName: profile?.trading_name || customer?.trading_name || customerName,
      customerCode: profile?.customer_code || customer?.customer_code || "",
      vat: profile?.vat || customer?.vat_number || customer?.vat || "",
      address1: profile?.address1 || customer?.address1 || customer?.address_1 || "",
      address2: profile?.address2 || customer?.address2 || customer?.address_2 || "",
      city: profile?.city || customer?.city || "",
      postcode: profile?.postcode || customer?.postcode || "",
      country: profile?.country || customer?.country || "United Kingdom",
      logoUrl: profile?.logo_url || ""
    };
  }

  async function loadPodAssets(client, orderId) {
    const { data, error } = await client
      .from("order_pod_assets")
      .select("*")
      .eq("order_id", orderId)
      .order("captured_at", { ascending: true });

    if (error) {
      console.warn("POD assets skipped:", error.message);
      return [];
    }

    return data || [];
  }

  async function loadPodLines(client, order, routeStopId) {
    let query = client
      .from("order_pod_lines")
      .select("*")
      .eq("order_id", order.id);

    if (routeStopId) query = query.eq("route_stop_id", routeStopId);

    const { data, error } = await query;

    if (error || !data || !data.length) {
      return getOrderLines(order).map(line => {
        const qty = getLineQty(line);

        return {
          sku: getLineSku(line),
          description: getLineDescription(line),
          ordered_qty: qty,
          delivered_qty: qty,
          missing_qty: 0,
          line_status: "delivered",
          note: "",
          original_volume_m3: getLineVolume(line)
        };
      });
    }

    return data.map(row => ({
      sku: cleanText(row.sku || "—"),
      description: cleanText(row.description || "—"),
      ordered_qty: toNumber(row.ordered_qty, 0),
      delivered_qty: toNumber(row.delivered_qty, 0),
      missing_qty: toNumber(row.missing_qty, 0),
      line_status: normalize(row.line_status || "delivered"),
      note: cleanText(row.note || ""),
      original_volume_m3: toNumber(row.original_volume_m3, 0)
    }));
  }

  function getPhotoUrls(assets) {
    return (assets || [])
      .filter(asset => normalize(asset.asset_type) === "photo" && asset.file_url)
      .slice(0, 5)
      .map(asset => asset.file_url);
  }

  function getPodAssetUrl(assets, types) {
    const wanted = Array.isArray(types) ? types.map(normalize) : [normalize(types)];

    return (assets || []).find(asset =>
      wanted.includes(normalize(asset.asset_type)) &&
      asset.file_url
    )?.file_url || "";
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
    } catch {
      return false;
    }
  }

  function drawTopBar(doc) {
    doc.setFillColor(17, 24, 39);
    doc.rect(0, 0, 210, 15, "F");
    doc.setFillColor(18, 103, 255);
    doc.rect(0, 15, 210, 2, "F");
  }

  function drawHeader(doc, order, ctx, tenantLogoDataUrl) {
    drawTopBar(doc);

    const logoAdded = addLogo(doc, tenantLogoDataUrl, 14, 23, 42, 18);

    doc.setTextColor(28, 36, 52);

    if (!logoAdded) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text(ctx.company.displayName || ctx.company.name, 14, 33);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.text("Signed Delivery Note", 196, 31, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Final proof of delivery document", 196, 38, { align: "right" });
    doc.text(`Order: ${getOrderNumber(order)}`, 196, 47, { align: "right" });
    doc.text(`Generated: ${formatDateTime(new Date())}`, 196, 54, { align: "right" });

    const infoY = logoAdded ? 47 : 40;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(ctx.company.name, 14, infoY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(cleanText(ctx.company.address), 14, infoY + 5);
    doc.text(`${ctx.company.phone} · ${ctx.company.email}`, 14, infoY + 11);
  }

  function drawAddressBlock(doc, title, lines, x, y, width, height) {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, width, height, 2, 2, "F");
    doc.setDrawColor(220, 226, 235);
    doc.roundedRect(x, y, width, height, 2, 2);

    doc.setTextColor(28, 36, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(title, x + 5, y + 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const text = doc.splitTextToSize(lines.filter(Boolean).map(cleanText).join("\n"), width - 10);
    let lineY = y + 16;

    text.forEach(line => {
      if (lineY < y + height - 4) {
        doc.text(line, x + 5, lineY);
        lineY += 4.4;
      }
    });
  }

  function drawAddresses(doc, order, ctx) {
    const owner = ctx.productOwner;

    drawAddressBlock(doc, "ON BEHALF OF", [
      owner.tradingName || owner.name,
      owner.address1,
      owner.address2,
      owner.city,
      owner.postcode,
      owner.country,
      owner.vat ? `VAT: ${owner.vat}` : ""
    ], 14, 72, 86, 47);

    drawAddressBlock(doc, "SHIP TO", getShipToLines(order), 110, 72, 86, 47);
  }

  function drawTableHeader(doc, y) {
    doc.setFillColor(245, 247, 250);
    doc.rect(14, y - 6, 182, 9, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(28, 36, 52);

    doc.text("Item", 14, y);
    doc.text("Description", 35, y);
    doc.text("Ordered", 136, y, { align: "right" });
    doc.text("Delivered", 158, y, { align: "right" });
    doc.text("Manco", 177, y, { align: "right" });
    doc.text("m³", 196, y, { align: "right" });

    doc.setDrawColor(70, 80, 95);
    doc.line(14, y + 3.5, 196, y + 3.5);

    return y + 8.5;
  }

  function lineHasIssue(line) {
    return (
      ["missing", "partial", "damaged", "refused"].includes(normalize(line.line_status)) ||
      toNumber(line.missing_qty, 0) > 0 ||
      cleanText(line.note)
    );
  }

  function drawLines(doc, order, ctx, tenantLogoDataUrl) {
    let y = drawTableHeader(doc, 134);

    const lines = ctx.podLines || [];

    if (!lines.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("No product lines found.", 14, y);
      return y + 10;
    }

    lines.forEach(line => {
      if (y > 260) {
        doc.addPage();
        drawHeader(doc, order, ctx, tenantLogoDataUrl);
        y = drawTableHeader(doc, 72);
      }

      const ordered = toNumber(line.ordered_qty, 0);
      const delivered = toNumber(line.delivered_qty, 0);
      const missing = Math.max(0, toNumber(line.missing_qty, ordered - delivered));
      const issue = lineHasIssue(line);

      const descLines = doc.splitTextToSize(cleanText(line.description), 94);
      const noteLines = issue && line.note ? doc.splitTextToSize(`Note: ${line.note}`, 150) : [];

      const rowHeight = Math.max(7, descLines.length * 3.6 + noteLines.length * 3.8 + 2);

      if (issue) {
        doc.setFillColor(255, 247, 237);
        doc.rect(14, y - 5, 182, rowHeight + 1.5, "F");
      }

      doc.setTextColor(28, 36, 52);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);

      doc.text(cleanText(line.sku || "—"), 14, y);
      doc.text(descLines, 35, y);
      doc.text(formatNumber(ordered, 0), 136, y, { align: "right" });
      doc.text(formatNumber(delivered, 0), 158, y, { align: "right" });

      if (missing > 0 || issue) {
        doc.setTextColor(185, 28, 28);
        doc.setFont("helvetica", "bold");
        doc.text(formatNumber(missing, 0), 177, y, { align: "right" });

        if (missing >= ordered && ordered > 0) {
          doc.setDrawColor(185, 28, 28);
          doc.line(14, y + 1.3, 196, y + 1.3);
        }
      } else {
        doc.setTextColor(28, 36, 52);
        doc.text("0", 177, y, { align: "right" });
      }

      const originalVolume = toNumber(line.original_volume_m3, 0);
      const deliveredVolume = ordered > 0 ? (originalVolume / ordered) * delivered : originalVolume;

      doc.setTextColor(28, 36, 52);
      doc.setFont("helvetica", "normal");
      doc.text(formatNumber(deliveredVolume, 2), 196, y, { align: "right" });

      if (noteLines.length) {
        doc.setTextColor(185, 28, 28);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.8);
        doc.text(noteLines, 35, y + descLines.length * 3.6 + 2);
      }

      y += rowHeight;
    });

    return y + 5;
  }

  function drawSignature(doc, ctx, y) {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, y, 182, 50, 2, 2, "F");
    doc.setDrawColor(220, 226, 235);
    doc.roundedRect(14, y, 182, 50, 2, 2);

    doc.setTextColor(28, 36, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Proof of Delivery", 19, y + 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Received by:", 19, y + 19);
    doc.text(cleanText(ctx.pod.receivedBy || "—"), 50, y + 19);

    doc.text("Delivered at:", 19, y + 29);
    doc.text(formatDateTime(ctx.pod.deliveredAt || new Date()), 50, y + 29);

    doc.text("Driver:", 19, y + 39);
    doc.text(cleanText(ctx.pod.deliveredVia || "—"), 50, y + 39);

    doc.setFont("helvetica", "bold");
    doc.text("Customer Signature", 122, y + 8);

    if (ctx.signatureDataUrl) {
      try {
        doc.addImage(ctx.signatureDataUrl, getImageFormat(ctx.signatureDataUrl), 122, y + 12, 58, 22);
      } catch {
        doc.setFont("helvetica", "normal");
        doc.text("Signature image unavailable", 122, y + 23);
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.text("No digital signature available", 122, y + 23);
    }

    doc.setDrawColor(90, 100, 115);
    doc.line(122, y + 39, 188, y + 39);

    return y + 60;
  }

  function drawNotes(doc, ctx, y) {
    const notes = cleanText(ctx.pod.notes || "");
    const issueLines = (ctx.podLines || []).filter(lineHasIssue);

    if (!notes && !issueLines.length) return y;

    if (y > 240) {
      doc.addPage();
      drawTopBar(doc);
      y = 30;
    }

    doc.setTextColor(28, 36, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("POD Notes / Exceptions", 14, y);

    y += 6;

    const combined = [
      notes,
      ...issueLines.map(line =>
        `${line.sku}: ${line.note || `${formatNumber(line.missing_qty, 0)} missing / not delivered`}`
      )
    ].filter(Boolean).join("\n");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const wrapped = doc.splitTextToSize(combined, 180);
    doc.text(wrapped.slice(0, 10), 14, y);

    return y + Math.min(wrapped.length, 10) * 4.2 + 6;
  }

  function drawDamageNote(doc, ctx, y) {
    if (y > 260) {
      doc.addPage();
      drawTopBar(doc);
      y = 30;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(28, 36, 52);

    const lines = doc.splitTextToSize(ctx.damageNote || DEFAULT_DAMAGE_NOTE, 180);
    doc.text(lines.slice(0, 2), 14, y);

    return y + 10;
  }

  async function drawPhotoAppendix(doc, photoUrls) {
    if (!photoUrls.length) return;

    doc.addPage();
    drawTopBar(doc);

    doc.setTextColor(28, 36, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Delivery Photos", 14, 31);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(`Photos attached: ${photoUrls.length}`, 14, 39);

    let x = 14;
    let y = 50;
    const w = 86;
    const h = 58;

    for (let i = 0; i < Math.min(photoUrls.length, 5); i++) {
      const dataUrl = await urlToDataUrl(photoUrls[i]);

      doc.setDrawColor(220, 226, 235);
      doc.roundedRect(x, y, w, h, 2, 2);

      if (dataUrl) {
        try {
          doc.addImage(dataUrl, getImageFormat(dataUrl), x + 2, y + 2, w - 4, h - 10);
        } catch {}
      }

      doc.setTextColor(100, 110, 130);
      doc.setFontSize(7);
      doc.text(`Photo ${i + 1}`, x + 3, y + h - 3);

      x += 96;
      if (x > 120) {
        x = 14;
        y += 68;
      }
    }
  }

  function drawFooter(doc, company) {
    const pageCount = doc.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setDrawColor(220, 226, 235);
      doc.line(14, 282, 196, 282);

      doc.setTextColor(100, 110, 130);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);

      doc.text(company.footerText || `${company.name} · ${company.address}`, 105, 287, { align: "center" });
      doc.text(`Phone ${company.phone} · Email ${company.email} · VAT ${company.vat}`, 105, 292, { align: "center" });
    }
  }

  async function createPdfBlob(order, ctx) {
    if (!window.jspdf?.jsPDF) {
      throw new Error("jsPDF is not loaded before pod-generator.js.");
    }

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const tenantLogoDataUrl = await urlToDataUrl(ctx.company.logoUrl);

    drawHeader(doc, order, ctx, tenantLogoDataUrl);
    drawAddresses(doc, order, ctx);

    let y = drawLines(doc, order, ctx, tenantLogoDataUrl);
    if (y > 215) {
      doc.addPage();
      drawHeader(doc, order, ctx, tenantLogoDataUrl);
      y = 72;
    }

    y = drawSignature(doc, ctx, y);
    y = drawNotes(doc, ctx, y);
    drawDamageNote(doc, ctx, y);

    if (ctx.includePhotos) {
      await drawPhotoAppendix(doc, ctx.photoUrls || []);
    }

    drawFooter(doc, ctx.company);

    return doc.output("blob");
  }

  async function uploadPdf(client, companyId, order, blob) {
    const orderPart = safeFilePart(order.order_number || order.id);
    const fileName = `signed-delivery-note-${orderPart}.pdf`;
    const storagePath = `${companyId}/${order.id}/documents/${fileName}`;

    const { error } = await client.storage
      .from(POD_BUCKET)
      .upload(storagePath, blob, {
        contentType: "application/pdf",
        upsert: true
      });

    if (error) throw error;

    const { data } = client.storage.from(POD_BUCKET).getPublicUrl(storagePath);

    return {
      fileName,
      storagePath,
      fileUrl: data?.publicUrl || ""
    };
  }

  async function upsertDocumentRecord(client, companyId, order, uploaded) {
    const { data: existing, error: findError } = await client
      .from("order_documents")
      .select("id")
      .eq("order_id", order.id)
      .eq("document_type", "pod")
      .maybeSingle();

    if (findError) throw findError;

    const payload = {
      company_id: companyId,
      customer_id: order.customer_id || null,
      order_id: order.id,
      document_type: "pod",
      document_number: `SDN-${order.order_number || String(order.id).slice(0, 8)}`,
      document_status: "signed",
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

  async function insertPodAssetRecord(client, companyId, order, routeStopId, uploaded) {
    const { error } = await client
      .from("order_pod_assets")
      .insert({
        company_id: companyId,
        order_id: order.id,
        route_id: order.route_id || null,
        route_stop_id: routeStopId || null,
        asset_type: "signed_delivery_note",
        file_name: uploaded.fileName,
        file_url: uploaded.fileUrl,
        storage_path: uploaded.storagePath,
        mime_type: "application/pdf",
        notes: "Signed Delivery Note PDF generated",
        captured_at: new Date().toISOString()
      });

    if (error) {
      console.warn("Signed delivery note asset insert skipped:", error.message);
    }
  }

  async function createActivity(client, companyId, order) {
    const { error } = await client
      .from("order_activity_log")
      .insert({
        company_id: companyId,
        customer_id: order.customer_id || null,
        order_id: order.id,
        activity_type: "signed_delivery_note_generated",
        old_status: order.pod_status || "not_generated",
        new_status: "signed",
        description: "Signed Delivery Note PDF generated and uploaded",
        created_by: "system"
      });

    if (error) {
      console.warn("POD activity log skipped:", error.message);
    }
  }

  async function generate(order, client, companyId, options = {}) {
    if (!order?.id) throw new Error("Cannot generate Signed Delivery Note: order missing.");
    if (!client) throw new Error("Cannot generate Signed Delivery Note: Supabase client missing.");
    if (!companyId) throw new Error("Cannot generate Signed Delivery Note: companyId missing.");

    const routeStopId = options.routeStopId || options.stopId || null;

    const ctx = await loadCompanySettings(client, companyId);
    ctx.productOwner = await loadProductOwnerProfile(client, order, ctx.ownerProfiles);

    const assets = await loadPodAssets(client, order.id);
    ctx.podLines = await loadPodLines(client, order, routeStopId);

    const signatureUrl =
      options.signatureUrl ||
      getPodAssetUrl(assets, ["signature", "customer_signature"]);

    ctx.signatureDataUrl =
      options.signatureDataUrl ||
      await urlToDataUrl(signatureUrl);

    ctx.photoUrls = (options.photoUrls || getPhotoUrls(assets)).slice(0, 5);
    ctx.includePhotos = options.includePhotos !== false;

    ctx.pod = {
      deliveredVia: options.driverName || order.driver_name || order.routes?.driver_name || "Driver",
      receivedBy: options.receivedBy || order.pod_signed_by || "—",
      deliveredAt: options.deliveredAt || order.pod_signed_at || new Date(),
      notes: options.notes || order.pod_notes || ""
    };

    const blob = await createPdfBlob(order, ctx);
    const uploaded = await uploadPdf(client, companyId, order, blob);

    if (!uploaded.fileUrl) {
      throw new Error("Signed Delivery Note was uploaded, but no public file URL was returned.");
    }

    await upsertDocumentRecord(client, companyId, order, uploaded);
    await insertPodAssetRecord(client, companyId, order, routeStopId, uploaded);
    await createActivity(client, companyId, order);

    const { error: orderError } = await client
      .from("orders")
      .update({
        pod_status: "signed",
        pod_document_url: uploaded.fileUrl,
        last_activity_at: new Date().toISOString()
      })
      .eq("id", order.id);

    if (orderError) throw orderError;

    return uploaded;
  }

  window.PodGenerator = { generate };
})();