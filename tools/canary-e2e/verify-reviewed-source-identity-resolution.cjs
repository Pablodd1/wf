'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const source=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909220000_reviewed_source_identity_resolution.sql'),'utf8').replaceAll('\r\n','\n');
const currencySource=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909240000_currency_price_reference_guard.sql'),'utf8').replaceAll('\r\n','\n');
const combined=['20260909200000_snapshot_browse_discovery.sql','20260909210000_snapshot_browse_case_groups.sql','20260909230000_published_brand_alias_projection.sql'].map(file=>({file,source:fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations',file),'utf8').replaceAll('\r\n','\n')}));
const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,migration_sha256_lf:sha(source),combined_migrations:combined.map(m=>({file:m.file,sha256_lf:sha(m.source)})),databases:[]};
report.identity_migration_sha256_lf=sha(source);report.currency_guard_migration_sha256_lf=sha(currencySource);
if(process.env.CURRENCY_GUARD_REPORT==='true'){
 report.migration_sha256_lf=sha(currencySource);
 report.combined_migrations.push({file:'20260909220000_reviewed_source_identity_resolution.sql',sha256_lf:sha(source)});
}
async function main(){
 for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
  const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];assert.equal(info.State.Running,true);
  const env=Object.fromEntries(info.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  const binding=info.NetworkSettings.Ports['5432/tcp']?.[0],network=info.NetworkSettings.Networks['wf-final-disposable'];assert.ok(network);
  const host=binding?'127.0.0.1':network.IPAddress,port=binding?Number(binding.HostPort):5432;assert.ok(host==='127.0.0.1'||/^172\.18\.0\.[0-9]+$/.test(host));
  const db=new Client({host,port,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
  const value=async(q,p)=>(await db.query(q,p)).rows[0].result;
  const revision=()=>value('SELECT revision result FROM wf_canonical_staging.publication_revision WHERE singleton');
  const count=()=>value('SELECT count(*)::int result FROM wf_canonical_staging.mariadb_canary_published_listings_v2');
  const before=await count();
  try{
   await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");await db.query('CREATE SCHEMA IF NOT EXISTS wf_disposable_legacy');
   for(const migration of combined)await db.query(migration.source.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   if(!await value("SELECT to_regprocedure('wf_canonical_staging.review_single_source_identity_v2(jsonb,text)')::text result")){
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909140000_corroborate_source_identity_metadata.sql'),'utf8').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   }
   const job='SYNTHETIC-REVIEWED-'+crypto.randomUUID(),lease=crypto.randomUUID();
   const fixtures=[
    {description:'WTB BNIB 2025/26 Datejust 126334 Blue Dial Jubilee',brand:'Datejust',reference:'126334',approved:'126334'},
    {description:'Looking for Rolex 2017/2018',brand:'Rolex',reference:'2017/2018',approved:null},
    {description:'WTB Patek Philippe 5261 r 2025/26',brand:'Patek Philippe',reference:'5261 r',approved:'5261 r'},
    {description:'WTB Patek Philippe 5164/A 2025/26',brand:'Patek Philippe',reference:'5164/A',approved:'5164/A'},
    {description:'WTB Rolex 18206 or 118206',brand:'Rolex',reference:'118206',approved:null},
    {description:'WTS Rolex Submariner 126610LN USD 12500',brand:'Rolex',reference:'126610LN',model:'Submariner',control:true},
    {description:'WTS Rolex 116505 HKD328K',brand:'Rolex',reference:'HKD328K',approved:'116505'},
   ];
   const records=fixtures.map(({approved,control,...p})=>{const id=crypto.randomUUID(),text=stableJson({...p,id,synthetic_fixture:true});return {id,text,hash:sha(text),description:p.description};});
   await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
    SELECT id::uuid,$2,'disposable','auctions',id,id,'2026-09-01','2026-09-02',description,'description',hash,text,text::jsonb,hash FROM jsonb_to_recordset($1::jsonb)x(id text,text text,hash text,description text)`,[JSON.stringify(records),job]);
   await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
    VALUES($1,'2026-09-03','zzzz',7,7,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":7}',$2,now())`,[job,sha(job)]);
   await value('SELECT public.create_frozen_normalization_job_v2($1,$1,$2,$1,$3,$4,7) result',[job,sha(job),'disposable','auctions']);
   const claims=await value('SELECT public.claim_normalization_batch_v2($1,$2,7) result',[job,lease]);
   const normalized=claims.map(normalizeClaim);assert.ok(normalized.every(r=>r.proposal?.trading_floor_eligible));
   await value('SELECT public.complete_normalization_batch_v2($1,$2,$3::jsonb) result',[job,lease,JSON.stringify(normalized)]);
   const materialize=async(id)=>{const r=normalized.find(x=>x.raw_row_id===id);return value('SELECT wf_canonical_staging.materialize_single_member_v2($1,$2,$3,NULL,NULL) result',[job,id,r.proposal.proposal_hash]);};
   const old=[];for(const r of records)old.push(await materialize(r.id));assert.ok(old.every(x=>x.outcome==='ELIGIBLE'));
   const oldBatch=await value('SELECT public.publish_materialized_batch_v2($1,$2,$3,true) result',[job+'-OLD',await revision(),old.map(x=>x.materialization_hash)]);assert.equal(oldBatch.inserted,7);
   const original=(await db.query('SELECT to_jsonb(c) document,encode(sha256(convert_to(to_jsonb(c)::text,\'UTF8\')),\'hex\') hash FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c WHERE raw_message_id=ANY($1::text[]) ORDER BY listing_id',[records.map(x=>x.id)])).rows;
   const evidence=async()=>value(`SELECT jsonb_build_object('raw',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM wf_canonical_staging.mariadb_raw_source_rows r WHERE id=ANY($1::uuid[])),
    'proposals',(SELECT jsonb_agg(to_jsonb(p) ORDER BY source_id) FROM wf_canonical_staging.mariadb_normalized_proposals p WHERE source_system=$2),
    'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY raw_row_id) FROM wf_canonical_staging.normalization_job_members_v2 m WHERE job_name=$2),
    'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY materialization_hash) FROM wf_canonical_staging.materialized_single_versions_v2 v WHERE materialization_hash=ANY($3::text[]))) result`,[records.map(x=>x.id),job,old.map(x=>x.materialization_hash)]);
   const beforeEvidence=await evidence();
   const snapshotEvidence=()=>value(`SELECT jsonb_agg(to_jsonb(m) ORDER BY snapshot_id,listing_id) result FROM wf_canonical_staging.keyset_snapshot_members m WHERE snapshot_id=ANY($1::uuid[])`,[[oldBatch.trading_snapshot,oldBatch.price_snapshot]]);
   const oldSnapshotMembers=await snapshotEvidence();
   await db.query(source.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   const currencyProposal=normalized.find(x=>x.raw_row_id===records[6].id).proposal;
   assert.equal(currencyProposal.reference,'HKD328K');
   assert.equal((await value('SELECT wf_canonical_staging.resolve_reviewed_source_identity_v2($1,$2) result',[records[6].id,currencyProposal.proposal_hash])).outcome,'ELIGIBLE');
   await db.query(currencySource.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   const currencyHeld=await value('SELECT wf_canonical_staging.resolve_reviewed_source_identity_v2($1,$2) result',[records[6].id,currencyProposal.proposal_hash]);
   assert.equal(currencyHeld.outcome,'REVIEW');assert.ok(currencyHeld.reasons.includes('REFERENCE_IS_CURRENCY_AMOUNT'));assert.equal(currencyHeld.resolution_hash,null);
   assert.equal((await materialize(records[6].id)).outcome,'REVIEW');
   const guardDefinition=await value("SELECT pg_get_functiondef('wf_canonical_staging.resolve_reviewed_source_identity_v2(uuid,text)'::regprocedure) result");
   const guardPattern=guardDefinition.match(/btrim\(p\.proposal_document->>'reference'\) ~\* '([^']+)'/)[1];
   for(const reference of ['HKD328K','hkd327k','HKD 328 K','328K HKD','USD12500','12500 USD','EUR:12,500.00','SGD$45000','HKD322K','HKD325K','HKD366K'])assert.equal(await value('SELECT $1::text ~* $2 result',[reference,guardPattern]),true,reference);
   for(const reference of ['116759SARO','116759SARU','SARO','SARU','MYRTILLE','116515g','326935','5261 r','5164/A'])assert.equal(await value('SELECT $1::text ~* $2 result',[reference,guardPattern]),false,reference);
   const unreviewed=await value('SELECT wf_canonical_staging.resolve_reviewed_source_identity_v2($1,$2) result',[records[1].id,normalized.find(x=>x.raw_row_id===records[1].id).proposal.proposal_hash]);
   assert.equal(unreviewed.outcome,'REVIEW');assert.ok(unreviewed.reasons.includes('REFERENCE_IS_YEAR_RANGE'));assert.equal(unreviewed.resolution_hash,null);
   const unreviewedMaterialization=await materialize(records[1].id);assert.equal(unreviewedMaterialization.outcome,'REVIEW');
   assert.equal(await value("SELECT has_table_privilege('service_role','wf_canonical_staging.reviewed_source_identity_resolutions_v2','SELECT,INSERT,UPDATE,DELETE') result"),false);
   const expectError=async(fn,message)=>{await db.query('SAVEPOINT expected_error');try{await fn();assert.fail('Expected '+message);}catch(e){assert.equal(e.message,message);}finally{await db.query('ROLLBACK TO SAVEPOINT expected_error');await db.query('RELEASE SAVEPOINT expected_error');}};
   const documents=[];
   for(const i of [0,1,2,3,4,6]){
    const r=records[i],p=original.find(x=>x.document.raw_message_id===r.id).document,n=normalized.find(x=>x.raw_row_id===r.id);
    documents.push({contract:'WF_REVIEWED_SOURCE_IDENTITY_V1',raw_row_id:r.id,source_hash:r.hash,proposal_hash:n.proposal.proposal_hash,
     source_text_sha256:sha(r.description),expected_brand:p.brand,expected_model:p.model,expected_reference:p.reference,
     approved_outcome:fixtures[i].approved?'ELIGIBLE':'REVIEW',approved_reference:fixtures[i].approved,reason:fixtures[i].approved?'UNIQUE_EXACT_SOURCE_REFERENCE':'SOURCE_SINGLE_IDENTITY_REQUIRES_REVIEW',review_manifest_sha256:sha('synthetic-reviewed-manifest')});
   }
   await expectError(()=>value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[{...documents[0],approved_reference:'26334'}]),'reviewed_identity_reference_not_source_exact');
   await expectError(()=>value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[{...documents[0],approved_reference:'2025/26'}]),'reviewed_identity_reference_not_source_exact');
   await expectError(()=>value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[{...documents[5],approved_reference:'HKD328K'}]),'reviewed_identity_reference_not_source_exact');
   await expectError(()=>value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[{...documents[0],source_text_sha256:sha('changed')}]),'reviewed_identity_evidence_changed');
   for(const d of documents){const a=await value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[d]);assert.equal(a.outcome,d.approved_outcome);assert.deepEqual(await value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[d]),a);}
   await expectError(()=>value('SELECT wf_canonical_staging.record_reviewed_source_identity_v2($1) result',[{...documents[0],reason:'CHANGED'}]),'reviewed_identity_replay_changed');
   await expectError(async()=>value('SELECT public.publish_materialized_batch_v2($1,$2,$3,true) result',[job+'-STALE',await revision(),[old[0].materialization_hash]]),'publication_source_identity_requires_review');
   const changed=[];for(const i of [0,1,2,3,4,6])changed.push(await materialize(records[i].id));assert.deepEqual(changed.map(x=>x.outcome),['ELIGIBLE','REVIEW','ELIGIBLE','ELIGIBLE','REVIEW','ELIGIBLE']);
   assert.deepEqual(await materialize(records[5].id),{...old[5],inserted:0,identical:1});
   const corrected=await value('SELECT public.publish_materialized_batch_v2($1,$2,$3,true) result',[job+'-CORRECTED',await revision(),changed.filter(x=>x.outcome==='ELIGIBLE').map(x=>x.materialization_hash)]);assert.equal(corrected.changed,4);assert.equal(corrected.inserted,0);
   const holds=changed.filter(x=>x.outcome==='REVIEW').map(x=>{const p=original.find(y=>y.document.raw_message_id===x.raw_row_id);return {listing_id:p.document.listing_id,materialization_hash:x.materialization_hash,expected_publication_sha256:p.hash};});
   await expectError(async()=>value('SELECT public.withdraw_reviewed_identity_batch_v2($1,$2,$3,true) result',[job+'-BADHOLD',await revision(),JSON.stringify([{...holds[0],expected_publication_sha256:sha('wrong')}])]),'identity_withdrawal_evidence_changed');
   const holdRevision=await revision(),withdraw=await value('SELECT public.withdraw_reviewed_identity_batch_v2($1,$2,$3,true) result',[job+'-HOLDS',holdRevision,JSON.stringify(holds)]);assert.equal(withdraw.withdrawn,2);assert.equal(withdraw.after_count,before+5);assert.notEqual(String(withdraw.revision),String(holdRevision));
   assert.equal((await value('SELECT public.withdraw_reviewed_identity_batch_v2($1,$2,$3,true) result',[job+'-HOLDS',holdRevision,JSON.stringify(holds)])).replayed,true);
   await db.query('SET CONSTRAINTS ALL IMMEDIATE');
   assert.deepEqual(await evidence(),beforeEvidence);assert.deepEqual(await snapshotEvidence(),oldSnapshotMembers);
   const final=(await db.query('SELECT to_jsonb(c) document FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c WHERE raw_message_id=ANY($1::text[])',[records.map(x=>x.id)])).rows.map(x=>x.document);
   for(let i=0;i<7;i++){const r=final.find(x=>x.raw_message_id===records[i].id);if([1,4].includes(i)){assert.equal(r,undefined);continue;}const oldDoc=original.find(x=>x.document.raw_message_id===records[i].id).document;if(i===5){assert.deepEqual(r,oldDoc);continue;}assert.equal(r.reference,fixtures[i].approved);for(const k of Object.keys(oldDoc).filter(k=>!['reference','review_status','review_reasons'].includes(k)))assert.deepEqual(r[k],oldDoc[k],k);}
   const snapshots=(await db.query('SELECT surface,member_count,publication_revision FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=ANY($1::uuid[])',[[withdraw.trading_snapshot,withdraw.price_snapshot]])).rows;assert.equal(snapshots.length,2);assert.ok(snapshots.every(x=>String(x.publication_revision)===String(withdraw.revision)));assert.equal(Number(snapshots.find(x=>x.surface==='trading_floor').member_count),before+5);
   const browse=await value('SELECT public.get_canary_snapshot_browse_v1($1,$2) result',[withdraw.trading_snapshot,'trading_floor']);
   assert.ok(browse.brands.find(b=>b.brand==='Rolex')?.listing_count>=1);assert.ok(!browse.brands.some(b=>b.brand==='Datejust'));
   const sourcePayload=await value('SELECT payload result FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 AND listing_id=$2',[withdraw.trading_snapshot,original.find(r=>r.document.raw_message_id===records[0].id).document.listing_id]);assert.equal(sourcePayload.brand,'Datejust');assert.equal(sourcePayload.reference,'126334');
   const aliasFiltered=(await db.query("SELECT payload FROM public.get_trading_floor_discovery_keyset_v1($1,100,p_brand=>'Rolex',p_query=>'126334')",[withdraw.trading_snapshot])).rows;
   assert.ok(aliasFiltered.some(r=>r.payload.listing_id===sourcePayload.listing_id));
   assert.equal(await value('SELECT count(*)::int result FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=ANY($1::uuid[]) AND expires_at>now()',[[oldBatch.trading_snapshot,oldBatch.price_snapshot]]),0);
   const restored=await value('SELECT public.rollback_materialized_batch_v2($1,$2) result',[job+'-HOLDS',await revision()]);assert.equal(restored.restored_updates,2);
   await value('SELECT public.rollback_materialized_batch_v2($1,$2) result',[job+'-CORRECTED',await revision()]);
   const restoredDocs=(await db.query('SELECT to_jsonb(c) document,encode(sha256(convert_to(to_jsonb(c)::text,\'UTF8\')),\'hex\') hash FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c WHERE raw_message_id=ANY($1::text[]) ORDER BY listing_id',[records.map(x=>x.id)])).rows;assert.deepEqual(restoredDocs,original);
   await value('SELECT public.rollback_materialized_batch_v2($1,$2) result',[job+'-OLD',await revision()]);assert.equal(await count(),before);
   await db.query('ROLLBACK');assert.equal(await count(),before);
   report.databases.push({container,database,status:'PASS',fixtures:7,corrected:4,withdrawn_review:2,unrelated_unchanged:1,
    checks:['actual normalizer and materializer with immutable proposals','combined Discovery/case groups/brand alias/identity/currency migrations','HKD328K originally eligible becomes REVIEW without sidecar; reviewed exact 116505 publishes','currency amount references rejected as approved identities; suffix/prefix/case/separator variants guarded','legitimate SARO/SARU/MYRTILLE and exact watch references are outside currency pattern','Datejust correction appears under Rolex browse and Discovery filter; frozen source brand remains Datejust','shared exact reviewed reference and source hash proof','whitespace and punctuation preserved','unreviewed year ranges held; approved exact reviewed references publish','year ranges, substring tokens, changed source, stale materializations rejected','four changed publication records and two exact-ID withdrawals','counts/revision and both current snapshots reconciled','raw/proposal/member/prior versions and frozen snapshot members unchanged','owner-only sidecar; identical replay and changed replay refusal','exact before/after rollback ledger restores all affected records']});
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{report.status='FAIL';report.error=e.message;report.stack=e.stack;fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
