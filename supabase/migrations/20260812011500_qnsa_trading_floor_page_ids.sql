-- Bounded ID-first access path for broad Rolex/Patek Trading Floor pages.
-- Resolving the enabled run before the ordered staging scan lets PostgreSQL use
-- the existing (run, brand, created_at, id) index. The public evidence view is
-- still queried for the final rows, so this function cannot loosen publication
-- or contact/media gates.

CREATE OR REPLACE FUNCTION public.qnsa_trading_floor_page_ids(
  p_brand TEXT,
  p_limit INTEGER DEFAULT 51,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  SELECT listing.id::text
  FROM public.qnsa_two_brand_release_control AS control
  JOIN staging.listings AS listing
    ON listing.normalization_run_key = control.enabled_run_key
   AND listing.brand_normalized = control.canonical_brand
  JOIN staging.mariadb_normalization_import_checkpoints AS checkpoint
    ON checkpoint.run_key = listing.normalization_run_key
  WHERE control.canonical_brand = p_brand
    AND control.trading_floor_enabled = true
    AND checkpoint.status = 'NORMALIZATION_STAGED'
    AND checkpoint.error_rows = 0
    AND listing.brand_normalized IN ('Rolex', 'Patek Philippe')
    AND upper(COALESCE(listing.category, '')) = 'WATCH'
    AND listing.parent_id IS NULL
    AND COALESCE(listing.is_bundle, false) = false
    AND upper(COALESCE(listing.listing_type, listing.intent, '')) IN ('WTS', 'WTB')
    AND COALESCE(listing.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
    AND listing.raw_message_version_id IS NOT NULL
    AND COALESCE(listing.source_record_id, '') <> ''
    AND listing.source_hash ~ '^[0-9a-f]{64}$'
    AND listing.source_candidate_hash ~ '^[0-9a-f]{64}$'
    AND lower(COALESCE(listing.trading_floor_status, '')) NOT IN (
      'bundle_child_pending_review', 'bundle_pending_separation',
      'suppressed_exact_duplicate', 'withdrawn', 'rejected', 'hidden',
      'deleted', 'archived'
    )
    AND upper(COALESCE(listing.verdict, '')) NOT IN (
      'WITHDRAWN', 'REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED'
    )
    AND lower(COALESCE(listing.price_research_status, '')) <> 'suppressed_exact_duplicate'
    AND upper(COALESCE(listing.publication_review_status, 'PENDING_REVIEW')) IN (
      'PENDING_REVIEW', 'APPROVED', 'READY_FOR_PUBLICATION_REVIEW'
    )
  ORDER BY listing.created_at DESC, listing.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.qnsa_trading_floor_page_ids(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_trading_floor_page_ids(TEXT, INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.qnsa_trading_floor_page_ids(TEXT, INTEGER, INTEGER) IS
  'Returns only bounded IDs from the enabled reconciled QNSA Rolex/Patek run; final customer evidence remains sourced from the strict public view.';
