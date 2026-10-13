
/* ============================================================
   VEYNOR SUPER ADMIN PORTAL
   File: /js/admin/admin.js
   Version: 1.1.0

   PLATFORM STRUCTURE

   IT LOGISTICS UK
      company_type = platform_owner

   OPERATIONAL TENANTS
      Sofa2U
      Future customers

   FEATURES
   - Existing Supabase authentication
   - Super Admin role verification
   - Platform Owner recognition
   - Operational tenant directory
   - Tenant search and selection
   - User statistics
   - Tenant details
   - Session logout

   IMPORTANT
   - Existing user company_id remains unchanged.
   - No database writes.
   - No tenant impersonation.
   - Protected actions remain disabled.
   ============================================================ */

(function () {
  "use strict";

  // ==========================================================
  // 1. CONFIGURATION
  // ==========================================================

  const CONFIG = Object.freeze({
    adminRole: "veynor_admin",
    platformOwnerType: "platform_owner",
    loginUrl: "/login.html",
    searchDebounceMs: 150
  });

  // ==========================================================
  // 2. STATE
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
  let searchTimer = null;

  // ==========================================================
  // 3. DOM HELPERS
  // ==========================================================

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent = String(value ?? "");
    }
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
    return Number(value || 0).toLocaleString(
      "en-GB"
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

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleDateString("en-GB");
  }

  // ==========================================================
  // 4. NOTIFICATIONS
  // ==========================================================

  function showNotice(message, type = "info") {
    const notice = byId("notice");

    if (!notice) {
      return;
    }

    notice.textContent = message || "";

    notice.className =
      type === "error"
        ? "notice error"
        : "notice";

    notice.classList.remove("hidden");
  }

  function hideNotice() {
    byId("notice")?.classList.add("hidden");
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
        "Supabase helper sb() is not available."
      );
    }

    client = window.sb();

    if (!client?.auth) {
      throw new Error(
        "Supabase authentication is unavailable."
      );
    }

    return client;
  }

  // ==========================================================
  // 6. AUTHENTICATION
  // ==========================================================

  function redirectToLogin() {
    const next = encodeURIComponent(
      window.location.pathname
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
      throw new Error("Not authenticated.");
    }

    return currentUser;
  }

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
        is_active
      `)
      .eq("auth_user_id", currentUser.id)
      .eq("is_active", true)
      .limit(2);

    if (error) {
      throw error;
    }

    if (!data || data.length !== 1) {
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
        "Access denied. Super Admin permission required."
      );
    }

    return true;
  }

  async function verifyAccess() {
    await loadCurrentUser();
    await loadCurrentProfile();

    verifyAdminRole();

    return true;
  }

  // ==========================================================
  // 7. PAGE ACCESS
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
    description.textContent = message;

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
  // 8. LOADING STATE
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

  // ==========================================================
  // 9. COMPANY CLASSIFICATION
  // ==========================================================

  function isPlatformOwner(company) {
    return normalize(company?.company_type) ===
      CONFIG.platformOwnerType;
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
  // 10. LOAD COMPANIES
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
      .order("name", {
        ascending: true
      });

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
  // 11. LOAD USER PROFILES
  // ==========================================================

  async function loadProfiles() {
    const db = getClient();

    const { data, error } = await db
      .from("user_profiles")
      .select(`
        id,
        company_id,
        role,
        is_active
      `);

    if (error) {
      throw error;
    }

    profiles = Array.isArray(data)
      ? data
      : [];

    return profiles;
  }

  // ==========================================================
  // 12. USER STATISTICS
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
      profile => profile.is_active === true
    ).length;
  }

  function getTotalTenantUsers() {
    const tenantIds = new Set(
      tenants.map(tenant => String(tenant.id))
    );

    return profiles.filter(profile =>
      tenantIds.has(String(profile.company_id))
    ).length;
  }

  // ==========================================================
  // 13. TENANT SELECTION
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

    selectedTenantId = tenant?.id || null;

    renderTenantDirectory();
    renderTenantDetails();
    renderStatistics();
  }

  // ==========================================================
  // 14. TENANT SEARCH
  // ==========================================================

  function getFilteredTenants() {
    const search = normalize(
      byId("tenantSearch")?.value
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
  // END OF PART 1
  // ==========================================================

  /*
   * CONTINUE DIRECTLY WITH PART 2.
   *
   * Do not add })(); here.
   * Do not close the function.
   *
   * Part 2 contains:
   * - Platform Owner display
   * - Tenant directory rendering
   * - Tenant details
   * - Dashboard statistics
   * - Refresh
   * - Logout
   * - Events
   * - Initialization
   */

  // ==========================================================
  // 15. PLATFORM OWNER DISPLAY
  // ==========================================================

  function renderPlatformOwner() {
    const owner = getPlatformOwner();

    // These fields are optional in the current HTML.
    // They will be used when we extend the dashboard.

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
  }

  // ==========================================================
  // 16. TENANT DIRECTORY
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

      const active = tenant.is_active === true;

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
            <span class="pill">
              ${
                selected
                  ? "Selected"
                  : active
                    ? "View"
                    : "Inactive"
              }
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ==========================================================
  // 17. TENANT DETAILS
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
        <span>Company type</span>
        <strong>
          ${escapeHtml(tenant.company_type || "—")}
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
          ${escapeHtml(formatDate(tenant.created_at))}
        </strong>
      </div>

      <div class="detail-row">
        <span>Total users</span>
        <strong>
          ${formatNumber(totalUsers)}
        </strong>
      </div>

      <div class="detail-row">
        <span>Active users</span>
        <strong>
          ${formatNumber(activeUsers)}
        </strong>
      </div>

      <div class="detail-row">
        <span>Tenant access</span>
        <strong>
          Pending configuration
        </strong>
      </div>
    `;
  }

  // ==========================================================
  // 18. DASHBOARD STATISTICS
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
      "Connected"
    );
  }

  // ==========================================================
  // 19. COMPLETE RENDER
  // ==========================================================

  function renderAll() {
    renderPlatformOwner();
    renderTenantDirectory();
    renderTenantDetails();
    renderStatistics();
  }

  // ==========================================================
  // 20. REFRESH DATA
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

      await loadCompanies();
      await loadProfiles();

      // Keep the selected tenant only if it still exists.
      const selectedStillExists = tenants.some(
        tenant =>
          String(tenant.id) ===
          String(selectedTenantId)
      );

      if (!selectedStillExists) {
        selectedTenantId = null;
      }

      renderAll();
      hideNotice();

    } catch (error) {
      console.error(
        "[Veynor Admin] Refresh failed:",
        error
      );

      setText(
        "platformStatus",
        "Issue"
      );

      showNotice(
        error.message ||
        "Could not refresh platform information.",
        "error"
      );

    } finally {
      setLoading(false);
    }
  }

  // ==========================================================
  // 21. LOGOUT
  // ==========================================================

  async function logout() {
    try {
      const db = getClient();

      const { error } =
        await db.auth.signOut();

      if (error) {
        throw error;
      }

      localStorage.removeItem(
        "veynor_last_activity_at"
      );

      localStorage.removeItem(
        "veynor_session_user_id"
      );

      window.location.replace(
        CONFIG.loginUrl
      );

    } catch (error) {
      console.error(
        "[Veynor Admin] Logout failed:",
        error
      );

      showNotice(
        "Could not sign out: " +
        (error.message || "Unknown error"),
        "error"
      );
    }
  }

  // ==========================================================
  // 22. PROTECTED ACTIONS
  // ==========================================================

  function disableProtectedActions() {
    const protectedButtons = [
      "newTenantBtn",
      "openTenantBtn",
      "tenantSettingsBtn"
    ];

    protectedButtons.forEach(id => {
      const button = byId(id);

      if (!button) {
        return;
      }

      button.disabled = true;

      button.title =
        "Requires secure server-side tenant authorization.";
    });
  }

  // ==========================================================
  // 23. EVENT HANDLERS
  // ==========================================================

  function bindEvents() {
    // Refresh platform data
    byId("refreshBtn")?.addEventListener(
      "click",
      refreshData
    );

    // Sign out
    byId("logoutBtn")?.addEventListener(
      "click",
      logout
    );

    // Search tenants
    byId("tenantSearch")?.addEventListener(
      "input",
      () => {
        clearTimeout(searchTimer);

        searchTimer = setTimeout(
          renderTenantDirectory,
          CONFIG.searchDebounceMs
        );
      }
    );

    // Select tenant by mouse
    byId("tenantRows")?.addEventListener(
      "click",
      event => {
        const row = event.target.closest(
          "tr[data-id]"
        );

        if (!row) {
          return;
        }

        selectTenant(row.dataset.id);
      }
    );

    // Select tenant by keyboard
    byId("tenantRows")?.addEventListener(
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

        selectTenant(row.dataset.id);
      }
    );

    // Close tenant dialog
    byId("closeDialog")?.addEventListener(
      "click",
      () => {
        byId("tenantDialog")?.close();
      }
    );

    // Tenant creation placeholder
    byId("tenantForm")?.addEventListener(
      "submit",
      event => {
        event.preventDefault();

        showNotice(
          "Tenant creation is not configured yet.",
          "error"
        );
      }
    );
  }

  // ==========================================================
  // 24. INITIALIZATION
  // ==========================================================

  async function init() {
    try {
      // Prevent tenant modification until backend is ready.
      disableProtectedActions();

      // Register UI event handlers.
      bindEvents();

      // Authenticate and verify Super Admin.
      await verifyAccess();

      // Show the page only after access is verified.
      unlockPage();

      // Load platform and tenant information.
      await refreshData();

    } catch (error) {
      console.error(
        "[Veynor Admin] Access failed:",
        error
      );

      if (!currentUser?.id) {
        redirectToLogin();
        return;
      }

      blockPage(
        error.message ||
        "Administrator access could not be verified."
      );
    }
  }

  // ==========================================================
  // 25. START
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
