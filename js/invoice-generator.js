(function () {
  "use strict";

  const DOCUMENT_BUCKET = "order-documents";
const DEFAULT_VAT_RATE = 0.20;
const DEFAULT_PAYMENT_TERM_DAYS = 14;
const DEFAULT_FUEL_SURCHARGE_PERCENT = 8.5;


const FALLBACK_COMPANY = {
  name: "",
  displayName: "",
  address: "",
  phone: "",
  email: "",
  vat: "",
  logoUrl: "",
  bankCompanyName: "",
  bankName: "",
  sortCode: "",
  accountNo: "",
  iban: "",
  bic: "",
  paymentNote:
    "Please make payments using the bank details shown on this invoice.",
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

  /*
   * De actuele tarieven op de order zijn leidend.
   *
   * Tarieven kunnen na het importeren van een order
   * worden aangepast. De order_lines kunnen daardoor
   * nog oude tarieven bevatten.
   */
  const hasOrderLevelTariffs =
    order.total_storage_tariff != null ||
    order.total_admin_tariff != null ||
    order.total_handling_tariff != null;

  if (hasOrderLevelTariffs) {
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
   * Alleen fallback voor oudere orders waarbij
   * geen actuele ordertotalen beschikbaar zijn.
   */
  return round2(
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

  /*
   * Het definitieve transporttarief op orderniveau
   * is leidend.
   *
   * Dit is belangrijk omdat een handmatige override
   * bijvoorbeeld transport bewust op £0.00 kan zetten.
   */
  if (
    order.total_transport_tariff !== null &&
    order.total_transport_tariff !== undefined &&
    order.total_transport_tariff !== ""
  ) {
    return round2(
      toNumber(
        order.total_transport_tariff,
        0
      )
    );
  }

  /*
   * Alleen fallback voor oudere orders waarbij
   * total_transport_tariff niet aanwezig is.
   */
  return round2(
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
}

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

// ============================================================
// WAREHOUSE-ONLY / EXTERNAL FDS TRANSPORT
// ============================================================

function isWarehouseOnlyFdsOrder(order) {
  const note = normalize(
    order?.internal_billing_note || ""
  );

  return (
    note === normalize(
      "Warehouse services only. Transport is invoiced separately by FDS."
    )
  );
}


function hasWarehouseOnlyFdsOrders(orders) {
  return (orders || []).some(order =>
    isWarehouseOnlyFdsOrder(order)
  );
}

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


/* ==========================================================
   VEYNOR — CENTRAL INVOICE PRICING CONTEXT
   Read-only calculation.
   ========================================================== */


/* ==========================================================
   VEYNOR — CENTRAL INVOICE PRICING CONTEXT
   Same regional settings approach as ACK Generator.
   ========================================================== */

async function prepareCentralInvoicePricing(
  orders,
  client,
  companyId,
  ctx
) {
  const engine = window.VeynorPricing;

  if (
    !engine ||
    typeof engine.calculateInvoicePricing !== "function" ||
    typeof engine.calculateOrderPricing !== "function"
  ) {
    throw new Error(
      "Veynor Pricing Engine v2.0 is not loaded."
    );
  }

  if (!(ctx?.pricingSettings instanceof Map)) {
    throw new Error(
      "Tenant pricing settings are not available."
    );
  }

  if (!ctx?.productOwner?.id) {
    throw new Error(
      "Product Owner information is missing."
    );
  }

  // Load current Product Owner billing configuration.
  const ownerSettings =
    await loadProductOwnerBillingSettings(
      client,
      companyId,
      ctx.productOwner
    );

  // Preserve Tenant Settings, with the same regional
  // overrides used by the ACK Generator.
  const settings = new Map(ctx.pricingSettings);

  const overrideKeys = [
    "regional_surcharge_enabled",
    "surcharge_edinburgh_glasgow_percent",
    "surcharge_highlands_islands_percent",
    "pricing_ireland_mode",
    "fuel_surcharge_percent"
  ];

  for (const key of overrideKeys) {
    const value = ownerSettings[key];

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      settings.set(key, value);
    }
  }

  // Regional zone definitions remain centrally
  // configured in Tenant Settings.
  const zones = settings.get("regional_pricing_zones");

  if (!zones) {
    throw new Error(
      "Regional Pricing Zones are missing."
    );
  }

  // Load approved Minimum Delivery Charges.
  const surcharges =
    ctx.invoiceMode === "zoy"
      ? []
      : await loadApprovedDeliverySurcharges(
          client,
          companyId,
          orders
        );

  // One shared calculation for all selected orders.
  const totals = engine.calculateInvoicePricing(
    orders,
    settings,
    ownerSettings,
    surcharges
  );

  // Keep the individual order calculations available
  // for the PDF specification.
  const orderPricings = totals.orderPricings;

  if (
    !Array.isArray(orderPricings) ||
    orderPricings.length !== orders.length
  ) {
    throw new Error(
      "Central pricing returned invalid order results."
    );
  }

  return {
    ownerSettings,
    settings,
    surcharges,
    orderPricings,
    totals,
    pricingVersion: totals.pricingVersion
  };
}


/* ==========================================================
   VEYNOR — SHARED INVOICE TOTALS

   Test invoices: Central Pricing Engine v2.0
   Final invoices: Existing calculation until migration
   ========================================================== */

function getTotals(
  orders,
  vatRate,
  fuelSurchargePercent = DEFAULT_FUEL_SURCHARGE_PERCENT,
  ctx = {}
) {
  // Central calculation is prepared only for test
  // invoices at this stage.
  if (ctx.centralPricing?.totals) {
    const central = ctx.centralPricing.totals;

    if (
      !Array.isArray(central.orderPricings) ||
      central.orderPricings.length !== orders.length
    ) {
      throw new Error(
        "Central invoice pricing is incomplete."
      );
    }

    return central;
  }

  // Legacy calculation for definitive invoices.
  const normalOrders = orders.filter(
    order => !isCreditOrder(order)
  );

  const creditOrders = orders.filter(
    order => isCreditOrder(order)
  );

  const warehouse = round2(
    normalOrders.reduce(
      (sum, order) =>
        sum + getOrderWarehouseTotal(order),
      0
    )
  );

  const transport = round2(
    normalOrders.reduce(
      (sum, order) =>
        sum + getOrderTransportTotal(order),
      0
    )
  );

  const credits = round2(
    creditOrders.reduce(
      (sum, order) =>
        sum + getOrderTotal(order),
      0
    )
  );

  const minimumDeliverySurcharge =
    getDeliverySurchargeTotal(ctx, orders);

  const serviceSubtotal = round2(
    warehouse + transport + credits
  );

  const fuelBase = round2(
    normalOrders.reduce((sum, order) => {
      if (
        normalize(order.order_type) === "manual_charge" ||
        normalize(order.source_type) === "manual_charge"
      ) {
        return sum;
      }

      return sum + getOrderTransportTotal(order);
    }, 0)
  );

  const usedFuelPercent =
    toNumber(fuelSurchargePercent, 0);

  const fuelSurcharge = round2(
    fuelBase * usedFuelPercent / 100
  );

  const subtotal = round2(
    serviceSubtotal +
    fuelSurcharge +
    minimumDeliverySurcharge
  );

  const vat = round2(
    subtotal * toNumber(vatRate, 0)
  );

  return {
    warehouse,
    transport,
    credits,
    minimumDeliverySurcharge,
    serviceSubtotal,
    fuelSurchargePercent: usedFuelPercent,
    fuelSurcharge,
    subtotal,
    vatBase: subtotal,
    vat,
    total: round2(subtotal + vat)
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
    throw new Error(
      "Cannot load invoice settings: " + error.message
    );
  }

  const map = new Map(
    (data || []).map(row => [
      row.setting_key,
      row.setting_value
    ])
  );

  const setting = (key, fallback = "") => {
    const value = map.get(key);
    return value === null ||
      value === undefined ||
      value === ""
      ? fallback
      : value;
  };

  const company = {
    name: setting(
      "main_company_name",
      FALLBACK_COMPANY.name
    ),
    displayName: setting(
      "main_display_name",
      FALLBACK_COMPANY.displayName
    ),
    registration: setting(
      "main_company_registration"
    ),
    address: setting(
      "main_address",
      FALLBACK_COMPANY.address
    ),
    phone: setting(
      "main_phone",
      FALLBACK_COMPANY.phone
    ),
    email: setting(
      "main_email",
      FALLBACK_COMPANY.email
    ),
    vat: setting(
      "main_vat",
      FALLBACK_COMPANY.vat
    ),
    logoUrl: setting(
      "main_logo_url",
      FALLBACK_COMPANY.logoUrl
    ),
    bankCompanyName: setting(
      "bank_company_name",
      setting("main_company_name", FALLBACK_COMPANY.name)
    ),
    bankName: setting(
      "bank_name",
      FALLBACK_COMPANY.bankName
    ),
    sortCode: setting(
      "bank_sort_code",
      FALLBACK_COMPANY.sortCode
    ),
    accountNo: setting(
      "bank_account_no",
      FALLBACK_COMPANY.accountNo
    ),
    iban: setting("bank_iban"),
    bic: setting("bank_bic"),
    paymentNote: setting(
      "invoice_payment_note",
      FALLBACK_COMPANY.paymentNote
    ),
    footerText: setting("document_footer_text")
  };

  const vatRate = toNumber(
    setting(
      "tax_default_vat_rate",
      setting("doc_vat_rate", DEFAULT_VAT_RATE)
    ),
    DEFAULT_VAT_RATE
  );

  const paymentTermDays = Math.round(
    toNumber(
      setting(
        "default_payment_terms_days",
        setting(
          "doc_default_payment_terms",
          DEFAULT_PAYMENT_TERM_DAYS
        )
      ),
      DEFAULT_PAYMENT_TERM_DAYS
    )
  );

  return {
    company,
    vatRate,
    paymentTermDays,
    invoicePrefix: setting("invoice_prefix", "INV"),
    fuelSurchargePercent: toNumber(
      setting(
        "fuel_surcharge_percent",
        DEFAULT_FUEL_SURCHARGE_PERCENT
      ),
      DEFAULT_FUEL_SURCHARGE_PERCENT
    ),
    pricingSettings: map
  };
}


async function loadProductOwnerProfile(
  client,
  customerId,
  companyId
) {
  if (!client || !companyId || !customerId) {
    throw new Error(
      "Client, tenant or Product Owner ID is missing."
    );
  }

  const { data: customer, error: customerError } =
    await client
      .from("customers")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", customerId)
      .maybeSingle();

  if (customerError) throw customerError;

  if (!customer?.id) {
    throw new Error(
      "Product Owner not found within the active tenant."
    );
  }

  const { data: addresses, error: addressError } =
    await client
      .from("customer_addresses")
      .select("*")
      .eq("customer_id", customerId)
      .order("is_default", {
        ascending: false
      })
      .limit(1);

  if (addressError) throw addressError;

  const address = addresses?.[0] || null;

  return {
    id: customer.id,
    name:
      customer.name ||
      customer.trading_name ||
      "Product Owner",
    customerCode: customer.customer_code || "",
    vat: customer.vat_number || customer.vat || "",
    email:
      customer.billing_email ||
      customer.email ||
      "",
    address1:
      address?.street ||
      customer.address1 ||
      customer.address_1 ||
      "",
    address2:
      address?.address2 ||
      customer.address2 ||
      customer.address_2 ||
      "",
    city: address?.city || customer.city || "",
    county: address?.county || customer.county || "",
    postcode:
      address?.postal_code ||
      address?.postcode ||
      customer.postcode ||
      "",
    country:
      address?.country ||
      customer.country ||
      ""
  };
}


/* ==========================================================
   VEYNOR — LOAD PRODUCT OWNER BILLING SETTINGS
   ========================================================== */

async function loadProductOwnerBillingSettings(
  client,
  companyId,
  productOwner
) {
  if (!productOwner?.id) {
    throw new Error("Product Owner is missing.");
  }

  const { data, error } = await client
    .from("settings")
    .select("setting_value")
    .eq("company_id", companyId)
    .eq("setting_key", "product_owner_profiles")
    .maybeSingle();

  if (error) {
    throw new Error(
      "Cannot load Product Owner billing settings: " +
      error.message
    );
  }

  if (!data?.setting_value) {
    throw new Error(
      "Product Owner profiles are not configured."
    );
  }

  let profiles;

  try {
    profiles =
      typeof data.setting_value === "string"
        ? JSON.parse(data.setting_value)
        : data.setting_value;
  } catch {
    throw new Error(
      "Invalid Product Owner profiles configuration."
    );
  }

  if (!Array.isArray(profiles)) {
    throw new Error(
      "Product Owner profiles must be an array."
    );
  }

  const customerCode = String(
    productOwner.customerCode || ""
  ).trim().toLowerCase();

  if (!customerCode) {
    throw new Error(
      "Product Owner has no customer code."
    );
  }

  const matches = profiles.filter(profile =>
    String(profile.key || "")
      .trim()
      .toLowerCase() === customerCode
  );

  if (matches.length !== 1) {
    throw new Error(
      "Cannot uniquely match Product Owner settings for " +
      customerCode +
      ". Check Settings > Product Owners."
    );
  }

  return {
    ...matches[0]
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


/* ==========================================================
   VEYNOR — INVOICE COST SUMMARY
   Central totals with regional surcharge breakdown.
   ========================================================== */

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
  const central = !!ctx.centralPricing;
  const isZoy = ctx.invoiceMode === "zoy";

  const regionalAmount = central
    ? round2(totals.regionalSurcharge || 0)
    : 0;

  const rows = [];

  rows.push([
    "Delivered orders",
    String(orders.length),
    false
  ]);

  if (isZoy) {
    rows.push([
      "Logistics Services",
      formatMoney(
        totals.warehouse +
        totals.transport +
        totals.credits
      ),
      false
    ]);
  } else {
    rows.push([
      "Warehouse costs",
      formatMoney(totals.warehouse),
      false
    ]);

    rows.push([
      "Transport costs",
      formatMoney(totals.transport),
      false
    ]);

    if (regionalAmount !== 0) {
      rows.push([
        "Incl. regional surcharge",
        formatMoney(regionalAmount),
        false
      ]);
    }

    if (totals.credits !== 0) {
      rows.push([
        "Credit notes",
        formatMoney(totals.credits),
        false
      ]);
    }

    if (totals.minimumDeliverySurcharge !== 0) {
      rows.push([
        "Minimum Delivery Charge",
        formatMoney(
          totals.minimumDeliverySurcharge
        ),
        false
      ]);
    }
  }

  const subtotalBeforeFuel = round2(
    totals.serviceSubtotal +
    totals.minimumDeliverySurcharge
  );


rows.push([
  isZoy
    ? "Subtotal excl. VAT"
    : "Subtotal before fuel surcharge",
  formatMoney(
    isZoy
      ? totals.subtotal
      : subtotalBeforeFuel
  ),
  false
]);

  if (!isZoy) {
    rows.push([
      `Fuel surcharge ${formatNumber(
        totals.fuelSurchargePercent || 0,
        1
      )}%`,
      formatMoney(totals.fuelSurcharge),
      false
    ]);
  }

  rows.push([
    `VAT ${Math.round(ctx.vatRate * 100)}%`,
    formatMoney(totals.vat),
    false
  ]);

  rows.push([
    "Invoice total",
    formatMoney(totals.total),
    true
  ]);

  // Expand vertically for the additional regional row.
  const requiredHeight = 22 + rows.length * 6.5;
  const boxHeight = Math.max(h, requiredHeight);

  doc.setFillColor(248, 249, 251);
  doc.roundedRect(x, y, w, boxHeight, 2, 2, "F");

  doc.setDrawColor(220, 224, 231);
  doc.roundedRect(x, y, w, boxHeight, 2, 2);

  setDark(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  doc.text(
    "Invoice Overview",
    x + 5,
    y + 9
  );

  let rowY = y + 19;

  rows.forEach(([label, value, bold]) => {
    doc.setFont(
      "helvetica",
      bold ? "bold" : "normal"
    );

    doc.setFontSize(bold ? 9.2 : 8);

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

    rowY += 6.5;
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

 function drawPageOne(
  doc,
  orders,
  invoiceNumber,
  invoiceDate,
  dueDate,
  ctx,
  logoDataUrl
) {
  const totals = getTotals(
    orders,
    ctx.vatRate,
    ctx.fuelSurchargePercent,
    ctx
  );

  const hasExternalFdsTransport =
    hasWarehouseOnlyFdsOrders(orders);

  drawHeader(
    doc,
    "Invoice",
    invoiceNumber,
    invoiceDate,
    dueDate,
    ctx,
    logoDataUrl
  );

  drawBillTo(
    doc,
    92,
    ctx.productOwner
  );

  drawCostSummaryBox(
    doc,
    110,
    86,
    86,
    70,
    orders,
    totals,
    ctx
  );


  // ==========================================================
  // INVOICE NOTES
  // ==========================================================

  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setFontSize(11);

  setDark(doc);

  doc.text(
    "Invoice Notes",
    14,
    170
  );


  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(9);

  doc.text(
    "A detailed order specification is attached on the next page.",
    14,
    179
  );


  let noteY = 186;


  // ==========================================================
  // FDS WAREHOUSE-ONLY NOTE
  // ==========================================================

  if (hasExternalFdsTransport) {

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(8.5);

    doc.text(
      "Warehouse services only:",
      14,
      noteY
    );


    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(8.5);

    const fdsNote =
      "For the applicable orders, transport is invoiced separately by FDS. " +
      "Please see the specification for details.";

    const fdsNoteLines =
      splitText(
        doc,
        fdsNote,
        170
      );

    doc.text(
      fdsNoteLines,
      14,
      noteY + 5
    );

    noteY +=
      5 +
      (fdsNoteLines.length * 4) +
      3;
  }


  // ==========================================================
  // FUEL SURCHARGE NOTE
  // ==========================================================

  if (
    totals.minimumDeliverySurcharge > 0
  ) {

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(8);

    const fuelNote =
      "* Fuel surcharge is calculated on transport charges only " +
      "and is not applied to warehouse costs or any Minimum Delivery Charge.";

    const fuelNoteLines =
      splitText(
        doc,
        fuelNote,
        170
      );

    doc.text(
      fuelNoteLines,
      14,
      noteY
    );


    doc.setFontSize(9);
  }

  // ==========================================================
  // PAYMENT DETAILS — TENANT CONFIGURATION
  // ==========================================================

  drawPaymentDetails(
    doc,
    224,
    ctx.company
  );
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


/* ==========================================================
   VEYNOR — MINIMUM DELIVERY SPECIFICATION
   Show only surcharges included in central totals.
   ========================================================== */

function drawMinimumDeliverySurchargeRows(
  doc,
  y,
  ctx,
  orders = []
) {
  const central = ctx.centralPricing || null;

  const surcharges = central
    ? (
        central.totals
          ?.appliedDeliverySurcharges || []
      )
    : (
        ctx.deliverySurcharges || []
      ).filter(group => {
        const chargeable = getChargeableOrderNumbers(
          orders.filter(isChargeableOrder)
        );

        const linked = normalize(
          group.order_number || ""
        );

        return !linked || chargeable.has(linked);
      });

  if (!surcharges.length) return y;

  for (const group of surcharges) {
    if (y > 247) {
      doc.addPage();

      y = drawSpecificationHeader(
        doc,
        88,
        ctx
      );
    }

    const amount = round2(
      toNumber(group.applied_surcharge, 0)
    );

    if (amount === 0) continue;

    const readyVolume = toNumber(
      group.ready_volume_m3,
      0
    );

    const minimumVolume = toNumber(
      group.minimum_volume_m3,
      1.25
    );

    const shortfall = toNumber(
      group.shortfall_m3,
      Math.max(
        0,
        minimumVolume - readyVolume
      )
    );

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);

    doc.text(
      cleanText(group.order_number || "Minimum"),
      COL.order,
      y
    );

    doc.setFont("helvetica", "normal");

    doc.text(
      "Min. Delivery",
      COL.retailer,
      y
    );

    const description =
      `Planned: ${formatNumber(readyVolume, 2)} / ` +
      `${formatNumber(minimumVolume, 2)} m³\n` +
      `Shortfall: ${formatNumber(shortfall, 2)} m³\n` +
      cleanText(group.delivery_postcode || "");

    doc.text(
      splitText(doc, description, 54),
      COL.address,
      y
    );

    doc.text("—", COL.date, y);
    doc.text("—", COL.amount, y);

    doc.text(
      formatMoney(0),
      COL.warehouse,
      y
    );

    doc.text(
      formatMoney(amount),
      COL.transport,
      y
    );

    doc.text(
      formatMoney(amount),
      COL.total,
      y
    );

    y += 15;
  }

  return y;
}

function drawSpecificationPage(
  doc,
  orders,
  invoiceNumber,
  invoiceDate,
  dueDate,
  ctx,
  logoDataUrl
) {
  const central = ctx.centralPricing || null;
  const totals = getTotals(
    orders,
    ctx.vatRate,
    ctx.fuelSurchargePercent,
    ctx
  );

  const startPage = () => {
    doc.addPage();

    drawHeader(
      doc,
      "Specification",
      invoiceNumber,
      invoiceDate,
      dueDate,
      ctx,
      logoDataUrl
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);

    return drawSpecificationHeader(doc, 88, ctx);
  };

  let y = startPage();

  orders.forEach((order, index) => {
    const pricing = central
      ? central.orderPricings[index]
      : null;

    if (central && !pricing) {
      throw new Error(
        "Missing central pricing for " +
        getOrderNumber(order)
      );
    }

    const credit = isCreditOrder(order);

    const warehouse = pricing
      ? round2(pricing.warehouse)
      : getOrderWarehouseTotal(order);

    const transport = pricing
      ? round2(pricing.transport)
      : getOrderTransportTotal(order);

    const total = pricing
      ? round2(warehouse + transport)
      : getOrderTotal(order);

    const regionalAmount = pricing
      ? round2(pricing.regionalSurcharge)
      : 0;

    const regional = pricing?.regional || {};

    const orderNo = getOrderNumber(order);
    const supplierRef = getSupplierReference(order);

    const retailerLines = splitText(
      doc,
      getRetailerName(order),
      23
    );

    const addressLines = splitText(
      doc,
      getDeliveryAddress(order),
      54
    );

    const warehouseOnlyFds =
      isWarehouseOnlyFdsOrder(order);

    const showRegional =
      !!pricing &&
      !credit &&
      regionalAmount !== 0;

    const rowHeight = Math.max(
      9,
      retailerLines.length * 3.8,
      addressLines.length * 3.8,
      warehouseOnlyFds ? 8 : 0,
      supplierRef ? 9 : 0
    );

    const extraHeight = showRegional ? 11 : 0;

    if (y + rowHeight + extraHeight > 258) {
      y = startPage();
    }

    setDark(doc);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);

    doc.text(orderNo, COL.order, y);

    if (supplierRef) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.8);
      doc.text(
        supplierRef,
        COL.order,
        y + 4
      );
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);

    doc.text(
      retailerLines,
      COL.retailer,
      y
    );

    doc.text(
      addressLines,
      COL.address,
      y
    );

    doc.text(
      formatDate(getDeliveryDate(order)),
      COL.date,
      y
    );

    doc.text(
      String(getDeliveredColli(order)),
      COL.amount,
      y
    );

    if (ctx.invoiceMode === "zoy") {
      doc.text(
        formatMoney(total),
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

      if (warehouseOnlyFds) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.2);

        doc.text(
          "FDS",
          COL.transport,
          y
        );

        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.4);

        doc.text(
          "Separate",
          COL.transport,
          y + 3.6
        );
      } else {
        doc.text(
          formatMoney(transport),
          COL.transport,
          y
        );
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);

      doc.text(
        formatMoney(total),
        COL.total,
        y
      );
    }

    y += rowHeight;

    // Informational breakdown only.
    // Regional surcharge is already included
    // in the transport amount above.
    if (showRegional) {
      setMuted(doc);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6);

      const label =
        `${regional.label || "Regional"} ` +
        `surcharge (${formatNumber(
          regional.percent || 0,
          1
        )}%): ${formatMoney(regionalAmount)} ` +
        "included in transport";

      const noteLines = splitText(
        doc,
        label,
        165
      );

      doc.text(
        noteLines.slice(0, 2),
        COL.retailer,
        y + 2
      );

      y += Math.max(
        7,
        Math.min(noteLines.length, 2) * 3.2 + 2
      );

      setDark(doc);
      doc.setFont("helvetica", "normal");
    }
  });

  // Minimum Delivery Charges must come from
  // the same pricing result as the totals.
  y = drawMinimumDeliverySurchargeRows(
    doc,
    y,
    ctx,
    orders
  );

  y += 7;

  if (y > 230) {
    y = startPage();
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

	const invoiceDate = ctx.invoiceDate || new Date();
    const dueDate = addDays(invoiceDate, ctx.paymentTermDays);
    const logoDataUrl = await urlToDataUrl(ctx.company.logoUrl);

    drawPageOne(doc, orders, invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);
    drawSpecificationPage(doc, orders, invoiceNumber, invoiceDate, dueDate, ctx, logoDataUrl);
    drawFooter(doc, ctx.company);

    return doc.output("blob");
  }

 async function uploadPdf(
  client,
  companyId,
  invoiceNumber,
  blob
) {
  const now = new Date();

  const day =
    String(now.getDate()).padStart(2, "0");

  const month =
    String(now.getMonth() + 1).padStart(2, "0");

  const dateSuffix =
    `${day}-${month}`;

  const fileName =
    `${safeFilePart(invoiceNumber)}-${dateSuffix}.pdf`;

  const storagePath =
    `${companyId}/invoices/${fileName}`;

  const { error } =
    await client.storage
      .from(DOCUMENT_BUCKET)
      .upload(
        storagePath,
        blob,
        {
          contentType: "application/pdf",
          upsert: true,
          cacheControl: "0"
        }
      );

  if (error) {
    throw error;
  }

  const { data } =
    client.storage
      .from(DOCUMENT_BUCKET)
      .getPublicUrl(storagePath);

  return {
    storagePath,
    fileUrl:
      data?.publicUrl || ""
  };
}


/* ==========================================================
   VEYNOR — ATOMIC INVOICE DATABASE REGISTRATION
   ========================================================== */


/* ==========================================================
   VEYNOR — BUILD FINANCIAL INVOICE SNAPSHOTS
   Pricing Engine v2.0
   ========================================================== */

function buildInvoiceOrderSnapshots(orders, ctx) {
  const central = ctx?.centralPricing;
  const totals = central?.totals;
  const pricings = central?.orderPricings;

  if (
    !Array.isArray(orders) ||
    !orders.length ||
    !totals ||
    !Array.isArray(pricings) ||
    pricings.length !== orders.length
  ) {
    throw new Error(
      "Cannot build invoice snapshots: central pricing is incomplete."
    );
  }

  const money = value => {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
      throw new Error("Invalid financial snapshot amount.");
    }

    return Math.round((number + Number.EPSILON) * 100);
  };

  const percent = value => {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
      throw new Error("Invalid financial snapshot percentage.");
    }

    return number;
  };

  const isCredit = order =>
    normalize(order?.order_type) === "credit" ||
    order?.is_credit === true;

  const isManualCharge = order =>
    normalize(order?.order_type) === "manual_charge" ||
    normalize(order?.source_type) === "manual_charge";

  const rows = orders.map((order, index) => {
    const pricing = pricings[index];

    if (!order?.id || !pricing) {
      throw new Error(
        "Invoice snapshot has a missing order or pricing result."
      );
    }

    const credit = isCredit(order);

    const warehouse = money(pricing.warehouse);
    const baseTransport = money(pricing.baseTransport);
    const regional = money(pricing.regionalSurcharge);

    const transport = baseTransport + regional;

    const fuelEligible =
      !credit &&
      !isManualCharge(order) &&
      pricing.billing?.fuelEnabled !== false;

    return {
      order_id: order.id,
      warehouse,
      baseTransport,
      regional,
      transport,
      fuelEligible,
      fuel: 0,
      minimum: 0,
      vat: 0,
      credit,
      regionalPct: percent(pricing.regional?.percent),
      fuelPct: fuelEligible
        ? percent(totals.fuelSurchargePercent)
        : 0,
      pricingVersion:
        pricing.pricingVersion ||
        central.pricingVersion ||
        "2.0"
    };
  });

  /*
   * Allocate an invoice-level amount over eligible
   * orders while preserving the exact total in pence.
   */
  function allocatePence(totalPence, eligibleRows, weightFn, field) {
    if (!totalPence) return;

    if (!eligibleRows.length) {
      throw new Error(
        `Cannot allocate invoice ${field}: no eligible orders.`
      );
    }

    const sign = Math.sign(totalPence);
    const absoluteTotal = Math.abs(totalPence);

    const weights = eligibleRows.map(row =>
      Math.max(0, Math.abs(weightFn(row)))
    );

    const weightTotal = weights.reduce(
      (sum, weight) => sum + weight,
      0
    );

    const effectiveWeights = weightTotal > 0
      ? weights
      : weights.map(() => 1);

    const effectiveTotal = effectiveWeights.reduce(
      (sum, weight) => sum + weight,
      0
    );

    const allocations = effectiveWeights.map((weight, index) => {
      const exact = absoluteTotal * weight / effectiveTotal;
      const whole = Math.floor(exact);

      return {
        index,
        whole,
        fraction: exact - whole
      };
    });

    let remaining = absoluteTotal -
      allocations.reduce((sum, item) => sum + item.whole, 0);

    allocations.sort((a, b) =>
      b.fraction - a.fraction || a.index - b.index
    );

    for (let i = 0; i < remaining; i++) {
      allocations[i].whole += 1;
    }

    allocations.forEach(item => {
      eligibleRows[item.index][field] +=
        sign * item.whole;
    });
  }

  // Fuel surcharge: same eligible transport base as
  // the central Pricing Engine.
  const fuelRows = rows.filter(row => row.fuelEligible);

  allocatePence(
    money(totals.fuelSurcharge),
    fuelRows,
    row => row.transport,
    "fuel"
  );

  /*
   * Minimum Delivery Charges are allocated to
   * eligible orders linked to each delivery group.
   */
  const appliedGroups =
    totals.appliedDeliverySurcharges || [];

  const assignedGroupIds = new Set();

  for (const group of appliedGroups) {
    if (!group?.id) {
      throw new Error(
        "Minimum Delivery Charge has no group ID."
      );
    }

    const groupId = String(group.id);

    if (assignedGroupIds.has(groupId)) {
      continue;
    }

    assignedGroupIds.add(groupId);

    const groupAmount = money(group.applied_surcharge);

    if (!groupAmount) continue;

    const linkedIds = new Set(
      Array.isArray(group.order_ids)
        ? group.order_ids.map(String)
        : group.order_id
          ? [String(group.order_id)]
          : []
    );


const eligibleRows = rows.filter((row, index) =>
  linkedIds.has(String(row.order_id)) &&
  !row.credit &&
  orders[index]?.is_chargeable !== false &&
  pricings[index]?.billing?.transportEnabled === true
);

    if (!eligibleRows.length) {
      throw new Error(
        `No eligible snapshot orders for delivery group ${groupId}.`
      );
    }

    allocatePence(
      groupAmount,
      eligibleRows,
      row => row.transport,
      "minimum"
    );
  }

  /*
   * Check that the order components reconcile
   * with the central invoice subtotal.
   */
  const sum = field =>
    rows.reduce((total, row) => total + row[field], 0);

  const calculatedSubtotal =
    sum("warehouse") +
    sum("transport") +
    sum("fuel") +
    sum("minimum");

  if (calculatedSubtotal !== money(totals.subtotal)) {
    throw new Error(
      "Invoice snapshot subtotal does not match central pricing. " +
      `Expected ${money(totals.subtotal)} pence, ` +
      `calculated ${calculatedSubtotal} pence.`
    );
  }

  /*
   * Allocate VAT based on each order's net value.
   * Any rounding pennies are distributed so that
   * the snapshots match the final invoice exactly.
   */
  allocatePence(
    money(totals.vat),
    rows,
    row =>
      row.warehouse +
      row.transport +
      row.fuel +
      row.minimum,
    "vat"
  );

  const snapshots = rows.map(row => {
    const subtotal =
      row.warehouse +
      row.transport +
      row.fuel +
      row.minimum;

    const total = subtotal + row.vat;

    const pounds = pence =>
      Number((pence / 100).toFixed(2));

    return {
      order_id: row.order_id,

      warehouse_amount:
        pounds(row.warehouse),

      transport_base_amount:
        pounds(row.baseTransport),

      regional_surcharge_amount:
        pounds(row.regional),

      fuel_surcharge_amount:
        pounds(row.fuel),

      minimum_delivery_charge_amount:
        pounds(row.minimum),

      subtotal_ex_vat:
        pounds(subtotal),

      vat_amount:
        pounds(row.vat),

      total_inc_vat:
        pounds(total),

      regional_surcharge_pct:
        row.regionalPct,

      fuel_surcharge_pct:
        row.fuelPct,

      pricing_version:
        row.pricingVersion
    };
  });

  const sumSnapshots = field =>
    money(
      snapshots.reduce(
        (sum, row) => sum + row[field],
        0
      )
    );

  if (
    sumSnapshots("subtotal_ex_vat") !== money(totals.subtotal) ||
    sumSnapshots("vat_amount") !== money(totals.vat) ||
    sumSnapshots("total_inc_vat") !== money(totals.total)
  ) {
    throw new Error(
      "Financial snapshots do not reconcile with invoice totals."
    );
  }

  return snapshots;
}



/* ==========================================================
   VEYNOR — ATOMIC INVOICE REGISTRATION WITH SNAPSHOTS
   Pricing Engine v2.0
   ========================================================== */

async function createInvoiceAtomic(
  client,
  companyId,
  orders,
  invoiceNumber,
  uploaded,
  ctx,
  invoiceDate
) {
  if (!client || !companyId) {
    throw new Error(
      "Supabase client or company ID is missing."
    );
  }

  if (!Array.isArray(orders) || !orders.length) {
    throw new Error(
      "No orders supplied for invoice registration."
    );
  }

  if (!ctx?.centralPricing?.totals) {
    throw new Error(
      "Central Pricing Engine totals are missing."
    );
  }

  const totals = getTotals(
    orders,
    ctx.vatRate,
    ctx.fuelSurchargePercent,
    ctx
  );

  // Build the exact financial breakdown per order.
  const snapshots = buildInvoiceOrderSnapshots(
    orders,
    ctx
  );

  if (snapshots.length !== orders.length) {
    throw new Error(
      "Invoice snapshot count does not match order count."
    );
  }

  const dueDate = addDays(
    invoiceDate,
    ctx.paymentTermDays
  );

  const dateOnly = date => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");

  // Register invoice, order links, snapshots and
  // financial statuses in one database transaction.
  const { data, error } = await client.rpc(
    "create_order_invoice_with_snapshots",
    {
      p_company_id: companyId,
      p_customer_id: ctx.productOwner.id,
      p_invoice_number: invoiceNumber,
      p_invoice_date: dateOnly(invoiceDate),
      p_due_date: dateOnly(dueDate),
      p_subtotal: totals.subtotal,
      p_vat_amount: totals.vat,
      p_total_amount: totals.total,
      p_storage_path: uploaded.storagePath,
      p_file_url: uploaded.fileUrl,
      p_order_ids: orders.map(order => order.id),
      p_snapshots: snapshots
    }
  );

  if (error) {
    throw new Error(
      "Atomic invoice registration with snapshots failed: " +
      error.message
    );
  }

  if (!data) {
    throw new Error(
      "Atomic invoice registration returned no invoice ID."
    );
  }

  return data;
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


async function loadApprovedDeliverySurcharges(
  client,
  companyId,
  orders
) {
  const orderIds = [
    ...new Set(
      (orders || [])
        .map(order => String(order.id || ""))
        .filter(Boolean)
    )
  ];

  if (!orderIds.length) return [];

  const { data: groupOrders, error: linkError } =
    await client
      .from("delivery_group_orders")
      .select(
        "delivery_group_id, order_id, order_number, group_role"
      )
      .in("order_id", orderIds)
      .eq("group_role", "ready");

  if (linkError) throw linkError;

  const groupIds = [
    ...new Set(
      (groupOrders || [])
        .map(row => row.delivery_group_id)
        .filter(Boolean)
    )
  ];

  if (!groupIds.length) return [];

  const { data: groups, error: groupError } =
    await client
      .from("delivery_groups")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "approved")
      .neq("invoice_status", "invoiced")
      .in("id", groupIds);

  if (groupError) throw groupError;

  return (groups || []).map(group => {
    const links = (groupOrders || []).filter(row =>
      String(row.delivery_group_id) === String(group.id)
    );

    return {
      ...group,
      order_ids: [
        ...new Set(
          links.map(row => String(row.order_id))
        )
      ],
      order_number: links[0]?.order_number || ""
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


/* ==========================================================
   VEYNOR — TEST INVOICE
   Central Pricing Engine validation.
   No database writes or invoice number reservation.
   ========================================================== */

async function generateTestInvoice(
  orders,
  client,
  companyId
) {
  if (!Array.isArray(orders) || !orders.length) {
    throw new Error(
      "No orders selected for test invoice."
    );
  }

  if (!client || !companyId) {
    throw new Error(
      "Supabase client or company ID is missing."
    );
  }

  const productOwnerId =
    validateSingleProductOwner(orders);

  // Do not recalculate already invoiced orders.
  // Historical invoices must retain their saved values.
  await validateOrdersNotInvoiced(
    orders,
    client,
    companyId
  );

  const ctx = await loadCompanySettings(
    client,
    companyId
  );

ctx.productOwner =
  await loadProductOwnerProfile(
    client,
    productOwnerId,
    companyId
  );

  ctx.invoiceMode = getInvoiceMode(
    ctx.productOwner
  );

  // Calculate everything using Pricing Engine v2.0.
  const central = await prepareCentralInvoicePricing(
    orders,
    client,
    companyId,
    ctx
  );

  ctx.centralPricing = central;
  ctx.centralTotals = central.totals;
  ctx.deliverySurcharges =
    central.totals.appliedDeliverySurcharges;

  ctx.vatRate = central.totals.vatRate;
  ctx.fuelSurchargePercent =
    central.totals.fuelSurchargePercent;

  // Diagnostic output for comparison with the
  // existing invoice PDF calculation.
  console.table(
    orders.map((order, index) => {
      const pricing = central.orderPricings[index];

      return {
        order: order.order_number,
        postcode: order.delivery_postcode,
        warehouse: pricing.warehouse,
        baseTransport: pricing.baseTransport,
        regionalPercent:
          pricing.regional?.percent || 0,
        regionalSurcharge:
          pricing.regionalSurcharge,
        transport: pricing.transport,
        regionalZone:
          pricing.regional?.label || "Standard"
      };
    })
  );

  console.log(
    "Veynor Central Invoice Pricing:",
    central.totals
  );

  // Existing PDF rendering is deliberately retained
  // until the specification and totals are connected.
  // This prevents showing a partially converted invoice.
  const now = new Date();

  const testInvoiceNumber =
    "TEST-" +
    now.toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);

  const blob = await createPdfBlob(
    orders,
    testInvoiceNumber,
    ctx
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${testInvoiceNumber}.pdf`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  return {
    test: true,
    invoiceNumber: testInvoiceNumber,
    centralTotals: central.totals,
    pricingVersion: central.pricingVersion,
    pdfPricingMode: "central_v2"
  };
}

/* ==========================================================
   VEYNOR — INVOICE PROTECTION
   Check whether selected orders are already invoiced.
   ========================================================== */

async function validateOrdersNotInvoiced(
  orders,
  client,
  companyId
) {
  if (!Array.isArray(orders) || !orders.length) {
    throw new Error("No orders selected for invoicing.");
  }

  const orderIds = orders.map(order => order.id);

  if (orderIds.some(id => !id)) {
    throw new Error(
      "Cannot invoice: one or more orders have no valid ID."
    );
  }

  if (new Set(orderIds.map(String)).size !== orderIds.length) {
    throw new Error(
      "Cannot invoice: duplicate orders in selection."
    );
  }

  // Check current order status directly in Supabase.
  const { data: currentOrders, error: orderError } =
    await client
      .from("orders")
      .select("id, order_number, finance_status, overall_status")
      .eq("company_id", companyId)
      .in("id", orderIds);

  if (orderError) {
    throw new Error(
      "Cannot verify invoice status: " + orderError.message
    );
  }

  if ((currentOrders || []).length !== orderIds.length) {
    throw new Error(
      "One or more selected orders could not be verified."
    );
  }

  const invoicedStatuses = new Set([
    "invoice_generated",
    "invoiced",
    "paid",
    "partially_paid"
  ]);

  const blockedOrders = (currentOrders || []).filter(order => {
    const financeStatus = normalize(order.finance_status);
    const overallStatus = normalize(order.overall_status);

    return (
      invoicedStatuses.has(financeStatus) ||
      invoicedStatuses.has(overallStatus)
    );
  });

  if (blockedOrders.length) {
    const numbers = blockedOrders.map(
      order => order.order_number || order.id
    );

    throw new Error(
      "Invoice blocked. These orders are already invoiced: " +
      numbers.join(", ")
    );
  }

  // Check existing invoice-to-order relationships.
  const { data: invoiceLinks, error: linkError } =
    await client
      .from("invoice_orders")
      .select("order_id, invoice_id")
      .in("order_id", orderIds);

  if (linkError) {
    throw new Error(
      "Cannot verify existing invoices: " + linkError.message
    );
  }

  if (invoiceLinks?.length) {
    const linkedIds = new Set(
      invoiceLinks.map(link => String(link.order_id))
    );

    const numbers = orders
      .filter(order => linkedIds.has(String(order.id)))
      .map(order => order.order_number || order.id);

    throw new Error(
      "Invoice blocked. Existing invoice records found for: " +
      numbers.join(", ")
    );
  }

  // Check registered invoice documents as an extra safeguard.
  const { data: invoiceDocuments, error: documentError } =
    await client
      .from("order_documents")
      .select("order_id, document_number")
      .eq("company_id", companyId)
      .eq("document_type", "invoice")
      .in("order_id", orderIds);

  if (documentError) {
    throw new Error(
      "Cannot verify invoice documents: " +
      documentError.message
    );
  }

  if (invoiceDocuments?.length) {
    const numbers = [
      ...new Set(
        invoiceDocuments.map(
          doc => doc.document_number || doc.order_id
        )
      )
    ];

    throw new Error(
      "Invoice blocked. Invoice documents already exist: " +
      numbers.join(", ")
    );
  }

  return true;
}



/* ==========================================================
   VEYNOR — GENERATE FINAL INVOICE
   Protected against already invoiced orders.
   ========================================================== */


/* ==========================================================
   VEYNOR — GENERATE FINAL INVOICE
   Central Pricing Engine v2.0
   ========================================================== */


/* ==========================================================
   VEYNOR — GENERATE FINAL INVOICE
   Central Pricing Engine v2.0
   Atomic Supabase registration
   ========================================================== */

async function generate(orders, client, companyId) {
  if (!Array.isArray(orders) || !orders.length) {
    throw new Error("No orders selected for invoice.");
  }

  if (!client || !companyId) {
    throw new Error("Supabase client or Company ID missing.");
  }

  const productOwnerId = validateSingleProductOwner(orders);

  // 1. Initial protection
  await validateOrdersNotInvoiced(
    orders,
    client,
    companyId
  );

  // 2. Load company and Product Owner
  const ctx = await loadCompanySettings(
    client,
    companyId
  );

ctx.productOwner = await loadProductOwnerProfile(
  client,
  productOwnerId,
  companyId
);

  ctx.invoiceMode = getInvoiceMode(ctx.productOwner);

  // 3. Central pricing
  const central = await prepareCentralInvoicePricing(
    orders,
    client,
    companyId,
    ctx
  );

  ctx.centralPricing = central;
  ctx.centralTotals = central.totals;
  ctx.deliverySurcharges =
    central.totals.appliedDeliverySurcharges || [];

  ctx.vatRate = central.totals.vatRate;
  ctx.fuelSurchargePercent =
    central.totals.fuelSurchargePercent;

  const totals = getTotals(
    orders,
    ctx.vatRate,
    ctx.fuelSurchargePercent,
    ctx
  );

  for (const field of ["subtotal", "vat", "total"]) {
    if (!Number.isFinite(totals[field])) {
      throw new Error(
        `Invalid central invoice amount: ${field}`
      );
    }
  }

  if (
    round2(totals.subtotal + totals.vat) !==
    round2(totals.total)
  ) {
    throw new Error(
      "Invoice totals do not reconcile."
    );
  }

  // 4. Revalidate before invoice number reservation
  await validateOrdersNotInvoiced(
    orders,
    client,
    companyId
  );

  const invoiceNumber = await reserveNextInvoiceNumber(
    client,
    companyId,
    ctx.invoicePrefix
  );

  // 5. Use the same date for PDF and database
  const invoiceDate = new Date();
  ctx.invoiceDate = invoiceDate;

  // 6. Generate PDF
  const blob = await createPdfBlob(
    orders,
    invoiceNumber,
    ctx
  );

  // 7. Upload PDF
  const uploaded = await uploadPdf(
    client,
    companyId,
    invoiceNumber,
    blob
  );

  if (!uploaded.fileUrl || !uploaded.storagePath) {
    throw new Error(
      "Invoice PDF upload returned incomplete information."
    );
  }

  // 8. Atomic database registration
  let invoiceId;

  try {
    invoiceId = await createInvoiceAtomic(
      client,
      companyId,
      orders,
      invoiceNumber,
      uploaded,
      ctx,
      invoiceDate
    );
  } catch (error) {
    // The database transaction has not committed.
    // Remove only the PDF uploaded by this attempt.
    const { error: cleanupError } = await client.storage
      .from(DOCUMENT_BUCKET)
      .remove([uploaded.storagePath]);

    if (cleanupError) {
      console.error(
        "Invoice PDF cleanup failed:",
        cleanupError.message
      );
    }

    throw error;
  }

  // 9. The invoice is now registered in Supabase.
  // Follow-up operations must not create another invoice.
  const warnings = [];

  const runFollowUp = async (label, callback) => {
    try {
      await callback();
    } catch (error) {
      const message =
        `${label}: ${error?.message || String(error)}`;

      warnings.push(message);
      console.error(
        "Invoice post-registration warning:",
        message
      );
    }
  };

  // 10. Register PDF documents
  await runFollowUp(
    "Invoice documents",
    () => upsertInvoiceDocumentPerOrder(
      client,
      companyId,
      invoiceNumber,
      uploaded,
      orders
    )
  );

  // 11. Mark applied Minimum Delivery Charges
  await runFollowUp(
    "Minimum Delivery Charges",
    () => markDeliverySurchargesInvoiced(
      client,
      invoiceId,
      ctx.deliverySurcharges
    )
  );

  // 12. Activity history
  await runFollowUp(
    "Activity history",
    () => createActivityRows(
      client,
      companyId,
      orders,
      invoiceNumber
    )
  );

  // 13. Customer notification
  await runFollowUp(
    "Invoice notification",
    () => createInvoiceGeneratedNotification(
      client,
      companyId,
      orders,
      invoiceId,
      invoiceNumber,
      uploaded
    )
  );

  if (warnings.length) {
    console.warn(
      "Invoice registered, but follow-up actions need review:",
      warnings
    );
  }

  return {
    invoiceId,
    invoiceNumber,
    subtotal: totals.subtotal,
    vat: totals.vat,
    total: totals.total,
    pricingVersion: central.pricingVersion,
    registered: true,
    warnings,
    ...uploaded
  };
}

async function createClaimPdfBlob(claim, invoiceNumber, ctx) {
  if (!window.jspdf?.jsPDF) {
    throw new Error("jsPDF is not loaded.");
  }

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

const invoiceDate = ctx.invoiceDate || new Date();
  const dueDate = addDays(invoiceDate, ctx.paymentTermDays);
  const logoDataUrl = await urlToDataUrl(ctx.company.logoUrl);

  drawHeader(
    doc,
    "Invoice",
    invoiceNumber,
    invoiceDate,
    dueDate,
    ctx,
    logoDataUrl
  );

  // FDS address block
  drawBillTo(doc, 92, {
    name: "Furniture Delivery Solutions Limited",
    address1: "Hastingwood Industrial Park",
    address2: "",
    city: "Erdington",
    county: "Birmingham",
    postcode: "B24 9QR",
    country: "United Kingdom",
    vat: "GB 378861440"
  });

  const net = round2(toNumber(claim.amount, 0));
  const vat = round2(net * ctx.vatRate);
  const total = round2(net + vat);

  // Claim details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setDark(doc);
  doc.text("Damage Claim", 110, 92);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);

  let y = 103;

  const detailRows = [
    ["Quality Case", claim.caseNumber || "—"],
    ["Order", claim.orderNumber || "—"],
    ["Customer Reference", claim.externalReference || "—"],
    ["Carrier Reference", claim.carrierReference || "—"]
  ];

  detailRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, 110, y);

    doc.setFont("helvetica", "normal");
    doc.text(cleanText(value), 145, y);

    y += 7;
  });

  // Invoice line
  const tableY = 158;

  doc.setFillColor(245, 245, 245);
  doc.rect(14, tableY, 182, 10, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Description", 18, tableY + 6.5);
  doc.text("Qty", 135, tableY + 6.5);
  doc.text("Rate", 155, tableY + 6.5);
  doc.text("Amount", 194, tableY + 6.5, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);

  const description =
    claim.description ||
    `Damage claim ${claim.caseNumber || ""}`;

  const descriptionLines =
    splitText(doc, description, 108);

  doc.text(descriptionLines, 18, tableY + 18);
  doc.text("1", 135, tableY + 18);
  doc.text(formatMoney(net), 155, tableY + 18);
  doc.text(formatMoney(net), 194, tableY + 18, {
    align: "right"
  });

  // Totals
  let totalsY = tableY + 42;

  doc.setDrawColor(210, 210, 210);
  doc.line(125, totalsY - 5, 196, totalsY - 5);

  const totals = [
    ["Subtotal excl. VAT", net],
    [`VAT ${Math.round(ctx.vatRate * 100)}%`, vat],
    ["Invoice Total", total]
  ];

  totals.forEach(([label, value], index) => {
    const bold = index === totals.length - 1;

    doc.setFont(
      "helvetica",
      bold ? "bold" : "normal"
    );

    doc.text(label, 140, totalsY);
    doc.text(
      formatMoney(value),
      194,
      totalsY,
      { align: "right" }
    );

    totalsY += 8;
  });

  drawPaymentDetails(doc, 224, ctx.company);
  drawFooter(doc, ctx.company);

  return {
    blob: doc.output("blob"),
    subtotal: net,
    vat,
    total,
    invoiceDate,
    dueDate
  };
}


async function generateClaimInvoice(
  claim,
  client,
  companyId
) {
  if (!claim) {
    throw new Error(
      "Claim details are missing."
    );
  }

  if (!client) {
    throw new Error(
      "Supabase client is missing."
    );
  }

  if (!companyId) {
    throw new Error(
      "Company ID is missing."
    );
  }

  const amount =
    round2(
      toNumber(
        claim.amount,
        0
      )
    );

  if (amount <= 0) {
    throw new Error(
      "Claim amount must be greater than £0.00."
    );
  }


  // =========================================================
  // FIND FDS CUSTOMER / DEBTOR
  // =========================================================

  const {
    data: fdsCustomer,
    error: fdsError
  } = await client
    .from("customers")
    .select(`
      id,
      name,
      customer_code,
      customer_type,
      billing_email,
      vat_number
    `)
    .eq(
      "company_id",
      companyId
    )
    .eq(
      "customer_code",
      "FDS"
    )
    .eq(
      "is_active",
      true
    )
    .maybeSingle();


  if (fdsError) {
    throw fdsError;
  }


  if (!fdsCustomer?.id) {
    throw new Error(
      "FDS could not be found in customers."
    );
  }


  // =========================================================
  // COMPANY SETTINGS
  // =========================================================

  const ctx =
    await loadCompanySettings(
      client,
      companyId
    );


  // =========================================================
  // NEXT INVOICE NUMBER
  // =========================================================

  const invoiceNumber =
    await reserveNextInvoiceNumber(
      client,
      companyId,
      ctx.invoicePrefix
    );


  // =========================================================
  // CREATE PDF
  // =========================================================

  const pdf =
    await createClaimPdfBlob(
      {
        ...claim,
        amount
      },
      invoiceNumber,
      ctx
    );


  // =========================================================
  // UPLOAD PDF
  // =========================================================

  const uploaded =
    await uploadPdf(
      client,
      companyId,
      invoiceNumber,
      pdf.blob
    );


  if (
    !uploaded.fileUrl ||
    !uploaded.storagePath
  ) {
    throw new Error(
      "Claim invoice PDF was uploaded, but no file URL/storage path was returned."
    );
  }


  // =========================================================
  // CREATE INVOICE RECORD
  // =========================================================

  const {
    data: invoice,
    error: invoiceError
  } = await client
    .from("invoices")
    .insert({

      company_id:
        companyId,

      customer_id:
        fdsCustomer.id,

      invoice_number:
        invoiceNumber,

      invoice_date:
        pdf.invoiceDate
          .toISOString()
          .slice(0, 10),

      due_date:
        pdf.dueDate
          .toISOString()
          .slice(0, 10),

      subtotal:
        pdf.subtotal,

      vat_amount:
        pdf.vat,

      total_amount:
        pdf.total,

      storage_path:
        uploaded.storagePath,

      file_url:
        uploaded.fileUrl,

      status:
        "generated"
    })
    .select("id")
    .single();


  if (invoiceError) {
    throw invoiceError;
  }


  // =========================================================
  // LINK INVOICE TO QUALITY CASE
  // =========================================================

  if (!claim.qualityCaseId) {
    throw new Error(
      "Quality Case ID is missing."
    );
  }


  const {
    error: claimError
  } = await client
    .from("quality_cases")
    .update({

      claim_invoice_id:
        invoice.id,

      claim_invoiced_at:
        new Date()
          .toISOString()

    })
    .eq(
      "id",
      claim.qualityCaseId
    )
    .eq(
      "company_id",
      companyId
    );


  if (claimError) {
    throw claimError;
  }


  // =========================================================
  // RESULT
  // =========================================================

  return {

    invoiceId:
      invoice.id,

    invoiceNumber,

    customerId:
      fdsCustomer.id,

    customerName:
      fdsCustomer.name,

    subtotal:
      pdf.subtotal,

    vat:
      pdf.vat,

    total:
      pdf.total,

    ...uploaded
  };
}
window.InvoiceGenerator = {
  generate,
  generateTestInvoice,
  generateClaimInvoice
};

})();