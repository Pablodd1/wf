BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('wf_canonical_staging.research_offer_group_key_v2(jsonb)'::regprocedure);
 IF strpos(definition,'(p->>''price_usd'')::numeric')=0 THEN RAISE EXCEPTION 'offer_numeric_definition_mismatch'; END IF;
 EXECUTE replace(definition,'(p->>''price_usd'')::numeric','pg_catalog.trim_scale((p->>''price_usd'')::numeric)::text');
END $$;
-- SQL numeric equality must survive different harmless decimal scales. Renew
-- the publication before exposing this corrected identity calculation.
UPDATE wf_canonical_staging.keyset_snapshot_registry SET expires_at=least(expires_at,pg_catalog.now());
UPDATE wf_canonical_staging.publication_revision SET revision=revision+1 WHERE singleton;
COMMIT;
