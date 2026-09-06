-- Phase 4 forward-only hardening of the price-research statistics engine.
-- PG15-compatible. No DROP ... CASCADE. No ALTER ... OWNER.
-- Gaps closed (audit vs api/_lib/market-stats.cjs and the canary spec):
--   G1: get_price_research_scoped_stats_v2 ignored the included_in_statistics
--       flag, so rows already excluded as implausible/duplicate by the
--       normalization pipeline leaked into cohort statistics.
--   G2: No market-plausibility floor in SQL; the legacy JS engine excludes
--       offers below max(1000, 0.25 * cohort median) as parser/currency-error
--       evidence. The SQL engine now applies the same floor.
--   G3: Non-finite prices (numeric 'NaN' / 'Infinity') passed the price_usd > 0
--       filter and poisoned percentile_cont; they are now excluded, and the
--       aggregate step fails closed (returns no rows) if any derived value is
--       non-finite or the quartile invariants are violated.
--   G4: get_price_research_cohort_breakdown_v2 could not split ambiguous
--       currency vs unsupported FX, had no implausible-value bucket, and did
--       not report source-observation vs unique-offer counts. Superseded by
--       get_price_research_cohort_breakdown_v3 (new name; v2 is untouched and
--       remains available for existing dependents).
-- Repost dedup key is unchanged in shape: seller identity first, falling back
-- to source_id, so different dealers are never collapsed onto one another;
-- identical seller+ref+dial+condition+rounded-price reposts dedup to one.
BEGIN;

-- ---------------------------------------------------------------------------
-- G1+G2+G3: scoped stats, identical signature (CREATE OR REPLACE is safe).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_price_research_scoped_stats_v2(
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
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
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
    FROM public.price_research_ready_view_v2 v
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

-- ---------------------------------------------------------------------------
-- G4: full evidence-preserving cohort breakdown (new function, new name).
-- v2 is intentionally left in place for existing dependents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_price_research_cohort_breakdown_v3(
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
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_total bigint := 0;
  v_wts bigint := 0;
  v_wtb bigint := 0;
  v_ex_not_wts bigint := 0;
  v_ex_ambiguous_curr bigint := 0;
  v_ex_unsupported_fx bigint := 0;
  v_ex_ineligible bigint := 0;
  v_qualified bigint := 0;
  v_unique bigint := 0;
  v_ex_dup bigint := 0;
  v_ex_implausible bigint := 0;
  v_floor numeric := NULL;
  v_included bigint := 0;
  v_ex_outliers bigint := 0;
BEGIN
  -- 1. Source observations on the Trading Floor cohort; WTB kept separate.
  SELECT count(*),
         count(*) FILTER (WHERE v.intent = 'WTS'),
         count(*) FILTER (WHERE v.intent = 'WTB'),
         count(*) FILTER (WHERE v.intent IS DISTINCT FROM 'WTS')
  INTO v_total, v_wts, v_wtb, v_ex_not_wts
  FROM public.trading_floor_ready_view_v2 v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);

  -- 2. Currency evidence split among WTS observations:
  --    ambiguous = non-USD with no/invalid rate;
  --    unsupported FX = rate present but provenance (source/date) missing.
  SELECT count(*) FILTER (
             WHERE upper(COALESCE(v.original_price_currency, '')) <> 'USD'
               AND (v.fx_rate IS NULL OR v.fx_rate <= 0)),
         count(*) FILTER (
             WHERE upper(COALESCE(v.original_price_currency, '')) <> 'USD'
               AND v.fx_rate > 0
               AND (NULLIF(btrim(v.fx_source), '') IS NULL OR v.fx_date IS NULL)),
         count(*) FILTER (
             WHERE v.price_research_eligible IS NOT TRUE
                OR v.included_in_statistics IS NOT TRUE
                OR v.price_usd IS NULL OR v.price_usd <= 0
                OR v.price_usd = 'NaN'::numeric OR v.price_usd = 'Infinity'::numeric)
  INTO v_ex_ambiguous_curr, v_ex_unsupported_fx, v_ex_ineligible
  FROM public.trading_floor_ready_view_v2 v
  WHERE v.intent = 'WTS'
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);

  -- 3. Qualified unique offers (seller/source-aware repost dedup), plausibility
  --    floor, and 3.0xIQR fences.
  WITH candidate_wts AS (
    SELECT v.listing_id, v.price_usd,
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
    FROM public.price_research_ready_view_v2 v
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
      AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
      AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
      AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
  ),
  counts AS (
    SELECT count(*) AS total_cand FROM candidate_wts
  ),
  deduped AS (
    SELECT DISTINCT ON (c.group_key) c.listing_id, c.price_usd
    FROM candidate_wts c
    ORDER BY c.group_key, c.listing_id ASC
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
  )
  SELECT
    (SELECT total_cand FROM counts),
    (SELECT count(*) FROM deduped),
    (SELECT count(*) FROM deduped d CROSS JOIN floor_calc f WHERE d.price_usd < f.floor),
    (SELECT floor FROM floor_calc),
    COALESCE((SELECT count(*) FROM plausible p CROSS JOIN fences f WHERE p.price_usd >= f.lower_fence AND p.price_usd <= f.upper_fence), (SELECT count(*) FROM plausible)),
    COALESCE((SELECT count(*) FROM plausible p CROSS JOIN fences f WHERE p.price_usd < f.lower_fence OR p.price_usd > f.upper_fence), 0)
  INTO v_qualified, v_unique, v_ex_implausible, v_floor, v_included, v_ex_outliers;

  v_ex_dup := v_qualified - v_unique;

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
    -- Every non-included observation is retained as queryable evidence.
    (v_ex_dup + v_ex_ambiguous_curr + v_ex_unsupported_fx + v_ex_implausible
       + v_ex_outliers + v_ex_not_wts + v_ex_ineligible),
    3.0::numeric;
END;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege, consistent with Phase 3 hardening grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_price_research_scoped_stats_v2(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_cohort_breakdown_v3(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_scoped_stats_v2(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_cohort_breakdown_v3(text,text,text,text,boolean,text,boolean) TO service_role;

COMMIT;
