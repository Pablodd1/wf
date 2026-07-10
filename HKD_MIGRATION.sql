-- WatchFacts HKD Migration - Complete SQL Script
-- Run this in Supabase Dashboard → SQL Editor

-- ============================================================================
-- PHASE 1: DRY RUN - Preview what will change
-- ============================================================================

-- 1A. Count affected records
SELECT 
    'DRY RUN SUMMARY' as phase,
    COUNT(*) as total_hkd_records,
    COUNT(CASE WHEN currency = 'USD' THEN 1 END) as currently_usd,
    COUNT(CASE WHEN currency IS NULL THEN 1 END) as currency_null,
    ROUND(MIN(price_usd), 2) as min_price_before,
    ROUND(MAX(price_usd), 2) as max_price_before,
    ROUND(AVG(price_usd), 2) as avg_price_before
FROM watch_records
WHERE raw_message ILIKE '%HKD%'
  AND price_usd > 0;

-- 1B. Sample records showing before/after
SELECT 
    'SAMPLE CORRECTIONS' as phase,
    id,
    reference,
    brand,
    ROUND(price_usd, 2) as price_before,
    ROUND(price_usd * 7.84, 2) as price_after,
    ROUND(price_usd / 0.128, 0) as implied_hkd_wrong,
    ROUND(price_usd * 7.84 / 0.128, 0) as implied_hkd_correct,
    currency as currency_before,
    'HKD' as currency_after,
    LEFT(raw_message, 80) as message_preview
FROM watch_records
WHERE raw_message ILIKE '%HKD%'
  AND price_usd > 0
ORDER BY created_at DESC
LIMIT 15;

-- ============================================================================
-- PHASE 2: EXECUTE MIGRATION (Uncomment to run)
-- ============================================================================

-- 2A. Backup current state (creates a snapshot table)
-- CREATE TABLE watch_records_backup_20260710 AS
-- SELECT * FROM watch_records WHERE raw_message ILIKE '%HKD%';

-- 2B. Apply the correction
-- UPDATE watch_records
-- SET 
--     price_usd = ROUND(price_usd * 7.84, 2),
--     currency = 'HKD',
--     updated_at = NOW()
-- WHERE raw_message ILIKE '%HKD%'
--   AND price_usd > 0;

-- ============================================================================
-- PHASE 3: VERIFY MIGRATION (Uncomment after running 2B)
-- ============================================================================

-- 3A. Verify counts and averages
-- SELECT 
--     'POST-MIGRATION VERIFICATION' as phase,
--     COUNT(*) as total_hkd_records,
--     COUNT(CASE WHEN currency = 'HKD' THEN 1 END) as now_hkd,
--     COUNT(CASE WHEN updated_at > NOW() - INTERVAL '10 minutes' THEN 1 END) as recently_updated,
--     ROUND(MIN(price_usd), 2) as min_price_after,
--     ROUND(MAX(price_usd), 2) as max_price_after,
--     ROUND(AVG(price_usd), 2) as avg_price_after
-- FROM watch_records
-- WHERE raw_message ILIKE '%HKD%'
--   AND price_usd > 0;

-- 3B. Verify sample records
-- SELECT 
--     'VERIFIED CORRECTIONS' as phase,
--     id,
--     reference,
--     brand,
--     ROUND(price_usd, 2) as corrected_price_usd,
--     ROUND(price_usd / 0.128, 0) as hkd_amount,
--     currency,
--     updated_at
-- FROM watch_records
-- WHERE currency = 'HKD'
--   AND updated_at > NOW() - INTERVAL '10 minutes'
-- ORDER BY updated_at DESC
-- LIMIT 15;

-- ============================================================================
-- ROLLBACK (If something went wrong)
-- ============================================================================

-- Restore from backup
-- UPDATE watch_records w
-- SET 
--     price_usd = b.price_usd,
--     currency = b.currency,
--     updated_at = b.updated_at
-- FROM watch_records_backup_20260710 b
-- WHERE w.id = b.id;

-- Drop backup table
-- DROP TABLE watch_records_backup_20260710;
