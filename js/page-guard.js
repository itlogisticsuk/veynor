
/* ============================================================
   VEYNOR SYSTEMS
   PAGE GUARD v1.5.0

   Authentication, role access and tenant navigation context

   SUPPORTED:
   - Veynor Super Admin
   - Tenant Administrator
   - Tenant User
   - Product Owner Administrator
   - Product Owner User
   - Retailer User
   - Existing Veynor page permissions
   - Requested tenant context for Super Admin

   SECURITY:
   - Tenant URL parameters do not grant data access
   - Existing company_id is never modified
   - No browser-side impersonation
   - No service_role credentials
   ============================================================ */

(function () {
  "use strict";

  document.documentElement.classList.add(
    "auth-loading"
  );

  // ==========================================================
  // 1. CONFIGURATION
  // ==========================================================

  const CONFIG = Object.freeze({
    version: "1.5.0",

    loginUrl: "/login.html",
    adminUrl: "/admin/",
    indexUrl: "/index.html",

    adminRole: "veynor_admin",

    tenantParameter: "tenant"
  });

  // ==========================================================
  // 2. ROLE GROUPS
  // ==========================================================

  const TENANT_ROLES = [
    "veynor_admin",
    "tenant_admin",
    "tenant_user"
  ];

  const PRODUCT_OWNER_ROLES = [
    "product_owner_admin",
    "product_owner_user"
  ];

  const RETAILER_ROLES = [
    "retailer_user"
  ];

  const CUSTOMER_ROLES = [
    ...PRODUCT_OWNER_ROLES,
    ...RETAILER_ROLES
  ];

  const ALL_ROLES = [
    ...TENANT_ROLES,
    ...CUSTOMER_ROLES
  ];

  // ==========================================================
  // 3. PAGE ACCESS RULES
  // ==========================================================

  const PAGE_RULES = {

    // Main portal
    index: TENANT_ROLES,

    // Platform administration
    admin: ["veynor_admin"],

    // Customer portal
    "customer-dashboard": [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    // Orders
    "order-import": [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    "order-matching": TENANT_ROLES,

    "operations-control-center": ALL_ROLES,

    quality: [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    orders: TENANT_ROLES,

    // Products
    products: TENANT_ROLES,

    // Warehouse
    "inbound-containers": [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    scan: TENANT_ROLES,

    stock: [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    "stock-history": [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    "storage-invoicing": [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    outbound: TENANT_ROLES,

    inventory: TENANT_ROLES,

    // Delivery
    pod: ALL_ROLES,

    // Finance
    billing: [
      ...TENANT_ROLES,
      ...PRODUCT_OWNER_ROLES
    ],

    // Analytics
    analytics: TENANT_ROLES,

    reports: TENANT_ROLES,

    // Activity
    events: TENANT_ROLES,

    "customer-activity": TENANT_ROLES,

    // Support
    support: ALL_ROLES,

    // Settings
    settings: [
      "veynor_admin",
      "tenant_admin"
    ]

  };

  // ==========================================================
  // 4. STATE
  // ==========================================================

  let currentUser = null;
  let currentProfile = null;

  let currentRole = null;

  let requestedTenantId = null;

  let guardCompleted = false;

  // ==========================================================
  // 5. HELPERS
  // ==========================================================

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value ?? "")
    );
  }

  function getClient() {
    if (typeof window.sb !== "function") {
      throw new Error(
        "Supabase client is not available."
      );
    }

    const client = window.sb();

    if (
      !client?.auth ||
      typeof client.from !== "function"
    ) {
      throw new Error(
        "Invalid Supabase client."
      );
    }

    return client;
  }

  // ==========================================================
  // 6. PAGE IDENTIFICATION
  // ==========================================================

  function pageKey() {
    const pathname = String(
      window.location.pathname || ""
    )
      .replace(/\\/g, "/")
      .toLowerCase();

    // Super Admin routes
    if (
      pathname === "/admin" ||
      pathname === "/admin/" ||
      pathname === "/admin/index.html"
    ) {
      return "admin";
    }

    let name = pathname
      .split("/")
      .pop();

    if (!name) {
      name = "index.html";
    }

    return name
      .replace(/\.html$/, "")
      .trim();
  }

  // ==========================================================
  // 7. PAGE VISIBILITY
  // ==========================================================

  function showPage() {
    document.documentElement.classList.remove(
      "auth-loading"
    );
  }

  // ==========================================================
  // 8. LOGIN REDIRECT
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

  // ==========================================================
  // 9. DEFAULT PORTAL
  // ==========================================================

  function defaultBackUrl(role) {
    if (role === CONFIG.adminRole) {
      return CONFIG.adminUrl;
    }

    if (TENANT_ROLES.includes(role)) {
      return "/operations-control-center.html";
    }

    if (PRODUCT_OWNER_ROLES.includes(role)) {
      return "/customer-dashboard.html";
    }

    if (RETAILER_ROLES.includes(role)) {
      return "/operations-control-center.html";
    }

    return CONFIG.loginUrl;
  }

  // ==========================================================
  // 10. ACCESS DENIED
  // ==========================================================

  function blockPage(message, role = "") {
    guardCompleted = true;

    showPage();

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
      background:#fff;
      border:1px solid #dce5f2;
      border-radius:20px;
      text-align:center;
      box-shadow:0 20px 50px rgba(15,23,42,.10);
    `;

    const heading = document.createElement("h1");

    heading.textContent = "Access denied";

    heading.style.cssText = `
      margin:0 0 12px;
      color:#07152f;
    `;

    const description = document.createElement("p");

    description.textContent = String(
      message || "Access is not permitted."
    );

    description.style.cssText = `
      color:#667085;
      line-height:1.6;
    `;

    const link = document.createElement("a");

    link.href = defaultBackUrl(role);
    link.textContent = "Back to portal";

    link.style.cssText = `
      display:inline-block;
      margin-top:18px;
      padding:12px 20px;
      background:#1267ff;
      color:#fff;
      border-radius:10px;
      text-decoration:none;
      font-weight:800;
    `;

    panel.append(
      heading,
      description,
      link
    );

    main.appendChild(panel);
    document.body.appendChild(main);
  }

  // ==========================================================
  // 11. LOAD USER PROFILE
  // ==========================================================

  async function loadProfile(client, userId) {
    // First try the existing profile ID convention.
    let result = await client
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        role,
        is_active,
        company_id,
        customer_id,
        retailer_code
      `)
      .eq("id", userId)
      .eq("is_active", true)
      .maybeSingle();

    // Fallback to auth_user_id.
    if (!result.data && !result.error) {
      result = await client
        .from("user_profiles")
        .select(`
          id,
          auth_user_id,
          role,
          is_active,
          company_id,
          customer_id,
          retailer_code
        `)
        .eq("auth_user_id", userId)
        .eq("is_active", true)
        .maybeSingle();
    }

    if (result.error) {
      throw result.error;
    }

    return result.data || null;
  }

  // ==========================================================
  // 12. ROLE VALIDATION
  // ==========================================================

  function validateRole(profile, allowedRoles) {
    if (!profile?.is_active) {
      return false;
    }

    const role = normalize(profile.role);

    if (!role) {
      return false;
    }

    return allowedRoles.includes(role);
  }

  // ==========================================================
  // 13. REQUESTED TENANT
  // ==========================================================

  function getRequestedTenantId(role) {
    // Only the Super Admin may request a tenant.
    if (role !== CONFIG.adminRole) {
      return null;
    }

    const params = new URLSearchParams(
      window.location.search
    );

    const tenantId = params.get(
      CONFIG.tenantParameter
    );

    if (!tenantId) {
      return null;
    }

    if (!isUuid(tenantId)) {
      console.warn(
        "[page-guard] Invalid requested tenant ID."
      );

      return null;
    }

    return tenantId.toLowerCase();
  }

  // ==========================================================
  // 14. TENANT NAVIGATION CONTEXT
  // ==========================================================

  function establishTenantContext(profile, role) {
    const profileCompanyId =
      profile?.company_id || null;

    requestedTenantId =
      getRequestedTenantId(role);

    // Existing company assignment is preserved.
    window.VEYNOR_PROFILE_COMPANY_ID =
      profileCompanyId;

    // A URL request is NOT an authorized tenant.
    window.VEYNOR_REQUESTED_TENANT_ID =
      requestedTenantId;

    // No cross-tenant access is granted here.
    window.VEYNOR_TENANT_OVERRIDE_AUTHORIZED =
      false;

    window.VEYNOR_TENANT_CONTEXT = {
      role,
      profileCompanyId,
      requestedTenantId,
      switchingRequested:
        role === CONFIG.adminRole &&
        Boolean(requestedTenantId),

      authorizedOverride: false
    };
  }

  // ==========================================================
  // 15. SUPER ADMIN HELPERS
  // ==========================================================

  function isSuperAdmin() {
    return currentRole === CONFIG.adminRole;
  }

  function getAdminUrl() {
    return CONFIG.adminUrl;
  }

  function getTenantNavigationUrl(tenantId) {
    if (!isSuperAdmin()) {
      return null;
    }

    if (!isUuid(tenantId)) {
      return null;
    }

    return (
      CONFIG.indexUrl +
      "?tenant=" +
      encodeURIComponent(tenantId)
    );
  }

  // ==========================================================
  // 16. EXPOSE READ-ONLY NAVIGATION HELPERS
  // ==========================================================

  function exposeHelpers() {
    window.VEYNOR_PAGE_GUARD = Object.freeze({
      version: CONFIG.version,

      isSuperAdmin,

      getAdminUrl,

      getTenantNavigationUrl,

      getRequestedTenantId: () =>
        requestedTenantId,

      getRole: () =>
        currentRole,

      getProfileCompanyId: () =>
        currentProfile?.company_id || null,

      isReady: () =>
        guardCompleted
    });
  }

  // ==========================================================
  // 17. MAIN PAGE GUARD
  // ==========================================================

  async function guardPage() {
    const key = pageKey();

    // Login page remains public.
    if (key === "login") {
      guardCompleted = true;
      showPage();
      return;
    }

    const allowedRoles = PAGE_RULES[key];

    // Preserve legacy behaviour for pages
    // without a defined page rule.
    // This is not an authorization grant.
    if (!allowedRoles) {
      console.warn(
        "[page-guard] No rule for page:",
        key
      );

      guardCompleted = true;
      showPage();
      return;
    }

    const client = getClient();

    // Verify user with Supabase Auth.
    const {
      data: authData,
      error: authError
    } = await client.auth.getUser();

    if (authError || !authData?.user?.id) {
      redirectToLogin();
      return;
    }

    const user = authData.user;

    currentUser = user;

    // Load the existing user profile.
    const profile = await loadProfile(
      client,
      user.id
    );

    if (!profile?.role) {
      blockPage(
        "No active profile was found for this login."
      );
      return;
    }

    const role = normalize(profile.role);

    currentProfile = profile;
    currentRole = role;

    // Verify page access.
    if (!validateRole(profile, allowedRoles)) {
      blockPage(
        "Your account does not have permission to open this page.",
        role
      );
      return;
    }

    // Expose existing user context.
    window.VEYNOR_CURRENT_USER = user;

    window.VEYNOR_CURRENT_PROFILE = profile;

    // Establish navigation-only tenant context.
    establishTenantContext(
      profile,
      role
    );

    // Expose navigation helpers.
    exposeHelpers();

    guardCompleted = true;

    console.info(
      "[Veynor Page Guard] Access verified",
      {
        version: CONFIG.version,
        page: key,
        role,
        companyId: profile.company_id,
        requestedTenantId,
        tenantOverrideAuthorized: false
      }
    );

    showPage();
  }

  // ==========================================================
  // 18. INITIALIZATION
  // ==========================================================

  function init() {
    guardPage().catch(error => {
      console.error(
        "[Veynor Page Guard]",
        error
      );

      blockPage(
        error?.message ||
        "Security check failed."
      );
    });
  }

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
