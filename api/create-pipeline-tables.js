/**
 * One-shot endpoint to create pipeline tables in Supabase.
 * DELETE after use — this is a migration helper.
 * 
 * GET /api/create-pipeline-tables
 */
const { Pool } = require('pg');

module.exports = async function handler(req, res) {
  const { DATABASE_URL } = process.env;
  
  if (!DATABASE_URL) {
    return res.status(500).json({ error: 'DATABASE_URL not set in environment' });
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    // Create all pipeline tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS raw_records (
        id              TEXT PRIMARY KEY,
        source_table    TEXT NOT NULL,
        source_db       TEXT NOT NULL,
        source_id       TEXT NOT NULL,
        raw_data        JSONB NOT NULL,
        raw_text        TEXT,
        metadata        JSONB,
        batch_number    INTEGER,
        status          TEXT DEFAULT 'RAW' CHECK (status IN ('RAW','NORMALIZING','NORMALIZED','ERROR','SKIPPED')),
        normalized_id   TEXT,
        error_message   TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_raw_source_table ON raw_records(source_table);
      CREATE INDEX IF NOT EXISTS idx_raw_status ON raw_records(status);
      CREATE INDEX IF NOT EXISTS idx_raw_batch ON raw_records(batch_number);
      CREATE INDEX IF NOT EXISTS idx_raw_source_id ON raw_records(source_db, source_table, source_id);

      ALTER TABLE raw_records ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        CREATE POLICY "service_role_bypass_raw_records" ON raw_records
          AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS normalized_records (
        id              TEXT PRIMARY KEY,
        raw_id          TEXT NOT NULL REFERENCES raw_records(id),
        brand           TEXT,
        reference       TEXT,
        normalized_ref  TEXT,
        model           TEXT,
        dial_color      TEXT,
        condition       TEXT,
        year            TEXT,
        price           NUMERIC,
        price_usd       NUMERIC,
        currency        TEXT,
        listing_type    TEXT CHECK (listing_type IN ('WTS','WTB','TRADE','UNKNOWN')),
        verdict         TEXT CHECK (verdict IN ('APPROVED','HUMAN','RECYCLE')),
        confidence      INTEGER,
        catalog_entry   JSONB,
        source_table    TEXT,
        batch_number    INTEGER,
        audit_status    TEXT DEFAULT 'PENDING' CHECK (audit_status IN ('PENDING','AUDITED','FLAGGED','APPROVED')),
        audit_notes     TEXT,
        audit_by        TEXT,
        audit_at        TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_norm_brand ON normalized_records(brand);
      CREATE INDEX IF NOT EXISTS idx_norm_ref ON normalized_records(reference);
      CREATE INDEX IF NOT EXISTS idx_norm_verdict ON normalized_records(verdict);
      CREATE INDEX IF NOT EXISTS idx_norm_audit ON normalized_records(audit_status);
      CREATE INDEX IF NOT EXISTS idx_norm_raw ON normalized_records(raw_id);
      CREATE INDEX IF NOT EXISTS idx_norm_batch ON normalized_records(batch_number);

      ALTER TABLE normalized_records ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        CREATE POLICY "service_role_bypass_normalized_records" ON normalized_records
          AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS migration_progress (
        id              SERIAL PRIMARY KEY,
        source_table    TEXT NOT NULL,
        phase           TEXT NOT NULL CHECK (phase IN ('RAW_COPY','NORMALIZE','AUDIT')),
        status          TEXT DEFAULT 'IN_PROGRESS' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','ERROR')),
        total_rows      INTEGER,
        processed_rows  INTEGER DEFAULT 0,
        error_rows      INTEGER DEFAULT 0,
        batch_number    INTEGER DEFAULT 0,
        started_at      TIMESTAMPTZ DEFAULT NOW(),
        completed_at    TIMESTAMPTZ,
        error_message   TEXT
      );

      ALTER TABLE migration_progress ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        CREATE POLICY "service_role_bypass_migration_progress" ON migration_progress
          AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS batch_queue (
        id              SERIAL PRIMARY KEY,
        source_table    TEXT NOT NULL,
        batch_number    INTEGER NOT NULL,
        start_offset    INTEGER,
        end_offset      INTEGER,
        status          TEXT DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','DONE','ERROR')),
        worker_id       TEXT,
        processed_count INTEGER DEFAULT 0,
        error_count     INTEGER DEFAULT 0,
        started_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_bq_status ON batch_queue(status);
      CREATE INDEX IF NOT EXISTS idx_bq_source ON batch_queue(source_table, batch_number);

      ALTER TABLE batch_queue ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        CREATE POLICY "service_role_bypass_batch_queue" ON batch_queue
          AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS audit_log (
        id              SERIAL PRIMARY KEY,
        normalized_id   TEXT REFERENCES normalized_records(id),
        batch_number    INTEGER,
        auditor         TEXT,
        status          TEXT CHECK (status IN ('PASSED','FLAGGED','CORRECTED','FAILED')),
        issue_type      TEXT,
        issue_detail    TEXT,
        suggestion      TEXT,
        resolved        BOOLEAN DEFAULT FALSE,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_batch ON audit_log(batch_number);
      CREATE INDEX IF NOT EXISTS idx_audit_norm ON audit_log(normalized_id);

      ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        CREATE POLICY "service_role_bypass_audit_log" ON audit_log
          AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Verify
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('raw_records','normalized_records','migration_progress','batch_queue','audit_log')
      ORDER BY table_name
    `);

    return res.json({
      ok: true,
      tables_created: rows.map(r => r.table_name),
      message: 'All pipeline tables created successfully.'
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, detail: e.stack?.split('\n').slice(0, 3) });
  } finally {
    await pool.end();
  }
};
