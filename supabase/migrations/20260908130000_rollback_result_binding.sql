BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE definition text; needle text='SET state=''ROLLED_BACK'',rolled_back_at=now(),result=result WHERE batch_key=p_batch_key;';
BEGIN
 definition=pg_get_functiondef('public.rollback_materialized_batch_v2(text,bigint)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'rollback_result_binding_definition_mismatch'; END IF;
 EXECUTE replace(definition,needle,'SET state=''ROLLED_BACK'',rolled_back_at=now(),result=rollback_materialized_batch_v2.result WHERE batch_key=p_batch_key;');
END $$;
COMMIT;
