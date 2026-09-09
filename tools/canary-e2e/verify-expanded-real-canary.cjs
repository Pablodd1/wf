'use strict';
// Runs only against named local disposable containers. Source text never logs.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {buildExpandedCandidates,DEPENDENCY_HASHES,PARSER_VERSION}=require('../mariadb-live/expanded-evidence-candidates.cjs');
const repo=path.resolve(__dirname,'../..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const linux=p=>p.replace(/^C:[/\\]/i,'/mnt/c/').replaceAll('\\','/');
const files=['20260910160000_expanded_source_candidate_evidence.sql','20260910170000_expanded_publication_versions.sql','20260910180000_expanded_publication_batches.sql','20260910190000_expanded_watch_source_views.sql','20260910200000_reviewed_dealer_profile_expansion.sql','20260910210000_trading_floor_source_images_order.sql'];
const manifestPath=process.env.WF_EXPANDED_CANARY_MANIFEST,sourceDirectory=process.env.WF_EXPANDED_RAW_DIRECTORY;
const manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
assert.equal(sha(manifestBytes),'96cf8dde0e8f45a13535039d1369778b86ef39432d8687aea6cd3e234a8f8e05');
assert.equal(sha(fs.readFileSync(path.join(repo,'tools/mariadb-live/expanded-evidence-candidates.cjs'))),manifest.binding.parser_sha256);
const report={status:'RUNNING',production_contacted:false,raw_source_changed:false,canary_manifest_sha256:sha(manifestBytes),databases:[],migrations:files.map(file=>({file,sha256_lf:sha(fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n'))}))};
const readPart=meta=>{const bytes=fs.readFileSync(linux(meta.file));assert.equal(sha(bytes),meta.sha256);const lines=zlib.gunzipSync(bytes).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);assert.equal(lines.length,meta.rows);return lines;};
async function main(){
 const parents=[],candidates=[];for(const part of manifest.parts){parents.push(...readPart(part.parents));candidates.push(...readPart(part.candidates).filter(r=>r.candidate.decision.trading_floor==='TF_SUPPORTED_CANDIDATE'));}
 assert.equal(parents.length,300);assert.equal(candidates.length,1660);
 const rawMap=new Map();let chunkName=null,rawRows=null;
 for(const p of parents){if(chunkName!==p.raw_chunk){const bytes=fs.readFileSync(path.join(sourceDirectory,p.raw_chunk));assert.equal(sha(bytes),p.raw_chunk_sha256);rawRows=zlib.gunzipSync(bytes).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);chunkName=p.raw_chunk;}
  const raw=rawRows[p.row_index],canonical=stableJson(raw);assert.equal(String(raw.id),p.source_id);assert.equal(sha(canonical),p.source_hash);rawMap.set(p.source_id,{raw,canonical,hash:p.source_hash,raw_id:crypto.randomUUID()});}
 const bySource=new Map();for(const row of candidates){const c=row.candidate,canonical=stableJson(c);assert.equal(sha(canonical),row.candidate_hash);row.canonical_json=canonical;let rebuilt=bySource.get(c.source_id);if(!rebuilt){const r=rawMap.get(c.source_id);rebuilt=new Map(buildExpandedCandidates({source_system:c.source_system,source_database:c.source_database,source_table:c.source_table,source_id:c.source_id,source_hash:c.source_hash,raw_payload:r.raw,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'}).candidates.map(x=>[x.candidate_hash,x.canonical_json]));bySource.set(c.source_id,rebuilt);}assert.equal(rebuilt.get(row.candidate_hash),canonical);}
 for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']){
  const database='wf_expanded_real_'+sha(JSON.stringify(report.migrations)).slice(0,12);let info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];if(!info.State.Running)execFileSync('docker',['start',container]);
  const create=spawnSync('docker',['exec',container,'createdb','-U','postgres','-T','wf_expanded_template3_20260908',database],{encoding:'utf8'});if(create.status!==0&&!create.stderr.includes('already exists'))throw Error(create.stderr);
  info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];const env=Object.fromEntries(info.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)])),host=info.NetworkSettings.Networks['wf-final-disposable'].IPAddress;assert.match(host,/^172\.18\.0\.\d+$/);
  const db=new Client({host,port:5432,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();const val=async(q,p)=>(await db.query(q,p)).rows[0].result,rev=()=>val('select revision result from wf_canonical_staging.publication_revision where singleton');
  const detail={container,status:'RUNNING',source_parents:300,verified_candidates:1660,staged:0,materialized:0};report.databases.push(detail);
  try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");await db.query('INSERT INTO wf_canonical_staging.publication_revision(singleton,revision) VALUES(true,725) ON CONFLICT DO NOTHING');
   for(const file of files)await db.query(fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   const policy=sha('DISPOSABLE_EXACT_CANARY_POLICY'+report.canary_manifest_sha256);await db.query('insert into wf_canonical_staging.expanded_publication_policies_v3 values($1,$2,$3,$4,now())',[policy,PARSER_VERSION,DEPENDENCY_HASHES,report.canary_manifest_sha256]);
   for(const p of parents){const r=rawMap.get(p.source_id),c=candidates.find(c=>c.source_id===p.source_id)?.candidate;if(!c)continue;
    await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash) values($1,$2,$3,$4,$5,$5,'2026-09-07T01:00:13.576Z',NULL,'description',$6,$7::text,$7::text::jsonb,$6)`,[r.raw_id,c.source_system,c.source_database,c.source_table,c.source_id,r.hash,r.canonical]);}
   const versions=[];
   for(const row of candidates){const c=row.candidate,r=rawMap.get(c.source_id);detail.current_candidate_hash=row.candidate_hash;
    await db.query('insert into wf_canonical_staging.expanded_candidate_admissions_v3 values($1,$2,$3,$4)',[row.candidate_hash,r.hash,policy,report.canary_manifest_sha256]);
    await val('select wf_canonical_staging.stage_expanded_candidate_v3($1,$2,$3,$4) result',[r.raw_id,policy,row.canonical_json,row.candidate_hash]);detail.staged++;
    versions.push(await val('select wf_canonical_staging.materialize_expanded_candidate_v3($1,NULL,NULL) result',[row.candidate_hash]));detail.materialized++;
   }
   delete detail.current_candidate_hash;
   // A payload adjacent to valid source with a freshly computed hash is not admission.
   const first=candidates[0],forged=structuredClone(first.candidate);forged.fields.brand='Fabricated Maker';const forgedCanonical=stableJson(forged);
   await db.query('SAVEPOINT forged');let denied=false;try{await val('select wf_canonical_staging.stage_expanded_candidate_v3($1,$2,$3,$4) result',[rawMap.get(first.source_id).raw_id,policy,forgedCanonical,sha(forgedCanonical)]);}catch(e){assert.equal(e.message,'expanded_candidate_not_in_reviewed_manifest');denied=true;}assert.equal(denied,true);await db.query('ROLLBACK TO SAVEPOINT forged');
   const keys=[];for(let i=0;i<versions.length;i+=500){const key='REAL_'+i;keys.push(key);await val('select wf_canonical_staging.publish_expanded_batch_v3($1,$2,$3,false) result',[key,await rev(),versions.slice(i,i+500).map(v=>v.materialization_hash)]);}
   const cohort=await val('select wf_canonical_staging.finalize_expanded_cohort_v3($1,$2) result',['REAL_COHORT',keys]);await db.query('SET CONSTRAINTS ALL IMMEDIATE');
   detail.published_rows=await val('select count(*)::int result from wf_canonical_staging.mariadb_canary_published_listings_v2');assert.equal(detail.published_rows,1660);
   detail.visible_rows=await val('select count(*)::int result from public.trading_floor_ready_view_v2');detail.snapshot_rows=await val('select count(*)::int result from wf_canonical_staging.keyset_snapshot_members where snapshot_id=$1',[cohort.trading_snapshot]);assert.equal(detail.visible_rows,detail.snapshot_rows);
   detail.children=await val('select count(*)::int result from public.trading_floor_ready_view_v2 where parent_listing_id is not null');
   assert.equal(await val('select count(*)::int result from public.trading_floor_ready_view_v2 where parent_listing_id is not null and (image_key is not null or image_url is not null or thumbnail_url is not null or raw_message_text is not null or description is not null)'),0);
   const child=(await db.query('select listing_id,source_id,source_hash,source_context_text from public.trading_floor_ready_view_v2 where parent_listing_id is not null limit 1')).rows[0];const original=await val('select public.get_expanded_listing_source_v3($1,$2) result',[child.listing_id,child.source_hash]);const parent=parents.find(p=>p.source_id===child.source_id);assert.equal(original.raw_message_text,rawMap.get(child.source_id).raw[parent.parent_source_field]);assert.equal(original.source_context_text,child.source_context_text);
   detail.storage=(await db.query("select c.relname,pg_total_relation_size(c.oid)::text total_bytes,c.reltuples from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='wf_canonical_staging' and c.relkind='r' and (c.relname like 'expanded_%' or c.relname like 'keyset_snapshot_%' or c.relname='mariadb_canary_published_listings_v2') order by c.relname")).rows;
   detail.raw_hash_mismatches=await val("select count(*)::int result from wf_canonical_staging.mariadb_raw_source_rows where encode(sha256(convert_to(raw_payload_text,'UTF8')),'hex')<>source_hash");assert.equal(detail.raw_hash_mismatches,0);
   await db.query('SET CONSTRAINTS ALL DEFERRED');
   const rollback=await val('select wf_canonical_staging.rollback_expanded_cohort_v3($1,$2) result',['REAL_COHORT',await rev()]);assert.equal(rollback.removed,1660);await db.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.equal(await val('select count(distinct publication_revision)::int result from wf_canonical_staging.keyset_snapshot_registry'),2);detail.one_snapshot_pair_for_whole_cohort_rollback=true;assert.equal(await val('select count(*)::int result from public.trading_floor_ready_view_v2'),0);assert.equal(await val('select count(*)::int result from public.seller_listing_lineage_staging'),0);
   detail.status='PASS';detail.exact_rollback=true;detail.child_images_and_parent_copy_absent=true;detail.unreviewed_hash_rejected=true;await db.query('ROLLBACK');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.completed_at=new Date().toISOString();
}
main().catch(e=>{report.status='FAIL';report.error={message:e.message,code:e.code,position:e.position,where:e.where,stack:e.stack};process.exitCode=1;}).finally(()=>{const out=process.env.WF_EXPANDED_TEST_REPORT;if(fs.existsSync(out))fs.copyFileSync(out,out+'.before-'+Date.now());fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
