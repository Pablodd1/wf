-- A traversal expires independently of its immutable publication payload.
-- Publishers prewarm both surfaces inside the publication transaction.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE wf_canonical_staging.keyset_snapshot_registry
 ADD COLUMN data_snapshot_id uuid REFERENCES wf_canonical_staging.keyset_snapshot_registry(snapshot_id) ON DELETE RESTRICT;
CREATE INDEX snapshot_data_references ON wf_canonical_staging.keyset_snapshot_registry(data_snapshot_id) WHERE data_snapshot_id IS NOT NULL;
CREATE INDEX snapshot_exact_reference ON wf_canonical_staging.keyset_snapshot_members
 (snapshot_id,lower(payload->>'brand'),lower(payload->>'reference'));
CREATE INDEX snapshot_exact_model ON wf_canonical_staging.keyset_snapshot_members
 (snapshot_id,lower(payload->>'brand'),lower(payload->>'model'));

CREATE FUNCTION wf_canonical_staging.snapshot_data_id(p_snapshot_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(r.data_snapshot_id,r.snapshot_id) FROM wf_canonical_staging.keyset_snapshot_registry r
 WHERE r.snapshot_id=p_snapshot_id;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.snapshot_data_id(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.open_publication_snapshot(p_surface text,p_ttl_seconds integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision bigint; v_id uuid; v_root uuid; v_count integer;
BEGIN
 IF p_surface NOT IN ('trading_floor','price_research') OR p_surface IS NULL
  OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 60 AND 86400 THEN
  RAISE EXCEPTION 'invalid_ttl_or_surface' USING ERRCODE='22023';
 END IF;
 -- Serve an already committed publication without waiting on the next writer.
 SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision WHERE singleton;
 SELECT snapshot_id INTO v_id FROM wf_canonical_staging.keyset_snapshot_registry
 WHERE surface=p_surface AND publication_revision=v_revision AND expires_at>pg_catalog.now()
 ORDER BY expires_at DESC,snapshot_id LIMIT 1;
 IF v_id IS NOT NULL THEN
  UPDATE wf_canonical_staging.keyset_snapshot_registry
   SET expires_at=greatest(expires_at,pg_catalog.now()+pg_catalog.make_interval(secs=>p_ttl_seconds))
   WHERE snapshot_id=v_id AND expires_at>pg_catalog.now();
  IF FOUND THEN RETURN v_id; END IF;
 END IF;
 SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 -- Another caller may have prepared the same revision while we waited.
 SELECT snapshot_id INTO v_id FROM wf_canonical_staging.keyset_snapshot_registry
 WHERE surface=p_surface AND publication_revision=v_revision AND expires_at>pg_catalog.now()
 ORDER BY expires_at DESC,snapshot_id LIMIT 1;
 IF v_id IS NOT NULL THEN RETURN v_id; END IF;
 SELECT snapshot_id,member_count INTO v_root,v_count FROM wf_canonical_staging.keyset_snapshot_registry
 WHERE surface=p_surface AND publication_revision=v_revision AND data_snapshot_id IS NULL
 ORDER BY created_at DESC,snapshot_id LIMIT 1;
 IF v_root IS NOT NULL THEN
  INSERT INTO wf_canonical_staging.keyset_snapshot_registry(surface,expires_at,member_count,publication_revision,data_snapshot_id)
  VALUES(p_surface,pg_catalog.now()+pg_catalog.make_interval(secs=>p_ttl_seconds),v_count,v_revision,v_root)
  RETURNING snapshot_id INTO v_id;
 ELSE
  v_id=CASE p_surface WHEN 'trading_floor' THEN wf_canonical_staging.materialize_trading_floor_snapshot(p_ttl_seconds)
   ELSE wf_canonical_staging.materialize_price_research_snapshot(p_ttl_seconds) END;
  UPDATE wf_canonical_staging.keyset_snapshot_registry SET publication_revision=v_revision WHERE snapshot_id=v_id;
 END IF;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.open_publication_snapshot(text,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.open_trading_floor_keyset_snapshot(p_ttl_seconds integer DEFAULT 3600) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT wf_canonical_staging.open_publication_snapshot('trading_floor',p_ttl_seconds);
$$;
CREATE OR REPLACE FUNCTION public.open_price_research_keyset_snapshot(p_ttl_seconds integer DEFAULT 3600) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_tf uuid; v_rows integer;
BEGIN
 IF p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 60 AND 86400 THEN
  RAISE EXCEPTION 'invalid_ttl' USING ERRCODE='22023';
 END IF;
 SELECT pr.snapshot_id,tf.snapshot_id INTO v_id,v_tf
 FROM wf_canonical_staging.publication_revision revision
 JOIN wf_canonical_staging.keyset_snapshot_registry pr ON pr.publication_revision=revision.revision AND pr.surface='price_research'
 JOIN wf_canonical_staging.keyset_snapshot_registry tf ON tf.publication_revision=revision.revision AND tf.surface='trading_floor'
 WHERE revision.singleton AND pr.expires_at>pg_catalog.now() AND tf.expires_at>pg_catalog.now()
 ORDER BY pr.expires_at DESC,tf.expires_at DESC,pr.snapshot_id,tf.snapshot_id LIMIT 1;
 IF v_id IS NOT NULL THEN
  UPDATE wf_canonical_staging.keyset_snapshot_registry
   SET expires_at=greatest(expires_at,pg_catalog.now()+pg_catalog.make_interval(secs=>p_ttl_seconds))
   WHERE snapshot_id IN (v_id,v_tf) AND expires_at>pg_catalog.now();
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=2 THEN RETURN v_id; END IF;
 END IF;
 -- Build/renew the paired surfaces under the same revision lock.
 PERFORM revision FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 PERFORM public.open_trading_floor_keyset_snapshot(p_ttl_seconds);
 RETURN wf_canonical_staging.open_publication_snapshot('price_research',p_ttl_seconds);
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_keyset_snapshots() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision bigint; n integer; roots integer;
BEGIN
 SELECT revision INTO STRICT v_revision FROM wf_canonical_staging.publication_revision WHERE singleton FOR UPDATE;
 DELETE FROM wf_canonical_staging.keyset_snapshot_registry WHERE data_snapshot_id IS NOT NULL AND expires_at<=pg_catalog.now();
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM wf_canonical_staging.keyset_snapshot_registry r WHERE r.data_snapshot_id IS NULL AND r.expires_at<=pg_catalog.now()
  AND NOT EXISTS(SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry a WHERE a.data_snapshot_id=r.snapshot_id)
  AND r.snapshot_id IS DISTINCT FROM (SELECT keep.snapshot_id FROM wf_canonical_staging.keyset_snapshot_registry keep
   WHERE keep.surface=r.surface AND keep.publication_revision=v_revision AND keep.data_snapshot_id IS NULL
   ORDER BY keep.created_at DESC,keep.snapshot_id LIMIT 1);
 GET DIAGNOSTICS roots=ROW_COUNT;
 RETURN n+roots;
END;
$$;
REVOKE ALL ON FUNCTION public.open_trading_floor_keyset_snapshot(integer),public.open_price_research_keyset_snapshot(integer),public.prune_keyset_snapshots() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_trading_floor_keyset_snapshot(integer),public.open_price_research_keyset_snapshot(integer),public.prune_keyset_snapshots() TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_canary_keyset_v4(p_snapshot_id uuid, p_limit integer DEFAULT 50, p_brand text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_dial_color text DEFAULT NULL::text, p_filter_dial boolean DEFAULT false, p_condition text DEFAULT NULL::text, p_filter_condition boolean DEFAULT false, p_cursor_priced_rank integer DEFAULT NULL::integer, p_cursor_image_rank integer DEFAULT NULL::integer, p_cursor_price_usd numeric DEFAULT NULL::numeric, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_listing_id text DEFAULT NULL::text)
 RETURNS TABLE(k_priced_rank integer, k_image_rank integer, k_price_usd numeric, k_source_created_at timestamp with time zone, k_listing_id text, payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND m.listing_id = p_cursor_listing_id;
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
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
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
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_canary_keyset_v4(p_snapshot_id uuid, p_limit integer, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_canary_keyset_v4(p_snapshot_id uuid, p_limit integer, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_breakdown(p_snapshot_id uuid, p_brand text, p_reference text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_dial_color text DEFAULT NULL::text, p_filter_dial boolean DEFAULT false, p_condition text DEFAULT NULL::text, p_filter_condition boolean DEFAULT false)
 RETURNS TABLE(source_observations bigint, wts_count bigint, wtb_count bigint, unique_qualified_offers bigint, included_count bigint, excluded_duplicates bigint, excluded_ambiguous_currency bigint, excluded_unsupported_fx bigint, excluded_implausible bigint, excluded_iqr_outliers bigint, excluded_not_wts bigint, excluded_ineligible_flag bigint, plausibility_floor numeric, retained_audit_evidence_count bigint, iqr_multiplier numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_total bigint := 0;
  v_wts bigint := 0;
  v_wtb bigint := 0;
  v_ex_not_wts bigint := 0;
  v_ex_ineligible bigint := 0;
  v_ex_ambiguous_curr bigint := 0;
  v_ex_unsupported_fx bigint := 0;
  v_unique bigint := 0;
  v_ex_dup bigint := 0;
  v_ex_implausible bigint := 0;
  v_floor numeric := NULL;
  v_included bigint := 0;
  v_ex_outliers bigint := 0;
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'trading_floor');
  -- 1. Source observations on the Trading Floor cohort; WTB kept separate.
  SELECT count(*),
         count(*) FILTER (WHERE v.intent = 'WTS'),
         count(*) FILTER (WHERE v.intent = 'WTB'),
         count(*) FILTER (WHERE v.intent IS DISTINCT FROM 'WTS')
  INTO v_total, v_wts, v_wtb, v_ex_not_wts
  FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND (p_brand IS NULL OR lower(member.payload->>'brand')=lower(p_brand)) AND (p_reference IS NULL OR lower(member.payload->>'reference')=lower(p_reference)) AND (p_model IS NULL OR lower(member.payload->>'model')=lower(p_model))) v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition);

  -- 2. Priority-ordered single-assignment exclusion buckets, then sequential
  --    dedup -> plausibility floor -> IQR fences. Every WTS row lands in
  --    exactly one bucket or in included_count.
  WITH wts AS (
    SELECT
      v.listing_id,
      v.price_usd,
      CASE
        WHEN v.price_research_eligible IS NOT TRUE
          OR v.included_in_statistics IS NOT TRUE
          OR v.price_usd IS NULL OR v.price_usd <= 0
          OR v.price_usd = 'NaN'::numeric OR v.price_usd = 'Infinity'::numeric
          THEN 'ineligible_flag'
        WHEN upper(COALESCE(v.original_price_currency, '')) <> 'USD'
          AND (v.fx_rate IS NULL OR v.fx_rate <= 0)
          THEN 'ambiguous_currency'
        WHEN upper(COALESCE(v.original_price_currency, '')) <> 'USD'
          AND (NULLIF(btrim(v.fx_source), '') IS NULL OR v.fx_date IS NULL)
          THEN 'unsupported_fx'
        ELSE 'qualified'
      END AS reason,
      COALESCE(
        NULLIF(v.duplicate_group_id, ''),
        md5(
          COALESCE(NULLIF(v.seller_id, ''), NULLIF(v.seller_display_name, ''), v.source_id, 'UNKNOWN_SELLER') || '|' ||
          lower(trim(v.brand)) || '|' ||
          lower(trim(coalesce(v.reference, v.model, ''))) || '|' ||
          lower(trim(coalesce(v.dial_color, ''))) || '|' ||
          lower(trim(coalesce(v.condition, ''))) || '|' ||
          round(coalesce(v.price_usd, 0))::text
        )
      ) AS group_key
    FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND (p_brand IS NULL OR lower(member.payload->>'brand')=lower(p_brand)) AND (p_reference IS NULL OR lower(member.payload->>'reference')=lower(p_reference)) AND (p_model IS NULL OR lower(member.payload->>'model')=lower(p_model))) v
    WHERE v.intent = 'WTS'
      AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
      AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
      AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
  ),
  buckets AS (
    SELECT
      count(*) FILTER (WHERE w.reason = 'ineligible_flag') AS ineligible,
      count(*) FILTER (WHERE w.reason = 'ambiguous_currency') AS ambiguous,
      count(*) FILTER (WHERE w.reason = 'unsupported_fx') AS unsupported
    FROM wts w
  ),
  qualified AS (SELECT w.listing_id, w.price_usd, w.group_key FROM wts w WHERE w.reason = 'qualified'),
  deduped AS (
    SELECT DISTINCT ON (q.group_key) q.listing_id, q.price_usd
    FROM qualified q
    ORDER BY q.group_key, q.listing_id ASC
  ),
  floor_calc AS (
    SELECT greatest(1000::numeric, round(percentile_cont(0.50) WITHIN GROUP (ORDER BY d.price_usd)::numeric * 0.25)) AS floor
    FROM deduped d
  ),
  plausible AS (
    SELECT d.listing_id, d.price_usd
    FROM deduped d CROSS JOIN floor_calc f
    WHERE d.price_usd >= f.floor
  ),
  quartiles AS (
    SELECT
      count(*)::bigint AS cnt,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q1,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q3
    FROM plausible p
  ),
  fences AS (
    SELECT greatest(0, q1 - 3.0 * (q3 - q1)) AS lower_fence,
           q3 + 3.0 * (q3 - q1) AS upper_fence
    FROM quartiles
    WHERE cnt >= 2
  ),
  fence_gate AS (SELECT (SELECT count(*) FROM fences) > 0 AS has_fences)
  SELECT
    b.ineligible, b.ambiguous, b.unsupported,
    (SELECT count(*) FROM deduped),
    (SELECT count(*) FROM qualified) - (SELECT count(*) FROM deduped),
    (SELECT count(*) FROM deduped d CROSS JOIN floor_calc f WHERE d.price_usd < f.floor),
    (SELECT floor FROM floor_calc),
    -- F2: with >= 2 plausible offers fences exist and bound inclusion; with
    -- exactly 1 plausible offer it counts as an included observation (scoped
    -- stats separately remain NULL below the minimum sample of 2).
    CASE WHEN (SELECT has_fences FROM fence_gate)
      THEN (SELECT count(*) FROM plausible p CROSS JOIN fences f WHERE p.price_usd >= f.lower_fence AND p.price_usd <= f.upper_fence)
      ELSE (SELECT count(*) FROM plausible)
    END,
    CASE WHEN (SELECT has_fences FROM fence_gate)
      THEN (SELECT count(*) FROM plausible p CROSS JOIN fences f WHERE p.price_usd < f.lower_fence OR p.price_usd > f.upper_fence)
      ELSE 0
    END
  INTO v_ex_ineligible, v_ex_ambiguous_curr, v_ex_unsupported_fx,
       v_unique, v_ex_dup, v_ex_implausible, v_floor, v_included, v_ex_outliers
  FROM buckets b;

  RETURN QUERY
  SELECT
    v_total,
    v_wts,
    v_wtb,
    v_unique,
    v_included,
    v_ex_dup,
    v_ex_ambiguous_curr,
    v_ex_unsupported_fx,
    v_ex_implausible,
    v_ex_outliers,
    v_ex_not_wts,
    v_ex_ineligible,
    v_floor,
    -- F1: every excluded observation is counted in exactly one bucket; the
    -- sum is the retained-evidence total by construction.
    (v_ex_not_wts + v_ex_ineligible + v_ex_ambiguous_curr + v_ex_unsupported_fx
       + v_ex_dup + v_ex_implausible + v_ex_outliers),
    3.0::numeric;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_snapshot_breakdown(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_breakdown(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_count(p_snapshot_id uuid, p_demand boolean DEFAULT false, p_brand text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_dial_color text DEFAULT NULL::text, p_filter_dial boolean DEFAULT false, p_condition text DEFAULT NULL::text, p_filter_condition boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  IF NOT p_demand AND p_brand IS NULL AND p_reference IS NULL AND p_model IS NULL AND NOT p_filter_dial AND NOT p_filter_condition THEN
    RETURN (SELECT member_count FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=p_snapshot_id);
  END IF;
  SELECT count(*) INTO v_count FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
    AND (NOT p_demand OR (m.payload ->> 'intent') = 'WTB')
    AND (p_brand IS NULL OR lower(m.payload ->> 'brand') = lower(p_brand))
    AND (p_reference IS NULL OR lower(m.payload ->> 'reference') = lower(p_reference))
    AND (p_model IS NULL OR lower(m.payload ->> 'model') = lower(p_model))
    AND (NOT p_filter_dial OR (m.payload ->> 'dial_color') IS NOT DISTINCT FROM p_dial_color)
    AND (NOT p_filter_condition OR (m.payload ->> 'condition') IS NOT DISTINCT FROM p_condition);
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_snapshot_count(p_snapshot_id uuid, p_demand boolean, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_count(p_snapshot_id uuid, p_demand boolean, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_dial_facets(p_snapshot_id uuid, p_brand text, p_reference text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_condition text DEFAULT NULL::text, p_filter_condition boolean DEFAULT false)
 RETURNS TABLE(dial_color text, listing_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  RETURN QUERY
  SELECT v.dial_color, count(*)::bigint
  FROM wf_canonical_staging.keyset_snapshot_members member
  CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(
    NULL::public.trading_floor_ready_view_v2, member.payload
  ) v
  WHERE member.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND (p_brand IS NULL OR lower(member.payload->>'brand')=lower(p_brand)) AND (p_reference IS NULL OR lower(member.payload->>'reference')=lower(p_reference)) AND (p_model IS NULL OR lower(member.payload->>'model')=lower(p_model))
    AND (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_condition OR v.condition IS NOT DISTINCT FROM p_condition)
  GROUP BY v.dial_color
  ORDER BY count(*) DESC, v.dial_color ASC NULLS LAST;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_snapshot_dial_facets(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_condition text, p_filter_condition boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_dial_facets(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_condition text, p_filter_condition boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_facets(p_snapshot_id uuid, p_brand text, p_reference text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_dial_color text DEFAULT NULL::text, p_filter_dial boolean DEFAULT false)
 RETURNS TABLE(condition text, listing_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  RETURN QUERY
  SELECT
    COALESCE(v.condition, 'Unspecified') AS condition,
    count(*)::bigint AS listing_count
  FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND (p_brand IS NULL OR lower(member.payload->>'brand')=lower(p_brand)) AND (p_reference IS NULL OR lower(member.payload->>'reference')=lower(p_reference)) AND (p_model IS NULL OR lower(member.payload->>'model')=lower(p_model))) v
  WHERE (p_brand IS NULL OR lower(v.brand) = lower(p_brand))
    AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
    AND (p_model IS NULL OR lower(v.model) = lower(p_model))
    AND (NOT p_filter_dial OR v.dial_color IS NOT DISTINCT FROM p_dial_color)
  GROUP BY COALESCE(v.condition, 'Unspecified')
  ORDER BY listing_count DESC, condition ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_snapshot_facets(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_facets(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_membership(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_condition text, p_listing_ids text[])
 RETURNS TABLE(listing_id text, exclusion_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  IF cardinality(p_listing_ids) IS NULL OR cardinality(p_listing_ids) NOT BETWEEN 1 AND 100
    OR nullif(btrim(p_brand),'') IS NULL OR (nullif(btrim(p_reference),'') IS NULL AND nullif(btrim(p_model),'') IS NULL)
    OR nullif(btrim(p_dial_color),'') IS NULL OR nullif(btrim(p_condition),'') IS NULL THEN
    RAISE EXCEPTION 'Exact cohort and 1 to 100 listing identities required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT v.listing_id, v.price_usd, v.source_created_at,
      coalesce(nullif(v.duplicate_group_id,''), md5(
        coalesce(nullif(v.seller_id,''),nullif(v.seller_display_name,''),v.source_id,'UNKNOWN_SELLER') || '|' ||
        lower(trim(v.brand)) || '|' || lower(trim(coalesce(v.reference,v.model,''))) || '|' ||
        lower(trim(coalesce(v.dial_color,''))) || '|' || lower(trim(coalesce(v.condition,''))) || '|' ||
        round(coalesce(v.price_usd,0))::text
      )) AS group_key
    FROM wf_canonical_staging.keyset_snapshot_members member
    CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2,member.payload) v
    WHERE member.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND (p_brand IS NULL OR lower(member.payload->>'brand')=lower(p_brand)) AND (p_reference IS NULL OR lower(member.payload->>'reference')=lower(p_reference)) AND (p_model IS NULL OR lower(member.payload->>'model')=lower(p_model)) AND v.intent='WTS'
      AND v.price_research_eligible IS TRUE AND v.included_in_statistics IS TRUE
      AND v.price_usd>0 AND v.price_usd NOT IN ('NaN'::numeric,'Infinity'::numeric)
      AND (upper(v.original_price_currency)='USD' OR (upper(v.original_price_currency)<>'USD'
        AND v.fx_rate>0 AND nullif(btrim(v.fx_source),'') IS NOT NULL AND v.fx_date IS NOT NULL))
      AND lower(v.brand)=lower(p_brand)
      AND (p_reference IS NULL OR lower(v.reference)=lower(p_reference))
      AND (p_model IS NULL OR lower(v.model)=lower(p_model))
      AND v.dial_color IS NOT DISTINCT FROM p_dial_color
      AND v.condition IS NOT DISTINCT FROM p_condition
  ), ranked AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.group_key ORDER BY c.source_created_at DESC,c.listing_id ASC) AS duplicate_rank
    FROM candidates c
  ), floor_calc AS (
    SELECT greatest(1000::numeric,round(percentile_cont(0.50) WITHIN GROUP (ORDER BY r.price_usd)::numeric*0.25)) AS floor
    FROM ranked r WHERE r.duplicate_rank=1
  ), quartiles AS (
    SELECT count(*) AS n,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY r.price_usd)::numeric AS q1,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY r.price_usd)::numeric AS q3
    FROM ranked r CROSS JOIN floor_calc f WHERE r.duplicate_rank=1 AND r.price_usd>=f.floor
  )
  SELECT r.listing_id,
    CASE WHEN r.duplicate_rank>1 THEN 'REPOST_DUPLICATE'
      WHEN r.price_usd<f.floor THEN 'BELOW_MARKET_PLAUSIBILITY_FLOOR'
      WHEN q.n<2 THEN 'INSUFFICIENT_COHORT'
      WHEN r.price_usd<greatest(0,q.q1-3.0*(q.q3-q.q1)) THEN 'BELOW_IQR_FENCE'
      WHEN r.price_usd>q.q3+3.0*(q.q3-q.q1) THEN 'ABOVE_IQR_FENCE'
      ELSE NULL END
  FROM ranked r CROSS JOIN floor_calc f CROSS JOIN quartiles q
  WHERE r.listing_id=ANY(p_listing_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_snapshot_membership(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_condition text, p_listing_ids text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_membership(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_condition text, p_listing_ids text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_snapshot_stats(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_condition text)
 RETURNS TABLE(qualified_count bigint, avg_price numeric, min_price numeric, max_price numeric, median_price numeric, q1_price numeric, q3_price numeric, iqr numeric, lower_fence numeric, upper_fence numeric, iqr_multiplier numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM wf_canonical_staging.assert_snapshot_surface(p_snapshot_id, 'price_research');
  IF NULLIF(btrim(p_brand), '') IS NULL
     OR (NULLIF(btrim(p_reference), '') IS NULL AND NULLIF(btrim(p_model), '') IS NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT v.price_usd, v.source_created_at, v.listing_id,
      COALESCE(
        NULLIF(v.duplicate_group_id, ''),
        md5(
          COALESCE(NULLIF(v.seller_id, ''), NULLIF(v.seller_display_name, ''), v.source_id, 'UNKNOWN_SELLER') || '|' ||
          lower(trim(v.brand)) || '|' ||
          lower(trim(coalesce(v.reference, v.model, ''))) || '|' ||
          lower(trim(coalesce(v.dial_color, ''))) || '|' ||
          lower(trim(coalesce(v.condition, ''))) || '|' ||
          round(coalesce(v.price_usd, 0))::text
        )
      ) AS group_key
    FROM (SELECT frozen.* FROM wf_canonical_staging.keyset_snapshot_members member CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(NULL::public.trading_floor_ready_view_v2, member.payload) frozen WHERE member.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND (p_brand IS NULL OR lower(member.payload->>'brand')=lower(p_brand)) AND (p_reference IS NULL OR lower(member.payload->>'reference')=lower(p_reference)) AND (p_model IS NULL OR lower(member.payload->>'model')=lower(p_model))) v
    WHERE v.intent = 'WTS'
      AND v.price_research_eligible IS TRUE
      AND v.included_in_statistics IS TRUE
      AND v.price_usd > 0
      AND v.price_usd <> 'NaN'::numeric
      AND v.price_usd <> 'Infinity'::numeric
      AND (
        upper(v.original_price_currency) = 'USD'
        OR (
          upper(v.original_price_currency) <> 'USD'
          AND v.fx_rate > 0
          AND NULLIF(btrim(v.fx_source), '') IS NOT NULL
          AND v.fx_date IS NOT NULL
        )
      )
      AND lower(v.brand) = lower(p_brand)
      AND (p_reference IS NULL OR lower(v.reference) = lower(p_reference))
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND v.dial_color IS NOT DISTINCT FROM p_dial_color
      AND v.condition IS NOT DISTINCT FROM p_condition
  ),
  deduplicated AS (
    SELECT DISTINCT ON (c.group_key) c.price_usd
    FROM candidates c
    ORDER BY c.group_key, c.source_created_at DESC, c.listing_id ASC
  ),
  floor_calc AS (
    -- Market plausibility floor: exact-cohort offers below a quarter of the
    -- cohort median (never below 1000) are parser/currency-error evidence,
    -- not comparable offers. Mirrors marketPlausibilityFloor in
    -- api/_lib/market-stats.cjs.
    SELECT greatest(1000::numeric, round(percentile_cont(0.50) WITHIN GROUP (ORDER BY d.price_usd)::numeric * 0.25)) AS floor
    FROM deduplicated d
  ),
  plausible AS (
    SELECT d.price_usd
    FROM deduplicated d CROSS JOIN floor_calc f
    WHERE d.price_usd >= f.floor
  ),
  quartiles AS (
    SELECT
      count(*)::bigint AS raw_count,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q1,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY p.price_usd)::numeric AS q3
    FROM plausible p
  ),
  fences AS (
    SELECT
      q.raw_count,
      q.q1,
      q.median,
      q.q3,
      (q.q3 - q.q1) AS iqr,
      greatest(0, q.q1 - 3.0 * (q.q3 - q.q1)) AS lower_fence,
      q.q3 + 3.0 * (q.q3 - q.q1) AS upper_fence
    FROM quartiles q
    WHERE q.raw_count >= 2
  ),
  included AS (
    SELECT p.price_usd, f.q1, f.median, f.q3, f.iqr, f.lower_fence, f.upper_fence
    FROM plausible p
    CROSS JOIN fences f
    WHERE p.price_usd >= f.lower_fence AND p.price_usd <= f.upper_fence
  ),
  aggregated AS (
    SELECT
      count(*)::bigint AS cnt,
      avg(i.price_usd) AS avg_value,
      min(i.price_usd) AS min_value,
      max(i.price_usd) AS max_value,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY i.price_usd)::numeric AS included_median,
      max(i.q1) AS q1,
      max(i.q3) AS q3,
      max(i.iqr) AS iqr,
      max(i.lower_fence) AS lower_fence,
      max(i.upper_fence) AS upper_fence
    FROM included i
  )
  SELECT
    a.cnt AS qualified_count,
    round(a.avg_value, 2) AS avg_price,
    a.min_value AS min_price,
    a.max_value AS max_price,
    round(a.included_median, 2) AS median_price,
    round(a.q1, 2) AS q1_price,
    round(a.q3, 2) AS q3_price,
    round(a.iqr, 2) AS iqr,
    round(a.lower_fence, 2) AS lower_fence,
    round(a.upper_fence, 2) AS upper_fence,
    3.0::numeric AS iqr_multiplier
  FROM aggregated a
  WHERE a.cnt >= 2
    -- Fail closed: never emit inconsistent or non-finite statistics.
    AND a.q1 <= a.included_median
    AND a.included_median <= a.q3
    AND a.q1 <= a.q3
    AND a.lower_fence <= a.upper_fence
    AND a.avg_value <> 'NaN'::numeric AND a.avg_value <> 'Infinity'::numeric
    AND a.included_median <> 'NaN'::numeric AND a.included_median <> 'Infinity'::numeric
    AND a.q1 <> 'NaN'::numeric AND a.q3 <> 'NaN'::numeric
    AND a.iqr <> 'NaN'::numeric
    AND a.lower_fence <> 'NaN'::numeric AND a.upper_fence <> 'NaN'::numeric;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_snapshot_stats(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_condition text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_snapshot_stats(p_snapshot_id uuid, p_brand text, p_reference text, p_model text, p_dial_color text, p_condition text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_price_research_wtb_demand_v3(p_snapshot_id uuid, p_limit integer DEFAULT 50, p_brand text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_dial_color text DEFAULT NULL::text, p_filter_dial boolean DEFAULT false, p_condition text DEFAULT NULL::text, p_filter_condition boolean DEFAULT false, p_cursor_priced_rank integer DEFAULT NULL::integer, p_cursor_image_rank integer DEFAULT NULL::integer, p_cursor_price_usd numeric DEFAULT NULL::numeric, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_listing_id text DEFAULT NULL::text)
 RETURNS TABLE(k_priced_rank integer, k_image_rank integer, k_price_usd numeric, k_source_created_at timestamp with time zone, k_listing_id text, payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND m.listing_id = p_cursor_listing_id;
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
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
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
$function$;

REVOKE ALL ON FUNCTION public.get_price_research_wtb_demand_v3(p_snapshot_id uuid, p_limit integer, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_research_wtb_demand_v3(p_snapshot_id uuid, p_limit integer, p_brand text, p_reference text, p_model text, p_dial_color text, p_filter_dial boolean, p_condition text, p_filter_condition boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_trading_floor_canary_keyset_v4(p_snapshot_id uuid, p_limit integer DEFAULT 50, p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_images_only boolean DEFAULT false, p_priced_only boolean DEFAULT false, p_cursor_priced_rank integer DEFAULT NULL::integer, p_cursor_image_rank integer DEFAULT NULL::integer, p_cursor_price_usd numeric DEFAULT NULL::numeric, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_listing_id text DEFAULT NULL::text)
 RETURNS TABLE(k_priced_rank integer, k_image_rank integer, k_price_usd numeric, k_source_created_at timestamp with time zone, k_listing_id text, payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id) AND m.listing_id = p_cursor_listing_id;
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
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
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
$function$;

REVOKE ALL ON FUNCTION public.get_trading_floor_canary_keyset_v4(p_snapshot_id uuid, p_limit integer, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_canary_keyset_v4(p_snapshot_id uuid, p_limit integer, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean, p_cursor_priced_rank integer, p_cursor_image_rank integer, p_cursor_price_usd numeric, p_cursor_created_at timestamp with time zone, p_cursor_listing_id text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_trading_floor_snapshot_count(p_snapshot_id uuid, p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_images_only boolean DEFAULT false, p_priced_only boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM wf_canonical_staging.keyset_snapshot_registry r
    WHERE r.snapshot_id = p_snapshot_id AND r.surface = 'trading_floor'
      AND r.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'snapshot_expired: unknown, wrong-surface, or expired snapshot' USING ERRCODE = '22023';
  END IF;
  IF p_brand IS NULL AND p_model IS NULL AND p_intent IS NULL AND p_query IS NULL AND p_category IS NULL AND p_country IS NULL AND p_region IS NULL AND NOT p_images_only AND NOT p_priced_only THEN
    RETURN (SELECT member_count FROM wf_canonical_staging.keyset_snapshot_registry WHERE snapshot_id=p_snapshot_id);
  END IF;
  SELECT count(*) INTO v_count
  FROM wf_canonical_staging.keyset_snapshot_members m
  WHERE m.snapshot_id = wf_canonical_staging.snapshot_data_id(p_snapshot_id)
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
$function$;

REVOKE ALL ON FUNCTION public.get_trading_floor_snapshot_count(p_snapshot_id uuid, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trading_floor_snapshot_count(p_snapshot_id uuid, p_brand text, p_model text, p_intent text, p_query text, p_category text, p_country text, p_region text, p_images_only boolean, p_priced_only boolean) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
