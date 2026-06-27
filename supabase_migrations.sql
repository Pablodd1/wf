-- ============================================================
-- WatchFacts — Schema Migrations v2
-- Run in Supabase SQL Editor BEFORE running bulk-reprocess
-- ============================================================

-- Step 1: Add REVIEW to verdict constraint (if not already done)
ALTER TABLE watch_records 
  DROP CONSTRAINT IF EXISTS watch_records_verdict_check;
ALTER TABLE watch_records 
  ADD CONSTRAINT watch_records_verdict_check 
  CHECK (verdict IN ('APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'));

-- Step 2: Add processing state columns to watch_records
ALTER TABLE watch_records
  ADD COLUMN IF NOT EXISTS processed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parser_version   TEXT DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS listing_type     TEXT CHECK (listing_type IN ('WTS','WTB','WTT','GARBAGE')),
  ADD COLUMN IF NOT EXISTS accessories      JSONB,
  ADD COLUMN IF NOT EXISTS month_code       TEXT,
  ADD COLUMN IF NOT EXISTS field_confidence JSONB,
  ADD COLUMN IF NOT EXISTS human_edited     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS edit_source      TEXT;

-- Step 3: Create reprocess queue table
CREATE TABLE IF NOT EXISTS reprocess_queue (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  record_id      TEXT        NOT NULL,
  reason         TEXT        NOT NULL,
  priority       INT         DEFAULT 5,
  queued_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  error          TEXT,
  parser_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_reprocess_queue_pending
  ON reprocess_queue (priority, queued_at)
  WHERE completed_at IS NULL AND started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reprocess_queue_record
  ON reprocess_queue (record_id);

-- Step 4: Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_watch_records_listing_type
  ON watch_records (listing_type);

CREATE INDEX IF NOT EXISTS idx_watch_records_processed_at
  ON watch_records (processed_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_watch_records_parser_version
  ON watch_records (parser_version);

-- ─── RPC: Atomically claim a batch of queue items ───────────────────────────
-- Prevents duplicate processing when multiple cron workers run simultaneously.
-- Called by api/batch-process.js via POST /rest/v1/rpc/claim_reprocess_batch

CREATE OR REPLACE FUNCTION claim_reprocess_batch(batch_size INT DEFAULT 100)
RETURNS TABLE (id TEXT, record_id TEXT, reason TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE reprocess_queue q
  SET started_at = NOW()
  WHERE q.id IN (
    SELECT q2.id
    FROM reprocess_queue q2
    WHERE q2.completed_at IS NULL
      AND q2.started_at IS NULL
    ORDER BY q2.priority ASC, q2.queued_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.id, q.record_id, q.reason;
END;
$$;

-- Step 5: Verify
SELECT 
  COUNT(*) FILTER (WHERE processed_at IS NULL) AS unprocessed,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL) AS processed,
  COUNT(*) AS total
FROM watch_records;
