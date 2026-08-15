'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../api/listing-contact.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'api/listing-contact.js'), 'utf8');

test('listing contact requires explicit contact publication approval', () => {
  assert.equal(api.hasApprovedPublicContact({ contact_publication_approved: true }), true);
  assert.equal(api.hasApprovedPublicContact({ flags: ['OWNER_APPROVED_CONTACT_PUBLIC'] }), true);
  assert.equal(api.hasApprovedPublicContact({ contact_publication_approved: false }), false);
  assert.equal(api.hasApprovedPublicContact({ seller_phone: '+1 305 555 0100' }), false);
});

test('dealer identity contact remains gated by dealer consent', () => {
  assert.match(source, /dealer\.contact_consent !== true/);
  assert.match(source, /CONTACT_CONSENT_NOT_GRANTED/);
  assert.match(source, /const approvedPhone = contactApproved \? listing\.seller_phone : null/);
});
