'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../expanded-evidence-candidates-v7-explicit-source.cjs'),V6=require('../expanded-evidence-candidates-v6-r2.cjs');
const {stableJson,sha256}=require('../lossless-payload-sanitizer.cjs');
const {verifyExplicitParent,verifyExplicitCoverage}=require('../expanded-reviewed-admissions-v7.cjs');
function fixture(){
 const raw={id:'explicit-test',title:'Rolex 126334 USD23.1k',type:'sale',status:'ended'};
 const staged={source_id:raw.id,source_hash:sha256(stableJson(raw)),raw_payload:raw,source_system:'TEST',source_database:'TEST',source_table:'TEST',canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};
 const previous={registry:'V6',reference:{file:'test-only.gz',sha256:sha256('test')},entries:V6.buildExpandedCandidates(staged).candidates};
 const next=P.buildExpandedCandidates(staged),hashes=next.candidates.map(e=>e.candidate_hash);
 const parent={source_id:raw.id,source_hash:staged.source_hash,parent_source_field:'title',parent_field_hash:sha256(raw.title),parser_version:P.PARSER_VERSION,
  disposition:'WHOLE_PARENT_EXPLICIT_SOURCE_REBUILT_PENDING_REVIEW',supersedes_all_older_candidates_for_parent:true,previous_active_parser_version:'V6',
  previous_actual_candidate_file:previous.reference,previous_actual_candidate_hashes:previous.entries.map(e=>e.candidate_hash),repaired_candidate_hashes:hashes,rebuilt_witness_hashes:hashes};
 return{staged,parent,previous};
}
test('source rebuild must match both complete previous membership and new sibling set',()=>{
 const {staged,parent,previous}=fixture(),before=stableJson(staged.raw_payload),result=verifyExplicitParent(staged,parent,previous);
 assert.equal(result.byHash.size,parent.repaired_candidate_hashes.length);assert.equal(stableJson(staged.raw_payload),before);
 for(const field of ['previous_actual_candidate_hashes','repaired_candidate_hashes','rebuilt_witness_hashes'])assert.throws(()=>verifyExplicitParent(staged,{...parent,[field]:[]},previous));
 assert.throws(()=>verifyExplicitParent(staged,{...parent,previous_active_parser_version:'V5'},previous));
 assert.throws(()=>verifyExplicitParent(staged,{...parent,source_hash:'0'.repeat(64)},previous));
});
test('canary and incomplete correction coverage cannot authorize full publication',()=>{
 assert.throws(()=>verifyExplicitCoverage({status:'COMPLETE',admission_authority:false,binding:{contract:'WF_V7_ACTUAL_LATEST_WHOLE_PARENT_CORRECTION_V1',canary:true}}, {},{}));
 assert.throws(()=>verifyExplicitCoverage({status:'COMPLETE',admission_authority:false,binding:{contract:'WF_V7_ACTUAL_LATEST_WHOLE_PARENT_CORRECTION_V1',canary:false,limit_parts:6112},processed_parts:[]},
  {status:'COMPLETE',counts:{parents:1527898}},{parent_rows:1527898,parts:Array(6112).fill({})}));
});
