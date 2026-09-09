'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifySemanticReview}=require('../expanded-reviewed-admissions-v5.cjs');
const a='a'.repeat(64),b='b'.repeat(64);
const reviewed=()=>({status:'PASS_ROOT_COMPLETE_V5_SOURCE_CORRECTION_AND_SEMANTIC_REVIEW',reviewer:'root',correction_manifest:{sha256:a},parser_sha256:b,all_changed_parents_accounted:true,final_stratified_semantic_qa_passed:true});
test('completed semantic review accurately names root or the prior independent reviewer',()=>{verifySemanticReview(reviewed(),a,b);verifySemanticReview({...reviewed(),status:'PASS_INDEPENDENT_COMPLETE_V5_SOURCE_CORRECTION_AND_SEMANTIC_REVIEW',reviewer:'independent'},a,b);});
test('structural-only, missing QA, wrong reviewer or stale inputs cannot authorize admission',()=>{for(const mutate of [r=>r.status='PASS_ROOT_COMPLETE_V5_STRUCTURAL_REVIEW_PENDING_FINAL_SEMANTIC_ADMISSION',r=>r.reviewer='unknown',r=>r.final_stratified_semantic_qa_passed=false,r=>r.all_changed_parents_accounted=false,r=>r.parser_sha256=a,r=>r.correction_manifest.sha256=b]){const r=reviewed();mutate(r);assert.throws(()=>verifySemanticReview(r,a,b));}});
