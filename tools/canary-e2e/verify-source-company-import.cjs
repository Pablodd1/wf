'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Client}=require('./test-dependencies.cjs')('pg');
const {stableJson,sha256}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {importReviewedSourceCompanies,companyUuid}=require('../mariadb-live/reviewed-source-company-import.cjs');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL}),report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false};
 await db.connect();try{
  const before=(await db.query('SELECT count(*)::int n FROM public.dealers')).rows[0].n;
  const migration=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20260909080000_complete_source_company_identity.sql'),'utf8');
  await db.query(migration.replace(/COMMIT;\s*$/,''));
  const company={id:999999999,name:'SYNTHETIC IMPORT COMPANY',phone:'1999'+crypto.randomInt(100000000,999999999),status:'verified',is_verified:1,is_active:1,is_banned:0,is_suspended:0};
  const census={contract:'WF_SOURCE_COMPANY_IDENTITY_FIELD_SNAPSHOT_V1',source_database:'thecollective',source_table:'companies',capture_scope:'COMPLETE_TABLE',expected_rows:1,companies:[company],observed_at:'2026-09-07T00:00:00Z'};
  const bytes=Buffer.from(stableJson(census)),hash=sha256(bytes),payload={id:'SYNTHETIC-IMPORT-'+crypto.randomUUID(),company_id:company.id,from_number:company.phone,description:'SYNTHETIC WTS Rolex 126610LN USD 12000'},text=stableJson(payload),sourceHash=sha256(text);
  const raw=(await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source)
   VALUES('OceanDigital MariaDB','thecollective_inventory','auctions',$1,$1,$2,$2,$3::text,$3::text::jsonb,$4,'description') RETURNING id`,[payload.id,sourceHash,text,payload.description])).rows[0];
  const selected={company_id:String(company.id),phone:company.phone,company_fields_sha256:sha256(stableJson(company)),source_system:'OceanDigital MariaDB',source_database:'thecollective_inventory',source_table:'auctions',first_source_id:payload.id,first_source_hash:sourceHash};
  const options={snapshotBytes:bytes,expectedSnapshotSha256:hash,identities:[selected]};
  const first=await importReviewedSourceCompanies(db,options);assert.equal(first.created_dealers,1);
  const replay=await importReviewedSourceCompanies(db,options);assert.equal(replay.created_dealers,0);assert.equal(replay.reused_dealers,1);
  const dealer=(await db.query('SELECT * FROM public.dealers WHERE id=$1',[companyUuid(String(company.id))])).rows[0];
  assert.equal(dealer.rating,null);assert.equal(dealer.review_count,0);assert.equal(dealer.contact_consent,false);assert.equal(dealer.display_name,company.name);
  assert.equal(dealer.metadata.evidence_raw_row_id,raw.id);assert.equal(dealer.metadata.evidence_source_hash,sourceHash);assert.equal(dealer.metadata.company_snapshot_sha256,hash);
  for(const change of [{phone:'1999000000000'},{first_source_hash:'f'.repeat(64)},{company_fields_sha256:'f'.repeat(64)}])await assert.rejects(importReviewedSourceCompanies(db,{...options,identities:[{...selected,...change}]}),/^Error: COMPANY_IMPORT_/);
  await assert.rejects(importReviewedSourceCompanies(db,{...options,identities:[selected,selected]}),/COMPANY_IMPORT_DUPLICATE_IDENTITY/);
  const partial=Buffer.from(stableJson({...census,capture_scope:'PARTIAL'}));await assert.rejects(importReviewedSourceCompanies(db,{...options,snapshotBytes:partial,expectedSnapshotSha256:sha256(partial)}),/COMPANY_IMPORT_BOUNDARY_INVALID/);
  await db.query('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int n FROM public.dealers')).rows[0].n,before);
  report.status='PASS';report.checks=['Actual owner importer requires complete census and exact stored raw content','One source-backed dealer and phone identity inserted; replay is a no-op','No rating, review count or contact consent inferred','Changed source/hash/company proof, duplicate identity and partial census rejected','Rollback restores original public dealer count'];
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error('SOURCE_COMPANY_IMPORT_TEST_FAILED',e.code||e.name,e.message?.slice(0,180));process.exitCode=1;});
