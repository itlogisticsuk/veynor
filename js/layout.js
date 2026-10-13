(function () {
  "use strict";

  const SIDEBAR_KEY = "veynor_sidebar_collapsed";
  const APP_VERSION = "v1.4.8";
  const PORTAL_EVENTS_SRC = "/js/portal-events.js";


const LAST_ACTIVITY_KEY = "veynor_last_activity_at";
const SESSION_USER_KEY = "veynor_session_user_id";

const INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000;
const INACTIVITY_WARNING_MS = 5 * 60 * 1000;

const ACTIVITY_SAVE_INTERVAL_MS = 5000;
const SESSION_CHECK_INTERVAL_MS = 15000;

let lastActivitySave = 0;
let inactivityLogoutStarted = false;
let inactivityWarningVisible = false;
let inactivityTrackingReady = false;


  let currentProfile = null;

  const ROLES = {
    VEYNOR_ADMIN: "veynor_admin",
    TENANT_ADMIN: "tenant_admin",
    TENANT_USER: "tenant_user",
    PRODUCT_OWNER_ADMIN: "product_owner_admin",
    PRODUCT_OWNER_USER: "product_owner_user",
    RETAILER_USER: "retailer_user"
  };

  const ALL_ROLES = Object.values(ROLES);
  const TENANT_ROLES = [ROLES.VEYNOR_ADMIN, ROLES.TENANT_ADMIN, ROLES.TENANT_USER];
  const PRODUCT_OWNER_ROLES = [ROLES.PRODUCT_OWNER_ADMIN, ROLES.PRODUCT_OWNER_USER];

  const menuItems = [
    { href: "./index.html", label: "Dashboard", icon: "dashboard", group: "Main", roles: TENANT_ROLES },
{ href: "./message-center.html", label: "Message Center", icon: "activity", group: "Main", roles: ALL_ROLES, badge: "message-center" },
    { href: "./customer-dashboard.html", label: "Customer Dashboard", icon: "dashboard", group: "Main", roles: PRODUCT_OWNER_ROLES },

    { href: "./order-import.html", label: "Orders Import", icon: "upload", group: "Orders", roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES] },
    { href: "./order-matching.html", label: "Order Matching", icon: "match", group: "Orders", roles: TENANT_ROLES },
    { href: "./operations-control-center.html", label: "Operations Control", icon: "control", group: "Orders", roles: ALL_ROLES },

{
  href: "./orders.html",
  label: "Orders & Route Planner",
  icon: "truckRoute",
  group: "Planning",
  roles: TENANT_ROLES
},

{
  href: "./route-tracking.html",
  label: "Route Tracking",
  icon: "routeTracking",
  group: "Planning",
  roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES]
},

{
  href: "./service-jobs.html",
  label: "Service Jobs",
  icon: "serviceJob",
  group: "Planning",
  roles: TENANT_ROLES
},

{
  href: "./quality.html",  label: "Quality / Damage",
  icon: "quality",
  group: "Planning",
  roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES]
},

{ href: "./products.html", label: "Products", icon: "box", group: "Warehouse", roles: TENANT_ROLES },

{
  href: "./inbound-containers.html",
  label: "Inbound Containers",
  icon: "container",
  group: "Warehouse",
  roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES]
},

{ 
  href: "./scan.html", 
  label: "Scan In / Out", 
  icon: "scanner", 
  group: "Warehouse", 
  roles: TENANT_ROLES 
},

{
  href: "./stock.html",
  label: "Current Stock",
  icon: "stock",
  group: "Warehouse",
  roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES]
},

{
  href: "./storage-invoicing.html",
  label: "Storage Invoicing",
  icon: "pound",
  group: "Warehouse",
  roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES]
},

{
  href: "./stock-history.html",
  label: "Stock History",
  icon: "history",
  group: "Warehouse",
  roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES]
},

{ 
  href: "./outbound.html", 
  label: "Outbound History", 
  icon: "paperPlane", 
  group: "Warehouse", 
  roles: TENANT_ROLES 
},

{ 
  href: "./inventory.html", 
  label: "Inventory Check", 
  icon: "checkCircle", 
  group: "Warehouse", 
  roles: TENANT_ROLES 
},

    { href: "./billing.html", label: "Billing", icon: "pound", group: "Finance", roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES] },

    { href: "./analytics.html", label: "Analytics & Reports", icon: "analytics", group: "Analytics", roles: TENANT_ROLES },

    { href: "./support.html", label: "Support Center", icon: "support", group: "System", roles: ALL_ROLES },
    { href: "./customer-activity.html", label: "Customer Activity", icon: "activity", group: "System", roles: TENANT_ROLES },
    { href: "./events.html", label: "Warehouse Events", icon: "pulse", group: "System", roles: TENANT_ROLES },
{ href: "./system-health.html", label: "System Health", icon: "pulse", group: "System", roles: TENANT_ROLES },
    { href: "./settings.html", label: "Settings", icon: "settings", group: "System", roles: [ROLES.VEYNOR_ADMIN, ROLES.TENANT_ADMIN] }
  ];

  const icons = {

    dashboard: `<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4z"/><path d="M13 4h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M13 13h7v7h-7z"/></svg>`,

    upload: `<svg viewBox="0 0 24 24"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 18v2h14v-2"/></svg>`,

    match: `<svg viewBox="0 0 24 24"><path d="M8 7h3a4 4 0 0 1 0 8H8"/><path d="M16 17h-3a4 4 0 0 1 0-8h3"/><path d="M7 12h10"/></svg>`,

    control: `<svg viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></svg>`,

    truckRoute: `
      <svg viewBox="0 0 24 24">
        <path d="M3 8h11v8H3z"/>
        <path d="M14 11h4l3 3v2h-7z"/>
        <circle cx="7" cy="17" r="2"/>
        <circle cx="18" cy="17" r="2"/>
      </svg>
    `,

    routeTracking: `
      <svg viewBox="0 0 24 24">
        <path d="M5 19c0-3 2-5 5-5h4c3 0 5-2 5-5"/>
        <circle cx="5" cy="19" r="2"/>
        <circle cx="10" cy="14" r="2"/>
        <circle cx="19" cy="9" r="2"/>
        <path d="M4 5h7v5H4z"/>
        <path d="M11 7h3l2 2v1h-5z"/>
      </svg>
    `,

    box: `
      <svg viewBox="0 0 24 24">
        <path d="M12 3 4 7l8 4 8-4z"/>
        <path d="M4 7v10l8 4 8-4V7"/>
        <path d="M12 11v10"/>
      </svg>
    `,

container: `
  <svg viewBox="0 0 24 24">
    <path d="M3 6h18v12H3z"/>
    <path d="M7 6v12"/>
    <path d="M11 6v12"/>
    <path d="M15 6v12"/>
    <path d="M19 6v12"/>
    <path d="M5 4h14"/>
    <path d="M5 20h14"/>
  </svg>
`,

serviceJob: `
<svg viewBox="0 0 24 24">
  <path d="M5 6h10v8H5z"/>
  <path d="M15 9h3l2 2v3h-5z"/>
  <circle cx="8" cy="17" r="2"/>
  <circle cx="18" cy="17" r="2"/>
  <path d="M9 4v4"/>
  <path d="M7 6h4"/>
</svg>
`,

quality: `
<svg viewBox="0 0 24 24">
  <path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/>
  <path d="M9 9l6 6"/>
  <path d="M15 9l-6 6"/>
</svg>
`,

    scanner: `<svg viewBox="0 0 24 24"><path d="M7 4h10a3 3 0 0 1 3 3v2H4V7a3 3 0 0 1 3-3z"/><path d="M8 9v8a4 4 0 0 0 8 0V9"/><path d="M10 13h4"/></svg>`,
    stock: `<svg viewBox="0 0 24 24"><path d="M5 6h14"/><path d="M5 12h14"/><path d="M5 18h14"/><path d="M8 6v12"/></svg>`,
history: `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 2"/>
    <path d="M7 4 4 7"/>
    <path d="M4 4v3h3"/>
  </svg>
`,
    paperPlane: `<svg viewBox="0 0 24 24"><path d="M21 4 3 11l7 3 3 7z"/><path d="M10 14 21 4"/></svg>`,
    checkCircle: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>`,
    analytics: `<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M7 17V9"/><path d="M12 17V5"/><path d="M17 17v-7"/><path d="M5 5l4 4 4-5 6 6"/></svg>`,
    pound: `<svg viewBox="0 0 24 24"><path d="M16 6a4 4 0 0 0-8 2v10"/><path d="M6 13h8"/><path d="M6 18h12"/></svg>`,
    support: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 1 1 5.6 1.5c-.7 1-2 1.4-2.4 2.7-.1.3-.2.7-.2 1.1"/><path d="M12 18h.01"/></svg>`,
    pulse: `<svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>`,
    activity: `<svg viewBox="0 0 24 24"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/><path d="M19 7l-4 4-3-3-4 4"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 3a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 3h5l.3-3a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z"/></svg>`
  };

  function fileName(path) {
    return String(path || "").split("?")[0].split("#")[0].replace(/\\/g, "/").split("/").pop() || "index.html";
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isLoginPage() {
    return fileName(window.location.pathname) === "login.html";
  }

  function isCollapsed() {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  }

  function setCollapsed(value) {
    localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
    document.body.classList.toggle("sidebar-collapsed", value);
  }

  function injectPortalEventsScript() {
    if (isLoginPage()) return;
    if (document.querySelector(`script[src="${PORTAL_EVENTS_SRC}"]`)) return;
    if (document.getElementById("portalEventsScript")) return;

    const script = document.createElement("script");
    script.id = "portalEventsScript";
    script.src = PORTAL_EVENTS_SRC;
    script.defer = true;
    document.head.appendChild(script);
  }


async function loadProfile() {
  try {
    currentProfile = null;

    if (typeof sb !== "function") {
      console.warn(
        "[Veynor] Supabase client is unavailable."
      );
      return null;
    }

    const db = sb();

    const { data: userData, error: authError } =
      await db.auth.getUser();

    if (authError) {
      throw authError;
    }

    const authUserId = userData?.user?.id;

    if (!authUserId) {
      return null;
    }

    const { data: profiles, error: profileError } =
      await db
        .from("user_profiles")
        .select(`
          *,
          companies (
            id,
            name
          ),
          customers (
            id,
            name,
            customer_code
          )
        `)
        .eq("auth_user_id", authUserId)
        .eq("is_active", true)
        .limit(2);

    if (profileError) {
      throw profileError;
    }

    if (!profiles || profiles.length !== 1) {
      console.warn(
        "[Veynor] No unique active user profile found."
      );
      return null;
    }

    if (!profiles[0].company_id) {
      console.warn(
        "[Veynor] Active profile has no company_id."
      );
      return null;
    }

    currentProfile = profiles[0];

    return currentProfile;

  } catch (error) {
    currentProfile = null;

    console.warn(
      "[Veynor] Layout profile load failed:",
      error?.message || error
    );

    return null;
  }
}

  function userRole() {
    return normalize(currentProfile?.role || "");
  }

  function canSee(item) {
    if (isLoginPage()) return true;
    if (!item.roles?.length) return true;
    return item.roles.includes(userRole());
  }

  function initials(value) {
    const text = String(value || "").trim();
    if (!text) return "VE";

    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  function roleLabel(role) {
    return {
      veynor_admin: "Veynor Admin",
      tenant_admin: "Tenant Admin",
      tenant_user: "Tenant User",
      product_owner_admin: "Product Owner Admin",
      product_owner_user: "Product Owner User",
      retailer_user: "Retailer User"
    }[normalize(role)] || "User";
  }


  // ==========================================================
  // SUPER ADMIN - SELECTED TENANT DISPLAY
  // ==========================================================

  async function getSelectedTenantForLayout() {
    if (userRole() !== ROLES.VEYNOR_ADMIN) {
      return null;
    }

    const tenantId =
      new URLSearchParams(window.location.search)
        .get("tenant");

    if (!tenantId) {
      return null;
    }

    const validUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!validUuid.test(tenantId)) {
      return null;
    }

    const { data, error } = await sb()
      .from("companies")
      .select("id, name, company_type, is_active")
      .eq("id", tenantId)
      .eq("company_type", "tenant")
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) {
      console.warn(
        "[Veynor Layout] Selected tenant unavailable.",
        error
      );
      return null;
    }

    return data;
  }


 
  // ==========================================================
  // ACCOUNT TITLE
  // ==========================================================

  function profileTitle() {
    const role = userRole();

    if (!currentProfile) {
      return "Veynor";
    }

    if (
      role === ROLES.VEYNOR_ADMIN &&
      window.VEYNOR_LAYOUT_TENANT?.name
    ) {
      return window.VEYNOR_LAYOUT_TENANT.name;
    }

    if (PRODUCT_OWNER_ROLES.includes(role)) {
      return (
        currentProfile.customers?.name ||
        currentProfile.full_name ||
        "Product Owner"
      );
    }

    if (role === ROLES.RETAILER_USER) {
      return (
        currentProfile.full_name ||
        currentProfile.retailer_code ||
        "Retailer"
      );
    }

    return (
      currentProfile.companies?.name ||
      currentProfile.full_name ||
      "Veynor"
    );
  }


  function icon(name) {
    return icons[name] || icons.dashboard;
  }



  // ==========================================================
  // SIDEBAR NAVIGATION - SUPER ADMIN TEST MODE
  // ==========================================================


function getTenantAwareUrl(href) {
  if (!href) return href;

  const tenantId = new URLSearchParams(
    window.location.search
  ).get("tenant");

  // Only Super Admin may carry tenant selection.
  if (
    userRole() !== ROLES.VEYNOR_ADMIN ||
    !tenantId
  ) {
    return href;
  }

  const validUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!validUuid.test(tenantId)) {
    return href;
  }

  const url = new URL(
    href,
    window.location.href
  );

  // Do not modify external links.
  if (url.origin !== window.location.origin) {
    return href;
  }

  // Super Admin itself must remain outside tenant view.
  if (url.pathname.startsWith("/admin/")) {
    return href;
  }

  url.searchParams.set("tenant", tenantId);

  return url.pathname + url.search + url.hash;
}
  

function renderNav(currentFile) {
    let lastGroup = "";

    // Temporary test mode for Veynor Super Admin.
    // Allows navigation to all existing modules.
    const SUPER_ADMIN_TEST_MODE = true;

    const isSuperAdminTenantView =
      userRole() === ROLES.VEYNOR_ADMIN &&
      Boolean(window.VEYNOR_LAYOUT_TENANT?.id);

    return menuItems.filter(canSee).map(item => {
      const group = item.group !== lastGroup
        ? `<div class="nav-group-label">${item.group}</div>`
        : "";

      lastGroup = item.group;

      const active =
        fileName(item.href) === currentFile
          ? "active"
          : "";

      // In test mode, navigation is unrestricted
      // for the authenticated Super Admin.
      const blocked =
        isSuperAdminTenantView &&
        !SUPER_ADMIN_TEST_MODE &&
        fileName(item.href) !== "index.html";

      const badgeHtml =
        item.badge && !blocked
          ? `<span
               class="nav-badge"
               data-nav-badge="${item.badge}"
               style="display:none;"
             >0</span>`
          : "";

      if (blocked) {
        return `
          ${group}
          <a
            href="#"
            class="${active}"
            aria-disabled="true"
            title="Tenant support not enabled"
            style="opacity:.48;cursor:not-allowed;"
            onclick="return false;"
          >
            <span class="nav-icon">
              ${icon(item.icon)}
            </span>

            <span class="nav-label">
              ${item.label}
            </span>
          </a>
        `;
      }

      return `
        ${group}
        <a
href="${getTenantAwareUrl(item.href)}"
          class="${active}"
          title="${item.label}"
        >
          <span class="nav-icon">
            ${icon(item.icon)}
          </span>

          <span class="nav-label">
            ${item.label}
          </span>

          ${badgeHtml}
        </a>
      `;
    }).join("");
  }

  function renderSystemStatusBlock() {
    if (isLoginPage()) return "";

    return `
      <div class="sidebar-system-status">
        <div class="system-status-top">
          <span class="system-pulse"></span>
          <span>Secure Cloud</span>
        </div>
        <div class="system-status-grid">
          <div><span class="system-label">Version</span><strong>${APP_VERSION}</strong></div>
          <div><span class="system-label">Data</span><strong>Live</strong></div>
        </div>
        <div class="system-status-foot">RBAC protected · Tenant data</div>
      </div>
    `;
  }


  // ==========================================================
  // GLOBAL ACCOUNT MENU
  // ==========================================================

  function renderAccountMenu() {
    if (isLoginPage()) return "";

    const title = profileTitle();
    const role = roleLabel(currentProfile?.role);

    const isTenantView =
      userRole() === ROLES.VEYNOR_ADMIN &&
      Boolean(window.VEYNOR_LAYOUT_TENANT?.id);

    const backToAdmin = isTenantView
      ? `
        <a href="/admin/">
          <span>↩</span>
          <div>
            <strong>Back to Super Admin</strong>
            <small>Return to tenant management</small>
          </div>
        </a>
      `
      : "";

    return `
      <div
        id="globalAccountMenu"
        class="global-account-menu"
      >
        <button
          id="globalAccountBtn"
          class="global-account-btn"
          type="button"
        >
          <span class="global-account-avatar">
            ${initials(title)}
          </span>

          <span class="global-account-text">
            <strong>${title}</strong>
            <small>${role}</small>
          </span>

          <span class="global-account-chevron">
            ⌄
          </span>
        </button>

        <div
          id="globalAccountDropdown"
          class="global-account-dropdown"
        >
          ${backToAdmin}

          <a href="./settings.html">
            <span>👤</span>
            <div>
              <strong>User profile</strong>
              <small>Account and tenant details</small>
            </div>
          </a>

          <a href="./support.html#release-notes">
            <span>📝</span>
            <div>
              <strong>Release notes</strong>
              <small>Version ${APP_VERSION}</small>
            </div>
          </a>

          <a href="./support.html">
            <span>❔</span>
            <div>
              <strong>Get support</strong>
              <small>Help center and support tickets</small>
            </div>
          </a>

          <button
            id="globalLogoutBtn"
            type="button"
            data-logout="true"
          >
            <span>⎋</span>
            <div>
              <strong>Log out</strong>
              <small>End current session</small>
            </div>
          </button>
        </div>
      </div>
    `;
  }

  function renderLogoutModal() {
    if (isLoginPage()) return "";

    return `
      <div id="logoutModal" class="logout-modal-backdrop" style="display:none;">
        <div class="logout-modal-card">
          <div class="logout-modal-icon">⎋</div>
          <h2>Log out?</h2>
          <p>Are you sure you want to log out of Veynor?</p>
          <div class="logout-modal-actions">
            <button id="cancelLogoutBtn" class="logout-cancel-btn" type="button">Cancel</button>
            <button id="confirmLogoutBtn" class="logout-confirm-btn" type="button" data-logout="true">Log out</button>
          </div>
        </div>
      </div>
    `;
  }

  function injectStyles() {
    if (document.getElementById("veynorLayoutStyles")) return;

    const style = document.createElement("style");
    style.id = "veynorLayoutStyles";
    style.textContent = `
      .sidebar{position:sticky;top:0;height:100vh;overflow:visible!important;padding:18px 10px 16px;display:flex;flex-direction:column;gap:12px;}
      .veynor-brand{position:relative;padding:0 0 4px;display:grid;justify-items:center;}

.veynor-top-logo {
  width: 112px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
}

.veynor-icon-large {
  width: 108px;
  height: 108px;
  object-fit: contain;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

.sidebar-toggle {
  position: absolute;
  top: 82px;
  right: -25px;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(125, 211, 252, .45) !important;
  border-radius: 50%;
  background: linear-gradient(
    135deg,
    #1267ff,
    #38bdf8
  ) !important;
  color: #fff !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
  z-index: 5000 !important;
  box-shadow: 0 18px 38px rgba(
    18, 103, 255, .35
  );
}
      .sidebar-toggle-icon{font-size:28px;font-weight:950;line-height:1;transform:rotate(180deg);}
      body.sidebar-collapsed .sidebar-toggle-icon{transform:rotate(0deg);}
      .sidebar-system-status{margin:8px 8px 2px;padding:12px;border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.035));border:1px solid rgba(125,211,252,.16);}
      .system-status-top{display:flex;align-items:center;gap:8px;color:#fff;font-size:11.5px;font-weight:950;margin-bottom:10px;}
      .system-pulse{width:8px;height:8px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.13);}
      .system-status-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
      .system-status-grid div{border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.045);border-radius:12px;padding:8px;display:grid;gap:3px;}
      .system-label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:rgba(219,234,254,.58);}
      .system-status-grid strong{font-size:11px;color:#fff;font-weight:950;}
      .system-status-foot{margin-top:9px;font-size:10px;line-height:1.35;color:rgba(219,234,254,.62);font-weight:800;}
      .sidebar-logout-wrap{padding:8px 12px 0;margin-top:auto;}
      .sidebar-logout-btn{width:100%;min-height:42px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.055);color:rgba(255,255,255,.88);font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;transition:.16s ease;}
      .sidebar-logout-btn:hover{background:rgba(239,68,68,.18);border-color:rgba(248,113,113,.35);color:#fff;transform:translateY(-1px);}
      .sidebar-wordmark{
  padding:18px 8px 8px;
  margin-top:0;
  display:flex;
  justify-content:center;
  align-items:center;
}

.veynor-wordmark-bottom {
  width: 180px;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  filter: none;
}
      body.sidebar-collapsed .veynor-top-logo{width:54px;height:54px;border-radius:18px;}
      body.sidebar-collapsed .veynor-icon-large{width:44px;height:44px;border-radius:13px;padding:4px;}
      body.sidebar-collapsed .sidebar-toggle{top:82px!important;right:-25px!important;width:38px!important;height:38px!important;}
      body.sidebar-collapsed .sidebar-system-status{padding:8px;display:flex;justify-content:center;}
      body.sidebar-collapsed .system-status-grid,body.sidebar-collapsed .system-status-foot,body.sidebar-collapsed .system-status-top span:not(.system-pulse),body.sidebar-collapsed .sidebar-wordmark,body.sidebar-collapsed .sidebar-logout-text{display:none;}
      body.sidebar-collapsed .sidebar-logout-btn{padding:0;}
      .page-topbar{position:relative;align-items:flex-start;}
      .topbar-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-left:auto;padding-right:0;}
      .global-account-menu{position:relative;z-index:50;}
      .global-account-btn{min-height:46px;border:1px solid #dce5f2;border-radius:999px;background:rgba(255,255,255,.96);box-shadow:0 12px 28px rgba(15,23,42,.10);display:flex;align-items:center;gap:10px;padding:6px 10px 6px 7px;cursor:pointer;color:#07152f;}
      .global-account-avatar{width:34px;height:34px;border-radius:999px;background:linear-gradient(135deg,#1267ff,#38bdf8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:950;}
      .global-account-text{display:grid;text-align:left;line-height:1.1;}
      .global-account-text strong{font-size:12.5px;font-weight:950;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .global-account-text small{font-size:10.5px;color:#667085;font-weight:800;}
      .global-account-chevron{font-size:16px;color:#667085;transition:.16s ease;}
      .global-account-menu.open .global-account-chevron{transform:rotate(180deg);}
      .global-account-dropdown{position:absolute;right:0;top:54px;width:300px;background:#fff;border:1px solid #dce5f2;border-radius:18px;box-shadow:0 28px 70px rgba(7,21,47,.22);padding:8px;display:none;}
      .global-account-menu.open .global-account-dropdown{display:grid;gap:4px;animation:accountDrop .14s ease-out;}
      @keyframes accountDrop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
      .global-account-dropdown a,.global-account-dropdown button{width:100%;border:0;background:transparent;text-decoration:none;color:#07152f;border-radius:13px;padding:11px;display:flex;gap:11px;align-items:flex-start;text-align:left;cursor:pointer;font-family:inherit;}
      .global-account-dropdown a:hover,.global-account-dropdown button:hover{background:#f3f7ff;}
      .global-account-dropdown span{width:22px;text-align:center;font-size:16px;}
      .global-account-dropdown strong{display:block;font-size:13px;font-weight:950;}
      .global-account-dropdown small{display:block;margin-top:3px;font-size:11px;color:#667085;font-weight:750;}
      .logout-modal-backdrop{position:fixed;inset:0;z-index:1000000;background:rgba(7,21,47,.54);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;}
      .logout-modal-card{width:min(420px,100%);background:#fff;border-radius:24px;border:1px solid #dce5f2;box-shadow:0 30px 80px rgba(7,21,47,.28);padding:28px;text-align:center;}
      .logout-modal-icon{width:56px;height:56px;margin:0 auto 14px;border-radius:18px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;background:linear-gradient(135deg,#1267ff,#38bdf8);}
      .logout-modal-card h2{margin:0;color:#07152f;font-size:24px;font-weight:950;}
      .logout-modal-card p{margin:10px 0 22px;color:#667085;line-height:1.5;font-size:13.5px;}
      .logout-modal-actions{display:flex;gap:10px;justify-content:center;}
      .logout-cancel-btn,.logout-confirm-btn{min-height:42px;border-radius:12px;padding:0 18px;font-weight:900;cursor:pointer;}
      .logout-cancel-btn{background:#fff;color:#07152f;border:1px solid #dce5f2;}
      .logout-confirm-btn{background:#ef4444;color:#fff;border:1px solid #ef4444;}
      @media(max-width:760px){.page-topbar{flex-direction:column;}.topbar-actions{width:100%;justify-content:flex-start;}.global-account-text{display:none;}.global-account-dropdown{left:0;right:auto;width:280px;}}
    .nav a{
    position:relative;
}

.nav-badge{
    margin-left:auto;
    min-width:18px;
    height:18px;
    padding:0 6px;
    border-radius:999px;
    background:#ef4444;
    color:#fff;
    font-size:10px;
    font-weight:900;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    box-shadow:0 0 0 3px rgba(239,68,68,.18);
    animation:sidebarBadgePulse 1.2s infinite;
}

@keyframes sidebarBadgePulse{
    0%{
        transform:scale(1);
    }

    50%{
        transform:scale(1.12);
    }

    100%{
        transform:scale(1);
    }
}

`;

    document.head.appendChild(style);
  }

  function injectAccountIntoTopbar() {
    if (isLoginPage()) return;
    if (document.getElementById("globalAccountMenu")) return;

    const pageTopbar = document.querySelector(".page-topbar");
    if (!pageTopbar) return;

    let actions = pageTopbar.querySelector(".topbar-actions");

    if (!actions) {
      actions = document.createElement("div");
      actions.className = "topbar-actions";
      pageTopbar.appendChild(actions);
    }

    actions.insertAdjacentHTML("beforeend", renderAccountMenu());
  }

  function openLogoutModal() {
    const modal = document.getElementById("logoutModal");
    if (modal) modal.style.display = "flex";
  }

  function closeLogoutModal() {
    const modal = document.getElementById("logoutModal");
    if (modal) modal.style.display = "none";
  }

  async function trackLogoutBeforeSignOut() {
    try {
      if (window.PortalEvents?.trackLogout) {
        await window.PortalEvents.trackLogout();
      } else if (window.PortalEvents?.track) {
        await window.PortalEvents.track({
          eventType: "logout",
          description: "User logged out"
        });
      }
    } catch (error) {
      console.warn("Logout tracking skipped:", error.message);
    }
  }


  // ============================================================
  // VEYNOR — TWO-HOUR INACTIVITY MANAGEMENT
  // ============================================================

  function getLastActivity() {
    const value = Number(
      localStorage.getItem(LAST_ACTIVITY_KEY)
    );

    return Number.isFinite(value) && value > 0
      ? value
      : null;
  }

  function clearInactivityStorage() {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
  }

  function removeInactivityWarning() {
    document.getElementById(
      "veynorInactivityWarning"
    )?.remove();

    inactivityWarningVisible = false;
  }

  function showInactivityWarning(remainingMs) {
    let warning = document.getElementById(
      "veynorInactivityWarning"
    );

    if (!warning) {
      warning = document.createElement("div");
      warning.id = "veynorInactivityWarning";

      Object.assign(warning.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "999999",
        width: "340px",
        maxWidth: "calc(100vw - 32px)",
        padding: "18px",
        borderRadius: "16px",
        background: "#07152f",
        color: "#ffffff",
        boxShadow: "0 20px 60px rgba(0,0,0,.25)",
        fontFamily: "inherit",
        fontSize: "13px",
        lineHeight: "1.5"
      });

      warning.innerHTML = `
        <strong style="font-size:15px;">
          Session expiring soon
        </strong>

        <div style="margin-top:8px;">
          You will be logged out after two hours
          of inactivity.
        </div>

        <div
          id="veynorInactivityCountdown"
          style="margin-top:10px;font-weight:900;"
        ></div>

        <button
          id="veynorStaySignedIn"
          type="button"
          style="
            margin-top:12px;
            border:0;
            border-radius:10px;
            background:#1267ff;
            color:white;
            padding:10px 16px;
            font-weight:900;
            cursor:pointer;
          "
        >
          Stay signed in
        </button>
      `;

      document.body.appendChild(warning);

      document.getElementById(
        "veynorStaySignedIn"
      )?.addEventListener("click", () => {
        recordUserActivity(true);
      });
    }

    const minutes = Math.max(
      0,
      Math.ceil(remainingMs / 60000)
    );

    const countdown = document.getElementById(
      "veynorInactivityCountdown"
    );

    if (countdown) {
      countdown.textContent =
        `${minutes} minute(s) remaining`;
    }

    inactivityWarningVisible = true;
  }

  function recordUserActivity(force = false) {
    if (inactivityLogoutStarted) return;

    const now = Date.now();
    const lastActivity = getLastActivity();

    // Never revive an already expired session.
    if (
      lastActivity !== null &&
      now - lastActivity >= INACTIVITY_LIMIT_MS
    ) {
      void expireInactiveSession();
      return;
    }

    // Avoid excessive localStorage writes.
    if (
      !force &&
      now - lastActivitySave <
        ACTIVITY_SAVE_INTERVAL_MS
    ) {
      return;
    }

    localStorage.setItem(
      LAST_ACTIVITY_KEY,
      String(now)
    );

    lastActivitySave = now;

    if (inactivityWarningVisible) {
      removeInactivityWarning();
    }
  }

  async function expireInactiveSession() {
    if (inactivityLogoutStarted) return;

    inactivityLogoutStarted = true;

    removeInactivityWarning();

    clearInactivityStorage();

    try {
      if (typeof sb === "function") {
        await sb().auth.signOut();
      }
    } catch (error) {
      console.warn(
        "[Veynor] Inactivity sign-out failed:",
        error
      );
    }

    window.location.replace(
      "/login.html?reason=inactive"
    );
  }

  function checkInactivity() {
    if (inactivityLogoutStarted) return;

    const lastActivity = getLastActivity();

    if (lastActivity === null) {
      // Do not silently extend an unknown session.
      void expireInactiveSession();
      return;
    }

    const elapsed = Date.now() - lastActivity;

    if (elapsed >= INACTIVITY_LIMIT_MS) {
      void expireInactiveSession();
      return;
    }

    const remaining =
      INACTIVITY_LIMIT_MS - elapsed;

    if (remaining <= INACTIVITY_WARNING_MS) {
      showInactivityWarning(remaining);
    } else if (inactivityWarningVisible) {
      removeInactivityWarning();
    }
  }

  function initializeInactivityTracking() {
    if (
      inactivityTrackingReady ||
      isLoginPage()
    ) {
      return;
    }

    inactivityTrackingReady = true;

    // Validate existing session before registering
    // any activity.
    checkInactivity();

    if (inactivityLogoutStarted) return;

    const activityEvents = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "pointerdown"
    ];

    activityEvents.forEach(eventName => {
      document.addEventListener(
        eventName,
        () => recordUserActivity(),
        { passive: true }
      );
    });

    window.addEventListener("focus", () => {
      checkInactivity();
    });

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          checkInactivity();
        }
      }
    );

    window.addEventListener(
      "storage",
      event => {
        if (
          event.key === LAST_ACTIVITY_KEY ||
          event.key === SESSION_USER_KEY
        ) {
          checkInactivity();
        }
      }
    );

    setInterval(
      checkInactivity,
      SESSION_CHECK_INTERVAL_MS
    );
  }



async function logout() {
  inactivityLogoutStarted = true;

  removeInactivityWarning();

  await trackLogoutBeforeSignOut();

  clearInactivityStorage();

  try {
    if (typeof sb === "function") {
      await sb().auth.signOut();
    }
  } catch (error) {
    console.error(
      "[Veynor] Logout failed:",
      error
    );
  }

  window.location.replace("/login.html");
}

  function bindAccountMenu() {
    const menu = document.getElementById("globalAccountMenu");
    const btn = document.getElementById("globalAccountBtn");

    if (!menu || !btn) return;

    btn.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.toggle("open");
    });

    document.querySelectorAll("#globalAccountDropdown a").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const href = link.getAttribute("href");
        if (href) window.location.href = href;
      });
    });

    document.getElementById("globalLogoutBtn")?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.remove("open");
      openLogoutModal();
    });

    document.addEventListener("click", event => {
      if (!menu.contains(event.target)) menu.classList.remove("open");
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") menu.classList.remove("open");
    });
  }

  function bindLogoutEvents() {
    document.getElementById("sidebarLogoutBtn")?.addEventListener("click", event => {
      event.preventDefault();
      openLogoutModal();
    });

    document.getElementById("cancelLogoutBtn")?.addEventListener("click", closeLogoutModal);
    document.getElementById("confirmLogoutBtn")?.addEventListener("click", logout);

    document.getElementById("logoutModal")?.addEventListener("click", event => {
      if (event.target.id === "logoutModal") closeLogoutModal();
    });
  }


async function updateMessageCenterNavBadge() {
  try {
    const badge = document.querySelector(
      '[data-nav-badge="message-center"]'
    );

    const isSuperAdminTenantView =
      userRole() === ROLES.VEYNOR_ADMIN &&
      Boolean(window.VEYNOR_LAYOUT_TENANT?.id);

    // Message Center is not yet tenant-aware.
    // Do not display unread counts from the
    // administrator's original company.
    if (isSuperAdminTenantView) {
      if (badge) {
        badge.textContent = "0";
        badge.style.display = "none";
      }

      window.VeynorUnreadCounts = {
        messages: 0,
        notifications: 0,
        total: 0
      };

      window.dispatchEvent(
        new CustomEvent("veynor:unread-counts", {
          detail: window.VeynorUnreadCounts
        })
      );

      return;
    }

    if (!currentProfile || typeof sb !== "function") {
      return;
    }

    const companyId = currentProfile.company_id;
    const customerId = currentProfile.customer_id;
    const profileId = currentProfile.id;
    const role = currentProfile.role;

    if (!companyId) {
      return;
    }

    const db = sb();

    let messagesQuery = db
      .from("messages")
      .select("id", {
        count: "exact",
        head: true
      })
      .eq("company_id", companyId)
      .is("read_at", null)
      .neq("sender_profile_id", profileId);

    let notificationsQuery = db
      .from("system_notifications")
      .select("id", {
        count: "exact",
        head: true
      })
      .eq("company_id", companyId)
      .eq("is_read", false);

    if (customerId) {
      messagesQuery = messagesQuery.eq(
        "customer_id",
        customerId
      );

      notificationsQuery = notificationsQuery.eq(
        "customer_id",
        customerId
      );
    }

    const recipientFilter =
      `recipient_profile_id.eq.${profileId},` +
      `recipient_role.eq.${role},` +
      `recipient_role.is.null`;

    messagesQuery = messagesQuery.or(
      recipientFilter
    );

    notificationsQuery = notificationsQuery.or(
      recipientFilter
    );

    const [
      messagesResult,
      notificationsResult
    ] = await Promise.all([
      messagesQuery,
      notificationsQuery
    ]);

    if (messagesResult.error) {
      throw messagesResult.error;
    }

    if (notificationsResult.error) {
      throw notificationsResult.error;
    }

    const unreadMessages =
      messagesResult.count || 0;

    const unreadNotifications =
      notificationsResult.count || 0;

    const total =
      unreadMessages + unreadNotifications;

    if (badge) {
      badge.textContent = String(total);
      badge.style.display =
        total > 0 ? "inline-flex" : "none";
    }

    window.VeynorUnreadCounts = {
      messages: unreadMessages,
      notifications: unreadNotifications,
      total
    };

    window.dispatchEvent(
      new CustomEvent("veynor:unread-counts", {
        detail: window.VeynorUnreadCounts
      })
    );

  } catch (error) {
    console.warn(
      "[Veynor] Message Center badge failed:",
      error
    );
  }
}

  function renderSidebar() {
    const mount = document.getElementById("sidebarMount");
    if (!mount) return;

    injectStyles();

    const currentFile = fileName(window.location.pathname);
    document.body.classList.toggle("sidebar-collapsed", isCollapsed());

    mount.innerHTML = `
      <div class="veynor-brand">
        <div class="veynor-top-logo">
<img src="/assets/logos/veynor-symbol.png" alt="Veynor" class="veynor-icon-large">        </div>

        <button id="sidebarToggle" class="sidebar-toggle" type="button" aria-label="Toggle sidebar">
          <span class="sidebar-toggle-icon">‹</span>
        </button>
      </div>

      ${renderSystemStatusBlock()}

      <nav class="nav">
        ${renderNav(currentFile)}
      </nav>

      <div class="sidebar-logout-wrap">
        <button id="sidebarLogoutBtn" class="sidebar-logout-btn" type="button" data-logout="true">
          <span class="sidebar-logout-icon">⎋</span>
          <span class="sidebar-logout-text">Log out</span>
        </button>
      </div>


<div class="sidebar-wordmark">
  <img
    src="/assets/logos/veynor-wordmark-footer.png"
    alt="Veynor"
    class="veynor-wordmark-bottom"
  >
</div>
    `;

    document.getElementById("sidebarToggle")?.addEventListener("click", () => {
      setCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });
  }

function injectFavicon() {

  document.querySelectorAll(
    'link[rel="icon"], link[rel="shortcut icon"]'
  ).forEach(el => el.remove());

  const link = document.createElement("link");

  link.rel = "icon";
  link.href = "/assets/icons/favicon.ico?v=3";

  document.head.appendChild(link);
}

document.addEventListener("DOMContentLoaded", async () => {

    injectFavicon();
    injectPortalEventsScript();


await loadProfile();


  // ==========================================================
  // LOAD SUPER ADMIN TENANT DISPLAY
  // ==========================================================

  window.VEYNOR_LAYOUT_TENANT = null;

  if (
    currentProfile &&
    userRole() === ROLES.VEYNOR_ADMIN
  ) {
    try {
      window.VEYNOR_LAYOUT_TENANT =
        await getSelectedTenantForLayout();

      if (window.VEYNOR_LAYOUT_TENANT) {
        console.info(
          "[Veynor Layout] Viewing tenant:",
          window.VEYNOR_LAYOUT_TENANT.name
        );
      }
    } catch (error) {
      console.warn(
        "[Veynor Layout] Tenant display failed:",
        error
      );
    }
  }


if (!isLoginPage() && currentProfile) {
  initializeInactivityTracking();
}

if (inactivityLogoutStarted) {
  return;
}

renderSidebar();

await updateMessageCenterNavBadge();

window.VeynorUpdateMessageCenterNavBadge = updateMessageCenterNavBadge;

setInterval(updateMessageCenterNavBadge, 5000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateMessageCenterNavBadge();
});


    if (!document.getElementById("logoutModal")) {
      document.body.insertAdjacentHTML("beforeend", renderLogoutModal());
    }

    injectAccountIntoTopbar();
    bindAccountMenu();
    bindLogoutEvents();
  });
})();

(function loadSystemMonitor() {
  if (window.__systemMonitorScriptLoaded) return;
  window.__systemMonitorScriptLoaded = true;

  const script = document.createElement("script");
  script.src = "/js/system-monitor.js?v=20260724-1";
  script.defer = true;
  document.head.appendChild(script);
})();

(function loadNotificationService() {
  if (window.__notificationServiceLoaded) return;
  window.__notificationServiceLoaded = true;

  const script = document.createElement("script");
  script.src = "/js/notification-service.js";
  script.defer = true;
  document.head.appendChild(script);
})();