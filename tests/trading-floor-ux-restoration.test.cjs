'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('desktop and mobile location selectors retain multiple independent selections', () => {
  assert.match(source, /selectedLocations\.filter\(value => value !== loc\)/);
  assert.match(source, /\[\.\.\.selectedLocations, loc\]/);
  assert.match(source, /setDraftLocations\(current => current\.includes\(loc\)/);
  assert.match(source, /current\.filter\(value => value !== loc\)/);
  assert.match(source, /\[\.\.\.current, loc\]/);
  assert.match(source, /aria-label="Selected locations"/);
  assert.match(source, />Clear locations</);
});

test('multi-location URL changes create history entries and preserve selected URL values', () => {
  assert.match(source, /const updateViewParams = useCallback\(\(updates:[\s\S]*replace = true\)/);
  assert.match(source, /setSearchParams\(next, \{ replace \}\)/);
  assert.match(source, /updateViewParams\(updates, !Object\.prototype\.hasOwnProperty\.call\(updates, 'location'\)\)/);
  assert.match(source, /location: next\.locations\.length \? next\.locations\.join\(','\) : null,[\s\S]*\}, false\)/);
  assert.match(source, /new Set\(\[\.\.\.locationFilters, \.\.\.discoveredLocations, \.\.\.countries\]\)/);
});

test('newest observed is the default and discovery is an explicit presentation option', () => {
  assert.match(source, /const sortMode: SortMode = requestedSort === 'discovery' \? 'discovery' : 'newest'/);
  assert.match(source, /\{ label: 'Newest observed', value: 'newest' \}/);
  assert.match(source, /\{ label: 'Discovery mix', value: 'discovery' \}/);
  assert.match(source, /sort === 'newest' \? null : next\.sort/);
  assert.match(source, /Discovery mix changes order only/);
});

test('search help preserves observed-only lookup and exposes removable filter chips', () => {
  assert.match(source, /placeholder="Search exact reference, model, message, or poster"/);
  assert.match(source, /Search observed references directly; catalog match is optional/);
  assert.match(source, /aria-label="Current search and filters"/);
  assert.match(source, /aria-label=\{`Remove \$\{chip\.label\} filter`\}/);
});

test('source evidence disclosures are collapsed by default and preserve exact line breaks', () => {
  const details = source.match(/<details className=/g) || [];
  assert.ok(details.length >= 2, 'card and selected-listing source evidence should both use details disclosures');
  assert.doesNotMatch(source, /<details[^>]+\sopen(?:=|\s|>)/);
  assert.match(source, /<span>\{messageEvidence\.label\}<\/span>/);
  assert.match(source, /whitespace-pre-wrap break-words/);
  assert.match(source, /raw_message_scope === 'normalized_summary'[\s\S]*label: 'SOURCE TEXT'/);
});

test('quick scroll is available responsively and does not alter page layout', () => {
  assert.match(source, /function TradingFloorQuickScroll\(\)/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /if \(!scrollable\) return null/);
  assert.match(source, /className="fixed right-20 top-1\/2/);
  assert.match(source, /max-lg:right-2 sm:max-lg:right-4/);
  assert.doesNotMatch(source, /Quick Trading Floor scroll" className="[^"]*hidden/);
  assert.match(source, /aria-label="Scroll to top of Trading Floor"/);
  assert.match(source, /aria-label="Scroll to bottom of Trading Floor"/);
});
