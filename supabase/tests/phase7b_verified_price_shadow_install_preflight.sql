DO $preflight$
BEGIN
  IF to_regnamespace('price_research_shadow') IS NOT NULL THEN
    RAISE EXCEPTION 'price_research_shadow already exists; refusing a non-fresh install';
  END IF;
END
$preflight$;

CREATE TEMP TABLE phase7b_customer_surface_before AS
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind,
  encode(extensions.digest(convert_to(COALESCE(pg_get_viewdef(c.oid, true), ''), 'UTF8'), 'sha256'), 'hex') AS definition_sha256
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('price_research_verified_source', 'price_research_view');

CREATE TEMP TABLE phase7b_customer_function_before AS
SELECT p.oid::regprocedure::text AS function_identity,
  encode(extensions.digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex') AS definition_sha256
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('qnsa_market_feed_page_rows', 'qnsa_bounded_price_research_rows');

CREATE TEMP TABLE phase7b_source_counts_before AS
SELECT (SELECT count(*) FROM staging.listings) AS listings,
  (SELECT count(*) FROM public.raw_message_versions) AS raw_versions;
