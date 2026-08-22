'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decodeNumericUnicode,
  extractPriceObservations,
  hasUnresolvedEmojiPrice,
  inferBrandFromReference,
  parseNumber,
  segmentDealerMessage,
  splitMessageLines,
} = require('../api/_lib/normalization-v4.cjs');

test('does not use a slash date as a Patek reference', () => {
  const raw = 'NEW PP5269R Blue 2024/5 HKD449k';
  const candidates = segmentDealerMessage(raw);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reference, '5269R');
  assert.equal(candidates[0].prices[0].amount_original, 449000);
  assert.equal(candidates[0].prices[0].currency_original, 'HKD');
});

test('decodes standard keycap and full-width digits without changing other emoji', () => {
  assert.equal(decodeNumericUnicode('HKD 1\uFE0F\u20E32\uFE0F\u20E35\uFE0F\u20E3K \u{1F525}'), 'HKD 125K \u{1F525}');
  assert.equal(decodeNumericUnicode('HKD \uFF11\uFF12\uFF15K'), 'HKD 125K');
});

test('parses keycap prices but preserves the exact raw price evidence', () => {
  const prices = extractPriceObservations('126500 White HKD 1\uFE0F\u20E32\uFE0F\u20E35\uFE0F\u20E3K');
  assert.equal(prices.length, 1);
  assert.equal(prices[0].amount_original, 125_000);
  assert.equal(prices[0].currency_original, 'HKD');
  assert.equal(prices[0].raw_price_text, 'HKD 1\uFE0F\u20E32\uFE0F\u20E35\uFE0F\u20E3K');
});

test('routes private emoji price codes to review instead of guessing a value', () => {
  assert.equal(hasUnresolvedEmojiPrice('126500 White HKD \u{1F525}\u{1F4B0}'), true);
  assert.equal(hasUnresolvedEmojiPrice('126500 White \u{1F525} HKD 125K'), false);
  assert.equal(hasUnresolvedEmojiPrice('126500 White \u{1F525}'), false);
});

test('inherits HKD for bare dollar prices under an HKD section', () => {
  const candidates = segmentDealerMessage(`
Brand New Rolex
HKD ~ Without Box
126500 White N5/26 $283000
126610LN N6/26 $114000
  `);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].context.brand_context, 'Rolex');
  assert.equal(candidates[0].context.currency_context, 'HKD');
  assert.equal(candidates[0].prices[0].currency_original, 'HKD');
  assert.equal(candidates[0].prices[0].amount_original, 283000);
});

test('defaults a bare dollar sign to USD and preserves policy provenance', () => {
  const prices = extractPriceObservations('126500 White $283000', {});
  assert.equal(prices.length, 1);
  assert.equal(prices[0].amount_original, 283000);
  assert.equal(prices[0].currency_original, 'USD');
  assert.equal(prices[0].currency_evidence, 'usd_defaulted_by_policy');
});

test('defaults suffix dollar and unsupplied numeric asking amounts to USD', () => {
  for (const [message, expected] of [['116688 $37k', 37000], ['336935 60000$', 60000], ['126500 18,000', 18000]]) {
    const prices = extractPriceObservations(message, {});
    assert.equal(prices.at(-1).amount_original, expected, message);
    assert.equal(prices.at(-1).currency_original, 'USD', message);
  }
});

test('recognizes the euro banknote emoji as explicit EUR price evidence', () => {
  for (const raw of ['💶 3900', '3900 💶']) {
    const prices = extractPriceObservations(raw);
    assert.equal(prices.length, 1, raw);
    assert.equal(prices[0].amount_original, 3900, raw);
    assert.equal(prices[0].currency_original, 'EUR', raw);
    assert.equal(prices[0].currency_evidence, 'explicit_line_currency', raw);
  }
});

test('parses Chinese HKD labels and ten-thousand multipliers without a USD fallback', () => {
  const prices = extractPriceObservations('220\u4e07\u6e2f\u5e01');
  assert.equal(prices.length, 1);
  assert.equal(prices[0].amount_original, 2_200_000);
  assert.equal(prices[0].currency_original, 'HKD');
  assert.equal(prices[0].currency_evidence, 'explicit_line_currency');
});

test('normalizes explicit HDK typo markers before and after the amount', () => {
  const prefix = extractPriceObservations('HDK 380K');
  const suffix = extractPriceObservations('380K HDK');
  for (const prices of [prefix, suffix]) {
    assert.equal(prices.length, 1);
    assert.equal(prices[0].amount_original, 380_000);
    assert.equal(prices[0].currency_original, 'HKD');
    assert.equal(prices[0].amount_usd, 48_718);
    assert.equal(prices[0].currency_evidence, 'explicit_line_currency');
  }
});

test('parses explicit mil, mill, and million multipliers on either side of HKD', () => {
  const cases = [
    ['HKD 380 mil', 380_000],
    ['380 mil HKD', 380_000],
    ['HKD 1.2 mill', 1_200_000],
    ['1.2 million HKD', 1_200_000],
  ];

  for (const [raw, expected] of cases) {
    const prices = extractPriceObservations(raw);
    assert.equal(prices.length, 1, raw);
    assert.equal(prices[0].amount_original, expected, raw);
    assert.equal(prices[0].currency_original, 'HKD', raw);
  }
});

test('defaults unlabelled numeric multiplier asking prices to USD', () => {
  for (const [raw, expected] of [['380 mil', 380000], ['1.2 million', 1200000]]) {
    const prices = extractPriceObservations(raw);
    assert.equal(prices[0].amount_original, expected);
    assert.equal(prices[0].currency_original, 'USD');
    assert.equal(prices[0].currency_evidence, 'usd_defaulted_by_policy');
  }
});

test('inherits Chinese HKD section context for bare dollar prices', () => {
  const candidates = segmentDealerMessage('\u6e2f\u5e01\n126500 White N5/26 $283000');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].context.currency_context, 'HKD');
  assert.equal(candidates[0].prices[0].currency_original, 'HKD');
  assert.equal(candidates[0].prices[0].amount_original, 283_000);
});

test('recognizes HDK as a Hong Kong dollar typo without defaulting to USD', () => {
  const prices = extractPriceObservations('4200H HDK 380K');
  assert.equal(prices.length, 1);
  assert.equal(prices[0].currency_original, 'HKD');
  assert.equal(prices[0].amount_usd, 48718);
});

test('preserves explicit HKD and USD equivalents', () => {
  const prices = extractPriceObservations('105,000HK$/13,500US$');
  assert.deepEqual(prices.map(price => [price.amount_original, price.currency_original]), [
    [105000, 'HKD'],
    [13500, 'USD'],
  ]);
});

test('selects the explicit discounted asking price and retains retail metadata', () => {
  const prices = extractPriceObservations('86,800 -30% = 60,760HK$');
  assert.equal(prices[0].amount_original, 60760);
  assert.equal(prices[0].currency_original, 'HKD');
  assert.equal(prices[0].retail_price, 86800);
  assert.equal(prices[0].discount_percent, 30);
});

test('repairs malformed thousands separators', () => {
  assert.equal(parseNumber('2.070,000'), 2070000);
  assert.equal(parseNumber('1.58', 'm'), 1580000);
});

test('splits inventory bundles and carries brand context', () => {
  const candidates = segmentDealerMessage(`
_Rolex_
126539TBR 01/2026 New 1,168,000HK$/149,700US$
126515 Sundust 04/2025 New 368,000HK$/47,200US$
_PP_
5990/1R 7/2026 new full set hkd 2.54m
  `);

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].context.brand_context, 'Rolex');
  assert.equal(candidates[2].context.brand_context, 'Patek Philippe');
  assert.equal(candidates[2].prices[0].amount_original, 2540000);
});

test('splits emoji-bullet inventory lines before assigning prices', () => {
  const candidates = segmentDealerMessage('🚀 5712/1R 5/2025 NEW HKD 1.73m 🚀 5303R 5/2025 NEW 1.05m usdt');
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].reference, '5712/1R');
  assert.equal(candidates[0].prices[0].amount_original, 1_730_000);
  assert.equal(candidates[1].reference, '5303R');
  assert.equal(candidates[1].prices[0].amount_original, 1_050_000);
});

test('preserves unresolved price emoji on the listing line', () => {
  const raw = '126500LN White HKD 🔥💰';
  assert.deepEqual(splitMessageLines(raw), [raw]);
  assert.equal(segmentDealerMessage(raw)[0].emoji_price_ambiguous, true);
});

test('reference families override contradictory section context', () => {
  const candidates = segmentDealerMessage(`
_PP_
4300V/000R-B509 Used 2022 HKD 900000
  `);
  assert.equal(candidates[0].context.brand_context, 'Vacheron Constantin');
  assert.equal(inferBrandFromReference('4300V/000R-B509'), 'Vacheron Constantin');
});

test('splits a multi-watch Richard Mille message into candidates', () => {
  const candidates = segmentDealerMessage(`
RM New HKD
RM07-01 WG Snow Diamond N11/25 USDT 350k
RM67-01 RG N11/25 HKD 1.84m
RM35-03 blue N11/25 HKD 3.51m
  `);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map(candidate => candidate.prices[0].currency_original), ['USDT', 'HKD', 'HKD']);
});

test('classifies looking-for listings as WTB without changing inventory defaults', () => {
  const wtb = segmentDealerMessage('Looking for 126500LN white dial');
  const lookingToBuy = segmentDealerMessage('Looking to buy 7118/1A open to dial');
  const ntq = segmentDealerMessage('NTQ - 5821/1a green');
  const wts = segmentDealerMessage('126610LN N6/26 HKD 114000');
  assert.equal(wtb[0].context.intent_context, 'WTB');
  assert.equal(lookingToBuy[0].context.intent_context, 'WTB');
  assert.equal(ntq[0].context.intent_context, 'WTB');
  assert.equal(wts[0].context.intent_context, 'WTS');
});

test('extracts Patek four-digit suffix references without treating prices as references', () => {
  const candidates = segmentDealerMessage(`
Patek Philippe
5935A-001 48,000US$
5396G 255,000HK$
  `);
  assert.deepEqual(candidates.map(candidate => candidate.reference), ['5935A-001', '5396G']);
  assert.deepEqual(candidates.map(candidate => candidate.context.brand_context), ['Patek Philippe', 'Patek Philippe']);
});

test('does not create a phantom Rolex candidate from a six-digit price', () => {
  const candidates = segmentDealerMessage(`
Patek Philippe 5712/1A Tiffany
Full set price 195000 USD
  `);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reference, '5712/1A');
  assert.equal(candidates[0].context.brand_context, 'Patek Philippe');
});

test('keeps a bare six-digit reference when the following price uses a separate dollar token', () => {
  const candidates = segmentDealerMessage('Rolex 126333 $14,500 plus label');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reference, '126333');
  assert.equal(candidates[0].context.brand_context, 'Rolex');
  assert.equal(candidates[0].prices[0].amount_original, 14500);
  assert.equal(candidates[0].prices[0].currency_original, 'USD');
});

test('recognizes Cartier and dotted Hublot reference formats', () => {
  const candidates = segmentDealerMessage(`
WTB WSSA0039 FULL SET 2026 ONLY UNDER 8k
485.ES.5171.RX.1204 - HKD 135300 - New 2025
  `);
  assert.deepEqual(candidates.map(candidate => candidate.reference), ['WSSA0039', '485.ES.5171.RX.1204']);
  assert.deepEqual(candidates.map(candidate => candidate.context.brand_context), ['Cartier', 'Hublot']);
  assert.equal(candidates[0].context.intent_context, 'WTB');
});

test('normalizes literal Excel carriage-return markers before segmenting references', () => {
  const candidates = segmentDealerMessage('Looking for stock_x000D_5968R_x000D_Need fresh date 2025+');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reference, '5968R');
  assert.equal(candidates[0].context.brand_context, 'Patek Philippe');
  assert.equal(candidates[0].context.intent_context, 'WTB');
});

test('classifies Chinese WTB messages and inherited request context', () => {
  const direct = segmentDealerMessage('\u6c42\u8d2d 126500LN White HKD 280k');
  const inherited = segmentDealerMessage('\u6c42\u8cfc\n126610LN Black $114000');
  assert.equal(direct[0].context.intent_context, 'WTB');
  assert.equal(inherited[0].context.intent_context, 'WTB');
});

test('extracts all 13 watches from the Hong Kong inventory fixture', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'hong-kong-inventory.txt'), 'utf8');
  const candidates = segmentDealerMessage(fixture);
  assert.equal(candidates.length, 13);
  assert.equal(candidates[0].prices[0].amount_original, 380000);
  assert.equal(candidates[0].prices[0].currency_original, 'HKD');
  assert.equal(candidates[11].context.brand_context, 'Patek Philippe');
  assert.equal(candidates[12].context.brand_context, 'Rolex');
});

test('accepts HK only beside a price without treating location text as currency context', () => {
  const suffix = extractPriceObservations('4.2m HK');
  const prefix = extractPriceObservations('HK 380k');
  assert.equal(suffix[0].amount_original, 4_200_000);
  assert.equal(suffix[0].currency_original, 'HKD');
  assert.equal(prefix[0].amount_original, 380_000);
  assert.equal(prefix[0].currency_original, 'HKD');

  const locationOnly = segmentDealerMessage('126334 Used 2023 $125000 arrive HK');
  assert.equal(locationOnly[0].prices[0].amount_original, 125000);
  assert.equal(locationOnly[0].prices[0].currency_original, 'USD');
  assert.equal(locationOnly[0].context.currency_context, undefined);
});

test('does not absorb an alphanumeric certificate token into an HKD price', () => {
  const prices = extractPriceObservations('5711/1A white, 2019y, SC330,950k hkd');
  assert.equal(prices.length, 1);
  assert.equal(prices[0].amount_original, 950_000);
  assert.equal(prices[0].currency_original, 'HKD');
});

test('prefers the amount after a shared currency token over a preceding year or edition count', () => {
  const year = extractPriceObservations('15202BA yellow NOS 2018 HKD 720,000');
  const edition = extractPriceObservations('26620IO Black Panther 2021 Ltd 250 HKD 1,450,000');
  assert.deepEqual(year.map(price => price.amount_original), [720_000]);
  assert.deepEqual(edition.map(price => price.amount_original), [1_450_000]);

  const explicitPair = extractPriceObservations('105,000HK$/13,500US$');
  assert.deepEqual(explicitPair.map(price => [price.amount_original, price.currency_original]), [
    [105_000, 'HKD'],
    [13_500, 'USD'],
  ]);
});

test('keeps both outward prices when a currency token bridges two explicit amounts', () => {
  const prices = extractPriceObservations('RM65-01 LeBron James N10/25 498k Usdt 3.85m hkd');
  assert.deepEqual(prices.map(price => [price.amount_original, price.currency_original, price.amount_usd]), [
    [498_000, 'USDT', 498_000],
    [3_850_000, 'HKD', 493_590],
  ]);
});

test('prefers prefix pairs when a year or date fragment starts a currency chain', () => {
  const yearChain = extractPriceObservations('New 5072R 2024 HKD 1.545M USDT 200,000');
  const dateChain = extractPriceObservations('New RM07-01 2025/8HKD 2.04m usdt 260000');
  assert.deepEqual(yearChain.map(price => [price.amount_original, price.currency_original]), [
    [1_545_000, 'HKD'],
    [200_000, 'USDT'],
  ]);
  assert.deepEqual(dateChain.map(price => [price.amount_original, price.currency_original]), [
    [2_040_000, 'HKD'],
    [260_000, 'USDT'],
  ]);
});

test('accepts punctuation between an explicit currency and amount', () => {
  const prices = extractPriceObservations('5980/60G-001 N8/25 HKD:1340000');
  assert.deepEqual(prices.map(price => [price.amount_original, price.currency_original]), [
    [1_340_000, 'HKD'],
  ]);
});

test('does not replace a valid price with a following month or year', () => {
  const month = extractPriceObservations('6007G red $225,000hkd 5/2025');
  const year = extractPriceObservations('5711/110P $3,200,000hkd 2019');
  assert.deepEqual(month.map(price => [price.amount_original, price.currency_original]), [
    [225_000, 'HKD'],
  ]);
  assert.deepEqual(year.map(price => [price.amount_original, price.currency_original]), [
    [3_200_000, 'HKD'],
  ]);
});

test('does not parse date fragments as standalone currency prices', () => {
  assert.deepEqual(extractPriceObservations('5980/60G 12/2025 HKD'), []);
  assert.deepEqual(extractPriceObservations('5726/1A blue 2025/8 HK'), []);
});

test('does not concatenate a comma-delimited year with the following price', () => {
  const cases = [
    ['Brand new 26656ti,N12/2024,3.1M hkd ready hk', 3_100_000],
    ['Brand new 15605sk blue,N4/2025,255K HKD', 255_000],
    ['Brand new 5990/1r N8/2024,1.99M hkd,ready hk', 1_990_000],
  ];
  for (const [raw, amount] of cases) {
    const prices = extractPriceObservations(raw);
    assert.deepEqual(prices.map(price => [price.amount_original, price.currency_original]), [
      [amount, 'HKD'],
    ]);
  }
});

test('does not treat the first letter of a following word as a multiplier', () => {
  const prices = extractPriceObservations('79010SG-0001 new 2021 NOS HKD 20,000 White Tag');
  assert.deepEqual(prices.map(price => [price.amount_original, price.currency_original]), [
    [20_000, 'HKD'],
  ]);
});

test('does not treat a reference ending in M as a section-inherited million price', () => {
  const prices = extractPriceObservations('9??14060M black oys 18y Card 65600', {
    currency_context: 'HKD',
  });
  assert.deepEqual(prices, []);
});

test('explicit listing condition overrides an inherited section condition', () => {
  const candidates = segmentDealerMessage(`Audemars Piguet Brand New
15202bc salmon 2019 used full set 855k hkd
15510ST black N11/2025 New 365k hkd`);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].context.condition_context, 'Used');
  assert.equal(candidates[1].context.condition_context, 'New');
});

test('owner policy treats bare K dealer shorthand as USD while named currency wins', () => {
  const bare = extractPriceObservations('Rolex Daytona 126508 85k');
  assert.equal(bare.length, 1);
  assert.equal(bare[0].amount_original, 85000);
  assert.equal(bare[0].currency_original, 'USD');
  assert.equal(bare[0].currency_evidence, 'usd_defaulted_by_policy');

  const named = extractPriceObservations('Rolex Daytona 126508 85k HKD');
  assert.equal(named.length, 1);
  assert.equal(named[0].amount_original, 85000);
  assert.equal(named[0].currency_original, 'HKD');
  assert.equal(named[0].currency_evidence, 'explicit_line_currency');
});

test('normalizes global currency codes and unambiguous local symbols on either side of prices', () => {
  const cases = [
    ['USD18000', 18_000, 'USD'],
    ['18kUSDT', 18_000, 'USDT'],
    ['298,000HKN', 298_000, 'HKD'],
    ['HNK305k', 305_000, 'HKD'],
    ['HDK 380 mil', 380_000, 'HKD'],
    ['EUR18.000', 18_000, 'EUR'],
    ['4.5m\u20ac', 4_500_000, 'EUR'],
    ['\u00a320,000', 20_000, 'GBP'],
    ['25000CHF', 25_000, 'CHF'],
    ['S$18k', 18_000, 'SGD'],
    ['AED100k', 100_000, 'AED'],
    ['100kSAR', 100_000, 'SAR'],
    ['CN\u00a5200k', 200_000, 'CNY'],
    ['3mJP\u00a5', 3_000_000, 'JPY'],
    ['\u20a945m', 45_000_000, 'KRW'],
    ['1.2m\u0e3f', 1_200_000, 'THB'],
    ['C$20k', 20_000, 'CAD'],
    ['30kA$', 30_000, 'AUD'],
    ['NZ$40000', 40_000, 'NZD'],
    ['RM 50k', 50_000, 'MYR'],
    ['50000RM', 50_000, 'MYR'],
    ['Rp250m', 250_000_000, 'IDR'],
    ['\u20b92.5m', 2_500_000, 'INR'],
    ['1m\u20b1', 1_000_000, 'PHP'],
    ['NT$800k', 800_000, 'TWD'],
    ['900m\u20ab', 900_000_000, 'VND'],
  ];

  for (const [raw, amount, currency] of cases) {
    const prices = extractPriceObservations(raw);
    assert.deepEqual(
      prices.map(price => [price.amount_original, price.currency_original]),
      [[amount, currency]],
      raw,
    );
  }
});

test('supports defensible additional ISO currency tokens without assuming one-to-one USD', () => {
  const cases = [
    ['R$100k', 100_000, 'BRL'],
    ['MXN350k', 350_000, 'MXN'],
    ['400kZAR', 400_000, 'ZAR'],
    ['SEK 200000', 200_000, 'SEK'],
    ['200000NOK', 200_000, 'NOK'],
    ['DKK180k', 180_000, 'DKK'],
  ];
  for (const [raw, amount, currency] of cases) {
    const [price] = extractPriceObservations(raw);
    assert.equal(price.amount_original, amount, raw);
    assert.equal(price.currency_original, currency, raw);
    assert.equal(price.amount_usd, null, raw);
  }
});

test('keeps symbol ambiguity and local-dollar precedence explicit', () => {
  assert.deepEqual(extractPriceObservations('\u00a5200k'), []);
  assert.deepEqual(extractPriceObservations('200k\uffe5'), []);

  const cny = extractPriceObservations('\u00a5200k', { currency_context: 'CNY' });
  const jpy = extractPriceObservations('200k\uffe5', { currency_context: 'JPY' });
  const inlineCny = extractPriceObservations('CNY \u00a5200k');
  const inlineJpy = extractPriceObservations('JPY \uffe5200k');
  assert.deepEqual(cny.map(price => [price.amount_original, price.currency_original]), [[200_000, 'CNY']]);
  assert.deepEqual(jpy.map(price => [price.amount_original, price.currency_original]), [[200_000, 'JPY']]);
  assert.deepEqual(inlineCny.map(price => [price.amount_original, price.currency_original]), [[200_000, 'CNY']]);
  assert.deepEqual(inlineJpy.map(price => [price.amount_original, price.currency_original]), [[200_000, 'JPY']]);

  assert.equal(extractPriceObservations('$18k')[0].currency_original, 'USD');
  assert.equal(extractPriceObservations('HK$18k')[0].currency_original, 'HKD');
  assert.equal(extractPriceObservations('C$18k')[0].currency_original, 'CAD');
  assert.equal(extractPriceObservations('A$18k')[0].currency_original, 'AUD');
  assert.equal(extractPriceObservations('S$18k')[0].currency_original, 'SGD');
  assert.equal(extractPriceObservations('NT$18k')[0].currency_original, 'TWD');

  assert.deepEqual(
    extractPriceObservations('HKD100k / $13k').map(price => [price.amount_original, price.currency_original]),
    [[100_000, 'HKD'], [13_000, 'USD']],
  );
});

test('global currency support preserves reference year date and bundle guards', () => {
  assert.deepEqual(extractPriceObservations('RM11-03'), []);
  assert.deepEqual(extractPriceObservations('15202ST 2025/8 JPY'), []);
  assert.deepEqual(extractPriceObservations('Rolex 126500LN USD'), []);

  const richardMille = extractPriceObservations('RM11-03 USD250k');
  assert.deepEqual(richardMille.map(price => [price.amount_original, price.currency_original]), [[250_000, 'USD']]);

  const noCurrency = extractPriceObservations('116688 37000');
  assert.deepEqual(noCurrency.map(price => [price.amount_original, price.currency_original]), [[37_000, 'USD']]);

  const bundle = segmentDealerMessage('WTS AP 15500ST C$40k\nRolex 126500LN USD30k');
  assert.equal(bundle.length, 2);
  assert.deepEqual(bundle.map(item => item.prices[0].currency_original), ['CAD', 'USD']);
});
