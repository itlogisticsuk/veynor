
/* ============================================================
   VEYNOR PICKING LIST UI
   File: /js/picking-list-ui.js
   Version: 1.0.0

   PART 1 OF 5

   Central Picking List Generator popup.

   Supported picking methods:
   - By Order
   - By Warehouse Location
   - By Product / SKU
   - By Warehouse
   - By Order Group

   Output:
   - Download PDF
   - Print PDF

   Upcoming:
   - Send to Scanner
   - Assign to Warehouse Employee
   - Digital Picking Confirmation

   All five parts belong in ONE JavaScript file.
   ============================================================ */

(function () {
  "use strict";

  // ==========================================================
  // 1. MODULE CONFIGURATION
  // ==========================================================

  const UI_CONFIG = Object.freeze({
    version: "1.0.0",

    modalId: "veynorPickingListModal",

    styleId: "veynorPickingListStyles",

    title: "Picking List Generator",

    subtitle: "Warehouse Operations",

    defaultMethod: "by_location",

    defaultOutput: "pdf",

    methods: Object.freeze([
      {
        value: "by_order",
        label: "By Order",
        description:
          "Generate picking lists separately for each order.",
        icon: "📦"
      },
      {
        value: "by_location",
        label: "By Warehouse Location",
        description:
          "Combine orders and pick products by warehouse location.",
        icon: "📍"
      },
      {
        value: "by_product",
        label: "By Product / SKU",
        description:
          "Group matching products across selected orders.",
        icon: "▦"
      },
      {
        value: "by_warehouse",
        label: "By Warehouse",
        description:
          "Create separate picking groups for each warehouse.",
        icon: "🏬"
      },
      {
        value: "by_order_group",
        label: "By Order Group",
        description:
          "Group picking lines by product owner.",
        icon: "☷"
      }
    ]),

    sortOptions: Object.freeze([
      {
        value: "location",
        label: "Warehouse → Location → SKU"
      },
      {
        value: "sku",
        label: "Product SKU (A–Z)"
      },
      {
        value: "order",
        label: "Order Number"
      }
    ]),

    groupOptions: Object.freeze([
      {
        value: "warehouse",
        label: "Warehouse"
      },
      {
        value: "owner",
        label: "Product Owner"
      },
      {
        value: "none",
        label: "No Additional Grouping"
      }
    ])
  });


  // ==========================================================
  // 2. MODULE STATE
  // ==========================================================

  const state = {
    isOpen: false,

    isGenerating: false,

    orderIds: [],

    sourceType: "manual",

    sourceId: null,

    sourceLabel: "",

    options: null,

    lastResult: null
  };


  // ==========================================================
  // 3. DEFAULT OPTIONS
  // ==========================================================

  function getDefaultOptions() {
    const generator =
      window.VeynorPickingListGenerator;

    const defaults =
      generator?.defaults || {};

    return {
      pickingMethod:
        defaults.pickingMethod ||
        UI_CONFIG.defaultMethod,

      sortMethod:
        defaults.sortMethod ||
        "location",

      groupBy:
        defaults.groupBy ||
        "warehouse",

      detailLevel:
        defaults.detailLevel ||
        "full",

      outputMode:
        defaults.outputMode ||
        UI_CONFIG.defaultOutput,

      includeCheckboxes:
        defaults.includeCheckboxes !== false,

      includeMissing:
        defaults.includeMissing !== false,

      includeSummary:
        defaults.includeSummary !== false,

      separatePages:
        defaults.separatePages === true,

      includeBarcodes:
        defaults.includeBarcodes === true
    };
  }


  // ==========================================================
  // 4. BASIC HELPERS
  // ==========================================================

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function unique(values) {
    return [
      ...new Set(
        (values || []).filter(Boolean)
      )
    ];
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function getModal() {
    return byId(
      UI_CONFIG.modalId
    );
  }

  function getGenerator() {
    const generator =
      window.VeynorPickingListGenerator;

    if (!generator?.generate) {
      throw new Error(
        "Picking List Generator is not loaded."
      );
    }

    return generator;
  }


  // ==========================================================
  // 5. ORDER VALIDATION
  // ==========================================================

  function normalizeOrderIds(orderIds) {
    if (!Array.isArray(orderIds)) {
      throw new Error(
        "Order IDs must be an array."
      );
    }

    const ids = unique(
      orderIds.map(clean)
    );

    if (!ids.length) {
      throw new Error(
        "No orders selected for picking."
      );
    }

    return ids;
  }


  // ==========================================================
  // 6. MODAL HEADER
  // ==========================================================

  function renderModalHeader() {
    return `
      <div class="vpl-header">

        <div class="vpl-header-main">

          <div class="vpl-header-icon">
            ▤
          </div>

          <div class="vpl-header-text">

            <div class="vpl-header-eyebrow">
              VEYNOR · WAREHOUSE OPERATIONS
            </div>

            <h2 class="vpl-title">
              Picking List Generator
            </h2>

            <p class="vpl-subtitle">
              Configure, generate and print picking lists.
            </p>

          </div>

        </div>

        <button
          type="button"
          class="vpl-close"
          data-vpl-action="close"
          aria-label="Close Picking List Generator"
        >
          &times;
        </button>

      </div>
    `;
  }


  // ==========================================================
  // 7. SOURCE SUMMARY
  // ==========================================================

  function renderSourceSummary() {
    const orderCount =
      state.orderIds.length;

    const sourceLabel =
      state.sourceLabel ||
      "Selected Orders";

    return `
      <div class="vpl-source-summary">

        <div class="vpl-source-icon">
          🚚
        </div>

        <div class="vpl-source-details">

          <strong>
            ${escapeHtml(sourceLabel)}
          </strong>

          <span>
            ${orderCount} order${orderCount === 1 ? "" : "s"}
            selected for picking
          </span>

        </div>

        <div class="vpl-source-count">
          ${orderCount}
        </div>

      </div>
    `;
  }


  // ==========================================================
  // 8. SECTION HEADER
  // ==========================================================

  function renderSectionHeader(
    number,
    title,
    description = ""
  ) {
    return `
      <div class="vpl-section-heading">

        <div class="vpl-section-number">
          ${number}
        </div>

        <div class="vpl-section-heading-text">

          <h3>
            ${escapeHtml(title)}
          </h3>

          ${
            description
              ? `
                <p>
                  ${escapeHtml(description)}
                </p>
              `
              : ""
          }

        </div>

      </div>
    `;
  }


  // ==========================================================
  // 9. PICKING METHOD OPTIONS
  // ==========================================================

  function renderPickingMethods() {
    const selected =
      state.options.pickingMethod;

    return `
      <section class="vpl-section">

        ${renderSectionHeader(
          1,
          "Picking Method",
          "Choose how the selected orders should be picked."
        )}

        <div class="vpl-method-grid">

          ${UI_CONFIG.methods.map(method => `
            <label
              class="vpl-method-card ${
                selected === method.value
                  ? "selected"
                  : ""
              }"
            >

              <input
                type="radio"
                name="vplPickingMethod"
                value="${escapeHtml(method.value)}"
                ${
                  selected === method.value
                    ? "checked"
                    : ""
                }
              >

              <span class="vpl-method-icon">
                ${method.icon}
              </span>

              <span class="vpl-method-content">

                <strong>
                  ${escapeHtml(method.label)}
                </strong>

                <small>
                  ${escapeHtml(method.description)}
                </small>

              </span>

              <span class="vpl-method-indicator"></span>

            </label>
          `).join("")}

        </div>

      </section>
    `;
  }


  // ==========================================================
  // 10. MODAL BODY PLACEHOLDER
  // ==========================================================

  function renderModalBody() {
    return `
      <div class="vpl-body">

        ${renderSourceSummary()}

        ${renderPickingMethods()}

        <!--
          PART 2:
          Grouping, sorting, document options
        -->

        <div id="vplAdditionalOptions"></div>

      </div>
    `;
  }


  // ==========================================================
  // 11. MODAL FOOTER PLACEHOLDER
  // ==========================================================

  function renderModalFooter() {
    return `
      <div class="vpl-footer">

        <div class="vpl-footer-status">
          <span class="vpl-status-dot"></span>
          Ready to generate
        </div>

        <div class="vpl-footer-actions">

          <button
            type="button"
            class="vpl-btn vpl-btn-secondary"
            data-vpl-action="close"
          >
            Cancel
          </button>

          <button
            type="button"
            class="vpl-btn vpl-btn-primary"
            data-vpl-action="generate"
          >
            Generate Picking List
          </button>

        </div>

      </div>
    `;
  }


  // ==========================================================
  // 12. COMPLETE MODAL STRUCTURE
  // ==========================================================

  function renderModal() {
    return `
      <div
        id="${UI_CONFIG.modalId}"
        class="vpl-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Picking List Generator"
      >

        <div class="vpl-modal">

          ${renderModalHeader()}

          ${renderModalBody()}

          ${renderModalFooter()}

        </div>

      </div>
    `;
  }


  // ==========================================================
  // END OF PART 1 OF 5
  //
  // PART 2:
  // - Grouping and sorting controls
  // - Document details
  // - PDF and print selection
  // - Scanner / employee upcoming features
  //
  // Paste PART 2 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST UI
  // PART 2 OF 5
  // OPTIONS, OUTPUT & FUTURE ASSIGNMENTS
  // ==========================================================


  // ==========================================================
  // 13. SELECT FIELD HELPER
  // ==========================================================

  function renderSelectField({
    id,
    label,
    value,
    options = [],
    description = ""
  }) {
    return `
      <div class="vpl-field">

        <label
          class="vpl-field-label"
          for="${escapeHtml(id)}"
        >
          ${escapeHtml(label)}
        </label>

        <select
          id="${escapeHtml(id)}"
          class="vpl-select"
        >
          ${options.map(option => `
            <option
              value="${escapeHtml(option.value)}"
              ${
                option.value === value
                  ? "selected"
                  : ""
              }
            >
              ${escapeHtml(option.label)}
            </option>
          `).join("")}
        </select>

        ${
          description
            ? `
              <div class="vpl-field-description">
                ${escapeHtml(description)}
              </div>
            `
            : ""
        }

      </div>
    `;
  }


  // ==========================================================
  // 14. CHECKBOX FIELD HELPER
  // ==========================================================

  function renderCheckboxField({
    id,
    label,
    description = "",
    checked = false
  }) {
    return `
      <label
        class="vpl-checkbox-row"
        for="${escapeHtml(id)}"
      >

        <input
          id="${escapeHtml(id)}"
          type="checkbox"
          class="vpl-checkbox"
          ${checked ? "checked" : ""}
        >

        <span class="vpl-checkbox-content">

          <strong>
            ${escapeHtml(label)}
          </strong>

          ${
            description
              ? `
                <small>
                  ${escapeHtml(description)}
                </small>
              `
              : ""
          }

        </span>

      </label>
    `;
  }


  // ==========================================================
  // 15. GROUPING & SORTING
  // ==========================================================

  function renderGroupingOptions() {
    const options = state.options;

    return `
      <section class="vpl-section">

        ${renderSectionHeader(
          2,
          "Grouping & Sorting",
          "Control how products and warehouse locations are organised."
        )}

        <div class="vpl-fields-grid">

          ${renderSelectField({
            id: "vplGroupBy",
            label: "Group Results By",
            value: options.groupBy,
            options: UI_CONFIG.groupOptions,
            description:
              "Choose the main grouping for the picking document."
          })}

          ${renderSelectField({
            id: "vplSortMethod",
            label: "Sort Within Groups",
            value: options.sortMethod,
            options: UI_CONFIG.sortOptions,
            description:
              "Warehouse location sorting is recommended."
          })}

        </div>

        <div class="vpl-info-note">

          <span class="vpl-info-note-icon">
            ⓘ
          </span>

          <span>
            Picking lists use existing FIFO allocations.
            Sorting only changes the warehouse picking
            sequence, never the allocated stock.
          </span>

        </div>

      </section>
    `;
  }


  // ==========================================================
  // 16. DETAIL LEVEL
  // ==========================================================

  function renderDetailLevel() {
    const selected =
      state.options.detailLevel;

    return `
      <div class="vpl-option-group">

        <div class="vpl-option-label">
          Document Detail Level
        </div>

        <div class="vpl-choice-grid">

          <label class="vpl-choice-card ${
            selected === "full"
              ? "selected"
              : ""
          }">

            <input
              type="radio"
              name="vplDetailLevel"
              value="full"
              ${selected === "full" ? "checked" : ""}
            >

            <span class="vpl-choice-icon">
              ▤
            </span>

            <span class="vpl-choice-text">

              <strong>
                Full Details
              </strong>

              <small>
                SKU, description, order,
                package and location.
              </small>

            </span>

          </label>

          <label class="vpl-choice-card ${
            selected === "compact"
              ? "selected"
              : ""
          }">

            <input
              type="radio"
              name="vplDetailLevel"
              value="compact"
              ${selected === "compact" ? "checked" : ""}
            >

            <span class="vpl-choice-icon">
              ☷
            </span>

            <span class="vpl-choice-text">

              <strong>
                Compact
              </strong>

              <small>
                Location, SKU, quantity
                and order reference.
              </small>

            </span>

          </label>

        </div>

      </div>
    `;
  }


  // ==========================================================
  // 17. DOCUMENT CHECKBOX OPTIONS
  // ==========================================================

  function renderDocumentCheckboxes() {
    const options = state.options;

    return `
      <div class="vpl-checkbox-grid">

        ${renderCheckboxField({
          id: "vplIncludeCheckboxes",
          label: "Picking Checkboxes",
          description:
            "Include boxes for manual picking confirmation.",
          checked: options.includeCheckboxes
        })}

        ${renderCheckboxField({
          id: "vplIncludeMissing",
          label: "Show Unallocated Items",
          description:
            "Show products without complete stock allocation.",
          checked: options.includeMissing
        })}

        ${renderCheckboxField({
          id: "vplIncludeSummary",
          label: "Picking Summary",
          description:
            "Include total orders, packages and locations.",
          checked: options.includeSummary
        })}

        ${renderCheckboxField({
          id: "vplSeparatePages",
          label: "Separate Page Per Group",
          description:
            "Start each picking group on a new PDF page.",
          checked: options.separatePages
        })}

      </div>
    `;
  }


  // ==========================================================
  // 18. DOCUMENT DETAILS SECTION
  // ==========================================================

  function renderDocumentOptions() {
    return `
      <section class="vpl-section">

        ${renderSectionHeader(
          3,
          "Document Details",
          "Choose how much information appears on the picking list."
        )}

        ${renderDetailLevel()}

        ${renderDocumentCheckboxes()}

      </section>
    `;
  }


  // ==========================================================
  // 19. OUTPUT METHOD
  // ==========================================================

  function renderOutputMethods() {
    const selected =
      state.options.outputMode;

    return `
      <div class="vpl-output-grid">

        <label class="vpl-output-card ${
          selected === "pdf"
            ? "selected"
            : ""
        }">

          <input
            type="radio"
            name="vplOutputMode"
            value="pdf"
            ${selected === "pdf" ? "checked" : ""}
          >

          <span class="vpl-output-icon">
            ↓
          </span>

          <span class="vpl-output-content">

            <strong>
              Download PDF
            </strong>

            <small>
              Generate and save a printable picking list.
            </small>

            <span class="vpl-feature-ready">
              Available Now
            </span>

          </span>

        </label>


        <label class="vpl-output-card ${
          selected === "print"
            ? "selected"
            : ""
        }">

          <input
            type="radio"
            name="vplOutputMode"
            value="print"
            ${selected === "print" ? "checked" : ""}
          >

          <span class="vpl-output-icon">
            ▣
          </span>

          <span class="vpl-output-content">

            <strong>
              Print Picking List
            </strong>

            <small>
              Open the picking document for printing.
            </small>

            <span class="vpl-feature-ready">
              Available Now
            </span>

          </span>

        </label>

      </div>
    `;
  }


  // ==========================================================
  // 20. UPCOMING FEATURE BADGE
  // ==========================================================

  function renderUpcomingBadge() {
    return `
      <span class="vpl-upcoming-badge">
        <span class="vpl-upcoming-star">★</span>
        Coming Soon
      </span>
    `;
  }


  // ==========================================================
  // 21. SCANNER ASSIGNMENT
  // ==========================================================

  function renderScannerAssignment() {
    return `
      <div class="vpl-future-card">

        <div class="vpl-future-card-header">

          <div class="vpl-future-icon">
            ▥
          </div>

          <div class="vpl-future-title">

            <div class="vpl-future-title-row">

              <strong>
                Send to Scanner
              </strong>

              ${renderUpcomingBadge()}

            </div>

            <p>
              Send picking tasks directly to a registered
              warehouse scanner for digital confirmation.
            </p>

          </div>

        </div>

        <div class="vpl-field">

          <label
            class="vpl-field-label"
            for="vplScannerSelect"
          >
            Select Scanner
          </label>

          <select
            id="vplScannerSelect"
            class="vpl-select"
            disabled
          >
            <option value="">
              No scanners configured
            </option>
          </select>

        </div>

        <div class="vpl-future-description">
          Scanners will be managed in
          Settings → Warehouse Devices.
        </div>

      </div>
    `;
  }


  // ==========================================================
  // 22. EMPLOYEE ASSIGNMENT
  // ==========================================================

  function renderEmployeeAssignment() {
    return `
      <div class="vpl-future-card">

        <div class="vpl-future-card-header">

          <div class="vpl-future-icon">
            ♙
          </div>

          <div class="vpl-future-title">

            <div class="vpl-future-title-row">

              <strong>
                Assign to Warehouse Employee
              </strong>

              ${renderUpcomingBadge()}

            </div>

            <p>
              Assign picking tasks to a specific warehouse
              employee for scanning and confirmation.
            </p>

          </div>

        </div>

        <div class="vpl-field">

          <label
            class="vpl-field-label"
            for="vplEmployeeSelect"
          >
            Select Warehouse Employee
          </label>

          <select
            id="vplEmployeeSelect"
            class="vpl-select"
            disabled
          >
            <option value="">
              No warehouse employees configured
            </option>
          </select>

        </div>

        <div class="vpl-future-description">
          Warehouse employees will be managed in
          Settings → Users & Permissions.
        </div>

      </div>
    `;
  }


  // ==========================================================
  // 23. OUTPUT & ASSIGNMENT SECTION
  // ==========================================================

  function renderOutputSection() {
    return `
      <section class="vpl-section">

        ${renderSectionHeader(
          4,
          "Output & Assignment",
          "Choose how the picking list should be processed."
        )}

        ${renderOutputMethods()}

        <div class="vpl-future-heading">

          <span>
            Digital Picking
          </span>

          ${renderUpcomingBadge()}

        </div>

        <div class="vpl-future-grid">

          ${renderScannerAssignment()}

          ${renderEmployeeAssignment()}

        </div>

        <div class="vpl-info-note">

          <span class="vpl-info-note-icon">
            ★
          </span>

          <span>
            Digital picking and scanner assignments
            are upcoming features. The current
            generator supports PDF download and
            printing only.
          </span>

        </div>

      </section>
    `;
  }


  // ==========================================================
  // 24. RENDER ALL ADDITIONAL OPTIONS
  // ==========================================================

  function renderAdditionalOptions() {
    return `
      ${renderGroupingOptions()}

      ${renderDocumentOptions()}

      ${renderOutputSection()}
    `;
  }


  // ==========================================================
  // 25. MOUNT ADDITIONAL OPTIONS
  // ==========================================================

  function mountAdditionalOptions() {
    const container = byId(
      "vplAdditionalOptions"
    );

    if (!container) {
      return;
    }

    container.innerHTML =
      renderAdditionalOptions();
  }


  // ==========================================================
  // END OF PART 2 OF 5
  //
  // PART 3:
  // - Complete modal styling
  // - Responsive layout
  // - Cards, buttons and badges
  // - Scroll behaviour
  //
  // Paste PART 3 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST UI
  // PART 3 OF 5
  // COMPLETE MODAL STYLING
  // ==========================================================


  // ==========================================================
  // 26. CSS STYLES
  // ==========================================================

  const PICKING_UI_CSS = `

    /* ========================================================
       VEYNOR PICKING LIST GENERATOR
       MODAL DESIGN
       ======================================================== */

    .vpl-overlay,
    .vpl-overlay * {
      box-sizing: border-box;
    }

    .vpl-overlay {
      position: fixed;
      inset: 0;
      z-index: 99990;

      display: flex;
      align-items: center;
      justify-content: center;

      padding: 24px;

      background: rgba(6, 19, 43, 0.68);
      backdrop-filter: blur(5px);
      -webkit-backdrop-filter: blur(5px);

      animation: vplFadeIn 0.18s ease-out;
    }

    .vpl-overlay[hidden] {
      display: none !important;
    }

    .vpl-modal {
      width: 100%;
      max-width: 900px;
      max-height: min(92vh, 950px);

      display: flex;
      flex-direction: column;

      overflow: hidden;

      background: #ffffff;
      border: 1px solid #dbe5f2;
      border-radius: 18px;

      box-shadow:
        0 30px 90px rgba(4, 18, 43, 0.35);

      animation: vplSlideIn 0.2s ease-out;
    }


    /* ========================================================
       HEADER
       ======================================================== */

    .vpl-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;

      padding: 22px 26px;

      background:
        linear-gradient(
          120deg,
          #071b43 0%,
          #0b3268 65%,
          #1055a4 100%
        );

      color: #ffffff;

      flex-shrink: 0;
    }

    .vpl-header-main {
      display: flex;
      align-items: center;
      gap: 16px;

      min-width: 0;
    }

    .vpl-header-icon {
      width: 50px;
      height: 50px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      border-radius: 14px;

      background: #1267ff;
      border: 1px solid rgba(255,255,255,0.18);

      color: #ffffff;
      font-size: 26px;
      font-weight: 900;
    }

    .vpl-header-text {
      min-width: 0;
    }

    .vpl-header-eyebrow {
      margin-bottom: 5px;

      color: #9dc8ff;

      font-size: 10px;
      font-weight: 900;

      letter-spacing: 1.4px;
      text-transform: uppercase;
    }

    .vpl-title {
      margin: 0;

      color: #ffffff;

      font-size: 23px;
      font-weight: 900;
      line-height: 1.2;
    }

    .vpl-subtitle {
      margin: 6px 0 0;

      color: #c8d9f1;

      font-size: 12px;
      line-height: 1.5;
    }

    .vpl-close {
      width: 34px;
      height: 34px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      padding: 0;

      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;

      color: #ffffff;

      font-size: 24px;
      line-height: 1;

      cursor: pointer;
      transition: 0.15s ease;
    }

    .vpl-close:hover {
      background: rgba(255,255,255,0.22);
    }


    /* ========================================================
       SCROLLABLE BODY
       ======================================================== */

    .vpl-body {
      flex: 1;
      min-height: 0;

      overflow-y: auto;
      overscroll-behavior: contain;

      padding: 22px 26px 28px;

      background: #f7f9fd;

      scrollbar-width: thin;
      scrollbar-color: #b9c9de transparent;
    }

    .vpl-body::-webkit-scrollbar {
      width: 8px;
    }

    .vpl-body::-webkit-scrollbar-thumb {
      background: #bdcce0;
      border-radius: 10px;
    }


    /* ========================================================
       SOURCE SUMMARY
       ======================================================== */

    .vpl-source-summary {
      display: flex;
      align-items: center;
      gap: 14px;

      padding: 15px 17px;
      margin-bottom: 20px;

      background: #ffffff;

      border: 1px solid #dce6f4;
      border-radius: 13px;
    }

    .vpl-source-icon {
      width: 42px;
      height: 42px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      background: #eaf2ff;
      border-radius: 11px;

      font-size: 20px;
    }

    .vpl-source-details {
      flex: 1;
      min-width: 0;

      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .vpl-source-details strong {
      color: #10274d;
      font-size: 13px;
      font-weight: 900;
    }

    .vpl-source-details span {
      color: #6c7e99;
      font-size: 11px;
    }

    .vpl-source-count {
      min-width: 40px;

      padding: 8px 12px;

      background: #e9f1ff;
      border: 1px solid #c8dcff;
      border-radius: 9px;

      color: #1267ff;

      text-align: center;
      font-size: 15px;
      font-weight: 900;
    }


    /* ========================================================
       SECTIONS
       ======================================================== */

    .vpl-section {
      margin-bottom: 18px;
      padding: 20px;

      background: #ffffff;

      border: 1px solid #dce6f4;
      border-radius: 13px;
    }

    .vpl-section-heading {
      display: flex;
      align-items: flex-start;
      gap: 11px;

      margin-bottom: 17px;
    }

    .vpl-section-number {
      width: 26px;
      height: 26px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      background: #1267ff;
      border-radius: 8px;

      color: #ffffff;

      font-size: 12px;
      font-weight: 900;
    }

    .vpl-section-heading-text h3 {
      margin: 0;

      color: #10274d;

      font-size: 14px;
      font-weight: 900;
    }

    .vpl-section-heading-text p {
      margin: 4px 0 0;

      color: #71819a;

      font-size: 11px;
      line-height: 1.5;
    }


    /* ========================================================
       PICKING METHOD CARDS
       ======================================================== */

    .vpl-method-grid {
      display: grid;
      grid-template-columns:
        repeat(2, minmax(0, 1fr));

      gap: 10px;
    }

    .vpl-method-card {
      position: relative;

      display: flex;
      align-items: center;
      gap: 12px;

      min-height: 78px;
      padding: 14px;

      background: #ffffff;

      border: 1px solid #dce5f2;
      border-radius: 11px;

      cursor: pointer;
      transition: 0.15s ease;
    }

    .vpl-method-card:hover {
      border-color: #92b9ff;
      background: #f8fbff;
    }

    .vpl-method-card.selected {
      border-color: #1267ff;
      background: #edf4ff;

      box-shadow:
        0 0 0 1px rgba(18,103,255,0.1);
    }

    .vpl-method-card input {
      position: absolute;
      opacity: 0;

      width: 1px;
      height: 1px;
    }

    .vpl-method-icon {
      width: 37px;
      height: 37px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      background: #edf3fb;
      border-radius: 9px;

      color: #1267ff;
      font-size: 19px;
    }

    .vpl-method-card.selected
    .vpl-method-icon {
      background: #dceaff;
    }

    .vpl-method-content {
      flex: 1;
      min-width: 0;

      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .vpl-method-content strong {
      color: #10274d;

      font-size: 12px;
      font-weight: 900;
    }

    .vpl-method-content small {
      color: #71819a;

      font-size: 10.5px;
      line-height: 1.45;
    }

    .vpl-method-indicator {
      width: 17px;
      height: 17px;

      flex-shrink: 0;

      border: 2px solid #c5d2e4;
      border-radius: 50%;
    }

    .vpl-method-card.selected
    .vpl-method-indicator {
      border: 5px solid #1267ff;
      background: #ffffff;
    }


    /* ========================================================
       FIELDS AND SELECTS
       ======================================================== */

    .vpl-fields-grid {
      display: grid;
      grid-template-columns:
        repeat(2, minmax(0, 1fr));

      gap: 14px;
    }

    .vpl-field {
      display: flex;
      flex-direction: column;
      gap: 7px;

      min-width: 0;
    }

    .vpl-field-label {
      color: #344969;

      font-size: 11px;
      font-weight: 900;
    }

    .vpl-select {
      width: 100%;
      min-height: 39px;

      padding: 9px 12px;

      background: #ffffff;
      border: 1px solid #d3dfef;
      border-radius: 9px;

      color: #152d51;

      font-size: 11px;
      font-weight: 600;

      outline: none;
      transition: 0.15s ease;
    }

    .vpl-select:focus {
      border-color: #1267ff;

      box-shadow:
        0 0 0 3px rgba(18,103,255,0.1);
    }

    .vpl-select:disabled {
      background: #f2f5fa;
      color: #9aa8ba;
      cursor: not-allowed;
    }

    .vpl-field-description {
      color: #8593a7;

      font-size: 10px;
      line-height: 1.4;
    }


    /* ========================================================
       INFORMATION NOTES
       ======================================================== */

    .vpl-info-note {
      display: flex;
      align-items: flex-start;
      gap: 10px;

      margin-top: 14px;
      padding: 12px 14px;

      background: #f0f6ff;
      border: 1px solid #d5e5ff;
      border-radius: 9px;

      color: #43648d;

      font-size: 10.5px;
      line-height: 1.55;
    }

    .vpl-info-note-icon {
      color: #1267ff;

      font-size: 15px;
      font-weight: 900;
    }


    /* ========================================================
       DETAIL LEVEL CARDS
       ======================================================== */

    .vpl-option-group {
      margin-bottom: 17px;
    }

    .vpl-option-label {
      margin-bottom: 10px;

      color: #344969;

      font-size: 11px;
      font-weight: 900;
    }

    .vpl-choice-grid {
      display: grid;
      grid-template-columns:
        repeat(2, minmax(0, 1fr));

      gap: 10px;
    }

    .vpl-choice-card {
      position: relative;

      display: flex;
      align-items: center;
      gap: 12px;

      min-height: 76px;
      padding: 14px;

      background: #ffffff;

      border: 1px solid #dce5f2;
      border-radius: 11px;

      cursor: pointer;
      transition: 0.15s ease;
    }

    .vpl-choice-card:hover {
      border-color: #92b9ff;
    }

    .vpl-choice-card.selected {
      background: #edf4ff;
      border-color: #1267ff;
    }

    .vpl-choice-card input {
      position: absolute;
      opacity: 0;

      width: 1px;
      height: 1px;
    }

    .vpl-choice-icon {
      width: 36px;
      height: 36px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      background: #edf3fb;
      border-radius: 9px;

      color: #1267ff;
      font-size: 20px;
    }

    .vpl-choice-text {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .vpl-choice-text strong {
      color: #10274d;

      font-size: 12px;
      font-weight: 900;
    }

    .vpl-choice-text small {
      color: #71819a;

      font-size: 10.5px;
      line-height: 1.4;
    }


    /* ========================================================
       DOCUMENT CHECKBOXES
       ======================================================== */

    .vpl-checkbox-grid {
      display: grid;
      grid-template-columns:
        repeat(2, minmax(0, 1fr));

      gap: 10px;
    }

    .vpl-checkbox-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;

      padding: 12px;

      background: #f9fbfe;

      border: 1px solid #e3eaf4;
      border-radius: 9px;

      cursor: pointer;
    }

    .vpl-checkbox-row:hover {
      background: #f2f7ff;
    }

    .vpl-checkbox {
      width: 16px;
      height: 16px;

      margin: 2px 0 0;

      flex-shrink: 0;

      accent-color: #1267ff;
      cursor: pointer;
    }

    .vpl-checkbox-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .vpl-checkbox-content strong {
      color: #263d60;

      font-size: 11px;
      font-weight: 800;
    }

    .vpl-checkbox-content small {
      color: #7b8ba2;

      font-size: 10px;
      line-height: 1.4;
    }


    /* ========================================================
       OUTPUT CARDS
       ======================================================== */

    .vpl-output-grid {
      display: grid;
      grid-template-columns:
        repeat(2, minmax(0, 1fr));

      gap: 12px;
    }

    .vpl-output-card {
      position: relative;

      display: flex;
      align-items: flex-start;
      gap: 13px;

      min-height: 110px;
      padding: 16px;

      background: #ffffff;

      border: 1px solid #dce5f2;
      border-radius: 11px;

      cursor: pointer;
      transition: 0.15s ease;
    }

    .vpl-output-card:hover {
      border-color: #92b9ff;
    }

    .vpl-output-card.selected {
      background: #edf4ff;
      border-color: #1267ff;
    }

    .vpl-output-card input {
      position: absolute;
      opacity: 0;

      width: 1px;
      height: 1px;
    }

    .vpl-output-icon {
      width: 42px;
      height: 42px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      background: #e8f1ff;
      border-radius: 11px;

      color: #1267ff;
      font-size: 23px;
      font-weight: 900;
    }

    .vpl-output-content {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 7px;
    }

    
    /* ========================================================
       OUTPUT CONTENT
       ======================================================== */

    .vpl-output-content strong {
      color: #10274d;
      font-size: 12px;
      font-weight: 900;
    }

    .vpl-output-content small {
      color: #71819a;
      font-size: 10.5px;
      line-height: 1.5;
    }

    .vpl-feature-ready {
      display: inline-flex;
      align-items: center;

      padding: 4px 8px;

      background: #e7f7ef;
      border: 1px solid #bce9d1;
      border-radius: 6px;

      color: #168454;

      font-size: 9px;
      font-weight: 900;
    }


    /* ========================================================
       FUTURE DIGITAL PICKING
       ======================================================== */

    .vpl-future-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      margin: 24px 0 13px;

      color: #10274d;
      font-size: 13px;
      font-weight: 900;
    }

    .vpl-upcoming-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;

      padding: 5px 9px;

      background: #fff5df;
      border: 1px solid #f5d899;
      border-radius: 7px;

      color: #9b6800;

      font-size: 9px;
      font-weight: 900;
      white-space: nowrap;
    }

    .vpl-upcoming-star {
      color: #d99400;
      font-size: 12px;
    }

    .vpl-future-grid {
      display: grid;
      grid-template-columns:
        repeat(2, minmax(0, 1fr));

      gap: 12px;
    }

    .vpl-future-card {
      display: flex;
      flex-direction: column;
      gap: 15px;

      padding: 17px;

      background: #f9fbfe;
      border: 1px dashed #c9d5e6;
      border-radius: 11px;
    }

    .vpl-future-card-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .vpl-future-icon {
      width: 40px;
      height: 40px;

      display: flex;
      align-items: center;
      justify-content: center;

      flex-shrink: 0;

      background: #edf1f7;
      border-radius: 10px;

      color: #7386a3;
      font-size: 21px;
    }

    .vpl-future-title {
      flex: 1;
      min-width: 0;
    }

    .vpl-future-title-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
    }

    .vpl-future-title-row strong {
      color: #344969;
      font-size: 12px;
      font-weight: 900;
    }

    .vpl-future-title p {
      margin: 7px 0 0;

      color: #8190a6;
      font-size: 10.5px;
      line-height: 1.55;
    }

    .vpl-future-description {
      color: #8a99ad;
      font-size: 10px;
      line-height: 1.5;
    }


    /* ========================================================
       MODAL FOOTER
       ======================================================== */

    .vpl-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;

      padding: 16px 26px;

      background: #ffffff;
      border-top: 1px solid #e0e8f3;

      flex-shrink: 0;
    }

    .vpl-footer-status {
      display: flex;
      align-items: center;
      gap: 8px;

      color: #64758f;
      font-size: 11px;
      font-weight: 700;
    }

    .vpl-status-dot {
      width: 8px;
      height: 8px;

      background: #20b67a;
      border-radius: 50%;

      flex-shrink: 0;
    }

    .vpl-footer-actions {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .vpl-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;

      min-height: 39px;
      padding: 10px 17px;

      border: 1px solid transparent;
      border-radius: 9px;

      font-family: inherit;
      font-size: 11px;
      font-weight: 900;

      cursor: pointer;
      transition: 0.15s ease;
    }

    .vpl-btn-secondary {
      background: #ffffff;
      border-color: #d5dfed;
      color: #344969;
    }

    .vpl-btn-secondary:hover {
      background: #f2f6fc;
    }

    .vpl-btn-primary {
      background: #1267ff;
      color: #ffffff;

      box-shadow:
        0 4px 12px rgba(18,103,255,0.18);
    }

    .vpl-btn-primary:hover {
      background: #0757e8;
    }

    .vpl-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      box-shadow: none;
    }


    /* ========================================================
       LOADING AND ERROR STATES
       ======================================================== */

    .vpl-overlay.is-generating
    .vpl-method-card,

    .vpl-overlay.is-generating
    .vpl-choice-card,

    .vpl-overlay.is-generating
    .vpl-output-card,

    .vpl-overlay.is-generating
    .vpl-checkbox-row {
      pointer-events: none;
      opacity: 0.7;
    }

    .vpl-overlay.is-generating
    .vpl-status-dot {
      background: #1267ff;
      animation: vplPulse 1s infinite;
    }

    .vpl-message {
      padding: 12px 14px;
      margin-bottom: 14px;

      border-radius: 9px;

      font-size: 11px;
      line-height: 1.5;
      font-weight: 700;
    }

    .vpl-message-error {
      background: #fff0f1;
      border: 1px solid #f5c8cf;
      color: #a92b3e;
    }

    .vpl-message-success {
      background: #eaf8f0;
      border: 1px solid #c2ead4;
      color: #168454;
    }

    .vpl-message-info {
      background: #edf4ff;
      border: 1px solid #cfe0ff;
      color: #245ba8;
    }


    /* ========================================================
       RESPONSIVE DESIGN
       ======================================================== */

    @media (max-width: 760px) {

      .vpl-overlay {
        padding: 10px;
      }

      .vpl-modal {
        max-height: 96vh;
        border-radius: 13px;
      }

      .vpl-header {
        padding: 17px;
      }

      .vpl-header-icon {
        width: 40px;
        height: 40px;
        font-size: 21px;
      }

      .vpl-title {
        font-size: 18px;
      }

      .vpl-body {
        padding: 15px;
      }

      .vpl-section {
        padding: 15px;
      }

      .vpl-method-grid,
      .vpl-fields-grid,
      .vpl-choice-grid,
      .vpl-checkbox-grid,
      .vpl-output-grid,
      .vpl-future-grid {
        grid-template-columns: 1fr;
      }

      .vpl-footer {
        flex-direction: column;
        align-items: stretch;
        padding: 14px;
      }

      .vpl-footer-actions {
        width: 100%;
      }

      .vpl-footer-actions .vpl-btn {
        flex: 1;
      }
    }


    /* ========================================================
       ANIMATIONS
       ======================================================== */

    @keyframes vplFadeIn {
      from {
        opacity: 0;
      }

      to {
        opacity: 1;
      }
    }

    @keyframes vplSlideIn {
      from {
        opacity: 0;
        transform: translateY(12px);
      }

      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes vplPulse {
      0%, 100% {
        opacity: 1;
      }

      50% {
        opacity: 0.35;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .vpl-overlay,
      .vpl-modal,
      .vpl-status-dot {
        animation: none !important;
      }
    }

  `;


  // ==========================================================
  // 27. INSTALL STYLES
  // ==========================================================

  function installStyles() {
    if (byId(UI_CONFIG.styleId)) {
      return;
    }

    const style = document.createElement("style");

    style.id = UI_CONFIG.styleId;
    style.textContent = PICKING_UI_CSS;

    document.head.appendChild(style);
  }


  // ==========================================================
  // END OF PART 3 OF 5
  //
  // PART 4:
  // - Open and close modal
  // - Read form values
  // - Handle user interactions
  // - Validate selections
  // - Generate picking documents
  //
  // Paste PART 4 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST UI
  // PART 4 OF 5
  // MODAL INTERACTIONS & GENERATOR INTEGRATION
  // ==========================================================


  // ==========================================================
  // 28. UI RUNTIME STATE
  // ==========================================================

  let previousFocusedElement = null;
  let previousBodyOverflow = null;
  let modalListenersInstalled = false;


  // ==========================================================
  // 29. UPDATE SELECTED CARDS
  // ==========================================================

  function updateSelectedCards() {
    const modal = getModal();

    if (!modal) return;

    const selectors = [
      ".vpl-method-card",
      ".vpl-choice-card",
      ".vpl-output-card"
    ];

    for (const selector of selectors) {
      modal.querySelectorAll(selector)
        .forEach(card => {
          const input = card.querySelector(
            'input[type="radio"]'
          );

          card.classList.toggle(
            "selected",
            Boolean(input?.checked)
          );
        });
    }
  }


  // ==========================================================
  // 30. READ CURRENT FORM OPTIONS
  // ==========================================================

  function readFormOptions() {
    const modal = getModal();

    if (!modal) {
      throw new Error(
        "Picking List popup is not available."
      );
    }

    const checkedRadio = name => {
      return modal.querySelector(
        `input[name="${name}"]:checked`
      )?.value || "";
    };

    const checkedBox = id => {
      return modal.querySelector(
        `#${id}`
      )?.checked === true;
    };

    const selectedValue = id => {
      return modal.querySelector(
        `#${id}`
      )?.value || "";
    };

    return {
      pickingMethod:
        checkedRadio("vplPickingMethod") ||
        "by_location",

      sortMethod:
        selectedValue("vplSortMethod") ||
        "location",

      groupBy:
        selectedValue("vplGroupBy") ||
        "warehouse",

      detailLevel:
        checkedRadio("vplDetailLevel") ||
        "full",

      outputMode:
        checkedRadio("vplOutputMode") ||
        "pdf",

      includeCheckboxes:
        checkedBox("vplIncludeCheckboxes"),

      includeMissing:
        checkedBox("vplIncludeMissing"),

      includeSummary:
        checkedBox("vplIncludeSummary"),

      separatePages:
        checkedBox("vplSeparatePages"),

      includeBarcodes: false
    };
  }


  // ==========================================================
  // 31. SAVE FORM OPTIONS
  // ==========================================================

  function saveFormOptions() {
    if (!state.isOpen) {
      return state.options;
    }

    const options = readFormOptions();

    const generator = getGenerator();

    state.options =
      generator.normalizeOptions(options);

    return state.options;
  }


  // ==========================================================
  // 32. SET MODAL STATUS
  // ==========================================================

  function setModalStatus(
    message,
    type = "ready"
  ) {
    const modal = getModal();

    if (!modal) return;

    const status = modal.querySelector(
      ".vpl-footer-status"
    );

    if (!status) return;

    const colors = {
      ready: "#20b67a",
      loading: "#1267ff",
      success: "#20b67a",
      error: "#e05263"
    };

    const safeType =
      Object.prototype.hasOwnProperty.call(
        colors,
        type
      )
        ? type
        : "ready";

    status.replaceChildren();

    const dot = document.createElement("span");
    dot.className = "vpl-status-dot";
    dot.style.background = colors[safeType];

    const text = document.createElement("span");
    text.textContent = clean(message);

    status.append(dot, text);
  }


  // ==========================================================
  // 33. DISPLAY MODAL MESSAGE
  // ==========================================================

  function showModalMessage(
    message,
    type = "info"
  ) {
    const modal = getModal();

    if (!modal) return;

    const body = modal.querySelector(
      ".vpl-body"
    );

    if (!body) return;

    modal.querySelectorAll(
      ".vpl-message"
    ).forEach(element => element.remove());

    const allowedTypes = new Set([
      "info",
      "success",
      "error"
    ]);

    const safeType = allowedTypes.has(type)
      ? type
      : "info";

    const box = document.createElement("div");

    box.className =
      `vpl-message vpl-message-${safeType}`;

    box.setAttribute(
      "role",
      safeType === "error"
        ? "alert"
        : "status"
    );

    box.textContent = clean(message);

    body.prepend(box);

    body.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  // ==========================================================
  // 34. GENERATING STATE
  // ==========================================================


function setGeneratingState(isGenerating) {
  const modal = getModal();

  state.isGenerating = Boolean(isGenerating);

  if (!modal) return;

  modal.classList.toggle(
    "is-generating",
    state.isGenerating
  );

  const generateButton = modal.querySelector(
    '[data-vpl-action="generate"]'
  );

  if (generateButton) {
    generateButton.disabled = state.isGenerating;

    generateButton.textContent = state.isGenerating
      ? "Generating Picking List..."
      : "Generate Picking List";
  }

  // Disable or restore all active picking controls.
  // Scanner and employee controls remain disabled.
  const controls = modal.querySelectorAll(
    'input, select'
  );

  controls.forEach(control => {
    const isUpcomingFeature =
      control.id === "vplScannerSelect" ||
      control.id === "vplEmployeeSelect";

    if (isUpcomingFeature) {
      control.disabled = true;
      return;
    }

    control.disabled = state.isGenerating;
  });

  // Prevent closing the modal during generation.
  modal.querySelectorAll(
    '[data-vpl-action="close"]'
  ).forEach(button => {
    button.disabled = state.isGenerating;
  });

  if (state.isGenerating) {
    setModalStatus(
      "Preparing picking document...",
      "loading"
    );
  }
}


  // ==========================================================
  // 35. VALIDATE SELECTED ORDERS
  // ==========================================================

  function validateCurrentSelection() {
    const ids = normalizeOrderIds(
      state.orderIds
    );

    if (!ids.length) {
      throw new Error(
        "No orders selected."
      );
    }

    const generator = getGenerator();

    const maximum =
      generator.config?.maxOrders || 500;

    if (ids.length > maximum) {
      throw new Error(
        `Maximum ${maximum} orders per picking list.`
      );
    }

    return ids;
  }


  // ==========================================================
  // 36. GENERATE FROM POPUP
  // ==========================================================

  async function generateFromModal() {
    if (state.isGenerating) {
      return;
    }

    try {
      const orderIds =
        validateCurrentSelection();

      const options =
        saveFormOptions();

      setGeneratingState(true);

      setModalStatus(
        `Loading allocations for ${orderIds.length} orders...`,
        "loading"
      );

      const generator = getGenerator();

      const result = await generator.generate(
        orderIds,
        options
      );

      state.lastResult = result;

      setModalStatus(
        "Picking list generated successfully.",
        "success"
      );

      const summary =
        result?.summary || {};

      showModalMessage(
        `Picking list generated for ` +
        `${summary.total_orders ?? orderIds.length} orders. ` +
        `${summary.allocated_packages ?? 0} allocated packages, ` +
        `${summary.missing_packages ?? 0} unallocated packages.`,
        "success"
      );

      return result;

    } catch (error) {
      console.error(
        "[Veynor Picking UI] Generation failed:",
        error
      );

      setModalStatus(
        "Picking list generation failed.",
        "error"
      );

      showModalMessage(
        error?.message ||
        "Could not generate picking list.",
        "error"
      );

      return null;

    } finally {
      setGeneratingState(false);
    }
  }


  // ==========================================================
  // 37. OPEN PICKING POPUP
  // ==========================================================

  function openModal(input = {}) {
    if (state.isGenerating) {
      throw new Error(
        "Cannot change picking selection during generation."
      );
    }

    getGenerator();

    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new Error(
        "Invalid picking popup input."
      );
    }

    const orderIds =
      normalizeOrderIds(
        input.orderIds || []
      );

    if (state.isOpen) {
      closeModal();
    }

    previousFocusedElement =
      document.activeElement;

    previousBodyOverflow =
      document.body.style.overflow;

    state.orderIds = orderIds;

    state.sourceType =
      clean(input.sourceType || "manual");

    state.sourceId =
      input.sourceId || null;

    state.sourceLabel =
      clean(
        input.sourceLabel ||
        "Selected Orders"
      );

    state.options = {
      ...getDefaultOptions(),
      ...(input.options || {})
    };

    state.options =
      getGenerator().normalizeOptions(
        state.options
      );

    state.lastResult = null;

    installStyles();

    const oldModal = getModal();

    if (oldModal) {
      oldModal.remove();
    }

    document.body.insertAdjacentHTML(
      "beforeend",
      renderModal()
    );

    mountAdditionalOptions();

    state.isOpen = true;

    document.body.style.overflow =
      "hidden";

    installModalListeners();

    updateSelectedCards();

    setModalStatus(
      `${orderIds.length} orders ready for picking.`,
      "ready"
    );

    getModal()?.querySelector(
      '[data-vpl-action="close"]'
    )?.focus();

    return true;
  }


  // ==========================================================
  // 38. CLOSE PICKING POPUP
  // ==========================================================

  function closeModal() {
    if (state.isGenerating) {
      return false;
    }

    const modal = getModal();

    if (modal) {
      modal.remove();
    }

    state.isOpen = false;

    document.body.style.overflow =
      previousBodyOverflow ?? "";

    if (
      previousFocusedElement &&
      typeof previousFocusedElement.focus ===
        "function" &&
      previousFocusedElement.isConnected
    ) {
      previousFocusedElement.focus();
    }

    previousFocusedElement = null;
    previousBodyOverflow = null;

    return true;
  }


  // ==========================================================
  // 39. HANDLE MODAL CLICKS
  // ==========================================================

  function handleModalClick(event) {
    const modal = getModal();

    if (!modal) return;

    const actionButton =
      event.target.closest(
        "[data-vpl-action]"
      );

    if (actionButton) {
      const action =
        actionButton.dataset.vplAction;

      if (action === "close") {
        closeModal();
        return;
      }

      if (action === "generate") {
        generateFromModal();
        return;
      }
    }

    // Close only when clicking the backdrop.
    if (event.target === modal) {
      closeModal();
    }
  }


  // ==========================================================
  // 40. HANDLE FORM CHANGES
  // ==========================================================

  function handleModalChange(event) {
    if (
      !state.isOpen ||
      state.isGenerating
    ) {
      return;
    }

    const target = event.target;

    if (
      !target ||
      !target.matches(
        "input, select"
      )
    ) {
      return;
    }

    try {
      saveFormOptions();
      updateSelectedCards();

      setModalStatus(
        `${state.orderIds.length} orders ready for picking.`,
        "ready"
      );

    } catch (error) {
      showModalMessage(
        error.message,
        "error"
      );
    }
  }


  // ==========================================================
  // 41. KEYBOARD HANDLING
  // ==========================================================

  function handleModalKeydown(event) {
    if (!state.isOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();

      closeModal();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const modal = getModal();

    if (!modal) return;

    const focusable = [
      ...modal.querySelectorAll(`
        button:not([disabled]),
        input:not([disabled]),
        select:not([disabled]),
        [tabindex]:not([tabindex="-1"])
      `)
    ].filter(element =>
      element.offsetParent !== null
    );

    if (!focusable.length) {
      return;
    }

    const first = focusable[0];

    const last =
      focusable[focusable.length - 1];

    if (
      event.shiftKey &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last.focus();

    } else if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();
    }
  }


  // ==========================================================
  // 42. INSTALL MODAL LISTENERS
  // ==========================================================

  function installModalListeners() {
    const modal = getModal();

    if (!modal) {
      throw new Error(
        "Cannot install picking popup listeners."
      );
    }

    modal.addEventListener(
      "click",
      handleModalClick
    );

    modal.addEventListener(
      "change",
      handleModalChange
    );

    if (!modalListenersInstalled) {
      document.addEventListener(
        "keydown",
        handleModalKeydown
      );

      modalListenersInstalled = true;
    }
  }


  // ==========================================================
  // END OF PART 4 OF 5
  //
  // PART 5:
  // - Public UI API
  // - Available Vehicles integration helpers
  // - Module registration
  // - Initialization
  // - Final IIFE closure
  //
  // Paste PART 5 immediately below.
  // Do NOT close the IIFE yet.
  // ==========================================================


  // ==========================================================
  // VEYNOR PICKING LIST UI
  // PART 5 OF 5
  // PUBLIC API, INITIALIZATION & INTEGRATION
  // ==========================================================


  // ==========================================================
  // 43. VALIDATE POPUP SOURCE
  // ==========================================================

  function validatePopupSource(input = {}) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      throw new Error(
        "Invalid Picking List source."
      );
    }

    const orderIds = normalizeOrderIds(
      input.orderIds || []
    );

    const sourceType = clean(
      input.sourceType || "manual"
    );

    const sourceId =
      input.sourceId || null;

    const sourceLabel = clean(
      input.sourceLabel ||
      "Selected Orders"
    );

    const allowedSourceTypes = new Set([
      "manual",
      "carrier",
      "route",
      "warehouse_pickup",
      "occ",
      "orders"
    ]);

    if (!allowedSourceTypes.has(sourceType)) {
      throw new Error(
        `Unsupported picking source: ${sourceType}`
      );
    }

    return {
      orderIds,
      sourceType,
      sourceId,
      sourceLabel,
      options: input.options || {}
    };
  }


  // ==========================================================
  // 44. OPEN FROM AVAILABLE VEHICLES
  // ==========================================================

  function openForCarrier(
    vehicle,
    orders
  ) {
    if (!vehicle?.id) {
      throw new Error(
        "Carrier information is missing."
      );
    }

    if (!Array.isArray(orders)) {
      throw new Error(
        "Carrier orders must be an array."
      );
    }

    const orderIds = orders.map(
      order => order?.id
    );

    const carrierName = clean(
      vehicle.name ||
      vehicle.vehicle_name ||
      vehicle.registration_number ||
      vehicle.registration ||
      "Carrier"
    );

    return openModal(
      validatePopupSource({
        orderIds,

        sourceType: "carrier",

        sourceId: vehicle.id,

        sourceLabel:
          `${carrierName} - Charter Orders`
      })
    );
  }


  // ==========================================================
  // 45. OPEN FOR A SINGLE ORDER
  // ==========================================================

  function openForOrder(
    orderId,
    orderNumber = ""
  ) {
    const label = clean(
      orderNumber || "Selected Order"
    );

    return openModal(
      validatePopupSource({
        orderIds: [orderId],

        sourceType: "occ",

        sourceId: orderId,

        sourceLabel:
          `Order ${label}`,

        options: {
          pickingMethod: "by_order"
        }
      })
    );
  }


  // ==========================================================
  // 46. OPEN FOR A ROUTE
  // ==========================================================

  function openForRoute(
    route,
    orders
  ) {
    if (!route?.id) {
      throw new Error(
        "Route information is missing."
      );
    }

    if (!Array.isArray(orders)) {
      throw new Error(
        "Route orders must be an array."
      );
    }

    const routeLabel = clean(
      route.route_name ||
      route.route_code ||
      route.name ||
      "Selected Route"
    );

    return openModal(
      validatePopupSource({
        orderIds: orders.map(
          order => order?.id
        ),

        sourceType: "route",

        sourceId: route.id,

        sourceLabel:
          `Route ${routeLabel}`
      })
    );
  }


  // ==========================================================
  // 47. OPEN FOR WAREHOUSE PICKUP
  // ==========================================================

  function openForWarehousePickup(
    vehicle,
    orders
  ) {
    if (!vehicle?.id) {
      throw new Error(
        "Warehouse pickup resource is missing."
      );
    }

    if (!Array.isArray(orders)) {
      throw new Error(
        "Warehouse pickup orders must be an array."
      );
    }

    return openModal(
      validatePopupSource({
        orderIds: orders.map(
          order => order?.id
        ),

        sourceType: "warehouse_pickup",

        sourceId: vehicle.id,

        sourceLabel:
          "Warehouse Pickup Orders"
      })
    );
  }


  // ==========================================================
  // 48. OPEN FOR MANUAL SELECTION
  // ==========================================================

  function openForOrders(
    orders,
    label = "Selected Orders"
  ) {
    if (!Array.isArray(orders)) {
      throw new Error(
        "Orders must be an array."
      );
    }

    const orderIds = orders.map(
      order =>
        typeof order === "string"
          ? order
          : order?.id
    );

    return openModal(
      validatePopupSource({
        orderIds,

        sourceType: "orders",

        sourceLabel: clean(label)
      })
    );
  }


  // ==========================================================
  // 49. CLOSE PUBLIC METHOD
  // ==========================================================

  function close() {
    return closeModal();
  }


  // ==========================================================
  // 50. GET UI STATUS
  // ==========================================================

  function getStatus() {
    const generator =
      window.VeynorPickingListGenerator;

    return {
      version: UI_CONFIG.version,

      isOpen: state.isOpen,

      isGenerating:
        state.isGenerating,

      selectedOrders:
        state.orderIds.length,

      sourceType:
        state.sourceType,

      sourceId:
        state.sourceId,

      sourceLabel:
        state.sourceLabel,

      options:
        state.options
          ? { ...state.options }
          : null,

      generatorAvailable:
        Boolean(generator?.generate),

      scannerAvailable: false,

      employeeAssignmentAvailable: false,

      lastResult:
        state.lastResult
          ? {
              success:
                state.lastResult.success,

              fileName:
                state.lastResult.fileName,

              summary:
                state.lastResult.summary
            }
          : null
    };
  }


  // ==========================================================
  // 51. INSTALL GLOBAL LISTENERS
  // ==========================================================

  function installGlobalListeners() {
    window.addEventListener(
      "veynor:picking:start",
      event => {
        if (!state.isOpen) return;

        const count =
          event.detail?.orderCount ||
          state.orderIds.length;

        setModalStatus(
          `Preparing ${count} orders...`,
          "loading"
        );
      }
    );

    window.addEventListener(
      "veynor:picking:complete",
      event => {
        if (!state.isOpen) return;

        const summary =
          event.detail?.summary || {};

        setModalStatus(
          `Generated ${summary.allocated_packages || 0} allocated packages.`,
          "success"
        );
      }
    );

    window.addEventListener(
      "veynor:picking:error",
      event => {
        if (!state.isOpen) return;

        setModalStatus(
          event.detail?.message ||
          "Picking generation failed.",
          "error"
        );
      }
    );
  }


  // ==========================================================
  // 52. INITIALIZATION
  // ==========================================================

  let initialized = false;

  function initialize() {
    if (initialized) {
      return true;
    }

    installStyles();

    installGlobalListeners();

    initialized = true;

    console.info(
      "[Veynor Picking UI] Module initialized.",
      {
        version: UI_CONFIG.version,

        methods:
          UI_CONFIG.methods.map(
            method => method.value
          ),

        scannerAvailable: false,

        employeeAssignmentAvailable: false
      }
    );

    return true;
  }


  // ==========================================================
  // 53. PUBLIC UI API
  // ==========================================================

  const PickingListUI = Object.freeze({

    version: UI_CONFIG.version,

    initialize,

    open: input =>
      openModal(
        validatePopupSource(input)
      ),

    close,

    openForCarrier,

    openForOrder,

    openForRoute,

    openForWarehousePickup,

    openForOrders,

    getStatus

  });


  // ==========================================================
  // 54. REGISTER PUBLIC MODULE
  // ==========================================================

  if (window.VeynorPickingListUI) {
    console.warn(
      "[Veynor Picking UI] Existing module detected. " +
      "Replacing previous registration."
    );
  }

  window.VeynorPickingListUI =
    PickingListUI;


  // ==========================================================
  // 55. START MODULE
  // ==========================================================

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      {
        once: true
      }
    );
  } else {
    initialize();
  }


  // ==========================================================
  // END OF PART 5 OF 5
  // VEYNOR PICKING LIST UI V1.0.0
  // ==========================================================

})();
