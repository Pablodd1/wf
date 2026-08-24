'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BRANDS = ['Rolex', 'Patek Philippe'];
const CLASSIFICATIONS = ['VERIFIED_IN_NEW_COHORT', 'LEGACY_USD_DEFAULTED', 'BARE_DOLLAR_AMBIGUOUS',
  'CURRENCYLESS_AMOUNT', 'CURRENCYLESS_KM', 'FX_PROVENANCE_MISSING', 'FX_INVALID',
  'MULTIPLE_PRICE_AMBIGUOUS', 'BUNDLE_PRICE_AMBIGUOUS', 'SOURCE_PRICE_CONFLICT',
  'REFERENCE_INVALID', 'REFERENCE_AMBIGUOUS', 'SOURCE_NOT_RECONCILABLE', 'REVIEW_REQUIRED', 'OTHER'];

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function usd(value) {
  return value === null || value === undefined ? 'UNKNOWN'
    : `$${number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function pct(value) {
  return value === null || value === undefined ? 'UNKNOWN' : `${(number(value) * 100).toFixed(2)}%`;
}

function table(headers, rows) {
  const escape = value => String(value ?? 'UNKNOWN').replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [`| ${headers.map(escape).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(escape).join(' | ')} |`)].join('\n');
}

function build(input, generatedAt = new Date().toISOString()) {
  const report = input.report || {};
  const run = report.run || input.completion || {};
  const summaries = report.brand_summary || [];
  const classifications = report.classification_counts || [];
  const census = report.reference_census || [];
  const rating = report.rating_impact || [];
  const extremes = report.extreme_evidence || [];
  const canaries = report.proposed_canaries || [];
  const benchmarks = input.query_benchmarks || [];
  const complete = run.status === 'COMPLETE' || input.completion?.status === 'COMPLETE';
  const canaryBrands = Object.fromEntries(BRANDS.map(brand => [brand,
    canaries.filter(row => row.brand === brand).length]));
  const decision = complete && BRANDS.every(brand => canaryBrands[brand] >= 3)
    ? 'CANARY_READY' : 'NOT_READY';

  const suppliedCounts = new Map(classifications.map(row =>
    [`${row.brand}|${row.price_evidence_classification}`, number(row.count)]));
  const classRows = BRANDS.flatMap(brand => CLASSIFICATIONS.map(classification => ({
    brand, classification, count: suppliedCounts.get(`${brand}|${classification}`) || 0,
    verified: classification === 'VERIFIED_IN_NEW_COHORT',
  })));
  const totalByBrand = Object.fromEntries(BRANDS.map(brand => [brand,
    classRows.filter(row => row.brand === brand).reduce((sum, row) => sum + row.count, 0)]));
  for (const row of classRows) row.share = totalByBrand[row.brand]
    ? row.count / totalByBrand[row.brand] : 0;
  const effectiveClassRows = complete ? classRows : [];

  const source = {
    id: 'qnsa_phase7b_shadow', label: 'QNSA Phase 7B private verified-price shadow run', type: 'database',
    query: {
      engine: 'PostgreSQL', language: 'sql',
      description: 'Bounded immutable-source reconciliation and exact-reference materialization in the private price_research_shadow schema.',
      tables_used: ['staging.listings', 'public.raw_message_versions', 'price_research_shadow.observations',
        'price_research_shadow.reference_census', 'price_research_shadow.price_rating_impact'],
      filters: ['Rolex and Patek Philippe', 'WTS priced legacy Price Research observations',
        'exact canonical reference', 'parser-v5 immutable-evidence contract'],
      metric_definitions: {
        verified_observation: 'WTS observation with immutable lineage, exact source span, explicit amount and currency, exact canonical reference, and approved dated FX when required.',
        total_listings: 'Distinct currently published single-watch WTS plus WTB after duplicate, superseded, suppressed, and bundle exclusions.',
        analytics_ready: 'At least two source-qualified observations after unchanged 3.0x IQR handling.',
      },
    },
  };

  const artifact = {
    surface: 'report',
    manifest: {
      version: 1,
      title: 'WATCHFACTS Phase 7B — Verified Price Research Rebuild',
      surface: 'report', generatedAt,
      description: 'Private, inactive shadow reconciliation of Rolex and Patek Price Research evidence.',
      sources: [source],
      charts: [{
        id: 'classification_mix', title: 'Verified and excluded Price Research evidence by brand',
        subtitle: 'Counts retain the full legacy observation denominator; only immutable-evidence reconciled rows are verified.',
        dataset: 'classification_mix', type: 'bar',
        encodings: {
          x: { field: 'count', type: 'quantitative' },
          y: { field: 'classification', type: 'nominal' },
          color: { field: 'brand', type: 'nominal' },
        },
        options: { orientation: 'horizontal', grouping: 'grouped', fullWidth: true, labels: true },
        source,
      }],
      tables: [{
        id: 'reference_census', title: 'Customer-safe exact-reference census', dataset: 'reference_census',
        columns: [
          { field: 'brand', label: 'Brand', type: 'string' },
          { field: 'canonical_reference', label: 'Reference', type: 'string' },
          { field: 'total_published_listings', label: 'Total listings', type: 'number' },
          { field: 'wts_listings', label: 'WTS', type: 'number' },
          { field: 'wtb_listings', label: 'WTB', type: 'number' },
          { field: 'legacy_pr_observations', label: 'Legacy PR', type: 'number' },
          { field: 'verified_pr_observations', label: 'Verified PR', type: 'number' },
        ], source,
      }],
      datasets: {
        classification_mix: effectiveClassRows,
        reference_census: complete ? census : [],
        rating_impact: complete ? rating : [],
        proposed_canaries: complete ? canaries : [],
        query_benchmarks: complete ? benchmarks : [],
      },
    },
  };

  const verifiedByBrand = Object.fromEntries(BRANDS.map(brand => [brand,
    number(summaries.find(row => row.brand === brand)?.verified_observations)]));
  const refsByBrand = Object.fromEntries(BRANDS.map(brand => [brand,
    census.filter(row => row.brand === brand).length]));
  const representedRefsByBrand = Object.fromEntries(BRANDS.map(brand => [brand,
    number(summaries.find(row => row.brand === brand)?.customer_safe_references)]));
  const status = [
    ['Currency/price recognition', complete ? 'SHADOW VERIFIED; CUSTOMER SOURCE UNCHANGED' : 'NOT READY — production run not complete'],
    ['Price Research accuracy', complete ? 'SHADOW MEASURED; CONTROLLED SWITCH NOT AUTHORIZED' : 'NOT READY'],
    ['Multi-location selection', 'UNCHANGED / OUT OF PHASE 7B SCOPE'],
    ['Complete location facet', 'UNCHANGED / OUT OF PHASE 7B SCOPE'],
    ['Total listings per reference', complete ? 'SHADOW CENSUS BUILT; UI NOT SWITCHED' : 'NOT READY'],
    ['WTS/WTB counts per reference', complete ? 'SHADOW CENSUS BUILT; UI NOT SWITCHED' : 'NOT READY'],
    ['Raw message preserved/collapsed', 'PRESERVED; UI UNCHANGED'],
    ['Quick-scroll navigation', 'UNCHANGED / OUT OF PHASE 7B SCOPE'],
    ['Price rating accuracy', complete ? 'SHADOW IMPACT MEASURED; UI NOT SWITCHED' : 'NOT READY'],
    ['Brand/model/reference correction workflow', complete ? 'EXACT-REFERENCE SHADOW FOUNDATION BUILT' : 'IMPLEMENTED, PRODUCTION VALIDATION PENDING'],
  ];

  const md = [
    '# WATCHFACTS Phase 7B — Verified Price Research Rebuild',
    '', `Decision: **${decision}**`, '',
    complete
      ? 'The private shadow run completed without switching any customer endpoint. The verified counts below require immutable-source reconciliation and are not Phase 7A metadata upper bounds.'
      : 'The implementation is reviewable, but no complete canonical-QNSA shadow run is present in this input. Production counts remain **UNKNOWN** and no switch can be authorized.',
    '', '## Authoritative shadow counts', '',
    table(['Brand', 'Verified observations', 'Catalog-safe references', 'Represented safe references', 'Legacy observations'], BRANDS.map(brand => {
      const summary = summaries.find(row => row.brand === brand) || {};
      return [brand, complete ? verifiedByBrand[brand] : 'UNKNOWN', complete ? refsByBrand[brand] : 'UNKNOWN',
        complete ? representedRefsByBrand[brand] : 'UNKNOWN',
        complete ? number(summary.total_legacy_pr_observations) : 'UNKNOWN'];
    })),
    '', '## Evidence classifications', '',
    effectiveClassRows.length ? table(['Brand', 'Classification', 'Count', 'Share'], effectiveClassRows.map(row =>
      [row.brand, row.classification, row.count, pct(row.share)])) : 'No completed production classification result was supplied.',
    '', '## Reference-level census and analytics', '',
    complete && census.length ? table(['Brand', 'Reference', 'Total', 'WTS', 'WTB', 'Priced', 'Images', 'Legacy PR', 'Verified PR',
      'Current median', 'Verified median', 'Current ready', 'Verified ready'], census.map(row => [row.brand,
      row.canonical_reference, row.total_published_listings, row.wts_listings, row.wtb_listings, row.priced_listings,
      row.image_linked_listings, row.legacy_pr_observations, row.verified_pr_observations, usd(row.current_median),
      usd(row.verified_median), row.current_analytics_ready, row.verified_analytics_ready]))
      : 'Production reference counts and analytics remain UNKNOWN until the private shadow run completes.',
    '', '## Extreme-value evidence', '',
    complete && extremes.length ? table(['Brand', 'Reference', 'Current USD', 'Verified USD', 'Evidence classification', 'Finding'],
      extremes.map(row => [row.brand, row.canonical_reference, usd(row.current_usd_amount), usd(row.verified_usd_amount),
        row.price_evidence_classification, row.extreme_classification]))
      : 'No completed extreme-value evidence result was supplied.',
    '', '## Price-rating shadow impact', '',
    complete && rating.length ? table(['Brand', 'Impact', 'Listings'], rating.map(row => [row.brand, row.impact_class, row.count]))
      : 'Price-rating impact remains UNKNOWN until the private shadow run completes.',
    '', '## Query performance', '',
    complete && benchmarks.length ? table(['Brand', 'Reference', 'Elapsed ms'], benchmarks.map(row =>
      [row.brand, row.reference, row.elapsed_ms])) : 'No completed exact-reference benchmark was supplied.',
    '', '## Reconciliation controls', '',
    `- Run key: ${run.run_key || input.run_key || 'UNKNOWN'}`,
    `- Source observation count: ${complete ? number(run.source_observation_count) : 'UNKNOWN'}`,
    `- Processed observation count: ${complete ? number(run.processed_observation_count || input.completion?.observations) : 'UNKNOWN'}`,
    `- Verified observation count: ${complete ? number(run.verified_observation_count || input.completion?.verified) : 'UNKNOWN'}`,
    `- Result SHA-256: ${complete ? (run.result_sha256 || input.completion?.result_sha256 || 'UNKNOWN') : 'UNKNOWN'}`,
    `- Catalog SHA-256: ${input.catalog_sha256 || 'UNKNOWN'}`,
    `- Checkpointed batches: ${Object.values(input.brands || {}).reduce((sum, row) => sum + number(row.batches), 0)}`,
    `- Publication contract: QNSA_GENERAL_MARKET_FEED_V1_SINGLE_WATCH_WTS_WTB`,
    '', '## Proposed controlled-switch references', '',
    complete && canaries.length ? table(['Brand', 'Reference', 'Current observations', 'Verified observations', 'Median delta'],
      canaries.map(row => [row.brand, row.canonical_reference, row.current_observation_count,
        row.verified_observation_count, pct(row.median_delta_ratio)])) : 'None. A controlled switch is not authorized.',
    '', '## Original product requirements', '', table(['Original requirement', 'Status'], status),
    '', '## Method and limitations', '',
    '- Existing normalized and raw records are historical inputs and are never rewritten by this layer.',
    '- Only parser-v5 exact source evidence with an explicit currency and approved dated FX enters the verified cohort.',
    '- The census uses one explicit publication contract and never labels Price Research observations as Total Listings.',
    '- Analytics retain the existing 3.0x IQR formula and minimum comparable requirement.',
    '- Customer endpoints, cards, UI/UX, dealer fields, locations, images, and navigation remain unchanged.',
    '', '## Next step', '',
    decision === 'CANARY_READY'
      ? 'Review the proposed references, then separately authorize a 3–5-reference-per-brand controlled endpoint canary.'
      : 'Install and run the private shadow workflow on canonical QNSA, review its sanitized artifact, and reassess canary readiness.',
    '', '**NO EXISTING NORMALIZED PRICE WAS MODIFIED.**', '', '**NO RAW DATA WAS MODIFIED.**', '',
    '**NO CUSTOMER-FACING DATA SOURCE WAS SWITCHED.**', '', '**NO UI/UX WAS MODIFIED.**', '',
    '**NO EVIDENCE STANDARD WAS RELAXED.**', '',
  ].join('\n');

  const audit = {
    phase: '7B', generated_at: generatedAt, decision, run_key: run.run_key || input.run_key || null,
    complete, catalog_sha256: input.catalog_sha256 || null, result_sha256: run.result_sha256 || input.completion?.result_sha256 || null,
    verified_observations: complete ? verifiedByBrand : Object.fromEntries(BRANDS.map(brand => [brand, null])),
    customer_safe_reference_counts: complete ? refsByBrand : Object.fromEntries(BRANDS.map(brand => [brand, null])),
    represented_customer_safe_reference_counts: complete ? representedRefsByBrand
      : Object.fromEntries(BRANDS.map(brand => [brand, null])),
    classifications: effectiveClassRows, rating_impact: complete ? rating : [], proposed_canaries: complete ? canaries : [],
    query_benchmarks: benchmarks, production_mutations: 0, customer_source_switches: 0, ui_changes: 0,
  };
  return { report: md, audit, artifact, decision };
}

function main() {
  const inputPath = path.resolve(process.env.PHASE7B_INPUT || process.argv[2] || '');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('PHASE7B_INPUT must point to a completed sanitized worker JSON file');
  const outputDir = path.resolve(process.env.PHASE7B_REPORT_DIR || process.argv[3] || 'audit-output/phase7b-verified-price-shadow');
  const built = build(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'report.md'), `${built.report}\n`);
  fs.writeFileSync(path.join(outputDir, 'audit.json'), `${JSON.stringify(built.audit, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'artifact.json'), `${JSON.stringify(built.artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output_dir: outputDir, decision: built.decision })}\n`);
}

module.exports = { build, table };
if (require.main === module) main();
