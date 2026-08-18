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

test('Trading Floor omits unavailable location and posting date instead of rendering placeholders', () => {
  assert.match(card, /meta\.region && <RegionLabel region=\{meta\.region\}/);
  assert.match(card, /meta\.postedDate && <div[^>]*>Posted: \{meta\.postedDate\}/);
  assert.match(detail, /meta\.postedDate && <div[^>]*>[\s\S]*Posted on[\s\S]*meta\.postedDate/);
  assert.match(trading, /if \(!dateStr\) return null/);
  assert.match(trading, /if \(!value\) return null/);
  assert.doesNotMatch(trading, /Location not provided/);
  assert.doesNotMatch(trading, /Location not published/);
});

test('Price Research keeps source-backed chronology in the chart and omits the duplicate watch-details card', () => {
  assert.match(research, /const sellerLocation = \[seller\?\.dealer_city, seller\?\.dealer_country\]/);
  assert.match(research, /sellerLocation && <div[^>]*>\{sellerLocation\}<\/div>/);
  assert.match(research, /Selected listing\{observedDate \? ` · \$\{observedDate\}` : ''\}/);
  assert.doesNotMatch(research, /<DetailCard title="Watch details">/);
  assert.doesNotMatch(research, /Location not published/);
});
