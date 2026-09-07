-- Phase 3 forward-only hardening for the v2 publication canary.
-- PG15-compatible common denominator; no PG16/17/18-only features.
-- No DROP ... CASCADE. No ALTER ... OWNER. No ADD CONSTRAINT IF NOT EXISTS.
-- (a) Pins search_path on wf_canonical_staging.reconcile_raw_partitions
--     (previously SECURITY DEFINER without a pinned search_path) via
--     CREATE OR REPLACE with an identical signature, so dependents survive.
-- (b) Least-privilege grant hygiene for all V2 canary objects.
-- (c) Additive keyset indexes (equality-filter column first).
-- (d) V2 views contain no ORDER BY (audited; nothing to remove).
BEGIN;

-- ---------------------------------------------------------------
-- (a) Recreate reconcile_raw_partitions with pinned search_path.
-- Identical signature, argument name, return type, language and
-- SECURITY DEFINER mode; only the search_path is pinned and object
-- references are fully qualified. Behavior is unchanged.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION wf_canonical_staging.reconcile_raw_partitions(p_test_run_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reconciled INT := 0;
  v_quarantined INT := 0;
BEGIN
  -- 1. Exact matches (identical source_id and source_hash)
  INSERT INTO wf_canonical_staging.raw_duplicate_reconciliation_ledger
    (source_id, test_run_id, resolution_status, raw_count, distinct_hashes, source_hash, action, logged_at, resolved_at)
  SELECT
    a.source_id,
    p_test_run_id,
    'RECONCILED_EXACT_MATCH',
    2,
    1,
    a.source_hash,
    'DEDUPLICATED_LOSSLESS',
    pg_catalog.now(),
    pg_catalog.now()
  FROM wf_canonical_staging.raw_partition_alpha a
  JOIN wf_canonical_staging.raw_partition_beta b
    ON a.source_id = b.source_id
   AND a.source_hash = b.source_hash
   AND a.test_run_id = p_test_run_id
   AND b.test_run_id = p_test_run_id;

  GET DIAGNOSTICS v_reconciled = ROW_COUNT;

  -- 2. Conflicts (identical source_id, mismatched source_hash)
  INSERT INTO wf_canonical_staging.quarantined_conflicting_revisions
    (source_id, test_run_id, conflict_reason, partition_a, hash_a, timestamp_a, partition_b, hash_b, timestamp_b, remediation_status, quarantined_at)
  SELECT
    a.source_id,
    p_test_run_id,
    'PARTITION_HASH_MISMATCH',
    'raw_partition_alpha',
    a.source_hash,
    a.created_at,
    'raw_partition_beta',
    b.source_hash,
    b.created_at,
    'QUARANTINED_PENDING_MANUAL_REVIEW',
    pg_catalog.now()
  FROM wf_canonical_staging.raw_partition_alpha a
  JOIN wf_canonical_staging.raw_partition_beta b
    ON a.source_id = b.source_id
   AND a.source_hash <> b.source_hash
   AND a.test_run_id = p_test_run_id
   AND b.test_run_id = p_test_run_id;

  GET DIAGNOSTICS v_quarantined = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'reconciled_exact', v_reconciled,
    'quarantined_conflicts', v_quarantined
  );
END;
$$;

-- ---------------------------------------------------------------
-- (b) Least-privilege grant hygiene.
-- Functions grant EXECUTE to PUBLIC by default; revoke it on every
-- wf_canonical_staging function, then re-grant only the intended
-- service_role execute on the reconciliation RPC.
-- ---------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wf_canonical_staging FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wf_canonical_staging FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION wf_canonical_staging.reconcile_raw_partitions(text) TO service_role;

-- Trigger function fires via trigger; no caller needs EXECUTE.
REVOKE ALL ON FUNCTION wf_canonical_staging.trg_canary_listings_intent_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION wf_canonical_staging.trg_canary_listings_intent_audit() FROM anon, authenticated, service_role;

-- Schema-level: anon/authenticated/PUBLIC must have no staging access.
REVOKE ALL ON SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA wf_canonical_staging TO service_role;

-- Table-level: no PUBLIC/anon/authenticated rights; service_role reads only
-- the published canary table (explicit narrow grant, never ALL).
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON wf_canonical_staging.mariadb_canary_published_listings_v2 TO service_role;

-- Public V2 views: security_invoker views for service_role only.
REVOKE ALL ON public.trading_floor_ready_view_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.price_research_ready_view_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.listing_display_detail_view_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_listing_analytics_view_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.trading_floor_ready_view_v2, public.price_research_ready_view_v2,
  public.listing_display_detail_view_v2, public.seller_listing_analytics_view_v2 TO service_role;

-- Public V2 RPCs: service_role only; PUBLIC default EXECUTE revoked.
REVOKE ALL ON FUNCTION public.get_trading_floor_canary_keyset(integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_trading_floor_canary_count(text,text,text,text,text,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_canary_keyset_v2(integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_scoped_stats_v2(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_wtb_demand_v2(integer,integer,text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_wts_count(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_wtb_count(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_condition_facets_v2(text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_cohort_breakdown_v2(text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_keyset(integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_count(text,text,text,text,text,text,text,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_canary_keyset_v2(integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_scoped_stats_v2(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_wtb_demand_v2(integer,integer,text,text,text,text,boolean,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_wts_count(text,text,text,text,boolean,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_wtb_count(text,text,text,text,boolean,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_condition_facets_v2(text,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_cohort_breakdown_v2(text,text,text,text,boolean,text,boolean) TO service_role;

-- ---------------------------------------------------------------
-- (c) Additive keyset indexes. Five-field keyset order:
-- priced_rank, image_rank, price_usd DESC NULLS LAST,
-- source_created_at DESC, listing_id. Equality-filter columns lead.
-- IF NOT EXISTS only; no CONCURRENTLY (transaction-safe).
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mariadb_canary_v2_keyset_brand_eq
ON wf_canonical_staging.mariadb_canary_published_listings_v2 (
  lower(brand),
  (CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END),
  (CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT'
          AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END),
  price_usd DESC NULLS LAST,
  source_created_at DESC,
  listing_id ASC
);

CREATE INDEX IF NOT EXISTS idx_mariadb_canary_v2_keyset_wts_eligible
ON wf_canonical_staging.mariadb_canary_published_listings_v2 (
  (CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END),
  (CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT'
          AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END),
  price_usd DESC NULLS LAST,
  source_created_at DESC,
  listing_id ASC
)
WHERE intent = 'WTS' AND price_research_eligible IS TRUE AND price_usd > 0;

COMMIT;
