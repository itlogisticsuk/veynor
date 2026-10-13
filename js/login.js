
(function () {
  "use strict";

  // ============================================================
  // VEYNOR — MULTI-TENANT LOGIN
  // ============================================================

  const LAST_ACTIVITY_KEY = "veynor_last_activity_at";
  const SESSION_USER_KEY = "veynor_session_user_id";

  const HOME_PAGES = {
    veynor_admin: "/operations-control-center.html",
    tenant_admin: "/operations-control-center.html",
    tenant_user: "/operations-control-center.html",
    product_owner_admin: "/customer-dashboard.html",
    product_owner_user: "/customer-dashboard.html"
  };

  let loginInProgress = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function showMessage(message, type = "error") {
    let box = byId("loginMessage");

    if (!box) {
      box = document.createElement("div");
      box.id = "loginMessage";
      box.style.marginTop = "14px";
      box.style.padding = "12px";
      box.style.borderRadius = "12px";
      box.style.fontWeight = "800";
      box.style.fontSize = "13px";

      document.querySelector("form")?.appendChild(box);
    }

    box.textContent = message;

    const success = type === "ok";

    box.style.background = success ? "#ecfdf5" : "#fef2f2";
    box.style.color = success ? "#166534" : "#991b1b";
    box.style.border = success
      ? "1px solid #bbf7d0"
      : "1px solid #fecaca";
  }

  function setBusy(busy) {
    loginInProgress = busy;

    const button =
      byId("loginButton") ||
      document.querySelector('form button[type="submit"]');

    if (!button) return;

    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = "Signing in...";
    } else {
      button.textContent =
        button.dataset.originalText || "Log in";
    }

    button.disabled = busy;
  }

  async function getActiveProfile(client, authUserId) {
    const { data, error } = await client
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        company_id,
        customer_id,
        role,
        is_active
      `)
      .eq("auth_user_id", authUserId)
      .eq("is_active", true)
      .limit(2);

    if (error) throw error;

    if (!data || data.length !== 1) {
      throw new Error(
        "No unique active user profile was found."
      );
    }

    const profile = data[0];

    if (!profile.company_id) {
      throw new Error(
        "Your account is not linked to a company."
      );
    }

    return profile;
  }

  function getHomePage(profile) {
    const role = String(profile.role || "")
      .trim()
      .toLowerCase();

    const page = HOME_PAGES[role];

    if (!page) {
      throw new Error(
        "No authorised landing page is configured for this role."
      );
    }

    if (
      (
        role === "product_owner_admin" ||
        role === "product_owner_user"
      ) &&
      !profile.customer_id
    ) {
      throw new Error(
        "Your Product Owner account has no customer assigned."
      );
    }

    return page;
  }

  async function handleLogin(event) {
    event.preventDefault();
    event.stopPropagation();

    if (loginInProgress) return false;

    const email = (
      byId("email")?.value ||
      byId("loginEmail")?.value ||
      document.querySelector('input[type="email"]')?.value ||
      ""
    ).trim();

    const password =
      byId("password")?.value ||
      byId("loginPassword")?.value ||
      document.querySelector('input[type="password"]')?.value ||
      "";

    if (!email || !password) {
      showMessage("Enter your email and password.");
      return false;
    }

    setBusy(true);

    let client = null;

    try {
      if (typeof sb !== "function") {
        throw new Error(
          "Supabase authentication is unavailable."
        );
      }

      client = sb();

      const { data, error } =
        await client.auth.signInWithPassword({
          email,
          password
        });

      if (error) throw error;

      if (!data?.session || !data?.user?.id) {
        throw new Error(
          "Login failed: no valid session returned."
        );
      }

      const profile = await getActiveProfile(
        client,
        data.user.id
      );

      const destination = getHomePage(profile);

      // Initialise inactivity tracking for this user.
      localStorage.setItem(
        SESSION_USER_KEY,
        data.user.id
      );

      localStorage.setItem(
        LAST_ACTIVITY_KEY,
        String(Date.now())
      );

      showMessage(
        "Login successful. Redirecting...",
        "ok"
      );

      window.location.assign(destination);

      return false;

    } catch (error) {
      console.error("[Veynor Login]", error);

      if (client) {
        try {
          await client.auth.signOut();
        } catch (signOutError) {
          console.warn(
            "[Veynor Login] Sign-out failed:",
            signOutError
          );
        }
      }

      localStorage.removeItem(LAST_ACTIVITY_KEY);
      localStorage.removeItem(SESSION_USER_KEY);

      showMessage(
        error?.message ||
        "Login failed. Please try again."
      );

      return false;

    } finally {
      setBusy(false);
    }
  }

  function initializeLogin() {
    const form =
      byId("loginForm") ||
      document.querySelector("form");

    if (!form) {
      console.warn(
        "[Veynor Login] Login form not found."
      );
      return;
    }

    form.setAttribute("novalidate", "novalidate");

    // Submit handles both Enter and button clicks.
    form.addEventListener("submit", handleLogin);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeLogin
    );
  } else {
    initializeLogin();
  }
})();
