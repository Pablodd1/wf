-- WatchFacts preview-branch baseline
-- The production table was originally created outside version-controlled
-- migrations. Supabase Preview branches are data-less and need this baseline
-- before inherited ALTER TABLE migrations can run.

CREATE TABLE IF NOT EXISTS public.watch_records (
  id TEXT PRIMARY KEY,
  brand TEXT,
  reference TEXT,
  dial_color TEXT,
  condition TEXT,
  year INTEGER,
  price_raw NUMERIC,
  price_usd NUMERIC,
  currency TEXT,
  confidence INTEGER,
  verdict TEXT,
  source TEXT,
  raw_message TEXT,
  flags JSONB DEFAULT '[]'::jsonb,
  reprocessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  parser_version TEXT DEFAULT 'v1',
  listing_type TEXT,
  accessories JSONB,
  month_code TEXT,
  field_confidence JSONB,
  human_edited BOOLEAN DEFAULT false,
  edit_source TEXT,
  image_urls JSONB DEFAULT '[]'::jsonb,
  thumbnail_url TEXT,
  has_images BOOLEAN DEFAULT false,
  review_reason TEXT,
  dealer_photos JSONB DEFAULT '[]'::jsonb,
  seller_name TEXT,
  seller_phone TEXT,
  region TEXT,
  source_type TEXT,
  listing_date TEXT,
  listing_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_watch_records_created_at
  ON public.watch_records (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_watch_records_listing_type
  ON public.watch_records (listing_type);

CREATE INDEX IF NOT EXISTS idx_watch_records_reference
  ON public.watch_records (reference);

CREATE INDEX IF NOT EXISTS idx_watch_records_brand
  ON public.watch_records (brand);
