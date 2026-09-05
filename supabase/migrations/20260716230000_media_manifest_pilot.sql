CREATE TABLE IF NOT EXISTS public.media_manifest (
  source_object_key TEXT PRIMARY KEY,
  source_bucket TEXT NOT NULL,
  extracted_source_id TEXT NOT NULL,
  public_url TEXT NOT NULL,
  mime_type TEXT,
  source_size BIGINT,
  source_etag TEXT,
  source_modified_at TIMESTAMPTZ,
  matched_record_id TEXT REFERENCES public.watch_records(id) ON DELETE SET NULL,
  migration_status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (migration_status IN ('discovered', 'matched', 'linked', 'orphaned', 'failed')),
  verification_status TEXT NOT NULL DEFAULT 'not_checked'
    CHECK (verification_status IN ('not_checked', 'url_reachable', 'url_unreachable')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_manifest_source_id
  ON public.media_manifest (extracted_source_id);

CREATE INDEX IF NOT EXISTS idx_media_manifest_record
  ON public.media_manifest (matched_record_id)
  WHERE matched_record_id IS NOT NULL;

ALTER TABLE public.media_manifest ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.attach_listing_media_batch(payload JSONB)
RETURNS TABLE(linked_count INTEGER, unchanged_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  current_urls JSONB;
  changed BOOLEAN;
BEGIN
  linked_count := 0;
  unchanged_count := 0;

  FOR item IN SELECT value FROM jsonb_array_elements(payload)
  LOOP
    SELECT COALESCE(image_urls, '[]'::jsonb)
      INTO current_urls
      FROM public.watch_records
      WHERE id = item->>'record_id'
      FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    changed := NOT (current_urls @> jsonb_build_array(item->>'public_url'));

    UPDATE public.watch_records
      SET image_urls = CASE
          WHEN changed THEN current_urls || jsonb_build_array(item->>'public_url')
          ELSE current_urls
        END,
        thumbnail_url = COALESCE(NULLIF(thumbnail_url, ''), item->>'public_url'),
        has_images = true
      WHERE id = item->>'record_id';

    INSERT INTO public.media_manifest (
      source_object_key, source_bucket, extracted_source_id, public_url,
      mime_type, source_size, source_etag, source_modified_at,
      matched_record_id, migration_status, verification_status, updated_at
    ) VALUES (
      item->>'source_object_key', item->>'source_bucket', item->>'source_id', item->>'public_url',
      item->>'mime_type', NULLIF(item->>'source_size', '')::bigint, item->>'source_etag',
      NULLIF(item->>'source_modified_at', '')::timestamptz,
      item->>'record_id', 'linked', COALESCE(item->>'verification_status', 'not_checked'), now()
    )
    ON CONFLICT (source_object_key) DO UPDATE SET
      matched_record_id = EXCLUDED.matched_record_id,
      public_url = EXCLUDED.public_url,
      migration_status = 'linked',
      verification_status = EXCLUDED.verification_status,
      error_code = NULL,
      updated_at = now();

    IF changed THEN linked_count := linked_count + 1;
    ELSE unchanged_count := unchanged_count + 1;
    END IF;
  END LOOP;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_listing_media_batch(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_listing_media_batch(JSONB) TO service_role;
