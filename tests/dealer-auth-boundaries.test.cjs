'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {authClient,resolveSession}=require('../api/_lib/dealer-auth.cjs');
const dependency=require.resolve('../api/_lib/dealer-auth.cjs');
let signIns=0;
require.cache[dependency]={id:dependency,filename:dependency,loaded:true,exports:{
 authClient:()=>({auth:{signInWithPassword:async()=>{signIns++;return {data:{},error:{message:'private'}};}}}),
 DEALER_ROLES:new Set(['dealer']),recordAuthEvent:async()=>{},resolveSession:async()=>null,
 clearSessionCookies:()=>{},publicUser:()=>{},setSessionCookies:()=>{},userRole:()=>'',
}};
const login=require('../api/dealer-auth');
const registration=require('../api/dealer-registration');
async function invoke(handler,ip,index,headers={}) {
 let status,body;const res={setHeader(){},status(code){status=code;return this;},json(value){body=value;return this;}};
 await handler({method:'POST',socket:{remoteAddress:ip},headers:{host:'preview.example.test','x-forwarded-for':`198.51.100.${index}`,...headers},body:{email:'synthetic@example.invalid',password:'synthetic-invalid-password'}},res);
 return {status,body};
}
test('authentication refuses a key-only configuration instead of selecting a production project',()=>{
 const keys=['SUPABASE_URL','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY'];
 const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try {for(const key of keys)delete process.env[key];process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-key';assert.equal(authClient(),null);}
 finally {for(const key of keys)if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}
});
test('spoofed forwarded addresses cannot reset login or registration counters on a direct connection',async()=>{
 const previous=process.env.VERCEL;delete process.env.VERCEL;
 try {
  for(let i=1;i<=10;i++)assert.equal((await invoke(login,'192.0.2.71',i)).status,401);
  assert.equal((await invoke(login,'192.0.2.71',11)).status,429);assert.equal(signIns,10);
  for(let i=1;i<=5;i++)assert.equal((await invoke(registration,'192.0.2.72',i)).status,400);
  assert.equal((await invoke(registration,'192.0.2.72',6)).status,429);
 } finally {if(previous===undefined)delete process.env.VERCEL;else process.env.VERCEL=previous;}
});
test('a forged forwarded host cannot authorize a cross-origin login or registration',async()=>{
 for(const handler of [login,registration])assert.equal((await invoke(handler,'192.0.2.73',1,{origin:'https://attacker.example.test','x-forwarded-host':'attacker.example.test'})).status,403);
});
test('malformed session cookie encoding remains unauthenticated without invoking Supabase',async()=>{
 const client={auth:{getUser:()=>{throw new Error('Malformed cookie reached authentication');}}};
 assert.equal(await resolveSession(client,{headers:{cookie:'wf_dealer_access=%zz; broken'}},{}),null);
});
