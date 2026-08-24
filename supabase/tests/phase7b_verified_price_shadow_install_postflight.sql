DO $postflight$
DECLARE v_tables integer; v_rls integer; v_policies integer; v_publications integer;
  v_customer_surface_changes integer; v_customer_function_changes integer;
  v_listing_delta bigint; v_raw_message_delta bigint; v_raw_version_delta bigint;
  v_listing_signature numeric; v_raw_message_signature numeric; v_raw_version_signature numeric;
  v_shadow_functions integer; v_exposed_functions integer; v_publication_state_changes integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE c.relrowsecurity)
    INTO v_tables, v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='price_research_shadow' AND c.relkind='r';
  IF v_tables <> 6 OR v_rls <> 6 THEN
    RAISE EXCEPTION 'Expected six private RLS tables, found % tables and % RLS tables', v_tables, v_rls;
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies WHERE schemaname='price_research_shadow';
  IF v_policies <> 0 THEN RAISE EXCEPTION 'Shadow schema must expose no RLS policies'; END IF;
  SELECT count(*) INTO v_publications FROM pg_publication_tables WHERE schemaname='price_research_shadow';
  IF v_publications <> 0 THEN RAISE EXCEPTION 'Shadow schema must not be published to realtime'; END IF;

  IF has_schema_privilege('anon','price_research_shadow','USAGE')
    OR has_schema_privilege('authenticated','price_research_shadow','USAGE') THEN
    RAISE EXCEPTION 'Customer roles unexpectedly have shadow schema usage';
  END IF;

  SELECT count(*) INTO v_shadow_functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'begin_phase7b_verified_price_shadow','phase7b_verified_price_source_page',
    'ingest_phase7b_verified_price_shadow_batch','materialize_phase7b_verified_reference',
    'complete_phase7b_verified_price_shadow','phase7b_verified_reference_snapshot',
    'phase7b_verified_shadow_report');
  IF v_shadow_functions <> 7 THEN RAISE EXCEPTION 'Expected seven Phase 7B service functions, found %',v_shadow_functions; END IF;
  SELECT count(*) INTO v_exposed_functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE ((n.nspname='public' AND p.proname LIKE '%phase7b_verified%')
      OR (n.nspname='price_research_shadow' AND p.proname='price_stats'))
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'));
  IF v_exposed_functions <> 0 THEN RAISE EXCEPTION 'Phase 7B service functions are exposed to customer roles'; END IF;

  SELECT count(*) INTO v_customer_surface_changes FROM (
    (SELECT * FROM phase7b_customer_surface_before EXCEPT
      SELECT n.nspname,c.relname,c.relkind,
        encode(extensions.digest(convert_to(COALESCE(pg_get_viewdef(c.oid,true),''),'UTF8'),'sha256'),'hex')
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('price_research_verified_source','price_research_view'))
    UNION ALL
    (SELECT n.nspname,c.relname,c.relkind,
        encode(extensions.digest(convert_to(COALESCE(pg_get_viewdef(c.oid,true),''),'UTF8'),'sha256'),'hex')
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('price_research_verified_source','price_research_view')
      EXCEPT SELECT * FROM phase7b_customer_surface_before)
  ) changed;
  IF v_customer_surface_changes <> 0 THEN RAISE EXCEPTION 'Customer view definition changed'; END IF;

  SELECT count(*) INTO v_customer_function_changes FROM (
    (SELECT * FROM phase7b_customer_function_before EXCEPT
      SELECT p.oid::regprocedure::text,
        encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex')
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('qnsa_market_feed_page_rows','qnsa_bounded_price_research_rows'))
    UNION ALL
    (SELECT p.oid::regprocedure::text,
        encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex')
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('qnsa_market_feed_page_rows','qnsa_bounded_price_research_rows')
      EXCEPT SELECT * FROM phase7b_customer_function_before)
  ) changed;
  IF v_customer_function_changes <> 0 THEN RAISE EXCEPTION 'Customer function definition changed'; END IF;

  SELECT (SELECT count(*) FROM staging.listings)-listings,
    (SELECT count(*) FROM public.raw_messages)-raw_messages,
    (SELECT count(*) FROM public.raw_message_versions)-raw_versions,
    (SELECT sum(hashtextextended(concat_ws('|',id::text,xmin::text),0)::numeric) FROM staging.listings)-listing_signature,
    (SELECT sum(hashtextextended(concat_ws('|',id::text,xmin::text),0)::numeric) FROM public.raw_messages)-raw_message_signature,
    (SELECT sum(hashtextextended(concat_ws('|',id::text,xmin::text),0)::numeric) FROM public.raw_message_versions)-raw_version_signature
  INTO v_listing_delta,v_raw_message_delta,v_raw_version_delta,v_listing_signature,
    v_raw_message_signature,v_raw_version_signature FROM phase7b_source_counts_before;
  IF v_listing_delta <> 0 OR v_raw_message_delta <> 0 OR v_raw_version_delta <> 0
    OR v_listing_signature <> 0 OR v_raw_message_signature <> 0 OR v_raw_version_signature <> 0 THEN
    RAISE EXCEPTION 'Source rows or row versions changed during install: listings %, raw messages %, raw versions %',
      v_listing_delta,v_raw_message_delta,v_raw_version_delta;
  END IF;

  WITH current_state AS (
    SELECT 'qnsa_market_feed_control'::text object_name,count(*) row_count,
      encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),''),'UTF8'),'sha256'),'hex') state_sha256
    FROM public.qnsa_market_feed_control t
    UNION ALL
    SELECT 'qnsa_two_brand_release_control',count(*),
      encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),''),'UTF8'),'sha256'),'hex')
    FROM public.qnsa_two_brand_release_control t
  )
  SELECT count(*) INTO v_publication_state_changes FROM (
    (SELECT * FROM phase7b_publication_state_before EXCEPT SELECT * FROM current_state)
    UNION ALL
    (SELECT * FROM current_state EXCEPT SELECT * FROM phase7b_publication_state_before)
  ) changed;
  IF v_publication_state_changes <> 0 THEN RAISE EXCEPTION 'Current publication state changed during install'; END IF;
END
$postflight$;
