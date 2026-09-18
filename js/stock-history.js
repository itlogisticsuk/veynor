(function () {
  "use strict";

  /* =========================================================
   * CONFIG
   * ======================================================= */

  const TENANT_NAME = "Sofa2U";

  const PRODUCT_PAGE_SIZE = 15;
  const MOVEMENT_PAGE_SIZE = 25;
  const DB_PAGE_SIZE = 1000;

const OUTBOUND_STATUSES = [
  "out",
  "shipped",
  "closed",
  "manual_outbound"
];

  const BLOCKED_STATUSES = [
    "missing",
    "damaged",
    "cancelled"
  ];


  /* =========================================================
   * STATE
   * ======================================================= */

  let client = null;
  let companyId = null;
  let currentProfile = null;

  let products = [];
  let customers = [];
  let warehouses = [];
  let locations = [];
let inboundContainerMap = new Map();
let userProfiles = [];

let productStockLedger = new Map();

let allItems = [];

  let productGroups = [];
  let filteredProductGroups = [];

  let selectedProductId = null;
  let selectedProduct = null;

  let selectedMovements = [];
  let filteredMovements = [];

  let productPage = 1;
  let movementPage = 1;


  /* =========================================================
   * BASIC HELPERS
   * ======================================================= */

  function byId(id) {
    return document.getElementById(id);
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[character])
    );
  }

  function toNumber(value, fallback = 0) {
    const number = Number(
      String(value ?? "")
        .replace(",", ".")
    );

    return Number.isFinite(number)
      ? number
      : fallback;
  }

  function formatNumber(value, digits = 0) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return number.toLocaleString(
      "en-GB",
      {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }
    );
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent =
        value ?? "";
    }
  }

  function showToast(message, type = "ok") {
    const toast = byId("toast");

    if (!toast) return;

    toast.textContent = message || "";
    toast.className = `notice ${type}`;

    window.clearTimeout(
      window.__stockHistoryToastTimer
    );

    window.__stockHistoryToastTimer =
      window.setTimeout(() => {
        toast.textContent = "";
        toast.className = "notice";
      }, 5500);
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error(
        "Supabase helper sb() is not available."
      );
    }

    client = sb();

    return client;
  }

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return cleanText(value) || "—";
    }

    return date.toLocaleDateString(
      "en-GB",
      {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }
    );
  }

  function formatTime(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString(
      "en-GB",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return cleanText(value) || "—";
    }

    return `${formatDate(value)} ${formatTime(value)}`;
  }

  function dateToTime(value) {
    if (!value) return 0;

    const date = new Date(value);

    const time = date.getTime();

    return Number.isNaN(time)
      ? 0
      : time;
  }

  function fileDateStamp() {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }

  function safeFileName(value) {
    return String(value || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120);
  }

  function chunks(array, size = 80) {
    const result = [];

    for (
      let index = 0;
      index < array.length;
      index += size
    ) {
      result.push(
        array.slice(
          index,
          index + size
        )
      );
    }

    return result;
  }


  /* =========================================================
   * PROFILE / COMPANY
   * ======================================================= */

  async function loadCurrentProfile() {
    const db = ensureClient();

    const {
      data: userData,
      error: userError
    } = await db.auth.getUser();

    if (userError) {
      throw userError;
    }

    const user =
      userData?.user || null;

    if (!user?.id) {
      throw new Error(
        "No authenticated user found."
      );
    }

    let result = await db
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        role,
        is_active,
        company_id,
        customer_id,
        retailer_code
      `)
      .eq("id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (
      !result.data &&
      !result.error
    ) {
      result = await db
        .from("user_profiles")
        .select(`
          id,
          auth_user_id,
          role,
          is_active,
          company_id,
          customer_id,
          retailer_code
        `)
        .eq(
          "auth_user_id",
          user.id
        )
        .eq("is_active", true)
        .maybeSingle();
    }

    if (result.error) {
      throw result.error;
    }

    if (!result.data?.id) {
      throw new Error(
        "No active user profile found."
      );
    }

    currentProfile =
      result.data;

    companyId =
      currentProfile.company_id ||
      null;
  }

  function isProductOwnerRole() {
    return [
      "product_owner_admin",
      "product_owner_user"
    ].includes(
      normalize(
        currentProfile?.role
      )
    );
  }

  async function getCompanyId() {
    if (companyId) {
      return companyId;
    }

    const db =
      ensureClient();

    const {
      data,
      error
    } = await db
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data?.id) {
      throw new Error(
        `Company "${TENANT_NAME}" not found.`
      );
    }

    companyId =
      data.id;

    return companyId;
  }


  /* =========================================================
   * GENERIC PAGINATED QUERY
   * ======================================================= */

  async function fetchAllPages(
    table,
    selectText,
    queryBuilder = null
  ) {
    const db =
      ensureClient();

    let allRows = [];
    let from = 0;

    while (true) {
      let query = db
        .from(table)
        .select(selectText);

      if (
        typeof queryBuilder ===
        "function"
      ) {
        query =
          queryBuilder(query);
      }

      query = query.range(
        from,
        from + DB_PAGE_SIZE - 1
      );

      const {
        data,
        error
      } = await query;

      if (error) {
        throw error;
      }

      const rows =
        data || [];

      allRows =
        allRows.concat(rows);

      if (
        rows.length <
        DB_PAGE_SIZE
      ) {
        break;
      }

      from +=
        DB_PAGE_SIZE;
    }

    return allRows;
  }


  /* =========================================================
   * MASTER DATA
   * ======================================================= */

  async function loadCustomers() {
    const cid =
      await getCompanyId();

    let query =
      ensureClient()
        .from("customers")
        .select(`
          id,
          name,
          customer_type
        `)
        .eq(
          "company_id",
          cid
        )
        .order(
          "name",
          {
            ascending: true
          }
        );

    if (
      isProductOwnerRole() &&
      currentProfile?.customer_id
    ) {
      query = query.eq(
        "id",
        currentProfile.customer_id
      );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      console.warn(
        "Customers skipped:",
        error.message
      );

      customers = [];
      renderProductOwnerFilter();

      return;
    }

    customers =
      data || [];

    renderProductOwnerFilter();
  }

  async function loadWarehouses() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await ensureClient()
      .from("warehouses")
      .select(`
        id,
        name
      `)
      .eq(
        "company_id",
        cid
      )
      .order(
        "name",
        {
          ascending: true
        }
      );

    if (error) {
      console.warn(
        "Warehouses skipped:",
        error.message
      );

      warehouses = [];

      return;
    }

    warehouses =
      data || [];
  }

  async function loadLocations() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await ensureClient()
      .from(
        "warehouse_locations"
      )
      .select(`
        id,
        code,
        location_code,
        warehouse_id
      `)
      .eq(
        "company_id",
        cid
      )
      .order(
        "code",
        {
          ascending: true
        }
      );

    if (error) {
      console.warn(
        "Locations skipped:",
        error.message
      );

      locations = [];

      return;
    }

    locations =
      (data || []).map(row => ({
        ...row,
        code:
          row.code ||
          row.location_code ||
          ""
      }));
  }

  async function loadInboundContainers() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await ensureClient()
      .from(
        "inbound_containers"
      )
      .select(`
        id,
        container_number
      `)
      .eq(
        "company_id",
        cid
      );

    if (error) {
      console.warn(
        "Inbound containers skipped:",
        error.message
      );

      inboundContainerMap =
        new Map();

      return;
    }

    inboundContainerMap =
      new Map(
        (data || []).map(
          container => [
            String(
              container.id
            ),
            container.container_number ||
            ""
          ]
        )
      );
  }

  async function loadUserProfiles() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await ensureClient()
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        full_name,
        email
      `)
      .eq(
        "company_id",
        cid
      );

    if (error) {
      console.warn(
        "User profiles skipped:",
        error.message
      );

      userProfiles = [];

      return;
    }

    userProfiles =
      data || [];
  }

  function renderProductOwnerFilter() {
    const select =
      byId(
        "historyProductOwner"
      );

    if (!select) return;

    const current =
      select.value || "";

    select.innerHTML =
      `<option value="">All Product Owners</option>` +
      customers
        .map(customer => `
          <option value="${escapeHtml(customer.id)}">
            ${escapeHtml(customer.name)}
          </option>
        `)
        .join("");

    if (
      isProductOwnerRole() &&
      currentProfile?.customer_id
    ) {
      select.value =
        currentProfile.customer_id;

      select.disabled =
        true;

      return;
    }

    if (
      current &&
      customers.some(
        customer =>
          String(customer.id) ===
          String(current)
      )
    ) {
      select.value =
        current;
    }
  }

  function warehouseName(id) {
    if (!id) return "";

    return (
      warehouses.find(
        warehouse =>
          String(warehouse.id) ===
          String(id)
      )?.name ||
      ""
    );
  }

  function locationCode(id) {
    if (!id) return "";

    return (
      locations.find(
        location =>
          String(location.id) ===
          String(id)
      )?.code ||
      ""
    );
  }

  function profileName(id) {
    if (!id) return "";

    const profile =
      userProfiles.find(row =>
        String(row.id) ===
          String(id) ||
        String(row.auth_user_id) ===
          String(id)
      );

    return (
      profile?.full_name ||
      profile?.email ||
      ""
    );
  }


  /* =========================================================
   * INBOUND REFERENCES
   * ======================================================= */

  function getInboundDisplayReference(
    reference
  ) {
    const value =
      cleanText(reference);

    if (!value) {
      return "—";
    }

    if (
      value.startsWith(
        "INBOUND:"
      )
    ) {
      const containerId =
        value.slice(
          "INBOUND:".length
        );

      const containerNumber =
        inboundContainerMap.get(
          String(containerId)
        );

      if (containerNumber) {
        return containerNumber;
      }
    }

    return value;
  }


  /* =========================================================
   * STOCK STATUS HELPERS
   * ======================================================= */

  function isOutboundStatus(
    itemOrStatus
  ) {
    const status =
      typeof itemOrStatus ===
      "string"
        ? normalize(
            itemOrStatus
          )
        : normalize(
            itemOrStatus?.status
          );

    return OUTBOUND_STATUSES
      .includes(status);
  }

  function isBlockedStatus(
    itemOrStatus
  ) {
    const status =
      typeof itemOrStatus ===
      "string"
        ? normalize(
            itemOrStatus
          )
        : normalize(
            itemOrStatus?.status
          );

    return BLOCKED_STATUSES
      .includes(status);
  }

  function isPhysical(item) {
    return (
      !isOutboundStatus(item) &&
      !isBlockedStatus(item)
    );
  }

  function isAvailable(item) {
    return (
      normalize(item?.status) ===
      "in_stock"
    );
  }

  function isReserved(item) {
    return (
      normalize(item?.status) ===
      "reserved"
    );
  }

  function isCommitted(item) {
    return [
      "picked",
      "loaded"
    ].includes(
      normalize(item?.status)
    );
  }


  /* =========================================================
   * PRODUCTS
   * ======================================================= */

 async function loadProducts() {
  const cid =
    await getCompanyId();

  products =
    await fetchAllPages(
      "products",
      `
        id,
        company_id,
        customer_id,
        sku_base,
        name,
        description,
        image_url,
        volume_m3,
        weight_kg,
        customers (
          id,
          name
        )
      `,
      query =>
        query
          .eq(
            "company_id",
            cid
          )
          .order(
            "sku_base",
            {
              ascending: true
            }
          )
    );

  if (
    isProductOwnerRole() &&
    currentProfile?.customer_id
  ) {
    products =
      products.filter(product =>
        String(
          product.customer_id
        ) ===
        String(
          currentProfile.customer_id
        )
      );
  }
}

  /* =========================================================
   * ITEMS
   * ======================================================= */

async function loadProductStockLedger() {
  const cid =
    await getCompanyId();

  const rows =
    await fetchAllPages(
      "product_stock_ledger",
      `
        product_id,
        physical_units,
        reserved_units,
        committed_units,
        available_units,
        movement_count
      `,
      query =>
        query.eq(
          "company_id",
          cid
        )
    );

  productStockLedger =
    new Map(
      (rows || []).map(
        row => [
          String(row.product_id),
          {
            physical_units:
              toNumber(
                row.physical_units,
                0
              ),

            reserved_units:
              toNumber(
                row.reserved_units,
                0
              ),

            committed_units:
              toNumber(
                row.committed_units,
                0
              ),

            available_units:
              toNumber(
                row.available_units,
                0
              ),

            movement_count:
              toNumber(
                row.movement_count,
                0
              )
          }
        ]
      )
    );
}

 async function loadItems() {
  const cid =
    await getCompanyId();

  allItems =
    await fetchAllPages(
      "items",
      `
        id,
        company_id,
        product_id,
        warehouse_id,
        location_id,
        storage_mutation_id,
        sku_unique,
        status,
        volume_m3,
        weight_kg,
        received_at,
        reserved_at,
        picked_at,
        loaded_at,
        shipped_at,
        created_at,
        linked_order_id,
        shipment_id,
        inbound_reference,
        inbound_date,
        physical_product_id,
        package_no,
        package_total,
        package_label,
        stock_set_status,
        stock_set_key,
        stock_set_id,

        source_system,
        stock_variant,
        batch_number
      `,
      query =>
        query
          .eq(
            "company_id",
            cid
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
    );

  if (
    isProductOwnerRole() &&
    currentProfile?.customer_id
  ) {
    const allowedProductIds =
      new Set(
        products
          .filter(product =>
            String(
              product.customer_id
            ) ===
            String(
              currentProfile.customer_id
            )
          )
          .map(product =>
            String(product.id)
          )
      );

    allItems =
      allItems.filter(item =>
        allowedProductIds.has(
          String(
            item.product_id
          )
        )
      );
  }
}


  /* =========================================================
   * PRODUCT GROUPS
   * ======================================================= */

  function lastItemMovement(item) {
    const dates = [
      item.shipped_at,
      item.loaded_at,
      item.picked_at,
      item.reserved_at,
      item.received_at,
      item.inbound_date,
      item.created_at
    ]
      .filter(Boolean)
      .map(value => ({
        value,
        time:
          dateToTime(value)
      }))
      .sort(
        (a, b) =>
          b.time - a.time
      );

    return (
      dates[0]?.value ||
      null
    );
  }

function buildProductGroups() {
  const productMap =
    new Map(
      products.map(product => [
        String(product.id),
        product
      ])
    );

  const groupMap =
    new Map();


  function physicalKey(item) {
    if (item.physical_product_id) {
      return `physical:${item.physical_product_id}`;
    }

    if (item.stock_set_id) {
      return `set:${item.stock_set_id}`;
    }

    return `item:${item.id}`;
  }


  function physicalUnitStatus(items) {
    if (!items?.length) {
      return "unknown";
    }

    const statuses =
      items.map(item =>
        normalize(item.status)
      );

    if (
      statuses.every(status =>
        OUTBOUND_STATUSES.includes(status)
      )
    ) {
      return "outbound";
    }

    if (
      statuses.every(status =>
        BLOCKED_STATUSES.includes(status)
      )
    ) {
      return "blocked";
    }

    if (
      statuses.some(status =>
        [
          "picked",
          "loaded"
        ].includes(status)
      )
    ) {
      return "committed";
    }

    if (
      statuses.some(status =>
        status === "reserved"
      )
    ) {
      return "reserved";
    }

    if (
      statuses.some(status =>
        status === "in_stock"
      )
    ) {
      return "available";
    }

    if (
      items.some(item =>
        isPhysical(item)
      )
    ) {
      return "physical";
    }

    return "unknown";
  }


  // ==========================================================
  // BUILD PRODUCT GROUPS
  // ==========================================================

  allItems.forEach(item => {
    const product =
      productMap.get(
        String(item.product_id)
      );

    if (!product) {
      return;
    }

    const key =
      String(product.id);

    if (!groupMap.has(key)) {
      groupMap.set(
        key,
        {
          product_id:
            product.id,

          sku_base:
            product.sku_base ||
            "—",

          product_name:
            product.name ||
            "—",

          product_description:
            product.description ||
            "",

          customer_id:
            product.customer_id ||
            "",

          customer_name:
            product.customers?.name ||
            "",

          image_url:
            product.image_url ||
            "",

          items: [],

          physical: 0,
          available: 0,
          reserved: 0,
          committed: 0,

          ledgerManaged: false,
          ledgerMovementCount: 0,

          last_movement: null
        }
      );
    }

    const group =
      groupMap.get(key);

    group.items.push(item);

    const movement =
      lastItemMovement(item);

    if (
      movement &&
      (
        !group.last_movement ||
        dateToTime(movement) >
        dateToTime(
          group.last_movement
        )
      )
    ) {
      group.last_movement =
        movement;
    }
  });


  // ==========================================================
  // CALCULATE PRODUCT TOTALS
  // ==========================================================

  groupMap.forEach(group => {

    const ledger =
      productStockLedger.get(
        String(group.product_id)
      ) || null;


    // ========================================================
    // LEDGER-MANAGED PRODUCT
    //
    // product_stock_ledger is the single source of truth.
    // ========================================================

    if (
      ledger &&
      ledger.movement_count > 0
    ) {
      group.ledgerManaged =
        true;

      group.ledgerMovementCount =
        ledger.movement_count;

      group.physical =
        ledger.physical_units;

      group.available =
        ledger.available_units;

      group.reserved =
        ledger.reserved_units;

      group.committed =
        ledger.committed_units;

      return;
    }


    // ========================================================
    // LEGACY FALLBACK
    //
    // Products without ledger history continue to use items.
    // ========================================================

    group.ledgerManaged =
      false;

    const physicalMap =
      new Map();

    group.items.forEach(item => {
      const key =
        physicalKey(item);

      if (!physicalMap.has(key)) {
        physicalMap.set(
          key,
          []
        );
      }

      physicalMap
        .get(key)
        .push(item);
    });


    physicalMap.forEach(
      unitItems => {
        const status =
          physicalUnitStatus(
            unitItems
          );

        if (
          [
            "available",
            "reserved",
            "committed",
            "physical"
          ].includes(status)
        ) {
          group.physical += 1;
        }

        if (
          status === "available"
        ) {
          group.available += 1;
        }

        if (
          status === "reserved"
        ) {
          group.reserved += 1;
        }

        if (
          status === "committed"
        ) {
          group.committed += 1;
        }
      }
    );
  });


  productGroups =
    Array.from(
      groupMap.values()
    )
      .sort(
        (a, b) =>
          String(
            a.sku_base
          ).localeCompare(
            String(
              b.sku_base
            ),
            "en-GB"
          )
      );


  filteredProductGroups =
    [...productGroups];
}


  /* =========================================================
   * GLOBAL KPI
   * ======================================================= */

  function renderGlobalKpis() {
    const physical =
      productGroups.reduce(
        (sum, group) =>
          sum +
          group.physical,
        0
      );

    const available =
      productGroups.reduce(
        (sum, group) =>
          sum +
          group.available,
        0
      );

    const reserved =
      productGroups.reduce(
        (sum, group) =>
          sum +
          group.reserved,
        0
      );

    const committed =
      productGroups.reduce(
        (sum, group) =>
          sum +
          group.committed,
        0
      );

    setText(
      "kpiHistoryProducts",
      formatNumber(
        productGroups.length
      )
    );

    setText(
      "kpiHistoryPhysical",
      formatNumber(physical)
    );

    setText(
      "kpiHistoryAvailable",
      formatNumber(available)
    );

    setText(
      "kpiHistoryReserved",
      formatNumber(reserved)
    );

    setText(
      "kpiHistoryCommitted",
      formatNumber(committed)
    );
  }


  /* =========================================================
   * PRODUCT FILTERS
   * ======================================================= */

  function applyProductFilters(
    resetPage = true
  ) {
    const search =
      normalize(
        byId(
          "historySearch"
        )?.value || ""
      );

    const customerId =
      byId(
        "historyProductOwner"
      )?.value || "";

    const stockStatus =
      normalize(
        byId(
          "historyStockStatus"
        )?.value || ""
      );

    filteredProductGroups =
      productGroups.filter(group => {
        if (
          customerId &&
          String(
            group.customer_id
          ) !==
          String(customerId)
        ) {
          return false;
        }

        if (
          stockStatus ===
            "available" &&
          group.available <= 0
        ) {
          return false;
        }

        if (
          stockStatus ===
            "reserved" &&
          group.reserved <= 0
        ) {
          return false;
        }

        if (
          stockStatus ===
            "committed" &&
          group.committed <= 0
        ) {
          return false;
        }

        if (
          stockStatus ===
            "out_of_stock" &&
          group.physical > 0
        ) {
          return false;
        }

        if (search) {
          const haystack = [
            group.sku_base,
            group.product_name,
            group.product_description,
            group.customer_name,

            ...group.items.map(
              item =>
                item.inbound_reference ||
                ""
            )
          ]
            .join(" ")
            .toLowerCase();

          if (
            !haystack.includes(
              search
            )
          ) {
            return false;
          }
        }

        return true;
      });

    if (resetPage) {
      productPage = 1;
    }

    renderProductTable();
  }


  /* =========================================================
   * PRODUCT TABLE
   * ======================================================= */

  function productPlaceholderHtml() {
    return `
      <div class="product-thumbnail-placeholder">
        📦
      </div>
    `;
  }

  function renderProductTable() {
    const body =
      byId(
        "productHistoryBody"
      );

    if (!body) return;

    const totalPages =
      Math.max(
        1,
        Math.ceil(
          filteredProductGroups.length /
          PRODUCT_PAGE_SIZE
        )
      );

    productPage =
      Math.min(
        Math.max(
          1,
          productPage
        ),
        totalPages
      );

    const start =
      (
        productPage - 1
      ) *
      PRODUCT_PAGE_SIZE;

    const visible =
      filteredProductGroups.slice(
        start,
        start +
          PRODUCT_PAGE_SIZE
      );

    if (!visible.length) {
      body.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="history-empty">
              <div class="history-empty-icon">
                📦
              </div>

              <strong>
                No products found
              </strong>

              <span>
                No products match the selected filters.
              </span>
            </div>
          </td>
        </tr>
      `;
    } else {
      body.innerHTML =
        visible
          .map(group => {
            const active =
              String(
                group.product_id
              ) ===
              String(
                selectedProductId
              );

            return `
              <tr
                class="${active ? "active" : ""}"
                data-product-id="${escapeHtml(
                  group.product_id
                )}"
              >

                <td>

                  <div class="product-cell">

                    <div class="product-thumbnail">
                      ${
                        group.image_url
                          ? `
                            <img
                              src="${escapeHtml(
                                group.image_url
                              )}"
                              alt="${escapeHtml(
                                group.product_name
                              )}"
                            />
                          `
                          : productPlaceholderHtml()
                      }
                    </div>


                    <div class="product-copy">

                      <span class="product-sku">
                        ${escapeHtml(
                          group.sku_base
                        )}
                      </span>

                      <span class="product-name">
                        ${escapeHtml(
                          group.product_name
                        )}
                      </span>

                      ${
                        group.customer_name
                          ? `
                            <span class="product-owner">
                              ${escapeHtml(
                                group.customer_name
                              )}
                            </span>
                          `
                          : ""
                      }

                    </div>

                  </div>

                </td>


                <td>
                  <span class="stock-number">
                    ${formatNumber(
                      group.physical
                    )}
                  </span>
                </td>


                <td>
                  <span class="stock-number available">
                    ${formatNumber(
                      group.available
                    )}
                  </span>
                </td>


                <td>
                  <span class="stock-number reserved">
                    ${formatNumber(
                      group.reserved
                    )}
                  </span>
                </td>


                <td>
                  <span class="stock-number committed">
                    ${formatNumber(
                      group.committed
                    )}
                  </span>
                </td>


                <td>

                  <div class="last-movement">

                    <strong>
                      ${
                        group.last_movement
                          ? escapeHtml(
                              formatDate(
                                group.last_movement
                              )
                            )
                          : "—"
                      }
                    </strong>

                    <span>
                      ${
                        group.last_movement
                          ? escapeHtml(
                              formatTime(
                                group.last_movement
                              )
                            )
                          : ""
                      }
                    </span>

                  </div>

                </td>


                <td>

                  <button
                    class="mini-btn primary history-view-btn"
                    type="button"
                    data-view-product="${escapeHtml(
                      group.product_id
                    )}"
                  >
                    View History →
                  </button>

                </td>

              </tr>
            `;
          })
          .join("");
    }

    setText(
      "historyResultsMeta",
      `Showing ${formatNumber(
        filteredProductGroups.length
      )} product(s)`
    );

    const from =
      filteredProductGroups.length
        ? start + 1
        : 0;

    const to =
      Math.min(
        start +
          PRODUCT_PAGE_SIZE,
        filteredProductGroups.length
      );

    setText(
      "productHistoryFooterMeta",
      `${formatNumber(
        from
      )}–${formatNumber(
        to
      )} of ${formatNumber(
        filteredProductGroups.length
      )} products`
    );

    setText(
      "historyPageLabel",
      `Page ${productPage} of ${totalPages}`
    );

    const previous =
      byId(
        "btnHistoryPreviousPage"
      );

    const next =
      byId(
        "btnHistoryNextPage"
      );

    if (previous) {
      previous.disabled =
        productPage <= 1;
    }

    if (next) {
      next.disabled =
        productPage >=
        totalPages;
    }

    body
      .querySelectorAll(
        "[data-view-product]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          async event => {
            event.preventDefault();
            event.stopPropagation();

            const productId =
              button.getAttribute(
                "data-view-product"
              );

            await selectProduct(
              productId,
              true
            );
          }
        );
      });

    body
      .querySelectorAll(
        "tr[data-product-id]"
      )
      .forEach(row => {
        row.addEventListener(
          "dblclick",
          async () => {
            await selectProduct(
              row.getAttribute(
                "data-product-id"
              ),
              true
            );
          }
        );
      });
  }


  /* =========================================================
   * ORDER / ALLOCATION DATA
   * ======================================================= */

 async function loadAllocationsForProduct(
  productId
) {
  const cid =
    await getCompanyId();

  const productItems =
    allItems.filter(item =>
      String(
        item.product_id
      ) ===
      String(productId)
    );

  const itemIds =
    productItems
      .map(item => item.id)
      .filter(Boolean);

  if (!itemIds.length) {
    return [];
  }


  /* =======================================================
   * ALLOCATIONS
   * ===================================================== */

  let allocations = [];

  for (
    const part of chunks(
      itemIds,
      75
    )
  ) {
    const {
      data,
      error
    } = await ensureClient()
      .from(
        "order_allocations"
      )
      .select(`
        id,
        order_line_id,
        item_id,
        allocation_status,
        allocated_at,
        allocated_by_profile_id,
        company_id,
        stock_set_id
      `)
      .eq(
        "company_id",
        cid
      )
      .in(
        "item_id",
        part
      );

    if (error) {
      throw error;
    }

    allocations =
      allocations.concat(
        data || []
      );
  }


  /* =======================================================
   * ORDER LINES
   * ===================================================== */

  const lineIds =
    [
      ...new Set(
        allocations
          .map(
            allocation =>
              allocation.order_line_id
          )
          .filter(Boolean)
      )
    ];

  if (!lineIds.length) {
    return allocations;
  }


  let lines = [];

  for (
    const part of chunks(
      lineIds,
      75
    )
  ) {
    const {
      data,
      error
    } = await ensureClient()
      .from("order_lines")
      .select(`
        id,
        order_id,
        product_id,
        sku_base,
        description,
        quantity_ordered,
        quantity_allocated,
        quantity_shipped
      `)
      .in(
        "id",
        part
      );

    if (error) {
      throw error;
    }

    lines =
      lines.concat(
        data || []
      );
  }


  /* =======================================================
   * ORDERS
   * ===================================================== */

  const orderIds =
    [
      ...new Set(
        lines
          .map(
            line =>
              line.order_id
          )
          .filter(Boolean)
      )
    ];


  let orders = [];

  for (
    const part of chunks(
      orderIds,
      75
    )
  ) {
    const {
      data,
      error
    } = await ensureClient()
.from("orders")
.select(`
  id,
  order_number,
  external_reference,
  purchase_order,
  retail_name,
  delivery_city,
  delivery_postcode,
  customer_id,
  status
`)
      .in(
        "id",
        part
      );

    if (error) {
      throw error;
    }

    orders =
      orders.concat(
        data || []
      );
  }


  /* =======================================================
   * MAP DATA
   * ===================================================== */

  const lineMap =
    new Map(
      lines.map(line => [
        String(line.id),
        line
      ])
    );


  const orderMap =
    new Map(
      orders.map(order => [
        String(order.id),
        order
      ])
    );


  /* =======================================================
   * FINAL RESULT
   * ===================================================== */

  return allocations.map(
    allocation => {

      const line =
        lineMap.get(
          String(
            allocation.order_line_id
          )
        );


      const order =
        orderMap.get(
          String(
            line?.order_id ||
            ""
          )
        );


      return {
        ...allocation,

        order_line:
          line || null,

        order:
          order || null
      };
    }
  );
}


  /* =========================================================
   * WAREHOUSE EVENTS
   * ======================================================= */

  async function loadWarehouseEventsForProduct(
    productId
  ) {
    const cid =
      await getCompanyId();

    const productItems =
      allItems.filter(item =>
        String(
          item.product_id
        ) ===
        String(productId)
      );

    const itemIds =
      productItems
        .map(item => item.id)
        .filter(Boolean);

    let rows = [];

    /*
     * 1. Events waarbij product_id in payload staat.
     */
    try {
      const {
        data,
        error
      } = await ensureClient()
        .from(
          "warehouse_events"
        )
        .select(`
          id,
          company_id,
          event_type,
          entity_type,
          entity_id,
          reference_no,
          source_module,
          user_profile_id,
          old_status,
          new_status,
          payload,
          created_at
        `)
        .eq(
          "company_id",
          cid
        )
        .contains(
          "payload",
          {
            product_id:
              String(productId)
          }
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );

      if (!error) {
        rows =
          rows.concat(
            data || []
          );
      }
    } catch (error) {
      console.warn(
        "Warehouse event product query skipped:",
        error.message
      );
    }

    /*
     * 2. Directe item events.
     * Dit vangt ook oudere events zonder product_id in payload.
     */
    for (
      const part of chunks(
        itemIds,
        60
      )
    ) {
      if (!part.length) continue;

      const {
        data,
        error
      } = await ensureClient()
        .from(
          "warehouse_events"
        )
        .select(`
          id,
          company_id,
          event_type,
          entity_type,
          entity_id,
          reference_no,
          source_module,
          user_profile_id,
          old_status,
          new_status,
          payload,
          created_at
        `)
        .eq(
          "company_id",
          cid
        )
        .eq(
          "entity_type",
          "item"
        )
        .in(
          "entity_id",
          part
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );

      if (error) {
        console.warn(
          "Warehouse event item query skipped:",
          error.message
        );

        continue;
      }

      rows =
        rows.concat(
          data || []
        );
    }

    const unique =
      new Map();

    rows.forEach(row => {
      if (!row?.id) return;

      unique.set(
        String(row.id),
        row
      );
    });

    return Array.from(
      unique.values()
    );
  }


  /* =========================================================
   * MOVEMENTS TABLE
   * ======================================================= */

 async function loadMovementsForProduct(
  productId
) {
  const cid =
    await getCompanyId();

  const {
    data,
    error
  } =
    await ensureClient()
      .from("movements")
      .select(`
        id,
        company_id,
        item_id,
        product_id,
        warehouse_id,
        location_id,
        order_id,
        shipment_id,

        movement_type,

        scan_method,
        scan_device,
        scan_value,

        source_system,
        batch_reference,
        stock_variant,

        external_order_number,
        external_ack_reference,

        quantity_units,
        quantity_packages,

        migrated_from_legacy,

        notes,
        created_at
      `)
      .eq(
        "company_id",
        cid
      )
      .eq(
        "product_id",
        productId
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      );

  if (error) {
    console.warn(
      "Movements skipped:",
      error.message
    );

    return [];
  }

  return data || [];
}


  /* =========================================================
   * MOVEMENT BUILDING
   * ======================================================= */

function movementRecord({
  date,
  type,
  reference = "",
  secondaryReference = "",
  warehouseId = null,
  locationId = null,

  quantity = 0,
  packageQuantity = null,

  user = "",
  notes = "",
  source = "",

  sourceSystem = "",
  batchReference = "",
  stockVariant = "",

  externalOrderNumber = "",
  externalAckReference = "",

  migratedFromLegacy = false,

  itemId = null
}) {
  return {
    id:
      crypto?.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,

    date:
      date || null,

    type:
      type || "adjustment",

    reference:
      reference || "",

    secondary_reference:
      secondaryReference || "",

    warehouse_id:
      warehouseId || null,

    location_id:
      locationId || null,

    warehouse_name:
      warehouseName(
        warehouseId
      ),

    location_code:
      locationCode(
        locationId
      ),

    /*
     * quantity = PRODUCT / UNIT movement.
     *
     * Voor de nieuwe CIN7 / VEYNOR historie
     * gebruiken we dus bijvoorbeeld:
     *
     * +8 CRO808 producten
     * -1 CRO808 product
     *
     * Niet het aantal colli.
     */
    quantity:
      toNumber(
        quantity,
        0
      ),

    /*
     * Colli worden apart bewaard.
     *
     * Voor CRO808:
     * 1 product = 2 packages.
     */
    package_quantity:
      packageQuantity === null ||
      packageQuantity === undefined
        ? null
        : toNumber(
            packageQuantity,
            0
          ),

    balance:
      null,

    user:
      user || "",

    notes:
      notes || "",

    source:
      source || "",

    source_system:
      sourceSystem || "",

    batch_reference:
      batchReference || "",

    stock_variant:
      stockVariant || "",

    external_order_number:
      externalOrderNumber || "",

    external_ack_reference:
      externalAckReference || "",

    migrated_from_legacy:
      migratedFromLegacy === true,

    item_id:
      itemId || null
  };
}

  function orderMainReference(
    order
  ) {
    return (
      order?.order_number ||
      order?.external_reference ||
      "Order"
    );
  }

  function orderSubReference(
    order
  ) {
    const parts = [];

    if (
      order?.external_reference &&
      order.external_reference !==
      order?.order_number
    ) {
      parts.push(
        order.external_reference
      );
    }

    if (
      order?.purchase_order
    ) {
      parts.push(
        `PO ${order.purchase_order}`
      );
    }

    return parts.join(" · ");
  }

function buildReceiptMovements(
  productItems,
  hasCin7History = false
) {
  /*
   * =========================================================
   * COMPLETE CIN7 MIGRATION
   * =========================================================
   *
   * Wanneer voor dit product echte historische CIN7
   * movements aanwezig zijn, gebruiken we uitsluitend
   * die receipts als historische basis.
   *
   * Oude Veynor item-receipts zoals:
   *
   * 16/07/2026 Stock Receipt +9
   * 16/07/2026 Stock Receipt +10
   *
   * zijn onderdeel van de oude handmatig opgebouwde
   * voorraad en mogen dan niet meer naast CIN7 worden
   * weergegeven.
   */
  if (
    hasCin7History
  ) {
    return [];
  }


  const groups =
    new Map();


  productItems.forEach(item => {
    /*
     * Ook zonder volledige migratie:
     * een individueel CIN7-item heeft zijn receipt al
     * in public.movements en wordt nooit opnieuw opgebouwd.
     */
    if (
      normalize(
        item.source_system
      ) === "cin7"
    ) {
      return;
    }


    const date =
      item.received_at ||
      item.inbound_date ||
      item.created_at;


    if (!date) {
      return;
    }


    const key = [
      date,
      item.inbound_reference ||
        "",
      item.warehouse_id ||
        "",
      item.location_id ||
        ""
    ].join("|");


    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        {
          date,

          reference:
            item.inbound_reference ||
            "",

          warehouse_id:
            item.warehouse_id ||
            null,

          location_id:
            item.location_id ||
            null,

          quantity:
            0,

          item_ids:
            []
        }
      );
    }


    const group =
      groups.get(key);


    group.quantity += 1;


    group.item_ids.push(
      item.id
    );
  });


  return Array.from(
    groups.values()
  ).map(group =>
    movementRecord({
      date:
        group.date,

      type:
        "receipt",

      reference:
        getInboundDisplayReference(
          group.reference
        ) === "—"
          ? "Stock Receipt"
          : getInboundDisplayReference(
              group.reference
            ),

      warehouseId:
        group.warehouse_id,

      locationId:
        group.location_id,

      quantity:
        group.quantity,

      packageQuantity:
        group.quantity,

      user:
        "",

      notes:
        `${
          group.quantity
        } package${
          group.quantity === 1
            ? ""
            : "s"
        } received into stock.`,

      source:
        "items"
    })
  );
}

function buildAllocationMovements(
  allocations,
  itemMap
) {
  const groups =
    new Map();


  allocations.forEach(
    allocation => {
      const item =
        itemMap.get(
          String(
            allocation.item_id
          )
        );


      const order =
        allocation.order ||
        null;


      if (!item) {
        return;
      }


      const status =
        normalize(
          allocation
            .allocation_status
        );


      const orderNumber =
        cleanText(
          order?.order_number ||
          ""
        );


      const externalReference =
        cleanText(
          order?.external_reference ||
          ""
        );


      const purchaseOrder =
        cleanText(
          order?.purchase_order ||
          ""
        );


      /*
       * Groeperen per order + allocation moment.
       *
       * We gebruiken hier de minuut in plaats van de exacte
       * milliseconde, omdat meerdere allocations van dezelfde
       * reserveringsactie praktisch hetzelfde event zijn.
       */
      const allocationMinute =
        String(
          allocation.allocated_at ||
          ""
        ).slice(
          0,
          16
        );


      const groupKey = [
        order?.id ||
          orderNumber ||
          externalReference ||
          "no-order",

        allocationMinute,

        status === "cancelled"
          ? "cancelled"
          : "reserved"
      ].join("|");


      if (
        !groups.has(
          groupKey
        )
      ) {
        groups.set(
          groupKey,
          {
            date:
              allocation.allocated_at,

            order,

            order_number:
              orderNumber,

            external_reference:
              externalReference,

            purchase_order:
              purchaseOrder,

            warehouse_id:
              item.warehouse_id ||
              null,

            location_id:
              item.location_id ||
              null,

            allocated_by_profile_id:
              allocation
                .allocated_by_profile_id ||
              null,

            status,

            item_ids:
              new Set(),

            physical_ids:
              new Set(),

            stock_set_ids:
              new Set()
          }
        );
      }


      const group =
        groups.get(
          groupKey
        );


      group.item_ids.add(
        String(
          item.id
        )
      );


      /*
       * Eén physical_product_id = één product.
       *
       * Als beide packages ooit afzonderlijke allocations
       * hebben, tellen ze hierdoor nog steeds als één product.
       */
      if (
        item.physical_product_id
      ) {
        group.physical_ids.add(
          String(
            item.physical_product_id
          )
        );

      } else if (
        item.stock_set_id
      ) {
        group.stock_set_ids.add(
          String(
            item.stock_set_id
          )
        );
      }


      /*
       * Oudste allocationtijd van de gegroepeerde actie
       * gebruiken voor de history.
       */
      if (
        dateToTime(
          allocation.allocated_at
        ) <
        dateToTime(
          group.date
        )
      ) {
        group.date =
          allocation.allocated_at;
      }
    }
  );


  return Array.from(
    groups.values()
  ).map(group => {
    /*
     * Product quantity bepalen.
     *
     * Eerst fysieke product-id's,
     * daarna stock sets,
     * anders allocations/items.
     */
    let reservationQuantity =
      group.physical_ids.size;


    if (
      reservationQuantity === 0
    ) {
      reservationQuantity =
        group.stock_set_ids.size;
    }


    if (
      reservationQuantity === 0
    ) {
      reservationQuantity =
        group.item_ids.size;
    }


    const movement =
      movementRecord({
        date:
          group.date,

        type:
          "reservation",

        reference:
          orderMainReference(
            group.order
          ),

        secondaryReference:
          orderSubReference(
            group.order
          ),

        warehouseId:
          group.warehouse_id,

        locationId:
          group.location_id,

        /*
         * Reservation verandert fysieke voorraad niet.
         */
        quantity:
          0,

        packageQuantity:
          null,

        user:
          profileName(
            group
              .allocated_by_profile_id
          ),

        notes:
          group.status ===
          "cancelled"
            ? `${
                reservationQuantity
              } product${
                reservationQuantity === 1
                  ? ""
                  : "s"
              } reserved against this order; allocation later cancelled.`
            : `${
                reservationQuantity
              } product${
                reservationQuantity === 1
                  ? ""
                  : "s"
              } reserved against this order.`,

        source:
          "order_allocations",

        externalOrderNumber:
          group.order_number,

        externalAckReference:
          group.external_reference
      });


    /*
     * Alleen voor presentatie.
     *
     * Dit veld telt NIET mee in calculateBalances().
     */
    movement.reservation_quantity =
      reservationQuantity;


    return movement;
  });
}

  function eventTypeFromWarehouseEvent(
    event
  ) {
    const type =
      normalize(
        event?.event_type
      );

    const oldStatus =
      normalize(
        event?.old_status
      );

    const newStatus =
      normalize(
        event?.new_status
      );

    if (
      type ===
      "item_unreserved"
    ) {
      return "reservation_released";
    }

    if (
      type ===
      "item_received"
    ) {
      return "receipt";
    }

    if (
      type.includes(
        "inventory"
      )
    ) {
      return "inventory_check";
    }

    if (
      type.includes(
        "return"
      )
    ) {
      return "return";
    }

    if (
      type.includes(
        "location"
      ) ||
      type.includes(
        "move"
      )
    ) {
      return "location_move";
    }

    if (
      type.includes(
        "adjust"
      )
    ) {
      return "adjustment";
    }

    if (
      type ===
      "item_status_changed"
    ) {
      if (
        newStatus ===
        "reserved"
      ) {
        return "reservation";
      }

      if (
        newStatus ===
          "shipped" ||
        newStatus ===
          "closed" ||
        newStatus ===
          "manual_outbound"
      ) {
        return "shipment";
      }

      if (
        oldStatus ===
          "reserved" &&
        newStatus ===
          "in_stock"
      ) {
        return "reservation_released";
      }

      if (
        newStatus ===
          "in_stock" &&
        isOutboundStatus(
          oldStatus
        )
      ) {
        return "return";
      }

      if (
        newStatus ===
          "damaged" ||
        newStatus ===
          "missing"
      ) {
        return "adjustment";
      }
    }

    return "adjustment";
  }

  function warehouseEventQuantity(
    event,
    type
  ) {
    const payload =
      event?.payload ||
      {};

    const explicit =
      toNumber(
        payload.quantity ??
        payload.qty ??
        payload.quantity_change ??
        payload.adjustment_quantity,
        NaN
      );

    if (
      Number.isFinite(
        explicit
      )
    ) {
      return explicit;
    }

    if (
      type ===
      "shipment"
    ) {
      return -1;
    }

    if (
      type ===
      "return"
    ) {
      return 1;
    }

    if (
      type ===
      "receipt"
    ) {
      return 1;
    }

    return 0;
  }

function buildWarehouseEventMovements(
  events,
  itemMap,
  hasCin7History = false
) {
  const rows = [];


  /*
   * Oude inventory events vóór de nieuwe gereconstrueerde
   * voorraadbasis.
   *
   * Nieuwe inventory checks vanaf 01-09-2026 blijven
   * zichtbaar.
   */
  const migrationInventoryCutoff =
    new Date(
      "2026-09-01T00:00:00"
    ).getTime();


  events.forEach(event => {
    /*
     * Receipts worden al door items of door de expliciete
     * CIN7 movements geleverd.
     *
     * Hierdoor tonen we dezelfde ontvangst niet dubbel.
     */
    if (
      normalize(
        event.event_type
      ) === "item_received"
    ) {
      return;
    }


    const item =
      itemMap.get(
        String(
          event.entity_id ||
          ""
        )
      );


    const payload =
      event.payload ||
      {};


    const type =
      eventTypeFromWarehouseEvent(
        event
      );


    /*
     * =========================================================
     * OLD MIGRATION INVENTORY CHECKS
     * =========================================================
     *
     * Bij een product waarvoor we een volledige historische
     * CIN7-basis hebben opgebouwd, zijn de oude inventory
     * checks uit de tijdelijke/handmatige Veynor voorraad
     * niet meer relevant voor de nieuwe Stock History.
     *
     * We verwijderen deze events NIET uit de database.
     * Ze worden uitsluitend niet meer weergegeven.
     *
     * Alles vanaf 01-09-2026 blijft gewoon zichtbaar,
     * zodat toekomstige inventory checks normaal blijven
     * functioneren.
     */
    if (
      hasCin7History &&
      type === "inventory_check" &&
      dateToTime(
        event.created_at
      ) <
      migrationInventoryCutoff
    ) {
      return;
    }


    let reference =
      cleanText(
        payload.order_number ||
        payload.inbound_reference ||
        event.reference_no ||
        ""
      );


    /*
     * Technische INBOUND:<uuid> references omzetten naar
     * het leesbare containernummer wanneer dat beschikbaar is.
     */
    if (
      reference.startsWith(
        "INBOUND:"
      )
    ) {
      reference =
        getInboundDisplayReference(
          reference
        );
    }


    /*
     * Order / ACK informatie uit het payload meenemen
     * wanneer warehouse_events die informatie bevat.
     */
    const externalOrderNumber =
      cleanText(
        payload.order_number ||
        ""
      );


    const externalAckReference =
      cleanText(
        payload.ack_reference ||
        payload.external_reference ||
        ""
      );


    /*
     * Indien het event aan een item gekoppeld is kunnen
     * variant en batch vanuit dat item worden overgenomen.
     */
    const stockVariant =
      cleanText(
        item?.stock_variant ||
        ""
      );


    const batchReference =
      cleanText(
        item?.batch_number ||
        ""
      );


    /*
     * Event omzetten naar één uniforme Stock History movement.
     */
    rows.push(
      movementRecord({
        date:
          event.created_at,

        type,

        reference:
          reference ||
          event.reference_no ||
          "Warehouse Event",

        secondaryReference:
          cleanText(
            payload.retailer_name ||
            ""
          ),

        warehouseId:
          payload.warehouse_id ||
          item?.warehouse_id ||
          null,

        locationId:
          payload.location_id ||
          item?.location_id ||
          null,

        quantity:
          warehouseEventQuantity(
            event,
            type
          ),

        /*
         * Oude warehouse_events bevatten meestal geen
         * betrouwbare package quantity.
         *
         * Daarom niet gokken.
         */
        packageQuantity:
          null,

        user:
          profileName(
            event.user_profile_id
          ),

        notes:
          [
            cleanText(
              event.source_module
                ? `Source: ${event.source_module}`
                : ""
            ),

            cleanText(
              event.old_status ||
              event.new_status
                ? `${event.old_status || "—"} → ${event.new_status || "—"}`
                : ""
            )
          ]
            .filter(Boolean)
            .join(" · "),

        source:
          "warehouse_events",

        /*
         * Warehouse events zijn Veynor-events.
         */
        sourceSystem:
          "VEYNOR",

        stockVariant,

        batchReference,

        externalOrderNumber,

        externalAckReference,

        itemId:
          event.entity_id ||
          null
      })
    );
  });


  return rows;
}

  function movementTableType(
    movement
  ) {
    const type =
      normalize(
        movement
          ?.movement_type
      );

    if (
      type.includes(
        "receipt"
      ) ||
      type.includes(
        "inbound"
      ) ||
      type.includes(
        "stock_in"
      )
    ) {
      return "receipt";
    }

    if (
      type.includes(
        "ship"
      ) ||
      type.includes(
        "outbound"
      ) ||
      type.includes(
        "book_out"
      )
    ) {
      return "shipment";
    }

    if (
      type.includes(
        "return"
      )
    ) {
      return "return";
    }

    if (
      type.includes(
        "inventory"
      )
    ) {
      return "inventory_check";
    }

    if (
      type.includes(
        "location"
      ) ||
      type.includes(
        "transfer"
      )
    ) {
      return "location_move";
    }

    return "adjustment";
  }

 function movementTableQuantity(
  movement,
  type
) {
  /*
   * Nieuwe movementstructuur heeft altijd voorrang.
   *
   * Bijvoorbeeld:
   * quantity_units = 18
   *
   * Dan moet Stock History +18 tonen,
   * niet +1.
   */
  if (
    movement.quantity_units !== null &&
    movement.quantity_units !== undefined
  ) {
    const explicit =
      Number(
        movement.quantity_units
      );

    if (
      Number.isFinite(explicit)
    ) {
      return explicit;
    }
  }

  /*
   * Legacy fallback.
   *
   * Oude movements hadden quantity vaak alleen
   * in notes staan.
   */
  const text =
    `${
      movement.movement_type || ""
    } ${
      movement.notes || ""
    }`
      .toLowerCase();

  const numberMatch =
    text.match(
      /(?:qty|quantity|change)\s*[:=]?\s*(-?\d+)/i
    );

  if (numberMatch) {
    return toNumber(
      numberMatch[1],
      0
    );
  }

  if (
    type === "shipment"
  ) {
    return -1;
  }

  if (
    type === "receipt" ||
    type === "return"
  ) {
    return 1;
  }

  return 0;
}

 function buildMovementTableRows(
  movements
) {
  return movements.map(
    movement => {
      const type =
        movementTableType(
          movement
        );

      const sourceSystem =
        cleanText(
          movement.source_system ||
          ""
        ).toUpperCase();

      const batchReference =
        cleanText(
          movement.batch_reference ||
          ""
        );

      const stockVariant =
        cleanText(
          movement.stock_variant ||
          ""
        );

      const externalOrder =
        cleanText(
          movement.external_order_number ||
          ""
        );

      const externalAck =
        cleanText(
          movement.external_ack_reference ||
          ""
        );

      /*
       * Reference:
       *
       * VEYNOR:
       * SO-03544
       *
       * CIN7 zonder order:
       * CIN7
       *
       * Oude movements:
       * bestaande fallback behouden.
       */
      let reference =
        externalOrder ||
        movement.scan_value ||
        "";

      if (
        !reference &&
        sourceSystem
      ) {
        reference =
          `[${sourceSystem}]`;
      }

      if (!reference) {
        reference =
          movement.order_id ||
          movement.shipment_id ||
          movement.movement_type ||
          "Movement";
      }

      /*
       * Tweede regel onder Reference.
       *
       * Voorbeeld:
       *
       * ACK1453 · Standard · Batch 1
       */
      const secondaryParts = [];

      if (externalAck) {
        secondaryParts.push(
          externalAck
        );
      }

      if (stockVariant) {
        secondaryParts.push(
          stockVariant
        );
      }

      if (batchReference) {
        secondaryParts.push(
          batchReference
        );
      }

      const packageQuantity =
        movement.quantity_packages !== null &&
        movement.quantity_packages !== undefined
          ? toNumber(
              movement.quantity_packages,
              0
            )
          : null;

      /*
       * Notes netjes uitbreiden zonder historische
       * notes kwijt te raken.
       */
      const noteParts = [];

      if (sourceSystem) {
        noteParts.push(
          `Source: ${sourceSystem}`
        );
      }

      if (stockVariant) {
        noteParts.push(
          `Variant: ${stockVariant}`
        );
      }

      if (batchReference) {
        noteParts.push(
          `Batch: ${batchReference}`
        );
      }

      if (
        packageQuantity !== null
      ) {
        const sign =
          packageQuantity > 0
            ? "+"
            : "";

        noteParts.push(
          `Packages: ${sign}${packageQuantity}`
        );
      }

      if (
        cleanText(
          movement.notes
        )
      ) {
        noteParts.push(
          cleanText(
            movement.notes
          )
        );
      }

      return movementRecord({
        date:
          movement.created_at,

        type,

        reference,

        secondaryReference:
          secondaryParts.join(
            " · "
          ),

        warehouseId:
          movement.warehouse_id,

        locationId:
          movement.location_id,

        quantity:
          movementTableQuantity(
            movement,
            type
          ),

        packageQuantity,

        notes:
          noteParts.join(
            " · "
          ),

source:
  "movements",

sourceSystem,

        batchReference,

        stockVariant,

        externalOrderNumber:
          externalOrder,

        externalAckReference:
          externalAck,

        migratedFromLegacy:
          movement.migrated_from_legacy ===
          true,

        itemId:
          movement.item_id ||
          null
      });
    }
  );
}

function buildShipmentFallbackMovements(
  productItems,
  allocations,
  explicitMovements = []
) {
  const allocationByItem =
    new Map();


  allocations.forEach(
    allocation => {
      const key =
        String(
          allocation.item_id
        );

      const current =
        allocationByItem.get(
          key
        );

      if (
        !current ||
        dateToTime(
          allocation.allocated_at
        ) >=
        dateToTime(
          current.allocated_at
        )
      ) {
        allocationByItem.set(
          key,
          allocation
        );
      }
    }
  );


  /*
   * Orders waarvoor al een expliciete VEYNOR shipment
   * in public.movements bestaat.
   *
   * Deze mogen niet nogmaals vanuit items worden
   * opgebouwd.
   */
  const explicitVeynorOrders =
    new Set(
      (explicitMovements || [])
        .filter(
          movement =>
            normalize(
              movement.source_system
            ) === "veynor" &&
            movementTableType(
              movement
            ) === "shipment"
        )
        .map(
          movement =>
            cleanText(
              movement.external_order_number
            )
        )
        .filter(Boolean)
    );


  /*
   * Zelfde bescherming op itemniveau.
   */
  const explicitItemIds =
    new Set(
      (explicitMovements || [])
        .filter(
          movement =>
            movementTableType(
              movement
            ) === "shipment" &&
            movement.item_id
        )
        .map(
          movement =>
            String(
              movement.item_id
            )
        )
    );


  return productItems
    .filter(
      item =>
        item.shipped_at &&
        isOutboundStatus(
          item
        )
    )
    .map(
      item => {
        const allocation =
          allocationByItem.get(
            String(
              item.id
            )
          );

        const order =
          allocation?.order ||
          null;

        const orderNumber =
          cleanText(
            order?.order_number ||
            ""
          );


        /*
         * Expliciete VEYNOR movement bestaat al.
         */
        if (
          orderNumber &&
          explicitVeynorOrders.has(
            orderNumber
          )
        ) {
          return null;
        }


        /*
         * Expliciete movement voor exact item bestaat al.
         */
        if (
          explicitItemIds.has(
            String(
              item.id
            )
          )
        ) {
          return null;
        }


        const reference =
          order
            ? orderMainReference(
                order
              )
            : (
                item.sku_unique ||
                "Outbound"
              );


        const secondaryReference =
          order
            ? orderSubReference(
                order
              )
            : "";


        return movementRecord({
          date:
            item.shipped_at,

          type:
            "shipment",

          reference,

          secondaryReference,

          warehouseId:
            item.warehouse_id,

          locationId:
            item.location_id,

          /*
           * Legacy fallback is item-based.
           *
           * Voor nieuwe gereconstrueerde data wordt deze
           * fallback niet gebruikt als een expliciete
           * movement aanwezig is.
           */
          quantity:
            -1,

          packageQuantity:
            -1,

          user:
            "",

          notes:
            order
              ? `Stock shipped against ${
                  order.order_number ||
                  "order"
                }.`
              : "Physical package shipped from stock.",

          source:
            "items",

          sourceSystem:
            "VEYNOR",

          batchReference:
            item.batch_number ||
            "",

          stockVariant:
            item.stock_variant ||
            "",

          externalOrderNumber:
            order?.order_number ||
            "",

          externalAckReference:
            order?.external_reference ||
            "",

          itemId:
            item.id
        });
      }
    )
    .filter(Boolean);
}

  /* =========================================================
   * DE-DUPLICATION
   * ======================================================= */

function movementIdentity(
  movement
) {
  return [
    normalize(
      movement.type
    ),

    movement.item_id ||
      "",

    String(
      movement.date ||
      ""
    ).slice(
      0,
      23
    ),

    normalize(
      movement.reference
    ),

    /*
     * Variant en batch zijn onderdeel van de identiteit.
     *
     * Daardoor zijn bijvoorbeeld:
     *
     * SO-03650 · Standard · Batch 1 · -4
     *
     * en
     *
     * SO-03650 · Standard · Batch 3 · -1
     *
     * twee verschillende historische movements.
     */
    normalize(
      movement.stock_variant
    ),

    normalize(
      movement.batch_reference
    ),

    /*
     * Ook quantity meenemen om verschillende bewegingen
     * binnen dezelfde order/batch niet per ongeluk samen
     * te voegen.
     */
    String(
      toNumber(
        movement.quantity,
        0
      )
    ),

    String(
      movement.package_quantity !==
        null &&
      movement.package_quantity !==
        undefined
        ? toNumber(
            movement.package_quantity,
            0
          )
        : ""
    )
  ].join("|");
}

  function removeDuplicateMovements(
    movements
  ) {
    const result = [];
    const seen =
      new Set();

    movements
      .sort(
        (a, b) =>
          dateToTime(a.date) -
          dateToTime(b.date)
      )
      .forEach(movement => {
        const key =
          movementIdentity(
            movement
          );

        if (
          seen.has(key)
        ) {
          return;
        }

        seen.add(key);

        result.push(
          movement
        );
      });

    return result;
  }


  /* =========================================================
   * BALANCE
   * ======================================================= */

function currentPhysicalUnitsForProduct(
  productId
) {
  const productItems =
    allItems.filter(
      item =>
        String(
          item.product_id
        ) ===
          String(
            productId
          ) &&
        isPhysical(
          item
        )
    );


  const physicalKeys =
    new Set();


  productItems.forEach(
    item => {

      /*
       * Beste identificatie:
       * één physical_product_id = één fysiek product.
       *
       * CRO808:
       * 1/2 + 2/2 delen hetzelfde physical_product_id
       * en tellen dus samen als één product.
       */
      if (
        item.physical_product_id
      ) {
        physicalKeys.add(
          `physical:${item.physical_product_id}`
        );

        return;
      }


      /*
       * Tweede keuze:
       * stock_set_id.
       */
      if (
        item.stock_set_id
      ) {
        physicalKeys.add(
          `set:${item.stock_set_id}`
        );

        return;
      }


      /*
       * Legacy artikelen zonder setstructuur.
       * Daar telt ieder item als één fysieke unit.
       */
      physicalKeys.add(
        `item:${item.id}`
      );
    }
  );


  return physicalKeys.size;
}  

function calculateBalances(
  movements,
  currentPhysicalUnits = null,
  hasCin7History = false,
  ledgerPhysicalUnits = null
) {
  /*
   * =========================================================
   * SORT HISTORY
   * =========================================================
   */

  let rows =
    [...movements].sort(
      (a, b) =>
        dateToTime(a.date) -
        dateToTime(b.date)
    );


  const ledgerManaged =
    ledgerPhysicalUnits !== null &&
    ledgerPhysicalUnits !== undefined;


  /*
   * =========================================================
   * LEDGER-MANAGED PRODUCTS
   * =========================================================
   *
   * product_stock_ledger is de actuele waarheid.
   *
   * Voorbeeld CRO805:
   *
   * Physical = 29
   *
   * We rekenen de historie ACHTERWAARTS vanaf 29.
   *
   * Daardoor hoeft Stock History niet opnieuw te raden
   * wat de huidige voorraad is.
   *
   * Alleen echte public.movements veranderen de fysieke
   * voorraad.
   *
   * order_allocations:
   * reservation blijft zichtbaar, maar verandert Physical niet.
   *
   * warehouse_events:
   * blijven zichtbaar, maar veranderen de ledger balance niet
   * zelfstandig.
   * =========================================================
   */

  if (ledgerManaged) {

    let balance =
      toNumber(
        ledgerPhysicalUnits,
        0
      );


    /*
     * Nieuwste gebeurtenis eerst.
     *
     * We kennen immers de voorraad VANDAAG en rekenen
     * vanaf daar terug naar het verleden.
     */
    const newestFirst =
      [...rows].sort(
        (a, b) =>
          dateToTime(b.date) -
          dateToTime(a.date)
      );


    newestFirst.forEach(
      movement => {

        /*
         * -----------------------------------------------------
         * BALANCE OP DEZE REGEL
         * -----------------------------------------------------
         *
         * Balance betekent:
         *
         * fysieke voorraad NADAT deze gebeurtenis heeft
         * plaatsgevonden.
         *
         * Voorbeeld:
         *
         * huidige voorraad             29
         *
         * Reservation                  29
         * laatste Shipment -1          29
         * shipment daarvoor -1         30
         * shipment daarvoor -1         31
         */

        movement.balance =
          balance;


        /*
         * -----------------------------------------------------
         * ALLEEN PUBLIC.MOVEMENTS TERUGREKENEN
         * -----------------------------------------------------
         *
         * Echte database movement:
         *
         * source = "movements"
         *
         * Reservation:
         *
         * source = "order_allocations"
         *
         * Warehouse event:
         *
         * source = "warehouse_events"
         *
         * Alleen de eerste categorie is onderdeel van de
         * fysieke ledger.
         */

        const isExplicitMovement =
          normalize(
            movement.source
          ) === "movements";


        if (isExplicitMovement) {

          /*
           * We rekenen ACHTERWAARTS.
           *
           * Shipment -1:
           *
           * huidige balance 29
           * vóór shipment = 29 - (-1) = 30
           *
           * Receipt +10:
           *
           * huidige balance 30
           * vóór receipt = 30 - 10 = 20
           */

          balance -=
            toNumber(
              movement.quantity,
              0
            );
        }
      }
    );


    /*
     * Geen kunstmatige correctie naar Physical.
     *
     * De actuele Physical waarmee we begonnen is rechtstreeks
     * afkomstig uit product_stock_ledger.
     */

    return newestFirst;
  }


  /*
   * =========================================================
   * LEGACY PRODUCTS
   * =========================================================
   *
   * Voor producten die nog NIET via product_stock_ledger
   * worden beheerd blijft de bestaande methode actief.
   *
   * Zo breken we oudere, nog niet gemigreerde SKU's niet.
   * =========================================================
   */


  const knownPhysicalChange =
    rows.reduce(
      (sum, movement) =>
        sum +
        toNumber(
          movement.quantity,
          0
        ),
      0
    );


  /*
   * =========================================================
   * LEGACY OPENING BALANCE
   * =========================================================
   *
   * Alleen gebruiken wanneer:
   *
   * - er geen complete CIN7-history is;
   * - huidige fysieke voorraad bekend is.
   */

  if (
    !hasCin7History &&
    currentPhysicalUnits !== null &&
    currentPhysicalUnits !== undefined
  ) {

    const physical =
      toNumber(
        currentPhysicalUnits,
        0
      );


    const openingBalance =
      physical -
      knownPhysicalChange;


    if (openingBalance !== 0) {

      const firstMovementDate =
        rows.length
          ? rows[0].date
          : new Date().toISOString();


      let openingDate =
        new Date(
          firstMovementDate
        );


      if (
        Number.isNaN(
          openingDate.getTime()
        )
      ) {
        openingDate =
          new Date();
      }


      /*
       * Opening Balance één seconde vóór de eerste bekende
       * movement plaatsen.
       */

      openingDate.setSeconds(
        openingDate.getSeconds() - 1
      );


      rows.unshift(
        movementRecord({
          date:
            openingDate.toISOString(),

          type:
            "opening_balance",

          reference:
            "Opening Balance",

          quantity:
            openingBalance,

          packageQuantity:
            null,

          user:
            "System",

          notes:
            "Opening stock balance added to reconcile incomplete legacy history with the current physical product quantity.",

          source:
            "calculated"
        })
      );
    }
  }


  /*
   * =========================================================
   * LEGACY RUNNING BALANCE
   * =========================================================
   *
   * Oude producten blijven chronologisch vooruit rekenen.
   */

  let balance = 0;


  rows
    .sort(
      (a, b) =>
        dateToTime(a.date) -
        dateToTime(b.date)
    )
    .forEach(
      movement => {

        balance +=
          toNumber(
            movement.quantity,
            0
          );


        movement.balance =
          balance;
      }
    );


  /*
   * Nieuwste movement bovenaan weergeven.
   */

  return rows.sort(
    (a, b) =>
      dateToTime(b.date) -
      dateToTime(a.date)
  );
}

async function buildHistoryForProduct(
  productId
) {
  /*
   * =========================================================
   * PRODUCT ITEMS
   * =========================================================
   */
  const productItems =
    allItems.filter(
      item =>
        String(
          item.product_id
        ) ===
        String(
          productId
        )
    );


  const itemMap =
    new Map(
      productItems.map(
        item => [
          String(
            item.id
          ),
          item
        ]
      )
    );


  /*
   * =========================================================
   * LOAD ALL HISTORY SOURCES
   * =========================================================
   */
  const [
    allocations,
    warehouseEvents,
    movementRows
  ] =
    await Promise.all([
      loadAllocationsForProduct(
        productId
      ),

      loadWarehouseEventsForProduct(
        productId
      ),

      loadMovementsForProduct(
        productId
      )
    ]);


  /*
   * =========================================================
   * DETECT COMPLETE CIN7 HISTORY
   * =========================================================
   *
   * Een product wordt als historisch gemigreerd beschouwd
   * wanneer er minimaal één expliciete CIN7 receipt in
   * public.movements aanwezig is.
   *
   * CRO808 heeft zo'n volledige gereconstrueerde basis.
   *
   * Daardoor mogen oude item-based receipts en shipments
   * niet opnieuw als historische movements worden opgebouwd.
   */
  const hasCin7History =
    movementRows.some(
      movement =>
        normalize(
          movement.source_system
        ) === "cin7" &&
        movementTableType(
          movement
        ) === "receipt"
    );


  let rows = [];


  /*
   * =========================================================
   * 1. RECEIPTS
   * =========================================================
   *
   * ZONDER CIN7-history:
   * oude receipts mogen vanuit items worden opgebouwd.
   *
   * MET CIN7-history:
   * buildReceiptMovements() geeft [] terug.
   *
   * Daardoor verdwijnen oude tijdelijke Veynor Stock Receipts
   * zoals de eerdere +9 / +10 van CRO808.
   */
  rows =
    rows.concat(
      buildReceiptMovements(
        productItems,
        hasCin7History
      )
    );


  /*
   * =========================================================
   * 2. RESERVATIONS
   * =========================================================
   *
   * Reservations komen uit order_allocations.
   *
   * Deze blijven ook bij een CIN7-gemigreerd product relevant,
   * omdat dit echte Veynor-orderhistorie is.
   *
   * Meerdere allocations van dezelfde reserveringsactie worden
   * door buildAllocationMovements() gegroepeerd.
   *
   * Bijvoorbeeld:
   *
   * SO-03650
   * 5 reserved
   *
   * = één historyregel.
   */
  rows =
    rows.concat(
      buildAllocationMovements(
        allocations,
        itemMap
      )
    );


  /*
   * =========================================================
   * 3. WAREHOUSE EVENTS
   * =========================================================
   *
   * Warehouse events blijven beschikbaar.
   *
   * buildWarehouseEventMovements() weet via hasCin7History
   * dat oude migratie/inventory-check events moeten worden
   * onderdrukt.
   *
   * Nieuwe Veynor warehouse-events blijven gewoon zichtbaar.
   */
  rows =
    rows.concat(
      buildWarehouseEventMovements(
        warehouseEvents,
        itemMap,
        hasCin7History
      )
    );


  /*
   * =========================================================
   * 4. EXPLICIT MOVEMENTS
   * =========================================================
   *
   * Dit is voor gemigreerde producten de leidende bron.
   *
   * Hier komen onder andere vandaan:
   *
   * CIN7 Receipt
   * CIN7 Shipment
   *
   * en onze gereconstrueerde:
   *
   * VEYNOR Shipment
   *
   * met:
   *
   * SO
   * ACK
   * Standard / Kayflex
   * Batch
   * Products
   * Packages
   */
  rows =
    rows.concat(
      buildMovementTableRows(
        movementRows
      )
    );


  /*
   * =========================================================
   * 5. LEGACY SHIPMENT FALLBACK
   * =========================================================
   *
   * ZEER BELANGRIJK:
   *
   * Deze fallback mag ALLEEN worden gebruikt wanneer het
   * product GEEN volledige CIN7-history heeft.
   *
   * Voor CRO808 hebben we de historische Veynor shipments
   * inmiddels expliciet in public.movements staan.
   *
   * Wanneer we hier alsnog de oude shipped items zouden
   * toevoegen, krijgen we bijvoorbeeld:
   *
   * 31/08/2026
   * CRO808-IN-...-PKG2OF2
   * -1
   *
   * tien keer opnieuw.
   *
   * Dat veroorzaakt:
   *
   * - dubbele outbound-history;
   * - technische artikel/itemnummers onder Reference;
   * - een foutieve balance van 33 naar 23.
   *
   * Daarom:
   *
   * CIN7-history aanwezig -> GEEN shipment fallback.
   *
   * Legacy product -> fallback blijft gewoon beschikbaar.
   */
  if (
    !hasCin7History
  ) {
    rows =
      rows.concat(
        buildShipmentFallbackMovements(
          productItems,
          allocations,
          movementRows
        )
      );
  }


  /*
   * =========================================================
   * 6. REMOVE TECHNICAL DUPLICATES
   * =========================================================
   */
  rows =
    removeDuplicateMovements(
      rows
    );


  /*
   * =========================================================
   * 7. CURRENT PHYSICAL STOCK
   * =========================================================
   *
   * Tellen in fysieke producten, niet in colli.
   *
   * CRO808:
   *
   * 31 in_stock
   * 1 reserved
   *
   * = 32 physical products.
   */
  const currentPhysicalUnits =
    currentPhysicalUnitsForProduct(
      productId
    );


  /*
   * =========================================================
   * 8. CALCULATE HISTORICAL BALANCE
   * =========================================================
   *
   * Bij volledige CIN7-history:
   *
   * - historie begint bij de echte eerste CIN7 receipt;
   * - geen kunstmatige Opening Balance;
   * - balance wordt chronologisch opgebouwd.
   *
   * Bij legacy-producten:
   *
   * - bestaande opening-balance/reconciliation blijft
   *   beschikbaar.
   */
const ledger =
  productStockLedger.get(
    String(productId)
  ) || null;


rows =
  calculateBalances(
    rows,
    currentPhysicalUnits,
    hasCin7History,
    ledger &&
    ledger.movement_count > 0
      ? ledger.physical_units
      : null
  );


  /*
   * calculateBalances() retourneert newest first,
   * zodat de nieuwste movement bovenaan Stock History staat.
   */
  return rows;
}

  async function selectProduct(
    productId,
    scrollIntoView = false
  ) {
    const group =
      productGroups.find(
        row =>
          String(
            row.product_id
          ) ===
          String(productId)
      );

    if (!group) {
      showToast(
        "Product not found.",
        "err"
      );

      return;
    }

    selectedProductId =
      group.product_id;

    selectedProduct =
      group;

    movementPage = 1;

    renderSelectedProductSummary();

    setText(
      "movementHistoryMeta",
      "Loading movement history..."
    );

    const body =
      byId(
        "movementHistoryBody"
      );

    if (body) {
      body.innerHTML = `
        <tr>
          <td colspan="8" class="loading-row">
            Loading complete movement history for
            ${escapeHtml(group.sku_base)}...
          </td>
        </tr>
      `;
    }

    try {
      selectedMovements =
        await buildHistoryForProduct(
          group.product_id
        );

      filteredMovements =
        [...selectedMovements];

      renderSelectedProductSummary();
      applyMovementFilters(false);
      renderProductTable();

      const url =
        new URL(
          window.location.href
        );

      url.searchParams.set(
        "sku",
        group.sku_base
      );

      window.history.replaceState(
        {},
        "",
        url
      );

      if (scrollIntoView) {
        byId(
          "selectedHistoryCard"
        )?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    } catch (error) {
      console.error(
        "Product history load failed:",
        error
      );

      showToast(
        error.message ||
        "Could not load product history.",
        "err"
      );
    }
  }


  /* =========================================================
   * SELECTED PRODUCT HEADER
   * ======================================================= */

  function renderSelectedProductSummary() {
  const group =
    selectedProduct;

  const excel =
    byId(
      "btnSelectedHistoryExcel"
    );

  const pdf =
    byId(
      "btnSelectedHistoryPdf"
    );

  const image =
    byId(
      "selectedProductImage"
    );

  const placeholder =
    byId(
      "selectedProductPlaceholder"
    );


  /* =====================================================
   * NO PRODUCT SELECTED
   * =================================================== */

  if (!group) {
    setText(
      "selectedProductSku",
      "Select a product"
    );

    setText(
      "selectedProductName",
      "Choose View History from the product overview."
    );

    setText(
      "selectedProductOwner",
      "—"
    );

    setText(
      "selectedPhysical",
      "0"
    );

    setText(
      "selectedAvailable",
      "0"
    );

    setText(
      "selectedReserved",
      "0"
    );

    setText(
      "selectedCommitted",
      "0"
    );

    if (excel) {
      excel.disabled = true;
    }

    if (pdf) {
      pdf.disabled = true;
    }


    /*
     * Belangrijk:
     * oude afbeelding volledig verwijderen.
     */
    if (image) {
      image.removeAttribute(
        "src"
      );

      image.removeAttribute(
        "alt"
      );

      image.hidden = true;
    }

    if (placeholder) {
      placeholder.hidden = false;
    }

    return;
  }


  /* =====================================================
   * PRODUCT DATA
   * =================================================== */

  setText(
    "selectedProductSku",
    group.sku_base
  );

  setText(
    "selectedProductName",
    group.product_name
  );

  setText(
    "selectedProductOwner",
    group.customer_name ||
    "—"
  );

  setText(
    "selectedPhysical",
    formatNumber(
      group.physical
    )
  );

  setText(
    "selectedAvailable",
    formatNumber(
      group.available
    )
  );

  setText(
    "selectedReserved",
    formatNumber(
      group.reserved
    )
  );

  setText(
    "selectedCommitted",
    formatNumber(
      group.committed
    )
  );


  if (excel) {
    excel.disabled = false;
  }

  if (pdf) {
    pdf.disabled = false;
  }


  /* =====================================================
   * PRODUCT IMAGE
   * =================================================== */

  if (
    image &&
    placeholder
  ) {

    /*
     * Product heeft eigen afbeelding.
     */
    if (
      group.image_url
    ) {
      image.src =
        group.image_url;

      image.alt =
        group.product_name ||
        group.sku_base ||
        "Product image";

      image.hidden =
        false;

      placeholder.hidden =
        true;

    } else {

      /*
       * Product heeft GEEN afbeelding.
       *
       * Oude src expliciet verwijderen,
       * zodat bijvoorbeeld CRO806 niet blijft hangen
       * wanneer daarna CRO801 wordt geopend.
       */
      image.removeAttribute(
        "src"
      );

      image.removeAttribute(
        "alt"
      );

      image.hidden =
        true;

      placeholder.hidden =
        false;
    }
  }
}


  /* =========================================================
   * MOVEMENT FILTERS
   * ======================================================= */

 function applyMovementFilters(
  resetPage = true
) {
  const search =
    normalize(
      byId(
        "movementSearch"
      )?.value ||
      ""
    );


  const type =
    normalize(
      byId(
        "movementTypeFilter"
      )?.value ||
      ""
    );


  const from =
    byId(
      "movementDateFrom"
    )?.value ||
    "";


  const to =
    byId(
      "movementDateTo"
    )?.value ||
    "";


  filteredMovements =
    selectedMovements.filter(
      movement => {

        if (
          type &&
          normalize(
            movement.type
          ) !== type
        ) {
          return false;
        }


        const time =
          dateToTime(
            movement.date
          );


        if (from) {
          const fromTime =
            new Date(
              `${from}T00:00:00`
            ).getTime();

          if (
            time <
            fromTime
          ) {
            return false;
          }
        }


        if (to) {
          const toTime =
            new Date(
              `${to}T23:59:59`
            ).getTime();

          if (
            time >
            toTime
          ) {
            return false;
          }
        }


        if (search) {
          const haystack =
            [
              movement.reference,
              movement.secondary_reference,

              movement.external_order_number,
              movement.external_ack_reference,

              movement.source_system,
              movement.source,

              movement.stock_variant,
              movement.batch_reference,

              movement.warehouse_name,
              movement.location_code,

              movement.user,
              movement.notes,
              movement.type
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();


          if (
            !haystack.includes(
              search
            )
          ) {
            return false;
          }
        }


        return true;
      }
    );


  if (
    resetPage
  ) {
    movementPage = 1;
  }


  renderMovementTable();
}


  /* =========================================================
   * MOVEMENT LABELS
   * ======================================================= */

  function movementLabel(type) {
const map = {
  opening_balance:
    "Opening Balance",

  receipt:
    "Receipt",

  reservation:
    "Reservation",

  reservation_released:
    "Reservation Released",

  shipment:
    "Shipment",

  inventory_check:
    "Inventory Check",

  adjustment:
    "Adjustment",

  return:
    "Return",

  location_move:
    "Location Move"
};

    return (
      map[
        normalize(type)
      ] ||
      String(type || "Event")
        .replaceAll(
          "_",
          " "
        )
    );
  }

function movementClass(type) {
  const map = {
    opening_balance:
      "inventory",

    receipt:
      "receipt",

    reservation:
      "reservation",

    reservation_released:
      "release",

    shipment:
      "shipment",

    inventory_check:
      "inventory",

    adjustment:
      "adjustment",

    return:
      "return",

    location_move:
      "location"
  };

  return (
    map[
      normalize(type)
    ] ||
    "adjustment"
  );
}

  function quantityClass(
    quantity
  ) {
    const number =
      toNumber(
        quantity,
        0
      );

    if (number > 0) {
      return "positive";
    }

    if (number < 0) {
      return "negative";
    }

    return "neutral";
  }

  function quantityDisplay(
    quantity
  ) {
    const number =
      toNumber(
        quantity,
        0
      );

    if (number > 0) {
      return `+${formatNumber(
        number
      )}`;
    }

    if (number < 0) {
      return formatNumber(
        number
      );
    }

    return "—";
  }


  /* =========================================================
   * MOVEMENT TABLE
   * ======================================================= */

 function renderMovementTable() {
  const body =
    byId(
      "movementHistoryBody"
    );


  if (!body) {
    return;
  }


  /*
   * =========================================================
   * NO PRODUCT SELECTED
   * =========================================================
   */
  if (
    !selectedProduct
  ) {
    body.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="history-empty">

            <div class="history-empty-icon">
              ↕
            </div>

            <strong>
              Select a product
            </strong>

            <span>
              The complete stock movement history will appear here.
            </span>

          </div>
        </td>
      </tr>
    `;

    return;
  }


  /*
   * =========================================================
   * PAGINATION
   * =========================================================
   */
  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filteredMovements.length /
        MOVEMENT_PAGE_SIZE
      )
    );


  movementPage =
    Math.min(
      Math.max(
        1,
        movementPage
      ),
      totalPages
    );


  const start =
    (
      movementPage - 1
    ) *
    MOVEMENT_PAGE_SIZE;


  const visible =
    filteredMovements.slice(
      start,
      start +
      MOVEMENT_PAGE_SIZE
    );


  /*
   * =========================================================
   * EMPTY RESULT
   * =========================================================
   */
  if (
    !visible.length
  ) {
    body.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="history-empty">

            <div class="history-empty-icon">
              ↕
            </div>

            <strong>
              No history found
            </strong>

            <span>
              No movements match the selected filters.
            </span>

          </div>
        </td>
      </tr>
    `;

  } else {

    /*
     * =======================================================
     * MOVEMENT ROWS
     * =======================================================
     */
    body.innerHTML =
      visible
        .map(
          movement => {

            const movementType =
              normalize(
                movement.type
              );


            /*
             * -------------------------------------------------
             * SOURCE SYSTEM
             * -------------------------------------------------
             */
            const sourceSystem =
              cleanText(
                movement.source_system ||
                ""
              )
                .toUpperCase();


            const sourceLabel =
              sourceSystem
                ? `[${sourceSystem}]`
                : "";


            /*
             * -------------------------------------------------
             * REFERENCES
             * -------------------------------------------------
             */
            const reference =
              cleanText(
                movement.reference ||
                "—"
              );


            const orderNumber =
              cleanText(
                movement.external_order_number ||
                ""
              );


            const ack =
              cleanText(
                movement.external_ack_reference ||
                ""
              );


            const existingSecondary =
              cleanText(
                movement.secondary_reference ||
                ""
              );


            const secondaryParts =
              [];


            /*
             * SO toevoegen wanneer deze nog niet als
             * hoofdreference wordt weergegeven.
             */
            if (
              orderNumber &&
              normalize(
                orderNumber
              ) !==
              normalize(
                reference
              )
            ) {
              secondaryParts.push(
                orderNumber
              );
            }


            /*
             * ACK / externe reference.
             */
            if (
              ack &&
              normalize(
                ack
              ) !==
              normalize(
                reference
              ) &&
              !secondaryParts.some(
                value =>
                  normalize(value) ===
                  normalize(ack)
              )
            ) {
              secondaryParts.push(
                ack
              );
            }


            /*
             * Bestaande secondary reference kan bijvoorbeeld
             * bevatten:
             *
             * ACK1453
             * PU-19-08
             * PO Painting Greg
             *
             * Dubbele waarden worden eruit gehaald.
             */
            if (
              existingSecondary
            ) {
              existingSecondary
                .split(" · ")
                .map(
                  value =>
                    cleanText(value)
                )
                .filter(Boolean)
                .forEach(
                  value => {
                    if (
                      normalize(value) !==
                        normalize(reference) &&
                      !secondaryParts.some(
                        existing =>
                          normalize(existing) ===
                          normalize(value)
                      )
                    ) {
                      secondaryParts.push(
                        value
                      );
                    }
                  }
                );
            }


            const secondaryReference =
              secondaryParts.join(
                " · "
              );


            /*
             * -------------------------------------------------
             * VARIANT / BATCH
             * -------------------------------------------------
             */
            const variant =
              cleanText(
                movement.stock_variant ||
                ""
              );


            const batch =
              cleanText(
                movement.batch_reference ||
                ""
              );


            const stockParts =
              [];


            if (variant) {
              stockParts.push(
                variant
              );
            }


            if (batch) {
              stockParts.push(
                batch
              );
            }


            const stockReference =
              stockParts.join(
                " · "
              );


            /*
             * -------------------------------------------------
             * PHYSICAL MOVEMENT QUANTITY
             * -------------------------------------------------
             *
             * Dit is de echte voorraadmutatie.
             *
             * Receipt   +8
             * Shipment  -1
             * Reservation 0
             */
            const unitQuantity =
              toNumber(
                movement.quantity,
                0
              );


            /*
             * -------------------------------------------------
             * PACKAGE QUANTITY
             * -------------------------------------------------
             *
             * Bijvoorbeeld CRO808:
             *
             * -1 product
             * -2 packages
             */
            const packageQuantity =
              movement.package_quantity !==
                null &&
              movement.package_quantity !==
                undefined
                ? toNumber(
                    movement.package_quantity,
                    0
                  )
                : null;


            /*
             * -------------------------------------------------
             * RESERVATION QUANTITY
             * -------------------------------------------------
             *
             * Reservation heeft bewust movement.quantity = 0
             * omdat reserveren de fysieke voorraad niet wijzigt.
             *
             * reservation_quantity is alleen de hoeveelheid
             * producten die aan de order is gereserveerd.
             *
             * Bijvoorbeeld:
             *
             * SO-03650
             * 5 reserved
             */
            const reservationQuantity =
              movement.reservation_quantity !==
                null &&
              movement.reservation_quantity !==
                undefined
                ? toNumber(
                    movement.reservation_quantity,
                    0
                  )
                : null;


            const isReservation =
              movementType ===
                "reservation";


            const isReservationReleased =
              movementType ===
                "reservation_released";


            /*
             * -------------------------------------------------
             * QUANTITY DISPLAY
             * -------------------------------------------------
             */
            let quantityHtml = "";


            if (
              isReservation &&
              reservationQuantity !== null &&
              reservationQuantity > 0
            ) {
              quantityHtml = `
                <span class="qty neutral">
                  ${escapeHtml(
                    formatNumber(
                      reservationQuantity
                    )
                  )}
                </span>

                <span class="subline">
                  reserved
                </span>
              `;

            } else if (
              isReservationReleased &&
              reservationQuantity !== null &&
              reservationQuantity > 0
            ) {
              quantityHtml = `
                <span class="qty neutral">
                  ${escapeHtml(
                    formatNumber(
                      reservationQuantity
                    )
                  )}
                </span>

                <span class="subline">
                  released
                </span>
              `;

            } else {
              quantityHtml = `
                <span class="qty ${quantityClass(
                  unitQuantity
                )}">
                  ${escapeHtml(
                    quantityDisplay(
                      unitQuantity
                    )
                  )}
                </span>
              `;


              if (
                packageQuantity !== null &&
                packageQuantity !== 0
              ) {
                quantityHtml += `
                  <span class="subline">
                    ${escapeHtml(
                      quantityDisplay(
                        packageQuantity
                      )
                    )} packages
                  </span>
                `;
              }
            }


            /*
             * -------------------------------------------------
             * USER / SOURCE
             * -------------------------------------------------
             */
            const displaySource =
              sourceSystem ||
              cleanText(
                movement.source ||
                ""
              );


            let displayUser =
              cleanText(
                movement.user ||
                ""
              );


            if (
              !displayUser
            ) {
              if (
                sourceSystem ===
                "CIN7"
              ) {
                displayUser =
                  "Cin7";

              } else if (
                sourceSystem ===
                "VEYNOR"
              ) {
                displayUser =
                  "Veynor";

              } else {
                displayUser =
                  "System";
              }
            }


            /*
             * -------------------------------------------------
             * NOTES
             * -------------------------------------------------
             *
             * buildMovementTableRows() kan nog technische
             * informatie in notes hebben staan.
             *
             * We voorkomen hier in ieder geval dat extra
             * quantity-informatie opnieuw wordt toegevoegd.
             */
            const notes =
              cleanText(
                movement.notes ||
                ""
              );


            /*
             * -------------------------------------------------
             * BALANCE
             * -------------------------------------------------
             *
             * Reservation verandert balance niet.
             * De berekende balance blijft dus bijvoorbeeld:
             *
             * vóór reservation 47
             * reservation 5 -> balance 47
             */
            const balance =
              toNumber(
                movement.balance,
                0
              );


            /*
             * =================================================
             * HTML ROW
             * =================================================
             */
            return `
              <tr>

                <td>
                  <strong>
                    ${escapeHtml(
                      formatDate(
                        movement.date
                      )
                    )}
                  </strong>

                  <span class="subline">
                    ${escapeHtml(
                      formatTime(
                        movement.date
                      )
                    )}
                  </span>
                </td>


                <td>
                  <span class="movement-event ${escapeHtml(
                    movementClass(
                      movement.type
                    )
                  )}">
                    ${escapeHtml(
                      movementLabel(
                        movement.type
                      )
                    )}
                  </span>

                  ${
                    sourceLabel
                      ? `
                          <span class="subline">
                            ${escapeHtml(
                              sourceLabel
                            )}
                          </span>
                        `
                      : ""
                  }
                </td>


                <td>
                  <div class="movement-reference">

                    <strong>
                      ${escapeHtml(
                        reference
                      )}
                    </strong>

                    ${
                      secondaryReference
                        ? `
                            <span>
                              ${escapeHtml(
                                secondaryReference
                              )}
                            </span>
                          `
                        : ""
                    }

                    ${
                      stockReference
                        ? `
                            <span>
                              ${escapeHtml(
                                stockReference
                              )}
                            </span>
                          `
                        : ""
                    }

                  </div>
                </td>


                <td>
                  <div class="movement-location">

                    <strong>
                      ${escapeHtml(
                        movement.location_code ||
                        "—"
                      )}
                    </strong>

                    ${
                      movement.warehouse_name
                        ? `
                            <span>
                              ${escapeHtml(
                                movement.warehouse_name
                              )}
                            </span>
                          `
                        : ""
                    }

                  </div>
                </td>


                <td>
                  ${quantityHtml}
                </td>


                <td>
                  <span class="balance-value">
                    ${formatNumber(
                      balance
                    )}
                  </span>

                  <span class="subline">
                    products
                  </span>
                </td>


                <td>
                  <div class="movement-user">

                    <strong>
                      ${escapeHtml(
                        displayUser
                      )}
                    </strong>

                    ${
                      displaySource
                        ? `
                            <span>
                              ${escapeHtml(
                                displaySource
                              )}
                            </span>
                          `
                        : ""
                    }

                  </div>
                </td>


                <td>
                  <div class="movement-notes">

                    ${escapeHtml(
                      notes ||
                      "—"
                    )}

                  </div>
                </td>

              </tr>
            `;
          }
        )
        .join("");
  }


  /*
   * =========================================================
   * PAGINATION FOOTER
   * =========================================================
   */
  const from =
    filteredMovements.length
      ? start + 1
      : 0;


  const to =
    Math.min(
      start +
        MOVEMENT_PAGE_SIZE,
      filteredMovements.length
    );


  setText(
    "movementHistoryMeta",
    `${formatNumber(
      from
    )}–${formatNumber(
      to
    )} of ${formatNumber(
      filteredMovements.length
    )} movement(s)`
  );


  setText(
    "movementPageLabel",
    `Page ${movementPage} of ${totalPages}`
  );


  const previous =
    byId(
      "btnMovementPreviousPage"
    );


  const next =
    byId(
      "btnMovementNextPage"
    );


  if (previous) {
    previous.disabled =
      movementPage <= 1;
  }


  if (next) {
    next.disabled =
      movementPage >=
      totalPages;
  }
}


async function loadExportHistories(
  groups
) {
  const results = [];

  for (
    let index = 0;
    index < groups.length;
    index++
  ) {
    const group =
      groups[index];

    showToast(
      `Preparing export ${index + 1} of ${groups.length}: ${group.sku_base}...`,
      "ok"
    );

    let movements = [];

    if (
      String(selectedProductId) ===
        String(group.product_id) &&
      selectedMovements.length
    ) {
      movements =
        [...selectedMovements];
    } else {
      movements =
        await buildHistoryForProduct(
          group.product_id
        );
    }

    results.push({
      product:
        group,

      movements
    });
  }

  return results;
}


  /* =========================================================
   * EXCEL EXPORT
   * ======================================================= */

  function overviewExportRows() {
    return filteredProductGroups.map(
      group => ({
        "Product Owner":
          group.customer_name ||
          "",

        "SKU":
          group.sku_base ||
          "",

        "Product":
          group.product_name ||
          "",

        "Description":
          group.product_description ||
          "",

        "Physical":
          group.physical,

        "Available":
          group.available,

        "Reserved":
          group.reserved,

        "Committed":
          group.committed,

        "Last Movement":
          formatDateTime(
            group.last_movement
          )
      })
    );
  }

function movementExportRows(
  movements
) {
  return movements.map(
    movement => {

      const movementType =
        normalize(
          movement.type
        );


      const isReservation =
        movementType ===
        "reservation";


      const sourceSystem =
        cleanText(
          movement.source_system ||
          ""
        )
          .toUpperCase();


      const orderNumber =
        cleanText(
          movement.external_order_number ||
          ""
        );


      const ackReference =
        cleanText(
          movement.external_ack_reference ||
          ""
        );


      const stockVariant =
        cleanText(
          movement.stock_variant ||
          ""
        );


      const batchReference =
        cleanText(
          movement.batch_reference ||
          ""
        );


      /*
       * Echte fysieke productmutatie.
       *
       * Receipt:
       * +8
       *
       * Shipment:
       * -1
       *
       * Reservation:
       * 0
       */
      const productQuantity =
        toNumber(
          movement.quantity,
          0
        );


      /*
       * Packages / colli.
       */
      const packageQuantity =
        movement.package_quantity !==
          null &&
        movement.package_quantity !==
          undefined
          ? toNumber(
              movement.package_quantity,
              0
            )
          : null;


      /*
       * Gereserveerd aantal producten.
       *
       * Dit beïnvloedt de fysieke balance niet.
       */
      const reservationQuantity =
        movement.reservation_quantity !==
          null &&
        movement.reservation_quantity !==
          undefined
          ? toNumber(
              movement.reservation_quantity,
              0
            )
          : null;


      /*
       * Voor Excel willen we een duidelijke quantity.
       *
       * Reservation:
       * 5
       *
       * Shipment:
       * -4
       *
       * Receipt:
       * +8
       */
      const displayQuantity =
        isReservation &&
        reservationQuantity !== null
          ? reservationQuantity
          : productQuantity;


      /*
       * Type van de hoeveelheid duidelijk benoemen.
       */
      const quantityMeaning =
        isReservation
          ? "Reserved"
          : (
              movementType === "receipt"
                ? "Received"
                : movementType === "shipment"
                  ? "Shipped"
                  : movementType === "return"
                    ? "Returned"
                    : "Movement"
            );


      /*
       * Source voor oude records behouden wanneer
       * source_system niet aanwezig is.
       */
      const source =
        sourceSystem ||
        cleanText(
          movement.source ||
          ""
        );


      return {
        "Date / Time":
          formatDateTime(
            movement.date
          ),

        "Event":
          movementLabel(
            movement.type
          ),

        "Source System":
          source,

        "Reference":
          movement.reference ||
          "",

        "SO Number":
          orderNumber,

        "ACK / External Reference":
          ackReference,

        "Secondary Reference":
          movement.secondary_reference ||
          "",

        "Variant":
          stockVariant,

        "Batch":
          batchReference,

        "Warehouse":
          movement.warehouse_name ||
          "",

        "Location":
          movement.location_code ||
          "",

        "Quantity":
          displayQuantity,

        "Quantity Type":
          quantityMeaning,

        /*
         * Products is de echte fysieke mutatie.
         *
         * Bij een reservation blijft dit dus 0.
         */
        "Product Movement":
          productQuantity,

        /*
         * Apart veld zodat bijvoorbeeld zichtbaar wordt:
         *
         * -1 product
         * -2 packages
         */
        "Packages":
          packageQuantity === null
            ? ""
            : packageQuantity,

        /*
         * Alleen gevuld bij Reservation.
         */
        "Reserved Products":
          reservationQuantity === null
            ? ""
            : reservationQuantity,

        /*
         * Balance blijft altijd fysieke producten.
         */
        "Balance Products":
          movement.balance,

        "User":
          movement.user ||
          (
            sourceSystem === "CIN7"
              ? "Cin7"
              : sourceSystem === "VEYNOR"
                ? "Veynor"
                : "System"
          ),

        "Notes":
          movement.notes ||
          ""
      };
    }
  );
}

  function setSheetColumnWidths(
    sheet,
    rows
  ) {
    if (
      !rows?.length
    ) {
      return;
    }

    sheet["!cols"] =
      Object.keys(
        rows[0]
      ).map(key => ({
        wch:
          Math.min(
            Math.max(
              key.length + 4,
              13
            ),
            36
          )
      }));
  }

 async function exportOverviewExcel() {
  if (!window.XLSX) {
    showToast(
      "XLSX library is not loaded.",
      "err"
    );

    return;
  }

  const groups =
    [...filteredProductGroups];

  if (!groups.length) {
    showToast(
      "No products available for export.",
      "err"
    );

    return;
  }

  try {
    const histories =
      await loadExportHistories(
        groups
      );

    const workbook =
      XLSX.utils.book_new();


    /* =====================================================
     * SHEET 1: STOCK OVERVIEW
     * =================================================== */

    const overviewRows =
      groups.map(
        group => ({
          "Product Owner":
            group.customer_name ||
            "",

          "SKU":
            group.sku_base ||
            "",

          "Product":
            group.product_name ||
            "",

          "Physical":
            group.physical,

          "Available":
            group.available,

          "Reserved":
            group.reserved,

          "Committed":
            group.committed,

          "Last Movement":
            formatDateTime(
              group.last_movement
            )
        })
      );

    const overviewSheet =
      XLSX.utils.json_to_sheet(
        overviewRows
      );

    setSheetColumnWidths(
      overviewSheet,
      overviewRows
    );

    XLSX.utils.book_append_sheet(
      workbook,
      overviewSheet,
      "Stock Overview"
    );


    /* =====================================================
     * SHEET 2: COMPLETE MOVEMENT HISTORY
     * =================================================== */

    const movementRows =
      [];

    histories.forEach(
      result => {

        const product =
          result.product;

        result.movements.forEach(
          movement => {

            movementRows.push({
              "Product Owner":
                product.customer_name ||
                "",

              "SKU":
                product.sku_base ||
                "",

              "Product":
                product.product_name ||
                "",

              "Date / Time":
                formatDateTime(
                  movement.date
                ),

              "Event":
                movementLabel(
                  movement.type
                ),

              "Reference":
                movement.reference ||
                "",

              "Secondary Reference":
                movement.secondary_reference ||
                "",

              "Warehouse":
                movement.warehouse_name ||
                "",

              "Location":
                movement.location_code ||
                "",

              "Quantity":
                movement.quantity,

              "Balance":
                movement.balance,

              "User":
                movement.user ||
                "System",

              "Source":
                movement.source ||
                "",

              "Notes":
                movement.notes ||
                ""
            });

          }
        );

      }
    );

    const movementSheet =
      XLSX.utils.json_to_sheet(
        movementRows
      );

    setSheetColumnWidths(
      movementSheet,
      movementRows
    );

    XLSX.utils.book_append_sheet(
      workbook,
      movementSheet,
      "Movement History"
    );


    XLSX.writeFile(
      workbook,
      `veynor-stock-history-${fileDateStamp()}.xlsx`
    );


    showToast(
      `${groups.length} product(s) and ${movementRows.length} movement(s) exported to Excel.`,
      "ok"
    );

  } catch (error) {
    console.error(
      "Complete Excel export failed:",
      error
    );

    showToast(
      error.message ||
      "Could not generate Excel export.",
      "err"
    );
  }
}

function exportSelectedExcel() {
  if (!selectedProduct) {
    showToast(
      "Select a product first.",
      "err"
    );

    return;
  }

  if (!window.XLSX) {
    showToast(
      "XLSX library is not loaded.",
      "err"
    );

    return;
  }


  /*
   * ALLE movements exporteren.
   * Niet alleen de momenteel gefilterde regels.
   */
  const rows =
    movementExportRows(
      selectedMovements
    );


  if (!rows.length) {
    showToast(
      "No movement history available for export.",
      "err"
    );

    return;
  }


  const workbook =
    XLSX.utils.book_new();


  /* =====================================================
   * PRODUCT SUMMARY
   * =================================================== */

  const summary = [
    {
      "Product Owner":
        selectedProduct.customer_name ||
        "",

      "SKU":
        selectedProduct.sku_base,

      "Product":
        selectedProduct.product_name,

      "Physical":
        selectedProduct.physical,

      "Available":
        selectedProduct.available,

      "Reserved":
        selectedProduct.reserved,

      "Committed":
        selectedProduct.committed,

      "Last Movement":
        formatDateTime(
          selectedProduct.last_movement
        )
    }
  ];


  const summarySheet =
    XLSX.utils.json_to_sheet(
      summary
    );

  setSheetColumnWidths(
    summarySheet,
    summary
  );

  XLSX.utils.book_append_sheet(
    workbook,
    summarySheet,
    "Product"
  );


  /* =====================================================
   * COMPLETE MOVEMENT HISTORY
   * =================================================== */

  const historySheet =
    XLSX.utils.json_to_sheet(
      rows
    );

  setSheetColumnWidths(
    historySheet,
    rows
  );

  XLSX.utils.book_append_sheet(
    workbook,
    historySheet,
    "Movement History"
  );


  XLSX.writeFile(
    workbook,
    `${safeFileName(
      selectedProduct.sku_base
    )}-stock-history-${fileDateStamp()}.xlsx`
  );


  showToast(
    `${formatNumber(
      rows.length
    )} movement(s) exported to Excel.`,
    "ok"
  );
}

  /* =========================================================
   * PDF EXPORT
   * ======================================================= */

  function ensurePdfAvailable() {
    if (
      !window.jspdf?.jsPDF
    ) {
      throw new Error(
        "jsPDF library is not loaded."
      );
    }

    return window.jspdf.jsPDF;
  }

  function addPdfFooter(
    doc,
    title
  ) {
    const pageCount =
      doc.getNumberOfPages();

    const pageWidth =
      doc.internal.pageSize.getWidth();

    const pageHeight =
      doc.internal.pageSize.getHeight();

    for (
      let page = 1;
      page <= pageCount;
      page++
    ) {
      doc.setPage(page);

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(7);

      doc.setTextColor(
        100,
        116,
        139
      );

      doc.text(
        title,
        10,
        pageHeight - 6
      );

      doc.text(
        `Page ${page} of ${pageCount}`,
        pageWidth - 10,
        pageHeight - 6,
        {
          align: "right"
        }
      );
    }
  }

async function exportOverviewPdf() {
  try {

    const groups =
      [...filteredProductGroups];


    if (!groups.length) {
      showToast(
        "No products available for export.",
        "err"
      );

      return;
    }


    const histories =
      await loadExportHistories(
        groups
      );


    const jsPDF =
      ensurePdfAvailable();


    const doc =
      new jsPDF({
        orientation:
          "landscape",

        unit:
          "mm",

        format:
          "a4"
      });


    /* =====================================================
     * MAIN HEADER
     * =================================================== */

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(18);

    doc.text(
      "Veynor Stock History",
      12,
      15
    );


    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(9);


    doc.text(
      `Exported: ${new Date().toLocaleString("en-GB")}`,
      12,
      21
    );


    doc.text(
      `Products: ${groups.length}`,
      12,
      26
    );


    /* =====================================================
     * STOCK OVERVIEW
     * =================================================== */

    const overviewColumns = [
      "Product Owner",
      "SKU",
      "Product",
      "Physical",
      "Available",
      "Reserved",
      "Committed",
      "Last Movement"
    ];


    const overviewBody =
      groups.map(
        group => [
          group.customer_name ||
            "",

          group.sku_base ||
            "",

          group.product_name ||
            "",

          group.physical,

          group.available,

          group.reserved,

          group.committed,

          formatDateTime(
            group.last_movement
          )
        ]
      );


    doc.autoTable({
      head:
        [overviewColumns],

      body:
        overviewBody,

      startY:
        32,

      styles: {
        fontSize:
          7,

        cellPadding:
          1.5
      },

      headStyles: {
        fillColor:
          [18, 103, 255],

        textColor:
          255,

        fontStyle:
          "bold"
      },

      alternateRowStyles: {
        fillColor:
          [248, 250, 252]
      },

      margin: {
        left:
          8,

        right:
          8
      }
    });


    /* =====================================================
     * HISTORY PER PRODUCT
     * =================================================== */

    histories.forEach(
      result => {

        const product =
          result.product;

        const movements =
          result.movements;


        doc.addPage();


        /* =============================
         * PRODUCT HEADER
         * =========================== */

        doc.setFont(
          "helvetica",
          "bold"
        );

        doc.setFontSize(16);


        doc.text(
          product.sku_base ||
          "Product",
          12,
          15
        );


        doc.setFontSize(11);


        doc.text(
          product.product_name ||
          "",
          12,
          22
        );


        doc.setFont(
          "helvetica",
          "normal"
        );

        doc.setFontSize(8.5);


        doc.text(
          `Product Owner: ${product.customer_name || "—"}`,
          12,
          28
        );


        doc.text(
          `Physical: ${product.physical}   Available: ${product.available}   Reserved: ${product.reserved}   Committed: ${product.committed}`,
          12,
          34
        );


        doc.text(
          `Movements: ${movements.length}`,
          12,
          40
        );


        /* =============================
         * MOVEMENT TABLE
         * =========================== */

        const columns = [
          "Date / Time",
          "Event",
          "Reference",
          "Warehouse",
          "Location",
          "Qty",
          "Balance",
          "User",
          "Notes"
        ];


        const body =
          movements.map(
            movement => [

              formatDateTime(
                movement.date
              ),

              movementLabel(
                movement.type
              ),

              [
                movement.reference,
                movement.secondary_reference
              ]
                .filter(Boolean)
                .join("\n"),

              movement.warehouse_name ||
                "",

              movement.location_code ||
                "",

              movement.quantity === 0
                ? ""
                : movement.quantity,

              movement.balance,

              movement.user ||
                "System",

              movement.notes ||
                ""
            ]
          );


        doc.autoTable({
          head:
            [columns],

          body,

          startY:
            46,

          styles: {
            fontSize:
              6.5,

            cellPadding:
              1.4,

            overflow:
              "linebreak",

            valign:
              "middle"
          },

          headStyles: {
            fillColor:
              [18, 103, 255],

            textColor:
              255,

            fontStyle:
              "bold"
          },

          alternateRowStyles: {
            fillColor:
              [248, 250, 252]
          },

          columnStyles: {
            0: {
              cellWidth:
                25
            },

            1: {
              cellWidth:
                26
            },

            2: {
              cellWidth:
                42
            },

            3: {
              cellWidth:
                25
            },

            4: {
              cellWidth:
                20
            },

            5: {
              cellWidth:
                13
            },

            6: {
              cellWidth:
                17
            },

            7: {
              cellWidth:
                24
            }
          },

          margin: {
            left:
              7,

            right:
              7,

            bottom:
              12
          }
        });

      }
    );


    addPdfFooter(
      doc,
      "Veynor Stock History"
    );


    doc.save(
      `veynor-stock-history-${fileDateStamp()}.pdf`
    );


    const totalMovements =
      histories.reduce(
        (sum, result) =>
          sum +
          result.movements.length,
        0
      );


    showToast(
      `${groups.length} product(s) and ${totalMovements} movement(s) exported to PDF.`,
      "ok"
    );

  } catch (error) {

    console.error(
      "Complete Stock History PDF export failed:",
      error
    );


    showToast(
      error.message ||
      "Could not generate PDF.",
      "err"
    );

  }
}

function exportSelectedPdf() {
  try {

    if (!selectedProduct) {
      showToast(
        "Select a product first.",
        "err"
      );

      return;
    }


    /*
     * Complete history exporteren.
     */
    const rows =
      movementExportRows(
        selectedMovements
      );


    if (!rows.length) {
      showToast(
        "No movement history available for export.",
        "err"
      );

      return;
    }


    const jsPDF =
      ensurePdfAvailable();


    const doc =
      new jsPDF({
        orientation:
          "landscape",

        unit:
          "mm",

        format:
          "a4"
      });


    /* =====================================================
     * HEADER
     * =================================================== */

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(17);


    doc.text(
      `Stock History · ${selectedProduct.sku_base}`,
      12,
      15
    );


    doc.setFontSize(11);


    doc.text(
      selectedProduct.product_name ||
      "",
      12,
      22
    );


    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(8.5);


    doc.text(
      `Product Owner: ${selectedProduct.customer_name || "—"}`,
      12,
      28
    );


    doc.text(
      `Physical: ${selectedProduct.physical}   Available: ${selectedProduct.available}   Reserved: ${selectedProduct.reserved}   Committed: ${selectedProduct.committed}`,
      12,
      33
    );


    doc.text(
      `Movements: ${rows.length}`,
      12,
      38
    );


    doc.text(
      `Exported: ${new Date().toLocaleString("en-GB")}`,
      12,
      43
    );


    /* =====================================================
     * MOVEMENT TABLE
     * =================================================== */

    const columns = [
      "Date / Time",
      "Event",
      "Reference",
      "Warehouse",
      "Location",
      "Quantity",
      "Balance",
      "User",
      "Notes"
    ];


    const body =
      rows.map(
        row => [

          row["Date / Time"],

          row["Event"],

          [
            row["Reference"],
            row[
              "Secondary Reference"
            ]
          ]
            .filter(Boolean)
            .join("\n"),

          row["Warehouse"],

          row["Location"],

          row["Quantity"],

          row["Balance"],

          row["User"],

          row["Notes"]
        ]
      );


    doc.autoTable({
      head:
        [columns],

      body,

      startY:
        49,

      styles: {
        fontSize:
          6.8,

        cellPadding:
          1.5,

        overflow:
          "linebreak",

        valign:
          "middle"
      },

      headStyles: {
        fillColor:
          [18, 103, 255],

        textColor:
          255,

        fontStyle:
          "bold"
      },

      alternateRowStyles: {
        fillColor:
          [248, 250, 252]
      },

      columnStyles: {
        0: {
          cellWidth:
            24
        },

        1: {
          cellWidth:
            28
        },

        2: {
          cellWidth:
            42
        },

        3: {
          cellWidth:
            25
        },

        4: {
          cellWidth:
            21
        },

        5: {
          cellWidth:
            17
        },

        6: {
          cellWidth:
            17
        },

        7: {
          cellWidth:
            26
        }
      },

      margin: {
        left:
          7,

        right:
          7,

        bottom:
          12
      }
    });


    addPdfFooter(
      doc,
      `${selectedProduct.sku_base} · Stock History`
    );


    doc.save(
      `${safeFileName(
        selectedProduct.sku_base
      )}-stock-history-${fileDateStamp()}.pdf`
    );


    showToast(
      `${formatNumber(
        rows.length
      )} movement(s) exported to PDF.`,
      "ok"
    );

  } catch (error) {

    console.error(
      "Selected history PDF export failed:",
      error
    );


    showToast(
      error.message ||
      "Could not generate PDF.",
      "err"
    );

  }
}

  /* =========================================================
   * URL AUTO SELECT
   * ======================================================= */

  async function autoSelectFromUrl() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const productId =
      cleanText(
        params.get(
          "product_id"
        )
      );

    const sku =
      cleanText(
        params.get(
          "sku"
        )
      );

    let group = null;

    if (productId) {
      group =
        productGroups.find(
          row =>
            String(
              row.product_id
            ) ===
            String(
              productId
            )
        );
    }

    if (
      !group &&
      sku
    ) {
      group =
        productGroups.find(
          row =>
            normalize(
              row.sku_base
            ) ===
            normalize(sku)
        );
    }

    if (group) {
      await selectProduct(
        group.product_id,
        false
      );
    }
  }


  /* =========================================================
   * EVENTS
   * ======================================================= */

  function bindEvents() {
    [
      "historySearch",
      "historyProductOwner",
      "historyStockStatus"
    ].forEach(id => {
      byId(id)?.addEventListener(
        "input",
        () =>
          applyProductFilters(
            true
          )
      );

      byId(id)?.addEventListener(
        "change",
        () =>
          applyProductFilters(
            true
          )
      );
    });


    byId(
      "btnClearHistoryFilters"
    )?.addEventListener(
      "click",
      () => {
        const search =
          byId(
            "historySearch"
          );

        const owner =
          byId(
            "historyProductOwner"
          );

        const status =
          byId(
            "historyStockStatus"
          );

        if (search) {
          search.value = "";
        }

        if (
          owner &&
          !isProductOwnerRole()
        ) {
          owner.value = "";
        }

        if (status) {
          status.value = "";
        }

        applyProductFilters(
          true
        );
      }
    );


    byId(
      "btnHistoryPreviousPage"
    )?.addEventListener(
      "click",
      () => {
        if (
          productPage <= 1
        ) {
          return;
        }

        productPage -= 1;

        renderProductTable();
      }
    );


    byId(
      "btnHistoryNextPage"
    )?.addEventListener(
      "click",
      () => {
        const totalPages =
          Math.max(
            1,
            Math.ceil(
              filteredProductGroups.length /
              PRODUCT_PAGE_SIZE
            )
          );

        if (
          productPage >=
          totalPages
        ) {
          return;
        }

        productPage += 1;

        renderProductTable();
      }
    );


    [
      "movementSearch",
      "movementTypeFilter",
      "movementDateFrom",
      "movementDateTo"
    ].forEach(id => {
      byId(id)?.addEventListener(
        "input",
        () =>
          applyMovementFilters(
            true
          )
      );

      byId(id)?.addEventListener(
        "change",
        () =>
          applyMovementFilters(
            true
          )
      );
    });


    byId(
      "btnClearMovementFilters"
    )?.addEventListener(
      "click",
      () => {
        [
          "movementSearch",
          "movementTypeFilter",
          "movementDateFrom",
          "movementDateTo"
        ].forEach(id => {
          const element =
            byId(id);

          if (element) {
            element.value = "";
          }
        });

        applyMovementFilters(
          true
        );
      }
    );


    byId(
      "btnMovementPreviousPage"
    )?.addEventListener(
      "click",
      () => {
        if (
          movementPage <= 1
        ) {
          return;
        }

        movementPage -= 1;

        renderMovementTable();
      }
    );


    byId(
      "btnMovementNextPage"
    )?.addEventListener(
      "click",
      () => {
        const totalPages =
          Math.max(
            1,
            Math.ceil(
              filteredMovements.length /
              MOVEMENT_PAGE_SIZE
            )
          );

        if (
          movementPage >=
          totalPages
        ) {
          return;
        }

        movementPage += 1;

        renderMovementTable();
      }
    );


    byId(
      "btnExportHistoryExcel"
    )?.addEventListener(
      "click",
      exportOverviewExcel
    );


    byId(
      "btnExportHistoryPdf"
    )?.addEventListener(
      "click",
      exportOverviewPdf
    );


    byId(
      "btnSelectedHistoryExcel"
    )?.addEventListener(
      "click",
      exportSelectedExcel
    );


    byId(
      "btnSelectedHistoryPdf"
    )?.addEventListener(
      "click",
      exportSelectedPdf
    );


    byId(
      "btnRefreshStockHistory"
    )?.addEventListener(
      "click",
      async () => {
        try {
          const previousProduct =
            selectedProductId;

          await loadAllData();

          if (
            previousProduct &&
            productGroups.some(
              group =>
                String(
                  group.product_id
                ) ===
                String(
                  previousProduct
                )
            )
          ) {
            await selectProduct(
              previousProduct,
              false
            );
          }

          showToast(
            "Stock History refreshed.",
            "ok"
          );
        } catch (error) {
          console.error(
            "Stock History refresh failed:",
            error
          );

          showToast(
            error.message ||
            "Refresh failed.",
            "err"
          );
        }
      }
    );
  }


  /* =========================================================
   * LOAD ALL DATA
   * ======================================================= */

async function loadAllData() {
  await Promise.all([
    loadCustomers(),
    loadWarehouses(),
    loadLocations(),
    loadInboundContainers(),
    loadUserProfiles(),
    loadProducts()
  ]);

  await Promise.all([
    loadItems(),
    loadProductStockLedger()
  ]);

  buildProductGroups();

  renderGlobalKpis();

  applyProductFilters(
    false
  );
}


  /* =========================================================
   * INITIALISE
   * ======================================================= */

  async function init() {
    try {
      ensureClient();

      await loadCurrentProfile();

      bindEvents();

      await loadAllData();

      await autoSelectFromUrl();

      showToast(
        "Stock History loaded.",
        "ok"
      );
    } catch (error) {
      console.error(
        "Stock History failed:",
        error
      );

      showToast(
        error.message ||
        "Stock History could not load.",
        "err"
      );

      const body =
        byId(
          "productHistoryBody"
        );

      if (body) {
        body.innerHTML = `
          <tr>
            <td colspan="7">
              <div class="history-empty">

                <div class="history-empty-icon">
                  !
                </div>

                <strong>
                  Stock History could not load
                </strong>

                <span>
                  ${escapeHtml(
                    error.message ||
                    "Unknown error"
                  )}
                </span>

              </div>
            </td>
          </tr>
        `;
      }
    }
  }


  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();