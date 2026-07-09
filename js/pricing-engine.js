(function () {
  "use strict";

  const DEFAULTS = {
    fuel_surcharge_percent: 8.5,
    surcharge_edinburgh_glasgow_percent: 20,
    surcharge_highlands_islands_percent: 40,
    pricing_include_fuel_on_ack: false
  };

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

  function getPercent(settings, key, fallback) {
    return toNumber(getSetting(settings, key, fallback), fallback);
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

  function isScotlandLowlands(postcode) {
  const pc = normalisePostcode(postcode);
  const area = getPostcodeArea(pc);

  return [
    "EH", // Edinburgh
    "G",  // Glasgow
    "ML",
    "KA",
    "PA",
    "FK",
    "KY",
    "DD",
    "PH",
    "DG",
    "TD"
  ].includes(area);
}

  function isHighlandsOrIslands(postcode) {
    const pc = normalisePostcode(postcode);
    const area = getPostcodeArea(pc);
    const district = getPostcodeDistrict(pc);

    if (["IV", "KW", "HS", "ZE"].includes(area)) return true;

    if (area === "AB") return true;

    if (area === "PA") {
      return district.number === null || district.number >= 20;
    }

    if (area === "PH") {
      return district.number === null || district.number >= 15;
    }

    if (area === "FK") {
      return district.number !== null && district.number >= 17;
    }

    if (area === "KA") {
      return district.number !== null && district.number >= 27;
    }

    return false;
  }

function getRegionalPricing(order, settings = {}) {
  const postcode = getOrderPostcode(order);

  const regionalEnabled = String(
    getSetting(settings, "regional_surcharge_enabled", "true")
  ).toLowerCase() !== "false";

  if (!regionalEnabled) {
    return {
      code: "standard",
      label: "Standard UK mainland",
      percent: 0,
      multiplier: 1,
      priceOnRequest: false,
      note: ""
    };
  }

  if (isNorthernIreland(order)) {
    return {
      code: "northern_ireland",
      label: "Northern Ireland",
      percent: 0,
      multiplier: 1,
      priceOnRequest: true,
      note: "Price on request for Northern Ireland."
    };
  }

  if (isRepublicOfIreland(order)) {
    return {
      code: "republic_of_ireland",
      label: "Republic of Ireland",
      percent: 0,
      multiplier: 1,
      priceOnRequest: true,
      note: "Price on request for Republic of Ireland."
    };
  }

  if (isHighlandsOrIslands(postcode)) {
    const percent = getPercent(
      settings,
      "surcharge_highlands_islands_percent",
      DEFAULTS.surcharge_highlands_islands_percent
    );

    return {
      code: "highlands_islands",
      label: "Highlands & Islands",
      percent,
      multiplier: 1 + percent / 100,
      priceOnRequest: false,
      note: `${percent}% regional surcharge for Highlands & Islands.`
    };
  }

  if (isScotlandLowlands(postcode)) {
    const percent = getPercent(
      settings,
      "surcharge_edinburgh_glasgow_percent",
      DEFAULTS.surcharge_edinburgh_glasgow_percent
    );

    return {
      code: "edinburgh_glasgow",
      label: "Edinburgh / Glasgow",
      percent,
      multiplier: 1 + percent / 100,
      priceOnRequest: false,
      note: `${percent}% regional surcharge for Edinburgh / Glasgow.`
    };
  }

  return {
    code: "standard",
    label: "Standard UK mainland",
    percent: 0,
    multiplier: 1,
    priceOnRequest: false,
    note: ""
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

  function calculateOrderPricing(order, settings = {}) {
    const regional = getRegionalPricing(order, settings);
    const lines = Array.isArray(order?.order_lines) ? order.order_lines : [];

    const warehouse = round2(lines.reduce((sum, line) => {
      return sum + getLineWarehouseCost(line);
    }, 0));

    const baseTransport = round2(lines.reduce((sum, line) => {
      return sum + getLineBaseTransportCost(line);
    }, 0));

    const transport = regional.priceOnRequest
      ? 0
      : round2(baseTransport * regional.multiplier);

    const regionalSurcharge = regional.priceOnRequest
      ? 0
      : round2(transport - baseTransport);

    const subtotalExFuel = round2(warehouse + transport);

    return {
      warehouse,
      baseTransport,
      regionalSurcharge,
      transport,
      subtotalExFuel,
      totalExFuel: subtotalExFuel,
      regional,
      priceOnRequest: regional.priceOnRequest,
      note: regional.note
    };
  }

  function calculateInvoicePricing(orders, settings = {}) {
    const vatRate = toNumber(
      getSetting(settings, "doc_vat_rate", 20),
      20
    ) / 100;

    const fuelPercent = getPercent(
      settings,
      "fuel_surcharge_percent",
      DEFAULTS.fuel_surcharge_percent
    );

    const orderPricings = (orders || []).map(order =>
      calculateOrderPricing(order, settings)
    );

    const warehouse = round2(orderPricings.reduce((sum, p) => sum + p.warehouse, 0));
    const transport = round2(orderPricings.reduce((sum, p) => sum + p.transport, 0));
    const regionalSurcharge = round2(orderPricings.reduce((sum, p) => sum + p.regionalSurcharge, 0));

    const subtotal = round2(warehouse + transport);
    const fuelSurcharge = round2(subtotal * (fuelPercent / 100));
    const vatBase = round2(subtotal + fuelSurcharge);
    const vat = round2(vatBase * vatRate);
    const total = round2(vatBase + vat);

    return {
      warehouse,
      transport,
      regionalSurcharge,
      subtotal,
      fuelPercent,
      fuelSurcharge,
      vatRate,
      vat,
      total,
      orderPricings,
      hasPriceOnRequest: orderPricings.some(p => p.priceOnRequest)
    };
  }

  window.VeynorPricing = {
    DEFAULTS,
    toNumber,
    round2,
    normalisePostcode,
    getRegionalPricing,
    calculateOrderPricing,
    calculateInvoicePricing,
    getLineWarehouseCost,
    getLineBaseTransportCost,
    getLineTransportCost,
    getLineTotal
  };
})();