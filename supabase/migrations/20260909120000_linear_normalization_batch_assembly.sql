-- Build the validated proposal array once. Repeated JSONB concatenation copies
-- the entire growing batch for every member without adding any validation.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition=replace(pg_get_functiondef('public.complete_normalization_batch_v2(text,uuid,jsonb)'::regprocedure),chr(13),'');
 needle='proposals=proposals||jsonb_build_array(doc);';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'normalization_batch_assembly_definition_mismatch'; END IF;
 definition=replace(definition,needle,'-- Proposal evidence remains validated below in the same transaction.');
 needle='IF jsonb_array_length(proposals)>0 THEN PERFORM public.upsert_mariadb_normalized_proposals_batch(proposals); END IF;';
 replacement=$replacement$SELECT coalesce(jsonb_agg(value->'proposal' ORDER BY ordinal),'[]'::jsonb) INTO proposals
 FROM jsonb_array_elements(p_results) WITH ORDINALITY AS inputs(value,ordinal)
 WHERE value->'proposal' IS NOT NULL AND value->'proposal'<>'null'::jsonb;
 IF jsonb_array_length(proposals)>0 THEN PERFORM public.upsert_mariadb_normalized_proposals_batch(proposals); END IF;$replacement$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'normalization_batch_persistence_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $migration$;
COMMIT;
