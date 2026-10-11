/*
 * VEYNOR ROUTE WORKSPACE
 * File: /js/planning-engine/route-workspace.js
 *
 * DEEL 1 VAN 3
 *
 * Centrale controller:
 * - Workspace-status en conceptwijzigingen
 * - Koppeling met de bestaande Planning Engine
 * - Koppeling met afzonderlijke Workspace-modules
 * - Controle van de actieve bedrijfsomgeving
 *
 * De popup, kaart, stops, instellingen en suggesties
 * worden in afzonderlijke bestanden uitgewerkt.
 *
 * Deze controller schrijft niets naar de database.
 *
 * Plak deel 2 en deel 3 direct onder dit gedeelte.
 */

(function () {
  "use strict";

  // Voorkom dubbele initialisatie.
  if (window.VeynorRouteWorkspace) {
    return;
  }

  const VERSION = "1.0.0";

  const UNLOADING_MODES = [
    "fixed",
    "orders",
    "volume",
    "combined"
  ];

  const MODULE_NAMES = [
    "ui",
    "stops",
    "map",
    "settings",
    "suggestions"
  ];

  const modules = new Map();
  const handles = new Map();

  // Deze tellers voorkomen dat oude berekeningen
  // een nieuwere route of nieuwere wijzigingen overschrijven.
  let session = 0;
  let request = 0;

  let timer = null;
  let originalDraft = null;
  let returnFocus = null;

  let state = createEmptyState();

  // ==========================================================
  // 1. STATUS EN VEILIGE KOPIEËN
  // ==========================================================

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }


function createEmptyState() {
  return {
    version: VERSION,

    isOpen: false,
    status: "closed",
    error: null,

    companyId: null,

    route: null,
    draft: null,

    preview: null,
    baseline: null,

    dirty: false,

    revision: 0,
    previewRevision: -1,

    // Open standaard met de routekaart.
    activeTab: "route",

    // Opslaan blijft bewust geblokkeerd.
    saveEnabled: false,

    capabilities: {
      stopOrder: true,
      unloadingMode: true,
      manualUnloading: true,

      vehicle: true,
      date: true,
      startTime: true,

      osrmToggle: false,
      groupingToggle: false,
      unloadingCalculationToggle: false,
      capacityToggle: false,
      earliestDateToggle: false,
      returnToDepotToggle: false,

      unloadingFormula: false,
      driverAssignment: false,

      suggestions: false,
      saving: false
    }
  };
}

  function getState() {
    // Modules ontvangen een kopie en kunnen de centrale
    // status daardoor niet rechtstreeks veranderen.
    return clone(state);
  }

  function emit() {
    const snapshot = getState();

    for (const [name, handle] of handles) {
      try {
        if (typeof handle?.render === "function") {
          handle.render(clone(snapshot));
        }
      } catch (error) {
        console.error(
          `[RouteWorkspace:${name}] Render failed.`,
          error
        );
      }
    }

    window.dispatchEvent(
      new CustomEvent("veynor:workspace-changed", {
        detail: snapshot
      })
    );
  }

  // ==========================================================
  // 2. BEDRIJF EN PLANNING ENGINE
  // ==========================================================

  function activeCompany() {
    const candidates = [
      window.VeynorPlannerData?.companyId,

      window.VeynorOrdersPlanner
        ?.getCompanyId?.()
    ];

    // Dezelfde bedrijfs-ID-bronnen als de huidige engine.
    const companyId = candidates.find(value => {
      return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)
      );
    });

    if (!companyId) {
      throw new Error(
        "Wait until the planner has loaded its company."
      );
    }

    return companyId;
  }

  function engine() {
    const planningEngine =
      window.VeynorPlanningEngine;

    if (
      typeof planningEngine
        ?.previewRouteChanges !== "function"
    ) {
      throw new Error(
        "Load planning-engine.js before Route Workspace."
      );
    }

    return planningEngine;
  }

  function assertEditable() {
    if (
      !state.isOpen ||
      !state.draft ||
      state.status === "loading"
    ) {
      throw new Error(
        "No loaded route is open."
      );
    }

    if (activeCompany() !== state.companyId) {
      throw new Error(
        "Company changed. Close and reopen the Workspace."
      );
    }
  }

  // ==========================================================
  // 3. MODULES AANSLUITEN
  // ==========================================================

  /*
   * Iedere module registreert zich later met:
   *
   * VeynorRouteWorkspace.registerModule("ui", {
   *   mount(context) {
   *     return {
   *       root: popupElement,
   *       render(snapshot) { ... },
   *       destroy() { ... }
   *     };
   *   }
   * });
   *
   * mount() moet synchroon zijn.
   *
   * context bevat:
   * - getState(): veilige kopie van de huidige status
   * - actions: openbare controllerfuncties uit deel 3
   * - root: het popup-element van de UI-module
   *
   * destroy() verwijdert de eigen elementen,
   * eventlisteners en eventuele kaartinstantie.
   */

  function registerModule(name, module) {
    if (
      !MODULE_NAMES.includes(name) ||
      typeof module?.mount !== "function"
    ) {
      throw new Error(
        "Invalid Workspace module."
      );
    }

    if (state.isOpen) {
      throw new Error(
        "Register modules before opening a route."
      );
    }

    if (modules.has(name)) {
      throw new Error(
        `Module ${name} is already registered.`
      );
    }

    modules.set(name, module);

    // De UI moet altijd als eerste worden opgebouwd.
    // De overige modules gebruiken daarna haar popup-element.
    const uiModule = modules.get("ui");

    if (uiModule) {
      modules.delete("ui");

      const otherModules = [...modules];

      modules.clear();
      modules.set("ui", uiModule);

      for (const [moduleName, registeredModule] of otherModules) {
        modules.set(
          moduleName,
          registeredModule
        );
      }
    }
  }

  function mountModules() {
    for (const [name, module] of modules) {
      const handle = module.mount({
        getState,

        // api wordt in deel 3 aangemaakt.
        actions: api,

        root: handles.get("ui")?.root || null
      });

      if (
        handle &&
        typeof handle.then === "function"
      ) {
        throw new Error(
          `Module ${name} must mount synchronously.`
        );
      }

      if (
        name === "ui" &&
        typeof handle?.destroy !== "function"
      ) {
        throw new Error(
          "UI mount must return a handle with destroy()."
        );
      }

      handles.set(name, handle || {});
    }
  }

  function destroyModules() {
    // Eerst de kaart en andere onderdelen verwijderen,
    // daarna pas de popup waarin ze staan.
    const mountedModules = [...handles].reverse();

    for (const [name, handle] of mountedModules) {
      try {
        if (typeof handle?.destroy === "function") {
          handle.destroy();
        }
      } catch (error) {
        console.error(
          `[RouteWorkspace:${name}] Cleanup failed.`,
          error
        );
      }
    }

    handles.clear();
  }

  // EINDE DEEL 1 VAN 3
  // Plak deel 2 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 4. BESTAANDE ROUTE OPENEN
  // ==========================================================

  async function open(routeId) {
    if (
      typeof routeId !== "string" ||
      !routeId.trim()
    ) {
      throw new Error(
        "An existing route ID is required."
      );
    }

    if (!modules.has("ui")) {
      throw new Error(
        "Load route-workspace-ui.js before opening the Workspace."
      );
    }

    // Controleer de afhankelijkheden vóór het openen.
    engine();

    const companyId = activeCompany();

    if (typeof sb !== "function") {
      throw new Error(
        "Supabase helper sb() is missing."
      );
    }

    // Bij conceptwijzigingen vraagt close() in deel 3
    // eerst of deze mogen worden weggegooid.
    if (state.isOpen && !close()) {
      return false;
    }

    const token = ++session;

    returnFocus = document.activeElement;

    state = {
      ...createEmptyState(),

      isOpen: true,
      status: "loading",

      companyId
    };

    try {
      mountModules();
      emit();

      const client = sb();

      const {
        data: route,
        error
      } = await client
        .from("routes")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", routeId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!route) {
        throw new Error(
          "Route not found or not accessible."
        );
      }

      // De gebruiker kan de popup tijdens het laden sluiten.
      if (token !== session) {
        return false;
      }

      if (activeCompany() !== companyId) {
        throw new Error(
          "Company changed while loading."
        );
      }

      // De engine haalt de bestaande routeorders op en
      // behoudt hun huidige volgorde.
      const preview = await engine()
        .previewRouteChanges({
          route_id: routeId
        });

      if (token !== session) {
        return false;
      }

      if (activeCompany() !== companyId) {
        throw new Error(
          "Company changed while loading."
        );
      }

      validatePreview(preview, routeId);

      const orderIds = preview.stops.map(stop => {
        return String(stop.order_id);
      });

      if (
        new Set(orderIds).size !== orderIds.length
      ) {
        throw new Error(
          "Duplicate route orders."
        );
      }

      state.route = clone(route);
      state.preview = clone(preview);

      // Dit is de eerste berekening bij het openen.
      // preview.before bevat de opgeslagen routetotalen.
      state.baseline = clone(preview);

      state.draft = {
        route_id: routeId,

        vehicle_id: preview.vehicle.id,

        route_date: preview.route_date,
        start_time: preview.start_time,

        order_ids: [...orderIds],
        stop_order_ids: [...orderIds],

        unloading_mode: preview.unloading_mode,

        mode_by_location: {},
        manual_minutes_by_location: {}
      };

      originalDraft = clone(state.draft);

      state.status = "ready";
      state.error = null;

      state.revision = 0;
      state.previewRevision = 0;

      state.dirty = false;
      state.saveEnabled = false;

      emit();

      return true;

    } catch (error) {
      // Een fout van een inmiddels gesloten of vervangen
      // Workspace mag de huidige sessie niet veranderen.
      if (token !== session) {
        return false;
      }

      state.status = "error";
      state.error = error.message || String(error);

      emit();

      // Een mislukte opening laat geen halve popup achter.
      // De aanroepende knop kan de foutmelding tonen.
      if (!state.draft) {
        close(true);
      }

      throw error;
    }
  }

  // ==========================================================
  // 5. PREVIEWSTRUCTUUR CONTROLEREN
  // ==========================================================

  function validatePreview(value, routeId) {
    const incomplete =
      !value?.ok ||

      String(value.route_id) !== String(routeId) ||

      !value.vehicle?.id ||

      !Array.isArray(value.locations) ||

      !Array.isArray(value.stops) ||

      !value.stops.length ||

      value.stops.some(stop => !stop.order_id) ||

      !value.after;

    if (incomplete) {
      throw new Error(
        "Planning Engine returned an incomplete route preview."
      );
    }

    // Een complete preview kan toch een ongeldige route
    // beschrijven. value.valid en value.warnings blijven
    // daarom beschikbaar voor de interface.
  }

  // ==========================================================
  // 6. CONCEPTWIJZIGINGEN VERWERKEN
  // ==========================================================

 
function change(update, options = {}) {
  assertEditable();

  const nextDraft = clone(state.draft);

  // Eerst een kopie wijzigen.
  // Bij een fout blijft het oorspronkelijke concept intact.
  update(nextDraft);

  if (
    JSON.stringify(nextDraft) ===
    JSON.stringify(state.draft)
  ) {
    return false;
  }

  state.draft = nextDraft;
  state.revision++;

  state.dirty =
    JSON.stringify(nextDraft) !==
    JSON.stringify(originalDraft);

  state.status = "stale";
  state.error = null;
  state.saveEnabled = false;

  // Oude berekeningen mogen het nieuwe concept
  // niet overschrijven.
  ++request;

  clearTimeout(timer);
  timer = null;

  // Alle modules onmiddellijk informeren.
  // Hierdoor werken kaart en Delivery Stops direct bij.
  emit();

  // Bij verslepen en Undo/Redo geen automatische berekening.
  if (options.recalculate === false) {
    return true;
  }

  // Andere wijzigingen blijven automatisch doorrekenen.
  timer = setTimeout(() => {
    timer = null;

    if (!state.isOpen || !state.draft) {
      return;
    }

    recalculate().catch(() => {
      // recalculate() verwerkt de fout in de Workspace-status.
    });
  }, 350);

  return true;
}


  // ==========================================================
  // 7. ROUTE OPNIEUW DOORREKENEN
  // ==========================================================

  async function recalculate() {
    assertEditable();

    clearTimeout(timer);
    timer = null;

    const token = session;
    const serial = ++request;

    const revision = state.revision;
    const companyId = state.companyId;

    // Iedere berekening krijgt haar eigen conceptkopie.
    const args = clone(state.draft);

    state.status = "calculating";
    state.error = null;
    state.saveEnabled = false;

    emit();

    try {
      const preview = await engine()
        .previewRouteChanges(args);

      // Alleen de meest recente berekening van de huidige
      // Workspace mag haar resultaat publiceren.
      if (
        token !== session ||
        serial !== request
      ) {
        return null;
      }

      if (activeCompany() !== companyId) {
        throw new Error(
          "Company changed while calculating."
        );
      }

      validatePreview(
        preview,
        args.route_id
      );

      const returnedIds = preview.stops.map(stop => {
        return String(stop.order_id);
      });

      const ordersMismatch =
        returnedIds.length !== args.order_ids.length ||

        new Set(returnedIds).size !== returnedIds.length ||

        returnedIds.some(id => {
          return !args.order_ids.includes(id);
        });

      if (ordersMismatch) {
        throw new Error(
          "Preview orders do not match the draft."
        );
      }

      state.preview = clone(preview);

      state.previewRevision = revision;

      state.status = "ready";
      state.error = null;

      // Ook bij een geldige preview blijft opslaan geblokkeerd.
      state.saveEnabled = false;

      emit();

      return clone(preview);

    } catch (error) {
      if (
        token !== session ||
        serial !== request
      ) {
        return null;
      }

      state.status = "error";
      state.error = error.message || String(error);

      state.saveEnabled = false;

      // De vorige preview blijft beschikbaar als referentie.
      // Door status en previewRevision weet de interface dat
      // deze niet bij het huidige concept hoort.
      emit();

      throw error;
    }
  }

  // EINDE DEEL 2 VAN 3
  // Plak deel 3 direct hieronder.
  // Voeg hier nog geen afsluitende })(); toe.

  // ==========================================================
  // 8. ROUTEGEGEVENS AANPASSEN
  // ==========================================================

  function setRouteDetails(patch = {}) {
    assertEditable();

    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch)
    ) {
      throw new Error(
        "Route settings must be an object."
      );
    }

    const allowedKeys = [
      "vehicle_id",
      "route_date",
      "start_time",
      "unloading_mode"
    ];

    if (
      Object.keys(patch).some(key => {
        return !allowedKeys.includes(key);
      })
    ) {
      throw new Error(
        "Unsupported route setting."
      );
    }

    const changes = {};

    if ("vehicle_id" in patch) {
      if (
        typeof patch.vehicle_id !== "string" ||
        !patch.vehicle_id.trim()
      ) {
        throw new Error(
          "Select a valid vehicle."
        );
      }

      changes.vehicle_id = patch.vehicle_id.trim();
    }

    if ("route_date" in patch) {
      const value = String(patch.route_date);

      const date = new Date(
        `${value}T12:00:00Z`
      );

      const validDate =
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;

      if (!validDate) {
        throw new Error(
          "Use a valid date in YYYY-MM-DD format."
        );
      }

      changes.route_date = value;
    }

    if ("start_time" in patch) {
      const value = String(patch.start_time);

      if (
        !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
          .test(value)
      ) {
        throw new Error(
          "Use a valid departure time, for example 08:00."
        );
      }

      changes.start_time = value;
    }

    if ("unloading_mode" in patch) {
      if (
        !UNLOADING_MODES.includes(
          patch.unloading_mode
        )
      ) {
        throw new Error(
          "Unknown unloading mode."
        );
      }

      changes.unloading_mode =
        patch.unloading_mode;
    }

    change(draft => {
      Object.assign(draft, changes);
    });
  }

  // ==========================================================
  // 9. LOSTIJD PER AFLEVERLOCATIE
  // ==========================================================

  function setLocationUnloading(
    locationKey,
    patch = {}
  ) {
    assertEditable();

    const locationExists =
      state.preview?.locations.some(location => {
        return location.location_key === locationKey;
      });

    if (!locationExists) {
      throw new Error(
        "Delivery location not found."
      );
    }

    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch)
    ) {
      throw new Error(
        "Unloading settings must be an object."
      );
    }

    const allowedKeys = [
      "mode",
      "minutes"
    ];

    if (
      Object.keys(patch).some(key => {
        return !allowedKeys.includes(key);
      })
    ) {
      throw new Error(
        "Unsupported unloading setting."
      );
    }

    // mode: null verwijdert de afwijkende methode
    // en gebruikt weer de algemene routemethode.
    if (
      "mode" in patch &&
      patch.mode != null &&
      !UNLOADING_MODES.includes(patch.mode)
    ) {
      throw new Error(
        "Unknown unloading mode."
      );
    }

    let minutes = null;

    // minutes: null of "" verwijdert de handmatige lostijd.
    // Nul minuten blijft een geldige handmatige waarde.
    if (
      "minutes" in patch &&
      patch.minutes != null &&
      patch.minutes !== ""
    ) {
      const input = patch.minutes;

      if (
        !["string", "number"].includes(
          typeof input
        ) ||
        (
          typeof input === "string" &&
          !input.trim()
        )
      ) {
        throw new Error(
          "Enter a valid unloading time."
        );
      }

      minutes = Number(
        String(input).replace(",", ".")
      );

      if (
        !Number.isFinite(minutes) ||
        minutes < 0
      ) {
        throw new Error(
          "Unloading minutes must be zero or greater."
        );
      }
    }

    change(draft => {
      if ("mode" in patch) {
        if (patch.mode == null) {
          delete draft.mode_by_location[
            locationKey
          ];
        } else {
          draft.mode_by_location[
            locationKey
          ] = patch.mode;
        }
      }

      if ("minutes" in patch) {
        if (minutes == null) {
          delete draft.manual_minutes_by_location[
            locationKey
          ];
        } else {
          draft.manual_minutes_by_location[
            locationKey
          ] = minutes;
        }
      }
    });
  }

  // ==========================================================
  // 10. STOPVOLGORDE AANPASSEN
  // ==========================================================


function setStopOrder(orderIds) {
  assertEditable();

  if (!Array.isArray(orderIds)) {
    throw new Error(
      "Order IDs must be an array."
    );
  }

  const ids = orderIds.map(String);

  const expectedIds = (
    state.draft.order_ids || []
  ).map(String);

  if (
    ids.length !== expectedIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some(id => !expectedIds.includes(id))
  ) {
    throw new Error(
      "Include every route order exactly once."
    );
  }

  // Controleer of alle orders aan een afleverlocatie
  // gekoppeld zijn.
  const locationByOrderId = new Map();

  for (const location of state.preview?.locations || []) {
    for (const orderId of location.order_ids || []) {
      const id = String(orderId);

      if (locationByOrderId.has(id)) {
        throw new Error(
          "An order belongs to multiple delivery locations."
        );
      }

      locationByOrderId.set(
        id,
        String(location.location_key)
      );
    }
  }

  const visitedLocations = new Set();
  let previousLocation = null;

  for (const orderId of ids) {
    const locationKey =
      locationByOrderId.get(orderId);

    if (!locationKey) {
      throw new Error(
        "Order has no delivery location."
      );
    }

    // Orders van dezelfde afleverlocatie
    // moeten aaneengesloten blijven.
    if (
      locationKey !== previousLocation &&
      visitedLocations.has(locationKey)
    ) {
      throw new Error(
        "Keep orders at the same address together."
      );
    }

    visitedLocations.add(locationKey);
    previousLocation = locationKey;
  }

  // Alleen conceptvolgorde wijzigen.
  // Geen automatische herberekening.
  return change(
    draft => {
      draft.stop_order_ids = [...ids];
    },
    {
      recalculate: false
    }
  );
}

  // ==========================================================
  // 11. CONCEPT TERUGZETTEN
  // ==========================================================


function reset() {
  assertEditable();

  if (!originalDraft) {
    throw new Error(
      "Original route draft is unavailable."
    );
  }

  const restoredDraft = clone(originalDraft);

  return change(
    draft => {
      // Alle huidige conceptvelden verwijderen,
      // zodat er geen oude instellingen achterblijven.
      for (const key of Object.keys(draft)) {
        delete draft[key];
      }

      Object.assign(draft, restoredDraft);
    },
    {
      recalculate: true
    }
  );
}

  // ==========================================================
  // 12. TAB SELECTEREN
  // ==========================================================

  function setTab(tab) {
    if (!state.isOpen) {
      throw new Error(
        "No Route Workspace is open."
      );
    }

    const allowedTabs = [
      "route",
      "stops",
      "vehicle",
      "settings",
      "suggestions",
      "summary"
    ];

    if (!allowedTabs.includes(tab)) {
      throw new Error(
        "Unknown Workspace tab."
      );
    }

    state.activeTab = tab;

    emit();
  }

  // ==========================================================
  // 13. WORKSPACE SLUITEN
  // ==========================================================

  function close(discard = false) {
    if (!state.isOpen) {
      return true;
    }

    if (
      state.dirty &&
      discard !== true
    ) {
      const confirmed = window.confirm(
        "Discard unsaved Route Workspace changes?"
      );

      if (!confirmed) {
        return false;
      }
    }

    // Resultaten van nog lopende verzoeken worden
    // na het sluiten niet meer geaccepteerd.
    ++session;
    ++request;

    clearTimeout(timer);
    timer = null;

    destroyModules();

    state = createEmptyState();
    originalDraft = null;

    // Geef toetsenbordfocus terug aan bijvoorbeeld
    // de Route Workspace-knop bij Available Vehicles.
    const focusTarget = returnFocus;

    returnFocus = null;

    if (
      focusTarget?.isConnected &&
      typeof focusTarget.focus === "function"
    ) {
      try {
        focusTarget.focus();
      } catch (error) {
        console.warn(
          "[RouteWorkspace] Could not restore focus.",
          error
        );
      }
    }

    emit();

    return true;
  }

  // ==========================================================
  // 14. OPSLAG BLIJFT GEBLOKKEERD
  // ==========================================================

  async function save() {
    /*
     * Ook wanneer preview.can_save true is, schrijft
     * deze Workspace nog niets naar Supabase.
     *
     * De veilige opslag wordt later afzonderlijk
     * geïmplementeerd en gecontroleerd.
     */
    throw new Error(
      "Route saving is not enabled. " +
      "No changes have been written."
    );
  }

  // ==========================================================
  // 15. OPENBARE CONTROLLERFUNCTIES
  // ==========================================================

  const api = Object.freeze({
    version: VERSION,

    registerModule,
    getState,

    open,
    close,

    recalculate,

    setRouteDetails,
    setLocationUnloading,
    setStopOrder,

    setTab,
    reset,

    save
  });

  window.VeynorRouteWorkspace = api;

  // EINDE DEEL 3 VAN 3
})();

