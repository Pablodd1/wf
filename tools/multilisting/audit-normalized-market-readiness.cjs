'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { comparisonKey, normalizeDialValue } = require('../../api/_lib/dial-normalization.cjs');
const { marketPlausibilityFloor, summarizePrices } = require('../../api/_lib/market-stats.cjs');
const { deduplicateReposts } = require('../../api/_lib/repost-deduplication.cjs');

const CRITICAL_REFERENCES = new Map([
  ['5712/1A', 'PATEK PHILIPPE'],
  ['5712/1R', 'PATEK PHILIPPE'],
  ['3712/1A', 'PATEK PHILIPPE'],
  ['116500LN', 'ROLEX'],
  ['52506', 'ROLEX'],
]);

function criticalReferenceFamily(reference, brand) {
  const normalized = String(reference || '').trim().toUpperCase();
  const normalizedBrand = String(brand || '').trim().toUpperCase();
  for (const [target, expectedBrand] of CRITICAL_REFERENCES) {
    if (normalizedBrand === expectedBrand
      && (normalized === target || normalized.startsWith(`${target}-`))) return target;
  }
  return null;
}

function summarizeComparablePrices(prices) {
  const validPrices = prices.map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  const marketPriceFloorUsd = marketPlausibilityFloor(validPrices);
  const plausiblePrices = validPrices.filter(value => value >= marketPriceFloorUsd);
  return {
    marketPriceFloorUsd,
    floorExcludedCount: validPrices.length - plausiblePrices.length,
    summary: summarizePrices(plausiblePrices),
  };
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function csv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function marketCandidate(row) {
  return row.review_bucket === 'review-ready'
    && row.listing_type === 'WTS'
    && row.exact_raw_lineage === true
    && row.catalog_confirmed === true
    && row.catalog_dial_confirmed === true
    && Number.isFinite(Number(row.price_usd))
    && Number(row.price_usd) > 0
    && Boolean(row.price_currency)
    && (!Array.isArray(row.blockers) || row.blockers.length === 0);
}

async function audit(normalizedDir, outputDir) {
  const report = JSON.parse(fs.readFileSync(path.join(normalizedDir, 'report.json'), 'utf8'));
  fs.mkdirSync(outputDir, { recursive: true });
  const references = new Map();
  const cohorts = new Map();
  let rowsRead = 0;
  let candidateRows = 0;

  for (const file of report.files || []) {
    const input = readline.createInterface({ input: fs.createReadStream(file.path), crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      rowsRead += 1;
      const brand = String(row.brand || 'Unknown').trim() || 'Unknown';
      const reference = String(row.reference || 'Unknown').trim() || 'Unknown';
      const referenceKey = `${brand.toUpperCase()}|${reference.toUpperCase()}`;
      const aggregate = references.get(referenceKey) || {
        brand, reference, total: 0, intents: {}, buckets: {}, marketCandidates: 0,
        dialCohorts: 0, analyticsReadyDialCohorts: 0,
      };
      aggregate.total += 1;
      increment(aggregate.intents, row.listing_type || 'UNRESOLVED');
      increment(aggregate.buckets, row.review_bucket || 'unknown');
      references.set(referenceKey, aggregate);

      if (!marketCandidate(row)) continue;
      candidateRows += 1;
      aggregate.marketCandidates += 1;
      const dial = normalizeDialValue(row.dial_color);
      if (!dial.known) continue;
      const cohortKey = `${referenceKey}|${comparisonKey(dial.value)}`;
      const cohort = cohorts.get(cohortKey) || {
        brand, reference, dial_color: dial.value, candidates: [], condition_counts: {}, rows: 0,
      };
      cohort.rows += 1;
      cohort.candidates.push({
        id: row.listing_id,
        brand,
        reference,
        dial_color: dial.value,
        condition: row.condition,
        price_usd: Number(row.price_usd),
        raw_message: row.raw_line,
        created_at: row.source_created_at,
      });
      increment(cohort.condition_counts, String(row.condition || 'Unknown').trim() || 'Unknown');
      cohorts.set(cohortKey, cohort);
    }
  }

  const cohortRows = [...cohorts.values()].map(cohort => {
    const { uniqueRows, repostRows } = deduplicateReposts(cohort.candidates);
    const comparable = summarizeComparablePrices(uniqueRows.map(row => row.price_usd));
    const summary = comparable.summary;
    return {
      brand: cohort.brand,
      reference: cohort.reference,
      dial_color: cohort.dial_color,
      candidate_count: cohort.rows,
      deduplicated_count: uniqueRows.length,
      repost_excluded_count: repostRows.length,
      plausibility_floor_usd: comparable.marketPriceFloorUsd,
      plausibility_excluded_count: comparable.floorExcludedCount,
      condition_counts: cohort.condition_counts,
      analytics_ready: summary.analytics_ready,
      sample_quality: summary.sample_quality,
      included_count: summary.included.length,
      outlier_count: summary.outliers.length,
      stats: summary.analytics_ready ? summary.stats : null,
    };
  }).sort((left, right) => right.candidate_count - left.candidate_count
    || left.brand.localeCompare(right.brand)
    || left.reference.localeCompare(right.reference)
    || left.dial_color.localeCompare(right.dial_color));

  for (const cohort of cohortRows) {
    const key = `${cohort.brand.toUpperCase()}|${cohort.reference.toUpperCase()}`;
    const aggregate = references.get(key);
    aggregate.dialCohorts += 1;
    if (cohort.analytics_ready) aggregate.analyticsReadyDialCohorts += 1;
  }

  const referenceRows = [...references.values()].sort((left, right) => right.total - left.total
    || left.brand.localeCompare(right.brand) || left.reference.localeCompare(right.reference));
  const critical = referenceRows
    .filter(row => criticalReferenceFamily(row.reference, row.brand))
    .map(row => ({ ...row, critical_family: criticalReferenceFamily(row.reference, row.brand) }));
  const summary = {
    generatedAt: new Date().toISOString(),
    normalizedDir: path.resolve(normalizedDir),
    rowsRead,
    distinctBrandReferences: referenceRows.length,
    marketCandidateRows: candidateRows,
    dialCohorts: cohortRows.length,
    analyticsReadyDialCohorts: cohortRows.filter(row => row.analytics_ready).length,
    referencesWithAnalyticsReadyDial: referenceRows.filter(row => row.analyticsReadyDialCohorts > 0).length,
    bundleRowsExcluded: report.counts?.bucket?.['held-multi-watch'] || 0,
    minimumSample: 5,
    groupingRule: 'brand + reference + normalized dial; all conditions combined by default',
    publicationRule: 'review candidates only; no row is public until individual human approval',
    criticalReferences: critical,
  };

  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'references.json'), `${JSON.stringify(referenceRows, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'dial-cohorts.json'), `${JSON.stringify(cohortRows, null, 2)}\n`);
  const csvRows = ['brand,reference,dial_color,candidate_count,deduplicated_count,repost_excluded_count,plausibility_floor_usd,plausibility_excluded_count,included_count,outlier_count,analytics_ready,sample_quality,condition_counts'];
  for (const row of cohortRows) {
    csvRows.push([
      row.brand, row.reference, row.dial_color, row.candidate_count, row.deduplicated_count,
      row.repost_excluded_count, row.plausibility_floor_usd, row.plausibility_excluded_count,
      row.included_count, row.outlier_count, row.analytics_ready, row.sample_quality,
      JSON.stringify(row.condition_counts),
    ].map(csv).join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'dial-cohorts.csv'), `${csvRows.join('\n')}\n`);
  return summary;
}

async function main() {
  const normalizedDir = path.resolve(process.env.UNBUNDLED_NORMALIZED_OUTPUT || process.argv[2] || 'audit-output/unbundled/batch-002-normalized-v14');
  const outputDir = path.resolve(process.env.UNBUNDLED_MARKET_AUDIT_OUTPUT || process.argv[3] || path.join(normalizedDir, 'market-readiness'));
  const result = await audit(normalizedDir, outputDir);
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_market_readiness_audit', outputDir, ...result })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'unbundled_market_readiness_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { audit, criticalReferenceFamily, marketCandidate, summarizeComparablePrices };
