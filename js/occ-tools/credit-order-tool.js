(function () {
  "use strict";

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let companyId = null;
  let currentOrder = null;
  let nextCreditNumber = "";

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

  function formatMoney(value) {
    return `£${round2(value).toFixed(2)}`;
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");

    if (!el) {
      alert(message);
      return;
    }

    el.textContent = message || "";
    el.className = "notice " + type;

    clearTimeout(window.__creditOrderToastTimer);
    window.__creditOrderToastTimer = setTimeout(() => {
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

  function getLineCharge(line) {
    const direct = toNumber(line.total_customer_charge, 0);
    if (direct) return direct;

    return round2(
      toNumber(line.tariff_transport, 0) +
      toNumber(line.tariff_storage, 0) +
      toNumber(line.tariff_admin, 0) +
      toNumber(line.tariff_handling, 0)
    );
  }

function getLineStorage(line) {
  return round2(toNumber(line.tariff_storage, 0));
}

function getLineAdmin(line) {
  return round2(toNumber(line.tariff_admin, 0));
}

function getLinePick(line) {
  return round2(toNumber(line.tariff_handling, 0));
}

function getLineTransport(line) {
  return round2(toNumber(line.tariff_transport, 0));
}

function getCreditType() {
  return document.querySelector("input[name='creditType']:checked")?.value || "full";
}

function getCreditTypeLabel(type = getCreditType()) {
  const map = {
    full: "Full Credit",
    warehouse: "Warehouse Credit",
    transport: "Transport Credit",
    admin: "Admin Credit",
    pick: "Pick / Handling Credit",
    manual: "Manual Credit"
  };

  return map[type] || "Credit";
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
        credit_for_order_id,
        credit_reason,
        credit_created_at,
        is_credit,
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

  async function getNextCreditOrderNumber(originalOrderNumber) {
    const cid = await getCompanyId();

    const base = clean(originalOrderNumber || "CREDIT");
    const cleanBase = base.replace(/CR\d*$/i, "");
    const firstCredit = `${cleanBase}CR`;

    const { data, error } = await sbClient()
      .from("orders")
      .select("order_number")
      .eq("company_id", cid)
      .ilike("order_number", `${firstCredit}%`);

    if (error) throw error;

    const existing = new Set(
      (data || []).map(row => String(row.order_number || "").toUpperCase())
    );

    if (!existing.has(firstCredit.toUpperCase())) return firstCredit;

    for (let i = 2; i < 999; i++) {
      const candidate = `${firstCredit}${i}`;
      if (!existing.has(candidate.toUpperCase())) return candidate;
    }

    throw new Error("Could not create a unique credit order number.");
  }

  function ensureStyles() {
    if (byId("creditOrderToolStyles")) return;

    const style = document.createElement("style");
    style.id = "creditOrderToolStyles";
    style.textContent = `
      .occ-credit-modal-backdrop{
        position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);
        display:flex;align-items:center;justify-content:center;padding:22px;
      }
      .occ-credit-modal-card{
        width:min(1180px,96vw);max-height:92vh;overflow:auto;background:#fff;
        border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.35);padding:18px;
      }
      .occ-credit-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px;}
      .occ-credit-modal-head h2{margin:0;font-size:22px;}
      .occ-credit-modal-head p{margin:4px 0 0;color:#64748b;font-size:13px;}
      .occ-credit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
      .occ-credit-section{border:1px solid #dce5f2;border-radius:14px;background:#f8fafc;padding:14px;}
      .occ-credit-section h3{margin:0 0 10px;font-size:15px;}
      .occ-credit-section label{display:block;margin:8px 0 5px;font-size:12px;font-weight:800;color:#334155;}
      .occ-credit-line{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e5edf7;font-size:13px;}
      .occ-credit-line:last-child{border-bottom:0;}
      .occ-credit-line span{color:#64748b;}
      .occ-credit-check{display:flex!important;align-items:center;gap:8px;margin:8px 0!important;font-size:13px!important;font-weight:700!important;}
      .occ-credit-check input{width:auto;}
      .occ-credit-help{margin:8px 0 0;color:#64748b;font-size:12px;}
      .occ-credit-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid #e5edf7;}
      .occ-credit-table-wrap{overflow:auto;border:1px solid #dce5f2;border-radius:12px;background:#fff;}
      .occ-credit-table{width:100%;min-width:920px;border-collapse:collapse;}
      .occ-credit-table th,.occ-credit-table td{padding:9px 10px;border-bottom:1px solid #e5edf7;text-align:left;font-size:12px;vertical-align:top;}
      .occ-credit-table th{background:#f8fafc;color:#334155;font-size:10px;text-transform:uppercase;letter-spacing:.04em;}
      .occ-credit-table input{width:100%;min-height:34px;border:1px solid #dce5f2;border-radius:8px;padding:6px 8px;}
      .occ-credit-summary{font-weight:900;color:#07152f;}
      @media(max-width:850px){.occ-credit-grid{grid-template-columns:1fr;}}
    `;
    document.head.appendChild(style);
  }

  function close() {
    document.querySelector("#creditOrderToolModal")?.remove();
  }

  function getCreditReason() {
    const selected = clean(byId("creditReasonSelect")?.value || "");
    const other = clean(byId("creditReasonOther")?.value || "");
    return selected === "Other" ? other : selected;
  }

  function renderModal(order) {
    close();

    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];
    const totalCredit = lines.reduce((sum, line) => sum + getLineCharge(line), 0);

    const modal = document.createElement("div");
    modal.id = "creditOrderToolModal";
    modal.className = "occ-credit-modal-backdrop";

    modal.innerHTML = `
      <section class="occ-credit-modal-card">
        <div class="occ-credit-modal-head">
          <div>
            <h2>Create Credit Order</h2>
            <p>${escapeHtml(order.order_number || "Order")} → <strong>${escapeHtml(nextCreditNumber)}</strong></p>
          </div>
          <button class="mini-btn" type="button" data-credit-close>Close</button>
        </div>

        <div class="occ-credit-grid">
          <section class="occ-credit-section">
            <h3>Original Order</h3>
            <div class="occ-credit-line"><span>Original order</span><strong>${escapeHtml(order.order_number || "—")}</strong></div>
            <div class="occ-credit-line"><span>Credit order</span><strong>${escapeHtml(nextCreditNumber)}</strong></div>
            <div class="occ-credit-line"><span>Product owner</span><strong>${escapeHtml(order.customers?.name || "—")}</strong></div>
            <div class="occ-credit-line"><span>Retailer</span><strong>${escapeHtml(getRetailName(order) || "—")}</strong></div>
            <div class="occ-credit-line"><span>Postcode</span><strong>${escapeHtml(order.delivery_postcode || "—")}</strong></div>
            <div class="occ-credit-line"><span>Lines</span><strong>${lines.length}</strong></div>
            <div class="occ-credit-line"><span>Available charge</span><strong>${escapeHtml(formatMoney(totalCredit))}</strong></div>
          </section>

          <section class="occ-credit-section">
            <h3>Reason</h3>
            <label>Reason for credit</label>
            <select id="creditReasonSelect" class="input">
              <option value="">Select reason</option>
              <option value="Damaged goods">Damaged goods</option>
              <option value="Wrong product delivered">Wrong product delivered</option>
              <option value="Customer return">Customer return</option>
              <option value="Price correction">Price correction</option>
              <option value="Service failure">Service failure</option>
              <option value="Goodwill credit">Goodwill credit</option>
              <option value="Invoice correction">Invoice correction</option>
              <option value="Other">Other</option>
            </select>

            <div id="creditReasonOtherWrap" style="display:none;margin-top:10px;">
              <label>Other reason</label>
              <textarea id="creditReasonOther" class="input" style="min-height:90px;"></textarea>
            </div>

            <label class="occ-credit-check" style="margin-top:12px;">
              <input id="creditCopyMemo" type="checkbox" checked>
              <span>Copy original memo and add credit reason</span>
            </label>
<div style="margin-top:14px;">
  <h3>Credit Type</h3>

  <label class="occ-credit-check">
    <input type="radio" name="creditType" value="full" checked>
    <span>Full Credit</span>
  </label>

  <label class="occ-credit-check">
    <input type="radio" name="creditType" value="warehouse">
    <span>Warehouse costs only</span>
  </label>

  <label class="occ-credit-check">
    <input type="radio" name="creditType" value="transport">
    <span>Transport costs only</span>
  </label>

  <label class="occ-credit-check">
    <input type="radio" name="creditType" value="admin">
    <span>Admin costs only</span>
  </label>

  <label class="occ-credit-check">
    <input type="radio" name="creditType" value="pick">
    <span>Pick / Handling costs only</span>
  </label>

  <label class="occ-credit-check">
    <input type="radio" name="creditType" value="manual">
    <span>Manual credit amount</span>
  </label>
</div>
          </section>
        </div>

        <section class="occ-credit-section" style="margin-top:14px;">
          <h3>Credit Lines</h3>
          <p class="occ-credit-help">
            Select the lines to credit. Amounts are stored as negative values.
          </p>

          <div class="occ-credit-table-wrap" style="margin-top:10px;">
            <table class="occ-credit-table">
              <thead>
                <tr>
                  <th style="width:52px;">Credit</th>
                  <th>SKU</th>
                  <th>Description</th>
                  <th style="width:90px;">Original qty</th>
                  <th style="width:90px;">Credit qty</th>
                <th style="width:100px;">Warehouse</th>
<th style="width:100px;">Transport</th>
<th style="width:90px;">Admin</th>
<th style="width:90px;">Pick</th>
<th style="width:120px;">Credit amount</th>
                </tr>
              </thead>
              <tbody id="creditLinesBody">
                ${
                  lines.map((line, index) => {
                    const qty = getLineQty(line);
                    const charge = round2(getLineCharge(line));
                    const sku = line.sku_base || line.products?.sku_base || "—";
                    const desc = line.description || line.products?.description || line.products?.name || "—";

                    return `
                      <tr data-credit-line-index="${index}">
                        <td>
                          <input type="checkbox" data-credit-line-enabled checked>
                        </td>
                        <td><strong>${escapeHtml(sku)}</strong></td>
                        <td>${escapeHtml(desc)}</td>
                        <td>${escapeHtml(qty)}</td>
                        <td>
                          <input type="number" min="0" step="1" data-credit-line-qty value="${escapeHtml(qty)}">
                        </td>
<td>
  <input
    type="number"
    step="0.01"
    class="credit-storage"
    value="${round2(getLineStorage(line)).toFixed(2)}">
</td>

<td>
  <input
    type="number"
    step="0.01"
    class="credit-transport"
    value="${round2(getLineTransport(line)).toFixed(2)}">
</td>

<td>
  <input
    type="number"
    step="0.01"
    class="credit-admin"
    value="${round2(getLineAdmin(line)).toFixed(2)}">
</td>

<td>
  <input
    type="number"
    step="0.01"
    class="credit-pick"
    value="${round2(getLinePick(line)).toFixed(2)}">
</td>
<td>
  <input
  type="number"
  step="0.01"
  data-credit-line-amount
  value="${escapeHtml(charge)}"
  readonly
>
</td>
                      </tr>
                    `;
                  }).join("")
                }
              </tbody>
            </table>
          </div>

          <div style="margin-top:12px;display:flex;justify-content:space-between;gap:12px;align-items:center;">
            <div id="creditSummary" class="occ-credit-summary">Credit total: £0.00</div>
            <button id="creditSelectAllBtn" class="btn btn-secondary" type="button">Select all lines</button>
          </div>
        </section>

        <div class="occ-credit-actions">
          <button class="btn btn-secondary" type="button" data-credit-close>Cancel</button>
          <button id="creditOrderCreateBtn" class="btn btn-primary" type="button">Create Credit Order</button>
        </div>
      </section>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("click", event => {
      if (event.target === modal || event.target.hasAttribute("data-credit-close")) close();
    });

    byId("creditReasonSelect")?.addEventListener("change", () => {
      byId("creditReasonOtherWrap").style.display =
        byId("creditReasonSelect").value === "Other" ? "block" : "none";
    });

    byId("creditLinesBody")?.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", refreshCreditSummary);
      input.addEventListener("change", refreshCreditSummary);
document
.querySelectorAll(
".credit-storage,.credit-transport,.credit-admin,.credit-pick"
)
.forEach(input => {

    input.addEventListener(
        "input",
        refreshCreditAmounts
    );

});
    });
document.querySelectorAll("input[name='creditType']").forEach(input => {
  input.addEventListener("change", refreshCreditAmountsByType);
});

    byId("creditSelectAllBtn")?.addEventListener("click", () => {
      byId("creditLinesBody")?.querySelectorAll("[data-credit-line-enabled]").forEach(input => {
        input.checked = true;
      });
refreshCreditAmountsByType();
      refreshCreditSummary();
    });

    byId("creditOrderCreateBtn")?.addEventListener("click", createCreditOrder);

    refreshCreditSummary();
  }

function refreshCreditAmountsByType() {
  const type = getCreditType();
  const rows = Array.from(document.querySelectorAll("#creditLinesBody tr[data-credit-line-index]"));
  const sourceLines = currentOrder?.order_lines || [];

  rows.forEach(row => {
    const index = Number(row.dataset.creditLineIndex);
    const line = sourceLines[index];
    if (!line) return;

    let amount = 0;

    if (type === "full") amount = getLineCharge(line);
    if (type === "warehouse") amount = getLineStorage(line);
    if (type === "transport") amount = getLineTransport(line);
    if (type === "admin") amount = getLineAdmin(line);
    if (type === "pick") amount = getLinePick(line);

    const amountInput = row.querySelector("[data-credit-line-amount]");

    if (amountInput && type !== "manual") {
      amountInput.value = round2(amount).toFixed(2);
    }

    if (amountInput) {
      amountInput.readOnly = type !== "manual";
    }
  });

  refreshCreditSummary();
}

  function getSelectedCreditLines() {
    const rows = Array.from(document.querySelectorAll("#creditLinesBody tr[data-credit-line-index]"));
    const sourceLines = currentOrder?.order_lines || [];

    return rows
      .map(row => {
        const enabled = row.querySelector("[data-credit-line-enabled]")?.checked;
        if (!enabled) return null;

        const index = Number(row.dataset.creditLineIndex);
        const sourceLine = sourceLines[index];
        if (!sourceLine) return null;

        const creditQty = Math.max(0, Math.round(toNumber(row.querySelector("[data-credit-line-qty]")?.value, 0)));
        const storage = round2(toNumber(row.querySelector(".credit-storage")?.value, 0));
const transport = round2(toNumber(row.querySelector(".credit-transport")?.value, 0));
const admin = round2(toNumber(row.querySelector(".credit-admin")?.value, 0));
const pick = round2(toNumber(row.querySelector(".credit-pick")?.value, 0));

const creditAmount = round2(storage + transport + admin + pick);

        if (creditQty <= 0 && creditAmount <= 0) return null;

        return {
  sourceLine,
  creditQty,
  creditAmount,
  storage,
  transport,
  admin,
  pick
};
      })
      .filter(Boolean);
  }

  function refreshCreditSummary() {
    const selected = getSelectedCreditLines();
    const total = selected.reduce((sum, item) => sum + item.creditAmount, 0);
    const summary = byId("creditSummary");
    if (summary) summary.textContent = `Credit total: -${formatMoney(total)}`;
  }

function refreshCreditAmounts() {
  document
    .querySelectorAll("#creditLinesBody tr[data-credit-line-index]")
    .forEach(row => {
      const storage = toNumber(row.querySelector(".credit-storage")?.value, 0);
      const transport = toNumber(row.querySelector(".credit-transport")?.value, 0);
      const admin = toNumber(row.querySelector(".credit-admin")?.value, 0);
      const pick = toNumber(row.querySelector(".credit-pick")?.value, 0);

      const total = round2(storage + transport + admin + pick);

      const amountInput = row.querySelector("[data-credit-line-amount]");
      if (amountInput) {
        amountInput.value = total.toFixed(2);
      }
    });

  refreshCreditSummary();
}

  function buildOrderPayload(order, reason) {
    const selected = getSelectedCreditLines();
    const totalCredit = selected.reduce((sum, item) => sum + item.creditAmount, 0);
const negativeCredit = -Math.abs(round2(totalCredit));

    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const memoBase = byId("creditCopyMemo")?.checked ? clean(order.memo || "") : "";
    const creditMemoText = `Credit order created from ${order.order_number || order.id}. Reason: ${reason}.`;
    const memo = memoBase ? `${memoBase}\n\n${creditMemoText}` : creditMemoText;

    return {
      company_id: order.company_id,
      customer_id: order.customer_id || null,
      order_number: nextCreditNumber,
      order_type: "credit",
      source_type: "credit_order",
      external_reference: order.external_reference || null,
      order_date: today,
      requested_delivery_date: today,

status: "closed",
warehouse_status: "not_required",
transport_status: "not_required",
finance_status: "not_invoiced",
overall_status: "closed",

      planning_colli: 0,
      planning_volume_m3: 0,
      weight_kg: 0,
      total_order_colli: 0,
      total_order_volume_m3: 0,
      total_order_weight_kg: 0,
      total_storage_tariff: 0,
total_customer_charge: negativeCredit,

      matched_colli: 0,
      matched_volume_m3: 0,
      matched_weight_kg: 0,

      retail_name: order.retail_name || getRetailName(order),
      delivery_address_1: order.delivery_address_1 || null,
      delivery_address_2: order.delivery_address_2 || null,
      delivery_address_3: order.delivery_address_3 || null,
      delivery_city: order.delivery_city || null,
      delivery_postcode: order.delivery_postcode || null,
      delivery_country: order.delivery_country || "United Kingdom",
      delivery_region: order.delivery_region || null,
      delivery_lat: order.delivery_lat || null,
      delivery_lng: order.delivery_lng || null,

      memo,
      notes: `${getCreditTypeLabel()} value: -${formatMoney(totalCredit)}`,

      is_credit: true,
      credit_for_order_id: order.id,
      credit_reason: reason,
      credit_created_at: now,

      created_at: now,
      last_activity_at: now
    };
  }

  function buildLinePayloads(order, newOrderId) {
    const selected = getSelectedCreditLines();
    const now = new Date().toISOString();

    return selected.map((item, index) => {
      const line = item.sourceLine;
      const qty = item.creditQty;
const creditType = getCreditType();

const storageCredit = round2(item.storage || 0);
const transportCredit = round2(item.transport || 0);
const adminCredit = round2(item.admin || 0);
const pickCredit = round2(item.pick || 0);

      const unitVolume =
        toNumber(line.unit_volume_m3, 0) ||
        toNumber(line.products?.volume_m3, 0);

      const unitWeight =
        toNumber(line.unit_weight_kg, 0) ||
        toNumber(line.products?.weight_kg, 0) ||
        toNumber(line.products?.net_weight_kg, 0);

      const sku = line.sku_base || line.products?.sku_base || null;
      const desc = line.description || line.products?.description || line.products?.name || "Credit line";

      return {
        company_id: order.company_id,
        order_id: newOrderId,
        product_id: line.product_id || line.products?.id || null,
        line_number: index + 1,

        quantity_ordered: -Math.abs(qty),
        quantity_allocated: 0,
        quantity_shipped: 0,

        unit_volume_m3: 0,
        total_volume_m3: 0,
        total_line_volume_m3: 0,

tariff_transport: -Math.abs(round2(transportCredit)),
tariff_storage: -Math.abs(round2(storageCredit)),
tariff_admin: -Math.abs(round2(adminCredit)),
tariff_handling: -Math.abs(round2(pickCredit)),
total_customer_charge: -Math.abs(round2(item.creditAmount)),

notes: `${getCreditTypeLabel()} for ${sku || "line"} from ${order.order_number}`,
description: `${getCreditTypeLabel()} - ${desc}`,
manual_description: `${getCreditTypeLabel()} - ${desc}`,

        unit_weight_kg: 0,
        total_line_weight_kg: 0,

        matched_quantity: 0,
        matched_volume_m3: 0,
        matched_weight_kg: 0,

        packages_per_unit: 0,
        total_packages: 0,
        scanned_packages: 0,

        requested_package_no: null,
        requested_package_total: null,
        requested_package_label: null,

        line_type: "manual",
        manual_description: `Credit - ${desc}`,
        manual_amount_gbp: -Math.abs(round2(item.creditAmount)),
        is_credit_line: true,

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

  async function createCreditOrder() {
    const reason = getCreditReason();

    if (!reason) {
      showToast("Choose or enter a credit reason first.", "err");
      return;
    }

    const selected = getSelectedCreditLines();

    if (!selected.length) {
      showToast("Select at least one line to credit.", "err");
      return;
    }

    const btn = byId("creditOrderCreateBtn");
    const oldText = btn?.textContent || "Create Credit Order";

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

if (window.CreditNoteGenerator?.generate) {
  await window.CreditNoteGenerator.generate(newOrder.id, sbClient(), companyId);
}

      await insertActivity(
        currentOrder.id,
        `Credit order ${nextCreditNumber} created. Reason: ${reason}.`,
        "credit_order_created"
      );

      await insertActivity(
        newOrder.id,
        `Credit order created from ${currentOrder.order_number}. Reason: ${reason}.`,
        "credit_order_created"
      );

      close();

      if (window.OCCReloadOrders) {
        await window.OCCReloadOrders();
      }

      showToast(`Credit order created: ${newOrder.order_number || nextCreditNumber}.`, "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not create credit order.", "err");
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
      nextCreditNumber = await getNextCreditOrderNumber(currentOrder.order_number);

      renderModal(currentOrder);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not open credit order tool.", "err");
    }
  }

  window.CreditOrderTool = {
    open,
    close
  };
})();