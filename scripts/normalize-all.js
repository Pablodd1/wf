/**
 * scripts/normalize-all.js
 *
 * Batch re-parser for all 2.39M watch_records.
 * Runs locally (not Vercel — 60s timeout would kill it).
 *
 * FAST STRATEGY (v2):
 *   1. Fetch records in batches of 1000 (cursor pagination)
 *   2. Parse each raw_message with v3.1
 *   3. Build update objects in memory
 *   4. Write ALL updates in a single batch via upsert (onConflict: id)
 *   5. Skip human_edited records
 *
 * Usage:
 *   node scripts/normalize-all.js              # Full re-parse
 *   node scripts/normalize-all.js --inspect    # Dry run (no DB writes)
 *   node scripts/normalize-all.js --reviewed   # Only human_edited records
 *   node scripts/normalize-all.js --limit 100  # Test 100 batches
 */

const { createClient } = require('@supabase/supabase-js');
const { parseFull } = require('../api/_lib/parser');

// ─── Config ─────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

const BATCH_SIZE = 1000;
const PARSER_VERSION = 'v3.1';

// ─── Args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const INSPECT = args.includes('--inspect');
const REVIEWED_ONLY = args.includes('--reviewed');
const limitArg = args.find(a => a.startsWith('--limit'));
const MAX_BATCHES = limitArg ? parseInt(limitArg.split('=')[1] || limitArg.replace('--limit', '')) : Infinity;

// ─── Supabase ───────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Stats ──────────────────────────────────────────────────────────
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  skippedHumanEdited: 0,
  skippedNoRaw: 0,
  updated: 0,
  errors: 0,
  brandFixes: 0,
  refFixes: 0,
  priceFixes: 0,
  confidenceImproved: 0,
  confidenceWorsened: 0,
  startTime: Date.now(),
};

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  WatchFacts Normalization — Parser v3.1 (Fast Batch Mode)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Mode: ${INSPECT ? 'INSPECT (dry run)' : 'LIVE (DB writes)'}`);
  console.log(`  Filter: ${REVIEWED_ONLY ? 'human_edited only' : 'all records'}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Max batches: ${MAX_BATCHES === Infinity ? 'unlimited' : MAX_BATCHES}`);
  console.log('');

  let lastId = null;
  let batchNum = 0;

  while (batchNum < MAX_BATCHES) {
    // ─── Fetch batch ───
    let query = supabase
      .from('watch_records')
      .select('id, raw_message, brand, reference, dial_color, condition, price_usd, confidence, verdict, year, parser_version, human_edited')
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (lastId) query = query.gt('id', lastId);
    if (REVIEWED_ONLY) query = query.eq('human_edited', true);

    const { data: batch, error } = await query;

    if (error) {
      console.error(`  Batch ${batchNum}: FETCH ERROR: ${error.message}`);
      stats.errors++;
      break;
    }

    if (!batch || batch.length === 0) {
      console.log('  No more records. Done.');
      break;
    }

    lastId = batch[batch.length - 1].id;
    batchNum++;

    // ─── Parse all records in batch ───
    const updates = [];

    for (const record of batch) {
      stats.total++;

      if (record.human_edited && !REVIEWED_ONLY) {
        stats.skipped++;
        stats.skippedHumanEdited++;
        continue;
      }

      if (!record.raw_message) {
        stats.skipped++;
        stats.skippedNoRaw++;
        continue;
      }

      try {
        const parsed = parseFull(record.raw_message);

        // Preserve price_usd for non-USD currencies
        let finalPriceUsd = record.price_usd;
        if (parsed.currency === 'USD' && parsed.price) {
          finalPriceUsd = parsed.price;
        } else if (!record.price_usd && parsed.price) {
          finalPriceUsd = parsed.price;
        }

        // Preserve confidence (don't regress)
        let finalConfidence = record.confidence || 0;
        if (parsed.confidence > finalConfidence || !record.confidence) {
          finalConfidence = parsed.confidence;
        }

        const update = {
          id: record.id,
          brand: parsed.brand || record.brand,
          reference: parsed.ref || record.reference,
          dial_color: parsed.dial || record.dial_color,
          condition: parsed.condition || record.condition,
          price_usd: finalPriceUsd,
          confidence: finalConfidence,
          verdict: record.verdict,
          year: parsed.year || record.year,
          parser_version: PARSER_VERSION,
          reprocessed_at: new Date().toISOString(),
        };

        if (update.brand !== record.brand) stats.brandFixes++;
        if (update.reference !== record.reference) stats.refFixes++;
        if (update.price_usd !== record.price_usd) stats.priceFixes++;
        if (update.confidence > (record.confidence || 0)) stats.confidenceImproved++;
        if (update.confidence < (record.confidence || 0)) stats.confidenceWorsened++;

        stats.processed++;
        updates.push(update);
      } catch (parseErr) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`  Parse error on ${record.id}: ${parseErr.message}`);
        }
      }
    }

    // ─── Bulk upsert (FAST: single HTTP call per batch) ───
    if (!INSPECT && updates.length > 0) {
      const { error: upsertErr } = await supabase
        .from('watch_records')
        .upsert(updates, { onConflict: 'id', ignoreDuplicates: false });

      if (upsertErr) {
        console.error(`  Batch ${batchNum}: UPSERT ERROR: ${upsertErr.message}`);
        stats.errors++;
      } else {
        stats.updated += updates.length;
      }
    }

    // ─── Progress ───
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    const rate = (stats.total / elapsed).toFixed(0);
    const eta = ((2392784 - stats.total) / rate).toFixed(0);
    console.log(
      `  Batch ${batchNum} | ${stats.total.toLocaleString()} processed | ` +
      `${rate} rec/s | ETA ${eta}s | ` +
      `Brand+${stats.brandFixes} Ref+${stats.refFixes} Price+${stats.priceFixes} | ` +
      `Conf↑${stats.confidenceImproved} ↓${stats.confidenceWorsened} | ` +
      `Errors: ${stats.errors}`
    );

    if (batchNum % 10 === 0) {
      const fs = require('fs');
      fs.writeFileSync('/tmp/normalize-progress.json', JSON.stringify({
        ...stats,
        elapsed: parseFloat(elapsed),
        rate: parseFloat(rate),
        batch: batchNum,
        lastId,
      }, null, 2));
    }
  }

  // ─── Final report ───
  const totalElapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  NORMALIZATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total records scanned: ${stats.total.toLocaleString()}`);
  console.log(`  Records processed:     ${stats.processed.toLocaleString()}`);
  console.log(`  Records skipped:       ${stats.skipped.toLocaleString()}`);
  console.log(`    - Human edited:      ${stats.skippedHumanEdited.toLocaleString()}`);
  console.log(`    - No raw_message:    ${stats.skippedNoRaw.toLocaleString()}`);
  console.log(`  Records updated (DB):  ${stats.updated.toLocaleString()}`);
  console.log(`  Errors:                ${stats.errors}`);
  console.log('');
  console.log('  Field Fixes:');
  console.log(`    Brand changed:       ${stats.brandFixes.toLocaleString()}`);
  console.log(`    Reference changed:   ${stats.refFixes.toLocaleString()}`);
  console.log(`    Price changed:       ${stats.priceFixes.toLocaleString()}`);
  console.log('');
  console.log('  Confidence Changes:');
  console.log(`    Improved:            ${stats.confidenceImproved.toLocaleString()}`);
  console.log(`    Worsened:            ${stats.confidenceWorsened.toLocaleString()}`);
  console.log('');
  console.log(`  Time: ${totalElapsed}s`);
  console.log(`  Rate: ${(stats.total / totalElapsed).toFixed(0)} records/sec`);
  console.log('');

  const fs = require('fs');
  fs.writeFileSync('/tmp/normalize-final-report.json', JSON.stringify(stats, null, 2));
  console.log('  Report saved: /tmp/normalize-final-report.json');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
