-- Run this in Supabase SQL Editor
-- https://app.supabase.com/project/bptrvfncppbjnchsaxtb/sql

ALTER TABLE watch_records 
  ADD COLUMN IF NOT EXISTS review_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS listing_type text DEFAULT 'WTS',
  ADD COLUMN IF NOT EXISTS confidence integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parser_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS human_edited boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dealer_photos jsonb DEFAULT '[]'::jsonb;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'watch_records'
ORDER BY ordinal_position;
