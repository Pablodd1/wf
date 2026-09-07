'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');
const {assertDiscoveryOrder}=require('../../api/_lib/canary-discovery.cjs');
let latestReport;
async function main(){
 const migrationSource=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909200000_snapshot_browse_discovery.sql'),'utf8').replaceAll('\r\n','\n');
 const caseGroupsSource=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909210000_snapshot_browse_case_groups.sql'),'utf8').replaceAll('\r\n','\n');
 const report=latestReport={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,migration_sha256_lf:require('node:crypto').createHash('sha256').update(migrationSource).digest('hex'),case_groups_migration_sha256_lf:require('node:crypto').createHash('sha256').update(caseGroupsSource).digest('hex'),databases:[]};
 for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
  const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
  const env=Object.fromEntries(info.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  const binding=info.NetworkSettings.Ports['5432/tcp']?.[0],network=info.NetworkSettings.Networks['wf-final-disposable'];assert.ok(network);
  const host=binding?'127.0.0.1':network.IPAddress,port=binding?Number(binding.HostPort):5432;
  assert.ok(host==='127.0.0.1'||/^172\.18\.0\.[0-9]+$/.test(host));
  const db=new Client({host,port,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
  try{
   await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");
   const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260909200000_snapshot_browse_discovery.sql'),'utf8').replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');await db.query(migration);
   const before=(await db.query('SELECT count(*)::int n FROM wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n;
   const snapshot=async(surface,members=73)=>(await db.query("INSERT INTO wf_canonical_staging.keyset_snapshot_registry(surface,member_count,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING snapshot_id",[surface,members])).rows[0].snapshot_id;
   const browse=async(s,surface,brand=null,model=null)=>(await db.query('SELECT public.get_canary_snapshot_browse_v1($1,$2,$3,$4) result',[s,surface,brand,model])).rows[0].result;
   // Warm genuine pre-correction caches, then apply the additive function change.
   // Repeated references cross case-variant brand/model labels, and a null-model
   // reference crosses brand/reference casing without inventing a model value.
   const caseFixtures=[
    {id:'SYNTHETIC-CASE-0',brand:'Rolex',model:'Day-Date',reference:'228238',intent:'WTS',image:null},
    {id:'SYNTHETIC-CASE-1',brand:'rolex',model:'Day-date',reference:'228238',intent:'WTS',image:'https://example.invalid/original/case-1.jpg'},
    {id:'SYNTHETIC-CASE-2',brand:'ROLEX',model:'day-date',reference:'228238',intent:'WTS',image:'https://example.invalid/original/case-2.jpg'},
    {id:'SYNTHETIC-CASE-3',brand:'Rolex',model:null,reference:'ABC1',intent:'WTS',image:'https://example.invalid/original/case-3.jpg'},
    {id:'SYNTHETIC-CASE-4',brand:'rolex',model:null,reference:'abc1',intent:'WTB',image:'https://example.invalid/original/case-4.jpg'},
    {id:'SYNTHETIC-CASE-5',brand:'Patek Philippe',model:'Source model',reference:'5711',intent:'WTS',image:'https://example.invalid/original/case-5.jpg'},
   ];
   const caseTrading=await snapshot('trading_floor',6),caseResearch=await snapshot('price_research',6);
   for(const id of [caseTrading,caseResearch]) {
    for(const [index,item] of caseFixtures.entries()) {
     const price=item.intent==='WTS'?10000+index:null;
     await db.query(`INSERT INTO wf_canonical_staging.keyset_snapshot_members
      (snapshot_id,priced_rank,image_rank,price_usd,source_created_at,listing_id,payload)
      VALUES($1,$2,$3,$4,'2026-09-01'::timestamptz,$5,$6::jsonb)`,
      [id,price===null?2:1,item.image?1:2,price,item.id,JSON.stringify({
       brand:item.brand,model:item.model,reference:item.reference,intent:item.intent,price_usd:price,
       image_status:item.image?'SOURCE_IMAGE_PRESENT':'NO_IMAGE',image_key:item.image?'source/'+item.id:null,
       image_url:item.image,raw_message_text:'[SYNTHETIC FIXTURE] '+item.brand+' '+(item.model||'')+' '+item.reference,
      })]);
    }
   }
   await db.query(`INSERT INTO wf_canonical_staging.research_snapshot_admission_v2
    (snapshot_id,listing_id,cohort_key,offer_group_key,representative_listing_id,exclusion_reason,plausibility_floor,plausible_cohort_count)
    SELECT $1,listing_id,'{}'::jsonb,listing_id,listing_id,
      CASE WHEN listing_id='SYNTHETIC-CASE-2' THEN 'REPOST_DUPLICATE' ELSE NULL END,0,4
    FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 AND priced_rank=1`,[caseResearch]);
   const frozenCaseState=async()=>({
    members:(await db.query('SELECT snapshot_id,listing_id,payload FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=ANY($1::uuid[]) ORDER BY snapshot_id,listing_id',[[caseTrading,caseResearch]])).rows,
    caches:(await db.query('SELECT snapshot_id,entries,countries,regions FROM wf_canonical_staging.snapshot_browse_cache_v1 WHERE snapshot_id=ANY($1::uuid[]) ORDER BY snapshot_id',[[caseTrading,caseResearch]])).rows,
   });
   const legacyCase=await browse(caseTrading,'trading_floor','Rolex');
   assert.equal(legacyCase.brands.filter(b=>b.brand.toLowerCase()==='rolex').length,3,'Fixture must reproduce separated case groups');
   assert.equal(legacyCase.models.filter(m=>m.model.toLowerCase()==='day-date').length,3);
   await browse(caseResearch,'price_research','Rolex');
   const caseBefore=await frozenCaseState();
   assert.equal(caseBefore.caches.length,2);
   assert.equal(caseBefore.caches.find(c=>c.snapshot_id===caseTrading).entries.length,6,'Raw cache must retain every source spelling');
   await db.query(caseGroupsSource.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   const caseResults=[];
   for(const [id,surface,expectedRolex,expectedDay,expectedUnknown] of [
    [caseTrading,'trading_floor',5,3,2],[caseResearch,'price_research',3,2,1],
   ]) {
    const summary=await browse(id,surface,'rOlEx');
    const rolexBrands=summary.brands.filter(b=>b.brand.toLowerCase()==='rolex');
    assert.equal(rolexBrands.length,1,'Case variants must be one selectable brand');
    assert.equal(rolexBrands[0].listing_count,expectedRolex);
    assert.equal(rolexBrands[0].model_count,2);
    assert.equal(rolexBrands[0].reference_count,2);
    assert.ok(caseFixtures.some(f=>f.brand===rolexBrands[0].brand),'Brand display spelling must exist in source');
    assert.equal(summary.models.length,2);
    assert.equal(summary.models.reduce((n,m)=>n+m.listing_count,0),expectedRolex);
    assert.equal(summary.references.length,2);
    assert.equal(new Set(summary.references.map(r=>r.reference.toLowerCase())).size,2,'No repeated references from model case variants');
    const day=summary.models.find(m=>m.model.toLowerCase()==='day-date');
    assert.equal(day.listing_count,expectedDay);
    assert.equal(day.reference_count,1);
    assert.ok(caseFixtures.some(f=>f.model===day.model),'Model display spelling must exist in source');
    const selected=await browse(id,surface,'ROLEX','dAy-DaTe');
    assert.equal(selected.references.length,1);
    assert.equal(selected.references[0].listing_count,expectedDay);
    assert.equal(selected.references[0].reference,'228238');
    assert.equal(selected.references[0].image_url,'https://example.invalid/original/case-1.jpg');
    const unknown=await browse(id,surface,'rolex','Reference-only listings');
    assert.equal(unknown.references.length,1);
    assert.equal(unknown.references[0].listing_count,expectedUnknown);
    assert.equal(unknown.references[0].model,null);
    assert.equal(unknown.references[0].reference,'ABC1');
    assert.equal(unknown.references[0].image_url,'https://example.invalid/original/case-3.jpg');
    assert.equal(summary.models.find(m=>m.model==='Reference-only listings').listing_count,expectedUnknown);
    assert.equal(summary.brands.reduce((n,b)=>n+b.listing_count,0),expectedRolex+1);
    caseResults.push({surface,fixture_members:6,admitted_listings:expectedRolex+1,rolex_listing_count:expectedRolex,
     case_group_listing_count:expectedDay,reference_only_listing_count:expectedUnknown,unique_rolex_references:2});
   }
   for(const [model,expected] of [['DAY-date',3],['Reference-only listings',2]]) {
    assert.equal(Number((await db.query('SELECT public.get_trading_floor_snapshot_count($1,p_brand=>$2,p_model=>$3) n',[caseTrading,'rOlEx',model])).rows[0].n),expected);
    for(const fn of ['get_trading_floor_canary_keyset_v4','get_trading_floor_discovery_keyset_v1']) {
     const filtered=(await db.query('SELECT k_listing_id,payload FROM public.'+fn+'($1,100,p_brand=>$2,p_model=>$3)',[caseTrading,'rOlEx',model])).rows;
     assert.equal(filtered.length,expected,'Merged model menu counts must match listing filters');
     assert.equal(new Set(filtered.map(r=>r.k_listing_id)).size,expected);
     if(model==='Reference-only listings')assert.ok(filtered.every(r=>r.payload.model===null));
    }
   }
   assert.deepEqual(await frozenCaseState(),caseBefore,'Case grouping must not rewrite raw cache entries or frozen source payloads');
   const trading=await snapshot('trading_floor'),research=await snapshot('price_research');
   for(const id of [trading,research])await db.query(`INSERT INTO wf_canonical_staging.keyset_snapshot_members(snapshot_id,priced_rank,image_rank,price_usd,source_created_at,listing_id,payload)
    SELECT $1,CASE WHEN n<=30 THEN 1 ELSE 2 END,CASE WHEN n%3=0 THEN 2 ELSE 1 END,CASE WHEN n<=30 THEN 10000+n ELSE NULL END,'2026-09-01'::timestamptz+(n||' microseconds')::interval,'SYNTHETIC-BROWSE-'||lpad(n::text,3,'0'),
     jsonb_build_object('brand',CASE WHEN n%2=0 THEN 'Rolex' ELSE 'Patek Philippe' END,'model',CASE WHEN n%5=0 THEN NULL ELSE 'Source model' END,'reference','REF-'||n,'intent',CASE WHEN n<=30 THEN 'WTS' ELSE 'WTB' END,'image_status',CASE WHEN n%3=0 THEN 'NO_IMAGE' ELSE 'SOURCE_IMAGE_PRESENT' END,'image_key',CASE WHEN n%3=0 THEN NULL ELSE 'source/'||n END,'image_url',CASE WHEN n%3=0 THEN NULL ELSE 'https://example.invalid/original/'||n||'.jpg' END,'location_country','Source country','category','wristwatches','price_usd',CASE WHEN n<=30 THEN 10000+n ELSE NULL END)
    FROM generate_series(1,73) n`,[id]);
   await db.query(`INSERT INTO wf_canonical_staging.research_snapshot_admission_v2(snapshot_id,listing_id,cohort_key,offer_group_key,representative_listing_id,exclusion_reason,plausibility_floor,plausible_cohort_count)
    SELECT $1,listing_id,'{}'::jsonb,listing_id,listing_id,CASE WHEN listing_id='SYNTHETIC-BROWSE-030' THEN 'REPOST_DUPLICATE' ELSE NULL END,0,29 FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 AND priced_rank=1`,[research]);
   await db.query("UPDATE wf_canonical_staging.keyset_snapshot_members SET payload=payload||jsonb_build_object('location_region',CASE WHEN right(listing_id,1)::int%2=0 THEN 'Source city, district' ELSE 'Source region' END) WHERE snapshot_id=ANY($1::uuid[])",[[trading,research]]);
   const all=await browse(trading,'trading_floor');assert.equal(all.brands.reduce((s,b)=>s+b.listing_count,0),73);assert.deepEqual(new Set(all.brands.map(b=>b.brand)),new Set(['Rolex','Patek Philippe']));assert.deepEqual(all.availableCountries,['Source country']);
   assert.deepEqual(all.availableRegions,['Source city, district','Source region']);
   const selectedRegions=JSON.stringify(all.availableRegions);
   assert.equal(Number((await db.query('SELECT public.get_trading_floor_snapshot_count($1,p_region=>$2) n',[trading,selectedRegions])).rows[0].n),73);
   assert.equal(Number((await db.query('SELECT public.get_trading_floor_snapshot_count($1,p_region=>$2) n',[trading,JSON.stringify(['Source city, district'])])).rows[0].n),36);
   for(const fn of ['get_trading_floor_canary_keyset_v4','get_trading_floor_discovery_keyset_v1'])assert.equal((await db.query('SELECT * FROM public.'+fn+'($1,100,p_region=>$2)',[trading,selectedRegions])).rows.length,73);
   const rolex=await browse(trading,'trading_floor','Rolex');assert.equal(rolex.references.length,36);assert.equal(rolex.models.reduce((s,m)=>s+m.listing_count,0),36);
   const unknown=await browse(trading,'trading_floor','Rolex','Reference-only listings');assert.equal(unknown.references.length,7);assert.ok(unknown.references.every(r=>r.model===null));
   assert.equal(Number((await db.query("SELECT public.get_trading_floor_snapshot_count($1,p_brand=>'Rolex',p_model=>'Reference-only listings') n",[trading])).rows[0].n),7);
   const admitted=await browse(research,'price_research');assert.equal(admitted.brands.reduce((s,b)=>s+b.listing_count,0),29);
   for(const r of rolex.references){const n=Number(r.reference.slice(4));assert.equal(r.image_url,n%3===0?null:`https://example.invalid/original/${n}.jpg`);}
   const oracle=(await db.query('SELECT listing_id FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 ORDER BY priced_rank,image_rank,md5(listing_id) COLLATE "C",listing_id',[trading])).rows.map(r=>r.listing_id);
   let last=null,ids=[],pages=0;
   do{const args=[trading,7,null,null,null,null,null,null,null,false,false,last?.k_priced_rank??null,last?.k_image_rank??null,last?.k_price_usd??null,last?.k_source_created_at??null,last?.k_listing_id??null];
    // Return timestamps as text to preserve PostgreSQL microseconds through pg.
    const rows=(await db.query('SELECT k_priced_rank,k_image_rank,k_price_usd,k_source_created_at::text,k_listing_id,payload FROM public.get_trading_floor_discovery_keyset_v1('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args)).rows;
    if(!rows.length)break;assertDiscoveryOrder(rows);ids.push(...rows.map(r=>r.k_listing_id));last=rows.at(-1);pages++;
   }while(pages<20);
   assert.deepEqual(ids,oracle);assert.equal(new Set(ids).size,73);
   const canonical=(await db.query('SELECT k_listing_id FROM public.get_trading_floor_canary_keyset_v4($1,100)',[trading])).rows.map(r=>r.k_listing_id);assert.notDeepEqual(ids,canonical);
   const canonicalOracle=(await db.query('SELECT listing_id FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 ORDER BY priced_rank,image_rank,price_usd DESC NULLS LAST,source_created_at DESC,listing_id',[trading])).rows.map(r=>r.listing_id);assert.deepEqual(canonical,canonicalOracle);
   const reject=async(sql,args)=>{await db.query('SAVEPOINT refusal');await assert.rejects(db.query(sql,args),e=>e.code==='22023');await db.query('ROLLBACK TO SAVEPOINT refusal');};
   await reject('SELECT public.get_canary_snapshot_browse_v1($1,$2,NULL,NULL)',[trading,'price_research']);
   await reject("SELECT * FROM public.get_trading_floor_discovery_keyset_v1($1,p_cursor_listing_id=>'not-a-member')",[trading]);
   await reject("SELECT * FROM public.get_trading_floor_discovery_keyset_v1($1,p_cursor_priced_rank=>1,p_cursor_image_rank=>1,p_cursor_price_usd=>1,p_cursor_created_at=>'2026-09-01',p_cursor_listing_id=>'SYNTHETIC-BROWSE-001')",[trading]);
   const alias=(await db.query("INSERT INTO wf_canonical_staging.keyset_snapshot_registry(surface,member_count,data_snapshot_id,expires_at) VALUES('trading_floor',73,$1,now()+interval '1 hour') RETURNING snapshot_id",[trading])).rows[0].snapshot_id;
   assert.deepEqual((await browse(alias,'trading_floor')).brands,all.brands);
   for(const role of ['anon','authenticated']){assert.equal((await db.query("SELECT has_function_privilege($1,'public.get_canary_snapshot_browse_v1(uuid,text,text,text)','EXECUTE') ok",[role])).rows[0].ok,false);}
   for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_table_privilege($1,'wf_canonical_staging.snapshot_browse_cache_v1','SELECT') ok",[role])).rows[0].ok,false);
   await db.query("UPDATE wf_canonical_staging.keyset_snapshot_registry SET expires_at=now()-interval '1 second' WHERE snapshot_id=$1",[trading]);await reject('SELECT public.get_canary_snapshot_browse_v1($1,$2,NULL,NULL)',[trading,'trading_floor']);
   assert.equal((await db.query('SELECT count(*)::int n FROM wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n,before);
   const scale=await snapshot('trading_floor');
   await db.query(`INSERT INTO wf_canonical_staging.keyset_snapshot_members(snapshot_id,priced_rank,image_rank,price_usd,source_created_at,listing_id,payload)
    SELECT $1,2,1,NULL,'2026-09-01'::timestamptz,'SYNTHETIC-SCALE-'||lpad(n::text,6,'0'),jsonb_build_object('brand','Rolex','model','Source model','reference','REF-'||(n%1000),'intent','WTB') FROM generate_series(1,100000) n`,[scale]);
   await db.query('ANALYZE wf_canonical_staging.keyset_snapshot_members');
   const scaleIds=(await db.query('SELECT listing_id FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 ORDER BY priced_rank,image_rank,md5(listing_id) COLLATE "C",listing_id',[scale])).rows.map(r=>r.listing_id);
   const boundary=scaleIds[99000],start=Date.now();
   await db.query("SET LOCAL plan_cache_mode='force_generic_plan'");
   const deep=(await db.query("SELECT k_listing_id FROM public.get_trading_floor_discovery_keyset_v1($1,100,p_cursor_priced_rank=>2,p_cursor_image_rank=>1,p_cursor_created_at=>'2026-09-01',p_cursor_listing_id=>$2)",[scale,boundary])).rows.map(r=>r.k_listing_id);
   const deepMs=Date.now()-start;assert.deepEqual(deep,scaleIds.slice(99001,99101));assert.ok(deepMs<10000,'Deep indexed page exceeded bounded local gate');
   const plan=(await db.query('EXPLAIN (ANALYZE,FORMAT JSON) SELECT listing_id FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 AND (priced_rank,image_rank,md5(listing_id) COLLATE "C",listing_id)>(2,1,md5($2) COLLATE "C",$2) ORDER BY priced_rank,image_rank,md5(listing_id) COLLATE "C",listing_id LIMIT 100',[scale,boundary])).rows[0]['QUERY PLAN'][0];
   assert.match(JSON.stringify(plan),/snapshot_discovery_order_v1/);
   const browseStart=Date.now(),scaleBrowse=await browse(scale,'trading_floor');assert.equal(scaleBrowse.brands[0].listing_count,100000);const browseMs=Date.now()-browseStart;
   const cacheStart=Date.now();await browse(scale,'trading_floor','Rolex');const cacheMs=Date.now()-cacheStart;
   await db.query('ROLLBACK');report.databases.push({container,database,status:'PASS',members:73,discovery_pages:pages,admitted_research:29,case_group_surfaces:caseResults,case_group_raw_cache_and_payload_unchanged:true,scale_members:100000,deep_page_ms:deepMs,browse_build_ms:browseMs,browse_cached_ms:cacheMs,deep_page_plan:plan,checks:['Complete published taxonomy including null models','Case-variant brands/models/references merge without duplicate reference options','Pre-correction cache entries and source payloads remain byte-equivalent JSON','Merged model counts match both listing orders; research admits only its included rows','Exact original representative image URLs','Research metadata excludes non-admitted rows','Global Discovery has same unique membership, stable lanes and microsecond cursor binding','Default five-field ordering unchanged','Wrong surface, expired snapshot and forged key fail closed','Alias uses root metadata cache; public roles cannot read cache','100,000-member deep page uses Discovery index and exact oracle under generic caller plans','All fixtures and migrations rolled back']});
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{if(latestReport){latestReport.status='FAIL';latestReport.finished_at=new Date().toISOString();latestReport.error={code:e.code||e.name,message:e.message?.slice(0,200)};fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(latestReport,null,2));}console.error('SNAPSHOT_BROWSE_DISCOVERY_TEST_FAILED',e.code||e.name,e.message?.slice(0,200));process.exitCode=1;});
