(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const GEOCODE_FUNCTION_NAME = "super-endpoint";
  const CANCELLED_ALLOCATION_STATUS = "cancelled";

  let client = null;
  let companyId = null;
  let allOrders = [];
  let filteredOrders = [];
  let openedOrderId = null;
  let memoOrderId = null;

  const selectedOrderIds = new Set();

  const sortState = {
    key: "order",
    direction: "asc"
  };

  /* =========================================================
   * GENERAL HELPERS
   * ======================================================= */

  function byId(id) {
    return document.getElementById(id);
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number(
      String(value ?? "")
        .trim()
        .replace(",", ".")
    );

    return Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  function round3(value) {
    return Number(
      toNumber(value, 0).toFixed(3)
    );
  }

  function nowIso() {
    return new Date().toISOString();
  }

function addDaysToDate(
  value,
  daysToAdd = 1
) {
  if (!value) {
    return null;
  }

  const dateText =
    String(value).slice(0, 10);

  const date = new Date(
    `${dateText}T12:00:00`
  );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  date.setDate(
    date.getDate() +
    daysToAdd
  );

  return date
    .toISOString()
    .slice(0, 10);
}

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char])
    );
  }

function formatNumber(value, digits = 0) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return number.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatMoney(value) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
      return "£0.00";
    }

    return `£${number.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString("en-GB");
  }

  function titleCase(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(
        /\b\w/g,
        character => character.toUpperCase()
      );
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent = value;
    }
  }

  function showToast(message, type = "ok") {
    const element = byId("toast");

    if (!element) {
      return;
    }

    element.textContent = message || "";
    element.className = `notice ${type}`;

    window.clearTimeout(
      window.__orderMatchingToastTimer
    );

    window.__orderMatchingToastTimer =
      window.setTimeout(() => {
        element.textContent = "";
        element.className = "notice";
      }, 6500);
  }

  function setProgress(
    open,
    percentage = 0,
    message = ""
  ) {
    const wrapper = byId("progressWrap");
    const bar = byId("progressBar");
    const text = byId("progressText");

    if (wrapper) {
      wrapper.classList.toggle(
        "open",
        Boolean(open)
      );
    }

    if (bar) {
      bar.style.width =
        `${Math.max(
          0,
          Math.min(100, percentage)
        )}%`;
    }

    if (text) {
      text.textContent = message || "";
    }
  }

  function pill(text, className = "") {
    return `
      <span class="pill ${className}">
        ${escapeHtml(text)}
      </span>
    `;
  }

  /* =========================================================
   * COMPANY / ADDRESS
   * ======================================================= */

  async function getCompanyId() {
    if (companyId) {
      return companyId;
    }

    const { data, error } = await client
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

    companyId = data.id;
    return companyId;
  }

  function hasCoordinates(order) {
    const latitude = Number(
      order?.delivery_lat
    );

    const longitude = Number(
      order?.delivery_lng
    );

    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= 49 &&
      latitude <= 61 &&
      longitude >= -9 &&
      longitude <= 3
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
    ]
      .filter(Boolean)
      .join(", ") || "—";
  }

  /* =========================================================
   * ORDER / LINE HELPERS
   * ======================================================= */

  function getMemo(order) {
    return String(
      order?.memo || ""
    ).trim();
  }

function isCollectionOrder(order) {
  return (
    normalize(order?.movement_type) ===
    "collection"
  );
}

function isServiceOrder(order) {
  const orderNumber =
    String(
      order?.order_number || ""
    )
      .trim()
      .toUpperCase();

  return (
    normalize(order?.order_type) === "service" ||
    /^SO-\d+S(?:\d+)?$/.test(orderNumber)
  );
}

  function shortMemo(
    value,
    maximumLength = 70
  ) {
    const text = String(
      value || ""
    ).trim();

    if (!text) {
      return "";
    }

    return text.length > maximumLength
      ? `${text.slice(0, maximumLength)}...`
      : text;
  }

  function getLineSku(line) {
    return String(
      line?.sku_base ||
      line?.products?.sku_base ||
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

  function isMiscellaneousLine(line) {
    return (
      normalize(getLineSku(line)) ===
      "miscellaneous"
    );
  }

  function getActiveAllocations(line) {
    return (
      line?.order_allocations || []
    ).filter(allocation =>
      normalize(
        allocation?.allocation_status
      ) !== CANCELLED_ALLOCATION_STATUS
    );
  }

  function getAllocationKey(allocation) {
    return String(
      allocation?.items
        ?.physical_product_id ||
      allocation?.stock_set_id ||
      allocation?.item_id ||
      allocation?.id ||
      ""
    );
  }

  function getUniqueAllocations(line) {
    const allocations = new Map();

    getActiveAllocations(line)
      .forEach(allocation => {
        const key =
          getAllocationKey(allocation);

        if (
          key &&
          !allocations.has(key)
        ) {
          allocations.set(
            key,
            allocation
          );
        }
      });

    return [
      ...allocations.values()
    ];
  }

function getActiveExpectedAllocations(line) {
  return (
    line?.inbound_expected_allocations || []
  ).filter(allocation =>
    normalize(allocation?.status) === "expected"
  );
}

function getExpectedQuantity(line) {
  return getActiveExpectedAllocations(line)
    .reduce(
      (total, allocation) =>
        total +
        Math.max(
          0,
          toNumber(
            allocation.expected_quantity,
            0
          )
        ),
      0
    );
}

function getExpectedCompleteDate(line) {
  const dates =
    getActiveExpectedAllocations(line)
      .map(allocation =>
        allocation
          ?.inbound_containers
          ?.eta_warehouse_date ||
        null
      )
      .filter(Boolean)
      .sort();

  return dates.length
    ? dates.at(-1)
    : line?.expected_complete_date ||
      null;
}

  function getOrderCosts(order) {
    const lineTotals = (
      order?.order_lines || []
    ).reduce(
      (totals, line) => {
        totals.storage += toNumber(
          line.tariff_storage,
          0
        );

        totals.admin += toNumber(
          line.tariff_admin,
          0
        );

        totals.handling += toNumber(
          line.tariff_handling,
          0
        );

        totals.transport += toNumber(
          line.tariff_transport,
          0
        );

        totals.s2u += toNumber(
          line.total_s2u_fees,
          0
        );

        totals.customer += toNumber(
          line.total_customer_charge,
          0
        );

        return totals;
      },
      {
        storage: 0,
        admin: 0,
        handling: 0,
        transport: 0,
        s2u: 0,
        customer: 0
      }
    );

    return {
      storage: toNumber(
        order?.total_storage_tariff,
        lineTotals.storage
      ),

      admin: toNumber(
        order?.total_admin_tariff,
        lineTotals.admin
      ),

      handling: toNumber(
        order?.total_handling_tariff,
        lineTotals.handling
      ),

      transport: toNumber(
        order?.total_transport_tariff,
        lineTotals.transport
      ),

      s2u: toNumber(
        order?.total_s2u_fees,
        lineTotals.s2u
      ),

      customer: toNumber(
        order?.total_customer_charge,
        lineTotals.customer
      )
    };
  }

  function getTotalVolume(order) {
    return Math.max(
      toNumber(
        order?.total_order_volume_m3,
        0
      ),
      toNumber(
        order?.volume_m3,
        0
      ),
      toNumber(
        order?.stats?.requestedVolume,
        0
      )
    );
  }

  function getMatchedVolume(order) {
    return Math.max(
      toNumber(
        order?.matched_volume_m3,
        0
      ),
      toNumber(
        order?.stats?.allocatedVolume,
        0
      )
    );
  }

  function getTotalWeight(order) {
    return Math.max(
      toNumber(
        order?.total_order_weight_kg,
        0
      ),
      toNumber(
        order?.weight_kg,
        0
      ),
      toNumber(
        order?.stats?.requestedWeight,
        0
      )
    );
  }

  function getMatchedWeight(order) {
    return Math.max(
      toNumber(
        order?.matched_weight_kg,
        0
      ),
      toNumber(
        order?.stats?.allocatedWeight,
        0
      )
    );
  }

function getPlanningColli(order) {

  /*
   * Serviceorders bestaan uit manual lines
   * en hoeven niet door stock matching.
   *
   * Iedere quantity telt daarom als
   * één planning package.
   */
  if (isServiceOrder(order)) {
    return (
      order?.order_lines || []
    ).reduce(
      (total, line) =>
        total +
        Math.max(
          0,
          Math.round(
            toNumber(
              line.quantity_ordered,
              0
            )
          )
        ),
      0
    );
  }

  return Math.max(
    toNumber(
      order?.stats?.matchedPackages,
      0
    ),
    toNumber(
      order?.planning_colli,
      0
    ),
    toNumber(
      order?.stats?.matched,
      0
    )
  );
}

  /* =========================================================
   * CENTRAL MATCHING SUMMARY
   * ======================================================= */

function buildUiStats(order) {
  if (
    !window.AllocationEngine
      ?.calculateOrderSummary
  ) {
    throw new Error(
      "AllocationEngine.calculateOrderSummary is not available."
    );
  }

  const summary =
    window.AllocationEngine
      .calculateOrderSummary(order);

  const orderLines =
    Array.isArray(order.order_lines)
      ? order.order_lines
      : [];

  const lineSummaryMap =
    new Map(
      (
        summary.lines || []
      ).map(row => [
        String(row.order_line_id),
        row
      ])
    );

  const packageSummaryMap =
    new Map(
      (
        summary.package_lines || []
      ).map(row => [
        String(row.order_line_id),
        row
      ])
    );

  const lines = orderLines
    .filter(
      line =>
        normalize(line.line_type) !==
        "manual"
    )
    .map(line => {
      const lineSummary =
        lineSummaryMap.get(
          String(line.id)
        ) || {};

      const packageSummary =
        packageSummaryMap.get(
          String(line.id)
        ) || {};

      const product =
        line.products || {};

      const allocations =
        getActiveAllocations(line);

      const uniqueAllocations =
        getUniqueAllocations(line);

      const expectedAllocations =
        getActiveExpectedAllocations(line);

      const quantity =
        toNumber(
          line.quantity_ordered,
          0
        );

      const miscellaneous =
        isMiscellaneousLine(line);

      const allocatedProducts =
        toNumber(
          lineSummary.allocated,
          miscellaneous
            ? quantity
            : uniqueAllocations.length
        );

      const expectedProducts =
        toNumber(
          lineSummary.expected_allocated,
          getExpectedQuantity(line)
        );

      const combinedProducts =
        toNumber(
          lineSummary.combined_allocated,
          allocatedProducts +
          expectedProducts
        );

      const allocatedPackages =
        toNumber(
          packageSummary.matchedPackages,
          lineSummary.allocated_colli ??
          (
            miscellaneous
              ? quantity
              : 0
          )
        );

      const expectedPackages =
        toNumber(
          lineSummary.expected_colli,
          line.expected_packages_allocated
        );

      const combinedPackages =
        allocatedPackages +
        expectedPackages;

      const physicalMissing =
        toNumber(
          lineSummary.missing,
          Math.max(
            0,
            quantity -
            allocatedProducts
          )
        );

      const combinedMissing =
        toNumber(
          lineSummary.combined_missing,
          Math.max(
            0,
            quantity -
            combinedProducts
          )
        );

      return {
        line,
        product,

        sku:
          getLineSku(line),

        description:
          getLineDescription(line),

        qty:
          quantity,

        allocs:
          allocations,

        uniqueAllocs:
          uniqueAllocations,

        expectedAllocs:
          expectedAllocations,

        allocCount:
          allocatedProducts,

        expectedCount:
          expectedProducts,

        combinedCount:
          combinedProducts,

        matchedColli:
          allocatedPackages,

        expectedColli:
          expectedPackages,

        combinedColli:
          combinedPackages,

        physicalMissing,

        missing:
          combinedMissing,

        expectedDate:
          lineSummary
            .expected_complete_date ||
          getExpectedCompleteDate(line),

        requestedVolume:
          toNumber(
            lineSummary
              .requested_volume_m3,
            0
          ),

        requestedWeight:
          toNumber(
            lineSummary
              .requested_weight_kg,
            0
          ),

        allocatedVolume:
          toNumber(
            lineSummary
              .allocated_volume_m3,
            0
          ),

        allocatedWeight:
          toNumber(
            lineSummary
              .allocated_weight_kg,
            0
          ),

        expectedVolume:
          toNumber(
            lineSummary
              .expected_volume_m3,
            line.expected_volume_m3
          ),

        expectedWeight:
          toNumber(
            lineSummary
              .expected_weight_kg,
            line.expected_weight_kg
          ),

        isMiscellaneous:
          miscellaneous,

        costs: {
          storage: toNumber(
            line.tariff_storage,
            0
          ),

          admin: toNumber(
            line.tariff_admin,
            0
          ),

          handling: toNumber(
            line.tariff_handling,
            0
          ),

          transport: toNumber(
            line.tariff_transport,
            0
          ),

          s2u: toNumber(
            line.total_s2u_fees,
            0
          ),

          customer: toNumber(
            line.total_customer_charge,
            0
          )
        }
      };
    });

  const physicalMatched =
    toNumber(
      summary.total_allocated,
      0
    );

  const expectedMatched =
    toNumber(
      summary.total_expected_allocated,
      order.expected_allocated_quantity
    );

  const combinedMatched =
    toNumber(
      summary.total_combined_allocated,
      physicalMatched +
      expectedMatched
    );

  const physicalPackages =
    toNumber(
      summary.total_allocated_colli,
      summary.matched_packages
    );

  const expectedPackages =
    toNumber(
      summary.total_expected_colli,
      order.expected_allocated_packages
    );

  const combinedPackages =
    toNumber(
      summary.combined_packages,
      physicalPackages +
      expectedPackages
    );

  const expectedMatchStatus =
    summary.expected_match_status ||
    order.expected_match_status ||
    "none";

  const isExpectedComplete =
    Boolean(
      summary.is_expected_complete ||
      order.is_expected_complete ||
      expectedMatchStatus === "full"
    );

  return {
    required: toNumber(
      summary.total_required,
      0
    ),

    physicalMatched,

    expectedMatched,

    matched:
      combinedMatched,

    physicalMissing: toNumber(
      summary.total_missing,
      0
    ),

    missing: toNumber(
      summary.total_combined_missing,
      Math.max(
        0,
        toNumber(
          summary.total_required,
          0
        ) -
        combinedMatched
      )
    ),

    requiredPackages: toNumber(
      summary.required_packages,
      0
    ),

    physicalMatchedPackages:
      physicalPackages,

    expectedPackages,

    matchedPackages:
      combinedPackages,

    missingPackages:
      Math.max(
        0,
        toNumber(
          summary.required_packages,
          0
        ) -
        combinedPackages
      ),

    missingProductLines: toNumber(
      summary.missing_product_lines,
      0
    ),

    requestedVolume: toNumber(
      summary.requested_volume_m3,
      0
    ),

    allocatedVolume: toNumber(
      summary.allocated_volume_m3,
      0
    ),

    expectedVolume: toNumber(
      summary.expected_volume_m3,
      order.expected_allocated_volume_m3
    ),

    requestedWeight: toNumber(
      summary.requested_weight_kg,
      0
    ),

    allocatedWeight: toNumber(
      summary.allocated_weight_kg,
      0
    ),

    expectedWeight: toNumber(
      summary.expected_weight_kg,
      order.expected_allocated_weight_kg
    ),

    matchPct: toNumber(
      summary.combined_match_percentage,
      summary.match_percentage
    ),

    matchStatus:
      summary.match_status ||
      "none",

    expectedMatchStatus,

    isFullyMatched:
      summary.match_status ===
      "full",

    isExpectedComplete,

    expectedCompleteDate:
      summary.expected_complete_date ||
      order.expected_complete_date ||
      null,

    readyForPlanning:
      Boolean(
        summary.ready_for_planning
      ),

    blockers:
      Array.isArray(
        summary.blockers
      )
        ? summary.blockers
        : [],

    hasCoordinates:
      Boolean(
        summary.has_coordinates
      ),

    suggestedStatus:
      summary.suggested_status ||
      order.status ||
      "imported",

    lines
  };
}

  function enrichOrder(order) {
    return {
      ...order,

      customer_name:
        order.retail_name ||
        order.customers?.name ||
        order.customer_name ||
        "—",

      ship_to_address:
        getAddressText(order),

      stats:
        buildUiStats(order)
    };
  }

  /* =========================================================
   * LOAD ORDERS
   * ======================================================= */

  async function loadOrders() {
    const cid =
      await getCompanyId();

    setProgress(
      true,
      10,
      "Loading orders..."
    );

    const { data, error } =
      await client
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
            line_type,
            quantity_ordered,
            quantity_allocated,
            quantity_shipped,
            unit_volume_m3,
            unit_weight_kg,
            total_volume_m3,
            total_line_volume_m3,
            total_line_weight_kg,
packages_per_unit,
total_packages,

matched_quantity,
matched_volume_m3,
matched_weight_kg,

expected_quantity_allocated,
expected_packages_allocated,
expected_volume_m3,
expected_weight_kg,
expected_complete_date,

requested_package_no,
requested_package_total,
            requested_package_label,
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
              package_count,
              package_1_qty,
              package_2_qty,
              package_3_qty,
              packages_per_unit,
              sales_units_per_package
            ),
order_allocations (
  id,
  order_line_id,
  item_id,
  stock_set_id,
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
    package_no,
    package_total,
    package_label,
    physical_product_id,
    stock_set_id,
    warehouses (
      id,
      name
    ),
    warehouse_locations (
      id,
      code
    )
  )
),

inbound_expected_allocations (
  id,
  company_id,
  order_id,
  order_line_id,
  container_id,
  container_line_id,
  expected_quantity,
  status,
  converted_allocation_id,
  converted_at,
  created_at,
  inbound_containers (
    id,
    container_number,
    eta_warehouse_date,
    status
  )
)
          )
        `)
        .eq(
          "company_id",
          cid
        )
        .or(
          "planning_release.is.null,planning_release.eq.false"
        )
        .not(
          "status",
          "in",
          '("loaded","delivered","cancelled","export_for_charter")'
        )
.or(
  "transport_type.neq.charter,order_type.eq.service"
)
        .order(
          "requested_delivery_date",
          {
            ascending: true,
            nullsFirst: false
          }
        )
        .order(
          "order_number",
          {
            ascending: true
          }
        );

    if (error) {
      throw error;
    }

    setProgress(
      true,
      65,
      "Calculating matching..."
    );

    allOrders = (
      data || []
    ).map(enrichOrder);

    applyFilters();
    renderAll();

    setProgress(false);
  }

  /* =========================================================
   * FILTERING / SORTING
   * ======================================================= */

  function deriveMatchColor(order) {
    if (
      order.stats.readyForPlanning
    ) {
      return "green";
    }

    if (
      order.stats.isFullyMatched &&
      !hasCoordinates(order)
    ) {
      return "orange";
    }

    if (
      order.stats.matchStatus ===
      "partial"
    ) {
      return "yellow";
    }

    return "red";
  }

  function applyFilters() {
    const search = normalize(
      byId("filterSearch")
        ?.value || ""
    );

    const status = normalize(
      byId("filterStatus")
        ?.value || ""
    );

    const match = normalize(
      byId("filterMatch")
        ?.value || ""
    );

    const geo = normalize(
      byId("filterGeo")
        ?.value || ""
    );

    const release = normalize(
      byId("filterRelease")
        ?.value || ""
    );

    filteredOrders =
      allOrders.filter(order => {
        if (
          status &&
          normalize(order.status) !==
          status
        ) {
          return false;
        }

if (match) {
  if (
    match === "expected_full" &&
    !order.stats.isExpectedComplete
  ) {
    return false;
  }

  if (
    match !== "expected_full" &&
    normalize(
      order.stats.matchStatus
    ) !== match
  ) {
    return false;
  }
}

        if (
          geo === "ok" &&
          !hasCoordinates(order)
        ) {
          return false;
        }

        if (
          geo === "missing" &&
          hasCoordinates(order)
        ) {
          return false;
        }

        if (
          release === "released" &&
          !order.planning_release
        ) {
          return false;
        }

        if (
          release ===
            "not_released" &&
          order.planning_release
        ) {
          return false;
        }

        if (search) {
          const lineText = (
            order.order_lines || []
          )
            .map(line => {
              const product =
                line.products || {};

              return [
                line.sku_base,
                line.description,
                line.product_id,
                product.sku_base,
                product.name,
                product.description
              ].join(" ");
            })
            .join(" ");

          const searchableText = [
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
          ]
            .join(" ")
            .toLowerCase();

          if (
            !searchableText.includes(
              search
            )
          ) {
            return false;
          }
        }

        return true;
      });

    sortFilteredOrders();

    if (
      openedOrderId &&
      !filteredOrders.some(
        order =>
          String(order.id) ===
          String(openedOrderId)
      )
    ) {
      openedOrderId = null;
    }

    setText(
      "resultsMeta",
      `${formatNumber(
        filteredOrders.length
      )} orders shown`
    );
  }

  function sortValue(order, key) {
    const stats =
      order.stats || {};

    switch (key) {
      case "order":
        return normalize(
          order.order_number
        );

      case "customer":
        return normalize(
          order.customer_name
        );

      case "address":
        return normalize(
          order.ship_to_address
        );

      case "lines":
        return (
          order.order_lines || []
        ).length;

      case "matched":
        return toNumber(
          stats.matchedPackages,
          0
        );

      case "volume":
        return getTotalVolume(order);

      case "weight":
        return getTotalWeight(order);

      case "geo":
        return hasCoordinates(order)
          ? 1
          : 0;

      case "match":
        return normalize(
          deriveMatchColor(order)
        );

      case "status":
        return normalize(
          order.status
        );

      case "release":
        return order.planning_release
          ? 1
          : 0;

      case "delivery_date":
        return order
          .requested_delivery_date
          ? new Date(
              order
                .requested_delivery_date
            ).getTime()
          : 0;

      default:
        return normalize(
          order.order_number
        );
    }
  }

  function sortFilteredOrders() {
    const direction =
      sortState.direction === "desc"
        ? -1
        : 1;

    filteredOrders.sort(
      (first, second) => {
        const firstValue =
          sortValue(
            first,
            sortState.key
          );

        const secondValue =
          sortValue(
            second,
            sortState.key
          );

        if (
          typeof firstValue ===
            "number" &&
          typeof secondValue ===
            "number"
        ) {
          return (
            firstValue -
            secondValue
          ) * direction;
        }

        return String(firstValue)
          .localeCompare(
            String(secondValue),
            "en",
            {
              numeric: true,
              sensitivity: "base"
            }
          ) * direction;
      }
    );
  }

  function updateSortIndicators() {
    document
      .querySelectorAll(
        "[data-sort-indicator]"
      )
      .forEach(element => {
        const key =
          element.getAttribute(
            "data-sort-indicator"
          );

        element.textContent =
          key === sortState.key
            ? (
                sortState.direction ===
                  "asc"
                  ? "▲"
                  : "▼"
              )
            : "";
      });
  }

  /* =========================================================
   * PILLS / STATUS
   * ======================================================= */

  function geoPill(order) {
    return hasCoordinates(order)
      ? pill(
          "Geo OK",
          "pill-green"
        )
      : pill(
          "Missing",
          "pill-orange"
        );
  }

  function releasePill(order) {
    return order.planning_release
      ? pill(
          "Released",
          "pill-blue"
        )
      : pill("Not released");
  }

function completenessPill(order) {
  const stats =
    order.stats || {};

  if (stats.readyForPlanning) {
    return pill(
      "Physical complete",
      "pill-green"
    );
  }

  if (stats.isExpectedComplete) {
    return `
      ${pill(
        "Expected complete",
        "pill-blue"
      )}
      <span class="subline">
        Complete from:
        ${escapeHtml(
          formatDate(
            stats.expectedCompleteDate
          )
        )}
      </span>
    `;
  }

  if (
    stats.matchStatus === "partial" ||
    stats.expectedMatchStatus ===
      "partial"
  ) {
    return pill(
      "Partial",
      "pill-orange"
    );
  }

  return pill(
    "Incomplete",
    "pill-red"
  );
}

  function statusPill(order) {
    const status = normalize(
      order.status || "imported"
    );

    if (
      status ===
      "ready_for_planning"
    ) {
      return pill(
        "Ready for planning",
        "pill-orange"
      );
    }

    if (
      status ===
      "ready_for_picking"
    ) {
      return pill(
        "Ready for picking",
        "pill-green"
      );
    }

    if (
      status ===
      "matching_review"
    ) {
      return pill(
        "Matching review",
        "pill-orange"
      );
    }

    if (status === "planned") {
      return pill(
        "Planned",
        "pill-blue"
      );
    }

    if (status === "loaded") {
      return pill(
        "Loaded",
        "pill-blue"
      );
    }

    if (status === "delivered") {
      return pill(
        "Delivered",
        "pill-green"
      );
    }

    return pill(
      order.status ||
      "Imported"
    );
  }

  /* =========================================================
   * KPI / TOTALS
   * ======================================================= */

  function renderKpis() {
    const imported =
      allOrders.filter(order =>
        [
          "imported",
          "matching_review"
        ].includes(
          normalize(order.status)
        )
      ).length;

const fullyMatched =
  allOrders.filter(
    order =>
      order.stats.isFullyMatched ||
      order.stats.isExpectedComplete
  ).length;

    const partial =
      allOrders.filter(
        order =>
          order.stats.matchStatus ===
          "partial"
      ).length;

    const missingProducts =
      allOrders.reduce(
        (total, order) =>
          total +
          toNumber(
            order.stats
              .missingProductLines,
            0
          ),
        0
      );

    const geoMissing =
      allOrders.filter(
        order =>
          !hasCoordinates(order)
      ).length;

const ready =
  allOrders.filter(
    order => {
      const physicallyReady =
        Boolean(
          order.stats
            ?.readyForPlanning
        );

      const expectedReady =
        Boolean(
          order.stats
            ?.isExpectedComplete &&
          order.stats
            ?.expectedCompleteDate &&
          hasCoordinates(order)
        );

      return (
        physicallyReady ||
        expectedReady
      );
    }
  ).length;

    setText(
      "kpiImported",
      formatNumber(imported)
    );

    setText(
      "kpiFullyMatched",
      formatNumber(fullyMatched)
    );

    setText(
      "kpiPartial",
      formatNumber(partial)
    );

    setText(
      "kpiMissingProducts",
      formatNumber(
        missingProducts
      )
    );

    setText(
      "kpiGeoMissing",
      formatNumber(geoMissing)
    );

    setText(
      "kpiReady",
      formatNumber(ready)
    );
  }

  function renderTotals() {
    const totals =
      filteredOrders.reduce(
        (result, order) => {
          const stats =
            order.stats;

          const costs =
            getOrderCosts(order);

          result.orders += 1;

          result.lines += (
            order.order_lines || []
          ).length;

          result.requiredPackages +=
            toNumber(
              stats.requiredPackages,
              0
            );

          result.matchedPackages +=
            toNumber(
              stats.matchedPackages,
              0
            );

          result.totalVolume +=
            getTotalVolume(order);

          result.matchedVolume +=
            getMatchedVolume(order);

          result.totalWeight +=
            getTotalWeight(order);

          result.matchedWeight +=
            getMatchedWeight(order);

          result.customer +=
            costs.customer;

          result.s2u +=
            costs.s2u;

          result.transport +=
            costs.transport;

          return result;
        },
        {
          orders: 0,
          lines: 0,
          requiredPackages: 0,
          matchedPackages: 0,
          totalVolume: 0,
          matchedVolume: 0,
          totalWeight: 0,
          matchedWeight: 0,
          customer: 0,
          s2u: 0,
          transport: 0
        }
      );

    setText(
      "totalOrdersLabel",
      `Totals for ${formatNumber(
        totals.orders
      )} visible order(s)`
    );

    setText(
      "totalLines",
      formatNumber(totals.lines)
    );

    setText(
      "totalMatched",
      `${formatNumber(
        totals.matchedPackages
      )} / ${formatNumber(
        totals.requiredPackages
      )}`
    );

    setText(
      "totalVolume",
      `${formatNumber(
        totals.totalVolume,
        2
      )} m³ total · ${formatNumber(
        totals.matchedVolume,
        2
      )} m³ matched`
    );

    setText(
      "totalWeight",
      `${formatNumber(
        totals.totalWeight,
        2
      )} kg total · ${formatNumber(
        totals.matchedWeight,
        2
      )} kg matched`
    );

    setText(
      "totalExtra",
      `Customer charge ${formatMoney(
        totals.customer
      )} · S2U ${formatMoney(
        totals.s2u
      )} · Transport ${formatMoney(
        totals.transport
      )}`
    );
  }

  /* =========================================================
   * DETAIL LINES
   * ======================================================= */

  function renderAllocationHtml(
    row
  ) {
    if (row.isMiscellaneous) {
      return `
        <div class="line-sub">
          Non-stock item. No physical stock reservation required.
        </div>
      `;
    }

    if (!row.allocs.length) {
      return `
        <div class="line-sub">
          No physical stock reserved yet.
        </div>
      `;
    }

    return row.allocs
      .map(allocation => {
        const item =
          allocation.items || {};

        const warehouse =
          item.warehouses?.name ||
          "—";

        const location =
          item.warehouse_locations
            ?.code ||
          "—";

        return `
          <div class="line-sub">
            Reserved stock:
            <strong>
              ${escapeHtml(
                item.sku_unique ||
                item.storage_mutation_id ||
                item.id ||
                "item"
              )}
            </strong>
            · ${escapeHtml(
              warehouse
            )}
            /
            ${escapeHtml(
              location
            )}
            · ${formatNumber(
              item.volume_m3,
              2
            )} m³
            · ${formatNumber(
              item.weight_kg,
              2
            )} kg
          </div>
        `;
      })
      .join("");
  }

function renderExpectedAllocationHtml(
  row
) {
  if (!row.expectedAllocs?.length) {
    return "";
  }

  return row.expectedAllocs
    .map(allocation => {
      const container =
        allocation
          .inbound_containers || {};

      return `
        <div class="line-sub">
          Expected stock:
          <strong>
            ${escapeHtml(
              container.container_number ||
              "Inbound container"
            )}
          </strong>
          · Quantity
          ${formatNumber(
            allocation.expected_quantity
          )}
          · ETA
          ${escapeHtml(
            formatDate(
              container
                .eta_warehouse_date
            )
          )}
        </div>
      `;
    })
    .join("");
}

  function renderDetailLinesHtml(
    order
  ) {
    const lines =
      order.stats.lines || [];

    if (!lines.length) {
      return `
        <div class="detail-empty">
          No order lines found.
        </div>
      `;
    }

    return lines
      .map(row => {
        const line =
          row.line;

        const product =
          row.product || {};

        const titleSku =
          row.sku ||
          product.sku_base ||
          "Missing SKU";

        const title =
          `${titleSku} · ${
            row.description ||
            product.name ||
            "Unknown product"
          }`;

        const productId =
          line.product_id ||
          product.id ||
          (
            row.isMiscellaneous
              ? "non-stock"
              : "not linked"
          );

        return `
          <div class="line-card">
            <div class="line-title">
              ${escapeHtml(title)}
            </div>

            <div class="line-meta">
              ${pill(
                `Requested ${formatNumber(
                  row.qty
                )}`
              )}

             ${pill(
  `Physical ${formatNumber(
    row.allocCount
  )}`,
  row.allocCount >= row.qty
    ? "pill-green"
    : "pill-orange"
)}

${row.expectedCount > 0
  ? pill(
      `Expected ${formatNumber(
        row.expectedCount
      )}`,
      "pill-blue"
    )
  : ""
}

${pill(
  `Available ${formatNumber(
    row.combinedCount
  )} / ${formatNumber(
    row.qty
  )}`,
  row.missing <= 0
    ? (
        row.allocCount >= row.qty
          ? "pill-green"
          : "pill-blue"
      )
    : "pill-red"
)}

${pill(
  `Missing ${formatNumber(
    row.missing
  )}`,
  row.missing > 0
    ? "pill-red"
    : "pill-green"
)}

${row.expectedDate
  ? pill(
      `ETA ${formatDate(
        row.expectedDate
      )}`,
      "pill-blue"
    )
  : ""
}

              ${pill(
                `${formatNumber(
                  row.requestedVolume,
                  2
                )} m³`
              )}

              ${pill(
                `${formatNumber(
                  row.requestedWeight,
                  2
                )} kg`
              )}

              ${pill(
                `Charge ${formatMoney(
                  row.costs.customer
                )}`
              )}
            </div>

            <div class="line-sub">
              SKU:
              ${escapeHtml(
                row.sku ||
                "missing"
              )}
              · Product ID:
              ${escapeHtml(
                productId
              )}
            </div>

            <div class="line-sub">
              Storage
              ${formatMoney(
                row.costs.storage
              )}
              · Admin
              ${formatMoney(
                row.costs.admin
              )}
              · Handling
              ${formatMoney(
                row.costs.handling
              )}
              · Transport
              ${formatMoney(
                row.costs.transport
              )}
              · S2U
              ${formatMoney(
                row.costs.s2u
              )}
            </div>

            ${renderAllocationHtml(
  row
)}

${renderExpectedAllocationHtml(
  row
)}
          </div>
        `;
      })
      .join("");
  }

  function renderDetailRow(
    order,
    isOpen
  ) {
    const stats =
      order.stats;

    const costs =
      getOrderCosts(order);

    const memo =
      getMemo(order);

    const blockerHtml =
      stats.blockers.length
        ? `
          <div class="blockers-box open">
            Blocked:
            ${escapeHtml(
              stats.blockers
                .join(" · ")
            )}
          </div>
        `
        : "";

    return `
      <tr
        class="order-detail-row ${
          isOpen ? "open" : ""
        }"
        data-detail-row-for="${
          escapeHtml(order.id)
        }"
      >
        <td
          class="order-detail-cell"
          colspan="13"
        >
          <div class="inline-detail">
            <div class="inline-detail-head">
              <div>
                <h3 class="inline-detail-title">
                  ${escapeHtml(
                    order.order_number ||
                    "—"
                  )}
                </h3>

                <p class="inline-detail-sub">
                  ${escapeHtml(
                    order.customer_name ||
                    "—"
                  )}
                </p>
              </div>

              <button
                class="btn"
                type="button"
                data-close-detail
              >
                Close detail
              </button>
            </div>

            <div class="detail-grid">
              <div class="detail-box">
                <div class="detail-label">
                  Products
                </div>
                <div class="detail-value">
                  ${formatNumber(
                    stats.matched
                  )}
                  /
                  ${formatNumber(
                    stats.required
                  )}
<span class="subline">
  Physical:
  ${formatNumber(
    stats.physicalMatched
  )}
  · Expected:
  ${formatNumber(
    stats.expectedMatched
  )}
</span>
                </div>
              </div>

<div class="detail-box">
  <div class="detail-label">
    Packages
  </div>

  <div class="detail-value">
    ${formatNumber(
      stats.matchedPackages
    )}
    /
    ${formatNumber(
      stats.requiredPackages
    )}

    <span class="subline">
      Physical:
      ${formatNumber(
        stats.physicalMatchedPackages
      )}
      · Expected:
      ${formatNumber(
        stats.expectedPackages
      )}
    </span>
  </div>
</div>

<div class="detail-box">
  <div class="detail-label">
    Memo
  </div>

  <div class="detail-value">
    <span
      class="memo-link"
      data-memo-order-id="${
        escapeHtml(order.id)
      }"
    >
      ${escapeHtml(
        memo
          ? shortMemo(
              memo,
              180
            )
          : "Add memo"
      )}
    </span>
  </div>
</div>

<div class="detail-box">
  <div class="detail-label">
    Supplier Reference
  </div>

  <div class="detail-value">
    ${escapeHtml(
      order.external_reference ||
      "—"
    )}
  </div>
</div>
              <div class="detail-box">
                <div class="detail-label">
                  Purchase Order
                </div>
                <div class="detail-value">
                  ${escapeHtml(
                    order.purchase_order ||
                    "Unknown"
                  )}
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Match
                </div>
                <div class="detail-value">
                  ${formatNumber(
                    stats.matchPct,
                    0
                  )}%
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Geo
                </div>
                <div class="detail-value">
                  ${
                    hasCoordinates(order)
                      ? `${escapeHtml(
                          order.delivery_lat
                        )}, ${escapeHtml(
                          order.delivery_lng
                        )}`
                      : "Missing"
                  }
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Total Volume
                </div>
                <div class="detail-value">
                  ${formatNumber(
                    getTotalVolume(order),
                    2
                  )} m³
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Matched Volume
                </div>
                <div class="detail-value">
                  ${formatNumber(
                    getMatchedVolume(order),
                    2
                  )} m³
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Total Weight
                </div>
                <div class="detail-value">
                  ${formatNumber(
                    getTotalWeight(order),
                    2
                  )} kg
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Matched Weight
                </div>
                <div class="detail-value">
                  ${formatNumber(
                    getMatchedWeight(order),
                    2
                  )} kg
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Planning packages
                </div>
                <div class="detail-value">
                  ${formatNumber(
                    getPlanningColli(order)
                  )}
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Customer Charge
                </div>
                <div class="detail-value">
                  ${formatMoney(
                    costs.customer
                  )}
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  S2U Fees
                </div>
                <div class="detail-value">
                  ${formatMoney(
                    costs.s2u
                  )}
                </div>
              </div>

              <div class="detail-box">
                <div class="detail-label">
                  Transport Tariff
                </div>
                <div class="detail-value">
                  ${formatMoney(
                    costs.transport
                  )}
                </div>
              </div>
            </div>

            ${blockerHtml}

            <div>
              <div
                class="detail-label"
                style="margin-bottom:8px;"
              >
                Product / stock lines
              </div>

              <div class="line-list">
                ${renderDetailLinesHtml(
                  order
                )}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  /* =========================================================
   * MAIN TABLE
   * ======================================================= */

  function renderCheckAllState() {
    const checkbox =
      byId("checkAllVisible");

    if (!checkbox) {
      return;
    }

    const visibleIds =
      filteredOrders.map(
        order => String(order.id)
      );

    const selectedVisible =
      visibleIds.filter(
        id =>
          selectedOrderIds.has(id)
      );

    checkbox.checked =
      visibleIds.length > 0 &&
      selectedVisible.length ===
      visibleIds.length;

    checkbox.indeterminate =
      selectedVisible.length > 0 &&
      selectedVisible.length <
      visibleIds.length;
  }

  function renderTable() {
    const tbody =
      byId("ordersBody");

    if (!tbody) {
      return;
    }

    updateSortIndicators();
    renderTotals();

    if (!filteredOrders.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="13">
            No orders found.
          </td>
        </tr>
      `;

      renderCheckAllState();
      return;
    }

    tbody.innerHTML =
      filteredOrders
        .map(order => {
          const stats =
            order.stats;

          const costs =
            getOrderCosts(order);

          const color =
            deriveMatchColor(order);

          const isOpen =
            String(openedOrderId) ===
            String(order.id);

          const memo =
            getMemo(order);

          return `
            <tr
              data-order-id="${
                escapeHtml(order.id)
              }"
              class="order-row ${
                isOpen ? "active" : ""
              }"
            >
              <td class="checkbox-cell">
                <input
                  class="row-check"
                  type="checkbox"
                  data-order-id="${
                    escapeHtml(order.id)
                  }"
                  ${
                    selectedOrderIds.has(
                      String(order.id)
                    )
                      ? "checked"
                      : ""
                  }
                />
              </td>

              <td class="order-cell">
                <div class="order-header">
                  <button
                    class="expand-btn"
                    type="button"
                    data-expand-order="${
                      escapeHtml(order.id)
                    }"
                  >
                    ${isOpen ? "−" : "+"}
                  </button>

                  <strong>
                    ${escapeHtml(
                      order.order_number ||
                      "—"
                    )}
                  </strong>
                </div>

                ${
                  order.external_reference
                    ? `
                      <span class="subline">
                        Supplier Ref:
                        ${escapeHtml(
                          order.external_reference
                        )}
                      </span>
                    `
                    : ""
                }

                <span class="subline">
                  PO:
                  ${escapeHtml(
                    order.purchase_order ||
                    "Unknown"
                  )}
                </span>

                <span
                  class="subline memo-link"
                  data-memo-order-id="${
                    escapeHtml(order.id)
                  }"
                >
                  Memo:
                  ${escapeHtml(
                    memo
                      ? shortMemo(memo)
                      : "Add memo"
                  )}
                </span>
              </td>

              <td>
                ${escapeHtml(
                  order.customer_name ||
                  "—"
                )}
              </td>

              <td class="ship-to-cell">
                ${escapeHtml(
                  order.ship_to_address ||
                  getAddressText(order)
                )}
              </td>

              <td>
                ${formatNumber(
                  (
                    order.order_lines ||
                    []
                  ).length
                )}
              </td>

              <td>
                ${formatNumber(
                  stats.matchedPackages
                )}
                /
                ${formatNumber(
                  stats.requiredPackages
                )}

                <span class="subline">
                  ${formatNumber(
                    stats.matchPct,
                    0
                  )}%
                </span>
              </td>

              <td>
                ${formatNumber(
                  getTotalVolume(order),
                  2
                )} m³

                <span class="subline">
                  Matched:
                  ${formatNumber(
                    getMatchedVolume(
                      order
                    ),
                    2
                  )} m³
                </span>
              </td>

              <td>
                ${formatNumber(
                  getTotalWeight(order),
                  2
                )} kg

                <span class="subline">
                  Matched:
                  ${formatNumber(
                    getMatchedWeight(
                      order
                    ),
                    2
                  )} kg
                </span>
              </td>

              <td>
                ${geoPill(order)}
              </td>

              <td>
               ${completenessPill(order)}
              </td>

              <td>
                ${statusPill(order)}
              </td>

              <td>
                ${releasePill(order)}
              </td>

              <td>
                ${escapeHtml(
                  formatDate(
                    order
                      .requested_delivery_date
                  )
                )}

                <span class="subline">
                  Charge:
                  ${formatMoney(
                    costs.customer
                  )}
                </span>
              </td>
            </tr>

            ${renderDetailRow(
              order,
              isOpen
            )}
          `;
        })
        .join("");

    bindRenderedTableEvents();
    renderCheckAllState();
  }

  function bindRenderedTableEvents() {
    const tbody =
      byId("ordersBody");

    if (!tbody) {
      return;
    }

    tbody
      .querySelectorAll(
        "tr.order-row[data-order-id]"
      )
      .forEach(row => {
        row.addEventListener(
          "click",
          event => {
            if (
              event.target.closest(
                "input,button,[data-memo-order-id]"
              )
            ) {
              return;
            }

            const id =
              String(
                row.dataset.orderId
              );

            openedOrderId =
              openedOrderId === id
                ? null
                : id;

            renderAll();
          }
        );
      });

    tbody
      .querySelectorAll(
        "[data-expand-order]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            const id =
              String(
                button.dataset
                  .expandOrder
              );

            openedOrderId =
              openedOrderId === id
                ? null
                : id;

            renderAll();
          }
        );
      });

    tbody
      .querySelectorAll(
        "[data-close-detail]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            openedOrderId = null;
            renderAll();
          }
        );
      });

    tbody
      .querySelectorAll(
        "[data-memo-order-id]"
      )
      .forEach(element => {
        element.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            openMemoModal(
              element.dataset
                .memoOrderId
            );
          }
        );
      });

    tbody
      .querySelectorAll(
        ".row-check"
      )
      .forEach(input => {
        input.addEventListener(
          "click",
          event =>
            event.stopPropagation()
        );

        input.addEventListener(
          "change",
          () => {
            const id =
              String(
                input.dataset.orderId
              );

            if (input.checked) {
              selectedOrderIds.add(id);
            } else {
              selectedOrderIds.delete(id);
            }

            renderCheckAllState();
          }
        );
      });
  }

  function renderAll() {
    renderKpis();
    renderTable();
  }

  /* =========================================================
   * MEMO MODAL
   * ======================================================= */

  function ensureMemoModal() {
    if (byId("memoModal")) {
      return;
    }

    const modal =
      document.createElement("div");

    modal.id = "memoModal";
    modal.className =
      "memo-modal-backdrop";

    modal.style.display = "none";

    modal.innerHTML = `
      <div class="memo-modal-card">
        <div class="memo-modal-head">
          <strong id="memoModalTitle">
            Order memo
          </strong>

          <button
            type="button"
            class="btn"
            id="btnCloseMemoModal"
          >
            Close
          </button>
        </div>

        <textarea
          id="memoModalText"
          class="memo-modal-textarea"
        ></textarea>

        <div class="memo-modal-actions">
          <button
            type="button"
            class="btn btn-primary"
            id="btnSaveMemoModal"
          >
            Save memo
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(
      modal
    );

    const style =
      document.createElement(
        "style"
      );

    style.textContent = `
      .memo-modal-backdrop{
        position:fixed;
        inset:0;
        z-index:9999;
        background:rgba(15,23,42,.45);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px
      }

      .memo-modal-card{
        width:min(720px,96vw);
        background:#fff;
        border-radius:18px;
        box-shadow:0 24px 60px rgba(15,23,42,.25);
        padding:18px
      }

      .memo-modal-head,
      .memo-modal-actions{
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:center;
        margin-bottom:12px
      }

      .memo-modal-textarea{
        width:100%;
        min-height:220px;
        resize:vertical;
        border:1px solid #d1d5db;
        border-radius:12px;
        padding:12px;
        font:inherit;
        line-height:1.45
      }

      .memo-link{
        cursor:pointer;
        color:#2563eb;
        text-decoration:underline;
        text-underline-offset:2px
      }
    `;

    document.head.appendChild(
      style
    );

    byId("btnCloseMemoModal")
      ?.addEventListener(
        "click",
        closeMemoModal
      );

    byId("btnSaveMemoModal")
      ?.addEventListener(
        "click",
        saveMemoModal
      );

    modal.addEventListener(
      "click",
      event => {
        if (
          event.target === modal
        ) {
          closeMemoModal();
        }
      }
    );
  }

  function openMemoModal(orderId) {
    const order =
      allOrders.find(
        row =>
          String(row.id) ===
          String(orderId)
      );

    if (!order) {
      return;
    }

    ensureMemoModal();

    memoOrderId =
      String(order.id);

    setText(
      "memoModalTitle",
      `Memo / notes - ${
        order.order_number ||
        "order"
      }`
    );

    const textarea =
      byId("memoModalText");

    if (textarea) {
      textarea.value =
        getMemo(order);
    }

    const modal =
      byId("memoModal");

    if (modal) {
      modal.style.display =
        "flex";
    }
  }

  function closeMemoModal() {
    memoOrderId = null;

    const modal =
      byId("memoModal");

    if (modal) {
      modal.style.display =
        "none";
    }
  }

  async function saveMemoModal() {
    if (!memoOrderId) {
      return;
    }

    const memo = String(
      byId("memoModalText")
        ?.value || ""
    ).trim();

    try {
      const { error } =
        await client
          .from("orders")
          .update({
            memo: memo || null
          })
          .eq(
            "id",
            memoOrderId
          );

      if (error) {
        throw error;
      }

      allOrders =
        allOrders.map(order =>
          String(order.id) ===
          String(memoOrderId)
            ? enrichOrder({
                ...order,
                memo
              })
            : order
        );

      applyFilters();
      renderAll();
      closeMemoModal();

      showToast(
        "Memo updated.",
        "ok"
      );
    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
        "Could not save memo.",
        "err"
      );
    }
  }

  /* =========================================================
   * RUN MATCHING
   * ======================================================= */

  async function runMatchModule() {
    try {
      if (
        !window.AllocationEngine?.run
      ) {
        throw new Error(
          "AllocationEngine is not loaded."
        );
      }

const sourceOrders =
  selectedOrderIds.size
    ? allOrders.filter(order =>
        selectedOrderIds.has(
          String(order.id)
        )
      )
    : allOrders;

const orderIds =
  sourceOrders
    .filter(order =>
      !isCollectionOrder(order) &&
      !order.planning_release &&
      !order.stats.isFullyMatched &&
      !order.stats.isExpectedComplete
    )
    .map(order =>
      String(order.id)
    );

      if (!orderIds.length) {
        showToast(
          "No orders selected or available for matching.",
          "err"
        );

        return;
      }

      setProgress(
        true,
        10,
        "Running allocation engine..."
      );

      const result =
        await window
          .AllocationEngine
          .run({
            orderIds,
            dryRun: false
          });

      setProgress(
        true,
        90,
        "Reloading matching results..."
      );

      await loadOrders();

      showToast(
        `${formatNumber(
          result
            ?.allocations_created ||
          0
        )} stock item(s) matched and reserved.`,
        "ok"
      );
    } catch (error) {
      console.error(error);
      setProgress(false);

      showToast(
        error.message ||
        "Matching failed.",
        "err"
      );
    }
  }

  /* =========================================================
   * GEOCODING
   * ======================================================= */

  async function geocodeOne(order) {
    if (hasCoordinates(order)) {
      return {
        ok: true,
        skipped: true
      };
    }

    const address = [
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_city,
      order.delivery_region,
      order.delivery_postcode,
      order.delivery_country ||
      "United Kingdom"
    ]
      .filter(Boolean)
      .join(", ");

    const postcode =
      String(
        order.delivery_postcode ||
        ""
      ).trim();

    const city =
      String(
        order.delivery_city ||
        ""
      ).trim();

    const country =
      String(
        order.delivery_country ||
        "United Kingdom"
      ).trim();

    if (!postcode && !city) {
      return {
        ok: false,
        message:
          "Missing city/postcode"
      };
    }

    const attempts = [
      {
        address: "",
        postcode,
        city: "",
        country
      },
      {
        address: "",
        postcode,
        city,
        country
      },
      {
        address,
        postcode,
        city,
        country
      },
      {
        address: "",
        postcode: "",
        city,
        country
      }
    ].filter(query =>
      query.address ||
      query.postcode ||
      query.city
    );

    for (
      const query of attempts
    ) {
      try {
        const {
          data,
          error
        } =
          await client
            .functions
            .invoke(
              GEOCODE_FUNCTION_NAME,
              {
                body: {
                  queries: [query]
                }
              }
            );

        if (error) {
          console.warn(
            "Geocode attempt failed:",
            error,
            query
          );

          continue;
        }

        const result =
          Array.isArray(
            data?.results
          )
            ? data.results[0]
            : null;

        if (
          result?.ok &&
          result.lat != null &&
          result.lng != null
        ) {
          return {
            ok: true,
            lat:
              Number(result.lat),
            lng:
              Number(result.lng),
            display_name:
              result.display_name ||
              ""
          };
        }
      } catch (error) {
        console.error(
          "Geocode failed:",
          error,
          query
        );
      }
    }

    return {
      ok: false,
      message:
        "No geocode match"
    };
  }

  async function geocodeOrders(
    orderIds
  ) {
    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (
      let index = 0;
      index < orderIds.length;
      index++
    ) {
      const order =
        allOrders.find(
          row =>
            String(row.id) ===
            String(
              orderIds[index]
            )
        );

      if (!order) {
        continue;
      }

      setProgress(
        true,
        Math.round(
          (
            (index + 1) /
            orderIds.length
          ) * 100
        ),
        `Geocoding ${
          order.order_number
        }...`
      );

      const result =
        await geocodeOne(order);

      if (!result.ok) {
        failed += 1;

        console.warn(
          `No geocode for ${order.order_number}:`,
          result.message
        );

        continue;
      }

      if (result.skipped) {
        skipped += 1;
        continue;
      }

      const payload = {
        delivery_lat:
          result.lat,

        delivery_lng:
          result.lng
      };

      if (
        "geocode_display_name"
        in order
      ) {
        payload
          .geocode_display_name =
          result.display_name ||
          null;
      }

      const { error } =
        await client
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

    return {
      updated,
      failed,
      skipped
    };
  }

  async function geocodeSelected() {
    try {
      const orderIds =
        selectedOrderIds.size
          ? [...selectedOrderIds]
          : filteredOrders
              .filter(order =>
                !hasCoordinates(order)
              )
              .map(order =>
                String(order.id)
              );

      if (!orderIds.length) {
        showToast(
          "No orders selected or needing geocode.",
          "err"
        );

        return;
      }

      const result =
        await geocodeOrders(
          orderIds
        );

      await loadOrders();

      showToast(
        `Geocode complete. Updated: ${result.updated}, skipped: ${result.skipped}, failed: ${result.failed}.`,
        result.failed
          ? "err"
          : "ok"
      );
    } catch (error) {
      console.error(error);
      setProgress(false);

      showToast(
        error.message ||
        "Geocoding failed.",
        "err"
      );
    }
  }

  /* =========================================================
   * RELEASE TO PLANNING
   * ======================================================= */

async function releaseOrders(
  orderIds
) {
  const cid =
    await getCompanyId();

  const releasable = [];
  const blocked = [];

  orderIds.forEach(id => {
    const order =
      allOrders.find(
        row =>
          String(row.id) ===
          String(id)
      );

    if (!order) {
      return;
    }

const collection =
  isCollectionOrder(order);

const service =
  isServiceOrder(order);

const physicallyReady =
  Boolean(
    order.stats
      ?.readyForPlanning
  );

const expectedReady =
  Boolean(
    order.stats
      ?.isExpectedComplete &&
    order.stats
      ?.expectedCompleteDate
  );

const geoReady =
  hasCoordinates(order);

if (
  collection &&
  geoReady
) {
  releasable.push(order);
  return;
}

if (
  service &&
  geoReady
) {
  releasable.push(order);
  return;
}

if (
  !collection &&
  (
    physicallyReady ||
    expectedReady
  ) &&
  geoReady
) {
  releasable.push(order);
  return;
}

const reasons = [];

if (
  !collection &&
  !service &&
  !physicallyReady &&
  !expectedReady
) {

  reasons.push(
    "order is not physically or expected complete"
  );
}

if (!geoReady) {
  reasons.push(
    "geolocation is missing"
  );
}

    blocked.push({
      order,
      reasons
    });
  });

if (blocked.length) {
  console.warn(
    "ORDERS SKIPPED DURING RELEASE",
    blocked.map(item => ({
      order_number: item.order.order_number,
      reasons: item.reasons
    }))
  );
}

if (!releasable.length) {
  const example = blocked[0];

  throw new Error(
    blocked.length
      ? `${blocked.length} order(s) blocked. Example ${example.order.order_number}: ${example.reasons.join(" · ")}`
      : "No ready orders to release."
  );
}

  if (!releasable.length) {
    throw new Error(
      "No ready orders to release."
    );
  }

 for (
  const order of releasable
) {
const collection =
  isCollectionOrder(order);

const service =
  isServiceOrder(order);

  const physicallyReady =
    Boolean(
      order.stats
        ?.readyForPlanning
    );

const expectedOnly =
  !collection &&
  !service &&
  !physicallyReady &&
  Boolean(
    order.stats
      ?.isExpectedComplete
  );

    const expectedCompleteDate =
      expectedOnly
        ? (
            order.stats
              ?.expectedCompleteDate ||
            order.expected_complete_date ||
            null
          )
        : null;

    const earliestPlanningDate =
      expectedOnly
        ? addDaysToDate(
            expectedCompleteDate,
            1
          )
        : null;

    if (
      expectedOnly &&
      !earliestPlanningDate
    ) {
      throw new Error(
        `${order.order_number} has no valid expected completion date.`
      );
    }

    const payload = {
      status:
        "ready_for_planning",

      planning_release:
        true,

planning_stock_basis:
  collection || service
    ? null
    : (
        expectedOnly
          ? "expected"
          : "physical"
      ),

      earliest_planning_date:
        earliestPlanningDate,

      released_to_planning_at:
        nowIso(),

released_to_planning_by:
  collection
    ? "collection_manual"
    : (
        expectedOnly
          ? "expected_stock"
          : "manual"
      ),

      planning_colli:
        getPlanningColli(
          order
        ),

      planning_volume_m3:
        round3(
          getTotalVolume(
            order
          )
        ),

      last_activity_at:
        nowIso()
    };

    const {
      data,
      error
    } =
      await client
        .from("orders")
        .update(payload)
        .eq(
          "company_id",
          cid
        )
        .eq(
          "id",
          order.id
        )
        .select(`
          id,
          order_number,
          status,
          planning_release,
          planning_stock_basis,
          expected_complete_date,
          earliest_planning_date
        `)
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (
      !data
        ?.planning_release
    ) {
      throw new Error(
        `Order ${order.order_number} was not released.`
      );
    }

    console.log(
      "ORDER RELEASED TO PLANNING",
      data
    );
  }

  return releasable.length;
}

async function geocodeAndReleaseSelected() {
  try {
const orderIds =
  selectedOrderIds.size
    ? [...selectedOrderIds]
    : filteredOrders
        .filter(order => {
          const collection =
            isCollectionOrder(order);
const service =
  isServiceOrder(order);

          const physicallyReady =
            Boolean(
              order.stats
                ?.isFullyMatched
            );

          const expectedReady =
            Boolean(
              order.stats
                ?.isExpectedComplete &&
              order.stats
                ?.expectedCompleteDate
            );

          return (
            !order.planning_release &&
            (
collection ||
service ||
physicallyReady ||
expectedReady
            )
          );
        })
        .map(order =>
          String(order.id)
        );

    if (!orderIds.length) {
      showToast(
        "No selected, physically complete or expected complete orders to release.",
        "err"
      );

      return;
    }

    setProgress(
      true,
      5,
      "Geocoding selected orders..."
    );

    await geocodeOrders(
      orderIds
    );

    setProgress(
      true,
      65,
      "Reloading orders..."
    );

    await loadOrders();

    setProgress(
      true,
      85,
      "Releasing to planning..."
    );

    const count =
      await releaseOrders(
        orderIds
      );

    selectedOrderIds.clear();

    await loadOrders();

    showToast(
      `${formatNumber(
        count
      )} order(s) released to planning.`,
      "ok"
    );
  } catch (error) {
    console.error(error);
    setProgress(false);

    showToast(
      error.message ||
      "Release failed.",
      "err"
    );
  }
}

function selectReadyOrders() {
  selectedOrderIds.clear();

filteredOrders.forEach(
  order => {
    const collection =
      isCollectionOrder(order);
const service =
  isServiceOrder(order);

    const physicallyReady =
      Boolean(
        order.stats
          ?.readyForPlanning
      );

    const expectedReady =
      Boolean(
        order.stats
          ?.isExpectedComplete &&
        order.stats
          ?.expectedCompleteDate
      );

    if (
      (
collection ||
service ||
physicallyReady ||
expectedReady
      ) &&
      !order.planning_release
    ) {
      selectedOrderIds.add(
        String(order.id)
      );
    }
  }
);

  renderTable();

  showToast(
    `${formatNumber(
      selectedOrderIds.size
    )} physically or expected complete order(s) selected.`,
    "ok"
  );
}

  function getMissingStockOrdersForExport() {
    const sourceOrders =
      selectedOrderIds.size > 0
        ? allOrders.filter(order =>
            selectedOrderIds.has(
              String(order.id)
            )
          )
        : filteredOrders;

    return sourceOrders
      .map(order => {
        const missingLines =
          (order.stats?.lines || [])
            .filter(row =>
              !row.isMiscellaneous &&
              toNumber(row.missing, 0) > 0
            );

        return {
          order,
          missingLines
        };
      })
      .filter(entry =>
        entry.missingLines.length > 0
      );
  }

  function exportMissingStockPdf() {
    try {
      if (
        !window.jspdf?.jsPDF
      ) {
        throw new Error(
          "jsPDF is not loaded. Check the script tags in order-matching.html."
        );
      }

      const exportOrders =
        getMissingStockOrdersForExport();

      if (!exportOrders.length) {
        showToast(
          "No incomplete orders with missing stock found.",
          "err"
        );

        return;
      }

      const { jsPDF } =
        window.jspdf;

      const pdf =
        new jsPDF({
          orientation: "landscape",
          unit: "mm",
          format: "a4"
        });

      if (
        typeof pdf.autoTable !==
        "function"
      ) {
        throw new Error(
          "jsPDF AutoTable is not loaded. Check the AutoTable script in order-matching.html."
        );
      }

      const pageWidth =
        pdf.internal.pageSize.getWidth();

      const pageHeight =
        pdf.internal.pageSize.getHeight();

      const marginLeft = 14;
      const marginRight = 14;
      const marginBottom = 14;

      const generatedAt =
        new Date().toLocaleString(
          "en-GB"
        );

      const totalMissingUnits =
        exportOrders.reduce(
          (total, entry) =>
            total +
            entry.missingLines.reduce(
              (lineTotal, row) =>
                lineTotal +
                toNumber(
                  row.missing,
                  0
                ),
              0
            ),
          0
        );

      function drawPageHeader() {
        pdf.setFillColor(
          7,
          21,
          47
        );

pdf.rect(
  0,
  0,
  pageWidth,
  20,
  "F"
);

        pdf.setTextColor(
          255,
          255,
          255
        );

        pdf.setFont(
          "helvetica",
          "bold"
        );

pdf.setFontSize(15);

pdf.text(
  "Missing Stock Report",
  marginLeft,
  15
);

        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(8);

pdf.text(
  `Generated: ${generatedAt}`,
  pageWidth - marginRight,
  8,
  {
    align: "right"
  }
);

pdf.text(
  `${formatNumber(
    exportOrders.length
  )} incomplete orders · ${formatNumber(
    totalMissingUnits
  )} missing units`,
  pageWidth - marginRight,
  15,
  {
    align: "right"
  }
);

        pdf.setTextColor(
          7,
          21,
          47
        );
      }

      function addNewPage() {
        pdf.addPage(
          "a4",
          "landscape"
        );

        drawPageHeader();

        return 27;
      }

      function ensureSpace(
        currentY,
        requiredHeight
      ) {
        if (
          currentY +
          requiredHeight >
          pageHeight -
          marginBottom
        ) {
          return addNewPage();
        }

        return currentY;
      }

      drawPageHeader();

      let currentY = 27;

      exportOrders.forEach(
        (
          entry,
          orderIndex
        ) => {
          const order =
            entry.order;

          const missingLines =
            entry.missingLines;

          const orderMissingUnits =
            missingLines.reduce(
              (total, row) =>
                total +
                toNumber(
                  row.missing,
                  0
                ),
              0
            );

          currentY =
            ensureSpace(
              currentY,
              42
            );

          pdf.setFillColor(
            239,
            246,
            255
          );

          pdf.setDrawColor(
            191,
            219,
            254
          );

          pdf.roundedRect(
            marginLeft,
            currentY,
            pageWidth -
              marginLeft -
              marginRight,
            20,
            2,
            2,
            "FD"
          );

          pdf.setFont(
            "helvetica",
            "bold"
          );

          pdf.setFontSize(12);

          pdf.setTextColor(
            7,
            21,
            47
          );

          pdf.text(
            String(
              order.order_number ||
              "Unknown order"
            ),
            marginLeft + 4,
            currentY + 7
          );

          pdf.setFontSize(9);

          pdf.setFont(
            "helvetica",
            "normal"
          );

         const productOwnerName =
  order.customers?.name ||
  "—";

const retailerName =
  order.retail_name ||
  "—";

pdf.text(
  `Product owner: ${productOwnerName}`,
  marginLeft + 4,
  currentY + 13
);

pdf.text(
  `Retailer: ${retailerName}`,
  marginLeft + 82,
  currentY + 13
);

          pdf.text(
            `Missing units: ${formatNumber(
              orderMissingUnits
            )}`,
            pageWidth -
              marginRight -
              4,
            currentY + 7,
            {
              align: "right"
            }
          );

          pdf.setFontSize(8);

          pdf.text(
            `Supplier ref: ${
              order.external_reference ||
              "—"
            }`,
            marginLeft + 4,
            currentY + 18
          );

          pdf.text(
            `PO: ${
              order.purchase_order ||
              "—"
            }`,
            marginLeft + 82,
            currentY + 18
          );

          pdf.text(
            `Requested delivery: ${formatDate(
              order.requested_delivery_date
            )}`,
            pageWidth -
              marginRight -
              4,
            currentY + 18,
            {
              align: "right"
            }
          );

          currentY += 24;

          const tableBody =
            missingLines.map(row => [
              row.sku || "Missing SKU",

              row.description ||
              row.product?.name ||
              "Unknown product",

              formatNumber(
                row.qty,
                0
              ),

              formatNumber(
                row.allocCount,
                0
              ),

              formatNumber(
                row.missing,
                0
              ),

              `${formatNumber(
                row.requestedVolume,
                3
              )} m³`,

              `${formatNumber(
                row.requestedWeight,
                2
              )} kg`
            ]);

          pdf.autoTable({
            startY: currentY,

            margin: {
              left: marginLeft,
              right: marginRight,
              bottom: marginBottom
            },

            head: [[
              "SKU",
              "Product",
              "Requested",
              "Reserved",
              "Missing",
              "Volume",
              "Weight"
            ]],

            body: tableBody,

            theme: "grid",

            styles: {
              font: "helvetica",
              fontSize: 8,
              cellPadding: 2.5,
              textColor: [
                7,
                21,
                47
              ],
              lineColor: [
                220,
                229,
                242
              ],
              lineWidth: 0.2,
              overflow: "linebreak",
              valign: "middle"
            },

            headStyles: {
              fillColor: [
                7,
                21,
                47
              ],
              textColor: [
                255,
                255,
                255
              ],
              fontStyle: "bold"
            },

            alternateRowStyles: {
              fillColor: [
                248,
                250,
                252
              ]
            },

            columnStyles: {
              0: {
                cellWidth: 31,
                fontStyle: "bold"
              },

              1: {
                cellWidth: 100
              },

              2: {
                cellWidth: 24,
                halign: "center"
              },

              3: {
                cellWidth: 24,
                halign: "center"
              },

              4: {
                cellWidth: 24,
                halign: "center",
                fontStyle: "bold",
                textColor: [
                  185,
                  28,
                  28
                ],
                fillColor: [
                  254,
                  242,
                  242
                ]
              },

              5: {
                cellWidth: 28,
                halign: "right"
              },

              6: {
                cellWidth: 28,
                halign: "right"
              }
            },

            didDrawPage: data => {
              if (
                data.pageNumber > 1
              ) {
                drawPageHeader();
              }
            }
          });

          currentY =
            (
              pdf.lastAutoTable
                ?.finalY ||
              currentY
            ) + 8;

          if (
            orderIndex <
            exportOrders.length - 1
          ) {
            pdf.setDrawColor(
              220,
              229,
              242
            );

            pdf.line(
              marginLeft,
              currentY - 4,
              pageWidth -
                marginRight,
              currentY - 4
            );
          }
        }
      );

      const pageCount =
        pdf.internal.getNumberOfPages();

      for (
        let pageNumber = 1;
        pageNumber <= pageCount;
        pageNumber++
      ) {
        pdf.setPage(pageNumber);

        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(8);

        pdf.setTextColor(
          100,
          116,
          139
        );

        pdf.text(
          `Page ${pageNumber} of ${pageCount}`,
          pageWidth -
            marginRight,
          pageHeight - 7,
          {
            align: "right"
          }
        );

pdf.text(
  "Missing Stock Report",
  marginLeft,
  pageHeight - 7
);
      }

      const fileDate =
        new Date()
          .toISOString()
          .slice(0, 10);

pdf.save(
  `Missing-Stock-Report-${fileDate}.pdf`
);

      showToast(
        `${formatNumber(
          exportOrders.length
        )} incomplete order(s) exported to PDF.`,
        "ok"
      );
    } catch (error) {
      console.error(
        "Missing stock PDF export failed:",
        error
      );

      showToast(
        error.message ||
        "Could not generate missing stock PDF.",
        "err"
      );
    }
  }

  /* =========================================================
   * CSV EXPORT
   * ======================================================= */

  function csvCell(value) {
    return `"${String(value ?? "")
      .replaceAll(
        '"',
        '""'
      )}"`;
  }

  function exportSelectedCsv() {
    const orders =
      selectedOrderIds.size
        ? allOrders.filter(order =>
            selectedOrderIds.has(
              String(order.id)
            )
          )
        : filteredOrders;

    if (!orders.length) {
      showToast(
        "No orders to export.",
        "err"
      );

      return;
    }

    const header = [
      "SO Number",
      "Supplier Reference",
      "Customer",
      "Memo",
      "Purchase Order",
      "Ship To",
      "City",
      "Postcode",
      "Required Products",
      "Matched Products",
      "Missing Products",
      "Required Packages",
      "Matched Packages",
      "Missing Packages",
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

    const rows =
      orders.map(order => {
        const stats =
          order.stats;

        const costs =
          getOrderCosts(order);

        return [
          order.order_number ||
          "",

          order.external_reference ||
          "",

          order.customer_name ||
          "",

          getMemo(order),

          order.purchase_order ||
          "",

          order.ship_to_address ||
          getAddressText(order),

          order.delivery_city ||
          "",

          order.delivery_postcode ||
          "",

          stats.required,
          stats.matched,
          stats.missing,

          stats.requiredPackages,
          stats.matchedPackages,
          stats.missingPackages,

          getTotalVolume(order)
            .toFixed(3),

          getMatchedVolume(order)
            .toFixed(3),

          getTotalWeight(order)
            .toFixed(3),

          getMatchedWeight(order)
            .toFixed(3),

          costs.storage
            .toFixed(2),

          costs.admin
            .toFixed(2),

          costs.handling
            .toFixed(2),

          costs.transport
            .toFixed(2),

          costs.s2u
            .toFixed(2),

          costs.customer
            .toFixed(2),

          stats.matchStatus,

          order.status ||
          "",

          order.planning_release
            ? "yes"
            : "no"
        ]
          .map(csvCell)
          .join(",");
      });

    const csv = [
      header
        .map(csvCell)
        .join(","),
      ...rows
    ].join("\n");

    const blob =
      new Blob(
        [csv],
        {
          type:
            "text/csv;charset=utf-8"
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const link =
      document.createElement("a");

    link.href = url;

    link.download =
      `order-matching-export-${
        new Date()
          .toISOString()
          .slice(0, 10)
      }.csv`;

    document.body.appendChild(
      link
    );

    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  /* =========================================================
   * FILTER RESET / EVENTS
   * ======================================================= */

  function resetFilters() {
    [
      "filterSearch",
      "filterStatus",
      "filterMatch",
      "filterGeo",
      "filterRelease"
    ].forEach(id => {
      const element =
        byId(id);

      if (element) {
        element.value = "";
      }
    });

    applyFilters();
    renderAll();
  }

  function bindFilterEvents() {
    [
      "filterSearch",
      "filterStatus",
      "filterMatch",
      "filterGeo",
      "filterRelease"
    ].forEach(id => {
      const element =
        byId(id);

      if (!element) {
        return;
      }

      element.addEventListener(
        "input",
        () => {
          applyFilters();
          renderAll();
        }
      );

      element.addEventListener(
        "change",
        () => {
          applyFilters();
          renderAll();
        }
      );
    });
  }

  function bindSortEvents() {
    document
      .querySelectorAll(
        "[data-sort-key]"
      )
      .forEach(header => {
        header.addEventListener(
          "click",
          () => {
            const key =
              header.getAttribute(
                "data-sort-key"
              );

            if (
              sortState.key === key
            ) {
              sortState.direction =
                sortState.direction ===
                  "asc"
                  ? "desc"
                  : "asc";
            } else {
              sortState.key = key;
              sortState.direction =
                "asc";
            }

            sortFilteredOrders();
            renderAll();
          }
        );
      });
  }

  function bindButtonEvents() {
    byId("btnRefresh")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await loadOrders();

            showToast(
              "Matching refreshed.",
              "ok"
            );
          } catch (error) {
            console.error(error);
            setProgress(false);

            showToast(
              error.message ||
              "Refresh failed.",
              "err"
            );
          }
        }
      );

    byId("btnResetFilters")
      ?.addEventListener(
        "click",
        resetFilters
      );

    byId("btnRunMatch")
      ?.addEventListener(
        "click",
        runMatchModule
      );

    byId("btnSelectReady")
      ?.addEventListener(
        "click",
        selectReadyOrders
      );

    byId("btnGeocodeSelected")
      ?.addEventListener(
        "click",
        geocodeSelected
      );

    byId("btnReleaseSelected")
      ?.addEventListener(
        "click",
        geocodeAndReleaseSelected
      );

    byId("btnExportMissingStockPdf")
      ?.addEventListener(
        "click",
        exportMissingStockPdf
      );

    byId("btnExportSelected")
      ?.addEventListener(
        "click",
        exportSelectedCsv
      );

    byId("checkAllVisible")
      ?.addEventListener(
        "change",
        event => {
          const checked =
            Boolean(
              event.target.checked
            );

          filteredOrders.forEach(
            order => {
              const id =
                String(order.id);

              if (checked) {
                selectedOrderIds.add(id);
              } else {
                selectedOrderIds.delete(id);
              }
            }
          );

          renderTable();
        }
      );
  }

  function bindEvents() {
    bindFilterEvents();
    bindSortEvents();
    bindButtonEvents();
  }

  /* =========================================================
   * INITIALISE
   * ======================================================= */

  async function init() {
    try {
      if (
        typeof sb !== "function"
      ) {
        throw new Error(
          "Supabase helper sb() is not available."
        );
      }

      if (
        !window.AllocationEngine
          ?.calculateOrderSummary
      ) {
        throw new Error(
          "AllocationEngine is not loaded before order-matching.js."
        );
      }

      client = sb();

      bindEvents();

      await loadOrders();

      showToast(
        "Order matching loaded.",
        "ok"
      );
    } catch (error) {
      console.error(error);
      setProgress(false);

      showToast(
        error.message ||
        "Could not load order matching.",
        "err"
      );
    }
  }

  window.OrderMatching = {
    refresh:
      loadOrders,

    getOrders:
      () => allOrders,

    getFilteredOrders:
      () => filteredOrders,

    getSelectedOrderIds:
      () => [
        ...selectedOrderIds
      ],

    runMatch:
      runMatchModule,

    geocodeSelected,

    releaseSelected:
      geocodeAndReleaseSelected
  };

  document.addEventListener(
    "DOMContentLoaded",
    init
  );
})();