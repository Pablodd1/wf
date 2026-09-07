'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const lit=s=>s==null?'NULL':"'"+String(s).replaceAll("'","''")+"'";
const repo=path.resolve(__dirname,'../..'),report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:10*1024*1024}).trim();
 const m=JSON.parse(sql("SELECT jsonb_build_object('hash',materialization_hash,'job',job_name,'raw_id',raw_row_id,'listing_id',document->>'listing_id') FROM wf_canonical_staging.materialized_single_versions_v2 WHERE job_name LIKE 'SYNTHETIC-VERSION-%' AND outcome='ELIGIBLE' LIMIT 1;"));
 const before=sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;'),batch='SYNTHETIC-VERSION-PUBLISH-'+crypto.randomUUID();
 const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20260909090000_snapshot_bound_publication.sql'),'utf8').replace(/COMMIT;\s*$/,'');
 const publish="public.publish_materialized_batch_v2("+lit(batch)+",(SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton),ARRAY["+lit(m.hash)+"],true)";
 let script=migration+'CREATE SCHEMA IF NOT EXISTS wf_disposable_legacy;';
 for(const change of ["UPDATE wf_canonical_staging.immutable_source_snapshots SET sealed=false WHERE manifest_sha256=(SELECT immutable_snapshot_sha256 FROM wf_canonical_staging.normalization_jobs_v2 WHERE job_name="+lit(m.job)+')',"UPDATE wf_canonical_staging.normalization_jobs_v2 SET source_database='wrong' WHERE job_name="+lit(m.job)]){
  script+='SAVEPOINT rejection;'+change+';DO $test$ BEGIN BEGIN PERFORM '+publish+"; RAISE EXCEPTION 'expected_publication_refusal_missing'; EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM<>'publication_source_versions_conflict' THEN RAISE; END IF; END; END $test$;ROLLBACK TO rejection;";
 }
 script+='SELECT '+publish+';';
 script+='SELECT jsonb_build_object(\'published_selected\',count(*)) FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id='+lit(m.listing_id)+';';
 script+='SELECT public.rollback_materialized_batch_v2('+lit(batch)+',(SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton));ROLLBACK;';
 const result=sql(script).split('\n').filter(s=>s.startsWith('{')).map(JSON.parse);
 assert.equal(result[0].inserted,1);assert.equal(result[0].held,0);assert.equal(result[1].published_selected,1);assert.equal(result[2].state,'ROLLED_BACK');
 assert.equal(sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;'),before);
 report.databases.push({container,database,status:'PASS',checks:['Exact selected sealed-snapshot member publishes despite retained historical version','Unsealed snapshot or changed source scope rejected before publication','Actual owner publication and rollback execute','Existing public data and both immutable snapshot surfaces restored by rollback']});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
