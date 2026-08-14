BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.sync_qnsa_dealer_public_listing_links()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_applied integer := 0;
BEGIN
  INSERT INTO public.dealer_listing_links (
    listing_id, source_record_id, dealer_id, source_system, source_identity,
    link_method, link_status, evidence, updated_at
  )
  SELECT feed.id::uuid, feed.source_record_id, identity.dealer_id,
    'QNSA_PUBLIC_TRADING_FLOOR', public.normalize_seller_phone_identity(feed.seller_phone),
    'EXACT_VERIFIED_PHONE', 'APPLIED',
    jsonb_build_object('seller_name', feed.seller_name, 'public_release_gate', true), now()
  FROM public.qnsa_rolex_patek_trading_floor_source feed
  JOIN public.dealer_source_identities identity
    ON identity.verification_status = 'VERIFIED'
   AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
   AND public.normalize_seller_phone_identity(identity.source_identity)
       = public.normalize_seller_phone_identity(feed.seller_phone)
  WHERE public.normalize_seller_phone_identity(feed.seller_phone) IS NOT NULL
  ON CONFLICT (listing_id) DO UPDATE SET
    dealer_id = EXCLUDED.dealer_id, source_record_id = EXCLUDED.source_record_id,
    source_system = EXCLUDED.source_system, source_identity = EXCLUDED.source_identity,
    link_status = 'APPLIED', evidence = EXCLUDED.evidence, updated_at = now();
  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN jsonb_build_object('applied', v_applied);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_qnsa_dealer_public_listing_links() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_qnsa_dealer_public_listing_links() TO service_role;
COMMIT;
