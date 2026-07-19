# WatchFacts CTO Priority Order

Date: 2026-07-19

This checkpoint reconciles the July 16-18 client meetings, production audits,
bundle canaries, dealer pilot, Price Research QA, and the current Curated Luxury
homepage work. Raw source evidence remains immutable. No item below authorizes
mass promotion, deletion, or guessed normalization.

## P0 - Customer data accuracy

1. Review and merge the global price-normalization audit work after CI and a
   bounded production canary. The 100,000-row read-only scan found 18,305 price
   correction candidates; aggregate evidence alone is not permission to update
   live rows.
2. Review the current deterministic dial proposals in shadow. Patek single-dial
   catalog corrections may be reviewed deterministically; Rolex `116500LN`
   requires explicit raw text or human catalog review because multiple dials are
   valid.
3. Revalidate the owner-critical references after every pricing or dial release:
   Patek `3712/1A`, `5712/1A`, `5712/1R`; Rolex `116500LN`, `52506`. Confirm the
   minimum-five rule, repost control, visible discarded outliers, dial and
   condition filters, and exact raw evidence.
4. Reconcile Trading Floor publication rules and counts: priced WTS only, WTB
   requests separate from WTS supply, MULTI records held in multi-listing review,
   RECYCLE excluded, and original source dates used only when actually present.

## P1 - Bundles before duplicates

5. Complete the checkpointed export of approximately 757,433
   `BUNDLE_SPLIT_REQUIRED` parents from a current checkout. JSONL is the
   authoritative machine format; human review slices should remain bounded.
6. Review the 25-parent staging canary: 329 children were persisted, 184 require
   explicit review, and all remain `PENDING` at confidence `0`.
7. Continue bundle child materialization in bounded staging cohorts only after
   source, line, candidate, and persisted counts reconcile exactly.
8. Classify duplicate ingestion events, reposts, shared inventory, and distinct
   units only after the relevant bundle parents are split. Suppress reviewed
   duplicates from analytics; do not erase immutable raw evidence.

## P1 - Dealer lineage and customer contact

9. Obtain an authenticated Rated Dealers export and reconcile it against the
   1,580 staged source company identifiers. The supplied legacy directory is an
   internal research source, not a customer-facing link.
10. Repair or expose an indexed source-key mapping before dealer backfill. The
    current 50,000-row pilot resolved zero identities because the sampled watch
    rows lacked the required join keys.
11. Backfill `watch_records.dealer_id` only from approved identity matches, then
    recompute WTS, WTB/NTQ, active inventory, groups, reviews, location, and
    posting-year metrics. Show WhatsApp contact only for verified, consented
    dealer records.

## P2 - Images and additional luxury categories

12. Preserve the 100-image pilot as lineage evidence. Expand only after the
    source message-to-attachment-to-listing join is proven; never attach an image
    from filename similarity or visual guessing.
13. Normalize non-watch categories into their own explicit schemas and filters
    before bulk publication. Keep unreviewed handbags, jewelry, accessories, and
    singular objects labeled `UNNORMALIZED` and out of watch Price Research.

## P2 - Release and platform quality

14. Run desktop and phone smoke tests for Home, Trading Floor, listing detail,
    Price Research, dealer login, Admin, Dashboard, and Multi-listing review on
    the Vercel preview before merging UI work.
15. Retire stale branches and deployments only after confirming they are not
    referenced by an open PR, Railway worker, Supabase preview, or rollback plan.
16. Reduce the documented legacy lint backlog and large frontend chunks in a
    separate maintenance change; do not mix broad refactors into data releases.
17. Rotate credentials previously exposed during setup and maintain separate
    least-privilege Production, Preview, migration, and storage credentials.

## Current release boundary

- Customer surfaces are live and usable, but the complete archive is not proven
  100% normalized.
- Bundle parsing and staging canaries passed; automatic bulk promotion and
  duplicate suppression are not approved.
- Price outliers may be excluded from statistics while remaining visible as
  discarded evidence.
- Human approval is exactly 100% confidence. No confidence value may exceed 100.
- Homepage presentation work is independent of normalization and may ship after
  preview build and responsive smoke-test evidence.
