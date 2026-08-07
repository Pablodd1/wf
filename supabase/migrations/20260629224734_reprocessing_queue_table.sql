-- Reconciled from the migration already applied in production on 2026-06-29.
-- This file restores repository history; it must not be replayed against the
-- production database.

-- Reprocessing queue: tracks which batches of records need reprocessing
CREATE TABLE IF NOT EXISTS reprocessing_queue (
  id SERIAL PRIMARY KEY,
  batch_number INTEGER NOT NULL,
  offset_start INTEGER NOT NULL,
  batch_size INTEGER NOT NULL DEFAULT 1000,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  records_processed INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(batch_number)
);

-- Index for fast status queries
CREATE INDEX IF NOT EXISTS idx_reprocessing_status ON reprocessing_queue(status);

-- Progress tracking summary
CREATE TABLE IF NOT EXISTS reprocessing_progress (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_records INTEGER NOT NULL DEFAULT 2392784,
  total_batches INTEGER NOT NULL DEFAULT 2393,
  batches_completed INTEGER NOT NULL DEFAULT 0,
  batches_pending INTEGER NOT NULL DEFAULT 2393,
  batches_processing INTEGER NOT NULL DEFAULT 0,
  batches_failed INTEGER NOT NULL DEFAULT 0,
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
