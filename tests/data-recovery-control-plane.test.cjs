'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { classifyIdentity, scopeSource } = require('../tools/data-quality/stage-identity-review.cjs');
const {
  auditImageRows,
  auditImageRowsReconciled,
  exactKeysetScan,
  keysetPaged,
} = require('../tools/data-quality/audit-image-backed-listings.cjs');
const { validateLedger } = require('../tools/data-quality/apply-image-review-canary.cjs');
const { chunks } = require('../tools/data-quality/verify-recovery-readback.cjs');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260725023000_identity_image_publication_control.sql'),
  'utf8',
);
const hardening = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260725033000_harden_verified_publication_gates.sql'),
  'utf8',
);

test('classifies confirmed, conflicting, and unknown identities without human approval', () => {
  assert.equal(classifyIdentity({
    id: 'patek',
    brand: 'Patek Philippe',
    reference: '5712/1A',
    dial_color: 'Blue',
  }).status, 'CATALOG_CONFIRMED');
  assert.equal(classifyIdentity({
    id: 'conflict',
    brand: 'Audemars Piguet',
    reference: 'RM 17-01',
    dial_color: 'Skeleton',
  }).status, 'CONFLICT');
  assert.equal(classifyIdentity({
    id: 'unknown',
    brand: 'Unknown',
    reference: 'NOT-IN-CATALOG',
  }).status, 'UNVERIFIED');
});

test('image audit rejects structural conflicts and leaves clean lineage for visual review', () => {
  const records = [
    { id: 'clean', brand: 'Patek Philippe', reference: '5712/1A', dial_color: 'Blue' },
    { id: 'wrong', brand: 'Audemars Piguet', reference: 'RM 17-01', dial_color: 'Skeleton' },
    { id: 'missing', brand: 'Rolex', reference: '116500LN', dial_color: 'White' },
  ];
  const manifest = [
    { source_object_key: 'a', public_url: 'https://img/a.jpg', matched_record_id: 'clean' },
    { source_object_key: 'b', public_url: 'https://img/b.jpg', matched_record_id: 'wrong' },
  ];
  const result = auditImageRows(records, manifest);
  assert.equal(result[0].image_status, 'VISUAL_REVIEW_REQUIRED');
  assert.match(result[1].issues, /CATALOG_BRAND_CONFLICT/);
  assert.match(result[2].issues, /MANIFEST_MISSING/);
});

test('image audit keyset pagination reconciles more than 1000 rows under changing default order', async () => {
  const source = Array.from({ length: 1505 }, (_, index) => ({
    id: `record-${String(index).padStart(4, '0')}`,
  }));
  let calls = 0;
  const fetchPage = async route => {
    calls += 1;
    const query = new URL(`https://example.test${route}`).searchParams;
    assert.equal(query.get('order'), 'id.asc');
    assert.equal(query.has('offset'), false);
    const cursor = String(query.get('id') || '').replace(/^gt\./, '');
    const changingDefaultOrder = calls % 2 ? [...source].reverse() : [...source.slice(17), ...source.slice(0, 17)];
    return changingDefaultOrder
      .filter(row => !cursor || row.id > cursor)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, Number(query.get('limit')));
  };
  const scan = await exactKeysetScan({
    table: 'watch_records',
    select: 'id',
    key: 'id',
    fetchPage,
  }, async () => source.length);
  assert.equal(scan.reconciliation.reconciled, true);
  assert.equal(scan.rows.length, 1505);
  assert.equal(new Set(scan.rows.map(row => row.id)).size, 1505);
});

test('image audit keyset pagination fails closed on duplicate keys', async () => {
  await assert.rejects(
    keysetPaged({
      table: 'watch_records',
      select: 'id',
      key: 'id',
      fetchPage: async () => [{ id: 'a' }, { id: 'a' }],
    }),
    /missing or duplicate/,
  );
});

test('image audit exact counts fail closed when the source changes during a scan', async () => {
  const counts = [1505, 1506];
  const scan = await exactKeysetScan({
    table: 'watch_records',
    select: 'id',
    key: 'id',
    pageSize: 2000,
    fetchPage: async () => Array.from({ length: 1505 }, (_, index) => ({
      id: `record-${String(index).padStart(4, '0')}`,
    })),
  }, async () => counts.shift());
  assert.equal(scan.reconciliation.reconciled, false);
  assert.equal(scan.reconciliation.exact_count_before, 1505);
  assert.equal(scan.reconciliation.exact_count_after, 1506);
});

test('image audit reconciles every input row to output or a bounded error', () => {
  const broken = { id: 'broken' };
  Object.defineProperty(broken, 'brand', { get: () => { throw new Error('broken identity'); } });
  const result = auditImageRowsReconciled([
    { id: 'clean', brand: 'Patek Philippe', reference: '5712/1A', dial_color: 'Blue' },
    broken,
  ], [
    { source_object_key: 'a', public_url: 'https://img/a.jpg', matched_record_id: 'clean' },
  ]);
  assert.equal(result.reconciliation.reconciled, true);
  assert.equal(result.reconciliation.equation, '2 = 1 + 1');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].record_id, 'broken');
});

test('image canary requires explicit reviewer evidence', () => {
  assert.throws(() => validateLedger([{
    source_object_key: 'a',
    record_id: '1',
    decision: 'VISUALLY_VERIFIED',
    operator_id: 'reviewer',
    reason: 'Compared against raw listing',
    evidence: {},
  }]), /human review evidence/);
  assert.doesNotThrow(() => validateLedger([{
    source_object_key: 'a',
    record_id: '1',
    decision: 'VISUALLY_VERIFIED',
    operator_id: 'reviewer',
    reason: 'Compared against raw listing',
    evidence: { visual_match: 'MATCH' },
    identity_snapshot: {
      brand: 'Patek Philippe',
      model: 'Nautilus',
      reference: '5712/1A',
      dial_color: 'Blue',
    },
  }]));
  assert.throws(() => validateLedger([{
    source_object_key: 'a',
    record_id: '1',
    decision: 'VISUALLY_VERIFIED',
    operator_id: 'reviewer',
    reason: 'Bad evidence',
    evidence: { visual_match: 'false' },
    identity_snapshot: {
      brand: 'Patek Philippe',
      model: 'Nautilus',
      reference: '5712/1A',
      dial_color: 'Blue',
    },
  }]), /human review evidence/);
});

test('database control plane is private, fail closed, and bundle ordered', () => {
  assert.match(migration, /status IN \('UNVERIFIED', 'CATALOG_CONFIRMED', 'CONFLICT', 'HUMAN_APPROVED'\)/);
  assert.match(migration, /status IN \('SOURCE_LINKED', 'VISUALLY_VERIFIED', 'REJECTED'\)/);
  assert.match(migration, /WHERE public\.is_listing_identity_published\(m\.id\)/);
  assert.match(migration, /r\.status = 'VISUALLY_VERIFIED'/);
  assert.match(migration, /Split and review bundle children before duplicate suppression/);
  assert.match(migration, /status = 'HUMAN_APPROVED'[\s\S]*v_preserved := v_preserved \+ 1/);
  assert.match(migration, /REVOKE ALL ON public\.listing_identity_reviews FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /DELETE FROM public\.watch_records/);
});

test('production verified publication is an explicit rollout switch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'ingest.js'), 'utf8');
  assert.match(source, /STRICT_VERIFIED_PUBLICATION === 'true'/);
  assert.match(source, /strictVerifiedPublication[\s\S]*trading_floor_verified_listings/);
});

test('dealer contact and profiles use verified identity and consent boundaries', () => {
  const contact = fs.readFileSync(path.join(__dirname, '..', 'api', 'listing-contact.js'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-profile.js'), 'utf8');
  assert.match(contact, /from\('trading_floor_verified_listings'\)/);
  assert.match(contact, /dealer\.status !== 'VERIFIED'/);
  assert.match(contact, /!dealer\.contact_consent/);
  assert.match(contact, /SELLER_LINEAGE_UNVERIFIED/);
  assert.match(contact, /from\('verified_dealer_profile_stats'\)/);
  assert.match(profile, /from\('listing_identity_reviews'\)/);
  assert.match(profile, /verifiedIds\.has\(listing\.id\)/);
});

test('forward hardening renders canonical identity and preserves reviewed decisions', () => {
  assert.match(hardening, /COALESCE\(NULLIF\(r\.canonical_brand, ''\), w\.brand\) AS brand/);
  assert.match(hardening, /Human approval requires canonical brand, model, reference, and dial_color/);
  assert.match(hardening, /reviewer_id IS NOT NULL OR reviewed_at IS NOT NULL/);
  assert.match(hardening, /visual_match must be MATCH for approval or NO_MATCH for rejection/);
  assert.match(hardening, /Image identity snapshot does not match the current verified listing identity/);
  assert.match(hardening, /match_status = 'APPLIED'/);
  assert.match(hardening, /'BUNDLE_SPLIT_REQUIRED' = ANY/);
});

test('strict publication covers floor, archive, price research, featured, and details', () => {
  const ingest = fs.readFileSync(path.join(__dirname, '..', 'api', 'ingest.js'), 'utf8');
  const price = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  const featured = fs.readFileSync(path.join(__dirname, '..', 'api', 'featured-listings.js'), 'utf8');
  const detail = fs.readFileSync(path.join(__dirname, '..', 'api', 'trading-listing.js'), 'utf8');
  assert.match(ingest, /strictVerifiedPublication[\s\S]*\? 'trading_floor_verified_listings'[\s\S]*quality === 'archive'/);
  assert.match(price, /STRICT_VERIFIED_PUBLICATION === 'true'[\s\S]*price_research_verified_source/);
  assert.match(price, /lookupDemand\(client, sourceTable,/);
  assert.doesNotMatch(price, /\.from\('watch_records'\)/);
  assert.match(featured, /STRICT_VERIFIED_PUBLICATION === 'true'[\s\S]*price_research_verified_source/);
  assert.match(detail, /STRICT_VERIFIED_PUBLICATION === 'true'[\s\S]*trading_floor_verified_listings/);
});

test('forward repair verifies prerequisites without replaying deployed migrations', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'supabase-forward-schema-repair.yml'),
    'utf8',
  );
  assert.match(workflow, /Base recovery migrations must be applied before hardening/);
  assert.match(workflow, /--file="\$hardening"/);
  assert.doesNotMatch(workflow, /--file="\$(migration|recovery)"/);
});

test('recovery readback keeps PostgREST ID filters bounded', () => {
  const groups = chunks(Array.from({ length: 1000 }, (_, index) => `id-${index}`));
  assert.equal(groups.length, 10);
  assert.ok(groups.every(group => group.length <= 100));
});

test('image identity recovery is bounded to listings with image evidence', () => {
  assert.deepEqual(scopeSource('IMAGE_BACKED'), {
    table: 'watch_records',
    idColumn: 'id',
    select: 'id,brand,model,reference,dial_color',
    imageFilter: '(has_images.eq.true,thumbnail_url.not.is.null)',
  });
  assert.equal(scopeSource('ALL').imageFilter, null);
});
