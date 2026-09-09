'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../expanded-evidence-candidates-v6-r2.cjs'),V5=require('../expanded-evidence-candidates-v5.cjs');
const {stableJson,sha256}=require('../lossless-payload-sanitizer.cjs');
const {inventorySaleHeader}=require('../expanded-inventory-section-policy-v6.cjs');
function staged(title,type='search'){const raw={id:'synthetic-inventory-v6',title,type,is_bundle:1};return{source_id:raw.id,source_hash:sha256(stableJson(raw)),source_system:'TEST',source_database:'TEST',source_table:'TEST',raw_payload:raw,canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'};}
const parse=(text,type)=>P.buildExpandedCandidates(staged(text,type)).candidates.map(r=>r.candidate);
test('affirmative heading requires complete inventory assertion',()=>{
 for(const s of ['Ready stock','In stock','Stock list','Ready in HK stock','Ready in Hong Kong','🔥 Ready in Hong Kong stock 🔥'])assert.equal(inventorySaleHeader(s),true,s);
 for(const s of ['WTB ready stock','Looking for stock list','No stock','Not in stock','In stock?','Stock list wanted','Ready in HK stock required','Looking for Ready in HK stock','Ready in HK stock / WTB'])assert.equal(inventorySaleHeader(s),false,s);
});
test('inventory section closes a preceding request and establishes priced WTS without currency inference',()=>{
 const rows=parse('WTB\nRolex 124200 silver\nReady in HK stock\nTudor\nBrand New\nM79360N-0012 N2 36.5K\nM79360N-0012 N12 31.5K');
 assert.equal(rows.length,3);assert.equal(rows[0].fields.intent,'WTB');assert.ok(!rows[0].source_spans.some(s=>s.quote.includes('Ready in HK')));
 for(const [i,price]of [[1,'36500'],[2,'31500']]){const c=rows[i];assert.equal(c.fields.intent,'WTS');assert.equal(c.fields.original_price_amount,price);assert.equal(c.fields.original_price_currency,null);assert.equal(c.fields.original_price_role,'WTS_ASK');assert.equal(c.fields.condition,'New');assert.ok(c.evidence.intent.some(s=>s.quote==='Ready in HK stock'));assert.ok(Object.values(c.images).every(v=>v===null||Array.isArray(v)&&!v.length));}
});
test('explicit child and subsequent request heading override inventory locally',()=>{
 const rows=parse('Ready in HK stock\nRolex\n126610LN 100K\nWTB 124200\n126500LN 200K\nWTB\n126710BLRO');
 assert.deepEqual(rows.map(c=>c.fields.intent),['WTS','WTB','WTS','WTB']);
});
test('negative inventory and currency exchange create no sale section',()=>{
 const rows=parse('Looking for usdt pay hkd cash\nNot in stock\nRolex 124200');
 assert.equal(rows[0].fields.intent,'WTB');assert.equal(rows[0].fields.original_price_currency,null);
});
test('new section does not inherit a preceding condition',()=>{
 const rows=parse('Used\nWTB\nRolex 124200\nReady stock\nRolex 126610LN');
 assert.equal(rows[0].fields.condition,'Used');assert.equal(rows[1].fields.condition,null);
});
test('unchanged source retains every V5 operational and evidence field',()=>{
 const s=staged('WTS\nRolex 126610LN HKD 100K\nWTB\nRolex 124200');
 const strip=c=>{c=structuredClone(c);delete c.parser_version;delete c.dependency_hashes;return c;};
 assert.deepEqual(P.buildExpandedCandidates(s).candidates.map(r=>strip(r.candidate)),V5.buildExpandedCandidates(s).candidates.map(r=>strip(r.candidate)));
});

test('an availability heading preserves an earlier explicit manufacturer',()=>{
 const rows=parse('Tudor\nWTB\nM79030B-0001\nReady in HK stock\nBrand New\nM79360N-0012 N2 36.5K');
 const c=rows[1];assert.equal(c.fields.brand,'Tudor');assert.equal(c.fields.intent,'WTS');assert.equal(c.decision.trading_floor,'TF_SUPPORTED_CANDIDATE');assert.equal(c.fields.original_price_currency,null);assert.ok(c.evidence.brand.some(s=>s.quote==='Tudor'));
});
