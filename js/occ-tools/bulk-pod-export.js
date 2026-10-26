
/* ============================================================
   VEYNOR — BULK SIGNED POD EXPORT
   Part 1/3 — Configuration, authentication and input
   ============================================================ */

(function () {
  "use strict";

  if (window.__VeynorBulkPodExportLoaded) return;
  window.__VeynorBulkPodExportLoaded = true;


const CONFIG = Object.freeze({
  documentTypes: {
    pod: {
      documentType: "pod",
      documentStatus: "signed",
      label: "Signed PODs",
      shortName: "POD",
      defaultBucket: "pod-assets",
      filePrefix: "Veynor-Signed-PODs"
    },
    delivery_note: {
      documentType: "delivery_note",
      documentStatus: "generated",
      label: "Delivery Notes",
      shortName: "DN",
      defaultBucket: null,
      filePrefix: "Veynor-Delivery-Notes"
    }
  },
  maxOrders: 500,
  queryChunkSize: 75,
  downloadConcurrency: 4,
  maxFileBytes: 30 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024
});

const IDS = Object.freeze({
  panel: "bulkPodPanel",
  toggle: "bulkPodToggle",
  input: "bulkPodOrderNumbers",
  type: "bulkDocumentType",
  check: "bulkPodCheckBtn",
  download: "bulkPodDownloadBtn",
  clear: "bulkPodClearBtn",
  count: "bulkPodInputCount",
  status: "bulkPodStatus",
  progress: "bulkPodProgress",
  results: "bulkPodResults"
});

  const state = {
    client: null,
    companyId: null,
    profile: null,
    busy: false,
    inputKey: "",
    checked: false,
    rows: [],
    documents: [],
    statistics: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }


function getSelectedDocumentType() {
  const value = el(IDS.type)?.value || "pod";

  if (!Object.prototype.hasOwnProperty.call(
    CONFIG.documentTypes,
    value
  )) {
    throw new Error("Invalid document type selected.");
  }

  return value;
}

function getDocumentConfig() {
  return CONFIG.documentTypes[getSelectedDocumentType()];
}


  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char])
    );
  }

  function getClient() {
    if (state.client) return state.client;

    if (typeof window.sb !== "function") {
      throw new Error("Supabase client is unavailable.");
    }

    state.client = window.sb();
    return state.client;
  }

  function getZipLibrary() {
    if (typeof window.JSZip !== "function") {
      throw new Error(
        "JSZip is not loaded. Check the OCC HTML script."
      );
    }

    return window.JSZip;
  }

  function setStatus(message, type = "info") {
    const target = el(IDS.status);
    if (!target) return;

    target.textContent = message || "";
    target.dataset.status = type;
    target.style.display = message ? "block" : "none";
  }

  function setProgress(current, total, label = "") {
    const target = el(IDS.progress);
    if (!target) return;

    const percent = total > 0
      ? Math.round((current / total) * 100)
      : 0;

    target.textContent = label
      ? `${label} — ${percent}% (${current}/${total})`
      : `${percent}%`;

    target.style.display = "block";
  }

  
function setBusy(busy) {
  state.busy = Boolean(busy);

  [
    IDS.check,
    IDS.download,
    IDS.clear,
    IDS.input,
    IDS.type
  ].forEach(id => {
    const target = el(id);

    if (target) {
      target.disabled = state.busy;
    }
  });

  updateButtons();
}


  function updateButtons() {
    const count = parseOrderNumbers(
      el(IDS.input)?.value || ""
    ).numbers.length;

    const checkButton = el(IDS.check);
    const downloadButton = el(IDS.download);

    if (checkButton) {
      checkButton.disabled =
        state.busy || count === 0;
    }

    if (downloadButton) {
      downloadButton.disabled =
        state.busy ||
        !state.checked ||
        !state.documents.length ||
        state.inputKey !== getInputKey();
    }
  }

 
function parseOrderNumbers(input) {
  const raw = String(input ?? "").toUpperCase();

  // Find SO numbers anywhere in the pasted text.
  // Accept SO-03709, SO 03709 and SO03709.
  const matches = [
    ...raw.matchAll(/\bSO[\s-]*(\d{5,})\b/g)
  ];

  const numbers = [];
  const duplicates = [];
  const seen = new Set();

  for (const match of matches) {
    const number = `SO-${match[1]}`;

    if (seen.has(number)) {
      duplicates.push(number);
      continue;
    }

    seen.add(number);
    numbers.push(number);
  }

  return {
    numbers,
    duplicates,
    invalid: []
  };
}



function getInputKey() {
  const parsed = parseOrderNumbers(
    el(IDS.input)?.value || ""
  );

  return JSON.stringify({
    documentType: getSelectedDocumentType(),
    numbers: parsed.numbers,
    duplicates: parsed.duplicates,
    invalid: parsed.invalid
  });
}


  function updateInputCount() {
    const parsed = parseOrderNumbers(
      el(IDS.input)?.value || ""
    );

    const target = el(IDS.count);

    if (target) {
      target.textContent =
        `${parsed.numbers.length} unique SO numbers` +
        (parsed.duplicates.length
          ? ` · ${parsed.duplicates.length} duplicates`
          : "") +
        (parsed.invalid.length
          ? ` · ${parsed.invalid.length} invalid`
          : "");
    }

    if (state.inputKey !== getInputKey()) {
      state.checked = false;
      state.rows = [];
      state.documents = [];
      state.statistics = null;

      const results = el(IDS.results);
      if (results) results.innerHTML = "";
    }

    updateButtons();
  }

  async function getActiveCompanyId() {
    if (
      !window.VeynorTenant ||
      typeof window.VeynorTenant.getActiveCompanyId
        !== "function"
    ) {
      throw new Error(
        "Central tenant context is unavailable."
      );
    }

    const companyId =
      await window.VeynorTenant.getActiveCompanyId();

    if (!companyId) {
      throw new Error("No active tenant selected.");
    }

    return companyId;
  }

 
async function verifyAccess(options = {}) {
  const db = getClient();

  const { data: auth, error: authError } =
    await db.auth.getUser();

  if (authError) throw authError;

  const userId = auth?.user?.id;

  if (!userId) {
    throw new Error("You are not authenticated.");
  }

  const { data: profiles, error: profileError } =
    await db
      .from("user_profiles")
      .select(
        "id, auth_user_id, company_id, role, is_active"
      )
      .eq("auth_user_id", userId)
      .eq("is_active", true)
      .limit(2);

  if (profileError) throw profileError;

  if (!profiles || profiles.length !== 1) {
    throw new Error(
      "A unique active user profile is required."
    );
  }

  const profile = profiles[0];
  const role = normalize(profile.role);

  const allowedRoles = [
    "veynor_admin",
    "tenant_admin",
    "tenant_user"
  ];

  if (!allowedRoles.includes(role)) {
    throw new Error(
      "Your role is not authorised for bulk POD export."
    );
  }

  const companyId = await getActiveCompanyId();

  if (
    role !== "veynor_admin" &&
    String(profile.company_id) !== String(companyId)
  ) {
    throw new Error(
      "Your profile does not belong to this tenant."
    );
  }

  // When downloading, the previously checked tenant
  // must still match the currently active tenant.
  if (options.requireCheckedTenant === true) {
    if (
      !state.companyId ||
      String(state.companyId) !== String(companyId)
    ) {
      throw new Error(
        "Tenant changed. Please check the SO numbers again."
      );
    }

    if (
      !state.profile ||
      String(state.profile.id) !== String(profile.id)
    ) {
      throw new Error(
        "User profile changed. Please check the orders again."
      );
    }

  } else if (
    state.companyId &&
    String(state.companyId) !== String(companyId)
  ) {
    // A new availability check may use another tenant.
    resetResults();
  }

  state.companyId = companyId;
  state.profile = profile;

  return { db, companyId, profile };
}


  async function confirmTenant(companyId) {
    const active = await getActiveCompanyId();

    if (String(active) !== String(companyId)) {
      throw new Error(
        "Active tenant changed. Export cancelled."
      );
    }
  }

  function resetResults() {
    state.checked = false;
    state.rows = [];
    state.documents = [];
    state.statistics = null;
    state.inputKey = "";

    const results = el(IDS.results);
    if (results) results.innerHTML = "";

    updateButtons();
  }

  function chunkArray(array, size) {
    const result = [];

    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }

    return result;
  }

  function safeFileName(value) {
    return clean(value)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
  }

  function timestamp(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  /* END PART 1 — CONTINUE WITH PART 2 */


/* ============================================================
   VEYNOR — BULK SIGNED POD EXPORT
   Part 2/3 — Order lookup, signed POD discovery and preview

   Database:
   - public.orders
   - public.order_documents

   Only export:
   document_type = 'pod'
   document_status = 'signed'

   READ-ONLY: No database modifications.
   ============================================================ */


/* ============================================================
   1. FIND ORDERS BY SALES ORDER NUMBER
   ============================================================ */

async function findOrdersByNumbers(
  db,
  companyId,
  orderNumbers
) {
  if (!Array.isArray(orderNumbers) || !orderNumbers.length) {
    return [];
  }

  const foundOrders = [];

  const chunks = chunkArray(
    orderNumbers,
    CONFIG.queryChunkSize
  );

  for (const part of chunks) {
    await confirmTenant(companyId);

    const { data, error } = await db
      .from("orders")
      .select(`
        id,
        company_id,
        order_number
      `)
      .eq("company_id", companyId)
      .in("order_number", part);

    if (error) {
      throw new Error(
        `Unable to retrieve orders: ${error.message}`
      );
    }

    foundOrders.push(...(data || []));
  }

  await confirmTenant(companyId);

  return foundOrders;
}


/* ============================================================
   2. FIND SIGNED POD DOCUMENTS
   ============================================================ */


async function findSignedPodDocuments(
  db,
  companyId,
  orderIds
) {
  if (!Array.isArray(orderIds) || !orderIds.length) {
    return [];
  }

  const config = getDocumentConfig();
  const documents = [];

  const chunks = chunkArray(
    orderIds,
    CONFIG.queryChunkSize
  );

  for (const part of chunks) {
    await confirmTenant(companyId);

    const { data, error } = await db
      .from("order_documents")
      .select(`
        id,
        company_id,
        order_id,
        document_type,
        document_status,
        document_number,
        file_url,
        storage_path,
        created_at,
        updated_at
      `)
      .eq("company_id", companyId)
      .eq("document_type", config.documentType)
      .eq("document_status", config.documentStatus)
      .in("order_id", part);

    if (error) {
      throw new Error(
        `Unable to retrieve ${config.label}: ${error.message}`
      );
    }

    documents.push(...(data || []));
  }

  await confirmTenant(companyId);

  return documents;
}


/* ============================================================
   3. SELECT MOST RECENT SIGNED POD PER ORDER

   Multiple POD records can exist for one order.

   Select the newest signed POD that has a file reference.
   If none has a file reference, retain the newest record
   so it can be reported as missing.
   ============================================================ */

function selectLatestSignedPod(documents) {
  const grouped = new Map();

  for (const document of documents || []) {
    if (!document?.order_id) continue;

    const key = String(document.order_id);

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(document);
  }

  const selected = new Map();

  for (const [orderId, records] of grouped.entries()) {
    const sorted = [...records].sort((a, b) => {
      const dateA = timestamp(
        a.updated_at || a.created_at
      );

      const dateB = timestamp(
        b.updated_at || b.created_at
      );

      return dateB - dateA;
    });

    const preferred = sorted.find(document =>
      clean(document.storage_path) ||
      clean(document.file_url)
    );

    selected.set(
      orderId,
      preferred || sorted[0]
    );
  }

  return selected;
}


/* ============================================================
   4. BUILD ORDER / POD MATCH RESULTS
   ============================================================ */


function buildPodResults(
  requestedNumbers,
  orders,
  documents
) {
  const config = getDocumentConfig();
  const ordersByNumber = new Map();

  for (const order of orders || []) {
    const number = clean(order.order_number).toUpperCase();

    if (!number) continue;

    if (!ordersByNumber.has(number)) {
      ordersByNumber.set(number, []);
    }

    ordersByNumber.get(number).push(order);
  }

  const latestDocuments = selectLatestSignedPod(documents);
  const results = [];

  for (const orderNumber of requestedNumbers) {
    const matchingOrders =
      ordersByNumber.get(orderNumber) || [];

    if (!matchingOrders.length) {
      results.push({
        orderNumber,
        orderId: null,
        document: null,
        status: "order_not_found",
        message: "Sales Order not found"
      });
      continue;
    }

    if (matchingOrders.length > 1) {
      results.push({
        orderNumber,
        orderId: null,
        document: null,
        status: "duplicate_order",
        message: "Multiple orders have this SO number"
      });
      continue;
    }

    const order = matchingOrders[0];

    const document =
      latestDocuments.get(String(order.id)) || null;

    if (!document) {
      results.push({
        orderNumber,
        orderId: order.id,
        document: null,
        status: "pod_missing",
        message: `No ${config.label} document registered`
      });
      continue;
    }

    if (
      !clean(document.storage_path) &&
      !clean(document.file_url)
    ) {
      results.push({
        orderNumber,
        orderId: order.id,
        document,
        status: "file_missing",
        message: `${config.label}: file reference missing`
      });
      continue;
    }

    results.push({
      orderNumber,
      orderId: order.id,
      document,
      status: "ready",
      message: `${config.label} document found`
    });
  }

  return results;
}


/* ============================================================
   5. CALCULATE PREVIEW STATISTICS
   ============================================================ */

function calculatePodStatistics(rows) {
  const result = {
    requested: rows.length,
    ready: 0,
    missing: 0,
    notFound: 0,
    duplicate: 0
  };

  for (const row of rows) {
    switch (row.status) {
      case "ready":
        result.ready += 1;
        break;

      case "order_not_found":
        result.notFound += 1;
        break;

      case "duplicate_order":
        result.duplicate += 1;
        break;

      default:
        result.missing += 1;
        break;
    }
  }

  return result;
}


/* ============================================================
   6. RENDER PREVIEW RESULTS

   Shows:
   - Number of SO numbers
   - Signed PODs found
   - Missing PODs
   - Orders not found
   - Duplicate order references

   No PDF files are downloaded during this check.
   ============================================================ */


function renderPodPreview() {
  const target = el(IDS.results);
  if (!target) return;

  const rows = state.rows || [];
  const stats = state.statistics;
  const config = getDocumentConfig();

  if (!stats) {
    target.innerHTML = "";
    return;
  }

  const summary = [
    ["SO Numbers", stats.requested],
    [`${config.label} Found`, stats.ready],
    ["Missing Documents", stats.missing],
    ["Orders Not Found", stats.notFound],
    ["Duplicate Orders", stats.duplicate]
  ];

  const summaryHtml = `
    <div class="bulk-pod-summary" style="
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(115px,1fr));
      gap:10px;
      margin-bottom:14px;
    ">
      ${summary.map(([label, value]) => `
        <div class="occ-modal-section">
          <strong>${value}</strong>
          <span class="subline">${escapeHtml(label)}</span>
        </div>
      `).join("")}
    </div>
  `;

  const rowsHtml = rows.map(row => {
    const available = row.status === "ready";

    return `
      <tr>
        <td>
          <strong>${escapeHtml(row.orderNumber)}</strong>
        </td>
        <td>
          <span style="
            color:${available ? "#15803d" : "#b45309"};
            font-weight:800;
          ">
            ${escapeHtml(row.message)}
          </span>
        </td>
        <td>
          ${escapeHtml(
            row.document?.document_number || "—"
          )}
        </td>
      </tr>
    `;
  }).join("");

  target.innerHTML = `
    ${summaryHtml}
    <div class="table-wrap"
         style="max-height:320px;overflow:auto;">
      <table class="occ-table"
             style="min-width:0;width:100%;">
        <thead>
          <tr>
            <th>Sales Order</th>
            <th>Document Status</th>
            <th>Document</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="occ-help" style="margin-top:10px;">
      Database records checked. Actual PDF availability
      is verified during download.
    </p>
  `;
}


/* ============================================================
   7. CHECK SIGNED POD AVAILABILITY

   This function:
   - Parses the entered SO numbers
   - Checks active tenant and user permissions
   - Searches orders
   - Searches signed POD records
   - Builds preview
   - Enables ZIP download if documents are found

   No database writes.
   No document generation.
   ============================================================ */


async function checkBulkPodAvailability() {
  if (state.busy) return;

  const parsed = parseOrderNumbers(
    el(IDS.input)?.value || ""
  );

  const config = getDocumentConfig();

  if (!parsed.numbers.length) {
    setStatus("Enter at least one SO number.", "error");
    return;
  }

  if (parsed.numbers.length > CONFIG.maxOrders) {
    setStatus(
      `Maximum ${CONFIG.maxOrders} orders per export.`,
      "error"
    );
    return;
  }

  setBusy(true);
  resetResults();

  try {
    setStatus(
      `Checking ${config.label}...`,
      "info"
    );

    setProgress(0, 3, "Checking documents");

    const { db, companyId } = await verifyAccess();

    setProgress(1, 3, "Finding orders");

    const orders = await findOrdersByNumbers(
      db,
      companyId,
      parsed.numbers
    );

    const orderIds = orders
      .map(order => order.id)
      .filter(Boolean);

    setProgress(2, 3, `Finding ${config.label}`);

    const documents = await findSignedPodDocuments(
      db,
      companyId,
      orderIds
    );

    await confirmTenant(companyId);

    if (getSelectedDocumentType() !== config.documentType) {
      throw new Error(
        "Document type changed. Please check again."
      );
    }

    const results = buildPodResults(
      parsed.numbers,
      orders,
      documents
    );

    const statistics = calculatePodStatistics(results);

    state.rows = results;
    state.documents = results.filter(
      row => row.status === "ready"
    );
    state.statistics = statistics;
    state.inputKey = getInputKey();
    state.checked = true;

    renderPodPreview();
    setProgress(3, 3, "Check completed");

    setStatus(
      statistics.ready
        ? `${statistics.ready} ${config.label} document(s) found. Ready for ZIP download.`
        : `No ${config.label} documents found.`,
      statistics.ready ? "success" : "warning"
    );

  } catch (error) {
    console.error("[Bulk Document Export]", error);
    resetResults();

    setStatus(
      error.message || "Document check failed.",
      "error"
    );
  } finally {
    setBusy(false);
  }
}


/* ============================================================
   END PART 2

   Continue directly with PART 3:
   - Secure PDF retrieval
   - ZIP creation
   - Missing POD CSV report
   - Download handling
   - Event listeners and initialization

   Do not close the main IIFE here.
   ============================================================ */


/* ============================================================
   VEYNOR — BULK SIGNED POD EXPORT
   Part 3/3 — Secure downloads, ZIP and initialization

   READ-ONLY:
   - No database writes
   - No document generation
   - No status changes
   - No changes to existing POD files
   ============================================================ */


/* ============================================================
   1. STORAGE PATH HELPERS
   ============================================================ */

function getSupabaseOrigin(db) {
  const configured =
    clean(db?.supabaseUrl) ||
    clean(window.SUPABASE_URL);

  if (!configured) {
    throw new Error(
      "Supabase project URL is unavailable."
    );
  }

  return new URL(configured).origin;
}


function parseStorageReference(db, document) {
  const config = getDocumentConfig();
  const rawPath = clean(document?.storage_path);
  const rawUrl = clean(document?.file_url);
  const origin = getSupabaseOrigin(db);

  function validPath(path) {
    return Boolean(
      path &&
      !path.startsWith("/") &&
      !path.split("/").includes("..") &&
      !path.includes("\\")
    );
  }

  // Prefer the explicit bucket and path in file_url.
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);

      if (url.origin === origin) {
        const match = url.pathname.match(
          /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/
        );

        if (match) {
          const bucket = decodeURIComponent(match[1]);
          const path = match[2]
            .split("/")
            .map(part => decodeURIComponent(part))
            .join("/");

          if (bucket && validPath(path)) {
            return { bucket, path };
          }
        }
      }
    } catch (error) {
      console.warn(
        "[Bulk Document Export] Invalid file URL:",
        error
      );
    }
  }

  // Fallback to relative storage_path only when
  // the bucket is explicitly known for this type.
  if (rawPath && config.defaultBucket) {
    let path = rawPath.replace(/^\/+/, "");
    const prefix = `${config.defaultBucket}/`;

    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
    }

    if (validPath(path)) {
      return {
        bucket: config.defaultBucket,
        path
      };
    }
  }

  return null;
}


/* ============================================================
   2. DOWNLOAD ONE SIGNED POD

   Uses the authenticated Supabase Storage client.

   The browser does not receive a service-role key.
   ============================================================ */


async function downloadSignedPod(db, document) {
  const config = getDocumentConfig();

  if (
    document?.document_type !== config.documentType ||
    document?.document_status !== config.documentStatus
  ) {
    throw new Error(
      "Document type or status does not match selection."
    );
  }

  const reference = parseStorageReference(db, document);

  if (!reference) {
    throw new Error(
      "No valid Supabase Storage reference found."
    );
  }

  const { data, error } = await db.storage
    .from(reference.bucket)
    .download(reference.path);

  if (error) {
    throw new Error(
      `Storage download failed: ${error.message}`
    );
  }

  if (!(data instanceof Blob) || data.size === 0) {
    throw new Error("Document is empty or invalid.");
  }

  if (data.size > CONFIG.maxFileBytes) {
    throw new Error(
      "Document exceeds maximum file size."
    );
  }

  const header = new Uint8Array(
    await data.slice(0, 5).arrayBuffer()
  );

  if (String.fromCharCode(...header) !== "%PDF-") {
    throw new Error(
      "Downloaded document is not a valid PDF."
    );
  }

  return data;
}


/* ============================================================
   3. BUILD CSV REPORT

   The report contains one row for every requested SO number.
   ============================================================ */

function csvCell(value) {
  const text = String(value ?? "");

  return `"${text.replace(/"/g, '""')}"`;
}

function buildPodReportCsv(rows) {
  const headers = [
    "Sales Order",
    "Result",
    "Document Number",
    "Document ID",
    "Message"
  ];

  const lines = [headers];

  for (const row of rows) {
    lines.push([
      row.orderNumber,
      row.status,
      row.document?.document_number || "",
      row.document?.id || "",
      row.message || ""
    ]);
  }

  // UTF-8 BOM for compatibility with Excel.
  return "\uFEFF" + lines
    .map(columns => columns.map(csvCell).join(","))
    .join("\r\n");
}


/* ============================================================
   4. DOWNLOAD FILE IN BROWSER
   ============================================================ */

function saveZipToBrowser(blob, filename) {
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Allow the browser time to start the download.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
}


/* ============================================================
   5. DOWNLOAD DOCUMENTS WITH LIMITED CONCURRENCY

   Downloads run in small groups to avoid overwhelming
   the browser or Supabase Storage.
   ============================================================ */

async function retrievePodFiles(
  db,
  companyId,
  rows
) {
  const results = new Array(rows.length);
  let nextIndex = 0;
  let completed = 0;
  let totalBytes = 0;

  const workerCount = Math.min(
    CONFIG.downloadConcurrency,
    rows.length
  );

  async function worker() {
    while (nextIndex < rows.length) {
      const index = nextIndex++;
      const row = rows[index];

      await confirmTenant(companyId);

      try {
        const blob = await downloadSignedPod(
          db,
          row.document
        );

        totalBytes += blob.size;

        if (totalBytes > CONFIG.maxTotalBytes) {
          throw new Error(
            "Total export size limit exceeded."
          );
        }

        results[index] = {
          ...row,
          blob,
          status: "downloaded",
          message: "Signed POD downloaded"
        };

      } catch (error) {
        // A tenant switch must cancel the whole export.
        if (
          String(error.message || "").includes(
            "Active tenant changed"
          )
        ) {
          throw error;
        }

        results[index] = {
          ...row,
          blob: null,
          status: "download_failed",
          message: error.message ||
            "Unable to download signed POD"
        };
      }

      completed++;

      setProgress(
        completed,
        rows.length,
        "Downloading signed PODs"
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => worker()
    )
  );

  return results;
}


/* ============================================================
   6. CREATE ZIP EXPORT
   ============================================================ */


async function createBulkPodZip(db, companyId, rows) {
  const config = getDocumentConfig();
  const JSZipClass = getZipLibrary();
  const zip = new JSZipClass();

  const readyRows = rows.filter(
    row => row.status === "ready"
  );

  const downloaded = await retrievePodFiles(
    db,
    companyId,
    readyRows
  );

  await confirmTenant(companyId);

  const byOrder = new Map(
    downloaded.map(row => [row.orderNumber, row])
  );

  const finalRows = rows.map(row =>
    byOrder.get(row.orderNumber) || row
  );

  let successful = 0;

  for (const row of downloaded) {
    if (row.status !== "downloaded" || !row.blob) {
      continue;
    }

    const filename = safeFileName(
      `${row.orderNumber}-${config.shortName}`
    ) + ".pdf";

    zip.file(filename, row.blob);
    successful++;
  }

  zip.file(
    "Document-Export-Report.csv",
    buildPodReportCsv(finalRows)
  );

  zip.file(
    "README.txt",
    [
      "VEYNOR — BULK DOCUMENT EXPORT",
      "",
      `Document type: ${config.label}`,
      `Export date: ${new Date().toISOString()}`,
      `Requested orders: ${rows.length}`,
      `PDFs downloaded: ${successful}`,
      `Missing or failed: ${rows.length - successful}`,
      "",
      "Existing documents only.",
      "No database records were modified."
    ].join("\r\n")
  );

  setStatus("Creating ZIP archive...", "info");

  const blob = await zip.generateAsync(
    {
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    },
    metadata => {
      const progress = el(IDS.progress);

      if (progress) {
        progress.textContent =
          `Creating ZIP — ${Math.round(metadata.percent)}%`;
      }
    }
  );

  return {
    blob,
    filename: `${config.filePrefix}-${dateStamp()}.zip`,
    successful,
    failed: rows.length - successful,
    rows: finalRows
  };
}


/* ============================================================
   7. MAIN EXPORT ACTION
   ============================================================ */



async function downloadBulkPodZip() {
  if (state.busy) return;

  if (
    !state.checked ||
    !state.documents.length ||
    state.inputKey !== getInputKey()
  ) {
    setStatus(
      "Please check the selected documents before downloading.",
      "error"
    );
    return;
  }

  const config = getDocumentConfig();
  const selectedType = getSelectedDocumentType();

  setBusy(true);

  try {
    const checkedCompanyId = state.companyId;
    const checkedProfileId = state.profile?.id;

    if (!checkedCompanyId || !checkedProfileId) {
      throw new Error(
        "Previous tenant verification is missing. " +
        "Please check the orders again."
      );
    }

    const { db, companyId, profile } =
      await verifyAccess({
        requireCheckedTenant: true
      });

    if (
      String(companyId) !== String(checkedCompanyId) ||
      String(profile.id) !== String(checkedProfileId)
    ) {
      throw new Error(
        "Tenant or user changed. " +
        "Please check the SO numbers again."
      );
    }

    if (getSelectedDocumentType() !== selectedType) {
      throw new Error(
        "Document type changed. Please check again."
      );
    }

    await confirmTenant(checkedCompanyId);

    setStatus(
      `Preparing ${config.label} for download...`,
      "info"
    );

    setProgress(
      0,
      state.documents.length,
      `Downloading ${config.label}`
    );

    const result = await createBulkPodZip(
      db,
      checkedCompanyId,
      state.rows
    );

    // Recheck the user and tenant before saving.
    await verifyAccess({
      requireCheckedTenant: true
    });

    await confirmTenant(checkedCompanyId);

    if (
      getSelectedDocumentType() !== selectedType ||
      state.inputKey !== getInputKey()
    ) {
      throw new Error(
        "Document selection changed. Please check again."
      );
    }

    if (result.successful === 0) {
      setStatus(
        `No ${config.label} PDFs could be downloaded. ` +
        "Check storage paths and permissions.",
        "error"
      );
      return;
    }

    saveZipToBrowser(
      result.blob,
      result.filename
    );

    setStatus(
      `ZIP prepared: ${result.successful} ` +
      `${config.label} document(s). ` +
      `${result.failed} missing or failed. ` +
      "See the CSV report inside the ZIP.",
      result.failed ? "warning" : "success"
    );

    if (
      window.VeynorSystemMonitor &&
      typeof window.VeynorSystemMonitor.success ===
        "function"
    ) {
      window.VeynorSystemMonitor.success(
        "bulk_document_export",
        {
          document_type: selectedType,
          requested: result.rows.length,
          successful: result.successful,
          failed: result.failed,
          company_id: checkedCompanyId
        }
      );
    }

  } catch (error) {
    console.error(
      "[Bulk Document Export] Download failed:",
      error
    );

    const message =
      error.message || "Bulk document export failed.";

    if (
      message.includes("Tenant changed") ||
      message.includes("User profile changed") ||
      message.includes("Tenant or user changed") ||
      message.includes("Active tenant changed") ||
      message.includes("Document type changed") ||
      message.includes("Document selection changed")
    ) {
      resetResults();
    }

    setStatus(message, "error");

    if (
      window.VeynorSystemMonitor &&
      typeof window.VeynorSystemMonitor.failed ===
        "function"
    ) {
      window.VeynorSystemMonitor.failed(
        "bulk_document_export",
        error,
        { document_type: selectedType }
      );
    }

  } finally {
    setBusy(false);
  }
}


/* ============================================================
   8. CLEAR INPUT AND RESULTS
   ============================================================ */

function clearBulkPodExport() {
  if (state.busy) return;

  const input = el(IDS.input);

  if (input) {
    input.value = "";
  }

  resetResults();

  const progress = el(IDS.progress);

  if (progress) {
    progress.textContent = "";
    progress.style.display = "none";
  }

  setStatus("");
  updateInputCount();
}


/* ============================================================
   9. DROPDOWN TOGGLE
   ============================================================ */

function toggleBulkPodPanel() {
  const panel = el(IDS.panel);
  const toggle = el(IDS.toggle);

  if (!panel || !toggle) return;

  const expanded =
    toggle.getAttribute("aria-expanded") === "true";

  toggle.setAttribute(
    "aria-expanded",
    String(!expanded)
  );

  panel.hidden = expanded;
}


/* ============================================================
   10. EVENT LISTENERS
   ============================================================ */


function bindBulkPodEvents() {
  const toggle = el(IDS.toggle);
  const input = el(IDS.input);
  const type = el(IDS.type);
  const check = el(IDS.check);
  const download = el(IDS.download);
  const clear = el(IDS.clear);

  if (
    !toggle ||
    !input ||
    !type ||
    !check ||
    !download ||
    !clear
  ) {
    console.warn(
      "[Bulk Document Export] Required HTML elements " +
      "not found. Check OCC integration."
    );

    return false;
  }

  toggle.addEventListener(
    "click",
    toggleBulkPodPanel
  );

  input.addEventListener(
    "input",
    updateInputCount
  );

  type.addEventListener("change", () => {
    if (state.busy) return;

    resetResults();

    const progress = el(IDS.progress);

    if (progress) {
      progress.textContent = "";
      progress.style.display = "none";
    }

    setStatus("");
    updateInputCount();

    console.info(
      "[Bulk Document Export] Selected:",
      getSelectedDocumentType()
    );
  });

  check.addEventListener(
    "click",
    checkBulkPodAvailability
  );

  download.addEventListener(
    "click",
    downloadBulkPodZip
  );

  clear.addEventListener(
    "click",
    clearBulkPodExport
  );

  updateInputCount();
  updateButtons();

  return true;
}


/* ============================================================
   11. INITIALIZATION
   ============================================================ */

function initBulkPodExport() {
  if (window.__VeynorBulkPodExportInitialized) {
    return;
  }

  const success = bindBulkPodEvents();

  if (!success) return;

  window.__VeynorBulkPodExportInitialized = true;

  console.info(
    "[Bulk POD Export] Module initialized."
  );
}


/* ============================================================
   12. PUBLIC API
   ============================================================ */

window.VeynorBulkPodExport = Object.freeze({
  check: checkBulkPodAvailability,
  download: downloadBulkPodZip,
  clear: clearBulkPodExport,
  getState: () => ({
    checked: state.checked,
    busy: state.busy,
    companyId: state.companyId,
    statistics: state.statistics
      ? { ...state.statistics }
      : null
  })
});


/* ============================================================
   13. START MODULE
   ============================================================ */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initBulkPodExport
  );
} else {
  initBulkPodExport();
}


/* ============================================================
   END VEYNOR BULK SIGNED POD EXPORT
   ============================================================ */

})();





