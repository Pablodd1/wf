'use strict';

const crypto = require('node:crypto');

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function stripChatEnvelope(value) {
  return normalizedText(value)
    .replace(/^\s*\[[^\]]{3,100}\]\s*\+?\d[\d\s()-]{7,18}\s*:\s*/i, '')
    .replace(/^\s*\+?\d[\d\s()-]{7,18}\s*:\s*/i, '')
    .trim();
}

function stripDateTokens(value) {
  return stripChatEnvelope(value)
    .replace(/\b(?:N|NEW\s*)?(?:0?[1-9]|1[0-2])[\/.](?:20)?\d{2}\b/gi, '<DATE>')
    .replace(/\b(?:19|20)\d{2}\s*[Y年]?\b/gi, '<YEAR>')
    .replace(/\b(?:0?[1-9]|[12]\d|3[01])[\/.](?:0?[1-9]|1[0-2])[\/.](?:19|20)?\d{2}\b/g, '<DATE>')
    .replace(/\s+/g, ' ')
    .trim();
}

function verifiedDealerIdentity(row) {
  const explicit = compact(row.seller_phone || row.seller_id || row.dealer_id);
  if (explicit) return explicit;
  const phone = String(row.raw_message || '').match(/\+\d[\d\s()-]{7,18}/)?.[0];
  if (phone) return phone.replace(/\D/g, '');
  return '';
}

function dealerIdentity(row) {
  const verified = verifiedDealerIdentity(row);
  if (verified) return verified;
  return compact(row.seller_name);
}

function sourceIdentity(row) {
  return dealerIdentity(row) || compact(row.source || row.source_type || '');
}

function priceBucket(value, tolerance = 0.005) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return '';
  const step = Math.max(1, Math.round(price * tolerance));
  return String(Math.round(price / step) * step);
}

function listingIdentity(row, options = {}) {
  const includePrice = options.includePrice !== false;
  const includeSource = options.includeSource !== false;
  const parts = [
    compact(row.brand),
    compact(row.reference),
    compact(row.dial_color),
    compact(row.condition),
    compact(row.listing_type),
  ];
  if (includeSource) parts.unshift(sourceIdentity(row));
  if (includePrice) parts.push(priceBucket(row.price_usd));
  return parts.join('|');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function signaturesFor(row) {
  const raw = stripChatEnvelope(row.raw_message);
  const dateAgnosticRaw = stripDateTokens(row.raw_message);
  return {
    exactRaw: raw ? hash(raw) : '',
    dateAgnosticRaw: dateAgnosticRaw ? hash(dateAgnosticRaw) : '',
    exactListing: listingIdentity(row),
    configuration: listingIdentity(row, { includePrice: false }),
    marketConfiguration: listingIdentity(row, { includePrice: false, includeSource: false }),
  };
}

function priceDifferencePercent(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
  return Math.abs(left - right) / Math.max(left, right);
}

function classifyPair(canonical, candidate) {
  const a = signaturesFor(canonical);
  const b = signaturesFor(candidate);
  // Never treat the generic ingestion source (for example MYSQL_RAW) as dealer
  // identity. Automatic suppression requires a real phone/dealer identifier.
  const canonicalDealer = verifiedDealerIdentity(canonical);
  const candidateDealer = verifiedDealerIdentity(candidate);
  const sameDealer = canonicalDealer && canonicalDealer === candidateDealer;
  const sameConfig = a.configuration && a.configuration === b.configuration;
  const sameMarketConfig = a.marketConfiguration && a.marketConfiguration === b.marketConfiguration;
  const priceDelta = priceDifferencePercent(canonical.price_usd, candidate.price_usd);

  if (a.exactRaw && a.exactRaw === b.exactRaw) {
    return { type: 'EXACT_RAW_MESSAGE', confidence: sameDealer ? 1 : 0.8, suppressFromAnalytics: Boolean(sameDealer) };
  }
  if (a.dateAgnosticRaw && a.dateAgnosticRaw === b.dateAgnosticRaw) {
    return { type: 'DATE_SHIFTED_REPOST', confidence: sameDealer ? 0.97 : 0.82, suppressFromAnalytics: Boolean(sameDealer) };
  }
  if (a.exactListing && a.exactListing === b.exactListing) {
    return { type: 'EXACT_LISTING', confidence: sameDealer ? 0.99 : 0.75, suppressFromAnalytics: Boolean(sameDealer) };
  }
  if (sameConfig && sameDealer && priceDelta !== null && priceDelta <= 0.01) {
    return { type: 'LIKELY_REPOST', confidence: 0.92, suppressFromAnalytics: false };
  }
  if (sameConfig && sameDealer && priceDelta !== null && priceDelta > 0.01) {
    return { type: 'PRICE_UPDATE_REPOST', confidence: 0.9, suppressFromAnalytics: false };
  }
  if (sameMarketConfig && !sameDealer) {
    return { type: 'POSSIBLE_SHARED_INVENTORY', confidence: 0.55, suppressFromAnalytics: false };
  }
  return null;
}

module.exports = {
  classifyPair,
  compact,
  dealerIdentity,
  verifiedDealerIdentity,
  hash,
  listingIdentity,
  normalizedText,
  priceDifferencePercent,
  signaturesFor,
  sourceIdentity,
  stripChatEnvelope,
  stripDateTokens,
};
