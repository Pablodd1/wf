WITH control AS MATERIALIZED (
  SELECT enabled_run_key FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand='Rolex' AND trading_floor_enabled
), eligible AS MATERIALIZED (
  SELECT l.id,l.raw_message_version_id,l.source_record_id,l.source_hash,l.dealer_rating,l.rating
  FROM staging.listings l JOIN control c ON c.enabled_run_key=l.normalization_run_key
  JOIN staging.mariadb_normalization_import_checkpoints checkpoint ON checkpoint.run_key=l.normalization_run_key
  WHERE l.brand_normalized='Rolex' AND checkpoint.status='NORMALIZATION_STAGED' AND checkpoint.error_rows=0
    AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
    AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
    AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
    AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id,'')<>''
    AND l.source_hash~'^[0-9a-f]{64}$' AND l.source_candidate_hash~'^[0-9a-f]{64}$'
    AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
    AND lower(COALESCE(l.price_research_status,''))<>'suppressed_exact_duplicate'
    AND upper(COALESCE(l.publication_review_status,'PENDING_REVIEW')) IN ('PENDING_REVIEW','APPROVED','READY_FOR_PUBLICATION_REVIEW')
    AND abs(mod(hashtextextended(l.id::text,0),8))=__SHARD__
)
SELECT jsonb_build_object(
  'contract','watchfacts-rolex-phase2-rating-v1','project_ref','qnsafosakvonzgfcsphh',
  'read_only',true,'transaction_read_only',current_setting('transaction_read_only'),'shard',__SHARD__,
  'counts',jsonb_build_object(
    'eligible_listings_with_source_backed_rating',count(*) FILTER (WHERE COALESCE(e.dealer_rating,e.rating,
      CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}','')~'^[0-9]+([.][0-9]+)?$'
        THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END) IS NOT NULL),
    'eligible_listings_without_source_backed_rating',count(*) FILTER (WHERE COALESCE(e.dealer_rating,e.rating,
      CASE WHEN COALESCE(rv.raw_payload#>>'{raw_data,dealer_rating}','')~'^[0-9]+([.][0-9]+)?$'
        THEN (rv.raw_payload#>>'{raw_data,dealer_rating}')::numeric END) IS NULL)
  )
) AS rating
FROM eligible e JOIN public.raw_message_versions rv ON rv.id=e.raw_message_version_id
  AND rv.source_record_id=e.source_record_id AND rv.source_hash=e.source_hash;
