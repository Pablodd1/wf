CREATE TABLE IF NOT EXISTS public.ai_api_quota_windows (
  route TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (route, client_hash, window_start)
);

ALTER TABLE public.ai_api_quota_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_api_quota_windows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_api_quota_windows TO service_role;

CREATE OR REPLACE FUNCTION public.consume_ai_api_quota(
  p_route TEXT,
  p_client_hash TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $quota$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_retry INTEGER;
BEGIN
  IF COALESCE(NULLIF(trim(p_route), ''), '') = ''
    OR COALESCE(NULLIF(trim(p_client_hash), ''), '') = ''
    OR p_limit < 1 OR p_limit > 1000
    OR p_window_seconds < 10 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid AI quota request';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.ai_api_quota_windows (
    route, client_hash, window_start, request_count, updated_at
  ) VALUES (
    p_route, p_client_hash, v_window_start, 1, now()
  )
  ON CONFLICT (route, client_hash, window_start) DO UPDATE
    SET request_count = public.ai_api_quota_windows.request_count + 1,
        updated_at = now()
    WHERE public.ai_api_quota_windows.request_count < p_limit
  RETURNING request_count INTO v_count;

  v_retry := greatest(1, ceil(extract(epoch FROM (v_window_start + make_interval(secs => p_window_seconds) - clock_timestamp())))::integer);

  RETURN jsonb_build_object(
    'allowed', v_count IS NOT NULL,
    'count', COALESCE(v_count, p_limit),
    'limit', p_limit,
    'retry_after_seconds', v_retry
  );
END;
$quota$;

REVOKE ALL ON FUNCTION public.consume_ai_api_quota(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_api_quota(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

CREATE INDEX IF NOT EXISTS idx_ai_api_quota_windows_updated
  ON public.ai_api_quota_windows (updated_at);

NOTIFY pgrst, 'reload schema';
