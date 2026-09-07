-- Phase 5.2: OFFSET-free WTB demand lane via snapshot keyset.
-- Supersedes the OFFSET-based page path of get_price_research_wtb_demand_v2
-- for canary consumers (v2 is NOT edited or dropped; legacy dependents keep
-- working). PG15-safe. No DROP CASCADE. No OWNER changes. Additive only.
--
-- Demand ordering is the demand lane's own order: source_created_at DESC,
-- listing_id ASC -- frozen through the same immutable snapshot mechanism as
-- Phase 5/5.1 (keyset_snapshot_members rows captured by
-- open_trading_floor_keyset_snapshot; the trading-floor snapshot includes WTB
-- members). Cursors use the frozen k_* fields; payload is the live view row
-- (to_jsonb), same contract as the v4 keyset RPCs.
--
-- Cursor binding matches Phase 5.1: cursor listing_id must be a member of the
-- snapshot and the full supplied frozen key tuple must match exactly, else
-- 22023 invalid_cursor (fail closed). Unknown/expired snapshot ->
-- 22023 snapshot_expired (API maps to HTTP 400).
BEGIN;

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
    to_jsonb(v) AS payload
  FROM wf_canonical_staging.keyset_snapshot_members m
  JOIN public.trading_floor_ready_view_v2 v ON v.listing_id = m.listing_id
  WHERE m.snapshot_id = p_snapshot_id
    AND v.intent = 'WTB'
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
    AND (NOT cursor_supplied OR (
         m.source_created_at < p_cursor_created_at
      OR (m.source_created_at = p_cursor_created_at AND m.listing_id > p_cursor_listing_id)
    ))
  ORDER BY m.source_created_at DESC, m.listing_id ASC
  LIMIT p_limit;
END;
$$;

-- Least privilege, consistent with Phase 3 / 5 / 5.1.
REVOKE ALL ON FUNCTION public.get_price_research_wtb_demand_v3(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_wtb_demand_v3(uuid,integer,text,text,text,text,boolean,text,boolean,integer,integer,numeric,timestamptz,text) TO service_role;

COMMIT;
