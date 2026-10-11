/*
 * VEYNOR ROUTE WORKSPACE UI
 * File: /js/planning-engine/route-workspace-ui.js
 *
 * DEEL 1 VAN 3
 *
 * - Structuur van de grote popup
 * - Tabs en modulecontainers
 * - Vaste velden voor berekeningen en meldingen
 *
 * Laden na route-workspace.js.
 * Vormgeving via route-workspace.css.
 *
 * Dit bestand schrijft niets naar de database
 * en bevat geen eigen routeberekeningen.
 */

(function () {
  "use strict";

  const workspace = window.VeynorRouteWorkspace;

  if (!workspace?.registerModule) {
    throw new Error(
      "Load route-workspace.js before route-workspace-ui.js."
    );
  }

  const TABS = [
    ["route", "Route"],
    ["stops", "Stops & Orders"],
    ["vehicle", "Vehicle & Driver"],
    ["settings", "Settings"],
    ["suggestions", "Suggestions"],
    ["summary", "Summary"]
  ];

 const METRICS = [
  ["distance_miles", "Distance", "mi"],
  ["drive_hours", "Drive time", "h"],
  ["service_hours", "Unloading time", "h"],
  ["total_hours", "Total time", "h"],
  ["volume_m3", "Volume", "m³"],
  ["colli", "Colli", "count"],
  ["fill_percent", "Fill rate", "%"],
  ["total_cost_gbp", "Estimated total cost", "GBP"],
  ["cost_per_order_gbp", "Cost per order", "GBP"],
  ["cost_per_stop_gbp", "Cost per stop", "GBP"]
];
  // ==========================================================
  // 1. ELEMENTEN EN WEERGAVEHELPERS
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

  function find(root, selector) {
    return root.querySelector(selector);
  }

  function setText(root, selector, value) {
    const node = find(root, selector);

    if (node) {
      node.textContent = String(value ?? "—");
    }
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
    const digits =
      unit === "count"
        ? 0
        : unit === "%"
          ? 1
          : 2;

    const formatted = formatNumber(value, digits);

    if (formatted === "—") {
      return formatted;
    }

    if (unit === "GBP") {
      return `£${formatted}`;
    }

    if (unit === "count") {
      return formatted;
    }

    return `${formatted} ${unit}`;
  }

  // ==========================================================
  // 2. POPUPSTRUCTUUR
  // ==========================================================

  function createBaseShell() {
    const root = element(
      "dialog",
      "rw-dialog"
    );

    root.id = "veynorRouteWorkspaceDialog";

    root.setAttribute(
      "aria-labelledby",
      "rw-dialog-title"
    );

    root.setAttribute(
      "aria-describedby",
      "rw-dialog-description"
    );

    // Basisafmetingen. De afzonderlijke CSS verzorgt
    // de volledige indeling, kleuren en responsive weergave.
root.style.cssText = [
  "width:min(1500px,96vw)",
  "max-width:96vw",
  "height:92vh",
  "max-height:92vh",
  "padding:0",
  "border:0",
  "border-radius:0",
  "overflow:auto"
].join(";");

    /*
     * Alleen vaste HTML wordt hieronder ingevoegd.
     * Routegegevens worden later via textContent ingevuld.
     */
    root.innerHTML = `
      <div class="rw-shell">


<header class="rw-header rw-header-compact">


<div class="rw-header-brand">
  <img
    class="rw-header-logo"
    src="/assets/images/veynor-header-logo.png"
    alt="Veynor — Move Business Forward"
    draggable="false"
  >
</div>


  <div class="rw-header-content">

    <div class="rw-header-title-row">
      <h2 id="rw-dialog-title">
        Route Workspace
      </h2>

      <span
        class="rw-badge"
        data-rw="status"
      >
        Loading
      </span>
    </div>

    <div class="rw-header-details rw-header-details-inline">

      <span
        class="rw-route-label"
        data-rw="route-label"
      >
        Loading existing route…
      </span>

      <div class="rw-header-detail">
        <span>Vehicle</span>
        <strong data-rw-header="vehicle">—</strong>
      </div>

      <div class="rw-header-detail">
        <span>Driver</span>
        <strong data-rw-header="driver">—</strong>
      </div>

      <div class="rw-header-detail">
        <span>Planning Date</span>
        <strong data-rw-header="date">—</strong>
      </div>

      <div class="rw-header-detail">
        <span>Departure</span>
        <strong data-rw-header="departure">—</strong>
      </div>

    </div>

    <p
      id="rw-dialog-description"
      class="rw-description"
    >
      Review and optimise your route.
      Changes remain a preview until saved.
    </p>

  </div>

  <button
    type="button"
    class="rw-header-close"
    data-rw-action="close"
    aria-label="Close Route Workspace"
    title="Close"
  >
    ×
  </button>

</header>


        <div
          class="rw-tabs"
          role="tablist"
          aria-label="Route Workspace sections"
          data-rw="tabs"
        ></div>

        <div
          class="rw-notices"
          aria-live="polite"
          aria-atomic="true"
        >
          <p
            class="rw-calculation-status"
            data-rw="calculation-status"
          ></p>

          <p
            class="rw-error"
            data-rw="error"
            role="alert"
            hidden
          ></p>

          <p
            class="rw-action-error"
            data-rw="action-error"
            role="alert"
            hidden
          ></p>

          <p
            class="rw-unsaved"
            data-rw="unsaved"
            hidden
          >
            Unsaved preview changes.
            The stored route has not been changed.
          </p>
        </div>

        <main
          class="rw-main"
          data-rw="main"
          aria-busy="true"
        >

          <section
            class="rw-panel"
            data-rw-panel="route"
          >

            <div class="rw-section-heading">
              <h3>Route map</h3>

              <p>
                Road geometry and delivery locations
                are supplied by the map module.
              </p>
            </div>

            <div
              class="rw-map-slot"
              data-rw-slot="map"
            >
              <p class="rw-module-placeholder">
                The route map module has not been connected yet.
              </p>
            </div>
          </section>

          <section
            class="rw-panel"
            data-rw-panel="stops"
          >
            <div class="rw-stops-layout">

              <section class="rw-card">
                <div class="rw-section-heading">
                  <h3>Delivery Stops</h3>

                  <p data-rw="stop-count">
                    Waiting for route data…
                  </p>
                </div>

                <div data-rw-slot="stops">
                  <p class="rw-module-placeholder">
                    The stops module has not been connected yet.
                  </p>
                </div>
              </section>

              <aside class="rw-card">
                <div class="rw-section-heading">
                  <h3>Route Settings</h3>
                </div>

                <div data-rw-slot="settings-quick">
                  <p class="rw-module-placeholder">
                    The settings module has not been connected yet.
                  </p>
                </div>
              </aside>

            </div>
          </section>

          <section
            class="rw-panel"
            data-rw-panel="vehicle"
          >
            <div class="rw-section-heading">
              <h3>Vehicle & Driver</h3>
            </div>

            <div data-rw="vehicle-content"></div>
          </section>

          <section
            class="rw-panel"
            data-rw-panel="settings"
          >
            <div class="rw-section-heading">
              <h3>Route Settings</h3>
            </div>

            <div data-rw="route-fields"></div>

            <div data-rw-slot="settings">
              <p class="rw-module-placeholder">
                Additional settings will be supplied
                by the settings module.
              </p>
            </div>
          </section>

          <section
            class="rw-panel"
            data-rw-panel="suggestions"
          >
            <div class="rw-section-heading">
              <h3>Route Suggestions</h3>
            </div>

            <div data-rw-slot="suggestions">
              <p class="rw-module-placeholder">
                Route suggestions are not available
                in this version.
              </p>
            </div>
          </section>

          <section
            class="rw-panel"
            data-rw-panel="summary"
          >
            <div class="rw-section-heading">
              <h3>Route Comparison</h3>
            </div>

            <p>
              Stored route totals compared with
              the latest calculated preview.
            </p>

            <div data-rw="comparison"></div>
          </section>

          <div class="rw-bottom-grid">

            <section class="rw-card rw-summary-card">
              <h3>Route Summary</h3>

              <p
                class="rw-summary-source"
                data-rw="summary-source"
              ></p>

              <div
                class="rw-metrics"
                data-rw="metrics"
              ></div>

              <p data-rw="routing-source"></p>
            </section>

            <section class="rw-card rw-warnings-card">
              <h3>Warnings & Messages</h3>

              <div data-rw="warnings"></div>
            </section>

          </div>

        </main>

        <footer class="rw-footer">
          <p data-rw="footer-status">
            No changes saved.
          </p>

          <div class="rw-footer-actions">
            <button
              type="button"
              class="rw-button"
              data-rw-action="reset"
              disabled
            >
              Reset Changes
            </button>

            <button
              type="button"
              class="rw-button rw-button-primary"
              data-rw-action="recalculate"
              disabled
            >
              Recalculate
            </button>

            <button
              type="button"
              class="rw-button"
              data-rw-action="save"
              disabled
              title="Database saving is not enabled"
            >
              Save Route (disabled)
            </button>

            <button
              type="button"
              class="rw-button"
              data-rw-action="close"
            >
              Close
            </button>
          </div>
        </footer>

      </div>
    `;

    // ========================================================
    // 3. TABS AANMAKEN
    // ========================================================

    for (const [key, label] of TABS) {
      const button = element(
        "button",
        "rw-tab",
        label
      );

      button.type = "button";
      button.id = `rw-tab-${key}`;

      button.dataset.rwTab = key;

      button.setAttribute(
        "role",
        "tab"
      );

      button.setAttribute(
        "aria-controls",
        `rw-panel-${key}`
      );

      button.setAttribute(
        "aria-selected",
        "false"
      );

      button.tabIndex = -1;

      find(
        root,
        '[data-rw="tabs"]'
      ).appendChild(button);

      const panel = find(
        root,
        `[data-rw-panel="${key}"]`
      );

      panel.id = `rw-panel-${key}`;

      panel.setAttribute(
        "role",
        "tabpanel"
      );

      panel.setAttribute(
        "aria-labelledby",
        button.id
      );

      panel.hidden = true;
    }

    // ========================================================
    // 4. VASTE SAMENVATTINGSVELDEN
    // ========================================================

    for (const [key, label] of METRICS) {
      const card = element(
        "div",
        "rw-metric"
      );

      const value = element(
        "strong",
        "rw-metric-value",
        "—"
      );

      value.dataset.rwMetric = key;

      card.append(
        element(
          "span",
          "rw-metric-label",
          label
        ),
        value
      );

      find(
        root,
        '[data-rw="metrics"]'
      ).appendChild(card);
    }

    return root;
  }

  // EINDE DEEL 1 VAN 3
  // Plak deel 2 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 5. INVOERVELDEN AANMAKEN
  // ==========================================================

  function createField(labelText, input) {
    const wrapper = element(
      "div",
      "rw-field"
    );

    const label = element(
      "label",
      "rw-field-label",
      labelText
    );

    label.htmlFor = input.id;

    wrapper.append(label, input);

    return wrapper;
  }

  function createControls(root) {
    const vehicleContainer = find(
      root,
      '[data-rw="vehicle-content"]'
    );

    const routeContainer = find(
      root,
      '[data-rw="route-fields"]'
    );

    // --------------------------------------------------------
    // Voertuig
    // --------------------------------------------------------

    const vehicle = element(
      "select",
      "rw-input"
    );

    vehicle.id = "rw-vehicle-select";
    vehicle.dataset.rwField = "vehicle_id";
    vehicle.disabled = true;

    const vehiclePlaceholder = element(
      "option",
      "",
      "Waiting for route data…"
    );

    vehiclePlaceholder.value = "";

    vehicle.appendChild(vehiclePlaceholder);

    vehicleContainer.appendChild(
      createField("Vehicle", vehicle)
    );

    const vehicleDetails = element(
      "p",
      "rw-field-help"
    );

    vehicleDetails.dataset.rw = "vehicle-details";

    vehicleContainer.appendChild(
      vehicleDetails
    );

    // --------------------------------------------------------
    // Chauffeur: voorlopig alleen weergeven
    // --------------------------------------------------------

    const driverCard = element(
      "div",
      "rw-driver-info"
    );

    const driverName = element(
      "p",
      "rw-driver-name",
      "Waiting for route data…"
    );

    driverName.dataset.rw = "driver-name";

    driverCard.append(
      element(
        "h4",
        "",
        "Assigned driver"
      ),

      driverName,

      element(
        "p",
        "rw-field-help",
        "Driver assignment can currently be changed " +
        "through the existing route controls."
      )
    );

    vehicleContainer.appendChild(
      driverCard
    );

    // --------------------------------------------------------
    // Planningsdatum
    // --------------------------------------------------------

    const routeDate = element(
      "input",
      "rw-input"
    );

    routeDate.type = "date";
    routeDate.id = "rw-route-date";
    routeDate.dataset.rwField = "route_date";

    routeDate.required = true;
    routeDate.disabled = true;

    routeContainer.appendChild(
      createField(
        "Planning date",
        routeDate
      )
    );

    // --------------------------------------------------------
    // Vertrektijd
    // --------------------------------------------------------

    const startTime = element(
      "input",
      "rw-input"
    );

    startTime.type = "time";
    startTime.id = "rw-start-time";
    startTime.dataset.rwField = "start_time";

    startTime.step = "60";
    startTime.required = true;
    startTime.disabled = true;

    routeContainer.appendChild(
      createField(
        "Departure time",
        startTime
      )
    );

    routeContainer.appendChild(
      element(
        "p",
        "rw-field-help",
        "Changes are recalculated as a preview. " +
        "Nothing is saved to the stored route."
      )
    );

    return {
      vehicle,
      routeDate,
      startTime
    };
  }

  // ==========================================================
  // 6. MELDINGEN VAN BEDIENINGSACTIES
  // ==========================================================

  function showActionError(root, error) {
    if (!root.isConnected) {
      return;
    }

    const node = find(
      root,
      '[data-rw="action-error"]'
    );

    if (!node) {
      return;
    }

    node.textContent =
      error?.message ||
      String(error || "Action failed.");

    node.hidden = false;
  }

  function clearActionError(root) {
    const node = find(
      root,
      '[data-rw="action-error"]'
    );

    if (!node) {
      return;
    }

    node.textContent = "";
    node.hidden = true;
  }

  // ==========================================================
  // 7. POPUP OPBOUWEN EN BEDIENING AANSLUITEN
  // ==========================================================

  function mountUI(context) {
    const {
      getState,
      actions
    } = context;

    if (
      typeof getState !== "function" ||
      typeof actions?.close !== "function"
    ) {
      throw new Error(
        "Invalid Route Workspace UI context."
      );
    }

    if (
      document.getElementById(
        "veynorRouteWorkspaceDialog"
      )
    ) {
      throw new Error(
        "A Route Workspace dialog already exists."
      );
    }

    const root = createShell();

    if (
      typeof root.showModal !== "function"
    ) {
      throw new Error(
        "This browser does not support modal dialogs."
      );
    }

    const controls = createControls(root);

    const events = new AbortController();

    const listenerOptions = {
      signal: events.signal
    };

    let destroyed = false;

    // --------------------------------------------------------
    // Acties uitvoeren met foutafhandeling
    // --------------------------------------------------------

    async function runAction(callback) {
      if (destroyed) {
        return;
      }

      clearActionError(root);

      try {
        await callback();

      } catch (error) {
        if (destroyed) {
          return;
        }

        // Zet de velden terug naar de actuele conceptstatus
        // wanneer de controller een invoerwijziging afwijst.
        try {
          renderState(
            root,
            controls,
            getState()
          );
        } catch (renderError) {
          console.error(
            "[RouteWorkspace:UI] Could not refresh the interface.",
            renderError
          );
        }

        showActionError(
          root,
          error
        );
      }
    }

    // --------------------------------------------------------
    // Knoppen en tabs
    // --------------------------------------------------------

    root.addEventListener(
      "click",
      event => {
        const target = event.target;

        if (!(target instanceof Element)) {
          return;
        }

        const tabButton = target.closest(
          "[data-rw-tab]"
        );

        if (
          tabButton &&
          root.contains(tabButton)
        ) {
          if (tabButton.disabled) {
            return;
          }

          void runAction(() => {
            actions.setTab(
              tabButton.dataset.rwTab
            );
          });

          return;
        }

        const button = target.closest(
          "[data-rw-action]"
        );

        if (
          !button ||
          !root.contains(button) ||
          button.disabled
        ) {
          return;
        }

        const action =
          button.dataset.rwAction;

        switch (action) {
          case "close":
            void runAction(() => {
              actions.close();
            });
            break;

          case "reset":
            void runAction(() => {
              actions.reset();
            });
            break;

          case "recalculate":
            void runAction(() => {
              return actions.recalculate();
            });
            break;

          case "save":
            // De knop blijft disabled.
            // Ook de controller blokkeert deze actie.
            void runAction(() => {
              return actions.save();
            });
            break;
        }
      },
      listenerOptions
    );

    // --------------------------------------------------------
    // Routevelden aanpassen
    // --------------------------------------------------------

    root.addEventListener(
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

        const field =
          input.dataset.rwField;

        if (
          !field ||
          input.disabled
        ) {
          return;
        }

        const supportedFields = [
          "vehicle_id",
          "route_date",
          "start_time"
        ];

        if (
          !supportedFields.includes(field)
        ) {
          return;
        }

        void runAction(() => {
          if (!input.checkValidity()) {
            throw new Error(
              "Enter a valid value for this field."
            );
          }

          actions.setRouteDetails({
            [field]: input.value
          });
        });
      },
      listenerOptions
    );

    // --------------------------------------------------------
    // Tabs bedienen met het toetsenbord
    // --------------------------------------------------------

    root.addEventListener(
      "keydown",
      event => {
        const target = event.target;

        if (!(target instanceof Element)) {
          return;
        }

        const currentTab = target.closest(
          "[data-rw-tab]"
        );

        if (!currentTab) {
          return;
        }

        const handledKeys = [
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End"
        ];

        if (
          !handledKeys.includes(event.key)
        ) {
          return;
        }

        const buttons = Array.from(
          root.querySelectorAll(
            "[data-rw-tab]"
          )
        ).filter(button => {
          return !button.disabled;
        });

        const currentIndex =
          buttons.indexOf(currentTab);

        if (
          currentIndex < 0 ||
          !buttons.length
        ) {
          return;
        }

        event.preventDefault();

        let nextIndex = currentIndex;

        if (event.key === "ArrowLeft") {
          nextIndex =
            (
              currentIndex - 1 + buttons.length
            ) % buttons.length;
        }

        if (event.key === "ArrowRight") {
          nextIndex =
            (
              currentIndex + 1
            ) % buttons.length;
        }

        if (event.key === "Home") {
          nextIndex = 0;
        }

        if (event.key === "End") {
          nextIndex = buttons.length - 1;
        }

        const nextTab = buttons[nextIndex];

        void runAction(() => {
          actions.setTab(
            nextTab.dataset.rwTab
          );

          nextTab.focus();
        });
      },
      listenerOptions
    );

    // --------------------------------------------------------
    // Escape: sluiten via de controller
    // --------------------------------------------------------

    root.addEventListener(
      "cancel",
      event => {
        // Voorkom dat het native dialog zelfstandig sluit.
        // De controller controleert eerst conceptwijzigingen.
        event.preventDefault();

        void runAction(() => {
          actions.close();
        });
      },
      listenerOptions
    );

    // --------------------------------------------------------
    // Onverwachte native sluiting afhandelen
    // --------------------------------------------------------

    root.addEventListener(
      "close",
      () => {
        if (
          destroyed ||
          !getState().isOpen
        ) {
          return;
        }

        void runAction(() => {
          const closed = actions.close();

          // Wanneer de gebruiker wijzigingen wil behouden,
          // openen we het native dialog opnieuw.
          if (
            closed === false &&
            !destroyed &&
            !root.open
          ) {
            root.showModal();
          }
        });
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

      // Verwijdert alle hierboven geregistreerde listeners.
      events.abort();

      try {
        if (root.open) {
          root.close();
        }
      } finally {
        root.remove();
      }
    }

    // --------------------------------------------------------
    // Popup tonen
    // --------------------------------------------------------

    try {
      document.body.appendChild(root);

      // renderState() wordt in deel 3 toegevoegd.
      renderState(
        root,
        controls,
        getState()
      );

      root.showModal();

    } catch (error) {
      destroy();
      throw error;
    }

    /*
     * De controller ontvangt dit handle.
     * De overige modules krijgen root als hun container.
     */
    return {
      root,

      render(snapshot) {
        if (destroyed) {
          return;
        }

        renderState(
          root,
          controls,
          snapshot
        );
      },

      destroy
    };
  }

  // EINDE DEEL 2 VAN 3
  // Plak deel 3 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 8. PLANNERGEGEVENS EN ROUTELABEL
  // ==========================================================

  function getPlannerData(snapshot) {
    const planner = window.VeynorPlannerData;

    if (
      !planner ||
      !snapshot.companyId ||
      String(planner.companyId) !==
        String(snapshot.companyId)
    ) {
      return {};
    }

    return planner;
  }

  function getRouteLabel(snapshot) {
    const route = snapshot.route;

    if (!route) {
      return "Loading existing route…";
    }

    return String(
      route.route_code ||
      route.route_number ||
      route.route_name ||
      route.id ||
      "Existing route"
    );
  }

  function getVehicleLabel(vehicle) {
    return String(
      vehicle.name ||
      vehicle.vehicle_name ||
      vehicle.registration ||
      vehicle.vehicle_code ||
      "Vehicle"
    );
  }

  // ==========================================================
  // 9. VOERTUIGEN EN CHAUFFEUR WEERGEVEN
  // ==========================================================

  function renderVehicle(root, controls, snapshot) {
    const planner = getPlannerData(snapshot);

    const vehicles = Array.isArray(
      planner.activeVehicles
    )
      ? planner.activeVehicles
      : [];

    const options = new Map();

    for (const vehicle of vehicles) {
      if (!vehicle?.id) {
        continue;
      }

      options.set(
        String(vehicle.id),
        getVehicleLabel(vehicle)
      );
    }

    const selectedId = snapshot.draft?.vehicle_id
      ? String(snapshot.draft.vehicle_id)
      : "";

    /*
     * De route kan een voertuig gebruiken dat niet meer
     * in de actieve voertuiglijst staat.
     * Toon dat voertuig alsnog als huidige keuze.
     */
    if (
      selectedId &&
      !options.has(selectedId)
    ) {
      const sources = [
        snapshot.preview?.vehicle,
        snapshot.baseline?.vehicle
      ];

      const matchingVehicle = sources.find(vehicle => {
        return (
          vehicle &&
          String(vehicle.id) === selectedId
        );
      });

      options.set(
        selectedId,
        matchingVehicle
          ? getVehicleLabel(matchingVehicle)
          : "Current route vehicle"
      );
    }

    const optionEntries = [...options];

    const signature = JSON.stringify(
      optionEntries
    );

    // Bouw de select alleen opnieuw wanneer de opties wijzigen.
    if (
      controls.vehicle.dataset.rwOptions !==
      signature
    ) {
      const nodes = [];

      const placeholder = element(
        "option",
        "",
        "Select a vehicle"
      );

      placeholder.value = "";

      nodes.push(placeholder);

      for (const [id, label] of optionEntries) {
        const option = element(
          "option",
          "",
          label
        );

        option.value = id;

        nodes.push(option);
      }

      controls.vehicle.replaceChildren(
        ...nodes
      );

      controls.vehicle.dataset.rwOptions =
        signature;
    }

    controls.vehicle.value = selectedId;

    const calculatedVehicle =
      snapshot.preview?.vehicle;

    const vehicleMatches =
      calculatedVehicle &&
      String(calculatedVehicle.id) === selectedId;

    let details = "Waiting for route data…";

    if (vehicleMatches) {
      details =
        `Calculated capacity: ` +
        formatMetric(
          calculatedVehicle.capacity_m3,
          "m³"
        );
    } else if (selectedId) {
      details =
        "The selected vehicle has not yet been recalculated.";
    }

    setText(
      root,
      '[data-rw="vehicle-details"]',
      details
    );

    // Bestaande veldnamen uit Available Vehicles.
    const driverId =
      snapshot.route?.driver_user_id ||
      snapshot.route?.driver_profile_id ||
      null;

    const drivers = Array.isArray(
      planner.driverUsers
    )
      ? planner.driverUsers
      : [];

    const driver = driverId
      ? drivers.find(candidate => {
          return [
            candidate.id,
            candidate.auth_user_id,
            candidate.profile_id
          ].some(id => {
            return (
              id != null &&
              String(id) === String(driverId)
            );
          });
        })
      : null;

    let driverLabel = "No driver assigned";

    if (driverId) {
      driverLabel = driver
        ? driver.full_name ||
          driver.email ||
          "Assigned driver"
        : "Assigned driver — details unavailable";
    }

    setText(
      root,
      '[data-rw="driver-name"]',
      snapshot.route
        ? driverLabel
        : "Waiting for route data…"
    );
  }

  // ==========================================================
  // 10. TABS EN ROUTEVELDEN
  // ==========================================================

  function renderTabs(root, snapshot) {
    const activeTab = TABS.some(([key]) => {
      return key === snapshot.activeTab;
    })
      ? snapshot.activeTab
      : "stops";

    for (const [key] of TABS) {
      const selected = key === activeTab;

      const button = find(
        root,
        `[data-rw-tab="${key}"]`
      );

      const panel = find(
        root,
        `[data-rw-panel="${key}"]`
      );

      button.setAttribute(
        "aria-selected",
        String(selected)
      );

      button.tabIndex = selected ? 0 : -1;

      button.classList.toggle(
        "is-active",
        selected
      );

      panel.hidden = !selected;
    }
  }

  function renderControls(root, controls, snapshot) {
    const draft = snapshot.draft;

    const editable =
      snapshot.isOpen &&
      Boolean(draft) &&
      snapshot.status !== "loading";

    const capabilities =
      snapshot.capabilities || {};

    controls.vehicle.disabled =
      !editable ||
      capabilities.vehicle !== true;

    controls.routeDate.disabled =
      !editable ||
      capabilities.date !== true;

    controls.startTime.disabled =
      !editable ||
      capabilities.startTime !== true;

    const dateValue = draft?.route_date || "";

    if (controls.routeDate.value !== dateValue) {
      controls.routeDate.value = dateValue;
    }

    // Het invoerveld toont uren en minuten.
    const timeValue = String(
      draft?.start_time || ""
    ).slice(0, 5);

    if (controls.startTime.value !== timeValue) {
      controls.startTime.value = timeValue;
    }

    const calculating =
      snapshot.status === "calculating";

    const resetButton = find(
      root,
      '[data-rw-action="reset"]'
    );

    const recalculateButton = find(
      root,
      '[data-rw-action="recalculate"]'
    );

    const saveButton = find(
      root,
      '[data-rw-action="save"]'
    );

    resetButton.disabled =
      !editable ||
      !snapshot.dirty;

    recalculateButton.disabled =
      !editable ||
      calculating;

    recalculateButton.textContent =
      calculating
        ? "Calculating…"
        : "Recalculate";

    // Deze UI-versie staat opslag nooit toe.
    saveButton.disabled = true;
    saveButton.textContent = "Save Route (disabled)";
  }

  // ==========================================================
  // 11. BEREKENDE SAMENVATTING
  // ==========================================================

  function hasCurrentPreview(snapshot) {
    return (
      Boolean(snapshot.preview) &&
      snapshot.status === "ready" &&
      snapshot.previewRevision === snapshot.revision
    );
  }

  

function renderMetrics(root, snapshot) {
  const preview = snapshot.preview;
  const after = preview?.after || {};
  const vehicle = preview?.vehicle || {};

  // ========================================================
  // 1. BESTAANDE ROUTECIJFERS BIJWERKEN
  // ========================================================

  for (const [key, , unit] of METRICS) {
    let value = after[key];

    if (
      key === "distance_miles" &&
      (value === null || value === undefined || value === "") &&
      after.distance_km !== null &&
      after.distance_km !== undefined &&
      after.distance_km !== "" &&
      Number.isFinite(Number(after.distance_km))
    ) {
      value = Number(after.distance_km) * 0.621371;
    }

    setText(
      root,
      `[data-rw-metric="${key}"]`,
      formatMetric(value, unit)
    );
  }

  // ========================================================
  // 2. ROUTE PERFORMANCE CONTAINER
  // ========================================================

  const summaryCard = find(
    root,
    ".rw-summary-card"
  );

  if (!summaryCard) return;

  let performance = find(
    summaryCard,
    '[data-rw="performance"]'
  );

  if (!performance) {
    performance = element(
      "div",
      "rw-performance"
    );

    performance.dataset.rw = "performance";

    // --------------------------------------------------------
    // Vehicle utilisation
    // --------------------------------------------------------

    const fillSection = element(
      "div",
      "rw-performance-section"
    );

    const fillHeading = element(
      "div",
      "rw-performance-row"
    );

    const fillLabel = element(
      "strong",
      "",
      "Vehicle Utilisation"
    );

    const fillValue = element(
      "strong",
      "",
      "—"
    );

    fillValue.dataset.rwPerformance = "fill-percent";

    fillHeading.append(
      fillLabel,
      fillValue
    );

    const fillTrack = element(
      "div",
      "rw-performance-track"
    );

    fillTrack.setAttribute(
      "role",
      "progressbar"
    );

    fillTrack.setAttribute(
      "aria-label",
      "Vehicle utilisation"
    );

    fillTrack.setAttribute(
      "aria-valuemin",
      "0"
    );

    fillTrack.setAttribute(
      "aria-valuemax",
      "100"
    );

    const fillBar = element(
      "div",
      "rw-performance-fill"
    );

    fillBar.dataset.rwPerformance = "fill-bar";

    const targetMarker = element(
      "div",
      "rw-performance-target"
    );

    fillTrack.append(
      fillBar,
      targetMarker
    );

    const fillLegend = element(
      "div",
      "rw-performance-legend"
    );

    const loaded = element(
      "span",
      "",
      "Loaded: —"
    );

    loaded.dataset.rwPerformance = "loaded";

    const capacity = element(
      "span",
      "",
      "Capacity: —"
    );

    capacity.dataset.rwPerformance = "capacity";

    fillLegend.append(
      loaded,
      capacity
    );

    fillSection.append(
      fillHeading,
      fillTrack,
      fillLegend
    );

    // --------------------------------------------------------
    // Driving and unloading distribution
    // --------------------------------------------------------

    const timeSection = element(
      "div",
      "rw-performance-section"
    );

    const timeHeading = element(
      "div",
      "rw-performance-row"
    );

    timeHeading.append(
      element(
        "strong",
        "",
        "Route Time Distribution"
      ),
      element(
        "span",
        "",
        "Driving vs unloading"
      )
    );

    const timeTrack = element(
      "div",
      "rw-performance-time"
    );

    const drivingBar = element(
      "div",
      "rw-performance-driving"
    );

    drivingBar.dataset.rwPerformance = "driving-bar";

    const unloadingBar = element(
      "div",
      "rw-performance-unloading"
    );

    unloadingBar.dataset.rwPerformance = "unloading-bar";

    timeTrack.append(
      drivingBar,
      unloadingBar
    );

    const timeLegend = element(
      "div",
      "rw-performance-legend"
    );

    const drivingLabel = element(
      "span",
      "",
      "Driving: —"
    );

    drivingLabel.dataset.rwPerformance = "driving";

    const unloadingLabel = element(
      "span",
      "",
      "Unloading: —"
    );

    unloadingLabel.dataset.rwPerformance = "unloading";

    timeLegend.append(
      drivingLabel,
      unloadingLabel
    );

    timeSection.append(
      timeHeading,
      timeTrack,
      timeLegend
    );

    performance.append(
      fillSection,
      timeSection
    );

    const metrics = find(
      summaryCard,
      '[data-rw="metrics"]'
    );

    if (metrics) {
      metrics.before(performance);
    } else {
      summaryCard.appendChild(performance);
    }
  }

  // ========================================================
  // 3. FILL RATE BEREKENEN
  // ========================================================

  function validNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return null;
    }

    return Number(value);
  }

  const loadedVolume = validNumber(after.volume_m3);

  const vehicleCapacity = validNumber(
    vehicle.capacity_m3
  );

  let fillPercent = validNumber(
    after.fill_percent
  );

  if (
    fillPercent === null &&
    loadedVolume !== null &&
    vehicleCapacity !== null &&
    vehicleCapacity > 0
  ) {
    fillPercent =
      (loadedVolume / vehicleCapacity) * 100;
  }

  const fillBar = find(
    performance,
    '[data-rw-performance="fill-bar"]'
  );

  const fillTrack = fillBar?.parentElement;

  if (fillBar) {
    fillBar.style.width = fillPercent !== null
      ? `${Math.max(0, Math.min(100, fillPercent))}%`
      : "0%";

    fillBar.style.background =
      fillPercent !== null && fillPercent > 100
        ? "#dc2626"
        : "#0866ff";
  }

  if (fillTrack) {
    if (fillPercent !== null) {
      fillTrack.setAttribute(
        "aria-valuenow",
        String(
          Math.max(0, Math.min(100, fillPercent))
        )
      );

      fillTrack.removeAttribute("aria-valuetext");
    } else {
      fillTrack.removeAttribute("aria-valuenow");

      fillTrack.setAttribute(
        "aria-valuetext",
        "Vehicle utilisation unavailable"
      );
    }
  }

  setText(
    performance,
    '[data-rw-performance="fill-percent"]',
    fillPercent !== null
      ? `${formatNumber(fillPercent, 1)}%`
      : "—"
  );

  setText(
    performance,
    '[data-rw-performance="loaded"]',
    `Loaded: ${formatMetric(loadedVolume, "m³")}`
  );

  setText(
    performance,
    '[data-rw-performance="capacity"]',
    `Capacity: ${formatMetric(vehicleCapacity, "m³")}`
  );

  // ========================================================
  // 4. ROUTE TIME DISTRIBUTION
  // ========================================================

  const driveHours = validNumber(
    after.drive_hours
  );

  const serviceHours = validNumber(
    after.service_hours
  );

  const knownHours =
    (driveHours || 0) +
    (serviceHours || 0);

  let drivingPercent = 0;
  let unloadingPercent = 0;

  if (
    driveHours !== null &&
    serviceHours !== null &&
    knownHours > 0
  ) {
    drivingPercent =
      (driveHours / knownHours) * 100;

    unloadingPercent =
      (serviceHours / knownHours) * 100;
  }

  const drivingBar = find(
    performance,
    '[data-rw-performance="driving-bar"]'
  );

  const unloadingBar = find(
    performance,
    '[data-rw-performance="unloading-bar"]'
  );

  if (drivingBar) {
    drivingBar.style.width =
      `${Math.max(0, Math.min(100, drivingPercent))}%`;
  }

  if (unloadingBar) {
    unloadingBar.style.width =
      `${Math.max(0, Math.min(100, unloadingPercent))}%`;
  }

  setText(
    performance,
    '[data-rw-performance="driving"]',
    `Driving: ${formatMetric(driveHours, "h")}`
  );

  setText(
    performance,
    '[data-rw-performance="unloading"]',
    `Unloading: ${formatMetric(serviceHours, "h")}`
  );

  // ========================================================
  // 5. ROUTE CALCULATION STATUS
  // ========================================================

  let sourceText =
    "Waiting for the first route calculation.";

  if (preview) {
    sourceText = hasCurrentPreview(snapshot)
      ? "Calculated for the current route preview."
      : "Previous calculation. Recalculation is required.";
  }

  setText(
    root,
    '[data-rw="summary-source"]',
    sourceText
  );

  let routingText = "Routing source: —";

  if (preview?.routing_source === "osrm") {
    routingText =
      "Routing source: OSRM road calculation";
  } else if (preview?.routing_source) {
    routingText =
      `Routing source: ${preview.routing_source} (estimated)`;
  }

  setText(
    root,
    '[data-rw="routing-source"]',
    routingText
  );

  // ========================================================
  // 6. STOP COUNT SUMMARY
  // ========================================================

  let stopText = "Waiting for route data…";

  if (preview?.after) {
    stopText = [
      `${formatNumber(after.stops, 0)} locations`,
      `${formatNumber(after.orders, 0)} orders`,
      formatMetric(after.volume_m3, "m³"),
      `${formatNumber(after.colli, 0)} colli`
    ].join(" · ");

    if (!hasCurrentPreview(snapshot)) {
      stopText += " · recalculation pending";
    }
  }

  setText(
    root,
    '[data-rw="stop-count"]',
    stopText
  );
}

  // ==========================================================
  // 12. WAARSCHUWINGEN EN VALIDATIE
  // ==========================================================

  function renderWarnings(root, snapshot) {
    const container = find(
      root,
      '[data-rw="warnings"]'
    );

    const preview = snapshot.preview;

    container.replaceChildren();

    if (!preview) {
      container.appendChild(
        element(
          "p",
          "rw-message",
          "Waiting for route validation."
        )
      );

      return;
    }

    if (!hasCurrentPreview(snapshot)) {
      container.appendChild(
        element(
          "p",
          "rw-message rw-message-warning",
          "The current preview has not been successfully " +
          "recalculated. Previous validation messages follow."
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

      container.appendChild(list);
    }

    if (preview.valid === false) {
      container.appendChild(
        element(
          "p",
          "rw-message rw-message-error",
          "The Planning Engine marks this route as invalid."
        )
      );
    } else if (
      preview.valid === true &&
      !warnings.length
    ) {
      container.appendChild(
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
      container.appendChild(
        element(
          "p",
          "rw-message rw-message-warning",
          "The Planning Engine did not return a validation status."
        )
      );
    }

    if (preview.routing_source !== "osrm") {
      container.appendChild(
        element(
          "p",
          "rw-message rw-message-warning",
          "A verified OSRM road calculation is unavailable. " +
          "Distance and cost figures may be estimates."
        )
      );
    }

    container.appendChild(
      element(
        "p",
        "rw-message rw-message-info",
        "Saving is disabled. The stored route has not been changed."
      )
    );
  }

  // ==========================================================
  // 13. OPGESLAGEN ROUTE EN PREVIEW VERGELIJKEN
  // ==========================================================



function renderComparison(root, snapshot) {
  const container = find(
    root,
    '[data-rw="comparison"]'
  );

  if (!container) return;

  container.replaceChildren();

  const preview = snapshot.preview;

  if (!preview?.before || !preview?.after) {
    container.appendChild(
      element(
        "p",
        "rw-message",
        "Stored route totals are not available for comparison."
      )
    );
    return;
  }

  // ========================================================
  // DISTANCE CONVERSION
  // ========================================================

  function distanceMiles(source) {
    if (!source) return null;

    if (
      source.distance_miles != null &&
      source.distance_miles !== "" &&
      Number.isFinite(Number(source.distance_miles))
    ) {
      return Number(source.distance_miles);
    }

    if (
      source.distance_km != null &&
      source.distance_km !== "" &&
      Number.isFinite(Number(source.distance_km))
    ) {
      return Number(source.distance_km) * 0.621371;
    }

    return null;
  }

  function metricValue(source, key) {
    if (key === "distance_miles") {
      return distanceMiles(source);
    }

    const value = source?.[key];

    return value != null &&
      value !== "" &&
      Number.isFinite(Number(value))
      ? Number(value)
      : null;
  }

  // ========================================================
  // COMPARISON TABLE
  // ========================================================

  const table = element(
    "table",
    "rw-comparison-table"
  );

  const caption = element(
    "caption",
    "",
    hasCurrentPreview(snapshot)
      ? "Stored route versus current preview"
      : "Stored route versus previous calculation"
  );

  table.appendChild(caption);

  const head = element("thead");
  const headRow = element("tr");

  for (const title of [
    "Metric",
    "Stored route",
    "Preview",
    "Difference"
  ]) {
    const cell = element("th", "", title);
    cell.scope = "col";
    headRow.appendChild(cell);
  }

  head.appendChild(headRow);

  const body = element("tbody");

  const comparisonMetrics = [
    ["distance_miles", "Distance", "mi"],
    ["total_hours", "Total time", "h"],
    ["volume_m3", "Volume", "m³"],
    ["total_cost_gbp", "Estimated total cost", "GBP"]
  ];

  for (const [key, label, unit] of comparisonMetrics) {
    const row = element("tr");

    const heading = element(
      "th",
      "",
      label
    );

    heading.scope = "row";

    const before = metricValue(
      preview.before,
      key
    );

    const after = metricValue(
      preview.after,
      key
    );

    // Verschil berekenen uit dezelfde eenheden.
    const difference =
      before !== null && after !== null
        ? after - before
        : null;

    let differenceText = formatMetric(
      difference,
      unit
    );

    if (
      difference !== null &&
      difference > 0
    ) {
      differenceText = `+${differenceText}`;
    }

    row.append(
      heading,
      element(
        "td",
        "",
        formatMetric(before, unit)
      ),
      element(
        "td",
        "",
        formatMetric(after, unit)
      ),
      element(
        "td",
        "",
        differenceText
      )
    );

    body.appendChild(row);
  }

  table.append(
    head,
    body
  );

  container.appendChild(table);
}

  // ==========================================================
  // 14. ALGEMENE STATUS EN FOUTMELDINGEN
  // ==========================================================

  function renderStatus(root, snapshot) {
    const statusLabels = {
      closed: "Closed",
      loading: "Loading",
      ready: snapshot.dirty
        ? "Modified preview"
        : "Preview",
      stale: "Recalculation pending",
      calculating: "Calculating",
      error: "Error"
    };

    const statusMessages = {
      closed: "",
      loading: "Loading the existing route and calculating its preview…",
      ready: "Route calculation completed. No changes have been saved.",
      stale: "Changes are waiting to be recalculated.",
      calculating: "Recalculating the current route preview…",
      error: "The last action or route calculation could not be completed."
    };

    setText(
      root,
      '[data-rw="status"]',
      statusLabels[snapshot.status] || "Preview"
    );

    setText(
      root,
      '[data-rw="calculation-status"]',
      statusMessages[snapshot.status] || ""
    );

    const badge = find(
      root,
      '[data-rw="status"]'
    );

    badge.dataset.status = snapshot.status;

    const errorNode = find(
      root,
      '[data-rw="error"]'
    );

    errorNode.textContent =
      snapshot.error || "";

    errorNode.hidden =
      !snapshot.error;

    const unsavedNode = find(
      root,
      '[data-rw="unsaved"]'
    );

    unsavedNode.hidden =
      !snapshot.dirty;

    const busy =
      snapshot.status === "loading" ||
      snapshot.status === "calculating";

    find(
      root,
      '[data-rw="main"]'
    ).setAttribute(
      "aria-busy",
      String(busy)
    );

    setText(
      root,
      '[data-rw="footer-status"]',
      snapshot.dirty
        ? "Unsaved preview changes · Saving disabled"
        : "No changes saved · Saving disabled"
    );
  }

  // ==========================================================
  // 15. CENTRALE RENDERFUNCTIE
  // ==========================================================


function createShell() {
  const root = createBaseShell();

  const routePanel = find(root, '[data-rw-panel="route"]');
  const mapSlot = find(root, '[data-rw-slot="map"]');
  const quickSettings = find(root, '[data-rw-slot="settings-quick"]');
  const oldSettingsCard = quickSettings?.closest(".rw-card");

  if (!routePanel || !mapSlot || !quickSettings) {
    throw new Error("Route Workspace layout containers are missing.");
  }

  // ==========================================================
  // WIDE WORKSPACE LAYOUT
  // ==========================================================

  root.style.width = "min(1800px, 98vw)";
  root.style.maxWidth = "98vw";
  root.style.height = "96dvh";
  root.style.maxHeight = "96dvh";

  const style = element("style");
  style.dataset.rwOverviewStyle = "layout-v4";

  style.textContent = `
    .rw-dialog .rw-shell {
      min-width: 0;
    }

    .rw-dialog .rw-main,
    .rw-dialog [data-rw-panel="route"] {
      min-width: 0;
      width: 100%;
    }

    .rw-dialog .rw-overview-meta {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .rw-dialog .rw-overview-meta-item {
      min-width: 0;
      padding: 11px 14px;
      border: 1px solid #dce5f2;
      border-radius: 10px;
      background: #fff;
    }

    .rw-dialog .rw-overview-meta-item span {
      display: block;
      margin-bottom: 5px;
      color: #667085;
      font-size: 11px;
    }

    .rw-dialog .rw-overview-meta-item strong {
      display: block;
      color: #10233f;
      font-size: 14px;
      overflow-wrap: anywhere;
    }

    /* KAART + STOPS GEBRUIKEN DE VOLLEDIGE BREEDTE */

    .rw-dialog .rw-overview-grid {
      display: grid;
      grid-template-columns:
        minmax(0, 1.8fr)
        minmax(340px, 1fr);
      gap: 12px;
      align-items: stretch;
      width: 100%;
    }

    .rw-dialog .rw-overview-grid > .rw-card {
      min-width: 0;
      padding: 14px;
    }

    .rw-dialog .rw-overview-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .rw-dialog .rw-overview-map,
    .rw-dialog .rw-overview-stops-card {
      min-width: 0;
    }

    .rw-dialog .rw-overview-map {
      display: flex;
      flex-direction: column;
    }

    .rw-dialog .rw-overview-map .rw-map-slot,
    .rw-dialog .rw-overview-map .rw-map-module {
      width: 100%;
      min-width: 0;
    }

    /* Leaflet-kaart: inline hoogte uit de mapmodule overrulen */

    .rw-dialog .rw-overview-map
    .rw-map-canvas:not(.rw-map-expanded .rw-map-canvas) {
      height: 650px !important;
      min-height: 650px !important;
    }

    /* DELIVERY STOPS */

    .rw-dialog .rw-overview-stops-card {
      display: flex;
      flex-direction: column;
    }

    .rw-dialog .rw-overview-stops {
      max-height: 650px;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 5px;
      scrollbar-width: thin;
    }

    .rw-dialog .rw-overview-stop {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      gap: 10px;
      padding: 11px 5px;
      border-bottom: 1px solid #e5eaf2;
      background: #fff;
    }

    .rw-dialog .rw-overview-stop:last-child {
      border-bottom: 0;
    }

    .rw-dialog .rw-overview-stop-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #0866ff;
      color: #fff;
      font-weight: 800;
    }

    .rw-dialog .rw-overview-stop p {
      margin: 4px 0 0;
      font-size: 11px;
      color: #667085;
      line-height: 1.4;
    }

    .rw-dialog .rw-overview-stop-time {
      color: #0866ff !important;
    }

    .rw-dialog .rw-overview-caption {
      margin: 6px 0;
      color: #667085;
      font-size: 11px;
    }

    /* INSTELLINGEN ONDER DE KAART EN STOPS */

    .rw-dialog .rw-overview-settings {
      margin-top: 12px;
      width: 100%;
    }

    .rw-dialog .rw-overview-settings summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 800;
      color: #10233f;
      list-style: none;
    }

    .rw-dialog .rw-overview-settings summary::-webkit-details-marker {
      display: none;
    }

    .rw-dialog .rw-overview-settings summary::after {
      content: "⌄";
      color: #0866ff;
      font-size: 20px;
    }

    .rw-dialog .rw-overview-settings[open] summary::after {
      content: "⌃";
    }

    .rw-dialog .rw-overview-settings-content {
      padding: 0 16px 16px;
      border-top: 1px solid #e5eaf2;
    }

    .rw-dialog .rw-overview-settings
    .rw-settings-status,
    .rw-dialog .rw-overview-settings
    .rw-field-help,
    .rw-dialog .rw-overview-settings
    .rw-settings-note {
      display: none;
    }

    .rw-dialog .rw-overview-settings
    .rw-setting-feature {
      padding: 8px 0;
    }

    /* SUGGESTIONS */

    .rw-dialog .rw-overview-suggestions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
    }

    .rw-dialog .rw-overview-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }


/* ========================================================
   ROUTE KPI DASHBOARD
   ======================================================== */

.rw-dialog .rw-route-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0 0 14px;
  width: 100%;
}

.rw-dialog .rw-route-kpi {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 17px 18px;
  border: 1px solid #dce5f2;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(16,35,63,.04);
  transition:
    box-shadow .2s ease,
    transform .2s ease;
}

.rw-dialog .rw-route-kpi:hover {
  box-shadow: 0 6px 20px rgba(16,35,63,.10);
  transform: translateY(-2px);
}

.rw-dialog .rw-route-kpi-label {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: .4px;
}

.rw-dialog .rw-route-kpi-value {
  font-size: clamp(20px, 2vw, 29px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -.6px;
  color: #10233f;
  font-variant-numeric: tabular-nums;
}

.rw-dialog .rw-route-kpi-detail {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.rw-dialog .rw-route-kpi-fill-track {
  width: 100%;
  height: 9px;
  overflow: hidden;
  border-radius: 99px;
  background: #e8edf5;
  margin-top: 3px;
}

.rw-dialog .rw-route-kpi-fill-bar {
  width: 0%;
  height: 100%;
  background: #0866ff;
  border-radius: inherit;
  transition: width .3s ease;
}

.rw-dialog .rw-route-kpi-stale {
  border-style: dashed;
  border-color: #e6bc72;
}

@media (max-width: 1050px) {
  .rw-dialog .rw-route-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .rw-dialog .rw-route-kpis {
    grid-template-columns: minmax(0, 1fr);
  }
}


    /* ROUTE PERFORMANCE */

    .rw-dialog .rw-bottom-grid {
      margin-top: 12px;
      align-items: start;
    }

    .rw-dialog .rw-performance {
      display: grid;
      gap: 16px;
      margin: 14px 0;
    }

    .rw-dialog .rw-performance-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 7px;
      font-size: 12px;
    }

    .rw-dialog .rw-performance-track {
      position: relative;
      display: flex;
      width: 100%;
      height: 18px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8edf5;
    }

    .rw-dialog .rw-performance-fill {
      height: 100%;
      width: 0%;
      background: #0866ff;
      border-radius: inherit;
      transition: width .25s ease;
    }

    .rw-dialog .rw-performance-target {
      position: absolute;
      left: 75%;
      top: 0;
      bottom: 0;
      border-left: 2px dashed #10233f;
      z-index: 2;
    }

    .rw-dialog .rw-performance-time {
      display: flex;
      height: 18px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8edf5;
    }

    .rw-dialog .rw-performance-driving {
      width: 0%;
      background: #0866ff;
    }

    .rw-dialog .rw-performance-unloading {
      width: 0%;
      background: #f59e0b;
    }

    .rw-dialog .rw-performance-legend {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 7px;
      color: #667085;
      font-size: 11px;
    }

    @media (max-width: 1000px) {
      .rw-dialog .rw-overview-grid {
        grid-template-columns: minmax(0, 1.2fr) minmax(300px, 1fr);
      }

      .rw-dialog .rw-overview-map .rw-map-canvas {
        height: 520px !important;
        min-height: 520px !important;
      }

      .rw-dialog .rw-overview-stops {
        max-height: 520px;
      }
    }

    @media (max-width: 760px) {
      .rw-dialog .rw-overview-grid {
        grid-template-columns: minmax(0, 1fr);
      }

      .rw-dialog .rw-overview-meta {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .rw-dialog .rw-overview-map .rw-map-canvas {
        height: 400px !important;
        min-height: 400px !important;
      }

      .rw-dialog .rw-overview-stops {
        max-height: 450px;
      }
    }
  `;

  root.appendChild(style);

  // ==========================================================
  // HERGEBRUIK DE BESTAANDE KAART
  // ==========================================================

  routePanel.replaceChildren();

function detailButton(label, tab) {
    const button = element("button", "rw-button", label);
    button.type = "button";

    button.addEventListener("click", () => {
      clearActionError(root);

      try {
        workspace.setTab(tab);
      } catch (error) {
        showActionError(root, error);
      }
    });

    return button;
  }

  function card(title, className, tab) {
    const section = element(
      "section",
      `rw-card ${className}`
    );

    const heading = element(
      "div",
      "rw-overview-heading"
    );

    heading.appendChild(element("h3", "", title));

    if (tab) {
      heading.appendChild(
        detailButton("Details", tab)
      );
    }

    section.appendChild(heading);
    return section;
  }

  // ==========================================================
  // TWEE KOLOMMEN
  // ==========================================================

  const grid = element("div", "rw-overview-grid");

  const mapCard = card(
    "Interactive Route Map",
    "rw-overview-map"
  );

  mapCard.appendChild(mapSlot);

  const stopsCard = card(
    "Delivery Stops",
    "rw-overview-stops-card",
    "stops"
  );

  const count = element(
    "p",
    "rw-overview-caption",
    "Waiting for route data…"
  );

  count.dataset.rwOverview = "stop-count";

  const timing = element(
    "p",
    "rw-overview-caption"
  );

  timing.dataset.rwOverview = "timing-status";

  const stops = element(
    "div",
    "rw-overview-stops"
  );

  stops.dataset.rwOverview = "stops";

  stopsCard.append(count, timing, stops);
  grid.append(mapCard, stopsCard);

  // ==========================================================
  // INSTELLINGEN ONDERAAN, STANDAARD INGEKLAPT
  // ==========================================================

  const settings = element(
    "details",
    "rw-card rw-overview-settings"
  );

  settings.open = false;

  const settingsSummary = element(
    "summary",
    "",
    "Route Settings & Unloading"
  );

  const settingsContent = element(
    "div",
    "rw-overview-settings-content"
  );

  settingsContent.appendChild(quickSettings);
  settings.append(settingsSummary, settingsContent);

  oldSettingsCard?.remove();

  const detailLayout = find(
    root,
    '[data-rw-panel="stops"] .rw-stops-layout'
  );

  if (detailLayout) {
    detailLayout.style.gridTemplateColumns = "minmax(0, 1fr)";
  }

  // ==========================================================
  // SUGGESTIONS & NOTIFICATIONS
  // ==========================================================

  const suggestions = element(
    "section",
    "rw-card rw-overview-suggestions"
  );

  const description = element("div");

  description.append(
    element("h3", "", "Suggestions & Notifications"),
    element(
      "p",
      "rw-overview-caption",
      "Review suggestions or notify retailers about this route."
    )
  );

  const actions = element(
    "div",
    "rw-overview-actions"
  );

  const notify = element(
    "button",
    "rw-button",
    "Notify Retailers"
  );

  notify.type = "button";
  notify.disabled = true;
  notify.title = "Automatic email notification coming soon";

  actions.append(
    detailButton("View Suggestions", "suggestions"),
    notify
  );

  suggestions.append(
    description,
    actions,
    element(
      "p",
      "rw-overview-caption",
      "Automatic email notification coming soon."
    )
  );

const routeKpis = element(
  "div",
  "rw-route-kpis"
);

routeKpis.dataset.rw = "route-kpis";

routePanel.append(
  routeKpis,
  grid,
  settings,
  suggestions
);

  return root;
}



function renderRouteKpis(root, snapshot) {
  const container = find(root, '[data-rw="route-kpis"]');
  if (!container) return;

  const preview = snapshot.preview;
  const after = preview?.after || {};
  const vehicle = preview?.vehicle || {};
  const current = hasCurrentPreview(snapshot);

  function numeric(value) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return null;
    }
    return Number(value);
  }

  function format(value, digits = 2) {
    return value === null
      ? "—"
      : formatNumber(value, digits);
  }

  function iconSvg(type) {
    const paths = {
      distance: `
        <circle cx="6" cy="17" r="2"/>
        <circle cx="18" cy="6" r="2"/>
        <path d="M8 17h5a4 4 0 0 0 4-4V8"/>
        <path d="M6 15V8a4 4 0 0 1 4-4h3"/>
      `,
      duration: `
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 7v5l3.5 2"/>
      `,
      fill: `
        <path d="m12 2 9 5-9 5-9-5 9-5Z"/>
        <path d="M3 7v10l9 5 9-5V7"/>
        <path d="M12 12v10"/>
      `,
      cost: `
        <ellipse cx="12" cy="5" rx="8" ry="3"/>
        <path d="M4 5v5c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>
        <path d="M4 10v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5"/>
        <path d="M4 15v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4"/>
      `
    };

    return `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="25"
        height="25"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        ${paths[type] || ""}
      </svg>
    `;
  }

  // ========================================================
  // 1. CREATE CARDS ONCE
  // ========================================================

  if (!container.dataset.rwInitialized) {
    const definitions = [
      ["distance", "Route Distance"],
      ["duration", "Total Route Time"],
      ["fill", "Vehicle Fill Rate"],
      ["cost", "Estimated Route Cost"]
    ];

    const cards = definitions.map(([key, label]) => {
      const card = element(
        "section",
        `rw-route-kpi rw-route-kpi-${key}`
      );

      card.dataset.rwKpi = key;

      const top = element("div", "rw-kpi-top");

      const icon = element("span", "rw-route-kpi-icon");
      icon.innerHTML = iconSvg(key);

      const status = element("span", "rw-kpi-status");
      status.dataset.rwKpiStatus = key;

      top.append(icon, status);

      const labelNode = element(
        "span",
        "rw-route-kpi-label",
        label
      );

      const valueNode = element(
        "strong",
        "rw-route-kpi-value",
        "—"
      );
      valueNode.dataset.rwKpiValue = key;

      const detailNode = element(
        "span",
        "rw-route-kpi-detail",
        "Waiting for calculation…"
      );
      detailNode.dataset.rwKpiDetail = key;

      card.append(top, labelNode, valueNode);

      if (key === "fill") {
        const track = element(
          "div",
          "rw-route-kpi-fill-track"
        );

        track.setAttribute("role", "progressbar");
        track.setAttribute(
          "aria-label",
          "Vehicle capacity utilisation"
        );
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");

        const bar = element(
          "div",
          "rw-route-kpi-fill-bar"
        );
        bar.dataset.rwKpiFill = "bar";

        const target = element(
          "div",
          "rw-kpi-fill-target"
        );
        target.dataset.rwKpiFill = "target";

        track.append(bar, target);
        card.appendChild(track);
      }

      card.appendChild(detailNode);
      return card;
    });

    container.replaceChildren(...cards);
    container.dataset.rwInitialized = "true";
  }

  // ========================================================
  // 2. READ PLANNING ENGINE VALUES
  // ========================================================

  const km = numeric(after.distance_km);

  const distance =
    numeric(after.distance_miles) ??
    (km !== null ? km * 0.621371 : null);

  const driveHours = numeric(after.drive_hours);
  const serviceHours = numeric(after.service_hours);

  const totalHours =
    numeric(after.total_hours) ??
    (
      driveHours !== null && serviceHours !== null
        ? driveHours + serviceHours
        : null
    );

  const loadedVolume = numeric(after.volume_m3);
  const capacity = numeric(vehicle.capacity_m3);

  const fillRate =
    numeric(after.fill_percent) ??
    (
      loadedVolume !== null &&
      capacity !== null &&
      capacity > 0
        ? loadedVolume / capacity * 100
        : null
    );

  const cost = numeric(after.total_cost_gbp);
  const orders = numeric(after.orders);

  // ========================================================
  // 3. MAIN VALUES
  // ========================================================

  setText(
    container,
    '[data-rw-kpi-value="distance"]',
    distance !== null
      ? `${format(distance, 1)} mi`
      : "—"
  );

  setText(
    container,
    '[data-rw-kpi-value="duration"]',
    totalHours !== null
      ? `${format(totalHours, 2)} h`
      : "—"
  );

  setText(
    container,
    '[data-rw-kpi-value="fill"]',
    fillRate !== null
      ? `${format(fillRate, 1)}%`
      : "—"
  );

  setText(
    container,
    '[data-rw-kpi-value="cost"]',
    cost !== null
      ? `£${format(cost, 2)}`
      : "—"
  );

  // ========================================================
  // 4. DISTANCE STATUS
  // ========================================================

  const distanceStatus =
    !preview
      ? "Waiting"
      : !current
        ? "Recalculate"
        : preview.routing_source === "osrm"
          ? "OSRM route"
          : "Estimated";

  setText(
    container,
    '[data-rw-kpi-status="distance"]',
    distanceStatus
  );

  setText(
    container,
    '[data-rw-kpi-detail="distance"]',
    !preview
      ? "Waiting for route calculation"
      : current && preview.routing_source === "osrm"
        ? "OSRM road calculation"
        : current
          ? "Route distance estimate"
          : "Previous route calculation"
  );

  // ========================================================
  // 5. ROUTE TIME
  // ========================================================

  setText(
    container,
    '[data-rw-kpi-status="duration"]',
    current ? "Calculated" : "Preview"
  );

  setText(
    container,
    '[data-rw-kpi-detail="duration"]',
    driveHours !== null && serviceHours !== null
      ? `${format(driveHours, 2)} h driving · ` +
        `${format(serviceHours, 2)} h unloading`
      : "Driving and unloading time unavailable"
  );

  // ========================================================
  // 6. VEHICLE UTILISATION
  // ========================================================

  const fillCard = find(
    container,
    '[data-rw-kpi="fill"]'
  );

  const fillBar = find(
    container,
    '[data-rw-kpi-fill="bar"]'
  );

  const fillTarget = find(
    container,
    '[data-rw-kpi-fill="target"]'
  );

  const fillTrack = fillBar?.parentElement;

  const displayedFill =
    fillRate === null
      ? 0
      : Math.max(0, Math.min(100, fillRate));

  if (fillBar) {
    fillBar.style.width = `${displayedFill}%`;

    fillBar.style.background =
      fillRate !== null && fillRate > 100
        ? "#dc2626"
        : "#1267ff";
  }

  if (fillTrack) {
    if (fillRate !== null) {
      fillTrack.setAttribute(
        "aria-valuenow",
        String(displayedFill)
      );
      fillTrack.setAttribute(
        "aria-valuetext",
        `${format(fillRate, 1)}% utilisation`
      );
    } else {
      fillTrack.removeAttribute("aria-valuenow");
      fillTrack.setAttribute(
        "aria-valuetext",
        "Vehicle utilisation unavailable"
      );
    }
  }

  // No hardcoded target percentage.
  // A target marker can be enabled later when a
  // tenant-configured threshold is available.
  if (fillTarget) {
    fillTarget.hidden = true;
  }

  let fillStatus = "Unavailable";
  let fillState = "unknown";

  if (fillRate !== null) {
    if (fillRate > 100) {
      fillStatus = "Over capacity";
      fillState = "danger";
    } else if (fillRate === 100) {
      fillStatus = "Full capacity";
      fillState = "success";
    } else {
      fillStatus = "Capacity available";
      fillState = "normal";
    }
  }

  setText(
    container,
    '[data-rw-kpi-status="fill"]',
    fillStatus
  );

  if (fillCard) {
    fillCard.dataset.fillState = fillState;
  }

  setText(
    container,
    '[data-rw-kpi-detail="fill"]',
    loadedVolume !== null && capacity !== null
      ? `${format(loadedVolume, 2)} m³ loaded · ` +
        `${format(capacity, 2)} m³ capacity`
      : "Vehicle capacity unavailable"
  );

  // ========================================================
  // 7. ESTIMATED COST
  // ========================================================

  setText(
    container,
    '[data-rw-kpi-status="cost"]',
    "Estimate"
  );

  setText(
    container,
    '[data-rw-kpi-detail="cost"]',
    orders !== null && orders > 0 && cost !== null
      ? `£${format(cost / orders, 2)} per order`
      : "Cost per order unavailable"
  );

  // ========================================================
  // 8. STALE PREVIEW INDICATION
  // ========================================================

  const stale = Boolean(preview && !current);

  for (const card of container.querySelectorAll(
    ".rw-route-kpi"
  )) {
    card.classList.toggle(
      "rw-route-kpi-stale",
      stale
    );

    card.setAttribute(
      "aria-busy",
      String(snapshot.status === "calculating")
    );
  }
}

  function renderWorkspaceDriver(root, snapshot) {
    const planner = getPlannerData(snapshot);
    const route = snapshot.route;

    if (!route) {
      setText(
        root,
        '[data-rw="driver-name"]',
        "Waiting for route data…"
      );
      return;
    }

    const plannerRoute = (
      Array.isArray(planner.allRoutes)
        ? planner.allRoutes
        : []
    ).find(candidate =>
      String(candidate.id) === String(route.id)
    );

    const driverId =
      route.driver_user_id ||
      route.driver_profile_id ||
      plannerRoute?.driver_user_id ||
      plannerRoute?.driver_profile_id ||
      null;

    const drivers = Array.isArray(
      planner.driverUsers
    )
      ? planner.driverUsers
      : [];

    const driver = driverId
      ? drivers.find(candidate =>
          [
            candidate.id,
            candidate.auth_user_id,
            candidate.profile_id
          ].some(id =>
            id != null &&
            String(id) === String(driverId)
          )
        )
      : null;

    const label =
      route.driver_name ||
      plannerRoute?.driver_name ||
      driver?.full_name ||
      driver?.email ||
      (
        driverId
          ? "Assigned driver — details unavailable"
          : "No driver assigned"
      );

    setText(
      root,
      '[data-rw="driver-name"]',
      label
    );
  }


function moveOverviewLocation(root, sourceKey, targetKey, after = false) {
  try {
    const snapshot = workspace.getState();

    if (
      !snapshot.isOpen ||
      !snapshot.draft ||
      snapshot.capabilities?.stopOrder !== true
    ) {
      throw new Error("Stop order cannot be changed right now.");
    }

    const locations = Array.isArray(snapshot.preview?.locations)
      ? snapshot.preview.locations
      : [];

    const draftIds = (
      snapshot.draft.stop_order_ids || []
    ).map(String);

    const positions = new Map(
      draftIds.map((id, index) => [id, index])
    );

    const ordered = locations
      .map(location => ({
        ...location,
        order_ids: (location.order_ids || []).map(String)
      }))
      .sort((a, b) => {
        const firstA = Math.min(
          ...a.order_ids.map(id => positions.get(id) ?? Infinity)
        );

        const firstB = Math.min(
          ...b.order_ids.map(id => positions.get(id) ?? Infinity)
        );

        return firstA - firstB;
      });

    const from = ordered.findIndex(
      location => String(location.location_key) === String(sourceKey)
    );

    if (from < 0) {
      throw new Error("Source delivery location not found.");
    }

    if (String(sourceKey) === String(targetKey)) {
      return;
    }

    const [moved] = ordered.splice(from, 1);

    const target = ordered.findIndex(
      location => String(location.location_key) === String(targetKey)
    );

    if (target < 0) {
      throw new Error("Target delivery location not found.");
    }

    ordered.splice(target + (after ? 1 : 0), 0, moved);

    const nextIds = ordered.flatMap(
      location => location.order_ids
    );

    if (nextIds.length !== draftIds.length) {
      throw new Error("Route order count mismatch.");
    }

    clearActionError(root);

    workspace.setStopOrder(nextIds);

  } catch (error) {
    showActionError(root, error);
  }
}





function enableOverviewEditing(root, snapshot) {
  const container = find(root, '[data-rw-overview="stops"]');
  if (!container) return;

  if (!find(root, '[data-rw-overview-style="editing"]')) {
    const style = element("style");
    style.dataset.rwOverviewStyle = "editing";
    style.textContent = `
      .rw-dialog .rw-overview-stops {
        max-height:650px;
        overflow-y:auto;
        overflow-x:hidden;
        padding-right:5px;
      }
      .rw-dialog .rw-overview-stop {
        display:grid;
        grid-template-columns:30px minmax(0,1fr);
        gap:9px;
        padding:10px 5px;
        border-bottom:1px solid #e5eaf2;
        background:#fff;
      }
      .rw-dialog .rw-overview-stop[draggable="true"] {
        cursor:grab;
        user-select:none;
      }
      .rw-dialog .rw-overview-stop[draggable="true"]:active {
        cursor:grabbing;
      }
      .rw-dialog .rw-overview-stop-number {
        display:flex;
        align-items:center;
        justify-content:center;
        width:28px;
        height:28px;
        border-radius:50%;
        background:#0866ff;
        color:white;
        font-weight:800;
      }
      .rw-dialog .rw-overview-stop-heading {
        display:flex;
        align-items:center;
        gap:8px;
        min-width:0;
      }
      .rw-dialog .rw-overview-stop-title {
        flex:1;
        min-width:0;
        overflow-wrap:anywhere;
        font-size:12px;
      }
      .rw-dialog .rw-overview-drag-handle {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:25px;
        height:30px;
        color:#71829b;
        font-size:21px;
        pointer-events:none;
        user-select:none;
      }
      .rw-dialog .rw-overview-stop.rw-dragging {
        opacity:.45;
        background:#eaf2ff;
        border:1px dashed #0866ff;
      }
      .rw-dialog .rw-overview-stop.rw-drop-before {
        box-shadow:inset 0 3px #0866ff;
        background:#f0f6ff;
      }
      .rw-dialog .rw-overview-stop.rw-drop-after {
        box-shadow:inset 0 -3px #0866ff;
        background:#f0f6ff;
      }
      .rw-dialog .rw-overview-stop.rw-map-selected-stop {
        background:#fff8e7;
        border-left:3px solid #f59e0b;
        padding-left:7px;
      }
      .rw-dialog .rw-overview-move-buttons {
        display:flex;
        gap:3px;
      }
      .rw-dialog .rw-overview-move-buttons .rw-button {
        min-height:27px;
        padding:3px 7px;
        cursor:pointer;
      }
      .rw-dialog .rw-overview-order-details {
        margin-top:7px;
        user-select:text;
      }
      .rw-dialog .rw-overview-order-details summary {
        color:#0866ff;
        font-size:11px;
        font-weight:700;
        cursor:pointer;
      }
      .rw-dialog .rw-overview-order {
        padding:6px 8px;
        margin-top:5px;
        border:1px solid #e5eaf2;
        border-radius:6px;
        background:#f8faff;
        font-size:11px;
      }
      .rw-dialog .rw-overview-stop-time {
        color:#0866ff!important;
      }
    `;
    root.appendChild(style);
  }

  if (container.dataset.rwEditingBound === "true") return;
  container.dataset.rwEditingBound = "true";

  let drag = null;

  function rows() {
    return [...container.querySelectorAll(
      ".rw-overview-stop[data-rw-location-key]"
    )];
  }

  function canEdit(state) {
    return Boolean(
      state.isOpen &&
      state.draft &&
      state.preview &&
      state.capabilities?.stopOrder === true &&
      ["ready", "stale"].includes(state.status)
    );
  }

  function clearMarks() {
    for (const row of rows()) {
      row.classList.remove(
        "rw-dragging",
        "rw-drop-before",
        "rw-drop-after"
      );
    }
  }

  function renumber() {
    const list = rows();
    const editable = canEdit(workspace.getState());

    list.forEach((row, index) => {
      const number = row.querySelector('[data-rw-part="number"]');
      if (number) number.textContent = String(index + 1);

      const up = row.querySelector('[data-rw-overview-move="-1"]');
      const down = row.querySelector('[data-rw-overview-move="1"]');

      if (up) up.disabled = !editable || index === 0;
      if (down) down.disabled = !editable || index === list.length - 1;
    });
  }

  function commitOrder() {
    const state = workspace.getState();

    if (!canEdit(state)) {
      throw new Error("Route order cannot be changed.");
    }

    const locations = new Map(
      (state.preview.locations || []).map(location => [
        String(location.location_key),
        location
      ])
    );

    const currentIds = (state.draft.stop_order_ids || []).map(String);
    const positions = new Map(
      currentIds.map((id, index) => [id, index])
    );

    const nextIds = rows().flatMap(row => {
      const location = locations.get(row.dataset.rwLocationKey);

      if (!location) {
        throw new Error("Delivery location not found.");
      }

      return (location.order_ids || [])
        .map(String)
        .sort((a, b) =>
          (positions.get(a) ?? Infinity) -
          (positions.get(b) ?? Infinity)
        );
    });

    const expected = [...currentIds].sort();
    const actual = [...nextIds].sort();

    if (
      actual.length !== expected.length ||
      actual.some((id, index) => id !== expected[index])
    ) {
      throw new Error("Route order count mismatch.");
    }

    if (nextIds.some((id, index) => id !== currentIds[index])) {
      workspace.setStopOrder(nextIds);
    }
  }

  function restoreOrder(previous) {
    const lookup = new Map(
      rows().map(row => [row.dataset.rwLocationKey, row])
    );

    const endDepot = [...container.children].find(
      row => row.dataset?.rwRowKey === "depot-end"
    );

    for (const key of previous) {
      const row = lookup.get(key);
      if (row) container.insertBefore(row, endDepot || null);
    }

    renumber();
  }

  function performMove(source, target, after) {
    if (!source || !target || source === target) return;

    const previous = rows().map(row => row.dataset.rwLocationKey);

    if (after) {
      target.after(source);
    } else {
      target.before(source);
    }

    renumber();

    try {
      commitOrder();
      clearActionError(root);
    } catch (error) {
      restoreOrder(previous);
      showActionError(root, error);
    }
  }

  container.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;

    const button = event.target.closest("[data-rw-overview-move]");
    if (!button || button.disabled) return;

    const source = button.closest("[data-rw-location-key]");
    const list = rows();
    const index = list.indexOf(source);
    const direction = Number(button.dataset.rwOverviewMove);
    const target = list[index + direction];

    if (!source || !target || !canEdit(workspace.getState())) return;

    event.preventDefault();
    event.stopPropagation();

    performMove(source, target, direction > 0);
  });

  container.addEventListener("dragstart", event => {
    if (!(event.target instanceof Element)) return;

    const source = event.target.closest("[data-rw-location-key]");

    if (
      !source ||
      !event.dataTransfer ||
      event.target.closest(
        "button,details,summary,input,select,textarea,a"
      )
    ) {
      event.preventDefault();
      return;
    }

    const state = workspace.getState();

    if (!canEdit(state)) {
      event.preventDefault();
      return;
    }

    drag = {
      key: source.dataset.rwLocationKey,
      revision: state.revision,
      routeId: String(state.route?.id ?? "")
    };

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", drag.key);

    source.classList.add("rw-dragging");
  });

  container.addEventListener("dragover", event => {
    if (!drag || !(event.target instanceof Element)) return;

    event.preventDefault();

    const target = event.target.closest("[data-rw-location-key]");
    const source = rows().find(
      row => row.dataset.rwLocationKey === drag.key
    );

    clearMarks();
    source?.classList.add("rw-dragging");

    if (!target || target === source) return;

    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;

    event.dataTransfer.dropEffect = "move";
    target.classList.add(after ? "rw-drop-after" : "rw-drop-before");

    // Automatisch scrollen bij de boven- of onderrand.
    const bounds = container.getBoundingClientRect();
    if (event.clientY < bounds.top + 35) {
      container.scrollTop -= 12;
    } else if (event.clientY > bounds.bottom - 35) {
      container.scrollTop += 12;
    }
  });

  container.addEventListener("drop", event => {
    if (!drag || !(event.target instanceof Element)) return;

    event.preventDefault();

    const saved = drag;
    drag = null;

    const target = event.target.closest("[data-rw-location-key]");
    const source = rows().find(
      row => row.dataset.rwLocationKey === saved.key
    );

    clearMarks();

    if (!source || !target || source === target) return;

    const state = workspace.getState();

    if (
      !canEdit(state) ||
      state.revision !== saved.revision ||
      String(state.route?.id ?? "") !== saved.routeId
    ) {
      showActionError(
        root,
        new Error("Route changed while dragging. Try again.")
      );
      return;
    }

    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;

    performMove(source, target, after);
  });

  container.addEventListener("dragend", () => {
    drag = null;
    clearMarks();
  });
}


function renderOverview(root, controls, snapshot) {
  const preview = snapshot.preview;
  const draft = snapshot.draft || {};
  const planner = getPlannerData(snapshot);

  renderWorkspaceDriver(root, snapshot);

  const selectedVehicle = controls.vehicle.selectedOptions?.[0];

  setText(
    root,
    '[data-rw-overview="vehicle"]',
    selectedVehicle?.textContent ||
      preview?.vehicle?.name ||
      "—"
  );

  setText(
    root,
    '[data-rw-overview="driver"]',
    find(root, '[data-rw="driver-name"]')?.textContent || "—"
  );

  setText(
    root,
    '[data-rw-overview="date"]',
    draft.route_date || preview?.route_date || "—"
  );

  setText(
    root,
    '[data-rw-overview="start"]',
    String(
      draft.start_time ||
      preview?.start_time ||
      "—"
    ).slice(0, 5)
  );

  const container = find(
    root,
    '[data-rw-overview="stops"]'
  );

  if (!container) return;

  // De drag-and-drop-listeners worden slechts één keer gekoppeld.
  enableOverviewEditing(root, snapshot);

  if (!preview) {
    if (container.dataset.rwEmpty !== "true") {
      container.replaceChildren(
        element(
          "p",
          "rw-module-placeholder",
          "Waiting for route data…"
        )
      );

      container.dataset.rwEmpty = "true";
    }

    setText(
      root,
      '[data-rw-overview="stop-count"]',
      "Waiting for route data…"
    );

    setText(
      root,
      '[data-rw-overview="timing-status"]',
      ""
    );

    return;
  }

  delete container.dataset.rwEmpty;

  const stops = Array.isArray(preview.stops)
    ? preview.stops
    : [];

  const locations = Array.isArray(preview.locations)
    ? [...preview.locations]
    : [];

  const previewOrders = new Map(
    stops.map(stop => [
      String(stop.order_id),
      stop
    ])
  );

  const plannerOrders = new Map(
    (
      Array.isArray(planner.allOrders)
        ? planner.allOrders
        : []
    )
      .filter(order =>
        !order.company_id ||
        String(order.company_id) ===
          String(snapshot.companyId)
      )
      .map(order => [
        String(order.id),
        order
      ])
  );

  // ========================================================
  // CURRENT DRAFT ORDER
  // ========================================================

  const positions = new Map(
    (draft.stop_order_ids || []).map(
      (id, index) => [
        String(id),
        index
      ]
    )
  );

  function position(location) {
    const values = (location.order_ids || []).map(
      id => positions.get(String(id)) ?? Infinity
    );

    return values.length
      ? Math.min(...values)
      : Infinity;
  }

  locations.sort(
    (a, b) => position(a) - position(b)
  );

  // ========================================================
  // FORMATTING HELPERS
  // ========================================================

  function clean(value) {
    const text = String(value ?? "").trim();

    return text === "—" || text === "-"
      ? ""
      : text;
  }

  function unique(values) {
    return [
      ...new Set(
        values.map(clean).filter(Boolean)
      )
    ];
  }

  function retailerName(order) {
    return clean(
      order?.retailer_name ||
      order?.retail_name ||
      order?.shop_name ||
      order?.delivery_name ||
      order?.delivery_contact_name ||
      order?.customer_reference_name ||
      order?.customer_name_raw ||
      order?.customer_display_name ||
      order?.end_customer_name ||
      order?.consignee_name ||
      order?.delivery_company
    );
  }

  function time(value) {
    if (!value) return "—";

    const text = String(value);
    const match = text.match(
      /(?:T|^)(\d{2}:\d{2})/
    );

    return match ? match[1] : text;
  }

  // ========================================================
  // EDITING PERMISSIONS
  // ========================================================

  const editable = Boolean(
    snapshot.isOpen &&
    snapshot.draft &&
    snapshot.preview &&
    snapshot.capabilities?.stopOrder === true &&
    ["ready", "stale"].includes(snapshot.status)
  );

  // ========================================================
  // REUSE EXISTING ROWS
  // ========================================================

  const activeKeys = new Set();

  function makeRow(key, depot = false) {
    const row = element(
      "div",
      "rw-overview-stop"
    );

    row.dataset.rwRowKey = key;

    if (!depot) {
      row.dataset.rwLocationKey = key;
    }

    const number = element(
      "span",
      "rw-overview-stop-number"
    );

    number.dataset.rwPart = "number";

    const body = element(
      "div",
      "rw-overview-stop-body"
    );

    const heading = element(
      "div",
      "rw-overview-stop-heading"
    );

    if (!depot) {
      const handle = element(
        "span",
        "rw-overview-drag-handle",
        "⠿"
      );

      // Alleen de complete stopregel is draggable.
      handle.draggable = false;
      handle.dataset.rwPart = "handle";
      handle.title = "Drag this delivery stop";

      heading.appendChild(handle);
    }

    const title = element(
      "strong",
      "rw-overview-stop-title"
    );

    title.dataset.rwPart = "title";

    heading.appendChild(title);

    if (!depot) {
      const buttons = element(
        "div",
        "rw-overview-move-buttons"
      );

      for (const [direction, label] of [
        [-1, "↑"],
        [1, "↓"]
      ]) {
        const button = element(
          "button",
          "rw-button",
          label
        );

        button.type = "button";
        button.dataset.rwOverviewMove =
          String(direction);

        buttons.appendChild(button);
      }

      heading.appendChild(buttons);
    }

    const address = element("p");
    address.dataset.rwPart = "address";

    const totals = element("p");
    totals.dataset.rwPart = "totals";

    const timing = element(
      "p",
      "rw-overview-stop-time"
    );

    timing.dataset.rwPart = "timing";

    body.append(
      heading,
      address,
      totals,
      timing
    );

    if (!depot) {
      const details = element(
        "details",
        "rw-overview-order-details"
      );

      details.dataset.rwPart = "details";

      const summary = element("summary");
      summary.dataset.rwPart = "order-summary";

      const orderList = element("div");
      orderList.dataset.rwPart = "order-list";

      details.append(
        summary,
        orderList
      );

      body.appendChild(details);
    }

    row.append(
      number,
      body
    );

    return row;
  }

  function part(row, name) {
    return row.querySelector(
      `[data-rw-part="${name}"]`
    );
  }

  function getRow(key, depot = false) {
    let row = [...container.children].find(
      node => node.dataset?.rwRowKey === key
    );

    if (!row) {
      row = makeRow(key, depot);
    }

    activeKeys.add(key);

    return row;
  }

  function updateDepot(key, label, timing, number) {
    const row = getRow(key, true);

    row.draggable = false;

    part(row, "number").textContent = number;
    part(row, "title").textContent = label;

    part(row, "address").textContent =
      key === "depot-start"
        ? "Route start"
        : "Route end";

    part(row, "totals").textContent = "";
    part(row, "timing").textContent = timing;

    return row;
  }

  // ========================================================
  // BUILD DELIVERY STOPS
  // ========================================================

  const rows = [];

  rows.push(
    updateDepot(
      "depot-start",
      "Depot — departure",
      time(
        draft.start_time ||
        preview.start_time
      ),
      "D"
    )
  );

  locations.forEach((location, index) => {
    const key = String(location.location_key);
    const row = getRow(key);

    const ids = (location.order_ids || [])
      .map(String)
      .sort((a, b) =>
        (positions.get(a) ?? Infinity) -
        (positions.get(b) ?? Infinity)
      );

    const members = ids
      .map(id => previewOrders.get(id))
      .filter(Boolean);

    const sourceOrders = ids
      .map(id => plannerOrders.get(id))
      .filter(Boolean);

    const first = members[0];
    const last = members[members.length - 1];

    const numbers = ids.map(id =>
      clean(previewOrders.get(id)?.order_number) ||
      clean(plannerOrders.get(id)?.order_number) ||
      `Order ${id}`
    );

    const names = unique(
      sourceOrders.map(retailerName)
    );

    const city =
      clean(location.city) ||
      clean(first?.city) ||
      clean(sourceOrders[0]?.delivery_city);

    const postcode =
      clean(location.postcode) ||
      clean(first?.postcode) ||
      clean(sourceOrders[0]?.delivery_postcode);

    const locationName = clean(location.name);

    const usableName = Boolean(
      locationName &&
      locationName !== city &&
      locationName !== postcode &&
      !numbers.includes(locationName) &&
      !["stop", "location"].includes(
        locationName.toLowerCase()
      )
    );

    const title = names.length
      ? names.join(" / ")
      : usableName
        ? locationName
        : "Retailer name unavailable";

    const addressLabel = unique([
      city,
      postcode
    ]).join(" · ");


const legMiles =
  location.distance_from_previous_miles ??
  (
    location.distance_from_previous_km != null
      ? Number(location.distance_from_previous_km) * 0.621371
      : null
  );

const validLegMiles =
  legMiles !== null &&
  legMiles !== "" &&
  Number.isFinite(Number(legMiles));

const totals = [
  `${ids.length} ${ids.length === 1 ? "order" : "orders"}`,
  formatMetric(location.volume_m3, "m³"),
  `${formatNumber(location.colli, 0)} colli`,
  validLegMiles
    ? `${formatNumber(legMiles, 1)} mi from previous stop`
    : null
].filter(Boolean).join(" · ");


    const arrival = time(
      first?.planned_arrival_time ||
      first?.arrival_eta
    );

    const departure = time(
      last?.planned_departure_time ||
      last?.departure_eta
    );

    // ------------------------------------------------------
    // UPDATE ROW CONTENT
    // ------------------------------------------------------

    part(row, "number").textContent =
      String(index + 1);

    part(row, "title").textContent = title;
    part(row, "address").textContent = addressLabel;
    part(row, "totals").textContent = totals;

    part(row, "timing").textContent =
      `${arrival} → ${departure} · Unloading: ` +
      `${formatNumber(location.service_minutes, 0)} min` +
      (
        hasCurrentPreview(snapshot)
          ? ""
          : " · Previous calculation"
      );

    // Complete stopregel versleepbaar.
    row.draggable = editable;

    const handle = part(row, "handle");

    if (handle) {
      handle.draggable = false;

      handle.title = editable
        ? "Drag this delivery stop"
        : "Route editing is unavailable";
    }

    for (const button of row.querySelectorAll(
      "[data-rw-overview-move]"
    )) {
      const direction = Number(
        button.dataset.rwOverviewMove
      );

      button.disabled =
        !editable ||
        (direction < 0 && index === 0) ||
        (
          direction > 0 &&
          index === locations.length - 1
        );

      button.setAttribute(
        "aria-label",
        `Move ${title} ${
          direction < 0 ? "up" : "down"
        }`
      );
    }

    // ------------------------------------------------------
    // ORDER DETAILS
    // ------------------------------------------------------

    const details = part(row, "details");
    const summary = part(row, "order-summary");
    const orderList = part(row, "order-list");

    summary.textContent =
      `Orders (${ids.length})`;

    // Nieuwe stops zijn standaard ingeklapt.
    // Bestaande gebruikerskeuzes blijven behouden.
    if (!details.dataset.rwInitialized) {
      details.open = false;
      details.dataset.rwInitialized = "true";
    }

    const signature = JSON.stringify(
      ids.map(id => {
        const stop = previewOrders.get(id);
        const source = plannerOrders.get(id);

        return [
          id,
          stop?.order_number ||
            source?.order_number,
          stop?.planning_volume_m3,
          stop?.planning_colli
        ];
      })
    );

    if (orderList.dataset.rwSignature !== signature) {
      const orderCards = ids.map(id => {
        const stop = previewOrders.get(id);
        const source = plannerOrders.get(id);

        const card = element(
          "div",
          "rw-overview-order"
        );

        card.appendChild(
          element(
            "strong",
            "",
            clean(stop?.order_number) ||
              clean(source?.order_number) ||
              `Order ${id}`
          )
        );

        card.appendChild(
          element(
            "p",
            "",
            `${formatMetric(
              stop?.planning_volume_m3,
              "m³"
            )} · ${formatNumber(
              stop?.planning_colli,
              0
            )} colli`
          )
        );

        return card;
      });

      orderList.replaceChildren(
        ...orderCards
      );

      orderList.dataset.rwSignature =
        signature;
    }

    rows.push(row);
  });

  // ========================================================
  // DEPOT RETURN
  // ========================================================

  rows.push(
    updateDepot(
      "depot-end",
      "Depot — return",
      time(
        preview.after?.route_end_datetime ||
        preview.after?.route_end_time
      ),
      "D"
    )
  );

  // ========================================================
  // SYNCHRONIZE DOM ORDER
  // ========================================================

  for (const child of [...container.children]) {
    if (
      child.dataset?.rwRowKey &&
      !activeKeys.has(child.dataset.rwRowKey)
    ) {
      child.remove();
    }
  }

  // Verplaats bestaande elementen zonder ze opnieuw
  // op te bouwen. Daardoor blijven details behouden.
  rows.forEach((row, index) => {
    const current =
      container.children[index] || null;

    if (current !== row) {
      container.insertBefore(
        row,
        current
      );
    }
  });

  // Oude placeholders verwijderen.
  for (const child of [...container.children]) {
    if (!child.dataset?.rwRowKey) {
      child.remove();
    }
  }

  // ========================================================
  // SUMMARY
  // ========================================================

  setText(
    root,
    '[data-rw-overview="stop-count"]',
    `${locations.length} locations · ` +
    `${stops.length} orders · ` +
    `${formatMetric(preview.after?.volume_m3, "m³")} · ` +
    `${formatNumber(preview.after?.colli, 0)} colli`
  );

  setText(
    root,
    '[data-rw-overview="timing-status"]',
    hasCurrentPreview(snapshot)
      ? "Times match the current route calculation."
      : "Recalculation pending — previous times shown."
  );
}


function renderRouteHeader(root, controls, snapshot) {
  if (!snapshot) return;

  const route = snapshot.route || {};
  const draft = snapshot.draft || {};
  const preview = snapshot.preview || {};
  const planner = getPlannerData(snapshot);

  // --------------------------------------------------------
  // ROUTE NUMBER
  // --------------------------------------------------------

  setText(
    root,
    '[data-rw="route-label"]',
    getRouteLabel(snapshot)
  );

  // --------------------------------------------------------
  // VEHICLE
  // --------------------------------------------------------

  const vehicleId =
    draft.vehicle_id ||
    route.vehicle_id ||
    route.assigned_vehicle_id ||
    null;

  const vehicles = Array.isArray(planner.activeVehicles)
    ? planner.activeVehicles
    : [];

  const selectedVehicle = vehicleId
    ? vehicles.find(vehicle =>
        String(vehicle.id) === String(vehicleId)
      )
    : null;

  const previewVehicle =
    preview.vehicle &&
    (
      !vehicleId ||
      String(preview.vehicle.id) === String(vehicleId)
    )
      ? preview.vehicle
      : null;

  const vehicleName =
    (selectedVehicle && getVehicleLabel(selectedVehicle)) ||
    (previewVehicle && getVehicleLabel(previewVehicle)) ||
    (
      String(route.vehicle_id || route.assigned_vehicle_id || "") ===
      String(vehicleId || "")
        ? route.vehicle_name || route.assigned_vehicle_name
        : null
    ) ||
    "Vehicle unavailable";

  setText(
    root,
    '[data-rw-header="vehicle"]',
    vehicleName
  );

  // --------------------------------------------------------
  // DRIVER
  // --------------------------------------------------------

  const plannerRoute = (
    Array.isArray(planner.allRoutes)
      ? planner.allRoutes
      : []
  ).find(candidate =>
    String(candidate.id) === String(route.id)
  );

  const driverId =
    route.driver_user_id ||
    route.driver_profile_id ||
    plannerRoute?.driver_user_id ||
    plannerRoute?.driver_profile_id ||
    null;

  const drivers = Array.isArray(planner.driverUsers)
    ? planner.driverUsers
    : [];

  const driver = driverId
    ? drivers.find(candidate =>
        [
          candidate.id,
          candidate.auth_user_id,
          candidate.profile_id
        ].some(id =>
          id != null &&
          String(id) === String(driverId)
        )
      )
    : null;

  const driverName =
    route.driver_name ||
    plannerRoute?.driver_name ||
    driver?.full_name ||
    driver?.email ||
    (
      driverId
        ? "Driver details unavailable"
        : "No driver assigned"
    );

  setText(
    root,
    '[data-rw-header="driver"]',
    driverName
  );

  // --------------------------------------------------------
  // PLANNING DATE
  // --------------------------------------------------------

  const rawDate =
    draft.route_date ||
    preview.route_date ||
    route.planned_delivery_date ||
    route.route_date ||
    "";

  let dateLabel = "—";

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(rawDate))) {
    const date = new Date(`${rawDate}T12:00:00Z`);

    if (Number.isFinite(date.getTime())) {
      dateLabel = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC"
      }).format(date);
    }
  }

  setText(
    root,
    '[data-rw-header="date"]',
    dateLabel
  );

  // --------------------------------------------------------
  // DEPARTURE TIME
  // --------------------------------------------------------

  const departure =
    draft.start_time ||
    preview.start_time ||
    route.planned_start_time ||
    "";

  setText(
    root,
    '[data-rw-header="departure"]',
    departure
      ? String(departure).slice(0, 5)
      : "—"
  );

  // --------------------------------------------------------
  // ROUTE PREVIEW STATUS
  // --------------------------------------------------------

  const header = find(root, ".rw-header");

  if (header) {
    header.classList.toggle(
      "rw-header-stale",
      Boolean(snapshot.preview && !hasCurrentPreview(snapshot))
    );

    header.classList.toggle(
      "rw-header-invalid",
      hasCurrentPreview(snapshot) &&
      snapshot.preview?.valid === false
    );
  }
}


function renderState(root, controls, snapshot) {
  if (!snapshot) return;

  // Tabs and current route status.
  renderTabs(root, snapshot);
  renderStatus(root, snapshot);

  // Vehicle, driver and editable route controls.
  renderVehicle(root, controls, snapshot);
  renderControls(root, controls, snapshot);

  // Branded dynamic route header.
  renderRouteHeader(root, controls, snapshot);

  // Route metrics and KPI dashboard.
  renderMetrics(root, snapshot);
  renderRouteKpis(root, snapshot);

  // Validation and comparison.
  renderWarnings(root, snapshot);
  renderComparison(root, snapshot);

  // Interactive delivery stops.
  renderOverview(root, controls, snapshot);
}



  workspace.registerModule("ui", {
    mount: mountUI
  });

  // EINDE DEEL 3 VAN 3
})();


