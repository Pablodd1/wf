-- Broad reconciliation is owner-prepared once per publication, not recomputed
-- across a million rows in each customer request. Exact filters stay indexed.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.publication_research_summaries_v2 (
 publication_revision bigint PRIMARY KEY,breakdown jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wf_canonical_staging.publication_research_summaries_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.publication_research_summaries_v2 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) SET SCHEMA wf_canonical_staging;
ALTER FUNCTION wf_canonical_staging.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) RENAME TO compute_research_snapshot_breakdown_v2;
ALTER FUNCTION wf_canonical_staging.compute_research_snapshot_breakdown_v2(uuid,text,text,text,text,boolean,text,boolean) SET enable_nestloop TO off;
REVOKE ALL ON FUNCTION wf_canonical_staging.compute_research_snapshot_breakdown_v2(uuid,text,text,text,text,boolean,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE definition text;start_at integer;end_at integer;
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.compute_research_snapshot_breakdown_v2(uuid,text,text,text,text,boolean,text,boolean)'::regprocedure);
 start_at=strpos(definition,' -- A Trading Floor-only caller');end_at=strpos(definition,' RETURN QUERY WITH scoped');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'research_compute_definition_mismatch'; END IF;
 -- The immutable summary receipt verifies complete publication preparation.
 -- Repeating a full-table anti-join for each narrow cohort defeats its index.
 EXECUTE substr(definition,1,start_at-1)||substr(definition,end_at);
END $$;

CREATE FUNCTION wf_canonical_staging.prepare_research_summary_v2(p_research_snapshot uuid,p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET enable_nestloop=off AS $$
DECLARE pr wf_canonical_staging.keyset_snapshot_registry;tf wf_canonical_staging.keyset_snapshot_registry;
 summary jsonb;prior jsonb;outcomes bigint;
BEGIN
 SELECT * INTO STRICT pr FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=p_research_snapshot AND surface='price_research' AND data_snapshot_id IS NULL;
 SELECT * INTO tf FROM wf_canonical_staging.keyset_snapshot_registry WHERE surface='trading_floor' AND publication_revision=p_revision AND expires_at>now() ORDER BY expires_at DESC,snapshot_id LIMIT 1;
 IF NOT FOUND OR pr.research_display_count IS NULL THEN RAISE EXCEPTION 'research_summary_requires_prepared_pair'; END IF;
 SELECT count(*) INTO outcomes FROM wf_canonical_staging.publication_research_outcomes_v2 WHERE publication_revision=p_revision;
 IF outcomes<>pr.member_count THEN RAISE EXCEPTION 'research_summary_outcome_count_mismatch'; END IF;
 SELECT to_jsonb(s) INTO summary FROM wf_canonical_staging.compute_research_snapshot_breakdown_v2(tf.snapshot_id,NULL) s;
 IF (summary->>'source_observations')::bigint<>tf.member_count OR (summary->>'included_count')::bigint<>pr.research_display_count
  OR (summary->>'source_observations')::bigint<>(summary->>'included_count')::bigint+(summary->>'excluded_duplicates')::bigint
   +(summary->>'excluded_ambiguous_currency')::bigint+(summary->>'excluded_unsupported_fx')::bigint+(summary->>'excluded_implausible')::bigint
   +(summary->>'excluded_iqr_outliers')::bigint+(summary->>'excluded_not_wts')::bigint+(summary->>'excluded_ineligible_flag')::bigint THEN
  RAISE EXCEPTION 'research_summary_unreconciled'; END IF;
 SELECT breakdown INTO prior FROM wf_canonical_staging.publication_research_summaries_v2 WHERE publication_revision=p_revision;
 IF FOUND AND prior IS DISTINCT FROM summary THEN RAISE EXCEPTION 'research_summary_replay_changed'; END IF;
 INSERT INTO wf_canonical_staging.publication_research_summaries_v2(publication_revision,breakdown) VALUES(p_revision,summary) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.prepare_research_summary_v2(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_price_research_snapshot_breakdown(p_snapshot_id uuid,p_brand text,p_reference text DEFAULT NULL,p_model text DEFAULT NULL,p_dial_color text DEFAULT NULL,p_filter_dial boolean DEFAULT false,p_condition text DEFAULT NULL,p_filter_condition boolean DEFAULT false)
RETURNS TABLE(source_observations bigint,wts_count bigint,wtb_count bigint,unique_qualified_offers bigint,included_count bigint,excluded_duplicates bigint,excluded_ambiguous_currency bigint,excluded_unsupported_fx bigint,excluded_implausible bigint,excluded_iqr_outliers bigint,excluded_not_wts bigint,excluded_ineligible_flag bigint,plausibility_floor numeric,retained_audit_evidence_count bigint,iqr_multiplier numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE summary jsonb;
BEGIN
 PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id,'trading_floor');
 SELECT s.breakdown INTO summary FROM wf_canonical_staging.publication_research_summaries_v2 s JOIN wf_canonical_staging.keyset_snapshot_registry r USING(publication_revision) WHERE r.snapshot_id=p_snapshot_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'research_summary_not_prepared'; END IF;
 IF p_brand IS NULL AND p_reference IS NULL AND p_model IS NULL AND NOT p_filter_dial AND NOT p_filter_condition THEN
  RETURN QUERY SELECT * FROM jsonb_to_record(summary) AS s(source_observations bigint,wts_count bigint,wtb_count bigint,unique_qualified_offers bigint,included_count bigint,excluded_duplicates bigint,excluded_ambiguous_currency bigint,excluded_unsupported_fx bigint,excluded_implausible bigint,excluded_iqr_outliers bigint,excluded_not_wts bigint,excluded_ineligible_flag bigint,plausibility_floor numeric,retained_audit_evidence_count bigint,iqr_multiplier numeric);
 ELSE
  RETURN QUERY SELECT * FROM wf_canonical_staging.compute_research_snapshot_breakdown_v2(p_snapshot_id,p_brand,p_reference,p_model,p_dial_color,p_filter_dial,p_condition,p_filter_condition);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_breakdown(uuid,text,text,text,text,boolean,text,boolean) TO service_role;
DO $$
DECLARE definition text;needle text='PERFORM wf_canonical_staging.freeze_research_admission_v2(v_id); RETURN v_id;';
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.materialize_price_research_snapshot(integer)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'research_materializer_summary_hook_mismatch'; END IF;
 EXECUTE replace(definition,needle,'PERFORM wf_canonical_staging.freeze_research_admission_v2(v_id); PERFORM wf_canonical_staging.prepare_research_summary_v2(v_id,(SELECT revision FROM wf_canonical_staging.publication_revision WHERE singleton)); RETURN v_id;');
END $$;
-- Existing revisions require an explicit owner preparation call before their
-- research API is enabled. No unbounded historical backfill runs in migration.
NOTIFY pgrst,'reload schema';
COMMIT;
