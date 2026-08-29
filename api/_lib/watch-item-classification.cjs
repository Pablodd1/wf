'use strict';

const PART_TYPES = [
  ['Bezel', /\bbezel\b/i],
  ['Strap', /\bstrap\b/i],
  ['Bracelet', /\bbracelet\b/i],
  ['Clasp', /\bclasp\b/i],
  ['Buckle', /\bbuckle\b/i],
  ['Crystal', /\b(?:crystal|sapphire\s+glass|saphir\s+glass)\b/i],
  ['Movement', /\bmovement\b/i],
  ['Case back', /\b(?:case\s*back|caseback)\b/i],
  ['Dial', /\bdial\b/i],
  ['Links', /\b(?:end\s*links?|endlinks?|links?)\b/i],
];

const PART_NOUN = '(?:bezel|strap|bracelet|clasp|buckle|crystal|sapphire\\s+glass|saphir\\s+glass|movement|case\\s*back|caseback|dial|end\\s*links?|endlinks?|links?)';
const PART_FOR_REFERENCE = new RegExp(`\\b${PART_NOUN}\\s+(?:for|to\\s+fit|compatible\\s+with)\\s+(?:ref(?:erence)?[.#:\\s-]*)?[A-Z0-9]`, 'i');
const EXPLICIT_PART_SALE = new RegExp(`^\\s*(?:[^A-Z0-9]{0,8})?(?:(?:wts|fs|for\\s+sale|available)\\s*[:\\-]?\\s*)?(?:(?:new|used|oem|original|factory|aftermarket|spare|replacement|black|white|blue|green|red|brown|grey|gray|gold|rose|yellow|steel|stainless|titanium|ceramic|rubber|leather|diamond|fluted|smooth|jubilee|oyster)\\s+){0,6}${PART_NOUN}\\b`, 'i');
const WHOLE_WATCH_WITH_PART = /\b(?:watch|timepiece)\b[^\n.!?]{0,100}\b(?:on|with|including|includes|comes\s+with)\b[^\n.!?]{0,50}\b(?:strap|bracelet|clasp|buckle|bezel|dial|links?)\b/i;

function watchPartType(rawMessage) {
  return PART_TYPES.find(([, pattern]) => pattern.test(rawMessage))?.[0] || 'Watch accessory';
}

function classifyWatchPartListing(row = {}) {
  const category = String(row.item_category || row.category || '').trim().toUpperCase();
  if (category && !['WATCH', 'OTHER'].includes(category)) return null;
  const rawMessage = String(row.raw_message || row.raw_line || '').trim();
  if (!rawMessage || WHOLE_WATCH_WITH_PART.test(rawMessage)) return null;

  // Require both an explicit part-as-subject and a compatibility relationship
  // to a reference. This catches accessory listings such as "Black Ceramic
  // Bezel for 116500LN" without reclassifying a complete watch merely because
  // its configuration mentions a strap, bracelet, bezel, dial, or links.
  if (!EXPLICIT_PART_SALE.test(rawMessage) || !PART_FOR_REFERENCE.test(rawMessage)) return null;
  return {
    category: 'ACCESSORY',
    reason: 'WATCH_PART_ACCESSORY',
    item_type: watchPartType(rawMessage),
  };
}

module.exports = {
  classifyWatchPartListing,
};
