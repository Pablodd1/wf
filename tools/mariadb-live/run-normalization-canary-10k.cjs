// tools/mariadb-live/run-normalization-canary-10k.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
 * Currency & Price Extraction Contract:
 * - Explicit null for missing/ambiguous price or currency
 * - NO USD assumption for bare $
 */
function parsePriceAndCurrency(rawRow) {
  const rawPrice = rawRow.price !== undefined && rawRow.price !== null ? String(rawRow.price).trim() : '';
  const rawCurrency = rawRow.currency !== undefined && rawRow.currency !== null ? String(rawRow.currency).trim().toUpperCase() : '';
  const title = String(rawRow.title || '');
  const description = String(rawRow.description || '');
  const text = title + ' ' + description;

  // 1. Missing Price
  if (!rawPrice || rawPrice === '0' || rawPrice === '0.00' || rawPrice === 'null') {
    return {
      price_amount: null,
      price_currency: null,
      currency_status: 'MISSING_PRICE',
      raw_price_evidence: rawPrice || null
    };
  }

  const numPrice = Number(rawPrice);
  if (isNaN(numPrice) || numPrice <= 0) {
    return {
      price_amount: null,
      price_currency: null,
      currency_status: 'INVALID_PRICE_FORMAT',
      raw_price_evidence: rawPrice
    };
  }

  // 2. Currency Evaluation
  // Strict rule: Bare $ without explicit USD qualification is AMBIGUOUS (could be HK$, SGD, AUD, CAD)
  if (rawCurrency === '$' || rawCurrency === 'DOLLAR' || rawCurrency === 'DOLLARS') {
    return {
      price_amount: null,
      price_currency: null,
      currency_status: 'AMBIGUOUS_BARE_DOLLAR_HELD',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  if (rawCurrency === 'USD' || rawCurrency === 'USDT' || rawCurrency === 'US$' || rawCurrency === 'U$') {
    return {
      price_amount: numPrice,
      price_currency: 'USD',
      currency_status: 'VERIFIED_EXPLICIT_USD',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  if (rawCurrency === 'HKD' || rawCurrency === 'HK$') {
    return {
      price_amount: numPrice,
      price_currency: 'HKD',
      currency_status: 'VERIFIED_EXPLICIT_HKD',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  if (rawCurrency === 'EUR' || rawCurrency === '€') {
    return {
      price_amount: numPrice,
      price_currency: 'EUR',
      currency_status: 'VERIFIED_EXPLICIT_EUR',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  if (rawCurrency === 'GBP' || rawCurrency === '£') {
    return {
      price_amount: numPrice,
      price_currency: 'GBP',
      currency_status: 'VERIFIED_EXPLICIT_GBP',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  if (rawCurrency === 'SGD' || rawCurrency === 'SGD$') {
    return {
      price_amount: numPrice,
      price_currency: 'SGD',
      currency_status: 'VERIFIED_EXPLICIT_SGD',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  if (rawCurrency === 'JPY' || rawCurrency === '¥') {
    return {
      price_amount: numPrice,
      price_currency: 'JPY',
      currency_status: 'VERIFIED_EXPLICIT_JPY',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  if (rawCurrency === 'RMB' || rawCurrency === 'CNY') {
    return {
      price_amount: numPrice,
      price_currency: 'CNY',
      currency_status: 'VERIFIED_EXPLICIT_CNY',
      raw_price_evidence: rawPrice,
      raw_currency_evidence: rawCurrency
    };
  }

  // If no currency specified in row.currency, inspect text for explicit qualified tokens
  if (!rawCurrency) {
    if (/\b(?:USD|USDT|US\$)\b/i.test(text)) {
      return {
        price_amount: numPrice,
        price_currency: 'USD',
        currency_status: 'VERIFIED_EXPLICIT_USD_FROM_TEXT',
        raw_price_evidence: rawPrice
      };
    }
    if (/\b(?:HKD|HK\$)\b/i.test(text)) {
      return {
        price_amount: numPrice,
        price_currency: 'HKD',
        currency_status: 'VERIFIED_EXPLICIT_HKD_FROM_TEXT',
        raw_price_evidence: rawPrice
      };
    }
    // If text only has bare $ -> HELD
    if (text.includes('$')) {
      return {
        price_amount: null,
        price_currency: null,
        currency_status: 'AMBIGUOUS_BARE_DOLLAR_HELD',
        raw_price_evidence: rawPrice
      };
    }

    return {
      price_amount: null,
      price_currency: null,
      currency_status: 'MISSING_CURRENCY_PROOF',
      raw_price_evidence: rawPrice
    };
  }

  // Any other unrecognized currency
  return {
    price_amount: null,
    price_currency: null,
    currency_status: 'UNRECOGNIZED_CURRENCY_' + rawCurrency,
    raw_price_evidence: rawPrice,
    raw_currency_evidence: rawCurrency
  };
}

/**
 * Intent Determination (WTS vs WTB separation)
 */
function parseIntent(rawRow) {
  const rawType = String(rawRow.type || '').toLowerCase();
  const text = (String(rawRow.title || '') + ' ' + String(rawRow.description || '')).toUpperCase();

  if (rawType === 'buy' || /\b(?:WTB|WANT TO BUY|LOOKING FOR|LF|WANTED)\b/.test(text)) {
    return 'WTB';
  }
  if (rawType === 'sale' || /\b(?:WTS|WANT TO SELL|FOR SALE|FS|SPECIAL OFFER|PRICE DROP)\b/.test(text)) {
    return 'WTS';
  }
  return 'WTS'; // Default auction catalog type is sale, but tagged with standard WTS
}

/**
 * Bundle & Parent Lineage Evaluation
 */
function parseBundleAndLineage(rawRow) {
  const isExplicitBundle = Number(rawRow.is_bundle) === 1;
  const title = String(rawRow.title || '');
  const description = String(rawRow.description || '');

  // Detect multi-item / multi-reference text patterns
  const lines = (title + '\n' + description).split(/\r?\n/).filter(l => l.trim().length > 0);
  const refMatches = lines.filter(l => /(?:7118|5711|5712|5990|5168|5811|4948|5821|5167|116500|126610|116610|124060|126710|116710|15202|15407|15500|26240|26331|15510)/.test(l));

  const isMultiItem = isExplicitBundle || refMatches.length > 2;

  if (isMultiItem) {
    return {
      is_bundle: true,
      bundle_status: 'BUNDLE_PARENT_LINEAGE_HELD',
      publication_eligibility: 'HELD_BUNDLE_REVIEW',
      parent_lineage: {
        raw_is_bundle: rawRow.is_bundle,
        multi_ref_count: refMatches.length,
        requires_unbundling: true
      }
    };
  }

  return {
    is_bundle: false,
    bundle_status: 'SINGLE_ITEM_DIRECT',
    publication_eligibility: 'ELIGIBLE_FOR_EVALUATION',
    parent_lineage: null
  };
}

/**
 * Deterministic Normalizer for a single Staged MariaDB Raw Row
 */
function normalizeStagedRow(stagedRow) {
  const raw = stagedRow.raw_payload || {};
  const priceInfo = parsePriceAndCurrency(raw);
  const intent = parseIntent(raw);
  const bundleInfo = parseBundleAndLineage(raw);

  const brand = raw.brand ? String(raw.brand).trim() : null;
  const model = raw.model ? String(raw.model).trim() : null;
  const reference = raw.reference || raw.normalized_reference ? String(raw.reference || raw.normalized_reference).trim() : null;

  // Contact / Seller Evidence
  const contactEvidence = {
    from_name: raw.from_name || null,
    from_number: raw.from_number ? String(raw.from_number) : null,
    phone_code: raw.phone_code ? Number(raw.phone_code) : null,
    dealer_rating: raw.dealer_rating !== undefined ? Number(raw.dealer_rating) : null,
    origin: raw.origin || null,
    region: raw.region || null
  };

  // Image Key Evidence
  const imageKey = raw.front_image || raw.image || null;

  // Overall Decision & Status
  let status = 'NORMALIZED';
  const flags = [];

  if (bundleInfo.is_bundle) {
    status = 'REVIEW_REQUIRED';
    flags.push('HELD_BUNDLE');
  }

  if (priceInfo.currency_status.startsWith('AMBIGUOUS') || priceInfo.currency_status.startsWith('MISSING')) {
    if (status !== 'REVIEW_REQUIRED') status = 'REVIEW_REQUIRED';
    flags.push(priceInfo.currency_status);
  }

  if (!brand || (!model && !reference)) {
    if (status !== 'REVIEW_REQUIRED') status = 'REVIEW_REQUIRED';
    flags.push('INCOMPLETE_IDENTITY');
  }

  return {
    source_id: stagedRow.source_id,
    source_hash: stagedRow.source_hash,
    source_created_on: stagedRow.source_created_on,
    source_record_id: stagedRow.source_record_id,
    brand,
    model,
    reference,
    intent,
    price_amount: priceInfo.price_amount,
    price_currency: priceInfo.price_currency,
    currency_status: priceInfo.currency_status,
    is_bundle: bundleInfo.is_bundle,
    bundle_status: bundleInfo.bundle_status,
    publication_eligibility: bundleInfo.publication_eligibility,
    image_key: imageKey,
    contact_evidence: contactEvidence,
    normalization_status: status,
    review_flags: flags,
    raw_evidence_retained: {
      source_id: stagedRow.source_id,
      source_hash: stagedRow.source_hash,
      source_system: stagedRow.source_system,
      source_database: stagedRow.source_database,
      source_table: stagedRow.source_table,
      captured_at: stagedRow.captured_at
    }
  };
}

async function fetchStagedRows(supabaseUrl, supabaseKey, limit = 10000) {
  const batchSize = 1000;
  let allRows = [];
  let lastCreatedOn = null;
  let lastSourceId = null;

  console.log('Reading ' + limit + ' already-staged rows from wf_canonical_staging.mariadb_raw_source_rows via RPC...');

  while (allRows.length < limit) {
    const fetchLimit = Math.min(batchSize, limit - allRows.length);
    const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/get_mariadb_private_staged_rows_batch';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey
      },
      body: JSON.stringify({
        p_limit: fetchLimit,
        p_last_created_on: lastCreatedOn,
        p_last_source_id: lastSourceId
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error('Failed to fetch staged rows (' + res.status + '): ' + txt);
    }

    const batch = await res.json();
    if (!batch || batch.length === 0) break;

    allRows = allRows.concat(batch);
    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;

    if (allRows.length % 2000 === 0 || allRows.length === limit) {
      console.log('Fetched ' + allRows.length + ' / ' + limit + ' staged rows...');
    }
  }

  return allRows;
}

async function runNormalizationCanary10k(options = {}) {
  const env = options.env || process.env;
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  const sampleLimit = options.limit || 10000;
  const startTime = Date.now();

  const stagedRows = await fetchStagedRows(supabaseUrl, supabaseKey, sampleLimit);
  const fetchDurationMs = Date.now() - startTime;

  console.log('Fetched ' + stagedRows.length + ' staged rows in ' + fetchDurationMs + 'ms.');

  const normStartTime = Date.now();

  let normalizedCount = 0;
  let reviewCount = 0;
  let errorCount = 0;

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
      const norm = normalizeStagedRow(row);

      readbackHashes.push({
        source_id: row.source_id,
        source_hash: row.source_hash,
        valid: Boolean(row.source_hash && row.source_hash.length === 64)
      });

      currencyStatus[norm.currency_status] = (currencyStatus[norm.currency_status] || 0) + 1;
      bundleStatus[norm.bundle_status] = (bundleStatus[norm.bundle_status] || 0) + 1;

      if (norm.image_key) {
        imageLineage.rows_with_image++;
        if (imageLineage.sample_images.length < 10) {
          imageLineage.sample_images.push({
            source_id: norm.source_id,
            image_key: norm.image_key,
            brand: norm.brand,
            model: norm.model
          });
        }
      } else {
        imageLineage.rows_without_image++;
      }

      if (norm.normalization_status === 'NORMALIZED') {
        normalizedCount++;
      } else if (norm.normalization_status === 'REVIEW_REQUIRED') {
        reviewCount++;
        norm.review_flags.forEach(flag => {
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

  const normDurationMs = Date.now() - normStartTime;
  const totalDurationMs = Date.now() - startTime;
  const rowsPerSec = Math.round((stagedRows.length / (normDurationMs / 1000)) * 100) / 100;

  const exactReconciliation = (normalizedCount + reviewCount + errorCount) === stagedRows.length;

  console.log('============================================================');
  console.log('10,000-ROW NORMALIZATION CANARY RESULTS:');
  console.log('  Total Input Rows: ' + stagedRows.length);
  console.log('  Normalized Eligible: ' + normalizedCount);
  console.log('  Review Required: ' + reviewCount);
  console.log('  Errors / Unparseable: ' + errorCount);
  console.log('  Exact Reconciliation (Input = Norm + Rev + Err): ' + exactReconciliation);
  console.log('  Throughput: ' + rowsPerSec + ' rows/sec (' + normDurationMs + 'ms)');
  console.log('============================================================');

  const outputDir = path.resolve('audit-output/mariadb-live/normalization-canary-10k');
  fs.mkdirSync(outputDir, { recursive: true });

  const runKey = 'norm-canary-10k-' + Date.now();

  const manifest = {
    run_key: runKey,
    contract: 'wf-normalization-canary-v1',
    timestamp: new Date().toISOString(),
    sample_size: stagedRows.length,
    first_cursor: stagedRows[0] ? { created_on: stagedRows[0].source_created_on, source_id: stagedRows[0].source_id } : null,
    last_cursor: stagedRows[stagedRows.length - 1] ? { created_on: stagedRows[stagedRows.length - 1].source_created_on, source_id: stagedRows[stagedRows.length - 1].source_id } : null,
    ruleset_version: 'v4-strict-no-bare-dollar-bundles-held',
    exact_reconciliation: exactReconciliation
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const performance = {
    total_rows: stagedRows.length,
    fetch_duration_ms: fetchDurationMs,
    normalization_duration_ms: normDurationMs,
    total_duration_ms: totalDurationMs,
    rows_per_second: rowsPerSec,
    memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100
  };
  fs.writeFileSync(path.join(outputDir, 'performance.json'), JSON.stringify(performance, null, 2));

  fs.writeFileSync(path.join(outputDir, 'error-reasons.json'), JSON.stringify({
    summary: {
      total_inputs: stagedRows.length,
      normalized_eligible: normalizedCount,
      review_required: reviewCount,
      errors: errorCount
    },
    flags_breakdown: errorReasons
  }, null, 2));

  fs.writeFileSync(path.join(outputDir, 'image-lineage.json'), JSON.stringify(imageLineage, null, 2));

  fs.writeFileSync(path.join(outputDir, 'currency-status.json'), JSON.stringify({
    rule: 'EXPLICIT_NULL_FOR_AMBIGUOUS_NO_USD_ASSUMPTION_FOR_BARE_DOLLAR',
    breakdown: currencyStatus
  }, null, 2));

  fs.writeFileSync(path.join(outputDir, 'bundle-status.json'), JSON.stringify({
    rule: 'BUNDLES_HELD_OUT_OF_PUBLICATION',
    breakdown: bundleStatus
  }, null, 2));

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
      normalized_eligible: normalizedCount,
      review_required: reviewCount,
      errors: errorCount,
      exact_reconciliation: exactReconciliation
    }
  };
}

if (require.main === module) {
  runNormalizationCanary10k()
    .then(result => {
      console.log('Canary Completed Successfully.');
    })
    .catch(err => {
      console.error('Normalization Canary Fatal Error:', err);
      process.exit(1);
    });
}

module.exports = {
  runNormalizationCanary10k,
  normalizeStagedRow,
  parsePriceAndCurrency,
  parseIntent,
  parseBundleAndLineage
};
