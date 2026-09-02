(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";

  let client = null;
  let companyId = null;
  let currentUser = null;
  let currentProfile = null;

  let products = [];
  let warehouses = [];
  let locations = [];

  let selectedProduct = null;
  let selectedItems = [];
  let inventoryRows = [];

  let activeSplitRow = null;


  // ============================================================
  // BASIC HELPERS
  // ============================================================

  function byId(id) {
    return document.getElementById(id);
  }

  function ensureClient() {
    if (client) {
      return client;
    }

    if (typeof sb !== "function") {
      throw new Error(
        "Supabase helper sb() is not available."
      );
    }

    client = sb();

    return client;
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(
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

  function toNumber(
    value,
    fallback = 0
  ) {
    const number =
      Number(
        String(value ?? "")
          .replace(",", ".")
      );

    return Number.isFinite(number)
      ? number
      : fallback;
  }

  function formatNumber(
    value,
    digits = 0
  ) {
    const number =
      Number(value ?? 0);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return number.toLocaleString(
      "en-GB",
      {
        minimumFractionDigits:
          digits,

        maximumFractionDigits:
          digits
      }
    );
  }

  function formatDateInput(value) {
    if (!value) {
      return "";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }

    return date
      .toISOString()
      .slice(0, 10);
  }

  function toTimestampFromDate(
    value
  ) {
    if (!value) {
      return null;
    }

    return `${value}T00:00:00.000Z`;
  }

  function showToast(
    message,
    type = "ok"
  ) {
    const toast =
      byId("toast");

    if (!toast) {
      return;
    }

    toast.textContent =
      message || "";

    toast.className =
      `notice ${type}`;

    clearTimeout(
      window.__inventoryToastTimer
    );

    window.__inventoryToastTimer =
      setTimeout(
        () => {
          toast.textContent = "";
          toast.className =
            "notice";
        },
        6000
      );
  }

  function setText(
    id,
    value
  ) {
    const element =
      byId(id);

    if (element) {
      element.textContent =
        value ?? "";
    }
  }

  function safeCssEscape(value) {
    if (
      window.CSS &&
      typeof CSS.escape ===
        "function"
    ) {
      return CSS.escape(
        String(value)
      );
    }

    return String(value)
      .replace(
        /["\\]/g,
        "\\$&"
      );
  }




  // ============================================================
  // USER / COMPANY
  // ============================================================

  async function loadCurrentProfile() {
    const db =
      ensureClient();

    const {
      data: userData,
      error: userError
    } =
      await db.auth.getUser();

    if (userError) {
      throw userError;
    }

    currentUser =
      userData?.user ||
      null;

    if (!currentUser?.id) {
      throw new Error(
        "No authenticated user found."
      );
    }

    let result =
      await db
        .from("user_profiles")
        .select(`
          id,
          auth_user_id,
          full_name,
          email,
          role,
          is_active,
          company_id,
          customer_id
        `)
        .eq(
          "id",
          currentUser.id
        )
        .eq(
          "is_active",
          true
        )
        .maybeSingle();

    if (
      !result.data &&
      !result.error
    ) {
      result =
        await db
          .from("user_profiles")
          .select(`
            id,
            auth_user_id,
            full_name,
            email,
            role,
            is_active,
            company_id,
            customer_id
          `)
          .eq(
            "auth_user_id",
            currentUser.id
          )
          .eq(
            "is_active",
            true
          )
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

  function isTenantRole() {
    return [
      "veynor_admin",
      "tenant_admin",
      "tenant_user"
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

    const {
      data,
      error
    } =
      await ensureClient()
        .from("companies")
        .select("id")
        .eq(
          "name",
          TENANT_NAME
        )
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


  // ============================================================
  // MASTER DATA
  // ============================================================

  async function loadProducts() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } =
      await ensureClient()
        .from("products")
        .select(`
          id,
          company_id,
          customer_id,
          sku_base,
          name,
          description,
          image_url,
          package_count,
          packages_per_unit,
          package_1_qty,
          package_2_qty,
          package_3_qty,
          customers (
            id,
            name
          )
        `)
        .eq(
          "company_id",
          cid
        )
        .order(
          "sku_base",
          {
            ascending: true
          }
        );

    if (error) {
      throw error;
    }

    products =
      data || [];

    renderProductSuggestions();
  }

  async function loadWarehouses() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } =
      await ensureClient()
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
      throw error;
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
    } =
      await ensureClient()
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
        );

    if (error) {
      console.warn(
        "Warehouse locations skipped:",
        error.message
      );

      locations = [];

      return;
    }

    locations =
      (data || [])
        .map(row => ({
          ...row,

          code:
            row.code ||
            row.location_code ||
            ""
        }));
  }


  // ============================================================
  // MASTER DATA HELPERS
  // ============================================================

  function renderProductSuggestions() {
    const list =
      byId(
        "inventoryProductSuggestions"
      );

    if (!list) {
      return;
    }

    list.innerHTML =
      products
        .map(
          product => `
            <option
              value="${escapeHtml(
                product.sku_base ||
                ""
              )}"
            >
              ${escapeHtml(
                product.name ||
                ""
              )}
            </option>
          `
        )
        .join("");
  }

  function warehouseName(id) {
    if (!id) {
      return "No Barn";
    }

    return (
      warehouses.find(
        warehouse =>
          String(
            warehouse.id
          ) ===
          String(id)
      )?.name ||
      "Unknown Barn"
    );
  }

  function locationCode(id) {
    if (!id) {
      return "";
    }

    return (
      locations.find(
        location =>
          String(
            location.id
          ) ===
          String(id)
      )?.code ||
      ""
    );
  }

  function getLocation(id) {
    if (!id) {
      return null;
    }

    return (
      locations.find(
        location =>
          String(
            location.id
          ) ===
          String(id)
      ) ||
      null
    );
  }

  function getPackageTotal(product) {
    const explicit =
      Math.round(
        toNumber(
          product?.package_count ||
          product?.packages_per_unit,
          0
        )
      );

    if (explicit > 0) {
      return explicit;
    }

    const configured =
      [
        product?.package_1_qty,
        product?.package_2_qty,
        product?.package_3_qty
      ].filter(
        value =>
          toNumber(
            value,
            0
          ) > 0
      ).length;

    return Math.max(
      1,
      configured || 1
    );
  }

  function findProduct(
    searchValue
  ) {
    const search =
      normalize(
        searchValue
      );

    if (!search) {
      return null;
    }

    let product =
      products.find(
        row =>
          normalize(
            row.sku_base
          ) ===
          search
      );

    if (product) {
      return product;
    }

    product =
      products.find(
        row => {
          const text =
            [
              row.sku_base,
              row.name,
              row.description
            ]
              .join(" ")
              .toLowerCase();

          return text.includes(
            search
          );
        }
      );

    return product || null;
  }


  // ============================================================
  // LOAD ITEMS
  // ============================================================

  async function loadItemsForProduct(
    productId
  ) {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } =
      await ensureClient()
        .from("items")
        .select(`
          id,
          company_id,
          product_id,
          warehouse_id,
          location_id,
          storage_mutation_id,
          sku_unique,
          serial_number,
          batch_number,
          inbound_reference,
inbound_date,
received_at,
status,
volume_m3,
weight_kg,
reserved_at,
picked_at,
          loaded_at,
          shipped_at,
          created_at,

          physical_product_id,
          package_no,
          package_total,
          package_label,

          stock_set_status,
          stock_set_key,
          stock_set_id,

          package_condition,
          condition_notes,
          condition_checked_at,
          condition_checked_by,

          is_match_blocked,
          match_block_reason,
          match_blocked_at,
          match_blocked_by
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
            ascending: false
          }
        );

    if (error) {
      throw error;
    }

    return (
      data || []
    ).filter(
      item =>
        ![
          "shipped",
          "out"
        ].includes(
          normalize(
            item.status
          )
        )
    );
  }


  // ============================================================
  // ITEM STATUS HELPERS
  // ============================================================

  function isUnavailableStatus(
    item
  ) {
    return [
      "missing",
      "damaged"
    ].includes(
      normalize(
        item.status
      )
    );
  }

  function isReserved(item) {
    return [
      "reserved",
      "picked",
      "loaded"
    ].includes(
      normalize(
        item.status
      )
    );
  }

  function isMatchBlocked(item) {
    return (
      item?.is_match_blocked ===
      true
    );
  }

  function isIncomplete(item) {
    return (
      normalize(
        item?.package_condition
      ) ===
      "open_incomplete"
    );
  }

  function isAvailable(item) {
    return (
      normalize(
        item.status
      ) === "in_stock" &&
      item.is_match_blocked !==
        true &&
      !isIncomplete(item)
    );
  }

  function isActivePhysicalItem(
    item
  ) {
    return ![
      "shipped",
      "out",
      "missing",
      "damaged"
    ].includes(
      normalize(
        item.status
      )
    );
  }


  // ============================================================
  // GROUP KEY
  // Barn + Location + Package + Inbound date + Inbound ref
  // ============================================================

  function buildInventoryGroupKey(
    item
  ) {
    const warehouseId =
      item.warehouse_id ||
      "no-warehouse";

    const locationId =
      item.location_id ||
      "no-location";

    const packageNo =
      Math.max(
        1,
        Math.round(
          toNumber(
            item.package_no,
            1
          )
        )
      );

    const packageTotal =
      Math.max(
        1,
        Math.round(
          toNumber(
            item.package_total,
            getPackageTotal(
              selectedProduct
            )
          )
        )
      );

    const inboundDate =
      formatDateInput(
        item.inbound_date ||
        item.received_at ||
        item.created_at
      ) ||
      "no-date";

    const inboundReference =
      clean(
        item.inbound_reference
      ) ||
      "no-reference";

    return [
      warehouseId,
      locationId,
      packageNo,
      packageTotal,
      inboundDate,
      inboundReference
    ].join("|");
  }


  // ============================================================
  // BUILD INVENTORY ROWS
  // ============================================================

  function buildInventoryRows(
    items
  ) {
    const map =
      new Map();

    items
      .filter(
        item =>
          !isUnavailableStatus(
            item
          )
      )
      .forEach(
        item => {
          const packageNo =
            Math.max(
              1,
              Math.round(
                toNumber(
                  item.package_no,
                  1
                )
              )
            );

          const packageTotal =
            Math.max(
              1,
              Math.round(
                toNumber(
                  item.package_total,
                  getPackageTotal(
                    selectedProduct
                  )
                )
              )
            );

          const key =
            buildInventoryGroupKey(
              item
            );

          if (!map.has(key)) {
            const currentInboundDate =
              formatDateInput(
                item.inbound_date ||
                item.received_at ||
                item.created_at
              );

            map.set(
              key,
              {
                key,

                warehouse_id:
                  item.warehouse_id ||
                  null,

                original_warehouse_id:
                  item.warehouse_id ||
                  null,

                warehouse_name:
                  warehouseName(
                    item.warehouse_id
                  ),

                location_id:
                  item.location_id ||
                  null,

                original_location_id:
                  item.location_id ||
                  null,

                location_code:
                  locationCode(
                    item.location_id
                  ),

                package_no:
                  packageNo,

                package_total:
                  packageTotal,

                package_label:
                  item.package_label ||
                  `${packageNo}/${packageTotal}`,

                inbound_reference:
                  clean(
                    item.inbound_reference
                  ),

                original_inbound_reference:
                  clean(
                    item.inbound_reference
                  ),

                actual_inbound_date:
                  currentInboundDate,

                original_inbound_date:
                  currentInboundDate,

                system_count:
                  0,

                counted_count:
                  0,

                reserved_count:
                  0,

                blocked_count:
                  0,

                incomplete_count:
                  0,

                original_blocked_count:
                  0,

                original_incomplete_count:
                  0,

                items: []
              }
            );
          }

          const row =
            map.get(key);

          row.items.push(item);

          row.system_count +=
            1;

          if (
            isReserved(item)
          ) {
            row.reserved_count +=
              1;
          }

          if (
            normalize(
              item.status
            ) === "in_stock" &&
            isMatchBlocked(
              item
            )
          ) {
            row.blocked_count +=
              1;
          }

          if (
            isIncomplete(
              item
            )
          ) {
            row.incomplete_count +=
              1;
          }
        }
      );

    const rows =
      Array.from(
        map.values()
      );

    rows.forEach(
      row => {
        row.counted_count =
          row.system_count;

        row.original_blocked_count =
          row.blocked_count;

        row.original_incomplete_count =
          row.incomplete_count;
      }
    );

    rows.sort(
      (a, b) => {
        const barnCompare =
          String(
            a.warehouse_name
          ).localeCompare(
            String(
              b.warehouse_name
            ),
            "en-GB"
          );

        if (barnCompare) {
          return barnCompare;
        }

        const locationCompare =
          String(
            a.location_code
          ).localeCompare(
            String(
              b.location_code
            ),
            "en-GB"
          );

        if (locationCompare) {
          return locationCompare;
        }

        const dateCompare =
          String(
            a.actual_inbound_date
          ).localeCompare(
            String(
              b.actual_inbound_date
            )
          );

        if (dateCompare) {
          return dateCompare;
        }

        return (
          a.package_no -
          b.package_no
        );
      }
    );

    return rows;
  }


  // ============================================================
  // CALCULATIONS
  // ============================================================

  function rowDifference(row) {
    return (
      toNumber(
        row.counted_count,
        0
      ) -
      toNumber(
        row.system_count,
        0
      )
    );
  }

  function rowAvailableCount(
    row
  ) {
    const counted =
      Math.max(
        0,
        Math.round(
          toNumber(
            row.counted_count,
            0
          )
        )
      );

    const reserved =
      Math.max(
        0,
        Math.round(
          toNumber(
            row.reserved_count,
            0
          )
        )
      );

    const blocked =
      Math.max(
        0,
        Math.round(
          toNumber(
            row.blocked_count,
            0
          )
        )
      );

    const incomplete =
      Math.max(
        0,
        Math.round(
          toNumber(
            row.incomplete_count,
            0
          )
        )
      );

    return Math.max(
      0,
      counted -
      reserved -
      blocked -
      incomplete
    );
  }


  /*
   * IMPORTANT:
   * There can now be several rows for package 1/2,
   * because location/date/reference can differ.
   *
   * Therefore we SUM all package 1 rows per Barn,
   * SUM all package 2 rows per Barn, then take the minimum.
   */
  function calculateCompleteProducts(
    rows,
    fieldName =
      "counted_count"
  ) {
    const barnMap =
      new Map();

    rows.forEach(
      row => {
        const barnKey =
          String(
            row.warehouse_id ||
            "no-warehouse"
          );

        if (
          !barnMap.has(
            barnKey
          )
        ) {
          barnMap.set(
            barnKey,
            []
          );
        }

        barnMap
          .get(barnKey)
          .push(row);
      }
    );

    let totalComplete =
      0;

    barnMap.forEach(
      barnRows => {
        const packageTotal =
          Math.max(
            1,
            ...barnRows.map(
              row =>
                row.package_total
            )
          );

        const packageCounts =
          [];

        for (
          let packageNo = 1;
          packageNo <=
            packageTotal;
          packageNo++
        ) {
          const count =
            barnRows
              .filter(
                row =>
                  row.package_no ===
                  packageNo
              )
              .reduce(
                (sum, row) =>
                  sum +
                  Math.max(
                    0,
                    Math.round(
                      toNumber(
                        row[
                          fieldName
                        ],
                        0
                      )
                    )
                  ),
                0
              );

          packageCounts.push(
            count
          );
        }

        totalComplete +=
          packageCounts.length
            ? Math.min(
                ...packageCounts
              )
            : 0;
      }
    );

    return totalComplete;
  }


  function calculateAvailableComplete(
    rows
  ) {
    const barnMap =
      new Map();

    rows.forEach(
      row => {
        const barnKey =
          String(
            row.warehouse_id ||
            "no-warehouse"
          );

        if (
          !barnMap.has(
            barnKey
          )
        ) {
          barnMap.set(
            barnKey,
            []
          );
        }

        barnMap
          .get(barnKey)
          .push(row);
      }
    );

    let totalComplete =
      0;

    barnMap.forEach(
      barnRows => {
        const packageTotal =
          Math.max(
            1,
            ...barnRows.map(
              row =>
                row.package_total
            )
          );

        const packageCounts =
          [];

        for (
          let packageNo = 1;
          packageNo <=
            packageTotal;
          packageNo++
        ) {
          const count =
            barnRows
              .filter(
                row =>
                  row.package_no ===
                  packageNo
              )
              .reduce(
                (sum, row) =>
                  sum +
                  rowAvailableCount(
                    row
                  ),
                0
              );

          packageCounts.push(
            count
          );
        }

        totalComplete +=
          packageCounts.length
            ? Math.min(
                ...packageCounts
              )
            : 0;
      }
    );

    return totalComplete;
  }


  function differenceClass(
    value
  ) {
    if (value > 0) {
      return "pos";
    }

    if (value < 0) {
      return "neg";
    }

    return "zero";
  }

  function differenceText(
    value
  ) {
    if (value > 0) {
      return `+${value}`;
    }

    return String(
      value
    );
  }


  // ============================================================
  // KPI
  // ============================================================

  function renderKpis() {
    const physical =
      inventoryRows.reduce(
        (sum, row) =>
          sum +
          Math.max(
            0,
            Math.round(
              toNumber(
                row.counted_count,
                0
              )
            )
          ),
        0
      );

    const reserved =
      inventoryRows.reduce(
        (sum, row) =>
          sum +
          row.reserved_count,
        0
      );

    const blocked =
      inventoryRows.reduce(
        (sum, row) =>
          sum +
          row.blocked_count,
        0
      );

    const complete =
      calculateCompleteProducts(
        inventoryRows,
        "counted_count"
      );

    const available =
      calculateAvailableComplete(
        inventoryRows
      );

    const barnCount =
      new Set(
        inventoryRows.map(
          row =>
            String(
              row.warehouse_id ||
              "no-warehouse"
            )
        )
      ).size;

    setText(
      "invPhysical",
      formatNumber(
        physical
      )
    );

    setText(
      "invComplete",
      formatNumber(
        complete
      )
    );

    setText(
      "invAvailable",
      formatNumber(
        available
      )
    );

    setText(
      "invReserved",
      formatNumber(
        reserved
      )
    );

    setText(
      "invBlocked",
      formatNumber(
        blocked
      )
    );

    setText(
      "invBarns",
      formatNumber(
        inventoryRows.length
          ? barnCount
          : 0
      )
    );
  }


  // ============================================================
  // HEADER
  // ============================================================

  function renderProductHeader() {
    const header =
      byId(
        "inventoryProductHeader"
      );

    if (!header) {
      return;
    }

    if (!selectedProduct) {
      header.innerHTML = `
        <div class="inventory-product-main">

          <div class="inventory-product-image">
            📦
          </div>

          <div class="inventory-product-copy">

            <div class="inventory-product-sku">
              No product selected
            </div>

            <div class="inventory-product-name">
              Search for a SKU to start an inventory check.
            </div>

            <div class="inventory-product-owner">
              —
            </div>

          </div>

        </div>
      `;

      return;
    }

    header.innerHTML = `
      <div class="inventory-product-main">

        <div class="inventory-product-image">

          ${
            selectedProduct.image_url
              ? `
                <img
                  src="${escapeHtml(
                    selectedProduct.image_url
                  )}"
                  alt="${escapeHtml(
                    selectedProduct.name ||
                    selectedProduct.sku_base
                  )}"
                />
              `
              : "📦"
          }

        </div>

        <div class="inventory-product-copy">

          <div class="inventory-product-sku">
            ${escapeHtml(
              selectedProduct.sku_base ||
              "—"
            )}
          </div>

          <div class="inventory-product-name">
            ${escapeHtml(
              selectedProduct.name ||
              selectedProduct.description ||
              "Product"
            )}
          </div>

          <div class="inventory-product-owner">
            ${escapeHtml(
              selectedProduct
                .customers
                ?.name ||
              "—"
            )}
          </div>

        </div>

      </div>

      <div class="barn-meta">

        <span class="soft-pill blue">
          ${formatNumber(
            selectedItems.length
          )} item record(s)
        </span>

        <span class="soft-pill green">
          ${formatNumber(
            calculateCompleteProducts(
              inventoryRows,
              "system_count"
            )
          )} complete
        </span>

      </div>
    `;
  }


  // ============================================================
  // BARN GROUPING
  // ============================================================

  function groupRowsByBarn() {
    const map =
      new Map();

    inventoryRows.forEach(
      row => {
        const key =
          String(
            row.warehouse_id ||
            "no-warehouse"
          );

        if (!map.has(key)) {
          map.set(
            key,
            {
              warehouse_id:
                row.warehouse_id,

              warehouse_name:
                warehouseName(
                  row.warehouse_id
                ),

              rows: []
            }
          );
        }

        map
          .get(key)
          .rows
          .push(row);
      }
    );

    return Array.from(
      map.values()
    );
  }


  // ============================================================
  // LOCATION SELECT
  // ============================================================

  function buildLocationOptions(
    selectedId
  ) {
    const grouped =
      new Map();

    warehouses.forEach(
      warehouse => {
        grouped.set(
          String(
            warehouse.id
          ),
          {
            warehouse,
            locations: []
          }
        );
      }
    );

    locations.forEach(
      location => {
        const key =
          String(
            location.warehouse_id ||
            ""
          );

        if (
          grouped.has(key)
        ) {
          grouped
            .get(key)
            .locations
            .push(location);
        }
      }
    );

    let html = `
      <option value="">
        No location
      </option>
    `;

    grouped.forEach(
      group => {
        if (
          !group.locations
            .length
        ) {
          return;
        }

        html += `
          <optgroup
            label="${escapeHtml(
              group.warehouse.name
            )}"
          >
        `;

        group.locations
          .sort(
            (a, b) =>
              String(
                a.code
              ).localeCompare(
                String(
                  b.code
                ),
                "en-GB"
              )
          )
          .forEach(
            location => {
              html += `
                <option
                  value="${escapeHtml(
                    location.id
                  )}"
                  ${
                    String(
                      selectedId ||
                      ""
                    ) ===
                    String(
                      location.id
                    )
                      ? "selected"
                      : ""
                  }
                >
                  ${escapeHtml(
                    location.code ||
                    "Location"
                  )}
                </option>
              `;
            }
          );

        html += `
          </optgroup>
        `;
      }
    );

    return html;
  }


  // ============================================================
  // RENDER BARNS
  // ============================================================

  function renderBarns() {
    const container =
      byId(
        "inventoryBarns"
      );

    if (!container) {
      return;
    }

    if (!selectedProduct) {
      container.innerHTML = `
        <div class="inventory-empty">

          <strong>
            No product selected
          </strong>

          <span>
            Search by SKU above to load the current warehouse stock.
          </span>

        </div>
      `;

      return;
    }

    const groups =
      groupRowsByBarn();

    if (!groups.length) {
      container.innerHTML = `
        <div class="inventory-empty">

          <strong>
            No current stock found
          </strong>

          <span>
            ${escapeHtml(
              selectedProduct.sku_base
            )} has no physical stock records in Veynor.
          </span>

        </div>
      `;

      return;
    }

    container.innerHTML =
      groups
        .map(
          group =>
            renderBarnCard(
              group
            )
        )
        .join("");

    bindInventoryRowEvents();
  }


  function renderBarnCard(
    group
  ) {
    const systemPackages =
      group.rows.reduce(
        (sum, row) =>
          sum +
          row.system_count,
        0
      );

    const countedPackages =
      group.rows.reduce(
        (sum, row) =>
          sum +
          row.counted_count,
        0
      );

    const difference =
      countedPackages -
      systemPackages;

    return `
      <article class="barn-card">

        <div class="barn-head">

          <div>

            <div class="barn-title">
              ${escapeHtml(
                group.warehouse_name
              )}
            </div>

          </div>

          <div class="barn-meta">

            <span class="soft-pill blue">
              System:
              ${formatNumber(
                systemPackages
              )}
            </span>

            <span class="soft-pill green">
              Counted:
              ${formatNumber(
                countedPackages
              )}
            </span>

            <span class="soft-pill ${
              difference === 0
                ? "gray"
                : difference > 0
                  ? "green"
                  : "orange"
            }">
              Difference:
              ${escapeHtml(
                differenceText(
                  difference
                )
              )}
            </span>

          </div>

        </div>


        <div class="inventory-table-wrap">

          <table
            class="inventory-table"
            style="min-width:1500px;"
          >

            <thead>

              <tr>

                <th>
                  Package
                </th>

                <th>
                  System
                </th>

                <th>
                  Counted
                </th>

                <th>
                  Diff.
                </th>

                <th>
                  Reserved
                </th>

                <th>
                  Blocked
                </th>

                <th>
                  Incomplete
                </th>

                <th>
                  Available
                </th>

                <th>
                  Location
                </th>

                <th>
                  Actual Inbound
                </th>

                <th>
                  Inbound Ref
                </th>

                <th>
                  Batch
                </th>

              </tr>

            </thead>


            <tbody>

              ${
                group.rows
                  .map(
                    row =>
                      renderInventoryRow(
                        row
                      )
                  )
                  .join("")
              }

            </tbody>

          </table>

        </div>

      </article>
    `;
  }


  function renderInventoryRow(
    row
  ) {
    const difference =
      rowDifference(
        row
      );

    const available =
      rowAvailableCount(
        row
      );

    const freePhysical =
      Math.max(
        0,
        row.counted_count -
        row.reserved_count
      );

    const maxBlocked =
      Math.max(
        0,
        freePhysical -
        row.incomplete_count
      );

    const maxIncomplete =
      Math.max(
        0,
        freePhysical -
        row.blocked_count
      );

    return `
      <tr
        data-inventory-row="${escapeHtml(
          row.key
        )}"
      >

        <td>

          <strong>
            ${escapeHtml(
              row.package_label
            )}
          </strong>

        </td>


        <td>
          ${formatNumber(
            row.system_count
          )}
        </td>


        <td>

          <input
            class="inventory-count-input"
            type="number"
            min="0"
            step="1"
            value="${escapeHtml(
              row.counted_count
            )}"
            data-count-input="${escapeHtml(
              row.key
            )}"
          />

        </td>


        <td>

          <span
            class="diff ${differenceClass(
              difference
            )}"
            data-difference="${escapeHtml(
              row.key
            )}"
          >
            ${escapeHtml(
              differenceText(
                difference
              )
            )}
          </span>

        </td>


        <td>

          <strong>
            ${formatNumber(
              row.reserved_count
            )}
          </strong>

        </td>


        <td>

          <input
            class="inventory-count-input"
            type="number"
            min="0"
            max="${escapeHtml(
              maxBlocked
            )}"
            step="1"
            value="${escapeHtml(
              row.blocked_count
            )}"
            data-blocked-input="${escapeHtml(
              row.key
            )}"
          />

        </td>


        <td>

          <input
            class="inventory-count-input"
            type="number"
            min="0"
            max="${escapeHtml(
              maxIncomplete
            )}"
            step="1"
            value="${escapeHtml(
              row.incomplete_count
            )}"
            data-incomplete-input="${escapeHtml(
              row.key
            )}"
          />

        </td>


        <td>

          <strong
            style="color:#047857;"
            data-available-count="${escapeHtml(
              row.key
            )}"
          >
            ${formatNumber(
              available
            )}
          </strong>

        </td>


        <td>

          <select
            class="inventory-select"
            style="min-width:150px;"
            data-location-input="${escapeHtml(
              row.key
            )}"
          >
            ${buildLocationOptions(
              row.location_id
            )}
          </select>

        </td>


        <td>

          <input
            class="inventory-date-input"
            type="date"
            value="${escapeHtml(
              row.actual_inbound_date
            )}"
            data-inbound-date="${escapeHtml(
              row.key
            )}"
          />

        </td>


        <td>

          <input
            class="input"
            style="
              min-width:145px;
              padding:7px 9px;
            "
            type="text"
            value="${escapeHtml(
              row.inbound_reference
            )}"
            placeholder="Optional"
            data-inbound-reference="${escapeHtml(
              row.key
            )}"
          />

        </td>


        <td>

          <button
            type="button"
            class="btn"
            data-split-batch="${escapeHtml(
              row.key
            )}"
          >
            Split Batch
          </button>

        </td>

      </tr>
    `;
  }


  // ============================================================
  // ROW VALIDATION
  // ============================================================

  function normalizeRowExceptions(
    row
  ) {
    const freePhysical =
      Math.max(
        0,
        row.counted_count -
        row.reserved_count
      );

    row.blocked_count =
      Math.max(
        0,
        Math.min(
          row.blocked_count,
          freePhysical
        )
      );

    const remaining =
      Math.max(
        0,
        freePhysical -
        row.blocked_count
      );

    row.incomplete_count =
      Math.max(
        0,
        Math.min(
          row.incomplete_count,
          remaining
        )
      );
  }


  function refreshRowInputs(
    row
  ) {
    const key =
      safeCssEscape(
        row.key
      );

    const blockedInput =
      document.querySelector(
        `[data-blocked-input="${key}"]`
      );

    const incompleteInput =
      document.querySelector(
        `[data-incomplete-input="${key}"]`
      );

    const freePhysical =
      Math.max(
        0,
        row.counted_count -
        row.reserved_count
      );

    if (blockedInput) {
      blockedInput.value =
        row.blocked_count;

      blockedInput.max =
        Math.max(
          0,
          freePhysical -
          row.incomplete_count
        );
    }

    if (incompleteInput) {
      incompleteInput.value =
        row.incomplete_count;

      incompleteInput.max =
        Math.max(
          0,
          freePhysical -
          row.blocked_count
        );
    }
  }


  // ============================================================
  // ROW EVENTS
  // ============================================================

  function bindInventoryRowEvents() {
    document
      .querySelectorAll(
        "[data-count-input]"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            () => {
              const row =
                findInventoryRow(
                  input.dataset
                    .countInput
                );

              if (!row) {
                return;
              }

              row.counted_count =
                Math.max(
                  0,
                  Math.round(
                    toNumber(
                      input.value,
                      0
                    )
                  )
                );

              normalizeRowExceptions(
                row
              );

              refreshRowInputs(
                row
              );

              updateCalculations();
            }
          );
        }
      );


    document
      .querySelectorAll(
        "[data-blocked-input]"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            () => {
              const row =
                findInventoryRow(
                  input.dataset
                    .blockedInput
                );

              if (!row) {
                return;
              }

              row.blocked_count =
                Math.max(
                  0,
                  Math.round(
                    toNumber(
                      input.value,
                      0
                    )
                  )
                );

              normalizeRowExceptions(
                row
              );

              refreshRowInputs(
                row
              );

              updateCalculations();
            }
          );
        }
      );


    document
      .querySelectorAll(
        "[data-incomplete-input]"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            () => {
              const row =
                findInventoryRow(
                  input.dataset
                    .incompleteInput
                );

              if (!row) {
                return;
              }

              row.incomplete_count =
                Math.max(
                  0,
                  Math.round(
                    toNumber(
                      input.value,
                      0
                    )
                  )
                );

              normalizeRowExceptions(
                row
              );

              refreshRowInputs(
                row
              );

              updateCalculations();
            }
          );
        }
      );


    document
      .querySelectorAll(
        "[data-inbound-date]"
      )
      .forEach(
        input => {
          input.addEventListener(
            "change",
            () => {
              const row =
                findInventoryRow(
                  input.dataset
                    .inboundDate
                );

              if (!row) {
                return;
              }

              row.actual_inbound_date =
                input.value ||
                "";

              updateCalculations();
            }
          );
        }
      );


    document
      .querySelectorAll(
        "[data-inbound-reference]"
      )
      .forEach(
        input => {
          input.addEventListener(
            "input",
            () => {
              const row =
                findInventoryRow(
                  input.dataset
                    .inboundReference
                );

              if (!row) {
                return;
              }

              row.inbound_reference =
                clean(
                  input.value
                );

              updateCalculations();
            }
          );
        }
      );


    document
      .querySelectorAll(
        "[data-location-input]"
      )
      .forEach(
        select => {
          select.addEventListener(
            "change",
            () => {
              const row =
                findInventoryRow(
                  select.dataset
                    .locationInput
                );

              if (!row) {
                return;
              }

              row.location_id =
                select.value ||
                null;

              const location =
                getLocation(
                  row.location_id
                );

              if (location) {
                row.warehouse_id =
                  location.warehouse_id;

                row.warehouse_name =
                  warehouseName(
                    location
                      .warehouse_id
                  );

                row.location_code =
                  location.code ||
                  "";
              }

              updateCalculations();
            }
          );
        }
      );


    document
      .querySelectorAll(
        "[data-split-batch]"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              const row =
                findInventoryRow(
                  button.dataset
                    .splitBatch
                );

              if (!row) {
                return;
              }

              openSplitModal(
                row
              );
            }
          );
        }
      );
  }


  function findInventoryRow(
    key
  ) {
    return (
      inventoryRows.find(
        row =>
          String(
            row.key
          ) ===
          String(key)
      ) ||
      null
    );
  }


  // ============================================================
  // CALCULATION REFRESH
  // ============================================================

  function updateCalculations() {
    const systemTotal =
      inventoryRows.reduce(
        (sum, row) =>
          sum +
          row.system_count,
        0
      );

    const countedTotal =
      inventoryRows.reduce(
        (sum, row) =>
          sum +
          row.counted_count,
        0
      );

    const difference =
      countedTotal -
      systemTotal;

    const proposedComplete =
      calculateCompleteProducts(
        inventoryRows,
        "counted_count"
      );

    setText(
      "proposalSystem",
      formatNumber(
        systemTotal
      )
    );

    setText(
      "proposalCounted",
      formatNumber(
        countedTotal
      )
    );

    setText(
      "proposalDifference",
      differenceText(
        difference
      )
    );

    setText(
      "proposalComplete",
      formatNumber(
        proposedComplete
      )
    );

    const proposal =
      byId(
        "inventoryProposed"
      );

    proposal?.classList.toggle(
      "open",
      !!selectedProduct
    );


    document
      .querySelectorAll(
        "[data-difference]"
      )
      .forEach(
        element => {
          const row =
            findInventoryRow(
              element.dataset
                .difference
            );

          if (!row) {
            return;
          }

          const rowDiff =
            rowDifference(
              row
            );

          element.textContent =
            differenceText(
              rowDiff
            );

          element.className =
            `diff ${differenceClass(
              rowDiff
            )}`;
        }
      );


    inventoryRows.forEach(
      row => {
        const element =
          document.querySelector(
            `[data-available-count="${safeCssEscape(
              row.key
            )}"]`
          );

        if (element) {
          element.textContent =
            formatNumber(
              rowAvailableCount(
                row
              )
            );
        }
      }
    );

    renderKpis();

    updateFooter();

    renderBarnTotalsOnly();
  }


  function renderBarnTotalsOnly() {
    const groups =
      groupRowsByBarn();

    groups.forEach(
      group => {
        const cards =
          Array.from(
            document.querySelectorAll(
              ".barn-card"
            )
          );

        const card =
          cards.find(
            element =>
              element
                .querySelector(
                  ".barn-title"
                )
                ?.textContent
                ?.trim() ===
              group.warehouse_name
          );

        if (!card) {
          return;
        }

        const pills =
          card.querySelectorAll(
            ".barn-meta .soft-pill"
          );

        const system =
          group.rows.reduce(
            (sum, row) =>
              sum +
              row.system_count,
            0
          );

        const counted =
          group.rows.reduce(
            (sum, row) =>
              sum +
              row.counted_count,
            0
          );

        const diff =
          counted -
          system;

        if (pills[0]) {
          pills[0].textContent =
            `System: ${formatNumber(
              system
            )}`;
        }

        if (pills[1]) {
          pills[1].textContent =
            `Counted: ${formatNumber(
              counted
            )}`;
        }

        if (pills[2]) {
          pills[2].textContent =
            `Difference: ${differenceText(
              diff
            )}`;

          pills[2].className =
            `soft-pill ${
              diff === 0
                ? "gray"
                : diff > 0
                  ? "green"
                  : "orange"
            }`;
        }
      }
    );
  }


  // ============================================================
  // CHANGE DETECTION
  // ============================================================

  function rowMetadataChanged(
    row
  ) {
    return (
      String(
        row.location_id ||
        ""
      ) !==
        String(
          row.original_location_id ||
          ""
        ) ||

      String(
        row.warehouse_id ||
        ""
      ) !==
        String(
          row.original_warehouse_id ||
          ""
        ) ||

      String(
        row.actual_inbound_date ||
        ""
      ) !==
        String(
          row.original_inbound_date ||
          ""
        ) ||

      clean(
        row.inbound_reference
      ) !==
        clean(
          row.original_inbound_reference
        )
    );
  }


  function hasInventoryChanges() {
    return inventoryRows.some(
      row =>
        rowDifference(
          row
        ) !== 0 ||

        row.blocked_count !==
          row.original_blocked_count ||

        row.incomplete_count !==
          row.original_incomplete_count ||

        rowMetadataChanged(
          row
        )
    );
  }


  function hasPositiveStockDifference() {
    return inventoryRows.some(
      row =>
        rowDifference(
          row
        ) > 0
    );
  }


 function updateFooter() {
  const saveButton =
    byId(
      "btnSaveInventoryCheck"
    );

  const applyButton =
    byId(
      "btnApplyInventory"
    );


  if (saveButton) {
    saveButton.disabled =
      !selectedProduct;
  }


  if (applyButton) {
    applyButton.disabled =
      !selectedProduct ||
      !hasInventoryChanges();
  }


  if (!selectedProduct) {
    setText(
      "inventoryFooterNote",
      "Select a SKU to begin."
    );

    return;
  }


  if (!hasInventoryChanges()) {
    setText(
      "inventoryFooterNote",
      "The physical count and stock details match the current Veynor stock."
    );

    return;
  }


  const added =
    inventoryRows.reduce(
      (sum, row) =>
        sum +
        Math.max(
          0,
          rowDifference(
            row
          )
        ),
      0
    );


  const removed =
    inventoryRows.reduce(
      (sum, row) =>
        sum +
        Math.max(
          0,
          -rowDifference(
            row
          )
        ),
      0
    );


  const parts = [];


  if (added) {
    parts.push(
      `${added} physical package(s) will be added`
    );
  }


  if (removed) {
    parts.push(
      `${removed} physical package(s) will be marked missing`
    );
  }


  if (
    inventoryRows.some(
      row =>
        row.blocked_count !==
        row.original_blocked_count
    )
  ) {
    parts.push(
      "blocked stock will be updated"
    );
  }


  if (
    inventoryRows.some(
      row =>
        row.incomplete_count !==
        row.original_incomplete_count
    )
  ) {
    parts.push(
      "incomplete stock will be updated"
    );
  }


  if (
    inventoryRows.some(
      row =>
        rowMetadataChanged(
          row
        )
    )
  ) {
    parts.push(
      "location / inbound details will be updated"
    );
  }


  setText(
    "inventoryFooterNote",
    `${parts.join(" · ")}. Apply Stock Adjustment to save these changes.`
  );
}


  // ============================================================
  // SEARCH
  // ============================================================

  async function searchInventory() {
    const value =
      clean(
        byId(
          "inventorySearch"
        )?.value ||
        ""
      );

    if (!value) {
      showToast(
        "Enter a SKU or product first.",
        "err"
      );

      return;
    }

    const product =
      findProduct(
        value
      );

    if (!product) {
      showToast(
        `No product found for "${value}".`,
        "err"
      );

      return;
    }

    selectedProduct =
      product;

    await reloadSelectedProduct();

    showToast(
      `${product.sku_base} loaded for Inventory Check.`,
      "ok"
    );
  }


  async function reloadSelectedProduct() {
    if (!selectedProduct) {
      return;
    }

    selectedItems =
      await loadItemsForProduct(
        selectedProduct.id
      );

    inventoryRows =
      buildInventoryRows(
        selectedItems
      );

    renderProductHeader();

    renderKpis();

    renderBarns();

    updateCalculations();
  }


  // ============================================================
  // HISTORY PAYLOAD
  // ============================================================

  function buildCheckPayload() {
    return {
      product_id:
        selectedProduct?.id ||
        null,

      sku_base:
        selectedProduct?.sku_base ||
        null,

      product_name:
        selectedProduct?.name ||
        null,

      rows:
        inventoryRows.map(
          row => ({
            warehouse_id:
              row.warehouse_id,

            warehouse_name:
              warehouseName(
                row.warehouse_id
              ),

            location_id:
              row.location_id,

            location_code:
              locationCode(
                row.location_id
              ),

            original_location_id:
              row.original_location_id,

            package_no:
              row.package_no,

            package_total:
              row.package_total,

            package_label:
              row.package_label,

            system_count:
              row.system_count,

            counted_count:
              row.counted_count,

            difference:
              rowDifference(
                row
              ),

            reserved_count:
              row.reserved_count,

            blocked_before:
              row.original_blocked_count,

            blocked_count:
              row.blocked_count,

            incomplete_before:
              row.original_incomplete_count,

            incomplete_count:
              row.incomplete_count,

            available_count:
              rowAvailableCount(
                row
              ),

            inbound_before:
              row.original_inbound_date ||
              null,

            actual_inbound_date:
              row.actual_inbound_date ||
              null,

            inbound_reference_before:
              row.original_inbound_reference ||
              null,

            inbound_reference:
              row.inbound_reference ||
              null
          })
        )
    };
  }


  async function saveInventoryEvent({
    eventType =
      "inventory_check",

    notes = ""
  } = {}) {
    const cid =
      await getCompanyId();

    const {
      error
    } =
      await ensureClient()
        .from(
          "warehouse_events"
        )
        .insert({
          company_id:
            cid,

          event_type:
            eventType,

          entity_type:
            "product",

          entity_id:
            selectedProduct?.id ||
            null,

          reference_no:
            selectedProduct?.sku_base ||
            "Inventory Check",

          source_module:
            "inventory",

          user_profile_id:
            currentProfile?.id ||
            null,

          payload: {
            ...buildCheckPayload(),
            notes
          },

          created_at:
            new Date()
              .toISOString()
        });

    if (error) {
      throw error;
    }
  }


  async function saveCheckOnly() {
    if (!selectedProduct) {
      return;
    }

    await saveInventoryEvent({
      notes:
        "Inventory check saved without applying stock changes."
    });

    showToast(
      "Inventory Check saved to Stock History.",
      "ok"
    );
  }


  // ============================================================
  // NEGATIVE STOCK
  // ============================================================

function inventoryUuid() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    .replace(/[xy]/g, char => {
      const r =
        Math.random() * 16 | 0;

      const v =
        char === "x"
          ? r
          : (r & 0x3) | 0x8;

      return v.toString(16);
    });
}


function buildInventoryUniqueSku(
  product,
  packageNo,
  packageTotal,
  sequence
) {
  const sku =
    String(
      product?.sku_base ||
      "SKU"
    ).replace(
      /[^a-zA-Z0-9_-]/g,
      ""
    );

  const now =
    new Date();

  const stamp =
    now.getFullYear().toString() +
    String(
      now.getMonth() + 1
    ).padStart(2, "0") +
    String(
      now.getDate()
    ).padStart(2, "0") +
    String(
      now.getHours()
    ).padStart(2, "0") +
    String(
      now.getMinutes()
    ).padStart(2, "0") +
    String(
      now.getSeconds()
    ).padStart(2, "0") +
    String(
      now.getMilliseconds()
    ).padStart(3, "0");

  const random =
    Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase();

  return (
    `${sku}-INV-${stamp}-` +
    `${String(sequence).padStart(3, "0")}-` +
    `${random}-PKG${packageNo}OF${packageTotal}`
  );
}


async function findOpenPhysicalSetForPackage(
  row,
  excludePhysicalIds = new Set()
) {
  const cid =
    await getCompanyId();

  const {
    data,
    error
  } =
    await ensureClient()
      .from("items")
      .select(`
        id,
        physical_product_id,
        package_no,
        package_total,
        status,
        warehouse_id,
        location_id,
        created_at
      `)
      .eq(
        "company_id",
        cid
      )
      .eq(
        "product_id",
        selectedProduct.id
      )
      .eq(
        "package_total",
        row.package_total
      )
      .in(
        "status",
        [
          "in_stock",
          "reserved",
          "picked",
          "loaded"
        ]
      )
      .not(
        "physical_product_id",
        "is",
        null
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      )
      .limit(3000);

  if (error) {
    throw error;
  }

  const groups =
    new Map();

  (data || []).forEach(
    item => {
      const physicalId =
        String(
          item.physical_product_id ||
          ""
        );

      if (!physicalId) {
        return;
      }

      if (
        excludePhysicalIds.has(
          physicalId
        )
      ) {
        return;
      }

      if (
        !groups.has(
          physicalId
        )
      ) {
        groups.set(
          physicalId,
          []
        );
      }

      groups
        .get(physicalId)
        .push(item);
    }
  );

  for (
    const [
      physicalId,
      items
    ]
    of groups.entries()
  ) {
    const presentPackages =
      new Set(
        items.map(
          item =>
            Number(
              item.package_no ||
              1
            )
        )
      );

    /*
     * Als het package dat we nu willen toevoegen
     * al binnen deze fysieke set bestaat,
     * kan deze set niet gebruikt worden.
     */
    if (
      presentPackages.has(
        Number(
          row.package_no
        )
      )
    ) {
      continue;
    }

    /*
     * Als alle package-posities al aanwezig zijn,
     * is dit fysieke product al compleet.
     */
    if (
      presentPackages.size >=
      Number(
        row.package_total
      )
    ) {
      continue;
    }

    /*
     * Belangrijk:
     *
     * warehouse_id en location_id worden hier
     * BEWUST niet vergeleken.
     *
     * Packages van hetzelfde fysieke product
     * mogen in verschillende barns/locaties staan.
     */
    return physicalId;
  }

  /*
   * Geen bestaande incomplete fysieke set gevonden.
   * Maak daarom een nieuwe physical_product_id.
   */
  return inventoryUuid();
}

  function pickItemsForReduction(
    row,
    quantity
  ) {
    const candidates =
      row.items
        .filter(
          item =>
            isAvailable(
              item
            )
        )
        .sort(
          (a, b) =>
            new Date(
              b.created_at ||
              0
            ) -
            new Date(
              a.created_at ||
              0
            )
        );

    if (
      candidates.length <
      quantity
    ) {
      throw new Error(
        `${row.warehouse_name} · ${row.package_label}: only ${candidates.length} free package(s) can be removed. Reserved, blocked and incomplete packages are protected.`
      );
    }

    return candidates.slice(
      0,
      quantity
    );
  }

async function rebuildPhysicalSetStatus(
  physicalProductId
) {
  const cid =
    await getCompanyId();


  const {
    data,
    error
  } =
    await ensureClient()
      .from("items")
      .select(`
        id,
        product_id,
        physical_product_id,
        package_no,
        package_total,
        status,
        warehouse_id,
        location_id,
        stock_set_id,
        volume_m3,
        weight_kg
      `)
      .eq(
        "company_id",
        cid
      )
      .eq(
        "physical_product_id",
        physicalProductId
      );


  if (error) {
    throw error;
  }


  const items =
    (data || []).filter(
      item =>
        ![
          "out",
          "shipped",
          "missing",
          "damaged"
        ].includes(
          normalize(
            item.status
          )
        )
    );


  if (!items.length) {
    return;
  }


  const packageTotal =
    Math.max(
      1,
      ...items.map(
        item =>
          Number(
            item.package_total ||
            1
          )
      )
    );


  const present =
    new Set(
      items.map(
        item =>
          Number(
            item.package_no ||
            1
          )
      )
    );


  const complete =
    Array.from(
      {
        length:
          packageTotal
      },
      (
        _,
        index
      ) =>
        index + 1
    ).every(
      packageNo =>
        present.has(
          packageNo
        )
    );


  const ids =
    items.map(
      item =>
        item.id
    );


  const {
    error: updateError
  } =
    await ensureClient()
      .from("items")
      .update({
        stock_set_status:
          complete
            ? "complete"
            : "incomplete"
      })
      .in(
        "id",
        ids
      );


  if (updateError) {
    throw updateError;
  }
}

async function applyPositiveAdjustment(
  row
) {
  const difference =
    Math.round(
      rowDifference(
        row
      )
    );

  if (difference <= 0) {
    return 0;
  }


  const cid =
    await getCompanyId();

  const now =
    new Date()
      .toISOString();


  const inboundDate =
    row.actual_inbound_date
      ? toTimestampFromDate(
          row.actual_inbound_date
        )
      : now;


  const exampleItem =
    row.items.find(
      item =>
        Number(
          item.package_no
        ) ===
        Number(
          row.package_no
        )
    ) ||
    row.items[0] ||
    null;


  const volumeM3 =
    exampleItem?.volume_m3 ??
    null;

  const weightKg =
    exampleItem?.weight_kg ??
    null;


  const usedPhysicalIds =
    new Set();

  const insertedPhysicalIds =
    [];


  for (
    let index = 1;
    index <= difference;
    index++
  ) {
    const physicalProductId =
      await findOpenPhysicalSetForPackage(
        row,
        usedPhysicalIds
      );


    usedPhysicalIds.add(
      String(
        physicalProductId
      )
    );


    insertedPhysicalIds.push(
      physicalProductId
    );


    const uniqueSku =
      buildInventoryUniqueSku(
        selectedProduct,
        row.package_no,
        row.package_total,
        index
      );


    const {
      error
    } =
      await ensureClient()
        .from("items")
        .insert({
          company_id:
            cid,

          product_id:
            selectedProduct.id,

          warehouse_id:
            row.warehouse_id ||
            null,

          location_id:
            row.location_id ||
            null,

          storage_mutation_id:
            uniqueSku,

          sku_unique:
            uniqueSku,

          status:
            "in_stock",

          volume_m3:
            volumeM3,

          weight_kg:
            weightKg,

          received_at:
            inboundDate,

          inbound_date:
            inboundDate,

          inbound_reference:
            clean(
              row.inbound_reference
            ) ||
            null,

          physical_product_id:
            physicalProductId,

          package_no:
            row.package_no,

          package_total:
            row.package_total,

          package_label:
            row.package_label,

          stock_set_key:
            `${selectedProduct.id}:${physicalProductId}`,

          stock_set_status:
            Number(
              row.package_total
            ) === 1
              ? "complete"
              : "incomplete",

          package_condition:
            "complete",

          condition_notes:
            "Added during Inventory Check",

          condition_checked_at:
            now,

          condition_checked_by:
            currentProfile?.id ||
            null,

          is_match_blocked:
            false
        });


    if (error) {
      throw error;
    }
  }


  /*
   * Controleer nu alle betrokken physical_product_id's opnieuw.
   */
  for (
    const physicalProductId
    of [
      ...new Set(
        insertedPhysicalIds
      )
    ]
  ) {
    await rebuildPhysicalSetStatus(
      physicalProductId
    );
  }


  return difference;
}


  async function applyNegativeAdjustment(
    row
  ) {
    const difference =
      rowDifference(
        row
      );

    if (
      difference >= 0
    ) {
      return 0;
    }

    const quantity =
      Math.abs(
        difference
      );

    const selected =
      pickItemsForReduction(
        row,
        quantity
      );

    const ids =
      selected.map(
        item =>
          item.id
      );

    const now =
      new Date()
        .toISOString();

    const {
      error
    } =
      await ensureClient()
        .from("items")
        .update({
          status:
            "missing",

          package_condition:
            "missing",

          condition_notes:
            "Marked missing during Inventory Check",

          condition_checked_at:
            now,

          condition_checked_by:
            currentProfile?.id ||
            null
        })
        .in(
          "id",
          ids
        );

    if (error) {
      throw error;
    }

    return ids.length;
  }


  // ============================================================
  // BLOCKED
  // ============================================================

  async function applyBlockedAdjustment(
    row
  ) {
    const desired =
      Math.max(
        0,
        Math.round(
          toNumber(
            row.blocked_count,
            0
          )
        )
      );

    const current =
      row.items.filter(
        item =>
          normalize(
            item.status
          ) ===
            "in_stock" &&
          item.is_match_blocked ===
            true
      );

    const currentCount =
      current.length;

    if (
      desired ===
      currentCount
    ) {
      return {
        blocked: 0,
        unblocked: 0
      };
    }

    const now =
      new Date()
        .toISOString();


    if (
      desired >
      currentCount
    ) {
      const quantity =
        desired -
        currentCount;

      const candidates =
        row.items
          .filter(
            item =>
              normalize(
                item.status
              ) ===
                "in_stock" &&
              item.is_match_blocked !==
                true &&
              !isIncomplete(
                item
              )
          )
          .sort(
            (a, b) =>
              new Date(
                a.received_at ||
                a.created_at ||
                0
              ) -
              new Date(
                b.received_at ||
                b.created_at ||
                0
              )
          );

      if (
        candidates.length <
        quantity
      ) {
        throw new Error(
          `${row.warehouse_name} · ${row.package_label}: insufficient free stock to block ${quantity} additional package(s).`
        );
      }

      const ids =
        candidates
          .slice(
            0,
            quantity
          )
          .map(
            item =>
              item.id
          );

      const {
        error
      } =
        await ensureClient()
          .from("items")
          .update({
            is_match_blocked:
              true,

            match_block_reason:
              "Inventory Check",

            match_blocked_at:
              now,

            match_blocked_by:
              currentProfile?.id ||
              null
          })
          .in(
            "id",
            ids
          );

      if (error) {
        throw error;
      }

      return {
        blocked:
          ids.length,

        unblocked:
          0
      };
    }


    const quantity =
      currentCount -
      desired;

    const ids =
      current
        .slice(
          0,
          quantity
        )
        .map(
          item =>
            item.id
        );

    const {
      error
    } =
      await ensureClient()
        .from("items")
        .update({
          is_match_blocked:
            false,

          match_block_reason:
            null,

          match_blocked_at:
            null,

          match_blocked_by:
            null
        })
        .in(
          "id",
          ids
        );

    if (error) {
      throw error;
    }

    return {
      blocked: 0,

      unblocked:
        ids.length
    };
  }


  // ============================================================
  // INCOMPLETE
  // ============================================================

  async function applyIncompleteAdjustment(
    row
  ) {
    const desired =
      Math.max(
        0,
        Math.round(
          toNumber(
            row.incomplete_count,
            0
          )
        )
      );

    const current =
      row.items.filter(
        item =>
          isIncomplete(
            item
          )
      );

    const currentCount =
      current.length;

    if (
      desired ===
      currentCount
    ) {
      return {
        incomplete: 0,
        restored: 0
      };
    }

    const now =
      new Date()
        .toISOString();


    if (
      desired >
      currentCount
    ) {
      const quantity =
        desired -
        currentCount;

      const candidates =
        row.items
          .filter(
            item =>
              normalize(
                item.status
              ) ===
                "in_stock" &&
              item.is_match_blocked !==
                true &&
              !isIncomplete(
                item
              )
          );

      if (
        candidates.length <
        quantity
      ) {
        throw new Error(
          `${row.warehouse_name} · ${row.package_label}: insufficient free stock to mark ${quantity} package(s) incomplete.`
        );
      }

      const ids =
        candidates
          .slice(
            0,
            quantity
          )
          .map(
            item =>
              item.id
          );

      const {
        error
      } =
        await ensureClient()
          .from("items")
          .update({
            package_condition:
              "open_incomplete",

            condition_notes:
              "Marked incomplete during Inventory Check",

            condition_checked_at:
              now,

            condition_checked_by:
              currentProfile?.id ||
              null
          })
          .in(
            "id",
            ids
          );

      if (error) {
        throw error;
      }

      return {
        incomplete:
          ids.length,

        restored:
          0
      };
    }


    const quantity =
      currentCount -
      desired;

    const ids =
      current
        .slice(
          0,
          quantity
        )
        .map(
          item =>
            item.id
        );

    const {
      error
    } =
      await ensureClient()
        .from("items")
        .update({
          package_condition:
            "complete",

          condition_notes:
            null,

          condition_checked_at:
            now,

          condition_checked_by:
            currentProfile?.id ||
            null
        })
        .in(
          "id",
          ids
        );

    if (error) {
      throw error;
    }

    return {
      incomplete: 0,

      restored:
        ids.length
    };
  }


  // ============================================================
  // LOCATION / DATE / INBOUND REF CORRECTION
  // ============================================================

  async function applyBatchMetadataCorrection(
    row
  ) {
    if (
      !rowMetadataChanged(
        row
      )
    ) {
      return 0;
    }

    const activeItems =
      row.items.filter(
        item =>
          isActivePhysicalItem(
            item
          )
      );

    const ids =
      activeItems
        .map(
          item =>
            item.id
        )
        .filter(Boolean);

    if (!ids.length) {
      return 0;
    }

    let warehouseId =
      row.warehouse_id ||
      null;

    if (row.location_id) {
      const location =
        getLocation(
          row.location_id
        );

      if (location) {
        warehouseId =
          location.warehouse_id ||
          warehouseId;
      }
    }

    const payload = {
      warehouse_id:
        warehouseId,

      location_id:
        row.location_id ||
        null,

      inbound_reference:
        clean(
          row.inbound_reference
        ) ||
        null
    };

    if (
      row.actual_inbound_date
    ) {
      payload.inbound_date =
        toTimestampFromDate(
          row.actual_inbound_date
        );
    }

    const {
      error
    } =
      await ensureClient()
        .from("items")
        .update(
          payload
        )
        .in(
          "id",
          ids
        );

    if (error) {
      throw error;
    }

    return ids.length;
  }


  // ============================================================
  // SPLIT BATCH MODAL
  // ============================================================

  function ensureSplitModal() {
    if (
      byId(
        "inventorySplitModal"
      )
    ) {
      return;
    }

    const modal =
      document.createElement(
        "div"
      );

    modal.id =
      "inventorySplitModal";

    modal.className =
      "occ-modal";

    modal.setAttribute(
      "aria-hidden",
      "true"
    );

    modal.innerHTML = `
      <div
        class="occ-modal-card"
        style="
          width:min(650px,95vw);
        "
      >

        <div class="occ-modal-head">

          <div>

            <h2 class="occ-modal-title">
              Split Inventory Batch
            </h2>

            <p
              class="occ-modal-sub"
              id="inventorySplitSub"
            >
              Split existing physical items into another location or inbound batch.
            </p>

          </div>

          <button
            type="button"
            class="occ-modal-close"
            id="inventorySplitClose"
          >
            ×
          </button>

        </div>


        <section class="occ-modal-section">

          <div
            style="
              display:grid;
              grid-template-columns:1fr 1fr;
              gap:12px;
            "
          >

            <div class="field">

              <label>
                Quantity to move
              </label>

              <input
                id="inventorySplitQty"
                class="input"
                type="number"
                min="1"
                step="1"
              />

            </div>


            <div class="field">

              <label>
                Actual inbound date
              </label>

              <input
                id="inventorySplitDate"
                class="input"
                type="date"
              />

            </div>


            <div class="field">

              <label>
                New location
              </label>

              <select
                id="inventorySplitLocation"
                class="select"
              >
              </select>

            </div>


            <div class="field">

              <label>
                Inbound reference
              </label>

              <input
                id="inventorySplitReference"
                class="input"
                type="text"
                placeholder="Optional"
              />

            </div>

          </div>


          <div
            class="warning-box"
            style="margin-top:12px;"
          >
            This does not create new stock. Existing physical item records are moved into a separate inventory batch.
          </div>

        </section>


        <div class="occ-modal-actions">

          <button
            type="button"
            class="btn"
            id="inventorySplitCancel"
          >
            Cancel
          </button>

          <button
            type="button"
            class="btn btn-primary"
            id="inventorySplitApply"
          >
            Split Batch
          </button>

        </div>

      </div>
    `;

    document.body.appendChild(
      modal
    );


    byId(
      "inventorySplitClose"
    )?.addEventListener(
      "click",
      closeSplitModal
    );


    byId(
      "inventorySplitCancel"
    )?.addEventListener(
      "click",
      closeSplitModal
    );


    modal.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          modal
        ) {
          closeSplitModal();
        }
      }
    );


    byId(
      "inventorySplitApply"
    )?.addEventListener(
      "click",
      async () => {
        const button =
          byId(
            "inventorySplitApply"
          );

        try {
          if (button) {
            button.disabled =
              true;

            button.textContent =
              "Splitting...";
          }

          await executeSplitBatch();

        } catch (error) {
          console.error(
            error
          );

          showToast(
            error.message ||
            "Could not split inventory batch.",
            "err"
          );

        } finally {
          if (button) {
            button.disabled =
              false;

            button.textContent =
              "Split Batch";
          }
        }
      }
    );
  }


  function openSplitModal(
    row
  ) {
    ensureSplitModal();

    activeSplitRow =
      row;

    setText(
      "inventorySplitSub",
      `${selectedProduct?.sku_base || ""} · ${row.package_label} · ${row.warehouse_name} · ${row.location_code || "No location"} · ${row.actual_inbound_date || "No inbound date"}`
    );

    const activeCount =
      row.items.filter(
        item =>
          isActivePhysicalItem(
            item
          )
      ).length;

    const qtyInput =
      byId(
        "inventorySplitQty"
      );

    if (qtyInput) {
      qtyInput.min = "1";

      qtyInput.max =
        String(
          Math.max(
            1,
            activeCount - 1
          )
        );

      qtyInput.value =
        "";
    }

    const dateInput =
      byId(
        "inventorySplitDate"
      );

    if (dateInput) {
      dateInput.value =
        row.actual_inbound_date ||
        "";
    }

    const referenceInput =
      byId(
        "inventorySplitReference"
      );

    if (referenceInput) {
      referenceInput.value =
        row.inbound_reference ||
        "";
    }

    const locationSelect =
      byId(
        "inventorySplitLocation"
      );

    if (locationSelect) {
      locationSelect.innerHTML =
        buildLocationOptions(
          row.location_id
        );
    }

    const modal =
      byId(
        "inventorySplitModal"
      );

    modal?.classList.add(
      "open"
    );

    modal?.setAttribute(
      "aria-hidden",
      "false"
    );
  }


  function closeSplitModal() {
    const modal =
      byId(
        "inventorySplitModal"
      );

    modal?.classList.remove(
      "open"
    );

    modal?.setAttribute(
      "aria-hidden",
      "true"
    );

    activeSplitRow =
      null;
  }


  async function executeSplitBatch() {
    const row =
      activeSplitRow;

    if (!row) {
      throw new Error(
        "No inventory batch selected."
      );
    }

    const quantity =
      Math.round(
        toNumber(
          byId(
            "inventorySplitQty"
          )?.value,
          0
        )
      );

    const activeItems =
      row.items
        .filter(
          item =>
            isActivePhysicalItem(
              item
            )
        )
        .sort(
          (a, b) =>
            new Date(
              a.created_at ||
              0
            ) -
            new Date(
              b.created_at ||
              0
            )
        );

    if (
      quantity <= 0
    ) {
      throw new Error(
        "Enter a quantity to split."
      );
    }

    if (
      quantity >=
      activeItems.length
    ) {
      throw new Error(
        "The split quantity must be lower than the current batch quantity. Change the existing row directly if the whole batch needs another date or location."
      );
    }

    const locationId =
      byId(
        "inventorySplitLocation"
      )?.value ||
      null;

    const location =
      getLocation(
        locationId
      );

    const inboundDate =
      byId(
        "inventorySplitDate"
      )?.value ||
      "";

    const inboundReference =
      clean(
        byId(
          "inventorySplitReference"
        )?.value ||
        ""
      );

    const selected =
      activeItems.slice(
        0,
        quantity
      );

    const ids =
      selected.map(
        item =>
          item.id
      );

    const payload = {
      location_id:
        locationId,

      warehouse_id:
        location
          ?.warehouse_id ||
        row.warehouse_id ||
        null,

      inbound_reference:
        inboundReference ||
        null
    };

    if (inboundDate) {
      payload.inbound_date =
        toTimestampFromDate(
          inboundDate
        );
    }

    const confirmed =
      window.confirm(
        [
          `Split ${quantity} package(s) from this batch?`,
          "",
          `SKU: ${selectedProduct?.sku_base || "—"}`,
          `Package: ${row.package_label}`,
          `Current batch: ${row.system_count}`,
          `New location: ${location?.code || "No location"}`,
          `New inbound: ${inboundDate || "unchanged"}`,
          `New reference: ${inboundReference || "—"}`
        ].join("\n")
      );

    if (!confirmed) {
      return;
    }

    const {
      error
    } =
      await ensureClient()
        .from("items")
        .update(
          payload
        )
        .in(
          "id",
          ids
        );

    if (error) {
      throw error;
    }


    await saveInventoryEvent({
      eventType:
        "inventory_check",

      notes:
        `Batch split: ${quantity} package(s) from ${row.location_code || "no location"} / ${row.actual_inbound_date || "no date"} to ${location?.code || "no location"} / ${inboundDate || "unchanged date"}.`
    });


    closeSplitModal();

    await reloadSelectedProduct();

    showToast(
      `${quantity} package(s) moved into a separate inventory batch.`,
      "ok"
    );
  }


  // ============================================================
  // APPLY ALL NORMAL INVENTORY CHANGES
  // ============================================================

 async function applyInventoryAdjustment() {
  if (!selectedProduct) {
    throw new Error(
      "Select a product first."
    );
  }


  if (!hasInventoryChanges()) {
    showToast(
      "No inventory changes found.",
      "ok"
    );

    return;
  }


  // ==========================================================
  // 1. BEWAAR DE GEWENSTE EINDTOESTAND
  // ==========================================================

  const desiredRows =
    inventoryRows.map(
      row => ({
        key:
          row.key,

        package_no:
          Number(
            row.package_no
          ),

        package_total:
          Number(
            row.package_total
          ),

        warehouse_id:
          row.warehouse_id,

        location_id:
          row.location_id,

        actual_inbound_date:
          row.actual_inbound_date,

        inbound_reference:
          row.inbound_reference,

        system_count:
          Number(
            row.system_count || 0
          ),

        counted_count:
          Number(
            row.counted_count || 0
          ),

        difference:
          rowDifference(
            row
          ),

        blocked_count:
          Number(
            row.blocked_count || 0
          ),

        original_blocked_count:
          Number(
            row.original_blocked_count || 0
          ),

        incomplete_count:
          Number(
            row.incomplete_count || 0
          ),

        original_incomplete_count:
          Number(
            row.original_incomplete_count || 0
          ),

        metadataChanged:
          rowMetadataChanged(
            row
          ),

        sourceRow:
          row
      })
    );


  // ==========================================================
  // 2. CONFIRMATIE
  // ==========================================================

  const changed =
    desiredRows.filter(
      row =>
        row.difference !== 0 ||

        row.blocked_count !==
          row.original_blocked_count ||

        row.incomplete_count !==
          row.original_incomplete_count ||

        row.metadataChanged
    );


  const lines =
    changed.map(
      row => {
        const changes = [];


        if (
          row.difference > 0
        ) {
          changes.push(
            `add ${row.difference}`
          );
        }


        if (
          row.difference < 0
        ) {
          changes.push(
            `remove ${Math.abs(
              row.difference
            )}`
          );
        }


        if (
          row.blocked_count !==
          row.original_blocked_count
        ) {
          changes.push(
            `blocked ${row.original_blocked_count} → ${row.blocked_count}`
          );
        }


        if (
          row.incomplete_count !==
          row.original_incomplete_count
        ) {
          changes.push(
            `incomplete ${row.original_incomplete_count} → ${row.incomplete_count}`
          );
        }


        if (
          row.metadataChanged
        ) {
          changes.push(
            "location / inbound details"
          );
        }


        return (
          `${row.package_no}/${row.package_total}` +
          ` · ${changes.join(", ")}`
        );
      }
    );


  const confirmed =
    window.confirm(
      [
        `Apply Inventory Adjustment for ${selectedProduct.sku_base}?`,
        "",
        ...lines,
        "",
        "Positive differences create new physical packages.",
        "Negative differences mark free packages as missing.",
        "Blocked stock will first be unblocked when required.",
        "Reserved packages will never be removed."
      ].join("\n")
    );


  if (!confirmed) {
    return;
  }


  // ==========================================================
  // TOTALEN VOOR HISTORY / TOAST
  // ==========================================================

  let added = 0;
  let removed = 0;

  let blocked = 0;
  let unblocked = 0;

  let incomplete = 0;
  let restored = 0;

  let metadataUpdated = 0;


  // ==========================================================
  // HELPER:
  // Zoek dezelfde batch terug nadat we opnieuw hebben geladen.
  // ==========================================================

  function findCurrentRow(
    desired
  ) {
    return (
      inventoryRows.find(
        row =>
          Number(
            row.package_no
          ) ===
            Number(
              desired.package_no
            ) &&

          Number(
            row.package_total
          ) ===
            Number(
              desired.package_total
            ) &&

          String(
            row.warehouse_id ||
            ""
          ) ===
            String(
              desired.warehouse_id ||
              ""
            ) &&

          String(
            row.location_id ||
            ""
          ) ===
            String(
              desired.location_id ||
              ""
            ) &&

          String(
            row.actual_inbound_date ||
            ""
          ) ===
            String(
              desired.actual_inbound_date ||
              ""
            ) &&

          clean(
            row.inbound_reference
          ) ===
            clean(
              desired.inbound_reference
            )
      ) ||
      null
    );
  }


  // ==========================================================
  // 3. EERST BLOCKS VERLAGEN
  //
  // Voorbeeld:
  // blocked 7 → 0
  //
  // Dit MOET vóór de negatieve voorraadcorrectie gebeuren.
  // ==========================================================

  for (
    const desired
    of desiredRows
  ) {
    if (
      desired.blocked_count <
      desired.original_blocked_count
    ) {
      desired.sourceRow.blocked_count =
        desired.blocked_count;


      const result =
        await applyBlockedAdjustment(
          desired.sourceRow
        );


      blocked +=
        result.blocked;

      unblocked +=
        result.unblocked;
    }
  }


  // ==========================================================
  // 4. EERST INCOMPLETE HERSTELLEN WANNEER HET AANTAL DAALT
  //
  // incomplete 3 → 0 moet ook gebeuren voordat stock
  // eventueel verwijderd kan worden.
  // ==========================================================

  for (
    const desired
    of desiredRows
  ) {
    if (
      desired.incomplete_count <
      desired.original_incomplete_count
    ) {
      desired.sourceRow.incomplete_count =
        desired.incomplete_count;


      const result =
        await applyIncompleteAdjustment(
          desired.sourceRow
        );


      incomplete +=
        result.incomplete;

      restored +=
        result.restored;
    }
  }


  // ==========================================================
  // 5. METADATA VAN BESTAANDE BATCHES
  // ==========================================================

  for (
    const desired
    of desiredRows
  ) {
    if (
      desired.metadataChanged
    ) {
      metadataUpdated +=
        await applyBatchMetadataCorrection(
          desired.sourceRow
        );
    }
  }


  // ==========================================================
  // 6. HERLADEN
  //
  // Heel belangrijk:
  // row.items moet nu ook weten dat de items niet meer
  // blocked/incomplete zijn.
  // ==========================================================

  selectedItems =
    await loadItemsForProduct(
      selectedProduct.id
    );


  inventoryRows =
    buildInventoryRows(
      selectedItems
    );


  // ==========================================================
  // 7. NEGATIEVE CORRECTIES
  //
  // Nu zijn de te verwijderen items daadwerkelijk vrij.
  // ==========================================================

  for (
    const desired
    of desiredRows
  ) {
    if (
      desired.difference >= 0
    ) {
      continue;
    }


    const currentRow =
      findCurrentRow(
        desired
      );


    if (!currentRow) {
      throw new Error(
        `${desired.package_no}/${desired.package_total}: inventory batch could not be found after refreshing stock.`
      );
    }


    /*
     * buildInventoryRows zet counted gelijk aan system.
     * Daarom zetten we hier opnieuw de telling die
     * de gebruiker daadwerkelijk heeft ingevoerd.
     */
    currentRow.counted_count =
      desired.counted_count;


    const currentDifference =
      rowDifference(
        currentRow
      );


    if (
      currentDifference < 0
    ) {
      removed +=
        await applyNegativeAdjustment(
          currentRow
        );
    }
  }


  // ==========================================================
  // 8. OPNIEUW LADEN NA NEGATIEVE CORRECTIES
  // ==========================================================

  selectedItems =
    await loadItemsForProduct(
      selectedProduct.id
    );


  inventoryRows =
    buildInventoryRows(
      selectedItems
    );


  // ==========================================================
  // 9. POSITIEVE CORRECTIES
  // ==========================================================

  const positiveRows =
    desiredRows
      .filter(
        row =>
          row.difference > 0
      )
      .sort(
        (a, b) =>
          Number(
            a.package_no
          ) -
          Number(
            b.package_no
          )
      );


  for (
    const desired
    of positiveRows
  ) {
    let currentRow =
      findCurrentRow(
        desired
      );


    /*
     * Normaal bestaat de rij.
     * Zo niet, gebruik de oorspronkelijke rij als basis.
     */
    if (!currentRow) {
      currentRow =
        desired.sourceRow;
    }


    currentRow.counted_count =
      desired.counted_count;


    added +=
      await applyPositiveAdjustment(
        currentRow
      );
  }


  // ==========================================================
  // 10. HERLADEN NA POSITIEVE CORRECTIES
  // ==========================================================

  selectedItems =
    await loadItemsForProduct(
      selectedProduct.id
    );


  inventoryRows =
    buildInventoryRows(
      selectedItems
    );


  // ==========================================================
  // 11. NIEUWE / HOGERE BLOCKED & INCOMPLETE AANTALLEN
  //
  // Alleen verhogen gebeurt hier.
  //
  // Verlagingen zijn al vóór de stock removal uitgevoerd.
  // ==========================================================

  for (
    const desired
    of desiredRows
  ) {
    const currentRow =
      findCurrentRow(
        desired
      );


    /*
     * Als een volledige batch op 0 is gezet kan de rij
     * inmiddels verdwenen zijn. Dat is correct.
     */
    if (!currentRow) {
      continue;
    }


    // --------------------------------------------------------
    // BLOCKED
    // --------------------------------------------------------

    if (
      desired.blocked_count >
      desired.original_blocked_count
    ) {
      currentRow.blocked_count =
        desired.blocked_count;


      const blockResult =
        await applyBlockedAdjustment(
          currentRow
        );


      blocked +=
        blockResult.blocked;

      unblocked +=
        blockResult.unblocked;
    }


    // --------------------------------------------------------
    // INCOMPLETE
    // --------------------------------------------------------

    if (
      desired.incomplete_count >
      desired.original_incomplete_count
    ) {
      currentRow.incomplete_count =
        desired.incomplete_count;


      const incompleteResult =
        await applyIncompleteAdjustment(
          currentRow
        );


      incomplete +=
        incompleteResult.incomplete;

      restored +=
        incompleteResult.restored;
    }
  }


  // ==========================================================
  // 12. HISTORY
  // ==========================================================

  await saveInventoryEvent({
    eventType:
      "inventory_check",

    notes:
      [
        `${added} added`,
        `${removed} missing`,
        `${blocked} blocked`,
        `${unblocked} unblocked`,
        `${incomplete} incomplete`,
        `${restored} restored`,
        `${metadataUpdated} metadata updates`
      ].join(" · ")
  });


  // ==========================================================
  // 13. DEFINITIEVE DATABASESTATUS OPNIEUW LADEN
  // ==========================================================

  await reloadSelectedProduct();


  // ==========================================================
  // 14. RESULTAAT
  // ==========================================================

  showToast(
    `Inventory adjustment saved: ${added} package(s) added, ${removed} package(s) missing, ${unblocked} unblocked.`,
    "ok"
  );
}


  // ============================================================
  // REFRESH / RESET
  // ============================================================

  async function refreshCurrentProduct() {
    if (!selectedProduct) {
      await Promise.all([
        loadProducts(),
        loadWarehouses(),
        loadLocations()
      ]);

      showToast(
        "Inventory data refreshed.",
        "ok"
      );

      return;
    }

    await reloadSelectedProduct();

    showToast(
      "Inventory data refreshed.",
      "ok"
    );
  }


  function resetPage() {
    selectedProduct =
      null;

    selectedItems = [];

    inventoryRows = [];

    renderProductHeader();

    renderKpis();

    renderBarns();

    updateCalculations();
  }


  // ============================================================
  // MAIN EVENTS
  // ============================================================

  function bindEvents() {
    byId(
      "btnInventorySearch"
    )?.addEventListener(
      "click",
      async () => {
        try {
          await searchInventory();
        } catch (error) {
          console.error(
            error
          );

          showToast(
            error.message ||
            "Inventory search failed.",
            "err"
          );
        }
      }
    );


    byId(
      "inventorySearch"
    )?.addEventListener(
      "keydown",
      async event => {
        if (
          event.key !==
          "Enter"
        ) {
          return;
        }

        event.preventDefault();

        try {
          await searchInventory();
        } catch (error) {
          console.error(
            error
          );

          showToast(
            error.message ||
            "Inventory search failed.",
            "err"
          );
        }
      }
    );


    byId(
      "btnInventoryRefresh"
    )?.addEventListener(
      "click",
      async () => {
        try {
          await refreshCurrentProduct();
        } catch (error) {
          console.error(
            error
          );

          showToast(
            error.message ||
            "Inventory refresh failed.",
            "err"
          );
        }
      }
    );


    byId(
      "btnSaveInventoryCheck"
    )?.addEventListener(
      "click",
      async () => {
        try {
          await saveCheckOnly();
        } catch (error) {
          console.error(
            error
          );

          showToast(
            error.message ||
            "Could not save Inventory Check.",
            "err"
          );
        }
      }
    );


    byId(
      "btnApplyInventory"
    )?.addEventListener(
      "click",
      async () => {
        const button =
          byId(
            "btnApplyInventory"
          );

        const original =
          button?.textContent ||
          "Apply Stock Adjustment";

        try {
          if (button) {
            button.disabled =
              true;

            button.textContent =
              "Applying...";
          }

          await applyInventoryAdjustment();

        } catch (error) {
          console.error(
            error
          );

          showToast(
            error.message ||
            "Could not apply Inventory Adjustment.",
            "err"
          );

        } finally {
          if (button) {
            button.textContent =
              original;

            updateFooter();
          }
        }
      }
    );
  }


  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    try {
      ensureClient();

      await loadCurrentProfile();

      if (!isTenantRole()) {
        throw new Error(
          "You do not have permission to use Inventory Check."
        );
      }

      await Promise.all([
        loadProducts(),
        loadWarehouses(),
        loadLocations()
      ]);

      ensureSplitModal();

      bindEvents();

      resetPage();

      showToast(
        "Inventory Check ready.",
        "ok"
      );

    } catch (error) {
      console.error(
        "Inventory Check failed:",
        error
      );

      showToast(
        error.message ||
        "Inventory Check could not load.",
        "err"
      );
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