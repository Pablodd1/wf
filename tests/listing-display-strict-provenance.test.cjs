'use strict';

/**
 * PHASE 2 — STRICT PROVENANCE test suite for the canonical V2
 * ListingDisplayContract (shared/listing-display-contract.cjs).
 *
 * Covers:
 * - fail-closed strict V2 provenance gate (missing/partial/malformed/placeholder)
 * - parent/child lineage coherence in both directions
 * - stable machine-readable error codes
 * - explicit legacy V1 adapter semantics (never v2.0, never fabricates provenance,
 *   always price_research_eligible=false)
 * - 52-key shape preservation and truthful nulls on the valid path
 * - error messages free of secret/contact/raw-payload substrings
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LISTING_DISPLAY_CONTRACT_VERSION,
  LEGACY_LISTING_DISPLAY_CONTRACT_VERSION,
  PROVENANCE_ERROR_CODES,
  CANONICAL_CONTRACT_KEYS,
  enforceListingDisplayContract,
  adaptLegacyListingDisplayV1,
} = require('../shared/listing-display-contract.cjs');

const VALID_HASH = 'a1b2c3d4'.repeat(8); // 64 lowercase hex chars
const PARENT_HASH = 'f9e8d7c6'.repeat(8);
const ZERO_HASH = '0'.repeat(64);
const EMPTY_STRING_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function validV2(overrides = {}) {
  return {
    listing_id: 'lst_001',
    source_id: 'src_001',
    source_hash: VALID_HASH,
    intent: 'WTS',
    brand: 'Rolex',
    reference: '116500LN',
    ...overrides,
  };
}

function assertProvenanceThrow(input, code) {
  let caught = null;
  try {
    enforceListingDisplayContract(input);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `expected throw with code ${code}`);
  assert.equal(caught.code, code, `expected code ${code}, got: ${caught.message}`);
  assert.match(caught.message, /Provenance assertion failed/);
  return caught;
}

test('strict V2: all provenance fields missing fails closed', () => {
  assertProvenanceThrow({}, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
  assertProvenanceThrow({ listing_id: 'x' }, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
  assertProvenanceThrow({ brand: 'Rolex', intent: 'WTS' }, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
});

test('strict V2: each individual provenance field missing fails closed', () => {
  assertProvenanceThrow({ source_hash: VALID_HASH }, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
  assertProvenanceThrow({ source_id: 'src_1' }, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
  assertProvenanceThrow({ source_id: 'src_1', source_hash: null }, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
  assertProvenanceThrow({ source_id: '  ', source_hash: VALID_HASH }, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
  assertProvenanceThrow({ source_id: 'src_1', source_hash: '   ' }, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);
});

test('strict V2: multiple partial provenance combinations fail closed', () => {
  assertProvenanceThrow(
    { listing_id: 'l1', source_id: 'src_1' },
    PROVENANCE_ERROR_CODES.PROVENANCE_MISSING,
  );
  assertProvenanceThrow(
    { listing_id: 'l1', source_hash: VALID_HASH },
    PROVENANCE_ERROR_CODES.PROVENANCE_MISSING,
  );
  assertProvenanceThrow(
    { listing_id: 'l1', source_id: null, source_hash: null },
    PROVENANCE_ERROR_CODES.PROVENANCE_MISSING,
  );
});

test('strict V2: declared source identity aliases are accepted when consistent', () => {
  const viaAlias = enforceListingDisplayContract({
    source_listing_id: 'src_alias',
    source_hash: VALID_HASH,
    intent: 'WTS',
  });
  assert.equal(viaAlias.source_id, 'src_alias');
  assert.equal(viaAlias.contract_version, 'v2.0');

  const consistent = enforceListingDisplayContract({
    source_id: 'src_same',
    source_record_id: 'src_same',
    source_hash: VALID_HASH,
    intent: 'WTS',
  });
  assert.equal(consistent.source_id, 'src_same');
});

test('strict V2: conflicting source identities are rejected', () => {
  assertProvenanceThrow(
    { source_id: 'src_a', source_listing_id: 'src_b', source_hash: VALID_HASH },
    PROVENANCE_ERROR_CODES.PROVENANCE_IDENTITY_CONFLICT,
  );
  assertProvenanceThrow(
    { source_id: 'src_a', source_record_id: 'src_b', source_hash: VALID_HASH },
    PROVENANCE_ERROR_CODES.PROVENANCE_IDENTITY_CONFLICT,
  );
  assertProvenanceThrow(
    validV2({ proposal_source_id: 'different_src' }),
    PROVENANCE_ERROR_CODES.PROVENANCE_IDENTITY_CONFLICT,
  );
});

test('strict V2: malformed source_hash variants fail closed', () => {
  assertProvenanceThrow(validV2({ source_hash: 'abcd1234' }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ source_hash: 'g'.repeat(64) }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ source_hash: VALID_HASH.toUpperCase() }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ source_hash: VALID_HASH.slice(0, 63) }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ source_hash: VALID_HASH + '0' }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ source_hash: 'hash_placeholder_12345' }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
});

test('strict V2: zero-filled and known placeholder hashes are rejected', () => {
  assertProvenanceThrow(validV2({ source_hash: ZERO_HASH }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ source_hash: EMPTY_STRING_SHA256 }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
});

test('strict V2: malformed proposal hashes are rejected when supplied', () => {
  assertProvenanceThrow(validV2({ proposal_hash: 'not-a-hash' }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ proposal_hash: ZERO_HASH }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ child_proposal_hash: 'xyz' }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);
  assertProvenanceThrow(validV2({ proposal_source_hash: 'zzz' }), PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED);

  // Valid proposal hashes pass
  const ok = enforceListingDisplayContract(validV2({
    proposal_source_id: 'src_001',
    proposal_hash: PARENT_HASH,
    child_proposal_hash: 'b'.repeat(64),
  }));
  assert.equal(ok.contract_version, 'v2.0');
});

test('strict V2: valid standalone parent and valid child lineage pass', () => {
  const standalone = enforceListingDisplayContract(validV2({ is_bundle: true, bundle_child_count: 2 }));
  assert.equal(standalone.is_bundle, true);
  assert.equal(standalone.parent_listing_id, null);
  assert.equal(standalone.child_index, null);

  const child = enforceListingDisplayContract(validV2({
    listing_id: 'child_1',
    parent_listing_id: 'parent_1',
    child_index: 0,
    parent_source_id: 'src_parent',
    parent_source_hash: PARENT_HASH,
  }));
  assert.equal(child.parent_listing_id, 'parent_1');
  assert.equal(child.child_index, 0);
  assert.equal(child.contract_version, 'v2.0');
});

test('strict V2: parent_listing_id without child lineage fails closed', () => {
  assertProvenanceThrow(
    validV2({ parent_listing_id: 'parent_1' }),
    PROVENANCE_ERROR_CODES.LINEAGE_PARENT_WITHOUT_CHILD,
  );
  assertProvenanceThrow(
    validV2({ parent_listing_id: 'parent_1', child_index: null }),
    PROVENANCE_ERROR_CODES.LINEAGE_PARENT_WITHOUT_CHILD,
  );
});

test('strict V2: child lineage without parent fails closed', () => {
  assertProvenanceThrow(
    validV2({ child_index: 0 }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_WITHOUT_PARENT,
  );
  assertProvenanceThrow(
    validV2({ child_ordinal: 1 }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_WITHOUT_PARENT,
  );
  assertProvenanceThrow(
    validV2({ parent_source_id: 'src_parent' }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_WITHOUT_PARENT,
  );
  assertProvenanceThrow(
    validV2({ parent_source_hash: PARENT_HASH }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_WITHOUT_PARENT,
  );
  assertProvenanceThrow(
    validV2({ child_index: 2, parent_listing_id: '   ' }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_WITHOUT_PARENT,
  );
});

test('strict V2: malformed child index and malformed parent hash fail closed', () => {
  assertProvenanceThrow(
    validV2({ parent_listing_id: 'p1', child_index: -1 }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_INDEX_MALFORMED,
  );
  assertProvenanceThrow(
    validV2({ parent_listing_id: 'p1', child_index: 1.5 }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_INDEX_MALFORMED,
  );
  assertProvenanceThrow(
    validV2({ parent_listing_id: 'p1', child_index: 'abc' }),
    PROVENANCE_ERROR_CODES.LINEAGE_CHILD_INDEX_MALFORMED,
  );
  assertProvenanceThrow(
    validV2({ parent_listing_id: 'p1', child_index: 0, parent_source_hash: 'short' }),
    PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
  );
});

test('legacy adapter: stays V1, never stamps v2.0, never fabricates provenance', () => {
  const legacy = adaptLegacyListingDisplayV1({
    id: 'legacy_1',
    brand: 'Omega',
    intent: 'WTS',
    price_usd: 5000,
    original_price_currency: 'USD',
    price_research_eligible: true, // staged claim must be overridden
    included_in_statistics: true,
  });
  assert.equal(legacy.contract_version, LEGACY_LISTING_DISPLAY_CONTRACT_VERSION);
  assert.equal(legacy.contract_version, 'watchfacts-listing-display-v1');
  assert.notEqual(legacy.contract_version, LISTING_DISPLAY_CONTRACT_VERSION);
  assert.equal(legacy.listing_display_contract_version, 'watchfacts-listing-display-v1');
  assert.equal(legacy.source_id, null); // never fabricated
  assert.equal(legacy.source_hash, null); // never fabricated
  assert.equal(legacy.price_research_eligible, false);
  assert.equal(legacy.included_in_statistics, false);
  assert.equal(legacy.statistics_exclusion_reason, 'UNPROVENANCED_LEGACY_RECORD');

  // Even a record carrying valid provenance stays V1 through the legacy adapter
  const proven = adaptLegacyListingDisplayV1(validV2());
  assert.equal(proven.contract_version, 'watchfacts-listing-display-v1');
  assert.equal(proven.source_id, 'src_001'); // truthful passthrough, not fabricated
  assert.equal(proven.price_research_eligible, false);
});

test('legacy record attempted through strict V2 fails closed', () => {
  assertProvenanceThrow(
    { id: 'legacy_1', brand: 'Omega', price_usd: 5000 },
    PROVENANCE_ERROR_CODES.PROVENANCE_MISSING,
  );
});

test('valid V2 record preserves every field and all 52 canonical keys', () => {
  const input = validV2({
    raw_message_id: 'msg_1',
    raw_message_text: 'FS: Rolex Daytona 116500LN USD 32000',
    source_created_at: '2026-08-30T00:00:00Z',
    observed_at: '2026-08-30T01:00:00Z',
    category: 'wristwatches',
    model: 'Daytona',
    dial_color: 'Black',
    year: 2023,
    condition: 'Unworn',
    title: 'Daytona',
    description: 'Mint',
    original_price_text: 'USD 32,000',
    original_price_amount: 32000,
    original_price_currency: 'USD',
    price_usd: 32000,
    seller_display_name: 'Dealer1',
    location_country: 'US',
    review_status: 'REVIEW_NOT_REQUIRED',
  });
  const rec = enforceListingDisplayContract(input);

  for (const key of CANONICAL_CONTRACT_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(rec, key), `missing canonical key ${key}`);
  }
  assert.equal(CANONICAL_CONTRACT_KEYS.length, 52);
  assert.equal(rec.contract_version, 'v2.0');
  assert.equal(rec.listing_display_contract_version, 'v2.0');
  assert.equal(rec.source_id, 'src_001');
  assert.equal(rec.source_hash, VALID_HASH);
  assert.equal(rec.brand, 'Rolex');
  assert.equal(rec.model, 'Daytona');
  assert.equal(rec.price_usd, 32000);
  assert.equal(rec.intent, 'WTS');
  assert.equal(rec.raw_message_text, 'FS: Rolex Daytona 116500LN USD 32000');
  // Truthful nulls for absent facts
  assert.equal(rec.parent_listing_id, null);
  assert.equal(rec.child_index, null);
  assert.equal(rec.fx_rate, null);
  assert.equal(rec.seller_profile_url, null);
});

test('error responses contain no secret/contact/raw-payload substrings', () => {
  const secretHash = VALID_HASH;
  const cases = [
    { source_hash: secretHash }, // missing source_id
    validV2({ source_hash: 'hash_placeholder_12345' }),
    validV2({ source_hash: ZERO_HASH }),
    validV2({ source_id: 'src_a', source_listing_id: 'src_b' }),
    validV2({ parent_listing_id: 'p1' }),
    validV2({ child_index: 3 }),
  ];
  const forbidden = [secretHash, 'hash_placeholder_12345', 'sb_secret_', 'postgres', '@', 'eyJ'];
  for (const input of cases) {
    let caught = null;
    try {
      enforceListingDisplayContract(input);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected throw');
    for (const token of forbidden) {
      assert.ok(
        !caught.message.includes(token),
        `error message must not contain "${token}": ${caught.message}`,
      );
    }
    assert.match(caught.message, /^Provenance assertion failed \[[A-Z_]+\]: /);
  }
});

test('strict V2: prototype-chain inherited provenance fields are rejected (own-property guard)', () => {
  // Provenance inherited via prototype must be treated as absent (fail closed).
  const proto = { source_id: 'src_proto', source_hash: VALID_HASH };
  const inheritedOnly = Object.create(proto);
  inheritedOnly.brand = 'Rolex';
  assertProvenanceThrow(inheritedOnly, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);

  // Own source_id but inherited source_hash must still fail closed.
  const inheritedHash = Object.create({ source_hash: VALID_HASH });
  inheritedHash.source_id = 'src_own';
  assertProvenanceThrow(inheritedHash, PROVENANCE_ERROR_CODES.PROVENANCE_MISSING);

  // Inherited parent lineage fields must not satisfy or trigger lineage checks.
  const inheritedLineage = Object.create({ parent_listing_id: 'p1', child_index: 0 });
  inheritedLineage.source_id = 'src_own';
  inheritedLineage.source_hash = VALID_HASH;
  const rec = enforceListingDisplayContract(inheritedLineage);
  assert.equal(rec.parent_listing_id, null);
  assert.equal(rec.child_index, null);
});

test('strict V2: whitespace-padded hashes are rejected without trim normalization', () => {
  assertProvenanceThrow(
    validV2({ source_hash: ` ${VALID_HASH}` }),
    PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
  );
  assertProvenanceThrow(
    validV2({ source_hash: `${VALID_HASH} ` }),
    PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
  );
  assertProvenanceThrow(
    validV2({ source_hash: `\t${VALID_HASH}\n` }),
    PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
  );
});

test('strict V2: non-string hash values are rejected as malformed', () => {
  assertProvenanceThrow(
    validV2({ source_hash: 123 }),
    PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
  );
  assertProvenanceThrow(
    validV2({ source_hash: { toString: () => VALID_HASH } }),
    PROVENANCE_ERROR_CODES.PROVENANCE_HASH_MALFORMED,
  );
  // Exact 64-char lowercase hex string still passes unchanged
  const ok = enforceListingDisplayContract(validV2());
  assert.equal(ok.source_hash, VALID_HASH);
});
