# WatchFacts CTO Checkpoint

Date: 2026-07-18
Repository: `Pablodd1/wf`
Current branch: `codex/global-market-header`

## Current state

The working tree is clean. The latest pushed commit is `f1b2d96`.

Recent completed work:

- `f1b2d96` simplified the Curated Luxury hero: solid gold title, no gradient, no text shadow, softened hero video, and a darker readability overlay.
- `ff0f25c` added the shared market header with `HIRE FI`, `DISCOVER`, and `PRICE RESEARCH` links.
- PR #44 fixed Price Research detail values so modal prices agree with analytics and exact raw-message normalization.
- The global price-normalization audit branch contains the read-only scanner and regressions for HKD/USD drift, legacy double conversion, repeated-reference blocks, and luxury-floor anomalies.

## Verification already completed

- Production build passes on the current branch.
- Hero change passes `git diff --check`.
- Price Research canary `5712/1R` was verified against its exact raw line; stale `$31,917` was corrected to `$249,350` USD normalized.
- The audit scanner passed its targeted tests and the normalization suite passed 100/100.
- A 5,000-row read-only production sample found 936 stored-price mismatches: 846 high, 65 medium, 25 low; 829 HKD-derived and 107 USD-derived. This is a report, not a mass update.
- A 100,000-row read-only Railway scan found 18,305 candidates: 16,040 high, 1,643 medium, and 622 low; 15,936 explicit-HKD-derived and 2,369 explicit-USD-derived. It also found 2,014 likely legacy HKD double-conversions, 440 normalized values below the $500 floor, 59 stored values below the floor, and 369 repeated-reference review cases. No production rows were changed.

## Pending order

1. Review and merge the global market header branch after checking the Vercel preview.
2. Review and merge the global price-normalization audit branch.
3. Convert the 100,000-row audit result into a durable report/export, then design a deterministic remediation canary. Do not update production rows from aggregate findings alone.
4. Run targeted canary checks for `5712/1R`, `5712/1A`, `3712/1A`, `116500LN`, and `52506`.
5. Separate deterministic explicit-currency corrections from repeated-reference, bundles, and multilistings requiring review.
6. Split bundles before duplicate suppression and export the multilistings report.
7. Revalidate Price Research and Trading Floor totals, minimum-five comparable rules, outlier exclusion, and visible discarded-outlier evidence.
8. Review dealer attribution, WTS/WTB counts, years of activity, raw-message access, and WhatsApp contact behavior.
9. Run the 100-image message-lineage pilot only after text normalization and listing lineage are stable.
10. Revisit the media-mapping mission separately; it is intentionally not part of the current text-normalization rollout.

## Safety rules for resuming

- Do not merge directly to `main` without preview build and endpoint evidence.
- Do not mass-delete duplicates. Produce a report and preserve source/raw lineage first.
- Do not treat `Unknown` as `New` or `Used`; keep it reviewable unless the raw line supports a correction.
- Do not include fewer than five valid comparable observations in authoritative Price Research analytics.
- Do not expose credentials in commits, handoff files, screenshots, or prompts. Previously shared credentials should be rotated.
- Keep the raw message immutable and visible for review.

## Useful links

- Repository: https://github.com/Pablodd1/wf
- Header branch PR: https://github.com/Pablodd1/wf/pull/new/codex/global-market-header
- Price audit branch PR: https://github.com/Pablodd1/wf/pull/new/codex/global-price-normalization-audit
- Production app: https://watchfacts-poc.vercel.app/

## Resume instruction

Start by checking `git status`, reading this checkpoint, and verifying the two branch diffs against `origin/main`. Continue with preview validation and the larger read-only audit. Preserve all raw data and do not perform destructive production changes without a reviewed report and explicit approval.
