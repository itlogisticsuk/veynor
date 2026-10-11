
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
   VeynorImportProgress.open()
   VeynorImportProgress.update()
   VeynorImportProgress.complete()
   VeynorImportProgress.fail()
   VeynorImportProgress.close()
   VeynorImportProgress.getStatus()

   IMPORTANT:
   This module does not write to Supabase.
   All database operations remain in order-import.js.
   ============================================================ */

(function () {
  "use strict";

  if (window.VeynorImportProgress) {
    console.warn(
      "[VeynorImportProgress] Module already loaded."
    );
    return;
  }

  const VERSION = "2.0.0";

  /* ============================================================
     ASSET CONFIGURATION
     ============================================================ */


const ASSETS = Object.freeze({
  background:
    "/assets/popup/veynor-import-background.png",

  header:
    "/assets/popup/veynor-import-header.png",

  logoDark:
    "/assets/branding/veynor-logo.png",

  logoLight:
    "/assets/branding/veynor-logo-trans.png"
});


  /* ============================================================
     ELEMENT IDS
     ============================================================ */

  const IDS = Object.freeze({
    overlay: "vip-overlay",
    modal: "vip-modal",

    title: "vip-title",
    description: "vip-description",

    counter: "vip-counter",
    percentage: "vip-percentage",
    progress: "vip-progress",

    reference: "vip-reference",
    eta: "vip-eta",

    scene: "vip-scene",
    lightTrails: "vip-light-trails",

    steps: "vip-steps",

    results: "vip-results",
    notice: "vip-notice",
    close: "vip-close",

    headerStatus: "vip-header-status",
    liveStatus: "vip-live-status"
  });

  /* ============================================================
     DEFAULT CONFIGURATION
     ============================================================ */

  const DEFAULTS = Object.freeze({
    title: "Processing your orders",

    description:
      "Please keep this window open while Veynor " +
      "imports your orders. You can monitor the " +
      "progress in real time below.",

    total: 0,
    type: "orders"
  });

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

    type: DEFAULTS.type,
    title: DEFAULTS.title,
    description: DEFAULTS.description,

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

  const PROCESS_STEPS = Object.freeze([
    {
      id: 1,
      title: "Reading file",
      subtitle: "Completed"
    },
    {
      id: 2,
      title: "Preparing orders",
      subtitle: "Completed"
    },
    {
      id: 3,
      title: "Importing into Veynor",
      subtitle: "In progress"
    },
    {
      id: 4,
      title: "Finalizing",
      subtitle: "Pending"
    }
  ]);

  /* ============================================================
     PROCESS STEP HTML
     ============================================================ */

  function createSteps() {
    return PROCESS_STEPS.map(step => `
      <div
        class="vip-step"
        id="vip-step-${step.id}"
        data-step="${step.id}"
      >
        <div class="vip-step-indicator">
          <span
            class="vip-step-circle"
            id="vip-step-circle-${step.id}"
          >
            ${step.id}
          </span>
        </div>

        <div class="vip-step-content">
          <div class="vip-step-title">
            ${step.title}
          </div>

          <div
            class="vip-step-subtitle"
            id="vip-step-subtitle-${step.id}"
          >
            ${step.subtitle}
          </div>
        </div>
      </div>
    `).join("");
  }

  /* ============================================================
     FEATURE INDICATORS

     Decorative feature labels.
     They do not represent database verification.
     ============================================================ */

  function createFeatures() {
    return `
      <div class="vip-features">

        <div class="vip-feature">
          <div class="vip-feature-icon">
            ${icon("shield", 25)}
          </div>
          <span>Secure<br>Import</span>
        </div>

        <div class="vip-feature">
          <div class="vip-feature-icon">
            ${icon("database", 25)}
          </div>
          <span>Live<br>Processing</span>
        </div>

        <div class="vip-feature">
          <div class="vip-feature-icon">
            ${icon("check", 25)}
          </div>
          <span>Automatic<br>Validation</span>
        </div>

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
        class="vip-results"
        aria-live="polite"
        hidden
      >

        <div class="vip-result-card vip-result-success">
          <div
            id="vip-result-imported"
            class="vip-result-value"
          >0</div>
          <div class="vip-result-label">
            Imported
          </div>
        </div>

        <div class="vip-result-card vip-result-skipped">
          <div
            id="vip-result-skipped"
            class="vip-result-value"
          >0</div>
          <div class="vip-result-label">
            Skipped
          </div>
        </div>

        <div class="vip-result-card vip-result-failed">
          <div
            id="vip-result-failed"
            class="vip-result-value"
          >0</div>
          <div class="vip-result-label">
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
        class="vip-modal"
        role="document"
        tabindex="-1"
      >

        <!-- HEADER -->


<div class="vip-header vip-header-image">

  <!-- New Veynor header artwork -->

  <div
    class="vip-header-art"
    aria-label="Veynor - Supply Chain Made Simple"
  ></div>

  <!-- Dynamic import status -->

  <div class="vip-header-right">

    <span
      id="${IDS.headerStatus}"
      class="vip-header-status"
      role="status"
    >
      Import in progress
    </span>

  </div>

</div>

        <!-- INTRODUCTION -->

        <div class="vip-intro">

          <div class="vip-intro-text">

            <div class="vip-eyebrow">
              IMPORTING ORDERS
            </div>

            <h2
              id="${IDS.title}"
              class="vip-title"
            >
              Processing your orders
            </h2>

            <p
              id="${IDS.description}"
              class="vip-description"
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
          class="vip-scene"
          aria-hidden="true"
        >

          <img
            src="${ASSETS.background}"
            alt=""
            class="vip-scene-image"
            draggable="false"
          />

          <!-- Animated light trails.
               Created with CSS in part 2. -->

          <div
            id="${IDS.lightTrails}"
            class="vip-light-trails"
          >
            <span class="vip-light-trail vip-trail-one"></span>
            <span class="vip-light-trail vip-trail-two"></span>
            <span class="vip-light-trail vip-trail-three"></span>
          </div>

          <div class="vip-scene-shine"></div>

        </div>

        <!-- PROGRESS AREA -->

        <div class="vip-progress-area">

          <div class="vip-progress-heading">

            <div
              id="${IDS.counter}"
              class="vip-counter"
            >
              Preparing import...
            </div>

            <div
              id="${IDS.percentage}"
              class="vip-percentage"
            >
              0%
            </div>

          </div>

          <div
            class="vip-progress-track"
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="0"
          >
            <div
              id="${IDS.progress}"
              class="vip-progress-fill"
            ></div>
          </div>

          <div class="vip-progress-meta">

            <div
              id="${IDS.reference}"
              class="vip-reference"
              aria-live="polite"
            >
              Preparing orders...
            </div>

            <div class="vip-eta-wrap">
              ${icon("clock", 17)}

              <span
                id="${IDS.eta}"
                class="vip-eta"
              >
                Estimating remaining time...
              </span>
            </div>

          </div>

        </div>

        <!-- HORIZONTAL PROCESS TRACKER -->

        <div
          id="${IDS.steps}"
          class="vip-steps"
        >
          ${createSteps()}
        </div>

        <!-- RESULTS -->

        ${createResults()}

        <!-- IMPORT DETAILS -->

        <div
          id="vip-import-details"
          class="vip-import-details"
          hidden
        >
          <details id="vip-details-panel">


<summary class="vip-details-toggle">
  <span class="vip-details-heading">
    <span>Import Details</span>
    <span class="vip-details-arrow" aria-hidden="true"></span>
  </span>

  <span
    id="vip-details-count"
    class="vip-details-count"
  >0 orders need attention</span>
</summary>


            <div class="vip-details-content">
              <div
                id="vip-details-list"
                class="vip-details-list"
              ></div>
            </div>

          </details>
        </div>

        <!-- INFORMATION NOTICE -->

        <div
          id="${IDS.notice}"
          class="vip-notice"
          role="status"
        >

          <div class="vip-notice-icon">
            ${icon("info", 23)}
          </div>

          <div class="vip-notice-content">

            <strong id="vip-notice-title">
              Please keep this window open
            </strong>

            <span id="vip-notice-text">
              Your orders are being processed securely.
              The results will appear automatically
              when finished.
            </span>

          </div>

        </div>

        <!-- CLOSE AFTER COMPLETION -->

        <button
          id="${IDS.close}"
          class="vip-close-button"
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

  if (document.getElementById("vip-v2-styles")) {
    stylesInjected = true;
    return;
  }

  const style = document.createElement("style");
  style.id = "vip-v2-styles";

  style.textContent = `

    /* ========================================================
       DESIGN VARIABLES
       ======================================================== */

    :root {
      --vip-navy: #071b43;
      --vip-blue: #0864f9;
      --vip-blue-dark: #064bc7;
      --vip-blue-bright: #3c9cff;

      --vip-text: #10234b;
      --vip-muted: #58709a;
      --vip-border: #e2eaf6;

      --vip-success: #159568;
      --vip-warning: #d99527;
      --vip-danger: #dc4756;
    }

    /* ========================================================
       OVERLAY
       ======================================================== */

    .vip-overlay {
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

    .vip-overlay.vip-open {
      display: flex;
      animation: vip-overlay-enter .25s ease both;
    }

    @keyframes vip-overlay-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ========================================================
       MAIN MODAL
       ======================================================== */

    .vip-modal {
      position: relative;

      width: min(900px, 100%);
      max-height: calc(100vh - 48px);

      overflow-x: hidden;
      overflow-y: auto;

      background: #ffffff;
      color: var(--vip-text);

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

      animation: vip-modal-enter .35s
        cubic-bezier(.2,.8,.2,1) both;
    }

    @keyframes vip-modal-enter {
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

    .vip-header {
      min-height: 91px;

      display: flex;
      align-items: center;
      justify-content: space-between;

      gap: 20px;
      padding: 19px 42px 12px;
    }

    .vip-brand {
      display: flex;
      align-items: center;

      width: 150px;
      height: 65px;

      overflow: hidden;
    }

    .vip-brand-image {
      display: block;

      width: 100%;
      height: 100%;

      object-fit: contain;
      object-position: left center;
    }

    .vip-header-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;

      gap: 20px;
      min-width: 0;
    }

    .vip-tagline {
      color: #45638e;

      font-size: 9px;
      line-height: 1.7;

      font-weight: 800;
      letter-spacing: 3px;

      white-space: nowrap;
    }

    .vip-tagline span {
      display: block;
    }

    .vip-header-divider {
      width: 1px;
      height: 27px;
      background: #dbe5f4;
    }

    .vip-header-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;

      color: #42618d;

      font-size: 10px;
      font-weight: 700;

      white-space: nowrap;
    }

    .vip-header-status::before {
      content: "";

      width: 7px;
      height: 7px;

      border-radius: 50%;
      background: var(--vip-blue);

      box-shadow:
        0 0 0 4px rgba(8,100,249,.10);

      animation: vip-status-pulse 2s
        ease-in-out infinite;
    }

    @keyframes vip-status-pulse {
      0%,100% { opacity: 1; }
      50% { opacity: .45; }
    }

    /* ========================================================
       INTRODUCTION
       ======================================================== */

    .vip-intro {
      display: flex;
      align-items: center;
      justify-content: space-between;

      gap: 24px;
      padding: 15px 42px 27px;
    }

    .vip-intro-text {
      flex: 1;
      min-width: 0;
    }

    .vip-eyebrow {
      margin-bottom: 10px;

      color: var(--vip-blue);

      font-size: 10px;
      font-weight: 850;

      letter-spacing: 2.8px;
    }

    .vip-title {
      margin: 0 0 11px;

      color: var(--vip-navy);

      font-size: clamp(25px,3vw,34px);
      line-height: 1.18;

      font-weight: 850;
      letter-spacing: -1.1px;
    }

    .vip-description {
      max-width: 470px;
      margin: 0;

      color: var(--vip-muted);

      font-size: 13px;
      line-height: 1.65;
      font-weight: 450;
    }

    /* ========================================================
       FEATURE INDICATORS
       ======================================================== */

    .vip-features {
      display: flex;
      align-items: stretch;
      flex-shrink: 0;
      gap: 0;
    }

    .vip-feature {
      width: 93px;

      display: flex;
      flex-direction: column;
      align-items: center;

      gap: 9px;
      padding: 8px 10px;

      border-left: 1px solid #e7edf7;

      text-align: center;

      color: var(--vip-navy);

      font-size: 10px;
      line-height: 1.35;
      font-weight: 750;
    }

    .vip-feature:first-child {
      border-left: 0;
    }

    .vip-feature-icon {
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

      color: var(--vip-blue);
    }

    .vip-feature svg {
      display: block;
    }

    /* ========================================================
       REALISTIC TRANSPORT IMAGE
       ======================================================== */

    .vip-scene {
      position: relative;

      width: 100%;
      height: 255px;

      overflow: hidden;
      isolation: isolate;

      background: #0c2446;
    }

    .vip-scene-image {
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

    .vip-scene::after {
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

    .vip-light-trails {
      position: absolute;
      inset: 0;

      z-index: 2;

      overflow: hidden;
      pointer-events: none;

      mix-blend-mode: screen;
    }

    .vip-light-trail {
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

      animation: vip-data-travel 5.5s
        linear infinite;
    }

    .vip-trail-one {
      top: 68%;
      animation-delay: 0s;
    }

    .vip-trail-two {
      top: 73%;
      height: 2px;
      animation-delay: 1.4s;
      animation-duration: 6.3s;
    }

    .vip-trail-three {
      top: 78%;
      height: 2px;
      animation-delay: 3s;
      animation-duration: 7s;
    }

    @keyframes vip-data-travel {
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

    .vip-scene-shine {
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

      animation: vip-warehouse-glow 6s
        ease-in-out infinite;
    }

    @keyframes vip-warehouse-glow {
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

    .vip-progress-area {
      padding: 27px 42px 21px;
    }

    .vip-progress-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;

      gap: 16px;
      margin-bottom: 13px;
    }

    .vip-counter {
      color: var(--vip-navy);

      font-size: 15px;
      font-weight: 800;
      letter-spacing: -.25px;
    }

    .vip-percentage {
      color: var(--vip-blue);

      font-size: 29px;
      line-height: 1;

      font-weight: 900;
      letter-spacing: -.8px;

      font-variant-numeric: tabular-nums;
    }

    /* ========================================================
       PROGRESS BAR
       ======================================================== */

    .vip-progress-track {
      position: relative;

      width: 100%;
      height: 18px;

      overflow: hidden;

      border-radius: 999px;

      background: #e4ebf6;

      box-shadow:
        inset 0 1px 3px rgba(5,25,60,.08);
    }

    .vip-progress-fill {
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

    .vip-progress-fill::after {
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

      animation: vip-progress-shimmer 2.5s
        linear infinite;
    }

    @keyframes vip-progress-shimmer {
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

    .vip-progress-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;

      flex-wrap: wrap;

      gap: 10px;
      margin-top: 13px;
    }

    .vip-reference {
      color: #49638b;

      font-size: 12px;
      font-weight: 650;

      overflow-wrap: anywhere;
    }

    .vip-eta-wrap {
      display: inline-flex;
      align-items: center;

      gap: 7px;

      color: #49638b;

      font-size: 12px;
      font-weight: 550;

      white-space: nowrap;
    }

    .vip-eta-wrap svg {
      color: var(--vip-blue);
    }

    .vip-eta {
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

    .vip-steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0;
      margin: 8px 42px 25px;
      padding: 19px 0 0;
      border-top: 1px solid #edf1f8;
    }

    .vip-step {
      position: relative;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 9px;
      padding-right: 8px;
      color: #7b8eaa;
    }

    .vip-step-indicator {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
      height: 35px;
    }

    .vip-step:not(:last-child)
    .vip-step-indicator::after {
      content: "";
      position: absolute;
      left: 40px;
      right: 9px;
      top: 16px;
      height: 2px;
      background: #dbe5f3;
      transition: background .35s ease;
    }

    .vip-step-circle {
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

    .vip-step-content {
      padding-right: 8px;
    }

    .vip-step-title {
      color: #526889;
      font-size: 12px;
      line-height: 1.4;
      font-weight: 750;
    }

    .vip-step-subtitle {
      margin-top: 4px;
      color: #8293ad;
      font-size: 11px;
      line-height: 1.4;
    }

    /* COMPLETED STEPS */

    .vip-step.vip-done .vip-step-circle {
      background: var(--vip-blue);
      color: #ffffff;
    }

    .vip-step.vip-done .vip-step-title {
      color: var(--vip-navy);
    }

    .vip-step.vip-done .vip-step-subtitle {
      color: #52709b;
    }

    .vip-step.vip-done:not(:last-child)
    .vip-step-indicator::after {
      background: var(--vip-blue);
    }

    /* ACTIVE STEP */

    .vip-step.vip-active .vip-step-circle {
      background: #e5f0ff;
      color: var(--vip-blue);
      box-shadow: 0 0 0 4px rgba(8,100,249,.09);
      animation: vip-step-pulse 1.8s
        ease-in-out infinite;
    }

    .vip-step.vip-active .vip-step-title {
      color: var(--vip-navy);
    }

    .vip-step.vip-active .vip-step-subtitle {
      color: var(--vip-blue);
      font-weight: 750;
    }

    @keyframes vip-step-pulse {
      0%, 100% {
        box-shadow: 0 0 0 4px rgba(8,100,249,.09);
      }
      50% {
        box-shadow: 0 0 0 9px rgba(8,100,249,.025);
      }
    }

    /* FAILED STEP */

    .vip-step.vip-error .vip-step-circle {
      background: #fff0f1;
      color: var(--vip-danger);
      box-shadow: 0 0 0 4px rgba(220,71,86,.07);
    }

    .vip-step.vip-error .vip-step-title,
    .vip-step.vip-error .vip-step-subtitle {
      color: var(--vip-danger);
    }

    /* ========================================================
       RESULT SUMMARY
       ======================================================== */

    .vip-results {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 0 42px 22px;
    }

    .vip-results[hidden] {
      display: none !important;
    }

    .vip-result-card {
      padding: 17px 15px;
      border: 1px solid var(--vip-border);
      border-radius: 12px;
      background: #f9fbff;
      text-align: center;
    }

    .vip-result-value {
      font-size: 27px;
      font-weight: 850;
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }

    .vip-result-label {
      margin-top: 5px;
      color: var(--vip-muted);
      font-size: 11px;
      font-weight: 700;
    }

    .vip-result-success .vip-result-value {
      color: var(--vip-success);
    }

    .vip-result-skipped .vip-result-value {
      color: var(--vip-warning);
    }

    .vip-result-failed .vip-result-value {
      color: var(--vip-danger);
    }


    /* ========================================================
       IMPORT DETAILS — SKIPPED & FAILED
       ======================================================== */

    .vip-import-details {
      margin: 0 42px 22px;
      border: 1px solid #dce7f7;
      border-radius: 12px;
      background: #f9fbff;
      overflow: hidden;
    }

    .vip-import-details[hidden] {
      display: none !important;
    }

    .vip-details-toggle {
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

    .vip-details-toggle:hover {
      background: #eef5ff;
    }


/* Import Details — visible expand/collapse arrow */

.vip-details-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.vip-details-arrow {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-right: 2px solid #0864f9;
  border-bottom: 2px solid #0864f9;
  transform: rotate(45deg);
  transition: transform 0.2s ease;
  margin-top: -4px;
}

#vip-details-panel[open] .vip-details-arrow {
  transform: rotate(225deg);
  margin-top: 4px;
}

.vip-details-toggle::-webkit-details-marker {
  display: none;
}

.vip-details-toggle {
  list-style: none;
}

.vip-details-toggle::marker {
  content: "";
}


    .vip-details-content {
      padding: 0 16px 16px;
    }

    .vip-details-list {
      max-height: 220px;
      overflow-y: auto;
      border-top: 1px solid #e2eaf6;
    }

    .vip-detail-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 2px;
      border-bottom: 1px solid #edf1f8;
    }

    .vip-detail-row:last-child {
      border-bottom: 0;
    }

    .vip-detail-info {
      min-width: 0;
      flex: 1;
    }

    .vip-detail-order {
      color: #071b43;
      font-size: 12px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .vip-detail-reason {
      margin-top: 4px;
      color: #58709a;
      font-size: 11px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .vip-detail-badge {
      flex-shrink: 0;
      padding: 5px 9px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 800;
    }


.vip-detail-badge.skipped {
  background: transparent;
  color: #64748b;
  border: none;
  border-radius: 0;
  padding: 5px 0;
  font-size: 10px;
  font-weight: 650;
}


    .vip-detail-badge.failed {
      background: #fff0f2;
      color: #d4374a;
    }

    @media (max-width: 850px) {
      .vip-import-details {
        margin: 0 28px 20px;
      }
    }

    @media (max-width: 650px) {
      .vip-import-details {
        margin: 0 20px 20px;
      }

      .vip-details-toggle {
        padding: 13px;
      }

      .vip-details-content {
        padding: 0 12px 12px;
      }
    }


    /* ========================================================
       INFORMATION NOTICE
       ======================================================== */

    .vip-notice {
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

    .vip-notice-icon {
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #e0edff;
      color: var(--vip-blue);
    }

    .vip-notice-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .vip-notice-content strong {
      color: var(--vip-navy);
      font-size: 12px;
      font-weight: 800;
    }

    .vip-notice-content span {
      color: #56719b;
      font-size: 11.5px;
      line-height: 1.55;
    }

    /* ========================================================
       CLOSE BUTTON
       ======================================================== */

    .vip-close-button {
      display: block;
      width: calc(100% - 84px);
      margin: 0 42px 28px;
      padding: 14px 20px;
      border: none;
      border-radius: 11px;
      background: var(--vip-blue);
      color: #ffffff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      transition:
        background .2s ease,
        transform .2s ease;
    }

    .vip-close-button[hidden] {
      display: none !important;
    }

    .vip-close-button:hover:not(:disabled) {
      background: var(--vip-blue-dark);
      transform: translateY(-1px);
    }

    .vip-close-button:focus-visible {
      outline: 3px solid #9fc6ff;
      outline-offset: 3px;
    }

    /* ========================================================
       COMPLETED AND FAILED STATES
       ======================================================== */

    .vip-modal.vip-completed .vip-progress-fill {
      background: linear-gradient(
        90deg,
        #0e9765,
        #43c996
      );
    }

    .vip-modal.vip-failed .vip-progress-fill {
      background: linear-gradient(
        90deg,
        #c93449,
        #ed7a86
      );
    }

    .vip-modal.vip-completed .vip-light-trail,
    .vip-modal.vip-failed .vip-light-trail,
    .vip-modal.vip-completed .vip-scene-shine,
    .vip-modal.vip-failed .vip-scene-shine {
      animation-play-state: paused;
      opacity: 0;
    }

    .vip-modal.vip-completed .vip-header-status::before {
      background: var(--vip-success);
      animation: none;
    }

    .vip-modal.vip-failed .vip-header-status::before {
      background: var(--vip-danger);
      animation: none;
    }

    .vip-modal.vip-failed .vip-notice {
      background: #fff5f6;
      border-color: #f2cbd0;
    }

    .vip-modal.vip-failed .vip-notice-icon {
      background: #ffe5e8;
      color: var(--vip-danger);
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
      .vip-header {
        padding: 18px 28px 10px;
      }

      .vip-intro {
        padding: 15px 28px 25px;
      }

      .vip-progress-area {
        padding: 25px 28px 20px;
      }

      .vip-steps {
        margin: 8px 28px 24px;
      }

      .vip-results {
        margin: 0 28px 20px;
      }

      .vip-notice {
        margin: 0 28px 25px;
      }

      .vip-close-button {
        width: calc(100% - 56px);
        margin: 0 28px 25px;
      }

      .vip-feature {
        width: 78px;
        padding: 8px 6px;
      }

      .vip-scene {
        height: 230px;
      }
    }

    @media (max-width: 650px) {
      .vip-overlay {
        padding: 12px;
      }

      .vip-modal {
        max-height: calc(100vh - 24px);
        border-radius: 13px;
      }

      .vip-header {
        min-height: 68px;
        padding: 12px 20px;
      }

      .vip-brand {
        width: 100px;
        height: 47px;
      }

      .vip-tagline {
        font-size: 7px;
        letter-spacing: 1.5px;
      }

      .vip-header-divider,
      .vip-header-status {
        display: none;
      }

      .vip-intro {
        display: block;
        padding: 14px 20px 20px;
      }

      .vip-title {
        font-size: 25px;
      }

      .vip-description {
        font-size: 12px;
      }

      .vip-features {
        margin-top: 20px;
        justify-content: space-between;
      }

      .vip-feature {
        flex: 1;
        width: auto;
      }

      .vip-feature-icon {
        width: 42px;
        height: 42px;
        border-radius: 13px;
      }

      .vip-scene {
        height: 185px;
      }

      .vip-progress-area {
        padding: 23px 20px 17px;
      }

      .vip-counter {
        font-size: 13px;
      }

      .vip-percentage {
        font-size: 25px;
      }

      .vip-progress-track {
        height: 14px;
      }

      .vip-progress-meta {
        align-items: flex-start;
        flex-direction: column;
      }

      .vip-steps {
        grid-template-columns:
          repeat(2, minmax(0, 1fr));

        gap: 22px 12px;
        margin: 8px 20px 24px;
      }

      .vip-step:nth-child(2)
      .vip-step-indicator::after {
        display: none;
      }

      .vip-step-title {
        font-size: 11px;
      }

      .vip-step-subtitle {
        font-size: 10px;
      }

      .vip-results {
        gap: 7px;
        margin: 0 20px 20px;
      }

      .vip-result-card {
        padding: 12px 6px;
      }

      .vip-result-value {
        font-size: 22px;
      }

      .vip-notice {
        margin: 0 20px 22px;
        padding: 13px;
      }

      .vip-close-button {
        width: calc(100% - 40px);
        margin: 0 20px 22px;
      }
    }

    @media (max-width: 380px) {
      .vip-tagline {
        display: none;
      }

      .vip-scene {
        height: 145px;
      }

      .vip-title {
        font-size: 22px;
      }
    }

    /* ========================================================
       ACCESSIBILITY
       ======================================================== */

    @media (prefers-reduced-motion: reduce) {
      .vip-overlay,
      .vip-modal,
      .vip-light-trail,
      .vip-scene-shine,
      .vip-progress-fill,
      .vip-progress-fill::after,
      .vip-step-circle,
      .vip-header-status::before {
        animation: none !important;
        transition: none !important;
      }
    }


    /* ========================================================
       VEYNOR V2.1 — VISUAL REFINEMENTS
       ======================================================== */

    /* 1. OFFICIAL DARK LOGO */

    .vip-brand {
      width: 110px;
      height: 65px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      overflow: hidden;
      border-radius: 8px;
    }

    .vip-brand-image {
      display: block;
      width: 110px;
      height: 65px;
      object-fit: contain;
      object-position: center;
      border-radius: 8px;
    }

    /* 2. FULL WIDTH TRANSPORT IMAGE */

    .vip-modal {
      box-sizing: border-box;
      border: 0;
    }

    .vip-scene {
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

    .vip-scene-image {
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

    .vip-light-trails {
      position: absolute;
      inset: 0;
      z-index: 2;
      overflow: hidden;
      pointer-events: none;
      mix-blend-mode: screen;
    }

    .vip-light-trail {
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
      animation: vip-data-travel 5.5s linear infinite;
    }

    /* 4. CENTERED HORIZONTAL PROCESS STEPS */

    @media (min-width: 651px) {
      .vip-steps {
        display: grid;
        grid-template-columns:
          repeat(4, minmax(0, 1fr));
        gap: 0;
      }

      .vip-step {
        align-items: center;
        text-align: center;
        padding: 0;
      }

      .vip-step-indicator {
        justify-content: center;
      }

      .vip-step-content {
        width: 100%;
        box-sizing: border-box;
        padding: 0 8px;
        text-align: center;
      }

      .vip-step:not(:last-child)
      .vip-step-indicator::after {
        left: calc(50% + 23px);
        right: calc(-50% + 23px);
        top: 16px;
      }

      .vip-step-title {
        font-size: 12px;
        font-weight: 750;
      }

      .vip-step-subtitle {
        font-size: 11px;
      }
    }

    /* 5. SUCCESS AND FAILURE COLORS */

    .vip-modal.vip-completed .vip-percentage {
      color: #159568;
    }

    .vip-modal.vip-completed .vip-progress-fill {
      background: linear-gradient(
        90deg,
        #0e9765,
        #43c996
      );
    }

    .vip-modal.vip-failed .vip-percentage {
      color: #dc4756;
    }

    .vip-modal.vip-failed .vip-progress-fill {
      background: linear-gradient(
        90deg,
        #c93449,
        #ed7a86
      );
    }

    /* 6. MORE READABLE DESCRIPTION */

    .vip-description {
      color: #425b82;
      font-size: 14px;
      line-height: 1.65;
      font-weight: 500;
    }

    /* 7. MOBILE ADJUSTMENTS */

    @media (max-width: 650px) {
      .vip-brand {
        width: 80px;
        height: 50px;
      }

      .vip-brand-image {
        width: 80px;
        height: 50px;
      }

      .vip-scene {
        height: 185px;
      }

      .vip-description {
        font-size: 12px;
      }
    }

    @media (max-width: 380px) {
      .vip-scene {
        height: 145px;
      }
    }



/* ============================================================
   VEYNOR PREMIUM HEADER V2.4
   Seamless background with separate Veynor logo
   ============================================================ */

.vip-header.vip-header-image {
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



.vip-header-art {
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

.vip-header.vip-header-image::before {
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

.vip-header.vip-header-image::after {
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

.vip-header-image .vip-header-right {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-left: auto;
}

.vip-header-image .vip-header-status {
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

.vip-header-image .vip-header-status::before {
  content: "";
  width: 8px;
  height: 8px;
  flex-shrink: 0;

  border-radius: 50%;
  background: #3c9cff;
  box-shadow: 0 0 0 4px rgba(60,156,255,.16);
}

/* Status colors */

.vip-modal.vip-completed
.vip-header-image .vip-header-status::before {
  background: #31d59a;
  animation: none;
}

.vip-modal.vip-failed
.vip-header-image .vip-header-status::before {
  background: #ff6575;
  animation: none;
}

/* Responsive */

@media (max-width: 650px) {
  .vip-header.vip-header-image {
    height: 85px;
    min-height: 85px;
    padding: 0 12px;
  }


.vip-header-art {
  left: 12px;
  width: 185px;
  height: 65px;
}


  .vip-header-image .vip-header-status {
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
      "VeynorImportProgress requires document.body."
    );
  }

  const overlay = document.createElement("div");

  overlay.id = IDS.overlay;
  overlay.className = "vip-overlay";

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
      !root?.classList.contains("vip-open")
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
  const step = byId(`vip-step-${stepNumber}`);

  if (!step) return;

  step.classList.remove(
    "vip-done",
    "vip-active",
    "vip-error"
  );

  const circle = byId(
    `vip-step-circle-${stepNumber}`
  );

  const subtitle = byId(
    `vip-step-subtitle-${stepNumber}`
  );

  if (status === "done") {
    step.classList.add("vip-done");

    if (circle) {
      circle.textContent = "✓";
    }

    if (subtitle) {
      subtitle.textContent = "Completed";
    }

  } else if (status === "active") {
    step.classList.add("vip-active");

    if (circle) {
      circle.textContent = "●";
    }

    if (subtitle) {
      subtitle.textContent = "In progress";
    }

  } else if (status === "error") {
    step.classList.add("vip-error");

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
    "vip-notice-title",
    title
  );

  setText(
    "vip-notice-text",
    message
  );
}

/* ============================================================
   RESULT COUNTERS
   ============================================================ */

function setResultCounts({
  imported = 0,
  skipped = 0,
  failed = 0
} = {}) {
  setText(
    "vip-result-imported",
    safeInteger(imported)
  );

  setText(
    "vip-result-skipped",
    safeInteger(skipped)
  );

  setText(
    "vip-result-failed",
    safeInteger(failed)
  );
}

/* ============================================================
   IMPORT DETAILS — RENDER SKIPPED AND FAILED ORDERS
   ============================================================ */

function renderImportDetails(details = []) {
  const wrapper = byId("vip-import-details");
  const list = byId("vip-details-list");
  const count = byId("vip-details-count");
  const panel = byId("vip-details-panel");

  if (!wrapper || !list || !count || !panel) return;

  const items = (Array.isArray(details) ? details : [])
    .filter(item =>
      item &&
      ["skipped", "failed"].includes(
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

  const skippedCount = items.filter(
    item => String(item.status).toLowerCase() === "skipped"
  ).length;

  const failedCount = items.length - skippedCount;

  count.textContent =
    `${skippedCount} skipped · ${failedCount} failed`;

  const fragment = document.createDocumentFragment();

  items.forEach(item => {
    const status = String(item.status).toLowerCase();

    const row = document.createElement("div");
    row.className = "vip-detail-row";

    const info = document.createElement("div");
    info.className = "vip-detail-info";

    const order = document.createElement("div");
    order.className = "vip-detail-order";
    order.textContent =
      item.orderNumber || item.reference || "Unknown order";

    const reason = document.createElement("div");
    reason.className = "vip-detail-reason";
    reason.textContent =
      item.reason || "No reason provided.";

    const badge = document.createElement("span");
    badge.className = `vip-detail-badge ${status}`;
    badge.textContent =
      status === "failed" ? "Failed" : "Skipped";

    info.append(order, reason);
    row.append(info, badge);
    fragment.appendChild(row);
  });

  list.appendChild(fragment);

  // Keep the popup compact by default.
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
    "vip-completed",
    "vip-failed"
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
      "[VeynorImportProgress] Import already active."
    );
    return false;
  }

  if (!document.body) {
    throw new Error(
      "VeynorImportProgress requires document.body."
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
  state.type = String(config.type || "orders");

  state.title = String(
    config.title || DEFAULTS.title
  );

  state.description = String(
    config.description || DEFAULTS.description
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

  setText(IDS.title, state.title);
  setText(IDS.description, state.description);

  setText(
    IDS.counter,
    `Preparing ${state.total} ${state.type}...`
  );

  // File reading and preview preparation
  // already happened before starting the import.
  setStep(1, "done");
  setStep(2, "done");
  setStep(3, "active");
  setStep(4, "pending");

  root.classList.add("vip-open");

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
   VeynorImportProgress.update({
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

  const percentage = getPercentage();

  setProgressValue(percentage);

  setText(
    IDS.counter,
    `Importing order ${state.completed} of ${state.total}`
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

  // Finalizing begins when all orders are processed.
  if (
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
    "vip-completed",
    "vip-failed"
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
    failed: state.failed
  });

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

  if (allSkipped) {
    setText(IDS.title, "No new orders imported");

    setText(
      IDS.description,
      "All orders were processed, but none were imported. " +
      "Review the skipped orders to understand why."
    );

    setText(IDS.headerStatus, "No new orders");

    setNotice(
      "All orders were skipped",
      `${state.skipped} orders were skipped. ` +
      "No new orders were created."
    );

  } else if (hasIssues) {
    modal?.classList.add("vip-failed");

    setText(
      IDS.title,
      "Import completed with issues"
    );

    setText(
      IDS.description,
      "Processing has finished. Some orders were skipped " +
      "or could not be imported. Review the results."
    );

    setText(IDS.headerStatus, "Review required");

    setNotice(
      "Some orders need attention",
      `${state.imported} imported, ` +
      `${state.skipped} skipped and ` +
      `${state.failed} failed.`
    );

  } else if (emptyImport) {
    setText(IDS.title, "No orders to import");

    setText(
      IDS.description,
      "Processing finished, but no orders were available."
    );

    setText(IDS.headerStatus, "Nothing to import");

    setNotice(
      "No orders processed",
      "There were no orders to import."
    );

  } else {
    modal?.classList.add("vip-completed");

    setText(
      IDS.title,
      "Import completed successfully"
    );

    setText(
      IDS.description,
      "All orders have been imported successfully. " +
      "Your import results are available below."
    );

    setText(IDS.headerStatus, "Import complete");

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
    "The import could not be completed."
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

  modal?.classList.add("vip-failed");

  setText(
    IDS.title,
    "Import interrupted"
  );

  setText(
    IDS.headerStatus,
    "Import interrupted"
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

  setNotice(
    "Import requires attention",
    "The import stopped before all orders were processed. " +
    "Some orders may already have been saved. " +
    "Review the results before attempting another import."
  );

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

  root.classList.remove("vip-open");

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

window.VeynorImportProgress = Object.freeze({
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
  `[VeynorImportProgress] v${VERSION} ready.`
);

})();






