WITH rows AS MATERIALIZED (
  SELECT
    p.id::text AS listing_id,
    btrim(p.reference) AS reference,
    NULLIF(btrim(p.dial_color),'') AS dial,
    NULLIF(btrim(p.condition),'') AS condition,
    p.price_usd,
    CASE
      WHEN NULLIF(btrim(COALESCE(p.dealer_id::text,'')),'') IS NOT NULL THEN 'D:'||md5(upper(regexp_replace(p.dealer_id::text,'[^A-Z0-9]','','g')))
      WHEN NULLIF(regexp_replace(COALESCE(p.seller_phone,''),'[^0-9]','','g'),'') IS NOT NULL THEN 'P:'||md5(regexp_replace(p.seller_phone,'[^0-9]','','g'))
      WHEN NULLIF(btrim(COALESCE(p.raw_message,'')),'') IS NOT NULL THEN 'M:'||md5(upper(regexp_replace(btrim(p.raw_message),'[[:space:]]+',' ','g')))
      ELSE 'R:'||p.id::text
    END || '|' || regexp_replace(upper(COALESCE(p.brand,'')),'[^A-Z0-9]','','g')
      || '|' || regexp_replace(upper(COALESCE(p.reference,'')),'[^A-Z0-9]','','g')
      || '|' || regexp_replace(upper(COALESCE(p.dial_color,'')),'[^A-Z0-9]','','g')
      || '|' || regexp_replace(upper(COALESCE(p.condition,'')),'[^A-Z0-9]','','g')
      || '|' || round(COALESCE(p.price_usd,0))::text AS dedup_key
  FROM public.qnsa_rolex_patek_price_research_source p
  WHERE upper(p.brand)='ROLEX'
    AND regexp_replace(upper(btrim(p.reference)), '[^A-Z0-9]', '', 'g') IN (__CANONICAL_KEYS__)
    AND p.id::uuid>='__LOW__'::uuid __HIGH_CONDITION__
)
SELECT jsonb_build_object(
  'contract','watchfacts-rolex-listing-price-evidence-v1',
  'project_ref','qnsafosakvonzgfcsphh','read_only',true,
  'transaction_read_only',current_setting('transaction_read_only'),
  'shard',__SHARD__,
  'rows',COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.listing_id),'[]'::jsonb)
) AS audit FROM rows r;
