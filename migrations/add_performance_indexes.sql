-- Performance indexes for watch_records
-- Applied: 2026-06-30
-- Table: watch_records (2.39M rows)
-- Run: Supabase SQL Editor → https://supabase.com/dashboard/project/bptrvfncppbjnchsaxtb/sql/new

CREATE INDEX IF NOT EXISTS idx_watch_records_verdict ON watch_records(verdict);
CREATE INDEX IF NOT EXISTS idx_watch_records_reference ON watch_records(reference);

SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'watch_records' 
  AND indexname IN ('idx_watch_records_verdict', 'idx_watch_records_reference');
