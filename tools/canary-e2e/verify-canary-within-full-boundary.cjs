'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Client}=require('./test-dependencies.cjs')('pg');const {stableJson,sha256}=require('../mariadb-live/lossless-payload-sanitizer.cjs');
const {claimReviewedCanaryMembers}=require('../mariadb-live/claim-reviewed-canary-members.cjs');
const {normalizeClaim}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});await db.connect();
 const report={started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false};
 try{
  const before=(await db.query('SELECT count(*)::int n FROM wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n;
  await db.query('BEGIN');const scope='SYNTHETIC-FIRST-CANARY-'+crypto.randomUUID(),ids=[],texts=[];
  for(let i=1;i<=3;i++){
   const p={id:'SYNTHETIC-00'+i,description:'WTS Rolex 126610LN USD 12000',synthetic_fixture:true},text=stableJson(p);texts.push(text);
   const r=await db.query(`INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source)
    VALUES($1,'disposable','auctions',$2,$2,$3,$3,$4::text,$4::text::jsonb,$5,'description') RETURNING id`,[scope,p.id,sha256(text),text,p.description]);ids.push(r.rows[0].id);
  }
  const manifest={contract:'WF_IMMUTABLE_SOURCE_SNAPSHOT_V2',status:'COMPLETE',isolation:'REPEATABLE READ / CONSISTENT SNAPSHOT / READ ONLY',source_system:scope,source_database:'disposable',source_table:'auctions',started_at:'2026-09-07T00:00:00.000Z',rows:3,expected_rows:3,minimum_id:'SYNTHETIC-001',maximum_id:'SYNTHETIC-003',chunks:[{rows:3,first_id:'SYNTHETIC-001',last_id:'SYNTHETIC-003',canonical_sha256:sha256(texts.join('\n')+'\n')}]};
  const canonical=stableJson(manifest),digest=sha256(canonical);
  await db.query('SELECT public.register_immutable_source_snapshot($1,$2)',[canonical,digest]);await db.query('SELECT public.bind_immutable_source_snapshot_chunk($1,0,$2::uuid[])',[digest,ids]);await db.query('SELECT public.create_immutable_snapshot_normalization_job($1,$2)',[digest,scope]);
  await assert.rejects(claimReviewedCanaryMembers(db,{jobName:scope,manifestSha256:'f'.repeat(64),rawRowIds:ids.slice(0,2)}),/SEALED_BOUNDARY_REQUIRED/);
  const lease=await claimReviewedCanaryMembers(db,{jobName:scope,manifestSha256:digest,rawRowIds:ids.slice(0,2)});assert.equal(lease.members.length,2);
  const competing=await claimReviewedCanaryMembers(db,{jobName:scope,manifestSha256:digest,rawRowIds:ids.slice(0,2)});assert.equal(competing.members.length,0);
  await assert.rejects(claimReviewedCanaryMembers(db,{jobName:scope,manifestSha256:digest,rawRowIds:[crypto.randomUUID()]}),/EXACT_MEMBERSHIP_REQUIRED/);
  const results=lease.members.map(normalizeClaim);await db.query('SELECT public.complete_normalization_batch_v2($1,$2,$3)',[scope,lease.leaseId,JSON.stringify(results)]);
  const job=(await db.query('SELECT public.get_normalization_job_v2($1) job',[scope])).rows[0].job;assert.equal(job.expected_rows,3);assert.equal(job.processed_rows,2);assert.equal(job.complete,false);
  const hashes=[];for(const r of results){const m=(await db.query('SELECT wf_canonical_staging.materialize_single_member_v2($1,$2,$3,NULL,NULL) result',[scope,r.raw_row_id,r.proposal.proposal_hash])).rows[0].result;assert.equal(m.outcome,'ELIGIBLE');hashes.push(m.materialization_hash);}
  const batch='SYNTHETIC-EARLY-CANARY-'+crypto.randomUUID();const publication=(await db.query('SELECT public.publish_materialized_batch_v2($1,(SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton),$2::text[],true) result',[batch,hashes])).rows[0].result;
  assert.equal(publication.inserted,2);assert.equal(publication.after_count,before+2);
  const pending=(await db.query("SELECT count(*)::int n FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name=$1 AND outcome='PENDING'",[scope])).rows[0].n;assert.equal(pending,1);
  await db.query('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int n FROM wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n,before);
  report.status='PASS';report.checks=['Reviewed members remain inside the complete sealed snapshot membership','Competing owner selection cannot steal a live lease or add outsiders','Two reviewed records normalize, materialize and publish while the third remains pending','Full expected count stays three and unfinished work is not marked complete','Rollback restores public listings without losing or fabricating boundary membership'];
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error('FULL_BOUNDARY_CANARY_TEST_FAILED',e.code||e.name,e.message?.slice(0,180));process.exitCode=1;});
