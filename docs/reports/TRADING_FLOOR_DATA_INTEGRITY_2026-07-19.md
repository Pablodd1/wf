# Trading Floor Data Integrity Safeguard

Generated: 2026-07-19

## Production evidence

A read-only sample of the first 1,000 WTS rows returned by the production
Trading Floor archive endpoint found 723 records with at least one obvious
cross-field contamination (72.3%).

| Issue | Sample count |
|---|---:|
| Price-like value stored as dial color | 697 |
| Price-like value stored as reference | 513 |
| Reference equal to brand | 106 |
| Invalid non-positive price | 8 |

Issue counts overlap because one listing can fail more than one rule. This is a
bounded operational sample, not an exact archive-wide count.

## Customer safeguard

The Trading Floor API now withholds only the invalid customer-facing field. It
does not delete, update, suppress, or approve the source record. Every returned
row includes:

- `data_quality_review_required`
- `data_quality_issues`

The UI labels affected listings `Data under review` and explains that the
original listing remains preserved. Plausible fields continue to display.

## Required remediation

1. Trace affected rows to the exact raw-message candidate line.
2. Split bundle and multi-listing messages before field correction.
3. Re-extract reference, price, dial, condition, and year deterministically.
4. Validate reference and dial against the catalog when available.
5. Stage proposed changes in shadow review; do not overwrite raw evidence.
6. Promote only reviewed corrections, then rerun this sample and the named
   Patek/Rolex regression references.

The publication safeguard is not a substitute for normalization remediation.
It prevents known bad fields from being represented as facts while that work
continues.
