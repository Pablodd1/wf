-- Retain the previous, wider disposable view contract and its dependencies.
DO $$ BEGIN
  IF current_setting('wf.disposable_bootstrap', true) IS DISTINCT FROM 'true'
    OR EXISTS (SELECT 1 FROM staging.listings LIMIT 1) THEN
    RAISE EXCEPTION 'disposable_bootstrap_requires_empty_tables';
  END IF;
END $$;
ALTER VIEW public.reviewed_workbook_market_source_v2 RENAME TO reviewed_workbook_market_source_v2_aug8;
ALTER VIEW public.reviewed_workbook_market_source_v2_aug8 SET SCHEMA wf_disposable_legacy;
