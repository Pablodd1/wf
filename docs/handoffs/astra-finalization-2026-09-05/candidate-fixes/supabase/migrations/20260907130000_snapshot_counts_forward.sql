-- Totals must count the same frozen payloads as the v4/v3 page RPCs.
-- No live payload joins, no changes to existing snapshot membership or consumers.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_trading_floor_snapshot_count(
  p_snapshot_id uuid,
  p_brand text DEFAULT NULL, p_model text DEFAULT NULL, p_intent text DEFAULT NULL,
  p_query text DEFAULT NULL, p_category text DEFAULT NULL,
  p_country text DEFAULT NULL, p_region text DEFAULT NULL,
  p_images_only boolean DEFAULT false, p_priced_only boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_count
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
    AND (NOT p_images_only OR ((m.payload ->> 'image_status') = 'SOURCE_IMAGE_PRESENT'
      AND NULLIF(btrim(m.payload ->> 'image_key'), '') IS NOT NULL))
    AND (NOT p_priced_only OR ((m.payload ->> 'price_usd') IS NOT NULL
      AND (m.payload ->> 'price_usd')::numeric > 0))
    AND (p_query IS NULL OR (
         lower(COALESCE(m.payload ->> 'reference', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'model', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'title', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'brand', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'raw_message_text', '')) LIKE '%' || lower(p_query) || '%'
      OR lower(COALESCE(m.payload ->> 'seller_display_name', '')) LIKE '%' || lower(p_query) || '%'
    ));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_count(
  p_snapshot_id uuid, p_demand boolean DEFAULT false,
  p_brand text DEFAULT NULL, p_reference text DEFAULT NULL, p_model text DEFAULT NULL,
  p_dial_color text DEFAULT NULL, p_filter_dial boolean DEFAULT false,
  p_condition text DEFAULT NULL, p_filter_condition boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count bigint;
BEGIN
  IF p_demand IS NULL OR NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.surface = CASE WHEN p_demand THEN 'trading_floor' ELSE 'price_research' END
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_count FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = p_snapshot_id
    AND (NOT p_demand OR (m.payload ->> 'intent') = 'WTB')
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_reference IS NULL OR lower(m.payload ->> 'reference') = lower(p_reference))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model))
    AND (NOT p_filter_dial OR (m.payload ->> 'dial_color') IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR (m.payload ->> 'condition') IS NOT DISTINCT FROM p_condition);
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_trading_floor_snapshot_count(uuid,text,text,text,text,text,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_price_research_snapshot_count(uuid,boolean,text,text,text,text,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_snapshot_count(uuid,text,text,text,text,text,text,text,boolean,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_count(uuid,boolean,text,text,text,text,boolean,text,boolean) TO service_role;
COMMIT;
