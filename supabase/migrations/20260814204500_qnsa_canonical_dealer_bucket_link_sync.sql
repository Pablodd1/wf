BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.sync_qnsa_dealer_public_listing_links_bucket(
  p_source_identity text,
  p_bucket text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_phone text := public.normalize_seller_phone_identity(p_source_identity);
  v_dealer_id uuid;
  v_applied integer := 0;
BEGIN
  IF v_phone IS NULL THEN RAISE EXCEPTION 'verified phone identity is required'; END IF;
  IF p_bucket !~ '^[0-9a-f]$' THEN RAISE EXCEPTION 'one hexadecimal bucket is required'; END IF;
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
      AND substring(lower(l.id::text), 1, 1) = p_bucket
  ), public_rows AS MATERIALIZED (
    SELECT feed.id::uuid listing_id, feed.source_record_id, feed.seller_name
    FROM candidates candidate
    JOIN public.qnsa_rolex_patek_trading_floor_source feed ON feed.id::uuid = candidate.id
  )
  INSERT INTO public.dealer_listing_links (
    listing_id, source_record_id, dealer_id, source_system, source_identity,
    link_method, link_status, evidence, updated_at
  )
  SELECT listing_id, source_record_id, v_dealer_id, 'QNSA_PUBLIC_TRADING_FLOOR', v_phone,
    'EXACT_VERIFIED_PHONE', 'APPLIED',
    jsonb_build_object('seller_name', seller_name, 'public_release_gate', true), now()
  FROM public_rows
  ON CONFLICT (listing_id) DO UPDATE SET
    dealer_id = EXCLUDED.dealer_id, source_record_id = EXCLUDED.source_record_id,
    source_system = EXCLUDED.source_system, source_identity = EXCLUDED.source_identity,
    link_status = 'APPLIED', evidence = EXCLUDED.evidence, updated_at = now();
  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN jsonb_build_object('applied', v_applied, 'bucket', p_bucket);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_qnsa_dealer_public_listing_links_bucket(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_qnsa_dealer_public_listing_links_bucket(text,text)
  TO service_role;
COMMIT;
