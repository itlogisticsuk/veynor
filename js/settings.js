(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const COMPANY_ASSETS_BUCKET = "company-assets";
  const OWNER_PROFILES_KEY = "product_owner_profiles";

  let client = null;
  let companyId = null;
  let settingsMap = new Map();
  let ownerProfiles = [];
  let selectedOwnerKey = "";
  let vehiclesCache = [];
  let driverUsersCache = [];

  const DEFAULT_OWNER_PROFILES = [
    {
      key: "bellstone",
      name: "Bellstone Furniture Distributors Ltd",
      trading_name: "Bellstone",
      customer_code: "BELLSTONE",
      vat: "503290623",
      address1: "2ND FLOOR, RAINHAM HOUSE",
      address2: "NEW ROAD",
      city: "Rainham",
      postcode: "RM13 8RH",
      country: "United Kingdom",
      logo_url: "",
      logo_storage_path: "",
      invoice_email: "",
      ack_email: "",
      pod_email: "",
      ops_email: "",
      payment_terms_days: "14",
      invoice_frequency: "batch",
      default_source_name: "Bellstone",
      auto_ack: false,
      auto_invoice: false,
      notes: ""
    },
    {
      key: "zoy",
      name: "Zoy",
      trading_name: "Zoy",
      customer_code: "ZOY",
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
      payment_terms_days: "14",
      invoice_frequency: "batch",
      default_source_name: "Zoy",
      auto_ack: false,
      auto_invoice: false,
      notes: ""
    }
  ];

  const DEFAULT_SETTINGS = {
    main_company_name: "Sofa2U Ltd",
    main_display_name: "Sofa2U",
    main_trading_name: "Sofa2U",
    main_company_registration: "",
    main_email: "sales@sofa2u.co.uk",
    main_phone: "+44 (0) 7894 469947",
    main_address: "860-862 Garratt Lane, London, SW17 0NB",
    main_registered_address: "",
    main_vat: "GB 368 665 249",
    main_country: "United Kingdom",
    main_website: "https://www.sofa2u.co.uk",
    main_default_currency: "GBP",

    main_logo_url: "",
    main_logo_storage_path: "",
    brand_primary_color: "#1267ff",
    brand_accent_color: "#07152f",
    document_logo_position: "top_left",
    document_show_company_details: "true",

    finance_contact_name: "",
    finance_email: "sales@sofa2u.co.uk",
    finance_phone: "+44 (0) 7894 469947",
    invoice_email: "sales@sofa2u.co.uk",

    operations_contact_name: "",
    operations_email: "sales@sofa2u.co.uk",
    operations_phone: "+44 (0) 7894 469947",
    pod_email: "sales@sofa2u.co.uk",

    claims_contact_name: "",
    claims_email: "sales@sofa2u.co.uk",
    claims_phone: "",

    bank_company_name: "Sofa2U Ltd",
    bank_name: "NatWest",
    bank_sort_code: "51-61-11",
    bank_account_no: "7797 5170",
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

    invoice_payment_note: "Please make payments via bank transfer using the details shown on this invoice.",
    doc_damage_note: "All goods must be checked for damage and reported within 5 days of delivery.",
    document_footer_text: "",
    delivery_disclaimer: "",
    pod_confirmation_text: "",
    terms_conditions_note: "",
    storage_terms_note: "",

    default_payment_terms_days: "14",
    default_ack_lead_days: "21",
    damage_reporting_days: "5",
    storage_starts_after_days: "",

    tax_default_vat_rate: "0.20",
    tax_reverse_charge_text: "",
    tax_vat_exempt_text: "",

    warehouse_contact_name: "",
    warehouse_email: "",
    warehouse_phone: "",
    warehouse_opening_hours: "",
    loading_hours: "",

    home_depot_name: "Sofa2U",
    home_depot_postcode: "SY4 4UD",
    home_depot_city: "Shrewsbury",
    home_depot_country: "United Kingdom",
    home_depot_lat: "52.6981200",
    home_depot_lng: "-2.6530400",
    average_speed_kmh: "50",
    stop_time_minutes: "15",
    distance_factor: "1.25",
    max_route_volume_m3: "45",
    max_route_stops: "12",
    max_route_duration_hours: "9",
    max_orders_per_route: "12",
    default_transport_type: "own_transport",
    labour_cost_per_hour_gbp: "38.50",
    vehicle_cost_per_mile_gbp: "0.55",

    doc_default_payment_terms: "14",
    doc_vat_rate: "0.20",
    doc_ack_lead_days: "21",
    doc_bucket: "order-documents",

    email_sender_name: "Sofa2U",
    email_sender_address: "sales@sofa2u.co.uk",
    email_auto_ack_default: "false",
    email_auto_invoice_default: "false",
    email_auto_pod_default: "false",
    email_default_cc: "",
    email_footer: "",

    system_default_country: "United Kingdom",
    system_default_product_owner: "Bellstone",
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
    if (companyId) return companyId;

    const db = ensureClient();

    const { data, error } = await db
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Tenant "${TENANT_NAME}" not found in companies.`);

    companyId = data.id;
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
    const direct = settingsMap.get(key);

    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return direct;
    }

    const aliases = ALIASES[key] || [];

    for (const alias of aliases) {
      const val = settingsMap.get(alias);
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return val;
      }
    }

    return DEFAULT_SETTINGS[key] ?? fallback ?? "";
  }

  function collectFieldsInside(containerId) {
    const container = byId(containerId);
    if (!container) return [];

    return Array.from(container.querySelectorAll("input[id], select[id], textarea[id]"))
      .filter(el => el.id)
      .filter(el => el.type !== "file")
      .map(el => el.id);
  }

  function collectAllSettingsFields() {
    return Array.from(document.querySelectorAll(".settings-panel input[id], .settings-panel select[id], .settings-panel textarea[id]"))
      .filter(el => el.id)
      .filter(el => el.type !== "file")
      .map(el => el.id);
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

  async function addOrLinkDriver() {
    const db = ensureClient();
    const cid = await getCompanyId();

    const fullName = getFieldValue("newDriverName");
    const email = getFieldValue("newDriverEmail");
    const phone = getFieldValue("newDriverPhone");
    const role = getFieldValue("newDriverRole", "driver");
    const defaultVehicleId = getFieldValue("newDriverDefaultVehicle");
    const useInPlanning = parseBool(getFieldValue("newDriverUseInPlanning", "true"), true);
    const isActive = parseBool(getFieldValue("newDriverActive", "true"), true);

    if (!email) throw new Error("Driver email is required.");

    const existingByEmail = driverUsersCache.find(driver =>
      normalize(getDriverEmail(driver)) === normalize(email)
    );

    if (existingByEmail?.profile_id) {
      const { error } = await db
        .from("user_profiles")
        .update({
          company_id: cid,
          full_name: fullName || getDriverName(existingByEmail),
          role,
          phone,
          email,
          is_driver: true,
          is_active: isActive,
          use_in_planning: useInPlanning,
          default_vehicle_id: defaultVehicleId || null
        })
        .eq("id", existingByEmail.profile_id);

      if (error) throw error;

      showToast("Driver profile updated.", "ok");
    } else {
      const { error } = await db
        .from("user_profiles")
        .insert({
          id: crypto.randomUUID(),
          auth_user_id: crypto.randomUUID(),
          company_id: cid,
          full_name: fullName || email,
          role,
          phone,
          email,
          is_driver: true,
          is_active: isActive,
          use_in_planning: useInPlanning,
          default_vehicle_id: defaultVehicleId || null
        });

      if (error) throw error;

      showToast("Driver added as profile. Create/link Supabase Auth separately if login is required.", "ok");
    }

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
    updateSummary();
  }

  async function saveSettingsByIds(ids, successMessage = "Settings saved.") {
    const db = ensureClient();
    const cid = await getCompanyId();

    const uniqueIds = [...new Set(ids || [])]
      .filter(id => byId(id))
      .filter(id => byId(id).type !== "file");

    if (!uniqueIds.length) {
      showToast("No matching fields found to save.", "err");
      return;
    }

    const rows = uniqueIds.map(id => ({
      company_id: cid,
      setting_key: id,
      setting_value: getFieldValue(id, DEFAULT_SETTINGS[id] ?? "")
    }));

    const { error } = await db
      .from("settings")
      .upsert(rows, { onConflict: "company_id,setting_key" });

    if (error) throw error;

    rows.forEach(row => settingsMap.set(row.setting_key, row.setting_value));

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
    await getCompanyId();

    const ext = getFileExtension(file);
    const path = `sofa2u/main-logo.${ext}`;

    const { error: uploadError } = await db.storage
      .from(COMPANY_ASSETS_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`
      });

    if (uploadError) throw uploadError;

    const { data } = db.storage
      .from(COMPANY_ASSETS_BUCKET)
      .getPublicUrl(path);

    const publicUrl = data?.publicUrl || "";

    setFieldValue("main_logo_url", publicUrl);
    setFieldValue("main_logo_storage_path", path);

    await saveSettingValue("main_logo_url", publicUrl);
    await saveSettingValue("main_logo_storage_path", path);

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
    const owner = getSelectedOwner();

    if (!file || !owner?.key) return null;

    const db = ensureClient();
    await getCompanyId();

    const ext = getFileExtension(file);
    const safeOwnerKey = String(owner.key)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");

    const path = `product-owners/${safeOwnerKey}/logo.${ext}`;

    const { error: uploadError } = await db.storage
      .from(COMPANY_ASSETS_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`
      });

    if (uploadError) throw uploadError;

    const { data } = db.storage
      .from(COMPANY_ASSETS_BUCKET)
      .getPublicUrl(path);

    const publicUrl = data?.publicUrl || "";

    setFieldValue("owner_logo_url", publicUrl);
    setFieldValue("owner_logo_storage_path", path);

    renderOwnerLogoPreview(publicUrl);

    return { publicUrl, path };
  }

  function loadOwnerProfiles() {
    const raw = settingsMap.get(OWNER_PROFILES_KEY);

    if (!raw) {
      ownerProfiles = DEFAULT_OWNER_PROFILES.map(row => ({ ...row }));
      selectedOwnerKey = ownerProfiles[0]?.key || "";
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      ownerProfiles = Array.isArray(parsed) && parsed.length
        ? parsed.map(owner => ({
            ...owner,
            logo_url: owner.logo_url || "",
            logo_storage_path: owner.logo_storage_path || ""
          }))
        : DEFAULT_OWNER_PROFILES.map(row => ({ ...row }));
    } catch {
      ownerProfiles = DEFAULT_OWNER_PROFILES.map(row => ({ ...row }));
    }

    if (!selectedOwnerKey || !ownerProfiles.some(p => p.key === selectedOwnerKey)) {
      selectedOwnerKey = ownerProfiles[0]?.key || "";
    }
  }

  async function saveOwnerProfiles() {
    await saveSettingValue(OWNER_PROFILES_KEY, JSON.stringify(ownerProfiles));
  }

  function getSelectedOwner() {
    return ownerProfiles.find(p => p.key === selectedOwnerKey) || ownerProfiles[0] || null;
  }

  function renderOwnerList() {
    const mount = byId("ownerList");
    if (!mount) return;

    if (!ownerProfiles.length) {
      mount.innerHTML = `<div class="note-box">No product owners configured yet.</div>`;
      return;
    }

    mount.innerHTML = ownerProfiles.map(owner => `
      <button class="owner-btn ${owner.key === selectedOwnerKey ? "active" : ""}" type="button" data-owner-key="${escapeHtml(owner.key)}">
        <strong>${escapeHtml(owner.trading_name || owner.name || "Product Owner")}</strong>
        <span>${escapeHtml(owner.name || "")}</span>
      </button>
    `).join("");

    mount.querySelectorAll("[data-owner-key]").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedOwnerKey = btn.getAttribute("data-owner-key");
        renderOwnerList();
        renderOwnerEditor();
      });
    });
  }

  function renderOwnerEditor() {
    const owner = getSelectedOwner();

    if (byId("ownerEditorTitle")) {
      byId("ownerEditorTitle").textContent = owner
        ? (owner.trading_name || owner.name)
        : "Select product owner";
    }

    [
      "name",
      "trading_name",
      "customer_code",
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
      "notes"
    ].forEach(field => {
      setFieldValue(`owner_${field}`, owner?.[field] ?? "");
    });

    setFieldValue("owner_auto_ack", String(owner?.auto_ack || false));
    setFieldValue("owner_auto_invoice", String(owner?.auto_invoice || false));
    renderOwnerLogoPreview(owner?.logo_url || "");
  }

  function readOwnerEditor() {
    const owner = getSelectedOwner();
    if (!owner) return null;

    return {
      ...owner,
      name: getFieldValue("owner_name"),
      trading_name: getFieldValue("owner_trading_name"),
      customer_code: getFieldValue("owner_customer_code"),
      vat: getFieldValue("owner_vat"),
      address1: getFieldValue("owner_address1"),
      address2: getFieldValue("owner_address2"),
      city: getFieldValue("owner_city"),
      postcode: getFieldValue("owner_postcode"),
      country: getFieldValue("owner_country", "United Kingdom"),
      logo_url: getFieldValue("owner_logo_url"),
      logo_storage_path: getFieldValue("owner_logo_storage_path"),
      invoice_email: getFieldValue("owner_invoice_email"),
      ack_email: getFieldValue("owner_ack_email"),
      pod_email: getFieldValue("owner_pod_email"),
      ops_email: getFieldValue("owner_ops_email"),
      payment_terms_days: getFieldValue("owner_payment_terms", "14"),
      invoice_frequency: getFieldValue("owner_invoice_frequency", "batch"),
      default_source_name: getFieldValue("owner_default_source_name"),
      auto_ack: parseBool(getFieldValue("owner_auto_ack"), false),
      auto_invoice: parseBool(getFieldValue("owner_auto_invoice"), false),
      notes: getFieldValue("owner_notes")
    };
  }

  async function saveSelectedOwnerProfile() {
    let owner = readOwnerEditor();

    if (!owner) {
      showToast("Select a product owner first.", "err");
      return;
    }

    if (!owner.name && !owner.trading_name) {
      showToast("Product owner name is required.", "err");
      return;
    }

    await uploadOwnerLogoIfSelected();

    owner = readOwnerEditor();
    ownerProfiles = ownerProfiles.map(row => row.key === owner.key ? owner : row);

    await saveOwnerProfiles();

    renderOwnerList();
    renderOwnerEditor();

    const logoInput = byId("owner_logo_file");
    if (logoInput) logoInput.value = "";

    showToast("Product owner profile saved.", "ok");
  }

  async function addOwnerProfile() {
    const name = getFieldValue("newOwnerName");

    if (!name) {
      showToast("Enter a product owner name first.", "err");
      return;
    }

    const key = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (ownerProfiles.some(row => row.key === key)) {
      showToast("This product owner already exists.", "err");
      return;
    }

    ownerProfiles.push({
      key,
      name,
      trading_name: name,
      customer_code: key.toUpperCase(),
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
      payment_terms_days: "14",
      invoice_frequency: "batch",
      default_source_name: name,
      auto_ack: false,
      auto_invoice: false,
      notes: ""
    });

    selectedOwnerKey = key;
    setFieldValue("newOwnerName", "");

    await saveOwnerProfiles();

    renderOwnerList();
    renderOwnerEditor();

    showToast("Product owner added.", "ok");
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

  function updateSummary() {
    const labour = toNumber(getFieldValue("labour_cost_per_hour_gbp"), 38.5);
    const vehicle = toNumber(getFieldValue("vehicle_cost_per_mile_gbp"), 0.55);
    const speed = toNumber(getFieldValue("average_speed_kmh"), 50);
    const stopTime = toNumber(getFieldValue("stop_time_minutes"), 15);
    const maxHours = toNumber(getFieldValue("max_route_duration_hours"), 9);
    const activeCount = vehiclesCache.filter(vehicleIsActive).length;

    if (byId("summaryLabour")) byId("summaryLabour").textContent = `${formatMoney(labour)} / hour`;
    if (byId("summaryVehicle")) byId("summaryVehicle").textContent = `${formatMoney(vehicle)} / mile`;
    if (byId("summarySpeed")) byId("summarySpeed").textContent = `${formatNumber(speed, 0)} km/h`;
    if (byId("summaryStopTime")) byId("summaryStopTime").textContent = `${formatNumber(stopTime, 0)} min`;
    if (byId("summaryMaxHours")) byId("summaryMaxHours").textContent = `${formatNumber(maxHours, 1)} h`;
    if (byId("summaryActiveVehicles")) byId("summaryActiveVehicles").textContent = formatNumber(activeCount);
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
              <div class="field"><label>Cost / Mile</label><input class="input" type="number" step="0.01" data-field="cost_per_mile_gbp" value="${escapeHtml(toNumber(vehicle.cost_per_mile_gbp, 0.55))}"></div>
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
      cost_per_mile_gbp: toNumber(read("cost_per_mile_gbp"), 0.55),
      labour_cost_per_hour_gbp: toNumber(read("labour_cost_per_hour_gbp"), 38.5),

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
      cost_per_mile_gbp: toNumber(getFieldValue("newVehicleCostPerMile"), 0.55),
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
      "newVehicleCostPerMile",
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

  function makeRetailerCode(postcode, retailerName) {
    const pc = String(postcode || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
    const name = String(retailerName || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    return `${pc || "NOPC"}-${name || "RET"}`;
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  async function loadShops() {
    const tbody = byId("shopsBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="8">Loading retailers...</td></tr>`;

    try {
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
          customer_name,
          delivery_city,
          delivery_postcode,
          last_activity_at,
          created_at,
          customers (
            id,
            name,
            customer_code
          )
        `)
        .eq("company_id", cid)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (error) throw error;

      const map = new Map();

      (data || []).forEach(order => {
        const retailerName = String(order.retail_name || order.customer_name || "").trim();
        const city = String(order.delivery_city || "").trim();
        const postcode = String(order.delivery_postcode || "").trim();
        const ownerName = order.customers?.name || "—";
        const ownerCode = order.customers?.customer_code || "";
        const lastActivity = order.last_activity_at || order.created_at || "";

        if (!retailerName && !postcode && !city) return;

        const key = [
          retailerName.toLowerCase(),
          postcode.toLowerCase(),
          city.toLowerCase(),
          String(order.customer_id || "")
        ].join("|");

        if (!map.has(key)) {
          map.set(key, {
            retailerName,
            city,
            postcode,
            ownerName,
            ownerCode,
            orders: 0,
            lastActivity
          });
        }

        const row = map.get(key);
        row.orders += 1;

        const currentTime = new Date(row.lastActivity || 0).getTime();
        const nextTime = new Date(lastActivity || 0).getTime();

        if (nextTime > currentTime) row.lastActivity = lastActivity;
      });

      const rows = [...map.values()].sort((a, b) =>
        String(a.retailerName || "").localeCompare(String(b.retailerName || ""), "en", {
          numeric: true,
          sensitivity: "base"
        })
      );

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="8">No retailers found yet. Retailers will appear here after orders have been imported.</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map((row, index) => `
        <tr>
          <td>${formatNumber(index + 1)}</td>
          <td>${escapeHtml(makeRetailerCode(row.postcode, row.retailerName))}</td>
          <td>
            <strong>${escapeHtml(row.retailerName || "Unknown retailer")}</strong>
            <span class="subline">Delivery location / shop</span>
          </td>
          <td>
            <strong>${escapeHtml(row.ownerName || "—")}</strong>
            <span class="subline">${escapeHtml(row.ownerCode || "")}</span>
          </td>
          <td>${escapeHtml(row.city || "—")}</td>
          <td>${escapeHtml(row.postcode || "—")}</td>
          <td>${formatNumber(row.orders)}</td>
          <td>${escapeHtml(formatDateTime(row.lastActivity))}</td>
        </tr>
      `).join("");
    } catch (error) {
      console.error(error);
      tbody.innerHTML = `<tr><td colspan="8">Could not load retailers: ${escapeHtml(error.message || "Unknown error")}</td></tr>`;
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

  function bindEvents() {
    bindTabs();

    byId("main_logo_file")?.addEventListener("change", previewSelectedLogoFile);
    byId("owner_logo_file")?.addEventListener("change", previewSelectedOwnerLogoFile);

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
      try {
        await saveSettingsByIds(collectFieldsInside("tab-transport"), "Transport settings saved.");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save transport settings.", "err");
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
      Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
        setFieldValue(key, value);
      });

      renderLogoPreview();
      updateSummary();
      showToast("Default values loaded.", "ok");
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
        "newVehicleCostPerMile",
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
      bindEvents();

      await getCompanyId();
      await loadSettings();
      await loadVehicles();
      await loadDriverUsers();
      await loadShops();

      renderDriverDropdowns();
      renderDriversTable();

      console.log("Veynor tenant settings loaded for:", TENANT_NAME);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Settings page failed to load.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();