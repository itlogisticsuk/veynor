(function () {
  "use strict";

  let client = null;
  let orderId = null;
  let stopId = null;
  let order = null;

  let activePhotoIndex = 0;
  let lightboxPhotoIndex = 0;

  let lightboxZoom = 1;
  let lightboxRotation = 0;
  let lightboxEnhanced = false;

  const $ = id => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function getClient() {
    if (client) return client;

    if (typeof sb === "function") {
      client = sb();
      return client;
    }

    if (
      window.supabase &&
      window.VEYNOR_CONFIG?.SUPABASE_URL &&
      window.VEYNOR_CONFIG?.SUPABASE_ANON_KEY
    ) {
      client = window.supabase.createClient(
        window.VEYNOR_CONFIG.SUPABASE_URL,
        window.VEYNOR_CONFIG.SUPABASE_ANON_KEY
      );

      return client;
    }

    throw new Error("Supabase client not available.");
  }

  function isMeaningful(value) {
    const text = clean(value);

    if (!text) return false;

    return ![
      "—",
      "-",
      "null",
      "undefined",
      "not recorded",
      "not available"
    ].includes(text.toLowerCase());
  }

  function formatDate(value) {
    if (!value) return "Not recorded";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return clean(value) || "Not recorded";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function formatTime(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDateTime(value) {
    if (!value) return "Not recorded";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return clean(value) || "Not recorded";
    }

    return `${formatDate(value)} · ${formatTime(value)}`;
  }

  function safeFileName(value, fallback = "download") {
    const result = clean(value || fallback)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");

    return result || fallback;
  }

  function getStop(orderData) {
    return (orderData?.route_stops || [])[0] || {};
  }

  function getOrderNumber(orderData) {
    return clean(orderData?.order_number) || "Order";
  }

  function getAckNumber(orderData) {
    const value = clean(
      orderData?.external_reference ||
      orderData?.ack_number ||
      orderData?.supplier_reference ||
      ""
    );

    return value;
  }

  function getPurchaseOrder(orderData) {
    return clean(
      orderData?.purchase_order ||
      orderData?.po_number ||
      ""
    );
  }

  function getRetailerName(orderData) {
    return clean(
      orderData?.retail_name ||
      orderData?.delivery_name ||
      orderData?.recipient_name ||
      "Delivery customer"
    );
  }

  function getProductOwnerName(orderData) {
    return clean(
      orderData?.customers?.name ||
      orderData?.customer_name ||
      ""
    );
  }

  function getRouteName(orderData) {
    return clean(
      orderData?.routes?.route_code ||
      orderData?.routes?.route_name ||
      orderData?.routes?.name ||
      ""
    );
  }

  function getDriverName(orderData) {
    return clean(
      orderData?.routes?.driver_name ||
      orderData?.driver_name ||
      ""
    );
  }

  function getReceivedBy(orderData) {
    const stop = getStop(orderData);

    return clean(
      stop.delivered_to ||
      orderData?.pod_signed_by ||
      ""
    );
  }

  function getDeliveryNotes(orderData) {
    const stop = getStop(orderData);

    return clean(
      stop.pod_notes ||
      orderData?.pod_notes ||
      ""
    );
  }

  function getDeliveryAddress(orderData) {
    return [
      orderData?.delivery_address_1,
      orderData?.delivery_address_2,
      orderData?.delivery_address_3,
      orderData?.delivery_address_4,
      orderData?.delivery_city,
      orderData?.delivery_postcode,
      orderData?.delivery_country
    ]
      .map(clean)
      .filter(Boolean);
  }

  function getDeliveryDate(orderData) {
    const stop = getStop(orderData);

    return (
      stop.completed_at ||
      stop.delivery_date ||
      orderData?.pod_completed_at ||
      orderData?.pod_signed_at ||
      orderData?.confirmed_delivery_date ||
      orderData?.delivered_at ||
      null
    );
  }

  function getDeliveryStatus(orderData) {
    const stop = getStop(orderData);

    return normalize(
      stop.delivery_status ||
      stop.status ||
      orderData?.transport_status ||
      orderData?.overall_status ||
      orderData?.status
    );
  }

  function getDeliveryStatusLabel(orderData) {
    const status = getDeliveryStatus(orderData);

    const map = {
      delivered: "Delivered",
      completed: "Delivered",
      pod_completed: "Delivered",
      signed: "Delivered",
      out_for_delivery: "Out for delivery",
      loaded: "Loaded",
      planned: "Planned",
      cancelled: "Cancelled",
      failed: "Delivery failed",
      refused: "Delivery refused"
    };

    return map[status] || "Proof of Delivery";
  }

  function getDeliveryStatusClass(orderData) {
    const status = getDeliveryStatus(orderData);

    if (
      [
        "delivered",
        "completed",
        "pod_completed",
        "signed"
      ].includes(status)
    ) {
      return "success";
    }

    if (
      [
        "cancelled",
        "failed",
        "refused"
      ].includes(status)
    ) {
      return "danger";
    }

    return "info";
  }

  function getPodDocument(orderData) {
    const documents = orderData?.order_documents || [];
    const assets = orderData?.order_pod_assets || [];

    const document = documents.find(item => {
      const type = normalize(item.document_type);

      return (
        ["pod", "signed_delivery_note"].includes(type) &&
        item.file_url
      );
    });

    if (document?.file_url) {
      return {
        url: document.file_url,
        fileName:
          document.document_number
            ? `${safeFileName(document.document_number)}.pdf`
            : `${safeFileName(getOrderNumber(orderData))}-POD.pdf`,
        createdAt:
          document.updated_at ||
          document.created_at ||
          null
      };
    }

    if (orderData?.pod_document_url) {
      return {
        url: orderData.pod_document_url,
        fileName: `${safeFileName(getOrderNumber(orderData))}-POD.pdf`,
        createdAt:
          orderData.pod_signed_at ||
          orderData.pod_completed_at ||
          null
      };
    }

    const asset = assets.find(item => {
      const type = normalize(item.asset_type);

      return (
        [
          "signed_delivery_note",
          "pod_pdf",
          "signed_pod_pdf"
        ].includes(type) &&
        item.file_url
      );
    });

    if (asset?.file_url) {
      return {
        url: asset.file_url,
        fileName:
          asset.file_name ||
          `${safeFileName(getOrderNumber(orderData))}-POD.pdf`,
        createdAt:
          asset.captured_at ||
          null
      };
    }

    return null;
  }

  function getPodPhotos(orderData) {
    return (orderData?.order_pod_assets || [])
      .filter(asset => {
        return (
          normalize(asset.asset_type) === "photo" &&
          asset.file_url
        );
      })
      .map((asset, index) => ({
        id: asset.id || `photo-${index + 1}`,
        url: asset.file_url,
        fileName:
          asset.file_name ||
          `Delivery-photo-${index + 1}.jpg`,
        capturedAt:
          asset.captured_at ||
          null,
        capturedBy:
          asset.captured_by_name ||
          "",
        notes:
          asset.notes ||
          ""
      }))
      .sort((a, b) => {
        const aTime = new Date(a.capturedAt || 0).getTime();
        const bTime = new Date(b.capturedAt || 0).getTime();

        return aTime - bTime;
      });
  }

  function getSignature(orderData) {
    const asset = (orderData?.order_pod_assets || [])
      .find(item => {
        const type = normalize(item.asset_type);

        return (
          [
            "signature",
            "customer_signature"
          ].includes(type) &&
          item.file_url
        );
      });

    const stop = getStop(orderData);

    const url =
      asset?.file_url ||
      stop.customer_signature ||
      "";

    if (!url) return null;

    return {
      url,
      capturedAt:
        asset?.captured_at ||
        stop.completed_at ||
        null,
      capturedBy:
        asset?.captured_by_name ||
        stop.delivered_to ||
        orderData?.pod_signed_by ||
        ""
    };
  }

  function renderStatusChip({
    icon,
    label,
    className = "neutral"
  }) {
    return `
      <span class="pod-status-chip ${esc(className)}">
        <span class="pod-status-chip-icon">
          ${esc(icon)}
        </span>

        <span>
          ${esc(label)}
        </span>
      </span>
    `;
  }

  function renderHero({
    orderNumber,
    ackNumber,
    purchaseOrder,
    retailer,
    productOwner,
    deliveryDate,
    deliveryStatusLabel,
    deliveryStatusClass,
    pdfDocument,
    photos
  }) {
    return `
      <section class="pod-hero">
        <div class="pod-hero-main">
          <div class="pod-eyebrow">
            Proof of Delivery
          </div>

          <div class="pod-reference-line">
            <h1 class="pod-hero-order">
              ${esc(orderNumber)}
            </h1>

            ${
              isMeaningful(ackNumber)
                ? `
                  <span class="pod-ack-badge">
                    <span class="pod-ack-icon">🧾</span>
                    <span>${esc(ackNumber)}</span>
                  </span>
                `
                : ""
            }
          </div>

          <div class="pod-hero-retailer">
            ${esc(retailer)}
          </div>

          ${
            isMeaningful(productOwner)
              ? `
                <div class="pod-hero-owner">
                  On behalf of ${esc(productOwner)}
                </div>
              `
              : ""
          }

          <div class="pod-status-row">
            ${renderStatusChip({
              icon: "✓",
              label: deliveryStatusLabel,
              className: deliveryStatusClass
            })}

            ${
              pdfDocument
                ? renderStatusChip({
                    icon: "📄",
                    label: "Signed Delivery Note",
                    className: "document"
                  })
                : ""
            }

            ${
              photos.length
                ? renderStatusChip({
                    icon: "📷",
                    label: `${photos.length} ${
                      photos.length === 1
                        ? "Delivery Photo"
                        : "Delivery Photos"
                    }`,
                    className: "photo"
                  })
                : ""
            }
          </div>

          ${
            deliveryDate
              ? `
                <div class="pod-hero-delivered">
                  Delivered ${esc(formatDateTime(deliveryDate))}
                </div>
              `
              : ""
          }
        </div>

        <div class="pod-hero-side">
          <div class="pod-hero-reference-card">
            <div class="pod-reference-row">
              <span>Sales order</span>
              <strong>${esc(orderNumber)}</strong>
            </div>

            ${
              isMeaningful(ackNumber)
                ? `
                  <div class="pod-reference-row">
                    <span>ACK / Supplier reference</span>
                    <strong>${esc(ackNumber)}</strong>
                  </div>
                `
                : ""
            }

            ${
              isMeaningful(purchaseOrder)
                ? `
                  <div class="pod-reference-row">
                    <span>Purchase order</span>
                    <strong>${esc(purchaseOrder)}</strong>
                  </div>
                `
                : ""
            }
          </div>

          ${
            pdfDocument
              ? `
                <a
                  class="pod-primary-action"
                  href="${esc(pdfDocument.url)}"
                  target="_blank"
                  rel="noopener"
                >
                  <span class="pod-primary-action-icon">
                    📄
                  </span>

                  <span class="pod-primary-action-copy">
                    <strong>
                      Open Signed Delivery Note
                    </strong>

                    <small>
                      View or download PDF
                    </small>
                  </span>

                  <span class="pod-primary-action-arrow">
                    →
                  </span>
                </a>
              `
              : ""
          }
        </div>
      </section>
    `;
  }

  function renderDocumentCard(pdfDocument, orderNumber) {
    if (!pdfDocument) {
      return `
        <section class="pod-section-card">
          <div class="pod-section-head">
            <div>
              <span class="pod-section-kicker">
                Document
              </span>

              <h2>Signed Delivery Note</h2>

              <p>
                The signed delivery document has not been uploaded yet.
              </p>
            </div>
          </div>

          <div class="pod-empty-state">
            <div class="pod-empty-icon">
              📄
            </div>

            <div>
              <strong>No PDF available</strong>

              <span>
                The signed delivery note will appear here after upload.
              </span>
            </div>
          </div>
        </section>
      `;
    }

    const fileName = safeFileName(
      pdfDocument.fileName,
      `${orderNumber}-POD.pdf`
    );

    return `
      <section class="pod-section-card">
        <div class="pod-section-head">
          <div>
            <span class="pod-section-kicker">
              Document
            </span>

            <h2>Signed Delivery Note</h2>

            <p>
              Open the signed document containing the delivery confirmation and POD information.
            </p>
          </div>

          <span class="pod-section-count">
            PDF
          </span>
        </div>

        <div class="pod-document-card">
          <div class="pod-document-preview">
            <div class="pod-document-preview-page">
              <div class="pod-document-preview-top">
                <span>VEYNOR</span>
                <span>POD</span>
              </div>

              <div class="pod-document-preview-lines">
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </div>

              <div class="pod-document-preview-signature">
                Signed
              </div>
            </div>
          </div>

          <div class="pod-document-details">
            <span class="pod-document-type">
              Signed PDF
            </span>

            <h3>
              ${esc(fileName)}
            </h3>

            ${
              pdfDocument.createdAt
                ? `
                  <p>
                    Added ${esc(formatDateTime(pdfDocument.createdAt))}
                  </p>
                `
                : ""
            }

            <div class="pod-document-actions">
              <a
                class="pod-btn pod-btn-primary"
                href="${esc(pdfDocument.url)}"
                target="_blank"
                rel="noopener"
              >
                Open PDF
              </a>

             <button
  class="pod-btn"
  type="button"
  id="podDownloadPdfBtn"
  data-url="${esc(pdfDocument.url)}"
  data-file-name="${esc(fileName)}"
>
  Download
</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderPhotoViewer(photos) {
    if (!photos.length) {
      return `
        <section class="pod-section-card">
          <div class="pod-section-head">
            <div>
              <span class="pod-section-kicker">
                Evidence
              </span>

              <h2>Delivery Photos</h2>

              <p>
                Delivery photos will appear here after upload.
              </p>
            </div>
          </div>

          <div class="pod-empty-state">
            <div class="pod-empty-icon">
              📷
            </div>

            <div>
              <strong>No delivery photos available</strong>

              <span>
                No visual delivery evidence has been uploaded for this order.
              </span>
            </div>
          </div>
        </section>
      `;
    }

    const activePhoto =
      photos[activePhotoIndex] ||
      photos[0];

    return `
      <section class="pod-section-card">
        <div class="pod-section-head">
          <div>
            <span class="pod-section-kicker">
              Evidence
            </span>

            <h2>Delivery Photos</h2>

            <p>
              Select a thumbnail or open the full-size viewer.
            </p>
          </div>

          <span class="pod-section-count">
            ${photos.length}
          </span>
        </div>

        <div class="pod-gallery-shell">
          <div class="pod-gallery-main-wrap">
            <button
              type="button"
              class="pod-gallery-main"
              id="podGalleryMain"
              aria-label="Open current delivery photo"
            >
              <img
                id="podGalleryMainImage"
                src="${esc(activePhoto.url)}"
                alt="Delivery photo ${activePhotoIndex + 1}"
              />

              <span class="pod-gallery-main-overlay">
                <span>
                  Photo ${activePhotoIndex + 1} of ${photos.length}
                </span>

                <span class="pod-gallery-open-label">
                  Open fullscreen
                </span>
              </span>
            </button>

            <div class="pod-gallery-details">
              <div>
                <span class="pod-gallery-detail-label">
                  Captured
                </span>

                <strong id="podGalleryCaptured">
                  ${
                    activePhoto.capturedAt
                      ? esc(formatDateTime(activePhoto.capturedAt))
                      : "Not recorded"
                  }
                </strong>
              </div>

              ${
                isMeaningful(activePhoto.capturedBy)
                  ? `
                    <div>
                      <span class="pod-gallery-detail-label">
                        Captured by
                      </span>

                      <strong id="podGalleryCapturedBy">
                        ${esc(activePhoto.capturedBy)}
                      </strong>
                    </div>
                  `
                  : ""
              }

              <div class="pod-gallery-actions">
                <button
                  type="button"
                  class="pod-btn"
                  id="podGalleryEnhance"
                >
                  Enhance preview
                </button>

                <button
                  type="button"
                  class="pod-btn pod-btn-primary"
                  id="podGalleryOpen"
                >
                  Open fullscreen
                </button>
              </div>
            </div>
          </div>

          ${
            photos.length > 1
              ? `
                <div class="pod-thumbnail-strip">
                  ${photos.map((photo, index) => `
                    <button
                      type="button"
                      class="pod-thumbnail ${
                        index === activePhotoIndex
                          ? "active"
                          : ""
                      }"
                      data-photo-index="${index}"
                      aria-label="Select photo ${index + 1}"
                    >
                      <img
                        src="${esc(photo.url)}"
                        alt="Delivery photo ${index + 1}"
                        loading="lazy"
                      />

                      <span>
                        ${index + 1}
                      </span>
                    </button>
                  `).join("")}
                </div>
              `
              : ""
          }
        </div>
      </section>
    `;
  }

  function renderInfoItem({
    icon,
    label,
    value,
    sub = ""
  }) {
    if (!isMeaningful(value)) return "";

    return `
      <article class="pod-info-card">
        <div class="pod-info-icon">
          ${esc(icon)}
        </div>

        <div class="pod-info-content">
          <span class="pod-info-label">
            ${esc(label)}
          </span>

          <strong class="pod-info-value">
            ${esc(value)}
          </strong>

          ${
            isMeaningful(sub)
              ? `
                <span class="pod-info-sub">
                  ${esc(sub)}
                </span>
              `
              : ""
          }
        </div>
      </article>
    `;
  }

  function renderDeliveryInformation({
    deliveryDate,
    receivedBy,
    driver,
    route,
    notes,
    address
  }) {
    const items = [
      renderInfoItem({
        icon: "✓",
        label: "Delivered",
        value:
          deliveryDate
            ? formatDate(deliveryDate)
            : "",
        sub:
          deliveryDate
            ? formatTime(deliveryDate)
            : ""
      }),

      renderInfoItem({
        icon: "👤",
        label: "Received by",
        value: receivedBy
      }),

      renderInfoItem({
        icon: "🚚",
        label: "Driver",
        value: driver
      }),

      renderInfoItem({
        icon: "↗",
        label: "Route",
        value: route
      })
    ].filter(Boolean);

    const addressHtml = address.length
      ? `
        <div class="pod-address-card">
          <div class="pod-address-icon">
            📍
          </div>

          <div>
            <span class="pod-info-label">
              Delivered to
            </span>

            <strong class="pod-address-value">
              ${address.map(line => esc(line)).join("<br>")}
            </strong>
          </div>
        </div>
      `
      : "";

    const notesHtml = isMeaningful(notes)
      ? `
        <div class="pod-notes-card">
          <span class="pod-info-label">
            Delivery notes
          </span>

          <p>
            ${esc(notes)}
          </p>
        </div>
      `
      : "";

    if (
      !items.length &&
      !addressHtml &&
      !notesHtml
    ) {
      return "";
    }

    return `
      <section class="pod-section-card">
        <div class="pod-section-head">
          <div>
            <span class="pod-section-kicker">
              Confirmation
            </span>

            <h2>Delivery Information</h2>

            <p>
              Confirmed delivery details for this order.
            </p>
          </div>
        </div>

        ${
          items.length
            ? `
              <div class="pod-information-grid">
                ${items.join("")}
              </div>
            `
            : ""
        }

        ${addressHtml}
        ${notesHtml}
      </section>
    `;
  }

  function renderSignature(signature) {
    if (!signature) return "";

    return `
      <section class="pod-section-card">
        <div class="pod-section-head">
          <div>
            <span class="pod-section-kicker">
              Signature
            </span>

            <h2>Customer Signature</h2>

            <p>
              Signature recorded as part of the delivery confirmation.
            </p>
          </div>

          <span class="pod-section-count success">
            Signed
          </span>
        </div>

        <div class="pod-signature-card">
          <img
            src="${esc(signature.url)}"
            alt="Customer signature"
            class="pod-signature-image"
          />

          <div class="pod-signature-meta">
            ${
              isMeaningful(signature.capturedBy)
                ? `
                  <div>
                    <span>Signed by</span>

                    <strong>
                      ${esc(signature.capturedBy)}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              signature.capturedAt
                ? `
                  <div>
                    <span>Recorded</span>

                    <strong>
                      ${esc(formatDateTime(signature.capturedAt))}
                    </strong>
                  </div>
                `
                : ""
            }
          </div>
        </div>
      </section>
    `;
  }

  function getPhotos() {
    return getPodPhotos(order);
  }

  function selectPhoto(index) {
    const photos = getPhotos();

    if (!photos.length) return;

    activePhotoIndex = Math.max(
      0,
      Math.min(
        Number(index || 0),
        photos.length - 1
      )
    );

    const photo = photos[activePhotoIndex];
    const image = $("podGalleryMainImage");
    const captured = $("podGalleryCaptured");
    const capturedBy = $("podGalleryCapturedBy");

    if (image) {
      image.src = photo.url;
      image.alt = `Delivery photo ${activePhotoIndex + 1}`;
      image.classList.remove("enhanced");
    }

    if (captured) {
      captured.textContent =
        photo.capturedAt
          ? formatDateTime(photo.capturedAt)
          : "Not recorded";
    }

    if (capturedBy) {
      capturedBy.textContent =
        photo.capturedBy ||
        "Not recorded";
    }

    document
      .querySelectorAll("[data-photo-index]")
      .forEach(button => {
        button.classList.toggle(
          "active",
          Number(button.dataset.photoIndex) === activePhotoIndex
        );
      });

    const overlay = document.querySelector(
      ".pod-gallery-main-overlay > span:first-child"
    );

    if (overlay) {
      overlay.textContent =
        `Photo ${activePhotoIndex + 1} of ${photos.length}`;
    }
  }

  function togglePreviewEnhancement() {
    const image = $("podGalleryMainImage");
    const button = $("podGalleryEnhance");

    if (!image) return;

    const enabled =
      image.classList.toggle("enhanced");

    if (button) {
      button.textContent =
        enabled
          ? "Original preview"
          : "Enhance preview";
    }
  }

  function ensureLightbox() {
    let lightbox = $("podLightbox");

    if (lightbox) return lightbox;

    lightbox = document.createElement("div");
    lightbox.id = "podLightbox";
    lightbox.className = "pod-lightbox";
    lightbox.setAttribute("aria-hidden", "true");

    lightbox.innerHTML = `
      <div class="pod-lightbox-toolbar">
        <div class="pod-lightbox-counter" id="podLightboxCounter">
          Photo
        </div>

        <div class="pod-lightbox-controls">
          <button
            type="button"
            class="pod-lightbox-action"
            id="podLightboxZoomOut"
          >
            −
          </button>

          <span
            class="pod-lightbox-zoom-label"
            id="podLightboxZoomLabel"
          >
            100%
          </span>

          <button
            type="button"
            class="pod-lightbox-action"
            id="podLightboxZoomIn"
          >
            +
          </button>

          <button
            type="button"
            class="pod-lightbox-action"
            id="podLightboxRotate"
          >
            Rotate
          </button>

          <button
            type="button"
            class="pod-lightbox-action"
            id="podLightboxEnhance"
          >
            Enhance
          </button>

          <button
            type="button"
            class="pod-lightbox-action"
            id="podLightboxReset"
          >
            Reset
          </button>

          <a
            id="podLightboxDownload"
            class="pod-lightbox-action"
            href="#"
            download
          >
            Download
          </a>

          <button
            type="button"
            class="pod-lightbox-action"
            id="podLightboxClose"
          >
            Close
          </button>
        </div>
      </div>

      <button
        type="button"
        id="podLightboxPrevious"
        class="pod-lightbox-nav previous"
        aria-label="Previous photo"
      >
        ‹
      </button>

      <div class="pod-lightbox-stage">
        <img
          id="podLightboxImage"
          src=""
          alt="Delivery photo"
        />
      </div>

      <button
        type="button"
        id="podLightboxNext"
        class="pod-lightbox-nav next"
        aria-label="Next photo"
      >
        ›
      </button>

      <div
        id="podLightboxCaption"
        class="pod-lightbox-caption"
      ></div>
    `;

    document.body.appendChild(lightbox);

    $("podLightboxClose")?.addEventListener(
      "click",
      closeLightbox
    );

    $("podLightboxPrevious")?.addEventListener(
      "click",
      () => changeLightboxPhoto(-1)
    );

    $("podLightboxNext")?.addEventListener(
      "click",
      () => changeLightboxPhoto(1)
    );

    $("podLightboxZoomIn")?.addEventListener(
      "click",
      () => setLightboxZoom(lightboxZoom + 0.15)
    );

    $("podLightboxZoomOut")?.addEventListener(
      "click",
      () => setLightboxZoom(lightboxZoom - 0.15)
    );

    $("podLightboxRotate")?.addEventListener(
      "click",
      () => {
        lightboxRotation =
          (lightboxRotation + 90) % 360;

        updateLightboxTransform();
      }
    );

    $("podLightboxEnhance")?.addEventListener(
      "click",
      () => {
        lightboxEnhanced = !lightboxEnhanced;
        updateLightboxTransform();
      }
    );

    $("podLightboxReset")?.addEventListener(
      "click",
      resetLightboxView
    );

    lightbox.addEventListener("click", event => {
      if (event.target === lightbox) {
        closeLightbox();
      }
    });

    $("podLightboxStage")?.addEventListener(
      "wheel",
      event => {
        event.preventDefault();

        const direction =
          event.deltaY < 0
            ? 0.12
            : -0.12;

        setLightboxZoom(
          lightboxZoom + direction
        );
      },
      { passive: false }
    );

    document.addEventListener(
      "keydown",
      handleLightboxKeyboard
    );

    return lightbox;
  }

  function openLightbox(index = activePhotoIndex) {
    const photos = getPhotos();

    if (!photos.length) return;

    lightboxPhotoIndex = Math.max(
      0,
      Math.min(
        Number(index || 0),
        photos.length - 1
      )
    );

    activePhotoIndex = lightboxPhotoIndex;

    ensureLightbox();
    resetLightboxView();
    updateLightboxContent();

    const lightbox = $("podLightbox");

    lightbox?.classList.add("open");
    lightbox?.setAttribute("aria-hidden", "false");

    document.body.classList.add(
      "pod-lightbox-open"
    );
  }

  function closeLightbox() {
    const lightbox = $("podLightbox");

    lightbox?.classList.remove("open");
    lightbox?.setAttribute("aria-hidden", "true");

    document.body.classList.remove(
      "pod-lightbox-open"
    );
  }

  function changeLightboxPhoto(direction) {
    const photos = getPhotos();

    if (!photos.length) return;

    lightboxPhotoIndex =
      (
        lightboxPhotoIndex +
        direction +
        photos.length
      ) % photos.length;

    activePhotoIndex = lightboxPhotoIndex;

    resetLightboxView();
    updateLightboxContent();
    selectPhoto(activePhotoIndex);
  }

  function setLightboxZoom(value) {
    lightboxZoom = Math.min(
      4,
      Math.max(
        0.5,
        Number(value || 1)
      )
    );

    updateLightboxTransform();
  }

  function resetLightboxView() {
    lightboxZoom = 1;
    lightboxRotation = 0;
    lightboxEnhanced = false;

    updateLightboxTransform();
  }

  function updateLightboxTransform() {
    const image = $("podLightboxImage");
    const zoomLabel = $("podLightboxZoomLabel");
    const enhanceButton = $("podLightboxEnhance");

    if (image) {
      image.style.transform =
        `scale(${lightboxZoom}) rotate(${lightboxRotation}deg)`;

      image.classList.toggle(
        "enhanced",
        lightboxEnhanced
      );
    }

    if (zoomLabel) {
      zoomLabel.textContent =
        `${Math.round(lightboxZoom * 100)}%`;
    }

    if (enhanceButton) {
      enhanceButton.classList.toggle(
        "active",
        lightboxEnhanced
      );

      enhanceButton.textContent =
        lightboxEnhanced
          ? "Original"
          : "Enhance";
    }
  }

  function updateLightboxContent() {
    const photos = getPhotos();
    const photo = photos[lightboxPhotoIndex];

    if (!photo) return;

    const image = $("podLightboxImage");
    const counter = $("podLightboxCounter");
    const caption = $("podLightboxCaption");
    const download = $("podLightboxDownload");
    const previous = $("podLightboxPrevious");
    const next = $("podLightboxNext");

    if (image) {
      image.src = photo.url;
      image.alt =
        `Delivery photo ${lightboxPhotoIndex + 1}`;
    }

    if (counter) {
      counter.textContent =
        `${lightboxPhotoIndex + 1} of ${photos.length}`;
    }

    if (caption) {
      const parts = [
        `Delivery photo ${lightboxPhotoIndex + 1}`,
        photo.capturedAt
          ? formatDateTime(photo.capturedAt)
          : "",
        photo.capturedBy
          ? `Captured by ${photo.capturedBy}`
          : "",
        photo.notes || ""
      ].filter(Boolean);

      caption.textContent =
        parts.join(" · ");
    }

    if (download) {
      download.href = photo.url;
      download.download = safeFileName(
        photo.fileName,
        `Delivery-photo-${lightboxPhotoIndex + 1}.jpg`
      );
    }

    const hideNavigation =
      photos.length <= 1;

    if (previous) {
      previous.style.display =
        hideNavigation
          ? "none"
          : "flex";
    }

    if (next) {
      next.style.display =
        hideNavigation
          ? "none"
          : "flex";
    }

    updateLightboxTransform();
  }

  function handleLightboxKeyboard(event) {
    const lightbox = $("podLightbox");

    if (!lightbox?.classList.contains("open")) {
      return;
    }

    if (event.key === "Escape") {
      closeLightbox();
    }

    if (event.key === "ArrowLeft") {
      changeLightboxPhoto(-1);
    }

    if (event.key === "ArrowRight") {
      changeLightboxPhoto(1);
    }

    if (event.key === "+" || event.key === "=") {
      setLightboxZoom(lightboxZoom + 0.15);
    }

    if (event.key === "-") {
      setLightboxZoom(lightboxZoom - 0.15);
    }
  }

async function registerPodDownload({
  fileUrl,
  fileName,
  fileSize
}) {
  if (!order?.id) {
    throw new Error(
      "Order is missing while registering the POD download."
    );
  }

  if (!window.PortalEvents?.track) {
    throw new Error(
      "PortalEvents is not available. Check that portal-events.js is loaded before pod.js."
    );
  }

  const orderNumber =
    getOrderNumber(order);

  await window.PortalEvents.track({
    eventType: "pod_downloaded",
    entityType: "document",
    entityId: order.id,

    description:
      `POD downloaded for ${orderNumber}`,

    metadata: {
      document_type: "pod",
      action: "downloaded",

      order_id: order.id,
      order_number: orderNumber,

      file_url: fileUrl || "",
      file_name:
        fileName ||
        `${orderNumber}-POD.pdf`,

      file_size_bytes:
        Number(fileSize || 0),

      downloaded_at:
        new Date().toISOString()
    }
  });
}

async function downloadPodPdf() {
  const button =
    $("podDownloadPdfBtn");

  if (!button) return;

  const url =
    button.dataset.url || "";

  const fileName =
    button.dataset.fileName ||
    `${getOrderNumber(order)}-POD.pdf`;

  if (!url) {
    throw new Error(
      "POD PDF URL is missing."
    );
  }

  const originalText =
    button.textContent;

  let downloadStarted = false;

  try {
    button.disabled = true;
    button.textContent =
      "Downloading...";

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `POD download failed (${response.status}).`
      );
    }

    const blob =
      await response.blob();

    if (!blob.size) {
      throw new Error(
        "Downloaded POD file is empty."
      );
    }

    const objectUrl =
      URL.createObjectURL(blob);

    const downloadLink =
      document.createElement("a");

    downloadLink.href =
      objectUrl;

    downloadLink.download =
      fileName;

    downloadLink.style.display =
      "none";

    document.body.appendChild(
      downloadLink
    );

    downloadLink.click();
    downloadStarted = true;

    downloadLink.remove();

    setTimeout(() => {
      URL.revokeObjectURL(
        objectUrl
      );
    }, 30000);

    await registerPodDownload({
      fileUrl: url,
      fileName,
      fileSize: blob.size
    });

    button.textContent =
      "✓ Downloaded";

    button.classList.add(
      "pod-download-complete"
    );

  } catch (error) {
    console.error(
      "POD download failed:",
      error
    );

    button.textContent =
      downloadStarted
        ? "Downloaded · tracking failed"
        : "Download failed";

    setTimeout(() => {
      if (
        !button.classList.contains(
          "pod-download-complete"
        )
      ) {
        button.textContent =
          originalText;
      }
    }, 3500);

    throw error;

  } finally {
    button.disabled = false;
  }
}

  function bindDynamicEvents() {
    document
      .querySelectorAll("[data-photo-index]")
      .forEach(button => {
        button.addEventListener("click", () => {
          selectPhoto(
            Number(button.dataset.photoIndex)
          );
        });
      });

$("podDownloadPdfBtn")?.addEventListener(
  "click",
  async () => {
    try {
      await downloadPodPdf();
    } catch (error) {
      console.error(error);
    }
  }
);

    $("podGalleryMain")?.addEventListener(
      "click",
      () => openLightbox(activePhotoIndex)
    );

    $("podGalleryOpen")?.addEventListener(
      "click",
      () => openLightbox(activePhotoIndex)
    );

    $("podGalleryEnhance")?.addEventListener(
      "click",
      togglePreviewEnhancement
    );
  }

  async function loadOrder() {
    const db = getClient();

    orderId = getParam("order_id");
    stopId = getParam("stop_id");

    let query = db
      .from("orders")
      .select(`
        *,
        customers (
          id,
          name,
          customer_code
        ),
        routes (
          id,
          route_code,
          route_name,
          name,
          driver_name,
          vehicle_name
        ),
        order_documents (
          id,
          document_type,
          document_number,
          document_status,
          file_url,
          storage_path,
          created_at,
          updated_at
        ),
        order_pod_assets (
          id,
          asset_type,
          file_name,
          file_url,
          storage_path,
          mime_type,
          notes,
          captured_at,
          captured_by_name
        ),
        route_stops (
          id,
          status,
          delivery_status,
          delivered_to,
          pod_notes,
          customer_signature,
          delivery_photos,
          delivery_date,
          delivery_time,
          completed_at
        )
      `);

    if (orderId) {
      query = query.eq("id", orderId);
    } else if (stopId) {
      const {
        data: stop,
        error: stopError
      } = await db
        .from("route_stops")
        .select("order_id")
        .eq("id", stopId)
        .maybeSingle();

      if (stopError) throw stopError;

      if (!stop?.order_id) {
        throw new Error(
          "No order linked to this stop."
        );
      }

      orderId = stop.order_id;
      query = query.eq("id", orderId);
    } else {
      throw new Error(
        "Missing order_id or stop_id in URL."
      );
    }

    const {
      data,
      error
    } = await query.maybeSingle();

    if (error) throw error;

    if (!data?.id) {
      throw new Error("Order not found.");
    }

    order = data;
    render();
  }

  function render() {
    const root =
      $("podRoot") ||
      $("podContent") ||
      document.querySelector("main") ||
      document.body;

    const pdfDocument =
      getPodDocument(order);

    const photos =
      getPodPhotos(order);

    const signature =
      getSignature(order);

    const orderNumber =
      getOrderNumber(order);

    const ackNumber =
      getAckNumber(order);

    const purchaseOrder =
      getPurchaseOrder(order);

    const retailer =
      getRetailerName(order);

    const productOwner =
      getProductOwnerName(order);

    const deliveryDate =
      getDeliveryDate(order);

    const deliveryStatusLabel =
      getDeliveryStatusLabel(order);

    const deliveryStatusClass =
      getDeliveryStatusClass(order);

    const receivedBy =
      getReceivedBy(order);

    const driver =
      getDriverName(order);

    const route =
      getRouteName(order);

    const notes =
      getDeliveryNotes(order);

    const address =
      getDeliveryAddress(order);

    activePhotoIndex = 0;

    root.innerHTML = `
      <section class="pod-page">
        ${renderHero({
          orderNumber,
          ackNumber,
          purchaseOrder,
          retailer,
          productOwner,
          deliveryDate,
          deliveryStatusLabel,
          deliveryStatusClass,
          pdfDocument,
          photos
        })}

        <div class="pod-main-layout">
          <div class="pod-main-column">
            ${renderDocumentCard(
              pdfDocument,
              orderNumber
            )}

            ${renderPhotoViewer(photos)}
          </div>

          <aside class="pod-side-column">
            ${renderDeliveryInformation({
              deliveryDate,
              receivedBy,
              driver,
              route,
              notes,
              address
            })}

            ${renderSignature(signature)}
          </aside>
        </div>
      </section>
    `;

    bindDynamicEvents();
  }

  function addStyles() {
    if ($("podGeneratedStyles")) return;

    const style = document.createElement("style");
    style.id = "podGeneratedStyles";

    style.textContent = `
      .pod-page {
        width: 100%;
        min-width: 0;
        display: grid;
        gap: 18px;
      }

      .pod-hero {
        position: relative;
        display: grid;
        grid-template-columns:
          minmax(0, 1fr)
          minmax(330px, 430px);
        gap: 28px;
        align-items: center;
        overflow: hidden;
        padding: 28px;
        border: 1px solid rgba(125, 211, 252, .18);
        border-radius: 24px;
        background:
          radial-gradient(
            circle at 88% 10%,
            rgba(56, 189, 248, .18),
            transparent 30%
          ),
          radial-gradient(
            circle at 0% 100%,
            rgba(18, 103, 255, .16),
            transparent 34%
          ),
          linear-gradient(
            135deg,
            #07162d 0%,
            #0a2148 58%,
            #0d326a 100%
          );
        color: #fff;
        box-shadow:
          0 20px 46px rgba(7, 21, 47, .18);
        animation: podFadeIn .22s ease-out;
      }

      .pod-hero::after {
        content: "";
        position: absolute;
        right: -75px;
        bottom: -105px;
        width: 275px;
        height: 275px;
        border: 1px solid rgba(255, 255, 255, .07);
        border-radius: 50%;
        box-shadow:
          0 0 0 36px rgba(255, 255, 255, .022),
          0 0 0 72px rgba(255, 255, 255, .014);
        pointer-events: none;
      }

      .pod-hero-main,
      .pod-hero-side {
        position: relative;
        z-index: 1;
        min-width: 0;
      }

      .pod-eyebrow {
        margin-bottom: 8px;
        color: #7dd3fc;
        font-size: 11px;
        font-weight: 950;
        letter-spacing: .14em;
        text-transform: uppercase;
      }

      .pod-reference-line {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }

      .pod-hero-order {
        margin: 0;
        color: #fff;
        font-size: clamp(30px, 4vw, 47px);
        font-weight: 950;
        line-height: 1;
        letter-spacing: -.045em;
      }

      .pod-ack-badge {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 38px;
        padding: 7px 12px;
        border: 1px solid rgba(125, 211, 252, .32);
        border-radius: 12px;
        background:
          linear-gradient(
            135deg,
            rgba(18, 103, 255, .28),
            rgba(56, 189, 248, .16)
          );
        color: #fff;
        font-size: 13px;
        font-weight: 950;
        box-shadow:
          0 10px 24px rgba(0, 0, 0, .12);
      }

      .pod-ack-icon {
        font-size: 14px;
      }

      .pod-hero-retailer {
        margin-top: 12px;
        color: #fff;
        font-size: 20px;
        font-weight: 900;
        line-height: 1.25;
      }

      .pod-hero-owner {
        margin-top: 5px;
        color: rgba(255, 255, 255, .68);
        font-size: 12px;
        font-weight: 750;
      }

      .pod-status-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 20px;
      }

      .pod-status-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 32px;
        padding: 6px 11px;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 999px;
        background: rgba(255, 255, 255, .08);
        color: #fff;
        font-size: 11px;
        font-weight: 900;
        backdrop-filter: blur(12px);
      }

      .pod-status-chip-icon {
        width: 19px;
        height: 19px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(255, 255, 255, .13);
        font-size: 10px;
      }

      .pod-status-chip.success {
        border-color: rgba(74, 222, 128, .28);
        background: rgba(22, 163, 74, .18);
      }

      .pod-status-chip.danger {
        border-color: rgba(248, 113, 113, .30);
        background: rgba(220, 38, 38, .18);
      }

      .pod-status-chip.document {
        border-color: rgba(96, 165, 250, .30);
        background: rgba(37, 99, 235, .18);
      }

      .pod-status-chip.photo {
        border-color: rgba(192, 132, 252, .30);
        background: rgba(147, 51, 234, .16);
      }

      .pod-hero-delivered {
        margin-top: 14px;
        color: rgba(255, 255, 255, .72);
        font-size: 12px;
        font-weight: 800;
      }

      .pod-hero-side {
        display: grid;
        gap: 12px;
      }

      .pod-hero-reference-card {
        display: grid;
        gap: 8px;
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, .13);
        border-radius: 16px;
        background: rgba(255, 255, 255, .07);
        backdrop-filter: blur(14px);
      }

      .pod-reference-row {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, .10);
      }

      .pod-reference-row:last-child {
        padding-bottom: 0;
        border-bottom: 0;
      }

      .pod-reference-row span {
        color: rgba(255, 255, 255, .62);
        font-size: 10px;
        font-weight: 850;
        text-transform: uppercase;
      }

      .pod-reference-row strong {
        color: #fff;
        font-size: 12px;
        font-weight: 950;
        text-align: right;
      }

      .pod-primary-action {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        min-height: 78px;
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, .15);
        border-radius: 17px;
        background:
          linear-gradient(
            135deg,
            rgba(255, 255, 255, .15),
            rgba(255, 255, 255, .07)
          );
        color: #fff;
        box-shadow:
          0 18px 38px rgba(0, 0, 0, .18);
        backdrop-filter: blur(18px);
        transition:
          transform .16s ease,
          border-color .16s ease;
      }

      .pod-primary-action:hover {
        transform: translateY(-2px);
        border-color: rgba(125, 211, 252, .46);
      }

      .pod-primary-action-icon {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 14px;
        background: rgba(255, 255, 255, .12);
        font-size: 20px;
      }

      .pod-primary-action-copy strong,
      .pod-primary-action-copy small {
        display: block;
      }

      .pod-primary-action-copy strong {
        color: #fff;
        font-size: 13px;
        font-weight: 950;
      }

      .pod-primary-action-copy small {
        margin-top: 3px;
        color: rgba(255, 255, 255, .65);
        font-size: 11px;
      }

      .pod-primary-action-arrow {
        font-size: 22px;
        font-weight: 900;
      }

      .pod-main-layout {
        display: grid;
        grid-template-columns:
          minmax(0, 1.35fr)
          minmax(330px, .65fr);
        gap: 18px;
        align-items: start;
      }

      .pod-main-column,
      .pod-side-column {
        display: grid;
        gap: 18px;
        min-width: 0;
      }

      .pod-side-column {
        position: sticky;
        top: 18px;
      }

      .pod-section-card {
        min-width: 0;
        display: grid;
        gap: 16px;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: #fff;
        box-shadow: var(--shadow);
        animation: podFadeIn .25s ease-out;
      }

      .pod-section-head {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: flex-start;
      }

      .pod-section-kicker {
        display: block;
        margin-bottom: 4px;
        color: #1267ff;
        font-size: 10px;
        font-weight: 950;
        letter-spacing: .09em;
        text-transform: uppercase;
      }

      .pod-section-head h2 {
        margin: 0;
        color: #07152f;
        font-size: 17px;
        font-weight: 950;
        letter-spacing: -.02em;
      }

      .pod-section-head p {
        margin: 5px 0 0;
        max-width: 680px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .pod-section-count {
        min-width: 34px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 9px;
        border: 1px solid var(--blue-bd);
        border-radius: 999px;
        background: var(--blue-bg);
        color: var(--blue-tx);
        font-size: 10px;
        font-weight: 950;
      }

      .pod-section-count.success {
        border-color: var(--green-bd);
        background: var(--green-bg);
        color: var(--green-tx);
      }

      .pod-document-card {
        display: grid;
        grid-template-columns: 145px minmax(0, 1fr);
        gap: 18px;
        align-items: center;
        padding: 15px;
        border: 1px solid #dce5f2;
        border-radius: 16px;
        background:
          linear-gradient(
            135deg,
            #f8fbff,
            #fff
          );
      }

      .pod-document-preview {
        display: flex;
        justify-content: center;
      }

      .pod-document-preview-page {
        width: 102px;
        height: 135px;
        overflow: hidden;
        padding: 11px;
        border: 1px solid #d4deec;
        border-radius: 8px;
        background: #fff;
        box-shadow:
          0 12px 30px rgba(15, 23, 42, .12);
        transform: rotate(-1deg);
      }

      .pod-document-preview-top {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 2px solid #07152f;
        color: #07152f;
        font-size: 7px;
        font-weight: 950;
      }

      .pod-document-preview-lines {
        display: grid;
        gap: 7px;
        margin-top: 15px;
      }

      .pod-document-preview-lines span {
        display: block;
        height: 3px;
        border-radius: 999px;
        background: #dce5f2;
      }

      .pod-document-preview-lines span:nth-child(2) {
        width: 78%;
      }

      .pod-document-preview-lines span:nth-child(3) {
        width: 90%;
      }

      .pod-document-preview-lines span:nth-child(4) {
        width: 58%;
      }

      .pod-document-preview-signature {
        margin-top: 20px;
        padding-top: 7px;
        border-top: 1px solid #dce5f2;
        color: #047857;
        font-family: cursive;
        font-size: 10px;
        font-weight: 900;
        text-align: right;
      }

      .pod-document-details {
        min-width: 0;
      }

      .pod-document-type {
        display: inline-flex;
        padding: 4px 8px;
        border: 1px solid var(--green-bd);
        border-radius: 999px;
        background: var(--green-bg);
        color: var(--green-tx);
        font-size: 9px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .pod-document-details h3 {
        margin: 10px 0 0;
        overflow: hidden;
        color: #07152f;
        font-size: 15px;
        font-weight: 950;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pod-document-details p {
        margin: 5px 0 0;
        color: var(--muted);
        font-size: 11.5px;
      }

      .pod-document-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 15px;
      }

      .pod-btn {
        min-height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 14px;
        border: 1px solid var(--border);
        border-radius: 11px;
        background: #fff;
        color: #07152f;
        font-size: 12px;
        font-weight: 900;
        cursor: pointer;
        transition:
          transform .15s ease,
          border-color .15s ease,
          box-shadow .15s ease;
      }

      .pod-btn:hover {
        transform: translateY(-1px);
        border-color: #93c5fd;
        box-shadow:
          0 8px 18px rgba(15, 23, 42, .07);
      }

      .pod-btn-primary {
        border-color: #1267ff;
        background: #1267ff;
        color: #fff;
      }

      .pod-btn-primary:hover {
        border-color: #074bd1;
        background: #074bd1;
      }

.pod-btn.pod-download-complete{
  border-color:#86efac;
  background:#dcfce7;
  color:#166534;
  box-shadow:
    0 8px 18px rgba(22,163,74,.10);
}

.pod-btn.pod-download-complete:hover{
  border-color:#4ade80;
  background:#bbf7d0;
  color:#14532d;
}

      .pod-gallery-shell {
        display: grid;
        gap: 12px;
      }

      .pod-gallery-main-wrap {
        display: grid;
        grid-template-columns:
          minmax(260px, 520px)
          minmax(190px, 1fr);
        gap: 14px;
        align-items: stretch;
      }

      .pod-gallery-main {
        position: relative;
        min-height: 300px;
        max-height: 380px;
        overflow: hidden;
        padding: 0;
        border: 1px solid #dce5f2;
        border-radius: 16px;
        background: #eef2f7;
        cursor: zoom-in;
        box-shadow:
          0 10px 24px rgba(15, 23, 42, .07);
      }

      .pod-gallery-main img {
        width: 100%;
        height: 100%;
        min-height: 300px;
        max-height: 380px;
        display: block;
        object-fit: contain;
        background: #edf1f6;
        image-rendering: auto;
        transition:
          filter .18s ease,
          transform .18s ease;
      }

      .pod-gallery-main img.enhanced,
      .pod-lightbox-stage img.enhanced {
        filter:
          contrast(1.16)
          brightness(1.04)
          saturate(1.05)
          sharpen(1);
      }

      .pod-gallery-main img.enhanced {
        transform: scale(1.01);
      }

      .pod-gallery-main-overlay {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        padding: 26px 13px 11px;
        background:
          linear-gradient(
            180deg,
            transparent,
            rgba(7, 21, 47, .82)
          );
        color: #fff;
        font-size: 11px;
        font-weight: 900;
      }

      .pod-gallery-open-label {
        padding: 4px 8px;
        border: 1px solid rgba(255, 255, 255, .22);
        border-radius: 999px;
        background: rgba(255, 255, 255, .12);
        font-size: 10px;
      }

      .pod-gallery-details {
        display: grid;
        align-content: start;
        gap: 13px;
        padding: 15px;
        border: 1px solid #e3eaf4;
        border-radius: 15px;
        background: #fbfdff;
      }

      .pod-gallery-details > div {
        display: grid;
        gap: 4px;
      }

      .pod-gallery-detail-label {
        color: #64748b;
        font-size: 9.5px;
        font-weight: 950;
        letter-spacing: .05em;
        text-transform: uppercase;
      }

      .pod-gallery-details strong {
        color: #07152f;
        font-size: 12px;
        line-height: 1.4;
      }

      .pod-gallery-actions {
        display: flex !important;
        flex-wrap: wrap;
        gap: 8px !important;
        margin-top: auto;
      }

      .pod-thumbnail-strip {
        display: flex;
        gap: 9px;
        overflow-x: auto;
        padding: 2px 2px 5px;
      }

      .pod-thumbnail {
        position: relative;
        width: 84px;
        height: 66px;
        flex: 0 0 84px;
        overflow: hidden;
        padding: 0;
        border: 2px solid transparent;
        border-radius: 11px;
        background: #eef2f7;
        cursor: pointer;
        transition:
          border-color .15s ease,
          transform .15s ease,
          box-shadow .15s ease;
      }

      .pod-thumbnail:hover {
        transform: translateY(-1px);
      }

      .pod-thumbnail.active {
        border-color: #1267ff;
        box-shadow:
          0 0 0 3px rgba(18, 103, 255, .12);
      }

      .pod-thumbnail img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
      }

      .pod-thumbnail span {
        position: absolute;
        right: 5px;
        bottom: 5px;
        width: 19px;
        height: 19px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(7, 21, 47, .76);
        color: #fff;
        font-size: 9px;
        font-weight: 950;
      }

      .pod-information-grid {
        display: grid;
        grid-template-columns:
          repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .pod-info-card {
        min-width: 0;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 10px;
        padding: 12px;
        border: 1px solid #e3eaf4;
        border-radius: 13px;
        background: #fbfdff;
      }

      .pod-info-icon {
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #dbeafe;
        border-radius: 11px;
        background: #eff6ff;
        font-size: 14px;
      }

      .pod-info-content {
        min-width: 0;
      }

      .pod-info-label {
        display: block;
        color: #64748b;
        font-size: 9.5px;
        font-weight: 950;
        letter-spacing: .05em;
        text-transform: uppercase;
      }

      .pod-info-value {
        display: block;
        margin-top: 4px;
        overflow: hidden;
        color: #07152f;
        font-size: 12px;
        font-weight: 950;
        line-height: 1.35;
        text-overflow: ellipsis;
      }

      .pod-info-sub {
        display: block;
        margin-top: 2px;
        color: var(--muted);
        font-size: 10.5px;
        font-weight: 750;
      }

      .pod-address-card {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        gap: 11px;
        padding: 13px;
        border: 1px solid #e3eaf4;
        border-radius: 14px;
        background: #fbfdff;
      }

      .pod-address-icon {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #dbeafe;
        border-radius: 11px;
        background: #eff6ff;
      }

      .pod-address-value {
        display: block;
        margin-top: 5px;
        color: #07152f;
        font-size: 12px;
        line-height: 1.55;
      }

      .pod-notes-card {
        padding: 13px;
        border: 1px solid #e3eaf4;
        border-radius: 14px;
        background: #fbfdff;
      }

      .pod-notes-card p {
        margin: 6px 0 0;
        color: #344054;
        font-size: 12px;
        line-height: 1.55;
        white-space: pre-wrap;
      }

      .pod-signature-card {
        display: grid;
        gap: 12px;
      }

      .pod-signature-image {
        width: 100%;
        max-height: 180px;
        display: block;
        object-fit: contain;
        padding: 14px;
        border: 1px solid #dce5f2;
        border-radius: 14px;
        background: #fff;
      }

      .pod-signature-meta {
        display: grid;
        grid-template-columns:
          repeat(2, minmax(0, 1fr));
        gap: 9px;
      }

      .pod-signature-meta > div {
        padding: 10px;
        border: 1px solid #e3eaf4;
        border-radius: 12px;
        background: #fbfdff;
      }

      .pod-signature-meta span,
      .pod-signature-meta strong {
        display: block;
      }

      .pod-signature-meta span {
        color: #64748b;
        font-size: 9.5px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .pod-signature-meta strong {
        margin-top: 4px;
        color: #07152f;
        font-size: 11.5px;
      }

      .pod-empty-state {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 18px;
        border: 1px dashed #cbd5e1;
        border-radius: 14px;
        background: #f8fafc;
      }

      .pod-empty-icon {
        width: 42px;
        height: 42px;
        flex: 0 0 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #dce5f2;
        border-radius: 13px;
        background: #fff;
        font-size: 18px;
      }

      .pod-empty-state strong,
      .pod-empty-state span {
        display: block;
      }

      .pod-empty-state strong {
        color: #07152f;
        font-size: 12.5px;
      }

      .pod-empty-state span {
        margin-top: 3px;
        color: var(--muted);
        font-size: 11px;
      }

      body.pod-lightbox-open {
        overflow: hidden;
      }

      .pod-lightbox {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 76px 70px 58px;
        background: rgba(3, 10, 24, .95);
        backdrop-filter: blur(12px);
      }

      .pod-lightbox.open {
        display: flex;
        animation: podLightboxIn .16s ease-out;
      }

      .pod-lightbox-toolbar {
        position: absolute;
        top: 16px;
        left: 20px;
        right: 20px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }

      .pod-lightbox-counter {
        color: rgba(255, 255, 255, .78);
        font-size: 12px;
        font-weight: 900;
      }

      .pod-lightbox-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 7px;
      }

      .pod-lightbox-action {
        min-height: 35px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 12px;
        border: 1px solid rgba(255, 255, 255, .18);
        border-radius: 10px;
        background: rgba(255, 255, 255, .08);
        color: #fff;
        font-size: 11px;
        font-weight: 900;
        cursor: pointer;
        backdrop-filter: blur(10px);
      }

      .pod-lightbox-action:hover,
      .pod-lightbox-action.active {
        background: rgba(18, 103, 255, .42);
        border-color: rgba(96, 165, 250, .55);
      }

      .pod-lightbox-zoom-label {
        min-width: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, .76);
        font-size: 11px;
        font-weight: 900;
      }

      .pod-lightbox-stage {
        width: 100%;
        height: calc(100vh - 150px);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: auto;
      }

      .pod-lightbox-stage img {
        max-width: min(1300px, 100%);
        max-height: calc(100vh - 165px);
        display: block;
        object-fit: contain;
        border-radius: 10px;
        box-shadow:
          0 28px 80px rgba(0, 0, 0, .48);
        image-rendering: auto;
        transition:
          transform .16s ease,
          filter .16s ease;
        transform-origin: center center;
      }

      .pod-lightbox-caption {
        position: absolute;
        left: 70px;
        right: 70px;
        bottom: 18px;
        color: rgba(255, 255, 255, .68);
        font-size: 11px;
        line-height: 1.45;
        text-align: center;
      }

      .pod-lightbox-nav {
        position: absolute;
        top: 50%;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: translateY(-50%);
        border: 1px solid rgba(255, 255, 255, .18);
        border-radius: 999px;
        background: rgba(255, 255, 255, .08);
        color: #fff;
        font-size: 34px;
        cursor: pointer;
        backdrop-filter: blur(12px);
      }

      .pod-lightbox-nav:hover {
        background: rgba(255, 255, 255, .15);
      }

      .pod-lightbox-nav.previous {
        left: 16px;
      }

      .pod-lightbox-nav.next {
        right: 16px;
      }

      .pod-loading-card {
        min-height: 180px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 24px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: #fff;
        box-shadow: var(--shadow);
      }

      .pod-loading-spinner {
        width: 34px;
        height: 34px;
        border: 3px solid #dbeafe;
        border-top-color: #1267ff;
        border-radius: 999px;
        animation: podLoadingSpin .7s linear infinite;
      }

      .pod-loading-card strong,
      .pod-loading-card span {
        display: block;
      }

      .pod-loading-card strong {
        color: #07152f;
        font-size: 13px;
      }

      .pod-loading-card span {
        margin-top: 3px;
        color: var(--muted);
        font-size: 11.5px;
      }

      @keyframes podFadeIn {
        from {
          opacity: 0;
          transform: translateY(5px);
        }

        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes podLightboxIn {
        from {
          opacity: 0;
        }

        to {
          opacity: 1;
        }
      }

      @keyframes podLoadingSpin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 1180px) {
        .pod-main-layout {
          grid-template-columns: 1fr;
        }

        .pod-side-column {
          position: static;
        }

        .pod-hero {
          grid-template-columns:
            minmax(0, 1fr)
            minmax(300px, 380px);
        }
      }

      @media (max-width: 900px) {
        .pod-hero {
          grid-template-columns: 1fr;
          padding: 22px;
        }

        .pod-gallery-main-wrap {
          grid-template-columns: 1fr;
        }

        .pod-gallery-main {
          min-height: 270px;
          max-height: 340px;
        }

        .pod-gallery-main img {
          min-height: 270px;
          max-height: 340px;
        }

        .pod-document-card {
          grid-template-columns: 1fr;
        }

        .pod-document-preview {
          justify-content: flex-start;
        }

        .pod-lightbox {
          padding: 88px 18px 48px;
        }

        .pod-lightbox-toolbar {
          align-items: flex-start;
        }

        .pod-lightbox-controls {
          max-width: 80%;
        }

        .pod-lightbox-caption {
          left: 20px;
          right: 20px;
        }
      }

      @media (max-width: 600px) {
        .pod-hero {
          padding: 18px;
          border-radius: 19px;
        }

        .pod-reference-line {
          align-items: flex-start;
          flex-direction: column;
        }

        .pod-hero-retailer {
          font-size: 17px;
        }

        .pod-ack-badge {
          min-height: 34px;
          font-size: 12px;
        }

        .pod-section-card {
          padding: 15px;
          border-radius: 16px;
        }

        .pod-information-grid {
          grid-template-columns: 1fr;
        }

        .pod-signature-meta {
          grid-template-columns: 1fr;
        }

        .pod-gallery-main {
          min-height: 220px;
          max-height: 280px;
        }

        .pod-gallery-main img {
          min-height: 220px;
          max-height: 280px;
        }

        .pod-lightbox-toolbar {
          top: 10px;
          left: 10px;
          right: 10px;
        }

        .pod-lightbox-counter {
          display: none;
        }

        .pod-lightbox-controls {
          width: 100%;
          max-width: none;
          justify-content: center;
        }

        .pod-lightbox-action {
          min-height: 32px;
          padding: 0 9px;
          font-size: 10px;
        }

        .pod-lightbox-stage {
          height: calc(100vh - 160px);
        }

        .pod-lightbox-nav {
          width: 40px;
          height: 40px;
        }

        .pod-lightbox-nav.previous {
          left: 6px;
        }

        .pod-lightbox-nav.next {
          right: 6px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function renderLoading() {
    const root =
      $("podRoot") ||
      $("podContent") ||
      document.querySelector("main") ||
      document.body;

    root.innerHTML = `
      <section class="pod-loading-card">
        <div class="pod-loading-spinner"></div>

        <div>
          <strong>
            Loading Proof of Delivery
          </strong>

          <span>
            Retrieving delivery document and photos...
          </span>
        </div>
      </section>
    `;
  }

  function renderError(error) {
    const root =
      $("podRoot") ||
      $("podContent") ||
      document.querySelector("main") ||
      document.body;

    root.innerHTML = `
      <section class="pod-section-card">
        <div class="pod-empty-state">
          <div class="pod-empty-icon">
            ⚠️
          </div>

          <div>
            <strong>
              Proof of Delivery could not be loaded
            </strong>

            <span>
              ${esc(
                error?.message ||
                "An unexpected error occurred."
              )}
            </span>
          </div>
        </div>
      </section>
    `;
  }

  async function init() {
    addStyles();
    renderLoading();

    try {
      await loadOrder();
    } catch (error) {
      console.error(error);
      renderError(error);
    }
  }

  document.addEventListener(
    "DOMContentLoaded",
    init
  );
})();