/**
 * LIVE INGEST ENDPOINT  —  POST /api/ingest
 * JASS-5 Control System & Normalization Engine
 *
 * Receives raw WhatsApp/Telegram dealer messages, splits listing candidates,
 * normalizes attributes using dynamic dictionaries, converts prices to USD,
 * validates configurations against the master catalog, scores confidence,
 * and routes to Supabase tables.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  extractPriceObservations,
  segmentDealerMessage,
} = require('./_lib/normalization-v4.cjs');
const { parseTradingSearch } = require('./_lib/trading-search.cjs');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');

function normalizeListingTypeParam(value) {
  const text = String(value || '').trim().toUpperCase();
  if (['SALE', 'SELL', 'SELLER', 'FS'].includes(text)) return 'WTS';
  if (['BUY', 'BUYER', 'LOOKING'].includes(text)) return 'WTB';
  return text;
}

// ============================================================
// Load Dictionaries (With Safe Fallbacks)
// ============================================================
const DICT_DIR = path.join(__dirname, 'dictionaries');

function loadJsonSafe(filename, defaultVal) {
  try {
    const filePath = path.join(DICT_DIR, filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.warn(`[JASS-5 Ingest] Warn loading ${filename}: ${e.message}`);
  }
  return defaultVal;
}

const BRANDS = loadJsonSafe('brands.json', { brands: {} }).brands;
const DIALS = loadJsonSafe('dials.json', { dial_colors: {}, dial_types: {} });
const CONDITIONS = loadJsonSafe('conditions.json', { conditions: {}, set_status: {} });
const CURRENCIES = loadJsonSafe('currencies.json', { currencies: {}, price_multipliers: {} });
const MATERIALS = loadJsonSafe('materials.json', { materials: {}, bracelets: {}, bezels: {} });
const MASTER_CATALOG = loadJsonSafe('master_catalog.json', {});

// Standard USD exchange rates
const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.25, CHF: 1.10, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0065, CNY: 0.138, RMB: 0.138,
};

// Legacy Slang and suffix maps from JASS v4.0 (fully integrated)
const SLANG_TO_COLLECTION = {
  'hulk': 'Submariner Date', 'kermit': 'Submariner Date', 'starbucks': 'Submariner Date',
  'smurf': 'Submariner Date', 'batman': 'GMT Master II', 'batgirl': 'GMT Master II',
  'pepsi': 'GMT Master II', 'rootbeer': 'GMT Master II', 'coke': 'GMT Master II',
  'sprite': 'GMT Master II', 'bruce wayne': 'GMT Master II',
  'polar': 'Explorer II', 'ghost': 'Daytona', 'panda': 'Daytona',
  'reverse panda': 'Daytona', 'zebra': 'Daytona', 'land dweller': 'Sky-Dweller',
  'tiffany': 'Oyster Perpetual', 'wimbledon': 'Datejust', 'daytona': 'Daytona',
  'submariner': 'Submariner', 'sea-dweller': 'Sea-Dweller', 'deepsea': 'Deepsea',
  'explorer': 'Explorer', 'gmt': 'GMT Master II', 'datejust': 'Datejust',
  'nautilus': 'Nautilus', 'aquanaut': 'Aquanaut', 'overseas': 'Overseas',
  'royal oak': 'Royal Oak', 'royal oak offshore': 'Royal Oak Offshore',
  'day-date': 'Day-Date', 'president': 'Day-Date',
};

const ROLEX_SUFFIX_MAP = {
  LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown', OR: 'Pink',
  TI: 'Grey', BC: 'Black', ST: 'Blue', GRNR: 'Black', BLNR: 'Blue',
  BLRO: 'Red Blue', VTNR: 'Green Black', RBR: 'Diamond',
};

// ============================================================
// State Machine Helper Methods
// ============================================================

function assertField(fieldName, rawValue, normalizedValue, confidence, method) {
  return {
    field_name: fieldName,
    raw_value: rawValue,
    normalized_value: normalizedValue,
    confidence,
    source_method: method,
    catalog_confirmed: false,
    human_confirmed: false,
  };
}

function extractFromDictionary(text, dictMap, fieldName) {
  const lower = text.toLowerCase();
  for (const [key, value] of Object.entries(dictMap)) {
    const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) {
      return assertField(fieldName, key, value, 90, 'abbreviation_dictionary');
    }
  }
  return assertField(fieldName, null, null, 0, 'not_found');
}

// Brand mapping from reference
const REFERENCE_BRAND_MAP = [
  { pattern: /^(?:15|26|77|67)[0-9]{3}[A-Z]{2}\./, brand: 'Audemars Piguet', confidence: 82 },
  { pattern: /^(?:15|26|77|67)[0-9]{3}[A-Z]{2}/, brand: 'Audemars Piguet', confidence: 80 },
  { pattern: /^[1-3][0-9]{4,5}[A-Z]{0,4}$/, brand: 'Rolex', confidence: 72 },
  { pattern: /^[458][0-9]{3}[Vv]\//, brand: 'Vacheron Constantin', confidence: 85 },
  { pattern: /^[34567][0-9]{3}(?:\/[0-9]{1,3}[A-Z]{1,2})?/, brand: 'Patek Philippe', confidence: 75 },
  { pattern: /^[0-9]{3}\.[0-9]{3}$/, brand: 'A. Lange & Söhne', confidence: 90 },
  { pattern: /^RM\s*0*\d{2,3}/i, brand: 'Richard Mille', confidence: 85 },
  { pattern: /^PAM\s*0*\d{3,5}/i, brand: 'Panerai', confidence: 95 },
];

function extractBrand(text, ref, context) {
  const lower = text.toLowerCase();
  
  if (context.brand_context) {
    return assertField('brand', context.brand_context, context.brand_context, 65, 'context_inherited');
  }

  for (const [key, value] of Object.entries(BRANDS)) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(lower)) {
      return assertField('brand', key, value, 88, 'abbreviation_dictionary');
    }
  }

  if (ref) {
    const mapped = REFERENCE_BRAND_MAP.find(m => m.pattern.test(ref));
    if (mapped) return assertField('brand', mapped.brand, mapped.brand, mapped.confidence, 'reference_inference');
    
    const catalogEntries = MASTER_CATALOG[ref] || MASTER_CATALOG[ref.replace(/-/g, '')];
    if (catalogEntries && catalogEntries.length > 0) {
      return assertField('brand', catalogEntries[0].brand, catalogEntries[0].brand, 90, 'catalog_reverse_lookup');
    }
  }
  return assertField('brand', null, null, 0, 'not_found');
}

function extractReference(text) {
  const patterns = [
    { pattern: /\b(\d{3}\.[A-Z0-9]{2,4}\.\d{4}\.[A-Z0-9.]{2,15})\b/i, confidence: 95 },
    { pattern: /\b((?:15|26|77|67)[0-9]{3}[A-Z]{2}\.[A-Z]{2}\.\d{4}[A-Z]{2}\.\d{2})\b/i, confidence: 95 },
    { pattern: /\b((?:15|26|77|67)[0-9]{3}[A-Z]{2}(?:\.OO\.[A-Z0-9.]+)?)\b/i, confidence: 92 },
    { pattern: /\b([458][0-9]{3}[Vv]\/[0-9A-Za-z-]{1,10})\b/i, confidence: 92 },
    { pattern: /\b([1-3][0-9]{4,5}[A-Z]{0,4})\b/, confidence: 90 },
    { pattern: /\b([34567][0-9]{3}[A-Z]{0,2}(?:\/[0-9]{1,3}[A-Z]{1,2})?(?:-[0-9]{3})?)\b/i, confidence: 88 },
    { pattern: /\b(RM\s*0*([0-9]{2,3})(?:[-\s][A-Z0-9]+)?)\b/i, confidence: 85 },
    { pattern: /\b([A-Z]{1,2}[0-9]{5,6}[A-Z0-9]{4,10})\b/i, confidence: 95 },
    { pattern: /\b(PAM\s*0*\d{3,5})\b/i, confidence: 90 },
    { pattern: /\b([0-9]{3}\.[0-9]{3})\b/i, confidence: 90 },
    { pattern: /(?<!(?:used|new|unused|mint|like new)[\s\t]*)\b([A-Z]?[0-9]{4,6}[A-Z]{0,4})\b/i, confidence: 70 },
  ];

  const textWithoutPrices = text.replace(/[0-9.,]+[kKmMwW万]?\s*(?:hkd|usd|rmb|chf|gbp|eur|jpy)/gi, '')
                                .replace(/(?:hkd|usd|rmb|chf|gbp|eur|jpy)\s*[0-9.,]+[kKmMwW万]/gi, '');

  for (const { pattern, confidence } of patterns) {
    const match = textWithoutPrices.match(pattern);
    if (match) return assertField('reference', match[0], match[1].toUpperCase(), confidence, 'regex_extract');
  }
  return assertField('reference', null, null, 0, 'not_found');
}

function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  for (const [sfx, color] of Object.entries(ROLEX_SUFFIX_MAP)) {
    if (r.endsWith(sfx)) return color;
  }
  const last = r.split(/[\/\-]/).pop() || '';
  if (last.endsWith('G') && last.length > 2) return 'Blue';
  if (last.endsWith('J') && last.length > 2) return 'Champagne';
  if (last.endsWith('P') && last.length > 2) return 'Blue';
  if (last.endsWith('R') && last.length > 2) return 'Brown';
  return null;
}

function extractDial(text, ref) {
  const dictDial = extractFromDictionary(text, DIALS.dial_colors || {}, 'dial');
  if (dictDial.normalized_value) return dictDial;
  
  if (ref) {
    const inferred = inferDialFromRef(ref);
    if (inferred) return assertField('dial', ref, inferred, 80, 'reference_suffix_inference');
  }
  return dictDial;
}

function extractModel(text, ref) {
  const lower = text.toLowerCase();
  for (const [slang, collection] of Object.entries(SLANG_TO_COLLECTION)) {
    if (new RegExp(`\\b${slang}\\b`, 'i').test(lower)) {
      return assertField('model', slang, collection, 90, 'slang_dictionary');
    }
  }
  if (ref) {
    const catalogEntries = MASTER_CATALOG[ref] || MASTER_CATALOG[ref.replace(/-/g, '')];
    if (catalogEntries && catalogEntries.length > 0) {
      return assertField('model', catalogEntries[0].model, catalogEntries[0].model, 95, 'catalog_lookup');
    }
  }
  return assertField('model', null, null, 0, 'not_found');
}

function extractCondition(text, context) {
  let ctxCond = null;
  if (context.condition_context) {
    ctxCond = assertField('condition', context.condition_context, context.condition_context, 65, 'context_inherited');
  }
  const dictCond = extractFromDictionary(text, CONDITIONS.conditions || {}, 'condition');
  return dictCond.normalized_value ? dictCond : (ctxCond || dictCond);
}

function extractCardDate(text) {
  const cardPattern = /\bN\s*(\d{1,2})\s*\/\s*(\d{2,4})\b/i;
  const match = text.match(cardPattern);
  if (match) {
    const month = parseInt(match[1]);
    const yearRaw = parseInt(match[2]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return {
      card_month: assertField('card_month', match[1], month, 92, 'regex_extract'),
      card_year: assertField('card_year', match[2], year, 92, 'regex_extract'),
    };
  }
  const yearOnlyPattern = /(?:\/|year\s*)(\d{2,4})/i;
  const yearMatch = text.match(yearOnlyPattern);
  if (yearMatch) {
    const yearRaw = parseInt(yearMatch[1]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return {
      card_month: assertField('card_month', null, null, 0, 'not_found'),
      card_year: assertField('card_year', yearMatch[1], year, 75, 'regex_extract'),
    };
  }
  return {
    card_month: assertField('card_month', null, null, 0, 'not_found'),
    card_year: assertField('card_year', null, null, 0, 'not_found'),
  };
}

// Price and USD conversion
function extractPrices(text) {
  const prices = [];
  const currencyMap = CURRENCIES.currencies || {};
  const multipliers = CURRENCIES.price_multipliers || {};

  const currencyTokens = Object.keys(currencyMap)
    .filter(k => k.length >= 2)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|');

  const pricePattern = new RegExp(
    `(?:` +
    `(${currencyTokens})[\\s\\u00A0]*\\b([\\d,]+(?:\\.\\d+)?)[\\s\\u00A0]*(k|m|mn|mil|万|w)?` +
    `|` +
    `\\b(?!(?:19|20)\\d{2}\\b)([\\d,]+(?:\\.\\d+)?)[\\s\\u00A0]*(k|m|mn|mil|万|w)?[\\s\\u00A0]*(${currencyTokens})` +
    `)`,
    'gi'
  );

  let match;
  while ((match = pricePattern.exec(text)) !== null) {
    let rawCurrencyToken, amountStr, multiplierStr;

    if (match[1]) {
      rawCurrencyToken = match[1]; amountStr = match[2]; multiplierStr = match[3];
    } else {
      amountStr = match[4]; multiplierStr = match[5]; rawCurrencyToken = match[6];
    }

    const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
    if (isNaN(rawAmount) || rawAmount <= 0) continue;

    const multiplier = multiplierStr ? (multipliers[multiplierStr.toLowerCase()] || 1) : 1;
    const amount = rawAmount * multiplier;

    if (!multiplierStr && amount < 5000) continue;

    const normalizedCurrency = currencyMap[rawCurrencyToken.toLowerCase()] || rawCurrencyToken.toUpperCase();
    const usdRate = RATES[normalizedCurrency] || 1.0;
    const amountUsd = Math.round(amount * usdRate);

    prices.push({
      price_type: prices.length === 0 ? 'ASK_PRICE' : 'ALT_CURRENCY_PRICE',
      amount_original: amount,
      currency_original: normalizedCurrency,
      amount_usd: amountUsd,
      is_primary: prices.length === 0,
      raw_price_text: match[0].trim(),
      confidence: 85,
    });
  }

  // Validate exchange rates between price pairs
  if (prices.length === 2) {
    const rate = prices[1].amount_original / prices[0].amount_original;
    const isReasonable =
      (prices[0].currency_original === 'USDT' && prices[1].currency_original === 'HKD' && rate > 5 && rate < 12) ||
      (prices[0].currency_original === 'HKD' && prices[1].currency_original === 'USDT' && rate > 0.08 && rate < 0.2);

    for (const p of prices) {
      p.implied_exchange_rate = rate;
      p.exchange_validation = isReasonable ? 'ALT_CURRENCY_CONSISTENT' : 'EXCHANGE_RATE_CONFLICT';
    }
  }

  return prices;
}

// Context headers parser
function parseContext(text) {
  const context = { brand_context: null, condition_context: null };
  if (/\bROLEX\b/i.test(text)) context.brand_context = 'Rolex';
  if (/\bPATEK\b/i.test(text) || /\bPP\b/.test(text)) context.brand_context = 'Patek Philippe';
  if (/\bAP\b/.test(text) || /\bAUDEMARS\b/i.test(text)) context.brand_context = 'Audemars Piguet';
  if (/\bRM\b/.test(text) || /\bRICHARD MILLE\b/i.test(text)) context.brand_context = 'Richard Mille';
  if (/\bVC\b/.test(text) || /\bVACHERON\b/i.test(text)) context.brand_context = 'Vacheron Constantin';
  
  if (/\bNEW\b/i.test(text)) context.condition_context = 'New';
  if (/\bUSED\b/i.test(text)) context.condition_context = 'Used';
  return context;
}

// Score JASS-5 Confidence
function scoreConfidence(bundle, assertions) {
  const identityFields = ['brand', 'reference', 'model', 'dial', 'material', 'condition'];
  const foundIdentity = identityFields.filter(f => assertions[f]?.normalized_value).length;
  let identityConf = (foundIdentity / identityFields.length) * 100;

  let catalogConf = 0;
  if (bundle.brand && bundle.reference) {
    const catalogEntries = MASTER_CATALOG[bundle.reference] || MASTER_CATALOG[bundle.reference.replace(/-/g, '')];
    if (catalogEntries && catalogEntries.length > 0) {
      const brandMatch = catalogEntries.some(entry => entry.brand.toLowerCase().includes(bundle.brand.toLowerCase()));
      if (brandMatch) {
        let exactVariantMatched = false;
        let conflictDetected = false;

        if (bundle.dial || bundle.material) {
          let anyVariantMatch = false;
          for (const entry of catalogEntries) {
            const dialMatch = !bundle.dial || !entry.dial || entry.dial.toLowerCase().includes(bundle.dial.toLowerCase());
            const matMatch = !bundle.material || !entry.material || entry.material.toLowerCase().includes(bundle.material.toLowerCase());
            if (dialMatch && matMatch) { anyVariantMatch = true; break; }
          }
          if (!anyVariantMatch) conflictDetected = true;
          else exactVariantMatched = true;
        }

        if (conflictDetected) {
          bundle.catalog_match_status = 'CATALOG_VARIANT_CONFLICT';
          catalogConf = 0;
          bundle.review_reasons.push('CATALOG_VARIANT_CONFLICT');
        } else if (exactVariantMatched) {
          bundle.catalog_match_status = 'CATALOG_EXACT_MATCH';
          catalogConf = 100;
        } else {
          bundle.catalog_match_status = 'CATALOG_REFERENCE_FOUND_VARIANT_UNCONFIRMED';
          catalogConf = 80;
        }
      } else {
        bundle.catalog_match_status = 'CATALOG_BRAND_OVERRIDE';
        catalogConf = 60;
      }
    } else {
      bundle.catalog_match_status = 'CATALOG_NOT_FOUND';
      catalogConf = 10;
    }
  } else {
    bundle.catalog_match_status = 'CATALOG_NOT_FOUND';
    catalogConf = 10;
  }

  const prices = bundle.prices || [];
  const hasPrimary = prices.some(p => p.is_primary && p.amount_original > 0);
  const hasCurrencyClear = prices.some(p => p.currency_original);
  let commercialConf = 0;
  if (hasPrimary) commercialConf += 50;
  if (hasCurrencyClear) commercialConf += 50;

  let sourceConf = 100; // default for live API ingestion
  let mediaConf = bundle.images?.length > 0 ? 100 : 0;

  const total = (
    identityConf * 0.40 +
    catalogConf * 0.25 +
    commercialConf * 0.20 +
    sourceConf * 0.10 +
    mediaConf * 0.05
  );

  return {
    total_confidence: Math.round(total),
    catalog_match_status: bundle.catalog_match_status
  };
}

function routeListing(confidence, bundle) {
  const review_reasons = bundle.review_reasons || [];
  if (!bundle.brand) review_reasons.push('MISSING_BRAND');
  if (!bundle.reference) review_reasons.push('MISSING_REFERENCE');
  if (!bundle.prices?.length) review_reasons.push('MISSING_PRICE');
  if (bundle.catalog_match_status === 'CATALOG_NOT_FOUND') review_reasons.push('CATALOG_NOT_FOUND');

  let approval_state = 'QUARANTINED';
  if (confidence >= 98) approval_state = 'AUTO_APPROVED';
  else if (confidence >= 90) approval_state = 'REVIEW_SUGGESTED';
  else if (confidence >= 80) approval_state = 'MUST_REVIEW';
  else if (confidence >= 60) approval_state = 'MANUAL_INTERVENTION';

  return { approval_state, review_reasons };
}

// Parse watch details via JASS-5 parser pipeline
function parseJass5(text, context, referenceHint = null) {
  const refAssertion = referenceHint
    ? assertField('reference', referenceHint, referenceHint, 95, 'context_segmentation')
    : extractReference(text);
  const brandAssertion = extractBrand(text, refAssertion.normalized_value, context);
  const dialAssertion = extractDial(text, refAssertion.normalized_value);
  const modelAssertion = extractModel(text, refAssertion.normalized_value);
  const materialAssertion = extractFromDictionary(text, MATERIALS.materials || {}, 'material');
  const braceletAssertion = extractFromDictionary(text, MATERIALS.bracelets || {}, 'bracelet');
  const bezelAssertion = extractFromDictionary(text, MATERIALS.bezels || {}, 'bezel');
  const conditionAssertion = extractCondition(text, context);
  let setStatusAssertion = extractFromDictionary(text, CONDITIONS.set_status || {}, 'set_status');
  if (!setStatusAssertion.normalized_value && context.set_status_context) {
    setStatusAssertion = assertField('set_status', context.set_status_context, context.set_status_context, 85, 'context_inherited');
  }
  const cardDate = extractCardDate(text);

  const assertions = {
    brand: brandAssertion,
    reference: refAssertion,
    model: modelAssertion,
    dial: dialAssertion,
    material: materialAssertion,
    bracelet: braceletAssertion,
    bezel: bezelAssertion,
    condition: conditionAssertion,
    set_status: setStatusAssertion,
    card_month: cardDate.card_month,
    card_year: cardDate.card_year
  };

  const prices = extractPriceObservations(text, context);

  const bundle = {
    brand: brandAssertion.normalized_value,
    reference: refAssertion.normalized_value,
    model: modelAssertion.normalized_value,
    dial: dialAssertion.normalized_value,
    material: materialAssertion.normalized_value,
    bracelet: braceletAssertion.normalized_value,
    bezel: bezelAssertion.normalized_value,
    condition: conditionAssertion.normalized_value,
    set_status: setStatusAssertion.normalized_value,
    card_month: cardDate.card_month.normalized_value,
    card_year: cardDate.card_year.normalized_value,
    prices,
    images: [],
    catalog_match_status: 'CATALOG_NOT_FOUND',
    review_reasons: []
  };

  const score = scoreConfidence(bundle, assertions);
  const { approval_state, review_reasons } = routeListing(score.total_confidence, bundle);

  return {
    brand: bundle.brand || 'Unknown',
    ref: bundle.reference || null,
    model: bundle.model || null,
    dial: bundle.dial || null,
    material: bundle.material || null,
    bracelet: bundle.bracelet || null,
    bezel: bundle.bezel || null,
    condition: bundle.condition || null,
    set_status: bundle.set_status || null,
    year: bundle.card_year || null,
    prices: bundle.prices,
    confidence: score.total_confidence,
    catalog_status: score.catalog_match_status,
    approval_state,
    review_reasons,
    assertions: Object.values(assertions).filter(a => a.normalized_value !== null)
  };
}

// ── DEEPSEEK LLM ENRICH ──────────────────────────────────────────

async function llmEnrich(rawMsg, parsed, apiKey) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are a luxury watch expert. Extract watch attributes from raw chat listings. Return JSON ONLY with: brand, reference, model, dialColor, material, bracelet, bezel, condition, setStatus, year, price, currency, confidence (0-100). Be extremely precise about case abbreviations.`
        },
        {
          role: 'user',
          content: `Regex result: ${JSON.stringify(parsed)}\nMessage: "${rawMsg}"\nReturn JSON:`
        },
      ],
      max_tokens: 300, temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}`);
  const d = await resp.json();
  return JSON.parse(d.choices[0].message.content);
}

// ── MULTI-WATCH SPLITTER ────────────────────────────────────

function splitMulti(rawMsg) {
  const lines = rawMsg.split(/\n/).map(l => l.trim()).filter(Boolean);
  const candidates = [];
  let currentHeader = '';
  let context = { brand_context: null, condition_context: null };

  for (const line of lines) {
    const isSectionHeader = /\b(?:rolex|patek|ap|rm|vc|used|new|stock)\b/i.test(line) 
                          && !/\b\d{4,6}[A-Z]{0,4}\b/i.test(line) 
                          && line.length < 60;
                          
    if (isSectionHeader) {
      currentHeader = line;
      context = parseContext(line);
      continue;
    }

    const refM = line.match(/\b([A-Z]?[0-9]{4,6}[A-Z]{0,4})\b/i);
    if (!refM) continue;

    candidates.push({
      rawLine: currentHeader ? `${currentHeader}\n${line}` : line,
      context: { ...context }
    });
  }
  return candidates;
}

// ── HTTP SUBAPASE INSERTS ────────────────────────────────────

async function insertSupabase(tableName, record, url, key) {
  const resp = await fetch(`${url}/rest/v1/${tableName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify([record]),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase write to ${tableName} failed: ${err}`);
  }
  const data = await resp.json();
  return data[0];
}

// ============================================================
// Single Ingest Logic Flow
// ============================================================

async function processMessage(rawMessage, channelId, source, supabaseUrl, serviceKey, deepseekKey) {
  // Step 1: Save Raw Message
  let rawRecord = {
    raw_text: rawMessage,
    sender_phone: channelId,
    source_platform: source,
    processing_status: 'PROCESSING',
    parser_version: 'v4.0-context',
  };
  
  if (supabaseUrl && serviceKey) {
    try {
      rawRecord = await insertSupabase('raw_messages', rawRecord, supabaseUrl, serviceKey);
    } catch (e) {
      console.error('[JASS-5] Raw message save failed:', e.message);
    }
  }

  const results = [];
  const segmented = segmentDealerMessage(rawMessage);
  const candidates = segmented.length > 0
    ? segmented
    : [{ rawLine: rawMessage, context: {}, prices: extractPriceObservations(rawMessage, {}) }];

  for (const cand of candidates) {
    // Step 2: Parse watch candidate locally via JASS-5 State-Machine
    let parsed = parseJass5(cand.rawLine, cand.context, cand.reference || null);

    // Hit LLM fallback if local regex is low confidence
    if (parsed.confidence < 70 && parsed.ref && deepseekKey) {
      try {
        const llm = await llmEnrich(cand.rawLine, parsed, deepseekKey);
        if (llm.brand && llm.brand !== 'Unknown') parsed.brand = llm.brand;
        if (llm.reference) parsed.ref = llm.reference;
        if (llm.model) parsed.model = llm.model;
        if (llm.dialColor) parsed.dial = llm.dialColor;
        if (llm.material) parsed.material = llm.material;
        if (llm.bracelet) parsed.bracelet = llm.bracelet;
        if (llm.bezel) parsed.bezel = llm.bezel;
        if (llm.condition) parsed.condition = llm.condition;
        if (llm.setStatus) parsed.set_status = llm.setStatus;
        if (llm.year) parsed.year = llm.year;
        parsed.confidence = Math.max(parsed.confidence, parseInt(llm.confidence) || 0);
      } catch (e) {
        console.error('[JASS-5 Ingest] LLM fallback error:', e.message);
      }
    }

    // Prepare JASS-5 structures
    const listingId = `list_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const primaryPrice = parsed.prices?.find(price => price.is_primary) || parsed.prices?.[0] || null;
    const normalizedListing = {
      id: listingId,
      brand: parsed.brand,
      reference: parsed.ref,
      dial_color: parsed.dial,
      condition: parsed.condition,
      year: parsed.year,
      price_raw: primaryPrice?.amount_original || null,
      price_usd: primaryPrice?.amount_usd || null,
      currency: primaryPrice?.currency_original || null,
      confidence: parsed.confidence,
      verdict: parsed.approval_state,
      source,
      raw_message: cand.rawLine,
      parser_version: 'v4.0-context',
      listing_type: cand.context.intent_context || 'WTS',
      listing_status: cand.context.listing_status_context || 'ACTIVE',
      processed_at: new Date().toISOString(),
      flags: {
        raw_message_id: rawRecord.id || null,
        set_status: parsed.set_status || null,
        catalog_status: parsed.catalog_status,
      },
      review_reason: parsed.review_reasons?.join(',') || null,
    };

    if (supabaseUrl && serviceKey) {
      try {
        // Ingest into watch_records table
        await insertSupabase('watch_records', normalizedListing, supabaseUrl, serviceKey);

        // Ingest related prices
        if (parsed.prices && parsed.prices.length > 0) {
          for (const pr of parsed.prices) {
            await insertSupabase('listing_prices', {
              listing_id: listingId,
              price_type: pr.price_type,
              amount_original: pr.amount_original,
              currency_original: pr.currency_original,
              amount_usd: pr.amount_usd,
              is_primary: pr.is_primary,
              raw_price_text: pr.raw_price_text,
              confidence: pr.confidence,
              currency_evidence: pr.currency_evidence || null,
              discount_percent: pr.discount_percent || null,
              retail_price: pr.retail_price || null,
            }, supabaseUrl, serviceKey);
          }
        }

        // Ingest Assertions
        if (parsed.assertions && parsed.assertions.length > 0) {
          for (const ass of parsed.assertions) {
            await insertSupabase('listing_field_assertions', {
              listing_id: listingId,
              field_name: ass.field_name,
              raw_value: ass.raw_value == null ? null : String(ass.raw_value),
              normalized_value: ass.normalized_value == null ? null : String(ass.normalized_value),
              confidence: ass.confidence,
              source_method: ass.source_method
            }, supabaseUrl, serviceKey);
          }
        }
      } catch (dbErr) {
        console.error('[JASS-5 Ingest] DB Inserts failed:', dbErr.message);
      }
    }

    results.push({
      id: listingId,
      verdict: parsed.approval_state,
      brand: parsed.brand,
      reference: parsed.ref,
      confidence: parsed.confidence,
      catalog_status: parsed.catalog_status,
      prices: parsed.prices,
      listing_type: cand.context.intent_context || 'WTS',
    });
  }

  // Update original raw message status
  if (supabaseUrl && serviceKey && rawRecord.id) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/raw_messages?id=eq.${rawRecord.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ processing_status: 'DONE' }),
      });
    } catch {}
  }

  return results;
}

// ============================================================
// Main API Router Handler
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  // Supabase now labels newly-created server keys as "secret" keys. Keep the
  // established variable name working while supporting the current dashboard
  // convention. Neither value is ever returned to a client.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const serviceKey = serviceRoleKey || secretKey;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (req.method === 'GET') {
    const readKey = serviceKey || publishableKey;
    if (!supabaseUrl || !readKey) {
      return res.status(200).json({
        count: 0,
        total: 0,
        records: [],
        status: 'supabase_not_configured',
        configuration: {
          supabaseUrlPresent: Boolean(supabaseUrl),
          serviceRoleKeyPresent: Boolean(serviceRoleKey),
          secretKeyPresent: Boolean(secretKey),
          serverKeyPresent: Boolean(serviceKey),
          publishableKeyPresent: Boolean(publishableKey),
          vercelRuntime: Boolean(process.env.VERCEL),
          gitBranch: process.env.VERCEL_GIT_COMMIT_REF || null,
        },
      });
    }
    try {
      const requestedPage = Number.parseInt(String(req.query?.page || '1'), 10);
      const requestedPageSize = Number.parseInt(String(req.query?.pageSize || '50'), 10);
      const page = Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1;
      const pageSize = Number.isFinite(requestedPageSize)
        ? Math.min(Math.max(requestedPageSize, 10), 100)
        : 50;
      const listingType = normalizeListingTypeParam(req.query?.type || req.query?.listing_type || '');
      const itemType = String(req.query?.item || '').toLowerCase();
      const listingFormat = String(req.query?.format || 'single').toLowerCase();
      const regionFilter = String(req.query?.region || '').toLowerCase();
      const search = String(req.query?.q || '').trim().slice(0, 100);
      const quality = String(req.query?.quality || 'market').toLowerCase();
      const imagesOnly = String(req.query?.images || '').toLowerCase() === 'true';
      const allowedTypes = new Set(['WTS', 'WTB', 'NTQ', 'TRADE', 'MULTI', 'OTHER']);
      const allowedItems = new Set(['all', 'watches', 'luxury', 'jewelry', 'handbags', 'accessories', 'multi']);
      const allowedFormats = new Set(['single', 'bulk', 'all']);
      const start = (page - 1) * pageSize;
      const end = start + pageSize - 1;
      const tableName = serviceKey ? 'watch_records' : 'trading_floor_listings';
      const params = new URLSearchParams({
        // Keep this response marketplace-safe even when a server key is used.
        select: 'id,brand,reference,price_usd,price_raw,currency,dial_color,condition,year,verdict,listing_type,source,source_type,listing_date,listing_status,created_at,confidence,has_images,thumbnail_url,region,raw_message',
        // This matches the production created_at DESC index. NULLS LAST needs a
        // dedicated index before it can be enabled safely on millions of rows.
        order: 'created_at.desc',
      });

      // NTQ is historical buyer-intent shorthand. Customer-facing WTB must
      // include both values so every "looking for / want to buy" request is
      // found in one demand view while the stored source classification stays
      // unchanged for auditability.
      const normalizedItem = allowedItems.has(itemType) ? itemType : 'all';
      const normalizedFormat = allowedFormats.has(listingFormat) ? listingFormat : 'single';

      if (normalizedItem === 'multi' || normalizedFormat === 'bulk') {
        params.set('listing_type', 'eq.MULTI');
      } else if (listingType === 'WTB') {
        params.set('listing_type', 'in.(WTB,NTQ)');
      } else if (allowedTypes.has(listingType)) {
        params.set('listing_type', `eq.${listingType}`);
      } else if (normalizedItem === 'luxury' || normalizedItem === 'jewelry' || normalizedItem === 'handbags' || normalizedItem === 'accessories') {
        params.set('listing_type', 'eq.OTHER');
      } else if (normalizedItem === 'watches') {
        params.set('listing_type', normalizedFormat === 'all' ? 'not.eq.OTHER' : 'not.in.(MULTI,OTHER)');
      } else if (normalizedFormat === 'single') {
        params.set('listing_type', 'neq.MULTI');
      }

      if (normalizedItem === 'jewelry') params.set('source_type', 'ilike.*jewelry*');
      if (normalizedItem === 'handbags') params.set('source_type', 'ilike.*handbag*');
      if (normalizedItem === 'accessories') params.set('source_type', 'ilike.*accessor*');
      if (regionFilter === 'pending') params.set('region', 'is.null');
      if (regionFilter === 'north_america') params.set('region', 'ilike.*north*');
      if (regionFilter === 'europe') params.set('region', 'ilike.*europe*');
      if (regionFilter === 'asia') params.set('region', 'ilike.*asia*');
      if (imagesOnly) params.set('has_images', 'eq.true');
      // Customer-facing inventory never includes RECYCLE records. The recent
      // view avoids letting undated legacy imports dominate page one, while the
      // all-inventory view and every explicit search still include those rows.
      // Price Research applies its own stricter approved/comparable-data policy.
      // WTS requires a real asking price. WTB/NTQ may legitimately omit one.
      // Keep this database-side so pagination totals and page sizes describe
      // customer-visible inventory rather than filtering 50-row pages in the
      // browser. A positive original price remains eligible for deterministic
      // query-time USD recovery below.
      params.set(
        'and',
        '(or(verdict.neq.RECYCLE,verdict.is.null),or(listing_type.neq.WTS,price_usd.gt.0,price_raw.gt.0))'
      );
      // Supabase preview bootstrap rows are useful for deployment checks, but
      // must never be presented as dealer inventory in a customer environment.
      params.set('id', 'not.like.preview_demo_*');
      if (quality !== 'archive' && !search) {
        params.set('created_at', 'not.is.null');
      }
      if (search) {
        const escapedSearch = search.replace(/[(),.]/g, ' ').replace(/%/g, '').replace(/\*/g, '').trim();
        if (escapedSearch) {
          // Reference lookups are the dominant workflow and must use the btree
          // equality index. Broad wildcard scans across millions of rows caused
          // database statement timeouts. Brand lookup remains exact but
          // case-insensitive; full-text message search belongs in a dedicated
          // indexed search service/RPC.
          const parsedSearch = parseTradingSearch(search);
          if (parsedSearch.reference) params.set('reference', `eq.${parsedSearch.reference}`);
          if (parsedSearch.brand) params.set('brand', `ilike.${parsedSearch.brand}`);
          if (parsedSearch.dial) params.set('dial_color', `ilike.${parsedSearch.dial}`);
          if (!parsedSearch.reference && !parsedSearch.brand && !parsedSearch.dial) {
            params.set('raw_message', `ilike.*${escapedSearch.replace(/[^a-z0-9 $-]/gi, '')}*`);
          }
        }
      }

      // Pagination and filtering happen in Postgres. The browser should never receive the whole archive.
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/${tableName}?${params.toString()}`,
        {
          headers: {
            'apikey': readKey,
            'Authorization': `Bearer ${readKey}`,
            'Range-Unit': 'items',
            'Range': `${start}-${end}`,
            // Estimated counts avoid a full-table count for a multi-million-row archive.
            'Prefer': 'count=estimated',
          },
        }
      );
      if (!resp.ok) throw new Error(`Supabase returned ${resp.status}`);
      const records = await resp.json();
      const normalizedRecords = Array.isArray(records)
        ? records.map(record => {
            const normalized = normalizeMarketRow(record, record.reference || null);
            return {
              ...record,
              price_usd: normalized.analytics_price_usd,
              price_normalization: normalized.price_normalization,
            };
          })
        : [];
      const contentRange = resp.headers.get('content-range') || '';
      const total = Number.parseInt(contentRange.split('/')[1] || '0', 10) || 0;
      return res.status(200).json({
        count: normalizedRecords.length,
        total,
        page,
        pageSize,
        totalIsEstimate: true,
        records: normalizedRecords,
        status: 'ok',
        accessMode: serviceKey ? 'server_key' : 'publishable_read_only',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      error: 'Ingestion requires a Supabase server key',
      status: 'supabase_write_not_configured',
    });
  }

  const body = req.body || {};
  let rawMessage = body.rawMessage;
  let channelId = body.channelId || body.channel_id || 'direct';
  let source = body.source || 'api';

  if (!rawMessage && body.message?.text) {
    rawMessage = body.message.text;
    channelId = String(body.message.chat?.id || 'telegram');
    source = 'telegram';
  }

  if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length < 5) {
    return res.status(400).json({ error: 'rawMessage required (min 5 characters)' });
  }

  try {
    const results = await processMessage(rawMessage, channelId, source, supabaseUrl, serviceKey, deepseekKey);
    return res.status(200).json({
      success: true,
      messageType: results.length > 1 ? 'MULTI' : 'WTS',
      isMulti: results.length > 1,
      records: results.map(r => ({
        id: r.id,
        verdict: r.verdict,
        brand: r.brand,
        reference: r.reference,
        confidence: r.confidence,
        catalog_status: r.catalog_status,
        prices: r.prices
      })),
    });
  } catch (e) {
    console.error('[JASS-5 Ingest Error]:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
