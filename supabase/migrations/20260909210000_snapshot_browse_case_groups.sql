-- Align browse groups with existing case-insensitive listing filters.
-- Source-derived labels only; raw evidence, membership and cache entries remain unchanged.
BEGIN;
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
  WITH raw_entries AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(v_entries) AS e(brand text,model text,reference text,listing_count int,wts_count int,wtb_count int,image_url text)
  ), labels AS (
    -- Filters compare case-insensitively. Pick an existing source spelling for
    -- each display group, retaining every stored spelling in the derived cache.
    SELECT min(brand COLLATE "C") OVER (PARTITION BY lower(brand)) brand,
      min(model COLLATE "C") OVER (PARTITION BY lower(brand),lower(model)) model,
      min(reference COLLATE "C") OVER (PARTITION BY lower(brand),lower(reference)) reference,
      listing_count,wts_count,wtb_count,image_url
    FROM raw_entries
  ), entries AS MATERIALIZED (
    SELECT brand,model,reference,sum(listing_count)::int listing_count,
      sum(wts_count)::int wts_count,sum(wtb_count)::int wtb_count,min(image_url) image_url
    FROM labels GROUP BY brand,model,reference
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
