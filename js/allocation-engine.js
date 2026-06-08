(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const CANCELLED_ALLOCATION_STATUS = "cancelled";

  const ORDER_STATUSES = {
    NO_LINES: "imported",
    NO_MATCH: "imported",
    PARTIAL: "matching_review",
    FULL: "ready_for_picking"
  };

  function sbClient() {
    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }
    return sb();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function isActiveAllocation(row) {
    return row && normalize(row.allocation_status) !== CANCELLED_ALLOCATION_STATUS;
  }

  async function getCompanyId(client) {
    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    return data.id;
  }

  async function fetchOrders(client, companyId, options = {}) {
    let query = client
      .from("orders")
      .select(`
        id,
        company_id,
        customer_id,
        order_number,
        external_reference,
        status,
        planning_release,
        planning_colli,
        planning_volume_m3,
        delivery_city,
        delivery_postcode,
        delivery_lat,
        delivery_lng,
        customers (
          id,
          name
        ),
        order_lines (
          id,
          order_id,
          product_id,
          quantity_ordered,
          total_volume_m3,
          products (
            id,
            sku_base,
            name,
            description,
            volume_m3,
            weight_kg
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
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (Array.isArray(options.orderIds) && options.orderIds.length) {
      query = query.in("id", options.orderIds);
    } else {
      query = query.in("status", [
        "imported",
        "matching_review",
        "ready_for_planning",
        "ready_for_picking"
      ]);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data || [];
  }

  async function fetchAvailableItems(client, companyId) {
    const { data, error } = await client
      .from("items")
      .select(`
        id,
        company_id,
        product_id,
        sku_unique,
        storage_mutation_id,
        status,
        volume_m3,
        weight_kg,
        created_at,
        warehouse_locations (
          id,
          code
        ),
        warehouses (
          id,
          name
        ),
        products (
          id,
          sku_base,
          name,
          volume_m3,
          weight_kg
        )
      `)
      .eq("company_id", companyId)
      .eq("status", "in_stock")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function fetchExistingAllocations(client, companyId) {
    const { data, error } = await client
      .from("order_allocations")
      .select("id, company_id, order_line_id, item_id, allocation_status, allocated_at")
      .eq("company_id", companyId);

    if (error) throw error;
    return data || [];
  }

  function buildAvailableMap(items, activeAllocatedItemIds) {
    const map = new Map();

    (items || []).forEach(item => {
      if (!item.product_id) return;
      if (activeAllocatedItemIds.has(String(item.id))) return;

      const key = String(item.product_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });

    return map;
  }

  function getLineAllocations(line) {
    return (line.order_allocations || []).filter(isActiveAllocation);
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

  function calculateOrderSummary(order, pendingAllocations = []) {
    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];

    let totalLines = lines.length;
    let totalRequired = 0;
    let totalAllocated = 0;
    let missingProductLines = 0;
    let requestedVolume = 0;
    let requestedWeight = 0;
    let allocatedVolume = 0;
    let allocatedWeight = 0;

    const lineSummaries = lines.map(line => {
      const product = line.products || {};
      const required = toNumber(line.quantity_ordered, 0);
      const existingAllocations = getLineAllocations(line);
      const pendingForLine = pendingAllocations.filter(a => String(a.order_line_id) === String(line.id));
      const allocated = existingAllocations.length + pendingForLine.length;
      const missing = Math.max(0, required - allocated);

      if (!line.product_id) missingProductLines += 1;

      const lineRequestedVolume = required * productVolume(product);
      const lineRequestedWeight = required * productWeight(product);

      const lineAllocatedVolume = existingAllocations.reduce((sum, alloc) => {
        return sum + itemVolume(alloc.items, alloc.items?.products || product);
      }, 0);

      const lineAllocatedWeight = existingAllocations.reduce((sum, alloc) => {
        return sum + itemWeight(alloc.items, alloc.items?.products || product);
      }, 0);

      totalRequired += required;
      totalAllocated += allocated;
      requestedVolume += lineRequestedVolume;
      requestedWeight += lineRequestedWeight;
      allocatedVolume += lineAllocatedVolume;
      allocatedWeight += lineAllocatedWeight;

      return {
        order_line_id: line.id,
        product_id: line.product_id || null,
        sku_base: product.sku_base || "Missing SKU",
        product_name: product.name || "Unknown product",
        required,
        allocated,
        missing,
        requested_volume_m3: lineRequestedVolume,
        requested_weight_kg: lineRequestedWeight
      };
    });

    const matchPercentage = totalRequired > 0
      ? Math.min(100, (totalAllocated / totalRequired) * 100)
      : 0;

    let matchStatus = "none";
    if (missingProductLines > 0) matchStatus = "missing_product";
    else if (totalRequired > 0 && totalAllocated >= totalRequired) matchStatus = "full";
    else if (totalAllocated > 0) matchStatus = "partial";

    const blockers = [];
    if (!totalLines) blockers.push("No order lines");
    if (missingProductLines) blockers.push(`${missingProductLines} line(s) missing product`);
    if (totalRequired <= 0) blockers.push("No required quantity");
    if (totalAllocated < totalRequired) blockers.push(`${totalRequired - totalAllocated} item(s) missing`);
    if (!hasCoordinates(order)) blockers.push("Missing coordinates");

    let suggestedStatus = ORDER_STATUSES.NO_MATCH;
    if (!totalLines) suggestedStatus = ORDER_STATUSES.NO_LINES;
    else if (matchStatus === "full") suggestedStatus = ORDER_STATUSES.FULL;
    else if (matchStatus === "partial") suggestedStatus = ORDER_STATUSES.PARTIAL;

    return {
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customers?.name || order.customer_name || "—",
      total_lines: totalLines,
      total_required: totalRequired,
      total_allocated: totalAllocated,
      total_missing: Math.max(0, totalRequired - totalAllocated),
      missing_product_lines: missingProductLines,
      match_percentage: matchPercentage,
      match_status: matchStatus,
      suggested_status: suggestedStatus,
      ready_for_planning: blockers.length === 0,
      has_coordinates: hasCoordinates(order),
      requested_volume_m3: requestedVolume,
      requested_weight_kg: requestedWeight,
      allocated_volume_m3: allocatedVolume,
      allocated_weight_kg: allocatedWeight,
      blockers,
      lines: lineSummaries
    };
  }

  function buildAllocations(companyId, orders, availableMap, timestamp) {
    const allocationRows = [];
    const reservedItemIds = [];
    const touchedOrders = [];

    orders.forEach(order => {
      const pendingForOrder = [];

      (order.order_lines || []).forEach(line => {
        const required = toNumber(line.quantity_ordered, 0);
        const existing = getLineAllocations(line).length;
        const pending = pendingForOrder.filter(a => String(a.order_line_id) === String(line.id)).length;
        const missing = Math.max(0, required - existing - pending);

        if (!missing || !line.product_id) return;

        const pool = availableMap.get(String(line.product_id)) || [];
        const taken = pool.splice(0, missing);

        taken.forEach(item => {
          const row = {
            company_id: companyId,
            order_line_id: line.id,
            item_id: item.id,
            allocation_status: "reserved",
            allocated_at: timestamp,
            allocated_by_profile_id: null
          };

          allocationRows.push(row);
          pendingForOrder.push(row);
          reservedItemIds.push(item.id);
        });
      });

      touchedOrders.push({
        order,
        pendingAllocations: pendingForOrder
      });
    });

    return {
      allocationRows,
      reservedItemIds,
      touchedOrders
    };
  }

  function buildOrderUpdates(touchedOrders) {
    return touchedOrders.map(({ order, pendingAllocations }) => {
      const summary = calculateOrderSummary(order, pendingAllocations);

      return {
        order_id: order.id,
        old_status: order.status,
        new_status: summary.suggested_status,
        summary
      };
    });
  }

  async function insertAllocations(client, rows) {
    if (!rows.length) return;

    const { error } = await client
      .from("order_allocations")
      .insert(rows);

    if (error) throw error;
  }

  async function reserveItems(client, itemIds, timestamp) {
    const ids = unique(itemIds);
    if (!ids.length) return;

    const { error } = await client
      .from("items")
      .update({
        status: "reserved",
        reserved_at: timestamp
      })
      .in("id", ids);

    if (error) throw error;
  }

  async function updateOrders(client, updates) {
    for (const row of updates) {
      const payload = {
        status: row.new_status,
        planning_colli: row.summary.total_allocated,
        planning_volume_m3: Number(row.summary.allocated_volume_m3.toFixed(3))
      };

      const { error } = await client
        .from("orders")
        .update(payload)
        .eq("id", row.order_id);

      if (error) throw error;
    }
  }

  function buildEventRows(companyId, allocationRows, reservedItems, orderUpdates) {
    const events = [];

    allocationRows.forEach(row => {
      events.push({
        company_id: companyId,
        event_type: "allocation_created",
        entity_type: "order_allocation",
        entity_id: null,
        reference_no: null,
        source_module: "allocation-engine",
        old_status: null,
        new_status: "reserved",
        payload: {
          order_line_id: row.order_line_id,
          item_id: row.item_id,
          allocated_at: row.allocated_at
        }
      });
    });

    reservedItems.forEach(item => {
      events.push({
        company_id: companyId,
        event_type: "item_reserved",
        entity_type: "item",
        entity_id: item.id,
        reference_no: item.sku_unique || item.storage_mutation_id || null,
        source_module: "allocation-engine",
        old_status: item.status || "in_stock",
        new_status: "reserved",
        payload: {
          product_id: item.product_id || null
        }
      });
    });

    orderUpdates.forEach(row => {
      if (row.old_status === row.new_status) return;

      events.push({
        company_id: companyId,
        event_type: "order_match_completed",
        entity_type: "order",
        entity_id: row.order_id,
        reference_no: row.summary.order_number || null,
        source_module: "allocation-engine",
        old_status: row.old_status || null,
        new_status: row.new_status,
        payload: {
          match_status: row.summary.match_status,
          match_percentage: row.summary.match_percentage,
          total_required: row.summary.total_required,
          total_allocated: row.summary.total_allocated,
          total_missing: row.summary.total_missing,
          requested_volume_m3: row.summary.requested_volume_m3,
          allocated_volume_m3: row.summary.allocated_volume_m3,
          requested_weight_kg: row.summary.requested_weight_kg,
          allocated_weight_kg: row.summary.allocated_weight_kg
        }
      });
    });

    return events;
  }

  async function logEvents(events) {
    if (!events.length) return;
    if (!window.EventLog?.logWarehouseEvents) return;
    await window.EventLog.logWarehouseEvents(events);
  }

  async function run(options = {}) {
    const client = sbClient();
    const companyId = await getCompanyId(client);
    const timestamp = nowIso();
    const dryRun = Boolean(options.dryRun);

    const [orders, availableItems, existingAllocations] = await Promise.all([
      fetchOrders(client, companyId, options),
      fetchAvailableItems(client, companyId),
      fetchExistingAllocations(client, companyId)
    ]);

    const activeAllocatedItemIds = new Set(
      existingAllocations
        .filter(isActiveAllocation)
        .map(row => String(row.item_id))
        .filter(Boolean)
    );

    const availableMap = buildAvailableMap(availableItems, activeAllocatedItemIds);

    const {
      allocationRows,
      reservedItemIds,
      touchedOrders
    } = buildAllocations(companyId, orders, availableMap, timestamp);

    const orderUpdates = buildOrderUpdates(touchedOrders);

    const reservedItems = availableItems.filter(item =>
      reservedItemIds.map(String).includes(String(item.id))
    );

    if (!dryRun) {
      await insertAllocations(client, allocationRows);
      await reserveItems(client, reservedItemIds, timestamp);
      await updateOrders(client, orderUpdates);

      const events = buildEventRows(companyId, allocationRows, reservedItems, orderUpdates);
      await logEvents(events);
    }

    return {
      dryRun,
      orders_checked: orders.length,
      available_items_checked: availableItems.length,
      allocations_created: allocationRows.length,
      items_reserved: unique(reservedItemIds).length,
      order_updates: orderUpdates.length,
      summaries: orderUpdates.map(row => row.summary)
    };
  }

  async function previewOrder(orderId) {
    if (!orderId) throw new Error("Order id is required.");

    const result = await run({
      dryRun: true,
      orderIds: [orderId]
    });

    return result.summaries[0] || null;
  }

  async function runSingleOrder(orderId) {
    if (!orderId) throw new Error("Order id is required.");

    return run({
      dryRun: false,
      orderIds: [orderId]
    });
  }

  window.AllocationEngine = {
    run,
    runSingleOrder,
    previewOrder,
    calculateOrderSummary
  };
})();