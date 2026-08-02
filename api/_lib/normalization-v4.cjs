'use strict';

const CURRENCY_ALIASES = [
  { code: 'USDT', pattern: 'USDT' },
  { code: 'HKD', pattern: 'HKD|HDK|HK\\$|H\\.?K\\.?D\\.?|港币|港幣' },
  { code: 'USD', pattern: 'USD|US\\$|U\\$' },
  { code: 'EUR', pattern: 'EUR|€' },
  { code: 'GBP', pattern: 'GBP|£' },
  { code: 'CHF', pattern: 'CHF' },
  { code: 'SGD', pattern: 'SGD|S\\$' },
  { code: 'CNY', pattern: 'CNY|RMB|CN¥' },
];

const CURRENCY_TOKEN = CURRENCY_ALIASES.map(item => item.pattern).join('|');
// Dealer shorthand "HK" is accepted only when directly attached to a price.
// It is intentionally excluded from message/section context because phrases
// such as "arrive HK" describe location rather than currency.
const PRICE_CURRENCY_TOKEN = `${CURRENCY_TOKEN}|HK`;
const MULTIPLIERS = {
  k: 1_000,
  mil: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  mill: 1_000_000,
  million: 1_000_000,
  w: 10_000,
  '万': 10_000,
};
const MULTIPLIER_TOKEN = 'million|mill|mil|mn|k|m|w|万';
const USD_PER_UNIT = { USD: 1, USDT: 1, HKD: 1 / 7.8, EUR: 1.08, GBP: 1.27, CHF: 1.12, SGD: 0.74, CNY: 0.138 };

const BRAND_HEADERS = [
  [/\b(?:patek\s*philippe|patek|pp)\b/i, 'Patek Philippe'],
  [/\b(?:audemars\s*piguet|audemars|ap)\b/i, 'Audemars Piguet'],
  [/\b(?:vacheron\s*constantin|vacheron|vc)\b/i, 'Vacheron Constantin'],
  [/\b(?:richard\s*mille|rm)\b/i, 'Richard Mille'],
  [/\brolex\b/i, 'Rolex'],
  [/\bcartier\b/i, 'Cartier'],
  [/\bchopard\b/i, 'Chopard'],
  [/\bomega\b/i, 'Omega'],
  [/\bhublot\b/i, 'Hublot'],
  [/\btudor\b/i, 'Tudor'],
];

function buildNumericParsingView(value) {
  const original = String(value || '');
  let text = '';
  const spans = [];

  for (let index = 0; index < original.length;) {
    const keycap = original.slice(index).match(/^([0-9])\uFE0F?\u20E3/u);
    if (keycap) {
      text += keycap[1];
      spans.push({ start: index, end: index + keycap[0].length });
      index += keycap[0].length;
      continue;
    }

    const codePoint = original.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    const decoded = codePoint >= 0xFF10 && codePoint <= 0xFF19
      ? String(codePoint - 0xFF10)
      : character;
    text += decoded;
    for (let unit = 0; unit < decoded.length; unit += 1) {
      spans.push({ start: index, end: index + character.length });
    }
    index += character.length;
  }

  return {
    text,
    originalSlice(start, end) {
      if (!spans.length || start >= spans.length || end <= 0) return '';
      const first = spans[Math.max(0, start)];
      const last = spans[Math.min(spans.length, end) - 1];
      return original.slice(first.start, last.end);
    },
  };
}

function decodeNumericUnicode(value) {
  return buildNumericParsingView(value).text;
}

function normalizeCurrencyToken(token) {
  const clean = String(token || '').toUpperCase().replace(/\s/g, '');
  if (/^(HKD|HDK|HK|HK\$|H\.?K\.?D\.?)$/.test(clean) || /港币|港幣/.test(token)) return 'HKD';
  if (/^(USD|US\$|U\$)$/.test(clean)) return 'USD';
  if (clean === 'USDT') return 'USDT';
  if (clean === 'EUR' || clean === '€') return 'EUR';
  if (clean === 'GBP' || clean === '£') return 'GBP';
  if (clean === 'CHF') return 'CHF';
  if (clean === 'SGD' || clean === 'S$') return 'SGD';
  if (/^(CNY|RMB|CN¥)$/.test(clean)) return 'CNY';
  return null;
}

function parseNumber(rawNumber, rawMultiplier = '') {
  let token = decodeNumericUnicode(rawNumber).trim().replace(/\s/g, '');
  if (!token) return null;

  // Dealer typo: 2.070,000 or 2,070.000 means 2,070,000.
  if (/^\d{1,3}(?:[.,]\d{3}){2,}$/.test(token)) {
    token = token.replace(/[.,]/g, '');
  } else if (/^\d{1,3}[.,]\d{3}$/.test(token) && !rawMultiplier) {
    token = token.replace(/[.,]/g, '');
  } else {
    token = token.replace(/,/g, '');
  }

  const number = Number.parseFloat(token);
  if (!Number.isFinite(number) || number <= 0) return null;
  const multiplier = MULTIPLIERS[String(rawMultiplier || '').toLowerCase()] || 1;
  return Math.round(number * multiplier);
}

function inferContextCurrency(text, existing = null) {
  const explicit = CURRENCY_ALIASES.find(item => new RegExp(`(?:${item.pattern})`, 'i').test(text));
  return explicit?.code || existing;
}

function extractDiscount(text) {
  const match = String(text).match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  return match ? Number.parseFloat(match[1]) : null;
}

function extractRetailPrice(text, discountPercent) {
  if (discountPercent == null) return null;
  const beforeDiscount = String(text).split(/-?\s*\d{1,2}(?:\.\d+)?\s*%/)[0];
  const matches = [...beforeDiscount.matchAll(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,9})\b/g)];
  if (!matches.length) return null;
  return parseNumber(matches[matches.length - 1][1]);
}

function extractPriceObservations(text, context = {}) {
  const observations = [];
  const seen = new Set();
  const parsingView = buildNumericParsingView(text);
  const line = parsingView.text;

  const add = (raw, rawNumber, multiplier, rawCurrency, index, evidence, direction = 'other') => {
    const amount = parseNumber(rawNumber, multiplier);
    const currency = normalizeCurrencyToken(rawCurrency);
    if (!amount || !currency) return;
    const key = `${index}:${amount}:${currency}`;
    if (seen.has(key)) return;
    seen.add(key);
    observations.push({
      price_type: observations.length === 0 ? 'ASK_PRICE' : 'ALT_CURRENCY_PRICE',
      amount_original: amount,
      currency_original: currency,
      amount_usd: Math.round(amount * (USD_PER_UNIT[currency] || 1)),
      is_primary: observations.length === 0,
      raw_price_text: parsingView.originalSlice(index, index + raw.length).trim(),
      confidence: 98,
      currency_evidence: evidence,
      index,
      end: index + raw.length,
      direction,
      raw_number: String(rawNumber || ''),
      had_multiplier: Boolean(multiplier),
    });
  };

  const leftCurrency = new RegExp(`(?<![A-Za-z])(${PRICE_CURRENCY_TOKEN})\\s*[:=]?\\s*([\\d][\\d.,]*)(?:\\s*(${MULTIPLIER_TOKEN})(?![A-Za-z]))?`, 'gi');
  const rightCurrency = new RegExp(`(?<![A-Za-z0-9])(?!19\\d{2}\\s*[,;]|20\\d{2}\\s*[,;])([\\d][\\d.,]*)(?:\\s*(${MULTIPLIER_TOKEN})(?![A-Za-z]))?\\s*(${PRICE_CURRENCY_TOKEN})`, 'gi');

  for (const match of line.matchAll(leftCurrency)) {
    const amount = parseNumber(match[2], match[3]);
    const followedByDateSeparator = /^\s*\//.test(line.slice(match.index + match[0].length));
    const yearLike = !match[3] && amount >= 1900 && amount <= 2099;
    if (followedByDateSeparator || yearLike) continue;
    add(match[0], match[2], match[3], match[1], match.index, 'explicit_line_currency', 'prefix');
  }
  for (const match of line.matchAll(rightCurrency)) {
    const amount = parseNumber(match[1], match[2]);
    const precededByDateSeparator = line.slice(0, match.index).trimEnd().endsWith('/')
      && !match[2]
      && amount <= 31;
    const yearLike = !match[2] && amount >= 1900 && amount <= 2099;
    if (precededByDateSeparator || yearLike) continue;
    add(match[0], match[1], match[2], match[3], match.index, 'explicit_line_currency', 'suffix');
  }

  // In "2018 HKD 720,000" both directional regexes touch the same HKD token.
  // The currency-prefixed amount is the intended price; the preceding value
  // is commonly a year, limited-edition count, or other watch attribute.
  const rejectedOverlaps = new Set();
  for (const suffix of observations.filter(observation => observation.direction === 'suffix')) {
    const prefix = observations.find(other => (
      other.direction === 'prefix'
      && other.currency_original === suffix.currency_original
      && other.index >= suffix.index
      && other.index < suffix.end
    ));
    if (!prefix) continue;

    // "498k USDT 3.85m HKD" is a dual-currency bridge: the amount consumed by
    // the USDT prefix is also explicitly paired with the following HKD token.
    // Preserve the two outward-facing pairs and reject the artificial bridge.
    const trailingPair = observations.some(other => (
      other !== suffix
      && other.direction === 'suffix'
      && other.currency_original !== prefix.currency_original
      && other.amount_original === prefix.amount_original
      && other.index > prefix.index
      && other.index < prefix.end
    ));
    const yearLike = suffix.amount_original >= 1900 && suffix.amount_original <= 2099;
    const suffixHasExplicitScale = suffix.had_multiplier
      || /[.,]\d{3}/.test(suffix.raw_number)
      || (suffix.amount_original >= 10_000 && !yearLike);
    rejectedOverlaps.add(trailingPair && suffixHasExplicitScale ? prefix : suffix);
  }

  // A bare dollar sign inherits an explicit section/message currency. Without
  // context it remains unresolved instead of silently becoming USD.
  const dollarPattern = new RegExp(`\\$\\s*([\\d][\\d.,]*)(?:\\s*(${MULTIPLIER_TOKEN})(?![A-Za-z]))?`, 'gi');
  for (const match of line.matchAll(dollarPattern)) {
    const contextCurrency = context.currency_context || null;
    if (contextCurrency) {
      add(match[0], match[1], match[2], contextCurrency, match.index, 'section_currency');
    }
  }

  if (!observations.length && context.currency_context) {
    const bare = line.match(new RegExp(`\\b(\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(${MULTIPLIER_TOKEN})(?![A-Za-z])`, 'i'));
    if (bare) {
      const multiplier = String(bare[2] || '').toLowerCase();
      const integerToken = /^\d{4,}$/.test(bare[1]);
      const millionScale = /^(?:m|mn|mil|mill|million)$/.test(multiplier);
      // Tokens such as Rolex 14060M are references, not 14.06B prices. When
      // currency is inherited, leave this ambiguous instead of manufacturing
      // a price. An explicit adjacent currency still follows the rules above.
      if (!(integerToken && millionScale)) {
        add(bare[0], bare[1], bare[2], context.currency_context, bare.index, 'section_currency');
      }
    }
  }

  const accepted = observations.filter(observation => !rejectedOverlaps.has(observation));
  accepted.sort((a, b) => a.index - b.index);
  accepted.forEach((entry, index) => {
    entry.price_type = index === 0 ? 'ASK_PRICE' : 'ALT_CURRENCY_PRICE';
    entry.is_primary = index === 0;
    delete entry.index;
    delete entry.end;
    delete entry.direction;
    delete entry.raw_number;
    delete entry.had_multiplier;
  });

  const discount_percent = extractDiscount(line);
  const retail_price = extractRetailPrice(line, discount_percent);
  if (accepted.length && discount_percent != null) {
    accepted[0].discount_percent = discount_percent;
    accepted[0].retail_price = retail_price;
  }

  return accepted;
}

function hasUnresolvedEmojiPrice(text, context = {}) {
  const raw = String(text || '');
  const withoutKeycaps = raw.replace(/[0-9]\uFE0F?\u20E3/gu, '');
  const hasPictograph = /\p{Extended_Pictographic}/u.test(withoutKeycaps);
  if (!hasPictograph) return false;

  const hasPriceCue = Boolean(context.currency_context)
    || new RegExp(`(?:${CURRENCY_TOKEN})`, 'i').test(raw)
    || /(?:\$|price|ask(?:ing)?|\u{1F4B0}|\u{1F4B5}|\u{1F4B2})/iu.test(raw);
  return hasPriceCue && extractPriceObservations(raw, context).length === 0;
}

function detectBrandHeader(line) {
  const match = BRAND_HEADERS.find(([pattern]) => pattern.test(line));
  return match?.[1] || null;
}

function inferBrandFromReference(reference) {
  const ref = String(reference || '').toUpperCase();
  if (/^RM\s*\d/.test(ref)) return 'Richard Mille';
  if (/^(?:15|26|67|77)\d{3}[A-Z]{2}(?:\.|$)/.test(ref)) return 'Audemars Piguet';
  if (/^[245678]\d{3}[VH]\//.test(ref)) return 'Vacheron Constantin';
  if (/^WSSA\d{4}$/.test(ref)) return 'Cartier';
  if (/^\d{3}\.[A-Z]{2}\.\d{4}\.[A-Z]{2}\.\d{4}$/.test(ref)) return 'Hublot';
  if (/^PAM\d/.test(ref)) return 'Panerai';
  if (/^52\d{3}$/.test(ref)) return 'Rolex';
  if (/^\d{6}[A-Z]{0,5}$/.test(ref)) return 'Rolex';
  if (/^[34567]\d{3}[A-Z]?(?:\/\d[A-Z0-9]*)?(?:-\d{3})?$/.test(ref)) return 'Patek Philippe';
  return null;
}

function isPriceLikeReferenceToken(text, matchIndex, rawToken) {
  const before = text.slice(Math.max(0, matchIndex - 24), matchIndex);
  const after = text.slice(matchIndex + rawToken.length, matchIndex + rawToken.length + 24);
  const compact = String(rawToken).toUpperCase();
  const isBareNumericToken = /^\d{5,6}$/.test(compact);
  const followsPriceLabel = /(?:price|ask(?:ing)?|usd|hkd|usdt|us\$|hk\$|\$)\s*$/i.test(before);
  const hasCurrencySuffix = /^\d{5,6}(?:USD|HKD|USDT)$/.test(compact);
  const precedesCurrencyWord = isBareNumericToken && /^\s*(?:usd|hkd|usdt|us\$|hk\$)\b/i.test(after);
  const hasDirectDollarSuffix = isBareNumericToken && /^\$/.test(after);
  return followsPriceLabel || hasCurrencySuffix || precedesCurrencyWord || hasDirectDollarSuffix;
}

function isDateLikeReferenceToken(rawToken) {
  return /^(?:19|20)\d{2}\/(?:0?[1-9]|1[0-2])$/i.test(String(rawToken || '').trim());
}

function extractReference(line) {
  const text = String(line);
  const patterns = [
    /\b(RM\s*\d{2,3}(?:-\d{2})?(?:\s*[A-Z0-9]+)?)\b/i,
    /\b(IW\d{6})\b/i,
    /\b(Q\d{7})\b/i,
    /\b(M\d{4}[A-Z0-9]+-\d{4})\b/i,
    /\b(G0A\d{5})\b/i,
    /\b(W[A-Z]{3}\d{4})\b/i,
    /\b(\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3})\b/i,
    /\b(L\d\.\d{3}\.\d\.\d{2}\.\d)\b/i,
    /\b(BR[A-Z0-9][A-Z0-9/-]{5,})\b/i,
    /\b((?:15|26|67|77)\d{3}[A-Z]{2}(?:\.[A-Z0-9.]+)?)\b/i,
    /\b([245678]\d{3}[VH]\/[A-Z0-9-]+)\b/i,
    /\b(WSSA\d{4})\b/i,
    /\b(\d{3}\.[A-Z]{2}\.\d{4}\.[A-Z]{2}\.\d{4})\b/i,
    /\b(?:PP|PATEK)\s*([345678]\d{3}[A-Z]?(?:\/\d[A-Z0-9]*)?(?:-\d{3})?)\b/i,
    /\b(\d{4}\/\d[A-Z0-9-]*)\b/i,
    /\b([345678]\d{3}[A-Z](?:-\d{3})?)\b/i,
    /\b(PAM\s*\d{3,5})\b/i,
    /\b(\d{5,6}[A-Z]{1,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match
      && !isDateLikeReferenceToken(match[1])
      && !isPriceLikeReferenceToken(text, match.index, match[1])) {
      return match[1].replace(/\s/g, '').toUpperCase();
    }
  }

  // A bare six-digit reference is valid for Rolex, but a six-digit asking
  // price (for example "195000 USD") must never create a phantom listing.
  for (const match of text.matchAll(/\b(\d{5,6})\b/g)) {
    if (!isPriceLikeReferenceToken(text, match.index, match[1])) return match[1];
  }
  return null;
}

function looksLikeHeader(line, reference) {
  const text = String(line).trim();
  if (!text || reference) return false;
  return text.length < 100 && (
    Boolean(detectBrandHeader(text))
    || /\b(?:brand\s+new|new|used|coming\s+stock|without\s+box|watch\s+only|full\s+set|only\s+watch\s+and\s+card)\b/i.test(text)
    || /\b(?:HKD|USD|USDT|HK\$)\b|\u6e2f\u5e01|\u6e2f\u5e63/i.test(text)
    || /(?:\bWTB\b|\bNTQ\b|want\s+to\s+buy|looking\s+for|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\u6536[\uff1a:\s]/i.test(text)
  );
}

function applyHeaderContext(context, line) {
  const next = { ...context };
  const brand = detectBrandHeader(line);
  if (brand) next.brand_context = brand;
  const currency = inferContextCurrency(line, null);
  if (currency) next.currency_context = currency;
  if (/\b(?:brand\s+new|new)\b/i.test(line)) next.condition_context = 'New';
  if (/\bused\b/i.test(line)) next.condition_context = 'Used';
  if (/without\s+box/i.test(line)) next.set_status_context = 'Without Box';
  if (/only\s+watch\s+and\s+card|watch\s+only/i.test(line)) next.set_status_context = 'Watch Only';
  if (/full\s+set/i.test(line)) next.set_status_context = 'Full Set';
  if (/coming\s+stock/i.test(line)) next.listing_status_context = 'COMING';
  if (/(?:\bWTB\b|\bNTQ\b|want\s+to\s+buy|looking\s+for|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\s*\u6536[\uff1a:\s]/i.test(line)) next.intent_context = 'WTB';
  return next;
}

function inferIntent(line, inherited = null) {
  if (/(?:\bWTB\b|\bNTQ\b|want\s+to\s+buy|looking\s+for|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\s*\u6536[\uff1a:\s]/i.test(line)) return 'WTB';
  if (/\b(?:sold|withdrawn)\b/i.test(line)) return 'WITHDRAWN';
  return inherited || 'WTS';
}

function inferCondition(line, inherited = null) {
  const text = String(line || '');
  if (/\b(?:used|pre[\s-]?owned|worn|second[\s-]?hand)\b/i.test(text)) return 'Used';
  if (/\b(?:brand\s+new|new|unworn|bnib|nos)\b/i.test(text)) return 'New';
  return inherited || null;
}

function splitMessageLines(rawMessage) {
  // Split emoji only when they introduce another recognizable listing. Price
  // code emoji must stay on their line so ambiguity detection can block them.
  return String(rawMessage || '')
    .replace(/_x000D_/gi, '\n')
    .split(/\r?\n/)
    .flatMap(line => {
      const parts = [];
      let start = 0;
      for (const match of line.matchAll(/(?:\p{Extended_Pictographic}\uFE0F?|\u200D|ðŸ.{2})+/gu)) {
        const tail = line.slice(match.index + match[0].length);
        if (!extractReference(tail)) continue;
        const before = line.slice(start, match.index).trim();
        if (before) parts.push(before);
        start = match.index + match[0].length;
      }
      const remainder = line.slice(start).trim();
      if (remainder) parts.push(remainder);
      return parts;
    })
    .map(line => line.trim())
    .filter(Boolean);
}

function segmentDealerMessage(rawMessage) {
  const candidates = [];
  let context = {};
  const lines = splitMessageLines(rawMessage);

  for (const line of lines) {
    const reference = extractReference(line);
    if (looksLikeHeader(line, reference)) {
      context = applyHeaderContext(context, line);
      continue;
    }
    if (!reference) continue;

    const inferredBrand = inferBrandFromReference(reference);
    const explicitBrand = detectBrandHeader(line);
    const candidateContext = {
      ...context,
      brand_context: inferredBrand || explicitBrand || context.brand_context || null,
      intent_context: inferIntent(line, context.intent_context),
      condition_context: inferCondition(line, context.condition_context),
    };
    const prices = extractPriceObservations(line, context);
    candidates.push({
      rawLine: line,
      reference,
      context: candidateContext,
      prices,
      emoji_price_ambiguous: !prices.length && hasUnresolvedEmojiPrice(line, context),
    });
  }

  return candidates;
}

module.exports = {
  decodeNumericUnicode,
  extractPriceObservations,
  extractReference,
  hasUnresolvedEmojiPrice,
  inferBrandFromReference,
  parseNumber,
  segmentDealerMessage,
  splitMessageLines,
};
