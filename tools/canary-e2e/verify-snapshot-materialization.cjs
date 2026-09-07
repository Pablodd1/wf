'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {stableJson:canonicalize}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const repo=path.resolve(__dirname,'../..');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const literal=s=>s==null?'NULL':"'"+String(s).replaceAll("'","''")+"'";
const report={started_at:new Date().toISOString(),synthetic_only:true,production_mutations:0,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:10*1024*1024}).trim();
 const rpc=(name,args)=>JSON.parse(sql('SELECT public.'+name+'('+args.map(literal).join(',')+');'));
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20260909040000_snapshot_bound_materialization.sql'),'utf8'));
 const scope='SYNTHETIC-VERSION-'+crypto.randomUUID(),job=scope,raws=[];
 for(const revision of [1,2]){
  const payload={id:'SYNTHETIC-001',description:'SYNTHETIC WTS Rolex 126610LN USD 12000',synthetic_fixture:true,revision};
  const text=canonicalize(payload),hash=sha(text),id=crypto.randomUUID();
  const values=[id,scope,'disposable','auctions',payload.id,payload.id,hash,hash,text,JSON.stringify(payload),payload.description,'description'];
  sql('INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source) VALUES('+values.map(literal).join(',')+');');
  raws.push({id,text,hash});
 }
 const selected=raws[1];
 const manifest={contract:'WF_IMMUTABLE_SOURCE_SNAPSHOT_V2',status:'COMPLETE',isolation:'REPEATABLE READ / CONSISTENT SNAPSHOT / READ ONLY',source_system:scope,source_database:'disposable',source_table:'auctions',rows:1,expected_rows:1,minimum_id:'SYNTHETIC-001',maximum_id:'SYNTHETIC-001',chunks:[{rows:1,first_id:'SYNTHETIC-001',last_id:'SYNTHETIC-001',canonical_sha256:sha(selected.text+'\n')}]};
 const canonical=canonicalize(manifest),digest=sha(canonical);
 rpc('register_immutable_source_snapshot',[canonical,digest]);rpc('bind_immutable_source_snapshot_chunk',[digest,0,'{'+selected.id+'}']);rpc('create_immutable_snapshot_normalization_job',[digest,job]);
 const lease=crypto.randomUUID(),members=rpc('claim_normalization_batch_v2',[job,lease,500]);assert.equal(members.length,1);assert.equal(members[0].raw_row_id,selected.id);
 const results=members.map(normalizeClaim);assert.equal(results[0].proposal.trading_floor_eligible,true);
 rpc('complete_normalization_batch_v2',[job,lease,JSON.stringify(results)]);
 const proposalHash=results[0].proposal.proposal_hash,call="SELECT wf_canonical_staging.materialize_single_member_v2("+[job,selected.id,proposalHash,null,null].map(literal).join(',')+");";
 const first=JSON.parse(sql(call));assert.equal(first.outcome,'ELIGIBLE');assert.equal(JSON.parse(sql(call)).materialization_hash,first.materialization_hash);
 const doc=JSON.parse(sql('SELECT document FROM wf_canonical_staging.materialized_single_versions_v2 WHERE materialization_hash='+literal(first.materialization_hash)+';'));
 assert.equal(doc.source_hash,selected.hash);assert.equal(doc.raw_message_text,'SYNTHETIC WTS Rolex 126610LN USD 12000');assert.equal(doc.price_usd,12000);
 // Owner-only tampering is rolled back: unsealed and wrong-scope jobs cannot use the exception.
 sql("INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,status,input_rows,newly_staged_rows,manifest_sha256,last_created_on,last_source_id) VALUES("+[job,'RAW_STAGED',1,1,digest,'2026-09-07T00:00:00Z','SYNTHETIC-001'].map(literal).join(',')+");");
 for(const update of ["UPDATE wf_canonical_staging.immutable_source_snapshots SET sealed=false WHERE manifest_sha256="+literal(digest),"UPDATE wf_canonical_staging.normalization_jobs_v2 SET source_database='wrong' WHERE job_name="+literal(job),"UPDATE wf_canonical_staging.normalization_jobs_v2 SET immutable_snapshot_sha256=NULL,capture_run_key="+literal(job)+" WHERE job_name="+literal(job)]){
  const result=sql('BEGIN;'+update+';'+call+'ROLLBACK;').split('\n').find(x=>x.startsWith('{'));assert.equal(JSON.parse(result).outcome,'QUARANTINE');
 }
 assert.equal(sql('SELECT count(*) FROM wf_canonical_staging.mariadb_raw_source_rows WHERE source_system='+literal(scope)+';'),'2');
 assert.equal(sql("SELECT has_function_privilege('service_role','wf_canonical_staging.materialize_single_member_v2(text,uuid,text,text,text)','execute');"),'f');
 report.databases.push({container,database,status:'PASS',checks:['sealed exact selected version materializes despite retained historical version','exact content and USD amount preserved','replay stable','unsealed snapshot rejected','wrong source scope rejected','legacy conflict remains quarantined','both raw versions retained','direct service-role execution denied']});
}
report.status='PASS';report.finished_at=new Date().toISOString();
fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
