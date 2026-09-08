-- New default order over frozen members. Existing explicit newest/discovery
-- cursors retain their order. No source, publication or snapshot payload changes.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE FUNCTION wf_canonical_staging.trading_source_lane_v1(p_payload jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT CASE
  WHEN NULLIF(p_payload->>'parent_listing_id','') IS NOT NULL
    OR p_payload->>'child_index' IS NOT NULL OR p_payload->>'is_bundle'='true' THEN 3
  WHEN p_payload->>'image_status'='SOURCE_IMAGE_PRESENT'
    AND NULLIF(btrim(p_payload->>'image_key'),'') IS NOT NULL THEN 1 ELSE 2 END
$$;
CREATE FUNCTION wf_canonical_staging.trading_source_time_v1(p_time timestamptz)
RETURNS numeric LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path='' AS $$
 SELECT -extract(epoch FROM p_time AT TIME ZONE 'UTC')
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.trading_source_lane_v1(jsonb),
 wf_canonical_staging.trading_source_time_v1(timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE INDEX snapshot_source_images_order_v1 ON wf_canonical_staging.keyset_snapshot_members
 (snapshot_id,wf_canonical_staging.trading_source_lane_v1(payload),
  wf_canonical_staging.trading_source_time_v1(source_created_at),listing_id COLLATE "C");

-- Keep the existing scalar country contract; validated JSON arrays add OR
-- within countries. Country and region dimensions remain separate AND filters.
DO $countries$
DECLARE item record; definition text; updated text; changed integer=0;
 needle text=$needle$lower(m.payload ->> 'location_country') = lower(p_country)$needle$;
 replacement text=$replacement$CASE WHEN left(p_country,1)='[' THEN EXISTS
 (SELECT 1 FROM jsonb_array_elements_text(p_country::jsonb) value
  WHERE lower(value)=lower(m.payload->>'location_country'))
 ELSE lower(m.payload->>'location_country')=lower(p_country) END$replacement$;
BEGIN
 FOR item IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
   'get_trading_floor_canary_keyset_v4','get_trading_floor_snapshot_count','get_trading_floor_discovery_keyset_v1'])
 LOOP
  definition=pg_get_functiondef(item.oid);updated=replace(definition,needle,replacement);
  IF updated=definition THEN RAISE EXCEPTION 'country_filter_definition_mismatch'; END IF;
  definition=updated;
  updated=replace(updated,
   $old$OR (lower(p_category) = 'wristwatches' AND lower(m.payload ->> 'category') = 'watches')$old$,
   $new$OR (lower(p_category) IN ('watch','watches','wristwatches') AND lower(m.payload ->> 'category') IN ('watch','watches','wristwatches'))$new$);
  IF updated=definition THEN RAISE EXCEPTION 'watch_category_filter_definition_mismatch'; END IF;
  definition=updated;
  updated=replace(updated,
   $old$lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'$old$,
   $new$lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'
       OR lower(COALESCE(m.payload ->> 'source_context_text', '')) LIKE '%' || lower(p_query) || '%'$new$);
  IF updated=definition THEN RAISE EXCEPTION 'child_context_search_definition_mismatch'; END IF;
  EXECUTE updated;changed=changed+1;
 END LOOP;
 IF changed<>3 THEN RAISE EXCEPTION 'country_filter_function_count_mismatch'; END IF;
END $countries$;

CREATE FUNCTION public.get_trading_floor_source_images_keyset_v1(
 p_snapshot_id uuid,p_limit integer DEFAULT 50,p_brand text DEFAULT NULL,p_model text DEFAULT NULL,
 p_intent text DEFAULT NULL,p_query text DEFAULT NULL,p_category text DEFAULT NULL,
 p_country text DEFAULT NULL,p_region text DEFAULT NULL,p_images_only boolean DEFAULT false,p_priced_only boolean DEFAULT false,
 p_cursor_priced_rank integer DEFAULT NULL,p_cursor_image_rank integer DEFAULT NULL,p_cursor_price_usd numeric DEFAULT NULL,
 p_cursor_created_at timestamptz DEFAULT NULL,p_cursor_listing_id text DEFAULT NULL
) RETURNS TABLE(k_priced_rank integer,k_image_rank integer,k_price_usd numeric,k_source_created_at timestamptz,
 k_listing_id text,k_source_lane integer,payload jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE cursor_supplied boolean := p_cursor_listing_id IS NOT NULL OR p_cursor_priced_rank IS NOT NULL
 OR p_cursor_image_rank IS NOT NULL OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
 v_member wf_canonical_staging.keyset_snapshot_members%ROWTYPE;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'invalid_limit' USING ERRCODE='22023'; END IF;
 IF p_snapshot_id IS NULL OR NOT EXISTS(SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
  WHERE r.snapshot_id=p_snapshot_id AND r.surface='trading_floor' AND r.expires_at>now()) THEN
  RAISE EXCEPTION 'snapshot_expired' USING ERRCODE='22023'; END IF;
 IF cursor_supplied THEN
  IF p_cursor_priced_rank NOT IN(1,2) OR p_cursor_image_rank NOT IN(1,2)
   OR p_cursor_created_at IS NULL OR NULLIF(btrim(p_cursor_listing_id),'') IS NULL THEN
   RAISE EXCEPTION 'invalid_cursor: malformed key' USING ERRCODE='22023'; END IF;
  SELECT m.* INTO v_member FROM wf_canonical_staging.keyset_snapshot_members m
   WHERE m.snapshot_id=wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND m.listing_id=p_cursor_listing_id;
  IF NOT FOUND OR v_member.priced_rank IS DISTINCT FROM p_cursor_priced_rank
   OR v_member.image_rank IS DISTINCT FROM p_cursor_image_rank OR v_member.price_usd IS DISTINCT FROM p_cursor_price_usd
   OR v_member.source_created_at IS DISTINCT FROM p_cursor_created_at THEN
   RAISE EXCEPTION 'invalid_cursor: key does not match frozen member' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN QUERY SELECT m.priced_rank,m.image_rank,m.price_usd,m.source_created_at,m.listing_id,
  wf_canonical_staging.trading_source_lane_v1(m.payload),m.payload
 FROM wf_canonical_staging.keyset_snapshot_members m
 WHERE m.snapshot_id=wf_canonical_staging.snapshot_data_id(p_snapshot_id)
  AND (p_brand IS NULL OR lower(wf_canonical_staging.published_browse_brand_v1(m.payload->>'brand'))=lower(wf_canonical_staging.published_browse_brand_v1(p_brand)))
  AND (p_model IS NULL OR lower(m.payload->>'model')=lower(p_model)
   OR (p_model='Reference-only listings' AND NULLIF(btrim(m.payload->>'model'),'') IS NULL))
  AND (p_intent IS NULL OR m.payload->>'intent'=upper(p_intent))
  AND (p_category IS NULL OR lower(m.payload->>'category')=lower(p_category)
   OR (lower(p_category) IN('watch','watches','wristwatches') AND lower(m.payload->>'category') IN('watch','watches','wristwatches')))
  AND (p_country IS NULL OR CASE WHEN left(p_country,1)='[' THEN EXISTS
   (SELECT 1 FROM jsonb_array_elements_text(p_country::jsonb) value WHERE lower(value)=lower(m.payload->>'location_country'))
   ELSE lower(m.payload->>'location_country')=lower(p_country) END)
  AND (p_region IS NULL OR CASE WHEN left(p_region,1)='[' THEN EXISTS
   (SELECT 1 FROM jsonb_array_elements_text(p_region::jsonb) value WHERE lower(value)=lower(m.payload->>'location_region'))
   ELSE lower(m.payload->>'location_region')=lower(p_region) END)
  AND (NOT p_images_only OR (m.payload->>'image_status'='SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(m.payload->>'image_key'),'') IS NOT NULL))
  AND (NOT p_priced_only OR (m.payload->>'price_usd' IS NOT NULL AND (m.payload->>'price_usd')::numeric>0))
  AND (p_query IS NULL OR
   lower(COALESCE(m.payload->>'reference','')) LIKE '%'||lower(p_query)||'%'
   OR lower(COALESCE(m.payload->>'model','')) LIKE '%'||lower(p_query)||'%'
   OR lower(COALESCE(m.payload->>'title','')) LIKE '%'||lower(p_query)||'%'
   OR lower(COALESCE(wf_canonical_staging.published_browse_brand_v1(m.payload->>'brand'),'')) LIKE '%'||lower(p_query)||'%'
   OR lower(COALESCE(m.payload->>'raw_message_text','')) LIKE '%'||lower(p_query)||'%'
   OR lower(COALESCE(m.payload->>'source_context_text','')) LIKE '%'||lower(p_query)||'%'
   OR lower(COALESCE(m.payload->>'seller_display_name','')) LIKE '%'||lower(p_query)||'%')
  AND (NOT cursor_supplied OR
   (wf_canonical_staging.trading_source_lane_v1(m.payload),wf_canonical_staging.trading_source_time_v1(m.source_created_at),m.listing_id COLLATE "C")
   > (wf_canonical_staging.trading_source_lane_v1(v_member.payload),wf_canonical_staging.trading_source_time_v1(p_cursor_created_at),p_cursor_listing_id COLLATE "C"))
 ORDER BY wf_canonical_staging.trading_source_lane_v1(m.payload),
  wf_canonical_staging.trading_source_time_v1(m.source_created_at),m.listing_id COLLATE "C"
 LIMIT p_limit;
END $function$;
REVOKE ALL ON FUNCTION public.get_trading_floor_source_images_keyset_v1(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_source_images_keyset_v1(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
