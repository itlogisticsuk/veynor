(function () {
  "use strict";

  let client = null;

  let activeOrderId = "";
  let activeOrderLineId = "";

  let activeOrder = null;
  let activeOrderLine = null;
  let activePriority = null;
  let stockOptions = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error(
        "Supabase helper sb() is not available."
      );
    }

    client = sb();
    return client;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[character])
    );
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toNumber(value, fallback = 0) {
    const number = Number(
      String(value ?? "").replace(",", ".")
    );

    return Number.isFinite(number)
      ? number
      : fallback;
  }

  function formatNumber(value, digits = 0) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return number.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function showToast(message, type = "ok") {
    const toast = byId("toast");

    if (!toast) {
      if (type === "err") {
        console.error(message);
      } else {
        console.log(message);
      }

      return;
    }

    toast.textContent = message || "";
    toast.className = `notice ${type}`;

    clearTimeout(
      window.__stockPriorityToastTimer
    );

    window.__stockPriorityToastTimer =
      window.setTimeout(() => {
        toast.textContent = "";
        toast.className = "notice";
      }, 6500);
  }

  function getOrderFromOcc(orderId) {
    if (
      typeof window.getOrderById === "function"
    ) {
      return window.getOrderById(orderId);
    }

    return null;
  }

  function getLineFromOrder(order, orderLineId) {
    return (order?.order_lines || []).find(
      line =>
        String(line.id) ===
        String(orderLineId)
    ) || null;
  }

  function getLineSku(line) {
    return cleanText(
      line?.sku_base ||
      line?.products?.sku_base ||
      "Unknown SKU"
    );
  }

  function getLineDescription(line) {
    return cleanText(
      line?.description ||
      line?.products?.description ||
      line?.products?.name ||
      "No product description"
    );
  }

function getPriorityRows(line) {
  const value =
    line?.order_line_stock_priorities;

  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return [value];
  }

  return [];
}

function getCurrentPriority(line) {
  return getPriorityRows(line).find(
    row =>
      ["active", "fulfilled"].includes(
        normalize(row.priority_status)
      )
  ) || null;
}
  function priorityLabel(level) {
    const value = Math.round(
      toNumber(level, 0)
    );

    if (value === 200) return "Critical";
    if (value === 100) return "Priority";

    return "Normal";
  }

  function priorityClass(level) {
    const value = Math.round(
      toNumber(level, 0)
    );

    if (value === 200) return "critical";
    if (value === 100) return "priority";

    return "normal";
  }

  function stockSourceLabel(option) {
    if (
      normalize(option?.source_kind) === "free"
    ) {
      return "Free stock";
    }

    return option?.source_order_number
      ? `Reserved on ${option.source_order_number}`
      : "Reserved stock";
  }

  function orderStatusLabel(value) {
    const text = cleanText(value);

    if (!text) return "—";

    return text
      .replaceAll("_", " ")
      .replace(/\b\w/g, character =>
        character.toUpperCase()
      );
  }

  function ensureStyles() {
    if (byId("stockPriorityToolStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "stockPriorityToolStyles";

    style.textContent = `
      .stock-priority-modal-backdrop{
        position:fixed;
        inset:0;
        z-index:12000;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:rgba(15,23,42,.58);
      }

      .stock-priority-modal{
        width:min(1080px,96vw);
        max-height:92vh;
        display:flex;
        flex-direction:column;
        overflow:hidden;
        border:1px solid #dce5f2;
        border-radius:18px;
        background:#fff;
        box-shadow:0 28px 80px rgba(15,23,42,.30);
      }

      .stock-priority-modal-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:18px;
        padding:20px 22px;
        border-bottom:1px solid #dce5f2;
        background:#fff;
      }

      .stock-priority-modal-head h2{
        margin:0 0 5px;
        color:#07152f;
        font-size:21px;
      }

      .stock-priority-modal-sub{
        color:#64748b;
        font-size:12px;
        line-height:1.5;
      }

      .stock-priority-close{
        width:38px;
        height:38px;
        flex:0 0 38px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border:1px solid #dce5f2;
        border-radius:10px;
        background:#fff;
        color:#334155;
        font-size:25px;
        line-height:1;
        cursor:pointer;
      }

      .stock-priority-close:hover{
        background:#f1f5f9;
        color:#0f172a;
      }

      .stock-priority-modal-body{
        flex:1 1 auto;
        min-height:0;
        padding:20px 22px;
        overflow:auto;
        background:#f8fafc;
      }

      .stock-priority-summary{
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:12px;
        margin-bottom:16px;
      }

      .stock-priority-summary-card{
        min-width:0;
        padding:12px 14px;
        border:1px solid #dce5f2;
        border-radius:12px;
        background:#fff;
      }

      .stock-priority-summary-card span{
        display:block;
        margin-bottom:4px;
        color:#64748b;
        font-size:10px;
        font-weight:900;
        letter-spacing:.05em;
        text-transform:uppercase;
      }

      .stock-priority-summary-card strong{
        display:block;
        overflow:hidden;
        color:#0f172a;
        font-size:14px;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .stock-priority-section{
        margin-top:16px;
        padding:16px;
        border:1px solid #dce5f2;
        border-radius:14px;
        background:#fff;
      }

      .stock-priority-section-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:14px;
        margin-bottom:12px;
      }

      .stock-priority-section-head h3{
        margin:0 0 3px;
        color:#0f172a;
        font-size:15px;
      }

      .stock-priority-help{
        color:#64748b;
        font-size:11px;
        line-height:1.45;
      }

      .stock-priority-form-grid{
        display:grid;
        grid-template-columns:220px minmax(0,1fr) auto;
        gap:12px;
        align-items:end;
      }

      .stock-priority-field{
        display:grid;
        gap:5px;
      }

      .stock-priority-field label{
        color:#475569;
        font-size:10px;
        font-weight:900;
        text-transform:uppercase;
      }

      .stock-priority-field select,
      .stock-priority-field input{
        width:100%;
        min-height:40px;
        border:1px solid #cbd5e1;
        border-radius:9px;
        padding:8px 10px;
        background:#fff;
        color:#0f172a;
        font-size:12px;
      }

      .stock-priority-save{
        min-height:40px;
        padding:8px 15px;
        border:1px solid #1d4ed8;
        border-radius:9px;
        background:#2563eb;
        color:#fff;
        font-size:12px;
        font-weight:900;
        cursor:pointer;
      }

      .stock-priority-save:hover{
        background:#1d4ed8;
      }

      .stock-priority-save:disabled{
        cursor:wait;
        opacity:.65;
      }

      .stock-priority-current{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:23px;
        padding:3px 9px;
        border:1px solid transparent;
        border-radius:999px;
        font-size:10px;
        font-weight:950;
        text-transform:uppercase;
      }

      .stock-priority-current.normal{
        border-color:#cbd5e1;
        background:#f8fafc;
        color:#475569;
      }

      .stock-priority-current.priority{
        border-color:#fdba74;
        background:#fff7ed;
        color:#9a3412;
      }

      .stock-priority-current.critical{
        border-color:#fca5a5;
        background:#fef2f2;
        color:#991b1b;
      }

      .stock-priority-options{
        display:grid;
        gap:10px;
      }

      .stock-priority-option{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        gap:16px;
        align-items:center;
        padding:13px 14px;
        border:1px solid #dce5f2;
        border-radius:12px;
        background:#fff;
      }

      .stock-priority-option.free{
        border-color:#bbf7d0;
        background:#f0fdf4;
      }

      .stock-priority-option.allowed{
        border-color:#fed7aa;
        background:#fffaf0;
      }

      .stock-priority-option.blocked{
        background:#f8fafc;
        opacity:.78;
      }

      .stock-priority-option-title{
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:7px;
        margin-bottom:5px;
      }

      .stock-priority-option-title strong{
        color:#0f172a;
        font-size:13px;
      }

      .stock-priority-option-badge{
        display:inline-flex;
        padding:2px 7px;
        border-radius:999px;
        background:#e2e8f0;
        color:#475569;
        font-size:9px;
        font-weight:950;
        text-transform:uppercase;
      }

      .stock-priority-option.free
      .stock-priority-option-badge{
        background:#dcfce7;
        color:#166534;
      }

      .stock-priority-option.allowed
      .stock-priority-option-badge{
        background:#ffedd5;
        color:#9a3412;
      }

      .stock-priority-option-meta{
        display:flex;
        flex-wrap:wrap;
        gap:4px 14px;
        color:#64748b;
        font-size:11px;
        line-height:1.5;
      }

      .stock-priority-block-reason{
        display:block;
        margin-top:5px;
        color:#b91c1c;
        font-size:10px;
        font-weight:850;
      }

      .stock-priority-move-btn{
        min-width:130px;
        min-height:36px;
        padding:7px 11px;
        border:1px solid #cbd5e1;
        border-radius:9px;
        background:#fff;
        color:#334155;
        font-size:11px;
        font-weight:900;
        cursor:pointer;
      }

      .stock-priority-option.free
      .stock-priority-move-btn{
        border-color:#16a34a;
        background:#16a34a;
        color:#fff;
      }

      .stock-priority-option.allowed
      .stock-priority-move-btn{
        border-color:#ea580c;
        background:#fff;
        color:#c2410c;
      }

      .stock-priority-move-btn:disabled{
        cursor:not-allowed;
        border-color:#d1d5db;
        background:#f1f5f9;
        color:#94a3b8;
      }

      .stock-priority-empty,
      .stock-priority-loading{
        padding:24px;
        border:1px dashed #cbd5e1;
        border-radius:11px;
        background:#f8fafc;
        color:#64748b;
        text-align:center;
        font-size:12px;
      }

      .stock-priority-modal-footer{
        display:flex;
        justify-content:flex-end;
        gap:10px;
        padding:14px 22px;
        border-top:1px solid #dce5f2;
        background:#fff;
      }

      .stock-priority-footer-btn{
        min-height:38px;
        padding:7px 14px;
        border:1px solid #cbd5e1;
        border-radius:9px;
        background:#fff;
        color:#334155;
        font-size:12px;
        font-weight:850;
        cursor:pointer;
      }

      .stock-priority-confirm{
        position:fixed;
        inset:0;
        z-index:13000;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:rgba(15,23,42,.64);
      }

      .stock-priority-confirm-card{
        width:min(540px,96vw);
        padding:20px;
        border-radius:16px;
        background:#fff;
        box-shadow:0 24px 70px rgba(15,23,42,.30);
      }

      .stock-priority-confirm-card h3{
        margin:0 0 8px;
        color:#0f172a;
      }

      .stock-priority-confirm-card p{
        margin:0;
        color:#475569;
        font-size:12px;
        line-height:1.6;
      }

      .stock-priority-confirm-warning{
        margin-top:12px;
        padding:10px 12px;
        border:1px solid #fed7aa;
        border-radius:10px;
        background:#fff7ed;
        color:#9a3412;
        font-size:11px;
        font-weight:850;
      }

      .stock-priority-confirm-actions{
        display:flex;
        justify-content:flex-end;
        gap:9px;
        margin-top:18px;
      }

      @media(max-width:780px){
        .stock-priority-modal-backdrop{
          padding:10px;
        }

        .stock-priority-modal{
          width:100%;
          max-height:96vh;
        }

        .stock-priority-summary{
          grid-template-columns:repeat(2,minmax(0,1fr));
        }

        .stock-priority-form-grid{
          grid-template-columns:1fr;
        }

        .stock-priority-option{
          grid-template-columns:1fr;
        }

        .stock-priority-move-btn{
          width:100%;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createModal() {
    let modal = byId("stockPriorityModal");

    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "stockPriorityModal";
    modal.className =
      "stock-priority-modal-backdrop";

    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <section
        class="stock-priority-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stockPriorityModalTitle"
      >
        <div class="stock-priority-modal-head">
          <div>
            <h2 id="stockPriorityModalTitle">
              Stock Priority
            </h2>

            <div
              id="stockPriorityModalSub"
              class="stock-priority-modal-sub"
            >
              Loading order line...
            </div>
          </div>

          <button
            class="stock-priority-close"
            type="button"
            data-close-stock-priority
            aria-label="Close Stock Priority"
          >
            ×
          </button>
        </div>

        <div
          id="stockPriorityModalBody"
          class="stock-priority-modal-body"
        >
          <div class="stock-priority-loading">
            Loading stock priority...
          </div>
        </div>

        <div class="stock-priority-modal-footer">
          <button
            class="stock-priority-footer-btn"
            type="button"
            data-close-stock-priority
          >
            Close
          </button>
        </div>
      </section>
    `;

    modal.addEventListener("click", event => {
      if (
        event.target === modal ||
        event.target.closest(
          "[data-close-stock-priority]"
        )
      ) {
        close();
      }
    });

    document.body.appendChild(modal);

    return modal;
  }

  function close() {
    const modal = byId("stockPriorityModal");

    if (!modal) return;

    modal.remove();

    document.removeEventListener(
      "keydown",
      handleEscape
    );

    activeOrderId = "";
    activeOrderLineId = "";
    activeOrder = null;
    activeOrderLine = null;
    activePriority = null;
    stockOptions = [];
  }

  function handleEscape(event) {
    if (event.key === "Escape") {
      close();
    }
  }

  async function reloadOcc() {
    if (
      typeof window.OCCReloadOrders === "function"
    ) {
      await window.OCCReloadOrders();
    }
  }

  async function loadLineFromDatabase(
    orderId,
    orderLineId
  ) {
    const db = ensureClient();

    const { data, error } = await db
      .from("order_lines")
      .select(`
        id,
        order_id,
        product_id,
        sku_base,
        description,
        quantity_ordered,
        quantity_allocated,
        matched_quantity,
        packages_per_unit,
        total_packages,
        requested_package_no,
        requested_package_total,
products (
  id,
  sku_base,
  name,
  description,
  package_count,
  packages_per_unit,
  package_1_qty,
  package_2_qty,
  package_3_qty
),
order_allocations (
  id,
  allocation_status,
  item_id,
  items (
    id,
    package_no,
    package_total,
    stock_set_id,
    physical_product_id
  )
),
        order_line_stock_priorities (
          id,
          priority_level,
          priority_status,
          reason,
          created_at,
          updated_at,
          fulfilled_at
        ),
        orders (
          id,
          order_number,
          external_reference,
          purchase_order,
          status,
          warehouse_status,
          transport_status,
          finance_status,
          overall_status,
          route_id,
          carrier_vehicle_id,
          retail_name,
          retailer_name,
          delivery_postcode
        )
      `)
      .eq("id", orderLineId)
      .eq("order_id", orderId)
      .maybeSingle();

    if (error) throw error;

    if (!data?.id) {
      throw new Error(
        "Order line was not found."
      );
    }

    return data;
  }

  async function loadStockOptions(orderLineId) {
    const db = ensureClient();

    const { data, error } = await db.rpc(
      "get_order_line_stock_options",
      {
        p_order_line_id: orderLineId
      }
    );

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  function calculateRequiredPackages(line) {
  const quantity = Math.max(
    0,
    Math.round(toNumber(line?.quantity_ordered, 0))
  );

  if (
    toNumber(line?.requested_package_no, 0) > 0 &&
    toNumber(line?.requested_package_total, 0) > 0
  ) {
    return quantity;
  }

  const explicitTotal = Math.round(
    toNumber(line?.total_packages, 0)
  );

  if (explicitTotal > 0) {
    return explicitTotal;
  }

  const product = line?.products || {};

  let packagesPerUnit = Math.round(
    toNumber(
      line?.packages_per_unit ||
      product.packages_per_unit ||
      product.package_count,
      0
    )
  );

  if (packagesPerUnit <= 0) {
    packagesPerUnit = [
      product.package_1_qty,
      product.package_2_qty,
      product.package_3_qty
    ].filter(value => toNumber(value, 0) > 0).length;
  }

  return quantity * Math.max(1, packagesPerUnit || 1);
}

  function calculateAllocatedPackages(line) {
  const allocations = Array.isArray(line?.order_allocations)
    ? line.order_allocations
    : [];

  const activeAllocations = allocations.filter(allocation =>
    !["cancelled"].includes(
      normalize(allocation.allocation_status)
    )
  );

  if (
    toNumber(line?.requested_package_no, 0) > 0 &&
    toNumber(line?.requested_package_total, 0) > 0
  ) {
    return activeAllocations.length;
  }

  return activeAllocations.reduce((total, allocation) => {
    return total + Math.max(
      1,
      Math.round(
        toNumber(allocation.items?.package_total, 1)
      )
    );
  }, 0);
}

  function renderStockOption(option) {
    const isFree =
      normalize(option.source_kind) === "free";

    const canMove = option.can_move === true;

    const optionClass = isFree
      ? "free"
      : canMove
        ? "allowed"
        : "blocked";

    const buttonLabel = isFree
      ? "Assign stock"
      : "Move allocation";

    const sourceOrder =
      option.source_order_number || "—";

    return `
      <article
        class="stock-priority-option ${optionClass}"
      >
        <div>
          <div class="stock-priority-option-title">
            <strong>
              ${escapeHtml(
                stockSourceLabel(option)
              )}
            </strong>

            <span class="stock-priority-option-badge">
              ${
                isFree
                  ? "Available"
                  : canMove
                    ? "Can move"
                    : "Blocked"
              }
            </span>
          </div>

          <div class="stock-priority-option-meta">
            <span>
              Packages:
              <strong>
                ${formatNumber(
                  option.package_count,
                  0
                )}
              </strong>
            </span>

            <span>
              Complete set:
              <strong>
                ${formatNumber(
                  option.package_total,
                  0
                )}
              </strong>
            </span>

            <span>
              Volume:
              <strong>
                ${formatNumber(
                  option.volume_m3,
                  2
                )} m³
              </strong>
            </span>

            <span>
              Weight:
              <strong>
                ${formatNumber(
                  option.weight_kg,
                  2
                )} kg
              </strong>
            </span>

            ${
              !isFree
                ? `
                  <span>
                    Source:
                    <strong>
                      ${escapeHtml(sourceOrder)}
                    </strong>
                  </span>

                  <span>
                    Warehouse:
                    <strong>
                      ${escapeHtml(
                        orderStatusLabel(
                          option.source_warehouse_status
                        )
                      )}
                    </strong>
                  </span>

                  <span>
                    Transport:
                    <strong>
                      ${escapeHtml(
                        orderStatusLabel(
                          option.source_transport_status
                        )
                      )}
                    </strong>
                  </span>
                `
                : ""
            }
          </div>

          ${
            !canMove && option.blocked_reason
              ? `
                <span class="stock-priority-block-reason">
                  ${escapeHtml(
                    option.blocked_reason
                  )}
                </span>
              `
              : ""
          }
        </div>

        <button
          class="stock-priority-move-btn"
          type="button"
          data-stock-option-item-id="${escapeHtml(
            option.representative_item_id || ""
          )}"
          data-stock-option-source-kind="${escapeHtml(
            option.source_kind || ""
          )}"
          data-stock-option-source-order="${escapeHtml(
            sourceOrder
          )}"
          ${canMove ? "" : "disabled"}
        >
          ${escapeHtml(buttonLabel)}
        </button>
      </article>
    `;
  }

  function renderModal() {
    const body = byId("stockPriorityModalBody");

    if (!body || !activeOrderLine) {
      return;
    }

    const order =
      activeOrderLine.orders ||
      activeOrder ||
      {};

    const currentLevel = Math.round(
      toNumber(
        activePriority?.priority_level,
        0
      )
    );

    const requiredPackages =
      calculateRequiredPackages(
        activeOrderLine
      );

    const allocatedPackages =
      calculateAllocatedPackages(
        activeOrderLine
      );

    const freeOptions = stockOptions.filter(
      option =>
        normalize(option.source_kind) ===
        "free"
    );

const allocatedOptions =
  stockOptions.filter(option =>
    normalize(option.source_kind) !== "free" &&
    String(option.source_order_line_id || "") !==
      String(activeOrderLineId)
  );

    const movableOptions =
      allocatedOptions.filter(
        option => option.can_move === true
      );

    const blockedOptions =
      allocatedOptions.filter(
        option => option.can_move !== true
      );

    const orderNumber =
      order.order_number ||
      activeOrder?.order_number ||
      "Order";

    const retailer =
      order.retail_name ||
      order.retailer_name ||
      activeOrder?.retailer_name ||
      activeOrder?.retail_name ||
      "—";

    byId("stockPriorityModalSub").textContent =
      `${orderNumber} · ${getLineSku(
        activeOrderLine
      )} · ${retailer}`;

    body.innerHTML = `
      <div class="stock-priority-summary">
        <div class="stock-priority-summary-card">
          <span>Order</span>
          <strong>
            ${escapeHtml(orderNumber)}
          </strong>
        </div>

        <div class="stock-priority-summary-card">
          <span>Product</span>
          <strong>
            ${escapeHtml(
              getLineSku(activeOrderLine)
            )}
          </strong>
        </div>

        <div class="stock-priority-summary-card">
          <span>Required</span>
          <strong>
            ${formatNumber(
              requiredPackages,
              0
            )} packages
          </strong>
        </div>

        <div class="stock-priority-summary-card">
          <span>Allocated</span>
          <strong>
            ${formatNumber(
              allocatedPackages,
              0
            )} packages
          </strong>
        </div>
      </div>

      <section class="stock-priority-section">
        <div class="stock-priority-section-head">
          <div>
            <h3>Priority status</h3>

            <div class="stock-priority-help">
              Set whether incoming free stock should be
              allocated to this product line before normal
              open orders.
            </div>
          </div>

          <span
            class="stock-priority-current ${
              priorityClass(currentLevel)
            }"
          >
            ${escapeHtml(
              priorityLabel(currentLevel)
            )}
          </span>
        </div>

        <div class="stock-priority-form-grid">
          <div class="stock-priority-field">
            <label for="stockPriorityLevel">
              Priority
            </label>

            <select id="stockPriorityLevel">
              <option
                value="0"
                ${currentLevel === 0 ? "selected" : ""}
              >
                Normal
              </option>

              <option
                value="100"
                ${currentLevel === 100 ? "selected" : ""}
              >
                Priority
              </option>

              <option
                value="200"
                ${currentLevel === 200 ? "selected" : ""}
              >
                Critical
              </option>
            </select>
          </div>

          <div class="stock-priority-field">
            <label for="stockPriorityReason">
              Reason / note
            </label>

            <input
              id="stockPriorityReason"
              type="text"
              value="${escapeHtml(
                activePriority?.reason || ""
              )}"
              placeholder="Optional reason for this priority"
            />
          </div>

          <button
            id="btnSaveStockPriority"
            class="stock-priority-save"
            type="button"
          >
            Save Priority
          </button>
        </div>
      </section>

      <section class="stock-priority-section">
        <div class="stock-priority-section-head">
          <div>
            <h3>Free stock</h3>

            <div class="stock-priority-help">
              Complete physical stock that is not currently
              allocated to another order.
            </div>
          </div>

          <span class="stock-priority-option-badge">
            ${formatNumber(
              freeOptions.length,
              0
            )} option(s)
          </span>
        </div>

        <div class="stock-priority-options">
          ${
            freeOptions.length
              ? freeOptions
                  .map(renderStockOption)
                  .join("")
              : `
                <div class="stock-priority-empty">
                  No complete free stock is currently
                  available for this product.
                </div>
              `
          }
        </div>
      </section>

      <section class="stock-priority-section">
        <div class="stock-priority-section-head">
          <div>
            <h3>Reserved stock that may be moved</h3>

            <div class="stock-priority-help">
              Stock allocated to another open order. Moving
              it will make the source order incomplete.
            </div>
          </div>

          <span class="stock-priority-option-badge">
            ${formatNumber(
              movableOptions.length,
              0
            )} option(s)
          </span>
        </div>

        <div class="stock-priority-options">
          ${
            movableOptions.length
              ? movableOptions
                  .map(renderStockOption)
                  .join("")
              : `
                <div class="stock-priority-empty">
                  No movable reserved stock was found.
                </div>
              `
          }
        </div>
      </section>

      ${
        blockedOptions.length
          ? `
            <section class="stock-priority-section">
              <div class="stock-priority-section-head">
                <div>
                  <h3>Blocked allocations</h3>

                  <div class="stock-priority-help">
                    These allocations are visible for
                    information but cannot be moved.
                  </div>
                </div>

                <span class="stock-priority-option-badge">
                  ${formatNumber(
                    blockedOptions.length,
                    0
                  )} blocked
                </span>
              </div>

              <div class="stock-priority-options">
                ${blockedOptions
                  .map(renderStockOption)
                  .join("")}
              </div>
            </section>
          `
          : ""
      }
    `;

    bindModalEvents();
  }

  function bindModalEvents() {
    byId("btnSaveStockPriority")
      ?.addEventListener(
        "click",
        savePriority
      );

    document
      .querySelectorAll(
        "[data-stock-option-item-id]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const itemId =
              button.getAttribute(
                "data-stock-option-item-id"
              );

            const sourceKind =
              button.getAttribute(
                "data-stock-option-source-kind"
              );

            const sourceOrder =
              button.getAttribute(
                "data-stock-option-source-order"
              );

            openMoveConfirmation({
              itemId,
              sourceKind,
              sourceOrder
            });
          }
        );
      });
  }

  async function savePriority() {
    const button = byId(
      "btnSaveStockPriority"
    );

    if (!activeOrderLineId) {
      showToast(
        "No order line selected.",
        "err"
      );

      return;
    }

    const level = Math.round(
      toNumber(
        byId("stockPriorityLevel")?.value,
        0
      )
    );

    const reason =
      byId("stockPriorityReason")?.value ||
      null;

    const oldText =
      button?.textContent ||
      "Save Priority";

    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Saving...";
      }

      const db = ensureClient();

      const { error } = await db.rpc(
        "set_order_line_stock_priority",
        {
          p_order_line_id:
            activeOrderLineId,
          p_priority_level: level,
          p_reason: reason
        }
      );

      if (error) throw error;

      await reloadOcc();

      activeOrder =
        getOrderFromOcc(activeOrderId) ||
        activeOrder;

      activeOrderLine =
        getLineFromOrder(
          activeOrder,
          activeOrderLineId
        ) ||
        await loadLineFromDatabase(
          activeOrderId,
          activeOrderLineId
        );

      activePriority =
        getCurrentPriority(
          activeOrderLine
        );

      showToast(
        level === 0
          ? "Stock priority removed."
          : `Stock priority saved as ${priorityLabel(
              level
            )}.`,
        "ok"
      );

      renderModal();
    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
        "Could not save stock priority.",
        "err"
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  function openMoveConfirmation({
    itemId,
    sourceKind,
    sourceOrder
  }) {
    if (!itemId) {
      showToast(
        "Selected stock item is missing.",
        "err"
      );

      return;
    }

    document
      .querySelector(
        ".stock-priority-confirm"
      )
      ?.remove();

    const isFree =
      normalize(sourceKind) === "free";

    const confirmation =
      document.createElement("div");

    confirmation.className =
      "stock-priority-confirm";

    confirmation.innerHTML = `
      <section class="stock-priority-confirm-card">
        <h3>
          ${
            isFree
              ? "Assign free stock?"
              : "Move reserved stock?"
          }
        </h3>

        <p>
          ${
            isFree
              ? `
                This complete stock group will be allocated
                to order
                <strong>
                  ${escapeHtml(
                    activeOrderLine?.orders
                      ?.order_number ||
                    activeOrder?.order_number ||
                    "the priority order"
                  )}
                </strong>.
              `
              : `
                This complete stock group will be moved from
                <strong>
                  ${escapeHtml(
                    sourceOrder ||
                    "the source order"
                  )}
                </strong>
                to
                <strong>
                  ${escapeHtml(
                    activeOrderLine?.orders
                      ?.order_number ||
                    activeOrder?.order_number ||
                    "the priority order"
                  )}
                </strong>.
              `
          }
        </p>

        ${
          !isFree
            ? `
              <div class="stock-priority-confirm-warning">
                The source order will be recalculated and may
                become incomplete after this allocation is
                moved.
              </div>
            `
            : ""
        }

        <div class="stock-priority-confirm-actions">
          <button
            class="stock-priority-footer-btn"
            type="button"
            data-cancel-stock-move
          >
            Cancel
          </button>

          <button
            class="stock-priority-save"
            type="button"
            data-confirm-stock-move
          >
            ${
              isFree
                ? "Assign Stock"
                : "Confirm Reallocation"
            }
          </button>
        </div>
      </section>
    `;

    confirmation.addEventListener(
      "click",
      event => {
        if (
          event.target === confirmation ||
          event.target.closest(
            "[data-cancel-stock-move]"
          )
        ) {
          confirmation.remove();
        }
      }
    );

    confirmation
      .querySelector(
        "[data-confirm-stock-move]"
      )
      ?.addEventListener(
        "click",
        async event => {
          const button = event.currentTarget;

          await moveStock({
            itemId,
            button,
            confirmation,
            isFree
          });
        }
      );

    document.body.appendChild(
      confirmation
    );
  }

  async function moveStock({
    itemId,
    button,
    confirmation,
    isFree
  }) {
    const originalText =
      button?.textContent ||
      "Confirm";

    try {
      if (button) {
        button.disabled = true;
        button.textContent =
          isFree
            ? "Assigning..."
            : "Moving...";
      }

      const db = ensureClient();

      const { data, error } = await db.rpc(
        "move_stock_group_to_priority_line",
        {
          p_target_order_line_id:
            activeOrderLineId,
          p_source_item_id: itemId
        }
      );

      if (error) throw error;

      confirmation?.remove();

      await reloadOcc();

      activeOrder =
        getOrderFromOcc(activeOrderId) ||
        activeOrder;

      activeOrderLine =
        getLineFromOrder(
          activeOrder,
          activeOrderLineId
        ) ||
        await loadLineFromDatabase(
          activeOrderId,
          activeOrderLineId
        );

      activePriority =
        getCurrentPriority(
          activeOrderLine
        );

      stockOptions =
        await loadStockOptions(
          activeOrderLineId
        );

      showToast(
        data?.already_assigned
          ? "This stock was already assigned to the order."
          : isFree
            ? "Free stock assigned to the priority order."
            : "Stock allocation moved to the priority order.",
        "ok"
      );

      renderModal();
    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
        "Could not move the selected stock.",
        "err"
      );

      if (button) {
        button.disabled = false;
        button.textContent =
          originalText;
      }
    }
  }

  async function open({
    orderId,
    orderLineId
  } = {}) {
    if (!orderId || !orderLineId) {
      showToast(
        "Order or order line is missing.",
        "err"
      );

      return;
    }

    activeOrderId = String(orderId);
    activeOrderLineId =
      String(orderLineId);

    ensureClient();
    ensureStyles();

    const modal = createModal();

    document.addEventListener(
      "keydown",
      handleEscape
    );

    modal.setAttribute(
      "aria-hidden",
      "false"
    );

    const body =
      byId("stockPriorityModalBody");

    if (body) {
      body.innerHTML = `
        <div class="stock-priority-loading">
          Loading priority and stock options...
        </div>
      `;
    }

    try {
      activeOrder =
        getOrderFromOcc(activeOrderId);

      activeOrderLine =
        getLineFromOrder(
          activeOrder,
          activeOrderLineId
        );

      if (!activeOrderLine) {
        activeOrderLine =
          await loadLineFromDatabase(
            activeOrderId,
            activeOrderLineId
          );
      }

      activePriority =
        getCurrentPriority(
          activeOrderLine
        );

      stockOptions =
        await loadStockOptions(
          activeOrderLineId
        );

      renderModal();
    } catch (error) {
      console.error(error);

      if (body) {
        body.innerHTML = `
          <div class="stock-priority-empty">
            ${escapeHtml(
              error.message ||
              "Could not load Stock Priority."
            )}
          </div>
        `;
      }

      showToast(
        error.message ||
        "Could not load Stock Priority.",
        "err"
      );
    }
  }

  window.StockPriorityTool = {
    open,
    close
  };
})();