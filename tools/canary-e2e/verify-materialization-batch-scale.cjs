'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {run:materialize}=require('../mariadb-live/run-frozen-materialization-v2.cjs');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const repo=path.resolve(__dirname,'../..'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const literal=s=>s==null?'NULL':"'"+String(s).replaceAll("'","''")+"'";
async function main(){
 const report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
 for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
  const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:30*1024*1024}).trim();
  const rpc=async(name,args)=>JSON.parse(sql('SELECT public.'+name+'('+Object.values(args).map(v=>literal(v&&typeof v==='object'?JSON.stringify(v):v)).join(',')+');'));
  sql(fs.readFileSync(path.join(repo,'supabase/migrations/20260909070000_bounded_materialization_throughput.sql'),'utf8'));
  const job='SYNTHETIC-BATCH-500-'+crypto.randomUUID(),workflow=job+'-M',ids=[];
  const before=sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;');
  let insert='INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source) VALUES ';
  insert+=Array.from({length:500},(_,i)=>{
   const id=crypto.randomUUID();ids.push(id);
   const description=i<100?'WTS Rolex 126610LN black dial new USD 12000':i<200?'WTB Rolex 126610LN':i<300?'Rolex 126610LN':i<400?'WTS Rolex 126610LN USD 12000\nWTS Rolex 116500LN USD 23000':'Unresolved synthetic evidence';
   const p={id:job+'-'+String(i).padStart(4,'0'),description,synthetic_fixture:true},text=stableJson(p),sha=hash(text);
   return '('+[id,job,'disposable','auctions',p.id,p.id,sha,sha,text,text,description,'description'].map(literal).join(',')+')';
  }).join(',')+';';sql(insert);
  sql("INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at) VALUES("+[job,'2026-09-07','zzzz',500,500,'RAW_STAGED',JSON.stringify({created_on:'2026-09-07',source_id:'zzzz',count:500}),hash(job)].map(literal).join(',')+',now());');
  await rpc('create_frozen_normalization_job_v2',{job,capture:job,manifest:hash(job),scope:job,database:'disposable',table:'auctions',count:500});
  const lease=crypto.randomUUID(),members=await rpc('claim_normalization_batch_v2',{job,lease,limit:500});assert.equal(members.length,500);
  const results=members.map(m=>{
   const i=Number(m.raw.source_id.slice(-4));
   return i>=450?{raw_row_id:m.raw_row_id,outcome:'QUARANTINE',error_code:'PROVENANCE_SYNTHETIC_REVIEW'}:i>=400?{raw_row_id:m.raw_row_id,outcome:'ERROR',error_code:'NORMALIZATION_FAILED'}:normalizeClaim(m);
  });
  await rpc('complete_normalization_batch_v2',{job,lease,results});
  await rpc('create_materialization_workflow_v2',{workflow,job,fx:null});
  const batch=await rpc('read_materialization_workflow_batch_v2',{workflow,limit:500});assert.equal(batch.members.length,500);
  for(const m of batch.members)assert.equal(m.raw!==null,m.outcome==='NORMALIZED');
  await assert.rejects(rpc('read_materialization_workflow_batch_v2',{workflow,limit:501}));
  const prepared=batch.members.map(m=>({raw_row_id:m.raw_row_id,proposal_hash:m.proposal_hash,image_evidence_hash:null,image_probe_outcome:'NOT_APPLICABLE'}));
  const bad=[...prepared];[bad[0],bad[1]]=[bad[1],bad[0]];
  await assert.rejects(rpc('commit_materialization_workflow_batch_v2',{workflow,cursor:null,request:crypto.randomUUID(),members:bad}));
  assert.equal((await rpc('get_materialization_workflow_v2',{workflow})).processed_rows,0);
  let probes=0;
  const final=await materialize({rpc,jobName:workflow,batchSize:500,captureImage:async()=>{probes++;return {outcome:'NO_SOURCE_IMAGE',proof:null};}});
  assert.deepEqual([final.expected_rows,final.processed_rows,final.eligible_rows,final.review_rows,final.bundle_rows,final.quarantine_rows,final.error_rows,final.complete],[500,500,200,100,100,50,50,true]);
  assert.equal(probes,200);
  await materialize({rpc,jobName:workflow,batchSize:500,captureImage:async()=>{throw new Error('Unexpected replay probe');}});
  const counts=JSON.parse(sql("SELECT jsonb_build_object('members',count(*),'unique_raws',count(distinct w.raw_row_id),'consistent',count(*) filter(where w.outcome=v.outcome AND w.raw_row_id=v.raw_row_id),'held_public_documents',count(*) filter(where w.outcome<>'ELIGIBLE' AND v.document is not null)) FROM wf_canonical_staging.materialization_workflow_members_v2 w JOIN wf_canonical_staging.materialized_single_versions_v2 v USING(materialization_hash) WHERE w.job_name="+literal(workflow)+';'));
  assert.deepEqual(counts,{members:500,unique_raws:500,consistent:500,held_public_documents:0});
  assert.equal(sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;'),before);
  for(const role of ['anon','authenticated'])assert.equal(sql("SELECT has_function_privilege("+literal(role)+",'public.read_materialization_workflow_batch_v2(text,integer)','EXECUTE');"),'f');
  report.databases.push({container,database,status:'PASS',reconciliation:counts,eligible:200,review:100,bundle:100,quarantine:50,error:50,checks:['500 mixed members complete atomically with exact counters','Reordered membership and limit 501 rejected','Held raw payloads stay database-local','Only eligible records trigger probes','Finished worker resumes without changes','Public listings unchanged; customer roles denied']});
 }
 report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error('MATERIALIZATION_BATCH_SCALE_FAILED',e.code||e.name,e.message?.slice(0,180));process.exitCode=1;});
