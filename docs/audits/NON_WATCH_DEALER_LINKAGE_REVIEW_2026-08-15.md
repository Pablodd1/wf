# Non-watch dealer linkage review — 2026-08-15

## Outcome

The existing customer API already enriches every returned listing through
`dealer_listing_links`. The released non-watch feed did not have an exact
lineage linkage producer, so handbag, jewelry, and accessory cards could retain
their source seller name while showing no verified profile, rating, review, or
group evidence.

This change adds the missing producer without changing the schema or the
normalization pipeline. It is not applied to production by this review.

## Evidence contract

A non-watch listing is eligible only when all of the following are true:

- immutable `raw_message_versions` identity matches the staging listing's raw
  version ID, source record ID, and source hash;
- the raw sender phone exactly matches one unique `VERIFIED` PHONE/WHATSAPP
  `dealer_source_identities` row belonging to a `VERIFIED` dealer;
- the listing is in the currently enabled non-watch run and category;
- category is HANDBAG, JEWELRY, or ACCESSORY;
- the listing is a non-bundle `SINGLE_CANDIDATE` with WTS/WTB intent and valid
  lineage hashes;
- hidden, rejected, withdrawn, deleted, archived, and duplicate-suppressed
  states are excluded.

Names, companies, geography, and fuzzy similarity are never identity evidence.
Existing conflicting links fail the page rather than being reassigned.

## Privacy

The phone is retained only in the private service-role linkage table because
that is the existing canonical exact identity contract. The RPC returns counts
and cursors only. It grants no execution to anon/authenticated roles. The
customer enrichment query does not select a phone. Public contact remains a
separate `contact_consent` decision.

## Controlled release

`.github/workflows/qnsa-non-watch-dealer-linkage.yml` provides:

1. `audit`: performs only read-only queries. Population evidence comes from the
   existing bounded market-feed count snapshot; release control/index evidence,
   duplicate identities, and orphan/non-applied link existence are queried
   separately. It deliberately avoids full staging/link-ledger count joins;
2. `canary`: explicit confirmation, contract installation, and at most 10 new
   links, followed by exact applied-delta reconciliation;
3. `full`: bounded raw-version keyset scan, stable raw snapshot requirement,
   exact applied-delta reconciliation, and zero conflict/orphan requirements.

Artifacts exclude raw messages and contact values.

## Blockers before production application

- Review and merge the migration, runner, workflow, and tests.
- Run audit and confirm QNSA release controls/indexes and zero duplicate verified
  phone identities/orphan links.
- Run the capped canary, then verify representative handbag, jewelry, and
  accessory cards live for correct dealer profile/rating/review/group evidence
  and absent unconsented contact.
- Run full only after canary reconciliation and visual acceptance pass.
- This lane cannot link records whose upstream raw sender phone is absent or has
  no unique verified canonical identity. Those must remain visibly unlinked;
  they must not be guessed from seller names.

## First canary incident and forward repair

Canary workflow run `31913677763` installed the service-only contract, then
timed out in the runner's first preflight call to
`qnsa_non_watch_dealer_linkage_reconciliation`. That version calculated the
entire released non-watch staging population before the runner entered its
page/apply loop. The failing runner invocation therefore performed zero link
writes: reconciliation is called before the loop, it is a STABLE SQL function,
and the management statement failed atomically.

`20260815234500_qnsa_non_watch_linkage_plan_fence.sql` is the forward repair:

- reconciliation now touches only the small private linkage and identity
  ledgers; it no longer aggregates released staging inventory;
- raw UUID pages are capped at 1,000 (workflow default 500), materialized first,
  and use a parameterized `LATERAL ... OFFSET 0` staging lookup through
  `idx_staging_mariadb_raw_version`;
- the runner refuses to continue unless EXPLAIN shows the raw primary key, the
  staging raw-version index, and the bounded nested-loop shape;
- the read-only audit exposes `non_watch_lane_link_exists`; a false result after
  the failed run is the durable post-failure proof that no canary link survived.

The raw-version traversal remained unnecessarily broad for only 2,692 released
non-watch candidates. `20260815235500_qnsa_non_watch_candidate_driven_linkage.sql`
therefore supersedes traversal, not eligibility:

- it freezes the enabled run and newest `(created_at,id)` boundary separately
  for HANDBAG, JEWELRY, and ACCESSORY;
- it keyset-pages those three streams through the existing
  `idx_staging_qnsa_market_feed_page` partial index;
- every candidate still joins `raw_message_versions` by primary key and must
  match source record ID and hash before exact unique verified-phone matching;
- full mode cannot complete until all three frozen category cursors exhaust and
  the release control remains unchanged;
- EXPLAIN must show the category index, raw primary key, and bounded nested-loop
  plan before a canary/full write is attempted.

PR review added three independent production-safety fences before this forward
migration may be run:

- FULL performs a read-only census of each frozen category stream, the apply
  traversal, and a second read-only census. Per-page digests cover listing ID,
  timestamp, raw-version ID, source record ID, source hash, and candidate hash.
  Counts and chained digests must agree across all three traversals, so an
  eligibility backfill or update below an already-consumed cursor blocks FULL
  completion instead of being silently skipped.
- GitHub serializes the workflow with a non-cancelling concurrency group. A
  private database lease additionally blocks overlap from another workflow or
  direct runner; it is renewed on every bounded page and released in `finally`.
- The workflow no longer concatenates historical migrations. It verifies that
  the installed reconciliation definition is the bounded private-ledger form
  (not merely that a function with that name exists), removes only the new migration's outer transaction
  lines, and submits that one forward migration inside one BEGIN/COMMIT. Compile
  uses the same body inside BEGIN/ROLLBACK. Inner PL/pgSQL BEGIN statements are
  preserved, and a failure cannot commit an earlier portion of the DDL.

Production evidence later confirmed successful workflow `31914163791` had
already installed the bounded reconciliation/plan fence and completed 703
bounded pages. The candidate migration therefore does not duplicate or replace
that historical DDL; both the workflow audit and runner inspect its installed
definition and fail closed if the population-wide predecessor reappears.
