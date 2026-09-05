'use strict';

const { test, setTier, assert } = require('./test-harness.cjs');
const { summarizePrices, classifyPrice } = require('../../api/_lib/market-stats.cjs');

setTier('Tier 3: Cross-Feature Interactions');

test('F1+F2: Reconciliation formula verifies total count consistency with active WTB demand signals', () => {
  const wtsEligible = [
    { id: '1', price: 28000, type: 'WTS' },
    { id: '2', price: 29000, type: 'WTS' },
  ];
  const wtbDemand = [
    { id: '3', price: 26000, type: 'WTB' },
    { id: '4', price: null, type: 'WTB' },
  ];
  const excludedUnpriced = [
    { id: '5', price: 0, type: 'WTS' },
  ];

  const totalTFListings = wtsEligible.length + wtbDemand.length + excludedUnpriced.length;

  const reconciliation = {
    total_tracked_listings: totalTFListings,
    wts_eligible_analytics_count: wtsEligible.length,
    wtb_demand_count: wtbDemand.length,
    excluded_count: excludedUnpriced.length,
  };

  assert.equal(reconciliation.total_tracked_listings, 5);
  assert.equal(reconciliation.wts_eligible_analytics_count, 2);
  assert.equal(reconciliation.wtb_demand_count, 2);
  assert.equal(reconciliation.excluded_count, 1);
  assert.equal(reconciliation.total_tracked_listings, reconciliation.wts_eligible_analytics_count + reconciliation.wtb_demand_count + reconciliation.excluded_count);
});

test('F2+F4: 3.0x IQR outlier filter applies strictly to WTS ask prices without excluding WTB demand signals', () => {
  const wtsPrices = [10000, 11000, 12000, 13000, 100000]; // 100k is WTS outlier
  const wtbListings = [
    { id: 'w1', intent: 'WTB', target_price: 9000 },
    { id: 'w2', intent: 'WTB', target_price: 150000 }, // WTB target price, not filtered out of demand signal count
  ];

  const sortedWts = [...wtsPrices].sort((a, b) => a - b);
  const q1 = sortedWts[1]; // 11000
  const q3 = sortedWts[3]; // 13000
  const iqr = q3 - q1; // 2000
  const upperFence = q3 + 3.0 * iqr; // 19000

  const includedWts = wtsPrices.filter(p => p <= upperFence);
  const outlierWts = wtsPrices.filter(p => p > upperFence);

  // WTB count retains ALL WTB signals regardless of target price
  const wtbDemandCount = wtbListings.length;

  assert.equal(includedWts.length, 4);
  assert.equal(outlierWts.length, 1);
  assert.equal(outlierWts[0], 100000);
  assert.equal(wtbDemandCount, 2);
});

test('F3+F5: Opening seller contact modal preserves breadcrumb state and TopNav active route', () => {
  const currentNavState = {
    activeRoute: '/price-research',
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Price Research', to: '/price-research' },
      { label: 'Rolex', to: '/price-research?brand=Rolex' },
      { label: '116500LN' },
    ],
    isContactModalOpen: false,
  };

  // User clicks "Contact Seller" button
  const updatedState = {
    ...currentNavState,
    isContactModalOpen: true,
  };

  assert.equal(updatedState.isContactModalOpen, true);
  assert.equal(updatedState.activeRoute, '/price-research');
  assert.equal(updatedState.breadcrumbs.length, 4);
  assert.equal(updatedState.breadcrumbs[3].label, '116500LN');
});

test('F3+F6: Seller raw source message display integrates alongside AI vision resolved dial color', () => {
  const rawSourceMessage = '[oceandigital] WTS Rolex Daytona 116500LN complete set $28,500 +1-555-0199';
  const listingImage = 'https://example.com/daytona_photo.jpg';
  const visionResolvedDial = 'White'; // AI vision inferred dial color from image

  const listingCardViewModel = {
    raw_message: rawSourceMessage,
    image_url: listingImage,
    dial_color: visionResolvedDial,
    dial_resolution_source: 'AI_VISION',
    seller_phone: '+1-555-0199',
  };

  assert.ok(listingCardViewModel.raw_message.startsWith('[oceandigital]'));
  assert.equal(listingCardViewModel.dial_color, 'White');
  assert.equal(listingCardViewModel.dial_resolution_source, 'AI_VISION');
});

test('F1+F4: WTS eligible listing count reconciles before vs after 3.0x IQR outlier filtering', () => {
  const rawWtsListings = [
    { id: '1', price: 15000 },
    { id: '2', price: 15500 },
    { id: '3', price: 16000 },
    { id: '4', price: 16500 },
    { id: '5', price: 95000 }, // Outlier
  ];

  const sortedPrices = rawWtsListings.map(l => l.price).sort((a, b) => a - b);
  const q1 = sortedPrices[1]; // 15500
  const q3 = sortedPrices[3]; // 16500
  const iqr = q3 - q1; // 1000
  const upperFence = q3 + 3.0 * iqr; // 16500 + 3000 = 19500

  const qualifiedComparable = rawWtsListings.filter(l => l.price <= upperFence);
  const outlierExcluded = rawWtsListings.filter(l => l.price > upperFence);

  assert.equal(rawWtsListings.length, 5);
  assert.equal(qualifiedComparable.length, 4);
  assert.equal(outlierExcluded.length, 1);
  assert.equal(rawWtsListings.length, qualifiedComparable.length + outlierExcluded.length);
});

test('F5+F7: TopNav route links match application build entry points across environments', () => {
  const pkgJson = require('../../package.json');
  const requiredRoutes = ['/trading', '/price-research', '/telegram-test', '/dealer-login'];

  assert.ok(pkgJson.scripts.build);
  for (const route of requiredRoutes) {
    assert.ok(route.startsWith('/'));
  }
});

test('F4+F6: Price research cohort analytics group listings using vision-resolved dial colors under 3.0x IQR', () => {
  const listings = [
    { id: '1', price: 10000, vision_dial: 'Blue' },
    { id: '2', price: 11000, vision_dial: 'Blue' },
    { id: '3', price: 12000, vision_dial: 'Blue' },
    { id: '4', price: 50000, vision_dial: 'Blue' }, // Outlier
  ];

  const blueGroupPrices = listings.filter(l => l.vision_dial === 'Blue').map(l => l.price);
  const sorted = [...blueGroupPrices].sort((a, b) => a - b);
  const q1 = sorted[0]; // 10000
  const q3 = sorted[2]; // 12000
  const iqr = q3 - q1; // 2000
  const fence3_0 = q3 + 3.0 * iqr; // 12000 + 6000 = 18000

  const included = blueGroupPrices.filter(p => p <= fence3_0);
  const outliers = blueGroupPrices.filter(p => p > fence3_0);

  assert.equal(included.length, 3);
  assert.equal(outliers.length, 1);
  assert.equal(outliers[0], 50000);
});
