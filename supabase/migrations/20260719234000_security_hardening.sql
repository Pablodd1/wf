-- Explicit privilege boundaries for internal media and queue infrastructure.

DO $$
BEGIN
  IF to_regclass('public.media_manifest') IS NOT NULL THEN
    REVOKE ALL ON public.media_manifest FROM PUBLIC, anon, authenticated;
    GRANT ALL ON public.media_manifest TO service_role;
  END IF;

  IF to_regprocedure('public.enqueue_normalization_shadow_work()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.enqueue_normalization_shadow_work() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.enqueue_normalization_shadow_work() TO service_role;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
