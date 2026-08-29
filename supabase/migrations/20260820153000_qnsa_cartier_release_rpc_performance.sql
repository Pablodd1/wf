-- Bound Cartier reads by paging the immutable release manifest before touching staging.
ALTER TABLE public.qnsa_cartier_release_manifest ADD COLUMN IF NOT EXISTS listing_type text;

UPDATE public.qnsa_cartier_release_manifest m
SET listing_type = upper(COALESCE(l.listing_type, l.intent, ''))
FROM staging.listings l
WHERE l.id = m.listing_id AND m.listing_type IS NULL;

ALTER TABLE public.qnsa_cartier_release_manifest ALTER COLUMN listing_type SET NOT NULL;
ALTER TABLE public.qnsa_cartier_release_manifest
  DROP CONSTRAINT IF EXISTS qnsa_cartier_release_manifest_listing_type_check;
ALTER TABLE public.qnsa_cartier_release_manifest
  ADD CONSTRAINT qnsa_cartier_release_manifest_listing_type_check CHECK (listing_type IN ('WTS','WTB'));
CREATE INDEX IF NOT EXISTS idx_qnsa_cartier_manifest_run_type_order
  ON public.qnsa_cartier_release_manifest(release_run_key, listing_type, release_order);

CREATE OR REPLACE FUNCTION public.qnsa_cartier_release_count(p_listing_type text DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, staging, pg_catalog AS $$
  SELECT count(*)
  FROM public.qnsa_cartier_release_control c
  JOIN public.qnsa_cartier_release_manifest m ON m.release_run_key = c.release_run_key
  WHERE c.singleton = true AND c.enabled = true
    AND (p_listing_type IS NULL OR m.listing_type = upper(p_listing_type));
$$;

CREATE OR REPLACE FUNCTION public.qnsa_cartier_page_rows(
  p_limit integer DEFAULT 51, p_offset integer DEFAULT 0,
  p_listing_type text DEFAULT NULL, p_reference text DEFAULT NULL
)
RETURNS TABLE(row_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, staging, pg_catalog AS $$
  WITH manifest_page AS MATERIALIZED (
    SELECT m.*
    FROM public.qnsa_cartier_release_control c
    JOIN public.qnsa_cartier_release_manifest m ON m.release_run_key = c.release_run_key
    WHERE c.singleton = true AND c.enabled = true
      AND (p_listing_type IS NULL OR m.listing_type = upper(p_listing_type))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(m.public_reference, '')), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(p_reference), '[^A-Z0-9]', '', 'g'))
    ORDER BY m.release_order
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 51), 1), 101)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ), selected AS MATERIALIZED (
    SELECT m.release_order, m.public_reference, m.public_model, m.catalog_reference_confirmed, m.price_lane,
      l.id, l.source_record_id, l.created_at, l.user_name, l.from_name, l.raw_message_text,
      m.listing_type, l.brand_original, l.reference_original, l.reference_normalized,
      l.dial_color_normalized, l.condition_normalized, l.price_usd, l.price_normalized,
      l.currency_normalized, l.overall_confidence, l.verdict, l.location,
      dl.dealer_id AS exact_dealer_id,
      CASE WHEN btrim(l.reference_normalized) ~ '^[0-9]+$'
        THEN COALESCE(btrim(l.reference_normalized)::numeric = COALESCE(l.price_normalized, l.price_usd), false)
        ELSE false END AS reference_price_collision
    FROM manifest_page m
    JOIN staging.listings l ON l.id = m.listing_id
    LEFT JOIN public.dealer_listing_links dl ON dl.listing_id = l.id AND dl.link_status = 'APPLIED'
    WHERE l.brand_normalized = 'Cartier'
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
    'listing_type', s.listing_type, 'brand_scope', 'Cartier', 'supplied_brand', s.brand_original,
    'canonical_brand', 'Cartier', 'model', s.public_model, 'catalog_model', s.public_model,
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
    'has_complete_identity', s.public_reference IS NOT NULL, 'trading_floor_status', 'RELEASED_CARTIER',
    'reference_search_key', regexp_replace(upper(COALESCE(s.public_reference, '')), '[^A-Z0-9]', '', 'g'),
    'location', NULLIF(btrim(s.location), ''), 'item_category', 'WATCH', 'publication_state', 'APPROVED',
    'publication_lane', 'QNSA_CARTIER_RELEASE_V1', 'normalization_run_complete', true,
    'raw_lineage_verified', true, 'dealer_id', s.exact_dealer_id, 'dealer_rating', NULL, 'review_count', NULL
  ) FROM selected s ORDER BY s.release_order;
$$;

CREATE OR REPLACE FUNCTION public.qnsa_cartier_reference_index()
RETURNS TABLE(model text, reference text, listing_count bigint, wts_count bigint,
  wtb_count bigint, priced_wts_count bigint, catalog_reference_confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, staging, pg_catalog AS $$
  SELECT m.public_model, m.public_reference, count(*)::bigint,
    count(*) FILTER (WHERE m.listing_type = 'WTS')::bigint,
    count(*) FILTER (WHERE m.listing_type = 'WTB')::bigint,
    count(*) FILTER (WHERE m.listing_type = 'WTS'
      AND m.price_lane NOT IN ('PRICE_NOT_SUPPLIED','WTB_PRICE_WITHHELD'))::bigint,
    bool_or(m.catalog_reference_confirmed)
  FROM public.qnsa_cartier_release_control c
  JOIN public.qnsa_cartier_release_manifest m ON m.release_run_key = c.release_run_key
  WHERE c.singleton = true AND c.enabled = true
  GROUP BY m.public_model, m.public_reference
  ORDER BY count(*) DESC, m.public_model, m.public_reference NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.qnsa_cartier_release_count(text),
  public.qnsa_cartier_page_rows(integer,integer,text,text),
  public.qnsa_cartier_reference_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_cartier_release_count(text),
  public.qnsa_cartier_page_rows(integer,integer,text,text),
  public.qnsa_cartier_reference_index() TO service_role;
NOTIFY pgrst, 'reload schema';
