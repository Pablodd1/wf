'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Client}=require('./test-dependencies.cjs')('pg');
async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:54321');
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={recorded_at:new Date().toISOString(),status:'RUNNING',synthetic_only:true,production_contacted:false,checks:[]};
 const rpc=async(name,body,expected=200)=>{
  const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',
   headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
   body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const result=await response.json();assert.equal(response.status,expected,JSON.stringify({rpc:name,status:response.status,code:result.code}));return result;
 };
 try{
  await db.connect();assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  const before=(await db.query("select count(*)::int n,count(*) filter(where test_run_id='RC50_SYNTHETIC_FIXTURE')::int synthetic from wf_canonical_staging.mariadb_canary_published_listings_v2")).rows[0];
  assert.deepEqual(before,{n:50,synthetic:50});
  const snapshot=await rpc('open_price_research_keyset_snapshot',{p_ttl_seconds:3600});
  const admission=(await db.query('select listing_id,exclusion_reason,representative_listing_id,plausible_cohort_count::int n,q1::float8,q3::float8,lower_fence::float8,upper_fence::float8 from wf_canonical_staging.research_snapshot_admission_v2 where snapshot_id=wf_canonical_staging.snapshot_data_id($1) order by listing_id',[snapshot])).rows;
  assert.equal(admission.length,24);
  assert.deepEqual(admission.filter(r=>r.exclusion_reason).map(r=>[r.listing_id,r.exclusion_reason]),[
   ['RC50-A01','REPOST_DUPLICATE'],['RC50-A06','ABOVE_IQR_FENCE']]);
  const duplicate=admission.find(r=>r.listing_id==='RC50-A01');assert.equal(duplicate.representative_listing_id,'RC50-A05');
  const outlier=admission.find(r=>r.listing_id==='RC50-A06');
  assert.deepEqual([outlier.n,outlier.q1,outlier.q3,outlier.lower_fence,outlier.upper_fence],[5,95000,105000,65000,135000]);
  const expected=admission.filter(r=>!r.exclusion_reason).map(r=>r.listing_id);
  for(const size of [1,7,12,49,50]){
   const ids=[];let cursor={};
   for(let page=0;page<30;page++){
    const rows=await rpc('get_price_research_canary_keyset_v4',{p_snapshot_id:snapshot,p_limit:size,...cursor});
    ids.push(...rows.map(r=>r.k_listing_id));if(rows.length<size)break;
    const last=rows.at(-1);cursor={p_cursor_priced_rank:last.k_priced_rank,p_cursor_image_rank:last.k_image_rank,p_cursor_price_usd:last.k_price_usd,p_cursor_created_at:last.k_source_created_at,p_cursor_listing_id:last.k_listing_id};
   }
   assert.deepEqual(ids.toSorted(),expected);assert.equal(new Set(ids).size,22);
  }
  assert.equal(await rpc('get_price_research_snapshot_count',{p_snapshot_id:snapshot}),22);
  const filters={p_brand:'Patek Philippe',p_reference:'7128/1G',p_model:'Nautilus',p_dial_color:'Blue',p_condition:'New'};
  assert.equal(await rpc('get_price_research_snapshot_count',{p_snapshot_id:snapshot,...filters,p_filter_dial:true,p_filter_condition:true}),4);
  const stats=await rpc('get_price_research_snapshot_stats',{p_snapshot_id:snapshot,...filters});
  assert.equal(stats.length,1);assert.deepEqual([stats[0].qualified_count,stats[0].avg_price,stats[0].q1_price,stats[0].q3_price],[4,97500,95000,105000]);
  const dial=await rpc('get_price_research_snapshot_dial_facets',{p_snapshot_id:snapshot,p_brand:'Patek Philippe',p_reference:'7128/1G'});
  assert.deepEqual(dial,[{dial_color:'Blue',listing_count:4}]);
  const conditions=await rpc('get_price_research_snapshot_facets',{p_snapshot_id:snapshot,p_brand:'Patek Philippe',p_reference:'7128/1G'});
  assert.deepEqual(conditions,[{condition:'New',listing_count:4}]);
  const floorSnapshot=await rpc('open_trading_floor_keyset_snapshot',{p_ttl_seconds:3600});
  const broad=(await rpc('get_price_research_snapshot_breakdown',{p_snapshot_id:floorSnapshot,p_brand:null}))[0];
  assert.deepEqual([broad.source_observations,broad.included_count,broad.excluded_duplicates,broad.excluded_iqr_outliers,broad.retained_audit_evidence_count],[50,22,1,1,28]);
  assert.equal(broad.plausibility_floor,null,'A broad filter must not invent one cross-reference plausibility floor');
  const narrow=(await rpc('get_price_research_snapshot_breakdown',{p_snapshot_id:floorSnapshot,...filters,p_filter_dial:true,p_filter_condition:true}))[0];
  assert.deepEqual([narrow.source_observations,narrow.included_count,narrow.excluded_duplicates,narrow.excluded_iqr_outliers],[6,4,1,1]);
  const excluded=(await db.query('select priced_rank,image_rank,price_usd,source_created_at::text,listing_id from wf_canonical_staging.keyset_snapshot_members where snapshot_id=wf_canonical_staging.snapshot_data_id($1) and listing_id=$2',[snapshot,'RC50-A06'])).rows[0];
  const fault=await rpc('get_price_research_canary_keyset_v4',{p_snapshot_id:snapshot,p_cursor_priced_rank:excluded.priced_rank,p_cursor_image_rank:excluded.image_rank,p_cursor_price_usd:excluded.price_usd,p_cursor_created_at:excluded.source_created_at,p_cursor_listing_id:excluded.listing_id},400);
  assert.equal(fault.code,'22023');
  // Offer identity is independent of display-name equality and currency rounding.
  const key=async payload=>(await db.query('select wf_canonical_staging.research_offer_group_key_v2($1) k',[payload])).rows[0].k;
  const a={listing_id:'TEST-A',seller_display_name:'Same public name',brand:'Rolex',reference:'126610LN',dial_color:'Black',condition:'New',year:2024,price_usd:10000.1};
  assert.notEqual(await key(a),await key({...a,listing_id:'TEST-B'}));
  assert.notEqual(await key({...a,seller_id:'TEST-POSTER'}),await key({...a,seller_id:'TEST-POSTER',price_usd:10000.2}));
  assert.notEqual(await key({...a,seller_id:'TEST-POSTER'}),await key({...a,seller_id:'TEST-POSTER',year:2023}));
  assert.equal(await key({...a,seller_id:'TEST-POSTER'}),await key({...a,seller_id:'TEST-POSTER',listing_id:'REPOST'}));
  assert.equal(await key({...a,seller_id:'TEST-POSTER',price_usd:'10000.10'}),await key({...a,seller_id:'TEST-POSTER',price_usd:'10000.1000'}));
  await db.query('begin');
  const root=(await db.query('select wf_canonical_staging.snapshot_data_id($1) id',[snapshot])).rows[0].id;
  await db.query("update wf_canonical_staging.keyset_snapshot_registry set expires_at=now()-interval '1 second' where surface='price_research'");
  const alias=(await db.query('select public.open_price_research_keyset_snapshot(3600) id')).rows[0].id;
  assert.notEqual(alias,snapshot);assert.equal((await db.query('select wf_canonical_staging.snapshot_data_id($1) id',[alias])).rows[0].id,root);
  assert.equal((await db.query('select public.get_price_research_snapshot_count($1)::int n',[alias])).rows[0].n,22);
  const revision=(await db.query('select publication_revision from wf_canonical_staging.keyset_snapshot_registry where snapshot_id=$1',[root])).rows[0].publication_revision;
  await db.query('delete from wf_canonical_staging.keyset_snapshot_registry where snapshot_id=$1',[alias]);
  await db.query('delete from wf_canonical_staging.keyset_snapshot_registry where snapshot_id=$1',[root]);
  assert.equal((await db.query('select count(*)::int n from wf_canonical_staging.publication_research_outcomes_v2 where publication_revision=$1',[revision])).rows[0].n,24);
  await db.query('rollback');
  const privileges=(await db.query("select role,has_table_privilege(role,'wf_canonical_staging.research_snapshot_admission_v2','SELECT') allowed from unnest(array['anon','authenticated','service_role']) role")).rows;
  assert.ok(privileges.every(r=>!r.allowed));
  assert.equal((await db.query('select count(*)::int n from public.trading_floor_ready_view_v2')).rows[0].n,50);
  report.status='PASS';report.candidate_count=24;report.display_count=22;report.exclusions={reposts:1,iqr_outliers:1};
  report.checks=['Five real PostgREST page sizes exhaust the same 22 unique IDs','24 private candidates retain original quartiles; exact cohort remains four offers averaging USD 97500',
   'Browse/count/dial/condition facets share frozen admission','Excluded-member cursor is rejected by actual PostgREST with 22023',
   'Expired traversal renews against the same root and keeps display total without copying payloads','Names, rounded prices and different years cannot establish duplicate offer identity',
   'Broad counts reconcile 50 inputs to 22 displayed plus 28 exclusions without cross-reference IQR',
   'Publication outcomes survive disposable snapshot-cache deletion; deletion is rolled back',
   'Private admission ledger denies ordinary roles; Trading Floor remains unchanged at 50'];
 }catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0]};process.exitCode=1;}
 finally{await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('RESEARCH_ADMISSION_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
