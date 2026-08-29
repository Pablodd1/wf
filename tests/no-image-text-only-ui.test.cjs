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

test('confirmed image-less Trading Floor listings render the standard placeholder', () => {
  assert.match(card, /const \[imageAvailable, setImageAvailable\] = useState/);
  assert.match(card, /const cardHasImage = Boolean\(imageUrl && imageAvailable\)/);
  assert.match(card, /\{cardHasImage && \(/);
  assert.match(card, /\{!cardHasImage && \([\s\S]*NO IMAGE/);
  assert.match(card, /onError=\{\(\) => setImageAvailable\(false\)\}/);
  assert.match(detail, /\{availableImages\.length > 0 && \(/);
  assert.match(detail, /availableImages\.length > 0 \? 'lg:grid-cols/);
  assert.doesNotMatch(trading, /linear-gradient\(145deg, #181820, #0E0E14\)/);
  assert.match(trading, /return Boolean\(getListingImageSrc\(listing\)\)/);
  assert.doesNotMatch(trading, /if \(listing\.has_images\) return true/);
});

test('confirmed image-less Price Research details omit the entire media frame', () => {
  assert.match(research, /sourceImageEvidence = \['SELLER_LISTING_IMAGE', 'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'\]/);
  assert.match(research, /const \[failedImages, setFailedImages\] = useState/);
  assert.match(research, /images\.length > 0 \? 'grid lg:grid-cols/);
  assert.match(research, /\{images\.length > 0 && \(/);
  assert.match(research, /onError=\{\(\) => setFailedImages/);
  assert.doesNotMatch(research, /No linked image for this record/);
  assert.doesNotMatch(research, /<ImageOff/);
});
