'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Patek runner accepts only the Patek candidate contract', () => {
  const code = `
    process.env.COMPLETION_BRAND='Patek Philippe';
    const {mergeManifest}=require('./tools/mariadb-live/run-rolex-null-only-source-completion.cjs');
    const base={project_ref:'qnsafosakvonzgfcsphh',prices:[{listing_id:'1'}],images:[]};
    if(mergeManifest({...base,contract:'watchfacts-patek-null-only-candidates-v1'}).length!==1)process.exit(2);
    try{mergeManifest({...base,contract:'watchfacts-rolex-null-only-candidates-v1'});process.exit(3);}catch{}
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['-e', code], { cwd: root }));
});

test('Patek database contract is brand-bound and null-only', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260823103500_qnsa_patek_null_only_source_completion.sql'), 'utf8');
  assert.match(sql, /brand_normalized IS DISTINCT FROM 'Patek Philippe'/);
  assert.match(sql, /l\.brand_normalized='Patek Philippe'/);
  assert.match(sql, /COALESCE\(l\.price_usd,l\.price_normalized,0\)>0/);
  assert.match(sql, /currency_evidence'\)='usd_defaulted_by_policy'/);
  assert.match(sql, /raw_message_versions/);
  assert.doesNotMatch(sql, /\bDELETE\b/i);
});

test('Patek workflow pins the census artifact and exact checksum', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/qnsa-patek-null-only-source-completion.yml'), 'utf8');
  assert.match(workflow, /qnsa-patek-missing-field-recoverability-/);
  assert.match(workflow, /MANIFEST_SHA256/);
  assert.match(workflow, /COMPLETION_BRAND: Patek Philippe/);
  assert.match(workflow, /non_patek_proposals/);
});
