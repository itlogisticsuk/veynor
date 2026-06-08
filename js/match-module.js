(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const OPEN_ORDER_STATUSES = ["imported", "ready_for_planning", "ready_for_picking"];
  const CANCELLED_ALLOCATION_STATUS = "cancelled";

  function sbClient() {
    return sb();
  }

  function isNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
  }

  function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uniqueIds(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function groupBy(rows, getKey) {
    const map = new Map();

    for (const row of rows || []) {
      const key = getKey(row);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(row);
    }

    return map;
  }

  async function getTenantCompanyId(client) {
    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) {
      throw new Error(`Tenant "${TENANT_NAME}" not found.`);
    }

    return data.id;
  }

  function matchColorFromPercentage(percentage) {
    const pct = toNumber(percentage, 0);

    if (pct >= 100) return "green";
    if (pct > 50) return "orange";
    if (pct > 0) return "yellow";
    return "red";
  }

  function matchLabelFromPercentage(percentage) {
    const pct = toNumber(percentage, 0);

    if (pct >= 100) return "Complete";
    if (pct > 50) return "Almost Complete";
    if (pct > 0) return "Partial";
    return "No Stock";
  }

  function orderStatusFromPercentage(percentage) {
    const pct = toNumber(percentage, 0);

    if (pct >= 100) return "ready_for_picking";
    if (pct > 0) return "ready_for_planning";
    return "imported";
  }

  async function fetchOrdersForMatching(client, companyId, orderIds = null) {
    let query = client
      .from("orders")
      .select(`
        id,
        company_id,
        customer_id,
        order_number,
        status,
        created_at,
        order_lines (
          id,
          order_id,
          product_id,
          quantity_ordered,
          total_volume_m3,
          products (
            id,
            sku_base,
            name
          ),
          order_allocations (
            id,
            order_line_id,
            item_id,
            allocation_status,
            allocated_at
          )
        )
      `)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (isNonEmptyArray(orderIds)) {
      query = query.in("id", orderIds);
    } else {
      query = query.in("status", OPEN_ORDER_STATUSES);
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
        status,
        created_at,
        reserved_at
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
      .select(`
        id,
        company_id,
        order_line_id,
        item_id,
        allocation_status,
        allocated_at
      `)
      .eq("company_id", companyId);

    if (error) throw error;

    return data || [];
  }

  async function fetchItemsByIds(client, itemIds) {
    if (!isNonEmptyArray(itemIds)) return [];

    const { data, error } = await client
      .from("items")
      .select(`
        id,
        company_id,
        product_id,
        sku_unique,
        status,
        created_at,
        reserved_at
      `)
      .in("id", uniqueIds(itemIds));

    if (error) throw error;

    return data || [];
  }

  async function fetchOrdersByIds(client, orderIds) {
    if (!isNonEmptyArray(orderIds)) return [];

    const { data, error } = await client
      .from("orders")
      .select(`
        id,
        company_id,
        order_number,
        status
      `)
      .in("id", uniqueIds(orderIds));

    if (error) throw error;

    return data || [];
  }

  function buildAvailableMap(items, allocatedItemIds) {
    const map = new Map();

    for (const item of items || []) {
      if (!item?.product_id) continue;
      if (allocatedItemIds.has(item.id)) continue;

      if (!map.has(item.product_id)) {
        map.set(item.product_id, []);
      }

      map.get(item.product_id).push(item);
    }

    return map;
  }

  function countActiveAllocationsForLine(orderLineId, allocations) {
    let count = 0;

    for (const row of allocations || []) {
      if (
        row?.order_line_id === orderLineId &&
        row?.allocation_status !== CANCELLED_ALLOCATION_STATUS
      ) {
        count += 1;
      }
    }

    return count;
  }

  function countPendingAllocationsForLine(orderLineId, pendingAllocations) {
    let count = 0;

    for (const row of pendingAllocations || []) {
      if (row?.order_line_id === orderLineId) {
        count += 1;
      }
    }

    return count;
  }

  function buildOrderMatchSummary(order, allAllocations, pendingAllocations = []) {
    const lines = Array.isArray(order?.order_lines) ? order.order_lines : [];

    let totalRequired = 0;
    let totalAllocated = 0;

    for (const line of lines) {
      const required = toNumber(line?.quantity_ordered, 0);
      const existing = countActiveAllocationsForLine(line.id, allAllocations);
      const pending = countPendingAllocationsForLine(line.id, pendingAllocations);

      totalRequired += required;
      totalAllocated += (existing + pending);
    }

    const percentage = totalRequired > 0
      ? (totalAllocated / totalRequired) * 100
      : 0;

    return {
      totalRequired,
      totalAllocated,
      percentage,
      color: matchColorFromPercentage(percentage),
      label: matchLabelFromPercentage(percentage),
      suggestedOrderStatus: orderStatusFromPercentage(percentage)
    };
  }

  async function insertAllocations(client, rows) {
    if (!isNonEmptyArray(rows)) return;

    const { error } = await client
      .from("order_allocations")
      .insert(rows);

    if (error) throw error;
  }

  async function reserveItems(client, itemIds, timestamp = nowIso()) {
    if (!isNonEmptyArray(itemIds)) return;

    const { error } = await client
      .from("items")
      .update({
        status: "reserved",
        reserved_at: timestamp
      })
      .in("id", uniqueIds(itemIds));

    if (error) throw error;
  }

  async function updateOrderStatuses(client, updates) {
    if (!isNonEmptyArray(updates)) return;

    for (const row of updates) {
      const { error } = await client
        .from("orders")
        .update({ status: row.status })
        .eq("id", row.order_id);

      if (error) throw error;
    }
  }

  async function logEventsIfAvailable(events) {
    if (!isNonEmptyArray(events)) return;
    if (!window.EventLog?.logWarehouseEvents) return;

    await window.EventLog.logWarehouseEvents(events);
  }

  function buildAllocationRows(companyId, orders, existingAllocations, availableMap, timestamp) {
    const newAllocations = [];
    const reservedItemIds = [];
    const orderSummaries = [];
    const orderStatusUpdates = [];
    const createdAllocationsByOrderId = new Map();

    for (const order of orders) {
      const lines = Array.isArray(order?.order_lines) ? order.order_lines : [];

      for (const line of lines) {
        const requiredQty = toNumber(line?.quantity_ordered, 0);
        const existingQty = countActiveAllocationsForLine(line.id, existingAllocations);
        const missingQty = Math.max(0, requiredQty - existingQty);

        if (missingQty <= 0) continue;
        if (!line?.product_id) continue;

        const pool = availableMap.get(line.product_id) || [];
        const taken = pool.splice(0, missingQty);

        for (const item of taken) {
          const allocationRow = {
            company_id: companyId,
            order_line_id: line.id,
            item_id: item.id,
            allocation_status: "reserved",
            allocated_at: timestamp,
            allocated_by_profile_id: null
          };

          newAllocations.push(allocationRow);
          reservedItemIds.push(item.id);

          if (!createdAllocationsByOrderId.has(order.id)) {
            createdAllocationsByOrderId.set(order.id, []);
          }

          createdAllocationsByOrderId.get(order.id).push({
            order_line_id: line.id,
            product_id: line.product_id,
            item_id: item.id
          });
        }
      }

      const summary = buildOrderMatchSummary(order, existingAllocations, newAllocations);

      orderSummaries.push({
        order_id: order.id,
        order_number: order.order_number,
        suggestedOrderStatus: summary.suggestedOrderStatus,
        totalRequired: summary.totalRequired,
        totalAllocated: summary.totalAllocated,
        percentage: summary.percentage,
        color: summary.color,
        label: summary.label
      });

      if (summary.suggestedOrderStatus !== order.status) {
        orderStatusUpdates.push({
          order_id: order.id,
          order_number: order.order_number,
          old_status: order.status,
          status: summary.suggestedOrderStatus,
          percentage: summary.percentage,
          total_required: summary.totalRequired,
          total_allocated: summary.totalAllocated
        });
      }
    }

    return {
      newAllocations,
      reservedItemIds,
      orderSummaries,
      orderStatusUpdates,
      createdAllocationsByOrderId
    };
  }

  function buildEventRows(companyId, newAllocations, itemSnapshots, orderStatusUpdates, timestamp) {
    const events = [];

    for (const row of newAllocations) {
      events.push({
        company_id: companyId,
        event_type: "allocation_created",
        entity_type: "order_allocation",
        entity_id: null,
        reference_no: null,
        source_module: "match-module",
        old_status: null,
        new_status: "reserved",
        payload: {
          order_line_id: row.order_line_id,
          item_id: row.item_id,
          allocated_at: row.allocated_at || timestamp
        }
      });
    }

    for (const item of itemSnapshots || []) {
      events.push({
        company_id: companyId,
        event_type: "item_reserved",
        entity_type: "item",
        entity_id: item.id,
        reference_no: item.sku_unique || null,
        source_module: "match-module",
        old_status: item.status || "in_stock",
        new_status: "reserved",
        payload: {
          product_id: item.product_id || null
        }
      });
    }

    for (const row of orderStatusUpdates || []) {
      events.push({
        company_id: companyId,
        event_type: "order_match_completed",
        entity_type: "order",
        entity_id: row.order_id,
        reference_no: row.order_number || null,
        source_module: "match-module",
        old_status: row.old_status || null,
        new_status: row.status,
        payload: {
          match_percentage: row.percentage,
          total_required: row.total_required,
          total_allocated: row.total_allocated
        }
      });
    }

    return events;
  }

  async function matchOrders(options = {}) {
    const client = sbClient();
    const companyId = await getTenantCompanyId(client);

    const orderIds = isNonEmptyArray(options.orderIds) ? options.orderIds : null;
    const dryRun = Boolean(options.dryRun);
    const timestamp = nowIso();

    const [orders, availableItems, existingAllocations] = await Promise.all([
      fetchOrdersForMatching(client, companyId, orderIds),
      fetchAvailableItems(client, companyId),
      fetchExistingAllocations(client, companyId)
    ]);

    const allocatedItemIds = new Set(
      (existingAllocations || [])
        .filter((row) => row?.allocation_status !== CANCELLED_ALLOCATION_STATUS)
        .map((row) => row.item_id)
        .filter(Boolean)
    );

    const availableMap = buildAvailableMap(availableItems, allocatedItemIds);

    const {
      newAllocations,
      reservedItemIds,
      orderSummaries,
      orderStatusUpdates
    } = buildAllocationRows(
      companyId,
      orders,
      existingAllocations,
      availableMap,
      timestamp
    );

    if (!dryRun) {
      const [itemSnapshots] = await Promise.all([
        fetchItemsByIds(client, reservedItemIds)
      ]);

      await insertAllocations(client, newAllocations);
      await reserveItems(client, reservedItemIds, timestamp);
      await updateOrderStatuses(client, orderStatusUpdates);

      const eventRows = buildEventRows(
        companyId,
        newAllocations,
        itemSnapshots,
        orderStatusUpdates,
        timestamp
      );

      await logEventsIfAvailable(eventRows);
    }

    return {
      dryRun,
      ordersChecked: orders.length,
      availableItemsChecked: availableItems.length,
      allocationsCreated: newAllocations.length,
      itemsReserved: reservedItemIds.length,
      orderSummaries
    };
  }

  async function getOrderMatchStatus(orderId) {
    if (!orderId) {
      throw new Error("Order id is required.");
    }

    const client = sbClient();
    const companyId = await getTenantCompanyId(client);

    const { data: order, error } = await client
      .from("orders")
      .select(`
        id,
        company_id,
        order_number,
        status,
        order_lines (
          id,
          order_id,
          product_id,
          quantity_ordered,
          total_volume_m3,
          order_allocations (
            id,
            order_line_id,
            item_id,
            allocation_status,
            allocated_at
          )
        )
      `)
      .eq("company_id", companyId)
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    if (!order) {
      throw new Error("Order not found.");
    }

    const allocations = await fetchExistingAllocations(client, companyId);
    return buildOrderMatchSummary(order, allocations, []);
  }

  window.MatchModule = {
    matchOrders,
    getOrderMatchStatus,
    matchColorFromPercentage,
    matchLabelFromPercentage,
    orderStatusFromPercentage
  };
})();
