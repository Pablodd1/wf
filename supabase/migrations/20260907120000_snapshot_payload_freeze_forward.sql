-- RC50 / F2: freeze the snapshot member PAYLOAD at snapshot-open time.
-- Supersedes the documented "tombstone semantic" of 20260905140000 (live-view
-- join at page time) and the live-payload behavior of the v4/v3 page RPCs in
-- 20260905160000 / 20260905170000. Forward-only: no old migration is edited,
-- no DROP ... CASCADE, no OWNER changes, no signature changes. PG15-safe.
--
-- Finding (RC50 review F2, MEDIUM): the v4 keyset RPCs read frozen ordering
-- keys from wf_canonical_staging.keyset_snapshot_members but JOINed the LIVE
-- view for `payload`, so a member-row DELETE mid-traversal silently shrank a
-- "frozen" snapshot's traversal (50 -> 49) and a mid-traversal UPDATE could
-- change filter membership. The snapshot contract requires an immutable
-- snapshot: the original cursor traversal must keep returning the exact
-- original identities AND their original (freeze-time) payloads.
--
-- Fix: materialize the view row (to_jsonb) into a new payload column at
-- snapshot-open time, from the exact same source the live join used
-- (trading_floor_ready_view_v2 for trading_floor snapshots,
-- price_research_ready_view_v2 for price_research snapshots). The page RPCs
-- now read keys AND payload from the frozen member row; all filter predicates
-- evaluate against the frozen payload, so inserts, updates, AND deletes of
-- live rows are invisible to an open snapshot. A fresh snapshot sees current
-- data (unchanged). Cursor envelope, k_* fields, ordering, and API contract
-- are unchanged.
BEGIN;

-- 1. New frozen payload column (nullable in the DDL so pre-existing,
--    not-yet-expired snapshot members do not violate anything; backfilled
--    below from the same live views the RPCs previously joined).
ALTER TABLE wf_canonical_staging.keyset_snapshot_members
  ADD COLUMN IF NOT EXISTS payload jsonb;

-- 2. Backfill still-live snapshots (best effort; expired snapshots are
--    rejected by the RPCs anyway and prune_keyset_snapshots() removes them).
UPDATE wf_canonical_staging.keyset_snapshot_members m
SET payload = to_jsonb(v)
FROM public.trading_floor_ready_view_v2 v
WHERE m.payload IS NULL
  AND v.listing_id = m.listing_id
  AND EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = m.snapshot_id
      AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  );

UPDATE wf_canonical_staging.keyset_snapshot_members m
SET payload = to_jsonb(v)
FROM public.price_research_ready_view_v2 v
WHERE m.payload IS NULL
  AND v.listing_id = m.listing_id
  AND EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = m.snapshot_id
      AND r.surface = 'price_research'
      AND r.expires_at > pg_catalog.now()
  );

-- 3. Snapshot constructors now capture the frozen payload at open time.
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
    (snapshot_id, priced_rank, image_rank, price_usd, source_created_at, listing_id, payload)
  SELECT v_id, v.priced_rank, v.image_rank, v.price_usd, v.source_created_at, v.listing_id, to_jsonb(v)
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
    (snapshot_id, priced_rank, image_rank, price_usd, source_created_at, listing_id, payload)
  SELECT v_id, v.priced_rank, v.image_rank, v.price_usd, v.source_created_at, v.listing_id, to_jsonb(v)
  FROM public.price_research_ready_view_v2 v;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE wf_canonical_staging.keyset_snapshot_registry SET member_count = v_count
  WHERE snapshot_id = v_id;
  RETURN v_id;
END;
$$;

-- 4. Page RPCs: same names, signatures, return shape, cursor validation, and
--    ordering as the v4/v3 definitions they replace; the ONLY change is that
--    the payload and every filter predicate now come from the frozen member
--    row instead of a live join. Fail-closed cursor binding is unchanged.
CREATE OR REPLACE FUNCTION public.get_trading_floor_canary_keyset_v4(
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
RETURNS TABLE (
  k_priced_rank integer,
  k_image_rank integer,
  k_price_usd numeric,
  k_source_created_at timestamptz,
  k_listing_id text,
  payload jsonb
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
  v_member wf_canonical_staging.keyset_snapshot_members%ROWTYPE;
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
  IF cursor_supplied THEN
    IF p_cursor_priced_rank NOT IN (1, 2)
       OR p_cursor_image_rank NOT IN (1, 2)
       OR p_cursor_created_at IS NULL
       OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor: malformed composite cursor' USING ERRCODE = '22023';
    END IF;
    -- Cursor-to-membership binding (fail closed), unchanged from Phase 5.1.
    SELECT m.* INTO v_member
    FROM wf_canonical_staging.keyset_snapshot_members m
    WHERE m.snapshot_id = p_snapshot_id AND m.listing_id = p_cursor_listing_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_cursor: cursor listing_id is not a member of this snapshot' USING ERRCODE = '22023';
    END IF;
    IF v_member.priced_rank IS DISTINCT FROM p_cursor_priced_rank
       OR v_member.image_rank IS DISTINCT FROM p_cursor_image_rank
       OR v_member.price_usd IS DISTINCT FROM p_cursor_price_usd
       OR v_member.source_created_at IS DISTINCT FROM p_cursor_created_at THEN
      RAISE EXCEPTION 'invalid_cursor: cursor key does not match frozen snapshot member key' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.priced_rank, m.image_rank, m.price_usd, m.source_created_at, m.listing_id,
    m.payload
  FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = p_snapshot_id
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model))
    AND (p_intent IS NULL OR (m.payload ->> 'intent') = upper(p_intent))
    AND (p_category IS NULL
         OR lower(m.payload ->> 'category') = lower(p_category)
         OR (lower(p_category) = 'watches' AND lower(m.payload ->> 'category') = 'wristwatches')
         OR (lower(p_category) = 'wristwatches' AND lower(m.payload ->> 'category') = 'watches'))
    AND (p_country IS NULL OR lower(m.payload ->> 'location_country') = lower(p_country))
    AND (p_region IS NULL OR lower(m.payload ->> 'location_region') = lower(p_region))
    AND (NOT p_images_only OR ((m.payload ->> 'image_status') = 'SOURCE_IMAGE_PRESENT' AND NULLIF(btrim(m.payload ->> 'image_key'), '') IS NOT NULL))
    AND (NOT p_priced_only OR ((m.payload ->> 'price_usd') IS NOT NULL AND (m.payload ->> 'price_usd')::numeric > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(m.payload ->> 'reference', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'model', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'title', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'brand', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'raw_message_text', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'
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

CREATE OR REPLACE FUNCTION public.get_price_research_canary_keyset_v4(
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
RETURNS TABLE (
  k_priced_rank integer,
  k_image_rank integer,
  k_price_usd numeric,
  k_source_created_at timestamptz,
  k_listing_id text,
  payload jsonb
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
  v_member wf_canonical_staging.keyset_snapshot_members%ROWTYPE;
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
  IF cursor_supplied THEN
    IF p_cursor_priced_rank NOT IN (1, 2)
       OR p_cursor_image_rank NOT IN (1, 2)
       OR p_cursor_created_at IS NULL
       OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor: malformed composite cursor' USING ERRCODE = '22023';
    END IF;
    SELECT m.* INTO v_member
    FROM wf_canonical_staging.keyset_snapshot_members m
    WHERE m.snapshot_id = p_snapshot_id AND m.listing_id = p_cursor_listing_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_cursor: cursor listing_id is not a member of this snapshot' USING ERRCODE = '22023';
    END IF;
    IF v_member.priced_rank IS DISTINCT FROM p_cursor_priced_rank
       OR v_member.image_rank IS DISTINCT FROM p_cursor_image_rank
       OR v_member.price_usd IS DISTINCT FROM p_cursor_price_usd
       OR v_member.source_created_at IS DISTINCT FROM p_cursor_created_at THEN
      RAISE EXCEPTION 'invalid_cursor: cursor key does not match frozen snapshot member key' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.priced_rank, m.image_rank, m.price_usd, m.source_created_at, m.listing_id,
    m.payload
  FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = p_snapshot_id
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_reference IS NULL OR lower(m.payload ->> 'reference') = lower(p_reference))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model))
    AND (NOT p_filter_dial OR (m.payload ->> 'dial_color') IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR (m.payload ->> 'condition') IS NOT DISTINCT FROM p_condition)
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

-- Demand lane: same name/signature as the Phase 5.2 v3 RPC; payload and
-- filters now come from the frozen trading_floor snapshot member row (the
-- frozen payload is to_jsonb of trading_floor_ready_view_v2, exactly the
-- source the previous live join used). Demand ordering unchanged.
CREATE OR REPLACE FUNCTION public.get_price_research_wtb_demand_v3(
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
RETURNS TABLE (
  k_priced_rank integer,
  k_image_rank integer,
  k_price_usd numeric,
  k_source_created_at timestamptz,
  k_listing_id text,
  payload jsonb
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cursor_supplied boolean := p_cursor_listing_id IS NOT NULL
    OR p_cursor_priced_rank IS NOT NULL OR p_cursor_image_rank IS NOT NULL
    OR p_cursor_price_usd IS NOT NULL OR p_cursor_created_at IS NOT NULL;
  v_member wf_canonical_staging.keyset_snapshot_members%ROWTYPE;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_limit: page limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  -- Demand rows are members of TRADING FLOOR snapshots (the TF surface
  -- includes WTB listings; price_research snapshots are WTS-only).
  IF p_snapshot_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF cursor_supplied THEN
    IF p_cursor_priced_rank NOT IN (1, 2)
       OR p_cursor_image_rank NOT IN (1, 2)
       OR p_cursor_created_at IS NULL
       OR NULLIF(btrim(p_cursor_listing_id), '') IS NULL THEN
      RAISE EXCEPTION 'invalid_cursor: malformed composite cursor' USING ERRCODE = '22023';
    END IF;
    SELECT m.* INTO v_member
    FROM wf_canonical_staging.keyset_snapshot_members m
    WHERE m.snapshot_id = p_snapshot_id AND m.listing_id = p_cursor_listing_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_cursor: cursor listing_id is not a member of this snapshot' USING ERRCODE = '22023';
    END IF;
    IF v_member.priced_rank IS DISTINCT FROM p_cursor_priced_rank
       OR v_member.image_rank IS DISTINCT FROM p_cursor_image_rank
       OR v_member.price_usd IS DISTINCT FROM p_cursor_price_usd
       OR v_member.source_created_at IS DISTINCT FROM p_cursor_created_at THEN
      RAISE EXCEPTION 'invalid_cursor: cursor key does not match frozen snapshot member key' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Demand lane ordering: source_created_at DESC, listing_id ASC (frozen
  -- member columns). No OFFSET anywhere.
  RETURN QUERY
  SELECT
    m.priced_rank, m.image_rank, m.price_usd, m.source_created_at, m.listing_id,
    m.payload
  FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = p_snapshot_id
    AND (m.payload ->> 'intent') = 'WTB'
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_reference IS NULL OR lower(m.payload ->> 'reference') = lower(p_reference))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model))
    AND (NOT p_filter_dial OR (m.payload ->> 'dial_color') IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR (m.payload ->> 'condition') IS NOT DISTINCT FROM p_condition)
    AND (NOT cursor_supplied OR (
         m.source_created_at < p_cursor_created_at
      OR (m.source_created_at = p_cursor_created_at AND m.listing_id > p_cursor_listing_id)
    ))
  ORDER BY m.source_created_at DESC, m.listing_id ASC
  LIMIT p_limit;
END;
$$;

-- Least-privilege posture is inherited from the replaced definitions
-- (CREATE OR REPLACE preserves existing grants); re-asserted explicitly.
REVOKE ALL ON FUNCTION public.get_trading_floor_canary_keyset_v4(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_canary_keyset_v4(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_wtb_demand_v3(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_trading_floor_keyset_snapshot(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_price_research_keyset_snapshot(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_keyset_v4(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_canary_keyset_v4(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_wtb_demand_v3(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_trading_floor_keyset_snapshot(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_price_research_keyset_snapshot(integer) TO service_role;

COMMIT;
