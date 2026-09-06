"use strict";

const CURSOR_VERSION = "v2";

function rankListing(item) {
  const pricedRank = Number.isInteger(Number(item.priced_rank))
    ? Number(item.priced_rank)
    : (item.price_research_eligible === true && Number(item.price_usd) > 0 ? 1 : 2);
  const imageRank = Number.isInteger(Number(item.image_rank))
    ? Number(item.image_rank)
    : (
      item.image_status === "SOURCE_IMAGE_PRESENT"
      && typeof item.image_key === "string"
      && item.image_key.trim() !== ""
        ? 1
        : 2
    );

  return { pricedRank, imageRank };
}

function encodeKeysetCursor(item) {
  if (!item) return null;
  const { pricedRank, imageRank } = rankListing(item);
  const priceUsd = item.price_usd === null || item.price_usd === undefined
    ? null
    : Number(item.price_usd);
  const createdAt = item.source_created_at
    ? new Date(item.source_created_at).toISOString()
    : null;
  const listingId = typeof item.listing_id === "string" ? item.listing_id.trim() : "";

  if (![1, 2].includes(pricedRank) || ![1, 2].includes(imageRank)) {
    throw new TypeError("Cannot encode cursor with invalid rank values");
  }
  if (priceUsd !== null && !Number.isFinite(priceUsd)) {
    throw new TypeError("Cannot encode cursor with invalid USD price");
  }
  if (!createdAt || !listingId) {
    throw new TypeError("Cannot encode cursor without timestamp and listing ID");
  }

  return Buffer.from(
    JSON.stringify([CURSOR_VERSION, pricedRank, imageRank, priceUsd, createdAt, listingId]),
    "utf-8"
  ).toString("base64url");
}

function decodeKeysetCursor(cursor) {
  if (!cursor) return null;
  let tuple;
  try {
    tuple = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    throw new TypeError("Malformed cursor");
  }

  if (!Array.isArray(tuple) || tuple.length !== 6 || tuple[0] !== CURSOR_VERSION) {
    throw new TypeError("Unsupported cursor version or tuple shape");
  }

  const [, pricedRank, imageRank, priceUsd, createdAt, listingId] = tuple;
  const timestamp = Date.parse(createdAt);
  if (
    ![1, 2].includes(pricedRank)
    || ![1, 2].includes(imageRank)
    || (priceUsd !== null && !Number.isFinite(priceUsd))
    || !Number.isFinite(timestamp)
    || typeof listingId !== "string"
    || listingId.trim() === ""
  ) {
    throw new TypeError("Invalid cursor tuple values");
  }
  if (pricedRank === 1 && priceUsd === null) {
    throw new TypeError("Priced cursor is missing USD price");
  }
  if (pricedRank === 2 && priceUsd !== null) {
    throw new TypeError("Unpriced cursor unexpectedly contains a USD price");
  }

  return { pricedRank, imageRank, priceUsd, createdAt, listingId };
}

// ---------------------------------------------------------------------------
// Phase 5: snapshot cursor envelope {version:'v2', snapshot, scope, key:[5]}.
// Ordered fail-closed validation; every failure is a client error (HTTP 400)
// with a stable message. A bad cursor NEVER falls back to page 1.
// ---------------------------------------------------------------------------

const crypto = require("crypto");

const CURSOR_ENVELOPE_VERSION = "v2";
const CURSOR_ENVELOPE_FIELDS = ["version", "snapshot", "scope", "key"];
const SNAPSHOT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_REGEX = /^sha256:[0-9a-f]{64}$/;

// F4 (Phase 5.1): frozen key fields are OPAQUE — they round-trip byte-identical
// so Postgres membership binding compares at full microsecond/numeric precision.
// Timestamps keep up to nanosecond fractions and any offset; numbers keep their
// exact JSON representation (number or numeric string).
const OPAQUE_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;
const OPAQUE_NUMERIC_REGEX = /^-?\d+(\.\d+)?$/;

function isOpaqueTimestamp(value) {
  return typeof value === "string" && OPAQUE_TIMESTAMP_REGEX.test(value);
}

function isOpaquePrice(value) {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && OPAQUE_NUMERIC_REGEX.test(value);
}

const CURSOR_MESSAGES = Object.freeze({
  MALFORMED: "Malformed cursor",
  UNSUPPORTED_SHAPE: "Unsupported cursor version or shape. The cursor format was upgraded to the v2 snapshot envelope; restart pagination without a cursor.",
  MISSING_FIELDS: "Malformed cursor: envelope is missing required fields (version, snapshot, scope, key)",
  UNKNOWN_FIELDS: "Malformed cursor: envelope contains unknown fields",
  BAD_SNAPSHOT: "Malformed cursor: invalid snapshot id",
  BAD_SCOPE: "Malformed cursor: invalid scope fingerprint",
  SCOPE_MISMATCH: "Cursor scope mismatch: request filters changed since the cursor was issued. Restart pagination without a cursor.",
  SNAPSHOT_EXPIRED: "Cursor snapshot expired or unknown. Restart pagination without a cursor to open a fresh snapshot.",
  INVALID_KEY: "Invalid cursor tuple values",
});

function cursorError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * Deterministic filter-scope fingerprint. Binds a cursor to the exact normalized
 * filter set it was issued under; any filter change yields a different scope.
 */
function computeCursorScope(surface, filters) {
  const canonical = {};
  for (const name of Object.keys(filters || {}).sort()) {
    const value = filters[name];
    canonical[name] = value === undefined ? null : value;
  }
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ surface, filters: canonical }))
    .digest("hex");
  return `sha256:${digest}`;
}

/**
 * Encodes a snapshot cursor envelope.
 *
 * Phase 5.1 (frozen cursor keys): the key MUST be built from the frozen snapshot
 * membership columns (k_priced_rank, k_image_rank, k_price_usd, k_source_created_at,
 * k_listing_id) returned by the v4 RPCs — never from display payload fields, which
 * may legitimately diverge under concurrent boundary-row updates (live payload =
 * current truth, frozen keys = snapshot ordering). Missing/invalid frozen keys
 * fail closed (TypeError) rather than silently falling back to payload values.
 */
function encodeCursorEnvelope({ snapshot, scope, frozenKey }) {
  if (!frozenKey || typeof frozenKey !== "object") {
    throw new TypeError("Cannot encode cursor envelope without frozen snapshot key columns");
  }
  const pricedRank = Number(frozenKey.k_priced_rank);
  const imageRank = Number(frozenKey.k_image_rank);
  // F4: opaque passthrough — the exact JSON values received from PostgREST,
  // never reparsed or reformatted (no Date round-trip, no Number() coercion).
  const priceUsd = frozenKey.k_price_usd === undefined ? null : frozenKey.k_price_usd;
  const createdAt = frozenKey.k_source_created_at;
  const listingId = frozenKey.k_listing_id;

  if (!SNAPSHOT_ID_REGEX.test(String(snapshot || ""))) {
    throw new TypeError("Cannot encode cursor envelope without a valid snapshot id");
  }
  if (!SCOPE_REGEX.test(String(scope || ""))) {
    throw new TypeError("Cannot encode cursor envelope without a valid scope fingerprint");
  }
  if (![1, 2].includes(pricedRank) || ![1, 2].includes(imageRank)) {
    throw new TypeError("Cannot encode cursor with invalid frozen rank values");
  }
  if (!isOpaquePrice(priceUsd)) {
    throw new TypeError("Cannot encode cursor with invalid frozen USD price");
  }
  // Rank and price are independent cursor fields: priced_rank=2 legitimately
  // occurs WITH a price (e.g. price_research_eligible=false but price_usd>0).
  // Only the rank-1-without-price case is structurally impossible (defensive).
  if (pricedRank === 1 && priceUsd === null) {
    throw new TypeError("Cannot encode priced cursor without frozen USD price");
  }
  if (!isOpaqueTimestamp(createdAt)) {
    throw new TypeError("Cannot encode cursor without a valid frozen timestamp");
  }
  if (typeof listingId !== "string" || listingId.trim() === "") {
    throw new TypeError("Cannot encode cursor without frozen listing ID");
  }

  return Buffer.from(
    JSON.stringify({
      version: CURSOR_ENVELOPE_VERSION,
      snapshot,
      scope,
      key: [pricedRank, imageRank, priceUsd, createdAt, listingId],
    }),
    "utf-8"
  ).toString("base64url");
}

/**
 * Decodes and strictly validates a snapshot cursor envelope.
 * Ordered fail-closed checks; throws cursorError (statusCode 400) on any failure.
 * Returns { snapshot, scope, key: {pricedRank, imageRank, priceUsd, createdAt, listingId} }.
 */
function decodeCursorEnvelope(cursor, { surface, filters } = {}) {
  if (!cursor) return null;

  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf-8"));
  } catch {
    throw cursorError(CURSOR_MESSAGES.MALFORMED);
  }

  // Legacy bare-tuple v2 cursors and any non-object shape: explicit 400 with
  // migration guidance, never a silent page-1 restart.
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw cursorError(CURSOR_MESSAGES.UNSUPPORTED_SHAPE);
  }
  const fields = Object.keys(envelope);
  if (fields.some((name) => !CURSOR_ENVELOPE_FIELDS.includes(name))) {
    throw cursorError(CURSOR_MESSAGES.UNKNOWN_FIELDS);
  }
  if (!CURSOR_ENVELOPE_FIELDS.every((name) => Object.prototype.hasOwnProperty.call(envelope, name))) {
    throw cursorError(CURSOR_MESSAGES.MISSING_FIELDS);
  }
  if (envelope.version !== CURSOR_ENVELOPE_VERSION) {
    throw cursorError(CURSOR_MESSAGES.UNSUPPORTED_SHAPE);
  }
  if (typeof envelope.snapshot !== "string" || !SNAPSHOT_ID_REGEX.test(envelope.snapshot)) {
    throw cursorError(CURSOR_MESSAGES.BAD_SNAPSHOT);
  }
  if (typeof envelope.scope !== "string" || !SCOPE_REGEX.test(envelope.scope)) {
    throw cursorError(CURSOR_MESSAGES.BAD_SCOPE);
  }

  const expectedScope = computeCursorScope(surface, filters);
  if (envelope.scope !== expectedScope) {
    throw cursorError(CURSOR_MESSAGES.SCOPE_MISMATCH);
  }

  const key = envelope.key;
  if (!Array.isArray(key) || key.length !== 5) {
    throw cursorError(CURSOR_MESSAGES.INVALID_KEY);
  }
  const [pricedRank, imageRank, priceUsd, createdAt, listingId] = key;
  // F4: opaque validation only — values are returned byte-identical (no Date
  // parsing, no number coercion) so DB membership binding compares exactly.
  if (
    ![1, 2].includes(pricedRank)
    || ![1, 2].includes(imageRank)
    || !isOpaquePrice(priceUsd)
    || !isOpaqueTimestamp(createdAt)
    || typeof listingId !== "string"
    || listingId.trim() === ""
  ) {
    throw cursorError(CURSOR_MESSAGES.INVALID_KEY);
  }
  if (pricedRank === 1 && priceUsd === null) {
    throw cursorError("Priced cursor is missing USD price");
  }

  return {
    snapshot: envelope.snapshot,
    scope: envelope.scope,
    key: {
      pricedRank,
      imageRank,
      priceUsd,
      createdAt,
      listingId,
    },
  };
}

/**
 * Maps Phase 5/5.1/5.2 snapshot RPC failures to stable HTTP 400 cursor errors.
 * Gated on SQLSTATE 22023 (PostgREST error.code): marker TEXT alone is never
 * sufficient — a non-22023 error mentioning a marker (e.g. a 42501 permission
 * error whose message embeds 'invalid_cursor') falls through to HTTP 500.
 */
function mapSnapshotRpcError(err) {
  if (!err || String(err.code || "") !== "22023") return null;
  const message = String(err.message || "");
  if (message.includes("snapshot_expired")) {
    return cursorError(CURSOR_MESSAGES.SNAPSHOT_EXPIRED);
  }
  if (message.includes("invalid_cursor")) {
    return cursorError(CURSOR_MESSAGES.INVALID_KEY);
  }
  if (message.includes("invalid_limit")) {
    return cursorError("Invalid page limit");
  }
  if (message.includes("invalid_ttl")) {
    return cursorError("Invalid snapshot TTL");
  }
  return null;
}

function compareNullablePriceDesc(left, right) {  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

/**
 * Mirrors the database order exactly. A positive value means `left` appears
 * after `right`, which is the keyset predicate used for the next page.
 */
/**
 * Extracts the five keyset tuple fields from a row. Phase 5.1: v4 RPC rows carry
 * FROZEN membership columns (k_*); when present they take precedence over payload
 * fields, since the snapshot ordering predicate compares the frozen columns.
 */
function keysetTupleFields(item) {
  if (item && item.k_listing_id !== undefined) {
    return {
      pricedRank: Number(item.k_priced_rank),
      imageRank: Number(item.k_image_rank),
      priceUsd: item.k_price_usd == null ? null : Number(item.k_price_usd),
      createdAt: Date.parse(item.k_source_created_at),
      listingId: String(item.k_listing_id || "")
    };
  }
  const ranks = rankListing(item);
  return {
    pricedRank: ranks.pricedRank,
    imageRank: ranks.imageRank,
    priceUsd: item.price_usd == null ? null : Number(item.price_usd),
    createdAt: Date.parse(item.source_created_at),
    listingId: String(item.listing_id || "")
  };
}

function compareKeysetTuple(leftItem, rightItem) {
  const left = keysetTupleFields(leftItem);
  const right = keysetTupleFields(rightItem);

  return (
    left.pricedRank - right.pricedRank
    || left.imageRank - right.imageRank
    || compareNullablePriceDesc(left.priceUsd, right.priceUsd)
    || right.createdAt - left.createdAt
    || left.listingId.localeCompare(right.listingId)
  );
}

function isAfterCursor(item, cursor) {
  if (!cursor) return true;
  return compareKeysetTuple(item, {
    priced_rank: cursor.pricedRank,
    image_rank: cursor.imageRank,
    price_usd: cursor.priceUsd,
    source_created_at: cursor.createdAt,
    listing_id: cursor.listingId
  }) > 0;
}

function assertKeysetOrder(items) {
  for (let index = 1; index < items.length; index += 1) {
    if (compareKeysetTuple(items[index - 1], items[index]) > 0) {
      throw new TypeError(`Database returned records outside the required keyset order at index ${index}`);
    }
  }
}

/**
 * Phase 5.2 demand-lane order assertion: frozen member columns ordered by
 * k_source_created_at DESC, k_listing_id ASC (no OFFSET, distinct from the
 * five-field WTS/TF order). Compared as strings so microsecond precision is
 * preserved exactly.
 */
function assertDemandKeysetOrder(rows) {
  for (let index = 1; index < rows.length; index += 1) {
    const prevCreated = String(rows[index - 1].k_source_created_at || "");
    const nextCreated = String(rows[index].k_source_created_at || "");
    const prevId = String(rows[index - 1].k_listing_id || "");
    const nextId = String(rows[index].k_listing_id || "");
    const outOfOrder = prevCreated < nextCreated
      || (prevCreated === nextCreated && prevId >= nextId);
    if (outOfOrder) {
      throw new TypeError(`Database returned demand rows outside the required keyset order at index ${index}`);
    }
  }
}

module.exports = {
  CURSOR_VERSION,
  CURSOR_ENVELOPE_VERSION,
  CURSOR_MESSAGES,
  assertDemandKeysetOrder,
  assertKeysetOrder,
  compareKeysetTuple,
  computeCursorScope,
  cursorError,
  decodeCursorEnvelope,
  decodeKeysetCursor,
  encodeCursorEnvelope,
  encodeKeysetCursor,
  isAfterCursor,
  mapSnapshotRpcError,
  rankListing
};
