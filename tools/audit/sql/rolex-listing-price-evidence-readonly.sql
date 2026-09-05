WITH control AS MATERIALIZED (
  SELECT enabled_run_key FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand='__BRAND__' AND price_research_enabled
), eligible AS MATERIALIZED (
  SELECT p.*
  FROM staging.listings p
  JOIN control c ON c.enabled_run_key=p.normalization_run_key
  JOIN staging.mariadb_normalization_import_checkpoints checkpoint ON checkpoint.run_key=p.normalization_run_key
  WHERE p.brand_normalized='__BRAND__' AND checkpoint.status='NORMALIZATION_STAGED' AND checkpoint.error_rows=0
    AND upper(COALESCE(p.category,''))='WATCH' AND p.parent_id IS NULL AND COALESCE(p.is_bundle,false)=false
    AND upper(COALESCE(p.listing_type,p.intent,''))='WTS'
    AND COALESCE(p.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
    AND p.raw_message_version_id IS NOT NULL AND COALESCE(p.source_record_id,'')<>''
    AND p.source_hash~'^[0-9a-f]{64}$' AND p.source_candidate_hash~'^[0-9a-f]{64}$'
    AND lower(COALESCE(p.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(p.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
    AND lower(COALESCE(p.price_research_status,''))<>'suppressed_exact_duplicate'
    AND upper(COALESCE(p.publication_review_status,'PENDING_REVIEW')) IN ('PENDING_REVIEW','APPROVED','READY_FOR_PUBLICATION_REVIEW')
    AND COALESCE(p.price_usd,0)>0 AND COALESCE(p.price_normalized,0)>0
    AND regexp_replace(upper(p.raw_message_text),'[^A-Z0-9]','','g') LIKE
      '%'||regexp_replace(upper(p.reference_normalized),'[^A-Z0-9]','','g')||'%'
    AND (
      (p.currency_normalized IN ('USD','USDT') AND p.currency_evidence IN ('explicit_line_currency','section_context','source_record_currency') AND p.price_usd=p.price_normalized)
      OR (p.currency_normalized NOT IN ('USD','USDT') AND p.currency_normalized IS NOT NULL
        AND p.currency_evidence IN ('explicit_line_currency','section_context','source_record_currency')
        AND COALESCE(p.conversion_rate,0)>0 AND p.conversion_timestamp IS NOT NULL)
    )
    AND regexp_replace(upper(btrim(p.reference_normalized)), '[^A-Z0-9]', '', 'g') IN (__CANONICAL_KEYS__)
    AND p.id>='__LOW__'::uuid __HIGH_CONDITION__
), rows AS MATERIALIZED (
  SELECT
    p.id::text AS listing_id,
    btrim(p.reference_normalized) AS reference,
    NULLIF(btrim(p.dial_color_normalized),'') AS dial,
    NULLIF(btrim(p.condition_normalized),'') AS condition,
    p.price_usd,
    CASE
      WHEN NULLIF(regexp_replace(COALESCE(p.contact_number,p.from_number,''),'[^0-9]','','g'),'') IS NOT NULL THEN 'P:'||md5(regexp_replace(COALESCE(p.contact_number,p.from_number),'[^0-9]','','g'))
      WHEN NULLIF(btrim(COALESCE(p.raw_message_text,'')),'') IS NOT NULL THEN 'M:'||md5(upper(regexp_replace(btrim(p.raw_message_text),'[[:space:]]+',' ','g')))
      ELSE 'R:'||p.id::text
    END || '|' || regexp_replace(upper(COALESCE(p.brand_normalized,'')),'[^A-Z0-9]','','g')
      || '|' || regexp_replace(upper(COALESCE(p.reference_normalized,'')),'[^A-Z0-9]','','g')
      || '|' || regexp_replace(upper(COALESCE(p.dial_color_normalized,'')),'[^A-Z0-9]','','g')
      || '|' || regexp_replace(upper(COALESCE(p.condition_normalized,'')),'[^A-Z0-9]','','g')
      || '|' || round(COALESCE(p.price_usd,0))::text AS dedup_key
  FROM eligible p
)
SELECT jsonb_build_object(
  'contract','__CONTRACT_PREFIX__-price-evidence-v1',
  'project_ref','qnsafosakvonzgfcsphh','read_only',true,
  'transaction_read_only',current_setting('transaction_read_only'),
  'shard',__SHARD__,
  'rows',COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.listing_id),'[]'::jsonb)
) AS audit FROM rows r;
