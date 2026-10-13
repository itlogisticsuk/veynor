(function () {
  "use strict";

  // --------------------------------------------------
  // Config
  // --------------------------------------------------

  const POLL_INTERVAL_MS = 5000;
  const LIVE_POPUP_LIFETIME_MS = 11000;

  const LIVE_POPUP_BG = "./assets/notification-popup-bg.webp";
  const LOGIN_POPUP_BG = "./assets/notification-login-bg.webp.png";

  let db = null;
  let profile = null;
  let pollTimer = null;
  let isPolling = false;
  let isInitialised = false;

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

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

  function num(value) {
    return Number(value || 0).toLocaleString("en-GB");
  }

  function isTenantRole() {
    return ["veynor_admin", "tenant_admin", "tenant_user"].includes(profile?.role);
  }

  function currentCustomerId() {
    return profile?.customer_id || null;
  }

function typeText(type) {
  const t = String(type || "").toLowerCase();

  if (t.includes("order_imported")) return "Order Imported";
  if (t.includes("ack")) return "Acknowledgement";
  if (t.includes("invoice")) return "Invoice";
  if (t.includes("pod")) return "Proof of Delivery";
  if (t.includes("delivery")) return "Delivery";
  if (t.includes("warehouse") || t.includes("stock") || t.includes("received")) return "Warehouse";
  if (t.includes("message")) return "Message";
  if (t.includes("announcement")) return "Announcement";
  if (t.includes("credit")) return "Credit Note";

  return "Notification";
}

function iconFor(type, severity) {
  const t = String(type || "").toLowerCase();

  if (severity === "critical" || severity === "error") return "⚠️";
  if (severity === "warning" || severity === "high") return "⚠️";

  if (t.includes("order_imported")) return "🛒";
  if (t.includes("invoice")) return "📄";
  if (t.includes("ack")) return "🧾";
  if (t.includes("pod")) return "✍️";
  if (t.includes("delivery") || t.includes("route")) return "🚚";
  if (t.includes("warehouse") || t.includes("stock") || t.includes("received")) return "📦";
  if (t.includes("message")) return "💬";
  if (t.includes("credit")) return "💳";
  if (t.includes("announcement")) return "📢";

  return "🔔";
}

  function ctaFor(type) {
    const t = String(type || "").toLowerCase();

    if (t.includes("ack")) return "Open PDF";
    if (t.includes("invoice")) return "Open Invoice";
    if (t.includes("pod")) return "Open POD";
    if (t.includes("delivery")) return "View Delivery";
    if (t.includes("warehouse") || t.includes("stock")) return "View Stock";
    if (t.includes("message")) return "Open Chat";

    return "View";
  }

  // --------------------------------------------------
  // Profile
  // --------------------------------------------------


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

  if (!authUserId) {
    return null;
  }

  const { data: profiles, error } = await client
    .from("user_profiles")
    .select(`
      id,
      auth_user_id,
      company_id,
      customer_id,
      full_name,
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

  // --------------------------------------------------
  // Styles
  // --------------------------------------------------

  function injectStyles() {
    if (document.getElementById("veynorNotificationServiceStyles")) return;

    const style = document.createElement("style");
    style.id = "veynorNotificationServiceStyles";

    style.textContent = `
      @keyframes veynorNotifyIn {
        from { opacity:0; transform:translateY(18px) scale(.97); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }

      @keyframes veynorLoginIn {
        from { opacity:0; transform:translateY(18px) scale(.96); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }

      @keyframes veynorNotifyProgress {
        from { width:100%; }
        to { width:0%; }
      }

      #veynorGlobalNotificationStack {
        position:fixed;
        right:24px;
        bottom:24px;
        z-index:999999;
        display:grid;
        gap:14px;
        width:min(460px, calc(100vw - 48px));
        pointer-events:none;
      }

      .veynor-notify-card {
        pointer-events:auto;
        position:relative;
        overflow:hidden;
        min-height:188px;
        border-radius:22px;
        padding:18px;
        color:#fff;
background:
  linear-gradient(
    90deg,
    rgba(5,17,44,.30),
    rgba(5,17,44,.18)
  ),
  url("${LOGIN_POPUP_BG}") center/cover no-repeat;
        border:1px solid rgba(92,157,255,.35);
        box-shadow:
          0 28px 75px rgba(2,12,32,.42),
          inset 0 1px 0 rgba(255,255,255,.12);
        animation:veynorNotifyIn .2s ease-out;
      }

      .veynor-notify-card::before {
        content:"";
        position:absolute;
        inset:0;
        background:
          radial-gradient(circle at 16% 20%, rgba(18,103,255,.24), transparent 34%),
          radial-gradient(circle at 85% 80%, rgba(0,194,255,.20), transparent 30%);
        pointer-events:none;
      }

      .veynor-notify-content {
        position:relative;
        z-index:1;
        display:grid;
        gap:13px;
      }

      .veynor-notify-top {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
      }

      .veynor-notify-type {
        display:flex;
        align-items:center;
        gap:10px;
        min-width:0;
      }

      .veynor-notify-icon {
        width:46px;
        height:46px;
        border-radius:16px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:rgba(239,246,255,.96);
        color:#07152f;
        border:1px solid rgba(191,219,254,.8);
        box-shadow:0 10px 30px rgba(18,103,255,.35);
        font-size:22px;
        flex:0 0 46px;
      }

      .veynor-notify-label {
        font-size:11px;
        letter-spacing:.12em;
        font-weight:950;
        color:#8fc2ff;
        text-transform:uppercase;
      }

      .veynor-notify-live {
        border:1px solid rgba(99,213,255,.38);
        background:rgba(18,103,255,.18);
        color:#dbeafe;
        border-radius:999px;
        padding:6px 10px;
        font-size:10px;
        font-weight:950;
        letter-spacing:.08em;
        text-transform:uppercase;
        white-space:nowrap;
      }

      .veynor-notify-title {
        font-size:18px;
        line-height:1.25;
        font-weight:950;
        color:#fff;
        text-shadow:0 2px 10px rgba(0,0,0,.28);
      }

      .veynor-notify-message {
        font-size:13px;
        line-height:1.48;
        color:#d7e6ff;
        max-width:360px;
      }

      .veynor-notify-meta {
        display:flex;
        align-items:center;
        gap:8px;
        color:#93b4dd;
        font-size:11px;
        font-weight:800;
      }

      .veynor-notify-actions {
        display:flex;
        justify-content:flex-end;
        gap:10px;
        margin-top:2px;
      }

      .veynor-notify-btn {
        min-height:38px;
        padding:0 14px;
        border-radius:13px;
        border:1px solid rgba(255,255,255,.22);
        background:rgba(255,255,255,.08);
        color:#eaf3ff;
        font-size:12px;
        font-weight:950;
        cursor:pointer;
        text-decoration:none;
        display:inline-flex;
        align-items:center;
        justify-content:center;
      }

      .veynor-notify-btn:hover {
        background:rgba(255,255,255,.14);
      }

      .veynor-notify-btn.primary {
        background:#1267ff;
        border-color:#1267ff;
        color:#fff;
        box-shadow:0 10px 25px rgba(18,103,255,.35);
      }

      .veynor-notify-close {
        position:absolute;
        top:12px;
        right:12px;
        z-index:2;
        width:28px;
        height:28px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.18);
        background:rgba(255,255,255,.08);
        color:#fff;
        cursor:pointer;
        font-weight:900;
      }

      .veynor-notify-progress {
        position:absolute;
        left:0;
        bottom:0;
        height:4px;
        width:100%;
        background:linear-gradient(90deg, #1267ff, #00c2ff);
        animation:veynorNotifyProgress ${LIVE_POPUP_LIFETIME_MS}ms linear forwards;
      }

      .veynor-login-summary-backdrop {
        position:fixed;
        inset:0;
        z-index:1000000;
        background:rgba(7,21,47,.58);
        backdrop-filter:blur(8px);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:26px;
      }

      .veynor-login-summary-card {
        position:relative;
        overflow:hidden;
        width:min(720px, 100%);
        min-height:420px;
        border-radius:30px;
        padding:34px;
        color:#fff;
background:
  url("${LOGIN_POPUP_BG}") center/cover no-repeat;
        border:1px solid rgba(92,157,255,.38);
        box-shadow:
          0 40px 110px rgba(2,12,32,.52),
          inset 0 1px 0 rgba(255,255,255,.12);
        display:grid;
        gap:22px;
        animation:veynorLoginIn .22s ease-out;
      }


      .veynor-login-summary-inner {
        position:relative;
        z-index:1;
        display:grid;
        gap:22px;
      }

      .veynor-login-summary-kicker {
        display:inline-flex;
        width:max-content;
        align-items:center;
        gap:8px;
        border:1px solid rgba(99,213,255,.35);
        background:rgba(18,103,255,.16);
        color:#cce7ff;
        border-radius:999px;
        padding:7px 12px;
        font-size:11px;
        font-weight:950;
        letter-spacing:.1em;
        text-transform:uppercase;
      }

      .veynor-login-summary-title {
        font-size:34px;
        line-height:1.08;
        font-weight:950;
        letter-spacing:-.05em;
        text-shadow:0 4px 18px rgba(0,0,0,.32);
      }

      .veynor-login-summary-sub {
        max-width:560px;
        color:#d7e6ff;
        font-size:14px;
        line-height:1.55;
      }

      .veynor-login-summary-list {
        display:grid;
        gap:11px;
      }

      .veynor-login-summary-row {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:16px;
        padding:14px 16px;
        border-radius:17px;
        background:rgba(255,255,255,.085);
        border:1px solid rgba(255,255,255,.12);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.06);
      }

      .veynor-login-summary-row span {
        font-size:14px;
        font-weight:900;
        color:#f7fbff;
      }

      .veynor-login-summary-row strong {
        min-width:34px;
        height:30px;
        border-radius:999px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        background:#1267ff;
        color:#fff;
        font-size:13px;
        font-weight:950;
        box-shadow:0 10px 24px rgba(18,103,255,.34);
      }

      .veynor-login-summary-actions {
        display:flex;
        justify-content:flex-end;
        gap:10px;
        margin-top:4px;
      }

      .veynor-login-summary-close {
        position:absolute;
        top:18px;
        right:18px;
        z-index:2;
        width:32px;
        height:32px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.2);
        background:rgba(255,255,255,.09);
        color:#fff;
        cursor:pointer;
        font-weight:950;
      }

      .nav-badge,
      .tab-badge,
      .notification-unread-badge,
      .thread-unread-badge {
        background:#ef4444 !important;
      }
    `;

    document.head.appendChild(style);
  }

  // --------------------------------------------------
  // Scoping
  // --------------------------------------------------


function scopedNotificationQuery(query) {
  if (!profile?.company_id || !profile?.id) {
    throw new Error(
      "Notification query blocked: no active tenant."
    );
  }

  query = query.eq(
    "company_id",
    profile.company_id
  );

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error(
        "Customer account has no customer_id."
      );
    }

    query = query.eq(
      "customer_id",
      currentCustomerId()
    );
  }

  return query.or(
    `recipient_profile_id.eq.${profile.id},` +
    `recipient_role.eq.${profile.role},` +
    `recipient_role.is.null`
  );
}


function scopedMessageQuery(query) {
  if (!profile?.company_id || !profile?.id) {
    throw new Error(
      "Message query blocked: no active tenant."
    );
  }

  query = query
    .eq("company_id", profile.company_id)
    .is("read_at", null)
    .neq("sender_profile_id", profile.id);

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error(
        "Customer account has no customer_id."
      );
    }

    query = query.eq(
      "customer_id",
      currentCustomerId()
    );
  }

  return query.or(
    `recipient_profile_id.eq.${profile.id},` +
    `recipient_role.eq.${profile.role},` +
    `recipient_role.is.null`
  );
}

  // --------------------------------------------------
  // Badges
  // --------------------------------------------------


async function getUnreadCounts() {
  const client = ensureClient();

  if (!client || !profile?.company_id) {
    return {
      messages: 0,
      notifications: 0,
      total: 0
    };
  }

  let messagesQuery = client
    .from("messages")
    .select("id", {
      count: "exact",
      head: true
    });

  let notificationsQuery = client
    .from("system_notifications")
    .select("id", {
      count: "exact",
      head: true
    })
    .eq("is_read", false);

  messagesQuery = scopedMessageQuery(
    messagesQuery
  );

  notificationsQuery = scopedNotificationQuery(
    notificationsQuery
  );

  const [messagesResult, notificationsResult] =
    await Promise.all([
      messagesQuery,
      notificationsQuery
    ]);

  if (messagesResult.error) {
    throw messagesResult.error;
  }

  if (notificationsResult.error) {
    throw notificationsResult.error;
  }

  const messages = messagesResult.count || 0;
  const notifications =
    notificationsResult.count || 0;

  return {
    messages,
    notifications,
    total: messages + notifications
  };
}

  function updateBadge(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    el.textContent = num(value);
    el.style.display = value > 0 ? "inline-flex" : "none";
  }

  function updateSidebarBadge(value) {
    const el = document.querySelector('[data-nav-badge="message-center"]');
    if (!el) return;

    el.textContent = num(value);
    el.style.display = value > 0 ? "inline-flex" : "none";
  }

  async function refreshBadges() {
    const counts = await getUnreadCounts();

    updateSidebarBadge(counts.total);
    updateBadge("messagesTabBadge", counts.messages);
    updateBadge("notificationsTabBadge", counts.notifications);

    const msgKpi = document.getElementById("kpiNewMessages");
    if (msgKpi) msgKpi.textContent = num(counts.messages);

    const notiKpi = document.getElementById("kpiNotifications");
    if (notiKpi) notiKpi.textContent = num(counts.notifications);

    window.VeynorUnreadCounts = counts;

    window.dispatchEvent(new CustomEvent("veynor:unread-counts", {
      detail: counts
    }));

    return counts;
  }

  // --------------------------------------------------
  // Live popup
  // --------------------------------------------------

  function ensurePopupStack() {
    let el = document.getElementById("veynorGlobalNotificationStack");

    if (el) return el;

    el = document.createElement("div");
    el.id = "veynorGlobalNotificationStack";

    document.body.appendChild(el);

    return el;
  }

  function showPopup(notification) {
    const stack = ensurePopupStack();

    const card = document.createElement("div");
    const type = notification.notification_type || "notification";
    const icon = iconFor(type, notification.severity);
    const title = notification.title || "New notification";
    const message = notification.message || "";
    const actionUrl = notification.action_url || "./message-center.html";

    card.className = "veynor-notify-card";

    card.innerHTML = `
      <button class="veynor-notify-close" type="button" aria-label="Close">×</button>

      <div class="veynor-notify-content">
        <div class="veynor-notify-top">
          <div class="veynor-notify-type">
            <div class="veynor-notify-icon">${icon}</div>
            <div>
              <div class="veynor-notify-label">${escapeHtml(typeText(type))}</div>
              <div class="veynor-notify-title">${escapeHtml(title)}</div>
            </div>
          </div>

          <div class="veynor-notify-live">Live</div>
        </div>

        <div class="veynor-notify-message">
          ${escapeHtml(message)}
        </div>

        <div class="veynor-notify-meta">
          <span>Veynor update</span>
          <span>•</span>
          <span>Just now</span>
        </div>

        <div class="veynor-notify-actions">
          <button class="veynor-notify-btn" type="button" data-dismiss-live>
            Dismiss
          </button>

          <a class="veynor-notify-btn primary"
             href="${escapeHtml(actionUrl)}"
             target="_blank"
             rel="noopener">
            ${escapeHtml(ctaFor(type))}
          </a>
        </div>
      </div>

      <div class="veynor-notify-progress"></div>
    `;

    const close = () => card.remove();

    card.querySelector(".veynor-notify-close")?.addEventListener("click", close);
    card.querySelector("[data-dismiss-live]")?.addEventListener("click", close);

    stack.appendChild(card);

    while (stack.children.length > 2) {
      stack.firstElementChild?.remove();
    }

    setTimeout(() => {
      if (card.isConnected) card.remove();
    }, LIVE_POPUP_LIFETIME_MS);
  }

  // --------------------------------------------------
  // Login summary popup
  // --------------------------------------------------

  function showLoginSummaryModal(summaryRows) {
    if (!summaryRows.length) return;

    const existing = document.getElementById("veynorLoginSummary");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "veynorLoginSummary";
    modal.className = "veynor-login-summary-backdrop";

    modal.innerHTML = `
      <div class="veynor-login-summary-card">
        <button class="veynor-login-summary-close" type="button" aria-label="Close">×</button>

        <div class="veynor-login-summary-inner">
          <div>
            <div class="veynor-login-summary-kicker">Since your last visit</div>

            <div class="veynor-login-summary-title">
              Welcome back${profile?.full_name ? `, ${escapeHtml(profile.full_name)}` : ""}
            </div>

            <div class="veynor-login-summary-sub">
              These updates were recorded while you were away. Open the Message Center to view the full activity timeline.
            </div>
          </div>

          <div class="veynor-login-summary-list">
            ${summaryRows.map(row => `
              <div class="veynor-login-summary-row">
                <span>${row.icon} ${escapeHtml(row.label)}</span>
                <strong>${num(row.count)}</strong>
              </div>
            `).join("")}
          </div>

          <div class="veynor-login-summary-actions">
            <button class="veynor-notify-btn" type="button" data-dismiss-summary>
              Dismiss
            </button>

            <a class="veynor-notify-btn primary" href="./message-center.html">
              Open Message Center
            </a>
          </div>
        </div>
      </div>
    `;

    const close = () => modal.remove();

    modal.querySelector(".veynor-login-summary-close")?.addEventListener("click", close);
    modal.querySelector("[data-dismiss-summary]")?.addEventListener("click", close);

    modal.addEventListener("click", event => {
      if (event.target === modal) close();
    });

    document.body.appendChild(modal);
  }

  async function getNotificationState() {
    const client = ensureClient();

    if (!client || !profile) return null;

    const { data, error } = await client
      .from("user_notification_state")
      .select("*")
      .eq("user_profile_id", profile.id)
      .maybeSingle();

    if (error) {
      console.warn("Notification state read failed:", error.message);
      return null;
    }

    if (data) return data;

    const fallback = {
      user_profile_id: profile.id,
      last_seen_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      last_popup_seen_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    };

    const { data: inserted, error: insertError } = await client
      .from("user_notification_state")
      .insert(fallback)
      .select("*")
      .single();

    if (insertError) {
      console.warn("Notification state create failed:", insertError.message);
      return fallback;
    }

    return inserted;
  }

  function buildSummaryRows(rows, messageCount = 0) {
  return [
    {
      icon: "🧾",
      label: "New Acknowledgements",
      count: rows.filter(r => String(r.notification_type || "").includes("ack")).length
    },
    {
      icon: "📄",
      label: "New Invoices",
      count: rows.filter(r => String(r.notification_type || "").includes("invoice")).length
    },
    {
      icon: "💬",
      label: "New Messages",
      count: messageCount
    },
    {
      icon: "✍️",
      label: "New PODs",
      count: rows.filter(r => String(r.notification_type || "").includes("pod")).length
    },
    {
      icon: "🚚",
      label: "Delivery updates",
      count: rows.filter(r =>
        String(r.notification_type || "").includes("delivery") ||
        String(r.notification_type || "").includes("route")
      ).length
    },
    {
      icon: "📦",
      label: "Warehouse updates",
      count: rows.filter(r =>
        String(r.notification_type || "").includes("warehouse") ||
        String(r.notification_type || "").includes("stock") ||
        String(r.notification_type || "").includes("received")
      ).length
    }
  ].filter(row => row.count > 0);
}


async function showLoginSummaryPopup() {
  const client = ensureClient();

  if (!client || !profile?.company_id) return;

  const cid = profile.company_id;
  const state = await getNotificationState();

  const lastSeen =
    state?.last_seen_at ||
    new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();

  let notificationQuery = client
    .from("system_notifications")
    .select("*")
    .gt("created_at", lastSeen)
    .order("created_at", {
      ascending: false
    })
    .limit(250);

  notificationQuery = scopedNotificationQuery(
    notificationQuery
  );

  let messageQuery = client
    .from("messages")
    .select("*")
    .gt("created_at", lastSeen)
    .order("created_at", {
      ascending: false
    })
    .limit(250);

  messageQuery = scopedMessageQuery(messageQuery);

  const [notificationRes, messageRes] =
    await Promise.all([
      notificationQuery,
      messageQuery
    ]);

  if (notificationRes.error) {
    throw notificationRes.error;
  }

  if (messageRes.error) {
    throw messageRes.error;
  }

  const rows = notificationRes.data || [];
  const messages = messageRes.data || [];

  const summaryRows = buildSummaryRows(
    rows,
    messages.length
  );

  if (summaryRows.length) {
    showLoginSummaryModal(summaryRows);

    if (rows.length) {
      const ids = rows.map(row => row.id);

      const { error } = await client
        .from("system_notifications")
        .update({ popup_shown: true })
        .eq("company_id", cid)
        .in("id", ids);

      if (error) throw error;
    }
  }

  const now = new Date().toISOString();

  const { error: stateError } = await client
    .from("user_notification_state")
    .upsert({
      user_profile_id: profile.id,
      last_seen_at: now,
      updated_at: now
    });

  if (stateError) throw stateError;

  await refreshBadges();
}

  // --------------------------------------------------
  // Polling
  // --------------------------------------------------


async function pollNotifications() {
  if (isPolling || !profile?.company_id) {
    return;
  }

  isPolling = true;

  try {
    const client = ensureClient();
    const cid = profile.company_id;

    if (!client) return;

    let query = client
      .from("system_notifications")
      .select("*")
      .eq("popup_shown", false)
      .order("created_at", {
        ascending: true
      })
      .limit(10);

    query = scopedNotificationQuery(query);

    const { data, error } = await query;

    if (error) throw error;

    const rows = data || [];

    if (!rows.length) {
      await refreshBadges();
      return;
    }

    if (rows.length <= 2) {
      rows.forEach(showPopup);
    } else {
      showPopup({
        notification_type: "multiple_updates",
        title: `${rows.length} new updates`,
        message:
          "Several new notifications are available. " +
          "Open the Message Center to view all updates.",
        action_url: "./message-center.html",
        severity: "info"
      });
    }

    const ids = rows.map(row => row.id);

    const { error: updateError } = await client
      .from("system_notifications")
      .update({
        popup_shown: true
      })
      .eq("company_id", cid)
      .in("id", ids);

    if (updateError) throw updateError;

    await refreshBadges();

  } catch (error) {
    console.warn(
      "[Veynor Notifications] Polling failed:",
      error?.message || error
    );
  } finally {
    isPolling = false;
  }
}

  function startPolling() {
    stopPolling();

    pollTimer = setInterval(pollNotifications, POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        pollNotifications();
      }
    });
  }

  function stopPolling() {
    if (!pollTimer) return;

    clearInterval(pollTimer);
    pollTimer = null;
  }

  // --------------------------------------------------
  // Mutations
  // --------------------------------------------------


async function markRead(notificationId) {
  if (!notificationId) return;

  const client = ensureClient();

  if (!client || !profile?.company_id) {
    throw new Error(
      "Cannot mark notification as read without an active tenant."
    );
  }

  const { data, error } = await client
    .from("system_notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString()
    })
    .eq("company_id", profile.company_id)
    .eq("id", notificationId)
    .select("id");

  if (error) throw error;

  if (!data?.length) {
    throw new Error(
      "Notification not found or not accessible."
    );
  }

  await refreshBadges();
}


async function markAllRead() {
  const client = ensureClient();

  if (!client || !profile?.company_id) {
    throw new Error(
      "Cannot update notifications without an active tenant."
    );
  }

  let query = client
    .from("system_notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString()
    })
    .eq("company_id", profile.company_id)
    .eq("is_read", false);

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error(
        "Customer account has no customer_id."
      );
    }

    query = query.eq(
      "customer_id",
      currentCustomerId()
    );
  }

  query = query.or(
    `recipient_profile_id.eq.${profile.id},` +
    `recipient_role.eq.${profile.role},` +
    `recipient_role.is.null`
  );

  const { error } = await query;

  if (error) throw error;

  await refreshBadges();
}


async function createNotification(payload) {
  const client = ensureClient();

  if (!client || !profile?.company_id) {
    throw new Error(
      "Cannot create notification: active tenant is missing."
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid notification payload.");
  }

  const cid = profile.company_id;

  if (
    payload.company_id &&
    String(payload.company_id) !== String(cid)
  ) {
    throw new Error(
      "Notification rejected: company_id does not match the active tenant."
    );
  }

  const customerId = payload.customer_id || null;
  const recipientId = payload.recipient_profile_id || null;

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error(
        "Customer account has no customer_id."
      );
    }

    if (
      customerId &&
      String(customerId) !== String(currentCustomerId())
    ) {
      throw new Error(
        "Notification rejected: customer belongs to another account."
      );
    }
  }

  if (customerId) {
    const { data: customer, error } = await client
      .from("customers")
      .select("id")
      .eq("company_id", cid)
      .eq("id", customerId)
      .maybeSingle();

    if (error) throw error;

    if (!customer) {
      throw new Error(
        "Notification customer is not accessible within this tenant."
      );
    }
  }

  if (recipientId) {
    const { data: recipient, error } = await client
      .from("user_profiles")
      .select("id, company_id, customer_id, is_active")
      .eq("id", recipientId)
      .eq("company_id", cid)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;

    if (!recipient) {
      throw new Error(
        "Notification recipient is not available within this tenant."
      );
    }

    if (
      !isTenantRole() &&
      recipient.customer_id &&
      String(recipient.customer_id) !==
        String(currentCustomerId())
    ) {
      throw new Error(
        "Notification recipient is outside the permitted customer account."
      );
    }
  }

  const row = {
    company_id: cid,
    customer_id:
      customerId ||
      (!isTenantRole() ? currentCustomerId() : null),
    recipient_profile_id: recipientId,
    recipient_role: payload.recipient_role ?? null,
    notification_type:
      payload.notification_type ||
      payload.type ||
      "notification",
    title: payload.title || "New notification",
    message: payload.message || "",
    severity: payload.severity || "info",
    entity_type: payload.entity_type || null,
    entity_id: payload.entity_id || null,
    action_url: payload.action_url || null,
    is_read: false,
    popup_shown: false
  };

  const { data, error } = await client
    .from("system_notifications")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;

  await refreshBadges();

  return data;
}

  // --------------------------------------------------
  // Init / Public API
  // --------------------------------------------------


async function init() {
  if (isInitialised) return;

  isInitialised = true;

  try {
    const loadedProfile = await loadProfile();

    if (!loadedProfile?.company_id) {
      console.warn(
        "[Veynor Notifications] No active tenant profile."
      );
      isInitialised = false;
      return;
    }

    injectStyles();

    await refreshBadges();

    await showLoginSummaryPopup();

    startPolling();

    console.log(
      "[Veynor Notifications] Service started."
    );

  } catch (error) {
    isInitialised = false;

    console.error(
      "[Veynor Notifications] Initialisation failed:",
      error?.message || error
    );
  }
}

  async function ready() {
    if (profile) return profile;
    return await loadProfile();
  }

  window.VeynorNotifications = {
    init,
    ready,
    refreshBadges,
    pollNotifications,
    markRead,
    markAllRead,
    createNotification,
    showPopup,
    showLoginSummaryPopup,
    getUnreadCounts
  };

  window.VeynorUpdateMessageCenterNavBadge = refreshBadges;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();