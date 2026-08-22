WITH control AS MATERIALIZED (
  SELECT enabled_run_key FROM public.qnsa_two_brand_release_control
  WHERE canonical_brand='Rolex' AND trading_floor_enabled
), eligible AS MATERIALIZED (
  SELECT l.*
  FROM staging.listings l
  JOIN control c ON c.enabled_run_key=l.normalization_run_key
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
    AND regexp_replace(upper(btrim(l.reference_normalized)), '[^A-Z0-9]', '', 'g') IN (__CANONICAL_KEYS__)
    AND l.id>='__LOW__'::uuid __HIGH_CONDITION__
), safe_rows AS (
  SELECT
    e.id::text AS listing_id,
    e.source_record_id,
    'canonical_base'::text AS source_lane,
    btrim(e.reference_normalized) AS reference,
    NULLIF(btrim(e.model_normalized),'') AS model,
    NULLIF(btrim(e.dial_color_normalized),'') AS dial,
    upper(COALESCE(e.listing_type,e.intent,'')) AS listing_type,
    e.created_at AS posted_at,
    CASE WHEN COALESCE(e.price_usd,0)>0 THEN e.price_usd ELSE NULL END AS price_usd,
    NULLIF(btrim(e.currency_normalized),'') AS original_currency,
    (NULLIF(btrim(COALESCE(e.user_name,e.from_name,'')),'') IS NOT NULL) AS has_posted_user,
    (NULLIF(btrim(COALESCE(e.location,'')),'') IS NOT NULL) AS has_location,
    (btrim(COALESCE(e.image_url,e.source_media_url_candidate,''))~*'^https?://[^[:space:]]+$') AS has_valid_image,
    CASE
      WHEN NULLIF(btrim(e.raw_message_text),'') IS NULL THEN 'missing'
      WHEN btrim(e.raw_message_text)~*'^https?://[^[:space:]]+$' THEN 'url_only'
      WHEN btrim(COALESCE(e.image_url,e.source_media_url_candidate,''))<>''
        AND position(btrim(COALESCE(e.image_url,e.source_media_url_candidate,'')) in e.raw_message_text)>0 THEN 'contains_image_url'
      WHEN e.raw_message_text~*'https?://[^[:space:]]+' THEN 'contains_other_url'
      ELSE 'source_text'
    END AS raw_message_state,
    link.dealer_id::text AS dealer_id,
    COALESCE(NULLIF(btrim(d.display_name),''),NULLIF(btrim(d.company_name),'')) AS dealer_name,
    (link.dealer_id IS NOT NULL) AS has_exact_dealer_link,
    (COALESCE(d.rating,0)>0 AND COALESCE(d.review_count,0)>0) AS has_dealer_rating,
    (NULLIF(btrim(e.reference_normalized),'') IS NOT NULL AND NULLIF(btrim(e.model_normalized),'') IS NOT NULL
      AND NULLIF(btrim(e.dial_color_normalized),'') IS NOT NULL) AS has_complete_watch_identity
  FROM eligible e
  LEFT JOIN LATERAL (
    SELECT dl.dealer_id FROM public.dealer_listing_links dl
    WHERE dl.listing_id=e.id AND dl.link_status='APPLIED'
    ORDER BY dl.linked_at,dl.dealer_id LIMIT 1
  ) link ON true
  LEFT JOIN public.dealers d ON d.id=link.dealer_id
)
SELECT jsonb_build_object(
  'contract','watchfacts-rolex-listing-completeness-base-v1',
  'project_ref','qnsafosakvonzgfcsphh','read_only',true,
  'transaction_read_only',current_setting('transaction_read_only'),
  'shard',__SHARD__,
  'rows',COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.listing_id),'[]'::jsonb)
) AS audit FROM safe_rows s;
