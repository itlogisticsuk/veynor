(function () {
  "use strict";

  let db = null;
  let profile = null;
  let notificationState = null;
  let activeThreadId = null;
  let liveQueue = [];
  let liveTimer = null;

const state = {
  notifications: [],
  messages: [],
  threads: [],

  planningMessages: [],

  announcements: [],
  users: [],
  customers: []
};

  function byId(id) {
    return document.getElementById(id);
  }

  function ensureClient() {
    if (db) return db;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
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

  function clean(value) {
    return String(value ?? "").trim();
  }

  function n(value) {
    return Number(value || 0).toLocaleString("en-GB");
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function timeAgo(value) {
    if (!value) return "—";

    const d = new Date(value);
    const diff = Date.now() - d.getTime();

    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;

    return formatDate(value);
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message;
    el.className = "notice " + type;

    clearTimeout(window.__messageToastTimer);
    window.__messageToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5000);
  }

  function isTenantRole() {
    return ["veynor_admin", "tenant_admin", "tenant_user"].includes(profile?.role);
  }

  function isProductOwnerRole() {
    return ["product_owner_admin", "product_owner_user"].includes(profile?.role);
  }

  function currentCustomerId() {
    return profile?.customer_id || profile?.customers?.id || null;
  }


function canAccessMessage(message) {
  if (!profile?.id || !profile?.company_id || !message) {
    return false;
  }

  if (String(message.company_id) !== String(profile.company_id)) {
    return false;
  }

  if (
    !isTenantRole() &&
    String(message.customer_id || "") !==
      String(currentCustomerId() || "")
  ) {
    return false;
  }

  if (String(message.sender_profile_id) === String(profile.id)) {
    return true;
  }

  if (message.recipient_profile_id) {
    return String(message.recipient_profile_id) ===
      String(profile.id);
  }

  if (message.recipient_role) {
    return String(message.recipient_role) ===
      String(profile.role);
  }

  return false;
}

function canAccessThread(thread) {
  if (!profile?.company_id || !thread) return false;

  if (String(thread.company_id) !== String(profile.company_id)) {
    return false;
  }

  if (!isTenantRole()) {
    return !!currentCustomerId() &&
      String(thread.customer_id || "") ===
      String(currentCustomerId());
  }

  return true;
}


  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function displayName() {
    return profile?.full_name || profile?.customers?.name || profile?.companies?.name || "there";
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function iconFor(type, severity) {
    const t = String(type || "").toLowerCase();

    if (severity === "warning" || severity === "high") return { icon: "⚠️", cls: "orange" };
    if (severity === "critical" || severity === "error") return { icon: "⚠️", cls: "red" };

    if (t.includes("warehouse") || t.includes("stock") || t.includes("received")) return { icon: "📦", cls: "green" };
    if (t.includes("invoice")) return { icon: "📄", cls: "blue" };
    if (t.includes("ack")) return { icon: "🧾", cls: "blue" };
    if (t.includes("pod")) return { icon: "✍️", cls: "purple" };
    if (t.includes("delivery") || t.includes("route")) return { icon: "🚚", cls: "green" };
    if (t.includes("message")) return { icon: "💬", cls: "blue" };
    if (t.includes("credit")) return { icon: "💳", cls: "orange" };

    return { icon: "🔔", cls: "blue" };
  }



async function loadProfile() {
  const client = ensureClient();

  profile = null;

  const { data: auth, error: authError } =
    await client.auth.getUser();

  if (authError) throw authError;

  const userId = auth?.user?.id;

  if (!userId) {
    throw new Error("No authenticated user found.");
  }

  const { data: profiles, error } = await client
    .from("user_profiles")
    .select(`
      *,
      companies ( id, name ),
      customers ( id, name, customer_code )
    `)
    .eq("auth_user_id", userId)
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

  setText(
    "welcomeTitle",
    `${greeting()}, ${displayName()}.`
  );

  if (isTenantRole()) {
    setText(
      "welcomeText",
      "Welcome back to Veynor. This Message Center gives you a live overview of customer messages, operational updates, warehouse activity and platform notifications."
    );
  } else {
    setText(
      "welcomeText",
      "Welcome to the Veynor Customer Portal. Here you can monitor your orders, deliveries, documents and warehouse activity in real time."
    );
  }

  return profile;
}

  async function loadNotificationState() {
    const client = ensureClient();

    const { data, error } = await client
      .from("user_notification_state")
      .select("*")
      .eq("user_profile_id", profile.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      notificationState = data;
      return;
    }

    const { data: inserted, error: insertError } = await client
      .from("user_notification_state")
      .insert({
        user_profile_id: profile.id,
        last_seen_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        last_popup_seen_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      })
      .select("*")
      .single();

    if (insertError) throw insertError;

    notificationState = inserted;
  }



function scopedQuery(query, tableHasCustomer = true) {
  if (!profile?.company_id) {
    throw new Error(
      "Database query blocked: active tenant missing."
    );
  }

  query = query.eq("company_id", profile.company_id);

  if (!isTenantRole() && tableHasCustomer) {
    const customerId = currentCustomerId();

    if (!customerId) {
      throw new Error(
        "Customer account has no customer_id."
      );
    }

    query = query.eq("customer_id", customerId);
  }

  return query;
}



async function safeCount(table, filters = {}) {
  const client = ensureClient();

  if (!profile?.company_id) {
    throw new Error("Active tenant missing.");
  }

  if (table === "items") {
    throw new Error(
      "Use countWarehouseItemsSince() for warehouse item counts."
    );
  }

  let query = client
    .from(table)
    .select("id", { count: "exact", head: true });

  query = scopedQuery(
    query,
    filters.customer !== false
  );

  if (filters.gte) {
    query = query.gte(
      filters.gte.field,
      filters.gte.value
    );
  }

  if (filters.lte) {
    query = query.lte(
      filters.lte.field,
      filters.lte.value
    );
  }

  const equalFilters = filters.eq
    ? (Array.isArray(filters.eq) ? filters.eq : [filters.eq])
    : [];

  const inFilters = filters.in
    ? (Array.isArray(filters.in) ? filters.in : [filters.in])
    : [];

  for (const filter of equalFilters) {
    query = query.eq(filter.field, filter.value);
  }

  for (const filter of inFilters) {
    query = query.in(filter.field, filter.value);
  }

  const { count, error } = await query;

  if (error) throw error;

  return count ?? 0;
}


async function countWarehouseItemsSince(lastSeen, type) {
  const client = ensureClient();

  if (!profile?.company_id) {
    throw new Error("Active tenant missing.");
  }

  if (!["received", "outbound"].includes(type)) {
    throw new Error("Invalid warehouse activity type.");
  }

  const customerId = !isTenantRole()
    ? currentCustomerId()
    : null;

  if (!isTenantRole() && !customerId) {
    throw new Error("Customer account is not configured.");
  }

  let productIds = null;

  if (customerId) {
    productIds = [];

    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client
        .from("products")
        .select("id")
        .eq("company_id", profile.company_id)
        .eq("customer_id", customerId)
        .range(offset, offset + 999);

      if (error) throw error;

      productIds.push(...(data || []).map(p => p.id));

      if (!data || data.length < 1000) break;
    }

    if (!productIds.length) return 0;
  }

  async function countBatch(ids) {
    let query = client
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id);

    if (ids) {
      query = query.in("product_id", ids);
    }

    if (type === "received") {
      query = query.gte("received_at", lastSeen);
    } else {
      query = query.or(
        `picked_at.gte.${lastSeen},` +
        `loaded_at.gte.${lastSeen},` +
        `shipped_at.gte.${lastSeen}`
      );
    }

    const { count, error } = await query;

    if (error) throw error;

    return count ?? 0;
  }

  if (!productIds) {
    return countBatch(null);
  }

  let total = 0;

  for (let i = 0; i < productIds.length; i += 100) {
    total += await countBatch(
      productIds.slice(i, i + 100)
    );
  }

  return total;
}


  async function loadNotifications() {
    const client = ensureClient();

    let query = client
      .from("system_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    query = scopedQuery(query, true);

    if (!isTenantRole()) {
      query = query.or(
        `recipient_profile_id.eq.${profile.id},recipient_role.eq.${profile.role},recipient_role.is.null`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    state.notifications = data || [];
  }


async function loadThreads() {
  const client = ensureClient();

  if (!profile?.company_id) {
    throw new Error("Active tenant missing.");
  }

  let query = client
    .from("message_threads")
    .select("*")
    .eq("company_id", profile.company_id)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error("Customer account is not configured.");
    }

    query = query.eq("customer_id", currentCustomerId());
  }

  const { data, error } = await query;

  if (error) throw error;

  const candidateThreads = (data || [])
    .filter(canAccessThread);

  if (isTenantRole()) {
    state.threads = candidateThreads;
    return;
  }

  if (!candidateThreads.length) {
    state.threads = [];
    return;
  }

  const ids = candidateThreads.map(thread => thread.id);

  const { data: messages, error: messageError } =
    await client
      .from("messages")
      .select(`
        thread_id,
        company_id,
        customer_id,
        sender_profile_id,
        recipient_profile_id,
        recipient_role
      `)
      .eq("company_id", profile.company_id)
      .eq("customer_id", currentCustomerId())
      .in("thread_id", ids);

  if (messageError) throw messageError;

  const accessibleIds = new Set(
    (messages || [])
      .filter(canAccessMessage)
      .map(message => String(message.thread_id))
  );

  state.threads = candidateThreads.filter(thread =>
    accessibleIds.has(String(thread.id)) ||
    String(thread.created_by) === String(profile.id)
  );
}


async function loadMessages(threadId = null) {
  const client = ensureClient();

  if (!profile?.company_id) {
    throw new Error("Active tenant missing.");
  }

  const allowedThreads = state.threads.filter(
    canAccessThread
  );

  if (threadId && !allowedThreads.some(
    thread => String(thread.id) === String(threadId)
  )) {
    throw new Error("Conversation is not accessible.");
  }

  const threadIds = threadId
    ? [threadId]
    : allowedThreads.map(thread => thread.id);

  if (!threadIds.length) {
    state.messages = [];
    return;
  }

  let query = client
    .from("messages")
    .select("*")
    .eq("company_id", profile.company_id)
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true })
    .limit(500);

  if (!isTenantRole()) {
    query = query.eq(
      "customer_id",
      currentCustomerId()
    );
  }

  const { data, error } = await query;

  if (error) throw error;

  // A conversation already authorised by loadThreads()
  // is displayed in full to preserve reply context.
  state.messages = data || [];
}

async function loadPlanningMessages() {
  const client =
    ensureClient();

  let query =
    client
      .from("messages")
      .select("*")
      .eq(
        "message_type",
        "planning_digest"
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      )
      .limit(100);

  query =
    scopedQuery(
      query,
      true
    );

  const {
    data,
    error
  } =
    await query;

  if (error) {
    throw error;
  }

  state.planningMessages =
    data || [];
}

  async function loadAnnouncements() {
    const client = ensureClient();
    const now = new Date().toISOString();

    let query = client
      .from("announcement_posts")
      .select("*")
      .eq("is_active", true)
      .lte("starts_at", now)
      .order("created_at", { ascending: false })
      .limit(100);

    if (profile?.company_id) query = query.eq("company_id", profile.company_id);

    const { data, error } = await query;
    if (error) throw error;

    state.announcements = (data || []).filter(a => {
      if (a.expires_at && new Date(a.expires_at) < new Date()) return false;

      if (a.audience === "all") return true;
      if (a.audience === "tenant" && isTenantRole()) return true;
      if (a.audience === "product_owner" && isProductOwnerRole()) {
        if (!a.customer_id) return true;
        return String(a.customer_id) === String(currentCustomerId());
      }
      if (a.audience === profile.role) return true;

      return false;
    });
  }

async function loadUsersAndCustomers() {
  const client = ensureClient();

  if (!profile?.company_id) {
    throw new Error(
      "Cannot load contacts without an active tenant."
    );
  }

  const cid = profile.company_id;

  const [usersRes, customersRes] =
    await Promise.all([
      client
        .from("user_profiles")
        .select(`
          id,
          company_id,
          customer_id,
          full_name,
          email,
          role,
          is_active
        `)
        .eq("company_id", cid)
        .eq("is_active", true)
        .order("full_name", {
          ascending: true
        }),

      client
        .from("customers")
        .select(`
          id,
          company_id,
          name,
          customer_code
        `)
        .eq("company_id", cid)
        .order("name", {
          ascending: true
        })
    ]);

  if (usersRes.error) throw usersRes.error;
  if (customersRes.error) throw customersRes.error;

  state.users = usersRes.data || [];
  state.customers = customersRes.data || [];
}

  async function renderSinceLastVisit() {
    const lastSeen = notificationState?.last_seen_at ||
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    setText("lastVisitLabel", `Since ${formatDate(lastSeen)}`);

    const client = ensureClient();

    const notificationRows = state.notifications.filter(n =>
      new Date(n.created_at) > new Date(lastSeen)
    );

    const downloads = notificationRows.filter(n =>
      String(n.notification_type || "").includes("download")
    ).length;

    const ack = notificationRows.filter(n =>
      String(n.notification_type || "").includes("ack")
    ).length;

    const invoice = notificationRows.filter(n =>
      String(n.notification_type || "").includes("invoice")
    ).length;

    const pod = notificationRows.filter(n =>
      String(n.notification_type || "").includes("pod")
    ).length;

    const scheduled = notificationRows.filter(n =>
      String(n.notification_type || "").includes("scheduled") ||
      String(n.notification_type || "").includes("planned")
    ).length;

    const delivered = notificationRows.filter(n =>
      String(n.notification_type || "").includes("delivered")
    ).length;

    const failed = notificationRows.filter(n =>
      String(n.notification_type || "").includes("failed") ||
      String(n.notification_type || "").includes("refused")
    ).length;

    const newMessages = state.messages.filter(m =>
      new Date(m.created_at) > new Date(lastSeen) &&
      String(m.sender_profile_id) !== String(profile.id)
    ).length;


const packagesReceived =
  await countWarehouseItemsSince(
    lastSeen,
    "received"
  );

const packagesBookedOut =
  await countWarehouseItemsSince(
    lastSeen,
    "outbound"
  );

    const rows = [
      {
  icon: "📦",
  cls: "green",
  title: `${n(packagesReceived)} packages have been received into the warehouse.`,
  sub: "Inbound warehouse activity since your last visit.",
  url: "./stock.html",
  show: packagesReceived > 0
},
      {
        icon: "📦",
        cls: "orange",
        title: `${n(packagesBookedOut)} packages have been booked out of the warehouse.`,
        sub: "Outbound warehouse activity since your last visit.",
        show: packagesBookedOut > 0
      },
      {
        icon: "🧾",
        cls: "blue",
        title: `${n(ack)} Acknowledgements have been generated.`,
        sub: "New ACK documents are available.",
        show: ack > 0
      },
      {
        icon: "🚚",
        cls: "green",
        title: `${n(scheduled)} orders have been scheduled for delivery.`,
        sub: "Delivery planning updates.",
        show: scheduled > 0
      },
      {
        icon: "✅",
        cls: "green",
        title: `${n(delivered)} deliveries have been completed.`,
        sub: "Delivered orders since your last visit.",
        show: delivered > 0
      },
      {
        icon: "⚠️",
        cls: "red",
        title: `${n(failed)} deliveries could not be completed.`,
        sub: "Failed or refused deliveries require attention.",
        show: failed > 0
      },
      {
        icon: "✍️",
        cls: "purple",
        title: `${n(pod)} Proofs of Delivery are now available.`,
        sub: "Signed delivery notes and POD documents.",
        show: pod > 0
      },
      {
        icon: "📄",
        cls: "blue",
        title: `${n(invoice)} invoices have been generated.`,
        sub: "New invoices are available.",
        show: invoice > 0
      },
      {
        icon: "💬",
        cls: "blue",
        title: `${n(newMessages)} new messages are waiting for you.`,
        sub: "Unread direct messages.",
        show: newMessages > 0
      },
      {
        icon: "📥",
        cls: "blue",
        title: `${n(downloads)} documents have been opened or downloaded.`,
        sub: "Portal document activity.",
        show: downloads > 0
      }
    ].filter(r => r.show);

    const list = byId("sinceLastVisitList");
    if (!list) return;

    if (!rows.length) {
      list.innerHTML = `
        <div class="summary-row">
          <div class="row-main">
            <div class="row-icon green">✓</div>
            <div class="row-content">
              <div class="row-title">No major updates since your last visit.</div>
              <div class="row-sub">New warehouse, order, delivery and document activity will appear here.</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

list.innerHTML = rows.map(r => {
  const tag = r.url ? "a" : "div";
  const href = r.url ? `href="${escapeHtml(r.url)}"` : "";

  return `
    <${tag} ${href} class="summary-row">
      <div class="row-main">
        <div class="row-icon ${r.cls}">${r.icon}</div>
        <div class="row-content">
          <div class="row-title">${escapeHtml(r.title)}</div>
          <div class="row-sub">${escapeHtml(r.sub)}</div>
        </div>
      </div>
      ${r.url ? `<div class="row-meta">Open</div>` : ""}
    </${tag}>
  `;
}).join("");
  }

  function renderNotifications() {
    const latest = byId("latestNotificationsList");
    const full = byId("notificationsList");

    const filter = byId("notificationFilter")?.value || "";

    let rows = [...state.notifications];

    if (filter === "unread") rows = rows.filter(n => !n.is_read);
    else if (filter) rows = rows.filter(n =>
      String(n.notification_type || "").includes(filter) ||
      String(n.severity || "").includes(filter)
    );

    const html = rows.map(notificationHtml).join("") || emptyRow("🔔", "No notifications found.", "New automatic updates will appear here.");

    if (latest) latest.innerHTML = rows.slice(0, 8).map(notificationHtml).join("") || emptyRow("🔔", "No notifications yet.", "New updates will appear here.");
    if (full) full.innerHTML = html;

    setText("kpiNotifications", n(state.notifications.filter(n => !n.is_read).length));
  }


async function markNotificationRead(notificationId) {
  if (!notificationId || !profile?.company_id) {
    throw new Error("Notification or tenant missing.");
  }

  const existing = state.notifications.find(
    item => String(item.id) === String(notificationId)
  );

  if (!existing) {
    throw new Error("Notification is not accessible.");
  }

  const client = ensureClient();
  const readAt = new Date().toISOString();

  let query = client
    .from("system_notifications")
    .update({ is_read: true, read_at: readAt })
    .eq("id", notificationId)
    .eq("company_id", profile.company_id);

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error("Customer ID missing.");
    }
    query = query.eq("customer_id", currentCustomerId());
  }

  query = query.or(
    `recipient_profile_id.eq.${profile.id},` +
    `recipient_role.eq.${profile.role},` +
    `recipient_role.is.null`
  );

  const { data, error } = await query.select("id");

  if (error) throw error;
  if (!data?.length) {
    throw new Error("Notification could not be updated.");
  }

  state.notifications = state.notifications.map(item =>
    String(item.id) === String(notificationId)
      ? { ...item, is_read: true, read_at: readAt }
      : item
  );

  renderNotifications();
  updateTabBadges();
}

function notificationMetadata(noti) {
  if (!noti?.metadata) return {};

  if (typeof noti.metadata === "object") {
    return noti.metadata;
  }

  try {
    return JSON.parse(noti.metadata);
  } catch {
    return {};
  }
}

function renderNotificationBody(noti) {

  if (String(noti.notification_type) !== "pod_available") {
    return `
      <div class="row-sub">
        ${escapeHtml(noti.message || "")}
      </div>
    `;
  }

  const meta = notificationMetadata(noti);

  return `
    <div class="pod-card">

      <div class="pod-order">
        ${escapeHtml(meta.order_number || "")}
      </div>

      <div class="pod-retailer">
        ${escapeHtml(meta.retailer_name || "")}
      </div>

      <div class="pod-assets">

        ${
          meta.has_signed_pdf
            ? `
              <div class="pod-pill green">
                ✓ Signed Delivery Note
              </div>
            `
            : ""
        }

        ${
          Number(meta.photo_count || 0) > 0
            ? `
              <div class="pod-pill blue">
                📷 ${meta.photo_count}
                ${meta.photo_count == 1 ? "Delivery Photo" : "Delivery Photos"}
              </div>
            `
            : ""
        }

      </div>

      <div class="pod-footer">

        <span>
          ${formatDate(meta.last_uploaded_at)}
        </span>

        <span class="pod-link">
          Open POD →
        </span>

      </div>

    </div>
  `;
}

  function notificationHtml(noti) {
  const ico = iconFor(noti.notification_type, noti.severity);
  const tag = noti.action_url ? "a" : "div";
  const href = noti.action_url
    ? `href="${escapeHtml(noti.action_url)}" target="_blank" rel="noopener"`
    : "";

  const unreadBadge = !noti.is_read
    ? `<span class="notification-unread-badge">1</span>`
    : "";

  return `
    <${tag} ${href}
      class="notification-row ${!noti.is_read ? "unread" : ""}"
      data-notification-id="${escapeHtml(noti.id)}">

      <div class="row-main">
        <div class="row-icon ${ico.cls}">${ico.icon}</div>

        <div class="row-content">
          <div class="row-title">
            ${escapeHtml(noti.title || "Notification")}
            ${unreadBadge}
          </div>

${renderNotificationBody(noti)}
        </div>
      </div>

      <div class="row-meta">
        ${timeAgo(noti.created_at)}
      </div>
    </${tag}>
  `;
}

  function emptyRow(icon, title, sub) {
    return `
      <div class="notification-row">
        <div class="row-main">
          <div class="row-icon">${icon}</div>
          <div class="row-content">
            <div class="row-title">${escapeHtml(title)}</div>
            <div class="row-sub">${escapeHtml(sub)}</div>
          </div>
        </div>
      </div>
    `;
  }

function unreadCountForThread(threadId) {
  return state.messages.filter(m =>
    String(m.thread_id) === String(threadId) &&
    String(m.sender_profile_id) !== String(profile.id) &&
    !m.read_at
  ).length;
}

function renderThreads() {
  const el =
    byId("threadList");

  if (!el) {
    return;
  }

  /*
   * Alleen gewone directe gesprekken.
   * Planning threads horen in de
   * aparte Planning-tab.
   */
  const directThreads =
    state.threads.filter(
      thread =>
        String(
          thread.thread_type ||
          "direct"
        ).toLowerCase() ===
        "direct"
    );

  if (!directThreads.length) {
    el.innerHTML = `
      <div class="thread-row">

        <div class="thread-title">
          No conversations yet
        </div>

        <div class="thread-sub">
          Create a new message to start a conversation.
        </div>

      </div>
    `;

    return;
  }

  el.innerHTML =
    directThreads
      .map(thread => {

        const unread =
          unreadCountForThread(
            thread.id
          );

        return `
          <div
            class="
              thread-row
              ${
                thread.id ===
                  activeThreadId
                  ? "active"
                  : ""
              }
            "
            data-thread-id="${escapeHtml(
              thread.id
            )}"
          >

            <div
              style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:10px;
              "
            >

              <div class="thread-title">
                ${escapeHtml(
                  thread.subject ||
                  "Message"
                )}
              </div>

              ${
                unread > 0
                  ? `
                      <span
                        class="thread-unread-badge"
                      >
                        ${n(unread)}
                      </span>
                    `
                  : ""
              }

            </div>

            <div class="thread-sub">
              ${escapeHtml(
                thread.status ||
                "open"
              )}
              ·
              ${formatDate(
                thread.updated_at ||
                thread.created_at
              )}
            </div>

          </div>
        `;
      })
      .join("");
}

function parsePlanningDigest(message) {
  const body =
    String(message?.body || "");

  const lines =
    body
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

  if (lines.length < 3) {
    return [];
  }

  const isChanged =
    String(
      message?.title || ""
    )
      .toLowerCase()
      .includes("changed");

  /*
   * Eerste regel is de samenvatting:
   * "3 orders received..."
   *
   * Daarna komen steeds twee regels per order.
   */
  const detailLines =
    lines.slice(1);

  const rows = [];

  for (
    let i = 0;
    i < detailLines.length;
    i += 2
  ) {
    const orderLine =
      detailLines[i] || "";

    const dateLine =
      detailLines[i + 1] || "";

    const parts =
      orderLine.split(" · ");

    const orderNumber =
      parts[0] || "";

    const bellstoneRef =
      parts[1] || "";

    const retailer =
      parts
        .slice(2)
        .join(" · ");

    let previousDate = "";
    let deliveryDate = "";

    if (isChanged) {
      const dates =
        dateLine.split("→");

      previousDate =
        String(
          dates[0] || ""
        ).trim();

      deliveryDate =
        String(
          dates[1] || ""
        ).trim();
    } else {
      deliveryDate =
        dateLine
          .replace(
            /^Delivery:\s*/i,
            ""
          )
          .trim();
    }

    if (!orderNumber) {
      continue;
    }

    rows.push({
      orderNumber,
      bellstoneRef,
      retailer,
      previousDate,
      deliveryDate,
      changeType:
        isChanged
          ? "Changed"
          : "New"
    });
  }

  return rows;
}


function csvEscape(value) {
  const text =
    String(value ?? "");

  return `"${text.replace(
    /"/g,
    '""'
  )}"`;
}



function exportPlanningDigest(message) {
  const rows = parsePlanningDigest(message);

  if (!rows.length) {
    showToast(
      "No planning data available for export.",
      "err"
    );
    return;
  }

  const headers = [
    "Order",
    "External Reference",
    "Retailer",
    "Previous Delivery Date",
    "Delivery Date",
    "Change Type"
  ];

  const csvRows = [
    headers.map(csvEscape).join(","),
    ...rows.map(row => [
      row.orderNumber,
      row.bellstoneRef,
      row.retailer,
      row.previousDate,
      row.deliveryDate,
      row.changeType
    ].map(csvEscape).join(","))
  ];

  const csv = "\uFEFF" + csvRows.join("\r\n");

  const blob = new Blob(
    [csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  const date = new Date(
    message.created_at || Date.now()
  );

  const yyyy = date.getFullYear();
  const mm = String(
    date.getMonth() + 1
  ).padStart(2, "0");
  const dd = String(
    date.getDate()
  ).padStart(2, "0");

  link.href = url;
  link.download =
    `Veynor-Planning-${yyyy}-${mm}-${dd}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  showToast(
    "Planning export downloaded.",
    "ok"
  );
}

function formatPlanningDeliveryDate(value) {
  if (!value) {
    return "Unknown delivery date";
  }

  const parts =
    String(value)
      .trim()
      .split("/");

  if (parts.length !== 3) {
    return value;
  }

  const date =
    new Date(
      Number(parts[2]),
      Number(parts[1]) - 1,
      Number(parts[0])
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date
    .toLocaleDateString(
      "en-GB",
      {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric"
      }
    )
    .toUpperCase();
}

function renderPlanningDigestBody(message) {
  const rows =
    parsePlanningDigest(message);

  if (!rows.length) {
    return `
      <div class="planning-digest-raw">
        ${escapeHtml(
          message.body || ""
        )}
      </div>
    `;
  }

  const isChanged =
    String(
      message.title || ""
    )
      .toLowerCase()
      .includes("changed");


  /*
   * =========================================
   * GEWIJZIGDE LEVERDATA
   * =========================================
   */

  if (isChanged) {
    return `
      <div class="planning-change-list">

        ${rows.map(row => `
          <div class="planning-change-row">

            <div class="planning-order-main">

              <strong>
                ${escapeHtml(
                  row.orderNumber
                )}
              </strong>

              <span class="planning-order-ref">
                ${escapeHtml(
                  row.bellstoneRef
                )}
              </span>

              <span class="planning-order-retailer">
                ${escapeHtml(
                  row.retailer
                )}
              </span>

            </div>


            <div class="planning-date-change">

              <span class="planning-old-date">
                ${escapeHtml(
                  row.previousDate
                )}
              </span>

              <span class="planning-date-arrow">
                →
              </span>

              <span class="planning-new-date">
                ${escapeHtml(
                  row.deliveryDate
                )}
              </span>

            </div>

          </div>
        `).join("")}

      </div>
    `;
  }


  /*
   * =========================================
   * NIEUWE LEVERDATA
   * Groeperen per leverdatum
   * =========================================
   */

  const groups = {};

  rows.forEach(row => {

    const key =
      row.deliveryDate ||
      "Unknown";

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(row);
  });


  /*
   * Datum omzetten voor chronologische sortering
   */

  const parseDate =
    value => {

      const parts =
        String(value)
          .split("/");

      if (parts.length !== 3) {
        return 0;
      }

      return new Date(
        Number(parts[2]),
        Number(parts[1]) - 1,
        Number(parts[0])
      ).getTime();
    };


  const sortedDates =
    Object.keys(groups)
      .sort(
        (a, b) =>
          parseDate(a) -
          parseDate(b)
      );


  /*
   * =========================================
   * RENDER
   * =========================================
   */

  return `
    <div class="planning-date-groups">

      ${sortedDates.map(date => {

        const orders =
          groups[date];

        return `
          <section class="planning-date-group">

            <div class="planning-date-header">

              <div class="planning-date-title">

                <span class="planning-date-calendar">
                  ▣
                </span>

                ${escapeHtml(
                  formatPlanningDeliveryDate(
                    date
                  )
                )}

              </div>


              <span class="planning-date-count">

                ${orders.length}

                ${
                  orders.length === 1
                    ? "order"
                    : "orders"
                }

              </span>

            </div>


            <div class="planning-orders-list">

              <div class="planning-order-head">

                <div>
                  Order
                </div>

                <div>
                  <div>
  External Reference
</div>
                </div>

                <div>
                  Retailer
                </div>

              </div>


              ${orders.map(row => `
                <div class="planning-order-row">

                  <div class="planning-order-number">
                    ${escapeHtml(
                      row.orderNumber
                    )}
                  </div>

                  <div class="planning-order-reference">
                    ${escapeHtml(
                      row.bellstoneRef
                    )}
                  </div>

                  <div class="planning-order-retailer">
                    ${escapeHtml(
                      row.retailer
                    )}
                  </div>

                </div>
              `).join("")}

            </div>

          </section>
        `;
      }).join("")}

    </div>
  `;
}

function renderPlanning() {
  const el =
    byId(
      "planningDigestList"
    );

  if (!el) {
    return;
  }

  const rows =
    [...state.planningMessages]
      .sort(
        (a, b) =>
          new Date(
            b.created_at || 0
          ) -
          new Date(
            a.created_at || 0
          )
      );


  setText(
    "planningSummaryBadge",
    `${rows.length} update${
      rows.length === 1
        ? ""
        : "s"
    }`
  );


  if (!rows.length) {
    el.innerHTML = `
      <div class="planning-empty">

        <div class="row-icon">
          🚚
        </div>

        <div>

          <strong>
            No planning updates yet.
          </strong>

          <div class="row-sub">
            Daily planning summaries will appear here.
          </div>

        </div>

      </div>
    `;

    return;
  }


  el.innerHTML =
    rows
      .map(message => {

        const isChanged =
          String(
            message.title || ""
          )
            .toLowerCase()
            .includes("changed");

        const icon =
          isChanged
            ? "↔"
            : "✓";

        const parsedRows =
          parsePlanningDigest(
            message
          );

        const orderCount =
          parsedRows.length;


        return `
          <article
            class="
              planning-digest-card
              ${
                !message.read_at
                  ? "unread"
                  : ""
              }
            "
            data-planning-message-id="${escapeHtml(
              message.id
            )}"
          >

            <div class="planning-digest-head">

              <div class="planning-digest-heading">

                <div class="planning-digest-icon">
                  ${icon}
                </div>

                <div>

                  <div class="planning-digest-title">

                    ${escapeHtml(
                      message.title ||
                      "Planning Update"
                    )}

                    ${
                      !message.read_at
                        ? `
                            <span
                              class="planning-unread-dot"
                            ></span>
                          `
                        : ""
                    }

                  </div>


                  <div class="planning-digest-sub">

                    ${orderCount}
                    ${
                      orderCount === 1
                        ? "order"
                        : "orders"
                    }

                    ·

                    ${
                      isChanged
                        ? "Delivery dates changed"
                        : "New delivery dates assigned"
                    }

                  </div>

                </div>

              </div>


              <div class="planning-digest-actions">

                <div class="planning-digest-date">
                  ${formatDate(
                    message.created_at
                  )}
                </div>

                <button
                  class="planning-export-btn"
                  type="button"
                  data-export-planning-id="${escapeHtml(
                    message.id
                  )}"
                >
                  ↓ Export CSV
                </button>

              </div>

            </div>


            <div class="planning-digest-body">

              ${renderPlanningDigestBody(
                message
              )}

            </div>

          </article>
        `;
      })
      .join("");
}


async function markPlanningMessageRead(messageId) {
  if (!messageId || !profile?.company_id) {
    throw new Error("Message or tenant missing.");
  }

  const existing = state.planningMessages.find(
    message => String(message.id) === String(messageId)
  );

  if (!existing || existing.read_at) return;

  const client = ensureClient();
  const readAt = new Date().toISOString();

  let query = client
    .from("messages")
    .update({ read_at: readAt })
    .eq("id", messageId)
    .eq("company_id", profile.company_id)
    .eq("message_type", "planning_digest");

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error("Customer ID missing.");
    }
    query = query.eq("customer_id", currentCustomerId());
  }

  const { data, error } = await query.select("id");

  if (error) throw error;
  if (!data?.length) {
    throw new Error("Planning message could not be updated.");
  }

  state.planningMessages = state.planningMessages.map(
    message => String(message.id) === String(messageId)
      ? { ...message, read_at: readAt }
      : message
  );

  renderPlanning();
  updateTabBadges();

  if (typeof window.VeynorUpdateMessageCenterNavBadge === "function") {
    await window.VeynorUpdateMessageCenterNavBadge();
  }
}


async function markThreadMessagesRead(threadId) {
  if (!threadId || !profile?.company_id) return;

  const thread = state.threads.find(
    item => String(item.id) === String(threadId)
  );

  if (!thread) {
    throw new Error("Conversation is not accessible.");
  }

  const unreadIds = state.messages
    .filter(message =>
      String(message.thread_id) === String(threadId) &&
      String(message.sender_profile_id) !== String(profile.id) &&
      !message.read_at
    )
    .map(message => message.id);

  if (!unreadIds.length) return;

  const client = ensureClient();
  const readAt = new Date().toISOString();

  let query = client
    .from("messages")
    .update({ read_at: readAt })
    .eq("company_id", profile.company_id)
    .eq("thread_id", threadId)
    .in("id", unreadIds);

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error("Customer ID missing.");
    }
    query = query.eq("customer_id", currentCustomerId());
  }

  const { data, error } = await query.select("id");

  if (error) throw error;

  const updatedIds = new Set(
    (data || []).map(item => String(item.id))
  );

  state.messages = state.messages.map(message =>
    updatedIds.has(String(message.id))
      ? { ...message, read_at: readAt }
      : message
  );
}


async function openThread(threadId) {
  if (!threadId || !profile?.company_id) {
    throw new Error("Conversation or tenant missing.");
  }

  const thread = state.threads.find(
    item => String(item.id) === String(threadId)
  );

  if (!thread || !canAccessThread(thread)) {
    throw new Error(
      "You do not have access to this conversation."
    );
  }

  await loadMessages(thread.id);

  activeThreadId = thread.id;

  setText(
    "activeThreadTitle",
    thread.subject || "Conversation"
  );

  setText(
    "activeThreadSub",
    `${thread.status || "open"} · ` +
    formatDate(thread.updated_at || thread.created_at)
  );

  setReplyEnabled(true);

  await markThreadMessagesRead(thread.id);

  renderThreads();
  renderChat();
  renderMessagesKpi();
  updateTabBadges();
}

  function renderChat() {
    const el = byId("chatBody");
    if (!el) return;

    const rows = state.messages.filter(m => !activeThreadId || m.thread_id === activeThreadId);

    if (!rows.length) {
      el.innerHTML = `
        <div class="chat-bubble">
          <strong>Veynor</strong>
          <div>No messages in this conversation yet.</div>
          <small>System</small>
        </div>
      `;
      return;
    }

    el.innerHTML = rows.map(m => {
      const mine = String(m.sender_profile_id) === String(profile.id);
      return `
        <div class="chat-bubble ${mine ? "me" : ""}">
          <strong>${escapeHtml(mine ? "You" : senderName(m.sender_profile_id))}</strong>
          <div>${escapeHtml(m.body || "")}</div>
          <small>${formatDate(m.created_at)}</small>
        </div>
      `;
    }).join("");

    el.scrollTop = el.scrollHeight;
  }

  function senderName(id) {
    const u = state.users.find(x => String(x.id) === String(id));
    return u?.full_name || u?.email || "User";
  }

function renderMessagesKpi() {
  const unread =
    state.messages.filter(
      message =>
        String(
          message.message_type ||
          ""
        ) !==
        "planning_digest" &&

        String(
          message.sender_profile_id
        ) !==
        String(
          profile.id
        ) &&

        !message.read_at
    ).length;

  setText(
    "kpiNewMessages",
    n(unread)
  );
}

function updateTabBadges() {
  const unreadMessages =
    state.messages.filter(
      message =>
        String(
          message.message_type ||
          ""
        ) !==
        "planning_digest" &&

        String(
          message.sender_profile_id
        ) !==
        String(
          profile.id
        ) &&

        !message.read_at
    ).length;


  const unreadPlanning =
    state.planningMessages.filter(
      message =>
        !message.read_at
    ).length;


  const unreadNotifications =
    state.notifications.filter(
      notification =>
        !notification.is_read
    ).length;


  const openTasks =
    Number(
      byId(
        "kpiOpenTasks"
      )?.textContent || 0
    );


  const activeAnnouncements =
    state.announcements.length;


  const badges = [
    [
      "messagesTabBadge",
      unreadMessages
    ],

    [
      "notificationsTabBadge",
      unreadNotifications
    ],

    [
      "planningTabBadge",
      unreadPlanning
    ],

    [
      "tasksTabBadge",
      openTasks
    ],

    [
      "announcementsTabBadge",
      activeAnnouncements
    ]
  ];


  badges.forEach(
    ([id, count]) => {

      const badge =
        byId(id);

      if (!badge) {
        return;
      }

      badge.textContent =
        n(count);

      badge.style.display =
        count > 0
          ? "inline-flex"
          : "none";
    }
  );


  const total =
    unreadMessages +
    unreadNotifications +
    unreadPlanning +
    openTasks +
    activeAnnouncements;


  const navBadge =
    document.querySelector(
      '[data-nav-badge="message-center"]'
    );

  if (navBadge) {
    navBadge.textContent =
      n(total);

    navBadge.style.display =
      total > 0
        ? "inline-flex"
        : "none";
  }
}

  function renderAnnouncements() {
    const el = byId("announcementsList");
    if (!el) return;

    setText("kpiAnnouncements", n(state.announcements.length));

    if (!state.announcements.length) {
      el.innerHTML = `
        <div class="announcement-row">
          <div class="row-main">
            <div class="row-icon">📢</div>
            <div class="row-content">
              <div class="row-title">No active announcements.</div>
              <div class="row-sub">Platform updates and customer announcements will appear here.</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    el.innerHTML = state.announcements.map(a => {
      const ico = iconFor(a.announcement_type, a.priority);
      return `
        <div class="announcement-row">
          <div class="row-main">
            <div class="row-icon ${ico.cls}">${ico.icon}</div>
            <div class="row-content">
              <div class="row-title">${escapeHtml(a.title)}</div>
              <div class="row-sub">${escapeHtml(a.message)}</div>
              <div class="row-sub">${escapeHtml(a.announcement_type || "general")} · ${escapeHtml(a.priority || "normal")}</div>
            </div>
          </div>
          <div class="row-meta">${formatDate(a.created_at)}</div>
        </div>
      `;
    }).join("");
  }

  async function renderTasks() {
    const matching = await safeCount("orders", {
      in: { field: "status", value: ["imported", "matching_review"] }
    });

    const planning = await safeCount("orders", {
      in: { field: "status", value: ["ready_for_planning", "stock_complete"] }
    });

    const delivered = await safeCount("orders", {
      eq: [{ field: "status", value: "delivered" }]
    });

    const podDocs = await safeCount("order_documents", {
      eq: [{ field: "document_type", value: "signed_delivery_note" }]
    });

    const podMissing = Math.max(0, delivered - podDocs);

    setText("taskMatchingRequired", n(matching));
    setText("taskPlanningRequired", n(planning));
    setText("taskPodMissing", n(podMissing));

    const tasks = [
      {
        title: `${n(matching)} orders require matching.`,
        sub: "Orders are imported or in matching review.",
        url: "./order-matching.html",
        icon: "🔄",
        cls: "orange",
        show: matching > 0
      },
      {
        title: `${n(planning)} orders are waiting for planning.`,
        sub: "Orders are ready to be planned into routes.",
        url: "./orders.html",
        icon: "🚚",
        cls: "blue",
        show: planning > 0
      },
      {
        title: `${n(podMissing)} delivered orders may be missing POD.`,
        sub: "Check signed delivery notes and POD documents.",
        url: "./operations-control-center.html",
        icon: "✍️",
        cls: "red",
        show: podMissing > 0
      }
    ].filter(t => t.show);

    setText("kpiOpenTasks", n(tasks.length));

    const el = byId("tasksList");
    if (!el) return;

    if (!tasks.length) {
      el.innerHTML = `
        <div class="task-row">
          <div class="row-main">
            <div class="row-icon green">✓</div>
            <div class="row-content">
              <div class="row-title">No urgent tasks.</div>
              <div class="row-sub">Tasks will appear here when orders, deliveries or documents require attention.</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    el.innerHTML = tasks.map(t => `
      <a class="task-row" href="${escapeHtml(t.url)}">
        <div class="row-main">
          <div class="row-icon ${t.cls}">${t.icon}</div>
          <div class="row-content">
            <div class="row-title">${escapeHtml(t.title)}</div>
            <div class="row-sub">${escapeHtml(t.sub)}</div>
          </div>
        </div>
        <div class="row-meta">Open</div>
      </a>
    `).join("");
  }

  function renderLiveFeed() {
    const el = byId("liveActivityFeed");
    if (!el) return;

    const rows = state.notifications.slice(0, 12);

    if (!rows.length) {
      el.innerHTML = `
        <div class="feed-row">
          <div class="row-main">
            <div class="row-icon green">●</div>
            <div class="row-content">
              <div class="row-title">Waiting for activity...</div>
              <div class="row-sub">New updates will appear here while you are logged in.</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    el.innerHTML = rows.map(noti => {
      const ico = iconFor(noti.notification_type, noti.severity);
      const tag = noti.action_url ? "a" : "div";
      const href = noti.action_url ? `href="${escapeHtml(noti.action_url)}"` : "";

      return `
        <${tag} ${href} class="feed-row">
          <div class="row-main">
            <div class="row-icon ${ico.cls}">${ico.icon}</div>
            <div class="row-content">
              <div class="row-title">${escapeHtml(noti.title)}</div>
              <div class="row-sub">${escapeHtml(noti.message)}</div>
            </div>
          </div>
          <div class="row-meta">${timeAgo(noti.created_at)}</div>
        </${tag}>
      `;
    }).join("");
  }


function getSupportUsers() {
  if (!profile?.company_id) {
    return [];
  }

  const supportRoles = [
    "veynor_admin",
    "tenant_admin",
    "tenant_user"
  ];

  return state.users
    .filter(user =>
      String(user.company_id) ===
        String(profile.company_id) &&
      user.is_active === true &&
      supportRoles.includes(
        String(user.role || "").toLowerCase()
      )
    )
    .sort((a, b) =>
      String(a.full_name || a.email || "")
        .localeCompare(
          String(b.full_name || b.email || ""),
          "en",
          { sensitivity: "base" }
        )
    );
}


function populateRecipients() {
  const typeSelect = byId(
    "newMessageRecipientType"
  );

  if (!typeSelect) return;

  if (!profile?.company_id) {
    typeSelect.innerHTML = "";
    return;
  }

  const companyName =
    profile.companies?.name ||
    "Company";

  const currentType =
    typeSelect.value || "tenant";

  if (!isTenantRole()) {
    typeSelect.innerHTML = `
      <option value="tenant">
        ${escapeHtml(companyName)} Support
      </option>
    `;

    populateContactPersons();
    return;
  }

  typeSelect.innerHTML = `
    <option value="tenant">
      ${escapeHtml(companyName)} Internal
    </option>
    <option value="product_owner">
      Product Owner
    </option>
    <option value="retailer">
      Retailer
    </option>
    <option value="driver">
      Driver
    </option>
    <option value="user">
      Specific User
    </option>
  `;

  if (
    [...typeSelect.options].some(
      option => option.value === currentType
    )
  ) {
    typeSelect.value = currentType;
  }

  populateContactPersons();
}


function populateContactPersons() {
  const recipientType =
    byId("newMessageRecipientType")?.value || "tenant";

  const contactSelect = byId("newMessageContact");
  if (!contactSelect) return;

  if (!profile?.company_id) {
    contactSelect.innerHTML =
      '<option value="">No contacts available</option>';
    return;
  }

  const users = state.users.filter(user =>
    String(user.company_id) === String(profile.company_id) &&
    user.is_active === true
  );

  let recipients = [];

  if (!isTenantRole()) {
    recipients = getSupportUsers();
  } else {
    const rolesByType = {
      tenant: ["veynor_admin", "tenant_admin", "tenant_user"],
      product_owner: ["product_owner_admin", "product_owner_user"],
      retailer: ["retailer_user"],
      driver: ["driver", "chauffeur"]
    };

    recipients = recipientType === "user"
      ? users
      : users.filter(user =>
          (rolesByType[recipientType] || []).includes(
            String(user.role || "").toLowerCase()
          )
        );
  }

  recipients.sort((a, b) =>
    String(a.full_name || a.email || "").localeCompare(
      String(b.full_name || b.email || ""),
      "en",
      { sensitivity: "base" }
    )
  );

  const previous = contactSelect.value;

  contactSelect.innerHTML =
    '<option value="">General inbox</option>' +
    recipients.map(user => `
      <option value="${escapeHtml(user.id)}">
        ${escapeHtml(user.full_name || user.email || "User")}
      </option>
    `).join("");

  if (recipients.some(user => String(user.id) === previous)) {
    contactSelect.value = previous;
  }
}


async function sendNewMessage() {
  const client = ensureClient();

  if (!profile?.id || !profile?.company_id) {
    throw new Error("Active user profile is missing.");
  }

  const subject = clean(byId("newMessageSubject")?.value);
  const body = clean(byId("newMessageBody")?.value);
  const recipientType =
    byId("newMessageRecipientType")?.value || "tenant";
  const contactPerson =
    byId("newMessageContact")?.value || null;

  if (!subject || !body) {
    showToast("Please enter a subject and message.", "err");
    return;
  }

  const allowedRoles = {
    tenant: ["veynor_admin", "tenant_admin", "tenant_user"],
    product_owner: ["product_owner_admin", "product_owner_user"],
    retailer: ["retailer_user"],
    driver: ["driver", "chauffeur"]
  };

  const selectedUser = contactPerson
    ? state.users.find(user =>
        String(user.id) === String(contactPerson) &&
        String(user.company_id) === String(profile.company_id) &&
        user.is_active === true
      )
    : null;

  if (contactPerson && !selectedUser) {
    throw new Error(
      "Selected recipient is not available in this company."
    );
  }

  if (selectedUser && !isTenantRole()) {
    if (!allowedRoles.tenant.includes(selectedUser.role)) {
      throw new Error(
        "Customer users can only contact company support."
      );
    }
  }

  if (
    selectedUser &&
    isTenantRole() &&
    recipientType !== "user" &&
    !(allowedRoles[recipientType] || []).includes(
      selectedUser.role
    )
  ) {
    throw new Error(
      "Selected contact does not match the recipient type."
    );
  }

  if (
    isTenantRole() &&
    ["product_owner", "retailer"].includes(recipientType) &&
    !selectedUser
  ) {
    throw new Error(
      "Please select a specific customer contact."
    );
  }

  const customerId = !isTenantRole()
    ? currentCustomerId()
    : selectedUser?.customer_id || null;

  if (!isTenantRole() && !customerId) {
    throw new Error(
      "Your account has no customer assigned."
    );
  }

  if (selectedUser?.customer_id) {
    const { data: customer, error: customerError } =
      await client
        .from("customers")
        .select("id")
        .eq("id", selectedUser.customer_id)
        .eq("company_id", profile.company_id)
        .maybeSingle();

    if (customerError) throw customerError;

    if (!customer) {
      throw new Error(
        "Recipient customer is not part of this tenant."
      );
    }
  }

  const recipientRole = selectedUser
    ? null
    : !isTenantRole()
      ? "tenant_admin"
      : recipientType === "tenant"
        ? "tenant_admin"
        : recipientType === "driver"
          ? "driver"
          : null;

  if (!selectedUser && !recipientRole) {
    throw new Error(
      "Please select a valid recipient."
    );
  }

  const { data: thread, error: threadError } =
    await client
      .from("message_threads")
      .insert({
        company_id: profile.company_id,
        customer_id: customerId,
        subject,
        thread_type: "direct",
        status: "open",
        created_by: profile.id
      })
      .select("*")
      .single();

  if (threadError) throw threadError;

  const { error: messageError } = await client
    .from("messages")
    .insert({
      thread_id: thread.id,
      company_id: profile.company_id,
      customer_id: customerId,
      sender_profile_id: profile.id,
      recipient_profile_id: selectedUser?.id || null,
      recipient_role: recipientRole,
      message_type: "manual",
      title: subject,
      body,
      is_system: false
    });

  if (messageError) {
    // Do not delete the thread automatically:
    // a separate process may already reference it.
    throw new Error(
      "Conversation created, but the message could not be sent: " +
      messageError.message
    );
  }

  if (byId("newMessageSubject")) {
    byId("newMessageSubject").value = "";
  }

  if (byId("newMessageBody")) {
    byId("newMessageBody").value = "";
  }

  if (byId("newMessagePanel")) {
    byId("newMessagePanel").style.display = "none";
  }

  await refreshAll();
  await openThread(thread.id);

  showToast("Message sent.", "ok");
}

function setReplyEnabled(enabled) {
  const textarea = byId("messageReplyBody");
  const sendBtn = byId("btnSendReply");
  const attachBtn = byId("btnAttachFile");

  if (textarea) {
    textarea.disabled = !enabled;
    textarea.placeholder = enabled
      ? "Type your reply..."
      : "Select a conversation first...";
  }

  if (sendBtn) sendBtn.disabled = !enabled;
  if (attachBtn) attachBtn.disabled = !enabled;
}


async function sendReply() {
  if (!activeThreadId) {
    showToast("Select a conversation first.", "err");
    return;
  }

  const body = clean(byId("messageReplyBody")?.value);

  if (!body) {
    showToast("Please type a reply.", "err");
    return;
  }

  if (!profile?.id || !profile?.company_id) {
    throw new Error("Active profile is missing.");
  }

  const client = ensureClient();

  const thread = state.threads.find(
    item => String(item.id) === String(activeThreadId)
  );

  if (!thread || !canAccessThread(thread)) {
    throw new Error("Conversation is not accessible.");
  }

  const { data: history, error: historyError } =
    await client
      .from("messages")
      .select(`
        id,
        sender_profile_id,
        recipient_profile_id,
        recipient_role,
        created_at
      `)
      .eq("company_id", profile.company_id)
      .eq("thread_id", thread.id)
      .eq("message_type", "manual")
      .order("created_at", { ascending: true })
      .limit(500);

  if (historyError) throw historyError;

  const messages = history || [];

  const lastIncoming = [...messages].reverse().find(
    message =>
      String(message.sender_profile_id) !== String(profile.id)
  );

  const firstMessage = messages[0];

  let recipientId = null;
  let recipientRole = null;

  if (lastIncoming?.sender_profile_id) {
    recipientId = lastIncoming.sender_profile_id;
  } else if (
    thread.created_by &&
    String(thread.created_by) !== String(profile.id)
  ) {
    recipientId = thread.created_by;
  } else if (firstMessage?.recipient_profile_id) {
    recipientId = firstMessage.recipient_profile_id;
  } else if (firstMessage?.recipient_role) {
    recipientRole = firstMessage.recipient_role;
  }

  if (
    recipientId &&
    String(recipientId) === String(profile.id)
  ) {
    recipientId = null;
  }

  if (!recipientId && !recipientRole) {
    throw new Error(
      "Cannot determine the recipient of this reply."
    );
  }

  if (recipientId) {
    const { data: recipient, error: recipientError } =
      await client
        .from("user_profiles")
        .select("id, company_id, is_active")
        .eq("id", recipientId)
        .eq("company_id", profile.company_id)
        .eq("is_active", true)
        .maybeSingle();

    if (recipientError) throw recipientError;

    if (!recipient) {
      throw new Error(
        "The recipient is not available in this company."
      );
    }
  }

  const { error } = await client
    .from("messages")
    .insert({
      thread_id: thread.id,
      company_id: profile.company_id,
      customer_id: thread.customer_id || null,
      sender_profile_id: profile.id,
      recipient_profile_id: recipientId,
      recipient_role: recipientRole,
      message_type: "manual",
      title: thread.subject || "Reply",
      body,
      is_system: false
    });

  if (error) throw error;

  const { error: updateError } = await client
    .from("message_threads")
    .update({
      updated_at: new Date().toISOString()
    })
    .eq("id", thread.id)
    .eq("company_id", profile.company_id);

  if (updateError) {
    console.warn(
      "[Veynor] Reply sent, timestamp update failed:",
      updateError.message
    );
  }

  if (byId("messageReplyBody")) {
    byId("messageReplyBody").value = "";
  }

  await loadThreads();
  await openThread(thread.id);

  showToast("Reply sent.", "ok");
}


async function publishAnnouncement() {
    const client = ensureClient();

    const title = clean(byId("announcementTitle")?.value);
    const message = clean(byId("announcementMessage")?.value);

    if (!title || !message) {
      showToast("Please enter a title and message.", "err");
      return;
    }

    const { error } = await client
      .from("announcement_posts")
      .insert({
        company_id: profile.company_id,
        created_by: profile.id,
        title,
        message,
        announcement_type: byId("announcementType")?.value || "general",
        priority: byId("announcementPriority")?.value || "normal",
        audience: byId("announcementAudience")?.value || "all",
        show_popup: byId("announcementPopup")?.value === "true",
        is_active: true
      });

    if (error) throw error;

    byId("announcementTitle").value = "";
    byId("announcementMessage").value = "";
    byId("announcementComposer").style.display = "none";

    await loadAnnouncements();
    renderAnnouncements();

    showToast("Announcement published.", "ok");
  }


async function markNotificationsRead() {
  if (!profile?.company_id) {
    throw new Error("Active tenant missing.");
  }

  const ids = state.notifications
    .filter(notification => !notification.is_read)
    .map(notification => notification.id);

  if (!ids.length) return;

  const client = ensureClient();
  const readAt = new Date().toISOString();

  let query = client
    .from("system_notifications")
    .update({ is_read: true, read_at: readAt })
    .eq("company_id", profile.company_id)
    .in("id", ids);

  if (!isTenantRole()) {
    if (!currentCustomerId()) {
      throw new Error("Customer ID missing.");
    }
    query = query.eq("customer_id", currentCustomerId());
  }

  query = query.or(
    `recipient_profile_id.eq.${profile.id},` +
    `recipient_role.eq.${profile.role},` +
    `recipient_role.is.null`
  );

  const { data, error } = await query.select("id");

  if (error) throw error;

  const updatedIds = new Set(
    (data || []).map(item => String(item.id))
  );

  state.notifications = state.notifications.map(
    notification => updatedIds.has(String(notification.id))
      ? { ...notification, is_read: true, read_at: readAt }
      : notification
  );

  renderNotifications();
  updateTabBadges();

  if (typeof window.VeynorUpdateMessageCenterNavBadge === "function") {
    await window.VeynorUpdateMessageCenterNavBadge();
  }

  showToast("Notifications marked as read.", "ok");
}

  async function updateLastSeen() {
    const client = ensureClient();

    await client
      .from("user_notification_state")
      .upsert({
        user_profile_id: profile.id,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
  }

  function bindTabs() {
    document.querySelectorAll(".message-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".message-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

        btn.classList.add("active");
        byId("tab-" + btn.dataset.tab)?.classList.add("active");
      });
    });
  }

function bindPlanningEvents() {
  byId(
    "planningDigestList"
  )?.addEventListener(
    "click",
    async event => {

      /*
       * Eerst controleren of op
       * Export CSV is geklikt.
       */
      const exportButton =
        event.target.closest(
          "[data-export-planning-id]"
        );

      if (exportButton) {
        event.preventDefault();
        event.stopPropagation();

        const messageId =
          exportButton.dataset
            .exportPlanningId;

        const message =
          state.planningMessages.find(
            item =>
              String(item.id) ===
              String(messageId)
          );

        if (!message) {
          showToast(
            "Planning update not found.",
            "err"
          );

          return;
        }

        exportPlanningDigest(
          message
        );

        return;
      }


      /*
       * Gewone klik op kaart:
       * markeer als gelezen.
       */
      const card =
        event.target.closest(
          "[data-planning-message-id]"
        );

      if (!card) {
        return;
      }

      try {

        await markPlanningMessageRead(
          card.dataset
            .planningMessageId
        );

      } catch (error) {

        console.error(
          "Planning message read failed:",
          error
        );

        showToast(
          error.message ||
          "Could not mark planning update as read.",
          "err"
        );
      }
    }
  );
}

 function bindEvents() {

  // --------------------------------------------------
  // Notifications
  // --------------------------------------------------

  byId("btnMarkNotificationsRead")?.addEventListener(
    "click",
    markNotificationsRead
  );

  byId("notificationFilter")?.addEventListener(
    "change",
    renderNotifications
  );

document.addEventListener("click", async event => {

  const notification = event.target.closest("[data-notification-id]");

  if (!notification) return;

  event.preventDefault();

  try {

    await markNotificationRead(notification.dataset.notificationId);

    renderNotifications();

    updateTabBadges();

    if (window.VeynorUpdateMessageCenterNavBadge) {
      await window.VeynorUpdateMessageCenterNavBadge();
    }

    const url = notification.getAttribute("href");

    if (url) {
      window.open(url, "_blank", "noopener");
    }

  } catch (error) {

    console.error(error);

  }

});

  // --------------------------------------------------
  // New Message
  // --------------------------------------------------

  byId("btnNewMessage")?.addEventListener("click", () => {
    byId("newMessagePanel").style.display = "grid";
  });

  byId("btnCancelNewMessage")?.addEventListener("click", () => {
    byId("newMessagePanel").style.display = "none";
  });

  byId("newMessageRecipientType")?.addEventListener(
    "change",
    populateRecipients
  );


  byId("btnSendNewMessage")?.addEventListener("click", async () => {

    try {

      await sendNewMessage();

    } catch (error) {

      console.error(error);

      showToast(
        error.message || "Could not send message.",
        "err"
      );

    }

  });

  // --------------------------------------------------
  // Reply
  // --------------------------------------------------

  byId("btnSendReply")?.addEventListener("click", async () => {

    try {

      await sendReply();

    } catch (error) {

      console.error(error);

      showToast(
        error.message || "Could not send reply.",
        "err"
      );

    }

  });

  // --------------------------------------------------
  // Thread selection
  // --------------------------------------------------

  byId("threadList")?.addEventListener("click", async event => {

    const row = event.target.closest("[data-thread-id]");

    if (!row) return;

    try {

      await openThread(row.dataset.threadId);

    } catch (error) {

      console.error(error);

      showToast(
        error.message || "Could not open conversation.",
        "err"
      );

    }

  });

  // --------------------------------------------------
  // Announcements
  // --------------------------------------------------

  byId("btnNewAnnouncement")?.addEventListener("click", () => {
    byId("announcementComposer").style.display = "grid";
  });

  byId("btnCancelAnnouncement")?.addEventListener("click", () => {
    byId("announcementComposer").style.display = "none";
  });

  byId("btnPublishAnnouncement")?.addEventListener("click", async () => {

    try {

      await publishAnnouncement();

    } catch (error) {

      console.error(error);

      showToast(
        error.message || "Could not publish announcement.",
        "err"
      );

    }

  });

}

  function ensurePopupContainer() {
    let el = document.getElementById("veynorNotificationPopups");

    if (el) return el;

    el = document.createElement("div");
    el.id = "veynorNotificationPopups";
    el.style.cssText = `
      position:fixed;
      right:22px;
      bottom:22px;
      z-index:999999;
      display:grid;
      gap:10px;
      width:min(390px,calc(100vw - 44px));
    `;

    document.body.appendChild(el);
    return el;
  }

  function pushLivePopup(notification) {
    liveQueue.push(notification);

    if (liveTimer) return;

    liveTimer = setTimeout(() => {
      const batch = liveQueue.splice(0);
      liveTimer = null;

      if (batch.length <= 2) {
        batch.forEach(showLivePopup);
      } else {
        showLivePopup({
          title: `${batch.length} new updates`,
          message: "Several new notifications are available. Open the Message Center to view all updates.",
          action_url: "./message-center.html",
          notification_type: "multiple_updates",
          severity: "info"
        });
      }
    }, 800);
  }

  function showLivePopup(notification) {
    const container = ensurePopupContainer();
    const ico = iconFor(notification.notification_type, notification.severity);

    const card = document.createElement("div");
    card.style.cssText = `
      background:#fff;
      border:1px solid #dce5f2;
      border-radius:18px;
      box-shadow:0 22px 55px rgba(7,21,47,.22);
      padding:14px;
      display:grid;
      gap:10px;
      animation:veynorPopupIn .18s ease-out;
    `;

    card.innerHTML = `
      <div style="display:flex;gap:11px;align-items:flex-start;">
        <div class="row-icon ${ico.cls}">${ico.icon}</div>
        <div style="display:grid;gap:4px;min-width:0;flex:1;">
          <strong style="font-size:13px;color:#07152f;">${escapeHtml(notification.title || "New notification")}</strong>
          <span style="font-size:12px;color:#5f6f89;line-height:1.45;">${escapeHtml(notification.message || "")}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" data-close-popup class="btn">Dismiss</button>
        ${notification.action_url ? `<a href="${escapeHtml(notification.action_url)}" class="btn btn-primary">View</a>` : ""}
      </div>
    `;

    card.querySelector("[data-close-popup]")?.addEventListener("click", () => card.remove());

    container.appendChild(card);

    setTimeout(() => {
      if (card.isConnected) card.remove();
    }, 9000);
  }

  function injectPopupStyle() {
    if (document.getElementById("veynorPopupStyle")) return;

    const style = document.createElement("style");
    style.id = "veynorPopupStyle";
    style.textContent = `
      @keyframes veynorPopupIn {
        from { opacity:0; transform:translateY(10px) scale(.98); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }
    `;

    document.head.appendChild(style);
  }



function bindRealtime() {
  const client = ensureClient();

  if (!profile?.company_id || !profile?.id) {
    console.warn(
      "[Veynor] Realtime not started: active profile missing."
    );
    return;
  }

  if (typeof client.channel !== "function") {
    console.warn("[Veynor] Supabase Realtime unavailable.");
    return;
  }

  if (window.__veynorMessageCenterChannel) {
    client.removeChannel(
      window.__veynorMessageCenterChannel
    );
  }

  const companyId = profile.company_id;

  const channel = client.channel(
    `message-center-${companyId}-${profile.id}`
  );

  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "system_notifications",
      filter: `company_id=eq.${companyId}`
    },
    payload => {
      const notification = payload.new;

      if (!notification || !profile?.company_id) return;

      if (
        String(notification.company_id) !==
        String(profile.company_id)
      ) {
        return;
      }

      if (
        !isTenantRole() &&
        String(notification.customer_id || "") !==
        String(currentCustomerId() || "")
      ) {
        return;
      }

      if (
        notification.recipient_profile_id &&
        String(notification.recipient_profile_id) !==
        String(profile.id)
      ) {
        return;
      }

      if (
        notification.recipient_role &&
        String(notification.recipient_role) !==
        String(profile.role)
      ) {
        return;
      }

      if (
        state.notifications.some(
          item => String(item.id) === String(notification.id)
        )
      ) {
        return;
      }

      state.notifications.unshift(notification);

      state.notifications =
        state.notifications.slice(0, 250);

      renderNotifications();
      renderLiveFeed();
      updateTabBadges();

      // The central Notification Service handles
      // notification popups when available.
      if (!window.VeynorNotifications) {
        pushLivePopup(notification);
      }
    }
  );

  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `company_id=eq.${companyId}`
    },
    payload => {
      const message = payload.new;

      if (!message || !profile?.company_id) return;

      if (
        String(message.company_id) !==
        String(profile.company_id)
      ) {
        return;
      }

      if (
        !isTenantRole() &&
        String(message.customer_id || "") !==
        String(currentCustomerId() || "")
      ) {
        return;
      }

      if (
        String(message.message_type || "") ===
        "planning_digest"
      ) {
        loadPlanningMessages()
          .then(() => {
            renderPlanning();
            updateTabBadges();
          })
          .catch(error => {
            console.error(
              "[Veynor] Planning realtime refresh failed:",
              error
            );
          });

        return;
      }

      if (!canAccessMessage(message)) {
        return;
      }

      const isOwnMessage =
        String(message.sender_profile_id) ===
        String(profile.id);

      if (!isOwnMessage) {
        pushLivePopup({
          title: "New Message",
          message:
            message.title ||
            "A new message has been received.",
          action_url: "./message-center.html",
          notification_type: "message",
          severity: "info"
        });
      }

      refreshAll().catch(error => {
        console.error(
          "[Veynor] Message Center realtime refresh failed:",
          error
        );
      });
    }
  );

  channel.subscribe(status => {
    if (status === "CHANNEL_ERROR") {
      console.warn(
        "[Veynor] Message Center realtime connection error."
      );
    }
  });

  window.__veynorMessageCenterChannel = channel;
}
   

async function refreshAll() {
  if (!profile?.company_id) {
    throw new Error(
      "Cannot refresh Message Center without an active tenant."
    );
  }

  // Load conversations before their messages.
  await loadThreads();

  if (
    activeThreadId &&
    !state.threads.some(
      thread => String(thread.id) ===
        String(activeThreadId)
    )
  ) {
    activeThreadId = null;
    setReplyEnabled(false);
  }

  await Promise.all([
    loadNotifications(),
    loadMessages(activeThreadId),
    loadPlanningMessages(),
    loadAnnouncements()
  ]);

  await renderSinceLastVisit();

  renderNotifications();
  renderThreads();
  renderChat();
  renderMessagesKpi();
  renderPlanning();
  renderAnnouncements();
  renderLiveFeed();

  await renderTasks();

  updateTabBadges();
}

async function init() {
  injectPopupStyle();

  bindTabs();
  bindEvents();
  bindPlanningEvents();

  setReplyEnabled(
    false
  );

  try {

    await loadProfile();

    await loadNotificationState();

    await loadUsersAndCustomers();

    populateRecipients();
    populateContactPersons();

    await refreshAll();

    bindRealtime();

    setTimeout(
      updateLastSeen,
      2500
    );

    showToast(
      "Message Center loaded.",
      "ok"
    );

  } catch (error) {

    console.error(error);

    showToast(
      error.message ||
      "Message Center could not load.",
      "err"
    );
  }
}

  document.addEventListener("DOMContentLoaded", init);
})();