'use strict';

const { confirmCatalogCandidate, rawSupportsExactReference } = require('./catalog-confirmation.cjs');

const REVIEW_FIELDS = [
  'brand',
  'model',
  'reference',
  'dialColor',
  'condition',
  'year',
  'price',
  'currency',
  'listingType',
];

const EMPTY_VALUES = new Set(['', 'UNKNOWN', 'UNRESOLVED', 'UNVERIFIED', '[NULL]', 'NULL']);

function cleanValue(value, maxLength = 240) {
  if (value == null) return null;
  const cleaned = String(value).trim().slice(0, maxLength);
  return EMPTY_VALUES.has(cleaned.toUpperCase()) ? null : cleaned || null;
}

function folded(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function compact(value) {
  return folded(value).replace(/[^A-Z0-9]/g, '');
}

function exactEvidencePresent(rawMessage, evidenceQuote) {
  const raw = folded(rawMessage);
  const quote = folded(evidenceQuote);
  return Boolean(raw && quote && quote.length >= 2 && raw.includes(quote));
}

function currencyMarkerSupported(value, evidenceQuote) {
  const currency = cleanValue(value, 12)?.toUpperCase();
  const quote = folded(evidenceQuote);
  if (!currency || !quote) return false;
  const currencyCode = currency.replace(/[^A-Z0-9]/g, '');
  if (currencyCode.length < 3) return false;
  const markers = {
    USD: [/\bUSD\b/u, /\bUS\$/u],
    USDT: [/\bUSDT\b/u],
    USDC: [/\bUSDC\b/u],
    HKD: [/\bHKD\b/u, /\bHDK\b/u, /HK\$/u, /\$HK\b/u],
    EUR: [/\bEUR\b/u, /€/u],
    GBP: [/\bGBP\b/u, /£/u],
    CHF: [/\bCHF\b/u],
    JPY: [/\bJPY\b/u],
    CNY: [/\bCNY\b/u, /\bRMB\b/u],
    RMB: [/\bRMB\b/u, /\bCNY\b/u],
    SGD: [/\bSGD\b/u, /(?:^|[^A-Z])S\$/u],
    AED: [/\bAED\b/u],
    CAD: [/\bCAD\b/u, /(?:^|[^A-Z])C\$/u],
    AUD: [/\bAUD\b/u, /(?:^|[^A-Z])A\$/u],
  };
  return (markers[currency] || [new RegExp(`\\b${currencyCode}\\b`, 'u')])
    .some(pattern => pattern.test(quote));
}

function valueIsExplicitlySupported(field, value, evidenceQuote) {
  const cleanedValue = cleanValue(value);
  if (!cleanedValue) return false;
  if (field === 'currency') return currencyMarkerSupported(cleanedValue, evidenceQuote);
  if (field === 'reference') return compact(evidenceQuote).includes(compact(cleanedValue));
  if (field === 'price' || field === 'year') {
    const valueDigits = cleanedValue.replace(/\D/g, '');
    const quoteDigits = String(evidenceQuote || '').replace(/\D/g, '');
    return Boolean(valueDigits && quoteDigits.includes(valueDigits));
  }
  return folded(evidenceQuote).includes(folded(cleanedValue));
}

function normalizeAiSuggestions(rawMessage, suggestions) {
  const byField = new Map();
  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const field = REVIEW_FIELDS.includes(String(suggestion?.field)) ? String(suggestion.field) : null;
    if (!field || byField.has(field)) continue;
    const value = cleanValue(suggestion?.value);
    const evidenceQuote = cleanValue(suggestion?.evidenceQuote, 1000);
    const evidencePresent = exactEvidencePresent(rawMessage, evidenceQuote);
    const valueSupported = evidencePresent && valueIsExplicitlySupported(field, value, evidenceQuote);
    let status = 'MISSING';
    if (value) status = valueSupported ? 'RAW_SUPPORTED' : 'NEEDS_REVIEW';
    if (field === 'price' && value) status = 'NEEDS_REVIEW';
    if (field === 'currency' && value && !currencyMarkerSupported(value, evidenceQuote)) {
      status = 'AMBIGUOUS';
    }
    byField.set(field, {
      field,
      value,
      status,
      support: 'RAW_MESSAGE',
      evidenceQuote: evidencePresent ? evidenceQuote : null,
      reason: cleanValue(suggestion?.reason, 600)
        || (valueSupported ? 'The value and exact evidence appear in the preserved listing.' : 'The value is not directly supported by an exact raw-message quote.'),
      applicable: valueSupported && field !== 'price',
    });
  }
  for (const field of REVIEW_FIELDS) {
    if (!byField.has(field)) {
      byField.set(field, {
        field,
        value: null,
        status: 'MISSING',
        support: 'RAW_MESSAGE',
        evidenceQuote: null,
        reason: 'No explicit raw-message evidence was found.',
        applicable: false,
      });
    }
  }
  return [...byField.values()];
}

function catalogSuggestions(rawMessage, currentGuess) {
  const reference = cleanValue(currentGuess?.reference, 80);
  const brand = cleanValue(currentGuess?.brand, 80);
  const dialColor = cleanValue(currentGuess?.dialColor, 80);
  if (!reference || !rawSupportsExactReference(rawMessage, reference)) {
    return { suggestions: [], evidence: null };
  }

  const confirmation = confirmCatalogCandidate({
    brand,
    reference,
    dial_color: dialColor,
  });
  if (!confirmation.confirmed || !confirmation.match) {
    return {
      suggestions: [],
      evidence: {
        confirmed: false,
        reason: confirmation.reason || 'CATALOG_NOT_CONFIRMED',
      },
    };
  }

  const match = confirmation.match;
  const evidenceLabel = `Exact catalog match (${match.matchType || 'verified'}) for raw reference ${reference}`;
  const suggestions = [];
  const add = (field, value, reason) => {
    const cleaned = cleanValue(value, 160);
    if (!cleaned) return;
    suggestions.push({
      field,
      value: cleaned,
      status: 'CATALOG_SUPPORTED',
      support: 'CATALOG',
      evidenceQuote: evidenceLabel,
      reason,
      applicable: true,
    });
  };

  add('brand', match.brand || brand, 'The exact raw reference resolves to this catalog brand.');
  add('reference', reference, 'The reference is present in the raw listing and has an exact catalog match.');
  add('model', match.model || match.collection, 'The exact catalog reference supplies the model identity.');

  if (dialColor && confirmation.dialConfirmed) {
    add('dialColor', confirmation.canonicalDial || dialColor, 'The observed dial agrees with the exact catalog configuration.');
  } else if (!dialColor && Array.isArray(match.dialColors) && match.dialColors.length === 1) {
    add('dialColor', match.dialColors[0], 'This exact catalog reference has one catalog dial configuration; the reviewer must still verify the listing or source image.');
  }

  return {
    suggestions,
    evidence: {
      confirmed: true,
      reference: match.reference || reference,
      rawReference: reference,
      brand: match.brand || brand,
      model: match.model || match.collection || null,
      dialColors: match.dialColors || [],
      matchType: match.matchType || null,
      source: match.source || null,
    },
  };
}

function summarizeAssistance(rawMessage, currentGuess, aiSuggestions) {
  const normalizedAi = normalizeAiSuggestions(rawMessage, aiSuggestions);
  const catalog = catalogSuggestions(rawMessage, currentGuess);
  const suggestions = [...normalizedAi, ...catalog.suggestions];
  const current = Object.fromEntries(REVIEW_FIELDS.map(field => [field, cleanValue(currentGuess?.[field])]));
  const fillableFields = REVIEW_FIELDS.filter(field =>
    !current[field] && suggestions.some(suggestion => suggestion.field === field && suggestion.applicable));
  const unresolvedFields = REVIEW_FIELDS.filter(field =>
    !current[field] && !suggestions.some(suggestion => suggestion.field === field && suggestion.applicable));
  return {
    suggestions,
    fillableFields,
    unresolvedFields,
    catalogEvidence: catalog.evidence,
  };
}

module.exports = {
  REVIEW_FIELDS,
  catalogSuggestions,
  currencyMarkerSupported,
  exactEvidencePresent,
  normalizeAiSuggestions,
  summarizeAssistance,
  valueIsExplicitlySupported,
};
