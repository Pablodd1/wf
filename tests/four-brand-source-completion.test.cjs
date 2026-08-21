'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  canary,
  canonicalRecord,
  priceProposal,
} = require('../tools/mariadb-live/run-four-brand-source-completion.cjs');

const ROOT = path.resolve(__dirname, '..');

test('source completion binds only missing WTS raw prices and preserves owner assumed status', () => {
  const common = {
    listing_type: 'WTS',
    price_usd: null,
    price_raw: null,
  };
  const source = { price: 12500, type: 'sale', is_bundle: 0 };
  const explicit = priceProposal(common, {
    listing_type: 'WTS', raw_message: 'Omega Speedmaster USD 12,500',
  }, source);
  assert.equal(explicit.status, 'SOURCE_EXPLICIT_USD_USDT');
  assert.equal(explicit.value, 12500);
  const assumed = priceProposal(common, {
    listing_type: 'WTS', raw_message: 'Cartier Santos asking $12,500',
  }, source);
  assert.equal(assumed.status, 'OWNER_ASSUMED_USD');
  assert.equal(priceProposal({ ...common, listing_type: 'WTB' }, {
    listing_type: 'WTB', raw_message: 'WTB Cartier $12,500',
  }, source), null);
  assert.equal(priceProposal({ ...common, price_usd: 10000 }, {
    listing_type: 'WTS', raw_message: 'Omega USD 12,500',
  }, source), null);
});

test('canary is deterministic and covers each available brand lane', () => {
  const records = [];
  for (const brand of ['Omega', 'Zenith', 'Cartier', 'Tudor']) {
    records.push(canonicalRecord({ listing_id: `${brand}-image`, canonical_brand: brand,
      proposed_image_url: `https://example.test/${brand}.jpg` }));
    records.push(canonicalRecord({ listing_id: `${brand}-price`, canonical_brand: brand,
      proposed_price_usd: 1000, price_evidence_status: 'OWNER_ASSUMED_USD' }));
  }
  const selected = canary(records);
  assert.equal(selected.length, 8);
  assert.deepEqual(selected, [...selected].sort((a, b) => a.listing_id.localeCompare(b.listing_id)));
});

test('migration is private, lineage-bound, missing-only, and rollback capable', () => {
  const sql = fs.readFileSync(path.join(ROOT,
    'supabase/migrations/20260821150000_qnsa_four_brand_source_completion.sql'), 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql, /REVOKE ALL ON public\.qnsa_four_brand_source_completion_runs[\s\S]*FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /l\.source_record_id IS DISTINCT FROM 'mysql_auctions_'/);
  assert.match(sql, /l\.parent_id IS NOT NULL OR COALESCE\(l\.is_bundle,false\)/);
  assert.match(sql, /NULLIF\(btrim\(COALESCE\(l\.image_url,l\.source_media_url_candidate,''\)\),''\) IS NOT NULL/);
  assert.match(sql, /COALESCE\(l\.price_usd,l\.price_normalized,0\)>0/);
  assert.match(sql, /price_evidence_status.*OWNER_ASSUMED_USD/s);
  assert.match(sql, /qnsa_four_brand_source_completion_snapshots/);
  assert.match(sql, /rollback_qnsa_four_brand_source_completion/);
});

test('workflow separates schema install from audit and activation', () => {
  const workflow = fs.readFileSync(path.join(ROOT,
    '.github/workflows/qnsa-four-brand-source-completion.yml'), 'utf8');
  assert.match(workflow, /if: inputs\.mode == 'schema'/);
  assert.match(workflow, /if: inputs\.mode != 'schema'/);
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /EXPECTED_MIGRATION_SHA256: [0-9a-f]{64}/);
});
