# Curated Luxury / WatchFacts External AI Assistance Handoff

**Date:** July 22, 2026

**Repository:** `Pablodd1/wf`

**Working branch:** `codex/zero-hallucination-normalization`

**Core implementation checkpoint:** `1fd413a` (handoff and intake-validator commits follow on the same branch)
**Purpose:** safely divide evidence-review work across another capable AI environment without allowing it to guess market data or mutate production.

## Authority and safety boundary

The external assistant is an evidence analyst, not a production operator.

- Do not write to Supabase, Railway, Vercel, DigitalOcean Spaces, or production APIs.
- Do not merge pull requests or change deployment settings.
- Do not request or store credentials.
- Do not modify `watch_records` or any source/raw-message table.
- Do not invent price, currency, date, condition, intent, seller, dial, reference, or image relationships.
- Preserve every raw message and source identifier exactly.
- Treat missing or ambiguous values as database/JSON `null`, never as an inferred value.
- A bare `$` is not automatically USD.
- Catalog evidence can validate identity/configuration; it cannot create a listing price, currency, date, condition, intent, or seller.
- Image filename similarity is not enough. A proposed image match needs exact source/listing lineage and a reachable URL.
- AI recommendations are advisory until reviewed by the primary CTO workflow.

The assistant may create report files, candidate CSVs, test fixtures, and documentation on a review branch. It must not change product behavior unless explicitly assigned a separate implementation task after the report is reviewed.

## Current verified state

- Price Research code uses shared, fail-closed currency and eligibility gates for every queried reference.
- The July 22 bounded audit scanned 100,000 priced records:
  - 36,514 had verified exact-line currency evidence.
  - 40,313 were `CURRENCY_UNVERIFIED`.
  - 22,937 were `CURRENCY_AMBIGUOUS`.
  - 236 were `CURRENCY_RATE_UNVERIFIED`.
  - 18,220 stored-vs-source price mismatches were detected.
  - 4,787 rows met the deterministic canary policy before final human review.
- The first 100 price proposals were staged in `price_remediation_review`; `watch_records` was not mutated by staging.
- Commit `1fd413a` adds a reviewer-only Price corrections lane, raw evidence display, and audited Apply/Reject paths. Its rejection RPC migration must be deployed before that action is available live.
- Exact source-lineage image runs attached 133 Patek Philippe and 624 Rolex listing images: 757 total. No generated image or brand/model-only guess was used.
- The featured-listing endpoint returns only catalog-consistent, image-backed records with verified exact-line currency evidence.
- Direct Price Research handler canaries were run for `5712/1A`, `5712/1R`, `3712/1A`, `116500LN`, and `52506`.
- Verification on the branch:
  - production build passed;
  - 147 normalization tests passed;
  - 12 duplicate-workflow tests passed;
  - 2 price-review contract tests passed;
  - changed `ReviewQueue.tsx` lint passed;
  - full repository lint still reports 155 pre-existing problems in legacy/unrelated UI files.
- Local `outputs/` and `tmp_debug_currency.js` are intentionally untracked and must not be committed by another assistant.

These are bounded findings, not proof that all historical records are correct. Any newer live count must be independently measured and timestamped.

## Highest-value external work packages

### A. Price evidence audit

Input: exported rows containing source ID, raw message, reference, stored price, stored currency, proposed normalized price, and audit flags.

Return one CSV with:

```text
source_record_id,reference,raw_evidence_line,stored_price_usd,proposed_price_usd,source_currency_status,recommendation,reason,confidence,needs_human_review
```

Allowed recommendations: `APPLY_CANDIDATE`, `REJECT_CANDIDATE`, `DEFER_AMBIGUOUS`.

An `APPLY_CANDIDATE` requires explicit USD/USDT or HKD/HDK/HK$ evidence attached to the exact reference line/block. Do not approve bundle parents, repeated-reference blocks, bare-dollar prices, unsupported FX, or inferred multipliers.

### B. Patek/Rolex catalog and dial review

Priority references:

```text
Patek Philippe: 5712/1A, 5712/1R, 3712/1A
Rolex: 116500LN, 52506
```

Return:

```text
source_record_id,brand,reference,raw_dial_text,current_dial,proposed_catalog_dial,catalog_evidence,recommendation,reason,confidence
```

Allowed recommendations: `KEEP`, `PROPOSE_CORRECTION`, `DEFER`.

Special rule: preserve `Panda` as raw/dealer terminology. It may map to catalog `White` only where exact reference and raw evidence support that interpretation. Never silently rewrite the raw message.

### C. Bundle/unbundled review

For each parent raw message, identify child lines without creating fields absent from the line or inherited section context.

Return three linked files:

```text
parents.csv: parent_source_id,raw_message,seller_id,seller_name,seller_phone,original_posted_at,source
children.csv: child_id,parent_source_id,raw_child_line,brand,reference,dial,condition,price_raw,currency,intent,review_status
mapping.csv: parent_source_id,child_id,line_number,lineage_confidence,review_reason
```

Keep WTS and WTB separate. Do not suppress a parent as a duplicate until all accepted children are lineage-linked and reviewed.

### D. Image-lineage candidates

Return:

```text
source_record_id,source_message_id,image_key,public_url,match_basis,url_reachable,recommendation,reason
```

Allowed recommendations: `SAFE_CANDIDATE`, `REJECT`, `DEFER`.

`SAFE_CANDIDATE` requires exact listing/source lineage and a reachable object. Brand, reference, model, filename proximity, or visual resemblance alone is insufficient.

### E. Deployed UX and Price Research QA

Test the deployed application on desktop and mobile for the five priority references. Record exact URL, reference, dial, condition, observation count, included rows, excluded/outlier rows, metrics, chart title, and screenshot filename.

Return:

```text
test_id,url,viewport,reference,dial,condition,expected,actual,status,evidence_file,severity
```

Verify dial and condition jointly update average, median, minimum, maximum, observation count, comparable evidence, liquidity, graph title, line, range, tooltip, note, and forecast state. Mark anything not reproducible as `UNVERIFIED`.

## Copy-ready master prompt

```text
Act as a senior data-quality auditor for Curated Luxury / WatchFacts. Your role is evidence review, not production operation.

Repository: Pablodd1/wf
Read AGENTS.md and docs/EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md completely before doing any work. Treat the repository, current tests, and the July 22 handoff as authoritative. Older handoff counts are historical unless independently reverified.

Mission:
Help the primary CTO produce trustworthy Price Research and Trading Floor data by reviewing raw-message evidence, price/currency normalization, catalog identity, bundle lineage, seller lineage, and exact image relationships. Zero hallucination is mandatory.

Rules:
1. Do not access or write production systems.
2. Do not request credentials or include secrets in output.
3. Do not modify raw messages.
4. Do not assume a bare $ means USD.
5. Do not infer currency, price, multiplier, date, condition, intent, seller, reference, dial, or image relationship from geography, market value, phone number, brand, or visual similarity.
6. Catalog/online evidence may validate identity and configuration only. It cannot create listing facts.
7. Missing or ambiguous values must be null and explicitly deferred.
8. Every conclusion must cite source_record_id, exact raw evidence, rule used, and confidence.
9. Separate facts from recommendations. Mark unverified claims UNVERIFIED.
10. Do not change application code during the first pass.

First assignment:
Perform Work Package [INSERT A, B, C, D, OR E] from the July 22 handoff on the files I provide. Validate row counts and required columns before analysis. Produce the specified CSV/report schema exactly. Include totals for reviewed, accepted candidates, rejected candidates, deferred/ambiguous, duplicates, missing lineage, and parsing failures. Include 20 representative accepted examples and 20 representative blocked examples with exact evidence. Do not truncate or silently drop failed rows; place them in a separate errors CSV.

At completion return:
- executive summary;
- input files and hashes/counts;
- methodology and deterministic rules;
- output artifact paths;
- accepted/rejected/deferred/error counts;
- highest-risk patterns;
- recommended next bounded canary;
- explicit statement that no production data was changed.

Stop if the same approach fails twice. Record the failed assumption and ask for a different input or method instead of guessing.
```

## Intake checklist for returned work

Before the primary CTO accepts external output:

1. Confirm input filename, size, row count, columns, and checksum when available.
2. Confirm output rows reconcile to input rows.
3. Inspect accepted and blocked examples against raw evidence.
4. Run deterministic repository tests with new examples as fixtures.
5. Stage only a bounded private canary.
6. Review before/after counts and rollback evidence.
7. Obtain explicit approval before any production expansion.

External AI output is never itself an approval or publication decision.

## Corrected Kimi price handoff intake

The corrected Kimi price handoff was independently validated on July 22. Its
`105,818` price rows passed the repository schema, row-count, duplicate-key,
explicit-currency, positive-price, and bare-dollar gates. Valid Hong Kong dealer
forms with joined currency markers, such as `hkd57k` and `2025YHKD980K`, are
explicit currency evidence; a bare `$` remains ambiguous.

The handoff is accepted for primary review only. Its source IDs originate from
the static `public/parsedWatches.json` export (`wa_*` / `pk_*`) and do not map
to live `watch_records.id` values. A bounded Railway-backed read-only join found
609 explicit-USD candidates and zero live source-ID matches. Do not stage or
apply this file. Future external price work must start from a source-backed
export that carries the immutable live `watch_records.id`, or include a verified
source-ID mapping artifact.

The existing live `price_remediation_review` ledger remains separate from this
Kimi handoff. On July 22 it contained 194 rows: 94 already applied and 100
pending. Its dry-run source recheck found 82 currently eligible and 18 blocked;
that result is not a human approval to apply the 82 rows.

## Validate returned CSV files

The repository includes a streaming, read-only intake validator. It supports
the all-watch, price-only, image-lineage, and errors schemas in this handoff.

```powershell
$env:EXTERNAL_AUDIT_INPUT="C:\path\to\kimi-output.csv"
$env:EXTERNAL_AUDIT_EXPECTED_ROWS="100000"
$env:EXTERNAL_AUDIT_REPORT="audit-output\external-ai\batch-001-validation.json"
npm run validate:external-audit
```

The command exits with code `2` when the file is structurally readable but
contains unsafe recommendations or fails reconciliation. It never connects to
Supabase or changes production data. A clean result means only that the file is
accepted for primary human/CTO review; it is not permission to apply rows.
