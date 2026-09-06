'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {createRpc,run:normalize}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {run:materialize}=require('../mariadb-live/run-frozen-materialization-v2.cjs');
const {CANONICAL_CONTRACT_KEYS}=require('../../shared/listing-display-contract.cjs');

async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 assert.equal(new URL(process.env.SUPABASE_URL).origin,'http://127.0.0.1:54321');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const previous=process.env.DISPOSABLE_500_RESUME_REPORT ? JSON.parse(fs.readFileSync(process.env.DISPOSABLE_500_RESUME_REPORT,'utf8')) : null;
 if(previous){assert.equal(previous.synthetic_only,true);assert.equal(previous.production_contacted,false);assert.equal(previous.restored_public_count,50);assert.match(previous.normalization_job,/^WF_BATCH450_SYNTHETIC_[a-f0-9-]{36}$/);}
 const rpc=createRpc(process.env),job=previous?.normalization_job||'WF_BATCH450_SYNTHETIC_'+crypto.randomUUID(),batch=job+'_PUBLICATION_'+crypto.randomUUID().slice(0,8);
 const report={contract:'wf-publication-canary-audit-v2',status:'RUNNING',recorded_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,normalization_job:job,publication_batch:batch};
 const revision=async()=>Number((await db.query('select revision from wf_canonical_staging.publication_revision where singleton')).rows[0].revision);
 let committed=false,before;
 await db.connect();
 try{
  assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  before=JSON.stringify((await db.query('select to_jsonb(v) row from wf_canonical_staging.mariadb_canary_published_listings_v2 v order by listing_id')).rows);
  assert.equal(JSON.parse(before).length,50);
  const manifest=crypto.createHash('sha256').update(job).digest('hex');
  if(!previous){
  await db.query('begin');
  for(let i=0;i<450;i++){
   const sourceId=crypto.randomUUID();
   const payload={id:sourceId,description:`  WTS Rolex 126610LN black dial new 2024 USD ${12500+i}\n`,
    from_name:`Synthetic batch poster ${i}`,brand:'Rolex',reference:'126610LN',model:'Submariner',category:'WATCH',
    created_on:'2026-09-01T00:00:00.000Z',synthetic_fixture:true};
   const text=stableJson(payload),hash=crypto.createHash('sha256').update(text).digest('hex');
   await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows
    (source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash,test_run_id)
    values($1,'disposable','auctions',$2,$2,$3,'2026-09-02',$4,'description',$5,$6,$7,$5,'BATCH450_SYNTHETIC')`,
    [job,sourceId,payload.created_on,payload.description,hash,text,payload]);
  }
  await db.query(`insert into wf_canonical_staging.mariadb_raw_import_checkpoints
   (run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
   values($1,'2026-09-03','zzzz',450,450,'RAW_STAGED',$2,$3,now())`,[job,{created_on:'2026-09-03',source_id:'zzzz',count:450},manifest]);
  await db.query('commit');
  }
  assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.mariadb_raw_source_rows where source_system=$1',[job])).rows[0].n,450);
  console.log('Retained 450 private synthetic source rows; normalizing frozen membership.');
  await rpc('create_frozen_normalization_job_v2',{p_job_name:job,p_capture_run_key:job,p_manifest_sha256:manifest,p_source_system:job,p_source_database:'disposable',p_source_table:'auctions',p_expected_rows:450});
  report.normalization=await normalize({rpc,jobName:job,batchSize:100,maxBatches:8});
  assert.equal(report.normalization.complete,true);assert.equal(report.normalization.normalized_rows,450);
  await rpc('create_materialization_workflow_v2',{p_job_name:job,p_normalization_job_name:job,p_fx_hash:null});
  report.materialization=await materialize({rpc,jobName:job,batchSize:25,maxBatches:20,onProgress:state=>{
   if(state.processed_rows%100===0)console.log(`Materialized ${state.processed_rows}/450 synthetic rows.`);
  }});
  assert.equal(report.materialization.complete,true);assert.equal(report.materialization.eligible_rows,450);
  const hashes=(await db.query('select materialization_hash from wf_canonical_staging.materialization_workflow_members_v2 where job_name=$1 order by raw_row_id',[job])).rows.map(r=>r.materialization_hash);
  assert.equal(hashes.length,450);
  report.publication=(await db.query('select public.publish_materialized_batch_v2($1,$2,$3,true) result',[batch,await revision(),hashes])).rows[0].result;
  committed=true;
  assert.equal(report.publication.inserted,450);assert.equal(report.publication.after_count,500);
  const oracle=(await db.query('select * from public.trading_floor_ready_view_v2 order by priced_rank,image_rank,price_usd desc nulls last,source_created_at desc nulls last,listing_id')).rows;
  assert.equal(oracle.length,500);
  const expected=new Map(oracle.map(row=>[row.listing_id,row]));
  const handler=require('../../api/canary/trading-floor');
  let cursor=null;const ids=[];let pages=0;
  do{
   let status=200,body;
   const res={setHeader(){},status(code){status=code;return this;},json(value){body=value;return this;}};
   await handler({method:'GET',query:{pageSize:'100',...(cursor?{cursor}:{})}},res);
   assert.equal(status,200);assert.equal(body.total,500);pages++;
   for(const row of body.records){
    for(const key of CANONICAL_CONTRACT_KEYS)assert.notEqual(row[key],undefined,`Required contract field ${key}`);
    const source=expected.get(row.listing_id);assert.ok(source);
    assert.equal(row.source_hash,source.source_hash);
    assert.equal(row.raw_message,source.raw_message_text);
    assert.equal(row.seller_name,source.seller_display_name);
    assert.equal(row.price_usd,source.price_usd===null?null:Number(source.price_usd));
    ids.push(row.listing_id);
   }
   cursor=body.nextCursor;
   assert.ok(pages<=6);
  }while(cursor);
  assert.equal(pages,6,'Five full pages and the terminal empty keyset read');assert.equal(ids.length,500);assert.equal(new Set(ids).size,500);
  assert.deepEqual(ids,oracle.map(row=>row.listing_id));
  report.canary_published_count=500;report.api_pages=pages;report.canonical_fields_checked=CANONICAL_CONTRACT_KEYS.length;
  report.v2_consumer_views_summary={trading_floor_ready_view_v2:500};
  for(const view of ['price_research_ready_view_v2','seller_listing_analytics_view_v2']) {
   report.v2_consumer_views_summary[view]=Number((await db.query(`select count(*) from public.${view}`)).rows[0].count);
   assert.ok(report.v2_consumer_views_summary[view]>0);
  }
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.publish_materialized_batch_v2(text,bigint,text[],boolean)','EXECUTE') ok",[role])).rows[0].ok,false);
  report.status='PASS';
 }catch(error){report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0],site:error.stack?.split('\n').find(line=>line.includes('verify-500-publication.cjs:'))?.trim()};process.exitCode=1;}
 finally{
  await db.query('rollback');
  if(committed){
   try{
    report.rollback=(await db.query('select public.rollback_materialized_batch_v2($1,$2) result',[batch,await revision()])).rows[0].result;
    const after=JSON.stringify((await db.query('select to_jsonb(v) row from wf_canonical_staging.mariadb_canary_published_listings_v2 v order by listing_id')).rows);
    assert.equal(after,before);report.restored_public_count=50;
   }catch(error){report.status='FAIL';report.rollback_error=error.code||error.name;process.exitCode=1;}
  }
  await db.end();
  fs.mkdirSync(path.dirname(process.env.DISPOSABLE_REPORT_PATH),{recursive:true});
  fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }
}
main().catch(error=>{console.error('BATCH450_DISPOSABLE_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
