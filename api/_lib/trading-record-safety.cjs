'use strict';

const { confirmCatalogCandidate } = require('./catalog-confirmation.cjs');

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
    && price <= currentYear + 2;
}

function deriveItemCategory(record) {
  const listingType = String(record?.listing_type || '').toUpperCase();
  const sourceType = String(record?.source_type || '').toLowerCase();
  if (sourceType === 'jewelry_archive') return 'JEWELRY';
  if (['handbag_archive', 'handbags_archive', 'bag_archive'].includes(sourceType)) return 'HANDBAG';
  if (['accessory_archive', 'accessories_archive'].includes(sourceType)) return 'ACCESSORY';
  if (['WTS', 'WTB', 'NTQ'].includes(listingType)) return 'WATCH';
  return 'OTHER';
}

function catalogIdentityIssue(record) {
  const confirmation = confirmCatalogCandidate(record);
  if (confirmation.reason === 'CATALOG_BRAND_CONFLICT') return 'CATALOG_BRAND_CONFLICT';
  if (confirmation.confirmed && confirmation.dialConfirmed === false) return 'CATALOG_DIAL_CONFLICT';
  return null;
}

function isCustomerIdentitySafe(record) {
  return catalogIdentityIssue(record) === null;
}

function suppressUnverifiedImages(record) {
  return {
    ...record,
    has_images: false,
    thumbnail_url: null,
    image_urls: [],
    dealer_photos: [],
  };
}

function sanitizeTradingRecord(record, { verifiedImages = false } = {}) {
  const issues = [];
  const verifiedImageUrls = verifiedImages && Array.isArray(record.image_urls)
    ? record.image_urls.map(cleanText).filter(Boolean)
    : [];
  const verifiedThumbnail = verifiedImages ? cleanText(record.thumbnail_url) : null;
  const hasVerifiedImages = Boolean(verifiedThumbnail && verifiedImageUrls.length);
  const sanitized = verifiedImages
    ? {
        ...record,
        has_images: hasVerifiedImages,
        thumbnail_url: hasVerifiedImages ? verifiedThumbnail : null,
        image_urls: hasVerifiedImages ? verifiedImageUrls : [],
        dealer_photos: [],
      }
    : suppressUnverifiedImages(record);
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
    if (Number(record.price_raw) === price) sanitized.price_raw = null;
    issues.push('YEAR_TOKEN_AS_PRICE');
  }

  const identityIssue = catalogIdentityIssue(record);
  if (identityIssue) issues.push(identityIssue);
  if (!verifiedImages && (record.has_images || record.thumbnail_url || record.image_urls?.length)) {
    issues.push('IMAGE_VISUAL_VERIFICATION_REQUIRED');
  }

  const usdPrice = Number(sanitized.price_usd);
  if (sanitized.reference && Number.isFinite(usdPrice) && usdPrice > 0 && usdPrice < 1000) {
    sanitized.price_usd = null;
    sanitized.price_raw = null;
    issues.push('PRICE_BELOW_PLAUSIBILITY_FLOOR');
  }

  // ponytail: multi-listing unbundled children — suppress image, flag for recycle bin
  const rawFlags = Array.isArray(record?.flags) ? record.flags : [];
  const isMultiListing = rawFlags.includes('MULTI_LISTING') || rawFlags.includes('UNBUNDLED_CHILD')
    || /MANUAL_UNBUNDLE/i.test(String(record?.source || ''));

  if (isMultiListing && verifiedImages) {
    // Even verified images must be suppressed for multi-listing children — wrong-watch misattribution risk
    sanitized.has_images = false;
    sanitized.thumbnail_url = null;
    sanitized.image_urls = [];
    sanitized.dealer_photos = [];
    issues.push('MULTI_LISTING_IMAGE_SUPPRESSED');
  }

  return {
    ...sanitized,
    item_category: deriveItemCategory(record),
    multi_listing: isMultiListing,
    data_quality_issues: issues,
    data_quality_review_required: issues.length > 0,
  };
}

module.exports = {
  catalogIdentityIssue,
  deriveItemCategory,
  isCustomerIdentitySafe,
  isLikelyYearAsPrice,
  isPriceLike,
  isReferencePriceCollision,
  sanitizeTradingRecord,
  suppressUnverifiedImages,
};
