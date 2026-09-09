'use strict';
// Isolated schema-only Docker clones; no production credentials or source rows.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg');
const {withExactCatalogModel,lookupExactCatalogModel}=require('../../shared/exact-catalog-model-map.cjs');
const registry=require('../../shared/exact-catalog-models.json');
const root=path.resolve(__dirname,'../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=['20260910160000_expanded_source_candidate_evidence.sql','20260910210000_trading_floor_source_images_order.sql','20260910300000_exact_catalog_model_display.sql'];
const migrations=files.map(name=>({name,text:fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replaceAll('\r\n','\n')}));
const strip=s=>s.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'');
const output=process.env.WF_CATALOG_MODEL_REPORT;
assert.ok(output,'Explicit local report path required');
const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,migrations:migrations.map(m=>({name:m.name,sha256_lf:sha(m.text)})),map_sha256:sha(fs.readFileSync(path.join(root,'shared/exact-catalog-models.json'))),databases:[]};
function save(){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.pending',JSON.stringify(report,null,2)+'\n');fs.renameSync(output+'.pending',output);}
const docker=(...args)=>execFileSync(process.platform==='win32'?'wsl':'docker',process.platform==='win32'?['--user','root','--exec','docker',...args]:args,{encoding:'utf8',windowsHide:true});
async function main(){
 for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']){
  const info=JSON.parse(docker('inspect',container))[0];assert.equal(info.State.Running,true);
  const network=info.NetworkSettings.Ports['5432/tcp']?.[0],host=network?'127.0.0.1':info.NetworkSettings.Networks['wf-final-disposable']?.IPAddress;
  assert.ok(host==='127.0.0.1'||process.platform==='linux'&&/^172\.18\.0\.[0-9]+$/.test(host));
  const env=Object.fromEntries(info.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  const database='wf_expanded_product_catalog300_20260909';
  const db=new Client({host,port:network?Number(network.HostPort):5432,user:'postgres',password:env.POSTGRES_PASSWORD,database});await db.connect();
  try{
   await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s'");
   assert.equal((await db.query('SELECT count(*)::int n FROM wf_canonical_staging.keyset_snapshot_members')).rows[0].n,0);
   assert.equal((await db.query('SELECT count(*)::int n FROM wf_canonical_staging.mariadb_canary_published_listings_v2')).rows[0].n,0);
   for(const m of migrations.slice(0,2))await db.query(strip(m.text));
   const ambiguous=registry.rejected.find(r=>r.reason==='AMBIGUOUS_EXACT_CATALOG_MODEL');assert.ok(ambiguous);
   const fixtures=[
    {id:'catalog-0',brand:'Rolex',reference:'126610LN',model:null,intent:'WTS',price:10000,image:true},
    {id:'catalog-1',brand:'Rolex',reference:'126610LN',model:null,intent:'WTB',price:null},
    {id:'catalog-2',brand:'Rolex',reference:'126610LN',model:null,intent:'WTS',price:12000,child:true},
    {id:'catalog-3',brand:'Rolex',reference:'126610LN',model:'Literal source model',intent:'WTS',price:13000},
    {id:'catalog-4',brand:'Rolex',reference:'UNESTABLISHED-123',model:null,intent:'WTS',price:14000},
    {id:'catalog-5',brand:'Patek Philippe',reference:'126610LN',model:null,intent:'WTS',price:15000},
    {id:'catalog-6',brand:ambiguous.brand,reference:ambiguous.reference,model:null,intent:'WTS',price:16000},
    {id:'catalog-7',brand:'rolex',reference:'126610ln',model:null,intent:'WTS',price:17000,excluded:true},
   ];
   const snapshots={};
   for(const surface of ['trading_floor','price_research']){
    const id=(await db.query("INSERT INTO wf_canonical_staging.keyset_snapshot_registry(surface,member_count,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING snapshot_id",[surface,fixtures.length])).rows[0].snapshot_id;snapshots[surface]=id;
    for(const [i,f] of fixtures.entries()){
     const payload={listing_id:f.id,brand:f.brand,reference:f.reference,model:f.model,intent:f.intent,category:'WATCH',price_usd:f.price,dial_color:'Black',condition:'NEW',image_status:f.image?'SOURCE_IMAGE_PRESENT':'NO_IMAGE',image_key:f.image?'original-image.jpg':null,image_url:f.image?'https://example.invalid/original-image.jpg':null,parent_listing_id:f.child?'SYNTHETIC-PARENT':null,child_index:f.child?0:null,raw_message_text:f.child?null:'[SYNTHETIC FIXTURE] exact source',source_context_text:f.child?'[SYNTHETIC CHILD] exact source':null};
     await db.query('INSERT INTO wf_canonical_staging.keyset_snapshot_members(snapshot_id,priced_rank,image_rank,price_usd,source_created_at,listing_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,f.price===null?2:1,f.image?1:2,f.price,new Date(Date.UTC(2026,8,1,0,0,i)),f.id,payload]);
    }
    if(surface==='price_research')await db.query(`INSERT INTO wf_canonical_staging.research_snapshot_admission_v2(snapshot_id,listing_id,cohort_key,offer_group_key,representative_listing_id,exclusion_reason,plausibility_floor,plausible_cohort_count)
     SELECT $1,listing_id,'{}'::jsonb,listing_id,listing_id,CASE WHEN listing_id='catalog-7' THEN 'REPOST_DUPLICATE' END,0,6 FROM wf_canonical_staging.keyset_snapshot_members WHERE snapshot_id=$1 AND priced_rank=1`,[id]);
    await db.query('SELECT public.get_canary_snapshot_browse_v1($1,$2)',[id,surface]);
   }
   const frozen=async()=>(await db.query('SELECT snapshot_id,listing_id,payload FROM wf_canonical_staging.keyset_snapshot_members ORDER BY snapshot_id,listing_id')).rows;
   const cache=async()=>(await db.query('SELECT * FROM wf_canonical_staging.snapshot_browse_cache_v1 ORDER BY snapshot_id')).rows;
   const before=await frozen(),cacheBefore=await cache();await db.query(strip(migrations[2].text));
   const pairs=[];for(const[brand,refs]of Object.entries(registry.models))for(const[reference,r]of Object.entries(refs))pairs.push({brand,reference,model:r.model});
   for(const r of registry.rejected)pairs.push({brand:r.brand,reference:r.reference,model:null});
   const parity=(await db.query(`SELECT p.brand,p.reference,p.model expected,wf_canonical_staging.published_catalog_model_v1(NULL,p.brand,p.reference) actual,
    wf_canonical_staging.published_catalog_model_v1(NULL,upper(p.brand),lower(p.reference)) case_actual FROM jsonb_to_recordset($1::jsonb) p(brand text,reference text,model text)`,[JSON.stringify(pairs)])).rows;
   for(const p of parity){assert.equal(p.actual,p.expected,'Full source catalog SQL/JS mismatch');assert.equal(p.case_actual,p.expected,'Case-insensitive full catalog SQL/JS mismatch');}
   for(const separator of [' ','\t','\r','\n','\f','\v'])assert.equal((await db.query('SELECT wf_canonical_staging.published_catalog_model_v1(NULL,$1,$2) model',['Rolex','126'+separator+'610LN'])).rows[0].model,'Submariner');
   for(const reference of ['5711','5711/1A','57111A010','5711/1A-010-001','ref:5711/1A-010'])assert.equal((await db.query('SELECT wf_canonical_staging.published_catalog_model_v1(NULL,$1,$2) model',['Patek Philippe',reference])).rows[0].model,null);
   const methods=['get_trading_floor_canary_keyset_v4','get_trading_floor_discovery_keyset_v1','get_trading_floor_source_images_keyset_v1'];
   const selected={};
   for(const[surface,snapshot]of Object.entries(snapshots)){
    const expected=fixtures.filter(f=>surface==='trading_floor'||f.intent==='WTS'&&!f.excluded);
    const browse=(await db.query('SELECT public.get_canary_snapshot_browse_v1($1,$2,$3) result',[snapshot,surface,'Rolex'])).rows[0].result;
    const modelCount=expected.filter(f=>f.brand.toLowerCase()==='rolex'&&withExactCatalogModel(f).model==='Submariner').length;
    assert.equal(browse.models.find(m=>m.model==='Submariner').listing_count,modelCount);
    assert.equal(browse.brands.reduce((n,b)=>n+b.listing_count,0),expected.length);
    for(const menu of browse.models){
     const count=Number((await db.query('SELECT public.'+(surface==='trading_floor'?'get_trading_floor_snapshot_count':'get_price_research_snapshot_count')+'($1,p_brand=>$2,p_model=>$3) n',[snapshot,'Rolex',menu.model])).rows[0].n);
     assert.equal(count,menu.listing_count,'Menu and filtered membership differ: '+surface+' / '+menu.model);
    }
    selected[surface]={members:expected.length,submariner:modelCount};
   }
   for(const method of methods){
    let last=null,ids=[];for(let page=0;page<10;page++){
     const args=[snapshots.trading_floor,2,'Rolex','Submariner',last?.k_priced_rank??null,last?.k_image_rank??null,last?.k_price_usd??null,last?.k_source_created_at??null,last?.k_listing_id??null];
     const rows=(await db.query('SELECT k_listing_id,k_priced_rank,k_image_rank,k_price_usd,k_source_created_at::text,payload FROM public.'+method+'($1,$2,p_brand=>$3,p_model=>$4,p_cursor_priced_rank=>$5,p_cursor_image_rank=>$6,p_cursor_price_usd=>$7,p_cursor_created_at=>$8,p_cursor_listing_id=>$9)',args)).rows;
     if(!rows.length)break;ids.push(...rows.map(r=>r.k_listing_id));last=rows.at(-1);
    }
    assert.deepEqual([...ids].sort(),['catalog-0','catalog-1','catalog-2','catalog-7']);assert.equal(new Set(ids).size,ids.length);
   }
   assert.deepEqual(await frozen(),before,'Frozen source payload was mutated');assert.deepEqual(await cache(),cacheBefore,'Existing raw metadata cache was mutated');
   const started=Date.now();
   const scale=(await db.query(`SELECT count(*)::int n FROM generate_series(1,100000) g WHERE wf_canonical_staging.published_catalog_model_v1(NULL,CASE WHEN g%2=0 THEN 'Rolex' ELSE 'Patek Philippe' END,CASE WHEN g%2=0 THEN '126610LN' ELSE '5711/1A-010' END) IN ('Submariner','Nautilus')`)).rows[0].n;
   assert.equal(scale,100000);const scaleMs=Date.now()-started;
   await db.query('ROLLBACK');
   assert.equal((await db.query('SELECT count(*)::int n FROM wf_canonical_staging.keyset_snapshot_members')).rows[0].n,0);
   report.databases.push({container,database,status:'PASS',catalog_pairs:parity.length,supported:registry.supported_pairs,ambiguous_or_missing:registry.rejected.length,surfaces:selected,three_sort_filtered_cursor_parity:true,existing_source_models_preserved:true,source_and_cache_unchanged:true,full_catalog_sql_js_parity:true,scaled_lookups:scale,scaled_lookup_ms:scaleMs,rolled_back:true});save();
  }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}finally{await db.end();}
 }
 report.status='PASS';report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,report:output,databases:report.databases}));
}
main().catch(error=>{report.status='FAILED';report.error={message:error.message,code:error.code||null};save();console.error(JSON.stringify(report.error));process.exitCode=1;});
