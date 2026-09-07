'use strict';
// Genuine local Kong/Auth/PostgREST path; no SDK or RPC mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { Client } = require('./test-dependencies.cjs')('pg');
const { buildFixtures, seedFixtures } = require('./run-disposable-e2e.cjs');
const { normalizeAuthoritativeRow, computeProposalHash } = require('../mariadb-live/authoritative-evidence-normalizer.cjs');
const { bindProposalEvidence } = require('../mariadb-live/bind-proposal-evidence.cjs');
const { stableJson } = require('../mariadb-live/lossless-payload-sanitizer.cjs');

async function main() {
  const gateway = new URL(process.env.SUPABASE_URL);
  const database = new URL(process.env.DISPOSABLE_DB_URL);
  assert.equal(gateway.hostname, '127.0.0.1');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(process.env.USE_DIRECT_POSTGREST, 'false');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.SUPABASE_ANON_KEY;
  assert.ok(service && anon);
  const report = { executed_at: new Date().toISOString(), production_contacted: false,
    scope: 'Synthetic fixtures on real local Supabase Auth, Kong and PostgREST with application HTTP handlers',
    assertions: [], status: 'RUNNING' };
  const db = new Client({ connectionString: database.href });
  let server, userId;
  const dealerIds = [];
  const check = async (name, fn) => {
    try { await fn(); report.assertions.push({ name, status: 'PASS' }); console.log('PASS', name); }
    catch (error) { report.assertions.push({ name, status: 'FAIL', code: error.code || error.name }); throw error; }
  };
  const request = async (path, key, body, headers = {}, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(new URL(path, gateway), { method, signal: AbortSignal.timeout(15000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, data };
  };
  const rpc = (name, key, body = {}) => request('/rest/v1/rpc/' + name, key, body);
  try {
    await db.connect();
    report.database_version = (await db.query('select version() as v')).rows[0].v;
    // Refuse unknown populations; repeat runs may replace only this fixture set.
    assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null as disposable")).rows[0].disposable, true);
    assert.equal(Number((await db.query("select count(*) as n from wf_canonical_staging.mariadb_canary_published_listings_v2 where test_run_id is distinct from 'PHASE10_SYNTHETIC'")).rows[0].n), 0);
    await db.query("delete from wf_canonical_staging.mariadb_canary_published_listings_v2 where test_run_id='PHASE10_SYNTHETIC'");
    const fixtures = buildFixtures();
    await seedFixtures(db, fixtures.rows, gateway.origin);
    await db.query("NOTIFY pgrst, 'reload schema'");
    let ready;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { ready = await rpc('open_trading_floor_keyset_snapshot', service); } catch { ready = null; }
      if (ready?.status === 200) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await check('service-role JWT reaches actual PostgREST snapshot RPC', async () => {
      assert.equal(ready?.status, 200); assert.match(ready.data, /^[0-9a-f-]{36}$/);
    });
    await check('raw evidence, complete proposal persistence and no-op replay survive a database round trip', async () => {
      const id = crypto.randomUUID();
      const payload = { id, description: '\n WTS Rolex Submariner 124060 black dial excellent USD 11000 \n' };
      const canonical = stableJson(payload);
      const raw = { source_system: 'SYNTHETIC_SUPABASE_TEST', source_database: 'fixture', source_table: 'auctions',
        source_id: id, source_record_id: 'SYNTHETIC-' + id,
        source_hash: crypto.createHash('sha256').update(canonical).digest('hex'),
        hash_algorithm: 'sha256', canonicalization_version: 'v1-json-keys-sorted-compact',
        raw_payload: payload, raw_message: payload.description, raw_message_source: 'description',
        source_created_on: '2026-04-20T10:00:00.000Z', captured_at: '2026-09-01T10:00:00.000Z' };
      await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows
        (source_system,source_database,source_table,source_id,source_record_id,source_hash,
         raw_payload_text,raw_payload,raw_message,raw_message_source,raw_sha256,source_created_on,captured_at,test_run_id)
        values($1,$2,$3,$4,$5,$6,$7::text,$7::text::jsonb,$8,'description',$6,$9,$10,'PHASE10_SYNTHETIC')`,
        [raw.source_system,raw.source_database,raw.source_table,id,raw.source_record_id,raw.source_hash,canonical,
          payload.description,raw.source_created_on,raw.captured_at]);
      const proposal = normalizeAuthoritativeRow(raw);
      const bound = bindProposalEvidence(raw, proposal);
      const persist = () => rpc('upsert_mariadb_normalized_proposals_batch', service, { p_proposals: [bound] });
      const first = await persist();
      assert.equal(first.status, 200, 'Valid bound proposal rejected: ' + first.data?.message);
      assert.equal(first.data.inserted, 1);
      const stored = (await db.query('select to_jsonb(p) as row from wf_canonical_staging.mariadb_normalized_proposals p where source_id=$1',[id])).rows[0].row;
      assert.equal(computeProposalHash(stored), proposal.proposal_hash);
      assert.deepEqual(stored.proposal_document, JSON.parse(bound._proposal_canonical_json));
      const replay = await persist(); assert.equal(replay.status, 200); assert.equal(replay.data.unchanged, 1);
      const after = (await db.query('select to_jsonb(p) as row from wf_canonical_staging.mariadb_normalized_proposals p where source_id=$1',[id])).rows[0].row;
      assert.deepEqual(after, stored);
      for (const changed of [{ ...bound, price_usd: 123 }, { ...bound, _source_canonical_json: '{}' }]) {
        const rejected = await rpc('upsert_mariadb_normalized_proposals_batch', service, { p_proposals: [changed] });
        assert.equal(rejected.status, 400);
      }
      await db.query('update wf_canonical_staging.mariadb_normalized_proposals set proposal_hash=null where source_id=$1',[id]);
      const selection = await rpc('get_mariadb_proposals_missing_or_invalid_hash',service,{p_limit:100});
      assert.equal(selection.status,200);
      const selected = selection.data.find(r=>r.source_id===id); assert.ok(selected);
      const repair = { source_system:raw.source_system,source_database:raw.source_database,source_table:raw.source_table,
        source_id:id,source_hash:raw.source_hash,proposal_hash:proposal.proposal_hash,expected_stored_proposal:selected.stored_proposal };
      await db.query('update wf_canonical_staging.mariadb_normalized_proposals set price_usd=1 where source_id=$1',[id]);
      const raced = await rpc('backfill_mariadb_proposal_hashes',service,{p_hashes:[repair]});
      assert.equal(raced.data.code,'40001'); assert.ok(raced.status >= 400 && raced.status < 600);
      // Restore this explicitly corrupted synthetic proposal through the verified writer.
      const restored=await persist(); assert.equal(restored.status,200); assert.equal(restored.data.updated,1);
    });
    const password = crypto.randomBytes(24).toString('hex');
    const email = `wf-disposable-${crypto.randomUUID()}@example.test`;
    const created = await request('/auth/v1/admin/users', service, { email, password, email_confirm: true });
    await check('local Auth creates a confirmed synthetic account without sending email', async () => {
      assert.equal(created.status, 200); userId = created.data.id; assert.ok(userId);
    });
    const login = await request('/auth/v1/token?grant_type=password', anon, { email, password });
    await check('local Auth issues an authenticated JWT', async () => {
      assert.equal(login.status, 200); assert.ok(login.data.access_token);
    });
    const authenticated = login.data.access_token;
    await check('actual JWT claims reach auth.uid() and auth.role() in PostgREST', async () => {
      await db.query(`create or replace function public.wf_disposable_identity() returns jsonb language sql stable
        security invoker set search_path='' as 'select jsonb_build_object(''uid'',auth.uid(),''role'',auth.role())';
        revoke all on function public.wf_disposable_identity() from public;
        grant execute on function public.wf_disposable_identity() to anon,authenticated;
        notify pgrst,'reload schema';`);
      let result;
      for (let attempt=0;attempt<20;attempt++) {
        result=await rpc('wf_disposable_identity',authenticated);
        if(result.status===200) break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(result.status,200); assert.equal(result.data.uid,userId); assert.equal(result.data.role,'authenticated');
      const guest=await rpc('wf_disposable_identity',anon);
      assert.equal(guest.status,200); assert.equal(guest.data.uid,null); assert.equal(guest.data.role,'anon');
      const privateWriteProfile=await request('/rest/v1/rpc/wf_disposable_identity',authenticated,{},
        {'Content-Profile':'wf_canonical_staging'});
      assert.equal(privateWriteProfile.status,406);
    });
    for (const [role, token] of [['anon', anon], ['authenticated', authenticated]]) {
      await check(`${role} cannot execute service RPCs or query protected views/private schemas`, async () => {
        for (const name of ['open_trading_floor_keyset_snapshot', 'open_price_research_keyset_snapshot']) {
          const r = await rpc(name, token); assert.ok([401,403,404].includes(r.status));
        }
        const view = await request('/rest/v1/trading_floor_ready_view_v2?select=*&limit=1', token);
        assert.ok([401,403,404].includes(view.status));
        const raw = await request('/rest/v1/mariadb_raw_source_rows?select=*&limit=1', token, undefined,
          { 'Accept-Profile': 'wf_canonical_staging' });
        assert.ok([401,403,404,406].includes(raw.status));
      });
    }
    await check('service role cannot expose the private schema through PostgREST profiles', async () => {
      const result = await request('/rest/v1/mariadb_raw_source_rows?select=*&limit=1', service, undefined,
        { 'Accept-Profile': 'wf_canonical_staging' });
      assert.ok([401,403,404,406].includes(result.status));
    });
    const handlers = {
      '/api/dealers': require('../../api/dealers'),
      '/api/canary/trading-floor': require('../../api/canary/trading-floor'),
      '/api/canary/price-research': require('../../api/canary/price-research'),
    };
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const handler = handlers[url.pathname];
      if (!handler) { res.writeHead(404); res.end(); return; }
      req.query = Object.fromEntries(url.searchParams);
      res.status = code => { res.statusCode = code; return res; };
      res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
      try { await handler(req, res); } catch { res.status(500).json({ error: 'test_handler_failure' }); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const app = `http://127.0.0.1:${server.address().port}`;
    const api = async (path, params = {}) => {
      const result = await fetch(app + path + '?' + new URLSearchParams(params));
      return { status: result.status, data: await result.json() };
    };
    await check('approved dealer HTTP directory reconciles pages, rated subset, consent search and private fields', async () => {
      const prefix = 'SYNTHETIC-' + crypto.randomUUID();
      for (const [suffix,status,rating,reviews,consent] of [
        ['Alpha','VERIFIED',4.5,8,true], ['Beta','VERIFIED',null,2,false],
        ['Gamma','VERIFIED',null,0,false], ['Hidden','UNVERIFIED',5,99,true],
      ]) {
        const id = crypto.randomUUID(); dealerIds.push(id);
        await db.query(`insert into public.dealers(id,slug,display_name,status,rating,review_count,contact_consent,profile_summary)
          values($1,$2,$3,$4,$5,$6,$7,$8)`,[id,prefix+'-'+suffix,prefix+' '+suffix,status,rating,reviews,consent,
          'Synthetic contact private@example.test and https://wa.me/15555550123']);
        await db.query(`insert into public.dealer_source_identities(dealer_id,source_system,source_identity,identity_type,verification_status)
          values($1,$2,$3,'PHONE','VERIFIED')`,[id,prefix,{Alpha:'+1 555 555 0123',Beta:'+1 555 555 0456',Gamma:'+1 555 555 0789',Hidden:'+1 555 555 0999'}[suffix]]);
      }
      const first = await api('/api/dealers',{q:prefix,pageSize:'2'});
      const second = await api('/api/dealers',{q:prefix,pageSize:'2',page:'2'});
      assert.equal(first.status,200); assert.equal(first.data.total,3);
      assert.equal(second.data.total,3); assert.equal(second.data.dealers.length,1);
      assert.equal(new Set([...first.data.dealers,...second.data.dealers].map(d=>d.id)).size,3);
      assert.equal(first.data.reconciliation.rated_dealers_total,2);
      const rated = await api('/api/dealers',{q:prefix,mode:'rated'});
      assert.equal(rated.status,200); assert.equal(rated.data.total,2);
      assert.equal(rated.data.dealers[0].rating,4.5); assert.equal(rated.data.dealers[1].rating,null);
      assert.ok(rated.data.dealers.every(d=>[...first.data.dealers,...second.data.dealers].some(a=>a.id===d.id)));
      const phone = await api('/api/dealers',{q:'+1 555 555 0123'});
      assert.equal(phone.data.total,1);
      const withheld = await api('/api/dealers',{q:'+1 555 555 0456'});
      assert.equal(withheld.data.total,0);
      assert.doesNotMatch(JSON.stringify(first.data), /private@example|wa\.me|source_identity|verified_phone|raw_payload/);
      for (const query of [{page:'0'},{pageSize:'101'},{mode:'unknown'}]) {
        assert.equal((await api('/api/dealers',query)).status,400);
      }
      const denied = await rpc('get_approved_dealer_directory',anon);
      assert.ok([401,403,404].includes(denied.status));
    });
    let first;
    await check('HTTP Trading Floor traverses every frozen ID once through real PostgREST', async () => {
      const expected = (await db.query('select listing_id from public.trading_floor_ready_view_v2')).rows.map(r => r.listing_id).sort();
      const ids = []; let cursor;
      for (let page = 0; page < 100; page++) {
        const result = await api('/api/canary/trading-floor', { limit: '7', ...(cursor ? { cursor } : {}) });
        assert.equal(result.status, 200); first ||= result.data;
        assert.equal(result.data.total, expected.length);
        ids.push(...result.data.records.map(row => row.listing_id));
        cursor = result.data.nextCursor;
        if (!cursor) break;
      }
      assert.equal(new Set(ids).size, ids.length); assert.deepEqual(ids.sort(), expected);
    });
    const cohort = { brand: 'Patek Philippe', reference: '7128/1G', dial: 'Blue', condition: 'New', pageSize: '2' };
    let research;
    await check('HTTP Price Research returns exact qualified cohort statistics', async () => {
      research = await api('/api/canary/price-research', cohort);
      assert.equal(research.status, 200); assert.equal(research.data.stats.count, 3);
      assert.equal(research.data.stats.median, 100000);
      assert.equal(research.data.stats.avg, 100000);
    });
    await check('concurrent publication preserves old cursor payloads, counts and statistics', async () => {
      await db.query("update wf_canonical_staging.mariadb_canary_published_listings_v2 set price_usd=price_usd+1 where listing_id=$1", [first.records[0].listing_id]);
      const old = await api('/api/canary/trading-floor', { limit: '7', cursor: first.nextCursor });
      assert.equal(old.status, 200); assert.equal(old.data.snapshot, first.snapshot); assert.equal(old.data.total, first.total);
      if (research.data.next_cursor) {
        const next = await api('/api/canary/price-research', { ...cohort, cursor: research.data.next_cursor });
        assert.equal(next.status, 200); assert.deepEqual(next.data.stats, research.data.stats);
      }
      const fresh = await api('/api/canary/trading-floor', { limit: '7' });
      assert.equal(fresh.status, 200); assert.notEqual(fresh.data.snapshot, first.snapshot);
    });
    await check('shared contact budget admits exactly 30 of 60 parallel real RPC requests', async () => {
      const key = crypto.randomBytes(32).toString('hex');
      const responses = await Promise.all(Array.from({ length: 60 }, () => rpc('consume_listing_contact_budget', service, { p_bucket_hash: key })));
      assert.ok(responses.every(r => r.status === 200));
      assert.equal(responses.filter(r => r.data === true).length, 30);
    });
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = { code: error.code || error.name, message: String(error.message).slice(0,300) };
    process.exitCode = 1;
  } finally {
    if (userId) {
      const removed = await request('/auth/v1/admin/users/' + userId, service, undefined, {}, 'DELETE');
      report.synthetic_user_removed = removed.status >= 200 && removed.status < 300;
    }
    if (server) await new Promise(resolve => server.close(resolve));
    if (dealerIds.length) await db.query('delete from public.dealers where id=any($1::uuid[])',[dealerIds]);
    await db.query('drop function if exists public.wf_disposable_identity()');
    await db.end();
    fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(report.status);
  }
}
main().catch(() => { console.error('DISPOSABLE_VALIDATION_SETUP_FAILED'); process.exitCode = 1; });
