/**
 * /api/batch-process.js
 *
 * Vercel serverless endpoint that processes the reprocess_queue in batches.
 * Called by GitHub Actions cron every 5 minutes.
 *
 * POST /api/batch-process
 *   Headers: Authorization: Bearer <CRON_SECRET>
 *   Body: { "batchSize": 100 }  (optional, default 100)
 *
 * Also handles enqueuing from human review / AI corrections:
 * POST /api/batch-process/enqueue
 *   Body: { "recordId": "...", "reason": "human_edit" }
 */

'use strict';

const { parseFull, verdict, toUSD, classifyListingType } = require('./_lib/parser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const PARSER_VERSION = 'v2.0';

const HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

// ─── AUTH ──────────────────────────────────────────────────────────────────────
function isAuthorized(req) {
  if (!CRON_SECRET) return true; // not configured — open (dev only)
  const token = (req.headers['authorization'] || '').replace('Bearer ', '')
    || req.headers['x-cron-secret'];
  return token === CRON_SECRET;
}

// ─── QUEUE HELPERS ─────────────────────────────────────────────────────────────
async function dequeueNext(batchSize) {
  // Atomically claim a batch: mark started_at = NOW() and return them
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/claim_reprocess_batch`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ batch_size: batchSize }),
    }
  );
  if (!res.ok) {
    // Fallback: simple SELECT if the RPC doesn't exist yet
    const fallback = await fetch(
      `${SUPABASE_URL}/rest/v1/reprocess_queue?select=id,record_id,reason&completed_at=is.null&started_at=is.null&order=priority.asc,queued_at.asc&limit=${batchSize}`,
      { headers: HEADERS }
    );
    if (!fallback.ok) return [];
    return await fallback.json();
  }
  return await res.json();
}

async function fetchRecords(recordIds) {
  const idList = recordIds.map(id => `"${id}"`).join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/watch_records?select=id,raw_message,brand,reference,price_usd,currency,source&id=in.(${idList})`,
    { headers: HEADERS }
  );
  if (!res.ok) return [];
  return await res.json();
}

async function updateRecord(update) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${update.id}`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify(update),
    }
  );
  return res.ok;
}

async function markQueueComplete(queueId, error = null) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/reprocess_queue?id=eq.${queueId}`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        completed_at: new Date().toISOString(),
        parser_version: PARSER_VERSION,
        error: error,
      }),
    }
  );
}

async function enqueue(recordId, reason, priority = 5) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/reprocess_queue`,
    {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ record_id: recordId, reason, priority }),
    }
  );
  return res.ok;
}

// ─── PROCESS ONE RECORD ────────────────────────────────────────────────────────
function processRecord(record) {
  const text = record.raw_message || '';
  if (!text.trim()) return null;
  try {
    const parsed = parseFull(text);
    if (!parsed) return null;
    const v = verdict(parsed);
    const listingType = typeof classifyListingType === 'function'
      ? classifyListingType(text) : 'WTS';
    return {
      id:               record.id,
      brand:            parsed.brand    || record.brand,
      reference:        parsed.ref      || record.reference,
      dial_color:       parsed.dial     || null,
      condition:        parsed.condition || null,
      year:             parsed.year     || null,
      price_raw:        parsed.price    || null,
      price_usd:        parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : record.price_usd,
      currency:         parsed.currency || record.currency,
      confidence:       parsed.confidence,
      verdict:          v,
      listing_type:     listingType,
      accessories:      parsed.accessories      ? parsed.accessories      : null,
      month_code:       parsed.month_code       || null,
      field_confidence: parsed.field_confidence || null,
      processed_at:     new Date().toISOString(),
      parser_version:   PARSER_VERSION,
    };
  } catch (e) {
    return null;
  }
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cron-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const url   = new URL(req.url, `http://${req.headers.host}`);
  const body  = req.body || {};

  // ── Enqueue endpoint: POST /api/batch-process?action=enqueue ──
  if (url.searchParams.get('action') === 'enqueue' || body.action === 'enqueue') {
    const { recordId, reason = 'human_edit', priority = 1 } = body;
    if (!recordId) return res.status(400).json({ error: 'recordId required' });
    const ok = await enqueue(recordId, reason, priority);
    return res.status(ok ? 200 : 500).json({ ok, queued: recordId, reason });
  }

  // ── Main: process next batch from queue ──
  const batchSize = Math.min(body.batchSize || 100, 200); // cap at 200 for 60s timeout
  const startTime = Date.now();
  const results   = { processed: 0, skipped: 0, errors: 0, elapsed_ms: 0 };

  try {
    const queueItems = await dequeueNext(batchSize);
    if (!queueItems.length) {
      return res.status(200).json({ ok: true, message: 'Queue empty', ...results });
    }

    const recordIds = queueItems.map(q => q.record_id);
    const records   = await fetchRecords(recordIds);
    const recordMap = new Map(records.map(r => [r.id, r]));

    for (const queueItem of queueItems) {
      // Bail out if we're approaching Vercel's 60s timeout
      if (Date.now() - startTime > 50000) {
        console.warn('[batch-process] Approaching timeout — stopping early');
        break;
      }

      const record = recordMap.get(queueItem.record_id);
      if (!record) {
        await markQueueComplete(queueItem.id, 'record_not_found');
        results.skipped++;
        continue;
      }

      const update = processRecord(record);
      if (!update) {
        await markQueueComplete(queueItem.id, 'parse_failed');
        results.skipped++;
        continue;
      }

      try {
        const ok = await updateRecord(update);
        await markQueueComplete(queueItem.id, ok ? null : 'update_failed');
        if (ok) results.processed++; else results.errors++;
      } catch (e) {
        await markQueueComplete(queueItem.id, e.message);
        results.errors++;
      }
    }

    results.elapsed_ms = Date.now() - startTime;
    return res.status(200).json({ ok: true, ...results });

  } catch (e) {
    console.error('[batch-process] Fatal:', e.message);
    return res.status(500).json({ error: e.message, ...results });
  }
};
