'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const { normalizeWatchConditionFields } = require('../../api/_lib/watch-condition-normalization.cjs');

function increment(map, key) {
  const label = String(key || 'UNSPECIFIED').trim() || 'UNSPECIFIED';
  map.set(label, (map.get(label) || 0) + 1);
}

function sortedCounts(map, limit = 100) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function isDaytona(source) {
  const raw = source.raw_data || {};
  const identity = [raw.model, raw.reference, raw.normalized_reference, source.raw_message]
    .filter(Boolean).join(' ');
  return String(raw.brand || '').toLowerCase() === 'rolex'
    && /\bdaytona\b|\b(?:1165\d{2}|1265\d{2}|116508|126508)[A-Z]*\b/i.test(identity);
}

async function audit(filePath) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const brands = new Map();
  const sourceDials = new Map();
  const rolexReferences = new Map();
  let inputRows = 0;
  let errorRows = 0;
  let mintRows = 0;
  let dialCorrections = 0;
  let conditionCorrections = 0;
  let suspectedGreenFromCondition = 0;
  let daytonaMintRows = 0;
  let daytonaSuspectedGreen = 0;

  for await (const line of lines) {
    if (!line.trim()) continue;
    inputRows += 1;
    try {
      const source = JSON.parse(line);
      if (!/\bmint\b/i.test(String(source.raw_message || ''))) continue;
      mintRows += 1;
      const raw = source.raw_data || {};
      const sourceDial = raw.dial_color || null;
      const corrected = normalizeWatchConditionFields({
        dial_color: sourceDial,
        condition: raw.condition || null,
        raw_message: source.raw_message,
      });
      increment(brands, raw.brand);
      increment(sourceDials, sourceDial);
      if (String(raw.brand || '').toLowerCase() === 'rolex') {
        increment(rolexReferences, raw.normalized_reference || raw.reference);
      }
      if (String(sourceDial || '') !== String(corrected.dial_color || '')) dialCorrections += 1;
      if (corrected.condition === 'Used - Like New' && raw.condition !== corrected.condition) conditionCorrections += 1;
      const suspected = /^(?:green|mint|mint green)$/i.test(String(sourceDial || ''))
        && corrected.dial_color === null;
      if (suspected) suspectedGreenFromCondition += 1;
      if (isDaytona(source)) {
        daytonaMintRows += 1;
        if (suspected) daytonaSuspectedGreen += 1;
      }
    } catch {
      errorRows += 1;
    }
  }

  return {
    contract: 'wf-mint-condition-audit-v1',
    input_rows: inputRows,
    error_rows: errorRows,
    reconciled: inputRows >= mintRows + errorRows,
    mint_raw_rows: mintRows,
    condition_corrections: conditionCorrections,
    dial_corrections: dialCorrections,
    suspected_green_from_mint_condition: suspectedGreenFromCondition,
    daytona_mint_rows: daytonaMintRows,
    daytona_suspected_green_from_condition: daytonaSuspectedGreen,
    brands: sortedCounts(brands),
    source_dial_values: sortedCounts(sourceDials, 30),
    rolex_references: sortedCounts(rolexReferences, 50),
    production_writes: 0,
  };
}

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write('Usage: node tools/data-quality/audit-mint-condition.cjs <raw-records.jsonl>\n');
    process.exitCode = 2;
  } else {
    audit(filePath)
      .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch(error => {
        process.stderr.write(`${error.stack || error.message || error}\n`);
        process.exitCode = 1;
      });
  }
}

module.exports = { audit, isDaytona };
