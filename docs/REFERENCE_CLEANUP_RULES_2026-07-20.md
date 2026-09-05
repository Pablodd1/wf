# Reference cleanup rules

## Non-negotiable rule

The normalized reference must be supported by the preserved raw listing line.
Catalog data may validate or reject a source-supported reference, but it must
not invent a missing reference. When one exact reference cannot be isolated,
the row stays out of publication and moves to human correction.

## Deterministic actions

| Evidence in the raw child line | Action |
| --- | --- |
| One exact brand-compatible reference | Normalize casing and safe separators only |
| Price, date, condition, dealer item ID, brand, or model captured as reference | Replace only when one exact reference is visible; otherwise manual review |
| More than one watch reference | `MULTI_WATCH_STOCK_LIST` |
| Strap, bracelet, link, box, or other accessory | `ACCESSORY_NOT_WATCH` |
| Bag or another non-watch object | `NON_WATCH_OR_WRONG_CATEGORY` |
| Reference belongs to another brand | `WRONG_BRAND_SUSPECT` |
| Ambiguous or missing source evidence | `NEEDS_MANUAL_REVIEW` |

## Regression examples

- Rolex `DJ41 ... 126334` becomes `126334`; `555000HKD` never becomes a
  reference.
- Patek `5296g ... 20300USD` becomes `5296G`; Aquanaut strap `D31` is held as
  an accessory.
- AP `26470st ... 20300USD` becomes `26470ST`; bracelet stock lists are held.
- Richard Mille `35-02` becomes `RM35-02`; material such as `TI` remains a
  material claim rather than being appended to the reference.
- Cartier `Ref-WSSA0030` becomes `WSSA0030`.
- Omega `310.32.42.50.02.001` and Longines `L3.830.4.92.9` retain their dotted
  formats.
- Tudor `7939A1A0RU-0001` becomes `M7939A1A0RU-0001` when the exact source
  evidence supports that official form.
- JLC `q1322410-2013 Y` becomes `Q1322410`; the year is not part of the ref.
- IWC `only watch ... IW371702` becomes `IW371702`.
- Bvlgari `Used ... 102532 ... $62500` becomes `102532`; a valid six-digit
  Bvlgari reference is not reclassified as Rolex.
- Grand Seiko `... SBGC221` becomes `SBGC221`; Vacheron references in a Grand
  Seiko row are held as wrong-brand evidence.
- Bell & Ross `BR 03-92` becomes `BR03-92`; slash-bearing official references
  remain intact.

These examples are regression fixtures, not permission to guess. Vintage and
brand-specific formats that cannot be verified remain review work.
