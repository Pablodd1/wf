'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildZenithMissingPriceCorrection } = require('../tools/mariadb-live/build-zenith-missing-price-correction.cjs');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260814193000_qnsa_zenith_missing_price_correction.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-zenith-missing-price-correction.yml'), 'utf8');
const fx = { contract: 'wf-dated-fx-snapshot-v1',base: 'USD',source: 'ECB',observed_at: '2026-08-14T00:00:00Z',usd_per_unit: { USD: 1,EUR: 1.15,HKD: 0.128 } };
const row = (id, raw) => ({ listing_id: id,source_record_id: `src-${id}`,source_hash: 'a'.repeat(64),listing_type: 'WTS',normalized_reference: '03.A780.400',raw_message: raw });

test('builder recovers exact source prices and withholds genuine no-price rows', () => {
  const result = buildZenithMissingPriceCorrection([
    row('00000000-0000-0000-0000-000000000001','Zenith 03.A780.400 €1950'),
    row('00000000-0000-0000-0000-000000000002','Zenith 03.A780.400 anyone have unworn'),
  ],fx);
  assert.equal(result.corrected_rows,1);
  assert.equal(result.withheld_rows,1);
  assert.equal(result.corrections[0].price_usd,2242.5);
});

test('correction is exact-lineage, append-audited, and never changes raw/cardinality', () => {
  assert.match(migration,/qnsa_zenith_identity_reconciliation_audit/);
  assert.match(migration,/rv\.source_hash=l\.source_hash/);
  assert.match(migration,/previous_price[\s\S]*corrected_price/);
  assert.doesNotMatch(migration,/(?:UPDATE|DELETE|INSERT\s+INTO)\s+(?:public\.)?(?:raw_messages|raw_message_versions)/i);
  assert.doesNotMatch(migration,/(?:INSERT\s+INTO|DELETE\s+FROM)\s+staging\.listings/i);
});

test('workflow is QNSA pinned, bounded, and never uploads raw messages', () => {
  assert.match(workflow,/PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow,/npm ci --ignore-scripts/);
  assert.match(workflow,/LIMIT 250/);
  assert.match(workflow,/read_only=\$true/);
  assert.match(workflow,/Destroy private raw payloads/);
  const artifact = workflow.split('actions\/upload-artifact@v4')[1];
  assert.doesNotMatch(artifact,/zenith-private/);
});
