(function () {
  "use strict";

  document.documentElement.classList.add("auth-loading");

  const PAGE_RULES = {
    index: ["veynor_admin", "tenant_admin", "tenant_user"],
    "customer-dashboard": ["veynor_admin", "tenant_admin", "tenant_user", "product_owner_admin", "product_owner_user"],

    "order-import": ["veynor_admin", "tenant_admin", "tenant_user", "product_owner_admin", "product_owner_user"],
    "order-matching": ["veynor_admin", "tenant_admin", "tenant_user"],
    "operations-control-center": ["veynor_admin", "tenant_admin", "tenant_user", "product_owner_admin", "product_owner_user", "retailer_user"],
    orders: ["veynor_admin", "tenant_admin", "tenant_user"],

    products: ["veynor_admin", "tenant_admin", "tenant_user"],
    scan: ["veynor_admin", "tenant_admin", "tenant_user"],
    stock: ["veynor_admin", "tenant_admin", "tenant_user", "product_owner_admin", "product_owner_user"],
    outbound: ["veynor_admin", "tenant_admin", "tenant_user"],
    inventory: ["veynor_admin", "tenant_admin", "tenant_user"],

    pod: ["veynor_admin", "tenant_admin", "tenant_user", "product_owner_admin", "product_owner_user", "retailer_user"],
    billing: ["veynor_admin", "tenant_admin", "tenant_user", "product_owner_admin", "product_owner_user"],
    analytics: ["veynor_admin", "tenant_admin", "tenant_user"],
    reports: ["veynor_admin", "tenant_admin", "tenant_user"],
    events: ["veynor_admin", "tenant_admin", "tenant_user"],
    support: ["veynor_admin", "tenant_admin", "tenant_user", "product_owner_admin", "product_owner_user", "retailer_user"],
    settings: ["veynor_admin", "tenant_admin"]
  };

  function pageKey() {
    let name = String(window.location.pathname || "")
      .split("?")[0]
      .split("#")[0]
      .replace(/\\/g, "/")
      .split("/")
      .pop();

    if (!name || name === "/") name = "index.html";
    return name.replace(".html", "").trim().toLowerCase();
  }

  function showPage() {
    document.documentElement.classList.remove("auth-loading");
  }

  function redirectToLogin() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?next=${next}`);
  }

  function blockPage(message) {
    showPage();
    document.body.innerHTML = `
      <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;padding:24px;">
        <section style="width:min(520px,100%);background:#fff;border:1px solid #dce5f2;border-radius:22px;padding:28px;text-align:center;box-shadow:0 20px 50px rgba(15,23,42,.10);">
          <h1 style="margin:0 0 10px;color:#07152f;">Access denied</h1>
          <p style="margin:0 0 22px;color:#667085;">${message}</p>
          <a href="/operations-control-center.html" style="display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 18px;border-radius:12px;background:#1267ff;color:#fff;font-weight:900;text-decoration:none;">
            Back to Operations Control
          </a>
        </section>
      </main>
    `;
  }

  async function loadProfile(client, userId) {
    let result = await client
      .from("user_profiles")
      .select("id, auth_user_id, role, is_active, company_id, customer_id")
      .eq("id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (!result.data && !result.error) {
      result = await client
        .from("user_profiles")
        .select("id, auth_user_id, role, is_active, company_id, customer_id")
        .eq("auth_user_id", userId)
        .eq("is_active", true)
        .maybeSingle();
    }

    if (result.error) throw result.error;
    return result.data || null;
  }

  async function guardPage() {
    const key = pageKey();

    if (key === "login") {
      showPage();
      return;
    }

    const allowedRoles = PAGE_RULES[key];

    if (!allowedRoles) {
      console.warn("[page-guard] No rule for page:", key);
      showPage();
      return;
    }

    if (typeof sb !== "function") {
      blockPage("Supabase is not loaded.");
      return;
    }

    const client = sb();

    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user || null;

    if (!user?.id) {
      redirectToLogin();
      return;
    }

    const profile = await loadProfile(client, user.id);

    if (!profile?.role) {
      blockPage("No active profile was found for this login.");
      return;
    }

    const role = String(profile.role || "").trim().toLowerCase();

    if (!allowedRoles.includes(role)) {
      blockPage("Your account does not have permission to open this page.");
      return;
    }

    window.VEYNOR_CURRENT_USER = user;
    window.VEYNOR_CURRENT_PROFILE = profile;

    showPage();
  }

  document.addEventListener("DOMContentLoaded", () => {
    guardPage().catch(error => {
      console.error("[page-guard]", error);
      blockPage(error.message || "Security check failed.");
    });
  });
})();
