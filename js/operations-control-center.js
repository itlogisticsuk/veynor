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
let allProducts = [];
let ownerProfiles = [];
let deliveryGroupsMap = new Map();
let showDeliveryGroups = false;
let orderViewMode = "active";
let editRemovedLineIds = new Set();
let ackDownloadedOrderIds = new Set();

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
  cancelled: "Cancelled",
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
  return [
    "legacy_acknowledgement",
    "acknowledgement",
    "supplier_packing_slip",
    "delivery_note",
    "delivery_labels",
    "fds_signed_collection_notice",
    "pod",
    "signed_delivery_note",
    "invoice"
  ].includes(docType);
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
if (
  [
    "overdue",
    "issue",
    "delivery_issue",
    "returned",
    "failed_delivery",
    "cancelled"
  ].includes(v)
) {
  return "red";
}

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

function isAckDownloaded(order) {
  return ackDownloadedOrderIds.has(String(order.id));
}

async function loadAckDownloadStatus() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("portal_events")
    .select("user_profile_id, event_type, metadata")
    .eq("company_id", cid)
    .in("event_type", [
      "ack_downloaded",
      "acknowledgement_downloaded"
    ]);

  if (error) {
    console.warn("ACK download status skipped:", error.message);
    ackDownloadedOrderIds = new Set();
    return;
  }

  ackDownloadedOrderIds = new Set(
    (data || [])
      .filter(row => {
        const docType = normalize(
          row.metadata?.document_type ||
          row.metadata?.doc_type ||
          ""
        );

        const action = normalize(
          row.metadata?.action ||
          "downloaded"
        );

        return (
          ["ack", "acknowledgement"].includes(docType) &&
          action === "downloaded"
        );
      })
      .map(row => row.metadata?.order_id)
      .filter(Boolean)
      .map(String)
  );
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

function getLineSku(line) {
  return cleanText(line.sku_base || line.products?.sku_base || "—");
}

function getLineDescription(line) {
  return cleanText(
    line.description ||
    line.products?.description ||
    line.products?.name ||
    "—"
  );
}

function getLineRevenue(line) {
  const direct = toNumber(line.total_customer_charge, 0);

  if (direct !== 0) return direct;

  const manualAmount = toNumber(line.manual_amount_gbp, 0);
  if (manualAmount !== 0) return manualAmount;

  const qty = getLineRequiredQty(line) || 1;

  const tariffTotal =
    toNumber(line.tariff_storage, 0) +
    toNumber(line.tariff_admin, 0) +
    toNumber(line.tariff_handling, 0) +
    toNumber(line.tariff_transport, 0);

  return tariffTotal * qty;
}

function getOrderRevenue(order) {
  const direct = toNumber(order.total_customer_charge, 0);

  if (direct !== 0) return direct;

  return (order.order_lines || []).reduce((sum, line) => {
    return sum + getLineRevenue(line);
  }, 0);
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

  const count = flags.filter(v => v > 0).length;
  return Math.max(1, count || 1);
}

function getLineRequiredPackages(line) {
  if (normalize(line.line_type) === "hard_stock") {
    const totalPackages = toNumber(line.total_packages, 0);

    if (totalPackages > 0) {
      return Math.max(1, Math.round(totalPackages));
    }

    const qty = getLineRequiredQty(line);
    const packagesPerUnit = Math.max(
      1,
      Math.round(toNumber(line.packages_per_unit, 1))
    );

    return qty * packagesPerUnit;
  }

  const qty = getLineRequiredQty(line);

  if (
    toNumber(line.requested_package_no, 0) > 0 &&
    toNumber(line.requested_package_total, 0) > 0
  ) {
    return qty;
  }

  return qty * getProductPackageCount(line.products || {});
}

function getLineMatchedQty(line) {
  if (normalize(line.line_type) === "hard_stock") {
    return Math.max(
      0,
      Math.round(toNumber(line.matched_quantity, 0))
    );
  }

  const allocs = Array.isArray(line.order_allocations)
    ? line.order_allocations
    : [];

  const active = allocs.filter(allocation =>
    !["cancelled"].includes(normalize(allocation.allocation_status))
  );

  if (
    toNumber(line.requested_package_no, 0) > 0 &&
    toNumber(line.requested_package_total, 0) > 0
  ) {
    return active.length;
  }

  return active.reduce((sum, allocation) => {
    return sum + Math.max(
      1,
      Math.round(toNumber(allocation.items?.package_total, 1))
    );
  }, 0);
}

function getProductCompleteness(order) {

  if (normalize(order.order_type) === "legacy") {
    const lines = Array.isArray(order.order_lines)
      ? order.order_lines
      : [];

    const required = lines.reduce((sum, line) => {
      return sum + Math.max(1, toNumber(line.quantity_ordered || 1, 1));
    }, 0);

    return {
      required,
      matched: required,
      missing: 0,
      pct: 100,
      status: "complete",
      lines: lines.map(line => ({
        id: line.id,
        sku: getLineSku(line),
        description: getLineDescription(line),
        required: Math.max(1, toNumber(line.quantity_ordered || 1, 1)),
        matched: Math.max(1, toNumber(line.quantity_ordered || 1, 1)),
        missing: 0,
        orderedProducts: getLineRequiredQty(line),
        complete: true,
        revenue: getLineRevenue(line)
      }))
    };
  }

  // bestaande code hieronder laten staan
  const lines = Array.isArray(order.order_lines)
  ? order.order_lines.filter(line => normalize(line.line_type) !== "manual")
  : [];

  const required = lines.reduce((sum, line) => sum + getLineRequiredPackages(line), 0);

  const matched = lines.reduce((sum, line) => {
    const requiredPackages = getLineRequiredPackages(line);
    return sum + Math.min(getLineMatchedQty(line), requiredPackages);
  }, 0);

  const missing = Math.max(0, required - matched);
  const pct = required > 0 ? Math.min(100, Math.round((matched / required) * 100)) : 0;

  const lineDetails = lines.map(line => {
    const requiredPackages = getLineRequiredPackages(line);
    const matchedPackages = Math.min(getLineMatchedQty(line), requiredPackages);
    const missingPackages = Math.max(0, requiredPackages - matchedPackages);

    return {
      id: line.id,
      sku: getLineSku(line),
      description: getLineDescription(line),
      required: requiredPackages,
      matched: matchedPackages,
      missing: missingPackages,
      orderedProducts: getLineRequiredQty(line),
      complete: requiredPackages > 0 && matchedPackages >= requiredPackages,
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
  const overallStatus = normalize(order.overall_status || "");
  const completeness = getProductCompleteness(order);

  if (
    status === "cancelled" ||
    transportStatus === "cancelled" ||
    warehouseStatus === "cancelled" ||
    overallStatus === "cancelled"
  ) {
    return "cancelled";
  }

  if (normalize(order.order_type) === "legacy") {
    return "delivered";
  }

  if (
    status === "delivered" ||
    transportStatus === "delivered" ||
    warehouseStatus === "delivered"
  ) {
    return "delivered";
  }

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
  const status =
    normalize(order.derived_lifecycle_status || "");

  if (status === "cancelled") return 0;
  if (status === "delivered") return 4;
  if (["on_transport", "planned"].includes(status)) return 3;
  if (status === "stock_complete") return 2;

  return 1;
}

function getOrderVolumeM3(order) {
  return (order.order_lines || []).reduce((sum, line) => {
    const qty = getLineRequiredQty(line) || 1;

    const volume =
      toNumber(line.total_line_volume_m3, 0) ||
      toNumber(line.total_volume_m3, 0) ||
      (toNumber(line.unit_volume_m3, 0) * qty) ||
      (toNumber(line.products?.volume_m3, 0) * qty);

    return sum + volume;
  }, 0);
}

function getDeliveryGroupKey(order) {
  return [
    order.customer_id || "",
    getRetailerCode(order),
    String(order.delivery_postcode || "").toUpperCase().replace(/\s+/g, "")
  ].join("|");
}

function getOwnerProfileForOrder(order) {
  const ownerCode = normalize(order.customers?.customer_code || order.customer_code || "");
  const ownerName = normalize(getProductOwnerName(order));

  return ownerProfiles.find(owner =>
    normalize(owner.customer_code) === ownerCode ||
    normalize(owner.trading_name) === ownerName ||
    normalize(owner.name) === ownerName
  ) || null;
}

function getMinimumRulesForOrder(order) {
  const owner = getOwnerProfileForOrder(order);

  return {
    enabled: owner?.minimum_delivery_enabled !== false,
    minimumVolume: toNumber(owner?.minimum_delivery_volume_m3, 1.25),
    tariffPerM3: toNumber(owner?.minimum_delivery_transport_tariff_per_m3, 55.20),
    invoiceLabel: owner?.minimum_delivery_invoice_label || "Minimum Delivery Charge"
  };
}

function isReadyForDeliveryGroup(order) {
  return ["stock_complete", "planned"].includes(normalize(order.derived_lifecycle_status));
}

function isWaitingForDeliveryGroup(order) {
  return ["order_received", "awaiting_goods"].includes(normalize(order.derived_lifecycle_status));
}

function isExcludedFromDeliveryGroup(order) {
  return [
    "on_transport",
    "delivered",
    "issue"
  ].includes(normalize(order.derived_lifecycle_status));
}

function isHistoricalOrder(order) {
  const status = normalize(order.status);
  const type = normalize(order.order_type);
  const lifecycle = normalize(order.derived_lifecycle_status);

  return (
    type === "credit" ||
    lifecycle === "delivered" ||
    status === "closed" ||
    status === "cancelled"
  );
}

function isActiveOrder(order) {
  return !isHistoricalOrder(order);
}

function rebuildDeliveryGroups() {
  deliveryGroupsMap = new Map();

  allOrders.forEach(order => {
    if (isExcludedFromDeliveryGroup(order)) return;
    if (!isReadyForDeliveryGroup(order) && !isWaitingForDeliveryGroup(order)) return;

    const rules = getMinimumRulesForOrder(order);
    if (!rules.enabled) return;

    const key = getDeliveryGroupKey(order);
    const volume = round2(getOrderVolumeM3(order));

    if (!deliveryGroupsMap.has(key)) {
      deliveryGroupsMap.set(key, {
        key,
        productOwner: getProductOwnerName(order),
        retailer: getRetailerName(order),
        postcode: order.delivery_postcode || "",
        minimumVolume: rules.minimumVolume,
        tariffPerM3: rules.tariffPerM3,
        invoiceLabel: rules.invoiceLabel,

        readyVolume: 0,
        waitingVolume: 0,
        totalPotentialVolume: 0,

        shortfall: 0,
        surcharge: 0,

        readyOrders: [],
        waitingOrders: []
      });
    }

    const group = deliveryGroupsMap.get(key);

    const item = {
      id: order.id,
      orderNumber: order.order_number || "Order",
      reference: order.external_reference || "",
      status: order.derived_lifecycle_status,
      volume
    };

    if (isReadyForDeliveryGroup(order)) {
      group.readyVolume += volume;
      group.readyOrders.push(item);
    }

    if (isWaitingForDeliveryGroup(order)) {
      group.waitingVolume += volume;
      group.waitingOrders.push(item);
    }
  });

  deliveryGroupsMap.forEach(group => {
    group.readyVolume = round2(group.readyVolume);
    group.waitingVolume = round2(group.waitingVolume);
    group.totalPotentialVolume = round2(group.readyVolume + group.waitingVolume);

    group.shortfall = round2(Math.max(0, group.minimumVolume - group.readyVolume));
    group.surcharge = round2(group.shortfall * group.tariffPerM3);
  });
}
function getDeliveryGroup(order) {
  if (normalize(order.order_type) === "legacy") {
    return null;
  }

  return deliveryGroupsMap.get(getDeliveryGroupKey(order)) || null;
}

function exposeDeliveryGroupsToPlanner() {
  window.VeynorDeliveryGroups = {
    map: deliveryGroupsMap,
    stored: window.__storedDeliveryGroups || [],

    getGroup(order) {
      return getDeliveryGroup(order);
    },

    getStoredGroup(group) {
      if (!group?.key) return null;

      return (window.__storedDeliveryGroups || []).find(row =>
        row.group_key === group.key
      ) || null;
    }
  };
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

async function loadOwnerProfilesForMinimumRules() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("settings")
    .select("setting_value")
    .eq("company_id", cid)
    .eq("setting_key", "product_owner_profiles")
    .maybeSingle();

  if (error) throw error;

  try {
    ownerProfiles = JSON.parse(data?.setting_value || "[]");
  } catch {
    ownerProfiles = [];
  }
}

async function loadStoredDeliveryGroups() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("delivery_groups")
    .select("*")
    .eq("company_id", cid);

  if (error) throw error;

  window.__storedDeliveryGroups = data || [];
}

async function loadOrders() {
  const cid = await getCompanyId();

await loadOwnerProfilesForMinimumRules();
await loadStoredDeliveryGroups();
await loadAckDownloadStatus();

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
  quantity_allocated,
  matched_quantity,
  packages_per_unit,
  total_packages,
  requested_package_no,
  requested_package_total,
  requested_package_label,
  product_id,
  sku_base,
description,
line_type,
manual_description,
manual_amount_gbp,
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
rebuildDeliveryGroups();
exposeDeliveryGroupsToPlanner();

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
  if (orderViewMode === "active" && !isActiveOrder(order)) return false;
  if (orderViewMode === "historical" && !isHistoricalOrder(order)) return false;
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

const visibleGroups = new Map();

filteredOrders.forEach(order => {
  const group = getDeliveryGroup(order);
  if (group) visibleGroups.set(group.key, group);
});

const belowMinimumGroups = [...visibleGroups.values()].filter(group => group.shortfall > 0);
const potentialSurcharge = belowMinimumGroups.reduce((sum, group) => sum + group.surcharge, 0);

setText("kpiMinimumVolumeGroups", formatNumber(belowMinimumGroups.length));
setText(
  "kpiMinimumVolumeValue",
  belowMinimumGroups.length
    ? `${formatMoney(potentialSurcharge)} potential surcharge`
    : "No retailers below minimum"
);

    setText("resultsMeta", `${formatNumber(filteredOrders.length)} orders shown`);
  }

function renderCompactLifecycle(order) {
  const lifecycle =
    normalize(order.derived_lifecycle_status || "");

  if (lifecycle === "cancelled") {
    return `
      <div class="mini-lifecycle">
        <div class="mini-lifecycle-line">
          <span class="mini-life-step wait">×</span>
          <span class="mini-life-connector"></span>
          <span class="mini-life-step"></span>
          <span class="mini-life-connector"></span>
          <span class="mini-life-step"></span>
          <span class="mini-life-connector"></span>
          <span class="mini-life-step"></span>
        </div>

        <div class="mini-life-label red">
          Cancelled
        </div>
      </div>
    `;
  }

  const step = compactLifecycleStep(order);
  const isIssue = lifecycle === "issue";

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

function getVisibleDocumentTypes(order) {

const docs = [
  ["legacy_acknowledgement", "Legacy ACK"],
  ["acknowledgement", "ACK"],
  ["supplier_packing_slip", "Packing Slip"],
  ["delivery_note", "Delivery Note"],
  ["delivery_labels", "Delivery Labels"],
  ["fds_signed_collection_notice", "FDS Signed Notice"],
  ["pod", "POD"],
  ["invoice", "Invoice"]
];
  if (
    normalize(order.order_type) === "credit" &&
    getDoc(order, "credit_note")
  ) {
    docs.push(["credit_note", "Credit Note"]);
  }

  return docs.filter(([type]) => canSeeDocumentType(type));
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
      ${isAckDownloaded(order) ? `<span class="ack-dot" title="ACK downloaded by customer"></span>` : ""}
    </div>
  `;
}

function getIsoWeekNumber(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;

  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  return weekNo;
}

function isFdsCarrierOrder(order) {
  return (
    normalize(order.transport_type) === "charter" &&
    normalize(order.status) === "export_for_charter"
  );
}

function getFdsWeekLabel(order) {
  const storedWeek = Math.round(
    toNumber(order.fds_collection_week, 0)
  );

  if (storedWeek > 0) {
    return `FDS Week ${storedWeek}`;
  }

  const collectionDate =
    order.fds_collection_date ||
    order.planned_route_date ||
    order.expected_delivery_date ||
    order.confirmed_delivery_date;

  const calculatedWeek = getIsoWeekNumber(collectionDate);

  return calculatedWeek
    ? `FDS Week ${calculatedWeek}`
    : "FDS Week";
}

function renderDeliveryCell(order) {
  if (normalize(order.order_type) === "legacy") {
    const deliveredDate =
      order.confirmed_delivery_date ||
      order.pod_signed_at ||
      order.updated_at ||
      order.created_at;

    return `
      <div class="delivery-cell">
        <strong>${escapeHtml(formatDate(deliveredDate))}</strong>
        ${pill("delivered", "Delivered")}
        <span class="subline">Legacy delivered order</span>
      </div>
    `;
  }

  if (isFdsCarrierOrder(order)) {
    const fdsStatus = normalize(order.fds_status || "");
    const isAllocated = fdsStatus === "allocated";

    const deliveryDate = isAllocated
      ? order.expected_delivery_date
      : null;

    const etaFrom = isAllocated
      ? formatTime(order.delivery_eta_from)
      : "";

    const etaTo = isAllocated
      ? formatTime(order.delivery_eta_to)
      : "";

    const etaText = etaFrom
      ? etaTo
        ? `${etaFrom} - ${etaTo}`
        : etaFrom
      : "Time not confirmed yet";

    return `
      <div class="delivery-cell">
        ${
          deliveryDate
            ? `
              <strong>
                ${escapeHtml(formatDate(deliveryDate))}
              </strong>
            `
            : ""
        }

        ${pill("planned", getFdsWeekLabel(order))}

        <span class="subline">
          ${
            isAllocated
              ? escapeHtml(etaText)
              : "Actual date pending"
          }
        </span>
      </div>
    `;
  }

  const expectedDate = getExpectedDeliveryDate(order);
  const etaStatus = getEtaStatus(order);

  const etaPill =
    etaStatus === "confirmed"
      ? pill("confirmed", "ETA confirmed")
      : etaStatus === "planned"
        ? pill("planned", "Date planned")
        : pill("pending", "Pending");

  return `
    <div class="delivery-cell">
      <strong>${escapeHtml(formatDate(expectedDate))}</strong>
      ${etaPill}
      <span class="subline">
        ${escapeHtml(getEtaDisplay(order))}
      </span>
    </div>
  `;
}
function getOrderType(order) {
  return normalize(order.order_type || "standard");
}

function renderOrderTypeBadge(order) {
  const type = getOrderType(order);

  if (type === "legacy") {
    return `<span class="status-pill purple">Legacy</span>`;
  }

  if (type === "manual_charge") {
    return `<span class="status-pill orange">Manual Charge</span>`;
  }

  if (type === "credit") {
    return `<span class="status-pill red">Credit</span>`;
  }

  if (type === "copy") {
    return `<span class="status-pill green">Copy</span>`;
  }

  return `<span class="status-pill blue">Standard</span>`;
}

function renderFinanceCell(order) {
  return `
    <div class="finance-metric">
      ${pill(order.derived_finance_status)}
      ${canSeeInternalPlanningData() ? `<strong>${formatMoney(getOrderRevenue(order))}</strong>` : ""}
    </div>
  `;
}

function renderDeliveryGroupCell(order) {
  const group = getDeliveryGroup(order);

  if (!group) {
    return `<div class="subline">—</div>`;
  }

  const readyVolume = toNumber(group.readyVolume, 0);
  const minimumVolume = toNumber(group.minimumVolume, 1.25);
  const shortfall = round2(Math.max(0, minimumVolume - readyVolume));
  const surcharge = round2(shortfall * toNumber(group.tariffPerM3, 55.20));

  if (readyVolume <= 0) {
    return `
      <div class="delivery-group wait">
        <strong>0.00 / ${formatNumber(minimumVolume, 2)} m³</strong>
        <span class="subline">Waiting goods</span>
      </div>
    `;
  }

  if (shortfall <= 0) {
    return `
      <div class="delivery-group good">
        <strong>✓ ${formatNumber(readyVolume, 2)} / ${formatNumber(minimumVolume, 2)} m³</strong>
        <span class="subline">Ready</span>
      </div>
    `;
  }

  return `
    <div class="delivery-group warn">
      <strong>${formatNumber(readyVolume, 2)} / ${formatNumber(minimumVolume, 2)} m³</strong>
      <span class="subline">
        Shortfall ${formatNumber(shortfall, 2)} m³ · +${formatMoney(surcharge)}
      </span>
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
  const manualLines = (order.order_lines || []).filter(line => normalize(line.line_type) === "manual");

  const stockHtml = !c.lines.length
    ? `<div class="detail-line"><span class="detail-label">Products</span><span class="detail-value">No stock product lines found.</span></div>`
    : c.lines.map(line => `
      <div class="detail-line">
        <span class="detail-label">${escapeHtml(line.sku)}</span>
       <span class="detail-value">
  <span style="
    display:inline-block;
    width:10px;
    height:10px;
    border-radius:50%;
    margin-right:7px;
    background:${line.complete ? "#16a34a" : "#ef4444"};
  "></span>
  ${escapeHtml(shortText(line.description, 54))}
<span class="subline">
  Quantity ${formatNumber(line.orderedProducts, 0)}
  · Packages ${formatNumber(line.required, 0)}
  ${
    line.missing > 0
      ? `· Unallocated ${formatNumber(line.missing, 0)}`
      : `· Allocated ${formatNumber(line.matched, 0)}`
  }
  ${canSeeFinance() ? `· ${formatMoney(line.revenue)}` : ""}
</span>
        </span>
      </div>
    `).join("");

  const manualHtml = manualLines.map(line => `
    <div class="detail-line">
      <span class="detail-label">MANUAL</span>
      <span class="detail-value">
        ${escapeHtml(shortText(line.manual_description || line.description || "Manual product", 54))}
        <span class="subline">
          ${canSeeFinance() ? `${formatMoney(line.total_customer_charge || line.manual_amount_gbp || 0)}` : "Manual line"}
        </span>
      </span>
    </div>
  `).join("");

  return stockHtml + manualHtml;
}

function portalDocType(type) {
  const map = {
    acknowledgement: "ack",
    delivery_note: "delivery_note",
    invoice: "invoice",
    credit_note: "credit_note",
    pod: "pod",
    signed_delivery_note: "pod"
  };

  return map[normalize(type)] || normalize(type || "document");
}

function renderPortalDocAttrs(order, type, action = "downloaded", url = "") {
  return `
    data-portal-doc-type="${escapeHtml(portalDocType(type))}"
    data-portal-doc-action="${escapeHtml(action)}"
    data-order-id="${escapeHtml(order.id)}"
    data-order-number="${escapeHtml(order.order_number || "")}"
    data-url="${escapeHtml(url || "")}"
  `;
}

function renderDocumentAction(order, type, label) {
  const doc = getDoc(order, type);
  const status = doc?.document_status || "not_generated";
  const url = type === "pod" ? getPodDocumentUrl(order) : doc?.file_url || "";

if (url) {
  const ackDownloaded =
    ["acknowledgement", "legacy_acknowledgement"].includes(normalize(type)) &&
    isAckDownloaded(order);

console.log(
    order.order_number,
    type,
    ackDownloaded
);

  return `
<a
  class="quick-action ${ackDownloaded ? "ack-downloaded" : ""}"
  href="${escapeHtml(url)}"
  ${["delivery_note", "delivery_labels", "supplier_packing_slip"].includes(normalize(type))
    ? `target="_blank" rel="noopener" download="${escapeHtml(`${label}-${order.order_number || "order"}.pdf`)}"`
    : `target="_blank" rel="noopener"`}
  ${renderPortalDocAttrs(order, type, "downloaded", url)}
>
      <span>${escapeHtml(label)}</span>
      <span>${ackDownloaded ? "Downloaded" : "Download"}</span>
    </a>
  `;
}

  if (type === "legacy_acknowledgement" && canGenerateDocuments()) {
    return `
      <button
        class="quick-action"
        type="button"
        data-upload-legacy-ack="${escapeHtml(order.id)}"
      >
        <span>${escapeHtml(label)}</span>
        <span>Upload PDF</span>
      </button>
    `;
  }

  if (canGenerateDocuments() && type !== "supplier_packing_slip" && type !== "pod") {
    return `
      <button
        class="quick-action"
        type="button"
        data-doc-action="${escapeHtml(type)}"
        data-order-id="${escapeHtml(order.id)}"
        data-order-number="${escapeHtml(order.order_number || "")}"
      >
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
      ${docs
        .map(([type, label]) => {
          return renderDocumentAction(order, type, label);
        })
        .join("")}

      ${
        canSeeDocumentType("pod")
          ? photos.length
            ? `
              <button
                class="quick-action"
                type="button"
                data-open-pod-photos="${escapeHtml(order.id)}"
                ${renderPortalDocAttrs(
                  order,
                  "pod_photos",
                  "viewed"
                )}
              >
                <span>Delivery Photos</span>
                <span>${photos.length}/5</span>
              </button>
            `
            : `
              <div
                class="quick-action"
                style="opacity:.7;"
              >
                <span>Delivery Photos</span>
                <span>No photos</span>
              </div>
            `
          : ""
      }

      ${
        isTenantRole()
          ? `
            <button
              class="quick-action"
              type="button"
              data-manual-ops-order-id="${escapeHtml(order.id)}"
            >
              <span>Manual delivery / POD</span>
              <span>Open</span>
            </button>

            <button
              class="quick-action"
              type="button"
              data-open-tariff-modal="${escapeHtml(order.id)}"
            >
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
  const c =
    order.product_completeness ||
    getProductCompleteness(order);

  const latestActivity =
    Array.isArray(order.order_activity_log) &&
    order.order_activity_log.length
      ? order.order_activity_log[0]
      : null;

  const isCancelled =
    normalize(order.derived_lifecycle_status) === "cancelled" ||
    normalize(order.status) === "cancelled" ||
    normalize(order.overall_status) === "cancelled";

  const cancellationReasonLabels = {
    customer_cancelled: "Customer cancelled",
    duplicate_order: "Duplicate order",
    stock_unavailable: "Stock unavailable",
    damaged: "Damaged",
    other: "Other"
  };

  const cancellationReason =
    cancellationReasonLabels[
      normalize(order.cancellation_reason)
    ] ||
    cleanText(order.cancellation_reason) ||
    "—";

  const financeStatus =
    order.derived_finance_status ||
    order.finance_status ||
    "not_invoiced";

  return `
    <tr
      class="expanded-row"
      data-expanded-order-id="${escapeHtml(order.id)}"
    >
      <td colspan="13">
        <div class="order-expanded-panel">

          <div class="expanded-tabs">
            <button
              class="expanded-tab active"
              type="button"
            >
              Overview
            </button>

            <button
              class="expanded-tab"
              type="button"
            >
              Documents
            </button>

            <button
              class="expanded-tab"
              type="button"
            >
              Products
            </button>

            <button
              class="expanded-tab"
              type="button"
            >
              Delivery
            </button>

            ${
              canSeeFinance()
                ? `
                  <button
                    class="expanded-tab"
                    type="button"
                  >
                    Finance
                  </button>
                `
                : ""
            }
          </div>

          <div class="expanded-grid">

            <!-- ORDER DETAILS -->
            <section class="detail-box">
              <h3>Order Details</h3>

              <div class="detail-line">
                <span class="detail-label">Order</span>

                <span class="detail-value">
                  ${escapeHtml(order.order_number || "—")}
                </span>
              </div>

              <div class="detail-line">
                <span class="detail-label">Supplier ref</span>

                <span class="detail-value">
                  ${escapeHtml(order.external_reference || "—")}
                </span>
              </div>

              <div class="detail-line">
                <span class="detail-label">PO</span>

                <span class="detail-value">
                  ${escapeHtml(order.purchase_order || "—")}
                </span>
              </div>

              <div class="detail-line">
                <span class="detail-label">Owner</span>

                <span class="detail-value">
                  ${escapeHtml(
                    order.product_owner_name ||
                    getProductOwnerName(order) ||
                    "—"
                  )}
                </span>
              </div>

              <div class="detail-line">
                <span class="detail-label">Retailer</span>

                <span class="detail-value">
                  ${escapeHtml(
                    order.retailer_name ||
                    getRetailerName(order) ||
                    "—"
                  )}
                </span>
              </div>

              <div class="detail-line">
                <span class="detail-label">Ship to</span>

                <span class="detail-value">
                  ${escapeHtml(
                    order.ship_to_address ||
                    getAddressText(order) ||
                    "—"
                  )}
                </span>
              </div>
            </section>

            <!-- LIFECYCLE -->
            <section class="detail-box">
              <h3>Lifecycle</h3>

              <div class="detail-line">
                <span class="detail-label">Current</span>

                <span class="detail-value">
                  ${pill(order.derived_lifecycle_status)}
                </span>
              </div>

              ${
                isCancelled
                  ? `
                    <div class="detail-line">
                      <span class="detail-label">Reason</span>

                      <span class="detail-value">
                        ${escapeHtml(cancellationReason)}
                      </span>
                    </div>

                    ${
                      order.cancellation_notes
                        ? `
                          <div class="detail-line">
                            <span class="detail-label">Notes</span>

                            <span class="detail-value">
                              ${escapeHtml(
                                order.cancellation_notes
                              )}
                            </span>
                          </div>
                        `
                        : ""
                    }

                    <div class="detail-line">
                      <span class="detail-label">
                        Charge customer
                      </span>

                      <span class="detail-value">
                        ${
                          order.is_chargeable === true
                            ? "Yes"
                            : "No"
                        }
                      </span>
                    </div>

                    <div class="detail-line">
                      <span class="detail-label">Finance</span>

                      <span class="detail-value">
                        ${pill(financeStatus)}
                      </span>
                    </div>
                  `
                  : `
                    <div class="detail-line">
                      <span class="detail-label">
                        Completeness
                      </span>

                      <span class="detail-value">
                        ${formatNumber(c.matched, 0)} /
                        ${formatNumber(c.required, 0)}
                        packages ·
                        ${formatNumber(c.pct, 0)}%
                      </span>
                    </div>

                    <div class="detail-line">
                      <span class="detail-label">
                        Requested
                      </span>

                      <span class="detail-value">
                        ${escapeHtml(
                          formatDate(
                            getRequestedDeliveryDate(order)
                          )
                        )}
                      </span>
                    </div>

                    <div class="detail-line">
                      <span class="detail-label">
                        Expected
                      </span>

                      <span class="detail-value">
                        ${escapeHtml(
                          formatDate(
                            getExpectedDeliveryDate(order)
                          )
                        )}
                      </span>
                    </div>

                    <div class="detail-line">
                      <span class="detail-label">ETA</span>

                      <span class="detail-value">
                        ${escapeHtml(getEtaDisplay(order))}
                      </span>
                    </div>
                  `
              }
            </section>

            <!-- DOCUMENTS -->
            <section class="detail-box">
              <h3>Documents</h3>

              ${renderDocumentsPanel(order)}
            </section>

            <!-- PRODUCTS -->
            <section class="detail-box">
              <h3>Products</h3>

              ${renderProductLines(order)}
            </section>

            <!-- FINANCE / ACTIVITY -->
            <section class="detail-box">
              <h3>
                ${
                  canSeeFinance()
                    ? "Finance / Activity"
                    : "Activity"
                }
              </h3>

              ${
                canSeeFinance()
                  ? `
                    <div class="detail-line">
                      <span class="detail-label">
                        Finance
                      </span>

                      <span class="detail-value">
                        ${pill(financeStatus)}
                      </span>
                    </div>
                  `
                  : ""
              }

              ${
                canSeeInternalPlanningData()
                  ? `
                    <div class="detail-line">
                      <span class="detail-label">
                        Revenue
                      </span>

                      <span class="detail-value">
                        ${formatMoney(
                          getOrderRevenue(order)
                        )}
                      </span>
                    </div>
                  `
                  : ""
              }

              <div class="detail-line">
                <span class="detail-label">Route</span>

                <span class="detail-value">
                  ${escapeHtml(
                    order.routes?.route_code ||
                    order.routes?.route_name ||
                    order.routes?.name ||
                    "—"
                  )}
                </span>
              </div>

              <div class="detail-line">
                <span class="detail-label">Driver</span>

                <span class="detail-value">
                  ${escapeHtml(
                    order.routes?.driver_name ||
                    order.driver_name ||
                    "—"
                  )}
                </span>
              </div>

              <div class="detail-line">
                <span class="detail-label">
                  Last activity
                </span>

                <span class="detail-value">
                  ${escapeHtml(
                    latestActivity?.description ||
                    order.delivery_status_label ||
                    "—"
                  )}
                </span>
              </div>
            </section>

          </div>
        </div>
      </td>
    </tr>
  `;
}

function getStoredDeliveryGroup(group) {
  if (!group?.key) return null;
  return (window.__storedDeliveryGroups || []).find(row => row.group_key === group.key) || null;
}

function renderDeliveryGroupOrdersBlock(title, orders, emptyText) {
  if (!orders?.length) {
    return `
      <div class="delivery-group-empty">
        ${escapeHtml(emptyText)}
      </div>
    `;
  }

  return `
    <div class="delivery-group-orders-block">
      <strong>${escapeHtml(title)}</strong>
      ${orders.map(item => `
        <div class="delivery-group-order-line">
          <span>
            <strong>${escapeHtml(item.orderNumber)}</strong>
            <span class="subline">${escapeHtml(statusLabel(item.status))}</span>
          </span>
          <span>${formatNumber(item.volume, 2)} m³</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDeliveryGroupCard(group) {
  const stored = getStoredDeliveryGroup(group);
  const isApproved = normalize(stored?.status) === "approved";

  const readyVolume = toNumber(group.readyVolume, 0);
  const waitingVolume = toNumber(group.waitingVolume, 0);
  const minimumVolume = toNumber(group.minimumVolume, 1.25);
  const potentialVolume = round2(readyVolume + waitingVolume);

  const shortfall = round2(Math.max(0, minimumVolume - readyVolume));
  const surcharge = round2(shortfall * toNumber(group.tariffPerM3, 55.20));

  const readyEnough = readyVolume >= minimumVolume;
  const hasReadyOrders = group.readyOrders.length > 0;
  const hasWaitingOrders = group.waitingOrders.length > 0;
  const waitingCouldHelp = potentialVolume >= minimumVolume && shortfall > 0;

  let statusHtml = "";

  if (!hasReadyOrders) {
    statusHtml = pill("pending", "Waiting goods");
  } else if (isApproved) {
    statusHtml = pill("confirmed", "Approved");
  } else if (readyEnough) {
    statusHtml = pill("stock_complete", "Ready");
  } else {
    statusHtml = pill("planned", `Below minimum · +${formatMoney(surcharge)}`);
  }

  return `
    <div class="delivery-group-card">
      <div class="delivery-group-card-head">
        <div>
          <h3>${escapeHtml(group.retailer || "Unknown retailer")}</h3>
          <div class="subline">
            ${escapeHtml(group.productOwner || "—")} · ${escapeHtml(group.postcode || "No postcode")}
          </div>
        </div>
        <div>${statusHtml}</div>
      </div>

      <div class="delivery-group-metrics">
        <div class="delivery-group-metric">
          <span>Ready orders</span>
          <strong>${formatNumber(group.readyOrders.length, 0)}</strong>
        </div>

        <div class="delivery-group-metric">
          <span>Waiting orders</span>
          <strong>${formatNumber(group.waitingOrders.length, 0)}</strong>
        </div>

        <div class="delivery-group-metric">
          <span>Ready volume</span>
          <strong>${formatNumber(readyVolume, 2)} / ${formatNumber(minimumVolume, 2)} m³</strong>
        </div>

        <div class="delivery-group-metric">
          <span>Potential volume</span>
          <strong>${formatNumber(potentialVolume, 2)} m³</strong>
        </div>
      </div>

      ${
        shortfall > 0
          ? `
            <div class="delivery-group-warning">
              <strong>Shortfall ${formatNumber(shortfall, 2)} m³</strong>
              <span>Additional transport charge: ${formatMoney(surcharge)}</span>
              ${
                waitingCouldHelp
                  ? `<span>Waiting orders could bring this delivery above the minimum.</span>`
                  : hasWaitingOrders
                    ? `<span>Even with waiting orders, this stays below minimum.</span>`
                    : `<span>No waiting orders available for this retailer.</span>`
              }
            </div>
          `
          : `
            <div class="delivery-group-ok">
              Minimum volume is met for the ready orders.
            </div>
          `
      }

      <div class="delivery-group-card-grid">
        ${renderDeliveryGroupOrdersBlock("Ready to deliver", group.readyOrders, "No ready orders.")}
        ${renderDeliveryGroupOrdersBlock("Waiting / potential", group.waitingOrders, "No waiting orders.")}
      </div>

      <div class="delivery-group-decision">
        ${
          isApproved
            ? `
              <div>
                <strong>Approved</strong>
                <span class="subline">
                  ${escapeHtml(stored?.approved_by_name || "Unknown user")}
                  ${stored?.approved_at ? ` · ${escapeHtml(formatDateTime(stored.approved_at))}` : ""}
                </span>
                <span class="subline">
                  Applied surcharge: ${formatMoney(stored?.applied_surcharge || surcharge)}
                </span>
              </div>
            `
            : !hasReadyOrders
              ? `
                <div>
                  <strong>No ready orders yet</strong>
                  <span class="subline">Wait until at least one order is stock complete or planned.</span>
                </div>
              `
              : readyEnough
                ? `
                  <div>
                    <strong>Ready to deliver</strong>
                    <span class="subline">No minimum-volume approval required.</span>
                  </div>
                `
                : `
                  <div>
                    <strong>Decision required</strong>
                    <span class="subline">Deliver ready orders now, or hold for waiting orders.</span>
                  </div>

                  <button
                    class="btn btn-primary"
                    type="button"
                    data-open-delivery-group="${escapeHtml(group.key)}"
                  >
                    Review Delivery
                  </button>
                `
        }
      </div>
    </div>
  `;
}

function renderDeliveryGroupsView() {
  const tableWrap = byId("ordersTableWrap");
  const groupsWrap = byId("deliveryGroupsWrap");
  const container = byId("deliveryGroupsContainer");

  if (!tableWrap || !groupsWrap || !container) return;

  tableWrap.style.display = "none";
  groupsWrap.style.display = "";

  const visibleGroups = new Map();

  filteredOrders.forEach(order => {
    const group = getDeliveryGroup(order);
    if (!group) return;
    visibleGroups.set(group.key, group);
  });

  const groups = [...visibleGroups.values()]
    .filter(group => group.readyOrders.length || group.waitingOrders.length)
    .sort((a, b) => {
      const aNeedsDecision = a.readyOrders.length && a.shortfall > 0 ? 1 : 0;
      const bNeedsDecision = b.readyOrders.length && b.shortfall > 0 ? 1 : 0;

      if (bNeedsDecision !== aNeedsDecision) return bNeedsDecision - aNeedsDecision;
      if (b.readyVolume !== a.readyVolume) return b.readyVolume - a.readyVolume;

      return String(a.retailer || "").localeCompare(String(b.retailer || ""), "en");
    });

  if (!groups.length) {
    container.innerHTML = `
      <div class="delivery-group-empty">
        No delivery groups found.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="delivery-groups-view">
      ${groups.map(group => renderDeliveryGroupCard(group)).join("")}
    </div>
  `;

  bindDeliveryGroupTableEvents();
}

async function approveDeliveryGroup(groupKey, options = {}) {
  const group = deliveryGroupsMap.get(groupKey);
  if (!group) throw new Error("Delivery group not found.");

  const cid = await getCompanyId();

  const payload = {
    company_id: cid,
    product_owner_id: null,
    product_owner_name: group.productOwner || "",
    retailer_name: group.retailer || "",
    retailer_code: "",
    delivery_postcode: group.postcode || "",
    group_key: group.key,

    ready_volume_m3: round2(group.readyVolume),
    waiting_volume_m3: round2(group.waitingVolume),
    minimum_volume_m3: round2(group.minimumVolume),
    shortfall_m3: round2(group.shortfall),
    tariff_per_m3: round2(group.tariffPerM3),

    calculated_surcharge: round2(group.surcharge),
applied_surcharge: round2(options.appliedSurcharge ?? group.surcharge),

    status: "approved",
    approval_note: options.approvalNote || "Delivery approved from OCC.",
    approved_by: currentUser?.id || null,
    approved_by_name: currentProfile?.full_name || currentUser?.email || "Unknown user",
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await client
    .from("delivery_groups")
    .upsert(payload, {
      onConflict: "company_id,group_key"
    })
    .select("id")
    .single();

  if (error) throw error;

  const deliveryGroupId = data.id;

  await client
    .from("delivery_group_orders")
    .delete()
    .eq("delivery_group_id", deliveryGroupId);

  const rows = [
    ...group.readyOrders.map(order => ({
      company_id: cid,
      delivery_group_id: deliveryGroupId,
      order_id: order.id,
      order_number: order.orderNumber,
      order_status: order.status,
      volume_m3: round2(order.volume),
      group_role: "ready"
    })),
    ...group.waitingOrders.map(order => ({
      company_id: cid,
      delivery_group_id: deliveryGroupId,
      order_id: order.id,
      order_number: order.orderNumber,
      order_status: order.status,
      volume_m3: round2(order.volume),
      group_role: "waiting"
    }))
  ];

  if (rows.length) {
    const { error: orderError } = await client
      .from("delivery_group_orders")
      .insert(rows);

    if (orderError) throw orderError;
  }

  await client
    .from("delivery_group_activity")
    .insert({
      company_id: cid,
      delivery_group_id: deliveryGroupId,
      activity_type: "approved",
      description: `Delivery approved. Applied surcharge ${formatMoney(options.appliedSurcharge ?? group.surcharge)}.${options.approvalNote ? ` Note: ${options.approvalNote}` : ""}`,
      created_by: currentUser?.id || null,
      created_by_name: currentProfile?.full_name || currentUser?.email || "Unknown user"
    });

  showToast(`Delivery group approved: ${formatMoney(group.surcharge)} surcharge.`, "ok");
}

function bindDeliveryGroupTableEvents() {
  document.querySelectorAll("[data-open-delivery-group]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const key = button.getAttribute("data-open-delivery-group");
      openDeliveryGroupApprovalModal(key);
    });
  });
}

function openDeliveryGroupApprovalModal(groupKey) {
  const group = deliveryGroupsMap.get(groupKey);

  if (!group) {
    showToast("Delivery group not found.", "err");
    return;
  }

  const readyVolume = toNumber(group.readyVolume, 0);
  const waitingVolume = toNumber(group.waitingVolume, 0);
  const minimumVolume = toNumber(group.minimumVolume, 1.25);
  const shortfall = round2(Math.max(0, minimumVolume - readyVolume));
  const surcharge = round2(shortfall * toNumber(group.tariffPerM3, 55.20));

  byId("deliveryGroupKey").value = group.key;

  setText("deliveryGroupModalSub", "Review minimum delivery volume and approve the ready orders for planning.");
  setText("deliveryGroupOwner", group.productOwner || "—");
  setText("deliveryGroupRetailer", group.retailer || "—");
  setText("deliveryGroupPostcode", group.postcode || "—");
  setText("deliveryGroupDate", "Ready orders only");

  setText("deliveryGroupActualVolume", `${formatNumber(readyVolume, 2)} m³`);
  setText("deliveryGroupMinimumVolume", `${formatNumber(minimumVolume, 2)} m³`);
  setText("deliveryGroupShortfall", `${formatNumber(shortfall, 2)} m³`);
  setText("deliveryGroupTariff", `${formatMoney(group.tariffPerM3)} / m³`);
  setText("deliveryGroupCalculatedSurcharge", formatMoney(surcharge));

  const surchargeInput = byId("deliveryGroupAppliedSurcharge");
if (surchargeInput) {
  surchargeInput.value = surcharge.toFixed(2);
  surchargeInput.readOnly = !isTenantRole();
}

  const noteInput = byId("deliveryGroupApprovalNote");
  if (noteInput) noteInput.value = "";

  const list = byId("deliveryGroupOrdersList");
  if (list) {
    list.innerHTML = `
      <div class="quick-action" style="background:#ecfdf5;border-color:#bbf7d0;">
        <span><strong>Ready to deliver</strong></span>
        <span>${formatNumber(group.readyOrders.length, 0)} order(s)</span>
      </div>

      ${group.readyOrders.map(order => `
        <div class="quick-action">
          <span>
            <strong>${escapeHtml(order.orderNumber)}</strong>
            <span class="subline">${escapeHtml(statusLabel(order.status))}</span>
          </span>
          <span>${formatNumber(order.volume, 2)} m³</span>
        </div>
      `).join("")}

      <div class="quick-action" style="background:#fff7ed;border-color:#fed7aa;margin-top:8px;">
        <span><strong>Waiting / potential</strong></span>
        <span>${formatNumber(group.waitingOrders.length, 0)} order(s)</span>
      </div>

      ${
        group.waitingOrders.length
          ? group.waitingOrders.map(order => `
              <div class="quick-action" style="opacity:.82;">
                <span>
                  <strong>${escapeHtml(order.orderNumber)}</strong>
                  <span class="subline">${escapeHtml(statusLabel(order.status))}</span>
                </span>
                <span>${formatNumber(order.volume, 2)} m³</span>
              </div>
            `).join("")
          : `
              <div class="quick-action" style="opacity:.7;">
                <span>No waiting orders</span>
                <span>—</span>
              </div>
            `
      }
    `;
  }

  byId("deliveryGroupModal")?.classList.add("open");
  byId("deliveryGroupModal")?.setAttribute("aria-hidden", "false");
}

function closeDeliveryGroupApprovalModal() {
  byId("deliveryGroupModal")?.classList.remove("open");
  byId("deliveryGroupModal")?.setAttribute("aria-hidden", "true");
}

async function approveDeliveryGroupFromModal() {
  const key = byId("deliveryGroupKey")?.value || "";
  const appliedSurcharge = toNumber(byId("deliveryGroupAppliedSurcharge")?.value, 0);
  const approvalNote = byId("deliveryGroupApprovalNote")?.value || "";

  await approveDeliveryGroup(key, {
    appliedSurcharge,
    approvalNote
  });

  closeDeliveryGroupApprovalModal();
  await loadOrders();
}

function renderTable() {
  const tbody = byId("ordersBody");
  if (!tbody) return;

if (showDeliveryGroups) {
  renderDeliveryGroupsView();
  return;
}

byId("ordersTableWrap").style.display = "";
byId("deliveryGroupsWrap").style.display = "none";

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
  ${renderOrderTypeBadge(order)}
</td>

<td>
<strong class="ack-ref ${isAckDownloaded(order) ? "ack-ref-downloaded" : ""}">
  ${escapeHtml(order.external_reference || "—")}
</strong>
<span class="subline">
    Supplier / ACK ref
</span>
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

${canSeeFinance() ? `<td class="finance-column">${renderDeliveryGroupCell(order)}</td>` : ""}

<td class="activity-cell">
            ${escapeHtml(formatDateTime(order.last_activity_at || order.created_at))}
            <span class="subline">${escapeHtml(order.order_activity_log?.[0]?.description || order.delivery_status_label || "—")}</span>
          </td>
          <td class="actions-cell">
  ${
    isTenantRole()
      ? `<button
           class="action-menu-btn tenant-only"
           type="button"
           data-order-actions="${escapeHtml(orderId)}">
           ⋯
         </button>`
      : `<button
           class="action-menu-btn"
           type="button"
           data-expand-order-id="${escapeHtml(orderId)}">
           ⋯
         </button>`
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

function closeOrderActionMenu() {
  const menu = byId("occRowActionMenu");
  if (!menu) return;

  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
  menu.dataset.orderId = "";
}

byId("genericActionCloseBtn")?.addEventListener("click", closeGenericActionModal);
byId("genericActionCancelBtn")?.addEventListener("click", closeGenericActionModal);

byId("occGenericActionModal")?.addEventListener("click", event => {
  if (event.target === byId("occGenericActionModal")) {
    closeGenericActionModal();
  }
});

function openOrderActionMenu(orderId, button) {
  const menu = byId("occRowActionMenu");

  if (!menu) {
    showToast("Order action menu not found in HTML.", "err");
    return;
  }

  if (!button) {
    showToast("Order action button not found.", "err");
    return;
  }

  const rect = button.getBoundingClientRect();

  menu.dataset.orderId = orderId;
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(12, rect.right - 230)}px`;

  menu.classList.add("open");
  menu.setAttribute("aria-hidden", "false");

  console.log("Order action menu opened", { orderId });
}

async function saveFdsActualDeliveryDate(orderId, date) {
  if (!orderId) throw new Error("Order id missing.");

  await safeUpdateOrder(orderId, {
    confirmed_delivery_date: date,
    delivery_eta_status: date ? "confirmed" : "carrier",
    last_activity_at: new Date().toISOString()
  });

  await insertOrderActivity(
    orderId,
    date
      ? `FDS actual delivery date set to ${date}.`
      : "FDS actual delivery date removed.",
    "fds_actual_delivery_date"
  );

  await loadOrders();

  showToast("FDS actual delivery date saved.", "ok");
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

tbody.querySelectorAll("[data-fds-actual-date]").forEach(input => {
  input.addEventListener("click", event => {
    event.stopPropagation();
  });

  input.addEventListener("change", async event => {
    event.stopPropagation();

    const orderId = input.getAttribute("data-fds-actual-date");
    const date = input.value || null;

    try {
      await saveFdsActualDeliveryDate(orderId, date);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not save FDS actual date.", "err");
    }
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

tbody.querySelectorAll("[data-order-actions]").forEach(button => {
  button.addEventListener("click", event => {
    event.stopPropagation();

    const orderId = String(button.getAttribute("data-order-actions") || "");

    openOrderActionMenu(orderId, button);
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
    event.preventDefault();
    event.stopPropagation();

tbody.querySelectorAll("[data-portal-doc-type='ack']").forEach(link => {
  link.addEventListener("click", () => {
    const orderId = link.getAttribute("data-order-id");

    if (orderId) {
      ackDownloadedOrderIds.add(String(orderId));
      renderTable();
    }
  });
});

    const orderId = button.getAttribute("data-order-id");
    const docType = button.getAttribute("data-doc-action");

    try {
      if (docType === "acknowledgement") return generateAcknowledgement(orderId);
      if (docType === "delivery_note") return generateDeliveryNote(orderId);
      if (docType === "delivery_labels") return generateDeliveryLabels(orderId);
      if (docType === "invoice") return generateSingleInvoice(orderId);

      if (docType === "credit_note") {
        const order = getOrderById(orderId);
        const existing = getDoc(order, "credit_note");

        if (existing?.file_url) {
          window.open(existing.file_url, "_blank");
          return;
        }

        showToast("Credit Note PDF not found.", "err");
        return;
      }

      return createPlaceholderDocument(orderId, docType);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not generate document.", "err");
    }
  });
});

tbody.querySelectorAll("[data-upload-legacy-ack]").forEach(button => {
  button.addEventListener("click", event => {
    event.stopPropagation();
    openLegacyAckUpload(button.getAttribute("data-upload-legacy-ack"));
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
    padding:24px;
  }
.ack-ref-check{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:15px;
  height:15px;
  margin-left:6px;
  border-radius:999px;
  background:#16a34a;
  color:#fff;
  font-size:10px;
  font-weight:950;
  vertical-align:middle;
}

.ack-ref{
    display:inline-flex;
    align-items:center;
    padding:3px 8px;
    border-radius:8px;
    font-weight:700;
    border:1px solid transparent;
}

.ack-ref-downloaded{
    background:#ecfdf5;
    border-color:#bbf7d0;
    color:#15803d;
}

.ack-ref-text{
  margin-left:6px;
  color:#047857;
  font-weight:950;
}

  .occ-memo-modal-card{
    width:min(1120px,96vw);
    background:#fff;
    border-radius:18px;
    box-shadow:0 24px 60px rgba(15,23,42,.25);
    padding:18px;
  }

  .occ-memo-modal-head{
    display:flex;
    justify-content:space-between;
    gap:12px;
    align-items:center;
    margin-bottom:12px;
  }

  .occ-memo-modal-text{
    white-space:pre-wrap;
    border:1px solid #d1d5db;
    border-radius:12px;
    padding:12px;
    min-height:140px;
    max-height:60vh;
    overflow:auto;
    background:#f8fafc;
  }

  .occ-photo-backdrop{
  background:rgba(15,23,42,.58);
  padding:24px;
  overflow:hidden;
}

.occ-photo-modal-card{
  width:min(1180px,96vw);
  max-height:92vh;
  display:flex;
  flex-direction:column;
  background:#fff;
  border-radius:18px;
  box-shadow:0 24px 70px rgba(15,23,42,.28);
  overflow:hidden;
}

.occ-photo-modal-header{
  flex:0 0 auto;
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:20px;
  padding:18px 20px;
  border-bottom:1px solid #dce5f2;
  background:#fff;
}

.occ-photo-modal-header h2{
  margin:0 0 8px;
  font-size:20px;
  color:#07152f;
}

.occ-photo-order-meta{
  display:flex;
  flex-wrap:wrap;
  gap:6px 16px;
  font-size:12px;
  color:#64748b;
}

.occ-photo-order-meta span{
  white-space:nowrap;
}

.occ-photo-close{
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
  font-size:26px;
  line-height:1;
  cursor:pointer;
}

.occ-photo-close:hover{
  background:#f1f5f9;
  color:#0f172a;
}

.occ-photo-modal-body{
  flex:1 1 auto;
  min-height:0;
  padding:20px;
  overflow-y:auto;
  background:#f8fafc;
}

.occ-photo-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:20px;
  align-items:start;
}

.occ-photo-card{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:12px;
  padding:14px;
  border:1px solid #dce5f2;
  border-radius:14px;
  background:#fff;
  box-shadow:0 4px 14px rgba(15,23,42,.06);
}

.occ-photo-number{
  font-size:12px;
  font-weight:850;
  color:#475569;
}

.occ-photo-preview-link{
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:260px;
  max-height:430px;
  overflow:hidden;
  border:1px solid #e2e8f0;
  border-radius:10px;
  background:#f1f5f9;
}

.occ-photo-preview-link img{
  display:block;
  width:100%;
  height:100%;
  max-height:430px;
  object-fit:contain;
  background:#f8fafc;
}

.occ-photo-download{
  align-self:flex-start;
  min-width:170px;
  text-align:center;
}

.occ-photo-modal-footer{
  flex:0 0 auto;
  display:flex;
  justify-content:flex-end;
  padding:14px 20px;
  border-top:1px solid #dce5f2;
  background:#fff;
}

.occ-photo-empty{
  padding:36px;
  border:1px dashed #cbd5e1;
  border-radius:12px;
  background:#fff;
  color:#64748b;
  text-align:center;
}

@media (max-width:800px){
  .occ-photo-backdrop{
    padding:10px;
  }

  .occ-photo-modal-card{
    width:100%;
    max-height:96vh;
  }

  .occ-photo-grid{
    grid-template-columns:1fr;
  }

  .occ-photo-order-meta{
    display:grid;
    gap:4px;
  }

  .occ-photo-preview-link{
    min-height:220px;
  }
}

  .manual-tariff-table-wrap{
    overflow:auto;
    border:1px solid #dce5f2;
    border-radius:12px;
    background:#fff;
  }

  .manual-tariff-table{
    width:100%;
    min-width:980px;
    border-collapse:collapse;
  }

  .manual-tariff-table th,
  .manual-tariff-table td{
    padding:9px 10px;
    border-bottom:1px solid #e5edf7;
    text-align:left;
    vertical-align:top;
    font-size:12px;
  }

  .manual-tariff-table th{
    background:#f8fafc;
    color:#334155;
    font-size:10px;
    font-weight:950;
    text-transform:uppercase;
    letter-spacing:.04em;
  }

  .manual-tariff-table input,
  .manual-tariff-table select{
    width:100%;
    min-height:38px;
    border:1px solid #dce5f2;
    border-radius:9px;
    padding:7px 9px;
    font-size:12px;
    background:#fff;
  }

  .manual-tariff-total{
    font-weight:950;
    color:#07152f;
    white-space:nowrap;
  }

  .manual-tariff-footer{
    display:flex;
    justify-content:space-between;
    gap:12px;
    align-items:center;
    flex-wrap:wrap;
  }

  .manual-tariff-summary{
    font-size:12px;
    color:#334155;
    font-weight:850;
  }

  .edit-products-table{
    min-width:1120px;
    table-layout:fixed;
  }

  .edit-products-table th:nth-child(1),
  .edit-products-table td:nth-child(1){ width:300px; }

  .edit-products-table th:nth-child(2),
  .edit-products-table td:nth-child(2){ width:230px; }

  .edit-products-table th:nth-child(3),
  .edit-products-table td:nth-child(3){ width:80px; }

  .edit-products-table th:nth-child(4),
  .edit-products-table td:nth-child(4){ width:95px; }

  .edit-products-table th:nth-child(5),
  .edit-products-table td:nth-child(5){ width:115px; }

  .edit-products-table th:nth-child(6),
  .edit-products-table td:nth-child(6){ width:115px; }

  .edit-products-table th:nth-child(7),
  .edit-products-table td:nth-child(7){
    width:120px;
    text-align:right;
  }

  .edit-products-table td:nth-child(4),
  .edit-products-table td:nth-child(5),
  .edit-products-table td:nth-child(6){
    white-space:nowrap;
    font-weight:800;
  }

.quick-action.ack-downloaded{
    background:#dcfce7 !important;
    border:1px solid #86efac !important;
    color:#166534 !important;
    font-weight:700;
}

.quick-action.ack-downloaded span{
    color:#166534 !important;
    font-weight:700;
}

  .quick-action.ack-downloaded span:last-child{
    color:#047857 !important;
    font-weight:950;
  }

  .ack-dot{
    display:inline-flex;
    width:10px;
    height:10px;
    border-radius:999px;
    background:#16a34a;
    box-shadow:0 0 0 3px rgba(22,163,74,.16);
    margin-left:6px;
    vertical-align:middle;
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

  const order = allOrders.find(
    row => String(row.id) === String(orderId)
  );

  if (!order) {
    showToast("Order not found.", "err");
    return;
  }

  const photos = getPodPhotos(order);

  const ack = order.external_reference || "NO-ACK";
  const so = order.order_number || "Order";
  const retailer =
    order.retailer_name ||
    order.retail_name ||
    "Retailer";

  const deliveryDate = formatDate(
    order.confirmed_delivery_date ||
    order.pod_signed_at ||
    order.updated_at ||
    order.created_at
  );

  const modal = document.createElement("div");
  modal.className = "occ-memo-modal-backdrop occ-photo-backdrop";

  modal.innerHTML = `
    <section class="occ-photo-modal-card">

      <div class="occ-photo-modal-header">
        <div>
          <h2>Delivery Photos</h2>

          <div class="occ-photo-order-meta">
            <span><strong>${escapeHtml(so)}</strong></span>
            <span>ACK: ${escapeHtml(ack)}</span>
            <span>${escapeHtml(retailer)}</span>
            <span>Delivered: ${escapeHtml(deliveryDate)}</span>
          </div>
        </div>

        <button
          class="occ-photo-close"
          type="button"
          data-close-photo-modal
          aria-label="Close delivery photos"
        >
          ×
        </button>
      </div>

      <div class="occ-photo-modal-body">
        ${
          photos.length
            ? `
              <div class="occ-photo-grid">
                ${photos.map((url, index) => {
                  const fileName =
                    `${so}-${ack}-POD-photo-${index + 1}.jpg`;

                  return `
                    <article class="occ-photo-card">
                      <div class="occ-photo-number">
                        Photo ${index + 1}
                      </div>

                      <a
                        href="${escapeHtml(url)}"
                        target="_blank"
                        rel="noopener"
                        class="occ-photo-preview-link"
                        title="Open photo in full size"
                      >
                        <img
                          src="${escapeHtml(url)}"
                          alt="POD photo ${index + 1}"
                          loading="lazy"
                        />
                      </a>

                      <a
                        href="${escapeHtml(url)}"
                        download="${escapeHtml(fileName)}"
                        class="btn btn-primary occ-photo-download"
                      >
                        Download Photo ${index + 1}
                      </a>
                    </article>
                  `;
                }).join("")}
              </div>
            `
            : `
              <div class="occ-photo-empty">
                No delivery photos are available for this order.
              </div>
            `
        }
      </div>

      <div class="occ-photo-modal-footer">
        <button
          class="btn"
          type="button"
          data-close-photo-modal
        >
          Close
        </button>
      </div>

    </section>
  `;

  function closePhotoModal() {
    document.removeEventListener(
      "keydown",
      handlePhotoModalKeydown
    );

    modal.remove();
  }

  function handlePhotoModalKeydown(event) {
    if (event.key === "Escape") {
      closePhotoModal();
    }
  }

  modal.addEventListener("click", event => {
    if (
      event.target === modal ||
      event.target.closest("[data-close-photo-modal]")
    ) {
      closePhotoModal();
    }
  });

  document.addEventListener(
    "keydown",
    handlePhotoModalKeydown
  );

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
                <table class="manual-tariff-table edit-products-table">
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

async function generateDeliveryLabels(orderId) {
  const order = allOrders.find(row => String(row.id) === String(orderId));

  if (!order) {
    showToast("Order not found for delivery labels.", "err");
    return;
  }

  if (window.DeliveryLabelGenerator?.generate) {
    const result = await window.DeliveryLabelGenerator.generate(orderId);

if (result?.fileUrl) {
  window.open(result.fileUrl, "_blank", "noopener");
}

    await loadOrders();
    showToast("Delivery labels generated and downloaded.", "ok");
    return;
  }

  showToast("Delivery Label Generator not available.", "err");
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

async function loadProductsForEditor() {
  if (allProducts.length) return allProducts;

  const cid = await getCompanyId();

  const { data, error } = await client
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
      packages_per_unit
    `)
    .eq("company_id", cid)
    .order("sku_base", { ascending: true });

  if (error) throw error;

  allProducts = data || [];
  return allProducts;
}

function getLineWeightKg(line) {
  const qty = getLineRequiredQty(line) || 1;
  const weight =
    toNumber(line.total_line_weight_kg, 0) ||
    toNumber(line.total_weight_kg, 0) ||
    (toNumber(line.unit_weight_kg, 0) * qty) ||
    (toNumber(line.products?.weight_kg, 0) * qty) ||
    (toNumber(line.products?.net_weight_kg, 0) * qty);

  return weight;
}

function renderProductOptionsForOrder(order) {
  return allProducts
    .filter(product => !order.customer_id || !product.customer_id || String(product.customer_id) === String(order.customer_id))
    .map(product => `
      <option
        value="${escapeHtml(product.id)}"
        data-sku="${escapeHtml(product.sku_base || "")}"
        data-description="${escapeHtml(product.description || product.name || "")}"
        data-volume="${escapeHtml(product.volume_m3 || 0)}"
        data-weight="${escapeHtml(product.weight_kg || product.net_weight_kg || 0)}"
        data-packages="${escapeHtml(getProductPackageCount(product))}">
        ${escapeHtml(product.sku_base || "SKU")} · ${escapeHtml(product.description || product.name || "")}
      </option>
    `)
    .join("");
}

function getSelectedProductFromEditRow(row) {
  const select = row.querySelector("[data-edit-line-product]");
  const option = select?.selectedOptions?.[0];

  if (!option || !option.value) return null;

  return {
    id: option.value,
    sku: option.dataset.sku || "",
    description: option.dataset.description || "",
    volume: toNumber(option.dataset.volume, 0),
    weight: toNumber(option.dataset.weight, 0),
    packages: Math.max(1, Math.round(toNumber(option.dataset.packages, 1)))
  };
}

function refreshEditProductLineRow(row) {
  const product = getSelectedProductFromEditRow(row);
  const qty = Math.max(0, Math.round(toNumber(row.querySelector("[data-edit-line-qty]")?.value, 0)));

  if (!product) return;

  const descInput = row.querySelector("[data-edit-line-description]");
  if (descInput && !descInput.value) descInput.value = product.description;

  const packagesCell = row.querySelector("[data-edit-line-packages]");
  const volumeCell = row.querySelector("[data-edit-line-volume]");
  const weightCell = row.querySelector("[data-edit-line-weight]");

  if (packagesCell) packagesCell.textContent = formatNumber(qty * product.packages, 0);
  if (volumeCell) volumeCell.textContent = `${formatNumber(qty * product.volume, 2)} m³`;
  if (weightCell) weightCell.textContent = `${formatNumber(qty * product.weight, 2)} kg`;
}

function bindEditProductEditorEvents(order) {
  const body = byId("editProductLinesBody");
  if (!body) return;

  body.querySelectorAll("[data-edit-line-product], [data-edit-line-qty]").forEach(input => {
    input.addEventListener("input", () => refreshEditProductLineRow(input.closest("tr")));
    input.addEventListener("change", () => refreshEditProductLineRow(input.closest("tr")));
  });

body.querySelectorAll("[data-remove-edit-line]").forEach(button => {
  button.addEventListener("click", () => {
    const row = button.closest("tr");
    if (!row) return;

    const lineId = row.getAttribute("data-edit-line-id");

    if (lineId && row.dataset.newLine !== "1") {
      const removed = JSON.parse(body.dataset.removedLineIds || "[]");
      if (!removed.includes(lineId)) removed.push(lineId);
      body.dataset.removedLineIds = JSON.stringify(removed);
    }

    row.remove();
  });
});

  byId("btnAddEditProductLine")?.addEventListener("click", () => {
    const rowKey = `new-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const tr = document.createElement("tr");
    tr.setAttribute("data-edit-line-id", rowKey);
    tr.setAttribute("data-new-line", "1");

    tr.innerHTML = `
      <td>
        <select class="input" data-edit-line-product>
          <option value="">Select product</option>
          ${renderProductOptionsForOrder(order)}
        </select>
      </td>

      <td>
        <input class="input" data-edit-line-description value="">
      </td>

      <td>
        <input class="input" type="number" min="0" step="1" data-edit-line-qty value="1">
      </td>

      <td data-edit-line-packages>0</td>
      <td data-edit-line-volume>0.00 m³</td>
      <td data-edit-line-weight>0.00 kg</td>

      <td>
        <button class="mini-btn" type="button" data-remove-edit-line>Remove</button>
      </td>
    `;

    body.appendChild(tr);

    tr.querySelector("[data-edit-line-product]")?.addEventListener("change", () => refreshEditProductLineRow(tr));
    tr.querySelector("[data-edit-line-qty]")?.addEventListener("input", () => refreshEditProductLineRow(tr));
    tr.querySelector("[data-remove-edit-line]")?.addEventListener("click", () => tr.remove());
  });

  body.querySelectorAll("tr[data-edit-line-id]").forEach(refreshEditProductLineRow);
}

async function openGenericActionModal(orderId, action) {
  ensurePageStyles();

  const order = getOrderById(orderId);

  if (!order) {
    showToast("Order not found.", "err");
    return;
  }

  byId("genericActionOrderId").value = order.id;
  byId("genericActionType").value = action;

  const titleMap = {
    copy_order: "Create Copy Order",
    credit_order: "Create Credit Order",
    change_status: "Change Status",
    view_activity: "View Activity",
    warehouse_events: "Warehouse Events",
    portal_events: "Portal Events"
  };

  setText("genericActionTitle", titleMap[action] || "Order action");

  setText(
    "genericActionSub",
    `${order.order_number || "Order"} · ${order.retailer_name || ""} · ${order.delivery_postcode || ""}`
  );

  const body = byId("genericActionBody");
  const saveBtn = byId("genericActionSaveBtn");

  if (!body || !saveBtn) return;

  saveBtn.style.display = "none";

  body.innerHTML = `
    <h3>${escapeHtml(titleMap[action] || "Order action")}</h3>
    <p class="occ-help">
      This tool is temporarily disabled. The order itself is not changed.
    </p>
  `;

  byId("occGenericActionModal")?.classList.add("open");
  byId("occGenericActionModal")?.setAttribute("aria-hidden", "false");
}

function closeGenericActionModal() {
  byId("occGenericActionModal")?.classList.remove("open");
  byId("occGenericActionModal")?.setAttribute("aria-hidden", "true");
}

function getOrderById(orderId) {
  return allOrders.find(order => String(order.id) === String(orderId)) || null;
}

async function getNextCopyOrderNumber(originalOrderNumber) {
  const base = String(originalOrderNumber || "COPY").trim();

  const cleanBase = base.replace(/C\d*$/i, "");
  const firstCopy = `${cleanBase}C`;

  const cid = await getCompanyId();

  const { data, error } = await client
    .from("orders")
    .select("order_number")
    .eq("company_id", cid)
    .ilike("order_number", `${firstCopy}%`);

  if (error) throw error;

  const existing = new Set((data || []).map(row => String(row.order_number || "").toUpperCase()));

  if (!existing.has(firstCopy.toUpperCase())) {
    return firstCopy;
  }

  for (let i = 2; i < 999; i++) {
    const candidate = `${firstCopy}${i}`;
    if (!existing.has(candidate.toUpperCase())) {
      return candidate;
    }
  }

  throw new Error("Could not create a unique copy order number.");
}

function openEditOrderModal(orderId) {
  return openGenericActionModal(orderId, "edit_order");
}

function openCopyOrderModal(orderId) {
  return openGenericActionModal(orderId, "copy_order");
}

function openCreditOrderModal(orderId) {
  return openGenericActionModal(orderId, "credit_order");
}

function openStatusModal(orderId) {
  return openGenericActionModal(orderId, "change_status");
}

function openActivityModal(orderId) {
  return openGenericActionModal(orderId, "view_activity");
}

function openWarehouseEventsModal(orderId) {
  return openGenericActionModal(orderId, "warehouse_events");
}

function openPortalEventsModal(orderId) {
  return openGenericActionModal(orderId, "portal_events");
}

async function releaseAllocationsForLine(lineId, releaseCount = null) {
  const order = getOrderById(byId("genericActionOrderId")?.value || "");
  const line = (order?.order_lines || []).find(l => String(l.id) === String(lineId));

  const allocations = (line?.order_allocations || [])
    .filter(a => !["cancelled"].includes(normalize(a.allocation_status)));

  const toRelease = releaseCount === null
    ? allocations
    : allocations.slice(0, Math.max(0, releaseCount));

  const allocationIds = toRelease.map(a => a.id).filter(Boolean);

  if (allocationIds.length) {
    const { error } = await client
      .from("order_allocations")
      .update({ allocation_status: "cancelled" })
      .in("id", allocationIds);

    if (error) throw error;
  }

  for (const allocation of toRelease) {
    const physicalProductId = allocation.items?.physical_product_id || null;
    const stockSetId = allocation.items?.stock_set_id || allocation.stock_set_id || null;
    const itemId = allocation.item_id || allocation.items?.id || null;

    let query = client
      .from("items")
      .update({
        status: "in_stock",
        linked_order_id: null,
        reserved_at: null
      });

    if (physicalProductId) {
      query = query.eq("physical_product_id", physicalProductId);
    } else if (stockSetId) {
      query = query.eq("stock_set_id", stockSetId);
    } else if (itemId) {
      query = query.eq("id", itemId);
    } else {
      continue;
    }

    const { error } = await query;
    if (error) throw error;
  }

  if (toRelease.length) {
    await insertOrderActivity(
      order.id,
      `${toRelease.length} allocation(s) released back to stock after order edit.`,
      "order_edit_stock_released"
    );
  }

  return toRelease.length;
}
async function runMatchingForEditedOrder(orderId) {
  if (!byId("editRunMatching")?.checked) {
    return { skipped: true, allocationsCreated: 0, itemsReserved: 0 };
  }

  if (!window.AllocationEngine?.run) {
    throw new Error("AllocationEngine is not loaded. Add allocation-engine.js before operations-control-center.js.");
  }

  const result = await window.AllocationEngine.run({
    orderIds: [orderId],
    dryRun: false
  });

  return {
    skipped: false,
    allocationsCreated: result?.allocations_created ?? result?.allocationsCreated ?? result?.created ?? 0,
    itemsReserved: result?.items_reserved ?? result?.itemsReserved ?? 0
  };
}

async function neutralizeOrderLineFromDb(orderId, lineId) {
  const { data: allocations, error: allocError } = await client
    .from("order_allocations")
    .select(`
      id,
      item_id,
      items (
        id,
        physical_product_id,
        stock_set_id
      )
    `)
    .eq("order_line_id", lineId);

  if (allocError) throw allocError;

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

    if (physicalProductId) {
      query = query.eq("physical_product_id", physicalProductId);
    } else if (stockSetId) {
      query = query.eq("stock_set_id", stockSetId);
    } else if (itemId) {
      query = query.eq("id", itemId);
    } else {
      continue;
    }

    const { error } = await query;
    if (error) throw error;
  }

  const { error: deleteAllocError } = await client
    .from("order_allocations")
    .delete()
    .eq("order_line_id", lineId);

  if (deleteAllocError) throw deleteAllocError;

  const { error: deleteLineError } = await client
    .from("order_lines")
    .delete()
    .eq("id", lineId)
    .eq("order_id", orderId);

  if (deleteLineError) throw deleteLineError;

  return allocations?.length || 0;
}

async function saveEditOrderModal() {
  const orderId = byId("genericActionOrderId")?.value || "";
  const order = getOrderById(orderId);
  if (!order) throw new Error("Order not found.");

  const rows = Array.from(document.querySelectorAll("#editProductLinesBody tr[data-edit-line-id]"));
const editBody = byId("editProductLinesBody");
const removedLineIds = JSON.parse(editBody?.dataset.removedLineIds || "[]");

  let totalVolume = 0;
  let totalWeight = 0;
  let totalPackages = 0;
  let changedProducts = 0;
  let removedProducts = 0;
  let addedProducts = 0;
  let releasedPackages = 0;

  await safeUpdateOrder(order.id, {
    retail_name: byId("editRetailerName")?.value || "",
    retailer_code: byId("editRetailerCode")?.value || "",
    delivery_address_1: byId("editAddress1")?.value || "",
    delivery_address_2: byId("editAddress2")?.value || "",
    delivery_address_3: byId("editAddress3")?.value || "",
    delivery_address_4: byId("editAddress4")?.value || "",
    delivery_city: byId("editCity")?.value || "",
    delivery_postcode: byId("editPostcode")?.value || "",
    delivery_country: byId("editCountry")?.value || "United Kingdom",
    memo: byId("editMemo")?.value || "",
    last_activity_at: new Date().toISOString()
  });

for (const removedLineId of removedLineIds) {
  releasedPackages += await neutralizeOrderLineFromDb(order.id, removedLineId);
  removedProducts++;
}

  for (const row of rows) {
const isNew = row.dataset.newLine === "1";
const lineId = row.getAttribute("data-edit-line-id");
const qtyInput = row.querySelector("[data-edit-line-qty]");
const qty = Math.max(0, Math.round(toNumber(qtyInput?.value, 0)));

const isRemoved =
  !isNew &&
  (
    row.dataset.removeLine === "1" ||
    editRemovedLineIds.has(String(lineId)) ||
    qty <= 0
  );

    const product = getSelectedProductFromEditRow(row);
    const description = row.querySelector("[data-edit-line-description]")?.value || product?.description || "";

if (!isNew && isRemoved) {
  releasedPackages += await releaseAllocationsForLine(lineId);

  const { error: allocationDeleteError } = await client
    .from("order_allocations")
    .delete()
    .eq("order_line_id", lineId);

  if (allocationDeleteError) throw allocationDeleteError;

  const { error: lineDeleteError } = await client
    .from("order_lines")
    .delete()
    .eq("id", lineId)
    .eq("order_id", order.id);

  if (lineDeleteError) throw lineDeleteError;

  removedProducts++;
  continue;
}
    if (!product || qty <= 0) continue;

    const lineVolume = round2(qty * product.volume);
    const lineWeight = round2(qty * product.weight);
    const packages = qty * product.packages;

    totalVolume += lineVolume;
    totalWeight += lineWeight;
    totalPackages += packages;

 const payload = {
  order_id: order.id,
  product_id: product.id,
  sku_base: product.sku,
  description,
  quantity_ordered: qty,
  unit_volume_m3: round2(product.volume),
  total_volume_m3: lineVolume,
  total_line_volume_m3: lineVolume,
  unit_weight_kg: round2(product.weight),
  total_line_weight_kg: lineWeight
};

    if (isNew) {
      const { error } = await client.from("order_lines").insert(payload);
      if (error) throw error;
      addedProducts++;
      continue;
    }

    const oldLine = (order.order_lines || []).find(l => String(l.id) === String(lineId));
    const oldQty = getLineRequiredQty(oldLine);
    const oldProductId = oldLine?.product_id || oldLine?.products?.id;
    const productChanged = String(oldProductId || "") !== String(product.id || "");

    if (productChanged) {
      releasedPackages += await releaseAllocationsForLine(lineId);
    } else if (qty < oldQty) {
  const packagesPerUnit = getProductPackageCount(oldLine?.products || {});
  releasedPackages += await releaseAllocationsForLine(lineId, (oldQty - qty) * packagesPerUnit);
}

    const { error } = await client
      .from("order_lines")
      .update(payload)
      .eq("id", lineId)
      .eq("order_id", order.id);

    if (error) throw error;

    if (productChanged || qty !== oldQty || description !== getLineDescription(oldLine)) {
      changedProducts++;
    }
  }

await safeUpdateOrder(order.id, {
  planning_volume_m3: round2(totalVolume),
  planning_colli: totalPackages,
  warehouse_status: "awaiting_goods",
  overall_status: "awaiting_goods",
  last_activity_at: new Date().toISOString()
});

  await insertOrderActivity(
    order.id,
    `Order edited in OCC. Added ${addedProducts}, changed ${changedProducts}, removed ${removedProducts}. Released ${releasedPackages} package(s). Volume ${formatNumber(totalVolume, 2)} m³, weight ${formatNumber(totalWeight, 2)} kg.`,
    "edit_order"
  );

  const matchResult = await runMatchingForEditedOrder(order.id);

  if (!matchResult.skipped) {
    await insertOrderActivity(
      order.id,
      `Matching executed after edit. ${formatNumber(matchResult.allocationsCreated, 0)} allocation(s) created, ${formatNumber(matchResult.itemsReserved, 0)} item(s) reserved.`,
      "edit_order_matching"
    );
  }

  closeGenericActionModal();
  await loadOrders();

  showToast("Order saved. Matching completed for missing products.", "ok");
}

async function openLegacyAckUpload(orderId) {
  const order = getOrderById(orderId);

  if (!order) {
    showToast("Order not found.", "err");
    return;
  }

  if (!isTenantRole()) {
    showToast("Only Sofa2U users can upload Legacy ACK files.", "err");
    return;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";

  input.addEventListener("change", async () => {
    const file = input.files?.[0];

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      showToast("Please choose a PDF file.", "err");
      return;
    }

    try {
      const cid = await getCompanyId();

      const path = [
        cid,
        order.customer_id || "no-owner",
        order.id,
        `Legacy_ACK_${safeFileName(order.order_number || order.id)}_${Date.now()}.pdf`
      ].join("/");

      const { error: uploadError } = await client
        .storage
        .from("order-documents")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: "application/pdf"
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = client
        .storage
        .from("order-documents")
        .getPublicUrl(path);

      const fileUrl = publicData?.publicUrl || "";

      const existing = getDoc(order, "legacy_acknowledgement");

      if (existing?.id) {
        const { error: updateError } = await client
          .from("order_documents")
          .update({
            document_status: "generated",
            file_url: fileUrl,
            storage_path: path,
            customer_visible: true,
            updated_at: new Date().toISOString()
          })
          .eq("id", existing.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await client
          .from("order_documents")
          .insert({
            company_id: cid,
            customer_id: order.customer_id || null,
            order_id: order.id,
            document_type: "legacy_acknowledgement",
            document_number: order.external_reference || order.order_number || "Legacy ACK",
            document_status: "generated",
            file_url: fileUrl,
            storage_path: path,
            customer_visible: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (insertError) throw insertError;
      }

      await insertOrderActivity(
        order.id,
        `Legacy ACK uploaded manually for ${order.order_number || "order"}.`,
        "legacy_ack_uploaded"
      );

      await loadOrders();
      showToast("Legacy ACK uploaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not upload Legacy ACK.", "err");
    }
  });

  input.click();
}

function detectCsvDelimiter(headerLine) {
  const text = String(headerLine || "");

  const commaCount = (text.match(/,/g) || []).length;
  const semicolonCount = (text.match(/;/g) || []).length;

  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvLine(line, delimiter = ",") {
  const values = [];
  let current = "";
  let insideQuotes = false;

  const text = String(line || "");

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index++;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}

function parseCsvText(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim() !== "");

  if (lines.length < 2) {
    throw new Error(
      "The selected CSV does not contain any order rows."
    );
  }

  const delimiter = detectCsvDelimiter(lines[0]);

  const headers = parseCsvLine(
    lines[0],
    delimiter
  ).map(header => cleanText(header));

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line, delimiter);

    const row = {
      __rowNumber: index + 2
    };

    headers.forEach((header, columnIndex) => {
      row[header] = values[columnIndex] ?? "";
    });

    return row;
  });
}

function getCsvValue(row, possibleHeaders) {
  const keys = Object.keys(row || {});

  for (const possibleHeader of possibleHeaders) {
    const matchingKey = keys.find(key =>
      normalize(key) === normalize(possibleHeader)
    );

    if (matchingKey) {
      return cleanText(row[matchingKey]);
    }
  }

  return "";
}

function extractVeynorOrderNumbers(value) {
  const matches = String(value || "")
    .toUpperCase()
    .match(/SO-\d+/g);

  return [...new Set(matches || [])];
}

function parseFdsEta(value) {
  const text = cleanText(value);

  if (!text) return null;

  const monthMap = {
    JAN: "01",
    FEB: "02",
    MAR: "03",
    APR: "04",
    MAY: "05",
    JUN: "06",
    JUL: "07",
    AUG: "08",
    SEP: "09",
    OCT: "10",
    NOV: "11",
    DEC: "12"
  };

  let match = text.match(
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/
  );

  if (match) {
    const [, day, monthText, year, hour, minute] = match;
    const month = monthMap[monthText.toUpperCase()];

    if (!month) return null;

    return {
      date: `${year}-${month}-${String(day).padStart(2, "0")}`,
      time:
        hour !== undefined && minute !== undefined
          ? `${String(hour).padStart(2, "0")}:${minute}`
          : ""
    };
  }

  match = text.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/
  );

  if (match) {
    const [, day, month, year, hour, minute] = match;

    return {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      time:
        hour !== undefined && minute !== undefined
          ? `${String(hour).padStart(2, "0")}:${minute}`
          : ""
    };
  }

  return null;
}

function parseFdsDateTime(value) {
  const text = cleanText(value);

  if (!text) return null;

  let match = text.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2})$/
  );

  if (match) {
    const [, day, month, year, hour, minute] = match;

    return {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      time: `${String(hour).padStart(2, "0")}:${minute}`
    };
  }

  return parseFdsEta(text);
}

function getOrderMapByNumber(orders) {
  const map = new Map();

  (orders || []).forEach(order => {
    const number = String(
      order.order_number || ""
    ).trim().toUpperCase();

    if (number) {
      map.set(number, order);
    }
  });

  return map;
}

function getExistingCollectionData(order) {
  const collectionDate =
    order.fds_collection_date ||
    order.expected_delivery_date ||
    order.planned_route_date ||
    null;

  const collectionWeek =
    Math.round(toNumber(order.fds_collection_week, 0)) ||
    getIsoWeekNumber(collectionDate) ||
    null;

  return {
    collectionDate,
    collectionWeek
  };
}

async function importFdsPlanningFile(file) {
  if (!file) {
    throw new Error("No FDS planning file selected.");
  }

  if (!isTenantRole()) {
    throw new Error(
      "Only Sofa2U users can import FDS planning."
    );
  }

  const text = await file.text();
  const rows = parseCsvText(text);
  const cid = await getCompanyId();

const preparedRows = rows.map(row => {
  const orderRef = getCsvValue(row, [
    "Order Ref",
    "Order Reference",
    "Order"
  ]);

  const status = normalize(
    getCsvValue(row, ["Status"])
  );

  const plannedStart = getCsvValue(row, [
    "Planned Start",
    "Planned start"
  ]);

  const plannedEnd = getCsvValue(row, [
    "Planned End",
    "Planned end"
  ]);

  const etaActual = getCsvValue(row, [
    "ETA/Actual",
    "ETA / Actual",
    "ETA Actual"
  ]);

  const etaLabel = getCsvValue(row, [
    "ETA",
    "ETA Label"
  ]);

  const jobRef = getCsvValue(row, [
    "Job Ref",
    "Job Reference",
    "Job"
  ]);

  return {
    rowNumber: row.__rowNumber,
    orderRef,
    orderNumbers: extractVeynorOrderNumbers(orderRef),
    status,
    plannedStart,
    plannedEnd,
    etaActual,
    etaLabel,
    jobRef
  };
});

  const allOrderNumbers = [
    ...new Set(
      preparedRows.flatMap(row => row.orderNumbers)
    )
  ];

  let existingOrders = [];

  if (allOrderNumbers.length) {
    const { data, error } = await client
      .from("orders")
      .select(`
        id,
        order_number,
        status,
        transport_type,
        transport_status,
        overall_status,
        warehouse_status,
        expected_delivery_date,
        confirmed_delivery_date,
        delivery_eta_from,
        delivery_eta_to,
        delivery_eta_status,
        fds_status,
        fds_job_ref,
        fds_eta_label,
        fds_last_import_at,
        fds_collection_date,
        fds_collection_week,
        planned_route_date
      `)
      .eq("company_id", cid)
      .in("order_number", allOrderNumbers);

    if (error) throw error;

    existingOrders = data || [];
  }

  const orderMap = getOrderMapByNumber(existingOrders);
  const importTimestamp = new Date().toISOString();

  const summary = {
    rowsRead: rows.length,
    allocatedRows: 0,
    unallocatedRows: 0,
    ordersUpdated: 0,
    ordersUnchanged: 0,
    unknownOrders: new Set(),
    invalidEtaRows: [],
    ignoredRows: 0,
    errors: []
  };

  for (const row of preparedRows) {
    if (!row.orderNumbers.length) {
      summary.ignoredRows++;
      continue;
    }

    if (
      row.status !== "allocated" &&
      row.status !== "unallocated"
    ) {
      summary.ignoredRows++;
      continue;
    }

    if (row.status === "allocated") {
      summary.allocatedRows++;
    } else {
      summary.unallocatedRows++;
    }

const plannedStart =
  row.status === "allocated"
    ? parseFdsDateTime(row.plannedStart)
    : null;

const plannedEnd =
  row.status === "allocated"
    ? parseFdsDateTime(row.plannedEnd)
    : null;
if (row.status === "allocated" && !plannedStart?.date) {
  summary.invalidEtaRows.push({
    row: row.rowNumber,
    orderRef: row.orderRef,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd
  });

  continue;
}

    for (const orderNumber of row.orderNumbers) {
      const order = orderMap.get(
        String(orderNumber).toUpperCase()
      );

      if (!order?.id) {
        summary.unknownOrders.add(orderNumber);
        continue;
      }

      try {
        const collection =
          getExistingCollectionData(order);

        if (row.status === "allocated") {
const deliveryDate = plannedStart.date;
const etaFrom = plannedStart.time || "";
const etaTo = plannedEnd?.time || "";
          const currentDate = String(
            order.expected_delivery_date || ""
          ).slice(0, 10);

          const currentEtaFrom = formatTime(
            order.delivery_eta_from || ""
          );

          const currentEtaTo = formatTime(
            order.delivery_eta_to || ""
          );

          const unchanged =
            normalize(order.fds_status) === "allocated" &&
            currentDate ===deliveryDate &&
            currentEtaFrom === etaFrom &&
            currentEtaTo === etaTo &&
            cleanText(order.fds_job_ref || "") === row.jobRef &&
            cleanText(order.fds_eta_label || "") === row.etaLabel;

          if (unchanged) {
            summary.ordersUnchanged++;
            continue;
          }

          const previousDate = currentDate;
          const previousEta = currentEtaFrom;

          await safeUpdateOrder(order.id, {
            fds_collection_date:
              collection.collectionDate,

            fds_collection_week:
              collection.collectionWeek,

            fds_status: "allocated",
            fds_job_ref: row.jobRef || null,
            fds_eta_label: row.etaLabel || null,
            fds_last_import_at: importTimestamp,

            expected_delivery_date: deliveryDate,

            delivery_eta_from:
              etaFrom || null,

            delivery_eta_to:
              etaTo || null,

            delivery_eta_status:
              etaFrom ? "confirmed" : "planned",

            transport_type: "charter",
            status: "export_for_charter",
            transport_status: "planned",
            overall_status: "planned",

            last_activity_at: importTimestamp
          });

          let description =
            `FDS planning imported from ${file.name}. ` +
            `Status: Allocated. ` +
            `Planned delivery: ${formatDate(deliveryDate)}`;

          if (etaFrom) {
            description +=
              `, ETA ${etaFrom}` +
              `${etaTo ? ` - ${etaTo}` : ""}`;
          }

          if (row.etaLabel) {
            description +=
              `. FDS ETA label: ${row.etaLabel}`;
          }

          if (
            previousDate &&
            previousDate !== deliveryDate
          ) {
            description +=
              `. Previous delivery date: ${formatDate(previousDate)}`;
          }

          if (
            previousEta &&
            previousEta !== etaFrom
          ) {
            description +=
              `. Previous ETA: ${previousEta}`;
          }

          description += ".";

          await insertOrderActivity(
            order.id,
            description,
            "fds_planning_allocated"
          );

          order.fds_status = "allocated";
          order.expected_delivery_date = deliveryDate;
          order.delivery_eta_from = etaFrom || null;
          order.delivery_eta_to = etaTo || null;
          order.fds_job_ref = row.jobRef || null;
          order.fds_eta_label = row.etaLabel || null;

          summary.ordersUpdated++;
          continue;
        }

        const wasAlreadyUnallocated =
          normalize(order.fds_status) === "unallocated" &&
          !order.delivery_eta_from &&
          !order.delivery_eta_to;

        if (wasAlreadyUnallocated) {
          summary.ordersUnchanged++;
          continue;
        }

await safeUpdateOrder(order.id, {
  fds_collection_date:
    collection.collectionDate,

  fds_collection_week:
    collection.collectionWeek,

  fds_status: "allocated",
  fds_job_ref: row.jobRef || null,
  fds_eta_label: row.etaLabel || null,
  fds_last_import_at: importTimestamp,

  expected_delivery_date: deliveryDate,
  delivery_eta_from: etaFrom || null,
  delivery_eta_to: etaTo || null,
  delivery_eta_status:
    etaFrom ? "confirmed" : "planned",

  transport_type: "charter",
  status: "export_for_charter",
  transport_status: "planned",
  overall_status: "planned",

  last_activity_at: importTimestamp
});

        await insertOrderActivity(
          order.id,
          `FDS planning imported from ${file.name}. Status: Unallocated. No delivery date is currently confirmed.`,
          "fds_planning_unallocated"
        );

        order.fds_status = "unallocated";
        order.expected_delivery_date = null;
        order.delivery_eta_from = null;
        order.delivery_eta_to = null;

        summary.ordersUpdated++;
      } catch (error) {
        console.error(
          "FDS planning import failed:",
          orderNumber,
          error
        );

        summary.errors.push(
          `${orderNumber}: ${
            error.message || "Unknown import error"
          }`
        );
      }
    }
  }

  await loadOrders();

  const unknownOrders = [
    ...summary.unknownOrders
  ];

  let message =
    `FDS planning import completed: ` +
    `${summary.ordersUpdated} updated, ` +
    `${summary.ordersUnchanged} unchanged, ` +
    `${summary.unallocatedRows} unallocated row(s) processed`;

  if (unknownOrders.length) {
    message +=
      `, ${unknownOrders.length} order(s) not found`;
  }

  if (summary.invalidEtaRows.length) {
    message +=
      `, ${summary.invalidEtaRows.length} invalid ETA row(s)`;
  }

  if (summary.errors.length) {
    message +=
      `, ${summary.errors.length} error(s)`;
  }

  showToast(
    message + ".",
    summary.errors.length ? "err" : "ok"
  );

  console.table({
    "CSV rows read": summary.rowsRead,
    "Allocated rows": summary.allocatedRows,
    "Unallocated rows": summary.unallocatedRows,
    "Orders updated": summary.ordersUpdated,
    "Orders unchanged": summary.ordersUnchanged,
    "Orders not found": unknownOrders.length,
    "Invalid ETA rows": summary.invalidEtaRows.length,
    "Ignored rows": summary.ignoredRows,
    "Errors": summary.errors.length
  });

  if (unknownOrders.length) {
    console.warn(
      "FDS order numbers not found in Veynor:",
      unknownOrders
    );
  }

  if (summary.invalidEtaRows.length) {
    console.warn(
      "FDS rows with an invalid ETA/Actual value:",
      summary.invalidEtaRows
    );
  }

  if (summary.errors.length) {
    console.error(
      "FDS planning import errors:",
      summary.errors
    );
  }

  return summary;
}

function openFdsPlanningImport() {
  byId("fdsPlanningFileInput")?.click();
}

function openFdsDeliveredImport() {
  byId("fdsDeliveredFileInput")?.click();
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

  document.addEventListener("click", event => {
    const menu = byId("occRowActionMenu");
    if (!menu) return;

    if (
      menu.contains(event.target) ||
      event.target.closest("[data-order-actions]")
    ) {
      return;
    }

    closeOrderActionMenu();
  });

  byId("occRowActionMenu")?.addEventListener("click", event => {
    const button = event.target.closest("[data-row-action]");
    if (!button) return;

    const action = button.getAttribute("data-row-action");
    const orderId = byId("occRowActionMenu")?.dataset.orderId || "";

    closeOrderActionMenu();

    if (action === "manual_pod") return openManualOpsModal(orderId);
    if (action === "finance_tariffs") return openTariffModal(orderId);

 if (action === "edit_order") {
  if (window.OrderEditor?.open) return window.OrderEditor.open(orderId);
  showToast("Order editor is not loaded.", "err");
  return;
}
    if (action === "copy_order") {
  if (window.CopyOrderTool?.open) return window.CopyOrderTool.open(orderId);
  showToast("Copy Order Tool is not loaded.", "err");
  return;
}
if (action === "credit_order") {
  if (window.CreditOrderTool?.open) return window.CreditOrderTool.open(orderId);
  showToast("Credit Order Tool is not loaded.", "err");
  return;
}
if (action === "change_status") {
  if (window.ChangeStatusTool?.open) return window.ChangeStatusTool.open(orderId);
  showToast("Change Status Tool is not loaded.", "err");
  return;
}
if (action === "view_activity") {
  if (window.ActivityViewTool?.open) return window.ActivityViewTool.open(orderId);
  showToast("Activity View Tool is not loaded.", "err");
  return;
}
if (action === "warehouse_events") {
  if (window.WarehouseEventsTool?.open) {
    return window.WarehouseEventsTool.open(orderId);
  }

  showToast("Warehouse Events Tool is not loaded.", "err");
  return;
}
if (action === "portal_events") {
  if (window.PortalEventsTool?.open) {
    return window.PortalEventsTool.open(orderId);
  }

  showToast("Portal Events Tool is not loaded.", "err");
  return;
}

    showToast(`${action} is not connected yet.`, "ok");
  });

  byId("btnActiveOrdersView")?.addEventListener("click", () => {
    orderViewMode = "active";
    showDeliveryGroups = false;

    if (byId("toggleDeliveryGroups")) {
      byId("toggleDeliveryGroups").checked = false;
    }

    byId("orderViewSwitch")?.classList.remove("history");
    byId("btnActiveOrdersView")?.classList.add("active");
    byId("btnHistoricalOrdersView")?.classList.remove("active");

    applyFilters();
    renderAll();
  });

  byId("btnHistoricalOrdersView")?.addEventListener("click", () => {
    orderViewMode = "historical";
    showDeliveryGroups = false;

    if (byId("toggleDeliveryGroups")) {
      byId("toggleDeliveryGroups").checked = false;
    }

    byId("orderViewSwitch")?.classList.add("history");
    byId("btnHistoricalOrdersView")?.classList.add("active");
    byId("btnActiveOrdersView")?.classList.remove("active");

    applyFilters();
    renderAll();
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

  byId("toggleDeliveryGroups")?.addEventListener("change", event => {
    showDeliveryGroups = !!event.target.checked;

    setText(
      "resultsMeta",
      showDeliveryGroups
        ? `${formatNumber(deliveryGroupsMap.size)} delivery groups shown`
        : `${formatNumber(filteredOrders.length)} orders shown`
    );

    renderAll();
  });

  byId("deliveryGroupCloseBtn")?.addEventListener("click", closeDeliveryGroupApprovalModal);
  byId("deliveryGroupCancelBtn")?.addEventListener("click", closeDeliveryGroupApprovalModal);

  byId("deliveryGroupModal")?.addEventListener("click", event => {
    if (event.target === byId("deliveryGroupModal")) {
      closeDeliveryGroupApprovalModal();
    }
  });

  byId("deliveryGroupHoldBtn")?.addEventListener("click", () => {
    closeDeliveryGroupApprovalModal();
    showToast("Delivery group kept on hold.", "ok");
  });

  byId("deliveryGroupApproveBtn")?.addEventListener("click", async () => {
    try {
      await approveDeliveryGroupFromModal();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not approve delivery group.", "err");
    }
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

  byId("btnOpenManualChargeModal")?.addEventListener("click", () => {
    if (window.ManualChargeTool?.open) {
      window.ManualChargeTool.open();
      return;
    }

    showToast("Manual Charge Tool is not loaded.", "err");
  });

  byId("btnResetFilters")?.addEventListener("click", resetFilters);

byId("btnManualCharge")?.addEventListener("click", () => {
  if (window.ManualChargeTool?.open) {
    window.ManualChargeTool.open();
    return;
  }

  showToast("Manual Charge Tool is not loaded.", "err");
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

byId("btnImportFdsPlanning")?.addEventListener("click", () => {
  openFdsPlanningImport();
});

byId("btnImportFdsDelivered")?.addEventListener("click", () => {
  openFdsDeliveredImport();
});

byId("fdsPlanningFileInput")?.addEventListener(
  "change",
  async event => {
    const input = event.target;
    const file = input.files?.[0] || null;

    if (!file) return;

    const button = byId("btnImportFdsPlanning");

    const originalButtonText =
      button?.textContent ||
      "Import FDS Planning";

    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Importing...";
      }

      showToast(
        `Importing ${file.name}...`,
        "ok"
      );

      await importFdsPlanningFile(file);
    } catch (error) {
      console.error(
        "FDS planning import failed:",
        error
      );

      showToast(
        error.message ||
          "Could not import FDS planning.",
        "err"
      );
    } finally {
      input.value = "";

      if (button) {
        button.disabled = false;
        button.textContent =
          originalButtonText;
      }
    }
  }
);

byId("fdsDeliveredFileInput")?.addEventListener("change", event => {
  const file = event.target.files?.[0];

  if (!file) return;

  console.log("FDS Delivered file selected:", file.name);
  showToast(`Selected: ${file.name}`, "ok");

  event.target.value = "";
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

  byId("genericActionCloseBtn")?.addEventListener("click", closeGenericActionModal);
  byId("genericActionCancelBtn")?.addEventListener("click", closeGenericActionModal);

  byId("occGenericActionModal")?.addEventListener("click", event => {
    if (event.target === byId("occGenericActionModal")) {
      closeGenericActionModal();
    }
  });

byId("genericActionSaveBtn")?.addEventListener("click", async () => {
  const saveBtn = byId("genericActionSaveBtn");
  const action = byId("genericActionType")?.value || "";

  if (saveBtn?.disabled) return;

  const oldText = saveBtn?.textContent || "Save Order";

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      saveBtn.style.opacity = "0.75";
      saveBtn.style.cursor = "wait";
    }

    showToast("Saving order, please wait...", "ok");

if (action === "edit_order") {
editRemovedLineIds = new Set();
  await saveEditOrderModal();
  return;
}
    if (action === "copy_order") {
  showToast("Copy order popup is ready. Save function is the next step.", "ok");
  return;
}

showToast(`${action} save function is not connected yet.`, "ok");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not save order.", "err");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = oldText;
      saveBtn.style.opacity = "";
      saveBtn.style.cursor = "";
    }
  }
});

}

async function init() {
  try {
    ensureClient();
    ensurePageStyles();

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

window.OCCReloadOrders = async function () {
  await loadOrders();
};
window.getOrderById = getOrderById;

  document.addEventListener("DOMContentLoaded", init);
})();