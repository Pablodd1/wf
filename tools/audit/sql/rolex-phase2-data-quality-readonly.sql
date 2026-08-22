WITH control AS MATERIALIZED (
  SELECT enabled_run_key FROM public.qnsa_two_brand_release_control WHERE canonical_brand='Rolex'
), rows AS MATERIALIZED (
  SELECT l.id,l.currency_original,l.currency_normalized,l.price_normalized,l.price_usd,
    l.conversion_rate,l.conversion_timestamp,l.raw_message_text
  FROM staging.listings l JOIN control c ON c.enabled_run_key=l.normalization_run_key
  WHERE l.brand_normalized='Rolex'
), currencies AS MATERIALIZED (
  SELECT COALESCE(NULLIF(upper(btrim(currency_original)),''),'MISSING') currency,count(*) count
  FROM rows GROUP BY 1 ORDER BY 2 DESC,1
)
SELECT jsonb_build_object(
  'contract','watchfacts-rolex-phase2-data-quality-v1','project_ref','qnsafosakvonzgfcsphh','read_only',true,
  'transaction_read_only',current_setting('transaction_read_only'),'generated_at',now(),
  'counts',jsonb_build_object(
    'bare_dollar_rows_normalized_as_usd_without_usd_usdt_token',(SELECT count(*) FROM rows WHERE raw_message_text ~ '[$]' AND raw_message_text !~* '(^|[^A-Z0-9])(USD|USDT)([^A-Z0-9]|$)' AND currency_normalized='USD' AND COALESCE(price_usd,0)>0),
    'raw_hkd_rows_normalized_as_usd',(SELECT count(*) FROM rows WHERE raw_message_text ~* '(^|[^A-Z0-9])HKD([^A-Z0-9]|$)' AND currency_normalized='USD'),
    'named_foreign_currency_rows_normalized_as_usd',(SELECT count(*) FROM rows WHERE raw_message_text ~* '(^|[^A-Z0-9])(HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)([^A-Z0-9]|$)' AND currency_normalized='USD'),
    'foreign_currency_rows_missing_verified_fx',(SELECT count(*) FROM rows WHERE currency_normalized IS NOT NULL AND currency_normalized NOT IN ('USD','USDT') AND COALESCE(price_normalized,0)>0 AND (COALESCE(conversion_rate,0)<=0 OR conversion_timestamp IS NULL OR COALESCE(price_usd,0)<=0))
  ),
  'counts_by_original_currency',(SELECT COALESCE(jsonb_agg(jsonb_build_object('currency',currency,'count',count)),'[]'::jsonb) FROM currencies)
) AS data_quality;
