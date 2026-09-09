-- Child visibility and exact source-observation reposts are derived projections.
-- This migration does not rewrite raw messages or old frozen snapshot payloads.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.expanded_offer_observations_v3 (
 listing_id text PRIMARY KEY REFERENCES wf_canonical_staging.mariadb_canary_published_listings_v2(listing_id) ON DELETE CASCADE,
 offer_group_key text NOT NULL,representative_listing_id text NOT NULL,
 proof_kind text NOT NULL CHECK(proof_kind IN('EXACT_MESSAGE_IMAGE_REPOST','EXACT_PARENT_CHILD_MESSAGE_REPOST','DISTINCT_SOURCE_OBSERVATION')),
 source_hash text NOT NULL,original_price_amount numeric,original_price_currency text,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expanded_offer_groups_v3 ON wf_canonical_staging.expanded_offer_observations_v3(offer_group_key,listing_id);
ALTER TABLE wf_canonical_staging.expanded_offer_observations_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.expanded_offer_observations_v3 FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE VIEW public.trading_floor_ready_view_v2 WITH(security_invoker=true) AS
SELECT
 v.contract_version AS contract_version,
 v.listing_id AS listing_id,
 v.parent_listing_id AS parent_listing_id,
 v.child_index AS child_index,
 v.source_id AS source_id,
 v.source_hash AS source_hash,
 v.raw_message_id AS raw_message_id,
 v.raw_message_text AS raw_message_text,
 v.source_context_text AS source_context_text,
 v.source_created_at AS source_created_at,
 v.observed_at AS observed_at,
 v.category AS category,
 v.brand AS brand,
 v.model AS model,
 v.reference AS reference,
 v.dial_color AS dial_color,
 v.year AS year,
 v.condition AS condition,
 v.intent AS intent,
 v.intent_status AS intent_status,
 v.title AS title,
 v.description AS description,
 v.original_price_text AS original_price_text,
 v.original_price_amount AS original_price_amount,
 v.original_price_currency AS original_price_currency,
 v.price_usd AS price_usd,
 v.fx_rate AS fx_rate,
 v.fx_source AS fx_source,
 v.fx_date AS fx_date,
 v.price_status AS price_status,
 v.price_research_eligible AS price_research_eligible,
 v.included_in_statistics AS included_in_statistics,
 v.statistics_exclusion_reason AS statistics_exclusion_reason,
 v.image_url AS image_url,
 v.thumbnail_url AS thumbnail_url,
 v.image_key AS image_key,
 v.image_evidence_type AS image_evidence_type,
 v.image_status AS image_status,
 v.seller_id AS seller_id,
 v.seller_display_name AS seller_display_name,
 d.profile_path AS seller_profile_url,
 d.review_count AS seller_review_count,
 v.seller_listing_count AS seller_listing_count,
 v.seller_wts_count AS seller_wts_count,
 v.seller_wtb_count AS seller_wtb_count,
 coalesce(d.contact_consent,false) AS contact_available,
 v.location_country AS location_country,
 v.location_region AS location_region,
 v.is_bundle AS is_bundle,
 v.bundle_child_count AS bundle_child_count,
 v.review_status AS review_status,
 v.review_reasons AS review_reasons,
 v.priced_rank AS priced_rank,
 v.image_rank AS image_rank,
 coalesce(observation.offer_group_key,v.duplicate_group_id) AS duplicate_group_id,
 CASE WHEN d.review_count>0 AND d.rating>0 AND d.rating<=5 THEN d.rating ELSE NULL END AS seller_rating,
 CASE WHEN d.review_count>0 AND d.rating>0 AND d.rating<=5 THEN 'SOURCE_SUPPLIED' WHEN d.review_count>0 THEN 'SOURCE_FEEDBACK_COUNT' ELSE 'UNAVAILABLE' END AS seller_rating_evidence_status,
 v.source_listing_status,v.source_deleted,v.original_price_role,v.source_created_at_text
FROM (
SELECT
contract_version, listing_id, parent_listing_id, child_index, source_id, source_hash,
  raw_message_id, raw_message_text, source_context_text, source_created_at, observed_at,
  category, brand, model, reference, dial_color, year, condition, intent, intent_status,
  title, description, original_price_text, original_price_amount, original_price_currency,
  price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible,
  included_in_statistics, statistics_exclusion_reason, image_url, thumbnail_url, image_key,
  image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
  seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
  contact_available, location_country, location_region, is_bundle, bundle_child_count,
  review_status, review_reasons,
  CASE WHEN price_research_eligible IS TRUE AND price_usd > 0 THEN 1 ELSE 2 END AS priced_rank,
  CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT'
         AND NULLIF(btrim(image_key), '') IS NOT NULL THEN 1 ELSE 2 END AS image_rank,
  duplicate_group_id,source_listing_status,source_deleted,original_price_role,source_created_at_text
FROM wf_canonical_staging.mariadb_canary_published_listings_v2 v
WHERE v.is_bundle IS FALSE AND v.category='WATCH' AND v.intent IN('WTS','WTB')
 AND ((v.parent_listing_id IS NULL AND v.child_index IS NULL) OR
  (v.parent_listing_id IS NOT NULL AND v.child_index>=1 AND v.image_url IS NULL
   AND v.thumbnail_url IS NULL AND v.image_key IS NULL AND v.raw_message_text IS NULL AND v.description IS NULL
   AND EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_publication_registry_v3 registry
    JOIN wf_canonical_staging.expanded_listing_versions_v3 version ON version.materialization_hash=registry.materialization_hash
    WHERE registry.listing_id=v.listing_id AND version.listing_id=v.listing_id
     AND version.source_hash=v.source_hash AND version.raw_row_id::text=v.raw_message_id
     AND version.document=to_jsonb(v))))
 AND NOT EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_offer_observations_v3 observation
  WHERE observation.listing_id=v.listing_id AND observation.representative_listing_id<>v.listing_id)
) v LEFT JOIN wf_canonical_staging.expanded_offer_observations_v3 observation ON observation.listing_id=v.listing_id
LEFT JOIN wf_canonical_staging.v2_approved_listing_dealers d
 ON d.listing_id=v.listing_id AND d.source_id=v.source_id AND d.source_hash=v.source_hash;

-- Append the same fields to Price Research without changing its asking-price/FX gate.
DO $view$
DECLARE definition text;
BEGIN
 definition=pg_get_viewdef('public.price_research_ready_view_v2'::regclass,true);
 IF strpos(definition,'seller_rating_evidence_status')=0 THEN RAISE EXCEPTION 'expanded_research_view_definition_changed'; END IF;
 definition=replace(definition,'seller_rating_evidence_status','seller_rating_evidence_status,source_listing_status,source_deleted,original_price_role,source_created_at_text');
 EXECUTE 'CREATE OR REPLACE VIEW public.price_research_ready_view_v2 WITH(security_invoker=true) AS '||definition;
END $view$;

CREATE FUNCTION wf_canonical_staging.refresh_expanded_offer_observations_v3() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;suppressed integer;
BEGIN
 PERFORM 1 FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 -- Only proven duplicate groups need a derived row. Unique source observations
 -- remain distinct by listing ID without another per-listing evidence copy.
 DELETE FROM wf_canonical_staging.expanded_offer_observations_v3;
 -- Exact whole-message equality plus the original photo establishes a repost;
 -- a shared reference, maker, price or poster alone never establishes identity.
 WITH candidates AS MATERIALIZED (
  SELECT p.listing_id,p.source_hash,p.source_created_at,p.observed_at,p.original_price_amount,p.original_price_currency,
   CASE WHEN p.parent_listing_id IS NOT NULL AND x.candidate_hash IS NOT NULL THEN 'EXACT_PARENT_CHILD_MESSAGE_REPOST'
    WHEN p.parent_listing_id IS NULL AND nullif(p.image_key,'') IS NOT NULL AND nullif(p.raw_message_text,'') IS NOT NULL THEN 'EXACT_MESSAGE_IMAGE_REPOST'
    ELSE 'DISTINCT_SOURCE_OBSERVATION' END kind,
   CASE WHEN p.parent_listing_id IS NOT NULL AND x.candidate_hash IS NOT NULL THEN
    jsonb_build_array(p.seller_id,c.parent_field_hash,encode(sha256(convert_to(p.source_context_text,'UTF8')),'hex'),p.intent,p.brand,p.reference,p.original_price_role,p.original_price_amount,p.original_price_currency)
    WHEN p.parent_listing_id IS NULL AND nullif(p.image_key,'') IS NOT NULL AND nullif(p.raw_message_text,'') IS NOT NULL THEN
    jsonb_build_array(p.seller_id,p.image_key,encode(sha256(convert_to(p.raw_message_text,'UTF8')),'hex'),p.intent,p.brand,p.reference,p.original_price_role,p.original_price_amount,p.original_price_currency)
    ELSE jsonb_build_array(p.listing_id) END proof
  FROM wf_canonical_staging.mariadb_canary_published_listings_v2 p
  LEFT JOIN wf_canonical_staging.expanded_publication_registry_v3 registry ON registry.listing_id=p.listing_id
  LEFT JOIN wf_canonical_staging.expanded_listing_versions_v3 x ON x.materialization_hash=registry.materialization_hash
  LEFT JOIN wf_canonical_staging.expanded_listing_candidates_v3 c ON c.candidate_hash=x.candidate_hash
 ), grouped AS (
  SELECT *,kind||':'||encode(sha256(convert_to(proof::text,'UTF8')),'hex') group_key FROM candidates
 ), ranked AS (
  SELECT *,count(*) OVER(PARTITION BY group_key) group_size,first_value(listing_id) OVER(PARTITION BY group_key ORDER BY source_created_at DESC NULLS LAST,observed_at DESC NULLS LAST,listing_id COLLATE "C") representative
  FROM grouped
 )
 INSERT INTO wf_canonical_staging.expanded_offer_observations_v3(listing_id,offer_group_key,representative_listing_id,proof_kind,source_hash,original_price_amount,original_price_currency)
  SELECT listing_id,group_key,representative,kind,source_hash,original_price_amount,original_price_currency FROM ranked WHERE group_size>1
 ON CONFLICT(listing_id) DO UPDATE SET offer_group_key=excluded.offer_group_key,representative_listing_id=excluded.representative_listing_id,
  proof_kind=excluded.proof_kind,source_hash=excluded.source_hash,original_price_amount=excluded.original_price_amount,original_price_currency=excluded.original_price_currency
 WHERE (expanded_offer_observations_v3.offer_group_key,expanded_offer_observations_v3.representative_listing_id,expanded_offer_observations_v3.source_hash)
  IS DISTINCT FROM (excluded.offer_group_key,excluded.representative_listing_id,excluded.source_hash);
 GET DIAGNOSTICS n=ROW_COUNT;
 SELECT count(*) INTO suppressed FROM wf_canonical_staging.expanded_offer_observations_v3 WHERE listing_id<>representative_listing_id;
 RETURN jsonb_build_object('changed',n,'suppressed_exact_reposts',suppressed);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.refresh_expanded_offer_observations_v3() FROM PUBLIC,anon,authenticated,service_role;

-- With no proven grouping, each observation remains separate. Every original
-- changed price is retained; a different USD exchange rate cannot define a repost.
CREATE OR REPLACE FUNCTION wf_canonical_staging.research_offer_group_key_v2(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN nullif(p->>'duplicate_group_id','') IS NOT NULL THEN 'explicit:'||(p->>'duplicate_group_id')
 ELSE 'source-observation:'||coalesce(p->>'listing_id',p->>'source_id') END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.research_offer_group_key_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $snapshots$
DECLARE signature text;definition text;needle text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['wf_canonical_staging.materialize_trading_floor_snapshot(integer)','wf_canonical_staging.materialize_price_research_snapshot(integer)'] LOOP
  definition=pg_get_functiondef(signature::regprocedure);
  needle='coalesce(v.source_created_at,''0001-01-01T00:00:00Z''::timestamptz)';
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'expanded_snapshot_sort_fallback_definition_changed'; END IF;
  EXECUTE replace(definition,needle,'coalesce(v.source_created_at,v.observed_at,''0001-01-01T00:00:00Z''::timestamptz)');
 END LOOP;
 -- Exact repost projection must be frozen before both new public snapshots.
 definition=pg_get_functiondef('wf_canonical_staging.finalize_expanded_cohort_v3(text,text[])'::regprocedure);
 needle='tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'expanded_cohort_snapshot_definition_changed'; END IF;
 EXECUTE replace(definition,needle,'PERFORM wf_canonical_staging.refresh_expanded_offer_observations_v3();'||chr(10)||needle);
 definition=pg_get_functiondef('wf_canonical_staging.rollback_expanded_batch_v3(text,bigint)'::regprocedure);
 needle='PERFORM public.open_trading_floor_keyset_snapshot(3600);PERFORM public.open_price_research_keyset_snapshot(3600);';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'expanded_rollback_snapshot_definition_changed'; END IF;
 EXECUTE replace(definition,needle,'PERFORM wf_canonical_staging.refresh_expanded_offer_observations_v3();'||chr(10)||needle);
 definition=pg_get_functiondef('wf_canonical_staging.rollback_expanded_cohort_v3(text,bigint)'::regprocedure);
 needle='tf=public.open_trading_floor_keyset_snapshot(3600);pr=public.open_price_research_keyset_snapshot(3600);';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'expanded_cohort_rollback_snapshot_definition_changed'; END IF;
 EXECUTE replace(definition,needle,'PERFORM wf_canonical_staging.refresh_expanded_offer_observations_v3();'||chr(10)||needle);
END $snapshots$;
NOTIFY pgrst,'reload schema';
COMMIT;
