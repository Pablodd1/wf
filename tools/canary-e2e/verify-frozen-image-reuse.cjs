'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {stableJson}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {captureSourceImageEvidence}=require('../mariadb-live/source-image-evidence-v2.cjs');
const {run}=require('../mariadb-live/run-frozen-materialization-v2.cjs');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function main(){
const report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
 const json=q=>JSON.parse(sql(q).split('\n').filter(l=>l.startsWith('{')).at(-1));
 const job='SYNTHETIC-IMAGE-REUSE-'+crypto.randomUUID(),workflow=job+'-MAT',lease=crypto.randomUUID();
 const records=Array.from({length:3},()=>{const id=crypto.randomUUID(),p={id,description:'WTS Rolex 126610LN USD 12500',front_image:'synthetic-missing.jpg',synthetic_fixture:true},text=stableJson(p);return {id,text,hash:sha(text),description:p.description};});
 sql(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash)
 SELECT id::uuid,${lit(job)},'disposable','auctions',id,id,'2026-09-01','2026-09-02',description,'description',hash,text,text::jsonb,hash FROM jsonb_to_recordset(${lit(JSON.stringify(records))}::jsonb) x(id text,text text,hash text,description text);`);
 const raw=i=>json('SELECT to_jsonb(r) FROM wf_canonical_staging.mariadb_raw_source_rows r WHERE id='+lit(records[i].id)+';');
 const capture=raw=>captureSourceImageEvidence(raw,{fetchImpl:async()=>new Response('',{status:404,headers:{'content-type':'text/plain'}})});
 const stage=p=>sql('SELECT public.stage_source_image_evidence_v2('+[JSON.stringify(p.document),p.canonical_json,p.evidence_hash].map(lit).join(',')+');');
 const older=await capture(raw(0));stage(older.proof);
 const setup=`INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
 VALUES(${lit(job)},'2026-09-03','zzzz',3,3,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":3}',${lit(sha(job))},now());
 SELECT public.create_frozen_normalization_job_v2(${lit(job)},${lit(job)},${lit(sha(job))},${lit(job)},'disposable','auctions',3);
 SELECT public.claim_normalization_batch_v2(${lit(job)},${lit(lease)},3);`;
 const claims=JSON.parse(sql(setup).split('\n').find(l=>l.startsWith('[{'))),results=claims.map(normalizeClaim);
 sql('SELECT public.complete_normalization_batch_v2('+[job,lease,JSON.stringify(results)].map(lit).join(',')+');');
 const fresh=await capture(raw(1));stage(fresh.proof);
 sql('SELECT public.create_materialization_workflow_v2('+[workflow,job].map(lit).join(',')+',NULL);');
 const query='SELECT public.read_materialization_workflow_batch_v2('+lit(workflow)+',3);';
 assert.ok(json(query).members.every(m=>m.existing_image===null));
 const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909150000_reuse_frozen_run_image_receipts.sql'),'utf8').replace(/COMMIT;\s*$/,'');
 const next=json(migration+query+'ROLLBACK;');assert.equal(next.members.length,3);
 assert.equal(next.members.find(m=>m.raw_row_id===records[0].id).existing_image,null);
 assert.equal(next.members.find(m=>m.raw_row_id===records[1].id).existing_image.evidence_hash,fresh.proof.evidence_hash);
 assert.equal(next.members.find(m=>m.raw_row_id===records[2].id).existing_image,null);
 let probes=0,stages=0;
 await run({jobName:workflow,batchSize:3,maxBatches:1,captureImage:async r=>{probes++;return capture(r);},rpc:async(name,args)=>{
  if(name==='read_materialization_workflow_batch_v2')return next;
  if(name==='stage_source_image_evidence_v2'){stages++;return {};}
  if(name==='commit_materialization_workflow_batch_v2'){assert.equal(args.p_members.length,3);assert.equal(args.p_members.find(m=>m.raw_row_id===records[1].id).image_evidence_hash,fresh.proof.evidence_hash);return {job:{complete:true}};}
  throw new Error('UNEXPECTED_RPC');
 }});assert.equal(probes,2);assert.equal(stages,2);
 for(const role of ['anon','authenticated'])assert.equal(sql("SELECT has_function_privilege("+lit(role)+",'public.read_materialization_workflow_batch_v2(text,integer)','EXECUTE');"),'f');
 report.databases.push({container,database,status:'PASS',same_frozen_run_receipt_reused:1,older_or_other_raw_receipts_rejected:2,worker_probes_saved:1,production_publication:false});
}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
