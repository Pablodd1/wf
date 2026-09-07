-- Phase 5: stable keyset pagination via immutable publication snapshots.
-- PG15-compatible. No DROP ... CASCADE. No ALTER ... OWNER. Additive only;
-- existing v2 keyset RPCs are untouched (new _v3 names, new tables).
--
-- Design choice (documented per mission): an immutable per-snapshot copy of
-- the five ordering columns (priced_rank, image_rank, price_usd,
-- source_created_at, listing_id) plus the listing_id FK. The full row is NOT
-- copied (storage vs correctness trade-off): membership and ordering are
-- frozen, so inserts and in-place updates of the live table can never cause
-- duplicates or omissions inside a snapshot traversal. Rows DELETED mid-
-- traversal are omitted from subsequent pages (fail-closed, no phantom rows)
-- because the page query joins the live view; this is the documented
-- tombstone semantic.
--
-- Snapshot cursors: {snapshot_id, key:[5 values]}. Unknown or expired
-- snapshot -> SQLSTATE 22023 with message marker 'snapshot_expired' so the
-- API layer can map it to HTTP 400 deterministically.
BEGIN;

CREATE TABLE IF NOT EXISTS wf_canonical_staging.keyset_snapshot_registry (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface text NOT NULL CHECK (surface IN ('trading_floor', 'price_research')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  member_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wf_canonical_staging.keyset_snapshot_members (
  snapshot_id uuid NOT NULL
    REFERENCES wf_canonical_staging.keyset_snapshot_registry(snapshot_id) ON DELETE CASCADE,
  priced_rank int NOT NULL,
  image_rank int NOT NULL,
  price_usd numeric,
  source_created_at timestamptz NOT NULL,
  listing_id text NOT NULL,
  PRIMARY KEY (snapshot_id, listing_id)
);

-- Matches the five-field keyset order exactly; per-snapshot equality first.
CREATE INDEX IF NOT EXISTS idx_keyset_snapshot_members_order
ON wf_canonical_staging.keyset_snapshot_members (
  snapshot_id, priced_rank, image_rank,
  price_usd DESC NULLS LAST, source_created_at DESC, listing_id ASC
);

-- ---------------------------------------------------------------------------
-- Snapshot constructors. SECURITY DEFINER with pinned search_path so no
-- direct table grants on the snapshot tables are needed at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_trading_floor_keyset_snapshot(p_ttl_seconds integer DEFAULT 3600)
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
    (snapshot_id, priced_rank, image_rank, price_usd, source_created_at, listing_id)
  SELECT v_id, v.priced_rank, v.image_rank, v.price_usd, v.source_created_at, v.listing_id
  FROM public.trading_floor_ready_view_v2 v;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE wf_canonical_staging.keyset_snapshot_registry SET member_count = v_count
  WHERE snapshot_id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_price_research_keyset_snapshot(p_ttl_seconds integer DEFAULT 3600)
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
    (snapshot_id, priced_rank, image_rank, price_usd, source_created_at, listing_id)
  SELECT v_id, v.priced_rank, v.image_rank, v.price_usd, v.source_created_at, v.listing_id
  FROM public.price_research_ready_view_v2 v;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE wf_canonical_staging.keyset_snapshot_registry SET member_count = v_count
  WHERE snapshot_id = v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot expiry sweep (FK ON DELETE CASCADE removes members).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_keyset_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM wf_canonical_staging.keyset_snapshot_registry
  WHERE expires_at <= pg_catalog.now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- Trading Floor v3 snapshot keyset page. Filters apply to the live view row;
-- membership and ordering come exclusively from the immutable snapshot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trading_floor_canary_keyset_v3(
  p_snapshot_id uuid,
  p_limit integer DEFAULT 50,
  p_brand text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_intent text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_images_only boolean DEFAULT false,
  p_priced_only boolean DEFAULT false,
  p_cursor_priced_rank integer DEFAULT NULL,
  p_cursor_image_rank integer DEFAULT NULL,
  p_cursor_price_usd numeric DEFAULT NULL,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_listing_id text DEFAULT NULL
)
RETURNS SETOF public.trading_floor_ready_view_v2
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_limit: page limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF cursor_supplied AND (
    p_cursor_priced_rank NOT IN (1, 2)
    OR p_cursor_image_rank NOT IN (1, 2)
    OR p_cursor_created_at IS NULL
    OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_cursor: malformed composite cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT v.*
  FROM wf_canonical_staging.keyset_snapshot_members m
  JOIN public.trading_floor_ready_view_v2 v ON v.listing_id = m.listing_id
  WHERE m.snapshot_id = p_snapshot_id
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (p_intent IS NULL OR v.intent = upper(p_intent))
    AND (p_category IS NULL
         OR lower(v.category) = lower(p_category)
         OR (lower(p_category) = 'watches' AND lower(v.category) = 'wristwatches')
         OR (lower(p_category) = 'wristwatches' AND lower(v.category) = 'watches'))
    AND (p_country IS NULL OR lower(v.location_country) = lower(p_country))
    AND (p_region IS NULL OR lower(v.location_region) = lower(p_region))
    AND (NOT p_images_only OR (v.image_status = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(v.image_key), '') IS NOT NULL))
    AND (NOT p_priced_only OR (v.price_usd IS NOT NULL AND v.price_usd > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(v.reference, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.model, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.title, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.brand, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.raw_message_text, '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(v.seller_display_name, '')) LIKE '%' || lower(p_query) || '%'
    ))
    AND (NOT cursor_supplied OR (
         m.priced_rank > p_cursor_priced_rank
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank > p_cursor_image_rank)
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND (p_cursor_price_usd IS NOT NULL AND (m.price_usd < p_cursor_price_usd OR m.price_usd IS NULL)))
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND m.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND m.source_created_at < p_cursor_created_at)
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND m.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND m.source_created_at = p_cursor_created_at
          AND m.listing_id > p_cursor_listing_id)
    ))
  ORDER BY m.priced_rank ASC, m.image_rank ASC,
           m.price_usd DESC NULLS LAST, m.source_created_at DESC, m.listing_id ASC
  LIMIT p_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Price Research v3 snapshot keyset page (qualified WTS surface).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_price_research_canary_keyset_v3(
  p_snapshot_id uuid,
  p_limit integer DEFAULT 50,
  p_brand text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL,
  p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL,
  p_filter_condition boolean DEFAULT false,
  p_cursor_priced_rank integer DEFAULT NULL,
  p_cursor_image_rank integer DEFAULT NULL,
  p_cursor_price_usd numeric DEFAULT NULL,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_listing_id text DEFAULT NULL
)
RETURNS SETOF public.price_research_ready_view_v2
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_limit: page limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.surface = 'price_research'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF cursor_supplied AND (
    p_cursor_priced_rank NOT IN (1, 2)
    OR p_cursor_image_rank NOT IN (1, 2)
    OR p_cursor_created_at IS NULL
    OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_cursor: malformed composite cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT v.*
  FROM wf_canonical_staging.keyset_snapshot_members m
  JOIN public.price_research_ready_view_v2 v ON v.listing_id = m.listing_id
  WHERE m.snapshot_id = p_snapshot_id
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
    AND (NOT cursor_supplied OR (
         m.priced_rank > p_cursor_priced_rank
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank > p_cursor_image_rank)
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND (p_cursor_price_usd IS NOT NULL AND (m.price_usd < p_cursor_price_usd OR m.price_usd IS NULL)))
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND m.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND m.source_created_at < p_cursor_created_at)
      OR (m.priced_rank = p_cursor_priced_rank AND m.image_rank = p_cursor_image_rank
          AND m.price_usd IS NOT DISTINCT FROM p_cursor_price_usd
          AND m.source_created_at = p_cursor_created_at
          AND m.listing_id > p_cursor_listing_id)
    ))
  ORDER BY m.priced_rank ASC, m.image_rank ASC,
           m.price_usd DESC NULLS LAST, m.source_created_at DESC, m.listing_id ASC
  LIMIT p_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege, consistent with Phase 3 hardening. Snapshot tables get NO
-- direct grants (all access flows through the SECURITY DEFINER RPCs).
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA wf_canonical_staging FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON wf_canonical_staging.mariadb_canary_published_listings_v2 TO service_role;

REVOKE ALL ON FUNCTION public.open_trading_floor_keyset_snapshot(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_price_research_keyset_snapshot(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_keyset_snapshots() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_trading_floor_canary_keyset_v3(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_canary_keyset_v3(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.open_trading_floor_keyset_snapshot(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_price_research_keyset_snapshot(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_keyset_snapshots() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_keyset_v3(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_canary_keyset_v3(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) TO service_role;

COMMIT;
