#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'audit-output/phase6a-patek-second-brand-pilot');
const ranking = JSON.parse(fs.readFileSync(path.join(OUT, 'reference-ranking.json'), 'utf8'));
const discovery = JSON.parse(fs.readFileSync(path.join(OUT, 'wts-discovery.json'), 'utf8'));
const rolex = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit-output/phase4b-rolex-wts-price-research-canary/discovery.json'), 'utf8'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const pct = (part, total) => total ? Number((part * 100 / total).toFixed(2)) : 0;

const pilotOrder = ['5712/1A-001', '5167/1A-001', '5167R-001', '5968A-001', '5726A-001'];
const byRef = new Map(ranking.ranked_references.map(row => [row.reference, row]));
const pilots = pilotOrder.map(reference => {
  const metric = byRef.get(reference);
  const screened = discovery.references[reference];
  return {
    reference,
    model: metric.model,
    candidate_score: metric.candidate_score,
    active_rows: metric.active_rows,
    wts: metric.wts,
    wtb: metric.wtb,
    trading_floor_published: metric.tf_published,
    price_research_source_rows: metric.pr_source_rows,
    price_research_qualified_wts: metric.pr_qualified,
    analytics_ready: metric.pr_qualified >= 2,
    missing_usd_wts_screened: screened.screened,
    safe: screened.safe,
    review: screened.review,
    unresolved: screened.unresolved,
    exclusion_reasons: screened.reasons,
  };
});
const strictCanonical = {
  active_rows: ranking.ranked_references.reduce((sum, row) => sum + Number(row.active_rows || 0), 0),
  wts: ranking.ranked_references.reduce((sum, row) => sum + Number(row.wts || 0), 0),
  trading_floor_published: ranking.ranked_references.reduce((sum, row) => sum + Number(row.tf_published || 0), 0),
  price_research_source_rows: ranking.ranked_references.reduce((sum, row) => sum + Number(row.pr_source_rows || 0), 0),
  price_research_qualified_wts: ranking.ranked_references.reduce((sum, row) => sum + Number(row.pr_qualified || 0), 0),
};

const patekTotal = discovery.input.rows;
const patekContractAuto = discovery.parser_quality.contract_auto_approved_rows;
const rolexTotal = Number(rolex.population.wts_missing_usd);
const rolexBundle = Number(rolex.review_reasons.MULTIPLE_OR_BUNDLE_SOURCE_CONTEXT || 0) + Number(rolex.review_reasons.PARSER_BUNDLE_PRICE_AMBIGUITY || 0);
const rolexFx = Number(rolex.review_reasons.DATED_FX_UNAVAILABLE || 0);
const comparison = [
  { metric: 'Explicit-currency rate', patek_count: discovery.parser_quality.rows_with_explicit_currency, patek_rate: pct(discovery.parser_quality.rows_with_explicit_currency, patekTotal), rolex_count: 'UNKNOWN', rolex_rate: 'UNKNOWN', note: 'Rolex Phase 4B did not preserve a comparable explicit-currency aggregate.' },
  { metric: 'Parser AUTO_APPROVED rate', patek_count: patekContractAuto, patek_rate: pct(patekContractAuto, patekTotal), rolex_count: rolexFx, rolex_rate: pct(rolexFx, rolexTotal), note: 'Rows reaching the safe contract before FX validation.' },
  { metric: 'Review-required rate', patek_count: discovery.summary.review, patek_rate: pct(discovery.summary.review, patekTotal), rolex_count: rolex.classifications.REVIEW_REQUIRED, rolex_rate: pct(rolex.classifications.REVIEW_REQUIRED, rolexTotal) },
  { metric: 'Unresolved rate', patek_count: discovery.summary.unresolved, patek_rate: pct(discovery.summary.unresolved, patekTotal), rolex_count: rolex.classifications.UNRESOLVED, rolex_rate: pct(rolex.classifications.UNRESOLVED, rolexTotal) },
  { metric: 'Multiple-price rate', patek_count: discovery.counts.REVIEW_MULTIPLE_PRICE, patek_rate: pct(discovery.counts.REVIEW_MULTIPLE_PRICE, patekTotal), rolex_count: rolex.review_reasons.MULTIPLE_PRICE_CANDIDATES, rolex_rate: pct(rolex.review_reasons.MULTIPLE_PRICE_CANDIDATES, rolexTotal) },
  { metric: 'Bundle rate', patek_count: discovery.counts.REVIEW_BUNDLE, patek_rate: pct(discovery.counts.REVIEW_BUNDLE, patekTotal), rolex_count: rolexBundle, rolex_rate: pct(rolexBundle, rolexTotal) },
  { metric: 'FX-blocked rate', patek_count: discovery.parser_quality.fx_blocked_rows, patek_rate: pct(discovery.parser_quality.fx_blocked_rows, patekTotal), rolex_count: rolexFx, rolex_rate: pct(rolexFx, rolexTotal) },
  { metric: 'Safe WTS recovery rate', patek_count: discovery.summary.safe, patek_rate: pct(discovery.summary.safe, patekTotal), rolex_count: 0, rolex_rate: 0 },
];

const census = {
  active_staging_listings: ranking.census.total_active,
  wts: ranking.census.wts,
  wtb: ranking.census.wtb,
  rows_with_exact_source_identifiers: ranking.census.rows_with_exact_source_identifier,
  distinct_source_identifiers: 'UNKNOWN',
  rows_with_immutable_raw_version_identifiers: ranking.census.rows_with_immutable_raw_version_identifier,
  distinct_raw_version_identifiers: 'UNKNOWN',
  populated_model_rows: ranking.census.populated_model_rows,
  populated_model_count: ranking.census.populated_model_count,
  distinct_reference_values: ranking.census.distinct_reference_values,
  valid_customer_safe_canonical_references: ranking.valid_customer_safe_reference_count,
  original_price_count: ranking.census.original_price_count,
  normalized_usd_price_count: ranking.census.normalized_usd_price_count,
  missing_normalized_usd_with_structured_source_price: ranking.census.missing_normalized_usd_with_structured_source_price,
  trading_floor_published: ranking.census.trading_floor_published_base + 2,
  trading_floor_base: ranking.census.trading_floor_published_base,
  trading_floor_reviewed_overlay: 2,
  price_research_source_rows: ranking.census.price_research_source_rows_base + 1,
  price_research_source_rows_strict_customer_safe_reference: strictCanonical.price_research_source_rows,
  price_research_qualified_wts_base_all_reference_values: ranking.census.price_research_qualified_wts_base,
  price_research_qualified_wts_strict_customer_safe_reference: strictCanonical.price_research_qualified_wts,
  price_research_qualified_wts_strict_exact_reference: strictCanonical.price_research_qualified_wts,
  price_research_surface_price_rows_including_noncanonical_overlay: ranking.census.price_research_qualified_wts_base + 1,
  analytics_ready_references: ranking.census.analytics_ready_canonical_references_base,
};

const audit = {
  contract: 'watchfacts-phase6a-patek-second-brand-pilot-v1',
  project_ref: 'qnsafosakvonzgfcsphh',
  enabled_run_key: 'mariadb-normalized-20260811-codex-v1',
  generated_at: discovery.generated_at,
  mode: 'READ_ONLY_SHADOW_ONLY',
  transaction_read_only: 'on',
  production_writes: 0,
  census,
  reference_safety: {
    catalog_references: ranking.catalog.references,
    catalog_models: ranking.catalog.models,
    distinct_reference_values: ranking.census.distinct_reference_values,
    taxonomy: ranking.reference_taxonomy_distinct_values,
    valid_customer_safe_reference_count: ranking.valid_customer_safe_reference_count,
    exact_reference_count: ranking.exact_reference_count,
    variant_only_reference_count: ranking.variant_only_reference_count,
    represented_catalog_references: ranking.valid_customer_safe_reference_count,
    catalog_references_not_represented: ranking.catalog.references - ranking.valid_customer_safe_reference_count,
  },
  model_mapping: {
    production_model_rows_populated: 0,
    production_model_values_trustworthy: false,
    audit_side_exact_reference_to_canonical_model_mappings: ranking.valid_customer_safe_reference_count,
    production_backfills: 0,
  },
  pilot_references: pilots,
  discovery: {
    wts_rows_screened: patekTotal,
    counts: discovery.counts,
    safe: discovery.summary.safe,
    review: discovery.summary.review,
    unresolved: discovery.summary.unresolved,
    safe_by_currency: discovery.safe_by_currency,
    expected_pr_qualified: discovery.eligibility.EXPECTED_PR_QUALIFIED,
    safe_not_pr_qualified: discovery.eligibility.SAFE_PRICE_NOT_PR_QUALIFIED,
    parser_quality: discovery.parser_quality,
    reasons: discovery.reasons,
  },
  rolex_vs_patek: {
    warning: 'Directional comparison only: the Patek opportunity-ranked five-reference cohort and the Rolex Phase 4B predefined five-reference cohort are not population-matched.',
    metrics: comparison,
  },
  proposed_production_canary: {
    rows: discovery.selected_rows,
    count: discovery.selected_rows.length,
    maximum: 25,
    status: 'EMPTY_NO_SAFE_ROWS',
  },
  recommendation: 'BLOCKED_NO_SAFE_COHORT',
  limitations: [
    'Distinct source_record_id and raw_message_version_id counts are UNKNOWN because the global DISTINCT query exceeded the bounded production query window; row-level identifier completeness is exactly 126,571 of 126,571.',
    'Production model values are unpopulated, so model mapping is catalog-derived in the audit only and was not written back.',
    'The two reviewed overlay rows use non-canonical partial references (4934G and 5167A); they are counted on the customer surface but not as strict exact-reference Price Research qualifications.',
    'Rolex explicit-currency rate is UNKNOWN in the preserved Phase 4B aggregate and is not inferred.',
  ],
  safeguards: {
    raw_messages_exported: false,
    contact_values_exported: false,
    raw_messages_retained_in_private_input: false,
    production_data_modified: false,
    raw_data_modified: false,
    ui_ux_modified: false,
    evidence_standard_relaxed: false,
  },
  checksums: {
    reference_ranking_sha256: sha256(fs.readFileSync(path.join(OUT, 'reference-ranking.json'))),
    wts_discovery_sha256: sha256(fs.readFileSync(path.join(OUT, 'wts-discovery.json'))),
    proposed_canary_sha256: discovery.selected_rows_sha256,
  },
};

const fmt = value => typeof value === 'number' ? value.toLocaleString('en-US') : value;
const table = (headers, rows) => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}`;
const pilotTable = table(
  ['Reference', 'Model', 'Active', 'WTS', 'WTB', 'TF', 'PR source', 'PR qualified', 'Missing USD screened', 'SAFE', 'REVIEW', 'UNRESOLVED'],
  pilots.map(row => [row.reference, row.model, fmt(row.active_rows), fmt(row.wts), fmt(row.wtb), fmt(row.trading_floor_published), fmt(row.price_research_source_rows), fmt(row.price_research_qualified_wts), row.missing_usd_wts_screened, row.safe, row.review, row.unresolved])
);
const comparisonTable = table(
  ['Metric', 'Patek', 'Patek rate', 'Rolex', 'Rolex rate'],
  comparison.map(row => [row.metric, row.patek_count, `${row.patek_rate}%`, row.rolex_count, row.rolex_rate === 'UNKNOWN' ? 'UNKNOWN' : `${row.rolex_rate}%`])
);
const exclusionText = pilots.map(row => `- **${row.reference}:** ${Object.entries(row.exclusion_reasons).map(([reason, count]) => `${reason} ${count}`).join('; ')}.`).join('\n');

const report = `# WATCHFACTS Phase 6A — Patek Philippe Second-Brand Pilot\n\n## Technical summary\n\n**Recommendation: \`BLOCKED_NO_SAFE_COHORT\`.** The read-only census found ${fmt(census.active_staging_listings)} active Patek staging listings. Parser-v5 screened ${patekTotal} immutable, single-watch WTS rows with missing normalized USD across five opportunity-ranked exact references and found **0 SAFE**, **${discovery.summary.review} REVIEW**, and **${discovery.summary.unresolved} UNRESOLVED**. No production canary is authorized.\n\n## Key findings\n\n![Missing normalized USD WTS screened by pilot reference](chart-reference-opportunity.svg)\n\n- Immutable lineage is complete at row level: ${fmt(census.rows_with_exact_source_identifiers)} of ${fmt(census.active_staging_listings)} rows have source IDs, raw-version IDs, and both required hashes.\n- Production model fields are entirely unpopulated: 0 of ${fmt(census.active_staging_listings)} rows. The audit mapped ${ranking.valid_customer_safe_reference_count} represented canonical references to models without writing back.\n- ${fmt(census.normalized_usd_price_count)} rows have normalized USD. ${census.missing_normalized_usd_with_structured_source_price} rows retain a positive structured source price but lack normalized USD.\n- Customer surface: ${fmt(census.trading_floor_published)} Trading Floor rows including two reviewed overlays; ${fmt(census.price_research_source_rows)} WTS Price Research source rows; ${fmt(census.price_research_qualified_wts_strict_exact_reference)} strict exact-reference qualified WTS observations; ${census.analytics_ready_references} analytics-ready canonical references.\n- Patek is not cleaner than the Rolex Phase 4B baseline for this canary: safe recovery is 0% for both, while Patek has higher multiple-price (${pct(discovery.counts.REVIEW_MULTIPLE_PRICE, patekTotal)}%) and bundle (${pct(discovery.counts.REVIEW_BUNDLE, patekTotal)}%) rates.\n\n## Scope, data, and definitions\n\n- Canonical project: QNSA \`qnsafosakvonzgfcsphh\`; enabled run \`mariadb-normalized-20260811-codex-v1\`.\n- All production SQL ran under \`BEGIN TRANSACTION READ ONLY\`; no mutation statements were used.\n- \`SAFE\` requires WTS intent, exact punctuation-sensitive catalog identity, exact immutable raw lineage, one watch, one unambiguous parser-v5 AUTO_APPROVED amount/currency, NULL normalized USD, and dated approved FX when needed.\n- \`REVIEW\` includes currency review, multiple-price ambiguity, or bundle ambiguity. \`UNRESOLVED\` means no exact AUTO_APPROVED price or missing proof.\n- Broad joins that exceeded the bounded query window were replaced with 16 UUID shards and immutable-ID raw-version lookups.\n\n## Authoritative census\n\n${table(['Metric', 'Count'], Object.entries(census).map(([key, value]) => [key.replaceAll('_', ' '), fmt(value)]))}\n\n## Reference safety and model mapping\n\n${table(['Class', 'Distinct production values'], Object.entries(ranking.reference_taxonomy_distinct_values).map(([key, value]) => [key, fmt(value)]))}\n\n- Catalog: ${ranking.catalog.references} Patek references across ${ranking.catalog.models} canonical model families.\n- Customer-safe represented canonical references: ${ranking.valid_customer_safe_reference_count}; exact value present: ${ranking.exact_reference_count}; variant-only: ${ranking.variant_only_reference_count}.\n- Production model mapping status: **not trustworthy because it is absent**, not because conflicting model values were observed. Audit-side \`exact reference → canonical model\` coverage is ${ranking.valid_customer_safe_reference_count} of ${ranking.valid_customer_safe_reference_count} represented safe references.\n\n## Five pilot references and Price Research parity\n\n${pilotTable}\n\nAll five references are already analytics-ready from existing qualified WTS observations. The 190 missing-USD rows would not enter Price Research under the unchanged evidence contract. Exact current exclusion buckets:\n\n${exclusionText}\n\n## Shadow parser results\n\n${table(['Classification', 'Count'], Object.entries(discovery.counts).map(([key, value]) => [key, value]))}\n\n- Safe by currency: none.\n- Expected Price Research-qualified after a hypothetical NULL-only correction: 0.\n- Safe but not Price Research-qualified: 0.\n- Proposed Phase 6B write cohort: **0 rows** (maximum 25).\n\n## Rolex vs Patek evidence quality\n\n${comparisonTable}\n\nThis is a directional comparison, not a matched-population experiment. The Patek cohort was selected by opportunity score; the Rolex Phase 4B cohort was predefined. Rolex's explicit-currency rate remains UNKNOWN because that aggregate was not preserved and is not inferred.\n\n## Methodology\n\n1. Reused the Rolex active-run, immutable-lineage, parser-v5, dated-FX, and Price Research eligibility contracts.\n2. Counted production in 16 UUID shards to avoid broad timeouts.\n3. Classified all distinct production reference values against the current Patek catalog without partial-reference promotion.\n4. Ranked exact references by missing-USD opportunity, source-price signals, currency support, ambiguity burden, Trading Floor presence, and Price Research potential.\n5. Retrieved only the 190 selected immutable raw-version records, ran parser-v5 locally in shadow, wrote only sanitized evidence, and deleted the temporary private raw input.\n6. Reconciled Trading Floor and Price Research counts per selected reference.\n\n## Limitations and robustness\n\n${audit.limitations.map(item => `- ${item}`).join('\n')}\n\nThe recommendation is robust to the unresolved DISTINCT counts: canary safety depends on row-level immutable lineage and parser evidence, both of which were verified for every screened row.\n\n## Next steps\n\n- Keep Patek automatic WTS corrections blocked.\n- If remediation is authorized later, analyze the 135 currency-review rows, 19 multiple-price rows, six bundle rows, one implausible HKD row, and one FX-unavailable row in separate read-only rule audits.\n- Do not create a production canary until at least 10 rows satisfy the unchanged SAFE contract, preferably across two exact references.\n\n## Further questions\n\n- Should the two non-canonical reviewed overlay references be reconciled to exact catalog identities in a separate read-only identity audit?\n- Should the archive-wide currency-evidence remediation designed after Rolex Phase 5A be tested against this Patek cohort in shadow?\n\n**NO PRODUCTION DATA WAS MODIFIED.**  \n**NO RAW DATA WAS MODIFIED.**  \n**NO UI/UX WAS MODIFIED.**  \n**THE ROLEX EVIDENCE CONTRACT WAS NOT RELAXED.**\n`;

const max = Math.max(...pilots.map(row => row.missing_usd_wts_screened));
const bars = pilots.map((row, index) => {
  const y = 46 + index * 48;
  const width = Math.round(row.missing_usd_wts_screened / max * 520);
  return `<text x="8" y="${y + 17}" font-family="Arial, sans-serif" font-size="14" fill="#20160f">${row.reference}</text><rect x="130" y="${y}" width="${width}" height="24" rx="4" fill="#9a6b26"/><text x="${140 + width}" y="${y + 17}" font-family="Arial, sans-serif" font-size="14" fill="#20160f">${row.missing_usd_wts_screened}</text>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="310" viewBox="0 0 760 310"><rect width="760" height="310" fill="#faf7f2"/><text x="8" y="25" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#20160f">Missing normalized USD WTS screened</text>${bars}<text x="130" y="298" font-family="Arial, sans-serif" font-size="12" fill="#6e6258">Opportunity-ranked exact Patek references; n=${patekTotal}</text></svg>`;

const htmlTable = (headers, rows) => `<table><thead><tr>${headers.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>WATCHFACTS Phase 6A Patek Pilot</title><style>body{font-family:Arial,sans-serif;background:#f4f0e9;color:#20160f;margin:0}.page{max-width:1050px;margin:24px auto;background:#fff;padding:42px 52px;box-shadow:0 3px 18px #0002}h1,h2{font-family:Georgia,serif}h1{font-size:34px}h2{margin-top:34px;color:#6f4a17}code{background:#f4f0e9;padding:2px 5px}table{border-collapse:collapse;width:100%;font-size:12px;margin:14px 0 24px}th,td{border:1px solid #d8cfc2;padding:7px;text-align:left;vertical-align:top}th{background:#eee5d7}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.metric{background:#f8f4ed;border:1px solid #dfd3c3;padding:14px;border-radius:7px}.metric b{display:block;font-size:22px;margin-bottom:4px}.metric span{font-size:12px;color:#665b52}img{max-width:100%}.blocked{background:#6b1f1f;color:#fff;padding:14px 18px;border-radius:7px;font-weight:700}li{margin:5px 0}.note{background:#f8f4ed;border-left:4px solid #9a6b26;padding:12px 16px}</style></head><body><main class="page">
<h1>WATCHFACTS Phase 6A — Patek Philippe Second-Brand Pilot</h1>
<div class="blocked">BLOCKED_NO_SAFE_COHORT — 0 of ${patekTotal} screened rows satisfy the unchanged SAFE contract.</div>
<h2>Technical summary</h2><p>The read-only census found <strong>${fmt(census.active_staging_listings)} active Patek staging listings</strong>. Parser-v5 screened ${patekTotal} immutable, single-watch WTS rows with missing normalized USD across five opportunity-ranked exact references and found <strong>0 SAFE</strong>, <strong>${discovery.summary.review} REVIEW</strong>, and <strong>${discovery.summary.unresolved} UNRESOLVED</strong>. No production canary is authorized.</p>
<div class="metrics"><div class="metric"><b>${fmt(census.active_staging_listings)}</b><span>active staging listings</span></div><div class="metric"><b>${fmt(census.normalized_usd_price_count)}</b><span>normalized USD prices</span></div><div class="metric"><b>${ranking.valid_customer_safe_reference_count}</b><span>represented safe references</span></div><div class="metric"><b>${census.analytics_ready_references}</b><span>analytics-ready references</span></div></div>
<h2>Key finding</h2><img src="chart-reference-opportunity.svg" alt="Missing normalized USD WTS screened by pilot reference"><p>All 190 screened rows have exact immutable raw-version matches. None satisfies the unchanged SAFE price contract.</p>
<h2>Five pilot references and Price Research parity</h2>${htmlTable(['Reference','Model','Active','WTS','WTB','TF','PR source','PR qualified','Screened','SAFE','REVIEW','UNRESOLVED'],pilots.map(row=>[row.reference,row.model,fmt(row.active_rows),fmt(row.wts),fmt(row.wtb),fmt(row.trading_floor_published),fmt(row.price_research_source_rows),fmt(row.price_research_qualified_wts),row.missing_usd_wts_screened,row.safe,row.review,row.unresolved]))}
<h2>Shadow parser result</h2>${htmlTable(['Classification','Count'],Object.entries(discovery.counts).map(([key,value])=>[key,value]))}
<h2>Rolex vs Patek</h2>${htmlTable(['Metric','Patek','Patek rate','Rolex','Rolex rate'],comparison.map(row=>[row.metric,row.patek_count,`${row.patek_rate}%`,row.rolex_count,row.rolex_rate==='UNKNOWN'?'UNKNOWN':`${row.rolex_rate}%`]))}<p class="note">Directional comparison only: the cohorts are not population-matched. Rolex explicit-currency rate remains UNKNOWN and was not inferred.</p>
<h2>Safeguards</h2><ul><li>Production writes: 0</li><li>Raw-message mutations: 0</li><li>UI/UX changes: 0</li><li>Temporary private raw input retained: no</li><li>Rolex evidence contract relaxed: no</li></ul>
<h2>Recommendation</h2><p><strong>Keep Patek automatic WTS correction blocked.</strong> A future canary requires 10–25 genuinely SAFE rows, preferably across at least two exact references. Current proposed cohort: 0 rows.</p>
</main></body></html>`;

fs.writeFileSync(path.join(OUT, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, 'report.md'), report);
fs.writeFileSync(path.join(OUT, 'chart-reference-opportunity.svg'), svg);
fs.writeFileSync(path.join(OUT, 'report.html'), html);
const artifactFiles = ['audit.json', 'reference-ranking.json', 'wts-discovery.json', 'report.md', 'report.html', 'chart-reference-opportunity.svg'];
if (fs.existsSync(path.join(OUT, 'report-render.png'))) artifactFiles.push('report-render.png');
const manifest = {
  contract: 'watchfacts-phase6a-patek-second-brand-pilot-manifest-v1',
  files: artifactFiles.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(OUT, file))) })),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ recommendation: audit.recommendation, census, discovery: audit.discovery, pilot_references: pilots.map(row => row.reference), report: path.join(OUT, 'report.md') }, null, 2)}\n`);
