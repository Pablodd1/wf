'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
const {createRpc}=require('../mariadb-live/run-frozen-normalization-v2.cjs');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 assert.equal(new URL(process.env.SUPABASE_URL).origin,'http://127.0.0.1:54321');
 assert.equal(process.env.DISPOSABLE_IMAGE_BASE_URL,undefined);
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const reader=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',production_contacted:false,synthetic_only:true};
 const batch='WF_PUBLICATION_SYNTHETIC_'+crypto.randomUUID();report.batch_key=batch;
 let server,committed=false;
 const revision=async()=>Number((await db.query('select revision from wf_canonical_staging.publication_revision where singleton')).rows[0].revision);
 const contents=async()=>JSON.stringify((await db.query('select to_jsonb(c) value from wf_canonical_staging.mariadb_canary_published_listings_v2 c order by listing_id')).rows);
 try{
  await db.connect();await reader.connect();
  assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  const before=await contents();
  const material=JSON.parse(fs.readFileSync(process.env.MATERIALIZATION_REPORT,'utf8'));assert.equal(material.status,'PASS');
  const version=(await db.query('select * from wf_canonical_staging.materialized_single_versions_v2 where materialization_hash=$1',[material.materialization_hash])).rows[0];
  const doc=version.document;assert.equal(doc.test_run_id,'PIPELINE_V2_SYNTHETIC');
  const handlers={'/api/canary/trading-floor':require('../../api/canary/trading-floor'),'/api/canary/price-research':require('../../api/canary/price-research')};
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://127.0.0.1');req.query=Object.fromEntries(url.searchParams);
   res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
   handlers[url.pathname](req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const get=async path=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();};
  assert.equal((await get('/api/canary/trading-floor?pageSize=100')).total,50);
  const initialRevision=await revision();
  for(const role of ['anon','authenticated','service_role']) {
   assert.equal((await db.query("select has_function_privilege($1,'public.publish_materialized_batch_v2(text,bigint,text[],boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
   assert.equal((await db.query("select has_function_privilege($1,'public.rollback_materialized_batch_v2(text,bigint)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  await assert.rejects(db.query('select public.publish_materialized_batch_v2($1,$2,$3,false)',[batch,initialRevision,[material.materialization_hash]]),/production_synthetic_evidence_refused/);
  await db.query('begin');
  const published=(await db.query('select public.publish_materialized_batch_v2($1,$2,$3,true) result',[batch,initialRevision,[material.materialization_hash]])).rows[0].result;
  assert.equal(published.inserted,1);assert.equal(published.after_count,51);assert.ok(published.trading_snapshot);assert.ok(published.price_snapshot);
  assert.equal((await reader.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  assert.equal((await get('/api/canary/trading-floor?pageSize=100')).total,50);
  await db.query('commit');committed=true;
  const page=await get('/api/canary/trading-floor?pageSize=100');assert.equal(page.total,51);
  const card=page.records.find(r=>r.listing_id===doc.listing_id);assert.ok(card);
  assert.equal(card.source_id,doc.source_id);assert.equal(card.source_hash,doc.source_hash);assert.equal(card.raw_message,doc.raw_message_text);
  assert.equal(card.price_usd,doc.price_usd);assert.equal(card.source_currency,'HKD');assert.equal(card.seller_name,doc.seller_display_name);
  assert.equal(card.seller_rating,null);assert.equal(card.contact_available,false);assert.equal(card.image_url,doc.image_url);
  assert.equal((await get('/api/canary/price-research?pageSize=100')).rows.some(r=>r.listing_id===doc.listing_id),true);
  const replay=(await db.query('select public.publish_materialized_batch_v2($1,$2,$3,true) result',[batch,initialRevision,[material.materialization_hash]])).rows[0].result;
  assert.equal(replay.replayed,true);assert.equal(await revision(),published.revision);
  const request=(await db.query('select request_document from wf_canonical_staging.publication_batches_v2 where batch_key=$1',[batch])).rows[0].request_document;
  assert.deepEqual(request.hashes,[material.materialization_hash]);
  const noop=batch+'_NOOP';
  const noChange=(await db.query('select public.publish_materialized_batch_v2($1,$2,$3,true) result',[noop,await revision(),[material.materialization_hash]])).rows[0].result;
  assert.equal(noChange.identical,1);assert.equal(noChange.inserted,0);assert.equal(noChange.changed,0);assert.equal(noChange.revision,published.revision);
  await db.query('select public.rollback_materialized_batch_v2($1,$2)',[noop,await revision()]);assert.equal(await revision(),published.revision);
  await db.query('begin');
  await db.query("update wf_canonical_staging.mariadb_canary_published_listings_v2 set seller_display_name='Changed synthetic poster' where listing_id=$1",[doc.listing_id]);
  await assert.rejects(db.query('select public.rollback_materialized_batch_v2($1,$2)',[batch,await revision()]),/rollback_published_content_changed/);
  await db.query('rollback');
  const rolled=(await db.query('select public.rollback_materialized_batch_v2($1,$2) result',[batch,await revision()])).rows[0].result;
  committed=false;assert.equal(rolled.state,'ROLLED_BACK');assert.equal(rolled.removed_insertions,1);assert.ok(rolled.expired_traversals>0);
  assert.equal(await contents(),before);assert.equal((await get('/api/canary/trading-floor?pageSize=100')).total,50);
  await assert.rejects(createRpc(process.env)('get_trading_floor_snapshot_count',{p_snapshot_id:published.trading_snapshot}),/NORMALIZATION_RPC_REJECTED/);
  const again=(await db.query('select public.rollback_materialized_batch_v2($1,$2) result',[batch,await revision()])).rows[0].result;assert.equal(again.replayed,true);
  report.status='PASS';report.materialization_hash=material.materialization_hash;report.publication_result=published;report.rollback_result=rolled;
  report.checks=['Owner-only publication refuses synthetic evidence without the explicit disposable gate',
   'Uncommitted release and snapshots are invisible to independent PostgreSQL and real Supabase/API readers',
   'Committed source-backed synthetic record reaches Trading Floor and Price Research through actual HTTP/API/PostgREST with exact card facts',
   'Identical publication and lost-response replay change nothing and retain exact request evidence',
   'Unsafe rollback after content change is refused; reviewed rollback restores all original 50 rows byte-for-byte and invalidates prior cursors'];
 }catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{
  if(committed){try{report.cleanup=(await db.query('select public.rollback_materialized_batch_v2($1,$2) result',[batch,await revision()])).rows[0].result;}catch(error){report.cleanup_error=error.code||error.name;}}
  if(server)await new Promise(resolve=>server.close(resolve));await reader.end();await db.end();
  fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}
main().catch(error=>{console.error('PUBLICATION_TEST_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
