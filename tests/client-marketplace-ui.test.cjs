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
  assert.match(header, /label: 'LANDING PAGE', to: '\/'/);
  assert.match(header, /label: 'PRICE RESEARCH', to: '\/price-research'/);
  assert.match(header, /label: 'REFERENCE CHECK', to: '\/reference-check'/);
  assert.match(header, /label: 'POST IT', to: '\/dealer\/post'/);
  assert.doesNotMatch(header, /luxuryapp-wf-w5o1/);
  assert.match(header, /label: 'DEALER ACCOUNT', to: '\/dealer\/account\/profile'/);
  assert.match(header, /label: 'HIRE FI'/);
  const landingLinks = header.match(/const LANDING_LINKS: HeaderLink\[\] = \[[\s\S]*?\];/)?.[0] || '';
  assert.match(landingLinks, /label: 'TRADING FLOOR', to: '\/trading'/);
  assert.match(landingLinks, /label: 'PRICE RESEARCH', to: '\/price-research'/);
  assert.match(landingLinks, /label: 'POST IT', to: '\/dealer\/post'/);
  assert.match(landingLinks, /label: 'HIRE FI'/);
  assert.match(landingLinks, /label: 'VIRTUAL AUTHENTICATOR'[\s\S]*VIRTUAL_AUTHENTICATOR_URL/);
  assert.match(landingLinks, /label: 'WORKSPACE', to: '\/dealer\/workspace'/);
  assert.doesNotMatch(landingLinks, /MEMBERSHIP/);
  assert.doesNotMatch(header, /label: 'ADM PANEL'/);
  assert.match(header, /<LanguageToggle compact \/>/);
  assert.doesNotMatch(header, /!landing && <LanguageToggle/);
  assert.match(home, /<MarketHeader className="sticky top-0" landing \/>/);
  assert.match(footer, /\['POST IT', '\/dealer\/post'\]/);
  assert.match(header, /VIRTUAL_AUTHENTICATOR_URL = 'https:\/\/91933fc4\.curatedlux\.pages\.dev'/);
  assert.match(footer, /href=\{VIRTUAL_AUTHENTICATOR_URL\}[\s\S]*VIRTUAL AUTHENTICATOR/);
  assert.doesNotMatch(home, /luxuryapp-wf\.vercel\.app/);
  assert.doesNotMatch(postItem, /LUXURY_APP_URL|Luxury App|<iframe/);
  assert.match(postItem, /Open for testing/);
  assert.match(postItem, /Registration is required only when you save and submit/);
  assert.match(postItem, /Register or sign in to save/);
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
  assert.match(home, /See live Trading Floor/);
  assert.match(home, /From chat noise to a closed trade/);
  assert.match(home, /id="membership"[\s\S]*\$150/);
  assert.match(styles, /@keyframes luxury-gold-flow-down/);
  assert.match(styles, /animation: luxury-gold-flow-down 6s ease-in-out infinite/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(footer, /Curated Luxury marketplace intelligence for exceptional objects/);
});

test('Trading Floor watch view hides internal identifiers and labels market price evidence clearly', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.doesNotMatch(floor, />\s*Listing Details\s*</i);
  assert.doesNotMatch(floor, /Listing\s*\{\s*listing\.id\s*\}/);
  assert.doesNotMatch(floor, /Close listing details/i);
  assert.match(floor, /Price rating:/);
  assert.match(floor, /Dealer:/);
  assert.doesNotMatch(floor, /Price when posted/);
  assert.match(floor, /aria-label="Close selected watch"/);
});

test('Trading Floor uses the server-ranked reviewed release and fails closed on images', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.match(floor, /const \[pageSize, setPageSize\] = useState\(24\)/);
  assert.match(floor, /setPageSize\(24\)/);
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
  assert.match(floor, /const priceLabel = workbookPriceNeedsReview[\s\S]*?verifiedUsd !== null/);
  assert.match(floor, /const priceEvidenceLabel = workbookPriceNeedsReview[\s\S]*?verifiedUsd !== null/);
  assert.match(floor, /const MAX_EMPTY_CURSOR_HOPS = 5/);
  assert.match(floor, /const INVENTORY_REQUEST_TIMEOUT_MS = 12_000/);
  assert.match(floor, /const requestController = new AbortController\(\)/);
  assert.match(floor, /Inventory request timed out\. Please retry\./);
  assert.match(floor, /data\.records\.length > 0 \|\| !data\.hasMore \|\| !data\.nextCursor/);
  assert.match(floor, /params\.set\('cursor', data\.nextCursor\)/);
  assert.doesNotMatch(floor, /filter\(listing => !isBundleListing\(listing\)\)/);
  assert.match(floor, /const nextListings = data\.records \|\| \[\]/);
  assert.match(floor, /if \(listing\.multi_listing\) return true/);
  assert.match(floor, /isBundleListing\(listing\) \|\| listing\.is_unbundled_child === true/);
  assert.match(floor, /'MULTI', 'MULTI_LISTING', 'BUNDLE'/);
  assert.doesNotMatch(floor, /compareListingsForDisplay/);
  assert.match(floor, /const visibleListings = listings/);
  assert.match(floor, /paginationControls\('top'\)/);
  assert.match(floor, /paginationControls\('bottom'\)/);
  assert.match(floor, /fetch\('\/api\/live-release-summary'/);
  assert.match(floor, /setReleaseWatchTotal\(watchTotal\)/);
  assert.match(floor, /watches in the Trading Floor · live database total/);
  assert.match(floor, /unfilteredBrandTotal\.toLocaleString\(\)/);
  assert.match(floor, /'Trading Floor pages top'/);
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
  assert.match(cohorts, /reference: '5712'/);
  assert.match(cohorts, /tradingQuery: '5712'/);
  for (const reference of [
    '126500LN', '5712/1A-001', '5990/1R', '126710BLNR', '126610LN',
    '5164A', '5740/1G', '116688', '126334', '5980/1R',
    '124060', '126710BLRO', '126610LV', '126711CHNR', '228238',
    '5167A', '5811/1G', '5711/1A', '5226G', '5326G',
  ]) {
    assert.match(cohorts, new RegExp(reference.replace('/', '\\/')));
  }
  assert.match(shortcuts, /Featured research/);
  assert.match(shortcuts, /PRIORITY_REFERENCE_COHORTS\.slice\(0, 2\)/);
  assert.match(shortcuts, /sm:grid-cols-2/);
  assert.match(floor, /mode="trading"/);
  assert.match(floor, /reference: cohort\.reference/);
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
  assert.match(floor, /import \{ Footer \} from '\.\.\/components\/Footer'/);
  assert.match(floor, /import \{ buildContactWhatsAppUrl \} from '\.\.\/contactWhatsApp'/);
  assert.match(research, /Footer as CommunityFooter/);
});

test('Trading Floor keeps brand dependencies stable after publication metadata loads', () => {
  const source = read('src/pages/TradingFloor.tsx');

  assert.match(source, /const requestedBrandKey = searchParams\.getAll\('brand'\)/);
  assert.match(source, /\[requestedBrandKey\],/);
  assert.match(source, /setReleaseBrands\(current => current\.length === data\.publicationBrands!\.length/);
  assert.match(source, /current\.every\(\(brand, index\) => brand === data\.publicationBrands!\[index\]\)/);
});

test('Trading Floor lets only the newest inventory request control loading state', () => {
  const source = read('src/pages/TradingFloor.tsx');

  assert.match(source, /const inventoryRequestIdRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+inventoryRequestIdRef\.current/);
  assert.match(source, /inventoryRequestIdRef\.current === requestId\) setLoading\(false\)/);
  assert.match(source, /controller\.abort\(\);[\s\S]*inventoryRequestIdRef\.current === requestId/);
});
