
/* ============================================================
   VEYNOR - CENTRAL TENANT CONTEXT
   Version 1.0
   ============================================================ */

(function () {
  "use strict";

  let activeCompanyId = null;
  let activeCompany = null;

  async function getActiveCompanyId() {
    if (activeCompanyId) {
      return activeCompanyId;
    }

    if (typeof window.sb !== "function") {
      throw new Error("Supabase is not available.");
    }

    const db = window.sb();

    const { data: auth, error: authError } =
      await db.auth.getUser();

    if (authError || !auth?.user?.id) {
      throw new Error("User is not authenticated.");
    }

    const { data: profiles, error: profileError } =
      await db
        .from("user_profiles")
        .select("company_id, role, is_active")
        .eq("auth_user_id", auth.user.id)
        .eq("is_active", true)
        .limit(2);

    if (profileError) throw profileError;

    if (!profiles || profiles.length !== 1) {
      throw new Error("No unique active user profile.");
    }

    const profile = profiles[0];

    const requestedTenantId =
      new URLSearchParams(window.location.search)
        .get("tenant");

    if (
      requestedTenantId &&
      profile.role !== "veynor_admin"
    ) {
      throw new Error(
        "Tenant switching requires Super Admin access."
      );
    }

    const companyId =
      requestedTenantId || profile.company_id;

    if (!companyId) {
      throw new Error("No company selected.");
    }

    const { data: company, error: companyError } =
      await db
        .from("companies")
        .select("id, name, company_type, is_active")
        .eq("id", companyId)
        .eq("is_active", true)
        .single();

    if (companyError || !company) {
      throw new Error("Company is not available.");
    }

    if (
      requestedTenantId &&
      company.company_type !== "tenant"
    ) {
      throw new Error(
        "Selected company is not an operational tenant."
      );
    }

    activeCompanyId = company.id;
    activeCompany = company;

    return activeCompanyId;
  }

  async function getActiveCompany() {
    await getActiveCompanyId();
    return activeCompany;
  }

  window.VeynorTenant = Object.freeze({
    getActiveCompanyId,
    getActiveCompany
  });

})();
