-- Shared contact budget across serverless instances. No IP or contact is stored.
BEGIN;
CREATE TABLE wf_canonical_staging.contact_request_budgets (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 31),
  reset_at timestamptz NOT NULL
);
CREATE INDEX contact_request_budget_expiry ON wf_canonical_staging.contact_request_budgets(reset_at);
ALTER TABLE wf_canonical_staging.contact_request_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.contact_request_budgets FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.consume_listing_contact_budget(p_bucket_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now timestamptz := pg_catalog.clock_timestamp(); v_allowed boolean;
BEGIN
  IF p_bucket_hash IS NULL OR p_bucket_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_contact_budget' USING ERRCODE = '22023';
  END IF;
  -- Keep both counter increments and the hard capacity bound atomic.
  PERFORM pg_catalog.pg_advisory_xact_lock(724050, 1);
  DELETE FROM wf_canonical_staging.contact_request_budgets WHERE bucket_hash IN (
    SELECT bucket_hash FROM wf_canonical_staging.contact_request_budgets
    WHERE reset_at <= v_now ORDER BY reset_at LIMIT 100
  );
  IF NOT EXISTS (SELECT 1 FROM wf_canonical_staging.contact_request_budgets WHERE bucket_hash = p_bucket_hash)
    AND (SELECT count(*) FROM wf_canonical_staging.contact_request_budgets) >= 10000 THEN
    RETURN false;
  END IF;
  INSERT INTO wf_canonical_staging.contact_request_budgets AS budget (bucket_hash, attempts, reset_at)
  VALUES (p_bucket_hash, 1, v_now + interval '10 minutes')
  ON CONFLICT (bucket_hash) DO UPDATE SET
    attempts = CASE WHEN budget.reset_at <= v_now THEN 1 ELSE least(31, budget.attempts + 1) END,
    reset_at = CASE WHEN budget.reset_at <= v_now THEN v_now + interval '10 minutes' ELSE budget.reset_at END
  RETURNING attempts <= 30 INTO v_allowed;
  RETURN v_allowed;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_listing_contact_budget(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_listing_contact_budget(text) TO service_role;
COMMIT;
