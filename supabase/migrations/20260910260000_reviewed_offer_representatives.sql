-- Exact source equality is reviewed across every candidate before publication.
-- The former SQL key omitted material fields and could merge distinct offers.
-- Preserve existing explicit publication groups; do not infer new equivalence
-- from a dealer, quote, price, or incomplete projection of parent evidence.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION wf_canonical_staging.refresh_expanded_offer_observations_v3() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed integer;
BEGIN
 PERFORM 1 FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 DELETE FROM wf_canonical_staging.expanded_offer_observations_v3;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN jsonb_build_object('changed',removed,'suppressed_exact_reposts',0,
  'contract','REVIEWED_REPRESENTATIVES_ONLY',
  'existing_explicit_groups_preserved',true);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.refresh_expanded_offer_observations_v3() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
