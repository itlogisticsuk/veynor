(function () {
  "use strict";

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let companyId = null;
  let currentOrder = null;
  let nextOrderNumber = "";

  function sbClient() {
    if (client) return client;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    client = sb();
    return client;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");

    if (!el) {
      alert(message);
      return;
    }

    el.textContent = message || "";
    el.className = "notice " + type;

    clearTimeout(window.__copyOrderToastTimer);
    window.__copyOrderToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6500);
  }

  async function loadCurrentProfile() {
    const db = sbClient();

    const { data: sessionData, error: sessionError } = await db.auth.getUser();
    if (sessionError) throw sessionError;

    currentUser = sessionData?.user || null;
    if (!currentUser?.id) throw new Error("Not authenticated.");

    let result = await db
      .from("user_profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (!result.data && !result.error) {
      result = await db
        .from("user_profiles")
        .select("*")
        .eq("auth_user_id", currentUser.id)
        .maybeSingle();
    }

    if (result.error) throw result.error;
    if (!result.data?.id) throw new Error("No user profile found.");

    currentProfile = result.data;
    companyId = currentProfile.company_id;

    if (!companyId) throw new Error("No company_id found for current user.");

    return currentProfile;
  }

  async function getCompanyId() {
    if (companyId) return companyId;
    await loadCurrentProfile();
    return companyId;
  }

  function getRetailName(order) {
    return clean(order.retail_name || order.delivery_name || "");
  }

  function getLineQty(line) {
    return toNumber(line.quantity_ordered || 0, 0);
  }

  function getLinePackages(line) {
    const qty = getLineQty(line);
    const packagesPerUnit =
      toNumber(line.packages_per_unit, 0) ||
      toNumber(line.products?.packages_per_unit, 0) ||
      toNumber(line.products?.package_count, 0) ||
      1;

    return Math.max(0, Math.round(qty * packagesPerUnit));
  }

  function getLineVolume(line) {
    const qty = getLineQty(line);
    return round2(
      toNumber(line.total_line_volume_m3, 0) ||
      toNumber(line.total_volume_m3, 0) ||
      toNumber(line.unit_volume_m3, 0) * qty ||
      toNumber(line.products?.volume_m3, 0) * qty
    );
  }

  function getLineWeight(line) {
    const qty = getLineQty(line);
    return round2(
      toNumber(line.total_line_weight_kg, 0) ||
      toNumber(line.unit_weight_kg, 0) * qty ||
      toNumber(line.products?.weight_kg, 0) * qty ||
      toNumber(line.products?.net_weight_kg, 0) * qty
    );
  }

  async function loadOrder(orderId) {
    const cid = await getCompanyId();

    const { data, error } = await sbClient()
      .from("orders")
      .select(`
        id,
        company_id,
        customer_id,
        order_number,
        order_type,
        source_type,
        external_reference,
        order_date,
        requested_delivery_date,
        status,
        delivery_address_1,
        delivery_address_2,
        delivery_address_3,
        delivery_city,
        delivery_postcode,
        delivery_country,
        delivery_region,
        delivery_lat,
        delivery_lng,
        retail_name,
        warehouse_status,
        transport_status,
        finance_status,
        overall_status,
        planning_colli,
        planning_volume_m3,
        weight_kg,
        memo,
        notes,
        copy_source_order_id,
        copy_reason,
        copy_created_at,
        is_copy,
        copied_to_order_id,
        replacement_count,
        total_order_colli,
        total_order_volume_m3,
        total_order_weight_kg,
        total_storage_tariff,
        matched_colli,
        matched_volume_m3,
        matched_weight_kg,
        customers (
          id,
          name,
          customer_code
        ),
        order_lines (
          id,
          company_id,
          order_id,
          product_id,
          line_number,
          quantity_ordered,
          quantity_allocated,
          quantity_shipped,
          unit_volume_m3,
          total_volume_m3,
          total_line_volume_m3,
          tariff_transport,
          tariff_storage,
          tariff_admin,
          tariff_handling,
          total_customer_charge,
          notes,
          sku_base,
          description,
          unit_weight_kg,
          total_line_weight_kg,
          matched_quantity,
          matched_volume_m3,
          matched_weight_kg,
          packages_per_unit,
          total_packages,
          scanned_packages,
          requested_package_no,
          requested_package_total,
          requested_package_label,
          line_type,
          manual_description,
          manual_amount_gbp,
          is_credit_line,
          products (
            id,
            sku_base,
            name,
            description,
            volume_m3,
            weight_kg,
            net_weight_kg,
            package_count,
            packages_per_unit
          )
        )
      `)
      .eq("id", orderId)
      .eq("company_id", cid)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Order not found.");

    return data;
  }

  async function getNextCopyOrderNumber(originalOrderNumber) {
    const cid = await getCompanyId();

    const base = clean(originalOrderNumber || "COPY");
    const cleanBase = base.replace(/C\d*$/i, "");
    const firstCopy = `${cleanBase}C`;

    const { data, error } = await sbClient()
      .from("orders")
      .select("order_number")
      .eq("company_id", cid)
      .ilike("order_number", `${firstCopy}%`);

    if (error) throw error;

    const existing = new Set(
      (data || []).map(row => String(row.order_number || "").toUpperCase())
    );

    if (!existing.has(firstCopy.toUpperCase())) return firstCopy;

    for (let i = 2; i < 999; i++) {
      const candidate = `${firstCopy}${i}`;
      if (!existing.has(candidate.toUpperCase())) return candidate;
    }

    throw new Error("Could not create a unique copy order number.");
  }

  function ensureStyles() {
    if (byId("copyOrderToolStyles")) return;

    const style = document.createElement("style");
    style.id = "copyOrderToolStyles";
    style.textContent = `
      .occ-copy-modal-backdrop{
        position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);
        display:flex;align-items:center;justify-content:center;padding:22px;
      }
      .occ-copy-modal-card{
        width:min(1120px,96vw);max-height:92vh;overflow:auto;background:#fff;
        border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.35);padding:18px;
      }
      .occ-copy-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px;}
      .occ-copy-modal-head h2{margin:0;font-size:22px;}
      .occ-copy-modal-head p{margin:4px 0 0;color:#64748b;font-size:13px;}
      .occ-copy-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
      .occ-copy-section{border:1px solid #dce5f2;border-radius:14px;background:#f8fafc;padding:14px;}
      .occ-copy-section h3{margin:0 0 10px;font-size:15px;}
      .occ-copy-section label{display:block;margin:8px 0 5px;font-size:12px;font-weight:800;color:#334155;}
      .occ-copy-line{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e5edf7;font-size:13px;}
      .occ-copy-line:last-child{border-bottom:0;}
      .occ-copy-line span{color:#64748b;}
      .occ-copy-check{display:flex!important;align-items:center;gap:8px;margin:8px 0!important;font-size:13px!important;font-weight:700!important;}
      .occ-copy-check input{width:auto;}
      .occ-copy-address{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;margin-top:10px;}
      .occ-copy-help{margin:8px 0 0;color:#64748b;font-size:12px;}
      .occ-copy-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid #e5edf7;}
      @media(max-width:850px){.occ-copy-grid{grid-template-columns:1fr;}}
    `;
    document.head.appendChild(style);
  }

  function close() {
    document.querySelector("#copyOrderToolModal")?.remove();
  }

  function selectedRadio(name, fallback) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  }

  function getCopyReason() {
    const selected = clean(byId("copyReasonSelect")?.value || "");
    const other = clean(byId("copyReasonOther")?.value || "");
    return selected === "Other" ? other : selected;
  }

  function renderModal(order) {
    close();

    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];
    const totalPackages = lines.reduce((sum, line) => sum + getLinePackages(line), 0);
    const totalVolume = lines.reduce((sum, line) => sum + getLineVolume(line), 0);
    const totalWeight = lines.reduce((sum, line) => sum + getLineWeight(line), 0);

    const modal = document.createElement("div");
    modal.id = "copyOrderToolModal";
    modal.className = "occ-copy-modal-backdrop";

    modal.innerHTML = `
      <section class="occ-copy-modal-card">
        <div class="occ-copy-modal-head">
          <div>
            <h2>Create Copy Order</h2>
            <p>${escapeHtml(order.order_number || "Order")} → <strong>${escapeHtml(nextOrderNumber)}</strong></p>
          </div>
          <button class="mini-btn" type="button" data-copy-close>Close</button>
        </div>

        <div class="occ-copy-grid">
          <section class="occ-copy-section">
            <h3>Original Order</h3>
            <div class="occ-copy-line"><span>Original order</span><strong>${escapeHtml(order.order_number || "—")}</strong></div>
            <div class="occ-copy-line"><span>New copy order</span><strong>${escapeHtml(nextOrderNumber)}</strong></div>
            <div class="occ-copy-line"><span>Product owner</span><strong>${escapeHtml(order.customers?.name || "—")}</strong></div>
            <div class="occ-copy-line"><span>Retailer</span><strong>${escapeHtml(getRetailName(order) || "—")}</strong></div>
            <div class="occ-copy-line"><span>Postcode</span><strong>${escapeHtml(order.delivery_postcode || "—")}</strong></div>
            <div class="occ-copy-line"><span>Products</span><strong>${lines.length}</strong></div>
            <div class="occ-copy-line"><span>Packages</span><strong>${totalPackages}</strong></div>
            <div class="occ-copy-line"><span>Volume / Weight</span><strong>${round2(totalVolume)} m³ / ${round2(totalWeight)} kg</strong></div>
          </section>

          <section class="occ-copy-section">
            <h3>Reason</h3>
            <label>Reason for copy order</label>
            <select id="copyReasonSelect" class="input">
              <option value="">Select reason</option>
              <option value="Customer refused delivery">Customer refused delivery</option>
              <option value="Customer not at home">Customer not at home</option>
              <option value="Damaged in transit">Damaged in transit</option>
              <option value="Wrong product delivered">Wrong product delivered</option>
              <option value="Lost shipment">Lost shipment</option>
              <option value="Replacement order">Replacement order</option>
              <option value="Warranty">Warranty</option>
              <option value="Other">Other</option>
            </select>
            <div id="copyReasonOtherWrap" style="display:none;margin-top:10px;">
              <label>Other reason</label>
              <textarea id="copyReasonOther" class="input" style="min-height:90px;"></textarea>
            </div>
          </section>

          <section class="occ-copy-section">
            <h3>Delivery Address</h3>
            <label class="occ-copy-check">
              <input id="copyKeepAddress" type="checkbox" checked>
              <span>Copy original delivery address</span>
            </label>

            <div id="copyAddressFields" class="occ-copy-address" style="display:none;">
              <label>Retail name</label>
              <input id="copyRetailName" class="input" value="${escapeHtml(getRetailName(order))}">
              <label>Address line 1</label>
              <input id="copyAddress1" class="input" value="${escapeHtml(order.delivery_address_1 || "")}">
              <label>Address line 2</label>
              <input id="copyAddress2" class="input" value="${escapeHtml(order.delivery_address_2 || "")}">
              <label>Address line 3</label>
              <input id="copyAddress3" class="input" value="${escapeHtml(order.delivery_address_3 || "")}">
              <label>City</label>
              <input id="copyCity" class="input" value="${escapeHtml(order.delivery_city || "")}">
              <label>Postcode</label>
              <input id="copyPostcode" class="input" value="${escapeHtml(order.delivery_postcode || "")}">
              <label>Country</label>
              <input id="copyCountry" class="input" value="${escapeHtml(order.delivery_country || "United Kingdom")}">
            </div>
          </section>

          <section class="occ-copy-section">
            <h3>Products</h3>
            <label class="occ-copy-check"><input id="copyProducts" type="checkbox" checked><span>Copy products from original order</span></label>
            <label class="occ-copy-check"><input id="copyQuantities" type="checkbox" checked><span>Copy original quantities</span></label>
            <label class="occ-copy-check"><input id="copyRunAllocation" type="checkbox"><span>Run Allocation Engine immediately</span></label>
            <p class="occ-copy-help">Allocations, route, POD, invoice and documents are never copied.</p>
          </section>

          <section class="occ-copy-section">
            <h3>Finance</h3>
            <label class="occ-copy-check"><input name="copyFinanceMode" type="radio" value="none"><span>No tariffs / no revenue</span></label>
            <label class="occ-copy-check"><input name="copyFinanceMode" type="radio" value="copy"><span>Copy existing tariffs from original order</span></label>
            <label class="occ-copy-check"><input name="copyFinanceMode" type="radio" value="recalculate" checked><span>Recalculate later / keep ready for pricing</span></label>
          </section>

          <section class="occ-copy-section">
            <h3>Original Order</h3>
            <label class="occ-copy-check"><input name="copyOriginalMode" type="radio" value="replaced" checked><span>Mark original order as Replaced</span></label>
            <label class="occ-copy-check"><input name="copyOriginalMode" type="radio" value="closed"><span>Close original order</span></label>
            <label class="occ-copy-check"><input name="copyOriginalMode" type="radio" value="keep_active"><span>Leave original order active</span></label>
          </section>

          <section class="occ-copy-section">
            <h3>Planning / Memo</h3>
            <label>Requested delivery date</label>
            <input id="copyRequestedDeliveryDate" class="input" type="date" value="${escapeHtml(String(order.requested_delivery_date || "").slice(0, 10))}">
            <label class="occ-copy-check" style="margin-top:10px;">
              <input id="copyMemo" type="checkbox" checked>
              <span>Copy original memo and add copy reason</span>
            </label>
          </section>
        </div>

        <div class="occ-copy-actions">
          <button class="btn btn-secondary" type="button" data-copy-close>Cancel</button>
          <button id="copyOrderCreateBtn" class="btn btn-primary" type="button">Create Copy Order</button>
        </div>
      </section>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("click", event => {
      if (event.target === modal || event.target.hasAttribute("data-copy-close")) close();
    });

    byId("copyReasonSelect")?.addEventListener("change", () => {
      byId("copyReasonOtherWrap").style.display =
        byId("copyReasonSelect").value === "Other" ? "block" : "none";
    });

    byId("copyKeepAddress")?.addEventListener("change", () => {
      byId("copyAddressFields").style.display =
        byId("copyKeepAddress").checked ? "none" : "grid";
    });

    byId("copyOrderCreateBtn")?.addEventListener("click", createCopyOrder);
  }

  function buildOrderPayload(order, reason) {
    const keepAddress = !!byId("copyKeepAddress")?.checked;
    const copyMemo = !!byId("copyMemo")?.checked;
    const financeMode = selectedRadio("copyFinanceMode", "recalculate");

    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];
    const totalPackages = lines.reduce((sum, line) => sum + getLinePackages(line), 0);
    const totalVolume = lines.reduce((sum, line) => sum + getLineVolume(line), 0);
    const totalWeight = lines.reduce((sum, line) => sum + getLineWeight(line), 0);

    const memoBase = copyMemo ? clean(order.memo || "") : "";
    const copyMemoText = `Copy order created from ${order.order_number || order.id}. Reason: ${reason}.`;
    const memo = memoBase ? `${memoBase}\n\n${copyMemoText}` : copyMemoText;

    const payload = {
      company_id: order.company_id,
      customer_id: order.customer_id || null,
      order_number: nextOrderNumber,
      order_type: "copy",
      source_type: "copy_order",
      external_reference: order.external_reference || null,
      order_date: today,
      requested_delivery_date: byId("copyRequestedDeliveryDate")?.value || null,
     status: "imported",
warehouse_status: "awaiting_goods",
transport_status: "not_planned",
finance_status: "not_invoiced",
overall_status: "awaiting_goods",
      planning_colli: totalPackages,
      planning_volume_m3: round2(totalVolume),
      weight_kg: round2(totalWeight),
      total_order_colli: totalPackages,
      total_order_volume_m3: round2(totalVolume),
      total_order_weight_kg: round2(totalWeight),
      total_storage_tariff: financeMode === "copy" ? round2(order.total_storage_tariff || 0) : 0,
      matched_colli: 0,
      matched_volume_m3: 0,
      matched_weight_kg: 0,
      memo,
      notes: order.notes || null,
      is_copy: true,
      copy_source_order_id: order.id,
      copy_reason: reason,
      copy_created_at: now,
      created_at: now,
      last_activity_at: now
    };

    if (keepAddress) {
      Object.assign(payload, {
        retail_name: order.retail_name || getRetailName(order),
        delivery_address_1: order.delivery_address_1 || null,
        delivery_address_2: order.delivery_address_2 || null,
        delivery_address_3: order.delivery_address_3 || null,
        delivery_city: order.delivery_city || null,
        delivery_postcode: order.delivery_postcode || null,
        delivery_country: order.delivery_country || "United Kingdom",
        delivery_region: order.delivery_region || null,
        delivery_lat: order.delivery_lat || null,
        delivery_lng: order.delivery_lng || null
      });
    } else {
      Object.assign(payload, {
        retail_name: byId("copyRetailName")?.value || null,
        delivery_address_1: byId("copyAddress1")?.value || null,
        delivery_address_2: byId("copyAddress2")?.value || null,
        delivery_address_3: byId("copyAddress3")?.value || null,
        delivery_city: byId("copyCity")?.value || null,
        delivery_postcode: byId("copyPostcode")?.value || null,
        delivery_country: byId("copyCountry")?.value || "United Kingdom",
        delivery_region: null,
        delivery_lat: null,
        delivery_lng: null
      });
    }

    return payload;
  }

  function buildLinePayloads(order, newOrderId) {
    if (!byId("copyProducts")?.checked) return [];

    const copyQuantities = !!byId("copyQuantities")?.checked;
    const financeMode = selectedRadio("copyFinanceMode", "recalculate");
    const now = new Date().toISOString();

    return (order.order_lines || []).map((line, index) => {
      const qty = copyQuantities ? getLineQty(line) : 1;

      const unitVolume =
        toNumber(line.unit_volume_m3, 0) ||
        toNumber(line.products?.volume_m3, 0);

      const unitWeight =
        toNumber(line.unit_weight_kg, 0) ||
        toNumber(line.products?.weight_kg, 0) ||
        toNumber(line.products?.net_weight_kg, 0);

      const packagesPerUnit =
        toNumber(line.packages_per_unit, 0) ||
        toNumber(line.products?.packages_per_unit, 0) ||
        toNumber(line.products?.package_count, 0) ||
        1;

      const totalPackages = Math.max(0, Math.round(qty * packagesPerUnit));
      const totalVolume = round2(unitVolume * qty);
      const totalWeight = round2(unitWeight * qty);

      return {
        company_id: order.company_id,
        order_id: newOrderId,
        product_id: line.product_id || line.products?.id || null,
        line_number: line.line_number || index + 1,
        quantity_ordered: qty,
        quantity_allocated: 0,
        quantity_shipped: 0,
        unit_volume_m3: round2(unitVolume),
        total_volume_m3: totalVolume,
        total_line_volume_m3: totalVolume,
        tariff_transport: financeMode === "copy" ? round2(line.tariff_transport || 0) : 0,
        tariff_storage: financeMode === "copy" ? round2(line.tariff_storage || 0) : 0,
        tariff_admin: financeMode === "copy" ? round2(line.tariff_admin || 0) : 0,
        tariff_handling: financeMode === "copy" ? round2(line.tariff_handling || 0) : 0,
        total_customer_charge: financeMode === "copy" ? round2(line.total_customer_charge || 0) : 0,
        notes: line.notes || null,
        sku_base: line.sku_base || line.products?.sku_base || null,
        description: line.description || line.products?.description || line.products?.name || null,
        unit_weight_kg: round2(unitWeight),
        total_line_weight_kg: totalWeight,
        matched_quantity: 0,
        matched_volume_m3: 0,
        matched_weight_kg: 0,
        packages_per_unit: Math.round(packagesPerUnit),
        total_packages: totalPackages,
        scanned_packages: 0,
        requested_package_no: line.requested_package_no || null,
        requested_package_total: line.requested_package_total || null,
        requested_package_label: line.requested_package_label || null,
        line_type: line.line_type || null,
        manual_description: line.manual_description || null,
        manual_amount_gbp: line.manual_amount_gbp || null,
        is_credit_line: false,
        created_at: now
      };
    });
  }

  async function insertActivity(orderId, description, type) {
    try {
      await sbClient().from("order_activity_log").insert({
        company_id: companyId,
        order_id: orderId,
        activity_type: type,
        old_status: null,
        new_status: null,
        description,
        created_by: currentUser?.id || currentProfile?.id || null,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.warn("Activity log skipped:", error.message);
    }
  }

  async function updateOriginalOrder(order, newOrderId, reason) {
    const mode = selectedRadio("copyOriginalMode", "replaced");

    const payload = {
      copied_to_order_id: newOrderId,
      replacement_count: toNumber(order.replacement_count, 0) + 1,
      last_activity_at: new Date().toISOString()
    };

if (mode === "replaced") {
  payload.status = "closed";
  payload.overall_status = "closed";
  payload.transport_status = "closed";
}

    if (mode === "closed") {
      payload.status = "closed";
      payload.overall_status = "closed";
      payload.transport_status = "closed";
    }

    const { error } = await sbClient()
      .from("orders")
      .update(payload)
      .eq("id", order.id)
      .eq("company_id", order.company_id);

    if (error) throw error;

    await insertActivity(
      order.id,
      `Copy order ${nextOrderNumber} created. Reason: ${reason}.`,
      "copy_order_created"
    );
  }

  async function runAllocationIfNeeded(newOrderId) {
    if (!byId("copyRunAllocation")?.checked) return;

    if (!window.AllocationEngine?.run) {
      showToast("Copy order created, but AllocationEngine is not loaded.", "err");
      return;
    }

    await window.AllocationEngine.run({
      orderIds: [newOrderId],
      dryRun: false
    });
  }

  async function createCopyOrder() {
    const reason = getCopyReason();

    if (!reason) {
      showToast("Choose or enter a reason first.", "err");
      return;
    }

    const btn = byId("copyOrderCreateBtn");
    const oldText = btn?.textContent || "Create Copy Order";

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Creating...";
      }

      const orderPayload = buildOrderPayload(currentOrder, reason);

      const { data: newOrder, error: orderError } = await sbClient()
        .from("orders")
        .insert(orderPayload)
        .select("id, order_number")
        .single();

      if (orderError) throw orderError;

      const linePayloads = buildLinePayloads(currentOrder, newOrder.id);

      if (linePayloads.length) {
        const { error: lineError } = await sbClient()
          .from("order_lines")
          .insert(linePayloads);

        if (lineError) throw lineError;
      }

      await updateOriginalOrder(currentOrder, newOrder.id, reason);

      await insertActivity(
        newOrder.id,
        `Copy order created from ${currentOrder.order_number}. Reason: ${reason}.`,
        "copy_order_created"
      );

      await runAllocationIfNeeded(newOrder.id);

      close();

      if (window.OCCReloadOrders) {
        await window.OCCReloadOrders();
      }

      showToast(`Copy order created: ${newOrder.order_number || nextOrderNumber}.`, "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not create copy order.", "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
  }

  async function open(orderId) {
    try {
      ensureStyles();
      sbClient();
      await loadCurrentProfile();

      currentOrder = await loadOrder(orderId);
      nextOrderNumber = await getNextCopyOrderNumber(currentOrder.order_number);

      renderModal(currentOrder);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not open copy order tool.", "err");
    }
  }

  window.CopyOrderTool = {
    open,
    close
  };
})();