-- Customer projection for the completed raw-first Rolex/Patek shadow cohort.
-- Read-only over immutable source evidence; no production source selector is changed here.

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_offer_state_idx
  ON public.curated_luxury_current_listings_shadow (run_id, offer_state_key);
CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_demand_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, brand, observed_reference_key, intent, current_status);

CREATE TABLE IF NOT EXISTS public.curated_luxury_raw_parent_lineage_shadow (
  parent_key text PRIMARY KEY,
  raw_message_id uuid NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS public.curated_luxury_raw_version_lineage_shadow (
  version_key text PRIMARY KEY,
  raw_version_id uuid NOT NULL UNIQUE
);
ALTER TABLE public.curated_luxury_raw_parent_lineage_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_raw_version_lineage_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_raw_parent_lineage_shadow FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.curated_luxury_raw_version_lineage_shadow FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.curated_luxury_raw_parent_lineage_shadow TO service_role;
GRANT ALL ON public.curated_luxury_raw_version_lineage_shadow TO service_role;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_reference_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  WITH selected AS MATERIALIZED (
    SELECT c.*
    FROM public.curated_luxury_current_listings_shadow c
    JOIN public.curated_luxury_shadow_runs r USING (run_id)
    WHERE c.run_id = p_run_id AND r.status = 'COMPLETE'
      AND c.current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
      AND (p_brands IS NULL OR c.brand = ANY(p_brands))
      AND (p_intents IS NULL OR c.intent = ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code = ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (NOT p_images_only OR c.image_linked)
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (NULLIF(regexp_replace(upper(coalesce(p_search, '')), '[^A-Z0-9]', '', 'g'), '') IS NULL
        OR regexp_replace(upper(c.search_text), '[^A-Z0-9]', '', 'g') LIKE
          '%' || regexp_replace(upper(p_search), '[^A-Z0-9]', '', 'g') || '%')
    ORDER BY c.source_timestamp DESC NULLS LAST, c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
    OFFSET greatest(coalesce(p_offset, 0), 0)
  ), parent_rows AS MATERIALIZED (
    SELECT bridge.parent_key,rm.*
    FROM public.curated_luxury_raw_parent_lineage_shadow bridge
    JOIN public.raw_messages rm ON rm.id=bridge.raw_message_id
    WHERE bridge.parent_key=ANY(ARRAY(SELECT parent_key FROM selected))
  ), version_rows AS MATERIALIZED (
    SELECT bridge.version_key,rv.*
    FROM public.curated_luxury_raw_version_lineage_shadow bridge
    JOIN public.raw_message_versions rv ON rv.id=bridge.raw_version_id
    WHERE bridge.version_key=ANY(ARRAY(SELECT version_key FROM selected))
  ), dealer_rows AS MATERIALIZED (
    SELECT d.* FROM public.dealers d
    WHERE encode(extensions.digest(convert_to(d.id::text, 'UTF8'), 'sha256'), 'hex')
      = ANY(ARRAY(SELECT dealer_key FROM selected WHERE dealer_key IS NOT NULL))
  )
  SELECT jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
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
    'dealer_rating', CASE WHEN c.dealer_rating_qualified AND d.status='VERIFIED'
      AND d.review_count > 0 THEN d.rating ELSE NULL END,
    'dealer_review_count', CASE WHEN c.dealer_rating_qualified AND d.status='VERIFIED'
      AND d.review_count > 0 THEN d.review_count ELSE NULL END,
    'contact_publication_approved', coalesce(d.contact_consent, false)
  ) ORDER BY c.source_timestamp DESC NULLS LAST, c.current_listing_key DESC), '[]'::jsonb))
  FROM selected c
  LEFT JOIN parent_rows rm ON rm.parent_key=c.parent_key
  LEFT JOIN version_rows rv ON rv.version_key=c.version_key
    AND rv.raw_message_id = rm.id
  LEFT JOIN dealer_rows d ON encode(extensions.digest(convert_to(d.id::text, 'UTF8'), 'sha256'), 'hex') = c.dealer_key;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_count(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_reference_key text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)
  FROM public.curated_luxury_current_listings_shadow c
  JOIN public.curated_luxury_shadow_runs r USING (run_id)
  WHERE c.run_id = p_run_id AND r.status='COMPLETE'
    AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
    AND (p_brands IS NULL OR c.brand = ANY(p_brands))
    AND (p_intents IS NULL OR c.intent = ANY(p_intents))
    AND (p_countries IS NULL OR c.country_code = ANY(p_countries))
    AND (NOT p_priced_only OR c.price_verified)
    AND (NOT p_images_only OR c.image_linked)
    AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
    AND (NULLIF(regexp_replace(upper(coalesce(p_search, '')), '[^A-Z0-9]', '', 'g'), '') IS NULL
      OR regexp_replace(upper(c.search_text), '[^A-Z0-9]', '', 'g') LIKE
        '%' || regexp_replace(upper(p_search), '[^A-Z0-9]', '', 'g') || '%');
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_price_research(
  p_run_id uuid,
  p_brand text,
  p_reference_key text,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  WITH permitted AS (
    SELECT 1 FROM public.curated_luxury_shadow_runs
    WHERE run_id=p_run_id AND status='COMPLETE'
  ), all_prices AS MATERIALIZED (
    SELECT o.* FROM public.curated_luxury_offer_states_shadow o, permitted
    WHERE o.run_id=p_run_id AND o.brand=p_brand
      AND o.observed_reference_key=p_reference_key AND o.qualified_price_research
  ), page_prices AS MATERIALIZED (
    SELECT * FROM all_prices ORDER BY last_seen DESC, offer_state_key DESC
    LIMIT least(greatest(coalesce(p_limit,100),1),100) OFFSET greatest(coalesce(p_offset,0),0)
  ), stats AS (
    SELECT count(*)::bigint count, avg(normalized_usd_amount) avg,
      percentile_cont(.25) WITHIN GROUP (ORDER BY normalized_usd_amount) q1,
      percentile_cont(.5) WITHIN GROUP (ORDER BY normalized_usd_amount) median,
      percentile_cont(.75) WITHIN GROUP (ORDER BY normalized_usd_amount) q3,
      min(normalized_usd_amount) min, max(normalized_usd_amount) max,
      coalesce(sum(repost_same_offer_count),0)::bigint repost_count
    FROM all_prices
  ), demand AS (
    SELECT count(*)::bigint count FROM public.curated_luxury_current_listings_shadow c, permitted
    WHERE c.run_id=p_run_id AND c.brand=p_brand AND c.observed_reference_key=p_reference_key
      AND c.intent='WTB' AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
  )
  SELECT jsonb_build_object(
    'stats', to_jsonb(stats), 'wtb_count', demand.count,
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', p.offer_state_key, 'brand', p.brand, 'reference_key', p.observed_reference_key,
      'source_price_amount', p.source_price_amount, 'source_currency', p.source_currency,
      'price_usd', p.normalized_usd_amount, 'created_at', p.last_seen,
      'occurrence_count', p.occurrence_count, 'repost_count', p.repost_same_offer_count,
      'listing_type', 'WTS'
    ) ORDER BY p.last_seen DESC, p.offer_state_key DESC)
      FROM page_prices p), '[]'::jsonb)
  ) FROM stats CROSS JOIN demand;
$$;

REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_page(uuid,text[],text[],text[],boolean,boolean,text,integer,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_count(uuid,text[],text[],text[],boolean,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_price_research(uuid,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_page(uuid,text[],text[],text[],boolean,boolean,text,integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_count(uuid,text[],text[],text[],boolean,boolean,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_price_research(uuid,text,text,integer,integer) TO service_role;
