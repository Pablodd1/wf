BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.stage_listing_identity_classification_batch(
  p_job_name TEXT,
  p_expected_last_record_id TEXT,
  p_last_record_id TEXT,
  p_rows_scanned INTEGER,
  p_rows JSONB,
  p_batch_token TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkpoint public.data_quality_remediation_checkpoints%ROWTYPE;
  v_row JSONB;
  v_result JSONB;
  v_written INTEGER := 0;
  v_preserved INTEGER := 0;
  v_missing INTEGER := 0;
BEGIN
  IF p_job_name !~ '^identity-stage:two_brands:v4:snapshot-[a-f0-9]{12}:partition-[0-7]$' THEN
    RAISE EXCEPTION 'Invalid two-brand catalog staging job';
  END IF;
  IF NULLIF(trim(p_last_record_id), '') IS NULL
    OR NULLIF(trim(p_batch_token), '') IS NULL THEN
    RAISE EXCEPTION 'Last record ID and batch token are required';
  END IF;
  IF p_rows_scanned < 1 OR p_rows_scanned > 250 THEN
    RAISE EXCEPTION 'Two-brand staging batches must scan 1 through 250 rows';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array'
    OR jsonb_array_length(p_rows) > p_rows_scanned THEN
    RAISE EXCEPTION 'Identity rows must be an array bounded by rows scanned';
  END IF;
  IF p_metadata->>'policy_version' <> 'two-brand-catalog-confirmation-v2'
    OR NULLIF(trim(p_metadata->>'snapshot_at'), '') IS NULL THEN
    RAISE EXCEPTION 'Catalog policy version and immutable snapshot are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_job_name, 0));

  SELECT *
  INTO v_checkpoint
  FROM public.data_quality_remediation_checkpoints
  WHERE job_name = p_job_name
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_last_record_id IS NOT NULL THEN
      RAISE EXCEPTION 'Checkpoint does not exist for the expected cursor';
    END IF;
    INSERT INTO public.data_quality_remediation_checkpoints (
      job_name, last_record_id, rows_scanned, rows_written, metadata
    ) VALUES (
      p_job_name, NULL, 0, 0, p_metadata
    )
    RETURNING * INTO v_checkpoint;
  END IF;

  IF NULLIF(v_checkpoint.metadata->>'snapshot_at', '') IS NOT NULL
    AND v_checkpoint.metadata->>'snapshot_at' <> p_metadata->>'snapshot_at' THEN
    RAISE EXCEPTION 'Checkpoint snapshot does not match the requested snapshot';
  END IF;

  IF v_checkpoint.last_record_id = p_last_record_id
    AND v_checkpoint.metadata->>'last_batch_token' = p_batch_token THEN
    RETURN v_checkpoint.metadata->'last_batch_result';
  END IF;

  IF v_checkpoint.last_record_id IS DISTINCT FROM p_expected_last_record_id THEN
    RAISE EXCEPTION 'Stale checkpoint cursor';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF upper(trim(COALESCE(v_row->>'status', ''))) <> 'CATALOG_CONFIRMED'
      OR COALESCE(v_row->>'canonical_brand', '') NOT IN ('Rolex', 'Patek Philippe')
      OR NULLIF(trim(v_row->>'canonical_model'), '') IS NULL
      OR NULLIF(trim(v_row->>'canonical_reference'), '') IS NULL
      OR NULLIF(trim(v_row->>'canonical_dial_color'), '') IS NULL
      OR COALESCE(v_row#>>'{evidence,policy_version}', '') <> 'two-brand-catalog-confirmation-v2'
      OR COALESCE(v_row#>>'{evidence,exact_reference_present_in_raw}', '') <> 'true'
      OR COALESCE(v_row#>>'{evidence,configuration_basis}', '') <> 'EXACT_REFERENCE'
      OR COALESCE(v_row#>>'{evidence,catalog_match_type}', '') NOT IN ('exact', 'exact_alias')
      OR COALESCE(v_row#>>'{evidence,catalog_dial_confirmed}', '') <> 'true' THEN
      RAISE EXCEPTION 'Unsafe automated catalog classification';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.watch_records w
      WHERE w.id = v_row->>'record_id'
        AND lower(trim(w.brand)) IN ('rolex', 'patek philippe')
    ) THEN
      v_missing := v_missing + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.listing_identity_reviews r
      WHERE r.record_id = v_row->>'record_id'
        AND (r.reviewer_id IS NOT NULL OR r.reviewed_at IS NOT NULL)
    ) THEN
      v_preserved := v_preserved + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.listing_identity_reviews (
      record_id, status, canonical_brand, canonical_model, canonical_reference,
      canonical_dial_color, evidence, updated_at
    ) VALUES (
      v_row->>'record_id', 'CATALOG_CONFIRMED', v_row->>'canonical_brand',
      v_row->>'canonical_model', v_row->>'canonical_reference',
      v_row->>'canonical_dial_color', v_row->'evidence', now()
    )
    ON CONFLICT (record_id) DO UPDATE SET
      status = EXCLUDED.status,
      canonical_brand = EXCLUDED.canonical_brand,
      canonical_model = EXCLUDED.canonical_model,
      canonical_reference = EXCLUDED.canonical_reference,
      canonical_dial_color = EXCLUDED.canonical_dial_color,
      evidence = EXCLUDED.evidence,
      updated_at = now()
    WHERE public.listing_identity_reviews.reviewer_id IS NULL
      AND public.listing_identity_reviews.reviewed_at IS NULL;
    IF FOUND THEN v_written := v_written + 1; END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'attempted', jsonb_array_length(p_rows),
    'written', v_written,
    'human_decisions_preserved', v_preserved,
    'missing', v_missing,
    'rows_scanned', p_rows_scanned,
    'last_record_id', p_last_record_id,
    'batch_token', p_batch_token,
    'cumulative_eligible',
      COALESCE((v_checkpoint.metadata->>'eligible_total')::bigint, 0)
        + jsonb_array_length(p_rows),
    'cumulative_preserved',
      COALESCE((v_checkpoint.metadata->>'preserved_total')::bigint, 0) + v_preserved,
    'cumulative_missing',
      COALESCE((v_checkpoint.metadata->>'missing_total')::bigint, 0) + v_missing
  );

  UPDATE public.data_quality_remediation_checkpoints
  SET
    last_record_id = p_last_record_id,
    rows_scanned = rows_scanned + p_rows_scanned,
    rows_written = rows_written + v_written,
    metadata = p_metadata || jsonb_build_object(
      'last_batch_token', p_batch_token,
      'last_batch_result', v_result,
      'eligible_total', v_result->'cumulative_eligible',
      'preserved_total', v_result->'cumulative_preserved',
      'missing_total', v_result->'cumulative_missing'
    ),
    updated_at = now()
  WHERE job_name = p_job_name;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.stage_listing_identity_classification_batch(
  TEXT, TEXT, TEXT, INTEGER, JSONB, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_listing_identity_classification_batch(
  TEXT, TEXT, TEXT, INTEGER, JSONB, TEXT, JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
