/* Veynor Driver PWA - Routes, Delivered, Issues, POD, GPS & Offline Sync */
(function () {
  "use strict";

  /* =========================================================
     CONFIG
  ========================================================= */

  const POD_BUCKET = "pod-assets";

const MIN_POD_PHOTOS = 1;
const MAX_POD_PHOTOS = 5;

  const POD_PHOTO_MAX_SIZE = 1280;
  const POD_PHOTO_QUALITY = 0.72;

  // Live marker is updated at most once every 30 seconds.
  const LOCATION_SEND_INTERVAL_MS = 30000;

  // GPS history: keep a point approximately every 30 seconds.
  const GPS_HISTORY_INTERVAL_MS = 30000;

  // Automatic unloading detection.
  const STOP_RADIUS_METERS = 100;
  const STOP_DWELL_MS = 3 * 60 * 1000;

  // Offline IndexedDB.
  const OFFLINE_DB_NAME = "veynor-driver-offline";
  const OFFLINE_DB_VERSION = 1;
  const OFFLINE_POD_STORE = "pod_queue";
  const OFFLINE_GPS_STORE = "gps_queue";

  const ACTIVE_ROUTE_STATUSES = new Set([
    "sent_to_driver",
    "out_for_delivery",
    "loaded",
    "dispatched",
    "on_transport"
  ]);

  const HIDDEN_STATUSES = new Set([
    "replaced",
    "archived",
    "cancelled",
    "cancelled_route",
    "deleted",
    "removed"
  ]);

  const CLOSED_DELIVERY_STATUSES = new Set([
    "delivered",
    "signed",
    "delivery_issue",
    "failed_delivery",
    "partial",
    "damaged",
    "refused",
    "failed"
  ]);

  const cfg = window.VEYNOR_CONFIG || {};

  /* =========================================================
     STATE
  ========================================================= */

  let db = null;
  let user = null;
  let profile = null;
  let companyId = null;

  let stops = [];
  let selectedStop = null;
  let selectedPodLines = [];
  let signaturePad = null;

  let pendingPodPhotos = [];

  let locationWatchId = null;
  let lastLocationSentAt = 0;
  let lastHistorySavedAt = 0;

  let deliveredFilter = "today";
  let issueFilter = "all";

  // Per stop:
  // {
  //   enteredAt,
  //   unloadingLogged
  // }
  const stopPresence = new Map();

  /* =========================================================
     BASIC HELPERS
  ========================================================= */

  const $ = id => document.getElementById(id);

  const norm = value =>
    String(value ?? "")
      .trim()
      .toLowerCase();

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));

  const num = (value, fallback = 0) => {
    const n = Number(
      String(value ?? "")
        .replace(",", ".")
    );

    return Number.isFinite(n)
      ? n
      : fallback;
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function today() {
    const d = new Date();

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function nowTime() {
    const d = new Date();

    return (
      `${String(d.getHours()).padStart(2, "0")}:` +
      `${String(d.getMinutes()).padStart(2, "0")}`
    );
  }

  function show(el, msg, type = "ok") {
    if (!el) return;

    el.textContent = msg || "";
    el.className = "notice " + type;
  }

  function clearNotice(el) {
    if (!el) return;

    el.textContent = "";
    el.className = "notice";
  }

  function isOnline() {
    return navigator.onLine !== false;
  }

  /* =========================================================
     INDEXED DB
     Offline POD + GPS storage
  ========================================================= */

  function openOfflineDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        OFFLINE_DB_NAME,
        OFFLINE_DB_VERSION
      );

      request.onupgradeneeded = () => {
        const database = request.result;

        if (
          !database.objectStoreNames.contains(
            OFFLINE_POD_STORE
          )
        ) {
          const store =
            database.createObjectStore(
              OFFLINE_POD_STORE,
              {
                keyPath: "id",
                autoIncrement: true
              }
            );

          store.createIndex(
            "created_at",
            "created_at"
          );

          store.createIndex(
            "status",
            "status"
          );
        }

        if (
          !database.objectStoreNames.contains(
            OFFLINE_GPS_STORE
          )
        ) {
          const store =
            database.createObjectStore(
              OFFLINE_GPS_STORE,
              {
                keyPath: "id",
                autoIncrement: true
              }
            );

          store.createIndex(
            "recorded_at",
            "recorded_at"
          );
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async function idbAdd(storeName, value) {
    const database =
      await openOfflineDb();

    return new Promise((resolve, reject) => {
      const tx =
        database.transaction(
          storeName,
          "readwrite"
        );

      const store =
        tx.objectStore(storeName);

      const request =
        store.add(value);

      request.onsuccess = () =>
        resolve(request.result);

      request.onerror = () =>
        reject(request.error);

      tx.oncomplete = () =>
        database.close();
    });
  }

  async function idbPut(storeName, value) {
    const database =
      await openOfflineDb();

    return new Promise((resolve, reject) => {
      const tx =
        database.transaction(
          storeName,
          "readwrite"
        );

      const store =
        tx.objectStore(storeName);

      const request =
        store.put(value);

      request.onsuccess = () =>
        resolve(request.result);

      request.onerror = () =>
        reject(request.error);

      tx.oncomplete = () =>
        database.close();
    });
  }

  async function idbGetAll(storeName) {
    const database =
      await openOfflineDb();

    return new Promise((resolve, reject) => {
      const tx =
        database.transaction(
          storeName,
          "readonly"
        );

      const store =
        tx.objectStore(storeName);

      const request =
        store.getAll();

      request.onsuccess = () =>
        resolve(request.result || []);

      request.onerror = () =>
        reject(request.error);

      tx.oncomplete = () =>
        database.close();
    });
  }

  async function idbDelete(
    storeName,
    id
  ) {
    const database =
      await openOfflineDb();

    return new Promise((resolve, reject) => {
      const tx =
        database.transaction(
          storeName,
          "readwrite"
        );

      const store =
        tx.objectStore(storeName);

      const request =
        store.delete(id);

      request.onsuccess = () =>
        resolve();

      request.onerror = () =>
        reject(request.error);

      tx.oncomplete = () =>
        database.close();
    });
  }

  /* =========================================================
     CONNECTION / OFFLINE UI
  ========================================================= */

  function ensureConnectionStatusUi() {
    if ($("connectionStatus")) {
      return;
    }

    const header =
      document.querySelector(
        ".driver-topline"
      );

    if (!header) return;

    const status =
      document.createElement("span");

    status.id = "connectionStatus";
    status.className =
      "connection-status";

    status.style.cssText = `
      margin-left:auto;
      margin-right:8px;
      padding:7px 10px;
      border-radius:999px;
      font-size:11px;
      font-weight:900;
      background:rgba(255,255,255,.14);
      color:white;
      border:1px solid rgba(255,255,255,.18);
    `;

    const logout =
      $("logoutBtn");

    if (logout) {
      header.insertBefore(
        status,
        logout
      );
    } else {
      header.appendChild(status);
    }
  }

  function updateConnectionUi() {
    ensureConnectionStatusUi();

    const el =
      $("connectionStatus");

    if (!el) return;

    if (isOnline()) {
      el.textContent = "ONLINE";
      el.style.background =
        "rgba(4,120,87,.78)";
    } else {
      el.textContent = "OFFLINE";
      el.style.background =
        "rgba(185,28,28,.82)";
    }
  }

  async function updateOfflineQueueUi() {
    const podMessage =
      $("podMessage");

    if (!podMessage) return;

    try {
      const [
        podQueue,
        gpsQueue
      ] = await Promise.all([
        idbGetAll(
          OFFLINE_POD_STORE
        ),
        idbGetAll(
          OFFLINE_GPS_STORE
        )
      ]);

      if (
        !podQueue.length &&
        !gpsQueue.length
      ) {
        return;
      }

      const parts = [];

      if (podQueue.length) {
        parts.push(
          `${podQueue.length} POD` +
          `${podQueue.length === 1 ? "" : "s"} waiting`
        );
      }

      if (gpsQueue.length) {
        parts.push(
          `${gpsQueue.length} GPS point` +
          `${gpsQueue.length === 1 ? "" : "s"} waiting`
        );
      }

      show(
        podMessage,
        `Offline data: ${parts.join(" · ")}`,
        "ok"
      );
    } catch (error) {
      console.warn(
        "[offline] Queue status failed:",
        error
      );
    }
  }

  /* =========================================================
     SUPABASE
  ========================================================= */

  function ensureDb() {
    if (db) return db;

    if (!window.supabase) {
      throw new Error(
        "Supabase library not loaded."
      );
    }

    if (
      !cfg.SUPABASE_URL ||
      !cfg.SUPABASE_ANON_KEY
    ) {
      throw new Error(
        "SUPABASE_URL or SUPABASE_ANON_KEY missing in config.js."
      );
    }

    db =
      window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY
      );

    return db;
  }

  async function loadProfile() {
    if (!user?.id) {
      return null;
    }

    let result =
      await ensureDb()
        .from("user_profiles")
        .select("*")
        .eq(
          "auth_user_id",
          user.id
        )
        .maybeSingle();

    if (
      !result.data &&
      !result.error
    ) {
      result =
        await ensureDb()
          .from("user_profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
    }

    if (result.error) {
      profile = null;
      return null;
    }

    profile =
      result.data || null;

    return profile;
  }

  async function getCompanyId() {
    if (companyId) {
      return companyId;
    }

    if (profile?.company_id) {
      companyId =
        profile.company_id;

      return companyId;
    }

    const {
      data,
      error
    } = await ensureDb()
      .from("companies")
      .select("id")
      .eq(
        "name",
        cfg.TENANT_NAME ||
        "Sofa2U"
      )
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data?.id) {
      throw new Error(
        "Company not found."
      );
    }

    companyId = data.id;

    return companyId;
  }

  /* =========================================================
     AUTH
  ========================================================= */

  async function initAuth() {
    const { data } =
      await ensureDb()
        .auth
        .getSession();

    user =
      data?.session?.user ||
      null;

    if (user) {
      await loadProfile();
      await getCompanyId();
    }

    renderAuth();

    if (user) {
      await loadStops();

      if (isOnline()) {
        syncOfflineData()
          .catch(error =>
            console.warn(
              "[offline] Initial sync failed:",
              error
            )
          );
      }
    }
  }

  function renderAuth() {
    $("loginView")
      ?.classList
      .toggle(
        "hidden",
        !!user
      );

    $("mainView")
      ?.classList
      .toggle(
        "hidden",
        !user
      );
  }

  async function login(
    email,
    password
  ) {
    const {
      data,
      error
    } = await ensureDb()
      .auth
      .signInWithPassword({
        email,
        password
      });

    if (error) {
      throw error;
    }

    user =
      data?.session?.user ||
      data?.user ||
      null;

    if (!user) {
      throw new Error(
        "Login succeeded, but no auth session was returned."
      );
    }

    await loadProfile();
    await getCompanyId();

    renderAuth();

    await loadStops();

    syncOfflineData()
      .catch(error =>
        console.warn(
          "[offline] Sync after login failed:",
          error
        )
      );
  }

 async function logout() {
  await stopLocationTracking();

  clearNativeTracking();

  await ensureDb()
    .auth
    .signOut();

  user = null;
  profile = null;
  companyId = null;

  stops = [];
  selectedStop = null;
  selectedPodLines = [];
  pendingPodPhotos = [];

  renderAuth();
  clearRouteUi();
}

    user = null;
    profile = null;
    companyId = null;

    stops = [];
    selectedStop = null;
    selectedPodLines = [];
    pendingPodPhotos = [];

    renderAuth();
    clearRouteUi();
  }

  /* =========================================================
     ROUTE HELPERS
  ========================================================= */

  function clearRouteUi() {
    if ($("stopsList")) {
      $("stopsList").innerHTML = "";
    }

    if ($("deliveredList")) {
      $("deliveredList").innerHTML = "";
    }

    if ($("issuesList")) {
      $("issuesList").innerHTML = "";
    }

    if ($("routesTimeline")) {
      $("routesTimeline").innerHTML = "";
    }

    if ($("kpiStops")) {
      $("kpiStops").textContent = "0";
    }

    if ($("kpiDelivered")) {
      $("kpiDelivered").textContent = "0";
    }

    if ($("kpiOpen")) {
      $("kpiOpen").textContent = "0";
    }
  }

  function getOrder(stop) {
    return stop?.orders || {};
  }

  function getOrderId(stop) {
    return (
      getOrder(stop)?.id ||
      stop?.order_id ||
      null
    );
  }

  function getRouteId(stop) {
    return (
      stop?.route_id ||
      getOrder(stop)?.route_id ||
      stop?.routes?.id ||
      null
    );
  }

  function getRouteStatus(stop) {
    return norm(
      stop?.routes?.route_status ||
      stop?.routes?.status ||
      stop?.route_status ||
      ""
    );
  }

  function getRouteCode(stop) {
    return (
      stop?.routes?.route_code ||
      stop?.routes?.route_name ||
      stop?.routes?.name ||
      stop?.route_code ||
      stop?.route_id ||
      "Route"
    );
  }

  function getRetailerName(
    order,
    stop
  ) {
    return (
      order?.retail_name ||
      order?.retailer_name ||
      order?.delivery_name ||
      order?.delivery_company ||
      order?.recipient_name ||
      stop?.stop_name ||
      order?.customers?.name ||
      order?.customer_name ||
      "Customer"
    );
  }

  function getOrderAddress(
    order,
    stop = null
  ) {
    return [
      order?.delivery_address_1 ||
        stop?.address_1,

      order?.delivery_address_2 ||
        stop?.address_2,

      order?.delivery_city ||
        stop?.city,

      order?.delivery_postcode ||
        stop?.postcode,

      order?.delivery_country ||
        stop?.country
    ]
      .filter(Boolean)
      .join(", ");
  }

  function statusOf(stop) {
    const order =
      getOrder(stop);

    const stopStatus =
      norm(
        stop?.delivery_status ||
        stop?.status ||
        ""
      );

    const orderStatus =
      norm(
        order?.pod_status ||
        order?.transport_status ||
        order?.status ||
        ""
      );

    if (
      ["signed", "delivered"]
        .includes(orderStatus) ||

      ["signed", "delivered"]
        .includes(stopStatus) ||

      stop?.completed_at ||
      order?.pod_signed_at ||
      order?.pod_document_url
    ) {
      return "delivered";
    }

    if (
      [
        "delivery_issue",
        "failed_delivery",
        "partial",
        "damaged",
        "refused",
        "failed"
      ].includes(orderStatus)
    ) {
      return orderStatus;
    }

    if (
      [
        "delivery_issue",
        "failed_delivery",
        "partial",
        "damaged",
        "refused",
        "failed"
      ].includes(stopStatus)
    ) {
      return stopStatus;
    }

    return (
      stopStatus ||
      orderStatus ||
      "planned"
    );
  }

  function isDelivered(stop) {
    return CLOSED_DELIVERY_STATUSES
      .has(statusOf(stop));
  }

  function isIssue(stop) {
    return [
      "partial",
      "damaged",
      "refused",
      "failed",
      "missing",
      "delivery_issue",
      "failed_delivery"
    ].includes(statusOf(stop));
  }

  function isOpenForDriver(stop) {
    return !CLOSED_DELIVERY_STATUSES
      .has(statusOf(stop));
  }

  function isAdminOrTenantUser() {
    return [
      "veynor_admin",
      "tenant_admin",
      "tenant_user"
    ].includes(
      norm(profile?.role || "")
    );
  }

  function isStopForCurrentDriver(stop) {
    if (!user?.id) {
      return false;
    }

    if (isAdminOrTenantUser()) {
      return true;
    }

    const order =
      getOrder(stop);

    const currentIds = [
      user?.id,
      profile?.id,
      profile?.auth_user_id
    ]
      .filter(Boolean)
      .map(String);

    const candidateIds = [
      stop?.driver_user_id,
      stop?.driver_profile_id,
      stop?.routes?.driver_user_id,
      stop?.routes?.driver_profile_id,
      order?.driver_user_id,
      order?.driver_profile_id
    ]
      .filter(Boolean)
      .map(String);

    if (
      candidateIds.some(
        id =>
          currentIds.includes(id)
      )
    ) {
      return true;
    }

    const currentEmail =
      norm(
        user?.email ||
        profile?.email ||
        ""
      );

    const candidateEmails = [
      order?.driver_email,
      stop?.driver_email,
      stop?.routes?.driver_email
    ]
      .filter(Boolean)
      .map(norm);

    return (
      !!currentEmail &&
      candidateEmails.includes(
        currentEmail
      )
    );
  }

  function isStopVisibleInDriverApp(stop) {
    const routeStatus =
      getRouteStatus(stop);

    const stopStatus =
      statusOf(stop);

    const order =
      getOrder(stop);

    const orderStatus =
      norm(order.status || "");

    const transportStatus =
      norm(
        order.transport_status || ""
      );

    if (
      HIDDEN_STATUSES.has(routeStatus) ||
      HIDDEN_STATUSES.has(stopStatus) ||
      HIDDEN_STATUSES.has(orderStatus) ||
      HIDDEN_STATUSES.has(transportStatus)
    ) {
      return false;
    }

    if (isDelivered(stop)) {
      return true;
    }

    if (
      ACTIVE_ROUTE_STATUSES.has(routeStatus) ||
      ACTIVE_ROUTE_STATUSES.has(stopStatus) ||
      ACTIVE_ROUTE_STATUSES.has(orderStatus) ||
      ACTIVE_ROUTE_STATUSES.has(transportStatus)
    ) {
      return true;
    }

    return false;
  }

  /* =========================================================
     ROUTE DATE / VEHICLE
  ========================================================= */

  function routeDateValue(route) {
    return String(
      route?.planned_delivery_date ||
      route?.route_date ||
      route?.delivery_date ||
      ""
    ).slice(0, 10);
  }

  function selectNextDriverRoute(routes) {
    const todayDate =
      today();

    const candidates =
      (routes || [])
        .filter(route => {
          const status =
            norm(
              route?.route_status ||
              route?.status ||
              ""
            );

          if (
            HIDDEN_STATUSES
              .has(status)
          ) {
            return false;
          }

          if (
            [
              "delivered",
              "completed",
              "closed"
            ].includes(status)
          ) {
            return false;
          }

          const routeDate =
            routeDateValue(route);

          if (!routeDate) {
            return false;
          }

          if (
            routeDate < todayDate
          ) {
            return false;
          }

          return true;
        })
        .sort((a, b) => {
          const dateA =
            routeDateValue(a);

          const dateB =
            routeDateValue(b);

          if (dateA !== dateB) {
            return dateA.localeCompare(
              dateB
            );
          }

          return String(
            a.route_code ||
            a.id ||
            ""
          ).localeCompare(
            String(
              b.route_code ||
              b.id ||
              ""
            )
          );
        });

    return candidates[0] || null;
  }

  function getCurrentDriverRoute() {
    const stop =
      stops.find(
        isOpenForDriver
      ) ||
      stops[0] ||
      null;

    return stop?.routes || null;
  }

  function getCurrentDriverRouteId() {
    return (
      getCurrentDriverRoute()?.id ||
      stops[0]?.route_id ||
      null
    );
  }

  function getCurrentVehicleId() {
    const route =
      getCurrentDriverRoute();

    return (
      route?.vehicle_id ||
      route?.assigned_vehicle_id ||
      null
    );
  }

  function getCurrentVehicleName() {
    const route =
      getCurrentDriverRoute();

    return (
      route?.vehicle_name ||
      route?.assigned_vehicle_name ||
      ""
    );
  }

/* =========================================================
   NATIVE IPHONE BRIDGE
========================================================= */

function hasNativeBridge() {
  return !!(
    window.VEYNOR_NATIVE_APP &&
    window.VeynorNative &&
    typeof window.VeynorNative.post === "function"
  );
}

async function sendNativeAccessToken() {
  if (!hasNativeBridge()) {
    return;
  }

  try {
    const { data, error } =
      await ensureDb()
        .auth
        .getSession();

    if (error) {
      throw error;
    }

    const accessToken =
      data?.session?.access_token ||
      "";

    if (!accessToken) {
      console.warn(
        "[native bridge] No Supabase access token available."
      );

      return;
    }

    window.VeynorNative
      .updateAccessToken(
        accessToken
      );

    console.log(
      "[native bridge] Supabase access token sent."
    );
  } catch (error) {
    console.warn(
      "[native bridge] Access token failed:",
      error.message
    );
  }
}

function makeNativeStopPayload(stop) {
  const order =
    getOrder(stop);

  const coords =
    getStopCoordinates(stop);

  if (!coords) {
    return null;
  }

  return {
    id:
      String(stop.id),

    order_id:
      getOrderId(stop),

    stop_number:
      num(
        stop.stop_number ||
        stop.stop_sequence,
        0
      ),

    customer_name:
      getRetailerName(
        order,
        stop
      ),

    latitude:
      coords.latitude,

    longitude:
      coords.longitude
  };
}

async function syncNativeTrackingContext() {
  if (!hasNativeBridge()) {
    return;
  }

  if (
    !user?.id ||
    !companyId
  ) {
    return;
  }

  const route =
    getCurrentDriverRoute();

  const routeId =
    getCurrentDriverRouteId();

  if (
    !route ||
    !routeId
  ) {
    window.VeynorNative
      .clearTrackingContext();

    return;
  }

  const routeStops =
    stops
      .filter(stop =>
        String(
          getRouteId(stop)
        ) ===
        String(routeId)
      )
      .filter(
        isOpenForDriver
      )
      .map(
        makeNativeStopPayload
      )
      .filter(Boolean);

  const payload = {
    driver_user_id:
      user.id,

    company_id:
      companyId,

    route_id:
      routeId,

    vehicle_id:
      getCurrentVehicleId(),

    driver_name:
      profile?.full_name ||
      route?.driver_name ||
      user?.email ||
      "Driver",

    vehicle_name:
      getCurrentVehicleName() ||
      null,

    stops:
      routeStops
  };

  await sendNativeAccessToken();

  window.VeynorNative
    .setTrackingContext(
      payload
    );

  console.log(
    "[native bridge] Tracking context sent:",
    routeId,
    routeStops.length,
    "stops"
  );
}

function stopNativeTracking() {
  if (!hasNativeBridge()) {
    return;
  }

  window.VeynorNative
    .stopTracking();
}

function clearNativeTracking() {
  if (!hasNativeBridge()) {
    return;
  }

  window.VeynorNative
    .clearTrackingContext();
}

  /* =========================================================
     GPS DISTANCE
  ========================================================= */

  function degreesToRadians(value) {
    return value * Math.PI / 180;
  }

  function distanceMeters(
    lat1,
    lon1,
    lat2,
    lon2
  ) {
    const earthRadius =
      6371000;

    const dLat =
      degreesToRadians(
        lat2 - lat1
      );

    const dLon =
      degreesToRadians(
        lon2 - lon1
      );

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(
        degreesToRadians(lat1)
      ) *
      Math.cos(
        degreesToRadians(lat2)
      ) *
      Math.sin(dLon / 2) ** 2;

    return (
      2 *
      earthRadius *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      )
    );
  }

  function getStopCoordinates(stop) {
    const order =
      getOrder(stop);

    const latCandidates = [
      stop?.latitude,
      stop?.lat,
      stop?.delivery_latitude,
      stop?.stop_latitude,
      order?.latitude,
      order?.lat,
      order?.delivery_latitude
    ];

    const lonCandidates = [
      stop?.longitude,
      stop?.lng,
      stop?.lon,
      stop?.delivery_longitude,
      stop?.stop_longitude,
      order?.longitude,
      order?.lng,
      order?.lon,
      order?.delivery_longitude
    ];

    const latitude =
      latCandidates
        .map(v => Number(v))
        .find(Number.isFinite);

    const longitude =
      lonCandidates
        .map(v => Number(v))
        .find(Number.isFinite);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }

    return {
      latitude,
      longitude
    };
  }

  /* =========================================================
     AUTOMATIC UNLOADING DETECTION
  ========================================================= */

  async function logUnloadingDetected(
    stop,
    distance
  ) {
    const order =
      getOrder(stop);

    const orderId =
      getOrderId(stop);

    if (!orderId) {
      return;
    }

    const { error } =
      await ensureDb()
        .from(
          "order_activity_log"
        )
        .insert({
          company_id:
            stop.company_id ||
            order.company_id ||
            companyId,

          customer_id:
            order.customer_id ||
            null,

          order_id:
            orderId,

          activity_type:
            "unloading_detected",

          old_status:
            order.status ||
            null,

          new_status:
            order.status ||
            "on_transport",

          description:
            `Driver remained within ${Math.round(distance)}m of delivery address for at least 3 minutes. Unloading automatically detected.`,

          created_by:
            user?.id ||
            "driver_app"
        });

    if (error) {
      console.warn(
        "[driver app] unloading activity log failed:",
        error.message
      );

      return;
    }

    console.log(
      "[driver app] Unloading automatically detected:",
      order.order_number ||
      orderId
    );
  }

  async function checkStopPresence(
    latitude,
    longitude
  ) {
    const now =
      Date.now();

    const openStops =
      stops.filter(
        isOpenForDriver
      );

    for (
      const stop of openStops
    ) {
      const coords =
        getStopCoordinates(stop);

      if (!coords) {
        continue;
      }

      const distance =
        distanceMeters(
          latitude,
          longitude,
          coords.latitude,
          coords.longitude
        );

      const key =
        String(stop.id);

      if (
        distance <=
        STOP_RADIUS_METERS
      ) {
        let state =
          stopPresence.get(key);

        if (!state) {
          state = {
            enteredAt: now,
            unloadingLogged: false
          };

          stopPresence.set(
            key,
            state
          );

          console.log(
            "[driver app] Driver entered stop radius:",
            key,
            Math.round(distance) +
              "m"
          );
        }

        if (
          !state.unloadingLogged &&
          now - state.enteredAt >=
            STOP_DWELL_MS
        ) {
          state.unloadingLogged =
            true;

          stopPresence.set(
            key,
            state
          );

          try {
            await logUnloadingDetected(
              stop,
              distance
            );
          } catch (error) {
            state.unloadingLogged =
              false;

            stopPresence.set(
              key,
              state
            );

            console.warn(
              "[driver app] unloading detection failed:",
              error
            );
          }
        }
      } else {
        stopPresence.delete(key);
      }
    }
  }

  /* =========================================================
     GPS OFFLINE QUEUE + HISTORY
  ========================================================= */

  function makeGpsPayload(position) {
    const coords =
      position.coords;

    return {
      driver_user_id:
        user?.id ||
        null,

      company_id:
        companyId ||
        null,

      route_id:
        getCurrentDriverRouteId(),

      vehicle_id:
        getCurrentVehicleId(),

      driver_name:
        profile?.full_name ||
        user?.email ||
        "Driver",

      vehicle_name:
        getCurrentVehicleName() ||
        null,

      latitude:
        coords.latitude,

      longitude:
        coords.longitude,

      accuracy_m:
        Number.isFinite(
          coords.accuracy
        )
          ? coords.accuracy
          : null,

      speed_mps:
        Number.isFinite(
          coords.speed
        )
          ? coords.speed
          : null,

      heading:
        Number.isFinite(
          coords.heading
        )
          ? coords.heading
          : null,

      recorded_at:
        new Date(
          position.timestamp ||
          Date.now()
        ).toISOString()
    };
  }

  async function saveGpsHistoryOnline(
    payload
  ) {
    const {
      error
    } = await ensureDb()
      .from(
        "driver_location_history"
      )
      .insert(payload);

    if (error) {
      throw error;
    }
  }

  async function queueGpsPayload(
    payload
  ) {
    await idbAdd(
      OFFLINE_GPS_STORE,
      payload
    );

    updateOfflineQueueUi()
      .catch(() => {});
  }

  async function saveGpsHistory(
    payload
  ) {
    const now =
      Date.now();

    if (
      lastHistorySavedAt &&
      now -
        lastHistorySavedAt <
        GPS_HISTORY_INTERVAL_MS
    ) {
      return;
    }

    lastHistorySavedAt =
      now;

    if (!isOnline()) {
      await queueGpsPayload(
        payload
      );

      return;
    }

    try {
      await saveGpsHistoryOnline(
        payload
      );
    } catch (error) {
      console.warn(
        "[driver app] GPS history online save failed, queued:",
        error.message
      );

      await queueGpsPayload(
        payload
      );
    }
  }

  async function syncGpsQueue() {
    if (!isOnline()) {
      return;
    }

    const queue =
      await idbGetAll(
        OFFLINE_GPS_STORE
      );

    for (
      const item of queue
    ) {
      try {
        const payload = {
          driver_user_id:
            item.driver_user_id,

          company_id:
            item.company_id,

          route_id:
            item.route_id,

          vehicle_id:
            item.vehicle_id,

          driver_name:
            item.driver_name,

          vehicle_name:
            item.vehicle_name,

          latitude:
            item.latitude,

          longitude:
            item.longitude,

          accuracy_m:
            item.accuracy_m,

          speed_mps:
            item.speed_mps,

          heading:
            item.heading,

          recorded_at:
            item.recorded_at
        };

        await saveGpsHistoryOnline(
          payload
        );

        await idbDelete(
          OFFLINE_GPS_STORE,
          item.id
        );
      } catch (error) {
        console.warn(
          "[offline] GPS sync stopped:",
          error.message
        );

        break;
      }
    }

    await updateOfflineQueueUi();
  }

  /* =========================================================
     LIVE GPS LOCATION
  ========================================================= */

  async function saveDriverLocation(
    position
  ) {
    if (
      !user?.id ||
      !companyId
    ) {
      return;
    }

    const routeId =
      getCurrentDriverRouteId();

    if (!routeId) {
      return;
    }

    const coords =
      position.coords;

    // Presence is checked on every GPS callback,
    // not only every 30 sec database update.
    checkStopPresence(
      coords.latitude,
      coords.longitude
    ).catch(error =>
      console.warn(
        "[driver app] stop presence check failed:",
        error
      )
    );

    const historyPayload =
      makeGpsPayload(position);

    saveGpsHistory(
      historyPayload
    ).catch(error =>
      console.warn(
        "[driver app] GPS history failed:",
        error
      )
    );

    const now =
      Date.now();

    if (
      lastLocationSentAt &&
      now -
        lastLocationSentAt <
        LOCATION_SEND_INTERVAL_MS
    ) {
      return;
    }

    lastLocationSentAt =
      now;

    const timestamp =
      new Date().toISOString();

    const payload = {
      ...historyPayload,

      tracking_active:
        true,

      updated_at:
        timestamp,

      recorded_at:
        timestamp
    };

    if (!isOnline()) {
      console.log(
        "[driver app] Offline. Live marker update skipped; history queued locally."
      );

      return;
    }

    const {
      error
    } = await ensureDb()
      .from(
        "driver_live_locations"
      )
      .upsert(
        payload,
        {
          onConflict:
            "driver_user_id"
        }
      );

    if (error) {
      console.warn(
        "[driver app] location update failed:",
        error.message
      );
    }
  }

 function startLocationTracking() {
  console.log(
    "[driver app] startLocationTracking() called"
  );

  /*
   * Native iPhone app:
   *
   * GPS is handled by DriverLocationManager.swift.
   * Do NOT also start navigator.geolocation here,
   * otherwise we'd have two GPS trackers writing
   * history simultaneously.
   */
  if (hasNativeBridge()) {
    syncNativeTrackingContext()
      .catch(error =>
        console.warn(
          "[native bridge] Unable to start native tracking:",
          error
        )
      );

    return;
  }

  /*
   * Normal PWA / Android / browser:
   *
   * Keep existing browser GPS tracking.
   */
  if (!navigator.geolocation) {
    console.error(
      "[driver app] Geolocation is not supported."
    );

    alert(
      "Location services are not supported by this device or browser."
    );

    return;
  }

  if (
    locationWatchId !== null
  ) {
    return;
  }

  locationWatchId =
    navigator.geolocation
      .watchPosition(
        position => {
          console.log(
            "[driver app] GPS:",
            position.coords.latitude,
            position.coords.longitude,
            "speed:",
            position.coords.speed
          );

          saveDriverLocation(
            position
          ).catch(error =>
            console.warn(
              "[driver app] Location handling failed:",
              error
            )
          );
        },

        error => {
          console.error(
            "[driver app] GPS error:",
            error.code,
            error.message
          );

          if (
            error.code === 1
          ) {
            alert(
              "Location access is blocked. Please allow location access for Veynor in your phone settings."
            );
          }
        },

        {
          enableHighAccuracy:
            true,

          maximumAge:
            5000,

          timeout:
            20000
        }
      );
}

 async function stopLocationTracking() {

  /*
   * Native iPhone app.
   */
  if (hasNativeBridge()) {
    stopPresence.clear();

    stopNativeTracking();

    return;
  }

  /*
   * Normal PWA / Android / browser.
   */
  if (
    locationWatchId !== null
  ) {
    navigator.geolocation
      .clearWatch(
        locationWatchId
      );

    locationWatchId =
      null;
  }

  stopPresence.clear();

  if (
    !user?.id ||
    !isOnline()
  ) {
    return;
  }

  await ensureDb()
    .from(
      "driver_live_locations"
    )
    .update({
      tracking_active:
        false,

      updated_at:
        nowIso()
    })
    .eq(
      "driver_user_id",
      user.id
    );
}

  /* =========================================================
     LOAD ROUTES / STOPS
  ========================================================= */

  async function loadStops() {
    const cid =
      await getCompanyId();

    const currentEmail =
      norm(
        user?.email ||
        profile?.email ||
        ""
      );

    let routeQuery =
      ensureDb()
        .from("routes")
        .select("*")
        .eq(
          "company_id",
          cid
        )
        .in(
          "route_status",
          Array.from(
            ACTIVE_ROUTE_STATUSES
          )
        );

    if (
      !isAdminOrTenantUser() &&
      currentEmail
    ) {
      routeQuery =
        routeQuery.eq(
          "driver_email",
          currentEmail
        );
    }

    const {
      data: activeRoutes,
      error: routeError
    } = await routeQuery;

    if (routeError) {
      throw routeError;
    }

    const nextRoute =
      selectNextDriverRoute(
        activeRoutes || []
      );

    const routeRows =
      nextRoute
        ? [nextRoute]
        : [];

    const routeIds =
      routeRows
        .map(
          route => route.id
        )
        .filter(Boolean);

    if (!routeIds.length) {
      stops = [];

      renderAll();

      await stopLocationTracking();

      return;
    }

    const routesById =
      new Map(
        routeRows.map(
          route => [
            String(route.id),
            route
          ]
        )
      );

    const {
      data: rawStops,
      error
    } = await ensureDb()
      .from("route_stops")
      .select("*")
      .eq(
        "company_id",
        cid
      )
      .in(
        "route_id",
        routeIds
      )
      .order(
        "route_id",
        {
          ascending: true
        }
      )
      .order(
        "stop_number",
        {
          ascending: true,
          nullsFirst: false
        }
      );

    if (error) {
      throw error;
    }

    const stopRows =
      rawStops || [];

    const orderIds = [
      ...new Set(
        stopRows
          .map(
            stop =>
              stop.order_id
          )
          .filter(Boolean)
      )
    ];

    const ordersById =
      await fetchOrdersMap(
        orderIds
      );

    const lineCounts =
      await fetchLineCounts(
        orderIds
      );

    stops =
      stopRows
        .map(stop => ({
          ...stop,

          orders:
            ordersById.get(
              String(
                stop.order_id
              )
            ) ||
            {},

          routes:
            routesById.get(
              String(
                stop.route_id
              )
            ) ||
            {},

          __line_count:
            lineCounts.get(
              String(
                stop.order_id
              )
            ) ||
            0
        }))
        .filter(
          isStopForCurrentDriver
        )
        .filter(
          isStopVisibleInDriverApp
        )
        .sort(
          (a, b) => {
            const dateA =
              String(
                a.routes
                  ?.planned_delivery_date ||
                a.routes
                  ?.route_date ||
                ""
              );

            const dateB =
              String(
                b.routes
                  ?.planned_delivery_date ||
                b.routes
                  ?.route_date ||
                ""
              );

            if (
              dateA !==
              dateB
            ) {
              return dateA
                .localeCompare(
                  dateB
                );
            }

            const ra =
              String(
                getRouteCode(a)
              );

            const rb =
              String(
                getRouteCode(b)
              );

            if (
              ra !== rb
            ) {
              return ra.localeCompare(
                rb
              );
            }

            return (
              num(
                a.stop_number ||
                a.stop_sequence,
                9999
              ) -
              num(
                b.stop_number ||
                b.stop_sequence,
                9999
              )
            );
          }
        );

    renderAll();

    const openStops =
      stops.filter(
        isOpenForDriver
      );

    if (
      openStops.length > 0
    ) {
      startLocationTracking();
    } else {
      await stopLocationTracking();
    }
  }

  async function fetchOrdersMap(
    orderIds
  ) {
    const map =
      new Map();

    if (!orderIds.length) {
      return map;
    }

    const {
      data,
      error
    } = await ensureDb()
      .from("orders")
      .select(
        "*, customers(id, name)"
      )
      .in(
        "id",
        orderIds
      );

    if (error) {
      return map;
    }

    (data || [])
      .forEach(order =>
        map.set(
          String(order.id),
          order
        )
      );

    return map;
  }

  async function fetchLineCounts(
    orderIds
  ) {
    const map =
      new Map();

    if (!orderIds.length) {
      return map;
    }

    const {
      data,
      error
    } = await ensureDb()
      .from("order_lines")
      .select(
        "id, order_id"
      )
      .in(
        "order_id",
        orderIds
      );

    if (error) {
      return map;
    }

    (data || [])
      .forEach(line => {
        const key =
          String(
            line.order_id
          );

        map.set(
          key,
          (
            map.get(key) ||
            0
          ) + 1
        );
      });

    return map;
  }

  /* =========================================================
     TIME HELPERS
  ========================================================= */

  function getPlannedTime(stop) {
    return (
      stop?.planned_arrival_time ||
      stop?.arrival_eta ||
      stop?.eta ||
      stop?.planned_time ||
      stop?.delivery_eta_from ||
      getOrder(stop)
        ?.delivery_eta_from ||
      getOrder(stop)
        ?.planned_delivery_time ||
      ""
    );
  }

  function getDepartureTime(stop) {
    return (
      stop?.planned_departure_time ||
      stop?.departure_eta ||
      stop?.etd ||
      getOrder(stop)
        ?.delivery_eta_to ||
      ""
    );
  }

  function formatTime(value) {
    if (!value) return "";

    const s =
      String(value);

    if (
      /^\d{2}:\d{2}/
        .test(s)
    ) {
      return s.slice(0, 5);
    }

    const d =
      new Date(s);

    if (
      !Number.isNaN(
        d.getTime()
      )
    ) {
      return (
        `${String(
          d.getHours()
        ).padStart(2, "0")}:` +
        `${String(
          d.getMinutes()
        ).padStart(2, "0")}`
      );
    }

    return s;
  }

  function getDeliveredDate(stop) {
    return (
      stop?.delivery_date ||
      getOrder(stop)
        ?.expected_delivery_date ||
      getOrder(stop)
        ?.pod_signed_at ||
      stop?.completed_at ||
      ""
    );
  }

  function isTodayDate(value) {
    if (!value) {
      return false;
    }

    return (
      String(value)
        .slice(0, 10) ===
      today()
    );
  }

  function isThisWeekDate(value) {
    if (!value) {
      return false;
    }

    const d =
      new Date(value);

    if (
      Number.isNaN(
        d.getTime()
      )
    ) {
      return false;
    }

    const now =
      new Date();

    const diff =
      now.getTime() -
      d.getTime();

    return (
      diff >= 0 &&
      diff <=
        7 *
        24 *
        60 *
        60 *
        1000
    );
  }

  /* =========================================================
     RENDER
  ========================================================= */

  function renderAll() {
    renderKpis();
    renderRoutesTimeline();
    renderOpenStops();
    renderDeliveredStops();
    renderIssues();
  }

  function renderKpis() {
    const delivered =
      stops.filter(
        stop =>
          !isOpenForDriver(stop)
      ).length;

    const open =
      stops.filter(
        isOpenForDriver
      ).length;

    if ($("kpiStops")) {
      $("kpiStops")
        .textContent =
        String(stops.length);
    }

    if ($("kpiDelivered")) {
      $("kpiDelivered")
        .textContent =
        String(delivered);
    }

    if ($("kpiOpen")) {
      $("kpiOpen")
        .textContent =
        String(open);
    }
  }

  function renderRoutesTimeline() {
    const mount =
      $("routesTimeline");

    if (!mount) return;

    const openStops =
      stops.filter(
        isOpenForDriver
      );

    if (!openStops.length) {
      mount.innerHTML = "";
      return;
    }

    const grouped =
      new Map();

    openStops
      .forEach(stop => {
        const key =
          getRouteCode(stop);

        if (
          !grouped.has(key)
        ) {
          grouped.set(
            key,
            []
          );
        }

        grouped
          .get(key)
          .push(stop);
      });

    mount.innerHTML =
      [...grouped.entries()]
        .map(
          ([routeCode, list]) => {
            const volume =
              list.reduce(
                (sum, stop) =>
                  sum +
                  num(
                    getOrder(stop)
                      .planning_volume_m3 ||
                    stop
                      .planned_volume_m3
                  ),
                0
              );

            const colli =
              list.reduce(
                (sum, stop) =>
                  sum +
                  num(
                    getOrder(stop)
                      .planning_colli ||
                    stop
                      .planned_colli
                  ),
                0
              );

            const first =
              list[0];

            const driver =
              first
                ?.routes
                ?.driver_name ||
              getOrder(first)
                ?.driver_name ||
              "Driver";

            return `
              <article class="timeline-card">
                <div class="stop-head">
                  <div>
                    <div class="stop-title">
                      ${esc(routeCode)}
                    </div>

                    <div class="stop-sub">
                      ${esc(driver)} ·
                      ${list.length}
                      stop${list.length === 1 ? "" : "s"} ·
                      ${colli} colli ·
                      ${volume.toFixed(2)} m³
                    </div>
                  </div>

                  <span class="pill planned">
                    Active
                  </span>
                </div>
              </article>
            `;
          }
        )
        .join("");
  }

  function renderOpenStops() {
    renderStopList(
      "stopsList",
      stops.filter(
        isOpenForDriver
      ),
      "open"
    );
  }

  function renderDeliveredStops() {
    let list =
      stops.filter(
        isDelivered
      );

    if (
      deliveredFilter ===
      "today"
    ) {
      list =
        list.filter(
          stop =>
            isTodayDate(
              getDeliveredDate(
                stop
              )
            )
        );
    }

    if (
      deliveredFilter ===
      "week"
    ) {
      list =
        list.filter(
          stop =>
            isThisWeekDate(
              getDeliveredDate(
                stop
              )
            )
        );
    }

    renderStopList(
      "deliveredList",
      list,
      "delivered"
    );
  }

  function renderIssues() {
    let list =
      stops.filter(
        isIssue
      );

    if (
      issueFilter !==
      "all"
    ) {
      list =
        list.filter(
          stop =>
            statusOf(stop) ===
            issueFilter
        );
    }

    renderStopList(
      "issuesList",
      list,
      "issues"
    );
  }

  function renderStopList(
    mountId,
    list,
    mode
  ) {
    const mount =
      $(mountId);

    if (!mount) return;

    if (!list.length) {
      const text =
        mode ===
        "delivered"
          ? "No delivered stops found."
          : mode ===
            "issues"
          ? "No delivery issues found."
          : "No open stops found.";

      mount.innerHTML =
        `<section class="card">
          <p class="muted">
            ${text}
          </p>
        </section>`;

      return;
    }

    mount.innerHTML =
      list
        .map(
          stop =>
            renderStopCard(stop)
        )
        .join("");

    mount
      .querySelectorAll(
        "[data-pod]"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          () =>
            selectStop(
              btn.dataset.pod
            )
        );
      });

    mount
      .querySelectorAll(
        "[data-nav]"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          () => {
            const stop =
              stops.find(
                s =>
                  String(s.id) ===
                  String(
                    btn.dataset.nav
                  )
              );

            const q =
              encodeURIComponent(
                getOrderAddress(
                  getOrder(stop),
                  stop
                )
              );

            if (!q) {
              return alert(
                "No address available for this stop."
              );
            }

            window.open(
              "https://www.google.com/maps/search/?api=1&query=" +
                q,
              "_blank"
            );
          }
        );
      });

    mount
      .querySelectorAll(
        "[data-pdf]"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          () => {
            const stop =
              stops.find(
                s =>
                  String(s.id) ===
                  String(
                    btn.dataset.pdf
                  )
              );

            const url =
              getOrder(stop)
                ?.pod_document_url ||
              "";

            if (!url) {
              return alert(
                "No POD PDF available yet."
              );
            }

            window.open(
              url,
              "_blank"
            );
          }
        );
      });
  }

  function renderStopCard(stop) {
    const order =
      getOrder(stop);

    const status =
      statusOf(stop);

    const addr =
      getOrderAddress(
        order,
        stop
      );

    const routeCode =
      getRouteCode(stop);

    const stopNo =
      stop.stop_number ||
      stop.stop_sequence ||
      "";

    const lineCount =
      stop.__line_count ||
      0;

    const planned =
      formatTime(
        getPlannedTime(stop)
      );

    const departure =
      formatTime(
        getDepartureTime(stop)
      );

    const completed =
      formatTime(
        stop.delivery_time ||
        stop.completed_at ||
        order.pod_signed_at
      );

    const timeText =
      isDelivered(stop)
        ? completed
          ? `Delivered ${completed}`
          : "Delivered"
        : planned &&
          departure
        ? `${planned} - ${departure}`
        : planned
        ? `Planned ${planned}`
        : "No planned time";

    const actionLabel =
      isDelivered(stop)
        ? "View / Edit POD"
        : "Open POD";

    return `
      <article class="card stop-card">
        <div class="stop-head">
          <div>

            <div class="stop-title">
              ${esc(
                order.order_number ||
                stop.order_number ||
                "Stop"
              )}
            </div>

            <div class="stop-sub">
              ${esc(
                getRetailerName(
                  order,
                  stop
                )
              )}
            </div>

            <div class="stop-sub">
              ${esc(
                addr ||
                "No address"
              )}
            </div>

            <div class="stop-sub">
              ${esc(
                routeCode
                  ? routeCode +
                    " · "
                  : ""
              )}

              ${esc(
                stopNo
                  ? "Stop " +
                    stopNo +
                    " · "
                  : ""
              )}

              ${esc(timeText)}
            </div>

            <div class="stop-sub">
              ${esc(
                order.planning_colli ||
                stop.planned_colli ||
                0
              )}
              colli ·

              ${esc(
                order.planning_volume_m3 ||
                stop.planned_volume_m3 ||
                0
              )}
              m³ ·

              ${esc(lineCount)}
              product line${lineCount === 1 ? "" : "s"}
            </div>

          </div>

          <span class="pill ${esc(status)}">
            ${esc(
              status.replaceAll(
                "_",
                " "
              )
            )}
          </span>
        </div>

        <div class="stop-actions">

          ${
            isDelivered(stop)
              ? `
                <button
                  class="btn"
                  data-pdf="${esc(stop.id)}"
                  type="button">
                  Open PDF
                </button>
              `
              : `
                <button
                  class="btn"
                  data-nav="${esc(stop.id)}"
                  type="button">
                  Navigate
                </button>
              `
          }

          <button
            class="btn primary"
            data-pod="${esc(stop.id)}"
            type="button">
            ${esc(actionLabel)}
          </button>

        </div>
      </article>
    `;
  }

  /* =========================================================
     ORDER LINES
  ========================================================= */

  function getLineSku(line) {
    return (
      line.sku_base ||
      line.product_sku ||
      line.sku ||
      line.item_code ||
      line.products
        ?.sku_base ||
      line.product_id ||
      "—"
    );
  }

  function getLineDescription(line) {
    return (
      line.description ||
      line.product_name ||
      line.item_name ||
      line.name ||
      line.products
        ?.description ||
      line.products
        ?.name ||
      line.notes ||
      "—"
    );
  }

  function getLineQty(line) {
    return num(
      line.quantity_ordered ??
      line.qty ??
      line.ordered_qty ??
      0
    );
  }

  function getLineVolume(line) {
    const explicit =
      num(
        line.total_line_volume_m3,
        0
      ) ||
      num(
        line.total_volume_m3,
        0
      ) ||
      num(
        line.volume_m3,
        0
      );

    if (explicit > 0) {
      return explicit;
    }

    return (
      getLineQty(line) *
      (
        num(
          line.unit_volume_m3,
          0
        ) ||
        num(
          line.products
            ?.volume_m3,
          0
        )
      )
    );
  }

  async function fetchOrderLines(
    orderId
  ) {
    const {
      data,
      error
    } = await ensureDb()
      .from("order_lines")
      .select(
        "*, products(id, sku_base, name, description, volume_m3)"
      )
      .eq(
        "order_id",
        orderId
      )
      .order(
        "line_number",
        {
          ascending: true,
          nullsFirst: false
        }
      );

    if (!error) {
      return data || [];
    }

    const fallback =
      await ensureDb()
        .from("order_lines")
        .select("*")
        .eq(
          "order_id",
          orderId
        )
        .order(
          "line_number",
          {
            ascending: true,
            nullsFirst: false
          }
        );

    if (fallback.error) {
      throw fallback.error;
    }

    return (
      fallback.data || []
    );
  }

  async function fetchExistingPodLines(
    orderId,
    routeStopId
  ) {
    let query =
      ensureDb()
        .from(
          "order_pod_lines"
        )
        .select("*")
        .eq(
          "order_id",
          orderId
        );

    if (routeStopId) {
      query =
        query.eq(
          "route_stop_id",
          routeStopId
        );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      return [];
    }

    return data || [];
  }

  function makeDefaultPodLine(line) {
    const qty =
      getLineQty(line);

    return {
      order_line_id:
        line.id ||
        null,

      sku:
        getLineSku(line),

      description:
        getLineDescription(line),

      ordered_qty:
        qty,

      delivered_qty:
        qty,

      missing_qty:
        0,

      line_status:
        "delivered",

      note:
        "",

      original_volume_m3:
        getLineVolume(line)
    };
  }

  function makePodLineFromExisting(row) {
    return {
      id:
        row.id ||
        null,

      order_line_id:
        row.order_line_id ||
        null,

      sku:
        row.sku ||
        "—",

      description:
        row.description ||
        "—",

      ordered_qty:
        num(
          row.ordered_qty
        ),

      delivered_qty:
        num(
          row.delivered_qty
        ),

      missing_qty:
        num(
          row.missing_qty
        ),

      line_status:
        row.line_status ||
        "delivered",

      note:
        row.note ||
        "",

      original_volume_m3:
        num(
          row.original_volume_m3
        )
    };
  }

  function normalizeLineAfterStatus(line) {
    const ordered =
      num(
        line.ordered_qty
      );

    let delivered =
      Math.max(
        0,
        Math.min(
          ordered,
          num(
            line.delivered_qty
          )
        )
      );

    let status =
      norm(
        line.line_status ||
        "delivered"
      );

    if (
      status ===
      "delivered"
    ) {
      delivered =
        ordered;
    }

    if (
      status ===
        "missing" ||
      status ===
        "refused"
    ) {
      delivered = 0;
    }

    if (
      status ===
      "damaged"
    ) {
      delivered =
        ordered;
    }

    if (
      status ===
      "partial"
    ) {
      if (
        ordered <= 1
      ) {
        delivered = 0;
      } else if (
        delivered >=
        ordered
      ) {
        delivered =
          ordered - 1;
      } else if (
        delivered <= 0
      ) {
        delivered = 1;
      }
    }

    const missing =
      Math.max(
        0,
        ordered -
        delivered
      );

    if (
      status ===
        "delivered" &&
      missing > 0
    ) {
      status =
        "partial";
    }

    return {
      ...line,
      delivered_qty:
        delivered,

      missing_qty:
        missing,

      line_status:
        status
    };
  }

  /* =========================================================
     POD PRODUCT UI
  ========================================================= */

  function ensurePodLinesBox() {
    if ($("podLinesList")) {
      return;
    }

    const photosLabel =
      $("podPhotos")
        ?.closest(
          "label"
        );

    const notesLabel =
      $("podNotes")
        ?.closest(
          "label"
        );

    const parentCard =
      $("savePodBtn")
        ?.closest(
          ".pod-card"
        ) ||
      $("savePodBtn")
        ?.closest(
          ".card"
        );

    if (!parentCard) {
      return;
    }

    const box =
      document.createElement(
        "div"
      );

    box.id =
      "podLinesBox";

    box.className =
      "pod-lines-box";

    box.innerHTML = `
      <h3>
        Products to deliver
      </h3>

      <p class="muted">
        Everything is marked as delivered by default.
        Change exceptions only.
      </p>

      <div
        id="podLinesList"
        class="list compact-list">
      </div>
    `;

    if (photosLabel) {
      parentCard.insertBefore(
        box,
        photosLabel
      );
    } else if (
      notesLabel
    ) {
      parentCard.insertBefore(
        box,
        notesLabel.nextSibling
      );
    } else {
      parentCard.insertBefore(
        box,
        $("savePodBtn")
      );
    }
  }

  async function selectStop(id) {
    selectedStop =
      stops.find(
        s =>
          String(s.id) ===
          String(id)
      ) ||
      null;

    selectedPodLines =
      [];

    pendingPodPhotos =
      [];

    if (!selectedStop) {
      return;
    }

    switchTab("pod");

    setTimeout(
      () =>
        signaturePad
          ?.resize(),
      150
    );

    clearNotice(
      $("podMessage")
    );

    ensurePodLinesBox();

    const order =
      getOrder(
        selectedStop
      );

    const orderId =
      getOrderId(
        selectedStop
      );

    let existingPodLines =
      [];

    let orderLines =
      [];

    if (orderId) {
      existingPodLines =
        await fetchExistingPodLines(
          orderId,
          selectedStop.id
        );

      orderLines =
        await fetchOrderLines(
          orderId
        );
    }

    selectedPodLines =
      existingPodLines.length
        ? existingPodLines.map(
            makePodLineFromExisting
          )
        : orderLines.map(
            makeDefaultPodLine
          );

    if (
      $("podSelectedStop")
    ) {
      $("podSelectedStop")
        .textContent =
        `${order.order_number ||
          selectedStop.order_number ||
          "Stop"} · ` +
        `${getRetailerName(
          order,
          selectedStop
        )} · ` +
        `${selectedPodLines.length} product line` +
        `${selectedPodLines.length === 1 ? "" : "s"}`;
    }

    if ($("deliveredTo")) {
      $("deliveredTo")
        .value =
        selectedStop.delivered_to ||
        order.pod_signed_by ||
        "";
    }

    if ($("podNotes")) {
      $("podNotes")
        .value =
        selectedStop.pod_notes ||
        "";
    }

    if ($("podPhotos")) {
      $("podPhotos")
        .value =
        "";
    }

    if ($("podCameraInput")) {
      $("podCameraInput")
        .value =
        "";
    }

    if ($("podStatus")) {
      $("podStatus")
        .value =
        selectedStop.delivery_status ||
        "delivered";
    }

    signaturePad
      ?.clear();

    updatePodPhotoUi();
    renderPodLines();
  }

  function renderPodLines() {
    ensurePodLinesBox();

    const mount =
      $("podLinesList");

    if (!mount) {
      return;
    }

    if (
      !selectedPodLines.length
    ) {
      mount.innerHTML = `
        <section class="card">
          <p class="muted">
            No product lines found for this order.
          </p>
        </section>
      `;

      return;
    }

    selectedPodLines =
      selectedPodLines.map(
        normalizeLineAfterStatus
      );

    const totalOrdered =
      selectedPodLines.reduce(
        (sum, line) =>
          sum +
          num(
            line.ordered_qty
          ),
        0
      );

    const totalDelivered =
      selectedPodLines.reduce(
        (sum, line) =>
          sum +
          num(
            line.delivered_qty
          ),
        0
      );

    const exceptionCount =
      selectedPodLines.filter(
        line =>
          norm(
            line.line_status
          ) !==
            "delivered" ||
          num(
            line.missing_qty
          ) > 0
      ).length;

    mount.innerHTML = `
      <section class="card product-summary-card">
        <strong>
          ${selectedPodLines.length}
          product lines
        </strong>

        <span class="stop-sub">
          Ordered ${totalOrdered} ·
          Delivered ${totalDelivered} ·
          Exceptions ${exceptionCount}
        </span>

        <button
          class="btn"
          id="markAllDeliveredBtn"
          type="button">
          Mark all delivered
        </button>
      </section>

      ${selectedPodLines
        .map(
          (line, index) => {
            const status =
              norm(
                line.line_status ||
                "delivered"
              );

            const hasIssue =
              status !==
                "delivered" ||
              num(
                line.missing_qty
              ) > 0;

            const checked =
              status ===
                "delivered" &&
              num(
                line.delivered_qty
              ) >=
                num(
                  line.ordered_qty
                );

            return `
              <article
                class="card stop-card ${hasIssue ? "pod-line-issue" : ""}">

                <div class="stop-head">
                  <div>

                    <div class="stop-title">
                      ${esc(line.sku)}
                    </div>

                    <div class="stop-sub">
                      ${esc(line.description)}
                    </div>

                    <div class="stop-sub">
                      Ordered:
                      ${esc(line.ordered_qty)}
                      · Delivered:
                      ${esc(line.delivered_qty)}
                      · Manco:
                      ${esc(line.missing_qty)}
                    </div>

                  </div>

                  <span
                    class="pill ${hasIssue ? "failed" : "delivered"}">
                    ${esc(
                      status.replaceAll(
                        "_",
                        " "
                      )
                    )}
                  </span>
                </div>

                <label class="pod-checkline">
                  <input
                    type="checkbox"
                    class="pod-line-check"
                    data-line-index="${index}"
                    ${checked ? "checked" : ""}
                  />

                  <span>
                    Delivered complete
                  </span>
                </label>

                <div class="grid2">

                  <label>
                    Delivered qty

                    <input
                      class="input pod-line-delivered"
                      data-line-index="${index}"
                      type="number"
                      min="0"
                      max="${esc(line.ordered_qty)}"
                      step="1"
                      value="${esc(line.delivered_qty)}"
                    />
                  </label>

                  <label>
                    Status

                    <select
                      class="input pod-line-status"
                      data-line-index="${index}">

                      <option
                        value="delivered"
                        ${status === "delivered" ? "selected" : ""}>
                        Delivered
                      </option>

                      <option
                        value="partial"
                        ${status === "partial" ? "selected" : ""}>
                        Partial / Manco
                      </option>

                      <option
                        value="missing"
                        ${status === "missing" ? "selected" : ""}>
                        Missing
                      </option>

                      <option
                        value="damaged"
                        ${status === "damaged" ? "selected" : ""}>
                        Damaged
                      </option>

                      <option
                        value="refused"
                        ${status === "refused" ? "selected" : ""}>
                        Refused
                      </option>

                    </select>
                  </label>

                </div>

                <label>
                  Line note / exception

                  <input
                    class="input pod-line-note"
                    data-line-index="${index}"
                    value="${esc(line.note)}"
                    placeholder="Damage, missing item, refused..."
                  />
                </label>

              </article>
            `;
          }
        )
        .join("")}
    `;

    $("markAllDeliveredBtn")
      ?.addEventListener(
        "click",
        () => {
          selectedPodLines =
            selectedPodLines.map(
              line => ({
                ...line,

                delivered_qty:
                  line.ordered_qty,

                missing_qty:
                  0,

                line_status:
                  "delivered",

                note:
                  ""
              })
            );

          renderPodLines();
        }
      );

    mount
      .querySelectorAll(
        ".pod-line-check"
      )
      .forEach(input => {
        input.addEventListener(
          "change",
          () => {
            const i =
              Number(
                input.dataset
                  .lineIndex
              );

            const line =
              selectedPodLines[i];

            if (!line) {
              return;
            }

            selectedPodLines[i] =
              input.checked
                ? {
                    ...line,

                    delivered_qty:
                      line.ordered_qty,

                    missing_qty:
                      0,

                    line_status:
                      "delivered"
                  }
                : {
                    ...line,

                    delivered_qty:
                      0,

                    missing_qty:
                      line.ordered_qty,

                    line_status:
                      "missing"
                  };

            renderPodLines();
          }
        );
      });

    mount
      .querySelectorAll(
        ".pod-line-delivered"
      )
      .forEach(input => {
        input.addEventListener(
          "change",
          () => {
            const i =
              Number(
                input.dataset
                  .lineIndex
              );

            const line =
              selectedPodLines[i];

            if (!line) {
              return;
            }

            const ordered =
              num(
                line.ordered_qty
              );

            const delivered =
              Math.max(
                0,
                Math.min(
                  ordered,
                  num(
                    input.value
                  )
                )
              );

            let status =
              "delivered";

            if (
              delivered <= 0
            ) {
              status =
                "missing";
            } else if (
              delivered <
              ordered
            ) {
              status =
                "partial";
            }

            selectedPodLines[i] =
              normalizeLineAfterStatus({
                ...line,

                delivered_qty:
                  delivered,

                missing_qty:
                  Math.max(
                    0,
                    ordered -
                    delivered
                  ),

                line_status:
                  status
              });

            renderPodLines();
          }
        );
      });

    mount
      .querySelectorAll(
        ".pod-line-status"
      )
      .forEach(input => {
        input.addEventListener(
          "change",
          () => {
            const i =
              Number(
                input.dataset
                  .lineIndex
              );

            const line =
              selectedPodLines[i];

            if (!line) {
              return;
            }

            selectedPodLines[i] =
              normalizeLineAfterStatus({
                ...line,

                line_status:
                  input.value
              });

            renderPodLines();
          }
        );
      });

    mount
      .querySelectorAll(
        ".pod-line-note"
      )
      .forEach(input => {
        input.addEventListener(
          "input",
          () => {
            const i =
              Number(
                input.dataset
                  .lineIndex
              );

            if (
              selectedPodLines[i]
            ) {
              selectedPodLines[i]
                .note =
                input.value.trim();
            }
          }
        );
      });
  }

  /* =========================================================
     PHOTO FLOW
  ========================================================= */

  function updatePodPhotoUi() {
    const count =
      pendingPodPhotos.length;

    const status =
      $("podPhotoStatus");

    const actions =
      $("podPhotoActions");

    const takeAnotherBtn =
      $("takeAnotherPhotoBtn");

    if (status) {
      status.textContent =
        count === 0
          ? "No photos added"
          : `${count} of ${MAX_POD_PHOTOS} photos added`;
    }

    if (actions) {
      actions.classList.toggle(
        "hidden",
        count === 0
      );
    }

    if (takeAnotherBtn) {
      takeAnotherBtn.classList.toggle(
        "hidden",
        count >=
          MAX_POD_PHOTOS
      );
    }
  }

  function addPodPhotos(files) {
    const incoming =
      Array.from(
        files ||
        []
      );

    for (
      const file of incoming
    ) {
      if (
        pendingPodPhotos.length >=
        MAX_POD_PHOTOS
      ) {
        break;
      }

      pendingPodPhotos.push(
        file
      );
    }

    updatePodPhotoUi();
  }

  function setupPodPhotos() {
    const picker =
      $("podPhotos");

    const camera =
      $("podCameraInput");

    picker
      ?.addEventListener(
        "change",
        () => {
          addPodPhotos(
            picker.files
          );

          picker.value = "";
        }
      );

    camera
      ?.addEventListener(
        "change",
        () => {
          addPodPhotos(
            camera.files
          );

          camera.value = "";
        }
      );

    $("takeAnotherPhotoBtn")
      ?.addEventListener(
        "click",
        () => {
          if (
            pendingPodPhotos.length >=
            MAX_POD_PHOTOS
          ) {
            return;
          }

          camera?.click();
        }
      );

    $("finishPhotosBtn")
      ?.addEventListener(
        "click",
        () => {
          $("podPhotoActions")
            ?.classList
            .add("hidden");
        }
      );

    updatePodPhotoUi();
  }

  /* =========================================================
     POD FILE UPLOAD
  ========================================================= */

  function safeFilePart(value) {
    return String(
      value || ""
    )
      .trim()
      .replace(
        /[^a-zA-Z0-9-_]/g,
        "-"
      )
      .replace(
        /-+/g,
        "-"
      )
      .replace(
        /^-|-$/g,
        ""
      ) ||
      "file";
  }

  function getPodBasePath(stop) {
    const order =
      getOrder(stop);

    const cid =
      stop.company_id ||
      order.company_id ||
      companyId;

    const oid =
      getOrderId(stop);

    if (!cid) {
      throw new Error(
        "Missing company_id for POD upload."
      );
    }

    if (!oid) {
      throw new Error(
        "Missing order_id for POD upload."
      );
    }

    return `${cid}/${oid}`;
  }

  async function compressImageFile(file) {
    if (
      !file ||
      !file.type.startsWith(
        "image/"
      )
    ) {
      return file;
    }

    const imageUrl =
      URL.createObjectURL(
        file
      );

    try {
      const img =
        await new Promise(
          (resolve, reject) => {
            const image =
              new Image();

            image.onload =
              () =>
                resolve(image);

            image.onerror =
              reject;

            image.src =
              imageUrl;
          }
        );

      const scale =
        Math.min(
          1,
          POD_PHOTO_MAX_SIZE /
            Math.max(
              img.width,
              img.height
            )
        );

      const width =
        Math.max(
          1,
          Math.round(
            img.width *
            scale
          )
        );

      const height =
        Math.max(
          1,
          Math.round(
            img.height *
            scale
          )
        );

      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        width;

      canvas.height =
        height;

      canvas
        .getContext("2d")
        .drawImage(
          img,
          0,
          0,
          width,
          height
        );

      const blob =
        await new Promise(
          resolve =>
            canvas.toBlob(
              resolve,
              "image/jpeg",
              POD_PHOTO_QUALITY
            )
        );

      if (!blob) {
        return file;
      }

      return new File(
        [blob],

        `${safeFilePart(
          file.name.replace(
            /\.[^.]+$/,
            ""
          )
        )}.jpg`,

        {
          type:
            "image/jpeg",

          lastModified:
            Date.now()
        }
      );
    } finally {
      URL.revokeObjectURL(
        imageUrl
      );
    }
  }

  async function insertPodAsset(
    stop,
    asset
  ) {
    const order =
      getOrder(stop);

    const { error } =
      await ensureDb()
        .from(
          "order_pod_assets"
        )
        .insert({
          company_id:
            stop.company_id ||
            order.company_id ||
            companyId,

          order_id:
            getOrderId(stop),

          route_id:
            getRouteId(stop),

          route_stop_id:
            stop.id,

          asset_type:
            asset.asset_type,

          file_name:
            asset.file_name ||
            null,

          file_url:
            asset.file_url ||
            null,

          storage_path:
            asset.storage_path ||
            null,

          mime_type:
            asset.mime_type ||
            null,

          notes:
            asset.notes ||
            null,

          captured_by:
            user?.id ||
            null,

          captured_by_name:
            order.driver_name ||
            stop.driver_name ||
            profile?.full_name ||
            user?.email ||
            null,

          captured_at:
            nowIso()
        });

    if (error) {
      console.warn(
        "[driver app] order_pod_assets insert skipped:",
        error.message
      );
    }
  }

  async function uploadPodPhotos(
    stop,
    fileList
  ) {
    const incoming =
      Array.from(
        fileList ||
        []
      );

    const existingPhotos =
      Array.isArray(
        stop.delivery_photos
      )
        ? stop.delivery_photos
        : [];

    const remainingSlots =
      Math.max(
        0,
        MAX_POD_PHOTOS -
          existingPhotos.length
      );

    if (
      incoming.length >
      remainingSlots
    ) {
      throw new Error(
        `Maximum ${MAX_POD_PHOTOS} POD photos per order.`
      );
    }

    const basePath =
      getPodBasePath(stop);

    const urls =
      [];

    for (
      let i = 0;
      i < incoming.length;
      i++
    ) {
      const originalFile =
        incoming[i];

      const compressedFile =
        await compressImageFile(
          originalFile
        );

      const fileName =
        `delivery-photo-${Date.now()}-${i + 1}.jpg`;

      const path =
        `${basePath}/photos/${fileName}`;

      const { error } =
        await ensureDb()
          .storage
          .from(POD_BUCKET)
          .upload(
            path,
            compressedFile,
            {
              cacheControl:
                "3600",

              upsert:
                false,

              contentType:
                "image/jpeg"
            }
          );

      if (error) {
        throw error;
      }

      const { data } =
        ensureDb()
          .storage
          .from(POD_BUCKET)
          .getPublicUrl(
            path
          );

      const publicUrl =
        data?.publicUrl ||
        "";

      if (publicUrl) {
        urls.push(
          publicUrl
        );

        await insertPodAsset(
          stop,
          {
            asset_type:
              "photo",

            file_name:
              fileName,

            file_url:
              publicUrl,

            storage_path:
              path,

            mime_type:
              "image/jpeg",

            notes:
              `Compressed POD photo. Original: ${originalFile.name || "photo"}`
          }
        );
      }
    }

    return urls;
  }

  async function uploadSignature(
    stop,
    dataUrl
  ) {
    if (!dataUrl) {
      return null;
    }

    const response =
      await fetch(dataUrl);

    const blob =
      await response.blob();

    const basePath =
      getPodBasePath(stop);

    const fileName =
      "customer-signature.png";

    const path =
      `${basePath}/signatures/${fileName}`;

    const { error } =
      await ensureDb()
        .storage
        .from(POD_BUCKET)
        .upload(
          path,
          blob,
          {
            contentType:
              "image/png",

            upsert:
              true
          }
        );

    if (error) {
      throw error;
    }

    const { data } =
      ensureDb()
        .storage
        .from(POD_BUCKET)
        .getPublicUrl(
          path
        );

    const publicUrl =
      data?.publicUrl ||
      null;

    if (publicUrl) {
      await insertPodAsset(
        stop,
        {
          asset_type:
            "signature",

          file_name:
            fileName,

          file_url:
            publicUrl,

          storage_path:
            path,

          mime_type:
            "image/png"
        }
      );
    }

    return publicUrl;
  }

  /* =========================================================
     POD DATABASE
  ========================================================= */

  async function savePodLinesFromPayload(
    stop,
    podLines
  ) {
    const order =
      getOrder(stop);

    const orderId =
      getOrderId(stop);

    const routeId =
      getRouteId(stop);

    if (
      !orderId ||
      !podLines.length
    ) {
      throw new Error(
        "No product lines available to save."
      );
    }

    await ensureDb()
      .from(
        "order_pod_lines"
      )
      .delete()
      .eq(
        "order_id",
        orderId
      )
      .eq(
        "route_stop_id",
        stop.id
      );

    const payload =
      podLines.map(
        rawLine => {
          const line =
            normalizeLineAfterStatus(
              rawLine
            );

          return {
            company_id:
              stop.company_id ||
              order.company_id ||
              companyId,

            order_id:
              orderId,

            order_line_id:
              line.order_line_id ||
              null,

            route_id:
              routeId ||
              null,

            route_stop_id:
              stop.id,

            sku:
              line.sku,

            description:
              line.description,

            ordered_qty:
              num(
                line.ordered_qty
              ),

            delivered_qty:
              num(
                line.delivered_qty
              ),

            missing_qty:
              Math.max(
                0,
                num(
                  line.ordered_qty
                ) -
                num(
                  line.delivered_qty
                )
              ),

            line_status:
              line.line_status ||
              "delivered",

            note:
              line.note ||
              null,

            original_volume_m3:
              num(
                line.original_volume_m3
              ),

            updated_at:
              nowIso()
          };
        }
      );

    const { error } =
      await ensureDb()
        .from(
          "order_pod_lines"
        )
        .insert(
          payload
        );

    if (error) {
      throw error;
    }
  }

  function getExceptionLines(
    podLines =
      selectedPodLines
  ) {
    return podLines.filter(
      line =>
        norm(
          line.line_status
        ) !==
          "delivered" ||
        num(
          line.missing_qty
        ) > 0
    );
  }

  function deriveFinalStatus(
    selectedStatus,
    podLines =
      selectedPodLines
  ) {
    const exceptions =
      getExceptionLines(
        podLines
      );

    if (
      selectedStatus ===
      "failed"
    ) {
      return "failed_delivery";
    }

    if (
      selectedStatus ===
      "refused"
    ) {
      return "delivery_issue";
    }

    if (
      exceptions.some(
        line =>
          norm(
            line.line_status
          ) ===
          "damaged"
      )
    ) {
      return "delivery_issue";
    }

    if (
      exceptions.some(
        line =>
          [
            "missing",
            "partial",
            "refused"
          ].includes(
            norm(
              line.line_status
            )
          )
      )
    ) {
      return "delivery_issue";
    }

    return "delivered";
  }

  function podStatusFromFinalStatus(
    finalStatus,
    originalPodStatus
  ) {
    if (
      finalStatus ===
      "delivered"
    ) {
      return "signed";
    }

    if (
      originalPodStatus ===
      "failed"
    ) {
      return "failed";
    }

    if (
      originalPodStatus ===
      "refused"
    ) {
      return "refused";
    }

    return "partial";
  }

  async function createActivityLog(
    stop,
    status,
    deliveredTo,
    photoCount,
    podLines
  ) {
    const order =
      getOrder(stop);

    const orderId =
      getOrderId(stop);

    if (!orderId) {
      return;
    }

    const exceptions =
      getExceptionLines(
        podLines
      );

    const { error } =
      await ensureDb()
        .from(
          "order_activity_log"
        )
        .insert({
          company_id:
            stop.company_id ||
            order.company_id ||
            companyId,

          customer_id:
            order.customer_id ||
            null,

          order_id:
            orderId,

          activity_type:
            "pod_completed",

          old_status:
            order.status ||
            null,

          new_status:
            status,

          description:
            `POD completed by driver. Signed by ${deliveredTo || "unknown receiver"}. Photos: ${photoCount}. Exceptions: ${exceptions.length}.`,

          created_by:
            user?.id ||
            "driver"
        });

    if (error) {
      console.warn(
        "[driver app] activity log skipped:",
        error.message
      );
    }
  }

  async function updateRouteStatusAfterPod(
    routeId
  ) {
    if (!routeId) {
      return;
    }

    const {
      data,
      error
    } = await ensureDb()
      .from("route_stops")
      .select(
        "status, delivery_status"
      )
      .eq(
        "route_id",
        routeId
      );

    if (error) {
      return;
    }

    const statuses =
      (data || [])
        .map(
          row =>
            norm(
              row.delivery_status ||
              row.status ||
              "planned"
            )
        );

    let routeStatus =
      "out_for_delivery";

    if (
      statuses.length &&
      statuses.every(
        status =>
          status ===
            "delivered" ||
          status ===
            "signed"
      )
    ) {
      routeStatus =
        "delivered";
    } else if (
      statuses.some(
        status =>
          [
            "failed_delivery",
            "failed"
          ].includes(
            status
          )
      )
    ) {
      routeStatus =
        "failed_delivery";
    } else if (
      statuses.some(
        status =>
          [
            "delivery_issue",
            "partial",
            "damaged",
            "refused"
          ].includes(
            status
          )
      )
    ) {
      routeStatus =
        "delivery_issue";
    }

    await ensureDb()
      .from("routes")
      .update({
        route_status:
          routeStatus
      })
      .eq(
        "id",
        routeId
      );
  }

  /* =========================================================
     OFFLINE POD
  ========================================================= */

  async function makeOfflinePodPayload() {
    if (!selectedStop) {
      throw new Error(
        "Select a stop first."
      );
    }

    selectedPodLines =
      selectedPodLines.map(
        normalizeLineAfterStatus
      );

    const originalPodStatus =
      $("podStatus")
        ?.value ||
      "delivered";

    const finalStatus =
      deriveFinalStatus(
        originalPodStatus,
        selectedPodLines
      );

    const podStatus =
      podStatusFromFinalStatus(
        finalStatus,
        originalPodStatus
      );

    const deliveredTo =
      $("deliveredTo")
        ?.value
        .trim() ||
      "";

    const notes =
      $("podNotes")
        ?.value
        .trim() ||
      "";

    const sigDataUrl =
      signaturePad
        ?.toDataUrl() ||
      null;

    const existingPhotos =
      Array.isArray(
        selectedStop
          .delivery_photos
      )
        ? selectedStop
            .delivery_photos
            .filter(Boolean)
        : [];

    const totalPhotoCount =
      existingPhotos.length +
      pendingPodPhotos.length;

    if (
      [
        "delivered",
        "delivery_issue"
      ].includes(
        finalStatus
      ) &&
      !deliveredTo
    ) {
      throw new Error(
        "Enter the receiver name."
      );
    }

    if (
      [
        "delivered",
        "delivery_issue"
      ].includes(
        finalStatus
      ) &&
      !sigDataUrl
    ) {
      throw new Error(
        "Customer signature is required."
      );
    }

    if (
      totalPhotoCount <
      MIN_POD_PHOTOS
    ) {
      throw new Error(
        `At least ${MIN_POD_PHOTOS} delivery photos are required. Currently ${totalPhotoCount}.`
      );
    }

    if (
      totalPhotoCount >
      MAX_POD_PHOTOS
    ) {
      throw new Error(
        `Maximum ${MAX_POD_PHOTOS} delivery photos are allowed.`
      );
    }

    return {
      status:
        "pending",

      created_at:
        nowIso(),

      company_id:
        companyId,

      user_id:
        user?.id ||
        null,

      stop:
        selectedStop,

      pod_lines:
        selectedPodLines,

      original_pod_status:
        originalPodStatus,

      final_status:
        finalStatus,

      pod_status:
        podStatus,

      delivered_to:
        deliveredTo,

      notes,

      signature_data_url:
        sigDataUrl,

      photo_files:
        [...pendingPodPhotos],

      existing_photos:
        existingPhotos
    };
  }

  async function queuePodOffline(
    payload
  ) {
    await idbAdd(
      OFFLINE_POD_STORE,
      payload
    );

    show(
      $("podMessage"),
      "POD saved offline. It will sync automatically when connection returns.",
      "ok"
    );

    await updateOfflineQueueUi();
  }

  /* =========================================================
     PROCESS POD ONLINE
  ========================================================= */

  async function processPodPayload(
    payload
  ) {
    const client =
      ensureDb();

    const stop =
      payload.stop;

    const order =
      getOrder(stop);

    const orderId =
      getOrderId(stop);

    if (!orderId) {
      throw new Error(
        "No order linked to this stop."
      );
    }

    const photoUrls =
      await uploadPodPhotos(
        stop,
        payload.photo_files ||
        []
      );

    const signatureUrl =
      await uploadSignature(
        stop,
        payload.signature_data_url
      );

    await savePodLinesFromPayload(
      stop,
      payload.pod_lines
    );

    const completedAt =
      payload.completed_at ||
      nowIso();

    const allPhotos = [
      ...(payload.existing_photos || []),
      ...photoUrls
    ].slice(
      0,
      MAX_POD_PHOTOS
    );

    const {
      error: stopError
    } = await client
      .from("route_stops")
      .update({
        delivery_status:
          payload.final_status,

        status:
          payload.final_status,

        delivered_to:
          payload.delivered_to ||
          null,

        pod_notes:
          payload.notes ||
          null,

        customer_signature:
          signatureUrl,

        delivery_photos:
          allPhotos,

        delivery_date:
          completedAt.slice(
            0,
            10
          ),

        delivery_time:
          completedAt.slice(
            11,
            16
          ),

        completed_at:
          completedAt
      })
      .eq(
        "id",
        stop.id
      );

    if (stopError) {
      throw stopError;
    }

    const {
      error: orderError
    } = await client
      .from("orders")
      .update({
        status:
          payload.final_status,

        transport_status:
          payload.final_status,

        overall_status:
          payload.final_status ===
            "delivered"
            ? "delivered"
            : "issue",

        pod_status:
          payload.pod_status,

        pod_signed_at:
          completedAt,

        pod_signed_by:
          payload.delivered_to ||
          null,

        pod_photo_count:
          allPhotos.length,

        expected_delivery_date:
          completedAt.slice(
            0,
            10
          ),

        delivery_eta_status:
          "confirmed",

        eta_finalized:
          true,

        delivery_eta_from:
          completedAt.slice(
            11,
            16
          ),

        delivery_eta_to:
          completedAt.slice(
            11,
            16
          ),

        last_activity_at:
          completedAt
      })
      .eq(
        "id",
        orderId
      );

    if (orderError) {
      throw orderError;
    }

    await createActivityLog(
      stop,
      payload.final_status,
      payload.delivered_to,
      allPhotos.length,
      payload.pod_lines
    );

    await updateRouteStatusAfterPod(
      getRouteId(stop)
    );

    if (
      window.PodGenerator
        ?.generate
    ) {
      const result =
        await window.PodGenerator
          .generate(
            order,
            client,
            await getCompanyId(),
            {
              routeStopId:
                stop.id,

              receivedBy:
                payload.delivered_to,

              deliveredAt:
                completedAt,

              notes:
                payload.notes,

              driverName:
                order.driver_name ||
                stop.driver_name ||
                stop.routes
                  ?.driver_name ||
                profile?.full_name ||
                "",

              signatureDataUrl:
                payload.signature_data_url,

              photoUrls:
                allPhotos,

              includePhotos:
                true,

              podStatus:
                payload.pod_status
            }
          );

      const pdfUrl =
        result?.fileUrl ||
        result?.publicUrl ||
        result?.url ||
        null;

      if (pdfUrl) {
        await client
          .from("orders")
          .update({
            pod_document_url:
              pdfUrl,

            last_activity_at:
              nowIso()
          })
          .eq(
            "id",
            orderId
          );
      }
    }

    return true;
  }

  async function syncPodQueue() {
    if (!isOnline()) {
      return;
    }

    const queue =
      await idbGetAll(
        OFFLINE_POD_STORE
      );

    for (
      const item of queue
    ) {
      try {
        item.status =
          "uploading";

        await idbPut(
          OFFLINE_POD_STORE,
          item
        );

        await processPodPayload(
          item
        );

        await idbDelete(
          OFFLINE_POD_STORE,
          item.id
        );

        console.log(
          "[offline] POD synced:",
          item.id
        );
      } catch (error) {
        item.status =
          "failed";

        item.last_error =
          error.message;

        await idbPut(
          OFFLINE_POD_STORE,
          item
        );

        console.warn(
          "[offline] POD sync stopped:",
          error.message
        );

        break;
      }
    }

    await updateOfflineQueueUi();
  }

  async function syncOfflineData() {
    if (!isOnline()) {
      return;
    }

    console.log(
      "[offline] Sync started."
    );

    try {
      await syncGpsQueue();
    } catch (error) {
      console.warn(
        "[offline] GPS sync error:",
        error
      );
    }

    try {
      await syncPodQueue();
    } catch (error) {
      console.warn(
        "[offline] POD sync error:",
        error
      );
    }

    console.log(
      "[offline] Sync finished."
    );

    await updateOfflineQueueUi();
  }

  /* =========================================================
     SAVE POD BUTTON
  ========================================================= */

  async function savePod() {
    const payload =
      await makeOfflinePodPayload();

    payload.completed_at =
      nowIso();

    if (!isOnline()) {
      await queuePodOffline(
        payload
      );

      resetPodForm();

      return {
        offline:
          true
      };
    }

    try {
      await processPodPayload(
        payload
      );

      resetPodForm();

      await loadStops();

      return {
        offline:
          false
      };
    } catch (error) {
      console.warn(
        "[driver app] Online POD failed. Saving locally:",
        error.message
      );

      await queuePodOffline(
        payload
      );

      resetPodForm();

      return {
        offline:
          true
      };
    }
  }

  function resetPodForm() {
    selectedStop =
      null;

    selectedPodLines =
      [];

    pendingPodPhotos =
      [];

    if (
      $("podSelectedStop")
    ) {
      $("podSelectedStop")
        .textContent =
        "Select a stop from Routes first.";
    }

    if ($("podPhotos")) {
      $("podPhotos")
        .value =
        "";
    }

    if (
      $("podCameraInput")
    ) {
      $("podCameraInput")
        .value =
        "";
    }

    if ($("deliveredTo")) {
      $("deliveredTo")
        .value =
        "";
    }

    if ($("podNotes")) {
      $("podNotes")
        .value =
        "";
    }

    signaturePad
      ?.clear();

    updatePodPhotoUi();
  }

  /* =========================================================
     SIGNATURE
  ========================================================= */

  function setupSignature() {
    const canvas =
      $("signatureCanvas");

    if (!canvas) {
      return;
    }

    const ctx =
      canvas.getContext(
        "2d"
      );

    let drawing =
      false;

    let last =
      null;

    function resizeCanvas() {
      const rect =
        canvas.getBoundingClientRect();

      const ratio =
        Math.max(
          window.devicePixelRatio ||
          1,
          1
        );

      canvas.width =
        Math.max(
          1,
          Math.floor(
            rect.width *
            ratio
          )
        );

      canvas.height =
        Math.max(
          1,
          Math.floor(
            rect.height *
            ratio
          )
        );

      ctx.setTransform(
        ratio,
        0,
        0,
        ratio,
        0,
        0
      );

      ctx.lineCap =
        "round";

      ctx.lineJoin =
        "round";

      ctx.lineWidth =
        2.2;

      ctx.strokeStyle =
        "#07152f";
    }

    function point(event) {
      const rect =
        canvas.getBoundingClientRect();

      const src =
        event.touches?.[0] ||
        event;

      return {
        x:
          src.clientX -
          rect.left,

        y:
          src.clientY -
          rect.top
      };
    }

    function start(event) {
      event.preventDefault();

      drawing =
        true;

      last =
        point(event);
    }

    function move(event) {
      if (!drawing) {
        return;
      }

      event.preventDefault();

      const p =
        point(event);

      ctx.beginPath();

      ctx.moveTo(
        last.x,
        last.y
      );

      ctx.lineTo(
        p.x,
        p.y
      );

      ctx.stroke();

      last = p;
    }

    function end(event) {
      if (event) {
        event.preventDefault();
      }

      drawing =
        false;

      last =
        null;
    }

    function clear() {
      resizeCanvas();
    }

    function toDataUrl() {
      const pixels =
        ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;

      let hasInk =
        false;

      for (
        let i = 3;
        i < pixels.length;
        i += 4
      ) {
        if (
          pixels[i] > 0
        ) {
          hasInk =
            true;

          break;
        }
      }

      return hasInk
        ? canvas.toDataURL(
            "image/png"
          )
        : null;
    }

    canvas.addEventListener(
      "mousedown",
      start
    );

    canvas.addEventListener(
      "mousemove",
      move
    );

    window.addEventListener(
      "mouseup",
      end
    );

    canvas.addEventListener(
      "touchstart",
      start,
      {
        passive:
          false
      }
    );

    canvas.addEventListener(
      "touchmove",
      move,
      {
        passive:
          false
      }
    );

    canvas.addEventListener(
      "touchend",
      end,
      {
        passive:
          false
      }
    );

    canvas.addEventListener(
      "touchcancel",
      end,
      {
        passive:
          false
      }
    );

    window.addEventListener(
      "resize",
      resizeCanvas
    );

    resizeCanvas();

    signaturePad = {
      clear,
      toDataUrl,
      resize:
        resizeCanvas
    };

    $("clearSignatureBtn")
      ?.addEventListener(
        "click",
        clear
      );
  }

  /* =========================================================
     NAVIGATION
  ========================================================= */

  function switchTab(tabName) {
    document
      .querySelectorAll(
        ".bottom-tab"
      )
      .forEach(btn => {
        btn.classList.toggle(
          "active",
          btn.dataset.tab ===
            tabName
        );
      });

    document
      .querySelectorAll(
        ".tab-panel"
      )
      .forEach(panel => {
        panel.classList.remove(
          "active"
        );
      });

    $("tab-" + tabName)
      ?.classList
      .add("active");

    if (
      tabName === "pod"
    ) {
      setTimeout(
        () =>
          signaturePad
            ?.resize(),
        150
      );
    }

    if (
      tabName ===
      "delivered"
    ) {
      renderDeliveredStops();
    }

    if (
      tabName ===
      "issues"
    ) {
      renderIssues();
    }
  }

  function bindNavigation() {
    document
      .querySelectorAll(
        ".bottom-tab"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          () =>
            switchTab(
              btn.dataset.tab
            )
        );
      });

    document
      .querySelectorAll(
        ".tab"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          () =>
            switchTab(
              btn.dataset.tab
            )
        );
      });
  }

  function bindRefreshButtons() {
    document
      .querySelectorAll(
        "#refreshBtn, #btnRefresh, #refreshDeliveredBtn, [data-refresh], .refresh-btn"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          async () => {
            const oldText =
              btn.textContent;

            try {
              btn.disabled =
                true;

              btn.textContent =
                "Refreshing...";

              await loadStops();

              if (isOnline()) {
                await syncOfflineData();
              }
            } catch (error) {
              alert(
                "Refresh failed: " +
                error.message
              );
            } finally {
              btn.disabled =
                false;

              btn.textContent =
                oldText ||
                "Refresh";
            }
          }
        );
      });
  }

  function bindFilters() {
    document
      .querySelectorAll(
        "[data-delivered-filter]"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          () => {
            deliveredFilter =
              btn.dataset
                .deliveredFilter ||
              "today";

            document
              .querySelectorAll(
                "[data-delivered-filter]"
              )
              .forEach(
                button =>
                  button
                    .classList
                    .remove(
                      "active"
                    )
              );

            btn.classList
              .add("active");

            renderDeliveredStops();
          }
        );
      });

    document
      .querySelectorAll(
        "[data-issue-filter]"
      )
      .forEach(btn => {
        btn.addEventListener(
          "click",
          () => {
            issueFilter =
              btn.dataset
                .issueFilter ||
              "all";

            document
              .querySelectorAll(
                "[data-issue-filter]"
              )
              .forEach(
                button =>
                  button
                    .classList
                    .remove(
                      "active"
                    )
              );

            btn.classList
              .add("active");

            renderIssues();
          }
        );
      });
  }

  /* =========================================================
     ONLINE / OFFLINE EVENTS
  ========================================================= */

  function setupNetworkEvents() {
    window.addEventListener(
      "online",
      async () => {
        console.log(
          "[offline] Connection restored."
        );

        updateConnectionUi();

        if (user) {
          try {
            await syncOfflineData();

            await loadStops();
          } catch (error) {
            console.warn(
              "[offline] Reconnect sync failed:",
              error
            );
          }
        }
      }
    );

    window.addEventListener(
      "offline",
      () => {
        console.log(
          "[offline] Connection lost."
        );

        updateConnectionUi();
      }
    );

    updateConnectionUi();
  }

  /* =========================================================
     BIND
  ========================================================= */

  function bind() {
    $("loginForm")
      ?.addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          try {
            clearNotice(
              $("loginMessage")
            );

            await login(
              $("loginEmail")
                .value
                .trim(),

              $("loginPassword")
                .value
            );
          } catch (error) {
            show(
              $("loginMessage"),
              error.message,
              "err"
            );
          }
        }
      );

    $("logoutBtn")
      ?.addEventListener(
        "click",
        () =>
          logout()
            .catch(error =>
              alert(
                error.message
              )
            )
      );

    bindNavigation();
    bindRefreshButtons();
    bindFilters();

    $("savePodBtn")
      ?.addEventListener(
        "click",
        async () => {
          const btn =
            $("savePodBtn");

          try {
            if (btn) {
              btn.disabled =
                true;

              btn.textContent =
                "Processing POD...";
            }

            show(
              $("podMessage"),
              isOnline()
                ? "Saving POD..."
                : "Saving POD offline...",
              "ok"
            );

            const result =
              await savePod();

            if (
              result.offline
            ) {
              alert(
                "POD saved safely on this device. It will sync automatically when the connection returns."
              );
            } else {
              alert(
                "POD successfully processed."
              );
            }

            switchTab(
              "routes"
            );
          } catch (error) {
            show(
              $("podMessage"),
              "POD failed: " +
                error.message,
              "err"
            );

            alert(
              "POD failed: " +
              error.message
            );
          } finally {
            if (btn) {
              btn.disabled =
                false;

              btn.textContent =
                "Save POD";
            }
          }
        }
      );
  }

  /* =========================================================
     START
  ========================================================= */

  document.addEventListener(
    "DOMContentLoaded",
    async () => {
      bind();

      setupSignature();
      setupPodPhotos();
      setupNetworkEvents();

      try {
        // Creates/open IndexedDB early.
        await openOfflineDb()
          .then(database =>
            database.close()
          );

        await initAuth();

        await updateOfflineQueueUi();
      } catch (error) {
        show(
          $("loginMessage"),
          error.message,
          "err"
        );
      }
    }
  );

})();