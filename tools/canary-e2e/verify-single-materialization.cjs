'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
const {createRpc,run}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {computeProposalHash,normalizeAuthoritativeRow}=require('../mariadb-live/authoritative-evidence-normalizer.cjs');
const {enforceListingDisplayContract}=require('../../shared/listing-display-contract.cjs');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 assert.equal(new URL(process.env.SUPABASE_URL).origin,'http://127.0.0.1:54321');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',production_contacted:false,synthetic_only:true};
 try{
  await db.connect();assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  const initialPublic=(await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n;assert.equal(initialPublic,50);
  const image=JSON.parse(fs.readFileSync(process.env.IMAGE_EVIDENCE_REPORT,'utf8'));assert.equal(image.status,'PASS');
  const fx=JSON.parse(fs.readFileSync(process.env.FX_EVIDENCE_FILE,'utf8')).proof;
  const raw=(await db.query('select to_jsonb(r) value from wf_canonical_staging.mariadb_raw_source_rows r where id=$1',[image.raw_row_id])).rows[0].value;
  assert.equal(raw.source_system,'PIPELINE_V2_SYNTHETIC');assert.equal(raw.raw_payload.synthetic_fixture,true);
  assert.equal((await db.query("select count(*)::int n from wf_canonical_staging.mariadb_raw_source_rows where source_system='PIPELINE_V2_SYNTHETIC'")).rows[0].n,1);
  const job='WF_MATERIALIZATION_SYNTHETIC_'+crypto.randomUUID();report.job_name=job;
  const manifest=crypto.createHash('sha256').update(job).digest('hex');
  await db.query(`insert into wf_canonical_staging.mariadb_raw_import_checkpoints
   (run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
   values($1,'2026-09-02T00:00:00.000Z','zzzz',1,1,'RAW_STAGED',$2,$3,now())`,
   [job,{created_on:'2026-09-02T00:00:00.000Z',source_id:'zzzz',count:1},manifest]);
  const rpc=createRpc(process.env);
  await rpc('create_frozen_normalization_job_v2',{p_job_name:job,p_capture_run_key:job,p_manifest_sha256:manifest,
   p_source_system:raw.source_system,p_source_database:raw.source_database,p_source_table:raw.source_table,p_expected_rows:1});
  assert.equal((await run({rpc,jobName:job,maxBatches:2})).complete,true);
  const p=(await db.query('select to_jsonb(p) value from wf_canonical_staging.mariadb_normalized_proposals p where source_system=$1 and source_id=$2 and source_hash=$3',
   [raw.source_system,raw.source_id,raw.source_hash])).rows[0].value;
  assert.equal(p.proposal_hash,computeProposalHash(p));assert.equal(p.proposal_hash,normalizeAuthoritativeRow(raw).proposal_hash);
  const members=[{raw_row_id:raw.id,proposal_hash:p.proposal_hash,image_evidence_hash:image.evidence_hash}];
  const args={p_job_name:job,p_members:members,p_fx_hash:fx.evidence_hash};
  const first=await rpc('materialize_single_batch_v2',args);assert.equal(first[0].outcome,'ELIGIBLE');assert.equal(first[0].inserted,1);
  const replay=await rpc('materialize_single_batch_v2',args);assert.equal(replay[0].materialization_hash,first[0].materialization_hash);assert.equal(replay[0].inserted,0);
  const stored=(await db.query('select * from wf_canonical_staging.materialized_single_versions_v2 where materialization_hash=$1',[first[0].materialization_hash])).rows[0];
  const doc=stored.document;assert.equal(doc.raw_message_text,raw.raw_payload.description);assert.equal(doc.description,raw.raw_payload.description);
  assert.equal(doc.source_id,raw.source_id);assert.equal(doc.source_hash,raw.source_hash);assert.equal(doc.seller_display_name,raw.raw_payload.from_name);
  assert.equal(doc.original_price_amount,78000);assert.equal(doc.original_price_currency,'HKD');
  assert.equal(doc.price_usd,Number((78000*fx.document.usd_per_unit.HKD).toFixed(2)));assert.equal(doc.fx_date,fx.document.observed_date);
  assert.equal(doc.price_research_eligible,true);assert.equal(doc.included_in_statistics,true);
  assert.equal(doc.image_key,raw.raw_payload.front_image);assert.equal(doc.image_status,'SOURCE_IMAGE_PRESENT');
  assert.equal(doc.contact_available,false);assert.equal(doc.seller_review_count,null);assert.equal(doc.seller_listing_count,null);
  assert.equal(doc.seller_profile_url,null);assert.match(doc.seller_id,/^[a-f0-9-]{36}$/);
  const card=enforceListingDisplayContract(doc);assert.equal(card.price_usd,doc.price_usd);assert.equal(card.raw_message_text,doc.raw_message_text);
  assert.ok(card.image_url.endsWith('/rc50/RC50-A01.png'));
  const noImage=await rpc('materialize_single_batch_v2',{...args,p_members:[{...members[0],image_evidence_hash:null}]});
  const unverified=(await db.query('select document from wf_canonical_staging.materialized_single_versions_v2 where materialization_hash=$1',[noImage[0].materialization_hash])).rows[0].document;
  assert.equal(unverified.image_url,null);assert.equal(enforceListingDisplayContract(unverified).image_url,null);
  assert.equal(enforceListingDisplayContract(unverified).image_key,raw.raw_payload.front_image);
  await assert.rejects(rpc('materialize_single_batch_v2',{...args,p_members:[{...members[0],proposal_hash:'f'.repeat(64)}]}),/NORMALIZATION_RPC_REJECTED/);
  await assert.rejects(rpc('materialize_single_batch_v2',{...args,p_members:[{...members[0],image_evidence_hash:'f'.repeat(64)}]}),/NORMALIZATION_RPC_REJECTED/);
  await db.query('begin');
  await db.query("update wf_canonical_staging.mariadb_normalized_proposals set proposal_document=jsonb_set(proposal_document,'{original_price_amount}','1') where id=$1",[p.id]);
  await assert.rejects(db.query('select public.materialize_single_batch_v2($1,$2,$3)',[job,JSON.stringify(members),fx.evidence_hash]),/materialization_proposal_content_mismatch/);
  await db.query('rollback');
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,initialPublic);
  for(const role of ['anon','authenticated']) assert.equal((await db.query("select has_function_privilege($1,'public.materialize_single_batch_v2(text,jsonb,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  report.status='PASS';report.materialization_hash=first[0].materialization_hash;report.raw_row_id=raw.id;
  report.checks=['Actual frozen worker persists a proposal independently recomputed from immutable raw content',
   'Supabase privately materializes untouched raw text, original poster, dated USD conversion and the exact verified source image',
   'Replay inserts nothing and preserves the same canonical hash; changed proposal and image proofs are rejected',
   'A retained but unverified image key remains private evidence and cannot recreate a public image URL',
   'Direct proposal-document tampering is rejected transactionally; ordinary roles denied; public 50 fixtures unchanged'];
 }catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('MATERIALIZATION_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
