'use strict';

// PHASE 7 BUNDLE LINEAGE - deterministic SYNTHETIC bundle-parent generator.
//
// The repository does not contain a redacted production bundle-parent fixture
// set (the only fixture is tests/fixtures/hong-kong-inventory.txt, 13 lines).
// The real-data 1,000-parent canary is therefore BLOCKED_PENDING_REDACTED_INPUT.
// This generator produces exactly 1,000 source-shaped synthetic parents covering
// the required coverage matrix. Every byte is deterministic: same code, same
// seed, same output. Messages contain only watch tokens (brand, reference,
// dial, year, condition, price, currency, intent). No names, phone numbers,
// emails, handles, or copied production text are ever emitted.

const { deterministicUuid } = require('./bundle-cohort.cjs');

const SEED = 0x5eed0007;
const PARENT_COUNT = 1000;

const CATEGORY_QUOTAS = [
  ['single', 100],
  ['two', 250],
  ['five_plus', 150],
  ['multi_currency', 120],
  ['mixed_intent', 100],
  ['shared_headers', 80],
  ['shared_images', 50],
  ['separate_price_lines', 50],
  ['no_price', 50],
  ['ambiguous_reference', 50],
];

const REFERENCE_POOL = [
  ['Rolex', '126610LN'], ['Rolex', '116500LN'], ['Rolex', '126710BLRO'],
  ['Rolex', '126334'], ['Rolex', '116610LV'],
  ['Patek Philippe', '5711/1A'], ['Patek Philippe', '5990/1R'],
  ['Patek Philippe', '5167A'],
  ['Audemars Piguet', '15202BC'], ['Audemars Piguet', '15500ST'],
  ['Audemars Piguet', '26240ST'],
  ['Richard Mille', 'RM011'], ['Richard Mille', 'RM035'],
  ['Vacheron Constantin', '5520V/210A-B481'], ['Vacheron Constantin', '4200H/222A-B934'],
  ['Panerai', 'PAM00111'],
];

const DIALS = ['black', 'blue', 'white', 'green', 'salmon', 'panda', 'chocolate', 'grey'];
const CONDITIONS = ['new', 'used', 'new full set', 'used full set'];
const CURRENCIES = ['HKD', 'USD', 'USDT', 'EUR', 'CNY'];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function priceToken(currency, units) {
  switch (currency) {
    case 'HKD': return `hkd ${units}k`;
    case 'USD': return `${units},000 USD`;
    case 'USDT': return `USDT ${units},000`;
    case 'EUR': return `EUR ${units},000`;
    case 'CNY': return `RMB ${units},000`;
    default: throw new Error(`unsupported currency ${currency}`);
  }
}

function watchLine(rng, options = {}) {
  const [brand, reference] = options.reference
    ? [options.brand || null, options.reference]
    : pick(rng, REFERENCE_POOL);
  const tokens = [];
  if (options.intent === 'WTB') tokens.push('WTB');
  // The existing RM reference pattern greedily consumes a following word
  // (known parser quirk); a comma keeps the reference token exact.
  tokens.push(/^RM/.test(reference) ? `${reference},` : reference);
  if (options.dial !== false) tokens.push(pick(rng, DIALS));
  tokens.push(String(2018 + Math.floor(rng() * 8)));
  if (options.intent !== 'WTB') tokens.push(pick(rng, CONDITIONS));
  if (options.priced !== false) {
    const currency = options.currency || pick(rng, CURRENCIES);
    const units = 40 + Math.floor(rng() * 900);
    tokens.push(priceToken(currency, units));
  }
  return { line: tokens.join(' '), brand, reference };
}

function buildParent(category, index, rng) {
  const lines = [];
  const tags = [category];
  const listingType = category === 'mixed_intent' ? 'WTS' : 'WTS';

  const childCount = category === 'single' ? 1
    : category === 'two' ? 2
    : category === 'five_plus' ? 5 + Math.floor(rng() * 4)
    : category === 'multi_currency' ? 2 + Math.floor(rng() * 3)
    : category === 'mixed_intent' ? 2 + Math.floor(rng() * 2)
    : category === 'shared_headers' ? 3 + Math.floor(rng() * 4)
    : category === 'shared_images' ? 2 + Math.floor(rng() * 3)
    : category === 'separate_price_lines' ? 2
    : category === 'no_price' ? 2 + Math.floor(rng() * 3)
    : 2;

  if (category === 'shared_headers') {
    const [, reference] = pick(rng, REFERENCE_POOL);
    const brandHeader = REFERENCE_POOL.find(entry => entry[1] === reference)[0];
    lines.push(brandHeader);
    lines.push(pick(rng, ['HKD', 'USD', 'USDT']));
    lines.push(pick(rng, ['full set', 'brand new', 'used']));
    for (let i = 0; i < childCount; i += 1) {
      const { line } = watchLine(rng, { priced: true, currency: undefined });
      // Header context supplies the currency; strip explicit currency tokens so
      // inheritance is exercised. Keep a plain "<units>k" amount instead.
      lines.push(line.replace(/\b(?:hkd|usdt|eur|rmb)\b\s*/i, '').replace(/\bUSD\b\s*/i, '').trim());
    }
  } else if (category === 'separate_price_lines') {
    // Reference on one line, its price alone on the next line. The price-only
    // line has no reference and must not create a phantom child; the priced
    // amount must not leap onto the sibling.
    const first = watchLine(rng, { priced: false });
    lines.push(first.line);
    lines.push(priceToken('HKD', 90 + Math.floor(rng() * 400)));
    const second = watchLine(rng, { priced: true, currency: 'USD' });
    lines.push(second.line);
  } else if (category === 'ambiguous_reference') {
    // One line carries two references; one line has only a price-like token.
    const a = pick(rng, REFERENCE_POOL);
    let b = pick(rng, REFERENCE_POOL);
    if (b[1] === a[1]) b = REFERENCE_POOL[(REFERENCE_POOL.indexOf(a) + 1) % REFERENCE_POOL.length];
    lines.push(`${a[0]} ${a[1]} or ${b[0]} ${b[1]} ${pick(rng, DIALS)} 2022 used`);
    lines.push(`full set ${280000 + Math.floor(rng() * 50000)} USD`);
  } else {
    for (let i = 0; i < childCount; i += 1) {
      const options = {};
      if (category === 'multi_currency') options.currency = CURRENCIES[i % CURRENCIES.length];
      if (category === 'mixed_intent' && i % 2 === 1) { options.intent = 'WTB'; options.priced = rng() < 0.5; }
      if (category === 'no_price' && i % 2 === 1) options.priced = false;
      lines.push(watchLine(rng, options).line);
    }
  }

  const source = {
    id: deterministicUuid(`phase7-synthetic-parent:${index}`),
    raw_message: lines.join('\n'),
    listing_type: listingType,
    brand: null,
    reference: null,
    price_raw: null,
    price_usd: null,
    currency: null,
    dial_color: null,
    parser_version: 'phase7-synthetic-generator-v1',
  };
  if (category === 'shared_images') {
    source.image_urls = [`https://img.invalid/phase7/${source.id}/front.jpg`];
  }
  return { source, category, tags };
}

function generateSyntheticParents(count = PARENT_COUNT) {
  if (count !== PARENT_COUNT) throw new Error(`synthetic canary is pinned to exactly ${PARENT_COUNT} parents`);
  const quotaTotal = CATEGORY_QUOTAS.reduce((sum, [, quota]) => sum + quota, 0);
  if (quotaTotal !== PARENT_COUNT) throw new Error(`category quotas sum to ${quotaTotal}, expected ${PARENT_COUNT}`);
  const rng = mulberry32(SEED);
  const parents = [];
  let index = 0;
  for (const [category, quota] of CATEGORY_QUOTAS) {
    for (let i = 0; i < quota; i += 1) {
      parents.push(buildParent(category, index, rng));
      index += 1;
    }
  }
  return parents;
}

module.exports = {
  CATEGORY_QUOTAS,
  PARENT_COUNT,
  SEED,
  generateSyntheticParents,
};
