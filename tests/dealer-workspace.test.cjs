'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dealer workspace storage is service-role only', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260721020000_dealer_workspace.sql'),
    'utf8',
  );
  assert.match(migration, /REVOKE ALL ON public\.dealer_account_preferences FROM anon, authenticated/i);
  assert.match(migration, /REVOKE ALL ON public\.dealer_support_tickets FROM anon, authenticated/i);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|ALL)[^;]* TO authenticated/i);
});

test('profile updates require an authenticated user-to-dealer link', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-workspace.js'), 'utf8');
  assert.match(route, /authorizeDealer\(req, res\)/);
  assert.match(route, /\.eq\('auth_user_id', authorization\.user\.id\)\.maybeSingle\(\)/);
  assert.match(route, /\.eq\('id', dealer\.id\)\.eq\('auth_user_id', authorization\.user\.id\)/);
  assert.match(route, /if \(!dealer\) return res\.status\(409\)/);
});

test('billing remains inactive until commercial terms are approved', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerAccount.tsx'), 'utf8');
  assert.match(page, /Commercial plans and payment processing are not enabled during beta/);
  assert.doesNotMatch(page, /stripe|checkout|payment_intent/i);
});

test('account exposes the same verified demographic stamp used by Post an Item', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-workspace.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerAccount.tsx'), 'utf8');
  assert.match(route, /dealer_source_identities/);
  assert.match(route, /profile_stamp/);
  assert.match(page, /Verified phone/);
  assert.match(page, /Posting location/);
  assert.match(page, /Ratings and verified phone lineage cannot be edited here/);
});
