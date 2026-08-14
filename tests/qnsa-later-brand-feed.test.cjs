'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814100000_qnsa_later_brand_bounded_feed.sql'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const strictMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814110000_qnsa_later_brand_reference_gate.sql'), 'utf8');
const strictBoundMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814111500_qnsa_later_brand_reference_gate_bound.sql'), 'utf8');
const strictKeyMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814112000_qnsa_later_brand_reference_key_gate.sql'), 'utf8');
const strictWindowMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814112500_qnsa_later_brand_reference_window.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root,
  '.github/workflows/qnsa-later-brand-feed-hotfix.yml'), 'utf8');

test('later reviewed brands use a bounded existing-index feed without copying data', () => {
  assert.match(migration, /qnsa_later_brand_page_rows/);
  assert.match(migration, /p_brand NOT IN \('Richard Mille', 'Cartier'\)/);
  assert.match(migration, /ORDER BY l\.reference_normalized ASC NULLS LAST, l\.id ASC/);
  assert.match(migration, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\) \* 10, 1010\)/);
  assert.doesNotMatch(migration, /CREATE INDEX|INSERT INTO staging\.listings|UPDATE staging\.listings|DELETE FROM staging\.listings/);
  assert.match(inventory, /laterReviewedBrand \? 'qnsa_later_brand_candidate_stride_page'/);
  assert.match(inventory, /qnsa_later_brand_page_rows_strict/,
    'the previous strict RPC remains the publication-safe deploy-order fallback');
  assert.match(inventory, /isPlausibleLaterBrandReference/);
  assert.match(inventory, /qnsa_later_brand_page_rows/);
  assert.match(inventory, /laterReviewedBrand && qnsaBroadPage/);
  assert.match(inventory, /!hasObviousCrossBrandConflict\(row\)/);
  assert.match(inventory, /laterReviewedBrand && qnsaBroadPage && records\.length === 0/);
  assert.match(inventory, /let usedLegacyViewContract[^]*const laterReviewedBrand/);
  assert.match(inventory, /p_brand: brand \|\| null, p_limit: 51/);
  assert.match(inventory, /brand === 'Cartier' \? requestedOffset \+ 2650 : requestedOffset/);
  assert.match(inventory, /brand === 'Cartier'\) return \/\^W/);
});

test('hotfix workflow is pinned, bounded, and adds no storage-heavy index', () => {
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /APPLY_QNSA_LATER_BRAND_FEED/);
  assert.match(workflow, /statement_timeout='20s'/);
  assert.match(workflow, /read_only = \$false/);
  assert.match(workflow, /20260814114500_qnsa_later_brand_candidate_cursor\.sql/);
  assert.match(workflow, /20260814115000_qnsa_later_brand_bounded_candidate_stride\.sql/);
  assert.match(workflow, /20260814123000_qnsa_rm_low_latency_stride\.sql/);
  assert.match(workflow,
    /qnsa_later_brand_candidate_stride_page\('\$safeBrand',\$offset,50,NULL\)/);
  assert.match(workflow, /Invoke-CandidatePage \$brand 0/);
  assert.match(workflow,
    /Invoke-CandidatePage \$brand \(\[long\]\$firstPage\.next_offset\)/);
  assert.doesNotMatch(workflow, /candidate_page\(brand,0,50,500,NULL\)/);
  assert.match(workflow, /cross_page_duplicate_ids/);
  assert.match(workflow, /Richard Mille exceeded the 12-candidate latency stride/);
  assert.match(workflow, /first_latency_ms -gt 18000/);
  assert.match(workflow, /second_latency_ms -gt 8000/);
  assert.match(workflow, /Candidate page exceeds the hosted cold\/warm latency budget/);
  assert.doesNotMatch(workflow, /'Cartier',21,2650/,
    'Cartier starts at logical candidate offset zero inside its indexed W namespace');
  assert.match(workflow, /CREATE\\s\+INDEX/);
});

test('strict later-brand wrapper rejects parser-artifact references', () => {
  assert.match(strictMigration, /\^RM\[0-9\]\{2,3\}\(-\[0-9\]\{1,3\}\)\?\$/);
  assert.match(strictMigration, /\^W\[A-Z0-9\]\{5,15\}\$/);
  assert.match(strictMigration, /qnsa_later_brand_page_rows\(/);
  assert.doesNotMatch(strictMigration, /CREATE INDEX|INSERT INTO staging\.listings|UPDATE staging\.listings/);
  assert.match(workflow, /invalid_rows/);
  assert.match(workflow, /\$evidence = @\(\)/);
  assert.match(workflow, /return @\{ page = \$result\[-1\]\.page; latency_ms = \$started\.ElapsedMilliseconds \}/);
});

test('strict later-brand wrapper stays inside the proven 51-row latency bound', () => {
  assert.match(strictBoundMigration, /LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\), 51\)/);
  assert.doesNotMatch(strictBoundMigration, /CREATE INDEX|INSERT INTO staging\.listings|UPDATE staging\.listings/);
  assert.match(workflow, /20260814111500_qnsa_later_brand_reference_gate_bound\.sql/);
});

test('strict later-brand gate normalizes punctuation without changing source references', () => {
  assert.match(strictKeyMigration, /regexp_replace\(/);
  assert.match(strictKeyMigration, /\^RM\[0-9\]\{3,6\}\[A-Z\]\{0,3\}\$/);
  assert.match(strictKeyMigration, /\^W\[A-Z0-9\]\{5,18\}\$/);
  assert.match(workflow, /20260814112000_qnsa_later_brand_reference_key_gate\.sql/);
});

test('strict later-brand gate reads one bounded page before filtering legacy artifacts', () => {
  assert.match(strictWindowMigration, /p_brand,\s*51,/);
  assert.match(strictWindowMigration, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\), 51\)/);
  assert.match(workflow, /20260814112500_qnsa_later_brand_reference_window\.sql/);
});

test('later-brand feed preserves immutable lineage and publication safety gates', () => {
  assert.match(migration, /JOIN public\.raw_message_versions AS rv/);
  assert.match(migration, /rv\.source_hash = l\.source_hash/);
  assert.match(migration, /bundle_status', 'SINGLE_CANDIDATE/);
  assert.match(migration, /suppressed_exact_duplicate/);
  assert.match(migration, /upper\(COALESCE\(l\.category, ''\)\) = 'WATCH'/);
  assert.match(inventory, /'QNSA_REVIEWED_LATER_BRAND_V1'/);
});
