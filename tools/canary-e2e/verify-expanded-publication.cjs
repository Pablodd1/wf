'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync,spawnSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');
const {buildExpandedCandidates,verifyExpandedCandidate,DEPENDENCY_HASHES,PARSER_VERSION}=require('../mariadb-live/expanded-evidence-candidates.cjs');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const repo=path.resolve(__dirname,'../..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const files=['20260910160000_expanded_source_candidate_evidence.sql','20260910170000_expanded_publication_versions.sql','20260910180000_expanded_publication_batches.sql','20260910190000_expanded_watch_source_views.sql','20260910200000_reviewed_dealer_profile_expansion.sql'];
const report={status:'RUNNING',production_contacted:false,databases:[],migrations:files.map(file=>({file,sha256_lf:sha(fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n'))}))};
async function main(){for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']){
 let info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];if(!info.State.Running)execFileSync('docker',['start',container]);
 const database='wf_expanded_root_test_20260908';const create=spawnSync('docker',['exec',container,'createdb','-U','postgres','-T','wf_expanded_template3_20260908',database],{encoding:'utf8'});
 if(create.status!==0&&!create.stderr.includes('already exists'))throw new Error(create.stderr);
 info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];const env=Object.fromEntries(info.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 const host=info.NetworkSettings.Networks['wf-final-disposable'].IPAddress;assert.match(host,/^172\.18\.0\.\d+$/);
 const db=new Client({host,port:5432,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
 const value=async(q,p)=>(await db.query(q,p)).rows[0].result;
 const revision=()=>value('select revision result from wf_canonical_staging.publication_revision where singleton');
 try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");await db.query("INSERT INTO wf_canonical_staging.publication_revision(singleton,revision) VALUES(true,725) ON CONFLICT DO NOTHING");
 await db.query('CREATE SCHEMA IF NOT EXISTS wf_disposable_legacy');
 for(const file of files){const sql=fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n');await db.query(sql.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));}
 const policy='a'.repeat(64);await db.query('insert into wf_canonical_staging.expanded_publication_policies_v3 values($1,$2,$3,$4,now())',[policy,PARSER_VERSION,DEPENDENCY_HASHES,'b'.repeat(64)]);
 const titles=[
 'Rolex\nWTS\n116500LN asking USD 25,000\n126610LN asking USD 14,000',
 'Rolex\nWTS\n116500LN asking USD 25,000\n126610LN asking USD 14,000',
 'WTB Rolex 116500LN budget USD 24000',
 'WTS Rolex 126610LN asking $14000',
 'WTS Rolex 116500LN asking USD 25000.01',
 ];
 const versions=[],raws=[];
 for(let i=0;i<titles.length;i++){
  const id=crypto.randomUUID(),payload={id,title:titles[i],description:null,comments:null,brand:'Rolex',type:i===2?'search':'sale',is_bundle:i<2?1:0,status:'ended',region:'Asia',from_number:'+14155550198',from_name:'Synthetic Source',created_on:'2025-01-02 12:30:00',updated_on:null,reposted_at:null,deleted_on:null,synthetic_fixture:true};
  const raw=stableJson(payload),h=sha(raw),staged={id,source_id:id,source_system:'SYNTHETIC_EXPANDED',source_database:'fixture',source_table:'auctions',source_hash:h,raw_payload:payload,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};
  await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash) values($1::uuid,$2,$3,$4,$1::text,$1::text,'2026-09-08T19:00:00Z',NULL,'description',$5,$6::text,$6::text::jsonb,$5)`,[id,staged.source_system,staged.source_database,staged.source_table,h,raw]);
  raws.push({id,h,raw});const result=buildExpandedCandidates(staged);assert.equal(result.candidates.length,i<2?2:1);
  for(const entry of result.candidates){verifyExpandedCandidate(staged,entry);assert.equal(entry.candidate.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');
   await db.query('insert into wf_canonical_staging.expanded_candidate_admissions_v3 values($1,$2,$3,$4)',[entry.candidate_hash,h,policy,'b'.repeat(64)]);
   await value('select wf_canonical_staging.stage_expanded_candidate_v3($1,$2,$3,$4) result',[id,policy,entry.canonical_json,entry.candidate_hash]);
   const v=await value('select wf_canonical_staging.materialize_expanded_candidate_v3($1,NULL,NULL) result',[entry.candidate_hash]);versions.push(v);
  }
 }
 assert.equal(versions.length,7);
 // A previous failed workflow can leave private lineage before an additive publish.
 // Rollback must restore it byte-for-byte, while removing newly created lineage.
 const orphan=versions[0].listing_id;
 await db.query(`insert into public.seller_listing_lineage_staging(source_system,source_record_id,seller_listing_id,source_identity,match_status,match_evidence,observed_name)
 select 'WF_V2_SOURCE_BOUND',listing_id,document->>'source_id','preserved-old-proof','REVIEW_REQUIRED','{"prior":true}'::jsonb,'Original reviewed observation'
 from wf_canonical_staging.expanded_listing_versions_v3 where materialization_hash=$1`,[versions[0].materialization_hash]);
 const beforeLineage=await value("select jsonb_agg(to_jsonb(l) order by id) result from public.seller_listing_lineage_staging l");
 await db.query('SAVEPOINT missing_finalize');
 await value('select wf_canonical_staging.publish_expanded_batch_v3($1,$2,$3,true) result',['UNFINALIZED',await revision(),[versions[0].materialization_hash]]);
 let rejected=false;try{await db.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(e){assert.equal(e.code,'23514');rejected=true;}assert.equal(rejected,true);await db.query('ROLLBACK TO SAVEPOINT missing_finalize');
 const beforeRaw=await value("select encode(sha256(convert_to(string_agg(raw_payload_text,'' order by id),'UTF8')),'hex') result from wf_canonical_staging.mariadb_raw_source_rows");
 const first=await value('select wf_canonical_staging.publish_expanded_batch_v3($1,$2,$3,true) result',['ACTUAL',await revision(),versions.map(v=>v.materialization_hash)]);assert.equal(first.inserted,7);
 const cohort=await value('select wf_canonical_staging.finalize_expanded_cohort_v3($1,$2) result',['COHORT',['ACTUAL']]);
 assert.equal(await value('select count(*)::int result from public.trading_floor_ready_view_v2'),5);
 assert.equal(await value("select count(*)::int result from wf_canonical_staging.expanded_offer_observations_v3 where representative_listing_id<>listing_id"),2);
 const child=(await db.query("select * from public.trading_floor_ready_view_v2 where parent_listing_id is not null order by listing_id limit 1")).rows[0];assert.ok(child);for(const k of ['image_url','thumbnail_url','image_key','raw_message_text','description'])assert.equal(child[k],null);
 const source=await value('select public.get_expanded_listing_source_v3($1,$2) result',[child.listing_id,child.source_hash]);assert.equal(source.raw_message_text,titles[0]);assert.equal(source.source_context_text,child.source_context_text);
 assert.equal(await value('select public.get_expanded_listing_source_v3($1,$2) result',[child.listing_id,'0'.repeat(64)]),null);
 const budget=(await db.query("select * from public.trading_floor_ready_view_v2 where intent='WTB'")).rows[0];assert.equal(budget.original_price_amount,'24000');assert.equal(budget.original_price_currency,'USD');assert.equal(budget.original_price_role,'WTB_BUDGET');assert.equal(budget.price_research_eligible,false);assert.equal(budget.source_created_at,null);assert.equal(budget.source_created_at_text,'2025-01-02 12:30:00');assert.equal(budget.source_listing_status,'ended');
 const bare=(await db.query("select * from public.trading_floor_ready_view_v2 where original_price_currency is null")).rows[0];assert.equal(bare.original_price_amount,'14000');assert.equal(bare.price_usd,null);assert.equal(bare.price_research_eligible,false);
 const penny=(await db.query("select * from public.trading_floor_ready_view_v2 where original_price_amount=25000.01")).rows[0];assert.equal(penny.price_usd,'25000.01');
 assert.equal(await value("select count(*)::int result from wf_canonical_staging.keyset_snapshot_members where snapshot_id=$1",[cohort.trading_snapshot]),5);
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 assert.equal(await value("select encode(sha256(convert_to(string_agg(raw_payload_text,'' order by id),'UTF8')),'hex') result from wf_canonical_staging.mariadb_raw_source_rows"),beforeRaw);
 await db.query('SET CONSTRAINTS ALL DEFERRED');
 await db.query('SAVEPOINT missing_rollback_snapshots');
 await value('select wf_canonical_staging.rollback_expanded_batch_data_v3($1,$2) result',['ACTUAL',await revision()]);
 let rollbackRejected=false;try{await db.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(e){assert.equal(e.message,'expanded_rollback_snapshots_missing');rollbackRejected=true;}assert.equal(rollbackRejected,true);await db.query('ROLLBACK TO SAVEPOINT missing_rollback_snapshots');
 assert.equal(budget.location_region,'Asia');
 await db.query('SAVEPOINT changed_lineage');
 await db.query("update public.seller_listing_lineage_staging set observed_name='Subsequent owner change' where source_record_id=$1",[orphan]);
 let lineageRejected=false;try{await value('select wf_canonical_staging.rollback_expanded_batch_v3($1,$2) result',['ACTUAL',await revision()]);}catch(e){assert.equal(e.message,'expanded_rollback_lineage_changed');lineageRejected=true;}assert.equal(lineageRejected,true);
 await db.query('ROLLBACK TO SAVEPOINT changed_lineage');
 const rollback=await value('select wf_canonical_staging.rollback_expanded_batch_v3($1,$2) result',['ACTUAL',await revision()]);assert.equal(rollback.removed,7);assert.equal(await value('select count(*)::int result from public.trading_floor_ready_view_v2'),0);
 assert.deepEqual(await value("select jsonb_agg(to_jsonb(l) order by id) result from public.seller_listing_lineage_staging l"),beforeLineage);
 assert.equal(await value("select encode(sha256(convert_to(string_agg(raw_payload_text,'' order by id),'UTF8')),'hex') result from wf_canonical_staging.mariadb_raw_source_rows"),beforeRaw);
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 report.databases.push({container,status:'PASS',source_rows:5,candidate_versions:7,published_rows:7,visible_rows:5,exact_reposts_suppressed:2,child_no_images:true,source_proof_roundtrip:true,unknown_currency_preserved:true,changed_cent_retained:true,budget_separate:true,unfinalized_commit_rejected:true,raw_unchanged:true,exact_rollback:true,preexisting_lineage_restored:true,subsequent_lineage_change_rejected:true});await db.query('ROLLBACK');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }report.status='PASS';report.completed_at=new Date().toISOString();}
main().catch(e=>{report.status='FAIL';report.error={message:e.message,code:e.code,position:e.position,where:e.where,stack:e.stack};process.exitCode=1;}).finally(()=>{const output=process.env.WF_EXPANDED_TEST_REPORT;if(fs.existsSync(output))fs.copyFileSync(output,output+'.before-'+Date.now());fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
