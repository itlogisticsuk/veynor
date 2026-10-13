
/* ============================================================
   VEYNOR SUPER ADMIN PORTAL
   File: /js/admin/admin.js
   Version: 1.2.0

   PLATFORM STRUCTURE
   - IT LOGISTICS UK: platform_owner
   - Sofa2U and future customers: operational tenants

   FEATURES
   - Existing Supabase login
   - Super Admin verification
   - Platform Owner recognition
   - Tenant directory
   - Tenant management dialogs
   - User management
   - Tenant creation through protected backend
   - Tenant portal access through protected backend

   IMPORTANT
   - No service_role key in browser code.
   - Existing user company_id is not changed.
   - Sofa2U operational data remains untouched.
   - All protected operations require server authorization.

   PART 1 OF 4
   ============================================================ */

(function () {
  "use strict";

  // ==========================================================
  // 1. CONFIGURATION
  // ==========================================================

  const CONFIG = Object.freeze({
    version: "1.2.0",

    adminRole: "veynor_admin",
    platformOwnerType: "platform_owner",

    loginUrl: "/login.html",
    adminUrl: "/admin/",

    tenantPortalUrl:
      "/operations-control-center.html",

    searchDebounceMs: 150,

    // Supabase Edge Functions.
    // These endpoints must be deployed and authorised
    // before protected actions can be enabled.

    functions: Object.freeze({
      createTenant: "admin-create-tenant",
      updateTenant: "admin-update-tenant",
      inviteUser: "admin-invite-user",
      openTenant: "admin-open-tenant"
    })
  });

  // ==========================================================
  // 2. APPLICATION STATE
  // ==========================================================

  let client = null;

  let currentUser = null;
  let currentProfile = null;

  let companies = [];
  let platformOwners = [];
  let tenants = [];
  let profiles = [];

  let selectedTenantId = null;

  let isLoading = false;
  let isSubmitting = false;

  let searchTimer = null;

  let activeSettingsTab = "company";

  const state = {
    initialized: false,
    authenticated: false,
    adminVerified: false,
    backendReady: false,
    selectedTenant: null,
    lastRefreshAt: null
  };

  // ==========================================================
  // 3. DOM HELPERS
  // ==========================================================

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const element = byId(id);

    if (!element) {
      return;
    }

    element.textContent = String(value ?? "");
  }

  function setValue(id, value) {
    const element = byId(id);

    if (!element) {
      return;
    }

    element.value = String(value ?? "");
  }

  function getValue(id) {
    return String(
      byId(id)?.value ?? ""
    ).trim();
  }

  function setDisabled(id, disabled) {
    const element = byId(id);

    if (!element) {
      return;
    }

    element.disabled = Boolean(disabled);
  }

  function setVisible(id, visible) {
    const element = byId(id);

    if (!element) {
      return;
    }

    element.hidden = !visible;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
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

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function formatNumber(value) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return number.toLocaleString("en-GB");
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleDateString(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }
    );
  }

  function shortId(value) {
    const text = clean(value);

    if (!text) {
      return "—";
    }

    return text.length > 12
      ? `${text.slice(0, 8)}…`
      : text;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      clean(value)
    );
  }

  function isValidUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      clean(value)
    );
  }

  // ==========================================================
  // 4. NOTIFICATIONS
  // ==========================================================

  function showNotice(message, type = "info") {
    const notice = byId("notice");

    if (!notice) {
      return;
    }

    notice.textContent = String(
      message || ""
    );

    notice.className =
      type === "error"
        ? "notice error"
        : type === "success"
          ? "notice success"
          : "notice";

    notice.classList.remove("hidden");

    notice.hidden = false;
  }

  function hideNotice() {
    const notice = byId("notice");

    if (!notice) {
      return;
    }

    notice.classList.add("hidden");
    notice.hidden = true;
  }

  function showError(error, fallback) {
    const message =
      error?.message ||
      fallback ||
      "An unexpected error occurred.";

    console.error(
      "[Veynor Super Admin]",
      error
    );

    showNotice(message, "error");
  }

  // ==========================================================
  // 5. SUPABASE CLIENT
  // ==========================================================

  function getClient() {
    if (client) {
      return client;
    }

    if (typeof window.sb !== "function") {
      throw new Error(
        "Supabase helper sb() is unavailable."
      );
    }

    client = window.sb();

    if (
      !client?.auth ||
      typeof client.from !== "function"
    ) {
      throw new Error(
        "Supabase client is invalid."
      );
    }

    return client;
  }

  // ==========================================================
  // 6. AUTHENTICATION
  // ==========================================================

  function redirectToLogin() {
    const next = encodeURIComponent(
      window.location.pathname +
      window.location.search
    );

    window.location.replace(
      `${CONFIG.loginUrl}?next=${next}`
    );
  }

  async function loadCurrentUser() {
    const db = getClient();

    const { data, error } =
      await db.auth.getUser();

    if (error) {
      throw error;
    }

    currentUser = data?.user || null;

    if (!currentUser?.id) {
      throw new Error(
        "Not authenticated."
      );
    }

    state.authenticated = true;

    return currentUser;
  }

  // ==========================================================
  // 7. USER PROFILE
  // ==========================================================

  async function loadCurrentProfile() {
    const db = getClient();

    if (!currentUser?.id) {
      throw new Error(
        "Authenticated user is missing."
      );
    }

    const { data, error } = await db
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        company_id,
        customer_id,
        role,
        is_active,
        full_name,
        email
      `)
      .eq(
        "auth_user_id",
        currentUser.id
      )
      .eq("is_active", true)
      .limit(2);

    if (error) {
      throw error;
    }

    if (
      !Array.isArray(data) ||
      data.length !== 1
    ) {
      throw new Error(
        "No unique active user profile found."
      );
    }

    currentProfile = data[0];

    return currentProfile;
  }

  function verifyAdminRole() {
    const role = normalize(
      currentProfile?.role
    );

    if (role !== CONFIG.adminRole) {
      throw new Error(
        "Access denied. Super Admin role required."
      );
    }

    state.adminVerified = true;

    return true;
  }

  async function verifyAccess() {
    await loadCurrentUser();
    await loadCurrentProfile();

    verifyAdminRole();

    return true;
  }

  // ==========================================================
  // 8. PAGE ACCESS
  // ==========================================================

  function unlockPage() {
    document.documentElement.classList.remove(
      "auth-loading"
    );
  }

  function blockPage(message) {
    unlockPage();

    document.body.replaceChildren();

    const main = document.createElement("main");

    main.style.cssText = `
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:24px;
      background:#f3f6fb;
      font-family:Inter,Segoe UI,Arial,sans-serif;
    `;

    const panel = document.createElement("section");

    panel.style.cssText = `
      width:min(520px,100%);
      padding:30px;
      border:1px solid #e0e8f4;
      border-radius:18px;
      background:white;
      text-align:center;
      box-shadow:0 20px 50px #071b431a;
    `;

    const title = document.createElement("h1");
    title.textContent = "Access denied";

    const description = document.createElement("p");
    description.textContent = String(
      message || "Administrator access required."
    );

    description.style.cssText = `
      color:#61718b;
      line-height:1.6;
    `;

    const link = document.createElement("a");

    link.href = CONFIG.loginUrl;
    link.textContent = "Return to login";

    link.style.cssText = `
      display:inline-block;
      margin-top:16px;
      padding:12px 20px;
      background:#0864f9;
      color:white;
      border-radius:10px;
      text-decoration:none;
      font-weight:800;
    `;

    panel.append(
      title,
      description,
      link
    );

    main.appendChild(panel);
    document.body.appendChild(main);
  }

  // ==========================================================
  // 9. LOADING STATE
  // ==========================================================

  function setLoading(value) {
    isLoading = Boolean(value);

    const button = byId("refreshBtn");

    if (button) {
      button.disabled = isLoading;

      button.textContent = isLoading
        ? "Refreshing..."
        : "↻ Refresh";
    }
  }

  function setSubmitting(value) {
    isSubmitting = Boolean(value);

    [
      "createTenantSubmitBtn",
      "saveTenantCompanyBtn",
      "sendInviteUserBtn"
    ].forEach(id => {
      const button = byId(id);

      if (!button) {
        return;
      }

      button.dataset.submitting =
        isSubmitting ? "true" : "false";
    });

    updateActionAvailability();
  }

  // ==========================================================
  // 10. COMPANY CLASSIFICATION
  // ==========================================================

  function isPlatformOwner(company) {
    return normalize(
      company?.company_type
    ) === CONFIG.platformOwnerType;
  }

  function isOperationalTenant(company) {
    return Boolean(
      company?.id &&
      !isPlatformOwner(company)
    );
  }

  function classifyCompanies() {
    platformOwners = companies.filter(
      isPlatformOwner
    );

    tenants = companies.filter(
      isOperationalTenant
    );
  }

  function getPlatformOwner() {
    return platformOwners[0] || null;
  }

  // ==========================================================
  // 11. LOAD COMPANIES
  // ==========================================================

  async function loadCompanies() {
    const db = getClient();

    const { data, error } = await db
      .from("companies")
      .select(`
        id,
        name,
        company_type,
        is_active,
        email,
        phone,
        created_at
      `)
      .order(
        "name",
        { ascending: true }
      );

    if (error) {
      throw error;
    }

    companies = Array.isArray(data)
      ? data
      : [];

    classifyCompanies();

    return companies;
  }

  // ==========================================================
  // 12. LOAD USER PROFILES
  // ==========================================================

  async function loadProfiles() {
    const db = getClient();

    const { data, error } = await db
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        company_id,
        customer_id,
        full_name,
        email,
        role,
        is_active,
        created_at
      `)
      .order(
        "created_at",
        { ascending: true }
      );

    if (error) {
      throw error;
    }

    profiles = Array.isArray(data)
      ? data
      : [];

    return profiles;
  }

  // ==========================================================
  // 13. USER STATISTICS
  // ==========================================================

  function getTenantUsers(tenantId) {
    return profiles.filter(profile =>
      String(profile.company_id) ===
      String(tenantId)
    );
  }

  function getTenantUserCount(tenantId) {
    return getTenantUsers(tenantId).length;
  }

  function getActiveTenantUserCount(tenantId) {
    return getTenantUsers(tenantId).filter(
      profile =>
        profile.is_active === true
    ).length;
  }

  function getTotalTenantUsers() {
    const tenantIds = new Set(
      tenants.map(
        tenant => String(tenant.id)
      )
    );

    return profiles.filter(profile =>
      tenantIds.has(
        String(profile.company_id)
      )
    ).length;
  }

  // ==========================================================
  // 14. TENANT SELECTION
  // ==========================================================

  function getSelectedTenant() {
    return tenants.find(
      tenant =>
        String(tenant.id) ===
        String(selectedTenantId)
    ) || null;
  }

  function selectTenant(tenantId) {
    const tenant = tenants.find(
      item =>
        String(item.id) ===
        String(tenantId)
    );

    selectedTenantId =
      tenant?.id || null;

    state.selectedTenant =
      tenant || null;

    renderTenantDirectory();
    renderTenantDetails();
    renderStatistics();

    updateActionAvailability();
  }

  // ==========================================================
  // 15. TENANT SEARCH
  // ==========================================================

  function getFilteredTenants() {
    const search = normalize(
      getValue("tenantSearch")
    );

    if (!search) {
      return tenants;
    }

    return tenants.filter(tenant => {
      const searchable = [
        tenant.name,
        tenant.id,
        tenant.email,
        tenant.company_type
      ]
        .map(normalize)
        .join(" ");

      return searchable.includes(search);
    });
  }

  // ==========================================================
  // END OF PART 1 OF 4
  //
  // PART 2:
  // - Platform Owner rendering
  // - Tenant Directory
  // - Tenant Details
  // - Dashboard statistics
  // - User list
  //
  // Do not close the IIFE here.
  // Continue directly with Part 2.
  // ==========================================================


  // ==========================================================
  // 16. PLATFORM OWNER DISPLAY
  // ==========================================================

  function renderPlatformOwner() {
    const owner = getPlatformOwner();

    setText(
      "platformOwnerName",
      owner?.name || "Not configured"
    );

    setText(
      "platformOwnerId",
      owner?.id || "—"
    );

    setText(
      "platformOwnerEmail",
      owner?.email || "—"
    );

    setText(
      "platformOwnerStatus",
      owner
        ? owner.is_active === true
          ? "Active"
          : "Inactive"
        : "Missing"
    );

    setText(
      "platformOwnerCreated",
      formatDate(owner?.created_at)
    );

    // Platform Settings modal

    setValue(
      "platformSettingsName",
      owner?.name || ""
    );

    setValue(
      "platformSettingsCompanyId",
      owner?.id || ""
    );
  }

  // ==========================================================
  // 17. TENANT DIRECTORY
  // ==========================================================

  function renderTenantDirectory() {
    const body = byId("tenantRows");

    if (!body) {
      return;
    }

    const filtered = getFilteredTenants();

    if (!filtered.length) {
      body.innerHTML = `
        <tr>
          <td colspan="4" class="empty">
            No operational tenants found.
          </td>
        </tr>
      `;

      return;
    }

    body.innerHTML = filtered.map(tenant => {
      const selected =
        String(selectedTenantId) ===
        String(tenant.id);

      const userCount =
        getTenantUserCount(tenant.id);

      const active =
        tenant.is_active === true;

      const statusLabel = selected
        ? "Selected"
        : active
          ? "View"
          : "Inactive";

      const statusClass = active
        ? "pill"
        : "admin-badge inactive";

      return `
        <tr
          data-id="${escapeHtml(tenant.id)}"
          class="${selected ? "selected" : ""}"
          tabindex="0"
          aria-selected="${selected}"
        >
          <td>
            <strong>
              ${escapeHtml(
                tenant.name || "Unnamed tenant"
              )}
            </strong>
          </td>

          <td title="${escapeHtml(tenant.id)}">
            ${escapeHtml(shortId(tenant.id))}
          </td>

          <td>
            ${formatNumber(userCount)}
          </td>

          <td>
            <span class="${statusClass}">
              ${statusLabel}
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ==========================================================
  // 18. TENANT DETAILS
  // ==========================================================

  function renderTenantDetails() {
    const container = byId("tenantDetail");

    if (!container) {
      return;
    }

    const tenant = getSelectedTenant();

    if (!tenant) {
      container.className = "empty";

      container.textContent =
        "Select a tenant from the directory.";

      return;
    }

    const totalUsers =
      getTenantUserCount(tenant.id);

    const activeUsers =
      getActiveTenantUserCount(tenant.id);

    container.className = "detail";

    container.innerHTML = `
      <div class="detail-row">
        <span>Company</span>
        <strong>
          ${escapeHtml(tenant.name || "—")}
        </strong>
      </div>

      <div class="detail-row">
        <span>Tenant ID</span>
        <strong>
          ${escapeHtml(tenant.id)}
        </strong>
      </div>

      <div class="detail-row">
        <span>Company Type</span>
        <strong>
          ${escapeHtml(
            tenant.company_type || "—"
          )}
        </strong>
      </div>

      <div class="detail-row">
        <span>Status</span>
        <strong>
          ${tenant.is_active ? "Active" : "Inactive"}
        </strong>
      </div>

      <div class="detail-row">
        <span>Email</span>
        <strong>
          ${escapeHtml(tenant.email || "—")}
        </strong>
      </div>

      <div class="detail-row">
        <span>Phone</span>
        <strong>
          ${escapeHtml(tenant.phone || "—")}
        </strong>
      </div>

      <div class="detail-row">
        <span>Created</span>
        <strong>
          ${escapeHtml(
            formatDate(tenant.created_at)
          )}
        </strong>
      </div>

      <div class="detail-row">
        <span>Total Users</span>
        <strong>
          ${formatNumber(totalUsers)}
        </strong>
      </div>

      <div class="detail-row">
        <span>Active Users</span>
        <strong>
          ${formatNumber(activeUsers)}
        </strong>
      </div>

      <div class="detail-row">
        <span>Tenant Access</span>
        <strong>
          ${
            state.backendReady
              ? "Available"
              : "Pending configuration"
          }
        </strong>
      </div>
    `;
  }

  // ==========================================================
  // 19. DASHBOARD STATISTICS
  // ==========================================================

  function renderStatistics() {
    setText(
      "totalTenants",
      formatNumber(tenants.length)
    );

    setText(
      "totalUsers",
      formatNumber(getTotalTenantUsers())
    );

    const selected = getSelectedTenant();

    setText(
      "selectedUsers",
      selected
        ? formatNumber(
            getTenantUserCount(selected.id)
          )
        : "—"
    );

    setText(
      "platformStatus",
      state.adminVerified
        ? "Connected"
        : "Checking"
    );
  }

  // ==========================================================
  // 20. TENANT COMPANY FORM
  // ==========================================================

  function populateTenantCompanyForm() {
    const tenant = getSelectedTenant();

    setValue(
      "editTenantName",
      tenant?.name || ""
    );

    setValue(
      "editTenantEmail",
      tenant?.email || ""
    );

    setValue(
      "editTenantPhone",
      tenant?.phone || ""
    );

    setValue(
      "editTenantStatus",
      tenant?.is_active === false
        ? "false"
        : "true"
    );

    setValue(
      "editTenantType",
      tenant?.company_type || ""
    );
  }

  // ==========================================================
  // 21. TENANT CONFIGURATION DISPLAY
  // ==========================================================

  function populateTenantConfiguration() {
    const tenant = getSelectedTenant();

    setValue(
      "tenantConfigCompanyId",
      tenant?.id || ""
    );

    setValue(
      "tenantConfigStatus",
      state.backendReady
        ? "Available"
        : "Pending"
    );
  }

  // ==========================================================
  // 22. TENANT USER LIST
  // ==========================================================

  function renderTenantUsers() {
    const container = byId(
      "tenantUsersList"
    );

    if (!container) {
      return;
    }

    const tenant = getSelectedTenant();

    if (!tenant) {
      container.innerHTML = `
        <div class="empty">
          Select a tenant to view users.
        </div>
      `;

      return;
    }

    const users = getTenantUsers(
      tenant.id
    );

    if (!users.length) {
      container.innerHTML = `
        <div class="empty">
          No users are linked to this tenant.
        </div>
      `;

      return;
    }

    container.innerHTML = users.map(user => {
      const name =
        clean(user.full_name) ||
        clean(user.email) ||
        "Unnamed user";

      const role =
        clean(user.role) ||
        "Unknown role";

      const status =
        user.is_active === true
          ? "Active"
          : "Inactive";

      const statusClass =
        user.is_active === true
          ? "pill"
          : "admin-badge inactive";

      return `
        <div class="admin-user-row">

          <div class="admin-user-info">

            <strong>
              ${escapeHtml(name)}
            </strong>

            <span>
              ${escapeHtml(user.email || "—")}
            </span>

            <span>
              Role:
              ${escapeHtml(
                role.replaceAll("_", " ")
              )}
            </span>

          </div>

          <span class="${statusClass}">
            ${status}
          </span>

        </div>
      `;
    }).join("");
  }

  // ==========================================================
  // 23. TENANT SETTINGS TABS
  // ==========================================================

  function setSettingsTab(tabName) {
    const allowedTabs = [
      "company",
      "users",
      "configuration"
    ];

    const selectedTab =
      allowedTabs.includes(tabName)
        ? tabName
        : "company";

    activeSettingsTab = selectedTab;

    document.querySelectorAll(
      "[data-admin-tab]"
    ).forEach(button => {
      const active =
        button.dataset.adminTab ===
        selectedTab;

      button.classList.toggle(
        "active",
        active
      );

      button.setAttribute(
        "aria-selected",
        String(active)
      );
    });

    document.querySelectorAll(
      "[data-admin-panel]"
    ).forEach(panel => {
      const active =
        panel.dataset.adminPanel ===
        selectedTab;

      panel.classList.toggle(
        "active",
        active
      );

      panel.hidden = !active;
    });

    if (selectedTab === "users") {
      renderTenantUsers();
    }

    if (selectedTab === "company") {
      populateTenantCompanyForm();
    }

    if (selectedTab === "configuration") {
      populateTenantConfiguration();
    }
  }

  // ==========================================================
  // 24. COMPLETE TENANT SETTINGS RENDER
  // ==========================================================

  function renderTenantSettings() {
    populateTenantCompanyForm();
    populateTenantConfiguration();
    renderTenantUsers();

    setSettingsTab(
      activeSettingsTab
    );
  }

  // ==========================================================
  // 25. COMPLETE DASHBOARD RENDER
  // ==========================================================

  function renderAll() {
    renderPlatformOwner();
    renderTenantDirectory();
    renderTenantDetails();
    renderStatistics();
    renderTenantSettings();
  }

  // ==========================================================
  // END OF PART 2 OF 4
  //
  // PART 3:
  // - Backend availability
  // - Secure Edge Function calls
  // - New Tenant creation
  // - Tenant updates
  // - User invitations
  // - Tenant portal access
  //
  // Do not close the IIFE here.
  // Continue directly with Part 3.
  // ==========================================================


  // ==========================================================
  // 26. BACKEND CONFIGURATION
  // ==========================================================

  /*
   * Protected operations use Supabase Edge Functions.
   *
   * Required functions:
   *
   * admin-create-tenant
   * admin-update-tenant
   * admin-invite-user
   * admin-open-tenant
   *
   * Each function must verify:
   * - Authenticated user
   * - Active veynor_admin profile
   * - Allowed company / tenant
   * - Requested operation
   *
   * Browser-side role checks are not sufficient.
   */

  function isBackendAvailable() {
    return Boolean(
      state.backendReady &&
      state.adminVerified &&
      currentUser?.id
    );
  }

  // ==========================================================
  // 27. EDGE FUNCTION HELPER
  // ==========================================================

  async function invokeAdminFunction(
    functionName,
    payload = {}
  ) {
    if (!state.adminVerified) {
      throw new Error(
        "Super Admin authorization is required."
      );
    }

    if (!state.backendReady) {
      throw new Error(
        "Administration backend is not configured."
      );
    }

    const db = getClient();

    const { data, error } =
      await db.functions.invoke(
        functionName,
        {
          body: payload
        }
      );

    if (error) {
      throw new Error(
        error.message ||
        `Administration function failed: ${functionName}`
      );
    }

    if (data?.error) {
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : "Administration request failed."
      );
    }

    return data || {};
  }

  // ==========================================================
  // 28. BACKEND AVAILABILITY
  // ==========================================================

  /*
   * Backend is disabled by default.
   *
   * We do not assume Edge Functions exist merely because
   * their names are configured.
   *
   * This flag will be enabled only after the protected
   * administration functions have been deployed.
   */


  // ==========================================================
  // 28. BACKEND AVAILABILITY
  // ==========================================================

  async function checkBackendAvailability() {
    state.backendReady = false;

    try {
      if (
        !state.adminVerified ||
        !state.authenticated
      ) {
        updateActionAvailability();
        return false;
      }

      const db = getClient();

      // Verify the current authenticated session.
      const { data, error } =
        await db.auth.getUser();

      if (error || !data?.user?.id) {
        throw new Error(
          "Administrator session is not valid."
        );
      }

      // The create-tenant backend has been deployed.
      // Other administration endpoints are not ready yet.
      state.backendReady = true;

      console.info(
        "[Veynor Admin] Tenant creation backend configured."
      );


  // ==========================================================
  // 29. ACTION AVAILABILITY
  // ==========================================================

  function updateActionAvailability() {
    const adminReady =
      state.adminVerified &&
      state.authenticated;

    const canCreateTenant =
      adminReady &&
      state.backendReady &&
      !isSubmitting &&
      !isLoading;

    const tenantSelected =
      Boolean(getSelectedTenant());

    // New Tenant - enabled
    setDisabled(
      "newTenantBtn",
      !canCreateTenant
    );

    setDisabled(
      "sideNewTenantBtn",
      !canCreateTenant
    );

    setDisabled(
      "createTenantSubmitBtn",
      !canCreateTenant
    );

    // Tenant details - read-only access
    setDisabled(
      "tenantSettingsBtn",
      !adminReady || !tenantSelected
    );

    setDisabled(
      "sideUsersBtn",
      !adminReady || !tenantSelected
    );

    setDisabled(
      "sidePlatformSettingsBtn",
      !adminReady
    );

    // Other protected backend functions
    // are not implemented yet.
    setDisabled("openTenantBtn", true);
    setDisabled("saveTenantCompanyBtn", true);
    setDisabled("inviteTenantUserBtn", true);
    setDisabled("sendInviteUserBtn", true);
  }

  // ==========================================================
  // 29. ACTION AVAILABILITY
  // ==========================================================

  function updateActionAvailability() {
    const adminReady =
      state.adminVerified &&
      state.authenticated;

    const backendReady =
      adminReady &&
      isBackendAvailable();

    const tenantSelected =
      Boolean(getSelectedTenant());

    const canSubmit =
      backendReady &&
      !isSubmitting &&
      !isLoading;

    // New tenant
    setDisabled(
      "newTenantBtn",
      !canSubmit
    );

    setDisabled(
      "sideNewTenantBtn",
      !canSubmit
    );

    setDisabled(
      "createTenantSubmitBtn",
      !canSubmit
    );

    // Selected tenant
    setDisabled(
      "openTenantBtn",
      !canSubmit || !tenantSelected
    );

    setDisabled(
      "tenantSettingsBtn",
      !adminReady || !tenantSelected
    );

    // Tenant updates
    setDisabled(
      "saveTenantCompanyBtn",
      !canSubmit || !tenantSelected
    );

    // User invitations
    setDisabled(
      "inviteTenantUserBtn",
      !canSubmit || !tenantSelected
    );

    setDisabled(
      "sendInviteUserBtn",
      !canSubmit || !tenantSelected
    );

    // Informational navigation
    setDisabled(
      "sideUsersBtn",
      !adminReady || !tenantSelected
    );

    setDisabled(
      "sidePlatformSettingsBtn",
      !adminReady
    );
  }

  // ==========================================================
  // 30. MODAL HELPERS
  // ==========================================================

  function openDialog(id) {
    const dialog = byId(id);

    if (!dialog) {
      throw new Error(
        `Dialog not found: ${id}`
      );
    }

    if (typeof dialog.showModal !== "function") {
      throw new Error(
        "This browser does not support modal dialogs."
      );
    }

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function closeDialog(id) {
    const dialog = byId(id);

    if (dialog?.open) {
      dialog.close();
    }
  }

  function closeAllDialogs() {
    [
      "tenantDialog",
      "tenantSettingsDialog",
      "inviteUserDialog",
      "platformSettingsDialog"
    ].forEach(closeDialog);
  }

  // ==========================================================
  // 31. NEW TENANT DIALOG
  // ==========================================================


  // ==========================================================
  // 31. NEW TENANT DIALOG
  // ==========================================================

  function openNewTenantDialog() {
    if (!isBackendAvailable()) {
      showNotice(
        "Tenant creation backend is not available.",
        "error"
      );
      return;
    }

    const form = byId("tenantForm");

    form?.reset();

    setValue("newCompanyType", "tenant");
    setValue("newCompanyStatus", "true");

    // Not implemented in backend yet.
    const defaultSettings =
      byId("newTenantDefaultSettings");

    const sendInvite =
      byId("newTenantSendInvite");

    if (defaultSettings) {
      defaultSettings.checked = false;
      defaultSettings.disabled = true;
    }

    if (sendInvite) {
      sendInvite.checked = false;
      sendInvite.disabled = true;
    }

    // Initial administrator is not created yet.
    const adminName = byId("newAdminName");
    const adminEmail = byId("newAdminEmail");

    if (adminName) {
      adminName.value = "";
      adminName.disabled = true;
    }

    if (adminEmail) {
      adminEmail.value = "";
      adminEmail.required = false;
      adminEmail.disabled = true;
    }

    openDialog("tenantDialog");
  }

  // ==========================================================
  // 32. VALIDATE NEW TENANT
  // ==========================================================


  // ==========================================================
  // 32. VALIDATE NEW TENANT
  // ==========================================================

  function getNewTenantPayload() {
    const name =
      clean(getValue("newCompanyName"));

    const email =
      clean(getValue("newCompanyEmail"));

    const phone =
      clean(getValue("newCompanyPhone"));

    const isActive =
      getValue("newCompanyStatus") === "true";

    if (!name || name.length > 150) {
      throw new Error(
        "Enter a company name (maximum 150 characters)."
      );
    }

    if (email && !isValidEmail(email)) {
      throw new Error(
        "Enter a valid company email address."
      );
    }

    if (phone.length > 100) {
      throw new Error(
        "Company phone number is too long."
      );
    }

    return {
      company: {
        name: name,
        email: email || null,
        phone: phone || null,
        company_type: "tenant",
        is_active: isActive
      },

      administrator: null,

      options: {
        create_default_settings: false,
        send_invitation: false
      }
    };
  }

  // ==========================================================
  // 33. CREATE TENANT
  // ==========================================================

  async function createTenant(event) {
    event?.preventDefault();

    if (isSubmitting) {
      return;
    }

    try {
      if (!isBackendAvailable()) {
        throw new Error(
          "Tenant creation backend is not available."
        );
      }

      const payload =
        getNewTenantPayload();

      setSubmitting(true);

      showNotice(
        "Creating the new tenant..."
      );

      const result =
        await invokeAdminFunction(
          CONFIG.functions.createTenant,
          payload
        );

      const newTenantId =
        result.company_id ||
        result.tenant_id ||
        result.company?.id ||
        null;

      if (!newTenantId || !isValidUuid(newTenantId)) {
        throw new Error(
          "Tenant creation did not return a valid company ID."
        );
      }

      closeDialog("tenantDialog");

      await refreshData();

      selectTenant(newTenantId);

      showNotice(
        "Tenant created successfully.",
        "success"
      );

    } catch (error) {
      showError(
        error,
        "Could not create tenant."
      );

    } finally {
      setSubmitting(false);
    }
  }

  // ==========================================================
  // 34. TENANT SETTINGS DIALOG
  // ==========================================================

  function openTenantSettingsDialog(
    initialTab = "company"
  ) {
    const tenant =
      getSelectedTenant();

    if (!tenant) {
      showNotice(
        "Select a tenant first.",
        "error"
      );

      return;
    }

    activeSettingsTab = initialTab;

    renderTenantSettings();

    openDialog(
      "tenantSettingsDialog"
    );
  }

  // ==========================================================
  // 35. VALIDATE TENANT UPDATE
  // ==========================================================

  function getTenantUpdatePayload() {
    const tenant =
      getSelectedTenant();

    if (!tenant?.id) {
      throw new Error(
        "No tenant selected."
      );
    }

    const name =
      clean(getValue("editTenantName"));

    const email =
      clean(getValue("editTenantEmail"));

    const phone =
      clean(getValue("editTenantPhone"));

    const isActive =
      getValue("editTenantStatus") === "true";

    if (!name) {
      throw new Error(
        "Company name is required."
      );
    }

    if (email && !isValidEmail(email)) {
      throw new Error(
        "Enter a valid company email address."
      );
    }

    return {
      company_id: tenant.id,

      changes: {
        name,
        email: email || null,
        phone: phone || null,
        is_active: isActive
      }
    };
  }

  // ==========================================================
  // 36. UPDATE TENANT
  // ==========================================================

  async function updateTenant(event) {
    event?.preventDefault();

    if (isSubmitting) {
      return;
    }

    try {
      if (!isBackendAvailable()) {
        throw new Error(
          "Tenant update backend is not available."
        );
      }

      const payload =
        getTenantUpdatePayload();

      setSubmitting(true);

      showNotice(
        "Saving tenant information..."
      );

      await invokeAdminFunction(
        CONFIG.functions.updateTenant,
        payload
      );

      await refreshData();

      renderTenantSettings();

      showNotice(
        "Tenant information updated successfully.",
        "success"
      );

    } catch (error) {
      showError(
        error,
        "Could not update tenant."
      );

    } finally {
      setSubmitting(false);
    }
  }

  // ==========================================================
  // 37. USER INVITATION DIALOG
  // ==========================================================

  function openInviteUserDialog() {
    const tenant =
      getSelectedTenant();

    if (!tenant) {
      showNotice(
        "Select a tenant first.",
        "error"
      );

      return;
    }

    if (!isBackendAvailable()) {
      showNotice(
        "User invitations require the administration backend.",
        "error"
      );

      return;
    }

    byId("inviteUserForm")?.reset();

    setValue(
      "inviteUserRole",
      "tenant_user"
    );

    openDialog(
      "inviteUserDialog"
    );
  }

  // ==========================================================
  // 38. VALIDATE USER INVITATION
  // ==========================================================

  function getUserInvitationPayload() {
    const tenant =
      getSelectedTenant();

    if (!tenant?.id) {
      throw new Error(
        "No tenant selected."
      );
    }

    const name =
      clean(getValue("inviteUserName"));

    const email =
      clean(getValue("inviteUserEmail"));

    const role =
      normalize(getValue("inviteUserRole"));

    if (!isValidEmail(email)) {
      throw new Error(
        "Enter a valid email address."
      );
    }

    if (
      role !== "tenant_admin" &&
      role !== "tenant_user"
    ) {
      throw new Error(
        "Invalid tenant user role."
      );
    }

    return {
      company_id: tenant.id,
      full_name: name || null,
      email,
      role
    };
  }

  // ==========================================================
  // 39. INVITE USER
  // ==========================================================

  async function inviteTenantUser(event) {
    event?.preventDefault();

    if (isSubmitting) {
      return;
    }

    try {
      if (!isBackendAvailable()) {
        throw new Error(
          "User invitation backend is not available."
        );
      }

      const payload =
        getUserInvitationPayload();

      setSubmitting(true);

      showNotice(
        "Sending user invitation..."
      );

      await invokeAdminFunction(
        CONFIG.functions.inviteUser,
        payload
      );

      closeDialog(
        "inviteUserDialog"
      );

      await refreshData();

      renderTenantUsers();

      showNotice(
        "User invitation processed successfully.",
        "success"
      );

    } catch (error) {
      showError(
        error,
        "Could not invite user."
      );

    } finally {
      setSubmitting(false);
    }
  }

  // ==========================================================
  // 40. OPEN TENANT PORTAL
  // ==========================================================

  /*
   * Tenant portal access must be handled by a protected
   * server-side authorization process.
   *
   * Do not modify the current user's company_id.
   * Do not rely on a browser-only tenant override.
   */

  async function openTenantPortal() {
    const tenant =
      getSelectedTenant();

    if (!tenant?.id) {
      showNotice(
        "Select a tenant first.",
        "error"
      );

      return;
    }

    if (!isBackendAvailable()) {
      showNotice(
        "Tenant portal access requires the administration backend.",
        "error"
      );

      return;
    }

    try {
      setSubmitting(true);

      showNotice(
        `Preparing access to ${tenant.name}...`
      );

      const result =
        await invokeAdminFunction(
          CONFIG.functions.openTenant,
          {
            company_id: tenant.id
          }
        );

      const destination =
        clean(result?.redirect_url);

      if (!destination) {
        throw new Error(
          "Tenant access did not return a destination."
        );
      }

      // Only permit navigation within this Veynor origin.
      const target = new URL(
        destination,
        window.location.origin
      );

      if (
        target.origin !==
        window.location.origin
      ) {
        throw new Error(
          "External tenant redirects are not allowed."
        );
      }

      window.location.assign(
        target.pathname +
        target.search +
        target.hash
      );

    } catch (error) {
      showError(
        error,
        "Could not open tenant portal."
      );

    } finally {
      setSubmitting(false);
    }
  }

  // ==========================================================
  // 41. PLATFORM SETTINGS DIALOG
  // ==========================================================

  function openPlatformSettingsDialog() {
    renderPlatformOwner();

    openDialog(
      "platformSettingsDialog"
    );
  }

  // ==========================================================
  // END OF PART 3 OF 4
  //
  // PART 4:
  // - Refresh data
  // - Modal events
  // - Button events
  // - Logout
  // - Initialization
  // - Complete file closure
  //
  // Do not close the IIFE here.
  // Continue directly with Part 4.
  // ==========================================================


  // ==========================================================
  // 42. REFRESH PLATFORM DATA
  // ==========================================================

  async function refreshData() {
    if (isLoading) {
      return;
    }

    setLoading(true);

    showNotice(
      "Loading platform and tenant information..."
    );

    try {
      await verifyAccess();

      // Load all registered companies.
      await loadCompanies();

      // Load user profiles.
      await loadProfiles();

      // Preserve selection if tenant still exists.
      const selectedStillExists = tenants.some(
        tenant =>
          String(tenant.id) ===
          String(selectedTenantId)
      );

      if (!selectedStillExists) {
        selectedTenantId = null;
        state.selectedTenant = null;
      } else {
        state.selectedTenant =
          getSelectedTenant();
      }

      state.lastRefreshAt =
        new Date().toISOString();

      renderAll();

      updateActionAvailability();

      hideNotice();

    } catch (error) {
      setText(
        "platformStatus",
        "Issue"
      );

      showError(
        error,
        "Could not refresh platform information."
      );

    } finally {
      setLoading(false);
      updateActionAvailability();
    }
  }

  // ==========================================================
  // 43. LOGOUT
  // ==========================================================

  async function logout() {
    try {
      const db = getClient();

      const { error } =
        await db.auth.signOut();

      if (error) {
        throw error;
      }

      // Clear existing Veynor session tracking.
      localStorage.removeItem(
        "veynor_last_activity_at"
      );

      localStorage.removeItem(
        "veynor_session_user_id"
      );

      // Clear current Super Admin state.
      currentUser = null;
      currentProfile = null;

      state.authenticated = false;
      state.adminVerified = false;

      window.location.replace(
        CONFIG.loginUrl
      );

    } catch (error) {
      showError(
        error,
        "Could not sign out."
      );
    }
  }

  // ==========================================================
  // 44. TENANT DIRECTORY EVENTS
  // ==========================================================

  function bindTenantDirectoryEvents() {
    const tenantRows = byId(
      "tenantRows"
    );

    if (!tenantRows) {
      return;
    }

    // Select tenant by mouse.
    tenantRows.addEventListener(
      "click",
      event => {
        const row = event.target.closest(
          "tr[data-id]"
        );

        if (!row) {
          return;
        }

        selectTenant(
          row.dataset.id
        );
      }
    );

    // Select tenant by keyboard.
    tenantRows.addEventListener(
      "keydown",
      event => {
        if (
          event.key !== "Enter" &&
          event.key !== " "
        ) {
          return;
        }

        const row = event.target.closest(
          "tr[data-id]"
        );

        if (!row) {
          return;
        }

        event.preventDefault();

        selectTenant(
          row.dataset.id
        );
      }
    );
  }

  // ==========================================================
  // 45. SEARCH EVENTS
  // ==========================================================

  function bindSearchEvents() {
    const search = byId(
      "tenantSearch"
    );

    if (!search) {
      return;
    }

    search.addEventListener(
      "input",
      () => {
        clearTimeout(
          searchTimer
        );

        searchTimer = setTimeout(
          () => {
            renderTenantDirectory();
          },
          CONFIG.searchDebounceMs
        );
      }
    );
  }

  // ==========================================================
  // 46. MAIN BUTTON EVENTS
  // ==========================================================

  function bindMainButtonEvents() {
    // Refresh platform information.
    byId("refreshBtn")?.addEventListener(
      "click",
      refreshData
    );

    // Sign out.
    byId("logoutBtn")?.addEventListener(
      "click",
      logout
    );

    // Create new tenant.
    byId("newTenantBtn")?.addEventListener(
      "click",
      openNewTenantDialog
    );

    // Open selected tenant portal.
    byId("openTenantBtn")?.addEventListener(
      "click",
      openTenantPortal
    );

    // Open selected tenant settings.
    byId("tenantSettingsBtn")?.addEventListener(
      "click",
      () => {
        openTenantSettingsDialog(
          "company"
        );
      }
    );
  }

  // ==========================================================
  // 47. SIDEBAR EVENTS
  // ==========================================================

  function bindSidebarEvents() {
    // New Tenant.
    byId("sideNewTenantBtn")?.addEventListener(
      "click",
      openNewTenantDialog
    );

    // User Management.
    byId("sideUsersBtn")?.addEventListener(
      "click",
      () => {
        openTenantSettingsDialog(
          "users"
        );
      }
    );

    // Platform Settings.
    byId("sidePlatformSettingsBtn")
      ?.addEventListener(
        "click",
        openPlatformSettingsDialog
      );
  }

  // ==========================================================
  // 48. NEW TENANT MODAL EVENTS
  // ==========================================================

  function bindNewTenantEvents() {
    // Submit tenant creation.
    byId("tenantForm")?.addEventListener(
      "submit",
      createTenant
    );

    // Close buttons.
    [
      "closeDialog",
      "cancelNewTenantBtn"
    ].forEach(id => {
      byId(id)?.addEventListener(
        "click",
        () => {
          closeDialog(
            "tenantDialog"
          );
        }
      );
    });
  }

  // ==========================================================
  // 49. TENANT SETTINGS EVENTS
  // ==========================================================

  function bindTenantSettingsEvents() {
    // Save company changes.
    byId("tenantCompanyForm")
      ?.addEventListener(
        "submit",
        updateTenant
      );

    // Settings tabs.
    document.querySelectorAll(
      "[data-admin-tab]"
    ).forEach(button => {
      button.addEventListener(
        "click",
        () => {
          setSettingsTab(
            button.dataset.adminTab
          );
        }
      );
    });

    // Open user invitation.
    byId("inviteTenantUserBtn")
      ?.addEventListener(
        "click",
        openInviteUserDialog
      );

    // Close tenant settings.
    [
      "closeTenantSettingsBtn",
      "doneTenantSettingsBtn"
    ].forEach(id => {
      byId(id)?.addEventListener(
        "click",
        () => {
          closeDialog(
            "tenantSettingsDialog"
          );
        }
      );
    });
  }

  // ==========================================================
  // 50. USER INVITATION EVENTS
  // ==========================================================

  function bindUserInvitationEvents() {
    // Submit invitation.
    byId("inviteUserForm")
      ?.addEventListener(
        "submit",
        inviteTenantUser
      );

    // Close invitation dialog.
    [
      "closeInviteUserBtn",
      "cancelInviteUserBtn"
    ].forEach(id => {
      byId(id)?.addEventListener(
        "click",
        () => {
          closeDialog(
            "inviteUserDialog"
          );
        }
      );
    });
  }

  // ==========================================================
  // 51. PLATFORM SETTINGS EVENTS
  // ==========================================================

  function bindPlatformSettingsEvents() {
    [
      "closePlatformSettingsBtn",
      "donePlatformSettingsBtn"
    ].forEach(id => {
      byId(id)?.addEventListener(
        "click",
        () => {
          closeDialog(
            "platformSettingsDialog"
          );
        }
      );
    });
  }

  // ==========================================================
  // 52. MODAL KEYBOARD EVENTS
  // ==========================================================

  function bindModalKeyboardEvents() {
    [
      "tenantDialog",
      "tenantSettingsDialog",
      "inviteUserDialog",
      "platformSettingsDialog"
    ].forEach(id => {
      const dialog = byId(id);

      if (!dialog) {
        return;
      }

      dialog.addEventListener(
        "close",
        () => {
          // Restore available actions after closing.
          updateActionAvailability();
        }
      );
    });
  }

  // ==========================================================
  // 53. ALL EVENT HANDLERS
  // ==========================================================

  function bindEvents() {
    bindTenantDirectoryEvents();
    bindSearchEvents();

    bindMainButtonEvents();
    bindSidebarEvents();

    bindNewTenantEvents();
    bindTenantSettingsEvents();

    bindUserInvitationEvents();
    bindPlatformSettingsEvents();

    bindModalKeyboardEvents();
  }

  // ==========================================================
  // 54. INITIALIZATION
  // ==========================================================

  async function init() {
    if (state.initialized) {
      return;
    }

    state.initialized = true;

    try {
      // Keep protected operations disabled initially.
      state.backendReady = false;

      // Register all UI events.
      bindEvents();

      // Verify existing Veynor login.
      await verifyAccess();

      // Unlock the administration interface.
      unlockPage();

      // Load Platform Owner and tenant data.
      await refreshData();

      // Check whether protected backend is configured.
      await checkBackendAvailability();

      // Update button states.
      updateActionAvailability();

      console.info(
        "[Veynor Super Admin] Initialized",
        {
          version: CONFIG.version,
          platformOwners:
            platformOwners.length,
          operationalTenants:
            tenants.length,
          backendReady:
            state.backendReady
        }
      );

    } catch (error) {
      console.error(
        "[Veynor Super Admin] Initialization failed:",
        error
      );

      if (!currentUser?.id) {
        redirectToLogin();
        return;
      }

      blockPage(
        error?.message ||
        "Administrator access could not be verified."
      );
    }
  }

  // ==========================================================
  // 55. START
  // ==========================================================

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }

})();



