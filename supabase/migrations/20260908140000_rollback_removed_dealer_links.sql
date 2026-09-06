BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE definition text; needle text='PERFORM public.reconcile_v2_listing_dealers(ids);'; replacement text=$replacement$
  IF EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=ANY(ids)) THEN
   PERFORM public.reconcile_v2_listing_dealers((SELECT array_agg(listing_id) FROM wf_canonical_staging.mariadb_canary_published_listings_v2 WHERE listing_id=ANY(ids)));
  END IF;
  -- Removed exposures keep a durable linkage outcome and the existing private
  -- version trigger retains the prior evidence. No dangling contact is approved.
  UPDATE public.seller_listing_lineage_staging link SET source_identity='',match_status='REVIEW_REQUIRED',matched_dealer_id=NULL,
   match_evidence=link.match_evidence||jsonb_build_object('reason','PUBLICATION_ROLLED_BACK'),updated_at=now()
  WHERE link.source_system='WF_V2_SOURCE_BOUND' AND link.source_record_id=ANY(ids)
   AND NOT EXISTS(SELECT 1 FROM wf_canonical_staging.mariadb_canary_published_listings_v2 c WHERE c.listing_id=link.source_record_id);
$replacement$;
BEGIN
 definition=pg_get_functiondef('public.rollback_materialized_batch_v2(text,bigint)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'rollback_dealer_binding_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $migration$;
COMMIT;
