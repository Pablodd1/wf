'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');
const {
  CHILD_HEADERS,
  approvedChild,
  audit,
} = require('../tools/intake/audit-admission-unbundle-readiness.cjs');

function workbook(filePath) {
  const source = [{
    listing_id: 'parent-1',
    image_count_source: 1,
  }];
  const decisions = [{
    listing_id: 'parent-1',
    bundle_status: 'BUNDLE_SPLIT_REQUIRED',
  }];
  const output = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(output, XLSX.utils.json_to_sheet(source), 'Trading Floor & Price Research');
  XLSX.utils.book_append_sheet(output, XLSX.utils.json_to_sheet(decisions), 'Breguet Admission Decisions');
  XLSX.writeFile(output, filePath);
}

test('identical parent workbooks cannot masquerade as an unbundled child ledger', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-unbundle-'));
  const admission = path.join(directory, 'admission.xlsx');
  workbook(admission);
  const normalized = path.join(directory, 'normalized.xlsx');
  fs.copyFileSync(admission, normalized);
  const result = audit({ admissionPath: admission, normalizedPath: normalized, childLedgerPath: null, brand: 'Breguet' });
  assert.equal(result.admission_and_normalized_are_identical, true);
  assert.equal(result.counts.bundle_parents, 1);
  assert.equal(result.counts.bundle_parents_with_one_image, 1);
  assert.equal(result.counts.approved_child_rows, 0);
  assert.deepEqual(result.child_ledger_missing_headers, CHILD_HEADERS);
  assert.equal(result.publication_ready, false);
  assert.equal(result.automatic_parent_image_inheritance_allowed, false);
});

test('approved children require exact price, image, lineage, and review evidence', () => {
  const valid = {
    parent_listing_id: 'parent-1',
    child_listing_id: 'parent-1-child-1',
    child_index: 1,
    child_raw_message: 'Breguet 7097BR/G1/9WU USD 25,000',
    final_brand: 'Breguet',
    final_model: 'Tradition',
    final_reference: '7097BR/G1/9WU',
    dial_normalized: 'Silver',
    listing_type: 'WTS',
    source_price_text: 'USD 25,000',
    source_price_amount: 25000,
    source_currency: 'USD',
    child_image_url: 'https://example.invalid/child-1.jpg',
    image_association_status: 'EXACT_CHILD_IMAGE',
    review_status: 'APPROVED_SINGLE_CANDIDATE',
    reviewed_by: 'owner-review',
    reviewed_at: '2026-08-16T12:00:00Z',
  };
  assert.deepEqual(approvedChild(valid), []);
  assert.ok(approvedChild({ ...valid, child_image_url: null }).includes('CHILD_IMAGE_URL_INVALID'));
  assert.ok(approvedChild({ ...valid, source_price_amount: null }).includes('CHILD_PRICE_ASSOCIATION_INCOMPLETE'));
  assert.ok(approvedChild({ ...valid, review_status: 'PENDING_REVIEW' }).includes('CHILD_NOT_APPROVED'));
});
