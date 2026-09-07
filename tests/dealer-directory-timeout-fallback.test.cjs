'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
let reply;
const dependency=require.resolve('../api/_lib/supabase');
require.cache[dependency]={id:dependency,filename:dependency,loaded:true,exports:{getClient:()=>({rpc:async(name)=>{
 assert.equal(name,'get_approved_dealer_directory');return reply;
}})}};
const handler=require('../api/dealers');
async function invoke() {
 const result={};const res={setHeader(){},status(code){result.status=code;return this;},json(body){result.body=body;return this;}};
 await handler({method:'GET',query:{}},res);return result;
}
test('directory fails closed for timeouts, missing RPCs and authorization failures without static identity fallback',async()=>{
 for(const code of ['57014','PGRST202','42501','PGRST301','XX000']) {
  reply={data:null,error:{code,message:'private database diagnostics'}};
  const result=await invoke();assert.equal(result.status,503);
  assert.deepEqual(result.body,{success:false,error:'Dealer directory temporarily unavailable'});
 }
});
test('directory refuses unreconciled population counts and recovers on a valid subsequent read',async()=>{
 for(const data of [{dealers:[],total:21,all_total:21,rated_total:53},{dealers:[],total:3,all_total:4,rated_total:2}]) {
  reply={data,error:null};assert.equal((await invoke()).status,503);
 }
 reply={data:{dealers:[],total:0,all_total:0,rated_total:0},error:null};
 assert.equal((await invoke()).status,200);
});
