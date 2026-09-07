-- The historical migration grants a nine-argument signature while defining
-- eight arguments. Keep its bytes intact with a deliberately non-operational
-- compatibility overload. The real eight-argument privileges are repaired by
-- the production forward migration, not by granting this bootstrap function.
DO $$ BEGIN
  IF current_setting('wf.disposable_bootstrap', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'disposable_bootstrap_required';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ingest_mariadb_raw_batch(text,text,text,text,text,text,text,text,jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'obsolete_signature_not_executable' USING ERRCODE = '0A000';
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_mariadb_raw_batch(text,text,text,text,text,text,text,text,jsonb)
FROM PUBLIC, anon, authenticated, service_role;
