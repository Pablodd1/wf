/**
 * /api/green-api-live.js
 * ======================
 * LIVE WhatsApp message ingestion from Green API.
 * Receives webhooks → parses with parser v3 → saves to watch_records.
 * 
 * Does NOT affect existing website, APIs, or other developers' code.
 * Purely additive — new records just appear in the database.
 * 
 * Green API Webhook URL: https://watchfacts-poc.vercel.app/api/green-api-live
 * 
 * POST /api/green-api-live (called by Green API on each new message)
 *   Body: { typeWebhook, instanceData, messageData, senderData, timestamp }
 * 
 * GET /api/green-api-live/stats (admin only — see ingestion stats)
 */

'use strict';

const { parseFull, verdict, toUSD, classifyListingType } = require('./_lib/parser');
const { parseMessageWithContext } = require('./_lib/context-tracker');
const { matchParsedListing } = require('./_lib/catalog-matcher');
const { withRateLimit } = require('./_lib/rate-limiter');
const { setCorsHeaders } = require('./_lib/cors');


const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_SECRET = process.env.GREEN_API_SECRET; // optional webhook validation

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ─── VERIFY GREEN API WEBHOOK ──────────────────────────────────────────────
function isValidWebhook(body) {
  // Green API sends these fields
  if (!body || !body.typeWebhook) return false;
  // Only process incoming text messages
  if (body.typeWebhook !== 'incomingMessageReceived') return false;
  if (!body.messageData) return false;
  // Only text messages (not images, documents, etc.)
  const type = body.messageData.typeMessage || '';
  if (!type.includes('text') && !type.includes('extendedText')) return false;
  return true;
}

// ─── EXTRACT TEXT FROM GREEN API PAYLOAD ───────────────────────────────────
function extractText(body) {
  try {
    const msg = body.messageData;
    if (msg.textMessageData?.textMessage) return msg.textMessageData.textMessage;
    if (msg.extendedTextMessageData?.text) return msg.extendedTextMessageData.text;
    return '';
  } catch (e) {
    return '';
  }
}

// ─── PROCESS ONE MESSAGE ───────────────────────────────────────────────────
async function processMessage(body) {
  const rawText = extractText(body);
  if (!rawText.trim()) return { skipped: true, reason: 'empty_text' };

  // Skip non-listing messages (quick check)
  const lower = rawText.toLowerCase();
  const hasPrice = /\$|usd|hkd|eur|gbp|chf|k|m\b|000|\.\d{3}/.test(lower);
  const hasRef = /\d{4,6}/.test(rawText);
  if (!hasPrice && !hasRef) return { skipped: true, reason: 'no_watch_data' };

  // Parse with context tracker + catalog matching (v4.1)
  const listings = parseMessageWithContext(rawText, parseFull);
  if (!listings.length) return { skipped: true, reason: 'parse_failed' };

  // Process first listing (or all for multi-listing messages)
  const parsed = listings[0];
  if (!parsed || !parsed.brand) return { skipped: true, reason: 'parse_failed' };

  // Catalog lookup
  const catalogEntry = matchParsedListing(parsed);
  let confidence = parsed.confidence || 50;
  let v;

  if (catalogEntry) {
    confidence = 100;
    v = 'APPROVED';
  } else {
    v = verdict(parsed);
  }

  const listingType = classifyListingType(rawText);

  const record = {
    raw_message: rawText,
    brand: parsed.brand,
    reference: parsed.ref,
    dial_color: catalogEntry?.dialColor || parsed.dial,
    condition: parsed.condition,
    year: parsed.year,
    price_raw: parsed.price,
    price_usd: parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null,
    currency: parsed.currency || 'USD',
    confidence,
    verdict: v,
    listing_type: listingType,
    source: 'green_api_live',
    channel_id: body.senderData?.chatId || body.senderData?.sender || 'unknown',
    dealer_name: body.senderData?.senderName || null,
    accessories: parsed.accessories ? JSON.stringify(parsed.accessories) : null,
    field_confidence: parsed.fieldConfidence ? JSON.stringify(parsed.fieldConfidence) : null,
    flags: catalogEntry ? [] : ['NO_CATALOG_MATCH'],
    parser_version: 'v4.1-catalog',
    processed_at: new Date().toISOString(),
    created_at: new Date((body.timestamp || Date.now()/1000) * 1000).toISOString(),
    human_edited: false,
    image_urls: catalogEntry?.imageUrl ? [catalogEntry.imageUrl] : [],
  };

  // Save to watch_records
  const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify(record),
  });

  if (!res.ok) {
    const err = await res.text();
    return { error: true, reason: err };
  }

  const data = await res.json();
  return { saved: true, id: data[0]?.id, brand: parsed.brand, reference: parsed.ref, price: parsed.price };
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
const handler = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;

  // ── GET /api/green-api-live/stats ──
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.endsWith('/stats')) {
      try {
        // Count records from green_api_live source today
        const today = new Date().toISOString().split('T')[0];
        const countRes = await fetch(
          `${SUPABASE_URL}/rest/v1/watch_records?source=eq.green_api_live&created_at=gte.${today}&select=id&limit=1`,
          { headers: { ...HEADERS, 'Prefer': 'count=exact' } }
        );
        const todayCount = parseInt((countRes.headers.get('content-range') || '').split('/')[1] || '0');

        const totalRes = await fetch(
          `${SUPABASE_URL}/rest/v1/watch_records?source=eq.green_api_live&select=id&limit=1`,
          { headers: { ...HEADERS, 'Prefer': 'count=exact' } }
        );
        const totalCount = parseInt((totalRes.headers.get('content-range') || '').split('/')[1] || '0');

        return res.status(200).json({
          ok: true,
          source: 'green_api_live',
          today: todayCount,
          total: totalCount,
          parser_version: 'v3.0',
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }
    return res.status(200).json({ ok: true, message: 'Green API Live webhook endpoint. POST with Green API webhook payload.' });
  }

  // ── POST (webhook from Green API) ──
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};

  // Validate webhook
  if (!isValidWebhook(body)) {
    return res.status(200).json({ ok: true, ignored: true, reason: 'not_text_message' });
  }

  try {
    const result = await processMessage(body);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('[green-api-live] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = withRateLimit('/api/green-api-live', handler);
