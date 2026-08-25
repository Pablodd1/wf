'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { classifyRawPost } = require('../tools/audit/raw-first-rolex-patek-lib.cjs');
const { enrichParent, sha256 } = require('../tools/audit/raw-first-observation-v3-lib.cjs');
const { run } = require('../tools/audit/current-inventory-shadow.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'current-shadow-smoke-'));
const v2Root = path.join(root, 'v2');
const v3Root = path.join(root, 'v3');
const output = path.join(root, 'output');
fs.mkdirSync(path.join(v2Root, 'resume-pages'), { recursive: true });
fs.mkdirSync(path.join(v3Root, 'v3-pages'), { recursive: true });

const rolex = {
  raw_message_id: '01000000-0000-4000-8000-000000000001',
  id: '11000000-0000-4000-8000-000000000001',
  source_record_id: 'rolex-source', source_hash: 'a'.repeat(64),
  source_created_on: '2026-08-01T00:00:00Z', observed_at: '2026-08-01T00:00:00Z',
  raw_text: 'WTS Rolex 126334 blue dial USD 13,500',
  raw_data: { brand: 'Rolex', reference: '126334', type: 'sale', status: 'AVAILABLE',
    front_image: 'https://source.example/rolex.jpg' },
  media: [], source_platform: 'telegram', sender_phone: null, group_id: 'New York',
};
const patek = {
  raw_message_id: '02000000-0000-4000-8000-000000000002',
  id: '12000000-0000-4000-8000-000000000002',
  source_record_id: 'patek-source', source_hash: 'b'.repeat(64),
  source_created_on: '2026-08-02T00:00:00Z', observed_at: '2026-08-02T00:00:00Z',
  raw_text: 'Patek bundle', raw_data: { brand: 'Patek Philippe', type: 'sale', is_bundle: true },
  media: [], source_platform: 'telegram', sender_phone: null, group_id: 'Hong Kong',
};
const rolexRecord = {
  parent_key: sha256(rolex.raw_message_id), version_key: sha256(rolex.id), source_key: 'source-r',
  brand: 'Rolex', classification: 'SINGLE_WATCH', disposition: { published: false }, current_tf: 0,
  children: [{ qualified_pr: true, dealer_linked: false, image_linked: true, country_resolved: true }],
};
const patekRecord = {
  parent_key: sha256(patek.raw_message_id), version_key: sha256(patek.id), source_key: 'source-p',
  brand: 'Patek Philippe', classification: 'MULTI_WATCH_UNSPLITTABLE', disposition: {}, current_tf: 0,
  children: [],
};
const relative = 'resume-pages/raw-00-000001.json.gz';
const v2File = path.join(v2Root, relative);
fs.writeFileSync(v2File, zlib.gzipSync(JSON.stringify([rolexRecord, patekRecord])));
const checksum = file => sha256(fs.readFileSync(file).toString('base64'));
fs.writeFileSync(path.join(v2Root, 'checkpoint.json'), JSON.stringify({
  contract: 'watchfacts-raw-first-rolex-patek-audit-v2', status: 'COMPLETE', shard_count: 16,
  page_files: { [relative]: { relative, dataset: 'raw', shard: 0, page: 1,
    last_id: patek.raw_message_id, sha256: checksum(v2File) } },
}));

const classifiedPatek = classifyRawPost(patek);
const expectedPatek = {
  parent_key: patekRecord.parent_key,
  occurrences: enrichParent(classifiedPatek, patekRecord),
};
const v3Relative = 'v3-pages/raw-00-000001.json.gz';
const v3File = path.join(v3Root, v3Relative);
fs.writeFileSync(v3File, zlib.gzipSync(JSON.stringify([expectedPatek])));
fs.writeFileSync(path.join(v3Root, 'checkpoint.json'), JSON.stringify({
  contract: 'watchfacts-raw-first-observation-census-v3', status: 'COMPLETE',
  page_files: { [v3Relative]: { relative: v3Relative, source_page: relative, sha256: checksum(v3File) } },
}));

let calls = 0;
const fetchImpl = async (_url, request) => {
  calls += 1;
  const query = JSON.parse(request.body).query;
  const rows = query.includes('dealer_source_identities') ? [] : [rolex, patek];
  return { ok: true, status: 200, text: async () => JSON.stringify(rows), headers: { get: () => null } };
};

test('miniature V2 plus V3 census builds a reconciled fail-closed current shadow', async () => {
  try {
    const summary = await run({ env: { RAW_FIRST_V2_ARTIFACT: v2Root, RAW_FIRST_V3_ARTIFACT: v3Root,
      CURRENT_INVENTORY_OUTPUT: output, V2_ARTIFACT_RUN_ID: '1', V3_ARTIFACT_RUN_ID: '2' },
    token: 'test-token', fetchImpl });
    if (summary.error) throw new Error(summary.error);
    if (summary.brands.Rolex.current_active !== 1) throw new Error('explicit active Rolex missing');
    if (summary.brands['Patek Philippe'].invalid_fragments.UNSPLITTABLE_PARENT !== 1) throw new Error('unsplit Patek missing');
    if (summary.decision !== 'NOT_READY_CURRENT_INVENTORY_GAPS') throw new Error('expected fail-closed decision');
    if (!fs.existsSync(path.join(output, 'manifest-sha256.json'))) throw new Error('manifest missing');
    if (calls !== 2) throw new Error(`expected two bounded queries, received ${calls}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
