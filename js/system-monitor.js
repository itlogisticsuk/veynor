(function () {
  "use strict";

  if (window.__VeynorSystemMonitorActive) return;
  window.__VeynorSystemMonitorActive = true;

  const CONFIG = {
    table: "system_events",
    maxTextLength: 180,
    clickThrottleMs: 700,
    performanceDelayMs: 1800,
    heartbeatIntervalMs: 5 * 60 * 1000
  };

  let client = null;
  let profile = null;
  let companyId = null;
  let lastClickKey = "";
  let lastClickAt = 0;

  function getClient() {
    if (client) return client;
    if (typeof window.sb === "function") client = window.sb();
    else if (window.supabaseClient) client = window.supabaseClient;
    else if (window.supabase) client = window.supabase;
    return client;
  }

  function clean(value, max = CONFIG.maxTextLength) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getBrowser() {
    const ua = navigator.userAgent || "";
    if (/Edg\//i.test(ua)) return "Microsoft Edge";
    if (/Chrome\//i.test(ua)) return "Chrome";
    if (/Firefox\//i.test(ua)) return "Firefox";
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
    return "Browser";
  }

  function viewport() {
    return `${window.innerWidth || 0}x${window.innerHeight || 0}`;
  }

  async function loadProfile() {
    try {
      const db = getClient();
      if (!db) return;

      const { data: authData } = await db.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) return;

      const { data } = await db
        .from("user_profiles")
        .select("id, company_id, role, full_name, email")
        .eq("id", userId)
        .maybeSingle();

      if (data) {
        profile = data;
        companyId = data.company_id || null;
      }
    } catch (error) {
      console.warn("System monitor profile load failed:", error);
    }
  }

  function basePayload(eventType, eventGroup) {
    return {
      company_id: companyId,
      user_profile_id: profile?.id || null,

      event_type: eventType,
      event_group: eventGroup || null,

      page_path: location.pathname,
      page_title: document.title || null,

      browser: getBrowser(),
      user_agent: navigator.userAgent || null,
      viewport: viewport(),

      metadata: {
        url: location.href,
        referrer: document.referrer || null,
        role: profile?.role || null,
        local_time: nowIso()
      }
    };
  }

async function logEvent(eventType, eventGroup, extra = {}) {
  try {
    const db = getClient();

    if (!db) {
      console.error("[system-monitor] Supabase client unavailable");
      return false;
    }

    const payload = {
      ...basePayload(eventType, eventGroup),
      ...extra
    };

    const { error } = await db
      .from(CONFIG.table)
      .insert(payload);

    if (error) {
      console.error("[system-monitor] Insert failed:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        payload
      });

      return false;
    }

    console.debug("[system-monitor] Event stored:", eventType);
    return true;
  } catch (error) {
    console.error("[system-monitor] Unexpected logging failure:", error);
    return false;
  }
}

  function getElementLabel(el) {
    if (!el) return "";

    return clean(
      el.getAttribute("data-track-label") ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      el.value ||
      el.id ||
      el.name ||
      el.tagName
    );
  }

  function getElementId(el) {
    return clean(
      el.getAttribute("data-track-id") ||
      el.id ||
      el.name ||
      ""
    );
  }

  function isDownload(el) {
    if (!el) return false;

    const href = el.getAttribute("href") || "";
    const text = getElementLabel(el).toLowerCase();

    if (el.hasAttribute("download")) return true;
    if (/\.(pdf|csv|xlsx|xls|docx|zip)(\?|#|$)/i.test(href)) return true;
    if (text.includes("download")) return true;
    if (text.includes("export")) return true;
    if (text.includes("invoice")) return true;
    if (text.includes("pod")) return true;
    if (text.includes("ack")) return true;
    if (text.includes("delivery note")) return true;

    return false;
  }

  function inferEntity(el) {
    const raw =
      el?.getAttribute("data-order-id") ||
      el?.getAttribute("data-id") ||
      el?.getAttribute("data-route-id") ||
      el?.getAttribute("data-invoice-id") ||
      el?.closest("[data-order-id]")?.getAttribute("data-order-id") ||
      el?.closest("[data-id]")?.getAttribute("data-id") ||
      "";

    let entityType = null;

    if (el?.getAttribute("data-order-id") || el?.closest("[data-order-id]")) entityType = "order";
    else if (el?.getAttribute("data-route-id")) entityType = "route";
    else if (el?.getAttribute("data-invoice-id")) entityType = "invoice";

    return {
      entity_type: entityType,
      entity_id: raw || null
    };
  }

  function classifyClick(el) {
    const label = getElementLabel(el).toLowerCase();
    const href = el?.getAttribute("href") || "";

    if (isDownload(el)) return "download";
    if (href) return "navigation";
    if (label.includes("invoice")) return "invoice_action";
    if (label.includes("match")) return "matching_action";
    if (label.includes("import")) return "import_action";
    if (label.includes("pod")) return "pod_action";
    if (label.includes("credit")) return "credit_action";
    if (label.includes("save")) return "save_action";
    if (label.includes("delete") || label.includes("remove")) return "delete_action";
    if (label.includes("refresh")) return "refresh_action";

    return "click";
  }

  function bindClicks() {
    document.addEventListener(
      "click",
      event => {
        const el = event.target.closest("button, a, [data-track]");
        if (!el) return;

        const label = getElementLabel(el);
        const id = getElementId(el);
        const href = el.getAttribute("href") || "";

        const clickKey = `${location.pathname}|${id}|${label}|${href}`;
        const now = Date.now();

        if (clickKey === lastClickKey && now - lastClickAt < CONFIG.clickThrottleMs) return;

        lastClickKey = clickKey;
        lastClickAt = now;

        const clickType = classifyClick(el);
        const entity = inferEntity(el);

        logEvent(
          clickType === "download" ? "document_download_clicked" : "ui_click",
          clickType,
          {
            element_tag: el.tagName || null,
            element_id: id || null,
            element_text: label || null,
            element_href: href || null,
            entity_type: entity.entity_type,
            entity_id: entity.entity_id,
            success: null,
            metadata: {
              ...basePayload("tmp", "tmp").metadata,
              click_type: clickType,
              classes: clean(el.className || "", 250),
              disabled: !!el.disabled
            }
          }
        );
      },
      true
    );
  }

  function bindErrors() {
    window.addEventListener("error", event => {
      logEvent("javascript_error", "error", {
        success: false,
        error_message: clean(event.message, 500),
        error_stack: clean(event.error?.stack || "", 3000),
        metadata: {
          ...basePayload("tmp", "tmp").metadata,
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null
        }
      });
    });

    window.addEventListener("unhandledrejection", event => {
      const reason = event.reason;

      logEvent("promise_rejection", "error", {
        success: false,
        error_message: clean(reason?.message || reason || "Unhandled promise rejection", 500),
        error_stack: clean(reason?.stack || "", 3000)
      });
    });
  }

  function getPerformancePayload() {
    const nav = performance.getEntriesByType("navigation")[0];

    if (!nav) {
      const timing = performance.timing;
      if (!timing || !timing.navigationStart) return {};

      return {
        page_load_ms: timing.loadEventEnd - timing.navigationStart,
        dom_ready_ms: timing.domContentLoadedEventEnd - timing.navigationStart
      };
    }

    return {
      page_load_ms: Math.round(nav.loadEventEnd),
      dom_ready_ms: Math.round(nav.domContentLoadedEventEnd),
      duration_ms: Math.round(nav.duration),
      metadata: {
        ...basePayload("tmp", "tmp").metadata,
        type: nav.type,
        redirect_ms: Math.round(nav.redirectEnd - nav.redirectStart),
        dns_ms: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
        connect_ms: Math.round(nav.connectEnd - nav.connectStart),
        request_ms: Math.round(nav.responseStart - nav.requestStart),
        response_ms: Math.round(nav.responseEnd - nav.responseStart),
        dom_interactive_ms: Math.round(nav.domInteractive),
        transfer_size: nav.transferSize || null,
        encoded_body_size: nav.encodedBodySize || null,
        decoded_body_size: nav.decodedBodySize || null
      }
    };
  }

  async function measureDbResponse() {
    const db = getClient();
    if (!db) return null;

    const started = performance.now();

    try {
      const { error } = await db
        .from("companies")
        .select("id")
        .limit(1);

      const duration = Math.round(performance.now() - started);

      if (error) {
        await logEvent("database_health_check_failed", "health", {
          success: false,
          db_response_ms: duration,
          error_message: error.message
        });

        return duration;
      }

      return duration;
    } catch (error) {
      const duration = Math.round(performance.now() - started);

      await logEvent("database_health_check_failed", "health", {
        success: false,
        db_response_ms: duration,
        error_message: error.message || "Database health check failed"
      });

      return duration;
    }
  }

  async function logPageView() {
    const dbMs = await measureDbResponse();

    await logEvent("page_view", "navigation", {
      success: true,
      db_response_ms: dbMs,
      ...getPerformancePayload()
    });
  }

  function startHeartbeat() {
    window.setInterval(async () => {
      if (document.hidden) return;

      const dbMs = await measureDbResponse();

      logEvent("heartbeat", "health", {
        success: true,
        db_response_ms: dbMs
      });
    }, CONFIG.heartbeatIntervalMs);
  }

  function exposeManualApi() {
    window.VeynorSystemMonitor = {
      log: logEvent,

      success(action, metadata = {}) {
        return logEvent(action + "_success", "action_result", {
          success: true,
          metadata: {
            ...basePayload("tmp", "tmp").metadata,
            ...metadata
          }
        });
      },

      failed(action, error, metadata = {}) {
        return logEvent(action + "_failed", "action_result", {
          success: false,
          error_message: clean(error?.message || error || "Action failed", 500),
          error_stack: clean(error?.stack || "", 3000),
          metadata: {
            ...basePayload("tmp", "tmp").metadata,
            ...metadata
          }
        });
      },

      click(action, metadata = {}) {
        return logEvent(action + "_clicked", "manual_click", {
          metadata: {
            ...basePayload("tmp", "tmp").metadata,
            ...metadata
          }
        });
      }
    };
  }

  async function init() {
    await loadProfile();

    bindClicks();
    bindErrors();
    exposeManualApi();

    setTimeout(logPageView, CONFIG.performanceDelayMs);
    startHeartbeat();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();