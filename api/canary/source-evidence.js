"use strict";
const { getClient } = require("../_lib/supabase");
const { redactPublicSource } = require("../_lib/source-redaction.cjs");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const query = req.query || {};
  if (Object.keys(query).some(key => !["listing_id", "source_hash"].includes(key))
    || typeof query.listing_id !== "string" || !query.listing_id.trim() || query.listing_id.length > 250
    || typeof query.source_hash !== "string" || !/^[a-f0-9]{64}$/i.test(query.source_hash)) {
    return res.status(400).json({ success: false, error: "Invalid source evidence request" });
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const id = query.listing_id.trim(), hash = query.source_hash.toLowerCase();
    const { data, error } = await getClient().rpc("get_expanded_listing_source_v3", { p_listing_id: id, p_source_hash: hash });
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: "Source evidence is unavailable for this listing" });
    if (data.listing_id !== id || data.source_hash !== hash) throw new Error("Source evidence identity mismatch");
    return res.status(200).json({ success: true, listing_id: id, source_hash: hash,
      raw_message_text: typeof data.raw_message_text === "string" ? redactPublicSource(data.raw_message_text) : null,
      source_context_text: typeof data.source_context_text === "string" ? redactPublicSource(data.source_context_text) : null,
      source_listing_status: typeof data.source_listing_status === "string" ? data.source_listing_status : null,
      source_deleted: typeof data.source_deleted === "boolean" ? data.source_deleted : null });
  } catch {
    return res.status(500).json({ success: false, error: "Source evidence is temporarily unavailable" });
  }
};
