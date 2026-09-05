# Emoji price audit - 2026-07-21

## Production result

- Exact materialized `EMOJI_PRICE_AMBIGUOUS` rows: **0**
- Postgres planned estimate for the same filter: **175**
- Rows returned by the exact read-only audit: **0**
- Raw rows checked by the bounded current-parser canary: **25,000**
- Current-parser pictographic price flags in that canary: **0**
- Prices changed: **0**
- Meanings inferred: **0**

The planned value is a query-planner estimate, not evidence that 175 records
exist. The exact count and filtered page both returned zero.

## Interpretation

Normalization v4 already decodes standard Unicode keycap digits and full-width
digits deterministically. It preserves the exact raw price token. A private
pictographic dealer code is never assigned a numeric meaning automatically.

The completed production shadow pass does not currently contain materialized
rows with the newer `EMOJI_PRICE_AMBIGUOUS` flag. The next safe step is a
checkpointed continuation of the bounded read-only current-parser scan. The
first 25,000-row canary found no private pictographic price codes. This is not a
claim that the remaining archive is clean. It is not safe to build a price
codebook from screenshots or to let an AI guess what a symbol means.

## Audit command

`npm run audit:emoji-prices`

For a bounded read-only pass through raw records using the current parser:

```powershell
$env:EMOJI_AUDIT_SCAN_CURRENT="true"
$env:EMOJI_AUDIT_MAX_ROWS="25000"
npm run audit:emoji-prices
```

`EMOJI_AUDIT_START_ID` may be set to resume after a known source ID. The
reported checkpoint is pseudonymized, so a private operational checkpoint must
be retained separately when a later pass needs to resume.

The command:

1. reads only rows already flagged in `normalization_shadow_v4`, or scans a
   bounded `watch_records` window when `EMOJI_AUDIT_SCAN_CURRENT=true`;
2. reports exact and planned counts separately;
3. inventories pictographs by Unicode code point;
4. masks phone, email, and URL patterns in local private samples;
5. pseudonymizes source record identities;
6. writes only masked, pseudonymous local samples under ignored audit output;
7. never changes prices, currencies, listings, or review decisions.

Local samples are written under ignored `audit-output/` and must not be
committed. Raw copied message examples from Alex remain the required evidence
for any dealer-specific symbol mapping.
