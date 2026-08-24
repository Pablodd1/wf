BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '110s';

WITH
control AS (
  SELECT enabled_run_key
  FROM public.qnsa_market_feed_control
  WHERE singleton = true AND enabled = true
),
allowed_brands(brand) AS (VALUES
  ('A. Lange & Söhne'), ('Audemars Piguet'), ('Bell & Ross'), ('Blancpain'),
  ('Breguet'), ('Bulgari'), ('Breitling'), ('Bvlgari'), ('Cartier'), ('Chopard'),
  ('F.P. Journe'), ('Franck Muller'), ('Girard-Perregaux'),
  ('Glashütte Original'), ('Grand Seiko'), ('Greubel Forsey'),
  ('H. Moser & Cie'), ('Hublot'), ('IWC'), ('Jacob & Co'),
  ('Jaeger-LeCoultre'), ('MB&F'), ('Omega'), ('Panerai'), ('Patek Philippe'),
  ('Piaget'), ('Richard Mille'), ('Roger Dubuis'), ('Rolex'), ('TAG Heuer'),
  ('Tudor'), ('Ulysse Nardin'), ('Vacheron Constantin'), ('Zenith')
),
controlled_manifest AS (
  SELECT m.listing_id, 'Cartier'::text AS brand, m.price_lane
  FROM public.qnsa_cartier_release_manifest m
  JOIN public.qnsa_cartier_release_control c
    ON c.enabled AND c.release_run_key = m.release_run_key
  UNION ALL
  SELECT m.listing_id, 'Omega', m.price_lane
  FROM public.qnsa_omega_release_manifest m
  JOIN public.qnsa_omega_release_control c
    ON c.enabled AND c.release_run_key = m.release_run_key
  UNION ALL
  SELECT m.listing_id, 'Tudor', m.price_lane
  FROM public.qnsa_tudor_release_manifest m
  JOIN public.qnsa_tudor_release_control c
    ON c.enabled AND c.release_run_key = m.release_run_key
  UNION ALL
  SELECT m.listing_id, 'Vacheron Constantin', m.price_lane
  FROM public.qnsa_vacheron_overseas_release_manifest m
  JOIN public.qnsa_vacheron_overseas_release_control c
    ON c.enabled AND c.release_run_key = m.release_run_key
),
linked_dealers AS (
  SELECT DISTINCT source_record_id
  FROM public.dealer_listing_links
  WHERE upper(COALESCE(link_status, '')) IN ('APPROVED', 'VERIFIED', 'ACTIVE')
),
active AS MATERIALIZED (
  SELECT l.*,
    cm.price_lane,
    rv.id IS NOT NULL AS exact_raw,
    (l.company_id IS NOT NULL OR dl.source_record_id IS NOT NULL) AS dealer_linked,
    (
      upper(COALESCE(l.category, '')) = 'WATCH'
      AND l.parent_id IS NULL
      AND NOT COALESCE(l.is_bundle, false)
      AND COALESCE(l.provenance_metadata ->> 'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type, l.intent, '')) IN ('WTS', 'WTB')
      AND l.raw_message_version_id IS NOT NULL
      AND COALESCE(l.source_record_id, '') <> ''
      AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
        'bundle_child_pending_review', 'bundle_pending_separation',
        'suppressed_exact_duplicate', 'withdrawn', 'rejected', 'hidden',
        'deleted', 'archived'
      )
      AND upper(COALESCE(l.verdict, '')) NOT IN (
        'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED'
      )
    ) AS common_eligible,
    (
      COALESCE(l.price_original, 0) > 0
      AND NULLIF(btrim(COALESCE(l.currency_original, '')), '') IS NOT NULL
      AND COALESCE(l.currency_evidence, '') IN (
        'explicit_line_currency', 'section_currency', 'SOURCE_EXPLICIT_USD_USDT'
      )
    ) AS explicit_source_price,
    (
      COALESCE(l.price_usd, 0) > 0
      AND (
        (
          upper(COALESCE(l.currency_normalized, '')) IN ('USD', 'USDT')
          AND COALESCE(l.currency_evidence, '') IN (
            'explicit_line_currency', 'section_currency', 'SOURCE_EXPLICIT_USD_USDT'
          )
        )
        OR (
          upper(COALESCE(l.currency_normalized, '')) NOT IN ('', 'USD', 'USDT')
          AND COALESCE(l.currency_evidence, '') IN ('explicit_line_currency', 'section_currency')
          AND COALESCE(l.conversion_rate, 0) > 0
          AND l.conversion_timestamp IS NOT NULL
        )
      )
    ) AS verified_usd,
    cm.listing_id IS NOT NULL AS controlled_published
  FROM staging.listings l
  JOIN control c ON c.enabled_run_key = l.normalization_run_key
  JOIN allowed_brands ab ON ab.brand = l.brand_normalized
  LEFT JOIN controlled_manifest cm
    ON cm.listing_id = l.id AND cm.brand = l.brand_normalized
  LEFT JOIN public.raw_message_versions rv
    ON rv.id = l.raw_message_version_id
    AND rv.source_record_id = l.source_record_id
    AND rv.source_hash = l.source_hash
  LEFT JOIN linked_dealers dl ON dl.source_record_id = l.source_record_id
),
classified AS MATERIALIZED (
  SELECT a.*,
    (
      a.common_eligible
      AND NULLIF(btrim(COALESCE(a.model_normalized, '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(a.reference_normalized, '')), '') IS NOT NULL
    ) AS tf_eligible,
    (
      a.common_eligible
      AND NULLIF(btrim(COALESCE(a.model_normalized, '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(a.reference_normalized, '')), '') IS NOT NULL
      AND CASE
        WHEN a.brand_normalized IN ('Cartier', 'Omega', 'Tudor', 'Vacheron Constantin')
          THEN a.controlled_published
        ELSE true
      END
    ) AS tf_published,
    (
      lower(COALESCE(a.normalization_status, '')) = 'needs_review'
      OR upper(COALESCE(a.publication_review_status, 'PENDING_REVIEW')) <> 'APPROVED'
    ) AS review_required,
    (
      COALESCE(a.is_bundle, false)
      OR a.parent_id IS NOT NULL
      OR COALESCE(a.provenance_metadata ->> 'bundle_status', 'SINGLE_CANDIDATE') <> 'SINGLE_CANDIDATE'
      OR lower(COALESCE(a.trading_floor_status, '')) IN (
        'bundle_child_pending_review', 'bundle_pending_separation'
      )
    ) AS bundle_deferred
  FROM active a
),
priced AS MATERIALIZED (
  SELECT c.*,
    (
      c.tf_published
      AND upper(COALESCE(c.listing_type, c.intent, '')) = 'WTS'
      AND c.verified_usd
      AND CASE
        WHEN c.brand_normalized IN ('Cartier', 'Omega', 'Tudor', 'Vacheron Constantin')
          THEN c.price_lane IN ('SOURCE_EXPLICIT_USD_USDT', 'DATED_VERIFIED_FX')
        ELSE true
      END
    ) AS pr_qualified
  FROM classified c
),
brand_rows AS (
  SELECT brand_normalized AS brand,
    count(DISTINCT NULLIF(btrim(model_normalized), '')) AS model_count,
    count(DISTINCT NULLIF(btrim(reference_normalized), '')) AS exact_reference_count,
    count(DISTINCT source_record_id) AS source_listings,
    count(DISTINCT raw_message_version_id) FILTER (WHERE exact_raw) AS immutable_raw,
    count(*) AS normalized_candidates,
    count(*) FILTER (WHERE upper(COALESCE(listing_type, intent, '')) = 'WTS') AS wts,
    count(*) FILTER (WHERE upper(COALESCE(listing_type, intent, '')) = 'WTB') AS wtb,
    count(*) FILTER (WHERE bundle_deferred) AS bundle_deferred,
    count(*) FILTER (WHERE review_required) AS review_required,
    count(*) FILTER (WHERE explicit_source_price) AS explicit_source_price,
    count(*) FILTER (WHERE COALESCE(price_normalized, 0) > 0) AS normalized_price,
    count(*) FILTER (WHERE verified_usd) AS verified_usd_price,
    count(*) FILTER (
      WHERE public_image_eligible
        AND COALESCE(image_url, source_media_url_candidate, '') ~* '^https?://'
    ) AS image_linked,
    count(*) FILTER (WHERE dealer_linked) AS dealer_linked,
    count(*) FILTER (WHERE tf_eligible) AS tf_eligible,
    count(*) FILTER (WHERE tf_published) AS tf_published,
    count(*) FILTER (WHERE pr_qualified) AS pr_qualified,
    count(*) FILTER (WHERE tf_eligible AND NOT tf_published) AS tf_gap,
    count(*) FILTER (
      WHERE tf_published
        AND upper(COALESCE(listing_type, intent, '')) = 'WTS'
        AND COALESCE(price_normalized, 0) > 0
        AND NOT pr_qualified
    ) AS pr_gap,
    count(*) FILTER (WHERE NULLIF(btrim(COALESCE(model_normalized, '')), '') IS NULL) AS missing_model,
    count(*) FILTER (WHERE NULLIF(btrim(COALESCE(reference_normalized, '')), '') IS NULL) AS missing_reference
  FROM priced
  GROUP BY brand_normalized
)
SELECT jsonb_build_object(
  'contract', 'watchfacts-phase3-production-brand-summary-v1',
  'project_ref', 'qnsafosakvonzgfcsphh',
  'generated_at', clock_timestamp(),
  'read_only', current_setting('transaction_read_only'),
  'active_run_key', (SELECT enabled_run_key FROM control),
  'brand_count', (SELECT count(*) FROM brand_rows),
  'model_count', (SELECT sum(model_count) FROM brand_rows),
  'exact_reference_count', (SELECT sum(exact_reference_count) FROM brand_rows),
  'brands', (
    SELECT jsonb_agg(to_jsonb(brand_rows) ORDER BY tf_published DESC, brand)
    FROM brand_rows
  )
)::text AS census;

ROLLBACK;
