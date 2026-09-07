'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Client } = require('./test-dependencies.cjs')('pg');
const { stableJson } = require('../mariadb-live/lossless-payload-sanitizer.cjs');

async function main() {
 const target = new URL(process.env.DISPOSABLE_DB_URL);
 assert.equal(target.hostname,'127.0.0.1');
 const db = new Client({connectionString:target.href});
 const report={status:'RUNNING',recorded_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,checks:[]};
 await db.connect();
 try {
  assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  const original=(await db.query("select to_jsonb(v) value from wf_canonical_staging.mariadb_canary_published_listings_v2 v where listing_id='RC50-A01'")).rows[0].value;
  assert.equal(original.test_run_id,'RC50_SYNTHETIC_FIXTURE');
  const before=(await db.query('select count(*)::int n from wf_canonical_staging.mariadb_raw_source_rows')).rows[0].n;
  await db.query('begin');
  for (const intent of ['WTS','WTB']) {
   const sourceId=crypto.randomUUID(), id='WF-DEALER-SYNTHETIC-'+sourceId;
   const message=`  [SYNTHETIC FIXTURE] ${intent} Patek Philippe 7128/1G Blue New USD 90000\n`;
   const payload={id:sourceId,description:message,from_number:'15555550123',from_name:'Synthetic activity poster',synthetic_fixture:true};
   const text=stableJson(payload),hash=crypto.createHash('sha256').update(text).digest('hex');
   await db.query(`insert into wf_canonical_staging.mariadb_raw_source_rows
    (source_system,source_database,source_table,source_id,source_record_id,raw_message,raw_message_source,raw_sha256,raw_payload_text,raw_payload,source_hash,test_run_id)
    values('RC50_SYNTHETIC_FIXTURE','disposable','auctions',$1,$1,$2,'description',$3,$4,$5,$3,'RC50_SYNTHETIC_FIXTURE')`,[sourceId,message,hash,text,payload]);
   const document={...original,listing_id:id,source_id:sourceId,source_hash:hash,raw_message_id:sourceId,
    raw_message_text:message,source_created_at:null,intent,seller_display_name:payload.from_name,
    price_research_eligible:intent==='WTS',included_in_statistics:intent==='WTS'};
   await db.query('insert into wf_canonical_staging.mariadb_canary_published_listings_v2 select (jsonb_populate_record(NULL::wf_canonical_staging.mariadb_canary_published_listings_v2,$1)).*',[document]);
   assert.equal((await db.query('select public.reconcile_v2_listing_dealers($1) result',[[id]])).rows[0].result.applied,1);
  }
  const call=async(after=null,revision=null,limit=1)=>(await db.query('select public.get_approved_dealer_profile_v2($1,$2,$3,$4) result',['rc50-browser-synthetic-alpha',limit,after,revision])).rows[0].result;
  const first=await call();
  assert.equal(first.listing_total,3);assert.equal(first.stats.wts_count,2);assert.equal(first.stats.wtb_count,1);
  assert.equal(first.stats.first_post,original.source_created_at);
  const ids=[];let page=first;
  while (page.listings.length) {
   ids.push(page.listings[0].id);
   if(page.listings.length===1)break;
   page=await call(page.listings[0].id,first.publication_revision);
   assert.equal(page.listing_total,3);
  }
  assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);assert.deepEqual(ids,[...ids].sort());
  const rejected=async(action)=>{await db.query('savepoint invalid');await assert.rejects(action,{code:'22023'});await db.query('rollback to savepoint invalid');};
  await rejected(()=>call('RC50-A02',first.publication_revision));
  await rejected(()=>call(ids[0],first.publication_revision-1));
  await rejected(()=>call(null,null,101));
  await db.query('savepoint revoked');
  await db.query("update public.dealer_source_identities set verification_status='UNVERIFIED' where dealer_id=(select id from public.dealers where slug='rc50-browser-synthetic-alpha')");
  assert.equal((await call()).listing_total,0);
  await db.query('rollback to savepoint revoked');
  for(const role of ['anon','authenticated','service_role']) {
   assert.equal((await db.query("select has_function_privilege($1,'public.get_approved_dealer_profile_v2(text,integer,text,bigint)','EXECUTE') ok",[role])).rows[0].ok,role==='service_role');
  }
  await db.query('rollback');
  assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.mariadb_raw_source_rows')).rows[0].n,before);
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  report.checks=['Three exact source-linked synthetic singles traverse without duplicates at page size one; totals include WTS and WTB and unknown dates remain unknown',
   'Foreign dealer cursor, changed publication revision and oversized page refuse; revoked identity removes linked activity',
   'Only service-role RPC access; all temporary synthetic raw, canonical and linkage rows rolled back; original public 50 preserved'];
  report.status='PASS';
 } catch(error) {report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally {await db.query('rollback');await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error(error.code||error.name);process.exitCode=1;});
