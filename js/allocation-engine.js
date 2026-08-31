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

  const OUTBOUND_STATUSES = [
    "picked",
    "loaded",
    "shipped",
    "closed",
    "manual_outbound",
    "cancelled",
    "damaged",
    "missing"
  ];

  function sbClient() {
    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }
    return sb();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

function isMiscellaneousLine(line) {
  return normalize(line?.sku_base) === "miscellaneous";
}

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
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

  function isOutboundStatus(status) {
    return OUTBOUND_STATUSES.includes(normalize(status));
  }

  function productVolume(product) {
    return toNumber(product?.volume_m3, 0);
  }

  function productWeight(product) {
    return toNumber(product?.weight_kg, 0);
  }

  function packageCountFromProduct(product) {
    const packageCount = toNumber(product?.package_count, 0);
    if (packageCount > 0) return Math.max(1, Math.round(packageCount));

    const flags = [
      toNumber(product?.package_1_qty, 0),
      toNumber(product?.package_2_qty, 0),
      toNumber(product?.package_3_qty, 0)
    ];

    const counted = flags.filter(v => v > 0).length;
    if (counted > 0) return counted;

    const packagesPerUnit = toNumber(product?.packages_per_unit, 0);
    if (packagesPerUnit > 0) return Math.max(1, Math.round(packagesPerUnit));

    return 1;
  }

function salesUnitsPerPackage(product) {
  const value = toNumber(product?.sales_units_per_package, 1);
  return value > 0 ? value : 1;
}

function requiredStockUnitsForLine(line, product) {
  const qty = Math.max(0, toNumber(line?.quantity_ordered, 0));
  const unitsPerPackage = salesUnitsPerPackage(product);

  return Math.ceil(qty / unitsPerPackage);
}

function lineRequestsSinglePackage(line) {
  return (
    toNumber(line?.requested_package_no, 0) > 0 &&
    toNumber(line?.requested_package_total, 0) > 0
  );
}

function requestedPackageNo(line) {
  return Math.round(toNumber(line?.requested_package_no, 0));
}

function requestedPackageTotal(line, product) {
  return Math.round(
    toNumber(
      line?.requested_package_total,
      packageCountFromProduct(product)
    )
  );
}

function requiredPackageCountForLine(line, product) {
  const qty = Math.max(0, toNumber(line?.quantity_ordered, 0));

  if (lineRequestsSinglePackage(line)) {
    return qty;
  }

const stockUnits = requiredStockUnitsForLine(line, product);
return stockUnits * packageCountFromProduct(product);
}

  function calculateOrderPackages(order) {
    const lines = Array.isArray(order?.order_lines)
  ? order.order_lines.filter(line => normalize(line.line_type) !== "manual")
  : [];

    const result = {
      requiredProducts: 0,
      matchedProducts: 0,
      missingProducts: 0,
      requiredPackages: 0,
      matchedPackages: 0,
      missingPackages: 0,
      productMatchPct: 0,
      packageMatchPct: 0,
      complete: false,
      lines: []
    };

    lines.forEach(line => {
      const product = line.products || {};
      const qty = Math.max(0, toNumber(line.quantity_ordered, 0));
  const miscellaneous = isMiscellaneousLine(line);
      const packageCount = packageCountFromProduct(product);

      const activeAllocations = (line.order_allocations || []).filter(isActiveAllocation);

      const physicalIds = new Set();

      activeAllocations.forEach(allocation => {
        const physicalId =
          allocation?.items?.physical_product_id ||
          allocation?.physical_product_id ||
          allocation?.stock_set_id ||
          allocation?.item_id;

        if (physicalId) physicalIds.add(String(physicalId));
      });

const matchedStockUnits =
  physicalIds.size ||
  activeAllocations.length;

const matchedProductsRaw =
  miscellaneous
    ? qty
    : Math.min(
        qty,
        matchedStockUnits *
          salesUnitsPerPackage(product)
      );

const requiredPackages = miscellaneous
  ? qty
  : requiredPackageCountForLine(line, product);

const matchedPackagesRaw = miscellaneous
  ? requiredPackages
  : activeAllocations.reduce((sum, allocation) => {
      return sum + Math.max(
        1,
        Math.round(toNumber(allocation?.items?.package_total, packageCount))
      );
    }, 0);

      const lineSummary = {
        order_line_id: line.id,
        product_id: line.product_id || product.id || null,
        sku_base: line.sku_base || product.sku_base || "Missing SKU",
        product_name: product.name || product.description || line.description || "Unknown product",
        requiredProducts: qty,
        matchedProducts: Math.min(matchedProductsRaw, qty),
        missingProducts: Math.max(0, qty - matchedProductsRaw),
        requiredPackages,
        matchedPackages: Math.min(matchedPackagesRaw, requiredPackages),
        missingPackages: Math.max(0, requiredPackages - matchedPackagesRaw),
        packageCount,
requested_package_no: line.requested_package_no || null,
requested_package_total: line.requested_package_total || null,
requested_package_label: line.requested_package_label || null
      };

      result.requiredProducts += lineSummary.requiredProducts;
      result.matchedProducts += lineSummary.matchedProducts;
      result.missingProducts += lineSummary.missingProducts;
      result.requiredPackages += lineSummary.requiredPackages;
      result.matchedPackages += lineSummary.matchedPackages;
      result.missingPackages += lineSummary.missingPackages;
      result.lines.push(lineSummary);
    });

    result.packageMatchPct = result.requiredPackages > 0
      ? Math.min(100, Math.round((result.matchedPackages / result.requiredPackages) * 100))
      : 0;

    result.productMatchPct = result.requiredProducts > 0
      ? Math.min(100, Math.round((result.matchedProducts / result.requiredProducts) * 100))
      : 0;

    result.complete = result.requiredPackages > 0 && result.missingPackages <= 0;

    return result;
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

async function fetchOrders(
  client,
  companyId,
  options = {}
) {
  let query = client
    .from("orders")
    .select(`
      id,
      company_id,
      customer_id,
      order_number,
      external_reference,
      created_at,
      status,
      planning_release,
      planning_colli,
      planning_volume_m3,
      delivery_city,
      delivery_postcode,
      delivery_lat,
      delivery_lng,

      expected_match_status,
      expected_complete_date,
      expected_allocated_quantity,
      expected_allocated_packages,
      expected_allocated_volume_m3,
      expected_allocated_weight_kg,
      is_expected_complete,

      customers (
        id,
        name
      ),

      order_lines (
        id,
        order_id,
        product_id,
        sku_base,
        description,
        line_type,

        quantity_ordered,
        requested_package_no,
        requested_package_total,
        requested_package_label,

        total_volume_m3,
        total_line_volume_m3,
        total_line_weight_kg,

        expected_quantity_allocated,
        expected_packages_allocated,
        expected_volume_m3,
        expected_weight_kg,
        expected_complete_date,

        order_line_stock_priorities (
          id,
          priority_level,
          priority_status,
          reason,
          created_at,
          fulfilled_at
        ),

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
          company_id,
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
            warehouse_id,
            location_id,

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
      companyId
    )
    .order(
      "created_at",
      {
        ascending: true
      }
    );

  if (
    Array.isArray(options.orderIds) &&
    options.orderIds.length
  ) {
    query = query.in(
      "id",
      options.orderIds
    );
  } else {
    query = query.in(
      "status",
      [
        "imported",
        "matching_review",
        "ready_for_planning",
        "ready_for_picking"
      ]
    );
  }

  const { data, error } =
    await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchAvailableItemSets(
  client,
  companyId,
  productIds = []
) {
  const wantedProductIds =
    unique(
      (productIds || [])
        .map(value =>
          String(
            value ||
            ""
          ).trim()
        )
        .filter(Boolean)
    );

  if (
    !wantedProductIds.length
  ) {
    return [];
  }


  const pageSize =
    1000;

  let from =
    0;

  let allItems =
    [];


  while (true) {
    const to =
      from +
      pageSize -
      1;


    const {
      data,
      error
    } =
      await client
        .from("items")
        .select(`
          id,
          company_id,
          product_id,
          warehouse_id,
          location_id,

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

          inbound_reference,
          inbound_date,
          created_at,

          package_condition,
          condition_notes,

          is_match_blocked,
          match_block_reason,

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
          )
        `)
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "status",
          "in_stock"
        )
        .eq(
          "is_match_blocked",
          false
        )
        .not(
          "physical_product_id",
          "is",
          null
        )
        .in(
          "product_id",
          wantedProductIds
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        )
        .range(
          from,
          to
        );


    if (error) {
      throw error;
    }


    const rows =
      data || [];


    /*
     * Alleen physically present én matchable packages.
     *
     * complete       => toegestaan
     * open_complete  => toegestaan
     * open_incomplete => NIET toegestaan
     * damaged         => NIET toegestaan
     * missing         => NIET toegestaan
     */
    const matchableRows =
      rows.filter(item => {
        const condition =
          normalize(
            item.package_condition ||
            "complete"
          );

        return (
          condition ===
            "complete" ||
          condition ===
            "open_complete"
        );
      });


    allItems.push(
      ...matchableRows
    );


    if (
      rows.length <
      pageSize
    ) {
      break;
    }


    from +=
      pageSize;
  }


  /*
   * Groepeer fysieke packages per physical_product_id.
   *
   * Alleen als ALLE vereiste packages aanwezig en matchable zijn,
   * wordt de fysieke set aangeboden aan de allocation engine.
   */
  const groups =
    new Map();


  allItems.forEach(item => {
    if (
      !item.product_id
    ) {
      return;
    }

    if (
      !item.physical_product_id
    ) {
      return;
    }

    if (
      normalize(
        item.status
      ) !==
      "in_stock"
    ) {
      return;
    }

    if (
      isOutboundStatus(
        item.status
      )
    ) {
      return;
    }

    if (
      item.is_match_blocked ===
      true
    ) {
      return;
    }


    const condition =
      normalize(
        item.package_condition ||
        "complete"
      );


    if (
      ![
        "complete",
        "open_complete"
      ].includes(
        condition
      )
    ) {
      return;
    }


    const key =
      String(
        item.physical_product_id
      );


    if (
      !groups.has(
        key
      )
    ) {
      groups.set(
        key,
        []
      );
    }


    groups
      .get(key)
      .push(item);
  });


  const sets =
    [];


  for (
    const [
      physicalProductId,
      items
    ]
    of groups.entries()
  ) {
    if (
      !items.length
    ) {
      continue;
    }


    const packageTotal =
      Math.max(
        1,
        ...items.map(item =>
          toNumber(
            item.package_total,
            1
          )
        )
      );


    /*
     * Controleer expliciet of elk vereiste package aanwezig is.
     *
     * Voor een 2-delige set moeten dus zowel 1/2 als 2/2
     * in deze matchable groep voorkomen.
     */
    const present =
      new Set(
        items.map(item =>
          Math.max(
            1,
            Math.round(
              toNumber(
                item.package_no,
                1
              )
            )
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


    if (!complete) {
      /*
       * Bijvoorbeeld:
       *
       * 1/2 = complete
       * 2/2 = blocked
       *
       * Dan zit 2/2 niet in allItems en wordt
       * de hele fysieke set hier afgekeurd.
       */
      continue;
    }


    const sortedItems =
      [...items]
        .sort(
          (a, b) => {
            const packageA =
              toNumber(
                a.package_no,
                1
              );

            const packageB =
              toNumber(
                b.package_no,
                1
              );

            return (
              packageA -
              packageB
            );
          }
        );


    /*
     * Extra veiligheid:
     * precies één matchable package-record per package number
     * gebruiken voor deze physical set.
     */
    const uniquePackageItems =
      [];


    const seenPackageNos =
      new Set();


    sortedItems.forEach(item => {
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


      if (
        seenPackageNos.has(
          packageNo
        )
      ) {
        return;
      }


      seenPackageNos.add(
        packageNo
      );


      uniquePackageItems.push(
        item
      );
    });


    if (
      uniquePackageItems.length <
      packageTotal
    ) {
      continue;
    }


    const firstItem =
      uniquePackageItems[0];


    const product =
      firstItem.products ||
      {};


    sets.push({
      id:
        `physical:${physicalProductId}`,

      company_id:
        companyId,

      product_id:
        firstItem.product_id,

      physical_product_id:
        physicalProductId,

      stock_set_id:
        firstItem.stock_set_id ||
        null,

      set_code:
        physicalProductId,

      status:
        "complete",

      package_total:
        packageTotal,

      package_count:
        uniquePackageItems.length,

      volume_m3:
        productVolume(
          product
        ),

      weight_kg:
        productWeight(
          product
        ),

      warehouse_id:
        firstItem.warehouse_id ||
        null,

      location_id:
        firstItem.location_id ||
        null,

      created_at:
        firstItem.inbound_date ||
        firstItem.created_at ||
        null,

      products:
        product,

      items:
        uniquePackageItems
    });
  }


  return sets.sort(
    (a, b) => {
      const dateA =
        new Date(
          a.created_at ||
          0
        ).getTime();

      const dateB =
        new Date(
          b.created_at ||
          0
        ).getTime();


      return (
        dateA -
        dateB
      );
    }
  );
}

async function fetchExpectedStock(
  client,
  companyId,
  productIds = []
) {
  const wantedProductIds = unique(
    (productIds || [])
      .map(value =>
        String(value || "").trim()
      )
      .filter(Boolean)
  );

  if (!wantedProductIds.length) {
    return [];
  }

  const pageSize = 1000;
  let from = 0;
  const allRows = [];

  while (true) {
    const to =
      from + pageSize - 1;

    const { data, error } =
      await client
        .from("expected_stock_overview")
        .select(`
          company_id,
          product_owner_id,
          container_id,
          container_number,
          container_status,
          eta_warehouse_date,
          warehouse_id,
          location_id,
          container_line_id,
          product_id,
          sku_snapshot,
          product_name_snapshot,
          description_snapshot,
          expected_quantity,
          expected_packages,
          packages_per_unit,
          expected_volume_m3,
          expected_weight_kg,
          expected_allocated_quantity,
          expected_available_quantity,
          expected_order_count,
          receipt_status,
          is_expected_stock
        `)
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "is_expected_stock",
          true
        )
        .gt(
          "expected_available_quantity",
          0
        )
        .in(
          "product_id",
          wantedProductIds
        )
        .order(
          "eta_warehouse_date",
          {
            ascending: true,
            nullsFirst: false
          }
        )
        .order(
          "container_number",
          {
            ascending: true
          }
        )
        .range(from, to);

    if (error) {
      throw error;
    }

    const rows = data || [];

    allRows.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allRows;
}

function buildExpectedStockMap(rows) {
  const map = new Map();

  (rows || []).forEach(row => {
    if (!row.product_id) {
      return;
    }

    const available =
      Math.max(
        0,
        Math.round(
          toNumber(
            row.expected_available_quantity,
            0
          )
        )
      );

    if (!available) {
      return;
    }

    const productKey =
      String(row.product_id);

    if (!map.has(productKey)) {
      map.set(productKey, []);
    }

    map.get(productKey).push({
      ...row,
      remaining_quantity:
        available
    });
  });

  map.forEach(pool => {
    pool.sort((a, b) => {
      const dateA = new Date(
        a.eta_warehouse_date || "9999-12-31"
      ).getTime();

      const dateB = new Date(
        b.eta_warehouse_date || "9999-12-31"
      ).getTime();

      if (dateA !== dateB) {
        return dateA - dateB;
      }

      return String(
        a.container_number || ""
      ).localeCompare(
        String(
          b.container_number || ""
        ),
        "en",
        {
          numeric: true,
          sensitivity: "base"
        }
      );
    });
  });

  return map;
}



function filterOrdersForProduct(
  orders,
  productId,
  priorityOnly = false
) {
  return (orders || [])
    .map(order => {
      const matchingLines =
        (order.order_lines || []).filter(line => {
          if (
            productId &&
            String(line.product_id || "") !==
              String(productId)
          ) {
            return false;
          }

          if (
            priorityOnly &&
            getLinePriorityLevel(line) <= 0
          ) {
            return false;
          }

          return true;
        });

      if (!matchingLines.length) {
        return null;
      }

      return {
        ...order,
        order_lines: matchingLines
      };
    })
    .filter(Boolean);
}
  async function fetchExistingAllocations(client, companyId) {
    const { data, error } = await client
      .from("order_allocations")
      .select(`
        id,
        company_id,
        order_line_id,
        item_id,
        stock_set_id,
        allocation_status,
        allocated_at,
        items (
          id,
          product_id,
          status,
          volume_m3,
          weight_kg,
          package_no,
          package_total,
          package_label,
          physical_product_id,
          stock_set_id
        )
      `)
      .eq("company_id", companyId);

    if (error) throw error;
    return data || [];
  }

  function allocationPhysicalKey(alloc) {
    const physicalId = alloc?.items?.physical_product_id || null;
    if (physicalId) return `physical:${physicalId}`;

    if (alloc?.stock_set_id) return `stock_set:${alloc.stock_set_id}`;
    if (alloc?.item_id) return `item:${alloc.item_id}`;

    return null;
  }

  function getLineAllocations(line) {
    return (line.order_allocations || []).filter(isActiveAllocation);
  }

function isActiveExpectedAllocation(row) {
  return (
    row &&
    normalize(row.status) === "expected"
  );
}

function getLineExpectedAllocations(line) {
  return (
    line.inbound_expected_allocations || []
  ).filter(isActiveExpectedAllocation);
}

function getExpectedAllocationQuantity(line) {
  return getLineExpectedAllocations(line)
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

function getExpectedAllocationDate(line) {
  const dates = getLineExpectedAllocations(line)
    .map(allocation =>
      allocation.inbound_containers
        ?.eta_warehouse_date ||
      allocation.eta_warehouse_date ||
      null
    )
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(date =>
      !Number.isNaN(date.getTime())
    );

  if (!dates.length) {
    return null;
  }

  return new Date(
    Math.max(
      ...dates.map(date =>
        date.getTime()
      )
    )
  )
    .toISOString()
    .slice(0, 10);
}

function expectedStockUnitVolume(row) {
  const quantity = Math.max(
    1,
    toNumber(row.expected_quantity, 1)
  );

  return (
    toNumber(
      row.expected_volume_m3,
      0
    ) / quantity
  );
}

function expectedStockUnitWeight(row) {
  const quantity = Math.max(
    1,
    toNumber(row.expected_quantity, 1)
  );

  return (
    toNumber(
      row.expected_weight_kg,
      0
    ) / quantity
  );
}

function getLinePriorityRecord(line) {
  const value = line?.order_line_stock_priorities;

  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];

  return rows.find(row =>
    normalize(row.priority_status) === "active"
  ) || null;
}

function getLinePriorityLevel(line) {
  const level = Math.round(
    toNumber(
      getLinePriorityRecord(line)?.priority_level,
      0
    )
  );

  if (level === 200) return 200;
  if (level === 100) return 100;

  return 0;
}

function getLinePriorityCreatedAt(line) {
  const value =
    getLinePriorityRecord(line)?.created_at;

  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : Number.MAX_SAFE_INTEGER;
}

function getOrderCreatedAt(order) {
  const timestamp = new Date(
    order?.created_at || 0
  ).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

  function allocatedSetKeysFromAllocations(allocations) {
    const keys = new Set();

    (allocations || []).forEach(alloc => {
      const key = allocationPhysicalKey(alloc);
      if (key) keys.add(String(key));
    });

    return keys;
  }

  function allocationSetVolume(alloc, product) {
    if (alloc?.items?.physical_product_id) {
      return productVolume(product);
    }

    if (alloc?.items?.volume_m3 != null && alloc?.items?.package_total != null) {
      return toNumber(alloc.items.volume_m3, 0) * toNumber(alloc.items.package_total, 1);
    }

    return productVolume(product);
  }

  function allocationSetWeight(alloc, product) {
    if (alloc?.items?.physical_product_id) {
      return productWeight(product);
    }

    if (alloc?.items?.weight_kg != null && alloc?.items?.package_total != null) {
      return toNumber(alloc.items.weight_kg, 0) * toNumber(alloc.items.package_total, 1);
    }

    return productWeight(product);
  }

  function allocationPackageCount(alloc) {
    if (alloc?.stock_set_package_count != null) {
      return toNumber(alloc.stock_set_package_count, 1);
    }

    if (alloc?.items?.package_total != null) {
      return toNumber(alloc.items.package_total, 1);
    }

    return 1;
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

function calculateOrderSummary(
  order,
  pendingAllocations = [],
  pendingExpectedAllocations = []
) {
  const lines = Array.isArray(
    order.order_lines
  )
    ? order.order_lines.filter(line =>
        normalize(line.line_type) !==
        "manual"
      )
    : [];

  const packageStats =
    calculateOrderPackages(order);

  let totalLines =
    lines.length;

  let totalRequired = 0;

  let totalPhysicalAllocated = 0;
  let totalExpectedAllocated = 0;
  let totalCombinedAllocated = 0;

  let totalAllocatedColli = 0;
  let totalExpectedColli = 0;

  let totalPhysicalMissing = 0;
  let totalCombinedMissing = 0;

  let missingProductLines = 0;

  let requestedVolume = 0;
  let requestedWeight = 0;

  let allocatedVolume = 0;
  let allocatedWeight = 0;

  let expectedVolume = 0;
  let expectedWeight = 0;

  const expectedDates = [];

  const lineSummaries = lines.map(line => {
    const product =
      line.products || {};

    const miscellaneous =
      isMiscellaneousLine(line);

    const required = miscellaneous
      ? Math.max(
          0,
          toNumber(
            line.quantity_ordered,
            0
          )
        )
      : requiredStockUnitsForLine(
          line,
          product
        );

    const existingAllocations =
      getLineAllocations(line);

    const existingSetKeys =
      allocatedSetKeysFromAllocations(
        existingAllocations
      );

    const pendingPhysicalForLine =
      pendingAllocations.filter(
        allocation =>
          String(
            allocation.order_line_id
          ) === String(line.id)
      );

    const pendingPhysicalKeys =
      allocatedSetKeysFromAllocations(
        pendingPhysicalForLine
      );

    const physicalAllocated =
      miscellaneous
        ? required
        : existingSetKeys.size +
          pendingPhysicalKeys.size;

    const existingExpectedQuantity =
      getExpectedAllocationQuantity(line);

    const pendingExpectedForLine =
      pendingExpectedAllocations.filter(
        allocation =>
          String(
            allocation.order_line_id
          ) === String(line.id)
      );

    const pendingExpectedQuantity =
      pendingExpectedForLine.reduce(
        (total, allocation) =>
          total +
          toNumber(
            allocation.expected_quantity,
            0
          ),
        0
      );

    const expectedAllocated =
      miscellaneous
        ? 0
        : Math.min(
            Math.max(
              0,
              required -
              physicalAllocated
            ),
            existingExpectedQuantity +
            pendingExpectedQuantity
          );

    const combinedAllocated =
      miscellaneous
        ? required
        : Math.min(
            required,
            physicalAllocated +
            expectedAllocated
          );

    const physicalMissing =
      Math.max(
        0,
        required -
        physicalAllocated
      );

    const combinedMissing =
      Math.max(
        0,
        required -
        combinedAllocated
      );

    if (
      !miscellaneous &&
      !line.product_id
    ) {
      missingProductLines += 1;
    }

    const lineRequestedVolume =
      miscellaneous
        ? toNumber(
            line.total_line_volume_m3 ??
            line.total_volume_m3,
            0
          )
        : required *
          productVolume(product);

    const lineRequestedWeight =
      miscellaneous
        ? toNumber(
            line.total_line_weight_kg,
            0
          )
        : required *
          productWeight(product);

    const existingUniqueBySet =
      new Map();

    existingAllocations.forEach(allocation => {
      const key =
        allocationPhysicalKey(
          allocation
        );

      if (
        key &&
        !existingUniqueBySet.has(
          String(key)
        )
      ) {
        existingUniqueBySet.set(
          String(key),
          allocation
        );
      }
    });

    const pendingUniqueBySet =
      new Map();

    pendingPhysicalForLine
      .forEach(allocation => {
        const key =
          allocationPhysicalKey(
            allocation
          );

        if (
          key &&
          !pendingUniqueBySet.has(
            String(key)
          )
        ) {
          pendingUniqueBySet.set(
            String(key),
            allocation
          );
        }
      });

    let lineAllocatedVolume = 0;
    let lineAllocatedWeight = 0;
    let lineAllocatedColli = 0;

    existingUniqueBySet.forEach(
      allocation => {
        lineAllocatedVolume +=
          allocationSetVolume(
            allocation,
            product
          );

        lineAllocatedWeight +=
          allocationSetWeight(
            allocation,
            product
          );

        lineAllocatedColli +=
          allocationPackageCount(
            allocation
          );
      }
    );

    pendingUniqueBySet.forEach(
      allocation => {
        lineAllocatedVolume +=
          toNumber(
            allocation.stock_set_volume_m3,
            productVolume(product)
          );

        lineAllocatedWeight +=
          toNumber(
            allocation.stock_set_weight_kg,
            productWeight(product)
          );

        lineAllocatedColli +=
          toNumber(
            allocation.stock_set_package_count,
            1
          );
      }
    );

    if (miscellaneous) {
      lineAllocatedColli =
        required;

      lineAllocatedVolume =
        lineRequestedVolume;

      lineAllocatedWeight =
        lineRequestedWeight;
    }

    const lineExpectedVolume =
      expectedAllocated *
      productVolume(product);

    const lineExpectedWeight =
      expectedAllocated *
      productWeight(product);

    const lineExpectedColli =
      expectedAllocated *
      packageCountFromProduct(product);

    const existingExpectedDate =
      getExpectedAllocationDate(line);

    if (existingExpectedDate) {
      expectedDates.push(
        existingExpectedDate
      );
    }

    pendingExpectedForLine
      .map(allocation =>
        allocation.eta_warehouse_date
      )
      .filter(Boolean)
      .forEach(date =>
        expectedDates.push(date)
      );

    totalRequired +=
      required;

    totalPhysicalAllocated +=
      physicalAllocated;

    totalExpectedAllocated +=
      expectedAllocated;

    totalCombinedAllocated +=
      combinedAllocated;

    totalAllocatedColli +=
      lineAllocatedColli;

    totalExpectedColli +=
      lineExpectedColli;

    totalPhysicalMissing +=
      physicalMissing;

    totalCombinedMissing +=
      combinedMissing;

    requestedVolume +=
      lineRequestedVolume;

    requestedWeight +=
      lineRequestedWeight;

    allocatedVolume +=
      lineAllocatedVolume;

    allocatedWeight +=
      lineAllocatedWeight;

    expectedVolume +=
      lineExpectedVolume;

    expectedWeight +=
      lineExpectedWeight;

    return {
      order_line_id:
        line.id,

      product_id:
        line.product_id || null,

      sku_base:
        product.sku_base ||
        line.sku_base ||
        "Missing SKU",

      product_name:
        product.name ||
        line.description ||
        "Unknown product",

      required,

      allocated:
        physicalAllocated,

      expected_allocated:
        expectedAllocated,

      combined_allocated:
        combinedAllocated,

      allocated_colli:
        lineAllocatedColli,

      expected_colli:
        lineExpectedColli,

      missing:
        physicalMissing,

      combined_missing:
        combinedMissing,

      requested_volume_m3:
        lineRequestedVolume,

      requested_weight_kg:
        lineRequestedWeight,

      allocated_volume_m3:
        lineAllocatedVolume,

      allocated_weight_kg:
        lineAllocatedWeight,

      expected_volume_m3:
        lineExpectedVolume,

      expected_weight_kg:
        lineExpectedWeight,

      expected_complete_date:
        existingExpectedDate ||
        pendingExpectedForLine
          .map(row =>
            row.eta_warehouse_date
          )
          .filter(Boolean)
          .sort()
          .at(-1) ||
        null
    };
  });

  const physicalMatchPercentage =
    totalRequired > 0
      ? Math.min(
          100,
          (
            totalPhysicalAllocated /
            totalRequired
          ) * 100
        )
      : 0;

  const combinedMatchPercentage =
    totalRequired > 0
      ? Math.min(
          100,
          (
            totalCombinedAllocated /
            totalRequired
          ) * 100
        )
      : 0;

  let matchStatus =
    "none";

  if (missingProductLines > 0) {
    matchStatus =
      "missing_product";
  } else if (
    totalRequired > 0 &&
    totalPhysicalAllocated >=
      totalRequired
  ) {
    matchStatus =
      "full";
  } else if (
    totalPhysicalAllocated > 0
  ) {
    matchStatus =
      "partial";
  }

  let expectedMatchStatus =
    "none";

  if (
    totalRequired > 0 &&
    totalCombinedAllocated >=
      totalRequired &&
    totalPhysicalAllocated <
      totalRequired
  ) {
    expectedMatchStatus =
      "full";
  } else if (
    totalExpectedAllocated > 0
  ) {
    expectedMatchStatus =
      "partial";
  }

  const physicalBlockers = [];

  if (!totalLines) {
    physicalBlockers.push(
      "No order lines"
    );
  }

  if (missingProductLines) {
    physicalBlockers.push(
      `${missingProductLines} line(s) missing product`
    );
  }

  if (totalRequired <= 0) {
    physicalBlockers.push(
      "No required quantity"
    );
  }

  if (
    totalPhysicalAllocated <
    totalRequired
  ) {
    physicalBlockers.push(
      `${totalRequired - totalPhysicalAllocated} complete product(s) not physically available`
    );
  }

  if (!hasCoordinates(order)) {
    physicalBlockers.push(
      "Missing coordinates"
    );
  }

  const expectedCompleteDate =
    expectedDates.length
      ? expectedDates
          .filter(Boolean)
          .sort()
          .at(-1)
      : null;

  let suggestedStatus =
    ORDER_STATUSES.NO_MATCH;

  if (!totalLines) {
    suggestedStatus =
      ORDER_STATUSES.NO_LINES;
  } else if (
    matchStatus === "full"
  ) {
    suggestedStatus =
      ORDER_STATUSES.FULL;
  } else if (
    matchStatus === "partial" ||
    expectedMatchStatus !== "none"
  ) {
    suggestedStatus =
      ORDER_STATUSES.PARTIAL;
  }

  return {
    order_id:
      order.id,

    order_number:
      order.order_number,

    customer_name:
      order.customers?.name ||
      order.customer_name ||
      "—",

    total_lines:
      totalLines,

    total_required:
      totalRequired,

    total_allocated:
      totalPhysicalAllocated,

    total_expected_allocated:
      totalExpectedAllocated,

    total_combined_allocated:
      totalCombinedAllocated,

    total_allocated_colli:
      totalAllocatedColli,

    total_expected_colli:
      totalExpectedColli,

    total_missing:
      totalPhysicalMissing,

    total_combined_missing:
      totalCombinedMissing,

    required_products:
      packageStats.requiredProducts,

    matched_products:
      packageStats.matchedProducts,

    missing_products:
      packageStats.missingProducts,

    required_packages:
      packageStats.requiredPackages,

    matched_packages:
      packageStats.matchedPackages,

    expected_packages:
      totalExpectedColli,

    combined_packages:
      totalAllocatedColli +
      totalExpectedColli,

    missing_packages:
      packageStats.missingPackages,

    product_match_pct:
      packageStats.productMatchPct,

    package_match_pct:
      packageStats.packageMatchPct,

    missing_product_lines:
      missingProductLines,

    match_percentage:
      physicalMatchPercentage,

    combined_match_percentage:
      combinedMatchPercentage,

    match_status:
      matchStatus,

    expected_match_status:
      expectedMatchStatus,

    is_expected_complete:
      expectedMatchStatus ===
      "full",

    expected_complete_date:
      expectedCompleteDate,

    suggested_status:
      suggestedStatus,

    /*
     * Nog alleen fysieke voorraad mag rechtstreeks
     * ready_for_planning zijn.
     *
     * Dit wordt later uitgebreid met datumcontrole.
     */
    ready_for_planning:
      physicalBlockers.length === 0,

    has_coordinates:
      hasCoordinates(order),

    requested_volume_m3:
      requestedVolume,

    requested_weight_kg:
      requestedWeight,

    allocated_volume_m3:
      allocatedVolume,

    allocated_weight_kg:
      allocatedWeight,

    expected_volume_m3:
      expectedVolume,

    expected_weight_kg:
      expectedWeight,

    combined_volume_m3:
      allocatedVolume +
      expectedVolume,

    combined_weight_kg:
      allocatedWeight +
      expectedWeight,

    blockers:
      physicalBlockers,

    lines:
      lineSummaries,

    package_lines:
      packageStats.lines
  };
}


  function buildAvailableSetMap(sets, activeAllocatedSetKeys) {
    const map = new Map();

    (sets || []).forEach(set => {
      if (!set.product_id) return;

      const key = String(set.id);
      if (activeAllocatedSetKeys.has(key)) return;

      const productKey = String(set.product_id);
      if (!map.has(productKey)) map.set(productKey, []);

      map.get(productKey).push(set);
    });

    return map;
  }

  function buildAllocations(
  companyId,
  orders,
  availableSetMap,
  timestamp
) {
  const allocationRows = [];
  const reservedItemIds = [];

  /*
   * Houd per order de pending allocaties bij.
   * Deze worden later gebruikt voor de herberekening
   * van order- en orderregeltotalen.
   */
  const pendingByOrderId = new Map();

  (orders || []).forEach(order => {
    pendingByOrderId.set(
      String(order.id),
      []
    );
  });

  /*
   * Maak één globale wachtrij van alle orderregels.
   *
   * Hierdoor wordt niet eerst een volledige order
   * afgewerkt. Iedere afzonderlijke productregel
   * concurreert correct om de beschikbare voorraad.
   */
  const allocationTasks = [];

  (orders || []).forEach(order => {
    (order.order_lines || [])
      .filter(
        line =>
          normalize(line.line_type) !==
          "manual"
      )
      .forEach(line => {
        allocationTasks.push({
          order,
          line,
          priorityLevel:
            getLinePriorityLevel(line),
          priorityCreatedAt:
            getLinePriorityCreatedAt(line),
          orderCreatedAt:
            getOrderCreatedAt(order)
        });
      });
  });

  /*
   * Verdeelvolgorde:
   *
   * 1. Critical (200)
   * 2. Priority (100)
   * 3. Normal (0)
   * 4. Bij gelijke priority: oudste priority eerst
   * 5. Daarna oudste order eerst
   */
  allocationTasks.sort((a, b) => {
    if (
      b.priorityLevel !==
      a.priorityLevel
    ) {
      return (
        b.priorityLevel -
        a.priorityLevel
      );
    }

    if (
      a.priorityCreatedAt !==
      b.priorityCreatedAt
    ) {
      return (
        a.priorityCreatedAt -
        b.priorityCreatedAt
      );
    }

    if (
      a.orderCreatedAt !==
      b.orderCreatedAt
    ) {
      return (
        a.orderCreatedAt -
        b.orderCreatedAt
      );
    }

    const orderCompare = String(
      a.order?.order_number || ""
    ).localeCompare(
      String(
        b.order?.order_number || ""
      ),
      "en",
      {
        numeric: true,
        sensitivity: "base"
      }
    );

    if (orderCompare !== 0) {
      return orderCompare;
    }

    return String(a.line?.id || "")
      .localeCompare(
        String(b.line?.id || "")
      );
  });

  allocationTasks.forEach(task => {
    const { order, line } = task;
if (isMiscellaneousLine(line)) {
  return;
}

    const orderKey = String(order.id);

    const pendingForOrder =
      pendingByOrderId.get(orderKey) || [];

    const required =
      requiredStockUnitsForLine(
        line,
        line.products || {}
      );

    const existingSetKeys =
      allocatedSetKeysFromAllocations(
        getLineAllocations(line)
      );

    const pendingSetKeys =
      allocatedSetKeysFromAllocations(
        pendingForOrder.filter(
          allocation =>
            String(
              allocation.order_line_id
            ) === String(line.id)
        )
      );

    const missing = Math.max(
      0,
      required -
        existingSetKeys.size -
        pendingSetKeys.size
    );

    if (
      !missing ||
      !line.product_id
    ) {
      return;
    }

    const pool =
      availableSetMap.get(
        String(line.product_id)
      ) || [];

    /*
     * Orderregel vraagt om één specifiek package,
     * bijvoorbeeld package 1/2.
     */
    if (lineRequestsSinglePackage(line)) {
      const wantedNo =
        requestedPackageNo(line);

      const wantedTotal =
        requestedPackageTotal(
          line,
          line.products || {}
        );

      let taken = 0;

      for (
        let index = 0;
        index < pool.length &&
        taken < missing;

      ) {
        const set = pool[index];
        const items = set.items || [];

        const packageItem =
          items.find(item =>
            toNumber(
              item.package_no,
              0
            ) === wantedNo &&
            toNumber(
              item.package_total,
              0
            ) === wantedTotal
          );

        if (!packageItem?.id) {
          index++;
          continue;
        }

        /*
         * De fysieke set wordt uit de vrije pool
         * verwijderd, zodat hij niet nogmaals aan
         * een andere regel kan worden aangeboden.
         */
        pool.splice(index, 1);
        taken++;

        const row = {
          company_id: companyId,
          order_id: order.id,
          order_line_id: line.id,
          item_id: packageItem.id,
          reserved_item_ids: [
            packageItem.id
          ],
          stock_set_id: null,
          physical_product_id:
            set.physical_product_id,
          allocation_status: "reserved",
          allocated_at: timestamp,
          allocated_by_profile_id: null,

          stock_set_volume_m3:
            toNumber(
              packageItem.volume_m3,
              0
            ),

          stock_set_weight_kg:
            toNumber(
              packageItem.weight_kg,
              0
            ),

          stock_set_package_count: 1,

          priority_level:
            task.priorityLevel,

          items: {
            id: packageItem.id,
            physical_product_id:
              set.physical_product_id,
            package_no:
              packageItem.package_no,
            package_total:
              packageItem.package_total,
            package_label:
              packageItem.package_label
          }
        };

        allocationRows.push(row);
        pendingForOrder.push(row);
        reservedItemIds.push(
          packageItem.id
        );
      }

      pendingByOrderId.set(
        orderKey,
        pendingForOrder
      );

      return;
    }

    /*
     * Normale complete fysieke producten.
     */
    const takenSets = pool.splice(
      0,
      missing
    );

    takenSets.forEach(set => {
      const items = set.items || [];
      const firstItem = items[0] || null;

      if (!firstItem?.id) return;

      const row = {
        company_id: companyId,
        order_id: order.id,
        order_line_id: line.id,
        item_id: firstItem.id,

        reserved_item_ids:
          items
            .map(item => item.id)
            .filter(Boolean),

        stock_set_id: null,

        physical_product_id:
          set.physical_product_id,

        allocation_status: "reserved",
        allocated_at: timestamp,
        allocated_by_profile_id: null,

        stock_set_volume_m3:
          toNumber(
            set.volume_m3,
            line.products?.volume_m3 || 0
          ),

        stock_set_weight_kg:
          toNumber(
            set.weight_kg,
            line.products?.weight_kg || 0
          ),

        stock_set_package_count:
          items.length ||
          toNumber(
            set.package_count,
            1
          ),

        priority_level:
          task.priorityLevel,

        items: {
          id: firstItem.id,
          physical_product_id:
            set.physical_product_id,
          package_total:
            set.package_total
        }
      };

      allocationRows.push(row);
      pendingForOrder.push(row);

      items.forEach(item => {
        if (item.id) {
          reservedItemIds.push(
            item.id
          );
        }
      });
    });

    pendingByOrderId.set(
      orderKey,
      pendingForOrder
    );
  });

  /*
   * Alle gecontroleerde orders blijven in
   * touchedOrders staan, ook als geen nieuwe
   * voorraad beschikbaar was.
   */
  const touchedOrders =
    (orders || []).map(order => ({
      order,
      pendingAllocations:
        pendingByOrderId.get(
          String(order.id)
        ) || []
    }));

  return {
    allocationRows,
    reservedItemIds,
    touchedOrders
  };
}

function buildExpectedAllocations(
  companyId,
  touchedOrders,
  expectedStockMap,
  timestamp
) {
  const expectedAllocationRows = [];

  const allocationTasks = [];

  (touchedOrders || []).forEach(entry => {
    const order = entry.order;

    (
      order.order_lines || []
    )
      .filter(line =>
        normalize(line.line_type) !==
        "manual"
      )
      .forEach(line => {
        allocationTasks.push({
          order,
          line,
          pendingPhysicalAllocations:
            entry.pendingAllocations || [],

          priorityLevel:
            getLinePriorityLevel(line),

          priorityCreatedAt:
            getLinePriorityCreatedAt(line),

          orderCreatedAt:
            getOrderCreatedAt(order)
        });
      });
  });

  allocationTasks.sort((a, b) => {
    if (
      b.priorityLevel !==
      a.priorityLevel
    ) {
      return (
        b.priorityLevel -
        a.priorityLevel
      );
    }

    if (
      a.priorityCreatedAt !==
      b.priorityCreatedAt
    ) {
      return (
        a.priorityCreatedAt -
        b.priorityCreatedAt
      );
    }

    if (
      a.orderCreatedAt !==
      b.orderCreatedAt
    ) {
      return (
        a.orderCreatedAt -
        b.orderCreatedAt
      );
    }

    return String(
      a.order.order_number || ""
    ).localeCompare(
      String(
        b.order.order_number || ""
      ),
      "en",
      {
        numeric: true,
        sensitivity: "base"
      }
    );
  });

  allocationTasks.forEach(task => {
    const {
      order,
      line,
      pendingPhysicalAllocations
    } = task;

    if (isMiscellaneousLine(line)) {
      return;
    }

    if (!line.product_id) {
      return;
    }

    const product =
      line.products || {};

    const required =
      requiredStockUnitsForLine(
        line,
        product
      );

    const existingPhysicalKeys =
      allocatedSetKeysFromAllocations(
        getLineAllocations(line)
      );

    const pendingPhysicalForLine =
      pendingPhysicalAllocations.filter(
        allocation =>
          String(
            allocation.order_line_id
          ) === String(line.id)
      );

    const pendingPhysicalKeys =
      allocatedSetKeysFromAllocations(
        pendingPhysicalForLine
      );

    const existingExpectedQuantity =
      getExpectedAllocationQuantity(line);

    const stillMissing = Math.max(
      0,
      required -
      existingPhysicalKeys.size -
      pendingPhysicalKeys.size -
      existingExpectedQuantity
    );

    if (!stillMissing) {
      return;
    }

    const pool =
      expectedStockMap.get(
        String(line.product_id)
      ) || [];

    let quantityNeeded =
      stillMissing;

    for (
      let index = 0;
      index < pool.length &&
      quantityNeeded > 0;
      index++
    ) {
      const expectedRow =
        pool[index];

      const available =
        Math.max(
          0,
          Math.round(
            toNumber(
              expectedRow.remaining_quantity,
              0
            )
          )
        );

      if (!available) {
        continue;
      }

      const quantityToAllocate =
        Math.min(
          available,
          quantityNeeded
        );

      if (!quantityToAllocate) {
        continue;
      }

      expectedAllocationRows.push({
        company_id:
          companyId,

        container_id:
          expectedRow.container_id,

        container_line_id:
          expectedRow.container_line_id,

        order_id:
          order.id,

        order_line_id:
          line.id,

        expected_quantity:
          quantityToAllocate,

        status:
          "expected",

        allocated_at:
          timestamp,

        eta_warehouse_date:
          expectedRow.eta_warehouse_date,

        container_number:
          expectedRow.container_number,

        product_id:
          expectedRow.product_id,

        unit_volume_m3:
          expectedStockUnitVolume(
            expectedRow
          ),

        unit_weight_kg:
          expectedStockUnitWeight(
            expectedRow
          ),

        packages_per_unit:
          Math.max(
            1,
            Math.round(
              toNumber(
                expectedRow.packages_per_unit,
                packageCountFromProduct(product)
              )
            )
          )
      });

      expectedRow.remaining_quantity =
        available -
        quantityToAllocate;

      quantityNeeded -=
        quantityToAllocate;
    }
  });

console.log(
  "EXPECTED ALLOCATIONS",
  expectedAllocationRows
);

  return expectedAllocationRows;
}

  function rowsForInsert(rows) {
    return rows.map(row => ({
      company_id: row.company_id,
      order_line_id: row.order_line_id,
      item_id: row.item_id,
      stock_set_id: null,
      allocation_status: row.allocation_status,
      allocated_at: row.allocated_at,
      allocated_by_profile_id: row.allocated_by_profile_id
    }));
  }

async function insertAllocations(
  client,
  rows
) {
  if (!rows.length) {
    return;
  }

  const { error } = await client
    .from("order_allocations")
    .insert(
      rowsForInsert(rows)
    );

  if (error) {
    throw error;
  }
}

function buildOrderUpdates(
  touchedOrders,
  expectedAllocationRows = []
) {
  return touchedOrders.map(
    ({
      order,
      pendingAllocations
    }) => {
      const pendingExpected =
        expectedAllocationRows.filter(
          allocation =>
            String(allocation.order_id) ===
            String(order.id)
        );

      const summary =
        calculateOrderSummary(
          order,
          pendingAllocations,
          pendingExpected
        );

      return {
        order_id:
          order.id,

        old_status:
          order.status,

        new_status:
          summary.suggested_status,

        summary
      };
    }
  );
}

async function insertExpectedAllocations(
  client,
  rows
) {
  if (!rows.length) {
    return;
  }

  const insertRows = rows.map(row => ({
    company_id:
      row.company_id,

    container_id:
      row.container_id,

    container_line_id:
      row.container_line_id,

    order_id:
      row.order_id,

    order_line_id:
      row.order_line_id,

    expected_quantity:
      row.expected_quantity,

    status:
      "expected",

    created_at:
      row.allocated_at
  }));

  const { error } = await client
    .from("inbound_expected_allocations")
    .insert(insertRows);

  if (error) {
    throw error;
  }
}

 async function reserveItems(client, allocationRows, timestamp) {
  const byOrder = new Map();

  (allocationRows || []).forEach(row => {
    const orderId = row.order_id;
    const itemIds = row.reserved_item_ids || [row.item_id];

    if (!orderId) return;

    if (!byOrder.has(orderId)) byOrder.set(orderId, new Set());

    itemIds.forEach(id => {
      if (id) byOrder.get(orderId).add(id);
    });
  });

  for (const [orderId, idsSet] of byOrder.entries()) {
    const ids = [...idsSet];
    if (!ids.length) continue;

    const { error } = await client
      .from("items")
      .update({
        status: "reserved",
        linked_order_id: orderId,
        reserved_at: timestamp
      })
      .in("id", ids);

    if (error) throw error;
  }
}

async function updateOrders(
  client,
  updates
) {
  for (const row of updates) {
    const summary =
      row.summary;

    const payload = {
      status:
        row.new_status,

      planning_colli:
        summary.matched_packages ||
        summary.total_allocated_colli,

      planning_volume_m3:
        Number(
          summary.allocated_volume_m3
            .toFixed(3)
        ),

      expected_match_status:
        summary.expected_match_status,

      expected_complete_date:
        summary.expected_complete_date,

      expected_allocated_quantity:
        Math.round(
          summary.total_expected_allocated
        ),

      expected_allocated_packages:
        Math.round(
          summary.total_expected_colli
        ),

      expected_allocated_volume_m3:
        Number(
          summary.expected_volume_m3
            .toFixed(3)
        ),

      expected_allocated_weight_kg:
        Number(
          summary.expected_weight_kg
            .toFixed(3)
        ),

      is_expected_complete:
        Boolean(
          summary.is_expected_complete
        )
    };

    const { error } = await client
      .from("orders")
      .update(payload)
      .eq(
        "id",
        row.order_id
      );

    if (error) {
      throw error;
    }
  }
}

  async function updateOrderLines(
  client,
  updates
) {
  for (const row of updates) {
    for (
      const line
      of row.summary.lines || []
    ) {
      const packageLine =
        (
          row.summary.package_lines || []
        ).find(packageRow =>
          String(packageRow.order_line_id) ===
          String(line.order_line_id)
        );

      const allocatedProducts =
        packageLine?.matchedProducts ??
        line.allocated;

      const allocatedPackages =
        packageLine?.matchedPackages ??
        line.allocated_colli;

      const payload = {
        quantity_allocated:
          allocatedProducts,

        matched_quantity:
          allocatedProducts,

        matched_volume_m3:
          Number(
            line.allocated_volume_m3
              .toFixed(3)
          ),

        matched_weight_kg:
          Number(
            line.allocated_weight_kg
              .toFixed(3)
          ),

        matched_packages:
          allocatedPackages,

        expected_quantity_allocated:
          Math.round(
            line.expected_allocated
          ),

        expected_packages_allocated:
          Math.round(
            line.expected_colli
          ),

        expected_volume_m3:
          Number(
            line.expected_volume_m3
              .toFixed(3)
          ),

        expected_weight_kg:
          Number(
            line.expected_weight_kg
              .toFixed(3)
          ),

        expected_complete_date:
          line.expected_complete_date
      };

      const { error } = await client
        .from("order_lines")
        .update(payload)
        .eq(
          "id",
          line.order_line_id
        );

      if (error) {
        /*
         * Fallback voor het geval matched_packages
         * niet in deze databaseversie bestaat.
         */
        delete payload.matched_packages;

        const fallback =
          await client
            .from("order_lines")
            .update(payload)
            .eq(
              "id",
              line.order_line_id
            );

        if (fallback.error) {
          throw fallback.error;
        }
      }
    }
  }
}


  function buildEventRows(companyId, allocationRows, orderUpdates) {
    const events = [];

    allocationRows.forEach(row => {
      events.push({
        company_id: companyId,
        event_type: "allocation_created",
        entity_type: "order_allocation",
        entity_id: null,
        reference_no: row.physical_product_id || null,
        source_module: "allocation-engine",
        old_status: null,
        new_status: "reserved",
        payload: {
          order_line_id: row.order_line_id,
          item_id: row.item_id,
          stock_set_id: null,
          physical_product_id: row.physical_product_id || null,
          allocated_at: row.allocated_at
        }
      });

      events.push({
        company_id: companyId,
        event_type: "physical_stock_reserved",
        entity_type: "physical_product",
        entity_id: null,
        reference_no: row.physical_product_id || null,
        source_module: "allocation-engine",
        old_status: "in_stock",
        new_status: "reserved",
        payload: {
          order_line_id: row.order_line_id,
          item_id: row.item_id,
          physical_product_id: row.physical_product_id || null,
          package_count: row.stock_set_package_count || null
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
          total_allocated_colli: row.summary.total_allocated_colli,
          required_products: row.summary.required_products,
          matched_products: row.summary.matched_products,
          required_packages: row.summary.required_packages,
          matched_packages: row.summary.matched_packages,
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
  const client =
    sbClient();

  const companyId =
    await getCompanyId(client);

  const timestamp =
    nowIso();

  const dryRun =
    Boolean(options.dryRun);

  const fetchedOrders =
    await fetchOrders(
      client,
      companyId,
      options
    );

  const orders =
    filterOrdersForProduct(
      fetchedOrders,
      options.productId,
      Boolean(
        options.priorityOnly
      )
    );

  const requiredProductIds =
    unique(
      orders.flatMap(order =>
        (
          order.order_lines || []
        )
          .filter(line =>
            normalize(
              line.line_type
            ) !== "manual"
          )
          .map(line =>
            line.product_id
          )
          .filter(Boolean)
      )
    );

  const [
    availableSets,
    expectedStock,
    existingAllocations
  ] = await Promise.all([
    fetchAvailableItemSets(
      client,
      companyId,
      requiredProductIds
    ),

    fetchExpectedStock(
      client,
      companyId,
      requiredProductIds
    ),

    fetchExistingAllocations(
      client,
      companyId
    )
  ]);

  console.log(
    "EXPECTED STOCK",
    expectedStock
  );

  const activeAllocatedSetKeys =
    new Set();

  existingAllocations
    .filter(isActiveAllocation)
    .forEach(allocation => {
      const key =
        allocationPhysicalKey(
          allocation
        );

      if (key) {
        activeAllocatedSetKeys.add(
          String(key)
        );
      }
    });

  const availableSetMap =
    buildAvailableSetMap(
      availableSets,
      activeAllocatedSetKeys
    );

  const expectedStockMap =
    buildExpectedStockMap(
      expectedStock
    );

console.log(
  "EXPECTED STOCK MAP",
  expectedStockMap
);

  /*
   * Eerst fysieke voorraad verdelen.
   */
  const {
    allocationRows,
    reservedItemIds,
    touchedOrders
  } = buildAllocations(
    companyId,
    orders,
    availableSetMap,
    timestamp
  );

  /*
   * Daarna het resterende tekort uit
   * Expected Stock aanvullen.
   */
  const expectedAllocationRows =
    buildExpectedAllocations(
      companyId,
      touchedOrders,
      expectedStockMap,
      timestamp
    );

  const orderUpdates =
    buildOrderUpdates(
      touchedOrders,
      expectedAllocationRows
    );

  if (!dryRun) {
    await insertAllocations(
      client,
      allocationRows
    );

    await reserveItems(
      client,
      allocationRows,
      timestamp
    );

    await insertExpectedAllocations(
      client,
      expectedAllocationRows
    );

    await updateOrders(
      client,
      orderUpdates
    );

    await updateOrderLines(
      client,
      orderUpdates
    );

    const events =
      buildEventRows(
        companyId,
        allocationRows,
        orderUpdates
      );

    await logEvents(events);
  }

  return {
    dryRun,

    orders_checked:
      orders.length,

    available_stock_sets_checked:
      availableSets.length,

    expected_stock_lines_checked:
      expectedStock.length,

    allocations_created:
      allocationRows.length,

    expected_allocations_created:
      expectedAllocationRows.length,

    stock_sets_reserved:
      0,

    physical_sets_reserved:
      unique(
        allocationRows.map(row =>
          row.physical_product_id
        )
      ).length,

    items_reserved:
      unique(
        reservedItemIds
      ).length,

    order_updates:
      orderUpdates.length,

    summaries:
      orderUpdates.map(row =>
        row.summary
      )
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

async function runForProduct(
  productId,
  options = {}
) {
  if (!productId) {
    throw new Error(
      "Product id is required."
    );
  }

  return run({
    dryRun: Boolean(options.dryRun),
    productId,
    priorityOnly:
      Boolean(options.priorityOnly)
  });
}

window.AllocationEngine = {
  run,
  runSingleOrder,
  runForProduct,
  previewOrder,
  calculateOrderSummary,
  calculateOrderPackages,
  packageCountFromProduct
};
})();