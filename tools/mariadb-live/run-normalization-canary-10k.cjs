// tools/mariadb-live/run-normalization-canary-10k.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Reuse existing repository deterministic normalization engine
const {
  splitMessageLines,
  segmentDealerMessage,
  extractPriceCandidates,
  extractReference,
  explicitIntent,
  inferBrandFromReference,
  parseNumber
} = require('../../api/_lib/normalization-v4.cjs');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function stableJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (Array.isArray(obj)) return '[' + obj.map(stableJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}';
}

/**
 * Evaluates intent strictly from source evidence.
 * Rule: NEVER default unknown intent to WTS.
 * Returns 'WTS' | 'WTB' | null (if ambiguous / unknown)
 */
function resolveStrictIntent(rawRow) {
  const rawType = rawRow && rawRow.type ? String(rawRow.type).trim().toLowerCase() : '';
  const text = ((rawRow && rawRow.title ? String(rawRow.title) : '') + ' ' + (rawRow && rawRow.description ? String(rawRow.description) : '')).trim();

  if (rawType === 'buy') return 'WTB';
  if (rawType === 'sale') return 'WTS';

  // If rawType is empty or other, inspect explicit text cues
  const explicit = explicitIntent(text);
  if (explicit === 'WTB' || explicit === 'WTS') return explicit;

  // Unknown / unsupported intent: strictly return null (REVIEW_REQUIRED)
  return null;
}

/**
 * Normalizes a single staged MariaDB raw source row using repository evidence-first rules.
 */
function normalizeStagedRow(stagedRow) {
  const raw = stagedRow.raw_payload || {};
  const rawMessage = stagedRow.raw_message || raw.description || raw.title || '';
  const title = String(raw.title || '');
  const description = String(raw.description || '');
  const combinedText = (title + '\n' + description).trim();

  // 1. Intent Determination: strictly evidence-backed
  const intent = resolveStrictIntent(raw);

  // 2. Candidate Segmentation & Bundle Detection using existing repository engine
  const isExplicitBundle = Number(raw.is_bundle) === 1;
  const candidates = segmentDealerMessage(combinedText);
  const isMultiCandidate = candidates.length > 1;
  const isBundle = isExplicitBundle || isMultiCandidate;

  // 3. Brand, Model, Reference Extraction
  let brand = raw.brand ? String(raw.brand).trim() : null;
  let model = raw.model ? String(raw.model).trim() : null;
  let reference = raw.reference || raw.normalized_reference ? String(raw.reference || raw.normalized_reference).trim() : null;

  if (!reference && candidates.length === 1 && candidates[0].reference) {
    reference = candidates[0].reference;
  }
  if (!brand && reference) {
    brand = inferBrandFromReference(reference);
  }

  // 4. Price & Currency Evaluation using existing repository price engine
  const priceCandidates = extractPriceCandidates(combinedText, {
    currency_context: raw.currency ? String(raw.currency).trim().toUpperCase() : null
  });

  const autoApprovedPrices = priceCandidates.filter(c => c.evidence_status === 'AUTO_APPROVED' && !c.review_required);
  const primaryPrice = autoApprovedPrices[0] || null;

  let priceAmount = null;
  let priceCurrency = null;
  let priceUsd = null;
  let currencyStatus = 'MISSING_PRICE';
  let priceResearchEligible = false;

  const rawPrice = raw.price !== undefined && raw.price !== null ? String(raw.price).trim() : '';
  const rawCurrency = raw.currency !== undefined && raw.currency !== null ? String(raw.currency).trim().toUpperCase() : '';

  if (primaryPrice) {
    priceAmount = primaryPrice.amount_original;
    priceCurrency = primaryPrice.currency_original;
    priceUsd = primaryPrice.amount_usd;
    currencyStatus = 'VERIFIED_EXPLICIT_' + priceCurrency;
    priceResearchEligible = priceCurrency === 'USD' && Number.isFinite(priceUsd) && priceUsd > 0;
  } else if (priceCandidates.some(c => c.review_reason === 'CURRENCY_AMBIGUOUS' || c.parser_rule === 'bare_dollar')) {
    currencyStatus = 'AMBIGUOUS_BARE_DOLLAR_HELD';
  } else if (rawPrice && rawPrice !== '0' && rawPrice !== '0.00') {
    if (rawCurrency === 'USD' || rawCurrency === 'USDT') {
      const num = Number(rawPrice);
      if (!isNaN(num) && num > 0) {
        priceAmount = num;
        priceCurrency = 'USD';
        priceUsd = num;
        currencyStatus = 'VERIFIED_EXPLICIT_USD_FROM_METADATA';
        priceResearchEligible = true;
      }
    } else if (rawCurrency === '$') {
      currencyStatus = 'AMBIGUOUS_BARE_DOLLAR_HELD';
    } else if (rawCurrency) {
      const num = Number(rawPrice);
      if (!isNaN(num) && num > 0) {
        priceAmount = num;
        priceCurrency = rawCurrency;
        currencyStatus = 'VERIFIED_EXPLICIT_' + rawCurrency + '_FROM_METADATA';
      }
    } else {
      currencyStatus = 'MISSING_CURRENCY_PROOF';
    }
  }

  // 5. Contact Evidence
  const sellerContactEvidence = {
    from_name: raw.from_name || null,
    from_number: raw.from_number ? String(raw.from_number) : null,
    phone_code: raw.phone_code ? Number(raw.phone_code) : null,
    dealer_rating: raw.dealer_rating !== undefined ? Number(raw.dealer_rating) : null,
    origin: raw.origin || null,
    region: raw.region || null
  };

  // 6. Front Image Key
  const frontImageKey = raw.front_image || raw.image || null;

  // 7. Bundle Parent-Child Lineage
  const bundleLineage = {
    raw_is_bundle: raw.is_bundle,
    is_multi_candidate: isMultiCandidate,
    candidate_count: candidates.length,
    child_references: candidates.map(c => c.reference).filter(Boolean),
    held_out_of_publication: isBundle
  };

  // 8. Reconciliation Category & Publication Eligibility
  const reviewFlags = [];
  let reconciliationCategory = 'NORMALIZED_PROPOSAL';
  let publicationEligibility = 'ELIGIBLE_NORMALIZED';

  if (isBundle) {
    reconciliationCategory = 'REVIEW_REQUIRED';
    publicationEligibility = 'HELD_BUNDLE_REVIEW';
    reviewFlags.push('HELD_BUNDLE_MULTI_CANDIDATE');
  }

  if (!intent) {
    reconciliationCategory = 'REVIEW_REQUIRED';
    if (publicationEligibility === 'ELIGIBLE_NORMALIZED') publicationEligibility = 'HELD_INTENT_UNKNOWN';
    reviewFlags.push('UNKNOWN_INTENT');
  }

  if (!brand || (!model && !reference)) {
    reconciliationCategory = 'REVIEW_REQUIRED';
    if (publicationEligibility === 'ELIGIBLE_NORMALIZED') publicationEligibility = 'HELD_IDENTITY_REVIEW';
    reviewFlags.push('INCOMPLETE_IDENTITY');
  }

  if (!priceResearchEligible && (currencyStatus.startsWith('AMBIGUOUS') || currencyStatus.startsWith('MISSING'))) {
    if (reconciliationCategory === 'NORMALIZED_PROPOSAL') {
      reconciliationCategory = 'REVIEW_REQUIRED';
      publicationEligibility = 'HELD_PRICE_REVIEW';
    }
    reviewFlags.push(currencyStatus);
  }

  return {
    source_id: stagedRow.source_id,
    source_hash: stagedRow.source_hash,
    source_cursor: stagedRow.source_created_on,
    source_system: stagedRow.source_system,
    source_database: stagedRow.source_database,
    source_table: stagedRow.source_table,
    source_record_id: stagedRow.source_record_id,
    raw_message: rawMessage,
    front_image_key: frontImageKey,
    seller_contact_evidence: sellerContactEvidence,
    bundle_lineage: bundleLineage,
    brand,
    model,
    reference,
    intent,
    price_amount: priceAmount,
    price_currency: priceCurrency,
    price_usd: priceUsd,
    currency_status: currencyStatus,
    price_research_eligible: priceResearchEligible,
    publication_eligibility: publicationEligibility,
    reconciliation_category: reconciliationCategory,
    review_flags: reviewFlags
  };
}

/**
 * Executes deterministic in-memory normalization over staged rows and writes local-only artifacts.
 */
function processStagedRowsLocally(stagedRows, options = {}) {
  const startTime = Date.now();
  let normalizedCount = 0;
  let reviewCount = 0;
  let errorCount = 0;

  const proposals = [];
  const errorReasons = {};
  const currencyStatus = {};
  const bundleStatus = {};
  const imageLineage = {
    total_rows: stagedRows.length,
    rows_with_image: 0,
    rows_without_image: 0,
    sample_images: []
  };
  const readbackHashes = [];

  for (let i = 0; i < stagedRows.length; i++) {
    const row = stagedRows[i];
    try {
      const proposal = normalizeStagedRow(row);
      proposals.push(proposal);

      readbackHashes.push({
        source_id: row.source_id,
        source_hash: row.source_hash,
        valid: Boolean(row.source_hash && row.source_hash.length === 64)
      });

      currencyStatus[proposal.currency_status] = (currencyStatus[proposal.currency_status] || 0) + 1;
      bundleStatus[proposal.bundle_lineage.held_out_of_publication ? 'BUNDLE_HELD' : 'SINGLE_ITEM'] = (bundleStatus[proposal.bundle_lineage.held_out_of_publication ? 'BUNDLE_HELD' : 'SINGLE_ITEM'] || 0) + 1;

      if (proposal.front_image_key) {
        imageLineage.rows_with_image++;
        if (imageLineage.sample_images.length < 10) {
          imageLineage.sample_images.push({
            source_id: proposal.source_id,
            image_key: proposal.front_image_key,
            brand: proposal.brand,
            model: proposal.model
          });
        }
      } else {
        imageLineage.rows_without_image++;
      }

      if (proposal.reconciliation_category === 'NORMALIZED_PROPOSAL') {
        normalizedCount++;
      } else if (proposal.reconciliation_category === 'REVIEW_REQUIRED') {
        reviewCount++;
        proposal.review_flags.forEach(flag => {
          errorReasons[flag] = (errorReasons[flag] || 0) + 1;
        });
      } else {
        errorCount++;
        errorReasons['UNPARSEABLE_ROW'] = (errorReasons['UNPARSEABLE_ROW'] || 0) + 1;
      }
    } catch (err) {
      errorCount++;
      errorReasons[err.message || 'RUNTIME_ERROR'] = (errorReasons[err.message || 'RUNTIME_ERROR'] || 0) + 1;
    }
  }

  const durationMs = Date.now() - startTime;
  const exactReconciliation = (normalizedCount + reviewCount + errorCount) === stagedRows.length;

  const outputDir = path.resolve(options.outputDir || 'audit-output/mariadb-live/normalization-canary-10k');
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Write proposals.jsonl
  const jsonlLines = proposals.map(p => JSON.stringify(p)).join('\n');
  fs.writeFileSync(path.join(outputDir, 'proposals.jsonl'), jsonlLines, 'utf-8');

  // 2. Write proposals.csv
  const csvHeaders = [
    'source_id', 'source_cursor', 'brand', 'model', 'reference', 'intent',
    'price_amount', 'price_currency', 'price_usd', 'currency_status',
    'price_research_eligible', 'publication_eligibility', 'reconciliation_category',
    'front_image_key', 'is_bundle'
  ];
  const csvRows = [csvHeaders.join(',')];
  for (const p of proposals) {
    const values = [
      JSON.stringify(p.source_id || ''),
      JSON.stringify(p.source_cursor || ''),
      JSON.stringify(p.brand || ''),
      JSON.stringify(p.model || ''),
      JSON.stringify(p.reference || ''),
      JSON.stringify(p.intent || ''),
      p.price_amount !== null ? p.price_amount : '',
      JSON.stringify(p.price_currency || ''),
      p.price_usd !== null ? p.price_usd : '',
      JSON.stringify(p.currency_status || ''),
      p.price_research_eligible ? 'true' : 'false',
      JSON.stringify(p.publication_eligibility || ''),
      JSON.stringify(p.reconciliation_category || ''),
      JSON.stringify(p.front_image_key || ''),
      p.bundle_lineage.held_out_of_publication ? 'true' : 'false'
    ];
    csvRows.push(values.join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'proposals.csv'), csvRows.join('\n'), 'utf-8');

  // 3. Write manifest.json
  const manifest = {
    contract: 'wf-normalization-canary-v2',
    timestamp: new Date().toISOString(),
    total_inputs: stagedRows.length,
    first_cursor: stagedRows[0] ? { created_on: stagedRows[0].source_created_on, source_id: stagedRows[0].source_id } : null,
    last_cursor: stagedRows[stagedRows.length - 1] ? { created_on: stagedRows[stagedRows.length - 1].source_created_on, source_id: stagedRows[stagedRows.length - 1].source_id } : null,
    ruleset: 'evidence-first-repo-v4-no-bare-dollar-held-bundles-held-strict-intent',
    exact_reconciliation: exactReconciliation
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 4. Write performance.json
  const performance = {
    total_inputs: stagedRows.length,
    duration_ms: durationMs,
    rows_per_second: durationMs > 0 ? Math.round((stagedRows.length / (durationMs / 1000)) * 100) / 100 : 0,
    memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100
  };
  fs.writeFileSync(path.join(outputDir, 'performance.json'), JSON.stringify(performance, null, 2));

  // 5. Write error-reasons.json
  fs.writeFileSync(path.join(outputDir, 'error-reasons.json'), JSON.stringify({
    reconciliation: {
      total_inputs: stagedRows.length,
      normalized_proposals: normalizedCount,
      review_required: reviewCount,
      errors: errorCount,
      exact_reconciliation: exactReconciliation
    },
    review_flags_breakdown: errorReasons
  }, null, 2));

  // 6. Write image-lineage.json
  fs.writeFileSync(path.join(outputDir, 'image-lineage.json'), JSON.stringify(imageLineage, null, 2));

  // 7. Write currency-status.json
  fs.writeFileSync(path.join(outputDir, 'currency-status.json'), JSON.stringify({
    rule: 'EXPLICIT_PRICE_CURRENCY_PROOF_REQUIRED_BARE_DOLLAR_HELD',
    breakdown: currencyStatus
  }, null, 2));

  // 8. Write bundle-status.json
  fs.writeFileSync(path.join(outputDir, 'bundle-status.json'), JSON.stringify({
    rule: 'RAW_IS_BUNDLE_AND_MULTI_CANDIDATES_HELD_OUT_OF_PUBLICATION',
    breakdown: bundleStatus
  }, null, 2));

  // 9. Write readback-hashes.json
  fs.writeFileSync(path.join(outputDir, 'readback-hashes.json'), JSON.stringify({
    total_checked: readbackHashes.length,
    all_valid: readbackHashes.every(h => h.valid),
    sample_first_5: readbackHashes.slice(0, 5),
    sample_last_5: readbackHashes.slice(-5)
  }, null, 2));

  return {
    manifest,
    performance,
    reconciliation: {
      total_inputs: stagedRows.length,
      normalized_proposals: normalizedCount,
      review_required: reviewCount,
      errors: errorCount,
      exact_reconciliation: exactReconciliation
    }
  };
}

module.exports = {
  normalizeStagedRow,
  resolveStrictIntent,
  processStagedRowsLocally
};
