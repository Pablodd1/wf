'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'ReviewQueue.tsx'),
  'utf8',
);
const packetLane = source.slice(
  source.indexOf('function PacketReviewLane'),
  source.indexOf('function IdentityReviewLane'),
);

test('reason packets stay bounded and load evidence lazily', () => {
  assert.match(packetLane, /const pageSize = 25/);
  assert.match(packetLane, /\/api\/review-packets\?/);
  assert.match(packetLane, /packetId: selectedPacket\.id/);
  assert.match(packetLane, /\/api\/review-packet-item\?/);
  assert.match(packetLane, /itemId: compactItem\.id/);
  assert.match(packetLane, /const value = proposal\[field\]/);
  assert.doesNotMatch(packetLane, /proposal\[field\]\s*\?\?\s*sourceEvidence/);
  assert.doesNotMatch(packetLane, /limit:\s*['"]500['"]/);
});

test('packet corrections preserve evidence and reject stale hashes', () => {
  assert.match(packetLane, /decision:\s*'CORRECTION_PROPOSED'/);
  assert.match(packetLane, /reviewEvidenceExcerpt:\s*String\(sourceEvidence\.rawMessage/);
  assert.match(packetLane, /expectedRawSha256:\s*item\.rawEvidenceHash/);
  assert.match(packetLane, /expectedProposalSha256:\s*item\.proposalHash/);
  assert.match(packetLane, /evidenceHashes:\s*\[item\.rawEvidenceHash, item\.proposalHash\]/);
  assert.match(packetLane, /fields,\s*rationale:/);
  assert.match(packetLane, /field === 'year' \|\| field === 'price_raw' \|\| field === 'price_usd'/);
  assert.match(packetLane, /Number\.isFinite\(numeric\)/);
  assert.match(packetLane, /Number\.isInteger\(numeric\)/);
  assert.match(packetLane, /response\.status === 409/);
  assert.match(packetLane, /data\.code === 'STALE_EVIDENCE'/);
  assert.match(packetLane, /required/);
  assert.match(packetLane, /rationale\.trim\(\)\.length < 10/);
});

test('packet lane includes priority reasons and keeps bundles and AI out', () => {
  assert.match(source, /DETERMINISTIC_CHANGE_REVIEW/);
  assert.match(source, /EMOJI_PRICE_AMBIGUOUS/);
  assert.match(packetLane, /Open unbundled workflow/);
  assert.match(packetLane, /sellerNameMasked/);
  assert.match(packetLane, /sellerPhoneMasked/);
  assert.doesNotMatch(packetLane, /\/api\/co-pilot/);
});
