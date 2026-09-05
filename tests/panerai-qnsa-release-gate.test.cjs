const test = require('node:test');
const assert = require('node:assert/strict');

const api = require('../api/price-research.js');

test('Panerai and Omega cannot fall back to legacy workbook IDs in QNSA production', () => {
  const before = process.env.PRICE_RESEARCH_SOURCE_VIEW;
  process.env.PRICE_RESEARCH_SOURCE_VIEW = 'qnsa_rolex_patek_price_research_source';
  try {
    assert.equal(api.isPendingQnsaBrandRelease('Panerai'), true);
    assert.equal(api.isPendingQnsaBrandRelease('Omega'), false);
    assert.equal(api.isPendingQnsaBrandRelease('Rolex'), false);
  } finally {
    if (before == null) delete process.env.PRICE_RESEARCH_SOURCE_VIEW;
    else process.env.PRICE_RESEARCH_SOURCE_VIEW = before;
  }
});
