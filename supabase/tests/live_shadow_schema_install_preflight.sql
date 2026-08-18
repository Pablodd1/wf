DO $preflight$
BEGIN
  IF to_regclass('staging.live_shadow_segment_checkpoint') IS NOT NULL
    OR to_regclass('staging.live_shadow_segment_batches') IS NOT NULL
    OR to_regclass('staging.live_shadow_candidates') IS NOT NULL
    OR to_regprocedure('staging.live_shadow_stable_jsonb(jsonb)') IS NOT NULL
    OR to_regprocedure('public.ingest_live_shadow_segment(text,text,bigint,text,text,text,text,text,text,text,text,jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'live shadow schema already exists; use the read-only verifier instead of blind reapply';
  END IF;
END $preflight$;

CREATE TEMP TABLE live_shadow_install_xact_baseline ON COMMIT DROP AS
SELECT relid, n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_xact_all_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema','extensions')
  AND NOT (schemaname='staging' AND relname LIKE 'live_shadow_%');
