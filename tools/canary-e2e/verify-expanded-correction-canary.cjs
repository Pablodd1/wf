'use strict';
// Exact archived V2 repairs and V1 controls on named local databases only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const parsers=[require('../mariadb-live/expanded-evidence-candidates.cjs'),require('../mariadb-live/expanded-evidence-candidates-v2.cjs')];
const repo=path.resolve(__dirname,'../..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const linux=p=>p.replace(/^C:[/\\]/i,'/mnt/c/').replaceAll('\\','/');
const read=p=>JSON.parse(fs.readFileSync(linux(p),'utf8'));
const files=['20260910160000_expanded_source_candidate_evidence.sql','20260910170000_expanded_publication_versions.sql','20260910180000_expanded_publication_batches.sql','20260910190000_expanded_watch_source_views.sql','20260910200000_reviewed_dealer_profile_expansion.sql','20260910210000_trading_floor_source_images_order.sql'];
const evidence=read(process.env.WF_EXPANDED_CORRECTION_RECEIPT),bytes=fs.readFileSync(linux(evidence.private_evidence.file));
assert.equal(sha(bytes),evidence.private_evidence.sha256);
const inputs=JSON.parse(bytes).rows;
const deps=read(process.env.WF_EXPANDED_DEPENDENCY_RECEIPT),fxBytes=fs.readFileSync(linux(deps.artifacts.fx.file));
assert.equal(sha(fxBytes),deps.artifacts.fx.sha256);
const fx=JSON.parse(fxBytes).find(x=>x.document.usd_per_unit.EUR);
assert.equal(sha(fx.canonical_json),fx.evidence_hash);assert.deepEqual(JSON.parse(fx.canonical_json),fx.document);
const report={status:'RUNNING',production_contacted:false,source_mutations:0,raw_evidence_sha256:evidence.private_evidence.sha256,
 fx_evidence_hash:fx.evidence_hash,databases:[],migrations:files.map(file=>({file,sha256_lf:sha(fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n'))}))};
async function main(){
 assert.equal(inputs.length,8);
 for(const r of inputs){assert.equal(sha(stableJson(r.staged.raw_payload)),r.source_hash);const rebuilt=parsers[1].buildExpandedCandidates(r.staged);assert.deepEqual(rebuilt.candidates.map(x=>x.candidate_hash),r.after.candidates.map(x=>x.candidate_hash));}
 for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']){
  const database='wf_expanded_v2_'+sha(JSON.stringify(report.migrations)).slice(0,12);
  const create=spawnSync('docker',['exec',container,'createdb','-U','postgres','-T','wf_expanded_template3_20260908',database],{encoding:'utf8'});if(create.status!==0&&!create.stderr.includes('already exists'))throw Error(create.stderr);
  const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];assert.equal(info.State.Running,true);
  const env=Object.fromEntries(info.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)])),host=info.NetworkSettings.Networks['wf-final-disposable'].IPAddress;assert.match(host,/^172\.18\.0\.\d+$/);
  const db=new Client({host,port:5432,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
  const val=async(q,p)=>(await db.query(q,p)).rows[0].result,rev=()=>val('select revision result from wf_canonical_staging.publication_revision where singleton');
  const detail={container,status:'RUNNING',parents:8,v2_staged:0,v1_staged:0};report.databases.push(detail);
  try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");await db.query('INSERT INTO wf_canonical_staging.publication_revision(singleton,revision) VALUES(true,725) ON CONFLICT DO NOTHING');
   for(const file of files)await db.query(fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   const policies=parsers.map(p=>sha(p.PARSER_VERSION+evidence.private_evidence.sha256));
   for(let i=0;i<2;i++)await db.query('insert into wf_canonical_staging.expanded_publication_policies_v3 values($1,$2,$3,$4,now())',[policies[i],parsers[i].PARSER_VERSION,parsers[i].DEPENDENCY_HASHES,evidence.private_evidence.sha256]);
   await db.query('insert into wf_canonical_staging.verified_fx_evidence_v2(evidence_hash,document,canonical_json) values($1,$2,$3)',[fx.evidence_hash,fx.document,fx.canonical_json]);
   const versions=[];
   for(const r of inputs){const rawId=crypto.randomUUID(),s=r.staged;
    await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash) values($1,$2,$3,$4,$5,$5,'2026-09-07T01:00:13.576Z',NULL,'description',$6,$7::text,$7::text::jsonb,$6)`,[rawId,s.source_system,s.source_database,s.source_table,r.source_id,r.source_hash,stableJson(s.raw_payload)]);
    // Unchanged true-multi controls can stage under both registered policies,
    // while publication selects only the reviewed V2 version of each card.
    const sets=r.control?[[0,r.before],[1,r.after]]:[[1,r.after]];
    for(const [i,set] of sets)for(const row of set.candidates){assert.equal(row.candidate.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');
     await db.query('insert into wf_canonical_staging.expanded_candidate_admissions_v3 values($1,$2,$3,$4)',[row.candidate_hash,r.source_hash,policies[i],evidence.private_evidence.sha256]);
     await val('select wf_canonical_staging.stage_expanded_candidate_v3($1,$2,$3,$4) result',[rawId,policies[i],stableJson(row.candidate),row.candidate_hash]);detail[i?'v2_staged':'v1_staged']++;
     const version=await val('select wf_canonical_staging.materialize_expanded_candidate_v3($1,$2,NULL) result',[row.candidate_hash,fx.evidence_hash]);if(i)versions.push(version);
    }
   }
   assert.equal(detail.v1_staged,4);assert.equal(detail.v2_staged,10);
   await val('select wf_canonical_staging.publish_expanded_batch_v3($1,$2,$3,false) result',['CORRECTION_CANARY',await rev(),versions.map(v=>v.materialization_hash)]);
   const cohort=await val('select wf_canonical_staging.finalize_expanded_cohort_v3($1,$2) result',['CORRECTION_COHORT',['CORRECTION_CANARY']]);await db.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.equal(await val('select count(*)::int result from public.trading_floor_ready_view_v2'),10);
   const price=(await db.query("select original_price_amount::text,original_price_currency,price_usd::text,fx_source,price_research_eligible from public.trading_floor_ready_view_v2 where reference='RM35-02'")).rows[0];
   assert.equal(price.original_price_amount,'205000');assert.equal(price.original_price_currency,'EUR');assert.equal(Number(price.price_usd),Math.round(205000*Number(fx.document.usd_per_unit.EUR)*100)/100);assert.equal(price.price_research_eligible,true);assert.ok(price.fx_source.includes(fx.evidence_hash));
   assert.equal(await val("select count(*)::int result from public.trading_floor_ready_view_v2 where original_price_amount>0 and original_price_currency is null and price_usd is null and not price_research_eligible"),3);
   assert.equal(await val('select count(*)::int result from public.trading_floor_ready_view_v2 where parent_listing_id is not null and image_url is null and thumbnail_url is null and image_key is null and raw_message_text is null and description is null'),4);
   for(const r of inputs){const rows=(await db.query('select listing_id,source_hash,raw_message_text,parent_listing_id from public.trading_floor_ready_view_v2 where source_id=$1',[r.source_id])).rows;assert.equal(rows.length,r.control?2:1);for(const p of rows){const proof=await val('select public.get_expanded_listing_source_v3($1,$2) result',[p.listing_id,p.source_hash]);assert.equal(proof.raw_message_text,r.staged.raw_payload[r.after.candidates[0].candidate.parent_source_field]);}}
   assert.equal(await val("select count(*)::int result from wf_canonical_staging.mariadb_raw_source_rows where encode(sha256(convert_to(raw_payload_text,'UTF8')),'hex')<>source_hash"),0);
   await db.query('SET CONSTRAINTS ALL DEFERRED');const rollback=await val('select wf_canonical_staging.rollback_expanded_cohort_v3($1,$2) result',['CORRECTION_COHORT',await rev()]);assert.equal(rollback.removed,10);await db.query('SET CONSTRAINTS ALL IMMEDIATE');assert.equal(await val('select count(*)::int result from public.trading_floor_ready_view_v2'),0);
   Object.assign(detail,{status:'PASS',published:10,children:4,singles:6,raw_roundtrip:true,original_eur_preserved:true,verified_fx:true,ambiguous_currency_excluded:true,exact_rollback:true,snapshot:cohort.trading_snapshot});await db.query('ROLLBACK');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.finished_at=new Date().toISOString();
}
main().catch(e=>{report.status='FAIL';report.error={message:e.message,code:e.code,where:e.where,stack:e.stack};process.exitCode=1;}).finally(()=>{const out=process.env.WF_EXPANDED_TEST_REPORT;if(fs.existsSync(out))fs.copyFileSync(out,out+'.before-'+Date.now());fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
