#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'audit-output/phase7a-existing-price-trust');
const audit = JSON.parse(fs.readFileSync(path.join(OUT, 'audit.json'), 'utf8'));
const fmt = value => typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(value ?? 'UNKNOWN');
const pct = value => `${(Number(value || 0) * 100).toFixed(2)}%`;
const table = (headers, rows) => `${headers.join(' | ')}\n${headers.map(() => '---').join(' | ')}\n${rows.map(row => row.join(' | ')).join('\n')}`;

const censusRows = audit.census.map(row => {
  const canonical = audit.canonical_reference_summary[row.brand];
  return [row.brand, fmt(row.active), fmt(row.wts), fmt(row.wtb), fmt(row.source_price), fmt(row.normalized_usd), fmt(row.tf_priced), fmt(row.pr_source), fmt(row.pr_current_qualified), fmt(row.pr_verified_only), pct(Number(row.pr_verified_only) / Number(row.pr_current_qualified)), fmt(canonical.current_ready), fmt(canonical.verified_ready)];
});

const provenanceRows = audit.provenance.map(row => [row.brand, row.provenance_class, fmt(row.all_rows), fmt(row.pr_rows)]);
const impactRows = audit.analytics_high_impact.map(row => {
  const medianDelta = row.current_median && row.verified_median ? (Number(row.verified_median) / Number(row.current_median) - 1) : null;
  const meanDelta = row.current_mean && row.verified_mean ? (Number(row.verified_mean) / Number(row.current_mean) - 1) : null;
  return [row.brand, row.reference, fmt(row.current_count), fmt(row.verified_count), fmt(row.current_median), fmt(row.verified_median), medianDelta == null ? 'UNKNOWN' : pct(medianDelta), fmt(row.current_mean), fmt(row.verified_mean), meanDelta == null ? 'UNKNOWN' : pct(meanDelta), `${fmt(row.current_min)}–${fmt(row.current_max)}`, `${fmt(row.verified_min)}–${fmt(row.verified_max)}`];
});

const parserRows = Object.entries(audit.parser_v5_shadow.summary).map(([key, count]) => {
  const [brand, sourceClass, classification] = key.split('|');
  return [brand, sourceClass, classification, fmt(count)];
});

const canonicalRows = audit.canonical_references.map(row => [row.brand, row.model, row.reference, fmt(row.current_qualified), fmt(row.verified_source_backed), fmt(row.review_required), fmt(row.unsupported), fmt(row.unresolved), row.trusted_observation_rate == null ? 'N/A' : pct(row.trusted_observation_rate), row.current_analytics_ready ? 'YES' : 'NO', row.verified_analytics_ready ? 'YES' : 'NO']);

const report = `# WATCHFACTS Phase 7A — Existing Price Integrity & Price Research Trust Audit

## Decision

**Combined recommendation: \`PRICE_RESEARCH_REBUILD_REQUIRED\`.** Rolex requires a Price Research rebuild; Patek Philippe requires partial remediation before its analytics can be called trustworthy. The dominant issue is unreliable existing price evidence, not missing normalized prices.

- Rolex: 105,866 of 157,495 current Price Research observations use retired \`usd_defaulted_by_policy\` evidence. Stored-evidence trust is 32.78% globally and 34.25% across customer-safe canonical references.
- Patek Philippe: 14,927 of 72,305 current observations use the same retired evidence. Stored-evidence trust is 79.35% globally and 79.77% across canonical references.
- Missing USD is comparatively small: 515 Rolex rows and 182 Patek rows have source price but no \`price_usd\`, versus 120,793 current WTS observations needing review because of legacy defaulting.
- A bounded parser-v5 recheck did not validate any of the 50 sampled legacy-defaulted rows. It also found six stored-price conflicts among 50 rows labeled source-evidenced, proving stored provenance alone is only an upper bound on trust.

## Authoritative live inventory

${table(['Brand','Active','WTS','WTB','Source price','USD normalized','TF priced','PR source','PR current qualified','PR stored-evidence verified','Trusted rate','Current ready refs','Verified-only ready refs'], censusRows)}

Definitions are preserved: \`price_usd > 0\` defines normalized USD and a priced Trading Floor row; Price Research source is WTS; current qualified excludes \`suppressed_exact_duplicate\`; canonical analytics use only exact or uniquely collapsed catalog identities.

## Existing normalized-price provenance

${table(['Brand','Provenance class','All normalized rows','Current PR rows'], provenanceRows)}

No existing non-null value was changed. \`SOURCE_EXPLICIT_*\` and dated-FX classes are retained as source-evidenced candidates; \`LEGACY_USD_DEFAULTED\` is review-required under the current contract.

## Parser-v5 immutable-source shadow recheck

${table(['Brand','Stored class','Parser-v5 outcome','Rows'], parserRows)}

The deterministic cohort contained 25 legacy-defaulted and 25 source-evidenced WTS Price Research rows per brand. Every row was joined by listing ID, source record ID, raw-version ID, and source hash; raw text was not retained. Results are sample evidence, not population estimates.

## Reference-level analytics impact

- Rolex canonical references represented: 287; 271 have a verified/current count ratio below 90%; analytics-ready references fall from 278 to 262.
- Patek canonical references represented: 419; 199 fall below 90%; analytics-ready references fall from 370 to 364.
- The table below shows exact verified-only statistic recomputation for the five highest-review references per brand. Broad all-reference percentile queries timed out, so all-reference medians and means remain intentionally unclaimed.

${table(['Brand','Reference','Current n','Verified n','Current median','Verified median','Median Δ','Current mean','Verified mean','Mean Δ','Current min–max','Verified min–max'], impactRows)}

The extreme maxima (for example Rolex 228235 at $606,000,000 and 126300 at $116,000,000) materially distort current means. Even the stored-evidence subset retains implausible minima such as $1–$18 in some references, so plausibility and parser-v5 source agreement must remain separate gates.

## Future eligibility and quarantine policy

1. \`KEEP_VERIFIED\`: immutable lineage matches; one exact parser-v5 amount/currency binds to the listing; current value matches; dated FX is valid when foreign.
2. \`EXCLUDE_FROM_PRICE_RESEARCH_PENDING_REVIEW\`: legacy defaulted, bare-dollar, currencyless, multiple-price, bundle, or unsupported provenance. Keep Trading Floor/raw values unchanged.
3. \`REVIEW_FOR_CORRECTION\`: current normalized value conflicts with exact parser-v5 source evidence. Any later fix must be separately authorized, snapshotted, hash-bound, null-only where applicable, and reversible.
4. \`FX_REMEDIATION\`: explicit foreign source price exists but dated approved FX is missing, stale, or invalid.
5. \`REFERENCE_REMEDIATION\`: identity is partial, component, free text, ambiguous, malformed, or absent from the canonical catalog.

## Complete canonical-reference trust table

${table(['Brand','Model','Reference','Current qualified','Stored-evidence verified','Review required','Unsupported','Unresolved','Trusted rate','Current ready','Verified-only ready'], canonicalRows)}

## Limitations and controls

${audit.limitations.map(item => `- ${item}`).join('\n')}

Audit checksum: \`${audit.checksum_sha256}\`  
Production writes: 0. Normalized-value changes: 0. Publication changes: 0. UI changes: 0.

**NO PRODUCTION DATA WAS MODIFIED.**  
**NO NORMALIZED PRICE WAS CHANGED.**  
**NO PUBLICATION STATE WAS CHANGED.**  
**NO UI/UX WAS MODIFIED.**
`;

fs.writeFileSync(path.join(OUT, 'report.md'), report);

const source = {
  id: 'qnsa_phase7a', label: 'QNSA production read-only audit', type: 'database',
  query: {
    engine: 'PostgreSQL', language: 'sql',
    description: 'Read-only active-run census, UUID-sharded canonical-reference reconciliation, and bounded immutable-source parser-v5 shadow audit.',
    sql: `WITH control AS (
  SELECT enabled_run_key FROM public.qnsa_market_feed_control WHERE singleton AND enabled
)
SELECT brand_normalized, reference_normalized,
  count(*) FILTER (WHERE upper(coalesce(listing_type,intent,''))='WTS' AND price_usd>0
    AND lower(coalesce(price_research_status,''))<>'suppressed_exact_duplicate') AS current_qualified,
  count(*) FILTER (WHERE upper(coalesce(listing_type,intent,''))='WTS' AND price_usd>0
    AND lower(coalesce(price_research_status,''))<>'suppressed_exact_duplicate'
    AND ((upper(coalesce(currency_original,currency_normalized,'')) IN ('USD','USDT')
      AND currency_evidence IN ('explicit_line_currency','section_currency','SOURCE_EXPLICIT_USD_USDT'))
      OR (upper(coalesce(currency_original,currency_normalized,'')) NOT IN ('','USD','USDT')
        AND currency_evidence IN ('explicit_line_currency','section_currency')
        AND conversion_rate>0 AND conversion_timestamp IS NOT NULL))) AS stored_evidence_verified
FROM staging.listings JOIN control ON normalization_run_key=enabled_run_key
WHERE brand_normalized IN ('Rolex','Patek Philippe')
GROUP BY brand_normalized, reference_normalized;`,
    tables_used: ['staging.listings', 'public.qnsa_market_feed_control', 'public.raw_message_versions'],
    filters: ["brand_normalized IN ('Rolex','Patek Philippe')", 'active normalization run', 'Price Research excludes suppressed_exact_duplicate'],
    metric_definitions: {
      current_qualified: 'WTS rows with price_usd > 0 excluding suppressed_exact_duplicate.',
      stored_evidence_verified: 'Current qualified rows with explicit USD/USDT or explicit foreign currency plus positive dated FX provenance.',
      trusted_observation_rate: 'stored_evidence_verified / current_qualified.'
    }
  }
};
const trustRows = audit.census.flatMap(row => [
  { brand: row.brand, series: 'Current qualified', rate: 1, current: row.pr_current_qualified, verified: row.pr_verified_only, legacy_review: row.pr_current_qualified - row.pr_verified_only },
  { brand: row.brand, series: 'Stored-evidence verified', rate: row.pr_verified_only / row.pr_current_qualified, current: row.pr_current_qualified, verified: row.pr_verified_only, legacy_review: row.pr_current_qualified - row.pr_verified_only }
]);
const impactData = audit.analytics_high_impact.map(row => ({
  brand: row.brand, reference: row.reference, current_count: row.current_count, verified_count: row.verified_count,
  trusted_rate: row.verified_count / row.current_count, current_median: row.current_median, verified_median: row.verified_median,
  current_mean: row.current_mean, verified_mean: row.verified_mean
}));
const artifact = {
  surface: 'report',
  manifest: {
    version: 1, title: 'WATCHFACTS Phase 7A — Existing Price Integrity & Price Research Trust Audit', surface: 'report', generatedAt: audit.generated_at,
    description: 'Read-only Rolex and Patek price-evidence trust audit.', sources: [source],
    charts: [{ id: 'trust_chart', title: 'Price Research trust rate by brand', subtitle: 'Verified stored evidence covers about one-third of Rolex and four-fifths of Patek observations.', dataset: 'trust_rates', type: 'bar', encodings: { x: { field: 'brand', type: 'nominal' }, y: { field: 'rate', type: 'quantitative' }, color: { field: 'series', type: 'nominal' } }, options: { orientation: 'vertical', grouping: 'grouped' }, source }],
    tables: [{ id: 'impact_table', title: 'Highest-impact canonical references', dataset: 'impact_references', columns: [
      { field: 'brand', label: 'Brand', type: 'string' }, { field: 'reference', label: 'Reference', type: 'string' },
      { field: 'current_count', label: 'Current observations', type: 'number' }, { field: 'verified_count', label: 'Verified observations', type: 'number' },
      { field: 'trusted_rate', label: 'Trusted rate', type: 'percent' }, { field: 'current_median', label: 'Current median', type: 'currency' },
      { field: 'verified_median', label: 'Verified median', type: 'currency' }, { field: 'current_mean', label: 'Current mean', type: 'currency' },
      { field: 'verified_mean', label: 'Verified mean', type: 'currency' }
    ], defaultSort: { field: 'current_count', direction: 'desc' }, source }],
    blocks: [
      { id: 'title', type: 'markdown', body: '# WATCHFACTS Phase 7A — Existing Price Integrity & Price Research Trust Audit' },
      { id: 'decision', type: 'markdown', sourceId: source.id, body: '## Decision\n\n**Combined recommendation: PRICE_RESEARCH_REBUILD_REQUIRED.** Rolex requires a rebuild; Patek requires partial remediation. Unreliable existing prices are the primary issue, not missing prices.' },
      { id: 'trust_chart_block', type: 'chart', chartId: 'trust_chart' },
      { id: 'impact_text', type: 'markdown', sourceId: source.id, body: '## Analytics impact\n\nVerified-only eligibility reduces analytics-ready canonical references from 278 to 262 for Rolex and from 370 to 364 for Patek. High-impact exact recomputations show severe mean distortion from implausible legacy maxima.' },
      { id: 'impact_table_block', type: 'table', tableId: 'impact_table' },
      { id: 'controls', type: 'markdown', body: '## Controls and proposed disposition\n\nNo values changed. KEEP_VERIFIED requires immutable lineage plus an exact parser-v5 match. Legacy defaulted, ambiguous, bundle, unsupported-FX, and malformed-reference rows should remain stored but be excluded from Price Research pending review.' }
    ]
  },
  snapshot: { version: 1, status: 'ready', generatedAt: audit.generated_at, datasets: { trust_rates: trustRows, impact_references: impactData } },
  sources: [{ id: 'phase7a_audit', label: 'Sanitized Phase 7A audit JSON', path: 'audit-output/phase7a-existing-price-trust/audit.json' }]
};
fs.writeFileSync(path.join(OUT, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ report: path.join(OUT, 'report.md'), artifact: path.join(OUT, 'artifact.json'), bytes: Buffer.byteLength(report), canonical_rows: canonicalRows.length }, null, 2));
