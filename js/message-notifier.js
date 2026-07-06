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
    if (!client) return null;

    const { data: userData } = await client.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return null;

    let result = await client
      .from("user_profiles")
      .select("id, role, company_id, customer_id")
      .eq("id", userId)
      .maybeSingle();

    if (!result.data && !result.error) {
      result = await client
        .from("user_profiles")
        .select("id, role, company_id, customer_id")
        .eq("auth_user_id", userId)
        .maybeSingle();
    }

    profile = result.data || null;
    return profile;
  }

  async function checkNotifications() {
console.log("Checking notifications...", profile);
    if (isChecking || !profile) return;

    isChecking = true;

    try {
      const client = ensureClient();

      let query = client
        .from("system_notifications")
        .select("*")
        .eq("popup_shown", false)
        .order("created_at", { ascending: true })
        .limit(10);

      if (profile.company_id) {
        query = query.eq("company_id", profile.company_id);
      }

      if (profile.customer_id) {
        query = query.eq("customer_id", profile.customer_id);
      }

      query = query.or(
        `recipient_profile_id.eq.${profile.id},recipient_role.eq.${profile.role},recipient_role.is.null`
      );

      const { data, error } = await query;

      if (error) {
        console.warn("Notification polling failed:", error.message);
        return;
      }

      const rows = data || [];
console.log("Notification rows found:", rows);
      if (!rows.length) return;

      if (rows.length <= 2) {
        rows.forEach(showPopup);
      } else {
        showPopup({
          title: `${rows.length} new updates`,
          message: "Several new notifications are available. Open the Message Center to view all updates.",
          action_url: "./message-center.html",
          notification_type: "multiple_updates",
          severity: "info"
        });
      }

await client
  .from("system_notifications")
  .update({ popup_shown: true })
  .in("id", rows.map(r => r.id));

if (window.VeynorUpdateMessageCenterNavBadge) {
  window.VeynorUpdateMessageCenterNavBadge();
}

    } finally {
      isChecking = false;
    }
  }

  async function init() {
    injectStyle();

    await loadProfile();

    await checkNotifications();

    pollTimer = setInterval(checkNotifications, 5000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkNotifications();
    });
  }

 if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
})();