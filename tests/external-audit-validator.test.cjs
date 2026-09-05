'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validate } = require('../tools/external-audit/validate-external-audit.cjs');

function fixture(name, text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-external-audit-'));
  const target = path.join(directory, name);
  fs.writeFileSync(target, text);
  return target;
}

test('accepts a source-backed price recommendation', async () => {
  const input = fixture('price.csv', [
    'source_record_id,reference,raw_evidence_line,stored_price_usd,proposed_price_usd,source_currency_status,recommendation,reason,confidence,needs_human_review',
    'row-1,5712/1A,5712/1A HKD 780000,780000,99490,VERIFIED,APPLY_CANDIDATE,explicit HKD,1,true',
  ].join('\n'));
  const result = await validate(input, { expectedRows: 1 });
  assert.equal(result.status, 'accepted_for_primary_review');
});

test('accepts an explicit currency token attached to a dealer shorthand amount', async () => {
  const input = fixture('price.csv', [
    'source_record_id,reference,raw_evidence_line,stored_price_usd,proposed_price_usd,source_currency_status,recommendation,reason,confidence,needs_human_review',
    'row-hkd,124200,124200 Beige N10 hkd57k,57000,7296,VERIFIED,APPLY_CANDIDATE,explicit hkd57k,1,true',
  ].join('\n'));
  const result = await validate(input, { expectedRows: 1 });
  assert.equal(result.status, 'accepted_for_primary_review');
});

test('accepts an explicit currency token joined to the preceding dealer text', async () => {
  const input = fixture('price.csv', [
    'source_record_id,reference,raw_evidence_line,stored_price_usd,proposed_price_usd,source_currency_status,recommendation,reason,confidence,needs_human_review',
    'row-hkd-joined,26240OR,26240OR Full Gold 2025YHKD980K,980000,125440,VERIFIED,APPLY_CANDIDATE,explicit HKD980K,1,true',
  ].join('\n'));
  const result = await validate(input, { expectedRows: 1 });
  assert.equal(result.status, 'accepted_for_primary_review');
});

test('blocks an apply recommendation based on a bare dollar price', async () => {
  const input = fixture('price.csv', [
    'source_record_id,reference,raw_evidence_line,stored_price_usd,proposed_price_usd,source_currency_status,recommendation,reason,confidence,needs_human_review',
    'row-2,116500LN,116500LN $250000,250000,250000,VERIFIED,APPLY_CANDIDATE,bare dollar,0.9,true',
  ].join('\n'));
  const result = await validate(input);
  assert.equal(result.status, 'blocked');
  assert.equal(result.issueCounts.APPLY_WITHOUT_EXPLICIT_CURRENCY_EVIDENCE, 1);
});

test('blocks Price Research admission for an unresolved bundle', async () => {
  const headers = [
    'source_record_id', 'parent_source_id', 'raw_child_line', 'brand_raw', 'brand_normalized',
    'reference_raw', 'reference_normalized', 'model_normalized', 'dial_raw', 'dial_normalized',
    'condition_raw', 'condition_normalized', 'price_raw', 'currency_raw', 'price_normalized',
    'currency_normalized', 'price_usd', 'intent', 'seller_name', 'seller_phone', 'original_posted_at',
    'catalog_status', 'bundle_status', 'duplicate_status', 'currency_status', 'image_status',
    'price_research_eligible', 'recommendation', 'review_reasons', 'confidence', 'batch_id',
  ];
  const row = [
    'row-3', 'parent-1', '5712/1A HKD 780000', 'Patek Philippe', 'Patek Philippe',
    '5712/1A', '5712/1A', 'Nautilus', 'Blue', 'Blue', 'Used', 'Used', '780000', 'HKD',
    '780000', 'HKD', '99490', 'WTS', '', '', '2025-01-01', 'EXACT_MATCH', 'PARENT_ENVELOPE',
    'UNVERIFIED', 'VERIFIED', 'UNVERIFIED', 'true', 'APPLY_CANDIDATE', 'bundle parent', '1', 'batch-1',
  ];
  const input = fixture('watches.csv', `${headers.join(',')}\n${row.join(',')}\n`);
  const result = await validate(input);
  assert.equal(result.status, 'blocked');
  assert.equal(result.issueCounts.APPLY_FROM_UNRESOLVED_BUNDLE, 1);
  assert.equal(result.issueCounts.PRICE_RESEARCH_UNRESOLVED_BUNDLE, 1);
});

test('blocks an image candidate without exact lineage evidence', async () => {
  const input = fixture('images.csv', [
    'source_record_id,source_message_id,image_key,public_url,match_basis,url_reachable,recommendation,reason,batch_id',
    'row-4,,watch.jpg,https://example.com/watch.jpg,visual resemblance,true,SAFE_CANDIDATE,looks similar,batch-1',
  ].join('\n'));
  const result = await validate(input);
  assert.equal(result.status, 'blocked');
  assert.equal(result.issueCounts.SAFE_IMAGE_MISSING_LINEAGE_ID, 1);
  assert.equal(result.issueCounts.SAFE_IMAGE_WEAK_MATCH_BASIS, 1);
});
