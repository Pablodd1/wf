'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Price Research renders dial-colored observed lines and dotted three-month outlook points', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.match(source, /Dial Price History &amp; 3-Month Outlook/);
  assert.match(source, /data\.dial_trends\.map\(trend => <Line/);
  assert.match(source, /stroke=\{dialChartColor\(trend\.dial_color\)\}/);
  assert.match(source, /strokeDasharray="3 6"/);
  assert.match(source, /indicative baseline/);
  assert.match(source, /not a prediction of appreciation or decline/);
});

test('Price Research keeps the dial graphic and table available for every stats-backed reference', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.match(source, /const displayDialAnalysis: DialPoint\[\] = data\?\.dial_analysis\?\.length/);
  assert.match(source, /: data\?\.stats/);
  assert.match(source, /<ComposedChart data=\{displayDialAnalysis\}/);
  assert.match(source, /displayDialAnalysis\.map\(\(d, i\) =>/);
});

