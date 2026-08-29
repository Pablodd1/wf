'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MAGIC, decryptAsset, encryptAsset } = require('../tools/intake/decrypt-unbundled-release-asset.cjs');
const { OVERLAP_HELD_BRANDS, RELEASE_FILES } = require('../tools/intake/unbundled-release-package.cjs');
const { MIGRATION, migrationBody } = require('../tools/intake/prepare-qnsa-unbundled-release.cjs');
const { selectGlobalCanaryRows } = require('../tools/intake/run-unbundled-release.cjs');

test('encrypted package uses authenticated AES-256-GCM', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-unbundled-crypto-'));
  const input = path.join(directory, 'package.enc');
  const output = path.join(directory, 'package.zip');
  const key = crypto.randomBytes(32);
  const plaintext = Buffer.from('authenticated workbook archive');
  const source = path.join(directory, 'package.input.zip');
  fs.writeFileSync(source, plaintext);
  encryptAsset({ input: source, output: input, keyBase64: key.toString('base64') });
  decryptAsset({ input, output, keyBase64: key.toString('base64') });
  assert.deepEqual(fs.readFileSync(output), plaintext);
  const tampered = fs.readFileSync(input);
  tampered[tampered.length - 1] ^= 1;
  fs.writeFileSync(input, tampered);
  assert.throws(() => decryptAsset({ input, output, keyBase64: key.toString('base64') }));
});

test('release package allowlist is exact and overlap brands remain held', () => {
  assert.equal(RELEASE_FILES.length, 20);
  assert.equal(new Set(RELEASE_FILES.map(([name]) => name)).size, 20);
  assert.deepEqual([...OVERLAP_HELD_BRANDS].sort(), ['Audemars Piguet', 'Cartier']);
  assert.ok(RELEASE_FILES.every(([name, brand]) => name.endsWith('.xlsx') && brand));
});

test('lineage migration is forward-only and workflow is bounded', () => {
  const root = path.join(__dirname, '..');
  const migration = migrationBody(root);
  assert.equal(MIGRATION, 'supabase/migrations/20260817030000_reviewed_workbook_unbundled_lineage.sql');
  for (const column of ['source_platform', 'source_group_id', 'source_message_id', 'parent_source_message_id']) {
    assert.match(migration, new RegExp(column));
  }
  assert.doesNotMatch(migration, /\b(?:INSERT\s+INTO|UPDATE\s+[^;]+\s+SET|DELETE\s+FROM|TRUNCATE|COPY)\b/i);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-unbundled-workbook-release.yml'), 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /UNBUNDLED_IMPORT_AES_KEY_B64/);
  assert.match(workflow, /HAS_DOWNLOAD_TOKEN: \$\{\{ secrets\.UNBUNDLED_RELEASE_DOWNLOAD_TOKEN != '' \}\}/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.UNBUNDLED_RELEASE_DOWNLOAD_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /^      UNBUNDLED_RELEASE_DOWNLOAD_TOKEN:/m);
  assert.match(workflow, /asset_id:/);
  assert.match(workflow, /ASSET_ID: \$\{\{ inputs\.asset_id \}\}/);
  assert.match(workflow, /invalid asset ID/);
  assert.match(workflow, /releases\/assets\/\$ASSET_ID/);
  assert.doesNotMatch(workflow, /gh release download/);
  assert.match(workflow, /asset_sha256/);
  assert.match(workflow, /options: \[audit, canary, full\]/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /QNSA_ENV_FILE: \$\{\{ runner\.temp \}\}\/qnsa-service\.env/);
  assert.match(workflow, /source "\$RUNNER_TEMP\/qnsa-service\.env"/);
  assert.match(workflow, /LINK_EVIDENCE_HMAC_KEY/);
  assert.doesNotMatch(workflow, /^      SUPABASE_ACCESS_TOKEN:/m);
  assert.doesNotMatch(workflow, /^      UNBUNDLED_IMPORT_AES_KEY_B64:/m);
  assert.doesNotMatch(workflow, /Downloads|UNBUNDLED_MASTER_FILES/);
  const builder = fs.readFileSync(path.join(root, 'tools/intake/prepare-unbundled-release-asset.cjs'), 'utf8');
  assert.match(builder, /validateReleasePackage/);
  assert.match(builder, /fs\.rmSync\(stage, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(builder, /(?:stdout|stderr)\.write\([^;\n]*keyBase64/i);
  const runner = fs.readFileSync(path.join(root, 'tools/intake/run-unbundled-release.cjs'), 'utf8');
  assert.match(runner, /REPLACE_APPROVED_ADMISSION_EXISTING = 'true'/);
  assert.match(runner, /'--replace-existing-exact', 'true'/);
});

test('legacy audit reconciliation is read-only and explicitly leaves lineage unverified', () => {
  const importer = require('../tools/intake/import-approved-admission-workbook.cjs');
  const expected = [{
    id: 'admission_x', content_hash: 'a', source_payload_sha256: 'b', source_record_id: 'c',
    source_platform: 'WhatsApp', source_group_id: 'private', source_message_id: 'm1',
    parent_source_message_id: 'p1', listing_type: 'WTS', brand_scope: 'Breguet', model: null,
    normalized_reference: '1234', dial_color: null, workbook_price_usd: null,
    source_price_amount: null, source_price_text: null, source_currency: null,
    price_evidence_status: 'UNPRICED_TRADING_FLOOR_ONLY', verification_status: 'APPROVED',
    verification_tier: 'OWNER_UNBUNDLED_ADMISSION_LEDGER',
  }];
  const actual = [{ ...expected[0] }];
  delete actual[0].source_platform;
  delete actual[0].source_group_id;
  delete actual[0].source_message_id;
  delete actual[0].parent_source_message_id;
  Object.assign(actual[0], {
    user_image_url: null, catalog_image_url: null, final_image_url: null,
    display_image_url: null, image_evidence_type: null, phone_number: null,
    contact_publication_approved: false,
  });
  const result = importer.compareImportedRows(expected, actual, { lineageReady: false });
  assert.equal(result.exact, 1);
  assert.equal(result.lineage_verified, false);
  assert.equal(result.ok, false);
});

test('public market mapping detects private parent lineage without selecting group identity', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'api/reviewed-market-inventory.js'), 'utf8');
  assert.match(api, /evidenceValuePresent\(row\.parent_source_message_id\)/);
  const admissionColumns = api.slice(api.indexOf("const admissionColumns = ["), api.indexOf("].join(',');", api.indexOf("const admissionColumns = [")));
  assert.match(admissionColumns, /parent_source_message_id/);
  assert.doesNotMatch(admissionColumns, /source_group_id/);
});

test('global canary is deterministic and covers intent plus sparse identity states', () => {
  const row = (id, overrides = {}) => ({
    id,
    listing_type: 'WTS',
    normalized_reference: `REF${id}`,
    model: 'Model',
    dial_color: 'Black',
    price_evidence_status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
    ...overrides,
  });
  const plans = [{
    file: { brand: 'A. Lange & Söhne', overlapHeld: false },
    plan: { rows: [
      row('1', { listing_type: 'WTB', normalized_reference: null, model: null, dial_color: null }),
      row('2'), row('3'), row('4', { normalized_reference: null }),
      row('5'), row('6', { model: null }), row('7'), row('8', { dial_color: null }),
      row('9'), row('10'), row('11'),
    ] },
  }, {
    file: { brand: 'Cartier', overlapHeld: true },
    plan: { rows: [row('held')] },
  }];
  const first = selectGlobalCanaryRows(plans);
  const second = selectGlobalCanaryRows(plans);
  assert.deepEqual(first, second);
  assert.equal(first.selected.length, 10);
  assert.ok(first.selected.every(item => !Object.hasOwn(item, 'canary_brand')));
  assert.equal(first.selected.some(item => item.id === 'held'), false);
  assert.deepEqual(first.coverage, [
    'WTB', 'WTS', 'EXACT_REFERENCE', 'NULL_REFERENCE',
    'VERIFIED_MODEL', 'NULL_MODEL', 'VERIFIED_DIAL', 'NULL_DIAL',
  ]);
});
