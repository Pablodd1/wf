BEGIN;

CREATE TABLE IF NOT EXISTS public.qnsa_market_feed_count_snapshot (
  category text NOT NULL,
  brand text NOT NULL,
  listing_type text NOT NULL,
  supplied_price boolean NOT NULL,
  row_count bigint NOT NULL CHECK (row_count >= 0),
  normalization_run_key text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, brand, listing_type, supplied_price)
);

REVOKE ALL ON TABLE public.qnsa_market_feed_count_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.qnsa_market_feed_count_snapshot TO service_role, postgres, supabase_admin;

CREATE OR REPLACE FUNCTION public.refresh_qnsa_market_feed_counts()
RETURNS TABLE(snapshot_rows bigint, total_listings bigint, refreshed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run_key text;
  v_categories text[];
  v_refreshed_at timestamptz := clock_timestamp();
BEGIN
  SELECT enabled_run_key, enabled_categories
  INTO v_run_key, v_categories
  FROM public.qnsa_market_feed_control
  WHERE singleton = true AND enabled = true;
  IF v_run_key IS NULL THEN RAISE EXCEPTION 'QNSA market feed is not enabled'; END IF;

  CREATE TEMP TABLE qnsa_market_feed_count_refresh ON COMMIT DROP AS
  SELECT
    upper(l.category)::text AS category,
    COALESCE(NULLIF(btrim(l.brand_normalized), ''), 'Unspecified')::text AS brand,
    upper(COALESCE(l.listing_type, l.intent, ''))::text AS listing_type,
    (COALESCE(l.price_usd, l.price_normalized, 0) > 0) AS supplied_price,
    count(*)::bigint AS row_count,
    v_run_key::text AS normalization_run_key,
    v_refreshed_at AS refreshed_at
  FROM staging.listings AS l
  WHERE l.normalization_run_key = v_run_key
    AND l.category = ANY(v_categories)
    AND l.parent_id IS NULL
    AND COALESCE(l.is_bundle, false) = false
    AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
    AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
    AND l.raw_message_version_id IS NOT NULL
    AND COALESCE(l.source_record_id, '') <> ''
    AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
      'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
      'withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
  GROUP BY 1,2,3,4;

  DELETE FROM public.qnsa_market_feed_count_snapshot;
  INSERT INTO public.qnsa_market_feed_count_snapshot
    (category, brand, listing_type, supplied_price, row_count, normalization_run_key, refreshed_at)
  SELECT category, brand, listing_type, supplied_price, row_count, normalization_run_key, refreshed_at
  FROM qnsa_market_feed_count_refresh;

  RETURN QUERY
  SELECT count(*)::bigint, COALESCE(sum(s.row_count), 0)::bigint, v_refreshed_at
  FROM public.qnsa_market_feed_count_snapshot AS s;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_qnsa_market_feed_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_qnsa_market_feed_counts() TO service_role, postgres, supabase_admin;

CREATE OR REPLACE FUNCTION public.qnsa_market_feed_counts()
RETURNS TABLE(category text, brand text, listing_type text, supplied_price boolean, row_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT s.category, s.brand, s.listing_type, s.supplied_price, s.row_count
  FROM public.qnsa_market_feed_count_snapshot AS s
  ORDER BY s.category, s.brand, s.listing_type, s.supplied_price DESC;
$$;

REVOKE ALL ON FUNCTION public.qnsa_market_feed_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_market_feed_counts() TO service_role, postgres, supabase_admin;

COMMIT;

