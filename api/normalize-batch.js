/**
 * POST /api/normalize-batch
 * 
 * Normalizes MYSQL_RAW records using the full JASS parser (v4.0).
 * Processes one chunk per call — designed to be called repeatedly
 * by a Vercel cron job until all records are processed.
 * 
 * Body: { offset: number, limit: number (max 200), key: string }
 * Returns: { processed, enriched, multi_tagged, wtb_tagged, nonwatch_tagged, next_offset, done }
 * 
 * maxDuration: 60s (Vercel default) — each call processes one small chunk.
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

// Lazy-load parser (only on first call)
let parseFull = null;
let lookupCatalog = null;
let lookupEnriched = null;
let lookupNormalized = null;

function loadParser() {
  if (parseFull) return;
  const parser = require('./_lib/parser.js');
  parseFull = parser.parseFull;
  const cm = require('./_lib/catalog-matcher');
  lookupCatalog = cm.lookupCatalog;
  lookupEnriched = cm.lookupEnriched;
  lookupNormalized = cm.lookupNormalized;
}

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth: accept ADMIN_KEY, CRON_SECRET, or temporary token for initial run
  const VALID_TOKENS = [
    process.env.ADMIN_KEY,
    process.env.CRON_SECRET,
    'wf-normalize-batch-2026',  // temporary — remove after first full run
  ].filter(Boolean);
  
  const providedKey = req.body?.key || req.headers['x-admin-key'] || req.query?.key || '';
  if (!providedKey || !VALID_TOKENS.includes(providedKey)) {
    return res.status(403).json({ error: 'unauthorized', hint: 'use key param' });
  }

  try {
    loadParser();
    const client = getClient();
    
    const limit = Math.min(parseInt(req.body?.limit) || 100, 200);
    const offset = parseInt(req.body?.offset) || 0;

    // Fetch unprocessed MYSQL_RAW records
    const { data: records, error: fetchErr } = await client
      .from('watch_records')
      .select('id,raw_message,brand,reference,dial_color,price_usd,currency,verdict,listing_type,confidence,parser_version')
      .eq('source', 'MYSQL_RAW')
      // Only re-normalize if parser_version is old or missing
      .or('parser_version.is.null,parser_version.eq.v1')
      .range(offset, offset + limit - 1)
      .order('id', { ascending: true });

    if (fetchErr) throw fetchErr;
    if (!records || records.length === 0) {
      return res.json({ done: true, processed: 0, message: 'No more records to normalize' });
    }

    let processed = 0;
    let enrichedDials = 0;
    let multiTagged = 0;
    let wtbTagged = 0;
    let nonWatchTagged = 0;

    for (const rec of records) {
      const msg = rec.raw_message || '';
      if (msg.length < 10) continue;

      // ── Run parser ──
      let parsed;
      try {
        parsed = parseFull(msg);
      } catch {
        continue;
      }
      if (!parsed) continue;

      const patch = {};
      let changed = false;

      // Brand
      if (parsed.brand && parsed.brand !== 'Unknown') {
        if (parsed.brand !== rec.brand) { patch.brand = parsed.brand; changed = true; }
      }

      // Reference
      if (parsed.reference || parsed.ref) {
        const ref = parsed.reference || parsed.ref;
        // Apply normalization lookup (short ref → full ref)
        const normHit = lookupNormalized ? lookupNormalized(ref) : null;
        const finalRef = normHit ? normHit.r : ref;
        if (finalRef && finalRef !== rec.reference) { patch.reference = finalRef; changed = true; }
        
        // If normalization also corrected the brand
        if (normHit && normHit.b && (!rec.brand || rec.brand === 'Unknown')) {
          patch.brand = normHit.b;
          changed = true;
        }
      }

      // Dial color
      if (parsed.dial || parsed.dial_color) {
        const dial = parsed.dial || parsed.dial_color;
        if (dial && dial !== 'Unknown' && dial !== rec.dial_color) {
          patch.dial_color = dial;
          changed = true;
        }
      }
      // Enriched dial fallback
      if (!patch.dial_color && !rec.dial_color && (patch.reference || rec.reference) && (patch.brand || rec.brand)) {
        const enr = lookupEnriched(patch.brand || rec.brand, patch.reference || rec.reference);
        if (enr && enr.dial_color) {
          patch.dial_color = enr.dial_color;
          enrichedDials++;
          changed = true;
        }
      }

      // Price
      if (parsed.price && parsed.price > 0 && parsed.price < 5000000) {
        if (parsed.price !== rec.price_usd) { patch.price_usd = parsed.price; changed = true; }
      }
      if (parsed.currency) {
        patch.currency = parsed.currency;
        changed = true;
      }

      // Confidence
      if (parsed.confidence && typeof parsed.confidence === 'number') {
        patch.confidence = parsed.confidence;
        changed = true;
      }

      // ── Verdict & Listing Type ──
      
      // Multi-watch detection
      const prices = msg.match(/\$[\d,]+|[\d,]+k?\s*(?:hkd|usd)/gi) || [];
      const uniquePrices = new Set(prices.map(p => p.toLowerCase()));
      const hasBullets = /[⭐🌟★●♦▶☞📦🎁💝💥]/.test(msg);
      const isMulti = (hasBullets && uniquePrices.size >= 2) || (uniquePrices.size >= 3 && msg.length > 100);

      // WTB detection
      const isWTB = /\b(WTB|WANT TO BUY|looking for|anyone have|need to buy|need to find|searching for)\b/i.test(msg);

      // Non-watch detection
      const nonWatchRe = /\b(tool|flashlight|knife|wallet|belt|shirt|shoe|purse|necklace|earring|sunglass|perfume|cufflink|charger|headphone|speaker|bag\b(?!.*watch)|pen\b(?!.*pen.*watch)|ring\b(?!.*(watch|rolex|patek|ap|audemars))|bracelet\b(?!.*watch))/i;
      const hasWatchBrand = /\b(rolex|patek|audemars|omega|cartier|panerai|breitling|hublot|iwc|tudor|zenith|richard mille|breguet|blancpain|vacheron)\b/i;
      const isNonWatch = nonWatchRe.test(msg) && !hasWatchBrand;

      if (isMulti) {
        patch.verdict = 'HUMAN';
        patch.listing_type = 'MULTI';
        multiTagged++;
        changed = true;
      } else if (isNonWatch) {
        patch.verdict = 'RECYCLE';
        patch.listing_type = 'NON_WATCH';
        nonWatchTagged++;
        changed = true;
      } else if (isWTB) {
        patch.verdict = parsed.verdict || 'REVIEW';
        patch.listing_type = 'WTB';
        wtbTagged++;
        changed = true;
      } else {
        // Normal verdict from parser
        patch.verdict = parsed.verdict || rec.verdict || 'REVIEW';
        patch.listing_type = 'WTS';
        changed = true;
      }

      // Set parser version
      if (rec.parser_version !== 'jass-v5') {
        patch.parser_version = 'jass-v5';
        changed = true;
      }

      if (changed) {
        try {
          await client.from('watch_records').update(patch).eq('id', rec.id);
          processed++;
        } catch (e) {
          console.error('Update error for ' + rec.id + ':', e.message);
        }
      }
    }

    res.json({
      done: false,
      processed,
      enriched_dials: enrichedDials,
      multi_tagged: multiTagged,
      wtb_tagged: wtbTagged,
      nonwatch_tagged: nonWatchTagged,
      offset,
      next_offset: offset + limit,
      total_in_batch: records.length,
    });
  } catch (err) {
    console.error('Normalize batch error:', err);
    res.status(500).json({ error: err.message });
  }
};
