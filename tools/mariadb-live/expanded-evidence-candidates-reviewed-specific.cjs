'use strict';
// Exact reviewed source corrections only. This is a separately named fourth
// policy; frozen V1/V2/V3 files and immutable source text are never changed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const baseFile=path.join(__dirname,'expanded-evidence-candidates-v3.cjs');
const policyFile=path.join(__dirname,'expanded-reviewed-source-policy-v4.json');
const policy=JSON.parse(fs.readFileSync(policyFile)),policies=new Map(policy.rows.map(r=>[r.source_id,r]));
assert.equal(policy.contract,'WF_EXACT_REVIEWED_SOURCE_CORRECTION_POLICY_V1');assert.equal(policies.size,42);assert.equal(policies.size,policy.rows.length);
const original=fs.readFileSync(baseFile,'utf8');assert.equal(sha(original),'f2b7da06ae91d93112d73b70350b316f07c818dd9bb46516a77fd44e9e7228ef','FROZEN_SOURCE_SCOPE_PARSER_CHANGED');
const recipe=[
 ["const PARSER_VERSION = 'expanded-evidence-v3-source-scope';","const PARSER_VERSION = 'expanded-evidence-v4-reviewed-specific';"],
 ["  ['source_scope_policy', path.resolve(__dirname, 'expanded-source-scope-policy-v3.cjs')],","  ['source_scope_policy', path.resolve(__dirname, 'expanded-source-scope-policy-v3.cjs')],\n  ['previous_scope_parser', __filename],\n  ['reviewed_source_policy', module.reviewedPolicyFile],\n  ['reviewed_source_adapter', module.reviewedAdapterFile],"],
 ['const refs = referenceClaims(line.text, bs.length === 1 ? bs[0] : context.brand?.value || metadataMaker, raw.reference, ps);','const refs = referenceClaims(line.text, bs.length === 1 ? bs[0] : context.brand?.value || metadataMaker, raw.reference, ps).filter(r => !module.reviewedExclude(staged, field, view, line.start + r.start, line.start + r.end));'],
 ['const refs = referenceClaims(text, tentativeMaker, raw.reference, priceFacts);','const refs = referenceClaims(text, tentativeMaker, raw.reference, priceFacts).filter(r => !module.reviewedExclude(staged, field, view, block.start + r.start, block.start + r.end));'],
 ['    const canonicalJson = stableJson(c);','    module.applyReviewedFields(staged, c, prices);\n    const canonicalJson = stableJson(c);'],
];
let code=original;for(const[from,to]of recipe){assert.equal(code.split(from).length,2,'EXACT_REVIEWED_ADAPTER_NEEDLE_CHANGED');code=code.replace(from,to);}
const contexts=new WeakMap();
function sourceProof(staged,s,role){const text=staged.raw_payload[s.field];assert.equal(typeof text,'string');assert.equal(sha(text),s.field_sha256);assert.equal(s.offset_unit,'UNICODE_CODEPOINT');assert.equal(s.end_exclusive,true);assert.ok(Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start);const points=Array.from(text);assert.ok(s.end<=points.length);const quote=points.slice(s.start,s.end).join('');assert.equal(sha(quote),s.quote_sha256);return{...s,quote,role};}
const mod=new Module(baseFile,module);mod.filename=baseFile;mod.paths=Module._nodeModulePaths(__dirname);mod.reviewedPolicyFile=policyFile;mod.reviewedAdapterFile=__filename;
mod.reviewedExclude=(staged,field,view,a,b)=>{const state=contexts.get(staged);assert.ok(state,'REVIEWED_BUILD_CONTEXT_REQUIRED');const start=view.starts[a],end=view.ends[b-1];const s=state.policy.excluded_reference_spans.find(s=>s.field===field&&s.start===start&&s.end===end);if(!s)return false;sourceProof(staged,s,'REVIEWED_NON_REFERENCE_SOURCE_ROLE');state.excluded.add(JSON.stringify(s));return true;};
mod.applyReviewedFields=(staged,c,prices)=>{const state=contexts.get(staged);assert.ok(state);for(let i=0;i<state.policy.field_repairs.length;i++){
 const repair=state.policy.field_repairs[i];if(c.fields.reference!==repair.reference)continue;assert.equal(c.fields.intent,repair.intent);assert.ok(!state.repairs.has(i),'REVIEWED_FIELD_TARGET_IS_NOT_UNIQUE');
 if(repair.kind==='SOURCE_YEAR'){assert.equal(c.fields.year,repair.expected_value);const proof=sourceProof(staged,repair.proof,'EXPLICIT_YEAR');assert.equal(proof.quote,String(repair.value));assert.ok(c.source_spans.some(s=>s.field===proof.field&&s.start<=proof.start&&s.end>=proof.end));c.fields.year=repair.value;c.evidence.year=[proof];}
 else if(repair.kind==='EXACT_LINE_PRICE_BEFORE_DELIVERY_RANGE'){
  assert.equal(c.fields.original_price_amount,repair.expected_amount);assert.equal(c.fields.original_price_currency,repair.expected_currency);assert.deepEqual(c.decision.price_reasons,repair.expected_price_reasons);const proof=sourceProof(staged,repair.proof,'UNLABELLED');assert.ok(!/[\r\n\u2028\u2029]/.test(proof.quote));assert.ok(c.source_spans.some(s=>s.field===proof.field&&s.start<=proof.start&&s.end>=proof.end));
  const parsed=prices(proof.quote);assert.equal(parsed.length,1);const p=parsed[0];assert.equal(p.start,0);assert.equal(p.end,proof.quote.length);assert.equal(p.review_reason,null);assert.equal(p.amount,repair.amount);assert.equal(p.currency,repair.currency);assert.equal(p.role,'UNLABELLED');
  Object.assign(c.fields,{original_price_amount:p.amount,original_price_currency:p.currency,original_price_text:proof.quote,original_price_role:'WTS_ASK'});assert.equal(c.fields.price_usd,null);assert.equal(c.fields.fx_rate,null);c.evidence.price=[proof];c.evidence.price_numeric=p.numeric_evidence;c.decision.price_reasons=[];c.decision.price_source='SOURCE_PRICE_SUPPORTED_REQUIRES_FX_AND_ADMISSION';
 }
 else if(repair.kind==='EXACT_PARENT_MANUFACTURER_CONTEXT'){
  assert.equal(c.kind,'SINGLE');assert.equal(c.fields.brand,repair.expected_brand);assert.deepEqual(c.decision.reasons,repair.expected_reasons);const proof=sourceProof(staged,repair.proof,'EXPLICIT_SOURCE_MANUFACTURER');assert.equal(proof.quote,repair.brand);assert.equal(repair.brand,'Chopard');assert.equal(repair.reference,'161946-5001');assert.equal(c.fields.model,null);assert.equal(c.fields.original_price_currency,null);assert.equal(c.fields.price_usd,null);
  c.fields.brand=repair.brand;c.evidence.brand=[proof];c.context_spans.push({...proof,role:'SECTION_MAKER'});c.decision.reasons=[];c.decision.trading_floor='TF_SUPPORTED_CANDIDATE';c.decision.warnings.push('REVIEWED_EXPLICIT_MANUFACTURER_OVERRIDES_CONTRADICTORY_METADATA');
 }
 else assert.fail('UNREVIEWED_FIELD_REPAIR_KIND');state.repairs.add(i);
 }
 for(const hold of state.policy.scope_holds){const proof=sourceProof(staged,hold.proof,'REVIEWED_UNRESOLVED_QUANTITY_SCOPE');c.evidence.reviewed_scope=[...(c.evidence.reviewed_scope||[]),proof];if(!c.decision.reasons.includes(hold.reason))c.decision.reasons.push(hold.reason);c.decision.trading_floor='REVIEW';}
};
mod._compile(code,baseFile);
function buildExpandedCandidates(staged){
 const p=policies.get(staged?.source_id);assert.ok(p,'SOURCE_NOT_IN_EXACT_REVIEWED_POLICY');assert.equal(staged.source_hash,p.source_hash,'EXACT_REVIEWED_SOURCE_HASH_CHANGED');assert.ok(!contexts.has(staged),'REENTRANT_REVIEWED_BUILD');const state={policy:p,excluded:new Set(),repairs:new Set()};contexts.set(staged,state);
 try{const result=mod.exports.buildExpandedCandidates(staged);assert.equal(state.excluded.size,p.excluded_reference_spans.length,'REVIEWED_EXCLUSION_NOT_EXACTLY_REPRODUCED');assert.equal(state.repairs.size,p.field_repairs.length,'REVIEWED_FIELD_REPAIR_TARGET_MISSING');return result;}finally{contexts.delete(staged);}
}
function verifyExpandedCandidate(staged,entry){const found=buildExpandedCandidates(staged).candidates.find(e=>e.candidate_hash===entry.candidate_hash);assert.ok(found&&found.canonical_json===entry.canonical_json,'EXACT_REVIEWED_CANDIDATE_REBUILD_CHANGED');assert.deepEqual(found.candidate,entry.candidate);return true;}
module.exports={CONTRACT:mod.exports.CONTRACT,PARSER_VERSION:mod.exports.PARSER_VERSION,DEPENDENCY_HASHES:mod.exports.DEPENDENCY_HASHES,buildExpandedCandidates,verifyExpandedCandidate,sourceProof,POLICY_SHA256:sha(fs.readFileSync(policyFile)),EXACT_RECIPE_SHA256:sha(JSON.stringify(recipe)),TRANSFORMED_EXECUTION_SHA256:sha(code)};
