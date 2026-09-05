/**
 * Bounded image-review advisory.
 *
 * A vision model sees only the source image. It never receives the raw listing
 * or claimed identity. Its observation is compared server-side and cannot
 * attach media, edit a record, or approve publication.
 */

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
const { fetchPublicImage } = require('./_lib/safe-image-fetch.cjs');
const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');
const { consumeAiQuota, rejectForQuota } = require('./_lib/ai-quota.cjs');
const { sameOrigin } = require('./_lib/review-packets.cjs');
const { classifyVisualAdvisory } = require('./_lib/image-visual-advisory.cjs');

const VISION_PROMPT = `Inspect only this source watch image. Do not infer values that are not visible and do not decide whether it matches any listing.

Return only a JSON object with exactly these keys:
brand (string or "UNKNOWN")
referenceVisible (string printed on the watch, papers, or a clearly associated tag; otherwise "UNKNOWN")
modelGuess (string or "UNKNOWN")
dialColor (string or "UNKNOWN")
legible (boolean)
confidence (number 0-100 for the observation itself)
notes (short string)

Set legible false for a blurry, cropped, unrelated, box-only, strap-only, or otherwise insufficient image. Never guess a reference from a model, design, color, or market knowledge.`;

function boundedText(value, maximum) {
  return String(value || '').trim().slice(0, maximum);
}

function parseObservation(raw) {
  if (!raw) return null;
  const candidates = raw.match(/\{[\s\S]*?\}/g) || [];
  for (const candidate of candidates.reverse()) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch { /* Try the next bounded JSON object. */ }
  }
  return null;
}

async function visionGemini(key, base64, mime) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 300, responseMimeType: 'application/json' },
    }),
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}`);
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  return { parsed: parseObservation(raw), source: 'gemini' };
}

async function visionKimi(key, imageUrl) {
  const response = await fetch(KIMI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: 'system', content: 'Return only valid JSON. Do not decide a listing match.' },
        { role: 'user', content: [{ type: 'text', text: VISION_PROMPT }, { type: 'image_url', image_url: { url: imageUrl } }] },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Kimi ${response.status}`);
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
  return { parsed: parseObservation(raw), source: 'kimi' };
}

async function visionOpenAI(key, imageUrl) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only a valid JSON object. Do not decide a listing match.' },
        { role: 'user', content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ] },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}`);
  const data = await response.json();
  return { parsed: parseObservation(data.choices?.[0]?.message?.content || ''), source: 'openai' };
}

function providerFailure(provider, error) {
  console.error(`[verify-image] ${provider} unavailable:`, error.message);
  return provider;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  if (!await authorizeMutation(req, res, new Set(['reviewer', 'admin']))) return;

  const imageUrl = boundedText(req.body?.imageUrl, 2_000);
  const claim = {
    reference: boundedText(req.body?.reference, 120),
    brand: boundedText(req.body?.brand, 120),
    model: boundedText(req.body?.model, 200),
    dialColor: boundedText(req.body?.dialColor, 120),
  };
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  if (!claim.reference) return res.status(400).json({ error: 'reference required for exact visual comparison' });

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!geminiKey && !kimiKey && !openaiKey) {
    return res.status(503).json({ error: 'Image review assistance is not configured' });
  }

  const quota = await consumeAiQuota(req, { route: 'image-visual-advisory', limit: 20 });
  if (!quota.allowed) return rejectForQuota(res, quota);

  try {
    const unavailableProviders = [];
    let vision;
    if (kimiKey) {
      try { vision = await visionKimi(kimiKey, imageUrl); } catch (error) { unavailableProviders.push(providerFailure('Kimi', error)); }
    }
    if (!vision?.parsed && openaiKey) {
      try { vision = await visionOpenAI(openaiKey, imageUrl); } catch (error) { unavailableProviders.push(providerFailure('OpenAI', error)); }
    }
    if (!vision?.parsed && geminiKey) {
      try {
        const sourceImage = await fetchPublicImage(imageUrl);
        vision = await visionGemini(geminiKey, sourceImage.buffer.toString('base64'), sourceImage.mime);
      } catch (error) {
        unavailableProviders.push(providerFailure('Gemini', error));
      }
    }
    if (!vision?.parsed) {
      const tried = unavailableProviders.length ? ` (${unavailableProviders.join(', ')} unavailable)` : '';
      return res.status(502).json({ error: `Vision providers returned no structured observation${tried}` });
    }

    const advisory = classifyVisualAdvisory(claim, vision.parsed);
    return res.status(200).json({
      success: true,
      ...advisory,
      textReference: claim.reference,
      source: vision.source,
      policy: 'AI is advisory only. It does not attach images, alter listing fields, approve a review, or publish a listing.',
    });
  } catch (error) {
    console.error('[verify-image]', error.message);
    const status = /image url|private|reserved|disallowed port|10 mb|not an image/i.test(error.message) ? 400 : 502;
    return res.status(status).json({ error: status === 400 ? error.message : 'Image review assistance failed' });
  }
};
