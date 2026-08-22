WITH
control AS MATERIALIZED (
  SELECT enabled_run_key, trading_floor_enabled, price_research_enabled
  FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand = 'Rolex'
),
staging_all AS MATERIALIZED (
  SELECT l.*
  FROM staging.listings l
  WHERE l.brand_normalized = 'Rolex'
),
active AS MATERIALIZED (
  SELECT l.*
  FROM staging_all l
  JOIN control c ON c.enabled_run_key = l.normalization_run_key
),
active_refs AS MATERIALIZED (
  SELECT
    regexp_replace(upper(btrim(reference_normalized)), '[^A-Z0-9]', '', 'g') AS ref_key,
    min(btrim(reference_normalized)) AS reference
  FROM active
  WHERE upper(COALESCE(category, '')) = 'WATCH'
    AND NULLIF(btrim(reference_normalized), '') IS NOT NULL
  GROUP BY 1
  HAVING regexp_replace(upper(btrim(reference_normalized)), '[^A-Z0-9]', '', 'g') <> ''
),
release_base AS MATERIALIZED (
  SELECT b.*, rm.external_message_id AS source_message_id
  FROM public.qnsa_rolex_patek_reviewed_release_base b
  JOIN public.raw_message_versions rv ON rv.id = b.raw_message_version_id
  JOIN public.raw_messages rm ON rm.id = rv.raw_message_id
  WHERE b.brand_normalized = 'Rolex'
),
tf_base AS MATERIALIZED (
  SELECT
    'base'::text AS lane, b.id::text AS id, b.id AS listing_uuid,
    b.source_record_id, NULLIF(b.source_message_id, '') AS source_message_id,
    NULLIF(btrim(b.reference_normalized), '') AS reference,
    regexp_replace(upper(COALESCE(b.reference_normalized, '')), '[^A-Z0-9]', '', 'g') AS ref_key,
    b.price_original, b.currency_original, b.price_normalized, b.currency_normalized,
    b.price_usd, b.currency_evidence, b.conversion_rate, b.conversion_timestamp,
    b.raw_message_text,
    b.public_image_eligible AND btrim(COALESCE(b.image_url, '')) ~* '^https?://[^[:space:]]+$' AS has_real_image,
    NULLIF(btrim(b.seller_name), '') IS NOT NULL AS has_posted_user,
    b.dealer_rating AS source_dealer_rating
  FROM release_base b
  JOIN control c ON c.trading_floor_enabled
),
overlay_singles AS MATERIALIZED (
  SELECT
    'reviewed_overlay'::text AS lane, w.id, NULL::uuid AS listing_uuid,
    NULLIF(btrim(w.source_record_id), '') AS source_record_id,
    NULLIF(btrim(w.source_message_id), '') AS source_message_id,
    NULLIF(btrim(w.normalized_reference), '') AS reference,
    regexp_replace(upper(COALESCE(w.normalized_reference, '')), '[^A-Z0-9]', '', 'g') AS ref_key,
    w.source_price_amount AS price_original, NULLIF(btrim(w.source_currency), '') AS currency_original,
    w.workbook_price_usd AS price_normalized, 'USD'::text AS currency_normalized,
    CASE WHEN upper(COALESCE(w.price_evidence_status, '')) = 'SOURCE_EXPLICIT_USD_MATCH'
      THEN w.workbook_price_usd END AS price_usd,
    w.price_evidence_status AS currency_evidence, NULL::numeric AS conversion_rate,
    NULL::timestamptz AS conversion_timestamp, NULL::text AS raw_message_text,
    upper(COALESCE(w.image_evidence_type, '')) = 'SELLER_LISTING_IMAGE'
      AND btrim(COALESCE(w.user_image_url, w.final_image_url, w.display_image_url, ''))
        ~* '^https?://[^[:space:]]+$' AS has_real_image,
    NULLIF(btrim(w.posted_by), '') IS NOT NULL AS has_posted_user,
    NULL::numeric AS source_dealer_rating
  FROM public.reviewed_workbook_inventory w
  WHERE w.brand_scope = 'Rolex'
    AND w.verification_tier = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'
    AND w.verification_status = 'APPROVED_SINGLE_CANDIDATE'
    AND w.confidence = 100
    AND w.source_message_id IS NOT NULL
    AND (upper(COALESCE(w.listing_type, '')) IN ('WTS', 'WTB', 'OTHER') OR w.listing_type IS NULL)
),
overlay_parent AS MATERIALIZED (
  SELECT
    'reviewed_overlay'::text AS lane, w.id, NULL::uuid AS listing_uuid,
    NULLIF(btrim(w.source_record_id), '') AS source_record_id,
    NULLIF(btrim(w.source_message_id), '') AS source_message_id,
    NULL::text AS reference, ''::text AS ref_key,
    NULL::numeric AS price_original, NULL::text AS currency_original,
    NULL::numeric AS price_normalized, NULL::text AS currency_normalized,
    NULL::numeric AS price_usd, w.price_evidence_status AS currency_evidence,
    NULL::numeric AS conversion_rate, NULL::timestamptz AS conversion_timestamp,
    NULL::text AS raw_message_text, false AS has_real_image,
    NULLIF(btrim(w.posted_by), '') IS NOT NULL AS has_posted_user,
    NULL::numeric AS source_dealer_rating
  FROM public.reviewed_workbook_inventory w
  WHERE w.id = 'rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972'
    AND w.brand_scope = 'Rolex'
    AND w.verification_tier = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'
    AND w.verification_status = 'APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY'
    AND w.listing_type = 'MULTI'
    AND w.confidence = 100
    AND w.source_message_id IS NOT NULL
),
overlay AS MATERIALIZED (
  SELECT * FROM overlay_singles
  UNION ALL
  SELECT * FROM overlay_parent
),
tf_union AS MATERIALIZED (
  SELECT * FROM overlay
  UNION ALL
  SELECT b.*
  FROM tf_base b
  WHERE NOT EXISTS (
    SELECT 1 FROM overlay o
    WHERE o.id = b.id
       OR (o.source_record_id IS NOT NULL AND o.source_record_id = b.source_record_id)
       OR (o.source_message_id IS NOT NULL AND o.source_message_id = b.source_message_id)
  )
),
tf_refs AS MATERIALIZED (
  SELECT ref_key, min(reference) AS reference
  FROM tf_union WHERE ref_key <> '' GROUP BY ref_key
),
pr_base AS MATERIALIZED (
  SELECT
    p.id, p.source_record_id, b.source_message_id,
    regexp_replace(upper(COALESCE(p.normalized_reference, '')), '[^A-Z0-9]', '', 'g') AS ref_key
  FROM public.qnsa_rolex_patek_price_research_source p
  LEFT JOIN release_base b ON b.id::text = p.id
  WHERE p.brand = 'Rolex'
),
pr_overlay AS MATERIALIZED (
  SELECT id, source_record_id, source_message_id,
    regexp_replace(upper(COALESCE(normalized_reference, '')), '[^A-Z0-9]', '', 'g') AS ref_key
  FROM public.reviewed_workbook_inventory
  WHERE brand_scope = 'Rolex'
    AND verification_tier = 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'
    AND verification_status = 'APPROVED_SINGLE_CANDIDATE'
    AND confidence = 100
    AND source_message_id IS NOT NULL
    AND upper(COALESCE(listing_type, '')) = 'WTS'
    AND NULLIF(btrim(normalized_reference), '') IS NOT NULL
),
pr_union AS MATERIALIZED (
  SELECT o.id, o.source_record_id, o.source_message_id, o.ref_key FROM pr_overlay o
  UNION ALL
  SELECT b.id, b.source_record_id, b.source_message_id, b.ref_key
  FROM pr_base b
  WHERE NOT EXISTS (
    SELECT 1 FROM pr_overlay o
    WHERE o.id = b.id
       OR (o.source_record_id IS NOT NULL AND o.source_record_id = b.source_record_id)
       OR (o.source_message_id IS NOT NULL AND o.source_message_id = b.source_message_id)
  )
),
pr_refs AS MATERIALIZED (
  SELECT ref_key FROM pr_union WHERE ref_key <> '' GROUP BY ref_key
),
dealer_evidence AS MATERIALIZED (
  SELECT
    b.id,
    (link.listing_id IS NOT NULL) AS linked,
    (d.rating IS NOT NULL AND d.review_count > 0) AS rated
  FROM tf_base b
  LEFT JOIN public.dealer_listing_links link
    ON link.listing_id = b.listing_uuid AND link.link_status = 'APPLIED'
  LEFT JOIN public.dealers d ON d.id = link.dealer_id
),
currency_counts AS MATERIALIZED (
  SELECT COALESCE(NULLIF(upper(btrim(currency_original)), ''), 'MISSING') AS currency, count(*) AS count
  FROM tf_union GROUP BY 1 ORDER BY 2 DESC, 1
),
missing_tf AS MATERIALIZED (
  SELECT s.ref_key, s.reference FROM active_refs s LEFT JOIN tf_refs t USING (ref_key)
  WHERE t.ref_key IS NULL
),
missing_pr AS MATERIALIZED (
  SELECT s.ref_key, s.reference FROM active_refs s LEFT JOIN pr_refs p USING (ref_key)
  WHERE p.ref_key IS NULL
),
checksums AS MATERIALIZED (
  SELECT
    md5((SELECT count(*)::text || ':' || COALESCE(sum(hashtextextended(id::text, 0)::numeric), 0)::text FROM active)) AS active_rows,
    md5((SELECT count(*)::text || ':' || COALESCE(sum(hashtextextended(id, 0)::numeric), 0)::text FROM tf_union)) AS trading_floor_rows,
    md5(COALESCE((SELECT string_agg(ref_key, ',' ORDER BY ref_key) FROM active_refs), '')) AS active_references,
    md5(COALESCE((SELECT string_agg(ref_key, ',' ORDER BY ref_key) FROM tf_refs), '')) AS trading_floor_references,
    md5(COALESCE((SELECT string_agg(ref_key, ',' ORDER BY ref_key) FROM pr_refs), '')) AS price_research_references
)
SELECT jsonb_build_object(
  'contract', 'watchfacts-rolex-phase2-readonly-census-v1',
  'project_ref', 'qnsafosakvonzgfcsphh',
  'read_only', true,
  'transaction_read_only', current_setting('transaction_read_only'),
  'generated_at', now(),
  'control', (SELECT to_jsonb(c) FROM control c),
  'counts', jsonb_build_object(
    'source_distinct_rows', (SELECT count(DISTINCT source_record_id) FROM staging_all WHERE NULLIF(source_record_id, '') IS NOT NULL),
    'raw_version_rows_linked', (SELECT count(DISTINCT rv.id) FROM public.raw_message_versions rv JOIN staging_all s ON s.source_record_id = rv.source_record_id),
    'staging_rows_all_runs', (SELECT count(*) FROM staging_all),
    'normalized_rows_active_run', (SELECT count(*) FROM active),
    'released_base_rows', (SELECT count(*) FROM release_base),
    'reviewed_overlay_rows', (SELECT count(*) FROM overlay),
    'trading_floor_listings', (SELECT count(*) FROM tf_union),
    'unique_rolex_references', (SELECT count(*) FROM active_refs),
    'trading_floor_references', (SELECT count(*) FROM tf_refs),
    'price_research_references', (SELECT count(*) FROM pr_refs),
    'price_research_observations', (SELECT count(*) FROM pr_union),
    'missing_trading_floor_references', (SELECT count(*) FROM missing_tf),
    'missing_price_research_references', (SELECT count(*) FROM missing_pr)
  ),
  'data_quality', jsonb_build_object(
    'listings_with_valid_real_images', (SELECT count(*) FROM tf_union WHERE has_real_image),
    'listings_without_images', (SELECT count(*) FROM tf_union WHERE NOT has_real_image),
    'listings_with_any_positive_price', (SELECT count(*) FROM tf_union WHERE COALESCE(price_original, price_normalized, price_usd, 0) > 0),
    'listings_missing_price', (SELECT count(*) FROM tf_union WHERE COALESCE(price_original, price_normalized, price_usd, 0) <= 0),
    'listings_with_posted_user', (SELECT count(*) FROM tf_union WHERE has_posted_user),
    'listings_missing_posted_user', (SELECT count(*) FROM tf_union WHERE NOT has_posted_user),
    'base_listings_with_exact_dealer_link', (SELECT count(*) FROM dealer_evidence WHERE linked),
    'base_listings_missing_exact_dealer_link', (SELECT count(*) FROM dealer_evidence WHERE NOT linked),
    'base_listings_with_source_backed_dealer_rating', (SELECT count(*) FROM dealer_evidence WHERE rated),
    'base_listings_missing_source_backed_dealer_rating', (SELECT count(*) FROM dealer_evidence WHERE NOT rated),
    'bare_dollar_rows_normalized_as_usd_without_usd_usdt_token', (
      SELECT count(*) FROM tf_base
      WHERE raw_message_text ~ '[$]'
        AND raw_message_text !~* '(^|[^A-Z0-9])(USD|USDT)([^A-Z0-9]|$)'
        AND currency_normalized = 'USD' AND COALESCE(price_usd, 0) > 0
    ),
    'raw_hkd_rows_normalized_as_usd', (
      SELECT count(*) FROM tf_base
      WHERE raw_message_text ~* '(^|[^A-Z0-9])HKD([^A-Z0-9]|$)'
        AND currency_normalized = 'USD'
    ),
    'named_foreign_currency_rows_normalized_as_usd', (
      SELECT count(*) FROM tf_base
      WHERE raw_message_text ~* '(^|[^A-Z0-9])(HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)([^A-Z0-9]|$)'
        AND currency_normalized = 'USD'
    ),
    'foreign_currency_rows_missing_verified_fx', (
      SELECT count(*) FROM tf_union
      WHERE currency_normalized IS NOT NULL AND currency_normalized NOT IN ('USD', 'USDT')
        AND COALESCE(price_normalized, price_original, 0) > 0
        AND (COALESCE(conversion_rate, 0) <= 0 OR conversion_timestamp IS NULL OR COALESCE(price_usd, 0) <= 0)
    )
  ),
  'counts_by_original_currency', (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', currency, 'count', count)), '[]'::jsonb) FROM currency_counts),
  'references_missing_from_trading_floor', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reference', reference, 'key', ref_key) ORDER BY ref_key), '[]'::jsonb) FROM missing_tf),
  'references_missing_from_price_research', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reference', reference, 'key', ref_key) ORDER BY ref_key), '[]'::jsonb) FROM missing_pr),
  'authoritative_reference_keys', (SELECT COALESCE(jsonb_agg(ref_key ORDER BY ref_key), '[]'::jsonb) FROM active_refs),
  'checksums', (SELECT to_jsonb(c) FROM checksums c),
  'lineage_integrity', jsonb_build_object(
    'active_rows_with_exact_raw_version', (
      SELECT count(*) FROM active a JOIN public.raw_message_versions rv
        ON rv.id = a.raw_message_version_id AND rv.source_record_id = a.source_record_id AND rv.source_hash = a.source_hash
    ),
    'active_rows_missing_exact_raw_version', (
      SELECT count(*) FROM active a LEFT JOIN public.raw_message_versions rv
        ON rv.id = a.raw_message_version_id AND rv.source_record_id = a.source_record_id AND rv.source_hash = a.source_hash
      WHERE rv.id IS NULL
    )
  )
) AS census;
