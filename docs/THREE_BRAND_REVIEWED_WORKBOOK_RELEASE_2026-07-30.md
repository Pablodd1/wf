# Three-Brand Reviewed Workbook Release

**Control date:** July 30, 2026
**Source scope:** Patek Philippe, Rolex, and Audemars Piguet workbooks in the
owner-supplied `3 PP rolex and au` folder
**Current decision:** do not bulk-publish the collection yet

## Executive result

The complete local audit read all 296 in-scope workbooks and reconciled every
row. It made zero database writes.

| Brand | Files | Input rows | Distinct after exact brand-aware dedupe | Duplicate copies held |
|---|---:|---:|---:|---:|
| Patek Philippe | 138 | 928,017 | 928,010 | 7 |
| Rolex | 104 | 1,342,971 | 1,342,952 | 19 |
| Audemars Piguet | 54 | 5,359,918 | 3,837,454 | 1,522,464 |
| **Total** | **296** | **7,630,906** | **6,108,416** | **1,522,490** |

The exact-content key includes canonical brand, posting date, normalized raw
message, normalized reference, and workbook price. All 7,630,906 source IDs are
present and unique. The 1,522,490 held rows have different source IDs but exact
duplicate content. They must not become duplicate customer listings.

“Distinct” is not the same as “approved live.” Bundle/multi-listing checks,
production collision checks, price/currency admission, and the signed shadow
canary remain required.

## Field coverage before dedupe

| Evidence | Rows |
|---|---:|
| Immutable raw listing evidence | 7,630,898 |
| Complete brand/model/reference/dial identity | 7,510,497 |
| WTS | 7,531,044 |
| WTB | 99,862 |
| Seller name | 561,822 |
| Seller phone | 581,528 |
| Any supplied image URL | 1,326,424 |
| Supplied user image URL | 581,192 |
| Catalog/reference image URL | 990,218 |
| Catalog confirmed | 1,113,868 |

Missing images and contacts are not invented. An otherwise eligible listing is
text-only when no exact public image is verified. Seller/contact data is shown
only when supplied for that exact row and marked owner-approved for public
contact.

## Price Research gate

The workbook column `Price ($ USD)` is not, by itself, source price/currency
evidence. The raw listing remains the authority.

| Brand | Source-explicit USD matches | Identity-complete WTS candidates | Dated FX required | Currency ambiguous/missing | Explicit USD conflicts |
|---|---:|---:|---:|---:|---:|
| Patek Philippe | 9,532 | 8,930 | 503,029 | 409,850 | 5,606 |
| Rolex | 2,725 | 2,589 | 301,460 | 1,034,748 | 4,038 |
| Audemars Piguet | 95,880 | 94,105 | 4,299,549 | 932,639 | 31,850 |
| **Total** | **108,137** | **105,624** | **5,104,038** | **2,377,237** | **41,494** |

The 105,624 figure is a pre-dedupe maximum for the next canary, not a live
Price Research count.

A bare `$` is still ambiguous. For example, `$497000 ... arrive HK` cannot be
stored as USD. An explicit HKD or other non-USD asking price can be retained on
the listing, but its USD analytic value remains held until the FX rate, source,
and date are retained.

## Images

- A supplied user image is the first publication candidate for its exact row.
- A catalog URL is a reference image, not a seller listing photo, and must be
  disclosed as such.
- An unreachable URL becomes no image. It does not hide the listing or render a
  broken frame.
- Visual AI is targeted only to exact supplied images with a missing dial or an
  identity conflict. AI output is review evidence, not automatic truth.

## Structural result

The current target copy of `Audemars Piguet all 17.xlsx` is valid:

- SHA-256:
  `47e3d80cbb4b55d8dec638c6a649a1356235933a53c50164c5a808ad6113beda`
- rows: 100,000
- worksheet: `Sheet1`
- required 22-column schema plus five QA columns

The final audit did not use the separate recovery copy and did not overwrite
any workbook.

## Required release sequence

The deterministic 100,000-row mixed-brand local canary is complete. It sampled
three hash-locked workbooks per brand across historical, middle, and recent
shards.

| Canary result | Rows |
|---|---:|
| Input / reconciled dispositions | 100,000 / 100,000 |
| Trading Floor ready | 96,332 |
| Price Research ready within the Trading Floor rows | 821 |
| Focused identity review | 3,388 |
| Exact duplicate copies held | 280 |
| Extraction errors / database writes | 0 / 0 |

The canary completed in 157.689 seconds at 634.16 rows/second with 1,327 MB
peak RSS. Its review blockers are 2,920 missing dials, 577 missing references,
395 missing models, and 10 detected multi-listings; individual rows can have
more than one blocker.

The remaining release sequence is:

1. Run current deterministic normalization `v4.2-line-condition` only as a
   contradiction, bundle, and currency gate. Preserve supplied normalized
   fields and raw evidence.
2. Reconcile:

   ```text
   input
   = Trading Floor candidates
   + Price Research-only holds
   + duplicate copies held
   + bundle/multi-listing holds
   + technical errors
   ```

3. The local canary is complete. Persist the same signed cohort only to an
   explicitly configured shadow/staging table. Never write the canary to
   `watch_records`.
4. Read back the persisted canary and approve the signed manifest.
5. Add Audemars Piguet to a generalized verified three-brand release
   cache/view. The current customer cache is still explicitly Rolex/Patek.
   Apply the additive migration and refresh the signed cache before setting
   `THREE_BRAND_RELEASE_CACHE=true`; the default remains the current two-brand
   cache.
6. Publish checkpointed batches. Use four Railway workers and batch size 250
   only after the canary proves exact reconciliation and stable database
   latency.
7. Verify Trading Floor, Price Research, dashboard counts, seller contact, and
   image provenance independently.

## Current readiness

- **Trading Floor UI:** supports text-only rows and missing optional fields.
- **Rolex/Patek backend:** existing verified two-brand cache is reusable after
  the new workbook rows pass staging and dedupe.
- **Audemars Piguet backend:** not yet ready; requires the controlled
  three-brand cache/view expansion.
- **Price Research:** not ready for the workbook USD column as a bulk source.
  Only source-proven USD or audited dated-FX rows may enter.
- **Production writes from this audit:** 0.

## Timing

- mixed 100,000-row local canary and reconciliation: complete;
- persisted shadow canary and readback: 30–60 minutes after the shadow target
  is explicitly configured;
- staging importer plus tests and three-brand cache migration: 2–4 hours;
- first checkpointed customer release after an accepted canary: approximately
  3–8 hours, dependent on database write/readback throughput;
- full image reachability and targeted visual review: separate, potentially
  multi-hour work because images are optional and URL sources rate-limit.

The release should be incremental. Text-only verified listings can move first;
image enrichment and non-USD FX completion continue without blocking them.
