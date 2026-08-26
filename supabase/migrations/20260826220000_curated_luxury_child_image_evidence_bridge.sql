-- Immutable, exact-hash child-image evidence for the frozen Rolex/Patek shadow.
-- No cohort or raw/source row is updated by this migration.

CREATE TABLE IF NOT EXISTS public.curated_luxury_child_image_assets_shadow (
  source_image_key text PRIMARY KEY CHECK (source_image_key ~ '^[0-9a-f]{64}$'),
  source_url text NOT NULL CHECK (btrim(source_url) ~ '^https?://[^[:space:]]+$'),
  source_asset_key text,
  evidence_source text NOT NULL CHECK (evidence_source IN
    ('RAW_VERSION_CHILD_VERIFIED_MEDIA','NORMALIZED_EXACT_SOURCE_IMAGE',
     'STORED_SOURCE_URL','EXISTING_IMAGE_MANIFEST')),
  customer_safe boolean NOT NULL DEFAULT true CHECK (customer_safe),
  verified_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_image_key = encode(extensions.digest(convert_to(source_url,'UTF8'),'sha256'),'hex'))
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_child_image_links_shadow (
  run_id uuid NOT NULL,
  current_listing_key text NOT NULL,
  raw_occurrence_key text NOT NULL,
  source_image_key text NOT NULL REFERENCES public.curated_luxury_child_image_assets_shadow(source_image_key),
  image_ordinal integer NOT NULL DEFAULT 0 CHECK (image_ordinal >= 0),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,current_listing_key,source_image_key),
  UNIQUE (run_id,current_listing_key,image_ordinal),
  FOREIGN KEY (run_id,current_listing_key)
    REFERENCES public.curated_luxury_current_listings_shadow(run_id,current_listing_key)
);

CREATE INDEX IF NOT EXISTS curated_luxury_child_image_links_occurrence_idx
  ON public.curated_luxury_child_image_links_shadow(run_id,raw_occurrence_key);
CREATE INDEX IF NOT EXISTS curated_luxury_child_image_links_listing_idx
  ON public.curated_luxury_child_image_links_shadow(run_id,current_listing_key,image_ordinal);

ALTER TABLE public.curated_luxury_child_image_assets_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_child_image_links_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_child_image_assets_shadow FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.curated_luxury_child_image_links_shadow FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.curated_luxury_child_image_assets_shadow TO service_role;
GRANT SELECT,INSERT ON public.curated_luxury_child_image_links_shadow TO service_role;

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
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=p_run_id AND r.status='COMPLETE')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',c.current_listing_key,'brand',c.brand,'reference',c.observed_reference,
    'reference_key',c.observed_reference_key,'listing_type',c.intent,
    'condition',c.condition_as_observed,'dial_color',c.dial_or_color_as_observed,
    'created_at',c.source_timestamp,'source_price_amount',c.source_price_amount,
    'source_currency',c.source_currency,
    'price_usd',CASE WHEN c.price_verified THEN c.normalized_usd_amount ELSE NULL END,
    'price_verified',c.price_verified,'raw_message',coalesce(rv.raw_text,rm.raw_text),
    'verified_child_media',coalesce(images.urls,'[]'::jsonb),
    'has_images',coalesce(jsonb_array_length(images.urls)>0,false),
    'image_state',CASE WHEN coalesce(jsonb_array_length(images.urls)>0,false)
      THEN 'VERIFIED_CHILD_IMAGE' ELSE 'NO_VERIFIED_CHILD_IMAGE' END,
    'country_code',c.country_code,'current_status',c.current_status,
    'cohort_status',c.cohort_status,'source_platform',rm.source_platform,
    'source_identity_key',c.source_identity_key,'dealer_id',d.id,
    'dealer_name',coalesce(d.display_name,d.company_name),'dealer_slug',d.slug,
    'dealer_rating',CASE WHEN c.dealer_rating_qualified AND d.status='VERIFIED'
      AND d.review_count>0 THEN d.rating ELSE NULL END,
    'dealer_review_count',CASE WHEN c.dealer_rating_qualified AND d.status='VERIFIED'
      AND d.review_count>0 THEN d.review_count ELSE NULL END,
    'contact_publication_approved',coalesce(d.contact_consent,false)
  ) ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC),'[]'::jsonb)
  FROM selected c
  LEFT JOIN LATERAL (
    SELECT rm.id,rm.raw_text,rm.source_platform
    FROM public.curated_luxury_raw_parent_lineage_shadow b
    JOIN public.raw_messages rm ON rm.id=b.raw_message_id
    WHERE b.parent_key=c.parent_key LIMIT 1
  ) rm ON true
  LEFT JOIN LATERAL (
    SELECT rv.raw_text
    FROM public.curated_luxury_raw_version_lineage_shadow b
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
      AND l.raw_occurrence_key=c.latest_raw_occurrence_key AND a.customer_safe
  ) images ON true;
$$;

CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_count_v2(
  p_run_id uuid,p_brands text[] DEFAULT NULL,p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,p_search text DEFAULT NULL,p_reference_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,extensions SET plan_cache_mode='force_custom_plan'
AS $$
DECLARE v_total bigint; v_search_key text:=NULLIF(upper(btrim(coalesce(p_search,''))),'');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs
    WHERE run_id=p_run_id AND status='COMPLETE') THEN
    RETURN jsonb_build_object('total',0,'exact',true,'source','complete_gate');
  END IF;
  IF p_images_only THEN
    SELECT count(DISTINCT c.current_listing_key) INTO v_total
    FROM public.curated_luxury_child_image_links_shadow l
    JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
    JOIN public.curated_luxury_current_listings_shadow c
      ON c.run_id=l.run_id AND c.current_listing_key=l.current_listing_key
      AND c.latest_raw_occurrence_key=l.raw_occurrence_key
    WHERE l.run_id=p_run_id AND a.customer_safe
      AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND (p_brands IS NULL OR c.brand=ANY(p_brands))
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (v_search_key IS NULL OR upper(c.search_text) LIKE '%'||v_search_key||'%');
    RETURN jsonb_build_object('total',v_total,'exact',true,'source','verified_child_image_bridge');
  END IF;
  IF v_search_key IS NOT NULL OR p_reference_key IS NOT NULL THEN
    SELECT count(*) INTO v_total FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id=p_run_id AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND (p_brands IS NULL OR c.brand=ANY(p_brands))
      AND (p_intents IS NULL OR c.intent=ANY(p_intents))
      AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
      AND (NOT p_priced_only OR c.price_verified)
      AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
      AND (v_search_key IS NULL OR upper(c.search_text) LIKE '%'||v_search_key||'%');
    RETURN jsonb_build_object('total',v_total,'exact',true,'source',
      CASE WHEN p_reference_key IS NOT NULL THEN 'reference_index' ELSE 'search_index' END);
  END IF;
  SELECT coalesce(sum(f.listing_count),0)::bigint INTO v_total
  FROM public.curated_luxury_current_facets_shadow f
  WHERE f.run_id=p_run_id AND (p_brands IS NULL OR f.brand=ANY(p_brands))
    AND (p_intents IS NULL OR f.intent_key=ANY(p_intents))
    AND (p_countries IS NULL OR f.country_key=ANY(p_countries))
    AND (NOT p_priced_only OR f.price_verified);
  RETURN jsonb_build_object('total',v_total,'exact',true,'source','materialized_facets');
END;
$$;

-- Replaces only the image predicate in the already-keyset-paginated hot path.
CREATE OR REPLACE FUNCTION public.curated_luxury_shadow_customer_page_keys_v3(
  p_run_id uuid,p_brands text[] DEFAULT NULL,p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,p_search text DEFAULT NULL,p_reference_key text DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,p_after_key text DEFAULT NULL,
  p_after_timestamp_is_null boolean DEFAULT false,p_limit integer DEFAULT 50
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions
AS $function$
DECLARE v_sql text; v_result jsonb;
BEGIN
  v_sql := $query$ WITH candidates AS MATERIALIZED (
    SELECT c.current_listing_key,c.source_timestamp
    FROM public.curated_luxury_current_listings_shadow c
    WHERE c.run_id=$1 AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      AND EXISTS (SELECT 1 FROM public.curated_luxury_shadow_runs r
        WHERE r.run_id=$1 AND r.status='COMPLETE') $query$;
  IF p_brands IS NOT NULL THEN v_sql:=v_sql||' AND c.brand=ANY($2)'; END IF;
  IF p_intents IS NOT NULL THEN v_sql:=v_sql||' AND c.intent=ANY($3)'; END IF;
  IF p_countries IS NOT NULL THEN v_sql:=v_sql||' AND c.country_code=ANY($4)'; END IF;
  IF p_priced_only THEN v_sql:=v_sql||' AND c.price_verified'; END IF;
  IF p_images_only THEN v_sql:=v_sql||$images$ AND EXISTS (
    SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
    JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
    WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
      AND l.raw_occurrence_key=c.latest_raw_occurrence_key AND a.customer_safe) $images$; END IF;
  IF p_reference_key IS NOT NULL THEN v_sql:=v_sql||' AND c.observed_reference_key=$8'; END IF;
  IF NULLIF(btrim(p_search),'') IS NOT NULL THEN
    v_sql:=v_sql||' AND upper(c.search_text) LIKE ''%''||upper(btrim($7))||''%'''; END IF;
  IF p_after_key IS NOT NULL AND p_after_timestamp_is_null THEN
    v_sql:=v_sql||' AND c.source_timestamp IS NULL AND c.current_listing_key<$10';
  ELSIF p_after_key IS NOT NULL AND p_after_timestamp IS NOT NULL THEN
    v_sql:=v_sql||' AND (c.source_timestamp<$9 OR (c.source_timestamp=$9 AND c.current_listing_key<$10) OR c.source_timestamp IS NULL)';
  END IF;
  v_sql:=v_sql||$tail$ ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC
    LIMIT least(greatest(coalesce($12,50),1),100)+1), selected AS MATERIALIZED (
      SELECT * FROM candidates ORDER BY source_timestamp DESC NULLS LAST,current_listing_key DESC
      LIMIT least(greatest(coalesce($12,50),1),100)), last_row AS (
      SELECT source_timestamp,current_listing_key FROM selected
      ORDER BY source_timestamp ASC NULLS FIRST,current_listing_key ASC LIMIT 1)
    SELECT jsonb_build_object('keys',coalesce((SELECT jsonb_agg(current_listing_key
      ORDER BY source_timestamp DESC NULLS LAST,current_listing_key DESC) FROM selected),'[]'::jsonb),
      'has_more',(SELECT count(*) FROM candidates)>least(greatest(coalesce($12,50),1),100),
      'next_timestamp',(SELECT source_timestamp FROM last_row),'next_key',(SELECT current_listing_key FROM last_row),
      'next_timestamp_is_null',(SELECT source_timestamp IS NULL FROM last_row)) $tail$;
  EXECUTE v_sql INTO v_result USING p_run_id,p_brands,p_intents,p_countries,p_priced_only,
    p_images_only,p_search,p_reference_key,p_after_timestamp,p_after_key,p_after_timestamp_is_null,p_limit;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_cards_v3(uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_count_v2(uuid,text[],text[],text[],boolean,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v3(uuid,text[],text[],text[],boolean,boolean,text,text,timestamptz,text,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_cards_v3(uuid,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_count_v2(uuid,text[],text[],text[],boolean,boolean,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v3(uuid,text[],text[],text[],boolean,boolean,text,text,timestamptz,text,boolean,integer) TO service_role;

NOTIFY pgrst,'reload schema';
