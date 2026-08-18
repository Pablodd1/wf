-- Prevent the public Reference Check search from acting as a private-phone
-- identity confirmation oracle. Contact lookup remains available only when
-- the canonical dealer explicitly granted publication consent.
BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_dealer_directory_page(
  p_search text DEFAULT NULL, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  WITH activity AS (
    SELECT dealer_id,
      count(*) FILTER (WHERE upper(COALESCE(l.listing_type, l.intent, '')) = 'WTS') wts_count,
      count(*) FILTER (WHERE upper(COALESCE(l.listing_type, l.intent, '')) = 'WTB') wtb_count,
      min(l.created_at) first_post, max(l.created_at) latest_post
    FROM public.dealer_listing_links link
    JOIN staging.listings l ON l.id = link.listing_id
    WHERE link.link_status = 'APPLIED'
    GROUP BY dealer_id
  ), filtered AS (
    SELECT d.*, COALESCE(a.wts_count, 0) wts_count, COALESCE(a.wtb_count, 0) wtb_count,
      a.first_post, a.latest_post,
      count(*) OVER () total_count
    FROM public.dealers d LEFT JOIN activity a ON a.dealer_id = d.id
    WHERE d.status = 'VERIFIED' AND (
      NULLIF(btrim(p_search), '') IS NULL
      OR d.display_name ILIKE '%' || btrim(p_search) || '%'
      OR d.company_name ILIKE '%' || btrim(p_search) || '%'
      OR (d.contact_consent = true AND EXISTS (
        SELECT 1 FROM public.dealer_source_identities i
        WHERE i.dealer_id = d.id AND i.verification_status = 'VERIFIED'
          AND upper(i.identity_type) IN ('PHONE', 'WHATSAPP')
          AND public.normalize_seller_phone_identity(i.source_identity)
              LIKE '%' || public.normalize_seller_phone_identity(p_search) || '%'
      ))
    )
    ORDER BY d.review_count DESC, d.display_name, d.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', COALESCE(max(total_count), 0),
    'dealers', COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'slug', slug, 'display_name', display_name,
      'company_name', company_name, 'country_code', country_code, 'city', city,
      'rating', rating, 'review_count', review_count,
      'whatsapp_group_count', whatsapp_group_count, 'member_since', member_since,
      'verified_at', verified_at,
      'stats', jsonb_build_object('wts_posts', wts_count, 'wtb_posts', wtb_count,
        'first_post_at', first_post, 'last_post_at', latest_post)
    ) ORDER BY review_count DESC, display_name, id), '[]'::jsonb)
  ) FROM filtered;
$$;

REVOKE ALL ON FUNCTION public.qnsa_dealer_directory_page(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_dealer_directory_page(text, integer, integer)
  TO service_role;

COMMIT;
