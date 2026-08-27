-- Customer order contract for the completed Rolex/Patek shadow cohort.
-- Lane 0 is an exact single-input source message. Lane 1 is a previously
-- approved deterministic child from a multi-watch source. The cohort, source
-- rows, classifications, and immutable raw evidence are not modified.

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_source_lane_feed_v1_idx
  ON public.curated_luxury_current_listings_shadow (
    run_id,
    brand,
    (CASE WHEN parent_raw_text_sha256 IS NOT NULL
      AND exact_child_text_sha256=parent_raw_text_sha256 THEN 0 ELSE 1 END),
    source_timestamp DESC NULLS LAST,
    current_listing_key DESC
  )
  WHERE current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE');

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page_keys_v4(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_reference_key text DEFAULT NULL,
  p_listing_lane smallint DEFAULT NULL,
  p_after_lane smallint DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,
  p_after_key text DEFAULT NULL,
  p_after_timestamp_is_null boolean DEFAULT false,
  p_limit integer DEFAULT 50
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,extensions SET plan_cache_mode='force_custom_plan' AS $$
DECLARE v_sql text; v_result jsonb;
BEGIN
  IF p_listing_lane IS NOT NULL AND p_listing_lane NOT IN (0,1) THEN
    RAISE EXCEPTION 'Listing lane must be 0 or 1';
  END IF;
  IF p_after_key IS NOT NULL AND p_after_lane NOT IN (0,1) THEN
    RAISE EXCEPTION 'Complete source-lane cursor required';
  END IF;
  v_sql := $query$
    WITH candidates AS MATERIALIZED (
      SELECT c.current_listing_key,c.source_timestamp,
        CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END listing_lane
      FROM public.curated_luxury_current_listings_shadow c
      WHERE c.run_id=$1
        AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
        AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
          WHERE r.run_id=$1 AND r.status='COMPLETE')
  $query$;
  IF p_brands IS NOT NULL THEN v_sql:=v_sql||' AND c.brand=ANY($2)'; END IF;
  IF p_intents IS NOT NULL THEN v_sql:=v_sql||' AND c.intent=ANY($3)'; END IF;
  IF p_countries IS NOT NULL THEN v_sql:=v_sql||' AND c.country_code=ANY($4)'; END IF;
  IF p_priced_only THEN v_sql:=v_sql||' AND c.price_verified'; END IF;
  IF p_images_only THEN v_sql:=v_sql||' AND c.image_linked'; END IF;
  IF p_reference_key IS NOT NULL THEN
    v_sql:=v_sql||' AND c.observed_reference_key=$8';
  END IF;
  IF NULLIF(btrim(p_search),'') IS NOT NULL THEN
    v_sql:=v_sql||' AND upper(c.search_text) LIKE ''%''||upper(btrim($7))||''%''';
  END IF;
  IF p_listing_lane IS NOT NULL THEN
    v_sql:=v_sql||' AND (CASE WHEN c.parent_raw_text_sha256 IS NOT NULL'
      ||' AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)=$9';
  END IF;
  IF p_after_key IS NOT NULL THEN
    v_sql:=v_sql||$cursor$
      AND (
        (CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)>$10
        OR ((CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)=$10
          AND (($13 AND c.source_timestamp IS NULL AND c.current_listing_key<$12)
            OR (NOT $13 AND $11 IS NOT NULL AND (
              c.source_timestamp<$11
              OR (c.source_timestamp=$11 AND c.current_listing_key<$12)
              OR c.source_timestamp IS NULL))))
      )
    $cursor$;
  END IF;
  v_sql:=v_sql||$tail$
      ORDER BY listing_lane ASC,c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
      LIMIT least(greatest(coalesce($14,50),1),100)+1
    ), selected AS MATERIALIZED (
      SELECT * FROM candidates
      ORDER BY listing_lane ASC,source_timestamp DESC NULLS LAST,current_listing_key DESC
      LIMIT least(greatest(coalesce($14,50),1),100)
    ), last_row AS (
      SELECT * FROM selected
      ORDER BY listing_lane DESC,source_timestamp ASC NULLS FIRST,current_listing_key ASC LIMIT 1
    )
    SELECT jsonb_build_object(
      'keys',coalesce((SELECT jsonb_agg(current_listing_key
        ORDER BY listing_lane ASC,source_timestamp DESC NULLS LAST,current_listing_key DESC)
        FROM selected),'[]'::jsonb),
      'key_lanes',coalesce((SELECT jsonb_object_agg(current_listing_key,listing_lane)
        FROM selected),'{}'::jsonb),
      'has_more',(SELECT count(*) FROM candidates)>least(greatest(coalesce($14,50),1),100),
      'next_lane',(SELECT listing_lane FROM last_row),
      'next_timestamp',(SELECT source_timestamp FROM last_row),
      'next_key',(SELECT current_listing_key FROM last_row),
      'next_timestamp_is_null',(SELECT source_timestamp IS NULL FROM last_row)
    )
  $tail$;
  EXECUTE v_sql INTO v_result USING p_run_id,p_brands,p_intents,p_countries,
    p_priced_only,p_images_only,p_search,p_reference_key,p_listing_lane,p_after_lane,
    p_after_timestamp,p_after_key,p_after_timestamp_is_null,p_limit;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_rolex_customer_page_keys_v5(
  p_run_id uuid,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_reference_key text DEFAULT NULL,
  p_listing_lane smallint DEFAULT NULL,
  p_after_lane smallint DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,
  p_after_key text DEFAULT NULL,
  p_after_timestamp_is_null boolean DEFAULT false,
  p_limit integer DEFAULT 50
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,extensions SET plan_cache_mode='force_custom_plan' AS $$
  WITH candidates AS MATERIALIZED (
    SELECT c.current_listing_key,c.source_timestamp,
      CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
        AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END listing_lane
    FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (NULLIF(btrim(p_search),'') IS NULL
        OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
      AND (p_listing_lane IS NULL OR
        (CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)=p_listing_lane)
      AND (NOT p_priced_only OR c.price_verified OR EXISTS (
        SELECT 1 FROM public.curated_luxury_rolex_price_evidence_shadow p
        WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
          AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
          AND p.decision='VERIFIED' AND p.display_price_verified
          AND NOT EXISTS (
            SELECT 1 FROM public.curated_luxury_rolex_price_evidence_shadow newer
            WHERE newer.run_id=p.run_id AND newer.current_listing_key=p.current_listing_key
              AND newer.latest_raw_occurrence_key=p.latest_raw_occurrence_key
              AND (newer.created_at,newer.evidence_version)>(p.created_at,p.evidence_version)))))
      AND (NOT p_images_only OR EXISTS (
        SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
      AND (p_after_key IS NULL OR
        (CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)>p_after_lane
        OR ((CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)=p_after_lane
          AND ((p_after_timestamp_is_null AND c.source_timestamp IS NULL
              AND c.current_listing_key<p_after_key)
            OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
              c.source_timestamp<p_after_timestamp
              OR (c.source_timestamp=p_after_timestamp AND c.current_listing_key<p_after_key)
              OR c.source_timestamp IS NULL)))))
    ORDER BY listing_lane ASC,c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)+1
  ), selected AS MATERIALIZED (
    SELECT * FROM candidates
    ORDER BY listing_lane ASC,source_timestamp DESC NULLS LAST,current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)
  ), last_row AS (
    SELECT * FROM selected
    ORDER BY listing_lane DESC,source_timestamp ASC NULLS FIRST,current_listing_key ASC LIMIT 1
  )
  SELECT jsonb_build_object(
    'keys',coalesce((SELECT jsonb_agg(current_listing_key
      ORDER BY listing_lane ASC,source_timestamp DESC NULLS LAST,current_listing_key DESC)
      FROM selected),'[]'::jsonb),
    'key_lanes',coalesce((SELECT jsonb_object_agg(current_listing_key,listing_lane)
      FROM selected),'{}'::jsonb),
    'has_more',(SELECT count(*) FROM candidates)>least(greatest(coalesce(p_limit,50),1),100),
    'next_lane',(SELECT listing_lane FROM last_row),
    'next_timestamp',(SELECT source_timestamp FROM last_row),
    'next_key',(SELECT current_listing_key FROM last_row),
    'next_timestamp_is_null',(SELECT source_timestamp IS NULL FROM last_row));
$$;

REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v4(
  uuid,text[],text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_customer_page_keys_v5(
  uuid,text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v4(
  uuid,text[],text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_customer_page_keys_v5(
  uuid,text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  TO service_role;

NOTIFY pgrst,'reload schema';
