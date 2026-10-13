(function () {
  "use strict";

  function ensureClient() {
    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    return sb();
  }


async function getActiveTenantId(client) {
  const { data: auth, error: authError } =
    await client.auth.getUser();

  if (authError) throw authError;

  const userId = auth?.user?.id;

  if (!userId) {
    throw new Error(
      "Cannot log warehouse event: user is not authenticated."
    );
  }

  const { data: profiles, error } =
    await client
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


  function sanitizeRow(row) {
    if (!row || typeof row !== "object") {
      throw new Error("Invalid warehouse event row.");
    }

    if (!row.company_id) {
      throw new Error("warehouse event requires company_id.");
    }

    if (!row.event_type) {
      throw new Error("warehouse event requires event_type.");
    }

    if (!row.entity_type) {
      throw new Error("warehouse event requires entity_type.");
    }

    return {
      company_id: row.company_id,
      event_type: String(row.event_type).trim(),
      entity_type: String(row.entity_type).trim(),
      entity_id: row.entity_id || null,
      reference_no: row.reference_no || null,
      source_module: row.source_module || null,
      user_profile_id: row.user_profile_id || null,
      old_status: row.old_status || null,
      new_status: row.new_status || null,
      payload: row.payload && typeof row.payload === "object" ? row.payload : {}
    };
  }


async function logWarehouseEvent(row) {
  const client = ensureClient();
  const activeTenantId =
    await getActiveTenantId(client);

  const payload = sanitizeRow(row);

  if (payload.company_id !== activeTenantId) {
    throw new Error(
      "Warehouse event rejected: company_id does not match the active tenant."
    );
  }

  const { data, error } = await client
    .from("warehouse_events")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;

  return data?.id || null;
}


async function logWarehouseEvents(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const client = ensureClient();
  const activeTenantId =
    await getActiveTenantId(client);

  const payload = rows.map(sanitizeRow);

  const invalidRows = payload.filter(
    row => row.company_id !== activeTenantId
  );

  if (invalidRows.length > 0) {
    throw new Error(
      `Warehouse event batch rejected: ${invalidRows.length} event(s) belong to another tenant.`
    );
  }

  const { data, error } = await client
    .from("warehouse_events")
    .insert(payload)
    .select("id");

  if (error) throw error;

  return data || [];
}

  window.EventLog = {
    logWarehouseEvent,
    logWarehouseEvents
  };
})();
