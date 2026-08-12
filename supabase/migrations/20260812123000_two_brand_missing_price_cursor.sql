-- Durable, bounded cursor control for the full Rolex/Patek price-only repair.
-- This private lane scans all eligible existing single WTS staging rows, not
-- merely rows already admitted to a public Trading Floor page.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.mariadb_price_policy_correction_runs (
  correction_run_key TEXT PRIMARY KEY,
  normalization_run_key TEXT NOT NULL REFERENCES staging.mariadb_normalization_import_checkpoints(run_key) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL,
  fx_snapshot JSONB NOT NULL,
  census_rows BIGINT NOT NULL CHECK (census_rows >= 0),
  cursor_listing_id UUID,
  scanned_rows BIGINT NOT NULL DEFAULT 0,
  corrected_rows BIGINT NOT NULL DEFAULT 0,
  skipped_rows BIGINT NOT NULL DEFAULT 0,
  batch_sequence BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'READY',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('READY', 'RUNNING', 'COMPLETE')),
  CHECK (scanned_rows = corrected_rows + skipped_rows),
  CHECK (scanned_rows <= census_rows)
);

ALTER TABLE staging.mariadb_price_policy_correction_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.mariadb_price_policy_correction_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON staging.mariadb_price_policy_correction_runs TO service_role;

CREATE INDEX IF NOT EXISTS idx_staging_two_brand_price_correction_cursor
  ON staging.listings (normalization_run_key, id)
  WHERE brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(listing_type, intent, '')) = 'WTS'
    AND NULLIF(btrim(reference_normalized), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staging_two_brand_missing_price_cursor_20260812124500
  ON staging.listings (normalization_run_key, id)
  WHERE brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(listing_type, intent, '')) = 'WTS'
    AND NULLIF(btrim(reference_normalized), '') IS NOT NULL
    AND (
      COALESCE(price_usd, 0) <= 0
      OR (
        upper(COALESCE(currency_normalized, '')) NOT IN ('USD', 'USDT')
        AND (
          COALESCE(conversion_rate, 0) <= 0
          OR conversion_timestamp IS NULL
          OR NULLIF(btrim(conversion_source), '') IS NULL
        )
      )
    );

CREATE OR REPLACE FUNCTION public.start_mariadb_two_brand_price_correction(
  p_correction_run_key TEXT,
  p_normalization_run_key TEXT,
  p_policy_version TEXT,
  p_fx_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_census BIGINT := 9223372036854775807;
  v_run staging.mariadb_price_policy_correction_runs%ROWTYPE;
BEGIN
  IF p_correction_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_normalization_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_policy_version !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid correction, normalization, or policy key';
  END IF;
  IF COALESCE(p_fx_snapshot->>'observed_at', '') = ''
    OR COALESCE(p_fx_snapshot->>'source', '') = ''
    OR jsonb_typeof(p_fx_snapshot->'usd_per_unit') <> 'object' THEN
    RAISE EXCEPTION 'dated named FX snapshot is required';
  END IF;
  PERFORM 1 FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key = p_normalization_run_key AND status = 'NORMALIZATION_STAGED' AND error_rows = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization run is not complete and reconciled'; END IF;

  INSERT INTO staging.mariadb_price_policy_correction_runs (
    correction_run_key, normalization_run_key, policy_version, fx_snapshot, census_rows
  ) VALUES (p_correction_run_key, p_normalization_run_key, p_policy_version, p_fx_snapshot, v_census)
  ON CONFLICT (correction_run_key) DO NOTHING;

  SELECT * INTO v_run FROM staging.mariadb_price_policy_correction_runs
  WHERE correction_run_key = p_correction_run_key;
  IF v_run.normalization_run_key <> p_normalization_run_key
    OR v_run.policy_version <> p_policy_version THEN
    RAISE EXCEPTION 'correction run configuration or fixed census does not match';
  END IF;
  RETURN to_jsonb(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.qnsa_two_brand_price_correction_page(
  p_correction_run_key TEXT,
  p_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run staging.mariadb_price_policy_correction_runs%ROWTYPE;
  v_records JSONB;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'page limit must be between 1 and 500'; END IF;
  SELECT * INTO v_run FROM staging.mariadb_price_policy_correction_runs
  WHERE correction_run_key = p_correction_run_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'correction run does not exist'; END IF;

  SELECT COALESCE(jsonb_agg(page.payload ORDER BY page.listing_id), '[]'::jsonb) INTO v_records
  FROM (
    WITH bounded_ids AS MATERIALIZED (
      SELECT listing.id
      FROM staging.listings AS listing
      WHERE listing.normalization_run_key = v_run.normalization_run_key
        AND listing.brand_normalized IN ('Rolex', 'Patek Philippe')
        AND upper(COALESCE(listing.category, '')) = 'WATCH'
        AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
        AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
        AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
        AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
        AND listing.source_hash ~ '^[0-9a-f]{64}$'
        AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
          'bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate',
          'withdrawn', 'rejected', 'hidden', 'deleted', 'archived')
        AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
        AND EXISTS (
          SELECT 1 FROM public.raw_message_versions AS version
          WHERE version.id = listing.raw_message_version_id
            AND version.source_record_id = listing.source_record_id
            AND version.source_hash = listing.source_hash
        )
        AND (
          COALESCE(listing.price_usd, 0) <= 0
          OR (
            upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD', 'USDT')
            AND (
              COALESCE(listing.conversion_rate, 0) <= 0
              OR listing.conversion_timestamp IS NULL
              OR NULLIF(btrim(listing.conversion_source), '') IS NULL
            )
          )
        )
        AND (v_run.cursor_listing_id IS NULL OR listing.id > v_run.cursor_listing_id)
      ORDER BY listing.id
      LIMIT p_limit
    )
    SELECT listing.id AS listing_id,
      jsonb_build_object(
        'listing_id', listing.id,
        'source_record_id', listing.source_record_id,
        'source_hash', listing.source_hash,
        'canonical_brand', listing.brand_normalized,
        'normalized_reference', listing.reference_normalized,
        'raw_payload', version.raw_payload
      ) AS payload
    FROM bounded_ids AS bounded
    JOIN staging.listings AS listing ON listing.id = bounded.id
    JOIN public.raw_message_versions AS version
      ON version.id = listing.raw_message_version_id
     AND version.source_record_id = listing.source_record_id
     AND version.source_hash = listing.source_hash
    WHERE listing.normalization_run_key = v_run.normalization_run_key
      AND listing.brand_normalized IN ('Rolex', 'Patek Philippe')
      AND upper(COALESCE(listing.category, '')) = 'WATCH'
      AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
      AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
      AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
      AND (
        COALESCE(listing.price_usd, 0) <= 0
        OR (
          upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD', 'USDT')
          AND (
            COALESCE(listing.conversion_rate, 0) <= 0
            OR listing.conversion_timestamp IS NULL
            OR NULLIF(btrim(listing.conversion_source), '') IS NULL
          )
        )
      )
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND (v_run.cursor_listing_id IS NULL OR listing.id > v_run.cursor_listing_id)
      AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate',
        'withdrawn', 'rejected', 'hidden', 'deleted', 'archived')
      AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
    ORDER BY listing.id
  ) AS page;

  RETURN jsonb_build_object(
    'correction_run_key', v_run.correction_run_key,
    'normalization_run_key', v_run.normalization_run_key,
    'previous_cursor', v_run.cursor_listing_id,
    'census_rows', v_run.census_rows,
    'scanned_rows', v_run.scanned_rows,
    'corrected_rows', v_run.corrected_rows,
    'skipped_rows', v_run.skipped_rows,
    'batch_sequence', v_run.batch_sequence,
    'status', v_run.status,
    'records', v_records
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_mariadb_two_brand_price_correction(
  p_correction_run_key TEXT,
  p_expected_cursor UUID,
  p_next_cursor UUID,
  p_scanned_rows INTEGER,
  p_corrected_rows INTEGER,
  p_skipped_rows INTEGER,
  p_correction_batch_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_run staging.mariadb_price_policy_correction_runs%ROWTYPE;
  v_expected_count BIGINT;
  v_expected_last UUID;
  v_more BOOLEAN;
BEGIN
  IF p_scanned_rows NOT BETWEEN 1 AND 500 OR p_corrected_rows < 0 OR p_skipped_rows < 0
    OR p_corrected_rows + p_skipped_rows <> p_scanned_rows THEN
    RAISE EXCEPTION 'batch accounting is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mariadb_price_policy_full:' || p_correction_run_key));
  SELECT * INTO v_run FROM staging.mariadb_price_policy_correction_runs
  WHERE correction_run_key = p_correction_run_key FOR UPDATE;
  IF NOT FOUND OR v_run.status = 'COMPLETE' OR v_run.cursor_listing_id IS DISTINCT FROM p_expected_cursor THEN
    RAISE EXCEPTION 'stale, completed, or missing correction checkpoint';
  END IF;

  WITH exact_page AS (
    SELECT listing.id
    FROM staging.listings AS listing
    JOIN public.raw_message_versions AS version
      ON version.id = listing.raw_message_version_id
     AND version.source_record_id = listing.source_record_id AND version.source_hash = listing.source_hash
    WHERE listing.normalization_run_key = v_run.normalization_run_key
      AND listing.brand_normalized IN ('Rolex', 'Patek Philippe')
      AND upper(COALESCE(listing.category, '')) = 'WATCH'
      AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
      AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
      AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
      AND (
        COALESCE(listing.price_usd, 0) <= 0
        OR (
          upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD', 'USDT')
          AND (
            COALESCE(listing.conversion_rate, 0) <= 0
            OR listing.conversion_timestamp IS NULL
            OR NULLIF(btrim(listing.conversion_source), '') IS NULL
          )
        )
        OR (
          p_correction_batch_token IS NOT NULL
          AND listing.provenance_metadata->>'price_policy_correction_batch' = p_correction_batch_token
        )
      )
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND (v_run.cursor_listing_id IS NULL OR listing.id > v_run.cursor_listing_id)
      AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate',
        'withdrawn', 'rejected', 'hidden', 'deleted', 'archived')
      AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
    ORDER BY listing.id LIMIT p_scanned_rows
  )
  SELECT count(*), (array_agg(id ORDER BY id DESC))[1]
    INTO v_expected_count, v_expected_last FROM exact_page;
  IF v_expected_count <> p_scanned_rows OR v_expected_last IS DISTINCT FROM p_next_cursor THEN
    RAISE EXCEPTION 'cursor page membership does not reconcile';
  END IF;

  IF p_corrected_rows > 0 THEN
    PERFORM 1 FROM staging.mariadb_price_policy_correction_batches
    WHERE batch_token = p_correction_batch_token AND run_key = v_run.normalization_run_key
      AND source_rows = p_corrected_rows AND corrected_rows = p_corrected_rows;
    IF NOT FOUND THEN RAISE EXCEPTION 'correction batch audit does not reconcile'; END IF;
  ELSIF p_correction_batch_token IS NOT NULL THEN
    RAISE EXCEPTION 'zero-correction page must not claim a correction batch';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM staging.listings AS listing
    WHERE listing.normalization_run_key = v_run.normalization_run_key AND listing.id > p_next_cursor
      AND listing.brand_normalized IN ('Rolex', 'Patek Philippe')
      AND upper(COALESCE(listing.category, '')) = 'WATCH'
      AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle, false) = false
      AND upper(COALESCE(listing.listing_type, listing.intent, '')) = 'WTS'
      AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND NULLIF(btrim(listing.reference_normalized), '') IS NOT NULL
      AND (
        COALESCE(listing.price_usd, 0) <= 0
        OR (
          upper(COALESCE(listing.currency_normalized, '')) NOT IN ('USD', 'USDT')
          AND (
            COALESCE(listing.conversion_rate, 0) <= 0
            OR listing.conversion_timestamp IS NULL
            OR NULLIF(btrim(listing.conversion_source), '') IS NULL
          )
        )
      )
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND EXISTS (
        SELECT 1 FROM public.raw_message_versions AS version
        WHERE version.id = listing.raw_message_version_id
          AND version.source_record_id = listing.source_record_id
          AND version.source_hash = listing.source_hash
      )
      AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate',
        'withdrawn', 'rejected', 'hidden', 'deleted', 'archived')
      AND upper(COALESCE(listing.verdict, '')) NOT IN ('WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED')
  ) INTO v_more;

  UPDATE staging.mariadb_price_policy_correction_runs
  SET cursor_listing_id = p_next_cursor,
      scanned_rows = scanned_rows + p_scanned_rows,
      corrected_rows = corrected_rows + p_corrected_rows,
      skipped_rows = skipped_rows + p_skipped_rows,
      batch_sequence = batch_sequence + 1,
      status = CASE WHEN v_more THEN 'RUNNING' ELSE 'COMPLETE' END,
      census_rows = CASE WHEN v_more THEN census_rows ELSE scanned_rows + p_scanned_rows END,
      updated_at = now(),
      completed_at = CASE WHEN v_more THEN NULL ELSE now() END
  WHERE correction_run_key = p_correction_run_key
  RETURNING * INTO v_run;

  IF NOT v_more AND v_run.scanned_rows <> v_run.census_rows THEN
    RAISE EXCEPTION 'completed correction scan does not match fixed census';
  END IF;
  RETURN to_jsonb(v_run) || jsonb_build_object('staging_rows_created', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.start_mariadb_two_brand_price_correction(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qnsa_two_brand_price_correction_page(TEXT, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.advance_mariadb_two_brand_price_correction(TEXT, UUID, UUID, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_mariadb_two_brand_price_correction(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_mariadb_two_brand_price_correction(TEXT, UUID, UUID, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;

DO $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.qnsa_two_brand_price_correction_page(TEXT, INTEGER) TO %I', current_user);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    GRANT EXECUTE ON FUNCTION public.qnsa_two_brand_price_correction_page(TEXT, INTEGER) TO supabase_admin;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.qnsa_two_brand_price_correction_page(TEXT, INTEGER) IS
  'Private bounded exact-lineage page over all eligible existing Rolex/Patek single WTS staging rows, including rows not currently public.';

COMMIT;
