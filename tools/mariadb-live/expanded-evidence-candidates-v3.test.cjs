'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {stableJson}=require('./lossless-payload-sanitizer.cjs');
const v1=require('./expanded-evidence-candidates.cjs'),v2=require('./expanded-evidence-candidates-v2.cjs'),v3=require('./expanded-evidence-candidates-v3.cjs');
const policy=require('./expanded-source-scope-policy-v3.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function staged(title,more={}){const raw={id:'00000000-0000-4000-8000-000000000003',title,description:null,comments:null,brand:null,reference:null,model:null,type:null,is_bundle:0,...more};return{source_id:raw.id,source_hash:sha(stableJson(raw)),source_system:'fixture',source_database:'fixture',source_table:'auctions',raw_payload:raw,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};}
function build(title,more){const s=staged(title,more),before=stableJson(s),r=v3.buildExpandedCandidates(s);assert.equal(stableJson(s),before);for(const c of r.candidates)assert.equal(v3.verifyExpandedCandidate(s,c),true);return r;}
test('actual two-watch source shape splits full suffix token without creating catalog proof',()=>{
 const text='Rolex\n336238 black 323000 hkd 2025-9 🏷️\n128348rbr-0069 ombré green Roman diamond bracelet 880000 hkd 2025-11 🏷️';
 const old=v2.buildExpandedCandidates(staged(text,{type:'sale'}));assert.equal(old.candidates.length,1);assert.equal(old.candidates[0].candidate.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');
 assert.equal(v3.inspectLegacyCandidateScope(old.candidates[0].candidate)[0].reason,'FULL_HYPHENATED_REFERENCE_NOT_DELIMITED');
 const r=build(text,{type:'sale',front_image:'parent-original.jpg'});assert.deepEqual(r.candidates.map(c=>c.candidate.fields.reference),['336238','128348RBR-0069']);
 const [a,b]=r.candidates.map(c=>c.candidate);assert.equal(a.fields.original_price_amount,'323000');assert.equal(a.fields.original_price_currency,'HKD');assert.equal(a.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');
 assert.equal(b.fields.original_price_amount,'880000');assert.equal(b.decision.trading_floor,'REVIEW');assert.ok(b.decision.reasons.includes('REFERENCE_FORMAT_UNVERIFIED'));assert.equal(b.evidence.reference[0].quote,'128348rbr-0069');assert.equal(b.evidence.reference[0].role,'UNVERIFIED_REFERENCE_CLAIM');
 for(const c of [a,b]){assert.equal(c.kind,'CHILD');assert.equal(c.images.image_url,null);assert.deepEqual(c.images.image_urls,[]);assert.equal(c.images.source_image_keys,undefined);}
});
test('hyphenated watch-shaped claims do not include dates, money ranges or stock labels',()=>{
 for(const t of ['2026-0910','9500-10000','12000-15000','26585CM','39mm','HKD128348-0069'])assert.equal(policy.extendedReferenceClaim(t),false,t);
 for(const t of ['128348RBR-0069','126234-0015','116500LN-0001'])assert.equal(policy.extendedReferenceClaim(t),true,t);
 const r=build('WTS Rolex 116500LN asking USD 25000\nStock:128348rbr-0069');assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].candidate.fields.reference,'116500LN');
});
test('currency request header does not override source sale intent or turn ask into budget',()=>{
 const t='Looking for RmB，求人民幣\nAP\n26420cE green n5 425k';
 const old=v1.buildExpandedCandidates(staged(t,{type:'sale'})).candidates[0].candidate;assert.equal(old.fields.intent,'WTB');assert.equal(old.intent_evidence_tier,'EXPLICIT_SECTION');
 assert.equal(v3.inspectLegacyCandidateScope(old)[0].reason,'NONWATCH_CURRENCY_EXCHANGE_SECTION_INTENT');
 const r=build(t,{type:'sale'}),c=r.candidates[0].candidate;assert.equal(c.fields.intent,'WTS');assert.equal(c.intent_evidence_tier,'NONCONFLICTING_SOURCE_TYPE');assert.equal(c.fields.original_price_role,'WTS_ASK');assert.equal(c.fields.original_price_currency,null);assert.ok(r.residuals.some(x=>x.reason==='NONWATCH_CURRENCY_EXCHANGE_INTENT_LINE'));assert.ok(!c.context_spans.some(s=>s.role==='SECTION_INTENT'));
});
test('currency request leaves source search as truthful fallback and unknown intent held',()=>{
 for(const type of ['search',null]){const r=build('Looking for RmB，求人民幣\nAP\n26420cE green n5 425k',{type});const c=r.candidates[0].candidate;assert.equal(c.fields.intent,type?'WTB':null);assert.equal(c.intent_evidence_tier,type?'NONCONFLICTING_SOURCE_TYPE':null);if(!type)assert.ok(c.decision.reasons.includes('INTENT_NOT_ESTABLISHED'));}
});
test('decorative emoji and Unicode formatting do not turn currency demand into watch intent',()=>{
 const s=staged('💱 𝗟𝗢𝗢𝗞𝗜𝗡𝗚 𝗙𝗢𝗥 RmB，求人民幣\nAP\n26420cE green n5 425k',{type:'sale'}),old=v1.buildExpandedCandidates(s).candidates[0].candidate,c=v3.buildExpandedCandidates(s).candidates[0].candidate;
 assert.equal(old.fields.intent,'WTB');assert.equal(c.fields.intent,'WTS');assert.ok(v3.inspectLegacyCandidateScope(old).some(x=>x.reason==='NONWATCH_CURRENCY_EXCHANGE_SECTION_INTENT'));
});
test('foreign currency line after a watch stays outside that child and preserves prior watch header',()=>{
 const r=build('WTS\nRolex\n116500LN asking USD 25000\nLooking for RMB\n126610LN asking USD 11000',{type:'search'});
 assert.equal(r.candidates.length,2);for(const x of r.candidates){assert.equal(x.candidate.fields.intent,'WTS');assert.ok(!x.candidate.source_context_text.includes('Looking'));assert.ok(x.candidate.decision.warnings.includes('SOURCE_TYPE_CONFLICT_OVERRIDDEN_BY_EXPLICIT_MESSAGE'));}
});
test('an exchange request with an amount appended to a V1 watch block is also detected',()=>{
 const t='WTS\nRolex 116500LN asking USD 25000\nLooking for RMB 100000',s=staged(t),old=v1.buildExpandedCandidates(s).candidates[0].candidate;
 assert.equal(old.fields.intent,'WTB');assert.ok(v3.inspectLegacyCandidateScope(old).some(x=>x.reason==='NONWATCH_CURRENCY_EXCHANGE_MESSAGE_INTENT'));
 const c=build(t).candidates[0].candidate;assert.equal(c.fields.intent,'WTS');assert.equal(c.fields.original_price_amount,'25000');assert.equal(c.fields.original_price_currency,'USD');assert.ok(!c.source_context_text.includes('Looking'));
});
test('legitimate watch headers, supported maker names and explicit child override survive',()=>{
 for(const h of ['WTB','Want to buy','Looking for Rolex watches','Wanted watches','Looking for RM','WTS HKD']){
  const r=build(`${h}\n${h.includes('RM')?'Richard Mille RM35-02':'Rolex 116500LN'}\nasking USD 25000`),c=r.candidates[0].candidate;assert.equal(c.intent_evidence_tier,'EXPLICIT_SECTION',h);assert.equal(c.fields.intent,h.startsWith('WTS')?'WTS':'WTB',h);
 }
 const c=build('WTB\nRolex\nWTS 116500LN asking USD 25000').candidates[0].candidate;assert.equal(c.fields.intent,'WTS');assert.ok(c.decision.warnings.includes('SECTION_INTENT_OVERRIDDEN_BY_EXPLICIT_CHILD_MESSAGE'));
});
test('an unrelated request object cannot become a wanted-watch section',()=>{
 for(const h of ['Looking for a buyer','Looking for a job','Seeking a shipping agent','Seeking long-term cooperative suppliers']){const r=build(`${h}\nRolex 116500LN`,{type:null}),c=r.candidates[0].candidate;assert.equal(c.fields.intent,null);assert.ok(r.residuals.some(x=>x.reason==='NONWATCH_BUSINESS_OR_SERVICE_REQUEST'));}
});
test('observed genuine modifiers and model-family headings retain their previous intent',()=>{
 for(const h of ['LOOKING FOR//NEED TO BUY','Looking to buy this watch!','The below are for sale','Looking for new or used(new or old model)','Looking for new and used','WTB Cartier Santos','Looking for Patek Nautilus','WTB New or Mint','WTS SPRITE Oyster','WTB SOLD ORDER']){
  const s=staged(`${h}\nRolex 116500LN`,{type:null}),old=v1.buildExpandedCandidates(s).candidates[0].candidate,c=v3.buildExpandedCandidates(s).candidates[0].candidate;assert.equal(c.fields.intent,old.fields.intent,h);assert.equal(c.intent_evidence_tier,old.intent_evidence_tier,h);assert.equal(v3.inspectLegacyCandidateScope(old).length,0,h);
 }
});
test('accessory-only request headings hold following reference blocks despite source fallback',()=>{
 for(const h of ['looking for English booklet Card Holder','Looking to buy Rolex new style/old style box','LOOKING FOR SPORT BOOKLETS ENGLISH','⚠️LOOKING FOR RM NEW BOX','Looking for Bracelet','Looking for Rolex M BOX (New style)','Looking for Rolex m size boxes','Looking for new black strap','Looking for Rolex Large green box']){
  const r=build(`${h}\nRolex 116500LN`,{type:'search'}),c=r.candidates[0].candidate;assert.ok(c.decision.reasons.includes('NONWATCH_ACCESSORY_SECTION'),h);assert.equal(c.decision.trading_floor,'REVIEW',h);assert.ok(c.context_spans.some(x=>x.role==='NONWATCH_ACCESSORY_SECTION'),h);
 }
 const r=build('Looking for Bracelet\nRolex 116500LN\nWTS watches\nRolex 126610LN asking USD 11000',{type:'search'});assert.equal(r.candidates[0].candidate.decision.trading_floor,'REVIEW');assert.equal(r.candidates[1].candidate.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');
});
test('watch configuration wording does not become an accessory-only scope',()=>{
 for(const h of ['WTB PEPSI OYSTER AND JUBILEE','WTB brand new in the box','Looking for Sky Dweller Jubilee bracelet']){const r=build(`${h}\nRolex 116500LN`,{type:'search'}),c=r.candidates[0].candidate;assert.ok(!c.decision.reasons.some(x=>x.startsWith('NONWATCH_ACCESSORY')),h);}
 const c=build('Looking for 2X LINKS W2SA0033 small size santos',{brand:'Cartier',type:'search'}).candidates[0]?.candidate;if(c){assert.equal(c.decision.trading_floor,'REVIEW');assert.ok(c.decision.reasons.includes('NONWATCH_ACCESSORY_REQUEST'));}
});
test('literal FS full-stickers definition remains source text without sale-intent inference',()=>{
 for(const sep of ['\n','\u2028','_x000D_']){const s=staged(`FS=full stickers${sep}Rolex 116500LN`),old=v1.buildExpandedCandidates(s).candidates[0].candidate,c=v3.buildExpandedCandidates(s).candidates[0].candidate;assert.equal(old.fields.intent,'WTS');assert.equal(c.fields.intent,null);assert.ok(v3.inspectLegacyCandidateScope(old).some(x=>x.reason==='FULL_STICKERS_NOT_SALE_INTENT'));}
 const c=build('FS Rolex 116500LN full stickers asking USD 25000').candidates[0].candidate;assert.equal(c.fields.intent,'WTS');
});
test('observed compound sticker definitions do not imply sale while explicit FS offers survive',()=>{
 for(const h of ['🏷= wht tag , fs= full stickers.','🏷= wht tag , fs= full stickers with barcode','fs nobcode = full stickers no barcode']){const s=staged(`${h}\nRolex 116500LN`),old=v1.buildExpandedCandidates(s).candidates[0].candidate,c=v3.buildExpandedCandidates(s).candidates[0].candidate;assert.equal(old.fields.intent,'WTS');assert.equal(c.fields.intent,null,h);assert.ok(v3.inspectLegacyCandidateScope(old).some(x=>x.reason==='FULL_STICKERS_NOT_SALE_INTENT'));}
 for(const line of ['FS Rolex 116500LN full stickers asking USD 25000','FS Rolex 116500LN asking USD 25000; fs= full stickers'])assert.equal(build(line).candidates[0].candidate.fields.intent,'WTS');
 const c=build('Rolex 116500LN fs=full stickers').candidates[0].candidate;assert.equal(c.fields.intent,null);assert.ok(c.source_context_text.includes('fs=full stickers'));
});
test('same-line competing full references stay held instead of arbitrarily selecting one',()=>{
 const r=build('WTS Rolex 336238 or 128348rbr-0069 asking HKD 323000');assert.equal(r.candidates.length,1);const c=r.candidates[0].candidate;assert.equal(c.fields.reference,null);assert.equal(c.decision.trading_floor,'REVIEW');assert.ok(c.decision.reasons.includes('MULTIPLE_REFERENCES_IN_ONE_OFFER_BLOCK'));
});
test('detector matches splitter when prior-line trailing currency resembles next-line price prefix',()=>{
 const s=staged('Rolex\n336238 black 323000 hkd\n128348rbr-0069 green 880000 hkd',{type:'sale'}),old=v1.buildExpandedCandidates(s).candidates[0].candidate;
 assert.ok(v3.inspectLegacyCandidateScope(old).some(x=>x.reason==='FULL_HYPHENATED_REFERENCE_NOT_DELIMITED'));
 assert.equal(v3.buildExpandedCandidates(s).candidates.length,2);
});
test('V2 price/dimension protections and original single image keys remain intact',()=>{
 const r=build('WTS Rolex 116500LN\nRef:39mm\n$29200',{front_image:'original-key'}),c=r.candidates[0].candidate;assert.equal(c.kind,'SINGLE');assert.equal(c.fields.reference,'116500LN');assert.equal(c.fields.original_price_amount,'29200');assert.equal(c.fields.original_price_currency,null);assert.deepEqual(c.images.source_image_keys,['original-key']);
});
test('original codepoint quotes and repeated parent-block lineage remain exact',()=>{
 const s=staged('😀 Rolex\n336238 black 323000 hkd\n１２８３４８rbr-００６９ green 880000 hkd',{type:'sale'}),r=v3.buildExpandedCandidates(s);assert.equal(r.candidates.length,2);const c=r.candidates[1].candidate,e=c.evidence.reference[0];assert.equal(Array.from(s.raw_payload.title).slice(e.start,e.end).join(''),e.quote);assert.equal(sha(e.quote),e.quote_sha256);assert.equal(e.quote,'１２８３４８rbr-００６９');assert.equal(c.fields.reference,'128348RBR-0069');
});
test('older canonical candidates cannot be authorized by the V3 exact rebuild verifier',()=>{
 const s=staged('WTS Rolex 116500LN asking USD 25000');for(const old of [v1,v2])assert.throws(()=>v3.verifyExpandedCandidate(s,old.buildExpandedCandidates(s).candidates[0]),/PROOF_MISMATCH/);
});
