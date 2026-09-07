// tests/gate4-gate5-end-to-end-flow.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adaptLegacyListingDisplayV1 } = require('../shared/listing-display-contract.cjs');

test('Historical proposal adaptation preserves source evidence without claiming V2 publication or research eligibility', () => {
  const canaryProposalsPath = path.resolve('audit-output/mariadb-live/normalization-canary-10k/proposals.jsonl');
  assert.equal(fs.existsSync(canaryProposalsPath), true, 'proposals.jsonl must exist');

  const lines = fs.readFileSync(canaryProposalsPath, 'utf-8').trim().split('\n');
  assert.ok(lines.length >= 1000, 'Must have at least 1000 proposals for representative sampling');

  const sampleProposals = lines.slice(0, 100).map(l => JSON.parse(l));

  for (const proposal of sampleProposals) {
    // 1. API contract validation.
    // Phase 2 strict provenance: canary proposals lack V2 source_id/source_hash
    // provenance, so they must be adapted through the explicit legacy V1 path
    // (strict enforceListingDisplayContract now fails closed on these rows).
    const displayRecord = adaptLegacyListingDisplayV1({
      id: proposal.source_id,
      source_id: proposal.source_id,
      brand: proposal.brand,
      model: proposal.model,
      reference: proposal.reference,
      dial_color: proposal.dial_color,
      condition: proposal.condition,
      price_usd: proposal.price_usd,
      price_evidence_status: proposal.currency_status.startsWith('VERIFIED_EXPLICIT_USD') ? 'SOURCE_EXPLICIT_USD_MATCH' : null,
      thumbnail_url: proposal.image_url,
      image_evidence_type: proposal.image_key ? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE',
      seller_name: proposal.seller_name,
      seller_phone: proposal.seller_contact,
      raw_message: proposal.raw_message || proposal.raw_message_evidence || null,
      listing_type: proposal.intent,
      is_unbundled_child: proposal.is_bundle === true
    });

    assert.equal(displayRecord.listing_display_contract_version, 'watchfacts-listing-display-v1');
    assert.equal(displayRecord.source_id, proposal.source_id);
    assert.equal(displayRecord.price_research_eligible, false, 'Legacy evidence never becomes qualified research through adaptation');
    assert.notEqual(displayRecord.contract_version, 'v2.0');

    // 2. Trading Floor Card Parity
    if (proposal.trading_floor_eligible) {
      assert.ok(proposal.brand || proposal.reference, 'Trading Floor card requires brand or reference');
      assert.equal(proposal.is_bundle, false, 'Trading Floor card excludes bundles');
    }

    // 3. Detail View Parity
    assert.equal(displayRecord.raw_message_text, proposal.raw_message || proposal.raw_message_evidence || null);
    if (proposal.image_key && proposal.image_url) {
      assert.equal(displayRecord.image_evidence_type, 'SOURCE_LISTING_IMAGE');
      assert.ok(displayRecord.thumbnail_url.includes(proposal.image_key));
    }

    // 4. Price Research Eligibility Parity
    if (proposal.price_research_eligible) {
      assert.ok(proposal.price_usd > 0, 'Price research requires positive price');
      assert.ok(proposal.brand && proposal.reference, 'Price research requires brand and reference');
      assert.equal(proposal.trading_floor_eligible, true, 'Price research requires trading floor eligibility');
    }
  }
});
