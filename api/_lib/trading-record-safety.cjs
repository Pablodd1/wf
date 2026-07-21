'use strict';

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && !/^(?:unknown|null|n\/a)$/i.test(text) ? text : null;
}

function isPriceLike(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (!/\d/.test(text)) return false;
  return /^(?:[$£€¥]\s*)?[\d,.]+(?:\s*(?:k|m|mn|mil|million|w|万))?(?:\s*(?:usd|usdt|hkd|hk\$|eur|gbp|chf|rmb|cny|jpy))?$/i.test(text)
    || /^(?:usd|usdt|hkd|hk\$|eur|gbp|chf|rmb|cny|jpy)\s*[\d,.]+/i.test(text);
}

function numericReference(value) {
  const text = cleanText(value);
  if (!text) return null;
  const compact = text.replace(/[\s.-]/g, '');
  return /^\d{4,8}$/.test(compact) ? Number(compact) : null;
}

function isReferencePriceCollision(record) {
  const reference = numericReference(record?.reference);
  if (!reference) return false;
  const prices = [record?.price_raw, record?.price_usd].map(Number).filter(value => Number.isFinite(value) && value > 0);
  if (!prices.length) return false;
  return prices.every(value => {
    const price = Number(value);
    return Math.round(price) === reference;
  });
}

function isPunctuationOnly(value) {
  const text = cleanText(value);
  return Boolean(text && !/[a-z0-9]/i.test(text));
}

function isLikelyYearAsPrice(record) {
  const price = Number(record?.price_usd);
  const currentYear = new Date().getUTCFullYear();
  return Number.isInteger(price)
    && price >= 1900
    && price <= currentYear + 2
    && record?.price_raw == null
    && cleanText(record?.reference) == null
    && record?.year == null
    && cleanText(record?.condition) == null;
}

function sanitizeTradingRecord(record) {
  const issues = [];
  const sanitized = { ...record };
  const brand = cleanText(record.brand);
  const reference = cleanText(record.reference);
  const dial = cleanText(record.dial_color);
  const condition = cleanText(record.condition);

  if (isPunctuationOnly(reference)) {
    sanitized.reference = null;
    issues.push('REFERENCE_PUNCTUATION_ONLY');
  } else if (reference && brand && reference.localeCompare(brand, undefined, { sensitivity: 'accent' }) === 0) {
    sanitized.reference = null;
    issues.push('REFERENCE_EQUALS_BRAND');
  } else if (reference && /(?:[$Â£â‚¬Â¥]|\b(?:USD|USDT|HKD|HK\$|EUR|GBP|CHF|RMB|CNY|JPY)\b)/i.test(reference)) {
    sanitized.reference = null;
    issues.push('REFERENCE_PRICE_CONTAMINATION');
  }

  if (isPunctuationOnly(dial)) {
    sanitized.dial_color = null;
    issues.push('DIAL_PUNCTUATION_ONLY');
  } else if (isPriceLike(dial)) {
    sanitized.dial_color = null;
    issues.push('DIAL_PRICE_CONTAMINATION');
  }

  if (isPunctuationOnly(condition)) {
    sanitized.condition = null;
    issues.push('CONDITION_PUNCTUATION_ONLY');
  } else if (isPriceLike(condition)) {
    sanitized.condition = null;
    issues.push('CONDITION_PRICE_CONTAMINATION');
  }

  const year = Number(record.year);
  if (record.year != null && (!Number.isInteger(year) || year < 1800 || year > new Date().getUTCFullYear() + 2)) {
    sanitized.year = null;
    issues.push('YEAR_INVALID');
  }

  const price = Number(record.price_usd);
  if (record.price_usd != null && (!Number.isFinite(price) || price <= 0)) {
    sanitized.price_usd = null;
    issues.push('PRICE_INVALID');
  }

  // A frequent legacy parser failure copies a numeric reference into both
  // price fields. Keep the source record immutable, but never publish or use
  // that collision as market evidence until a reviewer confirms it.
  if (isReferencePriceCollision(record)) {
    sanitized.price_usd = null;
    sanitized.price_raw = null;
    issues.push('REFERENCE_TOKEN_AS_PRICE');
  }

  if (isLikelyYearAsPrice(record)) {
    sanitized.price_usd = null;
    issues.push('YEAR_TOKEN_AS_PRICE');
  }

  const usdPrice = Number(sanitized.price_usd);
  if (sanitized.reference && Number.isFinite(usdPrice) && usdPrice > 0 && usdPrice < 1000) {
    sanitized.price_usd = null;
    sanitized.price_raw = null;
    issues.push('PRICE_BELOW_PLAUSIBILITY_FLOOR');
  }

  return {
    ...sanitized,
    data_quality_issues: issues,
    data_quality_review_required: issues.length > 0,
  };
}

module.exports = { isLikelyYearAsPrice, isPriceLike, isReferencePriceCollision, sanitizeTradingRecord };
