'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');const {stableJson,sha256}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {run:normalize,normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
const {claimReviewedCanaryMembers}=require('../mariadb-live/claim-reviewed-canary-members.cjs');
const {run:materialize}=require('../mariadb-live/run-frozen-materialization-v2.cjs');
const {createNormalizationPostgresRpc}=require('../mariadb-live/normalization-postgres-rpc.cjs');
async function main(){const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,databases:[]};
for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
 const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0],env=Object.fromEntries(info.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
 const binding=info.NetworkSettings.Ports['5432/tcp']?.[0],network=info.NetworkSettings.Networks['wf-final-disposable'];assert.ok(network);
 const host=binding?'127.0.0.1':network.IPAddress,port=binding?Number(binding.HostPort):5432;assert.ok(host==='127.0.0.1'||/^172\.18\.0\.[0-9]+$/.test(host));assert.ok(env.POSTGRES_PASSWORD);
 const db=new Client({host,port,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
 try{await db.query('BEGIN');const before=(await db.query('SELECT count(*)::int n FROM wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n;
 const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909170000_reconcile_completed_frozen_prefix.sql'),'utf8').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');await db.query(migration);
 const scope='SYNTHETIC-COMPLETED-PREFIX-'+crypto.randomUUID(),ids=[],texts=[];
 for(let i=1;i<=3;i++){const p={id:'SYNTHETIC-00'+i,description:'WTS Rolex 126610LN USD 12000',synthetic_fixture:true},text=stableJson(p);texts.push(text);ids.push((await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(source_system,source_database,source_table,source_id,source_record_id,source_created_on,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source)
 VALUES($1,'disposable','auctions',$2,$2,'2026-09-01',$3,$3,$4::text,$4::text::jsonb,$5,'description') RETURNING id`,[scope,p.id,sha256(text),text,p.description])).rows[0].id);}
 const manifest={contract:'WF_IMMUTABLE_SOURCE_SNAPSHOT_V2',status:'COMPLETE',isolation:'REPEATABLE READ / CONSISTENT SNAPSHOT / READ ONLY',source_system:scope,source_database:'disposable',source_table:'auctions',started_at:'2026-09-07T00:00:00.000Z',rows:3,expected_rows:3,minimum_id:'SYNTHETIC-001',maximum_id:'SYNTHETIC-003',chunks:[{rows:3,first_id:'SYNTHETIC-001',last_id:'SYNTHETIC-003',canonical_sha256:sha256(texts.join('\n')+'\n')}]};
 const canonical=stableJson(manifest),digest=sha256(canonical);await db.query('SELECT public.register_immutable_source_snapshot($1,$2)',[canonical,digest]);await db.query('SELECT public.bind_immutable_source_snapshot_chunk($1,0,$2::uuid[])',[digest,ids]);await db.query('SELECT public.create_immutable_snapshot_normalization_job($1,$2)',[digest,scope]);
 const workflow=scope+'-MAT';await db.query('SELECT public.create_materialization_workflow_v2($1,$2,NULL)',[workflow,scope]);
 const norm=createNormalizationPostgresRpc(db),rpc=async(name,args)=>{const maps={read_materialization_workflow_batch_v2:['SELECT public.read_materialization_workflow_batch_v2($1,$2) result',[args.p_job_name,args.p_limit]],get_materialization_workflow_v2:['SELECT public.get_materialization_workflow_v2($1) result',[args.p_job_name]],commit_materialization_workflow_batch_v2:['SELECT public.commit_materialization_workflow_batch_v2($1,$2,$3,$4) result',[args.p_job_name,args.p_expected_cursor,args.p_request_id,JSON.stringify(args.p_members)]]};assert.ok(maps[name]);return (await db.query(...maps[name])).rows[0].result;};
 const blocked=await rpc('read_materialization_workflow_batch_v2',{p_job_name:workflow,p_limit:3});assert.deepEqual(blocked.members,[]);assert.equal(blocked.waiting_for_normalization,true);assert.equal(blocked.job.expected_rows,3);
 const reject=async(query,args,pattern)=>{await db.query('SAVEPOINT refusal');await assert.rejects(db.query(query,args),pattern);await db.query('ROLLBACK TO SAVEPOINT refusal');};
 await reject('SELECT public.commit_materialization_workflow_batch_v2($1,NULL,$2,$3)',[workflow,crypto.randomUUID(),JSON.stringify([{raw_row_id:[...ids].sort()[0],proposal_hash:null,image_evidence_hash:null,image_probe_outcome:'NOT_APPLICABLE'}])],/materialization_waits_for_normalization/);
 // A legacy capture without a sealed immutable boundary must still finish normalization first.
 const legacy=scope+'-LEGACY';await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_import_checkpoints(run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at) VALUES($1,'2026-09-03','zzzz',3,3,'RAW_STAGED','{"created_on":"2026-09-03","source_id":"zzzz","count":3}',$2,now())`,[legacy,sha256(legacy)]);
 await db.query('SELECT public.create_frozen_normalization_job_v2($1,$1,$2,$3,$4,$5,3)',[legacy,sha256(legacy),scope,'disposable','auctions']);
 await reject('SELECT public.create_materialization_workflow_v2($1,$2,NULL)',[legacy+'-MAT',legacy],/normalization_boundary_not_complete/);
 // A canary may have completed a later UUID before the prefix reaches it.
 await db.query('SAVEPOINT unfinished_hole');const ordered=[...ids].sort();
 const selected=await claimReviewedCanaryMembers(db,{jobName:scope,manifestSha256:digest,rawRowIds:[ordered[0],ordered[2]]});
 await db.query('SELECT public.complete_normalization_batch_v2($1,$2,$3)',[scope,selected.leaseId,JSON.stringify(selected.members.map(normalizeClaim))]);
 const prefix=await rpc('read_materialization_workflow_batch_v2',{p_job_name:workflow,p_limit:3});assert.deepEqual(prefix.members.map(m=>m.raw_row_id),[ordered[0]]);
 await db.query('ROLLBACK TO SAVEPOINT unfinished_hole');
 let waits=0;const checkpoints=[];
 const final=await materialize({rpc,jobName:workflow,batchSize:3,maxBatches:6,wait:async()=>{waits++;await normalize({rpc:norm,jobName:scope,batchSize:waits===1?2:1,maxBatches:1});},onProgress:j=>checkpoints.push({processed:j.processed_rows,complete:j.complete,waiting:!!j.waiting_for_normalization})});
 assert.equal(waits,2);assert.equal(final.processed_rows,3);assert.equal(final.eligible_rows,3);assert.equal(final.complete,true);assert.ok(checkpoints.some(j=>j.processed===2&&!j.complete));
 const stored=(await db.query('SELECT raw_row_id FROM wf_canonical_staging.materialization_workflow_members_v2 WHERE job_name=$1 ORDER BY raw_row_id',[workflow])).rows.map(r=>r.raw_row_id);assert.deepEqual(stored,[...ids].sort());
 assert.equal((await norm('get_normalization_job_v2',{p_job_name:scope})).complete,true);assert.equal((await db.query('SELECT count(*)::int n FROM wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n,before);
 await db.query('ROLLBACK');report.databases.push({container,database,status:'PASS',checks:['Only a sealed immutable boundary may start reconciliation before normalization finishes','Pending first member returns wait; direct pending completion is refused','Actual worker pauses, commits the completed two-row prefix, waits, then reconciles all three','No cursor skips an unfinished input; complete remains false until every expected input is reconciled','Legacy incomplete jobs remain blocked; source/publication data and all fixture changes rolled back']});
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}}
report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
main().catch(e=>{console.error('COMPLETED_PREFIX_TEST_FAILED',e.code||e.name,e.message?.slice(0,200));process.exitCode=1;});
