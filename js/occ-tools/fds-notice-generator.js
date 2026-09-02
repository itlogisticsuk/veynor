(function () {
  "use strict";

  function getJsPdf() {
    return window.jspdf?.jsPDF || window.jsPDF || null;
  }

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";

    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

function toNumber(value, fallback = 0) {
  const num = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : fallback;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isCollectionOrder(order) {
  return (
    normalize(order?.movement_type) ===
    "collection"
  );
}

function getLineQuantity(line) {
  return Math.max(
    0,
    Math.round(
      toNumber(
        line?.quantity_ordered ??
        line?.quantity,
        0
      )
    )
  );
}

function getPhysicalQuantity(line) {
  const quantity =
    getLineQuantity(line);

  const sku = clean(
    line?.sku_base ||
    line?.products?.sku_base ||
    ""
  ).toUpperCase();

  if (sku === "ALBCH") {
    return Math.ceil(
      quantity / 2
    );
  }

  return quantity;
}

function getProductPackageCount(product) {
  const packageCount = toNumber(product?.package_count, 0);

  if (packageCount > 0) {
    return Math.max(1, Math.round(packageCount));
  }

  const packagesPerUnit = toNumber(
    product?.packages_per_unit,
    0
  );

  if (packagesPerUnit > 0) {
    return Math.max(1, Math.round(packagesPerUnit));
  }

  const packageParts = [
    toNumber(product?.package_1_qty, 0),
    toNumber(product?.package_2_qty, 0),
    toNumber(product?.package_3_qty, 0)
  ];

  const configuredPackages = packageParts.filter(
    value => value > 0
  ).length;

  return Math.max(1, configuredPackages || 1);
}

function getLinePackages(line) {
  const orderedQuantity =
  getLineQuantity(line);

const quantity =
  normalize(line?.line_type) ===
  "manual"
    ? orderedQuantity
    : getPhysicalQuantity(line);

  if (quantity <= 0) {
    return 0;
  }

  /*
   * OCC telt handmatige financiële regels niet mee
   * als fysieke packages.
   */
  if (normalize(line?.line_type) === "manual") {
    return 0;
  }

  /*
   * Hard-stockregels gebruiken dezelfde logica als OCC:
   * eerst het opgeslagen totale aantal packages,
   * anders quantity × packages_per_unit.
   */
  if (normalize(line?.line_type) === "hard_stock") {
    const storedTotalPackages = toNumber(
      line?.total_packages,
      0
    );

    if (storedTotalPackages > 0) {
      return Math.max(
        1,
        Math.round(storedTotalPackages)
      );
    }

    const packagesPerUnit = Math.max(
      1,
      Math.round(
        toNumber(line?.packages_per_unit, 1)
      )
    );

    return quantity * packagesPerUnit;
  }

  /*
   * Bij een specifiek opgevraagd package,
   * bijvoorbeeld package 1 van 2,
   * staat iedere orderregel voor het gevraagde aantal packages.
   */
  if (
    toNumber(line?.requested_package_no, 0) > 0 &&
    toNumber(line?.requested_package_total, 0) > 0
  ) {
    return quantity;
  }

  /*
   * Normale orderregels:
   * exact dezelfde formule als OCC.
   *
   * quantity_ordered × package-instelling van het product.
   */
  return quantity * getProductPackageCount(
    line?.products || {}
  );
}

function getOrderPackages(order) {
  const lines = Array.isArray(order?.order_lines)
    ? order.order_lines.filter(
        line => normalize(line?.line_type) !== "manual"
      )
    : [];

  /*
   * Legacy-orders worden in OCC als quantity per regel behandeld.
   */
  if (normalize(order?.order_type) === "legacy") {
    const legacyPackages = lines.reduce((sum, line) => {
      return sum + Math.max(
        1,
        getLineQuantity(line)
      );
    }, 0);

    if (legacyPackages > 0) {
      return legacyPackages;
    }
  }

  const calculatedPackages = lines.reduce(
    (sum, line) => sum + getLinePackages(line),
    0
  );

  if (calculatedPackages > 0) {
    return calculatedPackages;
  }

  /*
   * Alleen fallback wanneer er geen bruikbare orderregels zijn.
   */
  return Math.max(
    0,
    Math.round(
      toNumber(
        order?.planning_colli ??
        order?.total_order_colli ??
        order?.colli,
        0
      )
    )
  );
}
function getOrderVolume(order) {
  return Number(
    order?.total_order_volume_m3 ??
    order?.volume_m3 ??
    order?.planning_volume_m3 ??
    0
  );
}

function getOrderWeight(order) {
  const direct =
    toNumber(order?.total_order_weight_kg, 0) ||
    toNumber(order?.weight_kg, 0);

  if (direct > 0) {
    return direct;
  }

  const lines = Array.isArray(order?.order_lines)
    ? order.order_lines
    : [];

  return lines.reduce((sum, line) => {
    const quantity = Math.max(
      0,
      toNumber(line?.quantity_ordered, 0)
    );

    const lineWeight =
      toNumber(line?.total_line_weight_kg, 0) ||
      (
        toNumber(line?.unit_weight_kg, 0) *
        quantity
      ) ||
      (
        toNumber(line?.products?.weight_kg, 0) *
        quantity
      ) ||
      (
        toNumber(line?.products?.net_weight_kg, 0) *
        quantity
      );

    return sum + lineWeight;
  }, 0);
}

  function getAddress(order) {
    return [
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_address_3,
      order.delivery_city,
      order.delivery_postcode
    ]
      .map(clean)
      .filter(Boolean)
      .join(", ");
  }

  function getRetailer(order) {
    return clean(
      order.retailer_name ||
      order.retail_name ||
      order.delivery_name ||
      order.recipient_name ||
      "—"
    );
  }

 async function generate({
  vehicle,
  orders,
  logoUrl
}) {
  const JsPDF =
    getJsPdf();

  if (!JsPDF) {
    throw new Error(
      "jsPDF is not loaded."
    );
  }

  if (!orders?.length) {
    throw new Error(
      "No FDS orders found."
    );
  }

  const doc =
    new JsPDF(
      "p",
      "mm",
      "a4"
    );

  const totalPackages =
    orders.reduce(
      (sum, order) =>
        sum +
        getOrderPackages(order),
      0
    );

  const totalVolume =
    orders.reduce(
      (sum, order) =>
        sum +
        getOrderVolume(order),
      0
    );

  const totalWeight =
    orders.reduce(
      (sum, order) =>
        sum +
        getOrderWeight(order),
      0
    );

  const collectionCount =
    orders.filter(
      isCollectionOrder
    ).length;

  let y = 14;

  if (logoUrl) {
    try {
      doc.addImage(
        logoUrl,
        "PNG",
        14,
        10,
        28,
        18
      );
    } catch (error) {
      console.warn(
        "Logo skipped:",
        error
      );
    }
  }

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setFontSize(
    17
  );

  doc.text(
    "FDS COLLECTION NOTICE",
    50,
    18
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(
    9
  );

  doc.text(
    `Carrier: ${clean(
      vehicle?.name ||
      vehicle?.vehicle_name ||
      "FDS"
    )}`,
    50,
    25
  );

  doc.text(
    `Generated: ${new Date().toLocaleString(
      "en-GB"
    )}`,
    50,
    30
  );

  y = 42;

  doc.setDrawColor(
    220,
    225,
    235
  );

  doc.roundedRect(
    14,
    y,
    182,
    24,
    3,
    3
  );

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setFontSize(
    9
  );

  doc.text(
    `Orders: ${orders.length}`,
    20,
    y + 8
  );

  doc.text(
    `Packages: ${formatNumber(
      totalPackages
    )}`,
    58,
    y + 8
  );

  doc.text(
    `Volume: ${formatNumber(
      totalVolume,
      2
    )} m³`,
    108,
    y + 8
  );

  doc.text(
    `Weight: ${formatNumber(
      totalWeight,
      0
    )} kg`,
    158,
    y + 8
  );

  if (collectionCount > 0) {
    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      8
    );

    doc.setTextColor(
      14,
      116,
      144
    );

    doc.text(
      `${collectionCount} retailer collection${
        collectionCount === 1
          ? ""
          : "s"
      } included`,
      20,
      y + 17
    );

    doc.setTextColor(
      0,
      0,
      0
    );
  }

  y += 36;

  doc.setFontSize(
    7.6
  );

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.text(
    "SO",
    14,
    y
  );

  doc.text(
    "ACK",
    33,
    y
  );

  doc.text(
    "Retailer",
    54,
    y
  );

  doc.text(
    "Type",
    108,
    y
  );

  doc.text(
    "Postcode",
    133,
    y
  );

  doc.text(
    "Pkg",
    158,
    y,
    {
      align: "right"
    }
  );

  doc.text(
    "m³",
    176,
    y,
    {
      align: "right"
    }
  );

  doc.text(
    "kg",
    194,
    y,
    {
      align: "right"
    }
  );

  y += 3;

  doc.setDrawColor(
    220,
    225,
    235
  );

  doc.line(
    14,
    y,
    196,
    y
  );

  y += 6;

  orders.forEach(
    (order, index) => {
      if (y > 254) {
        doc.addPage();
        y = 18;
      }

      const collection =
        isCollectionOrder(
          order
        );

      const rowHeight =
        collection
          ? 17
          : 13;

      if (collection) {
        doc.setFillColor(
          236,
          254,
          255
        );

        doc.rect(
          14,
          y - 4,
          182,
          rowHeight,
          "F"
        );
      } else if (
        index % 2 === 1
      ) {
        doc.setFillColor(
          242,
          245,
          249
        );

        doc.rect(
          14,
          y - 4,
          182,
          rowHeight,
          "F"
        );
      }

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(
        7.6
      );

      doc.setTextColor(
        7,
        21,
        47
      );

      doc.text(
        clean(
          order.order_number ||
          "—"
        ),
        14,
        y
      );

      doc.setTextColor(
        0,
        0,
        0
      );

      doc.text(
        clean(
          order.external_reference ||
          "—"
        ),
        33,
        y
      );

      doc.text(
        getRetailer(order)
          .slice(
            0,
            28
          ),
        54,
        y
      );

      if (collection) {
        doc.setTextColor(
          14,
          116,
          144
        );

        doc.setFont(
          "helvetica",
          "bold"
        );

        doc.text(
          "COLLECTION",
          108,
          y
        );
      } else {
        doc.setTextColor(
          71,
          85,
          105
        );

        doc.setFont(
          "helvetica",
          "normal"
        );

        doc.text(
          "DELIVERY",
          108,
          y
        );
      }

      doc.setTextColor(
        0,
        0,
        0
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        clean(
          order.delivery_postcode ||
          "—"
        ),
        133,
        y
      );

      doc.text(
        formatNumber(
          getOrderPackages(order)
        ),
        158,
        y,
        {
          align: "right"
        }
      );

      doc.text(
        formatNumber(
          getOrderVolume(order),
          2
        ),
        176,
        y,
        {
          align: "right"
        }
      );

      doc.text(
        formatNumber(
          getOrderWeight(order),
          0
        ),
        194,
        y,
        {
          align: "right"
        }
      );

      y += 5;

      doc.setFontSize(
        7.2
      );

      if (collection) {
        doc.setFont(
          "helvetica",
          "bold"
        );

        doc.setTextColor(
          14,
          116,
          144
        );

        doc.text(
          "PICK UP FROM RETAILER",
          54,
          y
        );

        y += 4;
      }

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setTextColor(
        80,
        85,
        95
      );

      doc.text(
        getAddress(order)
          .slice(
            0,
            90
          ),
        54,
        y
      );

      doc.setTextColor(
        0,
        0,
        0
      );

      y += 9;
    }
  );

  y += 8;

  if (y > 238) {
    doc.addPage();
    y = 20;
  }

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setFontSize(
    9
  );

  doc.text(
    "Collection confirmation",
    14,
    y
  );

  y += 11;

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(
    8.5
  );

  doc.text(
    "Collected by FDS:",
    14,
    y
  );

  doc.line(
    50,
    y,
    115,
    y
  );

  y += 10;

  doc.text(
    "Signature:",
    14,
    y
  );

  doc.line(
    50,
    y,
    115,
    y
  );

  y += 10;

  doc.text(
    "Date / time:",
    14,
    y
  );

  doc.line(
    50,
    y,
    115,
    y
  );

  doc.save(
    `FDS-Collection-Notice-${
      new Date()
        .toISOString()
        .slice(
          0,
          10
        )
    }.pdf`
  );
}

  window.FdsNoticeGenerator = {
    generate
  };
})();