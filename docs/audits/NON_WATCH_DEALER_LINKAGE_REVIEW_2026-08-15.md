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

1. `audit`: performs only read-only queries and records counts, release controls,
   index presence, duplicate identities, and orphan links;
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
