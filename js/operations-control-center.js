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
let closedDeliveryGroupOrderIds = new Set();
let showDeliveryGroups = false;
let orderViewMode = "active";
let editRemovedLineIds = new Set();
let ackDownloadedOrderIds = new Set();
let podDownloadedOrderIds = new Set();
/*
 * Compacte OCC-kolommen.
 *
 * Type en Product Owner zijn standaard compact.
 * Lifecycle is standaard volledig zichtbaar.
 */
let typeColumnExpanded =
  localStorage.getItem("occTypeColumnExpanded") === "1";

let productOwnerColumnExpanded =
  localStorage.getItem("occProductOwnerColumnExpanded") === "1";

let lifecycleCompactMode =
  localStorage.getItem("occLifecycleCompactMode") === "1";

  const selectedOrderIds = new Set();
  const expandedOrderIds = new Set();

const sortState = {
  key: "order",
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

function isBellstoneProductOwnerLogin() {
  if (!isProductOwnerRole()) {
    return false;
  }

  const customerCode =
    normalize(
      currentProfile?.customers?.customer_code ||
      currentProfile?.customer_code ||
      ""
    );

  const customerName =
    normalize(
      currentProfile?.customers?.name ||
      ""
    );

  return (
    customerCode === "bellstone" ||
    customerCode.startsWith("bell") ||
    customerName.includes("bellstone")
  );
}


function shouldShowOccFinanceColumns() {
  /*
   * Gebruikers zonder financiële toegang zien
   * de Finance-kolommen nooit.
   */
  if (!canSeeFinance()) {
    return false;
  }

  /*
   * Interne Sofa2U/Veynor-gebruikers houden
   * Finance altijd zichtbaar.
   */
  if (isTenantRole()) {
    return true;
  }

  /*
   * Voor Bellstone:
   *
   * Active Orders     = Finance verborgen
   * Historical Orders = Finance zichtbaar
   */
  if (isBellstoneProductOwnerLogin()) {
    return orderViewMode === "historical";
  }

  /*
   * Andere Product Owners behouden voorlopig
   * de huidige situatie.
   */
  return true;
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

function isPodDownloaded(order) {
  return podDownloadedOrderIds.has(String(order.id));
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

async function loadPodDownloadStatus() {
  const cid = await getCompanyId();

  const { data, error } = await client
    .from("portal_events")
    .select(`
      user_profile_id,
      event_type,
      metadata,
      created_at
    `)
    .eq("company_id", cid)
    .eq("event_type", "pod_downloaded");

  if (error) {
    console.warn(
      "POD download status skipped:",
      error.message
    );

    podDownloadedOrderIds = new Set();
    return;
  }

  podDownloadedOrderIds = new Set(
    (data || [])
      .filter(row => {
        const documentType = normalize(
          row.metadata?.document_type ||
          row.metadata?.doc_type ||
          ""
        );

        const action = normalize(
          row.metadata?.action ||
          ""
        );

        return (
          documentType === "pod" &&
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

function getLineStockPriority(line) {
  const value =
    line?.order_line_stock_priorities;

  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];

  return rows.find(row =>
    ["active", "fulfilled"].includes(
      normalize(row.priority_status)
    )
  ) || null;
}

function getLineStockPriorityLevel(line) {
  return Math.round(
    toNumber(getLineStockPriority(line)?.priority_level, 0)
  );
}

function getLineStockPriorityLabel(line) {
  const level = getLineStockPriorityLevel(line);

  if (level === 200) return "Critical";
  if (level === 100) return "Priority";

  return "Normal";
}

function getLineStockPriorityClass(line) {
  const level = getLineStockPriorityLevel(line);

  if (level === 200) return "critical";
  if (level === 100) return "priority";

  return "normal";
}

function orderHasStockPriority(order) {
  return (order?.order_lines || []).some(line =>
    getLineStockPriorityLevel(line) > 0
  );
}

function getOrderHighestStockPriority(order) {
  return (order?.order_lines || []).reduce(
    (highest, line) =>
      Math.max(highest, getLineStockPriorityLevel(line)),
    0
  );
}

function renderOrderPriorityBadge(order) {
  const level = getOrderHighestStockPriority(order);

  if (level === 200) {
    return `
      <span
        class="stock-priority-badge critical"
        title="One or more product lines have Critical stock priority"
      >
        Critical
      </span>
    `;
  }

  if (level === 100) {
    return `
      <span
        class="stock-priority-badge priority"
        title="One or more product lines have stock priority"
      >
        PRIO
      </span>
    `;
  }

  return "";
}

function getLineRevenue(line) {
  const isManual =
    normalize(line?.line_type) === "manual";

  if (isManual) {
    const storedAmount =
      toNumber(
        line.manual_amount_gbp,
        0
      );

    if (storedAmount !== 0) {
      return round2(storedAmount);
    }

    const quantity =
      toNumber(
        line.manual_quantity,
        0
      );

    const rate =
      toNumber(
        line.manual_rate_gbp,
        0
      );

    return round2(
      quantity * rate
    );
  }

  const direct =
    toNumber(
      line.total_customer_charge,
      0
    );

  if (direct !== 0) {
    return round2(direct);
  }

  const qty =
    getLineRequiredQty(line) || 1;

  const tariffTotal =
    toNumber(line.tariff_storage, 0) +
    toNumber(line.tariff_admin, 0) +
    toNumber(line.tariff_handling, 0) +
    toNumber(line.tariff_transport, 0);

  return round2(
    tariffTotal * qty
  );
}

function getOrderBaseRevenue(order) {
  /*
   * Een gratis serviceorder moet altijd
   * £0.00 tonen, ook wanneer oude orderregels
   * nog bedragen bevatten.
   */
  if (order.is_chargeable === false) {
    return 0;
  }

  const direct =
    toNumber(
      order.total_customer_charge,
      0
    );

  if (direct !== 0) {
    return round2(direct);
  }

  return round2(
    (order.order_lines || []).reduce(
      (sum, line) => {
        return (
          sum +
          getLineRevenue(line)
        );
      },
      0
    )
  );
}

function getOrderTransportRevenue(order) {
  if (order.is_chargeable === false) {
    return 0;
  }

  const direct =
    toNumber(
      order.total_transport_tariff,
      0
    );

  if (direct !== 0) {
    return round2(direct);
  }

  return round2(
    (order.order_lines || []).reduce(
      (sum, line) => {
        const qty =
          getLineRequiredQty(line) ||
          1;

        return (
          sum +
          (
            toNumber(
              line.tariff_transport,
              0
            ) * qty
          )
        );
      },
      0
    )
  );
}

function getRegionalSurchargeRate(order) {
  const region =
    normalize(
      order.delivery_region ||
      ""
    );

  /*
   * Bellstone-regels:
   *
   * Edinburgh / Glasgow:
   * 20% over de transportkosten.
   *
   * Highlands & Islands:
   * 40% over de transportkosten.
   */
  if (
    region.includes("highland") ||
    region.includes("island")
  ) {
    return 0.40;
  }

  if (
    region.includes("edinburgh") ||
    region.includes("glasgow")
  ) {
    return 0.20;
  }

  return 0;
}

function getOrderRegionalSurcharge(order) {
  if (order.is_chargeable === false) {
    return 0;
  }

  const transportRevenue =
    getOrderTransportRevenue(order);

  const regionalRate =
    getRegionalSurchargeRate(order);

  return round2(
    transportRevenue *
    regionalRate
  );
}

function getOrderRevenue(order) {
  const baseRevenue =
    getOrderBaseRevenue(order);

  const regionalSurcharge =
    getOrderRegionalSurcharge(order);

  return round2(
    baseRevenue +
    regionalSurcharge
  );
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
  /*
   * ALBCH wordt verkocht per stoel,
   * maar één fysieke doos bevat 2 stoelen.
   */
  if (
    getLineSku(line).toUpperCase() === "ALBCH"
  ) {
    return Math.ceil(
      getLineRequiredQty(line) / 2
    );
  }

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
  /*
   * Oude/hard toegewezen orderregels hebben geen
   * fysieke order_allocations. Daarom berekenen we
   * de toegewezen packages uit de toegewezen
   * producthoeveelheid × packages per product.
   */
  if (normalize(line.line_type) === "hard_stock") {
    const allocatedProducts = Math.max(
      0,
      Math.round(
        toNumber(
          line.matched_quantity ||
          line.quantity_allocated,
          0
        )
      )
    );

    const orderedProducts = Math.max(
      0,
      Math.round(
        toNumber(
          line.quantity_ordered,
          0
        )
      )
    );

    const explicitTotalPackages = Math.max(
      0,
      Math.round(
        toNumber(
          line.total_packages,
          0
        )
      )
    );

    let packagesPerProduct = Math.max(
      1,
      Math.round(
        toNumber(
          line.packages_per_unit,
          1
        )
      )
    );

    if (
      explicitTotalPackages > 0 &&
      orderedProducts > 0
    ) {
      packagesPerProduct = Math.max(
        1,
        Math.round(
          explicitTotalPackages /
          orderedProducts
        )
      );
    }

    return (
      allocatedProducts *
      packagesPerProduct
    );
  }

  const allocs = Array.isArray(
    line.order_allocations
  )
    ? line.order_allocations
    : [];

  const active = allocs.filter(allocation =>
    !["cancelled"].includes(
      normalize(
        allocation.allocation_status
      )
    )
  );

  let allocatedPackages = 0;

  if (
    toNumber(
      line.requested_package_no,
      0
    ) > 0 &&
    toNumber(
      line.requested_package_total,
      0
    ) > 0
  ) {
    allocatedPackages = active.length;
  } else {
    allocatedPackages = active.reduce(
      (sum, allocation) => {
        return sum + Math.max(
          1,
          Math.round(
            toNumber(
              allocation.items?.package_total,
              1
            )
          )
        );
      },
      0
    );
  }

  /*
   * Echte allocations blijven altijd leidend.
   */
  if (allocatedPackages > 0) {
    return allocatedPackages;
  }

  /*
   * Fallback voor handmatig compleet gemaakte
   * orderregels zonder fysiek voorraaditem.
   *
   * Voor SO-03542:
   * matched_quantity = 1
   * quantity_allocated = 1
   * dus de OCC toont 1/1.
   */
  const matchedProducts = Math.max(
    0,
    Math.round(
      toNumber(
        line.matched_quantity ||
        line.quantity_allocated,
        0
      )
    )
  );

  if (matchedProducts <= 0) {
    return 0;
  }

  const requiredProducts = Math.max(
    1,
    Math.round(
      toNumber(
        line.quantity_ordered,
        1
      )
    )
  );

  const requiredPackages =
    getLineRequiredPackages(line);

  const packagesPerProduct = Math.max(
    1,
    Math.round(
      requiredPackages /
      requiredProducts
    )
  );

  return (
    matchedProducts *
    packagesPerProduct
  );
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
    isWarehousePickupOrder(order) &&
    normalize(order.status) !== "picked_up"
  ) {
    return "planned";
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

function getStoredGroupsForBaseKey(baseKey) {
  const prefix = `${baseKey}|C`;

  return (
    window.__storedDeliveryGroups ||
    []
  ).filter(group => {
    const storedKey =
      String(group.group_key || "");

    return (
      storedKey === baseKey ||
      storedKey.startsWith(prefix)
    );
  });
}

function getNextDeliveryGroupCycle(baseKey) {
  const storedGroups =
    getStoredGroupsForBaseKey(baseKey);

  const highestCycle =
    storedGroups.reduce(
      (highest, group) => {
        return Math.max(
          highest,
          Math.max(
            1,
            Math.round(
              toNumber(
                group.cycle_number,
                1
              )
            )
          )
        );
      },
      0
    );

  return highestCycle + 1;
}

function makeStoredDeliveryGroupKey(
  baseKey,
  cycleNumber
) {
  return `${baseKey}|C${cycleNumber}`;
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

    if (isCollectionOrder(order)) {
      return;
    }
    if (
      closedDeliveryGroupOrderIds.has(
        String(order.id)
      )
    ) {
      return;
    }
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

  if (isCollectionOrder(order)) {
    return null;
  }

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
  return getStoredDeliveryGroup(group);
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

  const { data: groups, error: groupsError } = await client
    .from("delivery_groups")
    .select("*")
    .eq("company_id", cid)
    .order("cycle_number", {
      ascending: false
    });

  if (groupsError) {
    throw groupsError;
  }

  window.__storedDeliveryGroups =
    groups || [];

  /*
   * Orders die al in een goedgekeurde of
   * gesloten delivery group staan, mogen niet
   * opnieuw in een nieuwe delivery group
   * terechtkomen.
   */
  const closedGroupIds = (groups || [])
    .filter(group =>
      normalize(group.status) === "approved" ||
      group.is_open === false
    )
    .map(group => group.id)
    .filter(Boolean);

  closedDeliveryGroupOrderIds =
    new Set();

  if (!closedGroupIds.length) {
    return;
  }

  const {
    data: linkedOrders,
    error: linkedOrdersError
  } = await client
    .from("delivery_group_orders")
.select(`
  order_id,
  delivery_group_id,
  order_number,
  order_status,
  volume_m3,
  group_role
`)    .in(
      "delivery_group_id",
      closedGroupIds
    );

  if (linkedOrdersError) {
    throw linkedOrdersError;
  }

window.__storedDeliveryGroupOrders =
  linkedOrders || [];

closedDeliveryGroupOrderIds =
  new Set(
    (linkedOrders || [])
      /*
       * Alleen de orders die daadwerkelijk
       * zijn goedgekeurd voor levering worden
       * uit volgende delivery groups gehaald.
       *
       * Waiting orders blijven beschikbaar
       * voor de volgende cyclus.
       */
      .filter(row =>
        normalize(row.group_role) === "ready"
      )
      .map(row => row.order_id)
      .filter(Boolean)
      .map(String)
  );
}
async function loadOrders() {
  const cid = await getCompanyId();

await loadOwnerProfilesForMinimumRules();
await loadStoredDeliveryGroups();
await loadAckDownloadStatus();
await loadPodDownloadStatus();

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
  order_line_stock_priorities (
    id,
    priority_level,
    priority_status,
    reason,
    created_at,
    updated_at,
    fulfilled_at
  ),
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
manual_quantity,
manual_unit,
manual_rate_gbp,
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

function isServiceOrder(order) {
  const orderNumber =
    String(
      order?.order_number || ""
    )
      .trim()
      .toUpperCase();

  return /^SO-\d+S(?:\d+)?$/.test(
    orderNumber
  );
}

function sortOrders() {
  const direction =
    sortState.direction === "desc"
      ? -1
      : 1;

  filteredOrders.sort(
    (a, b) => {

      /*
       * Wanneer op ORDER wordt gesorteerd:
       *
       * Serviceorders staan altijd bovenaan.
       * Binnen beide groepen blijft de gekozen
       * ASC/DESC sorteervolgorde gewoon werken.
       */
      if (sortState.key === "order") {
        const aService =
          isServiceOrder(a);

        const bService =
          isServiceOrder(b);

        if (
          aService !== bService
        ) {
          return aService ? -1 : 1;
        }
      }


      const av =
        sortValue(
          a,
          sortState.key
        );

      const bv =
        sortValue(
          b,
          sortState.key
        );


      if (
        typeof av === "number" &&
        typeof bv === "number"
      ) {
        return (
          (av - bv) *
          direction
        );
      }


      return String(av)
        .localeCompare(
          String(bv),
          "en",
          {
            numeric: true,
            sensitivity: "base"
          }
        ) *
        direction;
    }
  );
}

function updateSortIndicators() {
  document
    .querySelectorAll(
      "[data-sort-indicator]"
    )
    .forEach(el => {
      const key =
        el.getAttribute(
          "data-sort-indicator"
        );

      el.textContent =
        key === sortState.key
          ? (
              sortState.direction === "asc"
                ? "▲"
                : "▼"
            )
          : "";
    });
}	

function getKpiBaseOrders() {
  /*
   * De KPI-aantallen blijven gebaseerd op het actieve
   * tabblad, maar worden niet beïnvloed door een
   * aangeklikte KPI of door de gewone filters.
   */
  return allOrders.filter(order => {
    if (orderViewMode === "active") {
      return isActiveOrder(order);
    }

    if (orderViewMode === "historical") {
      return isHistoricalOrder(order);
    }

    return true;
  });
}


function clearOccFilterFields() {
  [
    "filterSearch",
    "filterLifecycle",
    "filterProducts",
    "filterDocument",
    "filterFinance",
    "filterDateStatus"
  ].forEach(id => {
    const element = byId(id);

    if (element) {
      element.value = "";
    }
  });
}


function setOrderViewForKpi(mode) {
  orderViewMode = mode;

  const historical =
    mode === "historical";

  byId("orderViewSwitch")
    ?.classList.toggle(
      "history",
      historical
    );

  byId("btnHistoricalOrdersView")
    ?.classList.toggle(
      "active",
      historical
    );

  byId("btnActiveOrdersView")
    ?.classList.toggle(
      "active",
      !historical
    );
}


function orderMatchesQuickKpi(
  order,
  filterName
) {
  const filter =
    normalize(filterName);

  /*
   * Total Orders toont alle orders binnen het
   * gekozen actieve/historische tabblad.
   */
  if (
    !filter ||
    filter === "total"
  ) {
    return true;
  }

  /*
   * Lifecycle-KPI's gebruiken exact dezelfde
   * vier stappen als de bestaande OCC-weergave.
   */
  if (filter === "awaiting_goods") {
    return (
      compactLifecycleStep(order) === 1
    );
  }

  if (filter === "stock_complete") {
    return (
      compactLifecycleStep(order) === 2
    );
  }

  if (filter === "planned_transport") {
    return (
      compactLifecycleStep(order) === 3
    );
  }

  if (filter === "delivered") {
    return (
      compactLifecycleStep(order) === 4
    );
  }

  /*
   * Dit gebruikt dezelfde definitie als het
   * bestaande Invoice Pending KPI-blok.
   */
  if (filter === "invoice_pending") {
    return (
      order.derived_finance_status ===
        "not_invoiced" &&
      [
        "delivered",
        "on_transport",
        "stock_complete",
        "planned"
      ].includes(
        normalize(
          order.derived_lifecycle_status
        )
      )
    );
  }

  /*
   * Toon orders die onderdeel zijn van een
   * delivery group met een tekort.
   */
  if (filter === "minimum_volume") {
    const group =
      getDeliveryGroup(order);

    return (
      group &&
      toNumber(group.shortfall, 0) > 0
    );
  }

  return true;
}


function updateKpiCardStyles() {
  const activeFilter =
    normalize(
      window.__occKpiFilter || ""
    );

  const cards = [
    {
      valueId: "kpiTotal",
      filter: "total"
    },
    {
      valueId: "kpiAwaitingGoods",
      filter: "awaiting_goods"
    },
    {
      valueId: "kpiStockComplete",
      filter: "stock_complete"
    },
    {
      valueId: "kpiExpectedDelivery",
      filter: "planned_transport"
    },
    {
      valueId: "kpiDelivered",
      filter: "delivered"
    },
    {
      valueId: "kpiInvoicePending",
      filter: "invoice_pending"
    },
    {
      valueId: "kpiMinimumVolumeGroups",
      filter: "minimum_volume"
    }
  ];

  cards.forEach(config => {
    const valueElement =
      byId(config.valueId);

    const card =
      valueElement?.closest(".occ-kpi");

    if (!card) {
      return;
    }

    const isActive =
      activeFilter === config.filter;

    /*
     * Maak de bestaande HTML-kaart klikbaar.
     * Hiervoor hoef je dus geen data-attributen
     * in de HTML te zetten.
     */
    card.style.cursor = "pointer";
    card.style.transition =
      "transform .15s ease, box-shadow .15s ease, border-color .15s ease";

    card.style.borderColor =
      isActive
        ? "#1267ff"
        : "";

    card.style.boxShadow =
      isActive
        ? "0 0 0 3px rgba(18,103,255,.14)"
        : "";

    card.setAttribute(
      "role",
      "button"
    );

    card.setAttribute(
      "tabindex",
      "0"
    );

    card.setAttribute(
      "aria-pressed",
      isActive ? "true" : "false"
    );

    /*
     * onclick wordt bewust gebruikt in plaats
     * van addEventListener, zodat opnieuw renderen
     * geen dubbele click-events maakt.
     */
    card.onclick = () => {
      applyKpiQuickFilter(
        config.filter
      );
    };

    card.onkeydown = event => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();

        applyKpiQuickFilter(
          config.filter
        );
      }
    };

    card.onmouseenter = () => {
      if (
        normalize(
          window.__occKpiFilter || ""
        ) !== config.filter
      ) {
        card.style.transform =
          "translateY(-2px)";

        card.style.boxShadow =
          "0 10px 24px rgba(15,23,42,.10)";
      }
    };

    card.onmouseleave = () => {
      const currentlyActive =
        normalize(
          window.__occKpiFilter || ""
        ) === config.filter;

      card.style.transform = "";

      card.style.boxShadow =
        currentlyActive
          ? "0 0 0 3px rgba(18,103,255,.14)"
          : "";
    };
  });
}


function applyKpiQuickFilter(
  filterName
) {
  const filter =
    normalize(filterName);

  /*
   * Sluit de aparte delivery-groupsweergave.
   */
  showDeliveryGroups = false;

  const deliveryGroupsToggle =
    byId("toggleDeliveryGroups");

  if (deliveryGroupsToggle) {
    deliveryGroupsToggle.checked = false;
  }

  /*
   * Voorkom dat een bestaand zoekveld of dropdown
   * de resultaten van de KPI-click beperkt.
   */
  clearOccFilterFields();

  /*
   * Delivered staat bij Historical Orders.
   * De overige KPI's openen Active Orders.
   */
  if (filter === "delivered") {
    setOrderViewForKpi(
      "historical"
    );
  } else {
    setOrderViewForKpi(
      "active"
    );
  }

  /*
   * Klikken op Total Orders verwijdert het
   * actieve KPI-filter.
   */
  window.__occKpiFilter =
    filter === "total"
      ? ""
      : filter;

  applyFilters();
  renderAll();

  /*
   * Scroll naar de resultaten.
   */
  byId("ordersTableWrap")
    ?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
}


function applyFilters() {
  const q =
    normalize(
      byId("filterSearch")?.value || ""
    );

  const lifecycle =
    normalize(
      byId("filterLifecycle")?.value || ""
    );

  const productsFilter =
    normalize(
      byId("filterProducts")?.value || ""
    );

  const documentFilter =
    normalize(
      byId("filterDocument")?.value || ""
    );

  const finance =
    canSeeFinance()
      ? normalize(
          byId("filterFinance")?.value || ""
        )
      : "";

  const dateStatus =
    normalize(
      byId("filterDateStatus")?.value || ""
    );

  const quickKpiFilter =
    normalize(
      window.__occKpiFilter || ""
    );

  filteredOrders =
    allOrders.filter(order => {
      /*
       * Active / Historical.
       */
      if (
        orderViewMode === "active" &&
        !isActiveOrder(order)
      ) {
        return false;
      }

      if (
        orderViewMode === "historical" &&
        !isHistoricalOrder(order)
      ) {
        return false;
      }

      /*
       * Aangeklikte KPI.
       */
      if (
        quickKpiFilter &&
        !orderMatchesQuickKpi(
          order,
          quickKpiFilter
        )
      ) {
        return false;
      }

      /*
       * Normale lifecycle-filter.
       */
      if (lifecycle) {
        const compact =
          compactLifecycleStep(order);

        const lifecycleMatches =
          order.derived_lifecycle_status ===
            lifecycle ||

          (
            lifecycle ===
              "order_received" &&
            compact === 1
          ) ||

          (
            lifecycle ===
              "stock_complete" &&
            compact === 2
          ) ||

          (
            lifecycle ===
              "planned" &&
            compact === 3
          ) ||

          (
            lifecycle ===
              "on_transport" &&
            compact === 3
          ) ||

          (
            lifecycle ===
              "delivered" &&
            compact === 4
          );

        if (!lifecycleMatches) {
          return false;
        }
      }

      /*
       * Finance.
       */
      if (
        finance &&
        order.derived_finance_status !==
          finance
      ) {
        return false;
      }

      /*
       * Product completeness.
       */
      if (
        productsFilter &&
        order.product_completeness?.status !==
          productsFilter
      ) {
        return false;
      }

      /*
       * Delivery visibility.
       */
      if (
        dateStatus ===
          "confirmed_missing" &&
        getExpectedDeliveryDate(order)
      ) {
        return false;
      }

      if (
        dateStatus ===
          "confirmed_set" &&
        !getExpectedDeliveryDate(order)
      ) {
        return false;
      }

      if (
        dateStatus ===
          "eta_confirmed" &&
        getEtaStatus(order) !==
          "confirmed"
      ) {
        return false;
      }

      if (
        dateStatus ===
          "eta_pending" &&
        getEtaStatus(order) ===
          "confirmed"
      ) {
        return false;
      }

      if (
        dateStatus ===
          "overdue_delivery" &&
        !isDeliveryOverdue(order)
      ) {
        return false;
      }

      /*
       * Documentfilter.
       */
      if (documentFilter) {
        const ack =
          docStatus(
            order,
            "acknowledgement"
          );

        const packing =
          docStatus(
            order,
            "supplier_packing_slip"
          );

        const deliveryNote =
          docStatus(
            order,
            "delivery_note"
          );

        const pod =
          !!getPodDocumentUrl(order) ||
          normalize(order.pod_status) ===
            "signed";

        const invoice =
          docStatus(
            order,
            "invoice"
          );

        if (
          documentFilter ===
            "missing_ack" &&
          ack !== "not_generated"
        ) {
          return false;
        }

        if (
          documentFilter ===
            "ack_sent" &&
          ack !== "sent"
        ) {
          return false;
        }

        if (
          documentFilter ===
            "missing_packing_slip" &&
          packing !== "not_generated"
        ) {
          return false;
        }

        if (
          documentFilter ===
            "packing_slip_generated" &&
          packing !== "generated"
        ) {
          return false;
        }

        if (
          documentFilter ===
            "missing_delivery_note" &&
          deliveryNote !== "not_generated"
        ) {
          return false;
        }

        if (
          documentFilter ===
            "delivery_note_generated" &&
          deliveryNote !== "generated"
        ) {
          return false;
        }

        if (
          documentFilter ===
            "missing_pod" &&
          pod
        ) {
          return false;
        }

        if (
          documentFilter ===
            "pod_generated" &&
          !pod
        ) {
          return false;
        }

        if (
          documentFilter ===
            "invoice_missing" &&
          invoice !== "not_generated"
        ) {
          return false;
        }

        if (
          documentFilter ===
            "invoice_sent" &&
          invoice !== "sent"
        ) {
          return false;
        }
      }

      /*
       * Zoekveld.
       */
      if (q) {
        const lineText =
          (
            order.order_lines ||
            []
          )
            .map(line => [
              line.sku_base,
              line.products?.sku_base,
              line.description,
              line.products?.name,
              line.products?.description
            ].join(" "))
            .join(" ");

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
        ]
          .join(" ")
          .toLowerCase();

        if (
          !haystack.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });

  sortOrders();
  cleanSelectionAfterFilter();
}


function cleanSelectionAfterFilter() {
  const existingIds =
    new Set(
      allOrders.map(order =>
        String(order.id)
      )
    );

  selectedOrderIds.forEach(id => {
    if (
      !existingIds.has(
        String(id)
      )
    ) {
      selectedOrderIds.delete(id);
    }
  });
}


function getSelectedOrders() {
  return allOrders.filter(order =>
    selectedOrderIds.has(
      String(order.id)
    )
  );
}


function getVisibleIds() {
  return filteredOrders.map(order =>
    String(order.id)
  );
}


function updateSelectionUi() {
  const selectedCount =
    selectedOrderIds.size;

  const visibleIds =
    getVisibleIds();

  const visibleSelectedCount =
    visibleIds.filter(id =>
      selectedOrderIds.has(id)
    ).length;

  setText(
    "selectedOrdersMeta",
    `${formatNumber(selectedCount)} selected`
  );

  const btnInvoice =
    byId("btnGenerateCombinedInvoice");

  if (btnInvoice) {
    btnInvoice.disabled =
      selectedCount === 0 ||
      !canSelectOrders();
  }

  const selectAll =
    byId("selectAllVisibleOrders");

  if (selectAll) {
    selectAll.checked =
      visibleIds.length > 0 &&
      visibleSelectedCount ===
        visibleIds.length;

    selectAll.indeterminate =
      visibleSelectedCount > 0 &&
      visibleSelectedCount <
        visibleIds.length;
  }

  document
    .querySelectorAll(
      ".order-select-checkbox"
    )
    .forEach(input => {
      const id =
        String(
          input.dataset.orderId || ""
        );

      input.checked =
        selectedOrderIds.has(id);
    });
}


function renderKpis() {
  /*
   * De aantallen worden gebaseerd op alle orders
   * in het huidige Active/Historical-tabblad.
   *
   * Daardoor verandert Total Orders bijvoorbeeld
   * niet van 21 naar 2 wanneer Awaiting Goods
   * wordt aangeklikt.
   */
  const kpiOrders =
    getKpiBaseOrders();

  setText(
    "kpiTotal",
    formatNumber(
      kpiOrders.length
    )
  );

  setText(
    "kpiAwaitingGoods",
    formatNumber(
      kpiOrders.filter(order =>
        compactLifecycleStep(order) === 1
      ).length
    )
  );

  setText(
    "kpiStockComplete",
    formatNumber(
      kpiOrders.filter(order =>
        compactLifecycleStep(order) === 2
      ).length
    )
  );

  setText(
    "kpiExpectedDelivery",
    formatNumber(
      kpiOrders.filter(order =>
        compactLifecycleStep(order) === 3
      ).length
    )
  );

  setText(
    "kpiDelivered",
    formatNumber(
      kpiOrders.filter(order =>
        compactLifecycleStep(order) === 4
      ).length
    )
  );

  setText(
    "kpiProductsMissing",
    formatNumber(
      kpiOrders.filter(order =>
        order.product_completeness?.status ===
          "missing"
      ).length
    )
  );

  setText(
    "kpiEtaConfirmed",
    formatNumber(
      kpiOrders.filter(order =>
        getEtaStatus(order) ===
          "confirmed"
      ).length
    )
  );

  setText(
    "kpiInvoicePending",
    formatNumber(
      kpiOrders.filter(order =>
        order.derived_finance_status ===
          "not_invoiced" &&
        [
          "delivered",
          "on_transport",
          "stock_complete",
          "planned"
        ].includes(
          normalize(
            order.derived_lifecycle_status
          )
        )
      ).length
    )
  );

  /*
   * Minimum Volume KPI.
   */
  const visibleGroups =
    new Map();

  kpiOrders.forEach(order => {
    const group =
      getDeliveryGroup(order);

    if (group) {
      visibleGroups.set(
        group.key,
        group
      );
    }
  });

  const belowMinimumGroups =
    [...visibleGroups.values()]
      .filter(group =>
        toNumber(
          group.shortfall,
          0
        ) > 0
      );

  const potentialSurcharge =
    belowMinimumGroups.reduce(
      (sum, group) =>
        sum +
        toNumber(
          group.surcharge,
          0
        ),
      0
    );

  setText(
    "kpiMinimumVolumeGroups",
    formatNumber(
      belowMinimumGroups.length
    )
  );

  setText(
    "kpiMinimumVolumeValue",
    belowMinimumGroups.length
      ? (
          `${formatMoney(
            potentialSurcharge
          )} potential surcharge`
        )
      : "No retailers below minimum"
  );

  setText(
    "resultsMeta",
    `${formatNumber(
      filteredOrders.length
    )} orders shown`
  );

  /*
   * Voeg de click-events en actieve styling
   * aan de bestaande HTML-kaarten toe.
   */
  updateKpiCardStyles();
}

function getLifecycleStepClass(order, step) {
  const lifecycle =
    normalize(
      order.derived_lifecycle_status || ""
    );

  if (lifecycle === "cancelled") {
    return "wait";
  }

  if (lifecycle === "issue") {
    return "wait";
  }

  if (step === 1) {
    return "done";
  }

  if (step === 2) {
    return "stock";
  }

  if (step === 3) {
    return "transport";
  }

  if (step === 4) {
    return "delivery";
  }

  return "";
}


function findOccTableHeader(labelText) {
  const tableWrap =
    byId("ordersTableWrap");

  if (!tableWrap) {
    return null;
  }

  const wanted =
    normalize(labelText);

  return (
    [...tableWrap.querySelectorAll("thead th")]
      .find(header => {
        const headerText =
          normalize(
            header.textContent || ""
          );

        return headerText.includes(wanted);
      }) ||
    null
  );
}


function createOccColumnToggle({
  header,
  key,
  expanded,
  expandedTitle,
  compactTitle,
  onToggle
}) {
  if (!header) {
    return;
  }

  header.classList.add(
    "occ-toggle-header"
  );

  let button =
    header.querySelector(
      `[data-occ-column-toggle="${key}"]`
    );

  if (!button) {
    button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "occ-column-toggle";

    button.setAttribute(
      "data-occ-column-toggle",
      key
    );

    header.appendChild(button);

    button.addEventListener(
      "click",
      event => {
        /*
         * Voorkomt dat de klik ook de
         * sorteervolgorde van de tabel verandert.
         */
        event.preventDefault();
        event.stopPropagation();

        onToggle();
      }
    );
  }

  /*
   * Plus betekent: meer informatie tonen.
   * Min betekent: kolom compacter maken.
   */
  button.textContent =
    expanded ? "−" : "+";

  button.title =
    expanded
      ? compactTitle
      : expandedTitle;

  button.setAttribute(
    "aria-label",
    button.title
  );

  button.setAttribute(
    "aria-expanded",
    expanded ? "true" : "false"
  );
}

function updateProductOwnerColumnVisibility() {
  const tableWrap =
    byId("ordersTableWrap");

  if (!tableWrap) {
    return;
  }

  const shouldHide =
    isProductOwnerRole() ||
    isRetailerRole();

  const ownerHeader =
    findOccTableHeader("product owner");

  if (ownerHeader) {
    ownerHeader.style.display =
      shouldHide ? "none" : "";
  }

  tableWrap
    .querySelectorAll(
      "td.owner-cell.product-owner-only"
    )
    .forEach(cell => {
      cell.style.display =
        shouldHide ? "none" : "";
    });
}

function updateFinanceHeaderVisibility() {

    const financeHeader =
        findOccTableHeader("finance");

    if (financeHeader) {
        financeHeader.style.display =
            shouldShowOccFinanceColumns()
                ? ""
                : "none";
    }

}


function updateOccColumnToggles() {
  const tableWrap =
    byId("ordersTableWrap");

  if (!tableWrap) {
    return;
  }

  /*
   * TYPE
   *
   * Standaard compact.
   */
  createOccColumnToggle({
    header: findOccTableHeader("type"),

    key: "type",

    expanded: typeColumnExpanded,

    expandedTitle:
      "Show full Type",

    compactTitle:
      "Show compact Type",

    onToggle() {
      typeColumnExpanded =
        !typeColumnExpanded;

      localStorage.setItem(
        "occTypeColumnExpanded",
        typeColumnExpanded
          ? "1"
          : "0"
      );

      renderTable();
    }
  });

  /*
   * PRODUCT OWNER
   *
   * Alleen tonen voor interne
   * Sofa2U / Veynor-gebruikers.
   */
  if (
    !isProductOwnerRole() &&
    !isRetailerRole()
  ) {
    createOccColumnToggle({
      header:
        findOccTableHeader(
          "product owner"
        ),

      key:
        "product-owner",

      expanded:
        productOwnerColumnExpanded,

      expandedTitle:
        "Show full Product Owner",

      compactTitle:
        "Show compact Product Owner",

      onToggle() {
        productOwnerColumnExpanded =
          !productOwnerColumnExpanded;

        localStorage.setItem(
          "occProductOwnerColumnExpanded",
          productOwnerColumnExpanded
            ? "1"
            : "0"
        );

        renderTable();
      }
    });
  }

  /*
   * LIFECYCLE
   *
   * lifecycleCompactMode false:
   * volledige lifecycle zichtbaar.
   *
   * lifecycleCompactMode true:
   * alleen huidige stap zichtbaar.
   */
  createOccColumnToggle({
    header:
      findOccTableHeader(
        "lifecycle"
      ),

    key:
      "lifecycle",

    expanded:
      !lifecycleCompactMode,

    expandedTitle:
      "Show full Lifecycle",

    compactTitle:
      "Show current Lifecycle step only",

    onToggle() {
      lifecycleCompactMode =
        !lifecycleCompactMode;

      localStorage.setItem(
        "occLifecycleCompactMode",
        lifecycleCompactMode
          ? "1"
          : "0"
      );

      renderTable();
    }
  });

  /*
   * CSS-status van de kolommen bijwerken.
   */
  tableWrap.classList.toggle(
    "type-column-expanded",
    typeColumnExpanded
  );

  tableWrap.classList.toggle(
    "owner-column-expanded",
    productOwnerColumnExpanded
  );

  tableWrap.classList.toggle(
    "lifecycle-column-compact",
    lifecycleCompactMode
  );
}

function renderCompactLifecycle(order) {
  const lifecycle =
    normalize(
      order.derived_lifecycle_status || ""
    );

  /*
   * Ingeklapte weergave:
   *
   * Alleen het bolletje van de huidige status.
   * Geen lijnen, geen andere stappen en geen tekst.
   */
  if (lifecycleCompactMode) {
    if (lifecycle === "cancelled") {
      return `
        <div
          class="mini-lifecycle-current"
          title="Cancelled"
        >
          <span class="mini-life-step wait">
            ×
          </span>
        </div>
      `;
    }

    const currentStep =
      compactLifecycleStep(order);

    const currentClass =
      getLifecycleStepClass(
        order,
        currentStep
      );

    const currentLabel =
      lifecycle === "issue"
        ? "Issue"
        : currentStep === 4
          ? "Delivered"
          : currentStep === 3
            ? isWarehousePickupOrder(order)
              ? "Awaiting Pickup"
              : "Planned / Transport"
            : currentStep === 2
              ? "Stock Complete"
              : "Order Received";

    return `
      <div
        class="mini-lifecycle-current"
        title="${escapeHtml(currentLabel)}"
      >
        <span
          class="mini-life-step ${currentClass}"
        >
          ${currentStep}
        </span>
      </div>
    `;
  }

  /*
   * Bestaande volledige weergave.
   */
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

  const step =
    compactLifecycleStep(order);

  const isIssue =
    lifecycle === "issue";

  const statusText =
    isIssue
      ? "Issue"
      : step === 4
        ? "Delivered"
        : step === 3
          ? isWarehousePickupOrder(order)
            ? "Awaiting Pickup"
            : "Planned / Transport"
          : step === 2
            ? "Stock Complete"
            : "Order Received";

  function stepClass(index) {
    if (
      isIssue &&
      index === 1
    ) {
      return "wait";
    }

    if (index > step) {
      return "";
    }

    if (index === 1) {
      return "done";
    }

    if (index === 2) {
      return "stock";
    }

    if (index === 3) {
      return "transport";
    }

    if (index === 4) {
      return "delivery";
    }

    return "";
  }

  function connectorClass(index) {
    if (index >= step) {
      return "";
    }

    if (index === 1) {
      return "done";
    }

    if (index === 2) {
      return "stock";
    }

    if (index === 3) {
      return "transport";
    }

    return "";
  }

  const labelClass =
    isIssue
      ? "orange"
      : step === 1
        ? "blue"
        : step === 2
          ? "green"
          : step === 3
            ? "purple"
            : "green";

  return `
    <div class="mini-lifecycle">
      <div class="mini-lifecycle-line">
        <span class="mini-life-step ${stepClass(1)}">
          1
        </span>

        <span
          class="mini-life-connector ${connectorClass(1)}"
        ></span>

        <span class="mini-life-step ${stepClass(2)}">
          2
        </span>

        <span
          class="mini-life-connector ${connectorClass(2)}"
        ></span>

        <span class="mini-life-step ${stepClass(3)}">
          3
        </span>

        <span
          class="mini-life-connector ${connectorClass(3)}"
        ></span>

        <span class="mini-life-step ${stepClass(4)}">
          4
        </span>
      </div>

      <div class="mini-life-label ${labelClass}">
        ${escapeHtml(statusText)}
      </div>
    </div>
  `;
}

function isOrderExpectedComplete(order) {
  return Boolean(
    order?.is_expected_complete === true ||
    normalize(
      order?.expected_match_status
    ) === "full"
  );
}

function getOrderExpectedCompleteDate(order) {
  return (
    order?.expected_complete_date ||
    null
  );
}

function renderCompletenessDonut(order) {

  if (isCollectionOrder(order)) {
    return `
      <div class="colli-wrap">
        <span class="status-pill collection">
          COLLECTION
        </span>
      </div>
    `;
  }

  const completeness =
    order.product_completeness ||
    getProductCompleteness(order);

  const physicalPercentage =
    Math.max(
      0,
      Math.min(
        100,
        toNumber(
          completeness.pct,
          0
        )
      )
    );

  const physicallyComplete =
    completeness.status ===
    "complete";

  const expectedComplete =
    !physicallyComplete &&
    isOrderExpectedComplete(order);

  const expectedCompleteDate =
    getOrderExpectedCompleteDate(
      order
    );

  /*
   * Fysiek compleet:
   * gewone groene weergave.
   */
  if (physicallyComplete) {
    return `
      <div class="colli-wrap">
        <div
          class="colli-donut complete"
          style="
            --pct:100;
            --fill:#16a34a;
          "
          title="Physically complete"
        ></div>

        <div>
          <span class="colli-count">
            ${formatNumber(
              completeness.matched,
              0
            )}
            /
            ${formatNumber(
              completeness.required,
              0
            )}
          </span>

          <span class="colli-percent">
            Complete
          </span>
        </div>
      </div>
    `;
  }

  /*
   * Nog niet fysiek compleet, maar wel volledig
   * gedekt door een verwachte containerlevering.
   */
  if (expectedComplete) {
    const expectedDateText =
      expectedCompleteDate
        ? formatDate(
            expectedCompleteDate
          )
        : "date pending";

    return `
      <div
        class="colli-wrap expected-complete-wrap"
        title="Expected complete from ${escapeHtml(
          expectedDateText
        )}"
      >
        <div
          class="colli-donut expected-complete"
          style="
            --pct:100;
            --fill:#2563eb;
          "
        ></div>

        <div>
          <span class="colli-count">
            ${formatNumber(
              completeness.matched,
              0
            )}
            /
            ${formatNumber(
              completeness.required,
              0
            )}
          </span>

          <span class="colli-percent expected">
            Expected complete
          </span>

          <span class="colli-expected-date">
            From ${escapeHtml(
              expectedDateText
            )}
          </span>
        </div>
      </div>
    `;
  }

  /*
   * Gewone incomplete order.
   */
  let fill = "#f97316";

  if (
    physicalPercentage <= 25
  ) {
    fill = "#ef4444";
  }

  const label =
    completeness.status === "none"
      ? "No lines"
      : `${formatNumber(
          physicalPercentage,
          0
        )}%`;

  return `
    <div class="colli-wrap">
      <div
        class="colli-donut"
        style="
          --pct:${escapeHtml(
            physicalPercentage
          )};
          --fill:${escapeHtml(
            fill
          )};
        "
        title="${escapeHtml(label)}"
      ></div>

      <div>
        <span class="colli-count">
          ${formatNumber(
            completeness.matched,
            0
          )}
          /
          ${formatNumber(
            completeness.required,
            0
          )}
        </span>

        <span class="colli-percent">
          ${escapeHtml(label)}
        </span>
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

  const generated = docs.filter(([type]) =>
    documentIsGenerated(order, type)
  ).length;

  const cls =
    generated === total
      ? "good"
      : generated > 0
        ? "warn"
        : "bad";

  return `
    <div class="doc-compact">
      <span class="doc-icon">
        📄
      </span>

      <span class="doc-count ${cls}">
        ${generated}/${total}
      </span>

      ${
        isAckDownloaded(order)
          ? `
            <span
              class="ack-dot"
              title="ACK downloaded"
            ></span>
          `
          : ""
      }

      ${
        isPodDownloaded(order)
          ? `
            <span
              class="pod-download-dot"
              title="POD downloaded"
            ></span>
          `
          : ""
      }
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

function isCollectionOrder(order) {
  return (
    normalize(order?.movement_type) === "collection"
  );
}

function isWarehousePickupOrder(order) {
  return (
    normalize(order.transport_type) === "warehouse_pickup" ||
    normalize(order.status) === "awaiting_pickup" ||
    normalize(order.status) === "pickup_confirmed" ||
    normalize(order.status) === "picked_up"
  );
}

function getFdsWeekLabel(order) {
  const collectionDate =
    order.fds_collection_date ||
    null;

  if (!collectionDate) {
    return "FDS Delivery";
  }

  const date = new Date(
    `${String(collectionDate).slice(0, 10)}T12:00:00`
  );

  if (Number.isNaN(date.getTime())) {
    return "FDS Delivery";
  }

  // FDS delivery is always shown as the following week
  date.setDate(
    date.getDate() + 7
  );

  const deliveryWeek =
    getIsoWeekNumber(date);

  return deliveryWeek
    ? `FDS Week ${deliveryWeek}`
    : "FDS Delivery";
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

if (isCollectionOrder(order)) {
const collectionDate =
  order.fds_collection_date ||
  getExpectedDeliveryDate(order) ||
  "";

  return `
    <div class="delivery-cell">

      ${
        collectionDate
          ? `
            <strong>
              ${escapeHtml(
                formatDate(collectionDate)
              )}
            </strong>
          `
          : ""
      }

      <span class="status-pill collection">
        COLLECTION
      </span>

      <span class="subline">
        ${
          collectionDate
            ? "Collection date"
            : "Collection date pending"
        }
      </span>
    </div>
  `;
}

  if (isWarehousePickupOrder(order)) {
    const pickupDate =
      order.expected_delivery_date ||
      order.confirmed_delivery_date ||
      null;

    const pickupStatus =
      normalize(order.status) === "picked_up"
        ? "Picked up"
        : pickupDate
          ? "Pickup date confirmed"
          : "Pickup date pending";

    return `
      <div class="delivery-cell">
        ${
          pickupDate
            ? `
              <strong>
                ${escapeHtml(formatDate(pickupDate))}
              </strong>
            `
            : ""
        }

        <span class="status-pill pickup">
          PICK UP
        </span>

        <span class="subline">
          ${escapeHtml(pickupStatus)}
        </span>
      </div>
    `;
  }

  if (isFdsCarrierOrder(order)) {
    const fdsStatus = normalize(order.fds_status || "");
    const isAllocated = fdsStatus === "allocated";

    /*
     * FDS-importdatum heeft voorrang.
     * Als FDS nog unallocated is, tonen we de
     * handmatig ingevoerde confirmed delivery date.
     */
    const deliveryDate =
      order.expected_delivery_date ||
      order.confirmed_delivery_date ||
      null;

    const etaFrom = formatTime(
      order.delivery_eta_from || ""
    );

    const etaTo = formatTime(
      order.delivery_eta_to || ""
    );

    const etaText = etaFrom
      ? etaTo && etaTo !== etaFrom
        ? `${etaFrom} - ${etaTo}`
        : etaFrom
      : "";

    let statusText = "Actual date pending";

    if (isAllocated) {
      statusText = etaText || "Time not confirmed yet";
    } else if (deliveryDate && etaText) {
      statusText = `Manual date · ${etaText}`;
    } else if (deliveryDate) {
      statusText = "Manual delivery date";
    }

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
          ${escapeHtml(statusText)}
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

function getCompactOrderTypeConfig(order) {

  if (isCollectionOrder(order)) {
    return {
      letter: "P",
      label: "Collection from retailer",
      className: "collection"
    };
  }

  const type =
    getOrderType(order);

  if (type === "legacy") {
    return {
      letter: "L",
      label: "Legacy",
      className: "purple"
    };
  }

  if (type === "manual_charge") {
    return {
      letter: "M",
      label: "Manual Charge",
      className: "orange"
    };
  }

  if (type === "credit") {
    return {
      letter: "C",
      label: "Credit",
      className: "red"
    };
  }

  if (type === "copy") {
    return {
      letter: "C",
      label: "Copy",
      className: "green"
    };
  }

  return {
    letter: "S",
    label: "Standard",
    className: "blue"
  };
}


function renderCompactOrderType(order) {
  /*
   * Uitgeklapt gebruikt Type gewoon de
   * bestaande volledige badge.
   */
  if (typeColumnExpanded) {
    return `
      <div class="order-type-badges">
        ${renderOrderTypeBadge(order)}
        ${renderOrderPriorityBadge(order)}
      </div>
    `;
  }

  const config =
    getCompactOrderTypeConfig(order);

  return `
    <div
      class="compact-type-wrap"
      title="${escapeHtml(config.label)}"
    >
      <span
        class="compact-type-logo ${escapeHtml(config.className)}"
      >
        ${escapeHtml(config.letter)}
      </span>

      ${
        renderOrderPriorityBadge(order)
      }
    </div>
  `;
}


function getCompactProductOwnerCode(order) {
  const suppliedCode =
    cleanText(
      order.customer_code_display ||
      order.customer_code ||
      order.customers?.customer_code ||
      ""
    );

  const ownerName =
    cleanText(
      order.product_owner_name ||
      getProductOwnerName(order) ||
      ""
    );

  const source =
    suppliedCode || ownerName || "PO";

  const compactCode =
    source
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3);

  return compactCode || "PO";
}


function renderProductOwnerCell(order) {
  /*
   * Uitgeklapte weergave:
   * exact dezelfde informatie als nu.
   */
  if (productOwnerColumnExpanded) {
    return `
      <div class="product-owner-full">
        <strong>
          ${escapeHtml(
            order.product_owner_name ||
            "—"
          )}
        </strong>

        <span class="subline">
          ${escapeHtml(
            order.customer_code_display ||
            "—"
          )}
        </span>
      </div>
    `;
  }

  /*
   * Compacte weergave:
   * ronde badge zoals BEL in de planning.
   */
  const ownerCode =
    getCompactProductOwnerCode(order);

  const ownerName =
    order.product_owner_name ||
    getProductOwnerName(order) ||
    "Product Owner";

  return `
    <div
      class="compact-owner-wrap"
      title="${escapeHtml(ownerName)}"
    >
      <span class="compact-owner-logo">
        ${escapeHtml(ownerCode)}
      </span>
    </div>
  `;
}

function renderOrderTypeBadge(order) {

  if (isCollectionOrder(order)) {
    return `
      <span class="status-pill collection">
        COLLECTION
      </span>
    `;
  }

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
  const totalRevenue =
    getOrderRevenue(order);

  const regionalSurcharge =
    getOrderRegionalSurcharge(order);

  return `
    <div class="finance-metric">
      ${pill(
        order.derived_finance_status
      )}

      ${
        canSeeInternalPlanningData()
          ? `
            <strong>
              ${formatMoney(
                totalRevenue
              )}
            </strong>

            ${
              regionalSurcharge > 0
                ? `
                  <span class="subline">
                    Includes regional surcharge:
                    ${formatMoney(
                      regionalSurcharge
                    )}
                  </span>
                `
                : ""
            }
          `
          : ""
      }
    </div>
  `;
}

function renderDeliveryGroupCell(order) {
  const group = getDeliveryGroup(order);

  if (!group) {
    return `<div class="subline">—</div>`;
  }

  const stored = getStoredDeliveryGroup(group);

  const orderVolume = round2(
    getOrderVolumeM3(order)
  );

  const readyVolume = toNumber(
    group.readyVolume,
    0
  );

  const minimumVolume = toNumber(
    group.minimumVolume,
    1.25
  );

  const shortfall = round2(
    Math.max(
      0,
      minimumVolume - readyVolume
    )
  );

  const calculatedSurcharge = round2(
    shortfall *
    toNumber(
      group.tariffPerM3,
      55.20
    )
  );

  const isApproved =
    normalize(stored?.status) ===
    "approved";

  const appliedSurcharge = isApproved
    ? round2(
        stored?.applied_surcharge ??
        calculatedSurcharge
      )
    : calculatedSurcharge;

  if (readyVolume <= 0) {
    return `
      <div class="delivery-group wait">
        <span class="subline">
          Order: ${formatNumber(orderVolume, 2)} m³
        </span>

        <strong>
          0.00 /
          ${formatNumber(minimumVolume, 2)} m³
        </strong>

        <span class="subline">
          Waiting goods
        </span>
      </div>
    `;
  }

  if (shortfall <= 0) {
    return `
      <div class="delivery-group good">
        <span class="subline">
          Order: ${formatNumber(orderVolume, 2)} m³
        </span>

        <strong>
          ✓ ${formatNumber(readyVolume, 2)} /
          ${formatNumber(minimumVolume, 2)} m³
        </strong>

        <span class="subline">
          Ready
        </span>
      </div>
    `;
  }

  return `
    <div class="delivery-group warn">
      <span class="subline">
        Order: ${formatNumber(orderVolume, 2)} m³
      </span>

      <strong>
        ${formatNumber(readyVolume, 2)} /
        ${formatNumber(minimumVolume, 2)} m³
      </strong>

      <span class="subline">
        Shortfall ${formatNumber(shortfall, 2)} m³
        ${
          appliedSurcharge > 0
            ? `· +${formatMoney(appliedSurcharge)}`
            : isApproved
              ? "· No surcharge applied"
              : `· +${formatMoney(calculatedSurcharge)}`
        }
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
  const c =
    order.product_completeness ||
    getProductCompleteness(order);

  const sourceLines = Array.isArray(order.order_lines)
    ? order.order_lines
    : [];

  const manualLines = sourceLines.filter(
    line => normalize(line.line_type) === "manual"
  );

  const stockHtml = !c.lines.length
    ? `
      <div class="detail-line">
        <span class="detail-label">Products</span>
        <span class="detail-value">
          No stock product lines found.
        </span>
      </div>
    `
    : c.lines.map(line => {
        const sourceLine = sourceLines.find(
          row => String(row.id) === String(line.id)
        );

        const priorityLevel =
          getLineStockPriorityLevel(sourceLine);

        const priorityLabel =
          getLineStockPriorityLabel(sourceLine);

        const priorityClass =
          getLineStockPriorityClass(sourceLine);

        const priorityStatus =
          normalize(
            getLineStockPriority(sourceLine)?.priority_status
          );

        return `
          <div
            class="detail-line stock-priority-product-line ${
              priorityLevel > 0 ? `has-${priorityClass}` : ""
            }"
          >
            <span class="detail-label">
              ${escapeHtml(line.sku)}
            </span>

            <span class="detail-value">
              <span class="stock-product-title">
                <span
                  class="stock-product-dot ${
                    line.complete ? "complete" : "missing"
                  }"
                ></span>

                <span>
                  ${escapeHtml(
                    shortText(line.description, 54)
                  )}
                </span>

                ${
                  priorityLevel > 0
                    ? `
                      <span
                        class="stock-priority-badge ${priorityClass}"
                      >
                        ${escapeHtml(priorityLabel)}
                      </span>
                    `
                    : ""
                }
              </span>

              <span class="subline">
                Quantity ${formatNumber(line.orderedProducts, 0)}
                · Packages ${formatNumber(line.required, 0)}

                ${
                  line.missing > 0
                    ? `· Unallocated ${formatNumber(line.missing, 0)}`
                    : `· Allocated ${formatNumber(line.matched, 0)}`
                }

                ${
                  canSeeFinance()
                    ? `· ${formatMoney(line.revenue)}`
                    : ""
                }
              </span>

              ${
                priorityStatus === "fulfilled"
                  ? `
                    <span class="subline stock-priority-fulfilled">
                      Priority stock allocated
                    </span>
                  `
                  : priorityLevel > 0 && line.missing > 0
                    ? `
                      <span class="subline stock-priority-waiting">
                        Waiting for priority stock
                      </span>
                    `
                    : ""
              }

              ${
                isTenantRole() && sourceLine?.id
                  ? `
                    <button
                      class="stock-priority-manage-btn"
                      type="button"
                      data-manage-stock-priority-line="${escapeHtml(
                        sourceLine.id
                      )}"
                      data-order-id="${escapeHtml(order.id)}"
                    >
                      Manage
                    </button>
                  `
                  : ""
              }
            </span>
          </div>
        `;
      }).join("");

const manualHtml =
  manualLines
    .map(line => {

      const description =
        line.manual_description ||
        line.description ||
        "Manual charge";

      const quantity =
        toNumber(
          line.manual_quantity,
          0
        );

      const unit =
        cleanText(
          line.manual_unit || ""
        );

      const rate =
        toNumber(
          line.manual_rate_gbp,
          0
        );

      const total =
        getLineRevenue(line);

      let calculation = "";

      if (
        quantity > 0 &&
        rate > 0
      ) {
        calculation =
          `${formatNumber(quantity, 2)} ` +
          `${unit || "units"} × ` +
          `${formatMoney(rate)}`;
      }

      return `
        <div class="detail-line">

          <span class="detail-label">
            MANUAL
          </span>

          <span class="detail-value">

            <strong>
              ${escapeHtml(
                shortText(
                  description,
                  54
                )
              )}
            </strong>

            ${
              calculation
                ? `
                    <span class="subline">
                      ${escapeHtml(calculation)}
                    </span>
                  `
                : ""
            }

            ${
              canSeeFinance()
                ? `
                    <span class="subline">
                      Total:
                      <strong>
                        ${formatMoney(total)}
                      </strong>
                    </span>
                  `
                : `
                    <span class="subline">
                      Manual line
                    </span>
                  `
            }

          </span>
        </div>
      `;
    })
    .join("");

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
  const normalizedType = normalize(type);

  const doc = getDoc(order, type);

  const status =
    doc?.document_status ||
    "not_generated";

  const url =
    normalizedType === "pod"
      ? getPodDocumentUrl(order)
      : doc?.file_url || "";

  const ackDownloaded =
    [
      "acknowledgement",
      "legacy_acknowledgement"
    ].includes(normalizedType) &&
    isAckDownloaded(order);

  const podDownloaded =
    normalizedType === "pod" &&
    isPodDownloaded(order);

  if (url) {
    /*
     * De POD-knop opent de volledige POD-pagina.
     *
     * Belangrijk:
     * deze knop registreert zelf GEEN download.
     * Alleen de echte Download-knop in pod.js
     * mag het event pod_downloaded opslaan.
     */
    if (normalizedType === "pod") {
      return `
        <a
          class="
            quick-action
            ${podDownloaded ? "pod-downloaded" : ""}
          "
          href="./pod.html?order_id=${escapeHtml(order.id)}"
          target="_blank"
          rel="noopener"
        >
          <span>
            ${escapeHtml(label)}
          </span>

          <span>
            ${
              podDownloaded
                ? "⬇ Downloaded"
                : "Open POD"
            }
          </span>
        </a>
      `;
    }

    /*
     * Alle andere bestaande documenten.
     */
    return `
      <a
        class="
          quick-action
          ${ackDownloaded ? "ack-downloaded" : ""}
        "
        href="${escapeHtml(url)}"

        ${
          [
            "delivery_note",
            "delivery_labels",
            "supplier_packing_slip"
          ].includes(normalizedType)
            ? `
              target="_blank"
              rel="noopener"
              download="${escapeHtml(
                `${label}-${order.order_number || "order"}.pdf`
              )}"
            `
            : `
              target="_blank"
              rel="noopener"
            `
        }

        ${renderPortalDocAttrs(
          order,
          type,
          "downloaded",
          url
        )}
      >
        <span>
          ${escapeHtml(label)}
        </span>

        <span>
          ${
            ackDownloaded
              ? "Downloaded"
              : "Download"
          }
        </span>
      </a>
    `;
  }

  if (
    normalizedType === "legacy_acknowledgement" &&
    canGenerateDocuments()
  ) {
    return `
      <button
        class="quick-action"
        type="button"
        data-upload-legacy-ack="${escapeHtml(order.id)}"
      >
        <span>
          ${escapeHtml(label)}
        </span>

        <span>
          Upload PDF
        </span>
      </button>
    `;
  }

  if (
    canGenerateDocuments() &&
    normalizedType !== "supplier_packing_slip" &&
    normalizedType !== "pod"
  ) {
    return `
      <button
        class="quick-action"
        type="button"
        data-doc-action="${escapeHtml(type)}"
        data-order-id="${escapeHtml(order.id)}"
        data-order-number="${escapeHtml(
          order.order_number || ""
        )}"
      >
        <span>
          ${escapeHtml(label)}
        </span>

        <span>
          Generate
        </span>
      </button>
    `;
  }

  return `
    <div
      class="quick-action"
      style="opacity:.7;"
    >
      <span>
        ${escapeHtml(label)}
      </span>

      <span>
        ${escapeHtml(statusLabel(status))}
      </span>
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
  <span class="detail-label">Import date</span>

  <span class="detail-value">
    ${escapeHtml(formatDateTime(order.created_at))}
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
    ${formatNumber(
      c.matched,
      0
    )}
    /
    ${formatNumber(
      c.required,
      0
    )}
    packages physically available

    ${
      isOrderExpectedComplete(order) &&
      c.status !== "complete"
        ? `
          <span class="subline">
            <span class="status-pill blue">
              Expected complete
            </span>
          </span>

          <span class="subline">
            Complete from:
            <strong>
              ${escapeHtml(
                formatDate(
                  getOrderExpectedCompleteDate(
                    order
                  )
                )
              )}
            </strong>
          </span>
        `
        : ""
    }
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
  if (!group?.key) {
    return null;
  }

  /*
   * Alleen een open delivery group mag nog
   * worden gebruikt voor nieuwe orders.
   *
   * Approved en gesloten groepen worden
   * afzonderlijk vanuit de historie getoond.
   */
  return (
    window.__storedDeliveryGroups ||
    []
  ).find(row => {
    const storedKey =
      String(row.group_key || "");

    const belongsToBaseKey =
      storedKey === group.key ||
      storedKey.startsWith(
        `${group.key}|C`
      );

    return (
      belongsToBaseKey &&
      row.is_open === true &&
      normalize(row.status) !==
        "approved"
    );
  }) || null;
}

function renderDeliveryGroupOrdersBlock(
  title,
  orders,
  emptyText
) {
  if (!orders?.length) {
    return `
      <div class="delivery-group-empty">
        ${escapeHtml(emptyText)}
      </div>
    `;
  }

  return `
    <div class="delivery-group-orders-block">
      <strong>
        ${escapeHtml(title)}
      </strong>

      ${orders.map(item => `
        <div class="delivery-group-order-line">
          <span>
            <strong>
              ${escapeHtml(
                item.orderNumber
              )}
            </strong>

            <span class="subline">
              ${escapeHtml(
                statusLabel(
                  item.status
                )
              )}
            </span>
          </span>

          <span>
            ${formatNumber(
              item.volume,
              2
            )} m³
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDeliveryGroupCard(group) {
  const readyVolume =
    toNumber(
      group.readyVolume,
      0
    );

  const waitingVolume =
    toNumber(
      group.waitingVolume,
      0
    );

  const minimumVolume =
    toNumber(
      group.minimumVolume,
      1.25
    );

  const potentialVolume =
    round2(
      readyVolume +
      waitingVolume
    );

  const shortfall =
    round2(
      Math.max(
        0,
        minimumVolume -
        readyVolume
      )
    );

  const surcharge =
    round2(
      shortfall *
      toNumber(
        group.tariffPerM3,
        55.20
      )
    );

  const hasWaitingOrders =
    group.waitingOrders.length > 0;

  const waitingCouldHelp =
    potentialVolume >=
      minimumVolume &&
    shortfall > 0;

  return `
    <div class="delivery-group-card">
      <div class="delivery-group-card-head">
        <div>
          <h3>
            ${escapeHtml(
              group.retailer ||
              "Unknown retailer"
            )}
          </h3>

          <div class="subline">
            ${escapeHtml(
              group.productOwner ||
              "—"
            )}
            ·
            ${escapeHtml(
              group.postcode ||
              "No postcode"
            )}
          </div>
        </div>

        <div>
          ${pill(
            "planned",
            `Below minimum · +${formatMoney(
              surcharge
            )}`
          )}
        </div>
      </div>

      <div class="delivery-group-metrics">
        <div class="delivery-group-metric">
          <span>Ready orders</span>

          <strong>
            ${formatNumber(
              group.readyOrders.length,
              0
            )}
          </strong>
        </div>

        <div class="delivery-group-metric">
          <span>Waiting orders</span>

          <strong>
            ${formatNumber(
              group.waitingOrders.length,
              0
            )}
          </strong>
        </div>

        <div class="delivery-group-metric">
          <span>Ready volume</span>

          <strong>
            ${formatNumber(
              readyVolume,
              2
            )}
            /
            ${formatNumber(
              minimumVolume,
              2
            )}
            m³
          </strong>
        </div>

        <div class="delivery-group-metric">
          <span>Potential volume</span>

          <strong>
            ${formatNumber(
              potentialVolume,
              2
            )}
            m³
          </strong>
        </div>
      </div>

      <div class="delivery-group-warning">
        <strong>
          Shortfall
          ${formatNumber(
            shortfall,
            2
          )}
          m³
        </strong>

        <span>
          Additional transport charge:
          ${formatMoney(
            surcharge
          )}
        </span>

        ${
          waitingCouldHelp
            ? `
              <span>
                Waiting orders could bring this
                delivery above the minimum.
              </span>
            `
            : hasWaitingOrders
              ? `
                <span>
                  Even with waiting orders, this
                  stays below minimum.
                </span>
              `
              : `
                <span>
                  No waiting orders available
                  for this retailer.
                </span>
              `
        }
      </div>

      <div class="delivery-group-card-grid">
        ${renderDeliveryGroupOrdersBlock(
          "Ready to deliver",
          group.readyOrders,
          "No ready orders."
        )}

        ${renderDeliveryGroupOrdersBlock(
          "Waiting / potential",
          group.waitingOrders,
          "No waiting orders."
        )}
      </div>

      <div class="delivery-group-decision">
        <div>
          <strong>
            Decision required
          </strong>

          <span class="subline">
            Deliver ready orders now,
            or hold for waiting orders.
          </span>
        </div>

        <button
          class="btn btn-primary"
          type="button"
          data-open-delivery-group="${escapeHtml(
            group.key
          )}"
        >
          Review Delivery
        </button>
      </div>
    </div>
  `;
}

/*
 * Haalt alle databasekoppelingen op die bij
 * één opgeslagen delivery group horen.
 *
 * Dubbele koppelingen voor dezelfde order
 * worden hier automatisch verwijderd.
 */
function getStoredGroupLinkedRows(
  storedGroup,
  groupRole = ""
) {
  const seenOrderIds =
    new Set();

  return (
    window.__storedDeliveryGroupOrders ||
    []
  )
    .filter(row => {
      return (
        String(
          row.delivery_group_id
        ) ===
        String(
          storedGroup.id
        )
      );
    })
    .filter(row => {
      if (!groupRole) {
        return true;
      }

      return (
        normalize(
          row.group_role
        ) ===
        normalize(
          groupRole
        )
      );
    })
    .filter(row => {
      const orderId =
        String(
          row.order_id ||
          ""
        );

      if (
        !orderId ||
        seenOrderIds.has(
          orderId
        )
      ) {
        return false;
      }

      seenOrderIds.add(
        orderId
      );

      return true;
    });
}

/*
 * Koppelt een rij uit delivery_group_orders
 * aan de actuele order uit allOrders.
 */
function getOrderForStoredGroupRow(
  row
) {
  return allOrders.find(order => {
    return (
      String(order.id) ===
      String(row.order_id)
    );
  }) || null;
}

/*
 * Bepaalt of een approved delivery group nog
 * aandacht nodig heeft.
 *
 * De groep verdwijnt zodra alle approved orders:
 *
 * - een leverdatum/pickupdatum hebben;
 * - op transport staan;
 * - delivered zijn;
 * - cancelled/closed zijn;
 * - of anderszins historisch zijn.
 */
function storedGroupStillNeedsAttention(
  storedGroup
) {
  const readyRows =
    getStoredGroupLinkedRows(
      storedGroup,
      "ready"
    );

  if (!readyRows.length) {
    return false;
  }

  return readyRows.some(row => {
    const order =
      getOrderForStoredGroupRow(
        row
      );

    if (!order) {
      return false;
    }

    if (
      !isActiveOrder(order)
    ) {
      return false;
    }

    if (
      isExcludedFromDeliveryGroup(
        order
      )
    ) {
      return false;
    }

    /*
     * Zodra een lever- of pickupdatum bekend is,
     * hoeft de approval niet meer in dit
     * aandachtsoverzicht te staan.
     */
    if (
      getExpectedDeliveryDate(
        order
      )
    ) {
      return false;
    }

    if (
      normalize(
        order.status
      ) === "picked_up"
    ) {
      return false;
    }

    return true;
  });
}

function renderApprovedDeliveryGroupCard(
  stored
) {
  const readyRows =
    getStoredGroupLinkedRows(
      stored,
      "ready"
    );

  const waitingRows =
    getStoredGroupLinkedRows(
      stored,
      "waiting"
    );

  const readyOrders =
    readyRows.map(row => ({
      orderNumber:
        row.order_number ||
        "Order",

      status:
        row.order_status ||
        "approved",

      volume:
        toNumber(
          row.volume_m3,
          0
        )
    }));

  const waitingOrders =
    waitingRows.map(row => ({
      orderNumber:
        row.order_number ||
        "Order",

      status:
        row.order_status ||
        "waiting",

      volume:
        toNumber(
          row.volume_m3,
          0
        )
    }));

  const shortfall =
    toNumber(
      stored.shortfall_m3,
      0
    );

  const appliedSurcharge =
    toNumber(
      stored.applied_surcharge,
      0
    );

  return `
    <div class="delivery-group-card">
      <div class="delivery-group-card-head">
        <div>
          <h3>
            ${escapeHtml(
              stored.retailer_name ||
              "Unknown retailer"
            )}
          </h3>

          <div class="subline">
            ${escapeHtml(
              stored.product_owner_name ||
              "—"
            )}
            ·
            ${escapeHtml(
              stored.delivery_postcode ||
              "No postcode"
            )}
          </div>
        </div>

        <div>
          ${pill(
            "confirmed",
            "Approved"
          )}
        </div>
      </div>

      <div class="delivery-group-metrics">
        <div class="delivery-group-metric">
          <span>Ready orders</span>

          <strong>
            ${formatNumber(
              readyOrders.length,
              0
            )}
          </strong>
        </div>

        <div class="delivery-group-metric">
          <span>Waiting orders</span>

          <strong>
            ${formatNumber(
              waitingOrders.length,
              0
            )}
          </strong>
        </div>

        <div class="delivery-group-metric">
          <span>Approved volume</span>

          <strong>
            ${formatNumber(
              stored.ready_volume_m3,
              2
            )}
            /
            ${formatNumber(
              stored.minimum_volume_m3,
              2
            )}
            m³
          </strong>
        </div>

        <div class="delivery-group-metric">
          <span>Applied surcharge</span>

          <strong>
            ${formatMoney(
              appliedSurcharge
            )}
          </strong>
        </div>
      </div>

      ${
        shortfall > 0
          ? `
            <div class="delivery-group-warning">
              <strong>
                Shortfall
                ${formatNumber(
                  shortfall,
                  2
                )}
                m³
              </strong>

              <span>
                Additional transport charge:
                ${formatMoney(
                  appliedSurcharge
                )}
              </span>
            </div>
          `
          : ""
      }

      <div class="delivery-group-card-grid">
        ${renderDeliveryGroupOrdersBlock(
          "Approved for delivery",
          readyOrders,
          "No approved orders found."
        )}

        ${renderDeliveryGroupOrdersBlock(
          "Waiting at approval",
          waitingOrders,
          "No waiting orders."
        )}
      </div>

      <div class="delivery-group-decision">
        <div>
          <strong>
            Approved
          </strong>

          <span class="subline">
            ${escapeHtml(
              stored.approved_by_name ||
              "Unknown user"
            )}

            ${
              stored.approved_at
                ? `
                  ·
                  ${escapeHtml(
                    formatDateTime(
                      stored.approved_at
                    )
                  )}
                `
                : ""
            }
          </span>

          <span class="subline">
            Applied surcharge:
            ${formatMoney(
              appliedSurcharge
            )}
          </span>
        </div>
      </div>
    </div>
  `;
}

function renderDeliveryGroupsView() {
  const tableWrap =
    byId(
      "ordersTableWrap"
    );

  const groupsWrap =
    byId(
      "deliveryGroupsWrap"
    );

  const container =
    byId(
      "deliveryGroupsContainer"
    );

  if (
    !tableWrap ||
    !groupsWrap ||
    !container
  ) {
    return;
  }

  tableWrap.style.display =
    "none";

  groupsWrap.style.display =
    "";

  /*
   * Gebruik deliveryGroupsMap direct.
   *
   * Hierdoor worden de groepen niet meer
   * beïnvloed door:
   *
   * - Active/Historical;
   * - zoekfilters;
   * - lifecyclefilters;
   * - documentfilters.
   */
  const approvalRequiredGroups = [
    ...deliveryGroupsMap.values()
  ]
    .filter(group => {
      return (
        group.readyOrders.length > 0 &&
        group.shortfall > 0
      );
    })
    .sort((a, b) => {
      if (
        b.readyVolume !==
        a.readyVolume
      ) {
        return (
          b.readyVolume -
          a.readyVolume
        );
      }

      return String(
        a.retailer ||
        ""
      ).localeCompare(
        String(
          b.retailer ||
          ""
        ),
        "en"
      );
    });

  /*
   * Toon alleen approved groepen die nog
   * aandacht nodig hebben.
   *
   * Een groep verdwijnt zodra de gekoppelde
   * ready-orders een leverdatum/pickupdatum
   * hebben of historisch zijn geworden.
   */
  const approvedGroups = (
    window.__storedDeliveryGroups ||
    []
  )
    .filter(storedGroup => {
      const isApproved =
        normalize(
          storedGroup.status
        ) ===
        "approved";

      const isClosed =
        storedGroup.is_open ===
        false;

      const isNotInvoiced =
        normalize(
          storedGroup.invoice_status
        ) !==
        "invoiced";

      return (
        isApproved &&
        isClosed &&
        isNotInvoiced &&
        storedGroupStillNeedsAttention(
          storedGroup
        )
      );
    })
    .sort((a, b) => {
      const aDate =
        new Date(
          a.approved_at ||
          a.closed_at ||
          0
        ).getTime();

      const bDate =
        new Date(
          b.approved_at ||
          b.closed_at ||
          0
        ).getTime();

      return bDate - aDate;
    });

  if (
    !approvalRequiredGroups.length &&
    !approvedGroups.length
  ) {
    container.innerHTML = `
      <div class="delivery-group-empty">
        No delivery groups requiring attention.
      </div>
    `;

    return;
  }

  container.innerHTML = `
    <div class="delivery-groups-view">

      ${approvalRequiredGroups
        .map(group =>
          renderDeliveryGroupCard(
            group
          )
        )
        .join("")}

      ${approvedGroups
        .map(storedGroup =>
          renderApprovedDeliveryGroupCard(
            storedGroup
          )
        )
        .join("")}

    </div>
  `;

  bindDeliveryGroupTableEvents();
}

async function approveDeliveryGroup(
  groupKey,
  options = {}
) {
  const group =
    deliveryGroupsMap.get(groupKey);

  if (!group) {
    throw new Error(
      "Delivery group not found."
    );
  }

  const cid =
    await getCompanyId();

  const cycleNumber =
    getNextDeliveryGroupCycle(
      group.key
    );

  const storedGroupKey =
    makeStoredDeliveryGroupKey(
      group.key,
      cycleNumber
    );

  const approvedAt =
    new Date().toISOString();

  const appliedSurcharge =
    round2(
      options.appliedSurcharge ??
      group.surcharge
    );

  const payload = {
    company_id: cid,

    product_owner_id: null,

    product_owner_name:
      group.productOwner || "",

    retailer_name:
      group.retailer || "",

    retailer_code: "",

    delivery_postcode:
      group.postcode || "",

    group_key: storedGroupKey,
    cycle_number: cycleNumber,

    ready_volume_m3:
      round2(group.readyVolume),

    waiting_volume_m3:
      round2(group.waitingVolume),

    minimum_volume_m3:
      round2(group.minimumVolume),

    shortfall_m3:
      round2(group.shortfall),

    tariff_per_m3:
      round2(group.tariffPerM3),

    calculated_surcharge:
      round2(group.surcharge),

    applied_surcharge:
      appliedSurcharge,

    status: "approved",

    is_open: false,
    closed_at: approvedAt,

    invoice_status:
      "not_invoiced",

    approval_note:
      options.approvalNote ||
      "Delivery approved from OCC.",

    approved_by:
      currentUser?.id || null,

    approved_by_name:
      currentProfile?.full_name ||
      currentUser?.email ||
      "Unknown user",

    approved_at: approvedAt,
    updated_at: approvedAt
  };

  const {
    data,
    error
  } = await client
    .from("delivery_groups")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  const deliveryGroupId =
    data.id;

  const rows = [
    ...group.readyOrders.map(order => ({
      company_id: cid,
      delivery_group_id:
        deliveryGroupId,
      order_id: order.id,
      order_number:
        order.orderNumber,
      order_status:
        order.status,
      volume_m3:
        round2(order.volume),
      group_role: "ready"
    })),

    ...group.waitingOrders.map(order => ({
      company_id: cid,
      delivery_group_id:
        deliveryGroupId,
      order_id: order.id,
      order_number:
        order.orderNumber,
      order_status:
        order.status,
      volume_m3:
        round2(order.volume),
      group_role: "waiting"
    }))
  ];

  if (rows.length) {
    const {
      error: orderError
    } = await client
      .from("delivery_group_orders")
      .insert(rows);

    if (orderError) {
      throw orderError;
    }
  }

  const {
    error: activityError
  } = await client
    .from("delivery_group_activity")
    .insert({
      company_id: cid,
      delivery_group_id:
        deliveryGroupId,
      activity_type: "approved",

      description:
        `Delivery group cycle ${cycleNumber} approved. ` +
        `Applied surcharge ${formatMoney(appliedSurcharge)}.` +
        `${
          options.approvalNote
            ? ` Note: ${options.approvalNote}`
            : ""
        }`,

      created_by:
        currentUser?.id || null,

      created_by_name:
        currentProfile?.full_name ||
        currentUser?.email ||
        "Unknown user"
    });

  if (activityError) {
    console.warn(
      "Delivery group activity could not be saved:",
      activityError.message
    );
  }

  showToast(
    `Delivery group cycle ${cycleNumber} approved: ` +
    `${formatMoney(appliedSurcharge)} surcharge.`,
    "ok"
  );
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

function setupOrdersTopScrollbar() {
  const tableWrap =
    byId("ordersTableWrap");

  if (!tableWrap) {
    return;
  }

  const table =
    tableWrap.querySelector("table");

  if (!table) {
    return;
  }

  let topScrollbar =
    byId("ordersTopScrollbar");

  if (!topScrollbar) {
    topScrollbar =
      document.createElement("div");

    topScrollbar.id =
      "ordersTopScrollbar";

    topScrollbar.className =
      "orders-top-scrollbar";

    topScrollbar.innerHTML = `
      <div
        class="orders-top-scrollbar-content"
      ></div>
    `;

    tableWrap.parentNode.insertBefore(
      topScrollbar,
      tableWrap
    );
  }

  const scrollbarContent =
    topScrollbar.querySelector(
      ".orders-top-scrollbar-content"
    );

  if (!scrollbarContent) {
    return;
  }

  scrollbarContent.style.width =
    `${table.scrollWidth}px`;

  topScrollbar.style.display =
    table.scrollWidth > tableWrap.clientWidth
      ? ""
      : "none";

  if (
    topScrollbar.dataset.syncBound !== "1"
  ) {
    let syncingTop = false;
    let syncingTable = false;

    topScrollbar.addEventListener(
      "scroll",
      () => {
        if (syncingTable) {
          return;
        }

        syncingTop = true;

        tableWrap.scrollLeft =
          topScrollbar.scrollLeft;

        requestAnimationFrame(() => {
          syncingTop = false;
        });
      }
    );

    tableWrap.addEventListener(
      "scroll",
      () => {
        if (syncingTop) {
          return;
        }

        syncingTable = true;

        topScrollbar.scrollLeft =
          tableWrap.scrollLeft;

        requestAnimationFrame(() => {
          syncingTable = false;
        });
      }
    );

    topScrollbar.dataset.syncBound =
      "1";
  }

  topScrollbar.scrollLeft =
    tableWrap.scrollLeft;
}


/*
 * Bepaalt een korte, duidelijke tekst
 * voor bekende activity-types.
 */
function getLastActivityLabel(
  activityType,
  order
) {
  const type =
    normalize(activityType);

  const labels = {
    order_created:
      "Order created",

    ack_generated:
      "Acknowledgement generated",

    acknowledgement_generated:
      "Acknowledgement generated",

    stock_complete:
      "Stock complete",

    delivery_planned:
      "Delivery planned",

    manual_delivery_date:
      "Delivery date confirmed",

    fds_planning_allocated:
      "FDS delivery planned",

    pod_available:
      "POD available",

    pod_generated:
      "POD available",

    manual_signed_pod:
      "POD available",

    manual_mark_delivered:
      "Order delivered",

    order_delivered:
      "Order delivered",

    delivered:
      "Order delivered",

    order_cancelled:
      "Order cancelled",

    delivery_issue:
      "Delivery issue reported"
  };

  return (
    labels[type] ||
    order.delivery_status_label ||
    "Order updated"
  );
}


/*
 * Fallback wanneer er geen bruikbare
 * activity-logregel bestaat.
 */

function getVisibleActivityDescription(order, description) {
  const text = cleanText(description);

  // Interne gebruikers zien de originele activiteit
  if (isTenantRole()) {
    return text;
  }

  return text
    .replace(/ACK document generated and uploaded/gi, "Acknowledgement available")
    .replace(/Delivery note generated and uploaded/gi, "Delivery note available")
    .replace(/Delivery labels generated and uploaded/gi, "Delivery labels available")
    .replace(/Invoice generated and uploaded/gi, "Invoice available")
    .replace(/Signed POD PDF uploaded manually/gi, "Proof of Delivery available")
    .replace(/POD uploaded/gi, "Proof of Delivery available");
}

function getOrderFallbackActivity(order) {
  const lifecycle =
    normalize(
      order.derived_lifecycle_status
    );

  if (lifecycle === "delivered") {
    return "Order delivered";
  }

  if (getPodDocumentUrl(order)) {
    return "POD available";
  }

  if (getExpectedDeliveryDate(order)) {
    return (
      `Delivery planned for ` +
      formatDate(
        getExpectedDeliveryDate(order)
      )
    );
  }

  if (
    getDoc(order, "acknowledgement")
  ) {
    return "Acknowledgement generated";
  }

  if (lifecycle === "stock_complete") {
    return "Stock complete";
  }

  return "Order created";
}


/*
 * Zoekt de nieuwste relevante activiteit
 * en zorgt dat datum en omschrijving
 * bij dezelfde activiteit horen.
 */
function getLatestRelevantActivity(order) {
  const activities =
    Array.isArray(order.order_activity_log)
      ? order.order_activity_log
      : [];

  const sortedActivities =
    activities
      .slice()
      .sort((a, b) => {
        const aTime =
          new Date(
            a.created_at || 0
          ).getTime();

        const bTime =
          new Date(
            b.created_at || 0
          ).getTime();

        return bTime - aTime;
      });

  const relevantTypes =
    new Set([
      "order_created",
      "ack_generated",
      "acknowledgement_generated",
      "stock_complete",
      "delivery_planned",
      "manual_delivery_date",
      "fds_planning_allocated",
      "pod_available",
      "pod_generated",
      "manual_signed_pod",
      "manual_mark_delivered",
      "order_delivered",
      "delivered",
      "order_cancelled",
      "delivery_issue"
    ]);

  const relevantActivity =
    sortedActivities.find(activity =>
      relevantTypes.has(
        normalize(
          activity.activity_type
        )
      )
    );

  const latest =
    relevantActivity ||
    sortedActivities[0] ||
    null;

  if (latest) {
    return {
      date:
        latest.created_at ||
        order.last_activity_at ||
        order.created_at,

description:
  getVisibleActivityDescription(
    order,
    latest.description ||
    getLastActivityLabel(
      latest.activity_type,
      order
    )
  )
    };
  }

  return {
    date:
      order.last_activity_at ||
      order.created_at,

    description:
      getOrderFallbackActivity(order)
  };
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
updateProductOwnerColumnVisibility();
updateFinanceHeaderVisibility();
updateOccColumnToggles();
if (!filteredOrders.length) {
  tbody.innerHTML = `
    <tr>
      <td colspan="13">
        No orders found.
      </td>
    </tr>
  `;

  updateSelectionUi();
  setupOrdersTopScrollbar();

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
  <span class="order-ref">
    ${escapeHtml(order.order_number || "—")}
  </span>

  <span class="subline">
    PO: ${escapeHtml(order.purchase_order || "—")}
  </span>

  ${isRetailerRole() ? "" : renderMemoLink(order, 55)}
</td>

<td class="type-cell">
  ${renderCompactOrderType(order)}
</td>

<td class="reference-cell">
  <strong class="ack-ref ${isAckDownloaded(order) ? "ack-ref-downloaded" : ""}">
  ${escapeHtml(order.external_reference || "—")}
</strong>
<span class="subline">
    Supplier / ACK ref
</span>
</td>

         ${
  !isRetailerRole() && !isProductOwnerRole()
    ? `
       <td class="owner-cell product-owner-only">
         ${renderProductOwnerCell(order)}
       </td>
      `
    : ""
}

          <td class="retailer-cell">
            <strong>${escapeHtml(order.retailer_name || "—")}</strong>
            <span class="subline">${escapeHtml(order.retailer_code || "—")}</span>
          </td>

          <td class="ship-to-cell">${escapeHtml(order.ship_to_address || "—")}</td>
          <td class="lifecycle-cell">
  ${renderCompactLifecycle(order)}
</td>
          <td>${renderCompletenessDonut(order)}</td>
          <td>${renderCompactDocuments(order)}</td>
<td class="eta-cell">
  ${renderDeliveryCell(order)}
</td>

${
  shouldShowOccFinanceColumns()
    ? `
        <td class="finance-column">
          ${renderFinanceCell(order)}
        </td>
      `
    : ""
}

<td class="delivery-group-cell">
  ${renderDeliveryGroupCell(order)}
</td>

${
  (() => {
    const latestActivity =
      getLatestRelevantActivity(order);

    return `
      <td class="activity-cell">
        ${escapeHtml(
          formatDateTime(
            latestActivity.date
          )
        )}

        <span
          class="subline"
          title="${escapeHtml(
            latestActivity.description
          )}"
        >
          ${escapeHtml(
            latestActivity.description
          )}
        </span>
      </td>
    `;
  })()
}
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
setupOrdersTopScrollbar();  }

function ensureQualityActionInOccMenu() {
  const menu = byId("occRowActionMenu");

  if (!menu) {
    return;
  }

  /*
   * Als de Quality-knop al bestaat,
   * niets opnieuw toevoegen.
   */
  if (
    menu.querySelector(
      '[data-row-action="quality_case"]'
    )
  ) {
    return;
  }

  /*
   * Maak de knop met dezelfde basisopbouw
   * als de bestaande OCC-menuacties.
   */
  const button =
    document.createElement("button");

  button.type = "button";

  button.setAttribute(
    "data-row-action",
    "quality_case"
  );

  /*
   * Neem indien mogelijk automatisch
   * dezelfde class over als een bestaande
   * actieknop in het menu.
   */
  const existingButton =
    menu.querySelector(
      "[data-row-action]"
    );

  if (existingButton?.className) {
    button.className =
      existingButton.className;
  }

  button.innerHTML = `
    <span>
      Quality / Damage
    </span>

    <span>
      Create / Open
    </span>
  `;

  /*
   * Zet Quality onderaan in het bestaande menu.
   */
  menu.appendChild(button);
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

function openOrderActionMenu(
  orderId,
  button
) {
  /*
   * Zorg eerst dat de Quality-optie
   * in het bestaande menu aanwezig is.
   */
  ensureQualityActionInOccMenu();

  const menu =
    byId("occRowActionMenu");

  if (!menu) {
    showToast(
      "Order action menu not found in HTML.",
      "err"
    );

    return;
  }

  if (!button) {
    showToast(
      "Order action button not found.",
      "err"
    );

    return;
  }

  const order =
    getOrderById(orderId);

  if (!order) {
    showToast(
      "Order not found.",
      "err"
    );

    return;
  }

  const rect =
    button.getBoundingClientRect();

  menu.dataset.orderId =
    String(orderId);

  menu.style.position =
    "fixed";

  menu.style.top =
    `${rect.bottom + 6}px`;

  menu.style.left =
    `${Math.max(
      12,
      rect.right - 230
    )}px`;

  menu.classList.add(
    "open"
  );

  menu.setAttribute(
    "aria-hidden",
    "false"
  );

  /*
   * Quality is vooral bedoeld voor
   * geleverde/historische orders,
   * maar we blokkeren hem hier bewust niet.
   *
   * Daardoor kun je indien nodig ook al
   * tijdens een delivery issue een case maken.
   */
  const qualityButton =
    menu.querySelector(
      '[data-row-action="quality_case"]'
    );

  if (qualityButton) {
    const existingLabel =
      qualityButton.querySelector(
        "span:last-child"
      );

    if (existingLabel) {
      existingLabel.textContent =
        normalize(
          order.derived_lifecycle_status
        ) === "delivered"
          ? "Create / Open"
          : "Create / Open";
    }
  }

  console.log(
    "Order action menu opened",
    {
      orderId,
      orderNumber:
        order.order_number
    }
  );
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

tbody
  .querySelectorAll("[data-manage-stock-priority-line]")
  .forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const orderLineId = button.getAttribute(
        "data-manage-stock-priority-line"
      );

      const orderId = button.getAttribute(
        "data-order-id"
      );

      if (window.StockPriorityTool?.open) {
        window.StockPriorityTool.open({
          orderId,
          orderLineId
        });

        return;
      }

      showToast(
        "Stock Priority Tool is not loaded yet.",
        "err"
      );
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

.status-pill.pickup{
  background:#fef9c3;
  border:1px solid #eab308;
  color:#854d0e;
  font-weight:950;
}

.status-pill.collection{
  background:#ecfeff;
  border:1px solid #67e8f9;
  color:#0e7490;
  font-weight:950;
}

.compact-type-logo.collection{
  background:#0891b2;
  box-shadow:
    0 0 0 3px rgba(8,145,178,.12);
}

.orders-top-scrollbar{
  width:100%;
  height:16px;
  margin:0 0 10px;

  overflow-x:auto;
  overflow-y:hidden;

  background:#eef4fb;

  border:1px solid #d7e3f2;
  border-radius:999px;

  scrollbar-gutter:stable;
}

.orders-top-scrollbar-content{
  height:1px;
  min-width:100%;
}

.orders-top-scrollbar::-webkit-scrollbar{
  height:10px;
}

.orders-top-scrollbar::-webkit-scrollbar-track{
  background:transparent;
  border-radius:999px;
}

.orders-top-scrollbar::-webkit-scrollbar-thumb{
  border-radius:999px;
  border:2px solid #eef4fb;

background:linear-gradient(
    90deg,
    #2b84ff 0%,
    #48b9ff 50%,
    #7be2ff 100%
);

box-shadow:
    0 0 6px rgba(79,195,255,.35);
}

.orders-top-scrollbar::-webkit-scrollbar-thumb:hover{
  background:linear-gradient(
    90deg,
    #0b57e3,
    #25aee8
  );

  box-shadow:
    0 0 7px rgba(18,103,255,.38);
}


/* =========================================
   OCC COMPACT COLUMN CONTROLS
   ========================================= */

.occ-toggle-header{
  vertical-align:top;
}

.occ-column-toggle{
  display:flex;
  align-items:center;
  justify-content:center;

  width:20px;
  height:20px;

  margin:5px auto 0;
  padding:0;

  border:1px solid #cbd5e1;
  border-radius:6px;

  background:#ffffff;
  color:#1267ff;

  font-size:15px;
  font-weight:950;
  line-height:1;

  cursor:pointer;
}

.occ-column-toggle:hover{
  border-color:#1267ff;
  background:#eff6ff;
  color:#074bd1;
}


/* =========================================
   COMPACT TYPE
   ========================================= */

.type-cell{
  text-align:center;
  transition:
    width .15s ease,
    min-width .15s ease;
}

.compact-type-wrap{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:5px;
}

.compact-type-logo{
  display:inline-flex;
  align-items:center;
  justify-content:center;

  width:28px;
  height:28px;
  flex:0 0 28px;

  border-radius:999px;

  color:#ffffff;
  font-size:11px;
  font-weight:950;
  line-height:1;

  box-shadow:
    0 0 0 3px rgba(18,103,255,.10);
}

.compact-type-logo.blue{
  background:#1267ff;
}

.compact-type-logo.purple{
  background:#7c3aed;
}

.compact-type-logo.orange{
  background:#f97316;
}

.compact-type-logo.red{
  background:#dc2626;
}

.compact-type-logo.green{
  background:#16a34a;
}


/*
 * Type is standaard compact.
 */
#ordersTableWrap:not(.type-column-expanded)
.type-cell{
  width:54px;
  min-width:54px;
  max-width:54px;
}


/* =========================================
   COMPACT PRODUCT OWNER
   ========================================= */

.owner-cell{
  transition:
    width .15s ease,
    min-width .15s ease;
}

.compact-owner-wrap{
  display:flex;
  align-items:center;
  justify-content:center;
}

.compact-owner-logo{
  display:inline-flex;
  align-items:center;
  justify-content:center;

  width:34px;
  height:34px;
  flex:0 0 34px;

  border-radius:999px;

  background:
    linear-gradient(
      145deg,
      #52677e,
      #31465d
    );

  border:2px solid #ffffff;

  color:#ffffff;
  font-size:10px;
  font-weight:950;
  letter-spacing:.02em;
  line-height:1;

  box-shadow:
    0 2px 7px rgba(15,23,42,.18);
}

.product-owner-full{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
}


/*
 * Product Owner is standaard compact.
 */
#ordersTableWrap:not(.owner-column-expanded)
.owner-cell{
  width:62px;
  min-width:62px;
  max-width:62px;
  text-align:center;
}


/* =========================================
   COMPACT LIFECYCLE
   ========================================= */

.lifecycle-cell{
  transition:
    width .15s ease,
    min-width .15s ease;
}

.mini-lifecycle-current{
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:28px;
}

.lifecycle-column-compact
.lifecycle-cell{
  width:54px;
  min-width:54px;
  max-width:54px;
  text-align:center;
}


/* Iets hogere kolomkop voor de knoppen eronder */
#ordersTableWrap thead th{
  padding-top:9px;
  padding-bottom:8px;
}

.reference-cell{
  min-width:120px;
  width:120px;
}

.reference-cell .ack-ref{
  white-space:nowrap;
  word-break:normal;
  overflow-wrap:normal;
  display:inline-flex;
}

/* bestaande CSS gaat hieronder verder */

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

.quick-action.pod-downloaded{
  background:#dcfce7 !important;
  border:1px solid #86efac !important;
  color:#166534 !important;
  font-weight:700;
}

.quick-action.pod-downloaded span{
  color:#166534 !important;
  font-weight:700;
}

.quick-action.pod-downloaded span:last-child{
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

.pod-download-dot{
  display:inline-flex;
  width:10px;
  height:10px;
  margin-left:6px;
  vertical-align:middle;
  border-radius:999px;
  background:#2563eb;
  box-shadow:0 0 0 3px rgba(37,99,235,.16);
}

/* ===== STOCK PRIORITY ===== */

.order-type-badges{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:5px;
}

.stock-priority-badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:20px;
  padding:2px 7px;
  border:1px solid transparent;
  border-radius:999px;
  font-size:9px;
  line-height:1;
  font-weight:950;
  letter-spacing:.03em;
  text-transform:uppercase;
  white-space:nowrap;
}

.stock-priority-badge.priority{
  background:#fff7ed;
  border-color:#fdba74;
  color:#9a3412;
}

.stock-priority-badge.critical{
  background:#fef2f2;
  border-color:#fca5a5;
  color:#991b1b;
}

.stock-priority-product-line{
  position:relative;
}

.stock-priority-product-line.has-priority{
  padding:8px;
  border:1px solid #fed7aa;
  border-radius:10px;
  background:#fffbeb;
}

.stock-priority-product-line.has-critical{
  padding:8px;
  border:1px solid #fecaca;
  border-radius:10px;
  background:#fff7f7;
}

.stock-product-title{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
}

.stock-product-dot{
  display:inline-block;
  width:10px;
  height:10px;
  flex:0 0 10px;
  border-radius:999px;
}

.stock-product-dot.complete{
  background:#16a34a;
}

.stock-product-dot.missing{
  background:#ef4444;
}

.stock-priority-waiting{
  color:#c2410c;
  font-weight:850;
}

.stock-priority-fulfilled{
  color:#15803d;
  font-weight:850;
}

.stock-priority-manage-btn{
  margin-top:6px;
  min-height:28px;
  padding:4px 9px;
  border:1px solid #cbd5e1;
  border-radius:8px;
  background:#fff;
  color:#334155;
  font-size:10px;
  font-weight:900;
  cursor:pointer;
}

.stock-priority-manage-btn:hover{
  border-color:#2563eb;
  color:#1d4ed8;
  background:#eff6ff;
}

/* =========================================
   EXPECTED STOCK COMPLETENESS
   ========================================= */

.colli-donut.expected-complete{
  background:#2563eb;
  box-shadow:
    0 0 0 4px rgba(37,99,235,.12);
}

.colli-donut.expected-complete::after{
  display:none;
}

.colli-percent.expected{
  color:#1d4ed8;
  font-weight:950;
}

.colli-expected-date{
  display:block;
  margin-top:2px;
  color:#2563eb;
  font-size:10.5px;
  line-height:1.25;
  font-weight:900;
  white-space:nowrap;
}

.expected-complete-wrap{
  min-width:150px;
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
  const storage = round2(
    toNumber(
      row.querySelector(
        "[data-tariff-field='tariff_storage']"
      )?.value,
      0
    )
  );

  const admin = round2(
    toNumber(
      row.querySelector(
        "[data-tariff-field='tariff_admin']"
      )?.value,
      0
    )
  );

  const handling = round2(
    toNumber(
      row.querySelector(
        "[data-tariff-field='tariff_handling']"
      )?.value,
      0
    )
  );

  const transport = round2(
    toNumber(
      row.querySelector(
        "[data-tariff-field='tariff_transport']"
      )?.value,
      0
    )
  );

  /*
   * Sofa2U fees bestaan uit:
   *
   * - storage
   * - admin
   * - handling
   *
   * Transport valt hier niet onder.
   */
  const s2uFees = round2(
    storage +
    admin +
    handling
  );

  /*
   * De totale klantkosten bestaan uit:
   *
   * - Sofa2U fees
   * - transport
   *
   * Een regionale toeslag wordt hier niet
   * opgeslagen. Die wordt later berekend door
   * de pricing engine op basis van postcode.
   */
  const customerCharge = round2(
    s2uFees +
    transport
  );

  return {
    storage,
    admin,
    handling,
    transport,
    s2uFees,
    customerCharge
  };
}

function refreshTariffModalSummary() {
  const rows = Array.from(
    document.querySelectorAll(
      "#tariffModalBody tr[data-line-id]"
    )
  );

  let totalStorage = 0;
  let totalAdmin = 0;
  let totalHandling = 0;
  let totalTransport = 0;
  let totalS2uFees = 0;
  let totalCustomerCharge = 0;

  rows.forEach(row => {
    const totals =
      tariffModalTotalsFromRow(row);

    totalStorage +=
      totals.storage;

    totalAdmin +=
      totals.admin;

    totalHandling +=
      totals.handling;

    totalTransport +=
      totals.transport;

    totalS2uFees +=
      totals.s2uFees;

    totalCustomerCharge +=
      totals.customerCharge;

    /*
     * Customer charge wordt automatisch
     * berekend uit de andere vier velden.
     *
     * Daardoor kan er geen verschil ontstaan
     * tussen:
     *
     * - Storage
     * - Admin
     * - Handling
     * - Transport
     * - Customer charge
     */
    const customerChargeInput =
      row.querySelector(
        "[data-tariff-field='total_customer_charge']"
      );

    if (customerChargeInput) {
      customerChargeInput.value =
        totals.customerCharge.toFixed(2);

      customerChargeInput.readOnly =
        true;
    }

    const totalCell =
      row.querySelector(
        "[data-line-total]"
      );

    if (totalCell) {
      totalCell.textContent =
        formatMoney(
          totals.customerCharge
        );
    }
  });

  totalStorage =
    round2(totalStorage);

  totalAdmin =
    round2(totalAdmin);

  totalHandling =
    round2(totalHandling);

  totalTransport =
    round2(totalTransport);

  totalS2uFees =
    round2(totalS2uFees);

  totalCustomerCharge =
    round2(totalCustomerCharge);

  const isFreeOfCharge =
    totalCustomerCharge <= 0;

  setText(
    "tariffModalSummary",
    isFreeOfCharge
      ? (
          `Storage: ${formatMoney(totalStorage)} · ` +
          `Admin: ${formatMoney(totalAdmin)} · ` +
          `Handling: ${formatMoney(totalHandling)} · ` +
          `Transport: ${formatMoney(totalTransport)} · ` +
          `Customer charge: ${formatMoney(totalCustomerCharge)} · ` +
          `FREE OF CHARGE`
        )
      : (
          `S2U fees: ${formatMoney(totalS2uFees)} · ` +
          `Transport: ${formatMoney(totalTransport)} · ` +
          `Customer charge total: ${formatMoney(totalCustomerCharge)}`
        )
  );
}

async function saveTariffModal(orderId) {
  const order = allOrders.find(
    row =>
      String(row.id) ===
      String(orderId)
  );

  if (!order) {
    throw new Error(
      "Order not found."
    );
  }

  const rows = Array.from(
    document.querySelectorAll(
      "#tariffModalBody tr[data-line-id]"
    )
  );

  if (!rows.length) {
    throw new Error(
      "No tariff lines found."
    );
  }

  /*
   * Ordertotalen.
   *
   * Deze worden opgebouwd vanuit alle
   * orderregels die in de popup staan.
   */
  let totalStorage = 0;
  let totalAdmin = 0;
  let totalHandling = 0;
  let totalTransport = 0;
  let totalS2uFees = 0;
  let totalCustomerCharge = 0;

  /*
   * Eerst iedere orderregel afzonderlijk
   * bijwerken.
   *
   * Dit is belangrijk omdat:
   *
   * - de ACK-generator order_lines gebruikt;
   * - de invoice-generator order_lines gebruikt;
   * - de OCC order_lines als fallback gebruikt.
   *
   * Alleen het orders-record aanpassen is dus
   * niet voldoende.
   */
  for (const row of rows) {
    const lineId =
      row.dataset.lineId;

    if (!lineId) {
      throw new Error(
        "An order line is missing its line ID."
      );
    }

    const totals =
      tariffModalTotalsFromRow(row);

    const linePayload = {
      tariff_storage:
        round2(
          totals.storage
        ),

      tariff_admin:
        round2(
          totals.admin
        ),

      tariff_handling:
        round2(
          totals.handling
        ),

      tariff_transport:
        round2(
          totals.transport
        ),

      total_s2u_fees:
        round2(
          totals.s2uFees
        ),

      total_customer_charge:
        round2(
          totals.customerCharge
        )
    };

    const {
      error: lineUpdateError
    } = await client
      .from("order_lines")
      .update(linePayload)
      .eq("id", lineId)
      .eq("order_id", order.id);

    if (lineUpdateError) {
      throw new Error(
        `Could not update order line ${lineId}: ` +
        lineUpdateError.message
      );
    }

    totalStorage +=
      linePayload.tariff_storage;

    totalAdmin +=
      linePayload.tariff_admin;

    totalHandling +=
      linePayload.tariff_handling;

    totalTransport +=
      linePayload.tariff_transport;

    totalS2uFees +=
      linePayload.total_s2u_fees;

    totalCustomerCharge +=
      linePayload.total_customer_charge;
  }

  /*
   * Rond de ordertotalen pas af nadat alle
   * orderregels bij elkaar zijn opgeteld.
   */
  totalStorage =
    round2(totalStorage);

  totalAdmin =
    round2(totalAdmin);

  totalHandling =
    round2(totalHandling);

  totalTransport =
    round2(totalTransport);

  totalS2uFees =
    round2(totalS2uFees);

  totalCustomerCharge =
    round2(totalCustomerCharge);

  /*
   * Zodra de totale customer charge £0.00 is,
   * wordt de order automatisch aangemerkt als
   * free of charge.
   *
   * Bij een bedrag boven £0.00 blijft de order
   * chargeable.
   */
  const isChargeable =
    totalCustomerCharge > 0;

  /*
   * Dit zijn de echte kolommen die in jouw
   * orders-tabel bestaan.
   *
   * customer_charge_gbp en
   * estimated_revenue_gbp worden bewust niet
   * meer gebruikt, omdat deze kolommen niet in
   * jouw database bestaan.
   */
  const orderPayload = {
    total_storage_tariff:
      totalStorage,

    total_admin_tariff:
      totalAdmin,

    total_handling_tariff:
      totalHandling,

    total_transport_tariff:
      totalTransport,

    total_s2u_fees:
      totalS2uFees,

    total_customer_charge:
      totalCustomerCharge,

    /*
     * Belangrijk voor ACK, invoice en OCC.
     */
    is_chargeable:
      isChargeable,

    original_chargeable:
      isChargeable,

    copy_chargeable:
      isChargeable,

    /*
     * Leg bij een gratis order duidelijk vast
     * waarom er geen bedrag gefactureerd wordt.
     */
    internal_billing_note:
      isChargeable
        ? null
        : (
            "Free of charge order - " +
            "tariffs manually set to £0.00."
          ),

    /*
     * Na een tariefwijziging moet een eventuele
     * factuur opnieuw worden beoordeeld.
     */
    finance_status:
      "not_invoiced",

    last_activity_at:
      new Date().toISOString()
  };

  /*
   * Sla de ordertotalen en chargeable-status op.
   */
  await safeUpdateOrder(
    order.id,
    orderPayload
  );

  /*
   * Een bestaande ACK bevat mogelijk nog oude
   * tarieven.
   *
   * Daarom wordt alleen de registratie van het
   * gegenereerde acknowledgement verwijderd.
   *
   * Daarna verschijnt in OCC opnieuw de knop
   * Generate.
   */
  const {
    error: ackDeleteError
  } = await client
    .from("order_documents")
    .delete()
    .eq("order_id", order.id)
    .in(
      "document_type",
      [
        "acknowledgement"
      ]
    );

  if (ackDeleteError) {
    console.warn(
      "Old ACK could not be invalidated:",
      ackDeleteError.message
    );
  }

  /*
   * Schrijf een duidelijke activiteit weg.
   */
  const activityDescription =
    `Tariffs updated. ` +
    `Storage ${formatMoney(totalStorage)}, ` +
    `admin ${formatMoney(totalAdmin)}, ` +
    `handling ${formatMoney(totalHandling)}, ` +
    `transport ${formatMoney(totalTransport)}, ` +
    `S2U fees ${formatMoney(totalS2uFees)}, ` +
    `customer charge ${formatMoney(totalCustomerCharge)}. ` +
    (
      isChargeable
        ? "Order remains chargeable. "
        : "Order marked as free of charge. "
    ) +
    `Existing ACK invalidated.`;

  await insertOrderActivity(
    order.id,
    activityDescription,
    "manual_tariff_update"
  );

  /*
   * Sluit de popup.
   */
  document
    .querySelector(
      "#tariffModal"
    )
    ?.remove();

  /*
   * Laad de order opnieuw uit Supabase.
   *
   * Hierdoor worden de nieuwe orderregels,
   * ordertotalen en is_chargeable direct in
   * OCC weergegeven.
   */
  await loadOrders();

  /*
   * Toon een passende melding.
   */
  if (isChargeable) {
    showToast(
      `Tariffs saved: ` +
      `${formatMoney(totalCustomerCharge)}. ` +
      `Please generate a new ACK.`,
      "ok"
    );

    return;
  }

  showToast(
    `Tariffs saved at £0.00. ` +
    `Order marked as free of charge. ` +
    `Please generate a new ACK.`,
    "ok"
  );
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

async function moveDeliveredOrderStockToOutbound(orderId) {
  if (!orderId) {
    throw new Error(
      "Order ID missing."
    );
  }

  const db =
    ensureClient();

  const cid =
    await getCompanyId();

  const shippedAt =
    new Date()
      .toISOString();


  // ==========================================================
  // 1. ORDER LINES
  // ==========================================================

  const {
    data: orderLines,
    error: orderLinesError
  } =
    await db
      .from("order_lines")
      .select("id")
      .eq(
        "order_id",
        orderId
      );


  if (orderLinesError) {
    throw new Error(
      `Order lines could not be loaded: ${orderLinesError.message}`
    );
  }


  const orderLineIds =
    (orderLines || [])
      .map(row =>
        row.id
      )
      .filter(Boolean);


  // ==========================================================
  // 2. ALLOCATIONS
  // ==========================================================

  let allocations = [];


  if (orderLineIds.length) {
    const {
      data,
      error
    } =
      await db
        .from("order_allocations")
        .select(`
          id,
          item_id,
          stock_set_id,
          allocation_status
        `)
        .in(
          "order_line_id",
          orderLineIds
        )
        .neq(
          "allocation_status",
          "cancelled"
        );


    if (error) {
      throw new Error(
        `Allocations could not be loaded: ${error.message}`
      );
    }


    allocations =
      data || [];
  }


  const allocationIds =
    [
      ...new Set(
        allocations
          .map(row =>
            row.id
          )
          .filter(Boolean)
      )
    ];


  const allocationItemIds =
    [
      ...new Set(
        allocations
          .map(row =>
            row.item_id
          )
          .filter(Boolean)
      )
    ];


  const stockSetIds =
    [
      ...new Set(
        allocations
          .map(row =>
            row.stock_set_id
          )
          .filter(Boolean)
      )
    ];


  // ==========================================================
  // 3. DIRECTLY LINKED ITEMS
  //
  // Dit is de belangrijke reparatie.
  //
  // Ook packages zonder order_allocation moeten
  // worden afgeboekt wanneer linked_order_id naar
  // deze delivered order verwijst.
  // ==========================================================

  const {
    data: linkedItems,
    error: linkedItemsError
  } =
    await db
      .from("items")
      .select(`
        id,
        status,
        linked_order_id,
        physical_product_id,
        stock_set_id,
        package_no,
        package_total
      `)
      .eq(
        "company_id",
        cid
      )
      .eq(
        "linked_order_id",
        orderId
      )
      .in(
        "status",
        [
          "in_stock",
          "reserved",
          "picked",
          "loaded"
        ]
      );


  if (linkedItemsError) {
    throw new Error(
      `Linked stock items could not be loaded: ${linkedItemsError.message}`
    );
  }


  const linkedItemIds =
    (linkedItems || [])
      .map(row =>
        row.id
      )
      .filter(Boolean);


  // ==========================================================
  // 4. COMBINE DIRECT ITEM IDs
  // ==========================================================

  const directItemIds =
    [
      ...new Set([
        ...allocationItemIds,
        ...linkedItemIds
      ])
    ];


  let updatedItemIds = [];


  // ==========================================================
  // 5. SHIP DIRECT ITEMS
  // ==========================================================

  if (directItemIds.length) {
    const {
      data: updatedItems,
      error: itemUpdateError
    } =
      await db
        .from("items")
        .update({
          status:
            "shipped",

          shipped_at:
            shippedAt,

          reserved_at:
            null
        })
        .eq(
          "company_id",
          cid
        )
        .in(
          "id",
          directItemIds
        )
        .select(`
          id,
          status,
          shipped_at
        `);


    if (itemUpdateError) {
      throw new Error(
        `Items could not be marked shipped: ${itemUpdateError.message}`
      );
    }


    updatedItemIds.push(
      ...(updatedItems || [])
        .map(row =>
          row.id
        )
    );
  }


  // ==========================================================
  // 6. STOCK SET ITEMS
  //
  // Allocations die via stock_set_id lopen blijven ook
  // ondersteund.
  // ==========================================================

  if (stockSetIds.length) {
    const {
      data: updatedStockSetItems,
      error: stockSetItemsError
    } =
      await db
        .from("items")
        .update({
          status:
            "shipped",

          shipped_at:
            shippedAt,

          reserved_at:
            null
        })
        .eq(
          "company_id",
          cid
        )
        .in(
          "stock_set_id",
          stockSetIds
        )
        .in(
          "status",
          [
            "in_stock",
            "reserved",
            "picked",
            "loaded"
          ]
        )
        .select("id");


    if (stockSetItemsError) {
      throw new Error(
        `Stock-set items could not be marked shipped: ${stockSetItemsError.message}`
      );
    }


    updatedItemIds.push(
      ...(updatedStockSetItems || [])
        .map(row =>
          row.id
        )
    );
  }


  // ==========================================================
  // 7. COMPLETE ALLOCATIONS
  // ==========================================================

  if (allocationIds.length) {
    const {
      error: allocationUpdateError
    } =
      await db
        .from("order_allocations")
        .update({
          allocation_status:
            "shipped"
        })
        .in(
          "id",
          allocationIds
        );


    if (allocationUpdateError) {
      throw new Error(
        `Allocations could not be marked shipped: ${allocationUpdateError.message}`
      );
    }
  }


  updatedItemIds =
    [
      ...new Set(
        updatedItemIds
      )
    ];


  console.log(
    "OUTBOUND completed:",
    {
      orderId,

      allocationIds,

      allocationItemIds,

      linkedItemIds,

      stockSetIds,

      updatedItemIds
    }
  );


  return {
    allocationsUpdated:
      allocationIds.length,

    itemsUpdated:
      updatedItemIds.length
  };
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

  const confirmedDate =
    byId("manualConfirmedDate")?.value || "";

  const etaFrom =
    byId("manualEtaFrom")?.value || "";

  const etaTo =
    byId("manualEtaTo")?.value || "";

  if (!confirmedDate) {
    throw new Error(
      "Choose a confirmed delivery date first."
    );
  }

  const isPickupOrder =
    isWarehousePickupOrder(order);

  const isCharterOrder =
    !isPickupOrder &&
    (
      normalize(order.transport_type) === "charter" ||
      normalize(order.transport_type) === "fds" ||
      normalize(order.status) === "export_for_charter" ||
      !!order.fds_collection_week ||
      !!order.fds_collection_date ||
      !!order.fds_job_ref
    );
  const payload = {
    confirmed_delivery_date: confirmedDate,
    expected_delivery_date: confirmedDate,
    transport_status: "planned",
    overall_status: "planned",
    last_activity_at: new Date().toISOString()
  };

  if (isPickupOrder) {
    payload.transport_type = "warehouse_pickup";
    payload.status = "pickup_confirmed";
    payload.transport_status = "pickup_confirmed";
    payload.overall_status = "pickup_confirmed";
  } else if (isCharterOrder) {
    payload.transport_type = "charter";
    payload.status = "export_for_charter";
  } else {
    payload.status = "planned";
  }

  if (etaFrom) {
    payload.delivery_eta_from = etaFrom;
  }

  if (etaTo) {
    payload.delivery_eta_to = etaTo;
  }

  if (etaFrom || etaTo) {
    payload.delivery_eta_status = "confirmed";
  }

  try {
    await safeUpdateOrder(order.id, payload);
  } catch (error) {
    delete payload.delivery_eta_from;
    delete payload.delivery_eta_to;
    delete payload.delivery_eta_status;

    await safeUpdateOrder(order.id, payload);
  }

  await insertOrderActivity(
    order.id,
    `Confirmed delivery date set manually to ${confirmedDate}` +
      `${etaFrom ? `, ETA ${etaFrom}${etaTo ? ` - ${etaTo}` : ""}` : ""}` +
            `${
        isPickupOrder
          ? ". Warehouse pickup assignment retained"
          : isCharterOrder
            ? ". FDS / charter assignment retained"
            : ""
      }.`,
    "manual_delivery_date"
  );

  await loadOrders();

  showToast(
    isPickupOrder
      ? "Pickup date saved. Warehouse pickup assignment retained."
      : isCharterOrder
        ? "Confirmed delivery date saved. FDS assignment retained."
        : "Confirmed delivery date saved. Lifecycle moved to Planned / Transport.",
    "ok"
  );}

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

  const deliveredTo =
    byId("manualDeliveredTo")?.value || "";

  const notes =
    byId("manualDeliveryNotes")?.value || "";

  const now =
    new Date().toISOString();

  const today =
    now.slice(0, 10);

  const payload = {
    status: "delivered",
    transport_status: "delivered",
    warehouse_status: "delivered",
    overall_status: "delivered",

    confirmed_delivery_date:
      order.confirmed_delivery_date ||
      today,

    pod_status: "signed",
    pod_signed_at: now,
    last_activity_at: now
  };

  if (deliveredTo) {
    payload.pod_signed_by =
      deliveredTo;
  }

  /*
   * Eerst de voorraad uitboeken.
   *
   * Wanneer dit mislukt, wordt de order niet
   * alsnog op delivered gezet.
   */
  const outboundResult =
    await moveDeliveredOrderStockToOutbound(
      order.id
    );

  /*
   * Daarna pas de orderstatus op delivered.
   */
  await safeUpdateOrder(
    order.id,
    payload
  );

  await insertOrderActivity(
    order.id,

    `Order marked delivered manually by Sofa2U` +
    `${
      deliveredTo
        ? `, received by ${deliveredTo}`
        : ""
    }.` +
    `${
      notes
        ? ` Notes: ${notes}`
        : ""
    } ` +
    `${outboundResult.allocationsUpdated} allocation(s) closed and ` +
    `${outboundResult.itemsUpdated} stock package(s) moved to Outbound History.`,

    "manual_mark_delivered"
  );

  closeManualOpsModal();

  await loadOrders();

  showToast(
    `Order marked delivered. ` +
    `${outboundResult.itemsUpdated} stock package(s) moved to Outbound History.`,
    "ok"
  );
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
    const orderNumber = cleanText(
      order?.order_number || ""
    ).toUpperCase();

    if (!orderNumber) return;

    map.set(orderNumber, order);
  });

  return map;
}

function getExistingCollectionData(order) {
  const collectionDate =
    order?.fds_collection_date ||
    order?.planned_route_date ||
    null;

  const collectionWeek =
    Math.round(
      toNumber(order?.fds_collection_week, 0)
    ) ||
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

if (
  row.status === "allocated" &&
  !plannedStart?.date
) {

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

  byId("occRowActionMenu")?.addEventListener(
  "click",
  event => {
    const button =
      event.target.closest(
        "[data-row-action]"
      );

    if (!button) {
      return;
    }

    const action =
      button.getAttribute(
        "data-row-action"
      );

    const orderId =
      byId(
        "occRowActionMenu"
      )?.dataset.orderId || "";

    /*
     * Eerst menu sluiten.
     */
    closeOrderActionMenu();

    if (!orderId) {
      showToast(
        "Order ID is missing.",
        "err"
      );

      return;
    }


    /* =====================================
       QUALITY / DAMAGE
       ===================================== */

    if (
      action ===
      "quality_case"
    ) {
      window.location.href =
        `/quality.html?order_id=${encodeURIComponent(
          orderId
        )}`;

      return;
    }


    /* =====================================
       BESTAANDE OCC-ACTIES
       ===================================== */

    if (
      action ===
      "manual_pod"
    ) {
      openManualOpsModal(
        orderId
      );

      return;
    }


    if (
      action ===
      "finance_tariffs"
    ) {
      openTariffModal(
        orderId
      );

      return;
    }


    if (
      action ===
      "edit_order"
    ) {
      if (
        window.OrderEditor?.open
      ) {
        window.OrderEditor.open(
          orderId
        );

        return;
      }

      showToast(
        "Order editor is not loaded.",
        "err"
      );

      return;
    }


    if (
      action ===
      "copy_order"
    ) {
      if (
        window.CopyOrderTool?.open
      ) {
        window.CopyOrderTool.open(
          orderId
        );

        return;
      }

      showToast(
        "Copy Order Tool is not loaded.",
        "err"
      );

      return;
    }


    if (
      action ===
      "credit_order"
    ) {
      if (
        window.CreditOrderTool?.open
      ) {
        window.CreditOrderTool.open(
          orderId
        );

        return;
      }

      showToast(
        "Credit Order Tool is not loaded.",
        "err"
      );

      return;
    }


    if (
      action ===
      "change_status"
    ) {
      if (
        window.ChangeStatusTool?.open
      ) {
        window.ChangeStatusTool.open(
          orderId
        );

        return;
      }

      showToast(
        "Change Status Tool is not loaded.",
        "err"
      );

      return;
    }


    if (
      action ===
      "view_activity"
    ) {
      if (
        window.ActivityViewTool?.open
      ) {
        window.ActivityViewTool.open(
          orderId
        );

        return;
      }

      showToast(
        "Activity View Tool is not loaded.",
        "err"
      );

      return;
    }


    if (
      action ===
      "warehouse_events"
    ) {
      if (
        window.WarehouseEventsTool?.open
      ) {
        window.WarehouseEventsTool.open(
          orderId
        );

        return;
      }

      showToast(
        "Warehouse Events Tool is not loaded.",
        "err"
      );

      return;
    }


    if (
      action ===
      "portal_events"
    ) {
      if (
        window.PortalEventsTool?.open
      ) {
        window.PortalEventsTool.open(
          orderId
        );

        return;
      }

      showToast(
        "Portal Events Tool is not loaded.",
        "err"
      );

      return;
    }


    showToast(
      `${action} is not connected yet.`,
      "ok"
    );
  }
);


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