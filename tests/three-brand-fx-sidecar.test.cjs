'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');
const { buildSidecarPage } = require('../tools/mariadb-live/build-three-brand-fx-sidecar.cjs');
require('../tools/mariadb-live/run-three-brand-fx-sidecar.cjs');
const sql = fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260812230000_qnsa_three_brand_fx_sidecar.sql'),'utf8');
const fx={contract:'wf-dated-fx-snapshot-v1',observed_at:'2026-08-11T00:00:00Z',source:'TEST ECB',source_url:'https://example.test',base:'USD',recognized_but_withheld:['AED','SAR','TWD','VND'],usd_per_unit:{USD:1,EUR:1.1,HKD:.128,GBP:1.28,CHF:1.14,CNY:.139,JPY:.0068,SGD:.75,KRW:.00073,THB:.028,CAD:.73,AUD:.65,NZD:.59,MYR:.23,IDR:.000061,INR:.012,PHP:.017,BRL:.18,MXN:.054,ZAR:.055,SEK:.095,NOK:.094,DKK:.147}};
function row(){const raw=sourceRecord({id:'90',type:'sale',title:'Rolex 116500LN 298,000 HKD',brand:'Rolex',reference:'116500LN'});return{listing_id:'00000000-0000-0000-0000-000000000090',source_record_id:raw.source_record_id,source_hash:raw.raw_sha256,canonical_brand:'Rolex',normalized_reference:'116500LN',raw_payload:raw};}
test('sidecar SQL never mutates listings or immutable raw evidence',()=>{
  assert.doesNotMatch(sql,/(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+staging\.listings/i);
  assert.doesNotMatch(sql,/(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+(?:public\.)?raw_message_versions/i);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS staging\.three_brand_fx_sidecar/);
  assert.match(sql,/status <> 'COMPLETE'/);
  assert.match(sql,/v_count <> v_run\.corrected_rows/);
  assert.match(sql,/start_three_brand_fx_sidecar/);
  assert.match(sql,/three_brand_fx_sidecar_page/);
  assert.match(sql,/apply_three_brand_fx_sidecar_batch/);
  assert.match(sql,/advance_three_brand_fx_sidecar/);
  assert.match(sql,/status text NOT NULL DEFAULT 'DISCOVERING'/);
  assert.match(sql,/discovery limit must be 1\.\.500/);
  assert.doesNotMatch(sql,/SELECT count\(\*\) INTO v_census FROM staging\.listings/);
});
test('one atomic release pointer feeds both customer contracts',()=>{
  assert.match(sql,/public\.three_brand_fx_release_control/);
  assert.match(sql,/qnsa_three_brand_trading_floor_fx_contract/);
  assert.match(sql,/qnsa_three_brand_price_research_fx_contract/);
  assert.match(sql,/upper\(COALESCE\(l\.listing_type,l\.intent,''\)\)='WTS'/);
  assert.match(sql,/effective_price_usd\s*>\s*0/);
  assert.match(sql,/qnsa_three_brand_fx_price_research_rows/);
  assert.match(sql,/qnsa_three_brand_fx_trading_floor_rows/);
});
test('builder emits compact exact-lineage sidecar records',()=>{
  const page=buildSidecarPage([row()],fx,{normalizationRunKey:'normalized-v1',correctionRunKey:'sidecar-v1'});
  assert.equal(page.corrected_rows,1); assert.equal(page.records[0].currency_original,'HKD');
  assert.equal(page.records[0].amount_usd,38144); assert.equal(page.records[0].evidence.raw_lineage_verified,true);
  assert.match(page.records[0].batch_token,/^[0-9a-f]{64}$/);
});
