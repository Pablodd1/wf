const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "supabase-migration-ledger-check.yml",
);
const workflow = fs.readFileSync(workflowPath, "utf8");

test("migration ledger check is manual and explicitly confirmed", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /INSPECT_PRODUCTION_MIGRATION_LEDGER/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
});

test("migration ledger check never applies migrations", () => {
  assert.match(workflow, /supabase migration list/);
  assert.doesNotMatch(workflow, /supabase db push/);
  assert.doesNotMatch(workflow, /--include-all/);
  assert.match(workflow, /no migration was applied/i);
});
