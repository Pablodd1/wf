'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const report={status:'RUNNING',synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
 const job='SYNTHETIC-CLAIM-SEEK-'+crypto.randomUUID(),lease=crypto.randomUUID(),second=crypto.randomUUID(),third=crypto.randomUUID();
 const records=Array.from({length:12},()=>{const id=crypto.randomUUID(),description='WTS Rolex 126610LN USD 12500',text=stableJson({id,description,synthetic_fixture:true});return {id,text,description,hash:sha(text)};}).sort((a,b)=>a.id.localeCompare(b.id));
 sql(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
 SELECT id::uuid,${lit(job)},'disposable','auctions',id,id,'2026-09-01','2026-09-02',description,'description',hash,text,text::jsonb,hash FROM jsonb_to_recordset(${lit(JSON.stringify(records))}::jsonb) x(id text,text text,hash text,description text);
 INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
 VALUES(${lit(job)},'2026-09-03','zzzz',12,12,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":12}',${lit(sha(job))},now());
 SELECT public.create_frozen_normalization_job_v2(${lit(job)},${lit(job)},${lit(sha(job))},${lit(job)},'disposable','auctions',12);
 SELECT public.claim_normalization_batch_v2(${lit(job)},${lit(lease)},4);`);
 const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909160000_indexed_normalization_claims.sql'),'utf8').replace(/COMMIT;\s*$/,'');
 const claim=l=>'SELECT public.claim_normalization_batch_v2('+[job,l].map(lit).join(',')+',4);';
 let script=migration+`UPDATE wf_canonical_staging.normalization_job_members_v2 SET lease_expires_at=now()-interval '1 second',attempts=CASE WHEN raw_row_id=${lit(records[1].id)}::uuid THEN 3 ELSE attempts END WHERE job_name=${lit(job)} AND raw_row_id=ANY(ARRAY[${[0,1,3].map(i=>lit(records[i].id)+'::uuid').join(',')}]);`;
 script+=claim(second)+claim(second)+claim(third);
 script+='SELECT jsonb_build_object(\'outcomes\',jsonb_agg(jsonb_build_object(\'id\',raw_row_id,\'outcome\',outcome,\'attempts\',attempts,\'lease\',lease_id,\'error\',error_code) ORDER BY raw_row_id)) FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name='+lit(job)+';';
 script+='SELECT public.get_normalization_job_v2('+lit(job)+');ROLLBACK;';
 const lines=sql(script).split('\n'),claims=lines.filter(l=>l.startsWith('[{')).map(JSON.parse);
 assert.equal(claims.length,3);assert.deepEqual(claims[0].map(r=>r.raw_row_id),[0,3,4,5].map(i=>records[i].id));assert.deepEqual(claims[0],claims[1]);assert.deepEqual(claims[2].map(r=>r.raw_row_id),[6,7,8,9].map(i=>records[i].id));
 const objects=lines.filter(l=>l.startsWith('{')).map(JSON.parse),outcomes=objects.find(o=>o.outcomes).outcomes;
 assert.equal(outcomes[1].outcome,'ERROR');assert.equal(outcomes[1].error,'WORKER_RETRY_EXHAUSTED');assert.equal(outcomes[2].lease,lease);assert.equal(outcomes[0].attempts,2);
 const state=objects.at(-1);assert.equal(state.processed_rows,1);assert.equal(state.error_rows,1);
 assert.ok(claims[0].map(normalizeClaim).every(r=>r.proposal.source_hash===records.find(s=>s.id===r.raw_row_id).hash));
 report.databases.push({container,database,status:'PASS',checks:['Global UUID order across pending and expired members preserved','Active lease excluded; exhausted retry durably counted once','Identical lease replay unchanged; concurrent worker leases disjoint','Source-hash-bound normalization inputs unchanged','Migration and synthetic lease mutations rolled back']});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
