# Normalization Contract

Normalization must produce structured evidence, not just a final row.

## Mission-Critical Acceptance Standard

The system optimizes for precision. A field enters Price Research only when it is supported by the raw message and its preserved message/section context. If evidence is missing, ambiguous, or conflicting, the normalized value is JSON/SQL `null` and the record carries an explicit review reason.

`[NULL]` in business instructions means a real null value, never the literal text `"[NULL]"`.

### Source Boundaries

- Raw message: may supply price, currency, date, condition, intent, claimed reference, and claimed configuration.
- Preserved message/section context: may resolve inherited labels such as an explicit `HKD` section heading.
- Catalog or online validation: may confirm brand, model, reference, and configuration compatibility.
- AI: may identify ambiguity and propose candidates for review, but cannot independently supply Price Research price/currency or approve a record.

Never infer price or currency from dealer geography, phone prefix, chat group, price magnitude, market value, reference, model, or catalog. A bare `$` remains unresolved unless explicit inherited currency evidence is linked to that candidate.

## Required Principles

- Preserve claimed values separately from normalized values.
- Keep every source row linked to its raw message.
- Keep price parsing evidence.
- Keep catalog evidence.
- Keep AI output as suggestions, not source of truth.
- Lower confidence when conflicts exist.
- Preserve exact raw price text and distinguish asking, retail, discount, and alternate-currency values.
- Do not silently repair malformed prices or add omitted `K`/`M` multipliers.

## Required Output Fields

```text
raw_message_id
context_block_id
candidate_id
source_line_start
source_line_end
brand_claimed
brand_normalized
reference_claimed
reference_normalized
model_claimed
model_normalized
dial_claimed
dial_normalized
condition_claimed
condition_normalized
set_status_claimed
set_status_normalized
price_raw_text
asking_price_original
currency_original
currency_evidence
currency_confidence
price_usd
fx_rate
fx_rate_date
fx_source
intent
intent_confidence
catalog_match_status
catalog_candidate_ids
text_confidence
image_confidence
final_confidence
approval_state
review_reason_codes
parser_version
normalization_version
```

