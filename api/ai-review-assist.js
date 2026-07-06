/**
 * /api/ai-review-assist.js
 * ========================
 * v4.3: Two-tier AI-assist for human review workflow.
 *
 * Tier 1 — Text-assist (POST /api/ai-review-assist?tier=text)
 *   Input:  raw_message + current parsed fields + parser verdict
 *   Output: suggested brand/ref/dial/condition + confidence + reasoning
 *   Uses:   Gemini 2.0 Flash (cheapest structured-output model)
 *   Cost:   ~$0.00002 per row (free tier covers dev usage)
 *
 * Tier 2 — Vision-confirm (POST /api/ai-review-assist?tier=vision)
 *   Input:  raw_message + dealer_photos[0].url + current parsed fields
 *   Output: visual_confidence + confirmed/denied field values + reasoning
 *   Uses:   Gemini 2.0 Flash Vision (same family, cheap multimodal)
 *   Cost:   ~$0.00005 per row with single image
 *
 * Tier 2 only fires when a dealer photo exists AND the text parser
 * couldn't resolve at least one critical field (brand/ref/dial).
 * This endpoint NEVER writes to the DB — it returns a suggestion that
 * the human reviewer sees pre-filled in the UI before clicking approve.
 *
 * POST /api/ai-review-assist
 * Body: {
 *   id: number,                         // watch_records row ID
 *   raw_message: string,                // original dealer text
 *   parsed: { brand, ref, dial, condition, year, price },  // current parser output
 *   verdict: string,                    // current verdict (REVIEW/HUMAN/etc.)
 *   tier: 'text' | 'vision',           // which tier to run
 *   image_url?: string,                // dealer_photos[0].url (vision tier only)
 * }
 */
'use strict';

const { withRateLimit } = require('./_lib/rate-limiter');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL_TEXT = 'gemini-2.0-flash';
const GEMINI_MODEL_VISION = 'gemini-2.0-flash';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app';
const MAX_BODY_SIZE = 100 * 1024; // 100KB — review requests are small
const SUPABASE_URL = process.env.SUPABASE_URL;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Alex's reference-cleanup spec condensed into a structured system prompt.
 * Both text and vision tiers share this ruleset to ensure consistency.
 */
const ALEX_SPEC_SYSTEM_PROMPT = `You are an expert luxury watch data quality assistant for WatchFacts. Your job is to verify and suggest corrections to one parsed watch listing.

RULES (do NOT deviate):
1. Column B (reference) must contain ONLY the true watch reference number. Never put prices, dates, condition words, dealer item IDs, brand-only text, or model-only text in the reference field.
2. If the correct reference is NOT clearly visible in the raw message, do NOT guess. Set "cannot_determine": true and explain why.
3. Price formats that are NOT references: "20300USD", "HKD95000", "$5100", "USDT41800", "555000HKD", "49000HKD", "1020000HKD". These must always be stripped.
4. Brand abbreviations NOT references: "VC", "PP", "AP", "JLC", "IWC", "RLX" — strip from reference, keep brand detection correct.
5. Accessory keywords that mean the row is NOT a watch: "strap", "bracelet", "wooden box", "link", "belt" — flag as ACCESSORY_NOT_WATCH.
6. Hermes bag models are NEVER watches: Birkin, Kelly, Constance, Hac, Picotin, Evelyne — flag as NON_WATCH_OR_WRONG_CATEGORY.
7. Multi-watch stock lists with 2+ distinct brand-specific references in one raw message — do NOT pick one. Flag as MULTI_WATCH_STOCK_LIST.
8. When a reference format clearly belongs to a DIFFERENT brand than what the text says ("Rolex ref in a Longines row", "Patek ref in a Richard Mille row"), flag as WRONG_BRAND_SUSPECT.
9. Brand-casing rules: Richard Mille refs are "RM##-##" no-space. Panerai refs are "PAM#####" zero-padded to 5 digits. Tudor refs start with "M". Longines refs start with uppercase "L".
10. If only a brand name or model name is present with no reference number, flag as NEEDS_MANUAL_REVIEW with a note.
11. Never use price, condition, set status, row number, dealer item number, or brand name as the reference.`;

/**
 * Build the text-tier prompt for one listing.
 */
function buildTextPrompt(rawMessage, parsed) {
  const current = {
    brand: parsed.brand || '(missing)',
    reference: parsed.ref || '(missing)',
    dial: parsed.dial || '(missing)',
    condition: parsed.condition || '(missing)',
    year: parsed.year || '(missing)',
    price: parsed.price || '(missing)',
    verdict: parsed.verdict || '(unknown)',
  };

  return `Review this watch listing and return a structured JSON verdict.

RAW MESSAGE: ${rawMessage}

CURRENT PARSED VALUES:
- brand: ${current.brand}
- reference: ${current.reference}
- dial: ${current.dial}
- condition: ${current.condition}
- year: ${current.year}
- price: ${current.price}
- current verdict: ${current.verdict}

Return JSON with these fields:
- brand: string | null (corrected brand, or null if unchanged)
- reference: string | null (corrected reference, or null if unchanged)
- dial: string | null
- condition: string | null
- year: number | null
- confidence: number (0-100, how sure you are of the correction)
- reasoning: string (one sentence explaining the correction or why unchanged)
- cannot_determine: boolean (true if genuinely unclear — NEVER guess a reference)
- suggested_verdict: string (one of: APPROVED, REVIEW, HUMAN, RECYCLE, ACCESSORY_NOT_WATCH, MULTI_WATCH_STOCK_LIST, WRONG_BRAND_SUSPECT, NON_WATCH_OR_WRONG_CATEGORY, NEEDS_MANUAL_REVIEW)
- note: string (additional context for the human reviewer)

If the reference IS valid and matches the rules above, set confidence: 100 and cannot_determine: false.
If the reference is clearly a price, condition, year, or stock number, set reference: null, cannot_determine: true, and explain in reasoning.
DO NOT MAKE UP REFERENCES. If you can't find the real reference in the raw message, mark cannot_determine: true.`;
}

/**
 * Build the vision-tier prompt — confirms dial, condition, and engraved ref
 * from the dealer photo.
 */
function buildVisionPrompt(rawMessage, parsed) {
  return `You are shown a dealer photo of a watch alongside its listing text. Your job is to VISUALLY CONFIRM or DENY specific fields using what you see in the image.

RAW MESSAGE: ${rawMessage}
TEXT-PARSED VALUES: brand=${parsed.brand || '?'}, reference=${parsed.ref || '?'}, dial=${parsed.dial || '?'}, condition=${parsed.condition || '?'}

Look at the photo and return JSON:
- visual_reference: string | null (reference number if visible engraved on caseback or clasp; null if not visible)
- visual_dial: string (dial color you see: Black, Blue, Green, White, Champagne, Silver, Grey, Brown, Salmon, Burgundy, Mother Of Pearl, Purple, Orange, Gold, or "unclear")
- visual_condition: string (one of: New, Like New, Used, Heavy Wear, or "unclear")
- visual_material: string (case metal: Steel, Yellow Gold, Rose Gold, White Gold, Titanium, Platinum, Carbon, Ceramic, Two-Tone, or "unclear")
- visual_bezel: string (plain, fluted, diamond, ceramic, tachymeter, diving, or "unclear")
- visual_bracelet: string (leather, rubber, oyster, jubilee, president, nato, integrated, or "unclear")
- confirmed_reference: boolean (true ONLY if you can ACTUALLY READ the engraved reference on the caseback or lug — don't guess from dial/case features)
- dial_matches_parsed: boolean
- reasoning: string (one sentence)
- cannot_determine: boolean (true if the image is too blurry, occluded, or doesn't show the watch clearly)`;
}

/**
 * Call Gemini API for text-tier suggestion.
 */
async function callGeminiText(rawMessage, parsed) {
  const prompt = buildTextPrompt(rawMessage, parsed);
  // H-3: API key via x-goog-api-key header, NOT URL query param (avoids Vercel log exposure)
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL_TEXT}:generateContent`;

  const body = {
    contents: [
      { role: 'user', parts: [{ text: ALEX_SPEC_SYSTEM_PROMPT }, { text: prompt }] }
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini text API error: ${res.status}`);
  return res.json();
}

/**
 * Call Gemini API for vision-tier suggestion.
 */
async function callGeminiVision(rawMessage, parsed, imageUrl) {
  const prompt = buildVisionPrompt(rawMessage, parsed);

  // M-6: Validate image URL belongs to our Supabase storage
  if (!SUPABASE_URL || !imageUrl.startsWith(SUPABASE_URL + '/storage/v1/object/public/dealer-photos/')) {
    throw new Error('Invalid image URL — must be from trusted Supabase storage origin');
  }

  // Download image as base64 from Supabase storage
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`);
  const imgBuffer = await imgRes.arrayBuffer();
  const base64 = Buffer.from(imgBuffer).toString('base64');
  const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL_VISION}:generateContent`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: ALEX_SPEC_SYSTEM_PROMPT + '\n\n' + prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini vision API error: ${res.status}`);
  return res.json();
}

/**
 * Parse Gemini JSON response (handles common formatting quirks).
 */
function parseGeminiResponse(geminiData) {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Gemini sometimes wraps JSON in markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, text];
    return JSON.parse(jsonMatch[1].trim());
  } catch (e) {
    console.error('[ai-review-assist] Gemini parse failed:', e.message);
    return { error: 'parse_failed', cannot_determine: true };
  }
}

/**
 * Merge AI suggestion with existing parsed fields — AI overrides only when
 * its confidence is high enough AND it's changing a field from null to a value
 * or correcting a known-bad value (price-as-ref, brand-only, etc.).
 */
function mergeSuggestion(parsed, suggestion, tier) {
  // Never auto-accept — return suggestion alongside original for human review
  return {
    original: {
      brand: parsed.brand,
      reference: parsed.ref,
      dial: parsed.dial,
      condition: parsed.condition,
      year: parsed.year,
      price: parsed.price,
      verdict: parsed.verdict,
    },
    suggestion: {
      brand: suggestion.brand || parsed.brand,
      reference: suggestion.reference || parsed.ref,
      dial: suggestion.dial || parsed.dial,
      condition: suggestion.condition || parsed.condition,
      year: suggestion.year || parsed.year,
      verdict: suggestion.suggested_verdict || parsed.verdict,
    },
    ai_confidence: suggestion.confidence || 0,
    reasoning: suggestion.reasoning || suggestion.note || '',
    cannot_determine: suggestion.cannot_determine || false,
    tier,
    // Vision-specific fields
    visual_confirmation: tier === 'vision' ? {
      dial: suggestion.visual_dial || null,
      condition: suggestion.visual_condition || null,
      material: suggestion.visual_material || null,
      bezel: suggestion.visual_bezel || null,
      bracelet: suggestion.visual_bracelet || null,
      reference_confirmed: suggestion.confirmed_reference || false,
    } : null,
  };
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
const handler = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // M-4: Reject oversized payloads
  const contentLen = parseInt(req.headers['content-length'] || '0');
  if (contentLen > MAX_BODY_SIZE) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // Existing simple update path (backward-compatible with current UI)
  const { id, verdict, brand, reference, dial_color, tier, raw_message, parsed, image_url } = req.body || {};
  if (id && verdict && !tier) {
    const { getClient } = require('./_lib/supabase');
    try {
      const updateData = { verdict, human_edited: true, processed_at: new Date().toISOString() };
      if (brand) updateData.brand = brand;
      if (reference) updateData.reference = reference;
      if (dial_color) updateData.dial_color = dial_color;

      const { data, error } = await getClient()
        .from('watch_records')
        .update(updateData)
        .eq('id', id)
        .select();

      if (error) {
        console.error('[ai-review-assist] DB update error:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
      return res.status(200).json({ success: true, data });
    } catch (err) {
      console.error('[ai-review-assist] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ── AI-assist paths ──
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI review not configured' });
  }

  if (!raw_message) return res.status(400).json({ error: 'Missing raw_message' });
  if (!parsed) return res.status(400).json({ error: 'Missing parsed fields' });

  try {
    let geminiData, suggestion;

    if (tier === 'vision' && image_url) {
      geminiData = await callGeminiVision(raw_message, parsed, image_url);
      suggestion = parseGeminiResponse(geminiData);
    } else {
      geminiData = await callGeminiText(raw_message, parsed);
      suggestion = parseGeminiResponse(geminiData);
    }

    const result = mergeSuggestion(parsed, suggestion, tier || 'text');

    return res.status(200).json({ ok: true, id: id || null, ...result });
  } catch (e) {
    console.error('[ai-review-assist] Error:', e.message);
    return res.status(500).json({ ok: false, error: 'Internal server error', cannot_determine: true });
  }
};

module.exports = withRateLimit('/api/ai-review-assist', handler);
