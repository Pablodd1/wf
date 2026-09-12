'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {captureSourceImageEvidence}=require('../tools/mariadb-live/source-image-evidence-v2.cjs');
const {stableJson}=require('../tools/mariadb-live/lossless-payload-sanitizer.cjs');
const png=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
function raw(key='listings/full/watch one.png') {
 const payload={id:'SYNTHETIC-IMAGE',description:'Synthetic image test',front_image:key,synthetic_fixture:true};
 return {id:crypto.randomUUID(),source_id:payload.id,raw_payload:payload,
  source_hash:crypto.createHash('sha256').update(stableJson(payload)).digest('hex'),
  canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};
}
test('source key is preserved and only its fixed-origin encoded path is probed with bounded requests',async()=>{
 const calls=[];const row=raw();
 const result=await captureSourceImageEvidence(row,{fetchImpl:async(url,options)=>{
  calls.push({url,options});return new Response(options.method==='HEAD'?null:png,{status:200,headers:{'content-type':'image/png'}});
 }});
 assert.equal(result.outcome,'VERIFIED_SOURCE_IMAGE');
 assert.equal(result.proof.document.image_key,row.raw_payload.front_image);
 assert.equal(result.proof.document.source_hash,row.source_hash);
 assert.equal(calls.length,2);assert.equal(calls[0].options.method,'HEAD');
 assert.equal(calls[1].url,'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/watch%20one.png');
 assert.equal(calls[1].options.headers.Range,'bytes=0-4095');
 assert.equal(calls[1].options.redirect,'error');assert.ok(calls[1].options.signal);
 assert.equal(result.proof.document.body_prefix_sha256,crypto.createHash('sha256').update(png).digest('hex'));
});
test('successful HTTP alone cannot verify a missing, broken or non-image attachment',async()=>{
 for(const [status,type,bytes] of [[404,'image/png',png],[200,'text/html',png],[200,'image/png',Buffer.from('<html>no image</html>')]]){
  const result=await captureSourceImageEvidence(raw(),{fetchImpl:async(url,o)=>new Response(o.method==='HEAD'?null:bytes,{status,headers:{'content-type':type}})});
  assert.equal(result.outcome,'SOURCE_IMAGE_UNAVAILABLE');assert.ok(result.proof.evidence_hash);
 }
 const failed=await captureSourceImageEvidence(raw(),{fetchImpl:async()=>{throw new Error('Network unavailable');}});
 assert.equal(failed.outcome,'SOURCE_IMAGE_UNAVAILABLE');assert.equal(failed.proof.document.verified_url,failed.proof.document.candidate_url);
});
test('missing keys, traversal and changed source evidence never trigger a request',async()=>{
 let requests=0;const options={fetchImpl:async()=>{requests++;throw new Error('Unexpected fetch');}};
 for(const key of [null,'../other.png','photo.png?redirect=evil']){
  assert.equal((await captureSourceImageEvidence(raw(key),options)).proof,null);
 }
 const changed=raw();changed.raw_payload.front_image='other.png';
 await assert.rejects(captureSourceImageEvidence(changed,options),/PROVENANCE_CONTENT_MISMATCH/);
 assert.equal(requests,0);
});
test('full server responses retain at most the first 4096 bytes and cancel the reader',async()=>{
 const bytes=Buffer.concat([png,Buffer.alloc(10000)]);let cancelled=false;
 const result=await captureSourceImageEvidence(raw(),{fetchImpl:async(url,o)=>new Response(o.method==='HEAD'?null:new ReadableStream({pull(c){c.enqueue(bytes);},cancel(){cancelled=true;}}),{headers:{'content-type':'image/png'}})});
 assert.equal(result.outcome,'VERIFIED_SOURCE_IMAGE');assert.equal(result.proof.document.body_prefix_bytes,4096);assert.equal(cancelled,true);
});
test('disposable override requires an explicitly synthetic payload and exact permitted origin shape',async()=>{
 for(const base of ['http://a.trycloudflare.com/images','https://a.trycloudflare.com/images?x=1','https://evil.test/images']){
  await assert.rejects(captureSourceImageEvidence(raw(),{disposableBase:base}),/DISPOSABLE_IMAGE_ORIGIN_REFUSED/);
 }
 const row=raw();row.raw_payload.synthetic_fixture=false;
 row.source_hash=crypto.createHash('sha256').update(stableJson(row.raw_payload)).digest('hex');
 await assert.rejects(captureSourceImageEvidence(row,{disposableBase:'https://a.trycloudflare.com/images'}),/DISPOSABLE_IMAGE_ORIGIN_REFUSED/);
});
