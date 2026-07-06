(function () {
  "use strict";

  let currentOrder = null;

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

  function itemLabel(item) {
    if (!item) return "Unknown item";

    const sku = item.sku_unique || item.products?.sku_base || "SKU";
    const packageText =
      item.package_no && item.package_total
        ? `Package ${item.package_no}/${item.package_total}`
        : "Package";

    return `${sku} · ${packageText}`;
  }

  function eventMeta(type) {
    const key = String(type || "").toLowerCase();

    if (key.includes("scan")) return { icon: "▣", tone: "blue", title: "Scan Event" };
    if (key.includes("receive")) return { icon: "↓", tone: "green", title: "Received" };
    if (key.includes("reserve")) return { icon: "●", tone: "purple", title: "Reserved" };
    if (key.includes("pick")) return { icon: "✓", tone: "green", title: "Picked" };
    if (key.includes("load")) return { icon: "↗", tone: "orange", title: "Loaded" };
    if (key.includes("ship")) return { icon: "→", tone: "orange", title: "Shipped" };
    if (key.includes("release")) return { icon: "↺", tone: "purple", title: "Released" };
    if (key.includes("damage")) return { icon: "!", tone: "red", title: "Damage" };

    return { icon: "•", tone: "grey", title: nice(type || "Warehouse Event") };
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
      const data = await loadWarehouseData(order);
      renderWarehouseEvents(data);
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
    byId("genericActionType").value = "warehouse_events";

    byId("genericActionTitle").textContent = "Warehouse Events";
    byId("genericActionSub").textContent =
      `${order.order_number || "Order"} · ${order.retailer_name || ""} · ${order.delivery_postcode || ""}`;

    saveBtn.style.display = "none";

    body.innerHTML = `
      <section class="occ-modal-section">
        <h3>Warehouse Events</h3>
        <p style="color:#667085;margin:0;">Loading warehouse history...</p>
      </section>
    `;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  async function loadWarehouseData(order) {
    const client = getClient();

    const lineIds = (order.order_lines || []).map(line => line.id).filter(Boolean);

    let allocations = [];

    if (lineIds.length) {
      const { data, error } = await client
        .from("order_allocations")
        .select(`
          id,
          order_line_id,
          item_id,
          allocation_status,
          allocated_at,
          stock_set_id,
          items (
            id,
            sku_unique,
            status,
            volume_m3,
            weight_kg,
            received_at,
            reserved_at,
            picked_at,
            loaded_at,
            shipped_at,
            warehouse_id,
            location_id,
            physical_product_id,
            package_no,
            package_total,
            package_label,
            stock_set_status,
            stock_set_key,
            products (
              id,
              sku_base,
              name,
              description
            )
          )
        `)
        .in("order_line_id", lineIds)
        .order("allocated_at", { ascending: false });

      if (error) throw error;
      allocations = data || [];
    }

    const itemIds = allocations
      .map(a => a.item_id || a.items?.id)
      .filter(Boolean);

    let movements = [];
    let warehouseEvents = [];

    if (itemIds.length) {
      const { data: movementData, error: movementError } = await client
        .from("movements")
        .select(`
          id,
          item_id,
          product_id,
          warehouse_id,
          location_id,
          order_id,
          shipment_id,
          movement_type,
          scan_method,
          scan_device,
          scan_value,
          notes,
          created_at
        `)
        .in("item_id", itemIds)
        .order("created_at", { ascending: false });

      if (movementError) throw movementError;
      movements = movementData || [];

      const { data: eventData, error: eventError } = await client
        .from("warehouse_events")
        .select(`
          id,
          event_type,
          entity_type,
          entity_id,
          reference_no,
          source_module,
          old_status,
          new_status,
          payload,
          created_at
        `)
        .in("entity_id", itemIds)
        .order("created_at", { ascending: false });

      if (eventError) throw eventError;
      warehouseEvents = eventData || [];
    }

    return {
      allocations,
      itemIds,
      movements,
      warehouseEvents
    };
  }

  function renderWarehouseEvents(data) {
    const body = byId("genericActionBody");
    if (!body) return;

    const allocations = data.allocations || [];
    const movements = data.movements || [];
    const warehouseEvents = data.warehouseEvents || [];

    const itemCards = allocations.map(allocation => {
      const item = allocation.items || null;
      const itemId = allocation.item_id || item?.id;

      const itemMovements = movements.filter(m => m.item_id === itemId);
      const itemEvents = warehouseEvents.filter(e => e.entity_id === itemId);

      const timeline = [
        ...buildItemStatusEvents(item, allocation),
        ...itemMovements.map(m => ({
          type: m.movement_type,
          title: nice(m.movement_type),
          description: [
            m.notes,
            m.scan_value ? `Scan: ${m.scan_value}` : "",
            m.scan_method ? `Method: ${m.scan_method}` : "",
            m.scan_device ? `Device: ${m.scan_device}` : ""
          ].filter(Boolean).join(" · "),
          created_at: m.created_at,
          source: "Movement"
        })),
        ...itemEvents.map(e => ({
          type: e.event_type,
          title: nice(e.event_type),
          description: [
            e.old_status || e.new_status
              ? `${nice(e.old_status)} → ${nice(e.new_status)}`
              : "",
            e.reference_no ? `Reference: ${e.reference_no}` : "",
            e.source_module ? `Source: ${e.source_module}` : ""
          ].filter(Boolean).join(" · "),
          created_at: e.created_at,
          source: "Warehouse Event"
        }))
      ]
        .filter(e => e.created_at)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return renderItemCard(allocation, item, timeline);
    }).join("");

    body.innerHTML = `
      <section class="occ-modal-section">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
          <div>
            <h3 style="margin-bottom:4px;">Warehouse Events</h3>
            <p style="margin:0;color:#667085;">
              ${allocations.length} allocated package${allocations.length === 1 ? "" : "s"} found.
              ${movements.length} movement${movements.length === 1 ? "" : "s"}.
              ${warehouseEvents.length} warehouse event${warehouseEvents.length === 1 ? "" : "s"}.
            </p>
          </div>

          <div style="text-align:right;color:#667085;font-size:12px;">
            ${escapeHtml(currentOrder?.order_number || "")}
          </div>
        </div>

        <div class="warehouse-event-list">
          ${
            allocations.length
              ? itemCards
              : `<div class="warehouse-empty">No allocated warehouse items found for this order.</div>`
          }
        </div>
      </section>

      <style>
        .warehouse-event-list {
          display:grid;
          gap:14px;
          margin-top:18px;
        }

        .warehouse-item-card {
          border:1px solid #dbe7f6;
          border-radius:18px;
          background:#fff;
          overflow:hidden;
        }

        .warehouse-item-head {
          display:grid;
          grid-template-columns:1fr auto;
          gap:16px;
          padding:14px 16px;
          background:#f8fbff;
          border-bottom:1px solid #dbe7f6;
        }

        .warehouse-item-title {
          font-weight:900;
          color:#10213f;
          font-size:15px;
        }

        .warehouse-item-sub {
          margin-top:4px;
          color:#667085;
          font-size:12px;
        }

        .warehouse-status-pill {
          border-radius:999px;
          padding:6px 10px;
          background:#eaf2ff;
          color:#1667ff;
          font-weight:900;
          font-size:12px;
          height:max-content;
          white-space:nowrap;
        }

        .warehouse-item-meta {
          display:grid;
          grid-template-columns:repeat(4, minmax(0, 1fr));
          gap:10px;
          padding:12px 16px;
          border-bottom:1px solid #eef3fb;
        }

        .warehouse-meta-box {
          border:1px solid #e1eaf6;
          border-radius:12px;
          padding:10px;
        }

        .warehouse-meta-label {
          font-size:10px;
          text-transform:uppercase;
          letter-spacing:.06em;
          color:#667085;
          font-weight:900;
        }

        .warehouse-meta-value {
          margin-top:4px;
          color:#10213f;
          font-weight:900;
          font-size:13px;
        }

        .warehouse-timeline {
          display:grid;
          gap:10px;
          padding:14px 16px 16px;
        }

        .warehouse-event-row {
          display:grid;
          grid-template-columns:34px 1fr auto;
          gap:10px;
          align-items:flex-start;
        }

        .warehouse-event-icon {
          width:28px;
          height:28px;
          border-radius:999px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:900;
          font-size:13px;
        }

        .warehouse-event-icon.green {
          background:#e8f8ef;
          color:#14804a;
        }

        .warehouse-event-icon.blue {
          background:#eaf2ff;
          color:#1667ff;
        }

        .warehouse-event-icon.orange {
          background:#fff3e7;
          color:#c75a00;
        }

        .warehouse-event-icon.purple {
          background:#f1eaff;
          color:#7047d9;
        }

        .warehouse-event-icon.red {
          background:#ffe7e7;
          color:#b42318;
        }

        .warehouse-event-icon.grey {
          background:#f2f4f7;
          color:#667085;
        }

        .warehouse-event-title {
          font-weight:900;
          color:#10213f;
          font-size:13px;
        }

        .warehouse-event-desc {
          margin-top:3px;
          color:#667085;
          font-size:12px;
          line-height:1.35;
        }

        .warehouse-event-date {
          color:#667085;
          font-size:12px;
          white-space:nowrap;
        }

        .warehouse-empty {
          border:1px dashed #d6e2f2;
          border-radius:16px;
          padding:24px;
          color:#667085;
          text-align:center;
          font-weight:700;
        }

        @media (max-width: 900px) {
          .warehouse-item-meta {
            grid-template-columns:repeat(2, minmax(0, 1fr));
          }

          .warehouse-event-row {
            grid-template-columns:34px 1fr;
          }

          .warehouse-event-date {
            grid-column:2;
          }
        }
      </style>
    `;
  }

  function buildItemStatusEvents(item, allocation) {
    const events = [];

    if (item?.received_at) {
      events.push({
        type: "received",
        title: "Received",
        description: "Item received into warehouse.",
        created_at: item.received_at,
        source: "Item"
      });
    }

    if (item?.reserved_at || allocation?.allocated_at) {
      events.push({
        type: "reserved",
        title: "Reserved",
        description: `Reserved for ${currentOrder?.order_number || "order"}.`,
        created_at: item?.reserved_at || allocation?.allocated_at,
        source: "Allocation"
      });
    }

    if (item?.picked_at) {
      events.push({
        type: "picked",
        title: "Picked",
        description: "Item picked for dispatch.",
        created_at: item.picked_at,
        source: "Item"
      });
    }

    if (item?.loaded_at) {
      events.push({
        type: "loaded",
        title: "Loaded",
        description: "Item loaded for transport.",
        created_at: item.loaded_at,
        source: "Item"
      });
    }

    if (item?.shipped_at) {
      events.push({
        type: "shipped",
        title: "Shipped",
        description: "Item shipped from warehouse.",
        created_at: item.shipped_at,
        source: "Item"
      });
    }

    return events;
  }

  function renderItemCard(allocation, item, timeline) {
    const title = itemLabel(item);

    const status = item?.status || allocation?.allocation_status || "unknown";

    const meta = [
      {
        label: "Allocation",
        value: allocation?.allocation_status || "—"
      },
      {
        label: "Warehouse",
        value: item?.warehouse_id ? "Assigned" : "—"
      },
      {
        label: "Location",
        value: item?.location_id ? "Assigned" : "—"
      },
      {
        label: "Stock set",
        value: item?.stock_set_status || item?.stock_set_key || "—"
      }
    ];

    return `
      <article class="warehouse-item-card">
        <div class="warehouse-item-head">
          <div>
            <div class="warehouse-item-title">${escapeHtml(title)}</div>
            <div class="warehouse-item-sub">
              ${escapeHtml(item?.products?.name || item?.products?.description || item?.package_label || "")}
            </div>
          </div>

          <div class="warehouse-status-pill">${escapeHtml(nice(status))}</div>
        </div>

        <div class="warehouse-item-meta">
          ${meta.map(m => `
            <div class="warehouse-meta-box">
              <div class="warehouse-meta-label">${escapeHtml(m.label)}</div>
              <div class="warehouse-meta-value">${escapeHtml(m.value)}</div>
            </div>
          `).join("")}
        </div>

        <div class="warehouse-timeline">
          ${
            timeline.length
              ? timeline.map(renderWarehouseEvent).join("")
              : `<div class="warehouse-empty">No item events found for this package.</div>`
          }
        </div>
      </article>
    `;
  }

  function renderWarehouseEvent(event) {
    const meta = eventMeta(event.type);

    return `
      <div class="warehouse-event-row">
        <div class="warehouse-event-icon ${escapeHtml(meta.tone)}">
          ${escapeHtml(meta.icon)}
        </div>

        <div>
          <div class="warehouse-event-title">${escapeHtml(event.title || meta.title)}</div>
          <div class="warehouse-event-desc">
            ${escapeHtml(event.description || event.source || "")}
          </div>
        </div>

        <div class="warehouse-event-date">
          ${escapeHtml(formatDateTime(event.created_at))}
        </div>
      </div>
    `;
  }

  function renderError(error) {
    const body = byId("genericActionBody");
    if (!body) return;

    body.innerHTML = `
      <section class="occ-modal-section">
        <h3>Warehouse Events</h3>
        <p style="color:#b42318;margin:0;">
          ${escapeHtml(error.message || "Could not load warehouse events.")}
        </p>
      </section>
    `;
  }

  window.WarehouseEventsTool = {
    open
  };
})();