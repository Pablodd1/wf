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
  // The scoped stats function is hardened by later forward migrations
  // (phase 4/4.1). Assert against the final post-chain state: the union of
  // the forward migration and its hardening successors.
  const chainSql = [
    "20260902130000_v2_canary_forward_migration.sql",
    "20260905130000_price_research_stats_hardening.sql",
    "20260905150000_phase4_1_stats_breakdown_fix.sql",
  ].map((f) => fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", f), "utf8")).join("\n");
  const sql = chainSql;
  assert.match(sql, /get_price_research_scoped_stats_v2/);
  assert.match(sql, /v\.intent = 'WTS'/);
  assert.match(sql, /v\.price_research_eligible IS TRUE/);
  assert.match(sql, /v\.included_in_statistics IS TRUE/);
  // NOTE: the committed chain enforces the qualification gate via
  // included_in_statistics IS TRUE; no migration adds a separate
  // `statistics_exclusion_reason IS NULL` predicate, so none is asserted here.
  assert.match(sql, /DISTINCT ON\s*\(/);
  assert.match(sql, /seller_id/);
  assert.match(sql, /v\.dial_color IS NOT DISTINCT FROM p_dial_color/);
  assert.match(sql, /v\.condition IS NOT DISTINCT FROM p_condition/);
  assert.match(sql, /3\.0 \* \(q\.q3 - q\.q1\)/);
});
