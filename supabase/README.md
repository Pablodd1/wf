# Supabase migrations

The `migrations` directory is the source of truth for schema changes that must
work in data-less Supabase Preview branches. New migrations must be additive,
timestamped, and committed with the application change that depends on them.

The baseline migration creates the real production `watch_records` contract
without altering existing rows. It exists because the legacy production table
was created outside the repository, while a later image migration assumes that
the table already exists.

`20260712193000_public_trading_floor_read.sql` adds a deliberately narrow,
RLS-protected `trading_floor_listings` view. It permits the Trading Floor to
run with `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`) when a
Vercel server key is unavailable. It does not expose raw message text, seller
phone numbers, internal flags, or review fields. Writes still require
`SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`.
