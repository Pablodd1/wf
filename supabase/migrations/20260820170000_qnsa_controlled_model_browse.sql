-- Exact model-scoped Trading Floor browsing for the reviewed Omega and Cartier
-- manifests. The manifest is paged before joining immutable staging evidence.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_qnsa_omega_manifest_run_model_type_order
  ON public.qnsa_omega_release_manifest(release_run_key, public_model, listing_type, release_order);
CREATE INDEX IF NOT EXISTS idx_qnsa_cartier_manifest_run_model_type_order
  ON public.qnsa_cartier_release_manifest(release_run_key, public_model, listing_type, release_order);

CREATE OR REPLACE FUNCTION public.qnsa_controlled_model_release_count(
  p_brand text, p_model text, p_listing_type text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  SELECT CASE btrim(p_brand)
    WHEN 'Omega' THEN (
      SELECT count(*)
      FROM public.qnsa_omega_release_control c
      JOIN public.qnsa_omega_release_manifest m ON m.release_run_key = c.release_run_key
      WHERE c.singleton = true AND c.enabled = true
        AND m.public_model = btrim(p_model)
        AND (p_listing_type IS NULL OR m.listing_type = upper(p_listing_type))
    )
    WHEN 'Cartier' THEN (
      SELECT count(*)
      FROM public.qnsa_cartier_release_control c
      JOIN public.qnsa_cartier_release_manifest m ON m.release_run_key = c.release_run_key
      WHERE c.singleton = true AND c.enabled = true
        AND m.public_model = btrim(p_model)
        AND (p_listing_type IS NULL OR m.listing_type = upper(p_listing_type))
    )
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.qnsa_controlled_model_page_rows(
  p_brand text, p_model text,
  p_limit integer DEFAULT 51, p_offset integer DEFAULT 0,
  p_listing_type text DEFAULT NULL, p_reference text DEFAULT NULL
)
RETURNS TABLE(row_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, staging, pg_catalog
AS $$
  WITH manifest_rows AS MATERIALIZED (
    SELECT 'Omega'::text AS canonical_brand, m.release_order, m.public_reference,
      m.public_model, m.catalog_reference_confirmed, m.price_lane, m.listing_type,
      m.listing_id, m.source_hash, m.source_candidate_hash
    FROM public.qnsa_omega_release_control c
    JOIN public.qnsa_omega_release_manifest m ON m.release_run_key = c.release_run_key
    WHERE btrim(p_brand) = 'Omega' AND c.singleton = true AND c.enabled = true
      AND m.public_model = btrim(p_model)
      AND (p_listing_type IS NULL OR m.listing_type = upper(p_listing_type))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(m.public_reference, '')), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(p_reference), '[^A-Z0-9]', '', 'g'))
    UNION ALL
    SELECT 'Cartier'::text, m.release_order, m.public_reference,
      m.public_model, m.catalog_reference_confirmed, m.price_lane, m.listing_type,
      m.listing_id, m.source_hash, m.source_candidate_hash
    FROM public.qnsa_cartier_release_control c
    JOIN public.qnsa_cartier_release_manifest m ON m.release_run_key = c.release_run_key
    WHERE btrim(p_brand) = 'Cartier' AND c.singleton = true AND c.enabled = true
      AND m.public_model = btrim(p_model)
      AND (p_listing_type IS NULL OR m.listing_type = upper(p_listing_type))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(m.public_reference, '')), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(p_reference), '[^A-Z0-9]', '', 'g'))
  ), manifest_page AS MATERIALIZED (
    SELECT * FROM manifest_rows
    ORDER BY release_order
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ), selected AS MATERIALIZED (
    SELECT m.*, l.id, l.source_record_id, l.created_at, l.user_name, l.from_name,
      l.raw_message_text, l.brand_original, l.reference_original, l.reference_normalized,
      l.dial_color_normalized, l.condition_normalized, l.price_usd, l.price_normalized,
      l.currency_normalized, l.overall_confidence, l.verdict, l.location,
      dl.dealer_id AS exact_dealer_id,
      CASE WHEN btrim(l.reference_normalized) ~ '^[0-9]+$'
        THEN COALESCE(btrim(l.reference_normalized)::numeric = COALESCE(l.price_normalized, l.price_usd), false)
        ELSE false END AS reference_price_collision
    FROM manifest_page m
    JOIN staging.listings l ON l.id = m.listing_id
    LEFT JOIN public.dealer_listing_links dl ON dl.listing_id = l.id AND dl.link_status = 'APPLIED'
    WHERE l.brand_normalized = m.canonical_brand
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle, false) = false
      AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
      AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id, '') <> ''
      AND l.source_hash = m.source_hash AND l.source_candidate_hash = m.source_candidate_hash
  )
  SELECT jsonb_build_object(
    'id', s.id::text, 'parent_id', NULL, 'source_file', 'MARIADB_IMMUTABLE_RAW',
    'source_row_number', 1, 'source_record_id', s.source_record_id, 'posting_date', s.created_at,
    'seller_name', COALESCE(NULLIF(btrim(s.user_name), ''), NULLIF(btrim(s.from_name), ''), 'Source dealer'),
    'seller_phone', NULL, 'contact_publication_approved', false, 'raw_message', s.raw_message_text,
    'listing_type', s.listing_type, 'brand_scope', s.canonical_brand, 'supplied_brand', s.brand_original,
    'canonical_brand', s.canonical_brand, 'model', s.public_model, 'catalog_model', s.public_model,
    'raw_reference', CASE WHEN s.public_reference IS NOT NULL THEN s.reference_original ELSE NULL END,
    'normalized_reference', s.public_reference,
    'catalog_reference', CASE WHEN s.catalog_reference_confirmed THEN s.public_reference ELSE NULL END,
    'catalog_reference_confirmed', s.catalog_reference_confirmed,
    'dial_color', s.dial_color_normalized, 'catalog_dial', s.dial_color_normalized,
    'condition', s.condition_normalized,
    'workbook_price_usd', CASE WHEN s.reference_price_collision THEN NULL
      WHEN s.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') THEN s.price_usd
      WHEN s.price_lane = 'OWNER_ASSUMED_USD_CANDIDATE' THEN s.price_normalized ELSE NULL END,
    'source_price_amount', CASE WHEN s.reference_price_collision THEN NULL ELSE s.price_normalized END,
    'source_currency', CASE WHEN s.reference_price_collision THEN NULL ELSE s.currency_normalized END,
    'price_evidence_status', CASE WHEN s.reference_price_collision
      THEN 'REFERENCE_PRICE_COLLISION_WITHHELD' ELSE s.price_lane END,
    'confidence', s.overall_confidence, 'verdict', s.verdict,
    'verification_status', 'APPROVED_SINGLE_CANDIDATE', 'user_image_url', NULL,
    'imported_at', s.created_at, 'has_exact_source_image', false,
    'verified_price_usd', CASE WHEN NOT s.reference_price_collision
      AND s.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') THEN s.price_usd ELSE NULL END,
    'has_verified_usd_price', NOT s.reference_price_collision
      AND s.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') AND COALESCE(s.price_usd, 0) > 0,
    'has_complete_identity', s.public_reference IS NOT NULL,
    'trading_floor_status', 'RELEASED_' || upper(s.canonical_brand),
    'reference_search_key', regexp_replace(upper(COALESCE(s.public_reference, '')), '[^A-Z0-9]', '', 'g'),
    'location', NULLIF(btrim(s.location), ''), 'item_category', 'WATCH', 'publication_state', 'APPROVED',
    'publication_lane', 'QNSA_' || upper(s.canonical_brand) || '_RELEASE_V1',
    'normalization_run_complete', true, 'raw_lineage_verified', true,
    'dealer_id', s.exact_dealer_id, 'dealer_rating', NULL, 'review_count', NULL
  ) FROM selected s ORDER BY s.release_order;
$$;

REVOKE ALL ON FUNCTION public.qnsa_controlled_model_release_count(text,text,text),
  public.qnsa_controlled_model_page_rows(text,text,integer,integer,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_controlled_model_release_count(text,text,text),
  public.qnsa_controlled_model_page_rows(text,text,integer,integer,text,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
