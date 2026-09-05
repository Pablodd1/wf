"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "../supabase/migrations/20260810025000_reviewed_workbook_global_exact_image_order.sql",
);
const workflowPath = path.join(
  __dirname,
  "../.github/workflows/supabase-global-image-ordering-gate.yml",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");

test("global image ordering migration is concurrent, index-only, and workbook-scoped", () => {
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /public\.reviewed_workbook_inventory/);
  assert.match(migration, /user_image_url/);
  assert.match(migration, /id DESC/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  assert.doesNotMatch(migration, /staging\.listings/i);
});

test("manual production workflow applies only the bounded index gate", () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /environment: production/);
  assert.match(
    workflow,
    /20260810025000_reviewed_workbook_global_exact_image_order\.sql/,
  );
  assert.match(workflow, /Preflight current production architecture/);
  assert.match(workflow, /NOT ILIKE '%staging\.listings%'/);
  assert.doesNotMatch(workflow, /supabase db push/);
  assert.doesNotMatch(workflow, /--include-all/);
});
