'use strict';
// Creates its own loopback database. Never accepts a DATABASE_URL or remote host.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const { CANARY_MIGRATIONS, buildFixtures, seedFixtures } = require('./run-disposable-e2e.cjs');

async function main() {
  const dependencyRequire = process.env.RC50_TEST_DEPENDENCY_ROOT
    ? createRequire(path.resolve(process.env.RC50_TEST_DEPENDENCY_ROOT, 'package.json')) : require;
  const pgModule = dependencyRequire('embedded-postgres');
  const EmbeddedPostgres = pgModule.default || pgModule;
  const { Client } = dependencyRequire('pg');
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const allocated = server.address().port; server.close(() => resolve(allocated));
    });
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-count-test-'));
  const password = crypto.randomBytes(24).toString('hex');
  const instance = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password, port, persistent: false });
  const config = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' };
  const db = new Client(config);
  const writer = new Client(config);
  let started = false;
  const report = { executed_at: new Date().toISOString(), disposable: true,
    production_contacted: false, migrations: [], assertions: [],
    scope: 'Canary migration chain, synthetic fixtures, PostgreSQL only. Not full-chain or Supabase E2E.' };
  try {
    await instance.initialise(); await instance.start(); started = true;
    await db.connect(); await writer.connect();
    report.postgres_version = (await db.query('select version() as version')).rows[0].version;
    for (const file of CANARY_MIGRATIONS) {
      const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations', file), 'utf8');
      await db.query(sql);
      report.migrations.push({ file, sha256: crypto.createHash('sha256').update(sql).digest('hex') });
    }
    const fixtures = buildFixtures();
    await seedFixtures(db, fixtures.rows, 'http://127.0.0.1');
    const snapshot = async (surface) => (await db.query(`select public.open_${surface}_keyset_snapshot() as id`)).rows[0].id;
    const tf = await snapshot('trading_floor'); const pr = await snapshot('price_research');
    const call = async (fn, args) => {
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as total`;
      return Number((await db.query(sql, Object.values(args))).rows[0].total);
    };
    const cases = [
      ...[{}, { p_brand: 'Patek Philippe' }, { p_intent: 'WTB' }, { p_model: 'Nautilus' },
        { p_query: 'synthetic' }, { p_category: 'watches' }, { p_country: 'absent' },
        { p_region: 'absent' }, { p_images_only: true }, { p_priced_only: true },
        { p_brand: 'Patek Philippe', p_priced_only: true, p_intent: 'WTS' }].map(filters => ({
        fn: 'get_trading_floor_snapshot_count', page: 'get_trading_floor_canary_keyset_v4',
        args: { p_snapshot_id: tf, ...filters },
      })),
      ...[false, true].flatMap(demand => [{}, { p_brand: 'Patek Philippe' },
        { p_reference: '7128/1G' }, { p_filter_dial: true, p_dial_color: null },
        { p_filter_condition: true, p_condition: 'New' }].map(filters => ({
        fn: 'get_price_research_snapshot_count',
        page: demand ? 'get_price_research_wtb_demand_v3' : 'get_price_research_canary_keyset_v4',
        args: { p_snapshot_id: demand ? tf : pr, p_demand: demand, ...filters },
      }))),
    ];
    for (const entry of cases) {
      entry.expected = await call(entry.fn, entry.args);
      const pageArgs = { ...entry.args, p_limit: 100 }; delete pageArgs.p_demand;
      const keys = Object.keys(pageArgs);
      const page = await db.query(`select * from public.${entry.page}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')})`, Object.values(pageArgs));
      assert.ok(page.rowCount < 100, 'fixture must fit oracle page');
      assert.equal(entry.expected, page.rowCount, 'filtered snapshot total differs from page oracle');
    }
    report.before_source_count = fixtures.rows.length;
    // A separate session commits insert/update/delete while the reader retains its snapshot ids.
    await writer.query("update wf_canonical_staging.mariadb_canary_published_listings_v2 set brand='Changed', price_usd=null where listing_id='P10SYN-PR-SINGLETON'");
    await writer.query("delete from wf_canonical_staging.mariadb_canary_published_listings_v2 where listing_id='P10SYN-PR-WTB'");
    const additional = { ...fixtures.rows[0], listing_id: 'COUNT-NEW', source_id: 'COUNT-NEW-SRC', raw_message_id: 'COUNT-NEW-MSG' };
    await seedFixtures(writer, [additional], 'http://127.0.0.1');
    for (const entry of cases) assert.equal(await call(entry.fn, entry.args), entry.expected, 'count drifted after concurrent writes');
    report.assertions.push({ name: 'filtered totals match page oracle and survive separate-session INSERT/UPDATE/DELETE', cases: cases.length, result: 'PASS' });
    const newTf = await snapshot('trading_floor');
    assert.notEqual(await call('get_trading_floor_snapshot_count', { p_snapshot_id: newTf, p_intent: 'WTB' }),
      await call('get_trading_floor_snapshot_count', { p_snapshot_id: tf, p_intent: 'WTB' }));
    report.assertions.push({ name: 'new snapshot observes changed source population', result: 'PASS' });
    for (const role of ['anon', 'authenticated']) {
      await db.query(`set role ${role}`);
      await assert.rejects(call('get_trading_floor_snapshot_count', { p_snapshot_id: tf }), { code: '42501' });
      await db.query('reset role');
    }
    await db.query('set role service_role');
    assert.equal(await call('get_trading_floor_snapshot_count', { p_snapshot_id: tf }), cases[0].expected);
    await db.query('reset role');
    report.assertions.push({ name: 'least privilege', result: 'PASS', scope: 'local SET ROLE simulation only' });
    await assert.rejects(call('get_trading_floor_snapshot_count', { p_snapshot_id: pr }), { code: '22023' });
    await db.query("update wf_canonical_staging.keyset_snapshot_registry set expires_at=now()-interval '1 second' where snapshot_id=$1", [tf]);
    await assert.rejects(call('get_trading_floor_snapshot_count', { p_snapshot_id: tf }), { code: '22023' });
    report.assertions.push({ name: 'wrong surface and expired snapshot fail closed', result: 'PASS' });
    report.after_source_count = Number((await db.query('select count(*) as n from wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n);
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL'; report.error = { code: error.code || null, message: error.message };
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => {}); await writer.end().catch(() => {});
    if (started) await instance.stop();
  }
  const destination = process.argv[2];
  if (destination) fs.writeFileSync(path.resolve(destination), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
