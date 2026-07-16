-- Run this statement separately during a low-traffic maintenance window.
-- CREATE INDEX CONCURRENTLY cannot execute inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_watch_records_flags_image_extracted_id
  ON public.watch_records (
    (substring(lower(flags ->> 'image') from '([0-9a-f]{13,24}|[0-9]{1,12})'))
  )
  WHERE flags ->> 'image' IS NOT NULL;
