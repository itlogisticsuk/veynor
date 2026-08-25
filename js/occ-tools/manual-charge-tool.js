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

function getManualChargeLineConfig(type) {
  const value = String(type || "").toLowerCase();

  if (value === "mileage") {
    return {
      description: "Mileage",
      quantityLabel: "Miles",
      rateLabel: "Rate per mile",
      unit: "miles",
      calculated: true
    };
  }

  if (value === "labour") {
    return {
      description: "Man hours",
      quantityLabel: "Hours",
      rateLabel: "Rate per hour",
      unit: "hours",
      calculated: true
    };
  }

  if (value === "waste") {
    return {
      description: "Waste disposal",
      unit: "fixed",
      calculated: false
    };
  }

  return {
    description: "",
    unit: "fixed",
    calculated: false
  };
}


function createManualChargeLineRow(type = "mileage") {
  const row = document.createElement("div");

  row.className = "manual-charge-line";
  row.style.cssText = `
    border:1px solid #dce5f2;
    border-radius:12px;
    padding:12px;
    margin-bottom:10px;
    background:#fff;
  `;

  row.innerHTML = `
    <div style="
      display:grid;
      grid-template-columns:150px 1fr auto;
      gap:10px;
      align-items:end;
      margin-bottom:10px;
    ">
      <div class="field" style="margin:0;">
        <label>Type</label>

        <select class="select" data-manual-line-type>
          <option value="mileage">Mileage</option>
          <option value="labour">Labour</option>
          <option value="waste">Waste</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div class="field" style="margin:0;">
        <label>Description</label>

        <input
          class="input"
          data-manual-line-description
          placeholder="Description"
        />
      </div>

      <button
        type="button"
        class="btn"
        data-remove-manual-line
        style="height:40px;"
      >
        Remove
      </button>
    </div>

    <div
      data-calculated-fields
      style="
        display:grid;
        grid-template-columns:1fr 1fr 150px;
        gap:10px;
        align-items:end;
      "
    >
      <div class="field" style="margin:0;">
        <label data-manual-quantity-label>Quantity</label>

        <input
          class="input"
          type="number"
          min="0"
          step="0.01"
          data-manual-line-quantity
          placeholder="0"
        />
      </div>

      <div class="field" style="margin:0;">
        <label data-manual-rate-label>Rate</label>

        <input
          class="input"
          type="number"
          min="0"
          step="0.01"
          data-manual-line-rate
          placeholder="0.00"
        />
      </div>

      <div class="quick-action" style="
        cursor:default;
        background:#f8fafc;
        min-height:40px;
      ">
        <span>Total</span>
        <strong data-manual-line-total>£0.00</strong>
      </div>
    </div>

    <div
      data-fixed-fields
      style="
        display:none;
        grid-template-columns:1fr 150px;
        gap:10px;
        align-items:end;
      "
    >
      <div class="field" style="margin:0;">
        <label>Amount ex VAT</label>

        <input
          class="input"
          type="number"
          min="0"
          step="0.01"
          data-manual-line-fixed
          placeholder="0.00"
        />
      </div>

      <div class="quick-action" style="
        cursor:default;
        background:#f8fafc;
        min-height:40px;
      ">
        <span>Total</span>
        <strong data-manual-line-total-fixed>£0.00</strong>
      </div>
    </div>
  `;

  row.querySelector("[data-manual-line-type]").value = type;

  updateManualChargeLineType(row);

  return row;
}


function updateManualChargeLineType(row) {
  const type =
    row.querySelector("[data-manual-line-type]")?.value ||
    "other";

  const config =
    getManualChargeLineConfig(type);

  const description =
    row.querySelector("[data-manual-line-description]");

  const calculatedFields =
    row.querySelector("[data-calculated-fields]");

  const fixedFields =
    row.querySelector("[data-fixed-fields]");

  if (
    description &&
    (
      !description.value ||
      [
        "Mileage",
        "Man hours",
        "Waste disposal"
      ].includes(description.value)
    )
  ) {
    description.value =
      config.description;
  }

  if (config.calculated) {
    calculatedFields.style.display = "grid";
    fixedFields.style.display = "none";

    row.querySelector(
      "[data-manual-quantity-label]"
    ).textContent =
      config.quantityLabel;

    row.querySelector(
      "[data-manual-rate-label]"
    ).textContent =
      config.rateLabel;
  } else {
    calculatedFields.style.display = "none";
    fixedFields.style.display = "grid";
  }

  refreshPreview();
}


function getManualChargeLines() {
  const rows = Array.from(
    document.querySelectorAll(
      "#manualChargeLines .manual-charge-line"
    )
  );

  return rows
    .map(row => {
      const type =
        row.querySelector(
          "[data-manual-line-type]"
        )?.value || "other";

      const config =
        getManualChargeLineConfig(type);

      const description =
        cleanText(
          row.querySelector(
            "[data-manual-line-description]"
          )?.value || ""
        );

      if (config.calculated) {
        const quantity =
          round2(
            toNumber(
              row.querySelector(
                "[data-manual-line-quantity]"
              )?.value,
              0
            )
          );

        const rate =
          round2(
            toNumber(
              row.querySelector(
                "[data-manual-line-rate]"
              )?.value,
              0
            )
          );

        return {
          type,
          description,
          quantity,
          unit: config.unit,
          rate,
          amount: round2(
            quantity * rate
          )
        };
      }

      const amount =
        round2(
          toNumber(
            row.querySelector(
              "[data-manual-line-fixed]"
            )?.value,
            0
          )
        );

      return {
        type,
        description,
        quantity: null,
        unit: "fixed",
        rate: null,
        amount
      };
    })
    .filter(line =>
      line.description ||
      line.amount > 0
    );
}


function addManualChargeLine(type = "mileage") {
  const container =
    byId("manualChargeLines");

  if (!container) return;

  container.appendChild(
    createManualChargeLineRow(type)
  );

  refreshPreview();
}

  function ensureModal() {
  if (byId("manualChargeModal")) return;

  const modal =
    document.createElement("div");

  modal.id = "manualChargeModal";
  modal.className =
    "occ-modal tenant-only";

  modal.setAttribute(
    "aria-hidden",
    "true"
  );

  modal.innerHTML = `
    <div
      class="occ-modal-card"
      style="
        width:min(1100px,96vw);
        max-height:92vh;
        overflow:auto;
      "
    >
      <div class="occ-modal-head">
        <div>
          <h2 class="occ-modal-title">
            Manual Charge
          </h2>

          <p class="occ-modal-sub">
            Create a manual charge order with multiple
            charge lines and combined invoice support.
          </p>
        </div>

        <button
          id="manualChargeCloseBtn"
          class="occ-modal-close"
          type="button"
        >
          ×
        </button>
      </div>

      <div
        style="
          display:grid;
          grid-template-columns:340px 1fr;
          gap:16px;
        "
      >

        <section class="occ-modal-section">

          <h3>Order details</h3>

          <div class="field">
            <label for="manualChargeOwner">
              Product Owner
            </label>

            <select
              id="manualChargeOwner"
              class="select"
            >
              <option value="">
                Loading...
              </option>
            </select>
          </div>

          <div class="field">
            <label for="manualChargeRetailer">
              Retailer
            </label>

            <input
              id="manualChargeRetailer"
              class="input"
              placeholder="Retailer name"
            />
          </div>

          <div class="field">
            <label for="manualChargePostcode">
              Postcode
            </label>

            <input
              id="manualChargePostcode"
              class="input"
              placeholder="Optional postcode"
            />
          </div>

          <div class="field">
            <label for="manualChargeReference">
              Reference / ACK ref
            </label>

            <input
              id="manualChargeReference"
              class="input"
              placeholder="Optional reference"
            />
          </div>

          <div class="field">
            <label for="manualChargePo">
              PO
            </label>

            <input
              id="manualChargePo"
              class="input"
              placeholder="Optional PO"
            />
          </div>

          <div class="field">
            <label for="manualChargeStatus">
              Order status
            </label>

            <select
              id="manualChargeStatus"
              class="select"
            >
              <option value="order_received">
                Order received
              </option>

              <option
                value="stock_complete"
                selected
              >
                Stock complete
              </option>

              <option value="planned">
                On planning
              </option>

              <option value="delivered">
                Delivered
              </option>
            </select>
          </div>

        </section>


        <section class="occ-modal-section">

          <div style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:12px;
            margin-bottom:10px;
          ">
            <h3 style="margin:0;">
              Charge lines
            </h3>

            <button
              id="manualChargeAddLineBtn"
              class="btn"
              type="button"
            >
              + Add line
            </button>
          </div>


          <div id="manualChargeLines"></div>


          <div style="
            border-top:1px solid #dce5f2;
            padding-top:12px;
            margin-top:14px;
          ">

            <label style="
              display:flex;
              gap:8px;
              align-items:center;
              font-size:12px;
              font-weight:900;
            ">
              <input
                id="manualChargeFuelEnabled"
                type="checkbox"
              />

              Add fuel surcharge
            </label>

            <div
              class="field"
              style="margin-top:10px;"
            >
              <label
                for="manualChargeFuelPercentage"
              >
                Fuel surcharge %
              </label>

              <input
                id="manualChargeFuelPercentage"
                class="input"
                type="number"
                step="0.1"
                min="0"
                value="${DEFAULT_FUEL_PERCENTAGE}"
              />
            </div>

            <div
              class="quick-action"
              style="
                cursor:default;
                background:#f8fafc;
                margin-top:12px;
              "
            >
              <span>
                Total charge ex VAT
              </span>

              <strong
                id="manualChargeTotalPreview"
              >
                £0.00
              </strong>
            </div>

          </div>

        </section>

      </div>


      <div class="occ-modal-actions">
        <button
          id="manualChargeCancelBtn"
          class="btn"
          type="button"
        >
          Cancel
        </button>

        <button
          id="manualChargeCreateBtn"
          class="btn btn-primary"
          type="button"
        >
          Create Manual Charge
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);


  byId("manualChargeCloseBtn")
    ?.addEventListener(
      "click",
      close
    );

  byId("manualChargeCancelBtn")
    ?.addEventListener(
      "click",
      close
    );


  byId("manualChargeAddLineBtn")
    ?.addEventListener(
      "click",
      () => {
        addManualChargeLine("other");
      }
    );


  modal.addEventListener(
    "click",
    event => {
      if (event.target === modal) {
        close();
      }

      const removeButton =
        event.target.closest(
          "[data-remove-manual-line]"
        );

      if (removeButton) {
        const row =
          removeButton.closest(
            ".manual-charge-line"
          );

        row?.remove();

        refreshPreview();
      }
    }
  );


  modal.addEventListener(
    "change",
    event => {

      if (
        event.target.matches(
          "[data-manual-line-type]"
        )
      ) {
        updateManualChargeLineType(
          event.target.closest(
            ".manual-charge-line"
          )
        );
      }

      refreshPreview();
    }
  );


  modal.addEventListener(
    "input",
    event => {

      if (
        event.target.matches(
          [
            "[data-manual-line-quantity]",
            "[data-manual-line-rate]",
            "[data-manual-line-fixed]",
            "#manualChargeFuelPercentage"
          ].join(",")
        )
      ) {
        refreshPreview();
      }
    }
  );


  byId("manualChargeFuelEnabled")
    ?.addEventListener(
      "change",
      refreshPreview
    );


  byId("manualChargeCreateBtn")
    ?.addEventListener(
      "click",
      async () => {
        try {
          await createManualCharge();
        } catch (error) {
          console.error(error);

          alert(
            error.message ||
            "Could not create manual charge."
          );
        }
      }
    );
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
  const lines =
    getManualChargeLines();

  const base =
    round2(
      lines.reduce(
        (sum, line) =>
          sum +
          toNumber(
            line.amount,
            0
          ),
        0
      )
    );

  const fuelEnabled =
    !!byId(
      "manualChargeFuelEnabled"
    )?.checked;

  const fuelPct =
    round2(
      toNumber(
        byId(
          "manualChargeFuelPercentage"
        )?.value,
        DEFAULT_FUEL_PERCENTAGE
      )
    );

  const fuelAmount =
    fuelEnabled
      ? round2(
          base *
          (
            fuelPct /
            100
          )
        )
      : 0;

  const total =
    round2(
      base +
      fuelAmount
    );

  return {
    lines,
    base,
    fuelEnabled,
    fuelPct,
    fuelAmount,
    total
  };
}


function refreshPreview() {
  const {
    lines,
    total
  } = getAmounts();

  document
    .querySelectorAll(
      "#manualChargeLines .manual-charge-line"
    )
    .forEach((row, index) => {

      const line =
        lines[index];

      const type =
        row.querySelector(
          "[data-manual-line-type]"
        )?.value;

      const config =
        getManualChargeLineConfig(
          type
        );

      const amount =
        config.calculated
          ? round2(
              toNumber(
                row.querySelector(
                  "[data-manual-line-quantity]"
                )?.value,
                0
              ) *
              toNumber(
                row.querySelector(
                  "[data-manual-line-rate]"
                )?.value,
                0
              )
            )
          : round2(
              toNumber(
                row.querySelector(
                  "[data-manual-line-fixed]"
                )?.value,
                0
              )
            );

      const calculatedTotal =
        row.querySelector(
          "[data-manual-line-total]"
        );

      const fixedTotal =
        row.querySelector(
          "[data-manual-line-total-fixed]"
        );

      if (calculatedTotal) {
        calculatedTotal.textContent =
          formatMoney(amount);
      }

      if (fixedTotal) {
        fixedTotal.textContent =
          formatMoney(amount);
      }
    });


  const el =
    byId(
      "manualChargeTotalPreview"
    );

  if (el) {
    el.textContent =
      formatMoney(total);
  }
}

async function open() {
  ensureModal();

  await populateOwners();

  byId("manualChargeRetailer").value = "";
  byId("manualChargePostcode").value = "";
  byId("manualChargeReference").value = "";
  byId("manualChargePo").value = "";

  byId(
    "manualChargeFuelEnabled"
  ).checked = false;

  byId(
    "manualChargeFuelPercentage"
  ).value =
    DEFAULT_FUEL_PERCENTAGE;

  byId(
    "manualChargeStatus"
  ).value =
    "stock_complete";


  const linesContainer =
    byId(
      "manualChargeLines"
    );

  if (linesContainer) {
    linesContainer.innerHTML = "";

    addManualChargeLine(
      "mileage"
    );

    addManualChargeLine(
      "labour"
    );

    addManualChargeLine(
      "waste"
    );
  }


  refreshPreview();


  byId("manualChargeModal")
    ?.classList.add(
      "open"
    );

  byId("manualChargeModal")
    ?.setAttribute(
      "aria-hidden",
      "false"
    );
}

async function createManualCharge() {
  const cid =
    await getCompanyId();

  const {
    orderNumber,
    nextNo
  } =
    await getNextSoNumber();


  const ownerId =
    byId(
      "manualChargeOwner"
    )?.value || "";

  const owner =
    productOwners.find(
      row =>
        String(row.id) ===
        String(ownerId)
    );


  if (!owner?.id) {
    throw new Error(
      "Select a product owner."
    );
  }


  const retailer =
    cleanText(
      byId(
        "manualChargeRetailer"
      )?.value || ""
    );

  const postcode =
    cleanText(
      byId(
        "manualChargePostcode"
      )?.value || ""
    );

  const reference =
    cleanText(
      byId(
        "manualChargeReference"
      )?.value || ""
    );

  const po =
    cleanText(
      byId(
        "manualChargePo"
      )?.value || ""
    );

  const selectedStatus =
    byId(
      "manualChargeStatus"
    )?.value ||
    "stock_complete";

  const amounts =
    getAmounts();


  if (!retailer) {
    throw new Error(
      "Enter a retailer name."
    );
  }


  if (!amounts.lines.length) {
    throw new Error(
      "Add at least one charge line."
    );
  }


  const invalidLine =
    amounts.lines.find(
      line =>
        !line.description ||
        line.amount <= 0
    );

  if (invalidLine) {
    throw new Error(
      "Every charge line needs a description and an amount above £0.00."
    );
  }


  if (amounts.total <= 0) {
    throw new Error(
      "Total charge must be higher than £0.00."
    );
  }


  const orderId =
    crypto.randomUUID();

  const statusFields =
    statusPayload(
      selectedStatus
    );


  const orderPayload = {
    id: orderId,

    company_id: cid,

    customer_id:
      owner.id,

    order_number:
      orderNumber,

    order_type:
      "manual_charge",

    source_type:
      "manual_charge",

    external_reference:
      reference || null,

    purchase_order:
      po || null,

    order_date:
      todayIso(),

    requested_delivery_date:
      todayIso(),

    finance_status:
      "not_invoiced",

    planning_release:
      false,

    planning_colli:
      0,

    planning_volume_m3:
      0,

    total_order_colli:
      0,

    total_order_volume_m3:
      0,


    /*
     * Alle manual charges worden financieel
     * als transport behandeld.
     */
    total_storage_tariff:
      0,

    total_admin_tariff:
      0,

    total_handling_tariff:
      0,

    total_transport_tariff:
      amounts.total,

    total_s2u_fees:
      0,

    total_customer_charge:
      amounts.total,

    is_chargeable:
      true,

    original_chargeable:
      true,

    copy_chargeable:
      true,


    retail_name:
      retailer,

    retailer_code:
      makeRetailerCode(
        postcode,
        retailer
      ),

    delivery_postcode:
      postcode || null,

    delivery_country:
      "United Kingdom",


    memo:
      amounts.lines
        .map(line =>
          `${line.description}: ${formatMoney(line.amount)}`
        )
        .join(" · ") +
      (
        amounts.fuelEnabled
          ? ` · Fuel surcharge ${amounts.fuelPct}%: ${formatMoney(amounts.fuelAmount)}`
          : ""
      ),

    notes:
      `Manual charge total ex VAT ${formatMoney(amounts.total)}.`,

    created_at:
      nowIso(),

    last_activity_at:
      nowIso(),

    ...statusFields
  };


  const {
    error: orderError
  } =
    await db()
      .from("orders")
      .insert(
        orderPayload
      );


  if (orderError) {
    throw orderError;
  }


  const lines =
    amounts.lines.map(
      (line, index) => {

        const sku =
          line.type === "mileage"
            ? "MILEAGE"
            : line.type === "labour"
              ? "LABOUR"
              : line.type === "waste"
                ? "WASTE"
                : "MANUAL";

        return {
          company_id:
            cid,

          order_id:
            orderId,

          line_number:
            index + 1,

          sku_base:
            sku,

          description:
            line.description,

          quantity_ordered:
            1,

          quantity_allocated:
            0,

          quantity_shipped:
            selectedStatus ===
              "delivered"
              ? 1
              : 0,

          line_type:
            "manual",

          manual_description:
            line.description,

          manual_quantity:
            line.quantity,

          manual_unit:
            line.unit,

          manual_rate_gbp:
            line.rate,

          manual_amount_gbp:
            line.amount,


          /*
           * Voor Billing telt alles als Transport.
           */
          tariff_transport:
            line.amount,

          tariff_storage:
            0,

          tariff_admin:
            0,

          tariff_handling:
            0,

          total_customer_charge:
            line.amount,

          created_at:
            nowIso()
        };
      }
    );


  if (
    amounts.fuelEnabled &&
    amounts.fuelAmount > 0
  ) {
    lines.push({
      company_id:
        cid,

      order_id:
        orderId,

      line_number:
        lines.length + 1,

      sku_base:
        "FUEL",

      description:
        `Fuel surcharge ${amounts.fuelPct}%`,

      quantity_ordered:
        1,

      quantity_allocated:
        0,

      quantity_shipped:
        selectedStatus ===
          "delivered"
          ? 1
          : 0,

      line_type:
        "manual",

      manual_description:
        `Fuel surcharge ${amounts.fuelPct}%`,

      manual_quantity:
        null,

      manual_unit:
        "fixed",

      manual_rate_gbp:
        null,

      manual_amount_gbp:
        amounts.fuelAmount,

      tariff_transport:
        amounts.fuelAmount,

      tariff_storage:
        0,

      tariff_admin:
        0,

      tariff_handling:
        0,

      total_customer_charge:
        amounts.fuelAmount,

      created_at:
        nowIso()
    });
  }


  const {
    error: lineError
  } =
    await db()
      .from("order_lines")
      .insert(
        lines
      );


  if (lineError) {
    throw lineError;
  }


  await db()
    .from(
      "order_activity_log"
    )
    .insert({
      company_id:
        cid,

      customer_id:
        owner.id,

      order_id:
        orderId,

      activity_type:
        "manual_charge_created",

      new_status:
        selectedStatus,

      description:
        `Manual charge created. ` +
        `${orderNumber} · ` +
        `${lines.length} charge line(s) · ` +
        `${formatMoney(amounts.total)}.`,

      created_by:
        "manual",

      created_at:
        nowIso()
    });


  await incrementSoNumber(
    nextNo
  );


  close();


  if (
    window.OCCReloadOrders
  ) {
    await window
      .OCCReloadOrders();
  }


  alert(
    `Manual charge created: ${orderNumber}`
  );
}

  window.ManualChargeTool = {
    open
  };
})();