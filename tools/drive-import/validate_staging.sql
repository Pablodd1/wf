-- Run after the Drive/GCS staging import. These are read-only checks.

-- 1. Import completion and exact staged count.
SELECT *
FROM staging.drive_import_runs
ORDER BY updated_at DESC;

SELECT source_file_id, count(*) AS staged_rows,
       min(source_row_number) AS first_row,
       max(source_row_number) AS last_row
FROM staging.drive_watch_records
GROUP BY source_file_id;

-- 2. Duplicate source IDs that represent different CSV rows.
SELECT source_record_id, count(*) AS occurrences,
       count(DISTINCT row_sha256) AS distinct_payloads
FROM staging.drive_watch_records
WHERE source_record_id IS NOT NULL
GROUP BY source_record_id
HAVING count(*) > 1
ORDER BY occurrences DESC
LIMIT 100;

-- 3. Missing commercial/identity fields.
SELECT
  count(*) FILTER (WHERE NULLIF(brand_claimed, '') IS NULL) AS missing_brand,
  count(*) FILTER (WHERE NULLIF(reference_claimed, '') IS NULL) AS missing_reference,
  count(*) FILTER (WHERE NULLIF(currency_claimed, '') IS NULL) AS missing_currency,
  count(*) FILTER (WHERE NULLIF(price_raw_claimed, '') IS NULL) AS missing_original_price,
  count(*) FILTER (WHERE NULLIF(price_usd_claimed, '') IS NULL) AS missing_usd_price
FROM staging.drive_watch_records;

-- 4. Prices that cannot safely be promoted to numeric fields.
SELECT source_row_number, source_record_id, reference_claimed,
       price_raw_claimed, price_usd_claimed, currency_claimed
FROM staging.drive_watch_records
WHERE (NULLIF(price_raw_claimed, '') IS NOT NULL
       AND price_raw_claimed !~ '^[-+]?[0-9]+([.][0-9]+)?$')
   OR (NULLIF(price_usd_claimed, '') IS NOT NULL
       AND price_usd_claimed !~ '^[-+]?[0-9]+([.][0-9]+)?$')
ORDER BY source_row_number
LIMIT 500;

-- 5. Likely multi-watch messages collapsed into one normalized row.
SELECT source_row_number, source_record_id, brand_claimed,
       reference_claimed, left(raw_message, 500) AS raw_excerpt
FROM staging.drive_watch_records
WHERE raw_message ~ '(?m)(^|\n).{0,20}[0-9]{4,6}[A-Z0-9/.-]*.{0,80}\n.*[0-9]{4,6}[A-Z0-9/.-]*'
ORDER BY source_row_number
LIMIT 500;

-- 6. Strong examples of price/reference confusion.
SELECT source_row_number, source_record_id, brand_claimed,
       reference_claimed, price_raw_claimed, price_usd_claimed,
       left(raw_message, 300) AS raw_excerpt
FROM staging.drive_watch_records
WHERE reference_claimed ~ '^[0-9]{5,7}$'
  AND raw_message ILIKE '%' || reference_claimed || '%'
  AND raw_message ~ '[$€£]|HKD|USD|USDT'
ORDER BY source_row_number
LIMIT 500;

-- 7. Reconciliation against current live rows by stable ID. No updates.
SELECT
  count(*) AS matched_ids,
  count(*) FILTER (WHERE w.brand IS DISTINCT FROM s.brand_claimed) AS brand_differences,
  count(*) FILTER (WHERE w.reference IS DISTINCT FROM s.reference_claimed) AS reference_differences,
  count(*) FILTER (WHERE w.currency IS DISTINCT FROM s.currency_claimed) AS currency_differences,
  count(*) FILTER (WHERE w.price_raw::text IS DISTINCT FROM NULLIF(s.price_raw_claimed, '')) AS raw_price_differences,
  count(*) FILTER (WHERE w.price_usd::text IS DISTINCT FROM NULLIF(s.price_usd_claimed, '')) AS usd_price_differences
FROM staging.drive_watch_records s
JOIN public.watch_records w ON w.id = s.source_record_id;

-- 8. Deterministic random audit sample.
SELECT source_row_number, source_record_id, raw_row
FROM staging.drive_watch_records
WHERE mod(abs(hashtext(row_sha256)), 10000) = 0
ORDER BY source_row_number
LIMIT 250;
