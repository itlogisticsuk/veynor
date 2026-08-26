/* Veynor POD Generator - Signed Delivery Note PDF */
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
    "All goods must be checked on delivery. Any damage, shortage or refusal must be recorded on this Signed Delivery Note.";

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB");
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
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "0";

    return n.toLocaleString("en-GB", {
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
      console.warn("[pod-generator] Image skipped:", error.message);
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
      order.customer_name_raw ||
      order.end_customer_name ||
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

  function getLineSku(line) {
    return cleanText(
      line.sku_base ||
      line.product_sku ||
      line.item_code ||
      line.sku ||
      line.products?.sku_base ||
      "—"
    );
  }

  function getLineDescription(line) {
    return cleanText(
      line.description ||
      line.product_name ||
      line.item_name ||
      line.name ||
      line.products?.description ||
      line.products?.name ||
      "—"
    );
  }

  function getLineQty(line) {
    return toNumber(
      line.quantity_ordered ??
      line.quantity ??
      line.qty ??
      line.ordered_qty ??
      0,
      0
    );
  }

  function getLineVolume(line) {
    const explicit =
      toNumber(line.total_line_volume_m3, 0) ||
      toNumber(line.total_volume_m3, 0) ||
      toNumber(line.volume_m3, 0);

    if (explicit > 0) return explicit;

    const qty = getLineQty(line);
    const unit =
      toNumber(line.unit_volume_m3, 0) ||
      toNumber(line.products?.volume_m3, 0);

    return qty * unit;
  }

  function lineHasIssue(line) {
    return (
      ["missing", "partial", "damaged", "refused", "failed"].includes(normalize(line.line_status)) ||
      toNumber(line.missing_qty, 0) > 0 ||
      cleanText(line.note)
    );
  }

  function getIssueLines(lines) {
    return (lines || []).filter(lineHasIssue);
  }

  function getLineStatusLabel(line) {
    const status = normalize(line.line_status || "delivered");
    const missing = toNumber(line.missing_qty, 0);

    if (status === "damaged") return "DAMAGED";
    if (status === "refused") return "REFUSED";
    if (status === "failed") return "FAILED";
    if (status === "missing") return "MISSING";
    if (status === "partial" || missing > 0) return "PARTIAL";
    if (cleanText(line.note)) return "NOTE";
    return "DELIVERED";
  }

  function deriveSeverity(lines, podStatus) {
    const status = normalize(podStatus || "");
    const issueLines = getIssueLines(lines);

    if (status === "damaged" || issueLines.some(l => normalize(l.line_status) === "damaged")) return "damaged";
    if (status === "refused" || issueLines.some(l => normalize(l.line_status) === "refused")) return "refused";
    if (status === "failed" || issueLines.some(l => normalize(l.line_status) === "failed")) return "failed";
    if (
      status === "partial" ||
      issueLines.some(l =>
        ["missing", "partial"].includes(normalize(l.line_status)) ||
        toNumber(l.missing_qty, 0) > 0
      )
    ) return "partial";
    if (issueLines.length) return "exception";
    return "signed";
  }

  function getSeverityTitle(severity) {
    if (severity === "damaged") return "DAMAGED DELIVERY";
    if (severity === "refused") return "REFUSED DELIVERY";
    if (severity === "failed") return "FAILED DELIVERY";
    if (severity === "partial") return "PARTIAL / MANCO DELIVERY";
    if (severity === "exception") return "DELIVERY EXCEPTION";
    return "SIGNED DELIVERY";
  }

  function getFilePrefix(severity) {
    if (severity === "damaged") return "DAMAGED";
    if (severity === "refused") return "REFUSED";
    if (severity === "failed") return "FAILED";
    if (severity === "partial") return "PARTIAL";
    if (severity === "exception") return "EXCEPTION";
    return "SIGNED";
  }

  function derivePodDocumentNumber(order) {
    return `SDN-${getOrderNumber(order)}`;
  }

  async function fetchFullOrder(client, orderId) {
    const { data, error } = await client
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name,
          customer_code
        ),
        routes (
          id,
          route_code,
          route_name,
          name,
          driver_name,
          vehicle_name
        ),
        order_lines (
          id,
          order_id,
          quantity_ordered,
          sku_base,
          description,
          unit_volume_m3,
          total_volume_m3,
          total_line_volume_m3,
          products (
            id,
            sku_base,
            name,
            description,
            volume_m3
          )
        )
      `)
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Order not found for Signed Delivery Note PDF.");

    return data;
  }

  async function loadCompanySettings(client, companyId) {
    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId);

    if (error) {
      console.warn("[pod-generator] Settings skipped:", error.message);
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
        map.get("delivery_disclaimer") ||
        DEFAULT_DAMAGE_NOTE
    };
  }

  function loadProductOwnerProfile(order, ownerProfiles) {
    const fallbackName = getProductOwnerName(order);
    const customerName = order.customers?.name || fallbackName;

    const profile = (ownerProfiles || []).find(owner => {
      const keys = [
        owner.key,
        owner.name,
        owner.trading_name,
        owner.customer_code,
        owner.default_source_name
      ].map(normalize).filter(Boolean);

      return keys.includes(normalize(customerName)) ||
        keys.some(k => normalize(customerName).includes(k) || k.includes(normalize(customerName)));
    }) || null;

    return {
      name: profile?.name || customerName,
      tradingName: profile?.trading_name || profile?.name || customerName,
      customerCode: profile?.customer_code || order.customers?.customer_code || "",
      vat: profile?.vat || "",
      address1: profile?.address1 || profile?.address_1 || "",
      address2: profile?.address2 || profile?.address_2 || "",
      city: profile?.city || "",
      postcode: profile?.postcode || "",
      country: profile?.country || "United Kingdom",
      logoUrl: profile?.logo_url || ""
    };
  }

  async function loadPodAssets(client, orderId, routeStopId = null) {
    let query = client
      .from("order_pod_assets")
      .select("*")
      .eq("order_id", orderId);

    if (routeStopId) {
      query = query.or(`route_stop_id.eq.${routeStopId},route_stop_id.is.null`);
    }

    const { data, error } = await query.order("captured_at", { ascending: true });

    if (error) {
      console.warn("[pod-generator] POD assets skipped:", error.message);
      return [];
    }

    return data || [];
  }

  async function loadPodLines(client, fullOrder, routeStopId) {
    let query = client
      .from("order_pod_lines")
      .select("*")
      .eq("order_id", fullOrder.id);

    if (routeStopId) query = query.eq("route_stop_id", routeStopId);

    const { data, error } = await query.order("created_at", { ascending: true });

    if (!error && data && data.length) {
      return data.map(row => ({
        sku: cleanText(row.sku || "—"),
        description: cleanText(row.description || "—"),
        ordered_qty: toNumber(row.ordered_qty, 0),
        delivered_qty: toNumber(row.delivered_qty, 0),
        missing_qty: Math.max(0, toNumber(row.missing_qty, 0)),
        line_status: normalize(row.line_status || "delivered"),
        note: cleanText(row.note || ""),
        original_volume_m3: toNumber(row.original_volume_m3, 0)
      }));
    }

    if (error) {
      console.warn("[pod-generator] POD lines skipped, falling back to order_lines:", error.message);
    }

    const lines = Array.isArray(fullOrder.order_lines) ? fullOrder.order_lines : [];

    return lines.map(line => {
      const qty = getLineQty(line);
      const vol = getLineVolume(line);

      return {
        sku: getLineSku(line),
        description: getLineDescription(line),
        ordered_qty: qty,
        delivered_qty: qty,
        missing_qty: 0,
        line_status: "delivered",
        note: "",
        original_volume_m3: vol
      };
    });
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
    doc.setFillColor(7, 21, 47);
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
    doc.text(`Date: ${formatDate(ctx.pod.deliveredAt || new Date())}`, 196, 41, { align: "right" });
    doc.text(`Order #: ${getOrderNumber(order)}`, 196, 50, { align: "right" });
    doc.text(`Document #: ${derivePodDocumentNumber(order)}`, 196, 59, { align: "right" });

    const infoY = logoAdded ? 47 : 40;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(ctx.company.name, 14, infoY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(cleanText(ctx.company.address), 14, infoY + 5);
    doc.text(`Phone ${ctx.company.phone}`, 14, infoY + 14);
    doc.text(`Email ${ctx.company.email}`, 83, infoY + 14);
  }

  function drawExceptionBanner(doc, ctx) {
    if (!ctx.hasExceptions) return;

    doc.setFillColor(153, 27, 27);
    doc.roundedRect(14, 63, 182, 13, 2, 2, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`DELIVERY EXCEPTION RECORDED - ${getSeverityTitle(ctx.severity)}`, 105, 68.5, { align: "center" });

    doc.setFontSize(7.5);
    doc.text("See highlighted product line below.", 105, 73, { align: "center" });
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
    const y = ctx.hasExceptions ? 82 : 72;

    drawAddressBlock(doc, "ON BEHALF OF", [
      owner.tradingName || owner.name,
      owner.address1,
      owner.address2,
      owner.city,
      owner.postcode,
      owner.country,
      owner.vat ? `VAT No: ${owner.vat}` : ""
    ], 14, y, 86, 47);

    drawAddressBlock(doc, "SHIP TO", getShipToLines(order), 110, y, 86, 47);

    return y + 52;
  }

  function drawDeliveryMeta(doc, order, ctx, y) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 226, 235);
    doc.roundedRect(14, y, 182, 12, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(28, 36, 52);

    doc.text("Driver", 19, y + 7);
    doc.text("Vehicle", 62, y + 7);
    doc.text("Route", 105, y + 7);
    doc.text("Delivery Status", 144, y + 7);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(cleanText(ctx.pod.deliveredVia || "—").slice(0, 24), 32, y + 7);
    doc.text(cleanText(order.routes?.vehicle_name || order.vehicle_name || "—").slice(0, 24), 78, y + 7);
    doc.text(cleanText(order.routes?.route_code || order.routes?.route_name || order.route_id || "—").slice(0, 24), 118, y + 7);

    const statusText = ctx.hasExceptions
      ? getSeverityTitle(ctx.severity)
      : cleanText(ctx.pod.status || order.pod_status || "—").replaceAll("_", " ");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(ctx.hasExceptions ? 153 : 28, ctx.hasExceptions ? 27 : 36, ctx.hasExceptions ? 27 : 52);
    doc.text(statusText, 193, y + 7, { align: "right" });

    return y + 21;
  }

  function drawTableHeader(doc, y) {
    doc.setFillColor(245, 247, 250);
    doc.rect(14, y - 6, 182, 9, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.7);
    doc.setTextColor(28, 36, 52);

    doc.text("Item", 14, y);
    doc.text("Description", 33, y);
    doc.text("Ordered", 116, y, { align: "right" });
    doc.text("Delivered", 138, y, { align: "right" });
    doc.text("Manco", 158, y, { align: "right" });
    doc.text("Status", 176, y, { align: "center" });
    doc.text("Vol.", 196, y, { align: "right" });

    doc.setDrawColor(70, 80, 95);
    doc.line(14, y + 3.5, 196, y + 3.5);

    return y + 8.5;
  }

  function drawLines(doc, order, ctx, tenantLogoDataUrl, startY) {
    let y = drawTableHeader(doc, startY);
    const lines = ctx.podLines || [];

    if (!lines.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("No product lines found.", 14, y);
      return y + 10;
    }

    lines.forEach(line => {
      if (y > 254) {
        doc.addPage();
        drawHeader(doc, order, ctx, tenantLogoDataUrl);
        y = drawTableHeader(doc, 72);
      }

      const ordered = toNumber(line.ordered_qty, 0);
      const delivered = toNumber(line.delivered_qty, 0);
      const missing = Math.max(0, toNumber(line.missing_qty, ordered - delivered));
      const issue = lineHasIssue(line);
      const statusLabel = getLineStatusLabel(line);

      const descLines = doc.splitTextToSize(cleanText(line.description), 76);
      const noteLines = issue && line.note ? doc.splitTextToSize(`Note: ${line.note}`, 95) : [];
      const rowHeight = Math.max(8, descLines.length * 3.8 + Math.min(noteLines.length, 2) * 3.8 + 4);

      if (issue) {
        doc.setFillColor(254, 242, 242);
        doc.rect(14, y - 5, 182, rowHeight + 1.5, "F");
        doc.setDrawColor(185, 28, 28);
        doc.line(14, y - 5, 196, y - 5);
      }

      doc.setTextColor(issue ? 185 : 28, issue ? 28 : 36, issue ? 28 : 52);
      doc.setFont("helvetica", issue ? "bold" : "normal");
      doc.setFontSize(6.9);
      doc.text(cleanText(line.sku || "—"), 14, y);

      doc.setTextColor(28, 36, 52);
      doc.setFont("helvetica", "normal");
      doc.text(descLines, 33, y);

      doc.text(formatNumber(ordered, 0), 116, y, { align: "right" });
      doc.text(formatNumber(delivered, 0), 138, y, { align: "right" });

      if (missing > 0 || issue) {
        doc.setTextColor(185, 28, 28);
        doc.setFont("helvetica", "bold");
        doc.text(formatNumber(missing, 0), 158, y, { align: "right" });
      } else {
        doc.setTextColor(28, 36, 52);
        doc.setFont("helvetica", "normal");
        doc.text("0", 158, y, { align: "right" });
      }

      if (issue) {
        doc.setFillColor(185, 28, 28);
        doc.roundedRect(162, y - 4.5, 27, 6, 1, 1, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5.8);
        doc.text(statusLabel, 175.5, y - 0.2, { align: "center" });
      } else {
        doc.setTextColor(22, 101, 52);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5.8);
        doc.text("OK", 175.5, y, { align: "center" });
      }

      const originalVolume = toNumber(line.original_volume_m3, 0);
      const deliveredVolume = ordered > 0 ? (originalVolume / ordered) * delivered : originalVolume;

      doc.setTextColor(28, 36, 52);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.9);
      doc.text(formatNumber(deliveredVolume, 2), 196, y, { align: "right" });

      if (noteLines.length) {
        doc.setTextColor(185, 28, 28);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.2);
        doc.text(noteLines.slice(0, 2), 33, y + descLines.length * 3.8 + 3);
      }

      y += rowHeight;
    });

    doc.setDrawColor(70, 80, 95);
    doc.line(14, y + 4, 196, y + 4);

    const totalVolume = lines.reduce((sum, line) => {
      const ordered = toNumber(line.ordered_qty, 0);
      const delivered = toNumber(line.delivered_qty, 0);
      const originalVolume = toNumber(line.original_volume_m3, 0);
      return sum + (ordered > 0 ? (originalVolume / ordered) * delivered : originalVolume);
    }, 0);

    const totalOrdered = lines.reduce((sum, line) => sum + toNumber(line.ordered_qty, 0), 0);
    const totalDelivered = lines.reduce((sum, line) => sum + toNumber(line.delivered_qty, 0), 0);
    const totalMissing = lines.reduce((sum, line) => sum + toNumber(line.missing_qty, 0), 0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(28, 36, 52);
    doc.text(`Totals: Ordered ${formatNumber(totalOrdered, 0)} · Delivered ${formatNumber(totalDelivered, 0)} · Manco ${formatNumber(totalMissing, 0)}`, 14, y + 14);
    doc.text("Total Volume", 150, y + 14, { align: "right" });
    doc.text(formatNumber(totalVolume, 2), 196, y + 14, { align: "right" });

    return y + 24;
  }

  function drawExceptionSummary(doc, ctx, y) {
    if (!ctx.hasExceptions) return y;

    if (y > 238) {
      doc.addPage();
      drawTopBar(doc);
      y = 30;
    }

    const boxHeight = Math.min(30, 14 + ctx.issueLines.length * 6);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 226, 235);
    doc.roundedRect(14, y, 182, boxHeight, 2, 2, "FD");

    doc.setTextColor(28, 36, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.text("Delivery exception summary", 19, y + 8);

    let lineY = y + 16;

    ctx.issueLines.slice(0, 3).forEach(line => {
      const label = getLineStatusLabel(line);
      const note = cleanText(line.note || "");
      const missing = toNumber(line.missing_qty, 0);
      const text = `${line.sku} - ${label}${missing > 0 ? ` - Manco ${formatNumber(missing, 0)}` : ""}${note ? ` - ${note}` : ""}`;
      const wrapped = doc.splitTextToSize(text, 160);

      doc.setTextColor(185, 28, 28);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.text(wrapped.slice(0, 1), 19, lineY);
      lineY += 5.5;
    });

    if (ctx.issueLines.length > 3) {
      doc.text(`+ ${ctx.issueLines.length - 3} more exception line(s)`, 19, lineY);
    }

    return y + boxHeight + 8;
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
    doc.text("Delivered Via:", 19, y + 19);
    doc.text(cleanText(ctx.pod.deliveredVia || "—"), 55, y + 19);

    doc.text("Received By:", 19, y + 29);
    doc.text(cleanText(ctx.pod.receivedBy || "—"), 55, y + 29);

    doc.text("Date:", 19, y + 39);
    doc.text(formatDateTime(ctx.pod.deliveredAt || new Date()), 55, y + 39);

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
    if (!notes) return y;

    if (y > 240) {
      doc.addPage();
      drawTopBar(doc);
      y = 30;
    }

    doc.setTextColor(28, 36, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("POD Notes", 14, y);

    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(28, 36, 52);

    const wrapped = doc.splitTextToSize(notes, 180);
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
    doc.text(lines.slice(0, 3), 14, y);

    return y + 12;
  }

  async function drawPhotoAppendix(doc, photoUrls, ctx) {
    if (!photoUrls.length) return;

    doc.addPage();
    drawTopBar(doc);

    doc.setTextColor(28, 36, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(ctx.hasExceptions ? "Delivery / Damage Photos" : "Delivery Photos", 14, 31);

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
      doc.text(`Phone ${company.phone} · Email ${company.email} · VAT No ${company.vat}`, 105, 292, { align: "center" });
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
    drawExceptionBanner(doc, ctx);

    let y = drawAddresses(doc, order, ctx);
    y = drawDeliveryMeta(doc, order, ctx, y);
    y = drawLines(doc, order, ctx, tenantLogoDataUrl, y);
    y = drawExceptionSummary(doc, ctx, y);

    if (y > 215) {
      doc.addPage();
      drawHeader(doc, order, ctx, tenantLogoDataUrl);
      y = 72;
    }

    y = drawSignature(doc, ctx, y);

    if (!ctx.hasExceptions) {
      y = drawNotes(doc, ctx, y);
    } else if (cleanText(ctx.pod.notes)) {
      y = drawNotes(doc, { ...ctx, pod: { ...ctx.pod, notes: `General POD note: ${ctx.pod.notes}` } }, y);
    }

    drawDamageNote(doc, ctx, y);

    if (ctx.includePhotos) {
      await drawPhotoAppendix(doc, ctx.photoUrls || [], ctx);
    }

    drawFooter(doc, ctx.company);

    return doc.output("blob");
  }

  async function uploadPdf(client, companyId, order, blob, severity) {
    const orderPart = safeFilePart(order.order_number || order.id);
    const prefix = getFilePrefix(severity);
    const fileName = `${prefix.toLowerCase()}-delivery-note-${orderPart}.pdf`;
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

  async function upsertDocumentRecord(client, companyId, order, uploaded, podStatus) {
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
      document_number: derivePodDocumentNumber(order),
      document_status: podStatus === "signed" ? "signed" : podStatus || "generated",
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

  async function insertPodAssetRecord(client, companyId, order, routeStopId, uploaded, severity) {
    const { error } = await client
      .from("order_pod_assets")
      .insert({
        company_id: companyId,
        order_id: order.id,
        route_id: order.route_id || null,
        route_stop_id: routeStopId || null,
        asset_type: severity === "signed" ? "signed_delivery_note" : `${severity}_delivery_note`,
        file_name: uploaded.fileName,
        file_url: uploaded.fileUrl,
        storage_path: uploaded.storagePath,
        mime_type: "application/pdf",
        notes: `${getSeverityTitle(severity)} PDF generated`,
        captured_at: new Date().toISOString()
      });

    if (error) {
      console.warn("[pod-generator] Signed delivery note asset insert skipped:", error.message);
    }
  }

  async function createActivity(client, companyId, order, podStatus, severity) {
    const { error } = await client
      .from("order_activity_log")
      .insert({
        company_id: companyId,
        customer_id: order.customer_id || null,
        order_id: order.id,
        activity_type: severity === "signed" ? "signed_delivery_note_generated" : "delivery_exception_note_generated",
        old_status: order.pod_status || "not_generated",
        new_status: podStatus || "generated",
        description: `${getSeverityTitle(severity)} PDF generated and uploaded`,
        created_by: "system"
      });

    if (error) {
      console.warn("[pod-generator] POD activity log skipped:", error.message);
    }
  }

  function deriveDocumentPodStatus(fullOrder, options) {
    if (options.podStatus) return options.podStatus;

    const existing = normalize(fullOrder.pod_status || "");

    if (["partial", "damaged", "refused", "failed", "delivery_issue"].includes(existing)) {
      return existing;
    }

    const lines = options.podLines || [];
    const hasIssue = lines.some(lineHasIssue);

    return hasIssue ? "partial" : "signed";
  }

  async function generate(order, client, companyId, options = {}) {
    if (!order?.id) throw new Error("Cannot generate Signed Delivery Note: order missing.");
    if (!client) throw new Error("Cannot generate Signed Delivery Note: Supabase client missing.");
    if (!companyId) throw new Error("Cannot generate Signed Delivery Note: companyId missing.");

    const routeStopId = options.routeStopId || options.stopId || null;
    const fullOrder = await fetchFullOrder(client, order.id);

    const ctx = await loadCompanySettings(client, companyId);
    ctx.productOwner = loadProductOwnerProfile(fullOrder, ctx.ownerProfiles);

    const assets = await loadPodAssets(client, fullOrder.id, routeStopId);
    ctx.podLines = await loadPodLines(client, fullOrder, routeStopId);

    const podStatus = deriveDocumentPodStatus(fullOrder, {
      ...options,
      podLines: ctx.podLines
    });

    ctx.severity = deriveSeverity(ctx.podLines, podStatus);
    ctx.issueLines = getIssueLines(ctx.podLines);
    ctx.hasExceptions = ctx.severity !== "signed";

    const signatureUrl =
      options.signatureUrl ||
      getPodAssetUrl(assets, ["signature", "customer_signature"]);

    ctx.signatureDataUrl =
      options.signatureDataUrl ||
      await urlToDataUrl(signatureUrl);

    ctx.photoUrls = (options.photoUrls || getPhotoUrls(assets)).slice(0, 5);
    ctx.includePhotos = options.includePhotos !== false;

    ctx.pod = {
      deliveredVia: options.driverName || fullOrder.driver_name || fullOrder.routes?.driver_name || "Driver",
      receivedBy: options.receivedBy || fullOrder.pod_signed_by || "—",
      deliveredAt: options.deliveredAt || fullOrder.pod_signed_at || new Date(),
      notes: options.notes || "",
      status: podStatus
    };

    const blob = await createPdfBlob(fullOrder, ctx);
    const uploaded = await uploadPdf(client, companyId, fullOrder, blob, ctx.severity);

    if (!uploaded.fileUrl) {
      throw new Error("Signed Delivery Note was uploaded, but no public file URL was returned.");
    }

    await upsertDocumentRecord(client, companyId, fullOrder, uploaded, podStatus);
    await insertPodAssetRecord(client, companyId, fullOrder, routeStopId, uploaded, ctx.severity);
    await createActivity(client, companyId, fullOrder, podStatus, ctx.severity);

    const orderUpdate = {
      pod_document_url: uploaded.fileUrl,
      last_activity_at: new Date().toISOString()
    };

    if (!["partial", "damaged", "refused", "failed", "delivery_issue"].includes(normalize(fullOrder.pod_status))) {
      orderUpdate.pod_status = podStatus;
    }

    const { error: orderError } = await client
      .from("orders")
      .update(orderUpdate)
      .eq("id", fullOrder.id);

    if (orderError) throw orderError;

    return uploaded;
  }

  window.PodGenerator = { generate };
})();