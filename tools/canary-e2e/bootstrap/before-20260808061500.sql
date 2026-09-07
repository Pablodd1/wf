-- Clean disposable bootstrap: nullable columns referenced by the historical
-- August 8 view were never introduced by the checked-in table DDL.
DO $$ BEGIN
  IF current_setting('wf.disposable_bootstrap', true) IS DISTINCT FROM 'true'
    OR EXISTS (SELECT 1 FROM staging.listings LIMIT 1) THEN
    RAISE EXCEPTION 'disposable_bootstrap_requires_empty_tables';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='staging'
    AND table_name='listings' AND column_name='image_urls' AND data_type='ARRAY') THEN
    ALTER TABLE staging.listings RENAME COLUMN image_urls TO image_urls_aug6;
  END IF;
END $$;
ALTER TABLE staging.listings
  ADD COLUMN IF NOT EXISTS review_count integer,
  ADD COLUMN IF NOT EXISTS wts_post_count integer,
  ADD COLUMN IF NOT EXISTS wtb_post_count integer,
  ADD COLUMN IF NOT EXISTS group_count integer,
  ADD COLUMN IF NOT EXISTS transport_checksum text,
  ADD COLUMN IF NOT EXISTS seller_item_signature text,
  ADD COLUMN IF NOT EXISTS listing_event_signature text,
  ADD COLUMN IF NOT EXISTS batch_id text,
  ADD COLUMN IF NOT EXISTS front_image text,
  ADD COLUMN IF NOT EXISTS image_urls jsonb,
  ADD COLUMN IF NOT EXISTS has_exact_source_image boolean,
  ADD COLUMN IF NOT EXISTS image_provenance text,
  ADD COLUMN IF NOT EXISTS source_image_preserved boolean,
  ADD COLUMN IF NOT EXISTS image_url_resolvable boolean,
  ADD COLUMN IF NOT EXISTS visually_verified boolean,
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS attachment_keys jsonb,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS media_fingerprint text;
DO $$ BEGIN
  IF to_regclass('public.reviewed_workbook_market_source_v2') IS NOT NULL THEN
    ALTER VIEW public.reviewed_workbook_market_source_v2 RENAME TO reviewed_workbook_market_source_v2_aug6;
    ALTER VIEW public.reviewed_workbook_market_source_v2_aug6 SET SCHEMA wf_disposable_legacy;
  END IF;
END $$;
