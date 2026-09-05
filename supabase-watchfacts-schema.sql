-- =============================================================
-- WatchFacts Supabase Schema
-- =============================================================

-- -------------------------------------------------------------
-- 1. watch_records
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_records (
  id               TEXT        PRIMARY KEY,
  brand            TEXT,
  reference        TEXT,
  dial_color       TEXT,
  condition        TEXT,
  year             INT,
  price_raw        NUMERIC,
  price_usd        NUMERIC,
  currency         TEXT,
  confidence       INT,
  verdict          TEXT        CHECK (verdict IN ('APPROVED', 'HUMAN', 'RECYCLE')),
  source           TEXT,
  raw_message      TEXT,
  flags            JSONB,
  reprocessed_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 2. live_ingest
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_ingest (
  id           TEXT        PRIMARY KEY,
  raw_message  TEXT,
  brand        TEXT,
  reference    TEXT,
  price_usd    NUMERIC,
  currency     TEXT,
  confidence   INT,
  verdict      TEXT,
  source       TEXT,
  channel_id   TEXT,
  received_at  TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 3. Indexes
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_watch_records_verdict   ON watch_records (verdict);
CREATE INDEX IF NOT EXISTS idx_watch_records_brand     ON watch_records (brand);
CREATE INDEX IF NOT EXISTS idx_watch_records_reference ON watch_records (reference);
CREATE INDEX IF NOT EXISTS idx_live_ingest_received_at ON live_ingest  (received_at);

-- -------------------------------------------------------------
-- 4. Row-Level Security
-- -------------------------------------------------------------

-- watch_records
ALTER TABLE watch_records ENABLE ROW LEVEL SECURITY;

-- Allow the service role to bypass RLS entirely (full CRUD)
CREATE POLICY "service_role_bypass_watch_records"
  ON watch_records
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- live_ingest
ALTER TABLE live_ingest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass_live_ingest"
  ON live_ingest
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -------------------------------------------------------------
-- 5. upsert_watch_records(records JSONB)
--    Accepts a JSON array of record objects and upserts them
--    into watch_records using INSERT … ON CONFLICT (id) DO UPDATE.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_watch_records(records JSONB)
RETURNS TABLE (upserted_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as the function owner (service role) to bypass RLS
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO watch_records (
    id,
    brand,
    reference,
    dial_color,
    condition,
    year,
    price_raw,
    price_usd,
    currency,
    confidence,
    verdict,
    source,
    raw_message,
    flags,
    reprocessed_at,
    created_at
  )
  SELECT
    (rec ->> 'id')::TEXT,
    (rec ->> 'brand')::TEXT,
    (rec ->> 'reference')::TEXT,
    (rec ->> 'dial_color')::TEXT,
    (rec ->> 'condition')::TEXT,
    (rec ->> 'year')::INT,
    (rec ->> 'price_raw')::NUMERIC,
    (rec ->> 'price_usd')::NUMERIC,
    (rec ->> 'currency')::TEXT,
    (rec ->> 'confidence')::INT,
    (rec ->> 'verdict')::TEXT,
    (rec ->> 'source')::TEXT,
    (rec ->> 'raw_message')::TEXT,
    (rec -> 'flags'),                           -- already JSONB
    (rec ->> 'reprocessed_at')::TIMESTAMPTZ,
    COALESCE((rec ->> 'created_at')::TIMESTAMPTZ, NOW())
  FROM jsonb_array_elements(records) AS rec
  ON CONFLICT (id) DO UPDATE SET
    brand          = EXCLUDED.brand,
    reference      = EXCLUDED.reference,
    dial_color     = EXCLUDED.dial_color,
    condition      = EXCLUDED.condition,
    year           = EXCLUDED.year,
    price_raw      = EXCLUDED.price_raw,
    price_usd      = EXCLUDED.price_usd,
    currency       = EXCLUDED.currency,
    confidence     = EXCLUDED.confidence,
    verdict        = EXCLUDED.verdict,
    source         = EXCLUDED.source,
    raw_message    = EXCLUDED.raw_message,
    flags          = EXCLUDED.flags,
    reprocessed_at = EXCLUDED.reprocessed_at
    -- created_at intentionally not overwritten on conflict
  RETURNING id;
END;
$$;
