-- Additive Rolex/Patek card evidence contract. This migration does not alter the
-- frozen cohort or any raw/source row, and does not change a customer selector.

CREATE TABLE IF NOT EXISTS public.curated_luxury_card_model_evidence_shadow (
  run_id uuid NOT NULL,
  current_listing_key text NOT NULL,
  latest_raw_occurrence_key text NOT NULL,
  exact_child_text_sha256 text NOT NULL CHECK (exact_child_text_sha256~'^[0-9a-f]{64}$'),
  brand text NOT NULL CHECK (brand IN ('Rolex','Patek Philippe')),
  observed_reference_key text,
  model text NOT NULL CHECK (btrim(model)<>''),
  model_evidence_type text NOT NULL CHECK (model_evidence_type IN
    ('FROZEN_SOURCE_MODEL_AS_POSTED','CATALOG_EXACT_BRAND_REFERENCE')),
  evidence_version text NOT NULL,
  source_artifact_id text NOT NULL,
  source_artifact_sha256 text NOT NULL CHECK (source_artifact_sha256~'^[0-9a-f]{64}$'),
  evidence_checksum text NOT NULL CHECK (evidence_checksum~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,current_listing_key,latest_raw_occurrence_key,evidence_version),
  FOREIGN KEY (run_id,current_listing_key)
    REFERENCES public.curated_luxury_current_listings_shadow(run_id,current_listing_key)
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_historical_fx_rates_shadow (
  provider text NOT NULL CHECK (provider='ECB'),
  source_currency text NOT NULL,
  effective_date date NOT NULL,
  rate_direction text NOT NULL CHECK (rate_direction='USD_PER_SOURCE_UNIT'),
  usd_per_source_unit numeric NOT NULL CHECK (usd_per_source_unit>0),
  source_url text NOT NULL CHECK (source_url LIKE 'https://data-api.ecb.europa.eu/%'),
  source_response_sha256 text NOT NULL CHECK (source_response_sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider,source_currency,effective_date)
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_card_price_evidence_shadow (
  run_id uuid NOT NULL,
  current_listing_key text NOT NULL,
  offer_state_key text NOT NULL,
  latest_raw_occurrence_key text NOT NULL,
  exact_child_text_sha256 text NOT NULL CHECK (exact_child_text_sha256~'^[0-9a-f]{64}$'),
  evidence_version text NOT NULL,
  source_price_amount numeric NOT NULL CHECK (source_price_amount>0),
  source_currency text NOT NULL,
  normalized_usd_amount numeric NOT NULL CHECK (normalized_usd_amount>0),
  price_evidence_classification text NOT NULL CHECK (price_evidence_classification IN
    ('SOURCE_EXPLICIT_USD_MATCH','SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX')),
  display_price_verified boolean NOT NULL CHECK (display_price_verified),
  price_research_eligible boolean NOT NULL DEFAULT false,
  fx_provider text,
  fx_source_url text,
  fx_applicable_date date,
  fx_effective_date date,
  fx_lookback_days integer,
  fx_rate_direction text,
  fx_rate numeric,
  evidence_checksum text NOT NULL CHECK (evidence_checksum~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,current_listing_key,latest_raw_occurrence_key,evidence_version),
  FOREIGN KEY (run_id,current_listing_key)
    REFERENCES public.curated_luxury_current_listings_shadow(run_id,current_listing_key),
  CHECK (price_evidence_classification<>'DATED_VERIFIED_FX' OR (
    fx_provider='ECB' AND fx_source_url LIKE 'https://data-api.ecb.europa.eu/%'
    AND fx_applicable_date IS NOT NULL AND fx_effective_date IS NOT NULL
    AND fx_lookback_days BETWEEN 0 AND 7
    AND fx_rate_direction='USD_PER_SOURCE_UNIT' AND fx_rate>0
  )),
  CHECK (price_evidence_classification='DATED_VERIFIED_FX'
    OR upper(source_currency) IN ('USD','USDT'))
);

CREATE INDEX IF NOT EXISTS curated_luxury_card_model_evidence_latest_idx
  ON public.curated_luxury_card_model_evidence_shadow
  (run_id,current_listing_key,latest_raw_occurrence_key,created_at DESC,evidence_version DESC);
CREATE INDEX IF NOT EXISTS curated_luxury_card_price_evidence_latest_idx
  ON public.curated_luxury_card_price_evidence_shadow
  (run_id,current_listing_key,latest_raw_occurrence_key,created_at DESC,evidence_version DESC);
CREATE INDEX IF NOT EXISTS curated_luxury_card_price_evidence_pr_idx
  ON public.curated_luxury_card_price_evidence_shadow
  (run_id,offer_state_key,created_at DESC)
  WHERE price_research_eligible;

ALTER TABLE public.curated_luxury_card_model_evidence_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_historical_fx_rates_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_card_price_evidence_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_card_model_evidence_shadow FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.curated_luxury_historical_fx_rates_shadow FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.curated_luxury_card_price_evidence_shadow FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.curated_luxury_card_model_evidence_shadow TO service_role;
GRANT SELECT,INSERT ON public.curated_luxury_historical_fx_rates_shadow TO service_role;
GRANT SELECT,INSERT ON public.curated_luxury_card_price_evidence_shadow TO service_role;

CREATE OR REPLACE FUNCTION public.curated_luxury_reject_evidence_mutation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'Curated Luxury evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS curated_luxury_card_model_evidence_append_only
  ON public.curated_luxury_card_model_evidence_shadow;
CREATE TRIGGER curated_luxury_card_model_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.curated_luxury_card_model_evidence_shadow
  FOR EACH ROW EXECUTE FUNCTION public.curated_luxury_reject_evidence_mutation_v1();
DROP TRIGGER IF EXISTS curated_luxury_historical_fx_rates_append_only
  ON public.curated_luxury_historical_fx_rates_shadow;
CREATE TRIGGER curated_luxury_historical_fx_rates_append_only
  BEFORE UPDATE OR DELETE ON public.curated_luxury_historical_fx_rates_shadow
  FOR EACH ROW EXECUTE FUNCTION public.curated_luxury_reject_evidence_mutation_v1();
DROP TRIGGER IF EXISTS curated_luxury_card_price_evidence_append_only
  ON public.curated_luxury_card_price_evidence_shadow;
CREATE TRIGGER curated_luxury_card_price_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.curated_luxury_card_price_evidence_shadow
  FOR EACH ROW EXECUTE FUNCTION public.curated_luxury_reject_evidence_mutation_v1();

CREATE OR REPLACE VIEW public.curated_luxury_latest_card_model_evidence_v1
WITH (security_invoker=true) AS
SELECT * FROM (
  SELECT e.*,row_number() OVER (PARTITION BY run_id,current_listing_key,latest_raw_occurrence_key
    ORDER BY created_at DESC,evidence_version DESC) evidence_rank
  FROM public.curated_luxury_card_model_evidence_shadow e
) ranked WHERE evidence_rank=1;

CREATE OR REPLACE VIEW public.curated_luxury_latest_card_price_evidence_v1
WITH (security_invoker=true) AS
SELECT * FROM (
  SELECT e.*,row_number() OVER (PARTITION BY run_id,current_listing_key,latest_raw_occurrence_key
    ORDER BY created_at DESC,evidence_version DESC) evidence_rank
  FROM public.curated_luxury_card_price_evidence_shadow e
) ranked WHERE evidence_rank=1;

REVOKE ALL ON public.curated_luxury_latest_card_model_evidence_v1 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.curated_luxury_latest_card_price_evidence_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.curated_luxury_latest_card_model_evidence_v1 TO service_role;
GRANT SELECT ON public.curated_luxury_latest_card_price_evidence_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_cards_v5(
  p_run_id uuid,p_listing_keys text[]
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions
SET plan_cache_mode='force_custom_plan' AS $$
  WITH selected AS MATERIALIZED (
    SELECT c.* FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id=p_run_id AND c.brand IN ('Rolex','Patek Philippe')
      AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND cardinality(p_listing_keys) BETWEEN 1 AND 100
      AND c.current_listing_key=ANY(p_listing_keys)
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
      AND NOT EXISTS (
        SELECT 1 FROM public.curated_luxury_current_listings_shadow duplicate
        WHERE duplicate.run_id=c.run_id AND duplicate.brand=c.brand
          AND duplicate.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
          AND duplicate.current_listing_key<c.current_listing_key
          AND (duplicate.offer_state_key=c.offer_state_key
            OR duplicate.unique_observation_key=c.unique_observation_key))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',c.current_listing_key,'brand',c.brand,'model',m.model,
    'model_evidence_type',m.model_evidence_type,
    'reference',c.observed_reference,'reference_key',c.observed_reference_key,
    'listing_type',c.intent,'condition',c.condition_as_observed,
    'dial_color',c.dial_or_color_as_observed,'created_at',c.source_timestamp,
    'source_price_amount',coalesce(p.source_price_amount,c.source_price_amount),
    'source_currency',coalesce(p.source_currency,c.source_currency),
    'price_usd',CASE WHEN c.price_verified THEN c.normalized_usd_amount ELSE p.normalized_usd_amount END,
    'price_verified',(c.price_verified OR coalesce(p.display_price_verified,false)),
    'price_display_verified',(c.price_verified OR coalesce(p.display_price_verified,false)),
    'price_evidence_classification',CASE WHEN c.price_verified THEN
      CASE WHEN upper(coalesce(c.source_currency,''))='USDT' THEN 'SOURCE_EXPLICIT_USD_USDT'
        WHEN upper(coalesce(c.source_currency,''))='USD' THEN 'SOURCE_EXPLICIT_USD_MATCH'
        ELSE 'DATED_VERIFIED_FX' END ELSE p.price_evidence_classification END,
    'price_requires_review',(NOT c.price_verified AND p.current_listing_key IS NULL),
    'price_research_eligible',(c.intent='WTS' AND c.observed_reference_key IS NOT NULL
      AND (c.price_verified OR coalesce(p.price_research_eligible,false))),
    'raw_message',coalesce(rv.raw_text,rm.raw_text),
    'source_poster_name',poster.name,
    'verified_child_media',coalesce(images.urls,'[]'::jsonb),
    'image_state',CASE WHEN coalesce(jsonb_array_length(images.urls)>0,false)
      THEN 'VERIFIED_CHILD_IMAGE' ELSE 'NO_VERIFIED_CHILD_IMAGE' END,
    'country_code',c.country_code,'current_status',c.current_status,'cohort_status',c.cohort_status,
    'source_platform',rm.source_platform,'source_identity_key',c.source_identity_key,
    'dealer_id',d.id,'dealer_name',coalesce(d.display_name,d.company_name),'dealer_slug',d.slug,
    'dealer_rating',CASE WHEN c.dealer_rating_qualified AND d.status='VERIFIED' AND d.review_count>0
      THEN d.rating ELSE NULL END,
    'dealer_review_count',CASE WHEN c.dealer_rating_qualified AND d.status='VERIFIED' AND d.review_count>0
      THEN d.review_count ELSE NULL END,
    'contact_publication_approved',coalesce(d.contact_consent,false)
  ) ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC),'[]'::jsonb)
  FROM selected c
  LEFT JOIN public.curated_luxury_latest_card_model_evidence_v1 m
    ON m.run_id=c.run_id AND m.current_listing_key=c.current_listing_key
   AND m.latest_raw_occurrence_key=c.latest_raw_occurrence_key
   AND m.exact_child_text_sha256=c.exact_child_text_sha256 AND m.brand=c.brand
  LEFT JOIN public.curated_luxury_latest_card_price_evidence_v1 p
    ON p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
   AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
   AND p.exact_child_text_sha256=c.exact_child_text_sha256
  LEFT JOIN LATERAL (
    SELECT rm.id,rm.raw_text,rm.source_platform
    FROM public.curated_luxury_raw_parent_lineage_shadow b JOIN public.raw_messages rm ON rm.id=b.raw_message_id
    WHERE b.parent_key=c.parent_key LIMIT 1
  ) rm ON true
  LEFT JOIN LATERAL (
    SELECT rv.raw_text,rv.raw_payload FROM public.curated_luxury_raw_version_lineage_shadow b
    JOIN public.raw_message_versions rv ON rv.id=b.raw_version_id
    WHERE b.version_key=c.version_key AND rv.raw_message_id=rm.id LIMIT 1
  ) rv ON true
  LEFT JOIN LATERAL (
    SELECT candidate.name
    FROM (SELECT coalesce(
      nullif(btrim(rv.raw_payload#>>'{raw_data,from_name}'),''),
      nullif(btrim(rv.raw_payload#>>'{raw_data,user_name}'),''),
      nullif(btrim(rv.raw_payload#>>'{raw_data,seller_name}'),'')) name) candidate
    WHERE candidate.name IS NOT NULL AND length(candidate.name)<=150
      AND candidate.name!~*'^[0-9a-f]{32,}$'
      AND regexp_replace(candidate.name,'[^0-9]','','g')!~'^[0-9]{8,15}$'
      AND lower(regexp_replace(candidate.name,'[^a-z0-9]+',' ','g'))!~
        '^(unknown|anonymous|seller|dealer|poster|posting user|not available|unavailable)$'
    LIMIT 1
  ) poster ON true
  LEFT JOIN LATERAL (
    SELECT d.* FROM public.curated_luxury_dealer_lineage_shadow b
    JOIN public.dealers d ON d.id=b.dealer_id WHERE b.dealer_key=c.dealer_key LIMIT 1
  ) d ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(a.source_url ORDER BY l.image_ordinal) urls
    FROM public.curated_luxury_child_image_links_shadow l
    JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
    WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
      AND l.raw_occurrence_key=c.latest_raw_occurrence_key
      AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe
  ) images ON true;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_count_v4(
  p_run_id uuid,p_brand text,p_intents text[] DEFAULT NULL,p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,p_reference_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions
SET plan_cache_mode='force_custom_plan' AS $$
  SELECT jsonb_build_object('total',count(DISTINCT c.current_listing_key),'exact',true,
    'source','card_evidence_distinct_current')
  FROM public.curated_luxury_current_listings_shadow c
  WHERE c.run_id=p_run_id AND c.brand=p_brand AND p_brand IN ('Rolex','Patek Philippe')
    AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
    AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
      WHERE r.run_id=p_run_id AND r.status='COMPLETE')
    AND (p_intents IS NULL OR c.intent=ANY(p_intents))
    AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
    AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
    AND (NULLIF(btrim(p_search),'') IS NULL OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
    AND (NOT p_priced_only OR c.price_verified OR EXISTS (
      SELECT 1 FROM public.curated_luxury_latest_card_price_evidence_v1 p
      WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
        AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
        AND p.exact_child_text_sha256=c.exact_child_text_sha256 AND p.display_price_verified))
    AND (NOT p_images_only OR EXISTS (
      SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
      JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
      WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
        AND l.raw_occurrence_key=c.latest_raw_occurrence_key
        AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
    AND NOT EXISTS (
      SELECT 1 FROM public.curated_luxury_current_listings_shadow duplicate
      WHERE duplicate.run_id=c.run_id AND duplicate.brand=c.brand
        AND duplicate.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
        AND duplicate.current_listing_key<c.current_listing_key
        AND (duplicate.offer_state_key=c.offer_state_key
          OR duplicate.unique_observation_key=c.unique_observation_key));
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page_keys_v8(
  p_run_id uuid,p_brand text,p_intents text[] DEFAULT NULL,p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,p_reference_key text DEFAULT NULL,p_listing_lane smallint DEFAULT NULL,
  p_after_lane smallint DEFAULT NULL,p_after_timestamp timestamptz DEFAULT NULL,
  p_after_key text DEFAULT NULL,p_after_timestamp_is_null boolean DEFAULT false,p_limit integer DEFAULT 50
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions
SET plan_cache_mode='force_custom_plan' AS $$
BEGIN
  IF NOT p_priced_only THEN
    RETURN public.curated_luxury_shadow_customer_page_keys_v7(
      p_run_id,p_brand,p_intents,p_countries,false,p_images_only,p_search,p_reference_key,
      p_listing_lane,p_after_lane,p_after_timestamp,p_after_key,p_after_timestamp_is_null,p_limit);
  END IF;

  RETURN (
    WITH priced AS MATERIALIZED (
      SELECT p.current_listing_key,p.latest_raw_occurrence_key
      FROM public.curated_luxury_latest_card_price_evidence_v1 p
      WHERE p.run_id=p_run_id AND p.display_price_verified
    ), candidates AS MATERIALIZED (
      SELECT c.current_listing_key,c.source_timestamp,
        CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END::smallint listing_lane
      FROM public.curated_luxury_current_listings_shadow c
      LEFT JOIN priced p ON p.current_listing_key=c.current_listing_key
        AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
      WHERE c.run_id=p_run_id AND c.brand=p_brand AND p_brand IN ('Rolex','Patek Philippe')
        AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
        AND (c.price_verified OR p.current_listing_key IS NOT NULL)
        AND (p_listing_lane IS NULL OR p_listing_lane=CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
          AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)
        AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
          WHERE r.run_id=p_run_id AND r.status='COMPLETE')
        AND (p_intents IS NULL OR c.intent=ANY(p_intents))
        AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
        AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
        AND (NULLIF(btrim(p_search),'') IS NULL
          OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
        AND (NOT p_images_only OR EXISTS (
          SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
          JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
          WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
            AND l.raw_occurrence_key=c.latest_raw_occurrence_key
            AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
        AND NOT EXISTS (
          SELECT 1 FROM public.curated_luxury_current_listings_shadow duplicate
          WHERE duplicate.run_id=c.run_id AND duplicate.brand=c.brand
            AND duplicate.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
            AND duplicate.current_listing_key<c.current_listing_key
            AND (duplicate.offer_state_key=c.offer_state_key
              OR duplicate.unique_observation_key=c.unique_observation_key))
        AND (p_after_key IS NULL OR
          (p_after_lane=0 AND (CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
            AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)=1)
          OR ((CASE WHEN c.parent_raw_text_sha256 IS NOT NULL
            AND c.exact_child_text_sha256=c.parent_raw_text_sha256 THEN 0 ELSE 1 END)=p_after_lane AND (
            (p_after_timestamp_is_null AND c.source_timestamp IS NULL AND c.current_listing_key<p_after_key)
            OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
              c.source_timestamp<p_after_timestamp
              OR (c.source_timestamp=p_after_timestamp AND c.current_listing_key<p_after_key)
              OR c.source_timestamp IS NULL)))))
      ORDER BY listing_lane ASC,c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
      LIMIT least(greatest(coalesce(p_limit,50),1),100)+1
    ), selected AS MATERIALIZED (
      SELECT * FROM candidates ORDER BY listing_lane ASC,source_timestamp DESC NULLS LAST,current_listing_key DESC
      LIMIT least(greatest(coalesce(p_limit,50),1),100)
    ), last_row AS (
      SELECT * FROM selected ORDER BY listing_lane DESC,source_timestamp ASC NULLS FIRST,current_listing_key ASC LIMIT 1
    )
    SELECT jsonb_build_object(
      'keys',coalesce((SELECT jsonb_agg(current_listing_key
        ORDER BY listing_lane ASC,source_timestamp DESC NULLS LAST,current_listing_key DESC) FROM selected),'[]'::jsonb),
      'key_lanes',coalesce((SELECT jsonb_object_agg(current_listing_key,listing_lane) FROM selected),'{}'::jsonb),
      'has_more',(SELECT count(*) FROM candidates)>least(greatest(coalesce(p_limit,50),1),100),
      'next_lane',(SELECT listing_lane FROM last_row),'next_timestamp',(SELECT source_timestamp FROM last_row),
      'next_key',(SELECT current_listing_key FROM last_row),
      'next_timestamp_is_null',(SELECT source_timestamp IS NULL FROM last_row))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_price_research_v3(
  p_run_id uuid,p_brand text,p_reference_key text,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
  WITH permitted AS (
    SELECT 1 FROM public.curated_luxury_shadow_runs
    WHERE run_id=p_run_id AND status='COMPLETE'
  ), existing AS (
    SELECT o.offer_state_key,o.source_price_amount,o.source_currency,o.normalized_usd_amount,
      o.last_seen,o.occurrence_count,o.repost_same_offer_count,0 priority
    FROM public.curated_luxury_offer_states_shadow o,permitted
    WHERE o.run_id=p_run_id AND o.brand=p_brand AND p_brand IN ('Rolex','Patek Philippe')
      AND o.observed_reference_key=p_reference_key AND o.qualified_price_research
      AND o.normalized_usd_amount>0
  ), restored AS (
    SELECT c.offer_state_key,p.source_price_amount,p.source_currency,p.normalized_usd_amount,
      c.source_timestamp last_seen,1::bigint occurrence_count,0::bigint repost_same_offer_count,1 priority
    FROM public.curated_luxury_current_listings_shadow c
    JOIN public.curated_luxury_latest_card_price_evidence_v1 p
      ON p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
     AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
     AND p.exact_child_text_sha256=c.exact_child_text_sha256
     AND p.price_research_eligible
    WHERE c.run_id=p_run_id AND c.brand=p_brand AND p_brand IN ('Rolex','Patek Philippe')
      AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND c.intent='WTS' AND c.observed_reference_key=p_reference_key
      AND NOT EXISTS (
        SELECT 1 FROM public.curated_luxury_current_listings_shadow duplicate
        WHERE duplicate.run_id=c.run_id AND duplicate.brand=c.brand
          AND duplicate.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
          AND duplicate.current_listing_key<c.current_listing_key
          AND (duplicate.offer_state_key=c.offer_state_key
            OR duplicate.unique_observation_key=c.unique_observation_key))
  ), ranked AS (
    SELECT *,row_number() OVER (PARTITION BY offer_state_key ORDER BY priority,last_seen DESC) price_rank
    FROM (SELECT * FROM existing UNION ALL SELECT * FROM restored) prices
  ), all_prices AS MATERIALIZED (SELECT * FROM ranked WHERE price_rank=1),
  page_prices AS MATERIALIZED (
    SELECT * FROM all_prices ORDER BY last_seen DESC,offer_state_key DESC
    LIMIT least(greatest(coalesce(p_limit,100),1),100) OFFSET greatest(coalesce(p_offset,0),0)
  ), stats AS (
    SELECT count(*)::bigint count,avg(normalized_usd_amount) avg,
      percentile_cont(.25) WITHIN GROUP(ORDER BY normalized_usd_amount) q1,
      percentile_cont(.5) WITHIN GROUP(ORDER BY normalized_usd_amount) median,
      percentile_cont(.75) WITHIN GROUP(ORDER BY normalized_usd_amount) q3,
      min(normalized_usd_amount) min,max(normalized_usd_amount) max,
      coalesce(sum(repost_same_offer_count),0)::bigint repost_count FROM all_prices
  ), demand AS (
    SELECT count(DISTINCT c.offer_state_key)::bigint count
    FROM public.curated_luxury_current_listings_shadow c,permitted
    WHERE c.run_id=p_run_id AND c.brand=p_brand AND c.observed_reference_key=p_reference_key
      AND c.intent='WTB' AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
  )
  SELECT jsonb_build_object('stats',to_jsonb(stats),'wtb_count',demand.count,
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',p.offer_state_key,'source_price_amount',p.source_price_amount,
      'source_currency',p.source_currency,'price_usd',p.normalized_usd_amount,
      'created_at',p.last_seen,'occurrence_count',p.occurrence_count,
      'repost_count',p.repost_same_offer_count,'listing_type','WTS'
    ) ORDER BY p.last_seen DESC,p.offer_state_key DESC) FROM page_prices p),'[]'::jsonb))
  FROM stats CROSS JOIN demand;
$$;

REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_cards_v5(uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_count_v4(
  uuid,text,text[],text[],boolean,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v8(
  uuid,text,text[],text[],boolean,boolean,text,text,smallint,smallint,
  timestamptz,text,boolean,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_price_research_v3(
  uuid,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_cards_v5(uuid,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_count_v4(
  uuid,text,text[],text[],boolean,boolean,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v8(
  uuid,text,text[],text[],boolean,boolean,text,text,smallint,smallint,
  timestamptz,text,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_price_research_v3(
  uuid,text,text,integer,integer) TO service_role;

NOTIFY pgrst,'reload schema';
