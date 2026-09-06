BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE definition text; old_text text; new_text text; pairs text[][]=ARRAY[
 ARRAY['result jsonb;','v_rollback_result jsonb;'],
 ARRAY['result=prior.result||','v_rollback_result=prior.result||'],
 ARRAY['result=rollback_materialized_batch_v2.result','result=v_rollback_result'],
 ARRAY['RETURN result;','RETURN v_rollback_result;']]; pair text[];
BEGIN
 definition=pg_get_functiondef('public.rollback_materialized_batch_v2(text,bigint)'::regprocedure);
 FOREACH pair SLICE 1 IN ARRAY pairs LOOP
  old_text=pair[1];new_text=pair[2];
  IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'rollback_variable_definition_mismatch'; END IF;
  definition=replace(definition,old_text,new_text);
 END LOOP;
 EXECUTE definition;
END $$;
COMMIT;
