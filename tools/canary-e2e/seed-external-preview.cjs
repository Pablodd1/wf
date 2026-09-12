'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const { Client }=require('./test-dependencies.cjs')('pg');
const { buildRc50Fixtures }=require('./run-rc50-preview.cjs');
const { seedFixtures }=require('./run-disposable-e2e.cjs');
async function main() {
  const url=new URL(process.env.DISPOSABLE_DB_URL);
  assert.equal(url.hostname,'127.0.0.1');
  const db=new Client({connectionString:url.href});
  await db.connect();
  try {
    assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null as disposable")).rows[0].disposable,true);
    const unknown=await db.query("select count(*)::int n from wf_canonical_staging.mariadb_canary_published_listings_v2 where test_run_id is null or test_run_id not in ('PHASE10_SYNTHETIC','RC50_SYNTHETIC_FIXTURE')");
    assert.equal(unknown.rows[0].n,0,'Refusing to modify a non-synthetic population');
    const rows=buildRc50Fixtures('https://synthetic.invalid').rows.filter(r=>!r.parent_listing_id && !r.is_bundle);
    const template=rows.find(r=>r.listing_id==='RC50-F01');
    while(rows.length<50) {
      const id='RC50-SINGLE-'+(rows.length+1);
      const raw='[SYNTHETIC FIXTURE] '+id+' single unpriced watch; fixture_data=true';
      rows.push({...template,listing_id:id,source_id:'RC50-SRC-'+id,raw_message_id:'RC50-MSG-'+id,
        raw_message_text:raw,source_context_text:raw,description:raw,title:raw,
        source_hash:crypto.createHash('sha256').update(raw).digest('hex'),seller_id:'RC50-SELLER-'+id,
        seller_display_name:'Synthetic Seller '+id,reference:'SINGLE-'+rows.length});
    }
    assert.equal(rows.length,50); assert.ok(rows.every(r=>!r.parent_listing_id && !r.is_bundle));
    await db.query('begin');
    await db.query("delete from wf_canonical_staging.mariadb_canary_published_listings_v2 where test_run_id in ('PHASE10_SYNTHETIC','RC50_SYNTHETIC_FIXTURE')");
    await seedFixtures(db,rows,'https://synthetic.invalid');
    const oracle=(await db.query('select listing_id,intent,brand,reference,price_usd,image_key from public.trading_floor_ready_view_v2 order by listing_id')).rows;
    assert.equal(oracle.length,50);
    await db.query('commit');
    fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify({status:'PASS',synthetic_only:true,
      production_contacted:false,source_rows:50,singles:50,bundle_children:0,oracle},null,2));
    console.log('Seeded and reconciled exactly 50 synthetic singles for the external preview');
  } catch(error) {await db.query('rollback');throw error;}
  finally {await db.end();}
}
main().catch(error=>{console.error('Synthetic preview seed failed:',error.code||error.name);process.exitCode=1;});
