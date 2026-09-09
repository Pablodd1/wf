'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),registry=require('../../shared/exact-catalog-models.json'),aliases=require('../../shared/published-brand-aliases.json');
const {brandModelNames}=require('../../shared/catalog-model-display-v2.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::pg_catalog.jsonb";
const models=Object.fromEntries(Object.entries(registry.models).map(([b,refs])=>[b,Object.fromEntries(Object.entries(refs).map(([r,v])=>[r,v.model]))]));
const brand= "pg_catalog.lower(COALESCE("+literal(aliases)+" OPERATOR(pg_catalog.->>) pg_catalog.lower(pg_catalog.btrim(p_brand)),pg_catalog.btrim(p_brand)))";
const sql=`-- Exact catalog identity takes precedence over legacy model claims.
-- Unknown model claims remain in source payloads and are omitted from validated model menus.
-- Separate V2 helper leaves the existing V1 expression index valid during preparation.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.published_catalog_model_v2(p_model text,p_brand text,p_reference text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $model$
 SELECT COALESCE(
  ${literal(models)} OPERATOR(pg_catalog.->) ${brand}
   OPERATOR(pg_catalog.->>) pg_catalog.upper(pg_catalog.translate(p_reference,E' \\t\\r\\n\\f\\013','')),
  ${literal(brandModelNames)} OPERATOR(pg_catalog.->) ${brand}
   OPERATOR(pg_catalog.->>) pg_catalog.lower(pg_catalog.btrim(p_model)));
$model$;
REVOKE ALL ON FUNCTION wf_canonical_staging.published_catalog_model_v2(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION wf_canonical_staging.published_catalog_model_v2(text,text,text) IS
 'WF_CATALOG_MODEL_DISPLAY_V2; exact_map_sha256=${sha(fs.readFileSync(path.join(root,'shared/exact-catalog-models.json')))}; model_names_sha256=${sha(JSON.stringify(brandModelNames))}';
COMMIT;
`;
const index=`-- Run outside a transaction. Keep V1 index valid until the RPC switch commits.
CREATE INDEX CONCURRENTLY snapshot_published_brand_model_v2
ON wf_canonical_staging.keyset_snapshot_members
(snapshot_id,lower(wf_canonical_staging.published_browse_brand_v1(payload->>'brand')),
 coalesce(lower(wf_canonical_staging.published_catalog_model_v2(payload->>'model',payload->>'brand',payload->>'reference')),'reference-only listings'));
`;
const switchSql=`-- Atomically align card selection, browse menus and counts with the prepared V2 index.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $switch$
DECLARE item record; old_definition text; new_definition text; changed integer=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('wf_canonical_staging.snapshot_published_brand_model_v2') AND indisvalid AND indisready)
 THEN RAISE EXCEPTION 'catalog_model_v2_index_not_ready'; END IF;
 FOR item IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='public' AND p.proname=ANY(ARRAY[
 'get_trading_floor_canary_keyset_v4','get_trading_floor_snapshot_count','get_trading_floor_discovery_keyset_v1','get_trading_floor_source_images_keyset_v1',
 'get_price_research_snapshot_count','get_price_research_snapshot_facets','get_price_research_snapshot_dial_facets',
 'get_price_research_snapshot_stats','get_price_research_canary_keyset_v4','get_price_research_wtb_demand_v3','get_price_research_snapshot_membership','get_canary_snapshot_browse_v1']))
 OR (n.nspname='wf_canonical_staging' AND p.proname='compute_research_snapshot_breakdown_v2')
 LOOP
  old_definition=pg_catalog.pg_get_functiondef(item.oid);
  new_definition=pg_catalog.replace(old_definition,'wf_canonical_staging.published_catalog_model_v1(','wf_canonical_staging.published_catalog_model_v2(');
  IF new_definition=old_definition THEN RAISE EXCEPTION 'catalog_model_v2_target_not_replaced: %',item.proname;END IF;
  EXECUTE new_definition;changed=changed+1;
 END LOOP;
 IF changed<>13 THEN RAISE EXCEPTION 'catalog_model_v2_target_count: %',changed;END IF;
END $switch$;
NOTIFY pgrst,'reload schema';
COMMIT;
`;
const generated=[['20260910370000_catalog_model_evidence_projection_v2.sql',sql],['20260910380000_snapshot_catalog_model_index_v2.sql',index],['20260910390000_catalog_model_filter_projection_v2.sql',switchSql]];
for(const [name,text]of generated){
 const file=path.join(root,'supabase/migrations',name);
 if(process.argv.includes('--check'))assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),text);
 else fs.writeFileSync(file,text);
}
console.log(JSON.stringify({status:'PASS_GENERATED_CATALOG_MODEL_DISPLAY_V2',files:generated.map(([name,text])=>({name,sha256:sha(text)})),production_applied:false}));
