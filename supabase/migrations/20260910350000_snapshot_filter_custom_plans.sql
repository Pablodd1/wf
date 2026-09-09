-- Preserve exact snapshot membership and all optional filter predicates.
-- Use parameter-specific plans for these two RPCs only.
-- Catalog helper300 rejects blank models and contains only nonblank mapped values;
-- its coalesced expression already covers the Reference-only listings option.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_count(p_snapshot_id uuid, p_demand boolean DEFAULT false, p_brand text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_dial_color text DEFAULT NULL::text, p_filter_dial boolean DEFAULT false, p_condition text DEFAULT NULL::text, p_filter_condition boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v_count bigint;
BEGIN
  IF p_demand IS NULL OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.surface = CASE WHEN p_demand THEN 'trading_floor' ELSE 'price_research' END
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF NOT p_demand AND p_brand IS NULL AND p_reference IS NULL AND p_model IS NULL AND NOT p_filter_dial AND NOT p_filter_condition THEN
    RETURN (SELECT research_display_count FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=wf_canonical_staging.snapshot_data_id(p_snapshot_id));
  END IF;
  SELECT count(*) INTO v_count FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND (p_demand OR EXISTS(SELECT 1 FROM wf_canonical_staging.research_snapshot_admission_v2 a WHERE a.snapshot_id=m.snapshot_id AND a.listing_id=m.listing_id AND a.exclusion_reason IS NULL))
    AND (NOT p_demand OR (m.payload ->> 'intent') = 'WTB')
    AND (p_brand IS NULL OR lower(wf_canonical_staging.published_browse_brand_v1(m.payload ->> 'brand')) = lower(wf_canonical_staging.published_browse_brand_v1(p_brand)))
    AND (p_reference IS NULL OR lower(m.payload ->> 'reference') = lower(p_reference))
    AND (p_model IS NULL OR COALESCE(lower(wf_canonical_staging.published_catalog_model_v1(m.payload->>'model',m.payload->>'brand',m.payload->>'reference')),'reference-only listings')=lower(p_model))
    AND (NOT p_filter_dial OR (m.payload ->> 'dial_color') IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR (m.payload ->> 'condition') IS NOT DISTINCT FROM p_condition);
  RETURN v_count;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_trading_floor_snapshot_count(p_snapshot_id uuid, p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_images_only boolean DEFAULT false, p_priced_only boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
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
    AND (p_brand IS NULL OR lower(wf_canonical_staging.published_browse_brand_v1(m.payload ->> 'brand')) = lower(wf_canonical_staging.published_browse_brand_v1(p_brand)))
    AND (p_model IS NULL OR COALESCE(lower(wf_canonical_staging.published_catalog_model_v1(m.payload->>'model',m.payload->>'brand',m.payload->>'reference')),'reference-only listings')=lower(p_model))
    AND (p_intent IS NULL OR (m.payload ->> 'intent') = upper(p_intent))
    AND (p_category IS NULL
      OR lower(m.payload ->> 'category') = lower(p_category)
      OR (lower(p_category) = 'watches' AND lower(m.payload ->> 'category') = 'wristwatches')
      OR (lower(p_category) IN ('watch','watches','wristwatches') AND lower(m.payload ->> 'category') IN ('watch','watches','wristwatches')))
    AND (p_country IS NULL OR CASE WHEN left(p_country,1)='[' THEN EXISTS
 (SELECT 1 FROM jsonb_array_elements_text(p_country::jsonb) value
  WHERE lower(value)=lower(m.payload->>'location_country'))
 ELSE lower(m.payload->>'location_country')=lower(p_country) END)
    AND (p_region IS NULL OR CASE WHEN left(p_region,1)='[' THEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_region::jsonb) value WHERE lower(value)=lower(m.payload->>'location_region')) ELSE lower(m.payload->>'location_region')=lower(p_region) END)
    AND (NOT p_images_only OR ((m.payload ->> 'image_status') = 'SOURCE_IMAGE_PRESENT'
      AND NULLIF(btrim(m.payload ->> 'image_key'), '') IS NOT NULL))
    AND (NOT p_priced_only OR ((m.payload ->> 'price_usd') IS NOT NULL
      AND (m.payload ->> 'price_usd')::numeric > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(m.payload ->> 'reference', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(wf_canonical_staging.published_catalog_model_v1(m.payload->>'model',m.payload->>'brand',m.payload->>'reference'), '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'title', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(wf_canonical_staging.published_browse_brand_v1(m.payload ->> 'brand'), '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'raw_message_text', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'
       OR lower(COALESCE(m.payload ->> 'source_context_text', '')) LIKE '%' || lower(p_query) || '%'
    ));
  RETURN v_count;
END;
$function$;
COMMIT;
