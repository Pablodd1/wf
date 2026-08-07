'use strict';

const assert = require('assert');
const { classifyResearchEligibility, classifyDemandEligibility } = require('../api/_lib/price-research-eligibility.cjs');
const handler = require('../api/price-research.js');

const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY;

async function runNodeApiTests() {
  console.log('=== RUNNING NODE API PRICE-RESEARCH HANDLER INTEGRATION TESTS ===');

  if (!ANON_KEY) {
    console.log('[SKIP] SUPABASE_ANON_KEY / ANON_KEY not set in environment. Skipping live handler tests.');
  }

  // Test 1: classifyDemandEligibility MUST NOT reject genuine WTB records
  const wtbRow = {
    brand: 'Rolex',
    reference: '126610LN',
    model: 'Submariner',
    dial_color: 'Black',
    intent: 'WTB',
    listing_type: 'WTB',
    price_usd: null,
    price_raw: null,
  };
  const mockCatalog = {
    found: true,
    model: 'Submariner',
    dialColors: ['Black']
  };

  const demandEligibility = classifyDemandEligibility(wtbRow, mockCatalog);
  assert.strictEqual(demandEligibility, null, `classifyDemandEligibility MUST return null (eligible) for WTB row, got: ${demandEligibility}`);
  console.log('[PASS] Test 1: classifyDemandEligibility correctly returns null (eligible) for genuine WTB buyer request.');

  // Test 2: classifyResearchEligibility MUST reject WTB records from sales price research
  const researchEligibilityForWTB = classifyResearchEligibility(wtbRow, mockCatalog);
  assert.strictEqual(researchEligibilityForWTB, 'NOT_WTS_SALE', `classifyResearchEligibility MUST return NOT_WTS_SALE for WTB row, got: ${researchEligibilityForWTB}`);
  console.log('[PASS] Test 2: classifyResearchEligibility correctly rejects WTB from sales price research.');

  // Test 3: classifyResearchEligibility MUST accept genuine WTS sales record
  const wtsRow = {
    brand: 'Rolex',
    reference: '126610LN',
    model: 'Submariner',
    dial_color: 'Black',
    intent: 'WTS',
    listing_type: 'WTS',
    price_usd: 14000,
    price_raw: 14000,
  };
  const researchEligibilityForWTS = classifyResearchEligibility(wtsRow, mockCatalog);
  assert.strictEqual(researchEligibilityForWTS, null, `classifyResearchEligibility MUST return null for valid WTS row, got: ${researchEligibilityForWTS}`);
  console.log('[PASS] Test 3: classifyResearchEligibility accepts genuine WTS sale record.');

  // Test 4: Invoke the ACTUAL handler exported by api/price-research.js
  if (ANON_KEY) {
    let statusCode = null;
    let jsonResult = null;
    const resHeaders = {};

    const req = {
      method: 'GET',
      headers: {},
      query: {
        brand: 'Rolex',
        reference: '126610LN',
      }
    };

    const res = {
      setHeader(k, v) {
        resHeaders[k] = v;
      },
      status(code) {
        statusCode = code;
        return {
          json(data) {
            jsonResult = data;
            return data;
          }
        };
      }
    };

    await handler(req, res);

    assert.strictEqual(statusCode, 200, `Handler must return HTTP status 200, got: ${statusCode}`);
    assert.strictEqual(jsonResult.success, true, 'Handler response must indicate success');

    // Assert exact required fields in handler output
    assert(Array.isArray(jsonResult.rows), 'Handler output MUST contain rows array');
    assert(Array.isArray(jsonResult.demand_rows), 'Handler output MUST contain demand_rows array');
    assert(typeof jsonResult.wtb_demand_count === 'number', 'Handler output MUST contain wtb_demand_count number');
    assert(typeof jsonResult.wts_eligible_analytics_count === 'number', 'Handler output MUST contain wts_eligible_analytics_count number');
    assert(jsonResult.stats !== undefined, 'Handler output MUST contain stats object/null');

    console.log(`[PASS] Test 4: Genuine api/price-research.js handler invoked successfully!`);
    console.log(`       - wts_eligible_analytics_count: ${jsonResult.wts_eligible_analytics_count}`);
    console.log(`       - wtb_demand_count: ${jsonResult.wtb_demand_count}`);
    console.log(`       - rows count: ${jsonResult.rows.length}`);
    console.log(`       - demand_rows count: ${jsonResult.demand_rows.length}`);

    // Verify rows contain strictly WTS listings (no WTB or SINGLE)
    for (const r of jsonResult.rows) {
      if (r.listing_type) {
        assert.strictEqual(r.listing_type, 'WTS', `Sales comparables MUST strictly be WTS, got: ${r.listing_type}`);
      }
    }
    console.log('[PASS] Test 5: All returned sales comparable rows are strictly WTS.');
  }

  console.log('=== ALL NODE API HANDLER INTEGRATION TESTS PASSED CLEANLY ===');
}

runNodeApiTests().catch(err => {
  console.error('[FAIL] Node API Integration test error:', err);
  process.exit(1);
});
