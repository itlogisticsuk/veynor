(function () {
  "use strict";

  /* =========================================================
     CONFIG
  ========================================================= */

  const TENANT_NAME = "Sofa2U";

  const LIVE_LOCATION_START_HOUR = 6;
  const LIVE_LOCATION_END_HOUR = 18;

  const TODAY_ROUTE_HIDE_HOUR = 23;

  const LIVE_LOCATION_FRESH_MS =
    90 * 1000;

  const LIVE_LOCATION_OFFLINE_MS =
    3 * 60 * 1000;

  const ON_TIME_THRESHOLD_MINUTES = 15;

  const ROUTE_COLORS = [
    "#1267ff",
    "#16a34a",
    "#f97316",
    "#7c3aed",
    "#0891b2",
    "#dc2626",
    "#65a30d",
    "#9333ea"
  ];

  const ACTIVE_ROUTE_STATUSES = new Set([
    "planned",
    "sent_to_driver",
    "loaded",
    "dispatched",
    "on_transport",
    "out_for_delivery"
  ]);

  const LIVE_ROUTE_STATUSES = new Set([
    "sent_to_driver",
    "loaded",
    "dispatched",
    "on_transport",
    "out_for_delivery"
  ]);

  const COMPLETED_ROUTE_STATUSES = new Set([
    "delivered",
    "completed",
    "closed"
  ]);

  const COMPLETED_STOP_STATUSES = new Set([
    "delivered",
    "signed"
  ]);

  const ISSUE_STOP_STATUSES = new Set([
    "delivery_issue",
    "partial",
    "partial_delivery",
    "partially_delivered",
    "damaged",
    "refused"
  ]);

  const FAILED_STOP_STATUSES = new Set([
    "failed",
    "failed_delivery",
    "not_delivered",
    "delivery_failed"
  ]);


  /* =========================================================
     STATE
  ========================================================= */

  let client = null;

  let currentUser = null;
  let currentProfile = null;

  let companyId = null;

  let allRoutes = [];
  let allStops = [];
  let allOrders = [];

  let driverLiveLocations = [];
  let driverLocationHistory = [];

  let selectedRouteId = null;

  let selectedRouteIds =
    new Set();

  let routeMap = null;

  let routePlannedLayer = null;
  let routeActualLayer = null;
  let routeStopsLayer = null;
  let routeLiveLayer = null;
  let depotLayer = null;

  let depotPoint = null;

  let routeFilterMode =
    "all";

  let currentViewDate =
    todayIso();

  let refreshTimer = null;


  /* =========================================================
     BASIC HELPERS
  ========================================================= */

  function byId(id) {
    return document.getElementById(id);
  }


  function normalize(value) {
    return String(
      value ?? ""
    )
      .trim()
      .toLowerCase();
  }


  function escapeHtml(value) {
    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
    );
  }


  function toNumber(
    value,
    fallback = 0
  ) {
    const n =
      Number(
        String(
          value ?? ""
        ).replace(
          ",",
          "."
        )
      );

    return Number.isFinite(n)
      ? n
      : fallback;
  }


  function todayIso() {
    const d =
      new Date();

    const year =
      d.getFullYear();

    const month =
      String(
        d.getMonth() + 1
      ).padStart(
        2,
        "0"
      );

    const day =
      String(
        d.getDate()
      ).padStart(
        2,
        "0"
      );

    return `${year}-${month}-${day}`;
  }


  function localHour() {
    return new Date()
      .getHours();
  }


  function nowMs() {
    return Date.now();
  }


  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date =
      new Date(
        `${String(value).slice(0, 10)}T12:00:00`
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(value);
    }

    return date.toLocaleDateString(
      "en-GB",
      {
        day:
          "2-digit",
        month:
          "short",
        year:
          "numeric"
      }
    );
  }


  function formatDateLong(value) {
    if (!value) {
      return "—";
    }

    const date =
      new Date(
        `${String(value).slice(0, 10)}T12:00:00`
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(value);
    }

    return date.toLocaleDateString(
      "en-GB",
      {
        weekday:
          "long",
        day:
          "2-digit",
        month:
          "long",
        year:
          "numeric"
      }
    );
  }


  function formatTime(value) {
    if (!value) {
      return "—";
    }

    const text =
      String(value);

    if (
      /^\d{1,2}:\d{2}/
        .test(text)
    ) {
      return text.slice(
        0,
        5
      );
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return text;
    }

    return date
      .toLocaleTimeString(
        "en-GB",
        {
          hour:
            "2-digit",
          minute:
            "2-digit"
        }
      );
  }


  function formatDurationMinutes(
    minutes
  ) {
    const total =
      Math.max(
        0,
        Math.round(
          Number(
            minutes ||
            0
          )
        )
      );

    const hours =
      Math.floor(
        total / 60
      );

    const mins =
      total % 60;

    if (!hours) {
      return `${mins}m`;
    }

    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }


  function formatMiles(value) {
    const n =
      toNumber(
        value,
        0
      );

    return `${n.toFixed(0)} mi`;
  }


  function formatVolume(value) {
    return `${toNumber(value, 0).toFixed(2)} m³`;
  }


  function titleCase(value) {
    return String(
      value ||
      ""
    )
      .replaceAll(
        "_",
        " "
      )
      .replace(
        /\b\w/g,
        char =>
          char.toUpperCase()
      );
  }


  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(
        String(
          value ||
          ""
        )
      );
  }


  function showToast(
    message,
    type = "ok"
  ) {
    const el =
      byId("toast");

    if (!el) {
      return;
    }

    el.textContent =
      message ||
      "";

    el.className =
      `notice ${type}`;

    clearTimeout(
      window.__routeTrackingToast
    );

    window.__routeTrackingToast =
      setTimeout(
        () => {
          el.textContent =
            "";

          el.className =
            "notice";
        },
        5000
      );
  }


  /* =========================================================
     SUPABASE
  ========================================================= */

  function getClient() {
    if (client) {
      return client;
    }

    if (
      typeof window.sb ===
      "function"
    ) {
      client =
        window.sb();

      return client;
    }

    throw new Error(
      "Supabase helper sb() is not available."
    );
  }


  async function loadCurrentUser() {
    const {
      data,
      error
    } =
      await getClient()
        .auth
        .getUser();

    if (error) {
      throw error;
    }

    currentUser =
      data?.user ||
      null;

    if (!currentUser) {
      throw new Error(
        "No signed-in user found."
      );
    }

    let result =
      await getClient()
        .from(
          "user_profiles"
        )
        .select("*")
        .eq(
          "auth_user_id",
          currentUser.id
        )
        .maybeSingle();

    if (
      !result.data &&
      !result.error
    ) {
      result =
        await getClient()
          .from(
            "user_profiles"
          )
          .select("*")
          .eq(
            "id",
            currentUser.id
          )
          .maybeSingle();
    }

    if (result.error) {
      throw result.error;
    }

    currentProfile =
      result.data ||
      null;

    applyRoleClass();
  }


  async function getCompanyId() {
    if (companyId) {
      return companyId;
    }

    if (
      currentProfile
        ?.company_id
    ) {
      companyId =
        currentProfile
          .company_id;

      return companyId;
    }

    const {
      data,
      error
    } =
      await getClient()
        .from(
          "companies"
        )
        .select(
          "id"
        )
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


  /* =========================================================
     ROLES / VISIBILITY
  ========================================================= */

  function getRole() {
    return normalize(
      currentProfile
        ?.role ||
      ""
    );
  }


  function isProductOwnerUser() {
    return [
      "product_owner_admin",
      "product_owner_user"
    ].includes(
      getRole()
    );
  }


  function isRetailerUser() {
    return (
      getRole() ===
      "retailer_user"
    );
  }


  function isInternalUser() {
    return !(
      isProductOwnerUser() ||
      isRetailerUser()
    );
  }


  function applyRoleClass() {
    const role =
      getRole();

    if (!role) {
      return;
    }

    document.body
      .classList
      .add(
        `role-${role}`
      );
  }


  function getVisibleCustomerId() {
    if (
      !isProductOwnerUser()
    ) {
      return null;
    }

    return (
      currentProfile
        ?.customer_id ||
      currentProfile
        ?.product_owner_id ||
      null
    );
  }


  function getVisibleRetailerId() {
    if (
      !isRetailerUser()
    ) {
      return null;
    }

    return (
      currentProfile
        ?.retailer_id ||
      currentProfile
        ?.customer_id ||
      null
    );
  }


  /* =========================================================
     ROUTE DATE RULES
  ========================================================= */

  function getRouteDate(route) {
    return String(
      route
        ?.planned_delivery_date ||
      route
        ?.route_date ||
      ""
    ).slice(
      0,
      10
    );
  }


  function shouldShowTodayRoute() {
    return (
      localHour() <
      TODAY_ROUTE_HIDE_HOUR
    );
  }


  function shouldDisplayRoute(route) {
    const routeDate =
      getRouteDate(
        route
      );

    if (!routeDate) {
      return false;
    }

    const today =
      todayIso();

    if (
      routeDate >
      today
    ) {
      return true;
    }

    if (
      routeDate ===
      today
    ) {
      return shouldShowTodayRoute();
    }

    return false;
  }


  function isTodayRoute(route) {
    return (
      getRouteDate(route) ===
      todayIso()
    );
  }


  function isFutureRoute(route) {
    return (
      getRouteDate(route) >
      todayIso()
    );
  }


  function isRouteLive(route) {
    return (
      isTodayRoute(route) &&
      LIVE_ROUTE_STATUSES.has(
        normalize(
          route
            ?.route_status ||
          route
            ?.status ||
          ""
        )
      )
    );
  }


  /* =========================================================
     LIVE LOCATION TIME RULE
  ========================================================= */

  function isLiveLocationVisibleNow() {
    const hour =
      localHour();

    return (
      hour >=
        LIVE_LOCATION_START_HOUR &&
      hour <
        LIVE_LOCATION_END_HOUR
    );
  }


  function updateLiveLocationVisibilityNotice() {
    const el =
      byId(
        "liveLocationVisibilityNotice"
      );

    const text =
      byId(
        "liveLocationVisibilityText"
      );

    if (
      !el ||
      !text
    ) {
      return;
    }

    if (
      isLiveLocationVisibleNow()
    ) {
      el.classList
        .remove(
          "warning"
        );

      text.textContent =
        "Live vehicle location is currently available. Location is shown between 06:00 and 18:00.";
    } else {
      el.classList
        .add(
          "warning"
        );

      text.textContent =
        "Live vehicle location is hidden outside 06:00–18:00.";
    }
  }


  /* =========================================================
     LOAD SETTINGS / DEPOT
  ========================================================= */

  async function loadDepot() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } =
      await getClient()
        .from(
          "settings"
        )
        .select(
          "setting_key, setting_value"
        )
        .eq(
          "company_id",
          cid
        )
        .in(
          "setting_key",
          [
            "home_depot_name",
            "home_depot_lat",
            "home_depot_lng"
          ]
        );

    if (error) {
      console.warn(
        "[route-tracking] Depot settings unavailable:",
        error.message
      );

      depotPoint =
        null;

      return;
    }

    const map =
      new Map(
        (data || [])
          .map(
            row => [
              row.setting_key,
              row.setting_value
            ]
          )
      );

    const lat =
      Number(
        map.get(
          "home_depot_lat"
        )
      );

    const lng =
      Number(
        map.get(
          "home_depot_lng"
        )
      );

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      depotPoint = {
        name:
          map.get(
            "home_depot_name"
          ) ||
          "Depot",

        latitude:
          lat,

        longitude:
          lng
      };
    } else {
      depotPoint =
        null;
    }
  }


  /* =========================================================
     LOAD ROUTES
  ========================================================= */

  async function loadRoutes() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } =
      await getClient()
        .from(
          "routes"
        )
        .select("*")
        .eq(
          "company_id",
          cid
        )
        .order(
          "route_date",
          {
            ascending:
              true,
            nullsFirst:
              false
          }
        )
        .order(
          "route_code",
          {
            ascending:
              true
          }
        );

    if (error) {
      throw error;
    }

    allRoutes =
      (data || [])
        .filter(
          shouldDisplayRoute
        )
        .filter(
          route =>
            !COMPLETED_ROUTE_STATUSES
              .has(
                normalize(
                  route
                    .route_status ||
                  route
                    .status
                )
              ) ||
            isTodayRoute(
              route
            )
        );
  }


  /* =========================================================
     LOAD STOPS
  ========================================================= */

  async function loadStops() {
    const cid =
      await getCompanyId();

    const routeIds =
      allRoutes
        .map(
          route =>
            route.id
        )
        .filter(
          Boolean
        );

    if (
      !routeIds.length
    ) {
      allStops = [];
      return;
    }

    const {
      data,
      error
    } =
      await getClient()
        .from(
          "route_stops"
        )
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
            ascending:
              true
          }
        )
        .order(
          "stop_sequence",
          {
            ascending:
              true,
            nullsFirst:
              false
          }
        )
        .order(
          "stop_number",
          {
            ascending:
              true,
            nullsFirst:
              false
          }
        );

    if (error) {
      throw error;
    }

    allStops =
      data || [];
  }


  /* =========================================================
     LOAD ORDERS
  ========================================================= */

  async function loadOrders() {
    const cid =
      await getCompanyId();

    const orderIds =
      [
        ...new Set(
          allStops
            .map(
              stop =>
                stop.order_id
            )
            .filter(
              Boolean
            )
        )
      ];

    if (
      !orderIds.length
    ) {
      allOrders = [];
      return;
    }

    let query =
      getClient()
        .from(
          "orders"
        )
        .select(`
          *,
          customers (
            id,
            name,
            customer_code
          )
        `)
        .eq(
          "company_id",
          cid
        )
        .in(
          "id",
          orderIds
        );

    const visibleCustomerId =
      getVisibleCustomerId();

    if (
      visibleCustomerId
    ) {
      query =
        query.eq(
          "customer_id",
          visibleCustomerId
        );
    }

    const {
      data,
      error
    } =
      await query;

    if (error) {
      throw error;
    }

    allOrders =
      data || [];


    /*
     * SECURITY / VISIBILITY:
     *
     * When a product owner is signed in,
     * route stops belonging to other owners
     * are removed from the page.
     */
    if (
      visibleCustomerId
    ) {
      const allowedOrderIds =
        new Set(
          allOrders.map(
            order =>
              String(
                order.id
              )
          )
        );

      allStops =
        allStops.filter(
          stop =>
            allowedOrderIds.has(
              String(
                stop.order_id
              )
            )
        );

      const visibleRouteIds =
        new Set(
          allStops.map(
            stop =>
              String(
                stop.route_id
              )
          )
        );

      allRoutes =
        allRoutes.filter(
          route =>
            visibleRouteIds.has(
              String(
                route.id
              )
            )
        );
    }
  }


  /* =========================================================
     LOAD LIVE LOCATIONS
  ========================================================= */

  async function loadDriverLiveLocations() {
    driverLiveLocations =
      [];

    if (
      !isLiveLocationVisibleNow()
    ) {
      return;
    }

    const cid =
      await getCompanyId();

    const {
      data,
      error
    } =
      await getClient()
        .from(
          "driver_live_locations"
        )
        .select("*")
        .eq(
          "company_id",
          cid
        );

    if (error) {
      console.warn(
        "[route-tracking] Live locations unavailable:",
        error.message
      );

      return;
    }

    driverLiveLocations =
      data || [];
  }


  /* =========================================================
     LOAD GPS HISTORY
  ========================================================= */

  async function loadDriverLocationHistory() {
    driverLocationHistory =
      [];

    if (
      !isInternalUser()
    ) {
      return;
    }

    const routeIds =
      allRoutes
        .map(
          route =>
            route.id
        )
        .filter(
          Boolean
        );

    if (
      !routeIds.length
    ) {
      return;
    }

    const cid =
      await getCompanyId();

    const {
      data,
      error
    } =
      await getClient()
        .from(
          "driver_location_history"
        )
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
          "recorded_at",
          {
            ascending:
              true
          }
        );

    if (error) {
      console.warn(
        "[route-tracking] GPS history not loaded:",
        error.message
      );

      return;
    }

    driverLocationHistory =
      data || [];
  }


  /* =========================================================
     DATA ACCESS
  ========================================================= */

  function getRouteById(routeId) {
    return (
      allRoutes.find(
        route =>
          String(
            route.id
          ) ===
          String(
            routeId
          )
      ) ||
      null
    );
  }


  function getOrderById(orderId) {
    return (
      allOrders.find(
        order =>
          String(
            order.id
          ) ===
          String(
            orderId
          )
      ) ||
      null
    );
  }


  function getStopsForRoute(routeId) {
    return allStops
      .filter(
        stop =>
          String(
            stop.route_id
          ) ===
          String(
            routeId
          )
      )
      .sort(
        (a, b) =>
          toNumber(
            a.stop_sequence ??
            a.stop_number,
            999
          ) -
          toNumber(
            b.stop_sequence ??
            b.stop_number,
            999
          )
      );
  }


  function getOrdersForRoute(routeId) {
    return getStopsForRoute(
      routeId
    )
      .map(
        stop =>
          getOrderById(
            stop.order_id
          )
      )
      .filter(
        Boolean
      );
  }


  function getRouteDriverId(route) {
    return (
      route
        ?.driver_user_id ||
      route
        ?.driver_profile_id ||
      ""
    );
  }


  function getRouteDriverName(route) {
    return (
      route
        ?.driver_name ||
      "—"
    );
  }


  function getRouteVehicleName(route) {
    return (
      route
        ?.vehicle_name ||
      route
        ?.assigned_vehicle_name ||
      route
        ?.vehicle_registration ||
      "—"
    );
  }


  function getRouteLabel(route) {
    return (
      route
        ?.route_code ||
      route
        ?.route_number ||
      route
        ?.route_name ||
      route
        ?.name ||
      "Route"
    );
  }


  function getRetailerName(order, stop) {
    return (
      order
        ?.retailer_name ||
      order
        ?.retail_name ||
      order
        ?.delivery_name ||
      order
        ?.delivery_company ||
      order
        ?.recipient_name ||
      stop
        ?.stop_name ||
      "Customer"
    );
  }


  function getAckNumber(order) {
    return (
      order
        ?.external_reference ||
      order
        ?.ack_number ||
      order
        ?.acknowledgement_number ||
      "—"
    );
  }


  function getSoNumber(order) {
    return (
      order
        ?.order_number ||
      "—"
    );
  }


  function getStopStatus(stop, order) {
    const values = [
      stop
        ?.delivery_status,

      stop
        ?.status,

      order
        ?.pod_status,

      order
        ?.transport_status,

      order
        ?.status
    ]
      .map(
        normalize
      )
      .filter(
        Boolean
      );

    for (
      const value of values
    ) {
      if (
        COMPLETED_STOP_STATUSES
          .has(value)
      ) {
        return "delivered";
      }

      if (
        FAILED_STOP_STATUSES
          .has(value)
      ) {
        return "failed_delivery";
      }

      if (
        ISSUE_STOP_STATUSES
          .has(value)
      ) {
        return "delivery_issue";
      }

      if (
        [
          "out_for_delivery",
          "on_transport",
          "loaded",
          "sent_to_driver"
        ].includes(
          value
        )
      ) {
        return "out_for_delivery";
      }
    }

    return (
      values[0] ||
      "planned"
    );
  }


  function getRouteStatus(route) {
    return normalize(
      route
        ?.route_status ||
      route
        ?.status ||
      "planned"
    );
  }


  /* =========================================================
     ROUTE FILTERING
  ========================================================= */

  function getFilteredRoutes() {
    let routes =
      allRoutes.filter(
        shouldDisplayRoute
      );

    if (
      routeFilterMode ===
      "active"
    ) {
      routes =
        routes.filter(
          route =>
            LIVE_ROUTE_STATUSES
              .has(
                getRouteStatus(
                  route
                )
              )
        );
    }

    if (
      routeFilterMode ===
      "future"
    ) {
      routes =
        routes.filter(
          isFutureRoute
        );
    }

    return routes.sort(
      (a, b) => {
        const dateA =
          getRouteDate(a);

        const dateB =
          getRouteDate(b);

        if (
          dateA !==
          dateB
        ) {
          return dateA
            .localeCompare(
              dateB
            );
        }

        return getRouteLabel(a)
          .localeCompare(
            getRouteLabel(b),
            "en",
            {
              numeric:
                true
            }
          );
      }
    );
  }


  /* =========================================================
     ROUTE SUMMARY
  ========================================================= */

  function getRouteSummary(route) {
    const stops =
      getStopsForRoute(
        route.id
      );

    const orders =
      getOrdersForRoute(
        route.id
      );

    let completed = 0;
    let issues = 0;
    let failed = 0;
    let active = 0;

    stops.forEach(
      stop => {
        const order =
          getOrderById(
            stop.order_id
          );

        const status =
          getStopStatus(
            stop,
            order
          );

        if (
          status ===
          "delivered"
        ) {
          completed++;
        } else if (
          status ===
          "delivery_issue"
        ) {
          issues++;
          completed++;
        } else if (
          status ===
          "failed_delivery"
        ) {
          failed++;
          completed++;
        } else if (
          [
            "out_for_delivery",
            "on_transport"
          ].includes(
            status
          )
        ) {
          active++;
        }
      }
    );

    const remaining =
      Math.max(
        0,
        stops.length -
        completed -
        active
      );

    const volume =
      stops.reduce(
        (sum, stop) =>
          sum +
          toNumber(
            stop
              .planned_volume_m3,
            0
          ),
        0
      );

    const colli =
      stops.reduce(
        (sum, stop) =>
          sum +
          toNumber(
            stop
              .planned_colli,
            0
          ),
        0
      );

    const progress =
      stops.length
        ? (
            completed /
            stops.length
          ) *
          100
        : 0;

    return {
      stops,
      orders,

      stopCount:
        stops.length,

      orderCount:
        orders.length,

      completed,
      active,
      remaining,
      issues,
      failed,

      volume,
      colli,
      progress
    };
  }


  /* =========================================================
     ROUTE CARDS
  ========================================================= */

  function routeStatusLabel(route) {
    const status =
      getRouteStatus(
        route
      );

    if (
      isRouteLive(route)
    ) {
      return "In Progress";
    }

    if (
      status ===
      "sent_to_driver"
    ) {
      return "Sent to Driver";
    }

    if (
      status ===
      "loaded"
    ) {
      return "Loaded";
    }

    if (
      status ===
      "out_for_delivery"
    ) {
      return "Out for Delivery";
    }

    return titleCase(
      status
    );
  }


  function renderRouteCards() {
    const mount =
      byId(
        "routeCardsGrid"
      );

    if (!mount) {
      return;
    }

    const routes =
      getFilteredRoutes();

    byId(
      "futureRoutesMeta"
    ).textContent =
      `${routes.length} route${routes.length === 1 ? "" : "s"}`;

    if (
      !routes.length
    ) {
      mount.innerHTML = `
        <div class="route-empty-state">
          <strong>No planned routes</strong>
          <span>No current or future routes match the selected filter.</span>
        </div>
      `;

      return;
    }

    mount.innerHTML =
      routes.map(
        (
          route,
          index
        ) => {
          const summary =
            getRouteSummary(
              route
            );

          const routeDate =
            getRouteDate(
              route
            );

          const today =
            isTodayRoute(
              route
            );

          const selected =
            selectedRouteIds
              .has(
                String(
                  route.id
                )
              );

          const routeStatus =
            getRouteStatus(
              route
            );

          const plannedMiles =
            Math.max(
              toNumber(
                route
                  .estimated_distance_miles,
                0
              ),
              toNumber(
                route
                  .distance_miles,
                0
              )
            );

          const hours =
            toNumber(
              route
                .estimated_total_hours,
              0
            );

          const duration =
            hours
              ? formatDurationMinutes(
                  hours *
                  60
                )
              : "—";

          return `
            <article
              class="
                route-card
                ${today ? "today" : ""}
                ${selected ? "selected" : ""}
              "
              data-route-card="${escapeHtml(route.id)}"
              style="
                border-top:
                  3px solid
                  ${ROUTE_COLORS[index % ROUTE_COLORS.length]};
              "
            >

              <div class="route-card-head">

                <div class="route-card-check">

                  <input
                    class="route-card-checkbox"
                    type="checkbox"
                    data-route-check="${escapeHtml(route.id)}"
                    ${selected ? "checked" : ""}
                  />

                  <div class="route-card-date">

                    <strong>
                      ${
                        today
                          ? "Today"
                          : formatDateLong(routeDate)
                      }
                    </strong>

                    <span>
                      ${formatDate(routeDate)}
                    </span>

                    <span class="route-code">
                      ${escapeHtml(getRouteLabel(route))}
                    </span>

                  </div>

                </div>

                <span
                  class="
                    route-status-pill
                    ${escapeHtml(routeStatus)}
                  "
                >
                  ${escapeHtml(routeStatusLabel(route))}
                </span>

              </div>


              <div class="route-card-meta">

                <div class="route-card-meta-item">
                  <span>Driver</span>
                  <strong>
                    ${escapeHtml(getRouteDriverName(route))}
                  </strong>
                </div>

                <div class="route-card-meta-item">
                  <span>Vehicle</span>
                  <strong>
                    ${escapeHtml(getRouteVehicleName(route))}
                  </strong>
                </div>

              </div>


              <div class="route-card-kpis">

                <div class="route-card-kpi">
                  <strong>
                    ${summary.stopCount}
                  </strong>
                  <span>Stops</span>
                </div>

                <div class="route-card-kpi">
                  <strong>
                    ${summary.orderCount}
                  </strong>
                  <span>Orders</span>
                </div>

                <div class="route-card-kpi">
                  <strong>
                    ${formatVolume(summary.volume)}
                  </strong>
                  <span>Volume</span>
                </div>

              </div>


              <div class="route-card-footer">

                <span>
                  ${
                    today
                      ? `${summary.completed} completed · ${summary.remaining} remaining`
                      : `Est. ${duration}`
                  }
                </span>

                <span>
                  ${
                    plannedMiles
                      ? formatMiles(plannedMiles)
                      : ""
                  }
                </span>

              </div>

            </article>
          `;
        }
      ).join(
        ""
      );

    bindRouteCardEvents();
  }


function bindRouteCardEvents() {
  document
    .querySelectorAll(
      "[data-route-card]"
    )
    .forEach(
      card => {
        card.addEventListener(
          "click",
          event => {

            /*
             * Clicking the checkbox must only
             * control visibility on the main map.
             */
            if (
              event.target.closest(
                "input"
              )
            ) {
              return;
            }

            const routeId =
              card.dataset
                .routeCard;

            openRouteModal(
              routeId
            );
          }
        );
      }
    );


  document
    .querySelectorAll(
      "[data-route-check]"
    )
    .forEach(
      checkbox => {
        checkbox.addEventListener(
          "change",
          event => {
            event.stopPropagation();

            const id =
              String(
                checkbox.dataset
                  .routeCheck
              );

            if (
              checkbox.checked
            ) {
              selectedRouteIds.add(
                id
              );
            } else {
              selectedRouteIds.delete(
                id
              );
            }

            /*
             * Checkbox only controls the map.
             */
            renderRouteCards();

            renderRouteColourLegend();

            updateSelectAllCheckbox();

            redrawMap();
          }
        );
      }
    );
}

  /* =========================================================
     PLANNED ROUTE ACCORDIONS
  ========================================================= */

  function renderPlannedRoutesList() {
    const mount =
      byId(
        "plannedRoutesList"
      );

    if (!mount) {
      return;
    }

    const routes =
      getFilteredRoutes()
        .filter(
          route =>
            !isRouteLive(route)
        );

    if (
      !routes.length
    ) {
      mount.innerHTML =
        "";

      return;
    }

    mount.innerHTML =
      routes.map(
        route => {
          const summary =
            getRouteSummary(
              route
            );

          const routeStatus =
            getRouteStatus(
              route
            );

          const stopsRows =
            summary.stops.map(
              stop => {
                const order =
                  getOrderById(
                    stop.order_id
                  );

                return `
                  <tr>
                    <td>
                      ${escapeHtml(
                        stop.stop_sequence ||
                        stop.stop_number ||
                        "—"
                      )}
                    </td>

                    <td>
                      <strong>
                        ${escapeHtml(
                          getRetailerName(
                            order,
                            stop
                          )
                        )}
                      </strong>

                      <div style="
                        color:#64748b;
                        font-size:8px;
                      ">
                        ${escapeHtml(stop.city || "")}
                        ${escapeHtml(stop.postcode || "")}
                      </div>
                    </td>

                    <td>
                      ${escapeHtml(getSoNumber(order))}
                    </td>

                    <td>
                      ${escapeHtml(getAckNumber(order))}
                    </td>

                    <td>
                      ${escapeHtml(
                        formatTime(
                          stop.planned_arrival_time ||
                          stop.arrival_eta ||
                          stop.eta
                        )
                      )}
                    </td>

                    <td>
                      ${toNumber(stop.planned_colli, 0)}
                    </td>

                    <td>
                      ${formatVolume(stop.planned_volume_m3)}
                    </td>

                    <td>
                      <span
                        class="
                          route-status-pill
                          ${escapeHtml(getStopStatus(stop, order))}
                        "
                      >
                        ${escapeHtml(
                          titleCase(
                            getStopStatus(stop, order)
                          )
                        )}
                      </span>
                    </td>
                  </tr>
                `;
              }
            ).join(
              ""
            );

          return `
            <article
              class="planned-route-row"
              data-planned-route="${escapeHtml(route.id)}"
            >

              <div
                class="planned-route-row-head"
                data-planned-route-head="${escapeHtml(route.id)}"
              >

                <div class="planned-route-main">

                  <input
                    type="checkbox"
                    data-route-check="${escapeHtml(route.id)}"
                    ${selectedRouteIds.has(String(route.id)) ? "checked" : ""}
                  />

                  <strong>
                    ${escapeHtml(formatDate(getRouteDate(route)))}
                    ·
                    ${escapeHtml(getRouteLabel(route))}
                  </strong>

                  <span
                    class="
                      route-status-pill
                      ${escapeHtml(routeStatus)}
                    "
                  >
                    ${escapeHtml(routeStatusLabel(route))}
                  </span>

                </div>


                <span class="planned-route-row-meta">
                  Driver:
                  ${escapeHtml(getRouteDriverName(route))}
                </span>


                <span class="planned-route-row-meta">
                  Vehicle:
                  ${escapeHtml(getRouteVehicleName(route))}
                </span>


                <span class="planned-route-row-summary">
                  ${summary.stopCount} stops ·
                  ${summary.orderCount} orders ·
                  ${formatVolume(summary.volume)}
                </span>


                <span class="planned-route-arrow">
                  ⌄
                </span>

              </div>


              <div class="planned-route-orders">

                <table class="planned-orders-table">

                  <thead>
                    <tr>
                      <th>Stop</th>
                      <th>Customer</th>
                      <th>SO Number</th>
                      <th>ACK Number</th>
                      <th>Planned ETA</th>
                      <th>Colli</th>
                      <th>Volume</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${stopsRows}
                  </tbody>

                </table>

              </div>

            </article>
          `;
        }
      ).join(
        ""
      );

    bindPlannedRouteEvents();
  }


  function bindPlannedRouteEvents() {
    document
      .querySelectorAll(
        "[data-planned-route-head]"
      )
      .forEach(
        head => {
          head.addEventListener(
            "click",
            event => {
              if (
                event.target.closest(
                  "input"
                )
              ) {
                return;
              }

              const wrapper =
                head.closest(
                  ".planned-route-row"
                );

              wrapper
                ?.classList
                .toggle(
                  "open"
                );

              selectRoute(
                head.dataset
                  .plannedRouteHead
              );
            }
          );
        }
      );


    document
      .querySelectorAll(
        ".planned-route-row [data-route-check]"
      )
      .forEach(
        checkbox => {
          checkbox.addEventListener(
            "change",
            event => {
              event.stopPropagation();

              const id =
                String(
                  checkbox.dataset
                    .routeCheck
                );

              if (
                checkbox.checked
              ) {
                selectedRouteIds
                  .add(id);
              } else {
                selectedRouteIds
                  .delete(id);
              }

              renderRouteCards();
              renderRouteColourLegend();
              redrawMap();
            }
          );
        }
      );
  }


  /* =========================================================
     SELECT ROUTE
  ========================================================= */

function selectRoute(routeId) {
  const route =
    getRouteById(
      routeId
    );

  if (
    !route
  ) {
    return;
  }

  /*
   * selectedRouteId is only the route
   * currently being viewed in detail.
   *
   * It does NOT control map visibility.
   */
  selectedRouteId =
    route.id;

  renderSelectedRoute(
    route
  );
}

function openRouteModal(
  routeId
) {
  const route =
    getRouteById(
      routeId
    );

  if (
    !route
  ) {
    return;
  }


  /*
   * IMPORTANT:
   *
   * Do NOT change selectedRouteId here.
   *
   * selectedRouteId belongs to the fixed route
   * shown beside the map and in the order list
   * below the map.
   *
   * Clicking a route card should only open
   * that route in this popup.
   */


  const modal =
    byId(
      "routeDetailModal"
    );

  const body =
    byId(
      "routeDetailModalBody"
    );


  if (
    !modal ||
    !body
  ) {
    console.warn(
      "[route-tracking] Route modal HTML not found."
    );

    return;
  }


  body.innerHTML =
    buildRouteModalHtml(
      route
    );


  modal.classList.add(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  document.body
    .classList
    .add(
      "route-modal-open"
    );
}

function closeRouteModal() {
  const modal =
    byId(
      "routeDetailModal"
    );


  if (
    !modal
  ) {
    return;
  }


  modal.classList.remove(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  document.body
    .classList
    .remove(
      "route-modal-open"
    );


  /*
   * Do NOT reset selectedRouteId.
   *
   * It must remain the fixed route used
   * for the summary and order list.
   */
}

function buildRouteModalHtml(
  route
) {
  const summary =
    getRouteSummary(
      route
    );

  const routeStatus =
    getRouteStatus(
      route
    );

  const plannedMiles =
    Math.max(
      toNumber(
        route.estimated_distance_miles,
        0
      ),
      toNumber(
        route.distance_miles,
        0
      )
    );

  const stopsHtml =
    summary.stops
      .map(
        (
          stop,
          index
        ) => {
          const order =
            getOrderById(
              stop.order_id
            );

          const status =
            getStopStatus(
              stop,
              order
            );

          const eta =
            formatTime(
              stop.planned_arrival_time ||
              stop.arrival_eta ||
              stop.eta
            );

          return `
            <tr>

              <td>
                <strong>
                  ${escapeHtml(
                    stop.stop_sequence ||
                    stop.stop_number ||
                    index + 1
                  )}
                </strong>
              </td>

              <td>

                <strong>
                  ${escapeHtml(
                    getRetailerName(
                      order,
                      stop
                    )
                  )}
                </strong>

                <div class="route-modal-address">
                  ${escapeHtml(stop.city || "")}
                  ${escapeHtml(stop.postcode || "")}
                </div>

              </td>

              <td>
                <strong>
                  ${escapeHtml(
                    getSoNumber(
                      order
                    )
                  )}
                </strong>
              </td>

              <td>
                ${escapeHtml(
                  getAckNumber(
                    order
                  )
                )}
              </td>

              <td>
                ${escapeHtml(
                  eta
                )}
              </td>

              <td>
                ${toNumber(
                  stop.planned_colli,
                  0
                )}
              </td>

              <td>
                ${formatVolume(
                  stop.planned_volume_m3
                )}
              </td>

              <td>

                <span
                  class="
                    route-status-pill
                    ${escapeHtml(status)}
                  "
                >
                  ${escapeHtml(
                    titleCase(
                      status
                    )
                  )}
                </span>

              </td>

            </tr>
          `;
        }
      )
      .join("");

  return `

    <div class="route-modal-header">

      <div>

        <div class="route-modal-eyebrow">
          ${
            isTodayRoute(route)
              ? "Today's Route"
              : formatDateLong(
                  getRouteDate(
                    route
                  )
                )
          }
        </div>

        <h2>
          ${escapeHtml(
            getRouteLabel(
              route
            )
          )}
        </h2>

        <div class="route-modal-meta">

          <span>
            Driver:
            <strong>
              ${escapeHtml(
                getRouteDriverName(
                  route
                )
              )}
            </strong>
          </span>

          <span>
            Vehicle:
            <strong>
              ${escapeHtml(
                getRouteVehicleName(
                  route
                )
              )}
            </strong>
          </span>

          <span
            class="
              route-status-pill
              ${escapeHtml(routeStatus)}
            "
          >
            ${escapeHtml(
              routeStatusLabel(
                route
              )
            )}
          </span>

        </div>

      </div>

      <button
        type="button"
        class="route-modal-close"
        data-close-route-modal
        aria-label="Close"
      >
        ×
      </button>

    </div>


    <div class="route-modal-kpis">

      <div>
        <span>Stops</span>
        <strong>
          ${summary.stopCount}
        </strong>
      </div>

      <div>
        <span>Orders</span>
        <strong>
          ${summary.orderCount}
        </strong>
      </div>

      <div>
        <span>Colli</span>
        <strong>
          ${summary.colli}
        </strong>
      </div>

      <div>
        <span>Volume</span>
        <strong>
          ${formatVolume(summary.volume)}
        </strong>
      </div>

      <div>
        <span>Distance</span>
        <strong>
          ${
            plannedMiles
              ? formatMiles(
                  plannedMiles
                )
              : "—"
          }
        </strong>
      </div>

    </div>


    <div class="route-modal-table-wrap">

      <table class="route-modal-table">

        <thead>

          <tr>

            <th>Stop</th>
            <th>Customer</th>
            <th>SO Number</th>
            <th>ACK Number</th>
            <th>ETA</th>
            <th>Colli</th>
            <th>Volume</th>
            <th>Status</th>

          </tr>

        </thead>

        <tbody>

          ${stopsHtml}

        </tbody>

      </table>

    </div>
  `;
}

function buildFullRouteReportHtml(
  route
) {
  if (
    !route
  ) {
    return "";
  }


  const summary =
    getRouteSummary(
      route
    );


  const actualMetrics =
    calculateActualRouteMetrics(
      route
    );


  const stopPerformance =
    calculateStopPerformance(
      route
    );


  const routeStatus =
    getRouteStatus(
      route
    );


  const plannedMiles =
    Math.max(
      toNumber(
        route.estimated_distance_miles,
        0
      ),
      toNumber(
        route.distance_miles,
        0
      )
    );


const firstMovement =
  getFirstMovementTime(
    route
  );


  const lastMovement =
    actualMetrics
      .points
      ?.length
      ? formatTime(
          actualMetrics
            .points[
              actualMetrics
                .points
                .length -
              1
            ]
            .recorded_at
        )
      : "—";


  const totalMinutes =
    actualMetrics
      .totalMinutes ||
    toNumber(
      route
        .estimated_total_hours,
      0
    ) *
    60;


  return `

    <div class="route-modal-header">

      <div>

        <div class="route-modal-eyebrow">
          Full Route Report
        </div>

        <h2>
          ${escapeHtml(
            getRouteLabel(
              route
            )
          )}
        </h2>

        <div class="route-modal-meta">

          <span>
            ${escapeHtml(
              formatDateLong(
                getRouteDate(
                  route
                )
              )
            )}
          </span>

          <span>
            Driver:
            <strong>
              ${escapeHtml(
                getRouteDriverName(
                  route
                )
              )}
            </strong>
          </span>

          <span>
            Vehicle:
            <strong>
              ${escapeHtml(
                getRouteVehicleName(
                  route
                )
              )}
            </strong>
          </span>

          <span
            class="
              route-status-pill
              ${escapeHtml(routeStatus)}
            "
          >
            ${escapeHtml(
              routeStatusLabel(
                route
              )
            )}
          </span>

        </div>

      </div>


      <button
        type="button"
        class="route-modal-close"
        data-close-route-modal
        aria-label="Close"
      >
        ×
      </button>

    </div>


    <div class="route-modal-kpis">

      <div>
        <span>Stops</span>
        <strong>
          ${summary.stopCount}
        </strong>
      </div>

      <div>
        <span>Completed</span>
        <strong>
          ${summary.completed}
        </strong>
      </div>

      <div>
        <span>Remaining</span>
        <strong>
          ${summary.remaining}
        </strong>
      </div>

      <div>
        <span>Volume</span>
        <strong>
          ${formatVolume(
            summary.volume
          )}
        </strong>
      </div>

      <div>
        <span>Distance</span>
        <strong>
          ${
            plannedMiles
              ? formatMiles(
                  plannedMiles
                )
              : "—"
          }
        </strong>
      </div>

    </div>


    <div
      style="
        padding:18px;
        display:grid;
        grid-template-columns:
          repeat(
            3,
            minmax(220px,1fr)
          );
        gap:16px;
      "
    >


      <!-- ROUTE TIMING -->

      <section
        style="
          border:1px solid #e5e7eb;
          border-radius:10px;
          padding:15px;
          display:grid;
          gap:9px;
        "
      >

        <h3
          style="
            margin:0 0 5px;
            font-size:13px;
          "
        >
          Route Timing
        </h3>


        <div class="summary-row">
          <span>Planned Start</span>
          <strong>
            ${escapeHtml(
              formatTime(
                route.planned_start_time
              )
            )}
          </strong>
        </div>


        <div class="summary-row">
          <span>First Movement</span>
          <strong>
            ${escapeHtml(
              firstMovement
            )}
          </strong>
        </div>


        <div class="summary-row">
          <span>Last Movement</span>
          <strong>
            ${escapeHtml(
              lastMovement
            )}
          </strong>
        </div>


        <div class="summary-row">
          <span>Driving Time</span>
          <strong>
            ${
              actualMetrics.drivingMinutes
                ? formatDurationMinutes(
                    actualMetrics
                      .drivingMinutes
                  )
                : "—"
            }
          </strong>
        </div>


        <div class="summary-row">
          <span>Stop Time</span>
          <strong>
            ${
              actualMetrics.stopMinutes
                ? formatDurationMinutes(
                    actualMetrics
                      .stopMinutes
                  )
                : "—"
            }
          </strong>
        </div>


        <div class="summary-row">
          <span>Total Time</span>
          <strong>
            ${
              totalMinutes
                ? formatDurationMinutes(
                    totalMinutes
                  )
                : "—"
            }
          </strong>
        </div>

      </section>


      <!-- DISTANCE / GPS -->

      <section
        style="
          border:1px solid #e5e7eb;
          border-radius:10px;
          padding:15px;
          display:grid;
          gap:9px;
        "
      >

        <h3
          style="
            margin:0 0 5px;
            font-size:13px;
          "
        >
          Distance & GPS
        </h3>


        <div class="summary-row">
          <span>Planned Distance</span>
          <strong>
            ${
              plannedMiles
                ? formatMiles(
                    plannedMiles
                  )
                : "—"
            }
          </strong>
        </div>


        <div class="summary-row">
          <span>Actual Distance</span>
          <strong>
            ${
              actualMetrics.distanceMiles
                ? formatMiles(
                    actualMetrics
                      .distanceMiles
                  )
                : "—"
            }
          </strong>
        </div>


        <div class="summary-row">
          <span>Average Speed</span>
          <strong>
            ${
              actualMetrics.averageSpeedMph
                ? `${actualMetrics.averageSpeedMph.toFixed(0)} mph`
                : "—"
            }
          </strong>
        </div>


        <div class="summary-row">
          <span>Max Speed</span>
          <strong>
            ${
              actualMetrics.maxSpeedMph
                ? `${actualMetrics.maxSpeedMph.toFixed(0)} mph`
                : "—"
            }
          </strong>
        </div>


        <div class="summary-row">
          <span>GPS Gaps</span>
          <strong>
            ${actualMetrics.gpsGaps || 0}
          </strong>
        </div>

      </section>


      <!-- PERFORMANCE -->

      <section
        style="
          border:1px solid #e5e7eb;
          border-radius:10px;
          padding:15px;
          display:grid;
          gap:9px;
        "
      >

        <h3
          style="
            margin:0 0 5px;
            font-size:13px;
          "
        >
          Performance
        </h3>


        <div class="summary-row">
          <span>On Time</span>
          <strong>
            ${stopPerformance.onTime}
          </strong>
        </div>


        <div class="summary-row">
          <span>Early</span>
          <strong>
            ${stopPerformance.early}
          </strong>
        </div>


        <div class="summary-row">
          <span>Late</span>
          <strong>
            ${stopPerformance.late}
          </strong>
        </div>


        <div class="summary-row">
          <span>Longest Stop</span>
          <strong>
            ${
              stopPerformance
                .longestStop
                ? `${formatDurationMinutes(
                    stopPerformance
                      .longestStopMinutes
                  )} · ${escapeHtml(
                    getRetailerName(
                      stopPerformance
                        .longestStop
                        .order,
                      stopPerformance
                        .longestStop
                        .stop
                    )
                  )}`
                : "—"
            }
          </strong>
        </div>


        <div class="summary-row">
          <span>Idle Time</span>
          <strong>
            ${
              actualMetrics.stopMinutes
                ? formatDurationMinutes(
                    actualMetrics
                      .stopMinutes
                  )
                : "—"
            }
          </strong>
        </div>

      </section>

    </div>
  `;
}

function openFullRouteReport() {
  if (
    !selectedRouteId
  ) {
    showToast(
      "No route selected.",
      "err"
    );

    return;
  }


  const route =
    getRouteById(
      selectedRouteId
    );


  if (
    !route
  ) {
    showToast(
      "Route could not be found.",
      "err"
    );

    return;
  }


  const modal =
    byId(
      "routeDetailModal"
    );


  const body =
    byId(
      "routeDetailModalBody"
    );


  if (
    !modal ||
    !body
  ) {
    return;
  }


  body.innerHTML =
    buildFullRouteReportHtml(
      route
    );


  modal.classList.add(
    "open"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  document.body
    .classList
    .add(
      "route-modal-open"
    );
}


  /* =========================================================
     SELECTED ROUTE DETAIL
  ========================================================= */

function renderSelectedRoute(
  route
) {
  if (
    !route
  ) {
    return;
  }


  const summary =
    getRouteSummary(
      route
    );


  const routeStatus =
    getRouteStatus(
      route
    );


  /* =======================================================
     RIGHT-HAND ROUTE SUMMARY
  ======================================================= */

  const titleEl =
    byId(
      "selectedRouteTitle"
    );

  if (
    titleEl
  ) {
    titleEl.textContent =
      `${
        isTodayRoute(route)
          ? "Today's Route"
          : "Next Route"
      } – ${getRouteLabel(route)}`;
  }


  const statusEl =
    byId(
      "selectedRouteStatus"
    );

  if (
    statusEl
  ) {
    statusEl.textContent =
      routeStatusLabel(
        route
      );

    statusEl.className =
      `route-status-pill ${routeStatus}`;
  }


  const driverEl =
    byId(
      "selectedRouteDriver"
    );

  if (
    driverEl
  ) {
    driverEl.textContent =
      `Driver: ${getRouteDriverName(route)}`;
  }


  const vehicleEl =
    byId(
      "selectedRouteVehicle"
    );

  if (
    vehicleEl
  ) {
    vehicleEl.textContent =
      `Vehicle: ${getRouteVehicleName(route)}`;
  }


  /* =======================================================
     ORDER PANEL HEADER
  ======================================================= */

  const ordersTitle =
    byId(
      "routeOrdersTitle"
    );

  if (
    ordersTitle
  ) {
    ordersTitle.textContent =
      isTodayRoute(route)
        ? "Today's Route Orders"
        : `Route Orders – ${formatDate(
            getRouteDate(route)
          )}`;
  }


  const ordersMeta =
    byId(
      "routeOrdersMeta"
    );

  if (
    ordersMeta
  ) {
    ordersMeta.textContent =
      `${getRouteLabel(route)} · ` +
      `${summary.orderCount} order${summary.orderCount === 1 ? "" : "s"} · ` +
      `${summary.stopCount} stop${summary.stopCount === 1 ? "" : "s"} · ` +
      `${formatVolume(summary.volume)}`;
  }


  /* =======================================================
     ROUTE DISTANCE / TIME
  ======================================================= */

  const plannedMiles =
    Math.max(
      toNumber(
        route
          .estimated_distance_miles,
        0
      ),
      toNumber(
        route
          .distance_miles,
        0
      )
    );


  const actualMetrics =
    calculateActualRouteMetrics(
      route
    );


  const plannedDistanceEl =
    byId(
      "routePlannedDistance"
    );

  if (
    plannedDistanceEl
  ) {
    plannedDistanceEl.textContent =
      plannedMiles
        ? formatMiles(
            plannedMiles
          )
        : "—";
  }


  const actualDistanceEl =
    byId(
      "routeActualDistance"
    );

  if (
    actualDistanceEl
  ) {
    actualDistanceEl.textContent =
      actualMetrics
        .distanceMiles
        ? formatMiles(
            actualMetrics
              .distanceMiles
          )
        : "—";
  }


  const drivingTimeEl =
    byId(
      "routeDrivingTime"
    );

  if (
    drivingTimeEl
  ) {
    drivingTimeEl.textContent =
      actualMetrics
        .drivingMinutes
        ? formatDurationMinutes(
            actualMetrics
              .drivingMinutes
          )
        : "—";
  }


  const stopTimeEl =
    byId(
      "routeStopTime"
    );

  if (
    stopTimeEl
  ) {
    stopTimeEl.textContent =
      actualMetrics
        .stopMinutes
        ? formatDurationMinutes(
            actualMetrics
              .stopMinutes
          )
        : "—";
  }


  const totalMinutes =
    actualMetrics
      .totalMinutes ||
    toNumber(
      route
        .estimated_total_hours,
      0
    ) *
    60;


  const totalTimeEl =
    byId(
      "routeTotalTime"
    );

  if (
    totalTimeEl
  ) {
    totalTimeEl.textContent =
      totalMinutes
        ? formatDurationMinutes(
            totalMinutes
          )
        : "—";
  }


  const averageSpeedEl =
    byId(
      "routeAverageSpeed"
    );

  if (
    averageSpeedEl
  ) {
    averageSpeedEl.textContent =
      actualMetrics
        .averageSpeedMph
        ? `${actualMetrics.averageSpeedMph.toFixed(0)} mph`
        : "—";
  }


  /* =======================================================
     PROGRESS
  ======================================================= */

  const progressText =
    byId(
      "routeProgressText"
    );

  if (
    progressText
  ) {
    progressText.textContent =
      `${summary.progress.toFixed(0)}%`;
  }


  const progressFill =
    byId(
      "routeProgressFill"
    );

  if (
    progressFill
  ) {
    progressFill.style.width =
      `${Math.min(
        100,
        summary.progress
      )}%`;
  }


  const progressStops =
    byId(
      "routeProgressStops"
    );

  if (
    progressStops
  ) {
    progressStops.textContent =
      `${summary.completed} / ${summary.stopCount} stops`;
  }


  /* =======================================================
     NEXT STOP
  ======================================================= */

  const nextStop =
    findNextStop(
      route
    );


  const nextStopEl =
    byId(
      "routeNextStop"
    );

  if (
    nextStopEl
  ) {
    nextStopEl.textContent =
      nextStop
        ? getRetailerName(
            nextStop.order,
            nextStop.stop
          )
        : "Route complete";
  }


  const nextEtaEl =
    byId(
      "routeNextEta"
    );

  if (
    nextEtaEl
  ) {
    nextEtaEl.textContent =
      nextStop
        ? `ETA ${formatTime(
            nextStop
              .stop
              .planned_arrival_time ||
            nextStop
              .stop
              .arrival_eta ||
            nextStop
              .stop
              .eta
          )}`
        : "";
  }


  /* =======================================================
     ORDER ROWS
  ======================================================= */

  renderSelectedRouteStops(
    route
  );


  /* =======================================================
     SUMMARY / PERFORMANCE DATA
  ======================================================= */

  renderRouteSummary(
    route,
    summary,
    actualMetrics
  );
}

  /* =========================================================
     STOP TABLE
  ========================================================= */

  function renderSelectedRouteStops(route) {
    const tbody =
      byId(
        "selectedRouteStopsBody"
      );

    if (!tbody) {
      return;
    }

    const stops =
      getStopsForRoute(
        route.id
      );

    if (
      !stops.length
    ) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10">
            No stops found.
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML =
      stops.map(
        (
          stop,
          index
        ) => {
          const order =
            getOrderById(
              stop.order_id
            );

          const status =
            getStopStatus(
              stop,
              order
            );

          const plannedTime =
            formatTime(
              stop.planned_arrival_time ||
              stop.arrival_eta ||
              stop.eta
            );

          const actualArrival =
            getActualArrivalTime(
              stop,
              order
            );

          const variance =
            calculateTimeVarianceMinutes(
              plannedTime,
              actualArrival
            );

          let actualClass =
            "";

          if (
            variance !== null
          ) {
            if (
              variance <
              -ON_TIME_THRESHOLD_MINUTES
            ) {
              actualClass =
                "time-early";
            } else if (
              variance >
              ON_TIME_THRESHOLD_MINUTES
            ) {
              actualClass =
                "time-late";
            } else {
              actualClass =
                "time-current";
            }
          }

          const rowClass =
            status ===
            "out_for_delivery"
              ? "current-stop"
              : status ===
                "delivery_issue"
              ? "delivery-issue"
              : status ===
                "failed_delivery"
              ? "failed-delivery"
              : "";

          return `
            <tr
              class="${rowClass}"
              data-stop-row="${escapeHtml(stop.id)}"
            >

              <td>
                <span class="stop-number">
                  ${escapeHtml(
                    stop.stop_sequence ||
                    stop.stop_number ||
                    index + 1
                  )}
                </span>
              </td>


              <td>
                <div class="stop-customer">

                  <strong>
                    ${escapeHtml(
                      getRetailerName(
                        order,
                        stop
                      )
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(stop.city || "")}
                    ${escapeHtml(stop.postcode || "")}
                  </span>

                </div>
              </td>


              <td>
                <div class="stop-order-ref">

                  <strong>
                    ${escapeHtml(getSoNumber(order))}
                  </strong>

                </div>
              </td>


              <td>
                <div class="stop-order-ref">

                  <span>
                    ${escapeHtml(getAckNumber(order))}
                  </span>

                </div>
              </td>


              <td>
                ${escapeHtml(plannedTime)}
              </td>


              <td
                class="${actualClass}"
              >
                ${escapeHtml(actualArrival || "—")}
              </td>


              <td>
                <span
                  class="
                    route-status-pill
                    ${escapeHtml(status)}
                  "
                >
                  ${escapeHtml(
                    titleCase(status)
                  )}
                </span>
              </td>


              <td>
                ${toNumber(
                  stop.planned_colli,
                  0
                )}
              </td>


              <td>
                ${formatVolume(
                  stop.planned_volume_m3
                )}
              </td>


              <td>
                ⌄
              </td>

            </tr>


            <tr
              class="route-stop-detail-row"
              data-stop-detail="${escapeHtml(stop.id)}"
            >

              <td colspan="10">

                ${buildStopDetailHtml(
                  stop,
                  order
                )}

              </td>

            </tr>
          `;
        }
      ).join(
        ""
      );

    bindStopRows();
  }


  function bindStopRows() {
    document
      .querySelectorAll(
        "[data-stop-row]"
      )
      .forEach(
        row => {
          row.addEventListener(
            "click",
            () => {
              const id =
                row.dataset
                  .stopRow;

              const detail =
                document.querySelector(
                  `[data-stop-detail="${CSS.escape(id)}"]`
                );

              detail
                ?.classList
                .toggle(
                  "open"
                );
            }
          );
        }
      );
  }


  function buildStopDetailHtml(
    stop,
    order
  ) {
    const arrival =
      getActualArrivalTime(
        stop,
        order
      );

    const departure =
      getActualDepartureTime(
        stop,
        order
      );

    const podTime =
      formatTime(
        order
          ?.pod_signed_at
      );

    const onSite =
      calculateOnSiteMinutes(
        arrival,
        departure,
        podTime
      );

    const podAvailable =
      !!(
        order
          ?.pod_document_url
      );

    return `
      <div class="route-stop-detail">

        <div class="route-stop-detail-stat">
          <span>Arrived</span>
          <strong>${escapeHtml(arrival || "—")}</strong>
        </div>

        <div class="route-stop-detail-stat">
          <span>Departed</span>
          <strong>${escapeHtml(departure || "—")}</strong>
        </div>

        <div class="route-stop-detail-stat">
          <span>On Site</span>
          <strong>
            ${
              onSite !== null
                ? formatDurationMinutes(onSite)
                : "—"
            }
          </strong>
        </div>

        <div class="route-stop-detail-stat">
          <span>POD Signed</span>
          <strong>${escapeHtml(podTime)}</strong>
        </div>

        <div class="route-stop-detail-stat">
          <span>Receiver</span>
          <strong>
            ${escapeHtml(
              order
                ?.pod_signed_by ||
              stop
                ?.delivered_to ||
              "—"
            )}
          </strong>
        </div>

        ${
          podAvailable
            ? `
              <button
                class="route-control-btn primary"
                type="button"
                onclick="
                  window.open(
                    '${escapeHtml(order.pod_document_url)}',
                    '_blank'
                  )
                "
              >
                View POD
              </button>
            `
            : `
              <span style="
                color:#64748b;
                font-size:9px;
                align-self:center;
              ">
                ${
                  getStopStatus(
                    stop,
                    order
                  ) === "delivered"
                    ? "POD processing"
                    : "Waiting for POD"
                }
              </span>
            `
        }

      </div>
    `;
  }


  /* =========================================================
     ACTUAL STOP TIMES
  ========================================================= */

  function getActualArrivalTime(
    stop,
    order
  ) {
    return formatTime(
      stop
        ?.actual_arrival_time ||
      stop
        ?.arrival_time ||
      stop
        ?.arrived_at ||
      stop
        ?.delivery_time ||
      order
        ?.actual_arrival_time ||
      ""
    );
  }


  function getActualDepartureTime(
    stop,
    order
  ) {
    return formatTime(
      stop
        ?.actual_departure_time ||
      stop
        ?.departure_time ||
      stop
        ?.departed_at ||
      stop
        ?.completed_at ||
      order
        ?.pod_signed_at ||
      ""
    );
  }


  function calculateTimeVarianceMinutes(
    planned,
    actual
  ) {
    if (
      !planned ||
      !actual ||
      planned === "—" ||
      actual === "—"
    ) {
      return null;
    }

    const plannedMinutes =
      hhmmToMinutes(
        planned
      );

    const actualMinutes =
      hhmmToMinutes(
        actual
      );

    if (
      plannedMinutes === null ||
      actualMinutes === null
    ) {
      return null;
    }

    return (
      actualMinutes -
      plannedMinutes
    );
  }


  function hhmmToMinutes(value) {
    const match =
      String(
        value ||
        ""
      ).match(
        /^(\d{1,2}):(\d{2})/
      );

    if (!match) {
      return null;
    }

    return (
      Number(match[1]) *
      60 +
      Number(match[2])
    );
  }


  function calculateOnSiteMinutes(
    arrival,
    departure,
    fallbackPod
  ) {
    const start =
      hhmmToMinutes(
        arrival
      );

    const end =
      hhmmToMinutes(
        departure ||
        fallbackPod
      );

    if (
      start === null ||
      end === null
    ) {
      return null;
    }

    let diff =
      end -
      start;

    if (
      diff < 0
    ) {
      diff +=
        1440;
    }

    return diff;
  }


  /* =========================================================
     NEXT STOP
  ========================================================= */

  function findNextStop(route) {
    const stops =
      getStopsForRoute(
        route.id
      );

    for (
      const stop of stops
    ) {
      const order =
        getOrderById(
          stop.order_id
        );

      const status =
        getStopStatus(
          stop,
          order
        );

      if (
        ![
          "delivered",
          "delivery_issue",
          "failed_delivery"
        ].includes(
          status
        )
      ) {
        return {
          stop,
          order
        };
      }
    }

    return null;
  }


  /* =========================================================
     ROUTE PERFORMANCE
  ========================================================= */

function getFirstMovementTime(
  route
) {
  const points =
    driverLocationHistory
      .filter(
        row =>
          String(
            row.route_id
          ) ===
          String(
            route.id
          )
      )
      .sort(
        (a, b) =>
          new Date(
            a.recorded_at
          ) -
          new Date(
            b.recorded_at
          )
      );


  if (
    points.length <
    2
  ) {
    return "—";
  }


  for (
    let i = 1;
    i < points.length;
    i++
  ) {
    const previous =
      points[i - 1];

    const current =
      points[i];


    const previousTime =
      new Date(
        previous.recorded_at
      ).getTime();


    const currentTime =
      new Date(
        current.recorded_at
      ).getTime();


    const deltaMs =
      Math.max(
        0,
        currentTime -
        previousTime
      );


    const distance =
      haversineMeters(
        previous.latitude,
        previous.longitude,
        current.latitude,
        current.longitude
      );


    /*
     * Prefer the speed supplied by GPS.
     * If unavailable, calculate speed
     * from distance and elapsed time.
     */
    const speedMps =
      Number.isFinite(
        Number(
          current.speed_mps
        )
      )
        ? Number(
            current.speed_mps
          )
        : deltaMs > 0
          ? distance /
            (
              deltaMs /
              1000
            )
          : 0;


    const mph =
      speedMps *
      2.23694;


    /*
     * First Movement is the first
     * recorded point ABOVE 10 mph.
     */
    if (
      mph > 10
    ) {
      return formatTime(
        current.recorded_at
      );
    }
  }


  return "—";
}

  function calculateActualRouteMetrics(route) {
    const points =
      driverLocationHistory
        .filter(
          row =>
            String(
              row.route_id
            ) ===
            String(
              route.id
            )
        )
        .sort(
          (a, b) =>
            new Date(
              a.recorded_at
            ) -
            new Date(
              b.recorded_at
            )
        );

    if (
      points.length <
      2
    ) {
      return {
        points,
        distanceMiles:
          0,
        drivingMinutes:
          0,
        stopMinutes:
          0,
        totalMinutes:
          0,
        averageSpeedMph:
          0,
        maxSpeedMph:
          0,
        gpsGaps:
          0
      };
    }

    let distanceMeters =
      0;

    let drivingMs =
      0;

    let stoppedMs =
      0;

    let gpsGaps =
      0;

    let maxSpeedMph =
      0;

    let movingSpeedTotal =
      0;

    let movingSpeedCount =
      0;


    for (
      let i = 1;
      i < points.length;
      i++
    ) {
      const previous =
        points[i - 1];

      const current =
        points[i];

      const distance =
        haversineMeters(
          previous.latitude,
          previous.longitude,
          current.latitude,
          current.longitude
        );

      const previousTime =
        new Date(
          previous.recorded_at
        ).getTime();

      const currentTime =
        new Date(
          current.recorded_at
        ).getTime();

      const deltaMs =
        Math.max(
          0,
          currentTime -
          previousTime
        );

      distanceMeters +=
        distance;


      if (
        deltaMs >
        120000
      ) {
        gpsGaps++;
      }


      const speedMps =
        Number.isFinite(
          Number(
            current.speed_mps
          )
        )
          ? Number(
              current.speed_mps
            )
          : deltaMs > 0
          ? distance /
            (
              deltaMs /
              1000
            )
          : 0;


      const mph =
        speedMps *
        2.23694;


      maxSpeedMph =
        Math.max(
          maxSpeedMph,
          mph
        );


      if (
        mph >= 3
      ) {
        drivingMs +=
          deltaMs;

        movingSpeedTotal +=
          mph;

        movingSpeedCount++;
      } else {
        stoppedMs +=
          deltaMs;
      }
    }


    const first =
      new Date(
        points[0]
          .recorded_at
      ).getTime();

    const last =
      new Date(
        points[
          points.length - 1
        ].recorded_at
      ).getTime();


    return {
      points,

      distanceMiles:
        distanceMeters /
        1609.344,

      drivingMinutes:
        drivingMs /
        60000,

      stopMinutes:
        stoppedMs /
        60000,

      totalMinutes:
        Math.max(
          0,
          (
            last -
            first
          ) /
          60000
        ),

      averageSpeedMph:
        movingSpeedCount
          ? movingSpeedTotal /
            movingSpeedCount
          : 0,

      maxSpeedMph,

      gpsGaps
    };
  }


  function calculateStopPerformance(route) {
    const stops =
      getStopsForRoute(
        route.id
      );

    let onTime =
      0;

    let early =
      0;

    let late =
      0;

    let longestStop =
      null;

    let longestStopMinutes =
      0;


    stops.forEach(
      stop => {
        const order =
          getOrderById(
            stop.order_id
          );

        const planned =
          formatTime(
            stop
              .planned_arrival_time ||
            stop
              .arrival_eta
          );

        const actual =
          getActualArrivalTime(
            stop,
            order
          );

        const variance =
          calculateTimeVarianceMinutes(
            planned,
            actual
          );


        if (
          variance !== null
        ) {
          if (
            variance <
            -ON_TIME_THRESHOLD_MINUTES
          ) {
            early++;
          } else if (
            variance >
            ON_TIME_THRESHOLD_MINUTES
          ) {
            late++;
          } else {
            onTime++;
          }
        }


        const onSite =
          calculateOnSiteMinutes(
            actual,
            getActualDepartureTime(
              stop,
              order
            ),
            formatTime(
              order
                ?.pod_signed_at
            )
          );


        if (
          onSite !== null &&
          onSite >
          longestStopMinutes
        ) {
          longestStopMinutes =
            onSite;

          longestStop = {
            stop,
            order
          };
        }
      }
    );


    return {
      onTime,
      early,
      late,
      longestStop,
      longestStopMinutes
    };
  }


  /* =========================================================
     ROUTE SUMMARY SIDE PANEL
  ========================================================= */

function renderRouteSummary(
  route,
  summary,
  actualMetrics
) {
  const stopPerformance =
    calculateStopPerformance(
      route
    );


  const routeSummaryStart =
    byId(
      "routeSummaryStart"
    );

  if (
    routeSummaryStart
  ) {
    routeSummaryStart.textContent =
      formatTime(
        route
          .planned_start_time
      );
  }


  /*
   * First Movement:
   * first GPS point above 10 mph.
   */
  const firstMovementEl =
    byId(
      "routeSummaryFirstMovement"
    );

  if (
    firstMovementEl
  ) {
    firstMovementEl.textContent =
      getFirstMovementTime(
        route
      );
  }


  const lastMovementEl =
    byId(
      "routeSummaryLastMovement"
    );

  if (
    lastMovementEl
  ) {
    lastMovementEl.textContent =
      actualMetrics
        .points
        ?.length
        ? formatTime(
            actualMetrics
              .points[
                actualMetrics
                  .points
                  .length -
                1
              ]
              .recorded_at
          )
        : "—";
  }


  const completedEl =
    byId(
      "routeSummaryCompleted"
    );

  if (
    completedEl
  ) {
    completedEl.textContent =
      `${summary.completed} / ${summary.stopCount} stops`;
  }


  const inProgressEl =
    byId(
      "routeSummaryInProgress"
    );

  if (
    inProgressEl
  ) {
    inProgressEl.textContent =
      String(
        summary.active
      );
  }


  const remainingEl =
    byId(
      "routeSummaryRemaining"
    );

  if (
    remainingEl
  ) {
    remainingEl.textContent =
      String(
        summary.remaining
      );
  }


  const plannedMiles =
    Math.max(
      toNumber(
        route
          .estimated_distance_miles,
        0
      ),
      toNumber(
        route
          .distance_miles,
        0
      )
    );


  const performanceDistanceEl =
    byId(
      "routePerformanceDistance"
    );

  if (
    performanceDistanceEl
  ) {
    performanceDistanceEl.textContent =
      actualMetrics
        .distanceMiles
        ? `${plannedMiles.toFixed(0)} vs ${actualMetrics.distanceMiles.toFixed(0)} mi`
        : plannedMiles
          ? `${plannedMiles.toFixed(0)} mi planned`
          : "—";
  }


  const onTimeEl =
    byId(
      "routePerformanceOnTime"
    );

  if (
    onTimeEl
  ) {
    onTimeEl.textContent =
      String(
        stopPerformance
          .onTime
      );
  }


  const earlyEl =
    byId(
      "routePerformanceEarly"
    );

  if (
    earlyEl
  ) {
    earlyEl.textContent =
      String(
        stopPerformance
          .early
      );
  }


  const lateEl =
    byId(
      "routePerformanceLate"
    );

  if (
    lateEl
  ) {
    lateEl.textContent =
      String(
        stopPerformance
          .late
      );
  }


  const averageSpeedEl =
    byId(
      "routePerformanceAverageSpeed"
    );

  if (
    averageSpeedEl
  ) {
    averageSpeedEl.textContent =
      actualMetrics
        .averageSpeedMph
        ? `${actualMetrics.averageSpeedMph.toFixed(0)} mph`
        : "—";
  }


  const maxSpeedEl =
    byId(
      "routePerformanceMaxSpeed"
    );

  if (
    maxSpeedEl
  ) {
    maxSpeedEl.textContent =
      actualMetrics
        .maxSpeedMph
        ? `${actualMetrics.maxSpeedMph.toFixed(0)} mph`
        : "—";
  }


  const longestStopEl =
    byId(
      "routePerformanceLongestStop"
    );

  if (
    longestStopEl
  ) {
    longestStopEl.textContent =
      stopPerformance
        .longestStop
        ? `${formatDurationMinutes(
            stopPerformance
              .longestStopMinutes
          )} · ${
            getRetailerName(
              stopPerformance
                .longestStop
                .order,
              stopPerformance
                .longestStop
                .stop
            )
          }`
        : "—";
  }


  const unplannedStopsEl =
    byId(
      "routePerformanceUnplannedStops"
    );

  if (
    unplannedStopsEl
  ) {
    unplannedStopsEl.textContent =
      "—";
  }


  const idleTimeEl =
    byId(
      "routePerformanceIdleTime"
    );

  if (
    idleTimeEl
  ) {
    idleTimeEl.textContent =
      actualMetrics
        .stopMinutes
        ? formatDurationMinutes(
            actualMetrics
              .stopMinutes
          )
        : "—";
  }


  const gpsGapsEl =
    byId(
      "routePerformanceGpsGaps"
    );

  if (
    gpsGapsEl
  ) {
    gpsGapsEl.textContent =
      String(
        actualMetrics
          .gpsGaps ||
        0
      );
  }
}


  /* =========================================================
     MAP INIT
  ========================================================= */

 function initMap() {
  const mapEl =
    byId(
      "routeTrackingMap"
    );

  if (
    !mapEl ||
    typeof L ===
      "undefined"
  ) {
    return;
  }

  routeMap =
    L.map(
      mapEl,
      {
        zoomControl: true,
        attributionControl: true,

        /*
         * Prevents the user from accidentally
         * zooming out to the whole world.
         */
        minZoom: 5
      }
    );


  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,

      attribution:
        "&copy; OpenStreetMap contributors"
    }
  ).addTo(
    routeMap
  );


  depotLayer =
    L.layerGroup()
      .addTo(
        routeMap
      );


  routePlannedLayer =
    L.layerGroup()
      .addTo(
        routeMap
      );


  routeActualLayer =
    L.layerGroup()
      .addTo(
        routeMap
      );


  routeStopsLayer =
    L.layerGroup()
      .addTo(
        routeMap
      );


  routeLiveLayer =
    L.layerGroup()
      .addTo(
        routeMap
      );


  /*
   * Default UK view while route data loads.
   *
   * This is only temporary.
   * redrawMap() will automatically zoom
   * to the selected route afterwards.
   */
  routeMap.setView(
    [
      52.8,
      -2.0
    ],
    7
  );
}


  /* =========================================================
     MAP DRAW
  ========================================================= */

async function redrawMap() {
  if (!routeMap) {
    return;
  }

  depotLayer?.clearLayers();
  routePlannedLayer?.clearLayers();
  routeActualLayer?.clearLayers();
  routeStopsLayer?.clearLayers();
  routeLiveLayer?.clearLayers();

  const routes =
    getFilteredRoutes()
      .filter(
        route =>
          selectedRouteIds.has(
            String(route.id)
          )
      );

  const allBounds = [];


  /* =======================================================
     DEPOT
  ======================================================= */

  if (
    depotPoint &&
    Number.isFinite(
      Number(depotPoint.latitude)
    ) &&
    Number.isFinite(
      Number(depotPoint.longitude)
    )
  ) {
    const depotLatLng = [
      Number(depotPoint.latitude),
      Number(depotPoint.longitude)
    ];

    allBounds.push(
      depotLatLng
    );

    const marker =
      L.circleMarker(
        depotLatLng,
        {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: "#111827",
          fillOpacity: 1
        }
      );

    marker.bindPopup(
      `<strong>${escapeHtml(depotPoint.name)}</strong>`
    );

    depotLayer.addLayer(
      marker
    );
  }


  /* =======================================================
     ROUTES
  ======================================================= */

  for (
    let routeIndex = 0;
    routeIndex < routes.length;
    routeIndex++
  ) {
    const route =
      routes[routeIndex];

    const color =
      ROUTE_COLORS[
        routeIndex %
        ROUTE_COLORS.length
      ];


    /*
     * Draw road route first.
     */
    await drawPlannedRoute(
      route,
      color,
      allBounds
    );


    /*
     * Actual GPS route.
     */
    drawActualRoute(
      route,
      color,
      allBounds
    );


    /*
     * Live driver marker.
     */
    drawLiveLocation(
      route,
      allBounds
    );
  }


  /* =======================================================
     MAP POSITION
  ======================================================= */

  setTimeout(
    () => {
      routeMap.invalidateSize(
        true
      );

      if (
        allBounds.length
      ) {
        const bounds =
          L.latLngBounds(
            allBounds
          );

        if (
          bounds.isValid()
        ) {
          routeMap.fitBounds(
            bounds,
            {
              padding: [
                30,
                30
              ],

              maxZoom: 12
            }
          );

          return;
        }
      }


      /*
       * Fallback UK view.
       */
      routeMap.setView(
        [
          52.8,
          -2.0
        ],
        7
      );

    },
    80
  );
}

async function drawOsrmPlannedRoute(
  points,
  color
) {
  if (
    !routePlannedLayer ||
    !Array.isArray(points) ||
    points.length < 2
  ) {
    return false;
  }

  try {
    const coords =
      points
        .map(
          point =>
            `${point[1]},${point[0]}`
        )
        .join(";");

    const url =
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `OSRM route failed: ${response.status}`
      );
    }

    const result =
      await response.json();

    const geometry =
      result?.routes?.[0]?.geometry;

    if (!geometry) {
      throw new Error(
        "No OSRM route geometry returned."
      );
    }

    const roadRoute =
      L.geoJSON(
        geometry,
        {
          style: {
            color,
            weight: 4,
            opacity: 0.9
          }
        }
      );

    routePlannedLayer.addLayer(
      roadRoute
    );

    return true;

  } catch (error) {
    console.warn(
      "[route-tracking] OSRM planned route failed:",
      error
    );

    return false;
  }
}

async function drawPlannedRoute(
  route,
  color,
  allBounds
) {
  const stops =
    getStopsForRoute(
      route.id
    );

  const points = [];


  /* DEPOT START */
  if (
    depotPoint &&
    Number.isFinite(Number(depotPoint.latitude)) &&
    Number.isFinite(Number(depotPoint.longitude))
  ) {
    points.push([
      Number(depotPoint.latitude),
      Number(depotPoint.longitude)
    ]);

    allBounds.push([
      Number(depotPoint.latitude),
      Number(depotPoint.longitude)
    ]);
  }


  /* STOPS */
  stops.forEach(
    (
      stop,
      index
    ) => {
      const lat =
        Number(
          stop.latitude
        );

      const lng =
        Number(
          stop.longitude
        );

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return;
      }

      points.push([
        lat,
        lng
      ]);

      allBounds.push([
        lat,
        lng
      ]);


      const order =
        getOrderById(
          stop.order_id
        );

      const status =
        getStopStatus(
          stop,
          order
        );


      let fill =
        "#94a3b8";

      if (
        status ===
        "delivered"
      ) {
        fill =
          "#16a34a";

      } else if (
        status ===
        "delivery_issue"
      ) {
        fill =
          "#f59e0b";

      } else if (
        status ===
        "failed_delivery"
      ) {
        fill =
          "#dc2626";

      } else if (
        [
          "out_for_delivery",
          "on_transport"
        ].includes(
          status
        )
      ) {
        fill =
          "#1267ff";
      }


      const marker =
        L.circleMarker(
          [
            lat,
            lng
          ],
          {
            radius:
              10,

            color:
              "#ffffff",

            weight:
              2,

            fillColor:
              fill,

            fillOpacity:
              1
          }
        );


      marker.bindTooltip(
        String(
          stop.stop_sequence ||
          stop.stop_number ||
          index + 1
        ),
        {
          permanent:
            true,

          direction:
            "center",

          className:
            "route-seq-label"
        }
      );


      marker.bindPopup(
        buildMapStopPopup(
          stop,
          order
        )
      );


      routeStopsLayer
        .addLayer(
          marker
        );
    }
  );


  /* DEPOT RETURN */
  if (
    depotPoint &&
    Number.isFinite(Number(depotPoint.latitude)) &&
    Number.isFinite(Number(depotPoint.longitude))
  ) {
    points.push([
      Number(depotPoint.latitude),
      Number(depotPoint.longitude)
    ]);
  }


  if (
    points.length <
    2
  ) {
    return;
  }


  /*
   * Try to draw the real road route using OSRM.
   */
  const drawn =
    await drawOsrmPlannedRoute(
      points,
      color
    );


  /*
   * Only use a straight-line fallback
   * if OSRM is unavailable.
   */
  if (
    !drawn
  ) {
    routePlannedLayer.addLayer(
      L.polyline(
        points,
        {
          color,
          weight:
            3,

          opacity:
            .65,

          dashArray:
            "6,5"
        }
      )
    );
  }
}

  function drawActualRoute(
    route,
    color,
    allBounds
  ) {
    if (
      !isInternalUser()
    ) {
      return;
    }

    const points =
      driverLocationHistory
        .filter(
          row =>
            String(
              row.route_id
            ) ===
            String(
              route.id
            )
        )
        .sort(
          (a, b) =>
            new Date(
              a.recorded_at
            ) -
            new Date(
              b.recorded_at
            )
        )
        .map(
          row => [
            Number(
              row.latitude
            ),
            Number(
              row.longitude
            )
          ]
        )
        .filter(
          point =>
            Number.isFinite(
              point[0]
            ) &&
            Number.isFinite(
              point[1]
            )
        );


    if (
      points.length <
      2
    ) {
      return;
    }


    points.forEach(
      point =>
        allBounds.push(
          point
        )
    );


    L.polyline(
      points,
      {
        color,
        weight:
          5,
        opacity:
          .95
      }
    ).addTo(
      routeActualLayer
    );
  }


  function drawLiveLocation(
    route,
    allBounds
  ) {
    if (
      !isLiveLocationVisibleNow()
    ) {
      return;
    }

    const driverId =
      String(
        getRouteDriverId(
          route
        )
      );

    if (!driverId) {
      return;
    }

const location =
  driverLiveLocations.find(
    row =>
      String(row.route_id || "") ===
      String(route.id || "")
  )
  ||
  driverLiveLocations.find(
    row =>
      String(row.driver_user_id || "") ===
      driverId
  );


    if (!location) {
      return;
    }


    const lat =
      Number(
        location.latitude
      );

    const lng =
      Number(
        location.longitude
      );


    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return;
    }


    const recorded =
      new Date(
        location.updated_at ||
        location.recorded_at
      ).getTime();


    const age =
      nowMs() -
      recorded;


    let liveStatus =
      "Live";

    if (
      age >
      LIVE_LOCATION_OFFLINE_MS
    ) {
      liveStatus =
        "Offline";
    } else if (
      age >
      LIVE_LOCATION_FRESH_MS
    ) {
      liveStatus =
        "Stale";
    }


    allBounds.push([
      lat,
      lng
    ]);


    const icon =
      L.divIcon({
        className:
          "route-driver-live-icon",

        iconSize:
          [
            42,
            42
          ],

        iconAnchor:
          [
            21,
            21
          ],

        html: `
          <div
            style="
              width:42px;
              height:42px;
              border-radius:999px;
              display:grid;
              place-items:center;
              background:#07152f;
              border:3px solid #fff;
              box-shadow:
                0 5px 16px rgba(15,23,42,.30),
                0 0 0 4px rgba(18,103,255,.18);
              font-size:20px;
            "
          >
            🚚
          </div>
        `
      });


    const marker =
      L.marker(
        [
          lat,
          lng
        ],
        {
          icon
        }
      );


    const mph =
      Number.isFinite(
        Number(
          location.speed_mps
        )
      )
        ? Number(
            location.speed_mps
          ) *
          2.23694
        : null;


    marker.bindPopup(`
      <div style="
        min-width:210px;
        display:grid;
        gap:5px;
      ">

        <strong>
          ${escapeHtml(
            getRouteDriverName(
              route
            )
          )}
        </strong>

        <div>
          Vehicle:
          <strong>
            ${escapeHtml(
              getRouteVehicleName(
                route
              )
            )}
          </strong>
        </div>

        <div>
          Status:
          <strong>
            ${escapeHtml(liveStatus)}
          </strong>
        </div>

        <div>
          Last update:
          <strong>
            ${escapeHtml(
              formatTime(
                location.updated_at ||
                location.recorded_at
              )
            )}
          </strong>
        </div>

        ${
          isInternalUser() &&
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

      </div>
    `);


    routeLiveLayer
      .addLayer(
        marker
      );
  }


  function buildMapStopPopup(
    stop,
    order
  ) {
    return `
      <div style="
        min-width:220px;
        display:grid;
        gap:5px;
      ">

        <strong>
          Stop
          ${escapeHtml(
            stop.stop_sequence ||
            stop.stop_number ||
            "—"
          )}
          ·
          ${escapeHtml(
            getRetailerName(
              order,
              stop
            )
          )}
        </strong>

        <div>
          SO:
          <strong>
            ${escapeHtml(getSoNumber(order))}
          </strong>
        </div>

        <div>
          ACK:
          <strong>
            ${escapeHtml(getAckNumber(order))}
          </strong>
        </div>

        <div>
          ETA:
          <strong>
            ${escapeHtml(
              formatTime(
                stop.planned_arrival_time ||
                stop.arrival_eta
              )
            )}
          </strong>
        </div>

        <div>
          Status:
          <strong>
            ${escapeHtml(
              titleCase(
                getStopStatus(
                  stop,
                  order
                )
              )
            )}
          </strong>
        </div>

      </div>
    `;
  }


  /* =========================================================
     HAVERSINE
  ========================================================= */

  function haversineMeters(
    lat1,
    lon1,
    lat2,
    lon2
  ) {
    const aLat =
      Number(lat1);

    const aLon =
      Number(lon1);

    const bLat =
      Number(lat2);

    const bLon =
      Number(lon2);


    if (
      ![
        aLat,
        aLon,
        bLat,
        bLon
      ].every(
        Number.isFinite
      )
    ) {
      return 0;
    }


    const radius =
      6371000;


    const toRad =
      value =>
        value *
        Math.PI /
        180;


    const dLat =
      toRad(
        bLat -
        aLat
      );

    const dLon =
      toRad(
        bLon -
        aLon
      );


    const x =
      Math.sin(
        dLat /
        2
      ) ** 2 +
      Math.cos(
        toRad(
          aLat
        )
      ) *
      Math.cos(
        toRad(
          bLat
        )
      ) *
      Math.sin(
        dLon /
        2
      ) ** 2;


    return (
      radius *
      2 *
      Math.atan2(
        Math.sqrt(x),
        Math.sqrt(1 - x)
      )
    );
  }


  /* =========================================================
     ROUTE COLOUR LEGEND
  ========================================================= */

  function renderRouteColourLegend() {
    const mount =
      byId(
        "routeColourLegend"
      );

    if (!mount) {
      return;
    }

    const routes =
      getFilteredRoutes()
        .filter(
          route =>
            selectedRouteIds
              .has(
                String(
                  route.id
                )
              )
        );


    mount.innerHTML =
      routes.map(
        (
          route,
          index
        ) => `
          <span style="
            display:inline-flex;
            align-items:center;
            gap:5px;
            color:#475569;
            font-size:9.5px;
            font-weight:800;
          ">

            <span style="
              width:18px;
              height:3px;
              border-radius:999px;
              background:
                ${ROUTE_COLORS[index % ROUTE_COLORS.length]};
            "></span>

            ${
              isTodayRoute(
                route
              )
                ? "Today"
                : escapeHtml(
                    formatDate(
                      getRouteDate(
                        route
                      )
                    )
                  )
            }

          </span>
        `
      ).join(
        ""
      );
  }


  /* =========================================================
     DATE RANGE
  ========================================================= */

  function updateDateRangeText() {
    const el =
      byId(
        "routeTrackingDateRange"
      );

    if (!el) {
      return;
    }

    const routes =
      getFilteredRoutes();

    if (
      !routes.length
    ) {
      el.textContent =
        "No upcoming routes";

      return;
    }

    const dates =
      routes
        .map(
          getRouteDate
        )
        .filter(
          Boolean
        )
        .sort();


    el.textContent =
      `Showing routes: ${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`;
  }


  /* =========================================================
     DEFAULT SELECTION
  ========================================================= */

function setInitialRouteSelection() {
  selectedRouteIds =
    new Set();

  selectedRouteId =
    null;

  const routes =
    [...allRoutes].sort(
      (a, b) => {
        const dateCompare =
          getRouteDate(a)
            .localeCompare(
              getRouteDate(b)
            );

        if (
          dateCompare !== 0
        ) {
          return dateCompare;
        }

        return getRouteLabel(a)
          .localeCompare(
            getRouteLabel(b),
            "en",
            {
              numeric: true
            }
          );
      }
    );


  /*
   * Until 23:00 prefer today's route.
   */
  let primaryRoute =
    null;

  if (
    shouldShowTodayRoute()
  ) {
    primaryRoute =
      routes.find(
        route =>
          isTodayRoute(route)
      ) ||
      null;
  }


  /*
   * If there is no route today,
   * or it is after 23:00,
   * select the next future route.
   */
  if (
    !primaryRoute
  ) {
    primaryRoute =
      routes.find(
        route =>
          getRouteDate(route) >
          todayIso()
      ) ||
      null;
  }


  if (
    !primaryRoute
  ) {
    return;
  }


  /*
   * Route shown on map initially.
   */
  selectedRouteIds.add(
    String(
      primaryRoute.id
    )
  );


  /*
   * Route shown in summary + orders below map.
   */
  selectedRouteId =
    primaryRoute.id;
}


  /* =========================================================
     RENDER ALL
  ========================================================= */

function renderAll() {
  updateLiveLocationVisibilityNotice();

  renderRouteCards();

  renderRouteColourLegend();

  updateDateRangeText();

  updateSelectAllCheckbox();

  redrawMap();


  /*
   * Show summary + orders for
   * today's route or next available route.
   */
  if (
    selectedRouteId
  ) {
    const route =
      getRouteById(
        selectedRouteId
      );

    if (
      route
    ) {
      renderSelectedRoute(
        route
      );
    }
  }
}

  /* =========================================================
     SELECT ALL
  ========================================================= */

  function updateSelectAllCheckbox() {
    const checkbox =
      byId(
        "selectAllTrackingRoutes"
      );

    if (!checkbox) {
      return;
    }

    const routes =
      getFilteredRoutes();

    const selected =
      routes.filter(
        route =>
          selectedRouteIds
            .has(
              String(
                route.id
              )
            )
      );

    checkbox.checked =
      routes.length >
        0 &&
      selected.length ===
        routes.length;

    checkbox.indeterminate =
      selected.length >
        0 &&
      selected.length <
        routes.length;
  }


  /* =========================================================
     EVENTS
  ========================================================= */

 function bindEvents() {

  byId(
    "btnRefreshTracking"
  )?.addEventListener(
    "click",
    async () => {
      try {
        showToast(
          "Refreshing route tracking...",
          "ok"
        );

        await refreshAll();

        showToast(
          "Route tracking refreshed.",
          "ok"
        );

      } catch (error) {

        showToast(
          error.message,
          "err"
        );

      }
    }
  );


  byId(
    "selectAllTrackingRoutes"
  )?.addEventListener(
    "change",
    event => {

      const routes =
        getFilteredRoutes();

      if (
        event.target.checked
      ) {

        routes.forEach(
          route =>
            selectedRouteIds.add(
              String(
                route.id
              )
            )
        );

      } else {

        routes.forEach(
          route =>
            selectedRouteIds.delete(
              String(
                route.id
              )
            )
        );

      }

      renderRouteCards();

      renderRouteColourLegend();

      updateSelectAllCheckbox();

      redrawMap();
    }
  );


  byId(
    "btnActiveTrackingRoutes"
  )?.addEventListener(
    "click",
    () => {

      routeFilterMode =
        routeFilterMode === "active"
          ? "all"
          : "active";

      updateFilterButtons();

      renderAll();
    }
  );


  byId(
    "btnFutureTrackingRoutes"
  )?.addEventListener(
    "click",
    () => {

      routeFilterMode =
        routeFilterMode === "future"
          ? "all"
          : "future";

      updateFilterButtons();

      renderAll();
    }
  );


  byId(
    "btnTrackingToday"
  )?.addEventListener(
    "click",
    () => {

      currentViewDate =
        todayIso();

      const route =
        allRoutes.find(
          isTodayRoute
        ) ||
        allRoutes[0];

      if (
        route
      ) {
        openRouteModal(
          route.id
        );
      }
    }
  );


  byId(
    "btnNextTrackingDay"
  )?.addEventListener(
    "click",
    () => {
      moveSelectedDate(
        1
      );
    }
  );


  byId(
    "btnPreviousTrackingDay"
  )?.addEventListener(
    "click",
    () => {
      moveSelectedDate(
        -1
      );
    }
  );


  byId(
    "btnCollapseSelectedRoute"
  )?.addEventListener(
    "click",
    () => {

      byId(
        "selectedRouteContent"
      )?.classList.toggle(
        "hidden"
      );
    }
  );


byId(
  "btnRouteFullReport"
)?.addEventListener(
  "click",
  () => {
    openFullRouteReport();
  }
);


  /*
   * ROUTE MODAL CLOSE BUTTON
   * and click outside modal
   */
  document.addEventListener(
    "click",
    event => {

      if (
        event.target.closest(
          "[data-close-route-modal]"
        )
      ) {
        closeRouteModal();
        return;
      }


      const modal =
        byId(
          "routeDetailModal"
        );

      if (
        modal &&
        event.target === modal
      ) {
        closeRouteModal();
      }
    }
  );


  /*
   * ESC closes route modal
   */
  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape"
      ) {
        closeRouteModal();
      }
    }
  );

}


  function updateFilterButtons() {
    byId(
      "btnActiveTrackingRoutes"
    )?.classList
      .toggle(
        "active",
        routeFilterMode ===
        "active"
      );


    byId(
      "btnFutureTrackingRoutes"
    )?.classList
      .toggle(
        "active",
        routeFilterMode ===
        "future"
      );
  }


function moveSelectedDate(
  days
) {
  const current =
    new Date(
      `${currentViewDate}T12:00:00`
    );

  current.setDate(
    current.getDate() +
    days
  );

  currentViewDate =
    current
      .toISOString()
      .slice(
        0,
        10
      );

  const route =
    allRoutes.find(
      row =>
        getRouteDate(
          row
        ) ===
        currentViewDate
    );

  if (
    route
  ) {
    openRouteModal(
      route.id
    );
  } else {
    showToast(
      `No route planned for ${formatDate(currentViewDate)}.`,
      "ok"
    );
  }
}


  /* =========================================================
     REFRESH
  ========================================================= */

  async function refreshAll() {
  await loadCurrentUser();

  await getCompanyId();

  await Promise.all([
    loadDepot(),
    loadRoutes()
  ]);


  await loadStops();

  await loadOrders();


  await Promise.all([
    loadDriverLiveLocations(),
    loadDriverLocationHistory()
  ]);


  const allowedIds =
    new Set(
      allRoutes.map(
        route =>
          String(
            route.id
          )
      )
    );


  /*
   * Remove map routes that no longer exist.
   */
  selectedRouteIds =
    new Set(
      [...selectedRouteIds]
        .filter(
          id =>
            allowedIds.has(
              String(id)
            )
        )
    );


  /*
   * Determine today's route
   * or the next upcoming route.
   */
  const routes =
    [...allRoutes].sort(
      (a, b) =>
        getRouteDate(a)
          .localeCompare(
            getRouteDate(b)
          )
    );


  let primaryRoute =
    null;


  if (
    shouldShowTodayRoute()
  ) {
    primaryRoute =
      routes.find(
        route =>
          isTodayRoute(route)
      ) ||
      null;
  }


  if (
    !primaryRoute
  ) {
    primaryRoute =
      routes.find(
        route =>
          getRouteDate(route) >
          todayIso()
      ) ||
      null;
  }


  /*
   * Fixed summary + order list.
   */
  selectedRouteId =
    primaryRoute
      ?.id ||
    null;


  /*
   * If all checked map routes disappeared,
   * show only the primary route by default.
   */
  if (
    !selectedRouteIds.size &&
    primaryRoute
  ) {
    selectedRouteIds.add(
      String(
        primaryRoute.id
      )
    );
  }


  renderAll();
}


  /* =========================================================
     AUTO REFRESH / 23:00 HANDLING
  ========================================================= */

  function startAutoRefresh() {
    clearInterval(
      refreshTimer
    );


    refreshTimer =
      setInterval(
        async () => {
          try {
            /*
             * Important:
             *
             * This also automatically removes today's route
             * once the local clock passes 23:00.
             */
            await refreshAll();
          } catch (error) {
            console.warn(
              "[route-tracking] Auto refresh failed:",
              error
            );
          }
        },
        60000
      );
  }


  /* =========================================================
     INITIALISE
  ========================================================= */

  async function init() {
    try {
      initMap();

      bindEvents();

      await loadCurrentUser();

      await getCompanyId();

      await Promise.all([
        loadDepot(),
        loadRoutes()
      ]);

      await loadStops();

      await loadOrders();

      await Promise.all([
        loadDriverLiveLocations(),
        loadDriverLocationHistory()
      ]);


      setInitialRouteSelection();

      renderAll();


      if (
        selectedRouteId
      ) {
        const route =
          getRouteById(
            selectedRouteId
          );

        if (
          route
        ) {
          renderSelectedRoute(
            route
          );
        }
      }


      startAutoRefresh();


      setTimeout(
        () => {
          routeMap
            ?.invalidateSize(
              true
            );
        },
        300
      );

    } catch (error) {
      console.error(
        "[route-tracking] Init failed:",
        error
      );

      showToast(
        error.message ||
        "Could not load route tracking.",
        "err"
      );
    }
  }


  document.addEventListener(
    "DOMContentLoaded",
    init
  );

})();