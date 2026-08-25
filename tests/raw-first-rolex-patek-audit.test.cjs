'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const {
  classifyRawPost,
  normalizedCountry,
  priceResearchEligible,
} = require('../tools/audit/raw-first-rolex-patek-lib.cjs');
const {
  DEALERS_SQL,
  PHASE7B_SUMMARY_SQL,
  SNAPSHOT_SQL,
  assertReadOnlySql,
  currentListingsSql,
  managementQuery,
  phase7bSql,
  rawSourceSql,
  run,
  technicalDecision,
  tradingFloorMembershipSql,
  uuidShard,
} = require('../tools/audit/raw-first-rolex-patek-audit.cjs');

function row(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    raw_message_id: '20000000-0000-4000-8000-000000000001',
    source_record_id: 'mysql_auctions_source-1',
    source_hash: 'a'.repeat(64),
    source_created_on: '2026-08-20 12:00:00',
    observed_at: '2026-08-20T12:01:00Z',
    raw_message_source: 'description',
    source_platform: 'mariadb',
    sender_phone: null,
    group_id: 'Hong Kong',
    media: [],
    raw_text: 'Rolex 116500LN WTS USD 25,000',
    raw_data: {
      brand: 'Rolex', type: 'sale', status: 'active', is_bundle: false,
      reference: '116500LN', from_number: '+852 9123 4567', region: 'Hong Kong',
    },
    ...overrides,
  };
}

test('Management API throttling is retried without changing the SELECT', async () => {
  const calls = [];
  const responses = [
    { ok: false, status: 429, headers: { get: () => null }, text: async () => 'throttled' },
    { ok: true, status: 200, headers: { get: () => null }, text: async () => '[{"ok":true}]' },
  ];
  const rows = await managementQuery('SELECT 1;', 'retry-test', {
    token: 'test-only', retryLimit: 1, retryBaseMs: 1,
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return responses.shift();
    },
  });
  assert.deepEqual(rows, [{ ok: true }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].read_only, true);
});

test('all production SQL is one SELECT-only statement', () => {
  const bounds = uuidShard(1, 16);
  const sample = [{ id: bounds.low, source_record_id: 'sample-source' }];
  for (const sql of [DEALERS_SQL, PHASE7B_SUMMARY_SQL, SNAPSHOT_SQL, rawSourceSql(bounds),
    currentListingsSql(bounds), tradingFloorMembershipSql(sample), phase7bSql(bounds)]) {
    assert.doesNotThrow(() => assertReadOnlySql(sql));
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL)\b/i);
  }
  assert.throws(() => assertReadOnlySql('UPDATE staging.listings SET verdict=\'x\';'), /not read-only/);
});

test('validation mode needs no credentials and validates every shard query', async () => {
  const result = await run({ validateOnly: true, env: { RAW_FIRST_SHARDS: '16' } });
  assert.equal(result.read_only, true);
  assert.equal(result.shard_count, 16);
  assert.equal(result.validated_queries, 7);
  assert.equal(result.page_size, 2000);
  assert.equal(result.database_concurrency, 1);
});

test('current listings and Trading Floor membership are separate bounded keyset queries', () => {
  const bounds = uuidShard(0, 16);
  const current = currentListingsSql(bounds, '00000000-0000-0000-0000-000000000123', 2000);
  const membership = tradingFloorMembershipSql([
    { id: '00000000-0000-0000-0000-000000000123', source_record_id: 'source-123' },
  ], 2000);
  assert.doesNotMatch(current, /qnsa_rolex_patek_trading_floor_source|\bEXISTS\s*\(/i);
  assert.match(current, /l\.id>'00000000-0000-0000-0000-000000000123'::uuid/);
  assert.match(current, /ORDER BY l\.id LIMIT 2000/);
  assert.match(membership, /qnsa_rolex_patek_reviewed_release_base/);
  assert.match(membership, /SELECT tf\.id::text AS id,tf\.source_record_id/);
  assert.match(membership, /tf\.source_record_id IN \('source-123'\)/);
  assert.match(membership, /tf\.id IN \('00000000-0000-0000-0000-000000000123'::uuid\)/);
  assert.match(membership, /ORDER BY tf\.id LIMIT 2000/);
});

test('technical outcomes never masquerade as raw source gaps', () => {
  assert.equal(technicalDecision(new Error('ERROR: 57014: canceling statement due to statement timeout')),
    'AUDIT_INCOMPLETE_QUERY_TIMEOUT');
  assert.equal(technicalDecision(new Error('network unavailable')), 'AUDIT_INCOMPLETE_TECHNICAL');
});

test('technical failure preserves sanitized checkpoint and summary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-first-v2-'));
  const output = path.join(root, 'out');
  const fetchImpl = async (_url, request) => {
    const sql = JSON.parse(request.body).query;
    if (sql.includes("'project_ref','qnsafosakvonzgfcsphh'")) {
      return new Response(JSON.stringify([{ snapshot: { project_ref: 'qnsafosakvonzgfcsphh' } }]), { status: 200 });
    }
    if (sql.includes('dealer_source_identities')) return new Response('[]', { status: 200 });
    if (sql.includes('reference_census')) return new Response('[]', { status: 200 });
    if (sql.includes('FROM staging.listings')) {
      return new Response(JSON.stringify({ message: 'ERROR: 57014: statement timeout' }), { status: 400 });
    }
    return new Response('[]', { status: 200 });
  };
  try {
    const result = await run({ token: 'test-token', fetchImpl,
      env: { RAW_FIRST_SHARDS: '1', RAW_FIRST_PAGE_SIZE: '2', RAW_FIRST_OUTPUT: output } });
    assert.equal(result.decision, 'AUDIT_INCOMPLETE_QUERY_TIMEOUT');
    assert.equal(result.production_writes, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'checkpoint.json'))).status, 'INCOMPLETE');
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'summary.json'))).decision,
      'AUDIT_INCOMPLETE_QUERY_TIMEOUT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('single source watch survives catalog-independent parsing with exact source evidence', () => {
  const dealerByPhone = new Map([['85291234567', {
    dealer_id: '30000000-0000-4000-8000-000000000001', source_identity: '+852 9123 4567',
  }]]);
  const result = classifyRawPost(row(), { dealerByPhone });
  assert.equal(result.classification, 'SINGLE_WATCH');
  assert.equal(result.children.length, 1);
  assert.equal(result.children[0].observed_reference, '116500LN');
  assert.equal(result.children[0].source_currency, 'USD');
  assert.equal(result.children[0].source_price_amount, 25000);
  assert.equal(result.children[0].dealer_link_status, 'EXACT_VERIFIED_SOURCE_IDENTITY');
  assert.equal(result.children[0].country_code, 'HK');
  assert.equal(priceResearchEligible(result.children[0]), true);
});

test('multi-watch source creates every exact child and never lends parent media', () => {
  const result = classifyRawPost(row({
    raw_text: 'ROLEX WTS USD\n116500LN white USD 25,000\n126710BLRO black USD 18,000',
    media: [{ key: 'parent.jpg' }],
    raw_data: {
      brand: 'Rolex', type: 'sale', status: 'active', is_bundle: true,
      reference: null, front_image: 'parent.jpg', region: 'United States',
    },
  }));
  assert.equal(result.children.length, 2);
  assert.ok(['MULTI_WATCH_SAFE_TO_SPLIT', 'MULTI_WATCH_PARTIALLY_SPLITTABLE'].includes(result.classification));
  for (const child of result.children) {
    assert.equal(child.source_image, null);
    assert.equal(child.source_image_status, 'PARENT_MEDIA_NOT_SAFELY_ASSIGNABLE');
  }
});

test('ambiguous shared price is not copied onto multiple children', () => {
  const result = classifyRawPost(row({
    raw_text: 'Patek Philippe bundle USD 100,000 total\n5712/1A\n5167A',
    raw_data: { brand: 'Patek Philippe', type: 'sale', is_bundle: true, reference: null },
  }));
  assert.equal(result.children.length, 2);
  assert.ok(result.children.every(child => child.source_price_amount === null));
  assert.ok(result.children.every(child => !priceResearchEligible(child)));
});

test('missing optional fields retain the legitimate observation', () => {
  const result = classifyRawPost(row({
    raw_text: 'Patek Philippe Aquanaut available',
    raw_data: { brand: 'Patek Philippe', model: 'Aquanaut', type: 'sale', is_bundle: false },
  }));
  assert.equal(result.classification, 'SINGLE_WATCH');
  assert.equal(result.children.length, 1);
  assert.equal(result.children[0].observed_reference, null);
  assert.equal(result.children[0].source_price_amount, null);
  assert.equal(result.children[0].source_image, null);
});

test('country normalization is evidence-backed and fails closed', () => {
  assert.deepEqual(normalizedCountry('Dubai, UAE'), {
    location_raw: 'Dubai, UAE', country_code: 'AE', country_name: 'United Arab Emirates',
  });
  assert.deepEqual(normalizedCountry('Remote dealer'), {
    location_raw: 'Remote dealer', country_code: null, country_name: null,
  });
});

test('audit source contains no production mutation or Phase 7B rerun path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'audit', 'raw-first-rolex-patek-audit.cjs'), 'utf8');
  assert.match(source, /read_only:\s*true/);
  assert.match(source, /phase7b_rerun:\s*false/);
  assert.match(source, /forEachDatasetRow\(checkpoint, outputDir, 'raw'/);
  assert.match(source, /clearTimeout\(timeout\)/);
  assert.doesNotMatch(source, /pageFiles\([^)]*\)\.flat\(\)/);
  assert.doesNotMatch(source, /ingest_phase7b|begin_phase7b|complete_phase7b|fetch\([^\n]+rest\/v1/i);
});

test('GitHub workflow is manual-only, canonical, read-only, and executes one audit scan', () => {
  const workflow = fs.readFileSync(path.join(
    __dirname, '..', '.github', 'workflows', 'qnsa-disk-capacity-audit.yml',
  ), 'utf8');
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /CANONICAL_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /Audit process terminated before final summary; sanitized checkpoint preserved/);
  assert.equal((workflow.match(/^\s+node tools\/audit\/raw-first-rolex-patek-audit\.cjs\s*$/gm) || []).length, 1);
  assert.doesNotMatch(workflow, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|supabase db push|deploy)\b/i);
  assert.doesNotMatch(workflow, /rolex-manifest|patek-philippe-manifest|remaining-queues/);
});
