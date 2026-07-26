const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyWorkbookMatch,
  timestampSecond,
} = require('../tools/data-quality/match-missing-raw-workbook.cjs');

test('workbook matcher compares timestamps to the same second', () => {
  assert.equal(timestampSecond('2025-12-28T12:32:31+00:00'), '2025-12-28 12:32:31');
  assert.equal(timestampSecond('2025-12-28 12:32:31'), '2025-12-28 12:32:31');
});

test('workbook matcher routes a unique timestamp plus exact reference to high-confidence review', () => {
  const record = {
    reference: '126500LN',
    created_at: '2025-12-28T12:32:31+00:00',
  };
  const rows = [{
    reference: '126500LN',
    created_at: '2025-12-28 12:32:31',
    raw_message: 'Rolex 126500LN',
  }];
  assert.equal(classifyWorkbookMatch(record, rows).disposition, 'HIGH_CONFIDENCE_REVIEW');
});

test('workbook matcher never treats ambiguous or empty raw rows as recovered evidence', () => {
  const record = {
    reference: '126500LN',
    created_at: '2025-12-28T12:32:31+00:00',
  };
  const duplicate = {
    reference: '126500LN',
    created_at: '2025-12-28 12:32:31',
    raw_message: 'Rolex 126500LN',
  };
  assert.equal(classifyWorkbookMatch(record, [duplicate, duplicate]).disposition, 'AMBIGUOUS');
  assert.equal(classifyWorkbookMatch(record, [{ ...duplicate, raw_message: null }]).disposition, 'UNRESOLVED');
});
