'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildExactCatalogModelMap,lookupExactCatalogModel,withExactCatalogModel,referenceKey}=require('../shared/exact-catalog-model-map.cjs');
const registry=require('../shared/exact-catalog-models.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const row=(brand,reference,model,extra={})=>({brand,reference,model,model_claims:[model],source_files:['literal-catalog.csv'],...extra});
test('exact pair requires manufacturer and complete punctuation-preserving reference',()=>{
 assert.equal(lookupExactCatalogModel('5711/1A-010','Patek Philippe').model,'Nautilus');
 for(const ref of ['5711','5711/1A','57111A010','5711/1A-010-001','ref:5711/1A-010'])assert.equal(lookupExactCatalogModel(ref,'Patek Philippe'),null);
 assert.equal(lookupExactCatalogModel('5711/1A-010','Rolex'),null);assert.equal(lookupExactCatalogModel('5711/1A-010',null),null);
 assert.equal(referenceKey(' RM 65-01\t'),'RM65-01');
});
test('duplicate or conflicting exact catalog claims never silently overwrite',()=>{
 const built=buildExactCatalogModelMap([row('Maker','123-A','First'),row('maker','123-a','Second'),row('Other','123-A','Other model'),row('Maker','124','First',{model_claims:['First','Second']}),row('Maker','125','First',{source_files:[]})]);
 assert.equal(built.models.maker,undefined);assert.equal(built.models.other['123-A'].model,'Other model');
 assert.equal(built.rejected.filter(r=>r.reason==='AMBIGUOUS_EXACT_CATALOG_MODEL').length,2);
 assert.equal(lookupExactCatalogModel('123-A','Maker',{models:built.models}),null);
});
test('case-only catalog claims choose a deterministic existing spelling and preserve source files',()=>{
 const a=row('Maker','AB.12','daytona'),b=row('maker','ab.12','Daytona',{source_files:['another.csv']});
 assert.deepEqual(buildExactCatalogModelMap([a,b]),buildExactCatalogModelMap([b,a]));
 const match=buildExactCatalogModelMap([a,b]).models.maker['AB.12'];
 assert.equal(match.model,'Daytona');assert.deepEqual(match.source_files,['another.csv','literal-catalog.csv']);
});
test('display fallback adds provenance without changing source/model/price/image evidence',()=>{
 const input={brand:'Rolex',reference:'126610LN',model:null,price_usd:null,original_price_amount:7000,original_price_currency:null,dial_color:null,year:null,condition:null,source_hash:'a'.repeat(64),source_context_text:'Exact original quote',image_url:'https://source.invalid/exact.jpg'};
 const before=structuredClone(input),out=withExactCatalogModel(input);
 assert.deepEqual(input,before);assert.equal(out.model,'Submariner');assert.equal(out.source_model,null);
 assert.equal(out.model_source,'CATALOG_EXACT_BRAND_REFERENCE');assert.equal(out.model_catalog_sha256,registry.catalog_sha256);
 for(const[k,v]of Object.entries(input))if(k!=='model')assert.deepEqual(out[k],v);
 const explicit={...input,model:'Exact literal source model'};assert.equal(withExactCatalogModel(explicit),explicit);
 const unknown={...input,reference:'NO-CATALOG-123'};assert.equal(withExactCatalogModel(unknown),unknown);
});
test('generated map exactly reconciles current versioned source catalog and ambiguity holds',()=>{
 const root=path.resolve(__dirname,'..'),bytes=fs.readFileSync(path.join(root,registry.catalog_file));
 assert.equal(sha(bytes),registry.catalog_sha256);assert.equal(sha(fs.readFileSync(path.join(root,'shared/published-brand-aliases.json'))),registry.aliases_sha256);
 const rebuilt=buildExactCatalogModelMap(JSON.parse(bytes).entries);
 assert.deepEqual(rebuilt.models,registry.models);assert.deepEqual(rebuilt.rejected,registry.rejected);
 assert.equal(registry.supported_pairs+registry.rejected.length,registry.exact_pairs);
});
test('public canary contract applies catalog model after strict source validation',()=>{
 const {enforceListingDisplayContract}=require('../api/_lib/canary-display-contract.cjs');
 const input={contract_version:'v2.0',listing_id:'WF-catalog-fixture',source_id:'source-fixture',source_hash:'a'.repeat(64),brand:'Rolex',reference:'126610LN',model:null,image_status:'NO_IMAGE',image_key:null,category:'WATCH',intent:'WTB'};
 const result=enforceListingDisplayContract(input);assert.equal(result.model,'Submariner');assert.equal(result.source_model,null);assert.equal(result.source_hash,input.source_hash);assert.equal(result.price_usd,null);
 assert.throws(()=>enforceListingDisplayContract({...input,source_hash:null}));
 for(const source of [{brand:'\tRolex'},{reference:'\u00a0126610LN'},{model:'\t'}]) {
  const unchanged=enforceListingDisplayContract({...input,...source});
  assert.equal(unchanged.model_source,undefined,'Display trimming must not widen the exact SQL lookup');
 }
});
