-- Candidate-driven non-watch exact dealer linkage.
--
-- Traverse only the three released non-watch category streams through the
-- existing idx_staging_qnsa_market_feed_page partial index. Every candidate is
-- then rejoined to immutable raw evidence by primary key plus exact source ID
-- and hash before an exact unique VERIFIED phone identity can be linked.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.qnsa_non_watch_dealer_candidate_link_page(
  p_expected_run_key text,
  p_category text,
  p_boundary_created_at timestamptz,
  p_boundary_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_apply boolean DEFAULT false,
  p_apply_limit integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, staging
AS $$
DECLARE
  v_run_key text;
  v_categories text[];
  v_category text := upper(NULLIF(btrim(p_category), ''));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
  v_apply_limit integer := CASE WHEN p_apply_limit IS NULL THEN 2147483647
    ELSE LEAST(GREATEST(p_apply_limit, 0), 10) END;
  v_scanned integer := 0;
  v_eligible integer := 0;
  v_applied integer := 0;
  v_already_linked integer := 0;
  v_conflicting integer := 0;
  v_dealers_matched integer := 0;
  v_next_created_at timestamptz;
  v_next_id uuid;
  v_has_more boolean := false;
  v_listing_ids uuid[] := ARRAY[]::uuid[];
  v_source_record_ids text[] := ARRAY[]::text[];
  v_dealer_ids uuid[] := ARRAY[]::uuid[];
  v_matched_phones text[] := ARRAY[]::text[];
BEGIN
  IF v_category IS NULL OR v_category NOT IN ('HANDBAG','JEWELRY','ACCESSORY') THEN
    RAISE EXCEPTION 'released non-watch category is required';
  END IF;
  IF NULLIF(btrim(p_expected_run_key), '') IS NULL
      OR p_boundary_created_at IS NULL OR p_boundary_id IS NULL THEN
    RAISE EXCEPTION 'frozen release run and category boundary are required';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'category cursor timestamp and id must be supplied together';
  END IF;
  IF p_apply AND p_apply_limit IS NOT NULL AND p_apply_limit NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'bounded apply limit must be between zero and ten';
  END IF;

  SELECT enabled_run_key, enabled_categories INTO v_run_key, v_categories
  FROM public.qnsa_market_feed_control
  WHERE singleton=true AND enabled=true;
  IF v_run_key IS NULL OR v_run_key<>p_expected_run_key
      OR NOT (v_category=ANY(v_categories)) THEN
    RAISE EXCEPTION 'frozen non-watch release control changed or category is disabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dealer_source_identities AS identity
    WHERE identity.verification_status='VERIFIED'
      AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
      AND public.normalize_seller_phone_identity(identity.source_identity) IS NOT NULL
    GROUP BY public.normalize_seller_phone_identity(identity.source_identity)
    HAVING count(DISTINCT identity.dealer_id)>1
  ) THEN
    RAISE EXCEPTION 'duplicate verified phone identity exists';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT listing.id, listing.created_at, listing.raw_message_version_id,
      listing.source_record_id, listing.source_hash
    FROM staging.listings AS listing
    WHERE listing.normalization_run_key=v_run_key
      AND listing.category=v_category
      AND listing.parent_id IS NULL
      AND COALESCE(listing.is_bundle,false)=false
      AND listing.provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'
      AND upper(COALESCE(listing.listing_type,listing.intent,'')) IN ('WTS','WTB')
      AND listing.raw_message_version_id IS NOT NULL
      AND COALESCE(listing.source_record_id,'')<>''
      AND listing.source_hash ~ '^[0-9a-f]{64}$'
      AND listing.source_candidate_hash ~ '^[0-9a-f]{64}$'
      AND lower(COALESCE(listing.trading_floor_status,'')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation',
        'suppressed_exact_duplicate','withdrawn','rejected','hidden',
        'deleted','archived')
      AND upper(COALESCE(listing.verdict,'')) NOT IN (
        'WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (listing.created_at,listing.id) <= (p_boundary_created_at,p_boundary_id)
      AND (p_before_created_at IS NULL
        OR (listing.created_at,listing.id) < (p_before_created_at,p_before_id))
    ORDER BY listing.created_at DESC, listing.id DESC
    LIMIT v_limit+1
  ), candidate_page AS MATERIALIZED (
    SELECT * FROM candidates
    ORDER BY created_at DESC,id DESC LIMIT v_limit
  ), eligible AS MATERIALIZED (
    SELECT DISTINCT page.id, page.source_record_id, identity.dealer_id,
      public.normalize_seller_phone_identity(
        raw_version.raw_payload#>>'{raw_data,from_number}') AS matched_phone,
      page.created_at
    FROM candidate_page AS page
    JOIN LATERAL (
      SELECT candidate_raw.*
      FROM public.raw_message_versions AS candidate_raw
      WHERE candidate_raw.id=page.raw_message_version_id
        AND candidate_raw.source_record_id=page.source_record_id
        AND candidate_raw.source_hash=page.source_hash
      OFFSET 0
    ) AS raw_version ON true
    JOIN public.dealer_source_identities AS identity
      ON identity.verification_status='VERIFIED'
     AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
     AND public.normalize_seller_phone_identity(identity.source_identity)
       = public.normalize_seller_phone_identity(
           raw_version.raw_payload#>>'{raw_data,from_number}')
    JOIN public.dealers AS dealer
      ON dealer.id=identity.dealer_id AND dealer.status='VERIFIED'
    JOIN staging.mariadb_normalization_import_checkpoints AS checkpoint
      ON checkpoint.run_key=v_run_key
     AND checkpoint.status='NORMALIZATION_STAGED' AND checkpoint.error_rows=0
  )
  SELECT
    COALESCE(array_agg(eligible.id ORDER BY eligible.created_at DESC,eligible.id DESC),ARRAY[]::uuid[]),
    COALESCE(array_agg(eligible.source_record_id ORDER BY eligible.created_at DESC,eligible.id DESC),ARRAY[]::text[]),
    COALESCE(array_agg(eligible.dealer_id ORDER BY eligible.created_at DESC,eligible.id DESC),ARRAY[]::uuid[]),
    COALESCE(array_agg(eligible.matched_phone ORDER BY eligible.created_at DESC,eligible.id DESC),ARRAY[]::text[]),
    (SELECT count(*) FROM candidate_page),
    (SELECT created_at FROM candidate_page ORDER BY created_at,id LIMIT 1),
    (SELECT id FROM candidate_page ORDER BY created_at,id LIMIT 1),
    (SELECT count(*)>v_limit FROM candidates),
    count(DISTINCT eligible.dealer_id)
  INTO v_listing_ids,v_source_record_ids,v_dealer_ids,v_matched_phones,
    v_scanned,v_next_created_at,v_next_id,v_has_more,v_dealers_matched
  FROM eligible;

  v_eligible:=COALESCE(cardinality(v_listing_ids),0);
  SELECT
    count(*) FILTER (WHERE link.dealer_id=candidate.dealer_id AND link.link_status='APPLIED'),
    count(*) FILTER (WHERE link.dealer_id IS NOT NULL
      AND (link.dealer_id<>candidate.dealer_id OR link.link_status<>'APPLIED'))
  INTO v_already_linked,v_conflicting
  FROM unnest(v_listing_ids,v_dealer_ids) AS candidate(listing_id,dealer_id)
  LEFT JOIN public.dealer_listing_links AS link ON link.listing_id=candidate.listing_id;
  IF v_conflicting<>0 THEN RAISE EXCEPTION 'conflicting dealer/listing link detected'; END IF;

  IF p_apply AND v_apply_limit>0 THEN
    INSERT INTO public.dealer_listing_links (
      listing_id,source_record_id,dealer_id,source_system,source_identity,
      link_method,link_status,evidence,updated_at)
    SELECT candidate.listing_id,candidate.source_record_id,candidate.dealer_id,
      'QNSA_NON_WATCH_RELEASE_GATED_RAW_LINEAGE',candidate.matched_phone,
      'EXACT_VERIFIED_PHONE','APPLIED',jsonb_build_object(
        'release_gate','QNSA_NON_WATCH_FEED_V1','item_category',v_category,
        'immutable_lineage_verified',true,'contact_value_private',true,
        'public_contact_requires_dealer_consent',true),now()
    FROM unnest(v_listing_ids,v_source_record_ids,v_dealer_ids,v_matched_phones)
      WITH ORDINALITY AS candidate(
        listing_id,source_record_id,dealer_id,matched_phone,ordinal)
    LEFT JOIN public.dealer_listing_links AS existing
      ON existing.listing_id=candidate.listing_id
    WHERE existing.listing_id IS NULL
    ORDER BY candidate.ordinal LIMIT v_apply_limit
    ON CONFLICT (listing_id) DO NOTHING;
    GET DIAGNOSTICS v_applied=ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'run_key',v_run_key,'category',v_category,'scanned',v_scanned,
    'eligible',v_eligible,'applied',v_applied,'already_linked',v_already_linked,
    'conflicting_links',v_conflicting,'dealers_matched',v_dealers_matched,
    'next_created_at',COALESCE(v_next_created_at,p_before_created_at),
    'next_id',COALESCE(v_next_id,p_before_id),'has_more',v_has_more,
    'apply_requested',p_apply,'status','OK');
END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_non_watch_dealer_candidate_link_page(
  text,text,timestamptz,uuid,timestamptz,uuid,integer,boolean,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_non_watch_dealer_candidate_link_page(
  text,text,timestamptz,uuid,timestamptz,uuid,integer,boolean,integer)
  TO service_role,postgres,supabase_admin;

COMMIT;
