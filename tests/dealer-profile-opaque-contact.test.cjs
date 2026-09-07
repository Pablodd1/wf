'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const supabasePath=require.resolve('../api/_lib/supabase.js');let client;
require.cache[supabasePath]={id:supabasePath,filename:supabasePath,loaded:true,exports:{getClient:()=>client}};
const profileHandler=require('../api/dealer-profile.js'),contactHandler=require('../api/dealer-contact.js');
const {resetContactRateLimitForTests}=require('../api/listing-contact.js');
const id='00000000-0000-5000-8000-000000000001',phone='+13055550100';
const fixture=()=>({dealer:{id,display_name:'Synthetic source dealer',source_system:'WATCHFACTS_VERIFIED_DEALERS',rating:null,review_count:0},stats:{wts_count:1,wtb_count:0,verified_contact_info:{phone,verification_status:'VERIFIED'}},listing_linkage_status:'EXACT_PUBLISHED_SOURCE_LINKAGE',listing_total:1,publication_revision:1,listings:[],reviews:[],groups:[]});
const response=()=>({headers:{},statusCode:0,body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){return this;}});
const invoke=async(handler,query)=>{const res=response();await handler({method:'GET',query,headers:{},socket:{remoteAddress:'127.0.0.1'}},res);return res;};
test.beforeEach(()=>{process.env.VITE_USE_CANARY_V2='true';process.env.CONTACT_RATE_LIMIT_SECRET='synthetic-contact-test-key';resetContactRateLimitForTests();client={rpc:async name=>({data:name==='consume_listing_contact_budget'?true:fixture(),error:null})};});
test('profile API replaces consented raw contact with an opaque action',async()=>{
 const res=await invoke(profileHandler,{id});assert.equal(res.statusCode,200);assert.equal(res.body.stats.verified_contact_info,null);assert.equal(res.body.stats.contact_action,'/api/dealer-contact?id='+id+'&channel=whatsapp');assert.ok(!JSON.stringify(res.body).includes('13055550100'));assert.ok(!JSON.stringify(res.body).includes('wa.me'));
});
test('profile contact JSON has no phone; explicit action redirects to the consented poster',async()=>{
 const json=await invoke(contactHandler,{id});assert.equal(json.statusCode,200);assert.equal(json.body.contact_available,true);assert.ok(!JSON.stringify(json.body).includes('13055550100'));assert.ok(!JSON.stringify(json.body).includes('wa.me'));
 const redirect=await invoke(contactHandler,{id,channel:'whatsapp'});assert.equal(redirect.statusCode,302);const url=new URL(redirect.headers.Location);assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/13055550100');assert.match(url.searchParams.get('text'),/your profile on WatchFacts/);assert.ok(!url.searchParams.get('text').includes('13055550100'));assert.equal(redirect.body,null);assert.equal(redirect.headers['Referrer-Policy'],'no-referrer');
});
test('unconsented, unlinked, legacy and invalid-phone profiles cannot disclose or redirect contacts',async()=>{
 for(const change of [p=>p.stats.verified_contact_info=null,p=>p.listing_total=0,p=>p.listing_linkage_status='PENDING_EXACT_LISTING_LINKAGE',p=>p.dealer.source_system='PRIVATE_LEGACY_DIRECTORY',p=>p.stats.verified_contact_info.phone='https://example.invalid/phone']){
  const p=fixture();change(p);client={rpc:async name=>({data:name==='consume_listing_contact_budget'?true:p,error:null})};
  const safe=profileHandler.sanitizeDealerProfile(p);assert.equal(safe.stats.verified_contact_info,null);assert.equal(safe.stats.contact_action,null);
  const res=await invoke(contactHandler,{id,channel:'whatsapp'});assert.equal(res.statusCode,403);assert.equal(res.body.contact_available,false);assert.equal(res.headers.Location,undefined);assert.ok(!JSON.stringify(res.body).includes('13055550100'));
 }
});
test('shared contact budget and service failures fail closed without exposing private error data',async()=>{
 const calls=[];client={rpc:async name=>{calls.push(name);return {data:false,error:null};}};assert.equal((await invoke(contactHandler,{id})).statusCode,429);assert.deepEqual(calls,['consume_listing_contact_budget']);
 client={rpc:async name=>name==='consume_listing_contact_budget'?{data:true,error:null}:{data:null,error:{message:phone+' private payload'}}};const res=await invoke(contactHandler,{id});assert.equal(res.statusCode,500);assert.deepEqual(res.body,{error:'Unable to verify dealer contact'});
});
test('unsupported identities and channels do not reach the contact store',async()=>{
 client={rpc:async()=>assert.fail('invalid requests must not query contacts')};for(const query of [{id:[id]},{id:'https://example.invalid'},{id,channel:'telegram'}])assert.equal((await invoke(contactHandler,query)).statusCode,400);
});
