(function () {
  "use strict";

  const COMPANY_ASSETS_BUCKET = "company-assets";
  const OWNER_PROFILES_KEY = "product_owner_profiles";

  let client = null;
  let companyId = null;
  let settingsMap = new Map();
  let ownerProfiles = [];
  let selectedOwnerKey = "";
let vehiclesCache = [];
let driverUsersCache = [];
let portalUsersCache = [];
let ownerProfilesLoaded = false;

  const DEFAULT_SETTINGS = {

emission_alert_delivery: "true",
emission_alert_route: "true",
emission_display_map: "true",

    main_company_name: "",
    main_display_name: "",
    main_trading_name: "",
    main_company_registration: "",
    main_email: "",
    main_phone: "",
    main_address: "",
    main_registered_address: "",
    main_vat: "",
    main_country: "United Kingdom",
    main_website: "",
    main_default_currency: "GBP",

    main_logo_url: "",
    main_logo_storage_path: "",
    brand_primary_color: "#1267ff",
    brand_accent_color: "#07152f",
    document_logo_position: "top_left",
    document_show_company_details: "true",

    finance_contact_name: "",
    finance_email: "",
    finance_phone: "",
    invoice_email: "",

    operations_contact_name: "",
    operations_email: "",
    operations_phone: "",
    pod_email: "",

    claims_contact_name: "",
    claims_email: "",
    claims_phone: "",

    bank_company_name: "",
    bank_name: "",
    bank_sort_code: "",
    bank_account_no: "",
    bank_iban: "",
    bank_bic: "",
    bank_payment_reference_format: "Invoice number + product owner code",

    invoice_prefix: "INV",
    acknowledgement_prefix: "ACK",
    delivery_note_prefix: "DN",
    pod_prefix: "POD",
    credit_note_prefix: "CN",
    invoice_next_number: "",
    acknowledgement_next_number: "",
    delivery_note_next_number: "",
    pod_next_number: "",

    invoice_payment_note: "",
    doc_damage_note: "",
    document_footer_text: "",
    delivery_disclaimer: "",
    pod_confirmation_text: "",
    terms_conditions_note: "",
    storage_terms_note: "",

    default_payment_terms_days: "",
    default_ack_lead_days: "",
    damage_reporting_days: "",
    storage_starts_after_days: "",

    tax_default_vat_rate: "0.20",
    tax_reverse_charge_text: "",
    tax_vat_exempt_text: "",

    warehouse_contact_name: "",
    warehouse_email: "",
    warehouse_phone: "",
    warehouse_opening_hours: "",
    loading_hours: "",
warehouse_handling_in_per_colli_gbp: "0.00",
warehouse_handling_out_per_colli_gbp: "0.00",
warehouse_storage_per_m3_gbp: "0.00",
warehouse_repack_per_colli_gbp: "0.00",
warehouse_qc_per_colli_gbp: "0.00",


home_depot_name: "",
home_depot_address_1: "",
home_depot_address_2: "",
home_depot_postcode: "",
home_depot_city: "",
home_depot_country: "United Kingdom",
home_depot_lat: "",
home_depot_lng: "",
home_depot_pickup_instructions: "",
home_depot_pickup_pdf_path: "",
    average_speed_kmh: "50",
stop_time_minutes: "15",
unloading_time_mode: "fixed",
unloading_extra_minutes_per_order: "5",
unloading_volume_threshold_m3: "1.5",
unloading_extra_minutes_per_m3: "5",
unloading_volume_rounding: "proportional",
    distance_factor: "1.25",
    max_route_volume_m3: "45",
    max_route_stops: "12",
    max_route_duration_hours: "9",
    max_orders_per_route: "12",
    default_transport_type: "own_transport",
   labour_cost_per_hour_gbp: "38.50",
vehicle_cost_per_hour_gbp: "8.50",
diesel_price_per_litre_gbp_inc_vat: "1.55",

   doc_default_payment_terms: "",
doc_vat_rate: "0.20",
doc_ack_lead_days: "21",
doc_bucket: "order-documents",


fuel_surcharge_enabled: "",
fuel_surcharge_percent: "",

regional_surcharge_enabled: "",
surcharge_edinburgh_glasgow_percent: "",
surcharge_highlands_islands_percent: "",

regional_pricing_zones: "",

pricing_ireland_mode: "price_on_request",
pricing_invoice_note: "",
pricing_ack_note: "",

london_ulez_enabled: "false",
london_ulez_charge: "",

london_lez_enabled: "false",
london_lez_charge: "",

london_congestion_enabled: "false",
london_congestion_charge: "",

london_charge_method: "per_delivery",
london_vehicle_applicability: "non_compliant",


sales_order_prefix: "SO-",
sales_order_padding: "5",
next_sales_order_number: "3246",

    email_sender_name: "",
    email_sender_address: "",
    email_auto_ack_default: "false",
    email_auto_invoice_default: "false",
    email_auto_pod_default: "false",
    email_default_cc: "",
    email_footer: "",

    system_default_country: "United Kingdom",
    system_default_product_owner: "",
    system_default_import_status: "imported",
    system_default_source_type: "manual_import"
  };

  const ALIASES = {
    finance_contact_name: ["contact_finance_name"],
    finance_email: ["contact_finance_email"],
    finance_phone: ["contact_finance_phone"],
    invoice_email: ["contact_invoice_email"],

    operations_contact_name: ["contact_ops_name"],
    operations_email: ["contact_ops_email"],
    operations_phone: ["contact_ops_phone"],

    pod_email: ["contact_pod_email"],
    claims_contact_name: ["contact_claims_name"],
    claims_email: ["contact_claims_email"],
    claims_phone: ["contact_claims_phone"],

    invoice_payment_note: ["text_invoice_payment_note"],
    delivery_disclaimer: ["text_delivery_disclaimer"],
    pod_confirmation_text: ["text_pod_confirmation"],
    terms_conditions_note: ["text_terms_conditions_note"],

    invoice_prefix: ["number_prefix_invoice"],
    acknowledgement_prefix: ["number_prefix_ack"],
    delivery_note_prefix: ["number_prefix_delivery_note"],
    pod_prefix: ["number_prefix_pod"],

    invoice_next_number: ["number_next_invoice"],
    acknowledgement_next_number: ["number_next_ack"],
    delivery_note_next_number: ["number_next_delivery_note"],
    pod_next_number: ["number_next_pod"],

    damage_reporting_days: ["default_damage_report_days"],
    storage_starts_after_days: ["default_storage_free_days"],
    tax_default_vat_rate: ["default_vat_rate"]
  };

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

  function toNumber(value, fallback = 0) {
    const n = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }



  function parseBool(value, fallback = false) {
    if (value === true || value === false) return value;
    const v = normalize(value);
    if (["true", "1", "yes", "ja", "on"].includes(v)) return true;
    if (["false", "0", "no", "nee", "off"].includes(v)) return false;
    return fallback;
  }

  function formatNumber(value, digits = 0) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatMoney(value) {
    return `£${formatNumber(value, 2)}`;
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = `notice ${type}`;

    clearTimeout(window.__settingsToastTimer);
    window.__settingsToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 7000);
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    client = sb();
    return client;
  }

  async function getCompanyId() {
  const db = ensureClient();

  const { data: authData, error: authError } = await db.auth.getUser();

  if (authError) throw authError;

  const userId = authData?.user?.id;

  if (!userId) {
    throw new Error("You are not signed in. Please sign in again.");
  }

  // Ondersteun beide bestaande koppelingen met het loginaccount.
  const { data: profiles, error: profileError } = await db
    .from("user_profiles")
    .select("id, auth_user_id, company_id, role, is_active")
    .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
    .eq("is_active", true);

  if (profileError) throw profileError;

  if (!profiles || profiles.length === 0) {
    throw new Error("No active user profile was found for your account.");
  }

  if (profiles.length !== 1) {
    throw new Error(
      "Multiple active profiles were found. Please contact your administrator."
    );
  }

  const profile = profiles[0];
  const role = String(profile.role || "").trim().toLowerCase();

  if (!["tenant_admin", "veynor_admin"].includes(role)) {
    throw new Error(
      "You do not have permission to manage company settings."
    );
  }

  if (!profile.company_id) {
    throw new Error(
      "No company is assigned to your account. Please contact your administrator."
    );
  }

  // Voorkom opslaan voor een ander bedrijf met nog oude schermgegevens.
  if (companyId && companyId !== profile.company_id) {
    throw new Error(
      "Your active company has changed. Reload this page before continuing."
    );
  }

  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id, is_active")
    .eq("id", profile.company_id)
    .maybeSingle();

  if (companyError) throw companyError;

  if (!company || company.is_active !== true) {
    throw new Error(
      "Your company could not be found or is inactive."
    );
  }

  companyId = company.id;
  return companyId;
}

  function getFieldValue(id, fallback = "") {
    const el = byId(id);
    if (!el) return fallback;

    if (el.type === "checkbox") {
      return el.checked ? "true" : "false";
    }

    return String(el.value ?? fallback).trim();
  }

  function setFieldValue(id, value) {
    const el = byId(id);
    if (!el) return;

    if (el.type === "checkbox") {
      el.checked = parseBool(value, false);
      return;
    }

    el.value = value ?? "";
  }

function getSetting(key, fallback = "") {
  // Een opgeslagen waarde heeft voorrang, ook als deze leeg is.
  if (settingsMap.has(key)) {
    return settingsMap.get(key) ?? "";
  }

  // Gebruik een alternatieve naam alleen als de hoofdinstelling ontbreekt.
  const aliases = ALIASES[key] || [];

  for (const alias of aliases) {
    if (settingsMap.has(alias)) {
      return settingsMap.get(alias) ?? "";
    }
  }

  // Alleen bij ontbrekende instellingen een standaardwaarde gebruiken.
  return DEFAULT_SETTINGS[key] ?? fallback ?? "";
}

function isGeneralSettingsField(el) {
  if (!el?.id) return false;

  // Bestanden en wachtwoorden zijn geen algemene instellingen.
  if (["file", "password", "button", "submit", "reset"].includes(el.type)) {
    return false;
  }

  // Deze formulieren hebben hun eigen opslagfuncties.
  if (
    el.id.startsWith("owner_") ||
    el.id.startsWith("newOwner") ||
    el.id.startsWith("newVehicle") ||
    el.id.startsWith("newDriver") ||
    el.id.startsWith("newUser")
  ) {
    return false;
  }

  // Dit is een berekende weergave, geen opgeslagen instelling.
  if (el.id === "next_sales_order_preview") {
    return false;
  }

  return true;
}

function collectFieldsInside(containerId) {
  const container = byId(containerId);
  if (!container) return [];

  return Array.from(
    container.querySelectorAll("input[id], select[id], textarea[id]")
  )
    .filter(isGeneralSettingsField)
    .map(el => el.id);
}

function collectAllSettingsFields() {
  return Array.from(
    document.querySelectorAll(
      ".settings-panel input[id], " +
      ".settings-panel select[id], " +
      ".settings-panel textarea[id]"
    )
  )
    .filter(isGeneralSettingsField)
    .map(el => el.id);
}


function validateUnloadingSettings() {
  const mode = getFieldValue("unloading_time_mode");

  const allowedModes = [
    "fixed",
    "orders",
    "volume",
    "combined"
  ];

  if (!allowedModes.includes(mode)) {
    throw new Error(
      "Select a valid unloading calculation method."
    );
  }

  const rounding = getFieldValue(
    "unloading_volume_rounding"
  );

  if (!["proportional", "round_up"].includes(rounding)) {
    throw new Error(
      "Select a valid volume rounding method."
    );
  }

  const numericFields = [
    "stop_time_minutes",
    "unloading_extra_minutes_per_order",
    "unloading_volume_threshold_m3",
    "unloading_extra_minutes_per_m3"
  ];

  for (const id of numericFields) {
    const element = byId(id);

    if (!element) {
      throw new Error(`Required setting is missing: ${id}`);
    }

    const raw = getFieldValue(id);

    if (raw === "") {
      throw new Error(`Enter a value for ${id}.`);
    }

    const value = Number(raw.replace(",", "."));

    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid unloading setting: ${id}.`);
    }
  }

  return true;
}

function validatePricingSettings() {
  const requiredBooleans = [
    "fuel_surcharge_enabled",
    "regional_surcharge_enabled"
  ];

  for (const id of requiredBooleans) {
    if (!byId(id)) {
      throw new Error(`Required field missing: ${id}`);
    }

    if (!["true", "false"].includes(getFieldValue(id))) {
      throw new Error(
        `Select Enabled or Disabled for ${id}.`
      );
    }
  }

  const percentages = [
    ["fuel_surcharge_enabled", "fuel_surcharge_percent"],
    [
      "regional_surcharge_enabled",
      "surcharge_edinburgh_glasgow_percent"
    ],
    [
      "regional_surcharge_enabled",
      "surcharge_highlands_islands_percent"
    ]
  ];

  for (const [enabledId, percentId] of percentages) {
    const enabled = getFieldValue(enabledId) === "true";
    const raw = getFieldValue(percentId);

    if (enabled && raw === "") {
      throw new Error(
        `Enter a percentage for ${percentId}.`
      );
    }

    if (raw !== "") {
      const value = Number(raw.replace(",", "."));

      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Invalid percentage for ${percentId}.`
        );
      }
    }
  }

  const londonCharges = [
    ["london_ulez_enabled", "london_ulez_charge"],
    ["london_lez_enabled", "london_lez_charge"],
    ["london_congestion_enabled", "london_congestion_charge"]
  ];

  for (const [enabledId, amountId] of londonCharges) {
    if (!byId(enabledId) || !byId(amountId)) {
      throw new Error(
        `Required London pricing field missing: ${enabledId} / ${amountId}`
      );
    }

    const enabledValue = getFieldValue(enabledId);

    if (!["true", "false"].includes(enabledValue)) {
      throw new Error(
        `Invalid Enabled/Disabled value for ${enabledId}.`
      );
    }

    const raw = getFieldValue(amountId);

    if (enabledValue === "true" && raw === "") {
      throw new Error(
        `Enter a charge for ${amountId}.`
      );
    }

    if (raw !== "") {
      const amount = Number(raw.replace(",", "."));

      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(
          `Invalid charge amount for ${amountId}.`
        );
      }
    }
  }

  const chargeMethod = getFieldValue("london_charge_method");

  if (!["per_delivery", "per_route", "per_day"].includes(chargeMethod)) {
    throw new Error("Invalid London charging method.");
  }

  const vehicleApplicability =
    getFieldValue("london_vehicle_applicability");

  if (!["all", "non_compliant"].includes(vehicleApplicability)) {
    throw new Error("Invalid London vehicle applicability.");
  }

  const zoneRaw = getFieldValue("regional_pricing_zones");
  const regionalEnabled =
    getFieldValue("regional_surcharge_enabled") === "true";

  if (regionalEnabled && !zoneRaw) {
    throw new Error(
      "Regional Postcode Rules are required when regional surcharges are enabled."
    );
  }

  if (zoneRaw) {
    let zones;

    try {
      zones = JSON.parse(zoneRaw);
    } catch {
      throw new Error(
        "Regional Postcode Rules must contain valid JSON."
      );
    }

    if (!Array.isArray(zones) || zones.length === 0) {
      throw new Error(
        "Regional Postcode Rules must contain at least one zone."
      );
    }

    const ids = new Set();

    for (const zone of zones) {
      if (
        !zone ||
        typeof zone !== "object" ||
        Array.isArray(zone) ||
        typeof zone.id !== "string" ||
        !zone.id.trim() ||
        typeof zone.name !== "string" ||
        !zone.name.trim() ||
        typeof zone.enabled !== "boolean" ||
        !Number.isInteger(zone.priority) ||
        zone.priority < 0 ||
        typeof zone.surcharge_setting_key !== "string" ||
        !/^[a-z][a-z0-9_]*$/.test(
          zone.surcharge_setting_key
        ) ||
        !Array.isArray(zone.postcode_rules) ||
        zone.postcode_rules.length === 0 ||
        !Array.isArray(zone.unknown_district_areas)
      ) {
        throw new Error(
          "Invalid Regional Pricing Zone configuration."
        );
      }

      if (ids.has(zone.id)) {
        throw new Error(
          `Duplicate Regional Pricing Zone ID: ${zone.id}`
        );
      }

      ids.add(zone.id);

      for (const rule of zone.postcode_rules) {
        if (
          typeof rule !== "string" ||
          !/^[A-Z]{1,2}(?:\d{1,2}\+)?$/.test(rule)
        ) {
          throw new Error(
            `Invalid postcode rule "${rule}" in ${zone.name}.`
          );
        }
      }

      for (const area of zone.unknown_district_areas) {
        if (
          typeof area !== "string" ||
          !/^[A-Z]{1,2}$/.test(area)
        ) {
          throw new Error(
            `Invalid unknown district area in ${zone.name}.`
          );
        }
      }

      if (zone.enabled) {
        const percentKey = zone.surcharge_setting_key;

        if (!byId(percentKey)) {
          throw new Error(
            `Pricing field "${percentKey}" is missing.`
          );
        }

        const raw = getFieldValue(percentKey);

        if (
          raw === "" ||
          !Number.isFinite(Number(raw.replace(",", "."))) ||
          Number(raw.replace(",", ".")) < 0
        ) {
          throw new Error(
            `Invalid surcharge percentage for ${zone.name}.`
          );
        }
      }
    }
  }

  return true;
}


  function getDriverName(driver) {
    return driver?.full_name || driver?.email || "Driver";
  }

  function getDriverEmail(driver) {
    return driver?.email || "";
  }

  function getDriverPhone(driver) {
    return driver?.phone || "";
  }

  function getDriverRole(driver) {
    return driver?.role || "driver";
  }

  function driverIsActive(driver) {
    return driver?.is_active !== false && String(driver?.is_active ?? "").toLowerCase() !== "false";
  }

  function driverUseInPlanning(driver) {
    return driver?.use_in_planning !== false && String(driver?.use_in_planning ?? "").toLowerCase() !== "false";
  }

  function getDriverById(driverId) {
    if (!driverId) return null;

    return driverUsersCache.find(row =>
      String(row.id) === String(driverId) ||
      String(row.auth_user_id) === String(driverId) ||
      String(row.profile_id) === String(driverId)
    ) || null;
  }

  function getDriverEmailById(driverId) {
    const driver = getDriverById(driverId);
    return driver ? getDriverEmail(driver) : "";
  }

  function getDriverNameById(driverId) {
    const driver = getDriverById(driverId);
    return driver ? getDriverName(driver) : "";
  }

  function driverOptionsHtml(selectedId = "") {
    const selected = String(selectedId || "");

    return [
      `<option value="">No driver assigned</option>`,
      ...driverUsersCache
        .filter(driverIsActive)
        .filter(driverUseInPlanning)
        .map(driver => {
          const id = driver.auth_user_id || driver.id;
          const email = getDriverEmail(driver);
          const label = `${getDriverName(driver)}${email && normalize(getDriverName(driver)) !== normalize(email) ? ` · ${email}` : ""}`;

          return `
            <option value="${escapeHtml(id)}" ${String(id) === selected ? "selected" : ""}>
              ${escapeHtml(label)}
            </option>
          `;
        })
    ].join("");
  }

  function vehicleOptionsHtml(selectedId = "") {
    const selected = String(selectedId || "");

    return [
      `<option value="">No default vehicle</option>`,
      ...vehiclesCache.map(vehicle => {
        const label = [
          vehicle.name || "Vehicle",
          vehicle.vehicle_code || "",
          vehicle.registration || ""
        ].filter(Boolean).join(" · ");

        return `
          <option value="${escapeHtml(vehicle.id)}" ${String(vehicle.id) === selected ? "selected" : ""}>
            ${escapeHtml(label)}
          </option>
        `;
      })
    ].join("");
  }

  async function loadDriverUsers() {
    const cid = await getCompanyId();
    const db = ensureClient();

    const { data, error } = await db
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        company_id,
        full_name,
        role,
        phone,
        is_active,
        email,
        is_driver,
        use_in_planning,
        default_vehicle_id
      `)
      .eq("company_id", cid)
      .eq("is_active", true);

    if (error) {
      console.error("Could not load drivers:", error.message);
      driverUsersCache = [];
      renderDriverDropdowns();
      renderDriversTable();
      return;
    }

    driverUsersCache = (data || [])
      .filter(row => {
        const role = normalize(row.role || "");
        return row.is_driver === true || role === "driver" || role === "chauffeur";
      })
      .map(row => ({
        profile_id: row.id,
        id: row.auth_user_id || row.id,
        auth_user_id: row.auth_user_id || row.id,
        company_id: row.company_id,
        full_name: row.full_name || row.email || "Driver",
        email: row.email || "",
        phone: row.phone || "",
        role: row.role || "driver",
        is_driver: row.is_driver === true,
        is_active: row.is_active !== false,
        use_in_planning: row.use_in_planning !== false,
        default_vehicle_id: row.default_vehicle_id || ""
      }))
      .sort((a, b) => getDriverName(a).localeCompare(getDriverName(b)));

    console.log("Loaded drivers:", driverUsersCache);

    renderDriverDropdowns();
    renderDriversTable();
  }

  function renderDriverDropdowns() {
    const newVehicleDriverSelect = byId("newVehicleDriverUserId");

    if (newVehicleDriverSelect) {
      const current = newVehicleDriverSelect.value || "";
      newVehicleDriverSelect.innerHTML = driverOptionsHtml(current);
      if (current) newVehicleDriverSelect.value = current;
    }

    const newDriverDefaultVehicle = byId("newDriverDefaultVehicle");

    if (newDriverDefaultVehicle) {
      const current = newDriverDefaultVehicle.value || "";
      newDriverDefaultVehicle.innerHTML = vehicleOptionsHtml(current);
      if (current) newDriverDefaultVehicle.value = current;
    }

    document.querySelectorAll('[data-field="driver_user_id"]').forEach(select => {
      const current = select.value || "";
      select.innerHTML = driverOptionsHtml(current);
      if (current) select.value = current;
    });
  }

  function renderDriversTable() {
    const tbody = byId("driversBody");
    if (!tbody) return;

    if (!driverUsersCache.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">No drivers found. Check whether user_profiles contains an active driver row.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = driverUsersCache.map(driver => {
      const defaultVehicle = vehiclesCache.find(vehicle =>
        String(vehicle.id) === String(driver.default_vehicle_id || "")
      );

      return `
        <tr>
          <td>
            <strong>${escapeHtml(getDriverName(driver))}</strong>
            <span class="subline">${escapeHtml(driver.auth_user_id || driver.id || "")}</span>
          </td>
          <td>${escapeHtml(getDriverEmail(driver) || "—")}</td>
          <td>${escapeHtml(getDriverPhone(driver) || "—")}</td>
          <td>${escapeHtml(getDriverRole(driver) || "driver")}</td>
          <td>${escapeHtml(defaultVehicle?.name || "—")}</td>
          <td>
            <span class="pill ${driverUseInPlanning(driver) ? "pill-green" : "pill-gray"}">
              ${driverUseInPlanning(driver) ? "Yes" : "No"}
            </span>
          </td>
          <td>
            <span class="pill ${driverIsActive(driver) ? "pill-green" : "pill-gray"}">
              ${driverIsActive(driver) ? "Active" : "Inactive"}
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }

async function loadPortalUsers() {
  const db = ensureClient();
  const cid = await getCompanyId();

  const { data, error } = await db
    .from("user_profiles")
    .select(`
      id,
      auth_user_id,
      company_id,
      full_name,
      email,
      role,
      customer_id,
      retailer_code,
      is_driver,
      is_active,
      use_in_planning
    `)
    .eq("company_id", cid)
    .order("full_name", { ascending: true });

  if (error) throw error;

  portalUsersCache = data || [];
  renderPortalUsersTable();
}

function renderPortalUsersTable() {
  const tbody = byId("portalUsersBody");
  if (!tbody) return;

  if (!portalUsersCache.length) {
    tbody.innerHTML = `<tr><td colspan="7">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = portalUsersCache.map(user => `
    <tr>
      <td>
        <strong>${escapeHtml(user.full_name || "—")}</strong>
        <span class="subline">${escapeHtml(user.auth_user_id || "")}</span>
      </td>
      <td>${escapeHtml(user.email || "—")}</td>
      <td>${escapeHtml(user.role || "—")}</td>
      <td>${escapeHtml(user.customer_id || "—")}</td>
      <td>${escapeHtml(user.retailer_code || "—")}</td>
      <td>
        <span class="pill ${user.is_driver ? "pill-green" : "pill-gray"}">
          ${user.is_driver ? "Yes" : "No"}
        </span>
      </td>
      <td>
        <span class="pill ${user.is_active !== false ? "pill-green" : "pill-gray"}">
          ${user.is_active !== false ? "Active" : "Inactive"}
        </span>
      </td>
    </tr>
  `).join("");
}

async function createPortalUser() {
  const payload = {
    full_name: getFieldValue("newUserFullName"),
    email: getFieldValue("newUserEmail"),
    password: getFieldValue("newUserPassword"),
    role: getFieldValue("newUserRole", "tenant_user"),
    customer_id: getFieldValue("newUserCustomerId") || null,
    retailer_code: getFieldValue("newUserRetailerCode") || null,
    is_driver: parseBool(getFieldValue("newUserIsDriver", "false"), false),
    is_active: parseBool(getFieldValue("newUserActive", "true"), true)
  };

  if (!payload.email) throw new Error("Email is required.");
  if (!payload.password || payload.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const db = ensureClient();

  const { data, error } = await db.functions.invoke("create-portal-user", {
  body: payload
});

console.log("FUNCTION DATA:", data);
console.log("FUNCTION ERROR:", error);

 if (error) {
  console.log("FULL ERROR:", error);
  alert(JSON.stringify(error));
  throw error;
}
  if (data?.error) throw new Error(data.error);

  showToast("User created successfully.", "ok");

  [
    "newUserFullName",
    "newUserEmail",
    "newUserPassword",
    "newUserCustomerId",
    "newUserRetailerCode"
  ].forEach(id => setFieldValue(id, ""));

  setFieldValue("newUserRole", "tenant_user");
  setFieldValue("newUserIsDriver", "false");
  setFieldValue("newUserActive", "true");

  await loadPortalUsers();
  await loadDriverUsers();
}

 async function addOrLinkDriver() {
  const db = ensureClient();
  const cid = await getCompanyId();

  const fullName = getFieldValue("newDriverName");
  const email = getFieldValue("newDriverEmail");
  const phone = getFieldValue("newDriverPhone");
  const role = getFieldValue("newDriverRole", "driver");
  const defaultVehicleId = getFieldValue("newDriverDefaultVehicle");

console.log("DEFAULT VEHICLE =", defaultVehicleId);
  const useInPlanning = parseBool(getFieldValue("newDriverUseInPlanning", "true"), true);
  const isActive = parseBool(getFieldValue("newDriverActive", "true"), true);

  if (!email) throw new Error("Driver email is required.");

  const { data: existingUser, error: findError } = await db
    .from("user_profiles")
    .select("id, auth_user_id, email, full_name")
    .eq("company_id", cid)
    .ilike("email", email)
    .maybeSingle();

  if (findError) throw findError;

  if (!existingUser?.id) {
    throw new Error(
      "This email does not exist in Users & Access yet. Create the user there first, then link it as driver."
    );
  }

console.log({
  email,
  defaultVehicleId,
  role,
  phone,
  useInPlanning,
  isActive
});

  const { error } = await db
    .from("user_profiles")
    .update({
      full_name: fullName || existingUser.full_name || email,
      role,
      phone,
      email,
      is_driver: true,
      is_active: isActive,
      use_in_planning: useInPlanning,
      default_vehicle_id: defaultVehicleId || null
    })
    .eq("id", existingUser.id)
    .eq("company_id", cid);

  if (error) throw error;

  showToast("Existing user linked as driver.", "ok");

  [
    "newDriverName",
    "newDriverEmail",
    "newDriverPhone",
    "newDriverDefaultVehicle"
  ].forEach(id => setFieldValue(id, ""));

  setFieldValue("newDriverRole", "driver");
  setFieldValue("newDriverUseInPlanning", "true");
  setFieldValue("newDriverActive", "true");

  await loadDriverUsers();
  await loadVehicles();
}

  async function loadSettings() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("settings")
      .select("setting_key, setting_value")
      .eq("company_id", cid);

    if (error) throw error;

    settingsMap = new Map((data || []).map(row => [row.setting_key, row.setting_value ?? ""]));

    collectAllSettingsFields().forEach(id => {
      setFieldValue(id, getSetting(id, ""));
    });

    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      if (byId(key)) setFieldValue(key, getSetting(key, ""));
    });

    loadOwnerProfiles();
    renderOwnerList();
    renderOwnerEditor();
   renderLogoPreview();
updateSalesOrderPreview();
updateSummary();
  }

async function saveSettingsByIds(
  ids,
  successMessage = "Settings saved."
) {
  const db = ensureClient();
  const cid = await getCompanyId();

  const uniqueIds = [...new Set(ids || [])]
    .filter(id => typeof id === "string")
    .filter(id => isGeneralSettingsField(byId(id)));

  if (!uniqueIds.length) {
    showToast("No matching settings found to save.", "err");
    return;
  }

  const rows = uniqueIds.map(id => ({
    company_id: cid,
    setting_key: id,
    setting_value: getFieldValue(id)
  }));

  const { error } = await db
    .from("settings")
    .upsert(rows, {
      onConflict: "company_id,setting_key"
    });

  if (error) throw error;

  // Werk de lokale waarden pas bij na succesvol opslaan.
  rows.forEach(row => {
    settingsMap.set(row.setting_key, row.setting_value);
  });

  showToast(successMessage, "ok");
  updateSummary();
}

  async function saveSettingValue(key, value) {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { error } = await db
      .from("settings")
      .upsert({
        company_id: cid,
        setting_key: key,
        setting_value: String(value ?? "")
      }, { onConflict: "company_id,setting_key" });

    if (error) throw error;

    settingsMap.set(key, String(value ?? ""));
  }

  function getFileExtension(file) {
    const nameExt = String(file?.name || "").split(".").pop().toLowerCase();

    if (["png", "jpg", "jpeg", "webp"].includes(nameExt)) {
      return nameExt === "jpeg" ? "jpg" : nameExt;
    }

    const type = String(file?.type || "").toLowerCase();

    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";

    return "png";
  }


function getSelectedDepotPdfFile() {
  const input = byId("home_depot_pickup_pdf_file");
  return input?.files?.[0] || null;
}

async function uploadDepotPdfIfSelected() {
  const file = getSelectedDepotPdfFile();

  if (!file) return null;

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    throw new Error("Only PDF files are allowed.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("PDF must not exceed 10 MB.");
  }

  const db = ensureClient();
  const cid = await getCompanyId();

  const path =
    `${cid}/depot/collection-instructions-${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await db.storage
    .from(COMPANY_ASSETS_BUCKET)
    .upload(path, file, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false
    });

  if (uploadError) throw uploadError;

  const confirmedCid = await getCompanyId();

  if (confirmedCid !== cid) {
    throw new Error("Active tenant changed during upload.");
  }

  setFieldValue("home_depot_pickup_pdf_path", path);

  return path;
}


  function getSelectedLogoFile() {
    const input = byId("main_logo_file");
    return input?.files?.[0] || null;
  }

  function renderLogoPreview(url = "") {
    const img = byId("main_logo_preview");
    const empty = byId("main_logo_preview_empty");
    const box = byId("main_logo_preview_box");

    if (!img) return;

    const logoUrl = String(url || getFieldValue("main_logo_url") || getSetting("main_logo_url", "") || "").trim();

    if (logoUrl) {
      img.src = logoUrl;
      img.style.display = "block";
      if (empty) empty.style.display = "none";
      if (box) box.classList.add("has-logo");
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
      if (empty) empty.style.display = "block";
      if (box) box.classList.remove("has-logo");
    }
  }

  function previewSelectedLogoFile() {
    const file = getSelectedLogoFile();

    if (!file) {
      renderLogoPreview();
      return;
    }

    const img = byId("main_logo_preview");
    const empty = byId("main_logo_preview_empty");
    const box = byId("main_logo_preview_box");

    if (!img) return;

    img.src = URL.createObjectURL(file);
    img.style.display = "block";

    if (empty) empty.style.display = "none";
    if (box) box.classList.add("has-logo");
  }

async function uploadMainLogoIfSelected() {
  const file = getSelectedLogoFile();
  if (!file) return null;

  const db = ensureClient();
  const cid = await getCompanyId();

  const ext = getFileExtension(file);

  // Een eigen map per tenant en een nieuw bestand per upload.
  const path = `${cid}/main-logo-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await db.storage
    .from(COMPANY_ASSETS_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`
    });

  if (uploadError) throw uploadError;

  const { data } = db.storage
    .from(COMPANY_ASSETS_BUCKET)
    .getPublicUrl(path);

  const publicUrl = data?.publicUrl;

  if (!publicUrl) {
    throw new Error("Could not determine the uploaded logo URL.");
  }

  // Controleer vóór opslaan opnieuw het actieve bedrijf.
  await getCompanyId();

  // Sla de URL en het opslagpad samen op.
  const { error: saveError } = await db
    .from("settings")
    .upsert(
      [
        {
          company_id: cid,
          setting_key: "main_logo_url",
          setting_value: publicUrl
        },
        {
          company_id: cid,
          setting_key: "main_logo_storage_path",
          setting_value: path
        }
      ],
      { onConflict: "company_id,setting_key" }
    );

  if (saveError) throw saveError;

  settingsMap.set("main_logo_url", publicUrl);
  settingsMap.set("main_logo_storage_path", path);

  setFieldValue("main_logo_url", publicUrl);
  setFieldValue("main_logo_storage_path", path);

  renderLogoPreview(publicUrl);

  return { publicUrl, path };
}

  function getSelectedOwnerLogoFile() {
    const input = byId("owner_logo_file");
    return input?.files?.[0] || null;
  }

  function renderOwnerLogoPreview(url = "") {
    const img = byId("owner_logo_preview");
    const empty = byId("owner_logo_preview_empty");
    const box = byId("owner_logo_preview_box");

    if (!img || !box) return;

    const logoUrl = String(url || getFieldValue("owner_logo_url") || "").trim();

    if (logoUrl) {
      img.src = logoUrl;
      img.style.display = "block";
      if (empty) empty.style.display = "none";
      box.classList.add("has-logo");
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
      if (empty) empty.style.display = "block";
      box.classList.remove("has-logo");
    }
  }

  function previewSelectedOwnerLogoFile() {
    const file = getSelectedOwnerLogoFile();

    if (!file) {
      renderOwnerLogoPreview();
      return;
    }

    const img = byId("owner_logo_preview");
    const empty = byId("owner_logo_preview_empty");
    const box = byId("owner_logo_preview_box");

    if (!img || !box) return;

    img.src = URL.createObjectURL(file);
    img.style.display = "block";

    if (empty) empty.style.display = "none";
    box.classList.add("has-logo");
  }

async function uploadOwnerLogoIfSelected() {
  const file = getSelectedOwnerLogoFile();
  if (!file) return null;

  if (!ownerProfilesLoaded) {
    throw new Error(
      "Product owners have not been loaded successfully. Reload the page."
    );
  }

  const owner = getSelectedOwner();

  if (!owner?.key) {
    throw new Error("Select a product owner before uploading a logo.");
  }

  const ownerKey = owner.key;
  const db = ensureClient();
  const cid = await getCompanyId();

  const ext = getFileExtension(file);
  const safeOwnerKey = String(ownerKey)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!safeOwnerKey) {
    throw new Error("The product owner key cannot be used for a logo upload.");
  }

  const path =
    `${cid}/product-owners/${safeOwnerKey}/logo-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await db.storage
    .from(COMPANY_ASSETS_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`
    });

  if (uploadError) throw uploadError;

  const { data } = db.storage
    .from(COMPANY_ASSETS_BUCKET)
    .getPublicUrl(path);

  const publicUrl = data?.publicUrl;

  if (!publicUrl) {
    throw new Error("Could not determine the uploaded logo URL.");
  }

  await getCompanyId();

  // Voorkom dat het logo bij een ander geselecteerd profiel terechtkomt.
  if (getSelectedOwner()?.key !== ownerKey) {
    throw new Error(
      "The selected product owner changed during upload. Select the correct owner and try again."
    );
  }

  setFieldValue("owner_logo_url", publicUrl);
  setFieldValue("owner_logo_storage_path", path);

  renderOwnerLogoPreview(publicUrl);

  // De bestaande opslagfunctie bewaart deze velden bij het profiel.
  return { publicUrl, path };
}

function loadOwnerProfiles() {
  ownerProfilesLoaded = false;

  const raw = settingsMap.get(OWNER_PROFILES_KEY);
  let parsed;

  // Geen opgeslagen profielen: begin met een lege lijst.
  if (raw == null || String(raw).trim() === "") {
    parsed = [];
  } else {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Product owner settings could not be read. Saving product owners is blocked to protect existing data."
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Product owner settings must contain a list. Saving product owners is blocked to protect existing data."
    );
  }

  const keys = new Set();

  for (const owner of parsed) {
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      typeof owner.key !== "string" ||
      owner.key.trim() === ""
    ) {
      throw new Error(
        "A saved product owner is invalid or has no key. Saving product owners is blocked to protect existing data."
      );
    }

    if (keys.has(owner.key)) {
      throw new Error(
        "Duplicate product owner keys were found. Saving product owners is blocked to protect existing data."
      );
    }

    keys.add(owner.key);
  }

  // Behoud alle opgeslagen velden, ook onbekende of later toegevoegde.
  const loadedProfiles = parsed.map(owner => ({
    ...owner,
    logo_url: owner.logo_url ?? "",
    logo_storage_path: owner.logo_storage_path ?? ""
  }));

  ownerProfiles = loadedProfiles;

  if (!ownerProfiles.some(owner => owner.key === selectedOwnerKey)) {
    selectedOwnerKey = ownerProfiles[0]?.key || "";
  }

  ownerProfilesLoaded = true;
}

async function saveOwnerProfiles() {
  if (!ownerProfilesLoaded) {
    throw new Error(
      "Product owners have not been loaded successfully. Reload the page. Saving is blocked to protect existing data."
    );
  }

  await saveSettingValue(
    OWNER_PROFILES_KEY,
    JSON.stringify(ownerProfiles)
  );
}


function updateSelectedOwnerBillingUI() {
  const owner = getSelectedOwner();

  const warehouseInput = byId(
    "owner_invoice_warehouse_enabled"
  );

  const transportInput = byId(
    "owner_invoice_transport_enabled"
  );

  if (warehouseInput) {
    warehouseInput.checked = owner
      ? parseBool(owner.invoice_warehouse_enabled, true)
      : false;
  }

  if (transportInput) {
    transportInput.checked = owner
      ? parseBool(owner.invoice_transport_enabled, true)
      : false;
  }

  if (typeof window.updateOwnerTransportDependencies === "function") {
    window.updateOwnerTransportDependencies();
  }

  const avatar = byId("ownerProfileAvatar");

  if (avatar) {
    const name = String(
      owner?.trading_name || owner?.name || ""
    ).trim();

    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(word => word.charAt(0).toUpperCase())
      .join("");

    avatar.textContent = initials || "PO";
  }
}


  function getSelectedOwner() {
    return ownerProfiles.find(p => p.key === selectedOwnerKey) || ownerProfiles[0] || null;
  }



function renderOwnerList() {
  updateTenantHeader();

  const mount = byId("ownerList");
  if (!mount) return;

  if (!ownerProfiles.length) {
    mount.innerHTML = `
      <div class="note-box">
        No product owners configured yet.
      </div>
    `;
    return;
  }

  mount.innerHTML = ownerProfiles.map(owner => `
    <button
      class="owner-btn ${
        owner.key === selectedOwnerKey ? "active" : ""
      }"
      type="button"
      data-owner-key="${escapeHtml(owner.key)}"
    >
      <strong>
        ${escapeHtml(
          owner.trading_name || owner.name || "Product Owner"
        )}
      </strong>

      <span>
        ${escapeHtml(owner.name || "")}
      </span>
    </button>
  `).join("");

  mount.querySelectorAll("[data-owner-key]").forEach(button => {
    button.addEventListener("click", () => {
      const nextKey = button.getAttribute("data-owner-key");

      if (!nextKey || nextKey === selectedOwnerKey) {
        return;
      }

      const currentOwner = getSelectedOwner();

      if (currentOwner) {
        let editedOwner;

        try {
          editedOwner = readOwnerEditor();
        } catch (error) {
          showToast(
            error.message || "Could not read current settings.",
            "err"
          );
          return;
        }

        // Compare each property by value rather than JSON
        // property order or differences between string
        // and boolean representations.
        const changed = Object.keys(editedOwner).some(key => {
          const original = currentOwner[key];
          const edited = editedOwner[key];

          if (original === edited) return false;

          const booleanKeys = [
            "invoice_warehouse_enabled",
            "invoice_transport_enabled",
            "auto_ack",
            "auto_invoice",
            "minimum_delivery_enabled",
            "minimum_delivery_requires_approval",
            "minimum_delivery_owner_can_approve",
            "minimum_delivery_manual_override",
            "regional_surcharge_enabled",
            "fuel_surcharge_enabled"
          ];

          if (booleanKeys.includes(key)) {
            const fallback = [
              "invoice_warehouse_enabled",
              "invoice_transport_enabled"
            ].includes(key);

            return parseBool(original, fallback) !==
                   parseBool(edited, fallback);
          }

          return String(original ?? "") !==
                 String(edited ?? "");
        });

        const pendingLogo = !!getSelectedOwnerLogoFile();

        if (changed || pendingLogo) {
          const confirmed = window.confirm(
            "You have unsaved changes.\n\n" +
            "Switch product owner and discard these changes?"
          );

          if (!confirmed) return;
        }
      }

      selectedOwnerKey = nextKey;

      renderOwnerList();
      renderOwnerEditor();
    });
  });
}

function renderOwnerEditor() {
  const owner = getSelectedOwner();

  const title = byId("ownerEditorTitle");

  if (title) {
    title.textContent = owner
      ? (owner.trading_name || owner.name || "Product Owner")
      : "Select product owner";
  }

  const fields = [
    "name",
    "trading_name",
    "customer_code",
    "display_code",
    "vat",
    "address1",
    "address2",
    "city",
    "postcode",
    "country",
    "logo_url",
    "logo_storage_path",
    "invoice_email",
    "ack_email",
    "pod_email",
    "ops_email",
    "payment_terms_days",
    "invoice_frequency",
    "default_source_name",
    "auto_ack",
    "auto_invoice",
    "minimum_delivery_enabled",
    "minimum_delivery_volume_m3",
    "minimum_delivery_transport_tariff_per_m3",
    "minimum_delivery_requires_approval",
    "minimum_delivery_owner_can_approve",
    "minimum_delivery_manual_override",
    "minimum_delivery_invoice_label",
    "regional_surcharge_enabled",
    "surcharge_edinburgh_glasgow_percent",
    "surcharge_highlands_islands_percent",
    "pricing_ireland_mode",
    "fuel_surcharge_enabled",
    "fuel_surcharge_percent",
    "pricing_ack_note",
    "pricing_invoice_note",
    "notes"
  ];

  fields.forEach(field => {
    setFieldValue(
      `owner_${field}`,
      owner?.[field] ?? ""
    );
  });

  setFieldValue(
    "owner_auto_ack",
    String(parseBool(owner?.auto_ack, false))
  );

  setFieldValue(
    "owner_auto_invoice",
    String(parseBool(owner?.auto_invoice, false))
  );

  renderOwnerLogoPreview(owner?.logo_url || "");

  const logoInput = byId("owner_logo_file");

  if (logoInput) {
    logoInput.value = "";
  }

  updateSelectedOwnerBillingUI();
}


function readOwnerEditor() {
  const owner = getSelectedOwner();

  if (!owner) return null;

  // Preserve existing properties, including unknown fields.
  const updatedOwner = { ...owner };

  const textFields = [
    "name",
    "trading_name",
    "customer_code",
    "display_code",
    "vat",
    "address1",
    "address2",
    "city",
    "postcode",
    "country",
    "logo_url",
    "logo_storage_path",
    "invoice_email",
    "ack_email",
    "pod_email",
    "ops_email",
    "payment_terms_days",
    "invoice_frequency",
    "default_source_name",
    "minimum_delivery_volume_m3",
    "minimum_delivery_transport_tariff_per_m3",
    "minimum_delivery_invoice_label",
    "surcharge_edinburgh_glasgow_percent",
    "surcharge_highlands_islands_percent",
    "pricing_ireland_mode",
    "fuel_surcharge_percent",
    "pricing_ack_note",
    "pricing_invoice_note",
    "notes"
  ];

  for (const field of textFields) {
    const id = `owner_${field}`;

    if (!byId(id)) continue;

    updatedOwner[field] = getFieldValue(id);
  }

  if (byId("owner_display_code")) {
    updatedOwner.display_code = String(
      updatedOwner.display_code || ""
    ).toUpperCase().slice(0, 3);
  }

  const booleanFields = [
    "auto_ack",
    "auto_invoice",
    "minimum_delivery_enabled",
    "minimum_delivery_requires_approval",
    "minimum_delivery_owner_can_approve",
    "minimum_delivery_manual_override",
    "regional_surcharge_enabled",
    "fuel_surcharge_enabled"
  ];

  for (const field of booleanFields) {
    const id = `owner_${field}`;

    if (!byId(id)) continue;

    const value = getFieldValue(id).toLowerCase();

    if (["true", "1", "yes", "ja", "on"].includes(value)) {
      updatedOwner[field] = true;
    } else if (
      ["false", "0", "no", "nee", "off"].includes(value)
    ) {
      updatedOwner[field] = false;
    } else {
      throw new Error(
        `Please select a valid value for "${field}" before saving.`
      );
    }
  }

  // New independent service billing settings.
  const warehouseInput = byId(
    "owner_invoice_warehouse_enabled"
  );

  const transportInput = byId(
    "owner_invoice_transport_enabled"
  );

  if (!warehouseInput || !transportInput) {
    throw new Error(
      "Billing configuration fields are missing. Reload the settings page."
    );
  }

  updatedOwner.invoice_warehouse_enabled =
    warehouseInput.checked;

  updatedOwner.invoice_transport_enabled =
    transportInput.checked;

  // Do not overwrite surcharge values when transport
  // invoicing is disabled. Preserve their saved values.
  if (!transportInput.checked) {
    updatedOwner.regional_surcharge_enabled =
      parseBool(owner.regional_surcharge_enabled, false);

    updatedOwner.fuel_surcharge_enabled =
      parseBool(owner.fuel_surcharge_enabled, false);
  }

  return updatedOwner;
}

  
async function saveSelectedOwnerProfile() {
  if (!ownerProfilesLoaded) {
    throw new Error(
      "Product owners have not been loaded successfully. Reload the page."
    );
  }

  let owner = readOwnerEditor();

  if (!owner) {
    showToast("Select a product owner first.", "err");
    return;
  }

  if (!owner.name && !owner.trading_name) {
    showToast("Product owner name is required.", "err");
    return;
  }

  // Keep the original owner key unchanged.
  const originalOwner = getSelectedOwner();

  if (!originalOwner || originalOwner.key !== owner.key) {
    throw new Error(
      "Selected product owner changed. Reload and try again."
    );
  }

  // Upload the logo if a new file was selected.
  await uploadOwnerLogoIfSelected();

  // Read again after the upload so the new logo URL
  // and storage path are included.
  owner = readOwnerEditor();

  if (!owner || owner.key !== originalOwner.key) {
    throw new Error(
      "Product owner changed during saving."
    );
  }

  const previousProfiles = ownerProfiles;

  const updatedProfiles = ownerProfiles.map(row =>
    row.key === owner.key ? owner : row
  );

  ownerProfiles = updatedProfiles;

  try {
    await saveOwnerProfiles();
  } catch (error) {
    // Restore the previous local data if saving fails.
    ownerProfiles = previousProfiles;
    throw error;
  }

  renderOwnerList();
  renderOwnerEditor();

  showToast(
    "Product owner profile and billing configuration saved.",
    "ok"
  );
}


  
async function addOwnerProfile() {
  if (!ownerProfilesLoaded) {
    throw new Error(
      "Product owners have not been loaded successfully. Reload the page."
    );
  }

  const name = getFieldValue("newOwnerName").trim();

  if (!name) {
    showToast("Enter a product owner name first.", "err");
    return;
  }

  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!key) {
    throw new Error("Invalid product owner name.");
  }

  if (ownerProfiles.some(row => row.key === key)) {
    showToast("This product owner already exists.", "err");
    return;
  }

  const displayCode = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 3);

  const newOwner = {
    key,
    name,
    trading_name: name,
    customer_code: key.toUpperCase(),
    display_code: displayCode,

    vat: "",
    address1: "",
    address2: "",
    city: "",
    postcode: "",
    country: "United Kingdom",

    logo_url: "",
    logo_storage_path: "",

    invoice_email: "",
    ack_email: "",
    pod_email: "",
    ops_email: "",

    payment_terms_days: "",
    invoice_frequency: "batch",
    default_source_name: name,

    // Independent service invoicing.
    invoice_warehouse_enabled: true,
    invoice_transport_enabled: true,

    auto_ack: false,
    auto_invoice: false,

    minimum_delivery_enabled: false,
    minimum_delivery_volume_m3: "",
    minimum_delivery_transport_tariff_per_m3: "",
    minimum_delivery_requires_approval: true,
    minimum_delivery_owner_can_approve: false,
    minimum_delivery_manual_override: false,
    minimum_delivery_invoice_label:
      "Minimum Delivery Charge",

    regional_surcharge_enabled: false,
    surcharge_edinburgh_glasgow_percent: "",
    surcharge_highlands_islands_percent: "",
    pricing_ireland_mode: "price_on_request",

    fuel_surcharge_enabled: false,
    fuel_surcharge_percent: "",

    pricing_ack_note: "",
    pricing_invoice_note: "",

    notes: ""
  };

  const previousProfiles = ownerProfiles;
  const previousSelectedKey = selectedOwnerKey;

  ownerProfiles = [...ownerProfiles, newOwner];
  selectedOwnerKey = key;

  try {
    await saveOwnerProfiles();
  } catch (error) {
    ownerProfiles = previousProfiles;
    selectedOwnerKey = previousSelectedKey;
    throw error;
  }

  setFieldValue("newOwnerName", "");

  renderOwnerList();
  renderOwnerEditor();

  showToast("Product owner added successfully.", "ok");
}


  function vehicleIsActive(vehicle) {
    if (!vehicle) return false;

    if (vehicle.use_in_planning === false) return false;
    if (vehicle.active === false) return false;
    if (vehicle.is_active === false) return false;

    if (String(vehicle.use_in_planning ?? "").toLowerCase() === "false") return false;
    if (String(vehicle.active ?? "").toLowerCase() === "false") return false;
    if (String(vehicle.is_active ?? "").toLowerCase() === "false") return false;

    return true;
  }

function updateSalesOrderPreview() {
  const prefix = getFieldValue("sales_order_prefix", "SO-") || "SO-";
  const padding = Math.max(1, Math.round(toNumber(getFieldValue("sales_order_padding", "5"), 5)));
  const nextNumber = Math.max(1, Math.round(toNumber(getFieldValue("next_sales_order_number", "1"), 1)));

  setFieldValue(
    "next_sales_order_preview",
    `${prefix}${String(nextNumber).padStart(padding, "0")}`
  );
}

function updateTenantHeader() {
  const tenantElement = byId("tenantFlowName");
  const ownersElement = byId("tenantFlowOwners");

  if (tenantElement) {
    const tenantName = [
      settingsMap.get("main_display_name"),
      settingsMap.get("main_trading_name"),
      settingsMap.get("main_company_name")
    ]
      .map(value => String(value ?? "").trim())
      .find(value => value !== "");

    tenantElement.textContent =
      tenantName || "Company name not configured";
  }

  if (ownersElement) {
    ownersElement.removeAttribute("title");

    if (!ownerProfilesLoaded) {
      ownersElement.textContent = "Product owners not loaded";
      return;
    }

    const names = ownerProfiles.map(owner =>
      String(owner.trading_name || "").trim() ||
      String(owner.name || "").trim() ||
      "Unnamed product owner"
    );

    if (!names.length) {
      ownersElement.textContent = "No product owners configured";
      return;
    }

    const maxVisible = 2;
    const visibleNames = names.slice(0, maxVisible).join(" / ");
    const remaining = names.length - maxVisible;

    ownersElement.textContent = remaining > 0
      ? `${visibleNames} (+${remaining} more)`
      : visibleNames;

    ownersElement.title =
      `${names.length} product owners. View all in the Product Owners tab.`;
  }
}

function updateSummary() {
  updateTenantHeader();

  const labour = toNumber(
    getFieldValue("labour_cost_per_hour_gbp"), 38.5
  );

  const vehicle = toNumber(
    getFieldValue("vehicle_cost_per_hour_gbp"), 8.5
  );

  const diesel = toNumber(
    getFieldValue("diesel_price_per_litre_gbp_inc_vat"), 1.55
  );

  const speed = toNumber(
    getFieldValue("average_speed_kmh"), 50
  );

  const stopTime = toNumber(
    getFieldValue("stop_time_minutes"), 15
  );

  const maxHours = toNumber(
    getFieldValue("max_route_duration_hours"), 9
  );

  const activeCount = vehiclesCache.filter(
    vehicleIsActive
  ).length;

  if (byId("summaryLabour")) {
    byId("summaryLabour").textContent =
      `${formatMoney(labour)} / hour`;
  }

  if (byId("summaryVehicle")) {
    byId("summaryVehicle").textContent =
      `${formatMoney(vehicle)} / hour`;
  }

  if (byId("summaryDiesel")) {
    byId("summaryDiesel").textContent =
      `£${diesel.toFixed(3)} / litre`;
  }

  if (byId("summarySpeed")) {
    byId("summarySpeed").textContent =
      `${formatNumber(speed, 0)} km/h`;
  }

  if (byId("summaryStopTime")) {
    const mode = getFieldValue("unloading_time_mode");

    const labels = {
      fixed: "fixed",
      orders: "+ orders",
      volume: "+ volume",
      combined: "+ orders + volume"
    };

    byId("summaryStopTime").textContent =
      `${formatNumber(stopTime, 0)} min ${labels[mode] || "fixed"}`;
  }

  if (byId("summaryMaxHours")) {
    byId("summaryMaxHours").textContent =
      `${formatNumber(maxHours, 1)} h`;
  }

  if (byId("summaryActiveVehicles")) {
    byId("summaryActiveVehicles").textContent =
      formatNumber(activeCount);
  }
}

  async function loadVehicles() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { data, error } = await db
      .from("vehicles")
      .select("*")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) {
      console.warn("Vehicles skipped:", error.message);
      vehiclesCache = [];
      renderVehicles();
      renderDriverDropdowns();
      renderDriversTable();
      updateSummary();
      return;
    }

    vehiclesCache = data || [];
    renderVehicles();
    renderDriverDropdowns();
    renderDriversTable();
    updateSummary();
  }

  function getVehicleStatusPill(vehicle) {
    return vehicleIsActive(vehicle)
      ? `<span class="pill pill-green">Visible in planner</span>`
      : `<span class="pill pill-gray">Hidden from planner</span>`;
  }

  function getVehicleDriverLabel(vehicle) {
    const driverId = vehicle.driver_user_id || vehicle.default_driver_profile_id || "";
    const name = vehicle.driver_name || getDriverNameById(driverId);
    const email = vehicle.driver_email || getDriverEmailById(driverId);

    if (name && email && normalize(name) !== normalize(email)) return `${name} · ${email}`;
    if (name) return name;
    if (email) return email;

    return "—";
  }

  function renderVehicles() {
    const mount = byId("vehicleStack");
    if (!mount) return;

    if (!vehiclesCache.length) {
      mount.innerHTML = `<div class="note-box">No vehicles found in Supabase.</div>`;
      return;
    }

    mount.innerHTML = vehiclesCache.map(vehicle => {
      const id = escapeHtml(vehicle.id);
      const active = vehicleIsActive(vehicle);
      const volume = toNumber(vehicle.capacity_m3 ?? vehicle.max_volume_m3, 0);
      const speed = toNumber(vehicle.average_speed_kmh, 50);
      const driverId = vehicle.driver_user_id || vehicle.default_driver_profile_id || "";

      return `
        <div class="vehicle-row" id="vehicleRow_${id}">
          <div class="vehicle-head">
            <div>
              <div class="vehicle-name">${escapeHtml(vehicle.name || "Unnamed vehicle")}</div>
              <div class="vehicle-sub">${escapeHtml(vehicle.vehicle_code || "—")} · ${escapeHtml(vehicle.vehicle_type || "vehicle")} · ${escapeHtml(vehicle.registration || "—")}</div>
            </div>

            <div>
              <div class="vehicle-label">Planner</div>
              <div class="vehicle-value">
                <input type="checkbox" data-action="planner-checkbox" data-id="${id}" ${active ? "checked" : ""}> Use
              </div>
            </div>

            <div><div class="vehicle-label">Driver</div><div class="vehicle-value">${escapeHtml(getVehicleDriverLabel(vehicle))}</div></div>
            <div><div class="vehicle-label">Type</div><div class="vehicle-value">${escapeHtml(vehicle.vehicle_type || "vehicle")}</div></div>
            <div><div class="vehicle-label">Volume</div><div class="vehicle-value">${formatNumber(volume, 1)} m³</div></div>
            <div><div class="vehicle-label">Stops</div><div class="vehicle-value">${formatNumber(vehicle.max_stops || 0)}</div></div>
            <div><div class="vehicle-label">Hours</div><div class="vehicle-value">${formatNumber(vehicle.max_route_hours || 0, 1)} h</div></div>
            <div><div class="vehicle-label">Speed</div><div class="vehicle-value">${formatNumber(speed, 0)} km/h</div></div>
            <div><div class="vehicle-label">Status</div><div class="vehicle-value">${getVehicleStatusPill(vehicle)}</div></div>
            <div><button class="mini-btn" type="button" data-action="open-vehicle" data-id="${id}">Open</button></div>
          </div>

          <div class="vehicle-body" id="vehicleBody_${id}">
            <div class="vehicle-grid">
              <div class="field"><label>Name</label><input class="input" data-field="name" value="${escapeHtml(vehicle.name || "")}"></div>
              <div class="field"><label>Code</label><input class="input" data-field="vehicle_code" value="${escapeHtml(vehicle.vehicle_code || "")}"></div>
              <div class="field"><label>Type</label><input class="input" data-field="vehicle_type" value="${escapeHtml(vehicle.vehicle_type || "")}"></div>
              <div class="field"><label>Registration</label><input class="input" data-field="registration" value="${escapeHtml(vehicle.registration || "")}"></div>

              <div class="field">
                <label>Driver Account</label>
                <select class="select" data-field="driver_user_id">${driverOptionsHtml(driverId)}</select>
              </div>

              <div class="field">
                <label>Driver Email</label>
                <input class="input" data-field="driver_email" value="${escapeHtml(vehicle.driver_email || getDriverEmailById(driverId) || "")}" placeholder="driver@email.com">
              </div>

              <div class="field">
                <label>Driver Name</label>
                <input class="input" data-field="driver_name" value="${escapeHtml(vehicle.driver_name || getDriverNameById(driverId) || "")}" placeholder="Driver name">
              </div>

              <div class="field"><label>Max Volume</label><input class="input" type="number" step="0.1" data-field="capacity_m3" value="${escapeHtml(volume)}"></div>
              <div class="field"><label>Max Stops</label><input class="input" type="number" step="1" data-field="max_stops" value="${escapeHtml(toNumber(vehicle.max_stops, 12))}"></div>
              <div class="field"><label>Max Hours</label><input class="input" type="number" step="0.1" data-field="max_route_hours" value="${escapeHtml(toNumber(vehicle.max_route_hours, 9))}"></div>
              <div class="field"><label>Average Speed</label><input class="input" type="number" step="0.1" data-field="average_speed_kmh" value="${escapeHtml(speed)}"></div>
<div class="field">
  <label>Vehicle Cost / Hour</label>
  <input class="input" type="number" step="0.01"
         data-field="cost_per_hour_gbp"
         value="${escapeHtml(toNumber(vehicle.cost_per_hour_gbp, 8.5))}">
</div>
<div class="field">
  <label>Fuel Usage (L / 100 km)</label>
  <input
    class="input"
    type="number"
    step="0.1"
    data-field="fuel_litres_per_100km"
    value="${escapeHtml(toNumber(vehicle.fuel_litres_per_100km, 10.0))}"
  >
</div>
              <div class="field"><label>Labour / Hour</label><input class="input" type="number" step="0.01" data-field="labour_cost_per_hour_gbp" value="${escapeHtml(toNumber(vehicle.labour_cost_per_hour_gbp, 38.5))}"></div>

              <div class="field">
                <label>Use in Planner</label>
                <select class="select" data-field="active">
                  <option value="true" ${active ? "selected" : ""}>true</option>
                  <option value="false" ${!active ? "selected" : ""}>false</option>
                </select>
              </div>
            </div>

            <div class="actions-row">
              <button class="btn btn-primary" type="button" data-action="save-vehicle" data-id="${id}">Save Vehicle</button>
              <button class="btn" type="button" data-action="close-vehicle" data-id="${id}">Close</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function readVehiclePayload(id) {
    const row = byId(`vehicleRow_${id}`);
    if (!row) return null;

    const read = field => String(row.querySelector(`[data-field="${field}"]`)?.value || "").trim();

    const volume = toNumber(read("capacity_m3"), 0);
    const active = parseBool(read("active"), true);
    const driverUserId = read("driver_user_id") || "";
    const driverEmail = read("driver_email") || getDriverEmailById(driverUserId) || "";
    const driverName = read("driver_name") || getDriverNameById(driverUserId) || "";

    return {
      id,
      name: read("name"),
      vehicle_code: read("vehicle_code"),
      vehicle_type: read("vehicle_type") || "van",
      registration: read("registration"),

      driver_user_id: driverUserId || null,
      default_driver_profile_id: driverUserId || null,
      driver_email: driverEmail || null,
      default_driver_email: driverEmail || null,
      driver_name: driverName || null,
      default_driver_name: driverName || null,

      capacity_m3: volume,
max_volume_m3: volume,
max_stops: toNumber(read("max_stops"), 12),
max_route_hours: toNumber(read("max_route_hours"), 9),

average_speed_kmh: toNumber(read("average_speed_kmh"), 50),

cost_per_hour_gbp: toNumber(read("cost_per_hour_gbp"), 8.5),

fuel_litres_per_100km: toNumber(
  read("fuel_litres_per_100km"),
  10
),

labour_cost_per_hour_gbp: toNumber(
  read("labour_cost_per_hour_gbp"),
  38.5
),

active,
is_active: active,
use_in_planning: active
    };
  }

  async function saveVehicle(id) {
    const db = ensureClient();
    const cid = await getCompanyId();
    const payload = readVehiclePayload(id);

    if (!payload?.name) throw new Error("Vehicle name is required.");

    const { error } = await db
      .from("vehicles")
      .upsert({ ...payload, company_id: cid });

    if (error) throw error;

    await loadVehicles();
    await loadDriverUsers();

    showToast("Vehicle saved.", "ok");
  }

  async function setVehicleActive(id, active) {
    const db = ensureClient();
    const cid = await getCompanyId();

    const { error } = await db
      .from("vehicles")
      .update({ active, is_active: active, use_in_planning: active })
      .eq("company_id", cid)
      .eq("id", id);

    if (error) throw error;

    await loadVehicles();

    showToast(active ? "Vehicle visible in planner." : "Vehicle hidden from planner.", "ok");
  }

  async function addVehicle() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const volume = toNumber(getFieldValue("newVehicleMaxVolume"), 0);
    const newDriverUserId = getFieldValue("newVehicleDriverUserId", "");
    const newDriverEmail = getFieldValue("newVehicleDriverEmail", "") || getDriverEmailById(newDriverUserId);
    const newDriverName = getDriverNameById(newDriverUserId);

    const payload = {
      company_id: cid,
      name: getFieldValue("newVehicleName"),
      vehicle_code: getFieldValue("newVehicleCode"),
vehicle_type: getFieldValue("newVehicleType", "van"),
registration: getFieldValue("newVehicleRegistration"),

      driver_user_id: newDriverUserId || null,
      default_driver_profile_id: newDriverUserId || null,
      driver_email: newDriverEmail || null,
      default_driver_email: newDriverEmail || null,
      driver_name: newDriverName || null,
      default_driver_name: newDriverName || null,

      capacity_m3: volume,
      max_volume_m3: volume,
      max_stops: toNumber(getFieldValue("newVehicleMaxStops"), 12),
      max_route_hours: toNumber(getFieldValue("newVehicleMaxHours"), 9),
      average_speed_kmh: toNumber(getFieldValue("newVehicleAverageSpeed"), 50),
	cost_per_hour_gbp: toNumber(getFieldValue("newVehicleCostPerHour"), 8.5),
	fuel_litres_per_100km: toNumber(getFieldValue("newVehicleFuelLitresPer100km"), 10),
	labour_cost_per_hour_gbp: toNumber(getFieldValue("newVehicleLabourPerHour"), 38.5),

      active: true,
      is_active: true,
      use_in_planning: true
    };

    if (!payload.name) throw new Error("Vehicle name is required.");

    const { error } = await db.from("vehicles").insert(payload);
    if (error) throw error;

   [
  "newVehicleName",
  "newVehicleCode",
  "newVehicleRegistration",
  "newVehicleDriverUserId",
  "newVehicleDriverEmail",
  "newVehicleMaxVolume",
  "newVehicleMaxStops",
  "newVehicleMaxHours",
  "newVehicleAverageSpeed",
  "newVehicleCostPerHour",
  "newVehicleFuelLitresPer100km",
  "newVehicleLabourPerHour"
].forEach(fieldId => setFieldValue(fieldId, ""));

    setFieldValue("newVehicleType", "van");

    await loadVehicles();
    await loadDriverUsers();

    showToast("Vehicle added.", "ok");
  }

  function openVehicle(id) {
    byId(`vehicleBody_${id}`)?.classList.add("open");
  }

  function closeVehicle(id) {
    byId(`vehicleBody_${id}`)?.classList.remove("open");
  }
/* =========================================================
   RETAILERS / DELIVERY SHOPS
   ========================================================= */

function normalizeRetailerPostcode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeRetailerName(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

function makeRetailerCode(postcode, retailerName) {
  const postcodePart =
    normalizeRetailerPostcode(postcode) ||
    "NOPC";

  const namePart =
    normalizeRetailerName(retailerName)
      .slice(0, 3) ||
    "RET";

  return `${postcodePart}-${namePart}`;
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function extractEmailFromText(value) {
  const match = String(value || "").match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  return match
    ? match[0]
    : "";
}

function extractPhoneFromText(value) {
  const match = String(value || "").match(
    /(?:\+?\d[\d\s().-]{7,}\d)/
  );

  if (!match) {
    return "";
  }

  const digits = match[0]
    .replace(/\D/g, "");

  return digits.length >= 9
    ? match[0].trim()
    : "";
}

function retailerIsVerified(row) {
  return (
    row?.details_verified === true ||
    String(
      row?.details_verified ?? ""
    ).toLowerCase() === "true"
  );
}

function makeRetailerMapKey(
  customerId,
  retailerCode
) {
  return [
    String(customerId || ""),
    String(retailerCode || "")
      .trim()
      .toUpperCase()
  ].join("|");
}

function retailerStatusHtml(row) {
  if (retailerIsVerified(row)) {
    return `
      <span class="pill pill-green">
        ✓ Verified
      </span>

      <span class="subline">
        ${escapeHtml(
          formatDateTime(
            row.verified_at
          )
        )}
      </span>
    `;
  }

  return `
    <span class="pill pill-gray">
      Not verified
    </span>
  `;
}

async function loadRetailerOrderSuggestions() {
  const db = ensureClient();
  const cid = await getCompanyId();

  const { data, error } = await db
    .from("orders")
    .select(`
      id,
      company_id,
      customer_id,
      order_number,
      retail_name,
      delivery_city,
      delivery_postcode,
      notes,
      memo,
      last_activity_at,
      created_at,
      customers (
        id,
        name,
        customer_code
      )
    `)
    .eq("company_id", cid)
    .order("created_at", {
      ascending: false
    })
    .limit(3000);

  if (error) {
    throw error;
  }

  const map = new Map();

  (data || []).forEach(order => {
    const retailerName = String(
      order.retail_name || ""
    ).trim();

    const postcode = String(
      order.delivery_postcode || ""
    ).trim();

    const customerId =
      order.customer_id || null;

    if (
      !retailerName ||
      !postcode ||
      !customerId
    ) {
      return;
    }

    const retailerCode =
      makeRetailerCode(
        postcode,
        retailerName
      );

    const key =
      makeRetailerMapKey(
        customerId,
        retailerCode
      );

    const combinedText = [
      order.notes,
      order.memo
    ]
      .filter(Boolean)
      .join(" ");

    const email =
      extractEmailFromText(
        combinedText
      );

    const phone =
      extractPhoneFromText(
        combinedText
      );

    const lastActivity =
      order.last_activity_at ||
      order.created_at ||
      "";

    if (!map.has(key)) {
      map.set(key, {
        id: null,

        company_id: cid,
        customer_id: customerId,

        retailer_code:
          retailerCode,

        retailer_name:
          retailerName,

        address_1: "",
        address_2: "",
        address_3: "",
        address_4: "",

        city:
          order.delivery_city || "",

        postcode,

        country:
          "United Kingdom",

        delivery_email:
          email,

        delivery_phone:
          phone,

        contact_name: "",

        delivery_instructions: "",

        booking_required: false,
        booking_lead_days: 0,

        details_verified: false,
        is_locked: false,
        verified_at: null,

        owner_name:
          order.customers?.name ||
          "—",

        owner_code:
          order.customers
            ?.customer_code ||
          "",

        orders: 0,

        last_activity_at:
          lastActivity,

        source:
          "order"
      });
    }

    const row = map.get(key);

    row.orders += 1;

    const currentTime =
      new Date(
        row.last_activity_at || 0
      ).getTime();

    const nextTime =
      new Date(
        lastActivity || 0
      ).getTime();

    if (nextTime > currentTime) {
      row.last_activity_at =
        lastActivity;
    }

    if (!row.city) {
      row.city =
        order.delivery_city || "";
    }

    if (!row.delivery_email) {
      row.delivery_email =
        email;
    }

    if (!row.delivery_phone) {
      row.delivery_phone =
        phone;
    }
  });

  return [...map.values()];
}

async function loadRetailerMasterRows() {
  const db = ensureClient();
  const cid = await getCompanyId();

  const { data, error } = await db
    .from("retailer_locations")
    .select(`
      id,
      company_id,
      customer_id,

      retailer_code,
      retailer_name,

      address_1,
      address_2,
      address_3,
      address_4,
      city,
      postcode,
      country,

      delivery_email,
      delivery_phone,
      contact_name,

      delivery_instructions,
      booking_required,
      booking_lead_days,

      details_verified,
      verified_at,
      verified_by,
      is_locked,

      created_at,
      updated_at,

      customers (
        id,
        name,
        customer_code
      )
    `)
    .eq("company_id", cid)
    .order("retailer_name", {
      ascending: true
    });

  if (error) {
    throw error;
  }

  return (data || []).map(row => ({
    ...row,

    owner_name:
      row.customers?.name ||
      "—",

    owner_code:
      row.customers
        ?.customer_code ||
      "",

    orders:
      0,

    last_activity_at:
      row.updated_at ||
      row.created_at ||
      "",

    source:
      "master"
  }));
}

function mergeRetailerRows(
  masterRows,
  suggestionRows
) {
  const map = new Map();

  /*
   * Eerst de opgeslagen masterdata.
   * Deze is altijd leidend.
   */
  (masterRows || []).forEach(row => {
    const retailerCode =
      String(
        row.retailer_code ||
        makeRetailerCode(
          row.postcode,
          row.retailer_name
        )
      )
        .trim()
        .toUpperCase();

    const key =
      makeRetailerMapKey(
        row.customer_id,
        retailerCode
      );

    const existing =
      map.get(key);

    /*
     * Mocht er ondanks de databasebeveiliging
     * toch een dubbele masterregel bestaan,
     * dan wint de geverifieerde regel.
     */
    if (
      existing &&
      retailerIsVerified(existing) &&
      !retailerIsVerified(row)
    ) {
      return;
    }

    map.set(key, {
      ...row,
      retailer_code:
        retailerCode
    });
  });

  /*
   * Daarna ordergegevens toevoegen.
   */
  (suggestionRows || []).forEach(
    suggestion => {
      const key =
        makeRetailerMapKey(
          suggestion.customer_id,
          suggestion.retailer_code
        );

      const existing =
        map.get(key);

      if (!existing) {
        map.set(key, {
          ...suggestion
        });

        return;
      }

      /*
       * Aantallen en laatste activiteit
       * mogen altijd bijgewerkt worden.
       */
      existing.orders =
        Number(
          existing.orders || 0
        ) +
        Number(
          suggestion.orders || 0
        );

      const existingTime =
        new Date(
          existing.last_activity_at || 0
        ).getTime();

      const suggestionTime =
        new Date(
          suggestion.last_activity_at || 0
        ).getTime();

      if (
        suggestionTime >
        existingTime
      ) {
        existing.last_activity_at =
          suggestion.last_activity_at;
      }

      /*
       * Een geverifieerde retailer mag nooit
       * worden overschreven door orderdata.
       */
      if (
        retailerIsVerified(existing)
      ) {
        return;
      }

      /*
       * Niet-geverifieerde masterdata alleen
       * aanvullen wanneer een veld leeg is.
       */
      [
        "retailer_name",
        "address_1",
        "address_2",
        "address_3",
        "address_4",
        "city",
        "postcode",
        "country",
        "delivery_email",
        "delivery_phone",
        "contact_name",
        "owner_name",
        "owner_code"
      ].forEach(field => {
        if (!existing[field]) {
          existing[field] =
            suggestion[field] ||
            "";
        }
      });
    }
  );

  return [...map.values()]
    .sort((a, b) => {
      return String(
        a.retailer_name || ""
      ).localeCompare(
        String(
          b.retailer_name || ""
        ),
        "en",
        {
          numeric: true,
          sensitivity: "base"
        }
      );
    });
}

function retailerInputHtml({
  key,
  field,
  value,
  type = "text",
  placeholder = "",
  verified = false
}) {
  return `
    <input
      class="input retailer-field"
      type="${escapeHtml(type)}"
      data-retailer-key="${escapeHtml(key)}"
      data-retailer-field="${escapeHtml(field)}"
      value="${escapeHtml(value ?? "")}"
      placeholder="${escapeHtml(placeholder)}"
      ${verified ? "disabled" : ""}
      style="
        min-width:130px;
        padding:7px 9px;
        min-height:32px;
      "
    >
  `;
}

function getRetailerFieldValue(
  retailerKey,
  field
) {
  const input =
    document.querySelector(
      `[data-retailer-key="${CSS.escape(
        retailerKey
      )}"][data-retailer-field="${CSS.escape(
        field
      )}"]`
    );

  if (!input) {
    return "";
  }

  if (input.type === "checkbox") {
    return input.checked;
  }

  return String(
    input.value || ""
  ).trim();
}

function updateRetailerCodePreview(
  retailerKey
) {
  const retailerName =
    getRetailerFieldValue(
      retailerKey,
      "retailer_name"
    );

  const postcode =
    getRetailerFieldValue(
      retailerKey,
      "postcode"
    );

  const code =
    makeRetailerCode(
      postcode,
      retailerName
    );

  const codeElement =
    document.querySelector(
      `[data-retailer-code-preview="${CSS.escape(
        retailerKey
      )}"]`
    );

  if (codeElement) {
    codeElement.textContent =
      code;
  }
}

async function saveRetailerRow(
  retailerKey,
  verify = false
) {
  const db = ensureClient();
  const cid = await getCompanyId();

  const rowElement =
    document.querySelector(
      `[data-retailer-row="${CSS.escape(
        retailerKey
      )}"]`
    );

  if (!rowElement) {
    throw new Error(
      "Retailer row could not be found."
    );
  }

  const customerId =
    rowElement.dataset.customerId ||
    "";

  const existingId =
    rowElement.dataset.retailerId ||
    "";

  const retailerName =
    getRetailerFieldValue(
      retailerKey,
      "retailer_name"
    );

  const postcode =
    getRetailerFieldValue(
      retailerKey,
      "postcode"
    );

  if (!customerId) {
    throw new Error(
      "Product owner is missing."
    );
  }

  if (!retailerName) {
    throw new Error(
      "Retailer name is required."
    );
  }

  if (!postcode) {
    throw new Error(
      "Postcode is required."
    );
  }

  const retailerCode =
    makeRetailerCode(
      postcode,
      retailerName
    );

  /*
   * Controleren of er al een geverifieerde
   * retailer met deze code bestaat.
   */
  const {
    data: verifiedExisting,
    error: verifiedCheckError
  } = await db
    .from("retailer_locations")
    .select(`
      id,
      retailer_name,
      details_verified
    `)
    .eq("company_id", cid)
    .eq(
      "customer_id",
      customerId
    )
    .eq(
      "retailer_code",
      retailerCode
    )
    .eq(
      "details_verified",
      true
    )
    .maybeSingle();

  if (verifiedCheckError) {
    throw verifiedCheckError;
  }

  if (
    verifiedExisting?.id &&
    String(
      verifiedExisting.id
    ) !== String(
      existingId || ""
    )
  ) {
    throw new Error(
      `Retailer ${retailerCode} has already been verified and cannot be added again.`
    );
  }

  let verifiedBy = null;

  if (verify) {
    const {
      data: authData
    } = await db.auth.getUser();

    verifiedBy =
      authData?.user?.id ||
      null;
  }

  const payload = {
    company_id:
      cid,

    customer_id:
      customerId,

    retailer_code:
      retailerCode,

    retailer_name:
      retailerName,

    address_1:
      getRetailerFieldValue(
        retailerKey,
        "address_1"
      ),

    address_2:
      getRetailerFieldValue(
        retailerKey,
        "address_2"
      ),

    address_3:
      getRetailerFieldValue(
        retailerKey,
        "address_3"
      ),

    address_4:
      getRetailerFieldValue(
        retailerKey,
        "address_4"
      ),

    city:
      getRetailerFieldValue(
        retailerKey,
        "city"
      ),

    postcode,

    country:
      getRetailerFieldValue(
        retailerKey,
        "country"
      ) ||
      "United Kingdom",

    delivery_email:
      getRetailerFieldValue(
        retailerKey,
        "delivery_email"
      ) ||
      null,

    delivery_phone:
      getRetailerFieldValue(
        retailerKey,
        "delivery_phone"
      ) ||
      null,

    contact_name:
      getRetailerFieldValue(
        retailerKey,
        "contact_name"
      ) ||
      null,

    delivery_instructions:
      getRetailerFieldValue(
        retailerKey,
        "delivery_instructions"
      ) ||
      null,

    booking_required:
      getRetailerFieldValue(
        retailerKey,
        "booking_required"
      ) === true,

    booking_lead_days:
      Math.max(
        0,
        Math.round(
          toNumber(
            getRetailerFieldValue(
              retailerKey,
              "booking_lead_days"
            ),
            0
          )
        )
      ),

    details_verified:
      verify,

    is_locked:
      verify,

    verified_at:
      verify
        ? new Date()
            .toISOString()
        : null,

    verified_by:
      verify
        ? verifiedBy
        : null,

    updated_at:
      new Date()
        .toISOString()
  };

  let savedRow = null;

  if (existingId) {
    const {
      data,
      error
    } = await db
      .from("retailer_locations")
      .update(payload)
      .eq("id", existingId)
      .eq("company_id", cid)
      .select(`
        id,
        retailer_code
      `)
      .single();

    if (error) {
      throw error;
    }

    savedRow = data;
  } else {
    const {
      data,
      error
    } = await db
      .from("retailer_locations")
      .upsert(
        {
          ...payload,
          created_at:
            new Date()
              .toISOString()
        },
        {
          onConflict:
            "company_id,customer_id,retailer_code"
        }
      )
      .select(`
        id,
        retailer_code
      `)
      .single();

    if (error) {
      throw error;
    }

    savedRow = data;
  }

  /*
   * Bij verificatie alle eventuele dubbele
   * niet-geverifieerde masterrecords verwijderen.
   */
  if (
    verify &&
    savedRow?.id
  ) {
    const {
      error: deleteError
    } = await db
      .from("retailer_locations")
      .delete()
      .eq("company_id", cid)
      .eq(
        "customer_id",
        customerId
      )
      .eq(
        "retailer_code",
        retailerCode
      )
      .neq(
        "id",
        savedRow.id
      )
      .eq(
        "details_verified",
        false
      );

    if (deleteError) {
      throw deleteError;
    }
  }

  showToast(
    verify
      ? `Retailer ${retailerCode} verified and locked.`
      : `Retailer ${retailerCode} saved.`,
    "ok"
  );

  await loadShops();
}

function renderRetailerRows(rows) {
  const tbody = byId("shopsBody");

  if (!tbody) {
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12">
          No retailers found yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map((row, index) => {
    const verified = retailerIsVerified(row);

    const retailerCode = String(
      row.retailer_code ||
      makeRetailerCode(
        row.postcode,
        row.retailer_name
      )
    )
      .trim()
      .toUpperCase();

    const retailerKey = makeRetailerMapKey(
      row.customer_id,
      retailerCode
    );

    return `
      <tr
        data-retailer-row="${escapeHtml(retailerKey)}"
        data-retailer-id="${escapeHtml(row.id || "")}"
        data-customer-id="${escapeHtml(row.customer_id || "")}"
        data-editing="false"
      >
        <td>
          ${formatNumber(index + 1)}
        </td>

        <td>
          <strong data-retailer-code-preview="${escapeHtml(retailerKey)}">
            ${escapeHtml(retailerCode)}
          </strong>

          <span class="subline">
            Postcode + first 3 letters
          </span>
        </td>

        <td>
          <span data-retailer-display="retailer_name">
            ${escapeHtml(row.retailer_name || "Unknown retailer")}
          </span>

          <input
            class="input retailer-edit-field"
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="retailer_name"
            value="${escapeHtml(row.retailer_name || "")}"
            style="display:none; min-width:180px;"
          >
        </td>

        <td>
          <strong>
            ${escapeHtml(row.owner_name || "—")}
          </strong>

          <span class="subline">
            ${escapeHtml(row.owner_code || "")}
          </span>
        </td>

        <td>
          <span data-retailer-display="city">
            ${escapeHtml(row.city || "—")}
          </span>

          <input
            class="input retailer-edit-field"
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="city"
            value="${escapeHtml(row.city || "")}"
            style="display:none; min-width:150px;"
          >
        </td>

        <td>
          <span data-retailer-display="postcode">
            ${escapeHtml(row.postcode || "—")}
          </span>

          <input
            class="input retailer-edit-field"
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="postcode"
            value="${escapeHtml(row.postcode || "")}"
            style="display:none; min-width:110px;"
          >
        </td>

        <td>
          <span data-retailer-display="delivery_email">
            ${escapeHtml(row.delivery_email || "—")}
          </span>

          <input
            class="input retailer-edit-field"
            type="email"
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="delivery_email"
            value="${escapeHtml(row.delivery_email || "")}"
            style="display:none; min-width:190px;"
          >
        </td>

        <td>
          <span data-retailer-display="delivery_phone">
            ${escapeHtml(row.delivery_phone || "—")}
          </span>

          <input
            class="input retailer-edit-field"
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="delivery_phone"
            value="${escapeHtml(row.delivery_phone || "")}"
            style="display:none; min-width:135px;"
          >
        </td>

        <td>
          ${formatNumber(row.orders || 0)}
        </td>

        <td>
          ${escapeHtml(
            formatDateTime(row.last_activity_at)
          )}
        </td>

        <td>
          ${retailerStatusHtml(row)}
        </td>

        <td>
          ${
            verified
              ? `
                <span class="pill pill-green">
                  🔒 Locked
                </span>
              `
              : `
                <div
                  data-retailer-view-actions
                  style="
                    display:flex;
                    gap:6px;
                    flex-wrap:nowrap;
                  "
                >
                  <button
                    class="mini-btn"
                    type="button"
                    data-retailer-action="edit"
                    data-retailer-key="${escapeHtml(retailerKey)}"
                  >
                    Edit
                  </button>

                  <button
                    class="mini-btn primary"
                    type="button"
                    data-retailer-action="verify"
                    data-retailer-key="${escapeHtml(retailerKey)}"
                  >
                    ✓ Verify
                  </button>
                </div>

                <div
                  data-retailer-edit-actions
                  style="
                    display:none;
                    gap:6px;
                    flex-wrap:nowrap;
                  "
                >
                  <button
                    class="mini-btn primary"
                    type="button"
                    data-retailer-action="save"
                    data-retailer-key="${escapeHtml(retailerKey)}"
                  >
                    Save
                  </button>

                  <button
                    class="mini-btn"
                    type="button"
                    data-retailer-action="cancel"
                    data-retailer-key="${escapeHtml(retailerKey)}"
                  >
                    Cancel
                  </button>
                </div>
              `
          }
        </td>

        <td style="display:none;">
          <input
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="address_1"
            value="${escapeHtml(row.address_1 || "")}"
          >

          <input
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="address_2"
            value="${escapeHtml(row.address_2 || "")}"
          >

          <input
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="address_3"
            value="${escapeHtml(row.address_3 || "")}"
          >

          <input
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="address_4"
            value="${escapeHtml(row.address_4 || "")}"
          >

          <input
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="country"
            value="${escapeHtml(row.country || "United Kingdom")}"
          >

          <input
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="contact_name"
            value="${escapeHtml(row.contact_name || "")}"
          >

          <input
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="delivery_instructions"
            value="${escapeHtml(row.delivery_instructions || "")}"
          >

          <input
            type="number"
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="booking_lead_days"
            value="${escapeHtml(row.booking_lead_days || 0)}"
          >

          <input
            type="checkbox"
            data-retailer-key="${escapeHtml(retailerKey)}"
            data-retailer-field="booking_required"
            ${row.booking_required ? "checked" : ""}
          >
        </td>
      </tr>
    `;
  }).join("");
}

function bindRetailerTableEvents() {
  const tbody = byId("shopsBody");

  if (
    !tbody ||
    tbody.dataset.retailerEventsBound === "1"
  ) {
    return;
  }

  tbody.dataset.retailerEventsBound = "1";

  function setRetailerEditMode(
    retailerKey,
    editing
  ) {
    const row = document.querySelector(
      `[data-retailer-row="${CSS.escape(retailerKey)}"]`
    );

    if (!row) {
      return;
    }

    row.dataset.editing =
      editing ? "true" : "false";

    row
      .querySelectorAll(
        "[data-retailer-display]"
      )
      .forEach(element => {
        element.style.display =
          editing ? "none" : "";
      });

    row
      .querySelectorAll(
        ".retailer-edit-field"
      )
      .forEach(input => {
        input.style.display =
          editing ? "" : "none";
      });

    const viewActions =
      row.querySelector(
        "[data-retailer-view-actions]"
      );

    const editActions =
      row.querySelector(
        "[data-retailer-edit-actions]"
      );

    if (viewActions) {
      viewActions.style.display =
        editing ? "none" : "flex";
    }

    if (editActions) {
      editActions.style.display =
        editing ? "flex" : "none";
    }

    if (editing) {
      row
        .querySelector(
          '[data-retailer-field="retailer_name"]'
        )
        ?.focus();
    }
  }

  tbody.addEventListener(
    "input",
    event => {
      const input = event.target.closest(
        "[data-retailer-field]"
      );

      if (!input) {
        return;
      }

      if (
        ![
          "retailer_name",
          "postcode"
        ].includes(
          input.dataset.retailerField
        )
      ) {
        return;
      }

      updateRetailerCodePreview(
        input.dataset.retailerKey
      );
    }
  );

  tbody.addEventListener(
    "click",
    async event => {
      const button = event.target.closest(
        "[data-retailer-action]"
      );

      if (!button) {
        return;
      }

      const action =
        button.dataset.retailerAction;

      const retailerKey =
        button.dataset.retailerKey;

      if (action === "edit") {
        setRetailerEditMode(
          retailerKey,
          true
        );
        return;
      }

      if (action === "cancel") {
        await loadShops();
        return;
      }

      button.disabled = true;

      try {
        if (action === "save") {
          await saveRetailerRow(
            retailerKey,
            false
          );
        }

        if (action === "verify") {
          const confirmed =
            window.confirm(
              "Verify and permanently lock this retailer information?\n\n" +
              "Any duplicate retailer with the same retailer code will disappear."
            );

          if (!confirmed) {
            return;
          }

          await saveRetailerRow(
            retailerKey,
            true
          );
        }
      } catch (error) {
        console.error(error);

        showToast(
          error.message ||
          "Retailer action failed.",
          "err"
        );
      } finally {
        button.disabled = false;
      }
    }
  );
}

function prepareRetailerTableHeader() {
  const table =
    byId("shopsBody")
      ?.closest("table");

  const headerRow =
    table?.querySelector(
      "thead tr"
    );

  if (!headerRow) {
    return;
  }

  headerRow.innerHTML = `
    <th></th>
    <th>Retailer Code</th>
    <th>Retailer / Shop</th>
    <th>Linked Product Owner</th>
    <th>City</th>
    <th>Postcode</th>
    <th>Email</th>
    <th>Phone</th>
    <th>Orders</th>
    <th>Last Activity</th>
    <th>Status</th>
    <th>Actions</th>
  `;
}

async function loadShops() {
  const tbody =
    byId("shopsBody");

  if (!tbody) {
    return;
  }

  prepareRetailerTableHeader();
  bindRetailerTableEvents();

  tbody.innerHTML = `
    <tr>
      <td colspan="12">
        Loading retailers...
      </td>
    </tr>
  `;

  try {
    const [
      masterRows,
      suggestionRows
    ] = await Promise.all([
      loadRetailerMasterRows(),
      loadRetailerOrderSuggestions()
    ]);

    const rows =
      mergeRetailerRows(
        masterRows,
        suggestionRows
      );

    renderRetailerRows(rows);
  } catch (error) {
    console.error(error);

    tbody.innerHTML = `
      <tr>
        <td colspan="12">
          Could not load retailers:
          ${escapeHtml(
            error.message ||
            "Unknown error"
          )}
        </td>
      </tr>
    `;
  }
}

  function bindTabs() {
    document.querySelectorAll("[data-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");

        document.querySelectorAll("[data-tab]").forEach(button => {
          button.classList.toggle("active", button === btn);
        });

        document.querySelectorAll(".settings-panel").forEach(panel => {
          panel.classList.toggle("active", panel.id === `tab-${tab}`);
        });

        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }


// ================================================
// VEYNOR - EMISSION ZONE SETTINGS
// ================================================

let emissionZonesCache = [];

const EMISSION_PREF_KEY =
  "emission_zone_preferences";

function readEmissionPreferences() {
  const raw = settingsMap.get(EMISSION_PREF_KEY);

  if (!raw) return {};

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Invalid saved emission-zone preferences."
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Invalid emission-zone preference format."
    );
  }

  return parsed;
}

// Load zones from the central Supabase database


async function loadEmissionZones() {
  const mount = byId("emissionZoneList");
  const status = byId("emissionZoneStatus");

  if (!mount) return;

  if (status) status.textContent = "Loading emission zones...";

  const { data, error } = await ensureClient()
    .from("emission_zones")
    .select("zone_code, zone_name, status")
    .order("zone_name");

  if (error) {
    emissionZonesCache = [];
    mount.replaceChildren();

    if (status) {
      status.textContent = `Cannot load zones: ${error.message}`;
    }
    return;
  }

  emissionZonesCache = data || [];
  const preferences = readEmissionPreferences();

  const imageFiles = {
    BATH_CAZ: "bath-caz.png",
    BIRMINGHAM_CAZ: "birmingham-caz.png",
    BRADFORD_CAZ: "bradford-caz.png",
    BRISTOL_CAZ: "bristol-caz.png",
    NEWCASTLE_CAZ: "newcastle-caz.png",
    OXFORD_ZEZ: "oxford-zez.png",
    PORTSMOUTH_CAZ: "portsmouth-caz.png",
    SHEFFIELD_CAZ: "sheffield-caz.png"
  };

  const londonCodes = [
    "LONDON_CONGESTION",
    "LONDON_LEZ",
    "LONDON_ULEZ"
  ];

  const londonZones = londonCodes
    .map(code => emissionZonesCache.find(z => z.zone_code === code))
    .filter(Boolean);

  const otherZones = emissionZonesCache.filter(
    zone => !londonCodes.includes(zone.zone_code)
  );

  // Keep unsaved checkbox changes when refreshing the list.
  const currentInputs = mount.querySelectorAll(
    "[data-emission-zone]"
  );

  currentInputs.forEach(input => {
    if (!input.disabled) {
      preferences[input.dataset.emissionZone] = input.checked;
    }
  });

  function renderOption(zone) {
    const active = zone.status === "active";
    const enabled = preferences[zone.zone_code] !== false;

    return `
      <label class="emission-zone-option">
        <span>
          <strong>${escapeHtml(zone.zone_name)}</strong>
          <span class="transport-zone-description"
                style="display:block">
            ${escapeHtml(zone.zone_code)}
          </span>
          <span class="subline">
            ${active ? "Active zone" : escapeHtml(zone.status)}
          </span>
        </span>

        <span style="white-space:nowrap">
          <input
            type="checkbox"
            data-emission-zone="${escapeHtml(zone.zone_code)}"
            ${enabled && active ? "checked" : ""}
            ${!active ? "disabled" : ""}
          >
          Alerts
        </span>
      </label>
    `;
  }

  function renderAccordion(title, zones, imageFile, groupKey) {
    const imagePath = imageFile
      ? `/assets/emission-zones/${imageFile}`
      : "";

    const activeCount = zones.filter(
      zone => zone.status === "active"
    ).length;

    const enabledCount = zones.filter(
      zone => zone.status === "active" &&
        preferences[zone.zone_code] !== false
    ).length;

    const isLondon = groupKey === "london";
    const icon = isLondon ? "◆" : "◉";

    return `
      <details
        class="emission-zone-accordion"
        data-emission-group="${escapeHtml(groupKey)}"
      >
        <summary>
          <div class="emission-header-main">
            <span class="emission-header-icon">${icon}</span>

            <span class="emission-header-text">
              <strong>${escapeHtml(title)}</strong>
              <small>
                ${isLondon
                  ? "ULEZ · LEZ · Congestion Charge"
                  : escapeHtml(zones[0].zone_code)}
              </small>
            </span>
          </div>

          <div class="emission-header-meta">
            <span class="emission-status-pill">
              ${activeCount} active
            </span>

            <span
              class="emission-alert-count"
              data-alert-count
            >
              ${enabledCount}/${activeCount} alerts
            </span>

            <span class="emission-chevron">⌄</span>
          </div>
        </summary>

        <div class="emission-zone-content">
          <div class="emission-map-panel">
            ${imagePath ? `
              <img
                src="${escapeHtml(imagePath)}"
                alt="${escapeHtml(title)} illustrative map"
                class="emission-zone-image"
                loading="lazy"
                tabindex="0"
                role="button"
                title="Click to enlarge map"
              >

              <button
                type="button"
                class="mini-btn emission-enlarge-button"
                data-enlarge-emission-map
              >
                ⛶ Enlarge map
              </button>
            ` : `
              <div class="note-box">
                No illustration configured.
              </div>
            `}
          </div>

          <div class="emission-settings-panel">
            <div class="emission-settings-heading">
              <strong>Zone Settings</strong>
              <span class="subline">
                Configure individual alerts
              </span>
            </div>

            <div class="emission-zone-options">
              ${zones.map(renderOption).join("")}
            </div>

            <div class="emission-info-panel">
              <strong>Route Detection</strong>
              <p>
                Geographic boundaries are managed centrally
                in Supabase. Illustrative maps do not
                determine route detection.
              </p>
              <p>
                Vehicle eligibility and official charges
                depend on the vehicle and zone rules.
              </p>
            </div>
          </div>
        </div>
      </details>
    `;
  }

  const html = [];

  if (londonZones.length) {
    html.push(
      renderAccordion(
        "London Emission & Charging Zones",
        londonZones,
        "london-emission-zones.png",
        "london"
      )
    );
  }

  otherZones.forEach(zone => {
    html.push(
      renderAccordion(
        zone.zone_name,
        [zone],
        imageFiles[zone.zone_code] || "",
        zone.zone_code
      )
    );
  });

  mount.innerHTML = html.join("");

  // Only one accordion may be open at a time.
  const accordions = Array.from(
    mount.querySelectorAll(".emission-zone-accordion")
  );

  accordions.forEach(accordion => {
    accordion.addEventListener("toggle", () => {
      if (!accordion.open) return;

      accordions.forEach(other => {
        if (other !== accordion && other.open) {
          other.open = false;
        }
      });
    });
  });

  // Image enlargement using the existing Settings dialog.
  function enlargeMap(image) {
    if (!image) return;

    if (typeof openPricingImage === "function") {
      openPricingImage(image.src, image.alt);
    }
  }

  mount.querySelectorAll(".emission-zone-image")
    .forEach(img => {
      img.addEventListener("click", () => enlargeMap(img));

      img.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          enlargeMap(img);
        }
      });
    });

  mount.querySelectorAll("[data-enlarge-emission-map]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const image = button
          .closest(".emission-map-panel")
          ?.querySelector(".emission-zone-image");

        enlargeMap(image);
      });
    });

  // Update alert counters immediately when a checkbox changes.
  mount.querySelectorAll("[data-emission-zone]")
    .forEach(input => {
      input.addEventListener("change", () => {
        const accordion = input.closest(
          ".emission-zone-accordion"
        );

        if (!accordion) return;

        const inputs = Array.from(
          accordion.querySelectorAll("[data-emission-zone]")
        ).filter(item => !item.disabled);

        const enabled = inputs.filter(
          item => item.checked
        ).length;

        const counter = accordion.querySelector(
          "[data-alert-count]"
        );

        if (counter) {
          counter.textContent =
            `${enabled}/${inputs.length} alerts`;
        }
      });
    });

  if (status) {
    const activeCount = emissionZonesCache.filter(
      zone => zone.status === "active"
    ).length;

    status.textContent =
      `${activeCount} active zones · ` +
      `${emissionZonesCache.length} total · ` +
      `${html.length} regions`;
  }
}

async function saveEmissionZones() {
  if (!emissionZonesCache.length) {
    throw new Error(
      "Load the zone list before saving."
    );
  }

  const preferences = readEmissionPreferences();

  const inputs = byId("emissionZoneList")
    .querySelectorAll("[data-emission-zone]");

  inputs.forEach(input => {
    if (!input.disabled) {
      preferences[input.dataset.emissionZone] =
        input.checked;
    }
  });

  await saveSettingsByIds(
    [
      "emission_alert_delivery",
      "emission_alert_route",
      "emission_display_map"
    ],
    "Emission alert preferences saved."
  );

  await saveSettingValue(
    EMISSION_PREF_KEY,
    JSON.stringify(preferences)
  );

  showToast(
    "Emission zone preferences saved.",
    "ok"
  );
}


  function bindEvents() {
    bindTabs();


// Refresh emission zones

byId("btnRefreshEmissionZones")
  ?.addEventListener("click", async () => {
    try {
      await loadEmissionZones();
    } catch (error) {
      console.error(error);
      showToast(error.message, "err");
    }
  });

// Save emission zone preferences

byId("btnSaveEmissionZones")
  ?.addEventListener("click", async () => {
    try {
      await saveEmissionZones();
    } catch (error) {
      console.error(error);
      showToast(error.message, "err");
    }
  });


[
  "stop_time_minutes",
  "unloading_time_mode",
  "unloading_extra_minutes_per_order",
  "unloading_volume_threshold_m3",
  "unloading_extra_minutes_per_m3",
  "unloading_volume_rounding"
].forEach(id => {
  byId(id)?.addEventListener("input", updateSummary);
  byId(id)?.addEventListener("change", updateSummary);
});

byId("main_logo_file")?.addEventListener("change", previewSelectedLogoFile);
byId("owner_logo_file")?.addEventListener("change", previewSelectedOwnerLogoFile);

["sales_order_prefix", "sales_order_padding", "next_sales_order_number"].forEach(id => {
  byId(id)?.addEventListener("input", updateSalesOrderPreview);
});

    byId("btnSaveMain")?.addEventListener("click", async () => {
      try {
        await uploadMainLogoIfSelected();
        await saveSettingsByIds(collectFieldsInside("tab-main"), "Tenant account saved.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save tenant account.", "err");
      }
    });


byId("btnSaveTransport")?.addEventListener("click", async () => {
  const button = byId("btnSaveTransport");

  try {
    if (button) button.disabled = true;

    validateUnloadingSettings();

    const uploadedPath = await uploadDepotPdfIfSelected();

    await saveSettingsByIds(
      collectFieldsInside("tab-transport"),
      "Transport and depot settings saved."
    );

    if (uploadedPath) {
      const input = byId("home_depot_pickup_pdf_file");
      if (input) input.value = "";
    }

  } catch (error) {
    console.error("Transport settings error:", error);

    showToast(
      error.message || "Could not save transport settings.",
      "err"
    );
  } finally {
    if (button) button.disabled = false;
  }
});

byId("btnSaveWarehouse")?.addEventListener("click", async () => {
  try {
    await saveSettingsByIds(
      collectFieldsInside("tab-warehouse"),
      "Warehouse settings saved."
    );
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not save warehouse settings.", "err");
  }
});

    byId("btnSaveDocuments")?.addEventListener("click", async () => {
      try {
        await saveSettingsByIds(collectFieldsInside("tab-documents"), "Document settings saved.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save document settings.", "err");
      }
    });


byId("btnSavePricing")?.addEventListener("click", async () => {
  try {
    validatePricingSettings();

    await saveSettingsByIds(
      collectFieldsInside("tab-pricing"),
      "Pricing settings saved."
    );

  } catch (error) {
    console.error("Pricing settings error:", error);

    showToast(
      error.message || "Could not save pricing settings.",
      "err"
    );
  }
});


    byId("btnSaveAutomation")?.addEventListener("click", async () => {
      try {
        await saveSettingsByIds(collectFieldsInside("tab-automation"), "Email automation settings saved.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save automation settings.", "err");
      }
    });

    byId("btnSaveSystem")?.addEventListener("click", async () => {
      try {
        await saveSettingsByIds(collectFieldsInside("tab-system"), "System settings saved.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save system settings.", "err");
      }
    });


byId("btnResetDefaults")?.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Load default transport settings? Unsaved transport changes will be discarded."
  );

  if (!confirmed) return;

  collectFieldsInside("tab-transport").forEach(id => {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, id)) {
      setFieldValue(id, DEFAULT_SETTINGS[id]);
    }
  });

  updateSummary();

  if (typeof window.updateUnloadingPreview === "function") {
    window.updateUnloadingPreview();
  }

  showToast(
    "Default transport values loaded. Save to apply.",
    "ok"
  );
});

    byId("btnAddOwnerProfile")?.addEventListener("click", async () => {
      try {
        await addOwnerProfile();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not add product owner.", "err");
      }
    });

    byId("btnSaveOwnerProfile")?.addEventListener("click", async () => {
      try {
        await saveSelectedOwnerProfile();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save product owner.", "err");
      }
    });

    byId("btnAddDriver")?.addEventListener("click", async () => {
      try {
        await addOrLinkDriver();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not add/link driver.", "err");
      }
    });

    byId("btnRefreshDrivers")?.addEventListener("click", async () => {
      try {
        await loadDriverUsers();
        showToast("Drivers refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not refresh drivers.", "err");
      }
    });

    byId("btnAddVehicle")?.addEventListener("click", async () => {
      try {
        await addVehicle();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not add vehicle.", "err");
      }
    });

byId("btnCreatePortalUser")?.addEventListener("click", async () => {
  try {
    await createPortalUser();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not create user.", "err");
  }
});

byId("btnRefreshPortalUsers")?.addEventListener("click", async () => {
  try {
    await loadPortalUsers();
    showToast("Users refreshed.", "ok");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not refresh users.", "err");
  }
});



byId("btnResetNewVehicle")?.addEventListener("click", () => {
  [
    "newVehicleName",
    "newVehicleCode",
    "newVehicleRegistration",
    "newVehicleDriverUserId",
    "newVehicleDriverEmail",
    "newVehicleMaxVolume",
    "newVehicleMaxStops",
    "newVehicleMaxHours",
    "newVehicleAverageSpeed",
    "newVehicleCostPerHour",
    "newVehicleFuelLitresPer100km",
    "newVehicleLabourPerHour"
  ].forEach(id => setFieldValue(id, ""));

  setFieldValue("newVehicleType", "van");
});


    byId("btnRefreshShops")?.addEventListener("click", loadShops);

    byId("newVehicleDriverUserId")?.addEventListener("change", event => {
      const driverId = event.target.value;
      const email = getDriverEmailById(driverId);
      if (byId("newVehicleDriverEmail")) {
        byId("newVehicleDriverEmail").value = email || "";
      }
    });

    document.addEventListener("click", async event => {
      const btn = event.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");

      try {
        if (action === "open-vehicle") openVehicle(id);
        if (action === "close-vehicle") closeVehicle(id);
        if (action === "save-vehicle") await saveVehicle(id);
      } catch (error) {
        console.error(error);
        showToast(error.message || "Action failed.", "err");
      }
    });

    document.addEventListener("change", async event => {
      const input = event.target.closest("[data-action='planner-checkbox']");
      if (!input) return;

      try {
        await setVehicleActive(input.getAttribute("data-id"), !!input.checked);
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not update planner visibility.", "err");
      }
    });

    document.addEventListener("change", event => {
      const select = event.target.closest('[data-field="driver_user_id"]');
      if (!select) return;

      const row = select.closest(".vehicle-row");
      if (!row) return;

      const emailInput = row.querySelector('[data-field="driver_email"]');
      const nameInput = row.querySelector('[data-field="driver_name"]');

      if (emailInput) emailInput.value = getDriverEmailById(select.value) || "";
      if (nameInput) nameInput.value = getDriverNameById(select.value) || "";
    });
  }

async function init() {
  try {
    ensureClient();


await getCompanyId();
await loadSettings();
await loadEmissionZones();
await loadVehicles();

    await loadPortalUsers();
    await loadDriverUsers();
    await loadShops();

    renderDriverDropdowns();
    renderDriversTable();

    // Koppel de algemene knoppen pas na succesvol laden.
    bindEvents();

    console.log(
      "Veynor tenant settings loaded for company:",
      companyId
    );
  } catch (error) {
    console.error("Settings page failed to load:", error);

    showToast(
      error.message ||
        "Settings could not be loaded. Reload the page before making changes.",
      "err"
    );
  }
}

  document.addEventListener("DOMContentLoaded", init);
})();