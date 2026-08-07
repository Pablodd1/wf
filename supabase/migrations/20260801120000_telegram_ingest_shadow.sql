-- Shadow-only Telegram intake. Raw events are immutable and cannot publish to
-- watch_records. Parser and vision output lives in a separate review table.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.telegram_ingest_shadow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id BIGINT NOT NULL UNIQUE,
  external_message_id TEXT NOT NULL UNIQUE,
  event_kind TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  chat_title TEXT,
  sender_id TEXT,
  sender_username TEXT,
  sender_display_name TEXT,
  message_date TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_text TEXT,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_payload JSONB NOT NULL,
  source_platform TEXT NOT NULL DEFAULT 'telegram'
    CHECK (source_platform = 'telegram'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_shadow_events_created
  ON public.telegram_ingest_shadow_events (created_at, id);

CREATE TABLE IF NOT EXISTS public.telegram_ingest_shadow_results (
  event_id UUID PRIMARY KEY
    REFERENCES public.telegram_ingest_shadow_events(id) ON DELETE RESTRICT,
  processing_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (processing_status IN ('PENDING', 'PROCESSING', 'READY_FOR_REVIEW', 'ERROR')),
  review_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'DEFERRED')),
  parser_version TEXT,
  deterministic_result JSONB,
  vision_result JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_shadow_results_status
  ON public.telegram_ingest_shadow_results (processing_status, updated_at);

CREATE OR REPLACE FUNCTION public.claim_telegram_shadow_events(
  p_limit INTEGER DEFAULT 20,
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS SETOF public.telegram_ingest_shadow_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT event.id
    FROM public.telegram_ingest_shadow_events event
    LEFT JOIN public.telegram_ingest_shadow_results result
      ON result.event_id = event.id
    WHERE (
      result.event_id IS NULL
      OR result.processing_status IN ('PENDING', 'ERROR')
    )
      AND COALESCE(result.attempts, 0) < GREATEST(1, LEAST(p_max_attempts, 10))
    ORDER BY event.created_at, event.id
    FOR UPDATE OF event SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  ), claimed AS (
    INSERT INTO public.telegram_ingest_shadow_results (
      event_id,
      processing_status,
      attempts,
      last_error,
      updated_at
    )
    SELECT id, 'PROCESSING', 1, NULL, now()
    FROM candidates
    ON CONFLICT (event_id) DO UPDATE SET
      processing_status = 'PROCESSING',
      attempts = public.telegram_ingest_shadow_results.attempts + 1,
      last_error = NULL,
      updated_at = now()
    RETURNING event_id
  )
  SELECT event.*
  FROM public.telegram_ingest_shadow_events event
  JOIN claimed ON claimed.event_id = event.id
  ORDER BY event.created_at, event.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_telegram_shadow_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'telegram_ingest_shadow_events is immutable';
END;
$$;

DROP TRIGGER IF EXISTS telegram_shadow_events_immutable
  ON public.telegram_ingest_shadow_events;
CREATE TRIGGER telegram_shadow_events_immutable
BEFORE UPDATE OR DELETE ON public.telegram_ingest_shadow_events
FOR EACH ROW EXECUTE FUNCTION public.block_telegram_shadow_event_mutation();

ALTER TABLE public.telegram_ingest_shadow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_ingest_shadow_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.telegram_ingest_shadow_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_ingest_shadow_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_ingest_shadow_events TO service_role;
GRANT ALL ON public.telegram_ingest_shadow_results TO service_role;

REVOKE ALL ON FUNCTION public.block_telegram_shadow_event_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_telegram_shadow_event_mutation() TO service_role;
REVOKE ALL ON FUNCTION public.claim_telegram_shadow_events(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_telegram_shadow_events(INTEGER, INTEGER) TO service_role;

COMMENT ON TABLE public.telegram_ingest_shadow_events IS
  'Immutable, allowlisted Telegram webhook evidence for shadow pipeline testing only.';
COMMENT ON TABLE public.telegram_ingest_shadow_results IS
  'Deterministic and optional AI suggestions; never an approval or publication target.';
