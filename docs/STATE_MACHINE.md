# State Machine

## Target States

```text
INGESTED
SEGMENTED
PARSED
CURRENCY_NORMALIZED
CATALOG_MATCHED
VALIDATED
APPROVED
AI_REVIEW
HUMAN_REVIEW
SECOND_REVIEW
RECYCLE_QUEUE
REPROCESS
QUARANTINED
REJECTED
```

## Rules

- Every transition has timestamp, actor, reason, and previous/next state.
- Low confidence should not disappear; it moves to explicit review.
- Records must not loop forever without counters and escalation.
- Outliers should remain visible and flagged.

## Current Risk

`api/ingest.js` returns states such as `AUTO_APPROVED`, `REVIEW_SUGGESTED`, `MUST_REVIEW`, `MANUAL_INTERVENTION`, and `QUARANTINED`, while older schema uses `APPROVED`, `HUMAN`, and `RECYCLE`. These should be unified.

