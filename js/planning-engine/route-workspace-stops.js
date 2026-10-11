/*
 * VEYNOR ROUTE WORKSPACE STOPS
 * File: /js/planning-engine/route-workspace-stops.js
 *
 * DEEL 1 VAN 3
 *
 * - Helpers voor de stopweergave
 * - Afleverlocaties en onderliggende orders uitlezen
 * - Conceptvolgorde volgen
 * - Basiscontainer voor de stops-module
 *
 * Laden na:
 * - route-workspace.js
 * - route-workspace-ui.js
 *
 * Dit bestand berekent zelf geen routes of lostijden
 * en schrijft niets naar de database.
 */

(function () {
  "use strict";

  const workspace = window.VeynorRouteWorkspace;

  if (!workspace?.registerModule) {
    throw new Error(
      "Load route-workspace.js before route-workspace-stops.js."
    );
  }

  const UNLOADING_MODES = [
    ["fixed", "Fixed"],
    ["orders", "Orders"],
    ["volume", "Volume"],
    ["combined", "Combined"]
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

  function createButton(action, label, locationKey) {
    const button = element(
      "button",
      "rw-button rw-stops-button",
      label
    );

    button.type = "button";

    button.dataset.rwStopsAction = action;

    if (locationKey !== undefined) {
      button.dataset.locationKey =
        String(locationKey);
    }

    return button;
  }

  function isEditable(snapshot) {
    return (
      snapshot.isOpen &&
      Boolean(snapshot.draft) &&
      snapshot.status !== "loading"
    );
  }

  function hasCurrentPreview(snapshot) {
    return (
      Boolean(snapshot.preview) &&
      snapshot.status === "ready" &&
      snapshot.previewRevision === snapshot.revision
    );
  }

  // ==========================================================
  // 2. LOCATIES IN DE CONCEPTVOLGORDE
  // ==========================================================

  function getOrderedLocations(snapshot) {
    const locations = snapshot.preview?.locations;

    if (!Array.isArray(locations)) {
      return [];
    }

    const draftIds = Array.isArray(
      snapshot.draft?.stop_order_ids
    )
      ? snapshot.draft.stop_order_ids.map(String)
      : [];

    const positions = new Map(
      draftIds.map((id, index) => {
        return [id, index];
      })
    );

    /*
     * We veranderen de ontvangen preview niet.
     *
     * Zodra een locatie wordt verplaatst, volgt de lijst
     * direct de conceptvolgorde. De nieuwe tijden verschijnen
     * pas wanneer de engine de route opnieuw heeft berekend.
     */
    const ordered = locations.map(location => {
      const orderIds = Array.isArray(
        location.order_ids
      )
        ? location.order_ids.map(String)
        : [];

      orderIds.sort((first, second) => {
        const firstPosition =
          positions.get(first) ?? Infinity;

        const secondPosition =
          positions.get(second) ?? Infinity;

        if (firstPosition === secondPosition) {
          return 0;
        }

        return firstPosition < secondPosition
          ? -1
          : 1;
      });

      return {
        ...location,
        order_ids: orderIds
      };
    });

    function firstPosition(location) {
      let first = Infinity;

      for (const id of location.order_ids) {
        const position = positions.get(id);

        if (
          position !== undefined &&
          position < first
        ) {
          first = position;
        }
      }

      return first;
    }

    ordered.sort((first, second) => {
      const firstIndex = firstPosition(first);
      const secondIndex = firstPosition(second);

      if (firstIndex === secondIndex) {
        return 0;
      }

      return firstIndex < secondIndex
        ? -1
        : 1;
    });

    return ordered;
  }

  // ==========================================================
  // 3. ONDERLIGGENDE ORDERGEGEVENS
  // ==========================================================

  function getOrdersById(snapshot) {
    const result = new Map();

    const stops = Array.isArray(
      snapshot.preview?.stops
    )
      ? snapshot.preview.stops
      : [];

    /*
     * Gebruik de orderstopgegevens uit de engine.
     * De veldnamen sluiten aan op makeStop():
     *
     * - order_id
     * - order_number
     * - stop_name
     * - planning_volume_m3
     * - planning_colli
     * - address_1 t/m address_4
     * - city, postcode, country
     *
     * Aanvullende timingvelden blijven eveneens beschikbaar.
     */
    for (const stop of stops) {
      if (!stop?.order_id) {
        continue;
      }

      result.set(
        String(stop.order_id),
        stop
      );
    }

    return result;
  }

  function getLocationTitle(location) {
    return String(
      location.postcode ||
      location.name ||
      location.city ||
      "Delivery location"
    );
  }

  function getLocationAddress(location, ordersById) {
    const firstOrderId =
      location.order_ids?.[0];

    const firstOrder = firstOrderId
      ? ordersById.get(String(firstOrderId))
      : null;

    const parts = [
      firstOrder?.address_1,
      firstOrder?.address_2,
      firstOrder?.address_3,
      firstOrder?.address_4,
      location.city || firstOrder?.city,
      location.postcode || firstOrder?.postcode,
      firstOrder?.country
    ];

    return parts
      .filter(value => {
        return (
          value != null &&
          String(value).trim() !== ""
        );
      })
      .map(value => String(value).trim())
      .join(", ");
  }

  // ==========================================================
  // 4. LOSTIJDINSTELLINGEN UIT HET CONCEPT
  // ==========================================================

  function getLocationMode(snapshot, locationKey) {
    const overrides =
      snapshot.draft?.mode_by_location || {};

    if (
      Object.prototype.hasOwnProperty.call(
        overrides,
        locationKey
      )
    ) {
      return overrides[locationKey];
    }

    // Lege waarde betekent: algemene routemethode gebruiken.
    return "";
  }

  function getManualMinutes(snapshot, locationKey) {
    const overrides =
      snapshot.draft?.manual_minutes_by_location || {};

    if (
      Object.prototype.hasOwnProperty.call(
        overrides,
        locationKey
      )
    ) {
      return overrides[locationKey];
    }

    // Leeg betekent: automatisch laten berekenen.
    // Een handmatige waarde van 0 blijft behouden.
    return "";
  }

  // ==========================================================
  // 5. BASISCONTAINER
  // ==========================================================

  function createStopsShell() {
    const root = element(
      "div",
      "rw-stops-module"
    );

    const toolbar = element(
      "div",
      "rw-stops-toolbar"
    );

    toolbar.append(
      createButton(
        "expand-all",
        "Expand All"
      ),

      createButton(
        "collapse-all",
        "Collapse All"
      )
    );

    const instructions = element(
      "p",
      "rw-field-help",
      "Move delivery locations with the up and down buttons. " +
      "Orders at the same address remain together."
    );

    const error = element(
      "p",
      "rw-error"
    );

    error.dataset.rwStops = "error";
    error.setAttribute("role", "alert");
    error.hidden = true;

    const status = element(
      "p",
      "rw-stops-status"
    );

    status.dataset.rwStops = "status";

    status.setAttribute(
      "aria-live",
      "polite"
    );

    const list = element(
      "div",
      "rw-stops-list"
    );

    list.dataset.rwStops = "list";

    list.setAttribute(
      "role",
      "list"
    );

    list.setAttribute(
      "aria-label",
      "Delivery locations"
    );

    root.append(
      toolbar,
      instructions,
      error,
      status,
      list
    );

    return {
      root,
      toolbar,
      error,
      status,
      list
    };
  }

  // EINDE DEEL 1 VAN 3
  // Plak deel 2 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 6. LOCATIEKAART AANMAKEN
  // ==========================================================

  function createLocationCard(locationKey) {
    const root = element(
      "article",
      "rw-stop-card"
    );

    root.setAttribute("role", "listitem");

    root.dataset.locationKey = locationKey;

    const header = element(
      "div",
      "rw-stop-header"
    );

    const number = element(
      "span",
      "rw-stop-number"
    );

    const headingGroup = element(
      "div",
      "rw-stop-heading"
    );

    const title = element(
      "h4",
      "rw-stop-title"
    );

    const address = element(
      "p",
      "rw-stop-address"
    );

    headingGroup.append(
      title,
      address
    );

    const moveButtons = element(
      "div",
      "rw-stop-move-buttons"
    );

    const moveUp = createButton(
      "move-up",
      "↑",
      locationKey
    );

    const moveDown = createButton(
      "move-down",
      "↓",
      locationKey
    );

    moveButtons.append(
      moveUp,
      moveDown
    );

    header.append(
      number,
      headingGroup,
      moveButtons
    );

    const totals = element(
      "p",
      "rw-stop-totals"
    );

    const timing = element(
      "p",
      "rw-stop-timing"
    );

    // --------------------------------------------------------
    // Lostijdmethode
    // --------------------------------------------------------

    const unloading = element(
      "div",
      "rw-stop-unloading"
    );

    const modeLabel = element(
      "label",
      "rw-field"
    );

    const mode = element(
      "select",
      "rw-input"
    );

    mode.dataset.rwStopsField = "mode";
    mode.dataset.locationKey = locationKey;

    const routeMode = element(
      "option",
      "",
      "Use route mode"
    );

    routeMode.value = "";

    mode.appendChild(routeMode);

    for (const [value, label] of UNLOADING_MODES) {
      const option = element(
        "option",
        "",
        label
      );

      option.value = value;

      mode.appendChild(option);
    }

    modeLabel.append(
      element(
        "span",
        "rw-field-label",
        "Unloading mode"
      ),
      mode
    );

    // --------------------------------------------------------
    // Handmatige lostijd
    // --------------------------------------------------------

    const minutesLabel = element(
      "label",
      "rw-field"
    );

    const minutes = element(
      "input",
      "rw-input"
    );

    minutes.type = "number";
    minutes.min = "0";
    minutes.step = "any";
    minutes.placeholder = "Automatic";

    minutes.dataset.rwStopsField = "minutes";
    minutes.dataset.locationKey = locationKey;

    minutesLabel.append(
      element(
        "span",
        "rw-field-label",
        "Manual unloading time (min)"
      ),
      minutes
    );

    const clearUnloading = createButton(
      "clear-unloading",
      "Use Route Defaults",
      locationKey
    );

    const unloadingNote = element(
      "p",
      "rw-field-help"
    );

    unloading.append(
      modeLabel,
      minutesLabel,
      clearUnloading,
      unloadingNote
    );

    // --------------------------------------------------------
    // Onderliggende orders
    // --------------------------------------------------------

    const details = element(
      "details",
      "rw-stop-orders"
    );

    details.dataset.locationKey = locationKey;

    const ordersSummary = element(
      "summary",
      "rw-stop-orders-summary"
    );

    const ordersContainer = element(
      "div",
      "rw-stop-orders-content"
    );

    details.append(
      ordersSummary,
      ordersContainer
    );

    root.append(
      header,
      totals,
      timing,
      unloading,
      details
    );

    return {
      root,
      number,
      title,
      address,
      moveUp,
      moveDown,
      totals,
      timing,
      mode,
      minutes,
      clearUnloading,
      unloadingNote,
      details,
      ordersSummary,
      ordersContainer,

      ordersSignature: null
    };
  }

  // ==========================================================
  // 7. ORDERTABEL
  // ==========================================================

  function renderOrderTable(card, location, ordersById) {
    const rows = location.order_ids.map(orderId => {
      const order = ordersById.get(orderId);

      return {
        id: orderId,
        number: order?.order_number || orderId,
        name: order?.stop_name || "—",
        volume: order?.planning_volume_m3 ?? null,
        colli: order?.planning_colli ?? null
      };
    });

    const signature = JSON.stringify(rows);

    // Vermijd onnodig opnieuw opbouwen van de ordertabel.
    if (card.ordersSignature === signature) {
      return;
    }

    card.ordersSignature = signature;

    const table = element(
      "table",
      "rw-stop-orders-table"
    );

    table.appendChild(
      element(
        "caption",
        "",
        "Orders at this delivery location"
      )
    );

    const head = element("thead");
    const headRow = element("tr");

    for (const label of [
      "Order",
      "Delivery name",
      "Volume",
      "Colli"
    ]) {
      const cell = element(
        "th",
        "",
        label
      );

      cell.scope = "col";

      headRow.appendChild(cell);
    }

    head.appendChild(headRow);

    const body = element("tbody");

    for (const order of rows) {
      const row = element("tr");

      const orderNumber = element(
        "th",
        "",
        order.number
      );

      orderNumber.scope = "row";

      const volumeText =
        order.volume == null
          ? "—"
          : `${formatNumber(order.volume)} m³`;

      row.append(
        orderNumber,

        element(
          "td",
          "",
          order.name
        ),

        element(
          "td",
          "",
          volumeText
        ),

        element(
          "td",
          "",
          formatNumber(order.colli, 0)
        )
      );

      body.appendChild(row);
    }

    table.append(
      head,
      body
    );

    card.ordersContainer.replaceChildren(
      table
    );
  }

  // ==========================================================
  // 8. INVOERVELDEN SYNCHRONISEREN
  // ==========================================================

  function syncInput(input, value, force = false) {
    const nextValue = String(value ?? "");

    /*
     * Overschrijf geen nog niet bevestigde invoer
     * terwijl de gebruiker in dit veld bezig is.
     *
     * Bij afgewezen invoer kan deel 3 force=true gebruiken
     * om de oorspronkelijke conceptwaarde terug te zetten.
     */
    if (
      !force &&
      document.activeElement === input
    ) {
      return;
    }

    if (input.value !== nextValue) {
      input.value = nextValue;
    }
  }

  // ==========================================================
  // 9. LOCATIEKAART BIJWERKEN
  // ==========================================================

  function updateLocationCard(
    card,
    location,
    index,
    totalLocations,
    snapshot,
    ordersById,
    forceInputs = false
  ) {
    const locationKey = location.location_key;

    const title = getLocationTitle(location);

    const editable = isEditable(snapshot);

    const capabilities =
      snapshot.capabilities || {};

    card.number.textContent = String(index + 1);
    card.title.textContent = title;

    const address = getLocationAddress(
      location,
      ordersById
    );

    card.address.textContent = address;
    card.address.hidden = !address;

    const count = location.order_ids.length;

    card.totals.textContent = [
      `${count} ${count === 1 ? "order" : "orders"}`,
      `${formatNumber(location.volume_m3)} m³`,
      `${formatNumber(location.colli, 0)} colli`
    ].join(" · ");

    // --------------------------------------------------------
    // Berekende aankomst, vertrek en lostijd
    // --------------------------------------------------------

    const firstOrder = ordersById.get(
      location.order_ids[0]
    );

    const arrival =
      firstOrder?.planned_arrival_time ||
      firstOrder?.arrival_eta ||
      null;

    const departure =
      firstOrder?.planned_departure_time ||
      firstOrder?.departure_eta ||
      null;

    const serviceText =
      `Unloading: ` +
      `${formatNumber(location.service_minutes, 0)} min`;

    const timingParts = [];

    if (arrival) {
      timingParts.push(`Arrival ${arrival}`);
    }

    if (departure) {
      timingParts.push(`Departure ${departure}`);
    }

    timingParts.push(serviceText);

    if (!hasCurrentPreview(snapshot)) {
      timingParts.push("previous calculation");
    }

    card.timing.textContent =
      timingParts.join(" · ");

    // --------------------------------------------------------
    // Volgordeknoppen
    // --------------------------------------------------------

    const canMove =
      editable &&
      capabilities.stopOrder === true;

    card.moveUp.disabled =
      !canMove ||
      index === 0;

    card.moveDown.disabled =
      !canMove ||
      index === totalLocations - 1;

    card.moveUp.setAttribute(
      "aria-label",
      `Move ${title} up`
    );

    card.moveDown.setAttribute(
      "aria-label",
      `Move ${title} down`
    );

    // --------------------------------------------------------
    // Lostijdvelden
    // --------------------------------------------------------

    const mode = getLocationMode(
      snapshot,
      locationKey
    );

    const minutes = getManualMinutes(
      snapshot,
      locationKey
    );

    syncInput(
      card.mode,
      mode,
      forceInputs
    );

    syncInput(
      card.minutes,
      minutes,
      forceInputs
    );

    card.mode.disabled =
      !editable ||
      capabilities.unloadingMode !== true;

    card.minutes.disabled =
      !editable ||
      capabilities.manualUnloading !== true;

    const hasOverride =
      mode !== "" ||
      minutes !== "";

    const canClear =
      editable &&
      (
        capabilities.unloadingMode === true ||
        capabilities.manualUnloading === true
      );

    card.clearUnloading.disabled =
      !canClear ||
      !hasOverride;

    if (minutes !== "") {
      card.unloadingNote.textContent =
        `Manual request: ${formatNumber(minutes)} min. ` +
        "This overrides the calculated unloading mode.";
    } else {
      const effectiveMode =
        mode ||
        snapshot.draft?.unloading_mode ||
        location.unloading_mode ||
        "—";

      card.unloadingNote.textContent =
        `Automatic unloading mode: ${effectiveMode}. ` +
        "Leave manual minutes empty to use the calculation.";
    }

    card.ordersSummary.textContent =
      `Orders (${count})`;

    renderOrderTable(
      card,
      location,
      ordersById
    );
  }

  // ==========================================================
  // 10. VOLLEDIGE STOPLIJST BIJWERKEN
  // ==========================================================

  function renderStops(
    shell,
    cards,
    snapshot,
    forceInputs = false
  ) {
    const locations = getOrderedLocations(
      snapshot
    );

    const ordersById = getOrdersById(
      snapshot
    );

    const activeKeys = new Set(
      locations.map(location => {
        return location.location_key;
      })
    );

    // Verwijder kaarten die niet meer in de preview staan.
    for (const [key, card] of cards) {
      if (!activeKeys.has(key)) {
        card.root.remove();
        cards.delete(key);
      }
    }

    const toolbarButtons =
      shell.toolbar.querySelectorAll("button");

    for (const button of toolbarButtons) {
      button.disabled = locations.length === 0;
    }

    if (!locations.length) {
      cards.clear();

      shell.list.replaceChildren(
        element(
          "p",
          "rw-module-placeholder",
          snapshot.status === "loading"
            ? "Loading delivery locations…"
            : "No delivery locations available."
        )
      );

      shell.status.textContent =
        "Waiting for route data.";

      return;
    }

    // Verwijder uitsluitend de tijdelijke lege melding.
    // Bestaande locatiekaarten blijven behouden.
    for (const child of Array.from(shell.list.children)) {
      if (
        !child.classList.contains(
          "rw-stop-card"
        )
      ) {
        child.remove();
      }
    }

    for (
      let index = 0;
      index < locations.length;
      index++
    ) {
      const location = locations[index];
      const key = location.location_key;

      let card = cards.get(key);

      if (!card) {
        card = createLocationCard(key);
        cards.set(key, card);
      }

      updateLocationCard(
        card,
        location,
        index,
        locations.length,
        snapshot,
        ordersById,
        forceInputs
      );

      /*
       * Verplaats alleen kaarten die daadwerkelijk op
       * een andere positie horen. Uitgeklapte orders
       * blijven daardoor behouden bij herberekeningen.
       */
      const currentNode =
        shell.list.children[index] || null;

      if (currentNode !== card.root) {
        shell.list.insertBefore(
          card.root,
          currentNode
        );
      }
    }

    shell.status.textContent =
      hasCurrentPreview(snapshot)
        ? "Stop times match the current route preview."
        : "The list follows the current stop order. " +
          "Times and unloading totals show the previous calculation.";
  }

  // EINDE DEEL 2 VAN 3
  // Plak deel 3 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 11. AFLEVERLOCATIE VERPLAATSEN
  // ==========================================================

  function moveLocation(
    snapshot,
    actions,
    locationKey,
    direction
  ) {
    if (
      !isEditable(snapshot) ||
      snapshot.capabilities?.stopOrder !== true
    ) {
      throw new Error(
        "Stop order cannot be changed right now."
      );
    }

    if (
      direction !== -1 &&
      direction !== 1
    ) {
      throw new Error(
        "Invalid move direction."
      );
    }

    const locations = getOrderedLocations(
      snapshot
    );

    const currentIndex = locations.findIndex(location => {
      return location.location_key === locationKey;
    });

    if (currentIndex < 0) {
      throw new Error(
        "Delivery location not found."
      );
    }

    const nextIndex =
      currentIndex + direction;

    if (
      nextIndex < 0 ||
      nextIndex >= locations.length
    ) {
      return;
    }

    const movedLocation = locations.splice(
      currentIndex,
      1
    )[0];

    locations.splice(
      nextIndex,
      0,
      movedLocation
    );

    /*
     * De controller verwacht alle order-ID's.
     * We verplaatsen een hele locatie, zodat orders
     * voor hetzelfde afleveradres bij elkaar blijven.
     */
    const orderedIds = locations.flatMap(location => {
      return location.order_ids;
    });

    actions.setStopOrder(
      orderedIds
    );
  }

  // ==========================================================
  // 12. STOPS-MODULE OPBOUWEN
  // ==========================================================

  function mountStops(context) {
    const {
      root: workspaceRoot,
      getState,
      actions
    } = context;

    if (
      !workspaceRoot ||
      typeof workspaceRoot.querySelector !== "function" ||
      typeof getState !== "function" ||
      typeof actions?.setStopOrder !== "function" ||
      typeof actions?.setLocationUnloading !== "function"
    ) {
      throw new Error(
        "Invalid Route Workspace stops context."
      );
    }

    const slot = workspaceRoot.querySelector(
      '[data-rw-slot="stops"]'
    );

    if (!slot) {
      throw new Error(
        "The Route Workspace stops container is missing."
      );
    }

    const shell = createStopsShell();

    const cards = new Map();

    const events = new AbortController();

    const listenerOptions = {
      signal: events.signal
    };

    const originalChildren = Array.from(
      slot.childNodes
    );

    let destroyed = false;

    // --------------------------------------------------------
    // Lokale foutmeldingen
    // --------------------------------------------------------

    function clearError() {
      shell.error.textContent = "";
      shell.error.hidden = true;
    }

    function showError(error) {
      if (
        destroyed ||
        !shell.root.isConnected
      ) {
        return;
      }

      shell.error.textContent =
        error?.message ||
        String(error || "Action failed.");

      shell.error.hidden = false;
    }

    function runAction(callback) {
      if (destroyed) {
        return;
      }

      clearError();

      try {
        callback();

      } catch (error) {
        /*
         * Afgewezen invoer terugzetten naar de waarden
         * die daadwerkelijk in het concept staan.
         */
        try {
          renderStops(
            shell,
            cards,
            getState(),
            true
          );
        } catch (renderError) {
          console.error(
            "[RouteWorkspace:Stops] Could not refresh the stop list.",
            renderError
          );
        }

        showError(error);
      }
    }

    // --------------------------------------------------------
    // Knoppen bedienen
    // --------------------------------------------------------

    shell.root.addEventListener(
      "click",
      event => {
        const target = event.target;

        if (!(target instanceof Element)) {
          return;
        }

        const button = target.closest(
          "[data-rw-stops-action]"
        );

        if (
          !button ||
          !shell.root.contains(button) ||
          button.disabled
        ) {
          return;
        }

        const action =
          button.dataset.rwStopsAction;

        const locationKey =
          button.dataset.locationKey;

        runAction(() => {
          const snapshot = getState();

          switch (action) {
            case "expand-all":
              for (const card of cards.values()) {
                card.details.open = true;
              }
              break;

            case "collapse-all":
              for (const card of cards.values()) {
                card.details.open = false;
              }
              break;

            case "move-up":
            case "move-down": {
              const direction =
                action === "move-up"
                  ? -1
                  : 1;

              moveLocation(
                snapshot,
                actions,
                locationKey,
                direction
              );

              /*
               * De controller publiceert de nieuwe volgorde
               * direct. Herstel daarna de toetsenbordfocus
               * op de verplaatste locatie.
               */
              const card = cards.get(
                locationKey
              );

              if (card) {
                const moveButton =
                  direction === -1
                    ? card.moveUp
                    : card.moveDown;

                if (!moveButton.disabled) {
                  moveButton.focus();
                } else {
                  card.ordersSummary.focus();
                }
              }

              break;
            }

            case "clear-unloading":
              if (!isEditable(snapshot)) {
                throw new Error(
                  "Unloading settings cannot be changed right now."
                );
              }

              actions.setLocationUnloading(
                locationKey,
                {
                  mode: null,
                  minutes: null
                }
              );
              break;
          }
        });
      },
      listenerOptions
    );

    // --------------------------------------------------------
    // Lostijdvelden bedienen
    // --------------------------------------------------------

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

        if (
          !shell.root.contains(input) ||
          input.disabled
        ) {
          return;
        }

        const field =
          input.dataset.rwStopsField;

        const locationKey =
          input.dataset.locationKey;

        if (
          !field ||
          !locationKey
        ) {
          return;
        }

        runAction(() => {
          const snapshot = getState();

          if (!isEditable(snapshot)) {
            throw new Error(
              "No editable route is open."
            );
          }

          if (field === "mode") {
            if (
              snapshot.capabilities
                ?.unloadingMode !== true
            ) {
              throw new Error(
                "Unloading mode editing is unavailable."
              );
            }

            actions.setLocationUnloading(
              locationKey,
              {
                // Leeg betekent: algemene routemethode.
                mode: input.value || null
              }
            );

            return;
          }

          if (field === "minutes") {
            if (
              snapshot.capabilities
                ?.manualUnloading !== true
            ) {
              throw new Error(
                "Manual unloading time is unavailable."
              );
            }

            /*
             * Een leeg veld schakelt de handmatige
             * override uit. Nul blijft een geldige waarde.
             */
            if (input.validity.badInput) {
              throw new Error(
                "Enter a valid unloading time."
              );
            }

            if (!input.checkValidity()) {
              throw new Error(
                "Unloading minutes must be zero or greater."
              );
            }

            actions.setLocationUnloading(
              locationKey,
              {
                minutes:
                  input.value === ""
                    ? null
                    : input.value
              }
            );
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

      events.abort();

      cards.clear();

      if (shell.root.parentNode === slot) {
        slot.replaceChildren(
          ...originalChildren
        );
      } else {
        shell.root.remove();
      }
    }

    // --------------------------------------------------------
    // Module plaatsen en eerste weergave
    // --------------------------------------------------------

    try {
      slot.replaceChildren(
        shell.root
      );

      renderStops(
        shell,
        cards,
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

        renderStops(
          shell,
          cards,
          snapshot
        );
      },

      destroy
    };
  }

  // ==========================================================
  // 13. MODULE REGISTREREN
  // ==========================================================

  workspace.registerModule("stops", {
    mount: mountStops
  });

  // EINDE DEEL 3 VAN 3
})();

