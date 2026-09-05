-- corrections table — the permanent fix loop
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/bptrvfncppbjnchsaxtb/sql/new)
-- One-time setup. After this, /api/corrections POST/GET works immediately.

CREATE TABLE IF NOT EXISTS corrections (
  id BIGSERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  brand TEXT,
  reference TEXT,
  dial_color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  applied_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_corrections_pattern ON corrections(pattern);

-- Seed the first fix: "5236p" -> Patek Philippe Perpetual Calendar In-line 5236P-001
INSERT INTO corrections (pattern, brand, reference, dial_color)
VALUES ('5236p', 'Patek Philippe', '5236P-001', 'Grey');
