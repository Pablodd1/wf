'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');
const globalManifest = require('../tools/intake/build-reviewed-multi-parent-manifest.cjs');

function source(listingId, raw) {
  return {
    listing_id: listingId, source_platform: 'WHATSAPP', source_group_id: 'group-1',
    source_message_id: 'shared-message', source_posted_at: '2026-08-11T12:00:00Z',
    ingested_at: '2026-08-11T12:01:00Z', raw_message: raw, intent: 'OTHER',
    category: 'WATCH', asking_price_raw: 'USD 9999', source_currency: 'USD',
    normalized_price_usd: 9999, fx_source: 'SOURCE_USD', fx_rate_date: '2026-08-11',
    image_keys: 'parent-image', image_urls_source: 'https://example.test/parent.jpg',
    image_count_source: 1, duplicate_status_source: 'UNIQUE',
    seller_source_id: 'seller-1', seller_name_source: 'Seller One',
  };
}

function decision(listingId, brand) {
  return {
    listing_id: listingId, final_brand: brand, final_model: 'Multiple', final_reference: '',
    dial_normalized: '', identity_status: 'REVIEW', bundle_status: 'BUNDLE_PENDING',
    image_status: 'WITHHELD', duplicate_decision: 'COUNT', trading_floor_status: 'HOLD',
    price_research_status: 'INELIGIBLE', review_reason: 'BUNDLE_PENDING',
    reviewed_by: 'owner', reviewed_at: '2026-08-16T00:00:00Z',
  };
}

function workbook(file, brand, listingId, raw) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([source(listingId, raw)]),
    'Trading Floor & Price Research');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([decision(listingId, brand)]),
    `${brand} Admission Decisions`);
  XLSX.writeFile(wb, file);
}

test('global manifest is input-order independent and removes cross-brand parent copies', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-parent-global-'));
  const tag = path.join(temp, 'tag.xlsx');
  const breguet = path.join(temp, 'breguet.xlsx');
  workbook(tag, 'TAG Heuer', 'tag-item', 'Same complete dealer bundle');
  workbook(breguet, 'Breguet', 'breguet-item', 'Same complete dealer bundle');
  const loadedTag = globalManifest.loadWorkbookEntries({ brand: 'TAG Heuer', input: tag });
  const loadedBreguet = globalManifest.loadWorkbookEntries({ brand: 'Breguet', input: breguet });
  const forward = globalManifest.buildGlobalManifest([loadedTag, loadedBreguet], 'fixed-run');
  const reverse = globalManifest.buildGlobalManifest([loadedBreguet, loadedTag], 'fixed-run');
  assert.deepEqual(reverse, forward);
  assert.equal(forward.rows.length, 1);
  assert.equal(forward.report.per_file_parent_candidates, 2);
  assert.equal(forward.report.duplicate_parent_copies_eliminated, 1);
  assert.equal(forward.report.cross_brand_parents, 1);
  const [row] = forward.rows;
  assert.equal(row.brand_scope, 'Breguet');
  assert.equal(row.supplied_brand, 'Multiple brands');
  assert.equal(row.raw_message, 'Same complete dealer bundle');
  assert.equal(row.listing_type, 'MULTI');
  assert.equal(row.workbook_price_usd, null);
  assert.equal(row.final_image_url, null);
  assert.equal(row.phone_number, null);
});

test('global publisher is opt-in, table-allowlisted, bounded, and avoids full-table counts', () => {
  const sourceText = fs.readFileSync(path.join(
    __dirname, '..', 'tools', 'intake', 'build-reviewed-multi-parent-manifest.cjs',
  ), 'utf8');
  assert.match(sourceText, /APPLY_REVIEWED_MULTI_PARENT_IMPORT === 'true'/);
  assert.match(sourceText, /REVIEWED_WORKBOOK_INVENTORY_TABLE !== INVENTORY_TABLE/);
  assert.match(sourceText, /--batch-size must be 1 through 100/);
  assert.match(sourceText, /--max-rows must be a positive integer/);
  assert.match(sourceText, /manifest\.rows\.slice\(0, options\.maxRows\)/);
  assert.match(sourceText, /\.in\('id', ids\)/);
  assert.doesNotMatch(sourceText, /count:\s*'exact'|select\('\*',\s*\{\s*count/);
  assert.match(sourceText, /database_writes: 0/);
});

test('global publisher parses a bounded production canary without changing the full manifest', () => {
  const parsed = globalManifest.parseArgs([
    '--input', 'TAG Heuer=C:\\tmp\\tag.xlsx',
    '--output-dir', 'C:\\tmp\\multi-output',
    '--max-rows', '100',
    '--batch-size', '25',
  ]);
  assert.equal(parsed.maxRows, 100);
  assert.equal(parsed.batchSize, 25);
  assert.throws(() => globalManifest.parseArgs([
    '--input', 'TAG Heuer=C:\\tmp\\tag.xlsx',
    '--output-dir', 'C:\\tmp\\multi-output',
    '--max-rows', '0',
  ]), /--max-rows must be a positive integer/);
});

test('publisher validates all rows before writing and reconciles exact ids in bounded batches', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-parent-publish-'));
  const tag = path.join(temp, 'tag.xlsx');
  const breguet = path.join(temp, 'breguet.xlsx');
  workbook(tag, 'TAG Heuer', 'tag-item', 'One source bundle');
  workbook(breguet, 'Breguet', 'breguet-item', 'One source bundle');
  const manifest = globalManifest.buildGlobalManifest([
    globalManifest.loadWorkbookEntries({ brand: 'TAG Heuer', input: tag }),
    globalManifest.loadWorkbookEntries({ brand: 'Breguet', input: breguet }),
  ], 'fixed-run');
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'reviewed_workbook_inventory');
      return {
        upsert(batch) {
          calls.push({ kind: 'upsert', count: batch.length });
          return { select: async () => ({ data: batch.map(row => ({ id: row.id })), error: null }) };
        },
        select() {
          return {
            in: async (_column, ids) => {
              calls.push({ kind: 'reconcile', count: ids.length });
              return { data: ids.map(id => ({ id })), error: null };
            },
          };
        },
      };
    },
  };
  const result = await globalManifest.publishRows(client, manifest.rows, 1);
  assert.deepEqual(result, { inserted: 1, reconciled: 1 });
  assert.deepEqual(calls, [{ kind: 'upsert', count: 1 }, { kind: 'reconcile', count: 1 }]);
  const unsafe = { ...manifest.rows[0], workbook_price_usd: 5000 };
  await assert.rejects(globalManifest.publishRows(client, [unsafe], 1), /WORKBOOK_PRICE_USD_MUST_BE_NULL/);
  assert.equal(calls.length, 2, 'unsafe rows must fail before any write');
});
