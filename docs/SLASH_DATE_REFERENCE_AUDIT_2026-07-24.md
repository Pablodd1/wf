# Slash-Date Reference Audit

Date: 2026-07-24

## Scope

The read-only audit scanned all 16 supplied unbundled listing exports. It
selected rows whose exported `reference` is a calendar-shaped token such as
`2024/5` or `2025/12`, then reparsed only the preserved child `raw_line`.

These counts describe exported child rows, not unique watches or approved
market observations.

## Results

| Decision | Rows |
| --- | ---: |
| Catalog-confirmed reference candidate | 58,184 |
| Single reference requiring catalog review | 150,991 |
| No recoverable reference | 41,852 |
| Multiple references requiring review | 95 |
| **Total affected rows** | **251,122** |

Largest affected stored-brand labels:

| Brand label | Rows |
| --- | ---: |
| Rolex | 102,432 |
| Patek Philippe | 87,079 |
| Audemars Piguet | 19,251 |
| Richard Mille | 13,140 |
| Cartier | 9,057 |

Brand labels are preserved from the export and are not treated as verified.
The audit found obviously invalid labels such as `Datejust`, `Deep Blue`, and
`Calibre`; catalog confirmation prevents those labels from silently approving
a reference correction.

## Release Gate

- Production writes: `0`
- Automatic approvals: `0`
- Catalog-confirmed rows are correction candidates only.
- Every candidate still requires exact parent/child lineage, intent, price and
  currency evidence, duplicate/bundle checks, and reviewer approval.
- Date-only rows remain held instead of receiving an invented reference.

## Reproduction

```powershell
$env:UNBUNDLED_INPUT_DIR="C:\path\to\audit-output\unbundled"
$env:SLASH_DATE_AUDIT_OUTPUT="outputs\slash-date-reference-audit"
npm run audit:slash-date-references
```

The command writes `report.json` and a bounded `sample.csv`. It has no
Supabase client and no write path.

## Next Safe Canary

The first 100-row canary is complete:

| Result | Rows |
| --- | ---: |
| Parent matched | 100 |
| Exact child raw-line lineage | 100 |
| Original source date present | 100 |
| Seller name present | 0 |
| Seller phone present | 0 |
| Requires human correction | 49 |
| Blocked by price/currency | 33 |
| Blocked by catalog/dial | 17 |
| Blocked by lineage/intent | 1 |

The canary contained 40 Patek Philippe, 54 Rolex, four unknown-brand, and two
Cartier rows. Review flags included 33 price-parse and currency-ambiguity
blocks, 25 catalog dial conflicts, nine raw-price conflicts, seven USD-price
conflicts, and three currency conflicts.

No row is approved automatically. Parent lineage and source dates are strong,
but seller identity must be joined from the separate seller-lineage source.
The next step is human review of the 49 correction candidates followed by a
seller-lineage join. The remaining 51 rows stay blocked until their stated
catalog, dial, price, currency, or intent defect is resolved.

### Private seller-lineage coverage

The 100 child rows belong to 44 unique source parents. A read-only Railway
service-role check found:

| Private staging check | Coverage |
| --- | ---: |
| Parent lineage matched | 2 / 44 |
| Parent phone present | 2 / 44 |
| Parent seller name present | 1 / 44 |
| Parent source date present | 2 / 44 |
| Child lineage matched | 0 / 44 |
| Verified dealer matches | 0 / 44 |

The private tables are reachable and correctly protected, but their data does
not yet cover this canary. Customer pages must not show or infer dealer contact,
reputation, or seller activity from these rows. The next lineage job must join
the 42 unmatched parents to the source user export, stage exact matches
privately, and rerun this same canary before contact information is eligible.

The two exact source-user matches passed dry-run and were upserted into the
private parent-lineage table. Immediate read-back returned two matches, no
unmatched/conflicting/orphaned rows, and zero mismatches across phone, name,
intent, original date, listing linkage, title hash, and image evidence. No
dealer was assigned, consent remains ungranted, and no public record changed.

### Human-review package

The 100-row canary was split into two local, untracked review files:

- `human-review-49.csv`: correction candidates with blank decision and notes
  columns, exact child raw text, parent ID, original date, proposed/exported
  identity, and price/currency evidence;
- `held-51.csv`: deterministically blocked rows premarked `DEFER`.

Validation found 49/49 review rows with raw evidence and parent IDs, zero
preapproved decisions, and 51/51 blocked rows deferred. Raw-message evidence
and private lineage were not committed to GitHub.

### Remaining seller exceptions

Of the 42 unmatched parents:

- 35 have no exact seller-lineage evidence in the supplied user export;
- seven share a message hash with eight seller candidates but fail the exact
  timestamp gate.

The eight hash-only candidates are not timezone-level drift. Their timestamps
differ from the parent by approximately 150 to 310 days, and one candidate
also disagrees on WTS/WTB intent. The exact-time gate remains unchanged and
all seven parents remain unresolved. A local `seller-timestamp-review-7.csv`
contains pseudonymized identities and no raw phone numbers.
