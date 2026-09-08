'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publishedBrand}=require('../api/_lib/published-brand-aliases.cjs');
const shared=require('../shared/listing-display-contract.cjs');
const canary=require('../api/_lib/canary-display-contract.cjs');

test('established family and spelling aliases use the same manufacturer label',()=>{
 assert.equal(publishedBrand('Datejust'),'Rolex');
 assert.equal(publishedBrand('DAY-DATE'),'Rolex');
 assert.equal(publishedBrand(' Gmt-master Ii '),'Rolex');
 assert.equal(publishedBrand('A. Lange & Sohne'),'A. Lange & Söhne');
 assert.equal(publishedBrand('F.P.Journe'),'F.P. Journe');
 assert.equal(publishedBrand('Bulgari'),'Bvlgari');
 assert.equal(publishedBrand('Moser & Cie.'),'H. Moser & Cie');
});

test('unmapped source labels and unknown values are not assigned a manufacturer',()=>{
 for(const value of ['Unknown Source Brand','126334','American 1921','Source family'])assert.equal(publishedBrand(value),value);
 assert.equal(publishedBrand(null),null);
 assert.equal(publishedBrand(undefined),null);
});

test('canary projection changes only the verified brand label and never the frozen source',()=>{
 const input=Object.freeze({listing_id:'SYNTHETIC-BRAND-ALIAS',source_id:'synthetic-alias',source_hash:'a1b2c3d4'.repeat(8),
  source_created_at:null,intent:'WTB',brand:'Datejust',model:null,reference:'126334',
  is_bundle:false,raw_message_text:'[SYNTHETIC FIXTURE] WTB Datejust126334 blue dial',
  original_price_currency:null,original_price_amount:null,price_usd:null,priced_rank:2,image_rank:2});
 const before=structuredClone(input),expected=shared.enforceListingDisplayContract(input);
 expected.brand='Rolex';
 assert.deepEqual(canary.enforceListingDisplayContract(input),expected);
 assert.deepEqual(input,before);
 assert.equal(shared.enforceListingDisplayContract(input).brand,'Datejust','Other legacy consumers keep their existing contract');
});
