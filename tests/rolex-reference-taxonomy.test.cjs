'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyReference } = require('../tools/audit/rolex-reference-taxonomy.cjs');

test('the five Phase 3 references are exact catalog-backed Rolex identities', () => {
  const expected = new Map([
    ['126334', 'Datejust'],
    ['126300', 'Datejust'],
    ['228235', 'Day-Date'],
    ['228238', 'Day-Date'],
    ['126333', 'Datejust'],
  ]);
  for (const [reference, model] of expected) {
    const result = classifyReference(reference);
    assert.equal(result.classification, 'VALID_EXACT_REFERENCE', reference);
    assert.equal(result.canonical_reference, reference, reference);
    assert.equal(result.canonical_model, model, reference);
  }
});
test('component, family, free-text, partial, variant, and malformed tokens remain separate', () => {
  const cases = [
    ['BRACELET', 'COMPONENT_ACCESSORY'],
    ['Oyster strap', 'COMPONENT_ACCESSORY'],
    ['Blue dial', 'COMPONENT_ACCESSORY'],
    ['Datejust', 'MODEL_OR_FAMILY_TOKEN'],
    ['GMT-Master II', 'MODEL_OR_FAMILY_TOKEN'],
    ['dealer note', 'FREE_TEXT'],
    ['1263', 'AMBIGUOUS'],
    ['126334-0032', 'VALID_REFERENCE_VARIANT'],
    ['12633?', 'INVALID'],
    ['2026', 'INVALID'],
  ];
  for (const [token, expected] of cases) {
    assert.equal(classifyReference(token).classification, expected, token);
  }
});
