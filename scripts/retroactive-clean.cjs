#!/usr/bin/env node
/**
 * scripts/retroactive-clean.cjs
 *
 * Simulates the CLEAN tab background agent task.
 * 1. Scans live_ingest database table in batches.
 * 2. Deduplicates records based on strict message + dealer hash.
 * 3. Normalizes currencies and brand/reference info using updated parser logic.
 * 4. Persists deletions (duplicates) and updates back to Supabase.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env.supabase');
let SUPABASE_URL = process.env.SUPABASE_URL;
let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/(^"|"$)/g, '');
      if (k === 'SUPABASE_URL') SUPABASE_URL = v;
      if (k === 'SUPABASE_SERVICE_ROLE_KEY') SUPABASE_KEY = v;
    }
  });
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[fatal] Missing Supabase credentials in environment or .env.supabase');
  process.exit(1);
}

// ─── LOAD PARSER ───────────────────────────────────────────────────────────────
const parserPath = path.join(__dirname, '..', 'api', '_lib', 'parser.js');
let parseFull, hashMessage, toUSD, verdict;
try {
  const parser = require(parserPath);
  parseFull = parser.parseFull;
  hashMessage = parser.hashMessage;
  toUSD = parser.toUSD;
  verdict = parser.verdict;
  console.log(`[parser] Loaded from ${parserPath}`);
} catch (e) {
  console.error('[fatal] Could not load parser:', e.message);
  process.exit(1);
}

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function runClean() {
  console.log('Starting retroactive clean and deduplication...');
  
  let lastId = null;
  const limit = 1000;
  let finished = false;
  let totalProcessed = 0;
  let duplicatesDeleted = 0;
  let recordsUpdated = 0;

  const seenHashes = new Map(); // hash -> { id, received_at, last_seen }
  const toDeleteIds = [];
  const toUpdateRecords = [];

  while (!finished) {
    let url = `${SUPABASE_URL}/rest/v1/live_ingest?select=*&limit=${limit}&order=id.asc`;
    if (lastId) {
      url += `&id=gt.${encodeURIComponent(lastId)}`;
    }

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      const err = await res.text();
      console.error('Fetch failed:', err);
      break;
    }

    const rows = await res.json();
    if (rows.length === 0) {
      finished = true;
      break;
    }

    console.log(`Loaded batch of ${rows.length} records. Processing...`);

    for (const row of rows) {
      totalProcessed++;
      lastId = row.id;

      // 1. Calculate deduplication hash: [Message_Text] + [Dealer/Source_ID]
      const compositeHash = hashMessage((row.raw_message || '') + '|' + (row.channel_id || ''));

      if (seenHashes.has(compositeHash)) {
        // We found a duplicate! Mark this row for deletion.
        toDeleteIds.push(row.id);
        duplicatesDeleted++;

        // Update the last_seen of the original record to the most recent received_at
        const original = seenHashes.get(compositeHash);
        const originalDate = new Date(original.last_seen || original.received_at);
        const currentDate = new Date(row.received_at);
        if (currentDate > originalDate) {
          original.last_seen = row.received_at;
          // Update original record in database (enqueue update)
          toUpdateRecords.push({
            id: original.id,
            last_seen: row.received_at,
          });
        }
      } else {
        seenHashes.set(compositeHash, {
          id: row.id,
          received_at: row.received_at,
          last_seen: row.last_seen || row.received_at,
        });

        // 2. Normalization & Recalculation (parser updates)
        const parsed = parseFull(row.raw_message);
        const priceUSD = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null;
        const v = verdict({ ...parsed, confidence: parsed.confidence });

        const needsUpdate = 
          row.brand !== (parsed.brand || 'Unknown') ||
          row.reference !== (parsed.ref || null) ||
          row.price_usd !== priceUSD ||
          row.currency !== (parsed.currency || null) ||
          row.message_hash !== compositeHash;

        if (needsUpdate) {
          toUpdateRecords.push({
            id: row.id,
            brand: parsed.brand || 'Unknown',
            reference: parsed.ref || null,
            price_usd: priceUSD,
            currency: parsed.currency || null,
            verdict: v,
            message_hash: compositeHash,
          });
          recordsUpdated++;
        }
      }
    }

    if (rows.length < limit) {
      finished = true;
    }
  }

  console.log(`Deduplication scan complete. Found ${duplicatesDeleted} duplicates and ${recordsUpdated} records needing updates.`);

  // Perform updates in batches
  if (toUpdateRecords.length > 0) {
    console.log(`Executing ${toUpdateRecords.length} updates...`);
    const batchSize = 100;
    for (let i = 0; i < toUpdateRecords.length; i += batchSize) {
      const batch = toUpdateRecords.slice(i, i + batchSize);
      // PostgREST bulk update: UPSERT with merge duplicates
      const res = await fetch(`${SUPABASE_URL}/rest/v1/live_ingest`, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error(`Update batch failed: ${res.statusText}`);
      }
    }
  }

  // Perform deletions in batches
  if (toDeleteIds.length > 0) {
    console.log(`Executing ${toDeleteIds.length} deletions...`);
    const batchSize = 100;
    for (let i = 0; i < toDeleteIds.length; i += batchSize) {
      const batch = toDeleteIds.slice(i, i + batchSize);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/live_ingest?id=in.(${batch.map(encodeURIComponent).join(',')})`, {
        method: 'DELETE',
        headers: HEADERS,
      });
      if (!res.ok) {
        console.error(`Delete batch failed: ${res.statusText}`);
      }
    }
  }

  console.log('Retroactive clean complete successfully.');
  console.log(`Processed: ${totalProcessed}, Deleted Duplicates: ${duplicatesDeleted}, Updated: ${recordsUpdated}`);
}

runClean();
