'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateApplication } = require('../api/dealer-registration.js');

test('dealer applications collect identity, contact, location, language, and consent', () => {
  const valid = validateApplication({
    account_type: 'dealer', display_name: 'Example Dealer', email: 'dealer@example.com',
    phone: '+1 305 555 0101', country_code: 'US', city: 'Miami', preferred_language: 'en',
    group_count: 4, contact_consent: true,
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.application.group_count, 4);
  assert.equal(valid.application.country_code, 'US');
});

test('dealer applications do not provision incomplete or unconsented identities', () => {
  assert.match(validateApplication({}).error, /account type/);
  assert.match(validateApplication({ account_type: 'dealer', display_name: 'A', email: 'a@example.com', phone: '+13055550101', country_code: 'US', city: 'Miami', preferred_language: 'en' }).error, /Confirm/);
});
