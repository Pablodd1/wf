const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { ZERO_HALLUCINATION_NORMALIZATION_CONTRACT } = require('../api/_lib/ai-normalization-contract.cjs');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('shared AI contract requires raw evidence and nulls', () => {
  assert.match(ZERO_HALLUCINATION_NORMALIZATION_CONTRACT, /raw listing message is the only extraction evidence/i);
  assert.match(ZERO_HALLUCINATION_NORMALIZATION_CONTRACT, /bare "\$" is ambiguous/i);
  assert.match(ZERO_HALLUCINATION_NORMALIZATION_CONTRACT, /return JSON null/i);
  assert.match(ZERO_HALLUCINATION_NORMALIZATION_CONTRACT, /AI output is a review suggestion only/i);
});

test('legacy reprocessing cannot promote AI price or currency', () => {
  const code = source('api/reprocess.js');
  assert.doesNotMatch(code, /out\.price\s*=\s*llm\.price/);
  assert.doesNotMatch(code, /out\.currency\s*=\s*llm\.currency/);
  assert.doesNotMatch(code, /parsed\.currency\s*\|\|\s*['"]USD['"]/);
  assert.doesNotMatch(code, /price\s*>\s*50k\s*.*HKD/i);
});

test('pipeline withholds conversion when currency is unresolved', () => {
  const code = source('api/pipeline-parse.js');
  assert.doesNotMatch(code, /parsed\.currency\s*\|\|\s*['"]USD['"]/);
  assert.doesNotMatch(code, /cs\s*===\s*['"]\$['"]\s*\|\|\s*cs\s*===\s*['"]USD['"]/);
  assert.match(code, /Currency unresolved; conversion withheld/);
  assert.match(code, /!aiAssisted/);
});

test('legacy extractors do not invent HKD or missing multipliers', () => {
  const extract = source('api/extract.js');
  const clean = source('api/clean-analyze.js');
  assert.doesNotMatch(extract, /bare_number_guessed_hkd/);
  assert.doesNotMatch(extract, /result\.price\s*=\s*result\.price\s*\*\s*1000/);
  assert.doesNotMatch(clean, /CURRENCY_FROM_TEXT\s*\|\|\s*['"]HKD['"]/);
  assert.doesNotMatch(clean, /rawCur\s*===\s*['"]\$['"]\)\s*cur\s*=\s*['"]USD['"]/);
  assert.doesNotMatch(clean, /price:\s*ai\.price/);
  assert.doesNotMatch(clean, /currency:\s*ai\.currency/);
});

test('dashboard review helper cannot promote AI price or currency', () => {
  const code = source('src/pages/Home.tsx');
  assert.doesNotMatch(code, /price:\s*ai\.price/);
  assert.doesNotMatch(code, /originalCurrency:\s*ai\.currency/);
  assert.doesNotMatch(code, /confidence:\s*Math\.min\(100,\s*record\.confidence\s*\+/);
});

test('legacy approval gates require human confirmation after AI assistance', () => {
  const reprocess = source('api/reprocess.js');
  const clean = source('api/clean-analyze.js');
  assert.match(reprocess, /parsed\.source === 'llm'/);
  assert.match(clean, /completeSellEvidence && !aiAssisted/);
  assert.match(clean, /catalogConfirmed/);
});

test('client and export layers do not reintroduce currency defaults', () => {
  for (const relativePath of [
    'src/hooks/useWatchData.ts',
    'src/lib/pipelineClient.ts',
    'src/lib/pipeline.ts',
    'src/lib/datasetExport.ts',
    'src/lib/currency.ts',
  ]) {
    const code = source(relativePath);
    assert.doesNotMatch(code, /\|\|\s*['"](?:USD|HKD)['"]/);
  }
});
