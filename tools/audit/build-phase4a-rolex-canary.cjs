#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { proposal, stable } = require('../mariadb-live/run-rolex-null-only-source-completion.cjs');

const AUTHORIZED = new Map([
  ['ac6840bb-0195-45aa-a3ad-5b536dd6fd7b', {
    reference: '126334', source_record_id: 'mysql_auctions_0a6dffd1-f1de-46cb-be10-c618a94ceb0f',
    raw_message_version_id: 'a790717e-7bdf-4629-b9d8-3f87e36c2c51',
    source_hash: 'ba0295ebc3e4b605f85d34d5f6010ae119d9f509167e5dd40cd4c4bf505097f8',
    source_candidate_hash: '1f212c4f808bc29fefa8f9dd05026bbc07a9987f279603b33cd3f985eb81d906',
  }],
  ['42e491b1-b1a4-44f8-99e8-0ef38b1c5973', {
    reference: '228235', source_record_id: 'mysql_auctions_6fe15a1e-3168-4dfd-b915-ca42a6adc35a',
    raw_message_version_id: 'f7abfdce-2fc6-4ef2-a22c-5291314b7521',
    source_hash: 'a739144ee3ae7e48e37fb2d4b0720b66f673043aef7700b39c1ba8239b8cafd3',
    source_candidate_hash: 'de97ac1b893600c3390e022cf38139b4815080f49036c0ae9625b2585087baa9',
  }],
  ['fb45c058-f100-4798-b662-6054be07b2c9', {
    reference: '228238', source_record_id: 'mysql_auctions_bc9fe008-0009-4220-8bfa-bfc045d3691a',
    raw_message_version_id: '1c29a51a-014c-475b-ab7d-b311901dc557',
    source_hash: 'd8a56b57e234fcf91ed269aba3c76673ccb26a52cdb98bddc79c5949b75e221d',
    source_candidate_hash: 'b99c70c39da6d5f9803cc07c2d6d9b70587cb77fe1542c40df9abe8023d32b28',
  }],
]);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function buildManifest(input, generatedAt = new Date().toISOString()) {
  const safe = (input.rows || []).filter(row => row.classification === 'SAFE_VERIFIED_FX');
  if (safe.length !== AUTHORIZED.size) throw new Error(`Expected exactly 3 safe rows, received ${safe.length}`);

  const records = safe.map(row => {
    const expected = AUTHORIZED.get(row.listing_id);
    if (!expected
      || row.normalized_reference !== expected.reference
      || row.source_record_id !== expected.source_record_id
      || row.raw_message_version_id !== expected.raw_message_version_id
      || row.source_hash !== expected.source_hash
      || row.source_candidate_hash !== expected.source_candidate_hash
      || row.intent !== 'WTB'
      || row.bundle_state?.parent_id !== null
      || row.bundle_state?.is_bundle !== false
      || row.bundle_state?.bundle_status !== 'SINGLE_CANDIDATE'
      || row.existing_price?.price_usd !== null
      || !row.parser_observation?.proposed_price_usd
      || !row.parser_observation?.fx_rate
      || !row.parser_observation?.fx_date
      || !row.parser_observation?.fx_source) {
      throw new Error(`Invariant drift for ${row.listing_id}`);
    }
    return proposal({
      listing_id: row.listing_id,
      raw_message_version_id: row.raw_message_version_id,
      source_record_id: row.source_record_id,
      source_hash: row.source_hash,
      source_candidate_hash: row.source_candidate_hash,
      normalized_reference: row.normalized_reference,
      proposed_price_usd: row.parser_observation.proposed_price_usd,
      source_price_amount: row.parser_observation.source_amount,
      source_currency: row.parser_observation.source_currency,
      currency_evidence: row.parser_observation.currency_evidence,
      // staging.listings.conversion_rate persists six decimal places. Bind the
      // proposal digest to the exact stored representation while retaining the
      // full observed ECB rate in the parser revalidation artifact.
      conversion_rate: Math.round(row.parser_observation.fx_rate * 1e6) / 1e6,
      conversion_timestamp: row.parser_observation.fx_date,
      conversion_source: row.parser_observation.fx_source,
    });
  }).sort((a, b) => a.listing_id.localeCompare(b.listing_id));

  const manifest = {
    contract: 'watchfacts-rolex-phase4a-null-only-canary-v1',
    project_ref: 'qnsafosakvonzgfcsphh',
    authorization: 'P3-RLX-001 CANARY_READY / Phase 3.5 immutable cohort',
    generated_at: generatedAt,
    expected_count: 3,
    records,
  };
  const canonical = stable(manifest);
  return { ...manifest, manifest_canonical: canonical, manifest_sha256: sha256(canonical) };
}

function main() {
  if (!process.env.PHASE4A_REVALIDATION || !process.env.PHASE4A_PRIVATE_MANIFEST) {
    throw new Error('PHASE4A_REVALIDATION and PHASE4A_PRIVATE_MANIFEST are required');
  }
  const inputPath = path.resolve(process.env.PHASE4A_REVALIDATION);
  const outputPath = path.resolve(process.env.PHASE4A_PRIVATE_MANIFEST);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const envelope = buildManifest(input);
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    expected_count: envelope.expected_count,
    manifest_sha256: envelope.manifest_sha256,
    listing_ids: envelope.records.map(row => row.listing_id),
    raw_messages_exported: false,
    contact_values_exported: false,
  }, null, 2)}\n`);
}

module.exports = { AUTHORIZED, buildManifest };

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
