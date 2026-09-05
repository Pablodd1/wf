'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsvLine } = require('../tools/duplicate-audit/stage-review-candidates.cjs');
const { intentRelation, rawRelation, sellerRelation } = require('../tools/duplicate-audit/audit-review-batch.cjs');
const {
  canonicalDateEvidence,
  chooseCanonical,
  validImmutableListingDate,
} = require('../tools/duplicate-audit/audit-brand.cjs');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260721170000_duplicate_review_workflow.sql'),
  'utf8'
);
const publicationMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260726140000_exclude_reviewed_duplicates_from_publication.sql'),
  'utf8'
);
const restoreMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260726170000_audited_duplicate_suppression_restore.sql'),
  'utf8'
);
const decisionRoute = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'duplicate-review-decision.js'),
  'utf8'
);
const queueRoute = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'duplicate-review-queue.js'),
  'utf8'
);
const auditSource = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'duplicate-audit', 'audit-brand.cjs'),
  'utf8'
);
const marketMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260725010000_harden_staging_and_market_contract.sql'),
  'utf8'
);
const verifiedMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260725033000_harden_verified_publication_gates.sql'),
  'utf8'
);

test('duplicate candidate CSV parser preserves quoted raw values', () => {
  assert.deepEqual(parseCsvLine('EXACT_RAW,0.99,"Rolex, 116500LN",candidate'), [
    'EXACT_RAW', '0.99', 'Rolex, 116500LN', 'candidate',
  ]);
});

test('duplicate workflow is reversible and never deletes source records', () => {
  assert.match(migration, /status IN \('PENDING', 'SUPPRESSED', 'KEEP_BOTH', 'DEFERRED'\)/);
  assert.match(migration, /raw_evidence_preserved/);
  assert.match(migration, /watch_records_deleted.*false/);
  assert.doesNotMatch(migration, /DELETE FROM public\.watch_records/);
  assert.match(migration, /suppress_from_analytics = v_decision = 'SUPPRESS'/);
});

test('source-evidence audit keeps missing seller lineage unresolved', () => {
  const left = { raw_message: 'Rolex 116500LN White', listing_type: 'WTS' };
  const right = { raw_message: 'Rolex 116500LN White', listing_type: 'WTS' };
  assert.equal(sellerRelation(left, right), 'UNKNOWN');
  assert.equal(rawRelation(left, right), 'MATCHED');
  assert.equal(intentRelation(left, right), 'MATCHED');
});

test('source-evidence audit detects seller and intent conflicts', () => {
  const left = { seller_phone: '+15550001111', raw_message: 'Patek 5712 WTS', listing_type: 'WTS' };
  const right = { seller_phone: '+15550002222', raw_message: 'Patek 5712 WTB', listing_type: 'WTB' };
  assert.equal(sellerRelation(left, right), 'CONFLICTING');
  assert.equal(rawRelation(left, right), 'DIFFERENT');
  assert.equal(intentRelation(left, right), 'CONFLICTING');
});

test('canonical duplicate selection prefers valid immutable listing dates', () => {
  const withSourceDate = {
    id: 'source-date',
    listing_date: '2024-05-01',
    created_at: '2024-05-02T00:00:00.000Z',
  };
  const importOnly = {
    id: 'import-date',
    listing_date: 'not-a-source-date',
    created_at: '2026-07-25T00:00:00.000Z',
  };

  assert.equal(chooseCanonical(withSourceDate, importOnly).id, 'source-date');
  assert.deepEqual(canonicalDateEvidence(withSourceDate), {
    value: '2024-05-01',
    timestamp: Date.parse('2024-05-01T00:00:00.000Z'),
    source: 'LISTING_DATE',
  });
  assert.equal(canonicalDateEvidence(importOnly).source, 'CREATED_AT_FALLBACK');
  assert.equal(validImmutableListingDate('2026-02-30'), null);
  assert.match(auditSource, /select: 'id,brand,reference,dial_color,condition,price_usd,currency,raw_message,listing_date,created_at/);
  assert.match(auditSource, /canonical_date_source,candidate_date_source,canonical_listing_date,candidate_listing_date,canonical_created_at,candidate_created_at/);
  assert.match(auditSource, /auditFormatVersion = 2/);
});

test('reviewed suppression is indexed, reversible, and consistent across publication paths', () => {
  assert.match(publicationMigration, /WHERE status = 'SUPPRESSED'/);
  assert.match(publicationMigration, /SELECT NOT EXISTS[\s\S]*d\.duplicate_id = p_record_id[\s\S]*d\.status = 'SUPPRESSED'/);
  assert.match(publicationMigration, /CREATE OR REPLACE VIEW public\.trading_floor_listings[\s\S]*public\.is_listing_duplicate_eligible\(id\)/);
  assert.match(publicationMigration, /CREATE OR REPLACE VIEW public\.price_research_verified_source[\s\S]*NOT EXISTS[\s\S]*d\.duplicate_id = w\.id[\s\S]*d\.status = 'SUPPRESSED'/);
  assert.match(publicationMigration, /WITH \(security_invoker = true\)/);
  assert.match(publicationMigration, /NOT public\.is_unsplit_bundle_parent/);
  assert.match(publicationMigration, /GRANT SELECT ON public\.trading_floor_listings TO anon, authenticated/);
  assert.match(publicationMigration, /GRANT SELECT ON public\.price_research_verified_source TO service_role/);
  assert.match(marketMigration, /FROM public\.trading_floor_listings/);
  assert.match(verifiedMigration, /FROM public\.trading_floor_market_listings/);
  assert.doesNotMatch(publicationMigration, /DELETE\s+FROM\s+public\.watch_records/i);
  assert.doesNotMatch(publicationMigration, /UPDATE\s+public\.watch_records/i);

  // Publication follows the current reviewed status, so KEEP_BOTH/DEFERRED or
  // a later reversal restores eligibility without touching source records.
  assert.doesNotMatch(publicationMigration, /suppress_from_analytics\s*=\s*true/i);
});

test('strict publication has no client-side 20,000 suppression ceiling', () => {
  const strictView = publicationMigration.slice(publicationMigration.indexOf('CREATE OR REPLACE VIEW public.price_research_verified_source'));
  assert.match(strictView, /NOT EXISTS/);
  assert.doesNotMatch(strictView, /20_?000|LIMIT\s+20000/i);
});

test('suppression restoration is admin-only, append-only, and preserves prior decision evidence', () => {
  assert.match(restoreMigration, /CREATE TABLE IF NOT EXISTS public\.duplicate_review_decision_events/);
  assert.match(restoreMigration, /BEFORE UPDATE OR DELETE ON public\.duplicate_review_decision_events/);
  assert.match(restoreMigration, /prior_decision_evidence[\s\S]*v_candidate\.evidence/);
  assert.match(restoreMigration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(restoreMigration, /WHERE id = p_candidate_id[\s\S]*FOR UPDATE/);
  assert.match(restoreMigration, /v_candidate\.status <> 'SUPPRESSED'/);
  assert.match(restoreMigration, /INSERT INTO public\.duplicate_review_decision_events[\s\S]*UPDATE public\.duplicate_review_candidates/);
  assert.match(restoreMigration, /GRANT EXECUTE ON FUNCTION public\.restore_duplicate_review_suppression[\s\S]*TO service_role/);
  assert.match(restoreMigration, /REVOKE ALL ON FUNCTION public\.restore_duplicate_review_suppression[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(restoreMigration, /(?:UPDATE|DELETE FROM)\s+public\.watch_records/i);

  assert.match(decisionRoute, /decision === 'RESTORE_KEEP_BOTH' && auth\.role !== 'admin'/);
  assert.match(decisionRoute, /rpc\/restore_duplicate_review_suppression/);
});

test('duplicate review queue requests a planned count only for the queue page', () => {
  assert.match(queueRoute, /countMode[\s\S]*headers\.Prefer = `count=\$\{countMode\}`/);
  assert.match(queueRoute, /duplicate_review_candidates[\s\S]*'planned'/);
  assert.match(queueRoute, /totalCountMode: 'planned'/);
  assert.doesNotMatch(queueRoute, /count=exact/);
});
