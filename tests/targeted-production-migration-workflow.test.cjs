const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "supabase-targeted-lineage-migration.yml",
);

const workflow = fs.readFileSync(workflowPath, "utf8");

test("targeted lineage workflow is manual and explicitly confirmed", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /APPLY_PRIVATE_LINEAGE_SCHEMA/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
});

test("targeted lineage workflow executes only the three allowlisted private migrations", () => {
  assert.match(workflow, /20260720220000_seller_listing_lineage_staging\.sql/);
  assert.match(workflow, /20260721120000_seller_child_lineage_staging\.sql/);
  assert.match(workflow, /20260724223000_reviewer_contact_access_audit\.sql/);
  assert.doesNotMatch(workflow, /db push/);
  assert.doesNotMatch(workflow, /--include-all/);
  assert.doesNotMatch(workflow, /supabase\/migrations\/\*/);
});

test("targeted lineage workflow fails atomically and verifies private access", () => {
  assert.match(workflow, /BEGIN;/);
  assert.match(workflow, /COMMIT;/);
  assert.match(workflow, /ON_ERROR_STOP=1/);
  assert.match(workflow, /test \"\$result\" = \"3\"/);
  assert.match(workflow, /has_table_privilege\('anon'/);
  assert.match(workflow, /has_table_privilege\('authenticated'/);
  assert.match(workflow, /has_table_privilege\('service_role'/);
  assert.match(workflow, /relrowsecurity IS NOT TRUE/);
  assert.match(workflow, /aws-1-us-west-2\.pooler\.supabase\.com/);
  assert.match(workflow, /postgres\.\$\{SUPABASE_PROJECT_REF\}/);
  assert.match(workflow, /environment: production/);
});
