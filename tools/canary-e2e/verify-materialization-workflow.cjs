'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
const {createRpc,run:normalize}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {run:materialize}=require('../mariadb-live/run-frozen-materialization-v2.cjs');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:54321');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});const rpc=createRpc(process.env);
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',synthetic_only:true,production_contacted:false};
 try{
  await db.connect();assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  const existing=JSON.parse(fs.readFileSync(process.env.MATERIALIZATION_REPORT,'utf8'));assert.equal(existing.status,'PASS');
  const fx=JSON.parse(fs.readFileSync(process.env.FX_EVIDENCE_FILE,'utf8')).proof;
  const image=JSON.parse(fs.readFileSync(process.env.IMAGE_EVIDENCE_REPORT,'utf8'));assert.equal(image.status,'PASS');
  const job='WF_WORKFLOW_CONCURRENCY_'+crypto.randomUUID();report.concurrency_job=job;
  const config={p_job_name:job,p_normalization_job_name:existing.job_name,p_fx_hash:fx.evidence_hash};
  assert.equal((await rpc('create_materialization_workflow_v2',config)).expected_rows,1);
  assert.equal((await rpc('create_materialization_workflow_v2',config)).processed_rows,0);
  await assert.rejects(rpc('create_materialization_workflow_v2',{...config,p_fx_hash:null}),/NORMALIZATION_RPC_REJECTED/);
  const next=await rpc('read_materialization_workflow_batch_v2',{p_job_name:job,p_limit:1});assert.equal(next.members.length,1);
  const m=next.members[0];
  const members=[{raw_row_id:m.raw_row_id,proposal_hash:m.proposal_hash,image_evidence_hash:image.evidence_hash,image_probe_outcome:'VERIFIED_SOURCE_IMAGE'}];
  const args={p_job_name:job,p_expected_cursor:null,p_request_id:crypto.randomUUID(),p_members:members};
  await assert.rejects(rpc('commit_materialization_workflow_batch_v2',{...args,p_members:[{...members[0],image_evidence_hash:null}]}),/NORMALIZATION_RPC_REJECTED/);
  assert.equal((await rpc('get_materialization_workflow_v2',{p_job_name:job})).processed_rows,0);
  await assert.rejects(rpc('commit_materialization_workflow_batch_v2',{...args,p_members:[{...members[0],proposal_hash:'f'.repeat(64)}]}),/NORMALIZATION_RPC_REJECTED/);
  const requests=[args,{...args,p_request_id:crypto.randomUUID()}];
  const competing=await Promise.allSettled(requests.map(a=>rpc('commit_materialization_workflow_batch_v2',a)));
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
  const winner=competing.findIndex(r=>r.status==='fulfilled');
  assert.equal(competing[winner].value.job.processed_rows,1);assert.equal(competing[winner].value.job.complete,true);
  assert.equal((await rpc('commit_materialization_workflow_batch_v2',requests[winner])).replayed,true);
  await assert.rejects(rpc('commit_materialization_workflow_batch_v2',{...requests[winner],p_members:[{...members[0],image_probe_outcome:'NO_SOURCE_IMAGE'}]}),/NORMALIZATION_RPC_REJECTED/);
  assert.equal((await rpc('read_materialization_workflow_batch_v2',{p_job_name:job,p_limit:1})).members.length,0);
  // A separate, exact two-row synthetic boundary proves restart between batches.
  const parent='WF_WORKFLOW_BOUNDARY_'+crypto.randomUUID();const namespace='WF_WORKFLOW_SYNTHETIC_'+crypto.randomUUID();
  const payloads=[{id:crypto.randomUUID(),description:'  WTS Rolex 126610LN black dial new USD 10000\n',from_name:'Synthetic workflow seller',created_on:'2026-09-01T00:00:00.000Z',front_image:'rc50/RC50-A01.png',synthetic_fixture:true},
   {id:crypto.randomUUID(),description:'WTB Rolex 126610LN black dial new USD 9000',from_name:'Synthetic workflow buyer',synthetic_fixture:true}];
  const rawIds=[];
  for(const p of payloads){
   const canonical=stableJson(p);
   const r=await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows
    (source_system,source_database,source_table,source_id,source_record_id,source_created_on,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash,test_run_id)
    values($1,'disposable','auctions',$2,$2,$3,$4,'description',$5,$6,$7,$5,'MATERIALIZATION_WORKFLOW_SYNTHETIC') returning id`,
    [namespace,p.id,p.created_on||null,p.description,hash(canonical),canonical,p]);rawIds.push(r.rows[0].id);
  }
  const manifest=hash(parent);
  await db.query(`insert into wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
   values($1,'2026-09-02','zzzz',2,2,'RAW_STAGED',$2,$3,now())`,[parent,{created_on:'2026-09-02',source_id:'zzzz',count:2},manifest]);
  await rpc('create_frozen_normalization_job_v2',{p_job_name:parent,p_capture_run_key:parent,p_manifest_sha256:manifest,p_source_system:namespace,p_source_database:'disposable',p_source_table:'auctions',p_expected_rows:2});
  assert.equal((await normalize({rpc,jobName:parent,maxBatches:2})).complete,true);
  const workerJob='WF_WORKFLOW_RESTART_'+crypto.randomUUID();report.worker_job=workerJob;report.normalization_job=parent;
  await rpc('create_materialization_workflow_v2',{p_job_name:workerJob,p_normalization_job_name:parent,p_fx_hash:fx.evidence_hash});
  const options={rpc,jobName:workerJob,batchSize:1,disposableBase:process.env.DISPOSABLE_IMAGE_BASE_URL};
  const paused=await materialize({...options,maxBatches:1});assert.equal(paused.processed_rows,1);assert.equal(paused.complete,false);
  const finished=await materialize({...options,maxBatches:3});assert.equal(finished.processed_rows,2);assert.equal(finished.eligible_rows,2);assert.equal(finished.complete,true);
  let probes=0;const again=await materialize({...options,captureImage:async()=>{probes++;throw new Error('Unexpected probe');}});assert.equal(again.processed_rows,2);assert.equal(probes,0);
  const stored=(await db.query(`select w.raw_row_id,w.image_probe_outcome,v.document from wf_canonical_staging.materialization_workflow_members_v2 w join wf_canonical_staging.materialized_single_versions_v2 v using(materialization_hash) where w.job_name=$1`,[workerJob])).rows;
  assert.equal(stored.length,2);assert.deepEqual(stored.map(r=>r.raw_row_id).sort(),rawIds.sort());
  for(const r of stored){const p=payloads.find(p=>p.id===r.document.source_id);assert.ok(p);assert.equal(r.document.raw_message_text,p.description);assert.equal(r.document.seller_display_name,p.from_name);
   if(p.front_image){assert.equal(r.image_probe_outcome,'VERIFIED_SOURCE_IMAGE');assert.equal(r.document.image_status,'SOURCE_IMAGE_PRESENT');}
   else{assert.equal(r.image_probe_outcome,'NO_SOURCE_IMAGE');assert.equal(r.document.source_created_at,null);assert.equal(r.document.intent,'WTB');assert.equal(r.document.price_research_eligible,false);}
  }
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.read_materialization_workflow_batch_v2(text,integer)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  report.status='PASS';report.retained_synthetic_raw_rows=2;report.checks=['Changed config, skipped image probe and changed proposal refuse checkpoint advancement',
   'Competing completions advance once; identical request replay is a no-op and changed replay is rejected',
   'Actual worker pauses after one row, resumes from the durable checkpoint, and performs no work after completion',
   'Real source-image probe persists; untouched messages, original posters, null source date and separate WTB eligibility are preserved',
   'All two frozen inputs have durable materialization links; no publication occurs; customer roles cannot read workflow evidence'];
 }catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('MATERIALIZATION_WORKFLOW_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
