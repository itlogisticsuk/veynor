(function(){

"use strict";

function byId(id){
  return document.getElementById(id);
}

function toast(msg,type="ok"){

  const el = byId("toast");

  el.textContent = msg;
  el.className = "notice "+type;

  setTimeout(()=>{
    el.textContent="";
    el.className="notice";
  },4000)

}


async function getActiveTenantId(client) {
  const { data: auth, error: authError } =
    await client.auth.getUser();

  if (authError) throw authError;

  const userId = auth?.user?.id;

  if (!userId) {
    throw new Error(
      "Cannot load warehouse events: user is not authenticated."
    );
  }

  const { data: profiles, error } = await client
    .from("user_profiles")
    .select("company_id")
    .eq("auth_user_id", userId)
    .eq("is_active", true);

  if (error) throw error;

  if (!profiles || profiles.length !== 1) {
    throw new Error(
      "Cannot determine a unique active tenant."
    );
  }

  if (!profiles[0].company_id) {
    throw new Error(
      "Active user profile has no company_id."
    );
  }

  return profiles[0].company_id;
}



async function loadEvents() {
  try {
    const client = sb();
    const companyId = await getActiveTenantId(client);

    const { data, error } = await client
      .from("warehouse_events")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const rows = (data || []).filter(
      row => row.company_id === companyId
    );

    renderEvents(rows);

  } catch (error) {
    console.error(
      "Warehouse events load failed:",
      error
    );

    renderEvents([]);

    toast(
      error.message || "Could not load warehouse events.",
      "error"
    );
  }
}



function renderEvents(rows) {
  const tbody = byId("eventsBody");

  if (!tbody) return;

  tbody.replaceChildren();

  const createCell = (tr, value) => {
    const td = document.createElement("td");
    td.textContent = String(value ?? "");
    tr.appendChild(td);
    return td;
  };

  const addSubline = (cell, label, value) => {
    if (!value) return;

    const span = document.createElement("span");
    span.className = "subline";
    span.textContent = `${label}: ${value}`;
    cell.appendChild(span);
  };

  (rows || []).forEach(row => {
    const tr = document.createElement("tr");

    const date = row.created_at
      ? new Date(row.created_at)
      : null;

    const time =
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleString("en-GB")
        : "—";

    createCell(tr, time);
    createCell(tr, row.event_type || "—");
    createCell(tr, row.entity_type || "—");

    const referenceCell = createCell(
      tr,
      row.reference_no || "—"
    );

    addSubline(
      referenceCell,
      "Order",
      row.payload?.order_number
    );

    addSubline(
      referenceCell,
      "Supplier Ref",
      row.payload?.supplier_reference ||
        row.payload?.external_reference
    );

    createCell(
      tr,
      row.source_module || "—"
    );

    createCell(
      tr,
      `${row.old_status || ""} → ${row.new_status || ""}`
    );

    tbody.appendChild(tr);
  });
}

function init(){

  byId("btnRefresh").onclick = loadEvents

  loadEvents()

}

document.addEventListener("DOMContentLoaded",init)

})();
