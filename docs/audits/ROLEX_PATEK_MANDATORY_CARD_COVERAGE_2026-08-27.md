# Rolex/Patek Mandatory Card Evidence Coverage — 2026-08-27

## Decision

Rolex and Patek remain background-only. The unique completed inventory is preserved,
but the customer projection does not yet have enough proven values to satisfy the
mandatory card contract at full-cohort quality.

This report separates four different claims that must not be conflated:

1. the field exists in the schema;
2. an evidence-backed value exists for a listing;
3. the customer projection returns that value safely; and
4. the rendered card displays the mandatory value or safe fallback.

## Preserved background cohort

| Measure | Rolex | Patek Philippe |
|---|---:|---:|
| Final unique current listings | 1,535,763 | 937,001 |
| `CONFIRMED_CURRENT` | 221,830 | 108,890 |
| `LATEST_OBSERVED` | 1,313,933 | 828,111 |
| WTS | 1,386,508 | 884,326 |
| WTB | 149,255 | 52,675 |
| Qualified Price Research observations | 38,521 | 45,638 |
| Price Research distinct observed references | 2,623 | 2,341 |
| Price Rating-ready references | 1,731 | 1,662 |
| Duplicate current-listing keys | 0 | 0 |
| Duplicate offer-family keys | 0 | 0 |
| Missing required lineage keys | 0 | 0 |
| Invalid availability states | 0 | 0 |

## Actual mandatory-field evidence

Percentages use the final unique current-listing total. A sampled result is labeled as
such and must not be represented as a full-cohort count.

| Mandatory card area | Rolex evidence actually available | Patek evidence actually available | Current assessment |
|---|---:|---:|---|
| Image — exact customer-safe seller/listing URL | 255 (0.0166%) | 0 (0.0000%) | **INSUFFICIENT**. All other cards require the standard placeholder. |
| Source media marked `image_linked` | 147,712 (9.6182%) | 76,554 (8.1701%) | **NOT DISPLAY PROOF**. These counts cannot be used by the image filter unless an exact safe URL bridge exists. |
| Category/intent | WTS 1,386,508; WTB 149,255 | WTS 884,326; WTB 52,675 | **AVAILABLE** at cohort level. |
| Brand and exact observed reference | 50/50 in the final pre-hold API sample | 50/50 in the final pre-hold API sample | **SAMPLED PASS**; full distinct-current-reference total was not emitted by the frozen summary. |
| Structured model | Customer mapper currently returns `null` | Customer mapper currently returns `null` | **MISSING FROM PROJECTION**. Title must fall back to brand plus exact observed reference. |
| Original raw message | 50/50 in the final pre-hold API sample | 50/50 in the final pre-hold API sample | **SAMPLED PASS**; immutable lineage is complete, but full-cohort non-null raw-text coverage was not separately counted. |
| Verified customer USD price | 36,865 (2.4004%) | 45,153 (4.8189%) | **PARTIAL**. Remaining cards require **Price requires review**. |
| Original structured foreign amount/currency | Suppressed by the current card mapper | Suppressed by the current card mapper | **MISSING FROM CARD PROJECTION**; evidence remains visible in raw text but is not reliably structured for display. |
| Price Rating | 1,731 rating-ready references | 1,662 rating-ready references | **PARTIAL**. Non-qualified cards require **Open for rating**. |
| Proven source poster/canonical dealer linkage | 9,951 (0.6480%) | 1,297 (0.1384%) | **INSUFFICIENT**. A hashed `Poster <key>` label is not a real poster identity and must not satisfy this field. |
| Evidence-backed dealer/user rating | No reconciled full-cohort count | No reconciled full-cohort count | **UNVERIFIED**. Display **Not rated** until evidence is joined. |
| Proven country/location | 9,951 (0.6480%) | 1,297 (0.1384%) | **PARTIAL**. Unknown locations must show **Location not available** and must not enter country facets. |
| Posting date/timestamp | 50/50 in the final pre-hold API sample | 50/50 in the final pre-hold API sample | **SAMPLED PASS**. The source-timestamp versus materialization-timestamp contract still requires full-cohort proof before release. |
| Availability state | 221,830 confirmed; 1,313,933 latest | 108,890 confirmed; 828,111 latest | **AVAILABLE** and exactly reconciled. Latest-observed cards require **CHECK AVAILABILITY**. |

## Why the cohort is not ready to display

The database connection and the completed inventory are not the root problem. Immediately
before the production hold, the customer feed returned the exact approved totals and 50
rows per brand in 375–898 ms. The failures are at the evidence/projection/rendering boundary:

- the current shadow card mapper deliberately returns `model: null`, `year: null`, and
  `source_price_amount: null`;
- verified child-image URL coverage is 255 Rolex and zero Patek, far below the historical
  `image_linked` markers;
- most rows lack a proven real poster/dealer identity and proven country;
- no reconciled aggregate proves dealer/user rating coverage;
- the previous combined Trading Floor loader used an all-or-nothing two-brand request,
  so one failed request could blank the entire customer page; and
- earlier API canaries proved fields and sample responses, but did not prove mandatory
  rendered values or safe fallbacks on every customer card.

## Publication hold verification

Production merge `d2600cba08635bb1d3a6b4bf952adf89fe91050b` applies the reversible
background hold. Post-deployment checks returned:

| Public path | Rolex | Patek Philippe |
|---|---|---|
| Trading Floor brand feed | HTTP 200, 0 records, `BACKGROUND_VERIFICATION` | HTTP 200, 0 records, `BACKGROUND_VERIFICATION` |
| Price Research | HTTP 404, `BACKGROUND_VERIFICATION` | HTTP 404, `BACKGROUND_VERIFICATION` |
| Broad watch feed | HTTP 200, 0 records, `BACKGROUND_VERIFICATION` | Same shared broad-feed response |

The hold contains no database migration, census, reload, reclassification, or raw/source
mutation. Restoring publication requires a separate decision plus explicit server and
frontend selectors; changing the stored cohort is neither required nor permitted by this
report.

## Evidence sources

- Frozen run: `32953447624`
- Frozen version: `curated-luxury-rolex-patek-final-32953447624`
- Frozen shadow run: `17d6d831-86cd-5e67-9830-c881bcf16e0d`
- Final canary: 20/20
- Production hold PR: `#799`
- Production hold merge: `d2600cba08635bb1d3a6b4bf952adf89fe91050b`
