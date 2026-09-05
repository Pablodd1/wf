'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const health = require('../api/health.js');

test('health derives only the public Supabase project reference', () => {
  assert.equal(
    health.supabaseProjectRef('https://qnsafosakvonzgfcsphh.supabase.co'),
    'qnsafosakvonzgfcsphh',
  );
  assert.equal(
    health.supabaseProjectRef('https://bptrvfncppbjnchsaxtb.supabase.co/rest/v1'),
    'bptrvfncppbjnchsaxtb',
  );
});

test('health refuses to derive identifiers from non-Supabase or unsafe URLs', () => {
  assert.equal(health.supabaseProjectRef('http://qnsafosakvonzgfcsphh.supabase.co'), null);
  assert.equal(health.supabaseProjectRef('https://supabase.co.evil.example'), null);
  assert.equal(health.supabaseProjectRef('not a URL'), null);
  assert.equal(health.supabaseProjectRef(''), null);
});

