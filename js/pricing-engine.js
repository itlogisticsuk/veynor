(function () {
  "use strict";

  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function round2(value) {
    return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalisePostcode(value) {
    return clean(value).toUpperCase().replace(/\s+/g, "");
  }

  function getSetting(settings, key, fallback = "") {
    if (!settings) return fallback;

    if (settings instanceof Map) {
      const value = settings.get(key);
      return value !== undefined && value !== null && String(value).trim() !== ""
        ? value
        : fallback;
    }

    const value = settings[key];
    return value !== undefined && value !== null && String(value).trim() !== ""
      ? value
      : fallback;
  }


function getPercent(settings, key) {
  const raw = getSetting(settings, key, "");

  if (String(raw).trim() === "") {
    throw new Error(
      `Pricing setting "${key}" is missing. ` +
      "Configure this value in Tenant Settings."
    );
  }

  const percent = Number(
    String(raw).trim().replace(",", ".")
  );

  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error(
      `Pricing setting "${key}" must be a valid ` +
      "non-negative percentage."
    );
  }

  return percent;
}

function getBooleanSetting(settings, key, fallback = false) {
  const raw = getSetting(settings, key, "");

  if (String(raw).trim() === "") {
    return fallback;
  }

  const value = String(raw).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(value)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(value)) {
    return false;
  }

  throw new Error(
    `Pricing setting "${key}" must be true or false.`
  );
}

function getVatRate(settings) {
  const raw = getSetting(settings, "doc_vat_rate", "");

  if (String(raw).trim() === "") {
    throw new Error(
      "VAT Rate is missing. Configure it in " +
      "Settings > Documents."
    );
  }

  const vatRate = Number(
    String(raw).trim().replace(",", ".")
  );

  if (
    !Number.isFinite(vatRate) ||
    vatRate < 0 ||
    vatRate > 1
  ) {
    throw new Error(
      "VAT Rate must be a decimal between 0 and 1. " +
      "For example, 0.20 means 20%."
    );
  }

  return vatRate;
}


  function getOrderPostcode(order) {
    return normalisePostcode(
      order?.delivery_postcode ||
      order?.ship_to_postcode ||
      order?.postcode ||
      order?.customer_postcode ||
      ""
    );
  }

  function getOrderCountry(order) {
    return clean(
      order?.delivery_country ||
      order?.ship_to_country ||
      order?.country ||
      "United Kingdom"
    ).toLowerCase();
  }

  function getPostcodeArea(postcode) {
    const pc = normalisePostcode(postcode);
    const match = pc.match(/^[A-Z]{1,2}/);
    return match ? match[0] : "";
  }

  function getPostcodeDistrict(postcode) {
    const pc = normalisePostcode(postcode);
    const match = pc.match(/^([A-Z]{1,2})(\d{1,2})/);
    if (!match) return { area: getPostcodeArea(pc), number: null };
    return { area: match[1], number: Number(match[2]) };
  }

  function isNorthernIreland(order) {
    const postcode = getOrderPostcode(order);
    const country = getOrderCountry(order);

    return (
      postcode.startsWith("BT") ||
      country.includes("northern ireland")
    );
  }

  function isRepublicOfIreland(order) {
    const country = getOrderCountry(order);

    return (
      country === "ireland" ||
      country.includes("republic of ireland") ||
      country.includes("eire")
    );
  }



/* =========================================================
   REGIONAL PRICING ZONES
   All postcode rules, priorities and percentages
   are configured per tenant in Supabase Settings.
   ========================================================= */

function getRegionalZones(settings) {
  const raw = getSetting(
    settings,
    "regional_pricing_zones",
    ""
  );

  if (!raw || String(raw).trim() === "") {
    throw new Error(
      "Regional Pricing Zones are missing. " +
      "Configure them in Settings > Pricing."
    );
  }

  let zones;

  try {
    zones = typeof raw === "string"
      ? JSON.parse(raw)
      : raw;
  } catch {
    throw new Error(
      "Regional Pricing Zones contain invalid JSON."
    );
  }

  if (!Array.isArray(zones) || zones.length === 0) {
    throw new Error(
      "Regional Pricing Zones must contain at least one zone."
    );
  }

  const ids = new Set();

  for (const zone of zones) {
    if (
      !zone ||
      typeof zone !== "object" ||
      Array.isArray(zone) ||
      typeof zone.id !== "string" ||
      !zone.id.trim() ||
      typeof zone.name !== "string" ||
      !zone.name.trim() ||
      typeof zone.enabled !== "boolean" ||
      !Number.isInteger(zone.priority) ||
      zone.priority < 0 ||
      typeof zone.surcharge_setting_key !== "string" ||
      !/^[a-z][a-z0-9_]*$/.test(
        zone.surcharge_setting_key
      ) ||
      !Array.isArray(zone.postcode_rules) ||
      !zone.postcode_rules.length ||
      !Array.isArray(zone.unknown_district_areas)
    ) {
      throw new Error(
        "Invalid Regional Pricing Zone configuration."
      );
    }

    if (ids.has(zone.id)) {
      throw new Error(
        `Duplicate Regional Pricing Zone ID: ${zone.id}`
      );
    }

    ids.add(zone.id);

    for (const rule of zone.postcode_rules) {
      if (
        typeof rule !== "string" ||
        !/^[A-Z]{1,2}(?:\d{1,2}\+)?$/.test(rule)
      ) {
        throw new Error(
          `Invalid postcode rule "${rule}" in ${zone.name}.`
        );
      }
    }

    for (const area of zone.unknown_district_areas) {
      if (
        typeof area !== "string" ||
        !/^[A-Z]{1,2}$/.test(area)
      ) {
        throw new Error(
          `Invalid unknown district area in ${zone.name}.`
        );
      }
    }

    if (zone.enabled) {
      getPercent(
        settings,
        zone.surcharge_setting_key
      );
    }
  }

  return zones
    .filter(zone => zone.enabled)
    .sort((a, b) => b.priority - a.priority);
}


/* =========================================================
   POSTCODE RULE MATCHING
   Examples:
   EH     = Entire EH postcode area
   PA20+  = PA districts 20 and higher
   ========================================================= */

function postcodeMatchesRule(postcode, rule) {
  const pc = normalisePostcode(postcode);

  if (!pc) return false;

  const match = rule.match(
    /^([A-Z]{1,2})(?:(\d{1,2})(\+))?$/
  );

  if (!match) {
    throw new Error(
      `Invalid postcode rule: ${rule}`
    );
  }

  const area = match[1];
  const minimumDistrict = match[2];

  if (getPostcodeArea(pc) !== area) {
    return false;
  }

  // Entire postcode area.
  if (minimumDistrict === undefined) {
    return true;
  }

  // District range, for example PA20+.
  const district = getPostcodeDistrict(pc);

  return (
    district.number !== null &&
    district.number >= Number(minimumDistrict)
  );
}


/* =========================================================
   ZONE MATCHING
   Includes configurable handling of postcodes
   without a recognisable district.
   ========================================================= */

function postcodeMatchesZone(postcode, zone) {
  const pc = normalisePostcode(postcode);

  if (!pc) return false;

  const district = getPostcodeDistrict(pc);

  // Unknown district exceptions take priority
  // when configured for this zone.
  if (
    district.number === null &&
    zone.unknown_district_areas.includes(
      district.area
    )
  ) {
    return true;
  }

  return zone.postcode_rules.some(rule =>
    postcodeMatchesRule(pc, rule)
  );
}


/* =========================================================
   REGIONAL PRICING
   No hardcoded Scotland postcode areas or percentages.
   ========================================================= */

function getRegionalPricing(order, settings = {}) {
  const standard = {
    code: "standard",
    label: "Standard",
    percent: 0,
    multiplier: 1,
    priceOnRequest: false,
    note: ""
  };

  // Regional surcharge must be explicitly configured.
  const regionalEnabledRaw = getSetting(
    settings,
    "regional_surcharge_enabled",
    ""
  );

  if (String(regionalEnabledRaw).trim() === "") {
    throw new Error(
      "Regional Surcharge Enabled is missing. " +
      "Configure it in Settings > Pricing."
    );
  }

  const regionalEnabled = getBooleanSetting(
    settings,
    "regional_surcharge_enabled"
  );

  if (!regionalEnabled) {
    return standard;
  }

  // Preserve existing Ireland pricing behaviour.
  if (
    isNorthernIreland(order) ||
    isRepublicOfIreland(order)
  ) {
    const mode = clean(
      getSetting(
        settings,
        "pricing_ireland_mode",
        ""
      )
    ).toLowerCase();

    if (
      !["price_on_request", "standard"].includes(mode)
    ) {
      throw new Error(
        "Invalid Ireland Pricing setting. " +
        "Configure it in Settings > Pricing."
      );
    }

    const northern = isNorthernIreland(order);

    const label = northern
      ? "Northern Ireland"
      : "Republic of Ireland";

    if (mode === "price_on_request") {
      return {
        code: northern
          ? "northern_ireland"
          : "republic_of_ireland",
        label,
        percent: 0,
        multiplier: 1,
        priceOnRequest: true,
        note: `Price on request for ${label}.`
      };
    }

    return {
      ...standard,
      code: northern
        ? "northern_ireland"
        : "republic_of_ireland",
      label
    };
  }

  // Load regional postcode zones from tenant settings.
  const zones = getRegionalZones(settings);

  const postcode = getOrderPostcode(order);

  if (!postcode) {
    throw new Error(
      "Cannot calculate regional pricing: " +
      "delivery postcode is missing."
    );
  }

  // Highest priority matching zone wins.
  const matchingZone = zones.find(zone =>
    postcodeMatchesZone(postcode, zone)
  );

  if (!matchingZone) {
    return standard;
  }

  const percent = getPercent(
    settings,
    matchingZone.surcharge_setting_key
  );

  return {
    code: matchingZone.id,
    label: matchingZone.name,
    percent,
    multiplier: 1 + percent / 100,
    priceOnRequest: false,
    note: percent > 0
      ? `${percent}% regional surcharge for ${matchingZone.name}.`
      : ""
  };
}


/* ==========================================================
   VEYNOR — PRODUCT OWNER BILLING CONFIGURATION
   ========================================================== */

function parseBillingBoolean(value, fallback = true) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") return value;

  const text = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(text)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(text)) {
    return false;
  }

  throw new Error(
    `Invalid billing setting: ${String(value)}`
  );
}


/* ==========================================================
   VEYNOR — PRODUCT OWNER BILLING CONFIGURATION
   Current settings for uninvoiced orders.
   Locked settings for invoiced orders.
   ========================================================== */

function getOrderBillingConfiguration(
  order,
  productOwner = {}
) {
  const owner = productOwner || {};

  const financeStatus = String(
    order?.finance_status || ""
  ).trim().toLowerCase();

  const overallStatus = String(
    order?.overall_status || ""
  ).trim().toLowerCase();

  const invoicedStatuses = new Set([
    "invoice_generated",
    "invoiced",
    "paid",
    "partially_paid"
  ]);

  const isInvoiced =
    invoicedStatuses.has(financeStatus) ||
    invoicedStatuses.has(overallStatus) ||
    order?.invoice_billing_config_source === "locked";

  // For already invoiced orders, use their stored values.
  // Never apply new Product Owner settings.
  const warehouseValue = isInvoiced
    ? order?.invoice_warehouse_enabled
    : owner.invoice_warehouse_enabled ??
      order?.invoice_warehouse_enabled;

  const transportValue = isInvoiced
    ? order?.invoice_transport_enabled
    : owner.invoice_transport_enabled ??
      order?.invoice_transport_enabled;

  const warehouseEnabled = parseBillingBoolean(
    warehouseValue,
    true
  );

  const transportEnabled = parseBillingBoolean(
    transportValue,
    true
  );

  // Regional and fuel switches follow the Product Owner
  // for uninvoiced orders. Invoiced orders must be read
  // from their stored invoice snapshot instead.
  const regionalEnabled =
    transportEnabled &&
    parseBillingBoolean(
      owner.regional_surcharge_enabled,
      true
    );

  const fuelEnabled =
    transportEnabled &&
    parseBillingBoolean(
      owner.fuel_surcharge_enabled,
      true
    );

  return {
    warehouseEnabled,
    transportEnabled,
    regionalEnabled,
    fuelEnabled,
    chargeable: order?.is_chargeable !== false,
    isInvoiced,
    pricingVersion: "2.0"
  };
}

  function getLineWarehouseCost(line) {
    return round2(
      toNumber(line?.tariff_storage, 0) +
      toNumber(line?.tariff_admin, 0) +
      toNumber(line?.tariff_handling, 0)
    );
  }

  function getLineBaseTransportCost(line) {
    return round2(toNumber(line?.tariff_transport, 0));
  }

  function getLineTransportCost(line, regionalPricing) {
    if (regionalPricing?.priceOnRequest) return 0;
    return round2(getLineBaseTransportCost(line) * (regionalPricing?.multiplier || 1));
  }

  function getLineTotal(line, regionalPricing) {
    return round2(
      getLineWarehouseCost(line) +
      getLineTransportCost(line, regionalPricing)
    );
  }


/* ==========================================================
   VEYNOR — CENTRAL ORDER PRICING
   Pricing Engine v2.0
   ========================================================== */

function calculateOrderPricing(
  order,
  settings = {},
  productOwner = {}
) {
  const billing = getOrderBillingConfiguration(
    order,
    productOwner
  );

  const emptyRegional = {
    code: "standard",
    label: "Standard",
    percent: 0,
    multiplier: 1,
    priceOnRequest: false,
    note: ""
  };

  if (!billing.chargeable) {
    return {
      warehouse: 0,
      baseTransport: 0,
      regionalSurcharge: 0,
      transport: 0,
      subtotalExFuel: 0,
      totalExFuel: 0,
      regional: {
        ...emptyRegional,
        code: "free_of_charge",
        label: "Free of charge"
      },
      priceOnRequest: false,
      note: "Free of charge order.",
      billing,
      pricingVersion: "2.0"
    };
  }

  const lines = Array.isArray(order?.order_lines)
    ? order.order_lines
    : [];

  const calculatedWarehouse = round2(
    lines.reduce(
      (sum, line) => sum + getLineWarehouseCost(line),
      0
    )
  );

  const calculatedTransport = round2(
    lines.reduce(
      (sum, line) => sum + getLineBaseTransportCost(line),
      0
    )
  );

  const hasWarehouseTotals = [
    order?.total_storage_tariff,
    order?.total_admin_tariff,
    order?.total_handling_tariff
  ].some(value => value !== null && value !== undefined);

  const hasTransportTotal =
    order?.total_transport_tariff !== null &&
    order?.total_transport_tariff !== undefined &&
    order?.total_transport_tariff !== "";

  const operationalWarehouse = hasWarehouseTotals
    ? round2(
        toNumber(order.total_storage_tariff, 0) +
        toNumber(order.total_admin_tariff, 0) +
        toNumber(order.total_handling_tariff, 0)
      )
    : calculatedWarehouse;

  const operationalTransport = hasTransportTotal
    ? round2(toNumber(order.total_transport_tariff, 0))
    : calculatedTransport;

  // The Product Owner switch determines what is
  // invoiceable, not the underlying operational tariff.
  const warehouse = billing.warehouseEnabled
    ? operationalWarehouse
    : 0;

  const baseTransport = billing.transportEnabled
    ? operationalTransport
    : 0;

  // Use existing postcode and zone logic.
  // Disable regional pricing without modifying settings.
  const regionalSettings = settings instanceof Map
    ? new Map(settings)
    : { ...settings };

  if (!billing.regionalEnabled) {
    if (regionalSettings instanceof Map) {
      regionalSettings.set(
        "regional_surcharge_enabled",
        "false"
      );
    } else {
      regionalSettings.regional_surcharge_enabled = "false";
    }
  }

  const regional = billing.transportEnabled
    ? getRegionalPricing(order, regionalSettings)
    : emptyRegional;

  const transport = regional.priceOnRequest
    ? 0
    : round2(baseTransport * regional.multiplier);

  const regionalSurcharge = round2(
    transport - baseTransport
  );

  const subtotalExFuel = round2(
    warehouse + transport
  );

  return {
    warehouse,
    baseTransport,
    regionalSurcharge,
    transport,
    subtotalExFuel,
    totalExFuel: subtotalExFuel,
    operationalWarehouse,
    operationalTransport,
    regional,
    priceOnRequest: regional.priceOnRequest,
    note: regional.note,
    billing,
    pricingVersion: "2.0"
  };
}


/* ==========================================================
   VEYNOR — CENTRAL INVOICE PRICING
   Pricing Engine v2.0

   Shared calculation for:
   - Operations Control Center
   - Invoice Generator
   - Billing
   ========================================================== */


/* ==========================================================
   VEYNOR — CENTRAL INVOICE PRICING v2.0

   Shared financial calculation for:
   - Operations Control Center
   - Invoice Generator
   - Billing

   Historical invoices must use saved invoice data.
   ========================================================== */

function calculateInvoicePricing(
  orders,
  settings = {},
  productOwner = {},
  deliverySurcharges = []
) {
  if (!Array.isArray(orders) || !orders.length) {
    throw new Error("No orders supplied for pricing.");
  }

  if (!Array.isArray(deliverySurcharges)) {
    throw new Error(
      "Delivery surcharges must be an array."
    );
  }

  const round = round2;

  // ========================================================
  // 1. HISTORICAL INVOICE PROTECTION
  // ========================================================

  const invoicedStatuses = new Set([
    "invoice_generated",
    "invoiced",
    "paid",
    "partially_paid"
  ]);

  const alreadyInvoiced = orders.filter(order => {
    const finance = clean(
      order.finance_status
    ).toLowerCase();

    const overall = clean(
      order.overall_status
    ).toLowerCase();

    return (
      invoicedStatuses.has(finance) ||
      invoicedStatuses.has(overall)
    );
  });

  if (alreadyInvoiced.length) {
    throw new Error(
      "Historical invoices must use their saved " +
      "invoice records, not live pricing. Orders: " +
      alreadyInvoiced.map(
        order => order.order_number || order.id
      ).join(", ")
    );
  }

  // ========================================================
  // 2. TENANT SETTINGS
  // ========================================================

  const vatRate = getVatRate(settings);

  const fuelEnabledRaw = getSetting(
    settings,
    "fuel_surcharge_enabled",
    ""
  );

  if (String(fuelEnabledRaw).trim() === "") {
    throw new Error(
      "Fuel Surcharge Enabled is missing in Settings."
    );
  }

  const tenantFuelEnabled = getBooleanSetting(
    settings,
    "fuel_surcharge_enabled"
  );

  const fuelPercent = tenantFuelEnabled
    ? getPercent(settings, "fuel_surcharge_percent")
    : 0;

  // ========================================================
  // 3. CALCULATE EACH ORDER
  // ========================================================

  const orderPricings = orders.map(order =>
    calculateOrderPricing(
      order,
      settings,
      productOwner
    )
  );

  if (orderPricings.some(p => p.priceOnRequest)) {
    throw new Error(
      "One or more orders have transport pricing " +
      "marked as Price on Request."
    );
  }

  const isCredit = order =>
    clean(order.order_type).toLowerCase() === "credit" ||
    order.is_credit === true;

  const normalIndexes = [];
  const creditIndexes = [];

  orders.forEach((order, index) => {
    if (isCredit(order)) {
      creditIndexes.push(index);
    } else {
      normalIndexes.push(index);
    }
  });

  // ========================================================
  // 4. WAREHOUSE AND TRANSPORT
  // ========================================================

  const warehouse = round(
    normalIndexes.reduce(
      (sum, index) =>
        sum + orderPricings[index].warehouse,
      0
    )
  );

  const transport = round(
    normalIndexes.reduce(
      (sum, index) =>
        sum + orderPricings[index].transport,
      0
    )
  );

  const regionalSurcharge = round(
    normalIndexes.reduce(
      (sum, index) =>
        sum + orderPricings[index].regionalSurcharge,
      0
    )
  );

  // Credit values retain their stored sign.
  // Do not automatically reverse negative values.
  const credits = round(
    creditIndexes.reduce(
      (sum, index) =>
        sum +
        orderPricings[index].warehouse +
        orderPricings[index].transport,
      0
    )
  );

  // ========================================================
  // 5. FUEL SURCHARGE
  // ========================================================

  const fuelBase = round(
    normalIndexes.reduce((sum, index) => {
      const order = orders[index];
      const pricing = orderPricings[index];

      const manualCharge =
        clean(order.order_type).toLowerCase() ===
          "manual_charge" ||
        clean(order.source_type).toLowerCase() ===
          "manual_charge";

      if (
        manualCharge ||
        !tenantFuelEnabled ||
        !pricing.billing.fuelEnabled
      ) {
        return sum;
      }

      return sum + pricing.transport;
    }, 0)
  );

  const fuelSurcharge = round(
    fuelBase * fuelPercent / 100
  );

  // ========================================================
  // 6. MINIMUM DELIVERY SURCHARGES
  // ========================================================

  const orderIds = new Set(
    orders.map(order => String(order.id))
  );

  const seenGroups = new Set();
  const appliedDeliverySurcharges = [];

  let minimumDeliverySurcharge = 0;

  for (const group of deliverySurcharges) {
    if (!group?.id) {
      throw new Error(
        "Delivery group has no valid ID."
      );
    }

    const groupId = String(group.id);

    if (seenGroups.has(groupId)) {
      continue;
    }

    seenGroups.add(groupId);

    if (clean(group.status).toLowerCase() !== "approved") {
      continue;
    }

    if (
      clean(group.invoice_status).toLowerCase() ===
      "invoiced"
    ) {
      continue;
    }

    const amount = toNumber(
      group.applied_surcharge,
      0
    );

    if (amount === 0) continue;

    const linkedIds = Array.isArray(group.order_ids)
      ? group.order_ids.map(String)
      : group.order_id
        ? [String(group.order_id)]
        : [];

    if (!linkedIds.length) {
      throw new Error(
        `Delivery group ${groupId} has a surcharge ` +
        "but no linked order IDs."
      );
    }

    const eligible = orders.some(order => {
      if (!orderIds.has(String(order.id))) {
        return false;
      }

      if (!linkedIds.includes(String(order.id))) {
        return false;
      }

      if (isCredit(order)) return false;

      const billing = getOrderBillingConfiguration(
        order,
        productOwner
      );

      return (
        billing.chargeable &&
        billing.transportEnabled
      );
    });

    if (!eligible) continue;

    minimumDeliverySurcharge += amount;

    appliedDeliverySurcharges.push({
      ...group,
      applied_surcharge: amount
    });
  }

  minimumDeliverySurcharge = round(
    minimumDeliverySurcharge
  );

  // ========================================================
  // 7. FINAL TOTALS
  // ========================================================

  const serviceSubtotal = round(
    warehouse + transport + credits
  );

  const subtotal = round(
    serviceSubtotal +
    fuelSurcharge +
    minimumDeliverySurcharge
  );

  const vat = round(
    subtotal * vatRate
  );

  const total = round(
    subtotal + vat
  );

  // ========================================================
  // 8. RETURN SHARED FINANCIAL RESULT
  // ========================================================

  return {
    warehouse,
    transport,
    credits,
    regionalSurcharge,
    minimumDeliverySurcharge,
    appliedDeliverySurcharges,
    serviceSubtotal,
    subtotal,
    vatBase: subtotal,
    vatRate,
    vat,
    total,
    fuelPercent,
    fuelSurchargePercent: fuelPercent,
    fuelSurcharge,
    fuelBase,
    orderPricings,
    hasPriceOnRequest: false,
    pricingVersion: "2.0"
  };
}

window.VeynorPricing = {
  toNumber,
  round2,
  normalisePostcode,
  getRegionalPricing,
  getOrderBillingConfiguration,
  calculateOrderPricing,
  calculateInvoicePricing,
  getLineWarehouseCost,
  getLineBaseTransportCost,
  getLineTransportCost,
  getLineTotal,
  pricingVersion: "2.0"
};


})();