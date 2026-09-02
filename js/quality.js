(function () {
  "use strict";

  const QUALITY_BUCKET = "quality-assets";

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let companyId = null;

  let allOrders = [];
  let orderMap = new Map();

  let allCases = [];
  let filteredCases = [];

let selectedCaseId = null;
let activeCaseTab = "all";
let activeDetailTab = "details";

let qualityLocationMap = null;

let currentPage = 1;
const PAGE_SIZE = 10;

  // =========================================================
  // BASIC HELPERS
  // =========================================================

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
    return String(value ?? "")
      .replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
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

  function formatMoney(value) {
    return `£${toNumber(value, 0).toLocaleString(
      "en-GB",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    )}`;
  }

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString("en-GB");
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function showToast(message, type = "ok") {
    const toast = byId("toast");

    if (!toast) return;

    toast.textContent = message;
    toast.className = `notice ${type}`;

    clearTimeout(
      window.__qualityToastTimer
    );

    window.__qualityToastTimer =
      setTimeout(() => {
        toast.className = "notice";
        toast.textContent = "";
      }, 5000);
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


  // =========================================================
  // LABELS
  // =========================================================

  const ISSUE_LABELS = {
    damaged_packaging: "Damaged Packaging",
    damaged_product: "Damaged Product",
    missing_item: "Missing Item",
    wrong_item: "Wrong Item",
    incomplete_delivery: "Incomplete Delivery",
    delivery_refused: "Delivery Refused",
    other: "Other"
  };

  const STATUS_LABELS = {
    open: "Open",
    in_progress: "In Progress",
    awaiting_carrier: "Awaiting Carrier",
    awaiting_customer: "Awaiting Customer",
    resolved: "Resolved",
    closed: "Closed"
  };

  const RESPONSIBILITY_LABELS = {
    under_review: "Under Review",
    s2u: "Sofa2U",
    carrier: "Carrier",
    product_owner: "Product Owner",
    retailer: "Retailer",
    customer: "Customer",
    unknown: "Unknown"
  };

  const PRIORITY_LABELS = {
    low: "Low",
    normal: "Normal",
    high: "High",
    urgent: "Urgent"
  };

  const RESOLUTION_LABELS = {
    replacement: "Replacement",
    credit: "Credit",
    repair: "Repair",
    return: "Return",
    no_action: "No Action",
    other: "Other"
  };


  // =========================================================
  // PROFILE
  // =========================================================

  async function loadCurrentProfile() {
    const db = ensureClient();

    const {
      data: userData,
      error: userError
    } = await db.auth.getUser();

    if (userError) throw userError;

    currentUser =
      userData?.user || null;

    if (!currentUser?.id) {
      window.location.replace(
        "/login.html"
      );

      throw new Error(
        "Not authenticated."
      );
    }

    let result = await db
      .from("user_profiles")
      .select(`
        *,
        companies (
          id,
          name
        ),
        customers (
          id,
          name,
          customer_code
        )
      `)
      .eq("id", currentUser.id)
      .eq("is_active", true)
      .maybeSingle();

    if (
      !result.data &&
      !result.error
    ) {
      result = await db
        .from("user_profiles")
        .select(`
          *,
          companies (
            id,
            name
          ),
          customers (
            id,
            name,
            customer_code
          )
        `)
        .eq(
          "auth_user_id",
          currentUser.id
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

    currentProfile = result.data;
    companyId =
      currentProfile.company_id;

    if (!companyId) {
      throw new Error(
        "No company is linked to this profile."
      );
    }
  }


  // =========================================================
  // ORDER HELPERS
  // =========================================================

  function getRetailerName(order) {
    return cleanText(
      order?.retail_name ||
      order?.retailer_name ||
      order?.delivery_name ||
      order?.delivery_company ||
      order?.recipient_name ||
      "—"
    );
  }

  function getProductOwnerName(order) {
    return cleanText(
      order?.customers?.name ||
      order?.product_owner_name ||
      order?.customer_name ||
      "—"
    );
  }

  function getOrderAddress(order) {
    const parts = [
      order?.delivery_address_1,
      order?.delivery_address_2,
      order?.delivery_address_3,
      order?.delivery_address_4,
      order?.delivery_city,
      order?.delivery_postcode,
      order?.delivery_country
    ]
      .map(cleanText)
      .filter(Boolean);

    return [...new Set(parts)].join(", ");
  }

  function getCarrierName(order) {
    const explicit =
      cleanText(
        order?.carrier_name ||
        order?.assigned_carrier_name ||
        order?.transport_company ||
        ""
      );

    if (explicit) return explicit;

    if (
      normalize(
        order?.transport_type
      ) === "charter"
    ) {
      return "FDS";
    }

    return "Sofa2U";
  }

  function getDriverName(order) {
    return cleanText(
      order?.routes?.driver_name ||
      order?.driver_name ||
      ""
    );
  }

  function isDeliveredOrder(order) {
    return [
      order?.status,
      order?.transport_status,
      order?.warehouse_status,
      order?.overall_status
    ]
      .map(normalize)
      .includes("delivered");
  }

  function getOrderLines(order) {
    return Array.isArray(
      order?.order_lines
    )
      ? order.order_lines
      : [];
  }

  function getLineSku(line) {
    return cleanText(
      line?.sku_base ||
      line?.products?.sku_base ||
      "—"
    );
  }

  function getLineDescription(line) {
    return cleanText(
      line?.description ||
      line?.products?.description ||
      line?.products?.name ||
      "—"
    );
  }

  function getPodPhotosForOrder(order) {
    return (
      Array.isArray(
        order?.order_pod_assets
      )
        ? order.order_pod_assets
        : []
    ).filter(asset =>
      normalize(asset.asset_type) ===
        "photo" &&
      asset.file_url
    );
  }


  // =========================================================
  // LOAD DELIVERED ORDERS
  // =========================================================

  async function loadOrders() {
  const db = ensureClient();

  const params =
    new URLSearchParams(
      window.location.search
    );

  const requestedOrderId =
    cleanText(
      params.get("order_id")
    );

  /*
   * Eerst orders laden.
   */
  const {
    data: orders,
    error: ordersError
  } = await db
    .from("orders")
    .select("*")
    .eq(
      "company_id",
      companyId
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (ordersError) {
    console.error(
      "[Quality] orders query failed:",
      ordersError
    );

    throw ordersError;
  }

  const loadedOrders =
    orders || [];


  // =======================================================
  // PRODUCT OWNERS / CUSTOMERS
  // =======================================================

  /*
   * orders.customer_id verwijst naar de
   * Product Owner / Contract Customer.
   *
   * We laden deze bewust apart in plaats
   * van een nested Supabase relation.
   */
  const customerIds =
    [
      ...new Set(
        loadedOrders
          .map(order =>
            order.customer_id
          )
          .filter(Boolean)
      )
    ];

  let productOwners = [];

  if (customerIds.length) {
    const {
      data: customerData,
      error: customerError
    } = await db
      .from("customers")
      .select(`
        id,
        name,
        customer_code
      `)
      .in(
        "id",
        customerIds
      );

    if (customerError) {
      console.warn(
        "[Quality] product owners could not be loaded:",
        customerError
      );
    } else {
      productOwners =
        customerData || [];
    }
  }

  const productOwnerMap =
    new Map(
      productOwners.map(owner => [
        String(owner.id),
        owner
      ])
    );


  // =======================================================
  // ORDER LINES
  // =======================================================

  const orderIds =
    loadedOrders
      .map(order => order.id)
      .filter(Boolean);

  let lines = [];

  if (orderIds.length) {
    const {
      data: lineData,
      error: lineError
    } = await db
      .from("order_lines")
      .select(`
        id,
        order_id,
        product_id,
        sku_base,
        description,
        quantity_ordered
      `)
      .in(
        "order_id",
        orderIds
      );

    if (lineError) {
      console.warn(
        "[Quality] order_lines could not be loaded:",
        lineError
      );
    } else {
      lines =
        lineData || [];
    }
  }


  // =======================================================
  // LINK ORDER LINES
  // =======================================================

  const linesByOrder =
    new Map();

  lines.forEach(line => {
    const key =
      String(
        line.order_id
      );

    if (
      !linesByOrder.has(key)
    ) {
      linesByOrder.set(
        key,
        []
      );
    }

    linesByOrder
      .get(key)
      .push(line);
  });


  // =======================================================
  // ENRICH ORDERS
  // =======================================================

  loadedOrders.forEach(order => {
    order.order_lines =
      linesByOrder.get(
        String(order.id)
      ) || [];

    /*
     * Hierdoor werkt bestaande helper:
     *
     * getProductOwnerName(order)
     *
     * nu ook daadwerkelijk.
     */
    order.customers =
      order.customer_id
        ? productOwnerMap.get(
            String(
              order.customer_id
            )
          ) || null
        : null;
  });


  // =======================================================
  // ORDER MAP
  // =======================================================

  /*
   * ALLE orders in orderMap.
   * Daardoor kunnen ook Quality Cases en OCC
   * altijd hun originele order terugvinden.
   */
  orderMap =
    new Map(
      loadedOrders.map(order => [
        String(order.id),
        order
      ])
    );


  // =======================================================
  // DROPDOWN ORDERS
  // =======================================================

  allOrders =
    loadedOrders.filter(order => {
      if (
        requestedOrderId &&
        String(order.id) ===
        String(
          requestedOrderId
        )
      ) {
        return true;
      }

      return isDeliveredOrder(
        order
      );
    });


  console.log(
    "[Quality] loadOrders OK",
    {
      totalOrders:
        loadedOrders.length,

      dropdownOrders:
        allOrders.length,

      productOwners:
        productOwners.length,

      requestedOrderId,

      requestedOrderFound:
        requestedOrderId
          ? orderMap.has(
              String(
                requestedOrderId
              )
            )
          : null
    }
  );
}

  // =========================================================
  // LOAD QUALITY CASES
  // =========================================================

 async function loadCases() {
  const db =
    ensureClient();

  const {
    data: cases,
    error: casesError
  } = await db
    .from("quality_cases")
    .select("*")
    .eq(
      "company_id",
      companyId
    )
    .order(
      "reported_at",
      {
        ascending: false
      }
    );

  if (casesError) {
    console.error(
      "[Quality] quality_cases query failed:",
      casesError
    );

    throw casesError;
  }

  allCases =
    cases || [];

  if (!allCases.length) {
    filteredCases = [];

    applyFilters();
    renderAll();

    console.log(
      "[Quality] loadCases OK: 0 cases"
    );

    return;
  }


  const caseIds =
    allCases.map(
      row => row.id
    );


  // =========================================================
  // PRODUCTS
  // =========================================================

  let products = [];

  const {
    data: productData,
    error: productError
  } = await db
    .from(
      "quality_case_products"
    )
    .select("*")
    .in(
      "quality_case_id",
      caseIds
    );

  if (productError) {
    console.warn(
      "[Quality] quality_case_products failed:",
      productError
    );
  } else {
    products =
      productData || [];
  }


  // =========================================================
  // REPLACEMENT ITEMS
  // =========================================================

  let replacementItems = [];

  const {
    data: replacementData,
    error: replacementError
  } = await db
    .from(
      "quality_case_replacement_items"
    )
    .select("*")
    .in(
      "quality_case_id",
      caseIds
    )
    .order(
      "created_at",
      {
        ascending: true
      }
    );

  if (replacementError) {
    console.warn(
      "[Quality] replacement items failed:",
      replacementError
    );
  } else {
    replacementItems =
      replacementData || [];
  }


  // =========================================================
  // ATTACHMENTS
  // =========================================================

  let attachments = [];

  const {
    data: attachmentData,
    error: attachmentError
  } = await db
    .from(
      "quality_case_attachments"
    )
    .select("*")
    .in(
      "quality_case_id",
      caseIds
    );

  if (attachmentError) {
    console.warn(
      "[Quality] quality_case_attachments failed:",
      attachmentError
    );
  } else {
    attachments =
      attachmentData || [];
  }


  // =========================================================
  // ACTIVITY
  // =========================================================

  let activities = [];

  const {
    data: activityData,
    error: activityError
  } = await db
    .from(
      "quality_case_activity"
    )
    .select("*")
    .in(
      "quality_case_id",
      caseIds
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (activityError) {
    console.warn(
      "[Quality] quality_case_activity failed:",
      activityError
    );
  } else {
    activities =
      activityData || [];
  }


  // =========================================================
  // LINK EVERYTHING
  // =========================================================

  allCases =
    allCases.map(caseRow => {

      const caseProducts =
        products.filter(
          row =>
            String(
              row.quality_case_id
            ) ===
            String(
              caseRow.id
            )
        );

      caseProducts.forEach(product => {
        product.replacement_items =
          replacementItems.filter(
            item =>
              String(
                item.quality_case_product_id
              ) ===
              String(
                product.id
              )
          );
      });


      return {
        ...caseRow,

        quality_case_products:
          caseProducts,

        quality_case_replacement_items:
          replacementItems.filter(
            row =>
              String(
                row.quality_case_id
              ) ===
              String(
                caseRow.id
              )
          ),

        quality_case_attachments:
          attachments.filter(
            row =>
              String(
                row.quality_case_id
              ) ===
              String(
                caseRow.id
              )
          ),

        quality_case_activity:
          activities.filter(
            row =>
              String(
                row.quality_case_id
              ) ===
              String(
                caseRow.id
              )
          )
      };
    });


  applyFilters();
  renderAll();


  console.log(
    "[Quality] loadCases OK",
    {
      cases:
        allCases.length,

      products:
        products.length,

      replacementItems:
        replacementItems.length,

      attachments:
        attachments.length,

      activities:
        activities.length
    }
  );
}

function populateOrderSelect() {
  const select =
    byId("qualityOrderSelect");

  if (!select) return;


  select.innerHTML = `
    <option value="">
      Select delivered order
    </option>

    <option value="__legacy__">
      Legacy / order not in Veynor
    </option>
  `;


  allOrders.forEach(order => {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      order.id;


    const retailer =
      getRetailerName(
        order
      );


    const reference =
      cleanText(
        order.external_reference ||
        ""
      );


    option.textContent =
      [
        order.order_number ||
          "Order",

        retailer,

        reference
      ]
        .filter(Boolean)
        .join(" · ");


    select.appendChild(
      option
    );
  });
}

  function populateDynamicFilters() {
    const customerSelect =
      byId("filterQualityCustomer");

    const carrierSelect =
      byId("filterQualityCarrier");

    if (customerSelect) {
      const current =
        customerSelect.value;

      const values =
        [...new Set(
          allCases
            .map(row =>
              cleanText(
                row.retailer_name
              )
            )
            .filter(Boolean)
        )]
          .sort();

      customerSelect.innerHTML =
        `<option value="">All</option>`;

      values.forEach(value => {
        const option =
          document.createElement(
            "option"
          );

        option.value = value;
        option.textContent = value;

        customerSelect.appendChild(
          option
        );
      });

      customerSelect.value = current;
    }

    if (carrierSelect) {
      const current =
        carrierSelect.value;

      const values =
        [...new Set(
          allCases
            .map(row =>
              cleanText(
                row.carrier_name
              )
            )
            .filter(Boolean)
        )]
          .sort();

      carrierSelect.innerHTML =
        `<option value="">All</option>`;

      values.forEach(value => {
        const option =
          document.createElement(
            "option"
          );

        option.value = value;
        option.textContent = value;

        carrierSelect.appendChild(
          option
        );
      });

      carrierSelect.value = current;
    }
  }


  // =========================================================
  // FILTERS
  // =========================================================

  function caseMatchesTab(caseRow) {
    const status =
      normalize(caseRow.status);

    if (activeCaseTab === "all") {
      return true;
    }

    if (activeCaseTab === "open") {
      return [
        "open",
        "in_progress",
        "awaiting_carrier",
        "awaiting_customer"
      ].includes(status);
    }

    if (
      activeCaseTab ===
      "resolved"
    ) {
      return status === "resolved";
    }

    if (
      activeCaseTab ===
      "closed"
    ) {
      return status === "closed";
    }

    return true;
  }

  function applyFilters() {
    const search =
      normalize(
        byId(
          "filterQualitySearch"
        )?.value || ""
      );

    const status =
      normalize(
        byId(
          "filterQualityStatus"
        )?.value || ""
      );

    const issue =
      normalize(
        byId(
          "filterQualityIssue"
        )?.value || ""
      );

    const customer =
      normalize(
        byId(
          "filterQualityCustomer"
        )?.value || ""
      );

    const carrier =
      normalize(
        byId(
          "filterQualityCarrier"
        )?.value || ""
      );

    const responsibility =
      normalize(
        byId(
          "filterQualityResponsibility"
        )?.value || ""
      );

    filteredCases =
      allCases.filter(caseRow => {
        if (
          !caseMatchesTab(caseRow)
        ) {
          return false;
        }

        if (
          status &&
          normalize(caseRow.status) !==
            status
        ) {
          return false;
        }

        if (
          issue &&
          normalize(
            caseRow.issue_type
          ) !== issue
        ) {
          return false;
        }

        if (
          customer &&
          normalize(
            caseRow.retailer_name
          ) !== customer
        ) {
          return false;
        }

        if (
          carrier &&
          normalize(
            caseRow.carrier_name
          ) !== carrier
        ) {
          return false;
        }

        if (
          responsibility &&
          normalize(
            caseRow.responsibility
          ) !== responsibility
        ) {
          return false;
        }

        if (search) {
          const productText =
            (
              caseRow
                .quality_case_products ||
              []
            )
              .map(row => [
                row.sku_base,
                row.description
              ].join(" "))
              .join(" ");

          const order =
            orderMap.get(
              String(
                caseRow.order_id
              )
            );

          const fallbackProductText =
            getOrderLines(order)
              .map(line => [
                getLineSku(line),
                getLineDescription(
                  line
                )
              ].join(" "))
              .join(" ");

          const haystack = [
            caseRow.case_number,
            caseRow.order_number,
            caseRow.external_reference,
            caseRow.retailer_name,
            caseRow.product_owner_name,
            caseRow.carrier_name,
            caseRow.driver_name,
            ISSUE_LABELS[
              caseRow.issue_type
            ],
            STATUS_LABELS[
              caseRow.status
            ],
            productText,
            fallbackProductText
          ]
            .join(" ")
            .toLowerCase();

          if (
            !haystack.includes(search)
          ) {
            return false;
          }
        }

        return true;
      });

    currentPage = Math.min(
      Math.max(currentPage, 1),
      Math.max(
        1,
        Math.ceil(
          filteredCases.length /
          PAGE_SIZE
        )
      )
    );
  }


  // =========================================================
  // KPI
  // =========================================================

  function renderKpis() {
    const now = new Date();

    const sevenDaysAgo =
      new Date(now);

    sevenDaysAgo.setDate(
      sevenDaysAgo.getDate() - 7
    );

    const year =
      now.getFullYear();

    const openCases =
      allCases.filter(row =>
        ![
          "resolved",
          "closed"
        ].includes(
          normalize(row.status)
        )
      );

    const newCases =
      allCases.filter(row => {
        const reported =
          new Date(row.reported_at);

        return (
          !Number.isNaN(
            reported.getTime()
          ) &&
          reported >= sevenDaysAgo
        );
      });

    const awaitingCarrier =
      allCases.filter(row =>
        normalize(row.status) ===
        "awaiting_carrier"
      );

    const awaitingCustomer =
      allCases.filter(row =>
        normalize(row.status) ===
        "awaiting_customer"
      );

    const resolved =
      allCases.filter(row =>
        normalize(row.status) ===
        "resolved"
      );

    const openClaimValue =
      openCases.reduce(
        (sum, row) =>
          sum +
          toNumber(
            row.claim_value_gbp,
            0
          ),
        0
      );

    const ytdClaimValue =
      allCases.reduce(
        (sum, row) => {
          const date =
            new Date(
              row.reported_at
            );

          if (
            Number.isNaN(
              date.getTime()
            ) ||
            date.getFullYear() !== year
          ) {
            return sum;
          }

          return (
            sum +
            toNumber(
              row.claim_value_gbp,
              0
            )
          );
        },
        0
      );

    setText(
      "kpiOpenCases",
      openCases.length
    );

    setText(
      "kpiNewCases",
      newCases.length
    );

    setText(
      "kpiAwaitingCarrier",
      awaitingCarrier.length
    );

    setText(
      "kpiAwaitingCustomer",
      awaitingCustomer.length
    );

    setText(
      "kpiResolvedCases",
      resolved.length
    );

    setText(
      "kpiOpenClaimValue",
      formatMoney(
        openClaimValue
      )
    );

    setText(
      "kpiYtdClaimValue",
      formatMoney(
        ytdClaimValue
      )
    );

    setText(
      "tabCountAll",
      allCases.length
    );

    setText(
      "tabCountOpen",
      allCases.filter(row =>
        ![
          "resolved",
          "closed"
        ].includes(
          normalize(row.status)
        )
      ).length
    );

    setText(
      "tabCountResolved",
      allCases.filter(row =>
        normalize(row.status) ===
        "resolved"
      ).length
    );

    setText(
      "tabCountClosed",
      allCases.filter(row =>
        normalize(row.status) ===
        "closed"
      ).length
    );
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent =
        value ?? "";
    }
  }


  // =========================================================
  // BADGES
  // =========================================================

  function issueBadge(type) {
    const value =
      normalize(type);

    let cls = "";

    if (
      value ===
      "damaged_product"
    ) {
      cls =
        "issue-damage";
    } else if (
      value ===
      "damaged_packaging"
    ) {
      cls =
        "issue-packaging";
    } else if (
      value ===
      "missing_item"
    ) {
      cls =
        "issue-missing";
    } else if (
      value ===
      "wrong_item"
    ) {
      cls =
        "issue-wrong";
    } else {
      cls =
        "review";
    }

    return `
      <span class="quality-badge ${cls}">
        ${escapeHtml(
          ISSUE_LABELS[value] ||
          type ||
          "Other"
        )}
      </span>
    `;
  }

  function statusBadge(status) {
    const value =
      normalize(status);

    let cls = "review";

    if (value === "open") {
      cls = "open";
    }

    if (
      value ===
      "in_progress"
    ) {
      cls =
        "in-progress";
    }

    if (
      value ===
        "awaiting_carrier" ||
      value ===
        "awaiting_customer"
    ) {
      cls =
        "awaiting";
    }

    if (
      value ===
        "resolved" ||
      value ===
        "closed"
    ) {
      cls =
        "resolved";
    }

    return `
      <span class="quality-badge ${cls}">
        ${escapeHtml(
          STATUS_LABELS[value] ||
          status ||
          "—"
        )}
      </span>
    `;
  }

  function responsibilityBadge(
    responsibility
  ) {
    const value =
      normalize(
        responsibility
      );

    const cls =
      value === "carrier" ||
      value === "s2u"
        ? "carrier"
        : "review";

    return `
      <span class="quality-badge ${cls}">
        ${escapeHtml(
          RESPONSIBILITY_LABELS[
            value
          ] ||
          responsibility ||
          "—"
        )}
      </span>
    `;
  }


  // =========================================================
  // PRODUCT / EVIDENCE HELPERS
  // =========================================================

  function getCaseProducts(caseRow) {
    const explicit =
      caseRow
        .quality_case_products ||
      [];

    if (explicit.length) {
      return explicit;
    }

    const order =
      orderMap.get(
        String(caseRow.order_id)
      );

    return getOrderLines(order)
      .map(line => ({
        id: line.id,
        order_line_id: line.id,
        product_id:
          line.product_id ||
          line.products?.id ||
          null,
        sku_base:
          getLineSku(line),
        description:
          getLineDescription(line),
        quantity:
          toNumber(
            line.quantity_ordered,
            1
          ),
        affected_quantity: null,
        fallback: true
      }));
  }

  function getEvidenceCount(caseRow) {
    const attachments =
      caseRow
        .quality_case_attachments
        ?.length || 0;

    const order =
      orderMap.get(
        String(caseRow.order_id)
      );

    const pod =
      getPodPhotosForOrder(order)
        .length;

    return attachments + pod;
  }

  function getFirstProduct(caseRow) {
    return (
      getCaseProducts(caseRow)[0] ||
      null
    );
  }


  // =========================================================
  // TABLE
  // =========================================================

  function renderTable() {
    const tbody =
      byId(
        "qualityCasesTableBody"
      );

    if (!tbody) return;

    const start =
      (currentPage - 1) *
      PAGE_SIZE;

    const rows =
      filteredCases.slice(
        start,
        start + PAGE_SIZE
      );

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="12">
            <div
              style="
                min-height:180px;
                display:flex;
                align-items:center;
                justify-content:center;
                color:var(--muted);
              "
            >
              No quality cases found.
            </div>
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML =
      rows.map(caseRow => {
        const firstProduct =
          getFirstProduct(caseRow);

        const selected =
          String(
            selectedCaseId
          ) ===
          String(caseRow.id);

        return `
          <tr
            data-quality-case-id="${escapeHtml(
              caseRow.id
            )}"
            class="${
              selected
                ? "selected"
                : ""
            }"
          >

            <td>
              <span class="quality-primary">
                ${escapeHtml(
                  caseRow.case_number ||
                  "—"
                )}
              </span>
            </td>

            <td>
              ${escapeHtml(
                formatDate(
                  caseRow.reported_at
                )
              )}
            </td>

            <td>
              <span class="quality-primary">
                ${escapeHtml(
                  caseRow.order_number ||
                  "—"
                )}
              </span>

              ${
                caseRow.external_reference
                  ? `
                    <span class="subline">
                      ${escapeHtml(
                        caseRow.external_reference
                      )}
                    </span>
                  `
                  : ""
              }
            </td>

            <td>
              <span class="quality-primary">
                ${escapeHtml(
                  caseRow.retailer_name ||
                  "—"
                )}
              </span>
            </td>

            <td>
              ${
                firstProduct
                  ? `
                    <span class="quality-primary">
                      ${escapeHtml(
                        firstProduct.sku_base ||
                        "—"
                      )}
                    </span>

                    <span class="subline">
                      ${escapeHtml(
                        firstProduct.description ||
                        ""
                      )}
                    </span>
                  `
                  : "—"
              }
            </td>

            <td>
              ${issueBadge(
                caseRow.issue_type
              )}
            </td>

            <td>
              ${
                caseRow.carrier_name
                  ? `
                    <span class="quality-badge carrier">
                      ${escapeHtml(
                        caseRow.carrier_name
                      )}
                    </span>
                  `
                  : "—"
              }
            </td>

            <td>
              ${responsibilityBadge(
                caseRow.responsibility
              )}
            </td>

            <td>
              ${statusBadge(
                caseRow.status
              )}
            </td>

            <td>
              <strong>
                ${formatMoney(
                  caseRow.claim_value_gbp
                )}
              </strong>
            </td>

            <td>
              📷
              ${getEvidenceCount(
                caseRow
              )}
            </td>

            <td>
              <button
                class="quality-row-menu"
                type="button"
                data-quality-row-menu="${escapeHtml(
                  caseRow.id
                )}"
              >
                •••
              </button>
            </td>

          </tr>
        `;
      }).join("");

    tbody
      .querySelectorAll(
        "tr[data-quality-case-id]"
      )
      .forEach(row => {
        row.addEventListener(
          "click",
          event => {
            if (
              event.target.closest(
                "[data-quality-row-menu]"
              )
            ) {
              return;
            }

            openCaseDetail(
              row.dataset
                .qualityCaseId
            );
          }
        );
      });

    tbody
      .querySelectorAll(
        "[data-quality-row-menu]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          event => {
            event.preventDefault();
            event.stopPropagation();

            openCaseDetail(
              button.dataset
                .qualityRowMenu
            );
          }
        );
      });
  }


  // =========================================================
  // PAGINATION
  // =========================================================

  function renderPagination() {
    const container =
      byId(
        "qualityPagination"
      );

    if (!container) return;

    const pages =
      Math.max(
        1,
        Math.ceil(
          filteredCases.length /
          PAGE_SIZE
        )
      );

    const buttons = [];

    for (
      let page = 1;
      page <= pages;
      page += 1
    ) {
      buttons.push(`
        <button
          type="button"
          class="
            quality-page-btn
            ${
              page === currentPage
                ? "active"
                : ""
            }
          "
          data-quality-page="${page}"
        >
          ${page}
        </button>
      `);
    }

    container.innerHTML =
      buttons.join("");

    container
      .querySelectorAll(
        "[data-quality-page]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            currentPage =
              Number(
                button.dataset
                  .qualityPage
              ) || 1;

            renderTable();
            renderPagination();
          }
        );
      });

    setText(
      "qualityResultsMeta",
      `${filteredCases.length} case${
        filteredCases.length === 1
          ? ""
          : "s"
      } shown`
    );
  }


  // =========================================================
  // DETAIL PANEL
  // =========================================================

  function getSelectedCase() {
    return allCases.find(
      row =>
        String(row.id) ===
        String(
          selectedCaseId
        )
    ) || null;
  }

 async function openCaseDetail(
  caseId
) {
  selectedCaseId = caseId;
  activeDetailTab = "details";

  renderTable();

  await renderSelectedCase();

  /*
   * Detail panel is now rendered below the table.
   * Give the browser a moment to calculate the new
   * width before Leaflet recalculates the map size.
   */
  setTimeout(
    () => {
      if (qualityLocationMap) {
        qualityLocationMap.invalidateSize();
      }
    },
    150
  );
}

  function closeCaseDetail() {
    selectedCaseId = null;

    byId(
      "qualityCaseDetailContent"
    ).style.display = "none";

    byId(
      "qualityCaseDetailEmpty"
    ).style.display = "flex";

    renderTable();
  }

function renderQualityLocation(
  caseRow
) {
  const mapElement =
    byId("detailLocationMap");

  if (!mapElement) {
    return;
  }

  const order =
    orderMap.get(
      String(
        caseRow?.order_id || ""
      )
    );

  const lat =
    Number(
      order?.delivery_lat
    );

  const lng =
    Number(
      order?.delivery_lng
    );

  const hasCoordinates =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0;


  // =======================================================
  // OUDE KAART OPRUIMEN
  // =======================================================

  if (qualityLocationMap) {
    qualityLocationMap.remove();
    qualityLocationMap = null;
  }

  mapElement.innerHTML = "";


  // =======================================================
  // GEEN GEOLOCATIE
  // =======================================================

  if (!hasCoordinates) {
    mapElement.innerHTML = `
      <div
        style="
          width:100%;
          height:100%;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          gap:5px;
          padding:12px;
          text-align:center;
          background:#f8fafc;
        "
      >
        <strong
          style="
            color:#475569;
            font-size:10px;
          "
        >
          Location not geocoded
        </strong>

        <span
          style="
            color:#94a3b8;
            font-size:9px;
          "
        >
          No latitude / longitude available
        </span>
      </div>
    `;

    return;
  }


  // =======================================================
  // LEAFLET MAP
  // =======================================================

  if (
    typeof L === "undefined"
  ) {
    console.error(
      "[Quality] Leaflet is not loaded."
    );

    mapElement.innerHTML = `
      <div
        style="
          width:100%;
          height:100%;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:12px;
          color:#64748b;
          font-size:10px;
          font-weight:800;
          text-align:center;
        "
      >
        Map could not be loaded.
      </div>
    `;

    return;
  }


  qualityLocationMap =
    L.map(
      mapElement,
      {
        zoomControl: false,
        attributionControl: true
      }
    ).setView(
      [lat, lng],
      15
    );


  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        "© OpenStreetMap"
    }
  ).addTo(
    qualityLocationMap
  );


  L.marker(
    [lat, lng]
  ).addTo(
    qualityLocationMap
  );


  /*
   * Het detailpaneel wordt dynamisch geopend.
   * Leaflet moet daarom na het renderen
   * zijn formaat nog één keer berekenen.
   */
  setTimeout(
    () => {
      if (qualityLocationMap) {
        qualityLocationMap.invalidateSize();
      }
    },
    100
  );
}

  async function renderSelectedCase() {
    const caseRow =
      getSelectedCase();

    if (!caseRow) {
      closeCaseDetail();
      return;
    }

    byId(
      "qualityCaseDetailEmpty"
    ).style.display = "none";

    byId(
      "qualityCaseDetailContent"
    ).style.display = "block";

    setText(
      "detailCaseNumber",
      caseRow.case_number ||
        "Quality Case"
    );

    const statusElement =
      byId("detailCaseStatus");

    if (statusElement) {
      statusElement.outerHTML =
        statusBadge(
          caseRow.status
        ).replace(
          "<span ",
          `<span id="detailCaseStatus" `
        );
    }

    setText(
      "detailOrderNumber",
      caseRow.order_number ||
        "—"
    );

    setText(
      "detailIssueType",
      ISSUE_LABELS[
        caseRow.issue_type
      ] ||
        caseRow.issue_type ||
        "—"
    );

    setText(
      "detailRetailer",
      caseRow.retailer_name ||
        "—"
    );

    setText(
      "detailResponsibility",
      RESPONSIBILITY_LABELS[
        caseRow.responsibility
      ] ||
        caseRow.responsibility ||
        "—"
    );

const detailOriginalOrder =
  orderMap.get(
    String(caseRow.order_id)
  );

setText(
  "detailProductOwner",
  getProductOwnerName(
    detailOriginalOrder
  ) ||
  caseRow.product_owner_name ||
  "—"
);

    setText(
      "detailStatusText",
      STATUS_LABELS[
        caseRow.status
      ] ||
        caseRow.status ||
        "—"
    );

    setText(
      "detailCarrier",
      caseRow.carrier_name ||
        "—"
    );

    setText(
      "detailClaimValue",
      formatMoney(
        caseRow.claim_value_gbp
      )
    );

    setText(
      "detailReportedDate",
      formatDateTime(
        caseRow.reported_at
      )
    );

    setText(
      "detailDriver",
      caseRow.driver_name ||
        "—"
    );

    setText(
      "detailAddress",
      [
        caseRow.delivery_address,
        caseRow.delivery_postcode
      ]
        .filter(Boolean)
        .join(" · ") ||
        "—"
    );

renderQualityLocation(
  caseRow
);

    setText(
      "detailDescription",
      caseRow.description ||
        "No description recorded."
    );

    setText(
      "detailDiscoveredAt",
      caseRow.discovered_at ||
        "—"
    );

    setText(
      "detailPriority",
      PRIORITY_LABELS[
        caseRow.priority
      ] ||
        caseRow.priority ||
        "—"
    );

    setText(
      "detailResolutionType",
      RESOLUTION_LABELS[
        caseRow.resolution_type
      ] ||
        "Not decided yet"
    );

    setText(
      "detailCarrierReference",
      caseRow.carrier_claim_reference ||
        "—"
    );

    setText(
      "detailCustomerReference",
      caseRow.customer_claim_reference ||
        "—"
    );

    setText(
      "detailExternalReference",
      caseRow.external_reference ||
        "—"
    );

    setText(
      "detailProductCount",
      `(${getCaseProducts(
        caseRow
      ).length})`
    );

    setText(
      "detailEvidenceCount",
      `(${getEvidenceCount(
        caseRow
      )})`
    );

    setText(
      "detailActivityCount",
      `(${
        caseRow
          .quality_case_activity
          ?.length || 0
      })`
    );

    updateDetailTabs();

    await renderDetailTab();
    await renderPhotoStrip();
  }


  // =========================================================
  // DETAIL TABS
  // =========================================================

  function updateDetailTabs() {
    document
      .querySelectorAll(
        "[data-quality-detail-tab]"
      )
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset
            .qualityDetailTab ===
            activeDetailTab
        );
      });
  }

async function setProductQualityStatus(
  productRowId,
  isDamaged
) {
  const caseRow =
    getSelectedCase();

  if (!caseRow) {
    return;
  }

  const product =
    (
      caseRow
        .quality_case_products ||
      []
    ).find(
      row =>
        String(row.id) ===
        String(productRowId)
    );

  if (!product) {
    showToast(
      "Product could not be found.",
      "err"
    );

    return;
  }

  /*
   * Voor nu:
   *
   * Correct  = affected_quantity 0
   * Damaged  = volledige quantity affected
   *
   * Bij quantity 1 wordt dat dus 0 of 1.
   */
  const newAffectedQuantity =
    isDamaged
      ? Math.max(
          1,
          toNumber(
            product.quantity,
            1
          )
        )
      : 0;

  try {
    const {
      error
    } = await client
      .from(
        "quality_case_products"
      )
      .update({
        affected_quantity:
          newAffectedQuantity
      })
      .eq(
        "id",
        productRowId
      )
      .eq(
        "company_id",
        companyId
      );

    if (error) {
      throw error;
    }

    await addActivity(
      caseRow.id,
      "product_quality_updated",
      isDamaged
        ? `${product.sku_base || "Product"} marked as damaged / incorrect.`
        : `${product.sku_base || "Product"} marked as correct.`,
      null,
      null,
      {
        quality_case_product_id:
          productRowId,

        sku_base:
          product.sku_base || null,

        affected_quantity:
          newAffectedQuantity
      }
    );

    selectedCaseId =
      caseRow.id;

    await loadCases();

    activeDetailTab =
      "products";

    await renderSelectedCase();

    showToast(
      isDamaged
        ? `${product.sku_base || "Product"} marked as damaged.`
        : `${product.sku_base || "Product"} marked as correct.`
    );

  } catch (error) {
    console.error(
      "[Quality] product status update failed:",
      error
    );

    showToast(
      error.message ||
      "Product status could not be updated.",
      "err"
    );
  }
}

async function saveProductDamageNote(
  productRowId,
  note
) {
  const caseRow =
    getSelectedCase();

  if (!caseRow) {
    return;
  }

  const product =
    (
      caseRow.quality_case_products ||
      []
    ).find(
      row =>
        String(row.id) ===
        String(productRowId)
    );

  if (!product) {
    showToast(
      "Product could not be found.",
      "err"
    );

    return;
  }

  const cleanedNote =
    cleanText(note);

  try {
    const {
      error
    } = await client
      .from(
        "quality_case_products"
      )
      .update({
        notes:
          cleanedNote || null
      })
      .eq(
        "id",
        productRowId
      )
      .eq(
        "company_id",
        companyId
      );

    if (error) {
      throw error;
    }

    await addActivity(
      caseRow.id,
      "product_damage_note_updated",
      `${product.sku_base || "Product"} damage details updated.`,
      null,
      null,
      {
        quality_case_product_id:
          productRowId,
        sku_base:
          product.sku_base || null,
        notes:
          cleanedNote || null
      }
    );

    selectedCaseId =
      caseRow.id;

    await loadCases();

    activeDetailTab =
      "products";

    await renderSelectedCase();

    showToast(
      `${product.sku_base || "Product"} damage details saved.`
    );

  } catch (error) {
    console.error(
      "[Quality] damage note update failed:",
      error
    );

    showToast(
      error.message ||
      "Damage details could not be saved.",
      "err"
    );
  }
}

async function getNextServiceOrderNumber(
  originalOrderNumber
) {
  const base =
    cleanText(
      originalOrderNumber || "SERVICE"
    );

  /*
   * Voorkom S, S2, S3 stapeling wanneer
   * een serviceorder ooit opnieuw als bron
   * gebruikt zou worden.
   */
  const cleanBase =
    base.replace(/S\d*$/i, "");

  const firstService =
    `${cleanBase}S`;

  const {
    data,
    error
  } = await client
    .from("orders")
    .select("order_number")
    .eq(
      "company_id",
      companyId
    )
    .ilike(
      "order_number",
      `${firstService}%`
    );

  if (error) {
    throw error;
  }

  const existing =
    new Set(
      (data || []).map(row =>
        String(
          row.order_number || ""
        ).toUpperCase()
      )
    );

  if (
    !existing.has(
      firstService.toUpperCase()
    )
  ) {
    return firstService;
  }

  for (
    let i = 2;
    i < 999;
    i += 1
  ) {
    const candidate =
      `${firstService}${i}`;

    if (
      !existing.has(
        candidate.toUpperCase()
      )
    ) {
      return candidate;
    }
  }

  throw new Error(
    "Could not create a unique service order number."
  );
}

async function addReplacementItem(
  productRowId
) {
  const caseRow =
    getSelectedCase();

  if (!caseRow) {
    return;
  }

  const product =
    (
      caseRow.quality_case_products ||
      []
    ).find(
      row =>
        String(row.id) ===
        String(productRowId)
    );

  if (!product) {
    showToast(
      "Product could not be found.",
      "err"
    );

    return;
  }

  const description =
    window.prompt(
      "What needs to be delivered?"
    );

  if (
    !description ||
    !cleanText(description)
  ) {
    return;
  }

  const quantityValue =
    window.prompt(
      "Quantity:",
      "1"
    );

  if (quantityValue === null) {
    return;
  }

  const quantity =
    Math.max(
      1,
      Math.round(
        toNumber(
          quantityValue,
          1
        )
      )
    );

  try {
    const {
      error
    } = await client
      .from(
        "quality_case_replacement_items"
      )
      .insert({
        company_id:
          companyId,

        quality_case_id:
          caseRow.id,

        quality_case_product_id:
          product.id,

        description:
          cleanText(
            description
          ),

        quantity,

        source_sku_base:
          product.sku_base ||
          null,

        status:
          "pending",

        created_by:
          currentProfile.id
      });

    if (error) {
      throw error;
    }

    await addActivity(
      caseRow.id,
      "replacement_item_added",
      `${quantity} × ${cleanText(
        description
      )} added for ${
        product.sku_base ||
        "product"
      }.`
    );

    selectedCaseId =
      caseRow.id;

    await loadCases();

    activeDetailTab =
      "products";

    await renderSelectedCase();

    showToast(
      "Replacement item added."
    );

  } catch (error) {
    console.error(
      "[Quality] replacement item insert failed:",
      error
    );

    showToast(
      error.message ||
      "Replacement item could not be added.",
      "err"
    );
  }
}


async function deleteReplacementItem(
  replacementItemId
) {
  const caseRow =
    getSelectedCase();

  if (!caseRow) {
    return;
  }

  const item =
    (
      caseRow
        .quality_case_replacement_items ||
      []
    ).find(
      row =>
        String(row.id) ===
        String(
          replacementItemId
        )
    );

  if (!item) {
    return;
  }

  if (
    normalize(item.status) ===
    "ordered"
  ) {
    showToast(
      "This item is already linked to a replacement order.",
      "err"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `Remove "${item.description}"?`
    );

  if (!confirmed) {
    return;
  }

  try {
    const {
      error
    } = await client
      .from(
        "quality_case_replacement_items"
      )
      .delete()
      .eq(
        "id",
        replacementItemId
      )
      .eq(
        "company_id",
        companyId
      );

    if (error) {
      throw error;
    }

    await addActivity(
      caseRow.id,
      "replacement_item_removed",
      `${item.description} removed from replacement requirements.`
    );

    selectedCaseId =
      caseRow.id;

    await loadCases();

    activeDetailTab =
      "products";

    await renderSelectedCase();

    showToast(
      "Replacement item removed."
    );

  } catch (error) {
    console.error(
      "[Quality] replacement item delete failed:",
      error
    );

    showToast(
      error.message ||
      "Replacement item could not be removed.",
      "err"
    );
  }
}

async function createServiceOrder() {
  const caseRow =
    getSelectedCase();

  if (!caseRow) {
    showToast(
      "No Quality Case selected.",
      "err"
    );
    return;
  }

  const originalOrder =
    orderMap.get(
      String(caseRow.order_id)
    );

  if (!originalOrder) {
    showToast(
      "The original order could not be found.",
      "err"
    );
    return;
  }

  /*
   * Alleen nog niet bestelde replacement-items
   * meenemen.
   */
  const pendingItems =
    (
      caseRow
        .quality_case_replacement_items ||
      []
    ).filter(item =>
      normalize(item.status) ===
      "pending"
    );

  if (!pendingItems.length) {
    showToast(
      "There are no pending replacement items to order.",
      "err"
    );
    return;
  }

  const confirmed =
    window.confirm(
      `Create a service order with ${pendingItems.length} replacement item(s) for ${caseRow.retailer_name || originalOrder.retail_name || "this customer"}?`
    );

  if (!confirmed) {
    return;
  }

  try {
    const now =
      new Date().toISOString();

    const today =
      now.slice(0, 10);

    const serviceOrderNumber =
      await getNextServiceOrderNumber(
        originalOrder.order_number
      );

    /*
     * De serviceorder kopieert de volledige
     * afleverlocatie van de originele order.
     *
     * Bestaande lat/lng worden ook meegenomen.
     * Als die ontbreken kan Order Matching
     * later geocoderen.
     */
    const orderPayload = {
      company_id:
        originalOrder.company_id ||
        companyId,

      customer_id:
        originalOrder.customer_id ||
        caseRow.customer_id ||
        null,

      order_number:
        serviceOrderNumber,

      order_type:
        "service",

      source_type:
        "quality_service_order",

external_reference:
  originalOrder.external_reference ||
  caseRow.external_reference ||
  null,

      purchase_order:
        originalOrder.purchase_order ||
        null,

      order_date:
        today,

      requested_delivery_date:
        null,

      status:
        "imported",

      warehouse_status:
        "awaiting_goods",

      transport_status:
        "not_planned",

      finance_status:
        "not_invoiced",

      overall_status:
        "awaiting_goods",

      planning_release:
        false,

      planning_colli:
        0,

      planning_volume_m3:
        0,

      total_order_colli:
        0,

      total_order_volume_m3:
        0,

      total_order_weight_kg:
        0,

      matched_colli:
        0,

      matched_volume_m3:
        0,

      matched_weight_kg:
        0,

      retail_name:
        originalOrder.retail_name ||
        caseRow.retailer_name ||
        null,

      retailer_code:
        originalOrder.retailer_code ||
        caseRow.retailer_code ||
        null,

      delivery_address_1:
        originalOrder.delivery_address_1 ||
        null,

      delivery_address_2:
        originalOrder.delivery_address_2 ||
        null,

      delivery_address_3:
        originalOrder.delivery_address_3 ||
        null,

      delivery_address_4:
        originalOrder.delivery_address_4 ||
        null,

      delivery_city:
        originalOrder.delivery_city ||
        null,

      delivery_postcode:
        originalOrder.delivery_postcode ||
        caseRow.delivery_postcode ||
        null,

      delivery_country:
        originalOrder.delivery_country ||
        "United Kingdom",

      delivery_region:
        originalOrder.delivery_region ||
        null,

      delivery_lat:
        originalOrder.delivery_lat ||
        null,

      delivery_lng:
        originalOrder.delivery_lng ||
        null,

      memo:
        `Service order created from Quality Case ${caseRow.case_number || caseRow.id}. Original order: ${originalOrder.order_number || caseRow.order_number || "—"}.`,

      notes:
        caseRow.description
          ? `Quality Case: ${caseRow.description}`
          : `Service order for ${caseRow.case_number || "Quality Case"}.`,

      created_at:
        now,

      last_activity_at:
        now
    };

    const {
      data: newOrder,
      error: orderError
    } = await client
      .from("orders")
      .insert(orderPayload)
      .select(
        "id, order_number"
      )
      .single();

    if (orderError) {
      throw orderError;
    }

    /*
     * Replacement-items zijn bewust MANUAL
     * orderregels.
     *
     * Ze hoeven dus geen bestaand product/SKU
     * uit de product master te zijn.
     */
    const orderLines =
      pendingItems.map(
        (item, index) => ({
          company_id:
            companyId,

          order_id:
            newOrder.id,

          line_number:
            index + 1,

          product_id:
            null,

          sku_base:
            item.source_sku_base ||
            "SERVICE",

          description:
            item.description ||
            "Service item",

          quantity_ordered:
            Math.max(
              1,
              Math.round(
                toNumber(
                  item.quantity,
                  1
                )
              )
            ),

          quantity_allocated:
            0,

          quantity_shipped:
            0,

          line_type:
            "manual",

          manual_description:
            item.description ||
            "Service item",

          unit_volume_m3:
            0,

          total_volume_m3:
            0,

          total_line_volume_m3:
            0,

          unit_weight_kg:
            0,

          total_line_weight_kg:
            0,

          matched_quantity:
            0,

          matched_volume_m3:
            0,

          matched_weight_kg:
            0,

          packages_per_unit:
            0,

          total_packages:
            0,

          scanned_packages:
            0,

          tariff_transport:
            0,

          tariff_storage:
            0,

          tariff_admin:
            0,

          tariff_handling:
            0,

          total_customer_charge:
            0,

          notes:
            `Quality Case ${caseRow.case_number || caseRow.id}`,

          created_at:
            now
        })
      );

    const {
      error: lineError
    } = await client
      .from("order_lines")
      .insert(orderLines);

    if (lineError) {
      /*
       * Voorkom een lege serviceorder wanneer
       * de orderregels onverwacht mislukken.
       */
      await client
        .from("orders")
        .delete()
        .eq(
          "id",
          newOrder.id
        )
        .eq(
          "company_id",
          companyId
        );

      throw lineError;
    }

    /*
     * Alle gebruikte replacement-items markeren
     * als besteld.
     */
    const replacementIds =
      pendingItems
        .map(item => item.id)
        .filter(Boolean);

    if (replacementIds.length) {
      const {
        error: replacementError
      } = await client
        .from(
          "quality_case_replacement_items"
        )
        .update({
          status:
            "ordered"
        })
        .in(
          "id",
          replacementIds
        )
        .eq(
          "company_id",
          companyId
        );

      if (replacementError) {
        throw replacementError;
      }
    }

    /*
     * Audit trail op de Quality Case.
     */
    await addActivity(
      caseRow.id,
      "service_order_created",
      `Service order ${serviceOrderNumber} created with ${pendingItems.length} replacement item(s).`,
      null,
      null,
      {
        service_order_id:
          newOrder.id,

        service_order_number:
          serviceOrderNumber,

        original_order_id:
          originalOrder.id,

        replacement_item_ids:
          replacementIds
      }
    );

    selectedCaseId =
      caseRow.id;

    await loadOrders();
    await loadCases();

    activeDetailTab =
      "products";

    await renderSelectedCase();

    showToast(
      `Service order ${serviceOrderNumber} created.`,
      "ok"
    );

  } catch (error) {
    console.error(
      "[Quality] service order creation failed:",
      error
    );

    showToast(
      error.message ||
      "Service order could not be created.",
      "err"
    );
  }
}

async function createClaimInvoice() {
  const caseRow =
    getSelectedCase();

  if (!caseRow) {
    showToast(
      "No Quality Case selected.",
      "err"
    );
    return;
  }

  if (
    normalize(caseRow.responsibility) !==
    "carrier"
  ) {
    showToast(
      "The responsible party must be Carrier before a claim invoice can be created.",
      "err"
    );
    return;
  }

  const claimAmount =
    toNumber(
      caseRow.claim_value_gbp,
      0
    );

  if (claimAmount <= 0) {
    showToast(
      "Enter a claim value before creating the invoice.",
      "err"
    );
    return;
  }

  if (caseRow.claim_invoice_id) {
    showToast(
      "A claim invoice already exists for this Quality Case.",
      "err"
    );
    return;
  }

  if (
    !window.InvoiceGenerator
      ?.generateClaimInvoice
  ) {
    showToast(
      "Invoice generator is not available.",
      "err"
    );
    return;
  }

  const confirmed =
    window.confirm(
      `Create a claim invoice for ${formatMoney(
        claimAmount
      )} for ${
        caseRow.case_number ||
        "this Quality Case"
      }?`
    );

  if (!confirmed) {
    return;
  }

  try {
    // Alle evidence uit dezelfde casus ophalen.
    const evidence =
      await getCaseEvidence(
        caseRow
      );

    // Alleen afbeeldingen naar de invoice sturen.
    const photos =
      evidence
        .filter(
          item =>
            isImageEvidence(item) &&
            item.url
        )
        .map(item => ({
          url: item.url,
          fileName:
            item.fileName ||
            "Evidence photo",
          type:
            item.type ||
            "quality"
        }));

    const result =
      await window.InvoiceGenerator
        .generateClaimInvoice(
          {
            qualityCaseId:
              caseRow.id,

            caseNumber:
              caseRow.case_number,

            orderNumber:
              caseRow.order_number,

            externalReference:
              caseRow.external_reference,

            carrierReference:
              caseRow
                .carrier_claim_reference,

            amount:
              claimAmount,

            description:
              caseRow.description ||
              `Damage claim ${
                caseRow.case_number || ""
              }`,

            photos
          },
          client,
          companyId
        );

    await addActivity(
      caseRow.id,
      "claim_invoice_created",
      `Claim invoice ${result.invoiceNumber} created for ${formatMoney(
        claimAmount
      )}.`,
      null,
      null,
      {
        invoice_id:
          result.invoiceId,
        invoice_number:
          result.invoiceNumber,
        amount:
          claimAmount
      }
    );

    selectedCaseId =
      caseRow.id;

    await loadCases();

    activeDetailTab =
      "resolution";

    await renderSelectedCase();

    showToast(
      `Claim invoice ${result.invoiceNumber} created.`,
      "ok"
    );

  } catch (error) {
    console.error(
      "[Quality] claim invoice creation failed:",
      error
    );

    showToast(
      error.message ||
      "Claim invoice could not be created.",
      "err"
    );
  }
}

async function renderDetailTab() {
  const caseRow =
    getSelectedCase();

  const container =
    byId(
      "qualityDetailTabContent"
    );

  if (!caseRow || !container) {
    return;
  }


  // =========================================================
  // DETAILS
  // =========================================================

  if (
    activeDetailTab ===
    "details"
  ) {
    container.innerHTML = `
      <section class="quality-detail-section">

        <h3>
          Issue Description
        </h3>

        <p class="quality-description">
          ${escapeHtml(
            caseRow.description ||
            "No description recorded."
          )}
        </p>

      </section>


      <div class="quality-detail-metrics">

        <div class="quality-detail-metric">
          <span>
            Discovered At
          </span>

          <strong>
            ${escapeHtml(
              caseRow.discovered_at ||
              "—"
            )}
          </strong>
        </div>


        <div class="quality-detail-metric">
          <span>
            Priority
          </span>

          <strong>
            ${escapeHtml(
              PRIORITY_LABELS[
                caseRow.priority
              ] ||
              caseRow.priority ||
              "—"
            )}
          </strong>
        </div>


        <div class="quality-detail-metric">
          <span>
            Expected Resolution
          </span>

          <strong>
            ${escapeHtml(
              RESOLUTION_LABELS[
                caseRow.resolution_type
              ] ||
              "Not decided yet"
            )}
          </strong>
        </div>


        <div class="quality-detail-metric">
          <span>
            Carrier Reference
          </span>

          <strong>
            ${escapeHtml(
              caseRow.carrier_claim_reference ||
              "—"
            )}
          </strong>
        </div>


        <div class="quality-detail-metric">
          <span>
            Customer Reference
          </span>

          <strong>
            ${escapeHtml(
              caseRow.customer_claim_reference ||
              "—"
            )}
          </strong>
        </div>


        <div class="quality-detail-metric">
          <span>
            External Reference
          </span>

          <strong>
            ${escapeHtml(
              caseRow.external_reference ||
              "—"
            )}
          </strong>
        </div>

      </div>
    `;

    return;
  }


  // =========================================================
  // PRODUCTS
  // =========================================================

  if (
    activeDetailTab ===
    "products"
  ) {
    const products =
      getCaseProducts(
        caseRow
      );

const pendingServiceItems =
  (
    caseRow
      .quality_case_replacement_items ||
    []
  ).filter(item =>
    normalize(item.status) === "pending"
  );

    if (!products.length) {
      container.innerHTML = `
        <p class="quality-description">
          No products linked to this case.
        </p>
      `;

      return;
    }


    container.innerHTML =
      products
        .map(product => {

          const quantity =
            Math.max(
              1,
              toNumber(
                product.quantity,
                1
              )
            );

          const affected =
            Math.max(
              0,
              toNumber(
                product.affected_quantity,
                0
              )
            );

          const isDamaged =
            affected > 0;

          const replacementItems =
            Array.isArray(
              product.replacement_items
            )
              ? product.replacement_items
              : [];

          const borderColour =
            isDamaged
              ? "#fecaca"
              : "#bbf7d0";

          const backgroundColour =
            isDamaged
              ? "#fef2f2"
              : "#ecfdf5";

          const statusColour =
            isDamaged
              ? "#b91c1c"
              : "#047857";

          const statusText =
            isDamaged
              ? "DAMAGED / INCORRECT"
              : "CORRECT";


          const replacementItemsHtml =
            replacementItems.length
              ? replacementItems
                  .map(item => {

                    const ordered =
                      normalize(
                        item.status
                      ) ===
                      "ordered";

                    return `
                      <div
                        style="
                          display:grid;
                          grid-template-columns:
                            minmax(0,1fr)
                            auto
                            auto;
                          gap:10px;
                          align-items:center;
                          padding:10px 0;
                          border-bottom:1px solid #e2e8f0;
                        "
                      >

                        <div>
                          <strong
                            style="
                              display:block;
                              color:#07152f;
                              font-size:11px;
                            "
                          >
                            ${escapeHtml(
                              item.description ||
                              "Replacement item"
                            )}
                          </strong>

                          <span
                            style="
                              display:block;
                              margin-top:3px;
                              color:#64748b;
                              font-size:9px;
                              font-weight:800;
                            "
                          >
                            ${
                              ordered
                                ? "Added to replacement order"
                                : "Pending replacement order"
                            }
                          </span>
                        </div>


                        <div
                          style="
                            white-space:nowrap;
                            color:#475569;
                            font-size:10px;
                            font-weight:900;
                          "
                        >
                          Qty
                          ${escapeHtml(
                            item.quantity || 1
                          )}
                        </div>


                        ${
                          ordered
                            ? `
                              <span
                                style="
                                  padding:5px 8px;
                                  border-radius:999px;
                                  background:#ecfdf5;
                                  border:1px solid #bbf7d0;
                                  color:#047857;
                                  font-size:9px;
                                  font-weight:950;
                                "
                              >
                                ORDERED
                              </span>
                            `
                            : `
                              <button
                                type="button"
                                class="btn"
                                data-quality-delete-replacement-item="${escapeHtml(
                                  item.id
                                )}"
                                style="
                                  min-height:30px;
                                  padding:0 9px;
                                  color:#b91c1c;
                                "
                              >
                                Remove
                              </button>
                            `
                        }

                      </div>
                    `;
                  })
                  .join("")
              : `
                <div
                  style="
                    padding:12px;
                    border:1px dashed #cbd5e1;
                    border-radius:10px;
                    background:#fff;
                    color:#64748b;
                    font-size:10px;
                    text-align:center;
                  "
                >
                  No replacement parts or goods added yet.
                </div>
              `;


          return `
            <section
              class="quality-detail-metric"
              style="
                margin-bottom:14px;
                border-color:${borderColour};
                background:${backgroundColour};
              "
            >

              <div
                style="
                  display:flex;
                  justify-content:space-between;
                  gap:14px;
                  align-items:flex-start;
                "
              >

                <div style="min-width:0;">

                  <span>
                    ${escapeHtml(
                      product.sku_base ||
                      "Product"
                    )}
                  </span>

                  <strong
                    style="
                      margin-top:4px;
                      display:block;
                    "
                  >
                    ${escapeHtml(
                      product.description ||
                      "—"
                    )}
                  </strong>

                </div>


                <span
                  style="
                    flex:0 0 auto;
                    padding:5px 9px;
                    border-radius:999px;
                    background:#fff;
                    border:1px solid ${borderColour};
                    color:${statusColour};
                    font-size:9px;
                    font-weight:950;
                    white-space:nowrap;
                  "
                >
                  ${statusText}
                </span>

              </div>


              <div
                style="
                  margin-top:9px;
                  color:#64748b;
                  font-size:10px;
                  font-weight:850;
                "
              >
                Quantity:
                ${escapeHtml(quantity)}

                · Affected:
                ${escapeHtml(affected)}
              </div>


              <div
                style="
                  margin-top:11px;
                  display:flex;
                  gap:8px;
                  flex-wrap:wrap;
                "
              >

                <button
                  type="button"
                  class="btn"
                  data-quality-product-correct="${escapeHtml(
                    product.id
                  )}"
                  style="
                    ${
                      !isDamaged
                        ? `
                          border-color:#86efac;
                          background:#dcfce7;
                          color:#166534;
                        `
                        : ""
                    }
                  "
                >
                  ✓ Correct
                </button>


                <button
                  type="button"
                  class="btn"
                  data-quality-product-damaged="${escapeHtml(
                    product.id
                  )}"
                  style="
                    ${
                      isDamaged
                        ? `
                          border-color:#fca5a5;
                          background:#fee2e2;
                          color:#991b1b;
                        `
                        : ""
                    }
                  "
                >
                  ✕ Damaged
                </button>

              </div>


              ${
                isDamaged
                  ? `
                    <div
                      style="
                        margin-top:14px;
                        padding-top:12px;
                        border-top:1px solid ${borderColour};
                      "
                    >

                      <label
                        style="
                          display:block;
                          margin-bottom:6px;
                          color:#7f1d1d;
                          font-size:10px;
                          font-weight:950;
                        "
                      >
                        Damage details
                      </label>


                      <textarea
                        class="textarea"
                        data-quality-product-damage-note="${escapeHtml(
                          product.id
                        )}"
                        placeholder="Describe what is damaged, missing or incorrect..."
                        style="
                          min-height:80px;
                          background:#fff;
                        "
                      >${escapeHtml(
                        product.notes || ""
                      )}</textarea>


                      <div
                        style="
                          margin-top:8px;
                          display:flex;
                          justify-content:flex-end;
                        "
                      >

                        <button
                          type="button"
                          class="btn"
                          data-quality-save-damage-note="${escapeHtml(
                            product.id
                          )}"
                        >
                          Save damage details
                        </button>

                      </div>

                    </div>


                    <div
                      style="
                        margin-top:16px;
                        padding:14px;
                        background:#fff;
                        border:1px solid #e2e8f0;
                        border-radius:12px;
                      "
                    >

                      <div
                        style="
                          display:flex;
                          align-items:center;
                          justify-content:space-between;
                          gap:12px;
                          margin-bottom:10px;
                        "
                      >

                        <div>
                          <div
                            style="
                              color:#07152f;
                              font-size:11px;
                              font-weight:950;
                            "
                          >
                            Parts / goods to deliver
                          </div>

                          <div
                            style="
                              margin-top:2px;
                              color:#64748b;
                              font-size:9px;
                            "
                          >
                            Add only the items that actually need to be delivered.
                          </div>
                        </div>


<div
  style="
    display:flex;
    gap:8px;
    align-items:center;
    flex-wrap:wrap;
  "
>
  ${
    replacementItems.some(
      item => normalize(item.status) === "pending"
    )
      ? `
        <button
          type="button"
          class="btn btn-primary"
          data-quality-create-service-order
        >
          Create Service Order
        </button>
      `
      : ""
  }

  <button
    type="button"
    class="btn"
    data-quality-add-replacement-item="${escapeHtml(
      product.id
    )}"
  >
    + Add item
  </button>
</div>

                      </div>


                      <div>
                        ${replacementItemsHtml}
                      </div>

                    </div>
                  `
                  : ""
              }

            </section>
          `;
        })

    // =======================================================
    // CORRECT
    // =======================================================

    container
      .querySelectorAll(
        "[data-quality-product-correct]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          async () => {

            await setProductQualityStatus(
              button.dataset
                .qualityProductCorrect,
              false
            );

          }
        );

      });


    // =======================================================
    // DAMAGED
    // =======================================================

    container
      .querySelectorAll(
        "[data-quality-product-damaged]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          async () => {

            await setProductQualityStatus(
              button.dataset
                .qualityProductDamaged,
              true
            );

          }
        );

      });


    // =======================================================
    // SAVE DAMAGE DETAILS
    // =======================================================

    container
      .querySelectorAll(
        "[data-quality-save-damage-note]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          async () => {

            const productId =
              button.dataset
                .qualitySaveDamageNote;

            const textarea =
              container.querySelector(
                `[data-quality-product-damage-note="${CSS.escape(
                  productId
                )}"]`
              );

            await saveProductDamageNote(
              productId,
              textarea?.value || ""
            );

          }
        );

      });


    // =======================================================
    // ADD REPLACEMENT ITEM
    // =======================================================

    container
      .querySelectorAll(
        "[data-quality-add-replacement-item]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          async () => {

            await addReplacementItem(
              button.dataset
                .qualityAddReplacementItem
            );

          }
        );

      });


    // =======================================================
    // DELETE REPLACEMENT ITEM
    // =======================================================

    container
      .querySelectorAll(
        "[data-quality-delete-replacement-item]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          async () => {

            await deleteReplacementItem(
              button.dataset
                .qualityDeleteReplacementItem
            );

          }
        );

      });

// =======================================================
// CREATE SERVICE ORDER
// =======================================================

container
  .querySelector(
    "[data-quality-create-service-order]"
  )
  ?.addEventListener(
    "click",
    async event => {
      const button =
        event.currentTarget;

      button.disabled = true;

      const originalText =
        button.textContent;

      button.textContent =
        "Creating...";

      try {
        await createServiceOrder();
      } finally {
        if (
          document.body.contains(
            button
          )
        ) {
          button.disabled = false;
          button.textContent =
            originalText;
        }
      }
    }
  );


    return;
  }


  // =========================================================
  // ACTIVITY / NOTES
  // =========================================================

  if (
    activeDetailTab ===
      "activity" ||
    activeDetailTab ===
      "notes"
  ) {
    let activities =
      caseRow
        .quality_case_activity ||
      [];


    if (
      activeDetailTab ===
      "notes"
    ) {
      activities =
        activities.filter(
          row =>
            normalize(
              row.activity_type
            ) ===
            "note_added"
        );
    }


    container.innerHTML =
      activities.length
        ? activities
            .map(activity => `
              <section
                class="quality-detail-metric"
                style="margin-bottom:8px;"
              >

                <span>
                  ${escapeHtml(
                    formatDateTime(
                      activity.created_at
                    )
                  )}
                </span>

                <strong>
                  ${escapeHtml(
                    activity.description ||
                    activity.activity_type ||
                    "Activity"
                  )}
                </strong>

              </section>
            `)
            .join("")
        : `
          <p class="quality-description">
            No ${
              activeDetailTab ===
                "notes"
                ? "notes"
                : "activity"
            } recorded yet.
          </p>
        `;


    return;
  }


  // =========================================================
  // RESOLUTION
  // =========================================================

if (
  activeDetailTab ===
  "resolution"
) {
  container.innerHTML = `
    <section class="quality-detail-section">

      <h3>
        Resolution
      </h3>

      <div class="quality-detail-metrics">

        <div class="quality-detail-metric">
          <span>
            Resolution Type
          </span>

          <strong>
            ${escapeHtml(
              RESOLUTION_LABELS[
                caseRow.resolution_type
              ] ||
              "Not decided yet"
            )}
          </strong>
        </div>

        <div class="quality-detail-metric">
          <span>
            Status
          </span>

          <strong>
            ${escapeHtml(
              STATUS_LABELS[
                caseRow.status
              ] ||
              caseRow.status ||
              "—"
            )}
          </strong>
        </div>

        <div class="quality-detail-metric">
          <span>
            Resolved At
          </span>

          <strong>
            ${escapeHtml(
              formatDateTime(
                caseRow.resolved_at
              )
            )}
          </strong>
        </div>

      </div>

      <p
        class="quality-description"
        style="margin-top:14px;"
      >
        ${escapeHtml(
          caseRow.resolution_notes ||
          "No resolution notes recorded."
        )}
      </p>


      <div
        style="
          margin-top:18px;
          padding-top:16px;
          border-top:1px solid #e2e8f0;
        "
      >
        <h3 style="margin-bottom:12px;">
          Claim Recovery
        </h3>

        <div class="quality-detail-metrics">

          <div class="quality-detail-metric">
            <span>
              Responsible Party
            </span>

            <strong>
              ${escapeHtml(
                RESPONSIBILITY_LABELS[
                  caseRow.responsibility
                ] ||
                caseRow.responsibility ||
                "—"
              )}
            </strong>
          </div>

          <div class="quality-detail-metric">
            <span>
              Carrier
            </span>

            <strong>
              ${escapeHtml(
                caseRow.carrier_name ||
                "—"
              )}
            </strong>
          </div>

          <div class="quality-detail-metric">
            <span>
              Claim Value
            </span>

            <strong>
              ${formatMoney(
                caseRow.claim_value_gbp
              )}
            </strong>
          </div>

          <div class="quality-detail-metric">
            <span>
              Invoice Status
            </span>

            <strong>
              ${
                caseRow.claim_invoice_id
                  ? "INVOICED"
                  : "NOT INVOICED"
              }
            </strong>
          </div>

        </div>

        <div
          style="
            margin-top:14px;
            display:flex;
            gap:10px;
            flex-wrap:wrap;
            align-items:center;
          "
        >

          ${
            !caseRow.claim_invoice_id &&
            normalize(
              caseRow.responsibility
            ) === "carrier" &&
            toNumber(
              caseRow.claim_value_gbp,
              0
            ) > 0
              ? `
                <button
                  type="button"
                  class="btn btn-primary"
                  data-quality-create-claim-invoice
                >
                  Create Claim Invoice
                </button>
              `
              : ""
          }

          ${
            caseRow.claim_invoice_id
              ? `
                <span
                  style="
                    padding:7px 10px;
                    border-radius:999px;
                    background:#ecfdf5;
                    border:1px solid #bbf7d0;
                    color:#047857;
                    font-size:10px;
                    font-weight:950;
                  "
                >
                  CLAIM INVOICED
                </span>
              `
              : ""
          }

        </div>

        ${
          caseRow.claim_invoiced_at
            ? `
              <div
                style="
                  margin-top:8px;
                  color:#64748b;
                  font-size:10px;
                "
              >
                Invoice created:
                ${escapeHtml(
                  formatDateTime(
                    caseRow.claim_invoiced_at
                  )
                )}
              </div>
            `
            : ""
        }

      </div>

    </section>
  `;


  container
    .querySelector(
      "[data-quality-create-claim-invoice]"
    )
    ?.addEventListener(
      "click",
      async event => {

        const button =
          event.currentTarget;

        const originalText =
          button.textContent;

        button.disabled = true;

        button.textContent =
          "Creating invoice...";

        try {
          await createClaimInvoice();
        } finally {
          if (
            document.body.contains(
              button
            )
          ) {
            button.disabled = false;
            button.textContent =
              originalText;
          }
        }
      }
    );


  return;
}

  // =========================================================
  // EVIDENCE
  // =========================================================

  if (
    activeDetailTab ===
    "evidence"
  ) {
    await renderEvidenceTab();

    return;
  }
}

  async function signedQualityUrl(
    attachment
  ) {
    if (
      !attachment?.storage_path
    ) {
      return "";
    }

    const bucket =
      attachment.storage_bucket ||
      QUALITY_BUCKET;

    const {
      data,
      error
    } = await client.storage
      .from(bucket)
      .createSignedUrl(
        attachment.storage_path,
        3600
      );

    if (error) {
      console.warn(
        "Signed quality asset URL failed:",
        error.message
      );

      return "";
    }

    return (
      data?.signedUrl || ""
    );
  }


  // =========================================================
  // EVIDENCE
  // =========================================================

  async function getCaseEvidence(
    caseRow
  ) {
    const evidence = [];

    const order =
      orderMap.get(
        String(
          caseRow.order_id
        )
      );

    getPodPhotosForOrder(order)
      .forEach(photo => {
        evidence.push({
          id:
            `pod-${photo.id}`,
          type: "pod",
          fileName:
            photo.file_name ||
            "POD Photo",
          url: photo.file_url,
          mimeType:
            photo.mime_type ||
            "image/jpeg"
        });
      });

    for (
      const attachment of
      caseRow
        .quality_case_attachments ||
      []
    ) {
      const url =
        await signedQualityUrl(
          attachment
        );

      evidence.push({
        id: attachment.id,
        type: "quality",
        attachmentType:
          attachment.attachment_type,
        fileName:
          attachment.file_name,
        url,
        mimeType:
          attachment.mime_type,
        note:
          attachment.note
      });
    }

    return evidence;
  }

  function isImageEvidence(
    item
  ) {
    return normalize(
      item.mimeType
    ).startsWith("image/");
  }

  async function renderPhotoStrip() {
    const caseRow =
      getSelectedCase();

    const grid =
      byId(
        "qualityPhotoGrid"
      );

    if (!caseRow || !grid) {
      return;
    }

    const evidence =
      await getCaseEvidence(
        caseRow
      );

    const images =
      evidence
        .filter(
          isImageEvidence
        )
        .slice(0, 4);

    if (!images.length) {
      grid.innerHTML =
        Array.from(
          { length: 4 },
          () => `
            <div class="quality-photo">
              <div class="quality-photo-empty">
                +
              </div>
            </div>
          `
        ).join("");

      return;
    }

    grid.innerHTML =
      images.map(item => `
        <button
          class="quality-photo"
          type="button"
          data-quality-photo-url="${escapeHtml(
            item.url
          )}"
          style="
            padding:0;
            cursor:pointer;
          "
        >
          <img
            src="${escapeHtml(
              item.url
            )}"
            alt="${escapeHtml(
              item.fileName ||
              "Evidence"
            )}"
          >
        </button>
      `).join("");

    grid
      .querySelectorAll(
        "[data-quality-photo-url]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const url =
              button.dataset
                .qualityPhotoUrl;

            if (url) {
              window.open(
                url,
                "_blank",
                "noopener"
              );
            }
          }
        );
      });
  }

  async function renderEvidenceTab() {
    const caseRow =
      getSelectedCase();

    const container =
      byId(
        "qualityDetailTabContent"
      );

    if (!caseRow || !container) {
      return;
    }

    container.innerHTML = `
      <p class="quality-description">
        Loading evidence...
      </p>
    `;

    const evidence =
      await getCaseEvidence(
        caseRow
      );

    if (!evidence.length) {
      container.innerHTML = `
        <p class="quality-description">
          No evidence has been added yet.
        </p>
      `;

      return;
    }

    container.innerHTML = `
      <div
        style="
          display:grid;
          grid-template-columns:
            repeat(
              3,
              minmax(0,1fr)
            );
          gap:10px;
        "
      >
        ${evidence.map(item => {
          if (
            isImageEvidence(item) &&
            item.url
          ) {
            return `
              <a
                href="${escapeHtml(
                  item.url
                )}"
                target="_blank"
                rel="noopener"
                style="
                  display:block;
                  border:1px solid var(--border);
                  border-radius:12px;
                  overflow:hidden;
                  background:#fff;
                "
              >
                <img
                  src="${escapeHtml(
                    item.url
                  )}"
                  alt="${escapeHtml(
                    item.fileName ||
                    "Evidence"
                  )}"
                  style="
                    width:100%;
                    aspect-ratio:1.3/1;
                    object-fit:cover;
                  "
                >

                <div
                  style="
                    padding:8px;
                    font-size:10px;
                    font-weight:850;
                  "
                >
                  ${escapeHtml(
                    item.fileName ||
                    "Photo"
                  )}
                </div>
              </a>
            `;
          }

          return `
            <a
              href="${escapeHtml(
                item.url || "#"
              )}"
              target="_blank"
              rel="noopener"
              class="quality-detail-metric"
            >
              <span>
                Document
              </span>

              <strong>
                ${escapeHtml(
                  item.fileName ||
                  "Evidence"
                )}
              </strong>
            </a>
          `;
        }).join("")}
      </div>
    `;
  }


  // =========================================================
  // MODAL
  // =========================================================

 function openCaseModal(
  caseRow = null
) {
  const modal =
    byId(
      "qualityCaseModal"
    );

  if (!modal) return;


  modal.classList.add(
    "open"
  );


  byId(
    "qualityCaseId"
  ).value =
    caseRow?.id || "";


  byId(
    "qualityCaseModalTitle"
  ).textContent =
    caseRow
      ? "Edit Damage Case"
      : "New Damage Case";


  byId(
    "btnSaveQualityCase"
  ).textContent =
    caseRow
      ? "Save Changes"
      : "Create Case";


  // =========================================================
  // ORDER / LEGACY
  // =========================================================

  const isLegacy =
    Boolean(
      caseRow &&
      !caseRow.order_id
    );


  const orderSelect =
    byId(
      "qualityOrderSelect"
    );


  if (orderSelect) {
    orderSelect.value =
      isLegacy
        ? "__legacy__"
        : (
            caseRow?.order_id ||
            ""
          );
  }


  const legacyFields =
    byId(
      "qualityLegacyFields"
    );


  if (legacyFields) {
    legacyFields.style.display =
      isLegacy
        ? "block"
        : "none";
  }


  // =========================================================
  // LEGACY VALUES
  // =========================================================

  const legacyOrderNumber =
    byId(
      "qualityLegacyOrderNumber"
    );

  if (legacyOrderNumber) {
    legacyOrderNumber.value =
      isLegacy
        ? (
            caseRow?.order_number ||
            caseRow?.external_reference ||
            ""
          )
        : "";
  }


  const legacyCustomer =
    byId(
      "qualityLegacyCustomer"
    );

  if (legacyCustomer) {
    legacyCustomer.value =
      isLegacy
        ? (
            caseRow?.retailer_name ||
            ""
          )
        : "";
  }


  const legacyProductOwner =
    byId(
      "qualityLegacyProductOwner"
    );

  if (legacyProductOwner) {
    legacyProductOwner.value =
      isLegacy
        ? (
            caseRow?.product_owner_name ||
            ""
          )
        : "";
  }


  const legacyCarrier =
    byId(
      "qualityLegacyCarrier"
    );

  if (legacyCarrier) {
    legacyCarrier.value =
      isLegacy
        ? (
            caseRow?.carrier_name ||
            "FDS"
          )
        : "FDS";
  }


  const legacySku =
    byId(
      "qualityLegacySku"
    );

  const legacyProductDescription =
    byId(
      "qualityLegacyProductDescription"
    );


  const firstCaseProduct =
    caseRow
      ?.quality_case_products
      ?.find(Boolean) ||
    null;


  if (legacySku) {
    legacySku.value =
      isLegacy
        ? (
            firstCaseProduct
              ?.sku_base ||
            ""
          )
        : "";
  }


  if (
    legacyProductDescription
  ) {
    legacyProductDescription.value =
      isLegacy
        ? (
            firstCaseProduct
              ?.description ||
            ""
          )
        : "";
  }


  // =========================================================
  // NORMAL CASE VALUES
  // =========================================================

  byId(
    "qualityIssueType"
  ).value =
    caseRow?.issue_type ||
    "damaged_packaging";


  byId(
    "qualityPriority"
  ).value =
    caseRow?.priority ||
    "normal";


  byId(
    "qualityResponsibility"
  ).value =
    caseRow?.responsibility ||
    "under_review";


  byId(
    "qualityDiscoveredAt"
  ).value =
    caseRow?.discovered_at ||
    "";


  byId(
    "qualityDescription"
  ).value =
    caseRow?.description ||
    "";


  byId(
    "qualityClaimValue"
  ).value =
    toNumber(
      caseRow?.claim_value_gbp,
      0
    );


  byId(
    "qualityResolutionType"
  ).value =
    caseRow?.resolution_type ||
    "";


  byId(
    "qualityCarrierReference"
  ).value =
    caseRow
      ?.carrier_claim_reference ||
    "";


  byId(
    "qualityCustomerReference"
  ).value =
    caseRow
      ?.customer_claim_reference ||
    "";
}

  function closeCaseModal() {
    byId(
      "qualityCaseModal"
    )?.classList.remove(
      "open"
    );
  }


  // =========================================================
  // SAVE CASE
  // =========================================================

async function saveCase() {

  const caseId =
    cleanText(
      byId(
        "qualityCaseId"
      )?.value
    );


  const orderSelection =
    cleanText(
      byId(
        "qualityOrderSelect"
      )?.value
    );


  if (!orderSelection) {
    showToast(
      "Please select an order or choose Legacy / order not in Veynor.",
      "err"
    );

    return;
  }


  const isLegacy =
    orderSelection ===
    "__legacy__";


  let order = null;


  // =========================================================
  // NORMAL VEYNOR ORDER
  // =========================================================

  if (!isLegacy) {

    order =
      orderMap.get(
        String(
          orderSelection
        )
      );


    if (!order) {
      showToast(
        "The selected order could not be found.",
        "err"
      );

      return;
    }

  }


  // =========================================================
  // LEGACY VALUES
  // =========================================================

  const legacyOrderNumber =
    cleanText(
      byId(
        "qualityLegacyOrderNumber"
      )?.value
    );


  const legacyCustomer =
    cleanText(
      byId(
        "qualityLegacyCustomer"
      )?.value
    );


  const legacySku =
    cleanText(
      byId(
        "qualityLegacySku"
      )?.value
    );


  const legacyDescription =
    cleanText(
      byId(
        "qualityLegacyProductDescription"
      )?.value
    );


  const legacyProductOwner =
    cleanText(
      byId(
        "qualityLegacyProductOwner"
      )?.value
    );


  const legacyCarrier =
    cleanText(
      byId(
        "qualityLegacyCarrier"
      )?.value
    ) || "FDS";


  if (
    isLegacy &&
    !legacyOrderNumber
  ) {
    showToast(
      "Enter the original order or reference.",
      "err"
    );

    return;
  }


  // =========================================================
  // QUALITY CASE PAYLOAD
  // =========================================================

  const payload = {

    company_id:
      companyId,


    order_id:
      isLegacy
        ? null
        : order.id,


    customer_id:
      isLegacy
        ? null
        : (
            order.customer_id ||
            null
          ),


    route_id:
      isLegacy
        ? null
        : (
            order.route_id ||
            order.routes?.id ||
            null
          ),


    order_number:
      isLegacy
        ? legacyOrderNumber
        : (
            order.order_number ||
            null
          ),


    external_reference:
      isLegacy
        ? legacyOrderNumber
        : (
            order.external_reference ||
            null
          ),


    product_owner_name:
      isLegacy
        ? (
            legacyProductOwner ||
            null
          )
        : getProductOwnerName(
            order
          ),


    retailer_name:
      isLegacy
        ? (
            legacyCustomer ||
            null
          )
        : getRetailerName(
            order
          ),


    retailer_code:
      isLegacy
        ? null
        : (
            order.retailer_code ||
            null
          ),


    delivery_address:
      isLegacy
        ? null
        : getOrderAddress(
            order
          ),


    delivery_postcode:
      isLegacy
        ? null
        : (
            order.delivery_postcode ||
            null
          ),


    carrier_name:
      isLegacy
        ? legacyCarrier
        : getCarrierName(
            order
          ),


    driver_name:
      isLegacy
        ? null
        : getDriverName(
            order
          ),


    issue_type:
      byId(
        "qualityIssueType"
      ).value,


    priority:
      byId(
        "qualityPriority"
      ).value,


    responsibility:
      byId(
        "qualityResponsibility"
      ).value,


    discovered_at:
      cleanText(
        byId(
          "qualityDiscoveredAt"
        ).value
      ) || null,


    description:
      cleanText(
        byId(
          "qualityDescription"
        ).value
      ) || null,


    claim_value_gbp:
      toNumber(
        byId(
          "qualityClaimValue"
        ).value,
        0
      ),


    resolution_type:
      byId(
        "qualityResolutionType"
      ).value ||
      null,


    carrier_claim_reference:
      cleanText(
        byId(
          "qualityCarrierReference"
        ).value
      ) || null,


    customer_claim_reference:
      cleanText(
        byId(
          "qualityCustomerReference"
        ).value
      ) || null
  };


  try {

    // =========================================================
    // UPDATE EXISTING CASE
    // =========================================================

    if (caseId) {

      const existing =
        allCases.find(
          row =>
            String(row.id) ===
            String(caseId)
        );


      const {
        error
      } = await client
        .from(
          "quality_cases"
        )
        .update(
          payload
        )
        .eq(
          "id",
          caseId
        )
        .eq(
          "company_id",
          companyId
        );


      if (error) {
        throw error;
      }


      // =======================================================
      // LEGACY PRODUCT UPDATE
      // =======================================================

      if (isLegacy) {

        const existingProduct =
          existing
            ?.quality_case_products
            ?.find(Boolean) ||
          null;


        if (
          legacySku ||
          legacyDescription
        ) {

          const productPayload = {

            company_id:
              companyId,

            quality_case_id:
              caseId,

            order_line_id:
              null,

            product_id:
              null,

            sku_base:
              legacySku ||
              "LEGACY",

            description:
              legacyDescription ||
              legacySku ||
              "Legacy product",

            quantity:
              1,

            affected_quantity:
              1
          };


          if (
            existingProduct?.id
          ) {

            const {
              error:
                updateProductError
            } = await client
              .from(
                "quality_case_products"
              )
              .update({
                sku_base:
                  productPayload
                    .sku_base,

                description:
                  productPayload
                    .description,

                quantity:
                  1
              })
              .eq(
                "id",
                existingProduct.id
              )
              .eq(
                "company_id",
                companyId
              );


            if (
              updateProductError
            ) {
              throw updateProductError;
            }

          } else {

            const {
              error:
                insertProductError
            } = await client
              .from(
                "quality_case_products"
              )
              .insert(
                productPayload
              );


            if (
              insertProductError
            ) {
              throw insertProductError;
            }

          }

        }

      }


      await addActivity(
        caseId,
        "case_updated",
        "Quality case updated.",
        existing?.status ||
          null,
        existing?.status ||
          null
      );


      selectedCaseId =
        caseId;


      showToast(
        "Quality case updated."
      );

    }


    // =========================================================
    // CREATE NEW CASE
    // =========================================================

    else {

      payload.status =
        "open";

      payload.reported_by =
        currentProfile.id;

      payload.created_by =
        currentProfile.id;


      const {
        data,
        error
      } = await client
        .from(
          "quality_cases"
        )
        .insert(
          payload
        )
        .select()
        .single();


      if (error) {
        throw error;
      }


      selectedCaseId =
        data.id;


      await addActivity(
        data.id,
        "case_created",
        isLegacy
          ? "Legacy quality case created."
          : "Quality case created.",
        null,
        "open"
      );


      // =======================================================
      // PRODUCT LINK
      // =======================================================

      if (isLegacy) {

        if (
          legacySku ||
          legacyDescription
        ) {

          const {
            error:
              productError
          } = await client
            .from(
              "quality_case_products"
            )
            .insert({

              company_id:
                companyId,

              quality_case_id:
                data.id,

              order_line_id:
                null,

              product_id:
                null,

              sku_base:
                legacySku ||
                "LEGACY",

              description:
                legacyDescription ||
                legacySku ||
                "Legacy product",

              quantity:
                1,

              affected_quantity:
                1
            });


          if (productError) {
            throw productError;
          }

        }

      } else {

        await createInitialProductLinks(
          data.id,
          order
        );

      }


      showToast(
        `${
          data.case_number ||
          "Quality case"
        } created.`
      );

    }


    closeCaseModal();


    await loadCases();


    if (selectedCaseId) {
      await renderSelectedCase();
    }


  } catch (error) {

    console.error(
      "Save quality case failed:",
      error
    );


    showToast(
      error.message ||
      "Could not save quality case.",
      "err"
    );

  }
}

  // =========================================================
  // PRODUCT LINKS
  // =========================================================

  async function createInitialProductLinks(
    caseId,
    order
  ) {
    const lines =
      getOrderLines(order);

    if (!lines.length) {
      return;
    }

    const rows =
      lines.map(line => ({
        company_id:
          companyId,

        quality_case_id:
          caseId,

        order_line_id:
          line.id,

        product_id:
          line.product_id ||
          line.products?.id ||
          null,

        sku_base:
          getLineSku(line),

        description:
          getLineDescription(
            line
          ),

        quantity:
          Math.max(
            1,
            Math.round(
              toNumber(
                line.quantity_ordered,
                1
              )
            )
          ),

        /*
         * De orderproducten worden wel aan
         * het dossier gekoppeld, maar we
         * beweren nog niet automatisch dat
         * alle aantallen beschadigd zijn.
         */
        affected_quantity: 0
      }));

    const {
      error
    } = await client
      .from(
        "quality_case_products"
      )
      .insert(rows);

    if (error) {
      console.warn(
        "Initial product links skipped:",
        error.message
      );
    }
  }


  // =========================================================
  // ACTIVITY
  // =========================================================

  async function addActivity(
    caseId,
    activityType,
    description,
    oldStatus = null,
    newStatus = null,
    payload = null
  ) {
    const {
      error
    } = await client
      .from(
        "quality_case_activity"
      )
      .insert({
        company_id: companyId,
        quality_case_id:
          caseId,
        activity_type:
          activityType,
        description:
          description || null,
        old_status:
          oldStatus,
        new_status:
          newStatus,
        payload:
          payload,
        created_by:
          currentProfile.id
      });

    if (error) {
      console.warn(
        "Quality activity log failed:",
        error.message
      );
    }
  }


  // =========================================================
  // ADD NOTE
  // =========================================================

  async function addNote() {
    const caseRow =
      getSelectedCase();

    if (!caseRow) return;

    const note =
      window.prompt(
        "Add note to this quality case:"
      );

    if (
      !note ||
      !cleanText(note)
    ) {
      return;
    }

    await addActivity(
      caseRow.id,
      "note_added",
      cleanText(note)
    );

    showToast(
      "Note added."
    );

    await loadCases();

    selectedCaseId =
      caseRow.id;

    activeDetailTab =
      "notes";

    await renderSelectedCase();
  }


  // =========================================================
  // UPDATE STATUS
  // =========================================================

  async function updateStatus() {
    const caseRow =
      getSelectedCase();

    if (!caseRow) return;

    const value =
      window.prompt(
        [
          "Enter new status:",
          "",
          "open",
          "in_progress",
          "awaiting_carrier",
          "awaiting_customer",
          "resolved",
          "closed"
        ].join("\n"),
        caseRow.status ||
        "open"
      );

    if (!value) return;

    const newStatus =
      normalize(value);

    const allowed = [
      "open",
      "in_progress",
      "awaiting_carrier",
      "awaiting_customer",
      "resolved",
      "closed"
    ];

    if (
      !allowed.includes(
        newStatus
      )
    ) {
      showToast(
        "Invalid status.",
        "err"
      );

      return;
    }

    const update = {
      status: newStatus,

      resolved_at:
        [
          "resolved",
          "closed"
        ].includes(
          newStatus
        )
          ? new Date()
              .toISOString()
          : null
    };

    const {
      error
    } = await client
      .from(
        "quality_cases"
      )
      .update(update)
      .eq(
        "id",
        caseRow.id
      )
      .eq(
        "company_id",
        companyId
      );

    if (error) {
      showToast(
        error.message,
        "err"
      );

      return;
    }

    await addActivity(
      caseRow.id,
      "status_changed",
      `Status changed from ${
        STATUS_LABELS[
          caseRow.status
        ] ||
        caseRow.status
      } to ${
        STATUS_LABELS[
          newStatus
        ] ||
        newStatus
      }.`,
      caseRow.status,
      newStatus
    );

    selectedCaseId =
      caseRow.id;

    showToast(
      "Status updated."
    );

    await loadCases();

    await renderSelectedCase();
  }


  // =========================================================
  // UPLOAD EVIDENCE
  // =========================================================

  function safeFileName(name) {
    return String(name || "file")
      .replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
  }

  async function uploadEvidence() {
    const caseRow =
      getSelectedCase();

    if (!caseRow) return;

    const input =
      document.createElement(
        "input"
      );

    input.type = "file";
    input.accept =
      "image/*,application/pdf";

    input.addEventListener(
      "change",
      async () => {
        const file =
          input.files?.[0];

        if (!file) return;

        try {
          const path =
            `${companyId}/${caseRow.id}/` +
            `${Date.now()}-${safeFileName(
              file.name
            )}`;

          const {
            error: uploadError
          } = await client.storage
            .from(
              QUALITY_BUCKET
            )
            .upload(
              path,
              file,
              {
                upsert: false
              }
            );

          if (uploadError) {
            throw uploadError;
          }

          let attachmentType =
            "other";

          if (
            file.type.startsWith(
              "image/"
            )
          ) {
            attachmentType =
              "damage_photo";
          }

          const {
            error: insertError
          } = await client
            .from(
              "quality_case_attachments"
            )
            .insert({
              company_id:
                companyId,

              quality_case_id:
                caseRow.id,

              attachment_type:
                attachmentType,

              file_name:
                file.name,

              storage_bucket:
                QUALITY_BUCKET,

              storage_path:
                path,

              mime_type:
                file.type ||
                null,

              file_size:
                file.size ||
                null,

              uploaded_by:
                currentProfile.id
            });

          if (insertError) {
            throw insertError;
          }

          await addActivity(
            caseRow.id,
            "evidence_added",
            `Evidence added: ${file.name}`
          );

          selectedCaseId =
            caseRow.id;

          showToast(
            "Evidence uploaded."
          );

          await loadCases();

          await renderSelectedCase();

        } catch (error) {
          console.error(
            "Evidence upload failed:",
            error
          );

          showToast(
            error.message ||
            "Evidence upload failed.",
            "err"
          );
        }
      }
    );

    input.click();
  }


  // =========================================================
  // RENDER EVERYTHING
  // =========================================================

  function renderAll() {
    populateDynamicFilters();
    renderKpis();
    renderTable();
    renderPagination();

    if (selectedCaseId) {
      renderSelectedCase();
    }
  }


  // =========================================================
  // EVENTS
  // =========================================================

function bindEvents() {

  byId(
    "btnNewQualityCase"
  )?.addEventListener(
    "click",
    () => {
      openCaseModal();
    }
  );


  byId(
    "btnCloseQualityCaseModal"
  )?.addEventListener(
    "click",
    closeCaseModal
  );


  byId(
    "btnCancelQualityCase"
  )?.addEventListener(
    "click",
    closeCaseModal
  );


  byId(
    "qualityCaseModal"
  )?.addEventListener(
    "click",
    event => {

      if (
        event.target.id ===
        "qualityCaseModal"
      ) {
        closeCaseModal();
      }

    }
  );


  // =========================================================
  // ORDER / LEGACY SWITCH
  // =========================================================

  byId(
    "qualityOrderSelect"
  )?.addEventListener(
    "change",
    () => {

      const isLegacy =
        byId(
          "qualityOrderSelect"
        )?.value ===
        "__legacy__";


      const legacyFields =
        byId(
          "qualityLegacyFields"
        );


      if (legacyFields) {
        legacyFields.style.display =
          isLegacy
            ? "block"
            : "none";
      }

    }
  );


  // =========================================================
  // SAVE CASE
  // =========================================================

  byId(
    "btnSaveQualityCase"
  )?.addEventListener(
    "click",
    saveCase
  );


  // =========================================================
  // FILTERS
  // =========================================================

  byId(
    "btnApplyQualityFilters"
  )?.addEventListener(
    "click",
    () => {

      currentPage = 1;

      applyFilters();

      renderAll();

    }
  );


  byId(
    "filterQualitySearch"
  )?.addEventListener(
    "input",
    () => {

      currentPage = 1;

      applyFilters();

      renderAll();

    }
  );


  byId(
    "btnClearQualityFilters"
  )?.addEventListener(
    "click",
    () => {

      [
        "filterQualitySearch",
        "filterQualityStatus",
        "filterQualityIssue",
        "filterQualityCustomer",
        "filterQualityCarrier",
        "filterQualityResponsibility"
      ].forEach(id => {

        const element =
          byId(id);


        if (element) {
          element.value = "";
        }

      });


      activeCaseTab =
        "all";

      currentPage =
        1;


      updateCaseTabs();

      applyFilters();

      renderAll();

    }
  );


  // =========================================================
  // MAIN CASE TABS
  // =========================================================

  document
    .querySelectorAll(
      "[data-quality-tab]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          activeCaseTab =
            button.dataset
              .qualityTab;


          currentPage =
            1;


          updateCaseTabs();

          applyFilters();

          renderAll();

        }
      );

    });


  // =========================================================
  // DETAIL TABS
  // =========================================================

  document
    .querySelectorAll(
      "[data-quality-detail-tab]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        async () => {

          activeDetailTab =
            button.dataset
              .qualityDetailTab;


          updateDetailTabs();


          await renderDetailTab();

        }
      );

    });


  byId(
    "btnCloseQualityDetail"
  )?.addEventListener(
    "click",
    closeCaseDetail
  );


  byId(
    "btnEditQualityCase"
  )?.addEventListener(
    "click",
    () => {

      const caseRow =
        getSelectedCase();


      if (caseRow) {
        openCaseModal(
          caseRow
        );
      }

    }
  );


  byId(
    "btnAddQualityNote"
  )?.addEventListener(
    "click",
    addNote
  );


  byId(
    "btnUpdateQualityStatus"
  )?.addEventListener(
    "click",
    updateStatus
  );


  byId(
    "btnUploadQualityEvidence"
  )?.addEventListener(
    "click",
    uploadEvidence
  );


  byId(
    "btnViewAllQualityPhotos"
  )?.addEventListener(
    "click",
    async () => {

      activeDetailTab =
        "evidence";


      updateDetailTabs();


      await renderDetailTab();

    }
  );
}

  function updateCaseTabs() {
    document
      .querySelectorAll(
        "[data-quality-tab]"
      )
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset
            .qualityTab ===
            activeCaseTab
        );
      });
  }


  // =========================================================
  // INITIALISE
  // =========================================================

async function handleOrderFromUrl() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  const orderId =
    cleanText(
      params.get("order_id")
    );

  /*
   * Quality rechtstreeks geopend:
   * niets automatisch doen.
   */
  if (!orderId) {
    return;
  }

  console.log(
    "[Quality] OCC order received:",
    orderId
  );


  /*
   * Zoek de order in de volledige orderMap.
   */
  const order =
    orderMap.get(
      String(orderId)
    );


  if (!order) {
    console.error(
      "[Quality] OCC order not found:",
      orderId
    );

    showToast(
      "The selected OCC order could not be found.",
      "err"
    );

    return;
  }


  console.log(
    "[Quality] OCC order found:",
    {
      id: order.id,
      orderNumber:
        order.order_number,
      externalReference:
        order.external_reference
    }
  );


  /*
   * Bestaat er al een Quality Case
   * voor deze order?
   */
  const existingCases =
    allCases
      .filter(caseRow =>
        String(
          caseRow.order_id
        ) ===
        String(orderId)
      )
      .sort(
        (a, b) =>
          new Date(
            b.reported_at || 0
          ).getTime() -
          new Date(
            a.reported_at || 0
          ).getTime()
      );


  /*
   * JA:
   * open de nieuwste bestaande case.
   */
  if (existingCases.length) {
    const existingCase =
      existingCases[0];

    selectedCaseId =
      existingCase.id;

    activeCaseTab =
      "all";

    currentPage = 1;

    updateCaseTabs();

    applyFilters();

    renderAll();

    await renderSelectedCase();

    showToast(
      existingCases.length === 1
        ? `${existingCase.case_number} opened for ${order.order_number}.`
        : `${existingCases.length} Quality Cases found for ${order.order_number}. Latest case opened.`,
      "ok"
    );

    return;
  }


  /*
   * NEE:
   * open New Damage Case.
   */
  openCaseModal();


  /*
   * Selecteer automatisch de order
   * waarmee we vanuit OCC kwamen.
   */
  const orderSelect =
    byId(
      "qualityOrderSelect"
    );


  if (orderSelect) {

    /*
     * Controle:
     * staat de OCC-order al als option
     * in de dropdown?
     */
    let option =
      Array.from(
        orderSelect.options
      ).find(
        item =>
          String(item.value) ===
          String(orderId)
      );


    /*
     * Zo niet, voeg hem alsnog toe.
     * Hierdoor is de OCC-koppeling niet
     * afhankelijk van lifecycle-filters.
     */
    if (!option) {
      option =
        document.createElement(
          "option"
        );

      option.value =
        String(order.id);

      const retailer =
        getRetailerName(order);

      const reference =
        cleanText(
          order.external_reference ||
          ""
        );

      option.textContent =
        [
          order.order_number ||
            "Order",
          retailer,
          reference
        ]
          .filter(Boolean)
          .join(" · ");

      orderSelect.appendChild(
        option
      );
    }


    orderSelect.value =
      String(orderId);


    orderSelect.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );
  }


  showToast(
    `New Quality Case for ${order.order_number || "selected order"}.`,
    "ok"
  );
}

async function init() {
  try {
    ensureClient();

    await loadCurrentProfile();

    bindEvents();

    await loadOrders();

    populateOrderSelect();

    await loadCases();

    await handleOrderFromUrl();

    console.log(
      "[Quality] loaded",
      {
        cases:
          allCases.length,

        orders:
          allOrders.length,

        orderFromOcc:
          new URLSearchParams(
            window.location.search
          ).get("order_id")
      }
    );

  } catch (error) {
    console.error(
      "[Quality] INIT FAILED:",
      error
    );

    showToast(
      error.message ||
      "Quality module could not be loaded.",
      "err"
    );
  }
}


document.addEventListener(
  "DOMContentLoaded",
  init
);

})();