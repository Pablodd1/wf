'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {stableJson}=require('../tools/mariadb-live/lossless-payload-sanitizer.cjs');
const {normalizeAuthoritativeRow}=require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');
function normalize(description,extra={}){
 const payload={id:'SYNTHETIC-CATEGORY',description,created_on:'2026-09-01T00:00:00Z',...extra};
 return normalizeAuthoritativeRow({source_system:'SYNTHETIC',source_database:'disposable',source_table:'auctions',
  source_id:payload.id,source_record_id:payload.id,raw_payload:payload,source_created_on:payload.created_on,
  source_hash:crypto.createHash('sha256').update(stableJson(payload)).digest('hex'),
  canonicalization_version:'v1-json-keys-sorted-compact',hash_algorithm:'sha256'});
}
test('watch metadata cannot publish bags, jewelry, watch accessories or unknown categories',()=>{
 for(const [description,extra] of [
  ['WTS Rolex handbag USD 12000',{brand:'Rolex',reference:'126610LN'}],
  ['WTS Cartier necklace USD 12000',{brand:'Cartier',reference:'WSSA0018'}],
  ['WTS strap Rolex 126610LN USD 200',{}],
  ['WTS mystery item USD 12000',{brand:'Mystery',reference:'UNKNOWN1',normalized_reference:'126610LN'}],
 ]){
  const p=normalize(description,extra);assert.equal(p.trading_floor_eligible,false);assert.equal(p.price_research_eligible,false);
  assert.ok(p.review_flags.includes('WATCH_CATEGORY_REQUIRES_REVIEW'));
 }
});
test('source-backed watches remain eligible, including cross-category brands with explicit watch evidence',()=>{
 for(const [description,extra] of [
  ['WTS Rolex 126610LN black dial new USD 12000',{}],
  ['WTB Cartier WSSA0018 blue dial',{brand:'Cartier',reference:'WSSA0018'}],
 ]) assert.equal(normalize(description,extra).trading_floor_eligible,true);
});
