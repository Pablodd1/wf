'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260811170000_trading_floor_unconfirmed_source_price.sql'),
  'utf8',
);
const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('forward view labels retained bare-dollar evidence without promoting it to USD', () => {
  assert.match(migration, /currency_evidence = 'bare_dollar_unconfirmed'/);
  assert.match(migration, /THEN '\$' \|\| l\.price_normalized::text/);
  assert.match(migration, /WHEN l\.price_normalized > 0 AND l\.currency_normalized IS NULL[\s\S]*THEN 'CURRENCY_UNCONFIRMED'/);
  assert.match(migration, /WHEN l\.currency_normalized IN \('USD', 'USDT'\) AND l\.price_usd > 0[\s\S]*THEN 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(migration, /WHEN upper\(COALESCE\(l\.verdict, ''\)\) = 'APPROVED'[\s\S]*l\.currency_normalized IN \('USD', 'USDT'\)[\s\S]*THEN l\.price_usd/);
});

test('Trading Floor distinguishes currency-unconfirmed evidence from no supplied price', () => {
  assert.match(trading, /if \(sourceText\) return ambiguousPriceDisplay/);
  assert.match(trading, /if \(!currency\) return ambiguousPriceDisplay/);
  assert.doesNotMatch(trading, /if \(!currency\) return `USD /);
  assert.match(trading, /: \(sourcePrice \|\| ambiguousPriceDisplay\)/);
});

test('Trading Floor never relabels AP, RM, or Cartier bare-dollar amounts as USD', () => {
  const sourceTextIncludesCurrency = trading.match(
    /function sourceTextIncludesCurrency[\s\S]*?\n\}/,
  )?.[0].replace(/: string/g, '');
  const formatSourcePrice = trading.match(
    /function formatSourcePrice[\s\S]*?\n\}/,
  )?.[0].replace(/: ListingRecord/g, '');
  assert.ok(sourceTextIncludesCurrency && formatSourcePrice, 'price display helpers must remain inspectable');

  const cleanValue = value => {
    if (value == null) return '';
    const text = String(value).trim();
    return !text || /^(?:unknown|null)$/i.test(text) ? '' : text;
  };
  const formatter = Function(
    'cleanValue',
    'ambiguousPriceDisplay',
    `'use strict'; ${sourceTextIncludesCurrency}; ${formatSourcePrice}; return formatSourcePrice;`,
  )(cleanValue, 'Price requires review');

  for (const fixture of [
    { brand: 'Audemars Piguet', reference: '14370', source_price_amount: 6490, raw_message: '... $6,490' },
    { brand: 'Richard Mille', reference: 'RM029', source_price_amount: 64760, raw_message: '... $64,760' },
    { brand: 'Cartier', reference: 'WABB0049', source_price_amount: 28000, raw_message: '... $28,000' },
  ]) {
    const displayed = formatter({
      ...fixture,
      source_price_text: null,
      source_currency: null,
      currency: null,
      price_raw: fixture.source_price_amount,
    });
    assert.equal(displayed, 'Price requires review');
    assert.doesNotMatch(displayed, /\bUSD\b/);
  }
});
