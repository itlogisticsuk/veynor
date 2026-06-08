(function () {
  "use strict";

  let client = null;
  let orderId = null;
  let stopId = null;
  let order = null;

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-GB");
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

    if (window.supabase && window.VEYNOR_CONFIG) {
      client = window.supabase.createClient(
        window.VEYNOR_CONFIG.SUPABASE_URL,
        window.VEYNOR_CONFIG.SUPABASE_ANON_KEY
      );
      return client;
    }

    throw new Error("Supabase client not available.");
  }

  function getPodDocumentUrl(order) {
    const docs = order.order_documents || [];
    const assets = order.order_pod_assets || [];

    const podDoc = docs.find(d =>
      String(d.document_type || "").toLowerCase() === "pod" &&
      d.file_url
    );

    if (podDoc?.file_url) return podDoc.file_url;

    if (order.pod_document_url) return order.pod_document_url;

    const pdfAsset = assets.find(a =>
      ["signed_delivery_note", "pod_pdf", "signed_pod_pdf"].includes(String(a.asset_type || "").toLowerCase()) &&
      a.file_url
    );

    return pdfAsset?.file_url || "";
  }

  function getPodPhotos(order) {
    return (order.order_pod_assets || [])
      .filter(a => String(a.asset_type || "").toLowerCase() === "photo" && a.file_url)
      .map(a => a.file_url);
  }

  function getSignatureUrl(order) {
    return (order.order_pod_assets || [])
      .find(a =>
        ["signature", "customer_signature"].includes(String(a.asset_type || "").toLowerCase()) &&
        a.file_url
      )?.file_url || order.route_stops?.[0]?.customer_signature || "";
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
      const { data: stop, error: stopError } = await db
        .from("route_stops")
        .select("order_id")
        .eq("id", stopId)
        .maybeSingle();

      if (stopError) throw stopError;
      if (!stop?.order_id) throw new Error("No order linked to this stop.");

      orderId = stop.order_id;
      query = query.eq("id", orderId);
    } else {
      throw new Error("Missing order_id or stop_id in URL.");
    }

    const { data, error } = await query.maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("Order not found.");

    order = data;
    render();
  }

  function getStop(order) {
    return (order.route_stops || [])[0] || {};
  }

  function render() {
    const root = $("podRoot") || $("podContent") || document.querySelector("main") || document.body;
    const stop = getStop(order);

    const pdfUrl = getPodDocumentUrl(order);
    const photos = getPodPhotos(order);
    const signatureUrl = getSignatureUrl(order);

    const orderNumber = order.order_number || "—";
    const customer = order.customers?.name || order.customer_name || "—";
    const deliveredTo = stop.delivered_to || order.pod_signed_by || "—";
    const deliveredAt = stop.completed_at || order.pod_signed_at || null;
    const notes = stop.pod_notes || order.pod_notes || "—";
    const routeCode = order.routes?.route_code || order.routes?.route_name || order.routes?.name || "—";
    const driver = order.routes?.driver_name || order.driver_name || "—";

    root.innerHTML = `
      <section class="pod-page">
        <div class="card pod-header-card">
          <div>
            <h1>Proof of Delivery</h1>
            <p class="muted">Signed delivery note, signature and delivery photos.</p>
          </div>
          <div class="pod-status-pill">Signed POD</div>
        </div>

        <section class="card">
          <h2>Order</h2>
          <div class="pod-grid">
            <div>
              <span class="pod-label">Order</span>
              <strong>${esc(orderNumber)}</strong>
            </div>
            <div>
              <span class="pod-label">Product owner</span>
              <strong>${esc(customer)}</strong>
            </div>
            <div>
              <span class="pod-label">Route</span>
              <strong>${esc(routeCode)}</strong>
            </div>
            <div>
              <span class="pod-label">Driver</span>
              <strong>${esc(driver)}</strong>
            </div>
          </div>
        </section>

        <section class="card">
          <h2>Signed Delivery Note PDF</h2>
          <p class="muted">Delivery note including customer signature, POD remarks and delivery evidence.</p>

          ${
            pdfUrl
              ? `<a class="btn primary pod-download-btn" href="${esc(pdfUrl)}" target="_blank" rel="noopener">Open / Download Signed Delivery Note PDF</a>`
              : `<div class="notice err">Signed Delivery Note PDF has not been generated yet.</div>`
          }
        </section>

        <section class="card">
          <h2>Delivery Confirmation</h2>
          <div class="pod-grid">
            <div>
              <span class="pod-label">Received by</span>
              <strong>${esc(deliveredTo)}</strong>
            </div>
            <div>
              <span class="pod-label">Delivered at</span>
              <strong>${esc(formatDateTime(deliveredAt))}</strong>
            </div>
          </div>

          <div class="pod-notes">
            <span class="pod-label">Notes</span>
            <p>${esc(notes)}</p>
          </div>

          ${
            signatureUrl
              ? `<div class="pod-signature-wrap">
                   <span class="pod-label">Customer signature</span>
                   <img src="${esc(signatureUrl)}" alt="Customer signature" class="pod-signature-img"/>
                 </div>`
              : `<div class="notice err">No customer signature found.</div>`
          }
        </section>

        <section class="card">
          <h2>Delivery Photos</h2>
          <p class="muted">Maximum 5 photos per order.</p>

          ${
            photos.length
              ? `<div class="pod-photo-grid">
                  ${photos.map((url, index) => `
                    <a href="${esc(url)}" target="_blank" rel="noopener" class="pod-photo-link">
                      <img src="${esc(url)}" alt="Delivery photo ${index + 1}"/>
                      <span>Photo ${index + 1}</span>
                    </a>
                  `).join("")}
                </div>`
              : `<p class="muted">No delivery photos found.</p>`
          }
        </section>
      </section>
    `;
  }

  function addStyles() {
    if ($("podGeneratedStyles")) return;

    const style = document.createElement("style");
    style.id = "podGeneratedStyles";
    style.textContent = `
      .pod-page {
        display: grid;
        gap: 18px;
      }

      .pod-header-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
      }

      .pod-header-card h1 {
        margin: 0;
        font-size: 24px;
      }

      .pod-status-pill {
        padding: 8px 14px;
        border-radius: 999px;
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #bbf7d0;
        font-weight: 900;
      }

      .pod-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .pod-label {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        color: #64748b;
        font-weight: 900;
        margin-bottom: 4px;
      }

      .pod-download-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: 12px;
        text-decoration: none;
      }

      .pod-notes {
        margin-top: 16px;
        padding: 12px;
        border: 1px solid #dce5f2;
        border-radius: 14px;
        background: #f8fafc;
      }

      .pod-notes p {
        margin: 0;
        white-space: pre-wrap;
      }

      .pod-signature-wrap {
        margin-top: 16px;
      }

      .pod-signature-img {
        display: block;
        max-width: 360px;
        width: 100%;
        max-height: 160px;
        object-fit: contain;
        border: 1px solid #dce5f2;
        border-radius: 14px;
        background: #fff;
        padding: 12px;
      }

      .pod-photo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 12px;
        margin-top: 12px;
      }

      .pod-photo-link {
        display: block;
        border: 1px solid #dce5f2;
        border-radius: 14px;
        overflow: hidden;
        background: #fff;
        text-decoration: none;
        color: #07152f;
        font-weight: 900;
      }

      .pod-photo-link img {
        width: 100%;
        height: 150px;
        object-fit: cover;
        display: block;
      }

      .pod-photo-link span {
        display: block;
        padding: 10px;
      }

      @media (max-width: 800px) {
        .pod-grid {
          grid-template-columns: 1fr;
        }

        .pod-header-card {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    `;

    document.head.appendChild(style);
  }

  async function init() {
    try {
      addStyles();
      await loadOrder();
    } catch (error) {
      console.error(error);

      const root = $("podRoot") || $("podContent") || document.querySelector("main") || document.body;
      root.innerHTML = `
        <section class="card">
          <h1>Proof of Delivery</h1>
          <div class="notice err">${esc(error.message)}</div>
        </section>
      `;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();