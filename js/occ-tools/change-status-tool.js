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

function cancellationReasonLabel(value) {
  const map = {
    customer_cancelled: "Customer cancelled",
    duplicate_order: "Duplicate order",
    stock_unavailable: "Stock unavailable",
    damaged: "Damaged",
    other: "Other"
  };

  const key = String(value || "").trim().toLowerCase();

  return map[key] || String(value || "—").replaceAll("_", " ");
}


async function getCompanyId(client) {
  if (!client) {
    throw new Error("Supabase client not available.");
  }

  const { data: authData, error: authError } =
    await client.auth.getUser();

  if (authError) throw authError;

  const userId = authData?.user?.id;

  if (!userId) {
    throw new Error("Not authenticated.");
  }

  let result = await client
    .from("user_profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();

  if (!result.data && !result.error) {
    result = await client
      .from("user_profiles")
      .select("company_id")
      .eq("auth_user_id", userId)
      .maybeSingle();
  }

  if (result.error) throw result.error;

  if (!result.data?.company_id) {
    throw new Error("No tenant found for current user.");
  }

  return result.data.company_id;
}



async function open(orderId) {
  const client = window.sb ? window.sb() : null;

  if (!client) {
    throw new Error("Supabase client not available.");
  }

  if (!orderId) {
    throw new Error("Order ID is missing.");
  }

  const companyId = await getCompanyId(client);

  const { data: order, error } = await client
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw error;

  if (!order) {
    throw new Error("Order not found for active tenant.");
  }

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
    overall_status: "cancelled",

    route_id: null,
    carrier_vehicle_id: null,

    driver_user_id: null,
    driver_profile_id: null,
    driver_name: null,
    driver_email: null,

    confirmed_delivery_date: null,
    expected_delivery_date: null,
    planned_route_date: null,

    delivery_eta_from: null,
    delivery_eta_to: null,
    delivery_eta_status: "cancelled",

    sent_to_driver_at: null
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
      <option value="customer_cancelled">Customer cancelled</option>
      <option value="duplicate_order">Duplicate order</option>
      <option value="stock_unavailable">Stock unavailable</option>
      <option value="damaged">Damaged</option>
      <option value="other">Other</option>
    </select>

    <label style="margin-top:10px;">Cancellation notes</label>

    <textarea
      class="input"
      id="statusCancelNotes"
      rows="3"
      placeholder="Optional cancellation notes..."
    ></textarea>

    <label style="margin-top:10px;">Charge customer</label>

    <select class="input" id="statusCancelChargeable">
      <option value="">Select...</option>
      <option value="false">No — do not invoice</option>
      <option value="true">Yes — keep available for invoicing</option>
    </select>

    <div
      style="
        margin-top:10px;
        padding:10px 12px;
        border:1px solid #dbe3ee;
        border-radius:9px;
        background:#f8fafc;
        color:#64748b;
        font-size:12px;
        line-height:1.45;
      "
    >
      Choosing “No” marks the order as not chargeable.
      Choosing “Yes” keeps the cancelled order available for invoicing.
    </div>
  `;

  const reasonSelect = byId("statusCancelReason");
  const chargeableSelect = byId("statusCancelChargeable");

  reasonSelect?.addEventListener("change", () => {
    if (!chargeableSelect || chargeableSelect.value) return;

    const reason = reasonSelect.value;

    if (
      reason === "customer_cancelled" ||
      reason === "duplicate_order"
    ) {
      chargeableSelect.value = "false";
    }

    if (
      reason === "stock_unavailable" ||
      reason === "damaged"
    ) {
      chargeableSelect.value = "true";
    }
  });

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

${
  String(order.derived_lifecycle_status || "").toLowerCase() === "cancelled" ||
  String(order.status || "").toLowerCase() === "cancelled"
    ? `
      <div class="detail-line">
        <span class="detail-label">Reason</span>
        <span class="detail-value">
          ${cancellationReasonLabel(order.cancellation_reason)}
        </span>
      </div>

      ${
        order.cancellation_notes
          ? `
            <div class="detail-line">
              <span class="detail-label">Notes</span>
              <span class="detail-value">
                ${clean(order.cancellation_notes)}
              </span>
            </div>
          `
          : ""
      }

      <div class="detail-line">
        <span class="detail-label">Charge customer</span>
        <span class="detail-value">
          ${order.is_chargeable === true ? "Yes" : "No"}
        </span>
      </div>

      <div class="detail-line">
        <span class="detail-label">Finance</span>
        <span class="detail-value">
          ${label(order.finance_status)}
        </span>
      </div>
    `
    : ""
}

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

  if (!client) {
    throw new Error("Supabase client not available.");
  }

  if (!order?.id || !order?.company_id) {
    throw new Error("Order or tenant is missing.");
  }

  const companyId = await getCompanyId(client);

  if (companyId !== order.company_id) {
    throw new Error("Tenant mismatch.");
  }

  // Load order lines directly from the database
  const { data: lines, error: lineError } = await client
    .from("order_lines")
    .select("id")
    .eq("order_id", order.id)
    .eq("company_id", companyId);

  if (lineError) throw lineError;

  const lineIds = (lines || [])
    .map(line => line.id)
    .filter(Boolean);

  if (!lineIds.length) return;

  // Load allocations for this tenant's order lines
  const { data: allocations, error: allocationError } =
    await client
      .from("order_allocations")
      .select("id, item_id, allocation_status")
      .in("order_line_id", lineIds)
      .eq("company_id", companyId);

  if (allocationError) throw allocationError;

  const activeAllocations = (allocations || []).filter(
    allocation =>
      String(allocation.allocation_status || "")
        .toLowerCase() !== "cancelled"
  );

  if (!activeAllocations.length) return;

  // Release only individual items linked to this order
  const itemIds = [...new Set(
    activeAllocations
      .map(allocation => allocation.item_id)
      .filter(Boolean)
  )];

  for (const itemId of itemIds) {
    const { error: itemError } = await client
      .from("items")
      .update({
        status: "in_stock",
        linked_order_id: null,
        reserved_at: null
      })
      .eq("id", itemId)
      .eq("company_id", companyId)
      .eq("linked_order_id", order.id)
      .in("status", ["reserved", "in_stock"]);

    if (itemError) throw itemError;
  }

  // Cancel the allocations for this order only
  const allocationIds = activeAllocations
    .map(allocation => allocation.id)
    .filter(Boolean);

  if (allocationIds.length) {
    const { error } = await client
      .from("order_allocations")
      .update({
        allocation_status: "cancelled"
      })
      .in("id", allocationIds)
      .eq("company_id", companyId);

    if (error) throw error;
  }
}


async function removeCancelledOrderFromPlanning(order) {
  const client = window.sb ? window.sb() : null;

  if (!client) {
    throw new Error("Supabase client not available.");
  }

  if (!order?.id || !order?.company_id) {
    throw new Error("Order or tenant is missing.");
  }

  const { error } = await client
    .from("route_stops")
    .delete()
    .eq("order_id", order.id)
    .eq("company_id", order.company_id);

  if (error) {
    throw new Error(
      `Could not remove cancelled order from planning: ${error.message}`
    );
  }
}


async function save() {
  const client = window.sb ? window.sb() : null;

  if (!client) {
    throw new Error("Supabase client not available.");
  }

  const order = currentOrder;

  if (!order?.id || !order?.company_id) {
    throw new Error("No valid tenant order selected.");
  }

  const companyId = await getCompanyId(client);

  if (order.company_id !== companyId) {
    throw new Error("Order does not belong to active tenant.");
  }

  const selectedStatus =
    byId("changeStatusSelect")?.value || "";

  if (!selectedStatus) {
    throw new Error("Select a new status first.");
  }

  const payload = getStatusPayload(selectedStatus);

  if (!payload) {
    throw new Error("Invalid status selected.");
  }

  const reason = clean(byId("changeStatusReason")?.value);

  payload.last_activity_at = new Date().toISOString();

  if (selectedStatus !== "cancelled") {
    payload.cancellation_reason = null;
    payload.cancellation_notes = null;
  }

  if (selectedStatus === "planned_transport") {
    const deliveryDate =
      byId("statusDeliveryDate")?.value || "";

    const etaFrom =
      byId("statusEtaFrom")?.value || "";

    const etaTo =
      byId("statusEtaTo")?.value || "";

    if (deliveryDate) {
      payload.confirmed_delivery_date = deliveryDate;
      payload.expected_delivery_date = deliveryDate;
    }

    if (etaFrom) payload.delivery_eta_from = etaFrom;
    if (etaTo) payload.delivery_eta_to = etaTo;

    if (etaFrom || etaTo) {
      payload.delivery_eta_status = "confirmed";
    }
  }

  if (selectedStatus === "delivered") {
    const receivedBy =
      clean(byId("statusReceivedBy")?.value);

    if (receivedBy) {
      payload.pod_signed_by = receivedBy;
    }

    payload.pod_completed_at = new Date().toISOString();

    if (
      !payload.confirmed_delivery_date &&
      !order.confirmed_delivery_date
    ) {
      payload.confirmed_delivery_date =
        new Date().toISOString().slice(0, 10);
    }
  }

  if (selectedStatus === "cancelled") {
    const cancelReason =
      clean(byId("statusCancelReason")?.value);

    const cancelNotes =
      clean(byId("statusCancelNotes")?.value);

    const chargeableValue =
      byId("statusCancelChargeable")?.value || "";

    if (!cancelReason) {
      throw new Error("Select a cancellation reason.");
    }

    if (!["true", "false"].includes(chargeableValue)) {
      throw new Error(
        "Choose whether the customer should be charged."
      );
    }

    const isChargeable = chargeableValue === "true";

    payload.cancellation_reason = cancelReason;
    payload.cancellation_notes = cancelNotes || null;
    payload.is_chargeable = isChargeable;

    payload.finance_status = isChargeable
      ? "not_invoiced"
      : "cancelled";
  }

  // Update order within active tenant
  const { data: updatedOrder, error: updateError } =
    await client
      .from("orders")
      .update(payload)
      .eq("id", order.id)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();

  if (updateError) throw updateError;

  if (!updatedOrder?.id) {
    throw new Error("Order update failed or tenant mismatch.");
  }

  // Release stock and planning after successful cancellation
  if (selectedStatus === "cancelled") {
    await releaseAllocationsForCancelledOrder(order);
    await removeCancelledOrderFromPlanning(order);
  }

  let description =
    `Status changed manually to ${label(selectedStatus)}.`;

  if (selectedStatus === "cancelled") {
    const cancelReasonValue =
      clean(byId("statusCancelReason")?.value);

    const cancelNotes =
      clean(byId("statusCancelNotes")?.value);

    const chargeable =
      byId("statusCancelChargeable")?.value === "true";

    const cancelReason = cancellationReasonLabel(
      cancelReasonValue
    );

    if (cancelReason) {
      description += ` Cancellation reason: ${cancelReason}.`;
    }

    if (cancelNotes) {
      description += ` Notes: ${cancelNotes}.`;
    }

    description += chargeable
      ? " Customer charge retained; order remains available for invoicing."
      : " Order marked as not chargeable and excluded from invoicing.";
  }

  if (selectedStatus === "delivered") {
    const receivedBy =
      clean(byId("statusReceivedBy")?.value);

    const notes =
      clean(byId("statusDeliveryNotes")?.value);

    if (receivedBy) {
      description += ` Received by: ${receivedBy}.`;
    }

    if (notes) {
      description += ` Notes: ${notes}.`;
    }
  }

  if (reason) {
    description += ` Reason: ${reason}.`;
  }

  const { error: activityError } = await client
    .from("order_activity_log")
    .insert({
      company_id: companyId,
      order_id: order.id,
      activity_type: "change_status",
      old_status: order.status || null,
      new_status: payload.status || null,
      description,
      created_at: new Date().toISOString()
    });

  if (activityError) {
    console.warn(
      "Status updated, but activity logging failed:",
      activityError.message
    );
  }

  byId("occGenericActionModal")?.classList.remove("open");

  byId("occGenericActionModal")?.setAttribute(
    "aria-hidden",
    "true"
  );

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