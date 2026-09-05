# WatchFacts Accuracy Overhaul — Postmortem
Date: 2026-06-22 | Commits: b6ea14b, ac3942b, 64d8432, 2e11de6, 08add0f, 18d4468, b802ff0, f089f27

## OBJECTIVE
"Descriptions can never differ from results." Raise parser accuracy, add dual-currency
(native + USD), fold in real catalogs, build a measurement harness, fix root causes.

## METHOD
Built a regression scoreboard: 154 hand-labeled dealer messages (Training_Analytics.xlsx,
Human/Auto status) as ground truth. Every change measured before/after. No change shipped
that lowered a real score.

## ACCURACY DELTA (regexParse vs 154 ground-truth rows)
| Field      | Before | After | Note |
|------------|--------|-------|------|
| reference  | 79%    | 100%  | null-refs 18 -> 0 |
| price      | 95%    | 98%   | 3 residual = mislabeled truth (ref-as-price, "$161" garbage) |
| currency   | 88%    | 95%   | 7 residual = no-price listings + sheet over-defaulting HKD |
| dial       | 81%    | 100%  | typo/alias map |
| year       | 52%    | 33%*  | *NOT a regression — see below |

*YEAR: 86/86 mismatches are batch/warranty codes (N5/26, 5/2026) that the SHEET labels
as years but the product-owner rule says are NOT manufacture years. 0 genuine year errors.
New `warranty` field captures these codes instead.

## CATALOG EXPANSION
177 Patek refs -> 1,667 refs across 3 brands:
  + Rolex Final Catalog: 303 refs (16 dials)
  + Omega Final Catalog: 1,187 refs (15 dials)
Added Omega dotted-ref parsing (210.20.42.20.01.001) so the Omega catalog is actually used.
NOT merged: 102K parsed-listing xlsx files (those are parser OUTPUT, would feedback-loop
the bugs back in — kept as potential expanded test data only).

## FIXES SHIPPED
1. Year "2020Y" suffix parses (b6ea14b)
2. "N5/2026" batch code not parsed as year (ac3942b)
3. Demo UI row misalignment — cards from API watches not per-line index zip (64d8432)
4. Multi-watch-on-one-line split, e.g. Patek+IWC recovers dropped 2nd watch (2e11de6)
5. Demo auto-seed removed — no more stale demo data on open (08add0f)
6. Intent-aware verdict — buyer "Looking for" -> demand lane, "Sold" -> recycle (18d4468)
7. Parser overhaul: input normalization (full-width punct, glued tokens), ref suffix
   preservation, Rolex 6-digit + lowercase suffix refs, K/M decimals, dial aliases,
   warranty field, dual USD; + 3-brand catalog (b802ff0)
8. Split full-width comma + price/year-word guards: single watch with stray commas
   ("AP 26320，2013Full，45500USD") stays 1 watch; genuine multi-splits unaffected (f089f27)

## REMAINING OPEN
- Duplicate-line dedupe: identical pasted lines still create duplicate records.
- catalog_feedback table EMPTY: human-correction loop persists nothing.
- usdEquivalent shows None when currency already USD (cosmetic — it IS the USD price).
- Sheet-vs-rule year disagreement: decide if sheet should be relabeled to match the rule.

## KEY LESSON
Patch tool + terminal/sed DISPLAY corrupt regex literals (show '***'/wrong bytes) while
the on-disk bytes are valid. Always: edit regex via Python read+replace+write, verify
on-disk via node fs.readFileSync, trust `node --input-type=module --check` over visual output.


## ADDENDUM (later same day) — THE REAL ROOT CAUSE
Test source identified: C:/Users/jasme/Downloads/Patek_Philippe.csv (244,557 rows;
columns: description, image_link). 47% of descriptions are MULTI-LINE (embedded newlines/
blank lines inside one quoted CSV field).

THE catastrophic bug (commit 2fb3ca5): a SINGLE multi-line listing like
"5164R\n2023 new movement\nFull set retail ready\n$130,000" was being SHREDDED into 3
separate rows (ref-only / junk / price-only). Cause: splitWatches step 1 split on newlines
& blank lines, step 3 re-split by line reading the ORIGINAL text and undoing step 2's merge.

Fix: step 2 now counts STRONG references in the whole block; <=1 ref => ONE watch (merge all
lines incl. blank-line-separated); 2+ ref-lines => split per ref-bearing line. Step 1 no
longer pre-splits on blank lines; redundant step-3 line-split disabled.

Result on real CSV sample (41 unique descriptions): before ~24/26 had discrepancies;
after = 33 clean, 1 junk (a WTB multi-ref buyer line), 0 orphan-ref. Field accuracy held
(ref 100/price 98/currency 95/dial 100). Multi-watch regression 8/8.

LESSON: when a pipeline 'has the right count but wrong pairing/content', suspect the
SPLITTER, not the field parser. And always test with the user's ACTUAL input file — the
multi-line CSV format exposed bugs that single-line paste tests never hit.
