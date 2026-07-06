-- Supabase migration: add dealer_photos column to watch_records
-- Run via Supabase SQL Editor or local migration tool
--
-- image_urls -> catalog stock photos (existing, populated from catalog-matcher)
-- dealer_photos -> actual dealer-sent WhatsApp images (separate column, populated from webhooks)
-- This separation is intentional so the vision-assist tier can distinguish the two.

ALTER TABLE watch_records ADD COLUMN IF NOT EXISTS dealer_photos jsonb DEFAULT '[]'::jsonb;
