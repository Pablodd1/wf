'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectDialGroup } = require('../api/_lib/dial-cohort-selection.cjs');

const summarize = rows => ({
  summary: {
    analytics_ready: rows.length >= 2,
    stats: rows.length >= 2 ? { avg: 100 } : null,
  },
});

test('initial reference view selects a publishable dial instead of a thin first dial', () => {
  const groups = [
    { dial_color: 'Rare', rows: [{ price_usd: 1 }] },
    { dial_color: 'Blue', rows: [{ price_usd: 2 }, { price_usd: 3 }] },
  ];

  assert.equal(selectDialGroup(groups, '', summarize).dial_color, 'Blue');
});

test('explicit dial selection is preserved when its evidence is insufficient', () => {
  const groups = [
    { dial_color: 'Rare', rows: [{ price_usd: 1 }] },
    { dial_color: 'Blue', rows: [{ price_usd: 2 }, { price_usd: 3 }] },
  ];

  assert.equal(selectDialGroup(groups, 'rare', summarize).dial_color, 'Rare');
});

test('empty references retain the existing unspecified cohort contract', () => {
  const selected = selectDialGroup([], '', summarize);
  assert.equal(selected.dial_color, 'Unspecified');
  assert.deepEqual(selected.rows, []);
});
