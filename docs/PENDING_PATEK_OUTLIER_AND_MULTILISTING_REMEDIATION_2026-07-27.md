# Pending Patek Outlier and Multi-Listing Remediation

**Status:** pending implementation; no normalization or production-record write
is authorized by this document.  
**Owner:** CTO / reviewed normalization workflow  
**Scope:** Patek Philippe Price Research, starting with `5712/1A-001` and
`5712/1R-001`; reusable for every brand.

## Decision

Do not treat the full **Excluded evidence for human review** table as a list of
price outliers. A record is a statistical outlier only after it is a
single-listing, catalog-confirmed WTS record with source-proven currency and,
when needed, a retained FX source and date. All other exclusion reasons are
data-quality blockers and must be corrected or explicitly held before IQR is
calculated.

Unsplit multi-listing parents remain immutable evidence and stay outside
Trading Floor and Price Research. They must never be deleted. A parent is
suppressed only after every accepted child has exact parent/line lineage and
the duplicate decision is reconciled.

## Evidence observed in the live Price Research UI on July 27, 2026

### Patek Philippe `5712/1A-001`, Blue dial

| Metric | Observed value |
| --- | ---: |
| Raw rows sampled | 1,767 |
| Rows passing WTS and catalog gates | 214 |
| Final comparable chart set | 180 |
| True IQR outliers removed | 34 |
| Reposts represented once | 145 |
| Explicit stored-currency mismatches corrected with retained evidence | 51 |

The first displayed page of 100 *human-review exclusions* was not 100 price
outliers. Its reasons were:

| Reason | Rows on displayed page |
| --- | ---: |
| Unsplit multi-listing source | 42 |
| Price exists but source currency is not verified | 40 |
| Currency conversion rate is not verified | 11 |
| Bare dollar sign requires currency review | 7 |

### Patek Philippe `5712/1R-001`, Brown dial

| Metric | Observed value |
| --- | ---: |
| Raw rows sampled | 874 |
| Rows passing WTS and catalog gates | 129 |
| Final comparable chart set | 116 |
| True IQR outliers removed | 13 |
| Reposts represented once | 66 |
| Explicit stored-currency mismatches corrected with retained evidence | 45 |

The first displayed page of 100 human-review exclusions had 23 unsplit
multi-listing rows, 35 source-currency-unverified rows, 30 FX-rate-unverified
rows, and 12 bare-dollar rows. This confirms the same blocker pattern across
the Patek 5712 family.

## Concrete multi-listing failure pattern

The live excluded detail showed one immutable source block containing:

```text
USED ... 5167a 2020 hkd565k ... 5167a 2023 hkd640k ...
5712/1a Blue 2021 hkd1m
```

The correct Patek child candidate, if the deterministic segmenter can prove
the line boundary, is:

```text
reference: 5712/1A
dial: Blue
year: 2021
price_raw: hkd1m
currency: HKD
price_usd: null unless a retained FX source and FX date are present
parent_lineage: exact parent and source-line/block offsets
```

It must **not** inherit year `2020` from the preceding 5167A line. The source
section's `USED` may be inherited only if the deterministic context rule
attaches it to that exact child block; otherwise condition remains `null`.

The current detail presentation also showed a derived USD asking-price label
for this excluded multi-listing while the source evidence stated `HKD 1m`.
Pending UI correction: when an item is unsplit or FX is unverified, show only
the raw price/currency plus its blocker; do not foreground a derived USD price.

## Required normalization rules

1. **Segment before normalize.** Detect every reference/price boundary before
   assigning model, dial, year, condition, price, or currency.
2. **No cross-child inheritance.** A child may inherit only explicit
   section-level context with recorded offsets. Never inherit a year, price,
   reference, dial, or accessory/configuration from a neighboring child.
3. **Currency is independent of price.** Preserve `price_raw`; set currency
   and `price_usd` to `null` when the source currency is ambiguous. An explicit
   HKD value still requires a retained FX source and date before USD analytics.
4. **Separate dispositions.** Use distinct, mutually comprehensible reasons:
   `BUNDLE_SOURCE_UNSPLIT`, `CURRENCY_UNVERIFIED`,
   `CURRENCY_RATE_UNVERIFIED`, `CURRENCY_AMBIGUOUS`,
   `DUPLICATE_REVIEW_REQUIRED`, and `STATISTICAL_OUTLIER`.
5. **Apply IQR last.** Only evaluate an IQR/MAD outlier after identity,
   child-lineage, currency/FX, WTS intent, and repost gates pass. An IQR flag
   never deletes the observation or hides its evidence.
6. **Never reuse parent media or seller data.** A child image or poster is
   eligible only with its own exact applied lineage, verified identity, and
   required consent/review decision.

## Pending execution sequence

1. Create deterministic regression fixtures for the three-line 5167A/5712
   source pattern and equivalent HKD, bare-dollar, and duplicate variants.
2. Add a read-only cohort audit for every Patek reference that reports counts
   by the six dispositions above, separating true IQR outliers from blockers.
3. Correct detail rendering so held records foreground raw evidence and never
   present unproven USD as the asking price.
4. Run a shadow-only Patek child segmentation canary: 1,000 parents, exact
   input/output/error reconciliation, no `watch_records` writes.
5. Sample every reason category against immutable raw evidence; block rollout
   if a child borrows a field from another line.
6. Promote only individually reviewed, source-linked child listings; then
   suppress their parent from customer surfaces without deleting it.
7. Persist accepted corrections as regression fixtures and reason-count
   dashboards, so the normalizer cannot repeat a corrected failure.

## Release criteria

- Zero cross-line price/reference/year assignments in canary samples.
- Every source row reconciles to an accepted child, a specific blocker, or an
  error; no silent drops.
- Customer Price Research exposes true IQR outlier counts separately from
  currency, bundle, identity, and duplicate holds.
- No derived USD is shown where the retained FX source/date is missing.
- No bundle parent, guessed image, or unverified seller is customer-published.

