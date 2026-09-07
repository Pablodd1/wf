'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
let result,calls=[];
const dependency=require.resolve('../api/_lib/supabase');
require.cache[dependency]={id:dependency,filename:dependency,loaded:true,exports:{getClient:()=>({rpc:async(name,args)=>{
 calls.push({name,args});return result;
}})}};
const handler=require('../api/dealer-profile');
async function invoke(query) {
 const previous=process.env.VITE_USE_CANARY_V2;process.env.VITE_USE_CANARY_V2='true';
 const response={};const res={setHeader(){},status(code){response.status=code;return this;},json(body){response.body=body;return this;}};
 try {await handler({method:'GET',query},res);return response;}
 finally {if(previous===undefined)delete process.env.VITE_USE_CANARY_V2;else process.env.VITE_USE_CANARY_V2=previous;}
}
test('profile pages bind dealer and publication, preserve source text spacing and omit private provenance',async()=>{
 calls=[];
 result={error:null,data:{dealer:{id:'approved',display_name:'Synthetic dealer',source_identity:'private',raw_payload:{secret:true}},
  publication_revision:12,listing_total:2,stats:{wts_count:2,wtb_count:0},
  listings:[{id:'one',raw_message:'  WTS watch USD 10000\n',seller_name:'Original poster',price_usd:10000,price_raw:10000,currency:'USD'},
   {id:'two',raw_message:'Two',price_usd:20000}]}};
 const first=await invoke({id:'approved',pageSize:'1'});
 assert.equal(first.status,200);assert.equal(first.body.listings.length,1);
 assert.equal(first.body.listings[0].raw_message,'  WTS watch USD 10000\n');
 assert.equal(first.body.listings[0].seller_name,'Original poster');
 assert.doesNotMatch(JSON.stringify(first.body),/source_identity|raw_payload/);
 const cursor=first.body.next_cursor;assert.ok(cursor);
 result={data:{...result.data,listings:[result.data.listings[1]]},error:null};
 const next=await invoke({id:'approved',pageSize:'1',cursor});
 assert.equal(next.status,200);assert.equal(next.body.next_cursor,null);assert.equal(next.body.listings[0].id,'two');
 assert.deepEqual(calls[1],{name:'get_approved_dealer_profile_v2',args:{p_identity:'approved',p_limit:1,p_after_id:'one',p_publication_revision:12}});
 assert.equal((await invoke({id:'other',cursor})).status,400);
 assert.equal(calls.length,2);
});
test('invalid profile pages fail before database access; stale publications require reload and unknown dealers are 404',async()=>{
 calls=[];
 for(const query of [{pageSize:'101'},{pageSize:'0'},{pageSize:'1.5'},{cursor:'invalid'}]) assert.equal((await invoke({id:'approved',...query})).status,400);
 assert.equal(calls.length,0);
 result={data:null,error:{code:'22023',message:'private detail'}};
 assert.deepEqual(await invoke({id:'approved'}),{status:409,body:{error:'Dealer activity changed. Reload the profile.'}});
 result={data:null,error:null};assert.equal((await invoke({id:'missing'})).status,404);
 result={data:null,error:{code:'57014',message:'private detail'}};
 assert.deepEqual(await invoke({id:'approved'}),{status:503,body:{error:'Dealer profile temporarily unavailable'}});
});
