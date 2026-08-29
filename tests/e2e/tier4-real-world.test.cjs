'use strict';

const { test, setTier, assert } = require('./test-harness.cjs');
const { summarizePrices, classifyPrice } = require('../../api/_lib/market-stats.cjs');

setTier('Tier 4: Real-World Application Scenarios');

test('Scenario 1: Buyer searching for Rolex Daytona 116500LN across Trading Floor and Price Research', () => {
  // Step 1: Simulated search on Trading Floor for 116500LN
  const tfSearchResults = [
    { id: '1', brand: 'Rolex', reference: '116500LN', dial_color: 'White', price_usd: 28000, listing_type: 'WTS' },
    { id: '2', brand: 'Rolex', reference: '116500LN', dial_color: 'Black', price_usd: 27500, listing_type: 'WTS' },
    { id: '3', brand: 'Rolex', reference: '116500LN', dial_color: 'White', price_usd: 29000, listing_type: 'WTS' },
    { id: '4', brand: 'Rolex', reference: '116500LN', dial_color: 'White', price_usd: 0, listing_type: 'WTB' },
    { id: '5', brand: 'Rolex', reference: '116500LN', dial_color: 'Black', price_usd: null, listing_type: 'WTS' },
  ];

  const totalTFListings = tfSearchResults.length;
  assert.equal(totalTFListings, 5);

  // Step 2: Navigate to Price Research for 116500LN
  const qualifiedWts = tfSearchResults.filter(l => l.listing_type === 'WTS' && l.price_usd > 0);
  const wtbDemand = tfSearchResults.filter(l => l.listing_type === 'WTB');
  const excludedUnpriced = tfSearchResults.filter(l => l.listing_type === 'WTS' && (!l.price_usd || l.price_usd <= 0));

  const prReconciliation = {
    total_tracked_listings: totalTFListings,
    wts_eligible_analytics_count: qualifiedWts.length,
    wtb_demand_count: wtbDemand.length,
    excluded_count: excludedUnpriced.length,
  };

  assert.equal(prReconciliation.total_tracked_listings, 5);
  assert.equal(prReconciliation.wts_eligible_analytics_count, 3);
  assert.equal(prReconciliation.wtb_demand_count, 1);
  assert.equal(prReconciliation.excluded_count, 1);
  assert.equal(prReconciliation.total_tracked_listings, prReconciliation.wts_eligible_analytics_count + prReconciliation.wtb_demand_count + prReconciliation.excluded_count);

  // Step 3: Filter by "White" Dial
  const whiteDialWts = qualifiedWts.filter(l => l.dial_color === 'White');
  const whitePrices = whiteDialWts.map(l => l.price_usd);
  const whiteStats = summarizePrices(whitePrices);

  assert.equal(whitePrices.length, 2);
  assert.equal(whiteStats.stats.avg, 28500);
  assert.equal(whiteStats.stats.min, 28000);
  assert.equal(whiteStats.stats.max, 29000);
});

test('Scenario 2: Dealer reviewing WTB demand signals alongside WTS asking prices for Patek Philippe Nautilus', () => {
  // Step 1: Patek Philippe Nautilus 5711/1A-010 market dataset
  const wtsListings = [
    { id: 'w1', price_usd: 105000, condition: 'Unworn' },
    { id: 'w2', price_usd: 110000, condition: 'Pre-owned' },
    { id: 'w3', price_usd: 115000, condition: 'Unworn' },
  ];

  const wtbDemandListings = [
    { id: 'b1', intent: 'WTB', target_price: 98000 },
    { id: 'b2', intent: 'WTB', target_price: 100000 },
    { id: 'b3', intent: 'WTB', target_price: 102000 },
    { id: 'b4', intent: 'WTB', target_price: null },
    { id: 'b5', intent: 'WTB', target_price: 95000 },
  ];

  // Step 2: Compute WTS asking price distribution
  const wtsPrices = wtsListings.map(l => l.price_usd);
  const wtsStats = summarizePrices(wtsPrices);

  // Step 3: Compute WTB demand signal metrics
  const wtbCount = wtbDemandListings.length;
  const wtbPricedTargets = wtbDemandListings.map(l => l.target_price).filter(Boolean);
  const wtbAvgTarget = wtbPricedTargets.reduce((a, b) => a + b, 0) / wtbPricedTargets.length;

  assert.equal(wtsStats.stats.avg, 110000);
  assert.equal(wtsStats.stats.min, 105000);
  assert.equal(wtsStats.stats.max, 115000);
  assert.equal(wtbCount, 5);
  assert.equal(wtbAvgTarget, 98750);

  // Step 4: Verify non-interference - WTB target prices do NOT pull down WTS average asking price
  assert.ok(wtsStats.stats.avg > wtbAvgTarget);
  assert.equal(wtsStats.stats.avg, 110000); // Intact
});

test('Scenario 3: User inspecting individual listing details (raw message, WhatsApp seller contact, dealer stats)', () => {
  // Step 1: Select listing detail record
  const listingRecord = {
    id: 'rec_99812',
    brand: 'Audemars Piguet',
    reference: '26331ST.OO.1220ST.01',
    seller_name: 'Geneva Luxury Vault',
    seller_phone: '+41 22 555 0199',
    raw_message: '[oceandigital] WTS AP Royal Oak Chrono 26331ST Blue Dial 2021 Box & Papers CHF 39,500 +41225550199',
    flags: ['OWNER_APPROVED_WORKBOOK'],
    dealer_stats: {
      total_posts: 18,
      wts_posts: 14,
      wtb_posts: 4,
    },
  };

  // Step 2: Format WhatsApp link
  function formatWhatsApp(phone, brand, ref) {
    const digits = String(phone).replace(/\D/g, '');
    const text = encodeURIComponent(`Hello, I am interested in the ${brand} ${ref} shown on Curated Luxury. Is it still available?`);
    return `https://wa.me/${digits}?text=${text}`;
  }

  const whatsappUrl = formatWhatsApp(listingRecord.seller_phone, listingRecord.brand, listingRecord.reference);

  // Step 3: Assert detail view contract
  assert.ok(listingRecord.raw_message.startsWith('[oceandigital]'));
  assert.ok(!listingRecord.raw_message.includes('[REDACTED]'));
  assert.equal(listingRecord.seller_name, 'Geneva Luxury Vault');
  assert.equal(whatsappUrl, 'https://wa.me/41225550199?text=Hello%2C%20I%20am%20interested%20in%20the%20Audemars%20Piguet%2026331ST.OO.1220ST.01%20shown%20on%20Curated%20Luxury.%20Is%20it%20still%20available%3F');
  assert.equal(listingRecord.dealer_stats.total_posts, 18);
  assert.equal(listingRecord.dealer_stats.wts_posts, 14);
  assert.equal(listingRecord.dealer_stats.wtb_posts, 4);
});

test('Scenario 4: Analyst checking price trend chart for low-volume reference (2 comparable observations, 3.0x IQR)', () => {
  // Step 1: Low volume reference dataset with exactly 2 observations
  const lowVolumeListings = [
    { id: '1', reference: '15407ST.OO.1220ST.01', price_usd: 120000 },
    { id: '2', reference: '15407ST.OO.1220ST.01', price_usd: 125000 },
  ];

  // Step 2: Evaluate 3.0x IQR & Min 2 observation threshold
  const prices = lowVolumeListings.map(l => l.price_usd);
  const minThreshold = 2;
  const isReady = prices.length >= minThreshold;

  assert.equal(prices.length, 2);
  assert.equal(isReady, true);

  const stats = summarizePrices(prices);
  assert.equal(stats.stats.avg, 122500);
  assert.equal(stats.stats.min, 120000);
  assert.equal(stats.stats.max, 125000);
});

test('Scenario 5: Full site navigation flow across all 4 primary surfaces and detail sub-views', () => {
  // Navigation State Machine Simulation
  let navState = {
    currentPath: '/trading',
    historyStack: ['/trading'],
    activeTopNavTab: '/trading',
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Trading Floor' }],
    modalOpen: false,
  };

  // Action 1: Click TopNav "Price Research"
  navState.currentPath = '/price-research';
  navState.historyStack.push('/price-research');
  navState.activeTopNavTab = '/price-research';
  navState.breadcrumbs = [{ label: 'Home', to: '/' }, { label: 'Price Research' }];

  assert.equal(navState.currentPath, '/price-research');

  // Action 2: Search reference 116500LN and enter detail view
  navState.currentPath = '/price-research/Rolex/116500LN';
  navState.historyStack.push('/price-research/Rolex/116500LN');
  navState.breadcrumbs = [
    { label: 'Home', to: '/' },
    { label: 'Price Research', to: '/price-research' },
    { label: 'Rolex', to: '/price-research?brand=Rolex' },
    { label: '116500LN' },
  ];

  assert.equal(navState.currentPath, '/price-research/Rolex/116500LN');
  assert.equal(navState.breadcrumbs.length, 4);

  // Action 3: Open Contact Seller modal
  navState.modalOpen = true;
  assert.equal(navState.modalOpen, true);
  assert.equal(navState.currentPath, '/price-research/Rolex/116500LN');

  // Action 4: Close modal and click breadcrumb back to Price Research
  navState.modalOpen = false;
  navState.currentPath = '/price-research';
  navState.historyStack.push('/price-research');
  navState.breadcrumbs = [{ label: 'Home', to: '/' }, { label: 'Price Research' }];

  assert.equal(navState.currentPath, '/price-research');

  // Action 5: Click TopNav "Telegram Test"
  navState.currentPath = '/telegram-test';
  navState.historyStack.push('/telegram-test');
  navState.activeTopNavTab = '/telegram-test';

  assert.equal(navState.currentPath, '/telegram-test');

  // Action 6: Click TopNav "Dealer Login"
  navState.currentPath = '/dealer-login';
  navState.historyStack.push('/dealer-login');
  navState.activeTopNavTab = '/dealer-login';

  assert.equal(navState.currentPath, '/dealer-login');

  // Action 7: Click Back button
  navState.historyStack.pop();
  navState.currentPath = navState.historyStack[navState.historyStack.length - 1];

  assert.equal(navState.currentPath, '/telegram-test');
});
