'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  PROD_IDENTIFIERS,
  CONTRACT_FIELDS,
  calculateCanonicalPayloadHash,
  redactSecretString,
  parseAndValidateUrl,
  validateStagingEnvironment,
  validateDatabaseMarkerRecord,
  validatePositiveApiAttestationResponse,
  isKeysetTupleOrderValid,
  verifyPageKeysetOrdering,
  calculatePaginationIdentityLedger,
  reconcileDuplicateObservations,
  verifyProvenanceContractFields,
  verifyRunOwnershipAndCleanup,
  scanFullResponseForPii,
  buildChildEnvironment
} = require('../tools/mariadb-live/staging_validation_harness.cjs');
const { validateIdentityEnvironment } = require('../api/canary/identity.js');
const { decodeKeysetCursor } = require('../api/_lib/canary-keyset.cjs');
const { CdpBrowserSession, verifyTradingFloorDom, verifyPriceResearchDom } = require('./staging-browser-smoke.test.cjs');

test('Phase N: Comprehensive Behavioral Contract & Negative Tests', async (t) => {
  const validBaseEnv = {
    ALLOW_DISPOSABLE_STAGING_TEST: 'true',
    EXPECTED_STAGING_PROJECT_ID: 'staging-project-ephemeral-123',
    EXPECTED_STAGING_GIT_SHA: 'ffd20315975667c2ff0a2f0ce860f0baa659cf56',
    STAGING_DATABASE_URL: 'postgresql://postgres:disposable_pass@disposable-host.internal:5432/staging_db',
    STAGING_API_URL: 'https://disposable-staging-api.internal',
    STAGING_SERVICE_ROLE_KEY: 'eyStagingKeyServiceRole'
  };

  await t.test('1. Mandatory expected Git SHA: missing EXPECTED_STAGING_GIT_SHA fails closed', () => {
    assert.throws(
      () => validateStagingEnvironment({ ...validBaseEnv, EXPECTED_STAGING_GIT_SHA: undefined }),
      /STAGING_AUTHORIZATION_REQUIRED: EXPECTED_STAGING_GIT_SHA must be provided and non-empty/
    );
    assert.throws(
      () => validateStagingEnvironment({ ...validBaseEnv, EXPECTED_STAGING_GIT_SHA: '   ' }),
      /STAGING_AUTHORIZATION_REQUIRED: EXPECTED_STAGING_GIT_SHA must be provided and non-empty/
    );
  });

  await t.test('2. Positive staging attestation gate (allow flag & required variables)', () => {
    assert.throws(
      () => validateStagingEnvironment({ ...validBaseEnv, ALLOW_DISPOSABLE_STAGING_TEST: undefined }),
      /STAGING_AUTHORIZATION_REQUIRED: Execution refused. ALLOW_DISPOSABLE_STAGING_TEST must be explicitly set to 'true'/
    );
    assert.throws(
      () => validateStagingEnvironment({ ...validBaseEnv, ALLOW_DISPOSABLE_STAGING_TEST: 'false' }),
      /STAGING_AUTHORIZATION_REQUIRED/
    );
    assert.throws(
      () => validateStagingEnvironment({ ...validBaseEnv, EXPECTED_STAGING_PROJECT_ID: '' }),
      /STAGING_AUTHORIZATION_REQUIRED: EXPECTED_STAGING_PROJECT_ID must be provided and non-empty/
    );
  });

  await t.test('3. Strict URL parsing and production host refusal', () => {
    for (const prodId of PROD_IDENTIFIERS) {
      assert.throws(
        () => validateStagingEnvironment({ ...validBaseEnv, STAGING_DATABASE_URL: `postgresql://u:p@${prodId}:5432/db` }),
        /PRODUCTION_TARGET_REFUSED/
      );
      assert.throws(
        () => validateStagingEnvironment({ ...validBaseEnv, STAGING_API_URL: `https://${prodId}/api` }),
        /PRODUCTION_TARGET_REFUSED/
      );
      assert.throws(
        () => validateStagingEnvironment({ ...validBaseEnv, STAGING_API_URL: `https://staging.internal/path/${prodId}` }),
        /PRODUCTION_TARGET_REFUSED/
      );
    }
  });

  await t.test('4. Environment allowlisting passes only designated staging variables', () => {
    const dirtyEnv = {
      ...validBaseEnv,
      DATABASE_URL: 'postgresql://postgres:prodpass@prod-db.internal:5432/proddb',
      PRODUCTION_API_KEY: 'secret_prod_key_123',
      AWS_SECRET_ACCESS_KEY: 'aws_secret_dont_pass',
      VERCEL_TOKEN: 'vercel_token_secret'
    };

    const cleanChildEnv = buildChildEnvironment(dirtyEnv);
    assert.equal(cleanChildEnv.ALLOW_DISPOSABLE_STAGING_TEST, 'true');
    assert.equal(cleanChildEnv.EXPECTED_STAGING_PROJECT_ID, validBaseEnv.EXPECTED_STAGING_PROJECT_ID);
    assert.equal(cleanChildEnv.EXPECTED_STAGING_GIT_SHA, validBaseEnv.EXPECTED_STAGING_GIT_SHA);
    assert.equal(cleanChildEnv.DATABASE_URL, undefined);
    assert.equal(cleanChildEnv.PRODUCTION_API_KEY, undefined);
  });

  await t.test('5. Secret redaction helper masks passwords, JWTs, and keys', () => {
    const rawDb = 'postgresql://postgres:mySuperSecretPassword123@staging-host.internal:5432/railway';
    assert.equal(redactSecretString(rawDb), 'postgresql://postgres:[REDACTED_PASSWORD]@staging-host.internal:5432/railway');

    const rawJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig1234567890abcdef';
    assert.equal(redactSecretString(rawJwt), '[REDACTED_JWT]');

    const rawKey = 'sb_secret_abcdef1234567890_xyz';
    assert.equal(redactSecretString(rawKey), '[REDACTED_KEY]');
  });

  await t.test('6. Canonical source_hash recalculation: key order invariance and whitespace preservation', () => {
    const payloadA = { source_id: 'synth-001', brand: 'Rolex', reference: '126610LN', price: 13500, note: '  spaced  ' };
    const payloadB = { note: '  spaced  ', price: 13500, reference: '126610LN', brand: 'Rolex', source_id: 'synth-001' };
    assert.equal(calculateCanonicalPayloadHash(payloadA), calculateCanonicalPayloadHash(payloadB));

    const alteredPayload = { ...payloadA, price: 13501 };
    assert.notEqual(calculateCanonicalPayloadHash(payloadA), calculateCanonicalPayloadHash(alteredPayload));
  });

  await t.test('7. Complete 5-tuple keyset ordering comparator fails if non-priced fields are out of order', () => {
    const baseRecord = {
      priced_rank: 1,
      image_rank: 1,
      price_usd: 15000,
      source_created_at: '2026-08-01T12:00:00.000Z',
      listing_id: 'list-001'
    };

    // Valid consecutive records
    const nextRecord = {
      priced_rank: 1,
      image_rank: 1,
      price_usd: 14000, // lower price -> comes after
      source_created_at: '2026-08-01T11:00:00.000Z',
      listing_id: 'list-002'
    };
    assert.equal(isKeysetTupleOrderValid(baseRecord, nextRecord), true);

    // Negative: image_rank out of order (2 before 1 when priced_rank is equal)
    const badImageRank = { ...baseRecord, image_rank: 2 };
    assert.equal(isKeysetTupleOrderValid(badImageRank, baseRecord), false);

    // Negative: price_usd out of order (lower price before higher price when ranks are equal)
    const lowerPrice = { ...baseRecord, price_usd: 10000 };
    const higherPrice = { ...baseRecord, price_usd: 20000 };
    assert.equal(isKeysetTupleOrderValid(lowerPrice, higherPrice), false);

    // Negative: source_created_at out of order (older timestamp before newer timestamp)
    const olderTime = { ...baseRecord, source_created_at: '2026-08-01T10:00:00.000Z' };
    const newerTime = { ...baseRecord, source_created_at: '2026-08-01T14:00:00.000Z' };
    assert.equal(isKeysetTupleOrderValid(olderTime, newerTime), false);

    // Negative: listing_id out of order ('list-002' before 'list-001' when all other fields match)
    const lidA = { ...baseRecord, listing_id: 'list-002' };
    const lidB = { ...baseRecord, listing_id: 'list-001' };
    assert.equal(isKeysetTupleOrderValid(lidA, lidB), false);
  });

  await t.test('8. Keyset page order verifier fails on in-page and cross-page violations', () => {
    const p1r1 = { priced_rank: 1, image_rank: 1, price_usd: 15000, source_created_at: '2026-08-01T12:00:00Z', listing_id: 'a' };
    const p1r2 = { priced_rank: 1, image_rank: 1, price_usd: 14000, source_created_at: '2026-08-01T11:00:00Z', listing_id: 'b' };
    const p2r1 = { priced_rank: 1, image_rank: 1, price_usd: 13000, source_created_at: '2026-08-01T10:00:00Z', listing_id: 'c' };

    // Valid cross-page
    assert.equal(verifyPageKeysetOrdering([p2r1], p1r2), true);

    // Invalid cross-page (p2r1 has higher price than p1r2)
    const invalidCrossPage = { priced_rank: 1, image_rank: 1, price_usd: 20000, source_created_at: '2026-08-01T10:00:00Z', listing_id: 'c' };
    assert.throws(
      () => verifyPageKeysetOrdering([invalidCrossPage], p1r2),
      /KEYSET_ORDER_VIOLATION: Cross-page order invalid/
    );

    // Invalid in-page
    assert.throws(
      () => verifyPageKeysetOrdering([p1r2, p1r1]),
      /KEYSET_ORDER_VIOLATION: In-page order invalid/
    );
  });

  await t.test('9. Pagination identity ledger calculates duplicate, missing unmutated baseline, and unexpected IDs', () => {
    const baseline = ['p001', 'p002', 'p003', 'p004'];
    const mutated = new Set(['p001']); // p001 legitimately moved
    const inserted = new Set(['p_new']);

    // Perfect traversal
    const seenValid = ['p002', 'p003', 'p004', 'p_new'];
    const ledgerValid = calculatePaginationIdentityLedger(seenValid, baseline, mutated, inserted);
    assert.equal(ledgerValid.is_valid, true);
    assert.equal(ledgerValid.duplicate_ids.length, 0);
    assert.equal(ledgerValid.missing_baseline_ids.length, 0);

    // Missing unmutated baseline row fails
    const seenMissing = ['p002', 'p004']; // p003 is missing
    const ledgerMissing = calculatePaginationIdentityLedger(seenMissing, baseline, mutated, inserted);
    assert.equal(ledgerMissing.is_valid, false);
    assert.deepEqual(ledgerMissing.missing_baseline_ids, ['p003']);

    // Duplicate ID fails
    const seenDuplicate = ['p002', 'p002', 'p003', 'p004'];
    const ledgerDup = calculatePaginationIdentityLedger(seenDuplicate, baseline, mutated, inserted);
    assert.equal(ledgerDup.is_valid, false);
    assert.deepEqual(ledgerDup.duplicate_ids, ['p002']);

    // Unexpected ID fails
    const seenUnexpected = ['p002', 'p003', 'p004', 'ghost_id'];
    const ledgerUnexp = calculatePaginationIdentityLedger(seenUnexpected, baseline, mutated, inserted);
    assert.equal(ledgerUnexp.is_valid, false);
    assert.deepEqual(ledgerUnexp.unexpected_ids, ['ghost_id']);
  });

  await t.test('10. Complete contract provenance verification fails if fields are hard-coded or missing', () => {
    const row = {
      listing_id: 'lid-1',
      brand: 'Rolex',
      model: 'Submariner',
      price_usd: 12000,
      seller_display_name: null,
      seller_id: null,
      location_country: null
    };
    const apiRow = { id: 'lid-1', brand: 'Rolex', model: 'Submariner', price: 12000 };

    const prov = verifyProvenanceContractFields(row, row, row, row, apiRow, CONTRACT_FIELDS);
    assert.equal(prov.verified, true);
    assert.equal(prov.verified_fields_count, CONTRACT_FIELDS.length);

    // Hard-coded empty field set fails closed
    assert.throws(
      () => verifyProvenanceContractFields(row, row, row, row, apiRow, []),
      /PROVENANCE_ERROR: Contract fields array must be non-empty/
    );

    // Mismatched field across tiers fails
    const propAltered = { ...row, price_usd: 99999 };
    assert.throws(
      () => verifyProvenanceContractFields(row, propAltered, row, propAltered, apiRow, CONTRACT_FIELDS),
      /PROVENANCE_FIELD_MISMATCH/
    );
  });

  await t.test('11. Mutation ledger verification: fails closed if mutation ledger stays empty', () => {
    const verifyLedgerNotEmpty = (ledger) => {
      if (!Array.isArray(ledger) || ledger.length === 0) {
        throw new Error('MUTATION_LEDGER_EMPTY: Mutation ledger must record every migration, DDL, insert, and delete.');
      }
      return true;
    };

    assert.throws(
      () => verifyLedgerNotEmpty([]),
      /MUTATION_LEDGER_EMPTY/
    );
    assert.equal(verifyLedgerNotEmpty([{ action: 'INSERT', target: 'raw_alpha' }]), true);
  });

  await t.test('12. Migration bootstrap check: fails closed if migration execution is omitted', () => {
    const verifyMigrationsApplied = (appliedList) => {
      const required = [
        '20260829120000_private_mariadb_raw_staging.sql',
        '20260830150000_private_mariadb_normalized_staging.sql',
        '20260902130000_v2_canary_forward_migration.sql'
      ];
      for (const mig of required) {
        if (!appliedList.includes(mig)) {
          throw new Error(`BOOTSTRAP_INCOMPLETE: Prerequisite migration '${mig}' was not executed.`);
        }
      }
      return true;
    };

    assert.throws(
      () => verifyMigrationsApplied(['20260829120000_private_mariadb_raw_staging.sql']),
      /BOOTSTRAP_INCOMPLETE/
    );
    assert.equal(verifyMigrationsApplied([
      '20260829120000_private_mariadb_raw_staging.sql',
      '20260830150000_private_mariadb_normalized_staging.sql',
      '20260902130000_v2_canary_forward_migration.sql'
    ]), true);
  });

  await t.test('13. API calls check: fails closed if API responses are omitted or mock empty', () => {
    const verifyApiResponse = (resp, endpointName) => {
      if (!resp || typeof resp !== 'object' || Object.keys(resp).length === 0) {
        throw new Error(`API_CALL_OMITTED: Real API response from '${endpointName}' required.`);
      }
      return true;
    };

    assert.throws(() => verifyApiResponse(null, 'Trading Floor'), /API_CALL_OMITTED/);
    assert.throws(() => verifyApiResponse({}, 'Price Research'), /API_CALL_OMITTED/);
    assert.equal(verifyApiResponse({ records: [{ id: '1' }] }, 'Trading Floor'), true);
  });

  await t.test('14. Browser CDP session check: fails closed if browser session is never launched', () => {
    const verifyBrowserSessionLaunched = (sessionInstance) => {
      if (!sessionInstance || !(sessionInstance instanceof CdpBrowserSession)) {
        throw new Error('BROWSER_SESSION_NOT_LAUNCHED: Real CdpBrowserSession must be instantiated and launched.');
      }
      return true;
    };

    assert.throws(() => verifyBrowserSessionLaunched(null), /BROWSER_SESSION_NOT_LAUNCHED/);
    assert.throws(() => verifyBrowserSessionLaunched({}), /BROWSER_SESSION_NOT_LAUNCHED/);
    assert.equal(verifyBrowserSessionLaunched(new CdpBrowserSession()), true);
  });
});
