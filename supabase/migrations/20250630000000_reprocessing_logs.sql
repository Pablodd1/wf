-- Migration: Create reprocessing_logs table for batch tracking
-- Run this in Supabase SQL Editor if reprocessing_logs table doesn't exist

-- Drop if exists (for clean setup)
DROP TABLE IF EXISTS reprocessing_logs CASCADE;

-- Create logs table
CREATE TABLE IF NOT EXISTS reprocessing_logs (
  id BIGSERIAL PRIMARY KEY,
  batch_number INTEGER NOT NULL,
  offset_start INTEGER NOT NULL DEFAULT 0,
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  records_error INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  parser_version TEXT DEFAULT 'v3.0',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast retrieval of recent logs
CREATE INDEX IF NOT EXISTS idx_reprocessing_logs_batch_number ON reprocessing_logs(batch_number DESC);
CREATE INDEX IF NOT EXISTS idx_reprocessing_logs_created_at ON reprocessing_logs(created_at DESC);

-- Grant access
GRANT ALL ON reprocessing_logs TO authenticated;
GRANT ALL ON reprocessing_logs TO anon;
GRANT ALL ON reprocessing_logs TO service_role;

-- Enable RLS with secure policies
ALTER TABLE reprocessing_logs ENABLE ROW LEVEL SECURITY;

-- Read-only for everyone (report viewing)
CREATE POLICY "allow_select" ON reprocessing_logs FOR SELECT USING (true);

-- Write only for service role / backend
CREATE POLICY "service_role_write" ON reprocessing_logs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE reprocessing_logs IS 'Logs for each batch processed during 2.39M reprocessing pipeline';
