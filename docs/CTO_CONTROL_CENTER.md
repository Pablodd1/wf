# WatchFacts CTO Control Center

**Control date:** August 1, 2026
**Assignment mode:** controlled customer publication plus continuous,
read-only MariaDB shadow capture and deterministic normalization
**Current release decision:** keep the exact owner-reviewed Panerai workbook
cohort and reviewed Zenith cohort live through bounded, deduplicated customer
reads. Do not reuse the discarded Rolex/Patek release. Do not bulk-publish the
new three-brand workbooks until their signed canary is persisted to an
explicitly configured shadow target and reconciled by readback.

**Infrastructure update:** the upgraded Supabase and Railway queue path has now
exactly reconciled every raw-evidence-eligible record. Four Railway workers with
batch size 250 remain the validated ceiling. The workload is dominated by
database round trips and record complexity rather than worker CPU or memory;
adding a larger machine is not the fastest current move.

This is the single navigation and decision index for the current project state.
It does not replace immutable evidence, code, migrations, or dated readbacks.
When documents conflict, use the authority order below and record the conflict;
do not choose the more optimistic number.

## August 1 continuous source stabilization

PRs [#233](https://github.com/Pablodd1/wf/pull/233),
[#234](https://github.com/Pablodd1/wf/pull/234), and
[#235](https://github.com/Pablodd1/wf/pull/235) are merged. They restore the
reviewed publication boundary after an unsafe open-access change, protect Price
Research with dealer authentication, require explicit verified USD for market
analytics, require exact source-image lineage, keep seller contact private
without publication consent, and keep excluded observations reviewer-only.
The full repository safety suite passed `617/617`; the production build passed.

The live upstream `thecollective_inventory.auctions` monitor reported:

| Source measure | Verified result |
| --- | ---: |
| Total rows | 1,353,529 |
| Rows in the latest 24 hours | 6,722 |
| Freshness lag at check | 265 seconds |
| Source account mode | SELECT-only |
| Production writes from monitor/canaries | 0 |

The dedicated Railway service `wf-mariadb-shadow` is active with one replica
and a persistent 5 GB volume mounted at `/data`. Its source cursor begins at
the historical start, copies immutable raw evidence, runs deterministic
`v4.2-line-condition` normalization, checkpoints both stages, and then polls
for new rows every 30 seconds. It does not call AI/vision, Supabase, or any
customer publication path.

The first self-healing production readback after deployment reconciled exactly:

| Worker measure | Verified result |
| --- | ---: |
| Source input rows | 22,000 |
| Immutable raw outputs | 22,000 |
| Collection errors | 0 |
| Normalization proposals | 22,000 |
| Normalization errors | 0 |
| `watch_records` writes | 0 |

Observed throughput is approximately 52 rows/second. The initial full catch-up
is estimated at about 7.2 hours from worker start, after which the same worker
continues as the live tail. Current row-size extrapolation is approximately 4.0
GB against the 5 GB volume; volume use must be watched during catch-up.

Declared and corrected stabilization errors:

- The first bounded canary found that legacy `auctions.year` does not exist;
  the collector stopped before output and now uses the verified source schema.
- The first isolated Railway deployment inherited the old Supabase worker
  command, crashed without writes, and was removed. Railway now keeps the old
  service default while allowing an explicit per-service command.
- Eight legacy scripts contained embedded database credentials and unsafe
  direct-import/FX behavior. Those paths are disabled and known literals were
  removed. The exposed credentials still require rotation.
- Repository lint still reports 169 pre-existing issues. This is declared
  technical debt; build and the 617 safety/contract tests pass.

Continuous capture and normalization proposals do **not** mean automatic
publication. Bundle parents, incomplete catalog identity, ambiguous currency,
unverified images, unapproved contacts, duplicates, and outliers remain held or
routed to review. Promotion to Trading Floor or Price Research requires a
separate signed, reconciled publication decision.

## July 30 three-brand reviewed workbook intake

The current authoritative handoff is
[`THREE_BRAND_REVIEWED_WORKBOOK_RELEASE_2026-07-30.md`](THREE_BRAND_REVIEWED_WORKBOOK_RELEASE_2026-07-30.md).
It supersedes older estimates for the owner-supplied Patek Philippe, Rolex, and
Audemars Piguet workbook folder.

| Control measure | Verified result |
| --- | ---: |
| In-scope workbooks | 296 |
| Input rows | 7,630,906 |
| Distinct rows after exact brand-aware dedupe | 6,108,416 |
| Exact duplicate copies held | 1,522,490 |
| Complete identity before dedupe | 7,510,497 |
| Source-proven Price Research candidates before remaining gates | 105,624 |
| Database writes from the full audit | 0 |

The 100,000-row mixed-brand local canary reconciles exactly:

| Canary disposition | Rows |
| --- | ---: |
| Trading Floor ready | 96,332 |
| Also Price Research ready | 821 |
| Focused identity review | 3,388 |
| Exact duplicate copies held | 280 |
| Errors / database writes | 0 / 0 |

The canary ran deterministic normalization `v4.2-line-condition` at 634.16
rows/second. The supplied reviewed workbook remains the identity authority;
parser disagreements are retained as audit flags rather than silently
overwriting owner-reviewed fields. True multi-listings and missing required
identity remain held.

Draft PR [#205](https://github.com/Pablodd1/wf/pull/205) contains the
reproducible local audit/canary and an additive, empty-on-create three-brand
verified cache. The cache cutover is disabled by default. Apply the migration,
persist and read back the signed canary, refresh the cache, and only then set
`THREE_BRAND_RELEASE_CACHE=true`.

## July 30 Panerai client-readiness release

The Panerai release input is the already materialized, owner-reviewed
`PANERAI_REVIEWED_XLSX_20260729` cohort. Its immutable scope is:

| Release measure | Exact controlled count | Customer treatment |
| --- | ---: | --- |
| Reviewed source records | 99 | Retained unchanged |
| Unique raw listing messages | 92 | One public card per deterministic repost signature |
| Exact duplicate raw-message groups | 7 | Reposts remain in evidence; duplicate public cards are suppressed |
| WTB records | 2 | Trading Floor only |
| WTS records | 97 | Trading Floor; Price Research retains every row as evidence |
| Approved Panerai references | 71 | Browse and direct reference search |
| Records with reviewed display imagery | 99 | Displayed as reference imagery, not seller photography |
| Original DigitalOcean listing-photo matches in this cohort | 0 | No original-photo claim is made |

The customer image rule is explicit: the Panerai workbook uses online
model-reference imagery where exact source listing photography is unavailable.
Every such image is labeled **Reference image** with the notice that it is not
the seller's original listing photo. This owner-authorized presentation does
not create image lineage and does not change the immutable raw message.

Price Research uses one bounded read of the 99 reviewed record IDs for Panerai
model/reference discovery and one bounded exact-reference read for analytics.
It does not fan out one database query per catalog reference. Owner-reviewed
brand, model, reference, and dial values may support identity display, but
prices enter averages only when raw-message currency and FX evidence pass the
existing deterministic rules. Missing or ambiguous price evidence remains
visible as listing evidence and is not averaged.

Trading Floor orders images first and then the highest customer-safe price,
uses 24-row mobile pages, suppresses deterministic repost cards without
deleting evidence, and fails closed if verified inventory is unavailable.
POST ITEM routes to the moderated internal dealer submission workflow at
`/dealer/post`.

**Production verification completed July 30, 2026:** PRs
[#199](https://github.com/Pablodd1/wf/pull/199),
[#200](https://github.com/Pablodd1/wf/pull/200), and
[#201](https://github.com/Pablodd1/wf/pull/201) are merged. Vercel and the
WatchFacts Railway service reported successful production deployments. The
deduplicated customer API reports `92` Panerai listings and `943` Zenith
listings (`1,035` total). Panerai browse reports four model families and 69 WTS
references; the 71-reference release total above also includes references that
do not belong in WTS Price Research browse.

Production desktop and 390-pixel mobile browser QA confirmed: Panerai detail
shows its contact-redacted raw message and visible reference-image disclosure;
POST ITEM opens `/dealer/post`; an unsupported Rolex URL fails closed instead
of substituting Panerai; and mobile has no horizontal overflow. Direct search
for `PAM00671` resolves to Panerai and preserves both HKD offers as reviewed
evidence. It publishes zero analytics observations because dated FX provenance
is not verified. No database row, schema, or immutable source evidence was
changed by this release.

## July 28 historical release record and active bottlenecks

The Rolex/Patek counts in this section are retained as historical evidence and
are superseded for the current customer release by the July 30 Panerai/Zenith
decision above.

**Released customer-facing work:** PRs #176 through #181 are merged. They add
advisory direct-image delivery for review only, the Price Research live release
summary, the community-count and POST ITEM destination, verified-USD-first
Trading Floor ordering, and the listing-focused Trading Floor detail view. The
detail view no longer requests or displays Price Research analytics; those
analytics remain in Price Research. The home footer now distinguishes Curated
Luxury marketplace from WatchFacts market intelligence.

**Historical July 28 production inventory readback:** 110,178 verified Rolex/Patek
Trading Floor listings are customer-visible: 105,974 Rolex and 4,204 Patek
Philippe. This is the complete currently publishable two-brand set, not a claim
that every raw archive row is normalized, image-verified, seller-verified, or
price-eligible. Price Research is deliberately narrower: it includes only
source-proven WTS observations with valid identity, currency/FX, bundle, and
duplicate dispositions.

**Normalization execution is complete for the eligible shadow source:**
2,631,476 of 2,631,583 watch records were exactly analyzed and reconciled with
zero normalization-run errors. The remaining 107 records have no immutable raw
message and cannot be repaired without the original source-to-UUID mapping.
No final normalization run wrote to `watch_records`.

| Priority | Active bottleneck | Verified size/status | Required safe next action |
| --- | --- | --- | --- |
| 1 | Catalog identity | 82,111 conflicts and 38,595 unverified in the legacy control snapshot | Review a bounded 1,000-record/rule canary; publish only signed catalog-confirmed or human-approved identity decisions. |
| 2 | Bundles and multilisting | 761,489 parent messages require splitting; 70,194 staged children from the supplied unbundled source; zero approved | Reconcile every child to exact source line and parent, review it, materialize accepted children, then suppress a parent only after its accepted children reconcile. Never delete raw parents. |
| 3 | Currency and price eligibility | HKD needs source-date FX; bare `$` remains ambiguous; Price Research excludes these correctly | Verify source currency and dated FX from evidence. Do not convert from geography, amount, or market expectation. |
| 4 | Images | 1,359 historical visual-review decisions remain; 172 structural rejects; live narrow queue: 371 Rolex ready, 0 Patek ready, 12 structurally blocked | Repair structural evidence first. Visual AI may rank a review queue only; attach an image only after exact listing lineage and signed human MATCH. |
| 5 | Sellers/users | 16,094 private seller candidates; zero seller-linked public listings | Prove listing-to-source-to-seller lineage, dealer verification, consent, and allowed contact method before display. |
| 6 | Missing raw evidence | 107 records blocked | Obtain the authoritative import mapping with database UUIDs and source rows. The supplied listing CSV is not sufficient evidence for repair. |
| 7 | Patek quality regression | 5712/1A-001 and 5712/1R-001 need the planned cross-line inheritance regression and small shadow canary | Complete the documented shadow-only fix and verify its exact reconciliation before any parser/catalog change or public expansion. |

**Infrastructure decision:** no Railway or computer upgrade is justified now.
The validated ceiling is four Railway workers, queue mode, batch size 250. The
work is dominated by database round trips and evidence complexity, not CPU or
memory. More workers, no-code tools, or an external model cannot turn missing
lineage into verified identity, price, image, or seller data.

**Immediate operator sequence:** (1) complete the release QA that is already
live; (2) run catalog and Patek shadow canaries; (3) resolve structural image
evidence; (4) use the existing signed review lanes in small packets; and (5)
convert repeated, signed corrections into deterministic regression fixtures.
Keep each operator's changes on a separate branch and do not mix UI changes
with normalization or production data writes.

## Pending Patek outlier and multi-listing correction

The live Patek `5712/1A-001` and `5712/1R-001` evidence review confirmed that
the large excluded-evidence table is primarily a bundle/currency/FX queue, not
a statistical-outlier queue. The exact observations, cross-line inheritance
failure pattern, required regression fixture, and shadow-only remediation
sequence are in
[`PENDING_PATEK_OUTLIER_AND_MULTILISTING_REMEDIATION_2026-07-27.md`](PENDING_PATEK_OUTLIER_AND_MULTILISTING_REMEDIATION_2026-07-27.md).

This is a pending plan only. It authorizes neither a parser change nor a
production-record write. The existing bundle-parent, image, seller, currency,
and duplicate gates remain in force.

## July 27 continuation: image/listing evidence and AI review

The current continuation decision, request summary, verified pending work, and
the contained AI-assisted image-review design are in
[`CTO_CONTINUATION_AND_IMAGE_AI_HANDOFF_2026-07-27.md`](CTO_CONTINUATION_AND_IMAGE_AI_HANDOFF_2026-07-27.md).

The important correction is that visual AI may not treat a brand/model/dial
resemblance, reference prefix, filename, or visual similarity as an image
match. It reads one already lineage-linked image blindly; only a complete,
exact visible-reference agreement may be suggested as `MATCH`, and a human
still records the signed decision. The assistant never attaches media, changes
listing fields, or publishes a listing.

The prior review queue work remains in effect: PR #171 added bounded
field-level human identity assistance, and PR #172 fixed the identity queue's
safe bounded lookup path. Those workflows are advisory and signed respectively;
they do not replace the independent image, seller, bundle, duplicate, price,
or currency gates.

**Current live image release readback:** at `2026-07-27T18:21:56Z`, zero images
were visually verified. Of 580 source-linked Rolex/Patek candidates, 371
Rolex records (and zero Patek records) had complete evidence ready for human
image review; 12 candidates were structurally blocked. This narrow operational
queue is distinct from the historical all-brand audit count. See the
continuation handoff for its exact scope and the required deployment-variable
check before review begins.

## July 27 full Rolex and Patek release

The active customer mission expands the prior three-reference canary to every
Rolex and Patek Philippe listing that passes the reviewed identity, confidence,
bundle, duplicate, and customer-safety gates. The implementation, definition
of “full,” human identity workflow, deployment sequence, census contract, and
rollback are in
[`FULL_ROLEX_PATEK_RELEASE_2026-07-27.md`](FULL_ROLEX_PATEK_RELEASE_2026-07-27.md).

The customer API no longer loads the whole reviewed population into application
memory. Postgres performs global repost selection and the API uses bounded
created-at/record-ID keyset pagination. The prior 999-row ceiling remains only
as the fail-closed rollback path for the older exact-reference release.

The new identity-review lane is authenticated and signed. It shows immutable
raw evidence, observed seller evidence, candidate images, and other release
blockers, but its decision changes only `listing_identity_reviews`. Price,
currency, image, seller, bundle, and duplicate gates remain independent.

## July 27 three-watch rollback baseline

The previous deadline release was limited to Rolex 116610LN, Patek Philippe
5712/1A-001, and Rolex 126710BLNR. The exact selection evidence, condition
aggregation rule, counts, image review gate, seller gate, preview acceptance
tests, and rollback are in
[`THREE_WATCH_CLIENT_RELEASE_2026-07-27.md`](THREE_WATCH_CLIENT_RELEASE_2026-07-27.md).

Condition remains part of each immutable listing description but is no longer
an analytics cohort dimension. Price Research and Trading Floor market
comparisons aggregate New, Used, and Unspecified observations by exact
brand/reference/dial.

The July 27 approved-90 evidence expansion and current human-review counts are
recorded in the same release document. It distinguishes 109 true statistical
outliers from currency, catalog, bundle, and duplicate exclusions; records 689
private screening candidates under the historical fixed-HKD-rate audit; and
preserves fail-closed canonical identity, FX, image, and seller publication.

The earlier two-brand release remains the predecessor and infrastructure
baseline:

The current deadline release is limited to Rolex and Patek Philippe. The exact
scope, counts, controls, UI behavior, image gate, seller gate, timing, and
rollback are in
[`TWO_BRAND_CLIENT_RELEASE_2026-07-27.md`](TWO_BRAND_CLIENT_RELEASE_2026-07-27.md).
This release changes application reads and presentation only. It does not
approve images, assign dealers, promote normalization proposals, or write
production records.

## Authority order

1. [`AGENTS.md`](../AGENTS.md) — repository-wide safety and evidence rules.
2. [`DATA_RECOVERY_STATUS_2026-07-25.md`](DATA_RECOVERY_STATUS_2026-07-25.md) —
   newest exact production snapshot and release gates.
3. [`DATA_IDENTITY_INCIDENT_2026-07-24.md`](DATA_IDENTITY_INCIDENT_2026-07-24.md) —
   fail-closed identity and image containment.
4. [`EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md`](EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md) —
   safe external-assistance and zero-hallucination contract.
5. [`RESET_HANDOFF_AND_CLIENT_EXECUTIVE_SUMMARY_2026-07-18.md`](RESET_HANDOFF_AND_CLIENT_EXECUTIVE_SUMMARY_2026-07-18.md) —
   historical restart handoff; newer verified findings override its counts.
6. Repository code, tests, and migrations for exact implemented behavior.
7. Older plans and rollout reports as historical evidence only.

The current deterministic archive analyzer is
`tools/shadow-reprocess/shadow-reprocess.cjs`, version
`v4.2-line-condition`, backed by `api/_lib/normalization-v4.cjs`.
Catalog confirmation is fail-closed through
`api/_lib/catalog-confirmation.cjs`, and review disposition is controlled by
`tools/shadow-reprocess/promotion-policy.cjs`.

## Current exact operating snapshot

The following counts combine the July 25 inventory readback with the final
July 26 exact shadow reconciliation. “Analyzed” or “normalized” is not the same
as human-approved, published, or correct.

| Control measure | Exact count | Decision meaning |
| --- | ---: | --- |
| Raw records | 17,000 | Immutable source layer; preserve |
| Watch records | 2,631,583 | Live legacy inventory; do not bulk rewrite |
| Raw-evidence-eligible watch records | 2,631,476 | Deterministic shadow-analysis scope |
| Eligible shadow rows analyzed | 2,631,476 | Full eligible coverage, not approval |
| Remaining eligible rows | 0 | Exact eligible cohort complete |
| Normalization errors | 0 | No eligible row was silently dropped |
| Missing-raw rows | 107 | Exact gap audit complete; 0 exact recoveries, all remain blocked |
| Catalog-confirmed identities | 22,976 | Eligible for later bounded review |
| Identity conflicts | 82,111 | Block |
| Identity unverified | 38,595 | Block |
| Human-approved identities | 0 | No automatic promotion claim |
| Verified Trading Floor candidates | 10,864 | Preview canary source only |
| Bundle parents requiring split | 761,489 | Parent must not display as a child |
| Accepted image-audit cohort | 1,531 | Exact input/output; 0 errors |
| Manifest-linked image candidates | 1,523 | Lineage link does not mean visually verified |
| Images requiring visual review | 1,359 | Private human-review scope |
| Structural image rejects | 172 | Blocked before visual review |
| Visually verified / auto-approved images | 0 / 0 | Customer image release remains blocked |
| Private seller candidates | 16,094 | Identity/consent review only |
| Seller-linked listings | 0 | Do not publish seller/contact data |
| Unbundled staged children | 70,194 | Review lanes only |
| Unbundled approved/published | 0 | No bulk publication |

The `2,631,476` eligible rows plus the `107` separately blocked missing-raw rows
reconcile exactly to `2,631,583` watch records. The 107-row gap is not a parser
error and must not be normalized without immutable raw evidence.

## Accepted missing-raw gap audit

The read-only July 26 audit independently re-read the exact 107-row gap and
reconciled:

```text
2,631,583 watch_records
= 2,631,476 raw-evidence-eligible rows
+ 107 raw-message-null rows
```

The two exact missing-ID reads produced the same SHA-256:
`cb244382b0ef4c49221fbde6d2b1d6b5d3668a3dad42979ebdd978b043eff797`.
All 107 rows are WTS records from `WATCHES_FINAL_V2`: 85 Rolex, 12 Patek
Philippe, 5 Vacheron Constantin, 2 Blancpain, 2 Richard Mille, and 1 Audemars
Piguet. None has a `raw_messages` pointer or image lineage.

The supplied `User list all details..csv` was scanned completely:

| Evidence check | Result |
| --- | ---: |
| Bytes | 1,320,589,058 |
| Data rows | 1,293,376 |
| SHA-256 | `2c8f500f829cf64437f2db4bcc12bdc9e3a49a15edab3597994c1b4e2bbbee5b` |
| Exact source-UUID matches | 0 |
| Front-image review candidates | 0 |

The authoritative `WATCHES_FINAL_V2_20260706_1108.xlsx` workbook was then
hashed and scanned across the six affected brand sheets:

| Workbook check | Result |
| --- | ---: |
| Bytes | 100,223,864 |
| Rows scanned | 496,501 |
| SHA-256 | `ba677083c9fc446e3f716c7f82d4e6ba64bf7ec01f7624e65ece7f71be07c4b6` |
| Unique timestamp plus field candidate | 1 |
| Ambiguous candidates | 52 |
| Unresolved | 54 |
| Exact database-UUID recovery | 0 |

The workbook has no database UUID column. Its one unique composite candidate
is review-only, not permission to repair `watch_records`. The remaining gap
requires an original `WATCHES_FINAL_V2` import/mapping export containing the
database record UUID or another signed lineage key. The local private audit
artifacts remain ignored under `audit-output/missing-raw-gap-20260726/`.

## Accepted image audit and local reviewer

The exact image audit reconciled `1,531` input rows to `1,531` output rows with
zero errors. It found `1,523` manifest links and routed `1,359` rows to visual
review. The remaining `172` were structural rejects:

| Structural reject | Exact rows |
| --- | ---: |
| Manifest missing | 8 |
| Dial conflict | 161 |
| Brand conflict | 3 |
| **Total** | **172** |

No image was visually verified or automatically approved.

The accepted private reviewer packet reconciles `50 = 50 + 0`: 50 review rows
and zero errors. It contains zero reviewer decisions, zero defaulted decisions,
and caused zero database writes. A named operator is required; the only valid
decisions are `MATCH` and `NO_MATCH`, each with a reason of at least 12
characters. The packet and reviewer remain local-only.
They must not be published or committed.

## July 26 bounded normalization operations

All results below are deterministic `v4.2-line-condition` shadow analysis.
They are not human approvals or public promotion.

| Cohort | Input | Output | Errors | Whole-cohort rate | Human review | No change | Disposition |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| July 26 cohort 1 | 500,000 | 500,000 | 0 | 115.53 rows/sec | Recorded in cohort artifacts | Recorded in cohort artifacts | Exactly reconciled |
| July 26 cohort 2 | 500,000 | 500,000 | 0 | 139.09 rows/sec | Recorded in cohort artifacts | Recorded in cohort artifacts | Exactly reconciled |
| July 26 cohort 3 | 500,000 | 500,000 | 0 | 162.72 rows/sec | 381,061 | 118,939 | Exactly reconciled |
| July 26 final cohort | 236,476 | 236,476 | 0 | 171.79 rows/sec | 180,934 | 55,542 | Exactly reconciled |

For the final cohort, the four-worker processing window measured `298.07`
rows/second. The `171.79` rows/second whole-cohort rate remains the conservative
operational measure because it includes queue and reconciliation overhead.

Final exact coverage:

```text
raw-evidence eligible: 2,631,476
shadow covered: 2,631,476
remaining eligible: 0
errors: 0
missing raw evidence: 107 separately blocked
workers: 4
batch size: 250
watch_records writes: 0
promotion: false
```

Final normalization deployment:

```text
Railway deployment: 0563930b
Git commit: f309fde
workers: 4
batch size: 250
```

PR #140 then merged and Railway automatically deployed the observability-only
change:

```text
Railway deployment: 2c8c9f4e-e785-43ff-8494-2161a077dd59
Git commit: 25ff5c36abe2eed150d95166607dcd14745ccf8e
instances: 4
worker_started events: 4
lease_complete: processed 0; batches 0; timing and memory present
process exits: clean
final queue: 236,476 COMPLETE; 0 unfinished; 0 FAILED
```

This validates startup, zero-work lease summaries, timing/memory emission, and
clean exit. It does not exercise per-batch metrics. A synthetic 1,000-row
production canary was not created because remaining eligible rows are zero and
resetting evidence or creating `watch_records` solely for a test is prohibited.

Current release controls:

| Change | State | Gate |
| --- | --- | --- |
| Stable-key image audit ([PR #138](https://github.com/Pablodd1/wf/pull/138)) | Merged to `main` at `f309fde` | Complete |
| Count-independent image audit ([PR #142](https://github.com/Pablodd1/wf/pull/142)) | Merged to `main` at `2f38615` | Exact 1,531-row audit accepted; visual decisions remain local |
| WatchFacts groups footer ([PR #145](https://github.com/Pablodd1/wf/pull/145)) | Merged and deployed at `e7cc59c` | Production Trading Floor and Price Research smoke passed |
| Two-brand client release ([PR #151](https://github.com/Pablodd1/wf/pull/151)) | Ready for review after conflict resolution | Rolex and Patek only; exact image and seller gates remain fail closed |
| Worker observability and reversible duplicate controls ([PR #132](https://github.com/Pablodd1/wf/pull/132)) | Draft | Query-plan, fail-closed API, restore-idempotency, and rollback canaries |
| Immutable review packets and Review Queue lane ([PR #133](https://github.com/Pablodd1/wf/pull/133)) | Draft; preview checks passed | No production migration/import |
| Bounded packet exporter/importer ([PR #134](https://github.com/Pablodd1/wf/pull/134)) | Draft, stacked on #133 | Preview-specific RPC canary and rollback |
| Redacted review-learning candidate exporter ([PR #137](https://github.com/Pablodd1/wf/pull/137)) | Draft, stacked on #134 | Engineer-reviewed candidates only; no automatic rule changes |
| Worker observability-only release ([PR #140](https://github.com/Pablodd1/wf/pull/140)) | Merged and automatically deployed at `25ff5c3`; zero-work observability passed | Per-batch gate on the first legitimate new 1,000 rows or in preview |

## Workstream controls

| Workstream | Authoritative contract | Current disposition | Next bounded gate |
| --- | --- | --- | --- |
| Normalization | [`NORMALIZATION_CONTRACT.md`](NORMALIZATION_CONTRACT.md) | Full eligible shadow coverage; 107 missing-source rows audited and blocked | Review the one composite candidate; obtain an exact UUID/source mapping for the remainder |
| Promotion | [`SHADOW_PROMOTION_POLICY.md`](SHADOW_PROMOTION_POLICY.md) | Human approval required | Review a bounded catalog-confirmed cohort |
| Currency | [`CURRENCY_RULES.md`](CURRENCY_RULES.md) | Explicit evidence only; bare `$` is ambiguous | Audit exact-line evidence and FX provenance |
| Catalog identity | [`DATA_IDENTITY_INCIDENT_2026-07-24.md`](DATA_IDENTITY_INCIDENT_2026-07-24.md) | Fail closed | Continue bounded identity staging/readback |
| Bundles | [`BUNDLE_CANARY_V42_2026-07-18.md`](BUNDLE_CANARY_V42_2026-07-18.md) | Split and review before parent suppression | Work priority children in small review batches |
| Images | [`CTO_CONTINUATION_AND_IMAGE_AI_HANDOFF_2026-07-27.md`](CTO_CONTINUATION_AND_IMAGE_AI_HANDOFF_2026-07-27.md) | Exact audit complete; 1,359 need visual review; 0 verified | Review bounded source-lineage packets with blind AI observation and signed human decision |
| Seller/dealer | [`IMAGES_SELLER_UNBUNDLED_STATUS_2026-07-24.md`](IMAGES_SELLER_UNBUNDLED_STATUS_2026-07-24.md) | Private evidence; no consent/verification | Owner review of exact identity groups |
| Duplicates | [`DUPLICATE_AUDIT_PROTOCOL.md`](DUPLICATE_AUDIT_PROTOCOL.md) | No suppression before bundle decisions | Human review only |
| Green API | [`GREEN_API_INTEGRATION.md`](GREEN_API_INTEGRATION.md) | Converge into immutable raw pipeline | Preserve event/message/media lineage |
| Railway | [`RAILWAY_NORMALIZATION_WORKER.md`](RAILWAY_NORMALIZATION_WORKER.md) | Four replicas, batch 250 ceiling; zero-work observability passed | First legitimate new 1,000 rows or preview-only per-batch canary |
| Human review packets | [PR #133](https://github.com/Pablodd1/wf/pull/133) | Draft PRs only; no production import | Preview RPC canary with preview-specific key |

## 100,000-row benchmark

The benchmark is a local-file analysis tool. It has no network or database
client and cannot write to `watch_records`. Each worker loads the local
catalog, enriched references, catalog source, curation aliases, and dial aliases
once at worker initialization.

Default immutable evidence:

```text
public/parsedWatches.json
```

This tracked snapshot contains 117,744 rows. The benchmark selects the first
100,000 in source order and records the source SHA-256, implementation hashes,
catalog hashes, Git commit, adapter version, worker count, and batch size in
`run-manifest.json`. The snapshot IDs are not live `watch_records.id` values;
results measure deterministic behavior and capacity, not production
promotion eligibility.

Run:

```powershell
npm run benchmark:normalization-100k
```

Explicit reproducible run:

```powershell
node tools/normalization-benchmark/benchmark-100k.cjs `
  --input public/parsedWatches.json `
  --output audit-output/normalization-benchmark-100k `
  --rows 100000 `
  --workers 4 `
  --batch-size 250
```

Required local outputs:

```text
run-manifest.json
coverage-report.json
coverage-report.csv
blockers-by-reason.csv
changed-records.csv
errors.csv
benchmark.json
reconciliation.json
```

`reconciliation.json` must prove:

```text
input_rows = output_rows + error_rows
```

`output_rows` is every successfully analyzed source row. `changed-records.csv`
contains only successful rows with one or more change flags; unchanged rows are
counted in the coverage and reconciliation reports.

## Completed benchmark result

The final local run completed on July 25, 2026 using four workers and batches
of 250:

| Measure | Result |
| --- | ---: |
| Input rows | 100,000 |
| Successfully analyzed output rows | 100,000 |
| Errors | 0 |
| Reconciliation difference | 0 |
| Rows with one or more proposed changes | 62,054 |
| Rows with no proposed change | 37,946 |
| Processing runtime | 99.234 seconds |
| Total runtime including local artifacts | 100.261 seconds |
| Throughput | 1,007.72 rows/second |
| Peak process RSS | 919.54 MiB |
| Catalog confirmed | 18,163 |
| Human review disposition | 82,671 |
| Ready for human approval | 17,329 |
| Explicit currency evidence | 87,950 |
| Currency ambiguous | 2,766 |
| Currency missing | 1,146 |
| Bundle split required | 30 |
| No candidate | 799 |

The 62,054 changed rows are deterministic proposals, not approved
normalizations. The smaller 17,329 “ready for human approval” cohort still
requires a reviewer decision; it is not safe for automatic publication.

The benchmark remains reproducible capacity evidence. Its former full-run time
estimates are removed because the eligible production shadow run is now
complete and exactly reconciled. Human review duration is not inferred from
worker throughput.

The largest human-review blockers in this static snapshot are:

| Blocker | Rows |
| --- | ---: |
| Catalog partial match | 52,218 |
| Catalog not found | 15,529 |
| Currency evidence insufficient | 7,535 |
| Dial ambiguous | 3,659 |
| Emoji price ambiguous | 2,766 |
| No candidate | 799 |
| Asking price incomplete | 341 |
| Catalog brand conflict | 193 |
| Bundle split required | 30 |

The benchmark artifacts are local and ignored by Git at:

```text
audit-output/normalization-benchmark-100k/
```

## Benchmark acceptance gates

A benchmark is decision-grade only when all of these are true:

- input path, byte size, row count, selection rule, and SHA-256 are recorded;
- normalizer version and implementation hashes are recorded;
- every requested worker reports the same catalog counts;
- all eight required files exist and no `.partial` file remains;
- input rows reconcile exactly to successful output rows plus errors;
- errors are preserved in `errors.csv`, never silently dropped;
- catalog, currency, bundle, and review statuses cover every successful row;
- production connections, database writes, and `watch_records` writes are zero;
- throughput and memory are reported from the same run;
- estimated full-run duration is labeled as a compute estimate, excluding
  database I/O, retries, review, and promotion.

Any failed gate stops expansion. Do not start a full-dataset run from a partial
or unreconciled benchmark.

## Railway decision

Railway remains the worker platform. The post-upgrade canaries and four-worker
shadow cohorts are complete. Their earlier gates are recorded in
[`SUPABASE_POST_UPGRADE_NORMALIZATION_CANARY_2026-07-25.md`](SUPABASE_POST_UPGRADE_NORMALIZATION_CANARY_2026-07-25.md).
Queue mode passed with two workers after removing its redundant global lease;
legacy cursor mode retains the global lease.

Current safe operating point:

```text
Railway replicas: 4 maximum
SHADOW_BATCH_SIZE: 250
SHADOW_WORKER_MODE: queue
Bounded cohorts only
```

Measured production shadow results:

| Gate | Rows/sec | Reconciliation |
| --- | ---: | --- |
| 1 worker, batch 250 | 79.74 | 10,000/10,000; 0 errors |
| 1 worker, batch 500 | 81.86 | 25,000/25,000; 0 errors |
| 2 workers, batch 250 | 178.94 | 50,000/50,000; 0 errors |
| 4 workers, batch 250, cohort 1 | 115.53 whole-cohort | 500,000/500,000; 0 errors |
| 4 workers, batch 250, cohort 2 | 139.09 whole-cohort | 500,000/500,000; 0 errors |
| 4 workers, batch 250, cohort 3 | 162.72 whole-cohort | 500,000/500,000; 0 errors |
| 4 workers, batch 250, final cohort | 171.79 whole-cohort; 298.07 worker-window | 236,476/236,476; 0 errors |

Batch 500 added only 2.65%, so 250 remains safer. Two workers added 124.39%
over the original baseline. Large-cohort throughput then improved across exact
source ranges but did not scale linearly. Four workers and batch 250 are the
ceiling until a separately approved contention canary proves a higher setting.
The final run used Railway deployment `0563930b` at commit `f309fde`.

## Fastest accurate next move

1. Review the one unique missing-raw workbook candidate; do not repair it
   without a signed UUID/source-row lineage decision.
2. Obtain the original `WATCHES_FINAL_V2` import mapping with database UUIDs
   for the other 106 rows; the supplied user-list CSV is not that source.
3. Review the largest blocker categories and representative changed rows.
4. Complete PR #132's query-plan, fail-closed API, restore-idempotency, and
   rollback gates in preview only.
5. Exercise PR #140's per-batch metrics on the first legitimate new 1,000 rows
   or in preview; do not reset completed evidence or create synthetic
   `watch_records` to force a production canary.
6. Convert stable repeated corrections into tests before changing parser or
   catalog behavior on a separately approved branch.
7. Route uncertain rows to the existing human-review lanes in small cohorts;
   do not create a second source of truth.
8. Use corrections as labeled fixtures for deterministic rules first and ML
   suggestions second. ML suggestions never auto-approve price, currency,
   identity, seller, bundle, or image relationships.

## Human correction and learning loop

The fastest safe design is one queue with deterministic dispositions:

```text
immutable source
-> deterministic v4.2 proposal
-> catalog/currency/bundle gates
-> ready for human approval | human correction | blocked/error
-> signed reviewer decision
-> regression fixture and rule/model evaluation
-> new versioned shadow canary
```

Corrections should include source ID, exact raw evidence, proposed value,
reviewer decision, reason, reviewer, timestamp, parser/catalog version, and
image/seller/bundle lineage where applicable. Learning data must be split by
source message so near-duplicate listings do not leak between training and
evaluation. A model may rank or suggest; deterministic publication gates and a
human remain authoritative.

## Explicit holds

- Do not bulk-promote shadow normalization into live records.
- Do not start another unbounded worker run; future work must be bounded and
  exactly reconciled.
- Do not reset completed queue evidence or create synthetic `watch_records` to
  manufacture an observability canary.
- Do not write benchmark output to `watch_records`.
- Do not change parser/catalog behavior or production review records without a
  separate reviewed release.
- Do not display bundle parents as normalized child listings.
- Do not infer bundle children or attach images by brand/reference resemblance,
  filename proximity, or visual similarity.
- Do not publish or commit the private image-review packet or local reviewer
  state.
- Do not expose seller identity/contact without verified lineage and consent.
- Do not treat shadow completion, catalog match, or "review ready" as human
  approval.

## Related decision record

The infrastructure and acceleration assessment is in
[`CTO_NORMALIZATION_EXPEDITE_DECISION_2026-07-25.md`](CTO_NORMALIZATION_EXPEDITE_DECISION_2026-07-25.md).
Its implementation plan requires separate approval and is not authorized by
this docs-only update. This control center remains the entrypoint.
