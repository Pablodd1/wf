#!/usr/bin/env node
/**
 * push-to-supabase-v2.js
 * Reads Desktop TSV files directly (no csv-parse needed).
 * Upserts to Supabase watch_records table.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Load .env file
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  lines.forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}
loadEnv(path.join(__dirname, '../.env'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const files = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_WTS_') && f.endsWith('_corrected.tsv'));

console.log(`Found ${files.length} brand files to push...`);
console.log('(Skipping RECYCLE and NEEDS_MANUAL_REVIEW verdicts)');
console.log('(Skipping rows with no reference)');
console.log('');

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
    // Skip rows with no reference
    if (!row.reference) continue;
    
    rows.push({
      id: crypto.randomUUID(),
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
  
  // Batch upsert (50 rows at a time)
  const batchSize = 50;
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(batch),
      });
      if (res.ok) {
        successCount += batch.length;
      } else {
        const err = await res.text();
        console.error(`  Batch ${i}-${i+batch.length} failed:`, err.substring(0, 200));
        errorCount += batch.length;
      }
    } catch (e) {
      console.error(`  Batch ${i}-${i+batch.length} error:`, e.message);
      errorCount += batch.length;
    }
  }
  
  console.log(`    ✓ ${successCount} success, ✗ ${errorCount} errors`);
}

async function main() {
  for (const file of files) {
    await pushFile(path.join(DESKTOP, file));
  }
  console.log('\nDone — data pushed to Supabase.');
  console.log('Admin panel: https://watchfacts-poc.vercel.app');
}

main().catch(console.error);
