(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const GEOCODE_FUNCTION_NAME = "super-endpoint";
  const CANCELLED_ALLOCATION_STATUS = "cancelled";

  let client = null;
  let companyId = null;
  let allOrders = [];
  let filteredOrders = [];
  let selectedOrderId = null;
  let memoModalOrderId = null;

  const selectedIds = new Set();

  const sortState = {
    key: "order",
    direction: "asc"
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
  }

  function round3(value) {
    return Number(toNumber(value, 0).toFixed(3));
  }

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatMoney(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "£0.00";
    return `£${num.toLocaleString("en-GB", {
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

  function nowIso() {
    return new Date().toISOString();
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = "notice " + type;

    window.clearTimeout(window.__matchingToastTimer);
    window.__matchingToastTimer = window.setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6500);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function setProgress(open, pct = 0, text = "") {
    const wrap = byId("progressWrap") || byId("geocodeProgressBox");
    const bar = byId("progressBar") || byId("geocodeProgressBar");
    const textEl = byId("progressText") || byId("geocodeProgressText");
    const metaEl = byId("geocodeProgressMeta");

    if (wrap) wrap.classList.toggle("open", !!open);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (textEl) textEl.textContent = text || "";
    if (metaEl) metaEl.textContent = open ? `${pct}%` : "";
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    companyId = data.id;
    return companyId;
  }

  function hasCoordinates(order) {
    const lat = Number(order?.delivery_lat);
    const lng = Number(order?.delivery_lng);

    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= 49 &&
      lat <= 61 &&
      lng >= -9 &&
      lng <= 3
    );
  }

  function getAddressText(order) {
    return [
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_city,
      order.delivery_region,
      order.delivery_postcode,
      order.delivery_country
    ].filter(Boolean).join(", ") || "—";
  }

  function getMemo(order) {
    return String(order?.memo || "").trim();
  }

  function shortMemo(value, maxLength = 70) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function getLineSku(line) {
    return String(
      line?.sku_base ||
      line?.products?.sku_base ||
      line?.product_sku ||
      ""
    ).trim();
  }

  function getLineDescription(line) {
    return (
      line?.description ||
      line?.products?.description ||
      line?.products?.name ||
      "Unknown product"
    );
  }

  function getLineAllocations(line) {
    return (line.order_allocations || []).filter(a =>
      normalize(a.allocation_status) !== CANCELLED_ALLOCATION_STATUS
    );
  }

  function productVolume(product) {
    return toNumber(product?.volume_m3, 0);
  }

  function productWeight(product) {
    return toNumber(product?.weight_kg, 0);
  }

  function itemVolume(item, product) {
    return toNumber(item?.volume_m3, productVolume(product));
  }

  function itemWeight(item, product) {
    return toNumber(item?.weight_kg, productWeight(product));
  }

  function getTotalColli(order) {
    return (
      toNumber(order?.total_order_colli, 0) ||
      toNumber(order?.planning_colli, 0) ||
      (order.order_lines || []).reduce((sum, line) => sum + toNumber(line.quantity_ordered, 0), 0)
    );
  }

  function getMatchedColli(order) {
    return (
      toNumber(order?.matched_colli, 0) ||
      toNumber(order?.stats?.matched, 0)
    );
  }

  function getTotalVolume(order) {
    return (
      toNumber(order?.total_order_volume_m3, 0) ||
      toNumber(order?.planning_volume_m3, 0) ||
      toNumber(order?.volume_m3, 0) ||
      toNumber(order?.stats?.requestedVolume, 0)
    );
  }

  function getMatchedVolume(order) {
    return (
      toNumber(order?.matched_volume_m3, 0) ||
      toNumber(order?.stats?.allocatedVolume, 0)
    );
  }

  function getTotalWeight(order) {
    return (
      toNumber(order?.total_order_weight_kg, 0) ||
      toNumber(order?.weight_kg, 0) ||
      toNumber(order?.stats?.requestedWeight, 0)
    );
  }

  function getMatchedWeight(order) {
    return (
      toNumber(order?.matched_weight_kg, 0) ||
      toNumber(order?.stats?.allocatedWeight, 0)
    );
  }

  function getTotalCosts(order) {
    return {
      storage: toNumber(order?.total_storage_tariff, 0),
      admin: toNumber(order?.total_admin_tariff, 0),
      handling: toNumber(order?.total_handling_tariff, 0),
      transport: toNumber(order?.total_transport_tariff, 0),
      s2u: toNumber(order?.total_s2u_fees, 0),
      customer: toNumber(order?.total_customer_charge, 0)
    };
  }

  function calculateLineCosts(line, product) {
    const qty = toNumber(line.quantity_ordered, 0);

    const storageUnit = toNumber(product?.storage_tariff, 0);
    const adminUnit = toNumber(product?.admin_tariff, 0);
    const handlingUnit = toNumber(product?.handling_tariff, 0);
    const transportUnit = toNumber(product?.transport_tariff, 0);

    const storageTotal = qty * storageUnit;
    const adminTotal = qty * adminUnit;
    const handlingTotal = qty * handlingUnit;
    const transportTotal = qty * transportUnit;

    const s2uUnit = toNumber(product?.total_s2u_fees, 0);
    const customerUnit = toNumber(product?.total_customer_charge, 0);

    const s2uTotal = s2uUnit > 0
      ? qty * s2uUnit
      : storageTotal + adminTotal + handlingTotal;

    const customerTotal = customerUnit > 0
      ? qty * customerUnit
      : s2uTotal + transportTotal;

    return {
      tariff_storage: round2(storageTotal),
      tariff_admin: round2(adminTotal),
      tariff_handling: round2(handlingTotal),
      tariff_transport: round2(transportTotal),
      total_s2u_fees: round2(s2uTotal),
      total_customer_charge: round2(customerTotal)
    };
  }

  async function loadProductMapBySku(companyIdValue, orders) {
    const skus = new Set();

    (orders || []).forEach(order => {
      (order.order_lines || []).forEach(line => {
        const sku = getLineSku(line);
        if (sku) skus.add(sku);
      });
    });

    if (!skus.size) return new Map();

    const { data, error } = await client
      .from("products")
      .select(`
        id,
        company_id,
        customer_id,
        sku_base,
        name,
        description,
        volume_m3,
        weight_kg,
        net_weight_kg,
        storage_tariff,
        admin_tariff,
        handling_tariff,
        transport_tariff,
        total_s2u_fees,
        total_customer_charge
      `)
      .eq("company_id", companyIdValue)
      .in("sku_base", [...skus]);

    if (error) {
      console.warn("Product cost lookup skipped:", error.message);
      return new Map();
    }

    return new Map((data || []).map(row => [String(row.sku_base), row]));
  }

  function applyProductCostsToLoadedOrders(orders, productMap) {
    return (orders || []).map(order => {
      let totalStorage = 0;
      let totalAdmin = 0;
      let totalHandling = 0;
      let totalTransport = 0;
      let totalS2u = 0;
      let totalCustomer = 0;
      let totalWeight = 0;

      const lines = (order.order_lines || []).map(line => {
        const sku = getLineSku(line);
        const product = line.products || productMap.get(sku) || null;
        const qty = toNumber(line.quantity_ordered, 0);

        const unitWeight =
          toNumber(line.unit_weight_kg, 0) ||
          toNumber(product?.weight_kg, 0) ||
          toNumber(product?.net_weight_kg, 0);

        const lineWeight =
          toNumber(line.total_line_weight_kg, 0) ||
          qty * unitWeight;

        const existingCostTotal =
          toNumber(line.tariff_storage, 0) +
          toNumber(line.tariff_admin, 0) +
          toNumber(line.tariff_handling, 0) +
          toNumber(line.tariff_transport, 0) +
          toNumber(line.total_s2u_fees, 0) +
          toNumber(line.total_customer_charge, 0);

        const productCosts = product ? calculateLineCosts(line, product) : null;

        const costs = productCosts && existingCostTotal <= 0
          ? productCosts
          : {
              tariff_storage: toNumber(line.tariff_storage, productCosts?.tariff_storage || 0),
              tariff_admin: toNumber(line.tariff_admin, productCosts?.tariff_admin || 0),
              tariff_handling: toNumber(line.tariff_handling, productCosts?.tariff_handling || 0),
              tariff_transport: toNumber(line.tariff_transport, productCosts?.tariff_transport || 0),
              total_s2u_fees: toNumber(line.total_s2u_fees, productCosts?.total_s2u_fees || 0),
              total_customer_charge: toNumber(line.total_customer_charge, productCosts?.total_customer_charge || 0)
            };

        totalStorage += toNumber(costs.tariff_storage, 0);
        totalAdmin += toNumber(costs.tariff_admin, 0);
        totalHandling += toNumber(costs.tariff_handling, 0);
        totalTransport += toNumber(costs.tariff_transport, 0);
        totalS2u += toNumber(costs.total_s2u_fees, 0);
        totalCustomer += toNumber(costs.total_customer_charge, 0);
        totalWeight += toNumber(lineWeight, 0);

        return {
          ...line,
          product_id: line.product_id || product?.id || null,
          sku_base: sku || line.sku_base || null,
          description: getLineDescription(line),
          unit_weight_kg: unitWeight,
          total_line_weight_kg: lineWeight,
          products: product || line.products || null,
          ...costs
        };
      });

      return {
        ...order,
        order_lines: lines,

        total_order_weight_kg:
          toNumber(order.total_order_weight_kg, 0) ||
          round3(totalWeight),

        total_storage_tariff:
          toNumber(order.total_storage_tariff, 0) ||
          round2(totalStorage),

        total_admin_tariff:
          toNumber(order.total_admin_tariff, 0) ||
          round2(totalAdmin),

        total_handling_tariff:
          toNumber(order.total_handling_tariff, 0) ||
          round2(totalHandling),

        total_transport_tariff:
          toNumber(order.total_transport_tariff, 0) ||
          round2(totalTransport),

        total_s2u_fees:
          toNumber(order.total_s2u_fees, 0) ||
          round2(totalS2u),

        total_customer_charge:
          toNumber(order.total_customer_charge, 0) ||
          round2(totalCustomer)
      };
    });
  }

  function calculateOrderStats(order) {
    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];

    let required = 0;
    let matched = 0;
    let missingProductLines = 0;

    let requestedVolume = 0;
    let requestedWeight = 0;
    let allocatedVolume = 0;
    let allocatedWeight = 0;

    let totalStorage = 0;
    let totalAdmin = 0;
    let totalHandling = 0;
    let totalTransport = 0;
    let totalS2uFees = 0;
    let totalCustomerCharge = 0;

    const lineSummaries = lines.map(line => {
      const product = line.products || {};
      const qty = toNumber(line.quantity_ordered, 0);
      const allocs = getLineAllocations(line);
      const allocCount = allocs.length;
      const missing = Math.max(0, qty - allocCount);

      const sku = getLineSku(line);
      const hasLinkedProduct = Boolean(line.product_id || product.id || sku);

      if (!hasLinkedProduct) missingProductLines += 1;

      const lineRequestedVolume =
        toNumber(line.total_line_volume_m3, 0) ||
        toNumber(line.total_volume_m3, 0) ||
        qty * (
          toNumber(line.unit_volume_m3, 0) ||
          productVolume(product)
        );

      const lineRequestedWeight =
        toNumber(line.total_line_weight_kg, 0) ||
        qty * (
          toNumber(line.unit_weight_kg, 0) ||
          productWeight(product)
        );

      const lineAllocatedVolume = allocs.reduce((sum, alloc) => {
        const item = alloc.items || {};
        return sum + itemVolume(item, item.products || product);
      }, 0);

      const lineAllocatedWeight = allocs.reduce((sum, alloc) => {
        const item = alloc.items || {};
        return sum + itemWeight(item, item.products || product);
      }, 0);

      const lineStorage = toNumber(line.tariff_storage, 0);
      const lineAdmin = toNumber(line.tariff_admin, 0);
      const lineHandling = toNumber(line.tariff_handling, 0);
      const lineTransport = toNumber(line.tariff_transport, 0);
      const lineS2u = toNumber(line.total_s2u_fees, 0);
      const lineCustomer = toNumber(line.total_customer_charge, 0);

      required += qty;
      matched += allocCount;
      requestedVolume += lineRequestedVolume;
      requestedWeight += lineRequestedWeight;
      allocatedVolume += lineAllocatedVolume;
      allocatedWeight += lineAllocatedWeight;

      totalStorage += lineStorage;
      totalAdmin += lineAdmin;
      totalHandling += lineHandling;
      totalTransport += lineTransport;
      totalS2uFees += lineS2u;
      totalCustomerCharge += lineCustomer;

      return {
        line,
        product,
        sku,
        description: getLineDescription(line),
        qty,
        allocs,
        allocCount,
        missing,
        requestedVolume: lineRequestedVolume,
        requestedWeight: lineRequestedWeight,
        allocatedVolume: lineAllocatedVolume,
        allocatedWeight: lineAllocatedWeight,
        costs: {
          storage: lineStorage,
          admin: lineAdmin,
          handling: lineHandling,
          transport: lineTransport,
          s2u: lineS2u,
          customer: lineCustomer
        }
      };
    });

    required = toNumber(order.total_order_colli, 0) || toNumber(order.planning_colli, 0) || required;
    matched = toNumber(order.matched_colli, 0) || matched;

    requestedVolume = toNumber(order.total_order_volume_m3, 0) || toNumber(order.planning_volume_m3, 0) || requestedVolume;
    requestedWeight = toNumber(order.total_order_weight_kg, 0) || requestedWeight;

    allocatedVolume = toNumber(order.matched_volume_m3, 0) || allocatedVolume;
    allocatedWeight = toNumber(order.matched_weight_kg, 0) || allocatedWeight;

    let matchStatus = "none";
    if (missingProductLines > 0) matchStatus = "missing_product";
    else if (required > 0 && matched >= required) matchStatus = "full";
    else if (matched > 0) matchStatus = "partial";

    const blockers = [];
    if (!lines.length) blockers.push("No order lines");
    if (missingProductLines > 0) blockers.push(`${missingProductLines} line(s) missing product/SKU`);
    if (required <= 0) blockers.push("No required quantity");
    if (matched < required) blockers.push(`${required - matched} item(s) not matched`);
    if (!String(order.delivery_city || "").trim()) blockers.push("Missing city");
    if (!String(order.delivery_postcode || "").trim()) blockers.push("Missing postcode");
    if (!hasCoordinates(order)) blockers.push("Missing coordinates");

    return {
      required,
      matched,
      missing: Math.max(0, required - matched),
      missingProductLines,
      requestedVolume,
      requestedWeight,
      allocatedVolume,
      allocatedWeight,
      matchPct: required > 0 ? Math.min(100, (matched / required) * 100) : 0,
      matchStatus,
      isFullyMatched: required > 0 && matched >= required && missingProductLines === 0,
      readyForPlanning: blockers.length === 0,
      blockers,
      costs: {
        storage: toNumber(order.total_storage_tariff, 0) || totalStorage,
        admin: toNumber(order.total_admin_tariff, 0) || totalAdmin,
        handling: toNumber(order.total_handling_tariff, 0) || totalHandling,
        transport: toNumber(order.total_transport_tariff, 0) || totalTransport,
        s2u: toNumber(order.total_s2u_fees, 0) || totalS2uFees,
        customer: toNumber(order.total_customer_charge, 0) || totalCustomerCharge
      },
      lines: lineSummaries
    };
  }

  function enrichOrder(order) {
    const customerName =
      order.retail_name ||
      order.customers?.name ||
      order.customer_name ||
      "—";

    return {
      ...order,
      customer_name: customerName,
      ship_to_address: getAddressText(order),
      stats: calculateOrderStats(order)
    };
  }

  async function loadOrders() {
    const cid = await getCompanyId();

    setProgress(true, 15, "Loading order matching...");

    const { data, error } = await client
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name
        ),
        order_lines (
          id,
          order_id,
          product_id,
          line_number,
          sku_base,
          description,
          quantity_ordered,
          quantity_allocated,
          quantity_shipped,
          unit_volume_m3,
          unit_weight_kg,
          total_volume_m3,
          total_line_volume_m3,
          total_line_weight_kg,
          matched_quantity,
          matched_volume_m3,
          matched_weight_kg,
          tariff_storage,
          tariff_admin,
          tariff_handling,
          tariff_transport,
          total_s2u_fees,
          total_customer_charge,
          products (
            id,
            sku_base,
            name,
            description,
            volume_m3,
            weight_kg,
            net_weight_kg,
            storage_tariff,
            admin_tariff,
            handling_tariff,
            transport_tariff,
            total_s2u_fees,
            total_customer_charge
          ),
          order_allocations (
            id,
            order_line_id,
            item_id,
            allocation_status,
            allocated_at,
            items (
              id,
              product_id,
              sku_unique,
              storage_mutation_id,
              status,
              volume_m3,
              weight_kg,
              products (
                id,
                sku_base,
                name,
                volume_m3,
                weight_kg
              ),
              warehouse_locations (
                id,
                code
              ),
              warehouses (
                id,
                name
              )
            )
          )
        )
      `)
      .eq("company_id", cid)
      .order("requested_delivery_date", { ascending: true, nullsFirst: false })
      .order("order_number", { ascending: true });

    if (error) throw error;

    setProgress(true, 55, "Calculating matching status...");

    const productMap = await loadProductMapBySku(cid, data || []);
    const costedOrders = applyProductCostsToLoadedOrders(data || [], productMap);

    allOrders = costedOrders.map(enrichOrder);

    applyFilters();
    renderAll();

    setProgress(false);
  }

  function deriveMatchColor(order) {
    if (order.stats.readyForPlanning) return "green";
    if (order.stats.isFullyMatched && !hasCoordinates(order)) return "orange";
    if (order.stats.matchStatus === "partial") return "yellow";
    return "red";
  }

  function applyFilters() {
    const q = normalize(byId("filterSearch")?.value || "");
    const status = normalize(byId("filterStatus")?.value || "");
    const match = normalize(byId("filterMatch")?.value || "");
    const matchColor = normalize(byId("filterMatchColor")?.value || "");
    const geo = normalize(byId("filterGeo")?.value || "");
    const release = normalize(byId("filterRelease")?.value || byId("filterPlanningRelease")?.value || "");
    const customer = normalize(byId("filterCustomer")?.value || "");
    const planningOnly = normalize(byId("filterPlanningOnly")?.value || "");

    filteredOrders = allOrders.filter(order => {
      const stats = order.stats;
      const color = deriveMatchColor(order);

      if (customer && normalize(order.customer_id) !== customer) return false;
      if (status && normalize(order.status) !== status) return false;
      if (match && stats.matchStatus !== match) return false;
      if (matchColor && color !== matchColor) return false;
      if (geo === "ok" && !hasCoordinates(order)) return false;
      if (geo === "missing" && hasCoordinates(order)) return false;
      if (release === "released" && !order.planning_release) return false;
      if (release === "not_released" && order.planning_release) return false;
      if (planningOnly === "planning_only" && !order.planning_only) return false;
      if (planningOnly === "standard" && order.planning_only) return false;

      if (q) {
        const lineText = (order.order_lines || []).map(line => {
          const product = line.products || {};
          return [
            line.sku_base,
            line.description,
            product.sku_base,
            product.name,
            product.description,
            line.product_id
          ].join(" ");
        }).join(" ");

        const haystack = [
          order.order_number,
          order.external_reference,
          order.purchase_order,
          getMemo(order),
          order.customer_name,
          order.retail_name,
          order.ship_to_address,
          order.delivery_city,
          order.delivery_postcode,
          order.delivery_address_1,
          order.delivery_address_2,
          lineText
        ].join(" ").toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    sortFilteredOrders();
    renderCustomerFilter();

    if (selectedOrderId && !filteredOrders.some(o => String(o.id) === String(selectedOrderId))) {
      selectedOrderId = null;
    }
  }

  function sortValue(order, key) {
    const stats = order.stats || {};

    if (key === "order") return normalize(order.order_number || "");
    if (key === "customer") return normalize(order.customer_name || "");
    if (key === "address") return normalize(order.ship_to_address || getAddressText(order));
    if (key === "lines") return (order.order_lines || []).length;
    if (key === "matched") return toNumber(stats.matched, 0);
    if (key === "volume") return getTotalVolume(order);
    if (key === "weight") return getTotalWeight(order);
    if (key === "geo") return hasCoordinates(order) ? "geo ok" : "missing";
    if (key === "match") return normalize(deriveMatchColor(order));
    if (key === "status") return normalize(order.status || "");
    if (key === "release") return order.planning_release ? "released" : "not released";
    if (key === "delivery_date") return order.requested_delivery_date ? new Date(order.requested_delivery_date).getTime() : 0;
    if (key === "cost") return toNumber(order.total_customer_charge, 0);
    if (key === "memo") return normalize(getMemo(order));

    return normalize(order.order_number || "");
  }

  function sortFilteredOrders() {
    const key = sortState.key || "order";
    const direction = sortState.direction === "desc" ? -1 : 1;

    filteredOrders.sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);

      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * direction;
      }

      return String(av).localeCompare(String(bv), "en", { numeric: true, sensitivity: "base" }) * direction;
    });
  }

  function updateSortIndicators() {
    document.querySelectorAll("[data-sort-indicator]").forEach(el => {
      const key = el.getAttribute("data-sort-indicator");
      el.textContent = key === sortState.key
        ? (sortState.direction === "asc" ? "▲" : "▼")
        : "";
    });
  }

  function titleCase(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function pill(text, cls = "") {
    return `<span class="pill ${cls}">${escapeHtml(text)}</span>`;
  }

  function geoPill(order) {
    return hasCoordinates(order)
      ? pill("Geo OK", "pill-green")
      : pill("Missing", "pill-orange");
  }

  function releasePill(order) {
    return order.planning_release
      ? pill("Released", "pill-blue")
      : pill("Not released");
  }

  function statusPill(order) {
    const v = normalize(order.status || "imported");

    if (v === "ready_for_planning") return pill("Ready for planning", "pill-orange");
    if (v === "planned") return pill("Planned", "pill-blue");
    if (v === "matching_review") return pill("Matching review", "pill-orange");
    if (v === "ready_for_picking") return pill("Ready for picking", "pill-green");
    if (v === "loaded") return pill("Loaded", "pill-blue");
    if (v === "delivered") return pill("Delivered", "pill-green");

    return pill(order.status || "Imported");
  }

  function renderCustomerFilter() {
    const select = byId("filterCustomer");
    if (!select) return;

    const current = select.value;
    const unique = new Map();

    allOrders.forEach(row => {
      if (row.customer_id) unique.set(String(row.customer_id), row.customer_name);
    });

    select.innerHTML = [`<option value="">All customers</option>`]
      .concat(
        [...unique.entries()]
          .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
          .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
      )
      .join("");

    if ([...unique.keys(), ""].includes(current)) {
      select.value = current;
    }
  }

  function renderKpis() {
    const reviewRows = allOrders.filter(o => !o.planning_release);
    const imported = allOrders.filter(o =>
      ["imported", "matching_review"].includes(normalize(o.status))
    ).length;

    const full = allOrders.filter(o => o.stats.isFullyMatched).length;
    const partial = allOrders.filter(o => o.stats.matchStatus === "partial").length;
    const missingProducts = allOrders.reduce((sum, o) => sum + o.stats.missingProductLines, 0);
    const geoMissing = allOrders.filter(o => !hasCoordinates(o)).length;
    const ready = allOrders.filter(o => o.stats.readyForPlanning).length;

    setText("kpiImported", formatNumber(imported));
    setText("kpiFullyMatched", formatNumber(full));
    setText("kpiPartial", formatNumber(partial));
    setText("kpiMissingProducts", formatNumber(missingProducts));
    setText("kpiGeoMissing", formatNumber(geoMissing));
    setText("kpiReady", formatNumber(ready));

    setText("sumOrdersReview", formatNumber(reviewRows.length));
    setText("sumGreen", formatNumber(reviewRows.filter(o => deriveMatchColor(o) === "green").length));
    setText("sumOrange", formatNumber(reviewRows.filter(o => deriveMatchColor(o) === "orange").length));
    setText("sumYellow", formatNumber(reviewRows.filter(o => deriveMatchColor(o) === "yellow").length));
    setText("sumRed", formatNumber(reviewRows.filter(o => deriveMatchColor(o) === "red").length));
    setText("sumReleased", formatNumber(allOrders.filter(o => !!o.planning_release).length));

    setText("resultsMeta", `${formatNumber(filteredOrders.length)} orders shown`);
  }

  function renderTotals() {
    const totals = filteredOrders.reduce((acc, order) => {
      const s = order.stats || {};
      const c = getTotalCosts(order);

      acc.orders += 1;
      acc.lines += (order.order_lines || []).length;
      acc.required += toNumber(s.required, 0);
      acc.matched += toNumber(s.matched, 0);

      acc.totalVolume += getTotalVolume(order);
      acc.matchedVolume += getMatchedVolume(order);
      acc.totalWeight += getTotalWeight(order);
      acc.matchedWeight += getMatchedWeight(order);

      acc.customerCharge += c.customer;
      acc.s2uFees += c.s2u;
      acc.transport += c.transport;

      return acc;
    }, {
      orders: 0,
      lines: 0,
      required: 0,
      matched: 0,
      totalVolume: 0,
      matchedVolume: 0,
      totalWeight: 0,
      matchedWeight: 0,
      customerCharge: 0,
      s2uFees: 0,
      transport: 0
    });

    setText("totalOrdersLabel", `Totals for ${formatNumber(totals.orders)} visible order(s)`);
    setText("totalLines", formatNumber(totals.lines));
    setText("totalMatched", `${formatNumber(totals.matched)} / ${formatNumber(totals.required)}`);
    setText("totalVolume", `${formatNumber(totals.totalVolume, 2)} m³ total · ${formatNumber(totals.matchedVolume, 2)} m³ matched`);
    setText("totalWeight", `${formatNumber(totals.totalWeight, 2)} kg total · ${formatNumber(totals.matchedWeight, 2)} kg matched`);
    setText("totalExtra", `Customer charge ${formatMoney(totals.customerCharge)} · S2U ${formatMoney(totals.s2uFees)} · Transport ${formatMoney(totals.transport)}`);
  }

  function ensureMemoModal() {
    if (byId("memoModal")) return;

    const modal = document.createElement("div");
    modal.id = "memoModal";
    modal.className = "memo-modal-backdrop";
    modal.style.display = "none";

    modal.innerHTML = `
      <div class="memo-modal-card">
        <div class="memo-modal-head">
          <strong id="memoModalTitle">Order memo</strong>
          <button type="button" class="btn" id="btnCloseMemoModal">Close</button>
        </div>

        <textarea id="memoModalText" class="memo-modal-textarea"></textarea>

        <div class="memo-modal-actions">
          <button type="button" class="btn btn-primary" id="btnSaveMemoModal">Save memo</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const style = document.createElement("style");
    style.textContent = `
      .memo-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(15, 23, 42, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      .memo-modal-card {
        width: min(720px, 96vw);
        background: #fff;
        border-radius: 18px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.25);
        padding: 18px;
      }

      .memo-modal-head,
      .memo-modal-actions {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 12px;
      }

      .memo-modal-textarea {
        width: 100%;
        min-height: 220px;
        resize: vertical;
        border: 1px solid #d1d5db;
        border-radius: 12px;
        padding: 12px;
        font: inherit;
        line-height: 1.45;
      }

      .memo-link {
        cursor: pointer;
        color: #2563eb;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
    `;
    document.head.appendChild(style);

    byId("btnCloseMemoModal")?.addEventListener("click", closeMemoModal);
    byId("btnSaveMemoModal")?.addEventListener("click", saveMemoModal);

    modal.addEventListener("click", event => {
      if (event.target === modal) closeMemoModal();
    });
  }

  function openMemoModal(orderId) {
    const order = allOrders.find(o => String(o.id) === String(orderId));
    if (!order) return;

    ensureMemoModal();

    memoModalOrderId = String(order.id);

    setText("memoModalTitle", `Memo / notes - ${order.order_number || "order"}`);

    const textArea = byId("memoModalText");
    if (textArea) textArea.value = getMemo(order);

    const modal = byId("memoModal");
    if (modal) modal.style.display = "flex";
  }

  function closeMemoModal() {
    memoModalOrderId = null;

    const modal = byId("memoModal");
    if (modal) modal.style.display = "none";
  }

  async function saveMemoModal() {
    if (!memoModalOrderId) return;

    const textArea = byId("memoModalText");
    const newMemo = String(textArea?.value || "").trim();

    try {
      const { error } = await client
        .from("orders")
        .update({ memo: newMemo || null })
        .eq("id", memoModalOrderId);

      if (error) throw error;

      allOrders = allOrders.map(order =>
        String(order.id) === String(memoModalOrderId)
          ? enrichOrder({ ...order, memo: newMemo })
          : order
      );

      applyFilters();
      renderAll();
      closeMemoModal();

      showToast("Memo updated.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not save memo.", "err");
    }
  }

  function renderTable() {
    const tbody = byId("ordersBody") || byId("matchingTableBody");
    if (!tbody) return;

    updateSortIndicators();
    renderTotals();

    if (!filteredOrders.length) {
      tbody.innerHTML = `<tr><td colspan="14">No orders found.</td></tr>`;
      renderCheckAllState();
      return;
    }

    tbody.innerHTML = filteredOrders.map(order => {
      const s = order.stats;
      const c = getTotalCosts(order);
      const color = deriveMatchColor(order);
      const isOpen = String(selectedOrderId) === String(order.id);
      const address = order.ship_to_address || getAddressText(order);
      const memo = getMemo(order);

      return `
        <tr data-order-id="${escapeHtml(order.id)}" class="order-row ${isOpen ? "active" : ""}">
          <td class="checkbox-cell">
            <input class="row-check" type="checkbox" data-order-id="${escapeHtml(order.id)}" ${selectedIds.has(String(order.id)) ? "checked" : ""}/>
          </td>

          <td class="expand-cell">
            <button class="expand-btn" type="button" data-expand-order="${escapeHtml(order.id)}">${isOpen ? "−" : "+"}</button>
          </td>

          <td>
            <strong>${escapeHtml(order.order_number || "—")}</strong>
            <span class="subline">PO: ${escapeHtml(order.purchase_order || "Unknown")}</span>
            ${
              memo
                ? `<span class="subline memo-link" data-memo-order-id="${escapeHtml(order.id)}">Memo: ${escapeHtml(shortMemo(memo))}</span>`
                : `<span class="subline memo-link" data-memo-order-id="${escapeHtml(order.id)}">Memo: Add memo</span>`
            }
          </td>

          <td>${escapeHtml(order.customer_name || "—")}</td>
          <td>${escapeHtml(address)}</td>
          <td>${formatNumber((order.order_lines || []).length)}</td>

          <td>
            ${formatNumber(s.matched)} / ${formatNumber(s.required)}
            <span class="subline">${formatNumber(s.matchPct, 0)}%</span>
          </td>

          <td>
            ${formatNumber(getTotalVolume(order), 2)} m³
            <span class="subline">Matched: ${formatNumber(getMatchedVolume(order), 2)} m³</span>
          </td>

          <td>
            ${formatNumber(getTotalWeight(order), 2)} kg
            <span class="subline">Matched: ${formatNumber(getMatchedWeight(order), 2)} kg</span>
          </td>

          <td>${geoPill(order)}</td>
          <td>${pill(titleCase(color), `pill-${color === "green" ? "green" : color === "orange" ? "orange" : color === "yellow" ? "orange" : "red"}`)}</td>
          <td>${statusPill(order)}</td>
          <td>${releasePill(order)}</td>

          <td>
            ${escapeHtml(formatDate(order.requested_delivery_date))}
            <span class="subline">Charge: ${formatMoney(c.customer)}</span>
          </td>
        </tr>

        ${renderInlineDetailRow(order, isOpen)}
      `;
    }).join("");

    tbody.querySelectorAll("tr.order-row[data-order-id]").forEach(tr => {
      tr.addEventListener("click", event => {
        if (event.target.closest("input")) return;
        const id = String(tr.dataset.orderId);
        selectedOrderId = selectedOrderId === id ? null : id;
        renderAll();
      });
    });

    tbody.querySelectorAll("[data-expand-order]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        const id = String(button.dataset.expandOrder);
        selectedOrderId = selectedOrderId === id ? null : id;
        renderAll();
      });
    });

    tbody.querySelectorAll("[data-close-detail]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        selectedOrderId = null;
        renderAll();
      });
    });

    tbody.querySelectorAll("[data-memo-order-id]").forEach(el => {
      el.addEventListener("click", event => {
        event.stopPropagation();
        openMemoModal(el.dataset.memoOrderId);
      });
    });

    tbody.querySelectorAll(".row-check").forEach(input => {
      input.addEventListener("click", event => event.stopPropagation());
      input.addEventListener("change", () => {
        const id = String(input.dataset.orderId);
        if (input.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        renderCheckAllState();
      });
    });

    renderCheckAllState();
  }

  function renderInlineDetailRow(order, isOpen) {
    const s = order.stats;
    const c = getTotalCosts(order);
    const memo = getMemo(order);

    const blockersHtml = s.blockers.length
      ? `<div class="blockers-box open">Blocked: ${escapeHtml(s.blockers.join(" · "))}</div>`
      : "";

    return `
      <tr class="order-detail-row ${isOpen ? "open" : ""}" data-detail-row-for="${escapeHtml(order.id)}">
        <td class="order-detail-cell" colspan="14">
          <div class="inline-detail">
            <div class="inline-detail-head">
              <div>
                <h3 class="inline-detail-title">${escapeHtml(order.order_number || "—")}</h3>
                <p class="inline-detail-sub">${escapeHtml(order.customer_name || "—")}</p>
              </div>
              <button class="btn" type="button" data-close-detail>Close detail</button>
            </div>

            <div class="detail-grid">
              <div class="detail-box">
                <div class="detail-label">Ship To</div>
                <div class="detail-value">${escapeHtml(order.ship_to_address || getAddressText(order))}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Memo</div>
                <div class="detail-value">
                  ${
                    memo
                      ? `<span class="memo-link" data-memo-order-id="${escapeHtml(order.id)}">${escapeHtml(shortMemo(memo, 180))}</span>`
                      : `<span class="memo-link" data-memo-order-id="${escapeHtml(order.id)}">Add memo</span>`
                  }
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Purchase Order</div>
                <div class="detail-value">${escapeHtml(order.purchase_order || "Unknown")}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Match</div>
                <div class="detail-value">${formatNumber(s.matched)} / ${formatNumber(s.required)}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Geo</div>
                <div class="detail-value">${hasCoordinates(order) ? `${escapeHtml(order.delivery_lat)}, ${escapeHtml(order.delivery_lng)}` : "Missing"}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Total Volume</div>
                <div class="detail-value">${formatNumber(getTotalVolume(order), 2)} m³</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Matched Volume</div>
                <div class="detail-value">${formatNumber(getMatchedVolume(order), 2)} m³</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Total Weight</div>
                <div class="detail-value">${formatNumber(getTotalWeight(order), 2)} kg</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Matched Weight</div>
                <div class="detail-value">${formatNumber(getMatchedWeight(order), 2)} kg</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Colli</div>
                <div class="detail-value">${formatNumber(s.required || order.planning_colli || 0)}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Customer Charge</div>
                <div class="detail-value">${formatMoney(c.customer)}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">S2U Fees</div>
                <div class="detail-value">${formatMoney(c.s2u)}</div>
              </div>

              <div class="detail-box">
                <div class="detail-label">Transport Tariff</div>
                <div class="detail-value">${formatMoney(c.transport)}</div>
              </div>
            </div>

            ${blockersHtml}

            <div>
              <div class="detail-label" style="margin-bottom:8px;">Product / stock lines</div>
              <div class="line-list">
                ${renderDetailLinesHtml(order)}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function renderDetailLinesHtml(order) {
    const lines = order.stats.lines || [];

    if (!lines.length) {
      return `<div class="detail-empty">No order lines found.</div>`;
    }

    return lines.map(row => {
      const line = row.line;
      const product = row.product || {};
      const allocs = row.allocs || [];

      const titleSku = row.sku || product.sku_base || "Missing SKU";
      const productTitle = `${titleSku} · ${row.description || product.name || "Unknown product"}`;

      const allocHtml = allocs.length
        ? allocs.map(a => {
            const item = a.items || {};
            const itemProduct = item.products || product;
            const location = item.warehouse_locations?.code || "—";
            const warehouse = item.warehouses?.name || "—";

            return `
              <div class="line-sub">
                Reserved stock:
                <strong>${escapeHtml(item.sku_unique || item.storage_mutation_id || item.id || "item")}</strong>
                · ${escapeHtml(warehouse)} / ${escapeHtml(location)}
                · ${formatNumber(itemVolume(item, itemProduct), 2)} m³
                · ${formatNumber(itemWeight(item, itemProduct), 2)} kg
              </div>
            `;
          }).join("")
        : `<div class="line-sub">No physical stock reserved yet.</div>`;

      return `
        <div class="line-card">
          <div class="line-title">${escapeHtml(productTitle)}</div>

          <div class="line-meta">
            ${pill(`Requested ${formatNumber(row.qty)}`)}
            ${pill(`Reserved ${formatNumber(row.allocCount)}`, row.allocCount >= row.qty ? "pill-green" : "pill-orange")}
            ${pill(`Missing ${formatNumber(row.missing)}`, row.missing > 0 ? "pill-red" : "pill-green")}
            ${pill(`${formatNumber(row.requestedVolume, 2)} m³`)}
            ${pill(`${formatNumber(row.requestedWeight, 2)} kg`)}
            ${pill(`Charge ${formatMoney(row.costs.customer)}`)}
          </div>

          <div class="line-sub">SKU: ${escapeHtml(row.sku || "missing")} · Product ID: ${escapeHtml(line.product_id || product.id || "not linked")}</div>
          <div class="line-sub">
            Storage ${formatMoney(row.costs.storage)} ·
            Admin ${formatMoney(row.costs.admin)} ·
            Handling ${formatMoney(row.costs.handling)} ·
            Transport ${formatMoney(row.costs.transport)} ·
            S2U ${formatMoney(row.costs.s2u)}
          </div>
          ${allocHtml}
        </div>
      `;
    }).join("");
  }

  function renderCheckAllState() {
    const checkAll = byId("checkAllVisible") || byId("checkAllRows");
    if (!checkAll) return;

    const visibleIds = filteredOrders.map(o => String(o.id));
    checkAll.checked = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  }

  function renderAll() {
    renderKpis();
    renderTable();
  }

  async function runMatchModule() {
    try {
      if (!window.AllocationEngine?.run) {
        throw new Error("AllocationEngine is not loaded. Add /js/allocation-engine.js before order-matching.js.");
      }

      const targetOrderIds = selectedIds.size
        ? [...selectedIds]
        : allOrders
            .filter(o => !o.planning_release && !o.stats.isFullyMatched)
            .map(o => String(o.id));

      if (!targetOrderIds.length) {
        showToast("No orders selected or available for matching.", "err");
        return;
      }

      setProgress(true, 10, "Running allocation engine...");

      const result = await window.AllocationEngine.run({
        orderIds: targetOrderIds,
        dryRun: false
      });

      setProgress(true, 90, "Reloading matching results...");
      await loadOrders();

      setProgress(false);

      const created =
        result?.allocations_created ??
        result?.allocationsCreated ??
        result?.created ??
        0;

      showToast(`${formatNumber(created)} stock item(s) matched and reserved.`, "ok");
    } catch (error) {
      console.error(error);
      setProgress(false);
      showToast(error.message || "Matching failed.", "err");
    }
  }

  async function geocodeOne(order) {
    if (hasCoordinates(order)) {
      return {
        ok: true,
        skipped: true,
        lat: order.delivery_lat,
        lng: order.delivery_lng
      };
    }

    const address = [
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_city,
      order.delivery_region,
      order.delivery_postcode,
      order.delivery_country || "United Kingdom"
    ].filter(Boolean).join(", ");

    const postcode = String(order.delivery_postcode || "").trim();
    const city = String(order.delivery_city || "").trim();
    const country = String(order.delivery_country || "United Kingdom").trim();

    if (!postcode && !city) {
      return {
        ok: false,
        message: "Missing city/postcode"
      };
    }

    const attempts = [
      { address, postcode, city, country },
      { address: "", postcode, city, country },
      { address: "", postcode, city: "", country },
      { address: "", postcode: "", city, country }
    ].filter(q => q.address || q.postcode || q.city);

    for (const query of attempts) {
      try {
        const { data, error } = await client.functions.invoke(GEOCODE_FUNCTION_NAME, {
          body: {
            queries: [query]
          }
        });

        if (error) {
          console.error("Geocode function error:", error, query);
          continue;
        }

        const result = Array.isArray(data?.results) ? data.results[0] : null;

        if (result?.ok && result.lat != null && result.lng != null) {
          return {
            ok: true,
            lat: Number(result.lat),
            lng: Number(result.lng),
            display_name: result.display_name || ""
          };
        }
      } catch (error) {
        console.error("Geocode failed:", error, query);
      }
    }

    return {
      ok: false,
      message: "No geocode match"
    };
  }

  async function geocodeOrders(orderIds) {
    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < orderIds.length; i++) {
      const order = allOrders.find(o => String(o.id) === String(orderIds[i]));
      if (!order) continue;

      setProgress(true, Math.round(((i + 1) / orderIds.length) * 100), `Geocoding ${order.order_number}...`);

      const geo = await geocodeOne(order);

      if (!geo.ok) {
        failed += 1;
        console.warn(`No geocode for ${order.order_number}:`, geo.message);
        continue;
      }

      if (geo.skipped) {
        skipped += 1;
        continue;
      }

      const payload = {
        delivery_lat: geo.lat,
        delivery_lng: geo.lng
      };

      if ("geocode_display_name" in order) {
        payload.geocode_display_name = geo.display_name || null;
      }

      const { error } = await client
        .from("orders")
        .update(payload)
        .eq("id", order.id);

      if (error) {
        failed += 1;
        console.error(error);
      } else {
        updated += 1;
      }
    }

    return { updated, failed, skipped };
  }

  async function geocodeSelected() {
    try {
      const ids = selectedIds.size
        ? [...selectedIds]
        : filteredOrders.filter(o => !hasCoordinates(o)).map(o => String(o.id));

      if (!ids.length) {
        showToast("No orders selected or needing geocode.", "err");
        return;
      }

      const result = await geocodeOrders(ids);
      await loadOrders();

      setProgress(false);

      showToast(
        `Geocode complete. Updated: ${result.updated}, skipped: ${result.skipped}, failed: ${result.failed}.`,
        result.failed ? "err" : "ok"
      );
    } catch (error) {
      console.error(error);
      setProgress(false);
      showToast(error.message || "Geocoding failed.", "err");
    }
  }

  async function releaseOrders(orderIds) {
    const releasable = [];
    const blocked = [];

    orderIds.forEach(id => {
      const order = allOrders.find(o => String(o.id) === String(id));
      if (!order) return;

      const stats = calculateOrderStats(order);

      if (stats.readyForPlanning) {
        releasable.push(order);
      } else {
        blocked.push({
          order,
          blockers: stats.blockers
        });
      }
    });

    if (blocked.length) {
      const first = blocked[0];
      throw new Error(`${blocked.length} order(s) blocked. Example ${first.order.order_number}: ${first.blockers.join(" · ")}`);
    }

    if (!releasable.length) {
      throw new Error("No ready orders to release.");
    }

    for (const order of releasable) {
      const { error } = await client
        .from("orders")
        .update({
          status: "ready_for_planning",
          planning_release: true,
          released_to_planning_at: nowIso(),
          released_to_planning_by: "manual",
          planning_colli: getTotalColli(order),
          planning_volume_m3: round3(getTotalVolume(order))
        })
        .eq("id", order.id);

      if (error) throw error;
    }

    return releasable.length;
  }

  async function geocodeAndReleaseSelected() {
    try {
      const ids = selectedIds.size
        ? [...selectedIds]
        : filteredOrders
            .filter(o => o.stats.isFullyMatched && !o.planning_release)
            .map(o => String(o.id));

      if (!ids.length) {
        showToast("No selected or ready orders to release.", "err");
        return;
      }

      setProgress(true, 5, "Geocoding selected orders...");
      await geocodeOrders(ids);

      setProgress(true, 65, "Reloading orders...");
      await loadOrders();

      setProgress(true, 85, "Releasing to planning...");
      const count = await releaseOrders(ids);

      selectedIds.clear();

      await loadOrders();
      setProgress(false);

      showToast(`${formatNumber(count)} order(s) released to planning.`, "ok");
    } catch (error) {
      console.error(error);
      setProgress(false);
      showToast(error.message || "Release failed.", "err");
    }
  }

  function selectReadyOrders() {
    selectedIds.clear();

    filteredOrders.forEach(order => {
      if (order.stats.readyForPlanning && !order.planning_release) {
        selectedIds.add(String(order.id));
      }
    });

    renderTable();
    showToast(`${formatNumber(selectedIds.size)} ready order(s) selected.`, "ok");
  }

  function exportSelectedCsv() {
    const rows = selectedIds.size
      ? allOrders.filter(o => selectedIds.has(String(o.id)))
      : filteredOrders;

    if (!rows.length) {
      showToast("No orders to export.", "err");
      return;
    }

    const header = [
      "Order Number",
      "Customer",
      "Memo",
      "Purchase Order",
      "Ship To",
      "City",
      "Postcode",
      "Total Qty",
      "Matched Qty",
      "Missing Qty",
      "Total Volume m3",
      "Matched Volume m3",
      "Total Weight kg",
      "Matched Weight kg",
      "Storage",
      "Admin",
      "Handling",
      "Transport",
      "S2U Fees",
      "Customer Charge",
      "Match Status",
      "Status",
      "Planning Release"
    ];

    const csvRows = rows.map(order => {
      const s = order.stats;
      const c = getTotalCosts(order);

      return [
        order.order_number || "",
        order.customer_name || "",
        getMemo(order),
        order.purchase_order || "",
        order.ship_to_address || getAddressText(order),
        order.delivery_city || "",
        order.delivery_postcode || "",
        s.required,
        s.matched,
        s.missing,
        getTotalVolume(order).toFixed(3),
        getMatchedVolume(order).toFixed(3),
        getTotalWeight(order).toFixed(3),
        getMatchedWeight(order).toFixed(3),
        c.storage.toFixed(2),
        c.admin.toFixed(2),
        c.handling.toFixed(2),
        c.transport.toFixed(2),
        c.s2u.toFixed(2),
        c.customer.toFixed(2),
        s.matchStatus,
        order.status || "",
        order.planning_release ? "yes" : "no"
      ].map(value => `"${String(value).replaceAll('"', '""')}"`).join(",");
    });

    const csv = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `order-matching-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  function resetFilters() {
    [
      "filterSearch",
      "filterStatus",
      "filterMatch",
      "filterMatchColor",
      "filterGeo",
      "filterRelease",
      "filterPlanningRelease",
      "filterCustomer",
      "filterPlanningOnly"
    ].forEach(id => {
      const el = byId(id);
      if (el) el.value = "";
    });

    applyFilters();
    renderAll();
  }

  function bindEvents() {
    [
      "filterSearch",
      "filterStatus",
      "filterMatch",
      "filterMatchColor",
      "filterGeo",
      "filterRelease",
      "filterPlanningRelease",
      "filterCustomer",
      "filterPlanningOnly"
    ].forEach(id => {
      const el = byId(id);
      if (!el) return;

      el.addEventListener("input", () => {
        applyFilters();
        renderAll();
      });

      el.addEventListener("change", () => {
        applyFilters();
        renderAll();
      });
    });

    document.querySelectorAll("[data-sort-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort-key");

        if (sortState.key === key) {
          sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
        } else {
          sortState.key = key;
          sortState.direction = "asc";
        }

        sortFilteredOrders();
        renderAll();
      });
    });

    byId("btnRefresh")?.addEventListener("click", async () => {
      try {
        await loadOrders();
        showToast("Matching refreshed.", "ok");
      } catch (error) {
        console.error(error);
        setProgress(false);
        showToast(error.message || "Refresh failed.", "err");
      }
    });

    byId("btnResetFilters")?.addEventListener("click", resetFilters);
    byId("btnRunMatch")?.addEventListener("click", runMatchModule);
    byId("btnSelectReady")?.addEventListener("click", selectReadyOrders);
    byId("btnGeocodeSelected")?.addEventListener("click", geocodeSelected);
    byId("btnReleaseSelected")?.addEventListener("click", geocodeAndReleaseSelected);
    byId("btnExportSelected")?.addEventListener("click", exportSelectedCsv);

    const checkAll = byId("checkAllVisible") || byId("checkAllRows");

    checkAll?.addEventListener("change", event => {
      const checked = event.target.checked;

      filteredOrders.forEach(order => {
        if (checked) selectedIds.add(String(order.id));
        else selectedIds.delete(String(order.id));
      });

      renderTable();
    });
  }

  async function init() {
    try {
      if (typeof sb !== "function") {
        throw new Error("Supabase helper sb() is not available.");
      }

      client = sb();

      bindEvents();
      await loadOrders();

      showToast("Order matching loaded.", "ok");
    } catch (error) {
      console.error(error);
      setProgress(false);
      showToast(error.message || "Could not load order matching.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();