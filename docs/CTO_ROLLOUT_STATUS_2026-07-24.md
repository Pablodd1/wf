# Curated Luxury / WatchFacts CTO rollout status - 2026-07-24

## Release assessment

**Conditionally ready for customer beta.**

The public marketplace and bounded Price Research workflows are operational.
The product is not ready to publish unreviewed seller contact, unbundled child
inventory, or bulk normalization changes.

## Verified live

- Production build and 48 targeted market/security tests pass.
- Trading Floor returns bounded database pages and currently reports about
  567,040 customer-visible records.
- Price Research applies catalog model, catalog dial, explicit currency,
  single-listing, duplicate, plausibility-floor, and IQR gates before a price
  affects analytics.
- The Patek `7118/1200A` featured listing parser now reads `84000 USD 2025` as
  USD 84,000 instead of treating the year as the price.
- Price Research synchronizes its reference input when a new reference loads.
- AP `26252OR` independently proves the image path from manifest to
  `watch_records`, public API, reachable Spaces object, and rendered Trading
  Floor DOM.
- All 22 audited Supabase migration contracts are verified and reconciled.
  Production ledger reconciliation reports zero unresolved versions.
- `watch_staging`, seller lineage, contact reveal audit, duplicate review, and
  media manifest data are private under service-role boundaries.

## Current measured data

### Normalization

The deterministic normalization scan reached the full archive estimate:

| Measure | Rows |
| --- | ---: |
| Shadow rows analyzed | 2,631,468 |
| Changed rows estimated | 1,988,600 |
| Bundle split required | 765,933 |
| No candidate | 319,987 |
| Reference changed | 390,948 |
| Price changed | 415,772 |
| Currency changed | 256,656 |
| Currency ambiguous | 175 |
| Price parse failed | 351 |
| Dial changed | 162,449 |
| Dial ambiguous | 151,134 |

This is analysis coverage, not approval. No table-wide promotion is authorized.

### Images

| Measure | Rows |
| --- | ---: |
| Image-backed watch records | 1,531 |
| Manifest objects | 1,623 |
| Linked manifest objects | 1,523 |
| Reachable manifest objects | 1,623 |
| Reachable but still discovered/unlinked | 100 |

The final 58-row residual ledger passed exact database readback with zero
failures. Five visually unsafe candidates were excluded.

### Seller and dealer lineage

| Measure | Rows |
| --- | ---: |
| Exact parent seller candidates staged privately | 16,094 |
| Pending child seller rows | 190 |
| Source-company candidates awaiting dealer reconciliation | 1,580 |
| Authenticated directory profiles staged privately | 12 |
| Listings with exact normalized-phone support | 86 |
| Unique phone identities supporting review | 4 |
| Verified dealers | 0 |
| Verified contact-consent records | 0 |
| Public listings attributed to a dealer | 0 |

No seller name or phone is authorized for customer publication. Full contact
may be revealed only to authenticated reviewers through the audited endpoint.
The 12-profile directory canary found zero immutable source-ID matches. Exact
normalized-phone overlap supplies review evidence for 86 listings across four
identities, but it does not verify a dealer, establish consent, or authorize an
automatic link. The generated 86-row review manifest contains record IDs and
evidence labels only; it contains no phone values.

### Unbundled inventory

| Measure | Rows |
| --- | ---: |
| Manually staged children | 70,194 |
| Pending | 64,036 |
| Blocked for renormalization | 6,158 |
| Review-ready lane | 42,359 |
| Human-correction lane | 27,835 |
| Approved/published | 0 |

Review-ready is a routing label, not approval. Bundle parents must remain
visible or suppressed according to the audited parent/child decision; children
cannot be published in bulk.

## Release blockers

1. Human-review the four phone-supported dealer identity groups, then continue
   reconciling the remaining 1,580 source-company candidates.
2. Record dealer verification and explicit contact consent before exposing
   phone or WhatsApp details.
3. Review the 28 human-correction rows in the current 95-row seller child
   cohort and the known intent conflicts before expanding seller lineage.
4. Work unbundled children in bounded human-review batches; do not promote the
   70,194 staging rows automatically.
5. Keep the remaining 100 discovered images unlinked until one listing maps to
   one visually confirmed source image.
6. Historical Price Research charts remain unavailable where original source
   dates are missing. Do not substitute import `created_at`.
7. Perform an authenticated reviewer smoke test for full contact reveal. The
   unauthenticated 401/403 boundary is verified; the positive authenticated
   path remains unverified.

## Next execution order

1. Decide the four phone-supported dealer identity groups and record consent
   separately from identity verification.
2. Complete human decisions for the current seller child canary.
3. Review and publish a bounded unbundled child batch, then suppress parents
   only after duplicate review.
4. Review the remaining image discoveries visually; stop when lineage is not
   exact.
5. Continue Price Research reference-by-reference QA using John Cornier's
   priority references before expanding forecast claims.

## Evidence

- PR #117: Price Research input synchronization.
- PR #118: Year-token price rejection and featured listing repair.
- PR #119: Image readback, private staging hardening, and market-view contract.
- GitHub Actions run `30136124476`: production forward schema repair.
- GitHub Actions run `30136164612`: 22/22 migration predicates verified.
- GitHub Actions run `30136203508`: 22 repaired, 0 unresolved.
- `tools/mission-images/verify-image-ledger-readback.cjs`
- `tools/dealer-lineage/audit-directory-source-overlap.cjs`
- `docs/IMAGES_SELLER_UNBUNDLED_STATUS_2026-07-24.md`
