/**
 * Vision API — Dial Color Extraction
 * POST /api/vision/dial-color
 * Body: { "imageUrl": "https://...", "reference": "116610LN" }
 * Returns: { "dialColor": "Black", "confidence": 0.85, "catalogMatch": true }
 *
 * Uses Kimi K2.6 Vision (api.moonshot.ai) to identify dial color from watch photos.
 * Falls back to reference-suffix inference if vision unavailable.
 */

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';

const VISION_PROMPT = `You are a luxury watch authentication expert. Look at this watch photo and identify the DIAL COLOR.

Rules:
1. Be specific but standardized: "Sunburst Blue", "Matte Black", "Silver Sunburst", "Champagne", "Meteorite", "Mother of Pearl", "Pavé Diamond"
2. Merge similar colors: "Navy Blue" and "Dark Blue" → "Blue"
3. NEVER collapse these unique colors: Tiffany Blue, Meteorite, Mother of Pearl, Skeleton, Pavé Diamond
4. If the dial has diamond hour markers but is NOT full pavé, the color is the base dial color
5. If the entire dial surface is covered in diamonds → "Pavé Diamond"
6. Return ONLY the color name as a plain string, no JSON, no explanation.`;

const REF_SUFFIX_DIAL = {
  LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown/Black',
  BLNR: 'Blue/Black', BLRO: 'Blue/Red', VTNR: 'Black/Green',
  GRNR: 'Black/Grey', SARU: 'Orange',
};

const REF_DIAL_OVERRIDES = {
  '116500LN': 'White', '116500': 'White', '126500LN': 'White', '126500': 'White',
  '116518': 'Champagne', '116519': 'Meteorite', '116595RBOW': 'Rainbow',
  '126710BLNR': 'Blue/Black', '126710BLRO': 'Blue/Red',
  '5711/1A': 'Blue', '5712/1A': 'Blue', '5167A': 'Black',
  '5164A': 'Black', '5968A': 'Black', '5968G': 'Green',
  '126334': 'Grey', '126234': 'Grey',
};

function inferDialFromRef(ref) {
  if (!ref) return null;
  const clean = ref.toUpperCase();
  
  for (const [key, color] of Object.entries(REF_DIAL_OVERRIDES)) {
    if (clean.includes(key.toUpperCase())) return color;
  }
  
  for (const [suffix, color] of Object.entries(REF_SUFFIX_DIAL)) {
    if (clean.endsWith(suffix.toUpperCase()) || clean.includes('/' + suffix.toUpperCase())) {
      return color;
    }
  }
  
  return null;
}

async function visionDialColor(imageUrl, kimiKey) {
  const refDial = null; // Will be used if vision fails
  let modelUsed = 'reference-suffix';
  let confidence = 0.3;
  let dialColor = null;
  
  if (kimiKey && imageUrl) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 15000);
      
      const response = await fetch(KIMI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kimiKey}`,
        },
        signal: ac.signal,
        body: JSON.stringify({
          model: 'kimi-k2.6',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imageUrl } },
                { type: 'text', text: VISION_PROMPT },
              ],
            },
          ],
          temperature: 0,
          max_tokens: 50,
        }),
      });
      
      clearTimeout(timer);
      
      if (response.ok) {
        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content || '';
        const color = raw.trim().replace(/["']/g, '');
        if (color && color.length < 50) {
          dialColor = color;
          confidence = 0.85;
          modelUsed = 'kimi-k2.6-vision';
        }
      }
    } catch (e) {
      console.warn('[Vision] Kimi vision failed:', e.message || e);
    }
  }
  
  if (!dialColor) {
    dialColor = refDial || inferDialFromRef(imageUrl);
    if (dialColor) {
      confidence = 0.40;
      modelUsed = 'reference-suffix';
    }
  }
  
  return { dialColor, confidence, modelUsed };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  
  try {
    const { imageUrl, reference } = req.body || {};
    if (!imageUrl && !reference) return res.status(400).json({ error: 'imageUrl or reference required' });
    
    const kimiKey = process.env.KIMI_API_KEY || '';
    const result = await visionDialColor(imageUrl, kimiKey);
    
    // Check catalog match
    const refDial = inferDialFromRef(reference);
    const catalogMatch = refDial ? result.dialColor === refDial || result.dialColor?.includes(refDial) : null;
    
    res.json({ ...result, catalogMatch, reference });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
