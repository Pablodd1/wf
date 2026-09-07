'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:5*1024*1024}).trim();
 const job='SYNTHETIC-TEXT-DEALER-'+crypto.randomUUID(),lease=crypto.randomUUID(),dealer=crypto.randomUUID(),phone='1999'+crypto.randomInt(100000000,999999999),records=[];
 for(const field of ['title','comments']){const id=crypto.randomUUID(),payload={id,[field]:'  WTS Rolex 126610LN black dial USD 12500\n',from_number:phone,from_name:'Synthetic exact source poster',synthetic_fixture:true};const text=stableJson(payload);records.push({id,text,hash:sha(text)});}
 const before=sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;');
 const setup=`BEGIN;INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
 SELECT id::uuid,${lit(job)},'disposable','auctions',id,id,'2026-09-01','2026-09-02',NULL,'description',hash,text,text::jsonb,hash FROM jsonb_to_recordset(${lit(JSON.stringify(records))}::jsonb) x(id text,text text,hash text);
 INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
 VALUES(${lit(job)},'2026-09-03','zzzz',2,2,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":2}',${lit(sha(job))},now());
 SELECT public.create_frozen_normalization_job_v2(${lit(job)},${lit(job)},${lit(sha(job))},${lit(job)},'disposable','auctions',2);
 SELECT public.claim_normalization_batch_v2(${lit(job)},${lit(lease)},2);COMMIT;`;
 const claims=JSON.parse(sql(setup).split('\n').find(l=>l.startsWith('[{'))),results=claims.map(normalizeClaim);assert.ok(results.every(r=>r.proposal.trading_floor_eligible));
 let script='BEGIN;CREATE SCHEMA IF NOT EXISTS wf_disposable_legacy;SELECT public.complete_normalization_batch_v2('+[job,lease,JSON.stringify(results)].map(lit).join(',')+');';
 for(const r of results)script+='SELECT wf_canonical_staging.materialize_single_member_v2('+[job,r.raw_row_id,r.proposal.proposal_hash].map(lit).join(',')+',NULL,NULL);';
 script+='SELECT public.publish_materialized_batch_v2('+lit(job)+',(SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton),(SELECT array_agg(materialization_hash) FROM wf_canonical_staging.materialized_single_versions_v2 WHERE job_name='+lit(job)+'),true);';
 script+='INSERT INTO public.dealers(id,display_name,status,contact_consent) VALUES('+lit(dealer)+",'Synthetic title/comment dealer','VERIFIED',false);";
 script+='INSERT INTO public.dealer_source_identities(dealer_id,source_system,source_identity,identity_type,verification_status) VALUES('+[dealer,job,phone,'PHONE','VERIFIED'].map(lit).join(',')+');';
 const resolved="SELECT jsonb_build_object('reasons',jsonb_agg(wf_canonical_staging.resolve_v2_source_dealer(listing_id)->>'reason' ORDER BY listing_id)) FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE raw_message_id=ANY(ARRAY["+records.map(r=>lit(r.id)).join(',')+']);';
 script+=resolved;
 script+=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909130000_materialized_source_text_dealer_lineage.sql'),'utf8').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
 script+=resolved;
 script+='SAVEPOINT exact_source;UPDATE wf_canonical_staging.mariadb_canary_published_listings_v2 SET raw_message_text=raw_message_text||\' changed\' WHERE raw_message_id=ANY(ARRAY['+records.map(r=>lit(r.id)).join(',')+']);'+resolved+'ROLLBACK TO exact_source;';
 script+='SAVEPOINT exact_material;UPDATE wf_canonical_staging.materialized_single_versions_v2 SET evidence_document=evidence_document||\'{"tampered":true}\'::jsonb WHERE job_name='+lit(job)+';'+resolved+'ROLLBACK TO exact_material;';
 script+='SAVEPOINT exact_member;UPDATE wf_canonical_staging.normalization_job_members_v2 SET proposal_hash='+lit('f'.repeat(64))+' WHERE job_name='+lit(job)+';'+resolved+'ROLLBACK TO exact_member;';
 script+='ROLLBACK;';
 const output=sql(script).split('\n').filter(l=>l.startsWith('{')).map(JSON.parse).filter(r=>r.reasons);
 assert.deepEqual(output[0].reasons,['SOURCE_CONTENT_UNVERIFIED','SOURCE_CONTENT_UNVERIFIED']);assert.deepEqual(output[1].reasons,['EXACT_VERIFIED_PHONE','EXACT_VERIFIED_PHONE']);for(const r of output.slice(2))assert.deepEqual(r.reasons,['SOURCE_CONTENT_UNVERIFIED','SOURCE_CONTENT_UNVERIFIED']);
 assert.equal(sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;'),before);
 report.databases.push({container,database,status:'PASS',checks:['Actual normalization/materialization/publication of title and comments preserves surrounding whitespace','Verified dealer binds to exact materialized raw source field','Changed public text, changed materialization digest or changed frozen proposal fails closed','No consent or reviews added; every public fixture and migration rolled back']});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
