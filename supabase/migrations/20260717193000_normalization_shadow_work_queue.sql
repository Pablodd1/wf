-- Durable work queue for shadow normalization.
--
-- Do not use watch_records.id as a checkpoint cursor: the production archive
-- contains UUIDs, MySQL-derived IDs, and synthetic test IDs, which have no
-- trustworthy lexical or chronological order. This queue provides explicit
-- claim/complete state and leaves watch_records immutable.

CREATE TABLE IF NOT EXISTS public.normalization_shadow_work_queue (
  source_record_id TEXT PRIMARY KEY REFERENCES public.watch_records(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING', 'LEASED', 'COMPLETE', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_holder TEXT,
  lease_expires_at TIMESTAMPTZ,
  requeue_requested BOOLEAN NOT NULL DEFAULT FALSE,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_shadow_work_queue_claim
  ON public.normalization_shadow_work_queue (available_at, created_at, source_record_id)
  WHERE state = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_normalization_shadow_work_queue_expired_lease
  ON public.normalization_shadow_work_queue (lease_expires_at, created_at, source_record_id)
  WHERE state = 'LEASED';

CREATE OR REPLACE FUNCTION public.enqueue_normalization_shadow_work()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_message IS NULL OR length(trim(NEW.raw_message)) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.normalization_shadow_work_queue (source_record_id)
  VALUES (NEW.id)
  ON CONFLICT (source_record_id) DO UPDATE
    SET state = CASE
          WHEN public.normalization_shadow_work_queue.state = 'LEASED' THEN 'LEASED'
          ELSE 'PENDING'
        END,
        available_at = CASE
          WHEN public.normalization_shadow_work_queue.state = 'LEASED' THEN public.normalization_shadow_work_queue.available_at
          ELSE now()
        END,
        lease_holder = CASE
          WHEN public.normalization_shadow_work_queue.state = 'LEASED' THEN public.normalization_shadow_work_queue.lease_holder
          ELSE NULL
        END,
        lease_expires_at = CASE
          WHEN public.normalization_shadow_work_queue.state = 'LEASED' THEN public.normalization_shadow_work_queue.lease_expires_at
          ELSE NULL
        END,
        requeue_requested = public.normalization_shadow_work_queue.state = 'LEASED',
        last_error = CASE
          WHEN public.normalization_shadow_work_queue.state = 'LEASED' THEN public.normalization_shadow_work_queue.last_error
          ELSE NULL
        END,
        completed_at = CASE
          WHEN public.normalization_shadow_work_queue.state = 'LEASED' THEN public.normalization_shadow_work_queue.completed_at
          ELSE NULL
        END,
        updated_at = now()
  ;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalization_shadow_work_enqueue_insert ON public.watch_records;
CREATE TRIGGER normalization_shadow_work_enqueue_insert
AFTER INSERT ON public.watch_records
FOR EACH ROW EXECUTE FUNCTION public.enqueue_normalization_shadow_work();

DROP TRIGGER IF EXISTS normalization_shadow_work_enqueue_update ON public.watch_records;
CREATE TRIGGER normalization_shadow_work_enqueue_update
AFTER UPDATE OF raw_message, brand, reference, dial_color, price_raw, price_usd, currency, listing_type
ON public.watch_records
FOR EACH ROW
WHEN (
  OLD.raw_message IS DISTINCT FROM NEW.raw_message
  OR OLD.brand IS DISTINCT FROM NEW.brand
  OR OLD.reference IS DISTINCT FROM NEW.reference
  OR OLD.dial_color IS DISTINCT FROM NEW.dial_color
  OR OLD.price_raw IS DISTINCT FROM NEW.price_raw
  OR OLD.price_usd IS DISTINCT FROM NEW.price_usd
  OR OLD.currency IS DISTINCT FROM NEW.currency
  OR OLD.listing_type IS DISTINCT FROM NEW.listing_type
)
EXECUTE FUNCTION public.enqueue_normalization_shadow_work();

CREATE OR REPLACE FUNCTION public.claim_normalization_shadow_work(
  p_holder TEXT,
  p_limit INTEGER DEFAULT 250,
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS TABLE (
  id TEXT,
  raw_message TEXT,
  brand TEXT,
  reference TEXT,
  price_raw NUMERIC,
  price_usd NUMERIC,
  currency TEXT,
  listing_type TEXT,
  dial_color TEXT,
  parser_version TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_holder IS NULL OR length(trim(p_holder)) = 0
    OR p_limit < 1 OR p_limit > 1000
    OR p_lease_seconds < 30 OR p_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'Invalid normalization queue claim request';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT q.source_record_id
    FROM public.normalization_shadow_work_queue q
    WHERE (q.state = 'PENDING' AND q.available_at <= now())
       OR (q.state = 'LEASED' AND q.lease_expires_at < now())
    ORDER BY q.available_at, q.created_at, q.source_record_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.normalization_shadow_work_queue q
  SET state = 'LEASED',
        attempts = q.attempts + 1,
        lease_holder = p_holder,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    FROM eligible e
    WHERE q.source_record_id = e.source_record_id
    RETURNING q.source_record_id
  )
  SELECT w.id, w.raw_message, w.brand, w.reference, w.price_raw,
    w.price_usd, w.currency, w.listing_type, w.dial_color, w.parser_version
  FROM claimed c
  JOIN public.watch_records w ON w.id = c.source_record_id
  ORDER BY c.source_record_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_normalization_shadow_work(
  p_holder TEXT,
  p_source_record_ids TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  completed_count INTEGER;
BEGIN
  UPDATE public.normalization_shadow_work_queue
  SET state = CASE WHEN requeue_requested THEN 'PENDING' ELSE 'COMPLETE' END,
      available_at = CASE WHEN requeue_requested THEN now() ELSE available_at END,
      lease_holder = NULL,
      lease_expires_at = NULL,
      requeue_requested = FALSE,
      last_error = NULL,
      completed_at = CASE WHEN requeue_requested THEN NULL ELSE now() END,
      updated_at = now()
  WHERE source_record_id = ANY(p_source_record_ids)
    AND state = 'LEASED'
    AND lease_holder = p_holder;
  GET DIAGNOSTICS completed_count = ROW_COUNT;
  RETURN completed_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_normalization_shadow_work(
  p_holder TEXT,
  p_source_record_ids TEXT[],
  p_error TEXT DEFAULT NULL,
  p_retry_seconds INTEGER DEFAULT 60,
  p_max_attempts INTEGER DEFAULT 8
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released_count INTEGER;
BEGIN
  IF p_retry_seconds < 1 OR p_retry_seconds > 3600 OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'Invalid normalization queue release request';
  END IF;

  UPDATE public.normalization_shadow_work_queue
  SET state = CASE WHEN attempts >= p_max_attempts THEN 'FAILED' ELSE 'PENDING' END,
      available_at = now() + make_interval(secs => p_retry_seconds),
      lease_holder = NULL,
      lease_expires_at = NULL,
      last_error = left(coalesce(p_error, 'Worker batch failed'), 1000),
      updated_at = now()
  WHERE source_record_id = ANY(p_source_record_ids)
    AND state = 'LEASED'
    AND lease_holder = p_holder;
  GET DIAGNOSTICS released_count = ROW_COUNT;
  RETURN released_count;
END;
$$;

ALTER TABLE public.normalization_shadow_work_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.normalization_shadow_work_queue FROM anon, authenticated;
GRANT ALL ON public.normalization_shadow_work_queue TO service_role;
REVOKE ALL ON FUNCTION public.claim_normalization_shadow_work(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_normalization_shadow_work(TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_normalization_shadow_work(TEXT, TEXT[], TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_normalization_shadow_work(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_normalization_shadow_work(TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_normalization_shadow_work(TEXT, TEXT[], TEXT, INTEGER, INTEGER) TO service_role;

-- Historical backfill is intentionally not part of this migration. It is a
-- controlled, one-time production operation against 2.6M+ rows. Run the
-- documented, idempotent INSERT ... SELECT after this schema is verified.
