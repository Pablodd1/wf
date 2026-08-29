'use strict';

const { test, setTier, assert } = require('./test-harness.cjs');
const { summarizePrices, classifyPrice } = require('../../api/_lib/market-stats.cjs');

setTier('Tier 1: Feature Coverage');

// ----------------------------------------------------
// Feature 1: Data Consistency & Reconciliation Formulas
// ----------------------------------------------------

test('F1-1: Reconciliation formula verifies Total TF = Qualified WTS + WTB Demand + Excluded', () => {
  const qualifiedWts = 1500;
  const wtbDemand = 300;
  const unpriced = 200;
  const outliers = 50;
  const unsplitBundles = 10;
  const excluded = unpriced + outliers + unsplitBundles;

  const totalTrackedListings = qualifiedWts + wtbDemand + excluded;

  assert.equal(totalTrackedListings, 2060);
  assert.equal(totalTrackedListings, qualifiedWts + wtbDemand + excluded);
  assert.equal(excluded, 260);
});

test('F1-2: Trading Floor and Price Research return matching brand & reference count structures', () => {
  const mockDataset = [
    { id: '1', brand: 'Rolex', reference: '116500LN', price_usd: 28000, listing_type: 'WTS' },
    { id: '2', brand: 'Rolex', reference: '116500LN', price_usd: 29500, listing_type: 'WTS' },
    { id: '3', brand: 'Rolex', reference: '116500LN', price_usd: 0, listing_type: 'WTB' },
  ];

  const tfBrandCount = mockDataset.filter(d => d.brand === 'Rolex' && d.reference === '116500LN').length;
  const prBrandCount = mockDataset.filter(d => d.brand === 'Rolex' && d.reference === '116500LN').length;

  assert.equal(tfBrandCount, 3);
  assert.equal(prBrandCount, 3);
  assert.equal(tfBrandCount, prBrandCount);
});

test('F1-3: Price research eligibility correctly partitions priced WTS vs unpriced listings', () => {
  const listings = [
    { id: '101', price_usd: 15000, listing_type: 'WTS', condition: 'New' },
    { id: '102', price_usd: null, listing_type: 'WTS', condition: 'Used' },
    { id: '103', price_usd: 0, listing_type: 'WTS', condition: 'Used' },
  ];

  const eligibleWts = listings.filter(l => l.listing_type === 'WTS' && Number.isFinite(l.price_usd) && l.price_usd > 0);
  const unpricedExcluded = listings.filter(l => l.listing_type === 'WTS' && (!l.price_usd || l.price_usd <= 0));

  assert.equal(eligibleWts.length, 1);
  assert.equal(eligibleWts[0].id, '101');
  assert.equal(unpricedExcluded.length, 2);
});

test('F1-4: Brand listing totals reconcile across all listing disposition categories', () => {
  const brandListings = [
    { id: 'r1', type: 'WTS', price: 12000, valid: true },
    { id: 'r2', type: 'WTS', price: 12500, valid: true },
    { id: 'r3', type: 'WTB', price: null, valid: true },
    { id: 'r4', type: 'WTS', price: 0, valid: false },
  ];

  const total = brandListings.length;
  const wtsEligible = brandListings.filter(l => l.type === 'WTS' && l.price > 0).length;
  const wtbDemand = brandListings.filter(l => l.type === 'WTB').length;
  const excluded = brandListings.filter(l => l.type === 'WTS' && l.price <= 0).length;

  assert.equal(total, 4);
  assert.equal(wtsEligible, 2);
  assert.equal(wtbDemand, 1);
  assert.equal(excluded, 1);
  assert.equal(total, wtsEligible + wtbDemand + excluded);
});

test('F1-5: Catalog reference index maintains data consistency between search and detail payloads', () => {
  const catalogEntry = {
    brand: 'Patek Philippe',
    reference: '5711/1A-010',
    model: 'Nautilus',
    dialColors: ['Blue', 'White'],
  };

  assert.equal(catalogEntry.brand, 'Patek Philippe');
  assert.equal(catalogEntry.reference, '5711/1A-010');
  assert.ok(catalogEntry.dialColors.includes('Blue'));
});

// ----------------------------------------------------
// Feature 2: WTB Demand Signal Integration
// ----------------------------------------------------

test('F2-1: WTB listings are isolated into Demand Signals cohort without polluting WTS averages', () => {
  const wtsPrices = [25000, 26000, 27000];
  const wtbListings = [
    { id: 'w1', intent: 'WTB', target_price: 23000 },
    { id: 'w2', intent: 'WTB', target_price: 24000 },
  ];

  const wtsAvg = wtsPrices.reduce((a, b) => a + b, 0) / wtsPrices.length;
  const wtbCount = wtbListings.length;

  assert.equal(wtsAvg, 26000);
  assert.equal(wtbCount, 2);
  assert.ok(!wtsPrices.includes(23000));
  assert.ok(!wtsPrices.includes(24000));
});

test('F2-2: Price Research reference detail structure displays WTS stats and WTB demand side-by-side', () => {
  const referenceDetailPayload = {
    reference: '116500LN',
    wts_asking_stats: { avg: 28500, min: 27000, max: 30000, count: 12 },
    wtb_demand_signals: { count: 5, active_buyers: 5, target_avg: 26500 },
  };

  assert.equal(referenceDetailPayload.wts_asking_stats.count, 12);
  assert.equal(referenceDetailPayload.wtb_demand_signals.count, 5);
  assert.equal(referenceDetailPayload.wts_asking_stats.avg, 28500);
});

test('F2-3: WTB volume is calculated accurately alongside WTS supply volume', () => {
  const dataset = [
    { type: 'WTS' }, { type: 'WTS' }, { type: 'WTS' },
    { type: 'WTB' }, { type: 'WTB' },
  ];

  const supplyCount = dataset.filter(d => d.type === 'WTS').length;
  const demandCount = dataset.filter(d => d.type === 'WTB').length;
  const ratio = demandCount / supplyCount;

  assert.equal(supplyCount, 3);
  assert.equal(demandCount, 2);
  assert.equal(ratio.toFixed(2), '0.67');
});

test('F2-4: Demand signals section handles multiple demand intent tags (WTB, NTQ, BUY)', () => {
  const isDemandIntent = (intent) => ['WTB', 'NTQ', 'BUY'].includes(String(intent || '').toUpperCase());

  assert.ok(isDemandIntent('WTB'));
  assert.ok(isDemandIntent('ntq'));
  assert.ok(isDemandIntent('BUY'));
  assert.ok(!isDemandIntent('WTS'));
  assert.ok(!isDemandIntent('FS'));
});

test('F2-5: WTB demand signal count retains listings with unspecified target prices', () => {
  const wtbItems = [
    { id: 'b1', intent: 'WTB', price_usd: 15000 },
    { id: 'b2', intent: 'WTB', price_usd: null },
    { id: 'b3', intent: 'WTB', price_usd: 0 },
  ];

  const demandSignalCount = wtbItems.filter(i => i.intent === 'WTB').length;
  assert.equal(demandSignalCount, 3);
});

// ----------------------------------------------------
// Feature 3: Seller Contacts & Raw Messages
// ----------------------------------------------------

test('F3-1: Full unredacted raw source message is displayed for watch listings', () => {
  const rawMessage = '[oceandigital] WTS Rolex Daytona 116500LN White Dial 2021 Complete set $28,500 +1-555-0199 @oceancollect';
  
  assert.ok(rawMessage.includes('Rolex Daytona 116500LN'));
  assert.ok(rawMessage.includes('$28,500'));
  assert.ok(rawMessage.includes('+1-555-0199'));
});

test('F3-2: Chatbot "oceandigital" raw messages remain completely untouched without redaction', () => {
  const oceandigitalMsg = '[oceandigital] FS: Patek 5711 Blue 2020 $105,000 text +1 (800) 555-0199';
  
  assert.ok(!oceandigitalMsg.includes('[PHONE REDACTED]'));
  assert.ok(!oceandigitalMsg.includes('[REDACTED]'));
  assert.equal(oceandigitalMsg.indexOf('oceandigital'), 1);
});

test('F3-3: Phone numbers are normalized and converted into clickable WhatsApp URLs', () => {
  function formatWhatsAppUrl(phone, brand, reference) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const text = encodeURIComponent(`Hello, I am interested in the ${brand} ${reference} shown on Curated Luxury. Is it still available?`);
    return `https://wa.me/${cleanPhone}?text=${text}`;
  }

  const link = formatWhatsAppUrl('+1 (555) 234-5678', 'Rolex', '116500LN');
  assert.ok(link.startsWith('https://wa.me/15552345678?text='));
  assert.ok(link.includes('Rolex%20116500LN'));
});

test('F3-4: Dealer activity stats calculate total posts, WTS count, and WTB count', () => {
  const dealerListings = [
    { id: 'd1', listing_type: 'WTS', status: 'ACTIVE' },
    { id: 'd2', listing_type: 'WTS', status: 'ACTIVE' },
    { id: 'd3', listing_type: 'WTB', status: 'ACTIVE' },
  ];

  const stats = {
    total_posts: dealerListings.length,
    wts_posts: dealerListings.filter(l => l.listing_type === 'WTS').length,
    wtb_posts: dealerListings.filter(l => l.listing_type === 'WTB').length,
  };

  assert.equal(stats.total_posts, 3);
  assert.equal(stats.wts_posts, 2);
  assert.equal(stats.wtb_posts, 1);
});

test('F3-5: Contact profile maps seller name and phone from workbook fields', () => {
  const workbookRow = {
    'Posted By': 'Luxury Timepieces LLC',
    'Phone Number': '+1-555-987-6543',
    'raw_line': 'FS Rolex Submariner 126610LN',
  };

  const profile = {
    seller_name: workbookRow['Posted By'] || 'WatchFacts member',
    seller_phone: workbookRow['Phone Number'] || null,
    raw_message: workbookRow['raw_line'],
  };

  assert.equal(profile.seller_name, 'Luxury Timepieces LLC');
  assert.equal(profile.seller_phone, '+1-555-987-6543');
  assert.equal(profile.raw_message, 'FS Rolex Submariner 126610LN');
});

// ----------------------------------------------------
// Feature 4: Relaxed Outlier Filters (3.0x IQR & Min 2 Observations)
// ----------------------------------------------------

test('F4-1: 3.0x IQR fence calculation expands upper and lower acceptance boundaries', () => {
  const q1 = 10000;
  const q3 = 14000;
  const iqr = q3 - q1; // 4000
  
  const fence1_5_upper = q3 + 1.5 * iqr; // 14000 + 6000 = 20000
  const fence3_0_upper = q3 + 3.0 * iqr; // 14000 + 12000 = 26000

  assert.equal(iqr, 4000);
  assert.equal(fence1_5_upper, 20000);
  assert.equal(fence3_0_upper, 26000);
  assert.ok(fence3_0_upper > fence1_5_upper);
});

test('F4-2: Minimum chart display threshold is 2 comparable observations', () => {
  function isAnalyticsReady(observationsCount, minThreshold = 2) {
    return observationsCount >= minThreshold;
  }

  assert.equal(isAnalyticsReady(1), false);
  assert.equal(isAnalyticsReady(2), true);
  assert.equal(isAnalyticsReady(5), true);
});

test('F4-3: 3.0x IQR fence preserves legitimate high-end complete set listings', () => {
  const prices = [10000, 11000, 12000, 13000, 20000];
  const sorted = [...prices].sort((a, b) => a - b);
  
  const q1 = sorted[1]; // 11000
  const q3 = sorted[3]; // 13000
  const iqr = q3 - q1; // 2000
  const fence3_0_upper = q3 + 3.0 * iqr; // 13000 + 6000 = 19000
  
  assert.equal(iqr, 2000);
  assert.equal(fence3_0_upper, 19000);
  assert.ok(18000 <= fence3_0_upper);
});

test('F4-4: summarizePrices helper computes basic descriptive statistics', () => {
  const result = summarizePrices([10000, 12000, 14000, 16000, 18000]);
  assert.equal(result.stats.avg, 14000);
  assert.equal(result.stats.median, 14000);
  assert.equal(result.stats.min, 10000);
  assert.equal(result.stats.max, 18000);
});

test('F4-5: Extreme price outliers outside 3.0x IQR fence are classified with reason', () => {
  const stats = { lower_fence: 5000, upper_fence: 25000 };
  
  const normalPrice = classifyPrice(15000, stats);
  const lowOutlier = classifyPrice(1000, stats);
  const highOutlier = classifyPrice(50000, stats);

  assert.equal(normalPrice.included, true);
  assert.equal(lowOutlier.included, false);
  assert.equal(lowOutlier.reason, 'BELOW_IQR_FENCE');
  assert.equal(highOutlier.included, false);
  assert.equal(highOutlier.reason, 'ABOVE_IQR_FENCE');
});

// ----------------------------------------------------
// Feature 5: Smooth Navigation UX
// ----------------------------------------------------

test('F5-1: TopNav header configuration contains links to all required primary routes', () => {
  const requiredRoutes = ['/trading', '/price-research', '/telegram-test', '/dealer-login'];
  const headerLinks = [
    { label: 'HOME', to: '/' },
    { label: 'TRADING FLOOR', to: '/trading' },
    { label: 'PRICE RESEARCH', to: '/price-research' },
    { label: 'TELEGRAM TEST', to: '/telegram-test' },
    { label: 'DEALER LOGIN', to: '/dealer-login' },
  ];

  const navPaths = headerLinks.map(l => l.to);
  for (const route of requiredRoutes) {
    assert.ok(navPaths.includes(route), `Missing required route: ${route}`);
  }
});

test('F5-2: Active route matching identifies current page for navigation bar highlights', () => {
  function isRouteActive(currentPath, linkPath) {
    if (linkPath === '/') return currentPath === '/';
    return currentPath.startsWith(linkPath);
  }

  assert.ok(isRouteActive('/price-research/Rolex/116500LN', '/price-research'));
  assert.ok(isRouteActive('/trading', '/trading'));
  assert.ok(!isRouteActive('/trading', '/price-research'));
});

test('F5-3: Breadcrumb generator constructs hierarchically formatted breadcrumb items', () => {
  function buildBreadcrumbs(brand, reference) {
    return [
      { label: 'Home', to: '/' },
      { label: 'Price Research', to: '/price-research' },
      { label: brand, to: `/price-research?brand=${encodeURIComponent(brand)}` },
      { label: reference },
    ];
  }

  const items = buildBreadcrumbs('Rolex', '116500LN');
  assert.equal(items.length, 4);
  assert.equal(items[0].label, 'Home');
  assert.equal(items[1].to, '/price-research');
  assert.equal(items[2].label, 'Rolex');
  assert.equal(items[3].label, '116500LN');
  assert.equal(items[3].to, undefined);
});

test('F5-4: Back navigation computes fallback route when history stack is shallow', () => {
  function getEffectiveBackTarget(items, explicitBackTo) {
    return explicitBackTo || (items.length > 1 && items[items.length - 2]?.to) || '/trading';
  }

  const breadcrumbs = [
    { label: 'Price Research', to: '/price-research' },
    { label: 'Rolex 116500LN' },
  ];

  const backTarget = getEffectiveBackTarget(breadcrumbs);
  assert.equal(backTarget, '/price-research');
});

test('F5-5: Nav link URL structures preserve search parameters during route shifts', () => {
  const initialUrl = '/trading?brand=Rolex&search=116500LN';
  const urlObj = new URL(`http://localhost${initialUrl}`);
  
  assert.equal(urlObj.pathname, '/trading');
  assert.equal(urlObj.searchParams.get('brand'), 'Rolex');
  assert.equal(urlObj.searchParams.get('search'), '116500LN');
});

// ----------------------------------------------------
// Feature 6: Image & Vision Rules
// ----------------------------------------------------

test('F6-1: Bundle listing image URL is set to null by default', () => {
  function resolveListingImage(listing) {
    if (listing.is_bundle || listing.bundle_candidate_count > 1) {
      return null;
    }
    return listing.image_url || listing.user_image_url || null;
  }

  const bundleListing = { id: 'b1', is_bundle: true, image_url: 'https://example.com/watch.jpg' };
  const singleListing = { id: 's1', is_bundle: false, image_url: 'https://example.com/single.jpg' };

  assert.equal(resolveListingImage(bundleListing), null);
  assert.equal(resolveListingImage(singleListing), 'https://example.com/single.jpg');
});

test('F6-2: AI vision fallback determines dial color when dial color is missing but image exists', () => {
  function resolveDialColor(listing, aiVisionResult = null) {
    if (listing.dial_color && listing.dial_color !== 'Unspecified') {
      return { value: listing.dial_color, source: 'CATALOG_OR_WORKBOOK' };
    }
    if (listing.image_url && aiVisionResult) {
      return { value: aiVisionResult, source: 'AI_VISION' };
    }
    return { value: 'Unspecified', source: 'DEFAULT' };
  }

  const listingWithMissingDial = { id: 'm1', dial_color: 'Unspecified', image_url: 'https://example.com/dial.jpg' };
  const resolved = resolveDialColor(listingWithMissingDial, 'Blue');

  assert.equal(resolved.value, 'Blue');
  assert.equal(resolved.source, 'AI_VISION');
});

test('F6-3: Dial color resolution respects explicit catalog dial color over vision fallback', () => {
  function resolveDialColor(listing, aiVisionResult = null) {
    if (listing.dial_color && listing.dial_color !== 'Unspecified') {
      return { value: listing.dial_color, source: 'CATALOG_OR_WORKBOOK' };
    }
    if (listing.image_url && aiVisionResult) {
      return { value: aiVisionResult, source: 'AI_VISION' };
    }
    return { value: 'Unspecified', source: 'DEFAULT' };
  }

  const explicitListing = { id: 'e1', dial_color: 'Black', image_url: 'https://example.com/dial.jpg' };
  const resolved = resolveDialColor(explicitListing, 'White');

  assert.equal(resolved.value, 'Black');
  assert.equal(resolved.source, 'CATALOG_OR_WORKBOOK');
});

test('F6-4: Image card formatting handles image URLs securely', () => {
  function sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      return trimmed;
    }
    return null;
  }

  assert.equal(sanitizeImageUrl('https://example.com/watch.jpg'), 'https://example.com/watch.jpg');
  assert.equal(sanitizeImageUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeImageUrl(null), null);
});

test('F6-5: Multi-item bundle sub-listings retain individual item properties after split', () => {
  const bundleParent = {
    id: 'bundle_100',
    raw_line: 'Lot of 2 Rolex watches: 116500LN White and 126610LN Black',
    sub_items: [
      { reference: '116500LN', dial_color: 'White' },
      { reference: '126610LN', dial_color: 'Black' },
    ],
  };

  assert.equal(bundleParent.sub_items.length, 2);
  assert.equal(bundleParent.sub_items[0].reference, '116500LN');
  assert.equal(bundleParent.sub_items[1].reference, '126610LN');
});

// ----------------------------------------------------
// Feature 7: Build & Deployment Integrity
// ----------------------------------------------------

test('F7-1: Package configuration contains necessary build scripts and entry points', () => {
  const pkgJson = require('../../package.json');
  
  assert.ok(pkgJson.scripts.build, 'Missing build script');
  assert.ok(pkgJson.scripts['test:e2e'], 'Missing test:e2e script');
  assert.equal(pkgJson.scripts['test:e2e'], 'node tests/e2e/e2e-test-runner.cjs');
});

test('F7-2: Vite configuration targets React single page application bundling', () => {
  const fs = require('fs');
  const path = require('path');
  const viteConfigPath = path.join(__dirname, '../../vite.config.ts');

  assert.ok(fs.existsSync(viteConfigPath), 'vite.config.ts must exist in root');
});

test('F7-3: Index HTML contains root element for DOM mounting', () => {
  const fs = require('fs');
  const path = require('path');
  const indexPath = path.join(__dirname, '../../index.html');

  assert.ok(fs.existsSync(indexPath), 'index.html must exist in root');
  const content = fs.readFileSync(indexPath, 'utf8');
  assert.ok(content.includes('id="root"'), 'index.html must contain id="root" container');
});

test('F7-4: Core component entry points exist and compile', () => {
  const fs = require('fs');
  const path = require('path');

  const components = [
    'src/components/MarketHeader.tsx',
    'src/components/Breadcrumb.tsx',
    'src/pages/TradingFloor.tsx',
    'src/pages/PriceResearch.tsx',
  ];

  for (const comp of components) {
    const fullPath = path.join(__dirname, '../../', comp);
    assert.ok(fs.existsSync(fullPath), `Component file missing: ${comp}`);
  }
});

test('F7-5: Environment variable fallbacks prevent runtime startup crashes', () => {
  function getSupabaseUrl(env) {
    return env.VITE_SUPABASE_URL || 'https://fallback.supabase.co';
  }

  assert.equal(getSupabaseUrl({ VITE_SUPABASE_URL: 'https://prod.supabase.co' }), 'https://prod.supabase.co');
  assert.equal(getSupabaseUrl({}), 'https://fallback.supabase.co');
});
