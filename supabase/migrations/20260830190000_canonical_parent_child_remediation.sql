-- =============================================================================
-- Migration: 20260830190000_canonical_parent_child_remediation.sql
-- Description: Forward-only remediation and hardening for private canonical schema:
--              1. Removes synthesized provenance defaults & enforces strict NOT NULL.
--              2. Converts source_created_on/source_observed_at/posted_at to TIMESTAMPTZ & fx_date to DATE.
--              3. Migrates review_flags & exclusion_reasons consistently to JSONB.
--              4. Implements version-preserving child storage with partial active unique index.
--              5. Implements image supersession (parent vs child scope, active partial index).
--              6. Expands immutable-parent trigger to protect all raw evidence, timestamps, and provenance.
--              7. Hardens detail RPC to return explicit safe curated fields (null contact on non-approval).
--              8. Adds scoped constraints (64-char regex hashes, strictly positive prices, non-negative ordinals).
--              9. Adds strict RPC input validation (array check, max batch size 1000, empty string rejection, advisory lock).
--             10. Applies function-specific revocations (no global function revocations).
-- Security: Private staging only. Search path isolated to wf_canonical_staging, pg_catalog.
-- =============================================================================

-- 1. Enforce Non-Null Composite Provenance on Parents
ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
  ALTER COLUMN source_system DROP DEFAULT,
  ALTER COLUMN source_database DROP DEFAULT,
  ALTER COLUMN source_table DROP DEFAULT,
  ALTER COLUMN source_system SET NOT NULL,
  ALTER COLUMN source_database SET NOT NULL,
  ALTER COLUMN source_table SET NOT NULL,
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN source_hash SET NOT NULL,
  ALTER COLUMN parent_hash SET NOT NULL,
  ALTER COLUMN source_record_id SET NOT NULL;

-- 2. Convert Timestamps to TIMESTAMPTZ and fx_date to DATE
ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
  ALTER COLUMN source_created_on TYPE TIMESTAMPTZ USING source_created_on::timestamptz,
  ALTER COLUMN source_observed_at TYPE TIMESTAMPTZ USING source_observed_at::timestamptz,
  ALTER COLUMN posted_at TYPE TIMESTAMPTZ USING posted_at::timestamptz;

ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  ALTER COLUMN fx_date TYPE DATE USING fx_date::date;

-- 3. Migrate review_flags & exclusion_reasons Consistently to JSONB
ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
  ALTER COLUMN review_flags DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
  ALTER COLUMN review_flags TYPE JSONB USING CASE
    WHEN review_flags IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(to_jsonb(review_flags)) = 'array' THEN to_jsonb(review_flags)
    ELSE '[]'::jsonb
  END,
  ALTER COLUMN review_flags SET DEFAULT '[]'::jsonb;

ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  ALTER COLUMN review_flags DROP DEFAULT,
  ALTER COLUMN exclusion_reasons DROP DEFAULT;

ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  ALTER COLUMN review_flags TYPE JSONB USING CASE
    WHEN review_flags IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(to_jsonb(review_flags)) = 'array' THEN to_jsonb(review_flags)
    ELSE '[]'::jsonb
  END,
  ALTER COLUMN review_flags SET DEFAULT '[]'::jsonb,
  ALTER COLUMN exclusion_reasons TYPE JSONB USING CASE
    WHEN exclusion_reasons IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(to_jsonb(exclusion_reasons)) = 'array' THEN to_jsonb(exclusion_reasons)
    ELSE '[]'::jsonb
  END,
  ALTER COLUMN exclusion_reasons SET DEFAULT '[]'::jsonb;

-- 4. Scoped Check Constraints on Parents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_parents'::regclass
      AND conname = 'chk_mariadb_parents_hash_hex'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
      ADD CONSTRAINT chk_mariadb_parents_hash_hex CHECK (parent_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_parents'::regclass
      AND conname = 'chk_mariadb_parents_source_hash_hex'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
      ADD CONSTRAINT chk_mariadb_parents_source_hash_hex CHECK (source_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_parents'::regclass
      AND conname = 'chk_mariadb_parents_child_count'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_parents
      ADD CONSTRAINT chk_mariadb_parents_child_count CHECK (child_count >= 0);
  END IF;
END $$;

-- 5. Version-Preserving Child Storage & Scoped Constraints
ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_parser_version TEXT;

-- Drop old non-versioned unique constraints
DROP INDEX IF EXISTS wf_canonical_staging.uq_mariadb_norm_children_identity;
ALTER TABLE wf_canonical_staging.mariadb_normalized_children
  DROP CONSTRAINT IF EXISTS chk_mariadb_children_parent_ordinal_uq,
  DROP CONSTRAINT IF EXISTS uq_mariadb_norm_children_identity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mariadb_norm_children_active
  ON wf_canonical_staging.mariadb_normalized_children (parent_id, child_ordinal)
  WHERE is_active = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_ordinal'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_ordinal CHECK (child_ordinal >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_hash_hex'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_hash_hex CHECK (child_proposal_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_pos_orig_price'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_pos_orig_price CHECK (original_price_amount IS NULL OR original_price_amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_pos_usd_price'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_pos_usd_price CHECK (price_usd IS NULL OR price_usd > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_intent'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_intent CHECK (intent IS NULL OR intent IN (
        'WTS', 'WTB', 'PRICE_CHECK', 'WITHDRAWN', 'UNKNOWN'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_reconciliation_category'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_reconciliation_category CHECK (reconciliation_category IN (
        'SINGLE_RECORD', 'BUNDLE_ITEM', 'SPLIT_CHILD', 'MULTI_OFFER', 'NORMALIZED_PROPOSAL', 'REVIEW_REQUIRED'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_currency_status'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_currency_status CHECK (currency_status IN (
        'VERIFIED_EXPLICIT_USD', 'VERIFIED_EXPLICIT_EUR', 'VERIFIED_EXPLICIT_GBP', 'VERIFIED_EXPLICIT_CHF',
        'VERIFIED_EXPLICIT_SGD', 'VERIFIED_EXPLICIT_AED', 'VERIFIED_EXPLICIT_SAR', 'VERIFIED_EXPLICIT_CNY',
        'VERIFIED_EXPLICIT_JPY', 'VERIFIED_EXPLICIT_KRW', 'VERIFIED_EXPLICIT_THB', 'VERIFIED_EXPLICIT_CAD',
        'VERIFIED_EXPLICIT_AUD', 'VERIFIED_EXPLICIT_NZD', 'VERIFIED_EXPLICIT_MYR', 'VERIFIED_EXPLICIT_IDR',
        'VERIFIED_EXPLICIT_INR', 'VERIFIED_EXPLICIT_PHP', 'VERIFIED_EXPLICIT_TWD', 'VERIFIED_EXPLICIT_VND',
        'VERIFIED_EXPLICIT_BRL', 'VERIFIED_EXPLICIT_MXN', 'VERIFIED_EXPLICIT_ZAR', 'VERIFIED_EXPLICIT_SEK',
        'VERIFIED_EXPLICIT_NOK', 'VERIFIED_EXPLICIT_DKK', 'VERIFIED_EXPLICIT_HKD', 'VERIFIED_EXPLICIT_USDT',
        'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX', 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX',
        'AMBIGUOUS_BARE_DOLLAR_HELD', 'MISSING_PRICE', 'UNKNOWN_CURRENCY'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_trading_floor_status'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_trading_floor_status CHECK (trading_floor_status IN (
        'ELIGIBLE_WTS', 'ELIGIBLE_WTB', 'HELD_INTENT_UNKNOWN', 'HELD_IDENTITY_INCOMPLETE',
        'HELD_MISSING_SOURCE_TEXT', 'HELD_BUNDLE_UNSPLIT', 'HELD_WITHDRAWN', 'HELD_UNPRICED',
        'HELD_AMBIGUOUS_CURRENCY', 'HELD_FOREIGN_CURRENCY', 'HELD_UNKNOWN'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_price_research_status'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_price_research_status CHECK (price_research_status IN (
        'ELIGIBLE_VERIFIED_USD', 'INELIGIBLE_TRADING_FLOOR_HOLD', 'INELIGIBLE_NOT_WTS',
        'INELIGIBLE_AMBIGUOUS_CURRENCY', 'INELIGIBLE_MISSING_PRICE', 'INELIGIBLE_IDENTITY_INCOMPLETE',
        'INELIGIBLE_HKD_HELD_FOR_FX', 'INELIGIBLE_USDT_HELD_FOR_FX', 'INELIGIBLE_OUTLIER_EXCLUDED',
        'INELIGIBLE_FOREIGN_CURRENCY_HELD', 'INELIGIBLE_OTHER', 'INELIGIBLE_UNKNOWN'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_children'::regclass
      AND conname = 'chk_mariadb_children_image_evidence_type'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_children
      ADD CONSTRAINT chk_mariadb_children_image_evidence_type CHECK (primary_image_evidence_type IN (
        'IMAGE_KEY_PRESERVED_URL_UNVERIFIED', 'IMAGE_URL_VERIFIED', 'NO_IMAGE', 'IMAGE_UNAVAILABLE'
      ));
  END IF;
END $$;

-- 6. Image Versioning & Scope Separation
ALTER TABLE wf_canonical_staging.mariadb_normalized_images
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'CHILD',
  ADD COLUMN IF NOT EXISTS parser_version TEXT NOT NULL DEFAULT 'authoritative-canonical-v10-parent-child',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_images'::regclass
      AND conname = 'chk_mariadb_images_scope'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_images
      ADD CONSTRAINT chk_mariadb_images_scope CHECK (scope IN ('PARENT', 'CHILD'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'wf_canonical_staging.mariadb_normalized_images'::regclass
      AND conname = 'chk_mariadb_images_scope_child_id'
  ) THEN
    ALTER TABLE wf_canonical_staging.mariadb_normalized_images
      ADD CONSTRAINT chk_mariadb_images_scope_child_id CHECK (
        (scope = 'PARENT' AND child_id IS NULL) OR
        (scope = 'CHILD' AND child_id IS NOT NULL)
      );
  END IF;
END $$;

DROP INDEX IF EXISTS wf_canonical_staging.uq_mariadb_norm_images_key;
DROP INDEX IF EXISTS wf_canonical_staging.uq_mariadb_norm_images_active;
DROP INDEX IF EXISTS wf_canonical_staging.uq_mariadb_norm_images_parent_active;
DROP INDEX IF EXISTS wf_canonical_staging.uq_mariadb_norm_images_child_active;
ALTER TABLE wf_canonical_staging.mariadb_normalized_images
  DROP CONSTRAINT IF EXISTS uq_mariadb_norm_images_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mariadb_norm_images_parent_active
  ON wf_canonical_staging.mariadb_normalized_images (parent_id, image_ordinal, image_key)
  WHERE is_active = TRUE AND scope = 'PARENT';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mariadb_norm_images_child_active
  ON wf_canonical_staging.mariadb_normalized_images (parent_id, child_id, image_ordinal, image_key)
  WHERE is_active = TRUE AND scope = 'CHILD';

-- 7. Expanded Immutable-Parent Trigger
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
     NEW.source_record_id <> OLD.source_record_id OR
     NEW.source_created_on IS DISTINCT FROM OLD.source_created_on OR
     NEW.source_observed_at IS DISTINCT FROM OLD.source_observed_at OR
     NEW.posted_at IS DISTINCT FROM OLD.posted_at OR
     NEW.raw_message_original IS DISTINCT FROM OLD.raw_message_original OR
     NEW.listing_text_source IS DISTINCT FROM OLD.listing_text_source OR
     NEW.listing_text_sha256 IS DISTINCT FROM OLD.listing_text_sha256 OR
     NEW.raw_payload IS DISTINCT FROM OLD.raw_payload THEN
    RAISE EXCEPTION 'CANONICAL_MUTATION_ERROR: Raw source evidence, timestamps, payload, and provenance fields on mariadb_normalized_parents are immutable.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_mariadb_parent_evidence ON wf_canonical_staging.mariadb_normalized_parents;
CREATE TRIGGER trg_guard_mariadb_parent_evidence
  BEFORE UPDATE ON wf_canonical_staging.mariadb_normalized_parents
  FOR EACH ROW
  EXECUTE FUNCTION wf_canonical_staging.trg_fn_guard_immutable_parent_evidence();

-- 8. Hardened Batch Upsert RPC with Advisory Locking & Supersession
CREATE OR REPLACE FUNCTION public.upsert_mariadb_canonical_batch(
  p_parents JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
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
  v_child_ordinal INT;
  v_new_parser_version TEXT;
  v_lock_key BIGINT;
BEGIN
  IF p_parents IS NULL OR jsonb_typeof(p_parents) <> 'array' THEN
    RAISE EXCEPTION 'upsert_mariadb_canonical_batch: Input must be a JSON array';
  END IF;

  IF jsonb_array_length(p_parents) > 1000 THEN
    RAISE EXCEPTION 'upsert_mariadb_canonical_batch: Batch size exceeds 1000 elements';
  END IF;

  IF jsonb_array_length(p_parents) = 0 THEN
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
    IF COALESCE(trim(v_parent->>'source_system'), '') = '' OR
       COALESCE(trim(v_parent->>'source_database'), '') = '' OR
       COALESCE(trim(v_parent->>'source_table'), '') = '' OR
       COALESCE(trim(v_parent->>'source_id'), '') = '' OR
       COALESCE(trim(v_parent->>'source_hash'), '') = '' OR
       COALESCE(trim(v_parent->>'parent_hash'), '') = '' OR
       COALESCE(trim(v_parent->>'source_record_id'), '') = '' THEN
      RAISE EXCEPTION 'upsert_mariadb_canonical_batch: Mandatory provenance fields cannot be null or empty';
    END IF;

    -- Concurrency-safe per-parent transactional advisory lock
    v_lock_key := hashtext((v_parent->>'source_system') || ':' || (v_parent->>'source_database') || ':' || (v_parent->>'source_table') || ':' || (v_parent->>'source_id'));
    PERFORM pg_advisory_xact_lock(v_lock_key);

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
        COALESCE(v_parent->>'seller_rating_status', 'UNVERIFIED_NO_PUBLIC_REVIEWS'),
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
        seller_rating_status = COALESCE(v_parent->>'seller_rating_status', 'UNVERIFIED_NO_PUBLIC_REVIEWS'),
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

    -- Validate children is an array (mandatory, missing/null/scalar must throw)
    IF (v_parent->'children') IS NULL OR jsonb_typeof(v_parent->'children') <> 'array' THEN
      RAISE EXCEPTION 'upsert_mariadb_canonical_batch: Every parent must contain a children JSON array (got %)', COALESCE(jsonb_typeof(v_parent->'children'), 'null');
    END IF;

    -- Enforce child_count = jsonb_array_length(children)
    IF COALESCE((v_parent->>'child_count')::int, 0) <> jsonb_array_length(v_parent->'children') THEN
      RAISE EXCEPTION 'upsert_mariadb_canonical_batch: parent child_count (%) does not match children array length (%)',
        v_parent->>'child_count', jsonb_array_length(v_parent->'children');
    END IF;

    -- Validate child ordinals are unique and contiguous from 0 to child_count - 1
    IF jsonb_array_length(v_parent->'children') > 0 THEN
      DECLARE
        v_expected_ord INT := 0;
        v_seen_ordinals INT[] := ARRAY[]::int[];
        v_c JSONB;
        v_ord INT;
      BEGIN
        FOR v_c IN SELECT * FROM jsonb_array_elements(v_parent->'children')
        LOOP
          v_ord := (v_c->>'child_ordinal')::int;
          IF v_ord IS NULL OR v_ord < 0 THEN
            RAISE EXCEPTION 'upsert_mariadb_canonical_batch: child_ordinal must be a non-negative integer (got %)', v_c->>'child_ordinal';
          END IF;
          IF v_ord = ANY(v_seen_ordinals) THEN
            RAISE EXCEPTION 'upsert_mariadb_canonical_batch: duplicate child_ordinal % in children array', v_ord;
          END IF;
          v_seen_ordinals := array_append(v_seen_ordinals, v_ord);
        END LOOP;

        FOR v_expected_ord IN 0 .. (jsonb_array_length(v_parent->'children') - 1)
        LOOP
          IF NOT (v_expected_ord = ANY(v_seen_ordinals)) THEN
            RAISE EXCEPTION 'upsert_mariadb_canonical_batch: non-contiguous child ordinals; missing ordinal % (child_count=%)',
              v_expected_ord, jsonb_array_length(v_parent->'children');
          END IF;
        END LOOP;
      END;
    END IF;

    -- Supersession: Deactivate active images belonging to children removed by a smaller child set (or all if children is empty [])
    UPDATE wf_canonical_staging.mariadb_normalized_images
    SET is_active = FALSE, superseded_at = NOW()
    WHERE parent_id = v_parent_id
      AND is_active = TRUE
      AND child_id IN (
        SELECT id FROM wf_canonical_staging.mariadb_normalized_children
        WHERE parent_id = v_parent_id AND is_active = TRUE
          AND child_ordinal >= jsonb_array_length(v_parent->'children')
      );

    -- Supersession: Deactivate active children with higher ordinals if child count decreased (or all if children is empty [])
    UPDATE wf_canonical_staging.mariadb_normalized_children
    SET is_active = FALSE, superseded_at = NOW(), superseded_by_parser_version = v_new_parser_version
    WHERE parent_id = v_parent_id AND is_active = TRUE
      AND child_ordinal >= jsonb_array_length(v_parent->'children');

    -- Process Children (Version-preserving replacement)
    FOR v_child IN SELECT * FROM jsonb_array_elements(v_parent->'children')
    LOOP
      -- Validate images is an array (mandatory, missing/null/scalar must throw)
      IF (v_child->'images') IS NULL OR jsonb_typeof(v_child->'images') <> 'array' THEN
        RAISE EXCEPTION 'upsert_mariadb_canonical_batch: Every child must contain an images JSON array (got %)', COALESCE(jsonb_typeof(v_child->'images'), 'null');
      END IF;

      -- Validate image ordinals are non-negative and unique within each child
      IF jsonb_array_length(v_child->'images') > 0 THEN
        DECLARE
          v_img_seen_ordinals INT[] := ARRAY[]::int[];
          v_im JSONB;
          v_im_ord INT;
        BEGIN
          FOR v_im IN SELECT * FROM jsonb_array_elements(v_child->'images')
          LOOP
            v_im_ord := (v_im->>'image_ordinal')::int;
            IF v_im_ord IS NULL OR v_im_ord < 0 THEN
              RAISE EXCEPTION 'upsert_mariadb_canonical_batch: image_ordinal must be a non-negative integer (got %)', v_im->>'image_ordinal';
            END IF;
            IF v_im_ord = ANY(v_img_seen_ordinals) THEN
              RAISE EXCEPTION 'upsert_mariadb_canonical_batch: duplicate image_ordinal % in child images array', v_im_ord;
            END IF;
            v_img_seen_ordinals := array_append(v_img_seen_ordinals, v_im_ord);
          END LOOP;
        END;
      END IF;

      v_new_child_hash := v_child->>'child_proposal_hash';
      v_child_ordinal := (v_child->>'child_ordinal')::int;

      SELECT id, child_proposal_hash INTO v_child_id, v_existing_child_hash
      FROM wf_canonical_staging.mariadb_normalized_children
      WHERE parent_id = v_parent_id
        AND child_ordinal = v_child_ordinal
        AND is_active = TRUE;

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
          v_child_ordinal,
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
          COALESCE(v_child->>'primary_image_evidence_type', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED'),
          COALESCE(v_child->>'trading_floor_status', 'HELD_UNKNOWN'),
          COALESCE((v_child->>'trading_floor_eligible')::boolean, false),
          COALESCE(v_child->>'price_research_status', 'INELIGIBLE_UNKNOWN'),
          COALESCE((v_child->>'price_research_eligible')::boolean, false),
          COALESCE(v_child->>'reconciliation_category', 'SINGLE_RECORD'),
          COALESCE(v_child->'review_flags', '[]'::jsonb),
          COALESCE(v_child->'exclusion_reasons', '[]'::jsonb),
          v_new_parser_version,
          v_new_child_hash,
          TRUE,
          NOW()
        ) RETURNING id INTO v_child_id;

        v_inserted_children := v_inserted_children + 1;
      ELSIF v_existing_child_hash IS DISTINCT FROM v_new_child_hash THEN
        -- Version-preserving replacement: Mark prior child and its images inactive
        UPDATE wf_canonical_staging.mariadb_normalized_children
        SET is_active = FALSE, superseded_at = NOW(), superseded_by_parser_version = v_new_parser_version
        WHERE id = v_child_id;

        UPDATE wf_canonical_staging.mariadb_normalized_images
        SET is_active = FALSE, superseded_at = NOW()
        WHERE child_id = v_child_id AND is_active = TRUE;

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
          v_child_ordinal,
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
          COALESCE(v_child->>'primary_image_evidence_type', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED'),
          COALESCE(v_child->>'trading_floor_status', 'HELD_UNKNOWN'),
          COALESCE((v_child->>'trading_floor_eligible')::boolean, false),
          COALESCE(v_child->>'price_research_status', 'INELIGIBLE_UNKNOWN'),
          COALESCE((v_child->>'price_research_eligible')::boolean, false),
          COALESCE(v_child->>'reconciliation_category', 'SINGLE_RECORD'),
          COALESCE(v_child->'review_flags', '[]'::jsonb),
          COALESCE(v_child->'exclusion_reasons', '[]'::jsonb),
          v_new_parser_version,
          v_new_child_hash,
          TRUE,
          NOW()
        ) RETURNING id INTO v_child_id;

        v_updated_children := v_updated_children + 1;
      ELSE
        v_unchanged_children := v_unchanged_children + 1;
      END IF;

      -- Synchronize Child Images using composite (image_ordinal, image_key)
      -- Deactivate active images for this child that are absent from the new payload
      UPDATE wf_canonical_staging.mariadb_normalized_images
      SET is_active = FALSE, superseded_at = NOW()
      WHERE parent_id = v_parent_id
        AND child_id = v_child_id
        AND is_active = TRUE
        AND scope = 'CHILD'
        AND (image_ordinal, image_key) NOT IN (
          SELECT COALESCE((img->>'image_ordinal')::int, 0), (img->>'image_key')::text
          FROM jsonb_array_elements(v_child->'images') img
          WHERE img->>'image_key' IS NOT NULL
        );

      FOR v_img IN SELECT * FROM jsonb_array_elements(v_child->'images')
      LOOP
        IF (v_img->>'image_key') IS NOT NULL THEN
          INSERT INTO wf_canonical_staging.mariadb_normalized_images (
            parent_id, child_id, scope, image_ordinal, image_key, image_url, image_evidence_type,
            parser_version, is_active
          ) VALUES (
            v_parent_id,
            v_child_id,
            'CHILD',
            COALESCE((v_img->>'image_ordinal')::int, 0),
            v_img->>'image_key',
            v_img->>'image_url',
            COALESCE(v_img->>'image_evidence_type', 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED'),
            v_new_parser_version,
            TRUE
          )
          ON CONFLICT (parent_id, child_id, image_ordinal, image_key) WHERE is_active = TRUE AND scope = 'CHILD' DO UPDATE SET
            image_url = EXCLUDED.image_url,
            image_evidence_type = EXCLUDED.image_evidence_type,
            parser_version = EXCLUDED.parser_version,
            is_active = TRUE;
        END IF;
      END LOOP;
    END LOOP;
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

-- 9. Hardened Composite Detail RPC with Explicit Safe Curated Response
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
  v_parent RECORD;
  v_child RECORD;
  v_images JSONB;
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

  SELECT id, source_system, source_database, source_table, source_id, source_hash, source_record_id,
         source_created_on, posted_at, is_bundle, child_count, bundle_structure_type, seller_name,
         seller_contact, contact_publication_approved, seller_activity_count, seller_rating,
         seller_rating_status, seller_review_evidence, location, parser_version, parent_hash,
         review_flags, normalized_at
  INTO v_parent
  FROM wf_canonical_staging.mariadb_normalized_parents
  WHERE source_system = p_source_system
    AND source_database = p_source_database
    AND source_table = p_source_table
    AND source_id = p_source_id
    AND source_hash = p_source_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'PARENT_NOT_FOUND', 'source_id', p_source_id);
  END IF;

  SELECT id, parent_id, parent_source_id, parent_source_hash, child_ordinal, child_unique_key,
         brand, model, reference, dial_color, year, condition, intent, original_price_amount,
         original_price_currency, currency_evidence, price_usd, fx_rate, fx_source, fx_date,
         currency_status, is_outlier, outlier_reason, primary_image_key, primary_image_url,
         primary_image_evidence_type, trading_floor_status, trading_floor_eligible,
         price_research_status, price_research_eligible, reconciliation_category, review_flags,
         exclusion_reasons, parser_version, child_proposal_hash, is_active, normalized_at
  INTO v_child
  FROM wf_canonical_staging.mariadb_normalized_children
  WHERE parent_id = v_parent.id
    AND child_ordinal = p_child_ordinal
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CHILD_NOT_FOUND', 'parent_id', v_parent.id, 'child_ordinal', p_child_ordinal);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'image_ordinal', i.image_ordinal,
    'image_key', i.image_key,
    'image_url', i.image_url,
    'image_evidence_type', i.image_evidence_type,
    'scope', i.scope
  )) INTO v_images
  FROM wf_canonical_staging.mariadb_normalized_images i
  WHERE i.parent_id = v_parent.id AND (i.child_id = v_child.id OR i.child_id IS NULL) AND i.is_active = TRUE;

  v_raw_contact := v_parent.seller_contact;
  v_is_approved := COALESCE(v_parent.contact_publication_approved, FALSE);

  IF v_is_approved = TRUE AND v_raw_contact IS NOT NULL THEN
    v_digits_only := regexp_replace(v_raw_contact, '\D', '', 'g');
    IF length(v_digits_only) > 4 THEN
      v_masked_phone := '+*** *** ' || substring(v_digits_only from length(v_digits_only) - 3);
    ELSE
      v_masked_phone := '[PRIVATE_SELLER_CONTACT]';
    END IF;

    IF length(v_digits_only) >= 7 THEN
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
    END IF;
  ELSE
    -- Fail-closed: All contact fields must be null when contact_publication_approved is false
    v_masked_phone := NULL;
    v_raw_contact := NULL;
    v_whatsapp_url := NULL;
    v_inquiry_text := NULL;
  END IF;

  RETURN jsonb_build_object(
    'parent', jsonb_build_object(
      'id', v_parent.id,
      'source_system', v_parent.source_system,
      'source_database', v_parent.source_database,
      'source_table', v_parent.source_table,
      'source_id', v_parent.source_id,
      'source_hash', v_parent.source_hash,
      'source_record_id', v_parent.source_record_id,
      'posted_at', v_parent.posted_at,
      'is_bundle', v_parent.is_bundle,
      'child_count', v_parent.child_count,
      'bundle_structure_type', v_parent.bundle_structure_type,
      'seller_name', v_parent.seller_name,
      'seller_rating', v_parent.seller_rating,
      'seller_rating_status', v_parent.seller_rating_status,
      'location', v_parent.location,
      'parser_version', v_parent.parser_version,
      'parent_hash', v_parent.parent_hash,
      'review_flags', v_parent.review_flags,
      'normalized_at', v_parent.normalized_at
    ),
    'child', jsonb_build_object(
      'id', v_child.id,
      'parent_id', v_child.parent_id,
      'child_ordinal', v_child.child_ordinal,
      'child_unique_key', v_child.child_unique_key,
      'brand', v_child.brand,
      'model', v_child.model,
      'reference', v_child.reference,
      'dial_color', v_child.dial_color,
      'year', v_child.year,
      'condition', v_child.condition,
      'intent', v_child.intent,
      'original_price_amount', v_child.original_price_amount,
      'original_price_currency', v_child.original_price_currency,
      'currency_evidence', v_child.currency_evidence,
      'price_usd', v_child.price_usd,
      'fx_rate', v_child.fx_rate,
      'fx_source', v_child.fx_source,
      'fx_date', v_child.fx_date,
      'currency_status', v_child.currency_status,
      'is_outlier', v_child.is_outlier,
      'outlier_reason', v_child.outlier_reason,
      'primary_image_key', v_child.primary_image_key,
      'primary_image_url', v_child.primary_image_url,
      'primary_image_evidence_type', v_child.primary_image_evidence_type,
      'trading_floor_status', v_child.trading_floor_status,
      'trading_floor_eligible', v_child.trading_floor_eligible,
      'price_research_status', v_child.price_research_status,
      'price_research_eligible', v_child.price_research_eligible,
      'reconciliation_category', v_child.reconciliation_category,
      'review_flags', v_child.review_flags,
      'exclusion_reasons', v_child.exclusion_reasons,
      'parser_version', v_child.parser_version,
      'child_proposal_hash', v_child.child_proposal_hash,
      'is_active', v_child.is_active,
      'normalized_at', v_child.normalized_at
    ),
    'images', COALESCE(v_images, '[]'::jsonb),
    'raw_source_meta', jsonb_build_object(
      'source_id', v_parent.source_id,
      'source_created_on', v_parent.source_created_on,
      'has_raw_evidence', true
    ),
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

-- 10. Dedicated Internal Service-Role Evidence RPC (Auditors / Reprocessors Only)
CREATE OR REPLACE FUNCTION public.get_mariadb_canonical_internal_evidence(
  p_source_id TEXT,
  p_source_system TEXT,
  p_source_database TEXT,
  p_source_table TEXT,
  p_source_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wf_canonical_staging, pg_catalog
AS $$
DECLARE
  v_raw RECORD;
BEGIN
  IF p_source_id IS NULL OR p_source_system IS NULL OR
     p_source_database IS NULL OR p_source_table IS NULL OR
     p_source_hash IS NULL THEN
    RAISE EXCEPTION 'get_mariadb_canonical_internal_evidence: All composite provenance arguments are mandatory';
  END IF;

  SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
         source_created_on, raw_message, raw_payload
  INTO v_raw
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_system = p_source_system
    AND source_database = p_source_database
    AND source_table = p_source_table
    AND source_id = p_source_id
    AND source_hash = p_source_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'RAW_SOURCE_NOT_FOUND', 'source_id', p_source_id);
  END IF;

  RETURN jsonb_build_object(
    'source_id', v_raw.source_id,
    'source_system', v_raw.source_system,
    'source_database', v_raw.source_database,
    'source_table', v_raw.source_table,
    'source_hash', v_raw.source_hash,
    'source_record_id', v_raw.source_record_id,
    'source_created_on', v_raw.source_created_on,
    'raw_message', v_raw.raw_message,
    'raw_payload', v_raw.raw_payload
  );
END;
$$;

-- 11. Function-Specific Privileges & Access Revocation (No Global Function Revocation)
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.upsert_mariadb_canonical_batch(JSONB) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.get_mariadb_canonical_child_detail(TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.get_mariadb_canonical_internal_evidence(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.upsert_mariadb_canonical_batch(JSONB) FROM anon;
    REVOKE ALL ON FUNCTION public.get_mariadb_canonical_child_detail(TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM anon;
    REVOKE ALL ON FUNCTION public.get_mariadb_canonical_internal_evidence(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.upsert_mariadb_canonical_batch(JSONB) FROM authenticated;
    REVOKE ALL ON FUNCTION public.get_mariadb_canonical_child_detail(TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.get_mariadb_canonical_internal_evidence(TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA wf_canonical_staging TO service_role;
    GRANT EXECUTE ON FUNCTION public.upsert_mariadb_canonical_batch(JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_mariadb_canonical_child_detail(TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_mariadb_canonical_internal_evidence(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END $$;
