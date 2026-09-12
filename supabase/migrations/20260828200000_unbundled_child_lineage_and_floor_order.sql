-- Make reviewed bundle children first-class, auditable listings.
-- This migration never copies a collapsed parent price to a child.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.watch_staging
  ADD COLUMN IF NOT EXISTS parent_source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_child_id TEXT,
  ADD COLUMN IF NOT EXISTS source_child_index INTEGER,
  ADD COLUMN IF NOT EXISTS raw_child_line TEXT,
  ADD COLUMN IF NOT EXISTS price_evidence_scope TEXT,
  ADD COLUMN IF NOT EXISTS source_currency_evidence TEXT;

ALTER TABLE public.watch_records
  ADD COLUMN IF NOT EXISTS parent_source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_child_id TEXT,
  ADD COLUMN IF NOT EXISTS source_child_index INTEGER,
  ADD COLUMN IF NOT EXISTS raw_child_line TEXT,
  ADD COLUMN IF NOT EXISTS price_evidence_scope TEXT,
  ADD COLUMN IF NOT EXISTS source_currency_evidence TEXT;

-- Existing pending rows are deliberately not bulk-updated here. Re-running the
-- idempotent staging importer populates these columns from preserved JSON/line
-- evidence without scanning or locking the multi-million-row canonical table.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_staging_price_evidence_scope_check') THEN
    ALTER TABLE public.watch_staging ADD CONSTRAINT watch_staging_price_evidence_scope_check
      CHECK (price_evidence_scope IS NULL OR price_evidence_scope IN (
        'EXPLICIT_CHILD_LINE', 'INHERITED_SECTION_CONTEXT',
        'HUMAN_CONFIRMED_CHILD', 'NO_PRICE_EVIDENCE', 'REVIEW_REQUIRED'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_records_price_evidence_scope_check') THEN
    ALTER TABLE public.watch_records ADD CONSTRAINT watch_records_price_evidence_scope_check
      CHECK (price_evidence_scope IS NULL OR price_evidence_scope IN (
        'EXPLICIT_CHILD_LINE', 'INHERITED_SECTION_CONTEXT',
        'HUMAN_CONFIRMED_CHILD', 'NO_PRICE_EVIDENCE', 'REVIEW_REQUIRED'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_staging_unbundled_parent_fk') THEN
    ALTER TABLE public.watch_staging ADD CONSTRAINT watch_staging_unbundled_parent_fk
      FOREIGN KEY (parent_source_id) REFERENCES public.watch_records(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_records_unbundled_parent_fk') THEN
    ALTER TABLE public.watch_records ADD CONSTRAINT watch_records_unbundled_parent_fk
      FOREIGN KEY (parent_source_id) REFERENCES public.watch_records(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_staging_unbundled_source_child
  ON public.watch_staging (source_child_id)
  WHERE source_child_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_records_unbundled_source_child
  ON public.watch_records (source_child_id)
  WHERE source_child_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_watch_staging_unbundled_parent_child
  ON public.watch_staging (parent_source_id, source_child_index)
  WHERE parent_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_watch_records_unbundled_parent_child
  ON public.watch_records (parent_source_id, source_child_index)
  WHERE parent_source_id IS NOT NULL;

CREATE OR REPLACE VIEW public.two_brand_verified_trading_display_source
WITH (security_invoker = true) AS
SELECT
  c.*,
  (c.price_usd IS NOT NULL AND c.price_usd > 0) AS has_display_price,
  COALESCE(c.has_images, false) AS has_source_image
FROM public.two_brand_verified_trading_release_cache c;

CREATE OR REPLACE VIEW public.three_brand_verified_trading_display_source
WITH (security_invoker = true) AS
SELECT
  c.*,
  (c.price_usd IS NOT NULL AND c.price_usd > 0) AS has_display_price,
  COALESCE(c.has_images, false) AS has_source_image
FROM public.three_brand_verified_trading_release_cache c;

REVOKE ALL ON public.two_brand_verified_trading_display_source,
  public.three_brand_verified_trading_display_source FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.two_brand_verified_trading_display_source,
  public.three_brand_verified_trading_display_source TO service_role;

CREATE OR REPLACE FUNCTION public.apply_unbundled_staging_review_decision(
  p_staging_id UUID,
  p_decision TEXT,
  p_operator_id TEXT,
  p_reason TEXT DEFAULT NULL,
  p_duplicate_reviewed BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage public.watch_staging;
  v_published_id TEXT;
  v_audit_id UUID;
  v_review_bucket TEXT;
BEGIN
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'Unsupported review decision'; END IF;
  IF NULLIF(trim(p_operator_id), '') IS NULL THEN RAISE EXCEPTION 'operator_id is required'; END IF;
  IF p_decision = 'REJECTED' AND NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_stage FROM public.watch_staging WHERE id = p_staging_id FOR UPDATE;
  IF NOT FOUND OR v_stage.verdict <> 'PENDING' THEN RAISE EXCEPTION 'Pending staging row not found'; END IF;
  v_review_bucket := v_stage.field_confidence ->> 'review_bucket';

  IF p_decision = 'APPROVED' THEN
    IF p_duplicate_reviewed IS NOT TRUE
      OR v_review_bucket <> 'review-ready'
      OR COALESCE((v_stage.field_confidence ->> 'exact_raw_lineage')::boolean, false) IS NOT TRUE
      OR COALESCE((v_stage.field_confidence ->> 'catalog_confirmed')::boolean, false) IS NOT TRUE
      OR NULLIF(trim(v_stage.brand), '') IS NULL
      OR NULLIF(trim(v_stage.reference), '') IS NULL
      OR NULLIF(trim(v_stage.listing_type), '') IS NULL
      OR NULLIF(trim(v_stage.parent_source_id), '') IS NULL
      OR NULLIF(trim(v_stage.source_child_id), '') IS NULL
      OR v_stage.source_child_index IS NULL
      OR NULLIF(trim(v_stage.raw_child_line), '') IS NULL
      OR v_stage.price_evidence_scope IS NULL
      OR v_stage.price_evidence_scope = 'REVIEW_REQUIRED'
      OR (v_stage.price_evidence_scope = 'NO_PRICE_EVIDENCE' AND (
        v_stage.price_raw IS NOT NULL OR v_stage.price_usd IS NOT NULL OR v_stage.currency IS NOT NULL
      ))
      OR (v_stage.price_evidence_scope IN (
        'EXPLICIT_CHILD_LINE', 'INHERITED_SECTION_CONTEXT', 'HUMAN_CONFIRMED_CHILD'
      ) AND (
        v_stage.price_raw IS NULL OR v_stage.price_raw <= 0
        OR NULLIF(trim(v_stage.currency), '') IS NULL
        OR NULLIF(trim(v_stage.source_currency_evidence), '') IS NULL
        OR (v_stage.price_usd IS NOT NULL AND v_stage.price_usd <= 0)
      ))
      OR NOT EXISTS (SELECT 1 FROM public.watch_records p WHERE p.id = v_stage.parent_source_id) THEN
      RAISE EXCEPTION 'Staging row does not meet child-lineage approval policy';
    END IF;

    v_published_id := v_stage.id::text;
    INSERT INTO public.watch_records (
      id, brand, reference, dial_color, condition, year, price_raw, price_usd,
      currency, confidence, verdict, source, raw_message, flags, created_at,
      processed_at, parser_version, listing_type, accessories, field_confidence,
      human_edited, edit_source, image_urls, thumbnail_url, has_images,
      review_reason, listing_status, parent_source_id, source_child_id,
      source_child_index, raw_child_line, price_evidence_scope,
      source_currency_evidence
    ) VALUES (
      v_published_id, v_stage.brand, v_stage.reference, v_stage.dial_color,
      v_stage.condition, v_stage.year, v_stage.price_raw, v_stage.price_usd,
      v_stage.currency, 100, 'APPROVED', v_stage.source, v_stage.raw_message,
      v_stage.flags, v_stage.created_at, now(), v_stage.parser_version,
      v_stage.listing_type, v_stage.accessories, v_stage.field_confidence,
      true, 'human_review:unbundled:' || p_operator_id,
      v_stage.image_urls, v_stage.thumbnail_url, v_stage.has_images,
      p_reason, 'ACTIVE', v_stage.parent_source_id, v_stage.source_child_id,
      v_stage.source_child_index, v_stage.raw_child_line,
      v_stage.price_evidence_scope, v_stage.source_currency_evidence
    ) ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION 'Published record already exists'; END IF;
  END IF;

  INSERT INTO public.unbundled_staging_review_audit (
    staging_id, batch_id, decision, operator_id, reason, staged_values, published_record_id
  ) VALUES (
    v_stage.id, v_stage.batch_id, p_decision, p_operator_id, p_reason,
    to_jsonb(v_stage) || jsonb_build_object('duplicate_reviewed', p_duplicate_reviewed), v_published_id
  ) RETURNING id INTO v_audit_id;

  UPDATE public.watch_staging
  SET verdict = p_decision,
      confidence = CASE WHEN p_decision = 'APPROVED' THEN 100 ELSE 0 END,
      human_edited = true,
      processed_at = now()
  WHERE id = p_staging_id;

  RETURN jsonb_build_object(
    'audit_id', v_audit_id,
    'staging_id', p_staging_id,
    'review_status', p_decision,
    'published', p_decision = 'APPROVED',
    'published_record_id', v_published_id,
    'confidence', CASE WHEN p_decision = 'APPROVED' THEN 100 ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_unbundled_staging_review_decision(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_unbundled_staging_review_decision(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE VIEW public.unbundled_child_publication_status
WITH (security_invoker = true) AS
SELECT
  w.id,
  w.parent_source_id,
  w.source_child_id,
  w.source_child_index,
  w.price_evidence_scope,
  true AS trading_floor_ready,
  (
    w.price_usd IS NOT NULL
    AND w.price_usd > 0
    AND w.price_evidence_scope IN (
      'EXPLICIT_CHILD_LINE', 'INHERITED_SECTION_CONTEXT', 'HUMAN_CONFIRMED_CHILD'
    )
  ) AS price_research_ready
FROM public.watch_records w
WHERE COALESCE(w.flags, '[]'::jsonb) @> '["UNBUNDLED_CHILD"]'::jsonb
  AND w.parent_source_id IS NOT NULL
  AND w.source_child_id IS NOT NULL
  AND COALESCE(w.verdict, 'HUMAN') <> 'RECYCLE'
  AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED');

REVOKE ALL ON public.unbundled_child_publication_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.unbundled_child_publication_status TO service_role;

COMMENT ON VIEW public.unbundled_child_publication_status IS
  'Service-only child readiness ledger. Unpriced children remain Trading Floor eligible; Price Research requires positive USD plus accepted child-level evidence.';

NOTIFY pgrst, 'reload schema';
COMMIT;
