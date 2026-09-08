(function () {
  "use strict";

  let currentOrder = null;
  let currentEvents = [];
  let currentWarnings = [];
const ACTIVITY_VIEW_VERSION = "2026-09-08-2312";

  /* =========================================================
     BASIC HELPERS
     ========================================================= */

  function byId(id) {
    return document.getElementById(id);
  }


  function clean(value) {
    return String(value ?? "").trim();
  }


  function normalize(value) {
    return clean(value).toLowerCase();
  }


  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  function toNumber(value, fallback = 0) {
    const number =
      Number(value);

    return Number.isFinite(number)
      ? number
      : fallback;
  }


  function getClient() {
    if (window.sb) {
      return window.sb();
    }

    if (window.supabaseClient) {
      return window.supabaseClient;
    }

    if (window.supabase) {
      return window.supabase;
    }

    throw new Error(
      "Supabase client not available."
    );
  }


  function parseDate(value) {
    if (!value) {
      return null;
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return null;
    }

    return date;
  }


  function getTime(value) {
    const date =
      parseDate(value);

    return date
      ? date.getTime()
      : 0;
  }


  function formatDateTime(value) {
    if (!value) {
      return "—";
    }

    const date =
      parseDate(value);

    if (!date) {
      return String(value);
    }

    return date.toLocaleString(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    );
  }


  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const raw =
      String(value).slice(0, 10);

    const match =
      raw.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    if (match) {
      return (
        `${match[3]}/` +
        `${match[2]}/` +
        `${match[1]}`
      );
    }

    const date =
      parseDate(value);

    if (!date) {
      return String(value);
    }

    return date.toLocaleDateString(
      "en-GB"
    );
  }


  function niceStatus(value) {
    const key =
      normalize(value);

    const map = {
      imported:
        "Imported",

      matching_review:
        "Matching Review",

      ready_for_picking:
        "Ready For Picking",

      ready_for_planning:
        "Ready For Planning",

      planned:
        "Planned",

      sent_to_driver:
        "Sent To Driver",

      out_for_delivery:
        "Out For Delivery",

      loaded:
        "Loaded",

      delivered:
        "Delivered",

      pod_completed:
        "POD Completed",

      closed:
        "Closed",

      cancelled:
        "Cancelled",

      export_for_charter:
        "Export For Charter",

      invoice_generated:
        "Invoice Generated",

      not_invoiced:
        "Not Invoiced",

      generated:
        "Generated",

      not_generated:
        "Not Generated",

      reserved:
        "Reserved",

      picked:
        "Picked",

      shipped:
        "Shipped",

      in_stock:
        "In Stock"
    };

    return (
      map[key] ||
      String(value || "—")
        .replaceAll("_", " ")
    );
  }


  /* =========================================================
     GROUPS
     ========================================================= */

  const GROUP_ORDER = [
    "all",
    "order",
    "stock",
    "documents",
    "planning",
    "delivery",
    "pod",
    "finance",
    "other"
  ];


  function groupLabel(group) {
    const map = {
      all:
        "All",

      order:
        "Order",

      stock:
        "Stock",

      documents:
        "Documents",

      planning:
        "Planning",

      delivery:
        "Delivery",

      pod:
        "POD",

      finance:
        "Finance",

      other:
        "Other"
    };

    return (
      map[group] ||
      group
    );
  }


  /* =========================================================
     EVENT DEFINITIONS
     ========================================================= */

  function activityMeta(type) {
    const key =
      normalize(type);

    const map = {

      /* -------------------------
         ORDER
         ------------------------- */

      order_imported: {
        icon: "↓",
        title: "Order Imported",
        group: "order",
        tone: "blue"
      },

      edit_order: {
        icon: "✎",
        title: "Order Edited",
        group: "order",
        tone: "blue"
      },

      copy_order_created: {
        icon: "⧉",
        title: "Copy Order Created",
        group: "order",
        tone: "blue"
      },

      cancelled: {
        icon: "×",
        title: "Order Cancelled",
        group: "order",
        tone: "red"
      },


      /* -------------------------
         STOCK
         ------------------------- */

      products_matched: {
        icon: "✓",
        title: "Products Matched",
        group: "stock",
        tone: "purple"
      },

      stock_complete: {
        icon: "✓",
        title: "Stock Complete",
        group: "stock",
        tone: "green"
      },

      picking_started: {
        icon: "↗",
        title: "Picking Started",
        group: "stock",
        tone: "purple"
      },

      order_picked: {
        icon: "✓",
        title: "Order Picked",
        group: "stock",
        tone: "green"
      },

      loading_started: {
        icon: "↗",
        title: "Loading Started",
        group: "stock",
        tone: "purple"
      },

      order_loaded: {
        icon: "✓",
        title: "Order Loaded",
        group: "stock",
        tone: "green"
      },

      stock_shipped: {
        icon: "→",
        title: "Stock Shipped",
        group: "stock",
        tone: "green"
      },

      edit_order_matching: {
        icon: "▣",
        title: "Matching Updated",
        group: "stock",
        tone: "purple"
      },

      order_edit_stock_released: {
        icon: "↺",
        title: "Stock Released",
        group: "stock",
        tone: "purple"
      },

      stock_priority_set: {
        icon: "!",
        title: "Stock Priority Set",
        group: "stock",
        tone: "orange"
      },


      /* -------------------------
         DOCUMENTS
         ------------------------- */

      acknowledgement_generated: {
        icon: "□",
        title: "Acknowledgement Generated",
        group: "documents",
        tone: "blue"
      },

      acknowledgement_uploaded: {
        icon: "□",
        title: "Acknowledgement Uploaded",
        group: "documents",
        tone: "blue"
      },

      supplier_packing_slip: {
        icon: "□",
        title: "Supplier Packing Slip Available",
        group: "documents",
        tone: "grey"
      },

      delivery_labels_generated: {
        icon: "□",
        title: "Delivery Labels Generated",
        group: "documents",
        tone: "blue"
      },

      delivery_note_generated: {
        icon: "□",
        title: "Delivery Note Generated",
        group: "documents",
        tone: "blue"
      },

      pod_document_generated: {
        icon: "□",
        title: "POD Document Available",
        group: "documents",
        tone: "green"
      },


      /* -------------------------
         PLANNING
         ------------------------- */

      delivery_date_historical: {
        icon: "◇",
        title: "Historical Delivery Date",
        group: "planning",
        tone: "grey"
      },

      delivery_date_planned: {
        icon: "◇",
        title: "Delivery Date Planned",
        group: "planning",
        tone: "blue"
      },

      delivery_date_changed: {
        icon: "◇",
        title: "Delivery Date Changed",
        group: "planning",
        tone: "orange"
      },

      manual_delivery_date: {
        icon: "◇",
        title: "Manual Delivery Date",
        group: "planning",
        tone: "blue"
      },

      fds_planning_allocated: {
        icon: "F",
        title: "Assigned to FDS",
        group: "planning",
        tone: "orange"
      },

      fds_planning_unallocated: {
        icon: "F",
        title: "Removed from FDS",
        group: "planning",
        tone: "grey"
      },

      fds_collection_scheduled: {
        icon: "F",
        title: "FDS Collection Scheduled",
        group: "planning",
        tone: "orange"
      },

      planning_reset: {
        icon: "↺",
        title: "Planning Reset",
        group: "planning",
        tone: "orange"
      },

      warehouse_pickup_assigned: {
        icon: "↥",
        title: "Warehouse Pickup Assigned",
        group: "planning",
        tone: "blue"
      },


      /* -------------------------
         DELIVERY
         ------------------------- */

      sent_to_driver: {
        icon: "→",
        title: "Sent to Driver",
        group: "delivery",
        tone: "blue"
      },

      out_for_delivery: {
        icon: "→",
        title: "Out for Delivery",
        group: "delivery",
        tone: "blue"
      },

      unloading_detected: {
        icon: "↓",
        title: "Unloading Detected",
        group: "delivery",
        tone: "green"
      },

      delivered: {
        icon: "✓",
        title: "Delivered",
        group: "delivery",
        tone: "green"
      },


      /* -------------------------
         POD
         ------------------------- */

      pod_completed: {
        icon: "✓",
        title: "POD Completed",
        group: "pod",
        tone: "green"
      },

      pod_signature_uploaded: {
        icon: "✍",
        title: "Signature Uploaded",
        group: "pod",
        tone: "green"
      },

      pod_photos_uploaded: {
        icon: "▧",
        title: "Delivery Photos Uploaded",
        group: "pod",
        tone: "green"
      },

      signed_delivery_note_uploaded: {
        icon: "□",
        title: "Signed Delivery Note Uploaded",
        group: "pod",
        tone: "green"
      },

      manual_signed_pod: {
        icon: "✍",
        title: "Manual Signed POD",
        group: "pod",
        tone: "green"
      },

      manual_pod_photos: {
        icon: "▧",
        title: "Manual POD Photos",
        group: "pod",
        tone: "green"
      },

      signed_delivery_note_generated: {
        icon: "□",
        title: "Signed Delivery Note Generated",
        group: "pod",
        tone: "green"
      },


      /* -------------------------
         FINANCE
         ------------------------- */

      invoice_generated: {
        icon: "£",
        title: "Invoice Generated",
        group: "finance",
        tone: "orange"
      },

      credit_order_created: {
        icon: "−",
        title: "Credit Order Created",
        group: "finance",
        tone: "orange"
      },

      credit_note_generated: {
        icon: "£",
        title: "Credit Note Generated",
        group: "finance",
        tone: "orange"
      },

      manual_charge_created: {
        icon: "£",
        title: "Manual Charge Created",
        group: "finance",
        tone: "orange"
      },

      manual_tariff_update: {
        icon: "£",
        title: "Tariff Updated",
        group: "finance",
        tone: "orange"
      },


      /* -------------------------
         STATUS
         ------------------------- */

      change_status: {
        icon: "●",
        title: "Status Changed",
        group: "other",
        tone: "grey"
      }
    };

    return (
      map[key] || {
        icon: "•",
        title: niceStatus(
          key || "Activity"
        ),
        group: "other",
        tone: "grey"
      }
    );
  }


  /* =========================================================
     EVENT FACTORY
     ========================================================= */

  function makeEvent({
    id,
    type,
    timestamp,
    description = "",
    oldStatus = null,
    newStatus = null,
    createdBy = null,
    historical = false,
    source = "derived",
    sortAt = null
  }) {
    return {
      id:
        id ||
        (
          `${source}-` +
          `${type}-` +
          `${timestamp || Math.random()}`
        ),

      activity_type:
        type,

      description:
        description,

      old_status:
        oldStatus,

      new_status:
        newStatus,

      created_by:
        createdBy,

      created_at:
        timestamp,

      historical:
        historical,

      source:
        source,

      sort_at:
        sortAt ||
        timestamp ||
        null
    };
  }


  /* =========================================================
     OPEN TOOL
     ========================================================= */

  async function open(orderId) {
  try {
    if (!orderId) {
      throw new Error(
        "Order ID is missing."
      );
    }


    let order = null;


    /*
     * =========================================
     * 1. Eerst proberen via de OCC-cache
     * =========================================
     */

    if (
      typeof window.getOrderById ===
      "function"
    ) {
      order =
        window.getOrderById(
          orderId
        );
    }


    /*
     * =========================================
     * 2. Fallback voor externe accounts
     *
     * Bellstone kan de order in OCC zien,
     * maar de lokale OCC-ordercache hoeft niet
     * altijd beschikbaar te zijn voor deze tool.
     *
     * Daarom halen we de order rechtstreeks uit
     * Supabase als de cache niets teruggeeft.
     * RLS blijft gewoon van toepassing.
     * =========================================
     */

    if (!order) {
      const client =
        getClient();


      const {
        data,
        error
      } =
        await client
          .from("orders")
          .select("*")
          .eq(
            "id",
            orderId
          )
          .maybeSingle();


      if (error) {
        throw error;
      }


      order =
        data ||
        null;
    }


    if (!order) {
      throw new Error(
        "Order could not be loaded."
      );
    }


    /*
     * =========================================
     * 3. Tool initialiseren
     * =========================================
     */

    currentOrder =
      order;

    currentEvents =
      [];

    currentWarnings =
      [];


    /*
     * Modal meteen openen.
     */
    renderLoading(
      order
    );


    /*
     * =========================================
     * 4. Lifecycle laden
     * =========================================
     */

    try {
      currentEvents =
        await loadLifecycle(
          order
        );


      renderTimeline(
        "all"
      );

    } catch (error) {

      console.error(
        "[ActivityViewTool] Lifecycle error:",
        error
      );


      /*
       * De modal blijft open.
       * Dus Bellstone krijgt in ieder geval
       * een duidelijke foutmelding in plaats
       * van dat er schijnbaar niets gebeurt.
       */
      renderError(
        error
      );
    }


  } catch (error) {

    console.error(
      "[ActivityViewTool] Open error:",
      error
    );


    /*
     * Probeer ook bij een vroege fout
     * de generic modal te gebruiken.
     */
    const modal =
      byId(
        "occGenericActionModal"
      );

    const body =
      byId(
        "genericActionBody"
      );

    const saveBtn =
      byId(
        "genericActionSaveBtn"
      );


    if (
      modal &&
      body
    ) {

      if (saveBtn) {
        saveBtn.style.display =
          "none";
      }


      const title =
        byId(
          "genericActionTitle"
        );

      if (title) {
        title.textContent =
          "Order Lifecycle";
      }


      const sub =
        byId(
          "genericActionSub"
        );

      if (sub) {
        sub.textContent =
          "View Activity";
      }


      body.innerHTML = `
        <section class="occ-modal-section">

          <h3>
            Order Lifecycle
          </h3>

          <p
            style="
              color:#b42318;
              margin:0;
            "
          >
            ${escapeHtml(
              error.message ||
              "Could not load order lifecycle."
            )}
          </p>

        </section>
      `;


      modal.classList.add(
        "open"
      );

      modal.setAttribute(
        "aria-hidden",
        "false"
      );
    }
  }
}

  function renderLoading(order) {
    const modal =
      byId(
        "occGenericActionModal"
      );

    const body =
      byId(
        "genericActionBody"
      );

    const saveBtn =
      byId(
        "genericActionSaveBtn"
      );

    if (
      !modal ||
      !body ||
      !saveBtn
    ) {
      return;
    }

    byId(
      "genericActionOrderId"
    ).value =
      order.id;

    byId(
      "genericActionType"
    ).value =
      "view_activity";

    byId(
      "genericActionTitle"
    ).textContent =
      "Order Lifecycle";

    byId(
      "genericActionSub"
    ).textContent =
      `${
        order.order_number ||
        "Order"
      } · ${
        order.retailer_name ||
        ""
      } · ${
        order.delivery_postcode ||
        ""
      }`;

    saveBtn.style.display =
      "none";

    body.innerHTML = `
      <section class="occ-modal-section">

        <h3>
          Order Lifecycle
        </h3>

        <p
          style="
            color:#667085;
            margin:0;
          "
        >
          Loading complete order history...
        </p>

      </section>
    `;

    modal.classList.add(
      "open"
    );

    modal.setAttribute(
      "aria-hidden",
      "false"
    );
  }


  /* =========================================================
     LOAD COMPLETE LIFECYCLE
     ========================================================= */

  async function loadLifecycle(order) {
    const client =
      getClient();

    const events = [];

    /*
     * Order import is always available from orders.created_at.
     */
    if (order.created_at) {
      events.push(
        makeEvent({
          id:
            `order-import-${order.id}`,

          type:
            "order_imported",

          timestamp:
            order.created_at,

          description:
            `${
              order.order_number ||
              "Order"
            } imported into Veynor.`,

          source:
            "orders"
        })
      );
    }


    const [
      activityResult,
      documentsResult,
      planningResult,
      podResult,
      stockResult
    ] =
      await Promise.allSettled([
        loadActivityRows(
          client,
          order.id
        ),

        loadDocumentRows(
          client,
          order.id
        ),

        loadPlanningRows(
          client,
          order.id
        ),

        loadPodRows(
          client,
          order.id
        ),

        loadStockRows(
          client,
          order.id
        )
      ]);


    const activityRows =
      extractSettledRows(
        activityResult,
        "Activity log"
      );

    const documentRows =
      extractSettledRows(
        documentsResult,
        "Documents"
      );

    const planningRows =
      extractSettledRows(
        planningResult,
        "Planning history"
      );

    const podRows =
      extractSettledRows(
        podResult,
        "POD assets"
      );

    const stockRows =
      extractSettledRows(
        stockResult,
        "Stock history"
      );


    events.push(
      ...buildDocumentEvents(
        documentRows
      )
    );

    events.push(
      ...buildPlanningEvents(
        planningRows
      )
    );

    events.push(
      ...buildStockEvents(
        stockRows
      )
    );

    events.push(
      ...buildPodEvents(
        podRows
      )
    );

    events.push(
      ...buildActivityEvents(
        activityRows,
        {
          hasDocuments:
            documentRows.length > 0,

          hasPodAssets:
            podRows.length > 0,

          hasPlanningHistory:
            planningRows.length > 0
        }
      )
    );


    /*
     * FDS fallback:
     * older orders do not always have an activity row.
     */
    addFdsFallbackEvent(
      events,
      order
    );


    /*
     * Delivered fallback:
     * show delivery if order currently clearly is delivered
     * and no delivered event exists.
     */
    addDeliveredFallbackEvent(
      events,
      order
    );


    return dedupeAndSortEvents(
      events
    );
  }


  function extractSettledRows(
    result,
    label
  ) {
    if (
      result.status ===
      "fulfilled"
    ) {
      return (
        result.value ||
        []
      );
    }

    console.warn(
      `[ActivityViewTool] ${label} could not be loaded:`,
      result.reason
    );

    currentWarnings.push(
      `${label} could not be loaded.`
    );

    return [];
  }


  /* =========================================================
     DATABASE LOADERS
     ========================================================= */

  async function loadActivityRows(
    client,
    orderId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "order_activity_log"
        )
        .select(`
          id,
          activity_type,
          description,
          old_status,
          new_status,
          created_by,
          created_at
        `)
        .eq(
          "order_id",
          orderId
        )
        .order(
          "created_at",
          {
            ascending:
              true
          }
        )
        .limit(
          500
        );

    if (error) {
      throw error;
    }

    return (
      data ||
      []
    );
  }


  async function loadDocumentRows(
    client,
    orderId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "order_documents"
        )
        .select(`
          id,
          document_type,
          document_number,
          document_status,
          created_at,
          updated_at,
          sent_at
        `)
        .eq(
          "order_id",
          orderId
        )
        .order(
          "created_at",
          {
            ascending:
              true
          }
        );

    if (error) {
      throw error;
    }

    return (
      data ||
      []
    );
  }


  async function loadPlanningRows(
    client,
    orderId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "order_delivery_date_history"
        )
        .select(`
          id,
          delivery_date,
          change_sequence,
          source,
          changed_by,
          created_at
        `)
        .eq(
          "order_id",
          orderId
        )
        .order(
          "change_sequence",
          {
            ascending:
              true
          }
        )
        .order(
          "created_at",
          {
            ascending:
              true
          }
        );

    if (error) {
      throw error;
    }

    return (
      data ||
      []
    );
  }


  async function loadPodRows(
    client,
    orderId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "order_pod_assets"
        )
        .select(`
          id,
          asset_type,
          file_name,
          captured_at,
          captured_by_name,
          created_at
        `)
        .eq(
          "order_id",
          orderId
        )
        .order(
          "created_at",
          {
            ascending:
              true
          }
        );

    if (error) {
      throw error;
    }

    return (
      data ||
      []
    );
  }


  async function loadStockRows(
    client,
    orderId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "order_lines"
        )
        .select(`
          id,
          line_number,
          sku_base,
          quantity_ordered,
          packages_per_unit,
          total_packages,

          order_allocations (
            id,
            allocation_status,
            allocated_at,
            item_id,

            items (
              id,
              status,
              reserved_at,
              picked_at,
              loaded_at,
              shipped_at
            )
          )
        `)
        .eq(
          "order_id",
          orderId
        );

    if (error) {
      throw error;
    }

    return (
      data ||
      []
    );
  }


  /* =========================================================
     DOCUMENT EVENTS
     ========================================================= */

  function buildDocumentEvents(rows) {
    const events = [];

    rows.forEach(row => {
      const type =
        normalize(
          row.document_type
        );

      let eventType =
        null;

      let description =
        "";

      if (
        type ===
        "acknowledgement"
      ) {
        eventType =
          "acknowledgement_generated";

        description =
          row.document_number
            ? `Acknowledgement ${row.document_number} generated.`
            : "Acknowledgement generated.";
      }

      else if (
        type ===
        "legacy_acknowledgement"
      ) {
        eventType =
          "acknowledgement_uploaded";

        description =
          "Legacy acknowledgement uploaded.";
      }

      else if (
        type ===
        "supplier_packing_slip"
      ) {
        eventType =
          "supplier_packing_slip";

        description =
          "Supplier packing slip available.";
      }

      else if (
        type ===
        "delivery_labels"
      ) {
        eventType =
          "delivery_labels_generated";

        description =
          "Delivery labels generated.";
      }

      else if (
        type ===
        "delivery_note"
      ) {
        eventType =
          "delivery_note_generated";

        description =
          row.document_number
            ? `Delivery note ${row.document_number} generated.`
            : "Delivery note generated.";
      }

      else if (
        type ===
        "pod"
      ) {
        eventType =
          "pod_document_generated";

        description =
          "POD document available.";
      }

      else if (
        type ===
        "invoice"
      ) {
        eventType =
          "invoice_generated";

        description =
          row.document_number
            ? `Invoice ${row.document_number} generated.`
            : "Invoice generated.";
      }

      if (!eventType) {
        return;
      }

      events.push(
        makeEvent({
          id:
            `document-${row.id}`,

          type:
            eventType,

          timestamp:
            row.created_at,

          description:
            description,

          source:
            "order_documents"
        })
      );
    });

    return events;
  }


  /* =========================================================
     PLANNING EVENTS
     ========================================================= */

  function buildPlanningEvents(rows) {
    const events = [];

    const sorted =
      rows
        .slice()
        .sort(
          (a, b) =>
            toNumber(
              a.change_sequence
            ) -
            toNumber(
              b.change_sequence
            )
        );

    sorted.forEach(
      (
        row,
        index
      ) => {

        const previous =
          index > 0
            ? sorted[
                index - 1
              ]
            : null;

        const isMigration =
          normalize(
            row.source
          ) ===
          "initial_migration";

        if (isMigration) {
          events.push(
            makeEvent({
              id:
                `planning-history-${row.id}`,

              type:
                "delivery_date_historical",

              timestamp:
                null,

              sortAt:
                null,

              historical:
                true,

              description:
                `Historical planned delivery date: ${
                  formatDate(
                    row.delivery_date
                  )
                }. Original planning timestamp is not available.`,

              source:
                "order_delivery_date_history"
            })
          );

          return;
        }


        if (!previous) {
          events.push(
            makeEvent({
              id:
                `planning-history-${row.id}`,

              type:
                "delivery_date_planned",

              timestamp:
                row.created_at,

              description:
                `Delivery planned for ${
                  formatDate(
                    row.delivery_date
                  )
                }.`,

              createdBy:
                row.changed_by,

              source:
                "order_delivery_date_history"
            })
          );

          return;
        }


        events.push(
          makeEvent({
            id:
              `planning-history-${row.id}`,

            type:
              "delivery_date_changed",

            timestamp:
              row.created_at,

            description:
              `Delivery date changed from ${
                formatDate(
                  previous.delivery_date
                )
              } to ${
                formatDate(
                  row.delivery_date
                )
              }.`,

            createdBy:
              row.changed_by,

            source:
              "order_delivery_date_history"
          })
        );
      }
    );

    return events;
  }


  /* =========================================================
     STOCK EVENTS
     ========================================================= */

  function getRequiredPackages(
    line
  ) {
    const direct =
      toNumber(
        line.total_packages,
        0
      );

    if (direct > 0) {
      return direct;
    }

    const qty =
      toNumber(
        line.quantity_ordered,
        0
      );

    const packagesPerUnit =
      Math.max(
        1,
        toNumber(
          line.packages_per_unit,
          1
        )
      );

    return (
      qty *
      packagesPerUnit
    );
  }


  function flattenAllocations(lines) {
    const map =
      new Map();

    (lines || []).forEach(
      line => {

        const allocations =
          Array.isArray(
            line.order_allocations
          )
            ? line.order_allocations
            : [];

        allocations.forEach(
          allocation => {

            const id =
              allocation.id ||
              `${line.id}-${allocation.item_id}`;

            if (
              !map.has(id)
            ) {
              map.set(
                id,
                {
                  ...allocation,

                  line_id:
                    line.id,

                  sku_base:
                    line.sku_base,

                  line_number:
                    line.line_number
                }
              );
            }
          }
        );
      }
    );

    return [
      ...map.values()
    ];
  }


  function getAllocationItem(
    allocation
  ) {
    if (
      Array.isArray(
        allocation.items
      )
    ) {
      return (
        allocation.items[0] ||
        null
      );
    }

    return (
      allocation.items ||
      null
    );
  }


  function buildStockEvents(lines) {
    const events = [];

    const allocations =
      flattenAllocations(
        lines
      );

    if (
      !allocations.length
    ) {
      return events;
    }


    const requiredPackages =
      (lines || [])
        .reduce(
          (
            total,
            line
          ) =>
            total +
            getRequiredPackages(
              line
            ),
          0
        );


    const allocationsWithDate =
      allocations
        .filter(
          row =>
            parseDate(
              row.allocated_at
            )
        )
        .sort(
          (a, b) =>
            getTime(
              a.allocated_at
            ) -
            getTime(
              b.allocated_at
            )
        );


    if (
      allocationsWithDate.length
    ) {
      const firstAllocation =
        allocationsWithDate[0];

      events.push(
        makeEvent({
          id:
            `stock-match-${currentOrder.id}`,

          type:
            "products_matched",

          timestamp:
            firstAllocation.allocated_at,

          description:
            requiredPackages > 0
              ? `Stock allocation started. ${
                  allocations.length
                } of ${
                  requiredPackages
                } required packages are currently linked to this order.`
              : `Stock allocation started. ${
                  allocations.length
                } package allocation(s) linked to this order.`,

          source:
            "order_allocations"
        })
      );
    }


    if (
      requiredPackages > 0 &&
      allocationsWithDate.length >=
        requiredPackages
    ) {
      const completeAllocation =
        allocationsWithDate[
          requiredPackages - 1
        ];

      events.push(
        makeEvent({
          id:
            `stock-complete-${currentOrder.id}`,

          type:
            "stock_complete",

          timestamp:
            completeAllocation.allocated_at,

          description:
            `${requiredPackages} of ${requiredPackages} required packages allocated. Order stock complete.`,

          source:
            "order_allocations"
        })
      );
    }


    const items =
      allocations
        .map(
          getAllocationItem
        )
        .filter(Boolean);


    buildItemMilestoneEvent(
      events,
      items,
      {
        field:
          "picked_at",

        partialType:
          "picking_started",

        completeType:
          "order_picked",

        partialDescription:
          "Picking started for this order.",

        completeDescription:
          "All linked stock items were picked."
      }
    );


    buildItemMilestoneEvent(
      events,
      items,
      {
        field:
          "loaded_at",

        partialType:
          "loading_started",

        completeType:
          "order_loaded",

        partialDescription:
          "Loading started for this order.",

        completeDescription:
          "All linked stock items were loaded."
      }
    );


    buildItemMilestoneEvent(
      events,
      items,
      {
        field:
          "shipped_at",

        partialType:
          "stock_shipped",

        completeType:
          "stock_shipped",

        partialDescription:
          "Stock started leaving the warehouse.",

        completeDescription:
          "All linked stock items were shipped."
      }
    );


    return events;
  }


  function buildItemMilestoneEvent(
    events,
    items,
    config
  ) {
    if (!items.length) {
      return;
    }

    const dated =
      items
        .filter(
          item =>
            parseDate(
              item[
                config.field
              ]
            )
        )
        .sort(
          (a, b) =>
            getTime(
              a[
                config.field
              ]
            ) -
            getTime(
              b[
                config.field
              ]
            )
        );

    if (!dated.length) {
      return;
    }


    const allComplete =
      dated.length ===
      items.length;


    const timestamp =
      allComplete
        ? dated[
            dated.length - 1
          ][
            config.field
          ]
        : dated[0][
            config.field
          ];


    events.push(
      makeEvent({
        id:
          `${config.field}-${currentOrder.id}`,

        type:
          allComplete
            ? config.completeType
            : config.partialType,

        timestamp:
          timestamp,

        description:
          allComplete
            ? config.completeDescription
            : config.partialDescription,

        source:
          "items"
      })
    );
  }


  /* =========================================================
     POD EVENTS
     ========================================================= */

  function buildPodEvents(rows) {
    const events = [];

    const signatures =
      rows.filter(
        row =>
          normalize(
            row.asset_type
          ) ===
          "signature"
      );

    const photos =
      rows.filter(
        row =>
          normalize(
            row.asset_type
          ) ===
          "photo"
      );

    const signedNotes =
      rows.filter(
        row =>
          normalize(
            row.asset_type
          ) ===
          "signed_delivery_note"
      );


    if (signatures.length) {
      const latest =
        getLatestAsset(
          signatures
        );

      events.push(
        makeEvent({
          id:
            `pod-signature-${currentOrder.id}`,

          type:
            "pod_signature_uploaded",

          timestamp:
            latest.captured_at ||
            latest.created_at,

          description:
            latest.captured_by_name
              ? `Delivery signature captured by ${latest.captured_by_name}.`
              : "Delivery signature captured.",

          source:
            "order_pod_assets"
        })
      );
    }


    if (photos.length) {
      const latest =
        getLatestAsset(
          photos
        );

      events.push(
        makeEvent({
          id:
            `pod-photos-${currentOrder.id}`,

          type:
            "pod_photos_uploaded",

          timestamp:
            latest.captured_at ||
            latest.created_at,

          description:
            `${photos.length} delivery photo${
              photos.length === 1
                ? ""
                : "s"
            } uploaded.`,

          source:
            "order_pod_assets"
        })
      );
    }


    if (signedNotes.length) {
      const latest =
        getLatestAsset(
          signedNotes
        );

      events.push(
        makeEvent({
          id:
            `signed-dn-${currentOrder.id}`,

          type:
            "signed_delivery_note_uploaded",

          timestamp:
            latest.captured_at ||
            latest.created_at,

          description:
            "Signed delivery note uploaded.",

          source:
            "order_pod_assets"
        })
      );
    }


    return events;
  }


  function getLatestAsset(
    rows
  ) {
    return rows
      .slice()
      .sort(
        (a, b) =>
          getTime(
            b.captured_at ||
            b.created_at
          ) -
          getTime(
            a.captured_at ||
            a.created_at
          )
      )[0];
  }


  /* =========================================================
     ACTIVITY LOG EVENTS
     ========================================================= */

  function buildActivityEvents(
    rows,
    sourceState
  ) {
    const events = [];

    /*
     * Structured data is preferred where available.
     * These log events would otherwise duplicate timeline cards.
     */
    const alwaysSkip =
      new Set([
        "legacy_import",
        "manual_order_import",
        "order_import_notification_created"
      ]);


    rows.forEach(row => {
      const type =
        normalize(
          row.activity_type
        );

      if (
        alwaysSkip.has(type)
      ) {
        return;
      }


      if (
        sourceState.hasDocuments &&
        (
          type ===
            "document_generated" ||
          type ===
            "invoice_generated"
        )
      ) {
        return;
      }


      if (
        sourceState.hasPlanningHistory &&
        type ===
          "manual_delivery_date"
      ) {
        return;
      }


      if (
        sourceState.hasPodAssets &&
        (
          type ===
            "manual_pod_photos" ||
          type ===
            "manual_signed_pod" ||
          type ===
            "signed_delivery_note_generated"
        )
      ) {
        return;
      }


      let mappedType =
        type;


      if (
        type ===
        "change_status"
      ) {
        const newStatus =
          normalize(
            row.new_status
          );

        if (
          newStatus ===
          "delivered"
        ) {
          mappedType =
            "delivered";
        }

        else if (
          newStatus ===
          "out_for_delivery"
        ) {
          mappedType =
            "out_for_delivery";
        }

        else if (
          newStatus ===
          "sent_to_driver"
        ) {
          mappedType =
            "sent_to_driver";
        }

        else if (
          newStatus ===
          "cancelled"
        ) {
          mappedType =
            "cancelled";
        }
      }


      events.push(
        makeEvent({
          id:
            `activity-${row.id}`,

          type:
            mappedType,

          timestamp:
            row.created_at,

          description:
            clean(
              row.description
            ) ||
            "Activity recorded.",

          oldStatus:
            row.old_status,

          newStatus:
            row.new_status,

          createdBy:
            row.created_by,

          source:
            "order_activity_log"
        })
      );
    });


    return events;
  }


  /* =========================================================
     FALLBACK CURRENT-STATE EVENTS
     ========================================================= */

  function addFdsFallbackEvent(
    events,
    order
  ) {
    const isFds =
      normalize(
        order.transport_type
      ) === "charter" ||
      normalize(
        order.status
      ) ===
        "export_for_charter" ||
      normalize(
        order.transport_status
      ) ===
        "export_for_charter";


    if (
      !isFds ||
      !order.fds_collection_date
    ) {
      return;
    }


    const alreadyExists =
      events.some(
        event =>
          normalize(
            event.activity_type
          ) ===
          "fds_planning_allocated"
      );


    if (alreadyExists) {
      return;
    }


    /*
     * We know the collection date,
     * but older records may not contain the actual assignment timestamp.
     */
    events.push(
      makeEvent({
        id:
          `fds-fallback-${order.id}`,

        type:
          "fds_collection_scheduled",

        timestamp:
          null,

        historical:
          true,

        description:
          `FDS collection date: ${
            formatDate(
              order.fds_collection_date
            )
          }. Original FDS assignment timestamp is not available.`,

        source:
          "orders"
      })
    );
  }


  function addDeliveredFallbackEvent(
    events,
    order
  ) {
    const isDelivered =
      normalize(
        order.status
      ) === "delivered" ||
      normalize(
        order.transport_status
      ) === "delivered" ||
      normalize(
        order.warehouse_status
      ) === "delivered";


    if (!isDelivered) {
      return;
    }


    const alreadyExists =
      events.some(
        event =>
          normalize(
            event.activity_type
          ) ===
          "delivered"
      );


    if (alreadyExists) {
      return;
    }


    const deliveryDate =
      order.confirmed_delivery_date ||
      order.expected_delivery_date ||
      null;


    if (!deliveryDate) {
      return;
    }


    events.push(
      makeEvent({
        id:
          `delivered-fallback-${order.id}`,

        type:
          "delivered",

        timestamp:
          `${String(
            deliveryDate
          ).slice(0, 10)}T12:00:00`,

        description:
          `Order marked as delivered on ${
            formatDate(
              deliveryDate
            )
          }. Exact delivery timestamp is not available.`,

        source:
          "orders"
      })
    );
  }


  /* =========================================================
     SORT + DEDUPE
     ========================================================= */

  function dedupeAndSortEvents(
    rows
  ) {
    const map =
      new Map();


    rows.forEach(row => {
      if (!row) {
        return;
      }

      const key =
        row.id ||
        (
          `${row.activity_type}|` +
          `${row.created_at}|` +
          `${row.description}`
        );

      if (
        !map.has(key)
      ) {
        map.set(
          key,
          row
        );
      }
    });


    return [
      ...map.values()
    ]
      .sort(
        (a, b) => {

          /*
           * Historical records without a real event time
           * are shown at the bottom.
           */
          if (
            a.historical &&
            !b.historical
          ) {
            return 1;
          }

          if (
            !a.historical &&
            b.historical
          ) {
            return -1;
          }

          return (
            getTime(
              b.sort_at
            ) -
            getTime(
              a.sort_at
            )
          );
        }
      );
  }


  /* =========================================================
     FILTER GROUPS
     ========================================================= */

  function getAvailableGroups(
    events
  ) {
    const present =
      new Set([
        "all"
      ]);

    events.forEach(
      event => {
        present.add(
          activityMeta(
            event.activity_type
          ).group
        );
      }
    );

    return GROUP_ORDER.filter(
      group =>
        present.has(
          group
        )
    );
  }


  /* =========================================================
     RENDER TIMELINE
     ========================================================= */

  function renderTimeline(
    activeGroup = "all"
  ) {
    const body =
      byId(
        "genericActionBody"
      );

    if (!body) {
      return;
    }


    const events =
      currentEvents ||
      [];


    const groups =
      getAvailableGroups(
        events
      );


    const filtered =
      activeGroup === "all"
        ? events
        : events.filter(
            event =>
              activityMeta(
                event.activity_type
              ).group ===
              activeGroup
          );


    body.innerHTML = `
      <section class="occ-modal-section">

        <div
          class="activity-top"
        >

          <div>

            <h3>
              Order Lifecycle
            </h3>

            <p class="activity-summary">
              ${
                escapeHtml(
                  events.length
                )
              }
              lifecycle event${
                events.length === 1
                  ? ""
                  : "s"
              }
              found for this order.
            </p>

          </div>

          <div class="activity-order-ref">

            <strong>
              ${escapeHtml(
                currentOrder?.order_number ||
                ""
              )}
            </strong>

            <span>
              ${escapeHtml(
                currentOrder?.retailer_name ||
                ""
              )}
            </span>

          </div>

        </div>


        ${
          currentWarnings.length
            ? `
                <div class="activity-warning">

                  Some lifecycle sources could not be loaded:

                  ${escapeHtml(
                    currentWarnings.join(
                      " "
                    )
                  )}

                </div>
              `
            : ""
        }


        <div class="activity-filter-row">

          ${groups
            .map(
              group => `

                <button
                  type="button"
                  class="
                    activity-filter-btn
                    ${
                      group ===
                      activeGroup
                        ? "is-active"
                        : ""
                    }
                  "
                  data-activity-filter="${escapeHtml(
                    group
                  )}"
                >
                  ${escapeHtml(
                    groupLabel(
                      group
                    )
                  )}
                </button>

              `
            )
            .join("")}

        </div>


        <div class="activity-timeline">

          ${
            filtered.length
              ? filtered
                  .map(
                    renderEvent
                  )
                  .join("")
              : `
                  <div class="activity-empty">
                    No activity found for this filter.
                  </div>
                `
          }

        </div>

      </section>


      <style>

        .activity-top{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:18px;
        }


        .activity-top h3{
          margin:0 0 4px;
        }


        .activity-summary{
          margin:0;
          color:#667085;
          font-size:12px;
        }


        .activity-order-ref{
          display:flex;
          flex-direction:column;
          align-items:flex-end;
          gap:2px;

          color:#10213f;
          font-size:12px;
        }


        .activity-order-ref span{
          color:#667085;
          font-size:11px;
        }


        .activity-warning{
          margin-top:14px;
          padding:10px 12px;

          border:1px solid #fed7aa;
          border-radius:10px;

          background:#fff7ed;

          color:#9a3412;
          font-size:11px;
          line-height:1.45;
        }


        .activity-filter-row{
          display:flex;
          flex-wrap:wrap;
          gap:8px;

          margin:18px 0 20px;
        }


        .activity-filter-btn{
          border:1px solid #d6e2f2;
          background:#fff;
          color:#10213f;

          border-radius:999px;

          padding:8px 12px;

          font-weight:800;
          cursor:pointer;
          font-size:11px;
        }


        .activity-filter-btn:hover{
          border-color:#93c5fd;
          background:#f8fbff;
        }


        .activity-filter-btn.is-active{
          background:#1667ff;
          border-color:#1667ff;
          color:#fff;
        }


        .activity-timeline{
          position:relative;

          display:grid;
          gap:10px;
        }


        .activity-card{
          display:grid;

          grid-template-columns:
            42px
            minmax(0,1fr);

          gap:12px;

          border:1px solid #dbe7f6;
          background:#fff;

          border-radius:14px;

          padding:13px 14px;
        }


        .activity-card:hover{
          border-color:#bfdbfe;
          box-shadow:
            0 5px 18px rgba(
              15,
              23,
              42,
              .05
            );
        }


        .activity-icon{
          width:34px;
          height:34px;

          border-radius:999px;

          display:flex;
          align-items:center;
          justify-content:center;

          font-weight:950;
          font-size:14px;
        }


        .activity-icon.green{
          background:#e8f8ef;
          color:#14804a;
        }


        .activity-icon.blue{
          background:#eaf2ff;
          color:#1667ff;
        }


        .activity-icon.orange{
          background:#fff3e7;
          color:#c75a00;
        }


        .activity-icon.purple{
          background:#f1eaff;
          color:#7047d9;
        }


        .activity-icon.grey{
          background:#f2f4f7;
          color:#667085;
        }


        .activity-icon.red{
          background:#feecec;
          color:#b42318;
        }


        .activity-card-head{
          display:flex;
          justify-content:space-between;
          gap:12px;

          align-items:flex-start;
        }


        .activity-title{
          color:#10213f;

          font-size:13px;
          font-weight:950;
        }


        .activity-date{
          color:#667085;

          font-size:11px;
          font-weight:700;

          white-space:nowrap;
        }


        .activity-date.historical{
          color:#98a2b3;
          font-style:italic;
        }


        .activity-description{
          margin-top:5px;

          color:#344054;

          line-height:1.45;
          font-size:12px;

          white-space:pre-wrap;
        }


        .activity-status-change{
          margin-top:9px;

          display:flex;
          align-items:center;
          gap:7px;
          flex-wrap:wrap;

          font-size:11px;
        }


        .activity-pill{
          border-radius:999px;

          background:#f2f4f7;
          color:#344054;

          padding:4px 8px;

          font-weight:800;
        }


        .activity-user{
          margin-top:7px;

          color:#98a2b3;

          font-size:10px;
        }


        .activity-empty{
          border:1px dashed #d6e2f2;
          border-radius:14px;

          padding:24px;

          color:#667085;

          text-align:center;
          font-weight:700;
          font-size:12px;
        }

      </style>
    `;


    body
      .querySelectorAll(
        "[data-activity-filter]"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              renderTimeline(
                button.dataset
                  .activityFilter ||
                "all"
              );

            }
          );

        }
      );
  }


  /* =========================================================
     RENDER ONE EVENT
     ========================================================= */

  function renderEvent(event) {
    const meta =
      activityMeta(
        event.activity_type
      );


    const description =
      clean(
        event.description
      ) ||
      "No description available.";


    const hasStatus =
      clean(
        event.old_status
      ) ||
      clean(
        event.new_status
      );


    const dateText =
      event.historical
        ? "Historical record"
        : formatDateTime(
            event.created_at
          );


    return `
      <article class="activity-card">

        <div
          class="
            activity-icon
            ${escapeHtml(
              meta.tone
            )}
          "
        >
          ${escapeHtml(
            meta.icon
          )}
        </div>


        <div>

          <div class="activity-card-head">

            <div class="activity-title">
              ${escapeHtml(
                meta.title
              )}
            </div>

            <div
              class="
                activity-date
                ${
                  event.historical
                    ? "historical"
                    : ""
                }
              "
            >
              ${escapeHtml(
                dateText
              )}
            </div>

          </div>


          <div class="activity-description">
            ${escapeHtml(
              description
            )}
          </div>


          ${
            hasStatus
              ? `
                  <div class="activity-status-change">

                    <span class="activity-pill">
                      ${escapeHtml(
                        niceStatus(
                          event.old_status
                        )
                      )}
                    </span>

                    <span>
                      →
                    </span>

                    <span class="activity-pill">
                      ${escapeHtml(
                        niceStatus(
                          event.new_status
                        )
                      )}
                    </span>

                  </div>
                `
              : ""
          }


          ${
            event.created_by
              ? `
                  <div class="activity-user">
                    Recorded by:
                    ${escapeHtml(
                      event.created_by
                    )}
                  </div>
                `
              : ""
          }

        </div>

      </article>
    `;
  }


  /* =========================================================
     ERROR UI
     ========================================================= */

  function renderError(error) {
    const body =
      byId(
        "genericActionBody"
      );

    if (!body) {
      return;
    }

    body.innerHTML = `
      <section class="occ-modal-section">

        <h3>
          Order Lifecycle
        </h3>

        <p
          style="
            color:#b42318;
            margin:0;
          "
        >
          ${escapeHtml(
            error.message ||
            "Could not load order lifecycle."
          )}
        </p>

      </section>
    `;
  }


  /* =========================================================
     PUBLIC API
     ========================================================= */

window.ActivityViewTool = {
  open,
  version: ACTIVITY_VIEW_VERSION
};

})();