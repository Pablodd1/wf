/**
 * POST /api/green-api-webhook
 * Receives WhatsApp messages from Green API (600 group chats)
 * v4.1: Catalog matching wired — 6958 entries → 100% confidence for known refs
 *
 * Pipeline: segment → context-track → parse → catalog match → gap detect → save
 */
const { parseFull } = require('./_lib/parser');
const { getClient } = require('./_lib/supabase');
const { parseMessageWithContext } = require('./_lib/context-tracker');
const { matchParsedListing } = require('./_lib/catalog-matcher');
const { withRateLimit } = require('./_lib/rate-limiter');

module.exports = withRateLimit('/api/green-api-webhook', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
  if (GREEN_API_TOKEN && req.headers['x-green-api-token'] !== GREEN_API_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const body = req.body;
    let rawMessage = '';
    let senderId = '';
    let groupId = '';
    let timestamp = Date.now();

    if (body.messageData?.textMessageData?.textMessage) {
      rawMessage = body.messageData.textMessageData.textMessage;
    } else if (body.messageData?.extendedTextMessageData?.text) {
      rawMessage = body.messageData.extendedTextMessageData.text;
    } else if (typeof body === 'string') {
      rawMessage = body;
    }
    if (body.senderData) {
      senderId = body.senderData.sender || '';
      groupId = body.senderData.chatId || '';
    }
    if (body.timestamp) timestamp = body.timestamp * 1000;

    if (!rawMessage) return res.status(400).json({ error: 'No message text found' });

    // Step 1: Context-aware parse
    const parsedListings = parseMessageWithContext(rawMessage, parseFull);

    // Process each listing
    const savedRecords = [];
    for (const parsed of parsedListings) {

      // Step 2: Catalog lookup (LOCAL JSON — 6958 entries, instant)
      const catalogEntry = matchParsedListing(parsed);

      // Dense multi-listing detection: if parsed from a space-separated dump, recycle
      const rawLen = rawMessage.length;
      const dollarCount = (rawMessage.match(/\$/g) || []).length;
      const refCount = (rawMessage.match(/\b\d{5,6}[A-Za-z]{0,6}\b/g) || []).length;
      const isDenseDump = dollarCount >= 3 && refCount >= 4 && rawLen > 200;

      // Step 3: Confidence scoring with catalog
      let confidence = parsed.confidence || 50;
      let verdict = 'REVIEW';

      if (isDenseDump) {
        // Dense multi-listing dumps go straight to recycle
        confidence = 10;
        verdict = 'RECYCLE';
      } else if (catalogEntry) {
        // Catalog match → 100% confidence → auto-approve
        confidence = 100;
        verdict = 'APPROVED';
      } else if (parsed.brand && parsed.ref && parsed.price > 0) {
        // Has brand + ref + price but no catalog match
        confidence = Math.min(80, confidence);
        verdict = confidence >= 80 ? 'APPROVED' : 'REVIEW';
      } else if (!parsed.ref || !parsed.brand) {
        // Missing critical fields
        confidence = Math.min(40, confidence);
        verdict = 'RECYCLE';
      } else {
        verdict = 'HUMAN';
      }

      // Step 4: Save to Supabase
      const v34Flags = {
        ...(isDenseDump ? { dense_multi_listing: true } : {}),
        ...(catalogEntry ? { catalog_matched: true } : { no_catalog_match: true }),
        // v3.4 schema fields (stored in flags jsonb — no DDL needed)
        ...(parsed.inclusions ? { inclusions: parsed.inclusions } : {}),
        ...(parsed.notes ? { notes: parsed.notes } : {}),
        ...(parsed.details ? { details: parsed.details } : {}),
        ...(parsed.conditionBucket ? { condition_bucket: parsed.conditionBucket } : {}),
      };
      const { data: saved, error } = await getClient().from('watch_records').insert({
        brand: parsed.brand || null,
        reference: parsed.ref || null,
        dial_color: catalogEntry?.dialColor || parsed.dial || null,
        condition: parsed.condition || null,
        year: parsed.year ? parseInt(parsed.year) : null,
        price_raw: parsed.priceRaw || null,
        price_usd: parsed.price || null,
        currency: parsed.currency || 'USD',
        confidence,
        verdict,
        source: 'whatsapp',
        raw_message: rawMessage,
        flags: v34Flags,
        month_code: parsed.dateMonth || null,
        reprocessed_at: null,
        created_at: new Date(timestamp).toISOString(),
        processed_at: new Date().toISOString(),
        parser_version: 'v3.4-catalog',
        listing_type: parsed.listingType || 'WTS',
        human_edited: false,
        image_urls: catalogEntry?.imageUrl ? [catalogEntry.imageUrl] : [],
      }).select();

      if (error) throw error;
      if (saved?.[0]) savedRecords.push(saved[0]);
    }

    res.status(200).json({
      success: true,
      count: savedRecords.length,
      ids: savedRecords.map(r => r.id),
      catalogMatches: savedRecords.filter(r => r.confidence === 100).length,
      listings: savedRecords.map(r => ({
        id: r.id,
        brand: r.brand,
        reference: r.reference,
        price_usd: r.price_usd,
        confidence: r.confidence,
        verdict: r.verdict,
        catalogMatch: r.confidence === 100,
      })),
    });

  } catch (err) {
    console.error('Green API webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
