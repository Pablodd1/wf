WITH control AS MATERIALIZED (
  SELECT enabled_run_key, trading_floor_enabled, price_research_enabled
  FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand = 'Rolex'
), active AS MATERIALIZED (
  SELECT l.id, l.source_record_id, l.raw_message_version_id, l.source_hash,
    l.reference_normalized, l.category
  FROM staging.listings l
  JOIN control c ON c.enabled_run_key = l.normalization_run_key
  WHERE l.brand_normalized = 'Rolex'
), refs AS MATERIALIZED (
  SELECT regexp_replace(upper(btrim(reference_normalized)), '[^A-Z0-9]', '', 'g') AS ref_key,
    min(btrim(reference_normalized)) AS reference
  FROM active
  WHERE upper(COALESCE(category, '')) = 'WATCH'
    AND NULLIF(btrim(reference_normalized), '') IS NOT NULL
  GROUP BY 1
  HAVING regexp_replace(upper(btrim(reference_normalized)), '[^A-Z0-9]', '', 'g') <> ''
)
SELECT jsonb_build_object(
  'contract', 'watchfacts-rolex-phase2-core-v1',
  'project_ref', 'qnsafosakvonzgfcsphh',
  'read_only', true,
  'transaction_read_only', current_setting('transaction_read_only'),
  'generated_at', now(),
  'control', (SELECT to_jsonb(c) FROM control c),
  'counts', jsonb_build_object(
    'source_distinct_rows', (SELECT count(DISTINCT source_record_id) FROM active WHERE NULLIF(source_record_id, '') IS NOT NULL),
    'raw_version_rows_linked', (SELECT count(DISTINCT raw_message_version_id) FROM active WHERE raw_message_version_id IS NOT NULL),
    'staging_rows_active_run', (SELECT count(*) FROM active),
    'normalized_rows_active_run', (SELECT count(*) FROM active),
    'unique_rolex_references', (SELECT count(*) FROM refs)
  ),
  'authoritative_references', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reference', reference, 'key', ref_key) ORDER BY ref_key), '[]'::jsonb) FROM refs),
  'checksums', jsonb_build_object(
    'active_rows', md5((SELECT count(*)::text || ':' || COALESCE(sum(hashtextextended(id::text, 0)::numeric), 0)::text FROM active)),
    'active_references', md5(COALESCE((SELECT string_agg(ref_key, ',' ORDER BY ref_key) FROM refs), ''))
  ),
  'lineage_integrity', jsonb_build_object(
    'active_rows_with_exact_raw_version', (SELECT count(*) FROM active a JOIN public.raw_message_versions rv ON rv.id=a.raw_message_version_id AND rv.source_record_id=a.source_record_id AND rv.source_hash=a.source_hash),
    'active_rows_missing_exact_raw_version', (SELECT count(*) FROM active a LEFT JOIN public.raw_message_versions rv ON rv.id=a.raw_message_version_id AND rv.source_record_id=a.source_record_id AND rv.source_hash=a.source_hash WHERE rv.id IS NULL)
  )
) AS core;
