-- Phase 5.1: corrective forward migration for snapshot keyset pagination.
-- Supersedes the v3 page RPCs from 20260905140000 (which is NOT edited, per
-- the forward-only rule). PG15-safe. No DROP ... CASCADE. No OWNER changes.
--
-- F1 (HIGH, C2): v3 returned SETOF <live view>, so clients built cursors from
--   LIVE payload columns while the keyset predicate compared FROZEN member
--   columns. A mid-traversal UPDATE landing at a page boundary diverged the
--   cursor from the member key: price-up -> 50/50 duplicate pages + infinite
--   loop; price-down -> remaining members silently omitted. v4 page RPCs
--   return the FROZEN member key columns (k_priced_rank, k_image_rank,
--   k_price_usd, k_source_created_at, k_listing_id) alongside the live payload
--   (payload jsonb). API contract: cursors MUST be built ONLY from the frozen
--   k_* fields. Payload values may legitimately differ from frozen keys under
--   concurrent update; that divergence is the truthful evidence state (live
--   payload = current truth, frozen keys = snapshot ordering).
--
-- F2 (LOW, C2): cursor-to-membership binding. v4 validates that the cursor's
--   listing_id is a member of the snapshot AND that the supplied key tuple
--   exactly equals the member's frozen key; any mismatch ->
--   22023 invalid_cursor (fail closed, no silent repositioning). Fabricated
--   cursors for listing_ids not in the snapshot are rejected.
--
-- The v3 page RPCs are dropped (they exist only in the committed-but-unapplied
-- 140000 migration; DROP without CASCADE fails loudly if any dependent exists
-- -- none may). Snapshot tables, open_* and prune_* functions are unchanged.
BEGIN;

DROP FUNCTION IF EXISTS public.get_trading_floor_canary_keyset_v3(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text);
DROP FUNCTION IF EXISTS public.get_price_research_canary_keyset_v3(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text);

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
    -- F2: cursor-to-membership binding (fail closed).
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
    to_jsonb(v) AS payload
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
    to_jsonb(v) AS payload
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

-- Least privilege (consistent with Phase 3). v4 only; v3 no longer exists.
REVOKE ALL ON FUNCTION public.get_trading_floor_canary_keyset_v4(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_canary_keyset_v4(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_keyset_v4(uuid,integer,text,text,text,text,text,text,text,boolean,boolean,integer,integer,numeric,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_canary_keyset_v4(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) TO service_role;

COMMIT;
