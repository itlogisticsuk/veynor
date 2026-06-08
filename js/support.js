(function () {
  "use strict";

  const APP_VERSION = "v1.4.5";

  function byId(id) {
    return document.getElementById(id);
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

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message;
    el.className = "notice " + type;

    clearTimeout(window.__supportToastTimer);
    window.__supportToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5000);
  }

  const modules = [
    ["📊", "Dashboard", "Live operational overview for orders, stock, planning, delivery and revenue."],
    ["📥", "Orders Import", "Import orders from spreadsheets, CSV files or PDF documents into the operational flow."],
    ["✅", "Order Matching", "Match imported orders against available stock and validate readiness for planning."],
    ["🧭", "Operations Control", "Central lifecycle overview from order received to delivered and invoiced."],
    ["🗺️", "Route Planner", "Plan routes, assign vehicles, monitor stops, fill rates and transport cost."],
    ["📦", "Products", "Maintain SKU master data, volumes, weights, tariffs and stock label generation."],
    ["🔫", "Scan In / Out", "Book goods into stock, scan movements and support warehouse execution."],
    ["🏬", "Current Stock", "Live stock visibility with grouping by SKU, owner, status and reservation state."],
    ["✍️", "Proof of Delivery", "Capture delivery confirmation, signatures, photos and delivery notes."],
    ["£", "Billing", "Review invoices, revenue split, warehouse fees, transport fees and financial status."],
    ["📈", "Analytics & Reports", "Analyse warehouse, transport, customer, finance and service performance."],
    ["🛠️", "Support Center", "Support documentation, diagnostics, tickets, release notes and platform explanation."]
  ];

  const workflows = [
    ["Order Creation", "Orders are imported into Veynor and linked to the correct operational account, customer or product owner."],
    ["Product & SKU Validation", "The system checks whether product data exists and whether SKU references can be matched."],
    ["Stock Matching", "Physical stock is compared with order demand to determine whether an order is complete, partial or missing stock."],
    ["Release to Planning", "Orders with complete stock and valid address data can be released into route planning."],
    ["Route Planning", "Orders are grouped into routes based on geography, vehicle capacity, distance and operational constraints."],
    ["Warehouse Execution", "Items are picked, reserved, loaded and tracked through warehouse events."],
    ["Delivery", "Drivers or operational users confirm delivery using proof of delivery workflows."],
    ["Billing", "Revenue and invoice data can be generated and reviewed across warehouse, admin, pick and transport charges."],
    ["Analytics", "Operational and commercial results can be reviewed by day, week, month, customer and module."]
  ];

  const faqs = [
    ["Can every stakeholder receive a login?", "Yes. The platform is designed to support a main operator account and controlled sub-user accounts for producers, product owners, retailers and other stakeholders."],
    ["Can product owners only see their own data?", "Yes. Role-based access makes it possible to show only the stock, orders, documents and analytics related to that specific party."],
    ["Can retailers access delivery information?", "Yes. Retailer access can be limited to delivery status, expected dates, proof of delivery and relevant order information."],
    ["Why is an order not visible in the route planner?", "Usually because the order is not released to planning, stock is incomplete or delivery coordinates are missing."],
    ["Why is order matching incomplete?", "This normally means stock is missing, SKU references do not match or a product record has not yet been created."],
    ["Can the platform support multiple customers?", "Yes. Veynor is built as a multi-party logistics platform where the main operator can manage multiple external parties from one portal."],
    ["Can analytics be filtered by day, week and month?", "Yes. The analytics module supports multiple result levels, including day, week, month, quarter and year."],
    ["Can reports be exported?", "Yes. Reports can be prepared for operational, warehouse, transport, finance and customer performance analysis."]
  ];

  const releaseNotes = [
    ["v1.4.5", "Support", "Added full Support Center concept with diagnostics, workflows and portal explanation.", "Live"],
    ["v1.4.5", "Navigation", "Global account menu now links to Support Center and Release Notes.", "Live"],
    ["v1.4.4", "Analytics", "Added Analytics & Reports navigation and extended operational dashboard structure.", "Live"],
    ["v1.4.3", "Layout", "Improved sidebar structure, role-based navigation and logout handling.", "Live"],
    ["v1.4.2", "Operations", "Expanded Operations Control Center and document flow.", "Live"]
  ];

  function renderModules() {
    const mount = byId("moduleGrid");
    if (!mount) return;

    mount.innerHTML = modules.map(([icon, title, text]) => `
      <article class="module-card">
        <div class="module-icon">${icon}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </article>
    `).join("");
  }

  function renderWorkflows() {
    const mount = byId("workflowList");
    if (!mount) return;

    mount.innerHTML = workflows.map(([title, text], index) => `
      <div class="flow-step">
        <div class="flow-number">${index + 1}</div>
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(text)}</p>
        </div>
      </div>
    `).join("");
  }

  function renderFaq() {
    const mount = byId("faqList");
    if (!mount) return;

    mount.innerHTML = faqs.map(([title, text]) => `
      <div class="faq-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </div>
    `).join("");
  }

  function renderDiagnostics() {
    const body = byId("diagnosticsBody");
    if (!body) return;

    const rows = [
      ["Application Version", APP_VERSION, "OK"],
      ["Current Page", window.location.pathname, "OK"],
      ["Browser", navigator.userAgent, "OK"],
      ["Language", navigator.language, "OK"],
      ["Screen Size", `${window.innerWidth} × ${window.innerHeight}`, "OK"],
      ["Supabase Helper", typeof sb === "function" ? "Available" : "Missing", typeof sb === "function" ? "OK" : "Warning"],
      ["Local Time", new Date().toLocaleString(), "OK"]
    ];

    body.innerHTML = rows.map(([item, value, status]) => `
      <tr>
        <td><strong>${escapeHtml(item)}</strong></td>
        <td>${escapeHtml(value)}</td>
        <td><span class="pill ${status === "OK" ? "green" : "orange"}">${escapeHtml(status)}</span></td>
      </tr>
    `).join("");
  }

  function renderReleaseNotes() {
    const body = byId("releaseNotesBody");
    if (!body) return;

    body.innerHTML = releaseNotes.map(([version, area, update, status]) => `
      <tr>
        <td><strong>${escapeHtml(version)}</strong></td>
        <td>${escapeHtml(area)}</td>
        <td>${escapeHtml(update)}</td>
        <td><span class="pill green">${escapeHtml(status)}</span></td>
      </tr>
    `).join("");
  }

  function collectDiagnosticsText() {
    return [
      `Veynor Support Diagnostics`,
      `Version: ${APP_VERSION}`,
      `Page: ${window.location.pathname}`,
      `Browser: ${navigator.userAgent}`,
      `Language: ${navigator.language}`,
      `Screen: ${window.innerWidth} x ${window.innerHeight}`,
      `Time: ${new Date().toLocaleString()}`,
      `Supabase helper: ${typeof sb === "function" ? "Available" : "Missing"}`
    ].join("\n");
  }

  function bindTabs() {
    document.querySelectorAll(".support-tab").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".support-tab").forEach(btn => btn.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));

        button.classList.add("active");
        byId("tab-" + button.dataset.tab)?.classList.add("active");
      });
    });

    if (window.location.hash === "#release-notes") {
      document.querySelector('[data-tab="release-notes"]')?.click();
    }
  }

  function bindActions() {
    byId("btnRefreshDiagnostics")?.addEventListener("click", () => {
      renderDiagnostics();
      showToast("Diagnostics refreshed.", "ok");
    });

    byId("btnCopyDiagnostics")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(collectDiagnosticsText());
        showToast("Diagnostics copied to clipboard.", "ok");
      } catch (error) {
        showToast("Could not copy diagnostics.", "err");
      }
    });

    byId("supportTicketForm")?.addEventListener("submit", event => {
      event.preventDefault();

      const subject = byId("ticketSubject")?.value?.trim();
      const details = byId("ticketDetails")?.value?.trim();

      if (!subject || !details) {
        showToast("Please enter a subject and details before creating a ticket.", "err");
        return;
      }

      showToast("Support ticket prepared. Database saving can be connected in the next step.", "ok");
    });
  }

  function init() {
    renderModules();
    renderWorkflows();
    renderFaq();
    renderDiagnostics();
    renderReleaseNotes();
    bindTabs();
    bindActions();
  }

  document.addEventListener("DOMContentLoaded", init);
})();