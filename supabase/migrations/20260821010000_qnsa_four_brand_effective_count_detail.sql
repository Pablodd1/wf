-- Forward-only, read-only RPCs for the four-brand effective release.
-- No source, proposal, control, or activation rows are mutated.

BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_four_brand_effective_row_count(
  p_brand text, p_listing_type text DEFAULT NULL, p_model text DEFAULT NULL,
  p_reference text DEFAULT NULL, p_dial text DEFAULT NULL,
  p_condition text DEFAULT NULL, p_search text DEFAULT NULL,
  p_references text[] DEFAULT NULL, p_images_only boolean DEFAULT false,
  p_priced_only boolean DEFAULT false, p_posted_after timestamptz DEFAULT NULL,
  p_region text DEFAULT NULL, p_rating text DEFAULT NULL
) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,staging,pg_catalog
SET statement_timeout='8s' AS $$
  -- Keep these CTEs and predicates in parity with
  -- qnsa_four_brand_effective_page_rows. The count intentionally omits only
  -- presentation ordering and LIMIT/OFFSET.
  WITH released AS (
    SELECT 'Omega'::text brand,m.listing_id,m.public_model,m.public_reference,
      m.source_hash,m.source_candidate_hash
    FROM public.qnsa_omega_release_control c JOIN public.qnsa_omega_release_manifest m
      ON m.release_run_key=c.release_run_key
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=m.listing_id
    WHERE btrim(p_brand)='Omega' AND c.singleton AND c.enabled
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,m.public_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
    UNION ALL
    SELECT 'Cartier',m.listing_id,m.public_model,m.public_reference,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_cartier_release_control c JOIN public.qnsa_cartier_release_manifest m
      ON m.release_run_key=c.release_run_key
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=m.listing_id
    WHERE btrim(p_brand)='Cartier' AND c.singleton AND c.enabled
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,m.public_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
    UNION ALL
    SELECT 'Tudor',m.listing_id,m.public_model,m.public_reference,m.source_hash,m.source_candidate_hash
    FROM public.qnsa_tudor_release_control c JOIN public.qnsa_tudor_release_manifest m
      ON m.release_run_key=c.release_run_key
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=m.listing_id
    WHERE btrim(p_brand)='Tudor' AND c.singleton AND c.enabled
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,m.public_model,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,m.public_reference,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
    UNION ALL
    SELECT 'Zenith',l.id,
      COALESCE(NULLIF(btrim(l.model_normalized),''),NULLIF(btrim(l.model_original),'')),
      l.reference_normalized,l.source_hash,l.source_candidate_hash
    FROM staging.listings l
    JOIN public.qnsa_two_brand_release_control c ON c.canonical_brand='Zenith'
      AND c.trading_floor_enabled AND l.normalization_run_key=c.enabled_run_key
    JOIN staging.qnsa_zenith_identity_reconciliation_audit z ON z.listing_id=l.id
      AND z.normalization_run_key=l.normalization_run_key
      AND z.reconciliation_run_key='zenith-identity-20260814-v1'
      AND z.decision='RELEASE_SAFE' AND z.corrected_reference=l.reference_normalized
    LEFT JOIN public.qnsa_four_brand_effective_enrichment ep ON ep.listing_id=l.id
    WHERE btrim(p_brand)='Zenith'
      AND (p_model IS NULL OR lower(btrim(COALESCE(ep.proposed_model,l.model_normalized,l.model_original,'')))=lower(btrim(p_model)))
      AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,l.reference_normalized,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
      AND (p_references IS NULL OR regexp_replace(upper(COALESCE(ep.proposed_reference,l.reference_normalized,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
  ), source_rows AS (
    SELECT r.brand,r.public_model,r.public_reference,l.id,l.created_at,l.raw_message_text,
      l.user_name,l.from_name,l.dial_color_normalized,l.condition_normalized,l.location,
      l.image_url,l.price_usd,l.price_normalized,
      upper(COALESCE(l.listing_type,l.intent,'')) effective_intent,
      p.proposed_model,p.proposed_reference,p.proposed_dial_color,p.proposed_condition,
      p.proposed_price_usd,d.review_count
    FROM released r JOIN staging.listings l ON l.id=r.listing_id
    JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id
      AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
    LEFT JOIN public.qnsa_four_brand_effective_enrichment p ON p.listing_id=l.id
      AND p.raw_message_version_id=l.raw_message_version_id AND p.source_record_id=l.source_record_id
      AND p.source_hash=l.source_hash AND p.source_candidate_hash=l.source_candidate_hash
      AND p.canonical_brand=l.brand_normalized
    LEFT JOIN public.dealer_listing_links dl ON dl.listing_id=l.id AND dl.link_status='APPLIED'
    LEFT JOIN public.dealers d ON d.id=dl.dealer_id AND d.status='VERIFIED'
    WHERE l.brand_normalized=r.brand AND l.source_hash=r.source_hash
      AND l.source_candidate_hash=r.source_candidate_hash
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (p_listing_type IS NULL OR upper(COALESCE(l.listing_type,l.intent,''))=upper(p_listing_type))
      AND (COALESCE(p_images_only,false)=false OR NULLIF(btrim(l.image_url),'') ~* '^https?://[^[:space:]]+$')
      AND (COALESCE(p_priced_only,false)=false OR COALESCE(p.proposed_price_usd,l.price_usd,l.price_normalized,0)>0)
      AND (p_posted_after IS NULL OR l.created_at>=p_posted_after)
      AND (p_region IS NULL OR COALESCE(l.location,'') ILIKE '%'||p_region||'%')
      AND (p_rating IS NULL OR (lower(p_rating)='rated' AND d.review_count>0)
        OR (lower(p_rating)='unrated' AND COALESCE(d.review_count,0)=0))
  ), effective AS (
    SELECT s.*,
      CASE WHEN public.qnsa_four_brand_value_missing('model',s.public_model,s.brand)
        THEN COALESCE(s.proposed_model,s.public_model) ELSE s.public_model END effective_model,
      COALESCE(NULLIF(btrim(s.public_reference),''),s.proposed_reference) effective_reference,
      CASE WHEN public.qnsa_four_brand_value_missing('dial',s.dial_color_normalized,s.brand)
        THEN COALESCE(s.proposed_dial_color,s.dial_color_normalized) ELSE s.dial_color_normalized END effective_dial,
      CASE WHEN public.qnsa_four_brand_value_missing('condition',s.condition_normalized,s.brand)
        THEN COALESCE(s.proposed_condition,s.condition_normalized) ELSE s.condition_normalized END effective_condition
    FROM source_rows s
  )
  SELECT count(*) FROM effective e
  WHERE (p_model IS NULL OR lower(btrim(COALESCE(e.effective_model,'')))=lower(btrim(p_model)))
    AND (p_reference IS NULL OR regexp_replace(upper(COALESCE(e.effective_reference,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(p_reference),'[^A-Z0-9]','','g'))
    AND (p_references IS NULL OR regexp_replace(upper(COALESCE(e.effective_reference,'')),'[^A-Z0-9]','','g')=ANY(ARRAY(SELECT regexp_replace(upper(value),'[^A-Z0-9]','','g') FROM unnest(p_references) value)))
    AND (p_dial IS NULL OR lower(btrim(COALESCE(e.effective_dial,'')))=lower(btrim(p_dial)))
    AND (p_condition IS NULL OR lower(btrim(COALESCE(e.effective_condition,'')))=lower(btrim(p_condition)))
    AND (p_search IS NULL OR NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(btrim(p_search)),'\s+') term
      WHERE concat_ws(' ',e.brand,e.effective_model,e.effective_reference,e.effective_dial,
        e.effective_condition,e.raw_message_text,e.user_name,e.from_name) NOT ILIKE '%'||term||'%'
    ));
$$;

CREATE OR REPLACE FUNCTION public.qnsa_four_brand_effective_detail(p_listing_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,staging,pg_catalog
SET statement_timeout='3s' AS $$
  WITH scope AS (
    SELECT l.id,l.brand_normalized brand FROM staging.listings l
    WHERE l.id=p_listing_id AND l.brand_normalized IN ('Tudor','Omega','Cartier','Zenith')
  ), released AS (
    SELECT 'Omega'::text brand,m.listing_id,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM scope s JOIN public.qnsa_omega_release_manifest m ON m.listing_id=s.id
    JOIN public.qnsa_omega_release_control c ON c.release_run_key=m.release_run_key
    WHERE s.brand='Omega' AND c.singleton AND c.enabled
    UNION ALL
    SELECT 'Cartier',m.listing_id,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM scope s JOIN public.qnsa_cartier_release_manifest m ON m.listing_id=s.id
    JOIN public.qnsa_cartier_release_control c ON c.release_run_key=m.release_run_key
    WHERE s.brand='Cartier' AND c.singleton AND c.enabled
    UNION ALL
    SELECT 'Tudor',m.listing_id,m.public_model,m.public_reference,
      m.catalog_reference_confirmed,m.price_lane,m.source_hash,m.source_candidate_hash
    FROM scope s JOIN public.qnsa_tudor_release_manifest m ON m.listing_id=s.id
    JOIN public.qnsa_tudor_release_control c ON c.release_run_key=m.release_run_key
    WHERE s.brand='Tudor' AND c.singleton AND c.enabled
    UNION ALL
    SELECT 'Zenith',l.id,
      COALESCE(NULLIF(btrim(l.model_normalized),''),NULLIF(btrim(l.model_original),'')),
      l.reference_normalized,true,
      CASE WHEN l.currency_normalized IN ('USD','USDT') AND l.price_usd>0 THEN 'SOURCE_EXPLICIT_USD_USDT'
        WHEN l.price_usd>0 AND l.conversion_rate>0 AND l.conversion_timestamp IS NOT NULL
          AND NULLIF(btrim(l.conversion_source),'') IS NOT NULL THEN 'DATED_VERIFIED_FX'
        WHEN l.price_normalized>0 THEN 'SOURCE_CURRENCY_REQUIRES_REVIEW' ELSE 'PRICE_NOT_SUPPLIED' END,
      l.source_hash,l.source_candidate_hash
    FROM scope s JOIN staging.listings l ON l.id=s.id
    JOIN public.qnsa_two_brand_release_control c ON c.canonical_brand='Zenith'
      AND c.trading_floor_enabled AND l.normalization_run_key=c.enabled_run_key
    JOIN staging.qnsa_zenith_identity_reconciliation_audit z ON z.listing_id=l.id
      AND z.normalization_run_key=l.normalization_run_key
      AND z.reconciliation_run_key='zenith-identity-20260814-v1'
      AND z.decision='RELEASE_SAFE' AND z.corrected_reference=l.reference_normalized
    WHERE s.brand='Zenith'
  ), eligible AS (
    SELECT r.*,l.*,p.proposed_model,p.proposed_reference,p.proposed_dial_color,
      p.proposed_condition,p.proposed_price_usd,p.price_evidence_status proposed_price_status,
      p.source_price_amount proposed_source_amount,p.source_currency proposed_source_currency,
      CASE WHEN public.qnsa_four_brand_value_missing('model',r.public_model,r.brand)
        THEN COALESCE(p.proposed_model,r.public_model) ELSE r.public_model END effective_model,
      COALESCE(NULLIF(btrim(r.public_reference),''),p.proposed_reference) effective_reference,
      CASE WHEN public.qnsa_four_brand_value_missing('dial',l.dial_color_normalized,r.brand)
        THEN COALESCE(p.proposed_dial_color,l.dial_color_normalized) ELSE l.dial_color_normalized END effective_dial,
      CASE WHEN public.qnsa_four_brand_value_missing('condition',l.condition_normalized,r.brand)
        THEN COALESCE(p.proposed_condition,l.condition_normalized) ELSE l.condition_normalized END effective_condition
    FROM released r JOIN staging.listings l ON l.id=r.listing_id
    JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id
      AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
    LEFT JOIN public.qnsa_four_brand_effective_enrichment p ON p.listing_id=l.id
      AND p.raw_message_version_id=l.raw_message_version_id AND p.source_record_id=l.source_record_id
      AND p.source_hash=l.source_hash AND p.source_candidate_hash=l.source_candidate_hash
      AND p.canonical_brand=l.brand_normalized
    WHERE l.brand_normalized=r.brand AND l.source_hash=r.source_hash
      AND l.source_candidate_hash=r.source_candidate_hash
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN (
        'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
        'withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
  ), detail AS (
    SELECT jsonb_build_object(
      'id',e.id::text,'source_file','MARIADB_IMMUTABLE_RAW','source_record_id',e.source_record_id,
      'posting_date',e.created_at,'raw_message',e.raw_message_text,
      'listing_type',upper(COALESCE(e.listing_type,e.intent,'')),'canonical_brand',e.brand,
      'model',e.effective_model,'normalized_reference',e.effective_reference,
      'dial_color',e.effective_dial,'condition',e.effective_condition,
      'price_usd',CASE WHEN e.proposed_price_usd>0 THEN e.proposed_price_usd
        WHEN e.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') THEN e.price_usd
        WHEN e.price_usd>0 AND e.conversion_rate>0 AND e.conversion_timestamp IS NOT NULL
          AND NULLIF(btrim(e.conversion_source),'') IS NOT NULL THEN e.price_usd END,
      'source_price_amount',COALESCE(e.proposed_source_amount,e.proposed_price_usd,
        CASE WHEN e.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX')
          OR (e.price_usd>0 AND e.conversion_rate>0 AND e.conversion_timestamp IS NOT NULL
            AND NULLIF(btrim(e.conversion_source),'') IS NOT NULL) THEN e.price_original END),
      'source_currency',COALESCE(e.proposed_source_currency,
        CASE WHEN e.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX')
          OR (e.price_usd>0 AND e.conversion_rate>0 AND e.conversion_timestamp IS NOT NULL
            AND NULLIF(btrim(e.conversion_source),'') IS NOT NULL) THEN e.currency_original END),
      'price_evidence_status',COALESCE(e.proposed_price_status,
        CASE WHEN e.price_lane IN ('SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX') THEN e.price_lane
          WHEN e.price_usd>0 AND e.conversion_rate>0 AND e.conversion_timestamp IS NOT NULL
            AND NULLIF(btrim(e.conversion_source),'') IS NOT NULL THEN 'DATED_VERIFIED_FX'
          ELSE e.price_lane END),
      'confidence',e.overall_confidence,'trading_floor_status','RELEASED_'||upper(e.brand),
      'user_image_url',CASE WHEN NULLIF(btrim(e.image_url),'') ~* '^https?://[^[:space:]]+$'
        THEN btrim(e.image_url) END,
      'has_exact_source_image',NULLIF(btrim(e.image_url),'') ~* '^https?://[^[:space:]]+$',
      'location',NULLIF(btrim(e.location),'')
    ) row_data FROM eligible e LIMIT 1
  )
  SELECT jsonb_build_object(
    'four_brand_scope',EXISTS(SELECT 1 FROM scope),
    'row_data',(SELECT row_data FROM detail)
  );
$$;

REVOKE ALL ON FUNCTION public.qnsa_four_brand_effective_row_count(
  text,text,text,text,text,text,text,text[],boolean,boolean,timestamptz,text,text
), public.qnsa_four_brand_effective_detail(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_four_brand_effective_row_count(
  text,text,text,text,text,text,text,text[],boolean,boolean,timestamptz,text,text
), public.qnsa_four_brand_effective_detail(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
