const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-global-image-price-ordering.yml'), 'utf8');

test('ordering workflow is pinned to QNSA and one exact migration', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /MIGRATION_FILE: supabase\/migrations\/20260813090000_qnsa_global_image_price_ordering\.sql/);
  assert.match(workflow, /APPLY_QNSA_GLOBAL_IMAGE_PRICE_ORDERING/);
  assert.doesNotMatch(workflow, /supabase db push/);
  assert.doesNotMatch(workflow, /bptrvfncppbjnchsaxtb/);
});

test('ordering workflow compiles, audits, applies, and reconciles three references', () => {
  assert.match(workflow, /BEGIN;`n\$sql`nROLLBACK;/);
  assert.match(workflow, /run_rows -ne 603678/);
  assert.match(workflow, /Apply only the reviewed forward migration/);
  assert.match(workflow, /Rolex 116500LN/);
  assert.match(workflow, /Patek 5712/);
  assert.match(workflow, /AP 26240ST/);
  assert.match(workflow, /ordering_violations/);
  assert.match(workflow, /bundle_or_child_leaks/);
});
