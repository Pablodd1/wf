#!/usr/bin/env node
/**
 * push-to-supabase.js v4.4
 * Pushes corrected WTS reports to Supabase watch_records table.
 * Reads Desktop TSV files and upserts into Supabase.
 * Skips rows with verdict RECYCLE / NEEDS_MANUAL_REVIEW (likely garbage).
 */

const fs = require('fs');
const path = require('path');
const { parse: csvParse } = require('csv-parse/sync');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'resolution=merge-duplicates,return=minimal',
};

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const BRAND_FILES = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_WTS_') && f.endsWith('_corrected.tsv'))
  .map(f => path.join(DESKTOP, f));

console.log(`Found ${BRAND_FILES.length} brand files`);

async function pushFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || null; });
    
    // Skip garbage verdicts
    if (['RECYCLE', 'NEEDS_MANUAL_REVIEW'].includes(row.verdict)) continue;
    // Skip rows with no reference (useless for discovery)
    if (!row.reference) continue;
    
    rows.push({
      raw_message: row.raw_message || row.RAW_MESSAGE || null,
      brand: row.brand,
      reference: row.reference,
      dial_color: row.dial_color || null,
      price_usd: row.price_usd ? parseFloat(row.price_usd) : null,
      currency: row.currency || null,
      condition: row.condition || null,
      year: row.year ? parseInt(row.year) : null,
      verdict: row.verdict,
      review_reason: row.review_reason || null,
      listing_type: row.listing_type || 'WTS',
      confidence: row.confidence ? parseInt(row.confidence) : null,
      parser_version: 'v4.4',
      processed_at: new Date().toISOString(),
    });
  }
  
  console.log(`  ${path.basename(filePath)}: ${rows.length} rows to push`);
  
  // Batch upsert (100 rows at a time)
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`  Batch ${i}-${i+batchSize} failed:`, err);
    }
  }
}

async function main() {
  for (const file of BRAND_FILES) {
    await pushFile(file);
  }
  console.log('Done.');
}

main().catch(console.error);
