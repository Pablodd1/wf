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

test('contact payload exposes channel links without a visible phone field', () => {
  assert.equal(api.normalizeTelegramUsername('@watch_dealer'), 'watch_dealer');
  assert.equal(api.normalizeTelegramUsername('https://t.me/watch_dealer'), 'watch_dealer');
  assert.equal(api.normalizeTelegramUsername('bad user'), null);
  assert.match(source, /contact_channels/);
  assert.doesNotMatch(source, /phone_display:/);
  assert.match(source, /identity_type', \['PHONE', 'WHATSAPP', 'TELEGRAM'/);
});

test('contact JSON uses opaque same-site actions and resolves the external channel only on click', () => {
  const response = {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
  api.sendContactResult(response, {
    payload: { success: true, contact_available: true },
    externalChannels: { whatsapp: 'https://wa.me/13055550100?text=hello' },
    id: 'listing-1', surface: 'trading-floor', requestedChannel: '',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.contact_channels.whatsapp, '/api/listing-contact?id=listing-1&surface=trading-floor&channel=whatsapp');
  assert.doesNotMatch(JSON.stringify(response.body), /13055550100|wa\.me/);

  api.sendContactResult(response, {
    payload: { success: true },
    externalChannels: { whatsapp: 'https://wa.me/13055550100?text=hello' },
    id: 'listing-1', surface: 'trading-floor', requestedChannel: 'whatsapp',
  });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, 'https://wa.me/13055550100?text=hello');
});
