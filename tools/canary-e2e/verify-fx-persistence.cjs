'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Client}=require('./test-dependencies.cjs')('pg');
const {verifyFxEvidence}=require('../mariadb-live/verified-fx-evidence.cjs');
const {createRpc}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 assert.equal(new URL(process.env.SUPABASE_URL).origin,'http://127.0.0.1:54321');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',production_contacted:false,disposable_only:true};
 try{
  await db.connect();
  assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  const file=JSON.parse(fs.readFileSync(process.env.FX_EVIDENCE_FILE,'utf8'));
  const proof=await verifyFxEvidence(file.snapshot);assert.deepEqual(proof,file.proof);
  const rpc=createRpc(process.env);
  const args={p_document:proof.document,p_canonical_json:proof.canonical_json,p_evidence_hash:proof.evidence_hash};
  const first=await rpc('stage_verified_fx_evidence_v2',args);
  assert.equal(first.inserted+first.identical,1);
  const replay=await rpc('stage_verified_fx_evidence_v2',args);assert.equal(replay.inserted,0);assert.equal(replay.identical,1);
  const altered=structuredClone(args);altered.p_document.usd_per_unit.HKD=1;
  await assert.rejects(rpc('stage_verified_fx_evidence_v2',altered),/NORMALIZATION_RPC_REJECTED/);
  const stored=(await db.query('select document,canonical_json from wf_canonical_staging.verified_fx_evidence_v2 where evidence_hash=$1',[proof.evidence_hash])).rows[0];
  assert.deepEqual(stored.document,proof.document);assert.equal(stored.canonical_json,proof.canonical_json);
  const converted=(await db.query("select round(78000*(document#>>'{usd_per_unit,HKD}')::numeric,2)::text result from wf_canonical_staging.verified_fx_evidence_v2 where evidence_hash=$1",[proof.evidence_hash])).rows[0].result;
  assert.equal(Number(converted),Number((78000*proof.document.usd_per_unit.HKD).toFixed(2)));
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query("select has_function_privilege($1,'public.stage_verified_fx_evidence_v2(jsonb,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  report.status='PASS';report.evidence_hash=proof.evidence_hash;report.observed_date=proof.document.observed_date;
  report.checks=['Client recomputes all dated rates from retained ECB CSV','Actual Supabase persistence preserves exact document and bytes','Idempotent replay and altered-rate rejection','Independent PostgreSQL decimal conversion matches client calculation','Anonymous and authenticated ingestion denied'];
 }catch(error){report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('FX_PERSISTENCE_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
