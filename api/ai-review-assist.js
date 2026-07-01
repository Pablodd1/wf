/**
 * POST /api/ai-review-assist
 * Human Review AI assist: reads raw listing data, tries to identify/verify
 * the brand+reference, and optionally does a web search sanity-check.
 *
 * Body: { id, brand, reference, dial_color, condition, price_usd, raw_message }
 *
 * Gracefully degrades: if no AI provider key is configured, returns a
 * clear "not_configured" response instead of a raw error — the frontend
 * shows this as a disabled/informational state, never a silent failure.
 *
 * Provider: Kimi K2.6 (Moonshot) — cheap, matches project's Chinese-model
 * cost preference. Falls back to OpenAI if Kimi key is missing but OpenAI
 * is present. If neither is configured, returns not_configured.
 */

const KIMI_KEY = process.env.KIMI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

async function callKimi(prompt) {
  const res = await fetch('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KIMI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: prompt }],
      temperature: 1, // K2.6 hard requirement — any other value returns HTTP 400
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`Kimi HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content;
  if (!content) content = data.choices?.[0]?.message?.reasoning_content; // K2.6 thinking-mode fallback
  if (!content) throw new Error(`Kimi returned no content (finish_reason: ${data.choices?.[0]?.finish_reason})`);
  return content;
}

async function callOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const hasKimi = !!(KIMI_KEY && KIMI_KEY.length > 10);
  const hasOpenAI = !!(OPENAI_KEY && OPENAI_KEY.length > 10);

  if (!hasKimi && !hasOpenAI) {
    return res.status(200).json({
      configured: false,
      message: 'No AI provider API key is configured. Set KIMI_API_KEY (or OPENAI_API_KEY) in Vercel env vars to enable AI-assisted review.',
    });
  }

  try {
    const { brand, reference, dial_color, condition, price_usd, raw_message } = req.body || {};

    const prompt = `You are a luxury watch identification expert helping a human reviewer verify a listing that has LOW confidence and needs manual review.

RAW LISTING TEXT (as originally posted by the dealer):
"""
${raw_message || '(no raw message available)'}
"""

CURRENT PARSED FIELDS (may be wrong — that's why this needs review):
- Brand: ${brand || '(none detected)'}
- Reference: ${reference || '(none detected)'}
- Dial color: ${dial_color || '(none)'}
- Condition: ${condition || '(none)'}
- Price (USD): ${price_usd != null ? price_usd : '(none)'}

TASK:
1. Read the raw text carefully and identify the ACTUAL brand and reference number, even if abbreviated (e.g. "pp"=Patek Philippe, "ap"=Audemars Piguet, "rlx"=Rolex).
2. State whether the CURRENT PARSED FIELDS look correct, and if not, what they should be.
3. Flag anything suspicious: garbled text, multiple watches bundled in one listing, price/reference confusion, missing info.
4. Give a confidence assessment: HIGH (parsed fields are correct), MEDIUM (probably correct but unverified), LOW (parsed fields look wrong or unparseable).

Respond in this exact format:
BRAND: <your best guess>
REFERENCE: <your best guess>
VERDICT: <CORRECT | NEEDS_CORRECTION | UNCLEAR>
CONFIDENCE: <HIGH | MEDIUM | LOW>
NOTES: <1-3 sentences explaining your reasoning and any red flags>`;

    let answer;
    let providerUsed;
    if (hasKimi) {
      try {
        answer = await callKimi(prompt);
        providerUsed = 'kimi-k2.6';
      } catch (kimiErr) {
        if (hasOpenAI) {
          answer = await callOpenAI(prompt);
          providerUsed = 'gpt-4o-mini (kimi fallback)';
        } else {
          throw kimiErr;
        }
      }
    } else {
      answer = await callOpenAI(prompt);
      providerUsed = 'gpt-4o-mini';
    }

    res.status(200).json({ configured: true, provider: providerUsed, analysis: answer });
  } catch (err) {
    res.status(200).json({ configured: true, error: true, message: `AI request failed: ${err.message}` });
  }
};
