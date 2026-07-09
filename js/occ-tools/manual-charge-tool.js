(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const DEFAULT_FUEL_PERCENTAGE = 8.5;

  let client = null;
  let companyId = null;
  let productOwners = [];

  function db() {
    if (client) return client;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    client = sb();
    return client;
  }

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

  function toNumber(value, fallback = 0) {
    const num = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(num) ? num : fallback;
  }

  function round2(value) {
    return Number(toNumber(value, 0).toFixed(2));
  }

  function formatMoney(value) {
    return `£${round2(value).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeRetailerCode(postcode, retailerName) {
    const pc = String(postcode || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9]/g, "");

    const name = String(retailerName || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3);

    return `${pc || "NOPC"}-${name || "MAN"}`;
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    const { data, error } = await db()
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company ${TENANT_NAME} not found.`);

    companyId = data.id;
    return companyId;
  }

  async function loadProductOwners() {
    if (productOwners.length) return productOwners;

    const cid = await getCompanyId();

    const { data, error } = await db()
      .from("customers")
      .select("id,name,customer_code,customer_type")
      .eq("company_id", cid)
      .order("name", { ascending: true });

    if (error) throw error;

    productOwners = (data || []).filter(row => {
      const text = `${row.name || ""} ${row.customer_code || ""} ${row.customer_type || ""}`.toLowerCase();

      return (
        text.includes("bellstone") ||
        text.includes("zoy") ||
        text.includes("product_owner") ||
        text.includes("product owner")
      );
    });

    if (!productOwners.length) {
      productOwners = data || [];
    }

    return productOwners;
  }

  async function getNextSoNumber() {
    const cid = await getCompanyId();

    const { data, error } = await db()
      .from("settings")
      .select("setting_key,setting_value")
      .eq("company_id", cid)
      .in("setting_key", [
        "sales_order_prefix",
        "sales_order_padding",
        "next_sales_order_number"
      ]);

    if (error) throw error;

    const settings = Object.fromEntries((data || []).map(row => [row.setting_key, row.setting_value]));

    const prefix = settings.sales_order_prefix || "SO-";
    const padding = Number(settings.sales_order_padding || 5);
    const nextNo = Number(settings.next_sales_order_number || 1);

    return {
      orderNumber: prefix + String(nextNo).padStart(padding, "0"),
      nextNo
    };
  }

  async function incrementSoNumber(nextNo) {
    const cid = await getCompanyId();

    const { error } = await db()
      .from("settings")
      .update({ setting_value: String(nextNo + 1) })
      .eq("company_id", cid)
      .eq("setting_key", "next_sales_order_number");

    if (error) throw error;
  }

  function statusPayload(status) {
    if (status === "delivered") {
      return {
        status: "delivered",
        warehouse_status: "delivered",
        transport_status: "delivered",
        overall_status: "delivered",
        confirmed_delivery_date: todayIso(),
        pod_status: "signed"
      };
    }

    if (status === "planned") {
      return {
        status: "planned",
        warehouse_status: "stock_complete",
        transport_status: "planned",
        overall_status: "planned"
      };
    }

    if (status === "stock_complete") {
      return {
        status: "stock_complete",
        warehouse_status: "stock_complete",
        transport_status: "not_required",
        overall_status: "stock_complete"
      };
    }

    return {
      status: "order_received",
      warehouse_status: "order_received",
      transport_status: "not_required",
      overall_status: "order_received"
    };
  }

  function ensureModal() {
    if (byId("manualChargeModal")) return;

    const modal = document.createElement("div");
    modal.id = "manualChargeModal";
    modal.className = "occ-modal tenant-only";
    modal.setAttribute("aria-hidden", "true");

    modal.innerHTML = `
      <div class="occ-modal-card" style="width:min(860px,96vw);">
        <div class="occ-modal-head">
          <div>
            <h2 class="occ-modal-title">Manual Charge</h2>
            <p class="occ-modal-sub">
              Create a manual charge order with optional fuel surcharge, ACK generation and combined invoice support.
            </p>
          </div>
          <button id="manualChargeCloseBtn" class="occ-modal-close" type="button">×</button>
        </div>

        <div class="occ-modal-grid">
          <section class="occ-modal-section">
            <h3>Order details</h3>

            <div class="field">
              <label for="manualChargeOwner">Product Owner</label>
              <select id="manualChargeOwner" class="select">
                <option value="">Loading...</option>
              </select>
            </div>

            <div class="field">
              <label for="manualChargeRetailer">Retailer</label>
              <input id="manualChargeRetailer" class="input" placeholder="Retailer name"/>
            </div>

            <div class="field">
              <label for="manualChargePostcode">Postcode</label>
              <input id="manualChargePostcode" class="input" placeholder="Optional postcode"/>
            </div>

            <div class="field">
              <label for="manualChargeReference">Reference / ACK ref</label>
              <input id="manualChargeReference" class="input" placeholder="Optional reference"/>
            </div>

            <div class="field">
              <label for="manualChargePo">PO</label>
              <input id="manualChargePo" class="input" placeholder="Optional PO"/>
            </div>
          </section>

          <section class="occ-modal-section">
            <h3>Charge line</h3>

            <div class="field">
              <label for="manualChargeDescription">Description</label>
              <textarea id="manualChargeDescription" class="input" placeholder="Example: Additional handling charge"></textarea>
            </div>

            <div class="field">
              <label for="manualChargeAmount">Base amount ex VAT</label>
              <input id="manualChargeAmount" class="input" type="number" step="0.01" min="0" placeholder="0.00"/>
            </div>

            <label style="display:flex;gap:8px;align-items:center;font-size:12px;font-weight:900;">
              <input id="manualChargeFuelEnabled" type="checkbox"/>
              Add fuel surcharge
            </label>

            <div class="field">
              <label for="manualChargeFuelPercentage">Fuel surcharge %</label>
              <input id="manualChargeFuelPercentage" class="input" type="number" step="0.1" min="0" value="${DEFAULT_FUEL_PERCENTAGE}"/>
            </div>

            <div class="field">
              <label for="manualChargeStatus">Order status</label>
              <select id="manualChargeStatus" class="select">
                <option value="order_received">Order received</option>
                <option value="stock_complete" selected>Stock complete</option>
                <option value="planned">On planning</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>

            <div class="quick-action" style="cursor:default;background:#f8fafc;">
              <span>Total charge ex VAT</span>
              <span id="manualChargeTotalPreview">£0.00</span>
            </div>
          </section>
        </div>

        <div class="occ-modal-actions">
          <button id="manualChargeCancelBtn" class="btn" type="button">Cancel</button>
          <button id="manualChargeCreateBtn" class="btn btn-primary" type="button">Create Manual Charge</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    byId("manualChargeCloseBtn")?.addEventListener("click", close);
    byId("manualChargeCancelBtn")?.addEventListener("click", close);

    modal.addEventListener("click", event => {
      if (event.target === modal) close();
    });

    [
      "manualChargeAmount",
      "manualChargeFuelEnabled",
      "manualChargeFuelPercentage"
    ].forEach(id => {
      byId(id)?.addEventListener("input", refreshPreview);
      byId(id)?.addEventListener("change", refreshPreview);
    });

    byId("manualChargeCreateBtn")?.addEventListener("click", async () => {
      try {
        await createManualCharge();
      } catch (error) {
        console.error(error);
        alert(error.message || "Could not create manual charge.");
      }
    });
  }

  async function populateOwners() {
    const owners = await loadProductOwners();
    const select = byId("manualChargeOwner");
    if (!select) return;

    select.innerHTML = owners.map(owner => `
      <option value="${escapeHtml(owner.id)}">
        ${escapeHtml(owner.name || "Product Owner")}
      </option>
    `).join("");

    const bellstone = owners.find(owner => String(owner.name || "").toLowerCase().includes("bellstone"));
    if (bellstone) select.value = bellstone.id;
  }

  function getAmounts() {
    const base = round2(toNumber(byId("manualChargeAmount")?.value, 0));
    const fuelEnabled = !!byId("manualChargeFuelEnabled")?.checked;
    const fuelPct = round2(toNumber(byId("manualChargeFuelPercentage")?.value, DEFAULT_FUEL_PERCENTAGE));
    const fuelAmount = fuelEnabled ? round2(base * (fuelPct / 100)) : 0;
    const total = round2(base + fuelAmount);

    return { base, fuelEnabled, fuelPct, fuelAmount, total };
  }

  function refreshPreview() {
    const { total } = getAmounts();
    const el = byId("manualChargeTotalPreview");
    if (el) el.textContent = formatMoney(total);
  }

  async function open() {
    ensureModal();
    await populateOwners();

    byId("manualChargeRetailer").value = "";
    byId("manualChargePostcode").value = "";
    byId("manualChargeReference").value = "";
    byId("manualChargePo").value = "";
    byId("manualChargeDescription").value = "";
    byId("manualChargeAmount").value = "";
    byId("manualChargeFuelEnabled").checked = false;
    byId("manualChargeFuelPercentage").value = DEFAULT_FUEL_PERCENTAGE;
    byId("manualChargeStatus").value = "stock_complete";

    refreshPreview();

    byId("manualChargeModal")?.classList.add("open");
    byId("manualChargeModal")?.setAttribute("aria-hidden", "false");
  }

  function close() {
    byId("manualChargeModal")?.classList.remove("open");
    byId("manualChargeModal")?.setAttribute("aria-hidden", "true");
  }

  async function createManualCharge() {
    const cid = await getCompanyId();
    const { orderNumber, nextNo } = await getNextSoNumber();

    const ownerId = byId("manualChargeOwner")?.value || "";
    const owner = productOwners.find(row => String(row.id) === String(ownerId));

    if (!owner?.id) throw new Error("Select a product owner.");

    const retailer = cleanText(byId("manualChargeRetailer")?.value || "");
    const postcode = cleanText(byId("manualChargePostcode")?.value || "");
    const reference = cleanText(byId("manualChargeReference")?.value || "");
    const po = cleanText(byId("manualChargePo")?.value || "");
    const description = cleanText(byId("manualChargeDescription")?.value || "");
    const selectedStatus = byId("manualChargeStatus")?.value || "stock_complete";
    const amounts = getAmounts();

    if (!retailer) throw new Error("Enter a retailer name.");
    if (!description) throw new Error("Enter a charge description.");
    if (amounts.base <= 0) throw new Error("Enter an amount higher than 0.");

    const orderId = crypto.randomUUID();
    const statusFields = statusPayload(selectedStatus);

    const orderPayload = {
      id: orderId,
      company_id: cid,
      customer_id: owner.id,
      order_number: orderNumber,
      order_type: "manual_charge",
      source_type: "manual_charge",
      external_reference: reference || null,
      purchase_order: po || null,
      order_date: todayIso(),
      requested_delivery_date: todayIso(),
      finance_status: "not_invoiced",
      planning_release: false,
      planning_colli: 0,
      planning_volume_m3: 0,
      total_order_colli: 0,
      total_order_volume_m3: 0,
      total_customer_charge: amounts.total,
      customer_charge_gbp: amounts.total,
      estimated_revenue_gbp: amounts.total,
      retail_name: retailer,
      retailer_code: makeRetailerCode(postcode, retailer),
      delivery_postcode: postcode || null,
      delivery_country: "United Kingdom",
      memo: [
        "Manual charge created in OCC.",
        `Description: ${description}.`,
        amounts.fuelEnabled
          ? `Fuel surcharge ${amounts.fuelPct}% added: ${formatMoney(amounts.fuelAmount)}.`
          : "No fuel surcharge added."
      ].join(" "),
      notes: `Manual charge base ${formatMoney(amounts.base)}. Total ex VAT ${formatMoney(amounts.total)}.`,
      created_at: nowIso(),
      last_activity_at: nowIso(),
      ...statusFields
    };

    const { error: orderError } = await db()
      .from("orders")
      .insert(orderPayload);

    if (orderError) throw orderError;

    const lines = [
      {
        company_id: cid,
        order_id: orderId,
        line_number: 1,
        sku_base: "MANUAL",
        description,
        quantity_ordered: 1,
        quantity_allocated: 0,
        quantity_shipped: selectedStatus === "delivered" ? 1 : 0,
        line_type: "manual",
        manual_description: description,
        manual_amount_gbp: amounts.base,
        tariff_transport: amounts.base,
        tariff_storage: 0,
        tariff_admin: 0,
        tariff_handling: 0,
        total_customer_charge: amounts.base,
        created_at: nowIso()
      }
    ];

    if (amounts.fuelEnabled && amounts.fuelAmount > 0) {
      lines.push({
        company_id: cid,
        order_id: orderId,
        line_number: 2,
        sku_base: "FUEL",
        description: `Fuel surcharge ${amounts.fuelPct}%`,
        quantity_ordered: 1,
        quantity_allocated: 0,
        quantity_shipped: selectedStatus === "delivered" ? 1 : 0,
        line_type: "manual",
        manual_description: `Fuel surcharge ${amounts.fuelPct}%`,
        manual_amount_gbp: amounts.fuelAmount,
        tariff_transport: amounts.fuelAmount,
        tariff_storage: 0,
        tariff_admin: 0,
        tariff_handling: 0,
        total_customer_charge: amounts.fuelAmount,
        created_at: nowIso()
      });
    }

    const { error: lineError } = await db()
      .from("order_lines")
      .insert(lines);

    if (lineError) throw lineError;

    await db()
      .from("order_activity_log")
      .insert({
        company_id: cid,
        customer_id: owner.id,
        order_id: orderId,
        activity_type: "manual_charge_created",
        new_status: selectedStatus,
        description: `Manual charge created. ${orderNumber} · ${description} · ${formatMoney(amounts.total)}.`,
        created_by: "manual",
        created_at: nowIso()
      });

    await incrementSoNumber(nextNo);

    close();

    if (window.OCCReloadOrders) {
      await window.OCCReloadOrders();
    }

    alert(`Manual charge created: ${orderNumber}`);
  }

  window.ManualChargeTool = {
    open
  };
})();