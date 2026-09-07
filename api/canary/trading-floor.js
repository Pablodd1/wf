"use strict";

const { getClient } = require("../_lib/supabase");
const { readSnapshotCount } = require("../_lib/snapshot-count.cjs");
const { redactPublicSource } = require("../_lib/source-redaction.cjs");
const {
  assertKeysetOrder,
  computeCursorScope,
  decodeCursorEnvelope,
  encodeCursorEnvelope,
  mapSnapshotRpcError
} = require("../_lib/canary-keyset.cjs");
const { enforceListingDisplayContract } = require("../_lib/canary-display-contract.cjs");
const { withExistingCardFields } = require("../_lib/canary-card-fields.cjs");

const ALLOWED_QUERY_PARAMS = new Set([
  "pagination",
  "limit",
  "pageSize",
  "cursor",
  "brand",
  "model",
  "intent",
  "type",
  "q",
  "query",
  "search",
  "reference",
  "category",
  "item",
  "country",
  "region",
  "images",
  "images_only",
  "imagesOnly",
  "priced",
  "priced_only",
  "pricedOnly",
  "quality",
  "page"
]);

function parseStrictBoolean(paramName, val) {
  if (val === undefined || val === null) return false;
  const s = String(val).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0" || s === "") return false;
  const err = new Error(`Invalid boolean value for parameter "${paramName}": "${val}". Allowed values are "true", "false", "1", or "0".`);
  err.statusCode = 400;
  throw err;
}

function parseStrictInteger(paramName, val, { min = 1, max = 100, defaultValue = 50 } = {}) {
  if (val === undefined || val === null) return defaultValue;
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) {
    const err = new Error(`Invalid integer value for parameter "${paramName}": "${val}". Must be a numeric integer.`);
    err.statusCode = 400;
    throw err;
  }
  const parsed = parseInt(s, 10);
  if (parsed < min || parsed > max) {
    const err = new Error(`Parameter "${paramName}" value ${parsed} is outside allowed range [${min}, ${max}].`);
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const query = req.query || {};

    // 1. Strict validation: reject unsupported filter parameters with HTTP 400
    for (const param of Object.keys(query)) {
      if (!ALLOWED_QUERY_PARAMS.has(param)) {
        return res.status(400).json({ error: `Unsupported filter parameter: "${param}"` });
      }
    }

    // Validate pagination mode if provided (only cursor pagination supported)
    if (query.pagination !== undefined && query.pagination !== null) {
      const p = String(query.pagination).trim().toLowerCase();
      if (p === "offset") {
        return res.status(400).json({ error: 'Unsupported pagination mode: "offset". Only cursor-based pagination is supported.' });
      }
      if (p !== "cursor" && p !== "") {
        return res.status(400).json({ error: `Invalid pagination parameter: "${query.pagination}". Allowed values are "cursor" or empty.` });
      }
    }

    // Validate quality if provided
    if (query.quality !== undefined && query.quality !== null) {
      const qVal = String(query.quality).trim().toLowerCase();
      if (qVal !== "market" && qVal !== "all" && qVal !== "") {
        return res.status(400).json({ error: `Invalid quality parameter: "${query.quality}". Allowed values are "market" or "all".` });
      }
    }

    // Validate limit / pageSize strictly
    const rawLimit = query.pageSize !== undefined ? query.pageSize : query.limit;
    const limit = parseStrictInteger("pageSize", rawLimit, { min: 1, max: 100, defaultValue: 50 });

    // Validate page strictly if provided for compatibility
    if (query.page !== undefined) {
      parseStrictInteger("page", query.page, { min: 1, defaultValue: 1 });
    }

    // Cursor is decoded AFTER filter normalization (below) so the scope
    // fingerprint is computed from the exact normalized values used by the RPC.
    const cursorStr = query.cursor || null;

    // Validate intent / type if provided
    const rawIntent = query.intent !== undefined && query.intent !== null ? query.intent : query.type;
    let intentFilter = null;
    if (rawIntent !== undefined && rawIntent !== null && String(rawIntent).trim() !== "") {
      const trimmedIntent = String(rawIntent).trim().toUpperCase();
      if (trimmedIntent !== "WTS" && trimmedIntent !== "WTB" && trimmedIntent !== "ALL") {
        return res.status(400).json({ error: `Invalid intent parameter: "${rawIntent}". Allowed values are "WTS", "WTB", or "ALL".` });
      }
      if (trimmedIntent !== "ALL") {
        intentFilter = trimmedIntent;
      }
    }

    const brandFilter = query.brand ? String(query.brand).trim() : null;
    const modelFilter = query.model ? String(query.model).trim() : null;
    const rawSearch = query.q || query.search || query.query || query.reference || null;
    const queryFilter = rawSearch ? String(rawSearch).trim() : null;

    const rawCategory = query.category !== undefined && query.category !== null ? query.category : query.item;
    const categoryFilter = rawCategory && String(rawCategory).trim().toLowerCase() !== "all"
      ? String(rawCategory).trim().toLowerCase()
      : null;

    const countryFilter = query.country ? String(query.country).trim() : null;
    const regionFilter = query.region ? String(query.region).trim() : null;

    const rawImages = query.images !== undefined ? query.images : (query.images_only !== undefined ? query.images_only : query.imagesOnly);
    const imagesOnlyFilter = parseStrictBoolean("images", rawImages);

    const rawPriced = query.priced !== undefined ? query.priced : (query.priced_only !== undefined ? query.priced_only : query.pricedOnly);
    const pricedOnlyFilter = parseStrictBoolean("priced", rawPriced);

    // Decode + validate the snapshot cursor envelope against the normalized
    // filter scope (fail closed with HTTP 400; never restart at page 1).
    const cursorScope = computeCursorScope("trading_floor", {
      brand: brandFilter,
      model: modelFilter,
      intent: intentFilter,
      query: queryFilter,
      category: categoryFilter,
      country: countryFilter,
      region: regionFilter,
      imagesOnly: imagesOnlyFilter,
      pricedOnly: pricedOnlyFilter
    });
    let parsedCursor = null;
    if (cursorStr) {
      try {
        parsedCursor = decodeCursorEnvelope(cursorStr, {
          surface: "trading_floor",
          filters: {
            brand: brandFilter,
            model: modelFilter,
            intent: intentFilter,
            query: queryFilter,
            category: categoryFilter,
            country: countryFilter,
            region: regionFilter,
            imagesOnly: imagesOnlyFilter,
            pricedOnly: pricedOnlyFilter
          }
        });
      } catch (error) {
        return res.status(400).json({ error: `Invalid cursor: ${error.message}` });
      }
    }

    const supabase = getClient();

    // Phase 5: first page (no cursor) opens an immutable keyset snapshot;
    // subsequent pages reuse the snapshot id carried by the cursor envelope.
    let snapshotId = parsedCursor ? parsedCursor.snapshot : null;
    if (!snapshotId) {
      const { data: openedSnapshot, error: snapshotError } = await supabase.rpc("open_trading_floor_keyset_snapshot", {});
      if (snapshotError) throw snapshotError;
      if (typeof openedSnapshot !== "string" || !openedSnapshot) {
        throw new Error("snapshot_open_failed: snapshot registry did not return a snapshot id");
      }
      snapshotId = openedSnapshot;
    }

    // Count the frozen snapshot, not a live view that changes between pages.
    const countParams = {
      p_snapshot_id: snapshotId,
      p_brand: brandFilter,
      p_model: modelFilter,
      p_intent: intentFilter,
      p_query: queryFilter,
      p_category: categoryFilter,
      p_country: countryFilter,
      p_region: regionFilter,
      p_images_only: imagesOnlyFilter,
      p_priced_only: pricedOnlyFilter
    };

    const totalCount = await readSnapshotCount(supabase, "get_trading_floor_snapshot_count", countParams);

    // Keyset RPC with identical filters applied inside PostgreSQL before pagination
    const rpcParams = {
      p_snapshot_id: snapshotId,
      p_limit: limit,
      p_brand: brandFilter,
      p_model: modelFilter,
      p_intent: intentFilter,
      p_query: queryFilter,
      p_category: categoryFilter,
      p_country: countryFilter,
      p_region: regionFilter,
      p_images_only: imagesOnlyFilter,
      p_priced_only: pricedOnlyFilter,
      p_cursor_priced_rank: parsedCursor ? parsedCursor.key.pricedRank : null,
      p_cursor_image_rank: parsedCursor ? parsedCursor.key.imageRank : null,
      p_cursor_price_usd: parsedCursor ? parsedCursor.key.priceUsd : null,
      p_cursor_created_at: parsedCursor ? parsedCursor.key.createdAt : null,
      p_cursor_listing_id: parsedCursor ? parsedCursor.key.listingId : null
    };

    // Phase 5.1 + RC50 F2: v4 returns frozen membership key columns (k_*) + payload jsonb frozen at snapshot-open time.
    const { data, error } = await supabase.rpc("get_trading_floor_canary_keyset_v4", rpcParams);
    if (error) {
      const cursorFault = mapSnapshotRpcError(error);
      if (cursorFault) throw cursorFault;
      throw error;
    }
    // Order assertion compares the FROZEN membership columns (k_*).
    assertKeysetOrder(data || []);

    // Enforce canonical ListingDisplayContract and redact public text.
    // Display records come from the FROZEN snapshot payload; cursor keys never do.
    const records = (data || []).map((row) => {
      // STRICT V2 ONLY: canary endpoint — fail closed on missing/partial/malformed
      // provenance; unproven rows must never be silently downgraded to V1 here.
      const canonical = enforceListingDisplayContract((row && row.payload) || {});

      // Redact public source text
      if (canonical.raw_message_text) {
        canonical.raw_message_text = redactPublicSource(canonical.raw_message_text);
      }
      if (canonical.source_context_text) {
        canonical.source_context_text = redactPublicSource(canonical.source_context_text);
      }
      if (canonical.description) {
        canonical.description = redactPublicSource(canonical.description);
      }

      // Note: price verification fields (price_display_verified, price_evidence_status)
      // are strictly preserved from enforceListingDisplayContract and NOT overwritten.

      return withExistingCardFields(canonical);
    });

    // Phase 5.1: the next cursor is built ONLY from the frozen snapshot membership
    // columns (k_*) of the last raw row — never from display payload fields, which
    // may diverge under concurrent boundary-row updates. Payload stays untouched.
    const nextCursor = records.length === limit
      ? encodeCursorEnvelope({ snapshot: snapshotId, scope: cursorScope, frozenKey: data[data.length - 1] })
      : null;

    return res.status(200).json({
      status: "ok",
      records: records,
      total: totalCount,
      snapshot_total: totalCount,
      snapshot: snapshotId,
      nextCursor: nextCursor,
      hasMore: nextCursor !== null,
      exhausted: nextCursor === null
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    const status = err.statusCode === 503 ? 503 : 500;
    return res.status(status).json({ status: "error", message: status === 503 ? "Service temporarily unavailable" : "Unable to load listings", records: [] });
  }
};
