-- Atomically align card selection, browse menus and counts with the prepared V2 index.
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
