BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.listing_identity_reviews (
  record_id TEXT PRIMARY KEY REFERENCES public.watch_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (status IN ('UNVERIFIED', 'CATALOG_CONFIRMED', 'CONFLICT', 'HUMAN_APPROVED')),
  canonical_brand TEXT,
  canonical_model TEXT,
  canonical_reference TEXT,
  canonical_dial_color TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_id TEXT,
  review_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT listing_identity_human_review_required CHECK (
    status <> 'HUMAN_APPROVED'
    OR (
      NULLIF(trim(reviewer_id), '') IS NOT NULL
      AND NULLIF(trim(review_reason), '') IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_listing_identity_reviews_status
  ON public.listing_identity_reviews (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.listing_image_reviews (
  source_object_key TEXT PRIMARY KEY
    REFERENCES public.media_manifest(source_object_key) ON DELETE CASCADE,
  record_id TEXT REFERENCES public.watch_records(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'SOURCE_LINKED'
    CHECK (status IN ('SOURCE_LINKED', 'VISUALLY_VERIFIED', 'REJECTED')),
  identity_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_id TEXT,
  review_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT listing_image_review_required CHECK (
    status = 'SOURCE_LINKED'
    OR (
      NULLIF(trim(reviewer_id), '') IS NOT NULL
      AND NULLIF(trim(review_reason), '') IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_listing_image_reviews_queue
  ON public.listing_image_reviews (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_image_reviews_record
  ON public.listing_image_reviews (record_id, status)
  WHERE record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.data_quality_remediation_checkpoints (
  job_name TEXT PRIMARY KEY,
  last_record_id TEXT,
  rows_scanned BIGINT NOT NULL DEFAULT 0,
  rows_written BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_identity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_image_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_quality_remediation_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_identity_reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.listing_image_reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.data_quality_remediation_checkpoints FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.listing_identity_reviews TO service_role;
GRANT ALL ON public.listing_image_reviews TO service_role;
GRANT ALL ON public.data_quality_remediation_checkpoints TO service_role;

INSERT INTO public.listing_image_reviews (
  source_object_key,
  record_id,
  status,
  identity_snapshot,
  evidence
)
SELECT
  m.source_object_key,
  m.matched_record_id,
  'SOURCE_LINKED',
  jsonb_strip_nulls(jsonb_build_object(
    'brand', w.brand,
    'model', w.model,
    'reference', w.reference,
    'dial_color', w.dial_color
  )),
  jsonb_build_object(
    'migration_status', m.migration_status,
    'url_verification_status', m.verification_status,
    'seeded_from_existing_manifest', true
  )
FROM public.media_manifest m
LEFT JOIN public.watch_records w ON w.id = m.matched_record_id
WHERE m.matched_record_id IS NOT NULL
ON CONFLICT (source_object_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_listing_identity_published(p_record_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.listing_identity_reviews r
    WHERE r.record_id = p_record_id
      AND r.status IN ('CATALOG_CONFIRMED', 'HUMAN_APPROVED')
  );
$$;

CREATE OR REPLACE FUNCTION public.verified_listing_thumbnail(p_record_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.public_url
  FROM public.listing_image_reviews r
  JOIN public.media_manifest m
    ON m.source_object_key = r.source_object_key
   AND m.matched_record_id = r.record_id
  WHERE r.record_id = p_record_id
    AND r.status = 'VISUALLY_VERIFIED'
  ORDER BY r.reviewed_at DESC NULLS LAST, r.source_object_key
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_listing_identity_published(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verified_listing_thumbnail(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_listing_identity_published(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verified_listing_thumbnail(TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.trading_floor_verified_listings
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.brand,
  m.reference,
  m.dial_color,
  m.condition,
  m.year,
  m.price_raw,
  m.price_usd,
  m.currency,
  m.confidence,
  m.verdict,
  m.source,
  m.source_type,
  m.listing_type,
  m.listing_date,
  m.listing_status,
  m.created_at,
  public.verified_listing_thumbnail(m.id) IS NOT NULL AS has_images,
  public.verified_listing_thumbnail(m.id) AS thumbnail_url,
  m.region
FROM public.trading_floor_market_listings m
WHERE public.is_listing_identity_published(m.id);

GRANT SELECT ON public.trading_floor_verified_listings TO anon, authenticated;

CREATE OR REPLACE VIEW public.verified_dealer_profile_stats
WITH (security_invoker = true) AS
WITH verified_posts AS (
  SELECT
    w.*,
    CASE
      WHEN w.listing_date ~ '^\d{4}-\d{2}-\d{2}'
        THEN left(w.listing_date, 10)::date::timestamptz
      ELSE NULL
    END AS observed_at
  FROM public.watch_records w
  JOIN public.listing_identity_reviews r
    ON r.record_id = w.id
   AND r.status IN ('CATALOG_CONFIRMED', 'HUMAN_APPROVED')
  WHERE w.dealer_id IS NOT NULL
    AND w.listing_type IS DISTINCT FROM 'MULTI'
    AND NOT (COALESCE(w.flags, '[]'::jsonb) @> '["BUNDLE_SPLIT_REQUIRED"]'::jsonb)
    AND NOT public.is_unsplit_bundle_parent(w.id)
    AND COALESCE(w.verdict, 'HUMAN') <> 'RECYCLE'
    AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('HIDDEN', 'REJECTED', 'DELETED')
)
SELECT
  d.id AS dealer_id,
  count(w.id) AS total_posts,
  count(w.id) FILTER (WHERE w.listing_type = 'WTS') AS wts_posts,
  count(w.id) FILTER (WHERE w.listing_type IN ('WTB', 'NTQ')) AS wtb_posts,
  count(w.id) FILTER (
    WHERE w.listing_type = 'WTS'
      AND COALESCE(w.listing_status, 'ACTIVE') NOT IN ('SOLD', 'WITHDRAWN', 'EXPIRED')
  ) AS active_listings,
  min(w.observed_at) AS first_post_at,
  max(w.observed_at) AS last_post_at,
  count(DISTINCT extract(year FROM w.observed_at)) AS posting_years
FROM public.dealers d
LEFT JOIN verified_posts w ON w.dealer_id = d.id
WHERE d.status = 'VERIFIED'
GROUP BY d.id;

REVOKE ALL ON public.verified_dealer_profile_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.verified_dealer_profile_stats TO service_role;

CREATE OR REPLACE VIEW public.rm_identity_review_queue
WITH (security_invoker = true) AS
SELECT
  w.id AS record_id,
  w.brand,
  w.model,
  w.reference,
  w.dial_color,
  w.listing_type,
  w.raw_message,
  w.created_at,
  COALESCE(r.status, 'UNVERIFIED') AS identity_status,
  r.evidence
FROM public.watch_records w
LEFT JOIN public.listing_identity_reviews r ON r.record_id = w.id
WHERE regexp_replace(upper(COALESCE(w.reference, '')), '[^A-Z0-9]', '', 'g') ~ '^RM[0-9]'
  AND regexp_replace(upper(COALESCE(w.brand, '')), '[^A-Z0-9]', '', 'g') <> 'RICHARDMILLE'
  AND COALESCE(r.status, 'UNVERIFIED') IN ('UNVERIFIED', 'CONFLICT');

CREATE OR REPLACE VIEW public.image_identity_review_queue
WITH (security_invoker = true) AS
SELECT
  m.source_object_key,
  m.public_url,
  m.matched_record_id AS record_id,
  w.brand,
  w.model,
  w.reference,
  w.dial_color,
  w.raw_message,
  COALESCE(r.status, 'SOURCE_LINKED') AS image_status,
  ir.status AS identity_status,
  r.evidence
FROM public.media_manifest m
LEFT JOIN public.watch_records w ON w.id = m.matched_record_id
LEFT JOIN public.listing_image_reviews r ON r.source_object_key = m.source_object_key
LEFT JOIN public.listing_identity_reviews ir ON ir.record_id = m.matched_record_id
WHERE m.matched_record_id IS NOT NULL
  AND COALESCE(r.status, 'SOURCE_LINKED') <> 'VISUALLY_VERIFIED';

CREATE OR REPLACE VIEW public.bundle_parent_review_queue
WITH (security_invoker = true) AS
SELECT
  w.id AS record_id,
  w.brand,
  w.reference,
  w.listing_type,
  w.raw_message,
  s.candidate_count,
  s.change_flags,
  s.review_status,
  s.analyzed_at
FROM public.watch_records w
JOIN public.normalization_shadow_v4 s ON s.source_record_id = w.id
WHERE s.candidate_count > 1
   OR 'BUNDLE_SPLIT_REQUIRED' = ANY(s.change_flags);

REVOKE ALL ON public.rm_identity_review_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.image_identity_review_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bundle_parent_review_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rm_identity_review_queue TO service_role;
GRANT SELECT ON public.image_identity_review_queue TO service_role;
GRANT SELECT ON public.bundle_parent_review_queue TO service_role;

CREATE OR REPLACE FUNCTION public.apply_listing_identity_review(
  p_record_id TEXT,
  p_decision TEXT,
  p_operator_id TEXT,
  p_reason TEXT,
  p_canonical JSONB DEFAULT '{}'::jsonb,
  p_evidence JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision TEXT := upper(trim(COALESCE(p_decision, '')));
BEGIN
  IF v_decision NOT IN ('HUMAN_APPROVED', 'CONFLICT') THEN
    RAISE EXCEPTION 'Human decisions must be HUMAN_APPROVED or CONFLICT';
  END IF;
  IF NULLIF(trim(p_operator_id), '') IS NULL OR NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'operator_id and reason are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.watch_records WHERE id = p_record_id) THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  INSERT INTO public.listing_identity_reviews (
    record_id, status, canonical_brand, canonical_model, canonical_reference,
    canonical_dial_color, evidence, reviewer_id, review_reason, reviewed_at, updated_at
  ) VALUES (
    p_record_id, v_decision, p_canonical->>'brand', p_canonical->>'model',
    p_canonical->>'reference', p_canonical->>'dial_color', COALESCE(p_evidence, '{}'::jsonb),
    p_operator_id, p_reason, now(), now()
  )
  ON CONFLICT (record_id) DO UPDATE SET
    status = EXCLUDED.status,
    canonical_brand = EXCLUDED.canonical_brand,
    canonical_model = EXCLUDED.canonical_model,
    canonical_reference = EXCLUDED.canonical_reference,
    canonical_dial_color = EXCLUDED.canonical_dial_color,
    evidence = EXCLUDED.evidence,
    reviewer_id = EXCLUDED.reviewer_id,
    review_reason = EXCLUDED.review_reason,
    reviewed_at = EXCLUDED.reviewed_at,
    updated_at = now();

  RETURN jsonb_build_object(
    'record_id', p_record_id,
    'status', v_decision,
    'customer_publishable', v_decision = 'HUMAN_APPROVED'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_listing_image_review(
  p_source_object_key TEXT,
  p_record_id TEXT,
  p_decision TEXT,
  p_operator_id TEXT,
  p_reason TEXT,
  p_identity_snapshot JSONB,
  p_evidence JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision TEXT := upper(trim(COALESCE(p_decision, '')));
  v_manifest public.media_manifest;
BEGIN
  IF v_decision NOT IN ('VISUALLY_VERIFIED', 'REJECTED') THEN
    RAISE EXCEPTION 'Image decisions must be VISUALLY_VERIFIED or REJECTED';
  END IF;
  IF NULLIF(trim(p_operator_id), '') IS NULL OR NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'operator_id and reason are required';
  END IF;
  IF COALESCE(p_evidence->>'visual_match', '') = '' THEN
    RAISE EXCEPTION 'Explicit visual_match evidence is required';
  END IF;

  SELECT * INTO v_manifest
  FROM public.media_manifest
  WHERE source_object_key = p_source_object_key
  FOR UPDATE;

  IF NOT FOUND OR v_manifest.matched_record_id IS DISTINCT FROM p_record_id THEN
    RAISE EXCEPTION 'Manifest ownership does not match the reviewed listing';
  END IF;

  INSERT INTO public.listing_image_reviews (
    source_object_key, record_id, status, identity_snapshot, evidence,
    reviewer_id, review_reason, reviewed_at, updated_at
  ) VALUES (
    p_source_object_key, p_record_id, v_decision,
    COALESCE(p_identity_snapshot, '{}'::jsonb), COALESCE(p_evidence, '{}'::jsonb),
    p_operator_id, p_reason, now(), now()
  )
  ON CONFLICT (source_object_key) DO UPDATE SET
    record_id = EXCLUDED.record_id,
    status = EXCLUDED.status,
    identity_snapshot = EXCLUDED.identity_snapshot,
    evidence = EXCLUDED.evidence,
    reviewer_id = EXCLUDED.reviewer_id,
    review_reason = EXCLUDED.review_reason,
    reviewed_at = EXCLUDED.reviewed_at,
    updated_at = now();

  RETURN jsonb_build_object(
    'source_object_key', p_source_object_key,
    'record_id', p_record_id,
    'status', v_decision,
    'customer_visible', v_decision = 'VISUALLY_VERIFIED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_listing_identity_review(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_listing_image_review(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_listing_identity_review(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_listing_image_review(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.stage_listing_identity_classifications(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_status TEXT;
  v_written INTEGER := 0;
  v_preserved INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'Identity staging payload must be an array of at most 1000 rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_status := upper(trim(COALESCE(v_row->>'status', '')));
    IF v_status NOT IN ('UNVERIFIED', 'CATALOG_CONFIRMED', 'CONFLICT') THEN
      RAISE EXCEPTION 'Automated staging cannot create human approval';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.watch_records WHERE id = v_row->>'record_id') THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.listing_identity_reviews
      WHERE record_id = v_row->>'record_id'
        AND status = 'HUMAN_APPROVED'
    ) THEN
      v_preserved := v_preserved + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.listing_identity_reviews (
      record_id, status, canonical_brand, canonical_model, canonical_reference,
      canonical_dial_color, evidence, updated_at
    ) VALUES (
      v_row->>'record_id', v_status, v_row->>'canonical_brand',
      v_row->>'canonical_model', v_row->>'canonical_reference',
      v_row->>'canonical_dial_color', COALESCE(v_row->'evidence', '{}'::jsonb), now()
    )
    ON CONFLICT (record_id) DO UPDATE SET
      status = EXCLUDED.status,
      canonical_brand = EXCLUDED.canonical_brand,
      canonical_model = EXCLUDED.canonical_model,
      canonical_reference = EXCLUDED.canonical_reference,
      canonical_dial_color = EXCLUDED.canonical_dial_color,
      evidence = EXCLUDED.evidence,
      reviewer_id = NULL,
      review_reason = NULL,
      reviewed_at = NULL,
      updated_at = now()
    WHERE public.listing_identity_reviews.status <> 'HUMAN_APPROVED';
    v_written := v_written + 1;
  END LOOP;

  RETURN jsonb_build_object('written', v_written, 'human_approvals_preserved', v_preserved);
END;
$$;

REVOKE ALL ON FUNCTION public.stage_listing_identity_classifications(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_listing_identity_classifications(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_duplicate_review_decision(
  p_candidate_id UUID,
  p_decision TEXT,
  p_operator_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate public.duplicate_review_candidates;
  v_decision TEXT := upper(trim(COALESCE(p_decision, '')));
  v_status TEXT;
BEGIN
  IF v_decision NOT IN ('SUPPRESS', 'KEEP_BOTH', 'DEFER') THEN
    RAISE EXCEPTION 'Unsupported duplicate review decision';
  END IF;
  IF NULLIF(trim(p_operator_id), '') IS NULL OR NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'operator_id and reason are required';
  END IF;

  SELECT * INTO v_candidate
  FROM public.duplicate_review_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND OR v_candidate.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Duplicate candidate is not pending review';
  END IF;

  IF v_decision = 'SUPPRESS'
    AND (
      public.is_unsplit_bundle_parent(v_candidate.canonical_id)
      OR public.is_unsplit_bundle_parent(v_candidate.duplicate_id)
      OR v_candidate.bundle_risk
    ) THEN
    RAISE EXCEPTION 'Split and review bundle children before duplicate suppression';
  END IF;

  v_status := CASE v_decision
    WHEN 'SUPPRESS' THEN 'SUPPRESSED'
    WHEN 'KEEP_BOTH' THEN 'KEEP_BOTH'
    ELSE 'DEFERRED'
  END;

  UPDATE public.duplicate_review_candidates
  SET status = v_status,
      suppress_from_analytics = v_decision = 'SUPPRESS',
      reviewer_id = p_operator_id,
      review_reason = p_reason,
      reviewed_at = now()
  WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'candidate_id', p_candidate_id,
    'decision', v_decision,
    'status', v_status,
    'raw_evidence_preserved', true,
    'watch_records_deleted', false,
    'analytics_suppressed', v_decision = 'SUPPRESS'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_duplicate_review_decision(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_duplicate_review_decision(UUID, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.global_data_quality_blocker_counts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_raw BIGINT := 0;
  v_watch JSONB;
  v_shadow JSONB;
  v_identity JSONB;
  v_images JSONB;
  v_duplicates JSONB;
  v_sellers JSONB;
  v_market BIGINT := 0;
BEGIN
  IF to_regclass('public.raw_records') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.raw_records' INTO v_raw;
  END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'market_intent_total', count(*) FILTER (WHERE is_market_intent),
    'missing_0', count(*) FILTER (WHERE is_market_intent AND missing_count = 0),
    'missing_1', count(*) FILTER (WHERE is_market_intent AND missing_count = 1),
    'missing_2', count(*) FILTER (WHERE is_market_intent AND missing_count = 2),
    'missing_3_plus', count(*) FILTER (WHERE is_market_intent AND missing_count >= 3),
    'catalog_confirmed_legacy', count(*) FILTER (WHERE catalog_confirmed IS TRUE),
    'seller_linked', count(*) FILTER (WHERE dealer_id IS NOT NULL),
    'image_backed', count(*) FILTER (
      WHERE has_images IS TRUE OR NULLIF(trim(thumbnail_url), '') IS NOT NULL
    )
  )
  INTO v_watch
  FROM (
    SELECT
      w.catalog_confirmed,
      w.dealer_id,
      w.has_images,
      w.thumbnail_url,
      w.listing_type IN ('WTS', 'WTB', 'NTQ') AS is_market_intent,
      (
        (NULLIF(trim(w.brand), '') IS NULL)::int
        + (NULLIF(trim(w.model), '') IS NULL)::int
        + (NULLIF(trim(w.reference), '') IS NULL)::int
        + (NULLIF(trim(w.dial_color), '') IS NULL
           OR upper(trim(w.dial_color)) IN ('UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NULL', '-'))::int
        + (w.listing_type = 'WTS' AND w.price_usd IS NULL)::int
      ) AS missing_count
    FROM public.watch_records w
  ) q;

  SELECT jsonb_build_object(
    'total_normalized', count(*),
    'bundle_split_required', count(*) FILTER (
      WHERE candidate_count > 1 OR 'BUNDLE_SPLIT_REQUIRED' = ANY(change_flags)
    ),
    'currency_ambiguous', count(*) FILTER (
      WHERE 'CURRENCY_AMBIGUOUS' = ANY(change_flags)
    ),
    'price_parse_failed', count(*) FILTER (
      WHERE 'PRICE_PARSE_FAILED' = ANY(change_flags)
    ),
    'pending', count(*) FILTER (WHERE review_status = 'PENDING'),
    'approved', count(*) FILTER (WHERE review_status = 'APPROVED'),
    'review', count(*) FILTER (WHERE review_status = 'REVIEW')
  )
  INTO v_shadow
  FROM public.normalization_shadow_v4;

  SELECT jsonb_build_object(
    'total_reviewed', count(*),
    'unverified', count(*) FILTER (WHERE status = 'UNVERIFIED'),
    'catalog_confirmed', count(*) FILTER (WHERE status = 'CATALOG_CONFIRMED'),
    'human_approved', count(*) FILTER (WHERE status = 'HUMAN_APPROVED'),
    'conflict', count(*) FILTER (WHERE status = 'CONFLICT')
  )
  INTO v_identity
  FROM public.listing_identity_reviews;

  SELECT jsonb_build_object(
    'manifest_total', (SELECT count(*) FROM public.media_manifest),
    'manifest_linked', (SELECT count(*) FROM public.media_manifest WHERE matched_record_id IS NOT NULL),
    'source_linked', count(*) FILTER (WHERE status = 'SOURCE_LINKED'),
    'visually_verified', count(*) FILTER (WHERE status = 'VISUALLY_VERIFIED'),
    'rejected', count(*) FILTER (WHERE status = 'REJECTED')
  )
  INTO v_images
  FROM public.listing_image_reviews;

  SELECT jsonb_build_object(
    'total', count(*),
    'pending', count(*) FILTER (WHERE status = 'PENDING'),
    'suppressed', count(*) FILTER (WHERE status = 'SUPPRESSED'),
    'keep_both', count(*) FILTER (WHERE status = 'KEEP_BOTH'),
    'deferred', count(*) FILTER (WHERE status = 'DEFERRED'),
    'bundle_risk', count(*) FILTER (WHERE bundle_risk IS TRUE)
  )
  INTO v_duplicates
  FROM public.duplicate_review_candidates;

  SELECT jsonb_build_object(
    'private_candidates', (SELECT count(*) FROM public.seller_listing_lineage_staging),
    'matched_dealer', (SELECT count(*) FROM public.seller_listing_lineage_staging WHERE matched_dealer_id IS NOT NULL),
    'verified_dealers', (SELECT count(*) FROM public.dealers WHERE status = 'VERIFIED'),
    'consented_dealers', (SELECT count(*) FROM public.dealers WHERE status = 'VERIFIED' AND contact_consent IS TRUE)
  )
  INTO v_sellers;

  SELECT count(*) INTO v_market FROM public.trading_floor_verified_listings;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'exact', true,
    'raw_records', v_raw,
    'watch_records', v_watch,
    'normalization', v_shadow,
    'identity', v_identity,
    'images', v_images,
    'duplicates', v_duplicates,
    'sellers', v_sellers,
    'market_eligible', v_market
  );
END;
$$;

REVOKE ALL ON FUNCTION public.global_data_quality_blocker_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.global_data_quality_blocker_counts() TO service_role;

COMMENT ON TABLE public.listing_identity_reviews IS
  'Private identity publication ledger. Only catalog-confirmed or explicit human-approved rows enter the verified market view.';
COMMENT ON TABLE public.listing_image_reviews IS
  'Private visual verification ledger. URL reachability or filename lineage is not visual identity proof.';
COMMENT ON VIEW public.trading_floor_verified_listings IS
  'Canary-ready customer view: complete market rows with verified identity and only visually verified images.';

NOTIFY pgrst, 'reload schema';
COMMIT;
