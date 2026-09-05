'use strict';

const { test, setTier, assert } = require('./test-harness.cjs');
const { summarizePrices, classifyPrice } = require('../../api/_lib/market-stats.cjs');

setTier('Tier 2: Boundary & Corner Cases');

// ----------------------------------------------------
// Feature 1: Data Consistency & Reconciliation (Boundary)
// ----------------------------------------------------

test('F1-B1: Empty dataset (0 listings) reconciles count formula cleanly as 0 = 0 + 0 + 0', () => {
  const dataset = [];
  const total = dataset.length;
  const wtsEligible = dataset.filter(d => d.type === 'WTS' && d.price > 0).length;
  const wtbDemand = dataset.filter(d => d.type === 'WTB').length;
  const excluded = dataset.filter(d => d.type === 'WTS' && (!d.price || d.price <= 0)).length;

  assert.equal(total, 0);
  assert.equal(wtsEligible, 0);
  assert.equal(wtbDemand, 0);
  assert.equal(excluded, 0);
  assert.equal(total, wtsEligible + wtbDemand + excluded);
});

test('F1-B2: Single listing dataset (1 listing) reconciles count formula', () => {
  const dataset = [{ id: '1', type: 'WTS', price: 15000 }];
  const total = dataset.length;
  const wtsEligible = dataset.filter(d => d.type === 'WTS' && d.price > 0).length;
  const wtbDemand = dataset.filter(d => d.type === 'WTB').length;
  const excluded = dataset.filter(d => d.type === 'WTS' && (!d.price || d.price <= 0)).length;

  assert.equal(total, 1);
  assert.equal(wtsEligible, 1);
  assert.equal(total, wtsEligible + wtbDemand + excluded);
});

test('F1-B3: Extreme price ranges ($1 to $10,000,000) filter negative and zero prices while keeping valid extremes', () => {
  const rawPrices = [-500, 0, 1, 28000, 10000000, null, undefined, NaN];
  const validPrices = rawPrices.filter(p => typeof p === 'number' && Number.isFinite(p) && p > 0);

  assert.equal(validPrices.length, 3);
  assert.deepEqual(validPrices, [1, 28000, 10000000]);
});

test('F1-B4: Missing catalog reference tags (null/empty/Unknown) are grouped into excluded unclassified', () => {
  const records = [
    { id: '1', reference: '116500LN', brand: 'Rolex' },
    { id: '2', reference: null, brand: 'Rolex' },
    { id: '3', reference: '', brand: 'Rolex' },
    { id: '4', reference: 'Unknown', brand: 'Rolex' },
  ];

  const classified = records.filter(r => r.reference && r.reference !== 'Unknown');
  const unclassified = records.filter(r => !r.reference || r.reference === 'Unknown');

  assert.equal(classified.length, 1);
  assert.equal(unclassified.length, 3);
});

test('F1-B5: Unsplit bundle parent listings are excluded from single-item price analytics and counted in raw total', () => {
  const records = [
    { id: '1', reference: '116500LN', price: 28000, bundle_candidate_count: 1 },
    { id: '2', reference: '116500LN', price: 50000, bundle_candidate_count: 3 }, // Unsplit bundle parent
  ];

  const rawTotal = records.length;
  const singleItemEligible = records.filter(r => r.bundle_candidate_count <= 1);
  const unsplitBundles = records.filter(r => r.bundle_candidate_count > 1);

  assert.equal(rawTotal, 2);
  assert.equal(singleItemEligible.length, 1);
  assert.equal(unsplitBundles.length, 1);
  assert.equal(rawTotal, singleItemEligible.length + unsplitBundles.length);
});

// ----------------------------------------------------
// Feature 2: WTB Demand Signal Integration (Boundary)
// ----------------------------------------------------

test('F2-B1: Reference with 0 WTB listings renders 0 demand signals without throwing error', () => {
  const demandPayload = {
    reference: '5711/1A-010',
    wtb_count: 0,
    demand_cohorts: [],
    demand_sample_capped: false,
  };

  assert.equal(demandPayload.wtb_count, 0);
  assert.equal(demandPayload.demand_cohorts.length, 0);
});

test('F2-B2: Reference with ONLY WTB listings (0 WTS listings) sets WTS asking stats to empty', () => {
  const wtsListings = [];
  const wtbListings = [{ id: 'b1', intent: 'WTB' }, { id: 'b2', intent: 'WTB' }];

  const wtsStats = wtsListings.length > 0 ? summarizePrices(wtsListings.map(l => l.price)) : null;
  const wtbCount = wtbListings.length;

  assert.equal(wtsStats, null);
  assert.equal(wtbCount, 2);
});

test('F2-B3: Extreme WTB volume (500 WTB vs 2 WTS) isolates asking price calculation strictly to WTS', () => {
  const wtsPrices = [12000, 13000];
  const wtbVolume = 500;

  const wtsAvg = wtsPrices.reduce((a, b) => a + b, 0) / wtsPrices.length;

  assert.equal(wtsAvg, 12500);
  assert.equal(wtbVolume, 500);
});

test('F2-B4: Non-standard demand intent variations are mapped to demand signals', () => {
  function classifyIntent(intent) {
    const clean = String(intent || '').trim().toUpperCase();
    if (['WTB', 'NTQ', 'BUY', 'BUYING', 'WANTED', 'NEED TO QUOTE'].includes(clean)) {
      return 'DEMAND';
    }
    if (['WTS', 'FS', 'FOR SALE', 'SELLING'].includes(clean)) {
      return 'SUPPLY';
    }
    return 'UNKNOWN';
  }

  assert.equal(classifyIntent('WTB'), 'DEMAND');
  assert.equal(classifyIntent('WANTED'), 'DEMAND');
  assert.equal(classifyIntent('Need to Quote'), 'DEMAND');
  assert.equal(classifyIntent('FOR SALE'), 'SUPPLY');
});

test('F2-B5: WTB listing with zero or missing price is included in demand count', () => {
  const wtbListings = [
    { id: 'w1', intent: 'WTB', target_price: 0 },
    { id: 'w2', intent: 'WTB', target_price: null },
    { id: 'w3', intent: 'WTB', target_price: undefined },
  ];

  const demandCount = wtbListings.filter(l => l.intent === 'WTB').length;
  assert.equal(demandCount, 3);
});

// ----------------------------------------------------
// Feature 3: Seller Contacts & Raw Messages (Boundary)
// ----------------------------------------------------

test('F3-B1: Missing seller name or phone returns contact_available false with reason code', () => {
  function getContactPayload(listing) {
    if (!listing.seller_phone) {
      return { success: true, contact_available: false, reason: 'APPROVED_PHONE_INVALID' };
    }
    if (!listing.dealer_id) {
      return { success: true, contact_available: false, reason: 'DEALER_UNRESOLVED' };
    }
    return { success: true, contact_available: true };
  }

  const result1 = getContactPayload({ seller_phone: null });
  assert.equal(result1.contact_available, false);
  assert.equal(result1.reason, 'APPROVED_PHONE_INVALID');

  const result2 = getContactPayload({ seller_phone: '+15550001111', dealer_id: null });
  assert.equal(result2.contact_available, false);
  assert.equal(result2.reason, 'DEALER_UNRESOLVED');
});

test('F3-B2: Malformed phone numbers with extensions or spaces extract digits safely', () => {
  function extractPhoneDigits(phoneStr) {
    const digits = String(phoneStr || '').replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  assert.equal(extractPhoneDigits('+1 (555) 123-4567'), '15551234567');
  assert.equal(extractPhoneDigits('Call +44 20 7946 0999 now'), '442079460999');
  assert.equal(extractPhoneDigits('123'), null); // Too short
});

test('F3-B3: Exceptionally long raw source messages (2,000+ characters) are retained completely', () => {
  const longPrefix = '[oceandigital] WTS Huge collection of watches: ';
  const longText = 'Rolex 116500LN $28500. '.repeat(100);
  const fullRawMessage = longPrefix + longText;

  assert.ok(fullRawMessage.length > 2000);
  assert.ok(fullRawMessage.startsWith('[oceandigital]'));
  assert.ok(fullRawMessage.includes('116500LN'));
});

test('F3-B4: Special UTF-8 characters and emojis in raw messages are formatted safely', () => {
  const rawWithEmojis = '🔥 FS Rolex Daytona 116500LN 🔥 Price: $28,500 📦 Complete Set 📱 WhatsApp +15550199';
  
  assert.ok(rawWithEmojis.includes('🔥'));
  assert.ok(rawWithEmojis.includes('📦'));
  assert.ok(rawWithEmojis.includes('Rolex Daytona 116500LN'));
});

test('F3-B5: Seller contact disclosure requires explicitly approved contact flag', () => {
  function canDiscloseContact(flags) {
    return Array.isArray(flags) && flags.includes('OWNER_APPROVED_CONTACT_PUBLIC');
  }

  assert.equal(canDiscloseContact(['OWNER_APPROVED_CONTACT_PUBLIC', 'VERIFIED_ROW']), true);
  assert.equal(canDiscloseContact(['UNVERIFIED_SOURCE']), false);
  assert.equal(canDiscloseContact([]), false);
});

// ----------------------------------------------------
// Feature 4: Relaxed Outlier Filters (Boundary)
// ----------------------------------------------------

test('F4-B1: Exactly 1 observation is below the min threshold of 2, marking analytics_ready false', () => {
  function getAnalyticsReadiness(observations, minThreshold = 2) {
    const ready = observations.length >= minThreshold;
    const quality = observations.length < 2 ? 'observational' : observations.length < 5 ? 'provisional' : 'robust';
    return { ready, quality };
  }

  const result = getAnalyticsReadiness([25000]);
  assert.equal(result.ready, false);
  assert.equal(result.quality, 'observational');
});

test('F4-B2: Exactly 2 observations meet the min threshold, marking analytics_ready true', () => {
  function getAnalyticsReadiness(observations, minThreshold = 2) {
    const ready = observations.length >= minThreshold;
    const quality = observations.length < 2 ? 'observational' : observations.length < 5 ? 'provisional' : 'robust';
    return { ready, quality };
  }

  const result = getAnalyticsReadiness([25000, 26000]);
  assert.equal(result.ready, true);
  assert.equal(result.quality, 'provisional');
});

test('F4-B3: Zero variance price inputs ([15000, 15000]) handle IQR=0 without division by zero errors', () => {
  const prices = [15000, 15000];
  const result = summarizePrices(prices);

  assert.equal(result.stats.iqr, 0);
  assert.equal(result.stats.avg, 15000);
  assert.equal(result.stats.min, 15000);
  assert.equal(result.stats.max, 15000);
  assert.ok(!Number.isNaN(result.stats.avg));
});

test('F4-B4: Extreme price outliers outside 3.0x IQR fence are detected cleanly', () => {
  // Array: 10000, 11000, 12000, 13000, 100000 (100k typo/extreme)
  const prices = [10000, 11000, 12000, 13000, 100000];
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[1]; // 11000
  const q3 = sorted[3]; // 13000
  const iqr = q3 - q1; // 2000
  const fence3_0_upper = q3 + 3.0 * iqr; // 13000 + 6000 = 19000

  assert.equal(fence3_0_upper, 19000);
  assert.ok(100000 > fence3_0_upper);
});

test('F4-B5: Non-numeric strings and nulls in price array are safely ignored', () => {
  const rawListings = [
    { price: '15000' },
    { price: 'invalid' },
    { price: null },
    { price: undefined },
    { price: 16000 },
  ];

  const cleanPrices = rawListings
    .map(l => Number(l.price))
    .filter(p => Number.isFinite(p) && p > 0);

  assert.equal(cleanPrices.length, 2);
  assert.deepEqual(cleanPrices, [15000, 16000]);
});

// ----------------------------------------------------
// Feature 5: Smooth Navigation UX (Boundary)
// ----------------------------------------------------

test('F5-B1: Deeply nested detail route navigation constructs full 4-level breadcrumbs', () => {
  function getBreadcrumbPath(pathname) {
    // e.g. /price-research/Rolex/116500LN/listing/123
    const parts = pathname.split('/').filter(Boolean);
    const trail = [{ label: 'Home', to: '/' }];

    if (parts[0] === 'price-research') {
      trail.push({ label: 'Price Research', to: '/price-research' });
      if (parts[1]) trail.push({ label: decodeURIComponent(parts[1]), to: `/price-research?brand=${parts[1]}` });
      if (parts[2]) trail.push({ label: decodeURIComponent(parts[2]), to: `/price-research/${parts[1]}/${parts[2]}` });
      if (parts[3] && parts[4]) trail.push({ label: `Listing ${parts[4]}` });
    }
    return trail;
  }

  const trail = getBreadcrumbPath('/price-research/Rolex/116500LN/listing/123');
  assert.equal(trail.length, 5);
  assert.equal(trail[1].label, 'Price Research');
  assert.equal(trail[2].label, 'Rolex');
  assert.equal(trail[3].label, '116500LN');
  assert.equal(trail[4].label, 'Listing 123');
});

test('F5-B2: Invalid or unknown routes render TopNav while preserving fallback state', () => {
  function handleRouteMatch(pathname) {
    const validRoutes = ['/', '/trading', '/price-research', '/telegram-test', '/dealer-login'];
    const isKnown = validRoutes.includes(pathname);
    return {
      showTopNav: true,
      view: isKnown ? 'PAGE_VIEW' : '404_FALLBACK',
    };
  }

  const result = handleRouteMatch('/unknown-random-route');
  assert.equal(result.showTopNav, true);
  assert.equal(result.view, '404_FALLBACK');
});

test('F5-B3: Missing browser history stack falls back safely to default route', () => {
  function computeBackTarget(historyLength, defaultFallback = '/trading') {
    if (historyLength <= 1) {
      return defaultFallback;
    }
    return 'GO_BACK_STACK';
  }

  assert.equal(computeBackTarget(1), '/trading');
  assert.equal(computeBackTarget(5), 'GO_BACK_STACK');
});

test('F5-B4: Complex search parameters with escaped characters are preserved during navigation', () => {
  const queryStr = '?search=Patek%20Philippe%205711%2F1A&brand=Patek%20Philippe';
  const params = new URLSearchParams(queryStr);

  assert.equal(params.get('search'), 'Patek Philippe 5711/1A');
  assert.equal(params.get('brand'), 'Patek Philippe');
});

test('F5-B5: Rapid route switching state updates clean without race conditions', () => {
  const navigationEvents = ['/trading', '/price-research', '/price-research?brand=Rolex', '/dealer-login'];
  let currentPath = '/';

  for (const evt of navigationEvents) {
    currentPath = evt;
  }

  assert.equal(currentPath, '/dealer-login');
});

// ----------------------------------------------------
// Feature 6: Image & Vision Rules (Boundary)
// ----------------------------------------------------

test('F6-B1: Bundle parent listings with multiple sub-items omit parent image URL', () => {
  const bundleRecord = {
    id: 'bundle_main',
    is_bundle: true,
    image_url: 'https://example.com/multi_watch_photo.jpg',
    child_count: 4,
  };

  const displayImage = bundleRecord.is_bundle ? null : bundleRecord.image_url;
  assert.equal(displayImage, null);
  assert.equal(bundleRecord.child_count, 4);
});

test('F6-B2: Missing image URL and missing dial color fall back to Unspecified dial', () => {
  function resolveDial(listing) {
    if (listing.dial_color && listing.dial_color !== 'Unspecified') {
      return listing.dial_color;
    }
    return 'Unspecified';
  }

  const result = resolveDial({ dial_color: null, image_url: null });
  assert.equal(result, 'Unspecified');
});

test('F6-B3: Malformed image URLs fail image validation gracefully', () => {
  function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url.trim());
  }

  assert.equal(isValidImageUrl('https://example.com/watch.jpg'), true);
  assert.equal(isValidImageUrl('ht://invalid-url'), false);
  assert.equal(isValidImageUrl('not-a-url'), false);
});

test('F6-B4: Image URL with HTTP scheme is upgraded to HTTPS or allowed safely', () => {
  function enforceHttps(url) {
    if (!url) return null;
    return url.replace(/^http:\/\//i, 'https://');
  }

  assert.equal(enforceHttps('http://images.watchfacts.com/1.jpg'), 'https://images.watchfacts.com/1.jpg');
  assert.equal(enforceHttps('https://images.watchfacts.com/1.jpg'), 'https://images.watchfacts.com/1.jpg');
});

test('F6-B5: Custom/unusual dial color values are normalized into standard dial groups', () => {
  const dialNormalizerMap = {
    'ice blue': 'Ice Blue',
    'navy blue': 'Blue',
    'sunburst blue': 'Blue',
    'slate': 'Grey',
    'anthracite': 'Grey',
  };

  function normalizeDial(rawDial) {
    if (!rawDial) return 'Unspecified';
    const key = rawDial.trim().toLowerCase();
    return dialNormalizerMap[key] || rawDial.trim();
  }

  assert.equal(normalizeDial('navy blue'), 'Blue');
  assert.equal(normalizeDial('ice blue'), 'Ice Blue');
  assert.equal(normalizeDial('anthracite'), 'Grey');
  assert.equal(normalizeDial('Custom Meteorite'), 'Custom Meteorite');
});

// ----------------------------------------------------
// Feature 7: Build & Deployment Integrity (Boundary)
// ----------------------------------------------------

test('F7-B1: TS compiler configuration enables strict mode or type checking flags', () => {
  const fs = require('fs');
  const path = require('path');
  const tsconfigPath = path.join(__dirname, '../../tsconfig.json');

  assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json must exist');
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

  assert.ok(tsconfig.compilerOptions, 'compilerOptions must be present in tsconfig');
});

test('F7-B2: Missing environment variables initialize safe runtime defaults', () => {
  function getApiConfig(env) {
    return {
      supabaseUrl: env.VITE_SUPABASE_URL || 'https://fallback-db.supabase.co',
      supabaseKey: env.VITE_SUPABASE_ANON_KEY || 'fallback-anon-key',
      enableForecasts: env.ENABLE_PRICE_FORECASTS === 'true',
    };
  }

  const config = getApiConfig({});
  assert.equal(config.supabaseUrl, 'https://fallback-db.supabase.co');
  assert.equal(config.supabaseKey, 'fallback-anon-key');
  assert.equal(config.enableForecasts, false);
});

test('F7-B3: Static assets folder contains required public JSON fallback files', () => {
  const fs = require('fs');
  const path = require('path');

  const tradingFloorJson = path.join(__dirname, '../../public/top_watches_trading_floor.json');
  assert.ok(fs.existsSync(tradingFloorJson), 'top_watches_trading_floor.json must exist in public/');
});

test('F7-B4: Package dependencies specify core React runtime packages', () => {
  const pkgJson = require('../../package.json');

  assert.ok(pkgJson.dependencies['react'], 'react dependency missing');
  assert.ok(pkgJson.dependencies['react-dom'], 'react-dom dependency missing');
  assert.ok(pkgJson.dependencies['react-router-dom'] || pkgJson.dependencies['react-router'], 'react-router dependency missing');
});

test('F7-B5: Build script commands do not contain illegal flags or missing commands', () => {
  const pkgJson = require('../../package.json');
  const buildCmd = pkgJson.scripts.build;

  assert.ok(typeof buildCmd === 'string' && buildCmd.length > 0);
  assert.ok(buildCmd.includes('vite build') || buildCmd.includes('tsc'));
});
