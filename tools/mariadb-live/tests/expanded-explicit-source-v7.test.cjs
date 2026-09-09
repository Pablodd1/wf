'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../expanded-evidence-candidates-v7-explicit-source.cjs'),V6=require('../expanded-evidence-candidates-v6-r2.cjs');
const {stableJson,sha256}=require('../lossless-payload-sanitizer.cjs');
function staged(title,extra={}){const raw={id:'synthetic-explicit-v7',title,type:'sale',status:'ended',...extra};return {source_id:raw.id,source_hash:sha256(stableJson(raw)),source_system:'TEST',source_database:'TEST',source_table:'TEST',raw_payload:raw,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};}
function parse(title,extra){const s=staged(title,extra),before=stableJson(s.raw_payload),r=P.buildExpandedCandidates(s);assert.equal(stableJson(s.raw_payload),before);for(const e of r.candidates)P.verifyExpandedCandidate(s,e);return r.candidates.map(r=>r.candidate);}
test('explicit currency-adjacent k and m retain literal text and exact scale evidence',()=>{
 for(const [token,expected] of [['23.1kusd','23100'],['875kusd','875000'],['1.065M HKD','1065000'],['1.0\u200c65M \u200dHKD','1065000']]){
  const [c]=parse('Vacheron Constantin 4500V '+token);assert.equal(c.fields.original_price_amount,expected);assert.equal(c.fields.original_price_text,token);assert.ok(c.evidence.price_numeric.scale_token);assert.equal(c.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');
 }
});
test('emoji digits and a later own ask override an earlier MSRP role without creating currency',()=>{
 const [c]=parse('IWC Portuguese Ref# IW371447 MSRP 7️⃣8️⃣5️⃣0️⃣ Comes watch only Yours for 4️⃣k shipped');
 assert.equal(c.fields.reference,'IW371447');assert.equal(c.fields.original_price_amount,'4000');assert.equal(c.fields.original_price_currency,null);assert.equal(c.fields.original_price_text,'4️⃣k');assert.equal(c.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');
 for(const [token,price] of [['1️⃣5️⃣,6️⃣0️⃣0️⃣','15600'],['2️⃣2️⃣5️⃣0️⃣0️⃣','22500']]){const [d]=parse('Rolex 126613LN Price: '+token);assert.equal(d.fields.original_price_amount,price);assert.equal(d.fields.original_price_currency,null);assert.equal(d.fields.original_price_text,token);}
});
test('nearest explicit retail label stays non-asking even after an earlier ask label',()=>{
 const facts=P.prices('Yours for 4k MSRP 7850');assert.equal(facts[0].role,'EXPLICIT_ASK');
 const reverse=P.prices('Asking details retail price USD 7850');assert.ok(reverse.length>0);assert.ok(reverse.every(p=>p.role==='NON_ASK'));
});
test('SKU remains source text and cannot split or become the watch reference',()=>{
 const [c,...rest]=parse('Rolex 68274\nSKU: 15772\nEUR 6000');assert.equal(rest.length,0);assert.equal(c.fields.reference,'68274');assert.equal(c.fields.brand,'Rolex');assert.equal(c.fields.original_price_amount,'6000');assert.equal(c.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');assert.ok(c.source_context_text.includes('SKU: 15772'));
 const [other]=parse('Rolex 68275 EUR 6000');assert.notEqual(other.decision.trading_floor,'TF_SUPPORTED_CANDIDATE','Exact catalog supplement must not admit adjacent unvalidated references');
});
test('a spaced Richard Mille suffix is preserved as a complete explicit reference',()=>{
 const [c]=parse('Richard Mille\nRM07 -01 NTPT\nHKD 1450000');assert.equal(c.fields.reference,'RM07-01');assert.equal(c.evidence.reference[0].quote,'RM07 -01');
});
test('condition header containing a manufacturer closes prior scope and does not cross brands',()=>{
 const rows=parse('*BRAND NEW：*\nRolex 126334 HKD100K\n*USED Rolex：*\n126710BLRO HKD158K\n*AP：*\nAP 26120ST HKD200K');
 assert.deepEqual(rows.map(c=>c.fields.condition),['New','Used',null]);assert.equal(rows[2].fields.brand,'Audemars Piguet');
});
test('case and back offers are held as parts while whole watch back-in-stock remains valid',()=>{
 const rows=parse('Rolex mid 16753 case\n16750 back\n$2500');assert.equal(rows.length,2);assert.ok(rows.every(c=>c.fields.category==='ACCESSORY'&&c.decision.reasons.includes('NONWATCH_PARTS_OFFER')));
 const [c]=parse('Rolex 126334 back in stock HKD100K');assert.equal(c.fields.category,'WATCH');assert.ok(!c.decision.reasons.includes('NONWATCH_PARTS_OFFER'));
 const [whole]=parse('Rolex 126334 with sapphire caseback HKD100K');assert.equal(whole.fields.category,'WATCH');assert.ok(!whole.decision.reasons.includes('NONWATCH_PARTS_OFFER'));
});
test('own HOLD overrides open and its sibling remains open; historical parent stays historical',()=>{
 const rows=parse('Rolex\n126334 HKD108K (HOLD)\n126710BLRO HKD158K',{status:'open',is_bundle:1});assert.deepEqual(rows.map(c=>c.fields.source_status),['hold','open']);assert.equal(rows[0].evidence.source_status[0].quote,'HOLD');
 assert.equal(parse('Rolex 126334 HKD108K (HOLD)')[0].fields.source_status,'ended');
 for(const c of rows)assert.ok(Object.values(c.images).every(v=>v===null||Array.isArray(v)&&v.length===0));
 for(const wording of ['not sold','can hold','previously sold']){const [c]=parse('Rolex 126334 HKD100K '+wording,{status:'open'});assert.equal(c.fields.source_status,'open');assert.ok(c.decision.reasons.includes('OWN_AVAILABILITY_CONTEXT_REQUIRES_REVIEW'));}
});
test('sold customer orders remain buy requests and actual sold-offer conflicts require review',()=>{
 assert.ok(!parse('WTB SOLD ORDER Rolex 126334')[0].decision.reasons.includes('BUY_INTENT_VERSUS_SOLD_OFFER_REVIEW'));
 assert.ok(parse('WTB Rolex 126334 USD100K (sold)')[0].decision.reasons.includes('BUY_INTENT_VERSUS_SOLD_OFFER_REVIEW'));
});
test('unscaled amounts retain their literal magnitude for final review',()=>{
 const [c]=parse('Rolex 336934 EUR18,5');assert.equal(c.fields.original_price_amount,'18.5');assert.equal(c.evidence.price_numeric.scale_token,null);
});
test('ordinary V6 inventory evidence and brand retention remain unchanged',()=>{
 const s=staged('Tudor\nWTB\nM79030B-0001\nReady in HK stock\nBrand New\nM79360N-0012 N2 36.5K',{type:'search'});
 const strip=e=>{const c=structuredClone(e.candidate);delete c.parser_version;delete c.dependency_hashes;return c;};
 assert.deepEqual(P.buildExpandedCandidates(s).candidates.map(strip),V6.buildExpandedCandidates(s).candidates.map(strip));
});
