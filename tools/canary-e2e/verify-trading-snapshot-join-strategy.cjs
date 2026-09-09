'use strict';
// Small synthetic fixtures in unique local schema-only clones. No production client.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{Client}=require('./test-dependencies.cjs')('pg');
const root=path.resolve(__dirname,'../..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const names=['20260910160000_expanded_source_candidate_evidence.sql','20260910170000_expanded_publication_versions.sql','20260910180000_expanded_publication_batches.sql','20260910190000_expanded_watch_source_views.sql','20260910200000_reviewed_dealer_profile_expansion.sql','20260910210000_trading_floor_source_images_order.sql','20260910230000_existing_source_enrichment.sql','20260910250000_trading_snapshot_join_strategy.sql'];
const sources=names.map(file=>({file,source:fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n')}));
const report={status:'RUNNING',production_contacted:false,synthetic_only:true,script_sha256:sha(fs.readFileSync(__filename)),migrations:Object.fromEntries(sources.map(s=>[s.file,sha(s.source)])),databases:[]};
const output=process.env.WF_SNAPSHOT_JOIN_TEST_REPORT;assert.ok(output,'Explicit local report path is required');
if(fs.existsSync(output))fs.copyFileSync(output,output+'.before-'+Date.now());
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const unwrap=s=>s.replace(/^BEGIN;\s*/m,'').replace(/^COMMIT;\s*$/m,'');
async function main(){
 for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']){
  const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];assert.equal(info.State.Running,true);
  const host=info.NetworkSettings.Networks['wf-final-disposable'].IPAddress;assert.match(host,/^172\.18\.0\.\d+$/);
  const database='wf_snapshot_join_250_'+Date.now();assert.match(database,/^wf_snapshot_join_250_\d+$/);
  execFileSync('docker',['exec',container,'createdb','-U','postgres','-T','wf_expanded_template3_20260908',database]);
  const env=Object.fromEntries(info.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
  const db=new Client({host,port:5432,user:'postgres',password:env.POSTGRES_PASSWORD,database,application_name:'wf_local_snapshot_join_250'});await db.connect();
  const detail={container,database,status:'RUNNING'};report.databases.push(detail);
  const val=async(q,a)=>(await db.query(q,a)).rows[0].result;
  const definition=()=>val("select jsonb_build_object('body',prosrc,'config',proconfig,'acl',proacl::text,'security_definer',prosecdef,'volatility',provolatile) result from pg_proc where oid='wf_canonical_staging.materialize_trading_floor_snapshot(integer)'::regprocedure");
  try{
   const original=await definition();await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s';SET LOCAL work_mem='7MB';SET LOCAL enable_nestloop=on");
   await db.query('insert into wf_canonical_staging.publication_revision(singleton,revision) values(true,725)');
   for(const s of sources.slice(0,-1))await db.query(unwrap(s.source));
   const priceBefore=await val("select pg_get_functiondef('wf_canonical_staging.materialize_price_research_snapshot(integer)'::regprocedure) result");
   await db.query(`insert into wf_canonical_staging.mariadb_canary_published_listings_v2
    (listing_id,source_id,source_hash,raw_message_id,observed_at,category,brand,model,reference,intent,intent_status,price_status,price_research_eligible,included_in_statistics,image_evidence_type,image_status,review_status,price_usd,original_price_amount,original_price_currency,fx_rate,fx_source,fx_date,source_created_at,image_key,image_url,thumbnail_url,raw_message_text,source_context_text,location_region)
    select 'SYNTHETIC-JOIN-'||lpad(n::text,4,'0'),'SYNTHETIC-SOURCE-'||n,repeat('a',64),'00000000-0000-0000-0000-'||lpad(n::text,12,'0'),
     '2026-09-01T00:00:00Z'::timestamptz,'WATCH','Synthetic maker',case when n%3=0 then NULL else 'Exact model' end,'REF-'||n,
     case when n%2=0 then 'WTS' else 'WTB' end,'VERIFIED',case when n%2=0 then 'VERIFIED_USD' else 'UNPRICED' end,n%2=0,n%2=0,
     'SYNTHETIC_SOURCE',case when n%4=0 then 'NO_IMAGE' else 'SOURCE_IMAGE_PRESENT' end,'APPROVED',
     case when n%2=0 then 7000+n end,case when n%2=0 then 7000+n end,case when n%2=0 then 'USD' end,case when n%2=0 then 1 end,
     case when n%2=0 then 'ORIGINAL_USD' end,case when n%2=0 then '2026-09-01' end,
     case when n%5=0 then NULL else '2026-09-01T01:02:03.123456Z'::timestamptz end,
     case when n%4<>0 then 'synthetic/'||n end,case when n%4<>0 then 'https://example.invalid/original/'||n end,
     case when n%4<>0 then 'https://example.invalid/original/'||n end,'[SYNTHETIC FIXTURE] exact source '||n,NULL,'Asia'
    from generate_series(1,128)n`);
   await db.query(`insert into public.dealers(id,display_name,status,review_count,rating,metadata) values
    ('10000000-0000-0000-0000-000000000001','Synthetic dealer A','VERIFIED',11,4.5,'{"reviewed_profile_evidence_v3":{"review_count":11}}'),
    ('10000000-0000-0000-0000-000000000002','Synthetic dealer B','VERIFIED',0,NULL,'{}')`);
   await db.query(`insert into public.dealer_source_identities(id,dealer_id,source_system,source_identity,identity_type,verification_status) values
    (1,'10000000-0000-0000-0000-000000000001','SYNTHETIC','12025550123','PHONE','VERIFIED'),
    (2,'10000000-0000-0000-0000-000000000002','SYNTHETIC','12025550124','PHONE','VERIFIED')`);
   await db.query(`insert into public.seller_listing_lineage_staging(id,source_system,source_record_id,seller_listing_id,source_identity,match_status,matched_dealer_id,match_evidence)
    select n,'WF_V2_SOURCE_BOUND','SYNTHETIC-JOIN-'||lpad(n::text,4,'0'),'SYNTHETIC-SOURCE-'||n,
     case when n%2=0 then '12025550123' else '12025550124' end,'APPLIED',
     case when n%2=0 then '10000000-0000-0000-0000-000000000001'::uuid else '10000000-0000-0000-0000-000000000002'::uuid end,
     jsonb_build_object('contract','V2_SOURCE_BOUND','source_hash',repeat('a',64),'identity_id',case when n%2=0 then 1 else 2 end)
    from generate_series(1,96)n`);
   assert.equal(await val('select count(*)::int result from wf_canonical_staging.v2_approved_listing_dealers'),96);
   const before=await definition(),snapshot=()=>val('select wf_canonical_staging.materialize_trading_floor_snapshot(3600) result');
   const data=id=>db.query('select listing_id,priced_rank,image_rank,price_usd,source_created_at,payload from wf_canonical_staging.keyset_snapshot_members where snapshot_id=$1 order by listing_id collate "C"',[id]);
   const beforeSnapshot=await snapshot(),beforeRows=(await data(beforeSnapshot)).rows;assert.equal(beforeRows.length,128);
   assert.equal(await val("select current_setting('enable_nestloop') result"),'on');
   await db.query(unwrap(sources.at(-1).source));const after=await definition();
   assert.deepEqual({...after,config:before.config},before,'Function body/security/ACL must not change');
   assert.deepEqual(after.config,[...before.config.filter(s=>!s.startsWith('enable_nestloop=')),'enable_nestloop=off']);
   assert.equal(await val("select pg_get_functiondef('wf_canonical_staging.materialize_price_research_snapshot(integer)'::regprocedure) result"),priceBefore);
   const afterSnapshot=await snapshot(),afterRows=(await data(afterSnapshot)).rows;assert.deepEqual(afterRows,beforeRows);
   assert.equal(await val("select current_setting('enable_nestloop') result"),'on','Successful call restores caller ON');
   await db.query('SAVEPOINT invalid_ttl');let error;try{await val('select wf_canonical_staging.materialize_trading_floor_snapshot(1) result');}catch(e){error=e;}assert.equal(error?.code,'22023');await db.query('ROLLBACK TO invalid_ttl');
   assert.equal(await val("select current_setting('enable_nestloop') result"),'on','Error path restores caller ON');
   await db.query('SET LOCAL enable_nestloop=off');assert.deepEqual((await data(await snapshot())).rows,beforeRows);assert.equal(await val("select current_setting('enable_nestloop') result"),'off');
   await db.query('ROLLBACK');assert.deepEqual(await definition(),original);assert.equal(await val('select count(*)::int result from wf_canonical_staging.mariadb_canary_published_listings_v2'),0);
   Object.assign(detail,{status:'PASS',published_fixture_rows:128,approved_dealer_links:96,exact_frozen_payload_and_order_keys_parity:true,caller_on_restored_after_success:true,caller_on_restored_after_error:true,caller_off_preserved:true,body_acl_security_unchanged:true,price_materializer_unchanged:true,exact_transaction_rollback:true,payload_sha256:sha(JSON.stringify(beforeRows))});save();
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,output,sha256:sha(fs.readFileSync(output)),databases:report.databases.map(d=>({container:d.container,status:d.status}))}));
}
main().catch(e=>{report.status='FAIL';report.error={code:e.code||e.name,message:e.message,stack:e.stack};save();console.error(JSON.stringify(report.error));process.exitCode=1;});
