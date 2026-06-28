/**
 * POST /api/green-api-webhook
 * Receives WhatsApp messages from Green API (600 group chats)
 * Runs parser → catalog match → gap detection → saves to MySQL
 */
const { parseFull } = require('./_lib/parser');
const { routeByScheme } = require('./_lib/gap-detector');
const { getPool } = require('./_lib/db');

// Simple catalog lookup (avoids loading full JSON in serverless)
async function lookupCatalog(reference, brand) {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT * FROM catalog WHERE reference = ? OR reference LIKE ? LIMIT 1',
      [reference, `%${reference}%`]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
  const authHeader = req.headers['x-green-api-token'];
  
  // Optional: verify Green API token
  if (GREEN_API_TOKEN && authHeader !== GREEN_API_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    // Green API webhook payload format
    const body = req.body;
    
    // Extract message data
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
    if (body.timestamp) {
      timestamp = body.timestamp * 1000;
    }

    if (!rawMessage) {
      return res.status(400).json({ error: 'No message text found' });
    }

    // Step 1: Parse the message
    const parsed = parseFull(rawMessage);
    
    // Step 2: Look up catalog
    const catalogEntry = parsed.reference 
      ? await lookupCatalog(parsed.reference, parsed.brand)
      : null;
    
    const catalogResult = catalogEntry
      ? { tier: 1, data: catalogEntry, match: 'exact' }
      : { tier: 5, match: 'unmatched' };

    // Step 3: Route by scheme (gap detection + confidence)
    const routing = await routeByScheme(parsed, catalogResult);

    // Step 4: Save to database
    const pool = getPool();
    const [result] = await pool.execute(
      `INSERT INTO watch_records (
        brand, reference, dial_color, condition, year,
        price, currency, price_usd, box_papers, confidence,
        verdict, catalog_match, raw_message, source, sender_id,
        received_at, ai_notes, parser_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parsed.brand,
        parsed.reference,
        routing.filled.dialColor || parsed.dialColor,
        routing.filled.condition || parsed.condition,
        routing.filled.year || parsed.year,
        parsed.price,
        parsed.currency,
        parsed.priceUSD,
        parsed.boxPapers,
        routing.confidence,
        routing.verdict,
        catalogResult.match,
        rawMessage,
        groupId,
        senderId,
        new Date(timestamp),
        JSON.stringify(routing.aiNotes),
        'v2.1',
      ]
    );

    res.status(200).json({
      success: true,
      id: result.insertId,
      parsed: {
        brand: parsed.brand,
        reference: parsed.reference,
        price: parsed.priceUSD,
        confidence: routing.confidence,
        verdict: routing.verdict,
      },
      routing: {
        catalogMatch: catalogResult.match,
        gaps: routing.gaps,
        aiFilled: routing.aiNeeded,
        action: routing.action,
      },
    });

  } catch (err) {
    console.error('Green API webhook error:', err.message);
    res.status(500).json({ error: err.message, received: !!req.body });
  }
};
