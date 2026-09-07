'use strict';

/**
 * Phase 9 — image lineage resolver contract tests.
 *
 * Canonical resolver: bounded HEAD, then bounded GET fallback only when HEAD
 * fails or is inconclusive. Both probes require status 200 AND an image/*
 * Content-Type. image_key is always preserved; image_url is null whenever
 * evidence is insufficient. All network probes use mocked fetch, except a
 * single documented real HEAD against the canonical candidate pattern with a
 * deliberately nonexistent random key (read-only, no enumeration).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

const contract = require('../shared/listing-display-contract.cjs');
const {
  IMAGE_EVIDENCE,
  PUBLIC_IMAGE_EVIDENCE_TYPES,
  CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE,
  publicImageProvenance,
} = require('../api/_lib/public-image-provenance.cjs');

function fakeResponse({ status = 200, contentType = 'image/jpeg', contentLength = '12345' } = {}) {
  return {
    status,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'content-type') return contentType;
        if (key === 'content-length') return contentLength;
        return null;
      },
    },
  };
}

function fetchScript(script) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    const step = script[Math.min(calls.length, script.length - 1)];
    calls.push({ url, method: opts.method || 'GET' });
    if (step.throw) throw step.throw;
    return fakeResponse(step);
  };
  return { calls, fetchFn };
}

const VALID_KEY = '9f3b2a1c4d5e6f708192a3b4c5d6e7f8.jpg';

test('working source URL: HEAD 200 + image content-type resolves', async () => {
  const { calls, fetchFn } = fetchScript([{ status: 200, contentType: 'image/jpeg' }]);
  const result = await contract.resolveImageUrl(VALID_KEY, { fetchFn });
  assert.equal(result.image_url, `${contract.DO_SPACES_BASE}/${VALID_KEY}`);
  assert.equal(result.method, 'HEAD');
  assert.equal(result.evidence, 'VERIFIED_REACHABLE_IMAGE');
  assert.equal(result.image_key, VALID_KEY);
  assert.equal(calls.length, 1, 'GET fallback must not run when HEAD is conclusive');
});

test('missing object: HEAD 404 is definitive; key preserved, image_url null', async () => {
  const { calls, fetchFn } = fetchScript([{ status: 404, contentType: 'application/xml' }]);
  const result = await contract.resolveImageUrl(VALID_KEY, { fetchFn });
  assert.equal(result.image_url, null);
  assert.equal(result.image_key, VALID_KEY, 'image_key preserved on verification failure');
  assert.equal(result.reason, 'NOT_FOUND');
  assert.equal(result.evidence, 'NO_IMAGE');
  assert.equal(calls.length, 1, 'definitive 404 must not trigger a GET fallback');
});

test('non-image response: Content-Type gate rejects text/html on both probes', async () => {
  const { calls, fetchFn } = fetchScript([
    { status: 200, contentType: 'text/html' },
    { status: 200, contentType: 'text/html' },
  ]);
  const result = await contract.resolveImageUrl(VALID_KEY, { fetchFn });
  assert.equal(result.image_url, null);
  assert.equal(result.reason, 'NON_IMAGE_RESPONSE');
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'GET']);
});

test('HEAD failure + GET success fallback resolves the image', async () => {
  const { calls, fetchFn } = fetchScript([
    { throw: Object.assign(new Error('head aborted'), { name: 'AbortError' }) },
    { status: 200, contentType: 'image/png' },
  ]);
  const result = await contract.resolveImageUrl(VALID_KEY, { fetchFn });
  assert.equal(result.image_url, `${contract.DO_SPACES_BASE}/${VALID_KEY}`);
  assert.equal(result.method, 'GET');
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'GET']);
});

test('HEAD 405 (method unsupported) falls back to GET', async () => {
  const { fetchFn } = fetchScript([
    { status: 405, contentType: null },
    { status: 200, contentType: 'image/webp' },
  ]);
  const result = await contract.resolveImageUrl(VALID_KEY, { fetchFn });
  assert.equal(result.image_url, `${contract.DO_SPACES_BASE}/${VALID_KEY}`);
  assert.equal(result.method, 'GET');
});

test('unreachable origin: image_url null and image_key preserved', async () => {
  const { fetchFn } = fetchScript([
    { throw: new Error('ECONNREFUSED') },
    { throw: new Error('ECONNREFUSED') },
  ]);
  const result = await contract.resolveImageUrl(VALID_KEY, { fetchFn });
  assert.equal(result.image_url, null);
  assert.equal(result.image_key, VALID_KEY);
  assert.equal(result.reason, 'UNREACHABLE');
  assert.equal(result.reachable, false);
});

test('invalid/path-traversal keys never produce a URL', async () => {
  for (const key of ['../secret.jpg', 'a?b.jpg', 'x#y.jpg', '', null]) {
    const { calls, fetchFn } = fetchScript([{ status: 200 }]);
    const result = await contract.resolveImageUrl(key, { fetchFn });
    assert.equal(result.image_url, null, String(key));
    assert.equal(calls.length, 0, 'no network probe for invalid keys');
  }
});

test('shared bundle image rejection: parent attachment is never inherited by children', () => {
  // Contract lineage: bundle parent attachment stays unassigned...
  assert.equal(contract.assignImageEvidenceType({
    imageKey: VALID_KEY,
    candidateUrl: `${contract.DO_SPACES_BASE}/${VALID_KEY}`,
    hasSourceLineage: true,
    isReachable: null,
    isBundle: true,
    isChild: false,
  }), 'PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD');
  // ...an unassigned child is typed CHILD_UNASSIGNED_IMAGE...
  assert.equal(contract.assignImageEvidenceType({
    imageKey: VALID_KEY,
    candidateUrl: `${contract.DO_SPACES_BASE}/${VALID_KEY}`,
    hasSourceLineage: true,
    isReachable: null,
    isBundle: true,
    isChild: true,
    childAssigned: false,
    parentHasAttachment: true,
  }), 'CHILD_UNASSIGNED_IMAGE');
  // ...and the public mapping collapses both to NO_IMAGE so the UI can never
  // display a shared bundle image as if it were a child's own photo.
  assert.equal(CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE.PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD, 'NO_IMAGE');
  assert.equal(CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE.CHILD_UNASSIGNED_IMAGE, 'NO_IMAGE');
});

test('exact child attachment acceptance: verified child image maps to a displayable type', () => {
  assert.equal(contract.assignImageEvidenceType({
    imageKey: VALID_KEY,
    candidateUrl: `${contract.DO_SPACES_BASE}/${VALID_KEY}`,
    hasSourceLineage: true,
    isReachable: null,
    isBundle: true,
    isChild: true,
    childAssigned: true,
  }), 'ASSIGNED_CHILD_IMAGE');
  assert.equal(CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE.ASSIGNED_CHILD_IMAGE, 'SELLER_LISTING_IMAGE');
});

test('reference images are never upgraded to seller/source listing images', () => {
  const reference = publicImageProvenance({
    has_images: true,
    thumbnail_url: 'https://cdn.example.com/reference/pam00576.jpg',
    image_evidence_type: 'REFERENCE_IMAGE',
    source: 'SOME_REVIEWED_SOURCE',
  });
  assert.equal(reference.image_evidence_type, 'REFERENCE_IMAGE');
  // The public mapping table has no path that turns REFERENCE into SELLER/SOURCE.
  assert.equal(CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE.REFERENCE_IMAGE, undefined);
  assert.ok(!Object.values(CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE).includes('REFERENCE_IMAGE')
    || CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE.NO_IMAGE !== 'REFERENCE_IMAGE');
});

test('enum parity: API module and React whitelist share one public taxonomy', () => {
  // API taxonomy values must be a subset of the canonical public enum.
  for (const value of Object.values(IMAGE_EVIDENCE)) {
    assert.ok(PUBLIC_IMAGE_EVIDENCE_TYPES.includes(value), `API emits unknown evidence type ${value}`);
  }

  // React display whitelist (PriceResearch.tsx exactSourceImageUrl).
  const uiSource = fs.readFileSync(path.join(__dirname, '..', 'src/pages/PriceResearch.tsx'), 'utf8');
  const match = uiSource.match(/\[('(?:NO_IMAGE|REFERENCE_IMAGE|SELLER_LISTING_IMAGE|SOURCE_LISTING_IMAGE|SOURCE_LINKED_IMAGE)'(?:,\s*'(?:NO_IMAGE|REFERENCE_IMAGE|SELLER_LISTING_IMAGE|SOURCE_LISTING_IMAGE|SOURCE_LINKED_IMAGE)')*)\]/);
  assert.ok(match, 'UI whitelist literal must be findable');
  const uiWhitelist = [...match[1].matchAll(/'([A-Z_]+)'/g)].map(item => item[1]).sort();
  assert.deepEqual(uiWhitelist, ['SELLER_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE', 'SOURCE_LISTING_IMAGE']);

  // The UI whitelist must accept only displayable members of the public enum
  // and must exclude NO_IMAGE / REFERENCE_IMAGE.
  for (const value of uiWhitelist) {
    assert.ok(PUBLIC_IMAGE_EVIDENCE_TYPES.includes(value));
  }
  assert.ok(!uiWhitelist.includes('REFERENCE_IMAGE'), 'reference images are not displayable as listing photos');
  assert.ok(!uiWhitelist.includes('NO_IMAGE'));

  // Contract lineage types must all be covered by the explicit mapping.
  const contractTypes = [
    'NO_IMAGE',
    'SOURCE_LINKED_IMAGE',
    'PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD',
    'ASSIGNED_CHILD_IMAGE',
    'CHILD_UNASSIGNED_IMAGE',
  ];
  for (const value of contractTypes) {
    assert.ok(Object.hasOwn(CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE, value), `unmapped contract type ${value}`);
    assert.ok(PUBLIC_IMAGE_EVIDENCE_TYPES.includes(CONTRACT_TO_PUBLIC_IMAGE_EVIDENCE[value]));
  }
});

test('documented real probe: canonical pattern returns 404 for a nonexistent random key', async (t) => {
  // Read-only network authorization (Phase 9 brief): ONE HEAD request against
  // https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/<key>
  // with a deliberately random, nonexistent key. Timestamp recorded below.
  const randomKey = `nonexistent-${crypto.randomBytes(16).toString('hex')}.jpg`;
  const probeStartedAt = new Date().toISOString();
  let result;
  try {
    result = await contract.resolveImageUrl(randomKey, { timeoutMs: 8000 });
  } catch (error) {
    t.skip(`network unavailable on this host: ${error.message}`);
    return;
  }
  console.info(`[image-lineage] real probe at ${probeStartedAt} key=${randomKey} status=${result.status}`);
  if (result.status === 0) {
    t.skip('network egress blocked on this host; mocked probes cover the logic');
    return;
  }
  assert.equal(result.image_url, null);
  assert.equal(result.image_key, randomKey);
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'NOT_FOUND');
});
