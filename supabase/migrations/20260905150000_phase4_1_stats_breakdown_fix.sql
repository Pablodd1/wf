-- Phase 4.1: v3 cohort-breakdown bucket correctness fixes (review follow-ups).
-- PG15-compatible. No DROP ... CASCADE. No ALTER ... OWNER.
--
-- F1 (fix): exclusion buckets are now PRIORITY-ORDERED SINGLE ASSIGNMENT so one
--   physical exclusion is counted exactly once. Precedence (documented):
--     ineligible_flag > ambiguous_currency > unsupported_fx
--     > duplicate_repost > implausible > iqr_outlier
--   A row excluded by an earlier stage never reaches a later stage, and the
--   three row-level reasons are assigned by a single priority CASE.
--   Conservation invariant: source_observations = excluded_not_wts
--     + excluded_ineligible_flag + excluded_ambiguous_currency
--     + excluded_unsupported_fx + excluded_duplicates + excluded_implausible
--     + excluded_iqr_outliers + included_count.
--   retained_audit_evidence_count = sum of ALL exclusion buckets (every
--   non-included observation remains queryable evidence).
--
-- F2 (fix): n=1 cohort. The lone qualified offer now counts as an INCLUDED
--   observation (included_count = 1); scoped statistics remain NULL below the
--   minimum sample of 2 (that rule lives in get_price_research_scoped_stats_v2
--   and is unchanged). The dead COALESCE fallback is removed: the old
--   `COALESCE((SELECT count(*) ... CROSS JOIN fences ...), ...)` never fell
--   back because count() over an empty CROSS JOIN returns 0, not NULL. Fence
--   existence is now decided explicitly (fences computed only when the
--   plausible set has >= 2 members).
--
-- F3 (document only): floor-poisoning parity with the legacy JS engine
--   (api/price-research.js:977). The JS engine computes the plausibility floor
--   from the raw cohort median and applies it at classification time; this SQL
--   engine computes the floor from the DEDUPED cohort median and applies it
--   before quartile computation. On cohorts where duplicates skew the median
--   the two engines can disagree on the floor by design of the dedup step;
--   the SQL canonical is authoritative. No behavior change in this patch.
--
-- Defense-in-depth: CHECK constraint rejecting non-finite price_usd on the
-- canary published table (NOT VALID: enforced on new writes immediately,
-- existing rows are not scanned, so the forward migration cannot fail on
-- legacy data).
BEGIN;

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
    FROM public.trading_floor_ready_view_v2 v
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

-- Defense-in-depth: reject non-finite price_usd on new writes. NOT VALID so
-- existing rows are never scanned by this forward migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'wf_canonical_staging'
      AND t.relname = 'mariadb_canary_published_listings_v2'
      AND c.conname = 'mariadb_canary_v2_price_usd_finite'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
      ADD CONSTRAINT mariadb_canary_v2_price_usd_finite
      CHECK (price_usd IS NULL OR (price_usd <> 'NaN'::numeric AND price_usd <> 'Infinity'::numeric)) NOT VALID;
  END IF;
END $$;

-- Least privilege, consistent with Phase 3 (re-asserted; CREATE OR REPLACE
-- preserves ACLs, these statements are belt-and-braces).
REVOKE ALL ON FUNCTION public.get_price_research_cohort_breakdown_v3(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_cohort_breakdown_v3(text,text,text,text,boolean,text,boolean) TO service_role;

COMMIT;
