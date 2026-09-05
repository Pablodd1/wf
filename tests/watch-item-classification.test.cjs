'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyWatchPartListing } = require('../api/_lib/watch-item-classification.cjs');

test('classifies an explicit part offered for a watch reference as an accessory', () => {
  assert.deepEqual(classifyWatchPartListing({
    item_category: 'WATCH',
    raw_message: 'Black Ceramic Bezel for 116500LN Rolex Daytona Steel *$2,400*',
  }), {
    category: 'ACCESSORY',
    reason: 'WATCH_PART_ACCESSORY',
    item_type: 'Bezel',
  });
  assert.equal(classifyWatchPartListing({
    item_category: 'WATCH', raw_message: 'OEM strap to fit RM11-03 $1,200',
  })?.item_type, 'Strap');
  assert.equal(classifyWatchPartListing({
    item_category: 'WATCH', raw_message: 'Dial compatible with 5712/1A $5,000',
  })?.item_type, 'Dial');
});

test('does not reclassify a whole watch because its configuration mentions a part', () => {
  for (const raw_message of [
    'Rolex Daytona 116500LN watch on black strap $25,000',
    'Rolex Daytona 116500LN watch with original bracelet and papers $25,000',
    'Full set watch including spare strap Rolex 116500LN $25,000',
    'Rolex 116500LN blue dial watch only $25,000',
  ]) {
    assert.equal(classifyWatchPartListing({ item_category: 'WATCH', raw_message }), null);
  }
});

test('does not override an already explicit non-accessory category', () => {
  assert.equal(classifyWatchPartListing({
    item_category: 'JEWELRY', raw_message: 'Bezel for 116500LN $2,400',
  }), null);
});
