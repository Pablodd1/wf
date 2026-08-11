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
  const footer = read('src/components/Footer.tsx');
  const postItem = read('src/pages/DealerSubmitListing.tsx');
  const styles = read('src/index.css');

  assert.match(header, /<Link to="\/" aria-label="Curated Luxury home"/);
  assert.match(header, /label: 'TRADING FLOOR', to: '\/trading'/);
  assert.match(header, /label: 'PRICE RESEARCH', to: '\/price-research'/);
  assert.match(header, /label: 'DEALER DIRECTORY', to: '\/dealers'/);
  assert.match(header, /label: 'POST IT', to: '\/dealer\/post'/);
  assert.doesNotMatch(header, /luxuryapp-wf-w5o1/);
  assert.match(header, /label: 'DEALER ACCOUNT', to: '\/dealer\/account\/profile'/);
  assert.match(header, /label: 'HIRE FI'/);
  assert.match(header, /const LANDING_LINKS: HeaderLink\[\] = \[[\s\S]*label: 'TRADING FLOOR'[\s\S]*label: 'PRICE RESEARCH'[\s\S]*label: 'HIRE FI'[\s\S]*label: 'MEMBERSHIP'[\s\S]*label: 'WORKSPACE', to: '\/dealer\/workspace'/);
  assert.doesNotMatch(header, /label: 'ADM PANEL'/);
  assert.match(header, /<LanguageToggle compact \/>/);
  assert.doesNotMatch(header, /!landing && <LanguageToggle/);
  assert.match(home, /<MarketHeader className="sticky top-0" landing \/>/);
  assert.match(footer, /\['POST IT', '\/dealer\/post'\]/);
  assert.doesNotMatch(home, /luxuryapp-wf\.vercel\.app/);
  assert.match(postItem, /const LUXURY_APP_URL = 'https:\/\/luxuryapp-wf\.vercel\.app\/'/);
  assert.match(postItem, /Curated Luxury form/);
  assert.match(postItem, /Luxury App/);
  assert.match(postItem, /<iframe[\s\S]*src=\{LUXURY_APP_URL\}[\s\S]*title="Luxury App posting experience"/);
  assert.match(postItem, /Open full page/);
  assert.match(footer, /to="\/cl-login"[\s\S]*CL Login/);
  assert.match(header, />Curated Luxury<\/span>/);
  assert.match(header, /bg-\[#f3ecdf\]\/95/);
  assert.doesNotMatch(header, />CL<\/span>/);
  assert.match(header, /overflow-x-auto/);
  assert.match(header, /h-11 shrink-0/);
  assert.match(header, /location\.pathname === '\/trading' && !wantsToBuy/);
  assert.match(header, /link\.to === '\/trading\?type=WTB'[\s\S]*\? wantsToBuy/);
  assert.match(banner, /href="https:\/\/luxfi\.ai\/#add-fi"/);
  assert.match(home, /The trading floor for the world's dealer network/);
  assert.match(home, /Your AI agent, negotiating every match/);
  assert.match(home, /From chat noise to a closed trade/);
  assert.match(home, /Built on trust, not just volume/);
  assert.match(home, /id="membership"/);
  assert.match(home, /\$150/);
  assert.match(styles, /@keyframes luxury-gold-flow-down/);
  assert.match(styles, /animation: luxury-gold-flow-down 6s ease-in-out infinite/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(footer, /Curated Luxury marketplace intelligence for exceptional objects/);
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

  assert.match(floor, /media\.matches \? 24 : 50/);
  assert.match(floor, /function hasListingImage/);
  assert.match(floor, /function isValidListingImageUrl/);
  assert.match(floor, /function listingImageUrl/);
  assert.match(floor, /\^https\?:\\\/\\\/\[\^\\s\]\+\$/);
  assert.doesNotMatch(floor, /if \(listing\.has_images\) return true/);
  assert.match(floor, /const endpoint = '\/api\/reviewed-market-inventory'/);
  assert.doesNotMatch(floor, /fetch\(`\/api\/ingest\?/);
  assert.match(floor, /params\.set\('images', 'true'\)/);
  assert.match(floor, /Price requires review/);
  assert.match(floor, /Workbook price anomaly - held for review/);
  assert.match(floor, /filter\(listing => !isBundleListing\(listing\)\)/);
  assert.match(floor, /listing\.multi_listing \|\| listing\.is_unbundled_child/);
  assert.match(floor, /'MULTI', 'MULTI_LISTING', 'BUNDLE'/);
  assert.match(floor, /Number\(hasListingImage\(right\)\) - Number\(hasListingImage\(left\)\)/);
  assert.match(floor, /aria-label="Trading Floor pages"/);
  assert.match(floor, /Page \{cursorHistory\.length \+ 1\}/);
  assert.match(floor, /onUnavailable=\{\(\) => setImageAvailable\(false\)\}/);
  assert.match(floor, /onError=\{onUnavailable\}/);
  assert.doesNotMatch(floor, /Reference image · not seller photo/);
  assert.doesNotMatch(floor, /\/api\/featured-listings/);
  assert.match(floor, /fetch\(`\/api\/reviewed-seller-summary\?id=/);
  assert.match(floor, /Original raw message/);
  assert.match(floor, /Source poster activity/);
  assert.doesNotMatch(floor, /EvidenceIndicators|aria-label="Listing evidence"/);
  assert.doesNotMatch(floor, /per request keeps mobile memory bounded/);
  assert.doesNotMatch(floor, /top_watches_trading_floor\.json/);
});

test('Trading Floor and Price Research share controlled featured reference shortcuts', () => {
  const shortcuts = read('src/components/PriorityReferenceShortcuts.tsx');
  const cohorts = read('src/data/priorityReferenceCohorts.ts');
  const floor = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');

  assert.match(cohorts, /116500LN/);
  assert.match(cohorts, /5712\/1A-001/);
  assert.match(cohorts, /tradingQuery: '5712'/);
  assert.match(shortcuts, /Featured research/);
  assert.match(floor, /mode="trading"/);
  assert.match(research, /mode="research"/);
});

test('dealer and CL login keep authentication but omit preview access and marketing panels', () => {
  const login = read('src/pages/DealerLogin.tsx');

  assert.match(login, /<form onSubmit=\{login\}/);
  assert.match(login, /fetch\('\/api\/dealer-auth'/);
  assert.match(login, /location\.pathname === '\/cl-login'/);
  assert.match(login, /Sign in is required to access Price Research/);
  assert.match(login, /CL administrator sign-in is required for the control dashboard/);
  assert.doesNotMatch(login, /betaDestinations|skipForBeta|Continue to dealer preview/);
  assert.doesNotMatch(login, /Continue without login to Price Research/);
  assert.doesNotMatch(login, /Controlled dealer access/i);
  assert.doesNotMatch(login, /Your market operations workspace/i);
  assert.doesNotMatch(login, /Accounts are provisioned by WatchFacts/i);
});

test('CL control access is kept in the customer footer', () => {
  const app = read('src/App.tsx');
  const home = read('src/pages/LandingPage.tsx');
  const footer = read('src/components/Footer.tsx');

  assert.match(app, /path="\/cl-login" element=\{<DealerLogin \/>\}/);
  assert.match(app, /path="\/dashboard"[\s\S]*allowedRoles=\{\['admin'\]\}/);
  assert.match(footer, /to="\/cl-login"[\s\S]*CL Login/);
});

test('customer workflows expose direct official Curated Luxury contact and community links', () => {
  const footer = read('src/components/Footer.tsx');
  const floor = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');

  assert.match(footer, /CONTACT_WHATSAPP_URL/);
  assert.match(footer, /COMMUNITY_GROUPS/);
  assert.match(footer, /target="_blank"/);
  assert.match(footer, /rel="noreferrer"/);
  assert.match(floor, /import \{ Footer \}/);
  assert.match(research, /Footer as CommunityFooter/);
});
