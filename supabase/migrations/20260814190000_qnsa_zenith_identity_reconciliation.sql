-- Reconcile the bounded Zenith cohort against immutable source text.
-- No raw rows or listing cardinality are changed. Unsafe identities remain
-- reviewable but are excluded from every customer publication lane.

BEGIN;

CREATE TABLE IF NOT EXISTS staging.qnsa_zenith_identity_reconciliation_audit (
  reconciliation_run_key TEXT NOT NULL,
  listing_id UUID NOT NULL,
  normalization_run_key TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  previous_reference_original TEXT,
  previous_reference_normalized TEXT,
  extracted_references TEXT[] NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('RELEASE_SAFE','QUARANTINE')),
  reason TEXT NOT NULL CHECK (reason IN (
    'ONE_EXACT_ZENITH_REFERENCE','NO_EXACT_ZENITH_REFERENCE',
    'MULTIPLE_ZENITH_REFERENCES','CROSS_BRAND_OR_DAYTONA')),
  corrected_reference TEXT,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reconciliation_run_key, listing_id)
);

ALTER TABLE staging.qnsa_zenith_identity_reconciliation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.qnsa_zenith_identity_reconciliation_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON staging.qnsa_zenith_identity_reconciliation_audit TO service_role;

CREATE OR REPLACE FUNCTION public.qnsa_extract_zenith_references(p_raw TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(array_agg(DISTINCT upper(match[1]) ORDER BY upper(match[1])), ARRAY[]::TEXT[])
  FROM regexp_matches(
    COALESCE(p_raw, ''),
    '\m([0-9]{2}[.][A-Za-z0-9]{3,4}[.][A-Za-z0-9]{3,4}(-[0-9])?(/[A-Za-z0-9]+)?([.][A-Za-z0-9]+)?)\M',
    'g'
  ) AS match;
$$;

CREATE OR REPLACE FUNCTION public.audit_qnsa_zenith_identity_reconciliation(
  p_normalization_run_key TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  WITH cohort AS MATERIALIZED (
    SELECT l.id, l.raw_message_text,
      public.qnsa_extract_zenith_references(l.raw_message_text) AS refs,
      l.raw_message_text ~* '\m(DAYTONA|ROLEX|PATEK([[:space:]]+PHILIPPE)?|BREITLING|AUDEMARS([[:space:]]+PIGUET)?|RICHARD[[:space:]]+MILLE|CARTIER)\M'
        AS has_foreign_identity
    FROM staging.listings l
    JOIN public.raw_message_versions rv
      ON rv.id=l.raw_message_version_id
     AND rv.source_record_id=l.source_record_id
     AND rv.source_hash=l.source_hash
    WHERE l.normalization_run_key=p_normalization_run_key
      AND l.brand_normalized='Zenith'
      AND upper(COALESCE(l.category,''))='WATCH'
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
      AND l.provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
      AND l.source_hash ~ '^[0-9a-f]{64}$'
      AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
  ), classified AS (
    SELECT *, CASE
      WHEN has_foreign_identity THEN 'CROSS_BRAND_OR_DAYTONA'
      WHEN cardinality(refs)=0 THEN 'NO_EXACT_ZENITH_REFERENCE'
      WHEN cardinality(refs)>1 THEN 'MULTIPLE_ZENITH_REFERENCES'
      ELSE 'ONE_EXACT_ZENITH_REFERENCE' END AS reason
    FROM cohort
  )
  SELECT jsonb_build_object(
    'cohort_rows',count(*),
    'release_safe_rows',count(*) FILTER (WHERE reason='ONE_EXACT_ZENITH_REFERENCE'),
    'quarantine_rows',count(*) FILTER (WHERE reason<>'ONE_EXACT_ZENITH_REFERENCE'),
    'reason_counts',COALESCE(jsonb_object_agg(reason,reason_count),'{}'::jsonb),
    'one_reference_rows',count(*) FILTER (WHERE cardinality(refs)=1),
    'multi_reference_rows',count(*) FILTER (WHERE cardinality(refs)>1),
    'no_reference_rows',count(*) FILTER (WHERE cardinality(refs)=0)
  )
  FROM (
    SELECT classified.*, count(*) OVER (PARTITION BY reason) AS reason_count
    FROM classified
  ) counted;
$$;

CREATE OR REPLACE FUNCTION public.apply_qnsa_zenith_identity_reconciliation(
  p_normalization_run_key TEXT,
  p_reconciliation_run_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
DECLARE
  v_total BIGINT;
  v_safe BIGINT;
  v_quarantine BIGINT;
  v_audit_inserted BIGINT;
  v_safe_updated BIGINT;
  v_quarantine_updated BIGINT;
  v_control_enabled BOOLEAN;
BEGIN
  IF p_normalization_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_reconciliation_run_key !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid run key';
  END IF;
  SELECT trading_floor_enabled OR price_research_enabled INTO v_control_enabled
  FROM public.qnsa_two_brand_release_control WHERE canonical_brand='Zenith';
  IF COALESCE(v_control_enabled,true) THEN RAISE EXCEPTION 'Zenith release must be disabled'; END IF;
  PERFORM 1 FROM staging.mariadb_normalization_import_checkpoints
  WHERE run_key=p_normalization_run_key AND status='NORMALIZATION_STAGED'
    AND error_rows=0 AND input_rows=staged_rows+existing_rows+deferred_rows;
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization checkpoint is not reconciled'; END IF;

  CREATE TEMP TABLE zenith_identity_targets ON COMMIT DROP AS
  SELECT l.id,l.normalization_run_key,l.source_record_id,l.source_hash,
    l.reference_original,l.reference_normalized,
    public.qnsa_extract_zenith_references(l.raw_message_text) AS refs,
    CASE
      WHEN l.raw_message_text ~* '\m(DAYTONA|ROLEX|PATEK([[:space:]]+PHILIPPE)?|BREITLING|AUDEMARS([[:space:]]+PIGUET)?|RICHARD[[:space:]]+MILLE|CARTIER)\M'
        THEN 'CROSS_BRAND_OR_DAYTONA'
      WHEN cardinality(public.qnsa_extract_zenith_references(l.raw_message_text))=0
        THEN 'NO_EXACT_ZENITH_REFERENCE'
      WHEN cardinality(public.qnsa_extract_zenith_references(l.raw_message_text))>1
        THEN 'MULTIPLE_ZENITH_REFERENCES'
      ELSE 'ONE_EXACT_ZENITH_REFERENCE' END AS reason
  FROM staging.listings l
  JOIN public.raw_message_versions rv
    ON rv.id=l.raw_message_version_id
   AND rv.source_record_id=l.source_record_id
   AND rv.source_hash=l.source_hash
  WHERE l.normalization_run_key=p_normalization_run_key
    AND l.brand_normalized='Zenith'
    AND upper(COALESCE(l.category,''))='WATCH'
    AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
    AND l.provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'
    AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
    AND l.source_hash ~ '^[0-9a-f]{64}$'
    AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
    AND lower(COALESCE(l.trading_floor_status,'')) NOT IN (
      'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
      'withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED');

  SELECT count(*),count(*) FILTER (WHERE reason='ONE_EXACT_ZENITH_REFERENCE'),
    count(*) FILTER (WHERE reason<>'ONE_EXACT_ZENITH_REFERENCE')
  INTO v_total,v_safe,v_quarantine FROM zenith_identity_targets;
  IF v_total<>464 OR v_safe<400 OR v_safe+v_quarantine<>v_total THEN
    RAISE EXCEPTION 'Zenith identity census failed: total %, safe %, quarantine %',v_total,v_safe,v_quarantine;
  END IF;

  INSERT INTO staging.qnsa_zenith_identity_reconciliation_audit (
    reconciliation_run_key,listing_id,normalization_run_key,source_record_id,source_hash,
    previous_reference_original,previous_reference_normalized,extracted_references,
    decision,reason,corrected_reference
  )
  SELECT p_reconciliation_run_key,id,normalization_run_key,source_record_id,source_hash,
    reference_original,reference_normalized,refs,
    CASE WHEN reason='ONE_EXACT_ZENITH_REFERENCE' THEN 'RELEASE_SAFE' ELSE 'QUARANTINE' END,
    reason,CASE WHEN reason='ONE_EXACT_ZENITH_REFERENCE' THEN refs[1] END
  FROM zenith_identity_targets
  ON CONFLICT (reconciliation_run_key,listing_id) DO NOTHING;
  GET DIAGNOSTICS v_audit_inserted=ROW_COUNT;

  UPDATE staging.listings l SET
    reference_original=t.refs[1],reference_normalized=t.refs[1],
    provenance_metadata=COALESCE(l.provenance_metadata,'{}'::jsonb)||jsonb_build_object(
      'identity_reconciliation_run_key',p_reconciliation_run_key,
      'identity_reconciliation_status','RELEASE_SAFE_EXACT_SOURCE_REFERENCE')
  FROM zenith_identity_targets t
  WHERE l.id=t.id AND t.reason='ONE_EXACT_ZENITH_REFERENCE'
    AND (l.reference_original IS DISTINCT FROM t.refs[1]
      OR l.reference_normalized IS DISTINCT FROM t.refs[1]
      OR l.provenance_metadata->>'identity_reconciliation_run_key' IS DISTINCT FROM p_reconciliation_run_key);
  GET DIAGNOSTICS v_safe_updated=ROW_COUNT;

  UPDATE staging.listings l SET
    publication_review_status='IDENTITY_CONFLICT_PENDING_REVIEW',
    price_research_status='ineligible_identity_conflict',
    provenance_metadata=COALESCE(l.provenance_metadata,'{}'::jsonb)||jsonb_build_object(
      'identity_reconciliation_run_key',p_reconciliation_run_key,
      'identity_reconciliation_status','QUARANTINE','identity_reconciliation_reason',t.reason)
  FROM zenith_identity_targets t
  WHERE l.id=t.id AND t.reason<>'ONE_EXACT_ZENITH_REFERENCE'
    AND (l.publication_review_status IS DISTINCT FROM 'IDENTITY_CONFLICT_PENDING_REVIEW'
      OR l.price_research_status IS DISTINCT FROM 'ineligible_identity_conflict'
      OR l.provenance_metadata->>'identity_reconciliation_run_key' IS DISTINCT FROM p_reconciliation_run_key);
  GET DIAGNOSTICS v_quarantine_updated=ROW_COUNT;

  IF (SELECT count(*) FROM staging.qnsa_zenith_identity_reconciliation_audit
      WHERE reconciliation_run_key=p_reconciliation_run_key)<>v_total
    OR EXISTS (
      SELECT 1 FROM staging.qnsa_zenith_identity_reconciliation_audit a
      JOIN staging.listings l ON l.id=a.listing_id
      WHERE a.reconciliation_run_key=p_reconciliation_run_key AND (
        (a.decision='RELEASE_SAFE' AND l.reference_normalized IS DISTINCT FROM a.corrected_reference)
        OR (a.decision='QUARANTINE' AND l.publication_review_status IS DISTINCT FROM 'IDENTITY_CONFLICT_PENDING_REVIEW')
      )) THEN RAISE EXCEPTION 'Zenith identity reconciliation verification failed';
  END IF;

  RETURN jsonb_build_object(
    'reconciliation_run_key',p_reconciliation_run_key,'cohort_rows',v_total,
    'release_safe_rows',v_safe,'quarantine_rows',v_quarantine,
    'audit_rows_inserted',v_audit_inserted,'safe_rows_updated',v_safe_updated,
    'quarantine_rows_updated',v_quarantine_updated,'staging_row_delta',0,'raw_rows_mutated',0);
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_extract_zenith_references(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_qnsa_zenith_identity_reconciliation(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_qnsa_zenith_identity_reconciliation(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_qnsa_zenith_identity_reconciliation(TEXT) TO service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION public.apply_qnsa_zenith_identity_reconciliation(TEXT,TEXT) TO service_role, postgres, supabase_admin;

COMMIT;
