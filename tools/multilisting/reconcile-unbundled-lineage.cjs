'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { exactLineage } = require('./bundle-cohort.cjs');
const { expectedListingId } = require('./audit-unbundled-csv.cjs');

function value(input) {
  return String(input ?? '').trim();
}

function example(target, payload) {
  if (target.length < 20) target.push(payload);
}

function streamCsv(filePath, onRow, onHeaders = null) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('headers', headers => onHeaders?.(headers))
      .on('data', onRow)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function reconcileLineage({ listingsPath, parentsPath, mappingPath }) {
  const parents = new Map();
  const mappingIds = new Set();
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      listings: path.resolve(listingsPath),
      parents: path.resolve(parentsPath),
      mapping: path.resolve(mappingPath),
    },
    parentRows: 0,
    mappingRows: 0,
    listingRows: 0,
    joinedParents: 0,
    exactRawLineage: 0,
    mappingMatches: 0,
    parentIntentMatches: 0,
    parentIntentComparable: 0,
    sourceDateMatches: 0,
    sourceDateComparable: 0,
    parentIntentCounts: {},
    childIntentCounts: {},
    parentCoverage: { sellerName: 0, sellerPhone: 0, dealer: 0, createdAt: 0 },
    issues: {},
    examples: {},
  };

  const issue = (name, row, detail = {}) => {
    report.issues[name] = (report.issues[name] || 0) + 1;
    report.examples[name] ||= [];
    example(report.examples[name], {
      listingId: value(row.listing_id) || null,
      sourceRecordId: value(row.source_record_id) || null,
      candidateIndex: value(row.candidate_index) || null,
      rawLine: value(row.raw_line).slice(0, 500) || null,
      ...detail,
    });
  };

  await streamCsv(parentsPath, row => {
    report.parentRows += 1;
    const id = value(row.source_record_id);
    if (!id) return issue('parent_missing_source_record_id', row);
    if (parents.has(id)) issue('duplicate_parent_id', row);
    parents.set(id, {
      rawMessage: value(row.raw_message),
      listingType: value(row.listing_type).toUpperCase(),
      createdAt: value(row.created_at),
    });
    if (value(row.seller_name)) report.parentCoverage.sellerName += 1;
    if (value(row.seller_phone)) report.parentCoverage.sellerPhone += 1;
    if (value(row.dealer)) report.parentCoverage.dealer += 1;
    if (value(row.created_at)) report.parentCoverage.createdAt += 1;
  });

  await streamCsv(mappingPath, row => {
    report.mappingRows += 1;
    const listingId = value(row.listing_id);
    if (!listingId) return issue('mapping_missing_listing_id', row);
    if (listingId !== expectedListingId(row)) issue('mapping_unstable_listing_id', row, { expected: expectedListingId(row), actual: listingId });
    if (mappingIds.has(listingId)) issue('duplicate_mapping_listing_id', row);
    mappingIds.add(listingId);
  });

  await streamCsv(listingsPath, row => {
    report.listingRows += 1;
    const parent = parents.get(value(row.source_record_id));
    const childIntent = value(row.listing_type).toUpperCase();
    report.childIntentCounts[childIntent || 'MISSING'] = (report.childIntentCounts[childIntent || 'MISSING'] || 0) + 1;
    if (!parent) {
      issue('parent_not_found', row);
    } else {
      report.joinedParents += 1;
      if (exactLineage(parent.rawMessage, value(row.raw_line))) report.exactRawLineage += 1;
      else issue('raw_line_not_in_parent', row, { rawLine: value(row.raw_line).slice(0, 500) });

      const parentIntent = parent.listingType || 'MISSING';
      report.parentIntentCounts[parentIntent] = (report.parentIntentCounts[parentIntent] || 0) + 1;
      if (!['WTS', 'WTB'].includes(parentIntent)) {
        issue('parent_intent_unusable', row, { parent: parentIntent, child: childIntent });
      } else {
        report.parentIntentComparable += 1;
        if (parentIntent === childIntent) report.parentIntentMatches += 1;
        else issue('parent_intent_conflict', row, { parent: parentIntent, child: childIntent });
      }
      if (parent.createdAt && value(row.source_created_at)) {
        report.sourceDateComparable += 1;
        if (parent.createdAt === value(row.source_created_at)) report.sourceDateMatches += 1;
        else issue('source_date_conflict', row, { parent: parent.createdAt, child: value(row.source_created_at) });
      } else {
        issue('source_date_missing', row, { parent: parent.createdAt || null, child: value(row.source_created_at) || null });
      }
    }
    if (mappingIds.has(value(row.listing_id))) report.mappingMatches += 1;
    else issue('mapping_not_found', row);
  });

  report.rates = {
    parentJoin: report.listingRows ? report.joinedParents / report.listingRows : 0,
    exactRawLineage: report.listingRows ? report.exactRawLineage / report.listingRows : 0,
    mappingJoin: report.listingRows ? report.mappingMatches / report.listingRows : 0,
    parentIntentAgreement: report.parentIntentComparable ? report.parentIntentMatches / report.parentIntentComparable : 0,
    sourceDateAgreement: report.sourceDateComparable ? report.sourceDateMatches / report.sourceDateComparable : 0,
    sourceDateCoverage: report.listingRows ? report.sourceDateComparable / report.listingRows : 0,
  };
  report.goNoGo = {
    decision: report.rates.parentJoin >= 0.999
      && report.rates.exactRawLineage === 1
      && report.rates.mappingJoin === 1
      ? 'LINEAGE_GATE_PASSED'
      : 'HOLD_FOR_LINEAGE_CORRECTION',
    productionWritesAllowed: false,
  };
  return report;
}

async function main() {
  const listingsPath = process.env.UNBUNDLED_CSV_PATH || process.argv[2];
  const parentsPath = process.env.UNBUNDLED_PARENT_CSV_PATH || process.argv[3];
  const mappingPath = process.env.UNBUNDLED_MAPPING_CSV_PATH || process.argv[4];
  if (!listingsPath || !parentsPath || !mappingPath) {
    throw new Error('Provide listings, parent raw messages, and mapping CSV paths.');
  }
  const outputPath = path.resolve(process.env.UNBUNDLED_LINEAGE_OUTPUT
    || path.join(path.dirname(listingsPath), `${path.basename(listingsPath, path.extname(listingsPath))}_lineage_audit.json`));
  const report = await reconcileLineage({ listingsPath, parentsPath, mappingPath });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    event: 'unbundled_lineage_reconciliation_complete',
    outputPath,
    listingRows: report.listingRows,
    parentRows: report.parentRows,
    mappingRows: report.mappingRows,
    rates: report.rates,
    issues: report.issues,
    decision: report.goNoGo.decision,
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ event: 'unbundled_lineage_reconciliation_error', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { reconcileLineage, streamCsv };
