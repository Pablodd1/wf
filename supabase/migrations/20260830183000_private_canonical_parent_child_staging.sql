-- ============================================================================
-- Migration: 20260830183000_private_canonical_parent_child_staging.sql
-- Description: Forward-only private canonical foundation for parent-child listings,
--              multi-offer segmentation, image lineage, and state-idempotent upserts.
-- ============================================================================

BEGIN;

-- 1. Create Private Canonical Parents Table
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalized_parents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL DEFAULT 'OceanDigital MariaDB',
  source_database TEXT NOT NULL DEFAULT 'thecollective_inventory',
  source_table TEXT NOT NULL DEFAULT 'auctions',
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_created_on TEXT,
  source_observed_at TIMESTAMPTZ NOT NULL,
  posted_at TIMESTAMPTZ,
  raw_message_original TEXT NOT NULL,
  listing_text_source TEXT,
  listing_text_sha256 TEXT,
  raw_payload JSONB NOT NULL,
  is_bundle BOOLEAN NOT NULL DEFAULT FALSE,
  child_count INT NOT NULL DEFAULT 1,
  bundle_structure_type TEXT NOT NULL DEFAULT 'SINGLE', -- 'SINGLE', 'MULTI_OFFER_BUNDLE', 'MULTI_ITEM_CANONICAL'
  seller_name TEXT,
  seller_contact TEXT,
  contact_publication_approved BOOLEAN NOT NULL DEFAULT FALSE,
  seller_activity_count INT,
  seller_rating NUMERIC,
  seller_rating_status TEXT NOT NULL DEFAULT 'UNRATED_SELLER',
  seller_review_evidence TEXT,
  location TEXT,
  parser_version TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  review_flags TEXT[] NOT NULL DEFAULT '{}',
  normalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index for composite provenance on parents
CREATE UNIQUE INDEX IF NOT EXISTS uq_mariadb_norm_parents_provenance
  ON wf_canonical_staging.mariadb_normalized_parents (
    source_system,
    source_database,
    source_table,
    source_id,
    source_hash
  );

CREATE INDEX IF NOT EXISTS idx_mariadb_norm_parents_keyset
  ON wf_canonical_staging.mariadb_normalized_parents (
    source_created_on ASC,
    source_id ASC
  );

-- 2. Create Private Canonical Children Table
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalized_children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES wf_canonical_staging.mariadb_normalized_parents(id) ON DELETE CASCADE,
  parent_source_id TEXT NOT NULL,
  parent_source_hash TEXT NOT NULL,
  child_ordinal INT NOT NULL DEFAULT 0,
  child_unique_key TEXT NOT NULL,
  child_proposal_hash TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  reference TEXT,
  dial_color TEXT,
  year INT,
  condition TEXT,
  intent TEXT, -- 'WTS', 'WTB', or NULL
  original_price_amount NUMERIC,
  original_price_currency TEXT,
  currency_evidence TEXT,
  price_usd NUMERIC,
  fx_rate NUMERIC,
  fx_source TEXT,
  fx_date TEXT,
  currency_status TEXT NOT NULL,
  is_outlier BOOLEAN NOT NULL DEFAULT FALSE,
  outlier_reason TEXT,
  primary_image_key TEXT,
  primary_image_url TEXT,
  primary_image_evidence_type TEXT NOT NULL DEFAULT 'NO_IMAGE',
  trading_floor_status TEXT NOT NULL DEFAULT 'HELD_UNKNOWN',
  trading_floor_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  price_research_status TEXT NOT NULL DEFAULT 'INELIGIBLE_OTHER',
  price_research_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  reconciliation_category TEXT NOT NULL, -- 'NORMALIZED_PROPOSAL', 'REVIEW_REQUIRED'
  review_flags TEXT[] NOT NULL DEFAULT '{}',
  exclusion_reasons TEXT[] NOT NULL DEFAULT '{}',
  parser_version TEXT NOT NULL,
  normalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index for parent-child ordinal identity
CREATE UNIQUE INDEX IF NOT EXISTS uq_mariadb_norm_children_identity
  ON wf_canonical_staging.mariadb_normalized_children (
    parent_source_id,
    parent_source_hash,
    child_ordinal
  );

CREATE INDEX IF NOT EXISTS idx_mariadb_norm_children_trading_floor
  ON wf_canonical_staging.mariadb_normalized_children (trading_floor_eligible, trading_floor_status);

CREATE INDEX IF NOT EXISTS idx_mariadb_norm_children_price_research
  ON wf_canonical_staging.mariadb_normalized_children (price_research_eligible, price_research_status);

CREATE INDEX IF NOT EXISTS idx_mariadb_norm_children_brand_ref
  ON wf_canonical_staging.mariadb_normalized_children (brand, reference);

-- 3. Create Private Canonical Images Table
CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalized_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES wf_canonical_staging.mariadb_normalized_parents(id) ON DELETE CASCADE,
  child_id UUID REFERENCES wf_canonical_staging.mariadb_normalized_children(id) ON DELETE CASCADE,
  image_ordinal INT NOT NULL DEFAULT 0,
  image_key TEXT NOT NULL,
  image_url TEXT,
  image_evidence_type TEXT NOT NULL, -- 'SOURCE_LISTING_IMAGE', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED', 'NO_IMAGE'
  reachability_status TEXT NOT NULL DEFAULT 'UNCHECKED', -- 'UNCHECKED', 'REACHABLE', 'UNREACHABLE'
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mariadb_norm_images_key
  ON wf_canonical_staging.mariadb_normalized_images (
    parent_id,
    image_ordinal,
    image_key
  );

-- 4. Batch Upsert RPC for Canonical Parents and Children
CREATE OR REPLACE FUNCTION public.upsert_mariadb_canonical_batch(
  p_parents JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  elem JSONB;
  child_elem JSONB;
  img_elem JSONB;
  v_parent_id UUID;
  v_child_id UUID;
  v_existing_parent_hash TEXT;
  v_existing_child_hash TEXT;
  
  v_inserted_parents INT := 0;
  v_updated_parents INT := 0;
  v_unchanged_parents INT := 0;

  v_inserted_children INT := 0;
  v_updated_children INT := 0;
  v_unchanged_children INT := 0;

  v_source_system TEXT;
  v_source_database TEXT;
  v_source_table TEXT;
  v_source_id TEXT;
  v_source_hash TEXT;
  v_parent_hash TEXT;
BEGIN
  FOR elem IN SELECT * FROM jsonb_array_elements(p_parents)
  LOOP
    v_source_system := (elem->>'source_system')::TEXT;
    v_source_database := (elem->>'source_database')::TEXT;
    v_source_table := (elem->>'source_table')::TEXT;
    v_source_id := (elem->>'source_id')::TEXT;
    v_source_hash := (elem->>'source_hash')::TEXT;
    v_parent_hash := (elem->>'parent_hash')::TEXT;

    -- Lookup parent by 5-field composite provenance
    SELECT id, parent_hash INTO v_parent_id, v_existing_parent_hash
    FROM wf_canonical_staging.mariadb_normalized_parents
    WHERE source_system = v_source_system
      AND source_database = v_source_database
      AND source_table = v_source_table
      AND source_id = v_source_id
      AND source_hash = v_source_hash;

    IF NOT FOUND THEN
      INSERT INTO wf_canonical_staging.mariadb_normalized_parents (
        source_system, source_database, source_table, source_id, source_hash,
        source_record_id, source_created_on, source_observed_at, posted_at,
        raw_message_original, listing_text_source, listing_text_sha256,
        raw_payload, is_bundle, child_count, bundle_structure_type,
        seller_name, seller_contact, contact_publication_approved,
        seller_activity_count, seller_rating, seller_rating_status, seller_review_evidence,
        location, parser_version, parent_hash, review_flags, normalized_at
      ) VALUES (
        v_source_system,
        v_source_database,
        v_source_table,
        v_source_id,
        v_source_hash,
        (elem->>'source_record_id')::TEXT,
        (elem->>'source_created_on')::TEXT,
        (elem->>'source_observed_at')::TIMESTAMPTZ,
        (elem->>'posted_at')::TIMESTAMPTZ,
        (elem->>'raw_message_original')::TEXT,
        (elem->>'listing_text_source')::TEXT,
        (elem->>'listing_text_sha256')::TEXT,
        (elem->'raw_payload')::JSONB,
        COALESCE((elem->>'is_bundle')::BOOLEAN, FALSE),
        COALESCE((elem->>'child_count')::INT, 1),
        COALESCE((elem->>'bundle_structure_type')::TEXT, 'SINGLE'),
        (elem->>'seller_name')::TEXT,
        (elem->>'seller_contact')::TEXT,
        COALESCE((elem->>'contact_publication_approved')::BOOLEAN, FALSE),
        (elem->>'seller_activity_count')::INT,
        (elem->>'seller_rating')::NUMERIC,
        COALESCE((elem->>'seller_rating_status')::TEXT, 'UNRATED_SELLER'),
        (elem->>'seller_review_evidence')::TEXT,
        (elem->>'location')::TEXT,
        (elem->>'parser_version')::TEXT,
        v_parent_hash,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'review_flags')), '{}'::TEXT[]),
        NOW()
      )
      RETURNING id INTO v_parent_id;
      v_inserted_parents := v_inserted_parents + 1;

    ELSIF v_existing_parent_hash IS DISTINCT FROM v_parent_hash THEN
      UPDATE wf_canonical_staging.mariadb_normalized_parents SET
        source_record_id = (elem->>'source_record_id')::TEXT,
        source_created_on = (elem->>'source_created_on')::TEXT,
        source_observed_at = (elem->>'source_observed_at')::TIMESTAMPTZ,
        posted_at = (elem->>'posted_at')::TIMESTAMPTZ,
        raw_message_original = (elem->>'raw_message_original')::TEXT,
        listing_text_source = (elem->>'listing_text_source')::TEXT,
        listing_text_sha256 = (elem->>'listing_text_sha256')::TEXT,
        raw_payload = (elem->'raw_payload')::JSONB,
        is_bundle = COALESCE((elem->>'is_bundle')::BOOLEAN, FALSE),
        child_count = COALESCE((elem->>'child_count')::INT, 1),
        bundle_structure_type = COALESCE((elem->>'bundle_structure_type')::TEXT, 'SINGLE'),
        seller_name = (elem->>'seller_name')::TEXT,
        seller_contact = (elem->>'seller_contact')::TEXT,
        contact_publication_approved = COALESCE((elem->>'contact_publication_approved')::BOOLEAN, FALSE),
        seller_activity_count = (elem->>'seller_activity_count')::INT,
        seller_rating = (elem->>'seller_rating')::NUMERIC,
        seller_rating_status = COALESCE((elem->>'seller_rating_status')::TEXT, 'UNRATED_SELLER'),
        seller_review_evidence = (elem->>'seller_review_evidence')::TEXT,
        location = (elem->>'location')::TEXT,
        parser_version = (elem->>'parser_version')::TEXT,
        parent_hash = v_parent_hash,
        review_flags = COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'review_flags')), '{}'::TEXT[]),
        normalized_at = NOW()
      WHERE id = v_parent_id;
      v_updated_parents := v_updated_parents + 1;
    ELSE
      v_unchanged_parents := v_unchanged_parents + 1;
    END IF;

    -- Upsert Children
    IF elem->'children' IS NOT NULL AND jsonb_array_length(elem->'children') > 0 THEN
      FOR child_elem IN SELECT * FROM jsonb_array_elements(elem->'children')
      LOOP
        SELECT id, child_proposal_hash INTO v_child_id, v_existing_child_hash
        FROM wf_canonical_staging.mariadb_normalized_children
        WHERE parent_source_id = v_source_id
          AND parent_source_hash = v_source_hash
          AND child_ordinal = (child_elem->>'child_ordinal')::INT;

        IF NOT FOUND THEN
          INSERT INTO wf_canonical_staging.mariadb_normalized_children (
            parent_id, parent_source_id, parent_source_hash,
            child_ordinal, child_unique_key, child_proposal_hash,
            brand, model, reference, dial_color, year, condition, intent,
            original_price_amount, original_price_currency, currency_evidence,
            price_usd, fx_rate, fx_source, fx_date, currency_status,
            is_outlier, outlier_reason,
            primary_image_key, primary_image_url, primary_image_evidence_type,
            trading_floor_status, trading_floor_eligible,
            price_research_status, price_research_eligible,
            reconciliation_category, review_flags, exclusion_reasons,
            parser_version, normalized_at
          ) VALUES (
            v_parent_id,
            v_source_id,
            v_source_hash,
            (child_elem->>'child_ordinal')::INT,
            (child_elem->>'child_unique_key')::TEXT,
            (child_elem->>'child_proposal_hash')::TEXT,
            (child_elem->>'brand')::TEXT,
            (child_elem->>'model')::TEXT,
            (child_elem->>'reference')::TEXT,
            (child_elem->>'dial_color')::TEXT,
            (child_elem->>'year')::INT,
            (child_elem->>'condition')::TEXT,
            (child_elem->>'intent')::TEXT,
            (child_elem->>'original_price_amount')::NUMERIC,
            (child_elem->>'original_price_currency')::TEXT,
            (child_elem->>'currency_evidence')::TEXT,
            (child_elem->>'price_usd')::NUMERIC,
            (child_elem->>'fx_rate')::NUMERIC,
            (child_elem->>'fx_source')::TEXT,
            (child_elem->>'fx_date')::TEXT,
            (child_elem->>'currency_status')::TEXT,
            COALESCE((child_elem->>'is_outlier')::BOOLEAN, FALSE),
            (child_elem->>'outlier_reason')::TEXT,
            (child_elem->>'primary_image_key')::TEXT,
            (child_elem->>'primary_image_url')::TEXT,
            COALESCE((child_elem->>'primary_image_evidence_type')::TEXT, 'NO_IMAGE'),
            COALESCE((child_elem->>'trading_floor_status')::TEXT, 'HELD_UNKNOWN'),
            COALESCE((child_elem->>'trading_floor_eligible')::BOOLEAN, FALSE),
            COALESCE((child_elem->>'price_research_status')::TEXT, 'INELIGIBLE_OTHER'),
            COALESCE((child_elem->>'price_research_eligible')::BOOLEAN, FALSE),
            (child_elem->>'reconciliation_category')::TEXT,
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(child_elem->'review_flags')), '{}'::TEXT[]),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(child_elem->'exclusion_reasons')), '{}'::TEXT[]),
            (child_elem->>'parser_version')::TEXT,
            NOW()
          )
          RETURNING id INTO v_child_id;
          v_inserted_children := v_inserted_children + 1;

        ELSIF v_existing_child_hash IS DISTINCT FROM (child_elem->>'child_proposal_hash')::TEXT THEN
          UPDATE wf_canonical_staging.mariadb_normalized_children SET
            parent_id = v_parent_id,
            child_unique_key = (child_elem->>'child_unique_key')::TEXT,
            child_proposal_hash = (child_elem->>'child_proposal_hash')::TEXT,
            brand = (child_elem->>'brand')::TEXT,
            model = (child_elem->>'model')::TEXT,
            reference = (child_elem->>'reference')::TEXT,
            dial_color = (child_elem->>'dial_color')::TEXT,
            year = (child_elem->>'year')::INT,
            condition = (child_elem->>'condition')::TEXT,
            intent = (child_elem->>'intent')::TEXT,
            original_price_amount = (child_elem->>'original_price_amount')::NUMERIC,
            original_price_currency = (child_elem->>'original_price_currency')::TEXT,
            currency_evidence = (child_elem->>'currency_evidence')::TEXT,
            price_usd = (child_elem->>'price_usd')::NUMERIC,
            fx_rate = (child_elem->>'fx_rate')::NUMERIC,
            fx_source = (child_elem->>'fx_source')::TEXT,
            fx_date = (child_elem->>'fx_date')::TEXT,
            currency_status = (child_elem->>'currency_status')::TEXT,
            is_outlier = COALESCE((child_elem->>'is_outlier')::BOOLEAN, FALSE),
            outlier_reason = (child_elem->>'outlier_reason')::TEXT,
            primary_image_key = (child_elem->>'primary_image_key')::TEXT,
            primary_image_url = (child_elem->>'primary_image_url')::TEXT,
            primary_image_evidence_type = COALESCE((child_elem->>'primary_image_evidence_type')::TEXT, 'NO_IMAGE'),
            trading_floor_status = COALESCE((child_elem->>'trading_floor_status')::TEXT, 'HELD_UNKNOWN'),
            trading_floor_eligible = COALESCE((child_elem->>'trading_floor_eligible')::BOOLEAN, FALSE),
            price_research_status = COALESCE((child_elem->>'price_research_status')::TEXT, 'INELIGIBLE_OTHER'),
            price_research_eligible = COALESCE((child_elem->>'price_research_eligible')::BOOLEAN, FALSE),
            reconciliation_category = (child_elem->>'reconciliation_category')::TEXT,
            review_flags = COALESCE(ARRAY(SELECT jsonb_array_elements_text(child_elem->'review_flags')), '{}'::TEXT[]),
            exclusion_reasons = COALESCE(ARRAY(SELECT jsonb_array_elements_text(child_elem->'exclusion_reasons')), '{}'::TEXT[]),
            parser_version = (child_elem->>'parser_version')::TEXT,
            normalized_at = NOW()
          WHERE id = v_child_id;
          v_updated_children := v_updated_children + 1;
        ELSE
          v_unchanged_children := v_unchanged_children + 1;
        END IF;

        -- Upsert Images
        IF child_elem->'images' IS NOT NULL AND jsonb_array_length(child_elem->'images') > 0 THEN
          FOR img_elem IN SELECT * FROM jsonb_array_elements(child_elem->'images')
          LOOP
            INSERT INTO wf_canonical_staging.mariadb_normalized_images (
              parent_id, child_id, image_ordinal, image_key, image_url, image_evidence_type
            ) VALUES (
              v_parent_id,
              v_child_id,
              (img_elem->>'image_ordinal')::INT,
              (img_elem->>'image_key')::TEXT,
              (img_elem->>'image_url')::TEXT,
              (img_elem->>'image_evidence_type')::TEXT
            )
            ON CONFLICT (parent_id, image_ordinal, image_key) DO UPDATE SET
              child_id = EXCLUDED.child_id,
              image_url = EXCLUDED.image_url,
              image_evidence_type = EXCLUDED.image_evidence_type;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_parents', v_inserted_parents,
    'updated_parents', v_updated_parents,
    'unchanged_parents', v_unchanged_parents,
    'total_parents', v_inserted_parents + v_updated_parents + v_unchanged_parents,
    'inserted_children', v_inserted_children,
    'updated_children', v_updated_children,
    'unchanged_children', v_unchanged_children,
    'total_children', v_inserted_children + v_updated_children + v_unchanged_children
  );
END;
$$;

-- 5. Detail RPC for Parent-Child Canonical Listing
CREATE OR REPLACE FUNCTION public.get_mariadb_canonical_child_detail(
  p_source_id TEXT,
  p_source_system TEXT,
  p_source_database TEXT,
  p_source_table TEXT,
  p_source_hash TEXT,
  p_child_ordinal INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF p_source_id IS NULL OR p_source_system IS NULL OR p_source_database IS NULL OR p_source_table IS NULL OR p_source_hash IS NULL THEN
    RAISE EXCEPTION 'All 5 provenance fields are mandatory: source_system, source_database, source_table, source_id, source_hash';
  END IF;

  SELECT jsonb_build_object(
    'parent', to_jsonb(p),
    'child', to_jsonb(c),
    'images', COALESCE(
      (SELECT jsonb_agg(to_jsonb(img)) FROM wf_canonical_staging.mariadb_normalized_images img WHERE img.parent_id = p.id),
      '[]'::jsonb
    ),
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
      'source_system', p.source_system,
      'source_database', p.source_database,
      'source_table', p.source_table,
      'source_id', p.source_id,
      'source_hash', p.source_hash,
      'child_ordinal', c.child_ordinal,
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
      'inquiry_text', 'Hi ' || COALESCE(p.seller_name, r.raw_payload->>'from_name', 'Seller') || ', I am inquiring about your listing for ' || COALESCE(c.brand, 'Watch') || COALESCE(' ' || c.model, '') || COALESCE(' (Ref: ' || c.reference || ')', '') || ' listed on WatchFlow. Is this piece still available?',
      'whatsapp_url', CASE 
        WHEN COALESCE(p.seller_contact, r.raw_payload->>'from_number') IS NOT NULL AND length(regexp_replace(COALESCE(p.seller_contact, r.raw_payload->>'from_number'), '\D', '', 'g')) >= 7
        THEN 'https://wa.me/' || regexp_replace(COALESCE(p.seller_contact, r.raw_payload->>'from_number'), '\D', '', 'g') || '?text=' || replace(replace(replace(replace('Hi ' || COALESCE(p.seller_name, r.raw_payload->>'from_name', 'Seller') || ', I am inquiring about your listing for ' || COALESCE(c.brand, 'Watch') || COALESCE(' ' || c.model, '') || COALESCE(' (Ref: ' || c.reference || ')', '') || ' listed on WatchFlow. Is this piece still available?', ' ', '%20'), '(', '%28'), ')', '%29'), '?', '%3F')
        ELSE NULL
      END,
      'inquiry_ready', (COALESCE(p.seller_contact, r.raw_payload->>'from_number') IS NOT NULL AND length(regexp_replace(COALESCE(p.seller_contact, r.raw_payload->>'from_number'), '\D', '', 'g')) >= 7)
    )
  ) INTO v_res
  FROM wf_canonical_staging.mariadb_normalized_parents p
  JOIN wf_canonical_staging.mariadb_normalized_children c
    ON p.source_id = c.parent_source_id
   AND p.source_hash = c.parent_source_hash
   AND c.child_ordinal = p_child_ordinal
  JOIN wf_canonical_staging.mariadb_raw_source_rows r 
    ON p.source_system = r.source_system
   AND p.source_database = r.source_database
   AND p.source_table = r.source_table
   AND p.source_id = r.source_id
   AND p.source_hash = r.source_hash
  WHERE p.source_system = p_source_system
    AND p.source_database = p_source_database
    AND p.source_table = p_source_table
    AND p.source_id = p_source_id
    AND p.source_hash = p_source_hash;

  IF v_res IS NULL THEN
    RAISE EXCEPTION 'No matching canonical parent/child and raw source found for composite provenance: %:%:%:%:% (ordinal: %)',
      p_source_system, p_source_database, p_source_table, p_source_id, p_source_hash, p_child_ordinal;
  END IF;

  RETURN v_res;
END;
$$;

-- 6. Permissions & Private Security Model
REVOKE ALL ON FUNCTION public.upsert_mariadb_canonical_batch(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mariadb_canonical_batch(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.get_mariadb_canonical_child_detail(TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mariadb_canonical_child_detail(TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;

REVOKE ALL ON SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
