
/* ============================================================
   VEYNOR PICKING LIST GENERATOR
   File: /js/picking-list-generator.js
   Version: 1.0.0

   PART 1 OF 5
   CORE CONFIGURATION & VALIDATION

   Picking methods:
   - By Order
   - By Warehouse Location
   - By Product
   - By Warehouse
   - By Order Group

   Data sources:
   - orders
   - order_lines
   - order_allocations
   - items
   - stock_sets
   - products
   - warehouses
   - warehouse_locations

   IMPORTANT:
   - Existing FIFO allocations are authoritative.
   - No new stock allocations.
   - No stock mutations.
   - No order status changes.
   - No direct writes to picking tables.
   - Tenant validation is mandatory.
   - PDF generation is read-only.

   Parts 1-5 belong in ONE JavaScript file.
   ============================================================ */

(function () {
  "use strict";

  // ==========================================================
  // 1. CONFIGURATION
  // ==========================================================

  const CONFIG = Object.freeze({

    version: "1.0.0",

    moduleName: "VeynorPickingListGenerator",

    pdf: Object.freeze({
      orientation: "portrait",
      unit: "mm",
      format: "a4",

      pageWidth: 210,
      pageHeight: 297,

      marginLeft: 14,
      marginRight: 14,
      marginTop: 14,
      marginBottom: 20,

      footerY: 281,

      font: "helvetica",

      colors: Object.freeze({
        navy: [7, 27, 67],
        blue: [8, 100, 249],
        dark: [17, 36, 68],
        muted: [97, 113, 139],
        border: [224, 232, 244],
        light: [243, 246, 251],
        white: [255, 255, 255],
        green: [21, 149, 104],
        orange: [217, 149, 39],
        red: [220, 71, 86]
      })
    }),

    pickingMethods: Object.freeze({
      BY_ORDER: "by_order",
      BY_LOCATION: "by_location",
      BY_PRODUCT: "by_product",
      BY_WAREHOUSE: "by_warehouse",
      BY_ORDER_GROUP: "by_order_group"
    }),

    sortMethods: Object.freeze({
      LOCATION: "location",
      SKU: "sku",
      ORDER: "order"
    }),

    detailLevels: Object.freeze({
      FULL: "full",
      COMPACT: "compact"
    }),

    outputModes: Object.freeze({
      PDF: "pdf",
      PRINT: "print"
    }),

    defaults: Object.freeze({
      pickingMethod: "by_location",
      sortMethod: "location",
      detailLevel: "full",

      groupBy: "warehouse",

      includeCheckboxes: true,
      includeMissing: true,
      includeSummary: true,

      separatePages: false,
      includeBarcodes: false,

      outputMode: "pdf"
    }),

    maxOrders: 500,
    maxItems: 10000,

    queryBatchSize: 100,

    locale: "en-GB",

    timezone: "Europe/London"
  });


  // ==========================================================
  // 2. ALLOWED VALUES
  // ==========================================================

  const ALLOWED_METHODS = new Set(
    Object.values(CONFIG.pickingMethods)
  );

  const ALLOWED_SORTS = new Set(
    Object.values(CONFIG.sortMethods)
  );

  const ALLOWED_DETAILS = new Set(
    Object.values(CONFIG.detailLevels)
  );

  const ALLOWED_OUTPUTS = new Set(
    Object.values(CONFIG.outputModes)
  );

  const ALLOWED_GROUPS = new Set([
    "warehouse",
    "owner",
    "none"
  ]);


  // ==========================================================
  // 3. BASIC HELPERS
  // ==========================================================

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function asId(value) {
    return clean(value);
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(asId(value));
  }

  function requireUuid(value, label) {
    const id = asId(value);

    if (!isUuid(id)) {
      throw new Error(
        `${label} must be a valid UUID.`
      );
    }

    return id;
  }

  function toNumber(value, fallback = 0) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return fallback;
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : fallback;
  }

  function toInteger(value, fallback = 0) {
    const number = toNumber(value, fallback);

    return Number.isInteger(number)
      ? number
      : fallback;
  }

  function unique(values) {
    return [
      ...new Set(
        (values || []).filter(
          value =>
            value !== null &&
            value !== undefined &&
            value !== ""
        )
      )
    ];
  }

  function chunkArray(values, size) {
    if (!Array.isArray(values)) {
      throw new Error(
        "Expected an array."
      );
    }

    const chunks = [];

    for (
      let index = 0;
      index < values.length;
      index += size
    ) {
      chunks.push(
        values.slice(index, index + size)
      );
    }

    return chunks;
  }

  function safeFilePart(value) {
    return clean(value)
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "Unknown";
  }


  // ==========================================================
  // 4. FORMATTING
  // ==========================================================

  function formatNumber(value, digits = 0) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "—";
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "—";
    }

    return new Intl.NumberFormat(
      CONFIG.locale,
      {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }
    ).format(number);
  }

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat(
      CONFIG.locale,
      {
        timeZone: CONFIG.timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }
    ).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat(
      CONFIG.locale,
      {
        timeZone: CONFIG.timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    ).format(date);
  }

  function formatPackage(number, total) {
    const packageNumber = toInteger(number);
    const packageTotal = toInteger(total);

    if (
      packageNumber > 0 &&
      packageTotal > 0
    ) {
      return `${packageNumber}/${packageTotal}`;
    }

    return "—";
  }


  // ==========================================================
  // 5. SUPABASE CLIENT
  // ==========================================================

  function getClient() {
    if (typeof window.sb !== "function") {
      throw new Error(
        "Supabase helper sb() is unavailable."
      );
    }

    const client = window.sb();

    if (
      !client ||
      typeof client.from !== "function" ||
      !client.auth
    ) {
      throw new Error(
        "Invalid Supabase client."
      );
    }

    return client;
  }


  // ==========================================================
  // 6. TENANT CONTEXT
  // ==========================================================

  async function getActiveCompanyId(client) {
    if (!client?.auth) {
      throw new Error(
        "Supabase authentication is unavailable."
      );
    }

    const { data: authData, error: authError } =
      await client.auth.getUser();

    if (authError) {
      throw authError;
    }

    const userId = authData?.user?.id;

    if (!userId) {
      throw new Error(
        "User is not authenticated."
      );
    }

    const { data, error } = await client
      .from("user_profiles")
      .select("id, company_id, is_active")
      .eq("auth_user_id", userId)
      .eq("is_active", true)
      .limit(2);

    if (error) {
      throw error;
    }

    if (
      !Array.isArray(data) ||
      data.length !== 1
    ) {
      throw new Error(
        "A unique active user profile is required."
      );
    }

    return requireUuid(
      data[0].company_id,
      "Company ID"
    );
  }

  async function assertCompany(
    client,
    expectedCompanyId
  ) {
    const expected = requireUuid(
      expectedCompanyId,
      "Expected Company ID"
    );

    const actual = await getActiveCompanyId(
      client
    );

    if (actual !== expected) {
      throw new Error(
        "Active company changed. " +
        "Close and reopen the Picking List Generator."
      );
    }

    return actual;
  }


  // ==========================================================
  // 7. ORDER INPUT VALIDATION
  // ==========================================================

  function normalizeOrderIds(orderIds) {
    if (!Array.isArray(orderIds)) {
      throw new Error(
        "Order IDs must be supplied as an array."
      );
    }

    const ids = unique(
      orderIds.map(value =>
        requireUuid(value, "Order ID")
      )
    );

    if (!ids.length) {
      throw new Error(
        "No orders selected for picking."
      );
    }

    if (ids.length > CONFIG.maxOrders) {
      throw new Error(
        `A maximum of ${CONFIG.maxOrders} orders ` +
        "can be processed at once."
      );
    }

    return ids;
  }


  // ==========================================================
  // 8. PICKING OPTIONS VALIDATION
  // ==========================================================

  function normalizeOptions(options = {}) {
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      throw new Error(
        "Invalid picking options."
      );
    }

    const defaults = CONFIG.defaults;

    const pickingMethod =
      options.pickingMethod ??
      defaults.pickingMethod;

    const sortMethod =
      options.sortMethod ??
      defaults.sortMethod;

    const detailLevel =
      options.detailLevel ??
      defaults.detailLevel;

    const outputMode =
      options.outputMode ??
      defaults.outputMode;

    const groupBy =
      options.groupBy ??
      defaults.groupBy;

    if (!ALLOWED_METHODS.has(pickingMethod)) {
      throw new Error(
        "Unsupported picking method."
      );
    }

    if (!ALLOWED_SORTS.has(sortMethod)) {
      throw new Error(
        "Unsupported sorting method."
      );
    }

    if (!ALLOWED_DETAILS.has(detailLevel)) {
      throw new Error(
        "Unsupported detail level."
      );
    }

    if (!ALLOWED_OUTPUTS.has(outputMode)) {
      throw new Error(
        "Unsupported output mode."
      );
    }

    if (!ALLOWED_GROUPS.has(groupBy)) {
      throw new Error(
        "Unsupported grouping method."
      );
    }

    function booleanOption(key) {
      const value =
        options[key] ?? defaults[key];

      if (typeof value !== "boolean") {
        throw new Error(
          `${key} must be true or false.`
        );
      }

      return value;
    }

    return {
      pickingMethod,
      sortMethod,
      detailLevel,
      outputMode,
      groupBy,

      includeCheckboxes:
        booleanOption("includeCheckboxes"),

      includeMissing:
        booleanOption("includeMissing"),

      includeSummary:
        booleanOption("includeSummary"),

      separatePages:
        booleanOption("separatePages"),

      includeBarcodes:
        booleanOption("includeBarcodes")
    };
  }


  // ==========================================================
  // 9. STOCK AND ALLOCATION VALIDATION
  // ==========================================================

  const EXCLUDED_ALLOCATION_STATUSES = new Set([
    "cancelled",
    "canceled",
    "released",
    "rejected"
  ]);

function isActiveAllocation(allocation) {
  if (!allocation?.id) return false;

  const status = normalize(
    allocation.allocation_status
  );

  const activeStatuses = new Set([
    "allocated",
    "reserved"
  ]);

  const excludedStatuses = new Set([
    "cancelled",
    "canceled",
    "released",
    "rejected",
    "deallocated",
    "unallocated",
    "shipped",
    "delivered",
    "completed"
  ]);

  if (excludedStatuses.has(status)) {
    return false;
  }

  if (activeStatuses.has(status)) {
    return true;
  }

  throw new Error(
    `Unknown allocation status "${status || "(empty)"}" ` +
    `for allocation ${allocation.id}. ` +
    "Verify the status before generating a picking list."
  );
}

  function isValidPhysicalItem(item) {
    return Boolean(
      item &&
      isUuid(item.id) &&
      isUuid(item.company_id) &&
      isUuid(item.product_id)
    );
  }

  function validatePhysicalItem(
    item,
    companyId
  ) {
    if (!isValidPhysicalItem(item)) {
      throw new Error(
        "Allocation references an invalid physical item."
      );
    }

    if (
      String(item.company_id) !==
      String(companyId)
    ) {
      throw new Error(
        "Physical stock belongs to another company."
      );
    }

    return item;
  }


  // ==========================================================
  // 10. FIFO SOURCE RULES
  // ==========================================================

  /*
   * FIFO is handled by the existing Allocation Engine.
   *
   * The Picking List Generator must NEVER:
   *
   * - Select replacement stock independently.
   * - Reallocate an order.
   * - Choose a newer item instead of an allocated item.
   * - Modify reserved_at or received_at.
   * - Change allocation_status.
   *
   * received_at and inbound_date may be displayed
   * for audit purposes.
   *
   * Picking order is a warehouse walking sequence,
   * NOT a new FIFO allocation decision.
   */

  function getReceivedTimestamp(item) {
    const value =
      item?.received_at ||
      item?.inbound_date ||
      null;

    if (!value) return null;

    const timestamp = Date.parse(value);

    return Number.isFinite(timestamp)
      ? timestamp
      : null;
  }


  // ==========================================================
  // 11. LOCATION HELPERS
  // ==========================================================

  function getWarehouseName(warehouse) {
    return clean(
      warehouse?.name ||
      warehouse?.code ||
      "Unknown Warehouse"
    );
  }

  function getLocationCode(location) {
    return clean(
      location?.location_code ||
      location?.code ||
      "Unknown Location"
    );
  }

  function compareNatural(first, second) {
    return clean(first).localeCompare(
      clean(second),
      CONFIG.locale,
      {
        numeric: true,
        sensitivity: "base"
      }
    );
  }

  function compareWarehouseLocation(
    first,
    second
  ) {
    const warehouseCompare = compareNatural(
      first.warehouse_name,
      second.warehouse_name
    );

    if (warehouseCompare !== 0) {
      return warehouseCompare;
    }

    const locationCompare = compareNatural(
      first.location_code,
      second.location_code
    );

    if (locationCompare !== 0) {
      return locationCompare;
    }

    const skuCompare = compareNatural(
      first.sku,
      second.sku
    );

    if (skuCompare !== 0) {
      return skuCompare;
    }

    return (
      toInteger(first.package_number) -
      toInteger(second.package_number)
    );
  }


  // ==========================================================
  // 12. SAFE PICKING IDENTIFIERS
  // ==========================================================

  function createTemporaryReference() {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "");

    return `PICK-PREVIEW-${timestamp}`;
  }

  /*
   * Temporary references are for read-only previews.
   *
   * Permanent picking_tasks.id and task_number
   * must be created by the future authorised backend.
   *
   * Do not write temporary preview references
   * into picking_tasks or picking_task_lines.
   */


  // ==========================================================
  // END OF PART 1 OF 5
  //
  // PART 2:
  // - Load selected orders
  // - Load order lines
  // - Load existing allocations
  // - Load physical stock items
  // - Load warehouses and locations
  // - Validate tenant ownership
  //
  // Paste PART 2 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST GENERATOR
  // PART 2 OF 5
  // SUPABASE DATA LOADING
  // ==========================================================


  // ==========================================================
  // 13. QUERY HELPERS
  // ==========================================================

  async function requireQuery(query, label) {
    const { data, error } = await query;

    if (error) {
      throw new Error(
        `${label}: ${error.message}`
      );
    }

    return Array.isArray(data)
      ? data
      : [];
  }


  async function fetchInBatches(
    ids,
    batchSize,
    queryFactory,
    label
  ) {
    const result = [];

    for (const batch of chunkArray(
      ids,
      batchSize
    )) {
      if (!batch.length) continue;

      const rows = await requireQuery(
        queryFactory(batch),
        label
      );

      result.push(...rows);
    }

    return result;
  }


  function makeMap(rows, key = "id") {
    const map = new Map();

    for (const row of rows || []) {
      const id = row?.[key];

      if (id == null) continue;

      const normalizedId = String(id);

      if (map.has(normalizedId)) {
        throw new Error(
          `Duplicate ${key}: ${normalizedId}`
        );
      }

      map.set(normalizedId, row);
    }

    return map;
  }


  function groupRows(rows, key) {
    const map = new Map();

    for (const row of rows || []) {
      const value = row?.[key];

      if (value == null) continue;

      const id = String(value);

      if (!map.has(id)) {
        map.set(id, []);
      }

      map.get(id).push(row);
    }

    return map;
  }


  function assertTenantRows(
    rows,
    companyId,
    label
  ) {
    for (const row of rows || []) {
      if (
        String(row.company_id || "") !==
        String(companyId)
      ) {
        throw new Error(
          `${label} contains data from another company.`
        );
      }
    }

    return rows;
  }


  // ==========================================================
  // 14. LOAD SELECTED ORDERS
  // ==========================================================

  
async function fetchPickingOrders(
  client,
  companyId,
  orderIds
) {
  const orders = await fetchInBatches(
    orderIds,
    CONFIG.queryBatchSize,

    batch => client
      .from("orders")
      .select(`
        id,
        company_id,
        customer_id,
        order_number,
        external_reference,
        status,
        overall_status,
        warehouse_status,
        transport_status,
        transport_type,
        route_id,
        retail_name,
        delivery_address_1,
        delivery_address_2,
        delivery_address_3,
        delivery_address_4,
        delivery_city,
        delivery_postcode,
        delivery_country,
        created_at
      `)
      .eq("company_id", companyId)
      .in("id", batch),

    "Could not load picking orders"
  );

  assertTenantRows(
    orders,
    companyId,
    "Orders"
  );

  const orderMap = makeMap(orders);

  for (const orderId of orderIds) {
    if (!orderMap.has(String(orderId))) {
      throw new Error(
        `Selected order is unavailable: ${orderId}`
      );
    }
  }

  return orderIds.map(
    id => orderMap.get(String(id))
  );
}

  // ==========================================================
  // 15. LOAD ORDER LINES
  // ==========================================================

  async function fetchPickingOrderLines(
    client,
    companyId,
    orderIds
  ) {
    const lines = await fetchInBatches(
      orderIds,
      CONFIG.queryBatchSize,

      batch => client
        .from("order_lines")
        .select(`
          id,
          company_id,
          order_id,
          product_id,
          line_number,
          quantity_ordered,
          quantity_allocated,
          quantity_shipped,
          sku_base,
          description,
          packages_per_unit,
          total_packages,
          requested_package_no,
          requested_package_total,
          requested_package_label,
          line_type,
          manually_completed,
          scanned_packages,
          created_at
        `)
        .eq("company_id", companyId)
        .in("order_id", batch),

      "Could not load order lines"
    );

    assertTenantRows(
      lines,
      companyId,
      "Order lines"
    );

    const allowedOrderIds = new Set(
      orderIds.map(String)
    );

    for (const line of lines) {
      if (
        !allowedOrderIds.has(
          String(line.order_id)
        )
      ) {
        throw new Error(
          "Order line references an unselected order."
        );
      }
    }

    return lines.sort((first, second) => {
      const orderCompare = compareNatural(
        first.order_id,
        second.order_id
      );

      if (orderCompare !== 0) {
        return orderCompare;
      }

      return (
        toInteger(first.line_number) -
        toInteger(second.line_number)
      );
    });
  }


  // ==========================================================
  // 16. LOAD EXISTING ALLOCATIONS
  // ==========================================================

  async function fetchPickingAllocations(
    client,
    companyId,
    orderLines
  ) {
    const lineIds = unique(
      orderLines.map(line => line.id)
    );

    if (!lineIds.length) {
      return [];
    }

    const allocations = await fetchInBatches(
      lineIds,
      CONFIG.queryBatchSize,

      batch => client
        .from("order_allocations")
        .select(`
          id,
          company_id,
          order_line_id,
          item_id,
          stock_set_id,
          allocation_status,
          allocated_at
        `)
        .eq("company_id", companyId)
        .in("order_line_id", batch),

      "Could not load order allocations"
    );

    assertTenantRows(
      allocations,
      companyId,
      "Order allocations"
    );

    const allowedLineIds = new Set(
      lineIds.map(String)
    );

    const active = [];

    const allocationIds = new Set();

    for (const allocation of allocations) {
      if (
        !allowedLineIds.has(
          String(allocation.order_line_id)
        )
      ) {
        throw new Error(
          "Allocation references an unselected order line."
        );
      }

      if (!isActiveAllocation(allocation)) {
        continue;
      }

      if (allocationIds.has(allocation.id)) {
        throw new Error(
          "Duplicate active allocation detected."
        );
      }

      allocationIds.add(allocation.id);

      if (!isUuid(allocation.item_id)) {
        throw new Error(
          "Active allocation has no valid physical item ID."
        );
      }

      active.push(allocation);
    }

    if (active.length > CONFIG.maxItems) {
      throw new Error(
        `Picking contains more than ${CONFIG.maxItems} ` +
        "allocated items."
      );
    }

    return active;
  }


  // ==========================================================
  // 17. LOAD PHYSICAL STOCK ITEMS
  // ==========================================================


async function fetchPickingItems(
  client,
  companyId,
  allocations
) {
  const itemIds = unique(
    allocations.map(a => a.item_id)
  );

  if (!itemIds.length) return [];

  const columns = `
    id, company_id, product_id, physical_product_id,
    warehouse_id, location_id, stock_set_id,
    sku_unique, serial_number, batch_number,
    status, package_no, package_total, package_label,
    package_condition, condition_notes,
    is_match_blocked, match_block_reason,
    received_at, inbound_date, reserved_at,
    picked_at, loaded_at, shipped_at,
    linked_order_id, stock_variant
  `;

  const primaryItems = await fetchInBatches(
    itemIds,
    CONFIG.queryBatchSize,
    batch => client
      .from("items")
      .select(columns)
      .eq("company_id", companyId)
      .in("id", batch),
    "Could not load allocated items"
  );

  assertTenantRows(
    primaryItems,
    companyId,
    "Allocated items"
  );

  const primaryMap = makeMap(primaryItems);

  for (const allocation of allocations) {
    if (!primaryMap.has(String(allocation.item_id))) {
      throw new Error(
        `Allocated item not found: ${allocation.item_id}`
      );
    }
  }

  const physicalIds = unique(
    primaryItems.map(item => item.physical_product_id)
  );

  let relatedItems = [];

  if (physicalIds.length) {
    relatedItems = await fetchInBatches(
      physicalIds,
      CONFIG.queryBatchSize,
      batch => client
        .from("items")
        .select(columns)
        .eq("company_id", companyId)
        .in("physical_product_id", batch),
      "Could not load physical product packages"
    );

    assertTenantRows(
      relatedItems,
      companyId,
      "Physical product packages"
    );
  }

  const allItems = new Map();

  for (const item of [
    ...primaryItems,
    ...relatedItems
  ]) {
    validatePhysicalItem(item, companyId);
    allItems.set(String(item.id), item);
  }

  return [...allItems.values()];
}


  // ==========================================================
  // 18. LOAD STOCK SETS
  // ==========================================================

  async function fetchPickingStockSets(
    client,
    companyId,
    allocations,
    items
  ) {
    const setIds = unique([
      ...allocations.map(
        allocation => allocation.stock_set_id
      ),
      ...items.map(
        item => item.stock_set_id
      )
    ]);

    if (!setIds.length) {
      return [];
    }

    const sets = await fetchInBatches(
      setIds,
      CONFIG.queryBatchSize,

      batch => client
        .from("stock_sets")
        .select(`
          id,
          company_id,
          product_id,
          physical_product_id,
          set_code,
          status,
          package_total,
          package_count,
          warehouse_id,
          location_id,
          order_id,
          order_line_id,
          reserved_at,
          picked_at
        `)
        .eq("company_id", companyId)
        .in("id", batch),

      "Could not load stock sets"
    );

    assertTenantRows(
      sets,
      companyId,
      "Stock sets"
    );

    return sets;
  }


  // ==========================================================
  // 19. LOAD PRODUCTS
  // ==========================================================

  async function fetchPickingProducts(
    client,
    companyId,
    orderLines,
    items
  ) {
    const productIds = unique([
      ...orderLines.map(
        line => line.product_id
      ),
      ...items.map(
        item => item.product_id
      )
    ]);

    if (!productIds.length) {
      return [];
    }

    const products = await fetchInBatches(
      productIds,
      CONFIG.queryBatchSize,

      batch => client
        .from("products")
        .select(`
          id,
          company_id,
          customer_id,
          sku_base,
          name,
          description,
          barcode,
          barcode_value,
          qr_code_value,
          package_count,
          packages_per_unit,
          sales_units_per_package,
          package_1_qty,
          package_2_qty,
          package_3_qty,
          is_active        `)
        .eq("company_id", companyId)
        .in("id", batch),

      "Could not load products"
    );

    assertTenantRows(
      products,
      companyId,
      "Products"
    );

    return products;
  }


  // ==========================================================
  // 20. LOAD WAREHOUSES
  // ==========================================================

  async function fetchPickingWarehouses(
    client,
    companyId,
    items,
    stockSets
  ) {
    const warehouseIds = unique([
      ...items.map(
        item => item.warehouse_id
      ),
      ...stockSets.map(
        set => set.warehouse_id
      )
    ]);

    if (!warehouseIds.length) {
      return [];
    }

    const warehouses = await fetchInBatches(
      warehouseIds,
      CONFIG.queryBatchSize,

      batch => client
        .from("warehouses")
        .select(`
          id,
          company_id,
          code,
          name,
          is_active
        `)
        .eq("company_id", companyId)
        .in("id", batch),

      "Could not load warehouses"
    );

    assertTenantRows(
      warehouses,
      companyId,
      "Warehouses"
    );

    return warehouses;
  }


  // ==========================================================
  // 21. LOAD WAREHOUSE LOCATIONS
  // ==========================================================

  async function fetchPickingLocations(
    client,
    companyId,
    items,
    stockSets
  ) {
    const locationIds = unique([
      ...items.map(
        item => item.location_id
      ),
      ...stockSets.map(
        set => set.location_id
      )
    ]);

    if (!locationIds.length) {
      return [];
    }

    const locations = await fetchInBatches(
      locationIds,
      CONFIG.queryBatchSize,

      batch => client
        .from("warehouse_locations")
        .select(`
          id,
          company_id,
          warehouse_id,
          location_code,
          code,
          zone,
          aisle,
          rack,
          level,
          bin,
          is_active
        `)
        .eq("company_id", companyId)
        .in("id", batch),

      "Could not load warehouse locations"
    );

    assertTenantRows(
      locations,
      companyId,
      "Warehouse locations"
    );

    return locations;
  }


  // ==========================================================
  // 22. LOAD PRODUCT OWNERS
  // ==========================================================

  async function fetchPickingProductOwners(
    client,
    companyId,
    orders
  ) {
    const customerIds = unique(
      orders.map(
        order => order.customer_id
      )
    );

    if (!customerIds.length) {
      return [];
    }

    const owners = await fetchInBatches(
      customerIds,
      CONFIG.queryBatchSize,

      batch => client
        .from("customers")
        .select(`
          id,
          company_id,
          name,
          customer_code
        `)
        .eq("company_id", companyId)
        .in("id", batch),

      "Could not load product owners"
    );

    assertTenantRows(
      owners,
      companyId,
      "Product owners"
    );

    return owners;
  }


  // ==========================================================
  // 23. BUILD DATA MAPS
  // ==========================================================

  function buildPickingMaps(data) {
    return {
      orders: makeMap(data.orders),

      orderLines: makeMap(data.orderLines),

      linesByOrder: groupRows(
        data.orderLines,
        "order_id"
      ),

      allocations: makeMap(
        data.allocations
      ),

      allocationsByLine: groupRows(
        data.allocations,
        "order_line_id"
      ),

      items: makeMap(data.items),

      stockSets: makeMap(
        data.stockSets
      ),

      products: makeMap(
        data.products
      ),

      warehouses: makeMap(
        data.warehouses
      ),

      locations: makeMap(
        data.locations
      ),

      productOwners: makeMap(
        data.productOwners
      )
    };
  }


  // ==========================================================
  // 24. CROSS-REFERENCE VALIDATION
  // ==========================================================

  function validatePickingReferences(
    data,
    maps,
    companyId
  ) {
    const activeItemAssignments = new Map();

    for (const allocation of data.allocations) {
      const line = maps.orderLines.get(
        String(allocation.order_line_id)
      );

      const item = maps.items.get(
        String(allocation.item_id)
      );

      if (!line || !item) {
        throw new Error(
          "Allocation has an unresolved order line or item."
        );
      }

      if (
        String(line.company_id) !==
        String(companyId) ||
        String(item.company_id) !==
        String(companyId)
      ) {
        throw new Error(
          "Cross-company allocation reference detected."
        );
      }

      const itemKey = String(item.id);

      const previous = activeItemAssignments.get(
        itemKey
      );

      if (previous) {
        throw new Error(
          "Physical stock item is actively allocated " +
          "more than once in the selected orders: " +
          itemKey
        );
      }

      activeItemAssignments.set(
        itemKey,
        allocation.id
      );

      if (
        allocation.stock_set_id &&
        item.stock_set_id &&
        String(allocation.stock_set_id) !==
        String(item.stock_set_id)
      ) {
        throw new Error(
          "Allocation and physical item reference " +
          "different stock sets."
        );
      }

      if (item.location_id) {
        const location = maps.locations.get(
          String(item.location_id)
        );

        if (
          location &&
          item.warehouse_id &&
          String(location.warehouse_id) !==
          String(item.warehouse_id)
        ) {
          throw new Error(
            "Physical item warehouse and location mismatch."
          );
        }
      }
    }

    return true;
  }


  // ==========================================================
  // 25. COMPLETE DATA LOADER
  // ==========================================================

  async function loadPickingData(
    orderIds,
    options = {}
  ) {
    const client = getClient();

    const normalizedOrderIds =
      normalizeOrderIds(orderIds);

    const normalizedOptions =
      normalizeOptions(options);

    const companyId =
      await getActiveCompanyId(client);

    // --------------------------------------------------------
    // Orders first
    // --------------------------------------------------------

    const orders = await fetchPickingOrders(
      client,
      companyId,
      normalizedOrderIds
    );

    const orderLines =
      await fetchPickingOrderLines(
        client,
        companyId,
        normalizedOrderIds
      );

    // --------------------------------------------------------
    // Existing FIFO allocations
    // --------------------------------------------------------

    const allocations =
      await fetchPickingAllocations(
        client,
        companyId,
        orderLines
      );

    // --------------------------------------------------------
    // Physical stock and reference data
    // --------------------------------------------------------

    const [
      items,
      productOwners
    ] = await Promise.all([

      fetchPickingItems(
        client,
        companyId,
        allocations
      ),

      fetchPickingProductOwners(
        client,
        companyId,
        orders
      )

    ]);

    const [
      stockSets,
      products
    ] = await Promise.all([

      fetchPickingStockSets(
        client,
        companyId,
        allocations,
        items
      ),

      fetchPickingProducts(
        client,
        companyId,
        orderLines,
        items
      )

    ]);


    // ========================================================
    // PART 2B
    // WAREHOUSES, LOCATIONS & FINAL DATA VALIDATION
    // ========================================================

    // --------------------------------------------------------
    // 26. LOAD WAREHOUSES AND LOCATIONS
    // --------------------------------------------------------

    const [
      warehouses,
      locations
    ] = await Promise.all([

      fetchPickingWarehouses(
        client,
        companyId,
        items,
        stockSets
      ),

      fetchPickingLocations(
        client,
        companyId,
        items,
        stockSets
      )

    ]);


    // --------------------------------------------------------
    // 27. BUILD COMPLETE DATA OBJECT
    // --------------------------------------------------------

    const data = {
      companyId,

      orderIds: normalizedOrderIds,

      options: normalizedOptions,

      orders,
      orderLines,
      allocations,
      items,
      stockSets,
      products,
      warehouses,
      locations,
      productOwners
    };


    // --------------------------------------------------------
    // 28. BUILD LOOKUP MAPS
    // --------------------------------------------------------

    const maps = buildPickingMaps(data);


    // --------------------------------------------------------
    // 29. VALIDATE ALLOCATION REFERENCES
    // --------------------------------------------------------

    validatePickingReferences(
      data,
      maps,
      companyId
    );


    // --------------------------------------------------------
    // 30. VALIDATE SELECTED ORDERS
    // --------------------------------------------------------

    const selectedOrderIds = new Set(
      normalizedOrderIds.map(String)
    );

    for (const line of orderLines) {
      if (
        !selectedOrderIds.has(
          String(line.order_id)
        )
      ) {
        throw new Error(
          "Order line does not belong to " +
          "the selected picking orders."
        );
      }
    }


    // --------------------------------------------------------
    // 31. VALIDATE PHYSICAL STOCK REFERENCES
    // --------------------------------------------------------

    for (const item of items) {
      validatePhysicalItem(
        item,
        companyId
      );

      if (item.warehouse_id) {
        const warehouse = maps.warehouses.get(
          String(item.warehouse_id)
        );

        if (!warehouse) {
          console.warn(
            "[PickingList] Warehouse not found:",
            item.warehouse_id
          );
        }
      }

      if (item.location_id) {
        const location = maps.locations.get(
          String(item.location_id)
        );

        if (!location) {
          console.warn(
            "[PickingList] Location not found:",
            item.location_id
          );
        }
      }
    }


    // --------------------------------------------------------
    // 32. RECHECK TENANT CONTEXT
    // --------------------------------------------------------

    await assertCompany(
      client,
      companyId
    );


    // --------------------------------------------------------
    // 33. RETURN VERIFIED DATA
    // --------------------------------------------------------

    return {
      ...data,

      maps,

      loadedAt: new Date().toISOString(),

      reference: createTemporaryReference(),

      statistics: {
        totalOrders: orders.length,
        totalOrderLines: orderLines.length,
        totalAllocations: allocations.length,
        totalPhysicalItems: items.length,
        totalStockSets: stockSets.length,
        totalWarehouses: warehouses.length,
        totalLocations: locations.length
      }
    };

  }


  // ==========================================================
  // 34. READ-ONLY DATA ACCESS
  // ==========================================================

  /*
   * loadPickingData() is the central data loader.
   *
   * All five picking methods must use this dataset.
   *
   * The generator must not create new allocations.
   * The generator must not modify physical stock.
   *
   * Future scanner assignments will use
   * a separate authorised backend workflow.
   */


  // ==========================================================
  // END OF PART 2 OF 5
  //
  // PART 3:
  // - Convert allocations into picking lines
  // - Resolve Warehouse and Location
  // - Handle package numbers
  // - Detect missing allocations
  // - Build five picking methods
  // - Sort and group picking results
  //
  // Paste PART 3 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST GENERATOR
  // PART 3 OF 5
  // PICKING LINES, GROUPING & SORTING
  // ==========================================================

  // ==========================================================
  // 35. PICKING LINE HELPERS
  // ==========================================================

  function getPickingSku(line, product, item) {
    return clean(
      line?.sku_base ||
      product?.sku_base ||
      item?.sku_unique ||
      "Unknown SKU"
    );
  }

  function getPickingDescription(line, product) {
    return clean(
      line?.description ||
      product?.description ||
      product?.name ||
      "No description"
    );
  }

  function getPickingBarcode(item, product) {
    return clean(
      item?.sku_unique ||
      product?.barcode_value ||
      product?.barcode ||
      ""
    );
  }

  function resolvePickingLocation(
    item,
    stockSet,
    maps
  ) {
    // The physical item is authoritative.
    // Stock set location is only a fallback.

    const warehouseId =
      item?.warehouse_id ||
      stockSet?.warehouse_id ||
      null;

    const locationId =
      item?.location_id ||
      stockSet?.location_id ||
      null;

    const warehouse = warehouseId
      ? maps.warehouses.get(String(warehouseId))
      : null;

    const location = locationId
      ? maps.locations.get(String(locationId))
      : null;

    if (
      warehouseId &&
      location &&
      String(location.warehouse_id) !==
        String(warehouseId)
    ) {
      throw new Error(
        "Warehouse and location mismatch."
      );
    }

    return {
      warehouse_id: warehouseId,
      location_id: locationId,

      warehouse_name:
        warehouse
          ? getWarehouseName(warehouse)
          : "Unknown Warehouse",

      location_code:
        location
          ? getLocationCode(location)
          : "Unknown Location",

      location_verified:
        Boolean(
          warehouse &&
          location &&
          warehouse.is_active !== false &&
          location.is_active !== false
        )
    };
  }


  // ==========================================================
  // 36. BUILD ONE PHYSICAL PICKING LINE
  // ==========================================================

function createPhysicalPickingLine(
  allocation,
  data
) {
  const maps = data.maps;

  const orderLine = maps.orderLines.get(
    String(allocation.order_line_id)
  );

  const item = maps.items.get(
    String(allocation.item_id)
  );

  if (!orderLine || !item) {
    throw new Error(
      "Picking allocation references missing data."
    );
  }

  const order = maps.orders.get(
    String(orderLine.order_id)
  );

  if (!order) {
    throw new Error(
      "Picking order could not be resolved."
    );
  }

  const stockStatus = normalize(item.status);

  const unavailableStatuses = new Set([
    "shipped",
    "delivered",
    "loaded",
    "picked",
    "damaged",
    "missing",
    "quarantine",
    "quarantined",
    "written_off",
    "scrapped"
  ]);

  if (
    unavailableStatuses.has(stockStatus) ||
    item.picked_at ||
    item.loaded_at ||
    item.shipped_at
  ) {
    throw new Error(
      `Item ${item.id} is not available for picking. ` +
      `Current status: ${stockStatus || "unknown"}.`
    );
  }

  if (item.is_match_blocked === true) {
    throw new Error(
      `Item ${item.id} is blocked for matching.`
    );
  }

  if (
    item.linked_order_id &&
    String(item.linked_order_id) !== String(order.id)
  ) {
    throw new Error(
      `Item ${item.id} is linked to another order.`
    );
  }

  const product = maps.products.get(
    String(orderLine.product_id || item.product_id)
  );

  const stockSetId =
    allocation.stock_set_id ||
    item.stock_set_id ||
    null;

  const stockSet = stockSetId
    ? maps.stockSets.get(String(stockSetId))
    : null;

  const location = resolvePickingLocation(
    item,
    stockSet,
    maps
  );

  const owner = order.customer_id
    ? maps.productOwners.get(
        String(order.customer_id)
      )
    : null;

  const packageNumber = toInteger(
    item.package_no ||
    orderLine.requested_package_no,
    0
  );

  const packageTotal = toInteger(
    item.package_total ||
    stockSet?.package_total ||
    orderLine.requested_package_total ||
    orderLine.packages_per_unit,
    0
  );

  return {
    id: allocation.id,

    company_id: data.companyId,

    allocation_id: allocation.id,

    order_id: order.id,
    order_line_id: orderLine.id,

    item_id: item.id,
    stock_set_id: stockSetId,

    product_id:
      orderLine.product_id ||
      item.product_id,

    order_number: clean(order.order_number),

    external_reference:
      clean(order.external_reference),

    product_owner_id:
      order.customer_id || null,

    product_owner_name:
      clean(owner?.name || ""),

    product_owner_code:
      clean(owner?.customer_code || ""),

    sku: getPickingSku(
      orderLine,
      product,
      item
    ),

    product_description:
      getPickingDescription(
        orderLine,
        product
      ),

    barcode: getPickingBarcode(
      item,
      product
    ),

    sku_unique: clean(item.sku_unique),

    package_number: packageNumber || null,
    package_total: packageTotal || null,

    package_label: clean(
      item.package_label ||
      orderLine.requested_package_label ||
      formatPackage(
        packageNumber,
        packageTotal
      )
    ),

    quantity_required: 1,
    quantity_picked: 0,
    quantity_short: 0,

    status: "pending",

    warehouse_id: location.warehouse_id,
    location_id: location.location_id,

    warehouse_name: location.warehouse_name,
    location_code: location.location_code,

    location_verified:
      location.location_verified,

    stock_status: clean(item.status),

    package_condition:
      clean(item.package_condition),

    is_match_blocked:
      item.is_match_blocked === true,

    received_at:
      item.received_at ||
      item.inbound_date ||
      null,

    received_timestamp:
      getReceivedTimestamp(item),

    allocated_at: allocation.allocated_at,

    allocation_status:
      allocation.allocation_status,

    is_missing: false,
    is_physical: true
  };
}

  // ==========================================================
  // 37. BUILD ALLOCATED PICKING LINES
  // ==========================================================



function getAllocatedPhysicalPackages(
  allocation,
  data
) {
  const primary = data.maps.items.get(
    String(allocation.item_id)
  );

  if (!primary) {
    throw new Error(
      `Allocated item not found: ${allocation.item_id}`
    );
  }

  const orderLine = data.maps.orderLines.get(
    String(allocation.order_line_id)
  );

  if (!orderLine) {
    throw new Error(
      "Allocation order line not found."
    );
  }

  const orderId = String(orderLine.order_id);

  const allowedConditions = new Set([
    "complete",
    "open_complete"
  ]);

  function validatePackage(item) {
    if (
      String(item.company_id) !==
      String(data.companyId)
    ) {
      throw new Error(
        `Package ${item.id} belongs to another company.`
      );
    }

    if (normalize(item.status) !== "reserved") {
      throw new Error(
        `Package ${item.id} is not reserved. ` +
        `Current status: ${item.status || "unknown"}.`
      );
    }

    if (
      String(item.linked_order_id || "") !==
      orderId
    ) {
      throw new Error(
        `Package ${item.id} is not reserved ` +
        `for the selected order.`
      );
    }

    if (item.is_match_blocked === true) {
      throw new Error(
        `Package ${item.id} is blocked for matching.`
      );
    }

    const condition = normalize(
      item.package_condition || "complete"
    );

    if (!allowedConditions.has(condition)) {
      throw new Error(
        `Package ${item.id} has an invalid condition: ` +
        `${condition}.`
      );
    }

    if (
      item.picked_at ||
      item.loaded_at ||
      item.shipped_at
    ) {
      throw new Error(
        `Package ${item.id} has already been ` +
        `picked, loaded or shipped.`
      );
    }

    if (
      String(item.product_id || "") !==
      String(primary.product_id || "")
    ) {
      throw new Error(
        `Product mismatch in physical set ` +
        `${primary.physical_product_id || primary.id}.`
      );
    }

    return true;
  }

  // The primary allocated item must always be valid.
  validatePackage(primary);

  const requestedPackageNo = toInteger(
    orderLine.requested_package_no
  );

  const requestedPackageTotal = toInteger(
    orderLine.requested_package_total
  );

  // A spare-part order only needs its requested package.
  if (
    requestedPackageNo > 0 &&
    requestedPackageTotal > 0
  ) {
    if (
      toInteger(primary.package_no) !==
        requestedPackageNo ||
      toInteger(primary.package_total) !==
        requestedPackageTotal
    ) {
      throw new Error(
        `Allocated package does not match ` +
        `the requested package for order line ${orderLine.id}.`
      );
    }

    return [primary];
  }

  // Legacy or single-package items without a physical ID.
  if (!primary.physical_product_id) {
    return [primary];
  }

  const physicalId = String(
    primary.physical_product_id
  );

  const related = data.items.filter(item =>
    String(item.physical_product_id || "") ===
    physicalId
  );

  const packages = related.filter(item =>
    normalize(item.status) === "reserved" &&
    String(item.linked_order_id || "") === orderId
  );

  if (!packages.some(item =>
    String(item.id) === String(primary.id)
  )) {
    throw new Error(
      `Primary item ${primary.id} is missing ` +
      `from the reserved physical set.`
    );
  }

  const expectedTotal = Math.max(
    1,
    toInteger(primary.package_total, 1)
  );

  const packageNumbers = new Set();

  for (const item of packages) {
    validatePackage(item);

    const number = toInteger(item.package_no);

    if (
      number < 1 ||
      number > expectedTotal ||
      packageNumbers.has(number)
    ) {
      throw new Error(
        `Invalid or duplicate package number ` +
        `in physical set ${physicalId}.`
      );
    }

    if (
      toInteger(item.package_total) !==
      expectedTotal
    ) {
      throw new Error(
        `Package total mismatch in physical set ${physicalId}.`
      );
    }

    packageNumbers.add(number);
  }

  if (packageNumbers.size !== expectedTotal) {
    throw new Error(
      `Incomplete reserved product set ${physicalId}: ` +
      `${packageNumbers.size}/${expectedTotal} packages.`
    );
  }

  return packages.sort(
    (a, b) =>
      toInteger(a.package_no) -
      toInteger(b.package_no)
  );
}


function createPickingLineForPackage(
  allocation,
  item,
  data
) {
  const line = createPhysicalPickingLine(
    allocation,
    data
  );

  const stockSet = item.stock_set_id
    ? data.maps.stockSets.get(
        String(item.stock_set_id)
      )
    : null;

  const location = resolvePickingLocation(
    item,
    stockSet,
    data.maps
  );

  const packageNumber = toInteger(
    item.package_no
  );

  const packageTotal = toInteger(
    item.package_total
  );

  return {
    ...line,

    id: `${allocation.id}:${item.id}`,
    item_id: item.id,

    stock_set_id:
      item.stock_set_id ||
      allocation.stock_set_id ||
      null,

    sku_unique: clean(item.sku_unique),

    package_number: packageNumber || null,
    package_total: packageTotal || null,

    package_label: clean(
      item.package_label ||
      formatPackage(
        packageNumber,
        packageTotal
      )
    ),

    warehouse_id: location.warehouse_id,
    location_id: location.location_id,

    warehouse_name: location.warehouse_name,
    location_code: location.location_code,

    location_verified:
      location.location_verified,

    stock_status: clean(item.status),

    package_condition:
      clean(item.package_condition),

    is_match_blocked:
      item.is_match_blocked === true,

    received_at:
      item.received_at ||
      item.inbound_date ||
      null,

    received_timestamp:
      getReceivedTimestamp(item),

    quantity_required: 1,
    quantity_picked: 0,
    quantity_short: 0,

    is_physical: true,
    is_missing: false
  };
}



function buildAllocatedPickingLines(data) {
  const lines = [];

  const seenAllocations = new Set();
  const seenItems = new Set();

  for (const allocation of data.allocations) {
    if (!isActiveAllocation(allocation)) {
      continue;
    }

    if (seenAllocations.has(String(allocation.id))) {
      throw new Error(
        `Duplicate allocation: ${allocation.id}`
      );
    }

    seenAllocations.add(String(allocation.id));

    const packages = getAllocatedPhysicalPackages(
      allocation,
      data
    );

    for (const item of packages) {
      const itemId = String(item.id);

      if (seenItems.has(itemId)) {
        throw new Error(
          `Physical package ${itemId} appears ` +
          "in multiple picking allocations."
        );
      }

      seenItems.add(itemId);

      lines.push(
        createPickingLineForPackage(
          allocation,
          item,
          data
        )
      );
    }
  }

  if (lines.length > CONFIG.maxItems) {
    throw new Error(
      `Picking list exceeds ${CONFIG.maxItems} packages.`
    );
  }

  return lines;
}


  // ==========================================================
  // 38. REQUIRED PACKAGE COUNT
  // ==========================================================

function getRequiredPackageCount(line, product) {
  const quantity = Math.max(
    0,
    toNumber(line.quantity_ordered)
  );

  if (
    toInteger(line.requested_package_no) > 0 &&
    toInteger(line.requested_package_total) > 0
  ) {
    return Math.ceil(quantity);
  }

  const salesUnitsPerPackage = Math.max(
    1,
    toNumber(product?.sales_units_per_package, 1)
  );

  const stockUnits = Math.ceil(
    quantity / salesUnitsPerPackage
  );

  const packagesPerUnit = Math.max(
    1,
    toInteger(
      product?.package_count ||
      product?.packages_per_unit ||
      line.packages_per_unit,
      1
    )
  );

  return stockUnits * packagesPerUnit;
}

  // ==========================================================
  // 39. BUILD MISSING PICKING LINES
  // ==========================================================

  function buildMissingPickingLines(data) {
  const result = [];
  const maps = data.maps;

  for (const line of data.orderLines) {
    if (
      normalize(line.line_type) === "manual" ||
      normalize(line.sku_base) === "miscellaneous" ||
      line.manually_completed === true
    ) {
      continue;
    }

    const order = maps.orders.get(
      String(line.order_id)
    );

    if (!order) continue;

    const product = line.product_id
      ? maps.products.get(String(line.product_id))
      : null;

    const required = getRequiredPackageCount(
      line,
      product
    );

    const allocations =
      maps.allocationsByLine.get(String(line.id)) || [];

    const allocatedItemIds = new Set();

    for (const allocation of allocations) {
      const packages = getAllocatedPhysicalPackages(
        allocation,
        data
      );

      for (const item of packages) {
        allocatedItemIds.add(String(item.id));
      }
    }

    const missing = Math.max(
      0,
      required - allocatedItemIds.size
    );

    if (!missing) continue;

    const owner = order.customer_id
      ? maps.productOwners.get(
          String(order.customer_id)
        )
      : null;

    result.push({
      id: `missing-${line.id}`,

      company_id: data.companyId,

      allocation_id: null,
      item_id: null,
      stock_set_id: null,

      order_id: order.id,
      order_line_id: line.id,
      product_id: line.product_id || null,

      order_number: clean(order.order_number),
      external_reference:
        clean(order.external_reference),

      product_owner_id:
        order.customer_id || null,

      product_owner_name:
        clean(owner?.name || ""),

      product_owner_code:
        clean(owner?.customer_code || ""),

      sku: getPickingSku(line, product, null),

      product_description:
        getPickingDescription(line, product),

      barcode: "",
      sku_unique: "",

      package_number:
        toInteger(line.requested_package_no) || null,

      package_total:
        toInteger(
          line.requested_package_total ||
          line.packages_per_unit
        ) || null,

      package_label:
        clean(line.requested_package_label),

      quantity_required: missing,
      quantity_picked: 0,
      quantity_short: missing,

      status: "short_pick",

      warehouse_id: null,
      location_id: null,

      warehouse_name: "Unallocated",
      location_code: "No Location",
      location_verified: false,

      stock_status: "missing",
      package_condition: "",
      is_match_blocked: false,

      received_at: null,
      received_timestamp: null,
      allocated_at: null,
      allocation_status: null,

      is_missing: true,
      is_physical: false
    });
  }

  return result;
}


  // ==========================================================
  // 40. BUILD COMPLETE PICKING LINES
  // ==========================================================

  function buildPickingLines(data) {
    const allocated =
      buildAllocatedPickingLines(data);

    const missing =
      buildMissingPickingLines(data);

    const allLines = [
      ...allocated,
      ...(data.options.includeMissing
        ? missing
        : [])
    ];

    return {
      allocated,
      missing,
      lines: allLines
    };
  }


  // ==========================================================
  // 41. PICKING LINE COMPARATORS
  // ==========================================================

  function compareByOrder(first, second) {
    return (
      compareNatural(
        first.order_number,
        second.order_number
      ) ||
      compareWarehouseLocation(
        first,
        second
      )
    );
  }

  function compareByProduct(first, second) {
    return (
      compareNatural(
        first.sku,
        second.sku
      ) ||
      compareWarehouseLocation(
        first,
        second
      ) ||
      compareNatural(
        first.order_number,
        second.order_number
      )
    );
  }

  function compareByWarehouse(first, second) {
    return (
      compareNatural(
        first.warehouse_name,
        second.warehouse_name
      ) ||
      compareNatural(
        first.location_code,
        second.location_code
      ) ||
      compareNatural(
        first.sku,
        second.sku
      )
    );
  }

  function compareByOwner(first, second) {
    return (
      compareNatural(
        first.product_owner_name,
        second.product_owner_name
      ) ||
      compareWarehouseLocation(
        first,
        second
      )
    );
  }


  // ==========================================================
  // 42. SORT PICKING LINES
  // ==========================================================

function sortPickingLines(lines, options) {
  const result = [...lines];

  const method = options.pickingMethod;
  const sortMethod = options.sortMethod;

  function compareWithinGroup(a, b) {
    if (sortMethod === "sku") {
      return (
        compareNatural(a.sku, b.sku) ||
        compareWarehouseLocation(a, b) ||
        compareNatural(
          a.order_number,
          b.order_number
        )
      );
    }

    if (sortMethod === "order") {
      return (
        compareNatural(
          a.order_number,
          b.order_number
        ) ||
        compareWarehouseLocation(a, b)
      );
    }

    return (
      compareWarehouseLocation(a, b) ||
      compareNatural(
        a.order_number,
        b.order_number
      )
    );
  }

  const groupValue = line => {
    switch (method) {
      case "by_order":
        return line.order_number;

      case "by_product":
        return line.sku;

      case "by_warehouse":
        return line.warehouse_name;

      case "by_order_group":
        return line.product_owner_name;

      case "by_location":
      default:
        return (
          line.warehouse_name +
          "|" +
          line.location_code
        );
    }
  };

  return result.sort((a, b) => {
    // Unallocated items always appear last.
    if (a.is_missing !== b.is_missing) {
      return a.is_missing ? 1 : -1;
    }

    const groupCompare = compareNatural(
      groupValue(a),
      groupValue(b)
    );

    if (groupCompare !== 0) {
      return groupCompare;
    }

    return compareWithinGroup(a, b);
  });
}

  // ==========================================================
  // 43. GROUP KEY HELPERS
  // ==========================================================

  function getPickingGroupKey(
    line,
    method
  ) {
    switch (method) {
      case "by_order":
        return `order:${line.order_id}`;

      case "by_product":
        return `product:${line.sku}`;

      case "by_warehouse":
        return `warehouse:${
          line.warehouse_id || "unknown"
        }`;

      case "by_order_group":
        return `owner:${
          line.product_owner_id || "unknown"
        }`;

      case "by_location":
      default:
        return [
          "location",
          line.warehouse_id || "unknown",
          line.location_id || "unknown"
        ].join(":");
    }
  }


  // ==========================================================
  // 44. GROUP TITLE HELPERS
  // ==========================================================

  function getPickingGroupTitle(
    line,
    method
  ) {
    switch (method) {
      case "by_order":
        return (
          `Order ${line.order_number || "Unknown"}`
        );

      case "by_product":
        return (
          `${line.sku} - ${line.product_description}`
        );

      case "by_warehouse":
        return line.warehouse_name;

      case "by_order_group":
        return (
          line.product_owner_name ||
          "Unknown Product Owner"
        );

      case "by_location":
      default:
        return (
          `${line.warehouse_name} / ` +
          `${line.location_code}`
        );
    }
  }


  // ==========================================================
  // 45. BUILD PICKING GROUPS
  // ==========================================================

function consolidatePickingLines(lines) {
  const groups = new Map();

  for (const line of lines) {
    // Unallocated lines are kept separate per order line.
    const key = line.is_missing
      ? [
          "missing",
          line.order_line_id
        ].join("|")
      : [
          line.company_id,
          line.product_owner_id || "",
          line.warehouse_id || "",
          line.location_id || "",
          line.product_id || line.sku,
          line.package_number ?? "",
          line.package_total ?? ""
        ].join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        ...line,

        quantity_required: 0,
        quantity_picked: 0,
        quantity_short: 0,

        source_lines: [],
        order_numbers: [],
        order_ids: [],
        item_ids: [],
        allocation_ids: [],

        consolidated: true
      });
    }

    const group = groups.get(key);

    group.quantity_required +=
      toInteger(line.quantity_required);

    group.quantity_picked +=
      toInteger(line.quantity_picked);

    group.quantity_short +=
      toInteger(line.quantity_short);

    group.source_lines.push(line);

    if (
      line.order_number &&
      !group.order_numbers.includes(
        line.order_number
      )
    ) {
      group.order_numbers.push(
        line.order_number
      );
    }

    if (
      line.order_id &&
      !group.order_ids.includes(line.order_id)
    ) {
      group.order_ids.push(line.order_id);
    }

    if (
      line.item_id &&
      !group.item_ids.includes(line.item_id)
    ) {
      group.item_ids.push(line.item_id);
    }

    if (
      line.allocation_id &&
      !group.allocation_ids.includes(
        line.allocation_id
      )
    ) {
      group.allocation_ids.push(
        line.allocation_id
      );
    }
  }

  return [...groups.values()].map(group => ({
    ...group,

    order_numbers: group.order_numbers.sort(
      compareNatural
    ),

    order_number:
      group.order_numbers.join(", "),

    order_count: group.order_numbers.length,

    item_count: group.item_ids.length
  }));
}

function buildPickingGroups(lines, options) {
  const method = options.pickingMethod;

  const sorted = sortPickingLines(
    lines,
    options
  );

  const groups = new Map();

  for (const line of sorted) {
    const key = getPickingGroupKey(
      line,
      method
    );

    if (!groups.has(key)) {
      groups.set(key, {
        key,

        title: getPickingGroupTitle(
          line,
          method
        ),

        method,

        warehouse_id: line.warehouse_id,
        warehouse_name: line.warehouse_name,

        location_id: line.location_id,
        location_code: line.location_code,

        lines: [],
        source_lines: [],

        total_packages: 0,
        missing_packages: 0
      });
    }

    const group = groups.get(key);

    group.source_lines.push(line);

    if (line.is_missing) {
      group.missing_packages +=
        line.quantity_required;
    } else {
      group.total_packages +=
        line.quantity_required;
    }
  }

  for (const group of groups.values()) {
    if (method === "by_order") {
      group.lines = sortPickingLines(
        group.source_lines,
        options
      );
    } else {
      group.lines = sortPickingLines(
        consolidatePickingLines(
          group.source_lines
        ),
        options
      );
    }
  }

  return [...groups.values()];
}

  // ==========================================================
  // 46. BUILD PICKING SUMMARY
  // ==========================================================

  function buildPickingSummary(
    data,
    picking
  ) {
    const allocatedPackages =
      picking.allocated.reduce(
        (sum, line) =>
          sum + line.quantity_required,
        0
      );

    const missingPackages =
      picking.missing.reduce(
        (sum, line) =>
          sum + line.quantity_required,
        0
      );

    const warehouseIds = new Set(
      picking.allocated
        .map(line => line.warehouse_id)
        .filter(Boolean)
    );

    const locationKeys = new Set(
      picking.allocated
        .filter(line =>
          line.warehouse_id &&
          line.location_id
        )
        .map(line =>
          `${line.warehouse_id}:${line.location_id}`
        )
    );

    return {
      total_orders: data.orders.length,

      total_order_lines:
        data.orderLines.length,

      total_allocations:
        data.allocations.length,

      allocated_packages:
        allocatedPackages,

      missing_packages:
        missingPackages,

      total_required_packages:
        allocatedPackages + missingPackages,

      total_warehouses:
        warehouseIds.size,

      total_locations:
        locationKeys.size,

      has_missing:
        missingPackages > 0,

      has_unverified_locations:
        picking.allocated.some(
          line => !line.location_verified
        )
    };
  }


  // ==========================================================
  // 47. BUILD COMPLETE PICKING DOCUMENT
  // ==========================================================

  function preparePickingDocument(data) {
    const picking = buildPickingLines(
      data
    );

    const groups = buildPickingGroups(
      picking.lines,
      data.options
    );

    const summary = buildPickingSummary(
      data,
      picking
    );

    return {
      reference: data.reference,

      company_id: data.companyId,

      generated_at:
        new Date().toISOString(),

      picking_method:
        data.options.pickingMethod,

      options: data.options,

      orders: data.orders,

      groups,

      lines: picking.lines,

      allocated_lines:
        picking.allocated,

      missing_lines:
        picking.missing,

      summary,

      read_only: true,

      fifo_source:
        "existing_allocations"
    };
  }


  // ==========================================================
  // END OF PART 3 OF 5
  //
  // PART 4:
  // - Veynor PDF design
  // - Header and branding
  // - Picking group tables
  // - Page breaks
  // - Picking checkboxes
  // - Summary and missing stock
  //
  // Paste PART 4 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST GENERATOR
  // PART 4 OF 5
  // PDF DESIGN AND RENDERING
  // ==========================================================

  // ==========================================================
  // 48. PDF CONSTANTS
  // ==========================================================

  const PDF = CONFIG.pdf;

  const PDF_LEFT = PDF.marginLeft;
  const PDF_RIGHT = PDF.pageWidth - PDF.marginRight;
  const PDF_WIDTH = PDF_RIGHT - PDF_LEFT;

  const PDF_CONTENT_TOP = 49;
  const PDF_CONTENT_BOTTOM = 267;

  const PDF_METHOD_LABELS = Object.freeze({
    by_order: "By Order",
    by_location: "By Warehouse Location",
    by_product: "By Product / SKU",
    by_warehouse: "By Warehouse",
    by_order_group: "By Order Group"
  });


  // ==========================================================
  // 49. PDF COLOR HELPERS
  // ==========================================================

  function pdfTextColor(doc, color) {
    doc.setTextColor(...color);
  }

  function pdfFillColor(doc, color) {
    doc.setFillColor(...color);
  }

  function pdfDrawColor(doc, color) {
    doc.setDrawColor(...color);
  }

  function pdfFont(
    doc,
    size = 9,
    weight = "normal"
  ) {
    doc.setFont(PDF.font, weight);
    doc.setFontSize(size);
  }


  // ==========================================================
  // 50. SAFE PDF TEXT
  // ==========================================================

  function pdfText(value) {
    return clean(value)
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201c|\u201d/g, '"');
  }

  function pdfFitText(
    doc,
    value,
    maxWidth
  ) {
    const text = pdfText(value);

    if (!text) return "";

    if (
      doc.getTextWidth(text) <= maxWidth
    ) {
      return text;
    }

    let result = text;

    while (
      result.length > 1 &&
      doc.getTextWidth(result + "...") > maxWidth
    ) {
      result = result.slice(0, -1);
    }

    return result + "...";
  }

  function pdfWrappedLines(
    doc,
    value,
    width
  ) {
    const text = pdfText(value);

    if (!text) return [];

    return doc.splitTextToSize(
      text,
      width
    );
  }


  // ==========================================================
  // 51. PDF HEADER
  // ==========================================================

  function drawPickingHeader(
    doc,
    document,
    pageNumber
  ) {
    const colors = PDF.colors;

    pdfFillColor(
      doc,
      colors.navy
    );

    doc.rect(
      0,
      0,
      PDF.pageWidth,
      37,
      "F"
    );

    pdfFillColor(
      doc,
      colors.blue
    );

    doc.rect(
      0,
      37,
      PDF.pageWidth,
      2,
      "F"
    );

    pdfTextColor(
      doc,
      colors.white
    );

    pdfFont(
      doc,
      19,
      "bold"
    );

    doc.text(
      "VEYNOR",
      PDF_LEFT,
      18
    );

    pdfFont(
      doc,
      7,
      "normal"
    );

    doc.text(
      "MOVE BUSINESS FORWARD",
      PDF_LEFT,
      24
    );

    pdfFont(
      doc,
      15,
      "bold"
    );

    doc.text(
      "PICKING LIST",
      PDF_RIGHT,
      17,
      {
        align: "right"
      }
    );

    pdfFont(
      doc,
      8,
      "normal"
    );

    doc.text(
      PDF_METHOD_LABELS[
        document.picking_method
      ] || "Picking List",
      PDF_RIGHT,
      24,
      {
        align: "right"
      }
    );

    pdfFont(
      doc,
      7,
      "normal"
    );

    doc.text(
      `Page ${pageNumber}`,
      PDF_RIGHT,
      31,
      {
        align: "right"
      }
    );

    pdfTextColor(
      doc,
      colors.dark
    );
  }


  // ==========================================================
  // 52. DOCUMENT INFORMATION
  // ==========================================================

  function drawPickingDocumentInfo(
    doc,
    document,
    y
  ) {
    const colors = PDF.colors;

    pdfFillColor(
      doc,
      colors.light
    );

    doc.roundedRect(
      PDF_LEFT,
      y,
      PDF_WIDTH,
      24,
      2,
      2,
      "F"
    );

    pdfTextColor(
      doc,
      colors.muted
    );

    pdfFont(
      doc,
      7,
      "bold"
    );

    doc.text(
      "PICKING REFERENCE",
      PDF_LEFT + 4,
      y + 6
    );

    doc.text(
      "GENERATED",
      PDF_LEFT + 94,
      y + 6
    );

    pdfTextColor(
      doc,
      colors.dark
    );

    pdfFont(
      doc,
      9,
      "bold"
    );

    doc.text(
      pdfFitText(
        doc,
        document.reference,
        84
      ),
      PDF_LEFT + 4,
      y + 13
    );

    doc.text(
      formatDateTime(
        document.generated_at
      ),
      PDF_LEFT + 94,
      y + 13
    );

    pdfFont(
      doc,
      7,
      "normal"
    );

    pdfTextColor(
      doc,
      colors.muted
    );

    doc.text(
      `${document.summary.total_orders} orders`,
      PDF_LEFT + 4,
      y + 20
    );

    doc.text(
      `${document.summary.allocated_packages} allocated packages`,
      PDF_LEFT + 94,
      y + 20
    );

    return y + 30;
  }


  // ==========================================================
  // 53. GROUP HEADER
  // ==========================================================

  function drawPickingGroupHeader(
    doc,
    group,
    y
  ) {
    const colors = PDF.colors;

    pdfFillColor(
      doc,
      colors.blue
    );

    doc.roundedRect(
      PDF_LEFT,
      y,
      PDF_WIDTH,
      12,
      1.5,
      1.5,
      "F"
    );

    pdfTextColor(
      doc,
      colors.white
    );

    pdfFont(
      doc,
      9,
      "bold"
    );

    doc.text(
      pdfFitText(
        doc,
        group.title,
        PDF_WIDTH - 51
      ),
      PDF_LEFT + 4,
      y + 7.7
    );

    pdfFont(
      doc,
      7,
      "normal"
    );

    const total =
      group.total_packages +
      group.missing_packages;

    doc.text(
      `${formatNumber(total)} packages`,
      PDF_RIGHT - 4,
      y + 7.7,
      {
        align: "right"
      }
    );

    pdfTextColor(
      doc,
      colors.dark
    );

    return y + 16;
  }


  // ==========================================================
  // 54. TABLE COLUMNS
  // ==========================================================

  function getPickingColumns(options) {
    const compact =
      options.detailLevel === "compact";

    if (compact) {
      return [
        {
          key: "location",
          title: "LOCATION",
          width: 30
        },
        {
          key: "sku",
          title: "SKU",
          width: 45
        },
        {
          key: "order",
          title: "ORDER",
          width: 43
        },
        {
          key: "quantity",
          title: "QTY",
          width: 18
        },
        {
          key: "picked",
          title: "PICK",
          width: 20
        }
      ];
    }

    return [
      {
        key: "location",
        title: "LOCATION",
        width: 29
      },
      {
        key: "sku",
        title: "SKU / DESCRIPTION",
        width: 64
      },
      {
        key: "order",
        title: "ORDER",
        width: 35
      },
      {
        key: "package",
        title: "PKG",
        width: 18
      },
      {
        key: "quantity",
        title: "QTY",
        width: 16
      },
      {
        key: "picked",
        title: "PICK",
        width: 20
      }
    ];
  }


  // ==========================================================
  // 55. TABLE HEADER
  // ==========================================================

  function drawPickingTableHeader(
    doc,
    columns,
    y
  ) {
    const colors = PDF.colors;

    pdfFillColor(
      doc,
      colors.light
    );

    doc.rect(
      PDF_LEFT,
      y,
      PDF_WIDTH,
      9,
      "F"
    );

    pdfTextColor(
      doc,
      colors.muted
    );

    pdfFont(
      doc,
      6.7,
      "bold"
    );

    let x = PDF_LEFT + 2;

    for (const column of columns) {
      doc.text(
        column.title,
        x,
        y + 5.8
      );

      x += column.width;
    }

    pdfTextColor(
      doc,
      colors.dark
    );

    return y + 9;
  }


  // ==========================================================
  // 56. ROW VALUE HELPERS
  // ==========================================================

function getPickingCellValue(line, key) {
  switch (key) {
    case "location":
      return line.location_code || "—";

    case "sku":
      return line.sku || "—";

    case "order": {
      const orders = line.order_numbers;

      if (
        Array.isArray(orders) &&
        orders.length > 0
      ) {
        if (orders.length <= 2) {
          return orders.join(", ");
        }

        return (
          `${orders.length} orders: ` +
          orders.join(", ")
        );
      }

      return line.order_number || "—";
    }

    case "package":
      return formatPackage(
        line.package_number,
        line.package_total
      );

    case "quantity":
      return formatNumber(
        line.quantity_required
      );

    default:
      return "";
  }
}

  // ==========================================================
  // 57. PICKING CHECKBOX
  // ==========================================================

  function drawPickingCheckbox(
    doc,
    x,
    y,
    enabled
  ) {
    if (!enabled) return;

    pdfDrawColor(
      doc,
      PDF.colors.muted
    );

    doc.setLineWidth(0.25);

    doc.rect(
      x,
      y,
      4,
      4
    );
  }


  // ==========================================================
  // 58. PICKING TABLE ROW
  // ==========================================================

function drawPickingTableRow(
  doc,
  line,
  columns,
  y,
  options,
  rowIndex
) {
  const colors = PDF.colors;

  const isFull =
    options.detailLevel === "full";

  const orderNumbers =
    Array.isArray(line.order_numbers)
      ? line.order_numbers
      : [line.order_number].filter(Boolean);

  const orderText = orderNumbers.join(", ");

  const orderColumn = columns.find(
    column => column.key === "order"
  );

  const orderWidth =
    (orderColumn?.width || 35) - 4;

  pdfFont(doc, 6.5, "normal");

  const orderLines = doc.splitTextToSize(
    pdfText(orderText),
    orderWidth
  );

  const extraOrderLines = Math.max(
    0,
    orderLines.length - 1
  );

  const baseHeight = isFull ? 15 : 10;

  const rowHeight = Math.max(
    baseHeight,
    9 + extraOrderLines * 4.5
  );

  if (rowIndex % 2 === 1) {
    pdfFillColor(doc, [249, 251, 255]);

    doc.rect(
      PDF_LEFT,
      y,
      PDF_WIDTH,
      rowHeight,
      "F"
    );
  }

  if (line.is_missing) {
    pdfFillColor(doc, [255, 245, 231]);

    doc.rect(
      PDF_LEFT,
      y,
      PDF_WIDTH,
      rowHeight,
      "F"
    );
  }

  let x = PDF_LEFT + 2;

  for (const column of columns) {
    const key = column.key;

    if (key === "picked") {
      drawPickingCheckbox(
        doc,
        x + 3,
        y + 3,
        options.includeCheckboxes &&
        !line.is_missing
      );

      x += column.width;
      continue;
    }

    pdfTextColor(
      doc,
      line.is_missing
        ? colors.orange
        : colors.dark
    );

    pdfFont(
      doc,
      7,
      key === "sku" ? "bold" : "normal"
    );

    if (key === "order") {
      pdfFont(doc, 6.5, "normal");

      orderLines.forEach(
        (text, index) => {
          doc.text(
            text,
            x,
            y + 5.5 + index * 4.5
          );
        }
      );
    } else {
      const value = getPickingCellValue(
        line,
        key
      );

      doc.text(
        pdfFitText(
          doc,
          value,
          column.width - 4
        ),
        x,
        y + 5.5
      );
    }

    if (key === "sku" && isFull) {
      pdfFont(doc, 6.3, "normal");

      pdfTextColor(doc, colors.muted);

      const description = line.is_missing
        ? "UNALLOCATED - " +
          line.product_description
        : line.product_description;

      doc.text(
        pdfFitText(
          doc,
          description,
          column.width - 4
        ),
        x,
        y + 11
      );
    }

    x += column.width;
  }

  pdfDrawColor(doc, colors.border);

  doc.setLineWidth(0.15);

  doc.line(
    PDF_LEFT,
    y + rowHeight,
    PDF_RIGHT,
    y + rowHeight
  );

  return y + rowHeight;
}

  // ==========================================================
  // 59. NEW PDF PAGE
  // ==========================================================

  function addPickingPage(
    doc,
    document
  ) {
    doc.addPage();

    const pageNumber =
      doc.getNumberOfPages();

    drawPickingHeader(
      doc,
      document,
      pageNumber
    );

    return PDF_CONTENT_TOP;
  }


  // ==========================================================
  // 60. PAGE SPACE CHECK
  // ==========================================================

  function ensurePickingSpace(
    doc,
    document,
    y,
    requiredHeight
  ) {
    if (
      y + requiredHeight <=
      PDF_CONTENT_BOTTOM
    ) {
      return y;
    }

    return addPickingPage(
      doc,
      document
    );
  }


  // ==========================================================
  // 61. DRAW ONE PICKING GROUP
  // ==========================================================


function getPickingRowHeight(
  doc,
  line,
  columns,
  options
) {
  const isFull =
    options.detailLevel === "full";

  const baseHeight = isFull ? 15 : 10;

  const orderNumbers =
    Array.isArray(line.order_numbers)
      ? line.order_numbers
      : [line.order_number].filter(Boolean);

  const orderText = orderNumbers.join(", ");

  const orderColumn = columns.find(
    column => column.key === "order"
  );

  const orderWidth =
    (orderColumn?.width || 35) - 4;

  pdfFont(doc, 6.5, "normal");

  const orderLines = doc.splitTextToSize(
    pdfText(orderText),
    orderWidth
  );

  const extraOrderLines = Math.max(
    0,
    orderLines.length - 1
  );

  return Math.max(
    baseHeight,
    9 + extraOrderLines * 4.5
  );
}



function drawPickingGroup(
  doc,
  document,
  group,
  startY
) {
  const options = document.options;

  const columns = getPickingColumns(options);

  let y = ensurePickingSpace(
    doc,
    document,
    startY,
    37
  );

  y = drawPickingGroupHeader(
    doc,
    group,
    y
  );

  y = drawPickingTableHeader(
    doc,
    columns,
    y
  );

  for (
    let index = 0;
    index < group.lines.length;
    index++
  ) {
    const line = group.lines[index];

    const rowHeight = getPickingRowHeight(
      doc,
      line,
      columns,
      options
    );

    const availableOnFreshPage =
      PDF_CONTENT_BOTTOM -
      PDF_CONTENT_TOP -
      25;

    if (rowHeight > availableOnFreshPage) {
      throw new Error(
        `Picking row is too large for one PDF page. ` +
        `SKU: ${line.sku || "unknown"}. ` +
        `Try generating smaller picking groups.`
      );
    }

    if (
      y + rowHeight >
      PDF_CONTENT_BOTTOM
    ) {
      y = addPickingPage(
        doc,
        document
      );

      y = drawPickingGroupHeader(
        doc,
        group,
        y
      );

      y = drawPickingTableHeader(
        doc,
        columns,
        y
      );
    }

    y = drawPickingTableRow(
      doc,
      line,
      columns,
      y,
      options,
      index
    );
  }

  return y + 6;
}


  // ==========================================================
  // 62. DRAW PICKING SUMMARY
  // ==========================================================

  function drawPickingSummary(
    doc,
    document,
    startY
  ) {
    if (!document.options.includeSummary) {
      return startY;
    }

    let y = ensurePickingSpace(
      doc,
      document,
      startY,
      42
    );

    const summary = document.summary;

    pdfFillColor(
      doc,
      PDF.colors.light
    );

    doc.roundedRect(
      PDF_LEFT,
      y,
      PDF_WIDTH,
      34,
      2,
      2,
      "F"
    );

    pdfTextColor(
      doc,
      PDF.colors.navy
    );

    pdfFont(
      doc,
      10,
      "bold"
    );

    doc.text(
      "PICKING SUMMARY",
      PDF_LEFT + 4,
      y + 7
    );

    pdfFont(
      doc,
      8,
      "normal"
    );

    const leftX = PDF_LEFT + 4;
    const rightX = PDF_LEFT + 96;

    doc.text(
      `Orders: ${summary.total_orders}`,
      leftX,
      y + 15
    );

    doc.text(
      `Allocated: ${summary.allocated_packages}`,
      leftX,
      y + 22
    );

    doc.text(
      `Missing: ${summary.missing_packages}`,
      leftX,
      y + 29
    );

    doc.text(
      `Warehouses: ${summary.total_warehouses}`,
      rightX,
      y + 15
    );

    doc.text(
      `Locations: ${summary.total_locations}`,
      rightX,
      y + 22
    );

    doc.text(
      `Required: ${summary.total_required_packages}`,
      rightX,
      y + 29
    );

    return y + 40;
  }


  // ==========================================================
  // 63. PICKING SIGNATURE
  // ==========================================================

  function drawPickingSignature(
    doc,
    document,
    startY
  ) {
    let y = ensurePickingSpace(
      doc,
      document,
      startY,
      25
    );

    pdfTextColor(
      doc,
      PDF.colors.dark
    );

    pdfFont(
      doc,
      8,
      "bold"
    );

    doc.text(
      "Picked by:",
      PDF_LEFT,
      y + 5
    );

    doc.text(
      "Date:",
      PDF_LEFT + 103,
      y + 5
    );

    pdfDrawColor(
      doc,
      PDF.colors.muted
    );

    doc.setLineWidth(0.25);

    doc.line(
      PDF_LEFT,
      y + 16,
      PDF_LEFT + 86,
      y + 16
    );

    doc.line(
      PDF_LEFT + 103,
      y + 16,
      PDF_RIGHT,
      y + 16
    );

    pdfFont(
      doc,
      7,
      "normal"
    );

    pdfTextColor(
      doc,
      PDF.colors.muted
    );

    doc.text(
      "Signature / employee name",
      PDF_LEFT,
      y + 21
    );

    doc.text(
      "Picking completion date",
      PDF_LEFT + 103,
      y + 21
    );

    return y + 27;
  }


  // ==========================================================
  // 64. PDF FOOTER
  // ==========================================================

  function drawPickingFooter(
    doc,
    document
  ) {
    const pageCount =
      doc.getNumberOfPages();

    for (
      let page = 1;
      page <= pageCount;
      page++
    ) {
      doc.setPage(page);

      pdfDrawColor(
        doc,
        PDF.colors.border
      );

      doc.setLineWidth(0.25);

      doc.line(
        PDF_LEFT,
        275,
        PDF_RIGHT,
        275
      );

      pdfTextColor(
        doc,
        PDF.colors.muted
      );

      pdfFont(
        doc,
        7,
        "normal"
      );

      doc.text(
        "VEYNOR | WAREHOUSE OPERATIONS",
        PDF_LEFT,
        282
      );

      doc.text(
        `Page ${page} of ${pageCount}`,
        PDF_RIGHT,
        282,
        {
          align: "right"
        }
      );

      pdfFont(
        doc,
        6.5,
        "normal"
      );

      doc.text(
        "Picking list generated from existing stock allocations.",
        PDF_LEFT,
        287
      );

      doc.text(
        "Stock is not adjusted by printing this document.",
        PDF_RIGHT,
        287,
        {
          align: "right"
        }
      );
    }
  }


  // ==========================================================
  // 65. DOCUMENT WARNINGS
  // ==========================================================

  function drawPickingWarnings(
    doc,
    document,
    startY
  ) {
    const warnings = [];

    if (document.summary.has_missing) {
      warnings.push(
        "Some requested packages are not allocated."
      );
    }

    if (
      document.summary.has_unverified_locations
    ) {
      warnings.push(
        "Some allocated items have unverified warehouse locations."
      );
    }

    if (!warnings.length) {
      return startY;
    }

    const boxHeight =
      9 + warnings.length * 7;

    let y = ensurePickingSpace(
      doc,
      document,
      startY,
      boxHeight + 5
    );

    pdfFillColor(
      doc,
      [255, 245, 231]
    );

    pdfDrawColor(
      doc,
      [245, 190, 110]
    );

    doc.roundedRect(
      PDF_LEFT,
      y,
      PDF_WIDTH,
      boxHeight,
      2,
      2,
      "FD"
    );

    pdfTextColor(
      doc,
      PDF.colors.orange
    );

    pdfFont(
      doc,
      8,
      "bold"
    );

    doc.text(
      "PICKING WARNINGS",
      PDF_LEFT + 4,
      y + 6
    );

    pdfFont(
      doc,
      7,
      "normal"
    );

    warnings.forEach(
      (warning, index) => {
        doc.text(
          pdfFitText(
            doc,
            warning,
            PDF_WIDTH - 8
          ),
          PDF_LEFT + 4,
          y + 13 + index * 7
        );
      }
    );

    return y + boxHeight + 6;
  }


  // ==========================================================
  // 66. RENDER COMPLETE PDF
  // ==========================================================

  function renderPickingPdf(document) {
    if (!window.jspdf?.jsPDF) {
      throw new Error(
        "jsPDF is not loaded."
      );
    }

    if (!document?.groups) {
      throw new Error(
        "Invalid picking document."
      );
    }

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
      orientation: PDF.orientation,
      unit: PDF.unit,
      format: PDF.format,
      compress: true
    });

    drawPickingHeader(
      doc,
      document,
      1
    );

    let y = PDF_CONTENT_TOP;

    y = drawPickingDocumentInfo(
      doc,
      document,
      y
    );

    if (!document.groups.length) {
      pdfTextColor(
        doc,
        PDF.colors.muted
      );

      pdfFont(
        doc,
        10,
        "normal"
      );

      doc.text(
        "No picking lines available.",
        PDF_LEFT,
        y + 10
      );

      y += 20;
    }

    for (
      let index = 0;
      index < document.groups.length;
      index++
    ) {
      const group =
        document.groups[index];

      if (
        document.options.separatePages &&
        index > 0
      ) {
        y = addPickingPage(
          doc,
          document
        );
      }

      y = drawPickingGroup(
        doc,
        document,
        group,
        y
      );
    }

    y = drawPickingWarnings(
      doc,
      document,
      y
    );

    y = drawPickingSummary(
      doc,
      document,
      y
    );

    y = drawPickingSignature(
      doc,
      document,
      y
    );

    drawPickingFooter(
      doc,
      document
    );

    return doc.output("blob");
  }


  // ==========================================================
  // END OF PART 4 OF 5
  //
  // PART 5:
  // - Generate picking document
  // - Validate PDF
  // - Download and print
  // - Expose public generator API
  // - Error handling
  // - Close the IIFE
  //
  // Paste PART 5 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST GENERATOR
  // PART 5 OF 5
  // GENERATION, DOWNLOAD, PRINT & PUBLIC API
  // ==========================================================

  // ==========================================================
  // 67. GENERATOR STATE
  // ==========================================================

  let activeGeneration = false;

  let lastGeneratedDocument = null;

  const PICKING_EVENTS = Object.freeze({
    START: "veynor:picking:start",
    COMPLETE: "veynor:picking:complete",
    ERROR: "veynor:picking:error"
  });


  // ==========================================================
  // 68. EVENT DISPATCH
  // ==========================================================

  function dispatchPickingEvent(
    eventName,
    detail = {}
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(
          eventName,
          {
            detail
          }
        )
      );
    } catch (error) {
      console.warn(
        "[Veynor Picking] Event dispatch failed:",
        error
      );
    }
  }


  // ==========================================================
  // 69. PDF BLOB VALIDATION
  // ==========================================================

  function validatePickingPdfBlob(blob) {
    if (!(blob instanceof Blob)) {
      throw new Error(
        "Picking generator did not return a PDF Blob."
      );
    }

    if (blob.size <= 0) {
      throw new Error(
        "Generated picking PDF is empty."
      );
    }

    if (
      blob.type &&
      blob.type !== "application/pdf"
    ) {
      throw new Error(
        "Generated document is not a PDF."
      );
    }

    return blob;
  }


  // ==========================================================
  // 70. GENERATE FILE NAME
  // ==========================================================

  function getPickingFileName(document) {
    const method =
      safeFilePart(
        document.picking_method ||
        "picking"
      );

    const date = new Date(
      document.generated_at
    );

    const datePart =
      Number.isNaN(date.getTime())
        ? new Date().toISOString().slice(0, 10)
        : date.toISOString().slice(0, 10);

    const reference =
      safeFilePart(
        document.reference ||
        "PickingList"
      );

    return (
      `Veynor-Picking-List-` +
      `${method}-` +
      `${datePart}-` +
      `${reference}.pdf`
    );
  }


  // ==========================================================
  // 71. DOWNLOAD PDF
  // ==========================================================

  function downloadPickingPdf(
    blob,
    fileName
  ) {
    validatePickingPdfBlob(blob);

    const url = URL.createObjectURL(blob);

    const anchor =
      document.createElement("a");

    anchor.href = url;

    anchor.download =
      safeFilePart(
        fileName.replace(/\.pdf$/i, "")
      ) + ".pdf";

    anchor.style.display = "none";

    document.body.appendChild(anchor);

    try {
      anchor.click();
    } finally {
      anchor.remove();

      window.setTimeout(
        () => URL.revokeObjectURL(url),
        60000
      );
    }
  }


  // ==========================================================
  // 72. PRINT PDF
  // ==========================================================

  function printPickingPdf(blob) {
    validatePickingPdfBlob(blob);

    const url = URL.createObjectURL(blob);

    const printWindow = window.open(
      "",
      "_blank"
    );

    if (!printWindow) {
      URL.revokeObjectURL(url);

      throw new Error(
        "Print window was blocked. " +
        "Allow popups and try again."
      );
    }

    printWindow.document.open();

    printWindow.document.write(`
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Veynor Picking List</title>
        <style>
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            background: #f3f6fb;
          }

          iframe {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
          }
        </style>
      </head>

      <body>
        <iframe
          id="pickingPdfFrame"
          title="Veynor Picking List"
        ></iframe>
      </body>
      </html>
    `);

    printWindow.document.close();

    const frame =
      printWindow.document.getElementById(
        "pickingPdfFrame"
      );

    frame.src = url;

    frame.addEventListener(
      "load",
      () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch (error) {
          console.warn(
            "[Veynor Picking] Automatic printing unavailable:",
            error
          );
        }
      },
      {
        once: true
      }
    );

    // Keep the URL alive while the print preview is open.
    // The user may need to print manually from the PDF viewer.

    const cleanup = () => {
      window.setTimeout(
        () => URL.revokeObjectURL(url),
        1000
      );
    };

    printWindow.addEventListener(
      "pagehide",
      cleanup,
      {
        once: true
      }
    );

    return true;
  }


  // ==========================================================
  // 73. BUILD READ-ONLY PICKING PREVIEW
  // ==========================================================

  async function preview(
    orderIds,
    options = {}
  ) {
    const data = await loadPickingData(
      orderIds,
      options
    );

    const documentData =
      preparePickingDocument(data);

    return {
      ...documentData,

      pdf: null,

      fileName:
        getPickingFileName(
          documentData
        ),

      preview_only: true
    };
  }


  // ==========================================================
  // 74. GENERATE PICKING PDF
  // ==========================================================

  async function generate(
    orderIds,
    options = {}
  ) {
    if (activeGeneration) {
      throw new Error(
        "Another picking document is being generated."
      );
    }

    activeGeneration = true;

    let normalizedOptions = null;

    try {
      normalizedOptions =
        normalizeOptions(options);

      const normalizedOrderIds =
        normalizeOrderIds(orderIds);

      dispatchPickingEvent(
        PICKING_EVENTS.START,
        {
          orderCount:
            normalizedOrderIds.length,

          pickingMethod:
            normalizedOptions.pickingMethod
        }
      );

      // ------------------------------------------------------
      // 1. LOAD VERIFIED ALLOCATIONS
      // ------------------------------------------------------

      const data = await loadPickingData(
        normalizedOrderIds,
        normalizedOptions
      );

      // ------------------------------------------------------
      // 2. BUILD PICKING DOCUMENT
      // ------------------------------------------------------

      const documentData =
        preparePickingDocument(data);

      // ------------------------------------------------------
      // 3. VALIDATE DOCUMENT
      // ------------------------------------------------------

      if (
        !documentData ||
        !Array.isArray(documentData.groups) ||
        !Array.isArray(documentData.lines)
      ) {
        throw new Error(
          "Picking document preparation failed."
        );
      }

      if (
        documentData.summary.total_orders !==
        normalizedOrderIds.length
      ) {
        throw new Error(
          "Picking document order count mismatch."
        );
      }

      // ------------------------------------------------------
      // 4. RENDER PDF
      // ------------------------------------------------------

      const blob =
        renderPickingPdf(
          documentData
        );

      validatePickingPdfBlob(
        blob
      );

      // ------------------------------------------------------
      // 5. BUILD RESULT
      // ------------------------------------------------------

      const fileName =
        getPickingFileName(
          documentData
        );

      const result = {
        success: true,

        blob,

        fileName,

        reference:
          documentData.reference,

        pickingMethod:
          documentData.picking_method,

        summary:
          documentData.summary,

        orderIds:
          normalizedOrderIds,

        generatedAt:
          documentData.generated_at,

        readOnly: true
      };

      lastGeneratedDocument = {
        ...result,
        blob: null
      };

      // ------------------------------------------------------
      // 6. DOWNLOAD OR PRINT
      // ------------------------------------------------------

      if (
        normalizedOptions.outputMode ===
        CONFIG.outputModes.PRINT
      ) {
        printPickingPdf(
          blob
        );
      } else {
        downloadPickingPdf(
          blob,
          fileName
        );
      }

      // ------------------------------------------------------
      // 7. COMPLETION EVENT
      // ------------------------------------------------------

      dispatchPickingEvent(
        PICKING_EVENTS.COMPLETE,
        {
          reference:
            result.reference,

          fileName:
            result.fileName,

          pickingMethod:
            result.pickingMethod,

          summary:
            result.summary,

          orderCount:
            result.orderIds.length
        }
      );

      return result;

    } catch (error) {
      console.error(
        "[Veynor Picking] Generation failed:",
        error
      );

      dispatchPickingEvent(
        PICKING_EVENTS.ERROR,
        {
          message:
            error?.message ||
            "Picking document generation failed."
        }
      );

      throw error;

    } finally {
      activeGeneration = false;
    }
  }


  // ==========================================================
  // 75. GENERATOR STATUS
  // ==========================================================

  function getStatus() {
    return {
      version: CONFIG.version,

      busy: activeGeneration,

      availableMethods:
        Object.values(
          CONFIG.pickingMethods
        ),

      outputModes:
        Object.values(
          CONFIG.outputModes
        ),

      scannerAvailable: false,

      employeeAssignmentAvailable: false,

      digitalConfirmationAvailable: false,

      lastGenerated:
        lastGeneratedDocument
          ? { ...lastGeneratedDocument }
          : null
    };
  }


  // ==========================================================
  // 76. PUBLIC GENERATOR API
  // ==========================================================

  const PickingListGenerator = Object.freeze({

    version: CONFIG.version,

    config: CONFIG,

    preview,

    generate,

    getStatus,

    normalizeOptions,

    getPickingFileName,

    // These are exposed for the upcoming popup.
    methods: CONFIG.pickingMethods,

    defaults: CONFIG.defaults

  });


  // ==========================================================
  // 77. REGISTER MODULE
  // ==========================================================

  if (window.VeynorPickingListGenerator) {
    console.warn(
      "[Veynor Picking] Generator already registered. " +
      "Replacing existing module."
    );
  }

  window.VeynorPickingListGenerator =
    PickingListGenerator;

  console.info(
    "[Veynor Picking] Generator loaded.",
    {
      version: CONFIG.version,

      pickingMethods:
        Object.values(
          CONFIG.pickingMethods
        ),

      readOnly: true,

      scannerAvailable: false
    }
  );


  // ==========================================================
  // END OF PART 5 OF 5
  // VEYNOR PICKING LIST GENERATOR V1.0.0
  // ==========================================================

})();







   

