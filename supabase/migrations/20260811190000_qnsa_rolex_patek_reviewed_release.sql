-- QNSA Rolex / Patek reviewed-release contract (forward only).
--
-- This migration does not enable or publish either brand. It creates a
-- fail-closed, per-brand release switch and source views over staging.listings.
-- The views never read legacy public.watch_records.
--
-- Product policy:
--   * Trading Floor: reconciled single-item WTS/WTB records, including
--     PENDING_REVIEW and no-price records, clearly labelled for verification.
--   * Price Research WTS: only positive USD prices with explicit source
--     currency evidence and explicit raw-message identity. Pending human review
--     remains visible as provisional evidence; it is not relabelled APPROVED.
--   * WTB: a separate demand view and never part of WTS price calculations.
--   * Bundles, children, unresolved multis, suppressed duplicates, withdrawn,
--     rejected, hidden, deleted, and archived rows are excluded everywhere.
--   * Statistical outliers are retained as evidence and flagged using the
--     repository-standard 3.0 x IQR fences; they are not deleted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.qnsa_two_brand_release_control (
  canonical_brand TEXT PRIMARY KEY,
  trading_floor_enabled BOOLEAN NOT NULL DEFAULT false,
  price_research_enabled BOOLEAN NOT NULL DEFAULT false,
  enabled_run_key TEXT,
  enabled_by UUID,
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  change_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT qnsa_two_brand_release_brand_check
    CHECK (canonical_brand IN ('Rolex', 'Patek Philippe')),
  CONSTRAINT qnsa_two_brand_release_enable_metadata_check
    CHECK (
      (NOT trading_floor_enabled AND NOT price_research_enabled)
      OR (
        enabled_run_key IS NOT NULL
        AND btrim(enabled_run_key) <> ''
        AND enabled_at IS NOT NULL
        AND change_reason IS NOT NULL
        AND btrim(change_reason) <> ''
      )
    )
);

CREATE TABLE IF NOT EXISTS public.qnsa_two_brand_release_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_brand TEXT NOT NULL,
  prior_trading_floor_enabled BOOLEAN,
  trading_floor_enabled BOOLEAN NOT NULL,
  prior_price_research_enabled BOOLEAN,
  price_research_enabled BOOLEAN NOT NULL,
  enabled_run_key TEXT,
  changed_by UUID,
  change_reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot JSONB NOT NULL,
  CONSTRAINT qnsa_two_brand_release_ledger_brand_check
    CHECK (canonical_brand IN ('Rolex', 'Patek Philippe'))
);

ALTER TABLE public.qnsa_two_brand_release_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qnsa_two_brand_release_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.qnsa_two_brand_release_control FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.qnsa_two_brand_release_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.qnsa_two_brand_release_control TO service_role;
GRANT SELECT ON public.qnsa_two_brand_release_ledger TO service_role;

INSERT INTO public.qnsa_two_brand_release_control (
  canonical_brand,
  trading_floor_enabled,
  price_research_enabled,
  change_reason
)
VALUES
  ('Rolex', false, false, 'Forward migration installed; release remains disabled'),
  ('Patek Philippe', false, false, 'Forward migration installed; release remains disabled')
ON CONFLICT (canonical_brand) DO NOTHING;

CREATE OR REPLACE FUNCTION public.audit_qnsa_two_brand_release_control()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.trading_floor_enabled IS NOT DISTINCT FROM NEW.trading_floor_enabled
    AND OLD.price_research_enabled IS NOT DISTINCT FROM NEW.price_research_enabled
    AND OLD.enabled_run_key IS NOT DISTINCT FROM NEW.enabled_run_key
    AND OLD.change_reason IS NOT DISTINCT FROM NEW.change_reason THEN
    RETURN NEW;
  END IF;

  NEW.updated_at := now();
  IF NEW.trading_floor_enabled OR NEW.price_research_enabled THEN
    NEW.enabled_at := COALESCE(NEW.enabled_at, now());
    NEW.disabled_at := NULL;
  ELSE
    NEW.disabled_at := now();
  END IF;

  INSERT INTO public.qnsa_two_brand_release_ledger (
    canonical_brand,
    prior_trading_floor_enabled,
    trading_floor_enabled,
    prior_price_research_enabled,
    price_research_enabled,
    enabled_run_key,
    changed_by,
    change_reason,
    snapshot
  ) VALUES (
    NEW.canonical_brand,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.trading_floor_enabled ELSE NULL END,
    NEW.trading_floor_enabled,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.price_research_enabled ELSE NULL END,
    NEW.price_research_enabled,
    NEW.enabled_run_key,
    NEW.enabled_by,
    NEW.change_reason,
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_qnsa_two_brand_release_control
  ON public.qnsa_two_brand_release_control;
CREATE TRIGGER trg_audit_qnsa_two_brand_release_control
BEFORE INSERT OR UPDATE ON public.qnsa_two_brand_release_control
FOR EACH ROW EXECUTE FUNCTION public.audit_qnsa_two_brand_release_control();

REVOKE ALL ON FUNCTION public.audit_qnsa_two_brand_release_control()
  FROM PUBLIC, anon, authenticated;

-- Internal shared release base. This deliberately selects private seller facts
-- for service-role APIs while retaining contact_consent as the public-display
-- gate. No direct anon/authenticated grant is made on this view.
CREATE OR REPLACE VIEW public.qnsa_rolex_patek_reviewed_release_base AS
SELECT
  l.id,
  l.job_id,
  l.parent_id,
  l.normalization_run_key,
  l.source_record_id,
  l.raw_message_version_id,
  l.source_hash,
  l.source_candidate_hash,
  l.raw_message_text,
  upper(COALESCE(l.listing_type, l.intent, '')) AS listing_type,
  l.brand_original,
  l.brand_normalized,
  l.model_original,
  l.model_normalized,
  l.reference_original,
  l.reference_normalized,
  l.dial_color_original,
  l.dial_color_normalized,
  l.condition_original,
  l.condition_normalized,
  l.box_original,
  l.box_normalized,
  l.papers_original,
  l.papers_normalized,
  l.price_original,
  l.price_normalized,
  l.price_usd,
  l.currency_original,
  l.currency_normalized,
  l.currency_evidence,
  l.conversion_rate,
  l.conversion_timestamp,
  l.image_url,
  l.source_media_key,
  l.source_media_url_candidate,
  l.public_image_eligible,
  COALESCE(l.user_name, l.from_name) AS seller_name,
  l.user_name,
  l.from_name,
  l.contact_number,
  l.from_number,
  l.phone_code,
  NULLIF(btrim(l.location), '') AS location,
  l.rating,
  l.dealer_rating,
  l.company_id,
  l.contact_consent,
  l.catalog_confirmed,
  l.catalog_canonical_confirmed,
  l.identification_status,
  l.overall_confidence,
  l.normalization_status,
  l.publication_review_status,
  l.trading_floor_status,
  l.price_research_status,
  l.verdict,
  l.provenance_metadata,
  l.first_posted_at,
  l.reposted_at,
  l.times_posted,
  l.created_at,
  c.status AS normalization_run_status,
  c.error_rows AS normalization_run_errors,
  control.trading_floor_enabled,
  control.price_research_enabled
FROM staging.listings AS l
JOIN staging.mariadb_normalization_import_checkpoints AS c
  ON c.run_key = l.normalization_run_key
JOIN public.qnsa_two_brand_release_control AS control
  ON control.canonical_brand = l.brand_normalized
 AND control.enabled_run_key = l.normalization_run_key
WHERE l.brand_normalized IN ('Rolex', 'Patek Philippe')
  AND upper(COALESCE(l.category, '')) = 'WATCH'
  AND l.parent_id IS NULL
  AND COALESCE(l.is_bundle, false) = false
  AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
  AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
  AND c.status = 'NORMALIZATION_STAGED'
  AND c.error_rows = 0
  AND l.raw_message_version_id IS NOT NULL
  AND COALESCE(l.source_record_id, '') <> ''
  AND l.source_hash ~ '^[0-9a-f]{64}$'
  AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
  AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
    'bundle_child_pending_review',
    'bundle_pending_separation',
    'suppressed_exact_duplicate',
    'withdrawn',
    'rejected',
    'hidden',
    'deleted',
    'archived'
  )
  AND upper(COALESCE(l.verdict, '')) NOT IN (
    'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED'
  )
  AND lower(COALESCE(l.price_research_status, '')) <> 'suppressed_exact_duplicate';

REVOKE ALL ON public.qnsa_rolex_patek_reviewed_release_base
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qnsa_rolex_patek_reviewed_release_base TO service_role;

-- Trading Floor includes reviewed and pending-review singles, whether priced or
-- unpriced. Human-review state is exposed; it is never converted to APPROVED.
CREATE OR REPLACE VIEW public.qnsa_rolex_patek_trading_floor_source AS
SELECT
  b.id::text AS id,
  b.job_id::text AS job_id,
  b.parent_id::text AS parent_id,
  b.source_record_id,
  b.raw_message_version_id::text AS raw_message_version_id,
  b.source_hash,
  b.source_candidate_hash,
  'MARIADB_IMMUTABLE_RAW'::text AS source_file,
  1 AS source_row_number,
  b.raw_message_text AS raw_message,
  b.listing_type AS intent,
  b.listing_type,
  b.brand_original AS supplied_brand,
  b.brand_normalized AS canonical_brand,
  b.brand_normalized AS brand_scope,
  b.model_original AS model,
  b.model_normalized AS catalog_model,
  b.reference_original AS raw_reference,
  b.reference_normalized AS normalized_reference,
  b.reference_normalized AS catalog_reference,
  b.dial_color_normalized AS dial_color,
  b.dial_color_normalized AS catalog_dial,
  b.condition_normalized AS condition,
  b.box_normalized AS box,
  b.papers_normalized AS papers,
  b.price_normalized AS source_price_amount,
  b.currency_normalized AS source_currency,
  b.price_usd AS workbook_price_usd,
  CASE
    WHEN b.price_normalized > 0 AND b.currency_evidence = 'bare_dollar_unconfirmed'
      THEN '$' || b.price_normalized::text
    WHEN b.price_normalized > 0
      THEN b.price_normalized::text || ' ' || COALESCE(b.currency_normalized, '')
    ELSE 'Price not supplied'
  END AS source_price_text,
  CASE
    WHEN b.currency_normalized IN ('USD', 'USDT') AND b.price_usd > 0
      THEN 'SOURCE_EXPLICIT_USD_MATCH'
    WHEN b.price_usd > 0 AND b.conversion_rate > 0 AND b.conversion_timestamp IS NOT NULL
      THEN 'EXPLICIT_SOURCE_FX_CONVERTED'
    WHEN b.price_normalized > 0
      THEN 'CURRENCY_UNCONFIRMED'
    ELSE 'PRICE_NOT_SUPPLIED'
  END AS price_evidence_status,
  CASE
    WHEN b.public_image_eligible
      AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(b.image_url)
    ELSE NULL
  END AS user_image_url,
  (
    b.public_image_eligible
    AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
  ) AS has_exact_source_image,
  b.seller_name AS posted_by,
  b.seller_name,
  CASE WHEN b.contact_consent THEN COALESCE(b.contact_number, b.from_number) ELSE NULL END AS phone_number,
  CASE WHEN b.contact_consent THEN COALESCE(b.contact_number, b.from_number) ELSE NULL END AS seller_phone,
  b.contact_consent AS contact_publication_approved,
  b.location,
  COALESCE(b.dealer_rating, b.rating) AS dealer_rating,
  b.company_id::text AS dealer_id,
  b.first_posted_at,
  b.reposted_at AS latest_repost_at,
  b.times_posted,
  b.created_at AS posting_date,
  b.created_at AS imported_at,
  b.overall_confidence AS confidence,
  b.normalization_status,
  b.publication_review_status,
  b.verdict,
  b.verdict AS verification_status,
  b.trading_floor_status,
  b.price_research_status,
  CASE
    WHEN b.currency_normalized IN ('USD', 'USDT') AND b.price_usd > 0
      THEN b.price_usd
    WHEN b.price_usd > 0 AND b.conversion_rate > 0 AND b.conversion_timestamp IS NOT NULL
      THEN b.price_usd
    ELSE NULL
  END AS verified_price_usd,
  (
    b.price_usd > 0
    AND (
      b.currency_normalized IN ('USD', 'USDT')
      OR (b.conversion_rate > 0 AND b.conversion_timestamp IS NOT NULL)
    )
  ) AS has_verified_usd_price,
  (b.reference_normalized IS NOT NULL AND btrim(b.reference_normalized) <> '') AS has_complete_identity,
  (b.price_normalized > 0) AS has_supplied_price,
  regexp_replace(upper(COALESCE(b.reference_normalized, b.reference_original, '')), '[^A-Z0-9]', '', 'g') AS reference_search_key,
  'WATCH'::text AS item_category,
  CASE
    WHEN upper(COALESCE(b.verdict, '')) = 'APPROVED'
      OR upper(COALESCE(b.publication_review_status, '')) = 'APPROVED'
      THEN 'APPROVED'
    ELSE 'PENDING_VERIFICATION'
  END AS publication_state,
  'QNSA_ROLEX_PATEK_REVIEWED_V1'::text AS publication_lane,
  true AS normalization_run_complete,
  true AS raw_lineage_verified
FROM public.qnsa_rolex_patek_reviewed_release_base AS b
WHERE b.trading_floor_enabled = true
  AND upper(COALESCE(b.publication_review_status, 'PENDING_REVIEW')) IN (
    'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'
  );

GRANT SELECT ON public.qnsa_rolex_patek_trading_floor_source
  TO anon, authenticated, service_role;

-- Priced WTS evidence. This admits pending human-review rows only when the raw
-- message explicitly contains the normalized reference and source currency is
-- explicit. It does not claim that the pending row is approved.
CREATE OR REPLACE VIEW public.qnsa_rolex_patek_price_research_source AS
SELECT
  b.id::text AS id,
  b.job_id::text AS job_id,
  b.source_record_id,
  b.raw_message_version_id::text AS raw_message_version_id,
  b.source_hash,
  b.source_candidate_hash,
  b.brand_normalized AS brand,
  b.listing_type AS intent,
  b.listing_type,
  b.model_normalized AS model,
  b.reference_normalized AS reference,
  b.reference_normalized AS normalized_reference,
  b.dial_color_normalized AS dial_color,
  b.condition_normalized AS condition,
  b.box_normalized AS box,
  b.papers_normalized AS papers,
  b.price_usd AS price,
  b.price_usd,
  b.price_normalized AS price_raw,
  b.currency_normalized AS currency,
  b.currency_evidence,
  b.raw_message_text AS raw_message,
  '[]'::jsonb AS flags,
  b.seller_name AS posted_by,
  b.seller_name,
  CASE WHEN b.contact_consent THEN COALESCE(b.contact_number, b.from_number) ELSE NULL END AS seller_phone,
  b.contact_consent AS contact_publication_approved,
  b.location,
  COALESCE(b.dealer_rating, b.rating) AS dealer_rating,
  b.company_id::text AS dealer_id,
  'MARIADB_IMMUTABLE_RAW'::text AS source,
  NULL::text AS year,
  b.created_at AS listing_date,
  b.created_at,
  b.first_posted_at,
  b.reposted_at AS latest_repost_at,
  b.times_posted,
  CASE
    WHEN b.public_image_eligible
      AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(b.image_url)
    ELSE NULL
  END AS image_url,
  CASE
    WHEN b.public_image_eligible
      AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(b.image_url)
    ELSE NULL
  END AS thumbnail_url,
  CASE
    WHEN b.public_image_eligible
      AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(b.image_url)
    ELSE NULL
  END AS display_image_url,
  CASE
    WHEN b.public_image_eligible
      AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN jsonb_build_array(btrim(b.image_url))
    ELSE '[]'::jsonb
  END AS image_urls,
  (
    b.public_image_eligible
    AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
  ) AS has_images,
  b.overall_confidence AS confidence,
  b.overall_confidence,
  b.normalization_status,
  b.publication_review_status,
  b.verdict,
  b.verdict AS listing_status,
  b.trading_floor_status,
  b.price_research_status,
  CASE
    WHEN upper(COALESCE(b.verdict, '')) = 'APPROVED'
      OR upper(COALESCE(b.publication_review_status, '')) = 'APPROVED'
      THEN 'APPROVED'
    ELSE 'PROVISIONAL_PENDING_HUMAN_REVIEW'
  END AS analytics_evidence_state,
  'QNSA_ROLEX_PATEK_REVIEWED_V1'::text AS publication_lane,
  true AS raw_lineage_verified
FROM public.qnsa_rolex_patek_reviewed_release_base AS b
WHERE b.price_research_enabled = true
  AND b.listing_type = 'WTS'
  AND b.price_usd > 0
  AND b.price_normalized > 0
  AND b.reference_normalized IS NOT NULL
  AND btrim(b.reference_normalized) <> ''
  AND regexp_replace(upper(b.raw_message_text), '[^A-Z0-9]', '', 'g') LIKE
      '%' || regexp_replace(upper(b.reference_normalized), '[^A-Z0-9]', '', 'g') || '%'
  AND (
    (
      b.currency_normalized IN ('USD', 'USDT')
      AND b.currency_evidence IN (
        'explicit_line_currency',
        'section_context',
        'source_record_currency'
      )
      AND b.price_usd = b.price_normalized
    )
    OR (
      b.currency_normalized NOT IN ('USD', 'USDT')
      AND b.currency_normalized IS NOT NULL
      AND b.currency_evidence IN (
        'explicit_line_currency',
        'section_context',
        'source_record_currency'
      )
      AND b.conversion_rate > 0
      AND b.conversion_timestamp IS NOT NULL
    )
  )
  AND upper(COALESCE(b.publication_review_status, 'PENDING_REVIEW')) IN (
    'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'
  );

GRANT SELECT ON public.qnsa_rolex_patek_price_research_source
  TO anon, authenticated, service_role;

-- WTB demand is deliberately separate from sale-price observations.
CREATE OR REPLACE VIEW public.qnsa_rolex_patek_wtb_demand_source AS
SELECT
  b.id::text AS id,
  b.source_record_id,
  b.raw_message_version_id::text AS raw_message_version_id,
  b.brand_normalized AS brand,
  b.listing_type AS intent,
  b.listing_type,
  b.model_normalized AS model,
  b.reference_normalized AS reference,
  b.dial_color_normalized AS dial_color,
  b.condition_normalized AS condition,
  b.price_usd,
  b.price_normalized AS price_raw,
  b.currency_normalized AS currency,
  b.raw_message_text AS raw_message,
  '[]'::jsonb AS flags,
  b.seller_name AS posted_by,
  b.seller_name,
  CASE WHEN b.contact_consent THEN COALESCE(b.contact_number, b.from_number) ELSE NULL END AS seller_phone,
  b.contact_consent AS contact_publication_approved,
  b.location,
  COALESCE(b.dealer_rating, b.rating) AS dealer_rating,
  b.company_id::text AS dealer_id,
  b.created_at AS listing_date,
  b.created_at,
  'MARIADB_IMMUTABLE_RAW'::text AS source,
  NULL::text AS year,
  CASE
    WHEN b.public_image_eligible
      AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN btrim(b.image_url)
    ELSE NULL
  END AS thumbnail_url,
  CASE
    WHEN b.public_image_eligible
      AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
      THEN jsonb_build_array(btrim(b.image_url))
    ELSE '[]'::jsonb
  END AS image_urls,
  (
    b.public_image_eligible
    AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$'
  ) AS has_images,
  b.overall_confidence AS confidence,
  b.overall_confidence,
  b.publication_review_status,
  b.verdict,
  b.verdict AS listing_status,
  b.trading_floor_status,
  b.price_research_status,
  CASE
    WHEN upper(COALESCE(b.verdict, '')) = 'APPROVED'
      OR upper(COALESCE(b.publication_review_status, '')) = 'APPROVED'
      THEN 'APPROVED_DEMAND'
    ELSE 'PROVISIONAL_PENDING_HUMAN_REVIEW'
  END AS demand_evidence_state,
  true AS raw_lineage_verified
FROM public.qnsa_rolex_patek_reviewed_release_base AS b
WHERE b.price_research_enabled = true
  AND b.listing_type = 'WTB'
  AND b.reference_normalized IS NOT NULL
  AND btrim(b.reference_normalized) <> ''
  AND regexp_replace(upper(b.raw_message_text), '[^A-Z0-9]', '', 'g') LIKE
      '%' || regexp_replace(upper(b.reference_normalized), '[^A-Z0-9]', '', 'g') || '%'
  AND upper(COALESCE(b.publication_review_status, 'PENDING_REVIEW')) IN (
    'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'
  );

GRANT SELECT ON public.qnsa_rolex_patek_wtb_demand_source
  TO anon, authenticated, service_role;

-- Auditable 3.0 x IQR classification by exact brand/reference/dial cohort.
-- Null dial remains a distinct "Unspecified" cohort and is never inferred.
CREATE OR REPLACE VIEW public.qnsa_rolex_patek_price_analytics_evidence AS
WITH observations AS (
  SELECT
    p.*,
    COALESCE(NULLIF(btrim(p.dial_color), ''), 'Unspecified') AS analytics_dial
  FROM public.qnsa_rolex_patek_price_research_source AS p
), cohort_stats AS (
  SELECT
    brand,
    reference,
    analytics_dial,
    count(*) AS source_observation_count,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price_usd) AS q1,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY price_usd) AS median,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price_usd) AS q3
  FROM observations
  GROUP BY brand, reference, analytics_dial
), fences AS (
  SELECT
    s.*,
    s.q3 - s.q1 AS iqr,
    greatest(1000::numeric, round(s.median::numeric * 0.25)) AS market_plausibility_floor,
    s.q1 - (3.0 * (s.q3 - s.q1)) AS lower_fence,
    s.q3 + (3.0 * (s.q3 - s.q1)) AS upper_fence
  FROM cohort_stats AS s
)
SELECT
  o.*,
  o.analytics_dial,
  f.source_observation_count,
  f.q1,
  f.median,
  f.q3,
  f.iqr,
  f.market_plausibility_floor,
  f.lower_fence,
  f.upper_fence,
  (f.source_observation_count >= 2) AS analytics_ready,
  CASE
    WHEN f.source_observation_count < 2 THEN false
    WHEN o.price_usd < f.market_plausibility_floor THEN true
    WHEN o.price_usd < f.lower_fence THEN true
    WHEN o.price_usd > f.upper_fence THEN true
    ELSE false
  END AS is_statistical_outlier,
  CASE
    WHEN f.source_observation_count < 2 THEN 'INSUFFICIENT_MARKET_DATA'
    WHEN o.price_usd < f.market_plausibility_floor THEN 'BELOW_MARKET_PLAUSIBILITY_FLOOR'
    WHEN o.price_usd < f.lower_fence THEN 'BELOW_IQR_FENCE'
    WHEN o.price_usd > f.upper_fence THEN 'ABOVE_IQR_FENCE'
    ELSE NULL
  END AS outlier_reason
FROM observations AS o
JOIN fences AS f
  ON f.brand = o.brand
 AND f.reference = o.reference
 AND f.analytics_dial = o.analytics_dial;

GRANT SELECT ON public.qnsa_rolex_patek_price_analytics_evidence
  TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_two_brand_release_lookup
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    listing_type,
    reference_normalized,
    dial_color_normalized,
    price_usd,
    created_at DESC,
    id DESC
  )
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND brand_normalized IN ('Rolex', 'Patek Philippe');

COMMENT ON TABLE public.qnsa_two_brand_release_control IS
  'Fail-closed per-brand QNSA release switch. Rows are disabled by default and must name the fully reconciled normalization run.';
COMMENT ON TABLE public.qnsa_two_brand_release_ledger IS
  'Append-only audit trail for every QNSA Rolex/Patek release-switch change.';
COMMENT ON VIEW public.qnsa_rolex_patek_trading_floor_source IS
  'Rolex/Patek QNSA Trading Floor singles, including human-review and no-price rows, with immutable lineage and verification state.';
COMMENT ON VIEW public.qnsa_rolex_patek_price_research_source IS
  'Rolex/Patek priced WTS evidence with explicit raw identity/currency; pending human-review rows remain labelled provisional.';
COMMENT ON VIEW public.qnsa_rolex_patek_wtb_demand_source IS
  'Rolex/Patek WTB demand evidence, separate from WTS asking-price analytics.';
COMMENT ON VIEW public.qnsa_rolex_patek_price_analytics_evidence IS
  'Preserved WTS evidence with auditable exact-dial 3.0 x IQR classification; outliers remain queryable and are never deleted.';

COMMIT;
