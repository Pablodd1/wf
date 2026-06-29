#!/usr/bin/env node
/**
 * reprocess-local.js — Local 2.39M Batch Processor
 * Runs outside Vercel — no 60s timeout, processes as fast as Supabase allows.
 *
 * Usage:
 *   node scripts/reprocess-local.js                # Process all batches
 *   node scripts/reprocess-local.js --batches=10   # Process 10 batches
 *   node scripts/reprocess-local.js --delay=100    # 100ms between batches
 *   node scripts/reprocess-local.js --offset=500   # Start from batch 500
 *   node scripts/reprocess-local.js --dry-run      # Parse only, no DB writes
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { parseFull, verdict, toUSD, classifyListingType } = require('../api/_lib/parser.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const BATCH_SIZE = 1000;
const PARSER_VERSION = 'v3.0';

const args = process.argv.slice(2).reduce((acc, arg) => {
  if (arg.startsWith('--')) {
    const [k, v] = arg.slice(2).split('=');
    acc[k] = v === undefined ? true : isNaN(v) ? v : Number(v);
  }
  return acc;
}, {});

const MAX_BATCHES = args.batches || Infinity;
const DELAY_MS = args.delay || 500;
const START_BATCH = args.offset || 1;
const DRY_RUN = args['dry-run'] || false;

if (!SUPABASE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ─────────────────────────────────────────────────────────────────
async function getNextPending() {
  const { data, error } = await supabase
    .from('reprocessing_queue')
    .select('*')
    .eq('status', 'pending')
    .gte('batch_number', START_BATCH)
    .order('batch_number', { ascending: true })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

async function fetchRecords(offset, limit) {
  const { data, error } = await supabase
    .from('watch_records')
    .select('id,raw_message,brand,reference,price_usd,currency,source,dealer_name,verdict,confidence,listing_type,condition,dial_color,year,price_raw')
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) { console.error('fetch error:', error.message); return []; }
  return data || [];
}

function processRecord(record) {
  const text = record.raw_message || '';
  if (!text.trim()) return null;
  try {
    const parsed = parseFull(text);
    if (!parsed) return null;
    const v = verdict(parsed);
    const listingType = typeof classifyListingType === 'function' ? classifyListingType(text) : 'WTS';
    return {
      id: record.id,
      brand: parsed.brand || record.brand,
      reference: parsed.ref || record.reference,
      dial_color: parsed.dial || record.dial_color,
      condition: parsed.condition || record.condition,
      year: parsed.year || record.year,
      price_raw: parsed.price || record.price_raw,
      price_usd: parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : record.price_usd,
      currency: parsed.currency || record.currency,
      confidence: parsed.confidence,
      verdict: v,
      listing_type: listingType,
      accessories: parsed.accessories ? JSON.stringify(parsed.accessories) : record.accessories,
      field_confidence: parsed.fieldConfidence ? JSON.stringify(parsed.fieldConfidence) : record.field_confidence,
      processed_at: new Date().toISOString(),
      parser_version: PARSER_VERSION,
    };
  } catch (e) {
    return { id: record.id, error: e.message };
  }
}

// ── Stats ───────────────────────────────────────────────────────────────────
let totalProcessed = 0, totalSkipped = 0, totalErrors = 0, batchCount = 0;
const startTime = Date.now();

// ── Main loop ───────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  WatchFacts — Local 2.39M Reprocessing Engine');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Mode:  ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE'}`);
  console.log(`  Start: Batch #${START_BATCH}`);
  console.log(`  Max:   ${MAX_BATCHES === Infinity ? 'ALL' : MAX_BATCHES} batches`);
  console.log(`  Delay: ${DELAY_MS}ms between batches`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const { data: progress } = await supabase.from('reprocessing_progress').select('*').eq('id', 1).single();
  if (progress) {
    console.log(`  Records: ${progress.total_records?.toLocaleString()}`);
    console.log(`  Batches: ${progress.total_batches?.toLocaleString()}`);
    console.log(`  Done:    ${progress.batches_completed?.toLocaleString()}`);
    console.log(`  Pending: ${(progress.total_batches - progress.batches_completed)?.toLocaleString()}\n`);
  }

  console.log('  Starting in 3s... (Ctrl+C to stop)\n');
  await new Promise(r => setTimeout(r, 3000));

  await supabase.from('reprocessing_progress').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', 1);

  let consecutiveEmpty = 0;
  while (batchCount < MAX_BATCHES) {
    const batch = await getNextPending();
    if (!batch) {
      if (++consecutiveEmpty >= 3) { console.log('\n✅ All done!'); break; }
      await new Promise(r => setTimeout(r, 2000)); continue;
    }
    consecutiveEmpty = 0; batchCount++;
    process.stdout.write(`  [#${batch.batch_number}] offset=${batch.offset_start.toLocaleString()} ... `);

    const t0 = Date.now();
    await supabase.from('reprocessing_queue').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', batch.id);

    const records = await fetchRecords(batch.offset_start, batch.batch_size);
    let processed = 0, skipped = 0, errors = 0;

    for (const record of records) {
      if (DRY_RUN) { processed++; continue; }
      const update = processRecord(record);
      if (!update) { skipped++; continue; }
      if (update.error) { errors++; continue; }
      try {
        const { error: upErr } = await supabase.from('watch_records').update(update).eq('id', update.id);
        if (upErr) errors++; else processed++;
      } catch (e) { errors++; }
    }

    const elapsed = Date.now() - t0;
    totalProcessed += processed; totalSkipped += skipped; totalErrors += errors;

    await supabase.from('reprocessing_queue').update({
      status: errors > 50 ? 'failed' : 'completed',
      records_processed: processed + skipped + errors,
      records_updated: processed,
      error_message: errors > 0 ? `${errors} errors` : null,
      completed_at: new Date().toISOString(),
    }).eq('id', batch.id);

    console.log(`${processed}p/${skipped}s/${errors}e in ${(elapsed/1000).toFixed(1)}s`);
    if (DELAY_MS > 0) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const totalTime = Date.now() - startTime;
  await supabase.from('reprocessing_progress').update({
    status: 'completed', completed_at: new Date().toISOString(),
  }).eq('id', 1);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  FINAL REPORT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Batches:  ${batchCount.toLocaleString()}`);
  console.log(`  Processed: ${totalProcessed.toLocaleString()}`);
  console.log(`  Skipped:   ${totalSkipped.toLocaleString()}`);
  console.log(`  Errors:    ${totalErrors.toLocaleString()}`);
  console.log(`  Time:      ${(totalTime/1000/60).toFixed(1)} min`);
  console.log(`  Rate:      ${Math.round(totalProcessed / (totalTime/1000))} rec/s`);
  console.log('═══════════════════════════════════════════════════════════');
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown() {
  console.log('\n\n⚠️  Saving progress...');
  const { data: p } = await supabase.from('reprocessing_progress').select('*').eq('id', 1).single();
  if (p) {
    await supabase.from('reprocessing_progress').update({
      status: 'paused', last_batch_at: new Date().toISOString(),
    }).eq('id', 1);
  }
  console.log(`  Saved ${batchCount} batches, ${totalProcessed} records`);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
