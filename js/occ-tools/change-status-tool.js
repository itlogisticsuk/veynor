(function () {
  "use strict";

  let currentOrder = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function label(value) {
    const map = {
      order_received: "Order Received",
      stock_complete: "Stock Complete",
      planned_transport: "Planned / Transport",
      delivered: "Delivered",
      cancelled: "Cancelled",
      imported: "Imported",
      ready_for_picking: "Ready For Picking",
      planned: "Planned",
      not_planned: "Not Planned"
    };

    return map[String(value || "").toLowerCase()] || String(value || "—").replaceAll("_", " ");
  }

  async function open(orderId) {
    if (!window.getOrderById) {
      console.error("getOrderById not available");
      return;
    }

    const order = window.getOrderById(orderId);
    if (!order) return;

    currentOrder = order;
    renderModal(order);
  }

  function getStatusPayload(status) {
if (status === "order_received") {
  return {
    status: "imported",
    warehouse_status: "order_received",
    transport_status: "not_planned",
    overall_status: "order_received",

    confirmed_delivery_date: null,
    expected_delivery_date: null,
    delivery_eta_from: null,
    delivery_eta_to: null,
    delivery_eta_status: null,

    pod_status: null,
    pod_signed_by: null,
    pod_signed_at: null,
    pod_completed_at: null
  };
}

if (status === "stock_complete") {
  return {
    status: "ready_for_picking",
    warehouse_status: "stock_complete",
    transport_status: "not_planned",
    overall_status: "stock_complete",

    confirmed_delivery_date: null,
    expected_delivery_date: null,
    delivery_eta_from: null,
    delivery_eta_to: null,
    delivery_eta_status: null,

    pod_status: null,
    pod_signed_by: null,
    pod_signed_at: null,
    pod_completed_at: null
  };
}

    if (status === "planned_transport") {
      return {
        status: "planned",
        warehouse_status: "stock_complete",
        transport_status: "planned",
        overall_status: "planned"
      };
    }

    if (status === "delivered") {
      return {
        status: "delivered",
        warehouse_status: "delivered",
        transport_status: "delivered",
        overall_status: "delivered",
        pod_status: "signed",
        pod_signed_at: new Date().toISOString()
      };
    }

    if (status === "cancelled") {
      return {
        status: "cancelled",
        warehouse_status: "cancelled",
        transport_status: "cancelled",
        overall_status: "cancelled"
      };
    }

    return null;
  }

  function renderDynamicFields(status) {
    const container = byId("changeStatusDynamicFields");
    if (!container) return;

    if (status === "planned_transport") {
      container.innerHTML = `
        <label>Confirmed delivery date</label>
        <input type="date" id="statusDeliveryDate" class="input">

        <label style="margin-top:10px;">ETA From</label>
        <input type="time" id="statusEtaFrom" class="input">

        <label style="margin-top:10px;">ETA To</label>
        <input type="time" id="statusEtaTo" class="input">
      `;
      return;
    }

    if (status === "delivered") {
      container.innerHTML = `
        <label>Received by</label>
        <input class="input" id="statusReceivedBy">

        <label style="margin-top:10px;">Delivery notes</label>
        <textarea class="input" id="statusDeliveryNotes"></textarea>
      `;
      return;
    }

    if (status === "cancelled") {
      container.innerHTML = `
        <label>Cancellation reason</label>
        <select class="input" id="statusCancelReason">
          <option value="">Select...</option>
          <option>Customer cancelled</option>
          <option>Duplicate order</option>
          <option>Stock unavailable</option>
          <option>Damaged</option>
          <option>Other</option>
        </select>

        <label style="margin-top:10px;">Notes</label>
        <textarea class="input" id="statusCancelNotes"></textarea>
      `;
      return;
    }

    container.innerHTML = "";
  }

  function renderModal(order) {
    const modal = byId("occGenericActionModal");
    const body = byId("genericActionBody");
    const saveBtn = byId("genericActionSaveBtn");

    if (!modal || !body || !saveBtn) return;

    byId("genericActionOrderId").value = order.id;
    byId("genericActionType").value = "change_status";

    byId("genericActionTitle").textContent = "Change Status";
    byId("genericActionSub").textContent =
      `${order.order_number || "Order"} · ${order.retailer_name || ""}`;

    saveBtn.style.display = "";
    saveBtn.textContent = "Update Status";

    body.innerHTML = `
      <div class="occ-modal-grid">
        <section class="occ-modal-section">
          <h3>Current Status</h3>

          <div class="detail-line">
            <span class="detail-label">Current lifecycle</span>
            <span class="detail-value">${label(order.derived_lifecycle_status)}</span>
          </div>

          <div class="detail-line">
            <span class="detail-label">Warehouse</span>
            <span class="detail-value">${label(order.warehouse_status)}</span>
          </div>

          <div class="detail-line">
            <span class="detail-label">Transport</span>
            <span class="detail-value">${label(order.transport_status)}</span>
          </div>
        </section>

        <section class="occ-modal-section">
          <h3>New Status</h3>

          <label>Status</label>
          <select id="changeStatusSelect" class="input">
            <option value="">Select...</option>
            <option value="order_received">Order Received</option>
            <option value="stock_complete">Stock Complete</option>
            <option value="planned_transport">Planned / Transport</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <label style="margin-top:15px;">Reason</label>
          <textarea id="changeStatusReason" class="input" rows="4" placeholder="Optional reason..."></textarea>

          <div id="changeStatusDynamicFields" style="margin-top:16px;"></div>
        </section>
      </div>
    `;

    const statusSelect = byId("changeStatusSelect");
    statusSelect?.addEventListener("change", () => {
      renderDynamicFields(statusSelect.value);
    });

    renderDynamicFields(statusSelect?.value || "");

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  async function releaseAllocationsForCancelledOrder(order) {
    const client = window.sb ? window.sb() : null;
    if (!client) return;

    const lineIds = (order.order_lines || []).map(line => line.id).filter(Boolean);
    if (!lineIds.length) return;

    const { data: allocations, error } = await client
      .from("order_allocations")
      .select(`
        id,
        item_id,
        order_line_id,
        items (
          id,
          physical_product_id,
          stock_set_id
        )
      `)
      .in("order_line_id", lineIds);

    if (error) throw error;

    for (const allocation of allocations || []) {
      const physicalProductId = allocation.items?.physical_product_id || null;
      const stockSetId = allocation.items?.stock_set_id || null;
      const itemId = allocation.item_id || allocation.items?.id || null;

      let query = client
        .from("items")
        .update({
          status: "in_stock",
          linked_order_id: null,
          reserved_at: null
        });

      if (physicalProductId) query = query.eq("physical_product_id", physicalProductId);
      else if (stockSetId) query = query.eq("stock_set_id", stockSetId);
      else if (itemId) query = query.eq("id", itemId);
      else continue;

      const { error: itemError } = await query;
      if (itemError) throw itemError;
    }

    const allocationIds = (allocations || []).map(a => a.id).filter(Boolean);

    if (allocationIds.length) {
      const { error: allocationError } = await client
        .from("order_allocations")
        .update({ allocation_status: "cancelled" })
        .in("id", allocationIds);

      if (allocationError) throw allocationError;
    }
  }

  async function save() {
    const client = window.sb ? window.sb() : null;
    if (!client) throw new Error("Supabase client not available.");

    const order = currentOrder;
    if (!order?.id) throw new Error("No order selected.");

    const selectedStatus = byId("changeStatusSelect")?.value || "";
    if (!selectedStatus) throw new Error("Select a new status first.");

    const payload = getStatusPayload(selectedStatus);
    if (!payload) throw new Error("Invalid status selected.");

    const reason = clean(byId("changeStatusReason")?.value);

    payload.last_activity_at = new Date().toISOString();

    if (selectedStatus === "planned_transport") {
      const deliveryDate = byId("statusDeliveryDate")?.value || "";
      const etaFrom = byId("statusEtaFrom")?.value || "";
      const etaTo = byId("statusEtaTo")?.value || "";

      if (deliveryDate) {
        payload.confirmed_delivery_date = deliveryDate;
        payload.expected_delivery_date = deliveryDate;
      }

      if (etaFrom) payload.delivery_eta_from = etaFrom;
      if (etaTo) payload.delivery_eta_to = etaTo;
      if (etaFrom || etaTo) payload.delivery_eta_status = "confirmed";
    }

    if (selectedStatus === "delivered") {
      const receivedBy = clean(byId("statusReceivedBy")?.value);
      if (receivedBy) payload.pod_signed_by = receivedBy;

      payload.pod_completed_at = new Date().toISOString();

      if (!payload.confirmed_delivery_date && !order.confirmed_delivery_date) {
        payload.confirmed_delivery_date = new Date().toISOString().slice(0, 10);
      }
    }

    if (selectedStatus === "cancelled") {
      await releaseAllocationsForCancelledOrder(order);
    }

    const { error } = await client
      .from("orders")
      .update(payload)
      .eq("id", order.id);

    if (error) throw error;

    let description = `Status changed manually to ${label(selectedStatus)}.`;

    if (selectedStatus === "cancelled") {
      const cancelReason = clean(byId("statusCancelReason")?.value);
      const cancelNotes = clean(byId("statusCancelNotes")?.value);
      if (cancelReason) description += ` Reason: ${cancelReason}.`;
      if (cancelNotes) description += ` Notes: ${cancelNotes}.`;
    }

    if (selectedStatus === "delivered") {
      const receivedBy = clean(byId("statusReceivedBy")?.value);
      const notes = clean(byId("statusDeliveryNotes")?.value);
      if (receivedBy) description += ` Received by: ${receivedBy}.`;
      if (notes) description += ` Notes: ${notes}.`;
    }

    if (reason) description += ` Reason: ${reason}.`;

    await client
      .from("order_activity_log")
      .insert({
        order_id: order.id,
        activity_type: "change_status",
        old_status: order.status || null,
        new_status: payload.status || null,
        description,
        created_at: new Date().toISOString()
      });

    byId("occGenericActionModal")?.classList.remove("open");
    byId("occGenericActionModal")?.setAttribute("aria-hidden", "true");

    if (window.OCCReloadOrders) {
      await window.OCCReloadOrders();
    }
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest("#genericActionSaveBtn");
    if (!button) return;

    if (byId("genericActionType")?.value !== "change_status") return;

    event.preventDefault();
    event.stopPropagation();

    const oldText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = "Updating...";

      await save();

      if (window.showToast) {
        window.showToast("Status updated.", "ok");
      }
    } catch (error) {
      console.error(error);
      alert(error.message || "Could not update status.");
    } finally {
      button.disabled = false;
      button.textContent = oldText || "Update Status";
    }
  }, true);

  window.ChangeStatusTool = {
    open
  };

})();