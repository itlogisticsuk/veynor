(function () {
  "use strict";

  const DEBUG = true;

  let map = null;
  let depotLayer = null;
  let orderLayer = null;
  let routeLineLayer = null;
  let routeStopLayer = null;
  let selectionLayer = null;
  let vertexLayer = null;
let driverLocationLayer = null;
// UK emission zones
let emissionZoneLayer = null;
let emissionZonesGeoJson = null;
let emissionZonesLoading = null;

// Tenant-specific map visibility
let emissionZonesVisible = true;
let emissionSettingsLoading = null;

  let topControl = null;
  let panelControl = null;
  let legendControl = null;

  let panelMinimized = false;
  let mapExpanded = false;

  let selectedVehicleId = "";
  let selectedOrderIds = new Set();

  let selectionOperation = "select";
  let selectionMode = null;

  let circleCenter = null;
  let rectangleStart = null;
  let polygonPoints = [];

  let activeShape = null;
  let previewShape = null;
  let previewCache = null;

  const POLYGON_CLOSE_DISTANCE_PX = 18;

  const UK_BOUNDS = L.latLngBounds(
    L.latLng(49.5, -8.8),
    L.latLng(60.9, 2.2)
  );

  const ROUTE_COLORS = [
    "#2563eb",
    "#16a34a",
    "#7c3aed",
    "#f59e0b",
    "#dc2626",
    "#0891b2",
    "#9333ea",
    "#65a30d",
    "#ea580c",
    "#0f766e",
    "#ef4444",
    "#14b8a6",
    "#a855f7",
    "#84cc16"
  ];

  function log(...args) {
    if (DEBUG) console.log("[orders-map.js]", ...args);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
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

  function toNumber(value, fallback = null) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
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

  function routeColor(index) {
    return ROUTE_COLORS[index % ROUTE_COLORS.length];
  }

  function getVisibleOrders() {
    const rows = Array.isArray(window.ordersMapRows) ? window.ordersMapRows : [];
    const filters = window.orderMapFilters || {};

    return rows.filter(row => {
      if (!hasCoordinates(row)) return false;

      const transport = normalize(row.transport_type || "");
      if (filters.ownTransportOnly && transport !== "own_transport") return false;
      if (filters.charterOnly && transport !== "charter") return false;

      return true;
    });
  }

  function getAllRouteStops() {
    return Array.isArray(window.allRouteStopsMapRows) ? window.allRouteStopsMapRows : [];
  }

  function getSelectedRouteId() {
    return window.selectedRouteIdForMap || null;
  }

  function getDepotPoint() {
    return window.depotMapPoint || null;
  }

  function getActiveVehicles() {
    return Array.isArray(window.activeVehiclesMapRows) ? window.activeVehiclesMapRows : [];
  }

  function getLatitude(row) {
    return toNumber(row?.delivery_lat ?? row?.latitude ?? row?.lat);
  }

  function getLongitude(row) {
    return toNumber(row?.delivery_lng ?? row?.longitude ?? row?.lng);
  }

  function hasCoordinates(row) {
    return getLatitude(row) !== null && getLongitude(row) !== null;
  }

  function getOrderColli(row) {
    return toNumber(row?.planning_colli, 0);
  }

  function getOrderVolume(row) {
    return toNumber(row?.planning_volume_m3 ?? row?.volume_m3, 0);
  }

  function getOrderRevenue(row) {
    return Math.max(
      toNumber(row?.estimated_revenue_gbp, 0),
      toNumber(row?.total_customer_charge, 0),
      toNumber(row?.customer_charge_gbp, 0),
      toNumber(row?.revenue_gbp, 0),
      toNumber(row?.order_revenue_gbp, 0),
      toNumber(row?.__line_revenue_gbp, 0)
    );
  }

function getOrderStorageRevenue(row) {
  return toNumber(
    row?.total_storage_tariff ??
    row?.storage_revenue_gbp ??
    row?.warehouse_revenue_gbp,
    0
  );
}

function getOrderHandlingRevenue(row) {
  return toNumber(
    row?.total_handling_tariff ??
    row?.handling_revenue_gbp,
    0
  );
}

function getOrderAdminRevenue(row) {
  return toNumber(
    row?.total_admin_tariff ??
    row?.admin_revenue_gbp,
    0
  );
}

function getOrderPickingRevenue(row) {
  return toNumber(
    row?.total_picking_tariff ??
    row?.picking_revenue_gbp,
    0
  );
}

function getOrderWarehouseRevenue(row) {
  return (
    getOrderStorageRevenue(row) +
    getOrderHandlingRevenue(row) +
    getOrderAdminRevenue(row) +
    getOrderPickingRevenue(row)
  );
}

function getOrderTransportRevenue(row) {
  return toNumber(
    row?.total_transport_tariff ??
    row?.transport_revenue_gbp ??
    row?.transport_charge_gbp,
    0
  );
}

function getOrderCustomerTotal(row) {
  return toNumber(
    row?.total_customer_charge ??
    row?.customer_charge_gbp ??
    row?.estimated_revenue_gbp ??
    row?.revenue_gbp,
    getOrderWarehouseRevenue(row) +
      getOrderTransportRevenue(row)
  );
}

function getOrderProductCount(row) {
  const lines = Array.isArray(row?.order_lines)
    ? row.order_lines
    : [];

  if (lines.length) {
    return lines.reduce((sum, line) => {
      return sum + Math.max(
        0,
        Math.round(
          toNumber(
            line.quantity_ordered ??
            line.quantity,
            0
          )
        )
      );
    }, 0);
  }

  return Math.max(
    0,
    Math.round(
      toNumber(
        row?.total_products ??
        row?.product_quantity ??
        row?.total_quantity,
        0
      )
    )
  );
}

function getOrderWeight(row) {
  return toNumber(
    row?.total_order_weight_kg ??
    row?.planning_weight_kg ??
    row?.matched_weight_kg ??
    row?.weight_kg,
    0
  );
}

function getOrderRequestedDate(row) {
  const value =
    row?.requested_delivery_date ||
    row?.delivery_date ||
    row?.due_date ||
    null;

  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-GB");
}

function getOrderStatusLabel(row) {
  return String(
    row?.derived_lifecycle_status ||
    row?.overall_status ||
    row?.warehouse_status ||
    row?.status ||
    "—"
  )
    .replaceAll("_", " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

  function getRetailerName(row) {
    return (
      row?.retailer_name ||
      row?.retail_name ||
      row?.delivery_name ||
      row?.recipient_name ||
      row?.customer_name ||
      "—"
    );
  }

  function getProductOwnerName(row) {
    return (
      row?.product_owner_name ||
      row?.customer_name ||
      row?.customers?.name ||
      "—"
    );
  }

  function getShowMarkers() {
    return byId("toggleShowMarkers")?.checked !== false;
  }

  function getShowRouteLines() {
    return byId("toggleShowRouteLine")?.checked !== false;
  }

  function isLowEmissionZone(row) {
    return row?.requires_low_emission === true || normalize(row?.requires_low_emission) === "true";
  }

  function isUnder75Tons(row) {
    const limit = toNumber(row?.city_tonnage_limit, 0);
    return limit > 0 && limit <= 7.5;
  }

  function getMarkerShapeType(row) {
    const lez = isLowEmissionZone(row);
    const under75 = isUnder75Tons(row);

    if (lez && under75) return "triangle-red";
    if (lez) return "triangle-blue";
    if (under75) return "square-blue";

    return "circle-blue";
  }

function getMarkerFillColor(row) {
  // Selected order
  if (selectedOrderIds.has(String(row.id))) {
    return "#111827"; // Black
  }

  const status = normalize(
    row.status ||
    row.transport_status ||
    ""
  );

  const transport = normalize(
    row.transport_type ||
    ""
  );

  const hasRoute = !!row.route_id;


  // Delivered
  if (
    ["delivered", "completed"].includes(status)
  ) {
    return "#16a34a"; // Green
  }


  // Delivery issues
  if ([
    "delivery_issue",
    "partial_delivery",
    "partially_delivered",
    "issue"
  ].includes(status)) {
    return "#f59e0b"; // Orange
  }


  // Failed deliveries
  if ([
    "failed_delivery",
    "not_delivered",
    "returned",
    "delivery_failed"
  ].includes(status)) {
    return "#dc2626"; // Red
  }


  // Collection from retailer
  if (isCollectionOrder(row)) {
    return "#0891b2"; // Turquoise
  }


  // Warehouse pickup
  if (isWarehousePickupOrder(row)) {
    return "#eab308"; // Yellow
  }


  /*
   * FDS / Carrier
   *
   * IMPORTANT:
   * This must come BEFORE the minimum-volume
   * check. Once an order is assigned to FDS,
   * it should be orange regardless of volume.
   */
  if (isFdsOrder(row)) {
    return "#f97316"; // Orange
  }


  // Planned on own transport
  if (
    hasRoute &&
    transport === "own_transport"
  ) {
    return "#16a34a"; // Green
  }


  /*
   * Minimum delivery approval required.
   *
   * Only orders which have NOT yet been
   * assigned to FDS reach this point.
   */
  if (row.belowMinimumVolume === true) {
    return "#7c3aed"; // Purple
  }


  // Default: open / unassigned order
  return "#2563eb"; // Blue
}

  function buildOrderShapeIcon(row) {
    const shapeType = getMarkerShapeType(row);
    const fill = getMarkerFillColor(row);
    const selected = selectedOrderIds.has(String(row.id));

    let shapeHtml = "";

    if (shapeType === "circle-blue") {
      shapeHtml = `<div class="shape-base shape-circle" style="--shape-fill:${fill};--shape-stroke:#ffffff;"></div>`;
    } else if (shapeType === "square-blue") {
      shapeHtml = `<div class="shape-base shape-square" style="--shape-fill:${fill};--shape-stroke:#ffffff;"></div>`;
    } else {
      shapeHtml = `<div class="shape-base shape-triangle" style="--shape-fill:${fill};"></div>`;
    }

    return L.divIcon({
      className: "custom-shape-icon",
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      html: `
        <div class="shape-wrap">
          ${shapeHtml}
          ${selected ? `<div class="shape-selected-ring"></div>` : ``}
        </div>
      `
    });
  }

  function buildVertexIcon(isFirst = false, isClose = false) {
    return L.divIcon({
      className: "vertex-marker-icon",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html: `
        <div class="vertex-marker ${isFirst ? "first" : ""} ${isClose ? "close-ready" : ""}"></div>
      `
    });
  }

  function buildDepotIcon() {
    return L.divIcon({
      className: "depot-marker-icon",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html: `<div class="depot-marker"></div>`
    });
  }

function getOrderGroupKey(row) {
  const lat = getLatitude(row);
  const lng = getLongitude(row);

  return [
    Number(lat).toFixed(5),
    Number(lng).toFixed(5),
    String(row.delivery_postcode || "")
      .toUpperCase()
      .replace(/\s+/g, "")
  ].join("|");
}

function groupOrdersByLocation(orders) {
  const groups = new Map();

  (orders || []).forEach(order => {
    const key = getOrderGroupKey(order);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        latitude: getLatitude(order),
        longitude: getLongitude(order),
        orders: []
      });
    }

    groups.get(key).orders.push(order);
  });

  return [...groups.values()];
}

function getGroupOrders(group) {
  return Array.isArray(group?.orders)
    ? group.orders
    : [];
}

function getGroupPackages(group) {
  return getGroupOrders(group).reduce(
    (sum, order) => sum + getOrderColli(order),
    0
  );
}

function getGroupVolume(group) {
  return getGroupOrders(group).reduce(
    (sum, order) => sum + getOrderVolume(order),
    0
  );
}

function getGroupWeight(group) {
  return getGroupOrders(group).reduce(
    (sum, order) => sum + getOrderWeight(order),
    0
  );
}

function getGroupWarehouseRevenue(group) {
  return getGroupOrders(group).reduce(
    (sum, order) => sum + getOrderWarehouseRevenue(order),
    0
  );
}

function getGroupTransportRevenue(group) {
  return getGroupOrders(group).reduce(
    (sum, order) => sum + getOrderTransportRevenue(order),
    0
  );
}

function getGroupCustomerTotal(group) {
  return getGroupOrders(group).reduce(
    (sum, order) => sum + getOrderCustomerTotal(order),
    0
  );
}

function isFdsOrder(order) {
  if (!order) {
    return false;
  }

  /*
   * De actuele transporttoewijzing is leidend.
   *
   * Oude FDS-velden zoals:
   * - fds_collection_date
   * - fds_collection_week
   * - fds_job_ref
   *
   * mogen een order NIET zelfstandig opnieuw
   * als FDS laten verschijnen.
   */
  const transportType =
    normalize(order.transport_type);

  const status =
    normalize(order.status);

  const transportStatus =
    normalize(order.transport_status);

  /*
   * Expliciete FDS / Carrier assignment.
   */
  if (transportType === "charter") {
    return true;
  }

  /*
   * Ondersteuning voor orders die daadwerkelijk
   * nog de actieve charterstatus hebben.
   */
  if (
    status === "export_for_charter" ||
    transportStatus === "export_for_charter"
  ) {
    return true;
  }

  return false;
}

function getSelectedOrders() {
  return getVisibleOrders().filter(order =>
    selectedOrderIds.has(String(order.id))
  );
}

function getSelectedFdsSummary() {
  const selectedOrders = getSelectedOrders();

  const alreadyFds = selectedOrders.filter(isFdsOrder);
  const notAssigned = selectedOrders.filter(order => !isFdsOrder(order));

  return {
    selectedOrders,
    alreadyFds,
    notAssigned,
    alreadyFdsCount: alreadyFds.length,
    notAssignedCount: notAssigned.length
  };
}

function isCollectionOrder(order) {
  return (
    normalize(order?.movement_type) ===
    "collection"
  );
}

function isWarehousePickupOrder(order) {
  const transportType = normalize(
    order?.transport_type ||
    order?.transport_mode ||
    ""
  );

  const vehicleText = [
    order?.carrier_vehicle_name,
    order?.vehicle_name,
    order?.assigned_vehicle_name,
    order?.vehicles?.name,
    order?.carrier_vehicles?.name,
    order?.carrier_vehicle?.name,
    order?.vehicle_code,
    order?.carrier_vehicle_code
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    transportType === "warehouse_pickup" ||
    transportType === "pickup_warehouse" ||
    transportType === "pick_up_warehouse" ||
    vehicleText.includes("pick up warehouse") ||
    vehicleText.includes("pickup warehouse")
  );
}

function getGroupCollectionOrders(group) {
  return getGroupOrders(group).filter(
    isCollectionOrder
  );
}

function getGroupPickupOrders(group) {
  return getGroupOrders(group).filter(
    isWarehousePickupOrder
  );
}

function getGroupFdsOrders(group) {
  return getGroupOrders(group).filter(isFdsOrder);
}

function getGroupDeliveryDate(group) {
  const dates = getGroupOrders(group)
    .map(order =>
      order.expected_delivery_date ||
      order.confirmed_delivery_date ||
      order.planned_route_date ||
      null
    )
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);

  return dates[0] || null;
}

function getGroupFdsCollectionDate(group) {
  const dates = getGroupFdsOrders(group)
    .map(order =>
      order.fds_collection_date ||
      null
    )
    .filter(Boolean)
    .map(value =>
      new Date(`${String(value).slice(0, 10)}T12:00:00`)
    )
    .filter(date =>
      !Number.isNaN(date.getTime())
    )
    .sort((a, b) => a - b);

  return dates[0] || null;
}

function getIsoWeekNumber(value) {
  if (!value) return null;

  const date =
    value instanceof Date
      ? new Date(value)
      : new Date(`${String(value).slice(0, 10)}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const d = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
  );

  const dayNum = d.getUTCDay() || 7;

  d.setUTCDate(
    d.getUTCDate() + 4 - dayNum
  );

  const yearStart =
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        0,
        1
      )
    );

  return Math.ceil(
    (((d - yearStart) / 86400000) + 1) / 7
  );
}

function getNextFdsDeliveryWeek(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setDate(
    date.getDate() + 7
  );

  return getIsoWeekNumber(date);
}

function formatMapDate(value) {
  if (!value) return "Date pending";

  const date = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date pending";
  }

  return date.toLocaleDateString("en-GB");
}

function getGroupFdsWeek(group) {
  const weeks = getGroupFdsOrders(group)
    .map(order => Math.round(toNumber(order.fds_collection_week, 0)))
    .filter(week => week > 0);

  return weeks.length ? weeks[0] : null;
}

  function buildOrderTooltip(row) {
  const warehouseRevenue =
    getOrderWarehouseRevenue(row);

  const transportRevenue =
    getOrderTransportRevenue(row);

  const customerTotal =
    getOrderCustomerTotal(row);

  const products =
    getOrderProductCount(row);

  const packages =
    getOrderColli(row);

  const volume =
    getOrderVolume(row);

  const weight =
    getOrderWeight(row);

  const transportType = String(
    row.transport_type || "unassigned"
  ).replaceAll("_", " ");

  return `
    <div class="order-map-hover-card">

      <div class="order-map-hover-head">
        <div>
          <strong class="order-map-hover-order">
            ${escapeHtml(row.order_number || "Order")}
          </strong>

          <span class="order-map-hover-reference">
            ACK: ${escapeHtml(
              row.external_reference ||
              row.ack_number ||
              "—"
            )}
          </span>
        </div>

        ${
          isCollectionOrder(row)
            ? `
              <span class="order-map-hover-status collection">
                COLLECTION
              </span>
            `
            : `
              <span class="order-map-hover-status">
                ${escapeHtml(getOrderStatusLabel(row))}
              </span>
            `
        }

      </div>

      <div class="order-map-hover-section">
        <strong>
          ${escapeHtml(getRetailerName(row))}
        </strong>

        ${
          isCollectionOrder(row)
            ? `
              <span class="order-map-collection-label">
                PICK UP FROM RETAILER
              </span>
            `
            : ""
        }

        <span>
          ${escapeHtml(getProductOwnerName(row))}
        </span>

        <span>
          ${escapeHtml(row.delivery_city || "—")}
          ·
          ${escapeHtml(row.delivery_postcode || "—")}
        </span>
      </div>

      <div class="order-map-hover-grid">
        <div>
          <span>Products</span>
          <strong>${formatNumber(products)}</strong>
        </div>

        <div>
          <span>Packages</span>
          <strong>${formatNumber(packages)}</strong>
        </div>

        <div>
          <span>Volume</span>
          <strong>${formatNumber(volume, 2)} m³</strong>
        </div>

        <div>
          <span>Weight</span>
          <strong>${formatNumber(weight, 1)} kg</strong>
        </div>
      </div>

      <div class="order-map-hover-finance">
        <div>
          <span>Warehouse revenue</span>
          <strong>${formatMoney(warehouseRevenue)}</strong>
        </div>

        <div>
          <span>Transport revenue</span>
          <strong>${formatMoney(transportRevenue)}</strong>
        </div>

        <div class="order-map-hover-total">
          <span>Customer total</span>
          <strong>${formatMoney(customerTotal)}</strong>
        </div>
      </div>

      <div class="order-map-hover-footer">
<span>
  ${
    isCollectionOrder(row)
      ? "Requested collection:"
      : "Requested delivery:"
  }

  <strong>
    ${escapeHtml(getOrderRequestedDate(row))}
  </strong>
</span>
        <span>
          Transport:
          <strong>${escapeHtml(transportType)}</strong>
        </span>

        ${
          row.routes?.route_code || row.route_code
            ? `
              <span>
                Route:
                <strong>
                  ${escapeHtml(
                    row.routes?.route_code ||
                    row.route_code
                  )}
                </strong>
              </span>
            `
            : ""
        }

        ${
          row.routes?.driver_name || row.driver_name
            ? `
              <span>
                Driver:
                <strong>
                  ${escapeHtml(
                    row.routes?.driver_name ||
                    row.driver_name
                  )}
                </strong>
              </span>
            `
            : ""
        }
      </div>

    </div>
  `;
}

function buildOrderGroupTooltip(group) {
  const orders = getGroupOrders(group);
  const firstOrder = orders[0] || {};

  const fdsOrders =
    getGroupFdsOrders(group);

  const pickupOrders =
    getGroupPickupOrders(group);

  const collectionOrders =
    getGroupCollectionOrders(group);

  const deliveryDate =
    getGroupDeliveryDate(group);

  const fdsCollectionDate =
    getGroupFdsCollectionDate(group);

  const fdsDeliveryWeek =
    getNextFdsDeliveryWeek(
      fdsCollectionDate
    );

 const orderLines = orders.map(order => {
  const collection =
    isCollectionOrder(order);

  return `
    <div class="order-map-group-order ${collection ? "collection" : ""}">
      <span>
        <strong>
          ${escapeHtml(order.order_number || "Order")}
        </strong>

        <small>
          ACK: ${escapeHtml(order.external_reference || "—")}
        </small>
      </span>

      <span class="order-map-group-order-right">
        ${
          collection
            ? `
              <strong class="order-map-group-collection-badge">
                COLLECTION
              </strong>
            `
            : ""
        }

        <span>
          ${formatNumber(getOrderColli(order))} pkg ·
          ${formatNumber(getOrderVolume(order), 2)} m³
        </span>
      </span>
    </div>
  `;
}).join("");

  return `
    <div class="order-map-hover-card order-map-group-card">

      <div class="order-map-hover-head">
        <div>
          <strong class="order-map-hover-order">
            ${formatNumber(orders.length)} orders
          </strong>

          <span class="order-map-hover-reference">
            ${escapeHtml(getRetailerName(firstOrder))}
          </span>
        </div>

        ${
          collectionOrders.length
            ? `
              <span class="order-map-hover-status collection">
                COLLECTION
              </span>
            `
            : pickupOrders.length
              ? `
                <span class="order-map-hover-status pickup">
                  PICK UP WAREHOUSE
                </span>
              `
              : fdsOrders.length
                ? `
                  <span class="order-map-hover-status fds">
                    FDS Delivery
                  </span>
                `
                : `
                  <span class="order-map-hover-status">
                    Own Transport
                  </span>
                `
        }
      </div>

      <div class="order-map-hover-section">
        <strong>
          ${escapeHtml(getRetailerName(firstOrder))}
        </strong>

        ${
          collectionOrders.length
            ? `
              <span class="order-map-collection-label">
                PICK UP FROM RETAILER
              </span>
            `
            : ""
        }

        <span>
          ${escapeHtml(getProductOwnerName(firstOrder))}
        </span>

        <span>
          ${escapeHtml(firstOrder.delivery_city || "—")}
          ·
          ${escapeHtml(firstOrder.delivery_postcode || "—")}
        </span>
      </div>

      ${
        collectionOrders.length
          ? `
            <div class="order-map-pickup-delivery collection">
              <strong>
                COLLECTION
              </strong>

              <span>
                Pick up from retailer
              </span>
            </div>
          `
          : pickupOrders.length
            ? `
              <div class="order-map-pickup-delivery">
                <strong>
                  PICK UP WAREHOUSE
                </strong>

                <span>
                  Pickup date:
                  <strong>
                    ${
                      deliveryDate
                        ? escapeHtml(
                            formatMapDate(deliveryDate)
                          )
                        : "Pending"
                    }
                  </strong>
                </span>
              </div>
            `
            : fdsOrders.length
              ? `
                <div class="order-map-fds-delivery">
                  <strong>
                    FDS Delivery
                  </strong>

                  <span>
                    Collection:
                    <strong>
                      ${
                        fdsCollectionDate
                          ? escapeHtml(
                              formatMapDate(fdsCollectionDate)
                            )
                          : "Pending"
                      }
                    </strong>
                  </span>

                  <span>
                    Delivery week:
                    <strong>
                      ${
                        fdsDeliveryWeek
                          ? `Week ${fdsDeliveryWeek}`
                          : "Pending"
                      }
                    </strong>
                  </span>
                </div>
              `
              : deliveryDate
                ? `
                  <div class="order-map-fds-delivery">
                    <span>
                      Delivery date:
                      <strong>
                        ${escapeHtml(
                          formatMapDate(deliveryDate)
                        )}
                      </strong>
                    </span>
                  </div>
                `
                : ""
      }

      <div class="order-map-group-orders">
        ${orderLines}
      </div>

      <div class="order-map-hover-grid">
        <div>
          <span>Orders</span>
          <strong>${formatNumber(orders.length)}</strong>
        </div>

        <div>
          <span>Packages</span>
          <strong>${formatNumber(getGroupPackages(group))}</strong>
        </div>

        <div>
          <span>Volume</span>
          <strong>${formatNumber(getGroupVolume(group), 2)} m³</strong>
        </div>

        <div>
          <span>Weight</span>
          <strong>${formatNumber(getGroupWeight(group), 1)} kg</strong>
        </div>
      </div>

      <div class="order-map-hover-finance">
        <div>
          <span>Warehouse revenue</span>
          <strong>
            ${formatMoney(getGroupWarehouseRevenue(group))}
          </strong>
        </div>

        <div>
          <span>Transport revenue</span>
          <strong>
            ${formatMoney(getGroupTransportRevenue(group))}
          </strong>
        </div>

        <div class="order-map-hover-total">
          <span>Customer total</span>
          <strong>
            ${formatMoney(getGroupCustomerTotal(group))}
          </strong>
        </div>
      </div>

    </div>
  `;
}

  function buildDepotTooltip(row) {
    return `
      <div style="display:grid;gap:4px;min-width:180px;">
        <strong>${escapeHtml(row.name || "Depot")}</strong>
        <div>${formatNumber(row.latitude, 6)}, ${formatNumber(row.longitude, 6)}</div>
      </div>
    `;
  }

  function buildRouteStopTooltip(stop) {
    return `
      <div style="display:grid;gap:4px;min-width:180px;">
        <strong>${escapeHtml(stop.stop_name || "Stop")}</strong>
        <div>${escapeHtml(stop.city || "—")} · ${escapeHtml(stop.postcode || "—")}</div>
        <div>Stop ${escapeHtml(String(stop.stop_sequence || stop.stop_number || "—"))}</div>
        <div>${escapeHtml(stop.planned_time || stop.planned_arrival_time || stop.arrival_eta || "—")}</div>
      </div>
    `;
  }

function buildDriverLocationIcon() {
  return L.divIcon({
    className: "driver-live-marker-icon",
    iconSize: [38, 38],
    iconAnchor: [19, 19],

    html: `
      <div class="driver-live-marker">
        🚚
      </div>
    `
  });
}

function renderDriverLocations() {
  if (!driverLocationLayer) return;

  driverLocationLayer.clearLayers();

  const locations =
    Array.isArray(window.driverLiveLocationsMapRows)
      ? window.driverLiveLocationsMapRows
      : [];

  locations.forEach(location => {
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return;
    }

    const lastSeen =
      location.recorded_at
        ? new Date(location.recorded_at)
            .toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            })
        : "—";

    const mph =
      Number.isFinite(Number(location.speed_mps))
        ? Number(location.speed_mps) * 2.23694
        : null;

    const marker = L.marker(
      [lat, lng],
      {
        icon: buildDriverLocationIcon(),
        title: location.driver_name || "Driver"
      }
    );

    marker.bindPopup(`
      <div style="min-width:220px;display:grid;gap:5px;">

        <strong style="font-size:14px;">
          🚚 ${escapeHtml(
            location.driver_name || "Driver"
          )}
        </strong>

        <div>
          Vehicle:
          <strong>
            ${escapeHtml(
              location.vehicle_name || "—"
            )}
          </strong>
        </div>

        <div>
          Last location:
          <strong>
            ${escapeHtml(lastSeen)}
          </strong>
        </div>

        ${
          mph !== null
            ? `
              <div>
                Speed:
                <strong>
                  ${mph.toFixed(0)} mph
                </strong>
              </div>
            `
            : ""
        }

        ${
          location.accuracy_m
            ? `
              <div>
                GPS accuracy:
                <strong>
                  ${Number(location.accuracy_m).toFixed(0)} m
                </strong>
              </div>
            `
            : ""
        }

      </div>
    `);

    driverLocationLayer.addLayer(marker);
  });
}

  function injectStyles() {
    if (document.getElementById("orders-map-original-plus-style")) return;

    const style = document.createElement("style");
    style.id = "orders-map-original-plus-style";
    style.textContent = `
      .orders-map-control{
        background:#fff;
        border:1px solid #d9dee6;
        border-radius:12px;
        box-shadow:0 10px 24px rgba(15,23,42,.10);
        padding:8px;
        display:grid;
        gap:8px;
        min-width:260px;
        max-width:360px;
      }

.order-map-hover-status.fds{
  background:#fff7ed;
  border-color:#fdba74;
  color:#c2410c;
}

.order-map-hover-status.pickup{
  background:#fef9c3;
  border-color:#eab308;
  color:#854d0e;
}

.order-map-hover-status.collection{
  background:#ecfeff;
  border-color:#67e8f9;
  color:#0e7490;
}

.order-map-collection-label{
  display:inline-flex;
  width:max-content;
  margin-top:2px;
  padding:3px 7px;
  border-radius:999px;
  background:#ecfeff;
  border:1px solid #67e8f9;
  color:#0e7490 !important;
  font-size:9px;
  font-weight:900;
}

.order-map-pickup-delivery{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  padding:9px 10px;
  border:1px solid #eab308;
  border-radius:10px;
  background:#fef9c3;
  color:#854d0e;
}

.order-map-pickup-delivery span{
  color:#854d0e;
}

.order-map-pickup-delivery.collection span{
  color:#0e7490;
}

.order-map-pickup-delivery.collection{
  border-color:#67e8f9;
  background:#ecfeff;
  color:#0e7490;
}

.order-map-pickup-delivery.collection span{
  color:#0e7490;
}

.order-map-fds-delivery{
  display:grid;
  gap:5px;
  padding:9px 10px;
  border:1px solid #fdba74;
  border-radius:10px;
  background:#fff7ed;
  color:#9a3412;
}

.order-map-fds-delivery > strong{
  font-size:11px;
  font-weight:900;
  color:#9a3412;
}

.order-map-fds-delivery span{
  display:flex;
  justify-content:space-between;
  gap:12px;
  color:#9a3412;
}

.order-map-fds-delivery span strong{
  white-space:nowrap;
  color:#7c2d12;
}

.order-map-group-orders{
  display:grid;
  gap:5px;
  max-height:220px;
  overflow-y:auto;
  overscroll-behavior:contain;
  pointer-events:auto;
}

.order-map-group-order{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  padding:7px 8px;
  border:1px solid #e2e8f0;
  border-radius:8px;
  background:#fff;
}

.order-map-group-order > span:first-child{
  display:grid;
  gap:2px;
}

.order-map-group-order small{
  color:#64748b;
  font-size:9px;
}

.order-map-group-order.collection{
  border-color:#67e8f9;
  background:#ecfeff;
}

.order-map-group-order-right{
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  justify-content:center;
  gap:3px;
}

.order-map-group-collection-badge{
  display:inline-flex;
  padding:2px 6px;
  border-radius:999px;
  background:#cffafe;
  border:1px solid #67e8f9;
  color:#0e7490;
  font-size:8px;
  font-weight:900;
  line-height:1.2;
}

.order-map-group-order > span:last-child{
  color:#475569;
  font-size:10px;
  white-space:nowrap;
}

.order-map-hover-tooltip{
  padding:0 !important;
  border:0 !important;
  border-radius:14px !important;
  background:#fff !important;
  box-shadow:
    0 18px 45px rgba(15,23,42,.20) !important;
}

.order-map-hover-tooltip::before{
  border-top-color:#fff !important;
}

.order-map-hover-card{
  width:310px;
  padding:14px;
  display:grid;
  gap:12px;
  color:#0f172a;
  font-size:11px;
  line-height:1.35;
}

.order-map-hover-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  padding-bottom:10px;
  border-bottom:1px solid #e2e8f0;
}

.order-map-hover-head > div{
  display:grid;
  gap:3px;
}

.order-map-hover-order{
  font-size:15px;
  font-weight:950;
  color:#07152f;
}

.order-map-hover-reference{
  color:#64748b;
  font-size:10px;
  font-weight:750;
}

.order-map-hover-status{
  max-width:120px;
  padding:4px 7px;
  border-radius:999px;
  background:#eff6ff;
  border:1px solid #bfdbfe;
  color:#1d4ed8;
  font-size:9px;
  font-weight:900;
  text-align:center;
}

.order-map-hover-section{
  display:grid;
  gap:3px;
}

.order-map-hover-section > strong{
  color:#07152f;
  font-size:12px;
}

.order-map-hover-section > span{
  color:#64748b;
}

.order-map-hover-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:7px;
}

.order-map-hover-grid > div{
  display:grid;
  gap:3px;
  padding:8px;
  border:1px solid #e2e8f0;
  border-radius:9px;
  background:#f8fafc;
}

.order-map-hover-grid span{
  color:#64748b;
  font-size:9px;
  font-weight:850;
  text-transform:uppercase;
}

.order-map-hover-grid strong{
  color:#0f172a;
  font-size:12px;
}

.order-map-hover-finance{
  display:grid;
  gap:6px;
  padding:10px;
  border:1px solid #dbeafe;
  border-radius:10px;
  background:#f8fbff;
}

.order-map-hover-finance > div{
  display:flex;
  justify-content:space-between;
  gap:12px;
}

.order-map-hover-finance span{
  color:#475569;
}

.order-map-hover-finance strong{
  color:#0f172a;
}

.order-map-hover-total{
  margin-top:3px;
  padding-top:7px;
  border-top:1px solid #cbd5e1;
  font-size:12px;
}

.order-map-hover-total strong{
  color:#15803d;
  font-weight:950;
}

.order-map-hover-footer{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:5px 12px;
  padding-top:2px;
  color:#64748b;
}

.order-map-hover-footer strong{
  color:#334155;
}

      .orders-map-control.compact{
        min-width:auto;
        max-width:none;
        padding:6px;
      }

      .orders-map-title-row{
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:8px;
      }

      .orders-map-title{
        margin:0;
        font-size:12px;
        font-weight:900;
        color:#111827;
      }

      .orders-map-text{
        margin:0;
        font-size:11px;
        line-height:1.4;
        color:#6b7280;
      }

      .orders-map-hint{
        border:1px solid #fde68a;
        background:#fffbeb;
        color:#92400e;
        border-radius:8px;
        padding:7px 8px;
        font-size:11px;
        font-weight:800;
        line-height:1.35;
      }

      .orders-map-btn{
        border:1px solid #d9dee6;
        background:#fff;
        color:#111827;
        border-radius:8px;
        padding:7px 10px;
        font-size:12px;
        font-weight:800;
        cursor:pointer;
      }

      .orders-map-btn:hover{
        background:#f8fafc;
      }

      .orders-map-btn.primary{
        background:var(--primary,#1267ff);
        color:#fff;
        border-color:var(--primary,#1267ff);
      }

      .orders-map-btn.active{
        background:#111827;
        color:#fff;
        border-color:#111827;
      }

      .orders-map-row{
        display:flex;
        gap:6px;
        flex-wrap:wrap;
      }

      .orders-map-grid{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:8px;
      }

.orders-map-fds-selection-summary{
  display:grid;
  gap:7px;
}

.orders-map-fds-selection-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:9px 10px;
  border:1px solid #e5e7eb;
  border-radius:9px;
  background:#fff;
}

.orders-map-fds-selection-row > div{
  display:grid;
  gap:2px;
}

.orders-map-fds-selection-row strong{
  font-size:12px;
  font-weight:900;
  color:#111827;
}

.orders-map-fds-selection-row span{
  font-size:9.5px;
  color:#6b7280;
}

.orders-map-fds-selection-row .orders-map-btn{
  flex:0 0 auto;
  padding:6px 8px;
  font-size:10.5px;
}

      .orders-map-kv{
        border:1px solid #e5e7eb;
        border-radius:8px;
        padding:8px;
        background:#fff;
        display:grid;
        gap:3px;
      }

      .orders-map-kv-label{
        font-size:10px;
        font-weight:900;
        text-transform:uppercase;
        color:#6b7280;
      }

      .orders-map-kv-value{
        font-size:12px;
        font-weight:900;
        color:#111827;
      }

      .orders-map-select{
        width:100%;
        border:1px solid #d9dee6;
        border-radius:8px;
        padding:8px 10px;
        font-size:12px;
        background:#fff;
      }

      .route-seq-label{
        background:transparent;
        border:none;
        box-shadow:none;
        color:#fff;
        font-weight:900;
        font-size:11px;
      }

      .map-card.map-expanded{
        position:fixed !important;
        inset:16px !important;
        z-index:9999 !important;
        margin:0 !important;
        width:auto !important;
        height:auto !important;
        box-shadow:0 18px 50px rgba(15,23,42,.22);
      }

      .map-card.map-expanded .map-box{
        height:calc(100vh - 120px) !important;
        min-height:calc(100vh - 120px) !important;
      }

      body.map-overlay-open{
        overflow:hidden;
      }

      .orders-map-legend{
        background:#fff;
        border:1px solid #d9dee6;
        border-radius:12px;
        box-shadow:0 10px 24px rgba(15,23,42,.10);
        padding:10px 12px;
        min-width:220px;
        display:grid;
        gap:8px;
      }

      .orders-map-legend-title{
        font-size:12px;
        font-weight:900;
        color:#111827;
      }

      .orders-map-legend-item{
        display:flex;
        align-items:center;
        gap:8px;
        font-size:11px;
        color:#374151;
        line-height:1.3;
      }

      .legend-shape{
        width:14px;
        height:14px;
        display:inline-block;
        flex:0 0 auto;
      }

.legend-circle{
    border-radius:999px;
    background:#2563eb;
}

.legend-own{
    border-radius:999px;
    background:#16a34a;
}

.legend-charter{
    border-radius:999px;
    background:#f97316;
}

.legend-collection{
    border-radius:999px;
    background:#0891b2;
}

.legend-pickup{
    border-radius:999px;
    background:#eab308;
}

.legend-minimum{
    border-radius:999px;
    background:#7c3aed;
}

      .legend-square{
        background:#2563eb;
      }

      .legend-triangle-blue{
        width:0;
        height:0;
        border-left:8px solid transparent;
        border-right:8px solid transparent;
        border-bottom:14px solid #2563eb;
      }

      .legend-triangle-red{
        width:0;
        height:0;
        border-left:8px solid transparent;
        border-right:8px solid transparent;
        border-bottom:14px solid #dc2626;
      }

.driver-live-marker-icon{
  background:transparent !important;
  border:none !important;
}

.driver-live-marker{
  width:38px;
  height:38px;
  display:grid;
  place-items:center;
  border-radius:999px;
  background:#07152f;
  border:3px solid #ffffff;
  box-shadow:
    0 5px 14px rgba(15,23,42,.35),
    0 0 0 4px rgba(18,103,255,.20);
  font-size:20px;
  line-height:1;
}

      .custom-shape-icon,
      .depot-marker-icon,
      .vertex-marker-icon{
        background:transparent;
        border:none;
      }

      .shape-wrap{
        position:relative;
        width:18px;
        height:18px;
      }

      .shape-base{
        position:absolute;
        inset:0;
      }

      .shape-circle{
        border-radius:999px;
        background:var(--shape-fill,#2563eb);
        border:2px solid var(--shape-stroke,#ffffff);
        box-sizing:border-box;
      }

      .shape-square{
        background:var(--shape-fill,#2563eb);
        border:2px solid var(--shape-stroke,#ffffff);
        box-sizing:border-box;
        border-radius:2px;
      }

      .shape-triangle{
        width:0;
        height:0;
        left:1px;
        top:0;
        border-left:8px solid transparent;
        border-right:8px solid transparent;
        border-bottom:16px solid var(--shape-fill,#2563eb);
      }

      .shape-selected-ring{
        position:absolute;
        inset:-3px;
        border:2px solid #111827;
        border-radius:999px;
      }

      .depot-marker{
        width:18px;
        height:18px;
        background:#facc15;
        border:3px solid #111827;
        box-shadow:0 2px 8px rgba(15,23,42,.22);
      }

      .vertex-marker{
        width:15px;
        height:15px;
        border-radius:999px;
        background:#111827;
        border:3px solid #fff;
        box-shadow:0 2px 8px rgba(15,23,42,.25);
      }

      .vertex-marker.first{
        width:18px;
        height:18px;
        background:#16a34a;
        outline:3px solid rgba(22,163,74,.25);
      }

      .vertex-marker.close-ready{
        background:#16a34a;
        animation:vertexPulse 1s infinite;
      }

      @keyframes vertexPulse{
        0%{transform:scale(1);}
        50%{transform:scale(1.28);}
        100%{transform:scale(1);}
      }
    `;

    document.head.appendChild(style);
  }


/* ==========================================================
   VEYNOR — UK EMISSION ZONES
   Load official stored boundaries from Supabase
   ========================================================== */


async function loadEmissionMapSettings() {
  if (emissionSettingsLoading) {
    return emissionSettingsLoading;
  }

  emissionSettingsLoading = (async () => {
    if (typeof sb !== "function") {
      throw new Error("Supabase client is unavailable.");
    }

    const db = sb();

    const { data: authData, error: authError } =
      await db.auth.getUser();

    if (authError) throw authError;

    const userId = authData?.user?.id;
    if (!userId) {
      throw new Error("No authenticated user.");
    }

    // Resolve the active tenant from the signed-in user.
    const { data: profiles, error: profileError } = await db
      .from("user_profiles")
      .select("company_id")
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .eq("is_active", true);

    if (profileError) throw profileError;

    const companyIds = [
      ...new Set(
        (profiles || [])
          .map(row => row.company_id)
          .filter(Boolean)
      )
    ];

    if (companyIds.length !== 1) {
      throw new Error(
        "Cannot determine a unique active company."
      );
    }

    const { data, error } = await db
      .from("settings")
      .select("setting_value")
      .eq("company_id", companyIds[0])
      .eq("setting_key", "emission_display_map")
      .maybeSingle();

    if (error) throw error;

    // Enabled by default if the setting is not saved yet.
    emissionZonesVisible =
      String(data?.setting_value ?? "true")
        .trim()
        .toLowerCase() !== "false";

    applyEmissionZoneVisibility();

    console.info(
      "[orders-map.js] Emission zone visibility:",
      emissionZonesVisible
    );
  })();

  try {
    await emissionSettingsLoading;
  } finally {
    emissionSettingsLoading = null;
  }
}

function applyEmissionZoneVisibility() {
  if (!map || !emissionZoneLayer) return;

  if (emissionZonesVisible) {
    if (!map.hasLayer(emissionZoneLayer)) {
      emissionZoneLayer.addTo(map);
    }
  } else if (map.hasLayer(emissionZoneLayer)) {
    map.removeLayer(emissionZoneLayer);
  }
}


function getEmissionZoneStyle(feature) {
  const code = String(
    feature?.properties?.zone_code || ""
  ).toUpperCase();

  const type = String(
    feature?.properties?.zone_type || ""
  ).toUpperCase();

  // London Congestion Charge
  if (code === "LONDON_CONGESTION") {
    return {
      color: "#dc2626",
      weight: 2,
      opacity: 0.95,
      fillColor: "#ef4444",
      fillOpacity: 0.25
    };
  }

  // London ULEZ
  if (code === "LONDON_ULEZ") {
    return {
      color: "#2563eb",
      weight: 2,
      opacity: 0.9,
      fillColor: "#3b82f6",
      fillOpacity: 0.10
    };
  }

  // London LEZ
  if (code === "LONDON_LEZ") {
    return {
      color: "#0891b2",
      weight: 2,
      opacity: 0.9,
      fillColor: "#06b6d4",
      fillOpacity: 0.08
    };
  }

  // Zero Emission Zones
  if (type === "ZEZ" || code.endsWith("_ZEZ")) {
    return {
      color: "#1d4ed8",
      weight: 3,
      opacity: 1,
      fillColor: "#60a5fa",
      fillOpacity: 0.28
    };
  }

  // Other Clean Air Zones
  return {
    color: "#15803d",
    weight: 2,
    opacity: 0.95,
    fillColor: "#22c55e",
    fillOpacity: 0.17
  };
}

function renderEmissionZones() {
  if (!map || !emissionZoneLayer) return;

  emissionZoneLayer.clearLayers();

  if (
    !emissionZonesGeoJson ||
    emissionZonesGeoJson.type !== "FeatureCollection"
  ) {
    return;
  }

const geoJsonLayer = L.geoJSON(
  emissionZonesGeoJson,
  {
    pane: "emissionZonesPane",
    style: getEmissionZoneStyle,
    interactive: false
  }
);

  emissionZoneLayer.addLayer(geoJsonLayer);
}

async function loadEmissionZones() {
  if (!map || !emissionZoneLayer) return;

  // Avoid duplicate Supabase requests.
  if (emissionZonesLoading) {
    return emissionZonesLoading;
  }

  emissionZonesLoading = (async () => {
    try {
      if (typeof sb !== "function") {
        throw new Error(
          "Supabase client is not available."
        );
      }

      const { data, error } = await sb()
        .rpc("get_emission_zones_geojson");

      if (error) throw error;

      if (
        !data ||
        data.type !== "FeatureCollection" ||
        !Array.isArray(data.features)
      ) {
        throw new Error(
          "Invalid emission zones GeoJSON response."
        );
      }

      emissionZonesGeoJson = data;

      renderEmissionZones();

      console.log(
        "[orders-map.js] Emission zones loaded:",
        data.features.length
      );

    } catch (error) {
      console.error(
        "[orders-map.js] Could not load emission zones:",
        error
      );
    }
  })();

  try {
    await emissionZonesLoading;
  } finally {
    emissionZonesLoading = null;
  }
}


  function fitUk() {
    if (map) map.fitBounds(UK_BOUNDS);
  }

  function fitToBounds(latlngs) {
    if (!map || !latlngs.length) return;
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.12));
  }

function clearMainLayers() {
  depotLayer?.clearLayers();
  orderLayer?.clearLayers();
  routeLineLayer?.clearLayers();
  routeStopLayer?.clearLayers();
  driverLocationLayer?.clearLayers();
}

  function clearSelectionDrawing() {
    selectionLayer?.clearLayers();
    vertexLayer?.clearLayers();
    activeShape = null;
    previewShape = null;
  }

  function resetDraft() {
    circleCenter = null;
    rectangleStart = null;
    polygonPoints = [];
    clearSelectionDrawing();
  }

  function setMapCursor(cursor) {
    if (map?.getContainer()) map.getContainer().style.cursor = cursor || "";
  }

  function renderDepot() {
    const depot = getDepotPoint();
    if (!depot || !depotLayer) return;

    const lat = Number(depot.latitude);
    const lng = Number(depot.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const marker = L.marker([lat, lng], {
      icon: buildDepotIcon(),
      title: depot.name || "Depot"
    });

    marker.bindPopup(buildDepotTooltip(depot));
    depotLayer.addLayer(marker);
  }

function renderOrders() {
  if (!orderLayer || !getShowMarkers()) return;

  const groups = groupOrdersByLocation(
    getVisibleOrders()
  );

groups.forEach(group => {
  const orders = getGroupOrders(group);
  const firstOrder = orders[0];

  if (!firstOrder) return;

  /*
   * Wanneer één van de orders op deze locatie
   * geselecteerd is, gebruiken we die order voor
   * de markerweergave. Hierdoor wordt de gezamenlijke
   * marker zwart, ook als de geselecteerde order niet
   * de eerste order in de groep is.
   */
  const selectedOrderInGroup = orders.find(order =>
    selectedOrderIds.has(String(order.id))
  );

  const markerOrder =
    selectedOrderInGroup ||
    firstOrder;

  const lat = group.latitude;
  const lng = group.longitude;
    if (lat === null || lng === null) return;

    const marker = L.marker(
      [lat, lng],
      {
        icon: buildOrderShapeIcon(markerOrder),
       title:
  orders.length > 1
    ? selectedOrderInGroup
      ? `${selectedOrderInGroup.order_number} · ${orders.length} orders at this location`
      : `${orders.length} orders`
    : firstOrder.order_number || "Order"
      }
    );

    marker.bindTooltip(
      orders.length > 1
        ? buildOrderGroupTooltip(group)
        : buildOrderTooltip(firstOrder),
      {
        direction: lat > 55.2
          ? "bottom"
          : "top",

        offset: lat > 55.2
          ? [0, 14]
          : [0, -12],

        opacity: 1,
        sticky: true,
        interactive: true,
        className: "order-map-hover-tooltip"
      }
    );

    marker.on("click", event => {
      if (selectionMode) return;

      L.DomEvent.stopPropagation(event);

      applySelectionToIds(
        orders.map(order => String(order.id))
      );

      reload();
    });

    orderLayer.addLayer(marker);
  });
}
  function buildRoutePolylinePoints(orderedStops, depot) {
    const points = [];

    if (depot && Number.isFinite(Number(depot.latitude)) && Number.isFinite(Number(depot.longitude))) {
      points.push([Number(depot.latitude), Number(depot.longitude)]);
    }

    orderedStops.forEach(stop => {
      const lat = toNumber(stop.latitude);
      const lng = toNumber(stop.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      points.push([lat, lng]);
    });

    if (depot && Number.isFinite(Number(depot.latitude)) && Number.isFinite(Number(depot.longitude))) {
      points.push([Number(depot.latitude), Number(depot.longitude)]);
    }

    return points;
  }
async function drawOsrmRouteLine(points, color, weight = 4, opacity = 0.85) {
  if (!routeLineLayer || !Array.isArray(points) || points.length < 2) return false;

  try {
    const coords = points
      .map(point => `${point[1]},${point[0]}`)
      .join(";");

    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM map route failed: ${res.status}`);

    const json = await res.json();
    const geometry = json.routes?.[0]?.geometry;

    if (!geometry) throw new Error("No OSRM geometry found.");

    routeLineLayer.addLayer(L.geoJSON(geometry, {
      style: {
        color,
        weight,
        opacity
      }
    }));

    return true;
  } catch (error) {
    console.warn("[orders-map.js] OSRM route line fallback:", error.message || error);
    return false;
  }
}

async function renderRoutesToMap() {
    if (!routeLineLayer || !routeStopLayer) return;
    if (!getShowRouteLines()) return;

    const selectedRouteId = getSelectedRouteId();
    const allStops = getAllRouteStops();
    const depot = getDepotPoint();

    if (!allStops.length) return;

    if (selectedRouteId) {
      const selectedStops = allStops
        .filter(stop => String(stop.route_id) === String(selectedRouteId))
        .sort((a, b) => Number(a.stop_sequence || a.stop_number || 0) - Number(b.stop_sequence || b.stop_number || 0));

      const points = buildRoutePolylinePoints(selectedStops, depot);

     if (points.length >= 2) {
  const drawn = await drawOsrmRouteLine(points, routeColor(0), 5, 0.95);

  if (!drawn) {
    routeLineLayer.addLayer(L.polyline(points, {
      color: routeColor(0),
      weight: 5,
      opacity: 0.95
    }));
  }
}

selectedStops.forEach((stop, index) => {
        const lat = toNumber(stop.latitude);
        const lng = toNumber(stop.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const marker = L.circleMarker([lat, lng], {
          radius: 9,
          weight: 2,
          color: "#ffffff",
          fillColor: routeColor(0),
          fillOpacity: 0.95
        });

        marker.bindPopup(buildRouteStopTooltip(stop));
        marker.bindTooltip(String(stop.stop_sequence || stop.stop_number || index + 1), {
          permanent: true,
          direction: "center",
          className: "route-seq-label"
        });

        routeStopLayer.addLayer(marker);
      });

// Do not auto-zoom when selecting/clicking markers.
// User can use Fit UK manually.      return;
    }

    const grouped = new Map();

    allStops.forEach(stop => {
      const key = String(stop.route_id || "");
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(stop);
    });

    const allLatLngs = [];

    Array.from(grouped.entries()).forEach(([routeId, stops], routeIndex) => {
      const ordered = stops.sort((a, b) => Number(a.stop_sequence || a.stop_number || 0) - Number(b.stop_sequence || b.stop_number || 0));
      const points = buildRoutePolylinePoints(ordered, depot);

      if (points.length >= 2) {
        drawOsrmRouteLine(points, routeColor(routeIndex), 4, 0.82).then(drawn => {
  if (!drawn) {
    routeLineLayer.addLayer(L.polyline(points, {
      color: routeColor(routeIndex),
      weight: 4,
      opacity: 0.82
    }));
  }
});

allLatLngs.push(...points);
      }

      ordered.forEach((stop, stopIndex) => {
        const lat = toNumber(stop.latitude);
        const lng = toNumber(stop.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const marker = L.circleMarker([lat, lng], {
          radius: 7,
          weight: 2,
          color: "#ffffff",
          fillColor: routeColor(routeIndex),
          fillOpacity: 0.9
        });

        marker.bindPopup(buildRouteStopTooltip(stop));
        marker.bindTooltip(String(stop.stop_sequence || stop.stop_number || stopIndex + 1), {
          direction: "top"
        });

        routeStopLayer.addLayer(marker);
      });
    });

// Do not auto-fit routes during normal reload.
  }

function installLegendControl() {
  if (!map || legendControl) return;

  legendControl = L.control({
    position: "bottomright"
  });

  legendControl.onAdd = function () {
    const wrapper = L.DomUtil.create(
      "div",
      "orders-map-legend"
    );

    wrapper.innerHTML = `
      <div class="orders-map-legend-title">
        Map legend
      </div>

<div class="orders-map-legend-item">
  <span class="legend-shape legend-collection"></span>
  <span>Collection from retailer</span>
</div>

      <div class="orders-map-legend-item">
        <span class="legend-shape legend-circle"></span>
        <span>Open order</span>
      </div>

      <div class="orders-map-legend-item">
        <span class="legend-shape legend-own"></span>
        <span>Own transport</span>
      </div>

      <div class="orders-map-legend-item">
        <span class="legend-shape legend-charter"></span>
        <span>FDS / Carrier</span>
      </div>

      <div class="orders-map-legend-item">
        <span class="legend-shape legend-pickup"></span>
        <span>Pick Up Warehouse</span>
      </div>

      <div class="orders-map-legend-item">
        <span class="legend-shape legend-minimum"></span>
        <span>Approval required (&lt; 1.25 m³)</span>
      </div>
    `;

    L.DomEvent.disableClickPropagation(wrapper);

    return wrapper;
  };

  legendControl.addTo(map);
}

function reload() {
  if (!map) return;

  selectedOrderIds = new Set(
    Array.isArray(window.selectedOrderIdsForMap)
      ? window.selectedOrderIdsForMap.map(String)
      : []
  );

  if (!selectedVehicleId && window.pendingPreferredVehicleId) {
    selectedVehicleId = window.pendingPreferredVehicleId;
  }

  map.invalidateSize(true);

clearMainLayers();
renderDepot();
renderOrders();
renderRoutesToMap();
renderDriverLocations();

refreshSelectionPanel();
}

  function buildHintText() {
    if (selectionMode === "circle") {
      return circleCenter
        ? "Move the mouse to set the radius. Click Finish to select the orders inside."
        : "Click anywhere on the map to place the circle centre.";
    }

    if (selectionMode === "rectangle") {
      return rectangleStart
        ? "Move the mouse to resize the rectangle. Click Finish to select the orders inside."
        : "Click anywhere on the map to place the first corner.";
    }

    if (selectionMode === "polygon") {
      if (!polygonPoints.length) return "Click on the map to place the first green point.";
      return "Click to add points. The green point is the start. Click near it, double-click, or press Finish to close.";
    }

    return "Choose Circle, Rectangle or Free Selection, then start on the map.";
  }

  function buildTopControlHtml() {
    return `
      <div class="orders-map-row">
        <button id="mapBtnSelect" class="orders-map-btn ${selectionOperation === "select" ? "active" : ""}" type="button">Select</button>
        <button id="mapBtnDeselect" class="orders-map-btn ${selectionOperation === "deselect" ? "active" : ""}" type="button">Deselect</button>
        <button id="mapBtnToggle" class="orders-map-btn ${selectionOperation === "toggle" ? "active" : ""}" type="button">Toggle</button>
      </div>

      <div class="orders-map-row">
        <button id="mapBtnCircle" class="orders-map-btn ${selectionMode === "circle" ? "active" : ""}" type="button">Circle</button>
        <button id="mapBtnRectangle" class="orders-map-btn ${selectionMode === "rectangle" ? "active" : ""}" type="button">Rectangle</button>
        <button id="mapBtnPolygon" class="orders-map-btn ${selectionMode === "polygon" ? "active" : ""}" type="button">Free Selection</button>
      </div>

      <div class="orders-map-hint">${escapeHtml(buildHintText())}</div>

      <div class="orders-map-row">
        <button id="mapBtnFinishShape" class="orders-map-btn primary" type="button">Finish</button>
        <button id="mapBtnCancelShape" class="orders-map-btn" type="button">Cancel</button>
        <button id="mapBtnClearAllSelection" class="orders-map-btn" type="button">Clear</button>
      </div>

      <div class="orders-map-row">
        <button id="mapBtnExpand" class="orders-map-btn" type="button">${mapExpanded ? "Normal Size" : "Large Map"}</button>
      </div>
    `;
  }


function buildSelectionPanelHtml(preview) {
  const vehicles = getActiveVehicles();
  const fds = getSelectedFdsSummary();
  const selectedCount = selectedOrderIds.size;

  const vehicleOptions = [
    `<option value="">Best available vehicle</option>`,
    ...vehicles.map(vehicle => `
      <option
        value="${escapeHtml(vehicle.id)}"
        ${String(selectedVehicleId) === String(vehicle.id) ? "selected" : ""}
      >
        ${escapeHtml(vehicle.name || vehicle.vehicle_name || "Vehicle")}
        · ${escapeHtml(vehicle.registration || vehicle.vehicle_code || "—")}
      </option>
    `)
  ].join("");

  const button = (id, text, primary = false, disabled = false) => `
    <button
      id="${id}"
      type="button"
      class="orders-map-btn ${primary ? "primary" : ""}"
      ${disabled ? "disabled" : ""}
    >${text}</button>
  `;

  const header = `
    <div class="orders-map-title-row">
      <h4 class="orders-map-title">Route Preview</h4>
      ${button(
        "mapTogglePanelBtn",
        panelMinimized ? "Open" : "Minimize"
      )}
    </div>
  `;

  if (panelMinimized) return header;

  const tile = (label, value) => `
    <div class="orders-map-kv" style="padding:7px;min-width:0">
      <div class="orders-map-kv-label">${label}</div>
      <div class="orders-map-kv-value">${value}</div>
    </div>
  `;

  const vehicleField = `
    <div style="display:grid;gap:5px">
      <label class="orders-map-kv-label" for="mapVehicleSelect">
        Vehicle
      </label>
      <select id="mapVehicleSelect" class="orders-map-select">
        ${vehicleOptions}
      </select>
    </div>
  `;

  const actions = `
    <div class="orders-map-row">
      ${button(
        "mapPreviewSelectionBtn",
        preview ? "Refresh Preview" : "Preview Selection",
        true
      )}
      ${button(
        "mapApplySelectionBtn",
        "Send to Planner",
        false,
        selectedCount === 0
      )}
    </div>
  `;

  const selectionManagement = `
    <details style="
      border:1px solid #e2e8f0;
      border-radius:8px;
      padding:8px;
      background:#f8fafc;
    ">
      <summary style="
        cursor:pointer;
        font-size:11px;
        font-weight:800;
        color:#334155;
      ">
        Manage selection · ${fds.notAssignedCount} unassigned
        · ${fds.alreadyFdsCount} FDS
      </summary>

      <div class="orders-map-fds-selection-summary"
           style="margin-top:9px">
        <div class="orders-map-fds-selection-row">
          <div>
            <strong>${fds.notAssignedCount} Not assigned</strong>
            <span>Not yet assigned to FDS</span>
          </div>
          ${button(
            "mapSelectOnlyNotAssignedBtn",
            "Select only these",
            false,
            !fds.notAssignedCount
          )}
        </div>

        <div class="orders-map-fds-selection-row">
          <div>
            <strong>${fds.alreadyFdsCount} Already FDS</strong>
            <span>Assigned to FDS / Carrier</span>
          </div>
          ${button(
            "mapDeselectFdsBtn",
            "Deselect these",
            false,
            !fds.alreadyFdsCount
          )}
        </div>
      </div>
    </details>
  `;

  if (!preview) {
    return `
      ${header}

      <p class="orders-map-text">
        ${selectedCount} selected order(s).
        Preview to calculate route distance, time and costs.
      </p>

      <div class="orders-map-grid">
        ${tile("Selected orders", formatNumber(selectedCount))}
        ${tile("Selection mode", escapeHtml(selectionMode || "none"))}
      </div>

      ${vehicleField}
      ${selectionManagement}
      ${actions}
    `;
  }

  const selection = preview.selection || {};
  const suggested = preview.suggested_vehicle?.vehicle;
  const selected = preview.selected_vehicle;
  const emission = preview.emission_zones;
  const warnings = Array.isArray(preview.warnings)
    ? preview.warnings
    : [];

  const hasCalculation =
    preview.ok === true &&
    preview.routing_source === "osrm";

  const metric = (value, digits = 1, suffix = "") =>
    hasCalculation && Number.isFinite(Number(value))
      ? `${formatNumber(value, digits)}${suffix}`
      : "—";

  const zoneRows = [
    ...(emission?.delivery_zones || []),
    ...(emission?.route_zones || [])
  ];

  const zoneNames = [
    ...new Set(
      zoneRows.map(zone =>
        zone.zone_name || zone.zone_code
      ).filter(Boolean)
    )
  ];

  const affectedOrders = Number(
    emission?.affected_orders || 0
  );

  const routeZones = emission?.route_zones || [];

  let emissionHtml = "";

  if (emission && emission.checked === false) {
    emissionHtml = `
      <div style="
        padding:10px;
        background:#fff7ed;
        border:1px solid #fdba74;
        border-radius:9px;
        color:#9a3412;
        font-size:11px;
      ">
        <strong>⚠ Emission zone check incomplete</strong>
        <div style="margin-top:4px">
          ${escapeHtml(
            (emission.errors || []).join(" | ") ||
            "Not all emission zone checks could be completed."
          )}
        </div>
      </div>
    `;
  }

  if (zoneNames.length) {
    emissionHtml += `
      <div style="
        padding:10px;
        background:#fffbeb;
        border:1px solid #fcd34d;
        border-radius:9px;
        display:grid;
        gap:5px;
        color:#92400e;
        font-size:11px;
      ">
        <strong>⚠ Emission zone warning</strong>

        <div>
          ${affectedOrders} delivery order(s) inside a zone
          · ${routeZones.length} route zone crossing(s)
        </div>

        <div style="font-weight:800">
          ${zoneNames.map(escapeHtml).join(" · ")}
        </div>

        <small>
          Check vehicle compliance and applicable charges.
          Zone detection does not confirm vehicle eligibility.
        </small>
      </div>
    `;
  }

  const calculationWarning = !hasCalculation
    ? `
      <div style="
        padding:9px;
        background:#fff7ed;
        border:1px solid #fdba74;
        border-radius:8px;
        font-size:10px;
        color:#9a3412;
      ">
        ⚠ Verified road calculation unavailable.
        Route distance, hours and costs are not confirmed.
      </div>
    `
    : "";

  const otherWarnings = warnings.filter(message =>
    !String(message).startsWith("Delivery ") &&
    !String(message).startsWith("Route crosses ") &&
    !String(message).startsWith("Emission zone check:")
  );

  return `
    ${header}

    <div class="orders-map-grid"
         style="grid-template-columns:repeat(4,minmax(0,1fr));gap:5px">
      ${tile("Orders", formatNumber(selection.order_count || 0))}
      ${tile("Colli", formatNumber(selection.total_colli || 0))}
      ${tile("Volume", `${formatNumber(selection.total_volume_m3 || 0, 2)} m³`)}
      ${tile("Stops", formatNumber(selection.stop_count || 0))}
    </div>

    <div class="orders-map-grid"
         style="grid-template-columns:repeat(3,minmax(0,1fr));gap:5px">
      ${tile("Distance", metric(selection.distance_miles, 1, " mi"))}
      ${tile("Duration", metric(selection.total_hours, 2, " h"))}
      ${tile("Cost", hasCalculation
        ? formatMoney(selection.total_cost_gbp)
        : "—")}
    </div>

    ${calculationWarning}
    ${emissionHtml}

    ${vehicleField}

    <div class="orders-map-kv" style="padding:8px">
      <div class="orders-map-kv-label">Suggested Vehicle</div>
      <div class="orders-map-kv-value">
        ${escapeHtml(
          suggested?.name ||
          suggested?.vehicle_name ||
          "No suitable vehicle found"
        )}
      </div>

      ${selected ? `
        <div style="font-size:10px;color:#64748b;margin-top:4px">
          Selected: ${escapeHtml(
            selected.vehicle?.name ||
            selected.vehicle?.vehicle_name ||
            "Vehicle"
          )}
          · ${formatNumber((selected.fillRate || 0) * 100, 0)}% fill
          · ${hasCalculation ? formatMoney(selected.totalCost) : "Cost unverified"}
        </div>
      ` : ""}
    </div>

    ${otherWarnings.length ? `
      <details style="font-size:10px;color:#92400e">
        <summary>Other warnings (${otherWarnings.length})</summary>
        <div style="margin-top:5px">
          ${otherWarnings.map(escapeHtml).join(" | ")}
        </div>
      </details>
    ` : ""}

    ${selectionManagement}
    ${actions}
  `;
}

  function installTopControl() {
    if (!map || topControl) return;

    topControl = L.control({ position: "topleft" });

    topControl.onAdd = function () {
      const wrapper = L.DomUtil.create("div", "orders-map-control compact");
      wrapper.id = "ordersMapTopControl";
      wrapper.innerHTML = buildTopControlHtml();
      L.DomEvent.disableClickPropagation(wrapper);
      return wrapper;
    };

    topControl.addTo(map);
    bindTopControlEvents();
  }

  function installPanelControl() {
    if (!map || panelControl) return;

    panelControl = L.control({ position: "bottomleft" });

    panelControl.onAdd = function () {
      const wrapper = L.DomUtil.create("div", "orders-map-control");
      wrapper.id = "ordersMapSelectionPanel";
      wrapper.innerHTML = buildSelectionPanelHtml(previewCache);
      L.DomEvent.disableClickPropagation(wrapper);
      return wrapper;
    };

    panelControl.addTo(map);
    bindSelectionPanelEvents();
  }

  function refreshTopControl() {
    const el = byId("ordersMapTopControl");
    if (!el) return;

    el.innerHTML = buildTopControlHtml();
    bindTopControlEvents();
  }

  function refreshSelectionPanel() {
    const el = byId("ordersMapSelectionPanel");
    if (!el) return;

    el.innerHTML = buildSelectionPanelHtml(previewCache);
    bindSelectionPanelEvents();
  }

  function bindTopControlEvents() {
    setTimeout(() => {
      byId("mapBtnSelect")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        selectionOperation = "select";
        refreshTopControl();
      });

      byId("mapBtnDeselect")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        selectionOperation = "deselect";
        refreshTopControl();
      });

      byId("mapBtnToggle")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        selectionOperation = "toggle";
        refreshTopControl();
      });

      byId("mapBtnCircle")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        startMode("circle");
      });

      byId("mapBtnRectangle")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        startMode("rectangle");
      });

      byId("mapBtnPolygon")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        startMode("polygon");
      });

      byId("mapBtnFinishShape")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        finishCurrentShape();
      });

      byId("mapBtnCancelShape")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        cancelCurrentShape();
      });

      byId("mapBtnClearAllSelection")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        selectedOrderIds.clear();
        previewCache = null;
        resetDraft();
        emitSelection();
        reload();
      });

      byId("mapBtnExpand")?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        toggleMapExpanded();
      });
    }, 0);
  }

function bindSelectionPanelEvents() {
  setTimeout(() => {

    byId("mapTogglePanelBtn")?.addEventListener("click", () => {
      panelMinimized = !panelMinimized;
      refreshSelectionPanel();
    });


    const vehicleSelect = byId("mapVehicleSelect");

    if (vehicleSelect) {
      vehicleSelect.addEventListener("change", () => {
        selectedVehicleId = vehicleSelect.value || "";
        previewCache = null;

        refreshSelectionPanel();

        window.dispatchEvent(
          new CustomEvent(
            "veynor:vehicle-selected",
            {
              detail: {
                vehicleId: selectedVehicleId
              }
            }
          )
        );
      });
    }


    /*
     * Keep only selected orders
     * that are NOT yet assigned to FDS.
     */
    byId("mapSelectOnlyNotAssignedBtn")
      ?.addEventListener("click", () => {

        const summary =
          getSelectedFdsSummary();

        selectedOrderIds.clear();

        summary.notAssigned.forEach(order => {
          selectedOrderIds.add(
            String(order.id)
          );
        });

        previewCache = null;

        emitSelection();
        reload();
      });


    /*
     * Remove all orders from the current
     * selection that are already assigned to FDS.
     */
    byId("mapDeselectFdsBtn")
      ?.addEventListener("click", () => {

        const summary =
          getSelectedFdsSummary();

        summary.alreadyFds.forEach(order => {
          selectedOrderIds.delete(
            String(order.id)
          );
        });

        previewCache = null;

        emitSelection();
        reload();
      });


    byId("mapPreviewSelectionBtn")
      ?.addEventListener("click", async () => {
        await previewSelection();
      });


    byId("mapApplySelectionBtn")
      ?.addEventListener("click", () => {
        applySelectionToPlanner(true);
      });

  }, 0);
}

  function startMode(mode) {
    selectionMode = mode;
    previewCache = null;
    resetDraft();
    setMapCursor("crosshair");
    refreshTopControl();
    refreshSelectionPanel();
  }

  function cancelCurrentShape() {
    selectionMode = null;
    resetDraft();
    setMapCursor("");
    refreshTopControl();
    refreshSelectionPanel();
  }

  function toggleMapExpanded() {
    mapExpanded = !mapExpanded;

    const card = document.querySelector(".map-card");

    if (card) {
      card.classList.toggle("map-expanded", mapExpanded);
      document.body.classList.toggle("map-overlay-open", mapExpanded);
    }

    refreshTopControl();

    setTimeout(() => {
      map?.invalidateSize(true);
    }, 80);
  }

  function applySelectionToIds(ids) {
    ids.forEach(id => {
      const key = String(id);

      if (selectionOperation === "select") selectedOrderIds.add(key);

      if (selectionOperation === "deselect") selectedOrderIds.delete(key);

      if (selectionOperation === "toggle") {
        if (selectedOrderIds.has(key)) selectedOrderIds.delete(key);
        else selectedOrderIds.add(key);
      }
    });

    previewCache = null;
    emitSelection();
  }

  function emitSelection() {
    const ids = [...selectedOrderIds];

    window.selectedOrderIdsForMap = ids;

    window.dispatchEvent(new CustomEvent("veynor:map-selection-changed", {
      detail: {
        selectedOrderIds: ids
      }
    }));
  }

  function applySelectionToPlanner(closePanel = false) {
  emitSelection();

  window.dispatchEvent(new CustomEvent("veynor:map-send-to-planner", {
    detail: {
      selectedOrderIds: [...selectedOrderIds],
      selectedVehicleId: selectedVehicleId || ""
    }
  }));

  if (closePanel) {
    previewCache = null;
    refreshSelectionPanel();
  }
}


async function previewSelection() {
  const selectedIds = [...selectedOrderIds];

  if (!selectedIds.length) {
    previewCache = null;
    refreshSelectionPanel();
    return;
  }

  const selectedOrders = getVisibleOrders().filter(row =>
    selectedOrderIds.has(String(row.id))
  );

  const vehicles = getActiveVehicles();

  const totalVolume = selectedOrders.reduce(
    (sum, row) => sum + getOrderVolume(row), 0
  );

  const totalColli = selectedOrders.reduce(
    (sum, row) => sum + getOrderColli(row), 0
  );

  const selectedVehicle = vehicles.find(vehicle =>
    String(vehicle.id) === String(selectedVehicleId)
  ) || null;

  const selectionBase = {
    order_count: selectedOrders.length,
    total_colli: totalColli,
    total_volume_m3: totalVolume,
    distance_miles: null,
    total_hours: null,
    total_cost_gbp: null,
    cost_per_stop_gbp: null,
    stop_count: null
  };

  // Show the user that the calculation has started.
  previewCache = null;
  refreshSelectionPanel();

  try {
    if (!window.PlanningEngine?.previewSelection) {
      throw new Error(
        "Planning Engine is not available."
      );
    }

    const result = await window.PlanningEngine.previewSelection({
      order_ids: selectedIds,
      preferred_vehicle_id: selectedVehicleId || null,
      vehicle_id: selectedVehicleId || null
    });

    if (!result?.ok || !result.summary) {
      throw new Error(
        result?.message || "Route preview unavailable."
      );
    }

    const summary = result.summary;

    // Ignore an outdated preview if the selection changed.
    if (
      selectedIds.length !== selectedOrderIds.size ||
      selectedIds.some(id => !selectedOrderIds.has(id))
    ) {
      return;
    }

    previewCache = {
      ok: true,
      routing_source: result.routing_source ||
        summary.routingSource ||
        "estimated",

      selection: {
        ...selectionBase,
        order_count: result.selected_orders,
        total_colli: summary.totalColli ?? totalColli,
        total_volume_m3: summary.totalVolume ?? totalVolume,
        distance_miles: summary.distanceMiles,
        total_hours: summary.totalHours,
        total_cost_gbp: summary.totalCost,
        cost_per_stop_gbp: summary.costPerStop,
        stop_count: summary.totalStops
      },

      suggested_vehicle: result.suggested_vehicle
        ? { vehicle: result.suggested_vehicle }
        : null,

      selected_vehicle: selectedVehicle
        ? {
            vehicle: selectedVehicle,
            fillRate: summary.fillRate,
            totalCost: summary.totalCost
          }
        : null,

      emission_zones: result.emission_zones || null,
      warnings: result.warnings || []
    };

    console.info(
      "[orders-map.js] Route preview completed:",
      {
        orders: result.selected_orders,
        stops: summary.totalStops,
        miles: summary.distanceMiles,
        emission_zones:
          result.emission_zones?.unique_zone_count ?? 0,
        affected_orders:
          result.emission_zones?.affected_orders ?? 0,
        emission_checked:
          result.emission_zones?.checked ?? false
      }
    );

  } catch (error) {
    console.error(
      "[orders-map.js] Route preview failed:",
      error
    );

    previewCache = {
      ok: false,
      routing_source: "unavailable",
      selection: selectionBase,

      suggested_vehicle: null,
      selected_vehicle: selectedVehicle
        ? {
            vehicle: selectedVehicle,
            fillRate: totalVolume /
              Math.max(
                1,
                Number(
                  selectedVehicle.capacity_m3 ||
                  selectedVehicle.max_volume_m3 ||
                  1
                )
              ),
            totalCost: null
          }
        : null,

      emission_zones: {
        checked: false,
        delivery_zones: [],
        route_zones: [],
        affected_orders: 0,
        errors: [
          "Emission assessment unavailable because the route preview failed."
        ]
      },

      warnings: [
        error.message || "Route calculation failed."
      ]
    };
  }

  refreshSelectionPanel();
}

  function drawVertex(point, isFirst = false, isClose = false) {
    if (!vertexLayer) return;

    vertexLayer.addLayer(L.marker(point, {
      icon: buildVertexIcon(isFirst, isClose),
      interactive: false
    }));
  }

  function redrawPolygonPreview(mousePoint = null) {
    selectionLayer?.clearLayers();
    vertexLayer?.clearLayers();
    activeShape = null;
    previewShape = null;

    polygonPoints.forEach((point, index) => {
      drawVertex(point, index === 0, false);
    });

    if (!polygonPoints.length) return;

    const previewPoints = mousePoint
      ? [...polygonPoints, mousePoint]
      : [...polygonPoints];

    if (previewPoints.length >= 2) {
      previewShape = L.polyline(previewPoints, {
        color: "#111827",
        weight: 2,
        dashArray: "6,6"
      }).addTo(selectionLayer);
    }

    if (polygonPoints.length >= 3) {
      activeShape = L.polygon(polygonPoints, {
        color: "#111827",
        weight: 2,
        fillColor: "#111827",
        fillOpacity: 0.12
      }).addTo(selectionLayer);
    }
  }

  function redrawCirclePreview(mousePoint = null) {
    selectionLayer?.clearLayers();
    vertexLayer?.clearLayers();
    activeShape = null;

    if (!circleCenter) return;

    drawVertex(circleCenter, true, false);

    const radius = mousePoint ? circleCenter.distanceTo(mousePoint) : 1;

    activeShape = L.circle(circleCenter, {
      radius,
      color: "#111827",
      weight: 2,
      fillColor: "#111827",
      fillOpacity: 0.12
    }).addTo(selectionLayer);
  }

  function redrawRectanglePreview(mousePoint = null) {
    selectionLayer?.clearLayers();
    vertexLayer?.clearLayers();
    activeShape = null;

    if (!rectangleStart) return;

    drawVertex(rectangleStart, true, false);

    const endPoint = mousePoint || rectangleStart;

    activeShape = L.rectangle([rectangleStart, endPoint], {
      color: "#111827",
      weight: 2,
      fillColor: "#111827",
      fillOpacity: 0.12
    }).addTo(selectionLayer);
  }

  function isNearFirstPolygonPoint(latlng) {
    if (!map || polygonPoints.length < 3) return false;

    const first = polygonPoints[0];
    const firstPx = map.latLngToContainerPoint(first);
    const currentPx = map.latLngToContainerPoint(latlng);

    return firstPx.distanceTo(currentPx) <= POLYGON_CLOSE_DISTANCE_PX;
  }

  function updateClosePointVisual(latlng) {
    if (selectionMode !== "polygon" || polygonPoints.length < 3 || !vertexLayer) return;

    const near = isNearFirstPolygonPoint(latlng);

    vertexLayer.clearLayers();

    polygonPoints.forEach((point, index) => {
      drawVertex(point, index === 0, index === 0 && near);
    });
  }

  function findOrdersInsideLayer(layer) {
    return getVisibleOrders()
      .filter(hasCoordinates)
      .filter(row => {
        const point = L.latLng(getLatitude(row), getLongitude(row));

        if (layer instanceof L.Circle) {
          return point.distanceTo(layer.getLatLng()) <= layer.getRadius();
        }

        if (layer instanceof L.Rectangle) {
          return layer.getBounds().contains(point);
        }

        if (layer instanceof L.Polygon) {
          return pointInPolygon(point, layer.getLatLngs()[0] || []);
        }

        return false;
      })
      .map(row => String(row.id));
  }

  function pointInPolygon(point, polygon) {
    const x = point.lng;
    const y = point.lat;

    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;

      const intersect =
        ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.0000001) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }

  function finishCurrentShape() {
    if (selectionMode === "polygon") {
      if (polygonPoints.length < 3) {
        refreshTopControl();
        return;
      }

      selectionLayer?.clearLayers();

      activeShape = L.polygon(polygonPoints, {
        color: "#111827",
        weight: 2,
        fillColor: "#111827",
        fillOpacity: 0.12
      }).addTo(selectionLayer);
    }

    if (!activeShape) {
      cancelCurrentShape();
      return;
    }

    const ids = findOrdersInsideLayer(activeShape);

    applySelectionToIds(ids);
    cancelCurrentShape();
    reload();
  }

  function handleMapClick(event) {
    if (!selectionMode) return;

    if (selectionMode === "circle") {
      if (!circleCenter) {
        circleCenter = event.latlng;
        redrawCirclePreview(event.latlng);
        refreshTopControl();
        return;
      }

      return;
    }

    if (selectionMode === "rectangle") {
      if (!rectangleStart) {
        rectangleStart = event.latlng;
        redrawRectanglePreview(event.latlng);
        refreshTopControl();
        return;
      }

      return;
    }

    if (selectionMode === "polygon") {
      if (polygonPoints.length >= 3 && isNearFirstPolygonPoint(event.latlng)) {
        finishCurrentShape();
        return;
      }

      polygonPoints.push(event.latlng);
      redrawPolygonPreview();
      refreshTopControl();
    }
  }

  function handleMouseMove(event) {
    if (!selectionMode) return;

    if (selectionMode === "circle" && circleCenter) {
      redrawCirclePreview(event.latlng);
    }

    if (selectionMode === "rectangle" && rectangleStart) {
      redrawRectanglePreview(event.latlng);
    }

    if (selectionMode === "polygon" && polygonPoints.length) {
      redrawPolygonPreview(event.latlng);
      updateClosePointVisual(event.latlng);
    }
  }

  function installMapHandlers() {
    if (!map) return;

    map.on("click", handleMapClick);
    map.on("mousemove", handleMouseMove);

    map.on("dblclick", event => {
      if (selectionMode === "polygon") {
        L.DomEvent.stop(event);
        finishCurrentShape();
      }
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") cancelCurrentShape();
      if (event.key === "Enter") finishCurrentShape();
    });
  }

  function initMap() {
    const mapEl = byId("ordersMap");
    if (!mapEl || typeof L === "undefined") return;

    injectStyles();

    map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: true,
      doubleClickZoom: false
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

// Emission zones below orders and route lines
map.createPane("emissionZonesPane");

map.getPane("emissionZonesPane").style.zIndex = "350";
map.getPane("emissionZonesPane").style.pointerEvents = "none";

emissionZoneLayer = L.geoJSON(null, {
  pane: "emissionZonesPane",
  interactive: false
}).addTo(map);

depotLayer = L.layerGroup().addTo(map);
orderLayer = L.layerGroup().addTo(map);
routeLineLayer = L.layerGroup().addTo(map);
routeStopLayer = L.layerGroup().addTo(map);

driverLocationLayer =
  L.layerGroup().addTo(map);

selectionLayer =
  L.layerGroup().addTo(map);

vertexLayer =
  L.layerGroup().addTo(map);

installTopControl();
installPanelControl();
installLegendControl();
installMapHandlers();

fitUk();

// First read the tenant's visibility preference.
// Only load and display boundaries when enabled.
void loadEmissionMapSettings()
  .then(() => {
    if (emissionZonesVisible) {
      return loadEmissionZones();
    }
  })
  .catch(error => {
    console.error(
      "[orders-map.js] Emission map settings failed:",
      error
    );

    // Fail closed: do not show zones when tenant
    // visibility preferences cannot be verified.
    emissionZonesVisible = false;
    applyEmissionZoneVisibility();
  });

    setTimeout(() => {
      reload();
      map.invalidateSize(true);
    }, 300);

    setTimeout(() => {
      map.invalidateSize(true);
    }, 800);

    window.addEventListener("resize", () => {
      map?.invalidateSize(true);
    });

    log("Orders map loaded.");
  }

  window.OrdersMap = {
    reload,
    fitUk,
    fitToVisible: () => {
      const latlngs = getVisibleOrders()
        .map(row => [getLatitude(row), getLongitude(row)])
        .filter(xy => Number.isFinite(xy[0]) && Number.isFinite(xy[1]));

      const depot = getDepotPoint();

      if (depot && Number.isFinite(Number(depot.latitude)) && Number.isFinite(Number(depot.longitude))) {
        latlngs.push([Number(depot.latitude), Number(depot.longitude)]);
      }

      if (latlngs.length) fitToBounds(latlngs);
      else fitUk();
    },
    clearSelection: () => {
      selectedOrderIds.clear();
      previewCache = null;
      emitSelection();
      reload();
    },
    cancelShape: cancelCurrentShape
  };

  window.reloadOrdersMap = reload;
  window.fitOrdersMapUk = fitUk;

  document.addEventListener("DOMContentLoaded", initMap);
})();