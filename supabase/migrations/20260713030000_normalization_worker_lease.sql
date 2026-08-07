-- Ensures Vercel cron and the dedicated worker cannot advance the same
-- shadow-normalization checkpoint concurrently. It never touches watch_records.

CREATE TABLE IF NOT EXISTS public.normalization_worker_leases (
  job_name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.normalization_worker_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.normalization_worker_leases FROM anon, authenticated;
GRANT ALL ON public.normalization_worker_leases TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_normalization_worker_lease(
  p_job_name TEXT,
  p_holder TEXT,
  p_lease_seconds INTEGER DEFAULT 240
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acquired BOOLEAN;
BEGIN
  IF p_job_name IS NULL OR length(trim(p_job_name)) = 0
    OR p_holder IS NULL OR length(trim(p_holder)) = 0
    OR p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'Invalid normalization worker lease request';
  END IF;

  INSERT INTO public.normalization_worker_leases (
    job_name, holder, lease_expires_at, acquired_at, updated_at
  )
  VALUES (
    p_job_name,
    p_holder,
    now() + make_interval(secs => p_lease_seconds),
    now(),
    now()
  )
  ON CONFLICT (job_name) DO UPDATE
    SET holder = EXCLUDED.holder,
        lease_expires_at = EXCLUDED.lease_expires_at,
        acquired_at = now(),
        updated_at = now()
    WHERE public.normalization_worker_leases.lease_expires_at < now()
  RETURNING TRUE INTO acquired;

  RETURN COALESCE(acquired, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_normalization_worker_lease(
  p_job_name TEXT,
  p_holder TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.normalization_worker_leases
  WHERE job_name = p_job_name
    AND holder = p_holder;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_normalization_worker_lease(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_normalization_worker_lease(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_normalization_worker_lease(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_normalization_worker_lease(TEXT, TEXT) TO service_role;
