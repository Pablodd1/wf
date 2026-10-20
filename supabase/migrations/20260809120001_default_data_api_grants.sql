-- Supabase change effective 2026-10-30:
-- New tables created in the `public` schema no longer receive automatic Data API grants.
-- Existing tables are NOT affected (they keep their current grants).
--
-- This sets the default privileges so FUTURE tables created by migrations keep the exact
-- behaviour Supabase used to inject automatically. RLS remains the real row-level control.
--
-- If a table is ever created by a role other than the one running this migration, grant it
-- explicitly in that migration:
--   grant all on table public.<table> to anon, authenticated, service_role;
--
-- Least-privilege alternative (only if every existing table already behaves this way):
--   alter default privileges in schema public grant select on tables to anon, authenticated;
--   alter default privileges in schema public grant all on tables to service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
