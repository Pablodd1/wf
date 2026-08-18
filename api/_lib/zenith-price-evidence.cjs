'use strict';

const { extractPriceObservations } = require('./normalization-v4.cjs');

function observationContext(rawMessage, rawPriceText, startAt = 0) {
  const raw = String(rawMessage || '');
  const token = String(rawPriceText || '');
  const index = token ? raw.indexOf(token, startAt) : -1;
  const before = index >= 0 ? raw.slice(Math.max(0, index - 48), index) : '';
  return {
    index,
    before,
    retail: /(?:retail|list\s*price|msrp|rrp)\s*[:=-]?\s*$/i.test(before),
    preferred: /(?:my\s*price|here\s*for|discount(?:ed)?|asking|ask|price)\s*[:=-]?\s*$/i.test(before),
  };
}

function selectZenithPriceEvidence(rawMessage) {
  // Heavy dollar is an explicit dollar glyph in dealer messages. Other emoji
  // remain untouched and therefore unresolved rather than guessed.
  const parsingText = String(rawMessage || '').replace(/💲/gu, '$');
  const observations = extractPriceObservations(parsingText, {});
  if (!observations.length) return null;

  let cursor = 0;
  const candidates = observations.map(observation => {
    const context = observationContext(parsingText, observation.raw_price_text, cursor);
    if (context.index >= 0) cursor = context.index + String(observation.raw_price_text || '').length;
    return { ...observation, ...context };
  });
  const nonRetail = candidates.filter(candidate => !candidate.retail);
  const preferred = nonRetail.filter(candidate => candidate.preferred);
  const directUsd = nonRetail.filter(candidate => ['USD', 'USDT'].includes(candidate.currency_original));
  const selected = preferred.at(-1) || directUsd.at(-1) || nonRetail.at(-1) || candidates[0];

  return {
    amount_original: selected.amount_original,
    currency_original: selected.currency_original,
    currency_evidence: selected.currency_evidence,
    raw_price_text: selected.raw_price_text,
  };
}

module.exports = { selectZenithPriceEvidence };
