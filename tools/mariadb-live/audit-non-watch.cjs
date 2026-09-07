'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicJson, boundedInteger, readJsonLines } = require('./lib.cjs');
const { discoverInputFiles } = require('./import-raw.cjs');

const CONTRACT = 'wf-mariadb-non-watch-audit-v2';
// Cross-category houses such as Cartier, Chopard, Bulgari, Chanel, Hermes and
// Jacob & Co are intentionally absent. Their name alone cannot prove that an
// explicitly described necklace, ring, handbag, or accessory is a watch.
const WATCH_BRANDS = /\b(?:rolex|patek|audemars|richard mille|hublot|omega|vacheron|iwc|panerai|tudor|breitling|breguet|zenith|jaeger|lange|seiko|tag heuer|watch|timepiece|chronograph|dial|calibre|caliber|tourbillon)\b/i;
const STRONG_BAG = /\b(?:birkins?|kelly|handbags?|hand bags?|purses?|totes?|clutches?|pochettes?|shoulder bags?|crossbod(?:y|ies)|satchels?|duffles?|travel bags?)\b/i;
const STRONG_JEWELRY = /\b(?:necklaces?|earrings?|pendants?|brooch(?:es)?|anklets?|diamond rings?|engagement rings?|wedding bands?|gold chains?|jewelry|jewellery)\b/i;
const WEAK_JEWELRY = /\b(?:bracelet|bangle|ring|chain|diamond|emerald|ruby|sapphire|pearl)\b/i;
const ACCESSORY = /\b(?:wallets?|card holders?|belts?|sunglasses|cufflinks?|fountain pens?|lighters?|scarves?|silk ties?|key holders?)\b/i;

function evidenceText(record) {
  const raw = record.raw_data || {};
  return [raw.title, raw.description, raw.comments, raw.brand, raw.model, raw.reference]
    .filter(value => value != null && String(value).trim())
    .map(String)
    .join('\n');
}

function classify(record) {
  const text = evidenceText(record);
  const watch = WATCH_BRANDS.test(text) || Boolean(record.raw_data?.normalized_reference);
  const bag = STRONG_BAG.test(text);
  const jewelry = STRONG_JEWELRY.test(text);
  const weakJewelry = WEAK_JEWELRY.test(text);
  const accessory = ACCESSORY.test(text);
  const matched = [bag, jewelry, accessory].filter(Boolean).length;
  if (matched > 1 || (watch && (bag || jewelry || accessory))) {
    return { category: 'AMBIGUOUS', reasons: ['CONFLICTING_WATCH_AND_NON_WATCH_EVIDENCE'], text };
  }
  if (bag) return { category: 'HANDBAG', reasons: ['EXPLICIT_BAG_TERM'], text };
  if (jewelry) return { category: 'JEWELRY', reasons: ['EXPLICIT_JEWELRY_TERM'], text };
  if (accessory) return { category: 'ACCESSORY', reasons: ['EXPLICIT_ACCESSORY_TERM'], text };
  if (watch) return { category: 'WATCH', reasons: ['WATCH_IDENTITY_EVIDENCE'], text };
  if (weakJewelry) return { category: 'AMBIGUOUS', reasons: ['WEAK_JEWELRY_TERM_REQUIRES_REVIEW'], text };
  return { category: 'UNCLASSIFIED', reasons: ['NO_DETERMINISTIC_CATEGORY_EVIDENCE'], text };
}

async function run(env = process.env) {
  if (!env.MARIADB_NON_WATCH_AUDIT_INPUT) throw new Error('MARIADB_NON_WATCH_AUDIT_INPUT is required');
  const input = path.resolve(env.MARIADB_NON_WATCH_AUDIT_INPUT);
  const output = path.resolve(env.MARIADB_NON_WATCH_AUDIT_OUTPUT || 'audit-output/mariadb-live/non-watch-audit');
  const sampleLimit = boundedInteger(env.MARIADB_NON_WATCH_SAMPLE_LIMIT, 100, 1, 1000, 'MARIADB_NON_WATCH_SAMPLE_LIMIT');
  const files = discoverInputFiles(input);
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, 'report.json');
  const samplePath = path.join(output, 'private-samples.jsonl');
  if (fs.existsSync(reportPath) || fs.existsSync(samplePath)) {
    throw new Error('Non-watch audit output already exists; choose a new output directory');
  }
  const counts = { WATCH: 0, HANDBAG: 0, JEWELRY: 0, ACCESSORY: 0, AMBIGUOUS: 0, UNCLASSIFIED: 0, ERROR: 0 };
  const sampled = Object.fromEntries(Object.keys(counts).map(key => [key, 0]));
  let inputRows = 0;
  let outputRows = 0;
  for (const file of files) {
    const lines = readJsonLines(file);
    for await (const line of lines) {
      if (!line.trim()) continue;
      inputRows += 1;
      try {
        const record = JSON.parse(line);
        const result = classify(record);
        counts[result.category] += 1;
        outputRows += 1;
        if (sampled[result.category] < sampleLimit) {
          fs.appendFileSync(samplePath, `${JSON.stringify({
            source_record_id: record.source_record_id,
            source_hash: record.raw_sha256,
            category: result.category,
            reasons: result.reasons,
            raw_message: record.raw_message,
            raw_data: record.raw_data,
          })}\n`);
          sampled[result.category] += 1;
        }
      } catch (error) {
        counts.ERROR += 1;
      }
    }
  }
  const report = {
    contract: CONTRACT,
    generated_at: new Date().toISOString(),
    input_rows: inputRows,
    classified_rows: outputRows,
    error_rows: counts.ERROR,
    difference: inputRows - outputRows - counts.ERROR,
    reconciled: inputRows === outputRows + counts.ERROR,
    counts,
    private_sample_rows: sampled,
    publication_writes: 0,
    normalization_writes: 0,
  };
  atomicJson(reportPath, report);
  if (!report.reconciled) throw new Error('Non-watch audit counts do not reconcile');
  process.stdout.write(`${JSON.stringify({ event: 'mariadb_non_watch_audit_complete', ...report })}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_non_watch_audit_error', error_name: error.name || 'Error', error_message: error.message || String(error), publication_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { CONTRACT, classify, evidenceText, run };
