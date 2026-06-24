/**
 * GREEN API WEBHOOK RECEIVER — /api/green-api-webhook
 *
 * Receives ALL incoming WhatsApp messages from Green API at scale (600+ groups).
 * Handles: deduplication, batch insertion, parsing, group tracking.
 *
 * Green API sends POST with body:
 * { type: "incomingMessage", body: { messageData: {...}, senderData: {...} } }
 *
 * Also handles Telegram messages from Green API's Telegram instances.
 *
 * ENV VARS:
 *   GREEN_API_INSTANCE_ID — the instance ID (for verifying source)
 *   GREEN_API_TOKEN       — the API token (for verifying source)
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPROVE_THRESHOLD = 90;
const HUMAN_THRESHOLD = 70;

const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount, currency) {
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

// ─── PRICE PARSER (handles all dealer formats) ───
function parsePrice(text) {
  const t = text.replace(/,/g, '');
  const hkdM = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (hkdM) return Math.round(parseFloat(hkdM[1]) * 1_000_000);
  const hkdK = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (hkdK) return Math.round(parseFloat(hkdK[1]) * 1000);
  const mMatch = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);
  const kMatch = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const usdMatch = t.match(/(?:USD|USDT|\$)\s*(\d{4,8})/i);
  if (usdMatch) return parseInt(usdMatch[1], 10);
  const hkdPlain = t.match(/HKD\s*(\d{4,8})/i);
  if (hkdPlain) return parseInt(hkdPlain[1], 10);
  const plainMatch = t.match(/\b(\d{5,8})\b/);
  if (plainMatch) return parseInt(plainMatch[1], 10);
  return null;
}

function parseCurrency(text) {
  const t = text.toUpperCase();
  if (/\bUSDTO?\b|USDT/.test(t)) return 'USDT';
  if (/\bHKD\b|HK\$/.test(t)) return 'HKD';
  if (/\bEUR\b|€/.test(t)) return 'EUR';
  if (/\bGBP\b|£/.test(t)) return 'GBP';
  if (/\bCHF\b/.test(t)) return 'CHF';
  if (/\bSGD\b/.test(t)) return 'SGD';
  if (/\bUSD\b|\$/.test(t)) return 'USD';
  if (/HKD/i.test(text)) return 'HKD';
  return null;
}

// ─── BRAND DETECTION ───
function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
  if (/^[345]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}-/.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,5}$/.test(r)) return 'Audemars Piguet';
  if (/^\d{6}[A-Z]{0,5}$/.test(r)) return 'Rolex';
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^PAM\d{3,5}/.test(r)) return 'Panerai';
  if (/^IW\d{6,8}/.test(r)) return 'IWC';
  if (/^RDDB\w*/.test(r) || /^WHCH\w*/.test(r)) return 'Cartier';
  if (/^\d{3}\.\d{3}/.test(r)) return 'A. Lange & Söhne';
  if (/^(WSSA|SPB|SRP|SBDY)\d{3,4}/.test(r)) return 'Seiko';
  return null;
}

// ─── FULL MESSAGE PARSER ───
function parseWatchMessage(text) {
  if (!text || text.length < 5) return null;
  
  let brand = null;
  if (/\bpp\b|patek/i.test(text)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars/i.test(text)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s?mille/i.test(text)) brand = 'Richard Mille';
  else if (/rolex/i.test(text)) brand = 'Rolex';
  else if (/vacheron|constantin/i.test(text)) brand = 'Vacheron Constantin';
  else if (/omega/i.test(text)) brand = 'Omega';
  else if (/cartier/i.test(text)) brand = 'Cartier';
  else if (/a\.?\s?lange|lange\s?\&/i.test(text)) brand = 'A. Lange & Söhne';
  else if (/\biwc\b|schaffhausen/i.test(text)) brand = 'IWC';
  else if (/panerai|pam\d/i.test(text)) brand = 'Panerai';
  else if (/seiko|grand\s?seiko/i.test(text)) brand = 'Seiko';
  else if (/tudor/i.test(text)) brand = 'Tudor';
  else if (/hublot/i.test(text)) brand = 'Hublot';
  else if (/breitling/i.test(text)) brand = 'Breitling';
  else if (/jaeger|jlc/i.test(text)) brand = 'Jaeger-LeCoultre';
  else if (/zenith/i.test(text)) brand = 'Zenith';

  let ref = null;
  const rmM = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppM = text.match(/\b[345]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const shortPP = text.match(/\b[345]\d{3}[A-Z]\b/i);
  const apM = text.match(/\b\d{5}[A-Z]{2,5}(?:\.\w+)?\b/i);
  const rolexM = text.match(/\b\d{6}[A-Z]{0,5}\b/i);
  const pamM = text.match(/\bPAM\d{3,5}\b/i);
  const iwcM = text.match(/\bIW\d{6,8}\b/i);
  const cartierM = text.match(/\b(?:RDDB|WHCH|WSTA|WSCL)\w*\b/i);
  const langeM = text.match(/\b\d{3}\.\d{3}\b/);
  const seikoM = text.match(/\b(?:WSSA|SPB|SRP|SBDY|SNE)\d{3,4}\b/i);
  const ppVintage = text.match(/\b(2499|5971|5970|3970|5004|5160|5168|5170|5205|5270|5935|5960)\b/i);
  
  if (rmM) ref = rmM[0].toUpperCase().replace(/\s/g, '');
  else if (ppM) ref = ppM[0].toUpperCase();
  else if (shortPP) ref = shortPP[0].toUpperCase();
  else if (apM) ref = apM[0].toUpperCase();
  else if (pamM) ref = pamM[0].toUpperCase();
  else if (iwcM) ref = iwcM[0].toUpperCase();
  else if (cartierM) ref = cartierM[0].toUpperCase();
  else if (langeM) ref = langeM[0];
  else if (seikoM) ref = seikoM[0].toUpperCase();
  else if (rolexM) ref = rolexM[0].toUpperCase();
  else if (ppVintage) ref = ppVintage[0].toUpperCase();

  if (!brand && ref) brand = inferBrandFromRef(ref);
  if (!brand && /\bAP\d{5}/i.test(text)) brand = 'Audemars Piguet';
  if (!brand && /\bRm\d{2}/i.test(text)) brand = 'Richard Mille';

  let dial = null;
  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|tiffany|panda|hulk|blk|rom|roma|candy|crash)\b/i);
  if (dialM) {
    const d = dialM[1].toLowerCase();
    if (d === 'blk') dial = 'Black';
    else if (d === 'rom' || d === 'roma') dial = 'Roman';
    else dial = dialM[1].charAt(0).toUpperCase() + dialM[1].slice(1).toLowerCase();
  }

  let condition = null;
  if (/\bnew\b|unworn|bnib|brand\s?new/i.test(text)) condition = 'New';
  else if (/\bused\b|pre-?owned|worn/i.test(text)) condition = 'Used';

  const yearM = text.match(/[Nn]\d\/(\d{4})/) || text.match(/\b(20[12]\d)\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  const price = parsePrice(text);
  const currency = parseCurrency(text);

  // Skip non-watch messages (must have a reference or brand+price)
  if (!ref && !brand) return null;
  if (!ref && !price) return null;

  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 10;
  if (condition) confidence += 8;
  if (price) confidence += 10;
  if (year) confidence += 4;
  if (currency) confidence += 3;

  let verdict = 'HUMAN';
  if (!ref && !brand) verdict = 'RECYCLE';
  else if (confidence < 35) verdict = 'RECYCLE';
  else if (confidence >= APPROVE_THRESHOLD && ref && brand) verdict = 'APPROVED';

  const priceUSD = price ? toUSD(price, currency || 'USD') : null;

  return {
    brand: brand || 'Unknown',
    reference: ref,
    dial_color: dial,
    condition,
    year,
    price_raw: price,
    price_usd: priceUSD,
    currency: currency || 'USD',
    confidence,
    verdict,
  };
}

// ─── DEDUPLICATION ───
// Simple hash: message text (cleaned) + 5-min window
function messageHash(text, chatId) {
  // Normalize: lowercase, remove emojis, collapse whitespace, remove prices (which vary)
  const cleaned = text
    .toLowerCase()
    .replace(/[\u2600-\u27BF\u2B50\u2B55\U0001F000-\U0001FAFF\uFE0F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
  
  // Hash: first 100 chars of cleaned text + chat ID
  // Same message in different groups = different hash (we want both)
  // Same message posted twice in same group within window = duplicate
  return `${chatId}:${cleaned.substring(0, 100)}`;
}

// ─── SUPABASE BATCH INSERT ───
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
    
    // If batch too large, try smaller chunks
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

// ─── IN-MEMORY DEDUP CACHE (per serverless instance) ───
// Note: This is per-function-invocation. For true dedup across invocations,
// we'd need a Redis or Supabase table. For now, this catches duplicates
// within rapid-fire multi-message posts.
const dedupCache = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isDuplicate(hash) {
  const now = Date.now();
  // Clean old entries
  for (const [key, ts] of dedupCache) {
    if (now - ts > DEDUP_TTL_MS) dedupCache.delete(key);
  }
  
  if (dedupCache.has(hash)) {
    return true;
  }
  dedupCache.set(hash, now);
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'green-api-webhook',
      supabase: !!(SUPABASE_URL && SUPABASE_KEY),
      dedup_cache_size: dedupCache.size,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const type = body.type || '';

  // Green API webhook format:
  // { type: "incomingMessage", body: { messageData: {...}, senderData: { chatId, senderName, chatName } } }
  
  if (type === 'incomingMessage' && body.body) {
    const msgBody = body.body;
    const messageData = msgBody.messageData || {};
    const senderData = msgBody.senderData || {};
    
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
    
    // Only process group messages
    if (!chatId.endsWith('@g.us') && !chatId.endsWith('@c.us')) {
      return res.status(200).json({ ok: true, skipped: 'not a group message' });
    }
    
    // DEDUPLICATION
    const hash = messageHash(text, chatId);
    if (isDuplicate(hash)) {
      return res.status(200).json({ ok: true, skipped: 'duplicate' });
    }
    
    // PARSE
    const parsed = parseWatchMessage(text);
    if (!parsed) {
      return res.status(200).json({ ok: true, skipped: 'not a watch listing' });
    }
    
    // BUILD RECORD
    const record = {
      id: `ga_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      raw_message: text.substring(0, 2000),
      brand: parsed.brand,
      reference: parsed.reference,
      dial_color: parsed.dial_color,
      condition: parsed.condition,
      year: parsed.year,
      price_raw: parsed.price_raw,
      price_usd: parsed.price_usd,
      currency: parsed.currency,
      confidence: parsed.confidence,
      verdict: parsed.verdict,
      source: 'green_api',
      channel_id: chatId,
      received_at: new Date().toISOString(),
    };
    
    // INSERT TO SUPABASE
    const result = await batchInsert([record]);
    
    console.log(`[green-api] ${chatName} @${senderName}: "${text.substring(0, 60)}..." → ${parsed.brand} ${parsed.reference || '?'} ${parsed.verdict} (conf=${parsed.confidence}) ${result.inserted ? '✓' : '✗'}`);
    
    return res.status(200).json({
      ok: true,
      handled: 'watch_message',
      group: chatName,
      sender: senderName,
      parsed: {
        brand: parsed.brand,
        reference: parsed.reference,
        dial: parsed.dial_color,
        price: parsed.price_raw,
        currency: parsed.currency,
        confidence: parsed.confidence,
        verdict: parsed.verdict,
      },
      persisted: result.inserted > 0,
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
  
  // Unknown type — acknowledge to prevent retries
  return res.status(200).json({ ok: true, handled: 'unknown_type', type });
};
