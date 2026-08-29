'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260814010000_qnsa_richard_mille_reviewed_release.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-richard-mille-reviewed-release.yml'), 'utf8');
const research = fs.readFileSync(path.join(root, 'api/price-research.js'), 'utf8');
const trading = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
test('RM release is installed disabled and creates no duplicate listings', () => {
  assert.match(migration, /'Richard Mille', false, false/);
  assert.doesNotMatch(migration, /INSERT INTO staging\.listings|UPDATE staging\.listings|DELETE FROM staging\.listings/);
  assert.doesNotMatch(migration, /CREATE INDEX/);
});
test('RM production workflow audits before explicit enable', () => {
  assert.match(workflow, /AUDIT_QNSA_RM/);
  assert.match(workflow, /ENABLE_QNSA_RM/);
  assert.match(workflow, /candidates/);
  assert.match(workflow, /priced_wts/);
  assert.match(workflow, /bundle_status/);
});
test('RM uses the reviewed QNSA Price Research path', () => {
  assert.match(research, /'richard mille'/);
  assert.match(research, /qnsa_bounded_price_research_rows/);
  assert.match(research, /usesBoundedReviewedSource/);
  assert.match(research, /\['richard mille', 'cartier'\]\.includes\(brand\)/);
});
test('RM pending reviewed singles are admitted to the Trading Floor contract', () => {
  assert.match(trading, /brand === 'RICHARD MILLE'/);
  assert.match(trading, /entry\.brand === 'Richard Mille'/);
});
