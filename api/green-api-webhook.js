/**
 * POST /api/green-api-webhook
 * Receives WhatsApp messages from Green API (600 group chats)
 * v4.0: Uses ContextTracker for context-aware multi-listing parsing
 *
 * Pipeline: segment → context-track → parse → catalog match → gap detection → save
 */
const { parseFull } = require('./_lib/parser');
const { routeByScheme } = require('./_lib/gap-detector');
const { getClient } = require('./_lib/supabase');
const { parseMessageWithContext } = require('./_lib/context-tracker');
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

    // Extract message
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

    // Step 1: Context-aware parse (handles multi-listing messages)
    const parsedListings = parseMessageWithContext(rawMessage, parseFull);

    // Process each listing
    const savedRecords = [];
    for (const parsed of parsedListings) {

    // Step 2: Catalog lookup
    let catalogResult = { tier: 5, match: 'unmatched' };
    if (parsed.ref) {
      const { data } = await getClient().from('catalog').select('*').ilike('reference', `%${parsed.ref}%`).limit(1);
      if (data?.[0]) catalogResult = { tier: 1, data: data[0], match: 'exact' };
    }

    // Step 3: Route by scheme
    const routing = await routeByScheme(parsed, catalogResult);

    // Step 4: Save to Supabase
    const { data: saved, error } = await getClient().from('watch_records').insert({
      brand: parsed.brand,
      reference: parsed.ref,
      dial_color: routing.filled.dialColor || parsed.dial,
      condition: routing.filled.condition || parsed.condition,
      year: routing.filled.year || parsed.year,
      price: parsed.price,
      currency: parsed.currency,
      price_usd: parsed.priceUSD || parsed.price,
      box_papers: parsed.accessories?.note || null,
      confidence: routing.confidence,
      verdict: routing.verdict,
      catalog_match: catalogResult.match,
      raw_message: rawMessage,
      source: groupId,
      sender_id: senderId,
      received_at: new Date(timestamp).toISOString(),
      ai_notes: JSON.stringify(routing.aiNotes),
      parser_version: 'v4.0-ctx',
      context_brand: parsed.brandSource === 'context' ? 'inherited' : null,
      context_currency: parsed.priceCorrected ? parsed.detectedCurrency : null,
      context_condition: parsed.conditionSource === 'context' ? 'inherited' : null,
    }).select();

      if (error) throw error;
      if (saved?.[0]) savedRecords.push(saved[0]);
    } // end for each listing

    res.status(200).json({
      success: true,
      count: savedRecords.length,
      ids: savedRecords.map(r => r.id),
      listings: parsedListings.map(p => ({
        brand: p.brand,
        reference: p.ref,
        price: p.price,
        currency: p.currency,
        confidence: p.confidence,
        verdict: p.listingType,
        contextBrand: p.brandSource === 'context',
        priceCorrected: p.priceCorrected || false,
      })),
    });

  } catch (err) {
    console.error('Green API webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
