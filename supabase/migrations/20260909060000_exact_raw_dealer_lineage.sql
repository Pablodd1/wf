BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION wf_canonical_staging.resolve_v2_source_dealer(p_listing_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v wf_canonical_staging.mariadb_canary_published_listings_v2;
 r wf_canonical_staging.mariadb_raw_source_rows; phone text; dealer uuid; identity_id bigint; result jsonb;
BEGIN
 SELECT * INTO v FROM wf_canonical_staging.mariadb_canary_published_listings_v2
 WHERE listing_id=p_listing_id AND is_bundle IS FALSE AND parent_listing_id IS NULL AND child_index IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 result=jsonb_build_object('contract','V2_SOURCE_BOUND','listing_id',v.listing_id,'source_id',v.source_id,'source_hash',v.source_hash);
 -- New materializations carry the exact persisted raw UUID. Historical versions
 -- outside that identity cannot invalidate the selected source-bound evidence.
 SELECT * INTO r FROM wf_canonical_staging.mariadb_raw_source_rows raw
 WHERE raw.id=CASE WHEN v.raw_message_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN v.raw_message_id::uuid ELSE NULL END;
 IF FOUND THEN
  IF r.source_id IS DISTINCT FROM v.source_id OR r.source_hash IS DISTINCT FROM v.source_hash THEN
   RETURN result||jsonb_build_object('reason','SOURCE_CONTENT_UNVERIFIED'); END IF;
 ELSE
  -- Legacy rows without an exact raw UUID keep their conservative ambiguity hold.
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_raw_source_rows raw WHERE raw.source_id=v.source_id AND raw.source_hash<>v.source_hash) THEN
   RETURN result||jsonb_build_object('reason','CONFLICTING_SOURCE_VERSIONS'); END IF;
  SELECT * INTO r FROM wf_canonical_staging.mariadb_raw_source_rows raw
  WHERE raw.source_id=v.source_id AND raw.source_hash=v.source_hash ORDER BY raw.id LIMIT 1;
 END IF;
 IF r.id IS NULL OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact'
  OR r.hash_algorithm IS DISTINCT FROM 'sha256' OR r.raw_payload ? '_lossless_raw_evidence'
  OR (r.raw_payload ? 'id' AND r.raw_payload->>'id' IS DISTINCT FROM v.source_id)
  OR coalesce(r.raw_message_source,'description') NOT IN ('description','title','comments')
  OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR encode(extensions.digest(convert_to(r.raw_payload_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM v.source_hash
  OR r.raw_message IS DISTINCT FROM v.raw_message_text
  OR r.raw_message IS DISTINCT FROM r.raw_payload->>coalesce(r.raw_message_source,'description') THEN
  RETURN result||jsonb_build_object('reason','SOURCE_CONTENT_UNVERIFIED');
 END IF;
 result=result||jsonb_build_object('raw_row_id',r.id);
 phone=public.normalize_seller_phone_identity(r.raw_payload->>'from_number');
 IF phone IS NULL THEN RETURN result||jsonb_build_object('reason','MISSING_SOURCE_CONTACT'); END IF;
 SELECT i.dealer_id,i.id INTO dealer,identity_id FROM public.dealer_source_identities i
 JOIN public.dealers d ON d.id=i.dealer_id AND d.status='VERIFIED'
 WHERE i.verification_status='VERIFIED' AND upper(i.identity_type) IN ('PHONE','WHATSAPP')
 AND public.normalize_seller_phone_identity(i.source_identity)=phone;
 IF NOT FOUND THEN RETURN result||jsonb_build_object('reason','VERIFIED_DEALER_NOT_FOUND'); END IF;
 -- A unique verified-phone index prevents ambiguous cross-dealer matches.
 RETURN result||jsonb_build_object('reason','EXACT_VERIFIED_PHONE','dealer_id',dealer,'identity_id',identity_id,'source_identity',phone);
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.resolve_v2_source_dealer(text) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
