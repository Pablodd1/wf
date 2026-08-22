"use strict";

const FROZEN_FIVE = Object.freeze({
  "d7ca9584-c8d0-43a5-8e19-7cf3fc4473e2": Object.freeze({
    brand: "Zenith",
    reference: "95.9000.9004/78.M9000",
    originalAmount: 7170,
    originalCurrency: null,
    sourcePriceText: "7,170$",
    usdAmount: null,
    priceStatus: "BARE_DOLLAR_CURRENCY_UNVERIFIED",
    rawPattern: /(?:^|\D)7,?170\$(?!\w)/i,
  }),
  "0a6e7949-1717-4123-994c-17377f7e9ab8": Object.freeze({
    brand: "Tudor",
    reference: "79830RB",
    originalAmount: 2900,
    originalCurrency: "USD",
    sourcePriceText: "$2,900 USD",
    usdAmount: 2900,
    priceStatus: "SOURCE_EXPLICIT_USD_USDT",
    rawPattern: /\$\s*2,?900(?:\.00)?\s*USD\b/i,
  }),
  "5f11c5b4-bd08-4976-9a87-af1a9921a8a3": Object.freeze({
    brand: "Omega",
    reference: "310.60.42.50.01.001",
    originalAmount: 28000,
    originalCurrency: "USD",
    sourcePriceText: "USD 28k",
    usdAmount: 28000,
    priceStatus: "SOURCE_EXPLICIT_USD_USDT",
    rawPattern: /\bprice\s+usd\s+28k\b/i,
  }),
  "ec507bd1-9cfc-4be2-aaa4-3f0dd477af80": Object.freeze({
    brand: "Cartier",
    reference: "WSSA0039",
    originalAmount: 46400,
    originalCurrency: "HKD",
    sourcePriceText: "HKD 46,400 · USD 5,900",
    usdAmount: 5900,
    priceStatus: "SOURCE_EXPLICIT_USD_USDT",
    rawPattern: /\bHKD\s*46,?400\b[\s\S]*\bUSD\s*5,?900\b/i,
  }),
  "f125afdc-c21a-4450-a59b-01f3f667edb2": Object.freeze({
    brand: "Vacheron Constantin",
    reference: "7900V/110A-B546",
    originalAmount: 193000,
    originalCurrency: "HKD",
    sourcePriceText: "HKD 193,000 · USD 24,600",
    usdAmount: 24600,
    priceStatus: "SOURCE_EXPLICIT_USD_USDT",
    rawPattern: /\bHKD\s*193,?000\b[\s\S]*\bUSD\s*24,?600\b/i,
  }),
});

function referenceKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function frozenFiveDefinition(id) {
  return FROZEN_FIVE[String(id || "").toLowerCase()] || null;
}

function applyConfirmedFiveWatchPublication(record) {
  if (!record || typeof record !== "object") return record;
  const definition = frozenFiveDefinition(record.id);
  if (!definition) return record;
  const identityMatches = String(record.brand || record.canonical_brand || "").trim().toLowerCase()
      === definition.brand.toLowerCase()
    && referenceKey(record.reference || record.normalized_reference) === referenceKey(definition.reference);
  const rawMessage = String(record.raw_message || "");
  const evidenceMatches = identityMatches && definition.rawPattern.test(rawMessage);
  if (!evidenceMatches) {
    return {
      ...record,
      price_usd: null,
      verified_price_usd: null,
      has_verified_usd_price: false,
      price_research_eligible: false,
      price_evidence_status: "EXACT_SOURCE_EVIDENCE_MISMATCH_HELD",
      confirmed_data_publication: "EXACT_FIVE_EVIDENCE_MISMATCH_HELD",
    };
  }
  return {
    ...record,
    price_usd: definition.usdAmount,
    verified_price_usd: definition.usdAmount,
    has_verified_usd_price: definition.usdAmount !== null,
    price_raw: definition.originalAmount,
    currency: definition.originalCurrency,
    source_price_amount: definition.originalAmount,
    source_currency: definition.originalCurrency,
    source_price_text: definition.sourcePriceText,
    original_price_amount: definition.originalAmount,
    original_currency: definition.originalCurrency,
    price_evidence_status: definition.priceStatus,
    price_confirmation_note: definition.usdAmount === null
      ? "Exact source amount is present, but the dollar currency is not explicitly identified."
      : "USD amount is explicitly stated in this listing's exact raw source message.",
    confirmed_data_publication: "EXACT_FIVE_SOURCE_CONFIRMED_V1",
    seller_rating: null,
    seller_review_count: 0,
    seller_rating_evidence_status: "UNAVAILABLE",
    seller_phone: null,
    phone_number: null,
    contact_publication_approved: false,
  };
}

module.exports = {
  FROZEN_FIVE,
  applyConfirmedFiveWatchPublication,
  frozenFiveDefinition,
  referenceKey,
};
