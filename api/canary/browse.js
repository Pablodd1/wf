"use strict";

const { getClient } = require("../_lib/supabase");
const { mapSnapshotRpcError } = require("../_lib/canary-keyset.cjs");
const allowed = new Set(["surface", "snapshot", "brand", "model"]);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const query = req.query || {};
  for (const key of Object.keys(query)) {
    if (!allowed.has(key) || typeof query[key] !== "string") return res.status(400).json({ error: "Unsupported browse parameter" });
  }
  const surface = query.surface || "trading_floor";
  if (!["trading_floor", "price_research"].includes(surface)) return res.status(400).json({ error: "Invalid browse surface" });
  if (query.snapshot && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.snapshot)) {
    return res.status(400).json({ error: "Invalid snapshot" });
  }
  try {
    const db = getClient();
    let snapshot = query.snapshot ? query.snapshot.toLowerCase() : null;
    if (!snapshot) {
      const opened = await db.rpc(surface === "trading_floor" ? "open_trading_floor_keyset_snapshot" : "open_price_research_keyset_snapshot", {});
      if (opened.error) throw opened.error;
      snapshot = opened.data;
      if (typeof snapshot !== "string" || !snapshot) throw new Error("snapshot_open_failed");
    }
    const result = await db.rpc("get_canary_snapshot_browse_v1", {
      p_snapshot_id: snapshot, p_surface: surface,
      p_brand: query.brand ? String(query.brand).trim() : null,
      p_model: query.model ? String(query.model).trim() : null,
    });
    if (result.error) throw result.error;
    if (!result.data || result.data.snapshot_id !== snapshot || result.data.success !== true) throw new Error("invalid_browse_result");
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json(result.data);
  } catch (error) {
    const fault = mapSnapshotRpcError(error);
    return res.status(fault ? 400 : 500).json({ success: false, error: fault ? fault.message : "Unable to load browse options" });
  }
};
