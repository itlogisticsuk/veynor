(function () {
  "use strict";

  let currentOrder = null;
  let currentEvents = [];
let userProfileMap = new Map();

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function getClient() {
    if (window.sb) return window.sb();
    if (window.supabaseClient) return window.supabaseClient;
    if (window.supabase) return window.supabase;
    throw new Error("Supabase client not available.");
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function nice(value) {
    return String(value || "—")
      .replaceAll("_", " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function eventMeta(type) {
    const key = String(type || "").toLowerCase();

    if (key.includes("download")) return { icon: "↓", title: "Download", group: "downloads", tone: "green" };
    if (key.includes("order_open")) return { icon: "👁", title: "Order Opened", group: "order", tone: "blue" };
    if (key.includes("page_view")) return { icon: "□", title: "Page View", group: "portal", tone: "purple" };
    if (key.includes("page_return")) return { icon: "↩", title: "Page Return", group: "portal", tone: "purple" };
    if (key.includes("invoice")) return { icon: "£", title: "Invoice Activity", group: "finance", tone: "orange" };
    if (key.includes("pod")) return { icon: "✓", title: "POD Activity", group: "documents", tone: "green" };
    if (key.includes("document") || key.includes("ack") || key.includes("delivery_note")) {
      return { icon: "📄", title: "Document Activity", group: "documents", tone: "blue" };
    }

    return { icon: "•", title: nice(type || "Portal Event"), group: "other", tone: "grey" };
  }

  function groupLabel(group) {
    const map = {
      all: "All",
      portal: "Portal",
      order: "Order",
      downloads: "Downloads",
      documents: "Documents",
      finance: "Finance",
      other: "Other"
    };

    return map[group] || nice(group);
  }

  async function open(orderId) {
    if (!window.getOrderById) {
      console.error("getOrderById not available");
      return;
    }

    const order = window.getOrderById(orderId);
    if (!order) return;

    currentOrder = order;
    renderLoading(order);

    try {
      currentEvents = await loadPortalEvents(order);
      renderPortalTimeline("all");
    } catch (error) {
      console.error(error);
      renderError(error);
    }
  }

  function renderLoading(order) {
    const modal = byId("occGenericActionModal");
    const body = byId("genericActionBody");
    const saveBtn = byId("genericActionSaveBtn");

    if (!modal || !body || !saveBtn) return;

    byId("genericActionOrderId").value = order.id;
    byId("genericActionType").value = "portal_events";

    byId("genericActionTitle").textContent = "Portal Events";
    byId("genericActionSub").textContent =
      `${order.order_number || "Order"} · ${order.retailer_name || ""} · ${order.delivery_postcode || ""}`;

    saveBtn.style.display = "none";

    body.innerHTML = `
      <section class="occ-modal-section">
        <h3>Portal Events</h3>
        <p style="color:#667085;margin:0;">Loading customer portal activity...</p>
      </section>
    `;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  async function loadPortalEvents(order) {
    const client = getClient();

    const orderId = String(order.id || "");
    const orderNumber = String(order.order_number || "");

    let query = client
      .from("portal_events")
      .select(`
        id,
        company_id,
        user_profile_id,
        customer_id,
        session_id,
        event_type,
        page_name,
        entity_type,
        entity_id,
        description,
        metadata,
        ip_address,
        user_agent,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(250);

if (orderId || orderNumber) {
  const filters = [];

  if (orderId) {
    filters.push(`entity_id.eq.${orderId}`);
    filters.push(`metadata->>order_id.eq.${orderId}`);
    filters.push(`metadata->>url.ilike.*${orderId}*`);
  }

  if (orderNumber) {
    filters.push(`entity_id.ilike.*${orderNumber}*`);
    filters.push(`description.ilike.*${orderNumber}*`);
    filters.push(`metadata->>order_number.eq.${orderNumber}`);
    filters.push(`metadata->>url.ilike.*${orderNumber}*`);
  }

  query = query.or(filters.join(","));
}

    const { data, error } = await query;

    if (error) throw error;

const events = data || [];
await loadUserProfiles(events);
return events;
  }
async function loadUserProfiles(events) {
  const client = getClient();

  const ids = [...new Set(
    (events || [])
      .map(event => event.user_profile_id)
      .filter(Boolean)
  )];

  userProfileMap = new Map();

  if (!ids.length) return;

  const { data, error } = await client
    .from("user_profiles")
    .select("id, full_name, email, role")
    .in("id", ids);

  if (error) {
    console.warn("Could not load user profiles:", error.message);
    return;
  }

  (data || []).forEach(profile => {
    userProfileMap.set(String(profile.id), profile);
  });
}

  function getAvailableGroups(events) {
    const groups = new Set(["all"]);

    events.forEach(event => {
      groups.add(eventMeta(event.event_type).group);
    });

    return Array.from(groups);
  }

  function countByGroup(events, group) {
    if (group === "all") return events.length;
    return events.filter(event => eventMeta(event.event_type).group === group).length;
  }

  function renderPortalTimeline(activeGroup = "all") {
    const body = byId("genericActionBody");
    if (!body) return;

    const events = currentEvents || [];
    const groups = getAvailableGroups(events);

    const filtered = activeGroup === "all"
      ? events
      : events.filter(event => eventMeta(event.event_type).group === activeGroup);

    const lastEvent = events[0] || null;

    body.innerHTML = `
      <section class="occ-modal-section">
        <div class="portal-events-head">
          <div>
            <h3 style="margin-bottom:4px;">Portal Events</h3>
            <p style="margin:0;color:#667085;">
              ${events.length} portal event${events.length === 1 ? "" : "s"} found for this order.
            </p>
          </div>

          <div class="portal-last-card">
            <span>Last portal activity</span>
            <strong>${escapeHtml(lastEvent ? formatDateTime(lastEvent.created_at) : "—")}</strong>
            <em>${escapeHtml(lastEvent ? eventMeta(lastEvent.event_type).title : "No activity")}</em>
          </div>
        </div>

        <div class="portal-filter-row">
          ${groups.map(group => `
            <button
              type="button"
              class="portal-filter-btn ${group === activeGroup ? "is-active" : ""}"
              data-portal-filter="${escapeHtml(group)}"
            >
              ${escapeHtml(groupLabel(group))} (${countByGroup(events, group)})
            </button>
          `).join("")}
        </div>

        <div class="portal-timeline">
          ${
            filtered.length
              ? filtered.map(renderPortalEvent).join("")
              : `<div class="portal-empty">No portal activity found for this filter.</div>`
          }
        </div>
      </section>

      <style>
        .portal-events-head {
          display:flex;
          justify-content:space-between;
          gap:16px;
          align-items:flex-start;
        }

        .portal-last-card {
          min-width:210px;
          border:1px solid #dbe7f6;
          border-radius:14px;
          padding:10px 12px;
          background:#f8fbff;
          text-align:right;
        }

        .portal-last-card span {
          display:block;
          color:#667085;
          font-size:11px;
          font-weight:900;
          text-transform:uppercase;
          letter-spacing:.05em;
        }

        .portal-last-card strong {
          display:block;
          margin-top:4px;
          color:#10213f;
          font-size:13px;
        }

        .portal-last-card em {
          display:block;
          margin-top:3px;
          color:#667085;
          font-size:12px;
          font-style:normal;
        }

        .portal-filter-row {
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          margin:16px 0 18px;
        }

        .portal-filter-btn {
          border:1px solid #d6e2f2;
          background:#fff;
          color:#10213f;
          border-radius:999px;
          padding:8px 12px;
          font-weight:800;
          cursor:pointer;
          font-size:12px;
        }

        .portal-filter-btn.is-active {
          background:#1667ff;
          border-color:#1667ff;
          color:#fff;
        }

        .portal-timeline {
          display:grid;
          gap:12px;
        }

        .portal-card {
          display:grid;
          grid-template-columns:42px 1fr;
          gap:12px;
          border:1px solid #dbe7f6;
          background:#fff;
          border-radius:16px;
          padding:14px;
        }

        .portal-icon {
          width:34px;
          height:34px;
          border-radius:999px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:900;
          font-size:14px;
        }

        .portal-icon.green {
          background:#e8f8ef;
          color:#14804a;
        }

        .portal-icon.blue {
          background:#eaf2ff;
          color:#1667ff;
        }

        .portal-icon.orange {
          background:#fff3e7;
          color:#c75a00;
        }

        .portal-icon.purple {
          background:#f1eaff;
          color:#7047d9;
        }

        .portal-icon.grey {
          background:#f2f4f7;
          color:#667085;
        }

        .portal-card-head {
          display:flex;
          justify-content:space-between;
          gap:12px;
          align-items:flex-start;
        }

        .portal-title {
          font-weight:900;
          color:#10213f;
          font-size:14px;
        }

        .portal-date {
          color:#667085;
          font-size:12px;
          white-space:nowrap;
        }

        .portal-desc {
          margin-top:6px;
          color:#344054;
          line-height:1.45;
          white-space:pre-wrap;
        }

        .portal-meta-grid {
          margin-top:10px;
          display:grid;
          grid-template-columns:repeat(3, minmax(0, 1fr));
          gap:8px;
        }

        .portal-meta {
          border:1px solid #edf2f7;
          border-radius:10px;
          padding:8px;
          background:#fbfdff;
        }

        .portal-meta span {
          display:block;
          color:#667085;
          font-size:10px;
          font-weight:900;
          text-transform:uppercase;
          letter-spacing:.05em;
        }

        .portal-meta strong {
          display:block;
          margin-top:3px;
          color:#10213f;
          font-size:12px;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }

        .portal-empty {
          border:1px dashed #d6e2f2;
          border-radius:16px;
          padding:24px;
          color:#667085;
          text-align:center;
          font-weight:700;
        }

        @media (max-width: 900px) {
          .portal-events-head {
            display:block;
          }

          .portal-last-card {
            margin-top:12px;
            text-align:left;
          }

          .portal-meta-grid {
            grid-template-columns:1fr;
          }

          .portal-card-head {
            display:block;
          }

          .portal-date {
            margin-top:4px;
          }
        }
      </style>
    `;

    body.querySelectorAll("[data-portal-filter]").forEach(button => {
      button.addEventListener("click", () => {
        renderPortalTimeline(button.dataset.portalFilter || "all");
      });
    });
  }

 function renderPortalEvent(event) {
  const meta = eventMeta(event.event_type);
  const description = clean(event.description) || buildDescription(event);
  const browser = getBrowserLabel(event.user_agent);

  return `
    <article class="portal-card">
      <div class="portal-icon ${escapeHtml(meta.tone)}">
        ${escapeHtml(meta.icon)}
      </div>

      <div>
        <div class="portal-card-head">
          <div class="portal-title">${escapeHtml(meta.title)}</div>
          <div class="portal-date">${escapeHtml(formatDateTime(event.created_at))}</div>
        </div>

        <div class="portal-desc">${escapeHtml(description)}</div>

        <div class="portal-meta-grid">
          <div class="portal-meta">
            <span>User</span>
            <strong>${escapeHtml(getUserLabel(event.user_profile_id))}</strong>
          </div>

          <div class="portal-meta">
            <span>Page</span>
            <strong>${escapeHtml(event.page_name || "—")}</strong>
          </div>

          <div class="portal-meta">
            <span>Event</span>
            <strong>${escapeHtml(event.event_type || "—")}</strong>
          </div>

          <div class="portal-meta">
            <span>Session</span>
            <strong>${escapeHtml(shortId(event.session_id))}</strong>
          </div>

          <div class="portal-meta">
            <span>Browser</span>
            <strong>${escapeHtml(browser)}</strong>
          </div>

          <div class="portal-meta">
            <span>Entity</span>
            <strong>${escapeHtml(shortId(event.entity_id))}</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

  function buildDescription(event) {
    const type = String(event.event_type || "");
    const entity = event.entity_type ? ` ${event.entity_type}` : "";
    const page = event.page_name ? ` on ${event.page_name}` : "";

    return `${nice(type)}${entity}${page}.`;
  }

  function shortId(value) {
    const text = String(value || "");
    if (!text) return "—";
    if (text.length <= 12) return text;
    return `${text.slice(0, 8)}…${text.slice(-4)}`;
  }

function getUserLabel(userProfileId) {
  if (!userProfileId) return "Unknown";

  const profile = userProfileMap.get(String(userProfileId));

  if (!profile) return shortId(userProfileId);

  return (
    profile.full_name ||
    profile.email ||
    profile.role ||
    shortId(userProfileId)
  );
}

  function getBrowserLabel(userAgent) {
    const ua = String(userAgent || "");

    if (!ua) return "—";
    if (/Edg\//i.test(ua)) return "Microsoft Edge";
    if (/Chrome\//i.test(ua)) return "Chrome";
    if (/Firefox\//i.test(ua)) return "Firefox";
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";

    return "Browser";
  }

  function renderError(error) {
    const body = byId("genericActionBody");
    if (!body) return;

    body.innerHTML = `
      <section class="occ-modal-section">
        <h3>Portal Events</h3>
        <p style="color:#b42318;margin:0;">
          ${escapeHtml(error.message || "Could not load portal events.")}
        </p>
      </section>
    `;
  }

  window.PortalEventsTool = {
    open
  };
})();