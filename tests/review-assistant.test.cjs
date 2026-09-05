'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  catalogSuggestions,
  normalizeAiSuggestions,
  summarizeAssistance,
} = require('../api/_lib/review-assistant.cjs');

test('accepts a field suggestion only when the value and exact quote occur in raw evidence', () => {
  const raw = 'Rolex 116500LN White dial USD 30,000 WTS';
  const suggestions = normalizeAiSuggestions(raw, [
    {
      field: 'reference',
      value: '116500LN',
      evidenceQuote: 'Rolex 116500LN White dial',
      reason: 'Exact reference',
    },
    {
      field: 'dialColor',
      value: 'Blue',
      evidenceQuote: 'Rolex 116500LN White dial',
      reason: 'Unsupported guess',
    },
  ]);
  assert.equal(suggestions.find(row => row.field === 'reference').status, 'RAW_SUPPORTED');
  assert.equal(suggestions.find(row => row.field === 'reference').applicable, true);
  assert.equal(suggestions.find(row => row.field === 'dialColor').status, 'NEEDS_REVIEW');
  assert.equal(suggestions.find(row => row.field === 'dialColor').applicable, false);
});

test('rejects paraphrased evidence and keeps the field unavailable for draft filling', () => {
  const suggestions = normalizeAiSuggestions('Patek 5712/1A blue', [
    {
      field: 'reference',
      value: '5712/1A',
      evidenceQuote: 'The listing says reference 5712/1A.',
      reason: 'Paraphrase',
    },
  ]);
  const reference = suggestions.find(row => row.field === 'reference');
  assert.equal(reference.evidenceQuote, null);
  assert.equal(reference.status, 'NEEDS_REVIEW');
  assert.equal(reference.applicable, false);
});

test('never treats a bare dollar as explicit currency evidence', () => {
  const suggestions = normalizeAiSuggestions('Rolex 126610LN $12,500', [
    {
      field: 'currency',
      value: 'USD',
      evidenceQuote: '$12,500',
      reason: 'Guessed from symbol',
    },
  ]);
  const currency = suggestions.find(row => row.field === 'currency');
  assert.equal(currency.status, 'AMBIGUOUS');
  assert.equal(currency.applicable, false);
  assert.equal(currency.value, 'USD');
});

test('does not make an AI-expanded K price one-click applicable', () => {
  const suggestions = normalizeAiSuggestions('Patek 5712/1A HKD 380K', [
    {
      field: 'price',
      value: '380000',
      evidenceQuote: 'HKD 380K',
      reason: 'Expanded K',
    },
  ]);
  const price = suggestions.find(row => row.field === 'price');
  assert.equal(price.status, 'NEEDS_REVIEW');
  assert.equal(price.applicable, false);
});

test('keeps even a literal AI price advisory until the reviewer verifies it manually', () => {
  const suggestions = normalizeAiSuggestions('Patek 5712/1A USD 120000', [
    {
      field: 'price',
      value: '120000',
      evidenceQuote: 'USD 120000',
      reason: 'Literal amount',
    },
  ]);
  const price = suggestions.find(row => row.field === 'price');
  assert.equal(price.status, 'NEEDS_REVIEW');
  assert.equal(price.applicable, false);
});

test('uses exact raw reference plus catalog evidence to propose missing model and unique dial', () => {
  const result = catalogSuggestions('Patek Philippe 5712/1A available', {
    brand: 'Patek Philippe',
    reference: '5712/1A',
    model: null,
    dialColor: null,
  });
  assert.equal(result.evidence.confirmed, true);
  assert.ok(result.suggestions.some(row => row.field === 'model' && row.value === 'Nautilus' && row.applicable));
  assert.ok(result.suggestions.some(row => row.field === 'dialColor' && row.value === 'Blue' && row.applicable));
});

test('does not use catalog identity when the proposed reference is absent from raw evidence', () => {
  const result = catalogSuggestions('Patek watch available', {
    brand: 'Patek Philippe',
    reference: '5712/1A',
  });
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.evidence, null);
});

test('reports exactly which blank fields can be filled and which remain unresolved', () => {
  const result = summarizeAssistance(
    'Rolex 116500LN White dial WTS',
    { brand: 'Rolex', reference: '116500LN', model: '', dialColor: '', currency: '' },
    [{
      field: 'listingType',
      value: 'WTS',
      evidenceQuote: 'WTS',
      reason: 'Explicit intent',
    }],
  );
  assert.ok(result.fillableFields.includes('model'));
  assert.ok(result.fillableFields.includes('listingType'));
  assert.ok(result.unresolvedFields.includes('currency'));
});

test('review queue exposes evidence-backed assistance without granting AI approval', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'ReviewQueue.tsx'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'co-pilot.js'), 'utf8');
  assert.match(page, /Missing-field assistant/);
  assert.match(page, /Fill supported blanks/);
  assert.match(page, /These remain blank instead of being guessed/);
  assert.match(page, /suggestionCanPopulateDraft/);
  assert.match(route, /evidenceQuote must be an exact contiguous quote/);
  assert.match(route, /summarizeAssistance/);
  assert.match(route, /They never approve, publish, or write watch_records/);
  assert.doesNotMatch(route, /\.from\('watch_records'\)/);
});
