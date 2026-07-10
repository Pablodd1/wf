#!/usr/bin/env node
/**
 * HKD Repair Script — Local bulk re-parser
 * Bypasses Vercel timeout by running directly from your machine
 * 
 * Usage: node scripts/repair-hkd-bulk.js
 * 
 * Reads NULL-priced HKD records from Supabase,
 * re-parses them with parser v4.10,
 * writes corrected prices back in batch.
 */

const { createClient } = require('@supabase/supabase-js');
const { parseFull, parsePrice, parseCurrency } = require('../api/_lib/parser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Run: SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/repair-hkd-bulk.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const BATCH_SIZE = 500;
const REPORT_EVERY = 25; // Report progress every 25 batches

async function main() {
  console.log('Starting HKD bulk repair...\n');

  let offset = 0;
  let totalRepaired = 0;
  let totalFailed = 0;
  let batchCount = 0;
  let consecutiveEmpty = 0;
  const startTime = Date.now();

  while (true) {
    const { data: batch, error } = await supabase
      .from('watch_records')
      .select('id, raw_message')
      .is('price_usd', null)
      .ilike('raw_message', '%HKD%')
      .order('id')
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`DB error at offset ${offset}:`, error.message);
      break;
    }

    if (!batch || batch.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) {
        console.log('\nNo more NULL HKD records found (3 empty batches). Done.');
        break;
      }
      offset += BATCH_SIZE;
      continue;
    }
    consecutiveEmpty = 0;

    const updates = [];
    let batchRepaired = 0;
    let batchFailed = 0;

    for (const row of batch) {
      try {
        const parsed = parseFull(row.raw_message);
        const price = parsePrice(row.raw_message, parsed?.ref);
        const currency = parseCurrency(row.raw_message);

        if (price && price > 100) {
          updates.push({
            id: row.id,
            price_usd: price,
            currency: currency || 'USD'
          });
          batchRepaired++;
        } else {
          batchFailed++;
        }
      } catch {
        batchFailed++;
      }
    }

    // Batch update
    if (updates.length > 0) {
      for (let i = 0; i < updates.length; i += 50) {
        const chunk = updates.slice(i, i + 50);
        const { error: updateError } = await supabase
          .from('watch_records')
          .upsert(chunk, { onConflict: 'id' });
        
        if (updateError) {
          console.error(`Update error at offset ${offset}:`, updateError.message);
        }
      }
    }

    totalRepaired += batchRepaired;
    totalFailed += batchFailed;
    batchCount++;
    offset += BATCH_SIZE;

    // Progress report
    if (batchCount % REPORT_EVERY === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (totalRepaired / elapsed).toFixed(0);
      console.log(`[${elapsed}s] Batch ${batchCount}: ${totalRepaired} repaired, ${totalFailed} failed (${rate}/s)`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== DONE in ${totalTime}s ===`);
  console.log(`Repaired: ${totalRepaired}`);
  console.log(`Failed:   ${totalFailed}`);
  console.log(`Success rate: ${(totalRepaired / (totalRepaired + totalFailed) * 100).toFixed(1)}%`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
