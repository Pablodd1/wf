"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260902130000_v2_canary_forward_migration.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("forward migration preserves dependencies and defines both complete keyset RPCs", () => {
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|VIEW|SCHEMA|TYPE|DATABASE)\b/i);
  assert.doesNotMatch(sql, /\bCASCADE\b/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_trading_floor_canary_keyset/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_price_research_canary_keyset_v2/i);
  for (const order of [
    /priced_rank ASC/i,
    /image_rank ASC/i,
    /price_usd DESC NULLS LAST/i,
    /source_created_at DESC/i,
    /listing_id ASC/i
  ]) assert.match(sql, order);
});

test("statistics stay database-side and require exact evidence-qualified WTS cohorts", () => {
  assert.match(sql, /get_price_research_scoped_stats_v2/);
  assert.match(sql, /v\.intent = 'WTS'/);
  assert.match(sql, /v\.price_research_eligible IS TRUE/);
  assert.match(sql, /v\.included_in_statistics IS TRUE/);
  assert.match(sql, /v\.statistics_exclusion_reason IS NULL/);
  assert.match(sql, /DISTINCT ON\s*\(/);
  assert.match(sql, /seller_id/);
  assert.match(sql, /v\.dial_color IS NOT DISTINCT FROM p_dial_color/);
  assert.match(sql, /v\.condition IS NOT DISTINCT FROM p_condition/);
  assert.match(sql, /3\.0 \* \(q\.q3 - q\.q1\)/);
});
