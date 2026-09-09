'use strict';
// Synthetic local identities only; unchanged resolver predicate and results.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Client}=require('./test-dependencies.cjs')('pg'),root=path.resolve(__dirname,'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),file='20260910290000_dealer_verified_contact_lookup.sql';
const sql=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n');
const output=process.env.WF_CONTACT_LOOKUP_TEST_REPORT;assert.ok(output);
const report={status:'RUNNING',production_contacted:false,synthetic_only:true,script_sha256:sha(fs.readFileSync(__filename)),migration:{file,sha256:sha(sql)},databases:[]};
if(fs.existsSync(output))fs.copyFileSync(output,output+'.before-'+Date.now());
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
const query="select i.id,i.dealer_id from public.dealer_source_identities i where i.verification_status='VERIFIED' and upper(i.identity_type) in ('PHONE','WHATSAPP') and public.normalize_seller_phone_identity(i.source_identity)=$1 order by i.id";
const walk=n=>[n,...(n.Plans||[]).flatMap(walk)];
async function main(){for(const container of ['supabase_db_wf-final-disposable','wf-final-disposable-pg18']){
 const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];assert.equal(info.State.Running,true);
 const host=info.NetworkSettings.Networks['wf-final-disposable'].IPAddress;assert.match(host,/^172\.18\.0\.\d+$/);
 const database='wf_contact_290_'+Date.now();assert.match(database,/^wf_contact_290_\d+$/);
 execFileSync('docker',['exec',container,'createdb','-U','postgres','-T','wf_expanded_template3_20260908',database]);
 const env=Object.fromEntries(info.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 const db=new Client({host,port:5432,user:'postgres',password:env.POSTGRES_PASSWORD,database,application_name:'wf_local_dealer_contact_290'});await db.connect();
 const detail={container,database,status:'RUNNING'};report.databases.push(detail);
 try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='120s';SET LOCAL work_mem='7MB'");
  const funcs=(await db.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','wf_canonical_staging') and (p.proname like 'resolve_v2_source_dealer%' or p.proname in('normalize_seller_phone_identity','reconcile_v2_listing_dealers')) order by 1")).rows;
  await db.query("insert into public.dealers(id,display_name,status) values('10000000-0000-0000-0000-000000000001','Synthetic dealer','VERIFIED')");
  await db.query(`insert into public.dealer_source_identities(id,dealer_id,source_system,source_identity,identity_type,verification_status)
   select n,'10000000-0000-0000-0000-000000000001'::uuid,'SYNTHETIC-'||n,'1'||lpad((2025550000+n)::text,10,'0'),
   case n%5 when 0 then 'WHATSAPP' when 1 then 'phone' when 2 then 'PHONE' when 3 then 'EMAIL' else ' PHONE ' end,
   case when n%7=0 then 'UNVERIFIED' else 'VERIFIED' end from generate_series(1,10000)n`);
  // Same normalized phone may have several independently reviewed identities.
  // Do not accidentally add a uniqueness rule or trim extra identity types.
  await db.query(`insert into public.dealer_source_identities(id,dealer_id,source_system,source_identity,identity_type,verification_status) values
   (10001,'10000000-0000-0000-0000-000000000001','SYNTHETIC-DUP-A','+1 (202) 555-0002','PHONE','VERIFIED'),
   (10002,'10000000-0000-0000-0000-000000000001','SYNTHETIC-DUP-B','+1 (202) 555-0002','WHATSAPP','VERIFIED'),
   (10003,'10000000-0000-0000-0000-000000000001','SYNTHETIC-INVALID','no phone','PHONE','VERIFIED')`);
  await db.query('ANALYZE public.dealer_source_identities');
  const probes=['12025550001','12025550002','12025550003','12025550004','12025550005','12025550007','12025559997','19999999999',null];
  const before=[];for(const p of probes)before.push((await db.query(query,[p])).rows);
  assert.equal(before[1].length,3,'Ambiguous identical phone rows must remain visible');assert.equal(before[3].length,0,'Whitespace identity type remains outside existing predicate');
  const dataDigest=async()=>(await db.query("select encode(sha256(convert_to(string_agg(to_jsonb(i)::text,'|' order by id),'UTF8')),'hex') hash from public.dealer_source_identities i")).rows[0].hash;
  const beforeHash=await dataDigest();
  const oldPlan=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,['12025550002'])).rows[0]['QUERY PLAN'][0];
  await db.query(sql.replace(/^BEGIN;\s*/m,'').replace(/^COMMIT;\s*$/m,''));
  const after=[];for(const p of probes)after.push((await db.query(query,[p])).rows);assert.deepEqual(after,before);
  const plan=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,['12025550002'])).rows[0]['QUERY PLAN'][0];
  assert.ok(walk(plan.Plan).some(n=>n['Index Name']==='dealer_verified_contact_lookup_v3'),'Actual equality probe must use the matching index');
  const index=(await db.query("select indisvalid,indisready,indisunique from pg_index where indexrelid='public.dealer_verified_contact_lookup_v3'::regclass")).rows[0];assert.deepEqual(index,{indisvalid:true,indisready:true,indisunique:false});
  assert.equal(await dataDigest(),beforeHash);
  const afterFuncs=(await db.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','wf_canonical_staging') and (p.proname like 'resolve_v2_source_dealer%' or p.proname in('normalize_seller_phone_identity','reconcile_v2_listing_dealers')) order by 1")).rows;assert.deepEqual(afterFuncs,funcs);
  detail.index_bytes=Number((await db.query("select pg_relation_size('public.dealer_verified_contact_lookup_v3') bytes")).rows[0].bytes);
  await db.query('ROLLBACK');assert.equal((await db.query("select to_regclass('public.dealer_verified_contact_lookup_v3') value")).rows[0].value,null);assert.equal(Number((await db.query('select count(*) n from public.dealer_source_identities')).rows[0].n),0);
  Object.assign(detail,{status:'PASS',fixture_identities:10003,probes:probes.length,payload_hash:sha(JSON.stringify(before)),source_rows_unchanged:true,duplicate_phone_rows_preserved:true,exact_predicate_preserved:true,function_bodies_acl_unchanged:true,actual_matching_index_used:true,before_execution_ms:oldPlan['Execution Time'],after_execution_ms:plan['Execution Time'],transaction_rollback_exact:true});save();
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
 }report.status='PASS';report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,output,sha256:sha(fs.readFileSync(output)),databases:report.databases}));}
main().catch(e=>{report.status='FAIL';report.error={code:e.code||e.name,message:e.message};save();console.error(JSON.stringify(report.error));process.exitCode=1;});
