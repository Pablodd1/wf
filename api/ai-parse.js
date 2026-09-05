/**
 * AI parser — Gemini 2.5 Flash, Kimi K2.6, or Claude
 * For multi-line chat messages, sends the full message to Gemini with
 * instructions to extract ALL watch listings as an array.
 * Falls back to line-by-line Kimi if Gemini times out.
 * CommonJS for Vercel serverless — maxDuration: 60
 */

const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');
const { consumeAiQuota, rejectForQuota } = require('./_lib/ai-quota.cjs');

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';
const { ZERO_HALLUCINATION_NORMALIZATION_CONTRACT } = require('./_lib/ai-normalization-contract.cjs');

const SYS = `You are a luxury watch expert parsing WhatsApp chat listings.
Extract ALL watch listings from the message. For each listing extract:
- reference: watch reference number
- dialColor: dial color in English
- brand: brand name
- condition: "New", "Used", or "Unknown"
- year: 4-digit year if mentioned, else null
- price: numeric value only
- currency: "HKD", "USD", "USDT", or "EUR"
- intent: "SELL" if offering for sale, "BUY" if looking to purchase (WTB, want to buy, looking for, NTQ, ISO), "INQUIRY" if asking a question

Rules:
1. Do not infer dial color from a reference suffix. Return null unless the raw message states it.
2. If multiple listings are present, return an ARRAY of objects.
3. If only one listing, return a single object (not array).
4. Do not invent a brand. Return null when it is not explicit; catalog reconciliation may validate it later.
5. Return ONLY valid JSON. No markdown, no explanations.

${ZERO_HALLUCINATION_NORMALIZATION_CONTRACT}`;

/** Try Gemini first (handles multi-listing natively), then Kimi line-by-line */
async function tryAI(text, gKey, kKey, cKey) {
  const flat = text; // preserve newlines — Gemini needs structure

  // Gemini — can handle multi-listing in one shot
  if (gKey) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 12000);
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: SYS + '\n\nMessage:\n"""\n' + flat + '\n"""\nExtract JSON:' }] }],
            generationConfig: { maxOutputTokens: 2048, temperature: 0 } }) }
      );
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        const c = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = c.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Normalize: always wrap single obj in array
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          if (arr.length > 0) return { ok: true, p: arr, src: 'gemini' };
        }
      }
    } catch (e) { console.error('[ai] Gemini:', e.message); }
  }

  // Kimi — try full message first, fallback to per-line
  if (kKey) {
    const tryKimi = async (msg) => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10000);
      const r = await fetch(KIMI_URL, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${kKey}` }, signal: ac.signal,
        body: JSON.stringify({ model: 'kimi-k2.6',
          messages: [{ role: 'system', content: SYS + '\nReturn an ARRAY if multiple listings.' },
                     { role: 'user', content: 'Message:\n"""\n' + msg + '\n"""\nExtract JSON:' }],
          temperature: 0.5, max_tokens: 8192 }) });
      clearTimeout(t);
      if (r.status === 429) return { retry: true };
      if (r.ok) {
        const d = await r.json();
        const ch = d.choices?.[0];
        let content = ch?.message?.content;
        if (!content && ch?.message?.reasoning_content) content = ch.message.reasoning_content;
        if (content) {
          const m = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            if (arr.length > 0) return { ok: true, p: arr, src: 'kimi' };
          }
        }
      }
      return { ok: false };
    };

    // Full message attempt
    let res = await tryKimi(text);
    if (res.retry) { await new Promise(r => setTimeout(r, 1000)); res = await tryKimi(text); }
    if (res.ok) return res;

    // If full message failed, try splitting into lines and parse each
    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 5);
    if (lines.length >= 2) {
      const results = [];
      for (const line of lines) {
        res = await tryKimi(line);
        if (res.retry) { await new Promise(r => setTimeout(r, 1000)); res = await tryKimi(line); }
        if (res.ok) results.push(res.p[0]);
      }
      if (results.length > 0) return { ok: true, p: results, src: 'kimi', multi: true };
    }
  }

  // Claude
  if (cKey) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10000);
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cKey, 'anthropic-version': '2023-06-01' },
        signal: ac.signal,
        body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, system: SYS,
          messages: [{ role: 'user', content: 'Message:\n"""\n' + flat + '\n"""\nExtract JSON:' }] }) });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        const c = d.content?.[0]?.text || '';
        const m = c.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          if (arr.length > 0) return { ok: true, p: arr, src: 'claude' };
        }
      }
    } catch (e) { console.error('[ai] Claude:', e.message); }
  }

  return { ok: false };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!await authorizeMutation(req, res, new Set(['reviewer', 'admin']))) return;

  const { rawMessage, currentGuess } = req.body;
  if (!rawMessage || typeof rawMessage !== 'string') {
    return res.status(400).json({ error: 'rawMessage (string) required' });
  }
  if (rawMessage.length > 50_000) return res.status(413).json({ error: 'rawMessage exceeds 50,000 characters' });

  const quota = await consumeAiQuota(req, { route: 'ai-parse', limit: 10, windowSeconds: 60 });
  if (!quota.allowed) return rejectForQuota(res, quota);

  const gKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const kKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const cKey = process.env.ANTHROPIC_API_KEY;

  if (!gKey && !kKey && !cKey) {
    return res.status(500).json({ error: 'No AI API key configured.' });
  }

  const r = await tryAI(rawMessage, gKey, kKey, cKey);
  if (!r.ok) return res.status(500).json({ error: 'All AI providers failed' });

  // Normalize: if single result, return object (not array) for backwards compat
  if (r.p.length === 1 && !r.multi) {
    return res.status(200).json({ success: true, parsed: r.p[0], source: r.src });
  }
  return res.status(200).json({ success: true, parsed: r.p, source: r.src, multi: true });
};
