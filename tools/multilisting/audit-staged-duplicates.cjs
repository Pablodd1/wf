'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function normalized(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function parentId(row) {
  return normalized(row.field_confidence?.source_record_id);
}

function listingFingerprint(row) {
  return [row.brand, row.reference, row.dial_color, row.condition, row.price_usd, row.currency, row.listing_type]
    .map(normalized).join('|');
}

function exactParentFingerprint(row) {
  return `${parentId(row)}|${listingFingerprint(row)}|${normalized(row.raw_message)}`;
}

async function audit(manifestPath, outputPath) {
  const exactParents = new Map();
  const marketCandidates = new Map();
  let rows = 0;
  for await (const line of readline.createInterface({ input: fs.createReadStream(manifestPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rows += 1;
    const exactKey = exactParentFingerprint(row);
    const exact = exactParents.get(exactKey) || { count: 0, ids: [], parentId: parentId(row), rawMessage: row.raw_message };
    exact.count += 1;
    if (exact.ids.length < 20) exact.ids.push(row.id);
    exactParents.set(exactKey, exact);

    const marketKey = listingFingerprint(row);
    const market = marketCandidates.get(marketKey) || { count: 0, parentIds: new Set(), ids: [], brand: row.brand, reference: row.reference, dialColor: row.dial_color, priceUsd: row.price_usd };
    market.count += 1;
    market.parentIds.add(parentId(row));
    if (market.ids.length < 20) market.ids.push(row.id);
    marketCandidates.set(marketKey, market);
  }

  const exactRepeatClusters = [...exactParents.values()].filter(value => value.count > 1)
    .sort((a, b) => b.count - a.count || a.parentId.localeCompare(b.parentId));
  const crossParentCandidates = [...marketCandidates.values()]
    .filter(value => value.parentIds.size > 1)
    .map(value => ({ ...value, parentCount: value.parentIds.size, parentIds: [...value.parentIds].slice(0, 20) }))
    .sort((a, b) => b.count - a.count || String(a.reference).localeCompare(String(b.reference)));
  const report = {
    generatedAt: new Date().toISOString(),
    manifestPath: path.resolve(manifestPath),
    rows,
    exactSameParentClusters: exactRepeatClusters.length,
    exactSameParentRows: exactRepeatClusters.reduce((sum, value) => sum + value.count, 0),
    crossParentRepostCandidateClusters: crossParentCandidates.length,
    policy: {
      exactSameParent: 'HUMAN_QUANTITY_OR_DUPLICATE_REVIEW_REQUIRED',
      crossParent: 'DO_NOT_DELETE_WITHOUT_SELLER_AND_DATE_LINEAGE',
    },
    exactSameParentSamples: exactRepeatClusters.slice(0, 500),
    crossParentSamples: crossParentCandidates.slice(0, 500),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const manifestPath = path.resolve(process.env.UNBUNDLED_STAGING_MANIFEST || process.argv[2] || 'audit-output/unbundled/batch-002-staging-v3/watch-staging.jsonl');
  const outputPath = path.resolve(process.env.UNBUNDLED_DUPLICATE_REPORT || process.argv[3] || 'audit-output/unbundled/batch-002-staging-v3/duplicate-audit.json');
  const result = await audit(manifestPath, outputPath);
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_duplicate_audit_complete', ...result, exactSameParentSamples: undefined, crossParentSamples: undefined }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'unbundled_duplicate_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { audit, exactParentFingerprint, listingFingerprint };
