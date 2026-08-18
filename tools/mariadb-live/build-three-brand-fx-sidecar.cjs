'use strict';

const { buildCorrectionPage } = require('./build-three-brand-price-correction.cjs');

function buildSidecarPage(rows, fxSnapshot, options = {}) {
  const page = buildCorrectionPage(rows, fxSnapshot, options);
  return {
    ...page,
    contract: 'wf-three-brand-fx-sidecar-v1',
    records: page.records.map(record => ({
      run_key: options.correctionRunKey,
      listing_id: record.listing_id,
      normalization_run_key: options.normalizationRunKey,
      source_record_id: record.source_record_id,
      source_hash: record.source_hash,
      brand_normalized: record.candidate.brand,
      reference_normalized: record.candidate.reference,
      amount_original: record.candidate.price.amount_original,
      currency_original: record.candidate.price.currency_original,
      amount_usd: record.candidate.price.amount_usd,
      conversion_rate: record.candidate.price.conversion_rate,
      conversion_source: record.candidate.price.conversion_source,
      conversion_timestamp: record.candidate.price.conversion_timestamp,
      evidence: { contract: 'wf-three-brand-fx-sidecar-v1', raw_lineage_verified: true },
      batch_token: page.batch_token,
    })),
  };
}

module.exports = { buildSidecarPage };
