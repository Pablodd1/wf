'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');const {Client}=require('./test-dependencies.cjs')('pg');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs'),{normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),migration='20260910100000_reviewed_source_brand_alias_resolution.sql';
const sql=file=>fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations',file),'utf8').replaceAll('\r\n','\n');
const source=sql(migration),combined=['20260909200000_snapshot_browse_discovery.sql','20260909210000_snapshot_browse_case_groups.sql','20260909230000_published_brand_alias_projection.sql','20260909220000_reviewed_source_identity_resolution.sql','20260909240000_currency_price_reference_guard.sql'];
const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,migration_sha256_lf:sha(source),combined_migrations:combined.map(file=>({file,sha256_lf:sha(sql(file))})),databases:[]};
const strip=s=>s.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
async function main(){for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];assert.equal(info.State.Running,true);
 const env=Object.fromEntries(info.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)])),binding=info.NetworkSettings.Ports['5432/tcp']?.[0],network=info.NetworkSettings.Networks['wf-final-disposable'];assert.ok(network);
 const host=binding?'127.0.0.1':network.IPAddress,port=binding?Number(binding.HostPort):5432;assert.ok(host==='127.0.0.1'||/^172\.18\.0\.\d+$/.test(host));
 const db=new Client({host,port,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();const value=async(q,p)=>(await db.query(q,p)).rows[0].result;
 const count=()=>value('SELECT count(*)::int result FROM wf_canonical_staging.mariadb_canary_published_listings_v2'),revision=()=>value('SELECT revision result FROM wf_canonical_staging.publication_revision WHERE singleton');const before=await count();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");await db.query('CREATE SCHEMA IF NOT EXISTS wf_disposable_legacy');
  for(const file of combined.slice(0,3))await db.query(strip(sql(file)));
  if(!await value("SELECT to_regprocedure('wf_canonical_staging.review_single_source_identity_v2(jsonb,text)')::text result"))await db.query(strip(sql('20260909140000_corroborate_source_identity_metadata.sql')));
  for(const file of combined.slice(3))await db.query(strip(sql(file)));
  const job='SYNTHETIC-LITERAL-BRAND-'+crypto.randomUUID(),lease=crypto.randomUUID();
  const fixtures=[
   {description:'WTB 🌟 Lange 363.150 new complete',brand:'A. Lange & Söhne',reference:'363.150',model:'Odysseus',quote:'Lange',rule:'ALANGE_LITERAL_NAME_V1'},
   {description:'WTB Glashutte Original watch 1-90-02-46-32-35 new complete',brand:'Glashütte Original',reference:'1-90-02-46-32-35',model:'PanoMaticLunar',quote:'Glashutte Original',rule:'GLASHUETTE_LITERAL_NAME_V1'},
   {description:'WTB Langensohn 363.150 new complete',brand:'A. Lange & Söhne',reference:'363.150',model:'Odysseus',quote:'Lange',rule:'ALANGE_LITERAL_NAME_V1'},
   {description:'WTB Rolex Submariner 126610LN',brand:'Rolex',reference:'126610LN',model:'Submariner'},
  ];
  const records=fixtures.map(({quote,rule,...payload})=>{const id=crypto.randomUUID(),text=stableJson({...payload,id,synthetic_fixture:true});return {id,text,hash:sha(text),description:payload.description};});
  await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
   SELECT id::uuid,$2,'disposable','auctions',id,id,'2026-09-01','2026-09-02',description,'description',hash,text,text::jsonb,hash FROM jsonb_to_recordset($1::jsonb)x(id text,text text,hash text,description text)`,[JSON.stringify(records),job]);
  await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at) VALUES($1,'2026-09-03','zzzz',4,4,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":4}',$2,now())`,[job,sha(job)]);
  await value('SELECT public.create_frozen_normalization_job_v2($1,$1,$2,$1,$3,$4,4) result',[job,sha(job),'disposable','auctions']);
  const claims=await value('SELECT public.claim_normalization_batch_v2($1,$2,4) result',[job,lease]),normalized=claims.map(normalizeClaim);assert.ok(normalized.every(r=>r.proposal?.trading_floor_eligible),JSON.stringify(normalized.map(r=>({description:records.find(x=>x.id===r.raw_row_id).description,proposal:r.proposal,error:r.error_code}))));
  await value('SELECT public.complete_normalization_batch_v2($1,$2,$3::jsonb) result',[job,lease,JSON.stringify(normalized)]);
  const proposal=id=>normalized.find(r=>r.raw_row_id===id).proposal;
  const materialize=id=>value('SELECT wf_canonical_staging.materialize_single_member_v2($1,$2,$3,NULL,NULL) result',[job,id,proposal(id).proposal_hash]);
  const resolve=id=>value('SELECT wf_canonical_staging.resolve_reviewed_source_identity_v2($1,$2) result',[id,proposal(id).proposal_hash]);
  const old=[];for(const r of records)old.push(await materialize(r.id));assert.deepEqual(old.map(r=>r.outcome),['REVIEW','REVIEW','REVIEW','ELIGIBLE']);
  const originalProof=[];for(const r of records)originalProof.push(await resolve(r.id));
  const frozen=()=>value(`SELECT jsonb_build_object('raw',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM wf_canonical_staging.mariadb_raw_source_rows r WHERE id=ANY($1::uuid[])),'proposals',(SELECT jsonb_agg(to_jsonb(p) ORDER BY source_id) FROM wf_canonical_staging.mariadb_normalized_proposals p WHERE source_system=$2),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY raw_row_id) FROM wf_canonical_staging.normalization_job_members_v2 m WHERE job_name=$2),'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY materialization_hash) FROM wf_canonical_staging.materialized_single_versions_v2 v WHERE materialization_hash=ANY($3::text[]))) result`,[records.map(r=>r.id),job,old.map(r=>r.materialization_hash)]);
  const immutableBefore=await frozen();await db.query(strip(source));
  for(let i=0;i<records.length;i++)assert.deepEqual(await resolve(records[i].id),originalProof[i]);
  const documents=records.slice(0,3).map((r,i)=>{const f=fixtures[i],offset=Array.from(r.description.slice(0,r.description.indexOf(f.quote))).length;return {contract:'WF_REVIEWED_SOURCE_IDENTITY_V1',raw_row_id:r.id,source_hash:r.hash,proposal_hash:proposal(r.id).proposal_hash,source_text_sha256:sha(r.description),expected_brand:proposal(r.id).brand,expected_reference:proposal(r.id).reference,expected_model:originalProof[i].model,approved_reference:proposal(r.id).reference,approved_outcome:'ELIGIBLE',reason:'REVIEWED_LITERAL_SOURCE_BRAND_NAME',review_manifest_sha256:sha('synthetic-literal-brand-manifest'),brand_alias_proof:{contract:'WF_LITERAL_SOURCE_BRAND_ALIAS_V1',offset_unit:'UNICODE_CODE_POINTS',rule_id:f.rule,quote:f.quote,start:offset,end:offset+Array.from(f.quote).length}};});
  const record=d=>value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[d]);
  const expectError=async(fn,message)=>{await db.query('SAVEPOINT expected_error');try{await fn();assert.fail('EXPECTED_ERROR');}catch(e){assert.equal(e.message,message);}finally{await db.query('ROLLBACK TO SAVEPOINT expected_error');await db.query('RELEASE SAVEPOINT expected_error');}};
  const proofChange=(d,change)=>({...d,brand_alias_proof:{...d.brand_alias_proof,...change}});
  await expectError(()=>record(proofChange(documents[0],{rule_id:null})),'reviewed_brand_alias_proof_invalid');
  await expectError(()=>record(proofChange(documents[0],{quote:'Odysseus'})),'reviewed_brand_alias_proof_invalid');
  await expectError(()=>record(proofChange(documents[0],{start:documents[0].brand_alias_proof.start+1,end:documents[0].brand_alias_proof.end+1})),'reviewed_brand_alias_quote_not_source_exact');
  await expectError(()=>record(documents[2]),'reviewed_brand_alias_quote_not_source_exact');
  await expectError(()=>record({...documents[0],approved_reference:'363.151'}),'reviewed_brand_alias_proof_invalid');
  await expectError(()=>record({...documents[0],expected_brand:'Rolex'}),'reviewed_identity_evidence_changed');
  for(const d of documents.slice(0,2)){const r=await record(d);assert.equal(r.outcome,'ELIGIBLE');assert.equal(r.model,null);assert.equal(r.brand,d.expected_brand);assert.ok(!r.reasons.includes('SOURCE_METADATA_BRAND_UNCORROBORATED'));assert.deepEqual(await record(d),r);}
  await expectError(()=>record({...documents[0],reason:'CHANGED'}),'reviewed_identity_replay_changed');
  const changed=[];for(const r of records.slice(0,2))changed.push(await materialize(r.id));assert.ok(changed.every(r=>r.outcome==='ELIGIBLE'));
  assert.deepEqual(await materialize(records[3].id),{...old[3],inserted:0,identical:1});assert.equal((await resolve(records[2].id)).outcome,'REVIEW');
  const batch=await value('SELECT public.publish_materialized_batch_v2($1,$2,$3,true) result',[job+'-REVIEWED',await revision(),changed.map(r=>r.materialization_hash)]);assert.equal(batch.inserted,2);assert.equal(await count(),before+2);
  const published=(await db.query('SELECT brand,model,reference,raw_message_text,source_hash,image_url FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE raw_message_id=ANY($1::text[])',[records.slice(0,2).map(r=>r.id)])).rows;
  for(const r of published){const original=records.find(o=>o.hash===r.source_hash),index=records.indexOf(original);assert.equal(r.brand,fixtures[index].brand);assert.equal(r.reference,fixtures[index].reference);assert.equal(r.model,null);assert.equal(r.raw_message_text,original.description);assert.equal(r.image_url,null);}
  assert.deepEqual(await frozen(),immutableBefore);await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  const rollback=await value('SELECT public.rollback_materialized_batch_v2($1,$2) result',[job+'-REVIEWED',await revision()]);assert.equal(await count(),before);assert.deepEqual(await frozen(),immutableBefore);
  await db.query('ROLLBACK');assert.equal(await count(),before);
  report.databases.push({container,database,status:'PASS',fixtures:4,reviewed_promotions:2,unreviewed_held:1,unaffected_control:1,checks:['No-sidecar identities remain unchanged','Literal Lange and full Glashutte Original with exact references','Unicode code-point offsets after emoji','Null or unknown rule/model-family substitutions rejected','Token substring and shifted quote rejected','Existing identity/reference/source/replay guards preserved','Raw/proposal/member/prior-version evidence byte-equivalent','Unsupported model remains null and images are never invented','Shared resolver materialization/publication and exact rollback']});
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{report.status='FAIL';report.error=e.message;report.stack=e.stack;fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.error(e.message);process.exitCode=1;});
