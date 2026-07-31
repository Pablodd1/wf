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
  const postItem = read('src/pages/DealerSubmitListing.tsx');
  const styles = read('src/index.css');

  assert.match(header, /label: 'HOME', to: '\/'/);
  assert.match(header, /label: 'TRADING FLOOR', to: '\/trading'/);
  assert.match(header, /label: 'WANT TO BUY', to: '\/trading\?type=WTB'/);
  assert.match(header, /label: 'PRICE RESEARCH', to: '\/price-research'/);
  assert.match(header, /label: 'POST ITEM', to: '\/dealer\/post'/);
  assert.doesNotMatch(header, /luxuryapp-wf-w5o1/);
  assert.match(header, /label: 'ACCOUNT', to: '\/dealer\/account\/profile'/);
  assert.match(header, /label: 'HIRE FI'/);
  assert.match(header, /const LANDING_LINKS = \[[\s\S]*label: 'TRADING FLOOR'[\s\S]*label: 'HIRE FI'[\s\S]*label: 'LOGIN'/);
  assert.match(home, /<MarketHeader className="sticky top-0" landing \/>/);
  assert.match(home, /to="\/dealer\/post"[\s\S]*Post an offer/);
  assert.doesNotMatch(home, /luxuryapp-wf\.vercel\.app/);
  assert.match(postItem, /const LUXURY_APP_URL = 'https:\/\/luxuryapp-wf\.vercel\.app\/'/);
  assert.match(postItem, /WatchFacts form/);
  assert.match(postItem, /Luxury App/);
  assert.match(postItem, /<iframe[\s\S]*src=\{LUXURY_APP_URL\}[\s\S]*title="Luxury App posting experience"/);
  assert.match(postItem, /Open full page/);
  assert.match(home, /const LUXURY_MARKETPLACE_URL = 'https:\/\/luxuryapp-wf-w5o1\.vercel\.app\/marketplace\/'/);
  assert.match(home, /Luxury item marketplace/);
  assert.match(home, /href=\{LUXURY_MARKETPLACE_URL\}[\s\S]*target="_blank"[\s\S]*rel="noreferrer"/);
  assert.match(home, /to="\/admin-login"[\s\S]*Admin login/);
  assert.match(header, /src="\/images\/curated-luxury-logo-dark\.png"/);
  assert.match(header, /alt="Curated Luxury"/);
  assert.doesNotMatch(header, />CL<\/span>/);
  assert.match(header, /overflow-x-auto/);
  assert.match(header, /h-11 shrink-0/);
  assert.match(header, /location\.pathname === '\/trading' && !wantsToBuy/);
  assert.match(header, /link\.to === '\/trading\?type=WTB'[\s\S]*\? wantsToBuy/);
  assert.match(banner, /href="https:\/\/luxfi\.ai\/#add-fi"/);
  assert.match(floor, /<MarketNav \/>[\s\S]*<LuxFiBanner \/>/);
  assert.match(research, /<MarketNav \/>[\s\S]*<LuxFiBanner \/>/);
  assert.match(home, /className="luxury-wordmark/);
  assert.match(styles, /@keyframes luxury-gold-flow-down/);
  assert.match(styles, /animation: luxury-gold-flow-down 6s ease-in-out infinite/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
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

test('Trading Floor uses the server-ranked reviewed release and fails closed on images', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.match(floor, /media\.matches \? 24 : 100/);
  assert.match(floor, /function hasListingImage/);
  assert.match(floor, /'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'/);
  assert.match(floor, /fetch\(`\/api\/reviewed-market-inventory\?/);
  assert.doesNotMatch(floor, /fetch\(`\/api\/ingest\?/);
  assert.match(floor, /Listings with images first; highest listed price next\./);
  assert.doesNotMatch(floor, /Data under review/);
  assert.doesNotMatch(floor, /Price under review/);
  assert.doesNotMatch(floor, /Exact source currency is being verified/);
  assert.match(floor, /setListings\(nextListings\)/);
  assert.match(floor, /aria-label="Trading Floor pages"/);
  assert.match(floor, /Page \{cursorHistory\.length \+ 1\}/);
  assert.match(floor, /onUnavailable=\{\(\) => setImageAvailable\(false\)\}/);
  assert.match(floor, /onError=\{onUnavailable\}/);
  assert.doesNotMatch(floor, /Reference image · not seller photo/);
  assert.doesNotMatch(floor, /\/api\/featured-listings/);
  assert.match(floor, /fetch\(`\/api\/reviewed-seller-summary\?id=/);
  assert.match(floor, /Raw source message/);
  assert.match(floor, /Source poster activity/);
  assert.doesNotMatch(floor, /per request keeps mobile memory bounded/);
  assert.doesNotMatch(floor, /top_watches_trading_floor\.json/);
});

test('dealer login keeps authentication but omits the removed marketing panel', () => {
  const login = read('src/pages/DealerLogin.tsx');

  assert.match(login, /<form onSubmit=\{login\}/);
  assert.match(login, /fetch\('\/api\/dealer-auth'/);
  assert.match(login, /location\.pathname === '\/admin-login'/);
  assert.match(login, /Sign in is required to access Price Research/);
  assert.match(login, /const betaDestinations = new Set\(\['\/dealer', '\/trading'\]\)/);
  assert.doesNotMatch(login, /Continue without login to Price Research/);
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
