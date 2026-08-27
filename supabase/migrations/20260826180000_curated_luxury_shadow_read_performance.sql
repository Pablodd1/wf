-- Bounded customer reads for the already-complete Rolex/Patek shadow cohort.
-- This migration does not update, reload, or reclassify any cohort row.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_feed_v2_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, brand, source_timestamp DESC NULLS LAST, current_listing_key DESC)
  WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE');

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_country_feed_v2_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, brand, country_code, source_timestamp DESC NULLS LAST, current_listing_key DESC)
  WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE');

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_intent_feed_v2_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, brand, intent, source_timestamp DESC NULLS LAST, current_listing_key DESC)
  WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE');

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_reference_feed_v2_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, brand, observed_reference_key, source_timestamp DESC NULLS LAST, current_listing_key DESC)
  WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE');

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_priced_feed_v2_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, brand, source_timestamp DESC NULLS LAST, current_listing_key DESC)
  WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE') AND price_verified;

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_images_feed_v2_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, brand, source_timestamp DESC NULLS LAST, current_listing_key DESC)
  WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE') AND image_linked;

-- search_text is already immutable normalized projection data. Its indexed uppercase
-- form avoids regex work over the cohort during every customer request.
CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_search_v2_idx
  ON public.curated_luxury_current_listings_shadow USING gin
  (run_id, brand, (upper(search_text)) extensions.gin_trgm_ops)
  WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE');

CREATE TABLE IF NOT EXISTS public.curated_luxury_current_facets_shadow (
  run_id uuid NOT NULL REFERENCES public.curated_luxury_shadow_runs(run_id) ON DELETE CASCADE,
  brand text NOT NULL,
  intent_key text NOT NULL,
  country_key text NOT NULL,
  price_verified boolean NOT NULL,
  image_linked boolean NOT NULL,
  listing_count bigint NOT NULL CHECK (listing_count >= 0),
  PRIMARY KEY (run_id, brand, intent_key, country_key, price_verified, image_linked)
);
ALTER TABLE public.curated_luxury_current_facets_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_current_facets_shadow FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.curated_luxury_current_facets_shadow TO service_role;

INSERT INTO public.curated_luxury_current_facets_shadow
  (run_id, brand, intent_key, country_key, price_verified, image_linked, listing_count)
SELECT run_id, brand, coalesce(intent, ''), coalesce(country_code, ''),
  price_verified, image_linked, count(*)::bigint
FROM public.curated_luxury_current_listings_shadow
WHERE current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
GROUP BY run_id, brand, coalesce(intent, ''), coalesce(country_code, ''),
  price_verified, image_linked
ON CONFLICT (run_id, brand, intent_key, country_key, price_verified, image_linked)
DO UPDATE SET listing_count = EXCLUDED.listing_count;

CREATE TABLE IF NOT EXISTS public.curated_luxury_dealer_lineage_shadow (
  dealer_key text PRIMARY KEY,
  dealer_id uuid NOT NULL UNIQUE REFERENCES public.dealers(id) ON DELETE CASCADE
);
ALTER TABLE public.curated_luxury_dealer_lineage_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_dealer_lineage_shadow FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.curated_luxury_dealer_lineage_shadow TO service_role;

INSERT INTO public.curated_luxury_dealer_lineage_shadow (dealer_key, dealer_id)
SELECT encode(extensions.digest(convert_to(d.id::text, 'UTF8'), 'sha256'), 'hex'), d.id
FROM public.dealers d
ON CONFLICT (dealer_key) DO UPDATE SET dealer_id = EXCLUDED.dealer_id;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page_v2(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_reference_key text DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,
  p_after_key text DEFAULT NULL,
  p_after_timestamp_is_null boolean DEFAULT false,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
  WITH candidates AS MATERIALIZED (
    SELECT c.*
    FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id = p_run_id
      AND EXISTS (
        SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id = p_run_id AND r.status = 'COMPLETE'
      )
      AND c.current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
      AND (p_brands IS NULL OR c.brand = ANY(p_brands))
      AND (p_intents IS NULL OR c.intent = ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code = ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (NOT p_images_only OR c.image_linked)
      AND (p_reference_key IS NULL OR c.observed_reference_key = p_reference_key)
      AND (NULLIF(btrim(p_search), '') IS NULL
        OR upper(c.search_text) LIKE '%' || upper(btrim(p_search)) || '%')
      AND (
        p_after_key IS NULL
        OR (p_after_timestamp_is_null AND c.source_timestamp IS NULL
          AND c.current_listing_key < p_after_key)
        OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
          c.source_timestamp < p_after_timestamp
          OR (c.source_timestamp = p_after_timestamp AND c.current_listing_key < p_after_key)
          OR c.source_timestamp IS NULL
        ))
      )
    ORDER BY c.source_timestamp DESC NULLS LAST, c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100) + 1
  ), selected AS MATERIALIZED (
    SELECT * FROM candidates
    ORDER BY source_timestamp DESC NULLS LAST, current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  ), parent_rows AS MATERIALIZED (
    SELECT DISTINCT s.parent_key, rm.id, rm.raw_text, rm.source_platform
    FROM selected s
    JOIN public.curated_luxury_raw_parent_lineage_shadow bridge
      ON bridge.parent_key = s.parent_key
    JOIN public.raw_messages rm ON rm.id = bridge.raw_message_id
  ), version_rows AS MATERIALIZED (
    SELECT DISTINCT s.version_key, rv.raw_message_id, rv.raw_text, rv.media
    FROM selected s
    JOIN public.curated_luxury_raw_version_lineage_shadow bridge
      ON bridge.version_key = s.version_key
    JOIN public.raw_message_versions rv ON rv.id = bridge.raw_version_id
  ), dealer_rows AS MATERIALIZED (
    SELECT bridge.dealer_key, d.*
    FROM (SELECT DISTINCT dealer_key FROM selected WHERE dealer_key IS NOT NULL) s
    JOIN public.curated_luxury_dealer_lineage_shadow bridge USING (dealer_key)
    JOIN public.dealers d ON d.id = bridge.dealer_id
  ), page_rows AS (
    SELECT jsonb_build_object(
      'id', c.current_listing_key,
      'brand', c.brand,
      'reference', c.observed_reference,
      'reference_key', c.observed_reference_key,
      'listing_type', c.intent,
      'condition', c.condition_as_observed,
      'dial_color', c.dial_or_color_as_observed,
      'created_at', c.source_timestamp,
      'source_price_amount', c.source_price_amount,
      'source_currency', c.source_currency,
      'price_usd', CASE WHEN c.price_verified THEN c.normalized_usd_amount ELSE NULL END,
      'price_verified', c.price_verified,
      'raw_message', coalesce(rv.raw_text, rm.raw_text),
      'raw_media', coalesce(rv.media, '[]'::jsonb),
      'has_images', c.image_linked,
      'country_code', c.country_code,
      'current_status', c.current_status,
      'cohort_status', c.cohort_status,
      'source_platform', rm.source_platform,
      'source_identity_key', c.source_identity_key,
      'dealer_id', d.id,
      'dealer_name', coalesce(d.display_name, d.company_name),
      'dealer_slug', d.slug,
      'dealer_rating', CASE WHEN c.dealer_rating_qualified AND d.status = 'VERIFIED'
        AND d.review_count > 0 THEN d.rating ELSE NULL END,
      'dealer_review_count', CASE WHEN c.dealer_rating_qualified AND d.status = 'VERIFIED'
        AND d.review_count > 0 THEN d.review_count ELSE NULL END,
      'contact_publication_approved', coalesce(d.contact_consent, false)
    ) AS row_data, c.source_timestamp, c.current_listing_key
    FROM selected c
    LEFT JOIN parent_rows rm ON rm.parent_key = c.parent_key
    LEFT JOIN version_rows rv ON rv.version_key = c.version_key AND rv.raw_message_id = rm.id
    LEFT JOIN dealer_rows d ON d.dealer_key = c.dealer_key
  ), last_row AS (
    SELECT source_timestamp, current_listing_key
    FROM selected
    ORDER BY source_timestamp ASC NULLS FIRST, current_listing_key ASC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(row_data ORDER BY source_timestamp DESC NULLS LAST,
      current_listing_key DESC) FROM page_rows), '[]'::jsonb),
    'has_more', (SELECT count(*) FROM candidates) > least(greatest(coalesce(p_limit, 50), 1), 100),
    'next_timestamp', (SELECT source_timestamp FROM last_row),
    'next_key', (SELECT current_listing_key FROM last_row),
    'next_timestamp_is_null', (SELECT source_timestamp IS NULL FROM last_row)
  );
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_count_v2(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_reference_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_total bigint;
  v_search_key text := NULLIF(upper(btrim(coalesce(p_search, ''))), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.curated_luxury_shadow_runs
    WHERE run_id = p_run_id AND status = 'COMPLETE'
  ) THEN
    RETURN jsonb_build_object('total', 0, 'exact', true, 'source', 'complete_gate');
  END IF;

  IF v_search_key IS NOT NULL OR p_reference_key IS NOT NULL THEN
    SELECT count(*) INTO v_total
    FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id = p_run_id
      AND c.current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
      AND (p_brands IS NULL OR c.brand = ANY(p_brands))
      AND (p_intents IS NULL OR c.intent = ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code = ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (NOT p_images_only OR c.image_linked)
      AND (p_reference_key IS NULL OR c.observed_reference_key = p_reference_key)
      AND (v_search_key IS NULL OR upper(c.search_text) LIKE '%' || v_search_key || '%');
    RETURN jsonb_build_object('total', v_total, 'exact', true,
      'source', CASE WHEN p_reference_key IS NOT NULL THEN 'reference_index' ELSE 'search_index' END);
  END IF;

  SELECT coalesce(sum(f.listing_count), 0)::bigint INTO v_total
  FROM public.curated_luxury_current_facets_shadow f
  WHERE f.run_id = p_run_id
    AND (p_brands IS NULL OR f.brand = ANY(p_brands))
    AND (p_intents IS NULL OR f.intent_key = ANY(p_intents))
    AND (p_countries IS NULL OR f.country_key = ANY(p_countries))
    AND (NOT p_priced_only OR f.price_verified)
    AND (NOT p_images_only OR f.image_linked);
  RETURN jsonb_build_object('total', v_total, 'exact', true, 'source', 'materialized_facets');
END;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page_keys_v3(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_reference_key text DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,
  p_after_key text DEFAULT NULL,
  p_after_timestamp_is_null boolean DEFAULT false,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
  WITH candidates AS MATERIALIZED (
    SELECT c.current_listing_key, c.source_timestamp
    FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id = p_run_id
      AND EXISTS (
        SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id = p_run_id AND r.status = 'COMPLETE'
      )
      AND c.current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
      AND (p_brands IS NULL OR c.brand = ANY(p_brands))
      AND (p_intents IS NULL OR c.intent = ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code = ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (NOT p_images_only OR c.image_linked)
      AND (p_reference_key IS NULL OR c.observed_reference_key = p_reference_key)
      AND (NULLIF(btrim(p_search), '') IS NULL
        OR upper(c.search_text) LIKE '%' || upper(btrim(p_search)) || '%')
      AND (
        p_after_key IS NULL
        OR (p_after_timestamp_is_null AND c.source_timestamp IS NULL
          AND c.current_listing_key < p_after_key)
        OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
          c.source_timestamp < p_after_timestamp
          OR (c.source_timestamp = p_after_timestamp AND c.current_listing_key < p_after_key)
          OR c.source_timestamp IS NULL
        ))
      )
    ORDER BY c.source_timestamp DESC NULLS LAST, c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100) + 1
  ), selected AS MATERIALIZED (
    SELECT * FROM candidates
    ORDER BY source_timestamp DESC NULLS LAST, current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  ), last_row AS (
    SELECT source_timestamp, current_listing_key FROM selected
    ORDER BY source_timestamp ASC NULLS FIRST, current_listing_key ASC LIMIT 1
  )
  SELECT jsonb_build_object(
    'keys', coalesce((SELECT jsonb_agg(current_listing_key ORDER BY source_timestamp DESC NULLS LAST,
      current_listing_key DESC) FROM selected), '[]'::jsonb),
    'has_more', (SELECT count(*) FROM candidates) > least(greatest(coalesce(p_limit, 50), 1), 100),
    'next_timestamp', (SELECT source_timestamp FROM last_row),
    'next_key', (SELECT current_listing_key FROM last_row),
    'next_timestamp_is_null', (SELECT source_timestamp IS NULL FROM last_row)
  );
$$;

-- Replace the SQL-language key function with a branch-specific dynamic plan.
-- Optional-predicate OR expressions caused PostgREST's cached function plan to
-- ignore the ordered partial indexes even though the equivalent direct SQL was fast.
CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page_keys_v3(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_reference_key text DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,
  p_after_key text DEFAULT NULL,
  p_after_timestamp_is_null boolean DEFAULT false,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_sql text;
  v_result jsonb;
BEGIN
  v_sql := $query$
    WITH candidates AS MATERIALIZED (
      SELECT c.current_listing_key, c.source_timestamp
      FROM public.curated_luxury_current_listings_shadow c
      WHERE c.run_id = $1
        AND c.current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
        AND EXISTS (
          SELECT 1 FROM public.curated_luxury_shadow_runs r
          WHERE r.run_id = $1 AND r.status = 'COMPLETE'
        )
  $query$;
  IF p_brands IS NOT NULL THEN v_sql := v_sql || ' AND c.brand = ANY($2)'; END IF;
  IF p_intents IS NOT NULL THEN v_sql := v_sql || ' AND c.intent = ANY($3)'; END IF;
  IF p_countries IS NOT NULL THEN v_sql := v_sql || ' AND c.country_code = ANY($4)'; END IF;
  IF p_priced_only THEN v_sql := v_sql || ' AND c.price_verified'; END IF;
  IF p_images_only THEN v_sql := v_sql || ' AND c.image_linked'; END IF;
  IF p_reference_key IS NOT NULL THEN
    v_sql := v_sql || ' AND c.observed_reference_key = $8';
  END IF;
  IF NULLIF(btrim(p_search), '') IS NOT NULL THEN
    v_sql := v_sql || ' AND upper(c.search_text) LIKE ''%'' || upper(btrim($7)) || ''%''';
  END IF;
  IF p_after_key IS NOT NULL AND p_after_timestamp_is_null THEN
    v_sql := v_sql || ' AND c.source_timestamp IS NULL AND c.current_listing_key < $10';
  ELSIF p_after_key IS NOT NULL AND p_after_timestamp IS NOT NULL THEN
    v_sql := v_sql || $cursor$
      AND (c.source_timestamp < $9
        OR (c.source_timestamp = $9 AND c.current_listing_key < $10)
        OR c.source_timestamp IS NULL)
    $cursor$;
  END IF;
  v_sql := v_sql || $tail$
      ORDER BY c.source_timestamp DESC NULLS LAST, c.current_listing_key DESC
      LIMIT least(greatest(coalesce($12, 50), 1), 100) + 1
    ), selected AS MATERIALIZED (
      SELECT * FROM candidates
      ORDER BY source_timestamp DESC NULLS LAST, current_listing_key DESC
      LIMIT least(greatest(coalesce($12, 50), 1), 100)
    ), last_row AS (
      SELECT source_timestamp, current_listing_key FROM selected
      ORDER BY source_timestamp ASC NULLS FIRST, current_listing_key ASC LIMIT 1
    )
    SELECT jsonb_build_object(
      'keys', coalesce((SELECT jsonb_agg(current_listing_key
        ORDER BY source_timestamp DESC NULLS LAST, current_listing_key DESC) FROM selected), '[]'::jsonb),
      'has_more', (SELECT count(*) FROM candidates) > least(greatest(coalesce($12, 50), 1), 100),
      'next_timestamp', (SELECT source_timestamp FROM last_row),
      'next_key', (SELECT current_listing_key FROM last_row),
      'next_timestamp_is_null', (SELECT source_timestamp IS NULL FROM last_row)
    )
  $tail$;
  EXECUTE v_sql INTO v_result USING p_run_id, p_brands, p_intents, p_countries,
    p_priced_only, p_images_only, p_search, p_reference_key, p_after_timestamp,
    p_after_key, p_after_timestamp_is_null, p_limit;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_cards_v3(
  p_run_id uuid,
  p_listing_keys text[]
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
  WITH selected AS MATERIALIZED (
    SELECT c.*
    FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id = p_run_id
      AND cardinality(p_listing_keys) BETWEEN 1 AND 100
      AND c.current_listing_key = ANY(p_listing_keys)
      AND c.current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
      AND EXISTS (
        SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id = p_run_id AND r.status = 'COMPLETE'
      )
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.current_listing_key,
    'brand', c.brand,
    'reference', c.observed_reference,
    'reference_key', c.observed_reference_key,
    'listing_type', c.intent,
    'condition', c.condition_as_observed,
    'dial_color', c.dial_or_color_as_observed,
    'created_at', c.source_timestamp,
    'source_price_amount', c.source_price_amount,
    'source_currency', c.source_currency,
    'price_usd', CASE WHEN c.price_verified THEN c.normalized_usd_amount ELSE NULL END,
    'price_verified', c.price_verified,
    'raw_message', coalesce(rv.raw_text, rm.raw_text),
    'raw_media', coalesce(rv.media, '[]'::jsonb),
    'has_images', c.image_linked,
    'country_code', c.country_code,
    'current_status', c.current_status,
    'cohort_status', c.cohort_status,
    'source_platform', rm.source_platform,
    'source_identity_key', c.source_identity_key,
    'dealer_id', d.id,
    'dealer_name', coalesce(d.display_name, d.company_name),
    'dealer_slug', d.slug,
    'dealer_rating', CASE WHEN c.dealer_rating_qualified AND d.status = 'VERIFIED'
      AND d.review_count > 0 THEN d.rating ELSE NULL END,
    'dealer_review_count', CASE WHEN c.dealer_rating_qualified AND d.status = 'VERIFIED'
      AND d.review_count > 0 THEN d.review_count ELSE NULL END,
    'contact_publication_approved', coalesce(d.contact_consent, false)
  ) ORDER BY c.source_timestamp DESC NULLS LAST, c.current_listing_key DESC), '[]'::jsonb)
  FROM selected c
  LEFT JOIN LATERAL (
    SELECT rm.id, rm.raw_text, rm.source_platform
    FROM public.curated_luxury_raw_parent_lineage_shadow bridge
    JOIN public.raw_messages rm ON rm.id = bridge.raw_message_id
    WHERE bridge.parent_key = c.parent_key
    LIMIT 1
  ) rm ON true
  LEFT JOIN LATERAL (
    SELECT rv.raw_text, rv.media
    FROM public.curated_luxury_raw_version_lineage_shadow bridge
    JOIN public.raw_message_versions rv ON rv.id = bridge.raw_version_id
    WHERE bridge.version_key = c.version_key AND rv.raw_message_id = rm.id
    LIMIT 1
  ) rv ON true
  LEFT JOIN LATERAL (
    SELECT d.*
    FROM public.curated_luxury_dealer_lineage_shadow bridge
    JOIN public.dealers d ON d.id = bridge.dealer_id
    WHERE bridge.dealer_key = c.dealer_key
    LIMIT 1
  ) d ON true;
$$;

DROP FUNCTION IF EXISTS public.curated_luxury_shadow_customer_page_v2(
  uuid, text[], text[], text[], boolean, boolean, text, text,
  timestamptz, text, boolean, integer);
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_count_v2(
  uuid, text[], text[], text[], boolean, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v3(
  uuid, text[], text[], text[], boolean, boolean, text, text,
  timestamptz, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_cards_v3(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_count_v2(
  uuid, text[], text[], text[], boolean, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v3(
  uuid, text[], text[], text[], boolean, boolean, text, text,
  timestamptz, text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_cards_v3(uuid, text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
