'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
const {createRpc}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {run}=require('../mariadb-live/run-frozen-materialization-v2.cjs');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:54321');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});const rpc=createRpc(process.env);
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',synthetic_only:true,production_contacted:false};
 try{
  await db.connect();assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  const parent=JSON.parse(fs.readFileSync(process.env.NORMALIZATION_REPORT,'utf8'));assert.equal(parent.status,'PASS');assert.equal(parent.retained_private_synthetic_rows,9);
  const fx=JSON.parse(fs.readFileSync(process.env.FX_EVIDENCE_FILE,'utf8')).proof;
  const job='WF_ALL_MATERIALIZATION_OUTCOMES_'+crypto.randomUUID();report.job_name=job;
  await rpc('create_materialization_workflow_v2',{p_job_name:job,p_normalization_job_name:parent.job_name,p_fx_hash:fx.evidence_hash});
  const result=await run({rpc,jobName:job,batchSize:2,maxBatches:8});
  assert.deepEqual([result.expected_rows,result.processed_rows,result.eligible_rows,result.review_rows,result.bundle_rows,result.quarantine_rows,result.error_rows,result.complete],[9,9,4,2,1,1,1,true]);
  const outcomes=(await db.query('select outcome,count(*)::int n from wf_canonical_staging.materialization_workflow_members_v2 where job_name=$1 group by outcome order by outcome',[job])).rows;
  assert.deepEqual(outcomes,[{outcome:'BUNDLE_HELD',n:1},{outcome:'ELIGIBLE',n:4},{outcome:'ERROR',n:1},{outcome:'QUARANTINE',n:1},{outcome:'REVIEW',n:2}]);
  const reconciliation=(await db.query(`select count(*)::int retained,
   count(*) filter(where w.outcome=v.outcome and w.raw_row_id=v.raw_row_id and n.source_hash=v.source_hash)::int consistent,
   count(*) filter(where w.outcome<>'ELIGIBLE' and v.document is not null)::int held_documents
   from wf_canonical_staging.materialization_workflow_members_v2 w
   join wf_canonical_staging.materialized_single_versions_v2 v using(materialization_hash)
   join wf_canonical_staging.normalization_job_members_v2 n on n.job_name=$2 and n.raw_row_id=w.raw_row_id where w.job_name=$1`,[job,parent.job_name])).rows[0];
  assert.deepEqual(reconciliation,{retained:9,consistent:9,held_documents:0});
  assert.equal((await run({rpc,jobName:job})).processed_rows,9);
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  report.status='PASS';report.outcomes=outcomes;report.reconciliation=reconciliation;report.checks=['Every frozen input has one durable raw/hash/proposal/materialization outcome link',
   'Four eligible, two review, one bundle hold, one quarantine and one error reconcile exactly to nine inputs',
   'Held/error outcomes produce no public document, completed worker replay is a no-op, and public fixtures remain 50'];
 }catch(error){report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('MATERIALIZATION_OUTCOMES_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
