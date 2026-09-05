-- Dealer region + rating update for WatchFacts
-- Run in Supabase SQL Editor at https://supabase.com/dashboard/project/bptrvfncppbjnchsaxtb

UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 22, "competitor_profile_id": "916"}'::jsonb WHERE seller_name ILIKE '%Federico Maman%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 18, "competitor_profile_id": "3435"}'::jsonb WHERE seller_name ILIKE '%Jaztime Watches%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 16, "competitor_profile_id": "1031"}'::jsonb WHERE seller_name ILIKE '%Zack%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 14, "competitor_profile_id": "2074"}'::jsonb WHERE seller_name ILIKE '%Ian Mottale%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 13, "competitor_profile_id": "706"}'::jsonb WHERE seller_name ILIKE '%Member 2768%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 13, "competitor_profile_id": "2080"}'::jsonb WHERE seller_name ILIKE '%Kevin Chan%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 12, "competitor_profile_id": "7303"}'::jsonb WHERE seller_name ILIKE '%Jorge C Pica%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 11, "competitor_profile_id": "7504"}'::jsonb WHERE seller_name ILIKE '%Ahmed%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 11, "competitor_profile_id": "16227"}'::jsonb WHERE seller_name ILIKE '%Ian Ricardo Durazo%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 11, "competitor_profile_id": "1882"}'::jsonb WHERE seller_name ILIKE '%Pablo%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 11, "competitor_profile_id": "7923"}'::jsonb WHERE seller_name ILIKE '%Malcom Gunter%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 11, "competitor_profile_id": "2937"}'::jsonb WHERE seller_name ILIKE '%ZM%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 10, "competitor_profile_id": "4167"}'::jsonb WHERE seller_name ILIKE '%Miguel Rodriguez%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 10, "competitor_profile_id": "2956"}'::jsonb WHERE seller_name ILIKE '%darwin vartan%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 10, "competitor_profile_id": "3919"}'::jsonb WHERE seller_name ILIKE '%Christian Navarro%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 10, "competitor_profile_id": "1891"}'::jsonb WHERE seller_name ILIKE '%Vin Bonetawholesalecom%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 9, "competitor_profile_id": "922"}'::jsonb WHERE seller_name ILIKE '%Greg Lamuse%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 9, "competitor_profile_id": "518"}'::jsonb WHERE seller_name ILIKE '%john cormier%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 9, "competitor_profile_id": "995"}'::jsonb WHERE seller_name ILIKE '%Daniel Concepcion%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 8, "competitor_profile_id": "512"}'::jsonb WHERE seller_name ILIKE '%Ilya Vipawn%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 8, "competitor_profile_id": "5884"}'::jsonb WHERE seller_name ILIKE '%The Dial Society%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 8, "competitor_profile_id": "493"}'::jsonb WHERE seller_name ILIKE '%Ariel N%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 8, "competitor_profile_id": "1028"}'::jsonb WHERE seller_name ILIKE '%Jeffrey%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 8, "competitor_profile_id": "4015"}'::jsonb WHERE seller_name ILIKE '%jonathan shimunov%' AND region IS NULL;
UPDATE watch_records SET region = 'North America', flags = flags || '{"competitor_rating": 7, "competitor_profile_id": "6339"}'::jsonb WHERE seller_name ILIKE '%Sebastien Page%' AND region IS NULL;

-- Verify
SELECT count(*) AS records_with_region FROM watch_records WHERE region IS NOT NULL;
SELECT region, count(*) FROM watch_records WHERE region IS NOT NULL GROUP BY region ORDER BY count(*) DESC;
