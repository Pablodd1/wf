'use strict';
// Synthetic projection boundary: no source extraction or production connection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{Client}=require('./test-dependencies.cjs')('pg');
const repo=path.resolve(__dirname,'../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=['20260910160000_expanded_source_candidate_evidence.sql','20260910170000_expanded_publication_versions.sql','20260910180000_expanded_publication_batches.sql','20260910190000_expanded_watch_source_views.sql','20260910200000_reviewed_dealer_profile_expansion.sql','20260910260000_reviewed_offer_representatives.sql'];
const sources=files.map(file=>({file,source:fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n')}));
const output=process.env.WF_REPRESENTATIVES_TEST_REPORT;assert.ok(output);assert.ok(!fs.existsSync(output),'Preserve prior gate; use a fresh filename');
const report={status:'RUNNING',production_contacted:false,synthetic_projection_only:true,script_sha256:sha(fs.readFileSync(__filename)),source_hashes_lf:Object.fromEntries(sources.map(s=>[s.file,sha(s.source)])),databases:[]},save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
const unwrap=s=>s.replace(/^BEGIN;\s*/m,'').replace(/^COMMIT;\s*$/m,'');
(async()=>{for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']){
 const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];assert.equal(info.State.Running,true);
 const host=info.NetworkSettings.Networks['wf-final-disposable'].IPAddress;assert.match(host,/^172\.18\.0\.\d+$/);
 const database='wf_representatives_260_'+Date.now();execFileSync('docker',['exec',container,'createdb','-U','postgres','-T','wf_expanded_template3_20260908',database]);
 const env=Object.fromEntries(info.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 const db=new Client({host,port:5432,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
 const val=async(q,p)=>(await db.query(q,p)).rows[0].result;
 try{
  await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='90s'");await db.query('insert into wf_canonical_staging.publication_revision(singleton,revision) values(true,725)');
  for(const s of sources.slice(0,-1))await db.query(unwrap(s.source));
  await db.query(`insert into wf_canonical_staging.mariadb_canary_published_listings_v2
   (listing_id,source_id,source_hash,raw_message_id,observed_at,category,brand,model,reference,dial_color,year,condition,intent,intent_status,price_status,price_research_eligible,included_in_statistics,image_evidence_type,image_status,price_usd,original_price_amount,original_price_currency,original_price_role,fx_rate,fx_source,fx_date,source_created_at,image_key,image_url,thumbnail_url,raw_message_text,source_context_text,source_listing_status,source_deleted,review_status,duplicate_group_id,seller_id,review_reasons)
   select 'SYNTHETIC-REP-'||lpad(n::text,2,'0'),'SYNTHETIC-SOURCE-'||n,repeat('a',64),'00000000-0000-0000-0000-'||lpad(n::text,12,'0'),
    '2026-09-01T00:00:00Z'::timestamptz,'WATCH','Rolex',case when n=3 then 'Source variant' else 'Daytona' end,'116500LN',case when n=4 then 'black' else 'white' end,case when n=5 then 2023 else 2024 end,case when n=6 then 'used' else 'new' end,
    'WTS','VERIFIED','VERIFIED_USD',true,true,'SYNTHETIC_SOURCE','SOURCE_IMAGE_PRESENT',case when n=12 then 26000 else 25000 end,25000,'USD','ASKING',case when n=12 then 1.04 else 1 end,'SYNTHETIC_FX',case when n=13 then '2026-09-02' else '2026-09-01' end,
    case when n=14 then '2026-09-02T00:00:00Z'::timestamptz else '2026-09-01T00:00:00Z'::timestamptz end,'synthetic/same-primary','https://example.invalid/same-primary','https://example.invalid/same-primary',
    '[SYNTHETIC FIXTURE] WTS Rolex 116500LN USD 25000','[SYNTHETIC FIXTURE] WTS Rolex 116500LN USD 25000',case when n=7 then 'open' else 'ended' end,n=8,'APPROVED',case when n in(1,2) then 'SYNTHETIC_PREEXISTING_EXPLICIT_GROUP' end,
    '10000000-0000-0000-0000-000000000001'::uuid,case when n=9 then '["SOURCE_DISCLOSED_MODIFICATION"]'::jsonb else '[]'::jsonb end
   from generate_series(1,16)n`);
  const before=await val("select jsonb_agg(to_jsonb(p) order by listing_id) result from wf_canonical_staging.mariadb_canary_published_listings_v2 p");
  await val('select wf_canonical_staging.refresh_expanded_offer_observations_v3() result');
  assert.equal(await val('select count(*)::int result from public.trading_floor_ready_view_v2'),1,'Fixture must demonstrate former coarse suppression');
  const beforeConfig=await val("select jsonb_build_array(proconfig,proacl::text,prosecdef) result from pg_proc where oid='wf_canonical_staging.refresh_expanded_offer_observations_v3()'::regprocedure");
  await db.query(unwrap(sources.at(-1).source));const refreshed=await val('select wf_canonical_staging.refresh_expanded_offer_observations_v3() result');
  assert.equal(refreshed.changed,16);assert.equal(refreshed.suppressed_exact_reposts,0);assert.equal(refreshed.contract,'REVIEWED_REPRESENTATIVES_ONLY');
  assert.equal(await val('select count(*)::int result from public.trading_floor_ready_view_v2'),16);
  assert.equal(await val('select count(*)::int result from wf_canonical_staging.expanded_offer_observations_v3'),0);
  assert.deepEqual(await val("select jsonb_agg(to_jsonb(p) order by listing_id) result from wf_canonical_staging.mariadb_canary_published_listings_v2 p"),before);
  assert.equal(await val("select count(*)::int result from public.trading_floor_ready_view_v2 where duplicate_group_id='SYNTHETIC_PREEXISTING_EXPLICIT_GROUP'"),2);
  assert.deepEqual(await val("select jsonb_build_array(proconfig,proacl::text,prosecdef) result from pg_proc where oid='wf_canonical_staging.refresh_expanded_offer_observations_v3()'::regprocedure"),beforeConfig);
  const repeated=await val('select wf_canonical_staging.refresh_expanded_offer_observations_v3() result');assert.equal(repeated.changed,0);
  const identities=(await db.query("select wf_canonical_staging.research_offer_group_key_v2(to_jsonb(p)) key from public.trading_floor_ready_view_v2 p where listing_id not in('SYNTHETIC-REP-01','SYNTHETIC-REP-02')")).rows;assert.equal(new Set(identities.map(x=>x.key)).size,14);
  await db.query('ROLLBACK');assert.equal(await val('select count(*)::int result from wf_canonical_staging.mariadb_canary_published_listings_v2'),0);
  report.databases.push({container,database,status:'PASS',fixture_rows:16,old_visible_rows:1,reviewed_visible_rows:16,all_material_field_variants_retained:true,source_observations_without_equality_proof_distinct:true,fx_or_timestamp_only_does_not_create_equality_proof:true,existing_explicit_groups_preserved:true,publication_rows_unchanged:true,empty_projection_idempotent:true,function_privileges_unchanged:true,exact_rollback:true});save();
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }report.status='PASS';report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,output,sha256:sha(fs.readFileSync(output)),databases:report.databases}));
})().catch(e=>{report.status='FAIL';report.error={code:e.code||e.name,message:e.message,stack:e.stack};save();console.error(JSON.stringify(report.error));process.exitCode=1;});
