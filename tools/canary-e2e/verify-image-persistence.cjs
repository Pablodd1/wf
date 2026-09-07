'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {captureSourceImageEvidence}=require('../mariadb-live/source-image-evidence-v2.cjs');
const {constructCandidateImageUrl}=require('../../shared/listing-display-contract.cjs');
const {createRpc}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 assert.equal(new URL(process.env.SUPABASE_URL).origin,'http://127.0.0.1:54321');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',production_contacted:false,synthetic_only:true};
 try{
  await db.connect();
  assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  const publicBefore=(await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n;
  assert.equal(publicBefore,50);
  const id=crypto.randomUUID();
  const payload={id,description:'  WTS Rolex 126610LN black dial new 2024 HKD 78000\n',from_name:'Synthetic pipeline poster',
   front_image:'rc50/RC50-A01.png',created_on:'2026-09-01T00:00:00.000Z',synthetic_fixture:true};
  const raw=(await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows
   (source_system,source_database,source_table,source_id,source_record_id,source_created_on,raw_message,raw_message_source,
    raw_sha256,raw_payload_text,raw_payload,source_hash,test_run_id)
   values('PIPELINE_V2_SYNTHETIC','disposable','auctions',$1,$1,$2,$3,'description',$4,$5,$6,$4,'PIPELINE_V2_SYNTHETIC') returning to_jsonb(mariadb_raw_source_rows) value`,
   [id,payload.created_on,payload.description,hash(stableJson(payload)),stableJson(payload),payload])).rows[0].value;
  const captured=await captureSourceImageEvidence(raw,{disposableBase:process.env.DISPOSABLE_IMAGE_BASE_URL});
  assert.equal(captured.outcome,'VERIFIED_SOURCE_IMAGE');
  const proof=captured.proof;
  const rpc=createRpc(process.env);
  const args={p_document:proof.document,p_canonical_json:proof.canonical_json,p_evidence_hash:proof.evidence_hash};
  const first=await rpc('stage_source_image_evidence_v2',args);assert.equal(first.inserted,1);assert.equal(first.verified,true);
  const replay=await rpc('stage_source_image_evidence_v2',args);assert.equal(replay.identical,1);assert.equal(replay.inserted,0);
  for(const alteration of [{image_key:'other.png'},{verified_url:'https://example.test/photo.png'},{source_hash:'a'.repeat(64)}]){
   const changed={...proof.document,...alteration};const canonical=stableJson(changed);
   await assert.rejects(rpc('stage_source_image_evidence_v2',{p_document:changed,p_canonical_json:canonical,p_evidence_hash:hash(canonical)}),/NORMALIZATION_RPC_REJECTED/);
  }
  const stored=(await db.query('select document,canonical_json,verified from wf_canonical_staging.source_image_evidence_v2 where evidence_hash=$1',[proof.evidence_hash])).rows[0];
  assert.deepEqual(stored.document,proof.document);assert.equal(stored.canonical_json,proof.canonical_json);assert.equal(stored.verified,true);
  for(const key of ['listings/full/a space.png','full/café.png','listings/watch(1).png','/rc50/watch.png','path/$a+&b.png','../escape','file.png?x=1']){
   assert.equal((await db.query('select wf_canonical_staging.source_image_candidate_v2($1) url',[key])).rows[0].url,constructCandidateImageUrl(key));
  }
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query("select has_function_privilege($1,'public.stage_source_image_evidence_v2(jsonb,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,publicBefore);
  report.status='PASS';report.raw_row_id=raw.id;report.source_id=raw.source_id;report.evidence_hash=proof.evidence_hash;
  report.checks=['Real HTTPS HEAD and bounded GET verify a source-bound synthetic image','Actual Supabase receipt preserves exact bytes and replays without insertion',
   'Rehashed wrong image keys, origins and source hashes are rejected','SQL and JavaScript path encoding agree including Unicode and traversal refusals',
   'Anonymous/authenticated ingestion denied; existing 50 public fixtures unchanged'];
 }catch(error){report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('IMAGE_PERSISTENCE_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
