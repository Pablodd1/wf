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

-- Append-only evidence is resolved newest-first. A later REVIEW_REQUIRED
-- decision must revoke an older VERIFIED decision without mutating history.
CREATE OR REPLACE VIEW public.curated_luxury_rolex_latest_price_evidence_v2
WITH (security_invoker=true) AS
SELECT ranked.*
FROM (
  SELECT e.*,row_number() OVER (
    PARTITION BY e.run_id,e.current_listing_key,e.latest_raw_occurrence_key
    ORDER BY e.created_at DESC,e.evidence_version DESC
  ) evidence_rank
  FROM public.curated_luxury_rolex_price_evidence_shadow e
) ranked
WHERE ranked.evidence_rank=1;

REVOKE ALL ON public.curated_luxury_rolex_latest_price_evidence_v2 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.curated_luxury_rolex_latest_price_evidence_v2 TO service_role;

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
        SELECT 1 FROM public.curated_luxury_rolex_latest_price_evidence_v2 p
        WHERE p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
          AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
          AND p.decision='VERIFIED' AND p.display_price_verified)) price_verified,
      EXISTS (
        SELECT 1 FROM public.curated_luxury_child_image_links_shadow l
        JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
        WHERE l.run_id=c.run_id AND l.current_listing_key=c.current_listing_key
          AND l.raw_occurrence_key=c.latest_raw_occurrence_key
          AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe) image_verified
    FROM public.curated_luxury_rolex_canonical_current_v1 c WHERE c.run_id=p_run_id
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
    RETURN jsonb_build_object('total',v_total,'exact',true,'source','rolex_effective_facets_v2');
  END IF;
  SELECT count(*) INTO v_total FROM public.curated_luxury_rolex_canonical_current_v1 c
  WHERE c.run_id=p_run_id AND (p_intents IS NULL OR c.intent=ANY(p_intents))
    AND (p_countries IS NULL OR c.country_code=ANY(p_countries))
    AND (p_reference_key IS NULL OR c.observed_reference_key=p_reference_key)
    AND (v_search IS NULL OR upper(c.search_text) LIKE '%'||v_search||'%')
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
        AND l.image_evidence_type='SELLER_LISTING_IMAGE' AND a.customer_safe));
  RETURN jsonb_build_object('total',v_total,'exact',true,'source','rolex_effective_filtered_v2');
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
  ) ORDER BY array_position(p_listing_keys,c.current_listing_key)),'[]'::jsonb)
  FROM selected c
  LEFT JOIN public.curated_luxury_rolex_latest_price_evidence_v2 p
    ON p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
      AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
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
    JOIN public.curated_luxury_rolex_latest_price_evidence_v2 p
      ON p.run_id=c.run_id AND p.current_listing_key=c.current_listing_key
        AND p.latest_raw_occurrence_key=c.latest_raw_occurrence_key
        AND p.decision='VERIFIED' AND p.price_research_eligible
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

REVOKE ALL ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v4(
  uuid,text[],text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_customer_page_keys_v5(
  uuid,text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.curated_luxury_refresh_rolex_effective_facets_v1(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_customer_count_v3(
  uuid,text[],text[],boolean,boolean,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_customer_cards_v4(uuid,text[])
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.curated_luxury_rolex_price_research_v2(uuid,text,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.curated_luxury_shadow_customer_page_keys_v4(
  uuid,text[],text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_customer_page_keys_v5(
  uuid,text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_refresh_rolex_effective_facets_v1(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_customer_count_v3(
  uuid,text[],text[],boolean,boolean,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_customer_cards_v4(uuid,text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.curated_luxury_rolex_price_research_v2(uuid,text,integer,integer)
  TO service_role;

NOTIFY pgrst,'reload schema';
