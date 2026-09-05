-- Reconciled from the migration already applied in production on 2026-06-29.
-- This file restores repository history; it must not be replayed against the
-- production database.

-- Create reference_images table for catalog + brand CDN images
CREATE TABLE IF NOT EXISTS reference_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  dial_color TEXT,
  image_url TEXT NOT NULL,
  image_source TEXT NOT NULL DEFAULT 'catalog',
  is_primary BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(reference, image_url)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_reference_images_ref ON reference_images(reference);
CREATE INDEX IF NOT EXISTS idx_reference_images_brand ON reference_images(brand);
CREATE INDEX IF NOT EXISTS idx_reference_images_primary ON reference_images
  (reference, is_primary) WHERE is_primary = true;

-- Add image columns to watch_records for per-listing images
ALTER TABLE watch_records
  ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS has_images BOOLEAN DEFAULT false;

-- Index for fast filtering by image presence
CREATE INDEX IF NOT EXISTS idx_watch_records_has_images ON watch_records
  (has_images) WHERE has_images = true;

-- Grant SELECT to anon/authenticated roles for public reads
GRANT SELECT ON reference_images TO anon, authenticated;

CREATE POLICY "Public can read reference_images" ON reference_images
  FOR SELECT USING (true);
