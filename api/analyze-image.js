// Vercel serverless: Analyze watch image with Gemini Vision for dial color
const { fetchPublicImage } = require('./_lib/safe-image-fetch.cjs');
const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await authorizeMutation(req, res, new Set(['reviewer', 'admin']))) return;

  const { imageUrl, reference } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  try {
    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

    // Fetch image as base64
    const image = await fetchPublicImage(imageUrl);
    const base64 = image.buffer.toString('base64');
    const mimeType = image.mime;

    const prompt = `You are a luxury watch expert. Look at this image of a watch${reference ? ` (reference ${reference})` : ''} and identify the dial color precisely.

Respond with ONLY a JSON object in this exact format:
{"dialColor": "<color>", "confidence": <0-100>, "brand": "<brand or null>", "notes": "<brief note>"}

Be specific: e.g. "Sunburst Blue", "Silver", "Black", "Champagne", "Tiffany Blue", "Green", "Brown", "Grey", "White", "Panda (white with black subdials)", "Reverse Panda (black with white subdials)".
If you cannot determine the color, use "UNKNOWN".`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API ${geminiRes.status}: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { dialColor: 'UNKNOWN', confidence: 0, notes: 'Parse failed' };

    res.json({
      success: true,
      dialColor: parsed.dialColor || 'UNKNOWN',
      confidence: parsed.confidence || 0,
      brand: parsed.brand || null,
      notes: parsed.notes || '',
      raw: text,
    });
  } catch (e) {
    console.error('[analyze-image]', e.message);
    const status = /image url|private|reserved|disallowed port|10 mb|not an image/i.test(e.message) ? 400 : 502;
    res.status(status).json({ error: status === 400 ? e.message : 'Image analysis failed' });
  }
}
