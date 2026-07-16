-- Mission Images staging is intentionally isolated from watch_records.
CREATE TABLE IF NOT EXISTS public.media_object_inventory (
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  size_bytes BIGINT,
  last_modified TIMESTAMPTZ,
  etag TEXT,
  public_url TEXT NOT NULL,
  extracted_id TEXT,
  id_type TEXT,
  namespace TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (mapping_status IN ('PENDING', 'UNPARSED', 'LINKED', 'NO_MATCH', 'AMBIGUOUS', 'PROMOTED')),
  source_record_id TEXT,
  mapping_method TEXT,
  mapped_at TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, object_key)
);

CREATE INDEX IF NOT EXISTS idx_media_object_inventory_extracted_id
  ON public.media_object_inventory (extracted_id)
  WHERE extracted_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_object_inventory_work_queue
  ON public.media_object_inventory (mapping_status, namespace, object_key);
CREATE INDEX IF NOT EXISTS idx_media_object_inventory_source_record
  ON public.media_object_inventory (source_record_id)
  WHERE source_record_id IS NOT NULL;

ALTER TABLE public.media_object_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_object_inventory FROM anon, authenticated;
GRANT ALL ON public.media_object_inventory TO service_role;
