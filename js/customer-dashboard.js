(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let companyId = null;
  let selectedCustomerId = null;
  let selectedCustomer = null;

  let rawOrders = [];
  let filteredOrders = [];
  let activeKpiFilter = "";
  let activeDocumentFilter = "";
  let customerDeliveryGroups = new Map();

  const charts = {};

  const ROLE = {
    VEYNOR_ADMIN: "veynor_admin",
    TENANT_ADMIN: "tenant_admin",
    TENANT_USER: "tenant_user",
    PRODUCT_OWNER_ADMIN: "product_owner_admin",
    PRODUCT_OWNER_USER: "product_owner_user",
    RETAILER_USER: "retailer_user"
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
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
    const num = Number(
      String(value ?? "").replace(",", ".")
    );

    return Number.isFinite(num)
      ? num
      : fallback;
  }

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);

    if (!Number.isFinite(num)) {
      return "0";
    }

    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatPercent(value) {
    const num = Number(value ?? 0);

    if (!Number.isFinite(num)) {
      return "0%";
    }

    return `${Math.round(num)}%`;
  }

function formatDays(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  const num = Number(value);

  if (!Number.isFinite(num) || num < 0) {
    return "—";
  }

  return `${formatNumber(num, 1)}d`;
}

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleDateString("en-GB");
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent = value;
    }
  }

  function showToast(message, type = "ok") {
    const element = byId("toast");

    if (!element) {
      return;
    }

    element.textContent = message || "";
    element.className = `notice ${type}`;

    window.clearTimeout(window.__customerDashToast);

    window.__customerDashToast = window.setTimeout(() => {
      element.textContent = "";
      element.className = "notice";
    }, 5500);
  }

  function monthKey(value) {
    if (!value) {
      return "Unknown";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    return `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;
  }

  function monthLabel(key) {
    if (!key || key === "Unknown") {
      return "Unknown";
    }

    const [year, month] = key
      .split("-")
      .map(Number);

    const date = new Date(year, month - 1, 1);

    return date.toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit"
    });
  }

  function dayKey(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const year = date.getFullYear();
    const month = String(
      date.getMonth() + 1
    ).padStart(2, "0");
    const day = String(
      date.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function dayLabel(key) {
    if (!key) {
      return "";
    }

    const date = new Date(`${key}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return key;
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short"
    });
  }

  function isTenantRole() {
    return [
      ROLE.VEYNOR_ADMIN,
      ROLE.TENANT_ADMIN,
      ROLE.TENANT_USER
    ].includes(
      normalize(currentProfile?.role)
    );
  }

  function isProductOwnerRole() {
    return [
      ROLE.PRODUCT_OWNER_ADMIN,
      ROLE.PRODUCT_OWNER_USER
    ].includes(
      normalize(currentProfile?.role)
    );
  }

  function getQueryParam(name) {
    return new URLSearchParams(
      window.location.search
    ).get(name);
  }

  async function loadProfile() {
    const {
      data: userData,
      error: userError
    } = await client.auth.getUser();

    if (userError) {
      throw userError;
    }

    currentUser = userData?.user || null;

    if (!currentUser?.id) {
      window.location.href = "/login.html";
      throw new Error("Not authenticated.");
    }

    const {
      data,
      error
    } = await client
      .from("user_profiles")
      .select(`
        *,
        companies (
          id,
          name
        ),
        customers (
          id,
          name,
          customer_code
        )
      `)
      .eq("id", currentUser.id)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data?.id) {
      throw new Error(
        "No active profile found."
      );
    }

    currentProfile = data;
    companyId = data.company_id || null;

    if (
      !companyId &&
      normalize(data.role) === ROLE.VEYNOR_ADMIN
    ) {
      const {
        data: company,
        error: companyError
      } = await client
        .from("companies")
        .select("id, name")
        .eq("name", TENANT_NAME)
        .maybeSingle();

      if (companyError) {
        throw companyError;
      }

      if (!company?.id) {
        throw new Error(
          `Company "${TENANT_NAME}" not found.`
        );
      }

      companyId = company.id;
    }
  }

  async function resolveCustomer() {
    if (isProductOwnerRole()) {
      selectedCustomerId =
        currentProfile.customer_id;
    } else if (isTenantRole()) {
      selectedCustomerId =
        getQueryParam("customer_id") || null;
    }

    if (!selectedCustomerId) {
      if (isTenantRole()) {
        await loadCustomerPicker();
        return;
      }

      throw new Error(
        "No customer selected."
      );
    }

    const {
      data,
      error
    } = await client
      .from("customers")
      .select(`
        id,
        name,
        customer_code,
        billing_email
      `)
      .eq("id", selectedCustomerId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data?.id) {
      throw new Error(
        "Selected customer not found."
      );
    }

    selectedCustomer = data;

    setText(
      "customerName",
      selectedCustomer.name || "Customer"
    );

    setText(
      "customerMeta",
      selectedCustomer.customer_code
        ? `Customer code: ${selectedCustomer.customer_code}`
        : "Customer portal"
    );

    if (isTenantRole()) {
      await loadCustomerPicker();

      const select = byId("customerSelect");

      if (select) {
        select.value = selectedCustomerId;
      }
    }
  }

  async function loadCustomerPicker() {
    const wrap = byId(
      "adminCustomerPickerWrap"
    );

    const select = byId(
      "customerSelect"
    );

    if (
      !isTenantRole() ||
      !wrap ||
      !select
    ) {
      return;
    }

    wrap.style.display = "";

    const {
      data,
      error
    } = await client
      .from("customers")
      .select(`
        id,
        name,
        customer_code
      `)
      .eq("company_id", companyId)
      .order("name", {
        ascending: true
      });

    if (error) {
      throw error;
    }

    const rows = data || [];

    select.innerHTML = rows.length
      ? rows.map(row => `
          <option value="${escapeHtml(row.id)}">
            ${escapeHtml(row.name || "Customer")}${
              row.customer_code
                ? ` · ${escapeHtml(row.customer_code)}`
                : ""
            }
          </option>
        `).join("")
      : `
        <option value="">
          No customers found
        </option>
      `;

    if (
      !selectedCustomerId &&
      rows[0]?.id
    ) {
      selectedCustomerId = rows[0].id;
      selectedCustomer = rows[0];

      setText(
        "customerName",
        selectedCustomer.name || "Customer"
      );

      setText(
        "customerMeta",
        selectedCustomer.customer_code
          ? `Customer code: ${selectedCustomer.customer_code}`
          : "Customer portal"
      );
    }

    if (selectedCustomerId) {
      select.value = selectedCustomerId;
    }
  }

  function getOrderLines(order) {
    return Array.isArray(order.order_lines)
      ? order.order_lines
      : [];
  }

  function getDoc(order, type) {
    return (
      order.order_documents || []
    ).find(doc =>
      normalize(doc.document_type) ===
      normalize(type)
    ) || null;
  }

  function hasDocument(order, type) {
    const doc = getDoc(order, type);

    return (
      !!doc?.file_url ||
      [
        "generated",
        "sent",
        "signed"
      ].includes(
        normalize(doc?.document_status)
      )
    );
  }

function getUniqueInvoices(orders = filteredOrders) {
  const invoiceMap = new Map();

  orders.forEach(order => {
    (order.order_documents || [])
      .filter(doc =>
        normalize(doc.document_type) === "invoice" &&
        (
          doc.file_url ||
          [
            "generated",
            "sent",
            "paid"
          ].includes(
            normalize(doc.document_status)
          )
        )
      )
      .forEach(doc => {
        const key = normalize(
          doc.document_number ||
          doc.file_url ||
          doc.id
        );

        if (!key) return;

        if (!invoiceMap.has(key)) {
          invoiceMap.set(key, {
            key,
            document_number:
              doc.document_number || "",
            file_url:
              doc.file_url || "",
            status:
              normalize(
                doc.document_status ||
                order.finance_status ||
                order.finance_status_derived
              )
          });

          return;
        }

        const existing =
          invoiceMap.get(key);

        const statuses = [
          existing.status,
          normalize(
            doc.document_status ||
            order.finance_status ||
            order.finance_status_derived
          )
        ];

        if (
          statuses.includes("paid") ||
          statuses.includes("closed")
        ) {
          existing.status = "paid";
        } else if (
          statuses.includes("sent") ||
          statuses.includes("invoice_sent")
        ) {
          existing.status = "sent";
        }
      });
  });

  return [...invoiceMap.values()];
}

  function deriveFinanceStatus(order) {
    const explicit = normalize(
      order.finance_status || ""
    );

    const invoice = getDoc(
      order,
      "invoice"
    );

    if (
      normalize(
        invoice?.document_status
      ) === "sent"
    ) {
      return "invoice_sent";
    }

    if (
      invoice?.file_url ||
      normalize(
        invoice?.document_status
      ) === "generated"
    ) {
      return "invoice_generated";
    }

    if (
      explicit &&
      explicit !== "not_invoiced"
    ) {
      return explicit;
    }

    return "not_invoiced";
  }

  function getLineRequiredQty(line) {
    return toNumber(
      line.quantity_ordered || 0,
      0
    );
  }

  function getLineMatchedQty(line) {
    const required =
      getLineRequiredQty(line);

    const matchedQuantity = toNumber(
      line.matched_quantity,
      0
    );

    const allocatedQuantity = toNumber(
      line.quantity_allocated,
      0
    );

    const activeAllocations = (
      line.order_allocations || []
    ).filter(allocation =>
      ![
        "cancelled",
        "removed",
        "unreserved"
      ].includes(
        normalize(
          allocation.allocation_status
        )
      )
    ).length;

    const matched = Math.max(
      matchedQuantity,
      allocatedQuantity,
      activeAllocations
    );

    return Math.min(
      required,
      matched
    );
  }

  function getProductCompleteness(order) {
    const lines = getOrderLines(order);

    const required = lines.reduce(
      (sum, line) =>
        sum + getLineRequiredQty(line),
      0
    );

    if (required <= 0) {
      return {
        required: 0,
        matched: 0,
        missing: 0,
        pct: 0,
        status: "none"
      };
    }

    const status = normalize(
      order.status
    );

    const warehouseStatus = normalize(
      order.warehouse_status
    );

    const transportStatus = normalize(
      order.transport_status
    );

    const overallStatus = normalize(
      order.overall_status
    );

    const completeStatuses = [
      "stock_complete",
      "ready_for_picking",
      "ready_for_loading",
      "picked",
      "planned",
      "export_for_charter",
      "loaded",
      "sent_to_driver",
      "out_for_delivery",
      "on_transport",
      "delivered",
      "closed"
    ];

    const definitelyComplete =
      completeStatuses.includes(status) ||
      completeStatuses.includes(
        warehouseStatus
      ) ||
      completeStatuses.includes(
        transportStatus
      ) ||
      completeStatuses.includes(
        overallStatus
      );

    if (definitelyComplete) {
      return {
        required,
        matched: required,
        missing: 0,
        pct: 100,
        status: "complete"
      };
    }

    const matched = lines.reduce(
      (sum, line) => {
        const lineRequired =
          getLineRequiredQty(line);

        const lineMatched =
          getLineMatchedQty(line);

        return (
          sum +
          Math.min(
            lineRequired,
            lineMatched
          )
        );
      },
      0
    );

    const missing = Math.max(
      0,
      required - matched
    );

    const pct = Math.min(
      100,
      Math.round(
        (matched / required) * 100
      )
    );

    return {
      required,
      matched,
      missing,
      pct,
      status:
        missing > 0
          ? "missing"
          : "complete"
    };
  }

  function getRetailerName(order) {
    return cleanText(
      order.retail_name ||
      order.retailer_name ||
      order.delivery_name ||
      "—"
    );
  }

  function getPostcode(order) {
    return cleanText(
      order.delivery_postcode || "—"
    );
  }

  function getOrderVolumeM3(order) {
    return getOrderLines(order).reduce(
      (sum, line) => {
        const qty =
          getLineRequiredQty(line) || 1;

        const volume =
          toNumber(
            line.total_line_volume_m3,
            0
          ) ||
          toNumber(
            line.total_volume_m3,
            0
          ) ||
          (
            toNumber(
              line.unit_volume_m3,
              0
            ) * qty
          ) ||
          (
            toNumber(
              line.products?.volume_m3,
              0
            ) * qty
          );

        return sum + volume;
      },
      0
    );
  }

  function getDeliveryGroupKey(order) {
    return [
      selectedCustomerId || "",
      normalize(
        order.retailer_display ||
        getRetailerName(order)
      ),
      normalize(
        order.delivery_postcode || ""
      )
    ].join("|");
  }

  function isCancelled(order) {
    return normalize(
      order.lifecycle_status
    ) === "cancelled";
  }

  function isLegacyOrder(order) {
    return (
      normalize(
        order.source_type
      ) === "legacy_import" ||
      normalize(
        order.order_type
      ) === "legacy" ||
      order.is_legacy === true
    );
  }

  function buildCustomerDeliveryGroups() {
    customerDeliveryGroups = new Map();

    rawOrders.forEach(order => {
      if (
        isLegacyOrder(order) ||
        isCancelled(order) ||
        [
          "delivered",
          "invoiced",
          "closed"
        ].includes(
          order.lifecycle_status
        )
      ) {
        return;
      }

      const key =
        getDeliveryGroupKey(order);

      const volume =
        getOrderVolumeM3(order);

      if (
        !customerDeliveryGroups.has(key)
      ) {
        customerDeliveryGroups.set(
          key,
          {
            key,
            readyVolume: 0,
            waitingVolume: 0,
            minimumVolume: 1.25,
            shortfall: 0
          }
        );
      }

      const group =
        customerDeliveryGroups.get(key);

      if (
        [
          "stock_complete",
          "picked"
        ].includes(
          order.lifecycle_status
        )
      ) {
        group.readyVolume += volume;
      } else if (
        [
          "order_received",
          "awaiting_goods"
        ].includes(
          order.lifecycle_status
        )
      ) {
        group.waitingVolume += volume;
      }
    });

    customerDeliveryGroups.forEach(
      group => {
        group.readyVolume = Number(
          group.readyVolume.toFixed(2)
        );

        group.waitingVolume = Number(
          group.waitingVolume.toFixed(2)
        );

        group.shortfall = Math.max(
          0,
          Number(
            (
              group.minimumVolume -
              group.readyVolume
            ).toFixed(2)
          )
        );
      }
    );
  }

  function getCustomerDeliveryGroup(order) {
    return (
      customerDeliveryGroups.get(
        getDeliveryGroupKey(order)
      ) || null
    );
  }

  function hasDeliveryGroupShortfall(order) {
    const group =
      getCustomerDeliveryGroup(order);

    if (!group) {
      return false;
    }

    return (
      group.readyVolume > 0 &&
      group.readyVolume <
        group.minimumVolume &&
      [
        "order_received",
        "awaiting_goods",
        "stock_complete",
        "picked"
      ].includes(
        order.lifecycle_status
      )
    );
  }

  function deriveLifecycleStatus(order) {
    const status = normalize(
      order.status || ""
    );

    const warehouseStatus = normalize(
      order.warehouse_status || ""
    );

    const transportStatus = normalize(
      order.transport_status || ""
    );

    const overall = normalize(
      order.overall_status || ""
    );

    if (
      status === "cancelled" ||
      warehouseStatus === "cancelled" ||
      transportStatus === "cancelled" ||
      overall === "cancelled"
    ) {
      return "cancelled";
    }

    if (
      status === "delivered" ||
      warehouseStatus === "delivered" ||
      transportStatus === "delivered" ||
      overall === "delivered" ||
      normalize(
        order.pod_status
      ) === "signed" ||
      !!order.pod_completed_at
    ) {
      return "delivered";
    }

    const financeStatus =
      deriveFinanceStatus(order);

    if (financeStatus === "paid") {
      return "closed";
    }

    if (
      [
        "invoice_generated",
        "invoice_sent"
      ].includes(financeStatus)
    ) {
      return "invoiced";
    }

    if (
      [
        "delivery_issue",
        "returned",
        "failed_delivery",
        "issue"
      ].includes(overall)
    ) {
      return "issue";
    }

    if (
      [
        "loaded",
        "dispatched",
        "out_for_delivery",
        "on_transport",
        "export_for_charter"
      ].includes(status) ||
      [
        "loaded",
        "dispatched",
        "out_for_delivery",
        "on_transport",
        "export_for_charter"
      ].includes(transportStatus)
    ) {
      return "on_transport";
    }

    if (
      warehouseStatus === "picked" ||
      warehouseStatus ===
        "ready_for_loading"
    ) {
      return "picked";
    }

    if (
      warehouseStatus ===
        "stock_complete" ||
      status === "ready_for_picking"
    ) {
      return "stock_complete";
    }

    const completeness =
      getProductCompleteness(order);

    if (
      completeness.required > 0 &&
      completeness.missing <= 0
    ) {
      return "stock_complete";
    }

    if (
      completeness.required > 0 &&
      completeness.missing > 0
    ) {
      return "awaiting_goods";
    }

    if (
      warehouseStatus ===
        "partial_stock" ||
      warehouseStatus ===
        "awaiting_goods"
    ) {
      return "awaiting_goods";
    }

    return "order_received";
  }

  function getExpectedDate(order) {
    return (
      order.confirmed_delivery_date ||
      order.expected_delivery_date ||
      order.requested_delivery_date ||
      ""
    );
  }

  function getDeliveredDate(order) {
    return (
      order.actual_delivery_date ||
      order.delivered_at ||
      order.delivery_completed_at ||
      order.pod_completed_at ||
      ""
    );
  }

function getCompleteDate(order) {
  return order.stock_completed_at || "";
}

  function getImportedDate(order) {
    return (
      order.imported_at ||
      order.created_at ||
      order.order_date ||
      ""
    );
  }

  function dayDiff(start, end) {
    if (!start || !end) {
      return null;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return null;
    }

    return Math.max(
      0,
      (
        endDate.getTime() -
        startDate.getTime()
      ) / 86400000
    );
  }

  function businessDayDiff(start, end) {
    if (!start || !end) {
      return null;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return null;
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

    if (endDate < startDate) {
      return null;
    }

    let businessDays = 0;
    const cursor = new Date(startDate);

    while (cursor < endDate) {
      cursor.setDate(
        cursor.getDate() + 1
      );

      const day = cursor.getDay();

      if (
        day !== 0 &&
        day !== 6
      ) {
        businessDays += 1;
      }
    }

    return businessDays;
  }

  function enrichOrder(order) {
    const completeness =
      getProductCompleteness(order);

    const lifecycle =
      deriveLifecycleStatus(order);

    return {
      ...order,
      retailer_display:
        getRetailerName(order),
      postcode_display:
        getPostcode(order),
      expected_delivery_display:
        getExpectedDate(order),
      delivered_date_display:
        getDeliveredDate(order),
      complete_date_display:
        getCompleteDate(order),
      imported_date_display:
        getImportedDate(order),
      product_completeness:
        completeness,
      lifecycle_status:
        lifecycle,
      finance_status_derived:
        deriveFinanceStatus(order)
    };
  }

  function dateRangeStart() {
    const value =
      byId("dateRange")?.value || "90";

    if (value === "all") {
      return null;
    }

    const days = Number(value);
    const date = new Date();

    date.setHours(0, 0, 0, 0);
    date.setDate(
      date.getDate() - days
    );

    return date;
  }

  async function loadOrders() {
    if (!selectedCustomerId) {
      rawOrders = [];
      filteredOrders = [];

      renderAll();
      return;
    }

    const {
      data,
      error
    } = await client
      .from("orders")
      .select(`
        *,
        order_documents (
          id,
          document_type,
          document_number,
          document_status,
          file_url,
          customer_visible,
          created_at,
          updated_at
        ),
        order_lines (
          id,
          order_id,
          quantity_ordered,
          quantity_allocated,
          matched_quantity,
          total_packages,
          product_id,
          sku_base,
          description,
          unit_volume_m3,
          total_volume_m3,
          total_line_volume_m3,
          products (
            id,
            sku_base,
            name,
            description,
            volume_m3
          ),
          order_allocations (
            id,
            allocation_status
          )
        )
      `)
      .eq("company_id", companyId)
      .eq(
        "customer_id",
        selectedCustomerId
      )
      .order("created_at", {
        ascending: false
      });

    if (error) {
      throw error;
    }

    rawOrders = (
      data || []
    ).map(enrichOrder);

    buildCustomerDeliveryGroups();
    applyFilters();
    renderAll();
  }

  function applyFilters() {
    const query = normalize(
      byId("searchInput")?.value || ""
    );

    const status = normalize(
      byId("statusFilter")?.value || ""
    );

    const start =
      dateRangeStart();

    filteredOrders = rawOrders.filter(
      order => {
        if (isLegacyOrder(order)) {
          return false;
        }

        if (
          status &&
          order.lifecycle_status !== status
        ) {
          return false;
        }

        if (start) {
          const importedDate = new Date(
            getImportedDate(order)
          );

          if (
            !Number.isNaN(
              importedDate.getTime()
            ) &&
            importedDate < start
          ) {
            return false;
          }
        }

        if (query) {
          const haystack = [
            order.order_number,
            order.external_reference,
            order.purchase_order,
            order.retailer_display,
            order.delivery_postcode,
            order.delivery_city,
            order.status
          ]
            .join(" ")
            .toLowerCase();

          if (
            !haystack.includes(query)
          ) {
            return false;
          }
        }

        return true;
      }
    );
  }

  function isOpen(order) {
    if (
      isCancelled(order) ||
      [
        "delivered",
        "invoiced",
        "closed"
      ].includes(
        order.lifecycle_status
      )
    ) {
      return false;
    }

    const missingProducts =
      toNumber(
        order.product_completeness
          ?.missing,
        0
      ) > 0;

    const noDeliveryDate =
      !getExpectedDate(order);

    const deliveryGroupShortfall =
      hasDeliveryGroupShortfall(order);

    return (
      missingProducts ||
      noDeliveryDate ||
      deliveryGroupShortfall
    );
  }

  function isDeliveredThisMonth(order) {
    if (
      ![
        "delivered",
        "invoiced",
        "closed"
      ].includes(
        order.lifecycle_status
      )
    ) {
      return false;
    }

    const value =
      getDeliveredDate(order);

    if (!value) {
      return false;
    }

    const deliveredDate =
      new Date(value);

    const now = new Date();

    if (
      Number.isNaN(
        deliveredDate.getTime()
      )
    ) {
      return false;
    }

    return (
      deliveredDate.getFullYear() ===
        now.getFullYear() &&
      deliveredDate.getMonth() ===
        now.getMonth()
    );
  }

  function isAttention(order) {
    if (!isOpen(order)) {
      return false;
    }

    if (
      toNumber(
        order.product_completeness
          ?.missing,
        0
      ) > 0
    ) {
      return true;
    }

    if (
      hasDeliveryGroupShortfall(order)
    ) {
      return true;
    }

    const expected =
      getExpectedDate(order);

    if (!expected) {
      return true;
    }

    const expectedDate =
      new Date(expected);

    const today = new Date();

    today.setHours(
      0,
      0,
      0,
      0
    );

    if (
      !Number.isNaN(
        expectedDate.getTime()
      ) &&
      expectedDate < today
    ) {
      return true;
    }

    return false;
  }

  function attentionReason(order) {
    const reasons = [];

    const group =
      getCustomerDeliveryGroup(order);

    if (
      toNumber(
        order.product_completeness
          ?.missing,
        0
      ) > 0
    ) {
      reasons.push(
        "Missing products"
      );
    }

    if (
      hasDeliveryGroupShortfall(order) &&
      group
    ) {
      reasons.push(
        `Below minimum delivery group: ${formatNumber(
          group.readyVolume,
          2
        )} / ${formatNumber(
          group.minimumVolume,
          2
        )} m³`
      );
    }

    const expected =
      getExpectedDate(order);

    if (!expected) {
      reasons.push(
        "No expected date"
      );
    } else {
      const expectedDate =
        new Date(expected);

      const today = new Date();

      today.setHours(
        0,
        0,
        0,
        0
      );

      if (
        !Number.isNaN(
          expectedDate.getTime()
        ) &&
        expectedDate < today &&
        isOpen(order)
      ) {
        reasons.push(
          "Expected date passed"
        );
      }
    }

    return (
      reasons.join(", ") ||
      "Attention required"
    );
  }

  function actionReason(order) {
    const reasons = [];

    const group =
      getCustomerDeliveryGroup(order);

    if (
      toNumber(
        order.product_completeness
          ?.missing,
        0
      ) > 0
    ) {
      reasons.push(
        "Missing stock"
      );
    }

    if (!getExpectedDate(order)) {
      reasons.push(
        "No delivery date"
      );
    }

    if (
      hasDeliveryGroupShortfall(order) &&
      group
    ) {
      reasons.push(
        `Below minimum delivery group: ${formatNumber(
          group.readyVolume,
          2
        )} / ${formatNumber(
          group.minimumVolume,
          2
        )} m³`
      );
    }

    return (
      reasons.join(", ") ||
      "Ready / no action required"
    );
  }

  function matchesKpiFilter(
    order,
    filter
  ) {
    if (!filter) {
      return true;
    }

    if (filter === "open") {
      return isOpen(order);
    }

    if (filter === "awaiting") {
      return (
        order.lifecycle_status ===
        "awaiting_goods"
      );
    }

    if (filter === "complete") {
      return [
        "stock_complete",
        "picked"
      ].includes(
        order.lifecycle_status
      );
    }

    if (filter === "missing") {
      return (
        toNumber(
          order.product_completeness
            ?.missing,
          0
        ) > 0
      );
    }

    if (
      filter ===
      "delivered_month"
    ) {
      return isDeliveredThisMonth(order);
    }

    if (
      filter ===
      "confirmed_dates"
    ) {
      return (
        isOpen(order) &&
        !!order.confirmed_delivery_date
      );
    }

    if (filter === "pod") {
      return hasDocument(
        order,
        "pod"
      );
    }

    if (filter === "invoice") {
      return hasDocument(
        order,
        "invoice"
      );
    }

    if (filter === "attention") {
      return isAttention(order);
    }

    return true;
  }

  function statusLabel(status) {
    const map = {
      order_received:
        "Order received",
      awaiting_goods:
        "Awaiting goods",
      stock_complete:
        "Stock complete",
      picked:
        "Picked",
      on_transport:
        "On transport",
      delivered:
        "Delivered",
      invoiced:
        "Invoiced",
      closed:
        "Closed",
      cancelled:
        "Cancelled",
      issue:
        "Issue"
    };

    return (
      map[normalize(status)] ||
      cleanText(status).replaceAll(
        "_",
        " "
      )
    );
  }

  function statusPill(status) {
    const normalized =
      normalize(status);

    let className = "gray";

    if (
      normalized === "order_received"
    ) {
      className = "";
    }

    if (
      normalized === "awaiting_goods"
    ) {
      className = "orange";
    }

    if (
      [
        "stock_complete",
        "picked"
      ].includes(normalized)
    ) {
      className = "green";
    }

    if (
      normalized === "on_transport"
    ) {
      className = "";
    }

    if (
      [
        "delivered",
        "invoiced",
        "closed"
      ].includes(normalized)
    ) {
      className = "green";
    }

    if (
      [
        "cancelled",
        "issue"
      ].includes(normalized)
    ) {
      className = "red";
    }

    return `
      <span class="pill ${className}">
        ${escapeHtml(
          statusLabel(normalized)
        )}
      </span>
    `;
  }

  function renderKpis() {
    const orders =
      filteredOrders;

    const open =
      orders.filter(isOpen);

    const awaiting =
      orders.filter(order =>
        order.lifecycle_status ===
        "awaiting_goods"
      );

    const complete =
      orders.filter(order =>
        [
          "stock_complete",
          "picked"
        ].includes(
          order.lifecycle_status
        )
      );

    const missingQty =
      orders.reduce(
        (sum, order) =>
          sum +
          toNumber(
            order.product_completeness
              ?.missing,
            0
          ),
        0
      );

    const deliveredMonth =
      orders.filter(
        isDeliveredThisMonth
      );

    const attention =
      orders.filter(
        isAttention
      );

    const openWithConfirmedDates =
      open.filter(order =>
        !!order.confirmed_delivery_date
      );

    const confirmedPct =
      open.length
        ? (
            openWithConfirmedDates.length /
            open.length
          ) * 100
        : 0;

    const podAvailable =
      orders.filter(order =>
        hasDocument(
          order,
          "pod"
        )
      ).length;

const invoicesAvailable =
  getUniqueInvoices(orders).length;

    const retailers = new Set(
      orders
        .map(order =>
          normalize(
            order.retailer_display
          )
        )
        .filter(Boolean)
    );

    const completeToDeliveredLeadTimes =
      orders
        .filter(order =>
          [
            "delivered",
            "invoiced",
            "closed"
          ].includes(
            order.lifecycle_status
          )
        )
        .map(order =>
          businessDayDiff(
            order.complete_date_display,
            order.delivered_date_display
          )
        )
        .filter(
          value =>
            value !== null
        );

const avgCompleteToDelivered =
  completeToDeliveredLeadTimes.length
    ? completeToDeliveredLeadTimes.reduce(
        (sum, value) => sum + value,
        0
      ) / completeToDeliveredLeadTimes.length
    : null;

    setText(
      "kpiOpenOrders",
      formatNumber(open.length)
    );

    setText(
      "kpiAwaitingGoods",
      formatNumber(awaiting.length)
    );

    const awaitingGoodsElement =
      byId("kpiAwaitingGoods");

    if (awaitingGoodsElement) {
      awaitingGoodsElement
        .classList
        .toggle(
          "kpi-good",
          awaiting.length === 0
        );

      awaitingGoodsElement
        .classList
        .toggle(
          "kpi-warn",
          awaiting.length > 0
        );
    }

    setText(
      "kpiStockComplete",
      formatNumber(complete.length)
    );

    setText(
      "kpiMissingProducts",
      formatNumber(missingQty)
    );

    setText(
      "kpiDeliveredMonth",
      formatNumber(
        deliveredMonth.length
      )
    );

    setText(
      "kpiAvgLeadComplete",
      formatDays(
        avgCompleteToDelivered
      )
    );

    setText(
      "kpiAvgLeadImport",
      formatDays(
        avgCompleteToDelivered
      )
    );

    setText(
      "kpiConfirmedDates",
      formatPercent(
        confirmedPct
      )
    );

    setText(
      "kpiPodAvailable",
      formatNumber(
        podAvailable
      )
    );

    setText(
      "kpiInvoicesAvailable",
      formatNumber(
        invoicesAvailable
      )
    );

    setText(
      "kpiRetailers",
      formatNumber(
        retailers.size
      )
    );

    setText(
      "kpiAttention",
      formatNumber(
        attention.length
      )
    );
  }

  function bindKpiClicks() {
  const map = {
    kpiOpenOrders: "open",
    kpiAwaitingGoods: "awaiting",
    kpiStockComplete: "complete",
    kpiMissingProducts: "missing",
    kpiConfirmedDates: "confirmed_dates",
    kpiPodAvailable: "pod",
    kpiAttention: "attention"
  };

  Object.entries(map).forEach(([id, filter]) => {
    const valueElement = byId(id);

    const card = valueElement?.closest(
      ".kpi-card, .metric-card, .card"
    );

    if (
      !card ||
      card.dataset.kpiBound === "1"
    ) {
      return;
    }

    card.dataset.kpiBound = "1";
    card.dataset.kpiFilter = filter;
    card.style.cursor = "pointer";

    card.addEventListener("click", () => {
      activeKpiFilter =
        activeKpiFilter === filter
          ? ""
          : filter;

      document
        .querySelectorAll("[data-kpi-filter]")
        .forEach(element => {
          element.classList.toggle(
            "kpi-active",
            element.dataset.kpiFilter ===
              activeKpiFilter
          );
        });

      renderRecentOrders();

      const recent = byId(
        "recentOrdersBody"
      );

      recent
        ?.closest(
          "section, .card, .panel"
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
    });
  });

  const invoiceKpi =
    byId("kpiInvoicesAvailable")
      ?.closest(
        ".kpi-card, .metric-card, .card"
      );

  if (
    invoiceKpi &&
    invoiceKpi.dataset.billingBound !== "1"
  ) {
    invoiceKpi.dataset.billingBound = "1";
    invoiceKpi.style.cursor = "pointer";

    invoiceKpi.addEventListener(
      "click",
      () => {
        window.location.href =
          "./billing.html";
      }
    );
  }
}


  function groupOrderFlowLast30Days() {
    const days = new Map();

    const today = new Date();

    today.setHours(
      12,
      0,
      0,
      0
    );

    for (
      let offset = 29;
      offset >= 0;
      offset--
    ) {
      const date =
        new Date(today);

      date.setDate(
        today.getDate() - offset
      );

      days.set(
        dayKey(date),
        {
          imported: 0,
          delivered: 0
        }
      );
    }

    rawOrders
      .filter(order =>
        !isCancelled(order)
      )
      .forEach(order => {
        const importedKey =
          dayKey(
            getImportedDate(order)
          );

        if (
          importedKey &&
          days.has(importedKey)
        ) {
          days.get(importedKey)
            .imported += 1;
        }

        const deliveredKey =
          dayKey(
            getDeliveredDate(order)
          );

        if (
          deliveredKey &&
          days.has(deliveredKey) &&
          [
            "delivered",
            "invoiced",
            "closed"
          ].includes(
            order.lifecycle_status
          )
        ) {
          days.get(deliveredKey)
            .delivered += 1;
        }
      });

    return [
      ...days.entries()
    ];
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      charts[id] = null;
    }
  }

  function makeChart(
    id,
    config
  ) {
    const canvas = byId(id);

    if (
      !canvas ||
      !window.Chart
    ) {
      return;
    }

    destroyChart(id);

    charts[id] = new Chart(
      canvas,
      config
    );
  }

  function renderCharts() {
    const dailyOrderFlow =
      groupOrderFlowLast30Days();

    const dailyLabels =
      dailyOrderFlow.map(
        ([key]) =>
          dayLabel(key)
      );

    makeChart(
      "orderFlowChart",
      {
        type: "line",
        data: {
          labels: dailyLabels,
          datasets: [
            {
              label: "Imported",
              data:
                dailyOrderFlow.map(
                  (
                    [, row]
                  ) =>
                    row.imported
                ),
              tension: 0.3,
              pointRadius: 3,
              pointHoverRadius: 5
            },
            {
              label: "Delivered",
              data:
                dailyOrderFlow.map(
                  (
                    [, row]
                  ) =>
                    row.delivered
                ),
              tension: 0.3,
              pointRadius: 3,
              pointHoverRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            intersect: false,
            mode: "index"
          },
          plugins: {
            legend: {
              position: "bottom"
            }
          },
          scales: {
            x: {
              ticks: {
                autoSkip: true,
                maxTicksLimit: 15,
                maxRotation: 0
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                precision: 0,
                stepSize: 1
              }
            }
          }
        }
      }
    );

    const readinessOrders =
      filteredOrders.filter(
        order =>
          !isCancelled(order) &&
          ![
            "delivered",
            "invoiced",
            "closed"
          ].includes(
            order.lifecycle_status
          )
      );

    const complete =
      readinessOrders.filter(
        order =>
          order.product_completeness
            ?.status === "complete"
      ).length;

    const missing =
      readinessOrders.filter(
        order =>
          order.product_completeness
            ?.status === "missing"
      ).length;

    const none =
      readinessOrders.filter(
        order =>
          order.product_completeness
            ?.status === "none"
      ).length;

    makeChart(
      "stockReadinessChart",
      {
        type: "doughnut",
        data: {
          labels: [
            "Complete",
            "Missing",
            "No lines"
          ],
          datasets: [
            {
              data: [
                complete,
                missing,
                none
              ]
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom"
            }
          }
        }
      }
    );
  }

  function renderStatusBreakdown() {
    const box =
      byId(
        "statusBreakdownList"
      );

    if (!box) {
      return;
    }

    const rows = [
      "order_received",
      "awaiting_goods",
      "stock_complete",
      "picked",
      "on_transport",
      "delivered",
      "invoiced",
      "closed"
    ]
      .map(status => ({
        status,
        count:
          filteredOrders.filter(
            order =>
              order.lifecycle_status ===
              status
          ).length
      }))
      .filter(
        row =>
          row.count > 0
      );

    const max = Math.max(
      ...rows.map(
        row => row.count
      ),
      1
    );

    box.innerHTML = rows.length
      ? rows.map(row => `
          <div class="status-row">
            <div class="status-name">
              ${escapeHtml(
                statusLabel(
                  row.status
                )
              )}
            </div>

            <div class="status-bar">
              <div
                class="status-fill"
                style="width:${Math.round(
                  (
                    row.count /
                    max
                  ) * 100
                )}%"
              ></div>
            </div>

            <div class="status-count">
              ${formatNumber(
                row.count
              )}
            </div>
          </div>
        `).join("")
      : `
        <div class="status-row">
          <div class="status-name">
            No data
          </div>

          <div class="status-bar">
            <div
              class="status-fill"
              style="width:0%"
            ></div>
          </div>

          <div class="status-count">
            0
          </div>
        </div>
      `;
  }

  function renderAttentionOrders() {
    const body =
      byId(
        "attentionOrdersBody"
      );

    if (!body) {
      return;
    }

    const rows =
      filteredOrders
        .filter(isAttention)
        .slice(0, 12);

    body.innerHTML = rows.length
      ? rows.map(order => `
          <tr>
            <td>
              <strong>
                ${escapeHtml(
                  order.order_number ||
                  "—"
                )}
              </strong>

              ${
                order.external_reference
                  ? `
                    <span class="subline">
                      Supplier Ref:
                      ${escapeHtml(
                        order.external_reference
                      )}
                    </span>
                  `
                  : ""
              }
            </td>

            <td>
              ${escapeHtml(
                order.retailer_display ||
                "—"
              )}
            </td>

            <td>
              ${statusPill(
                order.lifecycle_status
              )}
            </td>

            <td>
              ${formatNumber(
                order.product_completeness
                  ?.missing || 0
              )}
            </td>

            <td>
              ${escapeHtml(
                formatDate(
                  getExpectedDate(order)
                )
              )}
            </td>

            <td>
              ${escapeHtml(
                attentionReason(order)
              )}
            </td>
          </tr>
        `).join("")
      : `
        <tr>
          <td colspan="6">
            No attention orders found.
          </td>
        </tr>
      `;
  }

  function renderRecentOrders() {
    const body =
      byId(
        "recentOrdersBody"
      );

    if (!body) {
      return;
    }

    const rows =
      filteredOrders
        .filter(order =>
          !isCancelled(order)
        )
        .filter(order =>
          ![
            "delivered",
            "invoiced",
            "closed"
          ].includes(
            order.lifecycle_status
          )
        )
        .filter(order =>
          isOpen(order)
        )
        .filter(order =>
          matchesKpiFilter(
            order,
            activeKpiFilter
          )
        )
        .slice(0, 20);

    body.innerHTML = rows.length
      ? rows.map(order => {
          const completeness =
            order.product_completeness ||
            {};

          const documents = [
            hasDocument(
              order,
              "acknowledgement"
            )
              ? "ACK"
              : "",
            hasDocument(
              order,
              "pod"
            )
              ? "POD"
              : "",
            hasDocument(
              order,
              "invoice"
            )
              ? "Invoice"
              : ""
          ].filter(Boolean);

          return `
            <tr>
              <td>
                <strong>
                  ${escapeHtml(
                    order.order_number ||
                    "—"
                  )}
                </strong>

                ${
                  order.external_reference
                    ? `
                      <span class="subline">
                        Supplier Ref:
                        ${escapeHtml(
                          order.external_reference
                        )}
                      </span>
                    `
                    : ""
                }
              </td>

              <td>
                ${escapeHtml(
                  order.purchase_order ||
                  "—"
                )}
              </td>

              <td>
                ${escapeHtml(
                  order.retailer_display ||
                  "—"
                )}
              </td>

              <td>
                ${escapeHtml(
                  order.postcode_display ||
                  "—"
                )}
              </td>

              <td>
                ${statusPill(
                  order.lifecycle_status
                )}
              </td>

              <td>
                ${formatNumber(
                  completeness.matched ||
                  0
                )}
                /
                ${formatNumber(
                  completeness.required ||
                  0
                )}
              </td>

              <td>
                ${escapeHtml(
                  formatDate(
                    order.requested_delivery_date
                  )
                )}
              </td>

              <td>
                ${escapeHtml(
                  formatDate(
                    getExpectedDate(order)
                  )
                )}
              </td>

              <td>
                ${
                  documents.length
                    ? escapeHtml(
                        documents.join(", ")
                      )
                    : "—"
                }
              </td>

              <td>
                ${escapeHtml(
                  actionReason(order)
                )}
              </td>
            </tr>
          `;
        }).join("")
      : `
        <tr>
          <td colspan="10">
            No recent orders found.
          </td>
        </tr>
      `;
  }

  function renderTopRetailers() {
    const body =
      byId(
        "topRetailersBody"
      );

    if (!body) {
      return;
    }

    const map = new Map();

    filteredOrders.forEach(
      order => {
        const key = [
          normalize(
            order.retailer_display
          ),
          normalize(
            order.postcode_display
          )
        ].join("|");

        if (!map.has(key)) {
          map.set(
            key,
            {
              retailer:
                order.retailer_display ||
                "—",
              postcode:
                order.postcode_display ||
                "—",
              open: 0,
              missing: 0,
              nextDates: []
            }
          );
        }

        const row =
          map.get(key);

        if (isOpen(order)) {
          row.open += 1;
        }

        row.missing += toNumber(
          order.product_completeness
            ?.missing,
          0
        );

        const expected =
          getExpectedDate(order);

        if (
          expected &&
          isOpen(order)
        ) {
          row.nextDates.push(
            expected
          );
        }
      }
    );

    const rows = [
      ...map.values()
    ]
      .filter(
        row =>
          row.open > 0 ||
          row.missing > 0
      )
      .sort(
        (a, b) =>
          b.open - a.open ||
          b.missing - a.missing
      )
      .slice(0, 12);

    body.innerHTML = rows.length
      ? rows.map(row => {
          const nextDate =
            row.nextDates
              .map(
                value =>
                  new Date(value)
              )
              .filter(
                date =>
                  !Number.isNaN(
                    date.getTime()
                  )
              )
              .sort(
                (a, b) =>
                  a - b
              )[0];

          return `
            <tr>
              <td>
                <strong>
                  ${escapeHtml(
                    row.retailer
                  )}
                </strong>
              </td>

              <td>
                ${escapeHtml(
                  row.postcode
                )}
              </td>

              <td>
                ${formatNumber(
                  row.open
                )}
              </td>

              <td>
                ${formatNumber(
                  row.missing
                )}
              </td>

              <td>
                ${escapeHtml(
                  nextDate
                    ? formatDate(
                        nextDate
                      )
                    : "—"
                )}
              </td>
            </tr>
          `;
        }).join("")
      : `
        <tr>
          <td colspan="5">
            No retailer activity found.
          </td>
        </tr>
      `;
  }

  function renderDocumentHub() {
    const orders =
      filteredOrders.filter(
        order =>
          !isLegacyOrder(order) &&
          !isCancelled(order)
      );

    const ackAvailable =
      orders.filter(order =>
        hasDocument(
          order,
          "acknowledgement"
        )
      ).length;

    const ackPending =
      orders.filter(order =>
        !hasDocument(
          order,
          "acknowledgement"
        )
      ).length;

    const podRelevantOrders =
      orders.filter(order =>
        [
          "delivered",
          "invoiced",
          "closed"
        ].includes(
          order.lifecycle_status
        )
      );

    const podAvailable =
      podRelevantOrders.filter(
        order =>
          hasDocument(
            order,
            "pod"
          )
      ).length;

    const podPending =
      podRelevantOrders.filter(
        order =>
          !hasDocument(
            order,
            "pod"
          )
      ).length;

const uniqueInvoices =
  getUniqueInvoices(orders);

const invoicePaid =
  uniqueInvoices.filter(invoice =>
    [
      "paid",
      "closed"
    ].includes(
      normalize(invoice.status)
    )
  ).length;

const invoicePending =
  uniqueInvoices.filter(invoice =>
    ![
      "paid",
      "closed"
    ].includes(
      normalize(invoice.status)
    )
  ).length;

    setText(
      "documentHubAckAvailable",
      formatNumber(
        ackAvailable
      )
    );

    setText(
      "documentHubAckPending",
      formatNumber(
        ackPending
      )
    );

    setText(
      "documentHubPodAvailable",
      formatNumber(
        podAvailable
      )
    );

    setText(
      "documentHubPodPending",
      formatNumber(
        podPending
      )
    );

    setText(
      "documentHubInvoiceAvailable",
      formatNumber(
        invoicePaid
      )
    );

    setText(
      "documentHubInvoicePending",
      formatNumber(
        invoicePending
      )
    );

    const completeOrders =
      orders.filter(order => {
        const ackComplete =
          hasDocument(
            order,
            "acknowledgement"
          );

        const podRequired =
          [
            "delivered",
            "invoiced",
            "closed"
          ].includes(
            order.lifecycle_status
          );

        const podComplete =
          !podRequired ||
          hasDocument(
            order,
            "pod"
          );

        const invoiceExists =
          hasDocument(
            order,
            "invoice"
          );

        const invoiceComplete =
          !invoiceExists ||
          normalize(
            order.finance_status
          ) === "paid";

        return (
          ackComplete &&
          podComplete &&
          invoiceComplete
        );
      }).length;

    setText(
      "documentHubSummary",
      `${formatNumber(
        completeOrders
      )} of ${formatNumber(
        orders.length
      )} visible orders have all currently required customer documents complete.`
    );

    document
      .querySelectorAll(
        "[data-document-filter]"
      )
      .forEach(button => {
        const type =
          button.dataset
            .documentFilter || "";

        button.classList.toggle(
          "is-active",
          type ===
            activeDocumentFilter
        );
      });
  }

  function bindDocumentHubClicks() {
    document
      .querySelectorAll(
        "[data-document-filter]"
      )
      .forEach(button => {
        if (
          button.dataset
            .documentBound === "1"
        ) {
          return;
        }

        button.dataset
          .documentBound = "1";

button.addEventListener(
  "click",
  () => {
    const type =
      button.dataset
        .documentFilter || "";

    if (type === "invoice") {
      window.location.href =
        "./billing.html";
      return;
    }

    activeDocumentFilter =
      activeDocumentFilter === type
        ? ""
        : type;

    renderDocumentHub();
    renderDocumentQueue();

    const queue =
      byId(
        "documentQueueBody"
      );

    queue
      ?.closest(
        "section, .card, .panel, article"
      )
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
  }
);
      });
  }

  function renderDocumentQueue() {
    const body =
      byId(
        "documentQueueBody"
      );

    if (!body) {
      return;
    }

    const rows =
      filteredOrders
        .filter(order =>
          !isLegacyOrder(order) &&
          !isCancelled(order)
        )
        .filter(order => {
          if (!activeDocumentFilter) {
            return true;
          }

          if (
            activeDocumentFilter ===
            "invoice"
          ) {
            return hasDocument(
              order,
              "invoice"
            );
          }

          if (
            activeDocumentFilter ===
            "pod"
          ) {
            return [
              "delivered",
              "invoiced",
              "closed"
            ].includes(
              order.lifecycle_status
            );
          }

          return true;
        })
        .sort((a, b) => {
          if (!activeDocumentFilter) {
            return 0;
          }

          const aAvailable =
            hasDocument(
              a,
              activeDocumentFilter
            );

          const bAvailable =
            hasDocument(
              b,
              activeDocumentFilter
            );

          if (
            aAvailable === bAvailable
          ) {
            return 0;
          }

          return aAvailable
            ? 1
            : -1;
        })
        .slice(0, 20);

    body.innerHTML = rows.length
      ? rows.map(order => {
          const invoiceExists =
            hasDocument(
              order,
              "invoice"
            );

          const invoicePaid =
            invoiceExists &&
            normalize(
              order.finance_status
            ) === "paid";

          const podRelevant =
            [
              "delivered",
              "invoiced",
              "closed"
            ].includes(
              order.lifecycle_status
            );

          return `
            <tr>
              <td>
                <strong>
                  ${escapeHtml(
                    order.order_number ||
                    "—"
                  )}
                </strong>

                ${
                  order.external_reference
                    ? `
                      <span class="subline">
                        Supplier Ref:
                        ${escapeHtml(
                          order.external_reference
                        )}
                      </span>
                    `
                    : ""
                }
              </td>

              <td>
                ${
                  hasDocument(
                    order,
                    "acknowledgement"
                  )
                    ? `
                      <span class="pill green">
                        Available
                      </span>
                    `
                    : `
                      <span class="pill gray">
                        Pending
                      </span>
                    `
                }
              </td>

              <td>
                ${
                  !podRelevant
                    ? `
                      <span class="pill gray">
                        Not required
                      </span>
                    `
                    : hasDocument(
                        order,
                        "pod"
                      )
                      ? `
                        <span class="pill green">
                          Available
                        </span>
                      `
                      : `
                        <span class="pill orange">
                          Pending
                        </span>
                      `
                }
              </td>

              <td>
                ${
                  !invoiceExists
                    ? `
                      <span class="pill gray">
                        Not created
                      </span>
                    `
                    : invoicePaid
                      ? `
                        <span class="pill green">
                          Paid
                        </span>
                      `
                      : `
                        <span class="pill orange">
                          Pending payment
                        </span>
                      `
                }
              </td>
            </tr>
          `;
        }).join("")
      : `
        <tr>
          <td colspan="4">
            No document activity found.
          </td>
        </tr>
      `;
  }

  function renderInsights() {
    const box =
      byId("insightList");

    if (!box) {
      return;
    }

    const open =
      filteredOrders.filter(
        isOpen
      );

    const missing =
      filteredOrders.filter(
        order =>
          toNumber(
            order.product_completeness
              ?.missing,
            0
          ) > 0
      );

    const deliveredMonth =
      filteredOrders.filter(
        isDeliveredThisMonth
      );

    const attention =
      filteredOrders.filter(
        isAttention
      );

    const withExpected =
      open.filter(order =>
        !!getExpectedDate(order)
      );

    const expectedPct =
      open.length
        ? Math.round(
            (
              withExpected.length /
              open.length
            ) * 100
          )
        : 0;

    const insights = [
      {
        title:
          "Orders requiring action",
        text:
          `${formatNumber(
            open.length
          )} visible order(s) still require customer-facing action.`
      },
      {
        title:
          "Stock readiness",
        text:
          `${formatNumber(
            missing.length
          )} order(s) currently have missing product quantities.`
      },
      {
        title:
          "Delivery visibility",
        text:
          `${formatPercent(
            expectedPct
          )} of open orders have an expected or confirmed delivery date.`
      },
      {
        title:
          "Monthly deliveries",
        text:
          `${formatNumber(
            deliveredMonth.length
          )} order(s) have been delivered in the current month.`
      },
      {
        title:
          "Attention queue",
        text:
          attention.length
            ? `${formatNumber(
                attention.length
              )} order(s) require customer-facing follow-up.`
            : "No customer-facing attention items are currently visible."
      }
    ];

    box.innerHTML = insights.map(
      item => `
        <div class="insight-item">
          <div class="insight-title">
            ${escapeHtml(
              item.title
            )}
          </div>

          <div class="insight-text">
            ${escapeHtml(
              item.text
            )}
          </div>
        </div>
      `
    ).join("");
  }

  function renderAll() {
    renderKpis();
    bindKpiClicks();

    renderCharts();
    renderStatusBreakdown();
    renderAttentionOrders();
    renderRecentOrders();
    renderTopRetailers();

    renderDocumentHub();
    bindDocumentHubClicks();
    renderDocumentQueue();

    renderInsights();
  }

  function bindEvents() {
    byId("dateRange")
      ?.addEventListener(
        "change",
        () => {
          applyFilters();
          renderAll();
        }
      );

    byId("statusFilter")
      ?.addEventListener(
        "change",
        () => {
          applyFilters();
          renderAll();
        }
      );

    byId("searchInput")
      ?.addEventListener(
        "input",
        () => {
          applyFilters();
          renderAll();
        }
      );

    byId("refreshBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await loadOrders();

            showToast(
              "Dashboard refreshed.",
              "ok"
            );
          } catch (error) {
            console.error(error);

            showToast(
              error.message ||
              "Could not refresh dashboard.",
              "err"
            );
          }
        }
      );

    byId("customerSelect")
      ?.addEventListener(
        "change",
        async event => {
          try {
            selectedCustomerId =
              event.target.value ||
              null;

            if (!selectedCustomerId) {
              return;
            }

            const selectedOption =
              event.target.options[
                event.target
                  .selectedIndex
              ];

            setText(
              "customerName",
              selectedOption
                ?.textContent
                ?.split("·")[0]
                ?.trim() ||
              "Customer"
            );

            setText(
              "customerMeta",
              "Customer selected by admin"
            );

            const url =
              new URL(
                window.location.href
              );

            url.searchParams.set(
              "customer_id",
              selectedCustomerId
            );

            window.history
              .replaceState(
                {},
                "",
                url.toString()
              );

            await loadOrders();
          } catch (error) {
            console.error(error);

            showToast(
              error.message ||
              "Could not switch customer.",
              "err"
            );
          }
        }
      );
  }

function openFdsPlanningImport() {
  byId("fdsPlanningFileInput")?.click();
}

function openFdsDeliveredImport() {
  byId("fdsDeliveredFileInput")?.click();
}

  async function init() {
    try {
      if (
        typeof sb !== "function"
      ) {
        throw new Error(
          "Supabase helper sb() is not available."
        );
      }

      client = sb();

      await loadProfile();

      if (
        !isTenantRole() &&
        !isProductOwnerRole()
      ) {
        throw new Error(
          "This dashboard is only available for Veynor, Sofa2U or product owner accounts."
        );
      }

      await resolveCustomer();
      bindEvents();
      await loadOrders();

      showToast(
        "Customer dashboard loaded.",
        "ok"
      );
    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
        "Could not load customer dashboard.",
        "err"
      );
    }
  }

  document.addEventListener(
    "DOMContentLoaded",
    init
  );
})();