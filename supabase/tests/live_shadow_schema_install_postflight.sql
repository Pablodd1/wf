DO $postflight$
DECLARE
  v_rpc REGPROCEDURE := to_regprocedure('public.ingest_live_shadow_segment(text,text,bigint,text,text,text,text,text,text,text,text,jsonb,jsonb)');
  v_helper REGPROCEDURE := to_regprocedure('staging.live_shadow_stable_jsonb(jsonb)');
  v_target_oids OID[];
  v_role TEXT;
  v_table TEXT;
  v_dml_deltas TEXT;
BEGIN
  IF v_rpc IS NULL OR v_helper IS NULL THEN RAISE EXCEPTION 'required live shadow functions are missing'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='ingest_live_shadow_segment') <> 1
    OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='staging' AND p.proname='live_shadow_stable_jsonb') <> 1 THEN
    RAISE EXCEPTION 'live shadow function overload set is not exact';
  END IF;

  SELECT array_agg(c.oid ORDER BY c.relname) INTO v_target_oids
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='staging' AND c.relkind='r' AND c.relname LIKE 'live_shadow_%';
  IF cardinality(v_target_oids) <> 3
    OR to_regclass('staging.live_shadow_segment_checkpoint') IS NULL
    OR to_regclass('staging.live_shadow_segment_batches') IS NULL
    OR to_regclass('staging.live_shadow_candidates') IS NULL THEN
    RAISE EXCEPTION 'private live shadow table set is not exact';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid=ANY(v_target_oids) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'RLS is not enabled on every private live shadow table';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=ANY(v_target_oids)) THEN
    RAISE EXCEPTION 'private live shadow tables must not have direct-access policies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=ANY(v_target_oids) AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'private live shadow tables must not have application triggers';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE schemaname='staging' AND tablename IN ('live_shadow_segment_checkpoint','live_shadow_segment_batches','live_shadow_candidates')
  ) THEN RAISE EXCEPTION 'private live shadow table entered a publication'; END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'staging.live_shadow_segment_checkpoint','staging.live_shadow_segment_batches','staging.live_shadow_candidates'
    ] LOOP
      IF has_table_privilege(v_role,v_table,'SELECT') OR has_table_privilege(v_role,v_table,'INSERT')
        OR has_table_privilege(v_role,v_table,'UPDATE') OR has_table_privilege(v_role,v_table,'DELETE')
        OR has_table_privilege(v_role,v_table,'TRUNCATE') OR has_table_privilege(v_role,v_table,'REFERENCES')
        OR has_table_privilege(v_role,v_table,'TRIGGER') THEN
        RAISE EXCEPTION 'role % has forbidden direct access to %', v_role, v_table;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid=ANY(v_target_oids) AND acl.grantee=0
      AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) THEN RAISE EXCEPTION 'PUBLIC has forbidden direct access to a live shadow table'; END IF;

  IF has_function_privilege('anon',v_rpc,'EXECUTE') OR has_function_privilege('authenticated',v_rpc,'EXECUTE')
    OR NOT has_function_privilege('service_role',v_rpc,'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid=v_rpc AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
    ) THEN
    RAISE EXCEPTION 'live shadow RPC execute privileges are unsafe';
  END IF;
  IF has_function_privilege('anon',v_helper,'EXECUTE') OR has_function_privilege('authenticated',v_helper,'EXECUTE')
    OR has_function_privilege('service_role',v_helper,'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid=v_helper AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
    ) THEN
    RAISE EXCEPTION 'stable JSON helper must not be externally executable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=v_rpc AND p.prosecdef AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND p.proconfig @> ARRAY['search_path=public, staging, pg_catalog']
  ) THEN RAISE EXCEPTION 'live shadow RPC owner/security/search_path contract failed'; END IF;

  IF EXISTS (SELECT 1 FROM staging.live_shadow_segment_checkpoint)
    OR EXISTS (SELECT 1 FROM staging.live_shadow_segment_batches)
    OR EXISTS (SELECT 1 FROM staging.live_shadow_candidates) THEN
    RAISE EXCEPTION 'new private live shadow tables are not empty';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='staging.live_shadow_segment_checkpoint'::regclass
      AND pg_get_constraintdef(oid) LIKE '%publication_writes = 0%'
  ) THEN RAISE EXCEPTION 'zero-publication table constraint is missing'; END IF;

  SELECT string_agg(format('%I.%I:+%s/~%s/-%s',stats.schemaname,stats.relname,
    stats.n_tup_ins-COALESCE(baseline.n_tup_ins,0),
    stats.n_tup_upd-COALESCE(baseline.n_tup_upd,0),
    stats.n_tup_del-COALESCE(baseline.n_tup_del,0)), ',' ORDER BY stats.schemaname,stats.relname)
  INTO v_dml_deltas
  FROM pg_stat_xact_all_tables stats
  LEFT JOIN live_shadow_install_xact_baseline baseline USING(relid)
  WHERE stats.schemaname NOT IN ('pg_catalog','pg_toast','information_schema','extensions')
    AND NOT (stats.schemaname='staging' AND stats.relname LIKE 'live_shadow_%')
    AND stats.relid <> 'pg_temp.live_shadow_install_xact_baseline'::regclass
    AND (
      stats.n_tup_ins <> COALESCE(baseline.n_tup_ins,0)
      OR stats.n_tup_upd <> COALESCE(baseline.n_tup_upd,0)
      OR stats.n_tup_del <> COALESCE(baseline.n_tup_del,0)
    );
  IF v_dml_deltas IS NOT NULL THEN
    RAISE EXCEPTION 'schema install changed application table counters: %', v_dml_deltas;
  END IF;
END $postflight$;
