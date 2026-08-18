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

test('delta importer is fail-closed and preserves owner USD evidence labels', () => {
  assert.match(source, /QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1/);
  assert.match(source, /APPROVED_SINGLE_CANDIDATE/);
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
