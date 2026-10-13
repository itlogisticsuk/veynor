(function () {
    "use strict";

    console.log("MESSAGE NOTIFIER LOADED");

  let db = null;
  let profile = null;
  let pollTimer = null;
  let isChecking = false;

  function ensureClient() {
    if (db) return db;
    if (typeof sb !== "function") return null;
    db = sb();
    return db;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function iconFor(type, severity) {
    const t = String(type || "").toLowerCase();

    if (severity === "critical" || severity === "error") return "⚠️";
    if (severity === "warning" || severity === "high") return "⚠️";
    if (t.includes("invoice")) return "📄";
    if (t.includes("ack")) return "🧾";
    if (t.includes("pod")) return "✍️";
    if (t.includes("delivery")) return "🚚";
    if (t.includes("warehouse") || t.includes("stock")) return "📦";
    if (t.includes("message")) return "💬";
    if (t.includes("credit")) return "💳";

    return "🔔";
  }

  function ensureContainer() {
    let el = document.getElementById("globalNotificationPopups");
    if (el) return el;

    el = document.createElement("div");
    el.id = "globalNotificationPopups";
    el.style.cssText = `
      position:fixed;
      right:22px;
      bottom:22px;
      z-index:999999;
      display:grid;
      gap:10px;
      width:min(410px,calc(100vw - 44px));
    `;

    document.body.appendChild(el);
    return el;
  }

  function injectStyle() {
    if (document.getElementById("globalNotificationStyle")) return;

    const style = document.createElement("style");
    style.id = "globalNotificationStyle";
    style.textContent = `
      @keyframes globalNotifyIn{
        from{opacity:0;transform:translateY(12px) scale(.98);}
        to{opacity:1;transform:translateY(0) scale(1);}
      }

      .global-notify-card{
        background:#fff;
        border:1px solid #dce5f2;
        border-radius:18px;
        box-shadow:0 24px 60px rgba(7,21,47,.24);
        padding:14px;
        display:grid;
        gap:12px;
        animation:globalNotifyIn .18s ease-out;
      }

      .global-notify-top{
        display:flex;
        gap:12px;
        align-items:flex-start;
      }

      .global-notify-icon{
        width:38px;
        height:38px;
        border-radius:14px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:#eff6ff;
        border:1px solid #bfdbfe;
        flex:0 0 38px;
        font-size:18px;
      }

      .global-notify-title{
        font-size:13.5px;
        font-weight:950;
        color:#07152f;
      }

      .global-notify-message{
        margin-top:4px;
        font-size:12px;
        color:#5f6f89;
        line-height:1.45;
      }

      .global-notify-actions{
        display:flex;
        justify-content:flex-end;
        gap:8px;
      }

      .global-notify-btn{
        min-height:34px;
        border-radius:11px;
        padding:0 12px;
        font-size:12px;
        font-weight:900;
        border:1px solid #dce5f2;
        background:#fff;
        color:#07152f;
        cursor:pointer;
        text-decoration:none;
        display:inline-flex;
        align-items:center;
      }

      .global-notify-btn.primary{
        background:#1267ff;
        color:#fff;
        border-color:#1267ff;
      }
    `;

    document.head.appendChild(style);
  }

  function showPopup(noti) {
    const container = ensureContainer();
    const card = document.createElement("div");

    card.className = "global-notify-card";
    card.innerHTML = `
      <div class="global-notify-top">
        <div class="global-notify-icon">${iconFor(noti.notification_type, noti.severity)}</div>
        <div>
          <div class="global-notify-title">${escapeHtml(noti.title || "New notification")}</div>
          <div class="global-notify-message">${escapeHtml(noti.message || "")}</div>
        </div>
      </div>

      <div class="global-notify-actions">
        <button class="global-notify-btn" type="button" data-dismiss>Dismiss</button>
        ${
          noti.action_url
            ? `<a class="global-notify-btn primary" href="${escapeHtml(noti.action_url)}">View</a>`
            : `<a class="global-notify-btn primary" href="./message-center.html">Open</a>`
        }
      </div>
    `;

    card.querySelector("[data-dismiss]")?.addEventListener("click", () => card.remove());

    container.appendChild(card);

    setTimeout(() => {
      if (card.isConnected) card.remove();
    }, 10000);
  }


async function loadProfile() {
  const client = ensureClient();

  profile = null;

  if (!client) {
    throw new Error(
      "Supabase client is unavailable."
    );
  }

  const { data: auth, error: authError } =
    await client.auth.getUser();

  if (authError) throw authError;

  const authUserId = auth?.user?.id;

  if (!authUserId) return null;

  const { data: profiles, error } = await client
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

  if (
    !profiles ||
    profiles.length !== 1 ||
    !profiles[0].company_id
  ) {
    throw new Error(
      "No unique active tenant profile found."
    );
  }

  profile = profiles[0];

  return profile;
}


async function checkNotifications() {
  if (
    isChecking ||
    !profile?.company_id ||
    !profile?.id
  ) {
    return;
  }

  isChecking = true;

  try {
    const client = ensureClient();

    if (!client) return;

    let query = client
      .from("system_notifications")
      .select("*")
      .eq("company_id", profile.company_id)
      .eq("popup_shown", false)
      .order("created_at", {
        ascending: true
      })
      .limit(10);

    const tenantRoles = [
      "veynor_admin",
      "tenant_admin",
      "tenant_user"
    ];

    if (!tenantRoles.includes(profile.role)) {
      if (!profile.customer_id) {
        throw new Error(
          "Customer account has no customer_id."
        );
      }

      query = query.eq(
        "customer_id",
        profile.customer_id
      );
    }

    query = query.or(
      `recipient_profile_id.eq.${profile.id},` +
      `recipient_role.eq.${profile.role},` +
      `recipient_role.is.null`
    );

    const { data, error } = await query;

    if (error) throw error;

    const rows = data || [];

    if (!rows.length) return;

    if (rows.length <= 2) {
      rows.forEach(showPopup);
    } else {
      showPopup({
        title: `${rows.length} new updates`,
        message:
          "Several new notifications are available. " +
          "Open the Message Center to view all updates.",
        action_url: "./message-center.html",
        notification_type: "multiple_updates",
        severity: "info"
      });
    }

    const { error: updateError } = await client
      .from("system_notifications")
      .update({
        popup_shown: true
      })
      .eq("company_id", profile.company_id)
      .in("id", rows.map(row => row.id));

    if (updateError) throw updateError;

    if (
      typeof window.VeynorUpdateMessageCenterNavBadge ===
      "function"
    ) {
      await window.VeynorUpdateMessageCenterNavBadge();
    }

  } catch (error) {
    console.warn(
      "[Veynor Message Notifier]",
      error?.message || error
    );
  } finally {
    isChecking = false;
  }
}


async function init() {
  // The central Notification Service takes priority.
  // Prevent duplicate polling and duplicate popups.
  if (window.VeynorNotifications) {
    console.log(
      "[Veynor Message Notifier] Central service active; " +
      "legacy notifier disabled."
    );
    return;
  }

  try {
    const activeProfile = await loadProfile();

    if (!activeProfile?.company_id) {
      console.warn(
        "[Veynor Message Notifier] No active tenant."
      );
      return;
    }

    injectStyle();

    await checkNotifications();

    if (pollTimer) {
      clearInterval(pollTimer);
    }

    pollTimer = setInterval(
      checkNotifications,
      5000
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          checkNotifications();
        }
      }
    );

  } catch (error) {
    console.error(
      "[Veynor Message Notifier] Initialization failed:",
      error?.message || error
    );
  }
}

 if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
})();