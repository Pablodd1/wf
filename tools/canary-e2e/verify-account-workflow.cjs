'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const http=require('node:http');
const {Client}=require('./test-dependencies.cjs')('pg');

async function main(){
 assert.equal(new URL(process.env.DISPOSABLE_DB_URL).hostname,'127.0.0.1');
 assert.equal(new URL(process.env.SUPABASE_URL).origin,'http://127.0.0.1:54321');
 assert.ok(process.env.DISPOSABLE_ACCOUNT_FILE);
 const db=new Client({connectionString:process.env.DISPOSABLE_DB_URL});
 const report={status:'RUNNING',recorded_at:new Date().toISOString(),synthetic_only:true,production_contacted:false,checks:[]};
 let server;
 await db.connect();
 try{
  assert.equal((await db.query("select to_regnamespace('wf_disposable_legacy') is not null ok")).rows[0].ok,true);
  const dealer=(await db.query("select id,auth_user_id,display_name from public.dealers where slug='rc50-browser-synthetic-alpha'")).rows[0];
  assert.ok(dealer.display_name.startsWith('RC50-BROWSER-SYNTHETIC'));
  let account;
  if(fs.existsSync(process.env.DISPOSABLE_ACCOUNT_FILE)){
   account=JSON.parse(fs.readFileSync(process.env.DISPOSABLE_ACCOUNT_FILE,'utf8'));
   assert.equal(account.dealer_id,dealer.id);assert.equal(account.synthetic_only,true);
  }else{
   assert.equal(dealer.auth_user_id,null,'Do not replace any existing account linkage');
   const email=`wf-disposable-${crypto.randomUUID()}@example.invalid`,password=crypto.randomBytes(32).toString('base64url');
   const created=await fetch(process.env.SUPABASE_URL+'/auth/v1/admin/users',{
    method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({email,password,email_confirm:true,app_metadata:{role:'dealer',disposable_fixture:true}}),signal:AbortSignal.timeout(15000),
   });
   assert.equal(created.status,200);const user=await created.json();assert.ok(user.id);
   account={user_id:user.id,email,password,dealer_id:dealer.id,original_auth_user_id:null,synthetic_only:true};
   fs.writeFileSync(process.env.DISPOSABLE_ACCOUNT_FILE,JSON.stringify(account),{mode:0o600});
  }
  await db.query('update public.dealers set auth_user_id=$1 where id=$2 and (auth_user_id is null or auth_user_id=$1)',[account.user_id,dealer.id]);
  const handlers={'/api/dealer-auth':require('../../api/dealer-auth'),'/api/dealer-workspace':require('../../api/dealer-workspace')};
  server=http.createServer(async(req,res)=>{
   const url=new URL(req.url,'http://127.0.0.1');req.query=Object.fromEntries(url.searchParams);let text='';for await(const chunk of req)text+=chunk;req.body=text?JSON.parse(text):{};
   res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
   await handlers[url.pathname](req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const call=(route,method='GET',body=null,cookie='')=>fetch(origin+route,{method,headers:{cookie,Origin:origin,'Content-Type':'application/json'},body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  assert.equal((await call('/api/dealer-workspace')).status,401);
  const login=await call('/api/dealer-auth','POST',{email:account.email,password:account.password});assert.equal(login.status,200);
  const cookies=login.headers.getSetCookie();assert.equal(cookies.length,2);assert.ok(cookies.every(value=>/HttpOnly; Secure; SameSite=Lax/.test(value)));
  const cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  const beforeResponse=await call('/api/dealer-workspace','GET',null,cookie);assert.equal(beforeResponse.status,200);const before=await beforeResponse.json();
  assert.equal(before.dealer.id,dealer.id);assert.equal(before.stats.current_counts_scope,'CURRENT_PUBLISHED_SINGLES');
  assert.equal(before.stats.active_listings,1);assert.equal(before.stats.wts_posts,1);assert.equal(before.stats.wtb_posts,0);assert.equal(before.stats.posting_years,null);
  assert.equal(before.listings[0].id,'RC50-A01');
  const saved=await call('/api/dealer-workspace','PATCH',{section:'preferences',display_currency:'HKD',email_notifications:false,auth_user_id:crypto.randomUUID()},cookie);
  assert.equal(saved.status,200);
  const refreshed=await (await call('/api/dealer-workspace','GET',null,cookie)).json();
  assert.equal(refreshed.preferences.display_currency,'HKD');assert.equal(refreshed.preferences.email_notifications,false);
  assert.equal(refreshed.preferences.auth_user_id,account.user_id);
  assert.equal((await call('/api/dealer-workspace','PATCH',{section:'preferences',display_currency:before.preferences.display_currency,email_notifications:before.preferences.email_notifications},cookie)).status,200);
  const malicious=await fetch(origin+'/api/dealer-workspace',{method:'PATCH',headers:{cookie,Origin:'https://attacker.example.test','x-forwarded-host':'attacker.example.test','Content-Type':'application/json'},body:JSON.stringify({section:'preferences',display_currency:'JPY'})});
  assert.equal(malicious.status,403);
  const logout=await call('/api/dealer-auth','DELETE',null,cookie);assert.equal(logout.status,200);assert.ok(logout.headers.getSetCookie().every(value=>value.includes('Max-Age=0')));
  const refresh=cookies.find(value=>value.startsWith('wf_dealer_refresh=')).split(';')[0].slice('wf_dealer_refresh='.length);
  const revoked=await fetch(process.env.SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:decodeURIComponent(refresh)}),signal:AbortSignal.timeout(15000)});
  assert.equal(revoked.status,400,'Logout must revoke the server refresh session');
  report.checks=['Genuine Supabase Auth password login yields secure HTTP-only session cookies; anonymous workspace is 401',
   'Authenticated account reads exactly the V2 published source-linked activity and keeps unknown years null',
   'Preference save and reload persist to the authenticated user despite a forged body user ID; prior values restored',
   'Forged forwarded host cannot bypass same-origin mutation checks; logout clears both cookies and revokes the genuine Supabase refresh session'];
  report.account_user_id=account.user_id;report.retained_for_browser_validation=true;report.status='PASS';
 }catch(error){report.status='FAIL';report.error={code:error.code||error.name,message:error.message.split('\n')[0],site:error.stack?.split('\n').find(line=>line.includes('verify-account-workflow.cjs:'))?.trim()};process.exitCode=1;}
 finally{if(server)await new Promise(resolve=>server.close(resolve));await db.end();fs.writeFileSync(process.env.DISPOSABLE_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
}
main().catch(error=>{console.error('DISPOSABLE_ACCOUNT_SETUP_FAILED',error.code||error.name);process.exitCode=1;});
