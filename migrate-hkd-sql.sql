-- HKD Exchange Rate Correction Migration
-- Fixes records where HKD was divided by 7.84 instead of multiplied by 0.128
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)

-- Step 1: Preview the changes (DRY RUN)
SELECT 
    COUNT(*) as total_records,
    MIN(price_usd) as min_price,
    MAX(price_usd) as max_price,
    AVG(price_usd) as avg_price
FROM watch_records
WHERE raw_message ILIKE '%HKD%'
  AND price_usd > 0;

-- Step 2: Show sample records before correction
SELECT 
    id,
    reference,
    price_usd,
    ROUND(price_usd * 7.84) as corrected_price_usd,
    ROUND((price_usd * 7.84) / 0.128) as implied_hkd_amount,
    raw_message
FROM watch_records
WHERE raw_message ILIKE '%HKD%'
  AND price_usd > 0
ORDER BY created_at DESC
LIMIT 20;

-- Step 3: Apply the correction (UNCOMMENT TO RUN)
-- UPDATE watch_records
-- SET 
--     price_usd = ROUND(price_usd * 7.84),
--     currency = 'HKD',
--     updated_at = NOW()
-- WHERE raw_message ILIKE '%HKD%'
--   AND price_usd > 0;

-- Step 4: Verify the correction
-- SELECT 
--     COUNT(*) as total_corrected,
--     MIN(price_usd) as min_price_after,
--     MAX(price_usd) as max_price_after,
--     AVG(price_usd) as avg_price_after
-- FROM watch_records
-- WHERE currency = 'HKD'
--   AND updated_at > NOW() - INTERVAL '5 minutes';
