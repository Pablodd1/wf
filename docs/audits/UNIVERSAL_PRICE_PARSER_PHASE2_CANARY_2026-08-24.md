# WatchFacts Phase 2 — Universal Price Parser Shadow Canary

Date: 2026-08-24

Baseline: `0f8888317e13e056248b8de2a89252fd61383ea7`

Mode: local read-only shadow comparison. No production system was contacted.

## Acceptance summary

- Adversarial auto-approved false positives: 9 old, 0 new.
- Known-good controls: 250/250 explicit pairs remain auto-approved.
- Decimal K/M regression tests pass, including decimal-comma M notation.
- Bare dollar, currencyless amounts, and HK shorthand are not auto-approved.
- Multiple-price and bundle candidates retain source spans and review reasons.
- Raw messages and existing listing values are inputs only; this phase performs no writes.

## Canary population

| Cohort | Messages | Explicit pairs |
| --- | ---: | ---: |
| Phase 1 parser misses | 94 | 171 |
| Recognized but not normalized | 665 | 694 |
| Known-good deterministic controls | 250 | 250 |
| Adversarial cases | 26 | n/a |

The static export contains 117,744 listing rows and 24,392 unique raw messages. Its SHA-256 is `ec2295a3470aa06107ec06a8bbdb762b3b2ebf05ce6ac47e56173176a6e5266a`.

## Old versus new

| Metric | Old | New | Delta |
| --- | ---: | ---: | ---: |
| Explicit pairs recognized as candidates | 1,014 | 1,107 | +93 |
| Auto-approved prices | 1,073 | 920 | -153 |
| Review-only candidates | 0 | 206 | +206 |
| Adversarial false positives | 9 | 0 | -9 |
| Multiple-price ambiguities preserved | not represented | 66 messages | n/a |
| Bundle ambiguities preserved | not represented | 22 messages | n/a |

The lower auto-approved total is intentional: unsafe defaults and unresolved candidate associations move to review rather than becoming prices.

## Recovery of the 101 missed explicit pairs

| Phase 1 category | Missed | Auto-approved | Review-only | Still unresolved |
| --- | ---: | ---: | ---: | ---: |
| Multiple-price ambiguity | 63 | 0 | 60 | 3 |
| K notation unsupported | 3 | 1 | 0 | 2 |
| M notation unsupported | 30 | 29 | 1 | 0 |
| Bundle-price ambiguity | 3 | 0 | 3 | 0 |
| Currency not detected | 2 | 0 | 2 | 0 |
| **Total** | **101** | **30** | **66** | **5** |

The five unresolved pairs remain null instead of being guessed.

## Classification of the 665 normalization gaps

| Cause | Messages |
| --- | ---: |
| Normalization skipped | 620 |
| Bundle deferred | 20 |
| Currency policy | 13 |
| Multiple-price review | 9 |
| Other | 2 |
| Reference unresolved | 1 |
| **Total** | **665** |

These are deterministic classifications from the static export. They do not establish live release or Price Research eligibility, and no correction is authorized by this report.

## Verification

- `npm ci`: passed; npm reported 17 dependency advisories in the existing dependency tree.
- `npm run test:normalization`: 186 passed, 0 failed, 1 live Supabase test skipped by its normal environment gate.
- Focused runtime and Phase 2 parser tests: 15 passed, 0 failed.
- Changed-file ESLint: passed.
- `npm run build`: passed.

## No-write proof

- No database client or production API is used by the canary.
- The canary reads only `public/parsedWatches.json` and the baseline parser from Git.
- The generated local result contains aggregate counts and classifications, not raw messages.
- No migration, UI, publication, schema, or deployment file is changed.

NO PRODUCTION DATA WAS MODIFIED.

NO RAW MESSAGE WAS MODIFIED.

NO UI/UX WAS MODIFIED.

NO EXISTING VALID PRICE WAS OVERWRITTEN.
