'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('node:path').resolve(__dirname,'../../..');
const M=require(R+'/shared/catalog-model-display-v2.cjs');
const registry=require(R+'/shared/exact-catalog-models.json');
test('actual exact Rolex reference replaces a foreign model claim without touching source',()=>{
 const source={brand:'Rolex',reference:'126610LN',model:'Serpenti',raw_message_text:'Original untouched message',original_price_currency:'HKD',image_url:'https://example.invalid/original.jpg'};
 const before=JSON.stringify(source),out=M.withCatalogModelDisplay(source);
 assert.equal(out.model,registry.models.rolex['126610LN'].model);assert.equal(out.source_model,'Serpenti');
 assert.equal(out.model_source,'CATALOG_EXACT_BRAND_REFERENCE');assert.equal(out.model_review_reason,'SOURCE_MODEL_DIFFERS_FROM_EXACT_CATALOG_MODEL');
 assert.equal(JSON.stringify(source),before);for(const key of ['brand','reference','raw_message_text','original_price_currency','image_url'])assert.equal(out[key],source[key]);
});
test('unknown reference never borrows a foreign manufacturer model',()=>{
 const out=M.resolveCatalogModelDisplay({brand:'Rolex',reference:'unknown',model:'Serpenti'});
 assert.equal(out.model,null);assert.equal(out.review_reason,'MODEL_CLAIM_NOT_VALIDATED_FOR_BRAND');
});
test('catalog-supported source model stays a claim without exact reference proof',()=>{
 const out=M.resolveCatalogModelDisplay({brand:'Rolex',reference:'unknown',model:'Submariner'});
 assert.equal(out.model,'Submariner');assert.equal(out.source,'SOURCE_MODEL_WITH_CATALOG_BRAND_NAME');assert.equal(out.exact,null);
});
test('reference punctuation and partial references are never repaired',()=>{
 for(const reference of ['126610','126610-LN','126610LN-extra']) {
  const out=M.resolveCatalogModelDisplay({brand:'Rolex',reference,model:null});
  assert.equal(out.exact,null);assert.equal(out.model,null);
 }
});
test('every actual unique catalog pair resolves consistently for missing or conflicting claims',()=>{
 let n=0;for(const [brand,refs] of Object.entries(registry.models))for(const [reference,value] of Object.entries(refs)){
  for(const model of [null,'unvalidated wrong model'])assert.equal(M.resolveCatalogModelDisplay({brand,reference,model}).model,value.model);
  n++;
 }
 assert.equal(n,registry.supported_pairs);
});
test('missing optional model and unavailable catalog remain null without invented facts',()=>{
 const out=M.withCatalogModelDisplay({brand:'Unknown maker',reference:'ABC',model:null});
 assert.equal(out.model,null);assert.equal(out.model_review_reason,null);assert.equal(out.model_source,null);
});
