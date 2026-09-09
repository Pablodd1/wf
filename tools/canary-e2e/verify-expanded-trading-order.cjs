'use strict';
// Synthetic fixtures only, in separately cloned local databases. Every fixture
// and migration is rolled back. Production credentials are never loaded.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');
const {assertSourceImageOrder}=require('../../api/_lib/canary-source-image-order.cjs');
const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
const root=path.resolve(__dirname,'../..');
const migrationPath=path.join(root,'supabase/migrations/20260910210000_trading_floor_source_images_order.sql');
const migration=fs.readFileSync(migrationPath,'utf8').replaceAll('\r\n','\n');
const sourceLaneSql="(CASE WHEN NULLIF(payload->>'parent_listing_id','') IS NOT NULL OR payload->>'child_index' IS NOT NULL OR payload->>'is_bundle'='true' THEN 3 WHEN payload->>'image_status'='SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(payload->>'image_key'),'') IS NOT NULL THEN 1 ELSE 2 END)";
const sourceTimeSql="(-extract(epoch FROM source_created_at AT TIME ZONE 'UTC'))";
const foundation=fs.readFileSync(path.join(root,'supabase/migrations/20260910160000_expanded_source_candidate_evidence.sql'),'utf8').replaceAll('\r\n','\n');
const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,
 migration_sha256_lf:hash(migration),foundation_sha256_lf:hash(foundation),databases:[]};
const output=process.env.WF_PRODUCT_ORDER_REPORT;
if(output && fs.existsSync(output))fs.copyFileSync(output,output.replace(/\.json$/,'.prior-'+Date.now()+'.json'));
function save(){if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',JSON.stringify(report,null,2)+'\n');fs.renameSync(output+'.tmp',output);}}
const docker=(...args)=>execFileSync(process.platform==='win32'?'wsl':'docker',process.platform==='win32'?['--user','root','--exec','docker',...args]:args,{encoding:'utf8',windowsHide:true});
const strip=sql=>sql.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
async function main(){
 for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']) {
  const info=JSON.parse(docker('inspect',container))[0];assert.equal(info.State.Running,true,'Start the named local container before this test');
  const binding=info.NetworkSettings.Ports['5432/tcp']?.[0];
  const host=binding?'127.0.0.1':info.NetworkSettings.Networks['wf-final-disposable']?.IPAddress;
  assert.ok(host==='127.0.0.1'||(process.platform==='linux'&&/^172\.18\.0\.[0-9]+$/.test(host)),'Only the inspected disposable Docker network is allowed');
  const env=Object.fromEntries(info.Config.Env.map(value=>[value.slice(0,value.indexOf('=')),value.slice(value.indexOf('=')+1)]));
  const database=process.env.WF_PRODUCT_ORDER_DATABASE||'wf_expanded_product_test_20260908';
  assert.match(database,/^wf_expanded_product_[a-z0-9_]+$/,'Only an explicitly named disposable product database is allowed');
  const db=new Client({host,port:binding?Number(binding.HostPort):5432,user:'postgres',password:env.POSTGRES_PASSWORD,database});
  await db.connect();
  try {
   await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");
   const state=async()=>(await db.query(`SELECT
    (SELECT count(*) FROM wf_canonical_staging.mariadb_raw_source_rows)::text raw,
    (SELECT count(*) FROM wf_canonical_staging.mariadb_canary_published_listings_v2)::text published,
    (SELECT count(*) FROM wf_canonical_staging.keyset_snapshot_members)::text members`)).rows[0];
   const before=await state();assert.deepEqual(before,{raw:'0',published:'0',members:'0'},'Schema-only test database required');
   await db.query(strip(foundation));await db.query(strip(migration));
   const indexDefinition=(await db.query("SELECT pg_get_indexdef(indexrelid) definition,indisvalid,indisready FROM pg_index WHERE indexrelid='wf_canonical_staging.snapshot_source_images_order_v1'::regclass")).rows[0];
   assert.equal(indexDefinition.indisvalid,true);assert.equal(indexDefinition.indisready,true);
   const equivalence=(await db.query(`WITH edge(payload,source_created_at) AS (VALUES
    ('{}'::jsonb,NULL::timestamptz),('null'::jsonb,'0001-01-01 UTC'::timestamptz),
    ('{"image_status":"SOURCE_IMAGE_PRESENT","image_key":" "}'::jsonb,'1960-01-01 UTC'::timestamptz),
    ('{"image_status":"SOURCE_IMAGE_PRESENT","image_key":"original","child_index":0}'::jsonb,'2026-09-01 00:00:00.123456 UTC'::timestamptz),
    ('{"image_status":"SOURCE_IMAGE_PRESENT","image_key":"original","parent_listing_id":""}'::jsonb,'2026-09-01 00:00:00.123455 UTC'::timestamptz),
    ('{"image_status":"SOURCE_IMAGE_PRESENT","image_key":"original","is_bundle":true}'::jsonb,'2026-09-01 UTC'::timestamptz))
    SELECT count(*)::integer n FROM edge WHERE ${sourceLaneSql} IS DISTINCT FROM wf_canonical_staging.trading_source_lane_v1(payload)
     OR ${sourceTimeSql} IS DISTINCT FROM wf_canonical_staging.trading_source_time_v1(source_created_at)`)).rows[0].n;
   assert.equal(equivalence,0,'Direct index expressions must equal retained cursor helpers, including nulls and microseconds');
   const makeSnapshot=async(surface='trading_floor',count=9)=>(await db.query("INSERT INTO wf_canonical_staging.keyset_snapshot_registry(surface,member_count,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING snapshot_id",[surface,count])).rows[0].snapshot_id;
   const snapshot=await makeSnapshot();
   const fixture=[
    ['image-early',1,null,'2026-09-01T00:00:00.123455Z','US','New York, NY','watch'],
    ['image-late',1,null,'2026-09-01T00:00:00.123456Z','CH','Geneva','watches'],
    ['image-Ä',1,100,'2026-09-01T00:00:00.123456Z','US','New York, NY','wristwatches'],
    ['imageless-high-price',2,990000,'2026-09-07T00:00:00Z','CH','Geneva','WATCH'],
    ['imageless-unknown',2,null,'2026-09-07T00:00:00Z',null,'US','watches'],
    ['child-last',3,999999,'2026-09-08T00:00:00Z','US','New York, NY','watches'],
    ['child-observed-time',3,null,'2026-09-07T00:00:00Z','CH','Geneva','watches'],
    ['not-watch',2,null,'2026-09-01T00:00:00Z','US','New York, NY','accessories'],
    ['empty-model',2,null,'2026-09-01T00:00:00Z','US','New York, NY','watches'],
   ];
   for(const [id,lane,price,date,country,region,category] of fixture) {
    const payload={listing_id:id,brand:'Rolex',model:id==='empty-model'?null:'Source model',reference:id,
     intent:price===null?'WTB':'WTS',category,location_country:country,location_region:region,price_usd:price,
     image_status:lane===1?'SOURCE_IMAGE_PRESENT':'NO_IMAGE',image_key:lane===1?'original/'+id:null,
     image_url:lane===1?'https://example.invalid/original/'+id+'.jpg':null,
     parent_listing_id:lane===3?'SYNTHETIC-PARENT':null,child_index:lane===3?1:null,
     raw_message_text:lane===3?null:'[SYNTHETIC FIXTURE] '+id,
     source_context_text:lane===3?'[SYNTHETIC CHILD] exact green dial offering':null,
     source_created_at:id==='child-observed-time'?null:date,source_created_at_text:id==='child-observed-time'?'2026-09-07 00:00:00':null};
    await db.query(`INSERT INTO wf_canonical_staging.keyset_snapshot_members(snapshot_id,priced_rank,image_rank,price_usd,source_created_at,listing_id,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,[snapshot,price===null?2:1,lane===1?1:2,price,date,id,payload]);
   }
   const frozen=(await db.query('SELECT listing_id,payload FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 ORDER BY listing_id',[snapshot])).rows;
   const fetch=async(last=null,filters={})=>{
    const args=[snapshot,2,filters.brand??null,filters.model??null,filters.intent??null,filters.query??null,filters.category??null,filters.country??null,filters.region??null,false,false,
     last?.k_priced_rank??null,last?.k_image_rank??null,last?.k_price_usd??null,last?.k_source_created_at??null,last?.k_listing_id??null];
    return (await db.query('SELECT k_priced_rank,k_image_rank,k_price_usd,k_source_created_at::text,k_listing_id,k_source_lane,payload FROM public.get_trading_floor_source_images_keyset_v1('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args)).rows;
   };
   const all=async(filters={})=>{let last=null,rows=[],pages=0;for(;;){const page=await fetch(last,filters);if(!page.length)break;assertSourceImageOrder(page);rows.push(...page);last=page.at(-1);assert.ok(++pages<20);}assertSourceImageOrder(rows);return rows;};
   const rows=await all();assert.equal(rows.length,9);assert.equal(new Set(rows.map(r=>r.k_listing_id)).size,9);
   assert.deepEqual(rows.map(r=>r.k_listing_id),['image-late','image-Ä','image-early','imageless-high-price','imageless-unknown','empty-model','not-watch','child-last','child-observed-time']);
   assert.equal(rows.at(-1).payload.source_created_at,null,'Frozen observed-time key must not fabricate a source timestamp');
   const cases=[{}, {category:'watches'},{country:'["US","CH"]',region:'["New York, NY"]'},
    {country:'["CH"]',region:'["Geneva"]'},{country:'US',region:'US'},
    {query:'exact green dial'},{model:'Reference-only listings'},{brand:'rolex',intent:'WTB'}];
   for(const filter of cases){const selected=await all(filter);const count=Number((await db.query('SELECT public.get_trading_floor_snapshot_count($1,$2,$3,$4,$5,$6,$7,$8,false,false) n',[snapshot,filter.brand??null,filter.model??null,filter.intent??null,filter.query??null,filter.category??null,filter.country??null,filter.region??null])).rows[0].n);assert.equal(selected.length,count,JSON.stringify(filter));
    for(const fn of ['get_trading_floor_canary_keyset_v4','get_trading_floor_discovery_keyset_v1']) {
     const old=(await db.query('SELECT k_listing_id FROM public.'+fn+'($1,100,$2,$3,$4,$5,$6,$7,$8)',[snapshot,filter.brand??null,filter.model??null,filter.intent??null,filter.query??null,filter.category??null,filter.country??null,filter.region??null])).rows.map(r=>r.k_listing_id).sort();
     assert.deepEqual(old,selected.map(r=>r.k_listing_id).sort(),fn+' membership parity');
    }
   }
   assert.equal((await all({country:'US',region:'US'})).length,0,'A source region is not an inferred country');
   assert.equal((await all({query:'exact green dial'})).length,2,'Only exact child context participates in child search');
   const reject=async(action)=>{await db.query('SAVEPOINT reject_case');await assert.rejects(action,error=>error.code==='22023');await db.query('ROLLBACK TO SAVEPOINT reject_case');};
   await reject(()=>fetch({...rows[0],k_price_usd:200}));await reject(()=>fetch({...rows[0],k_listing_id:'unknown'}));
   const wrong=await makeSnapshot('price_research');await reject(()=>db.query('SELECT * FROM public.get_trading_floor_source_images_keyset_v1($1)',[wrong]));
   await db.query("UPDATE wf_canonical_staging.keyset_snapshot_registry SET expires_at=now()-interval '1 minute' WHERE snapshot_id=$1",[wrong]);await reject(()=>db.query('SELECT * FROM public.get_trading_floor_source_images_keyset_v1($1)',[wrong]));
   assert.deepEqual((await db.query('SELECT listing_id,payload FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 ORDER BY listing_id',[snapshot])).rows,frozen);
   const scale=await makeSnapshot('trading_floor',100000);
   await db.query(`INSERT INTO wf_canonical_staging.keyset_snapshot_members(snapshot_id,priced_rank,image_rank,price_usd,source_created_at,listing_id,payload)
    SELECT $1,2,CASE WHEN n%3=0 THEN 1 ELSE 2 END,NULL,'2026-09-01'::timestamptz+(n||' microseconds')::interval,
     'SYNTHETIC-SCALE-'||lpad(n::text,6,'0'),jsonb_build_object('image_status',CASE WHEN n%3=0 THEN 'SOURCE_IMAGE_PRESENT' ELSE 'NO_IMAGE' END,'image_key',CASE WHEN n%3=0 THEN 'original/'||n ELSE NULL END,'parent_listing_id',CASE WHEN n%3=2 THEN 'parent' ELSE NULL END) FROM generate_series(1,100000)n`,[scale]);
   await db.query('ANALYZE wf_canonical_staging.keyset_snapshot_members');
   const boundary=(await db.query(`SELECT listing_id,source_created_at::text,${sourceLaneSql} lane FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 ORDER BY ${sourceLaneSql},${sourceTimeSql},listing_id COLLATE "C" OFFSET 99000 LIMIT 1`,[scale])).rows[0];
   const plan=(await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT listing_id FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 AND (${sourceLaneSql},${sourceTimeSql},listing_id COLLATE "C") > ($2,wf_canonical_staging.trading_source_time_v1($3::timestamptz),$4 COLLATE "C") ORDER BY ${sourceLaneSql},${sourceTimeSql},listing_id COLLATE "C" LIMIT 100`,[scale,boundary.lane,boundary.source_created_at,boundary.listing_id])).rows[0]['QUERY PLAN'][0];
   assert.match(JSON.stringify(plan),/snapshot_source_images_order_v1/);assert.ok(plan['Execution Time']<1000,'Deep keyset index scan must remain bounded');
   const started=performance.now();const deep=(await db.query('SELECT * FROM public.get_trading_floor_source_images_keyset_v1($1,100,p_cursor_priced_rank=>2,p_cursor_image_rank=>2,p_cursor_created_at=>$2,p_cursor_listing_id=>$3)',[scale,boundary.source_created_at,boundary.listing_id])).rows;const rpcMs=performance.now()-started;
   assert.equal(deep.length,100);assert.ok(rpcMs<2000,'Actual deep RPC must use a bounded plan');
   await db.query('ROLLBACK');assert.deepEqual(await state(),before);assert.equal((await db.query("SELECT to_regprocedure('public.get_trading_floor_source_images_keyset_v1(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text)') value")).rows[0].value,null);
   report.databases.push({container,database,server_version:(await db.query('SHOW server_version')).rows[0].server_version,
    fixture_rows:9,all_page_order_and_membership:true,filter_cases:cases.length,all_sort_count_parity:true,
    child_evidence_search:true,source_date_not_inferred:true,frozen_payload_unchanged:true,invalid_cursor_snapshot_rejected:true,
    inline_index:indexDefinition,direct_index_cursor_helper_equivalence:true,scale_rows:100000,deep_page_rows:deep.length,deep_index_execution_ms:plan['Execution Time'],deep_rpc_ms:rpcMs,exact_transaction_rollback:true});save();
  } finally {await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.completed_at=new Date().toISOString();save();console.log(JSON.stringify(report));
}
main().catch(error=>{report.status='FAIL';report.error={message:error.message,code:error.code};save();console.error(error);process.exitCode=1;});
