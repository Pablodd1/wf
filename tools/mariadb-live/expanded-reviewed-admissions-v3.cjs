'use strict';
// Three frozen parser policies, one global reviewed selection. This gate only
// emits private admission evidence; it has no database or publication client.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const v1=require('./expanded-evidence-candidates.cjs'),v2=require('./expanded-evidence-candidates-v2.cjs'),v3=require('./expanded-evidence-candidates-v3.cjs');
const olderGate=require('./expanded-reviewed-admissions-v2.cjs'),{stableJson}=require('./lossless-payload-sanitizer.cjs'),{jsonLines}=require('./run-expanded-local-dry-run.cjs');
const CONTRACT='WF_EXPANDED_REVIEWED_ADMISSIONS_V3',SEALED='SEALED_REVIEWED_EXPANDED_ADMISSIONS_V3';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const parserFiles=[[v1,'expanded-evidence-candidates.cjs'],[v2,'expanded-evidence-candidates-v2.cjs'],[v3,'expanded-evidence-candidates-v3.cjs']];
const v2Files=['expanded-evidence-candidates.cjs','expanded-evidence-candidates-v2.cjs','expanded-reference-anchor-policy-v2.cjs','run-expanded-reference-anchor-corrections-v2.cjs'];
const v3Files=['expanded-evidence-candidates.cjs','expanded-evidence-candidates-v2.cjs','expanded-evidence-candidates-v3.cjs','expanded-reference-anchor-policy-v2.cjs','expanded-source-scope-policy-v3.cjs','run-expanded-source-scope-corrections-v3.cjs'];
async function hashFile(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function bound(p){assert.ok(p&&typeof p.file==='string'&&digest(p.sha256),'FILE_BINDING_REQUIRED');const b=await fs.promises.readFile(p.file);assert.equal(sha(b),p.sha256,'BOUND_FILE_HASH_MISMATCH');return JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));}
async function lines(p){assert.equal(await hashFile(p.file),p.sha256,'BOUND_PART_HASH_MISMATCH');const rows=[];for await(const line of jsonLines(p.file))rows.push(JSON.parse(line));assert.equal(rows.length,p.rows,'BOUND_PART_ROWS_MISMATCH');return rows;}
function scopeIssues(entries){
 const bySpan=new Map();for(const e of entries)for(const issue of v3.inspectLegacyCandidateScope(e.candidate)){
  const key=stableJson([issue.reason,issue.field,issue.start,issue.end,issue.quote_sha256]);let row=bySpan.get(key);if(!row){row={...issue,original_candidate_hashes:[]};bySpan.set(key,row);}if(!row.original_candidate_hashes.includes(e.candidate_hash))row.original_candidate_hashes.push(e.candidate_hash);
 }return[...bySpan.values()];
}
function sourceCursor(source,directory){
 const chunks=new Map(source.chunks.map((c,index)=>[c.file,{...c,index}]));let active=null,stream=null,index=-1,line=null;
 return{async get(p){const c=chunks.get(p.raw_chunk);assert.ok(c&&c.sha256===p.raw_chunk_sha256,'RAW_CHUNK_BINDING_MISMATCH');assert.ok(Number.isInteger(p.row_index)&&p.row_index>=0&&p.row_index<c.rows,'RAW_ROW_INDEX_INVALID');
  if(active?.file!==c.file){assert.ok(!active||c.index>active.index,'RAW_CHUNK_ORDER_INVALID');if(stream)await stream.return();const file=path.resolve(directory,c.file),rel=path.relative(directory,file);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'RAW_PATH_OUTSIDE_ARCHIVE');assert.equal(await hashFile(file),c.sha256,'RAW_CHUNK_HASH_MISMATCH');stream=jsonLines(file)[Symbol.asyncIterator]();active=c;index=-1;}
  assert.ok(p.row_index>=index,'RAW_ROW_ORDER_INVALID');while(index<p.row_index){const n=await stream.next();assert.equal(n.done,false,'RAW_ROW_MISSING');line=n.value;index++;}assert.equal(sha(line),p.source_hash,'RAW_SOURCE_HASH_MISMATCH');const raw=JSON.parse(line);assert.equal(String(raw.id),p.source_id,'RAW_SOURCE_ID_MISMATCH');assert.equal(stableJson(raw),line,'RAW_CANONICAL_MISMATCH');return raw;
 },async close(){if(stream)await stream.return();}};
}
async function verifyReviewedAdmissionsV3({reviewManifestFile,expectedReviewManifestSha256,policyHashes,onAdmission}){
 assert.ok(digest(expectedReviewManifestSha256)&&typeof onAdmission==='function','REVIEW_HASH_AND_PRIVATE_SINK_REQUIRED');
 const review=await bound({file:reviewManifestFile,sha256:expectedReviewManifestSha256});assert.equal(review.contract,CONTRACT);assert.equal(review.status,SEALED,'REVIEW_NOT_SEALED');
 const versions=parserFiles.map(([p])=>p.PARSER_VERSION);assert.deepEqual(Object.keys(policyHashes||{}).sort(),versions.slice().sort(),'POLICY_REGISTRY_KEYS_INVALID');assert.deepEqual(Object.keys(review.parser_registry||{}).sort(),versions.slice().sort(),'PARSER_REGISTRY_KEYS_INVALID');
 for(const [parser,file]of parserFiles){const p=review.parser_registry[parser.PARSER_VERSION];assert.ok(digest(policyHashes[parser.PARSER_VERSION]));assert.equal(p.policy_hash,policyHashes[parser.PARSER_VERSION],'POLICY_HASH_MISMATCH');assert.equal(p.parser_sha256,await hashFile(path.join(__dirname,file)),'PARSER_CODE_CHANGED');assert.deepEqual(p.dependency_hashes,parser.DEPENDENCY_HASHES,'PARSER_DEPENDENCIES_CHANGED');}
 assert.equal(new Set(Object.values(policyHashes)).size,3,'DISTINCT_PARSER_POLICIES_REQUIRED');
 const frozen=await bound(review.parser_manifest),source=await bound(review.source_manifest),previous=await bound(review.correction_manifest),correction=await bound(review.scope_correction_manifest);
 assert.equal(frozen.status,'PASS_COMPLETE_LOCAL_EXPANDED_CANDIDATE_DRY_RUN','BASE_PARSER_NOT_COMPLETE');assert.equal(frozen.parent_rows,source.rows);assert.equal(frozen.binding.source_manifest_file_sha256,review.source_manifest.sha256);assert.equal(frozen.binding.source_manifest_sha256,source.manifest_sha256);assert.equal(frozen.binding.parser_sha256,review.parser_registry[v1.PARSER_VERSION].parser_sha256);assert.deepEqual(frozen.binding.dependencies,v1.DEPENDENCY_HASHES);assert.equal(frozen.binding.runner_sha256,await hashFile(path.join(__dirname,'run-expanded-local-dry-run.cjs')));
 for(const [document,contract,files]of [[previous,'WF_EXPANDED_REFERENCE_ANCHOR_CORRECTIONS_V2',v2Files],[correction,'WF_EXPANDED_SOURCE_SCOPE_CORRECTIONS_V3',v3Files]]){
  assert.equal(document.contract,contract,'CORRECTION_CONTRACT_INVALID');assert.equal(document.status,'COMPLETE_LOCAL_CORRECTION_REBUILD_PENDING_REVIEW','CORRECTION_NOT_COMPLETE');assert.deepEqual(document.base_parser_manifest,review.parser_manifest);assert.deepEqual(document.binding.source_manifest,review.source_manifest);assert.deepEqual(document.binding.base_binding,frozen.binding);
  for(const file of files)assert.equal(document.binding.parser_files[file],await hashFile(path.join(__dirname,file)),'CORRECTION_CODE_CHANGED');
  assert.equal(document.processed_parts.length,frozen.parts.length,'CORRECTION_SCAN_INCOMPLETE');document.processed_parts.forEach((p,i)=>{assert.equal(p.original_parser_part_index,i);assert.deepEqual(p.original_candidates,frozen.parts[i].candidates);});
 }
 assert.equal(correction.supersession,'ALL_OLDER_V1_AND_V2_CANDIDATES_OF_EACH_AFFECTED_PARENT','SCOPE_SUPERSESSION_REQUIRED');
 const affected=new Map(),affectedHashes=new Set();let lastOriginal=-1;
 for(const part of correction.correction_parts){assert.ok(Number.isInteger(part.original_parser_part_index)&&part.original_parser_part_index>lastOriginal,'CORRECTION_PART_ORDER_INVALID');lastOriginal=part.original_parser_part_index;assert.deepEqual(part.original_candidates,frozen.parts[lastOriginal].candidates);
  for(const p of await lines(part.affected_parents)){assert.equal(p.original_parser_part_index,lastOriginal);assert.ok(digest(p.source_hash));assert.ok(Array.isArray(p.original_candidate_hashes)&&Array.isArray(p.previous_v2_candidate_hashes)&&Array.isArray(p.repaired_candidate_hashes)&&p.issues.length);assert.equal(p.supersedes_all_older_candidates_for_parent,true);const key=p.source_id+':'+p.source_hash;assert.ok(!affected.has(key),'CORRECTION_PARENT_DUPLICATE');affected.set(key,p);affectedHashes.add(p.source_hash);}
 }
 assert.equal(affected.size,correction.counts.affected_parents);
 for(const name of ['parts','correction_parts','scope_correction_parts'])assert.ok(Array.isArray(review[name]),'SELECTION_PARTS_REQUIRED');
 const allParts=[...review.parts,...review.correction_parts,...review.scope_correction_parts],total=allParts.reduce((n,p)=>n+p.selection.rows,0),paths=new Set();assert.ok(Number.isSafeInteger(total)&&total>0);assert.equal(total,review.selected_candidate_count,'GLOBAL_SELECTION_COUNT_MISMATCH');
 for(const p of allParts){assert.ok(Number.isInteger(p.selection.rows)&&p.selection.rows>0);const file=path.resolve(p.selection.file);assert.ok(!paths.has(file),'SELECTION_FILE_REUSED');paths.add(file);}
 let emitted=0,olderProof=null;const partProofs=[];
 if(review.parts.length||review.correction_parts.length){
  const olderPolicies=Object.fromEntries(versions.slice(0,2).map(v=>[v,policyHashes[v]]));
  const derived={contract:olderGate.CONTRACT,status:olderGate.SEALED,parser_manifest:review.parser_manifest,source_manifest:review.source_manifest,correction_manifest:review.correction_manifest,parser_registry:Object.fromEntries(versions.slice(0,2).map(v=>[v,review.parser_registry[v]])),parts:review.parts,correction_parts:review.correction_parts,selected_candidate_count:[...review.parts,...review.correction_parts].reduce((n,p)=>n+p.selection.rows,0)};
  const bytes=Buffer.from(JSON.stringify(derived)),hash=sha(bytes),file=path.join(path.dirname(reviewManifestFile),'derived-v2-proof-'+hash+'.json');if(fs.existsSync(file))assert.equal(await hashFile(file),hash);else fs.writeFileSync(file,bytes,{flag:'wx'});
  olderProof=await olderGate.verifyReviewedAdmissionsV2({reviewManifestFile:file,expectedReviewManifestSha256:hash,policyHashes:olderPolicies,onAdmission:async row=>{assert.ok(!affectedHashes.has(row.source_hash),'SUPERSEDED_OLDER_PARENT_CANDIDATE_SELECTED');await onAdmission({...row,review_manifest_sha256:expectedReviewManifestSha256});emitted++;}});
 }
 const reader=sourceCursor(source,path.dirname(path.resolve(review.source_manifest.file)));let priorPart=-1,lastKey=null,rebuilt=null,rebuiltParents=0;
 try{for(const selectedPart of review.scope_correction_parts){
  assert.ok(Number.isInteger(selectedPart.correction_part_index)&&selectedPart.correction_part_index>priorPart,'SCOPE_SELECTION_ORDER_INVALID');priorPart=selectedPart.correction_part_index;const part=correction.correction_parts[priorPart];assert.ok(part);assert.equal(selectedPart.original_parser_part_index,part.original_parser_part_index);
  const selected=new Map();for(const r of await lines(selectedPart.selection)){assert.deepEqual(Object.keys(r).sort(),['candidate_hash','source_hash']);assert.ok(digest(r.candidate_hash)&&digest(r.source_hash));assert.ok(!selected.has(r.candidate_hash),'DUPLICATE_SELECTED_SCOPE_CORRECTION');selected.set(r.candidate_hash,r.source_hash);}
  assert.equal(await hashFile(part.candidates.file),part.candidates.sha256,'SCOPE_CANDIDATE_PART_CHANGED');let rows=0,accepted=0;
  for await(const line of jsonLines(part.candidates.file)){rows++;const stored=JSON.parse(line);if(!selected.has(stored.candidate_hash))continue;assert.equal(selected.get(stored.candidate_hash),stored.source_hash);const key=stored.source_id+':'+stored.source_hash,parent=affected.get(key);assert.ok(parent&&parent.original_parser_part_index===part.original_parser_part_index,'SCOPE_PARENT_NOT_REVIEWED');
   const canonical=stableJson(stored.candidate);assert.equal(sha(canonical),stored.candidate_hash,'SCOPE_CANONICAL_HASH_MISMATCH');const raw=await reader.get(stored);
   if(key!==lastKey){const staged={source_id:stored.source_id,source_hash:stored.source_hash,raw_payload:raw,source_system:source.source_system,source_database:source.source_database,source_table:source.source_table,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};
    const a=v1.buildExpandedCandidates(staged),b=v2.buildExpandedCandidates(staged),c=v3.buildExpandedCandidates(staged);assert.deepEqual(a.candidates.map(e=>e.candidate_hash),parent.original_candidate_hashes,'SCOPE_ORIGINAL_PARENT_PROOF_MISMATCH');assert.deepEqual(b.candidates.map(e=>e.candidate_hash),parent.previous_v2_candidate_hashes,'SCOPE_PREVIOUS_V2_PARENT_PROOF_MISMATCH');assert.deepEqual(scopeIssues(a.candidates),parent.issues,'SCOPE_REASON_EVIDENCE_MISMATCH');assert.deepEqual(c.candidates.map(e=>e.candidate_hash),parent.repaired_candidate_hashes,'SCOPE_REBUILT_PARENT_PROOF_MISMATCH');rebuilt=new Map(c.candidates.map(e=>[e.candidate_hash,e]));lastKey=key;rebuiltParents++;
   }
   const exact=rebuilt.get(stored.candidate_hash);assert.ok(exact&&exact.canonical_json===canonical,'SCOPE_NOT_EXACT_JS_REBUILD');assert.equal(exact.candidate.decision.trading_floor,'TF_SUPPORTED_CANDIDATE','SCOPE_CANDIDATE_HELD');assert.deepEqual(exact.candidate.decision.reasons,[]);
   await onAdmission({candidate_hash:stored.candidate_hash,source_hash:stored.source_hash,policy_hash:policyHashes[v3.PARSER_VERSION],review_manifest_sha256:expectedReviewManifestSha256});selected.delete(stored.candidate_hash);emitted++;accepted++;
  }
  assert.equal(rows,part.candidates.rows);assert.equal(selected.size,0,'SELECTED_SCOPE_CORRECTION_MISSING');assert.equal(accepted,selectedPart.selection.rows);partProofs.push({correction_part_index:priorPart,original_parser_part_index:part.original_parser_part_index,candidates_sha256:part.candidates.sha256,selection_sha256:selectedPart.selection.sha256,admitted:accepted});
 }}finally{await reader.close();}
 assert.equal(emitted,review.selected_candidate_count,'FINAL_ADMISSION_COUNT_MISMATCH');return{status:'PASS_EXACT_THREE_VERSION_REVIEWED_EXPANDED_ADMISSIONS',contract:CONTRACT,review_manifest_sha256:expectedReviewManifestSha256,policy_hashes:policyHashes,verified_admissions:emitted,older_proof:olderProof,scope_correction_parts:partProofs,rebuilt_scope_parents:rebuiltParents,scope_correction_manifest_sha256:review.scope_correction_manifest.sha256,production_mutations:0,source_mutations:0,database_queries:0};
}
module.exports={CONTRACT,SEALED,verifyReviewedAdmissionsV3,scopeIssues};
