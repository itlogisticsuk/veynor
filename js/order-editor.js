(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";

  let client = null;
  let companyId = null;
  let currentUser = null;
  let currentProfile = null;
  let currentOrder = null;
  let products = [];
  let removedLineIds = new Set();
  let saving = false;

  function byId(id) {
    return document.getElementById(id);
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

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
  }

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;
    el.textContent = message || "";
    el.className = "notice " + type;
    clearTimeout(window.__orderEditorToastTimer);
    window.__orderEditorToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6500);
  }

  function ensureClient() {
    if (client) return client;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    client = sb();
    return client;
  }

  async function loadContext() {
    const db = ensureClient();

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError) throw userError;
    currentUser = userData?.user || null;

    let profileResult = await db
      .from("user_profiles")
      .select("*")
      .eq("id", currentUser?.id || "")
      .eq("is_active", true)
      .maybeSingle();

    if (!profileResult.data && !profileResult.error) {
      profileResult = await db
        .from("user_profiles")
        .select("*")
        .eq("auth_user_id", currentUser?.id || "")
        .eq("is_active", true)
        .maybeSingle();
    }

    if (profileResult.error) throw profileResult.error;
    currentProfile = profileResult.data || null;

    if (currentProfile?.company_id) {
      companyId = currentProfile.company_id;
      return companyId;
    }

    const { data, error } = await db
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    companyId = data.id;
    return companyId;
  }

  function getProductPackageCount(product) {
    const packageCount = toNumber(product?.package_count, 0);
    if (packageCount > 0) return Math.max(1, Math.round(packageCount));

    const packagesPerUnit = toNumber(product?.packages_per_unit, 0);
    if (packagesPerUnit > 0) return Math.max(1, Math.round(packagesPerUnit));

    const flags = [
      toNumber(product?.package_1_qty, 0),
      toNumber(product?.package_2_qty, 0),
      toNumber(product?.package_3_qty, 0)
    ];

    return Math.max(1, flags.filter(v => v > 0).length || 1);
  }

  function getLineQty(line) {
    return Math.max(0, Math.round(toNumber(line?.quantity_ordered || line?.quantity || 0, 0)));
  }

  function getLineDescription(line) {
    return cleanText(line?.description || line?.products?.description || line?.products?.name || "");
  }

  function getLineWeightKg(line) {
    const qty = getLineQty(line) || 1;
    return (
      toNumber(line?.total_line_weight_kg, 0) ||
      toNumber(line?.total_weight_kg, 0) ||
      (toNumber(line?.unit_weight_kg, 0) * qty) ||
      (toNumber(line?.products?.weight_kg, 0) * qty) ||
      (toNumber(line?.products?.net_weight_kg, 0) * qty) ||
      0
    );
  }

  async function fetchOrder(orderId) {
    const cid = await loadContext();

    const { data, error } = await client
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name,
          customer_code
        ),
        order_lines (
          id,
          order_id,
          quantity_ordered,
          product_id,
          sku_base,
          description,
          unit_volume_m3,
          total_volume_m3,
          total_line_volume_m3,
          tariff_storage,
          tariff_admin,
          tariff_handling,
          tariff_transport,
          total_customer_charge,
          products (
            id,
            sku_base,
            name,
            description,
            volume_m3,
            weight_kg,
            net_weight_kg,
            package_count,
            package_1_qty,
            package_2_qty,
            package_3_qty,
            packages_per_unit
          ),
          order_allocations (
            id,
            order_line_id,
            item_id,
            allocation_status,
            items (
              id,
              status,
              product_id,
              physical_product_id,
              stock_set_id,
              package_no,
              package_total,
              package_label
            )
          )
        )
      `)
      .eq("company_id", cid)
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Order not found.");

    currentOrder = data;
    return data;
  }

  async function fetchProducts(order) {
    const cid = await loadContext();

    let query = client
      .from("products")
      .select(`
        id,
        customer_id,
        sku_base,
        name,
        description,
        volume_m3,
        weight_kg,
        net_weight_kg,
        package_count,
        package_1_qty,
        package_2_qty,
        package_3_qty,
        packages_per_unit,
storage_tariff,
admin_tariff,
handling_tariff,
transport_tariff,
total_customer_charge
      `)
      .eq("company_id", cid)
      .order("sku_base", { ascending: true });

    if (order?.customer_id) {
      query = query.or(`customer_id.is.null,customer_id.eq.${order.customer_id}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    products = data || [];
    return products;
  }

function renderProductOptions(selectedProductId = "") {
  return [
    `<option value="">Select product</option>`,
    ...products.map(product => `
      <option
        value="${escapeHtml(product.id)}"
        ${String(product.id) === String(selectedProductId) ? "selected" : ""}
        data-sku="${escapeHtml(product.sku_base || "")}"
        data-description="${escapeHtml(product.description || product.name || "")}"
        data-volume="${escapeHtml(product.volume_m3 || 0)}"
        data-weight="${escapeHtml(product.weight_kg || product.net_weight_kg || 0)}"
        data-packages="${escapeHtml(getProductPackageCount(product))}"
        data-storage-tariff="${escapeHtml(product.storage_tariff || 0)}"
        data-admin-tariff="${escapeHtml(product.admin_tariff || 0)}"
        data-handling-tariff="${escapeHtml(product.handling_tariff || 0)}"
        data-transport-tariff="${escapeHtml(product.transport_tariff || 0)}"
        data-customer-charge="${escapeHtml(product.total_customer_charge || 0)}">
        ${escapeHtml(product.sku_base || "SKU")} · ${escapeHtml(product.description || product.name || "")}
      </option>
    `)
  ].join("");
}

function productFromRow(row) {
  const option = row.querySelector("[data-oe-product]")?.selectedOptions?.[0];
  if (!option?.value) return null;

  return {
    id: option.value,
    sku: option.dataset.sku || "",
    description: option.dataset.description || "",
    volume: toNumber(option.dataset.volume, 0),
    weight: toNumber(option.dataset.weight, 0),
    packages: Math.max(1, Math.round(toNumber(option.dataset.packages, 1))),
    storageTariff: toNumber(option.dataset.storageTariff, 0),
    adminTariff: toNumber(option.dataset.adminTariff, 0),
    handlingTariff: toNumber(option.dataset.handlingTariff, 0),
    transportTariff: toNumber(option.dataset.transportTariff, 0),
    customerCharge: toNumber(option.dataset.customerCharge, 0)
  };
}

  function refreshRow(row) {
    const product = productFromRow(row);
    const qty = Math.max(0, Math.round(toNumber(row.querySelector("[data-oe-qty]")?.value, 0)));

    if (!product) return;

    const desc = row.querySelector("[data-oe-description]");
    if (desc && !desc.value) desc.value = product.description;

    const packages = row.querySelector("[data-oe-packages]");
    const volume = row.querySelector("[data-oe-volume]");
    const weight = row.querySelector("[data-oe-weight]");
const revenue = row.querySelector("[data-oe-revenue]");
const unitCharge = product.customerCharge || (
  product.storageTariff +
  product.adminTariff +
  product.handlingTariff +
  product.transportTariff
);

    if (packages) packages.textContent = formatNumber(qty * product.packages, 0);
    if (volume) volume.textContent = `${formatNumber(qty * product.volume, 2)} m³`;
    if (weight) weight.textContent = `${formatNumber(qty * product.weight, 2)} kg`;
if (revenue) revenue.textContent = `£${formatNumber(qty * unitCharge, 2)}`;

    refreshSummary();
  }

  function rowHtml(line = null) {
    const isNew = !line?.id;
    const rowId = isNew ? `new-${Date.now()}-${Math.random().toString(16).slice(2)}` : line.id;
    const productId = line?.product_id || line?.products?.id || "";
    const qty = isNew ? 1 : getLineQty(line);
    const packageCount = isNew ? 0 : qty * getProductPackageCount(line.products || {});
    const volume = isNew
      ? 0
      : toNumber(line.total_line_volume_m3, 0) || toNumber(line.total_volume_m3, 0) || (toNumber(line.unit_volume_m3, 0) * qty) || (toNumber(line.products?.volume_m3, 0) * qty);
    const weight = isNew ? 0 : getLineWeightKg(line);

    return `
      <tr data-oe-line-id="${escapeHtml(rowId)}" ${isNew ? "data-oe-new='1'" : ""}>
        <td>
          <select class="input" data-oe-product>
            ${renderProductOptions(productId)}
          </select>
        </td>
        <td>
          <input class="input" data-oe-description value="${escapeHtml(isNew ? "" : getLineDescription(line))}">
        </td>
        <td>
          <input class="input" type="number" min="0" step="1" data-oe-qty value="${escapeHtml(qty)}">
        </td>
        <td data-oe-packages>${formatNumber(packageCount, 0)}</td>
        <td data-oe-volume>${formatNumber(volume, 2)} m³</td>
<td data-oe-weight>${formatNumber(weight, 2)} kg</td>
<td data-oe-revenue>£0.00</td>
<td style="text-align:right;">
          <button class="mini-btn" type="button" data-oe-remove>Remove</button>
        </td>
      </tr>
    `;
  }

  function ensureStyles() {
    if (byId("orderEditorStyles")) return;

    const style = document.createElement("style");
    style.id = "orderEditorStyles";
    style.textContent = `
      #occGenericActionModal .modal-card,
      #occGenericActionModal .occ-modal-card,
      #occGenericActionModal .occ-memo-modal-card{
        width:min(1450px,98vw);
        max-height:92vh;
        display:flex;
        flex-direction:column;
      }

      #genericActionBody{
        flex:1;
        overflow-y:auto;
        overflow-x:hidden;
        padding-right:8px;
      }

      #occGenericActionModal .modal-footer,
      #occGenericActionModal .occ-modal-footer{
        flex-shrink:0;
        position:sticky;
        bottom:0;
        background:#fff;
        border-top:1px solid #dce5f2;
        padding-top:14px;
        z-index:10;
      }
      .oe-grid{display:grid;gap:14px;}
      .oe-section{border:1px solid #dce5f2;border-radius:14px;background:#fff;padding:14px;}
      .oe-section h3{margin:0 0 10px;font-size:14px;color:#07152f;}
      .oe-fields{
    display:grid;
    grid-template-columns:repeat(3,minmax(260px,1fr));
    gap:14px;
}
      .oe-field label{display:block;font-size:11px;font-weight:900;color:#334155;text-transform:uppercase;margin-bottom:5px;}
      .oe-table-wrap{overflow:auto;border:1px solid #dce5f2;border-radius:12px;background:#fff;}
      .oe-table{
    width:100%;
    min-width:1380px;
}
      .oe-table th,.oe-table td{padding:9px 10px;border-bottom:1px solid #e5edf7;text-align:left;vertical-align:top;font-size:12px;}
      .oe-table th{background:#f8fafc;color:#334155;font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.04em;}
.oe-table th:nth-child(1),
.oe-table td:nth-child(1){
    width:420px;
}

.oe-table th:nth-child(2),
.oe-table td:nth-child(2){
    width:340px;
}

.oe-table th:nth-child(3),
.oe-table td:nth-child(3){
    width:80px;
}

.oe-table th:nth-child(4),
.oe-table td:nth-child(4){
    width:90px;
}

.oe-table th:nth-child(5),
.oe-table td:nth-child(5){
    width:120px;
}

.oe-table th:nth-child(6),
.oe-table td:nth-child(6){
    width:120px;
}

.oe-table th:nth-child(7),
.oe-table td:nth-child(7){
  width:120px;
  white-space:nowrap;
  font-weight:900;
}

.oe-table th:nth-child(8),
.oe-table td:nth-child(8){
  width:130px;
}

      .oe-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;}
      .oe-summary{font-size:12px;color:#334155;font-weight:850;}
      .oe-help{font-size:12px;color:#64748b;margin:8px 0 0;}
      .oe-loading{position:absolute;inset:0;background:rgba(255,255,255,.72);display:flex;align-items:center;justify-content:center;font-weight:950;color:#07152f;z-index:5;}
    `;
    document.head.appendChild(style);
  }

function refreshSummary() {
  let totalPackages = 0;
  let totalVolume = 0;
  let totalWeight = 0;
  let totalRevenue = 0;

  document.querySelectorAll("#orderEditorLinesBody tr[data-oe-line-id]").forEach(row => {
    const qty = Math.max(0, Math.round(toNumber(row.querySelector("[data-oe-qty]")?.value, 0)));

    if (row.dataset.oeManual === "1") {
      const packages = Math.max(0, Math.round(toNumber(row.querySelector("[data-oe-manual-packages]")?.value, 0)));
      const volume = toNumber(row.querySelector("[data-oe-manual-volume]")?.value, 0);
      const weight = toNumber(row.querySelector("[data-oe-manual-weight]")?.value, 0);
      const warehouse = toNumber(row.querySelector("[data-oe-manual-warehouse]")?.value, 0);
      const transport = toNumber(row.querySelector("[data-oe-manual-transport]")?.value, 0);

      totalPackages += packages;
      totalVolume += volume;
      totalWeight += weight;
      totalRevenue += warehouse + transport;
      return;
    }

    const product = productFromRow(row);
    if (!product || qty <= 0) return;

    const unitCharge = product.customerCharge || (
      product.storageTariff +
      product.adminTariff +
      product.handlingTariff +
      product.transportTariff
    );

    totalPackages += qty * product.packages;
    totalVolume += qty * product.volume;
    totalWeight += qty * product.weight;
    totalRevenue += qty * unitCharge;
  });

  const summary = byId("orderEditorSummary");
  if (summary) {
    summary.textContent = `${formatNumber(totalPackages, 0)} packages · ${formatNumber(totalVolume, 2)} m³ · ${formatNumber(totalWeight, 2)} kg · £${formatNumber(totalRevenue, 2)}`;
  }
}

  function bindRows() {
    const body = byId("orderEditorLinesBody");
    if (!body) return;

    body.querySelectorAll("[data-oe-product], [data-oe-qty]").forEach(input => {
body.querySelectorAll("[data-oe-manual-warehouse], [data-oe-manual-transport], [data-oe-manual-packages], [data-oe-manual-volume], [data-oe-manual-weight], [data-oe-qty]").forEach(input => {
  input.addEventListener("input", () => refreshSummary());
  input.addEventListener("change", () => refreshSummary());
});
      input.addEventListener("input", () => refreshRow(input.closest("tr")));
      input.addEventListener("change", () => refreshRow(input.closest("tr")));
    });

    body.querySelectorAll("[data-oe-remove]").forEach(button => {
      button.addEventListener("click", () => {
        const row = button.closest("tr");
        if (!row) return;

        const lineId = row.getAttribute("data-oe-line-id");
        const isNew = row.dataset.oeNew === "1";

        if (lineId && !isNew) removedLineIds.add(String(lineId));
        row.remove();
        refreshSummary();
      });
    });

    body.querySelectorAll("tr[data-oe-line-id]").forEach(refreshRow);
  }

  function addLine() {
    const body = byId("orderEditorLinesBody");
    if (!body) return;

    body.insertAdjacentHTML("beforeend", rowHtml(null));
    bindRows();
    refreshSummary();
  }

function manualRowHtml() {
  const rowId = `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `
    <tr data-oe-line-id="${escapeHtml(rowId)}" data-oe-new="1" data-oe-manual="1">
      <td><strong>Manual product</strong></td>
      <td><input class="input" data-oe-description placeholder="Description"></td>
      <td><input class="input" type="number" min="1" step="1" data-oe-qty value="1"></td>
      <td><input class="input" type="number" min="0" step="1" data-oe-manual-packages placeholder="0"></td>
      <td><input class="input" type="number" min="0" step="0.01" data-oe-manual-volume placeholder="0.00"></td>
      <td><input class="input" type="number" min="0" step="0.01" data-oe-manual-weight placeholder="0.00"></td>
      <td>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;min-width:210px;">
          <input class="input" type="number" min="0" step="0.01" data-oe-manual-warehouse placeholder="Warehouse £">
          <input class="input" type="number" min="0" step="0.01" data-oe-manual-transport placeholder="Transport £">
        </div>
      </td>
      <td style="text-align:right;">
        <button class="mini-btn" type="button" data-oe-remove>Remove</button>
      </td>
    </tr>
  `;
}

function addManualLine() {
  const body = byId("orderEditorLinesBody");
  if (!body) return;

  body.insertAdjacentHTML("beforeend", manualRowHtml());
  bindRows();
  refreshSummary();
}

  function openModal(order) {
    ensureStyles();
    removedLineIds = new Set();

    const modal = byId("occGenericActionModal");
    const body = byId("genericActionBody");
    const saveBtn = byId("genericActionSaveBtn");

    if (!modal || !body || !saveBtn) {
      throw new Error("Generic action modal is missing in HTML.");
    }

    if (byId("genericActionOrderId")) byId("genericActionOrderId").value = order.id;
    if (byId("genericActionType")) byId("genericActionType").value = "external_order_editor";
    const title = byId("genericActionTitle");
    const sub = byId("genericActionSub");
    if (title) title.textContent = "Edit Order";
    if (sub) sub.textContent = `${order.order_number || "Order"} · ${order.retail_name || order.retailer_name || ""} · ${order.delivery_postcode || ""}`;

    saveBtn.style.display = "";
    saveBtn.textContent = "Save Order";

    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];

    body.innerHTML = `
      <div class="oe-grid" style="position:relative;">
        <div id="orderEditorLoading" class="oe-loading" style="display:none;">Saving order...</div>

        <section class="oe-section">
          <h3>Retailer / Customer</h3>
          <div class="oe-fields">
            <div class="oe-field">
              <label>Product Owner</label>
              <input class="input" value="${escapeHtml(order.customers?.name || order.product_owner_name || "")}" readonly>
            </div>
            <div class="oe-field">
              <label>Retailer Name</label>
              <input id="oeRetailerName" class="input" value="${escapeHtml(order.retail_name || order.retailer_name || "")}">
            </div>
            <div class="oe-field">
              <label>Retailer Code</label>
              <input id="oeRetailerCode" class="input" value="${escapeHtml(order.retailer_code || "")}">
            </div>
          </div>
        </section>

        <section class="oe-section">
          <h3>Delivery Address</h3>
          <div class="oe-fields">
            <div class="oe-field"><label>Address line 1</label><input id="oeAddress1" class="input" value="${escapeHtml(order.delivery_address_1 || "")}"></div>
            <div class="oe-field"><label>Address line 2</label><input id="oeAddress2" class="input" value="${escapeHtml(order.delivery_address_2 || "")}"></div>
            <div class="oe-field"><label>Address line 3</label><input id="oeAddress3" class="input" value="${escapeHtml(order.delivery_address_3 || "")}"></div>
            <div class="oe-field"><label>Address line 4</label><input id="oeAddress4" class="input" value="${escapeHtml(order.delivery_address_4 || "")}"></div>
            <div class="oe-field"><label>City</label><input id="oeCity" class="input" value="${escapeHtml(order.delivery_city || "")}"></div>
            <div class="oe-field"><label>Postcode</label><input id="oePostcode" class="input" value="${escapeHtml(order.delivery_postcode || "")}"></div>
            <div class="oe-field"><label>Country</label><input id="oeCountry" class="input" value="${escapeHtml(order.delivery_country || "United Kingdom")}"></div>
          </div>
        </section>

        <section class="oe-section">
          <h3>Products</h3>
          <div class="oe-table-wrap">
            <table class="oe-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Packages</th>
                  <th>Volume</th>
                  <th>Weight</th>
<th>Revenue</th>
<th></th>
                </tr>
              </thead>
              <tbody id="orderEditorLinesBody">
                ${lines.map(line => rowHtml(line)).join("")}
              </tbody>
            </table>
          </div>
          <div class="oe-actions">
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
  <button id="orderEditorAddLine" class="btn btn-secondary" type="button">+ Add product</button>
  <button id="orderEditorAddManualLine" class="btn btn-secondary" type="button">+ Add manual product</button>
</div>
            <div id="orderEditorSummary" class="oe-summary">0 packages · 0.00 m³ · 0.00 kg</div>
          </div>
        </section>

        <section class="oe-section">
          <h3>Memo / Notes</h3>
          <textarea id="oeMemo" class="input" style="min-height:110px;">${escapeHtml(order.memo || "")}</textarea>
        </section>

        <section class="oe-section">
          <h3>Save Options</h3>
          <label class="select-all-wrap">
            <input id="oeRunMatching" type="checkbox" checked>
            <span>Re-run order matching after saving</span>
          </label>
          <p class="oe-help">Remove zet gekoppelde voorraad terug naar in_stock via Supabase RPC en verwijdert daarna de orderregel.</p>
        </section>
      </div>
    `;

    byId("orderEditorAddLine")?.addEventListener("click", addLine);
byId("orderEditorAddManualLine")?.addEventListener("click", addManualLine);
    bindRows();
    refreshSummary();

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  async function insertActivity(orderId, description, type = "edit_order") {
    try {
      await client.from("order_activity_log").insert({
        order_id: orderId,
        activity_type: type,
        description,
        created_by: currentUser?.id || currentProfile?.id || null,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.warn("Order activity skipped:", error.message);
    }
  }

async function invalidateEditableDocuments(orderId) {
  const { error } = await client
    .from("order_documents")
    .delete()
    .eq("order_id", orderId)
    .in("document_type", ["acknowledgement", "delivery_note"]);

  if (error) throw error;
}

  async function neutralizeOrderLine(orderId, lineId) {
    const { data, error } = await client.rpc("neutralize_order_line", {
      p_order_id: orderId,
      p_order_line_id: lineId
    });

    if (error) throw error;
    return data || { ok: true, released_allocations: 0 };
  }

  function getRows() {
    return Array.from(document.querySelectorAll("#orderEditorLinesBody tr[data-oe-line-id]"));
  }

function linePayloadFromRow(order, row) {
  const isManual = row.dataset.oeManual === "1";
  const qty = Math.max(0, Math.round(toNumber(row.querySelector("[data-oe-qty]")?.value, 0)));
  const description = row.querySelector("[data-oe-description]")?.value || "";

  if (qty <= 0) return null;

if (isManual) {
  const packages = Math.max(0, Math.round(toNumber(row.querySelector("[data-oe-manual-packages]")?.value, 0)));
  const volume = round2(toNumber(row.querySelector("[data-oe-manual-volume]")?.value, 0));
  const weight = round2(toNumber(row.querySelector("[data-oe-manual-weight]")?.value, 0));
  const warehouse = round2(toNumber(row.querySelector("[data-oe-manual-warehouse]")?.value, 0));
  const transport = round2(toNumber(row.querySelector("[data-oe-manual-transport]")?.value, 0));
  const total = round2(warehouse + transport);

  return {
    order_id: order.id,
    product_id: null,
    sku_base: "MANUAL",
    description: description || "Manual product",
    quantity_ordered: qty,

    line_type: "manual",
    manual_description: description || "Manual product",
    manual_amount_gbp: total,

    unit_volume_m3: volume,
    total_volume_m3: volume,
    total_line_volume_m3: volume,

    unit_weight_kg: weight,
    total_line_weight_kg: weight,
    total_packages: packages,

    tariff_storage: warehouse,
    tariff_admin: 0,
    tariff_handling: 0,
    tariff_transport: transport,
    total_customer_charge: total
  };
}

  const product = productFromRow(row);
  if (!product) return null;

  const lineVolume = round2(qty * product.volume);
  const lineWeight = round2(qty * product.weight);

  const storageTotal = round2(product.storageTariff * qty);
  const adminTotal = round2(product.adminTariff * qty);
  const handlingTotal = round2(product.handlingTariff * qty);
  const transportTotal = round2(product.transportTariff * qty);

  const calculatedTotal = round2(storageTotal + adminTotal + handlingTotal + transportTotal);
  const customerTotal = product.customerCharge > 0
    ? round2(product.customerCharge * qty)
    : calculatedTotal;

  return {
    order_id: order.id,
    product_id: product.id,
    sku_base: product.sku,
    description: description || product.description,
    quantity_ordered: qty,

    unit_volume_m3: round2(product.volume),
    total_volume_m3: lineVolume,
    total_line_volume_m3: lineVolume,

    unit_weight_kg: round2(product.weight),
    total_line_weight_kg: lineWeight,

    tariff_storage: storageTotal,
    tariff_admin: adminTotal,
    tariff_handling: handlingTotal,
    tariff_transport: transportTotal,

    total_customer_charge: customerTotal
  };
}

async function saveLine(order, row) {
  const payload = linePayloadFromRow(order, row);
  if (!payload) return { skipped: true };

  const isNew = row.dataset.oeNew === "1";
  const lineId = row.getAttribute("data-oe-line-id");

  if (isNew) {
    const { error } = await client.from("order_lines").insert(payload);
    if (error) throw error;
    return { added: true };
  }

  const oldLine = (order.order_lines || []).find(line => String(line.id) === String(lineId));
  const oldProductId = oldLine?.product_id || oldLine?.products?.id || "";
  const oldQty = Math.max(0, Math.round(toNumber(oldLine?.quantity_ordered, 0)));

  const productChanged = String(oldProductId) !== String(payload.product_id);
  const qtyChanged = oldQty !== payload.quantity_ordered;

  if (productChanged || qtyChanged) {
    await neutralizeOrderLine(order.id, lineId);

    const { error } = await client.from("order_lines").insert(payload);
    if (error) throw error;

    return { changed: true, productChanged, qtyChanged };
  }

  const { error } = await client
    .from("order_lines")
    .update(payload)
    .eq("id", lineId)
    .eq("order_id", order.id);

  if (error) throw error;
  return { changed: true };
}

function totalsFromRows() {
  let totalVolume = 0;
  let totalWeight = 0;
  let totalPackages = 0;

  getRows().forEach(row => {
    const qty = Math.max(0, Math.round(toNumber(row.querySelector("[data-oe-qty]")?.value, 0)));

    if (row.dataset.oeManual === "1") {
      totalPackages += Math.max(0, Math.round(toNumber(row.querySelector("[data-oe-manual-packages]")?.value, 0)));
      totalVolume += toNumber(row.querySelector("[data-oe-manual-volume]")?.value, 0);
      totalWeight += toNumber(row.querySelector("[data-oe-manual-weight]")?.value, 0);
      return;
    }

    const product = productFromRow(row);
    if (!product || qty <= 0) return;

    totalPackages += qty * product.packages;
    totalVolume += qty * product.volume;
    totalWeight += qty * product.weight;
  });

  return {
    totalVolume: round2(totalVolume),
    totalWeight: round2(totalWeight),
    totalPackages
  };
}

async function recalculateOrderFinance(orderId) {
  const { data: lines, error } = await client
    .from("order_lines")
    .select(`
      tariff_storage,
      tariff_admin,
      tariff_handling,
      tariff_transport,
      total_customer_charge
    `)
    .eq("order_id", orderId);

  if (error) throw error;

  const totals = (lines || []).reduce((acc, line) => {
    acc.storage += toNumber(line.tariff_storage, 0);
    acc.admin += toNumber(line.tariff_admin, 0);
    acc.handling += toNumber(line.tariff_handling, 0);
    acc.transport += toNumber(line.tariff_transport, 0);
    acc.customer += toNumber(line.total_customer_charge, 0);
    return acc;
  }, {
    storage: 0,
    admin: 0,
    handling: 0,
    transport: 0,
    customer: 0
  });

  return {
    storage: round2(totals.storage),
    admin: round2(totals.admin),
    handling: round2(totals.handling),
    transport: round2(totals.transport),
    customer: round2(totals.customer)
  };
}

  async function runMatching(orderId) {
    if (!byId("oeRunMatching")?.checked) return { skipped: true };
    if (!window.AllocationEngine?.run) throw new Error("AllocationEngine is not loaded.");

    return await window.AllocationEngine.run({
      orderIds: [orderId],
      dryRun: false
    });
  }

  async function save() {
    if (saving) return;
    if (!currentOrder?.id) throw new Error("No order loaded in editor.");

    saving = true;
    const loading = byId("orderEditorLoading");
    const saveBtn = byId("genericActionSaveBtn");
    const oldText = saveBtn?.textContent || "Save Order";

    try {
      if (loading) loading.style.display = "flex";
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
      }

      const order = currentOrder;

      await client
        .from("orders")
        .update({
          retail_name: byId("oeRetailerName")?.value || "",
          retailer_code: byId("oeRetailerCode")?.value || "",
          delivery_address_1: byId("oeAddress1")?.value || "",
          delivery_address_2: byId("oeAddress2")?.value || "",
          delivery_address_3: byId("oeAddress3")?.value || "",
          delivery_address_4: byId("oeAddress4")?.value || "",
          delivery_city: byId("oeCity")?.value || "",
          delivery_postcode: byId("oePostcode")?.value || "",
          delivery_country: byId("oeCountry")?.value || "United Kingdom",
          memo: byId("oeMemo")?.value || "",
          last_activity_at: new Date().toISOString()
        })
        .eq("id", order.id);

      let removed = 0;
      let released = 0;
      let added = 0;
      let changed = 0;

      for (const lineId of removedLineIds) {
        const result = await neutralizeOrderLine(order.id, lineId);
        removed++;
        released += toNumber(result?.released_allocations, 0);
      }

      for (const row of getRows()) {
        const result = await saveLine(order, row);
        if (result?.added) added++;
        if (result?.changed) changed++;
      }

const totals = totalsFromRows();
const financeTotals = await recalculateOrderFinance(order.id);
await invalidateEditableDocuments(order.id);
console.log("Finance totals:", financeTotals);

await client
  .from("orders")
.update({
  planning_volume_m3: totals.totalVolume,
  volume_m3: totals.totalVolume,
  total_order_volume_m3: totals.totalVolume,

  weight_kg: totals.totalWeight,
  total_order_weight_kg: totals.totalWeight,

  planning_colli: totals.totalPackages,

  total_storage_tariff: financeTotals.storage,
  total_admin_tariff: financeTotals.admin,
  total_handling_tariff: financeTotals.handling,
  total_transport_tariff: financeTotals.transport,
  total_customer_charge: financeTotals.customer,
  finance_status: "not_invoiced",

  warehouse_status: "awaiting_goods",
  overall_status: "awaiting_goods",
  last_activity_at: new Date().toISOString()
})        .eq("id", order.id);

await insertActivity(
  order.id,
  `Order edited in OCC. ACK and Delivery Note invalidated. Finance recalculated.`,
  "edit_order"
);

let matchInfo = "";
try {
  const matchResult = await runMatching(order.id);
  if (!matchResult?.skipped) {
    matchInfo = " Matching completed.";
    await insertActivity(order.id, "Matching executed after order edit.", "edit_order_matching");
  }
} catch (error) {
  await insertActivity(order.id, `Matching after edit failed: ${error.message}`, "edit_order_matching_failed");
  throw error;
}

byId("occGenericActionModal")?.classList.remove("open");
byId("occGenericActionModal")?.setAttribute("aria-hidden", "true");

showToast(`Order saved.${matchInfo}`, "ok");

if (typeof window.OCCReloadOrders === "function") {
  await window.OCCReloadOrders();
} else {
  window.location.reload();
}
} finally {
  saving = false;
  if (loading) loading.style.display = "none";
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = oldText;
  }
}
}
  async function open(orderId) {
    try {
      ensureClient();
      const order = await fetchOrder(orderId);
      await fetchProducts(order);
      openModal(order);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not open order editor.", "err");
    }
  }

  function bindSaveButton() {
    document.addEventListener("click", event => {
      const button = event.target.closest("#genericActionSaveBtn");
      if (!button) return;

      const action = byId("genericActionType")?.value || "";
      if (action !== "external_order_editor") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      save().catch(error => {
        console.error(error);
        showToast(error.message || "Could not save order.", "err");
      });
    }, true);
  }

  bindSaveButton();

  window.OrderEditor = {
    open,
    save
  };
})();