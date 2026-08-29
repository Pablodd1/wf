WITH control AS MATERIALIZED (SELECT enabled_run_key FROM public.qnsa_two_brand_release_control WHERE canonical_brand='Rolex' AND trading_floor_enabled), base AS MATERIALIZED (
 SELECT l.id::text id,l.reference_normalized FROM staging.listings l JOIN control c ON c.enabled_run_key=l.normalization_run_key
 WHERE l.brand_normalized='Rolex' AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
 AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB') AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
 AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id,'')<>'' AND l.source_hash ~ '^[0-9a-f]{64}$' AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
 AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived') AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
), overlay AS MATERIALIZED (
 SELECT w.id,w.normalized_reference FROM public.reviewed_workbook_inventory w WHERE w.brand_scope='Rolex' AND w.verification_tier='QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1' AND w.confidence=100 AND w.source_message_id IS NOT NULL
 AND ((w.verification_status='APPROVED_SINGLE_CANDIDATE' AND (upper(COALESCE(w.listing_type,'')) IN ('WTS','WTB','OTHER') OR w.listing_type IS NULL)) OR (w.id='rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972' AND w.verification_status='APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY' AND w.listing_type='MULTI'))
), refs AS MATERIALIZED (
 SELECT regexp_replace(upper(btrim(reference_normalized)),'[^A-Z0-9]','','g') ref_key FROM (SELECT reference_normalized FROM base UNION ALL SELECT normalized_reference FROM overlay) x WHERE NULLIF(btrim(reference_normalized),'') IS NOT NULL GROUP BY 1
)
SELECT jsonb_build_object('contract','watchfacts-rolex-phase2-trading-floor-v1','project_ref','qnsafosakvonzgfcsphh','read_only',true,'transaction_read_only',current_setting('transaction_read_only'),'generated_at',now(),
'counts',jsonb_build_object('released_base_rows',(SELECT count(*) FROM base),'reviewed_overlay_rows',(SELECT count(*) FROM overlay),'trading_floor_listings',(SELECT count(*) FROM base)+(SELECT count(*) FROM overlay),'trading_floor_references',(SELECT count(*) FROM refs)),
'reference_keys',(SELECT COALESCE(jsonb_agg(ref_key ORDER BY ref_key),'[]'::jsonb) FROM refs),'checksum',md5((SELECT count(*)::text FROM base)||':'||(SELECT count(*)::text FROM overlay)||':'||COALESCE((SELECT string_agg(ref_key,',' ORDER BY ref_key) FROM refs),''))) AS trading_floor;
