BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.sync_qnsa_dealer_public_listing_links_batch(
  p_source_identity text,
  p_after_id text DEFAULT NULL,
  p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_phone text := public.normalize_seller_phone_identity(p_source_identity);
  v_dealer_id uuid;
  v_applied integer := 0;
  v_next_id text;
  v_scanned integer := 0;
BEGIN
  IF v_phone IS NULL THEN RAISE EXCEPTION 'verified phone identity is required'; END IF;
  SELECT min(dealer_id::text)::uuid INTO v_dealer_id
  FROM public.dealer_source_identities
  WHERE verification_status = 'VERIFIED'
    AND upper(identity_type) IN ('PHONE','WHATSAPP')
    AND public.normalize_seller_phone_identity(source_identity) = v_phone;
  IF v_dealer_id IS NULL THEN RAISE EXCEPTION 'verified dealer identity was not found'; END IF;

  WITH candidates AS MATERIALIZED (
    SELECT l.id
    FROM staging.listings l
    WHERE l.contact_number IN (v_phone, '+' || v_phone)
      AND (p_after_id IS NULL OR l.id::text > p_after_id)
    ORDER BY l.id::text
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  ), page AS MATERIALIZED (
    SELECT feed.id::uuid AS listing_id, feed.source_record_id, feed.seller_name
    FROM candidates candidate
    JOIN public.qnsa_rolex_patek_trading_floor_source feed
      ON feed.id::uuid = candidate.id
  ), inserted AS (
    INSERT INTO public.dealer_listing_links (
      listing_id, source_record_id, dealer_id, source_system, source_identity,
      link_method, link_status, evidence, updated_at
    )
    SELECT listing_id, source_record_id, v_dealer_id,
      'QNSA_PUBLIC_TRADING_FLOOR', v_phone, 'EXACT_VERIFIED_PHONE', 'APPLIED',
      jsonb_build_object('seller_name', seller_name, 'public_release_gate', true), now()
    FROM page
    ON CONFLICT (listing_id) DO UPDATE SET
      dealer_id = EXCLUDED.dealer_id, source_record_id = EXCLUDED.source_record_id,
      source_system = EXCLUDED.source_system, source_identity = EXCLUDED.source_identity,
      link_status = 'APPLIED', evidence = EXCLUDED.evidence, updated_at = now()
    RETURNING listing_id
  )
  SELECT
    (SELECT count(*) FROM inserted),
    (SELECT count(*) FROM candidates),
    (SELECT max(id::text) FROM candidates)
  INTO v_applied, v_scanned, v_next_id;
  RETURN jsonb_build_object(
    'applied', v_applied,
    'scanned', v_scanned,
    'next_id', v_next_id,
    'has_more', v_scanned = LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_qnsa_dealer_public_listing_links_batch(text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_qnsa_dealer_public_listing_links_batch(text,text,integer)
  TO service_role;
COMMIT;
