-- A missing source date is not a reason to invent a posting timestamp.
-- The internal cursor sentinel implements descending NULLS LAST only; the
-- immutable display payload retains its real NULL source_created_at value.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2 ALTER COLUMN source_created_at DROP NOT NULL;
DO $$
DECLARE name text; definition text; needle text='v.price_usd, v.source_created_at, v.listing_id, to_jsonb(v)';
BEGIN
 FOREACH name IN ARRAY ARRAY['materialize_trading_floor_snapshot','materialize_price_research_snapshot'] LOOP
  definition=pg_get_functiondef(format('wf_canonical_staging.%I(integer)',name)::regprocedure);
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'snapshot_source_date_definition_mismatch'; END IF;
  EXECUTE replace(definition,needle,'v.price_usd, coalesce(v.source_created_at,''0001-01-01T00:00:00Z''::timestamptz), v.listing_id, to_jsonb(v)');
 END LOOP;
END $$;
COMMIT;
