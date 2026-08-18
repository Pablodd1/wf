'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('footer exposes the detailed Curated Luxury horology blog', () => {
  const footer = read('src/components/Footer.tsx');
  const app = read('src/App.tsx');
  const blog = read('src/pages/Blog.tsx');
  assert.match(footer, /\['Blog', '\/blog'\]/);
  assert.match(app, /path="\/blog" element=\{<Blog \/>\}/);
  assert.match(blog, /How a mechanical watch is made/);
  assert.match(blog, /Peter Henlein/);
  assert.match(blog, /Queen of Naples/);
  assert.match(blog, /CHF 31,000,000/);
  assert.match(blog, /christies\.com/);
  assert.match(blog, /britishmuseum\.org/);
});

test('Price Research always shows the dial analytics table and outlook without an action gate', () => {
  const page = read('src/pages/PriceResearch.tsx');
  assert.doesNotMatch(page, /View graphic analytics &amp; 3-month outlook/);
  assert.doesNotMatch(page, /analyticsChartsRef/);
  assert.match(page, /Dial colors and comparable prices/);
  assert.match(page, /<table[\s\S]*Average price[\s\S]*Minimum price[\s\S]*Maximum price/);
  assert.match(page, /data-testid="dial-price-outlook"/);
  assert.match(page, /Solid dial-colored lines are observed WTS averages/);
});
