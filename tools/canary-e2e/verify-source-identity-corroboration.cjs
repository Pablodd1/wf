'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
 const job='SYNTHETIC-IDENTITY-'+crypto.randomUUID(),lease=crypto.randomUUID();
 const payloads=[
  {description:'Ntq Chanel J12',brand:'Hublot',reference:'HUBLOT',model:'Wooden Model'},
  {description:'  WTS Rolex 126610LN black dial USD 12500\n',brand:'Hublot',reference:'HUBLOT',model:'Elegante'},
  {description:'WTS Rolex Submariner 126610LN black dial USD 12500',model:'Submariner'},
  {description:'WTB Rolex white tag',brand:'Rolex',reference:'126610LN'},
  {description:'WTS RM65-01 USD 485000',brand:'Richard Mille',model:'RM65-01'},
 ];
 const records=payloads.map(p=>{const id=crypto.randomUUID(),payload={...p,id,synthetic_fixture:true};const text=stableJson(payload);return {id,text,hash:sha(text),description:p.description};});
 const before=Number(sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;'));
 const setup=`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
 SELECT id::uuid,${lit(job)},'disposable','auctions',id,id,'2026-09-01','2026-09-02',description,'description',hash,text,text::jsonb,hash FROM jsonb_to_recordset(${lit(JSON.stringify(records))}::jsonb) x(id text,text text,hash text,description text);
 INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
 VALUES(${lit(job)},'2026-09-03','zzzz',5,5,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":5}',${lit(sha(job))},now());
 SELECT public.create_frozen_normalization_job_v2(${lit(job)},${lit(job)},${lit(sha(job))},${lit(job)},'disposable','auctions',5);
 SELECT public.claim_normalization_batch_v2(${lit(job)},${lit(lease)},5);`;
 const claims=JSON.parse(sql(setup).split('\n').find(l=>l.startsWith('[{'))),results=claims.map(normalizeClaim);assert.ok(results.every(r=>r.proposal.trading_floor_eligible));
 const materialize=()=>results.map(r=>'SELECT wf_canonical_staging.materialize_single_member_v2('+[job,r.raw_row_id,r.proposal.proposal_hash].map(lit).join(',')+',NULL,NULL);').join('\n');
 let script='BEGIN;CREATE SCHEMA IF NOT EXISTS wf_disposable_legacy;SELECT public.complete_normalization_batch_v2('+[job,lease,JSON.stringify(results)].map(lit).join(',')+');'+materialize();
 script+='SELECT public.publish_materialized_batch_v2('+lit(job+'-OLD')+', (SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton),(SELECT array_agg(materialization_hash) FROM wf_canonical_staging.materialized_single_versions_v2 WHERE job_name='+lit(job)+'),true);';
 script+='CREATE TEMP TABLE stale_identity_versions AS SELECT materialization_hash FROM wf_canonical_staging.materialized_single_versions_v2 WHERE job_name='+lit(job)+';';
 script+='SELECT public.rollback_materialized_batch_v2('+lit(job+'-OLD')+', (SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton));';
 script+=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909140000_corroborate_source_identity_metadata.sql'),'utf8').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
 script+='DO $$ BEGIN BEGIN PERFORM public.publish_materialized_batch_v2('+lit(job+'-STALE')+', (SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton),(SELECT array_agg(materialization_hash) FROM stale_identity_versions),true); RAISE EXCEPTION \'stale_identity_was_published\'; EXCEPTION WHEN SQLSTATE \'22023\' THEN IF SQLERRM<>\'publication_source_identity_requires_review\' THEN RAISE; END IF; END; END $$;';
 script+='CREATE TEMP TABLE corrected_identity_materializations(raw_row_id uuid,materialization_hash text);';
 for(const r of results)script+='INSERT INTO corrected_identity_materializations SELECT '+lit(r.raw_row_id)+'::uuid,result->>\'materialization_hash\' FROM(SELECT wf_canonical_staging.materialize_single_member_v2('+[job,r.raw_row_id,r.proposal.proposal_hash].map(lit).join(',')+',NULL,NULL) result)x;';
 script+='SELECT public.publish_materialized_batch_v2('+lit(job+'-CORRECTED')+', (SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton),(SELECT array_agg(materialization_hash) FROM corrected_identity_materializations),true);';
 script+='SELECT jsonb_build_object(\'corrected\',jsonb_agg(jsonb_build_object(\'raw_id\',v.raw_row_id,\'outcome\',v.outcome,\'model\',v.document->\'model\',\'raw\',v.document->\'raw_message_text\',\'source_hash\',v.source_hash,\'reasons\',v.evidence_document->\'reasons\'))) FROM wf_canonical_staging.materialized_single_versions_v2 v JOIN corrected_identity_materializations c USING(materialization_hash);';
 script+='SELECT jsonb_build_object(\'live_count\',count(*)) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;ROLLBACK;';
 const output=sql(script).split('\n').filter(l=>l.startsWith('{')).map(JSON.parse),corrected=output.find(x=>x.corrected).corrected;
 assert.equal(output.find(x=>x.live_count!==undefined).live_count,before+3);
 for(let i=0;i<records.length;i++){const v=corrected.find(x=>x.raw_id===records[i].id);assert.equal(v.source_hash,records[i].hash);assert.equal(v.outcome,[0,3].includes(i)?'REVIEW':'ELIGIBLE');if(v.outcome==='ELIGIBLE')assert.equal(v.raw,records[i].description);else assert.ok(v.reasons.some(r=>/REFERENCE|BRAND/.test(r)));}
 assert.equal(corrected.find(x=>x.raw_id===records[1].id).model,null);assert.equal(corrected.find(x=>x.raw_id===records[2].id).model,'Submariner');assert.equal(corrected.find(x=>x.raw_id===records[4].id).model,'RM65-01');
 assert.equal(Number(sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2;')),before);
 report.databases.push({container,database,status:'PASS',held_conflicting_identities:2,eligible:3,checks:['Actual raw normalization/materialization/publication and reversible correction','Metadata-only conflicting brand/reference held for durable review','Unsupported model omitted; source-corroborated model retained','Exact raw text and hash unchanged; no production contacted; all publication changes rolled back']});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
