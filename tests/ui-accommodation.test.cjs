'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('primary navigation exposes the complete Workspace customer flow and clean Hire Fi rail', () => {
  const header = read('src/components/MarketHeader.tsx');
  const rail = read('src/components/HireFiScrollRail.tsx');

  assert.match(header, /label: 'WORKSPACE', to: '\/dealer\/workspace'/);
  assert.doesNotMatch(header, /label: 'DEALER LOGIN'/);
  assert.match(header, /label: 'POST IT', to: '\/dealer\/post'/);
  assert.match(header, /label: 'DEALER ACCOUNT', to: '\/dealer\/account\/profile'/);
  assert.match(header, /label: 'DEALER DIRECTORY', to: '\/dealers'/);
  assert.ok(header.indexOf("label: 'TRADING FLOOR'") < header.indexOf("label: 'PRICE RESEARCH'"));
  assert.ok(header.indexOf("label: 'PRICE RESEARCH'") < header.indexOf("label: 'POST IT'"));
  assert.ok(header.indexOf("label: 'POST IT'") < header.indexOf("label: 'HIRE FI'"));
  assert.ok(header.indexOf("label: 'HIRE FI'") < header.indexOf("label: 'DEALER DIRECTORY'"));
  assert.match(rail, /Let Fi search the world/);
  assert.match(rail, /sm:text-base/);
  assert.doesNotMatch(rail, /Instagram|Facebook|Linkedin|Twitter/);
});

test('Account exposes dealer onboarding and batches every posting event', () => {
  const account = read('src/pages/DealerAccount.tsx');
  const workspaceApi = read('api/dealer-workspace.js');
  assert.match(account, /Dealer onboarding/);
  assert.match(account, /Account analytics/);
  assert.match(account, /Market participation and reputation/);
  assert.match(account, /Identity and demographics/);
  assert.match(account, /For sale posts/);
  assert.match(account, /Common groups/);
  assert.match(account, /Account type/);
  assert.match(account, /Preferred language/);
  assert.match(account, /bulk_submission_id/);
  assert.match(workspaceApi, /account_type/);
  assert.match(workspaceApi, /telegram_username/);
});

test('Workspace login provides a review-gated dealer application instead of instant privileged signup', () => {
  const login = read('src/pages/DealerLogin.tsx');
  const registration = read('api/dealer-registration.js');
  assert.match(login, /New dealer/);
  assert.match(login, /Submit for verification/);
  assert.match(login, /Phone \/ WhatsApp/);
  assert.match(registration, /DIRECT_DEALER_APPLICATION/);
  assert.match(registration, /comparison_status: 'PENDING'/);
  assert.doesNotMatch(registration, /app_metadata.*role|createUser|inviteUserByEmail/);
});

test('customer Workspace routes are visible without a route-level authentication gate', () => {
  const app = read('src/App.tsx');
  const portal = read('src/pages/DealerPortal.tsx');
  assert.match(app, /path="\/dealer\/workspace" element=\{<DealerPortal \/>\}/);
  assert.match(app, /path="\/dealer\/post" element=\{<DealerSubmitListing \/>\}/);
  assert.match(app, /path="\/dealer\/account\/:section" element=\{<DealerAccount \/>\}/);
  assert.match(app, /path="\/dealers" element=\{<DealerDirectory \/>\}/);
  assert.doesNotMatch(app, /path="\/dealer\/(?:workspace|post|account\/)[^\n]*<DealerGate>/);
  for (const title of ['POST IT', 'Hire FI', 'Dealer Directory', 'Dealer Account']) {
    assert.match(portal, new RegExp(`title: '${title}'`));
  }
  assert.doesNotMatch(portal, /title: 'Trading Floor'/);
  assert.doesNotMatch(portal, /title: 'Price Research'/);
});

test('Trading Floor preserves source text and orders price intelligence before poster details', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.match(floor, /listing\.raw_message \?\? listing\.raw_line \?\? listing\.description/);
  assert.match(floor, />Original raw message</);
  assert.match(floor, /order-2 rounded-md border[\s\S]*>Price Rating</);
  assert.match(floor, /order-3 rounded-md border[\s\S]*>Posted by</);
  assert.match(floor, /listing\.intent \|\| listing\.listing_type/);
  assert.match(floor, /label="Only with images"/);
  assert.match(floor, /verified source images only/);
  assert.match(floor, /Bundle, multi-listing, and unbundled-child images remain excluded/);
  assert.match(floor, /label="Price supplied"/);
  assert.ok(floor.indexOf(': sourcePrice') < floor.indexOf(': reviewedWorkbookUsd !== null'));
  assert.doesNotMatch(floor, /currency not supplied/);
  assert.match(floor, /USD \$\{sourceText\}/);
  assert.match(floor, /Original source price · no USD conversion/);
  assert.match(floor, /Location/);
  assert.match(floor, /Rated dealers/);
  assert.match(floor, /Not rated/);
  for (const window of ['1D', '7D', '1M', '3M', '6M', '1Y']) {
    assert.match(floor, new RegExp(`label: '${window}'`));
  }
  assert.doesNotMatch(floor, />Human review</);
  assert.doesNotMatch(floor, /Source-confirmed USD/);
  assert.match(floor, /isRatedDealer[\s\S]*Rated Dealer/);
  assert.match(floor, /SOURCE_FEEDBACK_COUNT/);
  const cardSource = floor.slice(floor.indexOf('function ListingCard'), floor.indexOf('function ListingDetails'));
  assert.ok(cardSource.indexOf('Original raw message') < cardSource.indexOf('Posted by'));
});

test('Trading Floor recovers once from transient inventory timeouts without caching emptiness', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  const api = read('api/reviewed-market-inventory.js');
  assert.match(floor, /response\.status === 502 \|\| response\.status === 503 \|\| response\.status === 504/);
  assert.match(floor, /cache: 'no-store'/);
  assert.match(floor, /Loading released watch inventory/);
  assert.match(api, /private, no-store, max-age=0/);
});

test('Price Research uses dial colors, closed methodology, images, and complete fallback evidence', () => {
  const research = read('src/pages/PriceResearch.tsx');

  assert.doesNotMatch(research, /\['white', 'white dial', 'silver'[\s\S]*return NAVY/);
  assert.match(research, /fill=\{dialChartColor\(dial\.dial_color\)\}/);
  assert.match(research, /dialChartStroke\(dial\.dial_color\)/);
  assert.match(research, /key=\{`methodology-/);
  assert.doesNotMatch(research, /<details open/);
  assert.match(research, /row\.display_image_url/);
  assert.doesNotMatch(research, /No image|Source listing image unavailable/);
  assert.match(research, /images\.length > 0 \? 'grid md:grid-cols/);
  assert.match(research, /const rawSourceMessage = detail\?\.raw_message \?\? summary\.raw_message \?\? summary\.raw_line/);
  assert.match(research, /void fetch\(contactEndpoint[\s\S]*setListingSeller/);
  assert.match(research, /<DetailCard title="Original listing"/);
  assert.match(research, /<DetailCard title="Posted by"/);
});

test('Workspace includes official community access without testing or phone-installation copy', () => {
  const portal = read('src/pages/DealerPortal.tsx');
  const footer = read('src/components/Footer.tsx');
  const groups = read('src/components/JoinGroupsCta.tsx');
  const index = read('index.html');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));

  assert.match(footer, /B2B Watch Trading Chat/);
  assert.match(footer, /Community discussion\/announcements/);
  assert.match(footer, /Signed Estate and Branded Jewelry/);
  assert.match(footer, /Rolex US Only Sales/);
  assert.match(portal, /href=\{group\.href\}/);
  assert.match(groups, /export const GROUPS_URL = 'https:\/\/watchfacts\.com\//);
  assert.doesNotMatch(portal, /Add Curated Luxury to your phone|Coming soon|Three synthetic dealer workflows/);
  assert.doesNotMatch(portal, /beforeinstallprompt/);
  assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(manifest.display, 'standalone');
});

test('footer provides direct contact, community groups, marketplace opportunities, and CL login', () => {
  const footer = read('src/components/Footer.tsx');

  assert.match(footer, /Contact us on WhatsApp/);
  assert.match(footer, /phone=17869569201/);
  assert.match(footer, /Join Our Chats/);
  assert.match(footer, /JEaK91DatRkLZFKMaJZYIH/);
  assert.match(footer, /CHLWqKgzO2Y1sdarNTAcEO/);
  assert.match(footer, /EfL3QcrCVe1F7wKMGjS9WQ/);
  assert.match(footer, /B8qiBT6JZYyGoNg3CAX5Kw/);
  assert.match(footer, /DPhtxCrrxES5kyHeO7SmCb/);
  assert.match(footer, /t\.me\/watchfactsUS/);
  assert.match(footer, /to="\/cl-login"[\s\S]*CL Login/);
  assert.match(footer, /Aduenas@watchfacts\.com/);
  assert.match(footer, /type="submit"/);
  assert.match(footer, /mailto:\$\{CONTACT_EMAIL\}/);
});

test('footer provides the complete social media watch dealer glossary in an accessible modal', () => {
  const footer = read('src/components/Footer.tsx');

  assert.match(footer, /Social Media Watch Dealer Glossary/);
  assert.match(footer, /role="dialog"/);
  assert.match(footer, /aria-modal="true"/);
  assert.match(footer, /Close glossary/);
  assert.match(footer, /Buying & Selling Terms/);
  assert.match(footer, /Condition & Packaging/);
  assert.match(footer, /Pricing & Payment/);
  assert.match(footer, /Watch Specifications & Market Terms/);
  assert.match(footer, /Deal Communication/);
  for (const term of ['WTB', 'WTS', 'WTT', 'OBO', 'BNIB', 'LNIB', 'NOS', 'MINT', 'B&P', 'T/T', 'DLC', 'PVD', 'OEM', 'FRANKEN', 'DIBS', 'SPF']) {
    assert.match(footer, new RegExp(`['"]${term.replace(/[&/]/g, '\\$&')}['"]`));
  }
});

test('dealer directory separates the verified Live Directory from provenance-backed Top Rated profiles', () => {
  const directory = read('src/pages/DealerDirectory.tsx');

  assert.match(directory, /Live Directory/);
  assert.match(directory, /Top Rated Dealers/);
  assert.match(directory, /review_count\.toLocaleString\(\).*reviews/);
  assert.match(directory, /member_since/);
  assert.match(directory, /view === 'legacy' \? 'Captured WTS' : 'For sale'/);
  assert.match(directory, /view === 'legacy' \? 'Captured WTB' : 'Looking for'/);
  assert.match(directory, /Full profile/);
  assert.doesNotMatch(directory, /Source profile/);
  assert.match(directory, /public-source leaderboard/);
  const profile = read('src/pages/DealerProfile.tsx');
  assert.match(profile, /Raw source message/);
  assert.match(profile, /Verified dealer/);
  assert.match(profile, /Top Rated dealer evidence/);
  assert.match(profile, /Find on Trading Floor/);
  assert.doesNotMatch(profile, /Open source listing|All source listings|Source WTS|Source WTB|Contact through public source/);
  assert.doesNotMatch(profile, /Actual listing|Source workflow/);
});

test('home and Post an Item share a persistent multilingual interface without changing raw source text', () => {
  const language = read('src/i18n/LanguageContext.tsx');
  const toggle = read('src/components/LanguageToggle.tsx');
  const header = read('src/components/MarketHeader.tsx');
  const home = read('src/pages/LandingPage.tsx');
  const post = read('src/pages/DealerSubmitListing.tsx');
  const main = read('src/main.tsx');

  assert.match(language, /watchfacts-language/);
  assert.match(language, /'en'.*'es'.*'pt'.*'zh'/s);
  assert.match(language, /window\.navigator\.language/);
  assert.match(toggle, /aria-label=\{t\('Language'\)\}/);
  assert.match(main, /<LanguageProvider>/);
  assert.match(header, /<LanguageToggle compact/);
  assert.match(home, /curated-luxury-hero\.webm/);
  assert.match(home, /Exceptional objects/);
  assert.match(post, /<LanguageToggle/);
  assert.match(post, /Original listing or request message/);
  assert.match(post, /value=\{item\.raw_message\}/);
});
