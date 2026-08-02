'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { confirmCatalogCandidate } = require('../api/_lib/catalog-confirmation.cjs');
const { buildPromotionDecision } = require('../tools/shadow-reprocess/promotion-policy.cjs');
const { listCatalogBrands, listEquivalentReferences, lookupCatalog } = require('../api/_lib/catalog.js');

test('confirms an exact catalog reference with matching brand', () => {
  const confirmation = confirmCatalogCandidate({ brand: 'Rolex', reference: '126610LN' });
  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.match.brand, 'Rolex');
  assert.equal(confirmation.match.matchType, 'exact');
});

test('catalog confirmation provides persisted model provenance', () => {
  const confirmation = confirmCatalogCandidate({ brand: 'Patek Philippe', reference: '5712/1A', dial_color: 'Blue' });
  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.match.model, 'Nautilus');
  assert.equal(confirmation.match.reference, '5712/1A-001');
  assert.equal(confirmation.dialConfirmed, true);
});

test('live ingest persists only catalog-backed model identity', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'ingest.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260722143000_catalog_model_provenance.sql'), 'utf8');

  assert.doesNotMatch(source, /if \(llm\.model\) parsed\.model = llm\.model/);
  assert.match(source, /confirmCatalogCandidate/);
  assert.match(source, /catalog_confirmed: catalogConfirmation\.confirmed/);
  assert.match(source, /verdict: catalogReviewRequired \? 'MUST_REVIEW'/);
  assert.match(source, /isMissingCatalogColumn/);
  assert.match(source, /withoutCatalogColumns\(normalizedListing\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS model TEXT/);
  assert.match(migration, /catalog_confirmed BOOLEAN NOT NULL DEFAULT false/);
});

test('returns a review decision when catalog brand conflicts with candidate', () => {
  const candidate = {
    brand: 'Patek Philippe',
    reference: '126610LN',
    prices: [{ is_primary: true, amount_original: 114000, currency_original: 'HKD', currency_evidence: 'section_context' }],
  };
  const confirmation = confirmCatalogCandidate(candidate);
  const decision = buildPromotionDecision({
    source_listing_type: 'WTS', candidate_count: 1, proposed_candidates: [candidate], change_flags: [],
  }, confirmation);
  assert.equal(confirmation.confirmed, false);
  assert.equal(decision.disposition, 'HUMAN_REVIEW');
  assert.deepEqual(decision.reasons, ['CATALOG_BRAND_CONFLICT']);
});

test('returns reviewer approval readiness only after exact catalog confirmation', () => {
  const candidate = {
    brand: 'Cartier', reference: 'WSSA0039', prices: [],
  };
  const confirmation = confirmCatalogCandidate(candidate);
  const decision = buildPromotionDecision({
    source_listing_type: 'WTB', candidate_count: 1, proposed_candidates: [candidate], change_flags: [],
  }, confirmation);
  assert.equal(decision.disposition, 'READY_FOR_HUMAN_APPROVAL');
  assert.equal(decision.catalog.reference, 'WSSA0039');
});

test('uses the local catalog source when an overlapping reference has an explicit brand', () => {
  const rolex = lookupCatalog('52508', 'Rolex');
  const piaget = lookupCatalog('52508', 'Piaget');
  assert.equal(rolex.found, true);
  assert.equal(rolex.brand, 'Rolex');
  assert.equal(piaget.found, true);
  assert.equal(piaget.brand, 'Piaget');
});

test('does not silently resolve an unbranded cross-brand reference', () => {
  const ambiguous = lookupCatalog('52508');
  assert.equal(ambiguous.found, false);
  assert.equal(ambiguous.matchType, 'ambiguous_reference');
  assert.ok(ambiguous.candidates.some(candidate => candidate.brand === 'Rolex'));
  assert.ok(ambiguous.candidates.some(candidate => candidate.brand === 'Piaget'));
});

test('exposes every modeled brand to Price Research browsing', () => {
  const brands = listCatalogBrands();
  assert.ok(brands.length >= 20);
  for (const expected of ['Rolex', 'Patek Philippe', 'Breitling', 'Blancpain', 'Grand Seiko', 'F.P. Journe']) {
    assert.ok(brands.some(entry => entry.brand === expected), `${expected} should be browsable`);
  }
  assert.ok(brands.every(entry => entry.model_count > 0 && entry.reference_count > 0));
});

test('resolves curated Patek shorthand to the canonical blue-dial configuration', () => {
  const match = lookupCatalog('5712/1A', 'Patek Philippe');
  assert.equal(match.found, true);
  assert.equal(match.brand, 'Patek Philippe');
  assert.equal(match.model, 'Nautilus');
  assert.equal(match.matchType, 'exact_alias');
  assert.equal(match.matchedRef, '5712/1A-001');
  assert.deepEqual(match.dialColors, ['Blue']);
});

test('resolves rose-gold Patek shorthand to the exact canonical reference', () => {
  const match = lookupCatalog('5712/1R', 'Patek Philippe');
  assert.equal(match.found, true);
  assert.equal(match.brand, 'Patek Philippe');
  assert.equal(match.model, 'Nautilus');
  assert.equal(match.matchType, 'exact_alias');
  assert.equal(match.matchedRef, '5712/1R-001');
  assert.deepEqual(match.dialColors, ['Brown']);
});

test('curates imported Patek dial labels from manufacturer evidence', () => {
  assert.deepEqual(lookupCatalog('5712/1R-001', 'Patek Philippe').dialColors, ['Brown']);
  assert.deepEqual(lookupCatalog('5711/1A-010', 'Patek Philippe').dialColors, ['Blue']);
});

test('curates the imported Rolex 116500LN Silver label to White', () => {
  const white = confirmCatalogCandidate({
    brand: 'Rolex',
    reference: '116500LN',
    dial_color: 'White',
  });
  assert.equal(white.confirmed, true);
  assert.equal(white.dialConfirmed, true);
  assert.deepEqual(white.match.dialColors, ['Black', 'White']);

  const mislabeledSilver = confirmCatalogCandidate({
    brand: 'Rolex',
    reference: '116500LN',
    dial_color: 'Silver',
  });
  assert.equal(mislabeledSilver.confirmed, true);
  assert.equal(mislabeledSilver.dialConfirmed, false);
});

test('returns verified shorthand and canonical references as one market family', () => {
  assert.deepEqual(
    new Set(listEquivalentReferences('5712/1A', 'Patek Philippe')),
    new Set(['5712/1A', '5712/1A-001']),
  );
  assert.deepEqual(
    new Set(listEquivalentReferences('5712/1A-001', 'Patek Philippe')),
    new Set(['5712/1A', '5712/1A-001']),
  );
  assert.deepEqual(
    new Set(listEquivalentReferences('5712/1R-001', 'Patek Philippe')),
    new Set(['5712/1R', '5712/1R-001']),
  );
  assert.deepEqual(listEquivalentReferences('116500LN', 'Rolex'), ['116500LN']);
});

test('price research normalizes every resolved reference variant', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  assert.match(source, /normalizeMarketRow\(row,\s*referenceVariants\)/);
  assert.doesNotMatch(source, /normalizeMarketRow\(row,\s*\[rawRef,\s*targetRef\]\)/);
  assert.match(source, /referenceVariants\s*=\s*equivalentReferences/);
  assert.match(source, /referenceVariants\s*=\s*\[\.\.\.new Set\(\[\.\.\.equivalentReferences,\s*\.\.\.exactVariants\]\)\]/);
  assert.match(source, /baseSampleCount\s*>=\s*sampleLimit\s*&&\s*observedDialCounts\.get/);
  assert.match(source, /\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)/);
});

test('price research never silently expands a partial reference', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.match(source, /Prefix matches are suggestions for[\s\S]*must never silently become a specific/);
  assert.match(source, /Enter an exact reference\. Prefix matches require an explicit selection\./);
  assert.doesNotMatch(source, /else if \(foundRefs\.length === 1\)[\s\S]*targetRef = foundRefs\[0\]/);
  assert.match(page, /Partial references are not expanded automatically/);
  assert.deepEqual(listEquivalentReferences('5711', 'Patek Philippe'), ['5711']);
  assert.match(source, /catalogHit\.matchType !== 'partial'/);
});

test('confirms a proposed dial only when it agrees with the exact catalog reference', () => {
  const black = confirmCatalogCandidate({ brand: 'Rolex', reference: '116500LN', dial_color: 'Black' });
  const white = confirmCatalogCandidate({ brand: 'Rolex', reference: '116500LN', dial_color: 'White' });
  const purple = confirmCatalogCandidate({ brand: 'Rolex', reference: '116500LN', dial_color: 'Purple' });

  assert.equal(black.dialConfirmed, true);
  assert.equal(white.dialConfirmed, true);
  assert.equal(purple.confirmed, true);
  assert.equal(purple.dialConfirmed, false);
  assert.equal(purple.dialReason, 'CATALOG_DIAL_CONFLICT');
});

test('blocks a dial correction that conflicts with the exact catalog configuration', () => {
  const candidate = { brand: 'Rolex', reference: '116500LN', dial_color: 'Purple', prices: [] };
  const confirmation = confirmCatalogCandidate(candidate);
  const decision = buildPromotionDecision({
    source_listing_type: 'WTB', candidate_count: 1, proposed_candidates: [candidate], change_flags: ['DIAL_CHANGED'],
  }, confirmation);

  assert.equal(decision.disposition, 'HUMAN_REVIEW');
  assert.deepEqual(decision.reasons, ['CATALOG_DIAL_CONFLICT']);
});
