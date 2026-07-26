(function () {
  "use strict";

  const SIDEBAR_KEY = "veynor_sidebar_collapsed";
  const APP_VERSION = "v1.4.8";
  const PORTAL_EVENTS_SRC = "/js/portal-events.js";

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

    { href: "./orders.html", label: "Orders & Route Planner", icon: "truckRoute", group: "Planning", roles: TENANT_ROLES },
{
  href: "./service-jobs.html",
  label: "Service Jobs",
  icon: "serviceJob",
  group: "Planning",
  roles: TENANT_ROLES
},
    { href: "./products.html", label: "Products", icon: "box", group: "Warehouse", roles: TENANT_ROLES },
    { href: "./scan.html", label: "Scan In / Out", icon: "scanner", group: "Warehouse", roles: TENANT_ROLES },
    { href: "./stock.html", label: "Current Stock", icon: "stock", group: "Warehouse", roles: [...TENANT_ROLES, ...PRODUCT_OWNER_ROLES] },
    { href: "./outbound.html", label: "Outbound History", icon: "paperPlane", group: "Warehouse", roles: TENANT_ROLES },
    { href: "./inventory.html", label: "Inventory Check", icon: "checkCircle", group: "Warehouse", roles: TENANT_ROLES },

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
    truckRoute: `<svg viewBox="0 0 24 24"><path d="M3 8h11v8H3z"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="7" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>`,
    box: `<svg viewBox="0 0 24 24"><path d="M12 3 4 7l8 4 8-4z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/></svg>`,
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
    scanner: `<svg viewBox="0 0 24 24"><path d="M7 4h10a3 3 0 0 1 3 3v2H4V7a3 3 0 0 1 3-3z"/><path d="M8 9v8a4 4 0 0 0 8 0V9"/><path d="M10 13h4"/></svg>`,
    stock: `<svg viewBox="0 0 24 24"><path d="M5 6h14"/><path d="M5 12h14"/><path d="M5 18h14"/><path d="M8 6v12"/></svg>`,
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
      if (typeof sb !== "function") return null;

      const db = sb();
      const { data: userData } = await db.auth.getUser();

      if (!userData?.user?.id) return null;

      let result = await db
        .from("user_profiles")
        .select(`
          *,
          companies ( id, name ),
          customers ( id, name, customer_code )
        `)
        .eq("id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!result.data && !result.error) {
        result = await db
          .from("user_profiles")
          .select(`
            *,
            companies ( id, name ),
            customers ( id, name, customer_code )
          `)
          .eq("auth_user_id", userData.user.id)
          .eq("is_active", true)
          .maybeSingle();
      }

      if (result.error) {
        console.warn("Layout profile query failed:", result.error.message);
        return null;
      }

      currentProfile = result.data || null;
      return currentProfile;
    } catch (error) {
      console.warn("Layout profile load failed:", error);
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

  function profileTitle() {
    const role = userRole();

    if (!currentProfile) return "Veynor";

    if (PRODUCT_OWNER_ROLES.includes(role)) {
      return currentProfile.customers?.name || currentProfile.full_name || "Product Owner";
    }

    if (role === ROLES.RETAILER_USER) {
      return currentProfile.full_name || currentProfile.retailer_code || "Retailer";
    }

    return currentProfile.companies?.name || currentProfile.full_name || "Veynor";
  }

  function icon(name) {
    return icons[name] || icons.dashboard;
  }

  function renderNav(currentFile) {
    let lastGroup = "";

    return menuItems.filter(canSee).map(item => {
      const group = item.group !== lastGroup
        ? `<div class="nav-group-label">${item.group}</div>`
        : "";

      lastGroup = item.group;

      const active = fileName(item.href) === currentFile ? "active" : "";

      return `
        ${group}
        <a href="${item.href}" class="${active}" title="${item.label}">
  <span class="nav-icon">${icon(item.icon)}</span>

  <span class="nav-label">${item.label}</span>

  ${
    item.badge
      ? `<span class="nav-badge" data-nav-badge="${item.badge}" style="display:none;">0</span>`
      : ""
  }
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

  function renderAccountMenu() {
    if (isLoginPage()) return "";

    const title = profileTitle();
    const role = roleLabel(currentProfile?.role);

    return `
      <div id="globalAccountMenu" class="global-account-menu">
        <button id="globalAccountBtn" class="global-account-btn" type="button">
          <span class="global-account-avatar">${initials(title)}</span>
          <span class="global-account-text">
            <strong>${title}</strong>
            <small>${role}</small>
          </span>
          <span class="global-account-chevron">⌄</span>
        </button>

        <div id="globalAccountDropdown" class="global-account-dropdown">
          <a href="./settings.html">
            <span>👤</span>
            <div><strong>User profile</strong><small>Account and tenant details</small></div>
          </a>

          <a href="./support.html#release-notes">
            <span>📝</span>
            <div><strong>Release notes</strong><small>Version ${APP_VERSION}</small></div>
          </a>

          <a href="./support.html">
            <span>❔</span>
            <div><strong>Get support</strong><small>Help center and support tickets</small></div>
          </a>

          <button id="globalLogoutBtn" type="button" data-logout="true">
            <span>⎋</span>
            <div><strong>Log out</strong><small>End current session</small></div>
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
      .veynor-top-logo{width:112px;height:112px;border-radius:32px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.10);box-shadow:0 20px 44px rgba(0,0,0,.24);}
      .veynor-icon-large{width:88px;height:88px;object-fit:contain;border-radius:23px;background:#fff;padding:8px;box-shadow:0 12px 26px rgba(0,0,0,.22);}
      .sidebar-toggle{position:absolute!important;top:116px!important;right:-30px!important;width:44px!important;height:44px!important;border-radius:999px!important;border:1px solid rgba(125,211,252,.45)!important;background:linear-gradient(135deg,#1267ff,#38bdf8)!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;z-index:5000!important;box-shadow:0 18px 38px rgba(18,103,255,.35);}
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
      .sidebar-wordmark{padding:14px 12px 4px;margin-top:0;}
      .veynor-wordmark-bottom{width:112px;border-radius:22px;background:rgba(255,255,255,.92);padding:9px 16px;box-shadow:0 16px 34px rgba(0,0,0,.22);}
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

  async function logout() {
    await trackLogoutBeforeSignOut();

    try {
      if (typeof sb === "function") await sb().auth.signOut();
    } catch (error) {
      console.error("Logout failed:", error);
    }

    window.location.href = "/login.html";
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
    if (!currentProfile || typeof sb !== "function") return;

    const db = sb();

    const unreadMessagesQuery = db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .neq("sender_profile_id", currentProfile.id);

    const unreadNotificationsQuery = db
      .from("system_notifications")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false);

    if (currentProfile.company_id) {
      unreadMessagesQuery.eq("company_id", currentProfile.company_id);
      unreadNotificationsQuery.eq("company_id", currentProfile.company_id);
    }

    if (currentProfile.customer_id) {
      unreadMessagesQuery.eq("customer_id", currentProfile.customer_id);
      unreadNotificationsQuery.eq("customer_id", currentProfile.customer_id);
    }

    unreadMessagesQuery.or(
      `recipient_profile_id.eq.${currentProfile.id},recipient_role.eq.${currentProfile.role},recipient_role.is.null`
    );

    unreadNotificationsQuery.or(
      `recipient_profile_id.eq.${currentProfile.id},recipient_role.eq.${currentProfile.role},recipient_role.is.null`
    );

    const [messagesRes, notificationsRes] = await Promise.all([
      unreadMessagesQuery,
      unreadNotificationsQuery
    ]);

    const unreadMessages = messagesRes.count || 0;
    const unreadNotifications = notificationsRes.count || 0;
    const total = unreadMessages + unreadNotifications;

    const badge = document.querySelector('[data-nav-badge="message-center"]');
    if (badge) {
      badge.textContent = String(total);
      badge.style.display = total > 0 ? "inline-flex" : "none";
    }

    window.VeynorUnreadCounts = {
      messages: unreadMessages,
      notifications: unreadNotifications,
      total
    };

    window.dispatchEvent(new CustomEvent("veynor:unread-counts", {
      detail: window.VeynorUnreadCounts
    }));

  } catch (error) {
    console.warn("Message Center badge failed:", error);
  }
}

async function updateMessageCenterNavBadge() {
  try {
    if (!currentProfile || typeof sb !== "function") return;

    const db = sb();

    let query = db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .neq("sender_profile_id", currentProfile.id);

    if (currentProfile.role) {
      query = query.or(
        `recipient_profile_id.eq.${currentProfile.id},recipient_role.eq.${currentProfile.role},recipient_role.is.null`
      );
    }

    if (currentProfile.customer_id) {
      query = query.eq("customer_id", currentProfile.customer_id);
    }

    const { count, error } = await query;

    if (error) {
      console.warn("Message Center badge failed:", error.message);
      return;
    }

    const badge = document.querySelector('[data-nav-badge="message-center"]');
    if (!badge) return;

    badge.textContent = String(count || 0);
    badge.style.display = count > 0 ? "inline-flex" : "none";
  } catch (error) {
    console.warn("Message Center badge failed:", error);
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
          <img src="./assets/veynor-icon2.png" alt="Veynor" class="veynor-icon-large">
        </div>

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
        <img src="./assets/veynor-wordmark.png" alt="veynor" class="veynor-wordmark-bottom">
      </div>
    `;

    document.getElementById("sidebarToggle")?.addEventListener("click", () => {
      setCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });
  }

function injectFavicon() {
    if (document.querySelector('link[rel="icon"]')) return;

    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = "./assets/Icons/veynor-logo.svg";

    document.head.appendChild(link);
}

document.addEventListener("DOMContentLoaded", async () => {

    injectFavicon();
    injectPortalEventsScript();

    await loadProfile();

renderSidebar();
await updateMessageCenterNavBadge();

window.VeynorUpdateMessageCenterNavBadge = updateMessageCenterNavBadge;

setInterval(updateMessageCenterNavBadge, 5000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateMessageCenterNavBadge();
});

setInterval(updateMessageCenterNavBadge, 5000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateMessageCenterNavBadge();
});

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