(function () {
  "use strict";

  /* =========================================================
     VEYNOR - INBOUND CONTAINERS
     Fase 1:
     - Containers tonen
     - Container aanmaken
     - Product owner selecteren
     - Producten toevoegen via dropdown
     - Packages, volume en gewicht automatisch berekenen
     - Packing-list-PDF uploaden
     - Expected / Received tabbladen
     ========================================================= */

const state = {
  profile: null,
  companyId: null,

  containers: [],
  owners: [],
  products: [],
  warehouses: [],
  locations: [],

  ownerMap: new Map(),
  warehouseMap: new Map(),
  locationMap: new Map(),

  activeTab: "expected",

  draftLines: [],
  packingListFile: null,

  expandedContainers: new Set(),

  loadedContainerLines: new Map(),
  loadedContainerAttachments: new Map(),
  loadedContainerNotes: new Map(),

  activeAttachmentContainerId: null,
  activeNoteContainerId: null,

  attachmentFile: null
};

  const byId = id => document.getElementById(id);

  /* =========================================================
     SUPABASE
     ========================================================= */

  function getDb() {
    if (typeof sb !== "function") {
      throw new Error("Supabase client is not available.");
    }

    return sb();
  }

  /* =========================================================
     HELPERS
     ========================================================= */

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  function integerValue(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  function uniqueValues(values) {
    return [
      ...new Set(
        (values || []).filter(Boolean)
      )
    ];
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatNumber(value, decimals = 0) {
    return new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(numberValue(value));
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(`${value}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function showToast(message, type = "ok") {
    const toast = byId("toast");

    if (!toast) {
      console.log(message);
      return;
    }

    toast.textContent = message;
    toast.style.display = "block";

    toast.className =
      type === "err"
        ? "notice error"
        : "notice success";

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
      toast.style.display = "none";
    }, 4500);
  }

  function getOwnerName(ownerId) {
    const owner = state.ownerMap.get(String(ownerId));

    return (
      owner?.name ||
      owner?.company_name ||
      owner?.customer_name ||
      "Unknown owner"
    );
  }

  function getWarehouseName(warehouseId) {
    const warehouse = state.warehouseMap.get(
      String(warehouseId)
    );

    return (
      warehouse?.name ||
      warehouse?.warehouse_name ||
      warehouse?.code ||
      "—"
    );
  }

  function getLocationName(locationId) {
    const location = state.locationMap.get(
      String(locationId)
    );

    return (
      location?.location_code ||
      location?.code ||
      location?.name ||
      location?.label ||
      "—"
    );
  }

  function getProductOwnerId(product) {
    return (
      product?.customer_id ||
      product?.product_owner_id ||
      product?.owner_id ||
      null
    );
  }

  function getWarehouseId(location) {
    return (
      location?.warehouse_id ||
      location?.parent_warehouse_id ||
      null
    );
  }

  function getPackagesPerUnit(product) {
    const explicitPackages = integerValue(
      product?.packages_per_unit,
      0
    );

    if (explicitPackages > 0) {
      return explicitPackages;
    }

    let count = 0;

    if (numberValue(product?.package_1_qty) > 0) {
      count += 1;
    }

    if (numberValue(product?.package_2_qty) > 0) {
      count += 1;
    }

    if (numberValue(product?.package_3_qty) > 0) {
      count += 1;
    }

    return Math.max(1, count);
  }

  function getProductVolume(product) {
    return numberValue(
      product?.volume_m3 ??
      product?.product_volume_m3 ??
      product?.unit_volume_m3
    );
  }

  function getProductWeight(product) {
    return numberValue(
      product?.weight_kg ??
      product?.net_weight_kg ??
      product?.unit_weight_kg
    );
  }

  function getProductLabel(product) {
    const sku =
      product?.sku_base ||
      product?.sku ||
      product?.product_code ||
      "Unknown SKU";

    const name =
      product?.name ||
      product?.description ||
      "";

    return name
      ? `${sku} · ${name}`
      : sku;
  }

  function statusLabel(status) {
    const labels = {
      draft: "Draft",
      expected: "Expected",
      on_water: "On Water",
      at_port: "At Port",
      arriving: "Arriving",
      receiving: "Receiving",
      received: "Received",
      cancelled: "Cancelled"
    };

    return labels[normalize(status)] ||
      status ||
      "Unknown";
  }

  function statusClass(status) {
    const safeStatus = normalize(status)
      .replace(/\s+/g, "_");

    return `status-${safeStatus}`;
  }

  function isReceivedContainer(container) {
    return normalize(container?.status) === "received";
  }

  function isExpectedContainer(container) {
    return ![
      "received",
      "cancelled"
    ].includes(normalize(container?.status));
  }

  function isDateThisWeek(value) {
    if (!value) {
      return false;
    }

    const date = new Date(`${value}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const now = new Date();

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const day = start.getDay();
    const daysSinceMonday = (day + 6) % 7;

    start.setDate(
      start.getDate() - daysSinceMonday
    );

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return date >= start && date <= end;
  }

  /* =========================================================
     USER / COMPANY
     ========================================================= */

  async function loadCurrentProfile() {
    const db = getDb();

    const {
      data: authData,
      error: authError
    } = await db.auth.getUser();

    if (authError) {
      throw authError;
    }

    const authUser = authData?.user;

    if (!authUser) {
      throw new Error("No signed-in user found.");
    }

    let profileResult = await db
      .from("user_profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();

    if (
      !profileResult.data &&
      !profileResult.error
    ) {
      profileResult = await db
        .from("user_profiles")
        .select("*")
        .eq("auth_user_id", authUser.id)
        .maybeSingle();
    }

    if (profileResult.error) {
      throw profileResult.error;
    }

    if (!profileResult.data?.company_id) {
      throw new Error(
        "No company is linked to the current user."
      );
    }

    state.profile = profileResult.data;
    state.companyId =
      profileResult.data.company_id;
  }

  /* =========================================================
     REFERENCE DATA
     ========================================================= */

  async function loadOwners() {
    const db = getDb();

    const { data, error } = await db
      .from("customers")
      .select("*")
      .eq("company_id", state.companyId)
      .order("name", {
        ascending: true
      });

    if (error) {
      throw error;
    }

    state.owners = (data || [])
      .filter(owner => owner.is_active !== false);

    state.ownerMap = new Map(
      state.owners.map(owner => [
        String(owner.id),
        owner
      ])
    );
  }

  async function loadProducts() {
    const db = getDb();

    const { data, error } = await db
      .from("products")
      .select("*")
      .eq("company_id", state.companyId)
      .order("sku_base", {
        ascending: true
      });

    if (error) {
      throw error;
    }

    state.products = (data || [])
      .filter(product => product.is_active !== false);
  }

  async function loadWarehouses() {
    const db = getDb();

    const { data, error } = await db
      .from("warehouses")
      .select("*")
      .eq("company_id", state.companyId);

    if (error) {
      throw error;
    }

    state.warehouses = data || [];

    state.warehouseMap = new Map(
      state.warehouses.map(warehouse => [
        String(warehouse.id),
        warehouse
      ])
    );
  }

  async function loadLocations() {
    const db = getDb();

    const { data, error } = await db
      .from("warehouse_locations")
      .select("*")
      .eq("company_id", state.companyId);

    if (error) {
      throw error;
    }

    state.locations = data || [];

    state.locationMap = new Map(
      state.locations.map(location => [
        String(location.id),
        location
      ])
    );
  }

  async function loadReferenceData() {
    await Promise.all([
      loadOwners(),
      loadProducts(),
      loadWarehouses(),
      loadLocations()
    ]);

    renderOwnerSelectors();
    renderWarehouseSelector();
    renderLocationSelector();
    renderProductSelector();
  }

  /* =========================================================
     CONTAINERS
     ========================================================= */

  async function loadContainers() {
    const db = getDb();

    const { data, error } = await db
      .from("inbound_container_overview")
      .select("*")
      .eq("company_id", state.companyId)
      .order("eta_warehouse_date", {
        ascending: true,
        nullsFirst: false
      })
      .order("created_at", {
        ascending: false
      });

    if (error) {
      throw error;
    }

    state.containers = data || [];

    renderKpis();
    renderContainers();
  }

 async function loadContainerLines(containerId) {
  const cacheKey = String(containerId);

  if (state.loadedContainerLines.has(cacheKey)) {
    return state.loadedContainerLines.get(cacheKey);
  }

  const db = getDb();

  const {
    data: lines,
    error: linesError
  } = await db
    .from("inbound_container_lines")
    .select("*")
    .eq("container_id", containerId)
    .order("line_number", {
      ascending: true,
      nullsFirst: false
    })
    .order("created_at", {
      ascending: true
    });

  if (linesError) {
    throw linesError;
  }

  const lineIds = (lines || []).map(line => line.id);

  let allocations = [];

  if (lineIds.length) {
    const {
      data: allocationRows,
      error: allocationError
    } = await db
      .from("inbound_expected_allocations")
      .select(`
        *,
        orders (
          id,
          order_number
        )
      `)
      .in("container_line_id", lineIds)
      .eq("status", "expected");

    if (allocationError) {
      console.warn(
        "Expected allocations could not be loaded:",
        allocationError.message
      );
    } else {
      allocations = allocationRows || [];
    }
  }

  const allocationsByLine = new Map();

  allocations.forEach(allocation => {
    const lineKey = String(allocation.container_line_id);

    if (!allocationsByLine.has(lineKey)) {
      allocationsByLine.set(lineKey, []);
    }

    allocationsByLine
      .get(lineKey)
      .push(allocation);
  });

  const combined = (lines || []).map(line => ({
    ...line,

    expected_allocations:
      allocationsByLine.get(
        String(line.id)
      ) || []
  }));

  state.loadedContainerLines.set(
    cacheKey,
    combined
  );

  return combined;
}


async function loadContainerAttachments(containerId) {
  const cacheKey = String(containerId);

  if (
    state.loadedContainerAttachments.has(cacheKey)
  ) {
    return state.loadedContainerAttachments.get(cacheKey);
  }

  const db = getDb();

  const { data, error } = await db
    .from("inbound_attachments")
    .select(`
      id,
      company_id,
      container_id,
      receipt_line_id,
      attachment_type,
      file_name,
      storage_bucket,
      storage_path,
      mime_type,
      file_size,
      note,
      uploaded_by,
      uploaded_at
    `)
    .eq("container_id", containerId)
    .order("uploaded_at", {
      ascending: false
    });

  if (error) {
    throw error;
  }

  const attachments = data || [];

  state.loadedContainerAttachments.set(
    cacheKey,
    attachments
  );

  return attachments;
}


async function loadContainerNotes(containerId) {
  const cacheKey = String(containerId);

  if (state.loadedContainerNotes.has(cacheKey)) {
    return state.loadedContainerNotes.get(cacheKey);
  }

  const db = getDb();

  const { data, error } = await db
    .from("inbound_activity_log")
    .select(`
      id,
      container_id,
      event_type,
      description,
      payload,
      created_by,
      created_at
    `)
    .eq("container_id", containerId)
    .in("event_type", [
      "general_note",
      "damage_reported",
      "missing_reported",
      "quarantine_reported",
      "inspection_note"
    ])
    .order("created_at", {
      ascending: false
    });

  if (error) {
    throw error;
  }

  const notes = data || [];

  state.loadedContainerNotes.set(
    cacheKey,
    notes
  );

  return notes;
}


function clearContainerDetailCache(containerId) {
  const cacheKey = String(containerId);

  state.loadedContainerLines.delete(cacheKey);
  state.loadedContainerAttachments.delete(cacheKey);
  state.loadedContainerNotes.delete(cacheKey);
}


async function loadCompleteContainerDetail(containerId) {
  const cacheKey = String(containerId);

  const productsTarget = byId(
    `containerLines-${cacheKey}`
  );

  const documentsTarget = byId(
    `containerDocuments-${cacheKey}`
  );

  const photosTarget = byId(
    `containerPhotos-${cacheKey}`
  );

  const notesTarget = byId(
    `containerNotes-${cacheKey}`
  );

  if (productsTarget) {
    productsTarget.innerHTML = `
      <div class="empty-state">
        Loading products...
      </div>
    `;
  }

  if (documentsTarget) {
    documentsTarget.innerHTML = `
      <div class="empty-state">
        Loading documents...
      </div>
    `;
  }

  if (photosTarget) {
    photosTarget.innerHTML = `
      <div class="empty-state">
        Loading photos...
      </div>
    `;
  }

  if (notesTarget) {
    notesTarget.innerHTML = `
      <div class="empty-state">
        Loading notes...
      </div>
    `;
  }

  try {
    await Promise.all([
      loadContainerLines(containerId),
      loadContainerAttachments(containerId),
      loadContainerNotes(containerId)
    ]);

    renderLoadedContainerLines(containerId);
    renderLoadedContainerAttachments(containerId);
    renderLoadedContainerNotes(containerId);
  } catch (error) {
    console.error(
      "Container detail could not be loaded:",
      error
    );

    showToast(
      error.message ||
      "Container details could not be loaded.",
      "err"
    );
  }
}


function findAttachmentById(attachmentId) {
  for (
    const attachments
    of state.loadedContainerAttachments.values()
  ) {
    const attachment = attachments.find(row =>
      String(row.id) === String(attachmentId)
    );

    if (attachment) {
      return attachment;
    }
  }

  return null;
}


async function createAttachmentSignedUrl(
  attachment,
  expiresIn = 600
) {
  const bucket =
    attachment.storage_bucket ||
    "inbound-assets";

  const { data, error } = await getDb()
    .storage
    .from(bucket)
    .createSignedUrl(
      attachment.storage_path,
      expiresIn
    );

  if (error) {
    throw error;
  }

  if (!data?.signedUrl) {
    throw new Error(
      "Temporary file link could not be created."
    );
  }

  return data.signedUrl;
}


function attachmentTypeLabel(type) {
  return {
    packing_list:
      "Packing List",

    container_photo:
      "Container Photo",

    product_photo:
      "Product Photo",

    damage_photo:
      "Damage Photo",

    delivery_document:
      "Delivery Document",

    other:
      "Other"
  }[
    normalize(type)
  ] || "File";
}

function renderAttachmentCard(attachment) {
  const isImage =
    String(attachment.mime_type || "")
      .toLowerCase()
      .startsWith("image/");

  return `
    <article
      class="attachment-card"
      data-attachment-card="${escapeHtml(attachment.id)}"
    >
      <div class="attachment-preview">
        ${
          isImage
            ? `
              <img
                data-attachment-preview="${escapeHtml(attachment.id)}"
                alt="${escapeHtml(attachment.file_name)}"
              >
            `
            : `
              <div class="attachment-file-icon">
                ${
                  normalize(attachment.attachment_type) ===
                  "packing_list"
                    ? "PDF"
                    : "↥"
                }
              </div>
            `
        }
      </div>

      <div class="attachment-meta">
        <strong class="attachment-name">
          ${escapeHtml(attachment.file_name)}
        </strong>

        <span class="attachment-type">
          ${escapeHtml(
            attachmentTypeLabel(
              attachment.attachment_type
            )
          )}
          ·
          ${formatDateTime(attachment.uploaded_at)}
        </span>
      </div>

      ${
        attachment.note
          ? `
            <div class="attachment-note">
              ${escapeHtml(attachment.note)}
            </div>
          `
          : ""
      }

      <div class="attachment-actions">
        <button
          class="btn"
          type="button"
          data-open-attachment="${escapeHtml(attachment.id)}"
        >
          Open
        </button>

        <button
          class="btn"
          type="button"
          data-download-attachment="${escapeHtml(attachment.id)}"
        >
          Download
        </button>

        <button
          class="btn"
          type="button"
          data-delete-attachment="${escapeHtml(attachment.id)}"
        >
          Delete
        </button>
      </div>
    </article>
  `;
}


function renderLoadedContainerAttachments(
  containerId
) {
  const cacheKey =
    String(containerId);

  const attachments =
    state.loadedContainerAttachments
      .get(cacheKey) || [];

  const documentsTarget =
    byId(
      `containerDocuments-${cacheKey}`
    );

  const photosTarget =
    byId(
      `containerPhotos-${cacheKey}`
    );


  const photoTypes = [
    "container_photo",
    "product_photo",
    "damage_photo"
  ];


  const photos =
    attachments.filter(
      attachment =>
        photoTypes.includes(
          normalize(
            attachment.attachment_type
          )
        )
    );


  const documents =
    attachments.filter(
      attachment =>
        !photoTypes.includes(
          normalize(
            attachment.attachment_type
          )
        )
    );


  if (documentsTarget) {
    documentsTarget.innerHTML =
      documents.length
        ? documents
            .map(
              renderAttachmentCard
            )
            .join("")
        : `
          <div class="empty-state">
            No documents or files uploaded.
          </div>
        `;
  }


  if (photosTarget) {
    photosTarget.innerHTML =
      photos.length
        ? photos
            .map(
              renderAttachmentCard
            )
            .join("")
        : `
          <div class="empty-state">
            No photos uploaded.
          </div>
        `;
  }


  bindAttachmentActions();
}

function renderLoadedContainerNotes(containerId) {
  const cacheKey = String(containerId);

  const target = byId(
    `containerNotes-${cacheKey}`
  );

  if (!target) {
    return;
  }

  const notes =
    state.loadedContainerNotes.get(cacheKey) || [];

  if (!notes.length) {
    target.innerHTML = `
      <div class="empty-state">
        No inspection notes added.
      </div>
    `;

    return;
  }

  target.innerHTML = notes.map(note => {
    const type = normalize(note.event_type);

    const label = {
      general_note: "General",
      damage_reported: "Damage",
      missing_reported: "Missing Goods",
      quarantine_reported: "Quarantine",
      inspection_note: "Inspection"
    }[type] || "Note";

    const badgeClass = {
      general_note: "inspection-general",
      inspection_note: "inspection-general",
      damage_reported: "inspection-damage",
      quarantine_reported: "inspection-damage",
      missing_reported: "inspection-missing"
    }[type] || "inspection-general";

    return `
      <article class="note-card">
        <div class="note-card-head">
          <span class="inspection-badge ${badgeClass}">
            ${escapeHtml(label)}
          </span>

          <span class="note-card-date">
            ${formatDateTime(note.created_at)}
          </span>
        </div>

        <div class="note-card-text">
          ${escapeHtml(note.description)}
        </div>
      </article>
    `;
  }).join("");
}


async function loadAttachmentPreviews() {
  const previewElements =
    document.querySelectorAll(
      "[data-attachment-preview]"
    );

  for (const imageElement of previewElements) {
    const attachment = findAttachmentById(
      imageElement.dataset.attachmentPreview
    );

    if (!attachment) {
      continue;
    }

    if (imageElement.dataset.previewLoaded === "true") {
      continue;
    }

    try {
      imageElement.src =
        await createAttachmentSignedUrl(
          attachment,
          900
        );

      imageElement.dataset.previewLoaded = "true";
    } catch (error) {
      console.warn(
        "Image preview could not be loaded:",
        error.message
      );
    }
  }
}


function bindAttachmentActions() {
  loadAttachmentPreviews();

  document
    .querySelectorAll("[data-open-attachment]")
    .forEach(button => {
      button.onclick = async () => {
        const attachment = findAttachmentById(
          button.dataset.openAttachment
        );

        if (!attachment) {
          return;
        }

        try {
          const url =
            await createAttachmentSignedUrl(
              attachment,
              600
            );

          const isImage =
            String(attachment.mime_type || "")
              .toLowerCase()
              .startsWith("image/");

          if (isImage) {
            openPhotoViewer(
              attachment.file_name,
              url
            );
          } else {
            window.open(
              url,
              "_blank",
              "noopener,noreferrer"
            );
          }
        } catch (error) {
          showToast(
            error.message ||
            "File could not be opened.",
            "err"
          );
        }
      };
    });

  document
    .querySelectorAll("[data-download-attachment]")
    .forEach(button => {
      button.onclick = async () => {
        const attachment = findAttachmentById(
          button.dataset.downloadAttachment
        );

        if (!attachment) {
          return;
        }

        try {
          const url =
            await createAttachmentSignedUrl(
              attachment,
              600
            );

          const downloadLink =
            document.createElement("a");

          downloadLink.href = url;
          downloadLink.download =
            attachment.file_name ||
            "container-file";

          downloadLink.target = "_blank";
          downloadLink.rel = "noopener";

          document.body.appendChild(downloadLink);
          downloadLink.click();
          downloadLink.remove();
        } catch (error) {
          showToast(
            error.message ||
            "File could not be downloaded.",
            "err"
          );
        }
      };
    });

  document
    .querySelectorAll("[data-delete-attachment]")
    .forEach(button => {
      button.onclick = async () => {
        const attachment = findAttachmentById(
          button.dataset.deleteAttachment
        );

        if (!attachment) {
          return;
        }

        const confirmed = window.confirm(
          `Delete "${attachment.file_name}"?`
        );

        if (!confirmed) {
          return;
        }

        try {
          await deleteContainerAttachment(
            attachment
          );
        } catch (error) {
          showToast(
            error.message ||
            "File could not be deleted.",
            "err"
          );
        }
      };
    });
}


async function deleteContainerAttachment(attachment) {
  const db = getDb();

  const bucket =
    attachment.storage_bucket ||
    "inbound-assets";

  const { error: storageError } = await db
    .storage
    .from(bucket)
    .remove([
      attachment.storage_path
    ]);

  if (storageError) {
    throw storageError;
  }

  const { error: databaseError } = await db
    .from("inbound_attachments")
    .delete()
    .eq("id", attachment.id);

  if (databaseError) {
    throw databaseError;
  }

  if (
    normalize(attachment.attachment_type) ===
    "packing_list"
  ) {
    const { error: updateError } = await db
      .from("inbound_containers")
      .update({
        packing_list_path: null,
        packing_list_name: null,
        packing_list_uploaded_at: null
      })
      .eq(
        "id",
        attachment.container_id
      );

    if (updateError) {
      console.warn(
        "Packing list fields could not be cleared:",
        updateError.message
      );
    }
  }

  state.loadedContainerAttachments.delete(
    String(attachment.container_id)
  );

  await loadContainerAttachments(
    attachment.container_id
  );

  renderLoadedContainerAttachments(
    attachment.container_id
  );

  await loadContainers();

  showToast(
    "File deleted.",
    "ok"
  );
}

  /* =========================================================
     SELECTORS
     ========================================================= */

  function renderOwnerSelectors() {
    const options = state.owners
      .map(owner => {
        const name =
          owner.name ||
          owner.company_name ||
          owner.customer_name ||
          "Unknown owner";

        return `
          <option value="${escapeHtml(owner.id)}">
            ${escapeHtml(name)}
          </option>
        `;
      })
      .join("");

    if (byId("filterOwner")) {
      byId("filterOwner").innerHTML =
        `<option value="">All owners</option>` +
        options;
    }

    if (byId("containerOwner")) {
      byId("containerOwner").innerHTML =
        `<option value="">Select owner</option>` +
        options;
    }
  }

  function renderWarehouseSelector() {
    const select = byId("warehouseSelect");

    if (!select) {
      return;
    }

    select.innerHTML =
      `<option value="">Select warehouse</option>` +
      state.warehouses
        .map(warehouse => {
          const label =
            warehouse.name ||
            warehouse.warehouse_name ||
            warehouse.code ||
            "Warehouse";

          return `
            <option value="${escapeHtml(warehouse.id)}">
              ${escapeHtml(label)}
            </option>
          `;
        })
        .join("");
  }

  function renderLocationSelector() {
    const select = byId("locationSelect");

    if (!select) {
      return;
    }

    const selectedWarehouseId =
      byId("warehouseSelect")?.value || "";

    const filtered = selectedWarehouseId
      ? state.locations.filter(location =>
          String(getWarehouseId(location)) ===
          String(selectedWarehouseId)
        )
      : state.locations;

    select.innerHTML =
      `<option value="">Select location</option>` +
      filtered
        .map(location => {
          const label =
            location.location_code ||
            location.code ||
            location.name ||
            location.label ||
            "Location";

          return `
            <option value="${escapeHtml(location.id)}">
              ${escapeHtml(label)}
            </option>
          `;
        })
        .join("");
  }

  function renderProductSelector() {
    const select = byId("productSelect");

    if (!select) {
      return;
    }

    const ownerId =
      byId("containerOwner")?.value || "";

    if (!ownerId) {
      select.innerHTML =
        `<option value="">Select owner first</option>`;

      return;
    }

    const products = state.products
      .filter(product =>
        String(getProductOwnerId(product)) ===
        String(ownerId)
      );

    select.innerHTML =
      `<option value="">Select product</option>` +
      products
        .map(product => `
          <option value="${escapeHtml(product.id)}">
            ${escapeHtml(getProductLabel(product))}
          </option>
        `)
        .join("");
  }

  /* =========================================================
     KPI
     ========================================================= */

  function renderKpis() {
    const expectedContainers =
      state.containers.filter(
        isExpectedContainer
      );

    const receivedContainers =
      state.containers.filter(
        isReceivedContainer
      );

    const expectedThisWeek =
      expectedContainers.filter(container =>
        isDateThisWeek(
          container.eta_warehouse_date
        )
      );

    const expectedVolume =
      expectedContainers.reduce(
        (total, container) =>
          total +
          numberValue(
            container.expected_volume_m3
          ),
        0
      );

    const expectedPackages =
      expectedContainers.reduce(
        (total, container) =>
          total +
          integerValue(
            container.expected_packages
          ),
        0
      );

    const linkedOrders =
      expectedContainers.reduce(
        (total, container) =>
          total +
          integerValue(
            container.linked_orders
          ),
        0
      );

    if (byId("kpiExpected")) {
      byId("kpiExpected").textContent =
        formatNumber(
          expectedContainers.length
        );
    }

    if (byId("kpiThisWeek")) {
      byId("kpiThisWeek").textContent =
        formatNumber(
          expectedThisWeek.length
        );
    }

    if (byId("kpiVolume")) {
      byId("kpiVolume").textContent =
        formatNumber(
          expectedVolume,
          3
        );
    }

    if (byId("kpiPackages")) {
      byId("kpiPackages").textContent =
        formatNumber(
          expectedPackages
        );
    }

    if (byId("kpiLinkedOrders")) {
      byId("kpiLinkedOrders").textContent =
        formatNumber(
          linkedOrders
        );
    }

    if (byId("kpiReceived")) {
      byId("kpiReceived").textContent =
        formatNumber(
          receivedContainers.length
        );
    }
  }

  /* =========================================================
     FILTERING
     ========================================================= */

  function getFilteredContainers() {
    const search =
      normalize(
        byId("filterSearch")?.value
      );

    const ownerId =
      byId("filterOwner")?.value || "";

    const status =
      byId("filterStatus")?.value || "";

    const etaFrom =
      byId("filterEtaFrom")?.value || "";

    const etaTo =
      byId("filterEtaTo")?.value || "";

    return state.containers.filter(container => {
      if (
        state.activeTab === "expected" &&
        !isExpectedContainer(container)
      ) {
        return false;
      }

      if (
        state.activeTab === "received" &&
        !isReceivedContainer(container)
      ) {
        return false;
      }

      if (
        ownerId &&
        String(container.product_owner_id) !==
        String(ownerId)
      ) {
        return false;
      }

      if (
        status &&
        normalize(container.status) !==
        normalize(status)
      ) {
        return false;
      }

      if (
        etaFrom &&
        (
          !container.eta_warehouse_date ||
          container.eta_warehouse_date < etaFrom
        )
      ) {
        return false;
      }

      if (
        etaTo &&
        (
          !container.eta_warehouse_date ||
          container.eta_warehouse_date > etaTo
        )
      ) {
        return false;
      }

      if (search) {
        const searchText = [
          container.container_number,
          container.container_type,
          container.seal_number,
          container.vessel_name,
          container.voyage_number,
          container.shipping_line,
          container.carrier_name,
          container.supplier_reference,
          getOwnerName(
            container.product_owner_id
          )
        ]
          .join(" ")
          .toLowerCase();

        if (!searchText.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }

  function clearFilters() {
    if (byId("filterSearch")) {
      byId("filterSearch").value = "";
    }

    if (byId("filterOwner")) {
      byId("filterOwner").value = "";
    }

    if (byId("filterStatus")) {
      byId("filterStatus").value = "";
    }

    if (byId("filterEtaFrom")) {
      byId("filterEtaFrom").value = "";
    }

    if (byId("filterEtaTo")) {
      byId("filterEtaTo").value = "";
    }

    renderContainers();
  }

/* =========================================================
   CONTAINER LIST
   ========================================================= */

function renderContainers() {
  const list = byId("containerList");

  if (!list) {
    return;
  }

  const containers =
    getFilteredContainers();

  if (byId("resultCount")) {
    byId("resultCount").textContent =
      `${formatNumber(containers.length)} ` +
      `container${containers.length === 1 ? "" : "s"} shown`;
  }

  if (!containers.length) {
    list.innerHTML = `
      <div class="empty-state">
        No containers found for the selected filters.
      </div>
    `;

    return;
  }

  list.innerHTML = containers
    .map(container => {
      const id = String(container.id);

      const open =
        state.expandedContainers.has(id);

      return `
        <article
          class="container-row ${open ? "open" : ""}"
          data-container-id="${escapeHtml(id)}"
        >
          <div
            class="container-main"
            data-container-toggle="${escapeHtml(id)}"
          >
            <div>
              <div class="container-code">
                ${escapeHtml(container.container_number)}
              </div>

              <span class="subline">
                ${escapeHtml(container.container_type || "Container")}
                ·
                ${escapeHtml(
                  getOwnerName(
                    container.product_owner_id
                  )
                )}
              </span>
            </div>

            <div>
              <strong>
                ${escapeHtml(container.vessel_name || "—")}
              </strong>

              <span class="subline">
                ${
                  container.voyage_number
                    ? `Voyage: ${escapeHtml(container.voyage_number)}`
                    : "No voyage number"
                }
              </span>
            </div>

            <div>
              <strong>
                ${formatDate(container.eta_warehouse_date)}
              </strong>

              <span class="subline">
                ETA Warehouse
              </span>
            </div>

            <div class="metric">
              <strong>
                ${formatNumber(
                  container.expected_volume_m3,
                  3
                )} m³
              </strong>

              <span>Volume</span>
            </div>

            <div class="metric">
              <strong>
                ${formatNumber(
                  container.expected_packages
                )}
              </strong>

              <span>Packages</span>
            </div>

            <div class="metric hide-mid">
              <strong>
                ${formatNumber(
                  container.sku_count
                )}
              </strong>

              <span>SKUs</span>
            </div>

            <div class="metric hide-mid">
              <strong>
                ${formatNumber(
                  container.linked_orders
                )}
              </strong>

              <span>Linked Orders</span>
            </div>

            <div>
              <span class="status-pill ${statusClass(container.status)}">
                ${escapeHtml(statusLabel(container.status))}
              </span>
            </div>

            <button
              class="row-chevron"
              type="button"
              aria-label="Open container"
            >
              ${open ? "⌃" : "⌄"}
            </button>
          </div>

          <div class="container-detail">
            ${renderContainerDetailShell(container)}
          </div>
        </article>
      `;
    })
    .join("");

  bindContainerRowEvents();

  containers.forEach(container => {
    const id = String(container.id);

    if (state.expandedContainers.has(id)) {
      loadCompleteContainerDetail(id);
    }
  });
}


function renderContainerDetailShell(container) {
  return `
    <div class="detail-section-stack">

      <div class="detail-grid">
        <section class="detail-panel">
          <div class="detail-head">
            <div>
              <h3>Expected Products</h3>

              <span class="subline">
                Products expected in this container.
              </span>
            </div>

            <div class="container-action-bar">
              <button
                class="btn"
                type="button"
                data-container-refresh="${escapeHtml(container.id)}"
              >
                Refresh
              </button>

              <button
                class="btn"
                type="button"
                data-container-edit="${escapeHtml(container.id)}"
              >
                Edit Container
              </button>
            </div>
          </div>

          <div
            class="table-wrap"
            id="containerLines-${escapeHtml(container.id)}"
          >
            <div class="empty-state">
              Open the container to load products.
            </div>
          </div>
        </section>

        <aside class="detail-panel">
          <div class="detail-head">
            <h3>Container Summary</h3>
          </div>

          <div class="summary-list">
            <div class="summary-line">
              <span>Product Owner</span>

              <strong>
                ${escapeHtml(
                  getOwnerName(
                    container.product_owner_id
                  )
                )}
              </strong>
            </div>

            <div class="summary-line">
              <span>Expected Units</span>

              <strong>
                ${formatNumber(container.expected_units)}
              </strong>
            </div>

            <div class="summary-line">
              <span>Expected Packages</span>

              <strong>
                ${formatNumber(container.expected_packages)}
              </strong>
            </div>

            <div class="summary-line">
              <span>Expected Weight</span>

              <strong>
                ${formatNumber(
                  container.expected_weight_kg,
                  1
                )} kg
              </strong>
            </div>

            <div class="summary-line">
              <span>Expected Volume</span>

              <strong>
                ${formatNumber(
                  container.expected_volume_m3,
                  3
                )} m³
              </strong>
            </div>

            <div class="summary-line">
              <span>Linked Orders</span>

              <strong>
                ${formatNumber(container.linked_orders)}
              </strong>
            </div>

            <div class="summary-line">
              <span>Warehouse</span>

              <strong>
                ${escapeHtml(
                  getWarehouseName(
                    container.warehouse_id
                  )
                )}
              </strong>
            </div>

            <div class="summary-line">
              <span>Location</span>

              <strong>
                ${escapeHtml(
                  getLocationName(
                    container.location_id
                  )
                )}
              </strong>
            </div>

            <div class="summary-line">
              <span>Packing List</span>

              <strong>
                ${
                  container.packing_list_name
                    ? escapeHtml(container.packing_list_name)
                    : "Not uploaded"
                }
              </strong>
            </div>
          </div>
        </aside>
      </div>

      <section class="detail-panel">
        <div class="detail-head">
          <div>
            <h3>Documents & Files</h3>

            <span class="subline">
              Packing lists, delivery documents and other files.
            </span>
          </div>

          <button
            class="btn btn-primary"
            type="button"
            data-container-upload-file="${escapeHtml(container.id)}"
          >
            + Upload File
          </button>
        </div>

        <div
          class="attachments-grid"
          id="containerDocuments-${escapeHtml(container.id)}"
        >
          <div class="empty-state">
            Open the container to load documents.
          </div>
        </div>
      </section>

      <section class="detail-panel">
        <div class="detail-head">
          <div>
            <h3>Photos & Inspection</h3>

            <span class="subline">
              Container photos, unloading photos and damage evidence.
            </span>
          </div>

          <button
            class="btn"
            type="button"
            data-container-upload-photo="${escapeHtml(container.id)}"
          >
            + Upload Photos
          </button>
        </div>

        <div
          class="attachments-grid"
          id="containerPhotos-${escapeHtml(container.id)}"
        >
          <div class="empty-state">
            Open the container to load photos.
          </div>
        </div>
      </section>

      <section class="detail-panel">
        <div class="detail-head">
          <div>
            <h3>Notes & Damage</h3>

            <span class="subline">
              General remarks, missing goods, damages and quarantine notes.
            </span>
          </div>

          <button
            class="btn"
            type="button"
            data-container-add-note="${escapeHtml(container.id)}"
          >
            + Add Note
          </button>
        </div>

        <div
          class="note-list"
          id="containerNotes-${escapeHtml(container.id)}"
        >
          <div class="empty-state">
            Open the container to load notes.
          </div>
        </div>
      </section>

    </div>
  `;
}


function bindContainerRowEvents() {
  document
    .querySelectorAll("[data-container-toggle]")
    .forEach(element => {
      element.addEventListener(
        "click",
        async event => {
          if (
            event.target.closest(
              "[data-container-refresh]"
            ) ||
            event.target.closest(
              "[data-container-edit]"
            ) ||
            event.target.closest(
              "[data-container-upload-file]"
            ) ||
            event.target.closest(
              "[data-container-upload-photo]"
            ) ||
            event.target.closest(
              "[data-container-add-note]"
            )
          ) {
            return;
          }

          const containerId =
            element.dataset.containerToggle;

          if (
            state.expandedContainers.has(
              containerId
            )
          ) {
            state.expandedContainers.delete(
              containerId
            );
          } else {
            state.expandedContainers.add(
              containerId
            );
          }

          renderContainers();
        }
      );
    });


  document
    .querySelectorAll("[data-container-refresh]")
    .forEach(button => {
      button.addEventListener(
        "click",
        async event => {
          event.stopPropagation();

          const containerId =
            button.dataset.containerRefresh;

          clearContainerDetailCache(
            containerId
          );

          await loadCompleteContainerDetail(
            containerId
          );

          showToast(
            "Container details refreshed.",
            "ok"
          );
        }
      );
    });


  document
    .querySelectorAll("[data-container-upload-file]")
    .forEach(button => {
      button.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          openAttachmentModal(
            button.dataset.containerUploadFile,
            "other"
          );
        }
      );
    });


  document
    .querySelectorAll("[data-container-upload-photo]")
    .forEach(button => {
      button.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          openAttachmentModal(
            button.dataset.containerUploadPhoto,
            "container_photo"
          );
        }
      );
    });


  document
    .querySelectorAll("[data-container-add-note]")
    .forEach(button => {
      button.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          openContainerNoteModal(
            button.dataset.containerAddNote
          );
        }
      );
    });


  document
    .querySelectorAll("[data-container-edit]")
    .forEach(button => {
      button.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          showToast(
            "Editing the container will be added in the next step.",
            "ok"
          );
        }
      );
    });
}


function renderLoadedContainerLines(containerId) {
  const target = byId(
    `containerLines-${containerId}`
  );

  if (!target) {
    return;
  }

  const lines =
    state.loadedContainerLines.get(
      String(containerId)
    );

  if (!lines) {
    target.innerHTML = `
      <div class="empty-state">
        Loading products...
      </div>
    `;

    return;
  }

  if (!lines.length) {
    target.innerHTML = `
      <div class="empty-state">
        No products have been added to this container.
      </div>
    `;

    return;
  }

  target.innerHTML = `
    <table class="inbound-table">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Product</th>
          <th>Units</th>
          <th>Packages</th>
          <th>Package Split</th>
          <th>Volume</th>
          <th>Weight</th>
          <th>Expected Orders</th>
          <th>Free After Receipt</th>
        </tr>
      </thead>

      <tbody>
        ${lines
          .map(line =>
            renderContainerLine(line)
          )
          .join("")}
      </tbody>
    </table>
  `;
}


function renderContainerLine(line) {
  const allocations =
    line.expected_allocations || [];

  const allocatedQuantity =
    allocations.reduce(
      (total, allocation) =>
        total +
        integerValue(
          allocation.expected_quantity
        ),
      0
    );

  const expectedQuantity =
    integerValue(
      line.expected_quantity
    );

  const freeQuantity =
    Math.max(
      0,
      expectedQuantity -
      allocatedQuantity
    );

  const orderNumbers = uniqueValues(
    allocations.map(allocation =>
      allocation.orders?.order_number ||
      allocation.order_number
    )
  );

  const packagesPerUnit = Math.max(
    1,
    integerValue(
      line.packages_per_unit,
      1
    )
  );

  const packageSplit = Array.from(
    {
      length: packagesPerUnit
    },
    (_, index) =>
      `${index + 1}/${packagesPerUnit}`
  ).join(" + ");

  return `
    <tr>
      <td>
        <strong>
          ${escapeHtml(line.sku_snapshot)}
        </strong>
      </td>

      <td>
        ${escapeHtml(
          line.product_name_snapshot ||
          line.description_snapshot ||
          "—"
        )}
      </td>

      <td>
        ${formatNumber(expectedQuantity)}
      </td>

      <td>
        ${formatNumber(line.expected_packages)}
      </td>

      <td>
        ${escapeHtml(packageSplit)}
      </td>

      <td>
        ${formatNumber(
          line.expected_volume_m3,
          3
        )} m³
      </td>

      <td>
        ${formatNumber(
          line.expected_weight_kg,
          1
        )} kg
      </td>

      <td>
        ${
          orderNumbers.length
            ? escapeHtml(
                orderNumbers.join(", ")
              )
            : "—"
        }
      </td>

      <td>
        <strong>
          ${formatNumber(freeQuantity)}
        </strong>
      </td>
    </tr>
  `;
}

/* =========================================================
   ATTACHMENT UPLOAD MODAL
   ========================================================= */

function ensureAttachmentModal() {
  const modal =
    byId("attachmentModal");

  if (!modal) {
    throw new Error(
      "Attachment modal is missing from inbound-containers.html."
    );
  }


  /*
   * Niet steeds opnieuw listeners toevoegen.
   */
  if (
    modal.dataset.eventsBound ===
    "true"
  ) {
    return modal;
  }


  const closeButton =
    byId(
      "btnCloseAttachmentModal"
    );

  const cancelButton =
    byId(
      "btnCancelAttachment"
    );

  const uploadButton =
    byId(
      "btnUploadAttachment"
    );

  const fileInput =
    byId(
      "attachmentFileInput"
    );

  const typeSelect =
    byId(
      "attachmentType"
    );


  /*
   * Kruisje
   */
  if (closeButton) {
    closeButton.onclick =
      closeAttachmentModal;
  }


  /*
   * Cancel
   */
  if (cancelButton) {
    cancelButton.onclick =
      closeAttachmentModal;
  }


  /*
   * Klik op achtergrond sluit modal.
   */
  modal.onclick =
    event => {
      if (
        event.target === modal
      ) {
        closeAttachmentModal();
      }
    };


  /*
   * Bestand(en) gekozen.
   */
  if (fileInput) {
    fileInput.onchange =
      () => {
        const files =
          Array.from(
            fileInput.files || []
          );

        const label =
          byId(
            "attachmentFileLabel"
          );

        if (!label) {
          return;
        }


        if (!files.length) {
          label.textContent =
            "No files selected";

          return;
        }


        const totalSize =
          files.reduce(
            (
              total,
              file
            ) =>
              total +
              numberValue(
                file.size,
                0
              ),
            0
          );


        label.textContent =
          `${files.length} ` +
          `${files.length === 1
            ? "file"
            : "files"
          } selected · ` +
          `${formatNumber(
            totalSize / 1024,
            0
          )} KB`;
      };
  }


  /*
   * Wisselen tussen:
   * Container Photo
   * Product Photo
   * Damage Photo
   * Document
   */
  if (typeSelect) {
    typeSelect.onchange =
      updateAttachmentModalType;
  }


  /*
   * Upload
   */
  if (uploadButton) {
    uploadButton.onclick =
      async () => {
        uploadButton.disabled =
          true;

        uploadButton.textContent =
          "Uploading...";

        try {
          await saveContainerAttachment();
        } catch (error) {
          console.error(
            "Attachment upload failed:",
            error
          );

          showToast(
            error.message ||
            "Files could not be uploaded.",
            "err"
          );
        } finally {
          uploadButton.disabled =
            false;

          updateAttachmentModalType();
        }
      };
  }


  modal.dataset.eventsBound =
    "true";

  return modal;
}

async function openAttachmentModal(
  containerId,
  attachmentType = "other"
) {
  const modal =
    ensureAttachmentModal();


  state.activeAttachmentContainerId =
    String(containerId);


  const containerInput =
    byId(
      "attachmentContainerId"
    );

  const input =
    byId(
      "attachmentFileInput"
    );

  const typeSelect =
    byId(
      "attachmentType"
    );

  const productSelect =
    byId(
      "attachmentProductLine"
    );

  const note =
    byId(
      "attachmentNote"
    );

  const label =
    byId(
      "attachmentFileLabel"
    );


  if (containerInput) {
    containerInput.value =
      String(containerId);
  }


  if (input) {
    input.value =
      "";
  }


  if (note) {
    note.value =
      "";
  }


  if (label) {
    label.textContent =
      "No files selected";
  }


  if (productSelect) {
    productSelect.value =
      "";
  }


  if (typeSelect) {
    typeSelect.value =
      attachmentType;
  }


  await populateAttachmentProductLines(
    containerId
  );


  updateAttachmentModalType();


  modal.classList.add(
    "open"
  );
}
function updateAttachmentModalType() {
  const type =
    normalize(
      byId(
        "attachmentType"
      )?.value
    );

  const input =
    byId(
      "attachmentFileInput"
    );

  const productWrap =
    byId(
      "attachmentProductWrap"
    );

  const productSelect =
    byId(
      "attachmentProductLine"
    );

  const title =
    byId(
      "attachmentModalTitle"
    );

  const subtitle =
    byId(
      "attachmentModalSubtitle"
    );

  const uploadButton =
    byId(
      "btnUploadAttachment"
    );


  const isPhoto =
    [
      "container_photo",
      "product_photo",
      "damage_photo"
    ].includes(type);


  /*
   * Foto's:
   * meerdere bestanden toegestaan.
   */
  if (input) {
    if (isPhoto) {
      input.accept =
        "image/*";

      input.multiple =
        true;
    } else {
      input.accept =
        ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt";

      input.multiple =
        false;
    }
  }


  /*
   * Product selector.
   *
   * Product Photo:
   * verplicht.
   *
   * Damage Photo:
   * beschikbaar maar niet verplicht.
   */
  if (productWrap) {
    productWrap.style.display =
      [
        "product_photo",
        "damage_photo"
      ].includes(type)
        ? ""
        : "none";
  }


  if (
    ![
      "product_photo",
      "damage_photo"
    ].includes(type) &&
    productSelect
  ) {
    productSelect.value =
      "";
  }


  if (
    type ===
    "product_photo"
  ) {
    if (title) {
      title.textContent =
        "Upload Product Photos";
    }

    if (subtitle) {
      subtitle.textContent =
        "Select a product and upload one or more photos.";
    }

    if (uploadButton) {
      uploadButton.textContent =
        "Upload Photos";
    }

    return;
  }


  if (
    type ===
    "damage_photo"
  ) {
    if (title) {
      title.textContent =
        "Upload Damage Photos";
    }

    if (subtitle) {
      subtitle.textContent =
        "Upload damage photos and optionally select the affected product.";
    }

    if (uploadButton) {
      uploadButton.textContent =
        "Upload Photos";
    }

    return;
  }


  if (
    type ===
    "container_photo"
  ) {
    if (title) {
      title.textContent =
        "Upload Container Photos";
    }

    if (subtitle) {
      subtitle.textContent =
        "Upload one or more container or unloading photos.";
    }

    if (uploadButton) {
      uploadButton.textContent =
        "Upload Photos";
    }

    return;
  }


  if (title) {
    title.textContent =
      "Upload File";
  }

  if (subtitle) {
    subtitle.textContent =
      "Add a document or other file to this inbound container.";
  }

  if (uploadButton) {
    uploadButton.textContent =
      "Upload File";
  }
}

async function populateAttachmentProductLines(
  containerId
) {
  const select =
    byId(
      "attachmentProductLine"
    );

  if (!select) {
    return;
  }


  let lines =
    state.loadedContainerLines
      .get(
        String(containerId)
      );


  if (!lines) {
    lines =
      await loadContainerLines(
        containerId
      );
  }


  select.innerHTML =
    `
      <option value="">
        Select product
      </option>
    ` +
    (lines || [])
      .map(
        line => {
          const sku =
            line.sku_snapshot ||
            "Unknown SKU";

          const name =
            line.product_name_snapshot ||
            line.description_snapshot ||
            "";

          const quantity =
            integerValue(
              line.expected_quantity,
              0
            );

          return `
            <option
              value="${escapeHtml(line.id)}"
              data-sku="${escapeHtml(sku)}"
              data-name="${escapeHtml(name)}"
            >
              ${escapeHtml(sku)}
              ${name
                ? ` · ${escapeHtml(name)}`
                : ""
              }
              · Qty ${formatNumber(quantity)}
            </option>
          `;
        }
      )
      .join("");
}

function closeAttachmentModal() {
  const modal =
    byId(
      "attachmentModal"
    );

  if (modal) {
    modal.classList.remove(
      "open"
    );
  }


  const input =
    byId(
      "attachmentFileInput"
    );

  if (input) {
    input.value =
      "";
  }


  const label =
    byId(
      "attachmentFileLabel"
    );

  if (label) {
    label.textContent =
      "No files selected";
  }


  state.activeAttachmentContainerId =
    null;

  state.attachmentFile =
    null;
}

async function saveContainerAttachment() {
  const containerId =
    state.activeAttachmentContainerId;

  if (!containerId) {
    throw new Error(
      "No container selected."
    );
  }


  const input =
    byId(
      "attachmentFileInput"
    );


  const files =
    Array.from(
      input?.files || []
    );


  if (!files.length) {
    throw new Error(
      "Select at least one file."
    );
  }


  const attachmentType =
    normalize(
      byId(
        "attachmentType"
      )?.value ||
      "other"
    );


  const productSelect =
    byId(
      "attachmentProductLine"
    );


  const selectedProductLineId =
    productSelect?.value ||
    "";


  /*
   * Product Photo moet altijd
   * aan een product worden gekoppeld.
   */
  if (
    attachmentType ===
      "product_photo" &&
    !selectedProductLineId
  ) {
    throw new Error(
      "Select the product these photos belong to."
    );
  }


  const selectedOption =
    productSelect
      ?.selectedOptions?.[0] ||
    null;


  const selectedSku =
    selectedOption
      ?.dataset?.sku ||
    "";


  const selectedName =
    selectedOption
      ?.dataset?.name ||
    "";


  const userNote =
    byId(
      "attachmentNote"
    )
      ?.value
      ?.trim() ||
    "";


  /*
   * Voor productfoto's slaan we SKU en
   * productnaam tevens in de note op.
   *
   * receipt_line_id laten we bewust leeg.
   * Dat veld is bedoeld voor ontvangstregels,
   * niet voor inbound_container_lines.
   */
  let note =
    userNote ||
    null;


  if (
    selectedSku &&
    [
      "product_photo",
      "damage_photo"
    ].includes(
      attachmentType
    )
  ) {
    const productPrefix =
      `Product: ${selectedSku}` +
      (
        selectedName
          ? ` · ${selectedName}`
          : ""
      );


    note =
      userNote
        ? `${productPrefix}\n${userNote}`
        : productPrefix;
  }


  const isPhoto =
    [
      "container_photo",
      "product_photo",
      "damage_photo"
    ].includes(
      attachmentType
    );


  /*
   * Documenten blijven één bestand.
   */
  if (
    !isPhoto &&
    files.length > 1
  ) {
    throw new Error(
      "Only one document can be uploaded at a time."
    );
  }


  const db =
    getDb();


  let uploadedCount =
    0;


  for (const file of files) {

    /*
     * Foto-types mogen alleen afbeeldingen zijn.
     */
    if (
      isPhoto &&
      !String(
        file.type || ""
      )
        .toLowerCase()
        .startsWith(
          "image/"
        )
    ) {
      throw new Error(
        `${file.name} is not an image file.`
      );
    }


    const safeFileName =
      file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );


    let folder =
      "documents";


    if (
      attachmentType ===
      "container_photo"
    ) {
      folder =
        "photos/container";
    }


    if (
      attachmentType ===
      "product_photo"
    ) {
      folder =
        selectedSku
          ? `photos/products/${selectedSku}`
          : "photos/products";
    }


    if (
      attachmentType ===
      "damage_photo"
    ) {
      folder =
        selectedSku
          ? `photos/damage/${selectedSku}`
          : "photos/damage";
    }


    const storagePath =
      `${state.companyId}/` +
      `${containerId}/` +
      `${folder}/` +
      `${Date.now()}-` +
      `${Math.random()
        .toString(36)
        .slice(2, 8)}-` +
      `${safeFileName}`;


    const {
      error: uploadError
    } =
      await db
        .storage
        .from(
          "inbound-assets"
        )
        .upload(
          storagePath,
          file,
          {
            cacheControl:
              "3600",

            upsert:
              false,

            contentType:
              file.type ||
              "application/octet-stream"
          }
        );


    if (uploadError) {
      throw uploadError;
    }


    const {
      error: attachmentError
    } =
      await db
        .from(
          "inbound_attachments"
        )
        .insert({
          company_id:
            state.companyId,

          container_id:
            containerId,

          /*
           * Niet invullen met
           * inbound_container_lines.id.
           */
          receipt_line_id:
            null,

          attachment_type:
            attachmentType,

          file_name:
            file.name,

          storage_bucket:
            "inbound-assets",

          storage_path:
            storagePath,

          mime_type:
            file.type ||
            "application/octet-stream",

          file_size:
            file.size ||
            null,

          note,

          uploaded_by:
            state.profile?.id ||
            null,

          uploaded_at:
            new Date()
              .toISOString()
        });


    if (attachmentError) {

      /*
       * Storage opruimen wanneer
       * database-insert mislukt.
       */
      await db
        .storage
        .from(
          "inbound-assets"
        )
        .remove([
          storagePath
        ]);


      throw attachmentError;
    }


    uploadedCount +=
      1;
  }


  /*
   * Attachment-cache opnieuw ophalen.
   */
  state.loadedContainerAttachments
    .delete(
      String(containerId)
    );


  await loadContainerAttachments(
    containerId
  );


  renderLoadedContainerAttachments(
    containerId
  );


  closeAttachmentModal();


  showToast(
    uploadedCount === 1
      ? "1 file uploaded."
      : `${uploadedCount} photos uploaded.`,
    "ok"
  );
}
  /* =========================================================
     NEW CONTAINER MODAL
     ========================================================= */

  function resetContainerModal() {
    const textFields = [
      "containerNumber",
      "sealNumber",
      "vesselName",
      "voyageNumber",
      "shippingLine",
      "carrierName",
      "supplierReference",
      "etdDate",
      "etaPortDate",
      "etaWarehouseDate",
      "containerNotes"
    ];

    textFields.forEach(id => {
      const element = byId(id);

      if (element) {
        element.value = "";
      }
    });

    if (byId("containerOwner")) {
      byId("containerOwner").value = "";
    }

    if (byId("containerType")) {
      byId("containerType").value = "";
    }

    if (byId("warehouseSelect")) {
      byId("warehouseSelect").value = "";
    }

    if (byId("locationSelect")) {
      byId("locationSelect").value = "";
    }

    if (byId("containerStatus")) {
      byId("containerStatus").value =
        "expected";
    }

    if (byId("productQty")) {
      byId("productQty").value = "1";
    }

    if (byId("packingListInput")) {
      byId("packingListInput").value = "";
    }

    if (byId("packingListLabel")) {
      byId("packingListLabel").textContent =
        "No file selected";
    }

    state.draftLines = [];
    state.packingListFile = null;

    renderProductSelector();
    renderLocationSelector();
    renderDraftLines();
  }

  function openContainerModal() {
    resetContainerModal();

    byId("containerModal")
      ?.classList
      .add("open");
  }

  function closeContainerModal() {
    byId("containerModal")
      ?.classList
      .remove("open");
  }

  /* =========================================================
     DRAFT PRODUCTS
     ========================================================= */

  function addDraftProduct() {
    const productId =
      byId("productSelect")?.value || "";

    const quantity = Math.max(
      1,
      integerValue(
        byId("productQty")?.value,
        1
      )
    );

    const product = state.products.find(
      row =>
        String(row.id) ===
        String(productId)
    );

    if (!product) {
      showToast(
        "Select a product first.",
        "err"
      );

      return;
    }

    const existing =
      state.draftLines.find(
        line =>
          String(line.product.id) ===
          String(product.id)
      );

    if (existing) {
      existing.quantity += quantity;
    } else {
      state.draftLines.push({
        product,
        quantity
      });
    }

    if (byId("productQty")) {
      byId("productQty").value = "1";
    }

    renderDraftLines();
  }

  function renderDraftLines() {
    const target = byId("draftLines");

    if (!target) {
      return;
    }

    if (!state.draftLines.length) {
      target.innerHTML = `
        <div class="empty-state">
          No products added yet.
        </div>
      `;

      return;
    }

    target.innerHTML = state.draftLines
      .map((line, index) => {
        const packagesPerUnit =
          getPackagesPerUnit(
            line.product
          );

        const totalPackages =
          line.quantity *
          packagesPerUnit;

        const volume =
          line.quantity *
          getProductVolume(
            line.product
          );

        const weight =
          line.quantity *
          getProductWeight(
            line.product
          );

        const packageLabels = Array.from(
          {
            length: packagesPerUnit
          },
          (_, packageIndex) =>
            `${packageIndex + 1}/${packagesPerUnit}`
        ).join(", ");

        return `
          <div class="draft-line">
            <div>
              <strong>
                ${escapeHtml(
                  getProductLabel(
                    line.product
                  )
                )}
              </strong>

              <span>
                ${
                  packagesPerUnit > 1
                    ? `${packagesPerUnit} packages per unit: ${escapeHtml(packageLabels)}`
                    : "1 package per unit"
                }
              </span>
            </div>

            <div>
              <strong>
                ${formatNumber(line.quantity)}
              </strong>

              <span>Units</span>
            </div>

            <div>
              <strong>
                ${formatNumber(totalPackages)}
              </strong>

              <span>Packages</span>
            </div>

            <div>
              <strong>
                ${formatNumber(volume, 3)}
              </strong>

              <span>m³</span>
            </div>

            <div>
              <strong>
                ${formatNumber(weight, 1)}
              </strong>

              <span>kg</span>
            </div>

            <button
              class="btn"
              type="button"
              data-draft-remove="${index}"
            >
              Remove
            </button>
          </div>
        `;
      })
      .join("");

    document
      .querySelectorAll("[data-draft-remove]")
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const index = integerValue(
              button.dataset.draftRemove,
              -1
            );

            if (index < 0) {
              return;
            }

            state.draftLines.splice(
              index,
              1
            );

            renderDraftLines();
          }
        );
      });
  }

  /* =========================================================
     DATABASE INSERT
     ========================================================= */

  function makeContainerPayload() {
    return {
      company_id:
        state.companyId,

      product_owner_id:
        byId("containerOwner").value,

      container_number:
        byId("containerNumber")
          .value
          .trim(),

      container_type:
        byId("containerType").value ||
        null,

      seal_number:
        byId("sealNumber")
          .value
          .trim() ||
        null,

      vessel_name:
        byId("vesselName")
          .value
          .trim() ||
        null,

      voyage_number:
        byId("voyageNumber")
          .value
          .trim() ||
        null,

      shipping_line:
        byId("shippingLine")
          .value
          .trim() ||
        null,

      carrier_name:
        byId("carrierName")
          .value
          .trim() ||
        null,

      supplier_reference:
        byId("supplierReference")
          .value
          .trim() ||
        null,

      etd_date:
        byId("etdDate").value ||
        null,

      eta_port_date:
        byId("etaPortDate").value ||
        null,

      eta_warehouse_date:
        byId("etaWarehouseDate").value ||
        null,

      warehouse_id:
        byId("warehouseSelect").value ||
        null,

      location_id:
        byId("locationSelect").value ||
        null,

      status:
        byId("containerStatus").value ||
        "expected",

      notes:
        byId("containerNotes")
          .value
          .trim() ||
        null,

      created_by:
        state.profile?.id ||
        null
    };
  }

  function validateContainerPayload(payload) {
    if (!payload.product_owner_id) {
      throw new Error(
        "Select a product owner."
      );
    }

    if (!payload.container_number) {
      throw new Error(
        "Enter a container number."
      );
    }

    if (!payload.eta_warehouse_date) {
      throw new Error(
        "Enter the expected warehouse arrival date."
      );
    }

    if (!state.draftLines.length) {
      throw new Error(
        "Add at least one product."
      );
    }
  }

  function makeLinePayload(
    containerId,
    line,
    index
  ) {
    const product = line.product;

    const packagesPerUnit =
      getPackagesPerUnit(product);

    return {
      company_id:
        state.companyId,

      container_id:
        containerId,

      product_id:
        product.id,

      line_number:
        index + 1,

      expected_quantity:
        line.quantity,

      expected_packages:
        line.quantity *
        packagesPerUnit,

      packages_per_unit:
        packagesPerUnit,

      sku_snapshot:
        product.sku_base ||
        product.sku ||
        product.product_code ||
        "UNKNOWN",

      product_name_snapshot:
        product.name ||
        null,

      description_snapshot:
        product.description ||
        null,

      unit_volume_m3:
        getProductVolume(product),

      unit_weight_kg:
        getProductWeight(product),

      package_1_qty:
        integerValue(
          product.package_1_qty
        ),

      package_2_qty:
        integerValue(
          product.package_2_qty
        ),

      package_3_qty:
        integerValue(
          product.package_3_qty
        ),

      package_1_volume_m3:
        numberValue(
          product.package_1_volume_m3
        ),

      package_2_volume_m3:
        numberValue(
          product.package_2_volume_m3
        ),

      package_3_volume_m3:
        numberValue(
          product.package_3_volume_m3
        ),

      package_1_weight_kg:
        numberValue(
          product.package_1_weight_kg
        ),

      package_2_weight_kg:
        numberValue(
          product.package_2_weight_kg
        ),

      package_3_weight_kg:
        numberValue(
          product.package_3_weight_kg
        )
    };
  }

  async function uploadPackingList(
    containerId
  ) {
    const file =
      state.packingListFile;

    if (!file) {
      return null;
    }

    const safeFileName = file.name
      .replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

    const storagePath =
      `${state.companyId}/` +
      `${containerId}/` +
      `packing-list/` +
      `${Date.now()}-${safeFileName}`;

    const db = getDb();

    const {
      error: uploadError
    } = await db
      .storage
      .from("inbound-assets")
      .upload(
        storagePath,
        file,
        {
          cacheControl: "3600",
          upsert: false,
          contentType:
            file.type ||
            "application/pdf"
        }
      );

    if (uploadError) {
      throw uploadError;
    }

    const {
      error: attachmentError
    } = await db
      .from("inbound_attachments")
      .insert({
        company_id:
          state.companyId,

        container_id:
          containerId,

        attachment_type:
          "packing_list",

        file_name:
          file.name,

        storage_bucket:
          "inbound-assets",

        storage_path:
          storagePath,

        mime_type:
          file.type ||
          "application/pdf",

        file_size:
          file.size ||
          null,

        uploaded_by:
          state.profile?.id ||
          null
      });

    if (attachmentError) {
      throw attachmentError;
    }

    const {
      error: containerUpdateError
    } = await db
      .from("inbound_containers")
      .update({
        packing_list_path:
          storagePath,

        packing_list_name:
          file.name,

        packing_list_uploaded_at:
          new Date().toISOString()
      })
      .eq("id", containerId);

    if (containerUpdateError) {
      throw containerUpdateError;
    }

    return storagePath;
  }

  async function saveContainer() {
    const db = getDb();

    const payload =
      makeContainerPayload();

    validateContainerPayload(
      payload
    );

    const {
      data: container,
      error: containerError
    } = await db
      .from("inbound_containers")
      .insert(payload)
      .select("id, container_number")
      .single();

    if (containerError) {
      throw containerError;
    }

    try {
      const linePayloads =
        state.draftLines.map(
          (line, index) =>
            makeLinePayload(
              container.id,
              line,
              index
            )
        );

      const {
        error: lineError
      } = await db
        .from("inbound_container_lines")
        .insert(linePayloads);

      if (lineError) {
        throw lineError;
      }

      await uploadPackingList(
        container.id
      );

      const {
        error: logError
      } = await db
        .from("inbound_activity_log")
        .insert({
          company_id:
            state.companyId,

          container_id:
            container.id,

          event_type:
            "container_created",

          description:
            `Inbound container ` +
            `${container.container_number} ` +
            `created with ` +
            `${state.draftLines.length} ` +
            `product line(s).`,

          new_status:
            payload.status,

          created_by:
            state.profile?.id ||
            null
        });

      if (logError) {
        console.warn(
          "Activity log could not be written:",
          logError.message
        );
      }

      closeContainerModal();

      state.loadedContainerLines.clear();

      await loadContainers();

      showToast(
        `Container ${container.container_number} created.`,
        "ok"
      );
    } catch (error) {
      console.error(
        "Container creation failed:",
        error
      );

      /*
       * Verwijder de incomplete container wanneer de
       * productregels niet konden worden opgeslagen.
       */

      await db
        .from("inbound_containers")
        .delete()
        .eq("id", container.id);

      throw error;
    }
  }

  /* =========================================================
     TABS
     ========================================================= */

  function setActiveTab(tab) {
    state.activeTab = tab;

    byId("tabExpected")
      ?.classList
      .toggle(
        "active",
        tab === "expected"
      );

    byId("tabReceived")
      ?.classList
      .toggle(
        "active",
        tab === "received"
      );

    if (byId("listTitle")) {
      byId("listTitle").textContent =
        tab === "received"
          ? "Received Containers"
          : "Expected Containers";
    }

    if (byId("listSubtitle")) {
      byId("listSubtitle").textContent =
        tab === "received"
          ? "Containers already received and booked into warehouse stock."
          : "Containers that have not yet been received at the warehouse.";
    }

    renderContainers();
  }

  /* =========================================================
     EVENTS
     ========================================================= */

  function bindEvents() {
    byId("btnNewContainer")
      ?.addEventListener(
        "click",
        openContainerModal
      );

    byId("btnCloseContainerModal")
      ?.addEventListener(
        "click",
        closeContainerModal
      );

    byId("btnCancelContainer")
      ?.addEventListener(
        "click",
        closeContainerModal
      );

    byId("containerModal")
      ?.addEventListener(
        "click",
        event => {
          if (
            event.target ===
            byId("containerModal")
          ) {
            closeContainerModal();
          }
        }
      );

    byId("containerOwner")
      ?.addEventListener(
        "change",
        () => {
          state.draftLines = [];

          renderProductSelector();
          renderDraftLines();
        }
      );

    byId("warehouseSelect")
      ?.addEventListener(
        "change",
        renderLocationSelector
      );

    byId("btnAddProduct")
      ?.addEventListener(
        "click",
        addDraftProduct
      );

    byId("btnSelectPackingList")
      ?.addEventListener(
        "click",
        () => {
          byId("packingListInput")
            ?.click();
        }
      );

    byId("packingListInput")
      ?.addEventListener(
        "change",
        () => {
          state.packingListFile =
            byId("packingListInput")
              ?.files?.[0] ||
            null;

          if (byId("packingListLabel")) {
            byId("packingListLabel")
              .textContent =
              state.packingListFile
                ? `${state.packingListFile.name} · ` +
                  `${formatNumber(
                    state.packingListFile.size / 1024,
                    0
                  )} KB`
                : "No file selected";
          }
        }
      );

    byId("btnSaveContainer")
      ?.addEventListener(
        "click",
        async () => {
          const button =
            byId("btnSaveContainer");

          button.disabled = true;
          button.textContent = "Saving...";

          try {
            await saveContainer();
          } catch (error) {
            console.error(error);

            showToast(
              error.message ||
              "Container could not be saved.",
              "err"
            );
          } finally {
            button.disabled = false;
            button.textContent =
              "Save Container";
          }
        }
      );

    byId("filterSearch")
      ?.addEventListener(
        "input",
        renderContainers
      );

    [
      "filterOwner",
      "filterStatus",
      "filterEtaFrom",
      "filterEtaTo"
    ].forEach(id => {
      byId(id)
        ?.addEventListener(
          "change",
          renderContainers
        );
    });

    byId("btnClearFilters")
      ?.addEventListener(
        "click",
        clearFilters
      );

    byId("btnRefresh")
      ?.addEventListener(
        "click",
        async () => {
          try {
            state.loadedContainerLines.clear();

            await loadContainers();

            showToast(
              "Inbound containers refreshed.",
              "ok"
            );
          } catch (error) {
            showToast(
              error.message,
              "err"
            );
          }
        }
      );

    byId("tabExpected")
      ?.addEventListener(
        "click",
        () => {
          setActiveTab("expected");
        }
      );

    byId("tabReceived")
      ?.addEventListener(
        "click",
        () => {
          setActiveTab("received");
        }
      );

    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          byId("containerModal")
            ?.classList
            .contains("open")
        ) {
          closeContainerModal();
        }
      }
    );
  }

  /* =========================================================
     INIT
     ========================================================= */

  async function init() {
    try {
      await loadCurrentProfile();

      await loadReferenceData();

      bindEvents();

      await loadContainers();

      document.documentElement
        .classList
        .remove("auth-loading");

      showToast(
        "Inbound Containers loaded.",
        "ok"
      );
    } catch (error) {
      console.error(
        "Inbound Containers failed to initialise:",
        error
      );

      document.documentElement
        .classList
        .remove("auth-loading");

      showToast(
        error.message ||
        "Inbound Containers could not be loaded.",
        "err"
      );
    }
  }

  document.addEventListener(
    "DOMContentLoaded",
    init
  );
})();