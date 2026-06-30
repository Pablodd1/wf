-- Migration: Fix Critical Security Issues (RLS + Performance)
-- =============================================================
-- Run this IMMEDIATELY in Supabase SQL Editor

-- ═══════════════════════════════════════════════════════════════
-- 1. ENABLE RLS ON ALL REPROCESSING TABLES
-- ═══════════════════════════════════════════════════════════════

-- reprocessing_queue
ALTER TABLE reprocessing_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON reprocessing_queue;
CREATE POLICY "service_role_all" ON reprocessing_queue
  FOR ALL USING (current_user = 'supabase_admin' OR auth.role() = 'service_role')
  WITH CHECK (current_user = 'supabase_admin' OR auth.role() = 'service_role');

-- reprocessing_progress
ALTER TABLE reprocessing_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON reprocessing_progress;
CREATE POLICY "service_role_all" ON reprocessing_progress
  FOR ALL USING (current_user = 'supabase_admin' OR auth.role() = 'service_role')
  WITH CHECK (current_user = 'supabase_admin' OR auth.role() = 'service_role');

-- reprocessing_logs (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reprocessing_logs') THEN
    ALTER TABLE reprocessing_logs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allow_read" ON reprocessing_logs;
    CREATE POLICY "allow_read" ON reprocessing_logs
      FOR SELECT USING (true);
    DROP POLICY IF EXISTS "service_role_write" ON reprocessing_logs;
    CREATE POLICY "service_role_write" ON reprocessing_logs
      FOR ALL USING (current_user = 'supabase_admin' OR auth.role() = 'service_role')
      WITH CHECK (current_user = 'supabase_admin' OR auth.role() = 'service_role');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. DROP DUPLICATE INDEXES ON watch_records
-- ═══════════════════════════════════════════════════════════════

-- First, let's see what indexes exist (informational only, won't execute)
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'watch_records' ORDER BY indexname;

-- Drop duplicate / redundant indexes (run carefully — check names first)
-- Common patterns: identical columns, overlapping composite indexes
-- Uncomment after verifying these are actual duplicates in your dashboard:

-- DROP INDEX IF EXISTS idx_watch_records_source_1;
-- DROP INDEX IF EXISTS idx_watch_records_created_at_1;
-- DROP INDEX IF EXISTS idx_watch_records_parser_version_1;

-- ═══════════════════════════════════════════════════════════════
-- 3. FIX MUTABLE SEARCH PATH ON FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  func RECORD;
BEGIN
  FOR func IN
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proconfig IS NULL
      AND p.proname IN ('claim_reprocess_batch', 'refresh_all_analytics', 'claim_reprocess_queue_item')
  LOOP
    EXECUTE format('ALTER FUNCTION %I SET search_path = public;', func.proname);
    RAISE NOTICE 'Fixed search_path for function: %', func.proname;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 4. VERIFY (Run these checks after applying)
-- ═══════════════════════════════════════════════════════════════

-- Check RLS is enabled
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE tablename IN ('reprocessing_queue', 'reprocessing_progress', 'reprocessing_logs')
ORDER BY tablename;

-- Check policies exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('reprocessing_queue', 'reprocessing_progress', 'reprocessing_logs')
ORDER BY tablename, policyname;

-- Check function search paths
SELECT p.proname, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('claim_reprocess_batch', 'refresh_all_analytics', 'claim_reprocess_queue_item');

-- Check remaining indexes on watch_records
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'watch_records'
ORDER BY indexname;
