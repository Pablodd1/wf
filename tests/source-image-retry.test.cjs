'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {captureSourceImageWithRetry}=require('../tools/mariadb-live/source-image-retry.cjs');
const {stableJson}=require('../tools/mariadb-live/lossless-payload-sanitizer.cjs');
const raw=()=>{const payload={id:'SYNTHETIC-RETRY',description:'WTS Rolex 126610LN',front_image:'synthetic.jpg',synthetic_fixture:true};return {id:crypto.randomUUID(),source_id:payload.id,raw_payload:payload,source_hash:crypto.createHash('sha256').update(stableJson(payload)).digest('hex'),canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};};
const response=(options,status=200)=>new Response(options.method==='HEAD'?null:Buffer.from('ffd8ff','hex'),{status,headers:{'content-type':'image/jpeg'}});
test('one transport retry preserves its failed proof and checks the identical original URL',async()=>{
 const calls=[],waits=[];const result=await captureSourceImageWithRetry(raw(),{wait:async ms=>waits.push(ms),fetchImpl:async(url,o)=>{calls.push({url,method:o.method});if(calls.length===2)throw new Error('reset');return response(o);}});
 assert.equal(result.outcome,'VERIFIED_SOURCE_IMAGE');assert.equal(result.priorProofs.length,1);assert.equal(result.priorProofs[0].document.get_status,0);assert.equal(result.proof.document.get_status,200);assert.equal(new Set(calls.map(c=>c.url)).size,1);assert.equal(calls.length,4);assert.deepEqual(waits,[500]);assert.notEqual(result.priorProofs[0].evidence_hash,result.proof.evidence_hash);
});
test('permanent absence and invalid image content do not become retry guesses',async()=>{
 for(const status of [403,404]){let calls=0;const result=await captureSourceImageWithRetry(raw(),{wait:async()=>assert.fail('Permanent errors must not retry'),fetchImpl:async(url,o)=>{calls++;return response(o,status);}});assert.equal(calls,2);assert.equal(result.outcome,'SOURCE_IMAGE_UNAVAILABLE');assert.equal(result.priorProofs,undefined);}
});
test('service throttling retries once with backoff and retains both unsuccessful attempts',async()=>{
 let calls=0;const waits=[];const result=await captureSourceImageWithRetry(raw(),{wait:async ms=>waits.push(ms),fetchImpl:async(url,o)=>{calls++;return response(o,429);}});assert.equal(calls,4);assert.deepEqual(waits,[2000]);assert.equal(result.outcome,'SOURCE_IMAGE_UNAVAILABLE');assert.equal(result.priorProofs.length,1);
});

test('materialization persists the failed receipt before the successful retry and commits its final hash',async()=>{
 const {run}=require('../tools/mariadb-live/run-frozen-materialization-v2.cjs');const row=raw(),staged=[];let calls=0;
 await run({jobName:'SYNTHETIC-RETRY-WORKFLOW',maxBatches:1,captureImage:r=>captureSourceImageWithRetry(r,{wait:async()=>{},fetchImpl:async(url,o)=>{calls++;if(calls===1)throw new Error('reset');return response(o);}}),rpc:async(name,args)=>{
  if(name==='read_materialization_workflow_batch_v2')return {job:{complete:false,cursor_raw_row_id:null},members:[{raw_row_id:row.id,proposal_hash:'a'.repeat(64),outcome:'NORMALIZED',raw:row}]};
  if(name==='stage_source_image_evidence_v2'){staged.push(args);return {};}
  if(name==='commit_materialization_workflow_batch_v2'){assert.equal(staged.length,2);assert.equal(staged[0].p_document.head_status,0);assert.equal(staged[1].p_document.head_status,200);assert.equal(args.p_members[0].image_evidence_hash,staged[1].p_evidence_hash);return {job:{complete:true}};}
  throw new Error('Unexpected RPC');
 }});
});
