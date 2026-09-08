"use strict";

// PostgreSQL returns this frozen lane; never derive ordering from a redacted or
// adapted card. Dates retain microseconds rather than passing through Date.
function timestampMicros(value) {
  const match = String(value || "").match(/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)$/);
  if (!match) throw new TypeError("Invalid frozen source-order timestamp");
  const zone = match[4] === "Z" ? "Z" : /^[+-]\d\d$/.test(match[4]) ? match[4] + ":00" : match[4];
  const seconds = Date.parse(`${match[1]}T${match[2]}${zone}`);
  if (!Number.isFinite(seconds)) throw new TypeError("Invalid frozen source-order timestamp");
  return BigInt(seconds) * 1000n + BigInt((match[3] || "").padEnd(6, "0"));
}

function compareSourceImageOrder(left, right) {
  const lane = Number(left.k_source_lane) - Number(right.k_source_lane);
  if (lane) return lane;
  const a = timestampMicros(left.k_source_created_at), b = timestampMicros(right.k_source_created_at);
  if (a !== b) return a > b ? -1 : 1;
  return Buffer.compare(Buffer.from(left.k_listing_id, "utf8"), Buffer.from(right.k_listing_id, "utf8"));
}

function assertSourceImageOrder(rows) {
  for (const row of rows) {
    if (![1, 2, 3].includes(row.k_source_lane) || typeof row.k_listing_id !== "string" || !row.k_listing_id) {
      throw new TypeError("Invalid frozen source-order key");
    }
    timestampMicros(row.k_source_created_at);
  }
  for (let index = 1; index < rows.length; index++) {
    if (compareSourceImageOrder(rows[index - 1], rows[index]) >= 0) throw new TypeError("Database returned invalid source-image order");
  }
}

module.exports = { compareSourceImageOrder, assertSourceImageOrder };
