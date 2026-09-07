'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRpc}=require('../tools/mariadb-live/run-frozen-normalization-v2.cjs');
test('RPC retries a body-read timeout with the identical leased completion request',async()=>{
 const original=global.fetch,calls=[];
 global.fetch=async(url,options)=>{
  calls.push({url:String(url),body:options.body});
  if(calls.length===1)return {ok:true,json:async()=>{throw new DOMException('Synthetic response body timeout','TimeoutError');}};
  return {ok:true,json:async()=>({processed:1,replayed:true})};
 };
 try{
  const rpc=createRpc({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-key'});
  const request={p_job_name:'synthetic-job',p_lease_id:'synthetic-lease',p_results:[]};
  assert.deepEqual(await rpc('complete_normalization_batch_v2',request),{processed:1,replayed:true});
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(JSON.parse(calls[1].body),request);
 }finally{global.fetch=original;}
});
test('RPC does not retry a permanent validation rejection',async()=>{
 const original=global.fetch;let attempts=0;
 global.fetch=async()=>{attempts++;return {ok:false,status:400};};
 try{
  const rpc=createRpc({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-key'});
  await assert.rejects(rpc('complete_normalization_batch_v2',{}),/NORMALIZATION_RPC_REJECTED_400/);assert.equal(attempts,1);
 }finally{global.fetch=original;}
});
