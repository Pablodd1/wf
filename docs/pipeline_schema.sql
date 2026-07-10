-- Pipeline Schema: Batch Processing & Review Workflow
-- Phase 2: Human Review Interface

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Batches table
CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  filter_criteria JSONB,
  batch_size INTEGER NOT NULL DEFAULT 100,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  processed_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0
);

-- Normalized records table
CREATE TABLE IF NOT EXISTS normalized_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  source_record_id UUID,
  raw_message TEXT,
  reference TEXT,
  brand TEXT,
  price_usd NUMERIC(12, 2),
  currency TEXT,
  year INTEGER,
  condition TEXT,
  dial_color TEXT,
  verdict TEXT,
  confidence_score NUMERIC(3, 2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending', 'passed', 'flagged', 'failed')),
  validation_results JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Review log table
CREATE TABLE IF NOT EXISTS review_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_id UUID REFERENCES normalized_records(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  filter TEXT,
  records_affected INTEGER,
  notes TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_normalized_records_batch_id ON normalized_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_normalized_records_status ON normalized_records(status);
CREATE INDEX IF NOT EXISTS idx_normalized_records_validation_status ON normalized_records(validation_status);
CREATE INDEX IF NOT EXISTS idx_normalized_records_reference ON normalized_records(reference);
CREATE INDEX IF NOT EXISTS idx_normalized_records_brand ON normalized_records(brand);
CREATE INDEX IF NOT EXISTS idx_normalized_records_created_at ON normalized_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_log_record_id ON review_log(record_id);
CREATE INDEX IF NOT EXISTS idx_review_log_batch_id ON review_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_review_log_reviewed_at ON review_log(reviewed_at DESC);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_normalized_records_updated_at
  BEFORE UPDATE ON normalized_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Materialized view for batch statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_batch_statistics AS
SELECT 
  b.id as batch_id,
  b.name,
  b.status,
  b.created_at,
  b.started_at,
  b.completed_at,
  b.batch_size,
  b.priority,
  COUNT(nr.id) as total_records,
  COUNT(CASE WHEN nr.status = 'APPROVED' THEN 1 END) as approved_count,
  COUNT(CASE WHEN nr.status = 'REJECTED' THEN 1 END) as rejected_count,
  COUNT(CASE WHEN nr.status = 'PENDING' THEN 1 END) as pending_count,
  AVG(nr.confidence_score) as avg_confidence,
  COUNT(CASE WHEN nr.validation_status = 'passed' THEN 1 END) as validation_passed,
  COUNT(CASE WHEN nr.validation_status = 'flagged' THEN 1 END) as validation_flagged,
  COUNT(CASE WHEN nr.validation_status = 'failed' THEN 1 END) as validation_failed
FROM batches b
LEFT JOIN normalized_records nr ON nr.batch_id = b.id
GROUP BY b.id, b.name, b.status, b.created_at, b.started_at, b.completed_at, b.batch_size, b.priority;

-- Create unique index for refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_batch_statistics_batch_id ON mv_batch_statistics(batch_id);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_batch_statistics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_batch_statistics;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE batches IS 'Batch processing jobs for normalization pipeline';
COMMENT ON TABLE normalized_records IS 'Individual normalized and validated records';
COMMENT ON TABLE review_log IS 'Audit log for all review actions';
COMMENT ON TABLE mv_batch_statistics IS 'Materialized view for batch dashboard statistics';

COMMENT ON COLUMN batches.filter_criteria IS 'JSON object with filtering rules (reference, brand, verdict, etc.)';
COMMENT ON COLUMN batches.priority IS 'Processing priority: 1 (highest) to 10 (lowest)';
COMMENT ON COLUMN normalized_records.confidence_score IS 'Validation confidence: 0.0 to 1.0';
COMMENT ON COLUMN normalized_records.validation_status IS 'Result of validation: pending, passed, flagged, failed';
COMMENT ON COLUMN normalized_records.status IS 'Review status: PENDING, APPROVED, REJECTED';
