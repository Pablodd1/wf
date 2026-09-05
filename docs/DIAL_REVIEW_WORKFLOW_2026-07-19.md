# Dial Review Workflow - 2026-07-19

## Condition grouping verification

Price Research groups a dial color once. `New`, `Used`, and `Unknown` remain condition counts and optional filters inside that color; they do not create duplicate dial categories.

Live checks:

| Reference | Dial groups | Condition counts |
| --- | ---: | --- |
| Patek Philippe `5712/1A` | 1 Blue | New 175, Used 446, Unknown 33 |
| Rolex `116500LN` | 1 White | New 287, Used 165, Unknown 695 |
| Rolex `52506` | 1 Blue | New 159, Used 22, Unknown 73 |

No duplicate dial group was returned for these owner-critical references.

`Unknown` in this context means the source did not state condition reliably. It is not silently converted to Used.

## Review workflow correction

The Admin Review queue previously could not filter `DIAL_CHANGED` or `DIAL_AMBIGUOUS`, and displayed every proposed dial as `Unverified`. The updated workflow:

- adds Dial correction and Dial ambiguous filters;
- displays the proposed candidate dial;
- gives ambiguous dial proposals blocking priority;
- checks the proposed dial against the exact catalog reference;
- allows the narrow White/Silver catalog equivalence already used by Price Research;
- blocks impossible configurations with `CATALOG_DIAL_CONFLICT`;
- blocks dial promotion when the catalog has no dial evidence.

No shadow proposal or live listing was promoted by this code change. Human approval remains required and the promotion transaction remains audited and reversible.

## Remaining data action

The current deterministic dial batch remains in shadow review. The previously verified current proposal count was 337: Patek `3712/1A`, Patek `5712/1A` family, Rolex `116500LN`, and Rolex `52506`. Reviewers can now isolate those corrections and see the proposed color before approving or rejecting each record.
