(function () {
  "use strict";

  let db = null;
  let charts = {};
  let state = {
    events: [],
    profiles: [],
    filtered: [],
    currentDbMs: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function ensureClient() {
    if (db) return db;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    db = sb();
    return db;
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function n(value, digits = 0) {
    const num = Number(value || 0);
    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function ms(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return "—";
    return `${n(num, 0)} ms`;
  }

  function pct(value) {
    const num = Number(value || 0);
    return `${n(num, 1)}%`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message;
    el.className = "notice " + type;

    clearTimeout(window.__healthToastTimer);
    window.__healthToastTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 5000);
  }

  function getDateRange() {
    const preset = byId("periodPreset")?.value || "24h";
    const now = new Date();
    let from = new Date(now);
    let to = new Date(now);

    if (preset === "1h") from.setHours(now.getHours() - 1);
    else if (preset === "6h") from.setHours(now.getHours() - 6);
    else if (preset === "7d") from.setDate(now.getDate() - 7);
    else if (preset === "30d") from.setDate(now.getDate() - 30);
    else if (preset === "custom") {
      const f = byId("dateFrom")?.value;
      const t = byId("dateTo")?.value;
      if (f) from = new Date(f);
      if (t) to = new Date(t);
    } else {
      from.setHours(now.getHours() - 24);
    }

    return {
      from,
      to,
      fromIso: from.toISOString(),
      toIso: to.toISOString()
    };
  }

  function eventIsError(e) {
    return [
      "javascript_error",
      "promise_rejection",
      "database_health_check_failed"
    ].includes(e.event_type) || e.success === false;
  }

  function eventIsClick(e) {
    return e.event_type === "ui_click";
  }

  function eventIsDownload(e) {
    return e.event_type === "document_download_clicked" ||
      String(e.event_group || "").includes("download");
  }

  function eventIsPageView(e) {
    return e.event_type === "page_view";
  }

  function avg(rows, key) {
    const vals = rows
      .map(r => Number(r[key] || 0))
      .filter(v => Number.isFinite(v) && v > 0);

    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  function countBy(rows, fn) {
    const map = new Map();

    rows.forEach(row => {
      const key = fn(row) || "Unknown";
      map.set(key, (map.get(key) || 0) + 1);
    });

    return Array.from(map.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);
  }

  function groupBy(rows, fn) {
    const map = new Map();

    rows.forEach(row => {
      const key = fn(row) || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });

    return map;
  }

  function profileName(id) {
    if (!id) return "Unknown user";

    const p = state.profiles.find(x => String(x.id) === String(id));
    return p?.full_name || p?.email || id.slice(0, 8);
  }

  function profileRole(id) {
    const p = state.profiles.find(x => String(x.id) === String(id));
    return p?.role || "—";
  }

  function shortPage(path) {
    return String(path || "Unknown")
      .replace("/", "")
      .replace(".html", "") || "dashboard";
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function makeChart(id, type, labels, datasets, options = {}) {
    const canvas = byId(id);
    if (!canvas || typeof Chart === "undefined") return;

    destroyChart(id);

    charts[id] = new Chart(canvas, {
      type,
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" }
        },
        scales: type === "doughnut" ? undefined : {
          y: { beginAtZero: true }
        },
        ...options
      }
    });
  }

  function bucketKey(dateValue) {
    const preset = byId("periodPreset")?.value || "24h";
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return "Unknown";

    if (["1h", "6h", "24h"].includes(preset)) {
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit"
      });
    }

    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short"
    });
  }

  async function runHealthCheck() {
    const started = performance.now();

    try {
      const client = ensureClient();

      setCheck("checkSupabase", "OK", "good");
      setCheckDot("checkSupabaseDot", "good");

      const { data: authData } = await client.auth.getUser();
      if (authData?.user?.id) {
        setCheck("checkAuth", "Signed in", "good");
        setCheckDot("checkAuthDot", "good");
      } else {
        setCheck("checkAuth", "No user", "warn");
        setCheckDot("checkAuthDot", "warn");
      }

      const dbStart = performance.now();
      const { error: dbError } = await client.from("companies").select("id").limit(1);
      const dbMs = Math.round(performance.now() - dbStart);
      state.currentDbMs = dbMs;

      if (dbError) {
        setCheck("checkDb", dbError.message, "bad");
        setCheckDot("checkDbDot", "bad");
      } else {
        setCheck("checkDb", `${dbMs} ms`, dbMs > 1000 ? "warn" : "good");
        setCheckDot("checkDbDot", dbMs > 1000 ? "warn" : "good");
      }

      const { error: eventsError } = await client.from("system_events").select("id").limit(1);

      if (eventsError) {
        setCheck("checkEvents", eventsError.message, "bad");
        setCheckDot("checkEventsDot", "bad");
      } else {
        setCheck("checkEvents", "Readable", "good");
        setCheckDot("checkEventsDot", "good");
      }

      setCheck("checkStorage", "Optional", "warn");
      setCheckDot("checkStorageDot", "warn");

      setCheck("checkNetlify", "Manual", "warn");
      setCheckDot("checkNetlifyDot", "warn");

      const totalMs = Math.round(performance.now() - started);
      setText("systemStatusText", "System online");
      setText("systemStatusSub", `Health check completed in ${totalMs} ms`);
      setStatusDot("systemLiveDot", "good");
      setText("kpiSystemStatus", "OK");
      setText("kpiSystemStatusSub", `DB ${dbMs} ms`);

      setText("dbCurrent", ms(dbMs));

      return true;
    } catch (error) {
      setText("systemStatusText", "System issue");
      setText("systemStatusSub", error.message || "Health check failed");
      setStatusDot("systemLiveDot", "bad");
      setText("kpiSystemStatus", "Issue");
      setText("kpiSystemStatusSub", error.message || "Health check failed");

      setCheck("checkSupabase", error.message || "Failed", "bad");
      setCheckDot("checkSupabaseDot", "bad");

      return false;
    }
  }

  function setCheck(id, value, status) {
    const el = byId(id);
    if (!el) return;
    el.innerHTML = `<span class="mini-status ${status}">${escapeHtml(value)}</span>`;
  }

  function setCheckDot(id, status) {
    setStatusDot(id, status);
  }

  function setStatusDot(id, status) {
    const el = byId(id);
    if (!el) return;
    el.className = "health-status-dot" + (status === "bad" ? " bad" : status === "warn" ? " warn" : "");
  }

  async function loadProfiles() {
    const client = ensureClient();

    const { data, error } = await client
      .from("user_profiles")
      .select("id, full_name, email, role");

    if (error) {
      console.warn("Could not load user profiles:", error.message);
      state.profiles = [];
      return;
    }

    state.profiles = data || [];
  }

  async function loadEvents() {
    const client = ensureClient();
    const range = getDateRange();
    const limit = Number(byId("rawLimit")?.value || 1000);

    let query = client
      .from("system_events")
      .select("*")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: false })
      .limit(Math.max(limit, 2000));

    const { data, error } = await query;

    if (error) throw error;

    state.events = data || [];
    populateFilters();
    applyFilters();
  }

  function populateFilters() {
    const pageSelect = byId("pageFilter");
    if (pageSelect) {
      const current = pageSelect.value;
      const pages = [...new Set(state.events.map(e => e.page_path).filter(Boolean))]
        .sort();

      pageSelect.innerHTML =
        `<option value="">All pages</option>` +
        pages.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

      if (current) pageSelect.value = current;
    }
  }

  function applyFilters() {
    const page = byId("pageFilter")?.value || "";
    const type = byId("eventFilter")?.value || "";
    const q = clean(byId("searchInput")?.value || "").toLowerCase();

    state.filtered = state.events.filter(e => {
      if (page && e.page_path !== page) return false;
      if (type && e.event_type !== type) return false;

      if (q) {
        const haystack = [
          e.event_type,
          e.event_group,
          e.page_path,
          e.element_text,
          e.element_id,
          e.element_href,
          e.error_message,
          e.browser,
          profileName(e.user_profile_id)
        ].join(" ").toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    renderAll();
  }

function renderAll() {
  renderKpis();
  renderManagementDashboard();
  renderPageOptimisation();
  renderActionsDashboard();
  renderOverview();
  renderPerformance();
  renderErrors();
  renderClicks();
  renderDownloads();
  renderUsers();
  renderDatabase();
  renderRaw();
}

function scoreStatus(score) {
  if (score >= 90) return { label: "Excellent", cls: "good" };
  if (score >= 80) return { label: "Good", cls: "good" };
  if (score >= 65) return { label: "Needs optimisation", cls: "warn" };
  return { label: "Critical", cls: "bad" };
}

function calculateHealthScore(rows) {
  const errors = rows.filter(eventIsError).length;
  const failed = rows.filter(e => e.success === false).length;
  const avgPage = avg(rows.filter(eventIsPageView), "page_load_ms");
  const avgDb = avg(rows, "db_response_ms");

  let score = 100;

  if (avgDb > 250) score -= 5;
  if (avgDb > 500) score -= 10;
  if (avgDb > 1000) score -= 15;

  if (avgPage > 1000) score -= 5;
  if (avgPage > 2000) score -= 10;
  if (avgPage > 4000) score -= 15;

  score -= Math.min(errors * 3, 25);
  score -= Math.min(failed * 2, 20);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderManagementDashboard() {
  const rows = state.filtered;

  const errors = rows.filter(eventIsError);
  const failed = rows.filter(e => e.success === false);
  const downloads = rows.filter(eventIsDownload);
  const pageViews = rows.filter(eventIsPageView);
  const clicks = rows.filter(eventIsClick);
  const activeUsers = new Set(rows.map(e => e.user_profile_id).filter(Boolean));

  const score = calculateHealthScore(rows);
  const status = scoreStatus(score);

  setText("mgmtHealthScore", `${score}%`);
  setText("mgmtHealthScoreSub", status.label);
  setText("mgmtPlatformErrors", n(errors.length));
  setText("mgmtFailedActions", n(failed.length));
  setText("mgmtActiveUsers", n(activeUsers.size));

  setText("usageDownloads", n(downloads.length));
  setText("usagePageViews", n(pageViews.length));
  setText("usageButtonClicks", n(clicks.length));

  const imported = rows.filter(e =>
    e.event_type?.includes("import") ||
    e.element_text?.toLowerCase().includes("import")
  ).length;

  const matched = rows.filter(e =>
    e.event_type?.includes("match") ||
    e.element_text?.toLowerCase().includes("match")
  ).length;

  const delivered = rows.filter(e =>
    e.event_type?.includes("delivered") ||
    e.element_text?.toLowerCase().includes("delivered")
  ).length;

  const invoices = rows.filter(e =>
    e.event_type?.includes("invoice") ||
    e.element_text?.toLowerCase().includes("invoice")
  ).length;

  const pods = rows.filter(e =>
    e.event_type?.includes("pod") ||
    e.element_text?.toLowerCase().includes("pod")
  ).length;

  setText("usageOrdersImported", n(imported));
  setText("usageOrdersMatched", n(matched));
  setText("usageOrdersDelivered", n(delivered));
  setText("usageInvoicesGenerated", n(invoices));
  setText("usagePodUploads", n(pods));

  makeChart("chartPlatformUsage", "bar",
    ["Imports", "Matches", "Delivered", "Invoices", "POD", "Downloads", "Page views", "Clicks"],
    [{
      label: "Events",
      data: [
        imported,
        matched,
        delivered,
        invoices,
        pods,
        downloads.length,
        pageViews.length,
        clicks.length
      ]
    }]
  );

  const avgPage = avg(pageViews, "page_load_ms");
  const avgDb = avg(rows, "db_response_ms");

  makeChart("chartHealthScoreBreakdown", "bar",
    ["Health score", "Errors", "Failed", "Avg page sec", "Avg DB sec"],
    [{
      label: "Score / impact",
      data: [
        score,
        errors.length,
        failed.length,
        Math.round(avgPage / 1000),
        Math.round(avgDb / 1000)
      ]
    }]
  );
}

function calculatePageScore(row) {
  let score = 100;

  if (row.avgLoad > 1000) score -= 8;
  if (row.avgLoad > 2000) score -= 12;
  if (row.avgLoad > 4000) score -= 18;

  if (row.avgDb > 250) score -= 5;
  if (row.avgDb > 500) score -= 10;
  if (row.avgDb > 1000) score -= 15;

  score -= Math.min(row.errors * 4, 24);
  score -= Math.min(row.failed * 3, 18);

  if (row.errorRate > 5) score -= 10;
  if (row.errorRate > 10) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderPageOptimisation() {
  const rows = state.filtered;
  const groupedPages = groupBy(rows, e => shortPage(e.page_path));

  const pageRows = Array.from(groupedPages.entries()).map(([page, list]) => {
    const visits = list.filter(eventIsPageView).length;
    const clicks = list.filter(eventIsClick).length;
    const downloads = list.filter(eventIsDownload).length;
    const errors = list.filter(eventIsError).length;
    const failed = list.filter(e => e.success === false).length;
    const avgLoad = avg(list.filter(eventIsPageView), "page_load_ms");
    const avgDb = avg(list, "db_response_ms");
    const slowestLoad = Math.max(...list.map(e => Number(e.page_load_ms || 0)), 0);
    const errorRate = visits ? (errors / visits) * 100 : 0;

    const row = {
      page,
      visits,
      clicks,
      downloads,
      errors,
      failed,
      avgLoad,
      avgDb,
      slowestLoad,
      errorRate
    };

    row.score = calculatePageScore(row);
    return row;
  }).sort((a, b) => a.score - b.score);

  const body = byId("pageOptimisationBody");
  if (body) {
    body.innerHTML = pageRows.map(r => {
      const status = scoreStatus(r.score);

      return `
        <tr>
          <td><strong>${escapeHtml(r.page)}</strong></td>
          <td>${n(r.visits)}</td>
          <td>${n(r.clicks)}</td>
          <td>${n(r.downloads)}</td>
          <td>${r.errors ? `<span class="mini-status bad">${n(r.errors)}</span>` : `<span class="mini-status good">0</span>`}</td>
          <td>${r.failed ? `<span class="mini-status bad">${n(r.failed)}</span>` : `<span class="mini-status good">0</span>`}</td>
          <td>${ms(r.avgLoad)}</td>
          <td>${ms(r.avgDb)}</td>
          <td>${ms(r.slowestLoad)}</td>
          <td>${pct(r.errorRate)}</td>
          <td><strong>${r.score}%</strong></td>
          <td><span class="mini-status ${status.cls}">${escapeHtml(status.label)}</span></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="12">No page optimisation data found.</td></tr>`;
  }

  const worst = pageRows.slice(0, 12);

  makeChart("chartPageOptimisationScores", "bar",
    worst.map(r => r.page),
    [{
      label: "Optimisation score",
      data: worst.map(r => r.score)
    }]
  );

  makeChart("chartPageUsageErrors", "bar",
    pageRows.slice().sort((a, b) => b.visits - a.visits).slice(0, 12).map(r => r.page),
    [
      {
        label: "Visits",
        data: pageRows.slice().sort((a, b) => b.visits - a.visits).slice(0, 12).map(r => r.visits)
      },
      {
        label: "Errors",
        data: pageRows.slice().sort((a, b) => b.visits - a.visits).slice(0, 12).map(r => r.errors)
      }
    ]
  );
}

function actionName(e) {
  return String(e.event_type || "")
    .replace("_success", "")
    .replace("_failed", "")
    .replace("_clicked", "")
    .replaceAll("_", " ")
    .trim() || "Unknown action";
}

function isActionResult(e) {
  return e.event_group === "action_result" ||
    String(e.event_type || "").endsWith("_success") ||
    String(e.event_type || "").endsWith("_failed");
}

function renderActionsDashboard() {
  const rows = state.filtered;
  const actionRows = rows.filter(isActionResult);
  const failedRows = actionRows.filter(e => e.success === false || String(e.event_type || "").endsWith("_failed"));
  const successRows = actionRows.filter(e => e.success === true || String(e.event_type || "").endsWith("_success"));

  const slowRows = rows
    .filter(e => Number(e.duration_ms || 0) > 0 || Number(e.db_response_ms || 0) > 0)
    .sort((a, b) => {
      const av = Math.max(Number(a.duration_ms || 0), Number(a.db_response_ms || 0));
      const bv = Math.max(Number(b.duration_ms || 0), Number(b.db_response_ms || 0));
      return bv - av;
    })
    .slice(0, 50);

  const slowBody = byId("slowestActionsBody");
  if (slowBody) {
    slowBody.innerHTML = slowRows.map(e => `
      <tr>
        <td><strong>${escapeHtml(actionName(e))}</strong><span class="subline">${escapeHtml(e.event_type || "")}</span></td>
        <td>${escapeHtml(shortPage(e.page_path))}</td>
        <td>${escapeHtml(profileName(e.user_profile_id))}</td>
        <td>${ms(e.duration_ms)}</td>
        <td>${ms(e.db_response_ms)}</td>
        <td>${formatDate(e.created_at)}</td>
      </tr>
    `).join("") || `<tr><td colspan="6">No slow actions found yet.</td></tr>`;
  }

  const groupedActions = groupBy(actionRows, actionName);

  const actionStats = Array.from(groupedActions.entries()).map(([name, list]) => {
    const failed = list.filter(e => e.success === false || String(e.event_type || "").endsWith("_failed"));
    const success = list.filter(e => e.success === true || String(e.event_type || "").endsWith("_success"));
    const total = failed.length + success.length;
    const lastError = failed[0]?.error_message || "—";

    return {
      name,
      failed: failed.length,
      success: success.length,
      successPct: total ? (success.length / total) * 100 : 0,
      lastError
    };
  }).sort((a, b) => b.failed - a.failed);

  const failedBody = byId("failedActionsBody");
  if (failedBody) {
    failedBody.innerHTML = actionStats.map(r => `
      <tr>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td>${r.failed ? `<span class="mini-status bad">${n(r.failed)}</span>` : `<span class="mini-status good">0</span>`}</td>
        <td>${n(r.success)}</td>
        <td>${pct(r.successPct)}</td>
        <td>${escapeHtml(r.lastError)}</td>
      </tr>
    `).join("") || `<tr><td colspan="5">No action results found yet.</td></tr>`;
  }

  makeChart("chartActionSuccessRate", "doughnut",
    ["Success", "Failed"],
    [{
      label: "Actions",
      data: [successRows.length, failedRows.length]
    }]
  );

  const topFailed = actionStats.filter(r => r.failed > 0).slice(0, 12);

  makeChart("chartTopFailedActions", "bar",
    topFailed.map(r => r.name),
    [{
      label: "Failed",
      data: topFailed.map(r => r.failed)
    }]
  );
}

  function renderKpis() {
    const rows = state.filtered;
    const errors = rows.filter(eventIsError);
    const downloads = rows.filter(eventIsDownload);
    const clicks = rows.filter(eventIsClick);
    const pageViews = rows.filter(eventIsPageView);

    const avgPage = avg(pageViews, "page_load_ms");
    const avgDb = avg(rows, "db_response_ms");

    setText("kpiEvents", n(rows.length));
    setText("kpiPageViews", n(pageViews.length));
    setText("kpiClicks", n(clicks.length));
    setText("kpiDownloads", n(downloads.length));
    setText("kpiErrors", n(errors.length));
    setText("kpiAvgPageLoad", ms(avgPage));
    setText("kpiAvgDb", ms(avgDb));

    if (errors.length > 0) {
      setText("kpiSystemStatus", "Warning");
      setText("kpiSystemStatusSub", `${errors.length} issue(s) in selected period`);
      setStatusDot("systemLiveDot", "warn");
    }
  }

  function renderOverview() {
    const rows = state.filtered;
    const buckets = groupBy(rows, e => bucketKey(e.created_at));
    const labels = Array.from(buckets.keys()).reverse();

    const trendData = labels.map(label => {
      const list = buckets.get(label) || [];
      return {
        label,
        events: list.length,
        pageViews: list.filter(eventIsPageView).length,
        clicks: list.filter(eventIsClick).length,
        downloads: list.filter(eventIsDownload).length,
        errors: list.filter(eventIsError).length
      };
    });

    makeChart("chartEventsTrend", "line", labels, [
      { label: "Events", data: trendData.map(r => r.events), tension: .35 },
      { label: "Page views", data: trendData.map(r => r.pageViews), tension: .35 },
      { label: "Clicks", data: trendData.map(r => r.clicks), tension: .35 },
      { label: "Downloads", data: trendData.map(r => r.downloads), tension: .35 },
      { label: "Errors", data: trendData.map(r => r.errors), tension: .35 }
    ]);

    makeChart("chartPerformanceTrend", "line", labels, [
      { label: "Avg page load ms", data: labels.map(l => Math.round(avg(buckets.get(l) || [], "page_load_ms"))), tension: .35 },
      { label: "Avg DB ms", data: labels.map(l => Math.round(avg(buckets.get(l) || [], "db_response_ms"))), tension: .35 }
    ]);

    const errorSplit = countBy(rows.filter(eventIsError), e => e.event_type);
    makeChart("chartErrorSplit", "doughnut",
      errorSplit.map(r => r.key),
      [{ label: "Errors", data: errorSplit.map(r => r.value) }]
    );

    renderTopLists();
    renderCriticalList();
  }

  function renderTopLists() {
    const rows = state.filtered;

    renderSummaryList("topPagesList",
      countBy(rows.filter(eventIsPageView), e => shortPage(e.page_path)).slice(0, 8),
      "views"
    );

    renderSummaryList("topButtonsList",
      countBy(rows.filter(eventIsClick), e => e.element_text || e.element_id || "Unknown button").slice(0, 8),
      "clicks"
    );

    const pageGroups = groupBy(rows.filter(eventIsPageView), e => shortPage(e.page_path));
    const slow = Array.from(pageGroups.entries())
      .map(([page, list]) => ({
        key: page,
        value: Math.round(avg(list, "page_load_ms"))
      }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    renderSummaryList("slowPagesList", slow, "ms");
  }

  function renderSummaryList(id, rows, suffix) {
    const el = byId(id);
    if (!el) return;

    if (!rows.length) {
      el.innerHTML = `
        <div class="health-summary-row">
          <div class="health-summary-main">
            <div class="health-summary-title">No data</div>
            <div class="health-summary-sub">Nothing found in selected period.</div>
          </div>
          <div class="health-summary-value">—</div>
        </div>`;
      return;
    }

    el.innerHTML = rows.map(r => `
      <div class="health-summary-row">
        <div class="health-summary-main">
          <div class="health-summary-title">${escapeHtml(r.key)}</div>
          <div class="health-summary-sub">${escapeHtml(suffix)}</div>
        </div>
        <div class="health-summary-value">${suffix === "ms" ? ms(r.value) : n(r.value)}</div>
      </div>
    `).join("");
  }

  function renderCriticalList() {
    const el = byId("criticalList");
    if (!el) return;

    const rows = state.filtered.filter(eventIsError).slice(0, 6);

    if (!rows.length) {
      el.innerHTML = `
        <div class="health-summary-row">
          <div class="health-summary-main">
            <div class="health-summary-title">No critical items</div>
            <div class="health-summary-sub">No errors found in the selected period.</div>
          </div>
          <div class="health-summary-value">OK</div>
        </div>`;
      return;
    }

    el.innerHTML = rows.map(e => `
      <div class="health-summary-row">
        <div class="health-summary-main">
          <div class="health-summary-title">${escapeHtml(e.event_type)}</div>
          <div class="health-summary-sub">${escapeHtml(shortPage(e.page_path))} · ${escapeHtml(e.error_message || "No message")}</div>
        </div>
        <div class="health-summary-value">${formatDate(e.created_at)}</div>
      </div>
    `).join("");
  }

  function renderPerformance() {
    const rows = state.filtered;
    const pageViews = rows.filter(eventIsPageView);
    const dbRows = rows.filter(e => Number(e.db_response_ms || 0) > 0);

    const fastestPage = pageViews.filter(e => e.page_load_ms).sort((a, b) => a.page_load_ms - b.page_load_ms)[0];
    const slowestPage = pageViews.filter(e => e.page_load_ms).sort((a, b) => b.page_load_ms - a.page_load_ms)[0];
    const fastestDb = dbRows.sort((a, b) => a.db_response_ms - b.db_response_ms)[0];
    const slowestDb = dbRows.sort((a, b) => b.db_response_ms - a.db_response_ms)[0];

    setText("perfFastestPage", fastestPage ? shortPage(fastestPage.page_path) : "—");
    setText("perfSlowestPage", slowestPage ? shortPage(slowestPage.page_path) : "—");
    setText("perfFastestDb", fastestDb ? ms(fastestDb.db_response_ms) : "—");
    setText("perfSlowestDb", slowestDb ? ms(slowestDb.db_response_ms) : "—");

    const pageGroups = groupBy(pageViews, e => shortPage(e.page_path));
    const pageRows = Array.from(pageGroups.entries())
      .map(([page, list]) => ({
        page,
        pageLoad: Math.round(avg(list, "page_load_ms")),
        db: Math.round(avg(list, "db_response_ms"))
      }))
      .filter(r => r.pageLoad || r.db)
      .sort((a, b) => b.pageLoad - a.pageLoad)
      .slice(0, 12);

    makeChart("chartPageLoadByPage", "bar",
      pageRows.map(r => r.page),
      [{ label: "Page load ms", data: pageRows.map(r => r.pageLoad) }]
    );

    makeChart("chartDbByPage", "bar",
      pageRows.map(r => r.page),
      [{ label: "DB response ms", data: pageRows.map(r => r.db) }]
    );

    const body = byId("performanceBody");
    if (body) {
      const perfRows = rows
        .filter(e => e.page_load_ms || e.db_response_ms || e.duration_ms)
        .slice(0, 250);

      body.innerHTML = perfRows.map(e => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td><strong>${escapeHtml(shortPage(e.page_path))}</strong><span class="subline">${escapeHtml(e.page_path || "")}</span></td>
          <td>${escapeHtml(e.event_type || "—")}</td>
          <td>${ms(e.page_load_ms)}</td>
          <td>${ms(e.dom_ready_ms)}</td>
          <td>${ms(e.duration_ms)}</td>
          <td>${ms(e.db_response_ms)}</td>
          <td>${escapeHtml(e.browser || "—")}</td>
          <td>${escapeHtml(e.viewport || "—")}</td>
        </tr>
      `).join("") || `<tr><td colspan="9">No performance data found.</td></tr>`;
    }
  }

  function renderErrors() {
    const errors = state.filtered.filter(eventIsError);

    setText("errJs", n(errors.filter(e => e.event_type === "javascript_error").length));
    setText("errPromises", n(errors.filter(e => e.event_type === "promise_rejection").length));
    setText("errDb", n(errors.filter(e => e.event_type === "database_health_check_failed").length));

    const byPage = countBy(errors, e => shortPage(e.page_path)).slice(0, 12);
    makeChart("chartErrorsByPage", "bar",
      byPage.map(r => r.key),
      [{ label: "Errors", data: byPage.map(r => r.value) }]
    );

    const buckets = groupBy(errors, e => bucketKey(e.created_at));
    const labels = Array.from(buckets.keys()).reverse();

    makeChart("chartErrorsTrend", "line",
      labels,
      [{ label: "Errors", data: labels.map(l => (buckets.get(l) || []).length), tension: .35 }]
    );

    const body = byId("errorsBody");
    if (body) {
      body.innerHTML = errors.slice(0, 250).map(e => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td><span class="mini-status bad">${escapeHtml(e.event_type || "error")}</span></td>
          <td><strong>${escapeHtml(shortPage(e.page_path))}</strong><span class="subline">${escapeHtml(e.page_path || "")}</span></td>
          <td><div class="error-message">${escapeHtml(e.error_message || "No message")}</div></td>
          <td><div class="raw-json">${escapeHtml(e.error_stack || "—")}</div></td>
          <td>${escapeHtml(e.browser || "—")}</td>
          <td>${escapeHtml(profileName(e.user_profile_id))}</td>
        </tr>
      `).join("") || `<tr><td colspan="7">No errors found.</td></tr>`;
    }
  }

  function renderClicks() {
    const clicks = state.filtered.filter(eventIsClick);

    const byPage = countBy(clicks, e => shortPage(e.page_path)).slice(0, 12);
    makeChart("chartClicksByPage", "bar",
      byPage.map(r => r.key),
      [{ label: "Clicks", data: byPage.map(r => r.value) }]
    );

    const byType = countBy(clicks, e => e.metadata?.click_type || e.event_group || "click");
    makeChart("chartClicksByType", "doughnut",
      byType.map(r => r.key),
      [{ label: "Clicks", data: byType.map(r => r.value) }]
    );

    const body = byId("clicksBody");
    if (body) {
      body.innerHTML = clicks.slice(0, 300).map(e => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td><strong>${escapeHtml(shortPage(e.page_path))}</strong></td>
          <td>${escapeHtml(e.element_text || "—")}</td>
          <td>${escapeHtml(e.metadata?.click_type || e.event_group || "click")}</td>
          <td class="mono">${escapeHtml(e.element_id || "—")}</td>
          <td class="mono">${escapeHtml(e.element_href || "—")}</td>
          <td>${escapeHtml(profileName(e.user_profile_id))}</td>
          <td>${escapeHtml(e.browser || "—")}</td>
        </tr>
      `).join("") || `<tr><td colspan="8">No clicks found.</td></tr>`;
    }
  }

  function inferDownloadType(e) {
    const text = `${e.element_text || ""} ${e.element_href || ""}`.toLowerCase();

    if (text.includes("invoice") || text.includes("inv")) return "Invoice";
    if (text.includes("pod") || text.includes("proof")) return "POD";
    if (text.includes("ack")) return "ACK";
    if (text.includes("delivery")) return "Delivery Note";
    if (text.includes("csv") || text.includes("xlsx") || text.includes("export")) return "Export";

    return "Other";
  }

  function renderDownloads() {
    const downloads = state.filtered.filter(eventIsDownload);

    setText("dlInvoices", n(downloads.filter(e => inferDownloadType(e) === "Invoice").length));
    setText("dlPods", n(downloads.filter(e => inferDownloadType(e) === "POD").length));
    setText("dlExports", n(downloads.filter(e => inferDownloadType(e) === "Export").length));

    const byType = countBy(downloads, inferDownloadType);
    makeChart("chartDownloadsByType", "doughnut",
      byType.map(r => r.key),
      [{ label: "Downloads", data: byType.map(r => r.value) }]
    );

    const buckets = groupBy(downloads, e => bucketKey(e.created_at));
    const labels = Array.from(buckets.keys()).reverse();

    makeChart("chartDownloadsTrend", "line",
      labels,
      [{ label: "Downloads", data: labels.map(l => (buckets.get(l) || []).length), tension: .35 }]
    );

    const body = byId("downloadsBody");
    if (body) {
      body.innerHTML = downloads.slice(0, 300).map(e => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td><strong>${escapeHtml(shortPage(e.page_path))}</strong></td>
          <td>${escapeHtml(e.element_text || inferDownloadType(e))}</td>
          <td class="mono">${escapeHtml(e.element_href || "—")}</td>
          <td>${escapeHtml(e.entity_type || "—")}<span class="subline">${escapeHtml(e.entity_id || "")}</span></td>
          <td>${escapeHtml(profileName(e.user_profile_id))}</td>
          <td>${escapeHtml(e.browser || "—")}</td>
        </tr>
      `).join("") || `<tr><td colspan="7">No downloads found.</td></tr>`;
    }
  }

  function renderUsers() {
    const rows = state.filtered;
    const grouped = groupBy(rows, e => e.user_profile_id || "unknown");

    const userRows = Array.from(grouped.entries()).map(([userId, list]) => {
      const clicks = list.filter(eventIsClick);
      const downloads = list.filter(eventIsDownload);
      const errors = list.filter(eventIsError);
      const pageViews = list.filter(eventIsPageView);

      const topPage = countBy(list, e => shortPage(e.page_path))[0]?.key || "—";
      const topButton = countBy(clicks, e => e.element_text || e.element_id || "Unknown")[0]?.key || "—";
      const last = list.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

      return {
        userId,
        name: userId === "unknown" ? "Unknown user" : profileName(userId),
        role: userId === "unknown" ? "—" : profileRole(userId),
        events: list.length,
        pageViews: pageViews.length,
        clicks: clicks.length,
        downloads: downloads.length,
        errors: errors.length,
        avgPage: avg(pageViews, "page_load_ms"),
        avgDb: avg(list, "db_response_ms"),
        topPage,
        topButton,
        lastActivity: last?.created_at || null
      };
    }).sort((a, b) => b.events - a.events);

    setText("userActiveCount", n(userRows.length));

    const mostActive = userRows[0];
    setText("userMostActive", mostActive?.name || "—");
    setText("userMostActiveSub", mostActive ? `${mostActive.events} events` : "No activity yet");

    const topDownloader = userRows.slice().sort((a, b) => b.downloads - a.downloads)[0];
    setText("userTopDownloader", topDownloader?.downloads ? topDownloader.name : "—");
    setText("userTopDownloaderSub", topDownloader?.downloads ? `${topDownloader.downloads} downloads` : "No downloads yet");

    const mostErrors = userRows.slice().sort((a, b) => b.errors - a.errors)[0];
    setText("userMostErrors", mostErrors?.errors ? mostErrors.name : "—");
    setText("userMostErrorsSub", mostErrors?.errors ? `${mostErrors.errors} errors` : "No errors yet");

    const top10 = userRows.slice(0, 10);

    makeChart("chartUserActivitySplit", "bar",
      top10.map(u => u.name),
      [
        { label: "Page views", data: top10.map(u => u.pageViews) },
        { label: "Clicks", data: top10.map(u => u.clicks) },
        { label: "Downloads", data: top10.map(u => u.downloads) },
        { label: "Errors", data: top10.map(u => u.errors) }
      ]
    );

    makeChart("chartUserDownloads", "bar",
      top10.map(u => u.name),
      [{ label: "Downloads", data: top10.map(u => u.downloads) }]
    );

    const body = byId("usersBody");
    if (body) {
      body.innerHTML = userRows.map(u => `
        <tr>
          <td><strong>${escapeHtml(u.name)}</strong><span class="subline mono">${escapeHtml(u.userId)}</span></td>
          <td>${escapeHtml(u.role)}</td>
          <td>${n(u.events)}</td>
          <td>${n(u.pageViews)}</td>
          <td>${n(u.clicks)}</td>
          <td>${n(u.downloads)}</td>
          <td>${u.errors ? `<span class="mini-status bad">${n(u.errors)}</span>` : `<span class="mini-status good">0</span>`}</td>
          <td>${ms(u.avgPage)}</td>
          <td>${ms(u.avgDb)}</td>
          <td>${escapeHtml(u.topPage)}</td>
          <td>${escapeHtml(u.topButton)}</td>
          <td>${formatDate(u.lastActivity)}</td>
        </tr>
      `).join("") || `<tr><td colspan="12">No user activity found.</td></tr>`;
    }

    const movementBody = byId("userMovementsBody");
    if (movementBody) {
      movementBody.innerHTML = rows.slice(0, 400).map(e => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td><strong>${escapeHtml(profileName(e.user_profile_id))}</strong></td>
          <td>${escapeHtml(profileRole(e.user_profile_id))}</td>
          <td>${escapeHtml(e.event_type || "—")}</td>
          <td>${escapeHtml(shortPage(e.page_path))}</td>
          <td>${escapeHtml(e.element_text || e.element_href || "—")}</td>
          <td>${e.success === false ? `<span class="mini-status bad">Failed</span>` : e.success === true ? `<span class="mini-status good">OK</span>` : `<span class="mini-status info">Tracked</span>`}</td>
          <td>${e.page_load_ms ? `Page ${ms(e.page_load_ms)}` : ""}${e.db_response_ms ? `<span class="subline">DB ${ms(e.db_response_ms)}</span>` : ""}</td>
          <td>${escapeHtml(e.browser || "—")}</td>
        </tr>
      `).join("") || `<tr><td colspan="9">No movements found.</td></tr>`;
    }

    const browserSplit = countBy(rows, e => e.browser || "Unknown");
    makeChart("chartBrowserSplit", "doughnut",
      browserSplit.map(r => r.key),
      [{ label: "Events", data: browserSplit.map(r => r.value) }]
    );

    makeChart("chartUsersActivity", "bar",
      top10.map(u => u.name),
      [{ label: "Events", data: top10.map(u => u.events) }]
    );
  }

  function renderDatabase() {
    const rows = state.filtered.filter(e => e.db_response_ms || e.event_type === "heartbeat");

    setText("dbAverage", ms(avg(rows, "db_response_ms")));
    setText("dbFailed", n(rows.filter(e => e.event_type === "database_health_check_failed" || e.success === false).length));
    setText("dbHeartbeats", n(rows.filter(e => e.event_type === "heartbeat").length));

    const buckets = groupBy(rows, e => bucketKey(e.created_at));
    const labels = Array.from(buckets.keys()).reverse();

    makeChart("chartDbTrend", "line",
      labels,
      [{ label: "DB response ms", data: labels.map(l => Math.round(avg(buckets.get(l) || [], "db_response_ms"))), tension: .35 }]
    );

    const dist = [
      { key: "0-250 ms", value: rows.filter(e => e.db_response_ms > 0 && e.db_response_ms <= 250).length },
      { key: "250-500 ms", value: rows.filter(e => e.db_response_ms > 250 && e.db_response_ms <= 500).length },
      { key: "500-1000 ms", value: rows.filter(e => e.db_response_ms > 500 && e.db_response_ms <= 1000).length },
      { key: "1000+ ms", value: rows.filter(e => e.db_response_ms > 1000).length }
    ];

    makeChart("chartDbBuckets", "bar",
      dist.map(r => r.key),
      [{ label: "Checks", data: dist.map(r => r.value) }]
    );

    const body = byId("databaseBody");
    if (body) {
      body.innerHTML = rows.slice(0, 250).map(e => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td>${escapeHtml(e.event_type || "—")}</td>
          <td>${escapeHtml(shortPage(e.page_path))}</td>
          <td>${ms(e.db_response_ms)}</td>
          <td>${e.success === false ? `<span class="mini-status bad">Failed</span>` : `<span class="mini-status good">OK</span>`}</td>
          <td>${escapeHtml(e.error_message || "—")}</td>
          <td>${escapeHtml(e.browser || "—")}</td>
        </tr>
      `).join("") || `<tr><td colspan="7">No database checks found.</td></tr>`;
    }
  }

  function renderRaw() {
    const body = byId("rawEventsBody");
    if (!body) return;

    const limit = Number(byId("rawLimit")?.value || 250);
    const rows = state.filtered.slice(0, limit);

    body.innerHTML = rows.map(e => `
      <tr>
        <td>${formatDate(e.created_at)}</td>
        <td>${escapeHtml(e.event_type || "—")}</td>
        <td>${escapeHtml(e.event_group || "—")}</td>
        <td>${escapeHtml(shortPage(e.page_path))}<span class="subline">${escapeHtml(e.page_path || "")}</span></td>
        <td>${escapeHtml(e.element_text || "—")}<span class="subline mono">${escapeHtml(e.element_id || "")}</span></td>
        <td>${e.success === false ? `<span class="mini-status bad">false</span>` : e.success === true ? `<span class="mini-status good">true</span>` : `<span class="mini-status info">null</span>`}</td>
        <td>${ms(e.duration_ms)}</td>
        <td>${ms(e.page_load_ms)}</td>
        <td>${ms(e.db_response_ms)}</td>
        <td>${escapeHtml(e.error_message || "—")}</td>
        <td><div class="raw-json">${escapeHtml(JSON.stringify(e.metadata || {}, null, 2))}</div></td>
      </tr>
    `).join("") || `<tr><td colspan="11">No events found.</td></tr>`;
  }

  function exportCsv() {
    const rows = state.filtered;

    const headers = [
      "created_at",
      "event_type",
      "event_group",
      "page_path",
      "element_text",
      "element_id",
      "element_href",
      "success",
      "duration_ms",
      "page_load_ms",
      "dom_ready_ms",
      "db_response_ms",
      "error_message",
      "browser",
      "user"
    ];

    const csv = [
      headers,
      ...rows.map(e => [
        e.created_at,
        e.event_type,
        e.event_group,
        e.page_path,
        e.element_text,
        e.element_id,
        e.element_href,
        e.success,
        e.duration_ms,
        e.page_load_ms,
        e.dom_ready_ms,
        e.db_response_ms,
        e.error_message,
        e.browser,
        profileName(e.user_profile_id)
      ])
    ].map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `veynor-system-health-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  function bindTabs() {
    document.querySelectorAll(".health-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".health-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

        btn.classList.add("active");
        byId("tab-" + btn.dataset.tab)?.classList.add("active");

        setTimeout(renderAll, 80);
      });
    });
  }

  function bindEvents() {
    byId("btnRefreshHealth")?.addEventListener("click", async () => {
      try {
        await loadEvents();
        await runHealthCheck();
        showToast("System health refreshed.", "ok");
      } catch (error) {
        console.error(error);
        showToast(error.message || "Refresh failed.", "err");
      }
    });

    byId("btnRunHealthCheck")?.addEventListener("click", async () => {
      const ok = await runHealthCheck();
      showToast(ok ? "Health check completed." : "Health check found an issue.", ok ? "ok" : "err");
    });

    byId("btnExportHealthCsv")?.addEventListener("click", exportCsv);

    ["periodPreset", "dateFrom", "dateTo", "pageFilter", "eventFilter", "rawLimit"].forEach(id => {
      byId(id)?.addEventListener("change", async () => {
        if (["periodPreset", "dateFrom", "dateTo"].includes(id)) {
          await loadEvents();
        } else {
          applyFilters();
        }
      });
    });

    byId("searchInput")?.addEventListener("input", applyFilters);
  }

  async function init() {
    bindTabs();
    bindEvents();

    try {
      await loadProfiles();
      await loadEvents();
      await runHealthCheck();
      showToast("System health loaded.", "ok");
    } catch (error) {
      console.error(error);
      showToast(error.message || "System health could not load.", "err");
      setText("systemStatusText", "System Health issue");
      setText("systemStatusSub", error.message || "Could not load monitoring data");
      setStatusDot("systemLiveDot", "bad");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();