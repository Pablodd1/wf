'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  maskPhone,
  positiveInteger,
  queueItem,
} = require('../api/seller-lineage-review-queue.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260726181000_exact_seller_lineage_review.sql');
const queue = read('api/seller-lineage-review-queue.js');
const decision = read('api/seller-lineage-review-decision.js');

test('seller lineage queue masks phone identity and uses a bounded keyset cursor', () => {
  assert.equal(maskPhone('+1 (305) 555-1212'), '***1212');
  assert.equal(maskPhone('123'), null);
  assert.equal(positiveInteger('25', 50), 25);
  assert.equal(positiveInteger('-1', 50), 50);
  const item = queueItem({
    lineage_id: 7,
    source_record_id: 'record-7',
    record_id: 'record-7',
    source_identity: '+1 (305) 555-1212',
    source_system: 'UNBUNDLED_RAW_MESSAGE',
    match_status: 'MATCH_READY',
    proposed_dealer_id: 'dealer-7',
    proposed_dealer_status: 'VERIFIED',
  });
  assert.equal(item.source_identity, '***1212');
  assert.equal(item.source_identity_masked, '***1212');
  assert.doesNotMatch(JSON.stringify(item), /305|555/);

  assert.match(queue, /Cache-Control', 'private, no-store/);
  assert.match(queue, /new Set\(\['reviewer', 'admin'\]\)/);
  assert.match(queue, /Math\.min\(positiveInteger\(req\.query\?\.limit, 50\), 100\)/);
  assert.match(queue, /lineage_id', `gt\.\$\{cursor\}`/);
  assert.doesNotMatch(queue, /offset:/i);
  assert.match(queue, /source_identity_masked: sourceIdentityMasked/);
  assert.match(queue, /source_identity: sourceIdentityMasked/);
  assert.match(queue, /raw_message/);
  assert.match(queue, /proposed_dealer:/);
  assert.match(queue, /Prefer: 'count=planned'/);
});

test('private queue admits only one exact verified phone/dealer candidate', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.seller_lineage_review_queue/);
  assert.match(migration, /WITH \(security_invoker = true\)/);
  assert.match(migration, /JOIN public\.watch_records w[\s\S]*w\.id = s\.source_record_id/);
  assert.match(migration, /identity_row\.source_system = s\.source_system/);
  assert.match(migration, /upper\(trim\(identity_row\.identity_type\)\) = 'PHONE'/);
  assert.match(migration, /identity_row\.verification_status = 'VERIFIED'/);
  assert.match(migration, /d\.status = 'VERIFIED'/);
  assert.match(migration, /upper\(trim\(s\.identity_type\)\) = 'PHONE'/);
  assert.match(migration, /exact_candidate_count = 1/);
  assert.match(migration, /existing_dealer_id IS NULL OR existing_dealer_id = proposed_dealer_id/);
  assert.match(migration, /s\.title_sha1 = encode\([\s\S]*extensions\.digest\([\s\S]*w\.raw_message[\s\S]*'sha1'/);
  for (const gate of [
    'exact_raw_message_sha1',
    'exact_wall_clock_second',
    'unique_phone_identity',
    'intent_agreement',
  ]) {
    assert.match(migration, new RegExp(`match_evidence->'${gate}' = 'true'::jsonb`));
  }
  assert.match(migration, /REVOKE ALL ON public\.seller_lineage_review_queue[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON public\.seller_lineage_review_queue TO service_role/);
});

test('approval RPC fails closed and changes both linkage rows in one transaction', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(migration, /p_record_id TEXT/);
  assert.match(migration, /v_staging\.source_record_id IS DISTINCT FROM p_record_id/);
  assert.match(migration, /WHERE id = p_lineage_id[\s\S]*FOR UPDATE/);
  assert.match(migration, /WHERE id = p_record_id[\s\S]*FOR UPDATE/);
  assert.match(migration, /v_staging\.match_status <> 'MATCH_READY'/);
  assert.match(migration, /length\(v_reason\) < 12/);
  assert.match(migration, /v_operator_id = ''/);
  assert.match(migration, /v_identity_count <> 1/);
  assert.match(migration, /Stored raw message does not match the staged SHA-1 evidence/);
  assert.match(migration, /Staged source intent does not match the listing intent/);
  assert.match(migration, /Requested dealer does not own the exact verified source identity/);
  assert.match(migration, /Listing already belongs to a different dealer/);
  assert.match(migration, /INSERT INTO public\.seller_lineage_review_events/);
  assert.match(migration, /matched_dealer_id = p_dealer_id,[\s\S]*match_status = 'APPLIED'/);
  assert.match(migration, /UPDATE public\.watch_records[\s\S]*SET dealer_id = p_dealer_id/);
  assert.match(migration, /'idempotent', true/);
  assert.match(migration, /Existing approval state conflicts with the requested dealer/);
});

test('rejection is append-only, idempotent, and never attaches or removes a listing dealer', () => {
  const rejectBranch = migration.slice(
    migration.indexOf("IF v_decision = 'REJECT' THEN"),
    migration.indexOf("IF v_staging.match_evidence->'exact_raw_message_sha1'"),
  );
  assert.match(rejectBranch, /INSERT INTO public\.seller_lineage_review_events/);
  assert.match(rejectBranch, /match_status = 'REJECTED'/);
  assert.match(rejectBranch, /matched_dealer_id = NULL/);
  assert.doesNotMatch(rejectBranch, /UPDATE public\.watch_records/);
  assert.match(migration, /seller_lineage_review_events is append-only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.prevent_seller_lineage_review_event_mutation\(\)/);
});

test('decision API validates the exact listing contract and leaves contact publication gated', () => {
  assert.match(decision, /new Set\(\['reviewer', 'admin'\]\)/);
  assert.match(decision, /sameOrigin\(req\)/);
  assert.match(decision, /req\.body\?\.lineageId/);
  assert.match(decision, /req\.body\?\.recordId/);
  assert.match(decision, /req\.body\?\.dealerId/);
  assert.match(decision, /req\.body\?\.decision/);
  assert.match(decision, /reason\.length < 12/);
  assert.match(decision, /p_record_id: recordId/);
  assert.match(decision, /apply_seller_lineage_review_decision/);
  assert.match(decision, /contactPublished: false/);
  assert.match(decision, /contactAccessRequiresListingContactGate: true/);
  assert.doesNotMatch(migration, /UPDATE public\.dealers[\s\S]*contact_consent/i);

  const listingContact = read('api/listing-contact.js');
  assert.doesNotMatch(listingContact, /if \(!dealer\.contact_consent\)/);
  assert.match(listingContact, /\.eq\('verification_status', 'VERIFIED'\)/);
  assert.match(listingContact, /SELLER_LINEAGE_UNVERIFIED/);
});
