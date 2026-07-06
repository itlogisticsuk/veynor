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
    const { data: userData } = await client.auth.getUser();
    const userId = userData?.user?.id;

    if (!userId) throw new Error("No authenticated user found.");

    let result = await client
      .from("user_profiles")
      .select(`
        *,
        companies ( id, name ),
        customers ( id, name, customer_code )
      `)
      .eq("id", userId)
      .maybeSingle();

    if (!result.data && !result.error) {
      result = await client
        .from("user_profiles")
        .select(`
          *,
          companies ( id, name ),
          customers ( id, name, customer_code )
        `)
        .eq("auth_user_id", userId)
        .maybeSingle();
    }

    if (result.error) throw result.error;

    profile = result.data;
    if (!profile) throw new Error("User profile not found.");

    setText("welcomeTitle", `${greeting()}, ${displayName()}.`);

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
    if (profile?.company_id) query = query.eq("company_id", profile.company_id);

    if (!isTenantRole() && tableHasCustomer && currentCustomerId()) {
      query = query.eq("customer_id", currentCustomerId());
    }

    return query;
  }

  async function safeCount(table, filters = {}) {
    try {
      const client = ensureClient();

      let query = client
        .from(table)
        .select("id", { count: "exact", head: true });

      query = scopedQuery(query, filters.customer !== false);

      if (filters.gte) query = query.gte(filters.gte.field, filters.gte.value);
      if (filters.lte) query = query.lte(filters.lte.field, filters.lte.value);
      if (filters.eq) filters.eq.forEach(f => query = query.eq(f.field, f.value));
      if (filters.in) filters.in.forEach(f => query = query.in(f.field, f.value));

      const { count, error } = await query;
      if (error) return 0;

      return count || 0;
    } catch {
      return 0;
    }
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

    let query = client
      .from("message_threads")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100);

    query = scopedQuery(query, true);

    const { data, error } = await query;
    if (error) throw error;

    state.threads = data || [];
  }

  async function loadMessages(threadId = null) {
    const client = ensureClient();

    let query = client
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(500);

    query = scopedQuery(query, true);

    if (threadId) query = query.eq("thread_id", threadId);

    const { data, error } = await query;
    if (error) throw error;

    state.messages = data || [];
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

    const [usersRes, customersRes] = await Promise.all([
      client
        .from("user_profiles")
        .select("id, full_name, email, role, customer_id")
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
      client
        .from("customers")
        .select("id, name, customer_code")
        .order("name", { ascending: true })
    ]);

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

    const packagesReceived = await safeCount("items", {
      gte: { field: "created_at", value: lastSeen }
    });

    const packagesBookedOut = await safeCount("items", {
      gte: { field: "updated_at", value: lastSeen },
      in: { field: "status", value: ["picked", "loaded", "shipped", "delivered", "outbound"] }
    }).catch(() => 0);

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
  if (!notificationId) return;

  const client = ensureClient();

  const { error } = await client
    .from("system_notifications")
    .update({
      is_read: true,
      read_at: new Date().toISOString()
    })
    .eq("id", notificationId);

  if (error) {
    console.warn("Notification read update failed:", error.message);
    return;
  }

  state.notifications = state.notifications.map(n =>
    String(n.id) === String(notificationId)
      ? { ...n, is_read: true, read_at: new Date().toISOString() }
      : n
  );

  renderNotifications();
  updateTabBadges();
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

          <div class="row-sub">
            ${escapeHtml(noti.message || "")}
          </div>
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
    const el = byId("threadList");
    if (!el) return;

    if (!state.threads.length) {
      el.innerHTML = `
        <div class="thread-row">
          <div class="thread-title">No conversations yet</div>
          <div class="thread-sub">Create a new message to start a conversation.</div>
        </div>
      `;
      return;
    }

  el.innerHTML = state.threads.map(t => {
  const unread = unreadCountForThread(t.id);

  return `
    <div class="thread-row ${t.id === activeThreadId ? "active" : ""}" data-thread-id="${escapeHtml(t.id)}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div class="thread-title">${escapeHtml(t.subject || "Message")}</div>
        ${
          unread > 0
            ? `<span class="thread-unread-badge">${n(unread)}</span>`
            : ""
        }
      </div>
      <div class="thread-sub">${escapeHtml(t.status || "open")} · ${formatDate(t.updated_at || t.created_at)}</div>
    </div>
  `;
}).join("");
  }

async function markThreadMessagesRead(threadId) {
  const client = ensureClient();

  const unreadIds = state.messages
    .filter(m =>
      String(m.thread_id) === String(threadId) &&
      String(m.sender_profile_id) !== String(profile.id) &&
      !m.read_at
    )
    .map(m => m.id);

  if (!unreadIds.length) return;

  const { error } = await client
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .in("id", unreadIds);

  if (error) throw error;

  state.messages = state.messages.map(m =>
    unreadIds.includes(m.id)
      ? { ...m, read_at: new Date().toISOString() }
      : m
  );
}

  async function openThread(threadId) {
    activeThreadId = threadId;
setReplyEnabled(true);
    await loadMessages(threadId);

    const thread = state.threads.find(t => t.id === threadId);
    setText("activeThreadTitle", thread?.subject || "Conversation");
    setText("activeThreadSub", `${thread?.status || "open"} · ${formatDate(thread?.updated_at || thread?.created_at)}`);

await markThreadMessagesRead(threadId);

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
    const unread = state.messages.filter(m =>
      String(m.sender_profile_id) !== String(profile.id) && !m.read_at
    ).length;

    setText("kpiNewMessages", n(unread));
  }

function updateTabBadges() {
  const unreadMessages = state.messages.filter(m =>
    String(m.sender_profile_id) !== String(profile.id) && !m.read_at
  ).length;

  const unreadNotifications = state.notifications.filter(n => !n.is_read).length;
  const openTasks = Number(byId("kpiOpenTasks")?.textContent || 0);
  const activeAnnouncements = state.announcements.length;

  const badges = [
    ["messagesTabBadge", unreadMessages],
    ["notificationsTabBadge", unreadNotifications],
    ["tasksTabBadge", openTasks],
    ["announcementsTabBadge", activeAnnouncements]
  ];

  badges.forEach(([id, count]) => {
    const badge = byId(id);
    if (!badge) return;

    badge.textContent = n(count);
    badge.style.display = count > 0 ? "inline-flex" : "none";
  });

  // Deze werkt pas nadat we layout.js hebben aangepast
  const total = unreadMessages + unreadNotifications + openTasks + activeAnnouncements;

  const navBadge = document.querySelector('[data-nav-badge="message-center"]');
  if (navBadge) {
    navBadge.textContent = n(total);
    navBadge.style.display = total > 0 ? "inline-flex" : "none";
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
  let users = state.users.filter(u => {
    const role = String(u.role || "").toLowerCase();
    return ["veynor_admin", "tenant_admin", "tenant_user"].includes(role);
  });

  if (!users.length) {
    users = [
      {
        id: "656958cb-b0d5-4011-9a0d-aa42961cc920",
        full_name: "Huib Jansen",
        email: "cmjnhuur@gmail.com",
        role: "veynor_admin"
      },
      {
        id: "7b852bb4-a193-42d2-a315-dc7092675a41",
        full_name: "Rob Justice",
        email: "eljustice1@yahoo.com",
        role: "tenant_admin"
      }
    ];
  }

  return users;
}

function populateRecipients() {
  const typeSelect = byId("newMessageRecipientType");
  if (!typeSelect) return;

  if (!isTenantRole()) {
    typeSelect.innerHTML = `<option value="tenant">Veynor / Sofa2U</option>`;
    populateContactPersons();
    return;
  }

  const currentType = typeSelect.value || "tenant";

  typeSelect.innerHTML = `
    <option value="tenant">Veynor / Sofa2U Internal</option>
    <option value="product_owner">Product Owner</option>
    <option value="retailer">Retailer</option>
    <option value="driver">Driver</option>
    <option value="user">Specific User</option>
  `;

  typeSelect.value = currentType;
  populateContactPersons();
}
function populateContactPersons() {
  const recipientType =
    byId("newMessageRecipientType")?.value || "tenant";

  const contactSelect = byId("newMessageContact");
  if (!contactSelect) return;

  let users = [];

  if (!isTenantRole()) {

    // Klanten kunnen alleen Veynor/Sofa2U contacten kiezen
    users = getSupportUsers();

  } else {

    switch (recipientType) {

      case "tenant":
        users = state.users.filter(u =>
          ["veynor_admin", "tenant_admin", "tenant_user"].includes(
            String(u.role || "").toLowerCase()
          )
        );
        break;

      case "product_owner":
        users = state.users.filter(u =>
          ["product_owner_admin", "product_owner_user"].includes(
            String(u.role || "").toLowerCase()
          )
        );
        break;

      case "retailer":
        users = state.users.filter(u =>
          String(u.role || "").toLowerCase() === "retailer_user"
        );
        break;

      case "driver":
        users = state.users.filter(u =>
          ["driver", "chauffeur"].includes(
            String(u.role || "").toLowerCase()
          )
        );
        break;

      case "user":
        users = state.users;
        break;

      default:
        users = [];
        break;
    }
  }

  users.sort((a, b) =>
    String(a.full_name || a.email || "").localeCompare(
      String(b.full_name || b.email || ""),
      "en",
      { sensitivity: "base" }
    )
  );

  contactSelect.innerHTML =
    `<option value="">All users / general inbox</option>` +
    users.map(user => `
      <option value="${escapeHtml(user.id)}">
        ${escapeHtml(user.full_name || user.email || "User")}
      </option>
    `).join("");

  console.log("Recipient type:", recipientType);
  console.log("Loaded contacts:", users);
}

async function sendNewMessage() {
  const client = ensureClient();

  const subject = clean(byId("newMessageSubject")?.value);
  const body = clean(byId("newMessageBody")?.value);
  const recipientType = byId("newMessageRecipientType")?.value || "tenant";
  const recipient = byId("newMessageRecipient")?.value || null;
  const contactPerson = byId("newMessageContact")?.value || null;

  if (!subject || !body) {
    showToast("Please enter a subject and message.", "err");
    return;
  }

  const customerId = isTenantRole()
    ? (
        recipientType === "product_owner" || recipientType === "retailer"
          ? recipient
          : null
      )
    : currentCustomerId();

  const recipientProfileId = contactPerson
    ? contactPerson
    : (
        recipientType === "user" || recipientType === "driver"
          ? recipient
          : null
      );

  const recipientRole = !isTenantRole()
    ? "tenant_admin"
    : (recipientType === "tenant" ? "tenant_admin" : null);

  const { data: thread, error: threadError } = await client
    .from("message_threads")
    .insert({
      company_id: profile.company_id,
      customer_id: customerId || null,
      subject,
      thread_type: "direct",
      status: "open",
      created_by: profile.id
    })
    .select("*")
    .single();

  if (threadError) throw threadError;

  const { error: msgError } = await client
    .from("messages")
    .insert({
      thread_id: thread.id,
      company_id: profile.company_id,
      customer_id: customerId || null,
      sender_profile_id: profile.id,
      recipient_profile_id: recipientProfileId,
      recipient_role: recipientRole,
      message_type: "manual",
      title: subject,
      body,
      is_system: false
    });

  if (msgError) throw msgError;

  byId("newMessageSubject").value = "";
  byId("newMessageBody").value = "";
  byId("newMessagePanel").style.display = "none";

  await refreshAll();
  await openThread(thread.id);

  showToast("Message sent.", "ok");
}

  async function sendNewMessage() {
  const client = ensureClient();

  const subject = clean(byId("newMessageSubject")?.value);
  const body = clean(byId("newMessageBody")?.value);
  const recipientType = byId("newMessageRecipientType")?.value || "tenant";
  const contactPerson = byId("newMessageContact")?.value || null;

  if (!subject || !body) {
    showToast("Please enter a subject and message.", "err");
    return;
  }

  const selectedUser = contactPerson
    ? state.users.find(u => String(u.id) === String(contactPerson))
    : null;

  const customerId = selectedUser?.customer_id || (!isTenantRole() ? currentCustomerId() : null);

  const recipientRole = !isTenantRole()
    ? "tenant_admin"
    : (
        recipientType === "tenant"
          ? "tenant_admin"
          : recipientType === "product_owner"
            ? "product_owner_admin"
            : recipientType === "retailer"
              ? "retailer_user"
              : recipientType === "driver"
                ? "driver"
                : null
      );

  const { data: thread, error: threadError } = await client
    .from("message_threads")
    .insert({
      company_id: profile.company_id,
      customer_id: customerId || null,
      subject,
      thread_type: "direct",
      status: "open",
      created_by: profile.id
    })
    .select("*")
    .single();

  if (threadError) throw threadError;

  const { error: msgError } = await client
    .from("messages")
    .insert({
      thread_id: thread.id,
      company_id: profile.company_id,
      customer_id: customerId || null,
      sender_profile_id: profile.id,
      recipient_profile_id: contactPerson || null,
      recipient_role: contactPerson ? null : recipientRole,
      message_type: "manual",
      title: subject,
      body,
      is_system: false
    });

  if (msgError) throw msgError;

  byId("newMessageSubject").value = "";
  byId("newMessageBody").value = "";
  byId("newMessagePanel").style.display = "none";

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

    const client = ensureClient();
    const thread = state.threads.find(t => t.id === activeThreadId);

    const { error } = await client
      .from("messages")
      .insert({
        thread_id: activeThreadId,
        company_id: profile.company_id,
        customer_id: thread?.customer_id || currentCustomerId() || null,
        sender_profile_id: profile.id,
        message_type: "manual",
        title: thread?.subject || "Reply",
        body,
        is_system: false
      });

    if (error) throw error;

    await client
      .from("message_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", activeThreadId);

    byId("messageReplyBody").value = "";

    await loadThreads();
    await openThread(activeThreadId);

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
    const client = ensureClient();
    const ids = state.notifications.filter(n => !n.is_read).map(n => n.id);

    if (!ids.length) return;

    const { error } = await client
      .from("system_notifications")
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .in("id", ids);

    if (error) throw error;

    await loadNotifications();
    renderNotifications();
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
    if (!client.channel) return;

    const channel = client.channel("message-center-live");

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "system_notifications" },
      payload => {
        const n = payload.new;

        if (profile.company_id && n.company_id && String(n.company_id) !== String(profile.company_id)) return;
        if (!isTenantRole() && n.customer_id && String(n.customer_id) !== String(currentCustomerId())) return;
        if (n.recipient_profile_id && String(n.recipient_profile_id) !== String(profile.id)) return;
        if (n.recipient_role && n.recipient_role !== profile.role) return;

        state.notifications.unshift(n);
        renderNotifications();
        renderLiveFeed();
        pushLivePopup(n);
      }
    );

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      payload => {
        const m = payload.new;

        if (profile.company_id && m.company_id && String(m.company_id) !== String(profile.company_id)) return;
        if (!isTenantRole() && m.customer_id && String(m.customer_id) !== String(currentCustomerId())) return;

        if (String(m.sender_profile_id) !== String(profile.id)) {
          pushLivePopup({
            title: "New Message",
            message: m.title || "A new message has been received.",
            action_url: "./message-center.html",
            notification_type: "message",
            severity: "info"
          });
        }

        refreshAll();
      }
    );

    channel.subscribe();
  }

  async function refreshAll() {
    await Promise.all([
      loadNotifications(),
      loadThreads(),
      loadMessages(activeThreadId),
      loadAnnouncements()
    ]);

    await renderSinceLastVisit();
    renderNotifications();
    renderThreads();
    renderChat();
    renderMessagesKpi();
    renderAnnouncements();
    renderLiveFeed();
    await renderTasks();

updateTabBadges();
  }

async function init() {
  injectPopupStyle();
  bindTabs();
  bindEvents();
  setReplyEnabled(false);

  try {
      await loadProfile();
      await loadNotificationState();
await loadUsersAndCustomers();

populateRecipients();
populateContactPersons();

await refreshAll();

      bindRealtime();

      setTimeout(updateLastSeen, 2500);

      showToast("Message Center loaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Message Center could not load.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();