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
          stock_set_id
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

  allItems.forEach(item => {
    const product =
      productMap.get(
        String(
          item.product_id
        )
      );

    if (!product) return;

    const key =
      String(product.id);

    if (
      !groupMap.has(key)
    ) {
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

          last_movement:
            null
        }
      );
    }

    const group =
      groupMap.get(key);

    group.items.push(item);

    if (
      isPhysical(item)
    ) {
      group.physical += 1;
    }

    if (
      isAvailable(item)
    ) {
      group.available += 1;
    }

    if (
      isReserved(item)
    ) {
      group.reserved += 1;
    }

    if (
      isCommitted(item)
    ) {
      group.committed += 1;
    }

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
    } = await ensureClient()
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
    user = "",
    notes = "",
    source = "",
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
        secondaryReference ||
        "",

      warehouse_id:
        warehouseId ||
        null,

      location_id:
        locationId ||
        null,

      warehouse_name:
        warehouseName(
          warehouseId
        ),

      location_code:
        locationCode(
          locationId
        ),

      quantity:
        toNumber(
          quantity,
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
    productItems
  ) {
    const groups =
      new Map();

    productItems.forEach(item => {
      const date =
        item.received_at ||
        item.inbound_date ||
        item.created_at;

      if (!date) return;

      /*
       * Items from the same inbound event normally share
       * received_at + reference + location.
       */
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
            quantity: 0,
            item_ids: []
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

        user:
          "",

        notes:
          `${group.quantity} package${
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
    const rows = [];

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

        if (!item) return;

        const status =
          normalize(
            allocation
              .allocation_status
          );

        /*
         * Allocation represents the reservation point.
         * Even cancelled allocations are historically useful.
         */
        rows.push(
          movementRecord({
            date:
              allocation.allocated_at,

            type:
              "reservation",

            reference:
              orderMainReference(
                order
              ),

            secondaryReference:
              orderSubReference(
                order
              ),

            warehouseId:
              item.warehouse_id,

            locationId:
              item.location_id,

            quantity:
              0,

            user:
              profileName(
                allocation
                  .allocated_by_profile_id
              ),

            notes:
              status ===
              "cancelled"
                ? "Stock was reserved against this order and the allocation was later cancelled."
                : "Stock reserved against this order.",

            source:
              "order_allocations",

            itemId:
              item.id
          })
        );
      }
    );

    return rows;
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
    itemMap
  ) {
    const rows = [];

    events.forEach(event => {
      /*
       * Receipts already come from items.
       * That prevents the same scan-in being shown twice.
       */
      if (
        normalize(
          event.event_type
        ) ===
        "item_received"
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

      let reference =
        cleanText(
          payload.order_number ||
          payload.inbound_reference ||
          event.reference_no ||
          ""
        );

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
    const text =
      `${movement.movement_type || ""} ${movement.notes || ""}`
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
      type ===
      "shipment"
    ) {
      return -1;
    }

    if (
      type ===
      "receipt" ||
      type ===
      "return"
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

        return movementRecord({
          date:
            movement.created_at,

          type,

          reference:
            movement.scan_value ||
            movement.order_id ||
            movement.shipment_id ||
            movement.movement_type,

          warehouseId:
            movement.warehouse_id,

          locationId:
            movement.location_id,

          quantity:
            movementTableQuantity(
              movement,
              type
            ),

          notes:
            movement.notes ||
            movement.movement_type ||
            "",

          source:
            "movements",

          itemId:
            movement.item_id ||
            null
        });
      }
    );
  }

  function buildShipmentFallbackMovements(
    productItems,
    allocations
  ) {
    const allocationByItem =
      new Map();

    allocations.forEach(
      allocation => {
        /*
         * Prefer active/latest allocation for reference.
         */
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

    return productItems
      .filter(item =>
        item.shipped_at &&
        isOutboundStatus(item)
      )
      .map(item => {
        const allocation =
          allocationByItem.get(
            String(item.id)
          );

        const order =
          allocation?.order ||
          null;

        return movementRecord({
          date:
            item.shipped_at,

          type:
            "shipment",

          reference:
            order
              ? orderMainReference(
                  order
                )
              : (
                  item.sku_unique ||
                  "Outbound"
                ),

          secondaryReference:
            order
              ? orderSubReference(
                  order
                )
              : "",

          warehouseId:
            item.warehouse_id,

          locationId:
            item.location_id,

          quantity:
            -1,

          user:
            "",

          notes:
            order
              ? `Stock shipped against ${order.order_number || "order"}.`
              : "Physical package shipped from stock.",

          source:
            "items",

          itemId:
            item.id
        });
      });
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
        16
      ),
      normalize(
        movement.reference
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

  function calculateBalances(
  movements,
  currentPhysical = null
) {
  let rows = [...movements]
    .sort(
      (a, b) =>
        dateToTime(a.date) -
        dateToTime(b.date)
    );

  /*
   * Bereken hoeveel fysieke voorraad de bekende historie verklaart.
   *
   * Reservation / release wijzigen de fysieke voorraad niet,
   * dus die hebben quantity = 0.
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
   * Als de bekende historie niet aansluit op de huidige fysieke
   * voorraad, voegen we een Opening Balance toe.
   *
   * Voorbeeld:
   *
   * huidige Physical = 116
   * bekende receipts/shipments = +57
   *
   * Opening Balance = +59
   *
   * Daardoor eindigt de historische balance altijd op 116.
   */
  if (
    currentPhysical !== null &&
    currentPhysical !== undefined
  ) {
    const physical =
      toNumber(
        currentPhysical,
        0
      );

    const openingBalance =
      physical -
      knownPhysicalChange;

    if (
      openingBalance !== 0
    ) {
      const firstMovementDate =
        rows.length
          ? rows[0].date
          : new Date().toISOString();

      /*
       * Zet de opening balance vlak vóór het oudste bekende event.
       */
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

          user:
            "System",

          notes:
            "Opening stock balance added to reconcile historical movements with the current physical stock.",

          source:
            "calculated"
        })
      );
    }
  }

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
   * Nieuwste bovenaan tonen.
   */
  return rows.sort(
    (a, b) =>
      dateToTime(b.date) -
      dateToTime(a.date)
  );
}


  /* =========================================================
   * COMPLETE HISTORY LOAD
   * ======================================================= */

  async function buildHistoryForProduct(
    productId
  ) {
    const productItems =
      allItems.filter(item =>
        String(
          item.product_id
        ) ===
        String(productId)
      );

    const itemMap =
      new Map(
        productItems.map(item => [
          String(item.id),
          item
        ])
      );

    const [
      allocations,
      warehouseEvents,
      movementRows
    ] = await Promise.all([
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

    let rows = [];

    rows = rows.concat(
      buildReceiptMovements(
        productItems
      )
    );

    rows = rows.concat(
      buildAllocationMovements(
        allocations,
        itemMap
      )
    );

    rows = rows.concat(
      buildWarehouseEventMovements(
        warehouseEvents,
        itemMap
      )
    );

    rows = rows.concat(
      buildMovementTableRows(
        movementRows
      )
    );

    /*
     * Shipment fallback from items.
     * This is important because many older items do not have
     * explicit warehouse_events for shipment.
     */
    rows = rows.concat(
      buildShipmentFallbackMovements(
        productItems,
        allocations
      )
    );

    rows =
      removeDuplicateMovements(
        rows
      );

const productGroup =
  productGroups.find(
    group =>
      String(
        group.product_id
      ) ===
      String(productId)
  );

rows =
  calculateBalances(
    rows,
    productGroup?.physical ?? null
  );

return rows;  }


  /* =========================================================
   * SELECT PRODUCT
   * ======================================================= */

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
        )?.value || ""
      );

    const type =
      normalize(
        byId(
          "movementTypeFilter"
        )?.value || ""
      );

    const from =
      byId(
        "movementDateFrom"
      )?.value || "";

    const to =
      byId(
        "movementDateTo"
      )?.value || "";

    filteredMovements =
      selectedMovements.filter(
        movement => {
          if (
            type &&
            normalize(
              movement.type
            ) !==
            type
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
            const haystack = [
              movement.reference,
              movement.secondary_reference,
              movement.warehouse_name,
              movement.location_code,
              movement.user,
              movement.notes,
              movement.type
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
        }
      );

    if (resetPage) {
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

    if (!body) return;

    if (!selectedProduct) {
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

    if (!visible.length) {
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
      body.innerHTML =
        visible.map(
          movement => `
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
              </td>


              <td>

                <div class="movement-reference">

                  <strong>
                    ${escapeHtml(
                      movement.reference ||
                      "—"
                    )}
                  </strong>

                  ${
                    movement.secondary_reference
                      ? `
                        <span>
                          ${escapeHtml(
                            movement.secondary_reference
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
                <span class="qty ${quantityClass(
                  movement.quantity
                )}">
                  ${escapeHtml(
                    quantityDisplay(
                      movement.quantity
                    )
                  )}
                </span>
              </td>


              <td>
                <span class="balance-value">
                  ${formatNumber(
                    movement.balance
                  )}
                </span>
              </td>


              <td>

                <div class="movement-user">

                  <strong>
                    ${escapeHtml(
                      movement.user ||
                      "System"
                    )}
                  </strong>

                  ${
                    movement.source
                      ? `
                        <span>
                          ${escapeHtml(
                            movement.source
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
                    movement.notes ||
                    "—"
                  )}
                </div>
              </td>

            </tr>
          `
        ).join("");
    }

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
      movement => ({
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
      })
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

    await loadItems();

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