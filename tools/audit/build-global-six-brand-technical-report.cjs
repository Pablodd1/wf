#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function build(findings, completion) {
  const generatedAt = findings.observed_at || new Date().toISOString();
  const rows = findings.brands.map(row => {
    const { blockers: _blockers, ...scalar } = row;
    return {
      ...scalar,
      catalog_nonconflicting_reference_count: completion.catalog_nonconflicting_reference_counts?.[row.brand] ?? null,
      customer_safe_canonical_reference_count: completion.customer_safe_canonical_reference_counts?.[row.brand] ?? null,
      observed_customer_safe_canonical_reference_count: completion.observed_customer_safe_canonical_reference_counts?.[row.brand] ?? 0,
      blocker_count: row.blockers.length,
      trading_floor_status: row.trading_floor_listings === null ? 'UNKNOWN' : 'MEASURED',
      price_research_status: row.price_research_qualified_wts === null ? 'UNKNOWN_OR_CONFLICTING' : 'MEASURED',
    };
  });
  const knownRows = rows.filter(row => Number.isFinite(row.trading_floor_listings));
  const sources = [{
    id: 'watchfacts_live_bounded_audits',
    label: 'WatchFacts bounded live Trading Floor and Price Research audits',
    type: 'web_api',
    href: 'https://watchfacts-poc.vercel.app/',
    query: {
      engine: 'DuckDB',
      language: 'sql',
      sql: "SELECT b.brand, b.catalog_references, json_extract(to_json(c.catalog_nonconflicting_reference_counts), '$.\"' || b.brand || '\"')::INTEGER AS catalog_nonconflicting_reference_count, json_extract(to_json(c.customer_safe_canonical_reference_counts), '$.\"' || b.brand || '\"')::INTEGER AS customer_safe_canonical_reference_count, json_extract(to_json(c.observed_customer_safe_canonical_reference_counts), '$.\"' || b.brand || '\"')::INTEGER AS observed_customer_safe_canonical_reference_count, b.trading_floor_listings, b.wts, b.wtb, b.price_research_qualified_wts, b.analytics_ready_references, b.decision FROM read_json_auto('audit-output/global-six-brand-completion/brand-findings.json') f, UNNEST(f.brands) AS t(b), read_json_auto('audit-output/global-six-brand-completion/completion-summary.json') c",
      description: 'Joins bounded Trading Floor and Price Research findings to the generated six-brand reference-count summary; row-level raw messages were removed before checkpointing.',
      tables_used: ['audit-output/global-six-brand-completion/brand-findings.json', 'audit-output/global-six-brand-completion/completion-summary.json'],
      filters: findings.brands.map(row => row.brand),
      metric_definitions: {
        trading_floor_listings: 'Distinct customer-visible rows returned by a terminating exact-brand cursor; null means the cursor census is not complete.',
        catalog_references: 'Exact brand/reference identities exposed by the deployed Browse by Model contract.',
        catalog_nonconflicting_reference_count: 'Approved catalog references with no recorded catalog identity conflict; this is not a production-publication count.',
        customer_safe_canonical_reference_count: 'Canonical references represented by at least one exact customer-eligible production observation after publication and reference safety gates; null when the authoritative production snapshot is incomplete.',
        observed_customer_safe_canonical_reference_count: 'Customer-safe canonical references observed in the bounded partial production snapshot; never substituted for the authoritative count.',
        price_research_qualified_wts: 'WTS observations passing exact-reference, price/currency, deduplication, bundle, and publication gates.',
        analytics_ready_references: 'Exact references meeting the unchanged minimum comparable-observation and 3.0x IQR analytics contract.',
      },
    },
  }, {
    id: 'watchfacts_live_audit_blockers',
    label: 'WatchFacts bounded live audit blocker register',
    type: 'repository_artifact',
    query: {
      engine: 'DuckDB',
      language: 'sql',
      sql: "SELECT b.brand, blocker FROM read_json_auto('audit-output/global-six-brand-completion/brand-findings.json') f, UNNEST(f.brands) AS t(b), UNNEST(b.blockers) AS u(blocker)",
      description: 'Flattens the evidence-backed per-brand blocker arrays into the report blocker register.',
      tables_used: ['audit-output/global-six-brand-completion/brand-findings.json'],
      filters: ['six contract brands', 'read-only findings only'],
    },
  }, {
    id: 'qnsa_phase7b_gate',
    label: 'Canonical QNSA Phase 7B workflow and authentication gate',
    type: 'github_actions',
    href: 'https://github.com/Pablodd1/wf/actions/runs/32786073654',
    query: {
      engine: 'GitHub Actions',
      language: 'yaml',
      description: 'Read-only management-token audit and private verified-price shadow dispatch gate for canonical QNSA.',
      filters: ['project_ref=qnsafosakvonzgfcsphh', 'workflow_dispatch only', 'no customer source switch'],
    },
  }, {
    id: 'global_contract',
    label: 'WatchFacts global six-brand customer data contract',
    type: 'repository_artifact',
    query: {
      engine: 'Git',
      language: 'json',
      description: 'Machine-readable shared acceptance contract and aggregate per-reference completion ledgers.',
      tables_used: ['config/watchfacts-global-customer-data-contract.json', 'audit-output/global-six-brand-completion/ledgers/*.json'],
      metric_definitions: {
        total_listings: 'Distinct currently published single-watch WTS plus WTB, independent of Price Research price verification.',
      },
    },
  }];

  return {
    surface: 'report',
    manifest: {
      version: 1,
      title: 'WATCHFACTS Six-Brand Completion Audit',
      surface: 'report',
      generatedAt,
      description: 'Global evidence-contract implementation and production acceptance status for Rolex, Patek Philippe, Tudor, Zenith, Cartier, and TAG Heuer.',
      sources,
      charts: [{
        id: 'known_trading_floor_counts',
        title: 'Measured Trading Floor listings',
        subtitle: 'Four completed or independently bounded brand snapshots; Rolex and Patek remain unknown and are intentionally omitted.',
        dataset: 'known_brand_counts',
        type: 'bar',
        encodings: {
          x: { field: 'brand', type: 'nominal' },
          y: { field: 'trading_floor_listings', type: 'quantitative' },
        },
        options: { orientation: 'horizontal', fullWidth: true, labels: true },
        source: sources[0],
      }],
      tables: [{
        id: 'brand_completion_status',
        title: 'Six-brand acceptance status',
        subtitle: 'Unknown and conflicting values remain explicit; no missing count is coerced to zero.',
        dataset: 'brand_status',
        columns: [
          { field: 'brand', label: 'Brand', type: 'string' },
          { field: 'catalog_references', label: 'Catalog refs', type: 'number' },
          { field: 'catalog_nonconflicting_reference_count', label: 'Nonconflicting catalog refs', type: 'number' },
          { field: 'customer_safe_canonical_reference_count', label: 'Customer-safe canonical refs', type: 'number' },
          { field: 'observed_customer_safe_canonical_reference_count', label: 'Observed customer-safe refs', type: 'number' },
          { field: 'trading_floor_listings', label: 'TF listings', type: 'number' },
          { field: 'wts', label: 'WTS', type: 'number' },
          { field: 'wtb', label: 'WTB', type: 'number' },
          { field: 'price_research_qualified_wts', label: 'Qualified WTS', type: 'number' },
          { field: 'analytics_ready_references', label: 'Analytics-ready refs', type: 'number' },
          { field: 'blocker_count', label: 'Open gates', type: 'number' },
          { field: 'decision', label: 'Decision', type: 'string' },
        ],
        defaultSort: { field: 'brand', direction: 'asc' },
        source: sources[0],
      }, {
        id: 'blocker_register',
        title: 'Production blockers by brand',
        subtitle: 'Every row is a deployment gate, not a request to rewrite or delete historical evidence.',
        dataset: 'blockers',
        columns: [
          { field: 'brand', label: 'Brand', type: 'string' },
          { field: 'blocker', label: 'Blocking evidence', type: 'string' },
        ],
        defaultSort: { field: 'brand', direction: 'asc' },
        source: sources[1],
      }],
      blocks: [
        { id: 'title', type: 'markdown', body: '# WATCHFACTS Six-Brand Completion Audit' },
        { id: 'technical_summary', type: 'markdown', body: '## Technical summary\n\n**The shared evidence contract is implemented, but no brand is authorized for a new cohort deployment.** The deployed catalog contains 3,054 exact references across the six brands. Tudor and Zenith have complete live Trading Floor counts, while Cartier and TAG Heuer have material catalog/publication/Price Research inconsistencies. Rolex and Patek authoritative counts remain unavailable because the private Phase 7B run has not completed and canonical QNSA management authentication most recently failed.' },
        { id: 'measured_coverage', type: 'markdown', sourceId: 'watchfacts_live_bounded_audits', body: '## Four measured brands already prove the global gates are necessary\n\nTudor has 2,555 published listings and Zenith has 453, but both have Trading Floor references outside the Price Research catalog and their published WTB activity is absent from the Price Research census. Cartier reports 6,834 listings while its catalog browse and exact-reference Price Research results disagree. TAG Heuer returns 278 distinct rows against an advertised 283 and publishes 150 rows outside its current catalog.' },
        { id: 'known_counts_chart', type: 'chart', chartId: 'known_trading_floor_counts' },
        { id: 'brand_status_heading', type: 'markdown', body: '## Every brand remains fail-closed\n\nThe table separates measured coverage from unknown or conflicting values. A catalog reference with no current listing is not automatically a defect; a published reference outside the catalog requires identity review.' },
        { id: 'brand_status_table', type: 'table', tableId: 'brand_completion_status' },
        { id: 'definitions', type: 'markdown', sourceId: 'global_contract', body: '## One contract now governs identity, price, dealer, counts, and publication\n\nCatalog reference count measures the approved catalog. Catalog nonconflicting count removes catalog identity conflicts but does not claim production coverage. Customer-safe canonical count requires at least one exact customer-eligible production observation after publication and reference safety gates; it remains null until the authoritative production snapshot completes, while the bounded observed count stays separate. Price Research accepts current single-watch WTS only when its independent evidence gates pass. Generic dealer placeholders never become identities or ratings.' },
        { id: 'methodology', type: 'markdown', body: '## Bounded audits preserve evidence and avoid uncontrolled production work\n\nThe audit uses adaptive four-reference Price Research batches with concurrency capped at two and 50-row Trading Floor cursor pages with resumable checkpoints. Row-level raw messages are removed from checkpoints. The completion ledgers freeze every discovered canonical model/reference and preserve unknown fields as null until their exact query succeeds.' },
        { id: 'limitations', type: 'markdown', body: '## Coverage is partial where production access or parity failed\n\nAuthoritative customer-safe canonical reference counts remain null for every incomplete brand production snapshot and are never inferred from the catalog. Bounded observed counts are shown separately. Rolex and Patek population totals are not inferred from capped customer API pages. Cartier qualified-WTS counts remain unknown because two customer-facing sources disagree. These limitations prevent deployment; they do not downgrade previously confirmed defects.' },
        { id: 'blockers_heading', type: 'markdown', body: '## Deployment blockers are explicit and reversible' },
        { id: 'blockers_table', type: 'table', tableId: 'blocker_register' },
        { id: 'next_steps', type: 'markdown', body: '## Recommended next steps\n\n1. Restore canonical QNSA management access and resume the already-dispatched stable Phase 7B run without creating a second key.\n2. Reconcile TAG Heuer and Cartier publication against the same exact-reference gate used by catalog browse and Price Research.\n3. Repair the Tudor 79360 exact-reference conflict, global same-line multi-item detection, and WTB count parity.\n4. Rerun the same bounded audits and activate only brand/reference cohorts whose complete ledger passes every shared gate.' },
        { id: 'further_questions', type: 'markdown', body: '## Further questions\n\nCan the canonical QNSA management token be restored without changing database credentials? Which currently published outside-catalog references are valid catalog omissions versus cross-brand or component defects? No answer should be inferred from price, amount proximity, or market expectation.' },
      ],
    },
    snapshot: {
      version: 1,
      status: 'partial',
      generatedAt,
      accessIssues: [{
        sourceId: 'qnsa_phase7b_gate',
        code: 'CANONICAL_QNSA_MANAGEMENT_AUTH',
        message: 'Authoritative Rolex and Patek Phase 7B results are unavailable because the latest management-token audit returned HTTP 401 and the stable shadow run is not complete.',
      }, {
        sourceId: 'watchfacts_live_bounded_audits',
        code: 'GLOBAL_REFERENCE_CENSUS_INCOMPLETE',
        message: 'The resumable 3,054-reference Price Research census and Rolex Trading Floor cursor census are not complete; missing values remain null.',
      }],
      datasets: {
        known_brand_counts: knownRows,
        brand_status: rows,
        blockers: findings.brands.flatMap(row => row.blockers.map(blocker => ({ brand: row.brand, blocker }))),
      },
    },
    sources,
    package_info: {
      contract: findings.contract,
      completion_result_sha256: completion.result_sha256 || null,
      snapshot_complete: completion.snapshot_complete === true,
    },
  };
}

function main() {
  const outputDir = path.resolve(process.env.GLOBAL_SIX_BRAND_OUTPUT || 'audit-output/global-six-brand-completion');
  const findings = JSON.parse(fs.readFileSync(path.join(outputDir, 'brand-findings.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(outputDir, 'completion-summary.json'), 'utf8'));
  const artifact = build(findings, completion);
  const output = path.join(outputDir, 'report-artifact.json');
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, status: artifact.snapshot.status })}\n`);
}

module.exports = { build };
if (require.main === module) main();
