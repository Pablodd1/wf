-- Disposable clean bootstrap only. The historical ingestion migration replaces
-- two existing view contracts with incompatible column types. Retain their
-- objects/dependencies in a private archive before executing its exact bytes.
-- This file is deliberately outside supabase/migrations and is never a
-- production forward migration.
DO $$ BEGIN
  IF current_setting('wf.disposable_bootstrap', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'disposable_bootstrap_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.watch_records LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.reviewed_workbook_inventory LIMIT 1) THEN
    RAISE EXCEPTION 'disposable_bootstrap_requires_empty_tables';
  END IF;
END $$;
CREATE SCHEMA wf_disposable_legacy;
REVOKE ALL ON SCHEMA wf_disposable_legacy FROM PUBLIC, anon, authenticated, service_role;
ALTER VIEW public.reviewed_workbook_market_source_v2 SET SCHEMA wf_disposable_legacy;
ALTER VIEW public.price_research_verified_source SET SCHEMA wf_disposable_legacy;
