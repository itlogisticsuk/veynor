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

  const status = normalize(row.status || row.transport_status || "");
  const transport = normalize(row.transport_type || "");
  const hasRoute = !!row.route_id;

  // Delivered
  if (["delivered", "completed"].includes(status)) {
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

  // Warehouse pickup
  if (isWarehousePickupOrder(row)) {
    return "#eab308"; // Yellow
  }

  // Minimum delivery approval required
  if (row.belowMinimumVolume === true) {
    return "#7c3aed"; // Purple
  }
  // Planned on own transport
  if (hasRoute && transport === "own_transport") {
    return "#16a34a"; // Green
  }

  // Planned on FDS / Carrier
  if (hasRoute && transport === "charter") {
    return "#f97316"; // Orange
  }

  // Assigned to FDS but not yet planned
if (!hasRoute && transport === "charter") {
    return "#f97316";
}

  // Default: open order
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
  return (
    normalize(order.transport_type) === "charter" ||
    normalize(order.status) === "export_for_charter" ||
    !!order.fds_collection_week ||
    !!order.fds_collection_date ||
    !!order.fds_job_ref
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

        <span class="order-map-hover-status">
          ${escapeHtml(getOrderStatusLabel(row))}
        </span>
      </div>

      <div class="order-map-hover-section">
        <strong>
          ${escapeHtml(getRetailerName(row))}
        </strong>

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
          Requested:
          <strong>${escapeHtml(getOrderRequestedDate(row))}</strong>
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
  const fdsOrders = getGroupFdsOrders(group);
  const pickupOrders = getGroupPickupOrders(group);

const deliveryDate =
  getGroupDeliveryDate(group);

const fdsCollectionDate =
  getGroupFdsCollectionDate(group);

const fdsDeliveryWeek =
  getNextFdsDeliveryWeek(
    fdsCollectionDate
  );

  const orderLines = orders.map(order => `
    <div class="order-map-group-order">
      <span>
        <strong>${escapeHtml(order.order_number || "Order")}</strong>
        <small>
          ACK: ${escapeHtml(order.external_reference || "—")}
        </small>
      </span>

      <span>
        ${formatNumber(getOrderColli(order))} pkg ·
        ${formatNumber(getOrderVolume(order), 2)} m³
      </span>
    </div>
  `).join("");

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
     
        pickupOrders.length
          ? `
            <span class="order-map-hover-status pickup">
              PICK UP
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
      pickupOrders.length
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
                        formatMapDate(
                          deliveryDate
                        )
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
                          formatMapDate(
                            fdsCollectionDate
                          )
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
                      formatMapDate(
                        deliveryDate
                      )
                    )}
                  </strong>
                </span>
              </div>
            `
            : ""
    }
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
  max-height:145px;
  overflow-y:auto;
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
        interactive: false,
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

    const vehicleOptions = [
      `<option value="">Best available vehicle</option>`,
      ...vehicles.map(vehicle => `
        <option value="${escapeHtml(vehicle.id)}" ${String(selectedVehicleId) === String(vehicle.id) ? "selected" : ""}>
          ${escapeHtml(vehicle.name || vehicle.vehicle_name || "Vehicle")} · ${escapeHtml(vehicle.registration || vehicle.vehicle_code || "—")}
        </option>
      `)
    ].join("");

    if (panelMinimized) {
      return `
        <div class="orders-map-title-row">
          <h4 class="orders-map-title">Manual Selection</h4>
          <button id="mapTogglePanelBtn" class="orders-map-btn" type="button">Open</button>
        </div>
      `;
    }

    const selectedCount = selectedOrderIds.size;

    if (!preview) {
      return `
        <div class="orders-map-title-row">
          <h4 class="orders-map-title">Manual Selection</h4>
          <button id="mapTogglePanelBtn" class="orders-map-btn" type="button">Minimize</button>
        </div>

        <p class="orders-map-text">
          Select orders on the map. Use <strong>Preview Selection</strong> to calculate volume, hours, cost and suggested vehicle.
        </p>

        <div class="orders-map-grid">
          <div class="orders-map-kv">
            <div class="orders-map-kv-label">Selected Orders</div>
            <div class="orders-map-kv-value">${formatNumber(selectedCount)}</div>
          </div>
          <div class="orders-map-kv">
            <div class="orders-map-kv-label">Mode</div>
            <div class="orders-map-kv-value">${escapeHtml(selectionMode || "none")}</div>
          </div>
        </div>

        <select id="mapVehicleSelect" class="orders-map-select">${vehicleOptions}</select>

        <div class="orders-map-row">
          <button id="mapPreviewSelectionBtn" class="orders-map-btn primary" type="button">Preview Selection</button>
          <button id="mapApplySelectionBtn" class="orders-map-btn" type="button">Send to Planner</button>
        </div>
      `;
    }

    const sel = preview.selection || {};
    const suggested = preview.suggested_vehicle;
    const selected = preview.selected_vehicle;

    return `
      <div class="orders-map-title-row">
        <h4 class="orders-map-title">Manual Selection</h4>
        <button id="mapTogglePanelBtn" class="orders-map-btn" type="button">Minimize</button>
      </div>

      <p class="orders-map-text">${escapeHtml(selectedCount)} selected order(s).</p>

      <div class="orders-map-grid">
        <div class="orders-map-kv"><div class="orders-map-kv-label">Orders</div><div class="orders-map-kv-value">${formatNumber(sel.order_count || 0)}</div></div>
        <div class="orders-map-kv"><div class="orders-map-kv-label">Colli</div><div class="orders-map-kv-value">${formatNumber(sel.total_colli || 0)}</div></div>
        <div class="orders-map-kv"><div class="orders-map-kv-label">Volume</div><div class="orders-map-kv-value">${formatNumber(sel.total_volume_m3 || 0, 2)} m³</div></div>
        <div class="orders-map-kv"><div class="orders-map-kv-label">Miles</div><div class="orders-map-kv-value">${formatNumber(sel.distance_miles || 0, 1)}</div></div>
        <div class="orders-map-kv"><div class="orders-map-kv-label">Hours</div><div class="orders-map-kv-value">${formatNumber(sel.total_hours || 0, 2)} h</div></div>
        <div class="orders-map-kv"><div class="orders-map-kv-label">Cost</div><div class="orders-map-kv-value">${formatMoney(sel.total_cost_gbp || 0)}</div></div>
        <div class="orders-map-kv"><div class="orders-map-kv-label">Cost / Stop</div><div class="orders-map-kv-value">${formatMoney(sel.cost_per_stop_gbp || 0)}</div></div>
        <div class="orders-map-kv"><div class="orders-map-kv-label">Stops</div><div class="orders-map-kv-value">${formatNumber(sel.stop_count || 0)}</div></div>
      </div>

      <select id="mapVehicleSelect" class="orders-map-select">${vehicleOptions}</select>

      <div class="orders-map-kv">
        <div class="orders-map-kv-label">Suggested Vehicle</div>
        <div class="orders-map-kv-value">${suggested?.vehicle?.name ? escapeHtml(suggested.vehicle.name) : "No vehicle match"}</div>
      </div>

      ${
        selected
          ? `
            <div class="orders-map-kv">
              <div class="orders-map-kv-label">Selected Vehicle Estimate</div>
              <div class="orders-map-kv-value">
                ${escapeHtml(selected.vehicle?.name || "—")} · ${formatNumber((selected.fillRate || 0) * 100, 0)}% fill · ${formatMoney(selected.totalCost || 0)}
              </div>
            </div>
          `
          : ``
      }

      <div class="orders-map-row">
        <button id="mapPreviewSelectionBtn" class="orders-map-btn primary" type="button">Refresh Preview</button>
        <button id="mapApplySelectionBtn" class="orders-map-btn" type="button">Send to Planner</button>
      </div>
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

          window.dispatchEvent(new CustomEvent("veynor:vehicle-selected", {
            detail: {
              vehicleId: selectedVehicleId
            }
          }));
        });
      }

      byId("mapPreviewSelectionBtn")?.addEventListener("click", async () => {
        await previewSelection();
      });

      byId("mapApplySelectionBtn")?.addEventListener("click", () => {
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

    const selectedOrders = getVisibleOrders().filter(row => selectedOrderIds.has(String(row.id)));
    const vehicles = getActiveVehicles();

    if (window.PlanningEngine?.previewSelection) {
      try {
        const result = await window.PlanningEngine.previewSelection({
          order_ids: selectedIds,
          preferred_vehicle_id: selectedVehicleId || null,
          vehicle_id: selectedVehicleId || null
        });

        const summary = result?.summary || {};

        previewCache = {
          selection: {
            order_count: result?.selected_orders || selectedOrders.length,
            total_colli: selectedOrders.reduce((sum, row) => sum + getOrderColli(row), 0),
            total_volume_m3: summary.totalVolume ?? selectedOrders.reduce((sum, row) => sum + getOrderVolume(row), 0),
            distance_miles: summary.distanceMiles || 0,
            total_hours: summary.totalHours || 0,
            total_cost_gbp: summary.totalCost || 0,
            cost_per_stop_gbp: summary.costPerStop || 0,
            stop_count: summary.totalStops || selectedOrders.length
          },
          suggested_vehicle: result?.suggested_vehicle ? { vehicle: result.suggested_vehicle } : null,
          selected_vehicle: selectedVehicleId
            ? {
                vehicle: vehicles.find(v => String(v.id) === String(selectedVehicleId)),
                fillRate: summary.fillRate || 0,
                totalCost: summary.totalCost || 0
              }
            : null
        };

        refreshSelectionPanel();
        return;
      } catch (error) {
        console.warn("[orders-map.js] PlanningEngine preview failed, fallback used:", error.message);
      }
    }

    const totalVolume = selectedOrders.reduce((sum, row) => sum + getOrderVolume(row), 0);
    const totalColli = selectedOrders.reduce((sum, row) => sum + getOrderColli(row), 0);
    const revenue = selectedOrders.reduce((sum, row) => sum + getOrderRevenue(row), 0);

    const suggested = vehicles
      .filter(vehicle => Number(vehicle.capacity_m3 || vehicle.max_volume_m3 || 0) >= totalVolume)
      .sort((a, b) => Number(a.capacity_m3 || a.max_volume_m3 || 0) - Number(b.capacity_m3 || b.max_volume_m3 || 0))[0] || null;

    const selectedVehicle = selectedVehicleId
      ? vehicles.find(v => String(v.id) === String(selectedVehicleId))
      : null;

    previewCache = {
      selection: {
        order_count: selectedOrders.length,
        total_colli: totalColli,
        total_volume_m3: totalVolume,
        distance_miles: 0,
        total_hours: 0,
        total_cost_gbp: 0,
        cost_per_stop_gbp: 0,
        stop_count: selectedOrders.length,
        revenue_gbp: revenue
      },
      suggested_vehicle: suggested ? { vehicle: suggested } : null,
      selected_vehicle: selectedVehicle
        ? {
            vehicle: selectedVehicle,
            fillRate: totalVolume / Math.max(1, Number(selectedVehicle.capacity_m3 || selectedVehicle.max_volume_m3 || 1)),
            totalCost: 0
          }
        : null
    };

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