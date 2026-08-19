'use strict';

const PUBLIC_SELL_INTENTS = new Set(['WTS', 'LTS', 'LQT', 'LTQ', 'SELL', 'SELLING', 'FOR SALE', 'AVAILABLE', 'FS']);
const PUBLIC_BUY_INTENTS = new Set(['WTB', 'LTB', 'NTQ', 'BUY', 'BUYING', 'WANT', 'WANTED', 'LOOKING FOR', 'LOOKING TO BUY', 'ISO', 'NEED']);

const RAW_WTS = /\b(?:WTS|LTS|LQT|LTQ|FS|SELL(?:ING)?|WANT(?:ING)?\s+TO\s+SELL|FOR\s+SALE|AVAILABLE)\b/i;
const RAW_WTB = /\b(?:WTB|LTB|NTQ|ISO|NEED(?:ED)?|WANTED|WANT(?:ING)?\s+TO\s+BUY|LOOKING\s+(?:FOR|TO\s+BUY)|SEEKING(?:\s+TO\s+BUY)?)\b/i;

function cleanIntent(value) {
  return String(value || '').trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizedStructuredIntent(value) {
  const intent = cleanIntent(value);
  if (PUBLIC_SELL_INTENTS.has(intent)) return 'WTS';
  if (PUBLIC_BUY_INTENTS.has(intent)) return 'WTB';
  return null;
}

function explicitRawIntent(rawMessage) {
  const raw = String(rawMessage || '');
  const wts = RAW_WTS.test(raw);
  const wtb = RAW_WTB.test(raw);
  if (wts && wtb) return { intent: null, status: 'CONFLICT' };
  if (wts) return { intent: 'WTS', status: 'EXPLICIT' };
  if (wtb) return { intent: 'WTB', status: 'EXPLICIT' };
  return { intent: null, status: 'MISSING' };
}

/**
 * Resolve only the customer-facing Trading Floor intent. This never changes
 * immutable source data and never grants Price Research eligibility.
 *
 * Owner fallback is deliberately restricted to already customer-eligible,
 * single-watch observations. Conflicting raw intent, multi-item records, and
 * non-watch rows remain unresolved instead of being guessed.
 */
function resolveTradingIntent({
  rawMessage,
  structuredIntent,
  hasSourcePrice = false,
  eligibleSingleWatch = false,
} = {}) {
  const originalIntent = cleanIntent(structuredIntent) || null;
  const rawIntent = explicitRawIntent(rawMessage);
  if (rawIntent.status === 'CONFLICT') {
    return {
      intent: originalIntent || 'OTHER',
      original_intent: originalIntent,
      provenance: 'SOURCE_RAW_INTENT_CONFLICT',
      inferred: false,
      review_reason: 'RAW_WTS_WTB_CONFLICT',
    };
  }
  if (rawIntent.intent) {
    return {
      intent: rawIntent.intent,
      original_intent: originalIntent,
      provenance: 'SOURCE_RAW_EXPLICIT_INTENT',
      inferred: false,
      review_reason: originalIntent && normalizedStructuredIntent(originalIntent) !== rawIntent.intent
        ? 'RAW_INTENT_OVERRIDES_STRUCTURED_INTENT'
        : null,
    };
  }

  const normalizedStructured = normalizedStructuredIntent(originalIntent);
  if (normalizedStructured) {
    return {
      intent: normalizedStructured,
      original_intent: originalIntent,
      provenance: 'SOURCE_STRUCTURED_INTENT',
      inferred: false,
      review_reason: null,
    };
  }

  if (eligibleSingleWatch) {
    return {
      intent: hasSourcePrice ? 'WTS' : 'WTB',
      original_intent: originalIntent,
      provenance: 'OWNER_MISSING_INTENT_FALLBACK_V1',
      inferred: true,
      review_reason: hasSourcePrice
        ? 'MISSING_INTENT_PRICE_PRESENT_ASSUMED_WTS'
        : 'MISSING_INTENT_UNPRICED_ASSUMED_WTB',
    };
  }

  return {
    intent: originalIntent || 'OTHER',
    original_intent: originalIntent,
    provenance: 'UNRESOLVED_INTENT',
    inferred: false,
    review_reason: 'NON_SINGLE_WATCH_INTENT_NOT_INFERRED',
  };
}

function isPublicTradingIntent(value) {
  return ['WTS', 'WTB'].includes(cleanIntent(value));
}

// WTS/WTB filters must read unresolved source intents too, then apply the
// owner fallback after mapping. Passing the filter into a database/RPC would
// otherwise permanently skip those rows. MULTI/OTHER remain exact lanes.
function databaseTradingIntentFilter(value) {
  const intent = cleanIntent(value);
  return ['WTS', 'WTB'].includes(intent) ? null : (intent || null);
}

module.exports = {
  databaseTradingIntentFilter,
  explicitRawIntent,
  isPublicTradingIntent,
  normalizedStructuredIntent,
  resolveTradingIntent,
};
