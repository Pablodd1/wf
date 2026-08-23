'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'reviewed-market-inventory.js'), 'utf8');

test('four-brand releases bypass workbook admission and use the effective release RPC', () => {
  assert.match(source, /REVIEWED_WORKBOOK_ADMISSION_BRANDS\.has\(brand\)\s*&& !fourBrandEffectiveScope/);
  assert.match(source, /if \(fourBrandEffectiveScope\) \{[\s\S]*qnsa_four_brand_effective_page_rows/);
  assert.match(source, /p_reference: requestedReference \|\| null/);
  assert.match(source, /deduplicateRecordsById\(\[\.\.\.publicBaseRecords, \.\.\.reviewedOverlayRecords\]\)/);
  assert.match(source, /exact_listing_id_duplicates_held: combinedPageDuplicateCount/);
});

test('a transient effective-page timeout falls back to the bounded controlled-brand feed', () => {
  assert.match(
    source,
    /isTransientEffectiveRpcTimeout\(rpcError\)[\s\S]*cartierRelease \? 'qnsa_cartier_page_rows'[\s\S]*omegaRelease \? 'qnsa_omega_page_rows'[\s\S]*tudorRelease \? 'qnsa_tudor_page_rows'/,
  );
  assert.match(source, /QNSA controlled brand fallback page failed/);
  assert.match(source, /preloadedQnsaResponse = new Response\(JSON\.stringify\(await fallbackResponse\.json\(\)\)/);
});
