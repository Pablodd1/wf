'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260814093000_qnsa_cartier_reviewed_release.sql'), 'utf8');
const research = fs.readFileSync(path.join(root, 'api/price-research.js'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const floor = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
const dealerEvidence = fs.readFileSync(path.join(root, 'src/components/ListingDealerEvidence.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-cartier-reviewed-release.yml'), 'utf8');

test('Cartier release installs disabled without copying normalized or raw rows', () => {
  assert.match(migration, /'Cartier', false, false/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:staging\.listings|public\.raw_messages|public\.raw_message_versions)/i);
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX/i);
});

test('Cartier workflow is pinned, bounded, and blocks cross-category leakage', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /brand_normalized='Cartier'/);
  assert.match(workflow, /upper\(COALESCE\(l\.category,''\)\)='WATCH'/);
  assert.match(workflow, /Cartier cross-category leakage detected/);
});

test('Cartier is admitted through reviewed Trading and Price Research gates', () => {
  assert.match(research, /'richard mille', 'cartier'/);
  assert.match(inventory, /brand === 'CARTIER'/);
  assert.match(floor, /releaseBrands\.find\(brand => brand\.toLowerCase\(\) === requestedBrand\.toLowerCase\(\)\)/);
  assert.match(floor, /matchedBrand \|\| requestedBrand/);
});

test('Trading cards always disclose rating state without fabricating a score', () => {
  assert.match(floor, /<DealerRatingBadge/);
  assert.match(dealerEvidence, />Not rated<\/span>/);
  assert.match(dealerEvidence, /ratingEvidenceStatus === 'SOURCE_SUPPLIED'/);
  assert.match(dealerEvidence, /ratingEvidenceStatus === 'SOURCE_FEEDBACK_COUNT'/);
});
