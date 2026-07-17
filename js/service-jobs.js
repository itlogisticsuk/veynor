(function () {
  "use strict";

  /* =========================================================
   * VEYNOR SERVICE JOBS
   * ========================================================= */

  const TENANT_NAME = "Sofa2U";

  const OSRM_BASE_URL =
    "https://router.project-osrm.org";

  const POSTCODES_IO_BASE_URL =
    "https://api.postcodes.io/postcodes";

  const PREVIEW_ROUTE_ID =
    "service-job-preview";

  const DEFAULT_SERVICE_RATES = {
    enabled: false,

    labour_rate_gbp: 0,
    mileage_rate_gbp: 0,
    second_person_rate_gbp: 0,
    waiting_time_rate_gbp: 0,

    minimum_charge_gbp: 0,
    minimum_billable_hours: 0,
    labour_rounding_minutes: 15,

    callout_charge_gbp: 0,
    per_stop_charge_gbp: 0,

    installation_charge_gbp: 0,
    disposal_charge_gbp: 0,
    specialist_handling_charge_gbp: 0,

    vat_rate_pct: 20,
    quote_validity_days: 14,

    include_return_to_depot: true,
    bill_depot_to_depot: true,
    bill_return_mileage: true,

    default_crew_size: 1,
    default_vehicle_id: null,

    quote_pricing_note: ""
  };

  const DEFAULT_INTERNAL_SETTINGS = {
    labour_cost_per_hour_gbp: 38.5,
    vehicle_cost_per_hour_gbp: 0,
    diesel_price_per_litre_gbp_inc_vat: 1.55,

    average_speed_kmh: 50,
    stop_time_minutes: 15,
    distance_factor: 1.25,

    depot_name: "Home Depot",
    depot_lat: null,
    depot_lng: null
  };

  let client = null;
  let companyId = null;

  let settingsMap =
    new Map();

  let ownerProfiles = [];
  let productOwners = [];
  let ownerRates = [];

  let serviceJobs = [];
  let filteredJobs = [];

  let vehicles = [];
  let drivers = [];

  let currentJob = null;
  let currentStops = [];
  let currentCharges = [];

  let selectedJobId = null;
  let calculationResult = null;

  let internalSettings = {
    ...DEFAULT_INTERNAL_SETTINGS
  };

  const $ = id =>
    document.getElementById(id);

  /* =========================================================
   * GENERAL HELPERS
   * ========================================================= */

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactKey(value) {
    return normalize(value)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
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

  function roundMoney(value) {
    return Number(
      toNumber(value, 0)
        .toFixed(2)
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(
        /[&<>"']/g,
        character => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        }[character])
      );
  }

  function formatMoney(value) {
    return `£${toNumber(value, 0)
      .toLocaleString(
        "en-GB",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      )}`;
  }

  function formatNumber(
    value,
    digits = 0
  ) {
    return toNumber(value, 0)
      .toLocaleString(
        "en-GB",
        {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        }
      );
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(value);
    }

    return date.toLocaleDateString(
      "en-GB"
    );
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(value);
    }

    return date.toLocaleString(
      "en-GB",
      {
        dateStyle: "medium",
        timeStyle: "short"
      }
    );
  }

  function titleCase(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(
        /\b\w/g,
        letter =>
          letter.toUpperCase()
      );
  }

  function todayIso() {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }

  function nowIso() {
    return new Date()
      .toISOString();
  }

  function makeTemporaryId(prefix) {
    if (
      window.crypto?.randomUUID
    ) {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value || ""));
  }

  function setText(
    id,
    value
  ) {
    const element = $(id);

    if (element) {
      element.textContent =
        value ?? "";
    }
  }

  function setValue(
    id,
    value
  ) {
    const element = $(id);

    if (element) {
      element.value =
        value ?? "";
    }
  }

  function getValue(id) {
    return $(id)?.value ?? "";
  }

  function setDisabled(
    id,
    disabled
  ) {
    const element = $(id);

    if (element) {
      element.disabled =
        Boolean(disabled);
    }
  }

  function setCheckbox(
    id,
    checked
  ) {
    const element = $(id);

    if (element) {
      element.checked =
        checked !== false;
    }
  }

  function getCheckbox(id) {
    return $(id)?.checked !== false;
  }

  function showNotice(
    message,
    type = "ok"
  ) {
    const notice =
      $("serviceNotice");

    if (!notice) {
      return;
    }

    notice.textContent =
      message || "";

    notice.className =
      `service-notice show ${
        type === "err"
          ? "err"
          : ""
      }`;

    clearTimeout(
      window.__serviceJobsNoticeTimer
    );

    window.__serviceJobsNoticeTimer =
      window.setTimeout(
        () => {
          notice.className =
            "service-notice";
        },
        6500
      );
  }

  function setBusy(
    buttonId,
    busy,
    busyText = "Working..."
  ) {
    const button =
      $(buttonId);

    if (!button) {
      return;
    }

    if (busy) {
      if (
        !button.dataset.originalText
      ) {
        button.dataset.originalText =
          button.textContent;
      }

      button.textContent =
        busyText;

      button.disabled = true;

      return;
    }

    button.textContent =
      button.dataset.originalText ||
      button.textContent;

    delete button.dataset.originalText;

    button.disabled = false;
  }

  /* =========================================================
   * SUPABASE
   * ========================================================= */

  function db() {
    if (client) {
      return client;
    }

    if (
      typeof sb !== "function"
    ) {
      throw new Error(
        "Supabase helper sb() is not available."
      );
    }

    client = sb();

    return client;
  }

  async function getCompanyId() {
    if (companyId) {
      return companyId;
    }

    const {
      data,
      error
    } = await db()
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data?.id) {
      throw new Error(
        `Company "${TENANT_NAME}" was not found.`
      );
    }

    companyId = data.id;

    return companyId;
  }

  /* =========================================================
   * SETTINGS AND PRODUCT OWNERS
   * ========================================================= */

  async function loadSettings() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await db()
      .from("settings")
      .select(
        "setting_key, setting_value"
      )
      .eq("company_id", cid);

    if (error) {
      throw error;
    }

    settingsMap =
      new Map(
        (data || []).map(row => [
          row.setting_key,
          row.setting_value
        ])
      );

    internalSettings = {
      labour_cost_per_hour_gbp:
        toNumber(
          settingsMap.get(
            "labour_cost_per_hour_gbp"
          ),
          DEFAULT_INTERNAL_SETTINGS
            .labour_cost_per_hour_gbp
        ),

      vehicle_cost_per_hour_gbp:
        toNumber(
          settingsMap.get(
            "vehicle_cost_per_hour_gbp"
          ),
          DEFAULT_INTERNAL_SETTINGS
            .vehicle_cost_per_hour_gbp
        ),

      diesel_price_per_litre_gbp_inc_vat:
        toNumber(
          settingsMap.get(
            "diesel_price_per_litre_gbp_inc_vat"
          ),
          DEFAULT_INTERNAL_SETTINGS
            .diesel_price_per_litre_gbp_inc_vat
        ),

      average_speed_kmh:
        toNumber(
          settingsMap.get(
            "planner_average_speed_kmh"
          ) ||
          settingsMap.get(
            "average_speed_kmh"
          ),
          DEFAULT_INTERNAL_SETTINGS
            .average_speed_kmh
        ),

      stop_time_minutes:
        toNumber(
          settingsMap.get(
            "planner_stop_time_minutes"
          ) ||
          settingsMap.get(
            "stop_time_minutes"
          ),
          DEFAULT_INTERNAL_SETTINGS
            .stop_time_minutes
        ),

      distance_factor:
        toNumber(
          settingsMap.get(
            "planner_distance_factor"
          ) ||
          settingsMap.get(
            "distance_factor"
          ),
          DEFAULT_INTERNAL_SETTINGS
            .distance_factor
        ),

      depot_name:
        clean(
          settingsMap.get(
            "home_depot_name"
          ) ||
          settingsMap.get(
            "depot_name"
          ) ||
          DEFAULT_INTERNAL_SETTINGS
            .depot_name
        ),

      depot_lat:
        toNumber(
          settingsMap.get(
            "home_depot_lat"
          ) ||
          settingsMap.get(
            "depot_lat"
          ),
          null
        ),

      depot_lng:
        toNumber(
          settingsMap.get(
            "home_depot_lng"
          ) ||
          settingsMap.get(
            "depot_lng"
          ),
          null
        )
    };

    loadOwnerProfilesFromSettings();

    window.depotMapPoint =
      hasDepotCoordinates()
        ? {
            name:
              internalSettings
                .depot_name,

            latitude:
              internalSettings
                .depot_lat,

            longitude:
              internalSettings
                .depot_lng
          }
        : null;
  }

  function loadOwnerProfilesFromSettings() {
    const raw =
      settingsMap.get(
        "product_owner_profiles"
      );

    if (!raw) {
      ownerProfiles = [];
      productOwners = [];
      return;
    }

    try {
      const parsed =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;

      ownerProfiles =
        Array.isArray(parsed)
          ? parsed
          : [];
    } catch (error) {
      console.warn(
        "Invalid product_owner_profiles setting:",
        error
      );

      ownerProfiles = [];
    }
  }

  function loadProductOwners() {
    productOwners =
      (ownerProfiles || [])
        .map(profile => {
          const key =
            compactKey(
              profile?.key ||
              profile?.product_owner_key ||
              profile?.customer_code ||
              profile?.code ||
              profile?.name ||
              ""
            );

          const name =
            clean(
              profile?.name ||
              profile?.product_owner_name ||
              profile?.trading_name ||
              profile?.tradingName ||
              profile?.company_name ||
              profile?.customer_code ||
              key
            );

          return {
            ...profile,

            key,
            id: key,

            product_owner_key:
              key,

            product_owner_name:
              name,

            name,

            customer_code:
              clean(
                profile?.customer_code ||
                key.toUpperCase()
              )
          };
        })
        .filter(owner =>
          owner.key &&
          owner.name
        )
        .sort((a, b) =>
          a.name.localeCompare(
            b.name,
            "en-GB"
          )
        );

    renderProductOwnerOptions();
  }

  function renderProductOwnerOptions() {
    const ownerSelect =
      $("serviceProductOwner");

    if (ownerSelect) {
      const currentValue =
        ownerSelect.value;

      ownerSelect.innerHTML = [
        `
          <option value="">
            Select Product Owner
          </option>
        `,

        ...productOwners.map(owner => `
          <option value="${escapeHtml(owner.key)}">
            ${escapeHtml(owner.name)}
          </option>
        `)
      ].join("");

      if (
        productOwners.some(owner =>
          owner.key === currentValue
        )
      ) {
        ownerSelect.value =
          currentValue;
      }
    }

    const filter =
      $("filterServiceOwner");

    if (filter) {
      const currentValue =
        filter.value;

      filter.innerHTML = [
        `
          <option value="">
            All owners
          </option>
        `,

        ...productOwners.map(owner => `
          <option value="${escapeHtml(owner.key)}">
            ${escapeHtml(owner.name)}
          </option>
        `)
      ].join("");

      if (
        productOwners.some(owner =>
          owner.key === currentValue
        )
      ) {
        filter.value =
          currentValue;
      } else {
        filter.value = "";
      }
    }
  }

  function getSelectedOwner() {
    const ownerKey =
      compactKey(
        getValue(
          "serviceProductOwner"
        )
      );

    if (!ownerKey) {
      return null;
    }

    return (
      productOwners.find(owner =>
        owner.key === ownerKey
      ) ||
      null
    );
  }

  function findOwnerProfile(
    ownerKey
  ) {
    const key =
      compactKey(ownerKey);

    return (
      productOwners.find(owner =>
        owner.key === key
      ) ||
      null
    );
  }

  /* =========================================================
   * SERVICE RATES
   * ========================================================= */

  async function loadOwnerRates() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await db()
      .from(
        "product_owner_service_rates"
      )
      .select("*")
      .eq("company_id", cid)
      .eq("is_active", true);

    if (error) {
      console.warn(
        "Service rates could not be loaded:",
        error.message
      );

      ownerRates = [];
      return;
    }

    ownerRates =
      data || [];
  }

  function getRatesForOwner(
    ownerKey
  ) {
    const key =
      compactKey(ownerKey);

    const row =
      ownerRates.find(rate =>
        compactKey(
          rate.product_owner_key
        ) === key
      );

    if (!row) {
      return {
        ...DEFAULT_SERVICE_RATES
      };
    }

    return {
      enabled:
        row.is_active !== false &&
        row.enable_service_jobs !==
          false,

      labour_rate_gbp:
        toNumber(
          row.labour_rate_gbp,
          0
        ),

      mileage_rate_gbp:
        toNumber(
          row.mileage_rate_gbp,
          0
        ),

      second_person_rate_gbp:
        toNumber(
          row.second_person_rate_gbp,
          0
        ),

      waiting_time_rate_gbp:
        toNumber(
          row.waiting_time_rate_gbp,
          0
        ),

      minimum_charge_gbp:
        toNumber(
          row.minimum_charge_gbp,
          0
        ),

      minimum_billable_hours:
        toNumber(
          row.minimum_billable_hours,
          0
        ),

      labour_rounding_minutes:
        Math.max(
          1,
          toNumber(
            row.labour_rounding_minutes,
            15
          )
        ),

      callout_charge_gbp:
        toNumber(
          row.callout_charge_gbp,
          0
        ),

      per_stop_charge_gbp:
        toNumber(
          row.per_stop_charge_gbp,
          0
        ),

      installation_charge_gbp:
        toNumber(
          row.installation_charge_gbp,
          0
        ),

      disposal_charge_gbp:
        toNumber(
          row.disposal_charge_gbp,
          0
        ),

      specialist_handling_charge_gbp:
        toNumber(
          row.specialist_handling_charge_gbp,
          0
        ),

      vat_rate_pct:
        toNumber(
          row.vat_rate_pct,
          20
        ),

      quote_validity_days:
        toNumber(
          row.quote_validity_days,
          14
        ),

      include_return_to_depot:
        row.include_return_to_depot !==
        false,

      bill_depot_to_depot:
        row.bill_depot_to_depot !==
        false,

      bill_return_mileage:
        row.bill_return_mileage !==
        false,

      default_crew_size:
        Math.max(
          1,
          toNumber(
            row.default_crew_size,
            1
          )
        ),

      default_vehicle_id:
        row.default_vehicle_id ||
        null,

      quote_pricing_note:
        row.quote_pricing_note ||
        ""
    };
  }

  function renderOwnerRates() {
    const owner =
      getSelectedOwner();

    const rates =
      getRatesForOwner(
        owner?.key
      );

    setText(
      "rateLabourDisplay",
      formatMoney(
        rates.labour_rate_gbp
      )
    );

    setText(
      "rateMileageDisplay",
      `${formatMoney(
        rates.mileage_rate_gbp
      )}`
    );

    setText(
      "rateSecondPersonDisplay",
      formatMoney(
        rates.second_person_rate_gbp
      )
    );

    setText(
      "rateWaitingDisplay",
      formatMoney(
        rates.waiting_time_rate_gbp
      )
    );

    setText(
      "rateMinimumDisplay",
      formatMoney(
        rates.minimum_charge_gbp
      )
    );

    setText(
      "rateVatDisplay",
      `${formatNumber(
        rates.vat_rate_pct,
        0
      )}%`
    );

    if (!owner) {
      setText(
        "serviceRateSource",
        "Not loaded"
      );

      return;
    }

    setText(
      "serviceRateSource",
      rates.enabled
        ? owner.name
        : `${owner.name} · Not configured`
    );

    if (!currentJob?.id) {
      setValue(
        "serviceQuoteValidity",
        String(
          rates.quote_validity_days ||
          14
        )
      );

      setValue(
        "serviceCrewSize",
        String(
          rates.default_crew_size ||
          1
        )
      );

      setCheckbox(
        "serviceIncludeReturnDepot",
        rates.include_return_to_depot
      );

      if (
        rates.default_vehicle_id &&
        vehicles.some(vehicle =>
          String(vehicle.id) ===
          String(
            rates.default_vehicle_id
          )
        )
      ) {
        setValue(
          "serviceVehicle",
          rates.default_vehicle_id
        );
      }
    }
  }

  /* =========================================================
   * VEHICLES AND DRIVERS
   * ========================================================= */

  async function loadVehicles() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await db()
      .from("vehicles")
      .select("*")
      .eq("company_id", cid);

    if (error) {
      throw error;
    }

    vehicles =
      (data || [])
        .filter(vehicle =>
          vehicle.active !== false &&
          vehicle.is_active !== false &&
          vehicle.use_in_planning !== false
        )
        .filter(vehicle => {
          const type =
            normalize(
              vehicle.vehicle_type ||
              vehicle.type
            );

          return (
            type !== "carrier" &&
            type !==
              "warehouse_pickup"
          );
        })
        .map(vehicle => ({
          ...vehicle,

          capacity_m3:
            Math.max(
              toNumber(
                vehicle.capacity_m3,
                0
              ),

              toNumber(
                vehicle.max_volume_m3,
                0
              ),

              toNumber(
                vehicle.volume_capacity_m3,
                0
              )
            ),

          labour_cost_per_hour_gbp:
            toNumber(
              vehicle.labour_cost_per_hour_gbp,
              internalSettings
                .labour_cost_per_hour_gbp
            ),

          vehicle_cost_per_hour_gbp:
            toNumber(
              vehicle.vehicle_cost_per_hour_gbp ??
              vehicle.cost_per_hour_gbp,
              internalSettings
                .vehicle_cost_per_hour_gbp
            ),

          average_speed_kmh:
            toNumber(
              vehicle.average_speed_kmh,
              internalSettings
                .average_speed_kmh
            ),

          fuel_litres_per_100km:
            toNumber(
              vehicle.fuel_litres_per_100km,
              10
            )
        }))
        .sort((a, b) =>
          clean(
            a.name ||
            a.vehicle_name
          ).localeCompare(
            clean(
              b.name ||
              b.vehicle_name
            )
          )
        );

    renderVehicleOptions();

    window.activeVehiclesMapRows =
      vehicles;
  }

  function renderVehicleOptions() {
    const select =
      $("serviceVehicle");

    if (!select) {
      return;
    }

    const current =
      select.value;

    select.innerHTML = [
      `
        <option value="">
          Best available vehicle
        </option>
      `,

      ...vehicles.map(vehicle => {
        const label = [
          vehicle.name ||
          vehicle.vehicle_name ||
          "Vehicle",

          vehicle.registration ||
          vehicle.vehicle_code ||
          "",

          vehicle.capacity_m3
            ? `${formatNumber(
                vehicle.capacity_m3,
                1
              )} m³`
            : ""
        ]
          .filter(Boolean)
          .join(" · ");

        return `
          <option value="${escapeHtml(vehicle.id)}">
            ${escapeHtml(label)}
          </option>
        `;
      })
    ].join("");

    select.value =
      vehicles.some(vehicle =>
        String(vehicle.id) ===
        String(current)
      )
        ? current
        : "";
  }

  async function loadDrivers() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await db()
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        full_name,
        email,
        role,
        is_driver,
        is_active,
        use_in_planning
      `)
      .eq("company_id", cid)
      .eq("is_active", true);

    if (error) {
      console.warn(
        "Drivers could not be loaded:",
        error.message
      );

      drivers = [];
      renderDriverOptions();
      return;
    }

    drivers =
      (data || [])
        .filter(row => {
          const role =
            normalize(row.role);

          return (
            row.is_driver === true ||
            role === "driver" ||
            role === "chauffeur"
          );
        })
        .filter(row =>
          row.use_in_planning !== false
        )
        .map(row => ({
          ...row,

          planning_id:
            row.auth_user_id ||
            row.id
        }))
        .sort((a, b) =>
          clean(
            a.full_name ||
            a.email
          ).localeCompare(
            clean(
              b.full_name ||
              b.email
            )
          )
        );

    renderDriverOptions();
  }

  function renderDriverOptions() {
    const select =
      $("serviceDriver");

    if (!select) {
      return;
    }

    const current =
      select.value;

    select.innerHTML = [
      `
        <option value="">
          No fixed driver
        </option>
      `,

      ...drivers.map(driver => `
        <option value="${escapeHtml(driver.planning_id)}">
          ${escapeHtml(
            driver.full_name ||
            driver.email ||
            "Driver"
          )}
        </option>
      `)
    ].join("");

    select.value =
      drivers.some(driver =>
        String(
          driver.planning_id
        ) ===
        String(current)
      )
        ? current
        : "";
  }

  /* =========================================================
   * SERVICE JOB LIST
   * ========================================================= */

  async function loadServiceJobs() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await db()
      .from("service_jobs")
      .select("*")
      .eq("company_id", cid)
      .order(
        "updated_at",
        {
          ascending: false
        }
      );

    if (error) {
      throw error;
    }

    serviceJobs =
      (data || []).map(row => {
        const ownerKey =
          compactKey(
            row.product_owner_key
          );

        const owner =
          findOwnerProfile(
            ownerKey
          );

        return {
          ...row,

          product_owner_key:
            ownerKey,

          product_owner_name:
            row.product_owner_name ||
            owner?.name ||
            ownerKey ||
            "—"
        };
      });

    applyJobFilters();
    renderJobList();
  }

  function applyJobFilters() {
    const query =
      normalize(
        getValue(
          "serviceJobSearch"
        )
      );

    const ownerKey =
      compactKey(
        getValue(
          "filterServiceOwner"
        )
      );

    const status =
      normalize(
        getValue(
          "filterServiceStatus"
        )
      );

    filteredJobs =
      serviceJobs.filter(job => {
        if (
          ownerKey &&
          compactKey(
            job.product_owner_key
          ) !== ownerKey
        ) {
          return false;
        }

        if (
          status &&
          normalize(
            job.status
          ) !== status
        ) {
          return false;
        }

        if (query) {
          const haystack = [
            job.service_job_number,
            job.quote_number,
            job.product_owner_key,
            job.product_owner_name,
            job.customer_reference,
            job.job_type,
            job.description,
            job.requested_date,
            job.operations_order_number
          ]
            .join(" ")
            .toLowerCase();

          if (
            !haystack.includes(query)
          ) {
            return false;
          }
        }

        return true;
      });

    setText(
      "serviceJobsCount",
      String(
        filteredJobs.length
      )
    );

    setText(
      "serviceJobsMeta",
      `${filteredJobs.length} job${
        filteredJobs.length === 1
          ? ""
          : "s"
      } shown`
    );
  }

  function renderJobList() {
    const container =
      $("serviceJobList");

    if (!container) {
      return;
    }

    if (!filteredJobs.length) {
      container.innerHTML = `
        <div class="service-job-list-empty">
          No service jobs match the current filters.
        </div>
      `;

      return;
    }

    container.innerHTML =
      filteredJobs
        .map(job => {
          const status =
            normalize(
              job.status ||
              "draft"
            );

          return `
            <button
              type="button"
              class="service-job-item ${
                String(
                  selectedJobId
                ) ===
                String(job.id)
                  ? "active"
                  : ""
              }"
              data-service-job-id="${escapeHtml(job.id)}"
            >
              <div class="service-job-item-head">
                <div>
                  <div class="service-job-number">
                    ${escapeHtml(
                      job.service_job_number ||
                      "Service Job"
                    )}
                  </div>

                  <div class="service-job-owner">
                    ${escapeHtml(
                      job.product_owner_name ||
                      "—"
                    )}
                  </div>
                </div>

                <span class="service-status ${escapeHtml(status)}">
                  ${escapeHtml(
                    titleCase(status)
                  )}
                </span>
              </div>

              <div class="service-job-item-meta">
                <div>
                  <span>Type</span>
                  <strong>
                    ${escapeHtml(
                      titleCase(
                        job.job_type ||
                        "custom"
                      )
                    )}
                  </strong>
                </div>

                <div>
                  <span>Requested</span>
                  <strong>
                    ${escapeHtml(
                      formatDate(
                        job.requested_date
                      )
                    )}
                  </strong>
                </div>

                <div>
                  <span>Stops</span>
                  <strong>
                    ${formatNumber(
                      job.total_stops
                    )}
                  </strong>
                </div>

                <div>
                  <span>Quote</span>
                  <strong>
                    ${formatMoney(
                      job.quote_total_ex_vat_gbp
                    )}
                  </strong>
                </div>
              </div>
            </button>
          `;
        })
        .join("");

    container
      .querySelectorAll(
        "[data-service-job-id]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          async () => {
            try {
              await loadJobDetails(
                button.dataset
                  .serviceJobId
              );
            } catch (error) {
              console.error(error);

              showNotice(
                error.message ||
                "Could not load service job.",
                "err"
              );
            }
          }
        );
      });
  }

  /* =========================================================
   * LOAD CURRENT JOB
   * ========================================================= */

  async function loadJobDetails(jobId) {
    const cid =
      await getCompanyId();

    const [
      jobResult,
      stopsResult,
      chargesResult
    ] = await Promise.all([
      db()
        .from("service_jobs")
        .select("*")
        .eq("company_id", cid)
        .eq("id", jobId)
        .maybeSingle(),

      db()
        .from("service_job_stops")
        .select("*")
        .eq("company_id", cid)
        .eq(
          "service_job_id",
          jobId
        )
        .order(
          "stop_sequence",
          {
            ascending: true
          }
        ),

      db()
        .from(
          "service_job_charge_lines"
        )
        .select("*")
        .eq("company_id", cid)
        .eq(
          "service_job_id",
          jobId
        )
        .order(
          "line_sequence",
          {
            ascending: true
          }
        )
    ]);

    if (jobResult.error) {
      throw jobResult.error;
    }

    if (stopsResult.error) {
      throw stopsResult.error;
    }

    if (chargesResult.error) {
      throw chargesResult.error;
    }

    if (!jobResult.data?.id) {
      throw new Error(
        "Service job was not found."
      );
    }

    const ownerKey =
      compactKey(
        jobResult.data
          .product_owner_key
      );

    const owner =
      findOwnerProfile(
        ownerKey
      );

    currentJob = {
      ...jobResult.data,

      product_owner_key:
        ownerKey,

      product_owner_name:
        jobResult.data
          .product_owner_name ||
        owner?.name ||
        ownerKey ||
        "—"
    };

    currentStops =
      (stopsResult.data || [])
        .map(stop => ({
          ...stop,

          local_id:
            stop.id
        }));

    currentCharges =
      (chargesResult.data || [])
        .map(charge => ({
          ...charge,

          local_id:
            charge.id
        }));

    selectedJobId =
      currentJob.id;

    calculationResult =
      buildCalculationFromJob(
        currentJob
      );

    renderCurrentJob();
    renderJobList();
  }

  function buildCalculationFromJob(job) {
    const hasCalculation =
      toNumber(
        job?.estimated_distance_miles,
        0
      ) > 0 ||
      toNumber(
        job?.estimated_total_hours,
        0
      ) > 0 ||
      toNumber(
        job?.quote_total_ex_vat_gbp,
        0
      ) > 0;

    if (!hasCalculation) {
      return null;
    }

    return {
      distanceKm:
        toNumber(
          job.estimated_distance_km,
          0
        ),

      distanceMiles:
        toNumber(
          job.estimated_distance_miles,
          0
        ),

      driveHours:
        toNumber(
          job.estimated_drive_hours,
          0
        ),

      serviceHours:
        toNumber(
          job.estimated_service_hours,
          0
        ),

      totalHours:
        toNumber(
          job.estimated_total_hours,
          0
        ),

      customerLabour:
        toNumber(
          job.quote_labour_gbp,
          0
        ),

      customerMileage:
        toNumber(
          job.quote_mileage_gbp,
          0
        ),

      customerSecondPerson:
        toNumber(
          job.quote_second_person_gbp,
          0
        ),

      customerWaiting:
        toNumber(
          job.quote_waiting_gbp,
          0
        ),

      customerAdditional:
        toNumber(
          job.quote_additional_gbp,
          0
        ),

      customerTotal:
        toNumber(
          job.quote_total_ex_vat_gbp,
          0
        ),

      internalLabour:
        toNumber(
          job.estimated_cost_labour_gbp,
          0
        ),

      internalVehicle:
        toNumber(
          job.estimated_cost_vehicle_gbp,
          0
        ),

      internalFuel:
        toNumber(
          job.estimated_cost_fuel_gbp,
          0
        ),

      internalAdditional:
        toNumber(
          job.estimated_cost_additional_gbp,
          0
        ),

      internalTotal:
        toNumber(
          job.estimated_cost_total_gbp,
          0
        ),

      margin:
        toNumber(
          job.estimated_margin_gbp,
          0
        ),

      marginPct:
        toNumber(
          job.estimated_margin_pct,
          0
        ),

      orderedStops:
        [...currentStops]
    };
  }

  /* =========================================================
   * NEW JOB AND FORM RENDERING
   * ========================================================= */

  function newServiceJob() {
    currentJob = {
      id: null,

      service_job_number: "",
      quote_number: "",

      operations_order_id: null,
      operations_order_number: "",

      status: "draft",

      product_owner_key: "",
      product_owner_name: "",

      job_type:
        "multi_stop_transport",

      requested_date:
        todayIso(),

      customer_reference: "",
      contact_name: "",
      contact_phone: "",

      description: "",
      internal_notes: "",

      planning_date:
        todayIso(),

      planned_start_time:
        "08:00",

      crew_size: 1,

      preferred_vehicle_id: "",
      preferred_driver_id: "",

      include_return_to_depot:
        true,

      optimise_stop_order:
        true,

      quote_validity_days:
        14
    };

    currentStops = [];

    currentCharges = [
      {
        local_id:
          makeTemporaryId(
            "charge"
          ),

        description:
          "Additional charge",

        amount_gbp: 0,

        internal_cost_gbp: 0,

        charge_type:
          "additional"
      }
    ];

    selectedJobId = null;
    calculationResult = null;

    renderCurrentJob();
    renderJobList();
  }

  function renderCurrentJob() {
    const job =
      currentJob || {};

    setValue(
      "serviceJobId",
      job.id || ""
    );

    setValue(
      "serviceProductOwner",
      job.product_owner_key ||
      ""
    );

    setValue(
      "serviceJobType",
      job.job_type ||
      "multi_stop_transport"
    );

    setValue(
      "serviceRequestedDate",
      job.requested_date ||
      todayIso()
    );

    setValue(
      "serviceCustomerReference",
      job.customer_reference ||
      ""
    );

    setValue(
      "serviceContactName",
      job.contact_name ||
      ""
    );

    setValue(
      "serviceContactPhone",
      job.contact_phone ||
      ""
    );

    setValue(
      "serviceJobDescription",
      job.description ||
      ""
    );

    setValue(
      "serviceInternalNotes",
      job.internal_notes ||
      ""
    );

    setValue(
      "servicePlanningDate",
      job.planning_date ||
      job.requested_date ||
      todayIso()
    );

    setValue(
      "serviceStartTime",
      job.planned_start_time ||
      "08:00"
    );

    setValue(
      "serviceCrewSize",
      String(
        job.crew_size || 1
      )
    );

    setValue(
      "serviceVehicle",
      job.preferred_vehicle_id ||
      ""
    );

    setValue(
      "serviceDriver",
      job.preferred_driver_id ||
      ""
    );

    setValue(
      "serviceQuoteValidity",
      String(
        job.quote_validity_days ||
        14
      )
    );

    setCheckbox(
      "serviceIncludeReturnDepot",
      job.include_return_to_depot !==
        false
    );

    setCheckbox(
      "serviceOptimiseStopOrder",
      job.optimise_stop_order !==
        false
    );

    setText(
      "serviceJobHeading",
      job.service_job_number ||
      "New Service Job"
    );

    setText(
      "serviceJobNumberDisplay",
      job.service_job_number ||
      "New"
    );

    setText(
      "serviceQuoteNumberDisplay",
      job.quote_number ||
      "Not generated"
    );

    setText(
      "serviceOperationsOrderDisplay",
      job.operations_order_number ||
      "Not published"
    );

    setText(
      "serviceUpdatedDisplay",
      job.updated_at
        ? formatDateTime(
            job.updated_at
          )
        : "—"
    );

    updateStatusBadge(
      job.status ||
      "draft"
    );

    renderOwnerRates();
    renderStops();
    renderCharges();
    renderCalculation();
    updateWorkflowButtons();
    updateMap();
  }

  function updateStatusBadge(
    statusValue
  ) {
    const status =
      normalize(
        statusValue ||
        "draft"
      );

    const badge =
      $("serviceJobStatusBadge");

    if (!badge) {
      return;
    }

    badge.className =
      `service-status ${status}`;

    badge.textContent =
      titleCase(status);
  }

  function updateWorkflowButtons() {
    const status =
      normalize(
        currentJob?.status ||
        "draft"
      );

    const hasJob =
      Boolean(
        currentJob?.id
      );

    const hasCalculation =
      Boolean(
        calculationResult
      );

    setDisabled(
      "btnGenerateServiceQuote",
      !hasJob ||
      !hasCalculation ||
      status === "cancelled"
    );

    setDisabled(
      "btnApproveServiceQuote",
      !hasJob ||
      status !== "quoted"
    );

    setDisabled(
      "btnPublishServiceJob",
      !hasJob ||
      status !== "approved"
    );

    setDisabled(
      "btnCancelServiceJob",
      !hasJob ||
      [
        "completed",
        "cancelled"
      ].includes(status)
    );

    if (status === "draft") {
      setText(
        "serviceWorkflowTitle",
        "Draft Service Job"
      );

      setText(
        "serviceWorkflowText",
        "Save the job and calculate the route before generating a quotation."
      );

      return;
    }

    if (status === "quoted") {
      setText(
        "serviceWorkflowTitle",
        "Quotation Prepared"
      );

      setText(
        "serviceWorkflowText",
        "Review the quotation and approve it when the customer confirms."
      );

      return;
    }

    if (status === "approved") {
      setText(
        "serviceWorkflowTitle",
        "Quotation Approved"
      );

      setText(
        "serviceWorkflowText",
        "Publish the approved job to Operations when it is ready for planning."
      );

      return;
    }

    if (status === "published") {
      setText(
        "serviceWorkflowTitle",
        "Published to Operations"
      );

      setText(
        "serviceWorkflowText",
        "The service job has been released to the Operations Control Centre."
      );

      return;
    }

    if (status === "cancelled") {
      setText(
        "serviceWorkflowTitle",
        "Service Job Cancelled"
      );

      setText(
        "serviceWorkflowText",
        "This service job is no longer active."
      );
    }
  }

  /* =========================================================
   * STOPS
   * ========================================================= */

  function normalizeStopSequences() {
    currentStops
      .sort(
        (a, b) =>
          toNumber(
            a.stop_sequence,
            0
          ) -
          toNumber(
            b.stop_sequence,
            0
          )
      )
      .forEach(
        (stop, index) => {
          stop.stop_sequence =
            index + 1;
        }
      );
  }

  function renderStops() {
    const container =
      $("serviceStopList");

    if (!container) {
      return;
    }

    normalizeStopSequences();

    setText(
      "serviceStopCount",
      `${currentStops.length} stop${
        currentStops.length === 1
          ? ""
          : "s"
      }`
    );

    if (!currentStops.length) {
      container.innerHTML = `
        <div class="service-stop-empty">
          No stops added yet. Add the warehouse, collection and delivery locations required for this service job.
        </div>
      `;

      return;
    }

    container.innerHTML =
      currentStops
        .map(
          (stop, index) => {
            const type =
              normalize(
                stop.stop_type ||
                "service"
              );

            const address = [
              stop.address_1,
              stop.address_2,
              stop.city,
              stop.postcode
            ]
              .map(clean)
              .filter(Boolean)
              .join(", ");

            return `
              <article class="service-stop-row">
                <div class="service-stop-sequence">
                  ${index + 1}
                </div>

                <span class="service-stop-type ${escapeHtml(type)}">
                  ${escapeHtml(
                    titleCase(type)
                  )}
                </span>

                <div class="service-stop-copy">
                  <strong>
                    ${escapeHtml(
                      stop.stop_name ||
                      "Service Stop"
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      address ||
                      "Address pending"
                    )}
                  </span>
                </div>

                <div class="service-stop-duration">
                  ${formatNumber(
                    stop.service_minutes,
                    0
                  )} min
                </div>

                <div class="service-stop-actions">
                  <button
                    class="service-icon-btn"
                    type="button"
                    data-stop-up="${escapeHtml(stop.local_id)}"
                    title="Move up"
                  >
                    ↑
                  </button>

                  <button
                    class="service-icon-btn"
                    type="button"
                    data-stop-down="${escapeHtml(stop.local_id)}"
                    title="Move down"
                  >
                    ↓
                  </button>

                  <button
                    class="service-icon-btn"
                    type="button"
                    data-edit-stop="${escapeHtml(stop.local_id)}"
                    title="Edit stop"
                  >
                    ✎
                  </button>

                  <button
                    class="service-icon-btn danger"
                    type="button"
                    data-delete-stop="${escapeHtml(stop.local_id)}"
                    title="Delete stop"
                  >
                    ×
                  </button>
                </div>
              </article>
            `;
          }
        )
        .join("");

    bindStopRowEvents();
  }

  function bindStopRowEvents() {
    document
      .querySelectorAll(
        "[data-edit-stop]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            openStopModal(
              button.dataset
                .editStop
            );
          }
        );
      });

    document
      .querySelectorAll(
        "[data-delete-stop]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            deleteStop(
              button.dataset
                .deleteStop
            );
          }
        );
      });

    document
      .querySelectorAll(
        "[data-stop-up]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            moveStop(
              button.dataset.stopUp,
              -1
            );
          }
        );
      });

    document
      .querySelectorAll(
        "[data-stop-down]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            moveStop(
              button.dataset.stopDown,
              1
            );
          }
        );
      });
  }

  function openStopModal(
    localId = null
  ) {
    const modal =
      $("serviceStopModal");

    if (!modal) {
      return;
    }

    const stop =
      localId
        ? currentStops.find(row =>
            String(row.local_id) ===
            String(localId)
          )
        : null;

    setText(
      "serviceStopModalTitle",
      stop
        ? "Edit Service Stop"
        : "Add Service Stop"
    );

    setValue(
      "serviceStopEditId",
      stop?.local_id ||
      ""
    );

    setValue(
      "serviceStopType",
      stop?.stop_type ||
      "deliver"
    );

    setValue(
      "serviceStopMinutes",
      stop?.service_minutes ??
      internalSettings
        .stop_time_minutes
    );

    setValue(
      "serviceStopSequence",
      stop?.stop_sequence ||
      currentStops.length + 1
    );

    setValue(
      "serviceStopName",
      stop?.stop_name || ""
    );

    setValue(
      "serviceStopContact",
      stop?.contact_name ||
      ""
    );

    setValue(
      "serviceStopAddress1",
      stop?.address_1 || ""
    );

    setValue(
      "serviceStopAddress2",
      stop?.address_2 || ""
    );

    setValue(
      "serviceStopCity",
      stop?.city || ""
    );

    setValue(
      "serviceStopPostcode",
      stop?.postcode || ""
    );

    setValue(
      "serviceStopLatitude",
      stop?.latitude ?? ""
    );

    setValue(
      "serviceStopLongitude",
      stop?.longitude ?? ""
    );

    setValue(
      "serviceStopItems",
      stop?.items_description ||
      ""
    );

    setValue(
      "serviceStopInstructions",
      stop?.driver_instructions ||
      ""
    );

    setCheckbox(
      "serviceStopIncludeInRoute",
      stop?.include_in_route !==
        false
    );

    modal.classList.add(
      "open"
    );

    modal.setAttribute(
      "aria-hidden",
      "false"
    );
  }

  function closeStopModal() {
    const modal =
      $("serviceStopModal");

    if (!modal) {
      return;
    }

    modal.classList.remove(
      "open"
    );

    modal.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  async function geocodePostcode(
    postcode
  ) {
    const cleaned =
      clean(postcode)
        .toUpperCase();

    if (!cleaned) {
      return null;
    }

    const response =
      await fetch(
        `${POSTCODES_IO_BASE_URL}/${encodeURIComponent(cleaned)}`
      );

    if (!response.ok) {
      return null;
    }

    const json =
      await response.json();

    if (
      json.status !== 200 ||
      !json.result
    ) {
      return null;
    }

    return {
      latitude:
        Number(
          json.result.latitude
        ),

      longitude:
        Number(
          json.result.longitude
        ),

      postcode:
        json.result.postcode ||
        cleaned,

      city:
        json.result.admin_district ||
        json.result.parish ||
        ""
    };
  }

  async function saveStopFromModal() {
    try {
      setBusy(
        "btnSaveServiceStop",
        true,
        "Saving..."
      );

      const editId =
        getValue(
          "serviceStopEditId"
        );

      let latitude =
        toNumber(
          getValue(
            "serviceStopLatitude"
          ),
          null
        );

      let longitude =
        toNumber(
          getValue(
            "serviceStopLongitude"
          ),
          null
        );

      const postcode =
        clean(
          getValue(
            "serviceStopPostcode"
          )
        ).toUpperCase();

      if (
        (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) &&
        postcode
      ) {
        const geo =
          await geocodePostcode(
            postcode
          );

        if (geo) {
          latitude =
            geo.latitude;

          longitude =
            geo.longitude;

          setValue(
            "serviceStopLatitude",
            latitude
          );

          setValue(
            "serviceStopLongitude",
            longitude
          );

          if (
            !getValue(
              "serviceStopCity"
            )
          ) {
            setValue(
              "serviceStopCity",
              geo.city
            );
          }
        }
      }

      const stop = {
        local_id:
          editId ||
          makeTemporaryId(
            "stop"
          ),

        id:
          isUuid(editId)
            ? editId
            : null,

        stop_type:
          getValue(
            "serviceStopType"
          ) ||
          "deliver",

        stop_sequence:
          Math.max(
            1,
            toNumber(
              getValue(
                "serviceStopSequence"
              ),
              currentStops.length + 1
            )
          ),

        stop_name:
          clean(
            getValue(
              "serviceStopName"
            )
          ) ||
          "Service Stop",

        contact_name:
          clean(
            getValue(
              "serviceStopContact"
            )
          ),

        address_1:
          clean(
            getValue(
              "serviceStopAddress1"
            )
          ),

        address_2:
          clean(
            getValue(
              "serviceStopAddress2"
            )
          ),

        city:
          clean(
            getValue(
              "serviceStopCity"
            )
          ),

        postcode,

        country:
          "United Kingdom",

        latitude:
          Number.isFinite(latitude)
            ? latitude
            : null,

        longitude:
          Number.isFinite(longitude)
            ? longitude
            : null,

        service_minutes:
          Math.max(
            0,
            toNumber(
              getValue(
                "serviceStopMinutes"
              ),
              15
            )
          ),

        items_description:
          getValue(
            "serviceStopItems"
          ),

        driver_instructions:
          getValue(
            "serviceStopInstructions"
          ),

        include_in_route:
          getCheckbox(
            "serviceStopIncludeInRoute"
          )
      };

      if (editId) {
        const index =
          currentStops.findIndex(
            row =>
              String(
                row.local_id
              ) ===
              String(editId)
          );

        if (index >= 0) {
          currentStops[index] = {
            ...currentStops[index],
            ...stop
          };
        }
      } else {
        currentStops.push(stop);
      }

      normalizeStopSequences();

      calculationResult = null;

      closeStopModal();

      renderStops();
      renderCalculation();
      updateWorkflowButtons();
      updateMap();

      showNotice(
        "Service stop saved."
      );
    } catch (error) {
      console.error(error);

      showNotice(
        error.message ||
        "Could not save service stop.",
        "err"
      );
    } finally {
      setBusy(
        "btnSaveServiceStop",
        false
      );
    }
  }

  function deleteStop(localId) {
    const stop =
      currentStops.find(row =>
        String(row.local_id) ===
        String(localId)
      );

    if (!stop) {
      return;
    }

    const confirmed =
      window.confirm(
        `Remove "${stop.stop_name || "this stop"}" from the service job?`
      );

    if (!confirmed) {
      return;
    }

    currentStops =
      currentStops.filter(row =>
        String(row.local_id) !==
        String(localId)
      );

    normalizeStopSequences();

    calculationResult = null;

    renderStops();
    renderCalculation();
    updateWorkflowButtons();
    updateMap();
  }

  function moveStop(
    localId,
    direction
  ) {
    const index =
      currentStops.findIndex(row =>
        String(row.local_id) ===
        String(localId)
      );

    if (index < 0) {
      return;
    }

    const targetIndex =
      index + direction;

    if (
      targetIndex < 0 ||
      targetIndex >=
        currentStops.length
    ) {
      return;
    }

    const copy =
      [...currentStops];

    [
      copy[index],
      copy[targetIndex]
    ] = [
      copy[targetIndex],
      copy[index]
    ];

    currentStops = copy;

    currentStops.forEach(
      (stop, stopIndex) => {
        stop.stop_sequence =
          stopIndex + 1;
      }
    );

    calculationResult = null;

    renderStops();
    renderCalculation();
    updateWorkflowButtons();
    updateMap();
  }

  /* =========================================================
   * ADDITIONAL CHARGES
   * ========================================================= */

  function renderCharges() {
    const container =
      $("serviceChargeList");

    if (!container) {
      return;
    }

    if (!currentCharges.length) {
      currentCharges = [
        {
          local_id:
            makeTemporaryId(
              "charge"
            ),

          description:
            "Additional charge",

          amount_gbp: 0,

          internal_cost_gbp: 0,

          charge_type:
            "additional"
        }
      ];
    }

    container.innerHTML =
      currentCharges
        .map(charge => `
          <div
            class="service-charge-row"
            data-charge-row="${escapeHtml(charge.local_id)}"
          >
            <input
              class="service-input"
              type="text"
              value="${escapeHtml(charge.description || "")}"
              data-charge-description="${escapeHtml(charge.local_id)}"
            />

            <input
              class="service-input"
              type="number"
              min="0"
              step="0.01"
              value="${escapeHtml(
                toNumber(
                  charge.amount_gbp,
                  0
                ).toFixed(2)
              )}"
              data-charge-amount="${escapeHtml(charge.local_id)}"
            />

            <button
              class="service-icon-btn danger"
              type="button"
              data-remove-charge="${escapeHtml(charge.local_id)}"
              title="Remove charge"
            >
              ×
            </button>
          </div>
        `)
        .join("");

    bindChargeEvents();
  }

  function bindChargeEvents() {
    document
      .querySelectorAll(
        "[data-charge-description]"
      )
      .forEach(input => {
        input.addEventListener(
          "input",
          () => {
            updateChargeField(
              input.dataset
                .chargeDescription,
              "description",
              input.value
            );
          }
        );
      });

    document
      .querySelectorAll(
        "[data-charge-amount]"
      )
      .forEach(input => {
        input.addEventListener(
          "input",
          () => {
            updateChargeField(
              input.dataset
                .chargeAmount,
              "amount_gbp",
              toNumber(
                input.value,
                0
              )
            );

            calculationResult = null;

            renderCalculation();
            updateWorkflowButtons();
          }
        );
      });

    document
      .querySelectorAll(
        "[data-remove-charge]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            currentCharges =
              currentCharges.filter(row =>
                String(
                  row.local_id
                ) !==
                String(
                  button.dataset
                    .removeCharge
                )
              );

            renderCharges();

            calculationResult = null;

            renderCalculation();
            updateWorkflowButtons();
          }
        );
      });
  }

  function updateChargeField(
    localId,
    field,
    value
  ) {
    const row =
      currentCharges.find(charge =>
        String(
          charge.local_id
        ) ===
        String(localId)
      );

    if (row) {
      row[field] = value;
    }
  }

  function addChargeLine() {
    currentCharges.push({
      local_id:
        makeTemporaryId(
          "charge"
        ),

      description:
        "Additional charge",

      amount_gbp: 0,

      internal_cost_gbp: 0,

      charge_type:
        "additional"
    });

    renderCharges();
  }

  function getAdditionalChargeTotal() {
    return currentCharges.reduce(
      (sum, charge) =>
        sum +
        toNumber(
          charge.amount_gbp,
          0
        ),
      0
    );
  }

  function getAdditionalInternalCost() {
    return currentCharges.reduce(
      (sum, charge) =>
        sum +
        toNumber(
          charge.internal_cost_gbp,
          0
        ),
      0
    );
  }

  /* =========================================================
   * ROUTE CALCULATION
   * ========================================================= */

  function hasDepotCoordinates() {
    return (
      Number.isFinite(
        Number(
          internalSettings.depot_lat
        )
      ) &&
      Number.isFinite(
        Number(
          internalSettings.depot_lng
        )
      )
    );
  }

  function getRouteStops() {
    return currentStops
      .filter(stop =>
        stop.include_in_route !==
        false
      )
      .filter(stop =>
        Number.isFinite(
          Number(stop.latitude)
        ) &&
        Number.isFinite(
          Number(stop.longitude)
        )
      )
      .map(stop => ({
        ...stop,

        latitude:
          Number(stop.latitude),

        longitude:
          Number(stop.longitude)
      }));
  }

  function haversineKm(
    lat1,
    lng1,
    lat2,
    lng2
  ) {
    const earthRadiusKm = 6371;

    const toRadians =
      degrees =>
        degrees *
        Math.PI /
        180;

    const deltaLat =
      toRadians(
        lat2 - lat1
      );

    const deltaLng =
      toRadians(
        lng2 - lng1
      );

    const a =
      Math.sin(
        deltaLat / 2
      ) ** 2 +
      Math.cos(
        toRadians(lat1)
      ) *
      Math.cos(
        toRadians(lat2)
      ) *
      Math.sin(
        deltaLng / 2
      ) ** 2;

    return (
      earthRadiusKm *
      (
        2 *
        Math.atan2(
          Math.sqrt(a),
          Math.sqrt(1 - a)
        )
      )
    );
  }

  function nearestNeighbour(stops) {
    if (
      !hasDepotCoordinates()
    ) {
      return [...stops];
    }

    const remaining =
      [...stops];

    const ordered = [];

    let currentPoint = {
      latitude:
        Number(
          internalSettings.depot_lat
        ),

      longitude:
        Number(
          internalSettings.depot_lng
        )
    };

    while (remaining.length) {
      let bestIndex = 0;
      let bestDistance =
        Infinity;

      remaining.forEach(
        (stop, index) => {
          const distance =
            haversineKm(
              currentPoint.latitude,
              currentPoint.longitude,
              stop.latitude,
              stop.longitude
            );

          if (
            distance <
            bestDistance
          ) {
            bestDistance =
              distance;

            bestIndex =
              index;
          }
        }
      );

      const nextStop =
        remaining.splice(
          bestIndex,
          1
        )[0];

      ordered.push(
        nextStop
      );

      currentPoint =
        nextStop;
    }

    return ordered;
  }

  async function fetchOsrmRoute(
    stops,
    includeReturn
  ) {
    if (
      !hasDepotCoordinates() ||
      !stops.length
    ) {
      return null;
    }

    const depot = {
      latitude:
        Number(
          internalSettings.depot_lat
        ),

      longitude:
        Number(
          internalSettings.depot_lng
        )
    };

    const points = [
      depot,
      ...stops
    ];

    if (includeReturn) {
      points.push(depot);
    }

    const coordinates =
      points
        .map(point =>
          `${Number(point.longitude)},${Number(point.latitude)}`
        )
        .join(";");

    const url =
      `${OSRM_BASE_URL}/route/v1/driving/${coordinates}` +
      "?overview=false&steps=false";

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Route calculation failed (${response.status}).`
      );
    }

    const json =
      await response.json();

    if (
      json.code !== "Ok" ||
      !json.routes?.length
    ) {
      throw new Error(
        `Route calculation failed: ${json.code || "unknown error"}.`
      );
    }

    const route =
      json.routes[0];

    return {
      distanceKm:
        route.distance /
        1000,

      distanceMiles:
        route.distance /
        1000 *
        0.621371,

      driveHours:
        route.duration /
        3600
    };
  }

  function calculateFallbackRoute(
    stops,
    includeReturn,
    vehicle
  ) {
    if (!stops.length) {
      return {
        distanceKm: 0,
        distanceMiles: 0,
        driveHours: 0
      };
    }

    const speed =
      Math.max(
        1,
        toNumber(
          vehicle?.average_speed_kmh,
          internalSettings
            .average_speed_kmh
        )
      );

    const depot = {
      latitude:
        Number(
          internalSettings.depot_lat
        ),

      longitude:
        Number(
          internalSettings.depot_lng
        )
    };

    let distanceKm = 0;
    let currentPoint =
      depot;

    stops.forEach(stop => {
      const directDistance =
        haversineKm(
          currentPoint.latitude,
          currentPoint.longitude,
          stop.latitude,
          stop.longitude
        );

      distanceKm +=
        directDistance *
        toNumber(
          internalSettings.distance_factor,
          1.25
        );

      currentPoint =
        stop;
    });

    if (
      includeReturn &&
      hasDepotCoordinates()
    ) {
      const returnDistance =
        haversineKm(
          currentPoint.latitude,
          currentPoint.longitude,
          depot.latitude,
          depot.longitude
        );

      distanceKm +=
        returnDistance *
        toNumber(
          internalSettings.distance_factor,
          1.25
        );
    }

    return {
      distanceKm,

      distanceMiles:
        distanceKm *
        0.621371,

      driveHours:
        distanceKm /
        speed
    };
  }

  function chooseVehicleForPreview() {
    const selectedId =
      getValue(
        "serviceVehicle"
      );

    if (selectedId) {
      return (
        vehicles.find(vehicle =>
          String(vehicle.id) ===
          String(selectedId)
        ) ||
        null
      );
    }

    return (
      vehicles[0] ||
      null
    );
  }

  function roundBillableHours(
    hours,
    roundingMinutes,
    minimumHours
  ) {
    const minutes =
      Math.max(
        0,
        toNumber(hours, 0) *
        60
      );

    const rounding =
      Math.max(
        1,
        toNumber(
          roundingMinutes,
          15
        )
      );

    const roundedMinutes =
      Math.ceil(
        minutes /
        rounding
      ) *
      rounding;

    return Math.max(
      roundedMinutes / 60,
      toNumber(
        minimumHours,
        0
      )
    );
  }

  function countStopTypes(type) {
    return currentStops.filter(stop =>
      normalize(
        stop.stop_type
      ) ===
      normalize(type)
    ).length;
  }

  async function calculateRouteAndQuote() {
    try {
      setBusy(
        "btnCalculateServiceQuote",
        true,
        "Calculating..."
      );

      const owner =
        getSelectedOwner();

      if (!owner) {
        throw new Error(
          "Select a Product Owner first."
        );
      }

      const rates =
        getRatesForOwner(
          owner.key
        );

      if (!rates.enabled) {
        throw new Error(
          `Service Job rates are not enabled for ${owner.name}.`
        );
      }

      if (!hasDepotCoordinates()) {
        throw new Error(
          "Home depot coordinates are missing in Settings."
        );
      }

      const routeStops =
        getRouteStops();

      if (!routeStops.length) {
        throw new Error(
          "Add at least one stop with valid latitude and longitude."
        );
      }

      const includeReturn =
        getCheckbox(
          "serviceIncludeReturnDepot"
        );

      const optimise =
        getCheckbox(
          "serviceOptimiseStopOrder"
        );

      const crewSize =
        Math.max(
          1,
          toNumber(
            getValue(
              "serviceCrewSize"
            ),
            1
          )
        );

      const vehicle =
        chooseVehicleForPreview();

      const orderedStops =
        optimise
          ? nearestNeighbour(
              routeStops
            )
          : [...routeStops];

      let routeSummary;

      try {
        routeSummary =
          await fetchOsrmRoute(
            orderedStops,
            includeReturn
          );
      } catch (error) {
        console.warn(
          "OSRM failed; using fallback route calculation:",
          error.message
        );

        routeSummary =
          calculateFallbackRoute(
            orderedStops,
            includeReturn,
            vehicle
          );
      }

      const serviceHours =
        orderedStops.reduce(
          (sum, stop) =>
            sum +
            toNumber(
              stop.service_minutes,
              internalSettings
                .stop_time_minutes
            ) /
            60,
          0
        );

      const driveHours =
        toNumber(
          routeSummary.driveHours,
          0
        );

      const totalHours =
        driveHours +
        serviceHours;

      const billableHours =
        roundBillableHours(
          totalHours,
          rates.labour_rounding_minutes,
          rates.minimum_billable_hours
        );

      const distanceKm =
        toNumber(
          routeSummary.distanceKm,
          0
        );

      const distanceMiles =
        toNumber(
          routeSummary.distanceMiles,
          0
        );

      const additionalCharge =
        getAdditionalChargeTotal();

      const customerLabour =
        billableHours *
        rates.labour_rate_gbp;

      const customerMileage =
        distanceMiles *
        rates.mileage_rate_gbp;

      const customerSecondPerson =
        crewSize > 1
          ? billableHours *
            rates.second_person_rate_gbp *
            (crewSize - 1)
          : 0;

      const customerWaiting = 0;

      const calloutCharge =
        rates.callout_charge_gbp;

      const stopCharge =
        orderedStops.length *
        rates.per_stop_charge_gbp;

      const installationCharge =
        countStopTypes(
          "installation"
        ) *
        rates.installation_charge_gbp;

      const customerAdditional =
        additionalCharge +
        calloutCharge +
        stopCharge +
        installationCharge;

      const calculatedCustomerTotal =
        customerLabour +
        customerMileage +
        customerSecondPerson +
        customerWaiting +
        customerAdditional;

      const customerTotal =
        Math.max(
          calculatedCustomerTotal,
          rates.minimum_charge_gbp
        );

      const labourCostRate =
        toNumber(
          vehicle?.labour_cost_per_hour_gbp,
          internalSettings
            .labour_cost_per_hour_gbp
        );

      const vehicleCostRate =
        toNumber(
          vehicle?.vehicle_cost_per_hour_gbp,
          internalSettings
            .vehicle_cost_per_hour_gbp
        );

      const internalLabour =
        totalHours *
        labourCostRate *
        crewSize;

      const internalVehicle =
        totalHours *
        vehicleCostRate;

      const fuelUsage =
        toNumber(
          vehicle?.fuel_litres_per_100km,
          10
        );

      const fuelLitres =
        distanceKm /
        100 *
        fuelUsage;

      const fuelPriceExVat =
        toNumber(
          internalSettings
            .diesel_price_per_litre_gbp_inc_vat,
          1.55
        ) /
        1.2;

      const internalFuel =
        fuelLitres *
        fuelPriceExVat;

      const internalAdditional =
        getAdditionalInternalCost();

      const internalTotal =
        internalLabour +
        internalVehicle +
        internalFuel +
        internalAdditional;

      const margin =
        customerTotal -
        internalTotal;

      const marginPct =
        customerTotal > 0
          ? margin /
            customerTotal *
            100
          : 0;

      calculationResult = {
        distanceKm,
        distanceMiles,

        driveHours,
        serviceHours,
        totalHours,
        billableHours,

        customerLabour:
          roundMoney(
            customerLabour
          ),

        customerMileage:
          roundMoney(
            customerMileage
          ),

        customerSecondPerson:
          roundMoney(
            customerSecondPerson
          ),

        customerWaiting:
          roundMoney(
            customerWaiting
          ),

        customerAdditional:
          roundMoney(
            customerAdditional
          ),

        customerTotal:
          roundMoney(
            customerTotal
          ),

        internalLabour:
          roundMoney(
            internalLabour
          ),

        internalVehicle:
          roundMoney(
            internalVehicle
          ),

        internalFuel:
          roundMoney(
            internalFuel
          ),

        internalAdditional:
          roundMoney(
            internalAdditional
          ),

        internalTotal:
          roundMoney(
            internalTotal
          ),

        margin:
          roundMoney(
            margin
          ),

        marginPct:
          Number(
            marginPct.toFixed(2)
          ),

        fuelLitres:
          roundMoney(
            fuelLitres
          ),

        vehicle,
        orderedStops
      };

      applyOrderedStops(
        orderedStops
      );

      renderStops();
      renderCalculation();
      updateWorkflowButtons();
      updateMap();

      showNotice(
        "Route and quotation calculated."
      );
    } catch (error) {
      console.error(error);

      showNotice(
        error.message ||
        "Could not calculate route and quotation.",
        "err"
      );
    } finally {
      setBusy(
        "btnCalculateServiceQuote",
        false
      );
    }
  }

  function applyOrderedStops(
    orderedStops
  ) {
    const orderedIds =
      orderedStops.map(stop =>
        String(stop.local_id)
      );

    currentStops.sort(
      (a, b) => {
        const indexA =
          orderedIds.indexOf(
            String(a.local_id)
          );

        const indexB =
          orderedIds.indexOf(
            String(b.local_id)
          );

        if (
          indexA === -1 &&
          indexB === -1
        ) {
          return (
            toNumber(
              a.stop_sequence,
              0
            ) -
            toNumber(
              b.stop_sequence,
              0
            )
          );
        }

        if (indexA === -1) {
          return 1;
        }

        if (indexB === -1) {
          return -1;
        }

        return (
          indexA -
          indexB
        );
      }
    );

    currentStops.forEach(
      (stop, index) => {
        stop.stop_sequence =
          index + 1;
      }
    );
  }

  function optimiseStopsOnly() {
    const stops =
      getRouteStops();

    if (!stops.length) {
      showNotice(
        "Add stops with valid coordinates first.",
        "err"
      );

      return;
    }

    const ordered =
      nearestNeighbour(
        stops
      );

    applyOrderedStops(
      ordered
    );

    calculationResult = null;

    renderStops();
    renderCalculation();
    updateWorkflowButtons();
    updateMap();

    showNotice(
      "Stop order optimised. Recalculate the quotation to update costs."
    );
  }

  /* =========================================================
   * CALCULATION RENDERING
   * ========================================================= */

  function renderCalculation() {
    const result =
      calculationResult;

    if (!result) {
      setText(
        "serviceCalculationStatus",
        "Not calculated"
      );

      setText(
        "summaryDistance",
        "0.0 mi"
      );

      setText(
        "summaryDriveHours",
        "0.00 h"
      );

      setText(
        "summaryServiceHours",
        "0.00 h"
      );

      setText(
        "summaryTotalHours",
        "0.00 h"
      );

      [
        "quoteLabourAmount",
        "quoteMileageAmount",
        "quoteSecondPersonAmount",
        "quoteWaitingAmount",
        "quoteAdditionalAmount",
        "quoteTotalAmount",
        "costLabourAmount",
        "costVehicleAmount",
        "costFuelAmount",
        "costAdditionalAmount",
        "costTotalAmount",
        "marginRevenueAmount",
        "marginAmount"
      ].forEach(id =>
        setText(
          id,
          "£0.00"
        )
      );

      setText(
        "marginPercentage",
        "0.0%"
      );

      return;
    }

    setText(
      "serviceCalculationStatus",
      "Calculated"
    );

    setText(
      "summaryDistance",
      `${formatNumber(
        result.distanceMiles,
        1
      )} mi`
    );

    setText(
      "summaryDriveHours",
      `${formatNumber(
        result.driveHours,
        2
      )} h`
    );

    setText(
      "summaryServiceHours",
      `${formatNumber(
        result.serviceHours,
        2
      )} h`
    );

    setText(
      "summaryTotalHours",
      `${formatNumber(
        result.totalHours,
        2
      )} h`
    );

    setText(
      "quoteLabourAmount",
      formatMoney(
        result.customerLabour
      )
    );

    setText(
      "quoteMileageAmount",
      formatMoney(
        result.customerMileage
      )
    );

    setText(
      "quoteSecondPersonAmount",
      formatMoney(
        result.customerSecondPerson
      )
    );

    setText(
      "quoteWaitingAmount",
      formatMoney(
        result.customerWaiting
      )
    );

    setText(
      "quoteAdditionalAmount",
      formatMoney(
        result.customerAdditional
      )
    );

    setText(
      "quoteTotalAmount",
      formatMoney(
        result.customerTotal
      )
    );

    setText(
      "costLabourAmount",
      formatMoney(
        result.internalLabour
      )
    );

    setText(
      "costVehicleAmount",
      formatMoney(
        result.internalVehicle
      )
    );

    setText(
      "costFuelAmount",
      formatMoney(
        result.internalFuel
      )
    );

    setText(
      "costAdditionalAmount",
      formatMoney(
        result.internalAdditional
      )
    );

    setText(
      "costTotalAmount",
      formatMoney(
        result.internalTotal
      )
    );

    setText(
      "marginRevenueAmount",
      formatMoney(
        result.customerTotal
      )
    );

    setText(
      "marginAmount",
      formatMoney(
        result.margin
      )
    );

    setText(
      "marginPercentage",
      `${formatNumber(
        result.marginPct,
        1
      )}%`
    );
  }

  /* =========================================================
   * MAP
   * ========================================================= */

  function updateMap() {
    window.ordersMapMode =
      "service_job_preview";

    const owner =
      getSelectedOwner();

    window.ordersMapRows =
      currentStops
        .filter(stop =>
          Number.isFinite(
            Number(stop.latitude)
          ) &&
          Number.isFinite(
            Number(stop.longitude)
          )
        )
        .map(
          (stop, index) => ({
            id:
              stop.local_id,

            order_number:
              currentJob
                ?.service_job_number ||
              "SERVICE JOB",

            external_reference:
              currentJob
                ?.quote_number ||
              "",

            retailer_name:
              stop.stop_name ||
              `Stop ${index + 1}`,

            product_owner_name:
              owner?.name ||
              currentJob
                ?.product_owner_name ||
              "Service Job",

            delivery_address_1:
              stop.address_1 ||
              "",

            delivery_address_2:
              stop.address_2 ||
              "",

            delivery_city:
              stop.city ||
              "",

            delivery_postcode:
              stop.postcode ||
              "",

            delivery_lat:
              Number(
                stop.latitude
              ),

            delivery_lng:
              Number(
                stop.longitude
              ),

            status:
              "service_job_preview",

            transport_type:
              "service_job",

            planning_colli:
              toNumber(
                stop.planned_colli,
                0
              ),

            planning_volume_m3:
              toNumber(
                stop.planned_volume_m3,
                0
              ),

            service_stop_type:
              stop.stop_type,

            service_minutes:
              stop.service_minutes,

            total_customer_charge:
              calculationResult
                ?.customerTotal ||
              0
          })
        );

    const routeStops =
      (
        calculationResult
          ?.orderedStops ||
        getRouteStops()
      )
        .filter(stop =>
          Number.isFinite(
            Number(stop.latitude)
          ) &&
          Number.isFinite(
            Number(stop.longitude)
          )
        )
        .map(
          (stop, index) => ({
            id:
              stop.local_id,

            route_id:
              PREVIEW_ROUTE_ID,

            order_id:
              stop.local_id,

            stop_sequence:
              index + 1,

            stop_number:
              index + 1,

            stop_name:
              stop.stop_name ||
              `Stop ${index + 1}`,

            city:
              stop.city || "",

            postcode:
              stop.postcode ||
              "",

            latitude:
              Number(
                stop.latitude
              ),

            longitude:
              Number(
                stop.longitude
              ),

            service_minutes:
              stop.service_minutes ||
              0
          })
        );

    window.allRouteStopsMapRows =
      routeStops;

    window.selectedRouteIdForMap =
      routeStops.length
        ? PREVIEW_ROUTE_ID
        : null;

    window.selectedOrderIdsForMap =
      [];

    window.orderMapFilters = {
      ownTransportOnly: false,
      charterOnly: false,
      warehousePickupOnly: false
    };

    window.OrdersMap
      ?.reload?.();
  }

  function fitServiceMap() {
    if (
      window.OrdersMap
        ?.fitToVisible
    ) {
      window.OrdersMap
        .fitToVisible();

      return;
    }

    window.OrdersMap
      ?.fitUk?.();
  }

  /* =========================================================
   * SAVE DATABASE RECORDS
   * ========================================================= */

  function collectJobForm() {
    const owner =
      getSelectedOwner();

    if (!owner) {
      throw new Error(
        "Select a Product Owner."
      );
    }

    const rates =
      getRatesForOwner(
        owner.key
      );

    const payload = {
      company_id:
        companyId,

      product_owner_key:
        owner.key,

      product_owner_name:
        owner.name,

      job_type:
        getValue(
          "serviceJobType"
        ) ||
        "custom",

      requested_date:
        getValue(
          "serviceRequestedDate"
        ) ||
        null,

      customer_reference:
        clean(
          getValue(
            "serviceCustomerReference"
          )
        ) ||
        null,

      contact_name:
        clean(
          getValue(
            "serviceContactName"
          )
        ) ||
        null,

      contact_phone:
        clean(
          getValue(
            "serviceContactPhone"
          )
        ) ||
        null,

      description:
        clean(
          getValue(
            "serviceJobDescription"
          )
        ) ||
        null,

      internal_notes:
        clean(
          getValue(
            "serviceInternalNotes"
          )
        ) ||
        null,

      planning_date:
        getValue(
          "servicePlanningDate"
        ) ||
        null,

      planned_start_time:
        getValue(
          "serviceStartTime"
        ) ||
        "08:00",

      crew_size:
        Math.max(
          1,
          toNumber(
            getValue(
              "serviceCrewSize"
            ),
            1
          )
        ),

      preferred_vehicle_id:
        getValue(
          "serviceVehicle"
        ) ||
        null,

      preferred_driver_id:
        getValue(
          "serviceDriver"
        ) ||
        null,

      include_return_to_depot:
        getCheckbox(
          "serviceIncludeReturnDepot"
        ),

      optimise_stop_order:
        getCheckbox(
          "serviceOptimiseStopOrder"
        ),

      quote_validity_days:
        toNumber(
          getValue(
            "serviceQuoteValidity"
          ),
          rates.quote_validity_days ||
          14
        ),

      quote_vat_rate_pct:
        rates.vat_rate_pct,

      status:
        currentJob?.status ||
        "draft",

      total_stops:
        currentStops.length,

      updated_at:
        nowIso()
    };

    if (calculationResult) {
      Object.assign(
        payload,
        {
          estimated_distance_km:
            roundMoney(
              calculationResult
                .distanceKm
            ),

          estimated_distance_miles:
            roundMoney(
              calculationResult
                .distanceMiles
            ),

          estimated_drive_hours:
            roundMoney(
              calculationResult
                .driveHours
            ),

          estimated_service_hours:
            roundMoney(
              calculationResult
                .serviceHours
            ),

          estimated_total_hours:
            roundMoney(
              calculationResult
                .totalHours
            ),

          quote_labour_gbp:
            calculationResult
              .customerLabour,

          quote_mileage_gbp:
            calculationResult
              .customerMileage,

          quote_second_person_gbp:
            calculationResult
              .customerSecondPerson,

          quote_waiting_gbp:
            calculationResult
              .customerWaiting,

          quote_additional_gbp:
            calculationResult
              .customerAdditional,

          quote_total_ex_vat_gbp:
            calculationResult
              .customerTotal,

          estimated_cost_labour_gbp:
            calculationResult
              .internalLabour,

          estimated_cost_vehicle_gbp:
            calculationResult
              .internalVehicle,

          estimated_cost_fuel_gbp:
            calculationResult
              .internalFuel,

          estimated_cost_additional_gbp:
            calculationResult
              .internalAdditional,

          estimated_cost_total_gbp:
            calculationResult
              .internalTotal,

          estimated_margin_gbp:
            calculationResult
              .margin,

          estimated_margin_pct:
            calculationResult
              .marginPct
        }
      );
    }

    return payload;
  }

  async function nextServiceJobNumber() {
    const cid =
      await getCompanyId();

    const {
      data,
      error
    } = await db()
      .from("service_jobs")
      .select(
        "service_job_number"
      )
      .eq("company_id", cid)
      .order(
        "created_at",
        {
          ascending: false
        }
      )
      .limit(100);

    if (error) {
      throw error;
    }

    const highest =
      (data || []).reduce(
        (max, row) => {
          const match =
            String(
              row.service_job_number ||
              ""
            ).match(
              /^SJ-(\d+)$/i
            );

          const value =
            match
              ? Number(match[1])
              : 0;

          return Math.max(
            max,
            value
          );
        },
        0
      );

    return `SJ-${String(
      highest + 1
    ).padStart(5, "0")}`;
  }

  async function saveServiceJob() {
    try {
      setBusy(
        "btnSaveServiceDraft",
        true,
        "Saving..."
      );

      const cid =
        await getCompanyId();

      const payload =
        collectJobForm();

      let savedJob;

      if (currentJob?.id) {
        const {
          data,
          error
        } = await db()
          .from("service_jobs")
          .update(payload)
          .eq("company_id", cid)
          .eq(
            "id",
            currentJob.id
          )
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        savedJob = data;
      } else {
        payload.service_job_number =
          await nextServiceJobNumber();

        payload.created_at =
          nowIso();

        const {
          data,
          error
        } = await db()
          .from("service_jobs")
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        savedJob = data;
      }

      await saveStops(
        savedJob.id
      );

      await saveCharges(
        savedJob.id
      );

      currentJob = {
        ...currentJob,
        ...savedJob
      };

      selectedJobId =
        savedJob.id;

      await loadServiceJobs();

      await loadJobDetails(
        savedJob.id
      );

      showNotice(
        `${savedJob.service_job_number} saved.`
      );

      return savedJob;
    } catch (error) {
      console.error(error);

      showNotice(
        error.message ||
        "Could not save service job.",
        "err"
      );

      throw error;
    } finally {
      setBusy(
        "btnSaveServiceDraft",
        false
      );
    }
  }

  async function saveStops(
    serviceJobId
  ) {
    const cid =
      await getCompanyId();

    const {
      error: deleteError
    } = await db()
      .from("service_job_stops")
      .delete()
      .eq("company_id", cid)
      .eq(
        "service_job_id",
        serviceJobId
      );

    if (deleteError) {
      throw deleteError;
    }

    if (!currentStops.length) {
      return;
    }

    const rows =
      currentStops.map(
        (stop, index) => ({
          company_id:
            cid,

          service_job_id:
            serviceJobId,

          stop_sequence:
            index + 1,

          stop_type:
            stop.stop_type ||
            "service",

          stop_name:
            stop.stop_name ||
            `Stop ${index + 1}`,

          contact_name:
            stop.contact_name ||
            null,

          address_1:
            stop.address_1 ||
            null,

          address_2:
            stop.address_2 ||
            null,

          city:
            stop.city ||
            null,

          postcode:
            stop.postcode ||
            null,

          country:
            stop.country ||
            "United Kingdom",

          latitude:
            Number.isFinite(
              Number(
                stop.latitude
              )
            )
              ? Number(
                  stop.latitude
                )
              : null,

          longitude:
            Number.isFinite(
              Number(
                stop.longitude
              )
            )
              ? Number(
                  stop.longitude
                )
              : null,

          service_minutes:
            Math.max(
              0,
              toNumber(
                stop.service_minutes,
                15
              )
            ),

          items_description:
            stop.items_description ||
            null,

          driver_instructions:
            stop.driver_instructions ||
            null,

          include_in_route:
            stop.include_in_route !==
            false,

          planned_volume_m3:
            Math.max(
              0,
              toNumber(
                stop.planned_volume_m3,
                0
              )
            ),

          planned_colli:
            Math.max(
              0,
              Math.round(
                toNumber(
                  stop.planned_colli,
                  0
                )
              )
            ),

          planned_weight_kg:
            Math.max(
              0,
              toNumber(
                stop.planned_weight_kg,
                0
              )
            ),

          stop_status:
            stop.stop_status ||
            "pending",

          created_at:
            nowIso(),

          updated_at:
            nowIso()
        })
      );

    const {
      error
    } = await db()
      .from("service_job_stops")
      .insert(rows);

    if (error) {
      throw error;
    }
  }

  async function saveCharges(
    serviceJobId
  ) {
    const cid =
      await getCompanyId();

    const {
      error: deleteError
    } = await db()
      .from(
        "service_job_charge_lines"
      )
      .delete()
      .eq("company_id", cid)
      .eq(
        "service_job_id",
        serviceJobId
      );

    if (deleteError) {
      throw deleteError;
    }

    const rows =
      currentCharges
        .filter(charge =>
          clean(
            charge.description
          ) ||
          toNumber(
            charge.amount_gbp,
            0
          ) !== 0
        )
        .map(
          (charge, index) => ({
            company_id:
              cid,

            service_job_id:
              serviceJobId,

            line_sequence:
              index + 1,

            description:
              clean(
                charge.description
              ) ||
              "Additional charge",

            amount_gbp:
              roundMoney(
                charge.amount_gbp
              ),

            internal_cost_gbp:
              roundMoney(
                charge.internal_cost_gbp
              ),

            charge_type:
              charge.charge_type ||
              "additional",

            customer_visible:
              charge.customer_visible !==
              false,

            taxable:
              charge.taxable !== false,

            created_at:
              nowIso(),

            updated_at:
              nowIso()
          })
        );

    if (!rows.length) {
      return;
    }

    const {
      error
    } = await db()
      .from(
        "service_job_charge_lines"
      )
      .insert(rows);

    if (error) {
      throw error;
    }
  }

  /* =========================================================
   * QUOTATION WORKFLOW
   * ========================================================= */

  function buildQuoteNumber(job) {
    const number =
      clean(
        job.service_job_number
      ).replace(
        /^SJ-/i,
        ""
      );

    return `Q-SJ-${number || Date.now()}`;
  }

  async function generateQuotation() {
    try {
      if (!calculationResult) {
        throw new Error(
          "Calculate the route and quotation first."
        );
      }

      const savedJob =
        await saveServiceJob();

      const quoteNumber =
        savedJob.quote_number ||
        buildQuoteNumber(
          savedJob
        );

      const {
        error
      } = await db()
        .from("service_jobs")
        .update({
          status:
            "quoted",

          quote_number:
            quoteNumber,

          quoted_at:
            nowIso(),

          updated_at:
            nowIso()
        })
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "id",
          savedJob.id
        );

      if (error) {
        throw error;
      }

      await loadServiceJobs();

      await loadJobDetails(
        savedJob.id
      );

      showNotice(
        `Quotation ${quoteNumber} prepared.`
      );
    } catch (error) {
      console.error(error);

      showNotice(
        error.message ||
        "Could not generate quotation.",
        "err"
      );
    }
  }

  async function approveQuotation() {
    try {
      if (!currentJob?.id) {
        throw new Error(
          "Save the service job first."
        );
      }

      if (
        normalize(
          currentJob.status
        ) !== "quoted"
      ) {
        throw new Error(
          "Only a quoted service job can be approved."
        );
      }

      const confirmed =
        window.confirm(
          "Approve this service-job quotation?"
        );

      if (!confirmed) {
        return;
      }

      const {
        error
      } = await db()
        .from("service_jobs")
        .update({
          status:
            "approved",

          approved_at:
            nowIso(),

          updated_at:
            nowIso()
        })
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "id",
          currentJob.id
        );

      if (error) {
        throw error;
      }

      await loadServiceJobs();

      await loadJobDetails(
        currentJob.id
      );

      showNotice(
        "Service-job quotation approved."
      );
    } catch (error) {
      console.error(error);

      showNotice(
        error.message ||
        "Could not approve quotation.",
        "err"
      );
    }
  }

  async function cancelServiceJob() {
    try {
      if (!currentJob?.id) {
        return;
      }

      const confirmed =
        window.confirm(
          `Cancel ${currentJob.service_job_number || "this service job"}?`
        );

      if (!confirmed) {
        return;
      }

      const {
        error
      } = await db()
        .from("service_jobs")
        .update({
          status:
            "cancelled",

          cancelled_at:
            nowIso(),

          updated_at:
            nowIso()
        })
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "id",
          currentJob.id
        );

      if (error) {
        throw error;
      }

      await loadServiceJobs();

      await loadJobDetails(
        currentJob.id
      );

      showNotice(
        "Service job cancelled."
      );
    } catch (error) {
      console.error(error);

      showNotice(
        error.message ||
        "Could not cancel service job.",
        "err"
      );
    }
  }

  async function publishToOperations() {
    try {
      if (!currentJob?.id) {
        throw new Error(
          "Save the service job first."
        );
      }

      if (
        normalize(
          currentJob.status
        ) !== "approved"
      ) {
        throw new Error(
          "The quotation must be approved before publishing."
        );
      }

      const confirmed =
        window.confirm(
          "Publish this approved service job to Operations?"
        );

      if (!confirmed) {
        return;
      }

      setBusy(
        "btnPublishServiceJob",
        true,
        "Publishing..."
      );

      const {
        data,
        error
      } = await db()
        .rpc(
          "publish_service_job_to_operations",
          {
            p_service_job_id:
              currentJob.id
          }
        );

      if (error) {
        throw new Error(
          `${error.message}. The Supabase function publish_service_job_to_operations still needs to be created.`
        );
      }

      const result =
        Array.isArray(data)
          ? data[0]
          : data;

      await loadServiceJobs();

      await loadJobDetails(
        currentJob.id
      );

      showNotice(
        result?.order_number
          ? `Published as ${result.order_number}.`
          : "Service job published to Operations."
      );
    } catch (error) {
      console.error(error);

      showNotice(
        error.message ||
        "Could not publish service job to Operations.",
        "err"
      );
    } finally {
      setBusy(
        "btnPublishServiceJob",
        false
      );
    }
  }

  /* =========================================================
   * EVENT BINDING
   * ========================================================= */

  function markCalculationDirty() {
    calculationResult = null;

    renderCalculation();
    updateWorkflowButtons();
  }

  function bindEvents() {
    $("btnNewServiceJob")
      ?.addEventListener(
        "click",
        newServiceJob
      );

    $("btnRefreshServiceJobs")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await refreshAll();

            showNotice(
              "Service jobs refreshed."
            );
          } catch (error) {
            console.error(error);

            showNotice(
              error.message ||
              "Refresh failed.",
              "err"
            );
          }
        }
      );

    [
      "serviceJobSearch",
      "filterServiceOwner",
      "filterServiceStatus"
    ].forEach(id => {
      const element = $(id);

      element?.addEventListener(
        "input",
        () => {
          applyJobFilters();
          renderJobList();
        }
      );

      element?.addEventListener(
        "change",
        () => {
          applyJobFilters();
          renderJobList();
        }
      );
    });

    $("serviceProductOwner")
      ?.addEventListener(
        "change",
        () => {
          renderOwnerRates();
          markCalculationDirty();
          updateMap();
        }
      );

    [
      "servicePlanningDate",
      "serviceStartTime",
      "serviceCrewSize",
      "serviceVehicle",
      "serviceDriver",
      "serviceQuoteValidity",
      "serviceIncludeReturnDepot",
      "serviceOptimiseStopOrder"
    ].forEach(id => {
      $(id)?.addEventListener(
        "change",
        markCalculationDirty
      );
    });

    $("btnAddServiceStop")
      ?.addEventListener(
        "click",
        () => openStopModal()
      );

    $("btnCloseServiceStopModal")
      ?.addEventListener(
        "click",
        closeStopModal
      );

    $("btnCancelServiceStop")
      ?.addEventListener(
        "click",
        closeStopModal
      );

    $("btnSaveServiceStop")
      ?.addEventListener(
        "click",
        saveStopFromModal
      );

    $("serviceStopModal")
      ?.addEventListener(
        "click",
        event => {
          if (
            event.target.id ===
            "serviceStopModal"
          ) {
            closeStopModal();
          }
        }
      );

    $("btnAddServiceCharge")
      ?.addEventListener(
        "click",
        addChargeLine
      );

    $("btnCalculateServiceQuote")
      ?.addEventListener(
        "click",
        calculateRouteAndQuote
      );

    $("btnOptimiseServiceStops")
      ?.addEventListener(
        "click",
        optimiseStopsOnly
      );

    $("btnFitServiceMap")
      ?.addEventListener(
        "click",
        fitServiceMap
      );

    $("btnSaveServiceDraft")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await saveServiceJob();
          } catch {
            // Error is already shown.
          }
        }
      );

    $("btnGenerateServiceQuote")
      ?.addEventListener(
        "click",
        generateQuotation
      );

    $("btnApproveServiceQuote")
      ?.addEventListener(
        "click",
        approveQuotation
      );

    $("btnPublishServiceJob")
      ?.addEventListener(
        "click",
        publishToOperations
      );

    $("btnCancelServiceJob")
      ?.addEventListener(
        "click",
        cancelServiceJob
      );

    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          $("serviceStopModal")
            ?.classList
            .contains("open")
        ) {
          closeStopModal();
        }
      }
    );
  }

  /* =========================================================
   * REFRESH AND INITIALISE
   * ========================================================= */

  async function refreshAll() {
    await loadSettings();

    loadProductOwners();

    await Promise.all([
      loadOwnerRates(),
      loadVehicles(),
      loadDrivers()
    ]);

    await loadServiceJobs();

    if (
      selectedJobId &&
      serviceJobs.some(job =>
        String(job.id) ===
        String(selectedJobId)
      )
    ) {
      await loadJobDetails(
        selectedJobId
      );

      return;
    }

    if (!currentJob) {
      newServiceJob();
    } else {
      renderCurrentJob();
    }
  }

  async function init() {
    try {
      client = db();

      window.ordersMapMode =
        "service_job_preview";

      window.ordersMapRows =
        [];

      window.allRouteStopsMapRows =
        [];

      window.selectedOrderIdsForMap =
        [];

      window.activeVehiclesMapRows =
        [];

      window.selectedRouteIdForMap =
        null;

      bindEvents();

      setValue(
        "serviceRequestedDate",
        todayIso()
      );

      setValue(
        "servicePlanningDate",
        todayIso()
      );

      await refreshAll();

      window.setTimeout(
        () => {
          updateMap();
          fitServiceMap();
        },
        700
      );
    } catch (error) {
      console.error(
        "Service Jobs failed to initialise:",
        error
      );

      showNotice(
        error.message ||
        "Could not load Service Jobs.",
        "err"
      );
    }
  }

  window.VeynorServiceJobs = {
    refresh:
      refreshAll,

    newJob:
      newServiceJob,

    calculate:
      calculateRouteAndQuote,

    save:
      saveServiceJob,

    getCurrentJob:
      () => currentJob,

    getStops:
      () => [...currentStops],

    getCharges:
      () => [...currentCharges],

    getCalculation:
      () => calculationResult
  };

  document.addEventListener(
    "DOMContentLoaded",
    init
  );
})();