(function () {
  "use strict";

  let currentOrder = null;
  let currentEvents = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function niceStatus(value) {
    const map = {
      imported: "Imported",
      matching_review: "Matching Review",
      ready_for_picking: "Ready For Picking",
      ready_for_planning: "Ready For Planning",
      planned: "Planned",
      sent_to_driver: "Sent To Driver",
      out_for_delivery: "Out For Delivery",
      loaded: "Loaded",
      delivered: "Delivered",
      pod_completed: "POD Completed",
      closed: "Closed",
      cancelled: "Cancelled",
      export_for_charter: "Export For Charter",
      invoice_generated: "Invoice Generated",
      not_invoiced: "Not Invoiced",
      generated: "Generated",
      not_generated: "Not Generated"
    };

    return map[String(value || "").toLowerCase()] || String(value || "—").replaceAll("_", " ");
  }

  function activityMeta(type) {
    const key = String(type || "").toLowerCase();

    const map = {
      change_status: {
        icon: "●",
        title: "Status Changed",
        group: "status",
        tone: "green"
      },
      edit_order: {
        icon: "✎",
        title: "Order Edited",
        group: "order",
        tone: "blue"
      },
      edit_order_matching: {
        icon: "▣",
        title: "Matching Updated",
        group: "warehouse",
        tone: "purple"
      },
      order_edit_stock_released: {
        icon: "↺",
        title: "Stock Released",
        group: "warehouse",
        tone: "purple"
      },
      copy_order_created: {
        icon: "⧉",
        title: "Copy Order Created",
        group: "order",
        tone: "blue"
      },
      credit_order_created: {
        icon: "−",
        title: "Credit Order Created",
        group: "finance",
        tone: "orange"
      },
      credit_note_generated: {
        icon: "£",
        title: "Credit Note Generated",
        group: "finance",
        tone: "orange"
      },
      invoice_generated: {
        icon: "£",
        title: "Invoice Generated",
        group: "finance",
        tone: "orange"
      },
      document_generated: {
        icon: "□",
        title: "Document Generated",
        group: "documents",
        tone: "blue"
      },
      manual_delivery_date: {
        icon: "◇",
        title: "Manual Delivery Date",
        group: "delivery",
        tone: "green"
      },
      manual_signed_pod: {
        icon: "✍",
        title: "Manual Signed POD",
        group: "delivery",
        tone: "green"
      },
      manual_pod_photos: {
        icon: "▧",
        title: "POD Photos",
        group: "delivery",
        tone: "green"
      },
      manual_tariff_update: {
        icon: "£",
        title: "Manual Tariff Update",
        group: "finance",
        tone: "orange"
      }
    };

    return map[key] || {
      icon: "•",
      title: niceStatus(key || "Activity"),
      group: "other",
      tone: "grey"
    };
  }

  function groupLabel(group) {
    const map = {
      all: "All",
      status: "Status",
      order: "Order",
      documents: "Documents",
      finance: "Finance",
      warehouse: "Warehouse",
      delivery: "Delivery",
      other: "Other"
    };

    return map[group] || group;
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
      currentEvents = await loadActivity(order.id);
      renderTimeline("all");
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
    byId("genericActionType").value = "view_activity";

    byId("genericActionTitle").textContent = "View Activity";
    byId("genericActionSub").textContent =
      `${order.order_number || "Order"} · ${order.retailer_name || ""} · ${order.delivery_postcode || ""}`;

    saveBtn.style.display = "none";

    body.innerHTML = `
      <section class="occ-modal-section">
        <h3>Activity Timeline</h3>
        <p style="color:#667085;margin:0;">Loading activity...</p>
      </section>
    `;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  async function loadActivity(orderId) {
    const client = getClient();

    const { data, error } = await client
      .from("order_activity_log")
      .select(`
        id,
        activity_type,
        description,
        old_status,
        new_status,
        created_by,
        created_at
      `)
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    return data || [];
  }

  function getAvailableGroups(events) {
    const groups = new Set(["all"]);

    events.forEach(event => {
      groups.add(activityMeta(event.activity_type).group);
    });

    return Array.from(groups);
  }

  function renderTimeline(activeGroup = "all") {
    const body = byId("genericActionBody");
    if (!body) return;

    const events = currentEvents || [];
    const groups = getAvailableGroups(events);

    const filtered =
      activeGroup === "all"
        ? events
        : events.filter(event => activityMeta(event.activity_type).group === activeGroup);

    body.innerHTML = `
      <section class="occ-modal-section">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
          <div>
            <h3 style="margin-bottom:4px;">Activity Timeline</h3>
            <p style="margin:0;color:#667085;">
              ${escapeHtml(events.length)} event${events.length === 1 ? "" : "s"} found for this order.
            </p>
          </div>

          <div style="text-align:right;color:#667085;font-size:12px;">
            ${escapeHtml(currentOrder?.order_number || "")}
          </div>
        </div>

        <div class="activity-filter-row">
          ${groups.map(group => `
            <button
              type="button"
              class="activity-filter-btn ${group === activeGroup ? "is-active" : ""}"
              data-activity-filter="${escapeHtml(group)}"
            >
              ${escapeHtml(groupLabel(group))}
            </button>
          `).join("")}
        </div>

        <div class="activity-timeline">
          ${
            filtered.length
              ? filtered.map(renderEvent).join("")
              : `<div class="activity-empty">No activity found for this filter.</div>`
          }
        </div>
      </section>

      <style>
        .activity-filter-row {
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          margin:16px 0 18px;
        }

        .activity-filter-btn {
          border:1px solid #d6e2f2;
          background:#fff;
          color:#10213f;
          border-radius:999px;
          padding:8px 12px;
          font-weight:700;
          cursor:pointer;
          font-size:12px;
        }

        .activity-filter-btn.is-active {
          background:#1667ff;
          border-color:#1667ff;
          color:#fff;
        }

        .activity-timeline {
          position:relative;
          display:grid;
          gap:12px;
        }

        .activity-card {
          display:grid;
          grid-template-columns:42px 1fr;
          gap:12px;
          border:1px solid #dbe7f6;
          background:#fff;
          border-radius:16px;
          padding:14px;
        }

        .activity-icon {
          width:34px;
          height:34px;
          border-radius:999px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:900;
          font-size:15px;
        }

        .activity-icon.green {
          background:#e8f8ef;
          color:#14804a;
        }

        .activity-icon.blue {
          background:#eaf2ff;
          color:#1667ff;
        }

        .activity-icon.orange {
          background:#fff3e7;
          color:#c75a00;
        }

        .activity-icon.purple {
          background:#f1eaff;
          color:#7047d9;
        }

        .activity-icon.grey {
          background:#f2f4f7;
          color:#667085;
        }

        .activity-card-head {
          display:flex;
          justify-content:space-between;
          gap:12px;
          align-items:flex-start;
        }

        .activity-title {
          font-weight:900;
          color:#10213f;
          font-size:14px;
        }

        .activity-date {
          color:#667085;
          font-size:12px;
          white-space:nowrap;
        }

        .activity-description {
          margin-top:6px;
          color:#344054;
          line-height:1.45;
          white-space:pre-wrap;
        }

        .activity-status-change {
          margin-top:10px;
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
          font-size:12px;
        }

        .activity-pill {
          border-radius:999px;
          background:#f2f4f7;
          color:#344054;
          padding:5px 9px;
          font-weight:800;
        }

        .activity-user {
          margin-top:8px;
          color:#667085;
          font-size:12px;
        }

        .activity-empty {
          border:1px dashed #d6e2f2;
          border-radius:16px;
          padding:24px;
          color:#667085;
          text-align:center;
          font-weight:700;
        }
      </style>
    `;

    body.querySelectorAll("[data-activity-filter]").forEach(button => {
      button.addEventListener("click", () => {
        renderTimeline(button.dataset.activityFilter || "all");
      });
    });
  }

  function renderEvent(event) {
    const meta = activityMeta(event.activity_type);
    const description = clean(event.description) || "No description available.";
    const hasStatus =
      clean(event.old_status) || clean(event.new_status);

    return `
      <article class="activity-card">
        <div class="activity-icon ${escapeHtml(meta.tone)}">
          ${escapeHtml(meta.icon)}
        </div>

        <div>
          <div class="activity-card-head">
            <div class="activity-title">${escapeHtml(meta.title)}</div>
            <div class="activity-date">${escapeHtml(formatDateTime(event.created_at))}</div>
          </div>

          <div class="activity-description">${escapeHtml(description)}</div>

          ${
            hasStatus
              ? `
                <div class="activity-status-change">
                  <span class="activity-pill">${escapeHtml(niceStatus(event.old_status))}</span>
                  <span>→</span>
                  <span class="activity-pill">${escapeHtml(niceStatus(event.new_status))}</span>
                </div>
              `
              : ""
          }

          ${
            event.created_by
              ? `<div class="activity-user">Created by: ${escapeHtml(event.created_by)}</div>`
              : ""
          }
        </div>
      </article>
    `;
  }

  function renderError(error) {
    const body = byId("genericActionBody");
    if (!body) return;

    body.innerHTML = `
      <section class="occ-modal-section">
        <h3>Activity Timeline</h3>
        <p style="color:#b42318;margin:0;">
          ${escapeHtml(error.message || "Could not load activity.")}
        </p>
      </section>
    `;
  }

  window.ActivityViewTool = {
    open
  };
})();