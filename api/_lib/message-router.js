/**
 * Phase 3: Message Router
 * Routes incoming messages through confidence scoring to destination pipeline
 * 
 * Routing logic:
 *   HIGH confidence (≥85)  → Auto-approve + save to watch_records
 *   MEDIUM confidence (50-84) → Save with REVIEW verdict + add to review queue
 *   LOW confidence (<50)    → Save with HUMAN verdict + log for manual review
 * 
 * Also handles duplicate detection, spam filtering, and non-watch routing.
 */

const { parseFull, classifyListingType } = require('./parser');
const { parseMessageWithContext } = require('./context-tracker');
const { matchParsedListing } = require('./catalog-matcher');
const { calculateConfidence } = require('./confidence');

// ─── SPAM / NON-WATCH KEYWORDS ──────────────────────────────────────────────
const SPAM_SIGNALS = [
  /scam|spam|fake|replica/i,
  /crypto|airdrop|join my group|click here/i,
  /viagra|cialis|casino|betting|lottery/i,
];

const NON_WATCH_SIGNALS = [
  /bag|handbag|purse|wallet|belt/i,
  /shoe|sneaker|nike|adidas/i,
  /car|vehicle|mercedes|bmw|ferrari|porsche/i,
  /phone|iphone|samsung|laptop|computer/i,
  /jewelry|necklace|bracelet|earring|ring/i,
];

// ─── DUPLICATE DETECTION ─────────────────────────────────────────────────────
// Simple in-memory cache of recent messages to avoid exact duplicates
const recentMessages = new Map(); // hash → timestamp
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000;

function isDuplicate(rawText) {
  const hash = rawText.trim().toLowerCase().slice(0, 200);
  const lastSeen = recentMessages.get(hash);
  const now = Date.now();

  if (lastSeen && (now - lastSeen) < DEDUP_WINDOW_MS) {
    return true;
  }

  // Clean old entries periodically
  if (recentMessages.size > MAX_CACHE_SIZE) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [key, ts] of recentMessages) {
      if (ts < cutoff) recentMessages.delete(key);
    }
  }

  recentMessages.set(hash, now);
  return false;
}

// ─── ROUTING ─────────────────────────────────────────────────────────────────

/**
 * Route an incoming message to the appropriate pipeline
 * @param {Object} body - Green API webhook body
 * @param {Object} supabaseClient - Supabase client instance for DB writes
 * @returns {Promise<Object>} Routing result
 */
async function routeMessage(body, supabaseClient) {
  const startTime = Date.now();

  // 1. Extract text
  const rawText = extractText(body);
  if (!rawText || !rawText.trim()) {
    return routeResult('SKIP', 'empty_text');
  }

  // 2. Duplicate check
  if (isDuplicate(rawText)) {
    return routeResult('SKIP', 'duplicate');
  }

  // 3. Spam / non-watch check
  const lower = rawText.toLowerCase();
  if (SPAM_SIGNALS.some(rx => rx.test(lower))) {
    return routeResult('BLOCK', 'spam');
  }
  if (NON_WATCH_SIGNALS.some(rx => rx.test(lower)) &&
      !/rolex|patek|audemars|richard mille|omega|cartier/i.test(lower)) {
    return routeResult('SKIP', 'non_watch');
  }

  // 4. Quick check: does it have watch data?
  const hasPrice = /\$|usd|hkd|eur|gbp|chf|k\b|m\b|000|\.\d{3}/.test(lower);
  const hasRef = /\d{4,6}/.test(rawText);
  if (!hasPrice && !hasRef) {
    return routeResult('SKIP', 'no_watch_data');
  }

  // 5. Parse with context tracker
  const listings = parseMessageWithContext(rawText, parseFull);
  if (!listings || listings.length === 0) {
    return routeResult('SKIP', 'parse_failed');
  }

  const parsed = listings[0];
  if (!parsed || !parsed.brand) {
    return routeResult('SKIP', 'no_brand_detected');
  }

  // 6. Catalog lookup
  const catalogEntry = matchParsedListing(parsed);

  // 7. Confidence scoring
  const confidence = calculateConfidence(parsed, catalogEntry, rawText);
  const listingType = classifyListingType(rawText);

  // 8. Build normalized record
  const { parsePrice, parseCurrency } = require('./parser');
  const price = parsePrice(rawText, parsed.ref || undefined);
  const currency = parseCurrency(rawText);

  const record = {
    raw_message: rawText,
    brand: parsed.brand,
    reference: parsed.ref,
    dial_color: catalogEntry?.dialColor || parsed.dial,
    condition: parsed.condition,
    year: parsed.year,
    price_raw: parsed.price,
    price: price,
    price_usd: parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null,
    currency: parsed.currency || currency || 'USD',
    confidence,
    confidence_score: confidence.score,
    verdict: confidence.verdict,
    listing_type: listingType,
    source: 'green_api_live',
    channel_id: body.senderData?.chatId || body.senderData?.sender || 'unknown',
    dealer_name: body.senderData?.senderName || null,
    parser_version: 'v4.10',
    processed_at: new Date().toISOString(),
    created_at: new Date((body.timestamp || Date.now()/1000) * 1000).toISOString(),
    flags: [],
    catalog_entry: catalogEntry || null,
  };

  // 9. Route based on confidence level
  switch (confidence.level) {
    case 'HIGH':
      return await handleHighConfidence(record, supabaseClient);

    case 'MEDIUM':
      return await handleMediumConfidence(record, supabaseClient);

    case 'LOW':
      return await handleLowConfidence(record, supabaseClient);

    default:
      return routeResult('ERROR', 'unknown_confidence_level', { record });
  }
}

// ─── PIPELINE HANDLERS ───────────────────────────────────────────────────────

async function handleHighConfidence(record, supabase) {
  record.verdict = 'APPROVED';
  record.flags.push('AUTO_APPROVED');

  const { error } = await supabase
    .from('watch_records')
    .insert([record]);

  if (error) {
    return routeResult('ERROR', 'db_write_failed', { record, error: error.message });
  }

  return routeResult('APPROVED', 'high_confidence_auto_approve', {
    brand: record.brand,
    reference: record.reference,
    confidence: record.confidence_score,
    price: record.price_usd,
  });
}

async function handleMediumConfidence(record, supabase) {
  record.verdict = 'REVIEW';
  record.flags.push('NEEDS_HUMAN_REVIEW');

  // Save to watch_records with REVIEW verdict
  const { data, error } = await supabase
    .from('watch_records')
    .insert([record])
    .select('id')
    .single();

  if (error) {
    return routeResult('ERROR', 'db_write_failed', { record, error: error.message });
  }

  // Also add to review queue (normalized_records)
  const { error: queueError } = await supabase
    .from('normalized_records')
    .insert([{
      raw_record_id: data.id,
      brand: record.brand,
      reference: record.reference,
      dial_color: record.dial_color,
      condition: record.condition,
      year: record.year,
      price_usd: record.price_usd,
      currency: record.currency,
      confidence_score: record.confidence_score,
      raw_message: record.raw_message,
      status: 'PENDING',
      parser_version: record.parser_version,
    }]);

  if (queueError) {
    console.warn('[router] Failed to add to review queue:', queueError.message);
  }

  return routeResult('REVIEW', 'medium_confidence_review_queue', {
    id: data.id,
    brand: record.brand,
    reference: record.reference,
    confidence: record.confidence_score,
    price: record.price_usd,
  });
}

async function handleLowConfidence(record, supabase) {
  record.verdict = 'HUMAN';
  record.flags.push('LOW_CONFIDENCE', 'NEEDS_HUMAN_REVIEW');

  const { data, error } = await supabase
    .from('watch_records')
    .insert([record])
    .select('id')
    .single();

  if (error) {
    return routeResult('ERROR', 'db_write_failed', { record, error: error.message });
  }

  return routeResult('HUMAN', 'low_confidence_human_review', {
    id: data.id,
    brand: record.brand,
    reference: record.reference,
    confidence: record.confidence_score,
    message: record.raw_message?.substring(0, 100),
  });
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────

function routeResult(status, reason, data = {}) {
  return {
    routed: true,
    status,
    reason,
    latency_ms: 0,
    ...data,
  };
}

function extractText(body) {
  try {
    const msg = body.messageData;
    if (msg?.textMessageData?.textMessage) return msg.textMessageData.textMessage;
    if (msg?.extendedTextMessageData?.text) return msg.extendedTextMessageData.text;
    return '';
  } catch {
    return '';
  }
}

function toUSD(price, currency) {
  const RATES = {
    USD: 1, USDT: 1, HKD: 0.128, EUR: 0.92, GBP: 0.79,
    CHF: 0.88, SGD: 0.74, AED: 0.272, JPY: 0.0066, CNY: 0.138,
  };
  const rate = RATES[currency] || 1;
  return Math.round(price * rate);
}

module.exports = { routeMessage, calculateConfidence, isDuplicate };
