-- Historical grant targets a removed three-argument overload. This stub is
-- restricted to empty disposable replay and cannot return customer records.
DO $$ BEGIN
  IF current_setting('wf.disposable_bootstrap', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'disposable_bootstrap_required';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.qnsa_trading_floor_page_rows(text,integer,integer)
RETURNS TABLE(row_data jsonb) LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'obsolete_signature_not_executable' USING ERRCODE = '0A000';
END;
$$;
REVOKE ALL ON FUNCTION public.qnsa_trading_floor_page_rows(text,integer,integer)
FROM PUBLIC, anon, authenticated, service_role;
