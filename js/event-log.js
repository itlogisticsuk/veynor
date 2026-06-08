(function () {
  "use strict";

  function ensureClient() {
    if (typeof sb !== "function") {
      throw new Error("Supabase helper sb() is not available.");
    }

    return sb();
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
    const payload = sanitizeRow(row);

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
    const payload = rows.map(sanitizeRow);

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
