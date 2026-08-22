WITH control AS MATERIALIZED (
  SELECT enabled_run_key,trading_floor_enabled FROM public.qnsa_two_brand_release_control WHERE canonical_brand='Rolex'
), base AS MATERIALIZED (
  SELECT l.id::text id,l.source_record_id,l.reference_normalized,
    (l.public_image_eligible AND btrim(COALESCE(l.image_url,l.source_media_url_candidate,'')) ~* '^https?://[^[:space:]]+$') has_exact_source_image,
    (COALESCE(l.price_normalized,l.price_original,l.price_usd,0)>0) has_supplied_price,
    COALESCE(NULLIF(btrim(l.user_name),''),NULLIF(btrim(l.from_name),'')) posted_by
  FROM staging.listings l JOIN control c ON c.enabled_run_key=l.normalization_run_key AND c.trading_floor_enabled
  JOIN staging.mariadb_normalization_import_checkpoints cp ON cp.run_key=l.normalization_run_key AND cp.status='NORMALIZATION_STAGED' AND cp.error_rows=0
  WHERE l.brand_normalized='Rolex' AND upper(COALESCE(l.category,''))='WATCH'
    AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
    AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
    AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id,'')<>''
    AND l.source_hash ~ '^[0-9a-f]{64}$' AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
    AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
    AND lower(COALESCE(l.price_research_status,''))<>'suppressed_exact_duplicate'
), overlay AS MATERIALIZED (
  SELECT w.id,w.source_record_id,w.normalized_reference,
    (upper(COALESCE(w.image_evidence_type,''))='SELLER_LISTING_IMAGE' AND btrim(COALESCE(w.user_image_url,w.final_image_url,w.display_image_url,'')) ~* '^https?://[^[:space:]]+$') has_exact_source_image,
    (COALESCE(w.source_price_amount,w.workbook_price_usd,0)>0) has_supplied_price,w.posted_by
  FROM public.reviewed_workbook_inventory w
  WHERE w.brand_scope='Rolex' AND w.verification_tier='QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1' AND w.confidence=100 AND w.source_message_id IS NOT NULL
    AND ((w.verification_status='APPROVED_SINGLE_CANDIDATE' AND (upper(COALESCE(w.listing_type,'')) IN ('WTS','WTB','OTHER') OR w.listing_type IS NULL))
      OR (w.id='rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972' AND w.verification_status='APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY' AND w.listing_type='MULTI'))
), combined AS MATERIALIZED (
  SELECT 'overlay'::text lane,id,source_record_id,normalized_reference,has_exact_source_image,has_supplied_price,posted_by FROM overlay
  UNION ALL SELECT 'base',b.id,b.source_record_id,b.reference_normalized,b.has_exact_source_image,b.has_supplied_price,b.posted_by FROM base b
  WHERE NOT EXISTS (SELECT 1 FROM overlay o WHERE o.id=b.id OR (o.source_record_id IS NOT NULL AND o.source_record_id=b.source_record_id))
), refs AS MATERIALIZED (
  SELECT regexp_replace(upper(btrim(normalized_reference)),'[^A-Z0-9]','','g') ref_key FROM combined
  WHERE NULLIF(btrim(normalized_reference),'') IS NOT NULL GROUP BY 1
), dealer AS MATERIALIZED (
  SELECT b.id,(l.listing_id IS NOT NULL) linked,(d.rating IS NOT NULL AND d.review_count>0) rated
  FROM base b LEFT JOIN public.dealer_listing_links l ON l.listing_id=b.id::uuid AND l.link_status='APPLIED'
  LEFT JOIN public.dealers d ON d.id=l.dealer_id
)
SELECT jsonb_build_object('contract','watchfacts-rolex-phase2-trading-floor-v1','project_ref','qnsafosakvonzgfcsphh','read_only',true,
  'transaction_read_only',current_setting('transaction_read_only'),'generated_at',now(),
  'counts',jsonb_build_object('released_base_rows',(SELECT count(*) FROM base),'reviewed_overlay_rows',(SELECT count(*) FROM overlay),
    'trading_floor_listings',(SELECT count(*) FROM combined),'trading_floor_references',(SELECT count(*) FROM refs),
    'listings_with_valid_real_images',(SELECT count(*) FROM combined WHERE has_exact_source_image),'listings_without_images',(SELECT count(*) FROM combined WHERE NOT has_exact_source_image),
    'listings_with_any_positive_price',(SELECT count(*) FROM combined WHERE has_supplied_price),'listings_missing_price',(SELECT count(*) FROM combined WHERE NOT has_supplied_price),
    'listings_with_posted_user',(SELECT count(*) FROM combined WHERE NULLIF(btrim(posted_by),'') IS NOT NULL),'listings_missing_posted_user',(SELECT count(*) FROM combined WHERE NULLIF(btrim(posted_by),'') IS NULL),
    'base_listings_with_exact_dealer_link',(SELECT count(*) FROM dealer WHERE linked),'base_listings_missing_exact_dealer_link',(SELECT count(*) FROM dealer WHERE NOT linked),
    'base_listings_with_source_backed_dealer_rating',(SELECT count(*) FROM dealer WHERE rated),'base_listings_missing_source_backed_dealer_rating',(SELECT count(*) FROM dealer WHERE NOT rated)),
  'reference_keys',(SELECT COALESCE(jsonb_agg(ref_key ORDER BY ref_key),'[]'::jsonb) FROM refs),
  'checksum',md5((SELECT count(*)::text||':'||COALESCE(sum(hashtextextended(id,0)::numeric),0)::text FROM combined))) AS trading_floor;
