'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const dependency=require.resolve('../api/_lib/supabase.js');require.cache[dependency]={id:dependency,filename:dependency,loaded:true,exports:{getClient:()=>assert.fail('V2 catalog browsing must not query legacy workbook releases')}};
const handler=require('../api/catalog-models.js');
const invoke=async brand=>{let status,body;await handler({method:'GET',query:{brand}},{setHeader(){},status(n){status=n;return this;},json(b){body=b;return this;}});return {status,body};};
test.before(()=>{process.env.VITE_USE_CANARY_V2='true';});
test('uncatalogued source brands return a truthful empty model filter',async()=>{const r=await invoke('SYNTHETIC UNCATALOGUED BRAND');assert.equal(r.status,200);assert.deepEqual(r.body.models,[]);assert.equal(r.body.model_count,0);assert.equal(r.body.identity_source,'CANONICAL_CATALOG_METADATA');assert.equal(r.body.observed_listing_count,undefined);});
test('catalogued brand models are deterministic metadata without invented inventory counts',async()=>{const r=await invoke('Rolex');assert.equal(r.status,200);assert.ok(r.body.models.length>0);assert.equal(new Set(r.body.models.map(m=>m.model)).size,r.body.models.length);assert.ok(r.body.models.every(m=>m.reference_count>0&&m.listing_count===undefined));});
test('malformed brand requests are refused without database access',async()=>{for(const value of [[],{},'', 'x'.repeat(101)])assert.equal((await invoke(value)).status,400);});
