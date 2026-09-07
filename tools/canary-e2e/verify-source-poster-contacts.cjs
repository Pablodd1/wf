'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');const {stableJson,sha256}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {importReviewedSourceCompanies,companyUuid}=require('../mariadb-live/reviewed-source-company-import.cjs');
async function main(){const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0],env=Object.fromEntries(info.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
 const binding=info.NetworkSettings.Ports['5432/tcp']?.[0],network=info.NetworkSettings.Networks['wf-final-disposable'];assert.ok(network);
 const host=binding?'127.0.0.1':network.IPAddress,port=binding?Number(binding.HostPort):5432;assert.ok(host==='127.0.0.1'||/^172\.18\.0\.[0-9]+$/.test(host));assert.ok(env.POSTGRES_PASSWORD);
 const db=new Client({host,port,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
 try{
  await db.query('BEGIN');const before=(await db.query('SELECT count(*)::int n FROM public.dealers')).rows[0].n;
  // Replay production's exact prerequisites inside this disposable transaction.
  for(const name of ['20260909080000_complete_source_company_identity.sql','20260909130000_materialized_source_text_dealer_lineage.sql','20260909180000_exact_source_poster_contacts.sql']){
   const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/'+name),'utf8').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');await db.query(migration);
  }
  const company={id:999999991,name:'SYNTHETIC SOURCE POSTER',phone:'1999'+crypto.randomInt(100000000,999999999),status:'unverified',is_verified:0,is_active:1,is_banned:0,is_suspended:0};
  const census={contract:'WF_SOURCE_COMPANY_IDENTITY_FIELD_SNAPSHOT_V1',source_database:'thecollective',source_table:'companies',capture_scope:'COMPLETE_TABLE',expected_rows:1,companies:[company],observed_at:'2026-09-07T00:00:00Z'};
  const bytes=Buffer.from(stableJson(census)),hash=sha256(bytes),payload={id:'SYNTHETIC-POSTER-'+crypto.randomUUID(),company_id:company.id,from_number:company.phone,description:'SYNTHETIC WTS Rolex 126610LN USD 12000'},text=stableJson(payload),sourceHash=sha256(text);
  const raw=(await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source)
   VALUES('OceanDigital MariaDB','thecollective_inventory','auctions',$1,$1,$2,$2,$3::text,$3::text::jsonb,$4,'description') RETURNING id`,[payload.id,sourceHash,text,payload.description])).rows[0];
  const selected={company_id:String(company.id),phone:company.phone,company_fields_sha256:sha256(stableJson(company)),source_system:'OceanDigital MariaDB',source_database:'thecollective_inventory',source_table:'auctions',first_source_id:payload.id,first_source_hash:sourceHash};
  const options={snapshotBytes:bytes,expectedSnapshotSha256:hash,identities:[selected]};
  await assert.rejects(importReviewedSourceCompanies(db,options),/COMPANY_IMPORT_SOURCE_PROOF_MISMATCH/);
  const permission=Buffer.from(stableJson({contract:'WF_OWNER_ATTESTED_POSTER_CONTACT_PERMISSION_V1',permission_inferred:false,scope:'All exact source-linked posters of eligible single listings',company_snapshot_sha256:hash,recorded_at:'2026-09-07T00:00:00Z',owner_statement:'SYNTHETIC TEST AUTHORIZATION',purpose:'Inquiries about the original posted item'}));
  options.sourcePosterPermission={bytes:permission,sha256:sha256(permission)};
  await assert.rejects(importReviewedSourceCompanies(db,{...options,sourcePosterPermission:{bytes:permission,sha256:'0'.repeat(64)}}),/PERMISSION_HASH_MISMATCH/);
  const imported=await importReviewedSourceCompanies(db,options);assert.equal(imported.created_dealers,1);assert.equal((await importReviewedSourceCompanies(db,options)).reused_dealers,1);
  const dealerId=companyUuid(String(company.id)),dealer=(await db.query('SELECT * FROM public.dealers WHERE id=$1',[dealerId])).rows[0];
  assert.equal(dealer.status,'UNVERIFIED');assert.equal(dealer.verified_at,null);assert.equal(dealer.rating,null);assert.equal(dealer.review_count,0);assert.equal(dealer.contact_consent,true);assert.equal(dealer.metadata.contact_permission_evidence.sha256,sha256(permission));
  const doc=(await db.query("SELECT document FROM wf_canonical_staging.materialized_single_versions_v2 WHERE job_name LIKE 'SYNTHETIC-BATCH-500-%' AND outcome='ELIGIBLE' LIMIT 1")).rows[0].document;
  Object.assign(doc,{listing_id:'SYNTHETIC-POSTER-'+crypto.randomUUID(),raw_message_id:raw.id,source_id:payload.id,source_hash:sourceHash,raw_message_text:payload.description});
  await db.query('INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2 SELECT (jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,$1)).*',[doc]);
  const linked=(await db.query('SELECT public.reconcile_v2_listing_dealers($1) result',[[doc.listing_id]])).rows[0].result;assert.equal(linked.applied,1);
  const contact=async()=>(await db.query("SELECT public.get_v2_listing_contact($1,'trading-floor') result",[doc.listing_id])).rows[0].result;
  const valid=await contact();assert.equal(valid.contact_available,true);assert.equal(valid.contact_phone,company.phone);assert.equal(valid.dealer_rating,null);
  const profile=(await db.query('SELECT public.get_approved_dealer_profile_v2($1,50,null,null) result',[dealerId])).rows[0].result;assert.equal(profile.dealer.source_system,'WATCHFACTS_SOURCE_POSTERS');assert.equal(profile.dealer.rating,null);assert.equal(profile.listing_total,1);assert.equal(profile.stats.verified_contact_info.phone,'+'+company.phone);
  const directory=(await db.query('SELECT public.get_approved_dealer_directory($1,false,100,0) result',[company.name])).rows[0].result;assert.equal(directory.total,1);assert.equal(directory.rated_total,0);assert.equal(directory.dealers[0].source_system,'WATCHFACTS_SOURCE_POSTERS');
  for(const change of [{company_id:'2'},{source_database:'wrong'},{company_snapshot_sha256:'f'.repeat(64)}]){
   await db.query('SAVEPOINT wrong_identity');await db.query('UPDATE public.dealer_source_identities SET metadata=metadata||$2::jsonb WHERE dealer_id=$1',[dealerId,change]);assert.equal((await contact()).contact_available,false);await db.query('ROLLBACK TO SAVEPOINT wrong_identity');
  }
  await db.query('SAVEPOINT no_consent');await db.query('UPDATE public.dealers SET contact_consent=false WHERE id=$1',[dealerId]);assert.equal((await contact()).contact_available,false);await db.query('ROLLBACK TO SAVEPOINT no_consent');
  await db.query('SAVEPOINT suspended');await db.query("UPDATE public.dealers SET status='SUSPENDED' WHERE id=$1",[dealerId]);assert.equal((await contact()).contact_available,false);assert.equal((await db.query('SELECT public.get_approved_dealer_profile($1) result',[dealerId])).rows[0].result,null);await db.query('ROLLBACK TO SAVEPOINT suspended');
  const randomUnverified=crypto.randomUUID();await db.query("INSERT INTO public.dealers(id,display_name,status,contact_consent) VALUES($1,'SYNTHETIC UNREVIEWED','UNVERIFIED',true)",[randomUnverified]);assert.equal((await db.query('SELECT public.get_approved_dealer_profile($1) result',[randomUnverified])).rows[0].result,null);
  for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.get_v2_listing_contact(text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  await db.query('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int n FROM public.dealers')).rows[0].n,before);
  report.databases.push({container,database,status:'PASS',checks:['Actual importer requires exact source phone/company and hash-bound owner authorization','Source poster remains UNVERIFIED with no invented review/rating/verification date','Exact published lineage enables contact and profile/directory activity','Wrong company, scope, snapshot, missing permission, consent revocation and suspension refuse contact','Ordinary unverified dealers remain private; direct customer contact RPC denied','Replay is a no-op and all synthetic mutations rolled back']});
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}}
 report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error('SOURCE_POSTER_CONTACT_TEST_FAILED',e.code||e.name,e.message?.slice(0,200));process.exitCode=1;});
