-- ============================================================================
-- Migration: 20260830170000_private_mariadb_state_idempotent_normalization.sql
-- Description: Proposal hashing, true state idempotency, raw evidence join, and authorized inquiry contract
-- ============================================================================

BEGIN;

-- 1. Add proposal_hash column to mariadb_normalized_proposals
ALTER TABLE wf_canonical_staging.mariadb_normalized_proposals 
  ADD COLUMN IF NOT EXISTS proposal_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_mariadb_norm_proposal_hash 
  ON wf_canonical_staging.mariadb_normalized_proposals (proposal_hash);

-- 2. State Idempotent Upsert RPC with Inserted / Updated / Unchanged Accounting
CREATE OR REPLACE FUNCTION public.upsert_mariadb_normalized_proposals_batch(
  p_proposals JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  elem JSONB;
  v_inserted INT := 0;
  v_updated INT := 0;
  v_unchanged INT := 0;
  v_existing_hash TEXT;
  v_incoming_hash TEXT;
  v_source_id TEXT;
BEGIN
  FOR elem IN SELECT * FROM jsonb_array_elements(p_proposals)
  LOOP
    v_source_id := (elem->>'source_id')::TEXT;
    v_incoming_hash := (elem->>'proposal_hash')::TEXT;
    
    SELECT proposal_hash INTO v_existing_hash
    FROM wf_canonical_staging.mariadb_normalized_proposals
    WHERE source_id = v_source_id;

    IF NOT FOUND THEN
      INSERT INTO wf_canonical_staging.mariadb_normalized_proposals (
        source_id, source_hash, source_system, source_database, source_table,
        source_record_id, source_observed_at, posted_at, listing_text_source, listing_text_sha256,
        brand, model, reference, dial_color, year, condition, intent,
        original_price_amount, original_price_currency, currency_evidence,
        price_usd, fx_rate, fx_source, fx_date, currency_status,
        seller_name, seller_contact, contact_publication_approved,
        seller_activity_count, seller_rating, seller_rating_status, seller_review_evidence,
        raw_message, location, image_key, image_url, image_evidence_type,
        bundle_parent_id, bundle_child_lineage, is_bundle,
        trading_floor_status, trading_floor_eligible,
        price_research_status, price_research_eligible,
        review_flags, exclusion_reasons, parser_version, proposal_hash, normalized_at
      ) VALUES (
        (elem->>'source_id')::TEXT,
        (elem->>'source_hash')::TEXT,
        (elem->>'source_system')::TEXT,
        (elem->>'source_database')::TEXT,
        (elem->>'source_table')::TEXT,
        (elem->>'source_record_id')::TEXT,
        (elem->>'source_observed_at')::TIMESTAMPTZ,
        (elem->>'posted_at')::TIMESTAMPTZ,
        (elem->>'listing_text_source')::TEXT,
        (elem->>'listing_text_sha256')::TEXT,
        (elem->>'brand')::TEXT,
        (elem->>'model')::TEXT,
        (elem->>'reference')::TEXT,
        (elem->>'dial_color')::TEXT,
        (elem->>'year')::INT,
        (elem->>'condition')::TEXT,
        (elem->>'intent')::TEXT,
        (elem->>'original_price_amount')::NUMERIC,
        (elem->>'original_price_currency')::TEXT,
        (elem->>'currency_evidence')::TEXT,
        (elem->>'price_usd')::NUMERIC,
        (elem->>'fx_rate')::NUMERIC,
        (elem->>'fx_source')::TEXT,
        (elem->>'fx_date')::TEXT,
        (elem->>'currency_status')::TEXT,
        (elem->>'seller_name')::TEXT,
        (elem->>'seller_contact')::TEXT,
        COALESCE((elem->>'contact_publication_approved')::BOOLEAN, FALSE),
        (elem->>'seller_activity_count')::INT,
        (elem->>'seller_rating')::NUMERIC,
        COALESCE((elem->>'seller_rating_status')::TEXT, 'UNRATED_SELLER'),
        (elem->>'seller_review_evidence')::TEXT,
        (elem->>'raw_message')::TEXT,
        (elem->>'location')::TEXT,
        (elem->>'image_key')::TEXT,
        (elem->>'image_url')::TEXT,
        (elem->>'image_evidence_type')::TEXT,
        (elem->>'bundle_parent_id')::TEXT,
        (elem->'bundle_child_lineage')::JSONB,
        COALESCE((elem->>'is_bundle')::BOOLEAN, FALSE),
        COALESCE((elem->>'trading_floor_status')::TEXT, 'HELD_UNKNOWN'),
        COALESCE((elem->>'trading_floor_eligible')::BOOLEAN, FALSE),
        COALESCE((elem->>'price_research_status')::TEXT, 'INELIGIBLE_OTHER'),
        COALESCE((elem->>'price_research_eligible')::BOOLEAN, FALSE),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'review_flags')), '{}'::TEXT[]),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'exclusion_reasons')), '{}'::TEXT[]),
        (elem->>'parser_version')::TEXT,
        v_incoming_hash,
        NOW()
      );
      v_inserted := v_inserted + 1;
    ELSIF v_existing_hash IS DISTINCT FROM v_incoming_hash THEN
      UPDATE wf_canonical_staging.mariadb_normalized_proposals SET
        source_hash = (elem->>'source_hash')::TEXT,
        listing_text_source = (elem->>'listing_text_source')::TEXT,
        listing_text_sha256 = (elem->>'listing_text_sha256')::TEXT,
        brand = (elem->>'brand')::TEXT,
        model = (elem->>'model')::TEXT,
        reference = (elem->>'reference')::TEXT,
        dial_color = (elem->>'dial_color')::TEXT,
        year = (elem->>'year')::INT,
        condition = (elem->>'condition')::TEXT,
        intent = (elem->>'intent')::TEXT,
        original_price_amount = (elem->>'original_price_amount')::NUMERIC,
        original_price_currency = (elem->>'original_price_currency')::TEXT,
        currency_evidence = (elem->>'currency_evidence')::TEXT,
        price_usd = (elem->>'price_usd')::NUMERIC,
        fx_rate = (elem->>'fx_rate')::NUMERIC,
        fx_source = (elem->>'fx_source')::TEXT,
        fx_date = (elem->>'fx_date')::TEXT,
        currency_status = (elem->>'currency_status')::TEXT,
        seller_name = (elem->>'seller_name')::TEXT,
        seller_contact = (elem->>'seller_contact')::TEXT,
        contact_publication_approved = COALESCE((elem->>'contact_publication_approved')::BOOLEAN, FALSE),
        seller_activity_count = (elem->>'seller_activity_count')::INT,
        seller_rating = (elem->>'seller_rating')::NUMERIC,
        seller_rating_status = COALESCE((elem->>'seller_rating_status')::TEXT, 'UNRATED_SELLER'),
        seller_review_evidence = (elem->>'seller_review_evidence')::TEXT,
        raw_message = (elem->>'raw_message')::TEXT,
        location = (elem->>'location')::TEXT,
        image_key = (elem->>'image_key')::TEXT,
        image_url = (elem->>'image_url')::TEXT,
        image_evidence_type = (elem->>'image_evidence_type')::TEXT,
        bundle_parent_id = (elem->>'bundle_parent_id')::TEXT,
        bundle_child_lineage = (elem->'bundle_child_lineage')::JSONB,
        is_bundle = COALESCE((elem->>'is_bundle')::BOOLEAN, FALSE),
        trading_floor_status = COALESCE((elem->>'trading_floor_status')::TEXT, 'HELD_UNKNOWN'),
        trading_floor_eligible = COALESCE((elem->>'trading_floor_eligible')::BOOLEAN, FALSE),
        price_research_status = COALESCE((elem->>'price_research_status')::TEXT, 'INELIGIBLE_OTHER'),
        price_research_eligible = COALESCE((elem->>'price_research_eligible')::BOOLEAN, FALSE),
        review_flags = COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'review_flags')), '{}'::TEXT[]),
        exclusion_reasons = COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'exclusion_reasons')), '{}'::TEXT[]),
        parser_version = (elem->>'parser_version')::TEXT,
        proposal_hash = v_incoming_hash,
        normalized_at = NOW()
      WHERE source_id = v_source_id;
      v_updated := v_updated + 1;
    ELSE
      -- Truly identical: zero column touch, normalized_at preserved unchanged
      v_unchanged := v_unchanged + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'total', v_inserted + v_updated + v_unchanged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_mariadb_normalized_proposals_batch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mariadb_normalized_proposals_batch TO service_role;

-- 3. Detail Function with Raw Evidence Join & Authorized Inquiry Contract
CREATE OR REPLACE FUNCTION public.get_mariadb_normalized_proposal_detail(
  p_source_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_res JSONB;
BEGIN
  SELECT jsonb_build_object(
    'proposal', to_jsonb(p),
    'raw_source', jsonb_build_object(
      'source_id', r.source_id,
      'source_system', r.source_system,
      'source_database', r.source_database,
      'source_table', r.source_table,
      'source_record_id', r.source_record_id,
      'source_created_on', r.source_created_on,
      'source_hash', r.source_hash,
      'raw_message', r.raw_message,
      'raw_payload', r.raw_payload,
      'captured_at', r.captured_at
    ),
    'authorized_inquiry', jsonb_build_object(
      'source_id', p.source_id,
      'seller_name', COALESCE(p.seller_name, r.raw_payload->>'from_name', 'Seller'),
      'seller_contact_masked', CASE 
        WHEN COALESCE(p.seller_contact, r.raw_payload->>'from_number') IS NOT NULL AND length(regexp_replace(COALESCE(p.seller_contact, r.raw_payload->>'from_number'), '\D', '', 'g')) > 4 
        THEN '+*** *** ' || right(regexp_replace(COALESCE(p.seller_contact, r.raw_payload->>'from_number'), '\D', '', 'g'), 4)
        WHEN COALESCE(p.seller_contact, r.raw_payload->>'from_number') IS NOT NULL 
        THEN '[PRIVATE_SELLER_CONTACT]'
        ELSE NULL
      END,
      'seller_contact_raw', COALESCE(p.seller_contact, r.raw_payload->>'from_number'),
      'contact_publication_approved', p.contact_publication_approved,
      'inquiry_text', 'Hi ' || COALESCE(p.seller_name, r.raw_payload->>'from_name', 'Seller') || ', I am inquiring about your listing for ' || COALESCE(p.brand, 'Watch') || COALESCE(' ' || p.model, '') || COALESCE(' (Ref: ' || p.reference || ')', '') || ' listed on WatchFlow. Is this piece still available?',
      'whatsapp_url', CASE 
        WHEN COALESCE(p.seller_contact, r.raw_payload->>'from_number') IS NOT NULL 
        THEN 'https://wa.me/' || regexp_replace(COALESCE(p.seller_contact, r.raw_payload->>'from_number'), '^\+', '')
        ELSE NULL
      END,
      'inquiry_ready', (COALESCE(p.seller_contact, r.raw_payload->>'from_number') IS NOT NULL AND length(COALESCE(p.seller_contact, r.raw_payload->>'from_number')) >= 7)
    )
  ) INTO v_res
  FROM wf_canonical_staging.mariadb_normalized_proposals p
  LEFT JOIN wf_canonical_staging.mariadb_raw_source_rows r ON p.source_id = r.source_id
  WHERE p.source_id = p_source_id;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mariadb_normalized_proposal_detail FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_normalized_proposal_detail TO service_role;

-- 4. Staged Auctions Keyset Batch Fetch Procedure
CREATE OR REPLACE FUNCTION public.get_mariadb_private_staged_auctions_batch(
  p_limit INT DEFAULT 1000,
  p_last_created_on TEXT DEFAULT NULL,
  p_last_source_id TEXT DEFAULT NULL,
  p_max_created_on TEXT DEFAULT '2026-04-28T15:50:43.000Z',
  p_max_source_id TEXT DEFAULT '3cddaf9f-9f36-4633-a08e-59a6dfdca057',
  p_source_system TEXT DEFAULT 'OceanDigital MariaDB',
  p_source_database TEXT DEFAULT 'thecollective_inventory',
  p_source_table TEXT DEFAULT 'auctions'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF p_last_created_on IS NULL OR p_last_source_id IS NULL THEN
    SELECT jsonb_agg(sub) INTO v_res FROM (
      SELECT 
        r.id, r.source_system, r.source_database, r.source_table, r.source_id,
        r.source_record_id, r.source_created_on, r.source_hash, r.raw_message,
        r.raw_payload, r.captured_at
      FROM wf_canonical_staging.mariadb_raw_source_rows r
      WHERE r.source_system = p_source_system
        AND r.source_database = p_source_database
        AND r.source_table = p_source_table
        AND (
          r.source_created_on < p_max_created_on 
          OR (r.source_created_on = p_max_created_on AND r.source_id <= p_max_source_id)
        )
      ORDER BY r.source_created_on ASC, r.source_id ASC
      LIMIT p_limit
    ) sub;
  ELSE
    SELECT jsonb_agg(sub) INTO v_res FROM (
      SELECT 
        r.id, r.source_system, r.source_database, r.source_table, r.source_id,
        r.source_record_id, r.source_created_on, r.source_hash, r.raw_message,
        r.raw_payload, r.captured_at
      FROM wf_canonical_staging.mariadb_raw_source_rows r
      WHERE r.source_system = p_source_system
        AND r.source_database = p_source_database
        AND r.source_table = p_source_table
        AND (
          r.source_created_on > p_last_created_on 
          OR (r.source_created_on = p_last_created_on AND r.source_id > p_last_source_id)
        )
        AND (
          r.source_created_on < p_max_created_on 
          OR (r.source_created_on = p_max_created_on AND r.source_id <= p_max_source_id)
        )
      ORDER BY r.source_created_on ASC, r.source_id ASC
      LIMIT p_limit
    ) sub;
  END IF;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_mariadb_private_staged_auctions_batch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_private_staged_auctions_batch TO service_role;

-- 5. Update checkpoint accounting RPC
REVOKE ALL ON FUNCTION public.update_mariadb_normalization_checkpoint FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_mariadb_normalization_checkpoint TO service_role;

-- 6. RPC-Only Private Security Model
REVOKE ALL ON SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
