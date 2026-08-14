'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { credentialError, credentialedLocation, ownedMediaUrl, validateBatch, validateSubmission } = require('../api/dealer-submissions.js');

const image_urls = ['https://example.supabase.co/storage/v1/object/public/dealer-listing-media/item.jpg'];

test('requires normalized watch identity and a source item photo while allowing no-price WTS posts', () => {
  const invalid = validateSubmission({ intent: 'WTS', category: 'WATCH', raw_message: 'Rolex for sale' });
  assert.match(invalid.error, /brand, model, reference, dial_color/);

  const valid = validateSubmission({
    image_urls,
    intent: 'WTS', category: 'WATCH', raw_message: 'Rolex Daytona 116500LN white USD 30000',
    brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.claimed.price_amount, null);
});

test('allows a WTB watch request without an asking price', () => {
  const valid = validateSubmission({
    image_urls,
    intent: 'WTB', category: 'WATCH', raw_message: 'WTB Patek 5712/1A blue',
    brand: 'Patek Philippe', model: 'Nautilus', reference: '5712/1A', dial_color: 'Blue',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.claimed.price_amount, null);
});

test('preserves the original raw message exactly, including surrounding whitespace and line breaks', () => {
  const raw = '  WTS Rolex Daytona 116500LN\nUSD 30,000  \n';
  const valid = validateSubmission({
    image_urls, intent: 'WTS', category: 'WATCH', raw_message: raw,
    brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.rawMessage, raw);
});

test('requires useful identity fields for handbags, jewelry, and other luxury items', () => {
  const missingBrand = validateSubmission({
    image_urls, intent: 'WTS', category: 'HANDBAG', raw_message: 'WTS Birkin 30', title: 'Birkin 30',
  });
  assert.match(missingBrand.error, /brand or maker/);

  const valid = validateSubmission({
    image_urls, intent: 'WTS', category: 'JEWELRY', raw_message: 'WTS Cartier Love bracelet yellow gold 2022',
    brand: 'Cartier', title: 'Love bracelet', material: 'Yellow gold', size: '17', year: '2022',
    completeness: 'Box and certificate', price_amount: '6900', currency: 'USD',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.claimed.material, 'Yellow gold');
  assert.equal(valid.claimed.completeness, 'Box and certificate');
});

test('rejects malformed claimed years instead of silently repairing them', () => {
  const invalid = validateSubmission({
    image_urls, intent: 'WTS', category: 'ACCESSORY', raw_message: 'WTS Goyard wallet',
    brand: 'Goyard', title: 'Saint Sulpice card wallet', year: '22',
  });
  assert.match(invalid.error, /four-digit year/);
});

test('validates bulk item data without accepting typed poster identity', () => {
  const item = {
    intent: 'WTB', category: 'WATCH', raw_message: 'WTB Patek 5712 blue',
    brand: 'Patek Philippe', model: 'Nautilus', reference: '5712/1A', dial_color: 'Blue', image_urls,
  };
  const batch = validateBatch({ poster_name: 'Spoofed Person', items: [item, { ...item, reference: '5711/1A' }] });
  assert.equal(batch.error, undefined);
  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[1].claimed.poster_name, undefined);
});

test('accepts one intact WTS watch bundle without inventing child identities', () => {
  const bundle = validateBatch({ items: [{
    is_bundle: true, intent: 'WTS', category: 'WATCH',
    raw_message: 'WTS dealer list\nRolex 126610LN 14000 USD\nOmega 310.30 7000 USD', image_urls,
  }] });
  assert.equal(bundle.error, undefined);
  assert.equal(bundle.items[0].isBundle, true);
  assert.equal(bundle.items[0].claimed.reference, null);
});

test('requires a bundle to be submitted alone', () => {
  const bundle = { is_bundle: true, intent: 'WTS', category: 'WATCH', raw_message: 'WTS two watches', image_urls };
  const single = {
    intent: 'WTS', category: 'WATCH', raw_message: 'WTS Rolex 126610LN black', image_urls,
    brand: 'Rolex', model: 'Submariner', reference: '126610LN', dial_color: 'Black',
  };
  assert.match(validateBatch({ items: [bundle, single] }).error, /bundle by itself/);
});

test('server overrides a false single-item claim when raw evidence contains several watches', () => {
  const result = validateSubmission({
    image_urls, intent: 'WTS', category: 'WATCH', is_bundle: false,
    raw_message: 'WTS Rolex 126500LN White USD30k, Patek 5712/1A Blue USD100k',
    brand: 'Rolex', model: 'Daytona', reference: '126500LN', dial_color: 'White',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.isBundle, true);
  assert.ok(result.multiItemReasons.length > 0);
});

test('multi-reference WTB is saved for deferred separation instead of published as one request', () => {
  const result = validateSubmission({
    image_urls, intent: 'WTB', category: 'WATCH', is_bundle: false,
    raw_message: 'Looking for RM001, RM002, RM003',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.isBundle, true);
});

test('credential stamp requires linked name, verified phone, and location', () => {
  const complete = { name: 'Alex Dealer', phone: '+13055550101', location: 'Miami, US', credential_status: 'VERIFIED' };
  assert.equal(credentialError(complete), null);
  assert.match(credentialError({ ...complete, phone: null }), /verified phone/);
  assert.match(credentialError(null), /not linked/);
  assert.equal(credentialedLocation({ city: 'Miami', country_code: 'US' }), 'Miami, US');
});

test('uploaded media must belong to the signed-in credential path', () => {
  const previous = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  assert.equal(ownedMediaUrl('https://example.supabase.co/storage/v1/object/public/dealer-listing-media/user-1/listing/item.jpg', 'user-1')?.endsWith('item.jpg'), true);
  assert.equal(ownedMediaUrl('https://example.supabase.co/storage/v1/object/public/dealer-listing-media/user-2/listing/item.jpg', 'user-1'), null);
  if (previous === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous;
});

test('submission migration is service-role only and review-gated', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260721010000_dealer_listing_submissions.sql'), 'utf8');
  assert.match(migration, /REVOKE ALL ON public\.dealer_listing_submissions FROM anon, authenticated/i);
  assert.match(migration, /DEFAULT 'PENDING_REVIEW'/i);
  assert.doesNotMatch(migration, /GRANT INSERT ON public\.dealer_listing_submissions TO authenticated/i);
});

test('legacy direct-publication migration is superseded by a forward review-pipeline migration', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260806160000_dealer_direct_publication.sql'), 'utf8');
  const correction = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260809120000_dealer_submission_pipeline_review.sql'), 'utf8');
  assert.match(migration, /dealer-listing-media/);
  assert.match(migration, /source_submission_id/);
  assert.match(migration, /publication_status/);
  assert.match(migration, /submission_checksum/);
  assert.doesNotMatch(migration, /jobs\.processing_jobs/);
  assert.match(correction, /enqueue_dealer_submission_batch/);
  assert.match(correction, /jobs\.processing_jobs/);
  assert.match(correction, /'needs_review'::jobs\.processing_status/);
  assert.match(correction, /review_dealer_submission/);
  assert.match(correction, /WHEN s\.category <> 'WATCH' THEN 'ineligible_non_watch'/);
  assert.match(correction, /WHEN s\.intent = 'WTB' THEN 'ineligible_demand'/);
  assert.match(correction, /ELSE 'eligible'/);
  assert.match(correction, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test('direct submissions gain immutable raw-version lineage before reviewed publication', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260811210000_direct_submission_raw_version_lineage.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS raw_message_version_id UUID/i);
  assert.match(migration, /BEFORE INSERT ON public\.dealer_listing_submissions/i);
  assert.match(migration, /INSERT INTO public\.raw_messages/i);
  assert.match(migration, /INSERT INTO public\.raw_message_versions/i);
  assert.match(migration, /NEW\.raw_message/i);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF source_submission_id ON staging\.listings/i);
  assert.match(migration, /NEW\.raw_message_version_id/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.watch_records/i);
});

test('every authenticated posting event receives a stable batch receipt', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-submissions.js'), 'utf8');
  assert.match(route, /const bulkSubmissionId = crypto\.randomUUID\(\)/);
  assert.match(route, /bulk_submission_id: bulkSubmissionId/);
  assert.match(route, /publication: 'QUEUED_FOR_REVIEW'/);
  assert.match(route, /immutable_raw_version_saved: true/);
  assert.match(route, /trading_floor: 'AFTER_APPROVAL'/);
  assert.match(route, /price_research: 'WTS_ONLY_AFTER_IDENTITY_PRICE_CURRENCY_AND_DUPLICATE_GATES'/);
  assert.match(route, /wtb_demand: 'AFTER_APPROVAL'/);
  assert.match(route, /enqueue_dealer_submission_batch/);
  assert.match(route, /source_evidence_confirmed !== true/);
  assert.match(route, /source_evidence_confirmed_at/);
  assert.doesNotMatch(route, /trading_floor_status: validated\.isBundle \? 'bundle_pending_separation' : 'published'/);
});
