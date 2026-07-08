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

  // Delivery Groups (shared with OCC)
  const deliveryGroups = window.VeynorDeliveryGroups;

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

  function buildOrderTooltip(row) {
    const lez = isLowEmissionZone(row);
    const under75 = isUnder75Tons(row);

    return `
      <div style="display:grid;gap:4px;min-width:210px;">
        <strong>${escapeHtml(row.order_number || "Order")}</strong>
        <div>${escapeHtml(getProductOwnerName(row))}</div>
        <div>${escapeHtml(getRetailerName(row))}</div>
        <div>${escapeHtml(row.delivery_city || "—")} · ${escapeHtml(row.delivery_postcode || "—")}</div>
        <div>${formatNumber(getOrderColli(row))} colli · ${formatNumber(getOrderVolume(row), 2)} m³</div>
        <div>${escapeHtml((row.transport_type || "unassigned").replaceAll("_", " "))}</div>
        <div>LEZ: ${lez ? "Yes" : "No"} · 7.5t zone: ${under75 ? "Yes" : "No"}</div>
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

    getVisibleOrders().forEach(row => {
      const lat = getLatitude(row);
      const lng = getLongitude(row);

      if (lat === null || lng === null) return;

      const marker = L.marker([lat, lng], {
        icon: buildOrderShapeIcon(row),
        title: row.order_number || "Order"
      });

      marker.bindPopup(buildOrderTooltip(row));

      marker.on("click", event => {
        if (selectionMode) return;
        L.DomEvent.stopPropagation(event);
        applySelectionToIds([String(row.id)]);
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

  legendControl = L.control({ position: "bottomright" });

  legendControl.onAdd = function () {
    const wrapper = L.DomUtil.create("div", "orders-map-legend");

   wrapper.innerHTML = `
  <div class="orders-map-legend-title">Map legend</div>

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
    selectionLayer = L.layerGroup().addTo(map);
    vertexLayer = L.layerGroup().addTo(map);

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