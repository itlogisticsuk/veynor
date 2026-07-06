(function () {
  "use strict";

  const MODULE_NAME = "portal-events";

  let client = null;
  let profile = null;
  let sessionId = null;

  function log(...args) {
    console.log(`[${MODULE_NAME}]`, ...args);
  }

  function ensureClient() {
    if (client) return client;

    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    client = sb();
    return client;
  }

  function pageName() {
    const path = window.location.pathname
      .split("/")
      .pop()
      ?.replace(".html", "");

    return path || "index";
  }

  function generateSessionId() {
    return (
      Date.now().toString(36) +
      Math.random().toString(36).substring(2, 12)
    );
  }

  function getSessionId() {
    let id = sessionStorage.getItem("veynor_session_id");

    if (!id) {
      id = generateSessionId();
      sessionStorage.setItem("veynor_session_id", id);
    }

    return id;
  }

  async function loadProfile() {
    const db = ensureClient();

    const { data: userData } = await db.auth.getUser();

    const user = userData?.user;

    if (!user?.id) return null;

    let result = await db
      .from("user_profiles")
      .select(`
        id,
        auth_user_id,
        company_id,
        customer_id,
        role
      `)
      .eq("id", user.id)
      .maybeSingle();

    if (!result.data && !result.error) {
      result = await db
        .from("user_profiles")
        .select(`
          id,
          auth_user_id,
          company_id,
          customer_id,
          role
        `)
        .eq("auth_user_id", user.id)
        .maybeSingle();
    }

    profile = result.data || null;

    return profile;
  }

  async function writeEvent({
    eventType,
    entityType = null,
    entityId = null,
    description = null,
    metadata = {}
  }) {

    try {

      if (!profile?.company_id) return;

      const db = ensureClient();

      await db
        .from("portal_events")
        .insert({
          company_id: profile.company_id,
          user_profile_id: profile.id,
          customer_id: profile.customer_id,

          session_id: sessionId,

          event_type: eventType,
          page_name: pageName(),

          entity_type: entityType,
          entity_id: entityId,

          description,

          metadata,

          user_agent: navigator.userAgent
        });

    } catch (err) {
      console.warn("portal_events insert skipped:", err.message);
    }
  }

  async function logPageView() {

    await writeEvent({
      eventType: "page_view",
      description: `Viewed ${pageName()}`
    });

  }

  async function logLogin() {

    await writeEvent({
      eventType: "login",
      description: "User logged in"
    });

  }

  async function logLogout() {

    await writeEvent({
      eventType: "logout",
      description: "User logged out"
    });

  }

  function hookDownloads() {

    document.addEventListener("click", async (event) => {

      const target = event.target.closest("a,button");

      if (!target) return;

if (
  target.dataset.portalDocType ||
  target.dataset.documentType ||
  target.dataset.docType
) {
  return;
}

      const text =
        target.textContent?.trim() ||
        target.innerText?.trim() ||
        "";

      const href =
        target.href ||
        target.dataset.url ||
        "";

      const lowered =
        `${text} ${href}`.toLowerCase();

      if (
        lowered.includes("invoice") ||
        lowered.includes("delivery note") ||
        lowered.includes("pod") ||
        lowered.includes(".pdf")
      ) {

        await writeEvent({
          eventType: "document_download",
          entityType: "document",
          entityId: href || text,
          description: text,
          metadata: {
            url: href
          }
        });

      }

    });

  }

function hookDocumentActions() {

  document.addEventListener("click", async (event) => {

    const el = event.target.closest(
      "[data-portal-doc-type],[data-document-type],[data-doc-type]"
    );

    if (!el) return;

    const docType =
      el.dataset.portalDocType ||
      el.dataset.documentType ||
      el.dataset.docType ||
      "document";

    const action =
      el.dataset.portalDocAction ||
      el.dataset.documentAction ||
      el.dataset.docAction ||
      "opened";

    const orderId =
      el.dataset.orderId ||
      el.closest("[data-order-id]")?.dataset.orderId ||
      null;

    const orderNumber =
      el.dataset.orderNumber ||
      el.closest("[data-order-number]")?.dataset.orderNumber ||
      null;

    const url =
      el.href ||
      el.dataset.url ||
      el.dataset.fileUrl ||
      "";

    const cleanDocType = String(docType).toLowerCase().replaceAll("-", "_");
    const cleanAction = String(action).toLowerCase().replaceAll("-", "_");

    await writeEvent({
      eventType: `${cleanDocType}_${cleanAction}`,
      entityType: "document",
      entityId: url || orderId || orderNumber || cleanDocType,
      description: `${niceDocumentType(cleanDocType)} ${cleanAction}`,
      metadata: {
        document_type: cleanDocType,
        action: cleanAction,
        order_id: orderId,
        order_number: orderNumber,
        url
      }
    });

  });

}

function niceDocumentType(value) {
  const map = {
    ack: "ACK",
    acknowledgement: "ACK",
    delivery_note: "Delivery Note",
    invoice: "Invoice",
    credit_note: "Credit Note",
    pod: "POD",
    pod_photos: "POD Photos"
  };

  return map[value] || String(value || "Document").replaceAll("_", " ");
}

  function hookOrderClicks() {

    document.addEventListener("click", async (event) => {

      const el = event.target.closest(
        "[data-order-id],[data-order-number]"
      );

      if (!el) return;

      await writeEvent({
        eventType: "order_open",
        entityType: "order",
        entityId:
          el.dataset.orderId ||
          el.dataset.orderNumber ||
          "",
        description: "Order opened"
      });

    });

  }

  function hookVisibilityTracking() {

    let hiddenAt = null;

    document.addEventListener("visibilitychange", async () => {

      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }

      if (!hiddenAt) return;

      const seconds =
        Math.round((Date.now() - hiddenAt) / 1000);

      await writeEvent({
        eventType: "page_return",
        description: "User returned to page",
        metadata: {
          hidden_seconds: seconds
        }
      });

    });

  }

  function hookLogoutButtons() {

    document.addEventListener("click", async (event) => {

      const button = event.target.closest(
        "#logoutBtn,.logout-btn,[data-logout]"
      );

      if (!button) return;

      await logLogout();

    });

  }

  async function init() {

  try {

    sessionId = getSessionId();

    await loadProfile();

    if (!profile) {
      console.warn("portal-events: no profile loaded");
      return;
    }

    await logPageView();

 hookDownloads();
hookDocumentActions();
hookOrderClicks();
    hookVisibilityTracking();
    hookLogoutButtons();

    console.log("portal-events active", {
      page: pageName(),
      profile: profile.id
    });

  } catch (err) {

    console.error("portal-events init failed:", err);

  }

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.PortalEvents = {
  track: writeEvent,
  trackLogin: logLogin,
  trackLogout: logLogout
};

})();