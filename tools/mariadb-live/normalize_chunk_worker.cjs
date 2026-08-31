// tools/mariadb-live/normalize_chunk_worker.cjs
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const { normalizeCanonicalParentChild } = require('./authoritative-evidence-normalizer.cjs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const rawBatch = JSON.parse(line);
    const results = [];
    for (let i = 0; i < rawBatch.length; i++) {
      const rawRow = rawBatch[i];
      try {
        const norm = normalizeCanonicalParentChild(rawRow);
        results.push({
          success: true,
          parent: norm.parent,
          is_review_required: Boolean(norm.parent.review_flags && norm.parent.review_flags.length > 0),
          children_stats: norm.children.map(c => ({
            trading_floor_eligible: c.trading_floor_eligible,
            price_research_eligible: c.price_research_eligible,
            currency_status: c.currency_status,
            intent: c.intent
          }))
        });
      } catch (innerErr) {
        results.push({ success: false, error: innerErr.message, source_id: rawRow.source_id });
      }
    }
    process.stdout.write(JSON.stringify(results) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify([{ success: false, error: err.message }]) + '\n');
  }
});
