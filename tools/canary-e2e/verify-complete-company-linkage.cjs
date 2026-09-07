'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const repo=path.resolve(__dirname,'../..'),hash=s=>crypto.createHash('sha256').update(s).digest('hex'),lit=s=>s==null?'NULL':"'"+String(s).replaceAll("'","''")+"'";
const report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:5*1024*1024}).trim();
 const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20260909080000_complete_source_company_identity.sql'),'utf8');
 // One transaction includes the exact forward migration and all synthetic
 // adversarial fixtures. Rollback leaves the disposable public set unchanged.
 const doc=JSON.parse(sql("SELECT document FROM wf_canonical_staging.materialized_single_versions_v2 WHERE job_name LIKE 'SYNTHETIC-BATCH-500-%' AND outcome='ELIGIBLE' LIMIT 1;"));
 const rawId=crypto.randomUUID(),dealer=crypto.randomUUID(),scope='OceanDigital MariaDB',phone='1999'+crypto.randomInt(100000000,999999999);
 const payload={id:'SYNTHETIC-COMPANY-'+crypto.randomUUID(),company_id:1,from_number:phone,description:'SYNTHETIC WTS Rolex 126610LN USD 12000'};
 const text=stableJson(payload),sha=hash(text);Object.assign(doc,{listing_id:'SYNTHETIC-COMPANY-'+crypto.randomUUID(),raw_message_id:rawId,source_id:payload.id,source_hash:sha,raw_message_text:payload.description});
 const company={id:1,name:'SYNTHETIC SOURCE COMPANY',phone,status:'verified',is_verified:1,is_active:1,is_banned:0,is_suspended:0};
 const census={contract:'WF_SOURCE_COMPANY_IDENTITY_FIELD_SNAPSHOT_V1',source_database:'thecollective',source_table:'companies',capture_scope:'COMPLETE_TABLE',expected_rows:1,companies:[company],observed_at:'2026-09-07T00:00:00Z'},canonical=stableJson(census),snapshotSha=hash(canonical);
 const metadata={contract:'WF_COMPLETE_SOURCE_COMPANY_IDENTITY_V1',company_id:'1',source_system:scope,source_database:'thecollective_inventory',source_table:'auctions',company_snapshot_sha256:snapshotSha};
 const resolve='SELECT wf_canonical_staging.resolve_v2_source_dealer('+lit(doc.listing_id)+');';
 let script=migration.replace(/COMMIT;\s*$/,'');
 script+='INSERT INTO wf_canonical_staging.source_company_identity_snapshots_v2(snapshot_sha256,canonical_text,document) VALUES('+[snapshotSha,canonical,canonical].map(lit).join(',')+');';
 script+='INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source) VALUES('+[rawId,scope,'thecollective_inventory','auctions',payload.id,payload.id,sha,sha,text,text,payload.description,'description'].map(lit).join(',')+');';
 script+='INSERT INTO public.dealers(id,display_name,status,contact_consent) VALUES('+[dealer,company.name,'VERIFIED',false].map(lit).join(',')+');';
 script+='INSERT INTO public.dealer_source_identities(dealer_id,source_system,source_identity,identity_type,verification_status,metadata) VALUES('+[dealer,'WF_VERIFIED_SOURCE_COMPANY_V1',phone,'PHONE','VERIFIED',JSON.stringify(metadata)].map(lit).join(',')+');';
 script+='INSERT INTO wf_canonical_staging.mariadb_canary_published_listings_v2 SELECT (jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,'+lit(JSON.stringify(doc))+')).*;'+resolve;
 for(const changes of [{company_id:'2'},{source_database:'wrong'},{company_snapshot_sha256:'f'.repeat(64)}]){
  script+='UPDATE public.dealer_source_identities SET metadata='+lit(JSON.stringify({...metadata,...changes}))+' WHERE dealer_id='+lit(dealer)+';'+resolve;
 }
 script+='UPDATE public.dealer_source_identities SET metadata='+lit(JSON.stringify(metadata))+' WHERE dealer_id='+lit(dealer)+';';
 script+='UPDATE wf_canonical_staging.mariadb_canary_published_listings_v2 SET raw_message_id='+lit(crypto.randomUUID())+' WHERE listing_id='+lit(doc.listing_id)+';'+resolve;
 for(const role of ['anon','authenticated','service_role'])script+="SELECT jsonb_build_object('role',"+lit(role)+",'allowed',has_table_privilege("+lit(role)+",'wf_canonical_staging.source_company_identity_snapshots_v2','SELECT'));";
 script+='ROLLBACK;';
 const result=sql(script).split('\n').filter(x=>x.startsWith('{')).map(JSON.parse);
 assert.equal(result[0].reason,'EXACT_VERIFIED_PHONE');assert.equal(result[0].dealer_id,dealer);
 for(let i=1;i<=3;i++)assert.equal(result[i].reason,'VERIFIED_DEALER_NOT_FOUND');
 assert.equal(result[4].reason,'SOURCE_CONTENT_UNVERIFIED');
 for(const r of result.slice(5))assert.equal(r.allowed,false);
 report.databases.push({container,database,status:'PASS',checks:['Complete authenticated company snapshot is private and hash-bound','Exact company ID, poster phone, raw UUID, source hash and scope link the dealer','Wrong company, scope, snapshot or nonexistent exact raw UUID fail closed','No contact consent or reviews synthesized','All synthetic mutations rolled back; customer and service roles cannot read company census']});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
