
/*
 * ============================================================
 * VEYNOR ROUTE WORKSPACE MAP
 * File: /js/planning-engine/route-workspace-map.js
 *
 * VERSION 3.0
 * DEEL 1 VAN 5
 *
 * Interactive Route Planning Map
 *
 * - Multi-tenant depot configuration
 * - Leaflet / OpenStreetMap
 * - OSRM road routing
 * - Grouped delivery markers
 * - Draft route ordering
 * - Distance in miles
 * - Safe route data validation
 *
 * All route changes use VeynorRouteWorkspace.
 * No direct database writes.
 *
 * Parts 1-5 must be placed in the same JavaScript file.
 * ============================================================
 */

(function () {
  "use strict";

  // ==========================================================
  // 1. WORKSPACE CONTROLLER
  // ==========================================================

  const workspace = window.VeynorRouteWorkspace;

  if (!workspace || typeof workspace.registerModule !== "function") {
    throw new Error(
      "Load route-workspace.js before route-workspace-map.js."
    );
  }

  // ==========================================================
  // 2. CONFIGURATION
  // ==========================================================

  const MAP_CONFIG = Object.freeze({
    osrmBaseUrl: "https://router.project-osrm.org",

    tiles: {
      standard: {
        label: "Street Map",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
          'target="_blank" rel="noopener noreferrer">' +
          "OpenStreetMap contributors</a>",
        maxZoom: 19
      },

      detailed: {
        label: "Detailed Map",
        url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
        attribution:
          '&copy; OpenStreetMap contributors, HOT',
        maxZoom: 19
      }
    },

    defaultTile: "standard",

    markerSize: 34,
    markerHeight: 34,
    markerGroupingDecimals: 6,

    dropRadiusPixels: 75,

    fitPadding: [35, 35],
    maxFitZoom: 14,

    geometryTimeoutMs: 12000,
    geometryCacheLimit: 20,

    maxHistory: 30,
    maxLocations: 250
  });

  // ==========================================================
  // 3. DOM HELPERS
  // ==========================================================

  function element(tag, className = "", text) {
    const node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }

    return node;
  }

  function setText(node, value) {
    if (node) {
      node.textContent = String(value ?? "—");
    }
  }

  function formatNumber(value, digits = 2) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    return new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(Number(value));
  }

  function formatMiles(value) {
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    return `${formatNumber(value, 1)} mi`;
  }

  function formatMinutes(value) {
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    const minutes = Math.max(
      0,
      Math.round(Number(value))
    );

    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    return remainder
      ? `${hours}h ${remainder}m`
      : `${hours}h`;
  }

  // ==========================================================
  // 4. COORDINATE VALIDATION
  // ==========================================================

  function readCoordinate(value, minimum, maximum) {
    if (
      value === null ||
      value === undefined ||
      !["string", "number"].includes(typeof value) ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const number = Number(
      String(value).trim().replace(",", ".")
    );

    if (
      !Number.isFinite(number) ||
      number < minimum ||
      number > maximum
    ) {
      return null;
    }

    return number;
  }

  function readPoint(latitude, longitude) {
    const lat = readCoordinate(latitude, -90, 90);
    const lng = readCoordinate(longitude, -180, 180);

    if (lat === null || lng === null) {
      return null;
    }

    return [lat, lng];
  }

  function coordinateKey(point) {
    if (
      !Array.isArray(point) ||
      point.length !== 2
    ) {
      return null;
    }

    const decimals = MAP_CONFIG.markerGroupingDecimals;

    return point
      .map(value => Number(value).toFixed(decimals))
      .join(",");
  }

  // ==========================================================
  // 5. MULTI-TENANT COMPANY VALIDATION
  // ==========================================================

  function activeCompanyId() {
    const candidates = [
      window.VeynorPlannerData?.companyId,
      window.VeynorOrdersPlanner?.getCompanyId?.()
    ];

    return candidates.find(value =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)
    ) || null;
  }

  function assertCompany(companyId) {
    if (
      !companyId ||
      String(activeCompanyId()) !== String(companyId)
    ) {
      throw new Error(
        "Company changed. Close and reopen Route Workspace."
      );
    }
  }

  // ==========================================================
  // 6. LOAD COMPANY DEPOT FROM SUPABASE
  // ==========================================================

  async function loadDepot(companyId, signal) {
    assertCompany(companyId);

    if (typeof sb !== "function") {
      throw new Error(
        "Supabase helper sb() is missing."
      );
    }

    let query = sb()
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", companyId)
      .in("setting_key", [
        "home_depot_name",
        "home_depot_lat",
        "home_depot_lng",
        "depot_name",
        "depot_lat",
        "depot_lng"
      ]);

    if (
      signal &&
      typeof query.abortSignal === "function"
    ) {
      query = query.abortSignal(signal);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    assertCompany(companyId);

    const settings = new Map(
      (data || []).map(row => [
        row.setting_key,
        row.setting_value
      ])
    );

    const latitude =
      settings.get("home_depot_lat") ??
      settings.get("depot_lat");

    const longitude =
      settings.get("home_depot_lng") ??
      settings.get("depot_lng");

    const point = readPoint(
      latitude,
      longitude
    );

    if (!point) {
      throw new Error(
        "Company depot coordinates are missing or invalid."
      );
    }

    return {
      companyId,

      name: String(
        settings.get("home_depot_name") ||
        settings.get("depot_name") ||
        "Home Depot"
      ),

      point
    };
  }

  // ==========================================================
  // 7. ROUTE LOCATIONS IN CURRENT DRAFT ORDER
  // ==========================================================

  function getMapLocations(snapshot) {
    const locations = Array.isArray(
      snapshot?.preview?.locations
    )
      ? snapshot.preview.locations
      : [];

    const orderIds = Array.isArray(
      snapshot?.draft?.stop_order_ids
    )
      ? snapshot.draft.stop_order_ids.map(String)
      : [];

    const positions = new Map(
      orderIds.map((id, index) => [
        id,
        index
      ])
    );

    function firstPosition(location) {
      let first = Infinity;

      for (const id of location.order_ids || []) {
        const position = positions.get(
          String(id)
        );

        if (
          position !== undefined &&
          position < first
        ) {
          first = position;
        }
      }

      return first;
    }

    return [...locations].sort(
      (a, b) =>
        firstPosition(a) - firstPosition(b)
    );
  }

  function hasCurrentPreview(snapshot) {
    return Boolean(
      snapshot?.preview &&
      snapshot.status === "ready" &&
      snapshot.previewRevision === snapshot.revision
    );
  }

  function canEditStopOrder(snapshot) {
    return Boolean(
      snapshot?.isOpen &&
      snapshot.draft &&
      snapshot.preview &&
      snapshot.capabilities?.stopOrder === true &&
      ["ready", "stale"].includes(snapshot.status)
    );
  }

  // ==========================================================
  // 8. GROUP LOCATIONS AT THE SAME COORDINATES
  // ==========================================================

  function groupMapLocations(locations) {
    const groups = new Map();

    locations.forEach((location, index) => {
      const point = readPoint(
        location.latitude,
        location.longitude
      );

      if (!point) {
        throw new Error(
          `Delivery location ${index + 1} has invalid coordinates.`
        );
      }

      const key = coordinateKey(point);

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          point,
          entries: []
        });
      }

      groups.get(key).entries.push({
        locationKey: String(location.location_key),
        number: index + 1,
        index,
        location,
        point
      });
    });

    return [...groups.values()].map(group => {
      const numbers = group.entries.map(
        entry => entry.number
      );

      return {
        ...group,
        label: numbers.join("+"),
        combined: group.entries.length > 1
      };
    });
  }

  // ==========================================================
  // 9. ROUTE POINTS AND DISTANCE
  // ==========================================================

  function getRoutePoints(depot, locations) {
    const points = locations.map(
      (location, index) => {
        const point = readPoint(
          location.latitude,
          location.longitude
        );

        if (!point) {
          throw new Error(
            `Delivery location ${index + 1} has invalid coordinates.`
          );
        }

        return point;
      }
    );

    return [
      depot.point,
      ...points,
      depot.point
    ];
  }

  function getRoutePointKey(points) {
    return JSON.stringify(
      points.map(coordinateKey)
    );
  }

  function getPreviewDistanceMiles(snapshot) {
    const after = snapshot?.preview?.after;

    if (!after) {
      return null;
    }

    if (
      after.distance_miles != null &&
      Number.isFinite(Number(after.distance_miles))
    ) {
      return Number(after.distance_miles);
    }

    if (
      after.distance_km != null &&
      Number.isFinite(Number(after.distance_km))
    ) {
      return Number(after.distance_km) * 0.621371;
    }

    return null;
  }

  // ==========================================================
  // 10. OSRM ROAD GEOMETRY
  // ==========================================================

  async function fetchRoadGeometry(points, signal) {
    if (
      !Array.isArray(points) ||
      points.length < 2
    ) {
      throw new Error(
        "At least two route points are required."
      );
    }

    const coordinates = points.map(point => {
      const checked = readPoint(
        point?.[0],
        point?.[1]
      );

      if (!checked) {
        throw new Error(
          "Invalid route coordinates."
        );
      }

      return `${checked[1]},${checked[0]}`;
    }).join(";");

    const url =
      `${MAP_CONFIG.osrmBaseUrl}/route/v1/driving/` +
      coordinates +
      "?overview=full&geometries=geojson&steps=false";

    const response = await fetch(
      url,
      { signal }
    );

    if (!response.ok) {
      throw new Error(
        `OSRM request failed: ${response.status}`
      );
    }

    const result = await response.json();

    const geometry = result.routes?.[0]?.geometry;

    if (
      result.code !== "Ok" ||
      geometry?.type !== "LineString" ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length < 2
    ) {
      throw new Error(
        "No valid road geometry was returned."
      );
    }

    return geometry.coordinates.map(coordinate => {
      const point = readPoint(
        coordinate?.[1],
        coordinate?.[0]
      );

      if (!point) {
        throw new Error(
          "OSRM returned invalid coordinates."
        );
      }

      return point;
    });
  }

  // ==========================================================
  // END OF PART 1 OF 5
  //
  // Paste PART 2 immediately below this section.
  // Do not close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // PART 2 OF 5
  // 11. MAP DISPLAY CONTROLS
  // ==========================================================

  function createDisplayToggle(key, labelText, checked = true) {
    const label = element("label", "rw-map-toggle");
    const input = element("input");

    input.type = "checkbox";
    input.checked = checked;
    input.dataset.rwMapField = key;

    label.append(
      input,
      element("span", "", labelText)
    );

    return {
      root: label,
      input
    };
  }


function createMapButton(key, label, primary = false) {
  const button = element(
    "button",
    primary
      ? "rw-button rw-button-primary rw-map-action-button"
      : "rw-button rw-map-action-button"
  );

  button.type = "button";
  button.dataset.rwMapAction = key;
  button.setAttribute("aria-label", label);
  button.title = label;

  const icons = {
    fit: `
      <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
      <path d="M16 3h3a2 2 0 0 1 2 2v3"/>
      <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
      <path d="M21 16v3a2 2 0 0 1-2 2h-3"/>
      <circle cx="12" cy="12" r="3"/>
    `,
    expand: `
      <path d="M8 3H3v5"/>
      <path d="M16 3h5v5"/>
      <path d="M3 16v5h5"/>
      <path d="M21 16v5h-5"/>
    `,
    undo: `
      <path d="M9 14 4 9l5-5"/>
      <path d="M4 9h10a6 6 0 0 1 0 12h-2"/>
    `,
    redo: `
      <path d="m15 14 5-5-5-5"/>
      <path d="M20 9H10a6 6 0 0 0 0 12h2"/>
    `,
    optimize: `
      <circle cx="6" cy="17" r="2"/>
      <circle cx="18" cy="6" r="2"/>
      <path d="M8 17h5a4 4 0 0 0 4-4V8"/>
      <path d="M6 15V8a4 4 0 0 1 4-4h3"/>
    `,
    "apply-suggestion": `
      <path d="m5 12 4 4L19 6"/>
    `
  };

  const icon = element(
    "span",
    "rw-map-button-icon"
  );

  icon.setAttribute("aria-hidden", "true");

  icon.innerHTML = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      ${icons[key] || ""}
    </svg>
  `;

  const text = element(
    "span",
    "rw-map-button-label",
    label
  );

  button.append(icon, text);

  return button;
}


  // ==========================================================
  // 12. MAP INTERFACE
  // ==========================================================


function createMapShell() {
  const root = element(
    "div",
    "rw-map-module rw-map-module-v3"
  );

  const toolbar = element(
    "div",
    "rw-map-toolbar"
  );

  const controls = element(
    "div",
    "rw-map-toolbar-controls"
  );

  const actions = element(
    "div",
    "rw-map-toolbar-actions"
  );

  // ========================================================
  // MAP LAYER SELECTOR
  // ========================================================

  const layerGroup = element(
    "div",
    "rw-map-control-group rw-map-layer-group"
  );

  const layerLabel = element(
    "span",
    "rw-map-control-label",
    "Map style"
  );

  const layerSelect = element(
    "select",
    "rw-input rw-map-layer-select"
  );

  layerSelect.dataset.rwMapField = "layer";
  layerSelect.setAttribute(
    "aria-label",
    "Select map layer"
  );

  for (const [key, config] of Object.entries(
    MAP_CONFIG.tiles
  )) {
    const option = element(
      "option",
      "",
      config.label
    );

    option.value = key;
    layerSelect.appendChild(option);
  }

  layerSelect.value = MAP_CONFIG.defaultTile;

  layerGroup.append(
    layerLabel,
    layerSelect
  );

  // ========================================================
  // MAP DISPLAY OPTIONS
  // ========================================================

  const displayGroup = element(
    "div",
    "rw-map-control-group rw-map-display-group"
  );

  const displayLabel = element(
    "span",
    "rw-map-control-label",
    "Map elements"
  );

  const toggleRow = element(
    "div",
    "rw-map-toggle-row"
  );

  const markersToggle = createDisplayToggle(
    "markers",
    "Markers"
  );

  const lineToggle = createDisplayToggle(
    "line",
    "Route line"
  );

  const suggestionsToggle = createDisplayToggle(
    "suggestions",
    "Suggestions",
    false
  );

  toggleRow.append(
    markersToggle.root,
    lineToggle.root,
    suggestionsToggle.root
  );

  displayGroup.append(
    displayLabel,
    toggleRow
  );

  controls.append(
    layerGroup,
    displayGroup
  );

  // ========================================================
  // ROUTE ACTIONS
  // ========================================================

  const fitButton = createMapButton(
    "fit",
    "Fit Route"
  );

  const expandButton = createMapButton(
    "expand",
    "Expand Map"
  );

  const undoButton = createMapButton(
    "undo",
    "Undo"
  );

  const redoButton = createMapButton(
    "redo",
    "Redo"
  );

  const optimizeButton = createMapButton(
    "optimize",
    "Find Better Route",
    true
  );

  const applySuggestionButton = createMapButton(
    "apply-suggestion",
    "Apply Suggested Route",
    true
  );

  fitButton.disabled = true;
  undoButton.disabled = true;
  redoButton.disabled = true;
  optimizeButton.disabled = true;

  applySuggestionButton.disabled = true;
  applySuggestionButton.hidden = true;

  actions.append(
    fitButton,
    expandButton,
    undoButton,
    redoButton,
    optimizeButton,
    applySuggestionButton
  );

  toolbar.append(
    controls,
    actions
  );

  // ========================================================
  // MAP STATUS AND ERRORS
  // ========================================================

  const status = element(
    "p",
    "rw-map-status",
    "Waiting for route data…"
  );

  status.setAttribute(
    "aria-live",
    "polite"
  );

  const error = element(
    "p",
    "rw-error"
  );

  error.setAttribute(
    "role",
    "alert"
  );

  error.hidden = true;

  // ========================================================
  // MAP CANVAS
  // ========================================================

  const mapWrapper = element(
    "div",
    "rw-map-wrapper"
  );

  const canvas = element(
    "div",
    "rw-map-canvas"
  );

  canvas.setAttribute(
    "aria-label",
    "Interactive route planning map"
  );

  canvas.style.width = "100%";
  canvas.style.height = "440px";
  canvas.style.minHeight = "320px";

  mapWrapper.appendChild(canvas);

  // ========================================================
  // MAP LEGEND
  // ========================================================

  const legend = element(
    "div",
    "rw-map-legend"
  );

  const depotLegend = element(
    "span",
    "rw-map-legend-depot",
    "● Depot"
  );

  const stopLegend = element(
    "span",
    "rw-map-legend-stop",
    "● Delivery stop"
  );

  const combinedLegend = element(
    "span",
    "rw-map-legend-combined",
    "● Combined stops"
  );

  const suggestionLegend = element(
    "span",
    "rw-map-legend-suggestion",
    "● Suggested route"
  );

  legend.append(
    depotLegend,
    stopLegend,
    combinedLegend,
    suggestionLegend
  );

  // ========================================================
  // HELP TEXT
  // ========================================================

  const help = element(
    "p",
    "rw-field-help rw-map-help",
    "Drag a delivery marker near another stop to " +
    "change the route order. Delivery addresses and " +
    "coordinates remain unchanged."
  );

  root.append(
    toolbar,
    status,
    error,
    mapWrapper,
    legend,
    help
  );

  return {
    root,
    toolbar,
    controls,
    actions,

    layerSelect,
    markersToggle: markersToggle.input,
    lineToggle: lineToggle.input,
    suggestionsToggle: suggestionsToggle.input,

    fitButton,
    expandButton,
    undoButton,
    redoButton,
    optimizeButton,
    applySuggestionButton,

    status,
    error,
    mapWrapper,
    canvas,
    legend,
    help
  };
}

  // ==========================================================
  // 13. DYNAMIC MARKER ICONS
  // ==========================================================

  function createMarkerIcon(label, options = {}) {
    const text = String(label);

    const depot = options.depot === true;
    const combined =
      !depot &&
      (options.combined === true || text.includes("+"));

    const height = MAP_CONFIG.markerHeight;

    const width = depot
      ? MAP_CONFIG.markerSize
      : combined
        ? Math.max(50, text.length * 10 + 18)
        : MAP_CONFIG.markerSize;

    const background = depot
      ? "#123052"
      : options.selected
        ? "#f59e0b"
        : options.suggestion
          ? "#64748b"
          : "#0866ff";

    const node = element(
      "span",
      depot
        ? "rw-map-marker rw-map-marker-depot"
        : combined
          ? "rw-map-marker rw-map-marker-combined"
          : "rw-map-marker",
      text
    );

    node.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:center",
      `width:${width}px`,
      `height:${height}px`,
      "border-radius:20px",
      "border:2px solid white",
      "color:white",
      `background:${background}`,
      "font-size:12px",
      "font-weight:800",
      "white-space:nowrap",
      "box-sizing:border-box",
      "box-shadow:0 2px 8px rgba(0,0,0,.25)",
      "user-select:none",
      "pointer-events:auto"
    ].join(";");

    return window.L.divIcon({
      className: "rw-map-marker-icon",
      html: node,
      iconSize: [width, height],
      iconAnchor: [width / 2, height / 2],
      popupAnchor: [0, -height / 2]
    });
  }

  // ==========================================================
  // 14. SAFE MARKER POPUPS
  // ==========================================================

  function createLocationPopup(location, number) {
    const root = element(
      "div",
      "rw-map-popup-location"
    );

    const title = String(
      location.postcode ||
      location.name ||
      location.city ||
      "Delivery location"
    );

    root.appendChild(
      element(
        "strong",
        "rw-map-popup-title",
        `${number}. ${title}`
      )
    );

    const city = String(
      location.city || location.name || ""
    );

    if (city) {
      root.appendChild(
        element("p", "", city)
      );
    }

    const orders = Array.isArray(location.order_ids)
      ? location.order_ids
      : [];

    root.appendChild(
      element(
        "p",
        "",
        [
          `${orders.length} ${orders.length === 1 ? "order" : "orders"}`,
          `${formatNumber(location.volume_m3)} m³`,
          `${formatNumber(location.colli, 0)} colli`
        ].join(" · ")
      )
    );

    root.appendChild(
      element(
        "p",
        "",
        `Unloading: ${formatMinutes(location.service_minutes)}`
      )
    );

    if (orders.length) {
      const details = element("details");

      const summary = element(
        "summary",
        "",
        `Orders (${orders.length})`
      );

      const list = element("ul");

      for (const id of orders) {
        list.appendChild(
          element("li", "", String(id))
        );
      }

      details.append(summary, list);
      root.appendChild(details);
    }

    return root;
  }

  function createDepotPopup(depot) {
    const root = element(
      "div",
      "rw-map-popup"
    );

    root.append(
      element(
        "strong",
        "rw-map-popup-title",
        depot.name
      ),
      element(
        "p",
        "",
        "Route departure and return location."
      )
    );

    return root;
  }

  // ==========================================================
  // 15. MOUNT MAP MODULE
  // ==========================================================

  function mountMap(context) {
    const {
      root: workspaceRoot,
      getState
    } = context;

    if (
      !workspaceRoot ||
      typeof workspaceRoot.querySelector !== "function" ||
      typeof getState !== "function"
    ) {
      throw new Error(
        "Invalid Route Workspace map context."
      );
    }

    const slot = workspaceRoot.querySelector(
      '[data-rw-slot="map"]'
    );

    if (!slot) {
      throw new Error(
        "Route Workspace map container is missing."
      );
    }

    const shell = createMapShell();

    const originalChildren = Array.from(
      slot.childNodes
    );

    const events = new AbortController();

    const listenerOptions = {
      signal: events.signal
    };

    // --------------------------------------------------------
    // Internal state
    // --------------------------------------------------------

    let destroyed = false;

    let map = null;

let markerLayer = null;
let lineLayer = null;
let suggestionLayer = null;


// UK emission zones
let emissionZoneLayer = null;
let emissionZonesLoaded = false;
let emissionZonesPromise = null;

// Tenant-specific emission zone visibility
let emissionZonesVisible = false;
let emissionSettingsLoaded = false;
let emissionSettingsPromise = null;
let emissionSettingsCompanyId = null;


    let activeTileLayer = null;
    let activeTileKey = null;

    let resizeObserver = null;
    let frame = null;
    let renderTicket = 0;

    let depotPromise = null;
    let depotCompanyId = null;

    let geometryController = null;
    let geometryTimer = null;

    const geometryCache = new Map();

let lastPointKey = null;
let currentGeographicKey = null;
let routeBounds = null;

    let currentDepot = null;
    let currentLocations = [];
    let currentGroups = [];

    let selectedLocationKey = null;
let focusMoveEndHandler = null;

    let expanded = false;
    let originalMapStyle = null;

    const undoStack = [];
    const redoStack = [];

    let historyRouteId = null;
    let historyCompanyId = null;
    let lastKnownOrderIds = null;
    let pendingHistoryOrderIds = null;

    let pendingSuggestion = null;

    // ========================================================
    // 16. STATUS AND ERROR HANDLING
    // ========================================================

    function setStatus(message) {
      if (destroyed) return;

      setText(shell.status, message);
    }

    function clearError() {
      shell.error.textContent = "";
      shell.error.hidden = true;
    }

    function showError(error) {
      if (
        destroyed ||
        !shell.root.isConnected
      ) {
        return;
      }

      shell.error.textContent =
        error?.message ||
        String(error || "The route map could not be displayed.");

      shell.error.hidden = false;
    }

    function isCurrent(ticket) {
      return (
        !destroyed &&
        ticket === renderTicket
      );
    }

    // ========================================================
    // 17. GEOMETRY REQUEST MANAGEMENT
    // ========================================================

    function cancelGeometry() {
      if (geometryController) {
        geometryController.abort();
        geometryController = null;
      }

      if (geometryTimer !== null) {
        clearTimeout(geometryTimer);
        geometryTimer = null;
      }
    }

    function cacheGeometry(key, geometry) {
      if (geometryCache.has(key)) {
        geometryCache.delete(key);
      }

      geometryCache.set(key, geometry);

      while (
        geometryCache.size > MAP_CONFIG.geometryCacheLimit
      ) {
        const oldestKey =
          geometryCache.keys().next().value;

        geometryCache.delete(oldestKey);
      }
    }

    function getCachedGeometry(key) {
      if (!geometryCache.has(key)) {
        return null;
      }

      const geometry = geometryCache.get(key);

      geometryCache.delete(key);
      geometryCache.set(key, geometry);

      return geometry;
    }

    // ========================================================
    // 18. MAP LAYERS
    // ========================================================

    function setTileLayer(key) {
      if (!map) return;

      const config = MAP_CONFIG.tiles[key];

      if (!config) {
        throw new Error(
          `Unknown map layer: ${key}`
        );
      }

      if (
        activeTileKey === key &&
        activeTileLayer
      ) {
        return;
      }

      const nextLayer = window.L.tileLayer(
        config.url,
        {
          maxZoom: config.maxZoom,
          attribution: config.attribution
        }
      );

      nextLayer.addTo(map);
      nextLayer.bringToBack();

      if (activeTileLayer) {
        map.removeLayer(activeTileLayer);
      }

      activeTileLayer = nextLayer;
      activeTileKey = key;
    }



async function loadEmissionMapSettings(companyId) {
  if (destroyed || !map) return false;

  assertCompany(companyId);

  if (
    emissionSettingsLoaded &&
    emissionSettingsCompanyId === companyId
  ) {
    return emissionZonesVisible;
  }

  if (
    emissionSettingsPromise &&
    emissionSettingsCompanyId === companyId
  ) {
    return emissionSettingsPromise;
  }

  emissionSettingsCompanyId = companyId;
  emissionSettingsLoaded = false;
  emissionZonesVisible = false;

  applyLayerVisibility();

  const request = (async () => {
    if (typeof sb !== "function") {
      throw new Error("Supabase is unavailable.");
    }

    const { data, error } = await sb()
      .from("settings")
      .select("setting_value")
      .eq("company_id", companyId)
      .eq("setting_key", "emission_display_map")
      .maybeSingle();

    if (error) throw error;

    if (destroyed || !map) return false;

    assertCompany(companyId);

    const value = String(
      data?.setting_value ?? "true"
    ).trim().toLowerCase();

    emissionZonesVisible = [
      "true",
      "1",
      "yes",
      "on"
    ].includes(value);

    emissionSettingsLoaded = true;

    applyLayerVisibility();

    console.info(
      "[RouteWorkspace] Emission map visibility:",
      emissionZonesVisible
    );

    return emissionZonesVisible;
  })();

  emissionSettingsPromise = request;

  try {
    return await request;
  } catch (error) {
    emissionZonesVisible = false;
    emissionSettingsLoaded = false;
    applyLayerVisibility();
    throw error;
  } finally {
    if (emissionSettingsPromise === request) {
      emissionSettingsPromise = null;
    }
  }
}


async function loadEmissionZones(companyId) {
  if (!map || !emissionZoneLayer || destroyed) return;

  if (emissionZonesLoaded) return;

  if (emissionZonesPromise) {
    return emissionZonesPromise;
  }

  emissionZonesPromise = (async () => {
    if (typeof sb !== "function") {
      throw new Error("Supabase is unavailable.");
    }

    const { data, error } = await sb().rpc(
      "get_emission_zones_geojson"
    );

    if (error) throw error;

    if (destroyed || !map) return;

    assertCompany(companyId);

    const geojson = typeof data === "string"
      ? JSON.parse(data)
      : data;

    if (
      geojson?.type !== "FeatureCollection" ||
      !Array.isArray(geojson.features)
    ) {
      throw new Error("Invalid emission zone GeoJSON.");
    }

    emissionZoneLayer.clearLayers();
    emissionZoneLayer.addData(geojson);

    emissionZonesLoaded = true;

    console.info(
      "[RouteWorkspace] Emission zones loaded:",
      geojson.features.length
    );
  })();

  try {
    await emissionZonesPromise;
  } finally {
    emissionZonesPromise = null;
  }
}


    function applyLayerVisibility() {
      if (!map) return;



const layers = [
  [markerLayer, shell.markersToggle.checked],
  [lineLayer, shell.lineToggle.checked],
  [suggestionLayer, shell.suggestionsToggle.checked],
  [emissionZoneLayer, emissionZonesVisible]
];



      for (const [layer, visible] of layers) {
        if (!layer) continue;

        if (visible && !map.hasLayer(layer)) {
          layer.addTo(map);
        } else if (!visible && map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      }
    }


function getRouteBounds() {
  if (!map || !currentDepot) {
    return null;
  }

  const points = [currentDepot.point];

  for (const location of currentLocations) {
    const point = readPoint(
      location.latitude,
      location.longitude
    );

    if (point) {
      points.push(point);
    }
  }

  if (!points.length) {
    return null;
  }

  const bounds = window.L.latLngBounds(points);

  return bounds.isValid() ? bounds : null;
}


    // ========================================================
    // 19. FIT ROUTE
    // ========================================================


function fitRoute() {
  if (!map) return;

  const bounds = getRouteBounds();

  if (!bounds) return;

  routeBounds = bounds;

  map.invalidateSize({
    animate: false
  });

  const count = currentLocations.length;

  const padding = count <= 5
    ? [20, 20]
    : count <= 15
      ? [30, 30]
      : [40, 40];

  map.fitBounds(bounds, {
    padding,
    maxZoom: MAP_CONFIG.maxFitZoom,
    animate: false
  });
}

    // ========================================================
    // 20. INITIALIZE LEAFLET
    // ========================================================

    function ensureMap() {
      if (map) return;

      const L = window.L;

      if (
        typeof L?.map !== "function" ||
        typeof L?.tileLayer !== "function" ||
        typeof L?.marker !== "function"
      ) {
        throw new Error(
          "Leaflet must be loaded before the route map."
        );
      }

      map = L.map(
        shell.canvas,
        {
          zoomControl: true,
          attributionControl: true,
          zoomSnap: 0.5,
          zoomDelta: 0.5
        }
      );

      map.setView([0, 0], 2);


markerLayer = L.layerGroup();
lineLayer = L.layerGroup();
suggestionLayer = L.layerGroup();

// Separate emission zone layer
emissionZoneLayer = L.geoJSON(null, {
  interactive: true,
  style: feature => {
    const properties = feature?.properties || {};

    const code = String(
      properties.zone_code || ""
    ).toUpperCase();

    const type = String(
      properties.zone_type || ""
    ).toUpperCase();

    let color = "#16a34a";

    if (code === "LONDON_CONGESTION") {
      color = "#dc2626";
    } else if (code === "LONDON_ULEZ") {
      color = "#2563eb";
    } else if (code === "LONDON_LEZ") {
      color = "#7c3aed";
    } else if (type === "ZEZ" || code.endsWith("_ZEZ")) {
      color = "#0891b2";
    }

    return {
      color,
      weight: 2,
      opacity: 0.85,
      fillColor: color,
      fillOpacity: 0.12
    };
  },

  onEachFeature: (feature, layer) => {
    const properties = feature?.properties || {};

    const name = String(
      properties.zone_name ||
      properties.zone_code ||
      "Emission Zone"
    );

    const code = String(
      properties.zone_code || ""
    );

    const popup = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = name;

    const description = document.createElement("p");
    description.textContent = code;

    popup.append(title, description);

    layer.bindPopup(popup);
  }
});


      setTileLayer(
        shell.layerSelect.value ||
        MAP_CONFIG.defaultTile
      );

      applyLayerVisibility();

      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(() => {
          if (
            destroyed ||
            !map ||
            !shell.canvas.getClientRects().length
          ) {
            return;
          }

          map.invalidateSize({
            animate: false
          });
        });

        resizeObserver.observe(shell.canvas);
      }
    }

    // ========================================================
    // END OF PART 2 OF 5
    //
    // Paste PART 3 directly below this section.
    // mountMap() remains open.
    // Do not add closing braces or })();
    // ========================================================

    // ========================================================
    // PART 3 OF 5
    // 21. CURRENT DRAFT ORDER
    // ========================================================

    function getCurrentOrderIds() {
      const state = getState();

      return Array.isArray(state.draft?.stop_order_ids)
        ? state.draft.stop_order_ids.map(String)
        : [];
    }

    function sameOrder(first, second) {
      return (
        first.length === second.length &&
        first.every((id, index) => id === second[index])
      );
    }

    function validateOrderIds(nextIds, currentIds) {
      if (
        !Array.isArray(nextIds) ||
        nextIds.length !== currentIds.length
      ) {
        throw new Error("Route order count mismatch.");
      }

      const expected = [...currentIds].sort();
      const actual = [...nextIds].sort();

      if (!sameOrder(expected, actual)) {
        throw new Error(
          "Route contains missing or duplicate order IDs."
        );
      }

      return true;
    }

    function buildOrderIds(locations, currentIds) {
      const positions = new Map(
        currentIds.map((id, index) => [id, index])
      );

      return locations.flatMap(location =>
        (location.order_ids || [])
          .map(String)
          .sort((a, b) =>
            (positions.get(a) ?? Infinity) -
            (positions.get(b) ?? Infinity)
          )
      );
    }

    // ========================================================
    // 22. CALCULATE NEW STOP ORDER
    // ========================================================

    function calculateMovedOrder(
      sourceKey,
      targetKey,
      insertAfter = false
    ) {
      const state = getState();

      if (!canEditStopOrder(state)) {
        throw new Error(
          "Stop order cannot be changed right now."
        );
      }

      const locations = getMapLocations(state);

      const sourceIndex = locations.findIndex(
        location =>
          String(location.location_key) === String(sourceKey)
      );

      if (sourceIndex < 0) {
        throw new Error(
          "Source delivery location not found."
        );
      }

      if (String(sourceKey) === String(targetKey)) {
        return null;
      }

      const [moved] = locations.splice(sourceIndex, 1);

      const targetIndex = locations.findIndex(
        location =>
          String(location.location_key) === String(targetKey)
      );

      if (targetIndex < 0) {
        throw new Error(
          "Target delivery location not found."
        );
      }

      locations.splice(
        targetIndex + (insertAfter ? 1 : 0),
        0,
        moved
      );

      const currentIds = getCurrentOrderIds();

      const nextIds = buildOrderIds(
        locations,
        currentIds
      );

      validateOrderIds(nextIds, currentIds);

      return sameOrder(nextIds, currentIds)
        ? null
        : nextIds;
    }

    // ========================================================
    // 23. APPLY ORDER THROUGH WORKSPACE CONTROLLER
    // ========================================================

    function applyStopOrder(nextIds, options = {}) {
      const state = getState();

      if (!canEditStopOrder(state)) {
        throw new Error(
          "Route order cannot be changed."
        );
      }

      const currentIds = getCurrentOrderIds();
      const normalizedIds = nextIds.map(String);

      validateOrderIds(normalizedIds, currentIds);

      if (sameOrder(normalizedIds, currentIds)) {
        return false;
      }

      const recordHistory = options.recordHistory !== false;

      if (recordHistory) {
        undoStack.push([...currentIds]);

        while (undoStack.length > MAP_CONFIG.maxHistory) {
          undoStack.shift();
        }

        redoStack.length = 0;
      }

      // Deel 4 verwerkt de lokale Undo/Redo-geschiedenis.
      pendingHistoryOrderIds = [...normalizedIds];

      try {
        workspace.setStopOrder(normalizedIds);

        lastKnownOrderIds = [...normalizedIds];
        pendingHistoryOrderIds = null;

        if (typeof updateHistoryButtons === "function") {
          updateHistoryButtons();
        }

        setStatus(
          "Stop order updated. Recalculate to update " +
          "distance, driving time and costs."
        );

        return true;

      } catch (error) {
        pendingHistoryOrderIds = null;

        if (recordHistory) {
          undoStack.pop();
        }

        lastKnownOrderIds = [...currentIds];

        throw error;
      }
    }

    function moveMapLocation(
      sourceKey,
      targetKey,
      dragState,
      insertAfter = false
    ) {
      const state = getState();

      if (
        !canEditStopOrder(state) ||
        state.revision !== dragState.revision ||
        String(state.route?.id ?? "") !== dragState.routeId
      ) {
        setStatus(
          "The route changed while dragging. Try again."
        );
        return false;
      }

      try {
        const nextIds = calculateMovedOrder(
          sourceKey,
          targetKey,
          insertAfter
        );

        if (!nextIds) return false;

        return applyStopOrder(nextIds);

      } catch (error) {
        showError(error);
        return false;
      }
    }

    // ========================================================
    // 24. SELECT STOP IN DELIVERY STOPS
    // ========================================================

    function highlightStopInList(locationKey) {
      const container = workspaceRoot.querySelector(
        '[data-rw-overview="stops"]'
      );

      if (!container) return;

      for (const row of container.querySelectorAll(
        "[data-rw-location-key]"
      )) {
        const selected =
          String(row.dataset.rwLocationKey) ===
          String(locationKey);

        row.classList.toggle(
          "rw-map-selected-stop",
          selected
        );

        if (selected) {
          row.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
          });
        }
      }
    }


function selectMapLocation(locationKey) {
  if (
    locationKey === null ||
    locationKey === undefined
  ) {
    selectedLocationKey = null;
  } else {
    selectedLocationKey = String(locationKey);
  }

  // --------------------------------------------------------
  // DELIVERY STOPS HIGHLIGHT
  // --------------------------------------------------------

  const container = workspaceRoot.querySelector(
    '[data-rw-overview="stops"]'
  );

  if (container) {
    for (const row of container.querySelectorAll(
      "[data-rw-location-key]"
    )) {
      const selected =
        selectedLocationKey !== null &&
        String(row.dataset.rwLocationKey) ===
          selectedLocationKey;

      row.classList.toggle(
        "rw-map-selected-stop",
        selected
      );
    }

    const selectedRow = [...container.querySelectorAll(
      "[data-rw-location-key]"
    )].find(row =>
      String(row.dataset.rwLocationKey) ===
      selectedLocationKey
    );

    selectedRow?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }

  // --------------------------------------------------------
  // MAP MARKER HIGHLIGHT
  // --------------------------------------------------------

  for (const group of currentGroups) {
    const selected = group.entries.some(
      entry =>
        entry.locationKey === selectedLocationKey
    );

    if (!group.marker) continue;

    group.marker.setIcon(
      createMarkerIcon(
        group.label,
        {
          combined: group.combined,
          selected
        }
      )
    );

    if (selected) {
      group.marker.setZIndexOffset(1000);
    } else {
      group.marker.setZIndexOffset(0);
    }
  }
}



function focusMapLocation(locationKey) {
  if (!map || destroyed) return;

  const key = String(locationKey);

  const group = currentGroups.find(group =>
    group.entries.some(
      entry => entry.locationKey === key
    )
  );

  if (!group) {
    setStatus(
      "The selected delivery location is not available on the map."
    );
    return;
  }

  // Selecteer de juiste stop in de kaart en Delivery Stops.
  selectMapLocation(key);

  // Voorkom dat een eerdere animatie nog doorloopt.
  map.stop();

  // Verwijder uitsluitend onze vorige focus-callback.
  // Andere Leaflet moveend-listeners blijven behouden.
  if (focusMoveEndHandler) {
    map.off("moveend", focusMoveEndHandler);
    focusMoveEndHandler = null;
  }

  const targetZoom = Math.max(
    map.getZoom(),
    Math.min(12, map.getMaxZoom())
  );

  const selectedMarker = group.marker;

  focusMoveEndHandler = () => {
    focusMoveEndHandler = null;

    if (
      destroyed ||
      selectedLocationKey !== key ||
      !selectedMarker ||
      !markerLayer ||
      !markerLayer.hasLayer(selectedMarker)
    ) {
      return;
    }

    selectedMarker.openPopup();
  };

  map.once("moveend", focusMoveEndHandler);

  map.flyTo(group.point, targetZoom, {
    animate: true,
    duration: 0.5
  });

  setStatus(
    `Selected delivery stop ${
      group.entries.find(
        entry => entry.locationKey === key
      )?.number ?? ""
    }.`
  );
}


    // ========================================================
    // 25. GROUP POPUP WITH INDIVIDUAL STOP SELECTION
    // ========================================================

    function createGroupPopup(group) {
      const root = element(
        "div",
        "rw-map-popup rw-map-group-popup"
      );

      root.appendChild(
        element(
          "strong",
          "rw-map-popup-title",
          group.combined
            ? `Stops ${group.label}`
            : `Stop ${group.label}`
        )
      );

      if (group.combined) {
        root.appendChild(
          element(
            "p",
            "",
            `${group.entries.length} delivery stops ` +
            "share these coordinates."
          )
        );
      }

      for (const entry of group.entries) {
        const section = element(
          "div",
          "rw-map-popup-section"
        );

        section.appendChild(
          createLocationPopup(
            entry.location,
            entry.number
          )
        );

        const button = element(
          "button",
          "rw-button rw-map-select-stop",
          `Select stop ${entry.number}`
        );

        button.type = "button";

        button.addEventListener("click", event => {
          event.preventDefault();

          selectMapLocation(entry.locationKey);

          group.marker?.closePopup();

          setStatus(
            `Stop ${entry.number} selected. ` +
            "You can now drag this marker."
          );
        });

        section.appendChild(button);
        root.appendChild(section);
      }

      return root;
    }

    // ========================================================
    // 26. DETERMINE WHICH STOP IS BEING MOVED
    // ========================================================

    function chooseSourceEntry(group) {
      if (!group?.entries?.length) {
        return null;
      }

      if (group.entries.length === 1) {
        return group.entries[0];
      }

      const selected = group.entries.find(
        entry =>
          entry.locationKey === selectedLocationKey
      );

      if (selected) {
        return selected;
      }

      setStatus(
        `Stops ${group.label} share a location. ` +
        "Click the marker and select a stop before dragging."
      );

      group.marker?.openPopup();

      return null;
    }

    // ========================================================
    // 27. FIND DROP TARGET
    // ========================================================

    function findDropTarget(latlng, sourceKey) {
      if (!map) return null;

      const dropPoint = map.latLngToLayerPoint(latlng);

      let nearestGroup = null;
      let nearestDistance = Infinity;

      for (const group of currentGroups) {
        const candidates = group.entries.filter(
          entry =>
            entry.locationKey !== sourceKey
        );

        if (!candidates.length) continue;

        const point = map.latLngToLayerPoint(
          window.L.latLng(group.point)
        );

        const distance = dropPoint.distanceTo(point);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestGroup = group;
        }
      }

      if (
        !nearestGroup ||
        nearestDistance > MAP_CONFIG.dropRadiusPixels
      ) {
        return null;
      }

      const candidates = nearestGroup.entries.filter(
        entry =>
          entry.locationKey !== sourceKey
      );

      if (candidates.length === 1) {
        return candidates[0];
      }

      const selected = candidates.find(
        entry =>
          entry.locationKey === selectedLocationKey
      );

      if (selected) {
        return selected;
      }

      setStatus(
        `Target ${nearestGroup.label} contains multiple stops. ` +
        "Select the target stop first."
      );

      return null;
    }

    // ========================================================
    // 28. DRAW LEAFLET MARKERS
    // ========================================================



function drawMarkers(depot, locations) {
  if (!map || !markerLayer) return;

  const L = window.L;
  const editable = canEditStopOrder(getState());

  markerLayer.clearLayers();

  // ========================================================
  // 1. DEPOT MARKER
  // ========================================================

  const depotMarker = L.marker(depot.point, {
    icon: createMarkerIcon("D", {
      depot: true
    }),
    title: depot.name,
    draggable: false,
    keyboard: true
  });

  depotMarker.bindPopup(createDepotPopup(depot));
  markerLayer.addLayer(depotMarker);

  // ========================================================
  // 2. GROUP DELIVERY LOCATIONS
  // ========================================================

  currentGroups = groupMapLocations(locations);

  for (const group of currentGroups) {
    const selected = group.entries.some(
      entry => entry.locationKey === selectedLocationKey
    );

    const marker = L.marker(group.point, {
      icon: createMarkerIcon(group.label, {
        combined: group.combined,
        selected
      }),
      title: `Delivery stops ${group.label}`,
      draggable: editable,
      keyboard: true,
      autoPan: true,
      autoPanPadding: L.point(45, 45),
      riseOnHover: true
    });

    group.marker = marker;

    if (selected) {
      marker.setZIndexOffset(1000);
    }

    marker.bindPopup(createGroupPopup(group), {
      maxWidth: 360,
      autoPan: true,
      keepInView: true
    });

    let dragState = null;
    let dragTarget = null;

    // ======================================================
    // 3. MARKER SELECTION
    // ======================================================

    marker.on("click", () => {
      if (group.entries.length === 1) {
        selectMapLocation(
          group.entries[0].locationKey
        );
      } else {
        const selectedEntry = group.entries.find(
          entry => entry.locationKey === selectedLocationKey
        );

        if (!selectedEntry) {
          setStatus(
            `Stops ${group.label} share this location. ` +
            "Select the stop you want to move."
          );
        }
      }
    });

    // ======================================================
    // 4. DRAG START
    // ======================================================

    marker.on("dragstart", () => {
      const state = getState();

      dragTarget = null;
      dragState = null;

      if (!canEditStopOrder(state)) {
        setStatus(
          "Route editing is currently unavailable."
        );
        return;
      }

      const source = chooseSourceEntry(group);

      if (!source) {
        // BELANGRIJK:
        // Leaflet dragging niet uitschakelen tijdens dragstart.
        // Dit kan verhinderen dat dragend wordt uitgevoerd.
        // Zonder geselecteerde stop wordt bij dragend
        // alleen de oorspronkelijke positie hersteld.
        marker.setLatLng(group.point);

        return;
      }

      dragState = {
        locationKey: source.locationKey,
        number: source.number,
        revision: state.revision,
        routeId: String(state.route?.id ?? ""),
        companyId: String(state.companyId ?? "")
      };

      marker.closePopup();

      setStatus(
        `Moving stop ${source.number}. ` +
        "Drop near another delivery marker."
      );
    });

    // ======================================================
    // 5. DRAG MOVEMENT
    // ======================================================

    marker.on("drag", () => {
      if (!dragState) return;

      const target = findDropTarget(
        marker.getLatLng(),
        dragState.locationKey
      );

      const targetKey = target?.locationKey ?? null;
      const previousKey = dragTarget?.locationKey ?? null;

      if (targetKey === previousKey) return;

      dragTarget = target;

      if (target) {
        setStatus(
          `Move stop ${dragState.number} ` +
          `before stop ${target.number}.`
        );
      } else {
        setStatus(
          "Move closer to another delivery marker."
        );
      }
    });

    // ======================================================
    // 6. DRAG END
    // ======================================================

    marker.on("dragend", () => {
      const dropPosition = marker.getLatLng();

      const saved = dragState;

      dragState = null;
      dragTarget = null;

      // De fysieke locatie van een order verandert nooit.
      // Alleen de volgorde wordt aangepast.
      marker.setLatLng(group.point);

      if (!saved) {
        // Bijvoorbeeld wanneer een gecombineerde marker
        // nog geen individueel geselecteerde stop heeft.
        setStatus(
          group.combined
            ? `Select an individual stop in ${group.label} before dragging.`
            : "Stop order was not changed."
        );

        return;
      }

      const latest = getState();

      // ====================================================
      // VERIFY ROUTE HAS NOT CHANGED
      // ====================================================

      if (
        !canEditStopOrder(latest) ||
        latest.revision !== saved.revision ||
        String(latest.route?.id ?? "") !== saved.routeId ||
        String(latest.companyId ?? "") !== saved.companyId
      ) {
        setStatus(
          "Route changed during dragging. Try again."
        );
        return;
      }

      // ====================================================
      // FIND TARGET STOP
      // ====================================================

      const target = findDropTarget(
        dropPosition,
        saved.locationKey
      );

      if (!target) {
        setStatus(
          "No delivery stop found near the drop position."
        );
        return;
      }

      // ====================================================
      // UPDATE CENTRAL WORKSPACE ORDER
      // ====================================================

      const changed = moveMapLocation(
        saved.locationKey,
        target.locationKey,
        saved,
        false
      );

      if (!changed) {
        setStatus(
          "Stop order was not changed."
        );
        return;
      }

      // De controller verwerkt de nieuwe stopvolgorde.
      // De mapmodule en stoplijst worden opnieuw gerenderd.
      selectedLocationKey = saved.locationKey;

      setStatus(
        "Stop order updated. Recalculate to refresh " +
        "distance, driving time and costs."
      );
    });

    // ======================================================
    // 7. MARKER CURSOR
    // ======================================================

    marker.on("add", () => {
      const icon = marker.getElement();

      if (!icon) return;

      icon.style.cursor = editable
        ? "grab"
        : "pointer";
    });

    // ======================================================
    // 8. ADD MARKER TO MAP
    // ======================================================

    markerLayer.addLayer(marker);
  }

  applyLayerVisibility();
}

    // ========================================================
    // 29. DRAW ROUTE LINE
    // ========================================================

    function drawLine(points, verified = false) {
      if (!lineLayer) return;

      lineLayer.clearLayers();

      if (
        !Array.isArray(points) ||
        points.length < 2
      ) {
        return;
      }

      const line = window.L.polyline(
        points,
        {
          color: verified
            ? "#0866ff"
            : "#64748b",
          weight: 4,
          opacity: 0.9,
          dashArray: verified
            ? null
            : "8 8",
          lineJoin: "round"
        }
      );

      lineLayer.addLayer(line);
      applyLayerVisibility();
    }

    // ========================================================
    // END OF PART 3 OF 5
    //
    // Paste PART 4 directly below.
    // mountMap() remains open.
    // Do not add closing braces or })();
    // ========================================================


    // ========================================================
    // PART 4 OF 5
    // 30. UNDO / REDO HISTORY
    // ========================================================

    function updateHistoryButtons() {
      const editable = canEditStopOrder(getState());

      shell.undoButton.disabled =
        !editable || undoStack.length === 0;

      shell.redoButton.disabled =
        !editable || redoStack.length === 0;

      shell.undoButton.title = undoStack.length
        ? `Undo (${undoStack.length} available)`
        : "Nothing to undo";

      shell.redoButton.title = redoStack.length
        ? `Redo (${redoStack.length} available)`
        : "Nothing to redo";
    }

    function synchronizeHistory(snapshot) {
      const routeId = String(snapshot.route?.id ?? "");
      const companyId = String(snapshot.companyId ?? "");

      const currentIds = Array.isArray(
        snapshot.draft?.stop_order_ids
      )
        ? snapshot.draft.stop_order_ids.map(String)
        : [];

      // New route or company: clear history.
      if (
        routeId !== historyRouteId ||
        companyId !== historyCompanyId
      ) {
        undoStack.length = 0;
        redoStack.length = 0;

        historyRouteId = routeId;
        historyCompanyId = companyId;

        lastKnownOrderIds = [...currentIds];
        pendingHistoryOrderIds = null;
        selectedLocationKey = null;

        updateHistoryButtons();
        return;
      }

      if (!lastKnownOrderIds) {
        lastKnownOrderIds = [...currentIds];
      }

      if (!sameOrder(currentIds, lastKnownOrderIds)) {
        const expected =
          Array.isArray(pendingHistoryOrderIds) &&
          sameOrder(currentIds, pendingHistoryOrderIds);

        // External changes invalidate local history.
        if (!expected) {
          undoStack.length = 0;
          redoStack.length = 0;
        }

        lastKnownOrderIds = [...currentIds];
      }

      pendingHistoryOrderIds = null;
      updateHistoryButtons();
    }

    function undoStopOrder() {
      if (!undoStack.length) return;

      if (!canEditStopOrder(getState())) {
        setStatus("Route cannot be edited right now.");
        return;
      }

      const previous = [
        ...undoStack[undoStack.length - 1]
      ];

      const current = getCurrentOrderIds();

      try {
        validateOrderIds(previous, current);

        pendingHistoryOrderIds = [...previous];

        workspace.setStopOrder(previous);

        undoStack.pop();
        redoStack.push([...current]);

        lastKnownOrderIds = [...previous];
        pendingHistoryOrderIds = null;

        updateHistoryButtons();

        setStatus(
          "Previous stop order restored. Recalculate the route."
        );

      } catch (error) {
        pendingHistoryOrderIds = null;
        showError(error);
      }
    }

    function redoStopOrder() {
      if (!redoStack.length) return;

      if (!canEditStopOrder(getState())) {
        setStatus("Route cannot be edited right now.");
        return;
      }

      const next = [
        ...redoStack[redoStack.length - 1]
      ];

      const current = getCurrentOrderIds();

      try {
        validateOrderIds(next, current);

        pendingHistoryOrderIds = [...next];

        workspace.setStopOrder(next);

        redoStack.pop();
        undoStack.push([...current]);

        while (undoStack.length > MAP_CONFIG.maxHistory) {
          undoStack.shift();
        }

        lastKnownOrderIds = [...next];
        pendingHistoryOrderIds = null;

        updateHistoryButtons();

        setStatus(
          "Stop order restored. Recalculate the route."
        );

      } catch (error) {
        pendingHistoryOrderIds = null;
        showError(error);
      }
    }

    // ========================================================
    // 31. EXPAND / COLLAPSE MAP
    // ========================================================


function updateExpandedMap() {
  shell.root.classList.toggle(
    "rw-map-expanded",
    expanded
  );

  const label = shell.expandButton.querySelector(
    ".rw-map-button-label"
  );

  const buttonText = expanded
    ? "Exit Expanded Map"
    : "Expand Map";

  if (label) {
    label.textContent = buttonText;
  }

  shell.expandButton.setAttribute(
    "aria-label",
    buttonText
  );

  shell.expandButton.setAttribute(
    "aria-pressed",
    String(expanded)
  );

  shell.expandButton.title = buttonText;

  if (expanded) {
    if (!originalMapStyle) {
      originalMapStyle = {
        rootCss: shell.root.style.cssText,
        canvasHeight: shell.canvas.style.height,
        canvasMinHeight: shell.canvas.style.minHeight
      };
    }

    shell.root.style.position = "fixed";
    shell.root.style.inset = "12px";
    shell.root.style.zIndex = "100";
    shell.root.style.width = "auto";
    shell.root.style.height = "auto";
    shell.root.style.maxHeight = "none";
    shell.root.style.background = "#ffffff";
    shell.root.style.padding = "12px";
    shell.root.style.borderRadius = "12px";
    shell.root.style.boxShadow =
      "0 12px 40px rgba(0,0,0,.25)";
    shell.root.style.overflow = "auto";

    shell.canvas.style.height =
      "calc(100dvh - 220px)";
    shell.canvas.style.minHeight = "350px";

  } else {
    if (originalMapStyle) {
      shell.root.style.cssText =
        originalMapStyle.rootCss;

      shell.canvas.style.height =
        originalMapStyle.canvasHeight;

      shell.canvas.style.minHeight =
        originalMapStyle.canvasMinHeight;
    }

    originalMapStyle = null;
  }

  requestAnimationFrame(() => {
    if (!destroyed && map) {
      map.invalidateSize({
        animate: false
      });
    }
  });
}

    function toggleExpandedMap() {
      expanded = !expanded;
      updateExpandedMap();
    }

    // ========================================================
    // 32. SELECT LOCATION FROM DELIVERY STOPS
    // ========================================================

 
function connectStopListSelection() {
  const container = workspaceRoot.querySelector(
    '[data-rw-overview="stops"]'
  );

  if (!container) return;

  container.addEventListener(
    "click",
    event => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      // Bestaande knoppen, orderdetails en invoervelden
      // mogen hun normale werking behouden.
      if (
        target.closest(
          "button,summary,details,input,select,textarea,a"
        )
      ) {
        return;
      }

      const row = target.closest(
        ".rw-overview-stop[data-rw-location-key]"
      );

      if (!row || !container.contains(row)) return;

      const key = row.dataset.rwLocationKey;

      if (!key) return;

      focusMapLocation(key);
    },
    listenerOptions
  );

  // Toetsenbordbediening voor de stoplijst.
  container.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) return;

      if (
        target.closest(
          "button,summary,details,input,select,textarea,a"
        )
      ) {
        return;
      }

      const row = target.closest(
        ".rw-overview-stop[data-rw-location-key]"
      );

      if (!row || !container.contains(row)) return;

      event.preventDefault();

      focusMapLocation(
        row.dataset.rwLocationKey
      );
    },
    listenerOptions
  );
}


    // ========================================================
    // 33. ROUTE SUGGESTION VISUALIZATION
    // ========================================================

    function clearSuggestionLayer() {
      suggestionLayer?.clearLayers();
    }

    function drawSuggestionRoute(points) {
      if (!suggestionLayer) return;

      const validPoints = points.map(point =>
        readPoint(point?.[0], point?.[1])
      );

      if (
        validPoints.length < 2 ||
        validPoints.some(point => !point)
      ) {
        throw new Error(
          "Route suggestion contains invalid coordinates."
        );
      }

      suggestionLayer.clearLayers();

      const line = window.L.polyline(
        validPoints,
        {
          color: "#f59e0b",
          weight: 4,
          opacity: 0.85,
          dashArray: "10 6"
        }
      );

      suggestionLayer.addLayer(line);

      shell.suggestionsToggle.checked = true;
      applyLayerVisibility();
    }

    // ========================================================
    // 34. OPTIMIZATION CONTROLLER INTEGRATION
    // ========================================================

    function getOptimizationAction() {
      const candidates = [
        workspace.suggestBetterRoute,
        workspace.optimizeRoute,
        workspace.findBetterRoute
      ];

      return candidates.find(
        candidate => typeof candidate === "function"
      ) || null;
    }

    function updateOptimizationButtons() {
      const state = getState();

      const available = Boolean(
        getOptimizationAction() &&
        canEditStopOrder(state)
      );

      shell.optimizeButton.disabled = !available;

      shell.optimizeButton.title = available
        ? "Calculate a better route proposal"
        : "Route optimization is not connected yet";

      const canApply = Boolean(
        pendingSuggestion &&
        canEditStopOrder(state) &&
        pendingSuggestion.routeId ===
          String(state.route?.id ?? "") &&
        pendingSuggestion.revision === state.revision
      );

      shell.applySuggestionButton.hidden = !canApply;
      shell.applySuggestionButton.disabled = !canApply;
    }

    function synchronizeSuggestions(snapshot) {
      if (pendingSuggestion) {
        const routeId = String(
          snapshot.route?.id ?? ""
        );

        if (
          pendingSuggestion.routeId !== routeId ||
          pendingSuggestion.revision !== snapshot.revision
        ) {
          pendingSuggestion = null;
          clearSuggestionLayer();
        }
      }

      updateOptimizationButtons();
    }

    async function requestOptimization() {
      const action = getOptimizationAction();

      if (!action) {
        setStatus(
          "Route optimization is not connected yet."
        );
        return;
      }

      const state = getState();

      if (!canEditStopOrder(state)) {
        setStatus(
          "Route cannot be optimized right now."
        );
        return;
      }

      const revision = state.revision;
      const routeId = String(state.route?.id ?? "");
      const companyId = String(state.companyId ?? "");

      shell.optimizeButton.disabled = true;
      const optimizeLabel = shell.optimizeButton.querySelector(
  ".rw-map-button-label"
);

if (optimizeLabel) {
  optimizeLabel.textContent = "Optimizing…";
}

      clearError();

      try {
        const result = await action.call(workspace);

        const latest = getState();

        if (
          latest.revision !== revision ||
          String(latest.route?.id ?? "") !== routeId ||
          String(latest.companyId ?? "") !== companyId
        ) {
          throw new Error(
            "Route changed during optimization."
          );
        }

        if (
          !result ||
          !Array.isArray(result.stop_order_ids)
        ) {
          setStatus(
            "No usable route improvement was returned."
          );
          return;
        }

        const proposedIds =
          result.stop_order_ids.map(String);

        const currentIds = getCurrentOrderIds();

        validateOrderIds(
          proposedIds,
          currentIds
        );

        if (sameOrder(proposedIds, currentIds)) {
          pendingSuggestion = null;
          clearSuggestionLayer();

          setStatus(
            "The current route already matches the proposal."
          );
          return;
        }

        pendingSuggestion = {
          routeId,
          revision,
          companyId,
          orderIds: proposedIds,
          result
        };

        if (Array.isArray(result.points)) {
          drawSuggestionRoute(result.points);
        } else {
          clearSuggestionLayer();
        }

        synchronizeSuggestions(latest);

        setStatus(
          "A route proposal is ready for review."
        );

      } catch (error) {
        pendingSuggestion = null;
        clearSuggestionLayer();
        showError(error);

      } finally {
const optimizeLabel = shell.optimizeButton.querySelector(
  ".rw-map-button-label"
);

if (optimizeLabel) {
  optimizeLabel.textContent = "Find Better Route";
}

        updateOptimizationButtons();
      }
    }

    function applyPendingSuggestion() {
      if (!pendingSuggestion) return false;

      const state = getState();

      if (
        pendingSuggestion.routeId !==
          String(state.route?.id ?? "") ||
        pendingSuggestion.revision !== state.revision ||
        pendingSuggestion.companyId !==
          String(state.companyId ?? "")
      ) {
        pendingSuggestion = null;
        clearSuggestionLayer();

        throw new Error(
          "The route proposal is no longer current."
        );
      }

      const proposedIds = [
        ...pendingSuggestion.orderIds
      ];

      const changed = applyStopOrder(proposedIds);

      pendingSuggestion = null;
      clearSuggestionLayer();

      updateOptimizationButtons();

      return changed;
    }

    // ========================================================
    // 35. KEYBOARD SHORTCUTS
    // ========================================================

    function handleMapKeyboard(event) {
      if (!expanded) return;

      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();

        expanded = false;
        updateExpandedMap();
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;

      if (!modifier) return;

      const key = event.key.toLowerCase();

      if (key === "z") {
        event.preventDefault();

        if (event.shiftKey) {
          redoStopOrder();
        } else {
          undoStopOrder();
        }
      }

      if (key === "y") {
        event.preventDefault();
        redoStopOrder();
      }
    }

    // ========================================================
    // 36. CONNECT MAP CONTROLS
    // ========================================================

    function connectMapControls() {
      shell.root.addEventListener(
        "change",
        event => {
          const input = event.target;

          if (
            !(input instanceof HTMLInputElement) &&
            !(input instanceof HTMLSelectElement)
          ) {
            return;
          }

          const field = input.dataset.rwMapField;

          if (!field) return;

          if (field === "layer") {
            try {
              setTileLayer(input.value);
            } catch (error) {
              showError(error);
            }
            return;
          }

          applyLayerVisibility();
        },
        listenerOptions
      );

      shell.root.addEventListener(
        "click",
        event => {
          const button = event.target.closest(
            "[data-rw-map-action]"
          );

          if (!button || button.disabled) return;

          const action = button.dataset.rwMapAction;

          try {
            switch (action) {
              case "fit":
                fitRoute();
                break;

              case "expand":
                toggleExpandedMap();
                break;

              case "undo":
                undoStopOrder();
                break;

              case "redo":
                redoStopOrder();
                break;

              case "optimize":
                void requestOptimization();
                break;

              case "apply-suggestion":
                applyPendingSuggestion();
                break;
            }
          } catch (error) {
            showError(error);
          }
        },
        listenerOptions
      );

      workspaceRoot.addEventListener(
        "keydown",
        handleMapKeyboard,
        listenerOptions
      );
    }

    // ========================================================
    // END OF PART 4 OF 5
    //
    // Paste PART 5 directly below.
    // mountMap() remains open.
    // Do not add closing braces or })();
    // ========================================================

    // ========================================================
    // PART 5 OF 5
    // 37. DEPOT CACHE
    // ========================================================

    async function getDepot(companyId) {
      if (
        !depotPromise ||
        depotCompanyId !== companyId
      ) {
        depotCompanyId = companyId;

        const pending = loadDepot(
          companyId,
          events.signal
        );

        depotPromise = pending;

        pending.catch(() => {
          if (depotPromise === pending) {
            depotPromise = null;
          }
        });
      }

      return depotPromise;
    }

    // ========================================================
    // 38. VALIDATE ROUTE SNAPSHOT
    // ========================================================

    function validateRouteSnapshot(snapshot) {
      if (!snapshot) {
        throw new Error("Route state is missing.");
      }

      if (!snapshot.companyId) {
        throw new Error("Company ID is missing.");
      }

      assertCompany(snapshot.companyId);

      if (!snapshot.preview) {
        throw new Error(
          "Route preview is not available."
        );
      }

      const locations = getMapLocations(snapshot);

      if (locations.length > MAP_CONFIG.maxLocations) {
        throw new Error(
          "This route contains too many delivery locations."
        );
      }

      for (const [index, location] of locations.entries()) {
        if (!readPoint(
          location.latitude,
          location.longitude
        )) {
          throw new Error(
            `Delivery location ${index + 1} has invalid coordinates.`
          );
        }
      }

      return locations;
    }

    // ========================================================
    // 39. UPDATE MARKER INTERACTION
    // ========================================================

    function updateMarkerInteraction(snapshot) {
      const editable = canEditStopOrder(snapshot);

      for (const group of currentGroups) {
        const marker = group.marker;
        if (!marker) continue;

        if (editable) {
          marker.dragging?.enable();
        } else {
          marker.dragging?.disable();
        }

        const icon = marker.getElement();

        if (icon) {
          icon.style.cursor = editable
            ? "grab"
            : "pointer";
        }
      }
    }

    // ========================================================
    // 40. SYNCHRONIZE ROUTE SUGGESTIONS
    // ========================================================

    function synchronizeSuggestionState(snapshot) {
      synchronizeSuggestions(snapshot);
    }

    // ========================================================
    // 41. UPDATE ROUTE MAP
    // ========================================================


async function updateMap(snapshot, ticket) {

const locations = validateRouteSnapshot(snapshot);

ensureMap();

// Apply the active company's emission map setting.
if (
  emissionSettingsCompanyId !== snapshot.companyId ||
  (!emissionSettingsLoaded && !emissionSettingsPromise)
) {
  void loadEmissionMapSettings(snapshot.companyId)
    .then(visible => {
      if (!visible || destroyed) return;

      return loadEmissionZones(snapshot.companyId);
    })
    .catch(error => {
      if (!destroyed) {
        console.warn(
          "[RouteWorkspace] Emission settings unavailable:",
          error
        );
      }
    });
}



  const depot = await getDepot(snapshot.companyId);

  if (!isCurrent(ticket)) return;

  assertCompany(snapshot.companyId);

  currentDepot = depot;
  currentLocations = locations;

  if (!locations.length) {
    markerLayer.clearLayers();
    lineLayer.clearLayers();
    suggestionLayer.clearLayers();

    currentGroups = [];
    routeBounds = null;
    lastPointKey = null;

    shell.fitButton.disabled = true;

    setStatus("No delivery locations are available.");
    return;
  }

  // ========================================================
  // ROUTE POINTS
  // ========================================================

  const points = getRoutePoints(depot, locations);
  const pointKey = getRoutePointKey(points);

  const previousPointKey = lastPointKey;
  const routeChanged = previousPointKey !== pointKey;

  // ========================================================
  // UPDATE MARKERS
  // ========================================================

  drawMarkers(depot, locations);
  updateMarkerInteraction(snapshot);

  // Herstel de selectie na het opnieuw tekenen.
  if (selectedLocationKey) {
    const stillExists = currentGroups.some(group =>
      group.entries.some(
        entry => entry.locationKey === selectedLocationKey
      )
    );

    if (stillExists) {
      selectMapLocation(selectedLocationKey);
    } else {
      selectedLocationKey = null;
    }
  }

  // ========================================================
  // MAP BOUNDS
  // ========================================================

  routeBounds = getRouteBounds();

  shell.fitButton.disabled = !routeBounds;

  map.invalidateSize({
    animate: false
  });

  // Alleen automatisch inzoomen wanneer de route voor
  // het eerst verschijnt of de geografische punten veranderen.
  // Bij een wijziging van alleen de stopvolgorde blijft
  // de huidige zoom behouden.
  const geographicKey = JSON.stringify(
    [
      depot.point,
      ...locations.map(location =>
        readPoint(location.latitude, location.longitude)
      )
    ].map(point => coordinateKey(point)).sort()
  );

  if (lastPointKey === null) {
    fitRoute();
  } else if (
    currentGeographicKey !== geographicKey
  ) {
    fitRoute();
  }

  currentGeographicKey = geographicKey;
  lastPointKey = pointKey;

  applyLayerVisibility();

  // ========================================================
  // DISTANCE
  // ========================================================

  const distance = getPreviewDistanceMiles(snapshot);

  const distanceText = distance !== null
    ? ` · ${formatMiles(distance)}`
    : "";

  // ========================================================
  // STALE ROUTE PREVIEW
  // ========================================================

  if (!hasCurrentPreview(snapshot)) {
    drawLine(points, false);

    setStatus(
      "Modified route preview · Recalculate to update " +
      "distance, driving time and costs."
    );

    return;
  }

  // ========================================================
  // ESTIMATED ROUTING
  // ========================================================

  if (snapshot.preview.routing_source !== "osrm") {
    drawLine(points, false);

    setStatus(
      "Estimated route" +
      distanceText +
      " · Dashed lines show direct connections."
    );

    return;
  }

  // ========================================================
  // CACHED OSRM GEOMETRY
  // ========================================================

  const cachedGeometry = getCachedGeometry(pointKey);

  if (cachedGeometry) {
    drawLine(cachedGeometry, true);

    setStatus(
      "OSRM road route" +
      distanceText +
      " · Totals supplied by the Planning Engine."
    );

    return;
  }

  // ========================================================
  // LOAD OSRM GEOMETRY
  // ========================================================

  setStatus("Loading road geometry…");

  const controller = new AbortController();
  geometryController = controller;

  const timeout = setTimeout(() => {
    controller.abort();
  }, MAP_CONFIG.geometryTimeoutMs);

  geometryTimer = timeout;

  try {
    const geometry = await fetchRoadGeometry(
      points,
      controller.signal
    );

    if (!isCurrent(ticket)) return;

    assertCompany(snapshot.companyId);

    cacheGeometry(pointKey, geometry);
    drawLine(geometry, true);

    setStatus(
      "OSRM road route" +
      distanceText +
      " · Road geometry verified."
    );

  } catch (error) {
    if (!isCurrent(ticket)) return;

    drawLine(points, false);

    setStatus(
      "Road geometry unavailable. " +
      "Direct connections are shown."
    );

    if (error?.name !== "AbortError") {
      showError(
        new Error(
          "The road route could not be loaded. " +
          "Planning Engine totals remain unchanged."
        )
      );
    }

  } finally {
    clearTimeout(timeout);

    if (geometryController === controller) {
      geometryController = null;
      geometryTimer = null;
    }
  }
}

    // ========================================================
    // 42. RENDER WORKSPACE STATE
    // ========================================================

    function render(snapshot) {
      if (destroyed) {
        return;
      }

      const ticket = ++renderTicket;

      cancelGeometry();

      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }

      clearError();

      // ------------------------------------------------------
      // Synchronize history and suggestions
      // ------------------------------------------------------

      synchronizeHistory(snapshot);
      synchronizeSuggestionState(snapshot);

      updateHistoryButtons();
      updateOptimizationButtons();

      // ------------------------------------------------------
      // Only render map when route tab is active
      // ------------------------------------------------------

      if (snapshot.activeTab !== "route") {
        return;
      }

      if (
        !snapshot.preview ||
        !snapshot.companyId
      ) {
        setStatus(
          "Waiting for route data…"
        );
        return;
      }

      frame = requestAnimationFrame(() => {
        frame = null;

        if (!isCurrent(ticket)) {
          return;
        }

        void updateMap(
          snapshot,
          ticket
        ).catch(error => {
          if (!isCurrent(ticket)) {
            return;
          }

          markerLayer?.clearLayers();
          lineLayer?.clearLayers();

          routeBounds = null;
          shell.fitButton.disabled = true;

          setStatus(
            "The route map could not be displayed."
          );

          showError(error);
        });
      });
    }

    // ========================================================
    // 43. INITIALIZE MAP CONTROLS
    // ========================================================

    function initializeControls() {
      connectMapControls();
      connectStopListSelection();

      updateHistoryButtons();
      updateOptimizationButtons();

      shell.expandButton.setAttribute(
        "aria-pressed",
        "false"
      );

      shell.suggestionsToggle.checked = false;
    }

    // ========================================================
    // 44. DESTROY MAP MODULE
    // ========================================================

function destroy() {
  if (destroyed) {
    return;
  }

  destroyed = true;
  ++renderTicket;

  if (map && focusMoveEndHandler) {
    map.off("moveend", focusMoveEndHandler);
    focusMoveEndHandler = null;
  }

events.abort();
cancelGeometry();

      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }

      resizeObserver?.disconnect();
      resizeObserver = null;

      undoStack.length = 0;
      redoStack.length = 0;

      pendingSuggestion = null;
      pendingHistoryOrderIds = null;

      selectedLocationKey = null;

      currentGroups = [];
      currentLocations = [];
      currentDepot = null;

      geometryCache.clear();

      try {
        if (map) {
          map.remove();
        }
      } finally {
        map = null;


markerLayer = null;
lineLayer = null;
suggestionLayer = null;

// Reset emission zones
emissionZoneLayer = null;
emissionZonesLoaded = false;
emissionZonesPromise = null;

// Reset tenant emission settings
emissionZonesVisible = false;
emissionSettingsLoaded = false;
emissionSettingsPromise = null;
emissionSettingsCompanyId = null;


        activeTileLayer = null;
        activeTileKey = null;

        routeBounds = null;
        lastPointKey = null;

        depotPromise = null;
        depotCompanyId = null;

        if (shell.root.parentNode === slot) {
          slot.replaceChildren(
            ...originalChildren
          );
        } else {
          shell.root.remove();
        }
      }
    }

    // ========================================================
    // 45. MOUNT MAP MODULE
    // ========================================================

    try {
      slot.replaceChildren(
        shell.root
      );

      initializeControls();

      render(
        getState()
      );

    } catch (error) {
      destroy();
      throw error;
    }

    // ========================================================
    // 46. MODULE API
    // ========================================================

    return {
      root: shell.root,

      render,

      destroy,

      focusLocation(locationKey) {
        focusMapLocation(locationKey);
      },

      selectLocation(locationKey) {
        selectMapLocation(locationKey);
      },

      fitRoute,

      undo: undoStopOrder,

      redo: redoStopOrder,

      getMapState() {
        return {
          expanded,
          selectedLocationKey,
          undoCount: undoStack.length,
          redoCount: redoStack.length,
          hasSuggestion: Boolean(pendingSuggestion),
          markerCount: currentGroups.length,
          locationCount: currentLocations.length
        };
      }
    };
  }

  // ==========================================================
  // 47. REGISTER MAP MODULE
  // ==========================================================

  workspace.registerModule("map", {
    mount: mountMap
  });

  // ==========================================================
  // END OF PART 5 OF 5
  // ==========================================================

})();

