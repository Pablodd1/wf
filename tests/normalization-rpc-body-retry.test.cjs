'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRpc,run}=require('../tools/mariadb-live/run-frozen-normalization-v2.cjs');
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
test('worker reacquires an expired lease but does not ignore source-validation failures',async()=>{
 let completions=0;const leases=[];
 const rpc=async(name,args)=>{
  if(name==='get_normalization_job_v2')return {complete:completions===2,processed_rows:completions===2?1:0};
  if(name==='claim_normalization_batch_v2'){leases.push(args.p_lease_id);return [{raw_row_id:'synthetic-row',raw:{source_hash:'changed'},expected_source_hash:'expected'}];}
  if(name==='complete_normalization_batch_v2'){completions++;if(completions===1)throw Object.assign(new Error('Lease expired'),{postgresCode:'22023',reason:'normalization_lease_membership_mismatch'});return {processed:1};}
 };
 assert.equal((await run({rpc,jobName:'synthetic',batchSize:1,maxBatches:2})).complete,true);
 assert.equal(leases.length,2);assert.notEqual(leases[0],leases[1]);
 completions=0;
 await assert.rejects(run({jobName:'synthetic',batchSize:1,rpc:async(name,args)=>{
  if(name==='complete_normalization_batch_v2')throw Object.assign(new Error('Source validation failed'),{postgresCode:'22023',reason:'normalization_proposal_identity_mismatch'});
  return rpc(name,args);
 }}),/Source validation failed/);
});
test('RPC does not retry a permanent validation rejection',async()=>{
 const original=global.fetch;let attempts=0;
 global.fetch=async()=>{attempts++;return {ok:false,status:400};};
 try{
  const rpc=createRpc({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-key'});
  await assert.rejects(rpc('complete_normalization_batch_v2',{}),/NORMALIZATION_RPC_REJECTED_400/);assert.equal(attempts,1);
 }finally{global.fetch=original;}
});
