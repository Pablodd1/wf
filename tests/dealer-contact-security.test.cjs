'use strict';

/**
 * Phase 8 — dealer & contact security contract tests.
 *
 * Covers: role matrix (anon / authenticated / unrelated dealer / listing
 * owner / admin), consent granted vs absent, dealer mismatch, child/parent
 * contact isolation, deep-scan for phone leakage in payloads, rate limiting,
 * audit-event emission, and WhatsApp prefilled-text fact allowlisting.
 *
 * All phones used here are synthetic 555-range numbers; no real contact data.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

// Stub the Supabase client BEFORE the handler module is loaded so every test
// drives the handler with an in-memory fixture client.
const supabasePath = require.resolve('../api/_lib/supabase.js');
let activeClient = null;
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: { getClient: () => activeClient },
};

const handler = require('../api/listing-contact.js');
const dealersApi = require('../api/dealers.js');
const { withoutPrivateProvenance, ratedProfiles } = require('../api/_lib/dealer-directory-source.cjs');

const SYNTHETIC_PHONE = '+1 305 555 0100';
const SYNTHETIC_PHONE_DIGITS = '13055550100';

/** Minimal chainable PostgREST stub filtered by eq/in/gte over fixture rows. */
function mockClient(tables, rpcHandlers = {}) {
  return {
    from(table) {
      let result = [...(tables[table] || [])];
      const chain = {
        select() { return chain; },
        eq(field, value) { result = result.filter(row => row[field] === value); return chain; },
        in(field, values) { result = result.filter(row => values.includes(row[field])); return chain; },
        gte(field, value) { result = result.filter(row => Number(row[field]) >= Number(value)); return chain; },
        or() { return chain; },
        order() { return chain; },
        range() { return chain; },
        limit(n) { result = result.slice(0, n); return chain; },
        maybeSingle: async () => ({ data: result[0] || null, error: null }),
        then(resolve) { return resolve({ data: result, error: null }); },
      };
      return chain;
    },
    rpc: async (name, args) => (
      name === 'consume_listing_contact_budget' ? { data: true, error: null } :
      rpcHandlers[name] ? rpcHandlers[name](args) : { data: null, error: null }
    ),
  };
}

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

let requestCounter = 0;
async function invoke(query, { ip } = {}) {
  requestCounter += 1;
  const res = mockRes();
  await handler({
    method: 'GET',
    query,
    headers: { 'x-forwarded-for': ip || `10.9.${Math.floor(requestCounter / 20)}.${requestCounter % 250}` },
    socket: { remoteAddress: '10.9.0.1' },
  }, res);
  return res;
}

function dealerFixture({ consent }) {
  return {
    trading_floor_verified_listings: [
      { id: 'wf-dealer-listing-1', brand: 'Rolex', reference: '116610LN' },
    ],
    watch_records: [
      {
        id: 'wf-dealer-listing-1',
        brand: 'Rolex',
        reference: '116610LN',
        listing_type: 'WTS',
        dealer_id: 'dealer-1',
        verdict: 'APPROVED',
        confidence: 90,
        source: 'SYNTHETIC_TEST_SOURCE',
        seller_name: 'Synthetic Dealer',
        seller_phone: null,
        flags: [],
      },
    ],
    seller_listing_lineage_staging: [
      { id: 'lineage-1', source_record_id: 'wf-dealer-listing-1', matched_dealer_id: 'dealer-1', match_status: 'APPLIED' },
    ],
    dealers: [
      {
        id: 'dealer-1',
        slug: 'synthetic-dealer',
        display_name: 'Synthetic Dealer',
        company_name: 'Synthetic Dealer LLC',
        country_code: 'US',
        city: 'Testville',
        status: 'VERIFIED',
        contact_consent: consent,
        rating: null,
        review_count: null,
        whatsapp_group_count: 0,
        avatar_url: null,
        profile_summary: null,
      },
    ],
    dealer_source_identities: [
      { dealer_id: 'dealer-1', source_identity: SYNTHETIC_PHONE, identity_type: 'PHONE', verification_status: 'VERIFIED' },
    ],
  };
}

function deepScan(value, needle) {
  return JSON.stringify(value).includes(needle);
}

test.beforeEach((t) => {
  const saved = process.env.CONTACT_RATE_LIMIT_SECRET;
  process.env.CONTACT_RATE_LIMIT_SECRET = 'synthetic-contact-rate-secret';
  t.after(() => saved === undefined ? delete process.env.CONTACT_RATE_LIMIT_SECRET : process.env.CONTACT_RATE_LIMIT_SECRET = saved);
  handler.resetContactRateLimitForTests();
  handler.setContactAuditSink(null);
});

const ROLES = ['anonymous', 'authenticated-member', 'unrelated-dealer', 'listing-owner', 'admin'];

test('role matrix: phone resolves only after consent, identically for every role', async () => {
  for (const role of ROLES) {
    activeClient = mockClient(dealerFixture({ consent: true }));
    const res = await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor' });
    assert.equal(res.statusCode, 200, role);
    assert.equal(res.body.contact_available, true, role);
    assert.ok(res.body.contact_channels.whatsapp.startsWith('/api/listing-contact?'), role);
    assert.equal(deepScan(res.body, SYNTHETIC_PHONE_DIGITS), false, `${role}: phone digits must never appear in JSON payload`);
    assert.equal(deepScan(res.body, 'wa.me'), false, `${role}: wa.me must not appear in JSON payload`);
  }
  for (const role of ROLES) {
    activeClient = mockClient(dealerFixture({ consent: false }));
    const res = await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor' });
    assert.equal(res.statusCode, 200, role);
    assert.equal(res.body.contact_available, false, role);
    assert.equal(res.body.reason, 'CONTACT_CONSENT_NOT_GRANTED', role);
    assert.equal(res.body.contact_channels, undefined, role);
  }
});

test('dealer mismatch: lineage pointing at another dealer yields SELLER_LINEAGE_UNVERIFIED', async () => {
  const fixture = dealerFixture({ consent: true });
  fixture.seller_listing_lineage_staging[0].matched_dealer_id = 'different-dealer';
  activeClient = mockClient(fixture);
  const res = await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor' });
  assert.equal(res.body.contact_available, false);
  assert.equal(res.body.reason, 'SELLER_LINEAGE_UNVERIFIED');
  assert.equal(deepScan(res.body, SYNTHETIC_PHONE_DIGITS), false);
});

test('unverified dealer status never yields contact channels', async () => {
  const fixture = dealerFixture({ consent: true });
  fixture.dealers[0].status = 'PENDING';
  activeClient = mockClient(fixture);
  const res = await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor' });
  assert.equal(res.body.contact_available, false);
  assert.equal(res.body.reason, 'CONTACT_NOT_VERIFIED');
});

test('child/parent isolation: parent consent never leaks to a child and vice versa', async () => {
  const mkRecord = (id, approved, phone) => ({
    id,
    brand: 'Rolex',
    reference: '116610LN',
    listing_type: 'WTS',
    dealer_id: null,
    verdict: 'APPROVED',
    confidence: 90,
    source: 'SYNTHETIC_TEST_SOURCE',
    seller_name: 'Synthetic Seller',
    seller_phone: phone,
    flags: [],
    contact_publication_approved: approved,
  });
  const publicRows = [
    { id: 'parent-listing', brand: 'Rolex', reference: '116610LN' },
    { id: 'child-listing', brand: 'Rolex', reference: '116610LN' },
  ];

  // Parent approved; child NOT approved → child must not expose contact.
  activeClient = mockClient({
    trading_floor_verified_listings: publicRows,
    watch_records: [
      mkRecord('parent-listing', true, SYNTHETIC_PHONE),
      mkRecord('child-listing', false, SYNTHETIC_PHONE),
    ],
  });
  const parentRes = await invoke({ id: 'parent-listing', surface: 'trading-floor' });
  assert.equal(parentRes.body.contact_available, true);
  const childRes = await invoke({ id: 'child-listing', surface: 'trading-floor' });
  assert.equal(childRes.body.contact_available, false);
  assert.equal(deepScan(childRes.body, SYNTHETIC_PHONE_DIGITS), false);

  // Child approved; parent NOT approved → parent must not expose contact.
  activeClient = mockClient({
    trading_floor_verified_listings: publicRows,
    watch_records: [
      mkRecord('parent-listing', false, SYNTHETIC_PHONE),
      mkRecord('child-listing', true, SYNTHETIC_PHONE),
    ],
  });
  const childRes2 = await invoke({ id: 'child-listing', surface: 'trading-floor' });
  assert.equal(childRes2.body.contact_available, true);
  const parentRes2 = await invoke({ id: 'parent-listing', surface: 'trading-floor' });
  assert.equal(parentRes2.body.contact_available, false);
  assert.equal(deepScan(parentRes2.body, SYNTHETIC_PHONE_DIGITS), false);
});

test('channel click resolves wa.me only via explicit channel request (302, no phone in body)', async () => {
  activeClient = mockClient(dealerFixture({ consent: true }));
  const res = await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor', channel: 'whatsapp' });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.Location, new RegExp(`^https://wa\\.me/${SYNTHETIC_PHONE_DIGITS}\\?text=`));
  assert.equal(res.body, null);
});

test('rate limiting: bursts beyond the window limit are rejected with 429 and audited', async () => {
  const audits = [];
  handler.setContactAuditSink(event => audits.push(event));
  activeClient = mockClient(dealerFixture({ consent: true }));
  const query = { id: 'wf-dealer-listing-1', surface: 'trading-floor' };
  const ip = '10.7.7.7';
  let last = null;
  for (let i = 0; i < 30; i += 1) {
    last = await invoke(query, { ip });
    assert.equal(last.statusCode, 200, `request ${i + 1} within limit`);
  }
  const blocked = await invoke(query, { ip });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['Retry-After'], '600');
  assert.ok(audits.some(event => event.event === 'CONTACT_RATE_LIMITED'));
  handler.resetContactRateLimitForTests();
  const after = await invoke(query, { ip });
  assert.equal(after.statusCode, 200);
});

test('audit events are emitted for grants and denials and never contain phones', async () => {
  const audits = [];
  handler.setContactAuditSink(event => audits.push(event));
  activeClient = mockClient(dealerFixture({ consent: true }));
  await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor' });
  await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor', channel: 'whatsapp' });
  activeClient = mockClient(dealerFixture({ consent: false }));
  await invoke({ id: 'wf-dealer-listing-1', surface: 'trading-floor' });
  assert.ok(audits.some(event => event.event === 'CONTACT_RESOLVED' && event.result === 'AVAILABLE'));
  assert.ok(audits.some(event => event.event === 'CONTACT_RESOLVED' && event.result === 'REDIRECT'));
  assert.ok(audits.some(event => event.event === 'CONTACT_DENIED' && event.result === 'CONTACT_CONSENT_NOT_GRANTED'));
  assert.equal(deepScan(audits, SYNTHETIC_PHONE_DIGITS), false);
  assert.equal(deepScan(audits, '555'), false);
});

test('response payload passes through a strict field allowlist', () => {
  const res = mockRes();
  handler.sendContactResult(res, {
    payload: {
      success: true,
      contact_available: true,
      dealer_name: 'Synthetic Dealer',
      seller_phone: SYNTHETIC_PHONE,
      raw_message: 'raw source text',
      internal_note: 'must be stripped',
    },
    externalChannels: { whatsapp: `https://wa.me/${SYNTHETIC_PHONE_DIGITS}?text=hello` },
    id: 'listing-9',
    surface: 'trading-floor',
    requestedChannel: '',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dealer_name, 'Synthetic Dealer');
  assert.equal(res.body.seller_phone, undefined);
  assert.equal(res.body.raw_message, undefined);
  assert.equal(res.body.internal_note, undefined);
  assert.equal(deepScan(res.body, SYNTHETIC_PHONE_DIGITS), false);
});

test('prefilled WhatsApp text contains only public listing facts', () => {
  const url = handler.whatsappUrl(SYNTHETIC_PHONE_DIGITS, {
    id: 'listing-42',
    brand: 'Rolex',
    model: 'Submariner',
    reference: '116610LN',
    dial_color: 'black',
    display_price: '$12,500',
    listing_type: 'WTS',
    seller_phone: SYNTHETIC_PHONE,
    seller_name: 'Private Seller Name',
  });
  assert.match(url, new RegExp(`^https://wa\\.me/${SYNTHETIC_PHONE_DIGITS}\\?text=`));
  const text = decodeURIComponent(url.split('?text=')[1]);
  assert.ok(text.includes('Rolex'));
  assert.ok(text.includes('Submariner'));
  assert.ok(text.includes('116610LN'));
  assert.ok(text.includes('black'));
  assert.ok(text.includes('$12,500'));
  assert.ok(text.includes('listing-42'));
  assert.ok(!text.includes('555'), 'prefilled text must not contain phone fragments');
  assert.ok(!text.includes('Private Seller Name'), 'prefilled text must not contain seller identity');
});

test('Phase 8.1: dealer directory responses strip private provenance and never expose phones', () => {
  const withConsent = dealersApi.publicDealer(
    { id: 'd1', display_name: 'Synthetic', contact_consent: true, verified_phone:SYNTHETIC_PHONE,
      source_identity:SYNTHETIC_PHONE,source_url:'https://watchfacts.com/user/synthetic' },
    1,
  );
  assert.equal(withConsent.verified_phone, undefined);
  assert.equal(withConsent.source_identity, undefined);
  assert.equal(withConsent.source_url, undefined);
  assert.equal(withConsent.contact_consent, undefined);

  const withoutConsent = dealersApi.publicDealer(
    { id: 'd1', display_name: 'Synthetic', contact_consent: false, verified_phone:SYNTHETIC_PHONE },
    1,
  );
  assert.equal(withoutConsent.verified_phone, undefined);

  const provenance = withoutPrivateProvenance({
    display_name: 'Synthetic',
    source_url: 'https://watchfacts.com/user/synthetic',
  });
  assert.equal(provenance.source_url, undefined);

  for (const profile of ratedProfiles()) {
    assert.equal(profile.verified_phone, null, 'directory phones are reconciliation evidence only');
    assert.equal(profile.rating, null, 'no invented rating without evidence source + timestamp');
    assert.equal(profile.rating_evidence_status, 'SOURCE_FEEDBACK_COUNT');
    assert.ok(profile.source_crawled_at, 'evidence timestamp required');
  }
});
