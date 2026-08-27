-- Rolex-only additive price/image evidence restoration.
-- The frozen cohort and immutable raw/source tables are read only. Patek remains on v3.

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_offer_state_canonical_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id,brand,offer_state_key,current_listing_key)
  WHERE current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE');
CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_unique_observation_canonical_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id,brand,unique_observation_key,current_listing_key)
  WHERE current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE');

CREATE OR REPLACE VIEW public.curated_luxury_rolex_canonical_current_v1
WITH (security_invoker=true) AS
SELECT c.*
FROM public.curated_luxury_current_listings_shadow c
WHERE c.brand='Rolex'
  AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
  AND NOT EXISTS (
    SELECT 1
    FROM public.curated_luxury_current_listings_shadow duplicate
    WHERE duplicate.run_id=c.run_id
      AND duplicate.brand='Rolex'
      AND duplicate.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND duplicate.current_listing_key<c.current_listing_key
      AND (
        duplicate.offer_state_key=c.offer_state_key
        OR duplicate.unique_observation_key=c.unique_observation_key
      )
  );

REVOKE ALL ON public.curated_luxury_rolex_canonical_current_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.curated_luxury_rolex_canonical_current_v1 TO service_role;

CREATE TABLE IF NOT EXISTS public.curated_luxury_rolex_price_evidence_shadow (
  run_id uuid NOT NULL,
  current_listing_key text NOT NULL,
  offer_state_key text NOT NULL,
  latest_raw_occurrence_key text NOT NULL,
  evidence_version text NOT NULL,
  exact_child_text_sha256 text NOT NULL CHECK (exact_child_text_sha256~'^[0-9a-f]{64}$'),
  parent_raw_text_sha256 text CHECK (parent_raw_text_sha256 IS NULL OR parent_raw_text_sha256~'^[0-9a-f]{64}$'),
  raw_text_sha256 text NOT NULL CHECK (raw_text_sha256~'^[0-9a-f]{64}$'),
  child_text_scope text,
  source_price_text text,
  source_price_amount numeric,
  source_currency text,
  source_span_start integer,
  source_span_end integer,
  parser_rule text,
  parser_version text,
  decision text NOT NULL CHECK (decision IN ('VERIFIED','REVIEW_REQUIRED')),
  review_reason text,
  price_evidence_classification text,
  normalized_usd_amount numeric,
  display_price_verified boolean NOT NULL DEFAULT false,
  price_research_eligible boolean NOT NULL DEFAULT false,
  fx_contract text,
  fx_provider text,
  fx_source_url text,
  fx_applicable_date date,
  fx_effective_date date,
  fx_lookback_days integer,
  fx_rate_direction text,
  fx_rate numeric,
  evidence_checksum text CHECK (evidence_checksum IS NULL OR evidence_checksum~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,current_listing_key,latest_raw_occurrence_key,evidence_version),
  FOREIGN KEY (run_id,current_listing_key)
    REFERENCES public.curated_luxury_current_listings_shadow(run_id,current_listing_key),
  CHECK (decision<>'VERIFIED' OR (
    display_price_verified
    AND source_price_amount>0
    AND source_currency IS NOT NULL
    AND normalized_usd_amount>0
    AND price_evidence_classification IN
      ('SOURCE_EXPLICIT_USD_MATCH','SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX')
  )),
  CHECK (NOT price_research_eligible OR (decision='VERIFIED' AND display_price_verified)),
  CHECK (price_evidence_classification<>'DATED_VERIFIED_FX' OR (
    fx_provider IS NOT NULL AND fx_source_url IS NOT NULL
    AND fx_applicable_date IS NOT NULL AND fx_effective_date IS NOT NULL
    AND fx_rate_direction='USD_PER_SOURCE_UNIT' AND fx_rate>0
  ))
);

CREATE INDEX IF NOT EXISTS curated_luxury_rolex_price_evidence_verified_idx
  ON public.curated_luxury_rolex_price_evidence_shadow
  (run_id,current_listing_key,latest_raw_occurrence_key,created_at DESC)
  WHERE decision='VERIFIED' AND display_price_verified;
CREATE INDEX IF NOT EXISTS curated_luxury_rolex_price_evidence_pr_idx
  ON public.curated_luxury_rolex_price_evidence_shadow
  (run_id,offer_state_key,created_at DESC)
  WHERE decision='VERIFIED' AND price_research_eligible;

ALTER TABLE public.curated_luxury_rolex_price_evidence_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_rolex_price_evidence_shadow FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.curated_luxury_rolex_price_evidence_shadow TO service_role;

CREATE OR REPLACE FUNCTION public.curated_luxury_reject_evidence_mutation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'Curated Luxury evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS curated_luxury_rolex_price_evidence_append_only
  ON public.curated_luxury_rolex_price_evidence_shadow;
CREATE TRIGGER curated_luxury_rolex_price_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.curated_luxury_rolex_price_evidence_shadow
  FOR EACH ROW EXECUTE FUNCTION public.curated_luxury_reject_evidence_mutation_v1();

ALTER TABLE public.curated_luxury_child_image_links_shadow
  ADD COLUMN IF NOT EXISTS image_evidence_type text NOT NULL DEFAULT 'SELLER_LISTING_IMAGE',
  ADD COLUMN IF NOT EXISTS association_evidence_sha256 text;
ALTER TABLE public.curated_luxury_child_image_links_shadow
  DROP CONSTRAINT IF EXISTS curated_luxury_child_image_links_shadow_image_evidence_type_check;
ALTER TABLE public.curated_luxury_child_image_links_shadow
  ADD CONSTRAINT curated_luxury_child_image_links_shadow_image_evidence_type_check
  CHECK (image_evidence_type='SELLER_LISTING_IMAGE');
ALTER TABLE public.curated_luxury_child_image_links_shadow
  DROP CONSTRAINT IF EXISTS curated_luxury_child_image_links_shadow_association_evidence_check;
ALTER TABLE public.curated_luxury_child_image_links_shadow
  ADD CONSTRAINT curated_luxury_child_image_links_shadow_association_evidence_check
  CHECK (association_evidence_sha256 IS NULL OR association_evidence_sha256~'^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS public.curated_luxury_rolex_effective_facets_shadow (
  run_id uuid NOT NULL,
  intent_key text NOT NULL,
  country_key text NOT NULL,
  price_verified boolean NOT NULL,
  image_verified boolean NOT NULL,
  listing_count bigint NOT NULL CHECK (listing_count>=0),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,intent_key,country_key,price_verified,image_verified)
);
ALTER TABLE public.curated_luxury_rolex_effective_facets_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_rolex_effective_facets_shadow FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.curated_luxury_rolex_effective_facets_shadow TO service_role;

CREATE OR REPLACE FUNCTION public.curated_luxury_refresh_rolex_effective_facets_v1(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_total bigint; v_existing_images bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs
    WHERE run_id=p_run_id AND status='COMPLETE') THEN
    RAISE EXCEPTION 'Complete shadow run required';
  END IF;
  DELETE FROM public.curated_luxury_rolex_effective_facets_shadow WHERE run_id=p_run_id;
  WITH effective AS MATERIALIZED (
    SELECT c.run_id,coalesce(c.intent,'') intent_key,coalesce(c.country_code,'') country_key,
      (c.price_verified OR EXISTS (
      SELECT 1 FROM public.curated_luxury_rolex_price_evidence_shadow p
      WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
        AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
        AND p.decision='VERIFIED' AND p.display_price_verified)) price_verified,
      EXISTS (
      SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
      JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
      WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
        AND l.raw_occurrence_key=c.latest_raw_occurrence_key
        AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe) image_verified
    FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id
  )
  INSERT INTO public.curated_luxury_rolex_effective_facets_shadow
    (run_id,intent_key,country_key,price_verified,image_verified,listing_count)
  SELECT run_id,intent_key,country_key,price_verified,image_verified,count(*)::bigint
  FROM effective GROUP BY run_id,intent_key,country_key,price_verified,image_verified;
  SELECT coalesce(sum(listing_count),0)::bigint INTO v_total
  FROM public.curated_luxury_rolex_effective_facets_shadow WHERE run_id=p_run_id;
  SELECT coalesce(sum(listing_count),0)::bigint INTO v_existing_images
  FROM public.curated_luxury_rolex_effective_facets_shadow
  WHERE run_id=p_run_id AND image_verified;
  RETURN jsonb_build_object('run_id',p_run_id,'canonical_listings',v_total,
    'verified_image_listings',v_existing_images,'refreshed',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_rolex_evidence_candidates_v1(
  p_run_id uuid,p_after_key text DEFAULT NULL,p_limit integer DEFAULT 500
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,extensions SET plan_cache_mode='force_custom_plan' AS $$
  WITH selected AS MATERIALIZED (
    SELECT c.*
    FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id AND (p_after_key IS NULL OR c.current_listing_key>p_after_key)
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
    ORDER BY c.current_listing_key
    LIMIT least(greatest(coalesce(p_limit,500),1),1000)
  ), rows AS (
    SELECT jsonb_build_object(
      'run_id',c.run_id,'current_listing_key',c.current_listing_key,
      'offer_family_key',c.offer_family_key,'offer_state_key',c.offer_state_key,
      'latest_raw_occurrence_key',c.latest_raw_occurrence_key,
      'unique_observation_key',c.unique_observation_key,'current_status',c.current_status,
      'brand',c.brand,'intent',c.intent,'observed_reference_key',c.observed_reference_key,
      'version_key',c.version_key,'source_timestamp',c.source_timestamp,
      'source_price_amount',c.source_price_amount,'source_currency',c.source_currency,
      'price_verified',c.price_verified,'exact_child_text_sha256',c.exact_child_text_sha256,
      'parent_raw_text_sha256',c.parent_raw_text_sha256,
      'raw_message',coalesce(rv.raw_text,rm.raw_text),
      'raw_version_media',coalesce(rv.media,'[]'::jsonb),
      'raw_is_bundle',lower(coalesce(rv.raw_payload#>>'{raw_data,is_bundle}','false'))='true',
      'parent_child_count',(SELECT count(*) FROM public.curated_luxury_rolex_canonical_current_v1 sibling
        WHERE sibling.run_id=c.run_id AND sibling.parent_key=c.parent_key),
      'existing_source_image_keys',coalesce((SELECT jsonb_agg(l.source_image_key ORDER BY l.image_ordinal)
        FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe),'[]'::jsonb),
      'next_image_ordinal',coalesce((SELECT max(l.image_ordinal)+1
        FROM public.curated_luxury_child_image_links_shadow l
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key),0),
      'is_canonical_survivor',true
    ) row_data,c.current_listing_key
    FROM selected c
    LEFT JOIN public.curated_luxury_raw_parent_lineage_shadow pb ON pb.parent_key=c.parent_key
    LEFT JOIN public.raw_messages rm ON rm.id=pb.raw_message_id
    LEFT JOIN public.curated_luxury_raw_version_lineage_shadow vb ON vb.version_key=c.version_key
    LEFT JOIN public.raw_message_versions rv ON rv.id=vb.raw_version_id AND rv.raw_message_id=rm.id
  )
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(row_data ORDER BY current_listing_key),'[]'::jsonb),
    'next_key',max(current_listing_key),'has_more',count(*)=least(greatest(coalesce(p_limit,500),1),1000))
  FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_rolex_customer_page_keys_v4(
  p_run_id uuid,p_intents text[] DEFAULT NULL,p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,p_reference_key text DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,p_after_key text DEFAULT NULL,
  p_after_timestamp_is_null boolean DEFAULT false,p_limit integer DEFAULT 50
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions
SET plan_cache_mode='force_custom_plan' AS $$
  WITH candidates AS MATERIALIZED (
    SELECT c.current_listing_key,c.source_timestamp
    FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (NULLIF(btrim(p_search),'') IS NULL OR upper(c.search_text) LIKE '%'||upper(btrim(p_search))||'%')
      AND (NOT p_priced_only OR c.price_verified OR EXISTS (
        SELECT 1 FROM public.curated_luxury_rolex_price_evidence_shadow p
        WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
          AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
          AND p.decision='VERIFIED' AND p.display_price_verified))
      AND (NOT p_images_only OR EXISTS (
        SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe))
      AND (p_after_key IS NULL
        OR (p_after_timestamp_is_null AND c.source_timestamp IS NULL AND c.current_listing_key<p_after_key)
        OR (NOT p_after_timestamp_is_null AND p_after_timestamp IS NOT NULL AND (
          c.source_timestamp<p_after_timestamp
          OR (c.source_timestamp=p_after_timestamp AND c.current_listing_key<p_after_key)
          OR c.source_timestamp IS NULL)))
    ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)+1
  ), selected AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY source_timestamp DESC NULLS LAST,current_listing_key DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),100)
  ), last_row AS (
    SELECT * FROM selected ORDER BY source_timestamp ASC NULLS FIRST,current_listing_key ASC LIMIT 1
  )
  SELECT jsonb_build_object(
    'keys',coalesce((SELECT jsonb_agg(current_listing_key ORDER BY source_timestamp DESC NULLS LAST,
      current_listing_key DESC) FROM selected),'[]'::jsonb),
    'has_more',(SELECT count(*) FROM candidates)>least(greatest(coalesce(p_limit,50),1),100),
    'next_timestamp',(SELECT source_timestamp FROM last_row),
    'next_key',(SELECT current_listing_key FROM last_row),
    'next_timestamp_is_null',(SELECT source_timestamp IS NULL FROM last_row));
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_rolex_customer_count_v3(
  p_run_id uuid,p_intents text[] DEFAULT NULL,p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,p_reference_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_total bigint; v_search text:=NULLIF(upper(btrim(coalesce(p_search,''))),'');
BEGIN
  IF v_search IS NULL AND p_reference_key IS NULL THEN
    SELECT coalesce(sum(f.listing_count),0)::bigint INTO v_total
    FROM public.curated_luxury_rolex_effective_facets_shadow f
    WHERE f.run_id=p_run_id
      AND (p_intents IS NULL OR f.intent_key=ANY(p_intents))
      AND (p_countries IS NULL OR f.country_key=ANY(p_countries))
      AND (NOT p_priced_only OR f.price_verified)
      AND (NOT p_images_only OR f.image_verified);
    RETURN jsonb_build_object('total',v_total,'exact',true,'source','rolex_effective_facets_v1');
  END IF;
  SELECT count(*) INTO v_total FROM public.curated_luxury_rolex_canonical_current_v1 c
  WHERE c.run_id=p_run_id AND (p_intents IS NULL OR c.intent=ANY(p_intents))
    AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
    AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
    AND (v_search IS NULL OR upper(c.search_text) LIKE '%'||v_search||'%')
    AND (NOT p_priced_only OR c.price_verified OR EXISTS (
      SELECT 1 FROM public.curated_luxury_rolex_price_evidence_shadow p
      WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
        AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
        AND p.decision='VERIFIED' AND p.display_price_verified))
    AND (NOT p_images_only OR EXISTS (
      SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
      JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
      WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
        AND l.raw_occurrence_key=c.latest_raw_occurrence_key
        AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe));
  RETURN jsonb_build_object('total',v_total,'exact',true,'source','rolex_effective_filtered_v1');
END;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_rolex_customer_cards_v4(
  p_run_id uuid,p_listing_keys text[]
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions
SET plan_cache_mode='force_custom_plan' AS $$
  WITH selected AS MATERIALIZED (
    SELECT c.* FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id AND cardinality(p_listing_keys) BETWEEN 1 AND 100
      AND c.current_listing_key=ANY(p_listing_keys)
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',c.current_listing_key,'brand',c.brand,'reference',c.observed_reference,
    'reference_key',c.observed_reference_key,'listing_type',c.intent,
    'condition',c.condition_as_observed,'dial_color',c.dial_or_color_as_observed,
    'created_at',c.source_timestamp,'source_price_amount',coalesce(p.source_price_amount,c.source_price_amount),
    'source_currency',coalesce(p.source_currency,c.source_currency),
    'price_usd',CASE WHEN c.price_verified THEN c.normalized_usd_amount ELSE p.normalized_usd_amount END,
    'price_verified',(c.price_verified OR coalesce(p.display_price_verified,false)),
    'price_display_verified',(c.price_verified OR coalesce(p.display_price_verified,false)),
    'price_evidence_classification',CASE WHEN c.price_verified THEN
      CASE WHEN upper(coalesce(c.source_currency,''))='USDT' THEN 'SOURCE_EXPLICIT_USD_USDT'
        WHEN upper(coalesce(c.source_currency,''))='USD' THEN 'SOURCE_EXPLICIT_USD_MATCH'
        ELSE 'DATED_VERIFIED_FX' END ELSE p.price_evidence_classification END,
    'price_requires_review',(NOT c.price_verified AND coalesce(p.decision,'REVIEW_REQUIRED')<>'VERIFIED'),
    'price_research_eligible',(c.intent='WTS' AND c.observed_reference_key IS NOT NULL
      AND (c.price_verified OR coalesce(p.price_research_eligible,false))),
    'raw_message',coalesce(rv.raw_text,rm.raw_text),
    'verified_child_media',coalesce(images.urls,'[]'::jsonb),
    'has_images',coalesce(jsonb_array_length(images.urls)>0,false),
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
  LEFT JOIN LATERAL (
    SELECT e.* FROM public.curated_luxury_rolex_price_evidence_shadow e
    WHERE e.run_id=c.run_id AND e.current_listing_key=c.current_listing_key
      AND e.latest_raw_occurrence_key=c.latest_raw_occurrence_key
    ORDER BY (e.decision='VERIFIED') DESC,e.created_at DESC,e.evidence_version DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT rm.id,rm.raw_text,rm.source_platform
    FROM public.curated_luxury_raw_parent_lineage_shadow b JOIN public.raw_messages rm ON rm.id=b.raw_message_id
    WHERE b.parent_key=c.parent_key LIMIT 1
  ) rm ON true
  LEFT JOIN LATERAL (
    SELECT rv.raw_text FROM public.curated_luxury_raw_version_lineage_shadow b
    JOIN public.raw_message_versions rv ON rv.id=b.raw_version_id
    WHERE b.version_key=c.version_key AND rv.raw_message_id=rm.id LIMIT 1
  ) rv ON true
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

CREATE OR REPLACE FUNCTION public.curated_luxury_rolex_price_research_v2(
  p_run_id uuid,p_reference_key text,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
  WITH existing AS (
    SELECT o.offer_state_key,o.source_price_amount,o.source_currency,o.normalized_usd_amount,
      o.last_seen,o.occurrence_count,o.repost_same_offer_count,0 priority
    FROM public.curated_luxury_offer_states_shadow o
    WHERE o.run_id=p_run_id AND o.brand='Rolex' AND o.observed_reference_key=p_reference_key
      AND o.qualified_price_research AND o.normalized_usd_amount>0
  ), restored AS (
    SELECT c.offer_state_key,p.source_price_amount,p.source_currency,p.normalized_usd_amount,
      c.source_timestamp last_seen,1::bigint occurrence_count,0::bigint repost_same_offer_count,1 priority
    FROM public.curated_luxury_rolex_canonical_current_v1 c
    JOIN LATERAL (
      SELECT e.* FROM public.curated_luxury_rolex_price_evidence_shadow e
      WHERE e.run_id=c.run_id AND e.current_listing_key=c.current_listing_key
        AND e.latest_raw_occurrence_key=c.latest_raw_occurrence_key
        AND e.decision='VERIFIED' AND e.price_research_eligible
      ORDER BY e.created_at DESC,e.evidence_version DESC LIMIT 1
    ) p ON true
    WHERE c.run_id=p_run_id AND c.intent='WTS' AND c.observed_reference_key=p_reference_key
  ), ranked AS (
    SELECT *,row_number() OVER(PARTITION BY offer_state_key ORDER BY priority,last_seen DESC) rank
    FROM (SELECT * FROM existing UNION ALL SELECT * FROM restored) prices
  ), all_prices AS MATERIALIZED (SELECT * FROM ranked WHERE rank=1),
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
    SELECT count(*)::bigint count FROM public.curated_luxury_rolex_canonical_current_v1 c
    WHERE c.run_id=p_run_id AND c.observed_reference_key=p_reference_key AND c.intent='WTB'
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

CREATE OR REPLACE FUNCTION public.curated_luxury_rolex_evidence_reconciliation_v1(p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH current_rows AS (
    SELECT * FROM public.curated_luxury_current_listings_shadow
    WHERE run_id=p_run_id AND brand='Rolex'
      AND current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
  ), canonical AS (
    SELECT * FROM public.curated_luxury_rolex_canonical_current_v1 WHERE run_id=p_run_id
  )
  SELECT jsonb_build_object(
    'run_id',p_run_id,'raw_current_rows',(SELECT count(*) FROM current_rows),
    'canonical_current_rows',(SELECT count(*) FROM canonical),
    'duplicate_rows_suppressed',(SELECT count(*) FROM current_rows)-(SELECT count(*) FROM canonical),
    'duplicate_offer_state_keys',(SELECT count(*) FROM (SELECT offer_state_key FROM current_rows GROUP BY 1 HAVING count(*)>1) d),
    'duplicate_unique_observation_keys',(SELECT count(*) FROM (SELECT unique_observation_key FROM current_rows GROUP BY 1 HAVING count(*)>1) d),
    'verified_price_repairs',(SELECT count(*) FROM public.curated_luxury_rolex_price_evidence_shadow
      WHERE run_id=p_run_id AND decision='VERIFIED'),
    'review_required',(SELECT count(*) FROM public.curated_luxury_rolex_price_evidence_shadow
      WHERE run_id=p_run_id AND decision='REVIEW_REQUIRED'),
    'verified_image_listings',(SELECT count(DISTINCT l.current_listing_key)
      FROM public.curated_luxury_child_image_links_shadow l
      JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
      JOIN canonical c ON c.current_listing_key=l.current_listing_key
      WHERE l.run_id=p_run_id AND l.raw_occurrence_key=c.latest_raw_occurrence_key
        AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe),
    'orphan_price_evidence',(SELECT count(*) FROM public.curated_luxury_rolex_price_evidence_shadow e
      LEFT JOIN canonical c ON c.current_listing_key=e.current_listing_key
      WHERE e.run_id=p_run_id AND c.current_listing_key IS NULL),
    'orphan_image_evidence',(SELECT count(*) FROM public.curated_luxury_child_image_links_shadow l
      LEFT JOIN canonical c ON c.current_listing_key=l.current_listing_key
      WHERE l.run_id=p_run_id AND c.current_listing_key IS NULL)
  );
$$;

REVOKE ALL ON FUNCTION public.curated_luxury_refresh_rolex_effective_facets_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_evidence_candidates_v1(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_customer_page_keys_v4(uuid,text[],text[],boolean,boolean,text,text,timestamptz,text,boolean,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_customer_count_v3(uuid,text[],text[],boolean,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_customer_cards_v4(uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_price_research_v2(uuid,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_evidence_reconciliation_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curated_luxury_refresh_rolex_effective_facets_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_evidence_candidates_v1(uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_customer_page_keys_v4(uuid,text[],text[],boolean,boolean,text,text,timestamptz,text,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_customer_count_v3(uuid,text[],text[],boolean,boolean,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_customer_cards_v4(uuid,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_price_research_v2(uuid,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_evidence_reconciliation_v1(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
