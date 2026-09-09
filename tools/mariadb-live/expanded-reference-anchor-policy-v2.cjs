'use strict';

// Input is the parser's NFKC/Cf-stripped view. Offsets are UTF-16 offsets in
// that view; callers map them back to immutable original codepoint spans.
// These roles suppress reference anchors, not watches or source evidence.
const POLICY_VERSION = 'explicit-size-and-price-reference-anchors-v2';
const currencies = 'USD|USDT|HKD|EUR|EUROS?|GBP|AED|CHF|SGD|JPY|CNY|RMB|AUD|CAD|NZD|INR|THB|MYR|KRW|TWD|SAR|QAR|KWD|BHD|ZAR|BRL|MXN|PHP|IDR|VND|TRY|DKK|NOK|SEK';
const number = '\\d[\\d.,]*(?:[ \\t]*[KM])?';
const askPrefix = '^[ \\t*_]*(?:(?:asking(?:[ \\t]+price)?|price|ask)[ \\t]*[:=-]?[ \\t]*)?';
const priceEnd = '[ \\t*_]*[.!]?[ \\t*_]*$';
const suffixPrice = new RegExp(askPrefix + '(' + number + ')[ \\t]+(' + currencies + '|\\$)' + priceEnd, 'i');
const prefixPrice = new RegExp(askPrefix + '(' + currencies + '|\\$)[ \\t]*(' + number + ')' + priceEnd, 'i');
const sellingWithFee = new RegExp('^[ \\t*_]*selling[ \\t]*:[ \\t]*(' + number + ')[ \\t]*\\+[ \\t]*(?:label|shipping)(?=$|[^\\p{L}\\p{N}])', 'iu');

function nonReferenceAnchors(text) {
  const found = [];
  // A whole short dimension token is different from a complete reference such
  // as 26585CM. Do not match a suffix or component inside a longer identifier.
  const dimensions = /(?<![\p{L}\p{N}./-])\d{1,3}(?:[.,]\d{1,2})?[ \t]*(?:mm|cm)(?![\p{L}\p{N}./-])/giu;
  for (const match of text.matchAll(dimensions)) found.push({
    start: match.index, end: match.index + match[0].length,
    reason: 'EXPLICIT_PHYSICAL_DIMENSION_NOT_REFERENCE', quote: match[0],
  });
  for (const line of text.matchAll(/[^\r\n\u2028\u2029]+/g)) {
    const sale = sellingWithFee.exec(line[0]);
    if (sale) {
      const start = line.index + sale[0].indexOf(sale[1]);
      found.push({ start, end: start + sale[1].length,
        reason: 'EXPLICIT_SELLING_AMOUNT_PLUS_DELIVERY_NOT_REFERENCE',
        quote: sale[1], raw_number: /\d[\d.,]*/.exec(sale[1])[0],
        had_multiplier: /[KM]$/i.test(sale[1]),
        currency: null, price_role: 'EXPLICIT_ASK', explicit_sale_role: true,
      });
    }
    // Whole price lines only: '216570 EUR 9500' and 'Ref: 9500 EUR' cannot
    // reclassify an identifier merely because a currency appears next to it.
    const suffix = suffixPrice.exec(line[0]);
    const prefix = !suffix && prefixPrice.exec(line[0]);
    const price = suffix || prefix;
    if (price) {
      const amountToken = suffix ? price[1] : price[2];
      const currencyToken = suffix ? price[2] : price[1];
      const start = line.index + price[0].indexOf(price[1]);
      const end = line.index + price[0].lastIndexOf(price[2]) + price[2].length;
      found.push({ start, end, reason: 'STANDALONE_AMOUNT_CURRENCY_NOT_REFERENCE',
        quote: text.slice(start, end), raw_number: /\d[\d.,]*/.exec(amountToken)[0],
        had_multiplier: /[KM]$/i.test(amountToken),
        currency: currencyToken === '$' ? null : /^EUROS?$/i.test(currencyToken) ? 'EUR' : currencyToken.toUpperCase(),
        ambiguous_dollar: currencyToken === '$',
        price_role: /\b(?:asking|price|ask)\b/i.test(price[0].slice(0, price[0].indexOf(price[1]))) ? 'EXPLICIT_ASK' : 'UNLABELLED',
        explicit_sale_role: /\basking\b/i.test(price[0].slice(0, price[0].indexOf(price[1]))),
      });
    }
  }
  return found.sort((a, b) => a.start - b.start || a.end - b.end);
}

module.exports = { POLICY_VERSION, nonReferenceAnchors };
