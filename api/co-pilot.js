/**
 * AI CO-PILOT ENDPOINT
 * POST /api/co-pilot
 *
 * For records the parser couldn't handle (confidence < 60),
 * the human reviewer asks the AI co-pilot to interpret the raw message.
 *
 * Returns:
 *   - best guess for brand, ref, dial, price, etc.
 *   - 2-3 alternative interpretations if ambiguous
 *   - ambiguities the human should double-check
 *
 * Body: { rawMessage, currentGuess? }
 */

const { ZERO_HALLUCINATION_NORMALIZATION_CONTRACT } = require('./_lib/ai-normalization-contract.cjs');
const { consumeAiQuota, rejectForQuota } = require('./_lib/ai-quota.cjs');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { REVIEW_FIELDS, summarizeAssistance } = require('./_lib/review-assistant.cjs');

const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    confidence: { type: 'INTEGER' },
    interpretations: { type: 'ARRAY', items: { type: 'STRING' } },
    ambiguities: { type: 'ARRAY', items: { type: 'STRING' } },
    summary: { type: 'STRING' },
    fieldSuggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          field: { type: 'STRING', enum: REVIEW_FIELDS },
          value: { type: 'STRING', nullable: true },
          evidenceQuote: { type: 'STRING', nullable: true },
          reason: { type: 'STRING' },
        },
        required: ['field', 'value', 'evidenceQuote', 'reason'],
      },
    },
  },
  required: ['confidence', 'interpretations', 'ambiguities', 'summary', 'fieldSuggestions'],
};

function boundedGuessValue(value, maxLength = 160) {
  if (value == null) return null;
  const normalized = String(value).trim().slice(0, maxLength);
  return normalized || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dealerAuth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (dealerAuth.error) return res.status(dealerAuth.status).json({ error: dealerAuth.error });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Gemini review assistance is not configured' });
  }

  const { rawMessage, currentGuess } = req.body || {};
  const boundedRawMessage = redactPublicSource(String(rawMessage || '').trim()).slice(0, 12_000);
  if (!boundedRawMessage) {
    return res.status(400).json({ error: 'rawMessage required' });
  }

  const quota = await consumeAiQuota(req, { route: 'co-pilot', limit: 10 });
  if (!quota.allowed) return rejectForQuota(res, quota);

  const systemPrompt = `You are a luxury watch co-pilot helping a human reviewer fix a record the parser couldn't fully understand.

Your job:
1. Extract only what the dealer message explicitly supports
2. If multiple interpretations exist, give the 2-3 most likely
3. Highlight ambiguities the human should double-check
4. Use your knowledge of:
   - Rolex 6-digit refs with LN/LV/LB/BLNR/BLRO suffixes
   - Patek 5xxx/xxxx slash refs (5270P, 5167A, 5935A, 5712/1A, etc.)
   - RM 11-01/02/03/04 Felipe Massa (RM 11-03 most common 2024)
   - AP 15500ST/15510ST/16202ST Royal Oak variants
   - VC 336xxx Overseas
   - Common emoji: 🔵 Patek, 🔴 AP, 🟢 Rolex, ⚫ Submariner

Return exactly one suggestion object for each of these fields:
brand, model, reference, dialColor, condition, year, price, currency, listingType.

For every field:
- value must be a string copied from the evidence, or null
- evidenceQuote must be an exact contiguous quote from the raw message, or null
- do not paraphrase evidenceQuote
- if the value requires interpretation, expansion, typo repair, or is absent, use null
- price must preserve the dealer's numeric form; do not expand K or M
- currency requires an explicit marker; bare $ is ambiguous

Return JSON with:
{
  "confidence": 0-100,
  "interpretations": ["interpretation 1", "interpretation 2", "interpretation 3"],
  "ambiguities": ["thing to double-check 1", "thing 2"],
  "summary": "short reviewer guidance",
  "fieldSuggestions": [
    {
      "field": "reference",
      "value": "exact supported value or null",
      "evidenceQuote": "exact contiguous raw-message quote or null",
      "reason": "why this is supported or unresolved"
    }
  ]
}

${ZERO_HALLUCINATION_NORMALIZATION_CONTRACT}`;

  const boundedGuess = currentGuess && typeof currentGuess === 'object'
    ? {
        brand: boundedGuessValue(currentGuess.brand, 80),
        reference: boundedGuessValue(currentGuess.reference, 80),
        model: boundedGuessValue(currentGuess.model),
        dialColor: boundedGuessValue(currentGuess.dialColor, 80),
        condition: boundedGuessValue(currentGuess.condition, 80),
        year: boundedGuessValue(currentGuess.year, 12),
        price: boundedGuessValue(currentGuess.price, 80),
        currency: boundedGuessValue(currentGuess.currency, 12),
        listingType: boundedGuessValue(currentGuess.listingType, 20),
      }
    : null;
  const userPrompt = boundedGuess
    ? `Raw dealer message: "${boundedRawMessage}"\n\nCurrent deterministic candidate: ${JSON.stringify(boundedGuess)}\n\nHelp the human verify or correct this. Catalog approval is handled separately and must not be claimed.`
    : `Raw dealer message: "${boundedRawMessage}"\n\nHelp the human reviewer identify only explicitly supported fields. Catalog approval is handled separately.`;

  try {
    const model = process.env.GEMINI_REVIEW_MODEL || 'gemini-2.5-flash';
    const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: REVIEW_SCHEMA,
        },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.status(500).json({
        success: false,
        error: `Gemini HTTP ${aiResp.status}: ${errText.slice(0, 200)}`,
      });
    }

    const data = await aiResp.json();
    const content = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '{}';
    const parsed = JSON.parse(content);
    const assistance = summarizeAssistance(
      boundedRawMessage,
      boundedGuess || {},
      parsed.fieldSuggestions,
    );
    const bestValue = field => assistance.suggestions.find(
      suggestion => suggestion.field === field && suggestion.applicable,
    )?.value || null;

    return res.status(200).json({
      success: true,
      copilot: {
        confidence: Number(parsed.confidence || 0),
        interpretations: Array.isArray(parsed.interpretations) ? parsed.interpretations.map(String).slice(0, 3) : [],
        ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities.map(String).slice(0, 12) : [],
        summary: String(parsed.summary || 'Review the field-level evidence before applying any suggestion.').slice(0, 1000),
        ...assistance,
        // Backward-compatible summary values for older review clients.
        brand: bestValue('brand'),
        model: bestValue('model'),
        reference: bestValue('reference'),
        dialColor: bestValue('dialColor'),
        condition: bestValue('condition'),
        year: bestValue('year'),
        price: bestValue('price'),
        currency: bestValue('currency'),
        listingType: bestValue('listingType'),
      },
      tokens: data.usageMetadata?.totalTokenCount || 0,
      model,
      policy: 'AI suggestions only populate a reviewer draft. They never approve, publish, or write watch_records.',
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
};
