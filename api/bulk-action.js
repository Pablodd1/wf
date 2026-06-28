/**
 * /api/bulk-action.js
 *
 * CommonJS module for Vercel Serverless Function.
 * Handles bulk actions from Admin Page:
 *   - reprocess: reprocesses the first 100 HUMAN/RECYCLE records
 *   - deduplicate: removes duplicate listings where reference, price_usd, and year match exactly in same batch
 */

const { parseFull, verdict, toUSD, classifyListingType } = require('./_lib/parser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function handleReprocess(limit = 100) {
  // 1. Fetch HUMAN and RECYCLE records
  const url = `${SUPABASE_URL}/rest/v1/watch_records?select=id,raw_message,brand,reference,price_usd,currency&verdict=in.(HUMAN,RECYCLE)&limit=${limit}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch records to reprocess: ${res.statusText}`);
  }
  const records = await res.json();
  if (records.length === 0) {
    return { processed: 0, message: 'No HUMAN or RECYCLE records found to reprocess.' };
  }

  let processedCount = 0;
  // 2. Reprocess each record
  for (const record of records) {
    const text = record.raw_message || '';
    if (!text.trim()) continue;

    try {
      const parsed = parseFull(text);
      if (!parsed) continue;

      const v = verdict(parsed);
      const listingType = typeof classifyListingType === 'function' ? classifyListingType(text) : 'WTS';

      const update = {
        brand: parsed.brand || record.brand,
        reference: parsed.ref || record.reference,
        dial_color: parsed.dial || null,
        condition: parsed.condition || null,
        year: parsed.year || null,
        price_raw: parsed.price || null,
        price_usd: parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : record.price_usd,
        currency: parsed.currency || record.currency,
        confidence: parsed.confidence,
        verdict: v,
        listing_type: listingType,
        accessories: parsed.accessories ? parsed.accessories : null,
        month_code: parsed.month_code || null,
        field_confidence: parsed.field_confidence || null,
        processed_at: new Date().toISOString(),
        parser_version: 'v2.0-bulk',
      };

      // Patch the record back to Supabase
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${record.id}`,
        {
          method: 'PATCH',
          headers: { ...HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify(update),
        }
      );
      if (patchRes.ok) {
        processedCount++;
      }
    } catch (e) {
      console.error(`[bulk-action] Error reprocessing record ${record.id}:`, e.message);
    }
  }

  return {
    processed: processedCount,
    message: `Successfully re-processed ${processedCount} of ${records.length} records.`,
  };
}

async function handleDeduplicate() {
  console.log('[bulk-action] Fetching all records for deduplication...');
  
  let allRecords = [];
  let page = 0;
  const pageSize = 10000;
  let hasMore = true;

  while (hasMore) {
    const url = `${SUPABASE_URL}/rest/v1/watch_records?select=id,reference,price_usd,year,created_at,confidence&limit=${pageSize}&offset=${page * pageSize}`;
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
      throw new Error(`Failed to fetch records: ${response.statusText}`);
    }
    const data = await response.json();
    allRecords.push(...data);
    if (data.length < pageSize) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.log(`[bulk-action] Total records fetched: ${allRecords.length}`);

  const groups = new Map();
  const toDeleteIds = [];

  for (const r of allRecords) {
    if (!r.reference) continue;

    // Use ISO string without seconds for grouping to catch same-batch entries
    const dateStr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 16) : 'no-date';
    const key = `${r.reference.trim().toUpperCase()}|${r.price_usd || 0}|${r.year || 0}|${dateStr}`;

    if (!groups.has(key)) {
      groups.set(key, r);
    } else {
      const existing = groups.get(key);
      if ((r.confidence || 0) > (existing.confidence || 0)) {
        toDeleteIds.push(existing.id);
        groups.set(key, r);
      } else {
        toDeleteIds.push(r.id);
      }
    }
  }

  console.log(`[bulk-action] Found ${toDeleteIds.length} duplicates to remove.`);

  const chunkSize = 100;
  for (let i = 0; i < toDeleteIds.length; i += chunkSize) {
    const chunk = toDeleteIds.slice(i, i + chunkSize);
    const deleteUrl = `${SUPABASE_URL}/rest/v1/watch_records?id=in.(${chunk.map(id => `"${id}"`).join(',')})`;
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: HEADERS,
    });
    if (!deleteResponse.ok) {
      throw new Error(`Failed to delete batch starting at index ${i}: ${deleteResponse.statusText}`);
    }
  }

  return {
    deleted: toDeleteIds.length,
    message: `Deduplication complete. Removed ${toDeleteIds.length} duplicate records.`,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase credentials are not configured.' });
  }

  const { action } = req.body || {};
  if (!action) {
    return res.status(400).json({ error: 'Action parameter is required.' });
  }

  try {
    if (action === 'reprocess') {
      const result = await handleReprocess(100);
      return res.status(200).json({ success: true, message: result.message, processed: result.processed });
    } else if (action === 'deduplicate') {
      const result = await handleDeduplicate();
      return res.status(200).json({ success: true, message: result.message, duplicates_removed: result.deleted });
    } else {
      return res.status(400).json({ error: `Unsupported action: ${action}` });
    }
  } catch (err) {
    console.error(`[bulk-action] Error executing ${action}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
};
