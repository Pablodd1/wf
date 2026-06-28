/**
 * POST /api/green-api-webhook
 * Receives WhatsApp messages from Green API (600 group chats)
 * Runs parser → catalog match → gap detection → saves to SUPABASE
 */
const { parseFull } = require('./_lib/parser');
const { routeByScheme } = require('./_lib/gap-detector');
const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
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

    // Step 1: Parse
    const parsed = parseFull(rawMessage);
    
    // Step 2: Catalog lookup
    let catalogResult = { tier: 5, match: 'unmatched' };
    if (parsed.reference) {
      const { data } = await getClient().from('catalog').select('*').ilike('reference', `%${parsed.reference}%`).limit(1);
      if (data?.[0]) catalogResult = { tier: 1, data: data[0], match: 'exact' };
    }

    // Step 3: Route by scheme
    const routing = await routeByScheme(parsed, catalogResult);

    // Step 4: Save to Supabase
    const { data: saved, error } = await getClient().from('watch_records').insert({
      brand: parsed.brand,
      reference: parsed.reference,
      dial_color: routing.filled.dialColor || parsed.dialColor,
      condition: routing.filled.condition || parsed.condition,
      year: routing.filled.year || parsed.year,
      price: parsed.price,
      currency: parsed.currency,
      price_usd: parsed.priceUSD,
      box_papers: parsed.boxPapers,
      confidence: routing.confidence,
      verdict: routing.verdict,
      catalog_match: catalogResult.match,
      raw_message: rawMessage,
      source: groupId,
      sender_id: senderId,
      received_at: new Date(timestamp).toISOString(),
      ai_notes: JSON.stringify(routing.aiNotes),
      parser_version: 'v2.1',
    }).select();

    if (error) throw error;

    res.status(200).json({
      success: true,
      id: saved?.[0]?.id,
      parsed: { brand: parsed.brand, reference: parsed.reference, price: parsed.priceUSD, confidence: routing.confidence, verdict: routing.verdict },
      routing: { catalogMatch: catalogResult.match, gaps: routing.gaps, aiFilled: routing.aiNeeded, action: routing.action },
    });

  } catch (err) {
    console.error('Green API webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
