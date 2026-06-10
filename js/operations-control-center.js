(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";
  const POD_BUCKET = "pod-assets";
  const ETA_WINDOW_HOURS = 2;

  let client = null;
  let companyId = null;
  let currentUser = null;
  let currentProfile = null;

  let allOrders = [];
  let filteredOrders = [];

  const selectedOrderIds = new Set();
  const expandedOrderIds = new Set();

  const sortState = {
    key: "activity",
    direction: "desc"
  };

  const STATUS_LABELS = {
    order_received: "Order received",
    awaiting_goods: "Awaiting goods",
    stock_complete: "Stock complete",
    planned: "Planned",
    on_transport: "On Transport",
    delivered: "Delivered",
    issue: "Issue",
    pending: "Pending",
    confirmed: "Confirmed",
    not_generated: "Not generated",
    generated: "Generated",
    sent: "Sent",
    signed: "Signed",
    not_invoiced: "Not invoiced",
    invoice_generated: "Invoice generated",
    invoice_sent: "Invoice sent",
    paid: "Paid",
    overdue: "Overdue"
  };

  const ROLE_LABELS = {
    veynor_admin: "Veynor Admin",
    tenant_admin: "Tenant Admin",
    tenant_user: "Tenant User",
    product_owner_admin: "Product Owner Admin",
    product_owner_user: "Product Owner",
    retailer_user: "Retailer"
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value ?? "";
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

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function shortText(value, maxLength = 70) {
    const text = cleanText(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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

  function formatMoney(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "£0.00";

    return `£${num.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatDate(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return d.toLocaleDateString("en-GB");
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return d.toLocaleString("en-GB");
  }

  function formatTime(value) {
    if (!value) return "";

    const text = String(value).trim();

    if (/^\d{1,2}:\d{2}$/.test(text)) {
      const [h, m] = text.split(":");
      return `${String(Number(h)).padStart(2, "0")}:${m}`;
    }

    if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) {
      const [h, m] = text.split(":");
      return `${String(Number(h)).padStart(2, "0")}:${m}`;
    }

    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    return text;
  }

  function addHoursToHHMM(time, hoursToAdd = ETA_WINDOW_HOURS) {
    const match = String(time || "").trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return "";

    let h = Number(match[1]);
    const m = Number(match[2]);

    if (!Number.isFinite(h) || !Number.isFinite(m)) return "";

    h = (h + hoursToAdd) % 24;

    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = "notice " + type;

    clearTimeout(window.__occToastTimer);
    window.__occToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 6500);
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    client = sb();
    return client;
  }

  function isTenantRole() {
    return ["veynor_admin", "tenant_admin", "tenant_user"].includes(normalize(currentProfile?.role));
  }

  function isProductOwnerRole() {
    return ["product_owner_admin", "product_owner_user"].includes(normalize(currentProfile?.role));
  }

  function isRetailerRole() {
    return normalize(currentProfile?.role) === "retailer_user";
  }

  function canGenerateDocuments() {
    return isTenantRole();
  }

  function canSeeFinance() {
    return isTenantRole() || isProductOwnerRole();
  }

  function canSelectOrders() {
    return isTenantRole();
  }

  function canSyncStatuses() {
    return isTenantRole();
  }

  function canSeeInternalPlanningData() {
    return isTenantRole();
  }

  function canSeeDocumentType(type) {
    const docType = normalize(type);

    if (isTenantRole()) return true;

    if (isProductOwnerRole()) {
      return ["supplier_packing_slip", "delivery_note", "pod", "signed_delivery_note", "invoice"].includes(docType);
    }

    if (isRetailerRole()) {
      return ["delivery_note", "pod", "signed_delivery_note"].includes(docType);
    }

    return false;
  }

  function statusLabel(value) {
    return STATUS_LABELS[normalize(value)] || String(value || "—").replaceAll("_", " ");
  }

  function statusClass(value) {
    const v = normalize(value);

    if (["order_received", "pending", "not_generated", "not_invoiced"].includes(v)) return "blue";
    if (["awaiting_goods", "planned", "invoice_generated"].includes(v)) return "orange";
    if (["stock_complete", "generated", "sent", "signed", "invoice_sent", "confirmed"].includes(v)) return "green";
    if (["on_transport", "out_for_delivery", "sent_to_driver", "loaded", "dispatched"].includes(v)) return "purple";
    if (["delivered", "paid"].includes(v)) return "green";
    if (["overdue", "issue", "delivery_issue", "returned", "failed_delivery"].includes(v)) return "red";

    return "gray";
  }

  function pill(value, customLabel = null) {
    return `<span class="status-pill ${statusClass(value)}">${escapeHtml(customLabel || statusLabel(value))}</span>`;
  }

  async function loadCurrentProfile() {
    const db = ensureClient();

    const { data: sessionData, error: sessionError } = await db.auth.getUser();
    if (sessionError) throw sessionError;

    currentUser = sessionData?.user || null;

    if (!currentUser?.id) {
      window.location.replace("/login.html");
      throw new Error("Not authenticated.");
    }

    let result = await db
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

    if (!result.data && !result.error) {
      result = await db
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
        .eq("auth_user_id", currentUser.id)
        .eq("is_active", true)
        .maybeSingle();
    }

    if (result.error) throw result.error;
    if (!result.data?.id) throw new Error("No active user profile found for this login.");

    currentProfile = result.data;
    document.body.classList.add(`role-${normalize(currentProfile.role)}`);

    const companyName = currentProfile.companies?.name || TENANT_NAME;
    const customerName = currentProfile.customers?.name || "";
    const roleLabel = ROLE_LABELS[normalize(currentProfile.role)] || currentProfile.role;

    if (isProductOwnerRole()) {
      setText("portalName", customerName || companyName);
      setText("roleBadge", (customerName || "PO").slice(0, 2).toUpperCase());
    } else if (isRetailerRole()) {
      setText("portalName", currentProfile.retailer_code || "Retailer");
      setText("roleBadge", "RT");
    } else {
      setText("portalName", companyName || TENANT_NAME);
      setText("roleBadge", companyName.slice(0, 2).toUpperCase() || "S2");
    }

    setText("portalRole", roleLabel);
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    if (currentProfile?.company_id) {
      companyId = currentProfile.company_id;
      return companyId;
    }

    const { data, error } = await client
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    companyId = data.id;
    return companyId;
  }

  function getMemo(order) {
    return cleanText(order?.memo || "");
  }
function removeContactLinesFromAddress(parts = []) {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneRegex = /(?:\+?\d[\d\s().-]{7,}\d)/;

  return (parts || [])
    .map(cleanText)
    .filter(Boolean)
    .filter(part => !emailRegex.test(part))
    .filter(part => {
      const digitCount = part.replace(/\D/g, "").length;
      return !(phoneRegex.test(part) && digitCount >= 9);
    });
}
 function getAddressText(order) {
  const postcode = cleanText(order.delivery_postcode || "");
  const country = cleanText(order.delivery_country || "");

  let parts = removeContactLinesFromAddress([
    order.delivery_address_1,
    order.delivery_address_2,
    order.delivery_address_3,
    order.delivery_address_4,
    order.delivery_city,
    order.delivery_postcode,
    order.delivery_country
  ]);

  parts = parts
    .flatMap(part => String(part || "").split(","))
    .map(cleanText)
    .filter(Boolean);

  const seen = new Set();

  parts = parts.filter(part => {
    const key = normalize(part).replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (postcode && !parts.some(part =>
    normalize(part).replace(/\s+/g, "").includes(normalize(postcode).replace(/\s+/g, ""))
  )) {
    parts.push(postcode);
  }

  if (country && !parts.some(part =>
    normalize(part).includes(normalize(country))
  )) {
    parts.push(country);
  }

  return parts.join(", ") || "—";
}

function getProductOwnerName(order) {
    return cleanText(order.customers?.name || order.product_owner_name || order.customer_name || "—");
  }

  function getRetailerName(order) {
    return cleanText(
      order.retail_name ||
      order.retailer_name ||
      order.delivery_name ||
      order.delivery_company ||
      order.recipient_name ||
      "—"
    );
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

    return `${pc || "NOPC"}-${name || "RET"}`;
  }

  function getRetailerCode(order) {
    return cleanText(order.retailer_code || makeRetailerCode(order.delivery_postcode, getRetailerName(order)));
  }

  function getProductOwnerCode(order) {
    return order.customers?.customer_code || order.customer_code || "—";
  }

  function getDoc(order, type) {
    const docs = Array.isArray(order.order_documents) ? order.order_documents : [];
    return docs.find(doc => normalize(doc.document_type) === normalize(type)) || null;
  }

  function docStatus(order, type) {
    return getDoc(order, type)?.document_status || "not_generated";
  }

  function getPodAssets(order) {
    return Array.isArray(order.order_pod_assets) ? order.order_pod_assets : [];
  }

  function getPodPhotos(order) {
    return getPodAssets(order)
      .filter(asset => normalize(asset.asset_type) === "photo" && asset.file_url)
      .map(asset => asset.file_url);
  }

  function getPodDocumentUrl(order) {
    const docs = Array.isArray(order.order_documents) ? order.order_documents : [];
    const assets = getPodAssets(order);

    const podDoc = docs.find(doc =>
      ["pod", "signed_delivery_note", "signed_pod_pdf"].includes(normalize(doc.document_type)) &&
      doc.file_url
    );

    if (podDoc?.file_url) return podDoc.file_url;
    if (order.pod_document_url) return order.pod_document_url;

    const signedAsset = assets.find(asset =>
      ["signed_delivery_note", "pod_pdf", "signed_pod_pdf"].includes(normalize(asset.asset_type)) &&
      asset.file_url
    );

    return signedAsset?.file_url || "";
  }

  function getRouteStop(order) {
    const stops = Array.isArray(order.route_stops) ? order.route_stops : [];
    if (!stops.length) return null;

    return stops
      .slice()
      .sort((a, b) => toNumber(a.stop_sequence || a.stop_number, 0) - toNumber(b.stop_sequence || b.stop_number, 0))[0];
  }

  function getPlannedEtaStart(order) {
    const stop = getRouteStop(order);

    return (
      stop?.planned_arrival_time ||
      stop?.arrival_eta ||
      stop?.eta ||
      order.delivery_eta_from ||
      order.planned_arrival_time ||
      ""
    );
  }

  function getRequestedDeliveryDate(order) {
    return order.requested_delivery_date || order.delivery_date || null;
  }

  function getExpectedDeliveryDate(order) {
    const stop = getRouteStop(order);

    return (
      order.expected_delivery_date ||
      order.confirmed_delivery_date ||
      order.planned_route_date ||
      order.routes?.planned_delivery_date ||
      order.routes?.route_date ||
      stop?.planned_delivery_date ||
      stop?.route_date ||
      null
    );
  }

  function getEtaStatus(order) {
    if (getPlannedEtaStart(order)) return "confirmed";
    if (getExpectedDeliveryDate(order)) return "planned";
    return "pending";
  }

  function getEtaDisplay(order) {
    const start = getPlannedEtaStart(order);

    if (!start) return "Time not confirmed yet";

    const from = formatTime(start);
    const to = formatTime(order.delivery_eta_to) || addHoursToHHMM(from, ETA_WINDOW_HOURS);

    return to ? `${from} - ${to}` : from;
  }

  function getDeliveryStatusLabel(order) {
    const etaStatus = getEtaStatus(order);
    if (etaStatus === "confirmed") return "ETA confirmed";
    if (etaStatus === "planned") return "Date planned";
    return "Pending";
  }

  function isDeliveryOverdue(order) {
    const dateValue = getExpectedDeliveryDate(order) || getRequestedDeliveryDate(order);
    if (!dateValue) return false;

    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;

    return d < todayStart() && !["delivered"].includes(order.derived_lifecycle_status);
  }

  function getLineRequiredQty(line) {
    return toNumber(line.quantity_ordered || line.quantity || 0, 0);
  }

  function getLineMatchedQty(line) {
    const allocs = Array.isArray(line.order_allocations) ? line.order_allocations : [];

    return allocs.filter(allocation =>
      !["cancelled", "removed", "unreserved"].includes(normalize(allocation.allocation_status))
    ).length;
  }

  function getLineSku(line) {
    return cleanText(line.sku_base || line.products?.sku_base || "—");
  }

  function getLineDescription(line) {
    return cleanText(line.description || line.products?.description || line.products?.name || "—");
  }

  function getLineRevenue(line) {
    const direct = toNumber(line.total_customer_charge, 0);
    if (direct > 0) return direct;

    const qty = getLineRequiredQty(line) || 1;

    const tariffTotal =
      toNumber(line.tariff_storage, 0) +
      toNumber(line.tariff_admin, 0) +
      toNumber(line.tariff_handling, 0) +
      toNumber(line.tariff_transport, 0);

    return tariffTotal * qty;
  }

  function getOrderRevenue(order) {
    const direct =
      toNumber(order.estimated_revenue_gbp, 0) ||
      toNumber(order.total_customer_charge, 0) ||
      toNumber(order.customer_charge_gbp, 0) ||
      toNumber(order.revenue_gbp, 0) ||
      toNumber(order.order_revenue_gbp, 0);

    if (direct > 0) return direct;

    return (order.order_lines || []).reduce((sum, line) => sum + getLineRevenue(line), 0);
  }

  function getProductCompleteness(order) {
    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];

    const required = lines.reduce((sum, line) => sum + getLineRequiredQty(line), 0);
    const matched = lines.reduce((sum, line) => {
      return sum + Math.min(getLineMatchedQty(line), getLineRequiredQty(line));
    }, 0);

    const missing = Math.max(0, required - matched);
    const pct = required > 0 ? Math.min(100, Math.round((matched / required) * 100)) : 0;

    const lineDetails = lines.map(line => {
      const requiredQty = getLineRequiredQty(line);
      const matchedQty = Math.min(getLineMatchedQty(line), requiredQty);
      const missingQty = Math.max(0, requiredQty - matchedQty);

      return {
        id: line.id,
        sku: getLineSku(line),
        description: getLineDescription(line),
        required: requiredQty,
        matched: matchedQty,
        missing: missingQty,
        complete: requiredQty > 0 && matchedQty >= requiredQty,
        revenue: getLineRevenue(line)
      };
    });

    let status = "none";
    if (required > 0 && missing <= 0) status = "complete";
    if (required > 0 && missing > 0) status = "missing";

    return {
      required,
      matched,
      missing,
      pct,
      status,
      lines: lineDetails
    };
  }

  function deriveFinanceStatus(order) {
    const explicit = normalize(order.finance_status || "");
    const invoice = getDoc(order, "invoice");

    if (normalize(invoice?.document_status) === "sent") return "invoice_sent";
    if (invoice?.file_url || normalize(invoice?.document_status) === "generated") return "invoice_generated";
    if (explicit && explicit !== "not_invoiced") return explicit;

    return "not_invoiced";
  }

  function deriveLifecycleStatus(order) {
    const status = normalize(order.status || "");
    const transportStatus = normalize(order.transport_status || "");
    const warehouseStatus = normalize(order.warehouse_status || "");
    const completeness = getProductCompleteness(order);

    if (status === "delivered" || transportStatus === "delivered") return "delivered";

    if (
      ["out_for_delivery", "sent_to_driver", "loaded", "dispatched", "on_transport"].includes(status) ||
      ["out_for_delivery", "sent_to_driver", "loaded", "dispatched", "on_transport"].includes(transportStatus)
    ) {
      return "on_transport";
    }

    if (
      status === "planned" ||
      transportStatus === "planned" ||
      order.route_id ||
      order.confirmed_delivery_date ||
      order.delivery_eta_from ||
      order.delivery_eta_to
    ) {
      return "planned";
    }

    if (completeness.required > 0 && completeness.missing <= 0) return "stock_complete";
    if (completeness.required > 0 && completeness.missing > 0) return "awaiting_goods";

    if (["delivery_issue", "returned", "failed_delivery", "issue"].includes(status)) return "issue";

    if (
      ["delivery_issue", "returned", "failed_delivery", "issue"].includes(transportStatus) &&
      status !== "delivered"
    ) {
      return "issue";
    }

    if (warehouseStatus === "stock_complete") return "stock_complete";

    return "order_received";
  }

  function compactLifecycleStep(order) {
    const status = normalize(order.derived_lifecycle_status || "");

    if (status === "delivered") return 4;
    if (["on_transport", "planned"].includes(status)) return 3;
    if (status === "stock_complete") return 2;
    return 1;
  }

  function enrichOrder(order) {
    const productCompleteness = getProductCompleteness(order);
    const lifecycle = deriveLifecycleStatus(order);
    const finance = deriveFinanceStatus(order);

    return {
      ...order,
      product_owner_name: getProductOwnerName(order),
      retailer_name: getRetailerName(order),
      retailer_code: getRetailerCode(order),
      customer_name: getProductOwnerName(order),
      customer_code_display: getProductOwnerCode(order),
      ship_to_address: getAddressText(order),
      product_completeness: productCompleteness,
      derived_lifecycle_status: lifecycle,
      derived_finance_status: finance,
      progress_level: compactLifecycleStep({
        ...order,
        product_completeness: productCompleteness,
        derived_lifecycle_status: lifecycle
      }),
      requested_delivery_date_display: getRequestedDeliveryDate(order),
      expected_delivery_date_display: getExpectedDeliveryDate(order),
      eta_status_display: getEtaStatus(order),
      eta_text_display: getEtaDisplay(order),
      delivery_status_label: getDeliveryStatusLabel(order),
      order_revenue_display: getOrderRevenue(order),
      pod_photo_count_display: getPodPhotos(order).length,
      pod_document_url_display: getPodDocumentUrl(order)
    };
  }

  async function loadOrders() {
    const cid = await getCompanyId();

    let query = client
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name,
          customer_code,
          customer_type,
          vat_number,
          billing_email
        ),
        routes (
          id,
          route_code,
          route_name,
          name,
          route_date,
          planned_delivery_date,
          planned_start_time,
          planned_end_time,
          eta_finalized,
          route_status,
          driver_name,
          vehicle_name,
          estimated_revenue_gbp,
          estimated_cost_total_gbp,
          estimated_profit_gbp,
          estimated_margin_percentage
        ),
        route_stops (
          id,
          order_id,
          stop_sequence,
          stop_number,
          planned_arrival_time,
          planned_departure_time,
          arrival_eta,
          departure_eta,
          eta,
          etd,
          completed_at,
          delivery_time,
          delivery_date,
          status,
          delivery_status
        ),
        order_documents (
          id,
          company_id,
          customer_id,
          order_id,
          document_type,
          document_number,
          document_status,
          file_url,
          storage_path,
          sent_at,
          customer_visible,
          created_at,
          updated_at
        ),
        order_pod_assets (
          id,
          company_id,
          order_id,
          asset_type,
          file_name,
          file_url,
          storage_path,
          mime_type,
          notes,
          captured_at,
          captured_by_name
        ),
        order_activity_log (
          id,
          activity_type,
          old_status,
          new_status,
          description,
          created_by,
          created_at
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
            volume_m3
          ),
          order_allocations (
            id,
            allocation_status
          )
        )
      `)
      .eq("company_id", cid)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (isProductOwnerRole() && currentProfile.customer_id) {
      query = query.eq("customer_id", currentProfile.customer_id);
    }

    if (isRetailerRole() && currentProfile.retailer_code) {
      query = query.eq("retailer_code", currentProfile.retailer_code);
    }

    const { data, error } = await query;
    if (error) throw error;

    allOrders = (data || []).map(enrichOrder);

    selectedOrderIds.forEach(id => {
      if (!allOrders.some(order => String(order.id) === String(id))) {
        selectedOrderIds.delete(id);
      }
    });

    expandedOrderIds.forEach(id => {
      if (!allOrders.some(order => String(order.id) === String(id))) {
        expandedOrderIds.delete(id);
      }
    });

    applyFilters();
    renderAll();
  }

  function sortValue(order, key) {
    if (key === "order") return normalize(order.order_number || "");
    if (key === "customer") return normalize(order.product_owner_name || "");
    if (key === "ship_to") return normalize(order.ship_to_address || "");
    if (key === "products") return toNumber(order.product_completeness?.pct, 0);
    if (key === "progress") return toNumber(order.progress_level, 0);
    if (key === "finance") return normalize(order.derived_finance_status || "");
    if (key === "confirmed_date") return getExpectedDeliveryDate(order) ? new Date(getExpectedDeliveryDate(order)).getTime() : 0;
    if (key === "activity") return order.last_activity_at ? new Date(order.last_activity_at).getTime() : 0;

    return normalize(order.order_number || "");
  }

  function sortOrders() {
    const direction = sortState.direction === "desc" ? -1 : 1;

    filteredOrders.sort((a, b) => {
      const av = sortValue(a, sortState.key);
      const bv = sortValue(b, sortState.key);

      if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;

      return String(av).localeCompare(String(bv), "en", {
        numeric: true,
        sensitivity: "base"
      }) * direction;
    });
  }

  function updateSortIndicators() {
    document.querySelectorAll("[data-sort-indicator]").forEach(el => {
      const key = el.getAttribute("data-sort-indicator");
      el.textContent = key === sortState.key
        ? (sortState.direction === "asc" ? "▲" : "▼")
        : "";
    });
  }

  function applyFilters() {
    const q = normalize(byId("filterSearch")?.value || "");
    const lifecycle = normalize(byId("filterLifecycle")?.value || "");
    const productsFilter = normalize(byId("filterProducts")?.value || "");
    const documentFilter = normalize(byId("filterDocument")?.value || "");
    const finance = canSeeFinance() ? normalize(byId("filterFinance")?.value || "") : "";
    const dateStatus = normalize(byId("filterDateStatus")?.value || "");

    filteredOrders = allOrders.filter(order => {
      if (lifecycle) {
        const compact = compactLifecycleStep(order);
        const lifecycleMatches =
          order.derived_lifecycle_status === lifecycle ||
          (lifecycle === "order_received" && compact === 1) ||
          (lifecycle === "stock_complete" && compact === 2) ||
          (lifecycle === "planned" && compact === 3) ||
          (lifecycle === "on_transport" && compact === 3) ||
          (lifecycle === "delivered" && compact === 4);

        if (!lifecycleMatches) return false;
      }

      if (finance && order.derived_finance_status !== finance) return false;
      if (productsFilter && order.product_completeness?.status !== productsFilter) return false;

      if (dateStatus === "confirmed_missing" && getExpectedDeliveryDate(order)) return false;
      if (dateStatus === "confirmed_set" && !getExpectedDeliveryDate(order)) return false;
      if (dateStatus === "eta_confirmed" && getEtaStatus(order) !== "confirmed") return false;
      if (dateStatus === "eta_pending" && getEtaStatus(order) === "confirmed") return false;
      if (dateStatus === "overdue_delivery" && !isDeliveryOverdue(order)) return false;

      if (documentFilter) {
        const ack = docStatus(order, "acknowledgement");
        const packing = docStatus(order, "supplier_packing_slip");
        const deliveryNote = docStatus(order, "delivery_note");
        const pod = !!getPodDocumentUrl(order) || normalize(order.pod_status) === "signed";
        const inv = docStatus(order, "invoice");

        if (documentFilter === "missing_ack" && ack !== "not_generated") return false;
        if (documentFilter === "ack_sent" && ack !== "sent") return false;
        if (documentFilter === "missing_packing_slip" && packing !== "not_generated") return false;
        if (documentFilter === "packing_slip_generated" && packing !== "generated") return false;
        if (documentFilter === "missing_delivery_note" && deliveryNote !== "not_generated") return false;
        if (documentFilter === "delivery_note_generated" && deliveryNote !== "generated") return false;
        if (documentFilter === "missing_pod" && pod) return false;
        if (documentFilter === "pod_generated" && !pod) return false;
        if (documentFilter === "invoice_missing" && inv !== "not_generated") return false;
        if (documentFilter === "invoice_sent" && inv !== "sent") return false;
      }

      if (q) {
        const lineText = (order.order_lines || []).map(line => [
          line.sku_base,
          line.products?.sku_base,
          line.description,
          line.products?.name,
          line.products?.description
        ].join(" ")).join(" ");

        const haystack = [
          order.order_number,
          order.external_reference,
          order.purchase_order,
          getMemo(order),
          order.product_owner_name,
          order.customer_code_display,
          order.retailer_name,
          order.retailer_code,
          order.ship_to_address,
          order.delivery_postcode,
          order.status,
          order.routes?.route_code,
          order.routes?.driver_name,
          order.routes?.vehicle_name,
          lineText
        ].join(" ").toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    sortOrders();
    cleanSelectionAfterFilter();
  }

  function cleanSelectionAfterFilter() {
    const existingIds = new Set(allOrders.map(order => String(order.id)));
    selectedOrderIds.forEach(id => {
      if (!existingIds.has(String(id))) selectedOrderIds.delete(id);
    });
  }

  function getSelectedOrders() {
    return allOrders.filter(order => selectedOrderIds.has(String(order.id)));
  }

  function getVisibleIds() {
    return filteredOrders.map(order => String(order.id));
  }

  function updateSelectionUi() {
    const selectedCount = selectedOrderIds.size;
    const visibleIds = getVisibleIds();
    const visibleSelectedCount = visibleIds.filter(id => selectedOrderIds.has(id)).length;

    setText("selectedOrdersMeta", `${formatNumber(selectedCount)} selected`);

    const btnInvoice = byId("btnGenerateCombinedInvoice");
    if (btnInvoice) btnInvoice.disabled = selectedCount === 0 || !canSelectOrders();

    const selectAll = byId("selectAllVisibleOrders");
    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
      selectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;
    }

    document.querySelectorAll(".order-select-checkbox").forEach(input => {
      const id = String(input.dataset.orderId || "");
      input.checked = selectedOrderIds.has(id);
    });
  }

  function renderKpis() {
    setText("kpiTotal", formatNumber(filteredOrders.length));
    setText("kpiAwaitingGoods", formatNumber(filteredOrders.filter(o => compactLifecycleStep(o) === 1).length));
    setText("kpiStockComplete", formatNumber(filteredOrders.filter(o => compactLifecycleStep(o) === 2).length));
    setText("kpiExpectedDelivery", formatNumber(filteredOrders.filter(o => compactLifecycleStep(o) === 3).length));
    setText("kpiDelivered", formatNumber(filteredOrders.filter(o => compactLifecycleStep(o) === 4).length));
    setText("kpiProductsMissing", formatNumber(filteredOrders.filter(o => o.product_completeness?.status === "missing").length));
    setText("kpiEtaConfirmed", formatNumber(filteredOrders.filter(o => getEtaStatus(o) === "confirmed").length));

    setText(
      "kpiInvoicePending",
      formatNumber(filteredOrders.filter(order =>
        order.derived_finance_status === "not_invoiced" &&
        ["delivered", "on_transport", "stock_complete", "planned"].includes(order.derived_lifecycle_status)
      ).length)
    );

    setText("resultsMeta", `${formatNumber(filteredOrders.length)} orders shown`);
  }

  function renderCompactLifecycle(order) {
    const step = compactLifecycleStep(order);
    const isIssue = order.derived_lifecycle_status === "issue";

    const statusText = isIssue
      ? "Issue"
      : step === 4
        ? "Delivered"
        : step === 3
          ? "Planned / Transport"
          : step === 2
            ? "Stock Complete"
            : "Order Received";

    function stepClass(index) {
      if (isIssue && index === 1) return "wait";
      if (index > step) return "";
      if (index === 1) return "done";
      if (index === 2) return "stock";
      if (index === 3) return "transport";
      if (index === 4) return "delivery";
      return "";
    }

    function connectorClass(index) {
      if (index >= step) return "";
      if (index === 1) return "done";
      if (index === 2) return "stock";
      if (index === 3) return "transport";
      return "";
    }

    const labelClass =
      isIssue ? "orange" :
      step === 1 ? "blue" :
      step === 2 ? "green" :
      step === 3 ? "purple" :
      "green";

    return `
      <div class="mini-lifecycle">
        <div class="mini-lifecycle-line">
          <span class="mini-life-step ${stepClass(1)}">1</span>
          <span class="mini-life-connector ${connectorClass(1)}"></span>
          <span class="mini-life-step ${stepClass(2)}">2</span>
          <span class="mini-life-connector ${connectorClass(2)}"></span>
          <span class="mini-life-step ${stepClass(3)}">3</span>
          <span class="mini-life-connector ${connectorClass(3)}"></span>
          <span class="mini-life-step ${stepClass(4)}">4</span>
        </div>

        <div class="mini-life-label ${labelClass}">
          ${escapeHtml(statusText)}
        </div>
      </div>
    `;
  }

  function renderCompletenessDonut(order) {
    const c = order.product_completeness || getProductCompleteness(order);
    const pct = Math.max(0, Math.min(100, toNumber(c.pct, 0)));
    const complete = c.status === "complete";

    let fill = "#f97316";
    if (pct <= 25 && !complete) fill = "#ef4444";
    if (complete) fill = "#16a34a";

    const label = c.status === "none"
      ? "No lines"
      : complete
        ? "Complete"
        : `${formatNumber(pct, 0)}%`;

    return `
      <div class="colli-wrap">
        <div
          class="colli-donut ${complete ? "complete" : ""}"
          style="--pct:${escapeHtml(pct)};--fill:${escapeHtml(fill)};"
          title="${escapeHtml(label)}">
        </div>

        <div>
          <span class="colli-count">${formatNumber(c.matched, 0)} / ${formatNumber(c.required, 0)}</span>
          <span class="colli-percent">${escapeHtml(label)}</span>
        </div>
      </div>
    `;
  }

  function getVisibleDocumentTypes() {
    return [
      ["acknowledgement", "ACK"],
      ["supplier_packing_slip", "Packing Slip"],
      ["delivery_note", "Delivery Note"],
      ["pod", "POD"],
      ["invoice", "Invoice"]
    ].filter(([type]) => canSeeDocumentType(type));
  }

  function documentIsGenerated(order, type) {
    if (type === "pod") return !!getPodDocumentUrl(order) || normalize(order.pod_status) === "signed";

    const doc = getDoc(order, type);
    return !!doc?.file_url || (doc && normalize(doc.document_status) !== "not_generated");
  }

  function renderCompactDocuments(order) {
    const docs = getVisibleDocumentTypes(order);
    const total = docs.length;
    const generated = docs.filter(([type]) => documentIsGenerated(order, type)).length;

    const cls = generated === total ? "good" : generated > 0 ? "warn" : "bad";

    return `
      <div class="doc-compact">
        <span class="doc-icon">📄</span>
        <span class="doc-count ${cls}">${generated}/${total}</span>
      </div>
    `;
  }

  function renderDeliveryCell(order) {
    const expectedDate = getExpectedDeliveryDate(order);
    const etaStatus = getEtaStatus(order);

    const etaPill = etaStatus === "confirmed"
      ? pill("confirmed", "ETA confirmed")
      : etaStatus === "planned"
        ? pill("planned", "Date planned")
        : pill("pending", "Pending");

    return `
      <div class="delivery-cell">
        <strong>${escapeHtml(formatDate(expectedDate))}</strong>
        ${etaPill}
        <span class="subline">${escapeHtml(getEtaDisplay(order))}</span>
      </div>
    `;
  }

  function renderFinanceCell(order) {
    return `
      <div class="finance-metric">
        ${pill(order.derived_finance_status)}
        ${canSeeInternalPlanningData() ? `<strong>${formatMoney(getOrderRevenue(order))}</strong>` : ""}
      </div>
    `;
  }

  function renderMemoLink(order, maxLength = 70) {
    const memo = getMemo(order);
    if (!memo) return `<span class="subline">Memo: —</span>`;

    return `
      <span class="subline memo-link" data-memo-order-id="${escapeHtml(order.id)}">
        Memo: ${escapeHtml(shortText(memo, maxLength))}
      </span>
    `;
  }

  function renderProductLines(order) {
    const c = order.product_completeness || getProductCompleteness(order);

    if (!c.lines.length) {
      return `<div class="detail-line"><span class="detail-label">Products</span><span class="detail-value">No product lines found.</span></div>`;
    }

    return c.lines.map(line => `
      <div class="detail-line">
        <span class="detail-label">${escapeHtml(line.sku)}</span>
        <span class="detail-value">
          ${escapeHtml(shortText(line.description, 54))}
          <span class="subline">
            Ordered ${formatNumber(line.required, 0)}
            · Matched ${formatNumber(line.matched, 0)}
            ${line.missing > 0 ? `· Missing ${formatNumber(line.missing, 0)}` : `· Complete`}
            ${canSeeFinance() ? `· ${formatMoney(line.revenue)}` : ""}
          </span>
        </span>
      </div>
    `).join("");
  }

  function renderDocumentAction(order, type, label) {
    const doc = getDoc(order, type);
    const status = doc?.document_status || "not_generated";
    const url = type === "pod" ? getPodDocumentUrl(order) : doc?.file_url || "";

    if (url) {
      return `<a class="quick-action" href="${escapeHtml(url)}" target="_blank" rel="noopener"><span>${escapeHtml(label)}</span><span>Download</span></a>`;
    }

    if (canGenerateDocuments() && type !== "supplier_packing_slip" && type !== "pod") {
      return `
        <button class="quick-action" type="button" data-doc-action="${escapeHtml(type)}" data-order-id="${escapeHtml(order.id)}">
          <span>${escapeHtml(label)}</span>
          <span>Generate</span>
        </button>
      `;
    }

    return `
      <div class="quick-action" style="opacity:.7;">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(statusLabel(status))}</span>
      </div>
    `;
  }

  function renderDocumentsPanel(order) {
    const docs = getVisibleDocumentTypes(order);
    const photos = getPodPhotos(order);

    return `
      <div class="quick-action-list">
        ${docs.map(([type, label]) => renderDocumentAction(order, type, label)).join("")}

        ${
          canSeeDocumentType("pod")
            ? photos.length
              ? `<button class="quick-action" type="button" data-open-pod-photos="${escapeHtml(order.id)}"><span>Delivery Photos</span><span>${photos.length}/5</span></button>`
              : `<div class="quick-action" style="opacity:.7;"><span>Delivery Photos</span><span>No photos</span></div>`
            : ""
        }

        ${
          isTenantRole()
            ? `
              <button class="quick-action" type="button" data-manual-ops-order-id="${escapeHtml(order.id)}">
                <span>Manual delivery / POD</span>
                <span>Open</span>
              </button>

              <button class="quick-action" type="button" data-open-tariff-modal="${escapeHtml(order.id)}">
                <span>Finance / Tariffs</span>
                <span>Edit</span>
              </button>
            `
            : ""
        }
      </div>
    `;
  }

  function renderExpandedRow(order) {
    const c = order.product_completeness || getProductCompleteness(order);
    const latestActivity = Array.isArray(order.order_activity_log) ? order.order_activity_log[0] : null;

    return `
      <tr class="expanded-row" data-expanded-order-id="${escapeHtml(order.id)}">
        <td colspan="13">
          <div class="order-expanded-panel">
            <div class="expanded-tabs">
              <button class="expanded-tab active" type="button">Overview</button>
              <button class="expanded-tab" type="button">Documents</button>
              <button class="expanded-tab" type="button">Products</button>
              <button class="expanded-tab" type="button">Delivery</button>
              ${canSeeFinance() ? `<button class="expanded-tab" type="button">Finance</button>` : ""}
            </div>

            <div class="expanded-grid">
              <section class="detail-box">
                <h3>Order Details</h3>
              <div class="detail-line"><span class="detail-label">Order</span><span class="detail-value">${escapeHtml(order.order_number || "—")}</span></div>
<div class="detail-line"><span class="detail-label">Supplier ref</span><span class="detail-value">${escapeHtml(order.external_reference || "—")}</span></div>
<div class="detail-line"><span class="detail-label">PO</span><span class="detail-value">${escapeHtml(order.purchase_order || "—")}</span></div>
                <div class="detail-line"><span class="detail-label">Owner</span><span class="detail-value">${escapeHtml(order.product_owner_name || "—")}</span></div>
                <div class="detail-line"><span class="detail-label">Retailer</span><span class="detail-value">${escapeHtml(order.retailer_name || "—")}</span></div>
                <div class="detail-line"><span class="detail-label">Ship to</span><span class="detail-value">${escapeHtml(order.ship_to_address || "—")}</span></div>
              </section>

              <section class="detail-box">
                <h3>Lifecycle</h3>
                <div class="detail-line"><span class="detail-label">Current</span><span class="detail-value">${pill(order.derived_lifecycle_status)}</span></div>
                <div class="detail-line"><span class="detail-label">Completeness</span><span class="detail-value">${formatNumber(c.matched, 0)} / ${formatNumber(c.required, 0)} colli · ${formatNumber(c.pct, 0)}%</span></div>
                <div class="detail-line"><span class="detail-label">Requested</span><span class="detail-value">${escapeHtml(formatDate(getRequestedDeliveryDate(order)))}</span></div>
                <div class="detail-line"><span class="detail-label">Expected</span><span class="detail-value">${escapeHtml(formatDate(getExpectedDeliveryDate(order)))}</span></div>
                <div class="detail-line"><span class="detail-label">ETA</span><span class="detail-value">${escapeHtml(getEtaDisplay(order))}</span></div>
              </section>

              <section class="detail-box">
                <h3>Documents</h3>
                ${renderDocumentsPanel(order)}
              </section>

              <section class="detail-box">
                <h3>Products</h3>
                ${renderProductLines(order)}
              </section>

              <section class="detail-box">
                <h3>${canSeeFinance() ? "Finance / Activity" : "Activity"}</h3>
                ${canSeeFinance() ? `<div class="detail-line"><span class="detail-label">Finance</span><span class="detail-value">${pill(order.derived_finance_status)}</span></div>` : ""}
                ${canSeeInternalPlanningData() ? `<div class="detail-line"><span class="detail-label">Revenue</span><span class="detail-value">${formatMoney(getOrderRevenue(order))}</span></div>` : ""}
                <div class="detail-line"><span class="detail-label">Route</span><span class="detail-value">${escapeHtml(order.routes?.route_code || order.routes?.name || "—")}</span></div>
                <div class="detail-line"><span class="detail-label">Driver</span><span class="detail-value">${escapeHtml(order.routes?.driver_name || "—")}</span></div>
                <div class="detail-line"><span class="detail-label">Last activity</span><span class="detail-value">${escapeHtml(latestActivity?.description || order.delivery_status_label || "—")}</span></div>
              </section>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function renderTable() {
    const tbody = byId("ordersBody");
    if (!tbody) return;

    updateSortIndicators();

    if (!filteredOrders.length) {
      tbody.innerHTML = `<tr><td colspan="13">No orders found.</td></tr>`;
      updateSelectionUi();
      return;
    }

    const rows = [];

    filteredOrders.forEach(order => {
      const orderId = String(order.id);
      const checked = selectedOrderIds.has(orderId) ? "checked" : "";
      const expanded = expandedOrderIds.has(orderId);

      rows.push(`
        <tr class="order-row ${expanded ? "is-expanded" : ""}" data-order-id="${escapeHtml(orderId)}">
          ${
            canSelectOrders()
              ? `
                <td class="order-select-cell select-column tenant-only">
                  <input type="checkbox" class="order-select-checkbox" data-order-id="${escapeHtml(orderId)}" ${checked}/>
                </td>
              `
              : ""
          }

          <td class="expand-cell">
            <button class="expand-btn" type="button" data-expand-order-id="${escapeHtml(orderId)}">
              ${expanded ? "−" : "+"}
            </button>
          </td>

       <td>
  <span class="order-ref">${escapeHtml(order.order_number || "—")}</span>
  <span class="subline">PO: ${escapeHtml(order.purchase_order || "—")}</span>
  ${isRetailerRole() ? "" : renderMemoLink(order, 55)}
</td>

<td>
  <strong>${escapeHtml(order.external_reference || "—")}</strong>
  <span class="subline">Supplier / ACK ref</span>
</td>

          ${
            !isRetailerRole()
              ? `
                <td class="owner-cell product-owner-only">
                  <strong>${escapeHtml(order.product_owner_name || "—")}</strong>
                  <span class="subline">${escapeHtml(order.customer_code_display || "—")}</span>
                </td>
              `
              : ""
          }

          <td class="retailer-cell">
            <strong>${escapeHtml(order.retailer_name || "—")}</strong>
            <span class="subline">${escapeHtml(order.retailer_code || "—")}</span>
          </td>

          <td class="ship-to-cell">${escapeHtml(order.ship_to_address || "—")}</td>
          <td>${renderCompactLifecycle(order)}</td>
          <td>${renderCompletenessDonut(order)}</td>
          <td>${renderCompactDocuments(order)}</td>
          <td class="eta-cell">${renderDeliveryCell(order)}</td>
          ${canSeeFinance() ? `<td class="finance-cell finance-column">${renderFinanceCell(order)}</td>` : ""}
          <td class="activity-cell">
            ${escapeHtml(formatDateTime(order.last_activity_at || order.created_at))}
            <span class="subline">${escapeHtml(order.order_activity_log?.[0]?.description || order.delivery_status_label || "—")}</span>
          </td>
          <td class="actions-cell">
            ${
              isTenantRole()
                ? `<button class="action-menu-btn tenant-only" type="button" data-manual-ops-order-id="${escapeHtml(orderId)}">⋯</button>`
                : `<button class="action-menu-btn" type="button" data-expand-order-id="${escapeHtml(orderId)}">⋯</button>`
            }
          </td>
        </tr>
      `);

      if (expanded) rows.push(renderExpandedRow(order));
    });

    tbody.innerHTML = rows.join("");
    bindTableEvents();
    updateSelectionUi();
  }

  function bindTableEvents() {
    const tbody = byId("ordersBody");
    if (!tbody) return;

    tbody.querySelectorAll(".order-select-checkbox").forEach(input => {
      input.addEventListener("click", event => event.stopPropagation());

      input.addEventListener("change", () => {
        const id = String(input.dataset.orderId || "");
        if (input.checked) selectedOrderIds.add(id);
        else selectedOrderIds.delete(id);
        updateSelectionUi();
      });
    });

    tbody.querySelectorAll("[data-expand-order-id]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();

        const id = String(button.getAttribute("data-expand-order-id") || "");

        if (expandedOrderIds.has(id)) expandedOrderIds.delete(id);
        else expandedOrderIds.add(id);

        renderTable();
      });
    });

    tbody.querySelectorAll("[data-manual-ops-order-id]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        openManualOpsModal(button.dataset.manualOpsOrderId || button.getAttribute("data-manual-ops-order-id"));
      });
    });

    tbody.querySelectorAll("[data-open-tariff-modal]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        openTariffModal(button.getAttribute("data-open-tariff-modal"));
      });
    });

    tbody.querySelectorAll("[data-doc-action]").forEach(button => {
      button.addEventListener("click", async event => {
        event.stopPropagation();

        const orderId = button.getAttribute("data-order-id");
        const docType = button.getAttribute("data-doc-action");

        try {
          if (docType === "acknowledgement") return generateAcknowledgement(orderId);
          if (docType === "delivery_note") return generateDeliveryNote(orderId);
          if (docType === "invoice") return generateSingleInvoice(orderId);

          return createPlaceholderDocument(orderId, docType);
        } catch (error) {
          console.error(error);
          showToast(error.message || "Could not generate document.", "err");
        }
      });
    });

    tbody.querySelectorAll("[data-memo-order-id]").forEach(el => {
      el.addEventListener("click", event => {
        event.stopPropagation();
        openMemoModal(el.dataset.memoOrderId);
      });
    });

    tbody.querySelectorAll("[data-open-pod-photos]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        openPhotoModal(button.dataset.openPodPhotos);
      });
    });
  }

  function renderAll() {
    renderKpis();
    renderTable();
    updateSelectionUi();
  }

  function ensurePageStyles() {
    if (byId("occGeneratedStyles")) return;

    const style = document.createElement("style");
    style.id = "occGeneratedStyles";

    style.textContent = `
      .occ-memo-modal-backdrop{
        position:fixed;
        inset:0;
        z-index:9999;
        background:rgba(15,23,42,.45);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px
      }

      .occ-memo-modal-card{
        width:min(760px,96vw);
        background:#fff;
        border-radius:18px;
        box-shadow:0 24px 60px rgba(15,23,42,.25);
        padding:18px
      }

      .occ-memo-modal-head{
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:center;
        margin-bottom:12px
      }

      .occ-memo-modal-text{
        white-space:pre-wrap;
        border:1px solid #d1d5db;
        border-radius:12px;
        padding:12px;
        min-height:140px;
        max-height:60vh;
        overflow:auto;
        background:#f8fafc
      }

      .occ-photo-grid{
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
        gap:12px
      }

      .occ-photo-grid img{
        width:100%;
        height:140px;
        object-fit:cover;
        border-radius:12px;
        border:1px solid #d1d5db
      }

      .manual-tariff-table-wrap{
        overflow:auto;
        border:1px solid #dce5f2;
        border-radius:12px;
        background:#fff
      }

      .manual-tariff-table{
        width:100%;
        min-width:980px;
        border-collapse:collapse
      }

      .manual-tariff-table th,
      .manual-tariff-table td{
        padding:9px 10px;
        border-bottom:1px solid #e5edf7;
        text-align:left;
        vertical-align:middle;
        font-size:12px
      }

      .manual-tariff-table th{
        background:#f8fafc;
        color:#334155;
        font-size:10px;
        font-weight:950;
        text-transform:uppercase;
        letter-spacing:.04em
      }

      .manual-tariff-table input{
        width:100%;
        min-height:34px;
        border:1px solid #dce5f2;
        border-radius:9px;
        padding:7px 9px;
        font-size:12px
      }

      .manual-tariff-total{
        font-weight:950;
        color:#07152f;
        white-space:nowrap
      }

      .manual-tariff-footer{
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:center;
        flex-wrap:wrap
      }

      .manual-tariff-summary{
        font-size:12px;
        color:#334155;
        font-weight:850
      }
    `;

    document.head.appendChild(style);
  }

  function openMemoModal(orderId) {
    ensurePageStyles();

    const order = allOrders.find(row => String(row.id) === String(orderId));
    if (!order) return;

    const modal = document.createElement("div");
    modal.className = "occ-memo-modal-backdrop";
    modal.innerHTML = `
      <section class="occ-memo-modal-card">
        <div class="occ-memo-modal-head">
          <strong>Memo · ${escapeHtml(order.order_number || "Order")}</strong>
          <button class="mini-btn" type="button" data-close>Close</button>
        </div>
        <div class="occ-memo-modal-text">${escapeHtml(getMemo(order) || "No memo available.")}</div>
      </section>
    `;

    modal.addEventListener("click", event => {
      if (event.target === modal || event.target.hasAttribute("data-close")) {
        modal.remove();
      }
    });

    document.body.appendChild(modal);
  }

  function openPhotoModal(orderId) {
    ensurePageStyles();

    const order = allOrders.find(row => String(row.id) === String(orderId));
    if (!order) return;

    const photos = getPodPhotos(order);

    const modal = document.createElement("div");
    modal.className = "occ-memo-modal-backdrop";
    modal.innerHTML = `
      <section class="occ-memo-modal-card">
        <div class="occ-memo-modal-head">
          <strong>POD Photos · ${escapeHtml(order.order_number || "Order")}</strong>
          <button class="mini-btn" type="button" data-close>Close</button>
        </div>

        ${
          photos.length
            ? `<div class="occ-photo-grid">${photos.map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="POD photo"/></a>`).join("")}</div>`
            : `<div class="occ-memo-modal-text">No POD photos available.</div>`
        }
      </section>
    `;

    modal.addEventListener("click", event => {
      if (event.target === modal || event.target.hasAttribute("data-close")) {
        modal.remove();
      }
    });

    document.body.appendChild(modal);
  }

  function openManualOpsModal(orderId) {
    const order = allOrders.find(row => String(row.id) === String(orderId));

    if (!order) {
      showToast("Order not found.", "err");
      return;
    }

    if (!isTenantRole()) {
      showToast("Only Sofa2U users can manually update delivery/POD.", "err");
      return;
    }

    if (byId("manualOpsOrderId")) byId("manualOpsOrderId").value = order.id;

    setText(
      "manualOpsOrderLabel",
      `${order.order_number || "Order"} · ${order.retailer_name || ""} · ${order.delivery_postcode || ""}`
    );

    if (byId("manualConfirmedDate")) {
      byId("manualConfirmedDate").value = order.confirmed_delivery_date
        ? String(order.confirmed_delivery_date).slice(0, 10)
        : "";
    }

    if (byId("manualEtaFrom")) byId("manualEtaFrom").value = formatTime(order.delivery_eta_from || "");
    if (byId("manualEtaTo")) byId("manualEtaTo").value = formatTime(order.delivery_eta_to || "");
    if (byId("manualPodPhotos")) byId("manualPodPhotos").value = "";
    if (byId("manualSignedPodFile")) byId("manualSignedPodFile").value = "";
    if (byId("manualPodPhotoNotes")) byId("manualPodPhotoNotes").value = "";
    if (byId("manualSignedBy")) byId("manualSignedBy").value = "";
    if (byId("manualDeliveredTo")) byId("manualDeliveredTo").value = "";
    if (byId("manualDeliveryNotes")) byId("manualDeliveryNotes").value = "";

    byId("manualOpsModal")?.classList.add("open");
    byId("manualOpsModal")?.setAttribute("aria-hidden", "false");
  }

  function closeManualOpsModal() {
    byId("manualOpsModal")?.classList.remove("open");
    byId("manualOpsModal")?.setAttribute("aria-hidden", "true");
  }

  function getManualOpsOrder() {
    const orderId = byId("manualOpsOrderId")?.value || "";
    const order = allOrders.find(row => String(row.id) === String(orderId));

    if (!order?.id) {
      throw new Error("No order selected.");
    }

    return order;
  }

  function openTariffModal(orderId) {
    const order = allOrders.find(row => String(row.id) === String(orderId));

    if (!order) {
      showToast("Order not found.", "err");
      return;
    }

    if (!isTenantRole()) {
      showToast("Only Sofa2U users can update tariffs.", "err");
      return;
    }

    ensurePageStyles();

    document.querySelector("#tariffModal")?.remove();

    const lines = Array.isArray(order.order_lines) ? order.order_lines : [];

    const modal = document.createElement("div");
    modal.id = "tariffModal";
    modal.className = "occ-memo-modal-backdrop";

    modal.innerHTML = `
      <section class="occ-memo-modal-card" style="width:min(980px,96vw);">
        <div class="occ-memo-modal-head">
          <div>
            <strong>Finance / Tariffs · ${escapeHtml(order.order_number || "Order")}</strong>
            <div class="subline">${escapeHtml(order.retailer_name || "")}</div>
          </div>
          <button class="mini-btn" type="button" data-close-tariff>Close</button>
        </div>

        ${
          !lines.length
            ? `<div class="occ-memo-modal-text">No order lines found.</div>`
            : `
              <div class="manual-tariff-table-wrap">
                <table class="manual-tariff-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Storage</th>
                      <th>Admin</th>
                      <th>Handling</th>
                      <th>Transport</th>
                      <th>Customer charge</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody id="tariffModalBody">
                    ${lines.map(line => `
                      <tr data-line-id="${escapeHtml(line.id)}">
                        <td><strong>${escapeHtml(getLineSku(line))}</strong></td>
                        <td>${escapeHtml(shortText(getLineDescription(line), 48))}</td>
                        <td>${formatNumber(getLineRequiredQty(line), 0)}</td>
                        <td><input type="number" step="0.01" min="0" data-tariff-field="tariff_storage" value="${escapeHtml(round2(line.tariff_storage || 0))}"></td>
                        <td><input type="number" step="0.01" min="0" data-tariff-field="tariff_admin" value="${escapeHtml(round2(line.tariff_admin || 0))}"></td>
                        <td><input type="number" step="0.01" min="0" data-tariff-field="tariff_handling" value="${escapeHtml(round2(line.tariff_handling || 0))}"></td>
                        <td><input type="number" step="0.01" min="0" data-tariff-field="tariff_transport" value="${escapeHtml(round2(line.tariff_transport || 0))}"></td>
                        <td><input type="number" step="0.01" min="0" data-tariff-field="total_customer_charge" value="${escapeHtml(round2(line.total_customer_charge || getLineRevenue(line) || 0))}"></td>
                        <td class="manual-tariff-total" data-line-total>${formatMoney(getLineRevenue(line))}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>

              <div class="manual-tariff-footer" style="margin-top:12px;">
                <div id="tariffModalSummary" class="manual-tariff-summary">Customer charge total: £0.00</div>
                <button id="btnSaveTariffModal" class="btn btn-primary" type="button">Save tariffs</button>
              </div>
            `
        }
      </section>
    `;

    modal.addEventListener("click", event => {
      if (event.target === modal || event.target.hasAttribute("data-close-tariff")) {
        modal.remove();
      }
    });

    document.body.appendChild(modal);

    modal.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", refreshTariffModalSummary);
      input.addEventListener("change", refreshTariffModalSummary);
    });

    byId("btnSaveTariffModal")?.addEventListener("click", async () => {
      try {
        await saveTariffModal(order.id);
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save tariffs.", "err");
      }
    });

    refreshTariffModalSummary();
  }

  function tariffModalTotalsFromRow(row) {
    const storage = toNumber(row.querySelector("[data-tariff-field='tariff_storage']")?.value, 0);
    const admin = toNumber(row.querySelector("[data-tariff-field='tariff_admin']")?.value, 0);
    const handling = toNumber(row.querySelector("[data-tariff-field='tariff_handling']")?.value, 0);
    const transport = toNumber(row.querySelector("[data-tariff-field='tariff_transport']")?.value, 0);
    const chargeInput = toNumber(row.querySelector("[data-tariff-field='total_customer_charge']")?.value, 0);
    const calculated = storage + admin + handling + transport;

    return {
      storage,
      admin,
      handling,
      transport,
      customerCharge: chargeInput > 0 ? chargeInput : calculated
    };
  }

  function refreshTariffModalSummary() {
    const rows = Array.from(document.querySelectorAll("#tariffModalBody tr[data-line-id]"));
    let total = 0;

    rows.forEach(row => {
      const t = tariffModalTotalsFromRow(row);
      total += t.customerCharge;

      const totalCell = row.querySelector("[data-line-total]");
      if (totalCell) totalCell.textContent = formatMoney(t.customerCharge);
    });

    setText("tariffModalSummary", `Customer charge total: ${formatMoney(total)}`);
  }

  async function saveTariffModal(orderId) {
    const order = allOrders.find(row => String(row.id) === String(orderId));
    if (!order) throw new Error("Order not found.");

    const rows = Array.from(document.querySelectorAll("#tariffModalBody tr[data-line-id]"));
    if (!rows.length) throw new Error("No tariff lines found.");

    let totalStorage = 0;
    let totalAdmin = 0;
    let totalHandling = 0;
    let totalTransport = 0;
    let totalCustomerCharge = 0;

    for (const row of rows) {
      const lineId = row.dataset.lineId;
      const t = tariffModalTotalsFromRow(row);

      const payload = {
        tariff_storage: round2(t.storage),
        tariff_admin: round2(t.admin),
        tariff_handling: round2(t.handling),
        tariff_transport: round2(t.transport),
        total_customer_charge: round2(t.customerCharge)
      };

      const { error } = await client
        .from("order_lines")
        .update(payload)
        .eq("id", lineId)
        .eq("order_id", order.id);

      if (error) throw error;

      totalStorage += payload.tariff_storage;
      totalAdmin += payload.tariff_admin;
      totalHandling += payload.tariff_handling;
      totalTransport += payload.tariff_transport;
      totalCustomerCharge += payload.total_customer_charge;
    }

    const orderPayload = {
      total_storage_tariff: round2(totalStorage),
      total_admin_tariff: round2(totalAdmin),
      total_handling_tariff: round2(totalHandling),
      total_transport_tariff: round2(totalTransport),
      total_customer_charge: round2(totalCustomerCharge),
      customer_charge_gbp: round2(totalCustomerCharge),
      estimated_revenue_gbp: round2(totalCustomerCharge),
      finance_status: "not_invoiced",
      last_activity_at: new Date().toISOString()
    };

    try {
      await safeUpdateOrder(order.id, orderPayload);
    } catch (error) {
      const fallback = { ...orderPayload };
      delete fallback.customer_charge_gbp;
      delete fallback.estimated_revenue_gbp;
      await safeUpdateOrder(order.id, fallback);
    }

    await insertOrderActivity(
      order.id,
      `Manual tariffs updated. Customer charge ${formatMoney(totalCustomerCharge)}.`,
      "manual_tariff_update"
    );

    document.querySelector("#tariffModal")?.remove();
    await loadOrders();

    showToast(`Tariffs saved: ${formatMoney(totalCustomerCharge)}.`, "ok");
  }

  async function insertOrderActivity(orderId, description, type = "manual_update") {
    try {
      await client
        .from("order_activity_log")
        .insert({
          order_id: orderId,
          activity_type: type,
          description,
          created_by: currentUser?.id || currentProfile?.id || null,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.warn("Activity log skipped:", error.message);
    }
  }

  async function safeUpdateOrder(orderId, payload) {
    const cid = await getCompanyId();

    const { error } = await client
      .from("orders")
      .update(payload)
      .eq("id", orderId)
      .eq("company_id", cid);

    if (error) throw error;
  }

  async function saveManualDeliveryDate() {
    const order = getManualOpsOrder();

    const confirmedDate = byId("manualConfirmedDate")?.value || "";
    const etaFrom = byId("manualEtaFrom")?.value || "";
    const etaTo = byId("manualEtaTo")?.value || "";

    if (!confirmedDate) {
      throw new Error("Choose a confirmed delivery date first.");
    }

    const payload = {
      confirmed_delivery_date: confirmedDate,
      status: "planned",
      transport_status: "planned",
      overall_status: "planned",
      last_activity_at: new Date().toISOString()
    };

    try {
      if (etaFrom) payload.delivery_eta_from = etaFrom;
      if (etaTo) payload.delivery_eta_to = etaTo;
      await safeUpdateOrder(order.id, payload);
    } catch (error) {
      delete payload.delivery_eta_from;
      delete payload.delivery_eta_to;
      await safeUpdateOrder(order.id, payload);
    }

    await insertOrderActivity(
      order.id,
      `Confirmed delivery date set manually to ${confirmedDate}${etaFrom ? `, ETA ${etaFrom}${etaTo ? ` - ${etaTo}` : ""}` : ""}.`,
      "manual_delivery_date"
    );

    await loadOrders();
    showToast("Confirmed delivery date saved. Lifecycle moved to Planned / Transport.", "ok");
  }

  function safeFileName(name) {
    return String(name || "file")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_");
  }

  async function uploadToPodBucket(order, file, folder) {
    const cid = await getCompanyId();

    const ext = file.name.includes(".")
      ? file.name.split(".").pop()
      : "bin";

    const path = [
      cid,
      order.id,
      folder,
      `${Date.now()}_${Math.random().toString(16).slice(2)}_${safeFileName(file.name || `upload.${ext}`)}`
    ].join("/");

    const { error: uploadError } = await client
      .storage
      .from(POD_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined
      });

    if (uploadError) throw uploadError;

    const { data } = client
      .storage
      .from(POD_BUCKET)
      .getPublicUrl(path);

    return {
      storage_path: path,
      file_url: data?.publicUrl || "",
      file_name: file.name || path.split("/").pop(),
      mime_type: file.type || ""
    };
  }

  async function uploadManualPodPhotos() {
    const order = getManualOpsOrder();
    const files = Array.from(byId("manualPodPhotos")?.files || []);
    const notes = byId("manualPodPhotoNotes")?.value || "";

    if (!files.length) {
      throw new Error("Choose one or more POD photos first.");
    }

    const cid = await getCompanyId();

    for (const file of files) {
      const uploaded = await uploadToPodBucket(order, file, "photos");

      const { error } = await client
        .from("order_pod_assets")
        .insert({
          company_id: cid,
          order_id: order.id,
          asset_type: "photo",
          file_name: uploaded.file_name,
          file_url: uploaded.file_url,
          storage_path: uploaded.storage_path,
          mime_type: uploaded.mime_type,
          notes,
          captured_at: new Date().toISOString(),
          captured_by_name: currentProfile?.full_name || currentUser?.email || "Sofa2U"
        });

      if (error) throw error;
    }

    await insertOrderActivity(
      order.id,
      `${files.length} POD photo(s) uploaded manually by Sofa2U.`,
      "manual_pod_photos"
    );

    await loadOrders();
    showToast(`${files.length} POD photo(s) uploaded.`, "ok");
  }

  async function uploadManualSignedPod() {
    const order = getManualOpsOrder();
    const file = byId("manualSignedPodFile")?.files?.[0] || null;
    const signedBy = byId("manualSignedBy")?.value || "";

    if (!file) {
      throw new Error("Choose a signed POD PDF first.");
    }

    if (!String(file.type || "").includes("pdf") && !String(file.name || "").toLowerCase().endsWith(".pdf")) {
      throw new Error("Signed POD must be a PDF file.");
    }

    const cid = await getCompanyId();
    const uploaded = await uploadToPodBucket(order, file, "signed-pod");

    const documentNumber = `POD-${order.order_number || order.id}`;

    const { error: docError } = await client
      .from("order_documents")
      .insert({
        company_id: cid,
        customer_id: order.customer_id || null,
        order_id: order.id,
        document_type: "pod",
        document_number: documentNumber,
        document_status: "signed",
        file_url: uploaded.file_url,
        storage_path: uploaded.storage_path,
        customer_visible: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (docError) throw docError;

    const { error: assetError } = await client
      .from("order_pod_assets")
      .insert({
        company_id: cid,
        order_id: order.id,
       asset_type: "signed_delivery_note",
        file_name: uploaded.file_name,
        file_url: uploaded.file_url,
        storage_path: uploaded.storage_path,
        mime_type: uploaded.mime_type || "application/pdf",
        notes: signedBy ? `Signed by: ${signedBy}` : "",
        captured_at: new Date().toISOString(),
        captured_by_name: currentProfile?.full_name || currentUser?.email || "Sofa2U"
      });

    if (assetError) throw assetError;

    await safeUpdateOrder(order.id, {
      pod_status: "signed",
      pod_document_url: uploaded.file_url,
      pod_signed_by: signedBy || null,
      pod_signed_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString()
    });

    await insertOrderActivity(
      order.id,
      `Signed POD PDF uploaded manually${signedBy ? `, signed by ${signedBy}` : ""}.`,
      "manual_signed_pod"
    );

    await loadOrders();
    showToast("Signed POD uploaded and made visible for Bellstone.", "ok");
  }

  async function manualMarkDelivered() {
    const order = getManualOpsOrder();

    const deliveredTo = byId("manualDeliveredTo")?.value || "";
    const notes = byId("manualDeliveryNotes")?.value || "";
    const today = new Date().toISOString().slice(0, 10);

    const payload = {
      status: "delivered",
      transport_status: "delivered",
      warehouse_status: "delivered",
      overall_status: "delivered",
      confirmed_delivery_date: order.confirmed_delivery_date || today,
      pod_status: "signed",
      pod_signed_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString()
    };

    if (deliveredTo) payload.pod_signed_by = deliveredTo;

    await safeUpdateOrder(order.id, payload);

    await insertOrderActivity(
      order.id,
      `Order marked delivered manually by Sofa2U${deliveredTo ? `, received by ${deliveredTo}` : ""}.${notes ? ` Notes: ${notes}` : ""}`,
      "manual_mark_delivered"
    );

    await loadOrders();
    showToast("Order marked delivered. Lifecycle moved to Delivered.", "ok");
  }

  async function createPlaceholderDocument(orderId, docType) {
    showToast(`${statusLabel(docType)} generation is not configured here yet.`, "err");
  }

  async function generateAcknowledgement(orderId) {
    const order = allOrders.find(row => String(row.id) === String(orderId));

    if (!order) {
      showToast("Order not found for acknowledgement.", "err");
      return;
    }

    if (window.AcknowledgementGenerator?.generate) {
      const cid = await getCompanyId();
      await window.AcknowledgementGenerator.generate(order, client, cid);
      await loadOrders();
      showToast("Acknowledgement generated.", "ok");
      return;
    }

    showToast("Acknowledgement generator not available.", "err");
  }

  async function generateDeliveryNote(orderId) {
    const order = allOrders.find(row => String(row.id) === String(orderId));

    if (!order) {
      showToast("Order not found for delivery note.", "err");
      return;
    }

    if (window.DeliveryNoteGenerator?.generate) {
      const cid = await getCompanyId();
      await window.DeliveryNoteGenerator.generate(order, client, cid);
      await loadOrders();
      showToast("Delivery note generated.", "ok");
      return;
    }

    showToast("Delivery note generator not available.", "err");
  }

  async function generateSingleInvoice(orderId) {
    const order = allOrders.find(row => String(row.id) === String(orderId));

    if (!order) {
      showToast("Order not found for invoice.", "err");
      return;
    }

    const cid = await getCompanyId();

    if (window.InvoiceGenerator?.generate) {
      await window.InvoiceGenerator.generate([order], client, cid);
      await loadOrders();
      showToast("Invoice generated.", "ok");
      return;
    }

    showToast("Invoice generator not available.", "err");
  }

  async function generateCombinedInvoice() {
    const orders = getSelectedOrders();

    if (!orders.length) {
      showToast("Select at least one order first.", "err");
      return;
    }

    const cid = await getCompanyId();

    if (window.InvoiceGenerator?.generateCombinedInvoice) {
      await window.InvoiceGenerator.generateCombinedInvoice(orders, client, cid);
      await loadOrders();
      showToast("Combined invoice generated.", "ok");
      return;
    }

    if (window.InvoiceGenerator?.generate) {
      await window.InvoiceGenerator.generate(orders, client, cid);
      await loadOrders();
      showToast("Combined invoice generated.", "ok");
      return;
    }

    showToast("Combined invoice generator not available.", "err");
  }

  async function syncStatuses() {
    if (!canSyncStatuses()) {
      showToast("Only Sofa2U users can sync statuses.", "err");
      return;
    }

    const cid = await getCompanyId();
    let updated = 0;

    for (const order of allOrders) {
      const payload = {
        overall_status: order.derived_lifecycle_status,
        finance_status: order.derived_finance_status,
        last_activity_at: new Date().toISOString()
      };

      if (order.derived_lifecycle_status === "order_received") {
        payload.warehouse_status = "order_received";
        payload.transport_status = "not_planned";
      }

      if (order.derived_lifecycle_status === "awaiting_goods") {
        payload.warehouse_status = "awaiting_goods";
      }

      if (order.derived_lifecycle_status === "stock_complete") {
        payload.warehouse_status = "stock_complete";
      }

      if (order.derived_lifecycle_status === "planned") {
        payload.transport_status = "planned";
      }

      if (order.derived_lifecycle_status === "on_transport") {
        payload.transport_status = "out_for_delivery";
      }

      if (order.derived_lifecycle_status === "delivered") {
        payload.transport_status = "delivered";
        payload.warehouse_status = "delivered";
      }

      const changed =
        normalize(order.overall_status) !== normalize(payload.overall_status) ||
        normalize(order.finance_status) !== normalize(payload.finance_status) ||
        normalize(order.warehouse_status) !== normalize(payload.warehouse_status || order.warehouse_status) ||
        normalize(order.transport_status) !== normalize(payload.transport_status || order.transport_status);

      if (!changed) continue;

      const { error } = await client
        .from("orders")
        .update(payload)
        .eq("id", order.id)
        .eq("company_id", cid);

      if (error) throw error;

      updated++;
    }

    await loadOrders();
    showToast(`${formatNumber(updated)} order status record(s) synced.`, "ok");
  }

  function resetFilters() {
    [
      "filterSearch",
      "filterLifecycle",
      "filterProducts",
      "filterDocument",
      "filterFinance",
      "filterDateStatus"
    ].forEach(id => {
      const el = byId(id);
      if (el) el.value = "";
    });

    applyFilters();
    renderAll();
  }

  function bindEvents() {
    [
      "filterSearch",
      "filterLifecycle",
      "filterProducts",
      "filterDocument",
      "filterFinance",
      "filterDateStatus"
    ].forEach(id => {
      const el = byId(id);
      if (!el) return;

      el.addEventListener("input", () => {
        applyFilters();
        renderAll();
      });

      el.addEventListener("change", () => {
        applyFilters();
        renderAll();
      });
    });

    document.querySelectorAll("[data-sort-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort-key");

        if (sortState.key === key) {
          sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
        } else {
          sortState.key = key;
          sortState.direction = "asc";
        }

        sortOrders();
        renderAll();
      });
    });

    byId("selectAllVisibleOrders")?.addEventListener("change", event => {
      const checked = !!event.target.checked;

      filteredOrders.forEach(order => {
        const id = String(order.id);
        if (checked) selectedOrderIds.add(id);
        else selectedOrderIds.delete(id);
      });

      renderTable();
    });

    byId("btnClearSelectedOrders")?.addEventListener("click", () => {
      selectedOrderIds.clear();
      renderTable();
      showToast("Selection cleared.", "ok");
    });

    byId("btnGenerateCombinedInvoice")?.addEventListener("click", async () => {
      try {
        await generateCombinedInvoice();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not generate combined invoice.", "err");
      }
    });

    byId("btnRefresh")?.addEventListener("click", async () => {
      try {
        await loadOrders();
        showToast("Operations refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not refresh operations.", "err");
      }
    });

    byId("btnResetFilters")?.addEventListener("click", resetFilters);

    byId("btnSyncStatuses")?.addEventListener("click", async () => {
      try {
        await syncStatuses();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not sync statuses.", "err");
      }
    });

    byId("manualOpsCloseBtn")?.addEventListener("click", closeManualOpsModal);
    byId("manualOpsCancelBtn")?.addEventListener("click", closeManualOpsModal);

    byId("manualOpsModal")?.addEventListener("click", event => {
      if (event.target === byId("manualOpsModal")) closeManualOpsModal();
    });

    byId("btnSaveManualDeliveryDate")?.addEventListener("click", async () => {
      try {
        await saveManualDeliveryDate();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not save delivery date.", "err");
      }
    });

    byId("btnUploadManualPodPhotos")?.addEventListener("click", async () => {
      try {
        await uploadManualPodPhotos();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not upload POD photos.", "err");
      }
    });

    byId("btnUploadManualSignedPod")?.addEventListener("click", async () => {
      try {
        await uploadManualSignedPod();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not upload signed POD.", "err");
      }
    });

    byId("btnManualMarkDelivered")?.addEventListener("click", async () => {
      try {
        await manualMarkDelivered();
      } catch (error) {
        console.error(error);
        showToast(error.message || "Could not mark delivered.", "err");
      }
    });
  }

  async function init() {
    try {
      ensureClient();
      await loadCurrentProfile();
      bindEvents();
      await loadOrders();
      showToast("Operations loaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Operations Control Center failed to load.", "err");

      const tbody = byId("ordersBody");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="14">${escapeHtml(error.message || "Operations Control Center failed to load.")}</td></tr>`;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();