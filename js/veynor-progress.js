
/* ============================================================
   VEYNOR IMPORT PROGRESS
   Version: 2.0.0

   Premium logistics import experience.

   Design reference:
   Veynor Order Import — Processing Your Orders

   Files:
   /assets/popup/veynor-import-background.png
   /assets/branding/veynor-logo.png
   /assets/branding/veynor-logo-trans.png

   Public API:
   VeynorProgress.open()
   VeynorProgress.update()
   VeynorProgress.complete()
   VeynorProgress.fail()
   VeynorProgress.close()
   VeynorProgress.getStatus()

   IMPORTANT:
   This module does not write to Supabase.
   All database operations remain in order-import.js.
   ============================================================ */

(function () {
  "use strict";

  if (window.VeynorProgress) {
    console.warn(
      "[VeynorProgress] Module already loaded."
    );
    return;
  }

  const VERSION = "2.0.0";

  /* ============================================================
     ASSET CONFIGURATION
     ============================================================ */


const ASSETS = Object.freeze({
  backgrounds: {
    orders:
      "/assets/popup/veynor-import-background.png",

labels:
  "/assets/popup/veynor-label-generator-background.png",

deliveryNotes:
  "/assets/popup/veynor-delivery-notes-background.png",

matching:
  "/assets/popup/veynor-order-matching-background.png",

geolocation:
  "/assets/popup/veynor-geolocation-background.png"
  },

  logoHeader:
    "/assets/branding/veynor-logo-header.png"
});


  /* ============================================================
     ELEMENT IDS
     ============================================================ */

  const IDS = Object.freeze({
    overlay: "vpr-overlay",
    modal: "vpr-modal",

    title: "vpr-title",
    description: "vpr-description",

    counter: "vpr-counter",
    percentage: "vpr-percentage",
    progress: "vpr-progress",

    reference: "vpr-reference",
    eta: "vpr-eta",

    scene: "vpr-scene",
    lightTrails: "vpr-light-trails",

    steps: "vpr-steps",

    results: "vpr-results",
    notice: "vpr-notice",
    close: "vpr-close",

    headerStatus: "vpr-header-status",
    liveStatus: "vpr-live-status"
  });

  /* ============================================================
     DEFAULT CONFIGURATION
     ============================================================ */


const PROCESS_CONFIGS = Object.freeze({
  orders: {
    eyebrow: "IMPORTING ORDERS",
    title: "Processing your orders",
    description:
      "Please keep this window open while Veynor imports your orders. " +
      "You can monitor the progress in real time below.",
    status: "Import in progress",
    unit: "order",
    resultLabel: "Imported",
    detailsTitle: "Import Details",
    steps: [
      "Reading file",
      "Preparing orders",
      "Importing into Veynor",
      "Finalizing"
    ],
    features: [
      "Secure Import",
      "Live Processing",
      "Automatic Validation"
    ]
  },

  labels: {
    eyebrow: "GENERATING LABELS",
    title: "Generating Delivery Labels",
    description:
      "Please keep this window open while Veynor generates " +
      "delivery labels for your selected orders.",
    status: "Generating labels",
    unit: "order",
    resultLabel: "Generated",
    detailsTitle: "Label Details",
    steps: [
      "Preparing orders",
      "Generating labels",
      "Combining PDFs",
      "Finalizing"
    ],

    features: [
      "Order Validation",
      "PDF Generation",
      "Document Processing"
    ]
  },

  deliveryNotes: {
    eyebrow: "GENERATING DELIVERY NOTES",
    title: "Generating Delivery Notes",
    description:
      "Please keep this window open while Veynor generates " +
      "delivery notes for your selected orders.",
    status: "Generating documents",
    unit: "order",
    resultLabel: "Generated",
    detailsTitle: "Document Details",
    steps: [
      "Preparing orders",
      "Generating documents",
      "Combining PDFs",
      "Finalizing"
    ],

    features: [
      "Order Validation",
      "PDF Generation",
      "Document Processing"
    ]
  },

  matching: {
    eyebrow: "MATCHING ORDERS",
    title: "Matching Orders & Products",
    description:
      "Please keep this window open while Veynor " +
      "matches your orders with available and expected stock.",
    status: "Matching in progress",
    unit: "order",
    resultLabel: "Matched",
    detailsTitle: "Match Details",
    steps: [
      "Preparing orders",
      "Matching products",
      "Checking results",
      "Finalizing"
    ],
    features: [
      "Product Matching",
      "Stock Allocation",
      "Automatic Validation"
    ]
  },

  geolocation: {
    eyebrow: "GEOLOCATION & PLANNING",
    title: "Geolocating Orders & Preparing Planning",
    description:
      "Please keep this window open while Veynor " +
      "validates delivery locations and releases eligible " +
      "orders to planning.",
    status: "Geolocation in progress",
    unit: "order",
    resultLabel: "Released",
    detailsTitle: "Geolocation & Release Details",
    steps: [
      "Preparing orders",
      "Finding locations",
      "Releasing to planning",
      "Finalizing"
    ],
    features: [
      "Address Validation",
      "Geolocation",
      "Planning Release"
    ]
  }
});

const DEFAULTS = Object.freeze({
  total: 0,
  type: "orders"
});

function getProcessConfig() {
  return PROCESS_CONFIGS[state.type] || PROCESS_CONFIGS.orders;
}


  /* ============================================================
     INTERNAL STATE
     ============================================================ */

  const state = {
    initialized: false,

    active: false,
    finished: false,
    status: "idle",

    total: 0,
    completed: 0,

    imported: 0,
    skipped: 0,
    failed: 0,

    reference: "",
phase: 1,

type: DEFAULTS.type,
title: PROCESS_CONFIGS.orders.title,
description: PROCESS_CONFIGS.orders.description,

    startedAt: null,
    finishedAt: null,

    errors: [],

    details: [],

    previousFocus: null,
    previousBodyOverflow: null
  };

  let root = null;
  let stylesInjected = false;
  let beforeUnloadAttached = false;
  let etaTimer = null;

  /* ============================================================
     GENERAL HELPERS
     ============================================================ */

  function byId(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return min;
    }

    return Math.max(
      min,
      Math.min(max, number)
    );
  }

  function safeInteger(value, fallback = 0) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return fallback;
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.max(0, Math.floor(number));
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  function formatDuration(seconds) {
    const value = Math.max(
      0,
      Math.ceil(Number(seconds) || 0)
    );

    if (value < 60) {
      return value < 1
        ? "Less than 1 second"
        : `${value} seconds`;
    }

    const minutes = Math.floor(value / 60);
    const remainingSeconds = value % 60;

    if (minutes < 60) {
      return remainingSeconds
        ? `${minutes}m ${remainingSeconds}s`
        : `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours}h ${remainingMinutes}m`;
  }

  function getPercentage() {
    if (state.total <= 0) {
      return 0;
    }

    return clamp(
      Math.round(
        (state.completed / state.total) * 100
      ),
      0,
      100
    );
  }

  function getEstimatedSeconds() {
    if (
      !state.active ||
      !state.startedAt ||
      state.completed <= 0 ||
      state.completed >= state.total
    ) {
      return null;
    }

    const elapsed =
      (Date.now() - state.startedAt) / 1000;

    const average = elapsed / state.completed;

    return average * (
      state.total - state.completed
    );
  }

  /* ============================================================
     ICON LIBRARY

     Inline SVG icons:
     - No external icon dependencies
     - Consistent Veynor styling
     - Fully scalable
     ============================================================ */

  function icon(name, size = 22) {
    const icons = {
      shield: `
        <path d="M12 2 20 5v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5l8-3Z"/>
        <path d="m9 12 2 2 4-4"/>
      `,

      database: `
        <ellipse cx="12" cy="5" rx="8" ry="3"/>
        <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>
        <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>
      `,

      check: `
        <circle cx="12" cy="12" r="9"/>
        <path d="m8 12 2.7 2.7L16 9"/>
      `,

      clock: `
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 7v5l3 2"/>
      `,

      info: `
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 11v5"/>
        <path d="M12 8h.01"/>
      `,

      close: `
        <path d="M5 5 19 19"/>
        <path d="M19 5 5 19"/>
      `,

      package: `
        <path d="m12 2 9 5-9 5-9-5 9-5Z"/>
        <path d="M3 7v10l9 5 9-5V7"/>
        <path d="M12 12v10"/>
      `
    };

    return `
      <svg
        width="${size}"
        height="${size}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        ${icons[name] || icons.info}
      </svg>
    `;
  }

  /* ============================================================
     PROCESS STEP DEFINITIONS
     ============================================================ */


  /* ============================================================
     PROCESS STEP HTML
     ============================================================ */

  
function createSteps() {
  const config = getProcessConfig();

  return config.steps.map((title, index) => {
    const id = index + 1;

    return `
      <div
        class="vpr-step"
        id="vpr-step-${id}"
        data-step="${id}"
      >
        <div class="vpr-step-indicator">
          <span
            class="vpr-step-circle"
            id="vpr-step-circle-${id}"
          >
            ${id}
          </span>
        </div>

        <div class="vpr-step-content">
          <div class="vpr-step-title">
            ${title}
          </div>

          <div
            class="vpr-step-subtitle"
            id="vpr-step-subtitle-${id}"
          >
            Pending
          </div>
        </div>
      </div>
    `;
  }).join("");
}


  /* ============================================================
     FEATURE INDICATORS

     Decorative feature labels.
     They do not represent database verification.
     ============================================================ */

  
function createFeatures() {
  const config = getProcessConfig();

  const icons = ["shield", "database", "check"];

  return `
    <div class="vpr-features">
      ${config.features.map((feature, index) => `
        <div class="vpr-feature">
          <div class="vpr-feature-icon">
            ${icon(icons[index] || "check", 25)}
          </div>
          <span>${feature}</span>
        </div>
      `).join("")}
    </div>
  `;
}


  /* ============================================================
     RESULTS HTML

     Hidden during import.
     Displayed when complete or interrupted.
     ============================================================ */

  function createResults() {
    return `
      <div
        id="${IDS.results}"
        class="vpr-results"
        aria-live="polite"
        hidden
      >

        <div class="vpr-result-card vpr-result-success">
          <div
            id="vpr-result-imported"
            class="vpr-result-value"
          >0</div>
          <div class="vpr-result-label">
            Imported
          </div>
        </div>

        <div class="vpr-result-card vpr-result-skipped">
          <div
            id="vpr-result-skipped"
            class="vpr-result-value"
          >0</div>
          <div class="vpr-result-label">
            Skipped
          </div>
        </div>

        <div class="vpr-result-card vpr-result-failed">
          <div
            id="vpr-result-failed"
            class="vpr-result-value"
          >0</div>
          <div class="vpr-result-label">
            Failed
          </div>
        </div>

      </div>
    `;
  }

  /* ============================================================
     CREATE MODAL HTML

     The background image is decorative.

     All progress information is real HTML,
     updated by JavaScript.
     ============================================================ */

  function createModalMarkup() {
    return `

      <div
        id="${IDS.modal}"
        class="vpr-modal"
        role="document"
        tabindex="-1"
      >

        <!-- HEADER -->


<div class="vpr-header vpr-header-image">

  <!-- New Veynor header artwork -->

  <div
    class="vpr-header-art"
    aria-label="Veynor - Supply Chain Made Simple"
  ></div>

  <!-- Dynamic import status -->

  <div class="vpr-header-right">

    <span
      id="${IDS.headerStatus}"
      class="vpr-header-status"
      role="status"
    >
      Import in progress
    </span>

  </div>

</div>

        <!-- INTRODUCTION -->

        <div class="vpr-intro">

          <div class="vpr-intro-text">

            <div class="vpr-eyebrow">
              IMPORTING ORDERS
            </div>

            <h2
              id="${IDS.title}"
              class="vpr-title"
            >
              Processing your orders
            </h2>

            <p
              id="${IDS.description}"
              class="vpr-description"
            >
              Please keep this window open while
              Veynor imports your orders.
              You can monitor the progress
              in real time below.
            </p>

          </div>

          ${createFeatures()}

        </div>

        <!-- PHOTOGRAPHIC TRANSPORT SCENE -->

        <div
          id="${IDS.scene}"
          class="vpr-scene"
          aria-hidden="true"
        >

          <img
            src="${ASSETS.backgrounds.orders}"
            alt=""
            class="vpr-scene-image"
            draggable="false"
          />

          <!-- Animated light trails.
               Created with CSS in part 2. -->

          <div
            id="${IDS.lightTrails}"
            class="vpr-light-trails"
          >
            <span class="vpr-light-trail vpr-trail-one"></span>
            <span class="vpr-light-trail vpr-trail-two"></span>
            <span class="vpr-light-trail vpr-trail-three"></span>
          </div>

          <div class="vpr-scene-shine"></div>

        </div>

        <!-- PROGRESS AREA -->

        <div class="vpr-progress-area">

          <div class="vpr-progress-heading">

            <div
              id="${IDS.counter}"
              class="vpr-counter"
            >
              Preparing import...
            </div>

            <div
              id="${IDS.percentage}"
              class="vpr-percentage"
            >
              0%
            </div>

          </div>

          <div
            class="vpr-progress-track"
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="0"
          >
            <div
              id="${IDS.progress}"
              class="vpr-progress-fill"
            ></div>
          </div>

          <div class="vpr-progress-meta">

            <div
              id="${IDS.reference}"
              class="vpr-reference"
              aria-live="polite"
            >
              Preparing orders...
            </div>

            <div class="vpr-eta-wrap">
              ${icon("clock", 17)}

              <span
                id="${IDS.eta}"
                class="vpr-eta"
              >
                Estimating remaining time...
              </span>
            </div>

          </div>

        </div>

        <!-- HORIZONTAL PROCESS TRACKER -->

        <div
          id="${IDS.steps}"
          class="vpr-steps"
        >
          ${createSteps()}
        </div>

        <!-- RESULTS -->

        ${createResults()}

        <!-- IMPORT DETAILS -->

        <div
          id="vpr-import-details"
          class="vpr-import-details"
          hidden
        >
          <details id="vpr-details-panel">


<summary class="vpr-details-toggle">
  <span class="vpr-details-heading">
    <span>Import Details</span>
    <span class="vpr-details-arrow" aria-hidden="true"></span>
  </span>

  <span
    id="vpr-details-count"
    class="vpr-details-count"
  >0 orders need attention</span>
</summary>


            <div class="vpr-details-content">
              <div
                id="vpr-details-list"
                class="vpr-details-list"
              ></div>
            </div>

          </details>
        </div>

        <!-- INFORMATION NOTICE -->

        <div
          id="${IDS.notice}"
          class="vpr-notice"
          role="status"
        >

          <div class="vpr-notice-icon">
            ${icon("info", 23)}
          </div>

          <div class="vpr-notice-content">

            <strong id="vpr-notice-title">
              Please keep this window open
            </strong>

            <span id="vpr-notice-text">
              Your orders are being processed securely.
              The results will appear automatically
              when finished.
            </span>

          </div>

        </div>

        <!-- CLOSE AFTER COMPLETION -->

        <button
          id="${IDS.close}"
          class="vpr-close-button"
          type="button"
          hidden
          disabled
        >
          Close &amp; View Results
        </button>

      </div>

    `;
  }

  /* ============================================================
     END OF PART 1

     PART 2:
     - Complete CSS
     - Responsive layout
     - Light trail animations
     - Step animations
     - Modal DOM initialization

     PART 3:
     - open()
     - update()
     - complete()
     - fail()
     - close()
     - getStatus()

     IMPORTANT:
     Do not add })(); yet.
     Continue directly below this block.
     ============================================================ */

/* ============================================================
   VEYNOR IMPORT PROGRESS 2.0
   PART 2A — PREMIUM VISUAL DESIGN

   Requires PART 1.

   Continue with PART 2B directly below this code.
   ============================================================ */

function injectStyles() {
  if (stylesInjected) return;

  if (document.getElementById("vpr-v2-styles")) {
    stylesInjected = true;
    return;
  }

  const style = document.createElement("style");
  style.id = "vpr-v2-styles";

  style.textContent = `

    /* ========================================================
       DESIGN VARIABLES
       ======================================================== */

    :root {
      --vpr-navy: #071b43;
      --vpr-blue: #0864f9;
      --vpr-blue-dark: #064bc7;
      --vpr-blue-bright: #3c9cff;

      --vpr-text: #10234b;
      --vpr-muted: #58709a;
      --vpr-border: #e2eaf6;

      --vpr-success: #159568;
      --vpr-warning: #d99527;
      --vpr-danger: #dc4756;
    }

    /* ========================================================
       OVERLAY
       ======================================================== */

    .vpr-overlay {
      position: fixed;
      inset: 0;
      z-index: 250000;

      display: none;
      align-items: center;
      justify-content: center;

      padding: 24px;

      background: rgba(5, 18, 44, .72);

      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
    }

    .vpr-overlay.vpr-open {
      display: flex;
      animation: vpr-overlay-enter .25s ease both;
    }

    @keyframes vpr-overlay-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ========================================================
       MAIN MODAL
       ======================================================== */

    .vpr-modal {
      position: relative;

      width: min(900px, 100%);
      max-height: calc(100vh - 48px);

      overflow-x: hidden;
      overflow-y: auto;

      background: #ffffff;
      color: var(--vpr-text);

      border: 1px solid rgba(255,255,255,.8);
      border-radius: 16px;

      box-shadow:
        0 40px 110px rgba(0,11,35,.35),
        0 8px 30px rgba(0,20,55,.15);

      font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        system-ui,
        sans-serif;

      scrollbar-width: thin;
      scrollbar-color: #c9d8ef transparent;

      animation: vpr-modal-enter .35s
        cubic-bezier(.2,.8,.2,1) both;
    }

    @keyframes vpr-modal-enter {
      from {
        opacity: 0;
        transform: translateY(20px) scale(.975);
      }

      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* ========================================================
       HEADER AND VEYNOR LOGO
       ======================================================== */

    .vpr-header {
      min-height: 91px;

      display: flex;
      align-items: center;
      justify-content: space-between;

      gap: 20px;
      padding: 19px 42px 12px;
    }

    .vpr-brand {
      display: flex;
      align-items: center;

      width: 150px;
      height: 65px;

      overflow: hidden;
    }

    .vpr-brand-image {
      display: block;

      width: 100%;
      height: 100%;

      object-fit: contain;
      object-position: left center;
    }

    .vpr-header-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;

      gap: 20px;
      min-width: 0;
    }

    .vpr-tagline {
      color: #45638e;

      font-size: 9px;
      line-height: 1.7;

      font-weight: 800;
      letter-spacing: 3px;

      white-space: nowrap;
    }

    .vpr-tagline span {
      display: block;
    }

    .vpr-header-divider {
      width: 1px;
      height: 27px;
      background: #dbe5f4;
    }

    .vpr-header-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;

      color: #42618d;

      font-size: 10px;
      font-weight: 700;

      white-space: nowrap;
    }

    .vpr-header-status::before {
      content: "";

      width: 7px;
      height: 7px;

      border-radius: 50%;
      background: var(--vpr-blue);

      box-shadow:
        0 0 0 4px rgba(8,100,249,.10);

      animation: vpr-status-pulse 2s
        ease-in-out infinite;
    }

    @keyframes vpr-status-pulse {
      0%,100% { opacity: 1; }
      50% { opacity: .45; }
    }

    /* ========================================================
       INTRODUCTION
       ======================================================== */

    .vpr-intro {
      display: flex;
      align-items: center;
      justify-content: space-between;

      gap: 24px;
      padding: 15px 42px 27px;
    }

    .vpr-intro-text {
      flex: 1;
      min-width: 0;
    }

    .vpr-eyebrow {
      margin-bottom: 10px;

      color: var(--vpr-blue);

      font-size: 10px;
      font-weight: 850;

      letter-spacing: 2.8px;
    }

    .vpr-title {
      margin: 0 0 11px;

      color: var(--vpr-navy);

      font-size: clamp(25px,3vw,34px);
      line-height: 1.18;

      font-weight: 850;
      letter-spacing: -1.1px;
    }

    .vpr-description {
      max-width: 470px;
      margin: 0;

      color: var(--vpr-muted);

      font-size: 13px;
      line-height: 1.65;
      font-weight: 450;
    }

    /* ========================================================
       FEATURE INDICATORS
       ======================================================== */

    .vpr-features {
      display: flex;
      align-items: stretch;
      flex-shrink: 0;
      gap: 0;
    }

    .vpr-feature {
      width: 93px;

      display: flex;
      flex-direction: column;
      align-items: center;

      gap: 9px;
      padding: 8px 10px;

      border-left: 1px solid #e7edf7;

      text-align: center;

      color: var(--vpr-navy);

      font-size: 10px;
      line-height: 1.35;
      font-weight: 750;
    }

    .vpr-feature:first-child {
      border-left: 0;
    }

    .vpr-feature-icon {
      width: 49px;
      height: 49px;

      display: grid;
      place-items: center;

      border-radius: 17px;

      background: linear-gradient(
        145deg,
        #f4f8ff,
        #e8f1ff
      );

      color: var(--vpr-blue);
    }

    .vpr-feature svg {
      display: block;
    }

    /* ========================================================
       REALISTIC TRANSPORT IMAGE
       ======================================================== */

    .vpr-scene {
      position: relative;

      width: 100%;
      height: 255px;

      overflow: hidden;
      isolation: isolate;

      background: #0c2446;
    }

    .vpr-scene-image {
      position: absolute;
      inset: 0;

      display: block;

      width: 100%;
      height: 100%;

      object-fit: cover;
      object-position: center 53%;

      user-select: none;
      pointer-events: none;
    }

    .vpr-scene::after {
      content: "";

      position: absolute;
      inset: 0;
      z-index: 3;

      pointer-events: none;

      background: linear-gradient(
        180deg,
        rgba(5,23,55,.04) 0%,
        transparent 55%,
        rgba(4,17,42,.10) 100%
      );
    }

    /* ========================================================
       MOVING BLUE LIGHT TRAILS
       ======================================================== */

    .vpr-light-trails {
      position: absolute;
      inset: 0;

      z-index: 2;

      overflow: hidden;
      pointer-events: none;

      mix-blend-mode: screen;
    }

    .vpr-light-trail {
      position: absolute;
      left: -65%;

      width: 62%;
      height: 3px;

      border-radius: 999px;

      background: linear-gradient(
        90deg,
        transparent,
        rgba(0,98,255,.10),
        rgba(37,145,255,.85),
        rgba(169,223,255,.95),
        transparent
      );

      box-shadow:
        0 0 7px rgba(20,118,255,.8),
        0 0 17px rgba(20,118,255,.35);

      opacity: 0;

      animation: vpr-data-travel 5.5s
        linear infinite;
    }

    .vpr-trail-one {
      top: 68%;
      animation-delay: 0s;
    }

    .vpr-trail-two {
      top: 73%;
      height: 2px;
      animation-delay: 1.4s;
      animation-duration: 6.3s;
    }

    .vpr-trail-three {
      top: 78%;
      height: 2px;
      animation-delay: 3s;
      animation-duration: 7s;
    }

    @keyframes vpr-data-travel {
      0% {
        transform: translateX(0);
        opacity: 0;
      }

      12% {
        opacity: .8;
      }

      70% {
        opacity: .65;
      }

      100% {
        transform: translateX(270%);
        opacity: 0;
      }
    }

    /* ========================================================
       SUBTLE WAREHOUSE LIGHT GLOW
       ======================================================== */

    .vpr-scene-shine {
      position: absolute;

      z-index: 1;

      top: 5%;
      right: 5%;

      width: 38%;
      height: 80%;

      border-radius: 50%;

      background: radial-gradient(
        ellipse,
        rgba(40,130,255,.13),
        transparent 70%
      );

      pointer-events: none;

      animation: vpr-warehouse-glow 6s
        ease-in-out infinite;
    }

    @keyframes vpr-warehouse-glow {
      0%,100% {
        opacity: .35;
        transform: scale(1);
      }

      50% {
        opacity: .8;
        transform: scale(1.07);
      }
    }

    /* ========================================================
       PROGRESS AREA
       ======================================================== */

    .vpr-progress-area {
      padding: 27px 42px 21px;
    }

    .vpr-progress-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;

      gap: 16px;
      margin-bottom: 13px;
    }

    .vpr-counter {
      color: var(--vpr-navy);

      font-size: 15px;
      font-weight: 800;
      letter-spacing: -.25px;
    }

    .vpr-percentage {
      color: var(--vpr-blue);

      font-size: 29px;
      line-height: 1;

      font-weight: 900;
      letter-spacing: -.8px;

      font-variant-numeric: tabular-nums;
    }

    /* ========================================================
       PROGRESS BAR
       ======================================================== */

    .vpr-progress-track {
      position: relative;

      width: 100%;
      height: 18px;

      overflow: hidden;

      border-radius: 999px;

      background: #e4ebf6;

      box-shadow:
        inset 0 1px 3px rgba(5,25,60,.08);
    }

    .vpr-progress-fill {
      position: relative;

      width: 0%;
      height: 100%;

      overflow: hidden;

      border-radius: 999px;

      background: linear-gradient(
        90deg,
        #0860ed 0%,
        #087aff 55%,
        #65b8ff 100%
      );

      box-shadow:
        0 0 9px rgba(8,100,249,.30);

      transition:
        width .55s cubic-bezier(.22,.8,.22,1);
    }

    .vpr-progress-fill::after {
      content: "";

      position: absolute;
      inset: 0;

      background: linear-gradient(
        105deg,
        transparent 20%,
        rgba(255,255,255,.35) 50%,
        transparent 80%
      );

      background-size: 200% 100%;

      animation: vpr-progress-shimmer 2.5s
        linear infinite;
    }

    @keyframes vpr-progress-shimmer {
      from {
        background-position: 200% 0;
      }

      to {
        background-position: -200% 0;
      }
    }

    /* ========================================================
       CURRENT ORDER AND ESTIMATED TIME
       ======================================================== */

    .vpr-progress-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;

      flex-wrap: wrap;

      gap: 10px;
      margin-top: 13px;
    }

    .vpr-reference {
      color: #49638b;

      font-size: 12px;
      font-weight: 650;

      overflow-wrap: anywhere;
    }

    .vpr-eta-wrap {
      display: inline-flex;
      align-items: center;

      gap: 7px;

      color: #49638b;

      font-size: 12px;
      font-weight: 550;

      white-space: nowrap;
    }

    .vpr-eta-wrap svg {
      color: var(--vpr-blue);
    }

    .vpr-eta {
      font-variant-numeric: tabular-nums;
    }

    /* ========================================================
       END OF PART 2A

       IMPORTANT:
       The CSS template string is still OPEN.

       Do not add a closing backtick.
       Do not add a closing brace.
       Do not add })();

       PART 2B continues inside this CSS string.
       ======================================================== */


    /* ========================================================
       HORIZONTAL PROCESS TRACKER
       ======================================================== */

    .vpr-steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0;
      margin: 8px 42px 25px;
      padding: 19px 0 0;
      border-top: 1px solid #edf1f8;
    }

    .vpr-step {
      position: relative;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 9px;
      padding-right: 8px;
      color: #7b8eaa;
    }

    .vpr-step-indicator {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
      height: 35px;
    }

    .vpr-step:not(:last-child)
    .vpr-step-indicator::after {
      content: "";
      position: absolute;
      left: 40px;
      right: 9px;
      top: 16px;
      height: 2px;
      background: #dbe5f3;
      transition: background .35s ease;
    }

    .vpr-step-circle {
      position: relative;
      z-index: 2;
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #e8eef7;
      color: #647da2;
      font-size: 14px;
      font-weight: 800;
      transition:
        background .3s ease,
        color .3s ease,
        box-shadow .3s ease;
    }

    .vpr-step-content {
      padding-right: 8px;
    }

    .vpr-step-title {
      color: #526889;
      font-size: 12px;
      line-height: 1.4;
      font-weight: 750;
    }

    .vpr-step-subtitle {
      margin-top: 4px;
      color: #8293ad;
      font-size: 11px;
      line-height: 1.4;
    }

    /* COMPLETED STEPS */

    .vpr-step.vpr-done .vpr-step-circle {
      background: var(--vpr-blue);
      color: #ffffff;
    }

    .vpr-step.vpr-done .vpr-step-title {
      color: var(--vpr-navy);
    }

    .vpr-step.vpr-done .vpr-step-subtitle {
      color: #52709b;
    }

    .vpr-step.vpr-done:not(:last-child)
    .vpr-step-indicator::after {
      background: var(--vpr-blue);
    }

    /* ACTIVE STEP */

    .vpr-step.vpr-active .vpr-step-circle {
      background: #e5f0ff;
      color: var(--vpr-blue);
      box-shadow: 0 0 0 4px rgba(8,100,249,.09);
      animation: vpr-step-pulse 1.8s
        ease-in-out infinite;
    }

    .vpr-step.vpr-active .vpr-step-title {
      color: var(--vpr-navy);
    }

    .vpr-step.vpr-active .vpr-step-subtitle {
      color: var(--vpr-blue);
      font-weight: 750;
    }

    @keyframes vpr-step-pulse {
      0%, 100% {
        box-shadow: 0 0 0 4px rgba(8,100,249,.09);
      }
      50% {
        box-shadow: 0 0 0 9px rgba(8,100,249,.025);
      }
    }

    /* FAILED STEP */

    .vpr-step.vpr-error .vpr-step-circle {
      background: #fff0f1;
      color: var(--vpr-danger);
      box-shadow: 0 0 0 4px rgba(220,71,86,.07);
    }

    .vpr-step.vpr-error .vpr-step-title,
    .vpr-step.vpr-error .vpr-step-subtitle {
      color: var(--vpr-danger);
    }

    /* ========================================================
       RESULT SUMMARY
       ======================================================== */

    .vpr-results {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 0 42px 22px;
    }

    .vpr-results[hidden] {
      display: none !important;
    }

    .vpr-result-card {
      padding: 17px 15px;
      border: 1px solid var(--vpr-border);
      border-radius: 12px;
      background: #f9fbff;
      text-align: center;
    }

    .vpr-result-value {
      font-size: 27px;
      font-weight: 850;
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }

    .vpr-result-label {
      margin-top: 5px;
      color: var(--vpr-muted);
      font-size: 11px;
      font-weight: 700;
    }

    .vpr-result-success .vpr-result-value {
      color: var(--vpr-success);
    }

    .vpr-result-skipped .vpr-result-value {
      color: var(--vpr-warning);
    }

    .vpr-result-failed .vpr-result-value {
      color: var(--vpr-danger);
    }


    /* ========================================================
       IMPORT DETAILS — SKIPPED & FAILED
       ======================================================== */

    .vpr-import-details {
      margin: 0 42px 22px;
      border: 1px solid #dce7f7;
      border-radius: 12px;
      background: #f9fbff;
      overflow: hidden;
    }

    .vpr-import-details[hidden] {
      display: none !important;
    }

    .vpr-details-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 15px 18px;
      cursor: pointer;
      color: #071b43;
      font-size: 13px;
      font-weight: 800;
    }

    .vpr-details-toggle:hover {
      background: #eef5ff;
    }


/* Import Details — visible expand/collapse arrow */

.vpr-details-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.vpr-details-arrow {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-right: 2px solid #0864f9;
  border-bottom: 2px solid #0864f9;
  transform: rotate(45deg);
  transition: transform 0.2s ease;
  margin-top: -4px;
}

#vpr-details-panel[open] .vpr-details-arrow {
  transform: rotate(225deg);
  margin-top: 4px;
}

.vpr-details-toggle::-webkit-details-marker {
  display: none;
}

.vpr-details-toggle {
  list-style: none;
}

.vpr-details-toggle::marker {
  content: "";
}


    .vpr-details-content {
      padding: 0 16px 16px;
    }

    .vpr-details-list {
      max-height: 220px;
      overflow-y: auto;
      border-top: 1px solid #e2eaf6;
    }

    .vpr-detail-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 2px;
      border-bottom: 1px solid #edf1f8;
    }

    .vpr-detail-row:last-child {
      border-bottom: 0;
    }

    .vpr-detail-info {
      min-width: 0;
      flex: 1;
    }

    .vpr-detail-order {
      color: #071b43;
      font-size: 12px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .vpr-detail-reason {
      margin-top: 4px;
      color: #58709a;
      font-size: 11px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .vpr-detail-badge {
      flex-shrink: 0;
      padding: 5px 9px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 800;
    }


.vpr-detail-badge.skipped {
  background: transparent;
  color: #64748b;
  border: none;
  border-radius: 0;
  padding: 5px 0;
  font-size: 10px;
  font-weight: 650;
}


    .vpr-detail-badge.failed {
      background: #fff0f2;
      color: #d4374a;
    }

    @media (max-width: 850px) {
      .vpr-import-details {
        margin: 0 28px 20px;
      }
    }

    @media (max-width: 650px) {
      .vpr-import-details {
        margin: 0 20px 20px;
      }

      .vpr-details-toggle {
        padding: 13px;
      }

      .vpr-details-content {
        padding: 0 12px 12px;
      }
    }


    /* ========================================================
       INFORMATION NOTICE
       ======================================================== */

    .vpr-notice {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin: 0 42px 28px;
      padding: 16px 18px;
      border: 1px solid #cbdfff;
      border-radius: 12px;
      background: linear-gradient(
        115deg,
        #f1f7ff,
        #eaf3ff
      );
      color: #45618c;
    }

    .vpr-notice-icon {
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #e0edff;
      color: var(--vpr-blue);
    }

    .vpr-notice-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .vpr-notice-content strong {
      color: var(--vpr-navy);
      font-size: 12px;
      font-weight: 800;
    }

    .vpr-notice-content span {
      color: #56719b;
      font-size: 11.5px;
      line-height: 1.55;
    }

    /* ========================================================
       CLOSE BUTTON
       ======================================================== */

    .vpr-close-button {
      display: block;
      width: calc(100% - 84px);
      margin: 0 42px 28px;
      padding: 14px 20px;
      border: none;
      border-radius: 11px;
      background: var(--vpr-blue);
      color: #ffffff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      transition:
        background .2s ease,
        transform .2s ease;
    }

    .vpr-close-button[hidden] {
      display: none !important;
    }

    .vpr-close-button:hover:not(:disabled) {
      background: var(--vpr-blue-dark);
      transform: translateY(-1px);
    }

    .vpr-close-button:focus-visible {
      outline: 3px solid #9fc6ff;
      outline-offset: 3px;
    }

    /* ========================================================
       COMPLETED AND FAILED STATES
       ======================================================== */

    .vpr-modal.vpr-completed .vpr-progress-fill {
      background: linear-gradient(
        90deg,
        #0e9765,
        #43c996
      );
    }

    .vpr-modal.vpr-failed .vpr-progress-fill {
      background: linear-gradient(
        90deg,
        #c93449,
        #ed7a86
      );
    }

    .vpr-modal.vpr-completed .vpr-light-trail,
    .vpr-modal.vpr-failed .vpr-light-trail,
    .vpr-modal.vpr-completed .vpr-scene-shine,
    .vpr-modal.vpr-failed .vpr-scene-shine {
      animation-play-state: paused;
      opacity: 0;
    }

    .vpr-modal.vpr-completed .vpr-header-status::before {
      background: var(--vpr-success);
      animation: none;
    }

    .vpr-modal.vpr-failed .vpr-header-status::before {
      background: var(--vpr-danger);
      animation: none;
    }

    .vpr-modal.vpr-failed .vpr-notice {
      background: #fff5f6;
      border-color: #f2cbd0;
    }

    .vpr-modal.vpr-failed .vpr-notice-icon {
      background: #ffe5e8;
      color: var(--vpr-danger);
    }

    /* ========================================================
       END OF PART 2BA

       PART 2BB CONTINUES DIRECTLY BELOW.

       The CSS template string is still open.
       Do not close injectStyles() yet.
       ======================================================== */


    /* ========================================================
       RESPONSIVE LAYOUT
       ======================================================== */

    @media (max-width: 850px) {
      .vpr-header {
        padding: 18px 28px 10px;
      }

      .vpr-intro {
        padding: 15px 28px 25px;
      }

      .vpr-progress-area {
        padding: 25px 28px 20px;
      }

      .vpr-steps {
        margin: 8px 28px 24px;
      }

      .vpr-results {
        margin: 0 28px 20px;
      }

      .vpr-notice {
        margin: 0 28px 25px;
      }

      .vpr-close-button {
        width: calc(100% - 56px);
        margin: 0 28px 25px;
      }

      .vpr-feature {
        width: 78px;
        padding: 8px 6px;
      }

      .vpr-scene {
        height: 230px;
      }
    }

    @media (max-width: 650px) {
      .vpr-overlay {
        padding: 12px;
      }

      .vpr-modal {
        max-height: calc(100vh - 24px);
        border-radius: 13px;
      }

      .vpr-header {
        min-height: 68px;
        padding: 12px 20px;
      }

      .vpr-brand {
        width: 100px;
        height: 47px;
      }

      .vpr-tagline {
        font-size: 7px;
        letter-spacing: 1.5px;
      }

      .vpr-header-divider,
      .vpr-header-status {
        display: none;
      }

      .vpr-intro {
        display: block;
        padding: 14px 20px 20px;
      }

      .vpr-title {
        font-size: 25px;
      }

      .vpr-description {
        font-size: 12px;
      }

      .vpr-features {
        margin-top: 20px;
        justify-content: space-between;
      }

      .vpr-feature {
        flex: 1;
        width: auto;
      }

      .vpr-feature-icon {
        width: 42px;
        height: 42px;
        border-radius: 13px;
      }

      .vpr-scene {
        height: 185px;
      }

      .vpr-progress-area {
        padding: 23px 20px 17px;
      }

      .vpr-counter {
        font-size: 13px;
      }

      .vpr-percentage {
        font-size: 25px;
      }

      .vpr-progress-track {
        height: 14px;
      }

      .vpr-progress-meta {
        align-items: flex-start;
        flex-direction: column;
      }

      .vpr-steps {
        grid-template-columns:
          repeat(2, minmax(0, 1fr));

        gap: 22px 12px;
        margin: 8px 20px 24px;
      }

      .vpr-step:nth-child(2)
      .vpr-step-indicator::after {
        display: none;
      }

      .vpr-step-title {
        font-size: 11px;
      }

      .vpr-step-subtitle {
        font-size: 10px;
      }

      .vpr-results {
        gap: 7px;
        margin: 0 20px 20px;
      }

      .vpr-result-card {
        padding: 12px 6px;
      }

      .vpr-result-value {
        font-size: 22px;
      }

      .vpr-notice {
        margin: 0 20px 22px;
        padding: 13px;
      }

      .vpr-close-button {
        width: calc(100% - 40px);
        margin: 0 20px 22px;
      }
    }

    @media (max-width: 380px) {
      .vpr-tagline {
        display: none;
      }

      .vpr-scene {
        height: 145px;
      }

      .vpr-title {
        font-size: 22px;
      }
    }

    /* ========================================================
       ACCESSIBILITY
       ======================================================== */

    @media (prefers-reduced-motion: reduce) {
      .vpr-overlay,
      .vpr-modal,
      .vpr-light-trail,
      .vpr-scene-shine,
      .vpr-progress-fill,
      .vpr-progress-fill::after,
      .vpr-step-circle,
      .vpr-header-status::before {
        animation: none !important;
        transition: none !important;
      }
    }


    /* ========================================================
       VEYNOR V2.1 — VISUAL REFINEMENTS
       ======================================================== */

    /* 1. OFFICIAL DARK LOGO */

    .vpr-brand {
      width: 110px;
      height: 65px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      overflow: hidden;
      border-radius: 8px;
    }

    .vpr-brand-image {
      display: block;
      width: 110px;
      height: 65px;
      object-fit: contain;
      object-position: center;
      border-radius: 8px;
    }

    /* 2. FULL WIDTH TRANSPORT IMAGE */

    .vpr-modal {
      box-sizing: border-box;
      border: 0;
    }

    .vpr-scene {
      position: relative;
      display: block;
      width: 100%;
      height: 255px;
      margin: 0;
      padding: 0;
      border: 0;
      overflow: hidden;
      isolation: isolate;
      background: #0c2446;
    }

    .vpr-scene-image {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      object-fit: cover;
      object-position: center 53%;
      user-select: none;
      pointer-events: none;
    }

    /* 3. MORE VISIBLE BLUE LIGHT TRAILS */

    .vpr-light-trails {
      position: absolute;
      inset: 0;
      z-index: 2;
      overflow: hidden;
      pointer-events: none;
      mix-blend-mode: screen;
    }

    .vpr-light-trail {
      position: absolute;
      left: -65%;
      width: 62%;
      height: 3px;
      border-radius: 999px;

      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(0,100,255,.25) 20%,
        rgba(20,130,255,.95) 50%,
        rgba(180,230,255,1) 70%,
        transparent 100%
      );

      box-shadow:
        0 0 8px rgba(20,130,255,.95),
        0 0 20px rgba(20,130,255,.65),
        0 0 35px rgba(20,130,255,.25);

      opacity: 0;
      animation: vpr-data-travel 5.5s linear infinite;
    }

    /* 4. CENTERED HORIZONTAL PROCESS STEPS */

    @media (min-width: 651px) {
      .vpr-steps {
        display: grid;
        grid-template-columns:
          repeat(4, minmax(0, 1fr));
        gap: 0;
      }

      .vpr-step {
        align-items: center;
        text-align: center;
        padding: 0;
      }

      .vpr-step-indicator {
        justify-content: center;
      }

      .vpr-step-content {
        width: 100%;
        box-sizing: border-box;
        padding: 0 8px;
        text-align: center;
      }

      .vpr-step:not(:last-child)
      .vpr-step-indicator::after {
        left: calc(50% + 23px);
        right: calc(-50% + 23px);
        top: 16px;
      }

      .vpr-step-title {
        font-size: 12px;
        font-weight: 750;
      }

      .vpr-step-subtitle {
        font-size: 11px;
      }
    }

    /* 5. SUCCESS AND FAILURE COLORS */

    .vpr-modal.vpr-completed .vpr-percentage {
      color: #159568;
    }

    .vpr-modal.vpr-completed .vpr-progress-fill {
      background: linear-gradient(
        90deg,
        #0e9765,
        #43c996
      );
    }

    .vpr-modal.vpr-failed .vpr-percentage {
      color: #dc4756;
    }

    .vpr-modal.vpr-failed .vpr-progress-fill {
      background: linear-gradient(
        90deg,
        #c93449,
        #ed7a86
      );
    }

    /* 6. MORE READABLE DESCRIPTION */

    .vpr-description {
      color: #425b82;
      font-size: 14px;
      line-height: 1.65;
      font-weight: 500;
    }

    /* 7. MOBILE ADJUSTMENTS */

    @media (max-width: 650px) {
      .vpr-brand {
        width: 80px;
        height: 50px;
      }

      .vpr-brand-image {
        width: 80px;
        height: 50px;
      }

      .vpr-scene {
        height: 185px;
      }

      .vpr-description {
        font-size: 12px;
      }
    }

    @media (max-width: 380px) {
      .vpr-scene {
        height: 145px;
      }
    }


/* ============================================================
   VEYNOR PREMIUM HEADER V2.4
   Seamless background with separate Veynor logo
   ============================================================ */

.vpr-header.vpr-header-image {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;

  width: 100%;
  height: 115px;
  min-height: 115px;
  padding: 0 30px;
  margin: 0;

  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;

  background:
    linear-gradient(
      125deg,
      #04132f 0%,
      #071c43 52%,
      #061735 100%
    );
}

/* Separate original Veynor logo */



.vpr-header-art {
  position: absolute;
  z-index: 2;

  left: 28px;
  top: 50%;

width: 450px;
height: 110px;

  transform: translateY(-50%);

  background-image:
    url("/assets/branding/veynor-logo-header.png");

  background-repeat: no-repeat;
  background-position: left center;
  background-size: contain;

  pointer-events: none;
}

/* Diagonal blue accents */

.vpr-header.vpr-header-image::before {
  content: "";
  position: absolute;
  z-index: 1;

  top: -50%;
  left: 53%;

  width: 90px;
  height: 210%;

  transform: skewX(-38deg);

  background: linear-gradient(
    90deg,
    transparent,
    rgba(0,95,255,.13),
    rgba(0,125,255,.22),
    transparent
  );

  pointer-events: none;
}

.vpr-header.vpr-header-image::after {
  content: "";
  position: absolute;
  z-index: 1;

  top: -50%;
  left: 65%;

  width: 2px;
  height: 210%;

  transform: skewX(-38deg);

  background: rgba(20,125,255,.55);
  box-shadow: 0 0 15px rgba(20,125,255,.35);

  pointer-events: none;
}

/* Dynamic status */

.vpr-header-image .vpr-header-right {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-left: auto;
}

.vpr-header-image .vpr-header-status {
  display: inline-flex;
  align-items: center;
  gap: 9px;

  padding: 10px 14px;

  border: 1px solid rgba(160,195,255,.25);
  border-radius: 999px;

  background: rgba(4,20,48,.85);
  color: #ffffff;

  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.vpr-header-image .vpr-header-status::before {
  content: "";
  width: 8px;
  height: 8px;
  flex-shrink: 0;

  border-radius: 50%;
  background: #3c9cff;
  box-shadow: 0 0 0 4px rgba(60,156,255,.16);
}

/* Status colors */

.vpr-modal.vpr-completed
.vpr-header-image .vpr-header-status::before {
  background: #31d59a;
  animation: none;
}

.vpr-modal.vpr-failed
.vpr-header-image .vpr-header-status::before {
  background: #ff6575;
  animation: none;
}

/* Responsive */

@media (max-width: 650px) {
  .vpr-header.vpr-header-image {
    height: 85px;
    min-height: 85px;
    padding: 0 12px;
  }


.vpr-header-art {
  left: 12px;
  width: 185px;
  height: 65px;
}


  .vpr-header-image .vpr-header-status {
    display: inline-flex;
    padding: 7px 9px;
    font-size: 9px;
  }
}


  `;

  // Inject the complete CSS into the document.
  document.head.appendChild(style);

  stylesInjected = true;
}

/* ============================================================
   CREATE MODAL
   ============================================================ */

function createModal() {
  if (root && root.isConnected) {
    return root;
  }

  injectStyles();

  const existing = byId(IDS.overlay);

  if (existing) {
    root = existing;
    state.initialized = true;
    return root;
  }

  if (!document.body) {
    throw new Error(
      "VeynorProgress requires document.body."
    );
  }

  const overlay = document.createElement("div");

  overlay.id = IDS.overlay;
  overlay.className = "vpr-overlay";

  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute(
    "aria-labelledby",
    IDS.title
  );
  overlay.setAttribute(
    "aria-describedby",
    IDS.description
  );

  // HTML is generated by PART 1.
  overlay.innerHTML = createModalMarkup();

  document.body.appendChild(overlay);

  root = overlay;
  state.initialized = true;

  // Clicking outside cannot close an active import.
  overlay.addEventListener("click", event => {
    if (event.target !== overlay) return;
    if (state.active) return;

    close();
  });

  // Close button becomes available after completion.
  const closeButton = byId(IDS.close);

  if (closeButton) {
    closeButton.addEventListener("click", () => {
      close();
    });
  }

  // Escape key cannot interrupt an active import.
  document.addEventListener("keydown", event => {
    if (
      event.key !== "Escape" ||
      !root?.classList.contains("vpr-open")
    ) {
      return;
    }

    if (state.active) {
      event.preventDefault();
      return;
    }

    close();
  });

  return root;
}

/* ============================================================
   PROCESS STEP MANAGEMENT
   ============================================================ */

function setStep(stepNumber, status = "pending") {
  const step = byId(`vpr-step-${stepNumber}`);

  if (!step) return;

  step.classList.remove(
    "vpr-done",
    "vpr-active",
    "vpr-error"
  );

  const circle = byId(
    `vpr-step-circle-${stepNumber}`
  );

  const subtitle = byId(
    `vpr-step-subtitle-${stepNumber}`
  );

  if (status === "done") {
    step.classList.add("vpr-done");

    if (circle) {
      circle.textContent = "✓";
    }

    if (subtitle) {
      subtitle.textContent = "Completed";
    }

  } else if (status === "active") {
    step.classList.add("vpr-active");

    if (circle) {
      circle.textContent = "●";
    }

    if (subtitle) {
      subtitle.textContent = "In progress";
    }

  } else if (status === "error") {
    step.classList.add("vpr-error");

    if (circle) {
      circle.textContent = "!";
    }

    if (subtitle) {
      subtitle.textContent = "Interrupted";
    }

  } else {
    if (circle) {
      circle.textContent = String(stepNumber);
    }

    if (subtitle) {
      subtitle.textContent = "Pending";
    }
  }
}

function resetSteps() {
  for (let i = 1; i <= 4; i++) {
    setStep(i, "pending");
  }
}

/* ============================================================
   PROGRESS BAR MANAGEMENT
   ============================================================ */

function setProgressValue(percentage) {
  const value = clamp(
    percentage,
    0,
    100
  );

  const progress = byId(IDS.progress);

  if (progress) {
    progress.style.width = `${value}%`;
  }

  setText(
    IDS.percentage,
    `${Math.round(value)}%`
  );

  const track = root?.querySelector(
    '[role="progressbar"]'
  );

  if (track) {
    track.setAttribute(
      "aria-valuenow",
      String(Math.round(value))
    );
  }
}

/* ============================================================
   NOTICE MANAGEMENT
   ============================================================ */

function setNotice(title, message) {
  setText(
    "vpr-notice-title",
    title
  );

  setText(
    "vpr-notice-text",
    message
  );
}

/* ============================================================
   RESULT COUNTERS
   ============================================================ */


function setResultCounts({
  imported = 0,
  skipped = 0,
  failed = 0,
  unmatched = 0
} = {}) {

  const isMatching = state.type === "matching";

  const firstLabel = document.querySelector(
    ".vpr-result-success .vpr-result-label"
  );

  const secondLabel = document.querySelector(
    ".vpr-result-skipped .vpr-result-label"
  );

  const thirdLabel = document.querySelector(
    ".vpr-result-failed .vpr-result-label"
  );

  if (firstLabel) {
firstLabel.textContent = isMatching
  ? "Matched"
  : state.type === "geolocation"
    ? "Released"
    : "Imported";
  }

  if (secondLabel) {
    secondLabel.textContent = isMatching
      ? "Partial"
      : "Skipped";
  }

  if (thirdLabel) {
    thirdLabel.textContent = isMatching
      ? "Unmatched"
      : "Failed";
  }

  setText(
    "vpr-result-imported",
    safeInteger(imported)
  );

  setText(
    "vpr-result-skipped",
    safeInteger(skipped)
  );

  setText(
    "vpr-result-failed",
    safeInteger(
      isMatching ? unmatched : failed
    )
  );
}

/* ============================================================
   IMPORT DETAILS — RENDER SKIPPED AND FAILED ORDERS
   ============================================================ */


function renderImportDetails(details = []) {
  const wrapper = byId("vpr-import-details");
  const list = byId("vpr-details-list");
  const count = byId("vpr-details-count");
  const panel = byId("vpr-details-panel");

  if (!wrapper || !list || !count || !panel) return;

  const isMatching = state.type === "matching";

  const allowedStatuses = isMatching
    ? ["partial", "unmatched", "failed"]
    : ["skipped", "failed"];

  const items = (Array.isArray(details) ? details : [])
    .filter(item =>
      item &&
      allowedStatuses.includes(
        String(item.status || "").toLowerCase()
      )
    );

  list.replaceChildren();

  if (!items.length) {
    wrapper.hidden = true;
    panel.open = false;
    return;
  }

  wrapper.hidden = false;

  const countStatus = status =>
    items.filter(item =>
      String(item.status).toLowerCase() === status
    ).length;

  if (isMatching) {
    count.textContent =
      `${countStatus("partial")} partial · ` +
      `${countStatus("unmatched")} unmatched · ` +
      `${countStatus("failed")} failed`;
  } else {
    count.textContent =
      `${countStatus("skipped")} skipped · ` +
      `${countStatus("failed")} failed`;
  }

  const fragment = document.createDocumentFragment();

  items.forEach(item => {
    const status = String(item.status).toLowerCase();

    const row = document.createElement("div");
    row.className = "vpr-detail-row";

    const info = document.createElement("div");
    info.className = "vpr-detail-info";

    const order = document.createElement("div");
    order.className = "vpr-detail-order";
    order.textContent =
      item.orderNumber || item.reference || "Unknown order";

    const reason = document.createElement("div");
    reason.className = "vpr-detail-reason";
    reason.textContent =
      item.reason || "No further details available.";

    const badge = document.createElement("span");
    badge.className = `vpr-detail-badge ${status}`;

    const labels = {
      skipped: "Skipped",
      failed: "Failed",
      partial: "Partial",
      unmatched: "Unmatched"
    };

    badge.textContent = labels[status] || status;

    info.append(order, reason);
    row.append(info, badge);
    fragment.appendChild(row);
  });

  list.appendChild(fragment);

  // Keep details collapsed until the user opens them.
  panel.open = false;
}

/* ============================================================
   END OF PART 2BB

   PART 3 CONTINUES BELOW.

   Do not close the main IIFE yet.
   Do not add })();

   ============================================================ */


/* ============================================================
   VEYNOR IMPORT PROGRESS 2.0
   PART 3 — DYNAMIC CONTROL AND PUBLIC API

   Requires PART 1, 2A, 2BA and 2BB.
   ============================================================ */

/* ============================================================
   PAGE LEAVE PROTECTION
   ============================================================ */

function handleBeforeUnload(event) {
  if (!state.active) return;

  event.preventDefault();
  event.returnValue = "";
}

function enableLeaveProtection() {
  if (beforeUnloadAttached) return;

  window.addEventListener(
    "beforeunload",
    handleBeforeUnload
  );

  beforeUnloadAttached = true;
}

function disableLeaveProtection() {
  if (!beforeUnloadAttached) return;

  window.removeEventListener(
    "beforeunload",
    handleBeforeUnload
  );

  beforeUnloadAttached = false;
}

/* ============================================================
   FOCUS AND SCROLL MANAGEMENT
   ============================================================ */

function focusModal() {
  const modal = byId(IDS.modal);

  if (modal) {
    modal.focus({ preventScroll: true });
  }
}

function restoreFocus() {
  const previous = state.previousFocus;

  if (
    previous &&
    typeof previous.focus === "function" &&
    previous.isConnected
  ) {
    previous.focus({ preventScroll: true });
  }

  state.previousFocus = null;
}

function lockPageScroll() {
  state.previousBodyOverflow =
    document.body.style.overflow;

  document.body.style.overflow = "hidden";
}

function unlockPageScroll() {
  document.body.style.overflow =
    state.previousBodyOverflow ?? "";

  state.previousBodyOverflow = null;
}

/* ============================================================
   ETA TIMER
   ============================================================ */

function updateEtaDisplay() {
  if (!state.active) return;

  const remaining = getEstimatedSeconds();

  if (remaining === null) {
    setText(
      IDS.eta,
      "Estimating remaining time..."
    );
    return;
  }

  setText(
    IDS.eta,
    `About ${formatDuration(remaining)} remaining`
  );
}

function startEtaTimer() {
  stopEtaTimer();

  etaTimer = window.setInterval(
    updateEtaDisplay,
    1000
  );
}

function stopEtaTimer() {
  if (etaTimer !== null) {
    window.clearInterval(etaTimer);
    etaTimer = null;
  }
}

/* ============================================================
   RESET MODAL FOR NEW IMPORT
   ============================================================ */

function resetModal() {
  const modal = byId(IDS.modal);
  const results = byId(IDS.results);
  const closeButton = byId(IDS.close);

  modal?.classList.remove(
    "vpr-completed",
    "vpr-failed"
  );

  if (results) {
    results.hidden = true;
  }

  if (closeButton) {
    closeButton.hidden = true;
    closeButton.disabled = true;
  }

  resetSteps();
  setProgressValue(0);
  setResultCounts();

  state.details = [];
  renderImportDetails([]);

  setText(
    IDS.headerStatus,
    "Import in progress"
  );

  setText(
    IDS.reference,
    "Preparing orders..."
  );

  setText(
    IDS.eta,
    "Estimating remaining time..."
  );

  setNotice(
    "Please keep this window open",
    "Your orders are being processed. " +
    "The results will appear automatically " +
    "when finished."
  );
}

/* ============================================================
   OPEN IMPORT MODAL
   ============================================================ */


function open(options = {}) {
  if (state.active) {
    console.warn(
      "[VeynorProgress] Process already active."
    );
    return false;
  }

  if (!document.body) {
    throw new Error(
      "VeynorProgress requires document.body."
    );
  }

  createModal();

  const config = {
    ...DEFAULTS,
    ...options
  };

  state.total = safeInteger(config.total);
  state.completed = 0;
  state.imported = 0;
  state.skipped = 0;
  state.failed = 0;
  state.reference = "";

  state.type =
    Object.prototype.hasOwnProperty.call(
      PROCESS_CONFIGS,
      config.type
    )
      ? config.type
      : DEFAULTS.type;

state.phase = [
  "labels",
  "deliveryNotes",
  "matching",
  "geolocation"
].includes(state.type) ? 1 : 3;

  const processConfig = getProcessConfig();

  state.title = String(
    options.title ?? processConfig.title
  );

  state.description = String(
    options.description ?? processConfig.description
  );

  state.startedAt = Date.now();
  state.finishedAt = null;

  state.errors = [];
  state.details = [];
  state.active = true;
  state.finished = false;
  state.status = "running";

  state.previousFocus = document.activeElement;

  resetModal();

  // Set the active process on the popup.
  const modalElement = byId(IDS.modal);

  if (modalElement) {
    modalElement.dataset.process = state.type;
  }

  // Apply the selected process configuration.
  const activeConfig = getProcessConfig();

  const eyebrow = root.querySelector(".vpr-eyebrow");

  if (eyebrow) {
    eyebrow.textContent = activeConfig.eyebrow;
  }

  const stepsContainer = byId(IDS.steps);

  if (stepsContainer) {
    stepsContainer.innerHTML = createSteps();
  }

  const featuresContainer =
    root.querySelector(".vpr-features");

  if (featuresContainer) {
    featuresContainer.outerHTML = createFeatures();
  }

  const resultLabel =
    root.querySelector(
      ".vpr-result-success .vpr-result-label"
    );

  if (resultLabel) {
    resultLabel.textContent = activeConfig.resultLabel;
  }

  const detailsHeading =
    root.querySelector(".vpr-details-heading span");

  if (detailsHeading) {
    detailsHeading.textContent = activeConfig.detailsTitle;
  }

  setText(IDS.headerStatus, activeConfig.status);

  const progressTrack =
    root.querySelector(".vpr-progress-track");

  if (progressTrack) {
    progressTrack.setAttribute(
      "aria-label",
      `${activeConfig.eyebrow.toLowerCase()} progress`
    );
  }

  const processType =
    Object.prototype.hasOwnProperty.call(
      ASSETS.backgrounds,
      state.type
    )
      ? state.type
      : "orders";

  const sceneImage = byId(IDS.scene)
    ?.querySelector(".vpr-scene-image");

  if (sceneImage) {
    sceneImage.src =
      ASSETS.backgrounds[processType];
  }

  setText(IDS.title, state.title);
  setText(IDS.description, state.description);

  setText(
    IDS.counter,
    `Preparing ${state.total} ${state.type}...`
  );

if ([
  "labels",
  "deliveryNotes",
  "matching",
  "geolocation"
].includes(state.type)) {
    setStep(1, "active");
    setStep(2, "pending");
    setStep(3, "pending");
    setStep(4, "pending");
  } else {
    setStep(1, "done");
    setStep(2, "done");
    setStep(3, "active");
    setStep(4, "pending");
  }

  root.classList.add("vpr-open");

  lockPageScroll();
  enableLeaveProtection();
  startEtaTimer();
  focusModal();

  return true;
}

/* ============================================================
   UPDATE PROGRESS

   Call after each processed order.

   Example:
   VeynorProgress.update({
     completed: 13,
     total: 20,
     reference: "VEYTEST-013",
     imported: 12,
     skipped: 1,
     failed: 0
   });
   ============================================================ */

function update(options = {}) {
  if (!state.active) return false;

  if (options.total !== undefined) {
    state.total = safeInteger(options.total);
  }

  if (options.completed !== undefined) {
    state.completed = clamp(
      safeInteger(options.completed),
      0,
      state.total
    );
  }

  if (options.imported !== undefined) {
    state.imported = safeInteger(options.imported);
  }

  if (options.skipped !== undefined) {
    state.skipped = safeInteger(options.skipped);
  }

  if (options.failed !== undefined) {
    state.failed = safeInteger(options.failed);
  }

  if (options.reference !== undefined) {
    state.reference = String(
      options.reference || ""
    );
  }


  if (["labels", "deliveryNotes", "geolocation"].includes(state.type)) {
    if (options.phase !== undefined) {
      state.phase = clamp(
        Math.floor(Number(options.phase) || 1),
        1,
        4
      );
    }

    for (let i = 1; i <= 4; i++) {
      setStep(
        i,
        i < state.phase
          ? "done"
          : i === state.phase
            ? "active"
            : "pending"
      );
    }
  }

  const percentage =
    ["labels", "deliveryNotes", "geolocation"].includes(state.type)
      ? Math.min(90, Math.round(getPercentage() * 0.9))
      : getPercentage();

  setProgressValue(percentage);



setText(
  IDS.counter,
  state.type === "geolocation"
    ? `Processing location ${state.completed} of ${state.total}`
    : ["labels", "deliveryNotes"].includes(state.type)
      ? `Processing order ${state.completed} of ${state.total}`
      : `Importing order ${state.completed} of ${state.total}`
);


  if (state.reference) {
    setText(
      IDS.reference,
      `Last processed: ${state.reference}`
    );
  } else {
    setText(
      IDS.reference,
      "Processing orders..."
    );
  }

  updateEtaDisplay();


  // Order Import uses automatic finalization.
  // Label generation uses explicit process phases.
  if (
    !["labels", "deliveryNotes", "geolocation"].includes(state.type) &&
    state.total > 0 &&
    state.completed >= state.total
  ) {
    setStep(3, "done");
    setStep(4, "active");
  }


  return true;
}



function complete(options = {}) {
  if (!state.active) return false;

  state.imported = safeInteger(
    options.imported ?? state.imported
  );
  state.skipped = safeInteger(
    options.skipped ?? state.skipped
  );
  state.failed = safeInteger(
    options.failed ?? state.failed
  );

  state.completed = state.total;
  state.active = false;
  state.finished = true;
  state.finishedAt = Date.now();

  stopEtaTimer();
  disableLeaveProtection();

  const modal = byId(IDS.modal);
  const results = byId(IDS.results);
  const closeButton = byId(IDS.close);

  const allSkipped =
    state.imported === 0 &&
    state.skipped > 0 &&
    state.failed === 0;

  const hasIssues =
    state.failed > 0 ||
    state.skipped > 0;

  const emptyImport =
    state.imported === 0 &&
    state.skipped === 0 &&
    state.failed === 0;

  state.status = allSkipped
    ? "completed_skipped"
    : hasIssues
      ? "completed_with_issues"
      : emptyImport
        ? "completed_empty"
        : "completed";

  modal?.classList.remove(
    "vpr-completed",
    "vpr-failed"
  );

  setProgressValue(100);

  setText(
    IDS.counter,
    `Processed ${state.total} of ${state.total} orders`
  );

  setText(
    IDS.eta,
    `Completed in ${formatDuration(
      (state.finishedAt - state.startedAt) / 1000
    )}`
  );


  setResultCounts({
    imported: state.imported,
    skipped: state.skipped,
    failed: state.failed,
    unmatched: safeInteger(options.unmatched ?? 0)
  });
;

  state.details = Array.isArray(options.details)
    ? options.details
    : [];

  renderImportDetails(state.details);

  if (results) {
    results.hidden = false;
  }

  for (let i = 1; i <= 4; i++) {
    setStep(i, "done");
  }


  // GEOLOCATION & PLANNING RESULTS

if (state.type === "geolocation") {

  // Show the final number of processed orders.
  setText(
    IDS.counter,
    `Processed ${state.total} of ${state.total} orders`
  );

  const released = state.imported;
  const skipped = state.skipped;
  const failed = state.failed;


    const needsAttention = skipped > 0 || failed > 0;

    state.status = needsAttention
      ? "completed_with_issues"
      : "completed";

    modal?.classList.add(
      needsAttention ? "vpr-failed" : "vpr-completed"
    );

    setText(
      IDS.title,
      needsAttention
        ? "Geolocation & planning completed"
        : "Orders released to planning"
    );

    setText(
      IDS.headerStatus,
      needsAttention
        ? "Review release results"
        : "Planning release complete"
    );

    setText(
      IDS.description,
      needsAttention
        ? "Processing has finished. Some orders could not " +
          "be released to planning. Review the details below."
        : "All eligible orders have been successfully " +
          "released to planning."
    );

    setNotice(
      needsAttention
        ? "Some orders require attention"
        : "Planning release completed successfully",
      `${released} released, ${skipped} skipped ` +
      `and ${failed} failed.`
    );

    if (closeButton) {
      closeButton.textContent = "Close & View Results";
      closeButton.hidden = false;
      closeButton.disabled = false;
      closeButton.focus();
    }

    return true;
  }


  // MATCHING RESULTS
  if (state.type === "matching") {
    const matched = state.imported;
    const partial = state.skipped;
    const unmatched = safeInteger(
      options.unmatched ?? 0
    );
    const failed = state.failed;

    const needsAttention =
      partial > 0 ||
      unmatched > 0 ||
      failed > 0;

    state.status = needsAttention
      ? "completed_with_issues"
      : "completed";

    modal?.classList.add(
      needsAttention
        ? "vpr-failed"
        : "vpr-completed"
    );

    setText(
      IDS.title,
      needsAttention
        ? "Order matching completed"
        : "Orders matched successfully"
    );

    setText(
      IDS.headerStatus,
      needsAttention
        ? "Review match results"
        : "Matching complete"
    );

    setText(
      IDS.description,
      needsAttention
        ? "Matching has finished. Review the orders " +
          "that could not be fully matched."
        : "All processed orders have been matched successfully."
    );

    setNotice(
      needsAttention
        ? "Some orders require attention"
        : "Matching completed successfully",
      `${matched} fully matched, ${partial} partially matched, ` +
      `${unmatched} unmatched and ${failed} failed.`
    );

    if (closeButton) {
      closeButton.textContent = "Close & View Results";
      closeButton.hidden = false;
      closeButton.disabled = false;
      closeButton.focus();
    }

    return true;
  }

  // LABELS AND DELIVERY NOTES
  if (["labels", "deliveryNotes", "geolocation"].includes(state.type)) {
    const generated = state.imported;
    const isNotes = state.type === "deliveryNotes";

    const documentName = isNotes
      ? "delivery notes"
      : "delivery labels";

    const documentTitle = isNotes
      ? "Delivery notes"
      : "Delivery labels";

    setText(
      IDS.counter,
      `Processed ${state.total} of ${state.total} orders`
    );

    if (state.failed > 0 || state.skipped > 0) {
      state.status = "completed_with_issues";
      modal?.classList.add("vpr-failed");

      setText(
        IDS.title,
        `${documentTitle} generated with issues`
      );

      setText(IDS.headerStatus, "Review required");

      setText(
        IDS.description,
        `Generation of ${documentName} has finished. ` +
        "Review the results below."
      );

      setNotice(
        `Some ${documentName} need attention`,
        `${generated} generated, ${state.skipped} skipped ` +
        `and ${state.failed} failed.`
      );

    } else if (generated === 0) {
      state.status = "completed_empty";

      setText(
        IDS.title,
        `No ${documentName} generated`
      );

      setText(
        IDS.headerStatus,
        `No ${documentName} generated`
      );

      setNotice(
        `No ${documentName} generated`,
        `No ${documentName} were generated.`
      );

    } else {
      state.status = "completed";
      modal?.classList.add("vpr-completed");

      setText(
        IDS.title,
        `${documentTitle} generated successfully`
      );

      setText(
        IDS.headerStatus,
        isNotes
          ? "Documents complete"
          : "Labels complete"
      );

      setText(
        IDS.description,
        `Your ${documentName} have been generated successfully.`
      );

      setNotice(
        `${documentTitle} complete`,
        `${generated} orders processed successfully.`
      );
    }

    if (closeButton) {
      closeButton.textContent = "Close & View Results";
      closeButton.hidden = false;
      closeButton.disabled = false;
      closeButton.focus();
    }

    return true;
  }

  // ORDER IMPORT
  if (allSkipped) {
    setText(
      IDS.title,
      "No new orders imported"
    );

    setText(
      IDS.description,
      "All orders were processed, but none were imported. " +
      "Review the skipped orders to understand why."
    );

    setText(
      IDS.headerStatus,
      "No new orders"
    );

    setNotice(
      "All orders were skipped",
      `${state.skipped} orders were skipped. ` +
      "No new orders were created."
    );

  } else if (hasIssues) {
    modal?.classList.add("vpr-failed");

    setText(
      IDS.title,
      "Import completed with issues"
    );

    setText(
      IDS.description,
      "Processing has finished. Some orders were skipped " +
      "or could not be imported. Review the results."
    );

    setText(
      IDS.headerStatus,
      "Review required"
    );

    setNotice(
      "Some orders need attention",
      `${state.imported} imported, ` +
      `${state.skipped} skipped and ` +
      `${state.failed} failed.`
    );

  } else if (emptyImport) {
    setText(
      IDS.title,
      "No orders to import"
    );

    setText(
      IDS.description,
      "Processing finished, but no orders were available."
    );

    setText(
      IDS.headerStatus,
      "Nothing to import"
    );

    setNotice(
      "No orders processed",
      "There were no orders to import."
    );

  } else {
    modal?.classList.add("vpr-completed");

    setText(
      IDS.title,
      "Import completed successfully"
    );

    setText(
      IDS.description,
      "All orders have been imported successfully. " +
      "Your import results are available below."
    );

    setText(
      IDS.headerStatus,
      "Import complete"
    );

    setNotice(
      "Your import is complete",
      `${state.imported} orders imported successfully. ` +
      "You can now review the results."
    );
  }

  if (closeButton) {
    closeButton.hidden = false;
    closeButton.disabled = false;
    closeButton.focus();
  }

  return true;
}

/* ============================================================
   FAIL IMPORT

   For fatal interruption of the import process.
   ============================================================ */

function fail(options = {}) {
  if (!state.active) return false;




  const message = String(
    options.message ||
    (state.type === "matching"
      ? "Order matching could not be completed."
      : state.type === "deliveryNotes"
        ? "Delivery note generation could not be completed."
        : state.type === "labels"
          ? "Delivery label generation could not be completed."
          : "The import could not be completed.")
  );

  state.active = false;
  state.finished = true;
  state.status = "failed";
  state.finishedAt = Date.now();

  state.errors.push(message);

  stopEtaTimer();
  disableLeaveProtection();

  const modal = byId(IDS.modal);
  const results = byId(IDS.results);
  const closeButton = byId(IDS.close);

  modal?.classList.add("vpr-failed");


const isGeolocation =
  state.type === "geolocation";

  const interruptedTitle =
    state.type === "matching"
      ? "Order matching interrupted"
      : state.type === "deliveryNotes"
        ? "Delivery note generation interrupted"
        : state.type === "labels"
          ? "Label generation interrupted"
          : "Import interrupted";



setText(
  IDS.title,
  isGeolocation
    ? "Geolocation & planning interrupted"
    : interruptedTitle
);

setText(
  IDS.headerStatus,
  isGeolocation
    ? "Geolocation interrupted"
    : interruptedTitle
);


  setText(
    IDS.counter,
    `Processed ${state.completed} of ${state.total} orders`
  );

  setText(
    IDS.reference,
    message
  );

  setText(
    IDS.eta,
    "Processing stopped"
  );

  setProgressValue(getPercentage());

  setResultCounts({
    imported: state.imported,
    skipped: state.skipped,
    failed: state.failed
  });

  if (results) {
    results.hidden = false;
  }

  setStep(1, "done");
  setStep(2, "done");
  setStep(3, "error");
  setStep(4, "pending");

if (state.type === "geolocation") {
  setNotice(
    "Geolocation & planning requires attention",
    "The process stopped before all orders were completed. " +
    "Some locations or planning releases may already have " +
    "been saved. Review the results before trying again."
  );

} else

  if (state.type === "matching") {
    setNotice(
      "Order matching requires attention",
      "The matching process stopped before completion. " +
      "Some stock allocations may already have been saved. " +
      "Review the results before running matching again."
    );

  } else

  if (state.type === "deliveryNotes") {
    setNotice(
      "Delivery note generation requires attention",
      "The process stopped before all delivery notes were completed. " +
      "Some documents may already have been saved."
    );

  } else if (state.type === "labels") {
    setNotice(
      "Label generation requires attention",
      "The process stopped before all labels were completed. " +
      "Some documents may already have been saved."
    );

  } else {
    setNotice(
      "Import requires attention",
      "The import stopped before all orders were processed. " +
      "Some orders may already have been saved. " +
      "Review the results before attempting another import."
    );
  }



  if (closeButton) {
    closeButton.hidden = false;
    closeButton.disabled = false;
    closeButton.focus();
  }

  return true;
}

/* ============================================================
   CLOSE MODAL
   ============================================================ */

function close() {
  if (state.active) return false;
  if (!root) return false;

  root.classList.remove("vpr-open");

  stopEtaTimer();
  disableLeaveProtection();
  unlockPageScroll();
  restoreFocus();

  return true;
}

/* ============================================================
   GET STATUS
   ============================================================ */

function getStatus() {
  return {
    version: VERSION,
    active: state.active,
    finished: state.finished,
    status: state.status,

    total: state.total,
    completed: state.completed,

    imported: state.imported,
    skipped: state.skipped,
    failed: state.failed,

    percentage: getPercentage(),
    reference: state.reference,

    startedAt: state.startedAt,
    finishedAt: state.finishedAt,

    errors: [...state.errors]
  };
}

/* ============================================================
   PUBLIC API
   ============================================================ */

window.VeynorProgress = Object.freeze({
  version: VERSION,

  open,
  update,
  complete,
  fail,
  close,
  getStatus
});

/* ============================================================
   MODULE READY
   ============================================================ */

console.info(
  `[VeynorProgress] v${VERSION} ready.`
);

})();






