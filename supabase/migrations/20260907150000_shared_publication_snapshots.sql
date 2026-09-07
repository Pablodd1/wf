-- Share immutable payload snapshots within a committed publication revision.
-- A source statement advances the revision transactionally. Multiple readers
-- serialize only cache creation; a million-row copy is performed once per
-- published batch and surface, never once per browsing session.
-- Publishers must batch a cohort in one transaction and prewarm both surfaces.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE wf_canonical_staging.publication_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0
);
INSERT INTO wf_canonical_staging.publication_revision DEFAULT VALUES;
ALTER TABLE wf_canonical_staging.publication_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.publication_revision FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE wf_canonical_staging.keyset_snapshot_registry ADD COLUMN publication_revision bigint;
CREATE INDEX keyset_snapshot_publication_revision ON wf_canonical_staging.keyset_snapshot_registry
  (surface, publication_revision, expires_at DESC);

CREATE FUNCTION wf_canonical_staging.advance_publication_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE wf_canonical_staging.publication_revision SET revision = revision + 1 WHERE singleton;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.advance_publication_revision() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER advance_publication_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
ON wf_canonical_staging.mariadb_canary_published_listings_v2
FOR EACH STATEMENT EXECUTE FUNCTION wf_canonical_staging.advance_publication_revision();

CREATE OR REPLACE FUNCTION wf_canonical_staging.materialize_trading_floor_snapshot(p_ttl_seconds integer DEFAULT 3600)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_count int;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_ttl: p_ttl_seconds must be between 60 and 86400' USING ERRCODE = '22023';
  END IF;
  INSERT INTO wf_canonical_staging.keyset_snapshot_registry (surface, expires_at)
  VALUES ('trading_floor', pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds))
  RETURNING snapshot_id INTO v_id;
  INSERT INTO wf_canonical_staging.keyset_snapshot_members
    (snapshot_id, priced_rank, image_rank, price_usd, source_created_at, listing_id, payload)
  SELECT v_id, v.priced_rank, v.image_rank, v.price_usd, v.source_created_at, v.listing_id, to_jsonb(v)
  FROM public.trading_floor_ready_view_v2 v;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE wf_canonical_staging.keyset_snapshot_registry SET member_count = v_count
  WHERE snapshot_id = v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.materialize_trading_floor_snapshot(integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_trading_floor_keyset_snapshot(p_ttl_seconds integer DEFAULT 3600)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_revision bigint; v_id uuid;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_ttl' USING ERRCODE = '22023';
  END IF;
  -- The same lock is acquired by the statement trigger before source commit.
  -- A reader sees both a committed revision and its committed source data.
  SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision
    WHERE singleton FOR UPDATE;
  SELECT snapshot_id INTO v_id FROM wf_canonical_staging.keyset_snapshot_registry
    WHERE surface = 'trading_floor' AND publication_revision = v_revision
      AND expires_at > pg_catalog.now()
    ORDER BY expires_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    v_id := wf_canonical_staging.materialize_trading_floor_snapshot(p_ttl_seconds);
    UPDATE wf_canonical_staging.keyset_snapshot_registry SET publication_revision = v_revision
      WHERE snapshot_id = v_id;
  ELSE
    -- Reuse never rewrites payloads or ordering keys. An expired revision is
    -- never resurrected; its cursors continue to fail closed.
    UPDATE wf_canonical_staging.keyset_snapshot_registry
      SET expires_at = greatest(expires_at, pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds))
      WHERE snapshot_id = v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.open_trading_floor_keyset_snapshot(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_trading_floor_keyset_snapshot(integer) TO service_role;

CREATE OR REPLACE FUNCTION wf_canonical_staging.materialize_price_research_snapshot(p_ttl_seconds integer DEFAULT 3600)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_count int;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_ttl: p_ttl_seconds must be between 60 and 86400' USING ERRCODE = '22023';
  END IF;
  INSERT INTO wf_canonical_staging.keyset_snapshot_registry (surface, expires_at)
  VALUES ('price_research', pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds))
  RETURNING snapshot_id INTO v_id;
  INSERT INTO wf_canonical_staging.keyset_snapshot_members
    (snapshot_id, priced_rank, image_rank, price_usd, source_created_at, listing_id, payload)
  SELECT v_id, v.priced_rank, v.image_rank, v.price_usd, v.source_created_at, v.listing_id, to_jsonb(v)
  FROM public.price_research_ready_view_v2 v;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE wf_canonical_staging.keyset_snapshot_registry SET member_count = v_count
  WHERE snapshot_id = v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.materialize_price_research_snapshot(integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_price_research_keyset_snapshot(p_ttl_seconds integer DEFAULT 3600)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_revision bigint; v_id uuid;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_ttl' USING ERRCODE = '22023';
  END IF;
  -- The same lock is acquired by the statement trigger before source commit.
  -- A reader sees both a committed revision and its committed source data.
  SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision
    WHERE singleton FOR UPDATE;
  PERFORM public.open_trading_floor_keyset_snapshot(p_ttl_seconds);
  SELECT snapshot_id INTO v_id FROM wf_canonical_staging.keyset_snapshot_registry
    WHERE surface = 'price_research' AND publication_revision = v_revision
      AND expires_at > pg_catalog.now()
    ORDER BY expires_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    v_id := wf_canonical_staging.materialize_price_research_snapshot(p_ttl_seconds);
    UPDATE wf_canonical_staging.keyset_snapshot_registry SET publication_revision = v_revision
      WHERE snapshot_id = v_id;
  ELSE
    -- Reuse never rewrites payloads or ordering keys. An expired revision is
    -- never resurrected; its cursors continue to fail closed.
    UPDATE wf_canonical_staging.keyset_snapshot_registry
      SET expires_at = greatest(expires_at, pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds))
      WHERE snapshot_id = v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.open_price_research_keyset_snapshot(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_price_research_keyset_snapshot(integer) TO service_role;

COMMIT;
