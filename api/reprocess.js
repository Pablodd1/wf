/**
 * REPROCESS ENDPOINT  —  POST /api/reprocess
 *
 * Re-normalizes HUMAN and RECYCLE records using a 4-stage cascade:
 *
 *   STAGE 1 — REGEX PARSE
 *     Extract brand/ref/price/dial/year/currency from rawMessage.
 *     Handles: HKD k-suffix, USDT, million prices (1.83m), brand-from-ref.
 *
 *   STAGE 2 — CATALOG LOOKUP
 *     Map ref → brand using catalog.json (177 known Patek refs).
 *     Digit-only refs checked against Patek/AP/Rolex patterns.
 *     Boost confidence if ref is recognized.
 *
 *   STAGE 3 — CONFIDENCE GATE
 *     >= 85  → APPROVED  (write directly)
 *     65-84  → HUMAN     (flag for light review)
 *     < 65 + has ref → DEEPSEEK  (structured extraction via API)
 *     < 65 + no ref  → RECYCLE   (stay recycled, no LLM waste)
 *
 *   STAGE 4 — DEEPSEEK BATCH MERGE
 *     Collect up to 20 records per batch, send ONE API call with a JSON array
 *     prompt, parse the array response, merge each result back, re-score, final gate.
 *
 * Supports two modes:
 *   { mode: 'batch', limit: N }   — re-process N HUMAN+RECYCLE records
 *   { mode: 'single', record: {} } — re-process one record (for review UI)
 *
 * Returns: { processed, approved, human, recycled, llmCalls, results[] }
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const { ZERO_HALLUCINATION_NORMALIZATION_CONTRACT } = require('./_lib/ai-normalization-contract.cjs');
const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');
const { consumeAiQuota, rejectForQuota } = require('./_lib/ai-quota.cjs');
const APPROVE_THRESHOLD = 85;
const HUMAN_THRESHOLD = 65;
const BATCH_SIZE = 20; // max records per DeepSeek API call

// ── Currency rates (HKD is the main issue) ──
const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount, currency) {
  if (!amount || !currency) return null;
  const rate = RATES[String(currency).toUpperCase()];
  if (!rate) return null;
  return Math.round(amount * rate);
}

// ── Enhanced price parser: handles k, K, m, M suffixes + decimal ──
function parsePrice(text) {
  const t = text.replace(/,/g, '');

  // Million prices: 1.83m, 1.83M, 1.83 million
  const mMatch = t.match(/\b(\d{1,4}(?:\.\d{1,3})?)\s*(?:m|million)\b/i);
  if (mMatch) return parseFloat(mMatch[1]) * 1_000_000;

  // K prices: 850k, 850K, 850 k, 21.6k
  const kMatch = t.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);

  // Plain numbers >= 4 digits (e.g. 125000)
  const plainMatch = t.match(/\b(\d{4,8})\b/);
  if (plainMatch) return parseInt(plainMatch[1], 10);

  return null;
}

// ── Currency detection ──
function parseCurrency(text) {
  const t = text.toUpperCase();
  if (/\bUSDTO?\b|USDT/.test(t)) return 'USDT';
  if (/\bHKD\b|HK\$/.test(t)) return 'HKD';
  if (/\bEUR\b|€/.test(t)) return 'EUR';
  if (/\bGBP\b|£/.test(t)) return 'GBP';
  if (/\bCHF\b/.test(t)) return 'CHF';
  if (/\bSGD\b/.test(t)) return 'SGD';
  if (/\bCNY\b|\bRMB\b/.test(t)) return 'CNY';
  if (/\bUSD\b|US\$|U\$/.test(t)) return 'USD';
  return null;
}

// ── Brand-from-ref inference (Patek/AP/Rolex patterns) ──
function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');

  // Patek: 4-digit-slash pattern (4xxx/, 5xxx/) or known family starters
  if (/^[45]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^3\d{3}\//.test(r)) return 'Patek Philippe';  // Calatrava etc.
  if (/^[45]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';  // 5270P no slash

  // Audemars Piguet: 5-digit + 2+ letters
  if (/^\d{5}[A-Z]{2,4}$/.test(r)) return 'Audemars Piguet';
  if (/^15\d{3}[A-Z]{2}/.test(r) || /^26\d{3}[A-Z]{2}/.test(r)) return 'Audemars Piguet';

  // Rolex: 6 digits
  if (/^\d{6}[A-Z]{0,4}$/.test(r)) return 'Rolex';

  // Richard Mille: RM prefix
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';

  // Vacheron: 85xxx, 47xxx, 49xxx
  if (/^(85|47|49)\d{3}[A-Z\/]/.test(r)) return 'Vacheron Constantin';

  return null;
}

// ── Dial inference from reference suffix ──
function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  const suffixMap = {
    'LN': 'Black', 'LB': 'Blue', 'LV': 'Green', 'CHNR': 'Brown',
    'OR': 'Pink', 'TI': 'Grey', 'BC': 'Black',
    'ST': 'Blue', 'SA': 'Silver',
  };
  for (const [sfx, color] of Object.entries(suffixMap)) {
    if (r.endsWith(sfx)) return color;
  }
  // Single-letter suffixes (last char) — only when confident
  const lastPart = r.split(/[\/-]/).pop() || '';
  if (lastPart.endsWith('G') && lastPart.length > 2) return 'Blue';    // 5711/1AG
  if (lastPart.endsWith('J') && lastPart.length > 2) return 'Champagne';
  if (lastPart.endsWith('P') && lastPart.length > 2) return 'Platinum/Blue';
  if (lastPart.endsWith('R') && lastPart.length > 2) return 'Brown';
  return null;
}

// ── Brand normalization ──
function normalizeBrand(brand) {
  if (!brand) return null;
  const b = brand.toUpperCase().trim();
  const map = {
    'PATEK PHILIPPE': 'Patek Philippe',
    'PATEK': 'Patek Philippe',
    'PP': 'Patek Philippe',
    'AUDEMARS PIGUET': 'Audemars Piguet',
    'AP': 'Audemars Piguet',
    'AUDEMARS': 'Audemars Piguet',
    'ROLEX': 'Rolex',
    'RICHARD MILLE': 'Richard Mille',
    'RM': 'Richard Mille',
    'VACHERON CONSTANTIN': 'Vacheron Constantin',
    'VC': 'Vacheron Constantin',
    'BREGUET': 'Breguet',
    'OMEGA': 'Omega',
    'CARTIER': 'Cartier',
    'GRAND SEIKO': 'Grand Seiko',
    'SEIKO': 'Seiko',
  };
  return map[b] || brand;
}

// ── Full regex stage 1 parse ──
function stage1Parse(rawMsg) {
  const text = rawMsg || '';
  const lower = text.toLowerCase();

  // Brand (explicit)
  let brand = null;
  if (/\bpp\b|patek\s?philippe|patek/i.test(text)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars\s?piguet|audemars/i.test(text)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s?mille/i.test(text)) brand = 'Richard Mille';
  else if (/rolex/i.test(text)) brand = 'Rolex';
  else if (/vacheron|constantin/i.test(text)) brand = 'Vacheron Constantin';
  else if (/breguet/i.test(text)) brand = 'Breguet';
  else if (/omega/i.test(text)) brand = 'Omega';
  else if (/cartier/i.test(text)) brand = 'Cartier';
  else if (/grand\s?seiko|seiko/i.test(text)) brand = 'Grand Seiko';
  
  brand = normalizeBrand(brand);

  // Reference
  let ref = null;
  const rmM = text.match(/\bRM\s?\d{2,3}(?:[-\s]?\d{2})?[A-Z]*\b/i);
  const ppM = text.match(/\b[45]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const apM = text.match(/\b\d{5}[A-Z]{2,4}\b/i);
  const rolexM = text.match(/\b\d{6}[A-Z]{0,4}\b/i);
  const shortPP = text.match(/\b[345]\d{3}[A-Z]\b/i);  // 5270P, 5303R etc.
  const omegaM = text.match(/\b\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3}\b/);
  const cartierM = text.match(/\bW[A-Z0-9]{7}\b/i);
  const tudorM = text.match(/\b(?:M)?(?:7|2|4|8|9)\d{4}[A-Z]{0,2}(?:-\d{4})?\b/i);
  const tagM = text.match(/\b[A-Z]{3,4}\d{4}[A-Z]?[-.][A-Z0-9]+\b/i);

  if (rmM) ref = rmM[0].toUpperCase().replace(/\s/g, '');
  else if (ppM) ref = ppM[0].toUpperCase();
  else if (shortPP && !brand) { ref = shortPP[0].toUpperCase(); }
  else if (shortPP) ref = shortPP[0].toUpperCase();
  else if (apM) ref = apM[0].toUpperCase();
  else if (rolexM) ref = rolexM[0].toUpperCase();
  else if (omegaM) ref = omegaM[0];
  else if (cartierM) ref = cartierM[0].toUpperCase();
  else if (tudorM) ref = tudorM[0].toUpperCase();
  else if (tagM) ref = tagM[0].toUpperCase();

  // Brand inference from ref if not found explicitly
  if (!brand && ref) {
    brand = inferBrandFromRef(ref);
  }

  // Dial
  let dial = null;
  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|mop|mother\s*of\s*pearl|meteorite|tiffany|panda|hulk|zebra|diamond|rainbow)\b/i);
  if (dialM) dial = dialM[1].charAt(0).toUpperCase() + dialM[1].slice(1).toLowerCase();
  if (!dial && ref) dial = inferDialFromRef(ref);

  // Condition
  let condition = null;
  if (/\bnew\b|unworn|bnib|sealed/i.test(text)) condition = 'New';
  else if (/\bused\b|pre-?owned|worn|vintage|naked/i.test(text)) condition = 'Used';
  else if (/\bmint\b|excellent/i.test(text)) condition = 'Like New';

  // Year: N5/2026 pattern (new production year) or plain 4-digit
  const yearM = text.match(/[Nn]\d\/([\d]{4})/) || text.match(/\b(20[12]\d)\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  // Price — enhanced
  const price = parsePrice(text);
  let currency = parseCurrency(text);

  // Heuristic: if no currency stated and price was k-suffix in a HK dealer channel
  // most WA groups are HKD unless stated. Don't guess — leave null for LLM.

  // Box & papers
  const t = text.toUpperCase();
  const hasFullSet = /FULL\s?SET|BOX\s*&?\s*PAPERS?|CARD/.test(t);
  const hasBox = /\bBOX\b/.test(t) || hasFullSet;
  const hasPapers = /\bPAPERS?\b|\bCARD\b/.test(t) || hasFullSet;

  // Confidence scoring
  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 10;
  if (condition) confidence += 8;
  if (price) confidence += 10;
  if (year) confidence += 4;
  if (currency) confidence += 3;

  return { brand, ref, dial, condition, year, price, currency, hasBox, hasPapers, confidence };
}

// ── Stage 2: catalog lookup — ref → canonical brand ──
async function stage2Catalog(parsed, catalogData) {
  if (!catalogData || !Array.isArray(catalogData)) return parsed;

  const refNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9\/]/g, '');
  const parsedRef = refNorm(parsed.ref);

  for (const entry of catalogData) {
    const catRef = refNorm(entry.reference);
    if (catRef === parsedRef || catRef.startsWith(parsedRef) || parsedRef.startsWith(catRef)) {
      // Hit — boost brand + confidence
      if (!parsed.brand) {
        parsed.brand = normalizeBrand('PATEK PHILIPPE');  // catalog.json is Patek-only
        parsed.confidence += 20;
      }
      if (!parsed.dial && entry.collection) {
        // collection gives family context
        parsed.family = entry.collection;
      }
      parsed.confidence = Math.min(parsed.confidence + 10, 100);
      parsed.catalogHit = true;
      break;
    }
  }
  return parsed;
}

// ── Stage 4: DeepSeek LLM extraction (single record — kept for external use) ──
async function stage4DeepSeek(rawMsg, currentGuess, apiKey) {
  const systemPrompt = `You are a luxury watch expert specializing in grey market dealer messages from WhatsApp groups.
Your job: extract structured watch data from a raw dealer message and return ONLY valid JSON.

Extract these fields:
- brand: "Patek Philippe" | "Audemars Piguet" | "Rolex" | "Richard Mille" | "Vacheron Constantin" | "Breguet" | "Omega" | "Cartier" | "Tudor" | "TAG Heuer" | "Unknown"
- reference: canonical reference number (e.g. "5712/1A-010", "15400ST.OO.1220ST.01", "RM07-01", "126334", "310.30.42.50.01.001", "79030N", "CAZ1010")
- dialColor: "Blue" | "Black" | "Green" | "Brown" | "Grey" | "White" | "Silver" | "Pink" | "Purple" | "Red" | "Orange" | "Yellow" | "Champagne" | "MOP" | "Meteorite" | "Tiffany" | "Panda" | "Zebra" | "Unknown"
- condition: "New" | "Used" | "Like New" | "Unknown"
- year: integer year or null
- price: numeric only (no currency symbol)
- currency: "HKD" | "USD" | "USDT" | "EUR" | "GBP" | "CHF" | "SGD" | "Unknown"
- confidence: 0-100 integer
- image_urls: Array of image HTTP links found in the text

IMPORTANT RULES:
1. Blue-circle emoji (🔵) at start = Patek Philippe listing in this channel
2. N5/2026 or N3/2026 etc = "New, production year 2026/2023 etc" — condition=New, year=that year
3. "k" suffix = thousands. "1.83m" = 1,830,000. "990k" = 990,000
4. No explicit currency? Return null. Never infer currency from dealer context or price magnitude.
5. Reference suffixes indicate material NOT necessarily dial: /1A=steel, /1G=gold, /1R=rose gold, /1P=platinum
6. Return ONLY the JSON object. No markdown, no explanation.

${ZERO_HALLUCINATION_NORMALIZATION_CONTRACT}`;

  const userPrompt = `Regex pre-parse result: ${JSON.stringify(currentGuess)}

Raw message:
"""
${rawMsg}
"""

Return JSON only:`;

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

// ── Stage 4 BATCH: send up to BATCH_SIZE records in ONE DeepSeek API call ──
// batchItems: Array<{ index: number, rawMsg: string, currentGuess: object }>
// Returns: Array of LLM result objects, same length and order as batchItems.
async function stage4DeepSeekBatch(batchItems, apiKey) {
  const n = batchItems.length;

  const systemPrompt = `You are a luxury watch expert specializing in grey market dealer messages from WhatsApp groups.
Your job: extract structured watch data from raw dealer messages and return ONLY a valid JSON object with a single key "results" whose value is an array of exactly ${n} objects — one per watch, in the same order as the input.

Each object must have these fields:
- brand: "Patek Philippe" | "Audemars Piguet" | "Rolex" | "Richard Mille" | "Vacheron Constantin" | "Breguet" | "Omega" | "Cartier" | "Tudor" | "TAG Heuer" | "Unknown"
- reference: canonical reference number (e.g. "5712/1A-010", "15400ST.OO.1220ST.01", "RM07-01", "126334", "310.30.42.50.01.001", "79030N", "CAZ1010")
- dialColor: "Blue" | "Black" | "Green" | "Brown" | "Grey" | "White" | "Silver" | "Pink" | "Purple" | "Red" | "Orange" | "Yellow" | "Champagne" | "MOP" | "Meteorite" | "Tiffany" | "Panda" | "Zebra" | "Unknown"
- condition: "New" | "Used" | "Like New" | "Unknown"
- year: integer year or null
- price: numeric only (no currency symbol)
- currency: "HKD" | "USD" | "USDT" | "EUR" | "GBP" | "CHF" | "SGD" | "Unknown"
- confidence: 0-100 integer
- image_urls: Array of image HTTP links found in the text

IMPORTANT RULES:
1. Blue-circle emoji (🔵) at start = Patek Philippe listing in this channel
2. N5/2026 or N3/2026 etc = "New, production year 2026/2023 etc" — condition=New, year=that year
3. "k" suffix = thousands. "1.83m" = 1,830,000. "990k" = 990,000
4. No explicit currency? Return null. Never infer currency from dealer context or price magnitude.
5. Reference suffixes indicate material NOT necessarily dial: /1A=steel, /1G=gold, /1R=rose gold, /1P=platinum
6. Return ONLY the JSON object { "results": [...] }. No markdown, no explanation.
7. The array MUST have exactly ${n} elements, one per input watch, preserving input order.

${ZERO_HALLUCINATION_NORMALIZATION_CONTRACT}`;

  // Build an array of watch entries for the user prompt
  const watchEntries = batchItems.map((item, i) =>
    `Watch ${i + 1}:\nRegex pre-parse: ${JSON.stringify(item.currentGuess)}\nRaw message:\n"""\n${item.rawMsg}\n"""`
  ).join('\n\n');

  const userPrompt = `Parse these ${n} watch listings and return a JSON object { "results": [ ...${n} objects... ] }, one object per watch in order.\n\n${watchEntries}\n\nReturn JSON only:`;

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // Scale max_tokens with batch size; 350 per watch is generous
      max_tokens: Math.min(n * 350, 8000),
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  // Normalise: accept { results: [...] } or a bare array
  const arr = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed.results) ? parsed.results : []);

  // Pad / trim to exactly n entries so indices always align
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[i] || {});
  }
  return out;
}

// ── Merge LLM result into parsed ──
function mergeLLM(parsed, llm) {
  const out = { ...parsed };
  if (!out.brand && llm.brand && llm.brand !== 'Unknown') out.brand = normalizeBrand(llm.brand);
  if (!out.ref && llm.reference) out.ref = llm.reference;
  if (!out.dial && llm.dialColor && llm.dialColor !== 'Unknown') out.dial = llm.dialColor;
  if (!out.condition && llm.condition && llm.condition !== 'Unknown') out.condition = llm.condition;
  if (!out.year && llm.year) out.year = llm.year;
  // LLM confidence boost
  const llmConf = parseInt(llm.confidence) || 0;
  out.confidence = Math.max(out.confidence, llmConf);
  out.source = 'llm';
  return out;
}

// ── Final verdict gate ──
function verdictGate(parsed) {
  const hasRef = !!(parsed.ref && parsed.ref.length > 2);
  const hasBrand = !!(parsed.brand && parsed.brand !== 'Unknown');
  const hasPrice = !!(parsed.price && parsed.price > 0);
  const conf = parsed.confidence || 0;

  // AI-assisted identity/configuration remains a suggestion until confirmed.
  if (parsed.source === 'llm') return (hasRef || hasBrand) ? 'HUMAN' : 'RECYCLE';

  // Hard recycle: no ref and no brand
  if (!hasRef && !hasBrand) return 'RECYCLE';
  // Hard recycle: confidence too low
  if (conf < 35) return 'RECYCLE';

  // APPROVED: 85+ with ref + brand + price
  if (conf >= APPROVE_THRESHOLD && hasRef && hasBrand && hasPrice) return 'APPROVED';
  // HUMAN: 65-84 with ref or brand
  if (conf >= HUMAN_THRESHOLD && (hasRef || hasBrand)) return 'HUMAN';
  // HUMAN: has ref or brand but low confidence
  if (hasRef || hasBrand) return 'HUMAN';
  return 'RECYCLE';
}

// ── Convert priceUSD ──
function computePriceUSD(parsed) {
  if (!parsed.price || !parsed.currency) return null;
  return toUSD(parsed.price, parsed.currency);
}

// ── Main handler ──
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!await authorizeMutation(req, res, new Set(['reviewer', 'admin']))) return;

  const { mode = 'batch', records, limit = 500, offset = 0 } = req.body || {};

  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: '`records` array required. Pass HUMAN+RECYCLE rows from parsedWatches.json.' });
  }
  if (records.length > 500) return res.status(413).json({ error: 'Maximum 500 records per request' });

  const quota = await consumeAiQuota(req, { route: 'reprocess', limit: 5, windowSeconds: 60 });
  if (!quota.allowed) return rejectForQuota(res, quota);

  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  // Load catalog for stage 2
  let catalogData = [];
  try {
    const fs = await import('fs');
    const path = await import('path');
    const catPath = path.resolve(process.cwd(), 'public', 'catalog.json');
    catalogData = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  } catch { /* catalog optional */ }

  const batch = records.slice(offset, offset + limit);

  // ── Stage 1 + 2: regex parse + catalog lookup for every row ──
  // We build a parallel structure to track which rows need LLM.
  const parsedRows = []; // { id, raw, parsed, rowIndex }
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    // row is array: [id, brand, ref, dial, priceRetail, priceListed, condition, currency, rawMsg, confidence, status, flags, year]
    const [id, existingBrand, existingRef, existingDial, priceRetail, priceListed, existingCondition, existingCurrency, rawMsg, existingConfidence, existingStatus, existingFlags, existingYear] = row;
    const raw = String(rawMsg || '');

    // Stage 1
    let parsed = stage1Parse(raw);

    // Stage 2
    parsed = await stage2Catalog(parsed, catalogData);

    parsedRows.push({ id, raw, parsed });
  }

  // ── Stage 3 + 4: collect LLM-eligible rows, send in batches of BATCH_SIZE ──
  // Mark which parsedRows need LLM
  const llmQueue = []; // indices into parsedRows
  if (deepseekKey) {
    for (let i = 0; i < parsedRows.length; i++) {
      const { parsed } = parsedRows[i];
      // LLM for: low confidence with ref, OR any HUMAN/RECYCLE status with raw message
      if (parsed.confidence < HUMAN_THRESHOLD && parsed.ref) {
        llmQueue.push(i);
      } else if (parsed.confidence < HUMAN_THRESHOLD && !parsed.ref) {
        // No ref but has brand — try LLM to find ref
        llmQueue.push(i);
      }
    }
  }

  let llmCalls = 0;

  // Process LLM queue in chunks of BATCH_SIZE
  for (let start = 0; start < llmQueue.length; start += BATCH_SIZE) {
    const chunkIndices = llmQueue.slice(start, start + BATCH_SIZE);

    const batchItems = chunkIndices.map((idx) => {
      const { raw, parsed } = parsedRows[idx];
      return {
        index: idx,
        rawMsg: raw,
        currentGuess: {
          brand: parsed.brand,
          ref: parsed.ref,
          price: parsed.price,
          currency: parsed.currency,
        },
      };
    });

    try {
      const llmResults = await stage4DeepSeekBatch(batchItems, deepseekKey);
      llmCalls++; // one API call per batch chunk

      for (let j = 0; j < chunkIndices.length; j++) {
        const idx = chunkIndices[j];
        const llmResult = llmResults[j];
        if (llmResult && Object.keys(llmResult).length > 0) {
          parsedRows[idx].parsed = mergeLLM(parsedRows[idx].parsed, llmResult);
          parsedRows[idx].usedLLM = true;
        }
      }
    } catch (err) {
      // Batch LLM failed — mark all rows in chunk with error, keep regex result
      for (const idx of chunkIndices) {
        parsedRows[idx].parsed.llmError = err.message;
      }
    }
  }

  // ── Verdict + output ──
  const results = [];
  let approved = 0, human = 0, recycled = 0;

  for (const { id, parsed, usedLLM } of parsedRows) {
    const verdict = verdictGate(parsed);
    const priceUSD = computePriceUSD(parsed);

    if (verdict === 'APPROVED') approved++;
    else if (verdict === 'HUMAN') human++;
    else recycled++;

    results.push({
      id,
      verdict,
      brand: normalizeBrand(parsed.brand) || 'Unknown',
      reference: parsed.ref || '',
      dialColor: parsed.dial || 'Unknown',
      condition: parsed.condition || 'Unknown',
      year: parsed.year || null,
      price: parsed.price || null,
      priceUSD,
      currency: parsed.currency || 'Unknown',
      confidence: parsed.confidence,
      source: usedLLM ? 'llm' : (parsed.catalogHit ? 'catalog' : 'regex'),
      flags: [],
    });
  }

  return res.status(200).json({
    processed: results.length,
    approved,
    human,
    recycled,
    llmCalls,
    offset,
    limit,
    total: records.length,
    hasMore: offset + limit < records.length,
    results,
  });
}
