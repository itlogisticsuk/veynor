/*
 * VEYNOR ROUTE WORKSPACE SETTINGS
 * File: /js/planning-engine/route-workspace-settings.js
 *
 * DEEL 1 VAN 3
 *
 * - Algemene lostijdmethode
 * - Overzicht van routefuncties
 * - Compact instellingenpaneel naast de stops
 * - Uitgebreid instellingenpaneel onder Settings
 *
 * Laden na:
 * - route-workspace.js
 * - route-workspace-ui.js
 *
 * Alleen ondersteunde wijzigingen worden aan de
 * controller doorgegeven.
 *
 * Geen databasewrites of eigen routeberekeningen.
 */

(function () {
  "use strict";

  const workspace = window.VeynorRouteWorkspace;

  if (!workspace?.registerModule) {
    throw new Error(
      "Load route-workspace.js before route-workspace-settings.js."
    );
  }

  const UNLOADING_MODES = [
    ["fixed", "Fixed"],
    ["orders", "Orders"],
    ["volume", "Volume"],
    ["combined", "Combined"]
  ];

  const MODE_DESCRIPTIONS = {
    fixed:
      "Uses the base unloading time for each delivery location.",

    orders:
      "Adds unloading time for additional orders at the same location.",

    volume:
      "Adds unloading time for volume above the configured threshold.",

    combined:
      "Combines the base time, additional orders and additional volume."
  };

  /*
   * Dit beschrijft het gedrag van de huidige engine.
   *
   * capability bepaalt of de betreffende schakelaar
   * door deze Workspace bediend mag worden.
   *
   * De huidige controller ondersteunt deze schakelaars
   * nog niet. Deel 2 en 3 houden ze daarom disabled.
   */
  const FEATURES = [
    {
      key: "road-routing",
      label: "Use road routing",
      capability: "osrmToggle",
      currentValue: true,
      description:
        "Road routing is requested automatically. " +
        "An estimated calculation may be used if road routing is unavailable."
    },

    {
      key: "group-locations",
      label: "Group orders by delivery location",
      capability: "groupingToggle",
      currentValue: true,
      description:
        "Orders sharing the same delivery location are kept together."
    },

    {
      key: "unloading-calculation",
      label: "Calculate unloading time",
      capability: "unloadingCalculationToggle",
      currentValue: true,
      description:
        "Unloading time is calculated for each delivery location."
    },

    {
      key: "capacity-check",
      label: "Check vehicle capacity",
      capability: "capacityToggle",
      currentValue: true,
      description:
        "The route calculation checks the selected vehicle's loading capacity."
    },

    {
      key: "earliest-planning-date",
      label: "Respect earliest planning date",
      capability: "earliestDateToggle",
      currentValue: true,
      description:
        "Orders cannot be planned before their earliest permitted planning date."
    },

    {
      key: "return-to-depot",
      label: "Include return to depot",
      capability: "returnToDepotToggle",
      currentValue: true,
      description:
        "The route calculation includes the return journey to the depot."
    },

    {
      key: "suggestions",
      label: "Enable route suggestions",
      capability: "suggestions",
      currentValue: false,
      description:
        "Route suggestions are not available in this version."
    }
  ];

  // ==========================================================
  // 1. ELEMENTHELPERS
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

  function isEditable(snapshot) {
    return (
      snapshot.isOpen &&
      Boolean(snapshot.draft) &&
      snapshot.status !== "loading"
    );
  }

  function getModeDescription(mode) {
    return MODE_DESCRIPTIONS[mode] ||
      "Select an unloading calculation method.";
  }

  // ==========================================================
  // 2. VERGRENDELDE FUNCTIESCHAKELAAR
  // ==========================================================

  function createFeatureControl(feature, scope) {
    const row = element(
      "div",
      "rw-setting-feature"
    );

    row.dataset.featureKey = feature.key;

    const label = element(
      "label",
      "rw-setting-toggle"
    );

    const input = element(
      "input",
      "rw-setting-checkbox"
    );

    input.type = "checkbox";

    input.id =
      `rw-setting-${scope}-${feature.key}`;

    input.checked = feature.currentValue;

    // De huidige controller heeft hiervoor geen wijzigingsactie.
    input.disabled = true;

    input.dataset.rwSettingsFeature =
      feature.key;

    const text = element(
      "span",
      "rw-setting-toggle-label",
      feature.label
    );

    label.htmlFor = input.id;

    label.append(
      input,
      text
    );

    const description = element(
      "p",
      "rw-field-help",
      feature.description
    );

    description.id =
      `${input.id}-description`;

    input.setAttribute(
      "aria-describedby",
      description.id
    );

    const availability = element(
      "span",
      "rw-setting-lock",
      feature.currentValue
        ? "On · locked"
        : "Unavailable"
    );

    row.append(
      label,
      availability,
      description
    );

    return {
      root: row,
      input,
      availability,
      description,
      feature
    };
  }

  // ==========================================================
  // 3. INSTELLINGENPANEEL AANMAKEN
  // ==========================================================

  function createSettingsShell(scope) {
    const root = element(
      "div",
      "rw-settings-module"
    );

    root.dataset.settingsScope = scope;

    const error = element(
      "p",
      "rw-error"
    );

    error.setAttribute("role", "alert");
    error.hidden = true;

    const status = element(
      "p",
      "rw-settings-status"
    );

    status.setAttribute(
      "aria-live",
      "polite"
    );

    // --------------------------------------------------------
    // Algemene lostijdmethode
    // --------------------------------------------------------

    const unloadingSection = element(
      "section",
      "rw-settings-section"
    );

    const modeLabel = element(
      "label",
      "rw-field"
    );

    const mode = element(
      "select",
      "rw-input"
    );

    mode.id =
      `rw-settings-${scope}-unloading-mode`;

    mode.dataset.rwSettingsField =
      "unloading_mode";

    mode.disabled = true;

    const placeholder = element(
      "option",
      "",
      "Waiting for route data…"
    );

    placeholder.value = "";
    placeholder.disabled = true;

    mode.appendChild(placeholder);

    for (const [value, label] of UNLOADING_MODES) {
      const option = element(
        "option",
        "",
        label
      );

      option.value = value;

      mode.appendChild(option);
    }

    modeLabel.htmlFor = mode.id;

    modeLabel.append(
      element(
        "span",
        "rw-field-label",
        "Default unloading mode"
      ),
      mode
    );

    const modeDescription = element(
      "p",
      "rw-field-help",
      "Waiting for route data…"
    );

    modeDescription.id =
      `${mode.id}-description`;

    mode.setAttribute(
      "aria-describedby",
      modeDescription.id
    );

    const overrideNote = element(
      "p",
      "rw-field-help",
      "Location-specific modes and manual unloading times " +
      "take precedence over this default."
    );

    unloadingSection.append(
      modeLabel,
      modeDescription,
      overrideNote
    );

    // --------------------------------------------------------
    // Huidige routefuncties
    // --------------------------------------------------------

    const featureSection = element(
      "section",
      "rw-settings-section"
    );

    featureSection.appendChild(
      element(
        "h4",
        "",
        "Route Functions"
      )
    );

    const featureControls = new Map();

    for (const feature of FEATURES) {
      const control = createFeatureControl(
        feature,
        scope
      );

      featureControls.set(
        feature.key,
        control
      );

      featureSection.appendChild(
        control.root
      );
    }

    // --------------------------------------------------------
    // Uitleg over de lostijdformule
    // --------------------------------------------------------

    const formulaSection = element(
      "section",
      "rw-settings-section"
    );

    formulaSection.append(
      element(
        "h4",
        "",
        "Unloading Calculation"
      ),

      element(
        "p",
        "rw-field-help",
        "Base time, additional time per order, the volume " +
        "threshold and additional time per m³ follow " +
        "the company settings."
      ),

      element(
        "p",
        "rw-field-help",
        "Use the delivery location controls to enter " +
        "a manual unloading time for a specific stop."
      )
    );

    const footerNote = element(
      "p",
      "rw-settings-note",
      "Changes remain a preview. Route saving is disabled."
    );

    root.append(
      error,
      status,
      unloadingSection,
      featureSection,
      formulaSection,
      footerNote
    );

    return {
      root,
      error,
      status,
      mode,
      modeDescription,
      featureControls,
      footerNote
    };
  }

  // EINDE DEEL 1 VAN 3
  // Plak deel 2 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 4. INSTELLINGEN WEERGEVEN
  // ==========================================================

  function renderSettings(shell, snapshot) {
    const draft = snapshot.draft;

    const editable =
      isEditable(snapshot) &&
      snapshot.capabilities?.unloadingMode === true;

    const mode = draft?.unloading_mode || "";

    const knownMode = UNLOADING_MODES.some(([value]) => {
      return value === mode;
    });

    shell.mode.disabled = !editable;

    shell.mode.value =
      knownMode
        ? mode
        : "";

    shell.modeDescription.textContent =
      draft
        ? getModeDescription(mode)
        : "Waiting for route data…";

    // --------------------------------------------------------
    // Status van de berekening
    // --------------------------------------------------------

    const currentPreview =
      Boolean(snapshot.preview) &&
      snapshot.status === "ready" &&
      snapshot.previewRevision === snapshot.revision;

    let statusText = "Waiting for route data…";

    if (draft) {
      if (snapshot.status === "calculating") {
        statusText =
          "Recalculating the route with the current settings…";

      } else if (snapshot.status === "error") {
        statusText =
          "The last calculation failed. " +
          "Displayed totals may belong to a previous calculation.";

      } else if (currentPreview) {
        statusText =
          "The displayed calculation matches the current settings.";

      } else {
        statusText =
          "Settings have changed. " +
          "The displayed totals have not yet been updated.";
      }
    }

    shell.status.textContent = statusText;

    // --------------------------------------------------------
    // Overzicht van afwijkende lostijdinstellingen
    // --------------------------------------------------------

    const locationKeys = new Set(
      (
        Array.isArray(snapshot.preview?.locations)
          ? snapshot.preview.locations
          : []
      ).map(location => {
        return location.location_key;
      })
    );

    const overriddenLocations = new Set();

    const overrideSources = [
      draft?.mode_by_location,
      draft?.manual_minutes_by_location
    ];

    for (const source of overrideSources) {
      if (!source) {
        continue;
      }

      for (const key of Object.keys(source)) {
        if (locationKeys.has(key)) {
          overriddenLocations.add(key);
        }
      }
    }

    const overrideCount =
      overriddenLocations.size;

    if (overrideCount > 0) {
      shell.footerNote.textContent =
        `${overrideCount} ` +
        (
          overrideCount === 1
            ? "delivery location has"
            : "delivery locations have"
        ) +
        " a location-specific mode or manual unloading time. " +
        "Changes remain a preview. Saving is disabled.";
    } else {
      shell.footerNote.textContent =
        "Changes remain a preview. Route saving is disabled.";
    }

    // --------------------------------------------------------
    // Functies zonder schakelactie blijven vergrendeld
    // --------------------------------------------------------

    for (const control of shell.featureControls.values()) {
      const feature = control.feature;

      control.input.disabled = true;

      control.input.checked =
        feature.currentValue;

      control.availability.textContent =
        feature.currentValue
          ? "On · locked"
          : "Unavailable";

      /*
       * Een capability alleen is onvoldoende om een
       * schakelaar te activeren.
       *
       * Eerst moet er een passende controlleractie
       * én ondersteuning in de engine beschikbaar zijn.
       */
    }
  }

  // ==========================================================
  // 5. LOKALE FOUTMELDINGEN
  // ==========================================================

  function clearSettingsError(shell) {
    shell.error.textContent = "";
    shell.error.hidden = true;
  }

  function showSettingsError(shell, error) {
    if (!shell.root.isConnected) {
      return;
    }

    shell.error.textContent =
      error?.message ||
      String(error || "Settings could not be changed.");

    shell.error.hidden = false;
  }

  // ==========================================================
  // 6. INSTELLINGENBEDIENING AANSLUITEN
  // ==========================================================

  function bindSettingsEvents(
    shell,
    context,
    listenerOptions
  ) {
    const {
      getState,
      actions
    } = context;

    shell.root.addEventListener(
      "change",
      event => {
        const input = event.target;

        if (
          !(
            input instanceof HTMLInputElement ||
            input instanceof HTMLSelectElement
          )
        ) {
          return;
        }

        if (!shell.root.contains(input)) {
          return;
        }

        /*
         * Functieschakelaars worden niet naar de controller
         * doorgestuurd. Herstel hun vaste weergave ook bij
         * een programmatisch afgevuurd change-event.
         */
        if (input.dataset.rwSettingsFeature) {
          renderSettings(
            shell,
            getState()
          );

          return;
        }

        if (
          input.dataset.rwSettingsField !==
          "unloading_mode"
        ) {
          return;
        }

        clearSettingsError(shell);

        try {
          const snapshot = getState();

          if (
            input.disabled ||
            !isEditable(snapshot) ||
            snapshot.capabilities?.unloadingMode !== true
          ) {
            throw new Error(
              "Unloading settings cannot be changed right now."
            );
          }

          const mode = input.value;

          const validMode = UNLOADING_MODES.some(([value]) => {
            return value === mode;
          });

          if (!validMode) {
            throw new Error(
              "Select a valid unloading calculation method."
            );
          }

          /*
           * De controller:
           * - past alleen het concept aan;
           * - markeert de vorige preview als verouderd;
           * - start automatisch een nieuwe berekening;
           * - publiceert de gewijzigde status naar beide panelen.
           */
          actions.setRouteDetails({
            unloading_mode: mode
          });

        } catch (error) {
          // Zet afgewezen invoer terug naar de conceptwaarde.
          try {
            renderSettings(
              shell,
              getState()
            );
          } catch (renderError) {
            console.error(
              "[RouteWorkspace:Settings] Could not refresh settings.",
              renderError
            );
          }

          showSettingsError(
            shell,
            error
          );
        }
      },
      listenerOptions
    );
  }

  // EINDE DEEL 2 VAN 3
  // Plak deel 3 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 7. INSTELLINGENMODULE OPBOUWEN
  // ==========================================================

  function mountSettings(context) {
    const {
      root: workspaceRoot,
      getState,
      actions
    } = context;

    if (
      !workspaceRoot ||
      typeof workspaceRoot.querySelector !== "function" ||
      typeof getState !== "function" ||
      typeof actions?.setRouteDetails !== "function"
    ) {
      throw new Error(
        "Invalid Route Workspace settings context."
      );
    }

    const quickSlot = workspaceRoot.querySelector(
      '[data-rw-slot="settings-quick"]'
    );

    const fullSlot = workspaceRoot.querySelector(
      '[data-rw-slot="settings"]'
    );

    if (!quickSlot || !fullSlot) {
      throw new Error(
        "The Route Workspace settings containers are missing."
      );
    }

    // Twee weergaven van dezelfde centrale conceptstatus.
    const quickShell = createSettingsShell(
      "quick"
    );

    const fullShell = createSettingsShell(
      "full"
    );

    const panels = [
      {
        slot: quickSlot,
        shell: quickShell,
        originalChildren: Array.from(
          quickSlot.childNodes
        )
      },

      {
        slot: fullSlot,
        shell: fullShell,
        originalChildren: Array.from(
          fullSlot.childNodes
        )
      }
    ];

    const events = new AbortController();

    const listenerOptions = {
      signal: events.signal
    };

    let destroyed = false;

    // --------------------------------------------------------
    // Beide panelen bijwerken
    // --------------------------------------------------------

    function render(snapshot) {
      if (destroyed) {
        return;
      }

      for (const panel of panels) {
        renderSettings(
          panel.shell,
          snapshot
        );
      }
    }

    // --------------------------------------------------------
    // Beide panelen opruimen
    // --------------------------------------------------------

    function destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;

      // Verwijder de listeners van beide panelen.
      events.abort();

      for (const panel of panels) {
        const {
          slot,
          shell,
          originalChildren
        } = panel;

        if (shell.root.parentNode === slot) {
          slot.replaceChildren(
            ...originalChildren
          );
        } else {
          shell.root.remove();
        }
      }
    }

    // --------------------------------------------------------
    // Panelen plaatsen en bediening aansluiten
    // --------------------------------------------------------

    try {
      for (const panel of panels) {
        panel.slot.replaceChildren(
          panel.shell.root
        );

        bindSettingsEvents(
          panel.shell,
          context,
          listenerOptions
        );
      }

      render(
        getState()
      );

    } catch (error) {
      destroy();
      throw error;
    }

    return {
      root: fullShell.root,

      render,

      destroy
    };
  }

  // ==========================================================
  // 8. MODULE REGISTREREN
  // ==========================================================

  workspace.registerModule("settings", {
    mount: mountSettings
  });

  // EINDE DEEL 3 VAN 3
})();


