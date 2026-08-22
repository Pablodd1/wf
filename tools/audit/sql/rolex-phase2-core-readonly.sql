WITH control AS MATERIALIZED (
  SELECT enabled_run_key, trading_floor_enabled, price_research_enabled
  FROM public.qnsa_two_brand_release_control WHERE canonical_brand = 'Rolex'
), active AS MATERIALIZED (
  SELECT l.id, l.source_record_id, l.raw_message_version_id, l.source_hash, l.source_candidate_hash,
    l.reference_normalized, l.category, l.parent_id, l.is_bundle,
    l.provenance_metadata, l.listing_type, l.intent, l.trading_floor_status,
    l.verdict, l.publication_review_status, l.price_research_status,
    l.image_url, l.source_media_url_candidate,
    l.price_normalized, l.price_original, l.price_usd, l.currency_normalized,
    l.currency_evidence, l.conversion_rate, l.conversion_timestamp,
    l.user_name, l.from_name, l.rating, l.dealer_rating
  FROM staging.listings l JOIN control c ON c.enabled_run_key = l.normalization_run_key
  JOIN staging.mariadb_normalization_import_checkpoints checkpoint
    ON checkpoint.run_key=l.normalization_run_key
  WHERE l.brand_normalized = 'Rolex'
    AND checkpoint.status='NORMALIZATION_STAGED' AND checkpoint.error_rows=0
), refs AS MATERIALIZED (
  SELECT regexp_replace(upper(btrim(reference_normalized)), '[^A-Z0-9]', '', 'g') AS ref_key,
    min(btrim(reference_normalized)) AS reference,
    array_agg(DISTINCT btrim(reference_normalized) ORDER BY btrim(reference_normalized)) AS variants
  FROM active
  WHERE upper(COALESCE(category, '')) = 'WATCH' AND NULLIF(btrim(reference_normalized), '') IS NOT NULL
  GROUP BY 1 HAVING regexp_replace(upper(btrim(reference_normalized)), '[^A-Z0-9]', '', 'g') <> ''
), eligible_base AS MATERIALIZED (
  SELECT regexp_replace(upper(btrim(a.reference_normalized)), '[^A-Z0-9]', '', 'g') ref_key, a.id,
    (btrim(COALESCE(a.image_url,a.source_media_url_candidate,''))~*'^https?://[^[:space:]]+$') has_image,
    (COALESCE(price_normalized,price_original,price_usd,0)>0) has_price,
    (NULLIF(btrim(COALESCE(a.user_name,a.from_name,'')),'') IS NOT NULL) has_user,
    (upper(COALESCE(a.listing_type,a.intent,''))='WTS' AND COALESCE(a.price_usd,0)>0 AND COALESCE(a.price_normalized,0)>0
      AND (a.currency_normalized IN ('USD','USDT') OR (a.currency_normalized IS NOT NULL
        AND COALESCE(a.conversion_rate,0)>0 AND a.conversion_timestamp IS NOT NULL))) price_research_eligible
  FROM active a
  WHERE upper(COALESCE(a.category,''))='WATCH' AND NULLIF(btrim(a.reference_normalized),'') IS NOT NULL
    AND a.parent_id IS NULL AND COALESCE(a.is_bundle,false)=false
    AND upper(COALESCE(a.listing_type,a.intent,'')) IN ('WTS','WTB')
    AND COALESCE(a.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
    AND a.raw_message_version_id IS NOT NULL AND COALESCE(a.source_record_id,'')<>''
    AND a.source_hash~'^[0-9a-f]{64}$' AND a.source_candidate_hash~'^[0-9a-f]{64}$'
    AND lower(COALESCE(a.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(a.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
    AND lower(COALESCE(a.price_research_status,''))<>'suppressed_exact_duplicate'
    AND upper(COALESCE(a.publication_review_status,'PENDING_REVIEW')) IN ('PENDING_REVIEW','APPROVED','READY_FOR_PUBLICATION_REVIEW')
), base_by_ref AS MATERIALIZED (
  SELECT b.ref_key, count(*) base_count, count(*) FILTER (WHERE b.has_image) images,
    count(*) FILTER (WHERE b.has_price) prices, count(*) FILTER (WHERE b.has_user) users,
    count(*) FILTER (WHERE b.price_research_eligible) price_observations,
    count(*) FILTER (WHERE link.listing_id IS NOT NULL) dealer_links,
    count(*) FILTER (WHERE d.rating IS NOT NULL AND d.review_count>0) directory_ratings
  FROM eligible_base b
  LEFT JOIN public.dealer_listing_links link ON link.listing_id=b.id AND link.link_status='APPLIED'
  LEFT JOIN public.dealers d ON d.id=link.dealer_id GROUP BY b.ref_key
), overlay_by_ref AS MATERIALIZED (
  SELECT regexp_replace(upper(btrim(w.normalized_reference)), '[^A-Z0-9]', '', 'g') ref_key,
    count(*) overlay_count,
    count(*) FILTER (WHERE upper(COALESCE(w.image_evidence_type,''))='SELLER_LISTING_IMAGE'
      AND btrim(COALESCE(w.user_image_url,w.final_image_url,w.display_image_url,''))~*'^https?://[^[:space:]]+$') images,
    count(*) FILTER (WHERE COALESCE(w.source_price_amount,w.workbook_price_usd,0)>0) prices,
    count(*) FILTER (WHERE NULLIF(btrim(COALESCE(w.posted_by,'')),'') IS NOT NULL) users,
    count(*) FILTER (WHERE upper(COALESCE(w.listing_type,''))='WTS') price_observations
  FROM public.reviewed_workbook_inventory w
  WHERE w.brand_scope='Rolex' AND w.verification_tier='QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'
    AND w.verification_status='APPROVED_SINGLE_CANDIDATE' AND w.confidence=100
    AND w.source_message_id IS NOT NULL AND NULLIF(btrim(w.normalized_reference),'') IS NOT NULL
  GROUP BY 1
), surface_keys AS MATERIALIZED (
  SELECT ref_key FROM refs UNION SELECT ref_key FROM overlay_by_ref
), surfaces AS MATERIALIZED (
  SELECT k.ref_key, COALESCE(b.base_count,0) base_count, COALESCE(o.overlay_count,0) overlay_count,
    COALESCE(b.images,0)+COALESCE(o.images,0) images,
    COALESCE(b.prices,0)+COALESCE(o.prices,0) prices,
    COALESCE(b.users,0)+COALESCE(o.users,0) users,
    COALESCE(b.price_observations,0)+COALESCE(o.price_observations,0) price_observations,
    COALESCE(b.dealer_links,0) dealer_links,
    COALESCE(b.directory_ratings,0) directory_ratings
  FROM surface_keys k LEFT JOIN base_by_ref b USING(ref_key) LEFT JOIN overlay_by_ref o USING(ref_key)
)
SELECT jsonb_build_object(
  'contract', 'watchfacts-rolex-phase2-core-v2', 'project_ref', 'qnsafosakvonzgfcsphh',
  'read_only', true, 'transaction_read_only', current_setting('transaction_read_only'),
  'generated_at', now(), 'control', (SELECT to_jsonb(c) FROM control c),
  'counts', jsonb_build_object(
    'source_distinct_rows', (SELECT count(DISTINCT source_record_id) FROM active WHERE NULLIF(source_record_id, '') IS NOT NULL),
    'raw_version_rows_linked', (SELECT count(DISTINCT raw_message_version_id) FROM active WHERE raw_message_version_id IS NOT NULL),
    'staging_rows_active_run', (SELECT count(*) FROM active),
    'normalized_rows_active_run', (SELECT count(*) FROM active),
    'unique_rolex_references', (SELECT count(*) FROM refs)
  ),
  'authoritative_references', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reference', reference, 'key', ref_key, 'variants', variants) ORDER BY ref_key), '[]'::jsonb) FROM refs),
  'surface_rows', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY ref_key),'[]'::jsonb) FROM surfaces s),
  'multi_parent_count', (SELECT count(*) FROM public.reviewed_workbook_inventory WHERE id='rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972' AND verification_status='APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY'),
  'checksums', jsonb_build_object(
    'active_rows', md5((SELECT count(*)::text || ':' || COALESCE(sum(hashtextextended(id::text, 0)::numeric), 0)::text FROM active)),
    'active_references', md5(COALESCE((SELECT string_agg(ref_key, ',' ORDER BY ref_key) FROM refs), '')),
    'surface_rows', md5(COALESCE((SELECT string_agg(ref_key||':'||base_count||':'||overlay_count||':'||price_observations, ',' ORDER BY ref_key) FROM surfaces),''))
  ),
  'lineage_integrity', jsonb_build_object(
    'active_rows_with_exact_raw_version', (SELECT count(*) FROM active a JOIN public.raw_message_versions rv ON rv.id=a.raw_message_version_id AND rv.source_record_id=a.source_record_id AND rv.source_hash=a.source_hash),
    'active_rows_missing_exact_raw_version', (SELECT count(*) FROM active a LEFT JOIN public.raw_message_versions rv ON rv.id=a.raw_message_version_id AND rv.source_record_id=a.source_record_id AND rv.source_hash=a.source_hash WHERE rv.id IS NULL)
  )
) AS core;
