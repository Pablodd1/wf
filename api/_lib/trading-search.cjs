'use strict';

const DIAL_WORDS = new Set([
  'black', 'blue', 'brown', 'champagne', 'chocolate', 'green', 'grey', 'gray',
  'lavender', 'orange', 'pink', 'purple', 'red', 'salmon', 'silver', 'sundust',
  'tiffany', 'white', 'yellow',
]);

function parseTradingSearch(input) {
  const tokens = String(input || '').replace(/[(),]/g, ' ').replace(/[%*]/g, '').trim().split(/\s+/).filter(Boolean);
  const referenceIndex = tokens.findIndex(token => /\d/.test(token));
  const dialIndex = tokens.findIndex(token => DIAL_WORDS.has(token.toLowerCase()));
  const reference = referenceIndex >= 0 ? tokens[referenceIndex] : '';
  const dial = dialIndex >= 0 ? tokens[dialIndex] : '';
  const brand = tokens.filter((_, index) => index !== referenceIndex && index !== dialIndex).join(' ');
  return { brand, reference, dial };
}

module.exports = { parseTradingSearch };
