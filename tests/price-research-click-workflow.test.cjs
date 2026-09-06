'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Trading Floor links use the HashRouter Price Research workflow', () => {
  const source = read('src/pages/TradingFloor.tsx');
  assert.match(source, /<Link[\s\S]*to=\{`\/price-research\?brand=/);
  assert.doesNotMatch(source, /href=\{`\/price-research\?brand=/);
});

test('Price Research returns to the exact Trading Floor cohort', () => {
  const source = read('src/pages/PriceResearch.tsx');
  assert.match(source, /to=\{`\/trading\?brand=\$\{encodeURIComponent\(data\.brand\)\}&reference=\$\{encodeURIComponent\(data\.reference\)\}`\}/);
  assert.doesNotMatch(source, /to=\{`\/trading\?brand=\$\{encodeURIComponent\(data\.brand\)\}&q=/);
});

test('QNSA comparable detail reuses the exact evidence already loaded by analytics', () => {
  const source = read('src/pages/PriceResearch.tsx');
  assert.match(source, /row\.source \|\| ''\)\.toUpperCase\(\) === 'MARIADB_IMMUTABLE_RAW'/);
  assert.match(source, /setListingDetail\(\{/);
  assert.match(source, /raw_message_scope: rawMessage \? 'original_post' : 'unavailable'/);
  assert.match(source, /image_evidence_type: imageCandidate \? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE'/);
});

test('direct detail API checks QNSA before legacy release views', () => {
  const source = read('api/price-research-listing.js');
  assert.ok(
    source.indexOf('await loadQnsaReleaseListing(client, id)')
      < source.indexOf(".from('price_research_verified_source')"),
  );
  assert.doesNotMatch(source, /'image_url,thumbnail_url,display_image_url,image_urls,has_images,location'/);
  assert.match(source, /\.from\(QNSA_PRICE_RESEARCH_SOURCE\)[\s\S]*?\.select\('\*'\)/);
});

test('URL-selected brand remains visible while release-brand metadata loads', () => {
  const source = read('src/pages/PriceResearch.tsx');
  assert.match(source, /queryBrand && !pBrands\.some\(item => item\.brand === queryBrand\)/);
  assert.match(source, /<option value=\{queryBrand\}>\{queryBrand\}<\/option>/);
});

test('an exact Trading Floor deep link automatically loads its Price Research evidence', () => {
  const source = read('src/pages/PriceResearch.tsx');
  assert.match(source, /const loadedDeepLinkRef = useRef\(''\)/);
  assert.match(source, /if \(!deepLinkReference \|\| !deepLinkBrand \|\| loadedDeepLinkRef\.current === deepLinkKey\) return/);
  // Deep links must carry the full exact cohort (dial + condition) so verified
  // cohort statistics resolve immediately on the canary surface.
  assert.match(source, /void fetchData\(deepLinkReference, initialDial\.trim\(\), deepLinkBrand, 1, 1, initialCondition\.trim\(\)\)/);
  assert.doesNotMatch(source, /void fetchData\(deepLinkReference, '', deepLinkBrand\)/);
  assert.match(source, /\[fetchData, initialBrand, initialReference, initialDial, initialCondition\]/);
});
