-- A source message may live in title/comments while the legacy raw_message
-- convenience column records description. Accept its exact materialized proof.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE INDEX materialized_single_versions_v2_source_dealer
 ON wf_canonical_staging.materialized_single_versions_v2(raw_row_id,source_hash)
 WHERE outcome='ELIGIBLE';
DO $migration$
DECLARE definition text;needle text='OR r.raw_message IS DISTINCT FROM v.raw_message_text';
 replacement text=$replacement$OR (r.raw_message IS DISTINCT FROM v.raw_message_text AND NOT EXISTS (
   SELECT 1 FROM wf_canonical_staging.materialized_single_versions_v2 material
   JOIN wf_canonical_staging.normalization_job_members_v2 member ON member.job_name=material.job_name
    AND member.raw_row_id=material.raw_row_id AND member.source_hash=material.source_hash
    AND member.proposal_hash=material.proposal_hash AND member.outcome='NORMALIZED'
   WHERE material.raw_row_id=r.id AND material.source_hash=r.source_hash AND material.outcome='ELIGIBLE'
    AND material.document->>'listing_id'=v.listing_id AND material.document->>'raw_message_id'=r.id::text
    AND material.document->>'raw_message_text'=v.raw_message_text
    AND v.raw_message_text IN(r.raw_payload->>'description',r.raw_payload->>'title',r.raw_payload->>'comments')
    AND material.document=material.evidence_document->'document'
    AND encode(sha256(convert_to(material.evidence_document::text,'UTF8')),'hex')=material.materialization_hash
  ))$replacement$;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.resolve_v2_source_dealer(text)'::regprocedure),chr(13),'');
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'dealer_source_text_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $migration$;
UPDATE wf_canonical_staging.publication_revision SET revision=revision+1 WHERE singleton;
SELECT public.open_trading_floor_keyset_snapshot(3600);
SELECT public.open_price_research_keyset_snapshot(3600);
COMMIT;
