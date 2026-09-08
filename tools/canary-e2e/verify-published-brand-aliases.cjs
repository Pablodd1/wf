'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{Client}=require('./test-dependencies.cjs')('pg');
const source=name=>fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/'+name),'utf8').replaceAll('\r\n','\n');
const migration=source('20260909230000_published_brand_alias_projection.sql');
const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,migration_sha256_lf:crypto.createHash('sha256').update(migration).digest('hex'),databases:[]};
async function main(){
 for(const [container,database] of [['supabase_db_wf-final-disposable','postgres'],['wf-final-disposable-pg18','wf_production_forward_20260907']]){
  const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
  const env=Object.fromEntries(info.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  const binding=info.NetworkSettings.Ports['5432/tcp']?.[0],network=info.NetworkSettings.Networks['wf-final-disposable'];assert.ok(network);
  const host=binding?'127.0.0.1':network.IPAddress,port=binding?Number(binding.HostPort):5432;assert.ok(host==='127.0.0.1'||/^172\.18\.0\.[0-9]+$/.test(host));
  const db=new Client({host,port,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
  try{
   await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");
   for(const name of ['20260909200000_snapshot_browse_discovery.sql','20260909210000_snapshot_browse_case_groups.sql'])await db.query(source(name).replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   const brands=['Rolex','Datejust','Day-date','Gmt-master Ii','TAG Heuer','Tag Heuer','F.P.Journe','F.P. Journe','H. Moser & Cie.','Moser','A. Lange & Sohne','A. Lange & Söhne','Unknown Source Brand'];
   const snapshots={};
   const browse=async(id,surface,brand=null)=>(await db.query('SELECT public.get_canary_snapshot_browse_v1($1,$2,$3,NULL) result',[id,surface,brand])).rows[0].result;
   for(const surface of ['trading_floor','price_research']){
    const id=(await db.query("INSERT INTO wf_canonical_staging.keyset_snapshot_registry(surface,member_count,expires_at) VALUES($1,$2,now()+interval '1hour') RETURNING snapshot_id",[surface,brands.length])).rows[0].snapshot_id;snapshots[surface]=id;
    for(const [i,brand] of brands.entries()){
     const payload={brand,model:'Source model',reference:'SOURCE-REF-'+i,intent:'WTS',price_usd:10000+i,original_price_amount:10000+i,original_price_currency:'USD',image_status:'SOURCE_IMAGE_PRESENT',image_url:'https://example.invalid/original/brand-'+i+'.jpg',image_key:'source/'+i,category:'wristwatches',is_bundle:false,raw_message_text:'[SYNTHETIC FIXTURE] WTS '+brand+' SOURCE-REF-'+i,price_research_eligible:true};
     await db.query("INSERT INTO wf_canonical_staging.keyset_snapshot_members(snapshot_id,priced_rank,image_rank,price_usd,source_created_at,listing_id,payload) VALUES($1,1,1,$2,'2026-09-01'::timestamptz,$3,$4)",[id,10000+i,'SYNTHETIC-ALIAS-'+i,payload]);
    }
    if(surface==='price_research')await db.query("INSERT INTO wf_canonical_staging.research_snapshot_admission_v2(snapshot_id,listing_id,cohort_key,offer_group_key,representative_listing_id,exclusion_reason,plausibility_floor,plausible_cohort_count) SELECT $1,listing_id,'{}'::jsonb,listing_id,listing_id,NULL,0,13 FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1",[id]);
    await browse(id,surface);
   }
   const frozen=async()=>({members:(await db.query('SELECT snapshot_id,listing_id,payload FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=ANY($1::uuid[]) ORDER BY snapshot_id,listing_id',[Object.values(snapshots)])).rows,caches:(await db.query('SELECT * FROM wf_canonical_staging.snapshot_browse_cache_v1 WHERE snapshot_id=ANY($1::uuid[]) ORDER BY snapshot_id',[Object.values(snapshots)])).rows});
   const before=await frozen();await db.query(migration.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,''));
   for(const [surface,id] of Object.entries(snapshots)){
    const metadata=await browse(id,surface);assert.equal(metadata.brands.length,6);assert.equal(metadata.brands.reduce((n,b)=>n+b.listing_count,0),13);assert.equal(metadata.brands.find(b=>b.brand==='Rolex').listing_count,4);assert.ok(metadata.brands.some(b=>b.brand==='Unknown Source Brand'));
    const canonical=await browse(id,surface,'Rolex'),alias=await browse(id,surface,'Datejust');assert.deepEqual(alias,canonical);assert.equal(alias.references.length,4);assert.ok(alias.references.every(r=>r.image_url.startsWith('https://example.invalid/original/')));
   }
   for(const brand of ['Rolex','Datejust','day-DATE','GMT-MASTER II']){
    const trading=snapshots.trading_floor,research=snapshots.price_research;
    assert.equal(Number((await db.query('SELECT public.get_trading_floor_snapshot_count($1,p_brand=>$2) n',[trading,brand])).rows[0].n),4);
    for(const fn of ['get_trading_floor_canary_keyset_v4','get_trading_floor_discovery_keyset_v1'])assert.equal((await db.query('SELECT * FROM public.'+fn+'($1,100,p_brand=>$2)',[trading,brand])).rows.length,4);
    assert.equal(Number((await db.query('SELECT public.get_price_research_snapshot_count($1,p_brand=>$2) n',[research,brand])).rows[0].n),4);
    assert.equal((await db.query('SELECT * FROM public.get_price_research_canary_keyset_v4($1,100,p_brand=>$2)',[research,brand])).rows.length,4);
    assert.equal(Number((await db.query('SELECT public.get_trading_floor_snapshot_count($1,p_query=>$2) n',[trading,'Rolex'])).rows[0].n),4);
   }
   const aliases=require('../../shared/published-brand-aliases.json');
   for(const [input,expected] of Object.entries(aliases))assert.equal((await db.query('SELECT wf_canonical_staging.published_browse_brand_v1($1) result',[input])).rows[0].result,expected);
   for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,'wf_canonical_staging.published_browse_brand_v1(text)','EXECUTE') ok",[role])).rows[0].ok,false);
   assert.deepEqual(await frozen(),before,'Frozen source payloads and original cache entries changed');
   await db.query('ROLLBACK');report.databases.push({container,database,status:'PASS',members_each:13,canonical_brands:6,merged_rolex_count:4,source_aliases:Object.keys(aliases).length,raw_cache_and_payload_unchanged:true,checks:['Canonical and alias inputs select identical metadata and TF/default/Discovery/PR count/page populations','Search includes canonical manufacturer for exact source aliases','Unknown source labels are preserved','Original URL representatives preserved','SQL and JS exact mapping agree; direct public execution denied','All migrations and fixtures rolled back']});
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }
 report.status='PASS';report.finished_at=new Date().toISOString();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{report.status='FAIL';report.finished_at=new Date().toISOString();report.error={code:e.code||e.name,message:e.message?.slice(0,220)};fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.error(JSON.stringify(report.error));process.exitCode=1;});
