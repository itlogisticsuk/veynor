(function () {
  "use strict";

  const DOCUMENT_BUCKET = "order-documents";

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
    "Received in good condition. Claims for damages must be reported within 48 hours.";

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function isCollectionOrder(order) {
    return normalize(order?.movement_type) === "collection";
  }

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB");
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
      .replace(/^_+|_+$/g, "");
  }

  function splitText(doc, text, width) {
    return doc.splitTextToSize(String(text || ""), width);
  }

  function setDark(doc) {
    doc.setTextColor(28, 36, 52);
  }

  function setMuted(doc) {
    doc.setTextColor(100, 110, 130);
  }

  function getOrderNumber(order) {
    return cleanText(
      order.order_number ||
      order.external_reference ||
      order.id ||
      "—"
    );
  }

  function getPurchaseOrder(order) {
    return cleanText(
      order.purchase_order ||
      order.po_number ||
      "—"
    );
  }

  function getSupplierReference(order) {
    const so = cleanText(order?.order_number || "");
    const ref = cleanText(order?.external_reference || "");

    if (!ref || ref === so) return "";
    return ref;
  }

  function getProductOwnerName(order) {
    return cleanText(
      order.customers?.name ||
      order.product_owner_name ||
      order.customer_name ||
      "Product Owner"
    );
  }

  function getRetailerName(order) {
    return cleanText(
      order.retail_name ||
      order.retailer_name ||
      order.delivery_name ||
      "—"
    );
  }

  function uniqueLines(lines) {
    const seen = new Set();
    const out = [];

    (lines || []).forEach(line => {
      const clean = cleanText(line);
      if (!clean) return;

      const key = normalize(clean);
      if (seen.has(key)) return;

      seen.add(key);
      out.push(clean);
    });

    return out;
  }

  function getShipToLines(order) {
    return uniqueLines([
      getRetailerName(order),
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_address_3,
      order.delivery_address_4,
      order.delivery_city,
      order.delivery_postcode,
      order.delivery_country || "United Kingdom",
      order.delivery_email || order.email || "",
      order.delivery_phone || order.phone || ""
    ]);
  }

  function getOrderLines(order) {
    return Array.isArray(order?.order_lines)
      ? order.order_lines
      : [];
  }

  function getLineSku(line) {
    return cleanText(
      line.sku_base ||
      line.products?.sku_base ||
      "—"
    );
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
    return toNumber(
      line.quantity_ordered ||
      line.quantity ||
      line.delivered_quantity ||
      0,
      0
    );
  }

  function getPhysicalQuantity(line) {
    const quantity = Math.max(
      0,
      Math.round(
        getLineQty(line)
      )
    );

    if (
      getLineSku(line).toUpperCase() ===
      "ALBCH"
    ) {
      return Math.ceil(
        quantity / 2
      );
    }

    return quantity;
  }

  function isServiceLine(line) {
    return (
      toNumber(line?.requested_package_no, 0) > 0 &&
      toNumber(line?.requested_package_total, 0) > 0
    );
  }

  function isServiceOrder(order) {
    return getOrderLines(order).some(isServiceLine);
  }

  function getServiceWarning(line, order) {
    if (!isServiceLine(line)) {
      return "";
    }

    const packageNo = Math.round(
      toNumber(line.requested_package_no, 0)
    );

    const packageTotal = Math.round(
      toNumber(line.requested_package_total, 0)
    );

    const packageLabel =
      cleanText(line.requested_package_label) ||
      `${packageNo}/${packageTotal}`;

    if (isCollectionOrder(order)) {
      return (
        `SERVICE / PARTIAL COLLECTION: ` +
        `Only package ${packageLabel} must be collected. ` +
        `Remaining packages are not part of this collection.`
      );
    }

    return (
      `SERVICE / PARTIAL DELIVERY: ` +
      `Only package ${packageLabel} must be delivered. ` +
      `Remaining packages are not part of this delivery.`
    );
  }

  function getProductPackageCount(product) {
    const packageCount =
      toNumber(
        product?.package_count,
        0
      );

    if (packageCount > 0) {
      return Math.max(
        1,
        Math.round(packageCount)
      );
    }

    const packagesPerUnit =
      toNumber(
        product?.packages_per_unit,
        0
      );

    if (packagesPerUnit > 0) {
      return Math.max(
        1,
        Math.round(packagesPerUnit)
      );
    }

    const flags = [
      toNumber(product?.package_1_qty, 0),
      toNumber(product?.package_2_qty, 0),
      toNumber(product?.package_3_qty, 0),
      toNumber(product?.package1_qty, 0),
      toNumber(product?.package2_qty, 0),
      toNumber(product?.package3_qty, 0)
    ];

    const count =
      flags.filter(v => v > 0).length;

    return Math.max(
      1,
      count || 1
    );
  }

  function getLinePackagesPerProduct(line) {
    return getProductPackageCount(
      line.products || {}
    );
  }

  function getLinePackageCount(line) {
    const qty = Math.max(
      0,
      Math.round(
        getLineQty(line)
      )
    );

    if (
      toNumber(
        line.requested_package_no,
        0
      ) > 0 &&
      toNumber(
        line.requested_package_total,
        0
      ) > 0
    ) {
      return qty;
    }

    const physicalQuantity =
      getPhysicalQuantity(line);

    const packagesPerProduct =
      getLinePackagesPerProduct(line);

    return (
      physicalQuantity *
      packagesPerProduct
    );
  }

  function getSingleProductPackageLabels(line) {
    const packagesPerProduct =
      getLinePackagesPerProduct(line);

    return Array.from(
      { length: packagesPerProduct },
      (_, index) =>
        `${index + 1}/${packagesPerProduct}`
    );
  }

  function getPackageLabel(line) {
    const orderedQty = Math.max(
      1,
      Math.round(
        getLineQty(line) || 1
      )
    );

    const qty =
      getLineSku(line).toUpperCase() ===
      "ALBCH"
        ? Math.ceil(
            orderedQty / 2
          )
        : orderedQty;

    if (
      toNumber(
        line.requested_package_no,
        0
      ) > 0 &&
      toNumber(
        line.requested_package_total,
        0
      ) > 0
    ) {
      const label =
        line.requested_package_label ||
        `${line.requested_package_no}/${line.requested_package_total}`;

      return qty <= 1
        ? label
        : `${label} × ${qty}`;
    }

    const labels =
      getSingleProductPackageLabels(line);

    if (qty <= 1) {
      return labels.join(" & ");
    }

    return `${labels.join(" & ")} × ${qty}`;
  }

  function getRequestedPackageNo(line) {
    return Math.max(
      1,
      Math.round(
        toNumber(
          line.requested_package_no,
          1
        )
      )
    );
  }

  function getPackageVolume(product, packageNo) {
    if (packageNo === 1) {
      return toNumber(
        product?.package_1_volume_m3,
        0
      );
    }

    if (packageNo === 2) {
      return toNumber(
        product?.package_2_volume_m3,
        0
      );
    }

    if (packageNo === 3) {
      return toNumber(
        product?.package_3_volume_m3,
        0
      );
    }

    return 0;
  }

  function getPackageWeight(product, packageNo) {
    if (packageNo === 1) {
      return toNumber(
        product?.package_1_weight_kg,
        0
      );
    }

    if (packageNo === 2) {
      return toNumber(
        product?.package_2_weight_kg,
        0
      );
    }

    if (packageNo === 3) {
      return toNumber(
        product?.package_3_weight_kg,
        0
      );
    }

    return 0;
  }

  function getLineVolume(line) {
    const qty =
      getLineQty(line);

    if (
      toNumber(
        line.requested_package_no,
        0
      ) > 0 &&
      toNumber(
        line.requested_package_total,
        0
      ) > 0
    ) {
      const packageNo =
        getRequestedPackageNo(line);

      const packageVolume =
        getPackageVolume(
          line.products,
          packageNo
        );

      if (packageVolume > 0) {
        return round2(
          packageVolume *
          qty
        );
      }
    }

    const explicit =
      toNumber(
        line.total_line_volume_m3,
        0
      ) ||
      toNumber(
        line.total_volume_m3,
        0
      );

    if (explicit > 0) {
      return explicit;
    }

    const unit =
      toNumber(
        line.unit_volume_m3,
        0
      ) ||
      toNumber(
        line.products?.volume_m3,
        0
      );

    return round2(
      qty *
      unit
    );
  }

  function getLineWeight(line) {
    const qty =
      getLineQty(line);

    if (
      toNumber(
        line.requested_package_no,
        0
      ) > 0 &&
      toNumber(
        line.requested_package_total,
        0
      ) > 0
    ) {
      const packageNo =
        getRequestedPackageNo(line);

      const packageWeight =
        getPackageWeight(
          line.products,
          packageNo
        );

      if (packageWeight > 0) {
        return round2(
          packageWeight *
          qty
        );
      }
    }

    const fullWeight =
      toNumber(
        line.products?.weight_kg,
        0
      ) ||
      toNumber(
        line.products?.net_weight_kg,
        0
      );

    return round2(
      qty *
      fullWeight
    );
  }

  function getTotalProducts(order) {
    return getOrderLines(order).reduce(
      (sum, line) =>
        sum +
        getLineQty(line),
      0
    );
  }

  function getTotalPackages(order) {
    return getOrderLines(order).reduce(
      (sum, line) =>
        sum +
        getLinePackageCount(line),
      0
    );
  }

  function getTotalVolume(order) {
    const lines =
      getOrderLines(order);

    if (
      lines.some(isServiceLine)
    ) {
      return round2(
        lines.reduce(
          (sum, line) =>
            sum +
            getLineVolume(line),
          0
        )
      );
    }

    const explicit =
      toNumber(
        order.total_order_volume_m3,
        0
      ) ||
      toNumber(
        order.planning_volume_m3,
        0
      ) ||
      toNumber(
        order.volume_m3,
        0
      );

    if (explicit > 0) {
      return explicit;
    }

    return round2(
      lines.reduce(
        (sum, line) =>
          sum +
          getLineVolume(line),
        0
      )
    );
  }

  function getTotalWeight(order) {
    const lines =
      getOrderLines(order);

    if (
      lines.some(isServiceLine)
    ) {
      return round2(
        lines.reduce(
          (sum, line) =>
            sum +
            getLineWeight(line),
          0
        )
      );
    }

    const explicit =
      toNumber(
        order.total_order_weight_kg,
        0
      ) ||
      toNumber(
        order.planning_weight_kg,
        0
      ) ||
      toNumber(
        order.weight_kg,
        0
      );

    if (explicit > 0) {
      return explicit;
    }

    return round2(
      lines.reduce(
        (sum, line) =>
          sum +
          getLineWeight(line),
        0
      )
    );
  }

  function blobToDataUrl(blob) {
    return new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload = () => {
          resolve(
            String(
              reader.result ||
              ""
            )
          );
        };

        reader.onerror =
          reject;

        reader.readAsDataURL(
          blob
        );
      }
    );
  }

  async function urlToDataUrl(url) {
    if (!url) {
      return "";
    }

    try {
      const response =
        await fetch(
          url,
          {
            mode: "cors"
          }
        );

      if (!response.ok) {
        throw new Error(
          `Image fetch failed: ${response.status}`
        );
      }

      const blob =
        await response.blob();

      return await blobToDataUrl(
        blob
      );
    } catch (error) {
      console.warn(
        "Image could not be loaded for delivery note:",
        error.message
      );

      return "";
    }
  }

  function getImageFormat(dataUrl) {
    const lower =
      String(
        dataUrl ||
        ""
      ).toLowerCase();

    if (
      lower.includes("image/jpeg") ||
      lower.includes("image/jpg")
    ) {
      return "JPEG";
    }

    if (
      lower.includes("image/webp")
    ) {
      return "WEBP";
    }

    return "PNG";
  }

  function addLogo(
    doc,
    logoDataUrl,
    x,
    y,
    maxW,
    maxH
  ) {
    if (!logoDataUrl) {
      return false;
    }

    try {
      const props =
        doc.getImageProperties(
          logoDataUrl
        );

      const ratio =
        props.width /
        props.height;

      let w =
        maxW;

      let h =
        w /
        ratio;

      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }

      doc.addImage(
        logoDataUrl,
        getImageFormat(
          logoDataUrl
        ),
        x,
        y,
        w,
        h
      );

      return true;
    } catch (error) {
      console.warn(
        "Delivery note logo addImage failed:",
        error.message
      );

      return false;
    }
  }

  function addWatermark(
    doc,
    watermarkDataUrl
  ) {
    if (!watermarkDataUrl) {
      return;
    }

    try {
      const props =
        doc.getImageProperties(
          watermarkDataUrl
        );

      const ratio =
        props.width /
        props.height;

      let w = 105;
      let h =
        w /
        ratio;

      if (h > 85) {
        h = 85;
        w = h * ratio;
      }

      const x =
        (210 - w) / 2;

      const y =
        142;

      if (
        doc.setGState &&
        doc.GState
      ) {
        const gState =
          new doc.GState({
            opacity: 0.15
          });

        doc.setGState(
          gState
        );

        doc.addImage(
          watermarkDataUrl,
          getImageFormat(
            watermarkDataUrl
          ),
          x,
          y,
          w,
          h
        );

        doc.setGState(
          new doc.GState({
            opacity: 1
          })
        );
      } else {
        doc.addImage(
          watermarkDataUrl,
          getImageFormat(
            watermarkDataUrl
          ),
          x,
          y,
          w,
          h
        );
      }
    } catch (error) {
      console.warn(
        "Delivery note watermark failed:",
        error.message
      );
    }
  }

  async function loadCompanySettings(
    client,
    companyId
  ) {
    const {
      data,
      error
    } =
      await client
        .from("settings")
        .select(
          "setting_key, setting_value"
        )
        .eq(
          "company_id",
          companyId
        );

    if (error) {
      console.warn(
        "Delivery note settings skipped:",
        error.message
      );

      return {
        company: {
          ...FALLBACK_COMPANY
        },
        ownerProfiles: [],
        damageNote:
          DEFAULT_DAMAGE_NOTE
      };
    }

    const map =
      new Map(
        (data || []).map(
          row => [
            row.setting_key,
            row.setting_value ??
            ""
          ]
        )
      );

    let ownerProfiles = [];

    try {
      ownerProfiles =
        JSON.parse(
          map.get(
            "product_owner_profiles"
          ) ||
          "[]"
        );

      if (
        !Array.isArray(
          ownerProfiles
        )
      ) {
        ownerProfiles = [];
      }
    } catch {
      ownerProfiles = [];
    }

    return {
      company: {
        name:
          map.get(
            "main_company_name"
          ) ||
          FALLBACK_COMPANY.name,

        displayName:
          map.get(
            "main_display_name"
          ) ||
          FALLBACK_COMPANY.displayName,

        address:
          map.get(
            "main_address"
          ) ||
          FALLBACK_COMPANY.address,

        phone:
          map.get(
            "main_phone"
          ) ||
          FALLBACK_COMPANY.phone,

        email:
          map.get(
            "main_email"
          ) ||
          FALLBACK_COMPANY.email,

        vat:
          map.get(
            "main_vat"
          ) ||
          FALLBACK_COMPANY.vat,

        logoUrl:
          map.get(
            "main_logo_url"
          ) ||
          FALLBACK_COMPANY.logoUrl,

        footerText:
          map.get(
            "document_footer_text"
          ) ||
          FALLBACK_COMPANY.footerText
      },

      ownerProfiles,

      damageNote:
        map.get(
          "text_damage_reporting_note"
        ) ||
        map.get(
          "doc_damage_note"
        ) ||
        DEFAULT_DAMAGE_NOTE
    };
  }

  async function loadProductOwnerProfile(
    client,
    order,
    ownerProfiles
  ) {
    if (
      !order.customer_id
    ) {
      throw new Error(
        "Cannot generate delivery note: order has no product owner/customer_id."
      );
    }

    const {
      data: customer,
      error: customerError
    } =
      await client
        .from("customers")
        .select("*")
        .eq(
          "id",
          order.customer_id
        )
        .maybeSingle();

    if (customerError) {
      throw customerError;
    }

    if (!customer?.id) {
      throw new Error(
        "Cannot generate delivery note: product owner/customer not found."
      );
    }

    const customerName =
      customer.name ||
      getProductOwnerName(
        order
      );

    const customerCode =
      customer.customer_code ||
      "";

    const profile =
      (
        ownerProfiles ||
        []
      ).find(
        owner => {
          const keys = [
            owner.key,
            owner.name,
            owner.trading_name,
            owner.customer_code,
            owner.default_source_name
          ]
            .map(normalize)
            .filter(Boolean);

          return (
            keys.includes(
              normalize(
                customerName
              )
            ) ||
            keys.includes(
              normalize(
                customerCode
              )
            ) ||
            keys.some(
              k =>
                normalize(
                  customerName
                ).includes(k) ||
                k.includes(
                  normalize(
                    customerName
                  )
                )
            )
          );
        }
      ) ||
      null;

    return {
      id:
        customer.id,

      name:
        profile?.name ||
        customer.name ||
        getProductOwnerName(
          order
        ),

      tradingName:
        profile?.trading_name ||
        customer.trading_name ||
        customer.name ||
        getProductOwnerName(
          order
        ),

      customerCode:
        profile?.customer_code ||
        customer.customer_code ||
        "",

      vat:
        profile?.vat ||
        customer.vat_number ||
        customer.vat ||
        "",

      address1:
        profile?.address1 ||
        customer.address1 ||
        customer.address_1 ||
        "",

      address2:
        profile?.address2 ||
        customer.address2 ||
        customer.address_2 ||
        "",

      city:
        profile?.city ||
        customer.city ||
        "",

      postcode:
        profile?.postcode ||
        customer.postcode ||
        "",

      country:
        profile?.country ||
        customer.country ||
        "United Kingdom",

      logoUrl:
        profile?.logo_url ||
        ""
    };
  }

  function drawTopBar(doc) {
    doc.setFillColor(
      17,
      24,
      39
    );

    doc.rect(
      0,
      0,
      210,
      15.5,
      "F"
    );

    doc.setFillColor(
      18,
      103,
      255
    );

    doc.rect(
      0,
      15.5,
      210,
      2,
      "F"
    );
  }

  function drawHeader(
    doc,
    order,
    ctx,
    tenantLogoDataUrl
  ) {
    const company =
      ctx.company;

    drawTopBar(
      doc
    );

    const logoAdded =
      addLogo(
        doc,
        tenantLogoDataUrl,
        14,
        23,
        42,
        18
      );

    setDark(
      doc
    );

    if (!logoAdded) {
      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(
        15
      );

      doc.text(
        company.displayName ||
        company.name,
        14,
        33
      );
    }

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      21
    );

    doc.text(
      isCollectionOrder(order)
        ? "Collection Note"
        : "Delivery Note",
      196,
      31,
      {
        align: "right"
      }
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8.5
    );

    const supplierRef =
      getSupplierReference(
        order
      );

    doc.text(
      `Date: ${formatDate(
        new Date()
      )}`,
      196,
      41,
      {
        align: "right"
      }
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.text(
      `Order #: ${getOrderNumber(
        order
      )}`,
      196,
      48,
      {
        align: "right"
      }
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    if (supplierRef) {
      doc.text(
        `Supplier Ref: ${supplierRef}`,
        196,
        55,
        {
          align: "right"
        }
      );

      doc.text(
        `Purchase Order: ${getPurchaseOrder(
          order
        )}`,
        196,
        62,
        {
          align: "right"
        }
      );
    } else {
      doc.text(
        `Purchase Order: ${getPurchaseOrder(
          order
        )}`,
        196,
        55,
        {
          align: "right"
        }
      );
    }

    const infoY =
      logoAdded
        ? 47
        : 40;

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      9.5
    );

    doc.text(
      company.name,
      14,
      infoY
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8
    );

    doc.text(
      cleanText(
        company.address
      ),
      14,
      infoY + 5.5
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.text(
      "Phone",
      14,
      infoY + 13.5
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.text(
      company.phone,
      28,
      infoY + 13.5
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.text(
      "Email",
      78,
      infoY + 13.5
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.text(
      company.email,
      92,
      infoY + 13.5
    );
  }

  function drawAddressBlock(
    doc,
    title,
    lines,
    x,
    y,
    width,
    height
  ) {
    doc.setFillColor(
      248,
      250,
      252
    );

    doc.roundedRect(
      x,
      y,
      width,
      height,
      2,
      2,
      "F"
    );

    doc.setDrawColor(
      220,
      226,
      235
    );

    doc.roundedRect(
      x,
      y,
      width,
      height,
      2,
      2
    );

    setDark(
      doc
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      9
    );

    doc.text(
      title,
      x + 5,
      y + 8
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8
    );

    const wrapped =
      splitText(
        doc,
        lines
          .filter(Boolean)
          .map(cleanText)
          .join("\n"),
        width - 10
      );

    let lineY =
      y + 16;

    wrapped.forEach(
      line => {
        if (
          lineY <
          y +
          height -
          4
        ) {
          doc.text(
            line,
            x + 5,
            lineY
          );

          lineY +=
            4.4;
        }
      }
    );
  }

  function drawBillShip(
    doc,
    order,
    ctx
  ) {
    const owner =
      ctx.productOwner;

    const onBehalfOfLines =
      uniqueLines([
        owner.tradingName ||
        owner.name,

        owner.address1,
        owner.address2,
        owner.city,
        owner.postcode,
        owner.country,

        owner.vat
          ? `VAT No: ${owner.vat}`
          : ""
      ]);

    const shipToLines =
      getShipToLines(
        order
      );

    drawAddressBlock(
      doc,
      "ON BEHALF OF",
      onBehalfOfLines,
      14,
      72,
      86,
      47
    );

    drawAddressBlock(
      doc,
      isCollectionOrder(order)
        ? "COLLECT FROM"
        : "SHIP TO",
      shipToLines,
      110,
      72,
      86,
      47
    );
  }

  function drawTableHeader(
    doc,
    y,
    order
  ) {
    doc.setFillColor(
      245,
      247,
      250
    );

    doc.rect(
      14,
      y - 6,
      182,
      9,
      "F"
    );

    setDark(
      doc
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      7.1
    );

    doc.text(
      "Qty",
      14,
      y
    );

    doc.text(
      "Item",
      26,
      y
    );

    doc.text(
      "Description",
      46,
      y
    );

    doc.text(
      "Packages",
      116,
      y
    );

    doc.text(
      isCollectionOrder(order)
        ? "Collected"
        : "Delivered",
      150,
      y,
      {
        align: "right"
      }
    );

    doc.text(
      "Volume",
      174,
      y,
      {
        align: "right"
      }
    );

    doc.text(
      "Weight",
      194,
      y,
      {
        align: "right"
      }
    );

    doc.setDrawColor(
      70,
      80,
      95
    );

    doc.line(
      14,
      y + 3.5,
      196,
      y + 3.5
    );

    return (
      y +
      8.5
    );
  }

  function drawServiceWarningBox(
    doc,
    y,
    warning
  ) {
    if (!warning) {
      return y;
    }

    const warningLines =
      splitText(
        doc,
        warning,
        172
      );

    const boxHeight =
      Math.max(
        11,
        warningLines.length *
        3.5 +
        6
      );

    doc.setFillColor(
      255,
      247,
      237
    );

    doc.setDrawColor(
      253,
      186,
      116
    );

    doc.roundedRect(
      14,
      y - 4,
      182,
      boxHeight,
      2,
      2,
      "FD"
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      7
    );

    doc.setTextColor(
      194,
      65,
      12
    );

    doc.text(
      warningLines,
      17,
      y + 1
    );

    setDark(
      doc
    );

    return (
      y +
      boxHeight +
      3
    );
  }

  function maybeAddPage(
    doc,
    y,
    order,
    ctx,
    tenantLogoDataUrl
  ) {
    if (y <= 262) {
      return y;
    }

    doc.addPage();

    drawHeader(
      doc,
      order,
      ctx,
      tenantLogoDataUrl
    );

    return drawTableHeader(
      doc,
      72,
      order
    );
  }

  function drawLines(
    doc,
    order,
    ctx,
    tenantLogoDataUrl
  ) {
    let y =
      134;

    y =
      drawTableHeader(
        doc,
        y,
        order
      );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      7.1
    );

    const lines =
      getOrderLines(
        order
      );

    if (!lines.length) {
      doc.text(
        "No product lines found for this order.",
        14,
        y
      );

      return (
        y +
        9
      );
    }

    lines.forEach(
      line => {
        y =
          maybeAddPage(
            doc,
            y,
            order,
            ctx,
            tenantLogoDataUrl
          );

        const sku =
          getLineSku(
            line
          );

        const description =
          getLineDescription(
            line
          );

        const qty =
          getLineQty(
            line
          );

        const packageCount =
          getLinePackageCount(
            line
          );

        const packageLabel =
          getPackageLabel(
            line
          );

        const volume =
          getLineVolume(
            line
          );

        const weight =
          getLineWeight(
            line
          );

        const fullDescription =
          description;

        const descLines =
          splitText(
            doc,
            fullDescription,
            66
          );

        const packageWord =
          packageCount === 1
            ? "package"
            : "packages";

        const packageLines =
          splitText(
            doc,
            `${packageCount} ${packageWord}`,
            28
          );

        const labelLines =
          splitText(
            doc,
            packageLabel,
            34
          );

        const rowHeight =
          Math.max(
            9,
            descLines.length *
              3.4,
            (
              packageLines.length +
              labelLines.length
            ) *
              3.4
          );

        setDark(
          doc
        );

        doc.text(
          formatNumber(
            qty,
            0
          ),
          14,
          y
        );

        doc.text(
          sku,
          26,
          y
        );

        doc.text(
          descLines,
          46,
          y
        );

        doc.setFont(
          "helvetica",
          "bold"
        );

        doc.text(
          packageLines,
          116,
          y
        );

        doc.setFont(
          "helvetica",
          "normal"
        );

        doc.setFontSize(
          6.6
        );

        doc.text(
          labelLines,
          116,
          y + 4.2
        );

        doc.setFontSize(
          7.1
        );

        doc.text(
          formatNumber(
            qty,
            0
          ),
          150,
          y,
          {
            align: "right"
          }
        );

        doc.text(
          formatNumber(
            volume,
            2
          ),
          174,
          y,
          {
            align: "right"
          }
        );

        doc.text(
          formatNumber(
            weight,
            1
          ),
          194,
          y,
          {
            align: "right"
          }
        );

        y +=
          rowHeight;

        const serviceWarning =
          getServiceWarning(
            line,
            order
          );

        if (serviceWarning) {
          y =
            maybeAddPage(
              doc,
              y + 2,
              order,
              ctx,
              tenantLogoDataUrl
            );

          y =
            drawServiceWarningBox(
              doc,
              y,
              serviceWarning
            );
        }
      }
    );

    return (
      y +
      5
    );
  }

  function drawTotalsAndSignature(
    doc,
    y,
    order,
    ctx,
    tenantLogoDataUrl
  ) {
    if (y > 230) {
      doc.addPage();

      drawHeader(
        doc,
        order,
        ctx,
        tenantLogoDataUrl
      );

      y = 72;
    }

    const totalProducts =
      getTotalProducts(
        order
      );

    const totalPackages =
      getTotalPackages(
        order
      );

    const totalVolume =
      getTotalVolume(
        order
      );

    const totalWeight =
      getTotalWeight(
        order
      );

    doc.setDrawColor(
      70,
      80,
      95
    );

    doc.line(
      14,
      y,
      196,
      y
    );

    y += 8;

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      8.5
    );

    doc.text(
      "Total Products",
      116,
      y
    );

    doc.text(
      formatNumber(
        totalProducts,
        0
      ),
      194,
      y,
      {
        align: "right"
      }
    );

    y += 5.5;

    doc.text(
      "Total Packages",
      116,
      y
    );

    doc.text(
      formatNumber(
        totalPackages,
        0
      ),
      194,
      y,
      {
        align: "right"
      }
    );

    y += 5.5;

    doc.text(
      "Total Volume",
      116,
      y
    );

    doc.text(
      `${formatNumber(
        totalVolume,
        2
      )} m³`,
      194,
      y,
      {
        align: "right"
      }
    );

    y += 5.5;

    doc.text(
      "Total Weight",
      116,
      y
    );

    doc.text(
      `${formatNumber(
        totalWeight,
        1
      )} kg`,
      194,
      y,
      {
        align: "right"
      }
    );

    y += 16;

    if (y > 244) {
      doc.addPage();

      drawHeader(
        doc,
        order,
        ctx,
        tenantLogoDataUrl
      );

      y = 72;
    }

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8.5
    );

    if (
      isCollectionOrder(
        order
      )
    ) {
      doc.text(
        "Collected Via:",
        14,
        y
      );

      doc.line(
        44,
        y,
        132,
        y
      );

      y += 14;

      doc.text(
        "Released By:",
        14,
        y
      );

      doc.line(
        46,
        y,
        132,
        y
      );
    } else {
      doc.text(
        "Delivered Via:",
        14,
        y
      );

      doc.line(
        44,
        y,
        132,
        y
      );

      y += 14;

      doc.text(
        "Received By:",
        14,
        y
      );

      doc.line(
        46,
        y,
        132,
        y
      );
    }

    y += 10;

    doc.text(
      "Date:",
      14,
      y
    );

    doc.line(
      28,
      y,
      132,
      y
    );

    y += 14;

    if (y > 263) {
      doc.addPage();

      drawHeader(
        doc,
        order,
        ctx,
        tenantLogoDataUrl
      );

      y = 72;
    }

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      8
    );

    const noteText =
      isCollectionOrder(order)
        ? "Goods released for collection. Any visible damage or discrepancies should be recorded at the time of collection."
        : (
            ctx.damageNote ||
            DEFAULT_DAMAGE_NOTE
          );

    const noteLines =
      splitText(
        doc,
        noteText,
        170
      );

    doc.text(
      noteLines.slice(
        0,
        2
      ),
      14,
      y
    );

    return (
      y +
      10
    );
  }

  function drawFooter(
    doc,
    company
  ) {
    const pageCount =
      doc.getNumberOfPages();

    for (
      let i = 1;
      i <= pageCount;
      i++
    ) {
      doc.setPage(
        i
      );

      doc.setDrawColor(
        220,
        226,
        235
      );

      doc.line(
        14,
        282,
        196,
        282
      );

      setMuted(
        doc
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(
        7.5
      );

      const footerLine1 =
        company.footerText ||
        `${company.name}  ${company.address}`;

      const footerLine2 =
        `Phone ${company.phone}   Email ${company.email}   VAT No ${company.vat}`;

      doc.text(
        footerLine1,
        105,
        287,
        {
          align: "center"
        }
      );

      doc.text(
        footerLine2,
        105,
        292,
        {
          align: "center"
        }
      );

      setDark(
        doc
      );
    }
  }

  async function createPdfBlob(
    order,
    ctx
  ) {
    if (
      !window.jspdf?.jsPDF
    ) {
      throw new Error(
        "jsPDF is not loaded. Add jsPDF before delivery-note-generator.js in the HTML."
      );
    }

    const {
      jsPDF
    } =
      window.jspdf;

    const doc =
      new jsPDF({
        orientation:
          "portrait",
        unit:
          "mm",
        format:
          "a4"
      });

    const tenantLogoDataUrl =
      await urlToDataUrl(
        ctx.company.logoUrl
      );

    const watermarkDataUrl =
      await urlToDataUrl(
        ctx.productOwner.logoUrl
      );

    drawHeader(
      doc,
      order,
      ctx,
      tenantLogoDataUrl
    );

    drawBillShip(
      doc,
      order,
      ctx
    );

    addWatermark(
      doc,
      watermarkDataUrl
    );

    const y =
      drawLines(
        doc,
        order,
        ctx,
        tenantLogoDataUrl
      );

    drawTotalsAndSignature(
      doc,
      y,
      order,
      ctx,
      tenantLogoDataUrl
    );

    drawFooter(
      doc,
      ctx.company
    );

    return doc.output(
      "blob"
    );
  }

  async function uploadPdf(
    client,
    companyId,
    order,
    blob
  ) {
    const orderPart =
      safeFilePart(
        order.order_number ||
        order.id
      );

    const supplierPart =
      safeFilePart(
        order.external_reference ||
        ""
      );

    const versionPart =
      Date.now();

    const documentLabel =
      isCollectionOrder(order)
        ? "Collection Note"
        : "Delivery Note";

    const fileName =
      supplierPart
        ? `${documentLabel} ${orderPart} ${supplierPart} ${versionPart}.pdf`
        : `${documentLabel} ${orderPart} ${versionPart}.pdf`;

    const storagePath =
      `${companyId}/${order.id}/${fileName}`;

    const {
      error
    } =
      await client.storage
        .from(
          DOCUMENT_BUCKET
        )
        .upload(
          storagePath,
          blob,
          {
            contentType:
              "application/pdf",
            upsert:
              true
          }
        );

    if (error) {
      throw error;
    }

    const {
      data
    } =
      client.storage
        .from(
          DOCUMENT_BUCKET
        )
        .getPublicUrl(
          storagePath
        );

    return {
      storagePath,
      fileUrl:
        data?.publicUrl ||
        ""
    };
  }

  async function upsertDocumentRecord(
    client,
    companyId,
    order,
    uploaded
  ) {
    const existing =
      (
        order.order_documents ||
        []
      ).find(
        doc =>
          normalize(
            doc.document_type
          ) ===
          "delivery_note"
      );

    const payload = {
      company_id:
        companyId,

      customer_id:
        order.customer_id ||
        null,

      order_id:
        order.id,

      document_type:
        "delivery_note",

      document_number:
        order.order_number ||
        String(
          order.id
        ).slice(
          0,
          8
        ),

      document_status:
        "generated",

      file_url:
        uploaded.fileUrl,

      storage_path:
        uploaded.storagePath,

      customer_visible:
        true,

      updated_at:
        new Date().toISOString()
    };

    if (existing?.id) {
      const {
        error
      } =
        await client
          .from(
            "order_documents"
          )
          .update(
            payload
          )
          .eq(
            "id",
            existing.id
          );

      if (error) {
        throw error;
      }

      return existing.id;
    }

    const {
      data,
      error
    } =
      await client
        .from(
          "order_documents"
        )
        .insert({
          ...payload,
          created_at:
            new Date().toISOString()
        })
        .select(
          "id"
        )
        .single();

    if (error) {
      throw error;
    }

    return (
      data?.id ||
      null
    );
  }

  async function createActivity(
    client,
    companyId,
    order
  ) {
    const {
      error
    } =
      await client
        .from(
          "order_activity_log"
        )
        .insert({
          company_id:
            companyId,

          customer_id:
            order.customer_id ||
            null,

          order_id:
            order.id,

          activity_type:
            "document_generated",

          old_status:
            "not_generated",

          new_status:
            "generated",

          description:
            isCollectionOrder(order)
              ? "Collection note generated and uploaded"
              : "Delivery note generated and uploaded",

          created_by:
            "manual"
        });

    if (error) {
      console.warn(
        "Delivery note activity log skipped:",
        error.message
      );
    }
  }

  async function loadFreshOrderForDeliveryNote(
    client,
    companyId,
    orderId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "orders"
        )
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
              packages_per_unit,
              package_1_volume_m3,
              package_2_volume_m3,
              package_3_volume_m3,
              package_1_weight_kg,
              package_2_weight_kg,
              package_3_weight_kg
            ),
            order_allocations (
              id,
              allocation_status,
              items (
                id,
                package_no,
                package_total,
                physical_product_id
              )
            )
          )
        `)
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "id",
          orderId
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    return (
      data ||
      null
    );
  }

  async function generate(
    order,
    client,
    companyId
  ) {
    if (!order?.id) {
      throw new Error(
        "Cannot generate delivery note: order is missing."
      );
    }

    if (!client) {
      throw new Error(
        "Cannot generate delivery note: Supabase client is missing."
      );
    }

    if (!companyId) {
      throw new Error(
        "Cannot generate delivery note: companyId is missing."
      );
    }

    const freshOrder =
      await loadFreshOrderForDeliveryNote(
        client,
        companyId,
        order.id
      );

    const workingOrder =
      freshOrder ||
      order;

    const ctx =
      await loadCompanySettings(
        client,
        companyId
      );

    ctx.productOwner =
      await loadProductOwnerProfile(
        client,
        workingOrder,
        ctx.ownerProfiles
      );

    const blob =
      await createPdfBlob(
        workingOrder,
        ctx
      );

    const uploaded =
      await uploadPdf(
        client,
        companyId,
        workingOrder,
        blob
      );

    if (
      !uploaded.fileUrl ||
      !uploaded.storagePath
    ) {
      throw new Error(
        "Delivery note PDF was uploaded, but no file URL/storage path was returned."
      );
    }

    await upsertDocumentRecord(
      client,
      companyId,
      workingOrder,
      uploaded
    );

    await createActivity(
      client,
      companyId,
      workingOrder
    );

    await client
      .from(
        "orders"
      )
      .update({
        last_activity_at:
          new Date().toISOString()
      })
      .eq(
        "id",
        workingOrder.id
      );

    return uploaded;
  }

  window.DeliveryNoteGenerator = {
    generate
  };
})();