/**
 * Shared Vision Module for WatchFacts — CJS (matches api/package.json "type":"commonjs")
 *
 * Unified image analysis: dial color + brand + reference verification in ONE call.
 * Replaces the old self-HTTP pattern (clean-analyze calling /api/verify-image).
 *
 * Provider priority:
 *   1. GPT-4o-mini — accepts image URLs directly (NO download/resize needed, ~2-4s)
 *   2. Gemini 2.5 Flash — downloads + base64 (fallback, ~3-5s)
 *
 * Returns:
 *   {
 *     dialColor: string,         // "Blue", "Black", "UNKNOWN"
 *     dialConfidence: number,    // 0-100
 *     brand: string|null,        // "Rolex" or null
 *     referenceVisible: string,  // ref printed on watch/papers, or "UNKNOWN"
 *     verificationVerdict: string, // "MATCH" | "MISMATCH" | "UNVERIFIED"
 *     legible: boolean,
 *     confidence: number,        // overall vision confidence 0-100
 *     notes: string,
 *     source: string,            // "gpt-4o-mini" | "gemini-2.5-flash"
 *     reason: string,            // human-readable summary
 *   }
 */

'use strict';

// ── Image resize (sharp) — prevents 4MB+ images from breaking Gemini/HTTP ──
let _sharp = null;
async function getSharp() {
  if (_sharp) return _sharp;
  try {
    _sharp = require('sharp');
    return _sharp;
  } catch (e) {
    console.warn('[vision] sharp not available — images sent at original size');
    return null;
  }
}

// Resize to max 1024px JPEG q0.85 (~100-200KB). Returns {base64, mime} or null.
async function resizeToBase64(buf) {
  const sharp = await getSharp();
  if (!sharp) {
    // No sharp — return original as base64 if under 4MB
    if (buf.length > 4 * 1024 * 1024) return null;
    return { base64: buf.toString('base64'), mime: 'image/jpeg' };
  }
  try {
    const resized = await sharp(buf)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { base64: resized.toString('base64'), mime: 'image/jpeg' };
  } catch (e) {
    console.error('[vision] sharp resize error:', e.message);
    // Fall back to original if resize fails
    if (buf.length < 4 * 1024 * 1024) return { base64: buf.toString('base64'), mime: 'image/jpeg' };
    return null;
  }
}

// ── Reference normalization (shared with verify-image logic) ─────────────────
function normRef(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function refsAgree(textRef, imageRef) {
  const a = normRef(textRef);
  const b = normRef(imageRef);
  if (!a || !b || b === 'UNKNOWN' || a === 'UNKNOWN' || b === 'NA' || b === 'NONE') return null;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const coreA = (a.match(/\d{4,6}/) || [])[0];
  const coreB = (b.match(/\d{4,6}/) || [])[0];
  if (coreA && coreB && coreA === coreB) return true;
  return false;
}

function brandsAgree(textBrand, imageBrand) {
  if (!textBrand || !imageBrand) return null;
  if (textBrand === 'Unknown' || imageBrand === 'UNKNOWN') return null;
  const a = textBrand.toLowerCase().trim();
  const b = imageBrand.toLowerCase().trim();
  if (a === b) return true;
  // Partial matches: "Patek Philippe" vs "Patek"
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

// ── JSON extraction (handles markdown fences + prose preamble) ───────────────
function extractJson(text) {
  if (!text) return null;
  // Strip markdown fences
  let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  // Find all balanced {...} candidates, try last-first (final answer wins)
  const candidates = [];
  const stack = [];
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '{') { if (stack.length === 0) start = i; stack.push(c); }
    else if (c === '}') {
      stack.pop();
      if (stack.length === 0 && start >= 0) {
        candidates.push(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i]);
    } catch (e) { /* try next */ }
  }
  return null;
}

// ── Unified prompt (same for both providers) ─────────────────────────────────
const VISION_PROMPT = `You are a luxury watch authentication expert. Look at this watch photo and report ONLY what you can see — do NOT guess to match any expectation.

CRITICAL: Focus on the DIAL COLOR. The dial is the watch face (the circular area under the crystal where hour markers are). Do NOT confuse it with:
- Case color (gold, steel, rose gold)
- Strap/bracelet color
- Box or papers color

Return ONLY a JSON object with exactly these keys:
{
  "brand": "string (e.g. 'Rolex', 'Patek Philippe', or 'UNKNOWN')",
  "referenceVisible": "string (any reference number printed on the watch/papers, else 'UNKNOWN')",
  "modelGuess": "string (model family if recognizable, else 'UNKNOWN')",
  "dialColor": "string (e.g. 'Blue', 'Black', 'Green', 'White', 'Silver', 'Grey', 'Brown', 'Champagne', 'Tiffany Blue', 'Salmon', 'Purple', 'Red', 'Orange', 'Yellow', 'MOP', 'Diamond', or 'UNKNOWN')",
  "dialConfidence": "number 0-100 (how clearly you can see the dial color)",
  "legible": "boolean (false if blurry, cropped, box/strap only, or not a clear watch face)",
  "confidence": "number 0-100 (overall confidence in your assessment)",
  "notes": "string (brief observation)"
}

Be honest when unsure. Set legible to false if the image is not a clear watch face.`;

// ── Provider 1: GPT-4o-mini (primary — URL passthrough, no download) ─────────
async function analyzeWithGPT4o(imageUrl, textReference, textBrand) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const userText = textReference
    ? `Analyze this watch image. The text listing claims reference "${textReference}"${textBrand ? ` and brand "${textBrand}"` : ''}. Report what YOU see in the image independently.`
    : 'Analyze this watch image and report what you see.';

  // Attempt 1: URL passthrough (fastest — OpenAI fetches the image)
  let result = await gpt4oCall(apiKey, [
    { type: 'text', text: userText },
    { type: 'image_url', image_url: { url: imageUrl } },
  ], textReference, textBrand);
  if (result) return result;

  // Attempt 2: Download + resize + base64 (fallback for CDNs that block OpenAI)
  console.log('[vision] GPT-4o URL passthrough failed, trying download+resize+base64...');
  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const resized = await resizeToBase64(buf);
      if (resized) {
        result = await gpt4oCall(apiKey, [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: `data:${resized.mime};base64,${resized.base64}` } },
        ], textReference, textBrand);
        if (result) return result;
      }
    }
  } catch (e) {
    console.error('[vision] GPT-4o download fallback error:', e.message);
  }

  return null;
}

async function gpt4oCall(apiKey, msgContent, textReference, textBrand) {
  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: VISION_PROMPT },
      { role: 'user', content: msgContent },
    ],
    temperature: 0.1,
    max_tokens: 512,
    response_format: { type: 'json_object' },
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[vision] GPT-4o-mini HTTP', res.status, errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const parsed = extractJson(text) || {};
    return buildResult(parsed, 'gpt-4o-mini', textReference, textBrand);
  } catch (e) {
    console.error('[vision] GPT-4o-mini error:', e.message);
    return null;
  }
}

// ── Provider 2: Gemini 2.5 Flash (fallback — download + base64) ─────────────
async function analyzeWithGemini(imageUrl, textReference, textBrand) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  // Download the image
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!imgRes.ok) {
    console.error('[vision] Gemini image fetch failed:', imgRes.status);
    return null;
  }

  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  // Resize via sharp (removes 4MB size gate — phone photos now work)
  const resized = await resizeToBase64(imgBuffer);
  if (!resized) {
    console.error('[vision] Gemini resize failed, image too large or unreadable');
    return null;
  }
  const base64 = resized.base64;
  const mimeType = resized.mime;

  const userText = textReference
    ? `Analyze this watch image. The text listing claims reference "${textReference}"${textBrand ? ` and brand "${textBrand}"` : ''}. Report what YOU see in the image independently.`
    : 'Analyze this watch image and report what you see.';

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const res = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: VISION_PROMPT + '\n\n' + userText },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[vision] Gemini HTTP', res.status, errText.slice(0, 200));
    return null;
  }

  const geminiData = await res.json();
  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJson(text) || {};

  return buildResult(parsed, 'gemini-2.5-flash', textReference, textBrand);
}

// ── Build unified result from parsed vision output ─────────────────────────────
function buildResult(parsed, source, textReference, textBrand) {
  // Normalize dial color to canonical values (matches catalog + regex parse)
  const DIAL_COLOR_MAP = {
    'tiffany blue': 'Tiffany', 'tiffany': 'Tiffany',
    'mother of pearl': 'MOP', 'mop': 'MOP', 'mother-of-pearl': 'MOP',
    'champagne': 'Champagne', 'champ': 'Champagne',
    'salmon': 'Salmon', 'copper': 'Salmon',
    'purple': 'Purple', 'violet': 'Purple', 'plum': 'Purple',
    'blue': 'Blue', 'navy': 'Blue', 'royal blue': 'Blue',
    'green': 'Green', 'olive': 'Green',
    'black': 'Black', 'matte black': 'Black',
    'white': 'White', 'silver': 'Silver', 'grey': 'Grey', 'gray': 'Grey',
    'brown': 'Brown', 'chocolate': 'Brown',
    'pink': 'Pink', 'rose': 'Pink',
    'red': 'Red', 'orange': 'Orange', 'yellow': 'Yellow',
    'diamond': 'Diamond',
  };

  let dialColor = (parsed.dialColor || 'UNKNOWN').trim();
  const dialKey = dialColor.toLowerCase();
  if (DIAL_COLOR_MAP[dialKey]) {
    dialColor = DIAL_COLOR_MAP[dialKey];
  } else if (dialColor !== 'UNKNOWN') {
    // Keep original if not in map, but title-case it
    dialColor = dialColor.charAt(0).toUpperCase() + dialColor.slice(1).toLowerCase();
  }

  const dialConfidence = parsed.dialConfidence || parsed.confidence || 0;
  const brand = parsed.brand || null;
  const referenceVisible = parsed.referenceVisible || 'UNKNOWN';
  const legible = parsed.legible !== false;
  const confidence = parsed.confidence || 0;
  const notes = parsed.notes || '';

  // Determine verification verdict
  let verificationVerdict = 'UNVERIFIED';
  const refAgree = refsAgree(textReference, referenceVisible);
  const brandAgree = brandsAgree(textBrand, brand);

  if (refAgree === true || brandAgree === true) {
    verificationVerdict = 'MATCH';
  } else if (refAgree === false) {
    verificationVerdict = 'MISMATCH';
  } else if (brandAgree === false && !refAgree) {
    verificationVerdict = 'MISMATCH';
  }

  // Build reason string
  const parts = [];
  if (dialColor !== 'UNKNOWN') parts.push(`dial: ${dialColor} (${dialConfidence}%)`);
  if (brand && brand !== 'UNKNOWN') parts.push(`brand: ${brand}`);
  if (referenceVisible && referenceVisible !== 'UNKNOWN') parts.push(`ref: ${referenceVisible}`);
  parts.push(`verify: ${verificationVerdict}`);
  if (!legible) parts.push('image not legible');
  const reason = parts.join(', ') || 'no data extracted';

  return {
    dialColor,
    dialConfidence: typeof dialConfidence === 'number' ? dialConfidence : 0,
    brand: brand && brand !== 'UNKNOWN' ? brand : null,
    referenceVisible,
    verificationVerdict,
    legible,
    confidence: typeof confidence === 'number' ? confidence : 0,
    notes,
    source,
    reason,
    image: {
      brand,
      referenceVisible,
      modelGuess: parsed.modelGuess || 'UNKNOWN',
      dialColor,
      legible,
      confidence,
    },
    verdict: verificationVerdict, // alias for backwards compat
  };
}

// ── Main entry point: try GPT-4o-mini, fall back to Gemini ──────────────────
async function analyzeImage(imageUrl, textReference, textBrand) {
  if (!imageUrl) {
    return {
      dialColor: 'UNKNOWN',
      dialConfidence: 0,
      brand: null,
      referenceVisible: 'UNKNOWN',
      verificationVerdict: 'UNVERIFIED',
      legible: false,
      confidence: 0,
      notes: 'No image URL provided',
      source: 'none',
      reason: 'no image',
      image: {},
      verdict: 'UNVERIFIED',
    };
  }

  // Try GPT-4o-mini first (URL passthrough — no download, no resize, fast)
  try {
    const result = await analyzeWithGPT4o(imageUrl, textReference, textBrand);
    if (result && result.legible) return result;
    if (result && !result.legible) {
      // Image not legible — still return the result (don't retry with Gemini)
      console.log('[vision] GPT-4o-mini says image not legible, skipping Gemini fallback');
      return result;
    }
  } catch (e) {
    console.error('[vision] GPT-4o-mini error:', e.message);
  }

  // Fallback: Gemini 2.5 Flash (download + base64)
  try {
    const result = await analyzeWithGemini(imageUrl, textReference, textBrand);
    if (result) return result;
  } catch (e) {
    console.error('[vision] Gemini error:', e.message);
  }

  // Both failed
  return {
    dialColor: 'UNKNOWN',
    dialConfidence: 0,
    brand: null,
    referenceVisible: 'UNKNOWN',
    verificationVerdict: 'UNVERIFIED',
    legible: false,
    confidence: 0,
    notes: 'All vision providers failed',
    source: 'none',
    reason: 'vision failed',
    image: {},
    verdict: 'UNVERIFIED',
    error: true,
  };
}

module.exports = { analyzeImage, normRef, refsAgree, brandsAgree };
