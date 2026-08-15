const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('home restores cream dealer-network landing and exposes the approved transaction tabs', () => {
  const home = read('src/pages/LandingPage.tsx');
  const header = read('src/components/MarketHeader.tsx');
  assert.match(home, /The trading floor for the world's dealer network/);
  assert.match(home, /Meet Fi/);
  assert.match(home, /From chat noise to a closed trade/);
  assert.doesNotMatch(home, /curated-luxury-hero\.(?:webm|mp4)/);
  const landingLinks = header.match(/const LANDING_LINKS[\s\S]*?\];/)?.[0] || '';
  assert.match(landingLinks, /TRADING FLOOR/);
  assert.match(landingLinks, /POST IT/);
  assert.match(landingLinks, /HIRE FI/);
  assert.match(landingLinks, /VIRTUAL AUTHENTICATOR/);
  assert.match(landingLinks, /WORKSPACE/);
  assert.doesNotMatch(landingLinks, /PRICE RESEARCH|MEMBERSHIP/);
  assert.match(header, /curated-luxury-logo\.png/);
});

test('workspace omits synthetic demos and phone installation instructions', () => {
  const portal = read('src/pages/DealerPortal.tsx');
  const post = read('src/pages/DealerSubmitListing.tsx');
  const account = read('src/pages/DealerAccount.tsx');
  const privacy = read('src/pages/PrivacyPolicy.tsx');
  assert.doesNotMatch(portal, /Testing and visual review|Three synthetic dealer workflows|demoUser=/);
  assert.doesNotMatch(portal, /Android · Coming soon|iPhone · Coming soon|Add to Home Screen/);
  for (const source of [portal, post, account, privacy]) assert.match(source, /to="\/trading"/);
});

test('privacy is public and POST IT supports camera plus file selection', () => {
  const app = read('src/App.tsx');
  const footer = read('src/components/Footer.tsx');
  const post = read('src/pages/DealerSubmitListing.tsx');
  assert.match(app, /path="\/privacy"/);
  assert.match(footer, /to="\/privacy"/);
  assert.match(post, /capture="environment"/);
  assert.match(post, /Take photo/);
  assert.match(post, /Choose photos/);
  assert.match(post, /multiple/);
});
