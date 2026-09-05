"use strict";

const { getClient } = require("../_lib/supabase");
const { redactPublicSource } = require("../_lib/source-redaction.cjs");
const {
  assertKeysetOrder,
  decodeKeysetCursor,
  encodeKeysetCursor
} = require("../_lib/canary-keyset.cjs");
const { enforceListingDisplayContract } = require("../../shared/listing-display-contract.cjs");

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

    // Validate cursor
    const cursorStr = query.cursor || null;
    let parsedCursor = null;
    if (cursorStr) {
      try {
        parsedCursor = decodeKeysetCursor(cursorStr);
      } catch (error) {
        return res.status(400).json({ error: `Invalid cursor: ${error.message}` });
      }
    }

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

    const supabase = getClient();

    // Call count RPC with identical filters
    const countParams = {
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

    const { data: totalCountData, error: countErr } = await supabase.rpc("get_trading_floor_canary_count", countParams);
    if (countErr) throw countErr;
    const totalCount = totalCountData !== null && totalCountData !== undefined ? Number(totalCountData) : null;

    // Keyset RPC with identical filters applied inside PostgreSQL before pagination
    const rpcParams = {
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
      p_cursor_priced_rank: parsedCursor ? parsedCursor.pricedRank : null,
      p_cursor_image_rank: parsedCursor ? parsedCursor.imageRank : null,
      p_cursor_price_usd: parsedCursor ? parsedCursor.priceUsd : null,
      p_cursor_created_at: parsedCursor ? parsedCursor.createdAt : null,
      p_cursor_listing_id: parsedCursor ? parsedCursor.listingId : null
    };

    const { data, error } = await supabase.rpc("get_trading_floor_canary_keyset", rpcParams);
    if (error) throw error;
    assertKeysetOrder(data || []);

    // Enforce canonical ListingDisplayContract and redact public text
    const records = (data || []).map((item) => {
      const canonical = enforceListingDisplayContract(item);

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

      return canonical;
    });

    const nextCursor = records.length === limit ? encodeKeysetCursor(records[records.length - 1]) : null;

    return res.status(200).json({
      status: "ok",
      records: records,
      total: totalCount,
      nextCursor: nextCursor,
      hasMore: nextCursor !== null,
      exhausted: nextCursor === null
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ status: "error", message: err.message, records: [] });
  }
};
