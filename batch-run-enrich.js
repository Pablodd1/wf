#!/usr/bin/env node
/**
 * RUN ONCE: Batch enrich all HUMAN+RECYCLE records with catalog-match confidence
 *
 * Calls /api/batch-enrich in a loop using cursor-based pagination (nextLastId).
 * Processes 500 records per request, continues until done.
 * 
 * Usage: node batch-run-enrich.js
 */

const API = 'https://watchfacts-poc.vercel.app/api/batch-enrich';

async function run() {
  let lastId = null;
  let total = 0;
  let totalUpdated = 0;
  let batch = 0;

  console.log('Starting batch enrichment...');
  console.log('========================================');

  while (true) {
    batch++;
    const body = { limit: 500, verdict: 'HUMAN,RECYCLE' };
    if (lastId) body.lastId = lastId;

    try {
      const resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        console.error(`Batch ${batch}: HTTP ${resp.status} — ${await resp.text()}`);
        break;
      }

      const data = await resp.json();
      total += data.processed;
      totalUpdated += data.updated;

      if (data.done || !data.nextLastId) {
        console.log(`Batch ${batch}: ${data.processed} processed, ${data.updated} updated — DONE`);
        break;
      }

      lastId = data.nextLastId;
      const pct = data.sample ? data.sample.map(s => `${s.reference}: ${s.oldVerdict}→${s.newVerdict} (${s.oldConfidence}→${s.newConfidence}%)`).join(', ') : '';
      console.log(`Batch ${batch}: ${data.processed} processed, ${data.updated} updated — total ${total}/${totalUpdated} — lastId: ${lastId.substring(0, 20)}… ${pct}`);

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));

    } catch (e) {
      console.error(`Batch ${batch} error:`, e.message);
      break;
    }
  }

  console.log('========================================');
  console.log(`Complete: ${total} records processed, ${totalUpdated} updated`);
}

run().catch(console.error);
