-- Forward-only performance repair for the Rolex/Patek source-lane feed.
-- The completed cohort and immutable raw/source evidence remain read only.

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_single_input_feed_v1_idx
  ON public.curated_luxury_current_listings_shadow (
    run_id, brand, source_timestamp DESC NULLS LAST, current_listing_key DESC
  )
  WHERE current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
    AND parent_raw_text_sha256 IS NOT NULL
    AND exact_child_text_sha256=parent_raw_text_sha256;

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_multi_child_feed_v1_idx
  ON public.curated_luxury_current_listings_shadow (
    run_id, brand, source_timestamp DESC NULLS LAST, current_listing_key DESC
  )
  WHERE current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
    AND (parent_raw_text_sha256 IS NULL
      OR exact_child_text_sha256 IS DISTINCT FROM parent_raw_text_sha256);

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
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,extensions SET plan_cache_mode='force_custom_plan' AS $$
  WITH single_candidates AS MATERIALIZED (
    SELECT c.current_listing_key,c.source_timestamp,0::smallint listing_lane
    FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id=p_run_id
      AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND c.parent_raw_text_sha256 IS NOT NULL
      AND c.exact_child_text_sha256=c.parent_raw_text_sha256
      AND (p_listing_lane IS NULL OR p_listing_lane=0)
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
      AND (p_brands IS NULL OR c.brand=ANY(p_brands))
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (NOT p_images_only OR EXISTS (
        SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (NULLIF(btrim(p_search),'') IS NULL
        OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
      AND (p_after_key IS NULL OR (p_after_lane=0 AND (
        (p_after_timestamp_is_null AND c.source_timestamp IS NULL
          AND c.current_listing_key<p_after_key)
        OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
          c.source_timestamp<p_after_timestamp
          OR (c.source_timestamp=p_after_timestamp AND c.current_listing_key<p_after_key)
          OR c.source_timestamp IS NULL)))))
    ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)+1
  ), multi_candidates AS MATERIALIZED (
    SELECT c.current_listing_key,c.source_timestamp,1::smallint listing_lane
    FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id=p_run_id
      AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND (c.parent_raw_text_sha256 IS NULL
        OR c.exact_child_text_sha256 IS DISTINCT FROM c.parent_raw_text_sha256)
      AND (p_listing_lane IS NULL OR p_listing_lane=1)
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
      AND (p_brands IS NULL OR c.brand=ANY(p_brands))
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (NOT p_images_only OR EXISTS (
        SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (NULLIF(btrim(p_search),'') IS NULL
        OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
      AND (p_after_key IS NULL OR p_after_lane=0 OR (p_after_lane=1 AND (
        (p_after_timestamp_is_null AND c.source_timestamp IS NULL
          AND c.current_listing_key<p_after_key)
        OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
          c.source_timestamp<p_after_timestamp
          OR (c.source_timestamp=p_after_timestamp AND c.current_listing_key<p_after_key)
          OR c.source_timestamp IS NULL)))))
    ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)+1
  ), candidates AS MATERIALIZED (
    SELECT * FROM single_candidates
    UNION ALL
    SELECT * FROM multi_candidates
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
  WITH single_candidates AS MATERIALIZED (
    SELECT c.current_listing_key,c.source_timestamp,0::smallint listing_lane
    FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id
      AND c.parent_raw_text_sha256 IS NOT NULL
      AND c.exact_child_text_sha256=c.parent_raw_text_sha256
      AND (p_listing_lane IS NULL OR p_listing_lane=0)
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (NULLIF(btrim(p_search),'') IS NULL
        OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
      AND (NOT p_priced_only OR c.price_verified OR EXISTS (
        SELECT 1 FROM public.curated_luxury_rolex_latest_price_evidence_v2 p
        WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
          AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
          AND p.decision='VERIFIED' AND p.display_price_verified))
      AND (NOT p_images_only OR EXISTS (
        SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
      AND (p_after_key IS NULL OR (p_after_lane=0 AND (
        (p_after_timestamp_is_null AND c.source_timestamp IS NULL
          AND c.current_listing_key<p_after_key)
        OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
          c.source_timestamp<p_after_timestamp
          OR (c.source_timestamp=p_after_timestamp AND c.current_listing_key<p_after_key)
          OR c.source_timestamp IS NULL)))))
    ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)+1
  ), multi_candidates AS MATERIALIZED (
    SELECT c.current_listing_key,c.source_timestamp,1::smallint listing_lane
    FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id
      AND (c.parent_raw_text_sha256 IS NULL
        OR c.exact_child_text_sha256 IS DISTINCT FROM c.parent_raw_text_sha256)
      AND (p_listing_lane IS NULL OR p_listing_lane=1)
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (NULLIF(btrim(p_search),'') IS NULL
        OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
      AND (NOT p_priced_only OR c.price_verified OR EXISTS (
        SELECT 1 FROM public.curated_luxury_rolex_latest_price_evidence_v2 p
        WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
          AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
          AND p.decision='VERIFIED' AND p.display_price_verified))
      AND (NOT p_images_only OR EXISTS (
        SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
      AND (p_after_key IS NULL OR p_after_lane=0 OR (p_after_lane=1 AND (
        (p_after_timestamp_is_null AND c.source_timestamp IS NULL
          AND c.current_listing_key<p_after_key)
        OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
          c.source_timestamp<p_after_timestamp
          OR (c.source_timestamp=p_after_timestamp AND c.current_listing_key<p_after_key)
          OR c.source_timestamp IS NULL)))))
    ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)+1
  ), candidates AS MATERIALIZED (
    SELECT * FROM single_candidates
    UNION ALL
    SELECT * FROM multi_candidates
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

NOTIFY pgrst,'reload schema';
