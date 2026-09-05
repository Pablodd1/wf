'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tools/intake/rolex_patek_delta_release.py'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-rolex-patek-reviewed-delta.yml'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260817120000_qnsa_rolex_patek_delta_lineage.sql'), 'utf8');
const overlapRepair = fs.readFileSync(path.join(root, 'supabase/migrations/20260817123000_qnsa_rolex_patek_delta_overlap_index_repair.sql'), 'utf8');
const canaryRollback = fs.readFileSync(path.join(root, '.github/workflows/qnsa-rolex-patek-canary-rollback.yml'), 'utf8');

test('delta importer is fail-closed and preserves owner USD evidence labels', () => {
  assert.match(source, /QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1/);
  assert.match(source, /APPROVED_SINGLE_CANDIDATE/);
  assert.match(source, /APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY/);
  assert.match(source, /cf859a8b-d17f-42a7-9d6e-5eb2b81d76e2/);
  assert.match(source, /rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972/);
  assert.match(source, /EXPECTED_TRADING_FLOOR_COHORT = 813/);
  assert.match(source, /EXPECTED_REVIEWED_SINGLES = 812/);
  assert.match(source, /EXPECTED_PRICE_RESEARCH_MAX = 614/);
  assert.match(source, /OWNER_DOLLAR_USD_POLICY/);
  assert.match(source, /OWNER_K_USD_POLICY/);
  assert.match(source, /EXACT_LISTING_IMAGE/);
  assert.match(source, /SOURCE_MESSAGE_NOT_SINGLE/);
  assert.match(source, /reviewed_source_message_present/);
  assert.match(source, /reviewed_payload_present/);
  assert.match(source, /CANARY_QNSA_ROLEX_PATEK_DELTA_CONFIRMATION/);
  assert.match(source, /len\(selected\) > 10/);
  assert.match(source, /rollback_qnsa_rolex_patek_delta/);
  assert.match(source, /reviewed_workbook_delta_release_runs/);
  assert.match(source, /qnsa_rolex_patek_delta_overlap/);
  assert.match(source, /--rollback-output/);
});

test('known two-offer source becomes one Trading-Floor-only parent', () => {
  const code = String.raw`
import importlib.util, pathlib, json
p=pathlib.Path(r'${path.join(root, 'tools/intake/rolex_patek_delta_release.py').replace(/\\/g, '\\\\')}')
s=importlib.util.spec_from_file_location('rp',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r={'id':m.MULTI_OFFER_DELTA_ID,'listing_id':m.MULTI_OFFER_SOURCE_LISTING_ID,'raw_message':'Rolex 134300 Blue $11,100 USD\\nRolex 134300 Blue $10,600 USD','model':'Oyster Perpetual','reference':'134300','dial':'Blue','condition':'Pre-Owned','price_usd':11100.0,'source_currency':'USD','source_price_amount':'11100','price_status':'SOURCE_EXPLICIT_USD_MATCH','source_image_url':'https://example.test/parent.jpg','image_status':'EXACT_SOURCE_MESSAGE_IMAGE','listing_type':'WTS'}
m.classify_structured_multi_offer_parent([r])
r.update({'source_payload_sha256':'b'*64,'source_record_id':'rec','source_message_id':'msg','brand':'Rolex','posting_date':'2026-08-17 12:00:00','source_row_number':2,'source_platform':'WhatsApp','source_group_id':'private','lineage_status':'RAW_LINEAGE_VERIFIED'})
pkg={'path':pathlib.Path('Rolex_Codex_Reconciliation_Master_2026-08-17.xlsx'),'sha256':'c'*64}
row=m.inventory_row(r,pkg,'rpdelta_canary_test')
canary=m.select_canary([r,dict(r,id='rpdelta_'+'d'*64,listing_id='other',record_kind='SINGLE')])
print(json.dumps({'source':r,'row':row,'canary_ids':[x['id'] for x in canary]}))`;
  const result = spawnSync('python', ['-c', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.source.offer_count, 2);
  assert.equal(data.row.verification_status, 'APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY');
  assert.equal(data.row.listing_type, 'MULTI');
  assert.equal(data.row.workbook_price_usd, null);
  assert.equal(data.row.source_price_text, null);
  assert.equal(data.row.normalized_reference, null);
  assert.equal(data.row.final_image_url, null);
  assert.equal(data.row.image_evidence_type, null);
  assert.match(data.row.raw_message, /11,100 USD[\s\S]*10,600 USD/);
  assert.ok(data.row.review_reasons.includes('MULTI_PARENT_TRADING_FLOOR_ONLY'));
  assert.ok(data.canary_ids.includes('rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972'));
});

test('schema-valid payload keeps contact private and exact image evidence', () => {
  const code = String.raw`
import importlib.util, pathlib, json
p=pathlib.Path(r'${path.join(root, 'tools/intake/rolex_patek_delta_release.py').replace(/\\/g, '\\\\')}')
s=importlib.util.spec_from_file_location('rp',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r={'id':'rpdelta_'+'a'*64,'source_payload_sha256':'b'*64,'source_record_id':'rec','source_message_id':'msg','brand':'Rolex','reference':'126500LN','listing_type':'WTS','posting_date':'2026-08-17 12:00:00','raw_message':'Rolex Daytona 126500LN white new $30K','model':'Daytona','dial':'White','condition':'New','price_usd':30000.0,'source_currency':'USD','source_price_amount':'30000','price_status':'OWNER_K_USD_POLICY','source_image_url':'https://example.test/exact.jpg','image_status':'EXACT_SOURCE_MESSAGE_IMAGE','source_row_number':2,'source_platform':'WhatsApp','source_group_id':'private','lineage_status':'RAW_LINEAGE_VERIFIED'}
pkg={'path':pathlib.Path('Rolex_Codex_Reconciliation_Master_2026-08-17.xlsx'),'sha256':'c'*64}
print(json.dumps(m.inventory_row(r,pkg,'rpdelta_canary_test')))`;
  const result = spawnSync('python', ['-c', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(result.stdout);
  assert.equal(row.id.length, 72);
  assert.equal(row.verification_tier, 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1');
  assert.equal(row.verification_status, 'APPROVED_SINGLE_CANDIDATE');
  assert.equal(row.confidence, 100);
  assert.equal(row.price_evidence_status, 'OWNER_K_USD_POLICY');
  assert.equal(row.workbook_price_usd, 30000);
  assert.equal(row.image_evidence_type, 'SELLER_LISTING_IMAGE');
  assert.equal(row.phone_number, null);
  assert.equal(row.contact_publication_approved, false);
  const imageCode = String.raw`
import importlib.util, pathlib
p=pathlib.Path(r'${path.join(root, 'tools/intake/rolex_patek_delta_release.py').replace(/\\/g, '\\\\')}')
s=importlib.util.spec_from_file_location('rp',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(m.canonical_source_image_url('https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/6a60f28aa37c6_front_image.jpg'))`;
  const imageResult = spawnSync('python', ['-c', imageCode], { cwd: root, encoding: 'utf8' });
  assert.equal(imageResult.status, 0, imageResult.stderr);
  assert.equal(imageResult.stdout.trim(), 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/6a60f28aa37c6_front_image.jpg');
});

test('workflow authenticates package and enforces audit before bounded DML', () => {
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /options: \[audit, canary, full\]/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /UNBUNDLED_IMPORT_AES_KEY_B64/);
  assert.match(workflow, /releases\/assets\/\$asset_id/);
  assert.match(workflow, /Accept: application\/octet-stream/);
  assert.doesNotMatch(workflow, /gh release download/);
  assert.match(workflow, /--mode audit[\s\S]*--mode "\$RELEASE_MODE"/);
  assert.match(workflow, /--rollback-output "\$RUNNER_TEMP\/private\/rollback\.json"/);
  assert.match(workflow, /--run-key "rpdelta_\$\{RELEASE_MODE\}_\$\{GITHUB_RUN_ID\}_\$\{GITHUB_RUN_ATTEMPT\}"/);
  assert.doesNotMatch(workflow, /Downloads|Watch_remaining/);
  assert.match(migration, /source_message_id text/);
  assert.match(migration, /REVOKE ALL[\s\S]*PUBLIC, anon, authenticated/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.reviewed_workbook_delta_release_runs/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*rollback_qnsa_rolex_patek_delta|rollback_qnsa_rolex_patek_delta[\s\S]*SECURITY DEFINER/);
  assert.match(migration, /FROM staging\.listings l/);
  assert.match(migration, /FROM raw\.payloads p/);
  assert.match(migration, /p\.source_platform::text = w\.source_platform/);
  assert.match(migration, /p\.source_group_id::text = w\.source_group_id/);
  assert.match(migration, /p\.source_message_id::text = w\.source_message_id/);
  assert.match(migration, /p\.payload_checksum::text = w\.payload_checksum/);
  assert.doesNotMatch(migration, /JOIN jobs\.processing_jobs/);
  assert.match(migration, /v_status NOT IN \('RUNNING', 'APPLIED'\)/);
  assert.match(migration, /v_status = 'ROLLED_BACK'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.rollback_qnsa_rolex_patek_delta[\s\S]*PUBLIC, anon, authenticated/);
  const pipelineMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260806090000_permanent_ingestion_pipeline.sql'), 'utf8');
  assert.match(pipelineMigration, /idx_raw_payloads_checksum ON raw\.payloads\(payload_checksum\)/);
  assert.match(pipelineMigration, /idx_raw_payloads_message_lookup ON raw\.payloads\(source_platform, source_group_id, source_message_id\)/);
  const preparer = require('../tools/intake/prepare-qnsa-rolex-patek-delta.cjs');
  assert.doesNotThrow(() => preparer.migrationSql(root));
  assert.equal(preparer.MIGRATIONS.at(-1), 'supabase/migrations/20260817123000_qnsa_rolex_patek_delta_overlap_index_repair.sql');
  assert.match(overlapRepair, /l\.id = ANY\(\$1::uuid\[\]\)/);
  assert.doesNotMatch(overlapRepair, /l\.id::text\s*=|p\.(?:source_platform|source_group_id|source_message_id|payload_checksum)::text\s*=/);
  assert.match(overlapRepair, /p\.payload_checksum = w\.payload_checksum/);
  assert.match(overlapRepair, /p\.source_platform = w\.source_platform/);
  assert.match(canaryRollback, /qnsafosakvonzgfcsphh/);
  assert.match(canaryRollback, /CANARY_RUN_ID.*inputs\.canary_run_id/);
  assert.match(canaryRollback, /\^\\d\{8,20\}\$/);
  assert.match(canaryRollback, /rpdelta_canary_\$\(\$env:CANARY_RUN_ID\)_1/);
  assert.match(canaryRollback, /jsonb_array_elements_text\(inserted_ids\)/);
  assert.match(canaryRollback, /release_tier = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'/);
  assert.match(canaryRollback, /status = 'APPLIED'/);
  assert.match(canaryRollback, /cardinality\(v_ids\), 0\) <> 10/);
  assert.match(canaryRollback, /v_deleted <> 10/);
  assert.doesNotMatch(canaryRollback, /\$\{\{ inputs\.confirmation \}\}[^\n]*run:/);
  assert.match(overlapRepair, /p\.source_group_id IS NOT DISTINCT FROM w\.source_group_id/);
  assert.match(overlapRepair, /p\.source_message_id = w\.source_message_id/);
  assert.match(overlapRepair, /source_platform varchar\(50\)/);
  const builder = fs.readFileSync(path.join(root, 'tools/intake/prepare-rolex-patek-delta-asset.cjs'), 'utf8');
  assert.match(builder, /Rolex_Codex_Reconciliation_Master_2026-08-17\.xlsx/);
  assert.match(builder, /Patek_Philippe_Codex_Reconciliation_Master_2026-08-17\.xlsx/);
  assert.match(builder, /encryptAsset/);
  assert.match(builder, /fs\.rmSync\(stage, \{ recursive: true, force: true \}\)/);
});

test('schema workflow is QNSA-only, confirmation-gated, and contains no inventory import', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'qnsa-rolex-patek-delta-schema.yml'), 'utf8');
  assert.match(workflow, /APPLY_QNSA_ROLEX_PATEK_DELTA_SCHEMA/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /RELEASE_MODE: schema/);
  assert.match(workflow, /prepare-qnsa-rolex-patek-delta\.cjs/);
  assert.doesNotMatch(workflow, /rolex_patek_delta_release\.py|reviewed_workbook_inventory/);
});
