-- Browse admission is frozen separately from candidate evidence. Statistics
-- retain the full candidate population, so excluding a displayed outlier does
-- not silently recalculate its original quartiles from the surviving cards.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.research_offer_group_key_v2(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN nullif(p->>'duplicate_group_id','') IS NOT NULL THEN 'explicit:'||(p->>'duplicate_group_id')
 ELSE 'offer:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
  coalesce(nullif(p->>'seller_id',''),'source:'||coalesce(p->>'listing_id',p->>'source_id')),
  lower(btrim(p->>'brand')),lower(btrim(coalesce(nullif(p->>'reference',''),p->>'model'))),
  lower(btrim(p->>'dial_color')),lower(btrim(p->>'condition')),p->>'year',
  (p->>'price_usd')::numeric
 )::text,'UTF8')),'hex') END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.research_offer_group_key_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE wf_canonical_staging.research_snapshot_admission_v2 (
 snapshot_id uuid NOT NULL REFERENCES wf_canonical_staging.keyset_snapshot_registry(snapshot_id) ON DELETE CASCADE,
 listing_id text NOT NULL,
 cohort_key jsonb NOT NULL,
 offer_group_key text NOT NULL,
 representative_listing_id text NOT NULL,
 exclusion_reason text CHECK(exclusion_reason IN ('REPOST_DUPLICATE','BELOW_MARKET_PLAUSIBILITY_FLOOR','BELOW_IQR_FENCE','ABOVE_IQR_FENCE')),
 plausibility_floor numeric NOT NULL,
 plausible_cohort_count bigint NOT NULL,
 q1 numeric,q3 numeric,lower_fence numeric,upper_fence numeric,
 PRIMARY KEY(snapshot_id,listing_id)
);
ALTER TABLE wf_canonical_staging.research_snapshot_admission_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.research_snapshot_admission_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX research_admitted_members_v2 ON wf_canonical_staging.research_snapshot_admission_v2(snapshot_id,listing_id) WHERE exclusion_reason IS NULL;
ALTER TABLE wf_canonical_staging.keyset_snapshot_registry ADD COLUMN research_display_count bigint;

CREATE FUNCTION wf_canonical_staging.freeze_research_admission_v2(p_snapshot uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=p_snapshot AND surface='price_research' AND data_snapshot_id IS NULL AND research_display_count IS NULL) THEN
  RAISE EXCEPTION 'research_admission_requires_new_root';
 END IF;
 INSERT INTO wf_canonical_staging.research_snapshot_admission_v2
 WITH candidates AS MATERIALIZED (
  SELECT m.listing_id,m.price_usd,m.source_created_at,
   jsonb_build_array(lower(btrim(m.payload->>'brand')),
    CASE WHEN nullif(m.payload->>'reference','') IS NOT NULL THEN 'reference' ELSE 'model' END,
    lower(btrim(coalesce(nullif(m.payload->>'reference',''),m.payload->>'model'))),
    m.payload->>'dial_color',m.payload->>'condition') cohort_key,
   wf_canonical_staging.research_offer_group_key_v2(m.payload) group_key,
   nullif(btrim(m.payload->>'dial_color'),'') IS NOT NULL AND nullif(btrim(m.payload->>'condition'),'') IS NOT NULL complete_cohort
  FROM wf_canonical_staging.keyset_snapshot_members m WHERE m.snapshot_id=p_snapshot
 ), ranked AS MATERIALIZED (
  SELECT c.*,row_number() OVER offer_order duplicate_rank,first_value(c.listing_id) OVER offer_order representative
  FROM candidates c WINDOW offer_order AS(PARTITION BY group_key ORDER BY source_created_at DESC NULLS LAST,listing_id ASC)
 ), floors AS (
  SELECT cohort_key,greatest(1000::numeric,round(percentile_cont(0.5) WITHIN GROUP(ORDER BY price_usd)::numeric*0.25)) floor
  FROM ranked WHERE duplicate_rank=1 GROUP BY cohort_key
 ), quartiles AS (
  SELECT r.cohort_key,count(*) n,percentile_cont(0.25) WITHIN GROUP(ORDER BY r.price_usd)::numeric q1,
   percentile_cont(0.75) WITHIN GROUP(ORDER BY r.price_usd)::numeric q3
  FROM ranked r JOIN floors f USING(cohort_key) WHERE duplicate_rank=1 AND price_usd>=f.floor GROUP BY r.cohort_key
 )
 SELECT p_snapshot,r.listing_id,r.cohort_key,r.group_key,r.representative,
  CASE WHEN r.duplicate_rank>1 THEN 'REPOST_DUPLICATE'
   WHEN r.price_usd<f.floor THEN 'BELOW_MARKET_PLAUSIBILITY_FLOOR'
   WHEN r.complete_cohort AND q.n>=2 AND r.price_usd<greatest(0,q.q1-3*(q.q3-q.q1)) THEN 'BELOW_IQR_FENCE'
   WHEN r.complete_cohort AND q.n>=2 AND r.price_usd>q.q3+3*(q.q3-q.q1) THEN 'ABOVE_IQR_FENCE' END,
  f.floor,coalesce(q.n,0),q.q1,q.q3,
  CASE WHEN r.complete_cohort AND q.n>=2 THEN greatest(0,q.q1-3*(q.q3-q.q1)) END,
  CASE WHEN r.complete_cohort AND q.n>=2 THEN q.q3+3*(q.q3-q.q1) END
 FROM ranked r JOIN floors f USING(cohort_key) LEFT JOIN quartiles q USING(cohort_key);
 UPDATE wf_canonical_staging.keyset_snapshot_registry SET research_display_count=(
  SELECT count(*) FROM wf_canonical_staging.research_snapshot_admission_v2 WHERE snapshot_id=p_snapshot AND exclusion_reason IS NULL
 ) WHERE snapshot_id=p_snapshot;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.freeze_research_admission_v2(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE definition text; name text; signature regprocedure; replacement text;
 pattern text='(?is)coalesce\(\s*nullif\(v\.duplicate_group_id,\s*''''\),.*?\)\s+as group_key';
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.materialize_price_research_snapshot(integer)'::regprocedure);
 IF strpos(definition,'RETURN v_id;')=0 THEN RAISE EXCEPTION 'research_materializer_definition_mismatch'; END IF;
 EXECUTE replace(definition,'RETURN v_id;','PERFORM wf_canonical_staging.freeze_research_admission_v2(v_id); RETURN v_id;');
 FOREACH name IN ARRAY ARRAY['get_price_research_canary_keyset_v4','get_price_research_snapshot_count','get_price_research_snapshot_dial_facets','get_price_research_snapshot_facets'] LOOP
  SELECT p.oid::regprocedure INTO STRICT signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
  definition=pg_get_functiondef(signature);
  IF name IN ('get_price_research_snapshot_dial_facets','get_price_research_snapshot_facets') THEN
   replacement='member.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)';
   IF strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'research_facet_definition_mismatch'; END IF;
   definition=replace(definition,replacement,replacement||' AND EXISTS(SELECT 1 FROM wf_canonical_staging.research_snapshot_admission_v2 a WHERE a.snapshot_id=member.snapshot_id AND a.listing_id=member.listing_id AND a.exclusion_reason IS NULL)');
  ELSE
   replacement='m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)';
   IF strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'research_reader_definition_mismatch'; END IF;
   definition=replace(definition,replacement,replacement||' AND '||CASE WHEN name='get_price_research_snapshot_count' THEN '(p_demand OR ' ELSE '(' END||'EXISTS(SELECT 1 FROM wf_canonical_staging.research_snapshot_admission_v2 a WHERE a.snapshot_id=m.snapshot_id AND a.listing_id=m.listing_id AND a.exclusion_reason IS NULL))');
   IF name='get_price_research_snapshot_count' THEN
    replacement='SELECT member_count FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=p_snapshot_id';
    IF strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'research_count_definition_mismatch'; END IF;
    definition=replace(definition,replacement,'SELECT research_display_count FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=wf_canonical_staging.snapshot_data_id(p_snapshot_id)');
   END IF;
  END IF;
  EXECUTE definition;
 END LOOP;
 -- Statistics and card membership use the same unambiguous offer identity.
 -- Equal display names and rounded prices are not identity evidence.
 FOREACH name IN ARRAY ARRAY['get_price_research_snapshot_stats','get_price_research_snapshot_membership','get_price_research_snapshot_breakdown'] LOOP
  SELECT p.oid::regprocedure INTO STRICT signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
  definition=pg_get_functiondef(signature);
  IF (SELECT count(*) FROM regexp_matches(definition,pattern,'g'))<>1 THEN RAISE EXCEPTION 'research_offer_definition_mismatch:%',name; END IF;
  definition=regexp_replace(definition,pattern,'wf_canonical_staging.research_offer_group_key_v2(to_jsonb(v)) AS group_key');
  definition=replace(definition,'c.source_created_at DESC,','c.source_created_at DESC NULLS LAST,');
  EXECUTE definition;
 END LOOP;
END $$;
-- Previous candidate snapshots remain private evidence. Their public cursors
-- expire explicitly; a new publication revision builds the admission ledger.
UPDATE wf_canonical_staging.keyset_snapshot_registry SET expires_at=least(expires_at,pg_catalog.now());
UPDATE wf_canonical_staging.publication_revision SET revision=revision+1 WHERE singleton;
COMMIT;
