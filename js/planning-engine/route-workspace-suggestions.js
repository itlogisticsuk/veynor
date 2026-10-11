/*
 * VEYNOR ROUTE WORKSPACE SUGGESTIONS
 * File: /js/planning-engine/route-workspace-suggestions.js
 *
 * DEEL 1 VAN 2
 *
 * - Suggestiepaneel
 * - Overzicht van de huidige route
 * - Aandachtspunten uit de Planning Engine
 * - Ruimte voor toekomstige routealternatieven
 *
 * Laden na:
 * - route-workspace.js
 * - route-workspace-ui.js
 *
 * Geen eigen routeoptimalisatie.
 * Geen fictieve alternatieven of besparingen.
 * Geen databasewrites.
 */

(function () {
  "use strict";

  const workspace = window.VeynorRouteWorkspace;

  if (!workspace?.registerModule) {
    throw new Error(
      "Load route-workspace.js before route-workspace-suggestions.js."
    );
  }

  const ROUTE_METRICS = [
    ["distance_km", "Distance", "km"],
    ["total_hours", "Total time", "h"],
    ["fill_percent", "Vehicle fill rate", "%"],
    ["remaining_capacity_m3", "Remaining capacity", "m³"],
    ["total_cost_gbp", "Estimated route cost", "GBP"]
  ];

  // ==========================================================
  // 1. ELEMENTEN EN GETALLEN
  // ==========================================================

  function element(tag, className, text) {
    const node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (text !== undefined) {
      node.textContent = String(text);
    }

    return node;
  }

  function formatNumber(value, digits = 2) {
    if (
      value == null ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    return new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(Number(value));
  }

  function formatMetric(value, unit) {
    const formatted = formatNumber(
      value,
      unit === "%" ? 1 : 2
    );

    if (formatted === "—") {
      return formatted;
    }

    if (unit === "GBP") {
      return `£${formatted}`;
    }

    return `${formatted} ${unit}`;
  }

  function hasCurrentPreview(snapshot) {
    return (
      Boolean(snapshot.preview) &&
      snapshot.status === "ready" &&
      snapshot.previewRevision === snapshot.revision
    );
  }

  function createButton(action, label, disabled = false) {
    const button = element(
      "button",
      "rw-button",
      label
    );

    button.type = "button";
    button.disabled = disabled;

    button.dataset.rwSuggestionsAction =
      action;

    return button;
  }

  // ==========================================================
  // 2. SUGGESTIEPANEEL
  // ==========================================================

  function createSuggestionsShell() {
    const root = element(
      "div",
      "rw-suggestions-module"
    );

    const status = element(
      "p",
      "rw-suggestions-status",
      "Waiting for route data…"
    );

    status.setAttribute(
      "aria-live",
      "polite"
    );

    const error = element(
      "p",
      "rw-error"
    );

    error.setAttribute(
      "role",
      "alert"
    );

    error.hidden = true;

    // --------------------------------------------------------
    // Huidige routegegevens
    // --------------------------------------------------------

    const overview = element(
      "section",
      "rw-card rw-suggestions-overview"
    );

    overview.appendChild(
      element(
        "h4",
        "",
        "Current Route"
      )
    );

    const metricGrid = element(
      "dl",
      "rw-suggestions-metrics"
    );

    const metricValues = new Map();

    for (const [key, label] of ROUTE_METRICS) {
      const group = element(
        "div",
        "rw-suggestions-metric"
      );

      const value = element(
        "dd",
        "rw-suggestions-metric-value",
        "—"
      );

      group.append(
        element(
          "dt",
          "rw-suggestions-metric-label",
          label
        ),
        value
      );

      metricValues.set(
        key,
        value
      );

      metricGrid.appendChild(group);
    }

    const overviewNote = element(
      "p",
      "rw-field-help",
      "Values are supplied by the current route calculation."
    );

    overview.append(
      metricGrid,
      overviewNote
    );

    // --------------------------------------------------------
    // Aandachtspunten
    // --------------------------------------------------------

    const assessment = element(
      "section",
      "rw-card rw-suggestions-assessment"
    );

    const assessmentIntro = element(
      "p",
      "rw-field-help",
      "Review calculation warnings before changing the route."
    );

    const messages = element(
      "div",
      "rw-suggestions-messages"
    );

    messages.appendChild(
      element(
        "p",
        "rw-message",
        "Waiting for route validation."
      )
    );

    const reviewActions = element(
      "div",
      "rw-suggestions-review-actions"
    );

    const reviewStops = createButton(
      "review-stops",
      "Review Stops",
      true
    );

    const reviewSettings = createButton(
      "review-settings",
      "Review Settings",
      true
    );

    const reviewSummary = createButton(
      "review-summary",
      "Review Summary",
      true
    );

    reviewActions.append(
      reviewStops,
      reviewSettings,
      reviewSummary
    );

    assessment.append(
      element(
        "h4",
        "",
        "Route Assessment"
      ),
      assessmentIntro,
      messages,
      reviewActions
    );

    // --------------------------------------------------------
    // Toekomstige automatische optimalisatie
    // --------------------------------------------------------

    const optimisation = element(
      "section",
      "rw-card rw-suggestions-optimisation"
    );

    const findBetterRoute = createButton(
      "find-better-route",
      "Find Better Route",
      true
    );

    findBetterRoute.title =
      "Automatic route optimisation is not available.";

    optimisation.append(
      element(
        "h4",
        "",
        "Automatic Suggestions"
      ),

      element(
        "p",
        "rw-field-help",
        "Automatic stop optimisation and order exchanges " +
        "between routes are not available in this version."
      ),

      findBetterRoute
    );

    // --------------------------------------------------------
    // Toekomstige alternatieve routes
    // --------------------------------------------------------

    const alternatives = element(
      "section",
      "rw-card rw-suggestions-alternatives"
    );

    const compareRoutes = createButton(
      "compare-routes",
      "Compare Routes",
      true
    );

    compareRoutes.title =
      "No alternative routes have been calculated.";

    const alternativesContent = element(
      "div",
      "rw-suggestions-alternatives-content"
    );

    alternativesContent.appendChild(
      element(
        "p",
        "rw-module-placeholder",
        "No alternative routes have been calculated."
      )
    );

    alternatives.append(
      element(
        "h4",
        "",
        "Alternative Routes"
      ),

      alternativesContent,

      compareRoutes
    );

    const footerNote = element(
      "p",
      "rw-suggestions-note",
      "Review actions only change the selected tab. " +
      "No route changes are applied or saved here."
    );

    root.append(
      status,
      error,
      overview,
      assessment,
      optimisation,
      alternatives,
      footerNote
    );

    return {
      root,
      status,
      error,

      metricValues,
      overviewNote,

      assessmentIntro,
      messages,

      reviewStops,
      reviewSettings,
      reviewSummary,

      findBetterRoute,
      compareRoutes,

      alternativesContent,
      footerNote
    };
  }

  // EINDE DEEL 1 VAN 2
  // Plak deel 2 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 3. ROUTEGEGEVENS EN AANDACHTSPUNTEN
  // ==========================================================

  function renderSuggestions(shell, snapshot) {
    const preview = snapshot.preview;
    const after = preview?.after;

    const current = hasCurrentPreview(
      snapshot
    );

    // --------------------------------------------------------
    // Berekende routegegevens
    // --------------------------------------------------------

    for (const [key, , unit] of ROUTE_METRICS) {
      const node = shell.metricValues.get(key);

      if (node) {
        node.textContent = formatMetric(
          after?.[key],
          unit
        );
      }
    }

    shell.overviewNote.textContent = !preview
      ? "Waiting for the first route calculation."
      : current
        ? "Values match the current route preview."
        : "Previous calculation. These values do not yet reflect the current preview.";

    // --------------------------------------------------------
    // Algemene status
    // --------------------------------------------------------

    if (!preview) {
      shell.status.textContent =
        "Waiting for route data…";

    } else if (snapshot.status === "calculating") {
      shell.status.textContent =
        "Recalculating the route. " +
        "The assessment below belongs to the previous calculation.";

    } else if (snapshot.status === "error") {
      shell.status.textContent =
        "The last calculation failed. " +
        "Recalculate successfully before assessing the current preview.";

    } else if (!current) {
      shell.status.textContent =
        "The current preview has not yet been recalculated.";

    } else {
      shell.status.textContent =
        "Route assessment updated. " +
        "Automatic optimisation is unavailable.";
    }

    // --------------------------------------------------------
    // Meldingen opnieuw opbouwen
    // --------------------------------------------------------

    shell.messages.replaceChildren();

    if (!preview) {
      shell.messages.appendChild(
        element(
          "p",
          "rw-message",
          "Waiting for route validation."
        )
      );

    } else {
      if (!current) {
        shell.messages.appendChild(
          element(
            "p",
            "rw-message rw-message-warning",
            "The following messages belong to the previous calculation."
          )
        );
      }

      const warnings = Array.isArray(
        preview.warnings
      )
        ? preview.warnings
        : [];

      if (warnings.length) {
        const list = element(
          "ul",
          "rw-warning-list"
        );

        for (const warning of warnings) {
          list.appendChild(
            element(
              "li",
              "rw-warning-item",
              String(warning)
            )
          );
        }

        shell.messages.appendChild(list);
      }

      if (preview.valid === false) {
        shell.messages.appendChild(
          element(
            "p",
            "rw-message rw-message-error",
            "The Planning Engine marks this route as invalid. " +
            "Review the reported issues."
          )
        );

      } else if (
        preview.valid === true &&
        !warnings.length
      ) {
        shell.messages.appendChild(
          element(
            "p",
            "rw-message rw-message-success",
            "No warnings were returned by the Planning Engine."
          )
        );

      } else if (
        preview.valid !== true &&
        preview.valid !== false
      ) {
        shell.messages.appendChild(
          element(
            "p",
            "rw-message rw-message-warning",
            "No route validation status was returned."
          )
        );
      }

      if (preview.routing_source !== "osrm") {
        shell.messages.appendChild(
          element(
            "p",
            "rw-message rw-message-warning",
            "A verified road calculation is unavailable. " +
            "Distance and cost figures may be estimates."
          )
        );
      }

      shell.messages.appendChild(
        element(
          "p",
          "rw-message rw-message-info",
          "This assessment does not establish that the route " +
          "is optimal. No alternatives or savings have been calculated."
        )
      );
    }

    // --------------------------------------------------------
    // Reviewknoppen
    // --------------------------------------------------------

    const canReview =
      snapshot.isOpen &&
      Boolean(snapshot.draft);

    shell.reviewStops.disabled =
      !canReview;

    shell.reviewSettings.disabled =
      !canReview;

    shell.reviewSummary.disabled =
      !canReview;

    // Geen beschikbare optimalisatie- of vergelijkingsactie.
    shell.findBetterRoute.disabled = true;
    shell.compareRoutes.disabled = true;
  }

  // ==========================================================
  // 4. MODULE OPBOUWEN
  // ==========================================================

  function mountSuggestions(context) {
    const {
      root: workspaceRoot,
      getState,
      actions
    } = context;

    if (
      !workspaceRoot ||
      typeof workspaceRoot.querySelector !== "function" ||
      typeof getState !== "function" ||
      typeof actions?.setTab !== "function"
    ) {
      throw new Error(
        "Invalid Route Workspace suggestions context."
      );
    }

    const slot = workspaceRoot.querySelector(
      '[data-rw-slot="suggestions"]'
    );

    if (!slot) {
      throw new Error(
        "The Route Workspace suggestions container is missing."
      );
    }

    const shell = createSuggestionsShell();

    const originalChildren = Array.from(
      slot.childNodes
    );

    const events = new AbortController();

    const listenerOptions = {
      signal: events.signal
    };

    let destroyed = false;

    // --------------------------------------------------------
    // Reviewknoppen aansluiten
    // --------------------------------------------------------

    shell.root.addEventListener(
      "click",
      event => {
        const target = event.target;

        if (!(target instanceof Element)) {
          return;
        }

        const button = target.closest(
          "[data-rw-suggestions-action]"
        );

        if (
          !button ||
          !shell.root.contains(button) ||
          button.disabled ||
          destroyed
        ) {
          return;
        }

        const destinations = {
          "review-stops": "stops",
          "review-settings": "settings",
          "review-summary": "summary"
        };

        const tab = destinations[
          button.dataset.rwSuggestionsAction
        ];

        // Optimalisatie- en vergelijkingsknoppen hebben
        // bewust geen uitvoerbare actie.
        if (!tab) {
          return;
        }

        shell.error.textContent = "";
        shell.error.hidden = true;

        try {
          actions.setTab(tab);

          // Verplaats toetsenbordfocus naar de gekozen tab.
          const tabButton = workspaceRoot.querySelector(
            `[data-rw-tab="${tab}"]`
          );

          tabButton?.focus();

        } catch (error) {
          if (
            destroyed ||
            !shell.root.isConnected
          ) {
            return;
          }

          shell.error.textContent =
            error?.message ||
            String(error || "The section could not be opened.");

          shell.error.hidden = false;
        }
      },
      listenerOptions
    );

    // --------------------------------------------------------
    // Opruimen
    // --------------------------------------------------------

    function destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;

      events.abort();

      if (shell.root.parentNode === slot) {
        slot.replaceChildren(
          ...originalChildren
        );
      } else {
        shell.root.remove();
      }
    }

    // --------------------------------------------------------
    // Module plaatsen
    // --------------------------------------------------------

    try {
      slot.replaceChildren(
        shell.root
      );

      renderSuggestions(
        shell,
        getState()
      );

    } catch (error) {
      destroy();
      throw error;
    }

    return {
      root: shell.root,

      render(snapshot) {
        if (destroyed) {
          return;
        }

        renderSuggestions(
          shell,
          snapshot
        );
      },

      destroy
    };
  }

  // ==========================================================
  // 5. MODULE REGISTREREN
  // ==========================================================

  workspace.registerModule("suggestions", {
    mount: mountSuggestions
  });

  // EINDE DEEL 2 VAN 2
})();

