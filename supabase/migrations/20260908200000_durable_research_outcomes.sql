-- Publication outcomes outlive expiring pagination caches. Counts across broad
-- filters sum exact-cohort decisions instead of applying one IQR to unrelated
-- watch references, dials or conditions.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.publication_research_outcomes_v2 (
 publication_revision bigint NOT NULL,
 listing_id text NOT NULL,
 source_hash text NOT NULL,
 payload_hash text NOT NULL,
 decision jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(publication_revision,listing_id)
);
ALTER TABLE wf_canonical_staging.publication_research_outcomes_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.publication_research_outcomes_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION wf_canonical_staging.retain_research_outcomes_v2(p_snapshot uuid,p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM wf_canonical_staging.research_snapshot_admission_v2 a
  JOIN wf_canonical_staging.keyset_snapshot_members m USING(snapshot_id,listing_id)
  JOIN wf_canonical_staging.publication_research_outcomes_v2 old ON old.publication_revision=p_revision AND old.listing_id=a.listing_id
  WHERE a.snapshot_id=p_snapshot AND (old.payload_hash<>encode(sha256(convert_to(m.payload::text,'UTF8')),'hex')
   OR old.decision<>(to_jsonb(a)-'snapshot_id'-'listing_id'))
 ) THEN RAISE EXCEPTION 'research_publication_outcome_conflict'; END IF;
 INSERT INTO wf_canonical_staging.publication_research_outcomes_v2(publication_revision,listing_id,source_hash,payload_hash,decision)
 SELECT p_revision,a.listing_id,m.payload->>'source_hash',encode(sha256(convert_to(m.payload::text,'UTF8')),'hex'),to_jsonb(a)-'snapshot_id'-'listing_id'
 FROM wf_canonical_staging.research_snapshot_admission_v2 a
 JOIN wf_canonical_staging.keyset_snapshot_members m USING(snapshot_id,listing_id)
 WHERE a.snapshot_id=p_snapshot ON CONFLICT(publication_revision,listing_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.retain_research_outcomes_v2(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE definition text; item record;
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.freeze_research_admission_v2(uuid)'::regprocedure);
 IF strpos(definition,'UPDATE wf_canonical_staging.keyset_snapshot_registry SET research_display_count=')=0 THEN RAISE EXCEPTION 'research_freezer_definition_mismatch'; END IF;
 EXECUTE replace(definition,'UPDATE wf_canonical_staging.keyset_snapshot_registry SET research_display_count=',
  'PERFORM wf_canonical_staging.retain_research_outcomes_v2(p_snapshot,(SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton)); UPDATE wf_canonical_staging.keyset_snapshot_registry SET research_display_count=');
 FOR item IN SELECT snapshot_id,publication_revision FROM wf_canonical_staging.keyset_snapshot_registry WHERE research_display_count IS NOT NULL AND data_snapshot_id IS NULL LOOP
  PERFORM wf_canonical_staging.retain_research_outcomes_v2(item.snapshot_id,item.publication_revision);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_breakdown(p_snapshot_id uuid,p_brand text,p_reference text DEFAULT NULL,p_model text DEFAULT NULL,p_dial_color text DEFAULT NULL,p_filter_dial boolean DEFAULT false,p_condition text DEFAULT NULL,p_filter_condition boolean DEFAULT false)
RETURNS TABLE(source_observations bigint,wts_count bigint,wtb_count bigint,unique_qualified_offers bigint,included_count bigint,excluded_duplicates bigint,excluded_ambiguous_currency bigint,excluded_unsupported_fx bigint,excluded_implausible bigint,excluded_iqr_outliers bigint,excluded_not_wts bigint,excluded_ineligible_flag bigint,plausibility_floor numeric,retained_audit_evidence_count bigint,iqr_multiplier numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint;
BEGIN
 PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id,'trading_floor');
 SELECT r.publication_revision INTO STRICT revision FROM wf_canonical_staging.keyset_snapshot_registry r WHERE r.snapshot_id=p_snapshot_id;
 -- A Trading Floor-only caller may not have opened the paired research root.
 -- This reader cannot create snapshots: fail closed until the writer/prewarm
 -- or the Price Research opening RPC prepares the paired publication.
 IF EXISTS(SELECT 1 FROM wf_canonical_staging.keyset_snapshot_members m WHERE m.snapshot_id=wf_canonical_staging.snapshot_data_id(p_snapshot_id)
  AND (m.payload->>'price_research_eligible')::boolean IS TRUE AND (m.payload->>'included_in_statistics')::boolean IS TRUE
  AND m.payload->>'intent'='WTS' AND NOT EXISTS(SELECT 1 FROM wf_canonical_staging.publication_research_outcomes_v2 o WHERE o.publication_revision=revision AND o.listing_id=m.listing_id)
 ) THEN RAISE EXCEPTION 'research_publication_outcomes_not_prepared'; END IF;
 RETURN QUERY WITH scoped AS (
  SELECT m.payload p,o.decision d FROM wf_canonical_staging.keyset_snapshot_members m
  LEFT JOIN wf_canonical_staging.publication_research_outcomes_v2 o ON o.publication_revision=revision AND o.listing_id=m.listing_id AND o.source_hash=m.payload->>'source_hash'
  WHERE m.snapshot_id=wf_canonical_staging.snapshot_data_id(p_snapshot_id)
   AND (p_brand IS NULL OR lower(m.payload->>'brand')=lower(p_brand))
   AND (p_reference IS NULL OR lower(m.payload->>'reference')=lower(p_reference))
   AND (p_model IS NULL OR lower(m.payload->>'model')=lower(p_model))
   AND (NOT p_filter_dial OR m.payload->>'dial_color' IS NOT DISTINCT FROM p_dial_color)
   AND (NOT p_filter_condition OR m.payload->>'condition' IS NOT DISTINCT FROM p_condition)
 ), classified AS (
  SELECT p,d,CASE
   WHEN p->>'intent' IS DISTINCT FROM 'WTS' THEN 'NOT_WTS'
   WHEN (p->>'price_research_eligible')::boolean IS NOT TRUE OR (p->>'included_in_statistics')::boolean IS NOT TRUE
    OR coalesce((p->>'price_usd')::numeric,0)<=0 OR (p->>'price_usd')::numeric IN ('NaN'::numeric,'Infinity'::numeric) THEN 'INELIGIBLE'
   WHEN upper(coalesce(p->>'original_price_currency',''))<>'USD' AND coalesce((p->>'fx_rate')::numeric,0)<=0 THEN 'AMBIGUOUS_CURRENCY'
   WHEN upper(coalesce(p->>'original_price_currency',''))<>'USD' AND (nullif(btrim(p->>'fx_source'),'') IS NULL OR p->>'fx_date' IS NULL) THEN 'UNSUPPORTED_FX'
   WHEN d IS NULL THEN 'INELIGIBLE'
   ELSE d->>'exclusion_reason' END reason FROM scoped
 ) SELECT count(*),count(*) FILTER(WHERE p->>'intent'='WTS'),count(*) FILTER(WHERE p->>'intent'='WTB'),
  count(*) FILTER(WHERE d IS NOT NULL AND reason IS DISTINCT FROM 'REPOST_DUPLICATE'),count(*) FILTER(WHERE reason IS NULL),
  count(*) FILTER(WHERE reason='REPOST_DUPLICATE'),count(*) FILTER(WHERE reason='AMBIGUOUS_CURRENCY'),count(*) FILTER(WHERE reason='UNSUPPORTED_FX'),
  count(*) FILTER(WHERE reason='BELOW_MARKET_PLAUSIBILITY_FLOOR'),count(*) FILTER(WHERE reason IN ('BELOW_IQR_FENCE','ABOVE_IQR_FENCE')),
  count(*) FILTER(WHERE reason='NOT_WTS'),count(*) FILTER(WHERE reason='INELIGIBLE'),
  CASE WHEN count(DISTINCT d->'cohort_key')=1 THEN max((d->>'plausibility_floor')::numeric) END,
  count(*) FILTER(WHERE reason IS NOT NULL),3.0::numeric FROM classified;
END $$;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) TO service_role;
COMMIT;
