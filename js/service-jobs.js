(function () {
  "use strict";

  /* =========================================================
   * VEYNOR SERVICE JOB ENGINE
   *
   * Pure calculation module for:
   * - route previews;
   * - quotation calculations;
   * - internal operating costs;
   * - margin calculations;
   * - stop optimisation.
   *
   * This module:
   * - does not read Supabase;
   * - does not write Supabase;
   * - does not create routes;
   * - does not change existing orders.
   * ========================================================= */

  const VERSION = "1.0.0";

  const DEFAULT_OSRM_BASE_URL =
    "https://router.project-osrm.org";

  const MILES_PER_KILOMETRE =
    0.6213711922;

  const EARTH_RADIUS_KM =
    6371;

  const DEFAULT_ROUTE_SETTINGS = {
    osrm_base_url:
      DEFAULT_OSRM_BASE_URL,

    use_osrm:
      true,

    use_osrm_trip_service:
      false,

    allow_fallback:
      true,

    average_speed_kmh:
      50,

    road_distance_factor:
      1.25,

    include_return_to_depot:
      true,

    optimise_stop_order:
      true,

    default_service_minutes:
      15,

    osrm_timeout_ms:
      15000
  };

  const DEFAULT_CUSTOMER_RATES = {
    enabled:
      true,

    labour_rate_gbp:
      0,

    mileage_rate_gbp:
      0,

    second_person_rate_gbp:
      0,

    waiting_time_rate_gbp:
      0,

    minimum_charge_gbp:
      0,

    minimum_billable_hours:
      0,

    labour_rounding_minutes:
      15,

    callout_charge_gbp:
      0,

    per_stop_charge_gbp:
      0,

    installation_charge_gbp:
      0,

    disposal_charge_gbp:
      0,

    specialist_handling_charge_gbp:
      0,

    evening_surcharge_pct:
      0,

    weekend_surcharge_pct:
      0,

    bank_holiday_surcharge_pct:
      0,

    vat_rate_pct:
      20,

    include_return_to_depot:
      true,

    bill_depot_to_depot:
      true,

    bill_return_mileage:
      true,

    break_minutes:
      0,

    break_is_billable:
      false
  };

  const DEFAULT_INTERNAL_RATES = {
    labour_cost_per_hour_gbp:
      0,

    second_person_cost_per_hour_gbp:
      null,

    vehicle_cost_per_hour_gbp:
      0,

    diesel_price_per_litre_gbp_inc_vat:
      1.55,

    diesel_vat_rate_pct:
      20,

    fuel_litres_per_100km:
      10,

    additional_internal_cost_gbp:
      0
  };

  class ServiceJobEngineError extends Error {
    constructor(
      message,
      code = "SERVICE_JOB_ENGINE_ERROR",
      details = null
    ) {
      super(message);

      this.name =
        "ServiceJobEngineError";

      this.code =
        code;

      this.details =
        details;
    }
  }

  /* =========================================================
   * BASIC HELPERS
   * ========================================================= */

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalize(value) {
    return clean(value)
      .toLowerCase();
  }

  function toNumber(
    value,
    fallback = 0
  ) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return fallback;
    }

    const parsed =
      Number(
        String(value)
          .replace(",", ".")
      );

    return Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  function clamp(
    value,
    minimum,
    maximum
  ) {
    return Math.min(
      maximum,
      Math.max(
        minimum,
        value
      )
    );
  }

  function roundTo(
    value,
    decimals = 2
  ) {
    const factor =
      10 ** decimals;

    return Math.round(
      (
        toNumber(value, 0) +
        Number.EPSILON
      ) *
      factor
    ) / factor;
  }

  function roundMoney(value) {
    return roundTo(
      value,
      2
    );
  }

  function kilometresToMiles(
    kilometres
  ) {
    return (
      toNumber(kilometres, 0) *
      MILES_PER_KILOMETRE
    );
  }

  function milesToKilometres(
    miles
  ) {
    return (
      toNumber(miles, 0) /
      MILES_PER_KILOMETRE
    );
  }

  function degreesToRadians(
    degrees
  ) {
    return (
      toNumber(degrees, 0) *
      Math.PI /
      180
    );
  }

  function hasFiniteCoordinates(
    point
  ) {
    if (!point) {
      return false;
    }

    const latitude =
      Number(
        point.latitude ??
        point.lat
      );

    const longitude =
      Number(
        point.longitude ??
        point.lng ??
        point.lon
      );

    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  function coordinatePoint(point) {
    if (
      !hasFiniteCoordinates(point)
    ) {
      return null;
    }

    return {
      latitude:
        Number(
          point.latitude ??
          point.lat
        ),

      longitude:
        Number(
          point.longitude ??
          point.lng ??
          point.lon
        )
    };
  }

  function createLocalId(
    prefix = "stop"
  ) {
    if (
      window.crypto?.randomUUID
    ) {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }

  function createAbortController(
    timeoutMs
  ) {
    const controller =
      new AbortController();

    const timeoutId =
      window.setTimeout(
        () => {
          controller.abort();
        },
        Math.max(
          1000,
          toNumber(
            timeoutMs,
            15000
          )
        )
      );

    return {
      controller,
      cancelTimeout() {
        window.clearTimeout(
          timeoutId
        );
      }
    };
  }

  /* =========================================================
   * INPUT NORMALISATION
   * ========================================================= */

  function normalizeDepot(depot) {
    const point =
      coordinatePoint(depot);

    if (!point) {
      throw new ServiceJobEngineError(
        "Valid depot coordinates are required.",
        "INVALID_DEPOT",
        {
          depot
        }
      );
    }

    return {
      ...depot,

      id:
        depot?.id ||
        "service-job-depot",

      name:
        clean(
          depot?.name ||
          depot?.depot_name ||
          "Depot"
        ),

      latitude:
        point.latitude,

      longitude:
        point.longitude
    };
  }

  function normalizeStop(
    stop,
    index = 0,
    defaults = {}
  ) {
    const point =
      coordinatePoint(stop);

    const stopType =
      normalize(
        stop?.stop_type ||
        stop?.type ||
        "service"
      );

    return {
      ...stop,

      local_id:
        stop?.local_id ||
        stop?.id ||
        createLocalId(
          "stop"
        ),

      id:
        stop?.id ||
        null,

      stop_sequence:
        Math.max(
          1,
          Math.round(
            toNumber(
              stop?.stop_sequence ??
              stop?.sequence,
              index + 1
            )
          )
        ),

      stop_type:
        stopType ||
        "service",

      stop_name:
        clean(
          stop?.stop_name ||
          stop?.name ||
          `Stop ${index + 1}`
        ),

      address_1:
        clean(
          stop?.address_1 ||
          stop?.delivery_address_1
        ),

      address_2:
        clean(
          stop?.address_2 ||
          stop?.delivery_address_2
        ),

      city:
        clean(
          stop?.city ||
          stop?.delivery_city
        ),

      postcode:
        clean(
          stop?.postcode ||
          stop?.delivery_postcode
        ).toUpperCase(),

      latitude:
        point?.latitude ??
        null,

      longitude:
        point?.longitude ??
        null,

      service_minutes:
        Math.max(
          0,
          toNumber(
            stop?.service_minutes,
            defaults
              .default_service_minutes ??
            15
          )
        ),

      waiting_minutes:
        Math.max(
          0,
          toNumber(
            stop?.waiting_minutes,
            0
          )
        ),

      include_in_route:
        stop?.include_in_route !==
        false,

      customer_visible:
        stop?.customer_visible !==
        false,

      items_description:
        clean(
          stop?.items_description ||
          stop?.items ||
          stop?.description
        ),

      driver_instructions:
        clean(
          stop?.driver_instructions ||
          stop?.instructions
        )
    };
  }

  function normalizeStops(
    stops,
    settings = {}
  ) {
    if (!Array.isArray(stops)) {
      throw new ServiceJobEngineError(
        "Stops must be supplied as an array.",
        "INVALID_STOPS"
      );
    }

    return stops
      .map(
        (stop, index) =>
          normalizeStop(
            stop,
            index,
            settings
          )
      )
      .sort(
        (a, b) =>
          a.stop_sequence -
          b.stop_sequence
      )
      .map(
        (stop, index) => ({
          ...stop,

          stop_sequence:
            index + 1
        })
      );
  }

  function normalizeCustomerRates(
    rates = {}
  ) {
    return {
      ...DEFAULT_CUSTOMER_RATES,
      ...rates,

      enabled:
        rates.enabled !== false &&
        rates.is_active !== false &&
        rates.enable_service_jobs !==
          false,

      labour_rate_gbp:
        Math.max(
          0,
          toNumber(
            rates.labour_rate_gbp,
            0
          )
        ),

      mileage_rate_gbp:
        Math.max(
          0,
          toNumber(
            rates.mileage_rate_gbp,
            0
          )
        ),

      second_person_rate_gbp:
        Math.max(
          0,
          toNumber(
            rates.second_person_rate_gbp,
            0
          )
        ),

      waiting_time_rate_gbp:
        Math.max(
          0,
          toNumber(
            rates.waiting_time_rate_gbp,
            0
          )
        ),

      minimum_charge_gbp:
        Math.max(
          0,
          toNumber(
            rates.minimum_charge_gbp,
            0
          )
        ),

      minimum_billable_hours:
        Math.max(
          0,
          toNumber(
            rates.minimum_billable_hours,
            0
          )
        ),

      labour_rounding_minutes:
        Math.max(
          1,
          Math.round(
            toNumber(
              rates.labour_rounding_minutes,
              15
            )
          )
        ),

      callout_charge_gbp:
        Math.max(
          0,
          toNumber(
            rates.callout_charge_gbp,
            0
          )
        ),

      per_stop_charge_gbp:
        Math.max(
          0,
          toNumber(
            rates.per_stop_charge_gbp,
            0
          )
        ),

      installation_charge_gbp:
        Math.max(
          0,
          toNumber(
            rates.installation_charge_gbp,
            0
          )
        ),

      disposal_charge_gbp:
        Math.max(
          0,
          toNumber(
            rates.disposal_charge_gbp,
            0
          )
        ),

      specialist_handling_charge_gbp:
        Math.max(
          0,
          toNumber(
            rates.specialist_handling_charge_gbp,
            0
          )
        ),

      evening_surcharge_pct:
        Math.max(
          0,
          toNumber(
            rates.evening_surcharge_pct,
            0
          )
        ),

      weekend_surcharge_pct:
        Math.max(
          0,
          toNumber(
            rates.weekend_surcharge_pct,
            0
          )
        ),

      bank_holiday_surcharge_pct:
        Math.max(
          0,
          toNumber(
            rates.bank_holiday_surcharge_pct,
            0
          )
        ),

      vat_rate_pct:
        clamp(
          toNumber(
            rates.vat_rate_pct,
            20
          ),
          0,
          100
        ),

      include_return_to_depot:
        rates.include_return_to_depot !==
        false,

      bill_depot_to_depot:
        rates.bill_depot_to_depot !==
        false,

      bill_return_mileage:
        rates.bill_return_mileage !==
        false,

      break_minutes:
        Math.max(
          0,
          toNumber(
            rates.break_minutes,
            0
          )
        ),

      break_is_billable:
        rates.break_is_billable ===
        true
    };
  }

  function normalizeInternalRates(
    rates = {}
  ) {
    const labourRate =
      Math.max(
        0,
        toNumber(
          rates.labour_cost_per_hour_gbp,
          0
        )
      );

    return {
      ...DEFAULT_INTERNAL_RATES,
      ...rates,

      labour_cost_per_hour_gbp:
        labourRate,

      second_person_cost_per_hour_gbp:
        rates.second_person_cost_per_hour_gbp ===
        null ||
        rates.second_person_cost_per_hour_gbp ===
        undefined
          ? labourRate
          : Math.max(
              0,
              toNumber(
                rates.second_person_cost_per_hour_gbp,
                labourRate
              )
            ),

      vehicle_cost_per_hour_gbp:
        Math.max(
          0,
          toNumber(
            rates.vehicle_cost_per_hour_gbp,
            0
          )
        ),

      diesel_price_per_litre_gbp_inc_vat:
        Math.max(
          0,
          toNumber(
            rates.diesel_price_per_litre_gbp_inc_vat,
            1.55
          )
        ),

      diesel_vat_rate_pct:
        clamp(
          toNumber(
            rates.diesel_vat_rate_pct,
            20
          ),
          0,
          100
        ),

      fuel_litres_per_100km:
        Math.max(
          0,
          toNumber(
            rates.fuel_litres_per_100km,
            10
          )
        ),

      additional_internal_cost_gbp:
        Math.max(
          0,
          toNumber(
            rates.additional_internal_cost_gbp,
            0
          )
        )
    };
  }

  function normalizeRouteSettings(
    settings = {}
  ) {
    return {
      ...DEFAULT_ROUTE_SETTINGS,
      ...settings,

      osrm_base_url:
        clean(
          settings.osrm_base_url ||
          DEFAULT_OSRM_BASE_URL
        ).replace(
          /\/+$/,
          ""
        ),

      use_osrm:
        settings.use_osrm !== false,

      use_osrm_trip_service:
        settings.use_osrm_trip_service ===
        true,

      allow_fallback:
        settings.allow_fallback !==
        false,

      average_speed_kmh:
        Math.max(
          1,
          toNumber(
            settings.average_speed_kmh,
            50
          )
        ),

      road_distance_factor:
        Math.max(
          1,
          toNumber(
            settings.road_distance_factor ??
            settings.distance_factor,
            1.25
          )
        ),

      include_return_to_depot:
        settings.include_return_to_depot !==
        false,

      optimise_stop_order:
        settings.optimise_stop_order !==
        false,

      default_service_minutes:
        Math.max(
          0,
          toNumber(
            settings.default_service_minutes,
            15
          )
        ),

      osrm_timeout_ms:
        Math.max(
          1000,
          toNumber(
            settings.osrm_timeout_ms,
            15000
          )
        )
    };
  }

  /* =========================================================
   * VALIDATION
   * ========================================================= */

  function validateStopsForRoute(
    stops
  ) {
    const included =
      stops.filter(
        stop =>
          stop.include_in_route !==
          false
      );

    if (!included.length) {
      throw new ServiceJobEngineError(
        "At least one route stop is required.",
        "NO_ROUTE_STOPS"
      );
    }

    const invalid =
      included.filter(
        stop =>
          !hasFiniteCoordinates(
            stop
          )
      );

    if (invalid.length) {
      throw new ServiceJobEngineError(
        `${invalid.length} stop${
          invalid.length === 1
            ? " has"
            : "s have"
        } no valid coordinates.`,
        "INVALID_STOP_COORDINATES",
        {
          stops:
            invalid
        }
      );
    }

    return included;
  }

  function validateRates(
    rates
  ) {
    if (!rates.enabled) {
      throw new ServiceJobEngineError(
        "Service Job pricing is disabled for this Product Owner.",
        "SERVICE_RATES_DISABLED"
      );
    }
  }

  /* =========================================================
   * GEOGRAPHY
   * ========================================================= */

  function haversineKm(
    pointA,
    pointB
  ) {
    const a =
      coordinatePoint(
        pointA
      );

    const b =
      coordinatePoint(
        pointB
      );

    if (!a || !b) {
      return 0;
    }

    const latitudeDifference =
      degreesToRadians(
        b.latitude -
        a.latitude
      );

    const longitudeDifference =
      degreesToRadians(
        b.longitude -
        a.longitude
      );

    const latitudeA =
      degreesToRadians(
        a.latitude
      );

    const latitudeB =
      degreesToRadians(
        b.latitude
      );

    const calculation =
      Math.sin(
        latitudeDifference / 2
      ) ** 2 +
      Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(
        longitudeDifference / 2
      ) ** 2;

    return (
      EARTH_RADIUS_KM *
      2 *
      Math.atan2(
        Math.sqrt(calculation),
        Math.sqrt(
          1 - calculation
        )
      )
    );
  }

  function totalDirectDistanceKm(
    depot,
    stops,
    includeReturn
  ) {
    if (!stops.length) {
      return 0;
    }

    let total = 0;
    let previous =
      depot;

    stops.forEach(stop => {
      total +=
        haversineKm(
          previous,
          stop
        );

      previous =
        stop;
    });

    if (includeReturn) {
      total +=
        haversineKm(
          previous,
          depot
        );
    }

    return total;
  }

  /* =========================================================
   * STOP OPTIMISATION
   * ========================================================= */

  function nearestNeighbourOrder(
    depot,
    stops
  ) {
    const remaining =
      [...stops];

    const ordered = [];

    let currentPoint =
      depot;

    while (remaining.length) {
      let closestIndex = 0;
      let closestDistance =
        Infinity;

      remaining.forEach(
        (stop, index) => {
          const distance =
            haversineKm(
              currentPoint,
              stop
            );

          if (
            distance <
            closestDistance
          ) {
            closestDistance =
              distance;

            closestIndex =
              index;
          }
        }
      );

      const nextStop =
        remaining.splice(
          closestIndex,
          1
        )[0];

      ordered.push(
        nextStop
      );

      currentPoint =
        nextStop;
    }

    return ordered.map(
      (stop, index) => ({
        ...stop,

        stop_sequence:
          index + 1
      })
    );
  }

  function routeLengthForStops(
    depot,
    stops,
    includeReturn
  ) {
    return totalDirectDistanceKm(
      depot,
      stops,
      includeReturn
    );
  }

  function improveWithTwoOpt(
    depot,
    stops,
    includeReturn,
    maximumIterations = 150
  ) {
    if (
      stops.length < 4
    ) {
      return [...stops];
    }

    let best =
      [...stops];

    let bestDistance =
      routeLengthForStops(
        depot,
        best,
        includeReturn
      );

    let improved = true;
    let iteration = 0;

    while (
      improved &&
      iteration <
      maximumIterations
    ) {
      improved = false;
      iteration += 1;

      for (
        let start = 0;
        start <
        best.length - 2;
        start += 1
      ) {
        for (
          let end =
            start + 1;
          end <
          best.length - 1;
          end += 1
        ) {
          const candidate = [
            ...best.slice(
              0,
              start
            ),

            ...best
              .slice(
                start,
                end + 1
              )
              .reverse(),

            ...best.slice(
              end + 1
            )
          ];

          const candidateDistance =
            routeLengthForStops(
              depot,
              candidate,
              includeReturn
            );

          if (
            candidateDistance +
            0.001 <
            bestDistance
          ) {
            best =
              candidate;

            bestDistance =
              candidateDistance;

            improved = true;
          }
        }
      }
    }

    return best.map(
      (stop, index) => ({
        ...stop,

        stop_sequence:
          index + 1
      })
    );
  }

  function optimiseStops({
    depot,
    stops,
    include_return_to_depot = true,
    use_two_opt = true
  }) {
    const normalizedDepot =
      normalizeDepot(
        depot
      );

    const normalizedStops =
      validateStopsForRoute(
        normalizeStops(
          stops
        )
      );

    const nearest =
      nearestNeighbourOrder(
        normalizedDepot,
        normalizedStops
      );

    if (!use_two_opt) {
      return nearest;
    }

    return improveWithTwoOpt(
      normalizedDepot,
      nearest,
      include_return_to_depot
    );
  }

  /* =========================================================
   * OSRM
   * ========================================================= */

  function pointsToOsrmCoordinates(
    points
  ) {
    return points
      .map(point => {
        const coordinate =
          coordinatePoint(
            point
          );

        if (!coordinate) {
          throw new ServiceJobEngineError(
            "Invalid coordinate supplied to OSRM.",
            "INVALID_OSRM_COORDINATE",
            {
              point
            }
          );
        }

        return `${coordinate.longitude},${coordinate.latitude}`;
      })
      .join(";");
  }

  async function fetchOsrmRoute({
    depot,
    stops,
    include_return_to_depot,
    settings
  }) {
    const points = [
      depot,
      ...stops
    ];

    if (
      include_return_to_depot
    ) {
      points.push(
        depot
      );
    }

    const coordinates =
      pointsToOsrmCoordinates(
        points
      );

    const url =
      `${settings.osrm_base_url}` +
      `/route/v1/driving/${coordinates}` +
      "?overview=full" +
      "&geometries=geojson" +
      "&steps=false" +
      "&annotations=false";

    const {
      controller,
      cancelTimeout
    } = createAbortController(
      settings.osrm_timeout_ms
    );

    try {
      const response =
        await fetch(
          url,
          {
            method:
              "GET",

            signal:
              controller.signal,

            headers: {
              Accept:
                "application/json"
            }
          }
        );

      if (!response.ok) {
        throw new ServiceJobEngineError(
          `OSRM returned HTTP ${response.status}.`,
          "OSRM_HTTP_ERROR",
          {
            status:
              response.status,

            url
          }
        );
      }

      const payload =
        await response.json();

      if (
        payload.code !== "Ok" ||
        !payload.routes?.length
      ) {
        throw new ServiceJobEngineError(
          `OSRM could not calculate the route: ${payload.code || "unknown error"}.`,
          "OSRM_ROUTE_ERROR",
          payload
        );
      }

      const route =
        payload.routes[0];

      const distanceKm =
        toNumber(
          route.distance,
          0
        ) /
        1000;

      const driveHours =
        toNumber(
          route.duration,
          0
        ) /
        3600;

      return {
        source:
          "osrm",

        distance_km:
          distanceKm,

        distance_miles:
          kilometresToMiles(
            distanceKm
          ),

        drive_hours:
          driveHours,

        drive_minutes:
          driveHours *
          60,

        geometry:
          route.geometry ||
          null,

        raw:
          payload
      };
    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        throw new ServiceJobEngineError(
          "The OSRM route request timed out.",
          "OSRM_TIMEOUT"
        );
      }

      throw error;
    } finally {
      cancelTimeout();
    }
  }

  async function fetchOsrmOptimisedTrip({
    depot,
    stops,
    include_return_to_depot,
    settings
  }) {
    const points = [
      depot,
      ...stops
    ];

    const coordinates =
      pointsToOsrmCoordinates(
        points
      );

    const sourceIndex = 0;

    const destinationQuery =
      include_return_to_depot
        ? `&roundtrip=true&source=${sourceIndex}`
        : `&roundtrip=false&source=${sourceIndex}`;

    const url =
      `${settings.osrm_base_url}` +
      `/trip/v1/driving/${coordinates}` +
      "?overview=full" +
      "&geometries=geojson" +
      "&steps=false" +
      destinationQuery;

    const {
      controller,
      cancelTimeout
    } = createAbortController(
      settings.osrm_timeout_ms
    );

    try {
      const response =
        await fetch(
          url,
          {
            signal:
              controller.signal,

            headers: {
              Accept:
                "application/json"
            }
          }
        );

      if (!response.ok) {
        throw new ServiceJobEngineError(
          `OSRM trip service returned HTTP ${response.status}.`,
          "OSRM_TRIP_HTTP_ERROR"
        );
      }

      const payload =
        await response.json();

      if (
        payload.code !== "Ok" ||
        !payload.trips?.length
      ) {
        throw new ServiceJobEngineError(
          `OSRM trip service failed: ${payload.code || "unknown error"}.`,
          "OSRM_TRIP_ERROR",
          payload
        );
      }

      const trip =
        payload.trips[0];

      const waypointOrder =
        (payload.waypoints || [])
          .map(
            (
              waypoint,
              originalIndex
            ) => ({
              originalIndex,
              waypointIndex:
                waypoint.waypoint_index
            })
          )
          .filter(
            item =>
              item.originalIndex > 0
          )
          .sort(
            (a, b) =>
              a.waypointIndex -
              b.waypointIndex
          );

      const orderedStops =
        waypointOrder.map(
          (item, index) => ({
            ...stops[
              item.originalIndex -
              1
            ],

            stop_sequence:
              index + 1
          })
        );

      const distanceKm =
        toNumber(
          trip.distance,
          0
        ) /
        1000;

      const driveHours =
        toNumber(
          trip.duration,
          0
        ) /
        3600;

      return {
        source:
          "osrm_trip",

        ordered_stops:
          orderedStops,

        distance_km:
          distanceKm,

        distance_miles:
          kilometresToMiles(
            distanceKm
          ),

        drive_hours:
          driveHours,

        drive_minutes:
          driveHours *
          60,

        geometry:
          trip.geometry ||
          null,

        raw:
          payload
      };
    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        throw new ServiceJobEngineError(
          "The OSRM trip request timed out.",
          "OSRM_TRIP_TIMEOUT"
        );
      }

      throw error;
    } finally {
      cancelTimeout();
    }
  }

  /* =========================================================
   * FALLBACK ROUTE
   * ========================================================= */

  function calculateFallbackRoute({
    depot,
    stops,
    include_return_to_depot,
    settings
  }) {
    const directDistanceKm =
      totalDirectDistanceKm(
        depot,
        stops,
        include_return_to_depot
      );

    const distanceKm =
      directDistanceKm *
      settings
        .road_distance_factor;

    const driveHours =
      distanceKm /
      settings
        .average_speed_kmh;

    const coordinates = [
      [
        depot.longitude,
        depot.latitude
      ],

      ...stops.map(stop => [
        stop.longitude,
        stop.latitude
      ])
    ];

    if (
      include_return_to_depot
    ) {
      coordinates.push([
        depot.longitude,
        depot.latitude
      ]);
    }

    return {
      source:
        "fallback",

      distance_km:
        distanceKm,

      distance_miles:
        kilometresToMiles(
          distanceKm
        ),

      drive_hours:
        driveHours,

      drive_minutes:
        driveHours *
        60,

      geometry: {
        type:
          "LineString",

        coordinates
      },

      raw:
        null
    };
  }

  /* =========================================================
   * ROUTE CALCULATION
   * ========================================================= */

  async function calculateRoute({
    depot,
    stops,
    settings = {}
  }) {
    const routeSettings =
      normalizeRouteSettings(
        settings
      );

    const normalizedDepot =
      normalizeDepot(
        depot
      );

    const normalizedStops =
      normalizeStops(
        stops,
        routeSettings
      );

    const includedStops =
      validateStopsForRoute(
        normalizedStops
      );

    let orderedStops =
      [...includedStops];

    let routeResult =
      null;

    let osrmError =
      null;

    if (
      routeSettings
        .optimise_stop_order
    ) {
      if (
        routeSettings
          .use_osrm &&
        routeSettings
          .use_osrm_trip_service
      ) {
        try {
          const trip =
            await fetchOsrmOptimisedTrip({
              depot:
                normalizedDepot,

              stops:
                includedStops,

              include_return_to_depot:
                routeSettings
                  .include_return_to_depot,

              settings:
                routeSettings
            });

          orderedStops =
            trip.ordered_stops;

          routeResult =
            trip;
        } catch (error) {
          osrmError =
            error;

          orderedStops =
            optimiseStops({
              depot:
                normalizedDepot,

              stops:
                includedStops,

              include_return_to_depot:
                routeSettings
                  .include_return_to_depot,

              use_two_opt:
                true
            });
        }
      } else {
        orderedStops =
          optimiseStops({
            depot:
              normalizedDepot,

            stops:
              includedStops,

            include_return_to_depot:
              routeSettings
                .include_return_to_depot,

            use_two_opt:
              true
          });
      }
    }

    if (
      !routeResult &&
      routeSettings.use_osrm
    ) {
      try {
        routeResult =
          await fetchOsrmRoute({
            depot:
              normalizedDepot,

            stops:
              orderedStops,

            include_return_to_depot:
              routeSettings
                .include_return_to_depot,

            settings:
              routeSettings
          });
      } catch (error) {
        osrmError =
          error;
      }
    }

    if (!routeResult) {
      if (
        !routeSettings
          .allow_fallback
      ) {
        throw (
          osrmError ||
          new ServiceJobEngineError(
            "No route calculation method was available.",
            "ROUTE_CALCULATION_FAILED"
          )
        );
      }

      routeResult =
        calculateFallbackRoute({
          depot:
            normalizedDepot,

          stops:
            orderedStops,

          include_return_to_depot:
            routeSettings
              .include_return_to_depot,

          settings:
            routeSettings
        });
    }

    return {
      ok:
        true,

      source:
        routeResult.source,

      depot:
        normalizedDepot,

      ordered_stops:
        orderedStops.map(
          (stop, index) => ({
            ...stop,

            stop_sequence:
              index + 1
          })
        ),

      include_return_to_depot:
        routeSettings
          .include_return_to_depot,

      distance_km:
        roundTo(
          routeResult.distance_km,
          3
        ),

      distance_miles:
        roundTo(
          routeResult.distance_miles,
          3
        ),

      drive_hours:
        roundTo(
          routeResult.drive_hours,
          4
        ),

      drive_minutes:
        roundTo(
          routeResult.drive_minutes,
          2
        ),

      geometry:
        routeResult.geometry,

      osrm_error:
        osrmError
          ? {
              message:
                osrmError.message,

              code:
                osrmError.code ||
                null
            }
          : null
    };
  }

  /* =========================================================
   * TIME CALCULATIONS
   * ========================================================= */

  function calculateStopTime(
    stops
  ) {
    const serviceMinutes =
      stops.reduce(
        (total, stop) =>
          total +
          Math.max(
            0,
            toNumber(
              stop.service_minutes,
              0
            )
          ),
        0
      );

    const waitingMinutes =
      stops.reduce(
        (total, stop) =>
          total +
          Math.max(
            0,
            toNumber(
              stop.waiting_minutes,
              0
            )
          ),
        0
      );

    return {
      service_minutes:
        serviceMinutes,

      service_hours:
        serviceMinutes /
        60,

      waiting_minutes:
        waitingMinutes,

      waiting_hours:
        waitingMinutes /
        60
    };
  }

  function roundBillableHours({
    total_hours,
    minimum_billable_hours,
    rounding_minutes
  }) {
    const totalMinutes =
      Math.max(
        0,
        toNumber(
          total_hours,
          0
        ) *
        60
      );

    const interval =
      Math.max(
        1,
        Math.round(
          toNumber(
            rounding_minutes,
            15
          )
        )
      );

    const roundedMinutes =
      Math.ceil(
        totalMinutes /
        interval
      ) *
      interval;

    const roundedHours =
      roundedMinutes /
      60;

    return Math.max(
      roundedHours,
      Math.max(
        0,
        toNumber(
          minimum_billable_hours,
          0
        )
      )
    );
  }

  function calculateTimeSummary({
    route,
    stops,
    customer_rates
  }) {
    const stopTime =
      calculateStopTime(
        stops
      );

    const breakMinutes =
      Math.max(
        0,
        toNumber(
          customer_rates
            .break_minutes,
          0
        )
      );

    const breakHours =
      breakMinutes /
      60;

    const operationalHours =
      route.drive_hours +
      stopTime.service_hours +
      stopTime.waiting_hours +
      breakHours;

    const customerBillableBaseHours =
      route.drive_hours +
      stopTime.service_hours +
      stopTime.waiting_hours +
      (
        customer_rates
          .break_is_billable
          ? breakHours
          : 0
      );

    const billableHours =
      roundBillableHours({
        total_hours:
          customerBillableBaseHours,

        minimum_billable_hours:
          customer_rates
            .minimum_billable_hours,

        rounding_minutes:
          customer_rates
            .labour_rounding_minutes
      });

    return {
      drive_hours:
        route.drive_hours,

      service_hours:
        stopTime.service_hours,

      waiting_hours:
        stopTime.waiting_hours,

      break_hours:
        breakHours,

      operational_hours:
        operationalHours,

      billable_hours:
        billableHours
    };
  }

  /* =========================================================
   * CHARGE HELPERS
   * ========================================================= */

  function normalizeAdditionalCharges(
    charges
  ) {
    if (!Array.isArray(charges)) {
      return [];
    }

    return charges
      .map(
        (
          charge,
          index
        ) => ({
          id:
            charge?.id ||
            charge?.local_id ||
            `charge-${index + 1}`,

          charge_type:
            normalize(
              charge?.charge_type ||
              "additional"
            ),

          description:
            clean(
              charge?.description ||
              "Additional charge"
            ),

          amount_gbp:
            Math.max(
              0,
              toNumber(
                charge?.amount_gbp,
                0
              )
            ),

          internal_cost_gbp:
            Math.max(
              0,
              toNumber(
                charge?.internal_cost_gbp,
                0
              )
            ),

          customer_visible:
            charge?.customer_visible !==
            false,

          taxable:
            charge?.taxable !==
            false
        })
      )
      .filter(
        charge =>
          charge.amount_gbp >
            0 ||
          charge.internal_cost_gbp >
            0
      );
  }

  function countStopTypes(
    stops
  ) {
    return stops.reduce(
      (
        totals,
        stop
      ) => {
        const type =
          normalize(
            stop.stop_type
          ) ||
          "service";

        totals[type] =
          (
            totals[type] ||
            0
          ) +
          1;

        return totals;
      },
      {}
    );
  }

  function dateSurchargePercentage({
    planned_date,
    planned_start_time,
    customer_rates,
    is_bank_holiday = false
  }) {
    if (!planned_date) {
      return {
        evening_pct:
          0,

        weekend_pct:
          0,

        bank_holiday_pct:
          0,

        total_pct:
          0
      };
    }

    const date =
      new Date(
        `${planned_date}T${planned_start_time || "08:00"}:00`
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return {
        evening_pct:
          0,

        weekend_pct:
          0,

        bank_holiday_pct:
          0,

        total_pct:
          0
      };
    }

    const day =
      date.getDay();

    const hour =
      date.getHours();

    const isWeekend =
      day === 0 ||
      day === 6;

    const isEvening =
      hour < 6 ||
      hour >= 18;

    const eveningPct =
      isEvening
        ? customer_rates
            .evening_surcharge_pct
        : 0;

    const weekendPct =
      isWeekend
        ? customer_rates
            .weekend_surcharge_pct
        : 0;

    const bankHolidayPct =
      is_bank_holiday
        ? customer_rates
            .bank_holiday_surcharge_pct
        : 0;

    return {
      evening_pct:
        eveningPct,

      weekend_pct:
        weekendPct,

      bank_holiday_pct:
        bankHolidayPct,

      total_pct:
        eveningPct +
        weekendPct +
        bankHolidayPct
    };
  }

  /* =========================================================
   * CUSTOMER QUOTATION
   * ========================================================= */

  function calculateCustomerQuote({
    route,
    ordered_stops,
    time,
    customer_rates,
    crew_size,
    additional_charges,
    planned_date,
    planned_start_time,
    is_bank_holiday = false
  }) {
    validateRates(
      customer_rates
    );

    const crewSize =
      Math.max(
        1,
        Math.round(
          toNumber(
            crew_size,
            1
          )
        )
      );

    const extraCrewMembers =
      Math.max(
        0,
        crewSize - 1
      );

    const customerMileage =
      customer_rates
        .bill_return_mileage
        ? route.distance_miles
        : route.distance_miles;

    const labourCharge =
      time.billable_hours *
      customer_rates
        .labour_rate_gbp;

    const mileageCharge =
      customerMileage *
      customer_rates
        .mileage_rate_gbp;

    const secondPersonCharge =
      time.billable_hours *
      customer_rates
        .second_person_rate_gbp *
      extraCrewMembers;

    const waitingCharge =
      time.waiting_hours *
      customer_rates
        .waiting_time_rate_gbp;

    const stopTypeCounts =
      countStopTypes(
        ordered_stops
      );

    const calloutCharge =
      customer_rates
        .callout_charge_gbp;

    const stopCharge =
      ordered_stops.length *
      customer_rates
        .per_stop_charge_gbp;

    const installationCharge =
      (
        stopTypeCounts
          .installation ||
        stopTypeCounts
          .service ||
        0
      ) *
      customer_rates
        .installation_charge_gbp;

    const disposalCharge =
      (
        stopTypeCounts
          .disposal ||
        0
      ) *
      customer_rates
        .disposal_charge_gbp;

    const specialistHandlingCharge =
      (
        stopTypeCounts
          .specialist_handling ||
        0
      ) *
      customer_rates
        .specialist_handling_charge_gbp;

    const visibleAdditionalCharges =
      additional_charges.filter(
        charge =>
          charge.customer_visible !==
          false
      );

    const manualAdditionalCharge =
      visibleAdditionalCharges.reduce(
        (total, charge) =>
          total +
          charge.amount_gbp,
        0
      );

    const coreSubtotal =
      labourCharge +
      mileageCharge +
      secondPersonCharge +
      waitingCharge;

    const fixedSubtotal =
      calloutCharge +
      stopCharge +
      installationCharge +
      disposalCharge +
      specialistHandlingCharge +
      manualAdditionalCharge;

    const surcharge =
      dateSurchargePercentage({
        planned_date,
        planned_start_time,
        customer_rates,
        is_bank_holiday
      });

    const surchargeAmount =
      coreSubtotal *
      surcharge.total_pct /
      100;

    const calculatedSubtotal =
      coreSubtotal +
      fixedSubtotal +
      surchargeAmount;

    const minimumAdjustment =
      Math.max(
        0,
        customer_rates
          .minimum_charge_gbp -
        calculatedSubtotal
      );

    const subtotalExVat =
      calculatedSubtotal +
      minimumAdjustment;

    const vatAmount =
      subtotalExVat *
      customer_rates
        .vat_rate_pct /
      100;

    const totalIncVat =
      subtotalExVat +
      vatAmount;

    return {
      labour_charge_gbp:
        roundMoney(
          labourCharge
        ),

      mileage_charge_gbp:
        roundMoney(
          mileageCharge
        ),

      second_person_charge_gbp:
        roundMoney(
          secondPersonCharge
        ),

      waiting_time_charge_gbp:
        roundMoney(
          waitingCharge
        ),

      callout_charge_gbp:
        roundMoney(
          calloutCharge
        ),

      per_stop_charge_gbp:
        roundMoney(
          stopCharge
        ),

      installation_charge_gbp:
        roundMoney(
          installationCharge
        ),

      disposal_charge_gbp:
        roundMoney(
          disposalCharge
        ),

      specialist_handling_charge_gbp:
        roundMoney(
          specialistHandlingCharge
        ),

      manual_additional_charge_gbp:
        roundMoney(
          manualAdditionalCharge
        ),

      surcharge_percentage:
        roundTo(
          surcharge.total_pct,
          2
        ),

      surcharge_amount_gbp:
        roundMoney(
          surchargeAmount
        ),

      minimum_charge_adjustment_gbp:
        roundMoney(
          minimumAdjustment
        ),

      additional_charge_gbp:
        roundMoney(
          fixedSubtotal +
          surchargeAmount +
          minimumAdjustment
        ),

      total_ex_vat_gbp:
        roundMoney(
          subtotalExVat
        ),

      vat_rate_pct:
        roundTo(
          customer_rates
            .vat_rate_pct,
          2
        ),

      vat_gbp:
        roundMoney(
          vatAmount
        ),

      total_inc_vat_gbp:
        roundMoney(
          totalIncVat
        ),

      billable_hours:
        roundTo(
          time.billable_hours,
          2
        ),

      billed_miles:
        roundTo(
          customerMileage,
          2
        ),

      extra_crew_members:
        extraCrewMembers,

      line_items: [
        {
          key:
            "labour",

          description:
            "Labour",

          quantity:
            roundTo(
              time.billable_hours,
              2
            ),

          unit:
            "hour",

          rate_gbp:
            customer_rates
              .labour_rate_gbp,

          total_gbp:
            roundMoney(
              labourCharge
            )
        },

        {
          key:
            "mileage",

          description:
            "Mileage",

          quantity:
            roundTo(
              customerMileage,
              2
            ),

          unit:
            "mile",

          rate_gbp:
            customer_rates
              .mileage_rate_gbp,

          total_gbp:
            roundMoney(
              mileageCharge
            )
        },

        ...(secondPersonCharge > 0
          ? [
              {
                key:
                  "second_person",

                description:
                  "Additional crew",

                quantity:
                  roundTo(
                    time.billable_hours *
                    extraCrewMembers,
                    2
                  ),

                unit:
                  "crew hour",

                rate_gbp:
                  customer_rates
                    .second_person_rate_gbp,

                total_gbp:
                  roundMoney(
                    secondPersonCharge
                  )
              }
            ]
          : []),

        ...(waitingCharge > 0
          ? [
              {
                key:
                  "waiting",

                description:
                  "Waiting time",

                quantity:
                  roundTo(
                    time.waiting_hours,
                    2
                  ),

                unit:
                  "hour",

                rate_gbp:
                  customer_rates
                    .waiting_time_rate_gbp,

                total_gbp:
                  roundMoney(
                    waitingCharge
                  )
              }
            ]
          : []),

        ...visibleAdditionalCharges.map(
          charge => ({
            key:
              charge.id,

            description:
              charge.description,

            quantity:
              1,

            unit:
              "item",

            rate_gbp:
              charge.amount_gbp,

            total_gbp:
              charge.amount_gbp,

            taxable:
              charge.taxable
          })
        )
      ]
    };
  }

  /* =========================================================
   * INTERNAL COSTS
   * ========================================================= */

  function calculateInternalCosts({
    route,
    time,
    internal_rates,
    crew_size,
    additional_charges
  }) {
    const crewSize =
      Math.max(
        1,
        Math.round(
          toNumber(
            crew_size,
            1
          )
        )
      );

    const extraCrewMembers =
      Math.max(
        0,
        crewSize - 1
      );

    const driverLabourCost =
      time.operational_hours *
      internal_rates
        .labour_cost_per_hour_gbp;

    const extraCrewCost =
      time.operational_hours *
      internal_rates
        .second_person_cost_per_hour_gbp *
      extraCrewMembers;

    const totalLabourCost =
      driverLabourCost +
      extraCrewCost;

    const vehicleCost =
      time.operational_hours *
      internal_rates
        .vehicle_cost_per_hour_gbp;

    const fuelLitres =
      route.distance_km /
      100 *
      internal_rates
        .fuel_litres_per_100km;

    const fuelVatFactor =
      1 +
      internal_rates
        .diesel_vat_rate_pct /
      100;

    const fuelPriceExVat =
      fuelVatFactor > 0
        ? internal_rates
            .diesel_price_per_litre_gbp_inc_vat /
          fuelVatFactor
        : internal_rates
            .diesel_price_per_litre_gbp_inc_vat;

    const fuelCost =
      fuelLitres *
      fuelPriceExVat;

    const chargeLineInternalCost =
      additional_charges.reduce(
        (total, charge) =>
          total +
          charge
            .internal_cost_gbp,
        0
      );

    const additionalInternalCost =
      chargeLineInternalCost +
      internal_rates
        .additional_internal_cost_gbp;

    const totalCost =
      totalLabourCost +
      vehicleCost +
      fuelCost +
      additionalInternalCost;

    return {
      driver_labour_cost_gbp:
        roundMoney(
          driverLabourCost
        ),

      extra_crew_cost_gbp:
        roundMoney(
          extraCrewCost
        ),

      labour_cost_gbp:
        roundMoney(
          totalLabourCost
        ),

      vehicle_cost_gbp:
        roundMoney(
          vehicleCost
        ),

      fuel_litres:
        roundTo(
          fuelLitres,
          2
        ),

      fuel_price_ex_vat_gbp:
        roundTo(
          fuelPriceExVat,
          4
        ),

      fuel_cost_gbp:
        roundMoney(
          fuelCost
        ),

      additional_cost_gbp:
        roundMoney(
          additionalInternalCost
        ),

      total_cost_gbp:
        roundMoney(
          totalCost
        )
    };
  }

  /* =========================================================
   * FULL QUOTE PREVIEW
   * ========================================================= */

  async function previewServiceJob({
    depot,
    stops,
    customer_rates = {},
    internal_rates = {},
    route_settings = {},
    crew_size = 1,
    additional_charges = [],
    planned_date = null,
    planned_start_time = "08:00",
    is_bank_holiday = false
  }) {
    const normalizedCustomerRates =
      normalizeCustomerRates(
        customer_rates
      );

    const normalizedInternalRates =
      normalizeInternalRates(
        internal_rates
      );

    const normalizedRouteSettings =
      normalizeRouteSettings({
        ...route_settings,

        include_return_to_depot:
          route_settings
            .include_return_to_depot ??
          normalizedCustomerRates
            .include_return_to_depot
      });

    const normalizedStops =
      normalizeStops(
        stops,
        normalizedRouteSettings
      );

    const normalizedCharges =
      normalizeAdditionalCharges(
        additional_charges
      );

    const route =
      await calculateRoute({
        depot,
        stops:
          normalizedStops,

        settings:
          normalizedRouteSettings
      });

    const time =
      calculateTimeSummary({
        route,
        stops:
          route.ordered_stops,

        customer_rates:
          normalizedCustomerRates
      });

    const customerQuote =
      calculateCustomerQuote({
        route,
        ordered_stops:
          route.ordered_stops,

        time,

        customer_rates:
          normalizedCustomerRates,

        crew_size,

        additional_charges:
          normalizedCharges,

        planned_date,
        planned_start_time,
        is_bank_holiday
      });

    const internalCosts =
      calculateInternalCosts({
        route,
        time,

        internal_rates:
          normalizedInternalRates,

        crew_size,

        additional_charges:
          normalizedCharges
      });

    const margin =
      customerQuote
        .total_ex_vat_gbp -
      internalCosts
        .total_cost_gbp;

    const marginPercentage =
      customerQuote
        .total_ex_vat_gbp >
      0
        ? (
            margin /
            customerQuote
              .total_ex_vat_gbp
          ) *
          100
        : 0;

    return {
      ok:
        true,

      engine_version:
        VERSION,

      calculated_at:
        new Date()
          .toISOString(),

      route,

      ordered_stops:
        route.ordered_stops,

      time: {
        drive_hours:
          roundTo(
            time.drive_hours,
            2
          ),

        service_hours:
          roundTo(
            time.service_hours,
            2
          ),

        waiting_hours:
          roundTo(
            time.waiting_hours,
            2
          ),

        break_hours:
          roundTo(
            time.break_hours,
            2
          ),

        total_hours:
          roundTo(
            time.operational_hours,
            2
          ),

        operational_hours:
          roundTo(
            time.operational_hours,
            2
          ),

        billable_hours:
          roundTo(
            time.billable_hours,
            2
          )
      },

      customer_quote:
        customerQuote,

      internal_costs:
        internalCosts,

      margin: {
        revenue_ex_vat_gbp:
          customerQuote
            .total_ex_vat_gbp,

        internal_cost_gbp:
          internalCosts
            .total_cost_gbp,

        margin_gbp:
          roundMoney(
            margin
          ),

        margin_pct:
          roundTo(
            marginPercentage,
            2
          )
      },

      normalized_input: {
        customer_rates:
          normalizedCustomerRates,

        internal_rates:
          normalizedInternalRates,

        route_settings:
          normalizedRouteSettings,

        additional_charges:
          normalizedCharges,

        crew_size:
          Math.max(
            1,
            Math.round(
              toNumber(
                crew_size,
                1
              )
            )
          )
      }
    };
  }

  /* =========================================================
   * DATABASE PAYLOAD HELPER
   * ========================================================= */

  function toServiceJobPayload(
    preview
  ) {
    if (
      !preview?.ok
    ) {
      throw new ServiceJobEngineError(
        "A valid Service Job preview is required.",
        "INVALID_PREVIEW"
      );
    }

    const quote =
      preview.customer_quote;

    const costs =
      preview.internal_costs;

    return {
      estimated_distance_km:
        roundTo(
          preview.route
            .distance_km,
          2
        ),

      estimated_distance_miles:
        roundTo(
          preview.route
            .distance_miles,
          2
        ),

      estimated_drive_hours:
        roundTo(
          preview.time
            .drive_hours,
          2
        ),

      estimated_service_hours:
        roundTo(
          preview.time
            .service_hours,
          2
        ),

      estimated_total_hours:
        roundTo(
          preview.time
            .total_hours,
          2
        ),

      quote_labour_gbp:
        quote
          .labour_charge_gbp,

      quote_mileage_gbp:
        quote
          .mileage_charge_gbp,

      quote_second_person_gbp:
        quote
          .second_person_charge_gbp,

      quote_waiting_gbp:
        quote
          .waiting_time_charge_gbp,

      quote_additional_gbp:
        quote
          .additional_charge_gbp,

      quote_total_ex_vat_gbp:
        quote
          .total_ex_vat_gbp,

      quote_vat_rate_pct:
        quote
          .vat_rate_pct,

      quote_vat_gbp:
        quote
          .vat_gbp,

      quote_total_inc_vat_gbp:
        quote
          .total_inc_vat_gbp,

      estimated_cost_labour_gbp:
        costs
          .labour_cost_gbp,

      estimated_cost_vehicle_gbp:
        costs
          .vehicle_cost_gbp,

      estimated_cost_fuel_gbp:
        costs
          .fuel_cost_gbp,

      estimated_cost_additional_gbp:
        costs
          .additional_cost_gbp,

      estimated_cost_total_gbp:
        costs
          .total_cost_gbp,

      estimated_margin_gbp:
        preview.margin
          .margin_gbp,

      estimated_margin_pct:
        preview.margin
          .margin_pct
    };
  }

  /* =========================================================
   * MAP PAYLOAD HELPER
   * ========================================================= */

  function toMapRouteStops(
    preview,
    routeId =
      "service-job-preview"
  ) {
    if (
      !preview?.ordered_stops
    ) {
      return [];
    }

    return preview
      .ordered_stops
      .map(
        (
          stop,
          index
        ) => ({
          id:
            stop.local_id ||
            stop.id ||
            `service-stop-${index + 1}`,

          route_id:
            routeId,

          order_id:
            stop.local_id ||
            stop.id ||
            `service-stop-${index + 1}`,

          stop_sequence:
            index + 1,

          stop_number:
            index + 1,

          stop_name:
            stop.stop_name ||
            `Stop ${index + 1}`,

          stop_type:
            stop.stop_type,

          address_1:
            stop.address_1,

          address_2:
            stop.address_2,

          city:
            stop.city,

          postcode:
            stop.postcode,

          latitude:
            stop.latitude,

          longitude:
            stop.longitude,

          service_minutes:
            stop.service_minutes
        })
      );
  }

  function toRouteGeometry(
    preview
  ) {
    return (
      preview?.route
        ?.geometry ||
      null
    );
  }

  /* =========================================================
   * PUBLIC API
   * ========================================================= */

  window.VeynorServiceJobEngine = {
    version:
      VERSION,

    ServiceJobEngineError,

    defaults: {
      route_settings: {
        ...DEFAULT_ROUTE_SETTINGS
      },

      customer_rates: {
        ...DEFAULT_CUSTOMER_RATES
      },

      internal_rates: {
        ...DEFAULT_INTERNAL_RATES
      }
    },

    helpers: {
      clean,
      normalize,
      toNumber,
      roundTo,
      roundMoney,
      kilometresToMiles,
      milesToKilometres,
      hasFiniteCoordinates,
      normalizeDepot,
      normalizeStop,
      normalizeStops,
      normalizeCustomerRates,
      normalizeInternalRates,
      normalizeRouteSettings,
      normalizeAdditionalCharges,
      haversineKm,
      roundBillableHours
    },

    optimiseStops,

    calculateRoute,

    calculateTimeSummary,

    calculateCustomerQuote,

    calculateInternalCosts,

    previewServiceJob,

    toServiceJobPayload,

    toMapRouteStops,

    toRouteGeometry
  };

  window.dispatchEvent(
    new CustomEvent(
      "veynor:service-job-engine-ready",
      {
        detail: {
          version:
            VERSION
        }
      }
    )
  );
})();