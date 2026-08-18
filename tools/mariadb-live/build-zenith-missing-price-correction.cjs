'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyZenithIdentityEvidence } = require('../../api/_lib/zenith-identity-evidence.cjs');
const { selectZenithPriceEvidence } = require('../../api/_lib/zenith-price-evidence.cjs');

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

function buildZenithMissingPriceCorrection(rows, fxSnapshot) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 453) {
    throw new Error('Zenith correction input must contain 1..453 exact-lineage rows');
  }
  if (fxSnapshot?.contract !== 'wf-dated-fx-snapshot-v1' || fxSnapshot?.base !== 'USD'
    || !fxSnapshot?.source || !fxSnapshot?.observed_at || !fxSnapshot?.usd_per_unit) {
    throw new Error('A dated named USD FX snapshot is required');
  }

  const seenListings = new Set();
  const corrections = [];
  const withheld = {};
  for (const row of rows) {
    const listingId = String(row?.listing_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(listingId) || seenListings.has(listingId)) {
      throw new Error('Invalid or duplicate Zenith listing lineage');
    }
    seenListings.add(listingId);
    const identity = classifyZenithIdentityEvidence(row.raw_message);
    if (identity.decision !== 'RELEASE_SAFE' || identity.references?.[0] !== row.normalized_reference) {
      withheld.IDENTITY_NOT_EXACT = (withheld.IDENTITY_NOT_EXACT || 0) + 1;
      continue;
    }
    const price = selectZenithPriceEvidence(row.raw_message);
    if (!price) {
      withheld.NO_EXPLICIT_PRICE = (withheld.NO_EXPLICIT_PRICE || 0) + 1;
      continue;
    }
    const currency = String(price.currency_original || '').toUpperCase();
    const rate = ['USD', 'USDT'].includes(currency) ? 1 : Number(fxSnapshot.usd_per_unit[currency]);
    if (!Number.isFinite(rate) || rate <= 0) {
      withheld.UNSUPPORTED_OR_UNVERIFIED_FX = (withheld.UNSUPPORTED_OR_UNVERIFIED_FX || 0) + 1;
      continue;
    }
    const amount = Number(price.amount_original);
    corrections.push({
      listing_id: listingId,
      source_record_id: row.source_record_id,
      source_hash: row.source_hash,
      listing_type: String(row.listing_type || '').toUpperCase(),
      amount_original: amount,
      currency_original: currency,
      price_usd: Math.round(amount * rate * 100) / 100,
      conversion_rate: rate,
      conversion_timestamp: ['USD', 'USDT'].includes(currency) ? null : fxSnapshot.observed_at,
      conversion_source: ['USD', 'USDT'].includes(currency)
        ? (price.currency_evidence === 'usd_defaulted_by_policy' ? 'USD_DEFAULTED_BY_POLICY' : 'SOURCE_USD_OR_USDT')
        : fxSnapshot.source,
      currency_evidence: price.currency_evidence,
      raw_price_text: price.raw_price_text,
    });
  }
  return {
    contract: 'qnsa-zenith-missing-price-correction-v1',
    fx_observed_at: fxSnapshot.observed_at,
    fx_source: fxSnapshot.source,
    scanned_rows: rows.length,
    corrected_rows: corrections.length,
    withheld_rows: rows.length - corrections.length,
    withheld_by_reason: withheld,
    corrections,
  };
}

function main() {
  const input = process.env.ZENITH_PRICE_INPUT || 'zenith-price-input.json';
  const snapshot = process.env.MARIADB_FX_SNAPSHOT_OUTPUT || 'zenith-fx-snapshot.json';
  const output = process.env.ZENITH_PRICE_OUTPUT || 'zenith-price-corrections.json';
  const report = process.env.ZENITH_PRICE_REPORT || 'zenith-price-report.json';
  const payload = buildZenithMissingPriceCorrection(readJson(input), readJson(snapshot));
  fs.writeFileSync(output, `${JSON.stringify(payload)}\n`);
  const safeReport = { ...payload };
  delete safeReport.corrections;
  fs.writeFileSync(report, `${JSON.stringify(safeReport, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(safeReport)}\n`);
}

if (require.main === module) main();

module.exports = { buildZenithMissingPriceCorrection };
