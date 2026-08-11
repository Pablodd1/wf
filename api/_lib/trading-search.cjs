'use strict';

const DIAL_WORDS = new Set([
  'black', 'blue', 'brown', 'champagne', 'chocolate', 'green', 'grey', 'gray',
  'lavender', 'orange', 'pink', 'purple', 'red', 'salmon', 'silver', 'sundust',
  'tiffany', 'white', 'yellow',
]);

const CONDITION_WORDS = new Set([
  'new', 'used', 'unworn', 'mint', 'excellent', 'fair', 'vintage',
]);

const COMPLETENESS_WORDS = new Set([
  'complete', 'fullset', 'full-set', 'box', 'papers', 'b&p', 'bp',
]);

function isProductionYear(token) {
  return /^\d{4}$/.test(token) && Number(token) >= 1950 && Number(token) <= 2030;
}

function looksLikeReference(token) {
  if (!/\d/.test(token) || isProductionYear(token)) return false;
  return /[a-z]/i.test(token) || /[\/-]/.test(token) || /^\d{5,}$/.test(token);
}

function parseTradingSearch(input) {
  const tokens = String(input || '').replace(/[(),]/g, ' ').replace(/[%*]/g, '').trim().split(/\s+/).filter(Boolean);
  const referenceIndex = tokens.findIndex(looksLikeReference);
  const dialIndex = tokens.findIndex(token => DIAL_WORDS.has(token.toLowerCase()));
  const yearIndex = tokens.findIndex(isProductionYear);
  const conditionIndex = tokens.findIndex(token => CONDITION_WORDS.has(token.toLowerCase()));
  const completenessIndexes = tokens
    .map((token, index) => COMPLETENESS_WORDS.has(token.toLowerCase()) ? index : -1)
    .filter(index => index >= 0);
  const reference = referenceIndex >= 0 ? tokens[referenceIndex] : '';
  const dial = dialIndex >= 0 ? tokens[dialIndex] : '';
  const year = yearIndex >= 0 ? tokens[yearIndex] : '';
  const condition = conditionIndex >= 0 ? tokens[conditionIndex] : '';
  const excluded = new Set([referenceIndex, dialIndex, yearIndex, conditionIndex, ...completenessIndexes]);
  const brand = tokens.filter((_, index) => !excluded.has(index)).join(' ');
  const completeness = completenessIndexes.map(index => tokens[index]).join(' ');
  return { brand, reference, dial, year, condition, completeness };
}

module.exports = { isProductionYear, looksLikeReference, parseTradingSearch };
