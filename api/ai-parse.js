/**
 * AI PARSE ENDPOINT — POST /api/ai-parse
 *
 * Re-analyses a single watch listing using Ollama local AI.
 * Used by the Demo page's "AI Re-Analyze" button for HUMAN-verdict records.
 *
 * POST body:
 *   { rawMessage: string, brand?: string, reference?: string, priceUSD?: number }
 *
 * Returns:
 *   { brand: string|null, reference: string|null, price: number|null, currency: string|null, confidence: number }
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:4b-q4_K_M';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { rawMessage, brand, reference, priceUSD } = req.body || {};
  if (!rawMessage && !reference) {
    return res.status(400).json({ error: 'rawMessage or reference required' });
  }

  try {
    const message = rawMessage || `${brand || ''} ${reference || ''} ${priceUSD ? '$' + priceUSD : ''}`;
    const prompt = `Watch listing message. Extract watch details as JSON only.
Message: "${message.replace(/"/g, "'").slice(0, 400)}"

Rules:
- brand: normalized brand name or null if unclear
- reference: exact model reference number or null
- price: numeric price in USD (not a year 1990-2030) or null
- currency: currency code (USD/HKD/EUR/GBP/CHF) or null
- confidence: 0-100 score (80+ = good extraction, 50-79 = partial, <50 = uncertain)

Return ONLY a JSON object with fields: brand, reference, price, currency, confidence`;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.05, num_predict: 150, top_k: 5 },
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Ollama error: ${response.status}` });
    }

    const data = await response.json();
    const raw = (data.response || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    
    if (!jsonMatch) {
      return res.json({
        brand: brand || null,
        reference: reference || null,
        price: priceUSD || null,
        currency: null,
        confidence: 0,
        note: 'AI could not parse this message',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.json({
        brand: brand || null,
        reference: reference || null,
        price: priceUSD || null,
        currency: null,
        confidence: 0,
      });
    }

    // Validate price is not a year
    const price = parsed.price;
    const validPrice = (price !== null && price !== undefined && (price < 1990 || price > 2030)) ? price : null;

    return res.json({
      brand: parsed.brand || brand || null,
      reference: parsed.reference || reference || null,
      price: validPrice || priceUSD || null,
      currency: parsed.currency || null,
      confidence: parsed.confidence || 0,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      brand: brand || null,
      reference: reference || null,
      price: priceUSD || null,
      currency: null,
      confidence: 0,
    });
  }
}
