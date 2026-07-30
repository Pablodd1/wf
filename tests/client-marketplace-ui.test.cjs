const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('customer marketplace has direct primary navigation and the approved Hire Fi banner', () => {
  const header = read('src/components/MarketHeader.tsx');
  const banner = read('src/components/LuxFiBanner.tsx');
  const floor = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');
  const home = read('src/pages/LandingPage.tsx');

  assert.match(header, /label: 'HOME', to: '\/'/);
  assert.match(header, /label: 'TRADING FLOOR', to: '\/trading'/);
  assert.match(header, /label: 'WANT TO BUY', to: '\/trading\?type=WTB'/);
  assert.match(header, /label: 'PRICE RESEARCH', to: '\/price-research'/);
  assert.match(header, /const LUXURY_APP_POST_ITEM_URL = 'https:\/\/luxuryapp-wf-w5o1\.vercel\.app\/'/);
  assert.match(header, /label: 'POST ITEM', href: LUXURY_APP_POST_ITEM_URL, external: true/);
  assert.match(header, /label: 'ACCOUNT', to: '\/dealer\/account\/profile'/);
  assert.match(header, /label: 'HIRE FI'/);
  assert.match(header, /overflow-x-auto/);
  assert.match(header, /h-11 shrink-0/);
  assert.match(header, /location\.pathname === '\/trading' && !wantsToBuy/);
  assert.match(header, /link\.to === '\/trading\?type=WTB'[\s\S]*\? wantsToBuy/);
  assert.match(banner, /href="https:\/\/luxfi\.ai\/#add-fi"/);
  assert.match(floor, /<MarketNav \/>[\s\S]*<LuxFiBanner \/>/);
  assert.match(research, /<MarketNav \/>[\s\S]*<LuxFiBanner \/>/);
  assert.match(home, /Curated Luxury marketplace · WatchFacts market intelligence/);
});

test('Trading Floor watch view does not render internal listing labels or identifiers', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.doesNotMatch(floor, />\s*Listing Details\s*</i);
  assert.doesNotMatch(floor, /Listing\s*\{\s*listing\.id\s*\}/);
  assert.doesNotMatch(floor, /Close listing details/i);
  assert.doesNotMatch(floor, /Price rating/);
  assert.doesNotMatch(floor, /Price when posted/);
  assert.match(floor, /aria-label="Close selected watch"/);
});

test('Trading Floor shows image-backed listings before price-ranked rows', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.match(floor, /media\.matches \? 48 : 100/);
  assert.match(floor, /function hasListingImage/);
  assert.match(floor, /function priceEvidenceRank/);
  assert.match(floor, /function verifiedUsdPrice/);
  assert.match(floor, /Number\(hasListingImage\(right\)\) - Number\(hasListingImage\(left\)\)[\s\S]*verifiedUsdPrice\(right\) - verifiedUsdPrice\(left\)/);
  assert.match(floor, /Listings with images first; highest verified USD price next\./);
  assert.doesNotMatch(floor, /Data under review/);
  assert.doesNotMatch(floor, /Price under review/);
  assert.doesNotMatch(floor, /Exact source currency is being verified/);
  assert.match(floor, /setListings\(current => sortListingsForDisplay/);
});

test('dealer login keeps authentication but omits the removed marketing panel', () => {
  const login = read('src/pages/DealerLogin.tsx');

  assert.match(login, /<form onSubmit=\{login\}/);
  assert.match(login, /fetch\('\/api\/dealer-auth'/);
  assert.doesNotMatch(login, /Controlled dealer access/i);
  assert.doesNotMatch(login, /Your market operations workspace/i);
  assert.doesNotMatch(login, /Accounts are provisioned by WatchFacts/i);
});

test('customer workflows link to the official WatchFacts groups marketplace with public metrics', () => {
  const cta = read('src/components/JoinGroupsCta.tsx');
  const floor = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');

  assert.match(cta, /JOIN THE GROUPS/);
  assert.match(cta, /2\.7M\+ listings · 30,609\+ global dealers · 132 countries/);
  assert.match(cta, /https:\/\/watchfacts\.com\/buy\/all\?listing_type=sale&displayModal=hide&tradingFloorStats%5Bid%5D=1&tradingFloorStats%5Btotal_listings%5D=1322815&tradingFloorStats%5Btotal_dealers%5D=30609&tradingFloorStats%5Btotal_countries%5D=132#/);
  assert.match(cta, /target="_blank"/);
  assert.match(cta, /rel="noreferrer"/);
  assert.match(floor, /<JoinGroupsCta dark \/>/);
  assert.match(research, /<JoinGroupsCta \/>/);
});
