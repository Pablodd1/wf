#!/usr/bin/env node
/**
 * Continue batch enrichment from lastId
 * Usage: node batch-run-enrich-continue.js <lastId>
 * If no lastId, starts fresh.
 */

const API = 'https://watchfacts-poc.vercel.app/api/batch-enrich';
const START_ID = process.argv[2] || null;

async function run() {
  let lastId = START_ID;
  let total = 0;
  let totalUpdated = 0;
  let batch = 0;

  console.log(`Starting batch enrichment from ${lastId || 'beginning'}...`);
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
        console.error(`Batch ${batch}: HTTP ${resp.status}`);
        const text = await resp.text();
        console.error(text.substring(0, 300));
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
      console.log(`Batch ${batch}: ${data.processed} processed — total ${total}/${totalUpdated} — lastId: ${lastId.substring(0, 16)}...`);

      await new Promise(r => setTimeout(r, 300));

    } catch (e) {
      console.error(`Batch ${batch} error:`, e.message);
      break;
    }
  }

  console.log('========================================');
  console.log(`Complete: ${total} records processed, ${totalUpdated} updated`);
  console.log(`To resume from here: node batch-run-enrich-continue.js ${lastId}`);
}

run().catch(console.error);
