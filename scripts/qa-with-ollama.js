#!/usr/bin/env node
'use strict';
const fs = require('fs');

const REPORT_PATH = '/home/jasme/wf/scripts/wts-report-v43.json';
const QA_OUTPUT = '/home/jasme/wf/scripts/wts-qa-results.json';

// Build curl command for Ollama
async function askOllama(model, prompt) {
  const { execSync } = require('child_process');
  try {
    const result = execSync(
      `curl -s http://localhost:11434/api/generate -d ${JSON.stringify(JSON.stringify({model, prompt, stream: false}))}`,
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    return JSON.parse(result.toString()).response || 'NO_RESPONSE';
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

function sample(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

async function main() {
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const rows = report.rows;

  // Bucket by verdict
  const buckets = {};
  for (const r of rows) {
    if (!buckets[r.verdict]) buckets[r.verdict] = [];
    buckets[r.verdict].push(r);
  }

  // Sample targets: ~15 from each major bucket
  const targets = ['APPROVED', 'MULTI_WATCH_STOCK_LIST', 'NON_WATCH_OR_WRONG_CATEGORY', 'NEEDS_MANUAL_REVIEW', 'ACCESSORY_NOT_WATCH'];
  const sampleSize = 20;

  const sampled = [];
  for (const v of targets) {
    if (buckets[v]) {
      const picks = sample(buckets[v], sampleSize);
      for (const p of picks) sampled.push({ ...p, bucket: v });
    }
  }

  console.log(`Sampled ${sampled.length} rows across ${targets.filter(t => buckets[t]).length} verdict buckets`);
  console.log(`Bucket sizes: ${targets.filter(t => buckets[t]).map(t => `${t}=${buckets[t].length}`).join(', ')}`);

  // QA each row
  const results = [];
  let flagged = 0;

  for (let i = 0; i < sampled.length; i++) {
    const row = sampled[i];
    const prompt = `You are a reference-cleanup validator for a watch parser. 

RULE: The "reference" column must contain ONLY the true watch reference number. It must NEVER contain prices, dates, condition words (like "NEW", "UNWORN"), stock numbers, dealer IDs, strap/accessory code, or multi-watch lists. It should be just the manufacturer's model reference.

Evaluate this parsed result:

RAW MESSAGE: "${row.raw.slice(0, 250)}"
PARSED BRAND: ${row.brand || '(none)'}
PARSED REFERENCE: ${row.ref || '(none)'}
PARSED VERDICT: ${row.verdict}

Answer with EXACTLY this format:
REF_CLEAN: YES|NO
REASON: <one-line explanation>

If the reference is clean (contains only a valid watch reference number), say YES. If it contains garbage (prices, dates, condition words, multi-watch content, non-reference text), say NO.`;

    process.stdout.write(`\rQA ${i+1}/${sampled.length} (${Math.round((i+1)/sampled.length*100)}%)...`);

    const response = await askOllama('qwen3.5:4b-q4_K_M', prompt);
    const refCleanMatch = response.match(/REF_CLEAN:\s*(YES|NO)/i);
    const reasonMatch = response.match(/REASON:\s*(.+)/i);

    const refClean = refCleanMatch ? refCleanMatch[1].toUpperCase() : 'UNKNOWN';
    const reason = reasonMatch ? reasonMatch[1] : response.slice(0, 120);

    const entry = {
      idx: row.idx,
      bucket: row.bucket,
      verdict: row.verdict,
      raw: row.raw.slice(0, 200),
      brand: row.brand,
      ref: row.ref,
      ollama_ref_clean: refClean,
      ollama_reason: reason.trim()
    };

    results.push(entry);

    // Flag: if Ollama says NO (ref not clean) but the verdict implies the ref should be clean
    if (refClean === 'NO' && row.ref && row.verdict !== 'ACCESSORY_NOT_WATCH' && row.verdict !== 'NEEDS_MANUAL_REVIEW') {
      entry.flagged = true;
      flagged++;
    }
    // Also flag if ref is empty but not NEEDS_MANUAL_REVIEW/ACCESSORY
    if (!row.ref && row.verdict === 'APPROVED') {
      entry.flagged = true;
      flagged++;
    }
  }

  console.log(`\nDone. ${flagged} disagreements flagged.`);

  const qaReport = {
    generated: new Date().toISOString(),
    model: 'qwen3.5:4b-q4_K_M',
    totalSampled: sampled.length,
    totalFlagged: flagged,
    verdictCoverage: targets.filter(t => buckets[t]).map(t => ({verdict: t, inBucket: buckets[t].length, sampled: sampled.filter(s => s.bucket === t).length})),
    results: results.sort((a, b) => (a.flagged === b.flagged ? 0 : a.flagged ? -1 : 1))
  };

  fs.writeFileSync(QA_OUTPUT, JSON.stringify(qaReport, null, 2));
  console.log(`Full results written to ${QA_OUTPUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
