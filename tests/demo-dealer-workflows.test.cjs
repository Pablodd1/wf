const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('three synthetic dealers cover demographics, reputation, watch and non-watch workflows', () => {
  const fixtures = read('src/data/demoDealerWorkflows.ts');
  assert.match(fixtures, /camila:/);
  assert.match(fixtures, /marcus:/);
  assert.match(fixtures, /ana:/);
  assert.match(fixtures, /Patek Philippe/);
  assert.match(fixtures, /5712\/1A-001/);
  assert.match(fixtures, /116500LN/);
  assert.match(fixtures, /category: 'HANDBAG'/);
  assert.match(fixtures, /category: 'JEWELRY'/);
  assert.match(fixtures, /publication_status: 'PUBLISHED'/);
  assert.match(fixtures, /publication_status: 'QUEUED'/);
  assert.match(fixtures, /publication_status: 'REJECTED'/);
  assert.match(fixtures, /credential_status: 'SYNTHETIC DEMO'/);
});

test('demo workflow is discoverable and never writes to production', () => {
  const portal = read('src/pages/DealerPortal.tsx');
  const account = read('src/pages/DealerAccount.tsx');
  const posting = read('src/pages/DealerSubmitListing.tsx');
  assert.match(portal, /Three synthetic dealer workflows/);
  assert.match(account, /No authentication account, production row, or market analytic is created/);
  assert.match(posting, /No upload, database write, or market analytic was created/);
  assert.match(posting, /if \(demoPoster\)/);
  assert.match(posting, /setSubmissions\(current => \[\.\.\.demoSubmissions, \.\.\.current\]\)/);
});

test('POST IT is open for testing and explains the registered-save workflow', () => {
  const header = read('src/components/MarketHeader.tsx');
  const portal = read('src/pages/DealerPortal.tsx');
  const posting = read('src/pages/DealerSubmitListing.tsx');
  assert.match(header, /label: 'POST IT'/);
  assert.match(portal, /title: 'POST IT'/);
  assert.match(posting, />POST IT</);
  assert.match(posting, /Open for testing/);
  assert.match(posting, /Registration is required only when you save and submit/);
  assert.doesNotMatch(posting, /Luxury App|<iframe/);
  assert.match(posting, /keeps the seller identity, raw message, item details, price, and photos together/);
  assert.match(posting, /helps approved listings reach the Trading Floor faster/);
});
