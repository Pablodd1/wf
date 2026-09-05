"use strict";

const fs = require("node:fs");
const { normalizeAuthoritativeRow } = require("./authoritative-evidence-normalizer.cjs");

function processBatch(inputFile, outputFile) {
  const rawData = fs.readFileSync(inputFile, "utf-8");
  const batch = JSON.parse(rawData);

  const results = [];
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    try {
      const contract = normalizeAuthoritativeRow(row);
      results.push({ status: "OK", contract });
    } catch (err) {
      results.push({ status: "ERROR", error: err.message, source_id: row.source_id });
    }
  }

  fs.writeFileSync(outputFile, JSON.stringify(results), "utf-8");
}

const args = process.argv.slice(2);
if (args.length >= 2) {
  processBatch(args[0], args[1]);
} else {
  console.error("Usage: node normalize_batch_worker.cjs <input_json> <output_json>");
  process.exit(1);
}
