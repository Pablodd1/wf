'use strict';
// Local mixed-version evidence gate. A global reviewed selection binds both
// frozen V1 output and the complete affected-parent V2 overlay. No DB client.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const v1=require('./expanded-evidence-candidates.cjs'),v2=require('./expanded-evidence-candidates-v2.cjs');
const originalGate=require('./expanded-reviewed-admissions.cjs');
const {findAnchorIssues}=require('./run-expanded-reference-anchor-corrections-v2.cjs');
const {stableJson}=require('./lossless-payload-sanitizer.cjs'),{jsonLines}=require('./run-expanded-local-dry-run.cjs');
const CONTRACT='WF_EXPANDED_REVIEWED_ADMISSIONS_V2',SEALED='SEALED_REVIEWED_EXPANDED_ADMISSIONS_V2';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
async function hashFile(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function bound(pointer){assert.ok(pointer&&typeof pointer.file==='string'&&digest(pointer.sha256),'FILE_BINDING_REQUIRED');const bytes=await fs.promises.readFile(pointer.file);assert.equal(sha(bytes),pointer.sha256,'BOUND_FILE_HASH_MISMATCH');return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}
async function boundLines(pointer){assert.equal(await hashFile(pointer.file),pointer.sha256,'BOUND_PART_HASH_MISMATCH');const rows=[];for await(const line of jsonLines(pointer.file))rows.push(JSON.parse(line));assert.equal(rows.length,pointer.rows,'BOUND_PART_ROWS_MISMATCH');return rows;}
function sourceCursor(source,directory){
 const chunks=new Map(source.chunks.map((c,index)=>[c.file,{...c,index}]));let active=null,stream=null,index=-1,line=null;
 return {async get(p){const c=chunks.get(p.raw_chunk);assert.ok(c&&c.sha256===p.raw_chunk_sha256,'RAW_CHUNK_BINDING_MISMATCH');assert.ok(Number.isInteger(p.row_index)&&p.row_index>=0&&p.row_index<c.rows,'RAW_ROW_INDEX_INVALID');
  if(active?.file!==c.file){assert.ok(!active||c.index>active.index,'RAW_CHUNK_ORDER_INVALID');if(stream)await stream.return();const file=path.resolve(directory,c.file),rel=path.relative(directory,file);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'RAW_PATH_OUTSIDE_ARCHIVE');assert.equal(await hashFile(file),c.sha256,'RAW_CHUNK_HASH_MISMATCH');stream=jsonLines(file)[Symbol.asyncIterator]();active=c;index=-1;}
  assert.ok(p.row_index>=index,'RAW_ROW_ORDER_INVALID');while(index<p.row_index){const next=await stream.next();assert.equal(next.done,false,'RAW_ROW_MISSING');line=next.value;index++;}
  assert.equal(sha(line),p.source_hash,'RAW_SOURCE_HASH_MISMATCH');const raw=JSON.parse(line);assert.equal(String(raw.id),p.source_id,'RAW_SOURCE_ID_MISMATCH');assert.equal(stableJson(raw),line,'RAW_CANONICAL_MISMATCH');return raw;
 },async close(){if(stream)await stream.return();}};
}
async function verifyReviewedAdmissionsV2({reviewManifestFile,expectedReviewManifestSha256,policyHashes,onAdmission}){
 assert.ok(digest(expectedReviewManifestSha256)&&typeof onAdmission==='function','REVIEW_HASH_AND_PRIVATE_SINK_REQUIRED');
 const review=await bound({file:reviewManifestFile,sha256:expectedReviewManifestSha256});assert.equal(review.contract,CONTRACT,'REVIEW_CONTRACT_INVALID');assert.equal(review.status,SEALED,'REVIEW_NOT_SEALED');
 const versions=[v1.PARSER_VERSION,v2.PARSER_VERSION];assert.deepEqual(Object.keys(policyHashes||{}).sort(),versions.slice().sort(),'POLICY_REGISTRY_KEYS_INVALID');assert.deepEqual(Object.keys(review.parser_registry||{}).sort(),versions.slice().sort(),'PARSER_REGISTRY_KEYS_INVALID');
 for(const [parser,file] of [[v1,'expanded-evidence-candidates.cjs'],[v2,'expanded-evidence-candidates-v2.cjs']]){
  const p=review.parser_registry[parser.PARSER_VERSION];assert.ok(digest(policyHashes[parser.PARSER_VERSION]),'POLICY_HASH_INVALID');assert.equal(p.policy_hash,policyHashes[parser.PARSER_VERSION],'POLICY_HASH_MISMATCH');assert.equal(p.parser_sha256,await hashFile(path.join(__dirname,file)),'PARSER_CODE_CHANGED');assert.deepEqual(p.dependency_hashes,parser.DEPENDENCY_HASHES,'PARSER_DEPENDENCIES_CHANGED');
 }
 assert.notEqual(policyHashes[versions[0]],policyHashes[versions[1]],'DISTINCT_PARSER_POLICIES_REQUIRED');
 const frozen=await bound(review.parser_manifest),source=await bound(review.source_manifest),correction=await bound(review.correction_manifest);
 assert.equal(frozen.status,'PASS_COMPLETE_LOCAL_EXPANDED_CANDIDATE_DRY_RUN','BASE_PARSER_NOT_COMPLETE');assert.equal(frozen.parent_rows,source.rows,'BASE_SOURCE_COUNT_MISMATCH');
 assert.equal(frozen.binding.source_manifest_file_sha256,review.source_manifest.sha256);assert.equal(frozen.binding.source_manifest_sha256,source.manifest_sha256);
 assert.equal(frozen.binding.parser_sha256,review.parser_registry[versions[0]].parser_sha256);assert.deepEqual(frozen.binding.dependencies,v1.DEPENDENCY_HASHES);
 assert.equal(frozen.binding.runner_sha256,await hashFile(path.join(__dirname,'run-expanded-local-dry-run.cjs')),'BASE_RUNNER_CHANGED');
 assert.equal(correction.contract,'WF_EXPANDED_REFERENCE_ANCHOR_CORRECTIONS_V2','CORRECTION_CONTRACT_INVALID');assert.equal(correction.status,'COMPLETE_LOCAL_CORRECTION_REBUILD_PENDING_REVIEW','CORRECTION_NOT_COMPLETE');
 assert.deepEqual(correction.base_parser_manifest,review.parser_manifest,'CORRECTION_BASE_MANIFEST_MISMATCH');assert.deepEqual(correction.binding.source_manifest,review.source_manifest);assert.deepEqual(correction.binding.base_binding,frozen.binding);
 for(const file of ['expanded-evidence-candidates.cjs','expanded-evidence-candidates-v2.cjs','expanded-reference-anchor-policy-v2.cjs','run-expanded-reference-anchor-corrections-v2.cjs'])assert.equal(correction.binding.parser_files[file],await hashFile(path.join(__dirname,file)),'CORRECTION_CODE_CHANGED');
 assert.equal(correction.processed_parts.length,frozen.parts.length,'CORRECTION_SCAN_INCOMPLETE');
 correction.processed_parts.forEach((p,i)=>{assert.equal(p.original_parser_part_index,i);assert.deepEqual(p.original_candidates,frozen.parts[i].candidates);});
 const affected=new Map(),oldHashes=new Set(),affectedSourceHashes=new Set();let lastOriginal=-1;
 for(const part of correction.correction_parts){
  assert.ok(Number.isInteger(part.original_parser_part_index)&&part.original_parser_part_index>lastOriginal,'CORRECTION_PART_ORDER_INVALID');lastOriginal=part.original_parser_part_index;
  assert.deepEqual(part.original_candidates,frozen.parts[lastOriginal].candidates,'CORRECTION_ORIGINAL_PART_MISMATCH');
  for(const row of await boundLines(part.affected_parents)){
   assert.equal(row.original_parser_part_index,lastOriginal);assert.ok(digest(row.source_hash)&&Array.isArray(row.original_candidate_hashes)&&Array.isArray(row.repaired_candidate_hashes),'CORRECTION_PARENT_SHAPE_INVALID');assert.ok(row.issues.length>0,'CORRECTION_REASON_REQUIRED');
   const key=row.source_id+':'+row.source_hash;assert.ok(!affected.has(key),'CORRECTION_PARENT_DUPLICATE');affected.set(key,row);affectedSourceHashes.add(row.source_hash);
   for(const h of row.original_candidate_hashes){assert.ok(digest(h)&&!oldHashes.has(h),'ORIGINAL_CANDIDATE_DUPLICATE');oldHashes.add(h);}
  }
 }
 assert.equal(affected.size,correction.counts.affected_parents,'CORRECTION_PARENT_COUNT_MISMATCH');
 assert.ok(Array.isArray(review.parts)&&Array.isArray(review.correction_parts),'SELECTION_PARTS_REQUIRED');
 const total=[...review.parts,...review.correction_parts].reduce((n,p)=>n+p.selection.rows,0);assert.ok(Number.isSafeInteger(total)&&total>0);assert.equal(total,review.selected_candidate_count,'GLOBAL_SELECTION_COUNT_MISMATCH');
 const paths=new Set();for(const p of [...review.parts,...review.correction_parts]){assert.ok(Number.isInteger(p.selection.rows)&&p.selection.rows>0);const file=path.resolve(p.selection.file);assert.ok(!paths.has(file),'SELECTION_FILE_REUSED');paths.add(file);}
 let emitted=0,baseProof=null;const partProofs=[];
 if(review.parts.length){
  // This private derived file reuses the unchanged V1 exact rebuild gate. It is
  // not a separate SQL authorization: only the global reviewed SHA is emitted.
  const derived={contract:originalGate.CONTRACT,status:originalGate.SEALED,policy_hash:policyHashes[versions[0]],parser_manifest:review.parser_manifest,source_manifest:review.source_manifest,parts:review.parts,selected_candidate_count:review.parts.reduce((n,p)=>n+p.selection.rows,0)};
  const bytes=Buffer.from(JSON.stringify(derived)),derivedHash=sha(bytes),file=path.join(path.dirname(reviewManifestFile),'derived-v1-proof-'+derivedHash+'.json');
  if(fs.existsSync(file))assert.equal(await hashFile(file),derivedHash);else fs.writeFileSync(file,bytes,{flag:'wx'});
  baseProof=await originalGate.verifyReviewedAdmissions({reviewManifestFile:file,expectedReviewManifestSha256:derivedHash,policyHash:policyHashes[versions[0]],onAdmission:async row=>{
   assert.ok(!oldHashes.has(row.candidate_hash)&&!affectedSourceHashes.has(row.source_hash),'SUPERSEDED_V1_CANDIDATE_SELECTED');
   await onAdmission({...row,review_manifest_sha256:expectedReviewManifestSha256});emitted++;
  }});
 }
 const reader=sourceCursor(source,path.dirname(path.resolve(review.source_manifest.file)));let priorPart=-1,lastKey=null,rebuilt=null,parents=0;
 try{for(const selectedPart of review.correction_parts){
  assert.ok(Number.isInteger(selectedPart.correction_part_index)&&selectedPart.correction_part_index>priorPart,'CORRECTION_SELECTION_ORDER_INVALID');priorPart=selectedPart.correction_part_index;
  const part=correction.correction_parts[priorPart];assert.ok(part,'CORRECTION_SELECTED_PART_MISSING');assert.equal(selectedPart.original_parser_part_index,part.original_parser_part_index);
  const selected=new Map();for(const item of await boundLines(selectedPart.selection)){assert.deepEqual(Object.keys(item).sort(),['candidate_hash','source_hash']);assert.ok(digest(item.candidate_hash)&&digest(item.source_hash));assert.ok(!selected.has(item.candidate_hash),'DUPLICATE_SELECTED_CORRECTION');selected.set(item.candidate_hash,item.source_hash);}
  assert.equal(await hashFile(part.candidates.file),part.candidates.sha256,'CORRECTION_CANDIDATE_PART_CHANGED');let rows=0,accepted=0;
  for await(const line of jsonLines(part.candidates.file)){
   rows++;const stored=JSON.parse(line);if(!selected.has(stored.candidate_hash))continue;assert.equal(selected.get(stored.candidate_hash),stored.source_hash,'SELECTED_CORRECTION_SOURCE_MISMATCH');
   const key=stored.source_id+':'+stored.source_hash,parent=affected.get(key);assert.ok(parent&&parent.original_parser_part_index===part.original_parser_part_index,'CORRECTION_PARENT_NOT_REVIEWED');
   const canonical=stableJson(stored.candidate);assert.equal(sha(canonical),stored.candidate_hash,'CORRECTION_CANONICAL_HASH_MISMATCH');const raw=await reader.get(stored);
   if(key!==lastKey){const staged={source_id:stored.source_id,source_hash:stored.source_hash,raw_payload:raw,source_system:source.source_system,source_database:source.source_database,source_table:source.source_table,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};
    const old=v1.buildExpandedCandidates(staged),next=v2.buildExpandedCandidates(staged);assert.deepEqual(old.candidates.map(e=>e.candidate_hash),parent.original_candidate_hashes,'CORRECTION_ORIGINAL_PARENT_PROOF_MISMATCH');assert.deepEqual(old.candidates.flatMap(e=>findAnchorIssues(e.candidate).map(issue=>({...issue,original_candidate_hash:e.candidate_hash}))),parent.issues,'CORRECTION_ROLE_EVIDENCE_MISMATCH');assert.deepEqual(next.candidates.map(e=>e.candidate_hash),parent.repaired_candidate_hashes,'CORRECTION_REBUILT_PARENT_PROOF_MISMATCH');rebuilt=new Map(next.candidates.map(e=>[e.candidate_hash,e]));lastKey=key;parents++;
   }
   const exact=rebuilt.get(stored.candidate_hash);assert.ok(exact&&exact.canonical_json===canonical,'CORRECTION_NOT_EXACT_JS_REBUILD');assert.equal(exact.candidate.decision.trading_floor,'TF_SUPPORTED_CANDIDATE','CORRECTION_CANDIDATE_HELD');assert.deepEqual(exact.candidate.decision.reasons,[]);
   await onAdmission({candidate_hash:stored.candidate_hash,source_hash:stored.source_hash,policy_hash:policyHashes[versions[1]],review_manifest_sha256:expectedReviewManifestSha256});selected.delete(stored.candidate_hash);accepted++;emitted++;
  }
  assert.equal(rows,part.candidates.rows);assert.equal(selected.size,0,'SELECTED_CORRECTION_MISSING');assert.equal(accepted,selectedPart.selection.rows);partProofs.push({correction_part_index:priorPart,original_parser_part_index:part.original_parser_part_index,candidates_sha256:part.candidates.sha256,selection_sha256:selectedPart.selection.sha256,admitted:accepted});
 }}finally{await reader.close();}
 assert.equal(emitted,review.selected_candidate_count,'FINAL_ADMISSION_COUNT_MISMATCH');
 return {status:'PASS_EXACT_MIXED_VERSION_REVIEWED_EXPANDED_ADMISSIONS',contract:CONTRACT,review_manifest_sha256:expectedReviewManifestSha256,policy_hashes:policyHashes,verified_admissions:emitted,base_proof:baseProof,correction_parts:partProofs,rebuilt_correction_parents:parents,correction_manifest_sha256:review.correction_manifest.sha256,production_mutations:0,source_mutations:0,database_queries:0};
}
module.exports={CONTRACT,SEALED,verifyReviewedAdmissionsV2};
