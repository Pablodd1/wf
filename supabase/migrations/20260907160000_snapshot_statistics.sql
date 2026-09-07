-- Bind statistics, facets and reconciled exclusions to the same frozen evidence.
BEGIN;
CREATE FUNCTION wf_canonical_staging.assert_snapshot_surface(p_snapshot_id uuid, p_surface text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_surface NOT IN ('trading_floor', 'price_research') OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry
    WHERE snapshot_id = p_snapshot_id AND surface = p_surface AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.assert_snapshot_surface(uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_stats(
  p_snapshot_id uuid,
  p_brand text,
  p_reference text,
  p_model text,
  p_dial_color text,
  p_condition text
)
RETURNS TABLE (
  qualified_count bigint, avg_price numeric, min_price numeric, max_price numeric,
  median_price numeric, q1_price numeric, q3_price numeric, iqr numeric,
  lower_fence numeric, upper_fence numeric, iqr_multiplier numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  IF NULLIF(btrim(p_brand), '') IS NULL
     OR (NULLIF(btrim(p_reference), '') IS NULL AND NULLIF(btrim(p_model), '') IS NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT v.price_usd, v.source_created_at, v.listing_id,
      COALESCE(
        NULLIF(v.duplicate_group_id, ''),
        md5(
          COALESCE(NULLIF(v.seller_id, ''), NULLIF(v.seller_display_name, ''), v.source_id, 'UNKNOWN_SELLER') || '|' ||
          lower(trim(v.brand)) || '|' ||
          lower(trim(coalesce(v.reference, v.model, ''))) || '|' ||
          lower(trim(coalesce(v.dial_color, ''))) || '|' ||
          lower(trim(coalesce(v.condition, ''))) || '|' ||
          round(coalesce(v.price_usd, 0))::text
        )
      ) AS group_key
    FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = p_snapshot_id) v
    WHERE v.intent = 'WTS'
      AND v.price_research_eligible IS TRUE
      AND v.included_in_statistics IS TRUE
      AND v.price_usd > 0
      AND v.price_usd <> 'NaN'::numeric
      AND v.price_usd <> 'Infinity'::numeric
      AND (
        upper(v.original_price_currency) = 'USD'
        OR (
          upper(v.original_price_currency) <> 'USD'
          AND v.fx_rate > 0
          AND NULLIF(btrim(v.fx_source), '') IS NOT NULL
          AND v.fx_date IS NOT NULL
        )
      )
      AND lower(v.brand) = lower(p_brand)
      AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND v.dial_color IS NOT DISTINCT FROM p_dial_color
      AND v.condition IS NOT DISTINCT FROM p_condition
  ),
  deduplicated AS (
    SELECT DISTINCT ON (c.group_key) c.price_usd
    FROM candidates c
    ORDER BY c.group_key, c.source_created_at DESC, c.listing_id ASC
  ),
  floor_calc AS (
    -- Market plausibility floor: exact-cohort offers below a quarter of the
    -- cohort median (never below 1000) are parser/currency-error evidence,
    -- not comparable offers. Mirrors marketPlausibilityFloor in
    -- api/_lib/market-stats.cjs.
    SELECT greatest(1000::numeric, round(percentile_cont(0.50) WITHIN GROUP (ORDER BY d.price_usd)::numeric * 0.25)) AS floor
    FROM deduplicated d
  ),
  plausible AS (
    SELECT d.price_usd
    FROM deduplicated d CROSS JOIN floor_calc f
    WHERE d.price_usd >= f.floor
  ),
  quartiles AS (
    SELECT
      count(*)::bigint AS raw_count,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q1,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q3
    FROM plausible p
  ),
  fences AS (
    SELECT
      q.raw_count,
      q.q1,
      q.median,
      q.q3,
      (q.q3 - q.q1) AS iqr,
      greatest(0, q.q1 - 3.0 * (q.q3 - q.q1)) AS lower_fence,
      q.q3 + 3.0 * (q.q3 - q.q1) AS upper_fence
    FROM quartiles q
    WHERE q.raw_count >= 2
  ),
  included AS (
    SELECT p.price_usd, f.q1, f.median, f.q3, f.iqr, f.lower_fence, f.upper_fence
    FROM plausible p
    CROSS JOIN fences f
    WHERE p.price_usd >= f.lower_fence AND p.price_usd <= f.upper_fence
  ),
  aggregated AS (
    SELECT
      count(*)::bigint AS cnt,
      avg(i.price_usd) AS avg_value,
      min(i.price_usd) AS min_value,
      max(i.price_usd) AS max_value,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY i.price_usd)::numeric AS included_median,
      max(i.q1) AS q1,
      max(i.q3) AS q3,
      max(i.iqr) AS iqr,
      max(i.lower_fence) AS lower_fence,
      max(i.upper_fence) AS upper_fence
    FROM included i
  )
  SELECT
    a.cnt AS qualified_count,
    round(a.avg_value, 2) AS avg_price,
    a.min_value AS min_price,
    a.max_value AS max_price,
    round(a.included_median, 2) AS median_price,
    round(a.q1, 2) AS q1_price,
    round(a.q3, 2) AS q3_price,
    round(a.iqr, 2) AS iqr,
    round(a.lower_fence, 2) AS lower_fence,
    round(a.upper_fence, 2) AS upper_fence,
    3.0::numeric AS iqr_multiplier
  FROM aggregated a
  WHERE a.cnt >= 2
    -- Fail closed: never emit inconsistent or non-finite statistics.
    AND a.q1 <= a.included_median
    AND a.included_median <= a.q3
    AND a.q1 <= a.q3
    AND a.lower_fence <= a.upper_fence
    AND a.avg_value <> 'NaN'::numeric AND a.avg_value <> 'Infinity'::numeric
    AND a.included_median <> 'NaN'::numeric AND a.included_median <> 'Infinity'::numeric
    AND a.q1 <> 'NaN'::numeric AND a.q3 <> 'NaN'::numeric
    AND a.iqr <> 'NaN'::numeric
    AND a.lower_fence <> 'NaN'::numeric AND a.upper_fence <> 'NaN'::numeric;
END;
$$;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_stats(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_stats(uuid,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_facets(
  p_snapshot_id uuid,
  p_brand text,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false
)
RETURNS TABLE (
  condition text,
  listing_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  RETURN QUERY
  SELECT
    COALESCE(v.condition, 'Unspecified') AS condition,
    count(*)::bigint AS listing_count
  FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = p_snapshot_id) v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
  GROUP BY COALESCE(v.condition, 'Unspecified')
  ORDER BY listing_count DESC, condition ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_facets(uuid,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_facets(uuid,text,text,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_breakdown(
  p_snapshot_id uuid,
  p_brand text,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false
)
RETURNS TABLE (
  source_observations bigint,
  wts_count bigint,
  wtb_count bigint,
  unique_qualified_offers bigint,
  included_count bigint,
  excluded_duplicates bigint,
  excluded_ambiguous_currency bigint,
  excluded_unsupported_fx bigint,
  excluded_implausible bigint,
  excluded_iqr_outliers bigint,
  excluded_not_wts bigint,
  excluded_ineligible_flag bigint,
  plausibility_floor numeric,
  retained_audit_evidence_count bigint,
  iqr_multiplier numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total bigint := 0;
  v_wts bigint := 0;
  v_wtb bigint := 0;
  v_ex_not_wts bigint := 0;
  v_ex_ineligible bigint := 0;
  v_ex_ambiguous_curr bigint := 0;
  v_ex_unsupported_fx bigint := 0;
  v_unique bigint := 0;
  v_ex_dup bigint := 0;
  v_ex_implausible bigint := 0;
  v_floor numeric := NULL;
  v_included bigint := 0;
  v_ex_outliers bigint := 0;
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'trading_floor');
  -- 1. Source observations on the Trading Floor cohort; WTB kept separate.
  SELECT count(*),
         count(*) FILTER (WHERE v.intent = 'WTS'),
         count(*) FILTER (WHERE v.intent = 'WTB'),
         count(*) FILTER (WHERE v.intent IS DISTINCT FROM 'WTS')
  INTO v_total, v_wts, v_wtb, v_ex_not_wts
  FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = p_snapshot_id) v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);

  -- 2. Priority-ordered single-assignment exclusion buckets, then sequential
  --    dedup -> plausibility floor -> IQR fences. Every WTS row lands in
  --    exactly one bucket or in included_count.
  WITH wts AS (
    SELECT
      v.listing_id,
      v.price_usd,
      CASE
        WHEN v.price_research_eligible IS NOT TRUE
          OR v.included_in_statistics IS NOT TRUE
          OR v.price_usd IS NULL OR v.price_usd <= 0
          OR v.price_usd = 'NaN'::numeric OR v.price_usd = 'Infinity'::numeric
          THEN 'ineligible_flag'
        WHEN upper(COALESCE(v.original_price_currency, '')) <> 'USD'
          AND (v.fx_rate IS NULL OR v.fx_rate <= 0)
          THEN 'ambiguous_currency'
        WHEN upper(COALESCE(v.original_price_currency, '')) <> 'USD'
          AND (NULLIF(btrim(v.fx_source), '') IS NULL OR v.fx_date IS NULL)
          THEN 'unsupported_fx'
        ELSE 'qualified'
      END AS reason,
      COALESCE(
        NULLIF(v.duplicate_group_id, ''),
        md5(
          COALESCE(NULLIF(v.seller_id, ''), NULLIF(v.seller_display_name, ''), v.source_id, 'UNKNOWN_SELLER') || '|' ||
          lower(trim(v.brand)) || '|' ||
          lower(trim(coalesce(v.reference, v.model, ''))) || '|' ||
          lower(trim(coalesce(v.dial_color, ''))) || '|' ||
          lower(trim(coalesce(v.condition, ''))) || '|' ||
          round(coalesce(v.price_usd, 0))::text
        )
      ) AS group_key
    FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = p_snapshot_id) v
    WHERE v.intent = 'WTS'
      AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
      AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
      AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
  ),
  buckets AS (
    SELECT
      count(*) FILTER (WHERE w.reason = 'ineligible_flag') AS ineligible,
      count(*) FILTER (WHERE w.reason = 'ambiguous_currency') AS ambiguous,
      count(*) FILTER (WHERE w.reason = 'unsupported_fx') AS unsupported
    FROM wts w
  ),
  qualified AS (SELECT w.listing_id, w.price_usd, w.group_key FROM wts w WHERE w.reason = 'qualified'),
  deduped AS (
    SELECT DISTINCT ON (q.group_key) q.listing_id, q.price_usd
    FROM qualified q
    ORDER BY q.group_key, q.listing_id ASC
  ),
  floor_calc AS (
    SELECT greatest(1000::numeric, round(percentile_cont(0.50) WITHIN GROUP (ORDER BY d.price_usd)::numeric * 0.25)) AS floor
    FROM deduped d
  ),
  plausible AS (
    SELECT d.listing_id, d.price_usd
    FROM deduped d CROSS JOIN floor_calc f
    WHERE d.price_usd >= f.floor
  ),
  quartiles AS (
    SELECT
      count(*)::bigint AS cnt,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q1,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q3
    FROM plausible p
  ),
  fences AS (
    SELECT greatest(0, q1 - 3.0 * (q3 - q1)) AS lower_fence,
           q3 + 3.0 * (q3 - q1) AS upper_fence
    FROM quartiles
    WHERE cnt >= 2
  ),
  fence_gate AS (SELECT (SELECT count(*) FROM fences) > 0 AS has_fences)
  SELECT
    b.ineligible, b.ambiguous, b.unsupported,
    (SELECT count(*) FROM deduped),
    (SELECT count(*) FROM qualified) - (SELECT count(*) FROM deduped),
    (SELECT count(*) FROM deduped d CROSS JOIN floor_calc f WHERE d.price_usd < f.floor),
    (SELECT floor FROM floor_calc),
    -- F2: with >= 2 plausible offers fences exist and bound inclusion; with
    -- exactly 1 plausible offer it counts as an included observation (scoped
    -- stats separately remain NULL below the minimum sample of 2).
    CASE WHEN (SELECT has_fences FROM fence_gate)
      THEN (SELECT count(*) FROM plausible p CROSS JOIN fences f WHERE p.price_usd >= f.lower_fence AND p.price_usd <= f.upper_fence)
      ELSE (SELECT count(*) FROM plausible)
    END,
    CASE WHEN (SELECT has_fences FROM fence_gate)
      THEN (SELECT count(*) FROM plausible p CROSS JOIN fences f WHERE p.price_usd < f.lower_fence OR p.price_usd > f.upper_fence)
      ELSE 0
    END
  INTO v_ex_ineligible, v_ex_ambiguous_curr, v_ex_unsupported_fx,
       v_unique, v_ex_dup, v_ex_implausible, v_floor, v_included, v_ex_outliers
  FROM buckets b;

  RETURN QUERY
  SELECT
    v_total,
    v_wts,
    v_wtb,
    v_unique,
    v_included,
    v_ex_dup,
    v_ex_ambiguous_curr,
    v_ex_unsupported_fx,
    v_ex_implausible,
    v_ex_outliers,
    v_ex_not_wts,
    v_ex_ineligible,
    v_floor,
    -- F1: every excluded observation is counted in exactly one bucket; the
    -- sum is the retained-evidence total by construction.
    (v_ex_not_wts + v_ex_ineligible + v_ex_ambiguous_curr + v_ex_unsupported_fx
       + v_ex_dup + v_ex_implausible + v_ex_outliers),
    3.0::numeric;
END;
$$;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) TO service_role;

CREATE FUNCTION public.get_price_research_demand_snapshot(p_snapshot_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  SELECT tf.snapshot_id INTO v_id FROM wf_canonical_staging.keyset_snapshot_registry pr
  JOIN wf_canonical_staging.keyset_snapshot_registry tf
    ON tf.publication_revision = pr.publication_revision AND tf.surface = 'trading_floor'
  WHERE pr.snapshot_id = p_snapshot_id AND pr.surface = 'price_research'
    AND pr.expires_at > pg_catalog.now() AND tf.expires_at > pg_catalog.now()
  ORDER BY tf.created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'snapshot_expired: paired publication is unavailable' USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_price_research_demand_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_demand_snapshot(uuid) TO service_role;
COMMIT;
