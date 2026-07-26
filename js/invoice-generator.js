(function () {
  "use strict";

  const DOCUMENT_BUCKET = "order-documents";
const DEFAULT_VAT_RATE = 0.20;
const DEFAULT_PAYMENT_TERM_DAYS = 14;
const DEFAULT_FUEL_SURCHARGE_PERCENT = 8.5;

  const FALLBACK_COMPANY = {
    name: "Sofa2U Ltd",
    displayName: "Sofa2U",
    address: "860-862 Garratt Lane, London, SW17 0NB",
    phone: "+44 (0) 7894 469947",
    email: "sales@sofa2u.co.uk",
    vat: "GB 368 665 249",
    logoUrl: "",
    bankName: "NatWest",
    sortCode: "51-61-11",
    accountNo: "7797 5170",
    iban: "",
    bic: "",
    paymentNote: "Please make payments via bank transfer using the details shown on this invoice.",
    footerText: ""
  };

const COL = {
  order: 14,
  retailer: 34,
  address: 61,
  date: 118,
  amount: 136,
  warehouse: 151,
  transport: 171,
  total: 188
};

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
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

function formatNumber(value, digits = 0) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";

  return num.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
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
function getOrderNumber(order) {
  return cleanText(order.order_number || order.external_reference || order.id || "—");
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
      "—"
    );
  }

  function getRetailerName(order) {
    return cleanText(
      order.retail_name ||
      order.retailer_name ||
      "—"
    );
  }

  function getDeliveryAddress(order) {
    return [
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_city,
      order.delivery_region,
      order.delivery_postcode,
      order.delivery_country || "United Kingdom"
    ].filter(Boolean).map(cleanText).join(", ");
  }

  function getDeliveryDate(order) {
    return (
      order.delivered_at ||
      order.actual_delivery_date ||
      order.confirmed_delivery_date ||
      order.requested_delivery_date ||
      new Date()
    );
  }

  function getDeliveredColli(order) {
    return toNumber(order.total_order_colli, 0) ||
      toNumber(order.planning_colli, 0) ||
      (order.order_lines || []).reduce((sum, line) => sum + toNumber(line.quantity_ordered, 0), 0);
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

/*
 * Bepaalt of een order financieel belastbaar is.
 *
 * Alleen wanneer is_chargeable expliciet false is,
 * behandelen we de order als volledig gratis.
 *
 * Bij oudere orders waarbij het veld null of niet
 * aanwezig is, blijft de bestaande prijsberekening
 * gewoon werken.
 */
function isChargeableOrder(order) {
  return order?.is_chargeable !== false;
}

/*
 * Warehousekosten van één order.
 *
 * Bij een gratis order wordt altijd £0.00
 * teruggegeven, zelfs wanneer op oude orderregels
 * nog tarieven aanwezig zouden zijn.
 */
function getOrderWarehouseTotal(order) {
  if (!isChargeableOrder(order)) {
    return 0;
  }

  const fromLines = round2(
    (order.order_lines || []).reduce(
      (sum, line) => {
        return (
          sum +
          getLineWarehouseCost(line)
        );
      },
      0
    )
  );

  /*
   * De orderregels zijn leidend wanneer daar
   * een bedrag op staat.
   */
  if (fromLines !== 0) {
    return fromLines;
  }

  /*
   * Fallback voor oudere orders waarbij alleen
   * de totalen op orders zijn opgeslagen.
   */
  return round2(
    toNumber(
      order.total_storage_tariff,
      0
    ) +
    toNumber(
      order.total_admin_tariff,
      0
    ) +
    toNumber(
      order.total_handling_tariff,
      0
    )
  );
}

/*
 * Transportkosten van één order.
 *
 * Bij is_chargeable = false wordt ook transport
 * altijd volledig op nul gezet.
 */
function getOrderTransportTotal(order) {
  if (!isChargeableOrder(order)) {
    return 0;
  }

  const fromLines = round2(
    (order.order_lines || []).reduce(
      (sum, line) => {
        return (
          sum +
          getLineTransportCost(line)
        );
      },
      0
    )
  );

  if (fromLines !== 0) {
    return fromLines;
  }

  return round2(
    toNumber(
      order.total_transport_tariff,
      0
    )
  );
}

/*
 * Volledige orderwaarde.
 *
 * De expliciete total_customer_charge heeft
 * normaal voorrang.
 *
 * Voor een gratis order wordt deze functie al
 * vóór alle berekeningen beëindigd met £0.00.
 */
function getOrderTotal(order) {
  if (!isChargeableOrder(order)) {
    return 0;
  }

  const explicit = round2(
    toNumber(
      order.total_customer_charge,
      0
    )
  );

  if (explicit !== 0) {
    return explicit;
  }

  return round2(
    getOrderWarehouseTotal(order) +
    getOrderTransportTotal(order)
  );
}

/*
 * Maakt een lijst met de ordernummers die op
 * deze factuur chargeable zijn.
 */
function getChargeableOrderNumbers(orders) {
  return new Set(
    (orders || [])
      .filter(order =>
        isChargeableOrder(order)
      )
      .flatMap(order => {
        return [
          cleanText(
            order.order_number ||
            ""
          ),
          cleanText(
            order.external_reference ||
            ""
          )
        ];
      })
      .filter(Boolean)
      .map(value =>
        normalize(value)
      )
  );
}

/*
 * Minimum Delivery Charges.
 *
 * Belangrijk:
 *
 * - wanneer alle geselecteerde orders gratis zijn,
 *   wordt er geen Minimum Delivery Charge gerekend;
 *
 * - wanneer een surcharge aan een specifiek
 *   ordernummer is gekoppeld, wordt gecontroleerd
 *   of dat ordernummer chargeable is;
 *
 * - surcharges zonder ordernummer blijven alleen
 *   meetellen wanneer de factuur minimaal één
 *   chargeable order bevat.
 */
function getDeliverySurchargeTotal(
  ctx,
  orders = []
) {
  const chargeableOrders =
    (orders || []).filter(order =>
      isChargeableOrder(order)
    );

  /*
   * Een factuur met alleen gratis orders mag
   * nooit alsnog een Minimum Delivery Charge
   * krijgen.
   */
  if (!chargeableOrders.length) {
    return 0;
  }

  const chargeableOrderNumbers =
    getChargeableOrderNumbers(
      chargeableOrders
    );

  return round2(
    (
      ctx.deliverySurcharges ||
      []
    ).reduce(
      (sum, item) => {
        const linkedOrderNumber =
          normalize(
            item.order_number ||
            ""
          );

        /*
         * Wanneer de delivery group een concreet
         * ordernummer bevat, telt hij alleen mee
         * wanneer dat ordernummer chargeable is.
         */
        if (
          linkedOrderNumber &&
          !chargeableOrderNumbers.has(
            linkedOrderNumber
          )
        ) {
          return sum;
        }

        return (
          sum +
          toNumber(
            item.applied_surcharge,
            0
          )
        );
      },
      0
    )
  );
}

function isCreditOrder(order) {
  return (
    normalize(
      order.order_type
    ) === "credit" ||
    order.is_credit === true
  );
}

/*
 * Creditbedragen.
 *
 * getOrderTotal() bevat al de free-of-charge
 * beveiliging. Een niet-chargeable creditorder
 * levert daarom eveneens £0.00 op.
 */
function getCreditTotal(orders) {
  return round2(
    (orders || []).reduce(
      (sum, order) => {
        if (!isCreditOrder(order)) {
          return sum;
        }

        return (
          sum +
          getOrderTotal(order)
        );
      },
      0
    )
  );
}

/*
 * Berekent de volledige factuurtotalen.
 *
 * Free-of-charge orders blijven wel zichtbaar
 * op de specificatie, maar dragen financieel
 * £0.00 bij aan:
 *
 * - warehouse;
 * - transport;
 * - fuel surcharge;
 * - VAT;
 * - invoice total.
 */
function getTotals(
  orders,
  vatRate,
  fuelSurchargePercent =
    DEFAULT_FUEL_SURCHARGE_PERCENT,
  ctx = {}
) {
  const selectedOrders =
    Array.isArray(orders)
      ? orders
      : [];

  const normalOrders =
    selectedOrders.filter(order =>
      !isCreditOrder(order)
    );

  const creditOrders =
    selectedOrders.filter(order =>
      isCreditOrder(order)
    );

  /*
   * Deze functies controleren ieder afzonderlijk
   * of een order chargeable is.
   */
  const warehouse = round2(
    normalOrders.reduce(
      (sum, order) => {
        return (
          sum +
          getOrderWarehouseTotal(order)
        );
      },
      0
    )
  );

  const transport = round2(
    normalOrders.reduce(
      (sum, order) => {
        return (
          sum +
          getOrderTransportTotal(order)
        );
      },
      0
    )
  );

  const credits = round2(
    creditOrders.reduce(
      (sum, order) => {
        return (
          sum +
          getOrderTotal(order)
        );
      },
      0
    )
  );

  /*
   * Minimum Delivery Charges worden alleen
   * gerekend voor chargeable orders.
   */
  const minimumDeliverySurcharge =
    getDeliverySurchargeTotal(
      ctx,
      selectedOrders
    );

  /*
   * Basisbedrag vóór fuel surcharge.
   */
  const serviceSubtotal = round2(
    warehouse +
    transport +
    credits
  );

  /*
   * De fuel surcharge wordt alleen berekend
   * over transport.
   *
   * Wanneer alle orders gratis zijn, is transport
   * automatisch £0.00 en dus ook fuel £0.00.
   */
  const fuelSurchargeBase =
    round2(
      transport
    );

  const usedFuelPercent =
    toNumber(
      fuelSurchargePercent,
      0
    );

  const fuelSurcharge = round2(
    fuelSurchargeBase *
    (
      usedFuelPercent /
      100
    )
  );

  /*
   * Minimum Delivery Charge wordt na het
   * serviceSubtotal toegevoegd.
   */
  const subtotal = round2(
    serviceSubtotal +
    fuelSurcharge +
    minimumDeliverySurcharge
  );

  /*
   * VAT wordt uitsluitend berekend over het
   * daadwerkelijke factuurbedrag.
   */
  const vat = round2(
    subtotal *
    toNumber(
      vatRate,
      0
    )
  );

  const total = round2(
    subtotal +
    vat
  );

  return {
    warehouse,
    transport,
    credits,
    minimumDeliverySurcharge,
    serviceSubtotal,

    fuelSurchargePercent:
      usedFuelPercent,

    fuelSurcharge,
    subtotal,
    vatBase:
      subtotal,
    vat,
    total
  };
}

function getCombinedServiceTotal(totals) {
  return round2(
    toNumber(totals.warehouse, 0) +
    toNumber(totals.transport, 0) +
    toNumber(totals.credits, 0) +
    toNumber(totals.minimumDeliverySurcharge, 0)
  );
}

async function reserveNextInvoiceNumber(
  client,
  companyId,
  prefix = "INV"
) {
  const { data, error } = await client.rpc(
    "get_next_invoice_number",
    {
      p_company_id: companyId
    }
  );

  if (error) {
    throw new Error(
      `Could not reserve invoice number: ${error.message}`
    );
  }

  const number = Math.round(toNumber(data, 0));

  if (number <= 0) {
    throw new Error("Invalid invoice number returned.");
  }

  return `${prefix}-${String(number).padStart(5, "0")}`;
}

  function makeInvoiceNumber(prefix = "INV") {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${prefix}-${y}${m}${d}-${hh}${mm}${ss}`;
  }

  async function loadCompanySettings(client, companyId) {
    const { data, error } = await client
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId);

    if (error) {
      console.warn("Invoice company settings skipped:", error.message);
      return {
  company: { ...FALLBACK_COMPANY },
  vatRate: DEFAULT_VAT_RATE,
  paymentTermDays: DEFAULT_PAYMENT_TERM_DAYS,
  invoicePrefix: "INV",
  fuelSurchargePercent: DEFAULT_FUEL_SURCHARGE_PERCENT
};
    }

    const map = new Map((data || []).map(row => [row.setting_key, row.setting_value ?? ""]));

    const company = {
      name: map.get("main_company_name") || FALLBACK_COMPANY.name,
      displayName: map.get("main_display_name") || FALLBACK_COMPANY.displayName,
      registration: map.get("main_company_registration") || "",
      address: map.get("main_address") || FALLBACK_COMPANY.address,
      phone: map.get("main_phone") || FALLBACK_COMPANY.phone,
      email: map.get("main_email") || FALLBACK_COMPANY.email,
      vat: map.get("main_vat") || FALLBACK_COMPANY.vat,
      logoUrl: map.get("main_logo_url") || FALLBACK_COMPANY.logoUrl,

      bankCompanyName: map.get("bank_company_name") || map.get("main_company_name") || FALLBACK_COMPANY.name,
      bankName: map.get("bank_name") || FALLBACK_COMPANY.bankName,
      sortCode: map.get("bank_sort_code") || FALLBACK_COMPANY.sortCode,
      accountNo: map.get("bank_account_no") || FALLBACK_COMPANY.accountNo,
      iban: map.get("bank_iban") || "",
      bic: map.get("bank_bic") || "",

      paymentNote: map.get("invoice_payment_note") || FALLBACK_COMPANY.paymentNote,
      footerText: map.get("document_footer_text") || FALLBACK_COMPANY.footerText
    };

    return {
  company,
  vatRate: toNumber(map.get("tax_default_vat_rate") || map.get("doc_vat_rate"), DEFAULT_VAT_RATE),
  paymentTermDays: Math.round(toNumber(map.get("default_payment_terms_days") || map.get("doc_default_payment_terms"), DEFAULT_PAYMENT_TERM_DAYS)),
  invoicePrefix: map.get("invoice_prefix") || "INV",
  fuelSurchargePercent: toNumber(map.get("fuel_surcharge_percent"), DEFAULT_FUEL_SURCHARGE_PERCENT)
};
  }

  async function loadProductOwnerProfile(client, customerId) {
    if (!customerId) {
      throw new Error("Selected orders have no product owner/customer_id.");
    }

    const { data: customer, error: customerError } = await client
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) throw customerError;
    if (!customer?.id) throw new Error("Product owner/customer record not found.");

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
      name: customer.name || customer.trading_name || "Product Owner",
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

function getInvoiceMode(productOwner) {
  const customerCode = normalize(
    productOwner?.customerCode || ""
  );

  if (customerCode === "zoy") {
    return "zoy";
  }

  if (customerCode === "bellstone") {
    return "bellstone";
  }

  return "standard";
}

  function validateSingleProductOwner(orders) {
    const ids = [...new Set(orders.map(order => String(order.customer_id || "")).filter(Boolean))];

    if (!ids.length) {
      throw new Error("Cannot create invoice: selected orders do not have a product owner/customer_id.");
    }

    if (ids.length > 1) {
      throw new Error("Cannot create one combined invoice for multiple product owners. Select only Bellstone orders or only Zoy orders.");
    }

    return ids[0];
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
      console.warn("Logo could not be loaded for invoice:", error.message);
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

  function drawHeader(doc, title, invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl) {
    const { company, paymentTermDays } = ctx;

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
    doc.text(title, 196, 34, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Invoice No: ${invoiceNumber}`, 196, 45, { align: "right" });
    doc.text(`Invoice Date: ${formatDate(invoiceDate)}`, 196, 52, { align: "right" });
    doc.text(`Due Date: ${formatDate(dueDate)}`, 196, 59, { align: "right" });
    doc.text(`Payment Terms: ${paymentTermDays} days`, 196, 66, { align: "right" });

    const infoY = logoAdded ? 53 : 43;

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

    if (company.registration) {
      doc.text(`Company No ${company.registration}`, 78, infoY + 23);
    }
  }

  function drawBillTo(doc, y, productOwner) {
    doc.setFillColor(248, 249, 251);
    doc.roundedRect(14, y - 6, 86, 56, 2, 2, "F");

    doc.setDrawColor(220, 224, 231);
    doc.roundedRect(14, y - 6, 86, 56, 2, 2);

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Bill To", 19, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);

    const addressLines = [
      productOwner.name,
      productOwner.address1,
      productOwner.address2,
      productOwner.city,
      productOwner.county,
      productOwner.postcode,
      productOwner.country,
      productOwner.vat ? `VAT No: ${productOwner.vat}` : ""
    ].filter(Boolean);

    let lineY = y + 8;

    addressLines.forEach(line => {
      if (lineY <= y + 42) {
        doc.text(cleanText(line), 19, lineY);
        lineY += 5;
      }
    });
  }

  function drawCostSummaryBox(
  doc,
  x,
  y,
  w,
  h,
  orders,
  totals,
  ctx
) {
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(x, y, w, h, 2, 2, "F");

  doc.setDrawColor(220, 224, 231);
  doc.roundedRect(x, y, w, h, 2, 2);

  setDark(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Invoice Overview", x + 5, y + 9);

  const isZoy = ctx.invoiceMode === "zoy";

  let rows;

  if (isZoy) {
    const logisticsServices = round2(
      totals.warehouse +
      totals.transport +
      totals.credits
    );

    rows = [
      [
        "Delivered orders",
        String(orders.length),
        false
      ],
      [
        "Logistics Services",
        formatMoney(logisticsServices),
        false
      ],
      [
        "Subtotal excl. VAT",
        formatMoney(totals.subtotal),
        false
      ],
      [
        `VAT ${Math.round(ctx.vatRate * 100)}%`,
        formatMoney(totals.vat),
        false
      ],
      [
        "Invoice total",
        formatMoney(totals.total),
        true
      ]
    ];
  } else {
    const subtotalBeforeFuel = round2(
      totals.serviceSubtotal +
      totals.minimumDeliverySurcharge
    );

    const fuelLabel =
      `Fuel surcharge ${formatNumber(
        totals.fuelSurchargePercent,
        1
      )}%`;

    rows = [
      [
        "Delivered orders",
        String(orders.length),
        false
      ],
      [
        "Warehouse costs",
        formatMoney(totals.warehouse),
        false
      ],
      [
        "Transport costs",
        formatMoney(totals.transport),
        false
      ],
      ...(totals.credits !== 0
        ? [[
            "Credit notes",
            formatMoney(totals.credits),
            false
          ]]
        : []),
      ...(totals.minimumDeliverySurcharge > 0
        ? [[
            "Minimum Delivery Charge",
            formatMoney(
              totals.minimumDeliverySurcharge
            ),
            false
          ]]
        : []),
      [
        "Subtotal excl. VAT",
        formatMoney(subtotalBeforeFuel),
        false
      ],
      [
        fuelLabel,
        formatMoney(totals.fuelSurcharge),
        false
      ],
      [
        `VAT ${Math.round(ctx.vatRate * 100)}%`,
        formatMoney(totals.vat),
        false
      ],
      [
        "Invoice total",
        formatMoney(totals.total),
        true
      ]
    ];
  }

  let rowY = y + 19;

  rows.forEach(([label, value, bold]) => {
    doc.setFont(
      "helvetica",
      bold ? "bold" : "normal"
    );

    doc.setFontSize(
      bold ? 9.4 : 8.3
    );

    doc.text(
      label,
      x + 5,
      rowY
    );

    doc.text(
      value,
      x + w - 6,
      rowY,
      { align: "right" }
    );

    rowY += bold ? 7 : 6.5;
  });
}


  function drawPaymentDetails(doc, y, company) {
    doc.setFillColor(248, 249, 251);
    doc.roundedRect(14, y - 6, 182, 58, 2, 2, "F");

    doc.setDrawColor(220, 224, 231);
    doc.roundedRect(14, y - 6, 182, 58, 2, 2);

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Payment Details", 19, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const note = splitText(doc, company.paymentNote || FALLBACK_COMPANY.paymentNote, 160);
    doc.text(note.slice(0, 2), 19, y + 9);

    const rows = [
      ["Company Name", company.bankCompanyName || company.name],
      ["Bank Name", company.bankName],
      ["Sort Code", company.sortCode],
      ["Account No.", company.accountNo],
      ["IBAN", company.iban],
      ["BIC / SWIFT", company.bic]
    ].filter(row => cleanText(row[1]));

    let rowY = y + 23;

    rows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, 19, rowY);

      doc.setFont("helvetica", "normal");
      doc.text(splitText(doc, value, 110).slice(0, 1), 58, rowY);

      rowY += 6;
    });
  }

  function drawPageOne(doc, orders, invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl) {
    const totals = getTotals(orders, ctx.vatRate, ctx.fuelSurchargePercent, ctx);

    drawHeader(doc, "Invoice", invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);
    drawBillTo(doc, 92, ctx.productOwner);
    drawCostSummaryBox(doc, 110, 86, 86, 70, orders, totals, ctx);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setDark(doc);
    doc.text("Invoice Notes", 14, 170);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
   doc.text("A detailed order specification is attached on the next page.", 14, 179);

if (totals.minimumDeliverySurcharge > 0) {
  doc.setFontSize(8);
  doc.text(
    "* Fuel surcharge is calculated on transport charges only and is not applied to warehouse costs or any Minimum Delivery Charge.",
    14,
    186
  );
  doc.setFontSize(9);
}
}

 function drawSpecificationHeader(
  doc,
  y,
  ctx
) {
  doc.setFillColor(245, 245, 245);
  doc.rect(14, y - 6, 182, 10, "F");

  setDark(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);

  doc.text(
    "Order / Ref",
    COL.order,
    y
  );

  doc.text(
    "Retailer",
    COL.retailer,
    y
  );

  doc.text(
    "Delivery Address",
    COL.address,
    y
  );

  doc.text(
    "Delivery Date",
    COL.date,
    y
  );

  doc.text(
    "Packages",
    COL.amount,
    y
  );

  if (ctx.invoiceMode === "zoy") {
    doc.text(
      "Logistics Services",
      COL.transport - 8,
      y
    );

    doc.text(
      "Total",
      COL.total + 2,
      y
    );
  } else {
    doc.text(
      "Warehouse",
      COL.warehouse,
      y
    );

    doc.text(
      "Transport",
      COL.transport,
      y
    );

    doc.text(
      "Total",
      COL.total + 2,
      y
    );
  }

  doc.setDrawColor(80, 80, 80);
  doc.line(14, y + 4, 196, y + 4);

  return y + 10;
}

  function drawSpecificationTotalsBlock(
  doc,
  y,
  totals,
  ctx
) {
  if (y > 230) {
    return null;
  }

  doc.setDrawColor(80, 80, 80);
  doc.line(14, y, 196, y);

  y += 10;

  const labelX = 138;
  const valueX = 194;
  const isZoy = ctx.invoiceMode === "zoy";

  setDark(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);

  doc.text(
    "Specification Total",
    labelX,
    y
  );

  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  if (isZoy) {
    const logisticsServices = round2(
      totals.warehouse +
      totals.transport +
      totals.credits
    );

    doc.text(
      "Logistics Services",
      labelX,
      y
    );

    doc.text(
      formatMoney(logisticsServices),
      valueX,
      y,
      { align: "right" }
    );

    y += 7;

    doc.setFont("helvetica", "bold");

    doc.text(
      "Subtotal",
      labelX,
      y
    );

    doc.text(
      formatMoney(totals.subtotal),
      valueX,
      y,
      { align: "right" }
    );

    return y + 10;
  }

  doc.text(
    "Warehouse Costs",
    labelX,
    y
  );

  doc.text(
    formatMoney(totals.warehouse),
    valueX,
    y,
    { align: "right" }
  );

  y += 7;

  doc.text(
    "Transport Costs",
    labelX,
    y
  );

  doc.text(
    formatMoney(totals.transport),
    valueX,
    y,
    { align: "right" }
  );

  if (totals.minimumDeliverySurcharge > 0) {
    y += 7;

    doc.text(
      "Minimum Delivery Charge",
      labelX,
      y
    );

    doc.text(
      formatMoney(
        totals.minimumDeliverySurcharge
      ),
      valueX,
      y,
      { align: "right" }
    );
  }

  y += 7;

  doc.setFont("helvetica", "bold");

  const specificationSubtotal = round2(
    totals.serviceSubtotal +
    totals.minimumDeliverySurcharge
  );

  doc.text(
    "Subtotal",
    labelX,
    y
  );

  doc.text(
    formatMoney(specificationSubtotal),
    valueX,
    y,
    { align: "right" }
  );

  return y + 10;
}

function drawMinimumDeliverySurchargeRows(
  doc,
  y,
  ctx,
  orders = []
) {
  /*
   * Alleen chargeable orders mogen een
   * Minimum Delivery Charge op de
   * specificatie tonen.
   */
  const chargeableOrders =
    (orders || []).filter(order =>
      isChargeableOrder(order)
    );

  /*
   * Bestaat de factuur alleen uit gratis
   * orders, dan tonen we helemaal geen
   * Minimum Delivery Charge-regels.
   */
  if (!chargeableOrders.length) {
    return y;
  }

  const chargeableOrderNumbers =
    getChargeableOrderNumbers(
      chargeableOrders
    );

  /*
   * Filter dezelfde surcharges als bij de
   * berekening van de factuurtotalen.
   */
  const surcharges =
    (
      ctx.deliverySurcharges ||
      []
    ).filter(group => {
      const linkedOrderNumber =
        normalize(
          group.order_number ||
          ""
        );

      /*
       * Zonder ordernummer mag de surcharge
       * blijven staan wanneer minimaal één
       * chargeable order aanwezig is.
       */
      if (!linkedOrderNumber) {
        return true;
      }

      return chargeableOrderNumbers.has(
        linkedOrderNumber
      );
    });

  if (!surcharges.length) {
    return y;
  }

  surcharges.forEach(group => {
if (y > 258) {
  doc.addPage();

  y =
    drawSpecificationHeader(
      doc,
      88,
      ctx
    );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(6.5);
}

    const postcode =
      cleanText(
        group.delivery_postcode ||
        ""
      );

    const readyVolume =
      toNumber(
        group.ready_volume_m3,
        0
      );

    const minimumVolume =
      toNumber(
        group.minimum_volume_m3,
        1.25
      );

    const shortfall =
      toNumber(
        group.shortfall_m3,
        Math.max(
          0,
          minimumVolume -
          readyVolume
        )
      );

const surcharge =
  toNumber(
    group.applied_surcharge,
    0
  );

    setDark(doc);

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(6.5);

    doc.text(
      group.order_number ||
      "Minimum",
      COL.order,
      y
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.text(
      "Min. Delivery",
      COL.retailer,
      y
    );

    doc.text(
      splitText(
        doc,
        `Planned: ${formatNumber(
          readyVolume,
          2
        )} / ${formatNumber(
          minimumVolume,
          2
        )} m³
Shortfall: ${formatNumber(
          shortfall,
          2
        )} m³
${postcode}`,
        54
      ),
      COL.address,
      y
    );

    doc.text(
      "—",
      COL.date,
      y
    );

    doc.text(
      "—",
      COL.amount,
      y
    );

    doc.text(
      formatMoney(0),
      COL.warehouse,
      y
    );

    doc.text(
      formatMoney(surcharge),
      COL.transport,
      y
    );

    doc.text(
      formatMoney(surcharge),
      COL.total,
      y
    );

    y += 15;
  });

  return y;
}

  function drawSpecificationPage(doc, orders, invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl) {
  doc.addPage();

  drawHeader(doc, "Specification", invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);

  let y = 88;
  y = drawSpecificationHeader(
  doc,
  y,
  ctx
);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);

  orders.forEach(order => {
    if (y > 258) {
      doc.addPage();
      drawHeader(doc, "Specification", invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);
      y = drawSpecificationHeader(
  doc,
  88,
  ctx
);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
    }

    const orderNo = getOrderNumber(order);
    const supplierRef = getSupplierReference(order);
const orderRefLines = supplierRef
  ? [orderNo, supplierRef]
  : [orderNo];
      const retailer = getRetailerName(order);
      const address = getDeliveryAddress(order);
      const deliveryDate = formatDate(getDeliveryDate(order));
      const amount = getDeliveredColli(order);
      const warehouse = getOrderWarehouseTotal(order);
      const transport = getOrderTransportTotal(order);
      const total = getOrderTotal(order);

      const retailerLines = splitText(doc, retailer, 23);
      const addressLines = splitText(doc, address, 54);

      const rowHeight = Math.max(8, retailerLines.length * 3.8, addressLines.length * 3.8);

      setDark(doc);
doc.setFont("helvetica", "bold");
doc.text(orderRefLines[0], COL.order, y);

if (orderRefLines[1]) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.text(orderRefLines[1], COL.order, y + 4);
  doc.setFontSize(6.5);
}

doc.setFont("helvetica", "normal");

if (orderRefLines[1]) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.text(orderRefLines[1], COL.order, y + 4);
  doc.setFontSize(6.5);
}
      doc.text(retailerLines, COL.retailer, y);
      doc.text(addressLines, COL.address, y);
      doc.text(deliveryDate, COL.date, y);
      doc.text(String(amount), COL.amount, y);
if (ctx.invoiceMode === "zoy") {
  const logisticsServices = round2(
    warehouse +
    transport
  );

  doc.text(
    formatMoney(logisticsServices),
    COL.transport - 8,
    y
  );

  doc.text(
    formatMoney(total),
    COL.total,
    y
  );
} else {
  doc.text(
    formatMoney(warehouse),
    COL.warehouse,
    y
  );

  doc.text(
    formatMoney(transport),
    COL.transport,
    y
  );

  doc.text(
    formatMoney(total),
    COL.total,
    y
  );
}

      y += rowHeight;
       });

    y = drawMinimumDeliverySurchargeRows(
  doc,
  y,
  ctx,
  orders
);

    y += 7;

    const totals = getTotals(orders, ctx.vatRate, ctx.fuelSurchargePercent, ctx);

    if (y > 230) {
      doc.addPage();
      drawHeader(doc, "Specification", invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);
      y = 82;
    }

    drawSpecificationTotalsBlock(
  doc,
  y,
  totals,
  ctx
);
  }

  async function createPdfBlob(orders, invoiceNumber, ctx) {
    if (!window.jspdf?.jsPDF) {
      throw new Error("jsPDF is not loaded. Add jsPDF before invoice-generator.js in the HTML.");
    }

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const invoiceDate = new Date();
    const dueDate = addDays(invoiceDate, ctx.paymentTermDays);
    const logoDataUrl = await urlToDataUrl(ctx.company.logoUrl);

    drawPageOne(doc, orders, invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);
    drawSpecificationPage(doc, orders, invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);
    drawFooter(doc, ctx.company);

    return doc.output("blob");
  }

  async function uploadPdf(client, companyId, invoiceNumber, blob) {
    const fileName = `${safeFilePart(invoiceNumber)}.pdf`;
    const storagePath = `${companyId}/invoices/${fileName}`;

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

  async function createInvoiceRecord(client, companyId, orders, invoiceNumber, uploaded, ctx) {
    const totals = getTotals(orders, ctx.vatRate, ctx.fuelSurchargePercent, ctx);
    const customerId = ctx.productOwner.id;
    const invoiceDate = new Date();
    const dueDate = addDays(invoiceDate, ctx.paymentTermDays);

    const { data, error } = await client
      .from("invoices")
      .insert({
        company_id: companyId,
        customer_id: customerId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate.toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
        subtotal: totals.subtotal,
        vat_amount: totals.vat,
        total_amount: totals.total,
        storage_path: uploaded.storagePath,
        file_url: uploaded.fileUrl,
        status: "generated"
      })
      .select("id")
      .single();

    if (error) throw error;
    return data.id;
  }

  async function createInvoiceOrderLinks(client, invoiceId, orders) {
    const rows = orders.map(order => ({
      invoice_id: invoiceId,
      order_id: order.id
    }));

    const { error } = await client
      .from("invoice_orders")
      .insert(rows);

    if (error) throw error;
  }

  async function upsertInvoiceDocumentPerOrder(client, companyId, invoiceNumber, uploaded, orders) {
    for (const order of orders) {
      const existingInvoiceDoc = (order.order_documents || []).find(doc =>
        normalize(doc.document_type) === "invoice"
      );

      const payload = {
        company_id: companyId,
        customer_id: order.customer_id || null,
        order_id: order.id,
        document_type: "invoice",
        document_number: invoiceNumber,
        document_status: "generated",
        file_url: uploaded.fileUrl,
        storage_path: uploaded.storagePath,
        customer_visible: true,
        updated_at: new Date().toISOString()
      };

      if (existingInvoiceDoc?.id) {
        const { error } = await client
          .from("order_documents")
          .update(payload)
          .eq("id", existingInvoiceDoc.id);

        if (error) throw error;
      } else {
        const { error } = await client
          .from("order_documents")
          .insert({
            ...payload,
            created_at: new Date().toISOString()
          });

        if (error) throw error;
      }
    }
  }

  async function updateOrdersAsInvoiced(client, orders) {
    const ids = orders.map(order => order.id);

    const { error } = await client
      .from("orders")
      .update({
        finance_status: "invoice_generated",
        overall_status: "invoiced",
        last_activity_at: new Date().toISOString()
      })
      .in("id", ids);

    if (error) throw error;
  }

  async function createActivityRows(client, companyId, orders, invoiceNumber) {
    const rows = orders.map(order => ({
      company_id: companyId,
      customer_id: order.customer_id || null,
      order_id: order.id,
      activity_type: "invoice_generated",
      old_status: order.finance_status || "not_invoiced",
      new_status: "invoice_generated",
      description: `Combined invoice ${invoiceNumber} generated`,
      created_by: "manual"
    }));

    const { error } = await client
      .from("order_activity_log")
      .insert(rows);

    if (error) {
      console.warn("Invoice activity log skipped:", error.message);
    }
  }

async function createInvoiceGeneratedNotification(
  client,
  companyId,
  orders,
  invoiceId,
  invoiceNumber,
  uploaded
) {
  try {
    const customerId = orders
      .map(order => order.customer_id)
      .find(Boolean) || null;

    if (!customerId) {
      console.warn(
        "Invoice notification skipped: no customer_id found."
      );
      return;
    }

    const orderNumbers = orders
      .map(order => cleanText(order.order_number || ""))
      .filter(Boolean);

    let orderText = "";

    if (orderNumbers.length === 1) {
      orderText = `order ${orderNumbers[0]}`;
    } else if (orderNumbers.length > 1) {
      orderText = `${orderNumbers.length} orders`;
    } else {
      orderText = "your orders";
    }

    const { error } = await client
      .from("system_notifications")
      .insert({
        company_id: companyId,
        customer_id: customerId,

        recipient_profile_id: null,
        recipient_role: null,

        notification_type: "invoice_generated",

        title: "New Invoice Available",

        message:
          `Invoice ${invoiceNumber} has been generated for ${orderText} and is now available.`,

        severity: "info",

        entity_type: "invoice",
        entity_id: invoiceId,

        action_url:
          uploaded?.fileUrl ||
          "./billing.html",

        is_read: false,
        popup_shown: false
      });

    if (error) {
      throw error;
    }

    console.log(
      "Invoice notification created:",
      invoiceNumber
    );
  } catch (error) {
    console.warn(
      "Invoice notification could not be created:",
      error.message
    );
  }
}

async function loadApprovedDeliverySurcharges(client, companyId, orders) {
  const orderIds = orders.map(order => String(order.id)).filter(Boolean);
  if (!orderIds.length) return [];

  const { data: groupOrders, error: groupOrdersError } = await client
    .from("delivery_group_orders")
    .select("delivery_group_id, order_id, order_number, group_role")
    .in("order_id", orderIds)
    .eq("group_role", "ready");

  if (groupOrdersError) throw groupOrdersError;

  const groupIds = [...new Set((groupOrders || []).map(row => row.delivery_group_id).filter(Boolean))];
  if (!groupIds.length) return [];

  const { data: groups, error: groupsError } = await client
    .from("delivery_groups")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "approved")
    .neq("invoice_status", "invoiced")
    .in("id", groupIds);

  if (groupsError) throw groupsError;

  return (groups || []).map(group => {
  const relatedOrder = (groupOrders || []).find(row =>
    String(row.delivery_group_id) === String(group.id)
  );

  return {
    ...group,
    order_number: relatedOrder?.order_number || ""
  };
});
}

async function markDeliverySurchargesInvoiced(client, invoiceId, surcharges) {
  const ids = (surcharges || []).map(row => row.id).filter(Boolean);
  if (!ids.length) return;

  const { error } = await client
    .from("delivery_groups")
    .update({
      invoice_status: "invoiced",
      invoice_id: invoiceId,
      updated_at: new Date().toISOString()
    })
    .in("id", ids);

  if (error) throw error;
}

  async function generate(orders, client, companyId) {
    if (!Array.isArray(orders) || !orders.length) {
      throw new Error("No orders selected for invoice.");
    }

    if (!client) {
      throw new Error("Supabase client is missing.");
    }

    if (!companyId) {
      throw new Error("Company ID is missing.");
    }

    const productOwnerId = validateSingleProductOwner(orders);
    const ctx = await loadCompanySettings(client, companyId);

ctx.productOwner = await loadProductOwnerProfile(
  client,
  productOwnerId
);

ctx.invoiceMode = getInvoiceMode(
  ctx.productOwner
);

if (ctx.invoiceMode === "zoy") {
  ctx.fuelSurchargePercent = 0;
  ctx.deliverySurcharges = [];
} else {
  ctx.deliverySurcharges =
    await loadApprovedDeliverySurcharges(
      client,
      companyId,
      orders
    );
}

const invoiceNumber = await reserveNextInvoiceNumber(
  client,
  companyId,
  ctx.invoicePrefix
);

    const blob = await createPdfBlob(orders, invoiceNumber, ctx);
    const uploaded = await uploadPdf(client, companyId, invoiceNumber, blob);

    if (!uploaded.fileUrl || !uploaded.storagePath) {
      throw new Error("Invoice PDF was uploaded, but no file URL/storage path was returned.");
    }

    const invoiceId = await createInvoiceRecord(client, companyId, orders, invoiceNumber, uploaded, ctx);

await createInvoiceOrderLinks(
  client,
  invoiceId,
  orders
);

await upsertInvoiceDocumentPerOrder(
  client,
  companyId,
  invoiceNumber,
  uploaded,
  orders
);

await updateOrdersAsInvoiced(
  client,
  orders
);

await createActivityRows(
  client,
  companyId,
  orders,
  invoiceNumber
);

await markDeliverySurchargesInvoiced(
  client,
  invoiceId,
  ctx.deliverySurcharges
);

await createInvoiceGeneratedNotification(
  client,
  companyId,
  orders,
  invoiceId,
  invoiceNumber,
  uploaded
);

return {
  invoiceId,
  invoiceNumber,
  ...uploaded
};
  }

  window.InvoiceGenerator = {
    generate
  };
})();