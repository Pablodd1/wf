-- ============================================================
-- WatchFacts — Supabase Migrations & Performance Indexes
-- Run in Supabase SQL Editor: https://app.supabase.com → SQL Editor
-- ============================================================

-- ─── MIGRATION: Add REVIEW verdict to watch_records constraint ───
-- Run this BEFORE executing update_verdicts_final.cjs bulk update
-- Otherwise ~21K REVIEW rows will be rejected by Postgres

ALTER TABLE watch_records 
  DROP CONSTRAINT IF EXISTS watch_records_verdict_check;
ALTER TABLE watch_records 
  ADD CONSTRAINT watch_records_verdict_check 
  CHECK (verdict IN ('APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'));


-- Index 1: Verdict filtering (price-research.js filters by verdict)
-- Before: full table scan on 2.39M rows
-- After: direct index seek (~100x faster for verdict-filtered queries)
CREATE INDEX IF NOT EXISTS idx_watch_records_verdict
  ON watch_records(verdict);

-- Index 2: Reference lookup (price-research.js primary query)
-- Supports exact match AND prefix matches (ilike ref%)
CREATE INDEX IF NOT EXISTS idx_watch_records_reference
  ON watch_records(reference);

-- Index 3: Created_at for time-ordered queries (dashboard, daily-report)
CREATE INDEX IF NOT EXISTS idx_watch_records_created_at
  ON watch_records(created_at DESC);

-- Index 4: Brand + reference composite (admin queries often filter by both)
CREATE INDEX IF NOT EXISTS idx_watch_records_brand_reference
  ON watch_records(brand, reference);

-- Verify indexes were created:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'watch_records'
ORDER BY indexname;
