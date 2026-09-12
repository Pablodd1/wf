'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const report={started_at:new Date().toISOString(),status:'RUNNING',synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:40*1024*1024}).trim();
 const job='SYNTHETIC-LINEAR-'+crypto.randomUUID(),lease=crypto.randomUUID(),records=[];
 for(let i=0;i<500;i++){const id=crypto.randomUUID(),payload={id,description:i%5===1?'Interested in Rolex 126610LN':'WTS Rolex 126610LN black dial USD 12500',brand:'Rolex',reference:'126610LN',model:'Submariner',category:'WATCH',is_bundle:i%5===2?1:0,synthetic_fixture:true,unused_source_metadata:'Synthetic retained context. '.repeat(180)};const text=stableJson(payload);records.push({id,source_id:id,text,hash:sha(text)});}
 const before=sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2');
 const setup=`BEGIN;INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
 SELECT id::uuid,${lit(job)},'disposable','auctions',source_id,source_id,'2026-09-01','2026-09-02',text::jsonb->>'description','description',hash,text,text::jsonb,hash FROM jsonb_to_recordset(${lit(JSON.stringify(records))}::jsonb) x(id text,source_id text,text text,hash text);
 INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
 VALUES(${lit(job)},'2026-09-03','zzzz',500,500,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":500}',${lit(sha(job))},now());
 SELECT public.create_frozen_normalization_job_v2(${lit(job)},${lit(job)},${lit(sha(job))},${lit(job)},'disposable','auctions',500);
 SELECT public.claim_normalization_batch_v2(${lit(job)},${lit(lease)},500);COMMIT;`;
 const lines=sql(setup).split('\n');const claims=JSON.parse(lines.find(l=>l.startsWith('[{')));assert.equal(claims.length,500);
 const results=claims.map((r,i)=>i%10===8?{raw_row_id:r.raw_row_id,outcome:'QUARANTINE',error_code:'SYNTHETIC_PROVENANCE_HOLD'}:i%10===9?{raw_row_id:r.raw_row_id,outcome:'ERROR',error_code:'SYNTHETIC_PARSE_ERROR'}:normalizeClaim(r));
 const complete=`SELECT public.complete_normalization_batch_v2(${lit(job)},${lit(lease)},${lit(JSON.stringify(results))}::jsonb);`;
 const outcomeDigest=`SELECT jsonb_build_object('digest',encode(sha256(convert_to(jsonb_agg(jsonb_build_array(raw_row_id,source_hash,outcome,proposal_hash,error_code) ORDER BY raw_row_id)::text,'UTF8')),'hex'),'rows',count(*)) FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=${lit(job)};`;
 const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909120000_linear_normalization_batch_assembly.sql'),'utf8').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
 const variants=[];
 for(const [name,change] of [['original',''],['linear',migration]]){
  const started=Date.now();const output=sql('BEGIN;'+change+complete+complete+outcomeDigest+'ROLLBACK;').split('\n').filter(l=>l.startsWith('{')).map(JSON.parse);
  assert.deepEqual(output[0],output[1],'Lost-response replay must preserve exactly the committed result');
  assert.equal(output[0].processed_rows,500);assert.equal(output[0].error_rows,50);assert.equal(output[0].quarantine_rows,50);assert.equal(output[2].rows,500);
  variants.push({name,elapsed_ms:Date.now()-started,counters:Object.fromEntries(['processed_rows','normalized_rows','review_rows','bundle_rows','quarantine_rows','error_rows','trading_floor_eligible_rows','price_research_eligible_rows'].map(k=>[k,output[0][k]])),member_digest:output[2].digest});
 }
 assert.deepEqual(variants[0].counters,variants[1].counters);assert.equal(variants[0].member_digest,variants[1].member_digest);
 assert.equal(sql('SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2'),before);
 report.databases.push({container,database,status:'PASS',variants,checks:['500 mixed large-source proposals retain exact member hashes and outcomes','NULL proposal quarantine/error members remain accounted for','Identical completion retry has identical result','Both measured completions rolled back; no public mutation']});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
