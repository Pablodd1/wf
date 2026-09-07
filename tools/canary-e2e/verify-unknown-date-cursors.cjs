'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {Client}=require('./test-dependencies.cjs')('pg');
const {encodeCursorEnvelope,decodeCursorEnvelope,computeCursorScope}=require('../../api/_lib/canary-keyset.cjs');
const {enforceListingDisplayContract}=require('../../shared/listing-display-contract.cjs');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',synthetic_only:true,production_contacted:false,
  qualification:'Disposable SQL and actual cursor codec test; synthetic date fixtures are rolled back without public commit.'};
 try{
  await db.connect();assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  await db.query('begin');
  const base=(await db.query("select to_jsonb(c) value from wf_canonical_staging.mariadb_canary_published_listings_v2 c where listing_id='RC50-A12'")).rows[0].value;
  const ids=[];
  for(let i=1;i<=2;i++){
   const id='RC50-UNKNOWN-DATE-'+i;ids.push(id);
   const payload={id,description:`[SYNTHETIC FIXTURE] CURSOR_DATE_FIXTURE WTS Rolex 126610LN black dial new USD 10000`,synthetic_fixture:true};
   const doc={...base,listing_id:id,source_id:id,source_hash:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    raw_message_id:id,raw_message_text:payload.description,source_context_text:null,source_created_at:null,
    brand:'Rolex',model:'Submariner',reference:'126610LN',dial_color:'Black',condition:'New',title:null,description:payload.description,
    original_price_text:'USD 10000',original_price_amount:10000,original_price_currency:'USD',price_usd:10000,
    image_url:null,thumbnail_url:null,image_key:null,image_evidence_type:'NO_IMAGE',image_status:'NO_IMAGE',
    seller_id:id,seller_display_name:'Synthetic unknown-date poster '+i,test_run_id:'UNKNOWN_DATE_SYNTHETIC'};
   await db.query('select wf_canonical_staging.apply_publication_records_v2($1)',[JSON.stringify([doc])]);
  }
  const snapshot=(await db.query('select public.open_trading_floor_keyset_snapshot(3600) id')).rows[0].id;
  const first=JSON.parse(JSON.stringify((await db.query(`select * from public.get_trading_floor_canary_keyset_v4(
   p_snapshot_id=>$1,p_limit=>1,p_query=>'CURSOR_DATE_FIXTURE')`,[snapshot])).rows[0]));
  assert.equal(first.payload.source_created_at,null);assert.equal(enforceListingDisplayContract(first.payload).source_created_at,null);
  const scope=computeCursorScope('trading_floor',{query:'CURSOR_DATE_FIXTURE'});
  const encoded=encodeCursorEnvelope({snapshot,scope,frozenKey:first});
  const decoded=decodeCursorEnvelope(encoded,{surface:'trading_floor',filters:{query:'CURSOR_DATE_FIXTURE'}});
  assert.equal(decoded.key.createdAt.startsWith('0001-01-01'),true);
  const next=(await db.query(`select * from public.get_trading_floor_canary_keyset_v4(p_snapshot_id=>$1,p_limit=>1,p_query=>'CURSOR_DATE_FIXTURE',
   p_cursor_priced_rank=>$2,p_cursor_image_rank=>$3,p_cursor_price_usd=>$4,p_cursor_created_at=>$5,p_cursor_listing_id=>$6)`,
   [snapshot,decoded.key.pricedRank,decoded.key.imageRank,decoded.key.priceUsd,decoded.key.createdAt,decoded.key.listingId])).rows[0];
  assert.deepEqual([first.k_listing_id,next.k_listing_id],ids);assert.equal(next.payload.source_created_at,null);
  const research=(await db.query('select public.open_price_research_keyset_snapshot(3600) id')).rows[0].id;
  const keys=(await db.query('select payload,source_created_at::text key_date from wf_canonical_staging.keyset_snapshot_members where snapshot_id=$1 and listing_id=any($2) order by listing_id',[research,ids])).rows;
  assert.equal(keys.length,2);for(const row of keys){assert.equal(row.payload.source_created_at,null);assert.ok(row.key_date.startsWith('0001-01-01'));}
  await db.query('rollback');assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  report.status='PASS';report.checks=['Unknown source dates persist as NULL in the canonical/display payload',
   'Both snapshot surfaces use only an internal null-ordering key; no fake posting date is displayed',
   'The actual opaque cursor codec traverses two equal-price missing-date rows without loss or duplication',
   'All synthetic date fixtures and temporary snapshots roll back; existing public 50 remain unchanged'];
 }catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('UNKNOWN_DATE_TEST_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
