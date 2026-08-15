'use strict';

const MINT_DIAL_VALUES = new Set([
  'MINT',
  'MINT CONDITION',
  'MINT GREEN',
]);

function clean(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function hasMintCondition(rawText) {
  return /\bmint\b/i.test(String(rawText || ''));
}

function withoutConditionOnlyMintGreen(rawText) {
  return String(rawText || '').replace(/\bmint\s+green\b(?!\s+dial\b)/gi, 'mint');
}

function withoutNonDialGreenEvidence(rawText) {
  return String(rawText || '')
    .replace(/\bgreen\s+(?:card(?:s)?|tag(?:s)?|box(?:es)?|seal(?:s)?|sticker(?:s)?|bezel(?:s)?|strap(?:s)?|band(?:s)?|bracelet(?:s)?)\b/gi, ' ')
    .replace(/\b(?:card(?:s)?|tag(?:s)?|box(?:es)?|seal(?:s)?|sticker(?:s)?|bezel(?:s)?|strap(?:s)?|band(?:s)?|bracelet(?:s)?)\s+(?:is\s+)?green\b/gi, ' ');
}

function hasIndependentGreenEvidence(rawText) {
  const text = withoutNonDialGreenEvidence(withoutConditionOnlyMintGreen(rawText));
  return /(?:\bgreen\s+dial\b|\bdial\s*[:=-]?\s*green\b|\bgreen\b)/i.test(text);
}

function normalizeWatchCondition(condition, rawText) {
  if (hasMintCondition(rawText) || /\bmint\b/i.test(String(condition || ''))) {
    return 'Used - Like New';
  }
  return clean(condition);
}

function normalizeWatchDial(dialColor, rawText) {
  const dial = clean(dialColor);
  if (!dial) return null;
  const key = dial.toUpperCase().replace(/[_/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (MINT_DIAL_VALUES.has(key)) {
    return hasIndependentGreenEvidence(rawText) ? 'Green' : null;
  }
  // A known parser failure copied the condition word "mint" into a Green
  // dial. Keep Green only when the source independently says green after the
  // condition-only phrase "mint green" is masked.
  if (key === 'GREEN' && hasMintCondition(rawText) && !hasIndependentGreenEvidence(rawText)) {
    return null;
  }
  return dial;
}

function normalizeWatchConditionFields(row = {}) {
  const rawText = row.raw_message ?? row.rawText ?? row.raw_line ?? '';
  return {
    dial_color: normalizeWatchDial(row.dial_color ?? row.dialColor, rawText),
    condition: normalizeWatchCondition(row.condition, rawText),
    mint_condition_detected: hasMintCondition(rawText),
  };
}

module.exports = {
  hasIndependentGreenEvidence,
  hasMintCondition,
  normalizeWatchCondition,
  normalizeWatchConditionFields,
  normalizeWatchDial,
  withoutConditionOnlyMintGreen,
  withoutNonDialGreenEvidence,
};
