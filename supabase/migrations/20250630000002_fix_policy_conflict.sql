-- Fix: Policy already exists error — drop before create
-- Run this if you get "policy already exists" errors

DO $$
BEGIN
    -- reprocessing_logs policies
    DROP POLICY IF EXISTS "allow_select" ON reprocessing_logs;
    DROP POLICY IF EXISTS "service_role_write" ON reprocessing_logs;
    DROP POLICY IF EXISTS "Allow all" ON reprocessing_logs;
    DROP POLICY IF EXISTS "allow_all" ON reprocessing_logs;
    
    CREATE POLICY "allow_select" ON reprocessing_logs FOR SELECT USING (true);
    CREATE POLICY "service_role_write" ON reprocessing_logs
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
END $$;

-- Also ensure reprocessing_queue and reprocessing_progress are clean
DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow all" ON reprocessing_queue;
    DROP POLICY IF EXISTS "allow_all" ON reprocessing_queue;
    DROP POLICY IF EXISTS "Allow all" ON reprocessing_progress;
    DROP POLICY IF EXISTS "allow_all" ON reprocessing_progress;
END $$;

-- Verify
SELECT tablename, policyname FROM pg_policies 
WHERE tablename IN ('reprocessing_queue', 'reprocessing_progress', 'reprocessing_logs')
ORDER BY tablename, policyname;
