-- Return exact approved seller activity in one indexed, read-only query.
-- Direct table access remains service-only and no production watch table is
-- read or written by this function.

CREATE OR REPLACE FUNCTION public.reviewed_workbook_seller_activity(p_phone text)
RETURNS TABLE (
  total_posts bigint,
  wts_posts bigint,
  wtb_posts bigint,
  other_posts bigint,
  first_post_at timestamptz,
  last_post_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT
    count(*)::bigint AS total_posts,
    count(*) FILTER (WHERE listing_type = 'WTS')::bigint AS wts_posts,
    count(*) FILTER (WHERE listing_type = 'WTB')::bigint AS wtb_posts,
    count(*) FILTER (
      WHERE listing_type IS NULL OR listing_type NOT IN ('WTS', 'WTB')
    )::bigint AS other_posts,
    min(posting_date) AS first_post_at,
    max(posting_date) AS last_post_at
  FROM public.reviewed_workbook_inventory
  WHERE contact_publication_approved IS TRUE
    AND phone_number = p_phone;
$function$;

REVOKE ALL ON FUNCTION public.reviewed_workbook_seller_activity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reviewed_workbook_seller_activity(text) FROM anon;
REVOKE ALL ON FUNCTION public.reviewed_workbook_seller_activity(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reviewed_workbook_seller_activity(text) TO service_role;

NOTIFY pgrst, 'reload schema';
