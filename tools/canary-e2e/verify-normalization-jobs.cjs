'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('./test-dependencies.cjs')('pg');
const { stableJson } = require('../mariadb-live/lossless-payload-sanitizer.cjs');
const { normalizeClaim, run, createRpc } = require('../mariadb-live/run-frozen-normalization-v2.cjs');
const { computeProposalHash } = require('../mariadb-live/authoritative-evidence-normalizer.cjs');

async function main() {
  assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname, '127.0.0.1');
  assert.equal(new URL(process.env.SUPABASE_URL).origin, 'http://127.0.0.1:54321');
  const db = new Client({ connectionString: process.env.DISPOSABLE_DB_URL });
  const report = { recorded_at: new Date().toISOString(), status: 'RUNNING', synthetic_only: true, production_contacted: false, checks: [] };
  const rpc = createRpc(process.env);
  try {
    await db.connect();
    assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok, true);
    const initialPublic = (await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n;
    assert.equal(initialPublic, 50);
    const runKey = 'WF_NORMALIZATION_V2_SYNTHETIC_' + crypto.randomUUID();
    const job = runKey; report.job_name = job;
    const manifest = crypto.createHash('sha256').update(runKey).digest('hex');
    const rows = [];
    const rawIdPrefix = crypto.randomUUID().slice(0,24);
    await db.query('begin');
    for (let i = 0; i < 9; i++) {
      const id = crypto.randomUUID();
      const message = [
        'WTS Rolex 126610LN black dial new 2024 USD 12500',
        'WTB Rolex 126610LN black dial new',
        'WTS Rolex 126610LN black dial new USD 13000',
        'Interested in Rolex 126610LN',
        'WTS Rolex 126610LN black dial new USD 14000',
        'WTS Rolex 126610LN black dial new USD 15000',
        'WTS Rolex 126610LN black dial new',
        '',
        'WTB Rolex 126610LN black dial new USD 11000',
      ][i];
      const posted = i === 5 ? '0000-invalid-source-date' : '2026-09-01T00:00:00.000Z';
      const payload = { id, description: message, from_name: 'Synthetic normalization poster',
        brand: 'Rolex', reference: '126610LN', model: 'Submariner', is_bundle: i === 2 ? 1 : 0, created_on: posted, synthetic_fixture: true };
      const canonical = stableJson(payload); const hash = crypto.createHash('sha256').update(canonical).digest('hex');
      const transport = i === 4 ? { ...payload, description: message + ' altered' } : payload;
      const rawId = (await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows
        (id,source_system,source_database,source_table,source_id,source_record_id,source_created_on,captured_at,
         raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash,test_run_id)
        values($8,$1,'disposable','auctions',$2,$2,$3,'2026-09-02T00:00:00Z',$4,'description',$5,$6,$7,$5,'NORMALIZATION_V2_SYNTHETIC') returning id`,
        [runKey,id,posted,message,hash,canonical,transport,rawIdPrefix+String(i).padStart(12,'0')])).rows[0].id;
      rows.push({ rawId, sourceId: id });
    }
    await db.query(`insert into wf_canonical_staging.mariadb_raw_import_checkpoints
      (run_key,last_created_on,last_source_id,input_rows,newly_staged_rows,status,frozen_upper_boundary,manifest_sha256,updated_at)
      values($1,'2026-09-03T00:00:00.000Z','zzzz',9,9,'RAW_STAGED',$2,$3,now())`,
      [runKey,{ created_on: '2026-09-03T00:00:00.000Z', source_id: 'zzzz', count: 9 },manifest]);
    await db.query('commit');
    const createArgs = { p_job_name: job, p_capture_run_key: runKey, p_manifest_sha256: manifest,
      p_source_system: runKey, p_source_database: 'disposable', p_source_table: 'auctions', p_expected_rows: 9 };
    await assert.rejects(rpc('create_frozen_normalization_job_v2', { ...createArgs, p_expected_rows: 10 }), /NORMALIZATION_RPC_REJECTED/);
    assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.normalization_jobs_v2 where job_name=$1',[job])).rows[0].n,0);
    const created = await rpc('create_frozen_normalization_job_v2', createArgs);
    assert.deepEqual(await rpc('create_frozen_normalization_job_v2', createArgs), created);
    await assert.rejects(rpc('create_frozen_normalization_job_v2', { ...createArgs, p_manifest_sha256: 'f'.repeat(64) }), /NORMALIZATION_RPC_REJECTED/);
    report.checks.push({name:'Verified checkpoint freezes exact membership; wrong counts roll back and boundary-changing retries are rejected',status:'PASS'});
    const leaseA = crypto.randomUUID(), leaseB = crypto.randomUUID();
    const [a,b] = await Promise.all([
      rpc('claim_normalization_batch_v2', {p_job_name:job,p_lease_id:leaseA,p_limit:2}),
      rpc('claim_normalization_batch_v2', {p_job_name:job,p_lease_id:leaseB,p_limit:2}),
    ]);
    assert.equal(a.length,2); assert.equal(b.length,2);
    assert.equal(new Set([...a,...b].map(r=>r.raw_row_id)).size,4);
    assert.deepEqual(await rpc('claim_normalization_batch_v2',{p_job_name:job,p_lease_id:leaseA,p_limit:2}),a);
    const completeA = {p_job_name:job,p_lease_id:leaseA,p_results:a.map(normalizeClaim)};
    const first = await rpc('complete_normalization_batch_v2', completeA);
    const versions = (await db.query('select count(*)::int n from wf_canonical_staging.normalized_proposal_versions')).rows[0].n;
    assert.deepEqual(await rpc('complete_normalization_batch_v2',completeA),first);
    assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.normalized_proposal_versions')).rows[0].n,versions);
    const changed = structuredClone(completeA); changed.p_results[0].unexpected_change=true;
    await assert.rejects(rpc('complete_normalization_batch_v2',changed),/NORMALIZATION_RPC_REJECTED/);
    const resultsB = b.map(normalizeClaim);
    const proposalIndex = resultsB.findIndex(r=>r.proposal);
    assert.ok(proposalIndex>=0, 'The deterministic second claim must exercise proposal rejection');
    if (proposalIndex>=0) {
      const altered=structuredClone(resultsB);altered[proposalIndex].proposal.price_usd=999;
      await assert.rejects(rpc('complete_normalization_batch_v2',{p_job_name:job,p_lease_id:leaseB,p_results:altered}),/NORMALIZATION_RPC_REJECTED/);
      assert.equal((await rpc('get_normalization_job_v2',{p_job_name:job})).processed_rows,2);
    }
    await rpc('complete_normalization_batch_v2',{p_job_name:job,p_lease_id:leaseB,p_results:resultsB});
    report.checks.push({name:'Concurrent claims are disjoint; lost-response retries are exact no-ops; altered result replay and invalid proposal content do not advance the checkpoint',status:'PASS'});
    const tamperedLease=crypto.randomUUID();
    const tampered=await rpc('claim_normalization_batch_v2',{p_job_name:job,p_lease_id:tamperedLease,p_limit:1});
    assert.equal(tampered[0].raw_row_id,rows[4].rawId);
    const quarantined=normalizeClaim(tampered[0]); assert.equal(quarantined.outcome,'QUARANTINE');
    await rpc('complete_normalization_batch_v2',{p_job_name:job,p_lease_id:tamperedLease,p_results:[quarantined]});
    const abandoned = crypto.randomUUID();
    const leased = await rpc('claim_normalization_batch_v2',{p_job_name:job,p_lease_id:abandoned,p_limit:1});
    assert.equal(leased.length,1);
    await db.query("update wf_canonical_staging.normalization_job_members_v2 set attempts=3,lease_expires_at=now()-interval '1 second' where job_name=$1 and lease_id=$2",[job,abandoned]);
    await assert.rejects(rpc('complete_normalization_batch_v2',{p_job_name:job,p_lease_id:abandoned,p_results:leased.map(normalizeClaim)}),/NORMALIZATION_RPC_REJECTED/);
    const completed = await run({rpc,jobName:job,batchSize:2,maxBatches:10,wait:async()=>{throw new Error('Unexpected live lease');}});
    assert.equal(completed.complete,true);assert.equal(completed.processed_rows,9);assert.equal(completed.remaining_rows,0);
    assert.equal(completed.processed_rows,completed.normalized_rows+completed.review_rows+completed.bundle_rows+completed.quarantine_rows+completed.error_rows);
    const counts=(await db.query('select outcome,count(*)::int n from wf_canonical_staging.normalization_job_members_v2 where job_name=$1 group by outcome',[job])).rows;
    assert.equal(counts.reduce((sum,r)=>sum+r.n,0),9);
    assert.ok(counts.some(r=>r.outcome==='ERROR'));
    assert.deepEqual(Object.fromEntries(counts.map(r=>[r.outcome,r.n])),{BUNDLE_HELD:1,ERROR:1,NORMALIZED:4,QUARANTINE:1,REVIEW:2});
    const proposals=(await db.query('select to_jsonb(p) value from wf_canonical_staging.mariadb_normalized_proposals p where source_system=$1',[runKey])).rows.map(r=>r.value);
    for (const proposal of proposals) assert.equal(computeProposalHash(proposal),proposal.proposal_hash);
    const beforeReplay=JSON.stringify(completed);
    assert.equal(JSON.stringify(await run({rpc,jobName:job,maxBatches:1})),beforeReplay);
    assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,initialPublic);
    for (const role of ['anon','authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1,'public.claim_normalization_batch_v2(text,uuid,integer)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    }
    report.checks.push({name:'Bounded abandoned leases become durable errors; actual worker finishes the frozen set, every stored proposal hash recomputes, completed rerun changes nothing and public listings stay unchanged',status:'PASS'});
    report.outcomes=counts;report.public_rows_unchanged=initialPublic;report.status='PASS';
    report.retained_private_synthetic_rows=9;
  } catch(error) { report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0],site:error.stack?.split('\n').find(line=>line.includes('verify-normalization-jobs.cjs:'))?.trim()};process.exitCode=1; }
  finally { await db.query('rollback');await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report)); }
}
main().catch(error=>{console.error('NORMALIZATION_VALIDATION_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
