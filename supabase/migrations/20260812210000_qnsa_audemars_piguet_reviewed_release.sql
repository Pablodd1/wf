-- QNSA Audemars Piguet reviewed-release extension (forward only).
--
-- Extends the existing fail-closed Rolex/Patek contract without renaming its
-- public API objects. Audemars Piguet is installed disabled and can only be
-- armed/enabled for a completed, error-free normalized staging run. No legacy
-- public.watch_records data is read or written.

BEGIN;

ALTER TABLE public.qnsa_two_brand_release_control
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_brand_check;
ALTER TABLE public.qnsa_two_brand_release_control
  ADD CONSTRAINT qnsa_two_brand_release_brand_check
  CHECK (canonical_brand IN ('Rolex', 'Patek Philippe', 'Audemars Piguet'));

ALTER TABLE public.qnsa_two_brand_release_ledger
  DROP CONSTRAINT IF EXISTS qnsa_two_brand_release_ledger_brand_check;
ALTER TABLE public.qnsa_two_brand_release_ledger
  ADD CONSTRAINT qnsa_two_brand_release_ledger_brand_check
  CHECK (canonical_brand IN ('Rolex', 'Patek Philippe', 'Audemars Piguet'));

INSERT INTO public.qnsa_two_brand_release_control (
  canonical_brand,
  trading_floor_enabled,
  price_research_enabled,
  change_reason
)
VALUES (
  'Audemars Piguet',
  false,
  false,
  'Audemars Piguet reviewed-release extension installed; release remains disabled'
)
ON CONFLICT (canonical_brand) DO NOTHING;

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
  COALESCE(
    NULLIF(btrim(l.image_url), ''),
    NULLIF(btrim(l.source_media_url_candidate), '')
  ) AS image_url,
  l.source_media_key,
  l.source_media_url_candidate,
  (
    COALESCE(NULLIF(btrim(l.image_url), ''), NULLIF(btrim(l.source_media_url_candidate), ''))
      ~* '^https?://[^[:space:]]+$'
  ) AS public_image_eligible,
  COALESCE(
    NULLIF(btrim(l.user_name), ''),
    NULLIF(btrim(l.from_name), ''),
    NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), '')
  )::varchar(150) AS seller_name,
  COALESCE(NULLIF(btrim(l.user_name), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), ''))::varchar(150) AS user_name,
  COALESCE(NULLIF(btrim(l.from_name), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_name}'), ''))::varchar(150) AS from_name,
  COALESCE(NULLIF(btrim(l.contact_number), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), ''))::varchar(50) AS contact_number,
  COALESCE(NULLIF(btrim(l.from_number), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,from_number}'), ''))::varchar(50) AS from_number,
  COALESCE(NULLIF(btrim(l.phone_code), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,phone_code}'), ''))::varchar(10) AS phone_code,
  COALESCE(NULLIF(btrim(l.location), ''), NULLIF(btrim(rv.raw_payload#>>'{raw_data,region}'), '')) AS location,
  l.rating,
  COALESCE(
    l.dealer_rating,
    CASE
      WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}', '') ~ '^[0-9]+([.][0-9]+)?$'
        THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric
      ELSE NULL
    END
  )::numeric(5,2) AS dealer_rating,
  COALESCE(
    l.company_id,
    CASE
      WHEN COALESCE(rv.raw_payload#>>'{raw_data,company_id}', '') ~ '^[0-9]+$'
        THEN (rv.raw_payload#>>'{raw_data,company_id}')::integer
      ELSE NULL
    END
  ) AS company_id,
  (
    NULLIF(btrim(COALESCE(l.contact_number, l.from_number, rv.raw_payload#>>'{raw_data,from_number}')), '')
      IS NOT NULL
  ) AS contact_consent,
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
JOIN public.raw_message_versions AS rv
  ON rv.id = l.raw_message_version_id
 AND rv.source_record_id = l.source_record_id
 AND rv.source_hash = l.source_hash
JOIN staging.mariadb_normalization_import_checkpoints AS c
  ON c.run_key = l.normalization_run_key
JOIN public.qnsa_two_brand_release_control AS control
  ON control.canonical_brand = l.brand_normalized
 AND control.enabled_run_key = l.normalization_run_key
WHERE l.brand_normalized IN ('Rolex', 'Patek Philippe', 'Audemars Piguet')
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

COMMENT ON VIEW public.qnsa_rolex_patek_reviewed_release_base IS
  'Compatibility-named QNSA reviewed release base for Rolex, Patek Philippe and Audemars Piguet; exact immutable lineage and single-watch gates required.';

REVOKE ALL ON public.qnsa_rolex_patek_reviewed_release_base
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qnsa_rolex_patek_reviewed_release_base TO service_role;

-- AP-specific partial indexes extend the existing two-brand indexes without
-- rebuilding or replacing the proven Rolex/Patek access paths.
CREATE INDEX IF NOT EXISTS idx_staging_qnsa_ap_release_brand_posted
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    created_at DESC,
    id DESC
  )
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized = 'Audemars Piguet'
    AND upper(COALESCE(listing_type, intent, '')) IN ('WTS', 'WTB');

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_ap_reference_price_order
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    reference_normalized text_pattern_ops,
    ((price_normalized > 0)) DESC,
    created_at DESC,
    id DESC
  )
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND brand_normalized = 'Audemars Piguet'
    AND upper(COALESCE(category, '')) = 'WATCH';

CREATE INDEX IF NOT EXISTS idx_staging_qnsa_ap_price_reference_rpc
  ON staging.listings (
    normalization_run_key,
    brand_normalized,
    reference_normalized,
    listing_type,
    id DESC
  )
  WHERE parent_id IS NULL
    AND COALESCE(is_bundle, false) = false
    AND upper(COALESCE(category, '')) = 'WATCH'
    AND brand_normalized = 'Audemars Piguet';

ANALYZE staging.listings;

NOTIFY pgrst, 'reload schema';

COMMIT;
