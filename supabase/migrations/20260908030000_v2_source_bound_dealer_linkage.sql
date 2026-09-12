-- Reuse the private reviewed lineage ledger. No name matching or implicit consent.
BEGIN;
SET LOCAL lock_timeout='5s';
-- V2 binds the complete source SHA-256; it must not invent a legacy title SHA-1.
ALTER TABLE public.seller_listing_lineage_staging ALTER COLUMN title_sha1 DROP NOT NULL;
ALTER TABLE public.seller_listing_lineage_staging ADD CONSTRAINT seller_lineage_title_evidence
 CHECK(title_sha1 IS NOT NULL OR source_system='WF_V2_SOURCE_BOUND');
CREATE TABLE wf_canonical_staging.v2_dealer_link_versions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 prior_state jsonb NOT NULL
);
ALTER TABLE wf_canonical_staging.v2_dealer_link_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.v2_dealer_link_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION wf_canonical_staging.retain_v2_dealer_link_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO wf_canonical_staging.v2_dealer_link_versions(prior_state) VALUES(to_jsonb(OLD));
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.retain_v2_dealer_link_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retain_v2_dealer_link_version BEFORE UPDATE ON public.seller_listing_lineage_staging
 FOR EACH ROW WHEN (OLD.source_system='WF_V2_SOURCE_BOUND' AND OLD IS DISTINCT FROM NEW)
 EXECUTE FUNCTION wf_canonical_staging.retain_v2_dealer_link_version();

CREATE FUNCTION wf_canonical_staging.resolve_v2_source_dealer(p_listing_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v wf_canonical_staging.mariadb_canary_published_listings_v2;
 r wf_canonical_staging.mariadb_raw_source_rows; phone text; dealer uuid; identity_id bigint; result jsonb;
BEGIN
 SELECT * INTO v FROM wf_canonical_staging.mariadb_canary_published_listings_v2
 WHERE listing_id=p_listing_id AND is_bundle IS FALSE AND parent_listing_id IS NULL AND child_index IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 result=jsonb_build_object('contract','V2_SOURCE_BOUND','listing_id',v.listing_id,'source_id',v.source_id,'source_hash',v.source_hash);
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_raw_source_rows raw WHERE raw.source_id=v.source_id AND raw.source_hash<>v.source_hash) THEN
  RETURN result||jsonb_build_object('reason','CONFLICTING_SOURCE_VERSIONS');
 END IF;
 SELECT * INTO r FROM wf_canonical_staging.mariadb_raw_source_rows raw
 WHERE raw.source_id=v.source_id AND raw.source_hash=v.source_hash ORDER BY raw.id LIMIT 1;
 IF NOT FOUND OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact'
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

CREATE FUNCTION public.reconcile_v2_listing_dealers(p_listing_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE listing text; proof jsonb; applied integer:=0; review integer:=0; changed integer:=0; n integer;
BEGIN
 IF cardinality(p_listing_ids) IS NULL OR cardinality(p_listing_ids) NOT BETWEEN 1 AND 500
  OR EXISTS(SELECT 1 FROM unnest(p_listing_ids) id WHERE id IS NULL OR length(id)>250)
  OR cardinality(p_listing_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_listing_ids) id) THEN
  RAISE EXCEPTION 'invalid_listing_batch' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(724050,3);
 FOREACH listing IN ARRAY p_listing_ids LOOP
  proof=wf_canonical_staging.resolve_v2_source_dealer(listing);
  IF proof IS NULL THEN RAISE EXCEPTION 'single_listing_not_found' USING ERRCODE='22023'; END IF;
  INSERT INTO public.seller_listing_lineage_staging AS current
   (source_system,source_record_id,seller_listing_id,title_sha1,source_identity,match_status,match_evidence,matched_dealer_id)
  VALUES('WF_V2_SOURCE_BOUND',listing,proof->>'source_id',NULL,
   coalesce(proof->>'source_identity',''),CASE WHEN proof->>'dealer_id' IS NOT NULL THEN 'APPLIED' ELSE 'REVIEW_REQUIRED' END,
   proof-'source_identity',(proof->>'dealer_id')::uuid)
  ON CONFLICT(source_system,source_record_id,seller_listing_id) DO UPDATE SET
   source_identity=excluded.source_identity,match_status=excluded.match_status,
   match_evidence=excluded.match_evidence,matched_dealer_id=excluded.matched_dealer_id,updated_at=now()
  WHERE current.source_identity IS DISTINCT FROM excluded.source_identity OR current.match_status IS DISTINCT FROM excluded.match_status
   OR current.match_evidence IS DISTINCT FROM excluded.match_evidence OR current.matched_dealer_id IS DISTINCT FROM excluded.matched_dealer_id;
  GET DIAGNOSTICS n=ROW_COUNT;changed=changed+n;
  IF proof->>'dealer_id' IS NULL THEN review=review+1; ELSE applied=applied+1; END IF;
 END LOOP;
 -- A publisher calls this before preparing the new immutable publication.
 IF changed>0 THEN UPDATE wf_canonical_staging.publication_revision SET revision=revision+1 WHERE singleton; END IF;
 RETURN jsonb_build_object('inputs',cardinality(p_listing_ids),'applied',applied,'review',review,'changed',changed,'unchanged',cardinality(p_listing_ids)-changed);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_v2_listing_dealers(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_v2_listing_dealers(text[]) TO service_role;

CREATE VIEW wf_canonical_staging.v2_approved_listing_dealers WITH(security_invoker=true) AS
 SELECT l.source_record_id AS listing_id,l.seller_listing_id AS source_id,l.match_evidence->>'source_hash' AS source_hash,
 d.id AS dealer_id,'/reference-check/'||d.id::text AS profile_path,d.rating,d.review_count,d.contact_consent
 FROM public.seller_listing_lineage_staging l
 JOIN public.dealers d ON d.id=l.matched_dealer_id AND d.status='VERIFIED'
 JOIN public.dealer_source_identities i ON i.id=CASE WHEN l.match_evidence->>'identity_id' ~ '^[0-9]{1,18}$' THEN (l.match_evidence->>'identity_id')::bigint END
  AND i.dealer_id=d.id AND i.verification_status='VERIFIED' AND upper(i.identity_type) IN ('PHONE','WHATSAPP')
  AND public.normalize_seller_phone_identity(i.source_identity)=l.source_identity
 WHERE l.source_system='WF_V2_SOURCE_BOUND' AND l.match_status='APPLIED' AND l.match_evidence->>'contract'='V2_SOURCE_BOUND';
REVOKE ALL ON wf_canonical_staging.v2_approved_listing_dealers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON wf_canonical_staging.v2_approved_listing_dealers TO service_role;

CREATE FUNCTION public.get_v2_listing_contact(p_listing_id text,p_surface text DEFAULT 'trading-floor') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v wf_canonical_staging.mariadb_canary_published_listings_v2; proof jsonb; d public.dealers;
BEGIN
 IF p_surface NOT IN ('trading-floor','price-research') OR p_surface IS NULL OR p_listing_id IS NULL OR length(p_listing_id)>250 THEN
  RAISE EXCEPTION 'invalid_contact_query' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=p_listing_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.trading_floor_ready_view_v2 WHERE listing_id=p_listing_id)
  OR (p_surface='price-research' AND NOT EXISTS(SELECT 1 FROM public.price_research_ready_view_v2 WHERE listing_id=p_listing_id)) THEN RETURN NULL; END IF;
 proof=wf_canonical_staging.resolve_v2_source_dealer(p_listing_id);
 IF proof->>'dealer_id' IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.seller_listing_lineage_staging l WHERE l.source_system='WF_V2_SOURCE_BOUND'
  AND l.source_record_id=v.listing_id AND l.seller_listing_id=v.source_id AND l.match_status='APPLIED'
  AND l.match_evidence=proof-'source_identity' AND l.source_identity=proof->>'source_identity'
 ) THEN RETURN jsonb_build_object('contact_available',false,'reason','SELLER_LINEAGE_UNVERIFIED'); END IF;
 SELECT * INTO d FROM public.dealers WHERE id=(proof->>'dealer_id')::uuid AND status='VERIFIED';
 IF NOT FOUND OR NOT d.contact_consent THEN RETURN jsonb_build_object('contact_available',false,'reason','CONTACT_CONSENT_NOT_GRANTED'); END IF;
 RETURN jsonb_build_object('contact_available',true,'dealer_id',d.id,'dealer_name',d.display_name,
  'dealer_profile_url','/reference-check/'||d.id::text,'dealer_rating',CASE WHEN d.review_count>0 AND d.rating BETWEEN 0 AND 5 THEN d.rating ELSE NULL END,
  'dealer_review_count',d.review_count,'contact_phone',proof->>'source_identity','brand',v.brand,'reference',v.reference);
END;
$$;
REVOKE ALL ON FUNCTION public.get_v2_listing_contact(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_v2_listing_contact(text,text) TO service_role;
CREATE OR REPLACE VIEW public.trading_floor_ready_view_v2 WITH(security_invoker=true) AS
SELECT
 v.contract_version AS contract_version,
 v.listing_id AS listing_id,
 v.parent_listing_id AS parent_listing_id,
 v.child_index AS child_index,
 v.source_id AS source_id,
 v.source_hash AS source_hash,
 v.raw_message_id AS raw_message_id,
 v.raw_message_text AS raw_message_text,
 v.source_context_text AS source_context_text,
 v.source_created_at AS source_created_at,
 v.observed_at AS observed_at,
 v.category AS category,
 v.brand AS brand,
 v.model AS model,
 v.reference AS reference,
 v.dial_color AS dial_color,
 v.year AS year,
 v.condition AS condition,
 v.intent AS intent,
 v.intent_status AS intent_status,
 v.title AS title,
 v.description AS description,
 v.original_price_text AS original_price_text,
 v.original_price_amount AS original_price_amount,
 v.original_price_currency AS original_price_currency,
 v.price_usd AS price_usd,
 v.fx_rate AS fx_rate,
 v.fx_source AS fx_source,
 v.fx_date AS fx_date,
 v.price_status AS price_status,
 v.price_research_eligible AS price_research_eligible,
 v.included_in_statistics AS included_in_statistics,
 v.statistics_exclusion_reason AS statistics_exclusion_reason,
 v.image_url AS image_url,
 v.thumbnail_url AS thumbnail_url,
 v.image_key AS image_key,
 v.image_evidence_type AS image_evidence_type,
 v.image_status AS image_status,
 coalesce(d.dealer_id::text,v.seller_id) AS seller_id,
 v.seller_display_name AS seller_display_name,
 d.profile_path AS seller_profile_url,
 d.review_count AS seller_review_count,
 v.seller_listing_count AS seller_listing_count,
 v.seller_wts_count AS seller_wts_count,
 v.seller_wtb_count AS seller_wtb_count,
 coalesce(d.contact_consent,false) AS contact_available,
 v.location_country AS location_country,
 v.location_region AS location_region,
 v.is_bundle AS is_bundle,
 v.bundle_child_count AS bundle_child_count,
 v.review_status AS review_status,
 v.review_reasons AS review_reasons,
 v.priced_rank AS priced_rank,
 v.image_rank AS image_rank,
 v.duplicate_group_id AS duplicate_group_id,
 CASE WHEN d.review_count>0 AND d.rating>0 AND d.rating<=5 THEN d.rating ELSE NULL END AS seller_rating,
 CASE WHEN d.review_count>0 AND d.rating>0 AND d.rating<=5 THEN 'SOURCE_SUPPLIED' WHEN d.review_count>0 THEN 'SOURCE_FEEDBACK_COUNT' ELSE 'UNAVAILABLE' END AS seller_rating_evidence_status
FROM (
SELECT
contract_version, listing_id, parent_listing_id, child_index, source_id, source_hash,
  raw_message_id, raw_message_text, source_context_text, source_created_at, observed_at,
  category, brand, model, reference, dial_color, year, condition, intent, intent_status,
  title, description, original_price_text, original_price_amount, original_price_currency,
  price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible,
  included_in_statistics, statistics_exclusion_reason, image_url, thumbnail_url, image_key,
  image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
  seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
  contact_available, location_country, location_region, is_bundle, bundle_child_count,
  review_status, review_reasons,
  CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END AS priced_rank,
  CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT'
         AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END AS image_rank,
  duplicate_group_id
FROM wf_canonical_staging.mariadb_canary_published_listings_v2 v
WHERE v.is_bundle IS FALSE AND v.parent_listing_id IS NULL AND v.child_index IS NULL
) v LEFT JOIN wf_canonical_staging.v2_approved_listing_dealers d
 ON d.listing_id=v.listing_id AND d.source_id=v.source_id AND d.source_hash=v.source_hash;

CREATE OR REPLACE VIEW public.price_research_ready_view_v2
WITH (security_invoker = true) AS
SELECT *
FROM public.trading_floor_ready_view_v2 v
WHERE v.intent = 'WTS'
  AND v.price_research_eligible IS TRUE
  AND v.price_usd > 0
  AND (
    upper(v.original_price_currency) = 'USD'
    OR (
      upper(v.original_price_currency) <> 'USD'
      AND v.fx_rate > 0
      AND NULLIF(btrim(v.fx_source), '') IS NOT NULL
      AND v.fx_date IS NOT NULL
    )
  );


UPDATE wf_canonical_staging.publication_revision SET revision=revision+1 WHERE singleton;
NOTIFY pgrst,'reload schema';
COMMIT;
