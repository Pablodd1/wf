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

  assert.match(header, /label: 'HOME', to: '\/'/);
  assert.match(header, /label: 'TRADING FLOOR', to: '\/trading'/);
  assert.match(header, /label: 'WANT TO BUY', to: '\/trading\?type=WTB'/);
  assert.match(header, /label: 'PRICE RESEARCH', to: '\/price-research'/);
  assert.match(header, /label: 'POST ITEM', to: '\/dealer\/post'/);
  assert.match(header, /label: 'ACCOUNT', to: '\/dealer\/account\/profile'/);
  assert.match(header, /label: 'HIRE FI'/);
  assert.match(header, /overflow-x-auto/);
  assert.match(header, /h-11 shrink-0/);
  assert.match(header, /location\.pathname === '\/trading' && !wantsToBuy/);
  assert.match(header, /link\.to === '\/trading\?type=WTB'[\s\S]*\? wantsToBuy/);
  assert.match(banner, /href="https:\/\/luxfi\.ai\/#add-fi"/);
  assert.match(floor, /<MarketNav \/>[\s\S]*<LuxFiBanner \/>/);
  assert.match(research, /<MarketNav \/>[\s\S]*<LuxFiBanner \/>/);
});

test('Trading Floor watch view does not render internal listing labels or identifiers', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.doesNotMatch(floor, />\s*Listing Details\s*</i);
  assert.doesNotMatch(floor, /Listing\s*\{\s*listing\.id\s*\}/);
  assert.doesNotMatch(floor, /Close listing details/i);
  assert.match(floor, /aria-label="Close selected watch"/);
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
  assert.match(cta, /1,322,815\+ listings · 30,609\+ global dealers · 132 countries/);
  assert.match(cta, /https:\/\/watchfacts\.com\/buy\/all\?listing_type=sale&displayModal=hide&tradingFloorStats%5Bid%5D=1&tradingFloorStats%5Btotal_listings%5D=1322815&tradingFloorStats%5Btotal_dealers%5D=30609&tradingFloorStats%5Btotal_countries%5D=132#/);
  assert.match(cta, /target="_blank"/);
  assert.match(cta, /rel="noreferrer"/);
  assert.match(floor, /<JoinGroupsCta dark \/>/);
  assert.match(research, /<JoinGroupsCta \/>/);
});
