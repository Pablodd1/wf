'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('./test-dependencies.cjs')('pg');

async function main() {
  const target = new URL(process.env.DISPOSABLE_DB_URL);
  assert.equal(target.hostname, '127.0.0.1');
  const db = new Client({ connectionString: target.href });
  const writer = new Client({ connectionString: target.href });
  await db.connect(); await writer.connect();
  const report = { synthetic_only: true, production_contacted: false, checks: [], status: 'RUNNING' };
  try {
    assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null as ok")).rows[0].ok, true);
    assert.equal((await db.query("select count(*)::int n from wf_canonical_staging.mariadb_canary_published_listings_v2 where test_run_id is distinct from 'RC50_SYNTHETIC_FIXTURE'")).rows[0].n, 0);
    const rows = (await db.query('select * from public.trading_floor_ready_view_v2 order by listing_id')).rows;
    assert.equal(rows.length, 50);
    const pr = (await db.query('select public.open_price_research_keyset_snapshot() id')).rows[0].id;
    const tf = (await db.query('select public.get_price_research_demand_snapshot($1) id', [pr])).rows[0].id;
    const before = (await db.query('select count(*)::int n from wf_canonical_staging.keyset_snapshot_members')).rows[0].n;
    await db.query('begin');
    await db.query("update wf_canonical_staging.keyset_snapshot_registry set expires_at=now()-interval '1 second' where publication_revision=(select revision from wf_canonical_staging.publication_revision where singleton)");
    const renewed = (await db.query('select public.open_price_research_keyset_snapshot() id')).rows[0].id;
    const renewedTf = (await db.query('select public.get_price_research_demand_snapshot($1) id', [renewed])).rows[0].id;
    assert.notEqual(renewed, pr); assert.notEqual(renewedTf, tf);
    assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.keyset_snapshot_members')).rows[0].n, before);
    assert.equal(Number((await db.query('select public.get_trading_floor_snapshot_count($1) n', [renewedTf])).rows[0].n), 50);
    await db.query('savepoint expired');
    await assert.rejects(db.query('select public.get_trading_floor_snapshot_count($1)', [tf]), error => error.code === '22023');
    await db.query('rollback to savepoint expired');
    const first = (await db.query('select * from public.get_trading_floor_canary_keyset_v4(p_snapshot_id=>$1,p_limit=>50)', [renewedTf])).rows;
    assert.equal(first.length, 50);
    assert.deepEqual(first.map(r => r.k_listing_id).sort(), rows.map(r => r.listing_id));
    await db.query('select public.prune_keyset_snapshots()');
    const afterPrune = (await db.query('select * from public.get_trading_floor_canary_keyset_v4(p_snapshot_id=>$1,p_limit=>50)', [renewedTf])).rows;
    assert.deepEqual(afterPrune, first);
    await db.query('rollback');
    report.checks.push('Renewal returns new traversal IDs with the same 50 identities and zero copied payload rows; expired traversal rejected and pruning preserves referenced data.');

    await writer.query('begin');
    await writer.query('update wf_canonical_staging.mariadb_canary_published_listings_v2 set price_usd=price_usd+1 where listing_id=$1', [rows.find(r => r.price_usd !== null).listing_id]);
    // The publisher holds the revision lock. Warm readers must use the preceding
    // committed publication, without waiting for its materialization to finish.
    await db.query("set statement_timeout='2s'");
    const reading = await db.query('select public.open_trading_floor_keyset_snapshot() tf,public.open_price_research_keyset_snapshot() pr');
    assert.equal(reading.rows[0].tf, tf); assert.equal(reading.rows[0].pr, pr);
    await writer.query('select public.open_price_research_keyset_snapshot()');
    assert.equal(Number((await db.query('select public.get_trading_floor_snapshot_count($1) n', [tf])).rows[0].n), 50);
    await writer.query('rollback');
    assert.deepEqual((await db.query('select * from public.trading_floor_ready_view_v2 order by listing_id')).rows, rows);
    report.checks.push('Warm Trading Floor and Price Research readers finish under two seconds while a publisher holds the next revision; all publication mutations rolled back.');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = { code: error.code || error.name, message: error.message.split('\n')[0] };
    process.exitCode = 1;
  } finally {
    await db.query('rollback'); await writer.query('rollback');
    await db.end(); await writer.end();
    report.recorded_at = new Date().toISOString();
    fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
main().catch(error => { console.error('Snapshot renewal verification failed:', error.code || error.name); process.exitCode = 1; });
