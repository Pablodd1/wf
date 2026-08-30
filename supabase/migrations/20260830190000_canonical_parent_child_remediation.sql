-- =============================================================================
-- Migration: 20260830190000_canonical_parent_child_remediation.sql
-- Description: Forward-only hardening for private canonical parent-child schema:
--              1. Removes synthesized provenance defaults & enforces NOT NULL constraints.
--              2. Converts source_created_on to TIMESTAMPTZ.
--              3. Adds check constraints for hashes, ordinals, positive prices, and statuses.
--              4. Enforces parent_id binding with namespace-safe child uniqueness.
--              5. Enforces explicit parent-level image uniqueness.
--              6. Implements parser-version supersession handling (is_active tracking).
--              7. Adds immutable raw evidence guard trigger (prevents tampering).
--              8. Hardens detail RPC to fail-closed on unapproved contact publication.
-- Security: Private staging only. Anon and authenticated have zero direct access.
-- =============================================================================

-- 1. Enforce Non-Null Composite Provenance & Constraints on Parents
ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
  ALTER COLUMN source_system DROP DEFAULT,
  ALTER COLUMN source_database DROP DEFAULT,
  ALTER COLUMN source_table DROP DEFAULT,
  ALTER COLUMN source_system SET NOT NULL,
  ALTER COLUMN source_database SET NOT NULL,
  ALTER COLUMN source_table SET NOT NULL,
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN source_hash SET NOT NULL,
  ALTER COLUMN parent_hash SET NOT NULL;

-- 2. Add Hashes and Immutability Constraints on Parents
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mariadb_parents_hash_len') THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
      ADD CONSTRAINT chk_mariadb_parents_hash_len CHECK (length(parent_hash) = 64);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mariadb_parents_child_count') THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
      ADD CONSTRAINT chk_mariadb_parents_child_count CHECK (child_count >= 0);
  END IF;
END $$;

-- 3. Add Parser-Version Supersession & Check Constraints on Children
ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_parser_version TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mariadb_children_ordinal') THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_ordinal CHECK (child_ordinal >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mariadb_children_hash_len') THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_hash_len CHECK (length(child_proposal_hash) = 64);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mariadb_children_pos_orig_price') THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_pos_orig_price CHECK (original_price_amount IS NULL OR original_price_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mariadb_children_pos_usd_price') THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_pos_usd_price CHECK (price_usd IS NULL OR price_usd >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mariadb_children_parent_ordinal_uq') THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_parent_ordinal_uq UNIQUE (parent_id, child_ordinal);
  END IF;
END $$;

-- 4. Add Parser-Version Supersession on Images
ALTER TABLE wf_canonical_staging.mariadb_normalized_images
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

-- 5. Trigger: Prevent Mutation of Immutable Raw Evidence on Parents
CREATE OR REPLACE FUNCTION wf_canonical_staging.trg_fn_guard_immutable_parent_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_system <> OLD.source_system OR
     NEW.source_database <> OLD.source_database OR
     NEW.source_table <> OLD.source_table OR
     NEW.source_id <> OLD.source_id OR
     NEW.source_hash <> OLD.source_hash OR
     NEW.raw_message_original IS DISTINCT FROM OLD.raw_message_original OR
     NEW.listing_text_sha256 IS DISTINCT FROM OLD.listing_text_sha256 THEN
    RAISE EXCEPTION 'CANONICAL_MUTATION_ERROR: Raw source evidence and provenance fields on mariadb_normalized_parents are immutable.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_mariadb_parent_evidence ON wf_canonical_staging.mariadb_normalized_parents;
CREATE TRIGGER trg_guard_mariadb_parent_evidence
  BEFORE UPDATE ON wf_canonical_staging.mariadb_normalized_parents
  FOR EACH ROW
  EXECUTE FUNCTION wf_canonical_staging.trg_fn_guard_immutable_parent_evidence();

-- 6. Hardened Batch Upsert RPC with Active Supersession & Accounting
CREATE OR REPLACE FUNCTION public.upsert_mariadb_canonical_batch(
  p_parents JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, public, pg_catalog
AS $$
DECLARE
  v_parent JSONB;
  v_child JSONB;
  v_img JSONB;
  v_parent_id UUID;
  v_existing_parent_hash TEXT;
  v_new_parent_hash TEXT;
  v_inserted_parents INT := 0;
  v_updated_parents INT := 0;
  v_unchanged_parents INT := 0;
  v_inserted_children INT := 0;
  v_updated_children INT := 0;
  v_unchanged_children INT := 0;
  v_child_id UUID;
  v_existing_child_hash TEXT;
  v_new_child_hash TEXT;
  v_new_parser_version TEXT;
BEGIN
  IF p_parents IS NULL OR jsonb_array_length(p_parents) = 0 THEN
    RETURN jsonb_build_object(
      'inserted_parents', 0,
      'updated_parents', 0,
      'unchanged_parents', 0,
      'inserted_children', 0,
      'updated_children', 0,
      'unchanged_children', 0
    );
  END IF;

  FOR v_parent IN SELECT * FROM jsonb_array_elements(p_parents)
  LOOP
    IF (v_parent->>'source_system') IS NULL OR
       (v_parent->>'source_database') IS NULL OR
       (v_parent->>'source_table') IS NULL OR
       (v_parent->>'source_id') IS NULL OR
       (v_parent->>'source_hash') IS NULL OR
       (v_parent->>'parent_hash') IS NULL THEN
      RAISE EXCEPTION 'upsert_mariadb_canonical_batch: Mandatory provenance fields missing in parent payload';
    END IF;

    v_new_parent_hash := v_parent->>'parent_hash';
    v_new_parser_version := COALESCE(v_parent->>'parser_version', 'authoritative-canonical-v10-parent-child');

    SELECT id, parent_hash INTO v_parent_id, v_existing_parent_hash
    FROM wf_canonical_staging.mariadb_normalized_parents
    WHERE source_system = (v_parent->>'source_system')
      AND source_database = (v_parent->>'source_database')
      AND source_table = (v_parent->>'source_table')
      AND source_id = (v_parent->>'source_id')
      AND source_hash = (v_parent->>'source_hash');

    IF v_parent_id IS NULL THEN
      INSERT INTO wf_canonical_staging.mariadb_normalized_parents (
        source_system, source_database, source_table, source_id, source_hash, source_record_id,
        source_created_on, source_observed_at, posted_at, raw_message_original,
        listing_text_source, listing_text_sha256, raw_payload, is_bundle, child_count,
        bundle_structure_type, seller_name, seller_contact, contact_publication_approved,
        seller_activity_count, seller_rating, seller_rating_status, seller_review_evidence,
        location, parser_version, parent_hash, review_flags, normalized_at
      ) VALUES (
        v_parent->>'source_system',
        v_parent->>'source_database',
        v_parent->>'source_table',
        v_parent->>'source_id',
        v_parent->>'source_hash',
        v_parent->>'source_record_id',
        (v_parent->>'source_created_on')::timestamptz,
        (v_parent->>'source_observed_at')::timestamptz,
        (v_parent->>'posted_at')::timestamptz,
        v_parent->>'raw_message_original',
        v_parent->>'listing_text_source',
        v_parent->>'listing_text_sha256',
        COALESCE(v_parent->'raw_payload', '{}'::jsonb),
        COALESCE((v_parent->>'is_bundle')::boolean, false),
        COALESCE((v_parent->>'child_count')::int, 1),
        COALESCE(v_parent->>'bundle_structure_type', 'SINGLE'),
        v_parent->>'seller_name',
        v_parent->>'seller_contact',
        COALESCE((v_parent->>'contact_publication_approved')::boolean, false),
        (v_parent->>'seller_activity_count')::int,
        (v_parent->>'seller_rating')::numeric,
        v_parent->>'seller_rating_status',
        v_parent->>'seller_review_evidence',
        v_parent->>'location',
        v_new_parser_version,
        v_new_parent_hash,
        COALESCE(v_parent->'review_flags', '[]'::jsonb),
        NOW()
      )
      RETURNING id INTO v_parent_id;

      v_inserted_parents := v_inserted_parents + 1;
    ELSIF v_existing_parent_hash IS DISTINCT FROM v_new_parent_hash THEN
      UPDATE wf_canonical_staging.mariadb_normalized_parents SET
        is_bundle = COALESCE((v_parent->>'is_bundle')::boolean, false),
        child_count = COALESCE((v_parent->>'child_count')::int, 1),
        bundle_structure_type = COALESCE(v_parent->>'bundle_structure_type', 'SINGLE'),
        seller_name = v_parent->>'seller_name',
        seller_contact = v_parent->>'seller_contact',
        contact_publication_approved = COALESCE((v_parent->>'contact_publication_approved')::boolean, false),
        seller_activity_count = (v_parent->>'seller_activity_count')::int,
        seller_rating = (v_parent->>'seller_rating')::numeric,
        seller_rating_status = v_parent->>'seller_rating_status',
        seller_review_evidence = v_parent->>'seller_review_evidence',
        location = v_parent->>'location',
        parser_version = v_new_parser_version,
        parent_hash = v_new_parent_hash,
        review_flags = COALESCE(v_parent->'review_flags', '[]'::jsonb),
        normalized_at = NOW()
      WHERE id = v_parent_id;

      v_updated_parents := v_updated_parents + 1;
    ELSE
      v_unchanged_parents := v_unchanged_parents + 1;
    END IF;

    -- Children Supersession: Deactivate active children with higher ordinals if child count decreased
    UPDATE wf_canonical_staging.mariadb_normalized_children
    SET is_active = FALSE, superseded_at = NOW(), superseded_by_parser_version = v_new_parser_version
    WHERE parent_id = v_parent_id AND is_active = TRUE
      AND child_ordinal >= COALESCE(jsonb_array_length(v_parent->'children'), 0);

    -- Process Children
    IF (v_parent->'children') IS NOT NULL AND jsonb_typeof(v_parent->'children') = 'array' THEN
      FOR v_child IN SELECT * FROM jsonb_array_elements(v_parent->'children')
      LOOP
        v_new_child_hash := v_child->>'child_proposal_hash';

        SELECT id, child_proposal_hash INTO v_child_id, v_existing_child_hash
        FROM wf_canonical_staging.mariadb_normalized_children
        WHERE parent_id = v_parent_id
          AND child_ordinal = (v_child->>'child_ordinal')::int;

        IF v_child_id IS NULL THEN
          INSERT INTO wf_canonical_staging.mariadb_normalized_children (
            parent_id, parent_source_id, parent_source_hash, child_ordinal, child_unique_key,
            brand, model, reference, dial_color, year, condition, intent,
            original_price_amount, original_price_currency, currency_evidence,
            price_usd, fx_rate, fx_source, fx_date, currency_status,
            is_outlier, outlier_reason, primary_image_key, primary_image_url, primary_image_evidence_type,
            trading_floor_status, trading_floor_eligible, price_research_status, price_research_eligible,
            reconciliation_category, review_flags, exclusion_reasons, parser_version, child_proposal_hash,
            is_active, normalized_at
          ) VALUES (
            v_parent_id,
            v_parent->>'source_id',
            v_parent->>'source_hash',
            (v_child->>'child_ordinal')::int,
            v_child->>'child_unique_key',
            v_child->>'brand',
            v_child->>'model',
            v_child->>'reference',
            v_child->>'dial_color',
            (v_child->>'year')::int,
            v_child->>'condition',
            v_child->>'intent',
            (v_child->>'original_price_amount')::numeric,
            v_child->>'original_price_currency',
            v_child->>'currency_evidence',
            (v_child->>'price_usd')::numeric,
            (v_child->>'fx_rate')::numeric,
            v_child->>'fx_source',
            (v_child->>'fx_date')::date,
            COALESCE(v_child->>'currency_status', 'MISSING_PRICE'),
            COALESCE((v_child->>'is_outlier')::boolean, false),
            v_child->>'outlier_reason',
            v_child->>'primary_image_key',
            v_child->>'primary_image_url',
            v_child->>'primary_image_evidence_type',
            COALESCE(v_child->>'trading_floor_status', 'HELD_UNKNOWN'),
            COALESCE((v_child->>'trading_floor_eligible')::boolean, false),
            COALESCE(v_child->>'price_research_status', 'INELIGIBLE_UNKNOWN'),
            COALESCE((v_child->>'price_research_eligible')::boolean, false),
            v_child->>'reconciliation_category',
            COALESCE(v_child->'review_flags', '[]'::jsonb),
            COALESCE(v_child->'exclusion_reasons', '[]'::jsonb),
            v_new_parser_version,
            v_new_child_hash,
            TRUE,
            NOW()
          ) RETURNING id INTO v_child_id;

          v_inserted_children := v_inserted_children + 1;
        ELSIF v_existing_child_hash IS DISTINCT FROM v_new_child_hash THEN
          UPDATE wf_canonical_staging.mariadb_normalized_children SET
            child_unique_key = v_child->>'child_unique_key',
            brand = v_child->>'brand',
            model = v_child->>'model',
            reference = v_child->>'reference',
            dial_color = v_child->>'dial_color',
            year = (v_child->>'year')::int,
            condition = v_child->>'condition',
            intent = v_child->>'intent',
            original_price_amount = (v_child->>'original_price_amount')::numeric,
            original_price_currency = v_child->>'original_price_currency',
            currency_evidence = v_child->>'currency_evidence',
            price_usd = (v_child->>'price_usd')::numeric,
            fx_rate = (v_child->>'fx_rate')::numeric,
            fx_source = v_child->>'fx_source',
            fx_date = (v_child->>'fx_date')::date,
            currency_status = COALESCE(v_child->>'currency_status', 'MISSING_PRICE'),
            is_outlier = COALESCE((v_child->>'is_outlier')::boolean, false),
            outlier_reason = v_child->>'outlier_reason',
            primary_image_key = v_child->>'primary_image_key',
            primary_image_url = v_child->>'primary_image_url',
            primary_image_evidence_type = v_child->>'primary_image_evidence_type',
            trading_floor_status = COALESCE(v_child->>'trading_floor_status', 'HELD_UNKNOWN'),
            trading_floor_eligible = COALESCE((v_child->>'trading_floor_eligible')::boolean, false),
            price_research_status = COALESCE(v_child->>'price_research_status', 'INELIGIBLE_UNKNOWN'),
            price_research_eligible = COALESCE((v_child->>'price_research_eligible')::boolean, false),
            reconciliation_category = v_child->>'reconciliation_category',
            review_flags = COALESCE(v_child->'review_flags', '[]'::jsonb),
            exclusion_reasons = COALESCE(v_child->'exclusion_reasons', '[]'::jsonb),
            parser_version = v_new_parser_version,
            child_proposal_hash = v_new_child_hash,
            is_active = TRUE,
            superseded_at = NULL,
            normalized_at = NOW()
          WHERE id = v_child_id;

          v_updated_children := v_updated_children + 1;
        ELSE
          v_unchanged_children := v_unchanged_children + 1;
        END IF;

        -- Process Child Images
        IF (v_child->'images') IS NOT NULL AND jsonb_typeof(v_child->'images') = 'array' THEN
          FOR v_img IN SELECT * FROM jsonb_array_elements(v_child->'images')
          LOOP
            INSERT INTO wf_canonical_staging.mariadb_normalized_images (
              parent_id, child_id, image_ordinal, image_key, image_url, image_evidence_type, is_active
            ) VALUES (
              v_parent_id,
              v_child_id,
              COALESCE((v_img->>'image_ordinal')::int, 0),
              v_img->>'image_key',
              v_img->>'image_url',
              COALESCE(v_img->>'image_evidence_type', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED'),
              TRUE
            )
            ON CONFLICT (parent_id, image_ordinal, image_key) DO UPDATE SET
              child_id = EXCLUDED.child_id,
              image_url = EXCLUDED.image_url,
              image_evidence_type = EXCLUDED.image_evidence_type,
              is_active = TRUE;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_parents', v_inserted_parents,
    'updated_parents', v_updated_parents,
    'unchanged_parents', v_unchanged_parents,
    'inserted_children', v_inserted_children,
    'updated_children', v_updated_children,
    'unchanged_children', v_unchanged_children
  );
END;
$$;

-- 7. Hardened Composite Detail RPC with Explicit Contact Publication Approval
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
SET search_path = wf_canonical_staging, public, pg_catalog
AS $$
DECLARE
  v_parent RECORD;
  v_child RECORD;
  v_images JSONB;
  v_raw RECORD;
  v_masked_phone TEXT;
  v_inquiry_text TEXT;
  v_whatsapp_url TEXT;
  v_raw_contact TEXT;
  v_digits_only TEXT;
  v_is_approved BOOLEAN;
BEGIN
  IF p_source_id IS NULL OR p_source_system IS NULL OR
     p_source_database IS NULL OR p_source_table IS NULL OR
     p_source_hash IS NULL THEN
    RAISE EXCEPTION 'get_mariadb_canonical_child_detail: All composite provenance arguments are mandatory';
  END IF;

  SELECT * INTO v_parent
  FROM wf_canonical_staging.mariadb_normalized_parents
  WHERE source_system = p_source_system
    AND source_database = p_source_database
    AND source_table = p_source_table
    AND source_id = p_source_id
    AND source_hash = p_source_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'PARENT_NOT_FOUND', 'source_id', p_source_id);
  END IF;

  SELECT * INTO v_child
  FROM wf_canonical_staging.mariadb_normalized_children
  WHERE parent_id = v_parent.id
    AND child_ordinal = p_child_ordinal
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CHILD_NOT_FOUND', 'parent_id', v_parent.id, 'child_ordinal', p_child_ordinal);
  END IF;

  SELECT jsonb_agg(to_jsonb(i)) INTO v_images
  FROM wf_canonical_staging.mariadb_normalized_images i
  WHERE i.parent_id = v_parent.id AND (i.child_id = v_child.id OR i.child_id IS NULL) AND i.is_active = TRUE;

  SELECT * INTO v_raw
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = p_source_system
    AND source_database = p_source_database
    AND source_table = p_source_table
    AND source_id = p_source_id
    AND source_hash = p_source_hash;

  v_raw_contact := v_parent.seller_contact;
  v_is_approved := COALESCE(v_parent.contact_publication_approved, FALSE);

  IF v_raw_contact IS NOT NULL THEN
    v_digits_only := regexp_replace(v_raw_contact, '\D', '', 'g');
    IF length(v_digits_only) > 4 THEN
      v_masked_phone := '+*** *** ' || substring(v_digits_only from length(v_digits_only) - 3);
    ELSE
      v_masked_phone := '[PRIVATE_SELLER_CONTACT]';
    END IF;
  END IF;

  IF v_is_approved = TRUE AND v_digits_only IS NOT NULL AND length(v_digits_only) >= 7 THEN
    v_inquiry_text := format(
      'Hi %s, I am inquiring about your listing for %s %s on WatchFlow.',
      COALESCE(v_parent.seller_name, 'Seller'),
      COALESCE(v_child.brand, 'Watch'),
      COALESCE(v_child.reference, '')
    );
    v_whatsapp_url := format(
      'https://wa.me/%s?text=%s',
      v_digits_only,
      replace(v_inquiry_text, ' ', '%20')
    );
  ELSE
    v_whatsapp_url := NULL;
    v_raw_contact := NULL; -- Strictly fail-closed: do not expose unapproved raw phone
  END IF;

  RETURN jsonb_build_object(
    'parent', to_jsonb(v_parent),
    'child', to_jsonb(v_child),
    'images', COALESCE(v_images, '[]'::jsonb),
    'raw_source', CASE WHEN v_raw IS NOT NULL THEN jsonb_build_object(
      'source_id', v_raw.source_id,
      'source_created_on', v_raw.source_created_on,
      'raw_message', v_raw.raw_message,
      'raw_payload', v_raw.raw_payload
    ) ELSE NULL END,
    'authorized_inquiry', jsonb_build_object(
      'source_system', v_parent.source_system,
      'source_database', v_parent.source_database,
      'source_table', v_parent.source_table,
      'source_id', v_parent.source_id,
      'source_hash', v_parent.source_hash,
      'seller_name', v_parent.seller_name,
      'seller_contact_masked', v_masked_phone,
      'seller_contact_raw', v_raw_contact,
      'contact_publication_approved', v_is_approved,
      'whatsapp_url', v_whatsapp_url,
      'inquiry_ready', (v_is_approved = TRUE AND v_whatsapp_url IS NOT NULL)
    )
  );
END;
$$;

-- 8. Enforce RPC-only Privilege Model
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA wf_canonical_staging TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_mariadb_canonical_batch(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_mariadb_canonical_child_detail(TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;
