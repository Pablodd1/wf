'use strict';

const assert = require('assert');
const https = require('https');

const { classifyResearchEligibility, classifyDemandEligibility } = require('../api/_lib/price-research-eligibility.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qnsafosakvonzgfcsphh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg';

function fetchPostgrest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const req = https.get(url, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Accept': 'application/json'
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
  });
}

async function runNodeApiTests() {
  console.log('=== RUNNING NODE API PRICE-RESEARCH INTEGRATION TESTS ===');

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

  // Test 2: classifyResearchEligibility MUST reject WTB records from sales analytics
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

  // Test 4: Query real PostgREST views for WTS stats
  const salesRows = await fetchPostgrest('/rest/v1/price_research_verified_source?listing_type=eq.WTS&price_usd=gt.0&limit=20');
  assert(salesRows && salesRows.length > 0, 'Sales query must return rows');
  for (const r of salesRows) {
    assert.strictEqual(r.listing_type, 'WTS', 'Sales cohort must only contain WTS');
    assert(Number(r.price_usd) > 0, 'Sales cohort must contain positive price_usd');
  }
  console.log(`[PASS] Test 4: Real sales query returned ${salesRows.length} WTS eligible records.`);

  // Test 5: Query real PostgREST views for WTB demand
  const demandRows = await fetchPostgrest('/rest/v1/price_research_verified_source?intent=eq.WTB&limit=20');
  assert(demandRows && demandRows.length > 0, 'Demand query must return WTB rows');
  for (const r of demandRows) {
    assert.strictEqual(r.intent, 'WTB', 'Demand cohort must contain WTB intent');
  }
  console.log(`[PASS] Test 5: Real demand query returned ${demandRows.length} WTB demand records.`);

  console.log('=== ALL NODE API INTEGRATION TESTS PASSED CLEANLY ===');
}

runNodeApiTests().catch(err => {
  console.error('[FAIL] Node API Integration test error:', err);
  process.exit(1);
});
