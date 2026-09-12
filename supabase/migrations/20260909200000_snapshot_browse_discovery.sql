-- Alternate deterministic order over the same immutable membership and payload.
-- Existing default five-field order remains unchanged. No raw/publication rows change.
BEGIN;
CREATE INDEX IF NOT EXISTS snapshot_discovery_order_v1
ON wf_canonical_staging.keyset_snapshot_members
  (snapshot_id, priced_rank, image_rank, (pg_catalog.md5(listing_id) COLLATE "C"), listing_id);

CREATE OR REPLACE FUNCTION public.get_trading_floor_canary_keyset_v4(p_snapshot_id uuid, p_limit integer DEFAULT 50, p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_images_only boolean DEFAULT false, p_priced_only boolean DEFAULT false, p_cursor_priced_rank integer DEFAULT NULL::integer, p_cursor_image_rank integer DEFAULT NULL::integer, p_cursor_price_usd numeric DEFAULT NULL::numeric, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_listing_id text DEFAULT NULL::text)
 RETURNS TABLE(k_priced_rank integer, k_image_rank integer, k_price_usd numeric, k_source_created_at timestamp with time zone, k_listing_id text, payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
  v_member wf_canonical_staging.keyset_snapshot_members%ROWTYPE;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_limit: page limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF cursor_supplied THEN
    IF p_cursor_priced_rank NOT IN (1, 2)
       OR p_cursor_image_rank NOT IN (1, 2)
       OR p_cursor_created_at IS NULL
       OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor: malformed composite cursor' USING ERRCODE = '22023';
    END IF;
    -- Cursor-to-membership binding (fail closed), unchanged from Phase 5.1.
    SELECT m.* INTO v_member
    FROM wf_canonical_staging.keyset_snapshot_members m
    WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND m.listing_id = p_cursor_listing_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_cursor: cursor listing_id is not a member of this snapshot' USING ERRCODE = '22023';
    END IF;
    IF v_member.priced_rank IS DISTINCT FROM p_cursor_priced_rank
       OR v_member.image_rank IS DISTINCT FROM p_cursor_image_rank
       OR v_member.price_usd IS DISTINCT FROM p_cursor_price_usd
       OR v_member.source_created_at IS DISTINCT FROM p_cursor_created_at THEN
      RAISE EXCEPTION 'invalid_cursor: cursor key does not match frozen snapshot member key' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.priced_rank, m.image_rank, m.price_usd, m.source_created_at, m.listing_id,
    m.payload
  FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model) OR (p_model = 'Reference-only listings' AND NULLIF(btrim(m.payload ->> 'model'), '') IS NULL))
    AND (p_intent IS NULL OR (m.payload ->> 'intent') = upper(p_intent))
    AND (p_category IS NULL
         OR lower(m.payload ->> 'category') = lower(p_category)
         OR (lower(p_category) = 'watches' AND lower(m.payload ->> 'category') = 'wristwatches')
         OR (lower(p_category) = 'wristwatches' AND lower(m.payload ->> 'category') = 'watches'))
    AND (p_country IS NULL OR lower(m.payload ->> 'location_country') = lower(p_country))
    AND (p_region IS NULL OR CASE WHEN left(p_region,1)='[' THEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_region::jsonb) value WHERE lower(value)=lower(m.payload->>'location_region')) ELSE lower(m.payload->>'location_region')=lower(p_region) END)
    AND (NOT p_images_only OR ((m.payload ->> 'image_status') = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(m.payload ->> 'image_key'), '') IS NOT NULL))
    AND (NOT p_priced_only OR ((m.payload ->> 'price_usd') IS NOT NULL AND (m.payload ->> 'price_usd')::numeric > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(m.payload ->> 'reference', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'model', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'title', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'brand', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'raw_message_text', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'
    ))
    AND (NOT cursor_supplied OR (
         m.priced_rank > p_cursor_priced_rank
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank > p_cursor_image_rank)
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND (p_cursor_price_usd IS NOT NULL AND (m.price_usd < p_cursor_price_usd OR m.price_usd IS NULL)))
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND m.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND m.source_created_at < p_cursor_created_at)
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND m.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND m.source_created_at = p_cursor_created_at
          AND m.listing_id > p_cursor_listing_id)
    ))
  ORDER BY m.priced_rank ASC, m.image_rank ASC,
           m.price_usd DESC NULLS LAST, m.source_created_at DESC, m.listing_id ASC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_trading_floor_canary_keyset_v4(p_snapshot_id uuid, p_limit integer, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_keyset_v4(p_snapshot_id uuid, p_limit integer, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_trading_floor_snapshot_count(p_snapshot_id uuid, p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_images_only boolean DEFAULT false, p_priced_only boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF p_brand IS NULL AND p_model IS NULL AND p_intent IS NULL AND p_query IS NULL AND p_category IS NULL AND p_country IS NULL AND p_region IS NULL AND NOT p_images_only AND NOT p_priced_only THEN
    RETURN (SELECT member_count FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=p_snapshot_id);
  END IF;
  SELECT count(*) INTO v_count
  FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model) OR (p_model = 'Reference-only listings' AND NULLIF(btrim(m.payload ->> 'model'), '') IS NULL))
    AND (p_intent IS NULL OR (m.payload ->> 'intent') = upper(p_intent))
    AND (p_category IS NULL
      OR lower(m.payload ->> 'category') = lower(p_category)
      OR (lower(p_category) = 'watches' AND lower(m.payload ->> 'category') = 'wristwatches')
      OR (lower(p_category) = 'wristwatches' AND lower(m.payload ->> 'category') = 'watches'))
    AND (p_country IS NULL OR lower(m.payload ->> 'location_country') = lower(p_country))
    AND (p_region IS NULL OR CASE WHEN left(p_region,1)='[' THEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_region::jsonb) value WHERE lower(value)=lower(m.payload->>'location_region')) ELSE lower(m.payload->>'location_region')=lower(p_region) END)
    AND (NOT p_images_only OR ((m.payload ->> 'image_status') = 'SOURCE_IMAGE_PRESENT'
      AND NULLIF(btrim(m.payload ->> 'image_key'), '') IS NOT NULL))
    AND (NOT p_priced_only OR ((m.payload ->> 'price_usd') IS NOT NULL
      AND (m.payload ->> 'price_usd')::numeric > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(m.payload ->> 'reference', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'model', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'title', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'brand', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'raw_message_text', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'
    ));
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_trading_floor_snapshot_count(p_snapshot_id uuid, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_snapshot_count(p_snapshot_id uuid, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_trading_floor_discovery_keyset_v1(p_snapshot_id uuid, p_limit integer DEFAULT 50, p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_images_only boolean DEFAULT false, p_priced_only boolean DEFAULT false, p_cursor_priced_rank integer DEFAULT NULL::integer, p_cursor_image_rank integer DEFAULT NULL::integer, p_cursor_price_usd numeric DEFAULT NULL::numeric, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_listing_id text DEFAULT NULL::text)
 RETURNS TABLE(k_priced_rank integer, k_image_rank integer, k_price_usd numeric, k_source_created_at timestamp with time zone, k_listing_id text, payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
  v_member wf_canonical_staging.keyset_snapshot_members%ROWTYPE;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_limit: page limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF cursor_supplied THEN
    IF p_cursor_priced_rank NOT IN (1, 2)
       OR p_cursor_image_rank NOT IN (1, 2)
       OR p_cursor_created_at IS NULL
       OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor: malformed composite cursor' USING ERRCODE = '22023';
    END IF;
    -- Cursor-to-membership binding (fail closed), unchanged from Phase 5.1.
    SELECT m.* INTO v_member
    FROM wf_canonical_staging.keyset_snapshot_members m
    WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND m.listing_id = p_cursor_listing_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_cursor: cursor listing_id is not a member of this snapshot' USING ERRCODE = '22023';
    END IF;
    IF v_member.priced_rank IS DISTINCT FROM p_cursor_priced_rank
       OR v_member.image_rank IS DISTINCT FROM p_cursor_image_rank
       OR v_member.price_usd IS DISTINCT FROM p_cursor_price_usd
       OR v_member.source_created_at IS DISTINCT FROM p_cursor_created_at THEN
      RAISE EXCEPTION 'invalid_cursor: cursor key does not match frozen snapshot member key' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.priced_rank, m.image_rank, m.price_usd, m.source_created_at, m.listing_id,
    m.payload
  FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model) OR (p_model = 'Reference-only listings' AND NULLIF(btrim(m.payload ->> 'model'), '') IS NULL))
    AND (p_intent IS NULL OR (m.payload ->> 'intent') = upper(p_intent))
    AND (p_category IS NULL
         OR lower(m.payload ->> 'category') = lower(p_category)
         OR (lower(p_category) = 'watches' AND lower(m.payload ->> 'category') = 'wristwatches')
         OR (lower(p_category) = 'wristwatches' AND lower(m.payload ->> 'category') = 'watches'))
    AND (p_country IS NULL OR lower(m.payload ->> 'location_country') = lower(p_country))
    AND (p_region IS NULL OR CASE WHEN left(p_region,1)='[' THEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_region::jsonb) value WHERE lower(value)=lower(m.payload->>'location_region')) ELSE lower(m.payload->>'location_region')=lower(p_region) END)
    AND (NOT p_images_only OR ((m.payload ->> 'image_status') = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(m.payload ->> 'image_key'), '') IS NOT NULL))
    AND (NOT p_priced_only OR ((m.payload ->> 'price_usd') IS NOT NULL AND (m.payload ->> 'price_usd')::numeric > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(m.payload ->> 'reference', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'model', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'title', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'brand', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'raw_message_text', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'
    ))
    AND (NOT cursor_supplied OR
      (m.priced_rank, m.image_rank, pg_catalog.md5(m.listing_id) COLLATE "C", m.listing_id)
      > (p_cursor_priced_rank, p_cursor_image_rank, pg_catalog.md5(p_cursor_listing_id) COLLATE "C", p_cursor_listing_id))
  ORDER BY m.priced_rank, m.image_rank, pg_catalog.md5(m.listing_id) COLLATE "C", m.listing_id
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_trading_floor_discovery_keyset_v1(p_snapshot_id uuid, p_limit integer, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_discovery_keyset_v1(p_snapshot_id uuid, p_limit integer, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) TO service_role;


-- Derived metadata is computed once per immutable data snapshot, never from the
-- catalog or a separate legacy population. Cache contains only public browse fields.
CREATE TABLE IF NOT EXISTS wf_canonical_staging.snapshot_browse_cache_v1 (
  snapshot_id uuid PRIMARY KEY REFERENCES wf_canonical_staging.keyset_snapshot_registry(snapshot_id) ON DELETE CASCADE,
  entries jsonb NOT NULL,
  countries jsonb NOT NULL,
  regions jsonb NOT NULL
);
ALTER TABLE wf_canonical_staging.snapshot_browse_cache_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.snapshot_browse_cache_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_canary_snapshot_browse_v1(
  p_snapshot_id uuid, p_surface text, p_brand text DEFAULT NULL, p_model text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $browse$
DECLARE v_data uuid; v_entries jsonb; v_countries jsonb; v_regions jsonb; v_result jsonb;
BEGIN
  IF p_surface NOT IN ('trading_floor','price_research') OR p_surface IS NULL THEN
    RAISE EXCEPTION 'snapshot_expired: unsupported surface' USING ERRCODE='22023';
  END IF;
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id,p_surface);
  v_data := wf_canonical_staging.snapshot_data_id(p_snapshot_id);
  SELECT entries,countries,regions INTO v_entries,v_countries,v_regions
    FROM wf_canonical_staging.snapshot_browse_cache_v1 WHERE snapshot_id=v_data;
  IF NOT FOUND THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wf_snapshot_browse:'||v_data::text,0));
    SELECT entries,countries,regions INTO v_entries,v_countries,v_regions
      FROM wf_canonical_staging.snapshot_browse_cache_v1 WHERE snapshot_id=v_data;
    IF NOT FOUND THEN
      WITH population AS MATERIALIZED (
        SELECT NULLIF(btrim(m.payload->>'brand'),'') brand,
          NULLIF(btrim(m.payload->>'model'),'') model,
          NULLIF(btrim(m.payload->>'reference'),'') reference,
          NULLIF(btrim(m.payload->>'location_country'),'') country,
          NULLIF(btrim(m.payload->>'location_region'),'') region,
          m.payload->>'intent' intent,
          CASE WHEN m.payload->>'image_status'='SOURCE_IMAGE_PRESENT' THEN NULLIF(m.payload->>'image_url','') END image_url
        FROM wf_canonical_staging.keyset_snapshot_members m
        WHERE m.snapshot_id=v_data AND (p_surface='trading_floor' OR EXISTS (
          SELECT 1 FROM wf_canonical_staging.research_snapshot_admission_v2 a
          WHERE a.snapshot_id=v_data AND a.listing_id=m.listing_id AND a.exclusion_reason IS NULL))
      ), grouped AS (
        SELECT brand,model,reference,count(*)::int listing_count,
          count(*) FILTER(WHERE intent='WTS')::int wts_count,
          count(*) FILTER(WHERE intent='WTB')::int wtb_count,min(image_url) image_url
        FROM population GROUP BY brand,model,reference
      ) SELECT COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY brand,model,reference) FROM grouped g),'[]'::jsonb),
        COALESCE((SELECT jsonb_agg(country ORDER BY country) FROM (SELECT DISTINCT country FROM population WHERE country IS NOT NULL) c),'[]'::jsonb),
        COALESCE((SELECT jsonb_agg(region ORDER BY region) FROM (SELECT DISTINCT region FROM population WHERE region IS NOT NULL) c),'[]'::jsonb)
      INTO v_entries,v_countries,v_regions;
      INSERT INTO wf_canonical_staging.snapshot_browse_cache_v1 VALUES(v_data,v_entries,v_countries,v_regions);
    END IF;
  END IF;
  WITH entries AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(v_entries) AS e(brand text,model text,reference text,listing_count int,wts_count int,wtb_count int,image_url text)
  ), brands AS (
    SELECT brand,sum(listing_count)::int listing_count,
      count(DISTINCT COALESCE(model,'Reference-only listings'))::int model_count,
      count(DISTINCT reference)::int reference_count
    FROM entries WHERE brand IS NOT NULL GROUP BY brand
  ), models AS (
    SELECT COALESCE(model,'Reference-only listings') model,
      count(DISTINCT reference)::int reference_count,sum(listing_count)::int listing_count,min(image_url) image_url
    FROM entries WHERE p_brand IS NOT NULL AND lower(brand)=lower(p_brand) GROUP BY model
  ), refs AS (
    SELECT reference,model,listing_count,wts_count,wtb_count,image_url FROM entries
    WHERE p_brand IS NOT NULL AND lower(brand)=lower(p_brand) AND reference IS NOT NULL
      AND (p_model IS NULL OR lower(model)=lower(p_model) OR (p_model='Reference-only listings' AND model IS NULL))
  ) SELECT jsonb_build_object('success',true,'snapshot_id',p_snapshot_id,'surface',p_surface,
    'brands',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY listing_count DESC,brand) FROM brands b),'[]'::jsonb),
    'models',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY listing_count DESC,model) FROM models m),'[]'::jsonb),
    'references',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY reference,model) FROM refs r),'[]'::jsonb),
    'availableCountries',v_countries,'availableRegions',v_regions) INTO v_result;
  RETURN v_result;
END;
$browse$;
REVOKE ALL ON FUNCTION public.get_canary_snapshot_browse_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_canary_snapshot_browse_v1(uuid,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
