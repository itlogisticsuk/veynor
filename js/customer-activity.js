(function () {
  "use strict";

  const TENANT_NAME = "Sofa2U";

  let client = null;
  let companyId = null;
  let currentProfile = null;

  let events = [];
  let filteredEvents = [];

const customerMap = new Map();
const userMap = new Map();
const orderMap = new Map();

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

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-GB");
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-GB");
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function showToast(message, type = "ok") {
    const el = byId("toast");
    if (!el) return;

    el.textContent = message || "";
    el.className = "notice " + type;

    clearTimeout(window.__customerActivityToast);
    window.__customerActivityToast = setTimeout(() => {
      el.textContent = "";
      el.className = "notice";
    }, 7000);
  }

  function ensureClient() {
    if (client) return client;
    if (typeof sb !== "function") throw new Error("Supabase helper sb() is not available.");
    client = sb();
    return client;
  }

  async function loadProfile() {
    const db = ensureClient();

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError) throw userError;

    const user = userData?.user;

    if (!user?.id) {
      window.location.replace("/login.html");
      throw new Error("Not authenticated.");
    }

    let result = await db
      .from("user_profiles")
      .select("id, auth_user_id, role, is_active, company_id, customer_id")
      .eq("id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!result.data && !result.error) {
      result = await db
        .from("user_profiles")
        .select("id, auth_user_id, role, is_active, company_id, customer_id")
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
    }

    if (result.error) throw result.error;
    if (!result.data?.id) throw new Error("No active profile found.");

    currentProfile = result.data;
    companyId = currentProfile.company_id || null;
  }

  async function getCompanyId() {
    if (companyId) return companyId;

    const db = ensureClient();

    const { data, error } = await db
      .from("companies")
      .select("id")
      .eq("name", TENANT_NAME)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error(`Company "${TENANT_NAME}" not found.`);

    companyId = data.id;
    return companyId;
  }

  function getCustomer(row) {
    if (!row.customer_id) return null;
    return customerMap.get(String(row.customer_id)) || null;
  }

  function getUser(row) {
    if (!row.user_profile_id) return null;
    return userMap.get(String(row.user_profile_id)) || null;
  }

  function getCustomerName(row) {
    const customer = getCustomer(row);
    return customer?.name || row.customer_name || "—";
  }

  function getCustomerCode(row) {
    const customer = getCustomer(row);
    return customer?.customer_code || "";
  }

  function getUserName(row) {
    const user = getUser(row);

    return (
      user?.full_name ||
      user?.email ||
      row.user_profile_id ||
      "—"
    );
  }

  function getUserRole(row) {
    const user = getUser(row);
    return user?.role || "—";
  }

  function eventLabel(value) {
    return String(value || "—").replaceAll("_", " ");
  }

function entityLabel(row) {
  const type = String(row.entity_type || "").toLowerCase();

  if (!row.entity_type && !row.entity_id) return "—";

  if (type === "order" && row.entity_id) {
    const order = orderMap.get(String(row.entity_id));

    if (order) {
      const orderNo = order.order_number || "";
      const ref = order.external_reference || order.purchase_order || "";

      if (orderNo && ref) return `${orderNo} (${ref})`;
      if (orderNo) return orderNo;
      if (ref) return ref;
    }
  }

  return [row.entity_type, row.entity_id].filter(Boolean).join(": ");
}

  async function loadLookupData(rawEvents) {
    const db = ensureClient();

    customerMap.clear();
    userMap.clear();
orderMap.clear();

    const customerIds = [...new Set(
      (rawEvents || []).map(row => row.customer_id).filter(Boolean).map(String)
    )];

    const userIds = [...new Set(
      (rawEvents || []).map(row => row.user_profile_id).filter(Boolean).map(String)
    )];

    if (customerIds.length) {
      const { data, error } = await db
        .from("customers")
        .select("id, name, customer_code")
        .in("id", customerIds);

      if (!error) {
        (data || []).forEach(row => {
          customerMap.set(String(row.id), row);
        });
      } else {
        console.warn("Customer lookup skipped:", error.message);
      }
    }

       if (userIds.length) {
      const { data, error } = await db
        .from("user_profiles")
        .select("id, auth_user_id, full_name, email, role")
        .or(
          `id.in.(${userIds.join(",")}),auth_user_id.in.(${userIds.join(",")})`
        );

      if (!error) {
        (data || []).forEach(row => {
          userMap.set(String(row.id), row);
          if (row.auth_user_id) userMap.set(String(row.auth_user_id), row);
        });
      } else {
        console.warn("User lookup skipped:", error.message);
      }
    }

    const orderIds = [...new Set(
      (rawEvents || [])
        .filter(row => String(row.entity_type || "").toLowerCase() === "order")
        .map(row => row.entity_id)
        .filter(Boolean)
        .map(String)
    )];

    if (orderIds.length) {
      const { data, error } = await db
        .from("orders")
        .select("id, order_number, external_reference, purchase_order")
        .in("id", orderIds);

      if (!error) {
        (data || []).forEach(row => {
          orderMap.set(String(row.id), row);
        });
      } else {
        console.warn("Order lookup skipped:", error.message);
      }
    }
  }

  async function loadEvents() {
    const db = ensureClient();
    const cid = await getCompanyId();
    const limit = Number(byId("filterLimit")?.value || 2000);

    let query = db
      .from("portal_events")
      .select("*")
      .eq("company_id", cid)
      .order("created_at", { ascending: false })
      .limit(limit);

    const from = byId("filterFrom")?.value || "";
    const to = byId("filterTo")?.value || "";

    if (from) query = query.gte("created_at", `${from}T00:00:00`);
    if (to) query = query.lte("created_at", `${to}T23:59:59`);

    const { data, error } = await query;

    if (error) throw error;

    events = data || [];

    await loadLookupData(events);

    renderFilterOptions();
    applyFilters();
  }

  function renderFilterOptions() {
    renderCustomerFilter();
    renderUserFilter();
    renderPageFilter();
  }

  function renderCustomerFilter() {
    const select = byId("filterCustomer");
    if (!select) return;

    const current = select.value || "";
    const map = new Map();

    events.forEach(row => {
      if (row.customer_id) {
        map.set(String(row.customer_id), getCustomerName(row));
      }
    });

    const rows = Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));

    select.innerHTML =
      `<option value="">All customers</option>` +
      rows.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");

    if (current && map.has(current)) select.value = current;
  }

  function renderUserFilter() {
    const select = byId("filterUser");
    if (!select) return;

    const current = select.value || "";
    const map = new Map();

    events.forEach(row => {
      if (row.user_profile_id) {
        map.set(String(row.user_profile_id), getUserName(row));
      }
    });

    const rows = Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));

    select.innerHTML =
      `<option value="">All users</option>` +
      rows.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");

    if (current && map.has(current)) select.value = current;
  }

  function renderPageFilter() {
    const select = byId("filterPage");
    if (!select) return;

    const current = select.value || "";

    const pages = [...new Set(events.map(row => row.page_name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    select.innerHTML =
      `<option value="">All pages</option>` +
      pages.map(page => `<option value="${escapeHtml(page)}">${escapeHtml(page)}</option>`).join("");

    if (current && pages.includes(current)) select.value = current;
  }

  function applyFilters() {
    const customerId = byId("filterCustomer")?.value || "";
    const userId = byId("filterUser")?.value || "";
    const eventType = byId("filterEventType")?.value || "";
    const page = byId("filterPage")?.value || "";
    const search = normalize(byId("filterSearch")?.value || "");

    filteredEvents = events.filter(row => {
      if (customerId && String(row.customer_id || "") !== String(customerId)) return false;
      if (userId && String(row.user_profile_id || "") !== String(userId)) return false;
      if (eventType && String(row.event_type || "") !== String(eventType)) return false;
      if (page && String(row.page_name || "") !== String(page)) return false;

      if (search) {
        const haystack = [
          row.event_type,
          row.page_name,
          row.entity_type,
          row.entity_id,
          row.description,
          getCustomerName(row),
          getCustomerCode(row),
          getUserName(row),
          getUserRole(row),
          JSON.stringify(row.metadata || {})
        ].join(" ").toLowerCase();

        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    renderAll();
  }

  function renderAll() {
    renderKpis();
    renderSummaryTables();
    renderActivityTable();
  }

  function renderKpis() {
    const users = new Set(filteredEvents.map(e => e.user_profile_id).filter(Boolean));
    const customers = new Set(filteredEvents.map(e => e.customer_id).filter(Boolean));

    const downloads = filteredEvents.filter(e =>
      ["document_download", "document_open", "invoice_open", "pod_open", "delivery_note_open"].includes(normalize(e.event_type))
    ).length;

    const pageViews = filteredEvents.filter(e => normalize(e.event_type) === "page_view").length;

    setText("kpiEvents", formatNumber(filteredEvents.length));
    setText("kpiUsers", formatNumber(users.size));
    setText("kpiCustomers", formatNumber(customers.size));
    setText("kpiDownloads", formatNumber(downloads));
    setText("kpiPageViews", formatNumber(pageViews));
  }

  function countBy(rows, keyFn) {
    const map = new Map();

    rows.forEach(row => {
      const key = keyFn(row) || "—";
      map.set(key, (map.get(key) || 0) + 1);
    });

    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }

  function renderSummaryTables() {
    renderSmallTable("topUsersBody", countBy(filteredEvents, getUserName));
    renderSmallTable(
      "topPagesBody",
      countBy(filteredEvents.filter(e => normalize(e.event_type) === "page_view"), e => e.page_name)
    );
    renderSmallTable(
      "topDownloadsBody",
      countBy(
        filteredEvents.filter(e =>
          ["document_download", "document_open", "invoice_open", "pod_open", "delivery_note_open"].includes(normalize(e.event_type))
        ),
        e => e.description || e.entity_id || e.entity_type || "Document"
      )
    );
  }

  function renderSmallTable(bodyId, rows) {
    const body = byId(bodyId);
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="2">No data.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(([label, total]) => `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td><strong>${formatNumber(total)}</strong></td>
      </tr>
    `).join("");
  }

  function renderActivityTable() {
    const body = byId("activityBody");
    if (!body) return;

    setText("activityMeta", `${formatNumber(filteredEvents.length)} event(s) shown`);

    if (!filteredEvents.length) {
      body.innerHTML = `<tr><td colspan="8">No activity found.</td></tr>`;
      return;
    }

    body.innerHTML = filteredEvents.map(row => {
      const customerCode = getCustomerCode(row);

      return `
        <tr>
          <td>${escapeHtml(formatDateTime(row.created_at))}</td>
          <td>
            <strong>${escapeHtml(getCustomerName(row))}</strong>
            ${customerCode ? `<span class="subline">${escapeHtml(customerCode)}</span>` : ""}
          </td>
          <td>${escapeHtml(getUserName(row))}</td>
          <td>${escapeHtml(getUserRole(row))}</td>
          <td><span class="status-pill status-planned">${escapeHtml(eventLabel(row.event_type))}</span></td>
          <td>${escapeHtml(row.page_name || "—")}</td>
          <td>${escapeHtml(entityLabel(row))}</td>
          <td>
            ${escapeHtml(row.description || "—")}
            ${row.metadata && Object.keys(row.metadata).length ? `<span class="subline">${escapeHtml(JSON.stringify(row.metadata))}</span>` : ""}
          </td>
        </tr>
      `;
    }).join("");
  }

  function exportCsv() {
    const headers = [
      "created_at",
      "customer",
      "customer_code",
      "user",
      "role",
      "event_type",
      "page_name",
      "entity_type",
      "entity_id",
      "description"
    ];

    const rows = filteredEvents.map(row => [
      row.created_at || "",
      getCustomerName(row),
      getCustomerCode(row),
      getUserName(row),
      getUserRole(row),
      row.event_type || "",
      row.page_name || "",
      row.entity_type || "",
      row.entity_id || "",
      row.description || ""
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    [
      "filterCustomer",
      "filterUser",
      "filterEventType",
      "filterPage",
      "filterSearch"
    ].forEach(id => {
      byId(id)?.addEventListener("input", applyFilters);
      byId(id)?.addEventListener("change", applyFilters);
    });

    [
      "filterFrom",
      "filterTo",
      "filterLimit"
    ].forEach(id => {
      byId(id)?.addEventListener("change", () => {
        loadEvents().catch(error => showToast(error.message, "err"));
      });
    });

    byId("btnRefreshActivity")?.addEventListener("click", () => {
      loadEvents()
        .then(() => showToast("Activity refreshed.", "ok"))
        .catch(error => showToast(error.message, "err"));
    });

    byId("btnExportActivity")?.addEventListener("click", exportCsv);
  }

  async function init() {
    try {
      await loadProfile();
      bindEvents();
      await loadEvents();
    } catch (error) {
      console.error("[customer-activity]", error);
      showToast(error.message || "Customer activity could not be loaded.", "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();