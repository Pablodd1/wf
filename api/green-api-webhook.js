/**
 * GREEN API WEBHOOK RECEIVER — /api/green-api-webhook
 *
 * Receives ALL incoming WhatsApp messages from Green API at scale.
 * Uses the shared parser (api/_lib/parser.js) for unified parsing.
 * Dual-writes to live_ingest (real-time stream) + watch_records (main catalog).
 *
 * Green API sends POST with body:
 * { type: "incomingMessage", body: { messageData: {...}, senderData: {...} } }
 *
 * ENV VARS:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const {
  parseFull, splitMultiWatch, verdict,
  toUSD, hashMessage,
  APPROVE_THRESHOLD,
} = require('./_lib/parser');

// ─── Helper: map shared parser output → green-api record format ───
function parsedToRecord(parsed, part, chatId, idx) {
  const priceUSD = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null;
  const v = verdict(parsed);

  return {
    id: `ga_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 6)}`,
    raw_message: part.substring(0, 2000),
    brand: parsed.brand || 'Unknown',
    reference: parsed.ref || null,
    dial_color: parsed.dial || null,
    condition: parsed.condition || null,
    year: parsed.year || null,
    price_raw: parsed.price || null,
    price_usd: priceUSD,
    currency: parsed.currency || 'USD',
    confidence: parsed.confidence,
    verdict: v,
    source: 'green_api',
    channel_id: chatId,
    received_at: new Date().toISOString(),
  };
}

// ─── SUPABASE BATCH INSERT (live_ingest) ───
async function batchInsert(records) {
  if (!records.length || !SUPABASE_URL || !SUPABASE_KEY) return { inserted: 0, failed: 0 };
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/live_ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(records),
    });
    if (resp.ok) return { inserted: records.length, failed: 0 };
    if (records.length > 100) {
      const mid = Math.floor(records.length / 2);
      const r1 = await batchInsert(records.slice(0, mid));
      const r2 = await batchInsert(records.slice(mid));
      return { inserted: r1.inserted + r2.inserted, failed: r1.failed + r2.failed };
    }
    return { inserted: 0, failed: records.length };
  } catch (e) {
    return { inserted: 0, failed: records.length, error: e.message };
  }
}

// ─── DUAL-WRITE TO watch_records ───
async function writeToWatchRecords(records) {
  if (!records.length || !SUPABASE_URL || !SUPABASE_KEY) return 0;
  try {
    const wrRecords = records.map(r => ({
      id: r.id,
      brand: r.brand,
      reference: r.reference,
      dial_color: r.dial_color,
      condition: r.condition,
      year: r.year,
      price_raw: r.price_raw,
      price_usd: r.price_usd,
      currency: r.currency,
      confidence: r.confidence,
      verdict: r.verdict,
      source: r.source,
      raw_message: r.raw_message,
      channel_id: r.channel_id,
      received_at: r.received_at,
    }));
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(wrRecords),
    });
    return resp.ok ? wrRecords.length : 0;
  } catch (e) {
    console.error('[green-api] watch_records write failed:', e.message);
    return 0;
  }
}

// ─── IN-MEMORY DEDUP CACHE ───
const dedupCache = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000;

function isDuplicate(hash) {
  const now = Date.now();
  for (const [key, ts] of dedupCache) {
    if (now - ts > DEDUP_TTL_MS) dedupCache.delete(key);
  }
  if (dedupCache.has(hash)) return true;
  dedupCache.set(hash, now);
  return false;
}

// ─── MESSAGE HASH (chat-aware) ───
function messageHash(text, chatId) {
  const cleaned = text
    .toLowerCase()
    .replace(/[\u2600-\u27BF\u{1F000}-\u{1FAFF}\uFE0F]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
  return `${chatId}:${cleaned.substring(0, 100)}`;
}

// ─── HANDLER ───
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'green-api-webhook',
      parser: 'shared (_lib/parser.js)',
      dualWrite: !!(SUPABASE_URL && SUPABASE_KEY),
      dedupCacheSize: dedupCache.size,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const type = body.type;

    // ── Handle Green API incoming message ──
    if (type === 'incomingMessage' || type === 'incomingMessageNotification') {
      const messageData = body.body?.messageData || body.messageData || {};
      const senderData = body.body?.senderData || body.senderData || {};

      const chatId = senderData.chatId || 'unknown';
      const chatName = senderData.chatName || chatId;
      const senderName = senderData.senderName || 'Unknown';

      // Extract text from various message types
      let text = '';
      if (messageData.textMessageData?.text) {
        text = messageData.textMessageData.text;
      } else if (messageData.extendedTextMessageData?.text) {
        text = messageData.extendedTextMessageData.text;
      } else if (messageData.typeMessage === 'quotedMessage' && messageData.extendedTextMessageData?.text) {
        text = messageData.extendedTextMessageData.text;
      }

      if (!text || text.length < 5) {
        return res.status(200).json({ ok: true, skipped: 'empty or short message' });
      }

      if (!chatId.endsWith('@g.us') && !chatId.endsWith('@c.us')) {
        return res.status(200).json({ ok: true, skipped: 'not a group message' });
      }

      // DEDUP
      const hash = messageHash(text, chatId);
      if (isDuplicate(hash)) {
        return res.status(200).json({ ok: true, skipped: 'duplicate' });
      }

      // SPLIT + PARSE using shared parser
      const watchParts = splitMultiWatch(text);
      const allRecords = [];
      const parseResults = [];

      for (let i = 0; i < watchParts.length; i++) {
        const part = watchParts[i];
        const parsed = parseFull(part);
        if (!parsed || (!parsed.ref && !parsed.brand)) continue;

        const record = parsedToRecord(parsed, part, chatId, i);
        allRecords.push(record);
        parseResults.push(`${parsed.brand || '?'} ${parsed.ref || '?'} ${record.verdict}`);
      }

      if (allRecords.length === 0) {
        return res.status(200).json({ ok: true, skipped: 'not a watch listing' });
      }

      // DUAL WRITE: live_ingest + watch_records
      const result = await batchInsert(allRecords);
      const wrResult = await writeToWatchRecords(allRecords);

      console.log(`[green-api] ${chatName}: ${allRecords.length} listings → live=${result.inserted} watch_records=${wrResult}`);

      return res.status(200).json({
        ok: true,
        handled: 'watch_message',
        group: chatName,
        sender: senderName,
        split: watchParts.length > 1,
        listingsFound: allRecords.length,
        results: parseResults,
        persisted: result.inserted > 0,
        watchRecordsWritten: wrResult,
      });
    }

    // Handle other Green API event types
    if (type === 'stateInstanceChanged') {
      console.log(`[green-api] State changed: ${JSON.stringify(body.body)}`);
      return res.status(200).json({ ok: true, handled: 'state_change' });
    }

    if (type === 'deviceInfo') {
      return res.status(200).json({ ok: true, handled: 'device_info' });
    }

    return res.status(200).json({ ok: true, handled: 'unknown_type', type });
  } catch (e) {
    console.error('[green-api] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
