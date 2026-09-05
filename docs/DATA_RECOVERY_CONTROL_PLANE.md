# Data Recovery Control Plane

## Purpose

This runbook restores customer inventory only after record identity, image
ownership, bundle lineage, and seller consent are independently verified.
Raw source records are preserved. Automated jobs cannot create human approval.

## Durable States

### Listing identity

- `UNVERIFIED`: no sufficient deterministic or human evidence.
- `CATALOG_CONFIRMED`: deterministic repository catalog match.
- `CONFLICT`: catalog brand or dial contradiction.
- `HUMAN_APPROVED`: named reviewer approved with a reason.

Only `CATALOG_CONFIRMED` and `HUMAN_APPROVED` records appear in
`trading_floor_verified_listings`.

### Listing image

- `SOURCE_LINKED`: filename, URL, or source lineage only.
- `VISUALLY_VERIFIED`: a reviewer compared the image with the exact listing.
- `REJECTED`: wrong, ambiguous, or stale ownership.

Only `VISUALLY_VERIFIED` images appear in the verified customer view. URL
reachability is not visual proof.

## Safe Rollout Order

1. Merge and apply `20260725023000_identity_image_publication_control.sql`.
2. Generate the exact blocker report:

   ```bash
   npm run report:global-blockers
   ```

3. Dry-run the first RM contradiction batch:

   ```bash
   set IDENTITY_SCOPE=RM_CONFLICTS
   set IDENTITY_BATCH_SIZE=100
   npm run stage:identity-review
   ```

4. Apply one 100-row batch and inspect the checkpoint and queue:

   ```bash
   set APPLY_IDENTITY_STAGE=true
   set IDENTITY_MAX_BATCHES=1
   npm run stage:identity-review
   ```

5. Continue RM processing in bounded 1,000-row batches only after readback:

   ```bash
   set IDENTITY_BATCH_SIZE=1000
   set IDENTITY_MAX_BATCHES=10
   npm run stage:identity-review
   ```

6. Audit every currently image-backed row:

   ```bash
   npm run audit:image-backed
   ```

   `VISUAL_REVIEW_REQUIRED` is a work queue, not an approval.

7. Review 50 images, save a JSON decision ledger, record its SHA-256, dry-run,
   then apply:

   ```bash
   set IMAGE_REVIEW_LEDGER=C:\review\image-ledger.json
   set IMAGE_REVIEW_LEDGER_SHA256=<sha256>
   set IMAGE_REVIEW_MAX_ROWS=50
   npm run apply:image-review-canary

   set APPLY_IMAGE_REVIEW=true
   npm run apply:image-review-canary
   ```

8. Split and approve bundle children before reviewing duplicate suppression.
   The database refuses suppression when either duplicate candidate is an
   unsplit bundle parent.
9. Link sellers only through verified dealer identities and explicit contact
   consent. Raw phone/name evidence remains private.
10. Enable `STRICT_VERIFIED_PUBLICATION=true` only after the verified-view
    count and representative WTS/WTB readbacks are approved.
11. After each canary or rollout increment, run:

   ```bash
   npm run verify:data-recovery
   ```

## Canary Acceptance

A canary passes only when:

- exact before/after counts reconcile;
- no human approval was overwritten;
- no conflict enters the verified view;
- no image appears without `VISUALLY_VERIFIED`;
- no bundle parent is duplicate-suppressed;
- WTS and WTB listing identity, source date, and intent match preserved source;
- customer responses omit raw messages and unconsented seller contact;
- rollback is disabling `STRICT_VERIFIED_PUBLICATION` or reversing explicit
  review decisions, never deleting raw records.

## Known Starting Evidence

- `watch_records`: 2,631,583 exact rows.
- image-backed listings: 1,531.
- manifest-linked image rows: 1,523.
- non-Richard-Mille rows carrying an RM reference: 83,365.
- current customer-view sample of 10,000:
  - 4,578 catalog confirmed;
  - 154 catalog brand conflicts;
  - 1,747 catalog dial conflicts;
  - 3,521 catalog unverified.

These are starting observations, not completion claims. Run the global blocker
report after the migration for the current exact counts.
