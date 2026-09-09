'use strict';
// Seven exact policies. Rebuild selected V7 sources and independently resolve
// their real previous sibling membership; no database access or publication.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const older=require('./expanded-reviewed-admissions-v6.cjs'),base=require('./expanded-reviewed-admissions-v5.cjs'),v7=require('./expanded-evidence-candidates-v7-explicit-source.cjs');
const {stableJson}=require('./lossless-payload-sanitizer.cjs'),{jsonLines}=require('./run-expanded-local-dry-run.cjs');
const CONTRACT='WF_EXPANDED_REVIEWED_ADMISSIONS_V7',SEALED='SEALED_REVIEWED_EXPANDED_ADMISSIONS_V7';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const VERSIONS={V1:'expanded-evidence-v1',V2:'expanded-evidence-v2-role-anchors',V3:'expanded-evidence-v3-source-scope',V5:'expanded-evidence-v5-offer-boundaries',V6:'expanded-evidence-v6-inventory-section-r2'};
async function hashFile(f){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(f))h.update(b);return h.digest('hex');}
async function bound(ref){assert.ok(ref&&typeof ref.file==='string'&&digest(ref.sha256));assert.equal(await hashFile(ref.file),ref.sha256);return JSON.parse(fs.readFileSync(ref.file,'utf8'));}
async function* checkedRows(ref){assert.ok(Number.isSafeInteger(ref.rows)&&ref.rows>=0);assert.equal(await hashFile(ref.file),ref.sha256);let rows=0;for await(const line of jsonLines(ref.file)){yield JSON.parse(line);rows++;}assert.equal(rows,ref.rows);}
function sameSource(a,b){for(const k of ['source_id','source_hash','raw_chunk','raw_chunk_sha256','row_index'])assert.equal(a[k],b[k]);}
async function actualPrevious(part,wanted,inputs){
 const out=new Map();
 for await(const row of checkedRows(inputs.frozen.parts[part].parents))if(wanted.has(row.source_hash)){
  const parent=wanted.get(row.source_hash);sameSource(row,parent);out.set(row.source_hash,{registry:'V1',reference:inputs.frozen.parts[part].candidates,count:row.candidate_count,entries:[]});
 }
 assert.equal(out.size,wanted.size,'EXPLICIT_PREVIOUS_SOURCE_MISSING');
 for(const [registry,map]of inputs.layers){const layer=map.get(part);if(!layer)continue;
  for await(const row of checkedRows(layer.affected_parents))if(wanted.has(row.source_hash)){
   sameSource(row,wanted.get(row.source_hash));if(registry==='V5'||registry==='V6')assert.equal(row.supersedes_all_older_candidates_for_parent,true);
   out.set(row.source_hash,{registry,reference:layer.candidates,hashes:row.repaired_candidate_hashes,entries:[]});
  }
 }
 for(const registry of Object.keys(VERSIONS)){
  const selected=[...out.entries()].filter(([,v])=>v.registry===registry);if(!selected.length)continue;
  const reference=selected[0][1].reference;for(const [,entry]of selected)assert.deepEqual(entry.reference,reference);
  for await(const row of checkedRows(reference)){
   const entry=out.get(row.source_hash);if(!entry||entry.registry!==registry)continue;sameSource(row,wanted.get(row.source_hash));
   const text=stableJson(row.candidate);if(row.canonical_json!==undefined)assert.equal(row.canonical_json,text);assert.equal(sha(text),row.candidate_hash);
   assert.equal(row.candidate.source_id,row.source_id);assert.equal(row.candidate.source_hash,row.source_hash);assert.equal(row.candidate.parser_version,VERSIONS[registry]);
   entry.entries.push({candidate_hash:row.candidate_hash,candidate:row.candidate,canonical_json:text});
  }
 }
 for(const [hash,entry]of out){const parent=wanted.get(hash),hashes=entry.entries.map(e=>e.candidate_hash);
  if(entry.hashes)base.sameHashes(hashes,entry.hashes);else assert.equal(hashes.length,entry.count);
  assert.equal(parent.previous_active_parser_version,entry.registry);assert.deepEqual(parent.previous_actual_candidate_file,entry.reference);
  base.sameHashes(parent.previous_actual_candidate_hashes,hashes);
 }
 return out;
}
function verifyExplicitParent(staged,parent,previous){
 assert.equal(sha(stableJson(staged.raw_payload)),parent.source_hash);assert.equal(staged.source_id,parent.source_id);assert.equal(staged.source_hash,parent.source_hash);
 assert.equal(sha(staged.raw_payload[parent.parent_source_field]),parent.parent_field_hash);assert.equal(parent.parser_version,v7.PARSER_VERSION);
 assert.equal(parent.disposition,'WHOLE_PARENT_EXPLICIT_SOURCE_REBUILT_PENDING_REVIEW');assert.equal(parent.supersedes_all_older_candidates_for_parent,true);
 assert.equal(parent.previous_active_parser_version,previous.registry);assert.deepEqual(parent.previous_actual_candidate_file,previous.reference);
 base.sameHashes(parent.previous_actual_candidate_hashes,previous.entries.map(e=>e.candidate_hash));
 const before=stableJson(staged.raw_payload),next=v7.buildExpandedCandidates(staged);assert.equal(stableJson(staged.raw_payload),before);
 base.sameHashes(parent.repaired_candidate_hashes,next.candidates.map(e=>e.candidate_hash));base.sameHashes(parent.rebuilt_witness_hashes,parent.repaired_candidate_hashes);
 return{output:next,byHash:new Map(next.candidates.map(e=>[e.candidate_hash,e]))};
}
function verifyExplicitCoverage(correction,census,frozen){
 assert.equal(correction.status,'COMPLETE');assert.equal(correction.binding.contract,'WF_V7_ACTUAL_LATEST_WHOLE_PARENT_CORRECTION_V1');assert.equal(correction.binding.canary,false);assert.equal(correction.admission_authority,false);
 assert.equal(census.status,'COMPLETE');assert.equal(census.counts.parents,1527898);assert.equal(frozen.parent_rows,1527898);assert.equal(frozen.parts.length,6112);
 assert.equal(correction.binding.limit_parts,6112);assert.equal(correction.processed_parts.length,6112);const counts={},chunkCounts=new Map(),expected=[];
 correction.processed_parts.forEach((p,i)=>{assert.equal(p.original_parser_part_index,i);const ci=Math.floor(i/20);assert.deepEqual(p.census_part,census.parts[ci].matches);
  assert.equal(p.parents.rows,p.counts.matched_parents);assert.equal(p.candidates.rows,p.counts.rebuilt_candidates);assert.equal(p.affected_parents.rows,p.counts.changed_parents);
  assert.equal(p.counts.matched_parents,p.counts.changed_parents+p.counts.unchanged_parents+p.counts.retained_v4_parents);
  for(const[k,v]of Object.entries(p.counts)){assert.ok(Number.isSafeInteger(v)&&v>=0);counts[k]=(counts[k]||0)+v;}
  chunkCounts.set(ci,(chunkCounts.get(ci)||0)+p.counts.matched_parents);
  if(p.counts.changed_parents)expected.push({original_parser_part_index:i,candidates:p.candidates,affected_parents:p.affected_parents,changed_parents:p.counts.changed_parents});
 });
 assert.deepEqual(counts,correction.counts);assert.deepEqual(correction.correction_parts,expected);assert.equal(counts.matched_parents,census.counts.matched_parents);
 census.parts.forEach((p,i)=>assert.equal(chunkCounts.get(i),p.matches.rows));
}
async function verifyReviewedAdmissionsV7({reviewManifestFile,expectedReviewManifestSha256,policyHashes,onAdmission}){
 assert.ok(digest(expectedReviewManifestSha256)&&typeof onAdmission==='function');const review=await bound({file:reviewManifestFile,sha256:expectedReviewManifestSha256});assert.equal(review.contract,CONTRACT);assert.equal(review.status,SEALED);
 const versions=['expanded-evidence-v1','expanded-evidence-v2-role-anchors','expanded-evidence-v3-source-scope','expanded-evidence-v4-reviewed-specific','expanded-evidence-v5-offer-boundaries','expanded-evidence-v6-inventory-section-r2',v7.PARSER_VERSION];
 assert.deepEqual(Object.keys(review.parser_registry).sort(),versions.slice().sort());assert.deepEqual(Object.keys(policyHashes).sort(),versions.slice().sort());assert.equal(new Set(Object.values(policyHashes)).size,7);
 const registration=review.parser_registry[v7.PARSER_VERSION];assert.ok(digest(registration.policy_hash));assert.equal(registration.policy_hash,policyHashes[v7.PARSER_VERSION]);assert.equal(registration.parser_sha256,await hashFile(path.join(__dirname,'expanded-evidence-candidates-v7-explicit-source.cjs')));assert.deepEqual(registration.dependency_hashes,v7.DEPENDENCY_HASHES);
 const correction=await bound(review.explicit_source_correction_manifest),census=await bound(correction.binding.census),source=await bound(review.source_manifest),frozen=await bound(review.parser_manifest);
 verifyExplicitCoverage(correction,census,frozen);assert.deepEqual(correction.binding.source,review.source_manifest);assert.deepEqual(census.binding.source,review.source_manifest);assert.equal(frozen.binding.source_manifest_file_sha256,review.source_manifest.sha256);assert.equal(source.rows,1527898);assert.equal(source.status,'COMPLETE');
 for(const ref of [...correction.binding.runtime,...census.binding.runtime])assert.equal(await hashFile(ref.file),ref.sha256,'EXPLICIT_CORRECTION_RUNTIME_CHANGED');assert.deepEqual(correction.binding.new_dependencies,v7.DEPENDENCY_HASHES);
 assert.deepEqual(correction.binding.v5_manifest,review.offer_boundary_correction_manifest);assert.deepEqual(correction.binding.v6_manifest,review.inventory_correction_manifest);
 const semantic=await bound(review.explicit_source_correction_review);assert.equal(semantic.status,'PASS_ROOT_COMPLETE_V7_SOURCE_CORRECTION_AND_SEMANTIC_REVIEW');assert.equal(semantic.reviewed_manifest.sha256,review.explicit_source_correction_manifest.sha256);assert.equal(semantic.parser_sha256,registration.parser_sha256);assert.equal(semantic.all_changed_parents_accounted,true);assert.equal(semantic.final_stratified_semantic_qa_passed,true);assert.equal(semantic.actual_latest_sibling_membership_verified,true);
 const retained=await bound(correction.binding.v4_retention),specificHashes=new Set(retained.rows.map(r=>r.source_hash));assert.equal(specificHashes.size,42);
 const matched=new Map();for(const part of census.parts)for await(const p of checkedRows(part.matches)){assert.ok(!matched.has(p.source_hash));matched.set(p.source_hash,p);}assert.equal(matched.size,census.counts.matched_parents);
 const rawChunks=new Map();let total=0;for(const c of source.chunks){rawChunks.set(c.file,{...c,start:total});total+=c.rows;}assert.equal(total,1527898);
 const affected=new Set(),byPart=new Map();for(const part of correction.correction_parts){assert.equal(await hashFile(part.candidates.file),part.candidates.sha256);byPart.set(part.original_parser_part_index,part);
  for await(const p of checkedRows(part.affected_parents)){
   const detector=matched.get(p.source_hash);assert.ok(detector);for(const k of Object.keys(detector))assert.deepEqual(p[k],detector[k]);
   assert.ok(!affected.has(p.source_hash)&&!specificHashes.has(p.source_hash),'DUPLICATE_OR_RETAINED_V4_EXPLICIT_PARENT');affected.add(p.source_hash);
   const chunk=rawChunks.get(p.raw_chunk);assert.ok(chunk&&chunk.sha256===p.raw_chunk_sha256&&Number.isInteger(p.row_index)&&p.row_index>=0&&p.row_index<chunk.rows);
   assert.equal(Math.floor((chunk.start+p.row_index)/250),part.original_parser_part_index);assert.equal(p.original_parser_part_index,part.original_parser_part_index);
   assert.equal(p.parser_version,v7.PARSER_VERSION);assert.equal(p.disposition,'WHOLE_PARENT_EXPLICIT_SOURCE_REBUILT_PENDING_REVIEW');assert.equal(p.supersedes_all_older_candidates_for_parent,true);base.sameHashes(p.repaired_candidate_hashes,p.repaired_candidate_hashes);
  }
 }assert.equal(affected.size,correction.counts.changed_parents);
 assert.ok(Array.isArray(review.explicit_source_correction_selections));let selectedCount=0,previous=-1;const paths=new Set();
 for(const p of review.explicit_source_correction_selections){assert.ok(Number.isInteger(p.original_parser_part_index)&&p.original_parser_part_index>previous);previous=p.original_parser_part_index;const actual=byPart.get(previous);assert.ok(actual);for(const k of ['candidates','affected_parents'])assert.deepEqual(p[k],actual[k]);assert.ok(p.selections.rows>0);const file=path.resolve(p.selections.file);assert.ok(!paths.has(file));paths.add(file);selectedCount+=p.selections.rows;}
 const olderCount=review.selected_candidate_count-selectedCount;assert.ok(Number.isSafeInteger(olderCount)&&olderCount>0);let emitted=0;
 const {explicit_source_correction_manifest,explicit_source_correction_review,explicit_source_correction_selections,...oldShape}=review;
 const derived={...oldShape,contract:older.CONTRACT,status:older.SEALED,selected_candidate_count:olderCount,parser_registry:Object.fromEntries(versions.slice(0,6).map(v=>[v,review.parser_registry[v]]))};
 const bytes=Buffer.from(JSON.stringify(derived)),hash=sha(bytes),file=path.join(path.dirname(reviewManifestFile),'derived-v6-proof-'+hash+'.json');if(fs.existsSync(file))assert.equal(await hashFile(file),hash);else fs.writeFileSync(file,bytes,{flag:'wx'});
 const olderProof=await older.verifyReviewedAdmissionsV6({reviewManifestFile:file,expectedReviewManifestSha256:hash,policyHashes:Object.fromEntries(versions.slice(0,6).map(v=>[v,policyHashes[v]])),onAdmission:async row=>{assert.ok(!affected.has(row.source_hash),'SUPERSEDED_PRE_V7_CANDIDATE_SELECTED');await onAdmission({...row,review_manifest_sha256:expectedReviewManifestSha256});emitted++;}});
 const inputs={frozen,layers:[]};for(const [registry,ref]of [['V2',review.correction_manifest],['V3',review.scope_correction_manifest],['V5',review.offer_boundary_correction_manifest],['V6',review.inventory_correction_manifest]]){const m=await bound(ref);inputs.layers.push([registry,new Map(m.correction_parts.map(p=>[p.original_parser_part_index,p]))]);}
 const cursor=base.sourceCursor(source,path.dirname(path.resolve(review.source_manifest.file))),proofs=[];let rebuiltParents=0;
 try{for(const part of review.explicit_source_correction_selections){const selected=new Map(),parents=new Map();for await(const row of checkedRows(part.selections)){assert.deepEqual(Object.keys(row).sort(),['candidate_hash','source_hash']);assert.ok(digest(row.candidate_hash)&&digest(row.source_hash)&&affected.has(row.source_hash)&&!selected.has(row.candidate_hash));selected.set(row.candidate_hash,row.source_hash);}
  const needed=new Set(selected.values());for await(const p of checkedRows(part.affected_parents))if(needed.has(p.source_hash))parents.set(p.source_hash,p);assert.equal(parents.size,needed.size);
  const actual=await actualPrevious(part.original_parser_part_index,parents,inputs);let active=null,rebuilt=null,accepted=0;
  for await(const row of checkedRows(part.candidates)){if(!selected.has(row.candidate_hash))continue;assert.equal(selected.get(row.candidate_hash),row.source_hash);const parent=parents.get(row.source_hash);assert.ok(parent);sameSource(row,parent);assert.equal(row.original_parser_part_index,parent.original_parser_part_index);assert.equal(row.canonical_json,stableJson(row.candidate));assert.equal(sha(row.canonical_json),row.candidate_hash);
   if(active!==row.source_hash){const raw=await cursor.get(row),staged={source_id:row.source_id,source_hash:row.source_hash,raw_payload:raw,source_system:source.source_system,source_database:source.source_database,source_table:source.source_table,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};rebuilt=verifyExplicitParent(staged,parent,actual.get(row.source_hash));active=row.source_hash;rebuiltParents++;}
   const exact=rebuilt.byHash.get(row.candidate_hash);assert.ok(exact);assert.deepEqual(exact.candidate,row.candidate);assert.equal(exact.canonical_json,row.canonical_json);assert.equal(exact.candidate.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');assert.deepEqual(exact.candidate.decision.reasons,[]);
   await onAdmission({candidate_hash:row.candidate_hash,source_hash:row.source_hash,policy_hash:policyHashes[v7.PARSER_VERSION],review_manifest_sha256:expectedReviewManifestSha256});selected.delete(row.candidate_hash);emitted++;accepted++;
  }assert.equal(selected.size,0);assert.equal(accepted,part.selections.rows);proofs.push({original_parser_part_index:part.original_parser_part_index,candidates_sha256:part.candidates.sha256,selections_sha256:part.selections.sha256,admitted:accepted});
 }}finally{await cursor.close();}
 assert.equal(emitted,review.selected_candidate_count);return {contract:CONTRACT,status:'PASS_EXACT_SEVEN_VERSION_REVIEWED_EXPANDED_ADMISSIONS',review_manifest_sha256:expectedReviewManifestSha256,policy_hashes:policyHashes,verified_admissions:emitted,older_proof:olderProof,retained_specific_archive_verified_parents:olderProof.retained_specific_archive_verified_parents,offer_boundary_correction_manifest_sha256:review.offer_boundary_correction_manifest.sha256,inventory_correction_manifest_sha256:review.inventory_correction_manifest.sha256,explicit_source_correction_manifest_sha256:review.explicit_source_correction_manifest.sha256,affected_explicit_source_count:affected.size,rebuilt_explicit_parents:rebuiltParents,explicit_source_parts:proofs,production_mutations:0,source_mutations:0,database_queries:0};
}
module.exports={CONTRACT,SEALED,verifyExplicitParent,verifyExplicitCoverage,actualPrevious,verifyReviewedAdmissionsV7};
