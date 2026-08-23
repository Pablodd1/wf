WITH rows AS MATERIALIZED (
  SELECT w.*
  FROM public.reviewed_workbook_inventory w
  WHERE w.brand_scope='__BRAND__'
    AND w.verification_tier='QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1'
    AND w.verification_status='APPROVED_SINGLE_CANDIDATE'
    AND w.confidence=100
    AND w.source_message_id IS NOT NULL
    AND regexp_replace(upper(btrim(w.normalized_reference)), '[^A-Z0-9]', '', 'g') IN (__CANONICAL_KEYS__)
), safe_rows AS (
  SELECT
    r.id::text AS listing_id,
    r.source_record_id,
    'reviewed_overlay'::text AS source_lane,
    btrim(r.normalized_reference) AS reference,
    COALESCE(NULLIF(btrim(r.model),''),NULLIF(btrim(r.catalog_model),'')) AS model,
    NULLIF(btrim(r.dial_color),'') AS dial,
    upper(COALESCE(r.listing_type,'')) AS listing_type,
    r.posting_date AS posted_at,
    CASE
      WHEN r.price_evidence_status='SOURCE_EXPLICIT_USD_MATCH' AND COALESCE(r.workbook_price_usd,0)>0 THEN r.workbook_price_usd
      WHEN r.price_evidence_status IN ('OWNER_ASSUMED_USD','OWNER_ASSUMED_USD_CANDIDATE','OWNER_DOLLAR_USD_POLICY','OWNER_K_USD_POLICY')
        AND upper(COALESCE(r.listing_type,''))='WTS'
        AND COALESCE(r.workbook_price_usd,r.source_price_amount,0)>0
        AND NOT (round(COALESCE(r.workbook_price_usd,r.source_price_amount)) BETWEEN 1900 AND extract(year from now())+2)
        THEN COALESCE(r.workbook_price_usd,r.source_price_amount)
      ELSE NULL
    END AS price_usd,
    NULLIF(btrim(r.source_currency),'') AS original_currency,
    (NULLIF(btrim(COALESCE(r.posted_by,'')),'') IS NOT NULL) AS has_posted_user,
    NULL::boolean AS has_location,
    (r.has_image=true AND btrim(COALESCE(r.user_image_url,''))~*'^https?://[^[:space:]]+$') AS has_valid_image,
    CASE
      WHEN NULLIF(btrim(r.raw_message),'') IS NULL THEN 'missing'
      WHEN r.source_file~*'[.]xlsx$' AND regexp_replace(btrim(r.raw_message),'[[:space:]]+',' ','g') IN (
        concat_ws(' ',upper(COALESCE(r.listing_type,'OTHER')),COALESCE(r.supplied_brand,r.canonical_brand,r.brand_scope),r.normalized_reference,r.dial_color),
        concat_ws(' ',upper(COALESCE(r.listing_type,'OTHER')),COALESCE(r.supplied_brand,r.canonical_brand,r.brand_scope),r.normalized_reference,r.dial_color,COALESCE(r.source_price_amount,r.workbook_price_usd)::text)
      ) THEN 'normalized_summary'
      WHEN btrim(r.raw_message)~*'^https?://[^[:space:]]+$' THEN 'url_only'
      WHEN btrim(COALESCE(r.user_image_url,''))<>'' AND position(btrim(r.user_image_url) in r.raw_message)>0 THEN 'contains_image_url'
      WHEN r.raw_message~*'https?://[^[:space:]]+' THEN 'contains_other_url'
      ELSE 'source_text'
    END AS raw_message_state,
    dealer.dealer_id::text AS dealer_id,
    COALESCE(NULLIF(btrim(d.display_name),''),NULLIF(btrim(d.company_name),'')) AS dealer_name,
    (dealer.dealer_id IS NOT NULL) AS has_exact_dealer_link,
    (COALESCE(d.rating,0)>0 AND COALESCE(d.review_count,0)>0) AS has_dealer_rating,
    (NULLIF(btrim(r.normalized_reference),'') IS NOT NULL
      AND COALESCE(NULLIF(btrim(r.model),''),NULLIF(btrim(r.catalog_model),'')) IS NOT NULL
      AND NULLIF(btrim(r.dial_color),'') IS NOT NULL) AS has_complete_watch_identity
  FROM rows r
  LEFT JOIN LATERAL (
    SELECT (array_agg(DISTINCT i.dealer_id ORDER BY i.dealer_id))[1] AS dealer_id
    FROM public.dealer_source_identities i
    WHERE i.verification_status='VERIFIED'
      AND upper(i.identity_type) IN ('PHONE','WHATSAPP')
      AND public.normalize_seller_phone_identity(i.source_identity)=public.normalize_seller_phone_identity(r.phone_number)
    HAVING count(DISTINCT i.dealer_id)=1
  ) dealer ON true
  LEFT JOIN public.dealers d ON d.id=dealer.dealer_id
)
SELECT jsonb_build_object(
  'contract','__CONTRACT_PREFIX__-completeness-overlay-v1',
  'project_ref','qnsafosakvonzgfcsphh','read_only',true,
  'transaction_read_only',current_setting('transaction_read_only'),
  'rows',COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.listing_id),'[]'::jsonb)
) AS audit FROM safe_rows s;
