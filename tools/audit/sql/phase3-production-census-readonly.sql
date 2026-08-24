BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '300s';

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
active AS MATERIALIZED (
  SELECT l.*,
    cm.price_lane,
    EXISTS (
      SELECT 1
      FROM public.raw_message_versions rv
      WHERE rv.id = l.raw_message_version_id
        AND rv.source_record_id = l.source_record_id
        AND rv.source_hash = l.source_hash
    ) AS exact_raw,
    (
      l.company_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.dealer_listing_links dl
        WHERE dl.source_record_id = l.source_record_id
          AND upper(COALESCE(dl.link_status, '')) IN ('APPROVED', 'VERIFIED', 'ACTIVE')
      )
    ) AS dealer_linked,
    ab.brand IS NOT NULL AS brand_allowed,
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
          AND COALESCE(l.currency_evidence, '') IN (
            'explicit_line_currency', 'section_currency'
          )
          AND COALESCE(l.conversion_rate, 0) > 0
          AND l.conversion_timestamp IS NOT NULL
        )
      )
    ) AS verified_usd,
    cm.listing_id IS NOT NULL AS controlled_published
  FROM staging.listings l
  JOIN control c ON c.enabled_run_key = l.normalization_run_key
  LEFT JOIN allowed_brands ab ON ab.brand = l.brand_normalized
  LEFT JOIN controlled_manifest cm
    ON cm.listing_id = l.id AND cm.brand = l.brand_normalized
),
classified AS MATERIALIZED (
  SELECT a.*,
    (
      a.brand_allowed
      AND a.common_eligible
      AND NULLIF(btrim(COALESCE(a.model_normalized, '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(a.reference_normalized, '')), '') IS NOT NULL
    ) AS tf_eligible,
    (
      a.brand_allowed
      AND a.common_eligible
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
      AND regexp_replace(upper(COALESCE(c.raw_message_text, '')), '[^A-Z0-9]', '', 'g')
        LIKE '%' || regexp_replace(upper(COALESCE(c.reference_normalized, '')), '[^A-Z0-9]', '', 'g') || '%'
      AND CASE
        WHEN c.brand_normalized IN ('Cartier', 'Omega', 'Tudor', 'Vacheron Constantin')
          THEN c.price_lane IN ('SOURCE_EXPLICIT_USD_USDT', 'DATED_VERIFIED_FX')
        ELSE true
      END
    ) AS pr_qualified
  FROM classified c
),
dial_stats AS (
  SELECT brand_normalized,
    model_normalized,
    reference_normalized,
    COALESCE(NULLIF(btrim(dial_color_normalized), ''), 'Unspecified') AS dial,
    count(*) FILTER (WHERE pr_qualified) AS qualified
  FROM priced
  WHERE brand_allowed
    AND NULLIF(btrim(COALESCE(reference_normalized, '')), '') IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
reference_rows AS (
  SELECT p.brand_normalized AS brand,
    COALESCE(NULLIF(btrim(p.model_normalized), ''), '[MODEL UNRESOLVED]') AS model,
    p.reference_normalized AS reference,
    count(DISTINCT p.source_record_id) AS source_listing_count,
    count(DISTINCT p.raw_message_version_id) FILTER (WHERE p.exact_raw) AS immutable_raw_count,
    count(*) AS normalized_candidate_count,
    count(*) FILTER (WHERE upper(COALESCE(p.listing_type, p.intent, '')) = 'WTS') AS wts_count,
    count(*) FILTER (WHERE upper(COALESCE(p.listing_type, p.intent, '')) = 'WTB') AS wtb_count,
    count(*) FILTER (WHERE p.bundle_deferred) AS bundle_deferred_count,
    count(*) FILTER (WHERE p.review_required) AS review_required_count,
    count(*) FILTER (WHERE p.explicit_source_price) AS explicit_source_price_count,
    count(*) FILTER (WHERE COALESCE(p.price_normalized, 0) > 0) AS normalized_price_count,
    count(*) FILTER (WHERE p.verified_usd) AS verified_usd_price_count,
    count(*) FILTER (
      WHERE p.public_image_eligible
        AND COALESCE(p.image_url, p.source_media_url_candidate, '') ~* '^https?://'
    ) AS image_linked_count,
    count(*) FILTER (WHERE p.dealer_linked) AS seller_dealer_linked_count,
    count(*) FILTER (WHERE p.tf_eligible) AS trading_floor_eligible_count,
    count(*) FILTER (WHERE p.tf_published) AS trading_floor_published_count,
    count(*) FILTER (WHERE p.pr_qualified) AS price_research_qualified_wts_count,
    count(*) FILTER (WHERE p.tf_eligible AND NOT p.tf_published) AS tf_gap,
    count(*) FILTER (
      WHERE p.tf_published
        AND upper(COALESCE(p.listing_type, p.intent, '')) = 'WTS'
        AND COALESCE(p.price_normalized, 0) > 0
        AND NOT p.pr_qualified
    ) AS pr_gap,
    count(*) FILTER (
      WHERE NULLIF(btrim(COALESCE(p.dial_color_normalized, '')), '') IS NULL
        OR NULLIF(btrim(COALESCE(p.condition_normalized, '')), '') IS NULL
        OR (
          upper(COALESCE(p.listing_type, p.intent, '')) = 'WTS'
          AND COALESCE(p.price_normalized, 0) <= 0
        )
    ) AS missing_normalized_fields
  FROM priced p
  WHERE p.brand_allowed
    AND NULLIF(btrim(COALESCE(p.reference_normalized, '')), '') IS NOT NULL
  GROUP BY 1, 2, 3
),
reference_ready AS (
  SELECT r.*,
    EXISTS (
      SELECT 1
      FROM dial_stats d
      WHERE d.brand_normalized = r.brand
        AND COALESCE(NULLIF(btrim(d.model_normalized), ''), '[MODEL UNRESOLVED]') = r.model
        AND d.reference_normalized = r.reference
        AND d.qualified >= 2
    ) AS analytics_ready
  FROM reference_rows r
),
brand_rows AS (
  SELECT brand,
    count(DISTINCT model) AS model_count,
    count(*) AS exact_reference_count,
    sum(source_listing_count)::bigint AS source_listings,
    sum(immutable_raw_count)::bigint AS immutable_raw,
    sum(normalized_candidate_count)::bigint AS normalized_candidates,
    sum(wts_count)::bigint AS wts,
    sum(wtb_count)::bigint AS wtb,
    sum(bundle_deferred_count)::bigint AS bundle_deferred,
    sum(review_required_count)::bigint AS review_required,
    sum(explicit_source_price_count)::bigint AS explicit_source_price,
    sum(normalized_price_count)::bigint AS normalized_price,
    sum(verified_usd_price_count)::bigint AS verified_usd_price,
    sum(trading_floor_eligible_count)::bigint AS tf_eligible,
    sum(trading_floor_published_count)::bigint AS tf_published,
    sum(price_research_qualified_wts_count)::bigint AS pr_qualified,
    sum(tf_gap)::bigint AS tf_gap,
    sum(pr_gap)::bigint AS pr_gap,
    count(*) FILTER (WHERE analytics_ready) AS analytics_ready_references
  FROM reference_ready
  GROUP BY brand
),
pipeline AS (
  SELECT count(*) AS active_normalized_rows,
    count(DISTINCT source_record_id) AS active_source_records,
    count(DISTINCT raw_message_version_id) FILTER (WHERE exact_raw) AS active_immutable_raw_versions,
    count(*) FILTER (WHERE brand_allowed) AS allowed_brand_rows,
    count(*) FILTER (
      WHERE brand_allowed AND NULLIF(btrim(COALESCE(model_normalized, '')), '') IS NULL
    ) AS missing_model_rows,
    count(*) FILTER (
      WHERE brand_allowed AND NULLIF(btrim(COALESCE(reference_normalized, '')), '') IS NULL
    ) AS missing_reference_rows,
    count(*) FILTER (WHERE review_required) AS review_required_rows,
    count(*) FILTER (WHERE bundle_deferred) AS bundle_deferred_rows,
    count(*) FILTER (WHERE tf_eligible) AS tf_eligible_rows,
    count(*) FILTER (WHERE tf_published) AS tf_published_rows,
    count(*) FILTER (WHERE pr_qualified) AS pr_qualified_rows
  FROM priced
)
SELECT jsonb_build_object(
  'contract', 'watchfacts-phase3-production-census-v1',
  'project_ref', 'qnsafosakvonzgfcsphh',
  'generated_at', clock_timestamp(),
  'read_only', current_setting('transaction_read_only'),
  'active_run_key', (SELECT enabled_run_key FROM control),
  'pipeline', (SELECT to_jsonb(pipeline) FROM pipeline),
  'brand_count', (SELECT count(*) FROM brand_rows),
  'model_count', (SELECT sum(model_count) FROM brand_rows),
  'exact_reference_count', (SELECT count(*) FROM reference_ready),
  'brands', (
    SELECT jsonb_agg(to_jsonb(brand_rows) ORDER BY tf_published DESC, brand)
    FROM brand_rows
  ),
  'references', (
    SELECT jsonb_agg(to_jsonb(reference_ready) ORDER BY brand, model, reference)
    FROM reference_ready
  )
)::text AS census;

ROLLBACK;
