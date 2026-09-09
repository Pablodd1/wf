'use strict';
const p=require('./expanded-evidence-candidates-v5.cjs');
const policy=require('./expanded-offer-boundary-policy-v5.cjs');
const crypto=require('node:crypto'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const key=x=>p.parsingView(String(x||'')).text.replace(/\s/g,'').toUpperCase();
// This is a deterministic repair-candidate census, not an admission decision.
// Every flagged parent is later rebuilt in full and compared against its exact
// active sibling set. Unchanged rebuilds are explicitly excluded from repairs.
function inspectLegacyCandidateV5(c) {
  const view=p.parsingView(c.source_context_text),text=view.text,issues=[];
  // V1 sometimes kept only the maker word from a structured availability
  // header. The full header cannot be reconstructed from that clipped proof.
  // Recheck every source-search fallback parent against its immutable source;
  // explicit child/section requests are unaffected by this diagnostic route.
  if(c.fields.intent==='WTB'&&c.intent_evidence_tier==='NONCONFLICTING_SOURCE_TYPE')for(const s of c.evidence.intent||[])issues.push({...s,reason:'SOURCE_SEARCH_FALLBACK_AVAILABILITY_PROOF_REBUILD_CHECK'});
  function add(start,end,reason) {
    const a=view.starts[start],b=view.ends[end-1];if(a===undefined||b===undefined)return;
    for(const parent of c.source_spans){const quote=view.points.slice(a,b).join('');issues.push({field:parent.field,field_sha256:parent.field_sha256,start:parent.start+a,end:parent.start+b,offset_unit:'UNICODE_CODEPOINT',end_exclusive:true,quote,quote_sha256:sha(quote),reason});}
  }
  for(const s of policy.puritySpans(text))add(s.start,s.end,s.reason);
  for(const s of policy.taggedIdentifierSpans(text))add(s.start,s.end,s.reason);
  for(const s of policy.supplementalPriceClaims(text))add(s.start,s.end,s.reason);
  for(const s of policy.urlSpans(text))if((c.evidence.reference||[]).some(r=>key(s.quote).includes(key(r.quote))))add(s.start,s.end,'EXPLICIT_URL_REFERENCE_ROLE_REBUILD_CHECK');
  for(const line of p.sourceLines(text)) {
    if(policy.affirmativeAvailabilityHeader(line.text))add(line.start,line.end,'AFFIRMATIVE_AVAILABILITY_SCOPE_REBUILD_CHECK');
    if(/^Title\s*:/i.test(line.text))add(line.start,line.end,'LABELLED_TITLE_RESTATEMENT_REBUILD_CHECK');
    if(line.start>0&&policy.isDecoratedCondition(line.text))add(line.start,line.end,'EMBEDDED_SECTION_CONDITION_BOUNDARY_REBUILD_CHECK');
    if(line.start>0&&/^[^\p{L}\p{N}]*(?:pp|ap|rm|vc|fpj)[^\p{L}\p{N}]*$/u.test(line.text))add(line.start,line.end,'LOWERCASE_MAKER_SECTION_BOUNDARY_REBUILD_CHECK');
  }
  // The added structural boundary families are full tokens: slash/dash maker
  // references, and source-prefixed identifiers (Q..., W..., IW..., G0A...).
  // Existing source reference claims are witnesses, not new boundaries.
  const tokens=/(?:[A-Z0-9]+(?:[./-][A-Z0-9]+)+|\b(?:W[A-Z0-9]{7}|Q\d{7}|IW\d{6}|G0A\d{5}|SB[A-Z]{2}\d{3}|(?:CAL|WW|CBL|CAZ|WAZ|CAR|CBK)[A-Z0-9.]{4,}|[A-Z]{2}\d{4}[A-Z0-9]{0,8})\b)/gi;
  const beforeRefs=new Set((c.evidence.reference||[]).map(s=>key(s.quote)));
  const potential=[...text.matchAll(tokens)].filter(m=>!beforeRefs.has(key(m[0])));
  if(potential.length) {
    const claims=p.referenceClaims(text,c.fields.brand,c.fields.reference,p.prices(text));
    for(const r of claims)if(!beforeRefs.has(r.reference)&&potential.some(m=>r.start<m.index+m[0].length&&r.end>m.index))add(r.start,r.end,'ADDITIONAL_COMPLETE_REFERENCE_BOUNDARY_REBUILD_CHECK');
  }
  const crossed=/(?:HKD|USD|USDT|EUR|GBP|AED|CHF|SGD|JPY|CNY|AUD|CAD|MYR|SAR)[ \t]*[\r\n\u2028\u2029]+[ \t]*\d[\d.,]*(?:[-–]\d+)?/gi;
  for(const m of text.matchAll(crossed))add(m.index,m.index+m[0].length,'CROSS_LINE_CURRENCY_NUMBER_ROLE_REBUILD_CHECK');
  for(const s of c.evidence.price||[])if(typeof s.quote==='string'&&/[\r\n\u2028\u2029]/.test(s.quote))issues.push({...s,reason:'MULTILINE_PRICE_PROOF_REBUILD_CHECK'});
  const unique=new Map(issues.map(s=>[[s.field,s.start,s.end,s.reason].join(':'),s]));return[...unique.values()];
}
function inspectLegacyParentV5(parent) {
  const issues=[];
  for(const residual of parent.residuals||[])for(const s of residual.evidence||[]){
    const value=p.parsingView(s.quote||'').text;
    if(parent.source_type==='search'&&policy.affirmativeAvailabilityHeader(value))issues.push({...s,reason:'SOURCE_SEARCH_AVAILABILITY_CONFLICT_REBUILD_CHECK'});
    if(/^[^\p{L}\p{N}]*(?:pp|ap|rm|vc|fpj)[^\p{L}\p{N}]*$/u.test(value))issues.push({...s,reason:'UNASSIGNED_LITERAL_MAKER_HEADER_REBUILD_CHECK'});
  }
  return issues;
}
module.exports={inspectLegacyCandidateV5,inspectLegacyParentV5,DIAGNOSTIC_ONLY:true};
