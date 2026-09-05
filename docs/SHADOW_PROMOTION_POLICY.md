# Shadow Promotion Policy

## Purpose

`normalization_shadow_v4` is an evidence and review table. It is not a live
listing source and it must not be copied into `watch_records` by a generic bulk
update.

## Hard blocks

The following flags always require human review and cannot be promoted:

- `BUNDLE_SPLIT_REQUIRED`
- `NO_CANDIDATE`
- `CURRENCY_AMBIGUOUS`
- `PRICE_PARSE_FAILED`

This protects the exact failure modes seen in dealer data: multi-watch posts,
catalog aliases, bare `$` values, price-only lines, and incomplete listings.

## Catalog-confirmation gate

A single-candidate proposal may advance only to `CATALOG_CONFIRMATION_REQUIRED`
when all of these are true:

1. Candidate has both brand and reference.
2. WTS posts have an asking price, original currency, and explicit or inherited
   currency evidence (`explicit_line_currency`, `section_context`, or
   `message_context`).
3. WTB posts may omit price, but still require candidate identity.
4. No hard-block flag is present.

The catalog match must validate reference-to-brand and configuration before any
live mutation. Catalog confirmation is a separate recorded operation, not an
LLM guess.

## Live promotion

There is intentionally no live-promotion endpoint yet. Before adding one,
require all of:

- A reviewed catalog match record.
- An audit record containing source id, prior values, new values, policy
  version, catalog match id, operator, and timestamp.
- One transaction per source record.
- A rollback path using the stored prior values.
- A staged cohort with analytics comparison before broad rollout.

The policy implementation lives in
`tools/shadow-reprocess/promotion-policy.cjs` and is unit tested. It returns a
disposition only; it never writes to `watch_records`.

## Catalog confirmation implementation

`tools/shadow-reprocess/catalog-confirmation.cjs` uses the shared deployed
catalog. Exact and punctuation-collapsed references with agreeing brands can
move to `READY_FOR_HUMAN_APPROVAL`. Partial catalog matches, missing catalog
entries, and brand conflicts remain human-review items.

`GET /api/shadow-review-queue` returns a bounded, read-only queue of shadow
proposals with their catalog-confirmation decision. It never returns raw dealer
messages and has no mutation operation.

## Audited reviewer decisions

Apply `supabase/migrations/20260713020000_shadow_review_decisions.sql` in the
production Supabase SQL Editor before enabling decisions. It adds an immutable
`normalization_review_decisions` audit table and an atomic
`apply_shadow_review_decision` RPC. Neither changes `watch_records`.

`POST /api/shadow-review-decision` requires a temporary server-only
`REVIEW_OPERATOR_TOKEN` in Vercel and the `x-review-operator-token` request
header. The browser must never receive that token. Required request body:

```json
{
  "sourceRecordId": "shadow-source-uuid",
  "decision": "APPROVED",
  "operatorId": "reviewer@example.com",
  "reason": "Catalog and source context verified"
}
```

The endpoint re-loads the shadow proposal, re-computes catalog confirmation,
and permits `APPROVED` only for `READY_FOR_HUMAN_APPROVAL`. Reject decisions
remain available for every pending proposal. This is review evidence, not live
promotion.
