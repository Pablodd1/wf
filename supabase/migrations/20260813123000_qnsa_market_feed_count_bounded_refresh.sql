BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_market_feed_count_page(
  p_after uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  p_limit integer DEFAULT 5000
)
RETURNS TABLE(next_cursor uuid, page_rows integer, counts jsonb, normalization_run_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run_key text;
  v_categories text[];
BEGIN
  IF p_limit < 1 OR p_limit > 5000 THEN RAISE EXCEPTION 'Page limit must be 1..5000'; END IF;
  SELECT enabled_run_key, enabled_categories INTO v_run_key, v_categories
  FROM public.qnsa_market_feed_control WHERE singleton = true AND enabled = true;
  IF v_run_key IS NULL THEN RAISE EXCEPTION 'QNSA market feed is not enabled'; END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT l.* FROM staging.listings AS l
    WHERE l.normalization_run_key = v_run_key AND l.id > p_after
    ORDER BY l.id ASC LIMIT p_limit
  ), eligible AS (
    SELECT * FROM page AS l
    WHERE l.category = ANY(v_categories)
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle, false) = false
      AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id, '') <> ''
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN
        ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
  ), grouped AS (
    SELECT upper(category)::text AS category,
      COALESCE(NULLIF(btrim(brand_normalized), ''), 'Unspecified')::text AS brand,
      upper(COALESCE(listing_type, intent, ''))::text AS listing_type,
      (COALESCE(price_usd, price_normalized, 0) > 0) AS supplied_price,
      count(*)::bigint AS row_count
    FROM eligible GROUP BY 1,2,3,4
  )
  SELECT (SELECT id FROM page ORDER BY id DESC LIMIT 1), (SELECT count(*)::integer FROM page),
    COALESCE((SELECT jsonb_agg(to_jsonb(grouped)) FROM grouped), '[]'::jsonb), v_run_key;
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_market_feed_count_page(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_market_feed_count_page(uuid, integer) TO service_role, postgres, supabase_admin;

CREATE OR REPLACE FUNCTION public.replace_qnsa_market_feed_count_snapshot(
  p_normalization_run_key text,
  p_counts jsonb
)
RETURNS TABLE(snapshot_rows bigint, total_listings bigint, refreshed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_now timestamptz := clock_timestamp();
BEGIN
  IF COALESCE(jsonb_typeof(p_counts), '') <> 'array' THEN RAISE EXCEPTION 'Counts must be a JSON array'; END IF;
  LOCK TABLE public.qnsa_market_feed_count_snapshot IN EXCLUSIVE MODE;
  DELETE FROM public.qnsa_market_feed_count_snapshot;
  INSERT INTO public.qnsa_market_feed_count_snapshot
    (category, brand, listing_type, supplied_price, row_count, normalization_run_key, refreshed_at)
  SELECT category, brand, listing_type, supplied_price, row_count, p_normalization_run_key, v_now
  FROM jsonb_to_recordset(p_counts) AS x(category text, brand text, listing_type text, supplied_price boolean, row_count bigint)
  WHERE row_count > 0;
  RETURN QUERY SELECT count(*)::bigint, COALESCE(sum(s.row_count),0)::bigint, v_now
  FROM public.qnsa_market_feed_count_snapshot AS s;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_qnsa_market_feed_count_snapshot(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_qnsa_market_feed_count_snapshot(text, jsonb) TO service_role, postgres, supabase_admin;

COMMIT;
