/**
 * scripts/normalize-all.js
 *
 * Batch re-parser for all 2.39M watch_records.
 * Runs locally (not Vercel — 60s timeout would kill it).
 *
 * Strategy:
 *   1. Fetch records in batches of 1000 (by id cursor, not offset)
 *   2. Run parseFull() on raw_message
 *   3. Update brand, reference, dial_color, condition, price_usd,
 *      confidence, verdict, year, parser_version, reprocessed_at
 *   4. Skip records where human_edited = true (user reviewed them)
 *   5. Log progress every batch
 *
 * Usage:
 *   node scripts/normalize-all.js              # Full re-parse (all records)
 *   node scripts/normalize-all.js --inspect    # Parse only, no DB writes (dry run)
 *   node scripts/normalize-all.js --reviewed   # Only re-parse human_edited records
 *   node scripts/normalize-all.js --limit 100  # Process only 100 batches
 *
 * Requirements:
 *   - SUPABASE_SERVICE_ROLE_KEY in env or .env.local
 *   - parser.js at api/_lib/parser.js
 */

const { createClient } = require('@supabase/supabase-js');
const { parseFull, confidenceTier } = require('../api/_lib/parser');

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
  verdictChanges: { APPROVED: 0, REVIEW: 0, HUMAN: 0, RECYCLE: 0 },
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
  console.log('  WatchFacts Normalization — Parser v3.1');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Mode: ${INSPECT ? 'INSPECT (dry run)' : 'LIVE (DB writes)'}`);
  console.log(`  Filter: ${REVIEWED_ONLY ? 'human_edited only' : 'all records'}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Max batches: ${MAX_BATCHES === Infinity ? 'unlimited' : MAX_BATCHES}`);
  console.log('');

  // Get total count
  const { data: countData } = await supabase
    .from('watch_records')
    .select('id')
    .limit(1);
  console.log(`  Connected to Supabase. Sample record: ${countData?.[0]?.id || 'none'}`);
  console.log('');

  let lastId = null;
  let batchNum = 0;

  while (batchNum < MAX_BATCHES) {
    // ─── Fetch batch by cursor (id > lastId) ───
    let query = supabase
      .from('watch_records')
      .select('id, raw_message, brand, reference, dial_color, condition, price_usd, confidence, verdict, year, parser_version, human_edited')
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (lastId) {
      query = query.gt('id', lastId);
    }

    if (REVIEWED_ONLY) {
      query = query.eq('human_edited', true);
    }

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

    // ─── Process each record ───
    const updates = [];

    for (const record of batch) {
      stats.total++;

      // Skip human-edited records (user already reviewed them)
      if (record.human_edited && !REVIEWED_ONLY) {
        stats.skipped++;
        stats.skippedHumanEdited++;
        continue;
      }

      // Skip records without raw_message
      if (!record.raw_message) {
        stats.skipped++;
        stats.skippedNoRaw++;
        continue;
      }

      // Parse with v3.1
      try {
        const parsed = parseFull(record.raw_message);

        // Currency conversion: preserve existing price_usd if parser
        // extracts a non-USD price (HKD, EUR, etc). Only overwrite
        // price_usd if parser found a USD price or if DB has no price.
        let finalPriceUsd = record.price_usd;
        if (parsed.currency === 'USD' && parsed.price) {
          finalPriceUsd = parsed.price;
        } else if (!record.price_usd && parsed.price) {
          // No existing USD price — use parsed price as-is (may be HKD etc)
          finalPriceUsd = parsed.price;
        }

        // Confidence: only update if v3.1 improves it or if no existing confidence.
        // v2.0 confidence formula is unknown (stored in DB) — don't regress.
        let finalConfidence = record.confidence || 0;
        if (parsed.confidence > finalConfidence || !record.confidence) {
          finalConfidence = parsed.confidence;
        }

        // Build update object
        const update = {
          brand: parsed.brand || record.brand,
          reference: parsed.ref || record.reference,
          dial_color: parsed.dial || record.dial_color,
          condition: parsed.condition || record.condition,
          price_usd: finalPriceUsd,
          confidence: finalConfidence,
          verdict: record.verdict, // Don't change verdict during normalization
          year: parsed.year || record.year,
          parser_version: PARSER_VERSION,
          reprocessed_at: new Date().toISOString(),
        };

        // Track changes
        if (update.brand !== record.brand) stats.brandFixes++;
        if (update.reference !== record.reference) stats.refFixes++;
        if (update.price_usd !== record.price_usd) stats.priceFixes++;
        if (update.confidence > (record.confidence || 0)) stats.confidenceImproved++;
        if (update.confidence < (record.confidence || 0)) stats.confidenceWorsened++;
        if (update.verdict !== record.verdict) {
          stats.verdictChanges[update.verdict] = (stats.verdictChanges[update.verdict] || 0) + 1;
        }

        stats.processed++;

        if (!INSPECT) {
          updates.push({ id: record.id, ...update });
        }
      } catch (parseErr) {
        stats.errors++;
        if (stats.errors <= 5) {
          console.error(`  Parse error on ${record.id}: ${parseErr.message}`);
        }
      }
    }

    // ─── Batch DB update (individual updates — Supabase doesn't support bulk-different-updates) ───
    if (!INSPECT && updates.length > 0) {
      for (const u of updates) {
        const { id, ...updateData } = u;
        const { error: updateErr } = await supabase
          .from('watch_records')
          .update(updateData)
          .eq('id', id);

        if (updateErr) {
          stats.errors++;
          if (stats.errors <= 10) {
            console.error(`  Update error on ${id}: ${updateErr.message}`);
          }
        } else {
          stats.updated++;
        }
      }
    }

    // ─── Progress log ───
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

    // Flush progress to a file for monitoring
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
  console.log('  Verdict Changes:');
  for (const [v, c] of Object.entries(stats.verdictChanges)) {
    if (c > 0) console.log(`    → ${v}: ${c.toLocaleString()}`);
  }
  console.log('');
  console.log(`  Time: ${totalElapsed}s`);
  console.log(`  Rate: ${(stats.total / totalElapsed).toFixed(0)} records/sec`);
  console.log('');

  // Write final report
  const fs = require('fs');
  fs.writeFileSync('/tmp/normalize-final-report.json', JSON.stringify(stats, null, 2));
  console.log('  Report saved: /tmp/normalize-final-report.json');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
