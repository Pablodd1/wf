'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
const research = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
const card = trading.slice(trading.indexOf('function ListingCard'), trading.indexOf('function ListingDetails'));
const detail = trading.slice(trading.indexOf('function ListingDetails'), trading.indexOf('function ContactMetric'));

test('confirmed image-less Trading Floor listings render as text-only cards and details', () => {
  assert.match(card, /const \[imageAvailable, setImageAvailable\] = useState/);
  assert.match(card, /const cardHasImage = imageAvailable && hasListingImage\(listing\)/);
  assert.match(card, /\{cardHasImage && \(/);
  assert.match(card, /onUnavailable=\{\(\) => setImageAvailable\(false\)\}/);
  assert.match(detail, /\{images\.length > 0 && \(/);
  assert.match(detail, /images\.length > 0 \? 'lg:grid-cols/);
  assert.doesNotMatch(trading, /linear-gradient\(145deg, #181820, #0E0E14\)/);
});

test('confirmed image-less Price Research details omit the entire media frame', () => {
  assert.match(research, /images\.length > 0 \? 'grid lg:grid-cols/);
  assert.match(research, /\{images\.length > 0 && \(/);
  assert.doesNotMatch(research, /No linked image for this record/);
  assert.doesNotMatch(research, /<ImageOff/);
});
