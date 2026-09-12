'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',synthetic_only:true,production_contacted:false};
 const key='WF_COHORT_SYNTHETIC_'+crypto.randomUUID();let committed=false;
 const revision=async()=>Number((await db.query('select revision from wf_canonical_staging.publication_revision where singleton')).rows[0].revision);
 const count=async()=>Number((await db.query('select count(*) from public.trading_floor_ready_view_v2')).rows[0].count);
 const roots=async()=>Number((await db.query('select count(*) from wf_canonical_staging.keyset_snapshot_registry where data_snapshot_id is null')).rows[0].count);
 const stage=async(name,hash)=>(await db.query('select public.stage_publication_cohort_batch_v2($1,$2,$3,true) result',[name,await revision(),[hash]])).rows[0].result;
 try{
  await db.connect();assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  assert.equal(await count(),50);
  const before=JSON.stringify((await db.query('select to_jsonb(c) value from wf_canonical_staging.mariadb_canary_published_listings_v2 c order by listing_id')).rows);
  const material=JSON.parse(fs.readFileSync(process.env.MATERIALIZATION_REPORT,'utf8'));assert.equal(material.status,'PASS');
  const held=(await db.query(`select m.job_name,m.raw_row_id,m.proposal_hash from wf_canonical_staging.normalization_job_members_v2 m
   join wf_canonical_staging.mariadb_raw_source_rows r on r.id=m.raw_row_id
   where m.outcome='ERROR' and m.proposal_hash is null and r.test_run_id='NORMALIZATION_V2_SYNTHETIC' order by m.job_name limit 1`)).rows[0];
  assert.ok(held);
  const heldVersion=(await db.query('select public.materialize_single_batch_v2($1,$2,null) result',[held.job_name,JSON.stringify([{raw_row_id:held.raw_row_id,proposal_hash:null}])])).rows[0].result[0];
  assert.equal(heldVersion.outcome,'ERROR');
  const initialRoots=await roots();
  for(const [suffix,hash] of [['_MISSING_FINALIZE',material.materialization_hash],['_HELD_MISSING_FINALIZE',heldVersion.materialization_hash]]){
   await db.query('begin');await stage(key+suffix,hash);
   await assert.rejects(db.query('commit'),/publication_cohort_not_finalized/);
   assert.equal(await count(),50);assert.equal(await roots(),initialRoots);
   assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.publication_batches_v2 where batch_key=$1',[key+suffix])).rows[0].n,0);
  }
  await db.query('begin');
  const first=await stage(key+'_A',material.materialization_hash);
  const second=await stage(key+'_B',heldVersion.materialization_hash);
  assert.equal(first.inserted,1);assert.equal(second.held,1);assert.equal(second.before_count,51);assert.equal(second.after_count,51);
  assert.equal(first.trading_snapshot,null);assert.equal(first.price_snapshot,null);assert.equal(await roots(),initialRoots);
  await db.query('savepoint incomplete');
  await assert.rejects(db.query('select public.finalize_publication_cohort_v2($1,$2)',[key,[key+'_A']]),/publication_cohort_membership_mismatch/);
  await db.query('rollback to savepoint incomplete');
  const result=(await db.query('select public.finalize_publication_cohort_v2($1,$2) result',[key,[key+'_A',key+'_B']])).rows[0].result;
  assert.equal(result.batches,2);assert.equal(result.input,2);assert.equal(result.inserted,1);assert.equal(result.held,1);
  assert.equal(result.before_count,50);assert.equal(result.after_count,51);assert.equal(await roots(),initialRoots+2);
  assert.equal((await db.query('select public.finalize_publication_cohort_v2($1,$2) result',[key,[key+'_B',key+'_A']])).rows[0].result.replayed,true);
  await db.query('savepoint changed_after_finalization');
  await db.query(`update wf_canonical_staging.mariadb_canary_published_listings_v2 set seller_display_name='Changed after finalization'
   where listing_id=(select document->>'listing_id' from wf_canonical_staging.materialized_single_versions_v2 where materialization_hash=$1)`,[material.materialization_hash]);
  await assert.rejects(db.query('set constraints wf_canonical_staging.guard_publication_snapshot_commit_v2 immediate'),/publication_snapshots_not_prepared/);
  await db.query('rollback to savepoint changed_after_finalization');
  await db.query('commit');committed=true;
  assert.equal(await count(),51);
  await db.query('select public.rollback_materialized_batch_v2($1,$2)',[key+'_A',await revision()]);
  assert.equal((await db.query('select state from wf_canonical_staging.publication_cohorts_v2 where cohort_key=$1',[key])).rows[0].state,'PARTIALLY_ROLLED_BACK');
  await db.query('select public.rollback_materialized_batch_v2($1,$2)',[key+'_B',await revision()]);
  committed=false;
  assert.equal((await db.query('select state from wf_canonical_staging.publication_cohorts_v2 where cohort_key=$1',[key])).rows[0].state,'ROLLED_BACK');
  assert.equal(await count(),50);
  assert.equal(JSON.stringify((await db.query('select to_jsonb(c) value from wf_canonical_staging.mariadb_canary_published_listings_v2 c order by listing_id')).rows),before);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.stage_publication_cohort_batch_v2(text,bigint,text[],boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  report.status='PASS';report.cohort_key=key;report.result=result;
  report.checks=['Commit without finalization rolls back eligible and held-only staged batches completely',
   'Multiple bounded batches create no intermediate snapshot copies; one finalization creates exactly two roots',
   'Missing batch membership is refused and exact final counts include the held error outcome',
   'A write after snapshot finalization is rejected by the deferred commit guard',
   'Finalization replay is idempotent; partial and complete rollback state tracks actual batches and restores the original 50 rows'];
 }catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0],actual_error:error.actual?.message?.split('\n')[0]};process.exitCode=1;}
 finally{
  if(committed)for(const suffix of ['_A','_B'])try{await db.query('select public.rollback_materialized_batch_v2($1,$2)',[key+suffix,await revision()]);}catch(error){report.cleanup_error=error.code||error.name;}
  await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}
main().catch(error=>{console.error('COHORT_TEST_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
