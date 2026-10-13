
/* ============================================================
   VEYNOR SUPER ADMIN PORTAL
   File: /js/admin/admin.js
   Version: 1.0.0

   - Supabase authentication
   - Super Admin role verification
   - Tenant directory
   - Tenant search and selection
   - User statistics
   - Tenant details
   - Session logout

   Tenant creation and switching remain disabled until
   the server-side authorization is configured.
   ============================================================ */

(function () {
  "use strict";

  const CONFIG = Object.freeze({
    adminRole: "veynor_admin",
    loginUrl: "/login.html",
    searchDebounceMs: 150
  });

  let client = null;
  let currentUser = null;
  let currentProfile = null;

  let tenants = [];
  let profiles = [];
  let selectedTenantId = null;

  let isLoading = false;
  let searchTimer = null;

  // ==========================================================
  // HELPERS
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
    return Number(value || 0).toLocaleString("en-GB");
  }

  function shortId(value) {
    const text = clean(value);

    if (!text) return "—";

    return text.length > 12
      ? `${text.slice(0, 8)}…`
      : text;
  }

  // ==========================================================
  // NOTIFICATIONS
  // ==========================================================

  function showNotice(message, type = "info") {
    const notice = byId("notice");

    if (!notice) return;

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
  // SUPABASE
  // ==========================================================

  function getClient() {
    if (client) return client;

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
  // AUTHENTICATION
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

    if (error) throw error;

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

    if (error) throw error;

    if (!data || data.length !== 1) {
      throw new Error(
        "No unique active user profile found."
      );
    }

    currentProfile = data[0];

    return currentProfile;
  }

  function verifyAdminRole() {
    const role = normalize(currentProfile?.role);

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
  // PAGE ACCESS
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

    link.href = "/login.html";
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

    panel.append(title, description, link);
    main.appendChild(panel);
    document.body.appendChild(main);
  }

  // ==========================================================
  // LOADING
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
  // TENANTS
  // ==========================================================

  async function loadTenants() {
    const db = getClient();

    const { data, error } = await db
      .from("companies")
      .select("id,name")
      .order("name", {
        ascending: true
      });

    if (error) throw error;

    tenants = Array.isArray(data) ? data : [];

    return tenants;
  }

  // ==========================================================
  // USER PROFILES
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

    if (error) throw error;

    profiles = Array.isArray(data) ? data : [];

    return profiles;
  }

  // ==========================================================
  // STATISTICS
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

  // ==========================================================
  // TENANT SELECTION
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
        String(item.id) === String(tenantId)
    );

    selectedTenantId = tenant?.id || null;

    renderTenantDirectory();
    renderTenantDetails();
    renderStatistics();
  }

  // ==========================================================
  // SEARCH
  // ==========================================================

  function getFilteredTenants() {
    const search = normalize(
      byId("tenantSearch")?.value
    );

    if (!search) return tenants;

    return tenants.filter(tenant => {
      const searchable = [
        tenant.name,
        tenant.id
      ].map(normalize).join(" ");

      return searchable.includes(search);
    });
  }

  // ==========================================================
  // TENANT DIRECTORY
  // ==========================================================

  function renderTenantDirectory() {
    const body = byId("tenantRows");

    if (!body) return;

    const filtered = getFilteredTenants();

    if (!filtered.length) {
      body.innerHTML = `
        <tr>
          <td colspan="4" class="empty">
            No tenants found.
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
              ${selected ? "Selected" : "View"}
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ==========================================================
  // TENANT DETAILS
  // ==========================================================

  function renderTenantDetails() {
    const container = byId("tenantDetail");

    if (!container) return;

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
  // DASHBOARD STATISTICS
  // ==========================================================

  function renderStatistics() {
    setText(
      "totalTenants",
      formatNumber(tenants.length)
    );

    setText(
      "totalUsers",
      formatNumber(profiles.length)
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

    setText("platformStatus", "Connected");
  }

  function renderAll() {
    renderTenantDirectory();
    renderTenantDetails();
    renderStatistics();
  }

  // ==========================================================
  // REFRESH
  // ==========================================================

  async function refreshData() {
    if (isLoading) return;

    setLoading(true);

    showNotice("Loading tenant information...");

    try {
      await verifyAccess();

      await loadTenants();
      await loadProfiles();

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

      setText("platformStatus", "Issue");

      showNotice(
        error.message ||
        "Could not refresh tenant information.",
        "error"
      );

    } finally {
      setLoading(false);
    }
  }

  // ==========================================================
  // LOGOUT
  // ==========================================================

  async function logout() {
    try {
      const db = getClient();

      const { error } =
        await db.auth.signOut();

      if (error) throw error;

      localStorage.removeItem(
        "veynor_last_activity_at"
      );

      localStorage.removeItem(
        "veynor_session_user_id"
      );

      window.location.replace(CONFIG.loginUrl);

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
  // PROTECTED ACTIONS
  // ==========================================================

  function disableProtectedActions() {
    [
      "newTenantBtn",
      "openTenantBtn",
      "tenantSettingsBtn"
    ].forEach(id => {
      const button = byId(id);

      if (!button) return;

      button.disabled = true;

      button.title =
        "Requires secure server-side tenant authorization.";
    });
  }

  // ==========================================================
  // EVENTS
  // ==========================================================

  function bindEvents() {
    byId("refreshBtn")?.addEventListener(
      "click",
      refreshData
    );

    byId("logoutBtn")?.addEventListener(
      "click",
      logout
    );

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

    byId("tenantRows")?.addEventListener(
      "click",
      event => {
        const row = event.target.closest(
          "tr[data-id]"
        );

        if (!row) return;

        selectTenant(row.dataset.id);
      }
    );

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

        if (!row) return;

        event.preventDefault();

        selectTenant(row.dataset.id);
      }
    );

    byId("closeDialog")?.addEventListener(
      "click",
      () => {
        byId("tenantDialog")?.close();
      }
    );

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
  // INITIALIZATION
  // ==========================================================

  async function init() {
    try {
      disableProtectedActions();
      bindEvents();

      await verifyAccess();

      unlockPage();

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
  // START
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
