(function () {
  "use strict";

  const BUCKET = "order-documents";
  const DOCUMENT_TYPE = "delivery_labels";

  const LABEL_WIDTH_MM = 150;
  const LABEL_HEIGHT_MM = 110;

  const DEFAULT_CONTACT_EMAIL = "sales@sofa2u.co.uk";
const LABEL_ICON_BASE = "/assets/label-icons/";

const LABEL_ICON_PATHS = {
  email: `${LABEL_ICON_BASE}email.png`,
  weight: `${LABEL_ICON_BASE}weight.png`,
  volume: `${LABEL_ICON_BASE}volume.png`,
  fragile: `${LABEL_ICON_BASE}fragile.png`,
  keepDry: `${LABEL_ICON_BASE}keep-dry.png`
};

  function getClient() {
    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }
    return sb();
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function toNum(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function fmt(value, digits = 2) {
    const num = toNum(value, 0);
    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function safeFilePart(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function getCompanyIdFromPage() {
    return (
      window.VEYNOR_COMPANY_ID ||
      window.currentCompanyId ||
      window.companyId ||
      null
    );
  }

  async function getCompanyId(client) {
    const fromPage = getCompanyIdFromPage();
    if (fromPage) return fromPage;

    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", "Sofa2U")
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Company Sofa2U not found.");

    return data.id;
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
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
      return await blobToDataUrl(await res.blob());
    } catch (error) {
      console.warn("Logo could not be loaded:", error.message);
      return "";
    }
  }

  function imageFormat(dataUrl) {
    const text = String(dataUrl || "").toLowerCase();
    if (text.includes("image/jpeg") || text.includes("image/jpg")) return "JPEG";
    if (text.includes("image/webp")) return "WEBP";
    return "PNG";
  }

  function addImageContain(doc, dataUrl, x, y, maxW, maxH) {
    if (!dataUrl) return false;

    try {
      const props = doc.getImageProperties(dataUrl);
      const ratio = props.width / props.height;

      let w = maxW;
      let h = w / ratio;

      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }

      doc.addImage(
        dataUrl,
        imageFormat(dataUrl),
        x + (maxW - w) / 2,
        y + (maxH - h) / 2,
        w,
        h
      );

      return true;
    } catch (error) {
      console.warn("Logo add failed:", error.message);
      return false;
    }
  }

async function loadSettings(client, companyId, orderCustomerId = null) {
  const { data, error } = await client
    .from("settings")
    .select("setting_key, setting_value")
    .eq("company_id", companyId);

  if (error) {
    console.warn("Settings lookup failed:", error.message);
    return {};
  }

  const map = new Map((data || []).map(r => [r.setting_key, r.setting_value]));

  let ownerLogoUrl = "";

  try {
    const rawProfiles = map.get("product_owner_profiles");
    const profiles = rawProfiles ? JSON.parse(rawProfiles) : [];

    const ownerProfile = Array.isArray(profiles)
      ? profiles.find(p => {
          return String(p.customer_id || p.id || "").toLowerCase() === String(orderCustomerId || "").toLowerCase()
            || String(p.name || "").toLowerCase().includes("bellstone")
            || String(p.trading_name || "").toLowerCase().includes("bellstone");
        })
      : null;

    ownerLogoUrl =
      ownerProfile?.logo_url ||
      ownerProfile?.product_owner_logo_url ||
      ownerProfile?.logoStorageUrl ||
      ownerProfile?.logo_storage_url ||
      "";
  } catch (e) {
    console.warn("Product owner logo lookup skipped:", e.message);
  }

  return {
    sofaLogoUrl:
      map.get("main_logo_url") ||
      map.get("logo_url") ||
      map.get("tenant_logo_url") ||
      "",

    sofaLogoStoragePath:
      map.get("logo_storage_path") ||
      map.get("main_logo_storage_path") ||
      "",

    ownerLogoUrl,

    contactEmail:
      map.get("orders_email") ||
      map.get("main_email") ||
      map.get("company_email") ||
      "sales@sofa2u.co.uk"
  };
}


  async function getPublicUrlFromStoragePath(client, path) {
    if (!path) return "";

    const { data } = client.storage
      .from(BUCKET)
      .getPublicUrl(path);

    return data?.publicUrl || "";
  }

  async function loadOrder(client, companyId, orderId) {
    const { data, error } = await client
      .from("orders")
      .select(`
        id,
        company_id,
        customer_id,
        order_number,
        external_reference,
        purchase_order,
        retail_name,
        delivery_address_1,
        delivery_address_2,
        delivery_address_3,
        delivery_address_4,
        delivery_city,
        delivery_postcode,
        delivery_country,
        total_order_colli,
        planning_colli,
        total_order_volume_m3,
        total_order_weight_kg,
        order_lines (
          id,
          product_id,
          line_number,
          sku_base,
          description,
          quantity_ordered,
          packages_per_unit,
          total_packages,
          unit_volume_m3,
          total_line_volume_m3,
          unit_weight_kg,
          total_line_weight_kg,
          products (
            id,
            sku_base,
            barcode_value,
            qr_value,
            volume_m3,
            weight_kg,
            net_weight_kg,
            package_count,
            packages_per_unit,
            package_1_qty,
            package_1_volume_m3,
            package_1_weight_kg,
            package_2_qty,
            package_2_volume_m3,
            package_2_weight_kg,
            package_3_qty,
            package_3_volume_m3,
            package_3_weight_kg
          )
        )
      `)
      .eq("company_id", companyId)
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Order not found.");

    return data;
  }

async function loadItemsForOrder(client, companyId, orderId) {
  const { data, error } = await client
    .from("items")
    .select(`
      id,
      sku_base,
      sku_unique,
      package_no,
      package_total,
      package_label,
      volume_m3,
      weight_kg,
      status,
      linked_order_id
    `)
    .eq("company_id", companyId)
    .eq("linked_order_id", orderId)
    .order("sku_base", { ascending: true })
    .order("package_no", { ascending: true });

  if (error) {
    console.warn("Items lookup skipped:", error.message);
    return [];
  }

  return data || [];
}

function shipToLines(order) {
  return [
    order.retail_name,
    order.delivery_address_1,
    order.delivery_address_2,
    order.delivery_address_3,
    order.delivery_address_4,
    order.delivery_city,
    order.delivery_postcode,
    order.delivery_country || "United Kingdom"
  ]
    .map(clean)
    .filter(Boolean);
}

function packageInfoFromProduct(line, packageNo) {
  const p = line.products || {};

  const volume =
    toNum(p[`package_${packageNo}_volume_m3`], 0) ||
    toNum(line.unit_volume_m3, 0) ||
    toNum(p.volume_m3, 0);

  const weight =
    toNum(p[`package_${packageNo}_weight_kg`], 0) ||
    toNum(line.unit_weight_kg, 0) ||
    toNum(p.weight_kg, 0) ||
    toNum(p.net_weight_kg, 0);

  return { volume, weight };
}

function getPackageTotalForLine(line) {
  const p = line.products || {};

  return Math.max(
    1,
    Math.round(
      toNum(
        p.package_count ||
          p.packages_per_unit ||
          line.packages_per_unit ||
          line.total_packages ||
          1,
        1
      )
    )
  );
}

function getCalculatedOrderColli(order) {
  return (order.order_lines || []).reduce((sum, line) => {
    const qty = Math.max(1, Math.round(toNum(line.quantity_ordered, 1)));
    const packageTotal = getPackageTotalForLine(line);

    return sum + qty * packageTotal;
  }, 0);
}

function buildLabels(order, items) {
  const labels = [];

  const calculatedTotalColli = getCalculatedOrderColli(order);

  const totalColli =
    calculatedTotalColli ||
    Math.round(toNum(order.total_order_colli, 0)) ||
    Math.round(toNum(order.planning_colli, 0)) ||
    0;

  const itemMap = new Map();

  (items || []).forEach(item => {
    const key = `${clean(item.sku_base).toUpperCase()}|${item.package_no || ""}`;

    if (!itemMap.has(key)) {
      itemMap.set(key, []);
    }

    itemMap.get(key).push(item);
  });

  (order.order_lines || []).forEach(line => {
    const qty = Math.max(1, Math.round(toNum(line.quantity_ordered, 1)));
    const packageTotal = getPackageTotalForLine(line);

    for (let unit = 1; unit <= qty; unit++) {
      for (let packageNo = 1; packageNo <= packageTotal; packageNo++) {
        const itemKey = `${clean(line.sku_base).toUpperCase()}|${packageNo}`;
        const item = (itemMap.get(itemKey) || []).shift() || null;
        const productSpecs = packageInfoFromProduct(line, packageNo);

        labels.push({
          order,
          line,
          item,
          sku: clean(line.sku_base),
          description: clean(line.description),
          packageNo,
          packageTotal,
          packageLabel: `${packageNo}/${packageTotal}`,
          totalColli,
          barcodeValue:
            item?.sku_unique ||
            line.products?.barcode_value ||
            line.products?.qr_value ||
            clean(line.sku_base),
          volume:
            toNum(item?.volume_m3, 0) ||
            productSpecs.volume,
          weight:
            toNum(item?.weight_kg, 0) ||
            productSpecs.weight
        });
      }
    }
  });

  return labels;
}
  function setBlack(doc) {
    doc.setTextColor(0, 0, 0);
  }

  function setNavy(doc) {
    doc.setTextColor(5, 20, 48);
  }

  function fillNavy(doc) {
    doc.setFillColor(5, 20, 48);
  }

  function line(doc, x1, y1, x2, y2) {
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(0.25);
    doc.line(x1, y1, x2, y2);
  }

  function roundedBox(doc, x, y, w, h, r = 2) {
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, w, h, r, r);
  }

  function titleBar(doc, text, x, y, w, h, size = 7) {
    fillNavy(doc);
    doc.roundedRect(x, y, w, h, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.text(text, x + w / 2, y + h - 1.6, { align: "center" });
    setBlack(doc);
  }

function labelText(doc, text, x, y, size = 5, opts = {}) {
    setNavy(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.text(String(text || ""), x, y, opts);
    setBlack(doc);
  }

  function valueText(doc, text, x, y, size = 8, opts = {}) {
    setBlack(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.text(String(text || ""), x, y, opts);
  }

  function normalText(doc, text, x, y, size = 5.5, opts = {}) {
    setBlack(doc);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.text(String(text || ""), x, y, opts);
  }

  function drawBarcode(doc, x, y, w, h, value) {
    const str = String(value || "SOFA2U");
    let cursor = x;

    for (let i = 0; i < str.length * 5 && cursor < x + w; i++) {
      const code = str.charCodeAt(i % str.length);
      const barW = (code + i) % 3 === 0 ? 0.9 : (code + i) % 2 === 0 ? 0.55 : 0.3;

      if ((code + i) % 4 !== 0) {
        doc.setFillColor(0, 0, 0);
        doc.rect(cursor, y, barW, h, "F");
      }

      cursor += barW + 0.32;
    }
  }

function drawLabel(doc, label, settings, logos, icons) {
    const order = label.order;
    const so = clean(order.order_number || "—");
    const ack = clean(order.external_reference || "—");
    const po = clean(order.purchase_order || "Unknown");
    const ship = shipToLines(order);

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, LABEL_WIDTH_MM, LABEL_HEIGHT_MM, "F");

    roundedBox(doc, 1.5, 1.5, 147, 107, 3);

    line(doc, 1.5, 28, 148.5, 28);
    line(doc, 1.5, 73, 148.5, 73);
    line(doc, 1.5, 91, 148.5, 91);

    line(doc, 57, 28, 57, 73);
    line(doc, 99, 28, 99, 73);
    line(doc, 105, 1.5, 105, 28);

    addImageContain(doc, logos.sofa, 5, 4, 22, 20);
    addImageContain(doc, logos.owner, 30, 4, 20, 20);

    titleBar(doc, "SALES ORDER", 58, 4, 40, 6.2, 7.2);
    valueText(doc, so, 56, 22, 20);

    titleBar(doc, "PACKAGE", 111, 4, 34, 6.2, 7.2);
    valueText(doc, label.packageLabel, 114, 20, 20);
    valueText(doc, `OF ${label.packageTotal}`, 121, 25.5, 6.5);

    titleBar(doc, "SHIP TO", 4, 31, 22, 5.8, 6.2);

let y = 42;
ship.slice(0, 7).forEach((text, index) => {
  const maxWidth = 50;
  const size = index === 0 ? 7.2 : 7.6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);

  const lines = doc.splitTextToSize(text, maxWidth);
  lines.slice(0, 2).forEach(line => {
    if (y < 70) {
      doc.text(line, 4, y);
      y += 5.4;
    }
  });
});

    line(doc, 57, 41, 99, 41);
    line(doc, 57, 55, 99, 55);

labelText(doc, "ACK / SUPPLIER REF", 78, 35, 5.2, { align: "center" });
valueText(doc, ack, 78, 40, 8.8, { align: "center" });

labelText(doc, "PURCHASE ORDER", 78, 49, 5.2, { align: "center" });
valueText(doc, po, 78, 54, 8.2, { align: "center" });

labelText(doc, "TOTAL COLLI", 78, 62.5, 5.2, { align: "center" });
labelText(doc, "IN THIS ORDER", 78, 66.5, 5.2, { align: "center" });
valueText(doc, `${label.totalColli || label.packageTotal} COLLI`, 78, 72, 9.5, { align: "center" });

    titleBar(doc, "SCAN FOR DETAILS", 103, 31, 42, 5.8, 6.2);
    drawBarcode(doc, 106, 38, 36, 11, label.barcodeValue);
    valueText(doc, label.sku || "—", 124, 53, 6.2, { align: "center" });

    doc.setLineDashPattern([1, 1], 0);
    line(doc, 102, 56, 146, 56);
    doc.setLineDashPattern([], 0);

    labelText(doc, "SKU", 104, 63, 6);
    valueText(doc, label.sku || "—", 104, 71, 12);

    roundedBox(doc, 4, 75, 142, 13.5, 1.5);

    const cols = [
      ["WEIGHT", label.weight ? `${fmt(label.weight, 1)} kg` : "—"],
      ["VOLUME", label.volume ? `${fmt(label.volume, 2)} m³` : "—"]
    ];

    labelText(doc, "PACKAGE DETAILS", 8, 81, 5.4);
    valueText(doc, label.packageLabel, 8, 87, 8);

    labelText(doc, "SKU", 38, 81, 5.4);
    valueText(doc, label.sku || "—", 38, 87, 8);

addImageContain(doc, icons.weight, 78, 82, 5, 5);
labelText(doc, "WEIGHT", 87, 81, 5.4);
valueText(doc, cols[0][1], 87, 87, 7);

addImageContain(doc, icons.volume, 114, 82, 5, 5);
labelText(doc, "VOLUME", 123, 81, 5.4);
valueText(doc, cols[1][1], 123, 87, 7);

addImageContain(doc, icons.email, 15, 98.8, 5, 5);
labelText(doc, "QUESTIONS ABOUT THIS DELIVERY?", 22, 98, 5.2);
normalText(doc, `Email: ${settings.contactEmail || DEFAULT_CONTACT_EMAIL}`, 22, 103.5, 5.5);

    line(doc, 75, 94, 75, 106);
    line(doc, 112, 94, 112, 106);

addImageContain(doc, icons.fragile, 79, 97, 6, 6);
valueText(doc, "FRAGILE", 86, 99, 6);
normalText(doc, "HANDLE WITH CARE", 86, 104, 4.8);

addImageContain(doc, icons.keepDry, 116, 97, 6, 6);
valueText(doc, "KEEP DRY", 123, 99, 6);
normalText(doc, "PROTECT FROM MOISTURE", 123, 104, 4.8);
  }

  async function createPdf(order, items, settings) {
    if (!window.jspdf?.jsPDF) {
      throw new Error("jsPDF is not loaded.");
    }

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [LABEL_WIDTH_MM, LABEL_HEIGHT_MM]
    });

    let sofaLogoUrl = settings.sofaLogoUrl || "";
    if (!sofaLogoUrl && settings.sofaLogoStoragePath) {
      sofaLogoUrl = await getPublicUrlFromStoragePath(getClient(), settings.sofaLogoStoragePath);
    }

const logos = {
  sofa: await urlToDataUrl(sofaLogoUrl),
  owner: await urlToDataUrl(settings.ownerLogoUrl || "")
};

const icons = {
  email: await urlToDataUrl(LABEL_ICON_PATHS.email),
  weight: await urlToDataUrl(LABEL_ICON_PATHS.weight),
  volume: await urlToDataUrl(LABEL_ICON_PATHS.volume),
  fragile: await urlToDataUrl(LABEL_ICON_PATHS.fragile),
  keepDry: await urlToDataUrl(LABEL_ICON_PATHS.keepDry)
};

const labels = buildLabels(order, items);

if (!labels.length) {
  throw new Error("No labels could be created for this order.");
}

labels.forEach((label, index) => {
  if (index > 0) {
    doc.addPage([LABEL_WIDTH_MM, LABEL_HEIGHT_MM], "landscape");
  }

  drawLabel(doc, label, settings, logos, icons);
});

console.log("Delivery labels generated:", labels.length, "pages");

return doc.output("blob");
}

  async function uploadPdf(client, companyId, order, blob) {
    const fileName = `${safeFilePart(order.order_number)}-delivery-labels.pdf`;
    const storagePath = `${companyId}/${order.id}/${fileName}`;

    const { error } = await client.storage
      .from(BUCKET)
      .upload(storagePath, blob, {
        contentType: "application/pdf",
        upsert: true
      });

    if (error) throw error;

    const { data } = client.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    return {
      storagePath,
      fileUrl: data?.publicUrl || ""
    };
  }

  async function upsertDocumentRecord(client, companyId, order, uploaded) {
    const { data: existing, error: existingError } = await client
      .from("order_documents")
      .select("id")
      .eq("order_id", order.id)
      .eq("document_type", DOCUMENT_TYPE)
      .maybeSingle();

    if (existingError) throw existingError;

    const payload = {
      company_id: companyId,
      customer_id: order.customer_id || null,
      order_id: order.id,
      document_type: DOCUMENT_TYPE,
      document_number: order.order_number,
      document_status: "generated",
      file_url: uploaded.fileUrl,
      storage_path: uploaded.storagePath,
      customer_visible: false,
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

  async function generate(orderId) {
    const client = getClient();
    const companyId = await getCompanyId(client);

    const order = await loadOrder(client, companyId, orderId);
    const items = await loadItemsForOrder(client, companyId, orderId);
    const settings = await loadSettings(client, companyId, order.customer_id);

    const blob = await createPdf(order, items, settings);
    const uploaded = await uploadPdf(client, companyId, order, blob);
    const documentId = await upsertDocumentRecord(client, companyId, order, uploaded);

    return {
      documentId,
      fileUrl: uploaded.fileUrl,
      storagePath: uploaded.storagePath
    };
  }

  window.DeliveryLabelGenerator = {
    generate
  };
})();