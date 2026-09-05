const MAX_MESSAGE_LENGTH = 600;
const { consumeAiQuota } = require('./_lib/ai-quota.cjs');

const systemInstruction = `You are Curated Luxury AI, a concise front-desk assistant for a luxury-watch market intelligence site. Help people choose only one of these routes: /trading for dated dealer listings, /price-research for reference pricing research, or /dashboard for dealer operations. Do not give financial advice, claim data is verified, invent prices, promise sourcing, or discuss private dealer data. Return strict JSON with keys reply and route. route must be one of null, /trading, /price-research, /dashboard.`;

function fallback(message) {
  const text = message.toLowerCase();
  if (/(price|reference|model|value|market)/.test(text)) return { reply: 'Open Price Research to compare dated observations for a reference.', route: '/price-research' };
  if (/(list|buy|sell|trade|inventory|wts|wtb)/.test(text)) return { reply: 'The Trading Floor is the fastest way to browse dated dealer listings.', route: '/trading' };
  if (/(dealer|review|account|operation|admin)/.test(text)) return { reply: 'Dealer access opens the operations workspace and controlled review queue.', route: '/dashboard' };
  return { reply: 'I can help with listings, price research, or dealer access. Which one do you need?', route: null };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: 'A message up to 600 characters is required.' });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(200).json(fallback(message));

  const quota = await consumeAiQuota(req, { route: 'front-desk', limit: 20 });
  if (!quota.allowed) return res.status(200).json({ ...fallback(message), limited: true });

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemInstruction}\n\nVisitor message: ${message}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 160, responseMimeType: 'application/json' },
      }),
    });
    if (!response.ok) throw new Error('Gemini request failed');
    const body = await response.json();
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(text || '{}');
    const route = ['/trading', '/price-research', '/dashboard'].includes(parsed.route) ? parsed.route : null;
    return res.status(200).json({ reply: String(parsed.reply || fallback(message).reply).slice(0, 500), route });
  } catch {
    return res.status(200).json(fallback(message));
  }
};
