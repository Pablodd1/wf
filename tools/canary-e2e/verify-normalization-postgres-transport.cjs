'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {createNormalizationPostgresRpc}=require('../mariadb-live/normalization-postgres-rpc.cjs');
const {run}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const lit=s=>s===null?'NULL':"'"+String(s).replaceAll("'","''")+"'",sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function main(){const report={status:'RUNNING',synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
 const job='SYNTHETIC-SQL-TRANSPORT-'+crypto.randomUUID();
 const records=['WTS Rolex 126610LN USD 12500','WTB Rolex 126610LN','Rolex no price or reference'].map(description=>{const id=crypto.randomUUID(),text=stableJson({id,description,synthetic_fixture:true});return {id,text,description,hash:sha(text)};});
 sql(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
 SELECT id::uuid,${lit(job)},'disposable','auctions',id,id,'2026-09-01','2026-09-02',description,'description',hash,text,text::jsonb,hash FROM jsonb_to_recordset(${lit(JSON.stringify(records))}::jsonb) x(id text,text text,hash text,description text);
 INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
 VALUES(${lit(job)},'2026-09-03','zzzz',3,3,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":3}',${lit(sha(job))},now());
 SELECT public.create_frozen_normalization_job_v2(${lit(job)},${lit(job)},${lit(sha(job))},${lit(job)},'disposable','auctions',3);`);
 // Docker psql runs only against named disposable containers. The production
 // adapter uses pg's native parameter binding, never this fixture substitution.
 const db={query:async(query,values)=>({rows:[{result:JSON.parse(sql(query.replace(/\$(\d+)/g,(_,n)=>lit(values[Number(n)-1]))+';'))}]})};
 const rpc=createNormalizationPostgresRpc(db);
 await assert.rejects(rpc('DROP_TABLE',{}),/NOT_ALLOWED/);
 const final=await run({rpc,jobName:job,batchSize:2});assert.equal(final.processed_rows,3);assert.equal(final.complete,true);assert.equal(final.normalized_rows,2);assert.equal(final.review_rows,1);
 assert.equal((await run({rpc,jobName:job,batchSize:2})).processed_rows,3);
 const failures=createNormalizationPostgresRpc({query:async()=>{throw Object.assign(new Error('normalization_lease_membership_mismatch'),{code:'22023'});}});
 await assert.rejects(failures('get_normalization_job_v2',{p_job_name:job}),e=>e.reason==='normalization_lease_membership_mismatch'&&e.postgresCode==='22023');
 report.databases.push({container,database,status:'PASS',processed_rows:3,source_bound_normalized:2,durable_review:1,completed_job_replay_unchanged:true});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
main().catch(e=>{console.error(e);process.exitCode=1;});
