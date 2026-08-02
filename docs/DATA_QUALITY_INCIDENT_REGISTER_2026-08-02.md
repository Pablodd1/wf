# WatchFacts Data Quality Incident Register

**Control date:** August 2, 2026
**Scope:** customer-visible listing identity, price research, images, seller
lineage, intent, incoming source capture, and operational countability

This is the permanent mistake-and-remediation register. A correction is not
closed merely because the UI looks better. Closure requires immutable source
evidence, a deterministic regression fixture, a bounded reconciled readback,
and a verified customer result when publication is involved.

## Confirmed incidents

| ID | Severity | Failure | Root evidence | Current disposition | Required regression |
| --- | --- | --- | --- | --- | --- |
| DQ-001 | Critical | A WTB/NTQ message was presented like a for-sale listing and could imply a price. | Raw message `NTQ - 5821/1a green`. | Corrected: buyer request, price on request, exact source image/contact only. | NTQ stays WTB and never receives an invented asking price. |
| DQ-002 | Critical | Listing image and description could disagree. | John review screenshots plus exact listing/source lineage audit. | Structurally blocked unless the image belongs to the exact source listing; AI visual similarity is advisory only. | Image publication requires exact source lineage, reachable URL, configuration agreement, and signed review. |
| DQ-003 | High | Seller information was absent from cards even when an owner-approved poster was stored; other rows genuinely lack poster lineage. | Exact Rolex 116500LN workbook/API reconciliation found approved poster name and phone on the source row. | Show the exact approved poster when present; omit the field when absent and never infer identity or contact. | Customer seller fields require applied lineage and allowed contact use. |
| DQ-004 | High | Reviewed Rolex/Patek cohorts were blocked by deployment release configuration. | Live browser returned “Brand is not included in this release.” | Corrected by PR #242 while retaining approval and evidence gates. | Release configuration can restrict publication but cannot bypass quality gates. |
| DQ-005 | High | A three-record Patek 3712/1A cohort displayed “0 qualified comparables.” | Live UI simultaneously showed three included source records. | Corrected by PR #243; the panel now reports three and still withholds analytics below five. | Sub-five cohort count must equal the included comparable count. |
| DQ-006 | High | Excluded/outlier evidence appeared as customer watch rows and obscured the analysis. | Price Research customer review. | Corrected by PR #241: aggregate methodology first; at most 12 included examples afterward. | Outliers stay preserved for review but never render as customer listing cards. |
| DQ-007 | High | HKD/USD ambiguity and stored/source price mismatches could distort analytics. | July 22 100,000-row audit: 40,313 currency-unverified, 22,937 ambiguous, 236 rate-unverified, 18,220 mismatches. | Blocked from Price Research unless exact currency and dated FX evidence pass. | Bare `$` never becomes USD; source currency and FX lineage are mandatory. |
| DQ-008 | High | Bundle parents could appear as individual watches or duplicate their children. | 761,489 parent messages and 70,194 staged children in the control readback. | Parents remain preserved and held until accepted children reconcile. | Materialize reviewed children before suppressing a parent or reviewing duplicates. |
| DQ-009 | High | Workbook-derived dial/configuration values can look authoritative without per-row image verification. | Live 5821/1A search contains 73 WTB rows; only the exact Natan source row was browser-verified in the bounded check. | Unverified rows remain countable but are not claimed as visually confirmed. | Visual verification cannot be inherited across rows, references, or duplicate-looking media. |
| DQ-010 | High | Incoming MariaDB rows were captured on a Railway volume but invisible to the website’s operational counts. | `wf-mariadb-shadow` local checkpoint/status contract. | This release adds a service-only accountability snapshot target; no customer record writes. | Source input must reconcile to raw plus collection errors; raw must reconcile to proposals plus normalization errors. |
| DQ-011 | Critical | Trading Floor labeled missing source-confirmed currency as “Price on request” even when the reviewed workbook contained a price. | Rolex 116500LN source row has workbook USD 26,500, but its retained summary text contains `26500.00` without an explicit currency token. | Display the reviewed workbook price with a pending-source-confirmation label; keep it out of Price Research averages until source currency is explicit. Use “Price not provided” only when neither source nor workbook contains a price. | A workbook-reviewed price can be visible but cannot become `price_usd` or an analytics observation without exact source evidence. |
| DQ-012 | Critical | Sentinel values such as dial `multiple` were accepted as complete single-watch identities and published as watch cards. | Exact Rolex API examples include `WTS Rolex 116500 multiple` with source images and no single configuration. | Preserve the rows in reviewed inventory, exclude them from single-watch customer feeds and Price Research analytics, and route them to multi-listing correction. | `multiple`, `multi`, and `mixed` model/dial sentinels never pass the single-watch publication query or central price/demand eligibility gate. |
| DQ-013 | High | Source-image-first ordering placed legitimate no-price WTB requests ahead of priced listings. | The Natan David `NTQ - 5821/1a green` row contains no amount or currency but appeared first because it has an exact source image. | Preserve the WTB row and its poster/image, label it `Price not provided`, and globally order retained supplied prices before no-price rows. | Never borrow another listing's price; no-price Trading Floor rows remain visible but sort last. |

## August 2 publication-evidence reconciliation

The exact three-brand workbook audit reconciled 7,630,906 source rows. Of those,
7,044,437 contain a workbook price, but only 108,137 have an explicit USD match
in retained source evidence. A further 5,104,038 require dated non-USD FX,
2,377,237 have ambiguous or missing currency, and 41,494 have an explicit USD
conflict. These are evidence states, not watches to discard.

A separate bounded read-only scan of the first 2,500 ordered live records
reconciled exactly. It found 2,146 workbook prices pending source-currency
confirmation, 354 rows with no workbook price, 2,500 approved phone contacts,
12 missing poster names, and 2,500 exact source-image URLs. Because the live
endpoint reports an estimated 2,846,442 rows and deep offset queries can time
out, this is explicitly a publication sample, not a full-population claim.

## Root-evidence contract for every watch

Each candidate must retain this chain:

```text
source platform/table + source ID
-> immutable raw payload/message hash
-> exact context block or child line
-> deterministic parser and catalog versions
-> claimed values with evidence status
-> image and seller lineage decisions
-> review/publication disposition
-> customer surface or explicit blocked reason
```

Missing links stay `null` with a reason. Catalog or vision can validate watch
identity/configuration; neither may create price, currency, intent, date,
seller, or source-image lineage.

## Countability outcomes

Every source row must end in exactly one operational outcome:

1. immutable raw evidence captured;
2. collection error;
3. deterministic proposal produced;
4. normalization error;
5. ready for review;
6. blocked with a stable reason;
7. approved for a named customer surface;
8. rejected/deferred while preserving evidence.

Customer publication is a downstream outcome, not the definition of whether a
row is counted. Trading Floor and Price Research must remain narrower than the
source archive whenever evidence is incomplete.

## Incoming listings

- Telegram: immutable allowlisted events and processing results are stored in
  Supabase shadow tables. Deterministic output and optional vision remain
  suggestions until review.
- MariaDB `thecollective_inventory.auctions`: the SELECT-only Railway worker
  preserves immutable raw JSONL, deterministic proposals, errors, cursors, and
  exact reconciliation on its persistent volume.
- The new accountability ledger accepts counts, cursors, freshness, and error
  totals only. It is not permitted to receive listing rows or write to
  `watch_records`.
- Moving a captured incoming listing to customer surfaces still requires the
  normal catalog, currency, bundle, duplicate, image, seller, and approval
  gates.

## Definition of done

“All watches accommodated” means every source row is captured or has a declared
collection error, every captured row has a proposal or declared normalization
error, every proposal has a stable review/publication outcome, and all counts
reconcile. It does **not** mean publishing uncertain records as facts.
