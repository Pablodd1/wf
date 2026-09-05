# Unbundled Batch 001 And Human Review Gate

Date: 2026-07-20

## Executive decision

Batch 001 passes the child-to-parent lineage gate, but it does not pass the
normalization/publication gate. Do not import it directly into `watch_records`.
The next safe action is a corrected 1,000-row staging canary that preserves
parent context, re-resolves explicit dial evidence, and requires exact catalog
confirmation before a reviewer can approve publication.

No production market data was changed during this audit.

## Files audited

- `unbundle_1_listings_batch_001.csv`
- `unbundle_1_raw_messages_batch_001.csv`
- `unbundle_1_mapping_batch_001.csv`

The streaming audits are available through:

```text
npm run audit:unbundled-csv
npm run audit:unbundled-lineage
npm run stage:unbundled-canary
```

## Full-file intake results

| Check | Result |
| --- | ---: |
| Child listing rows | 574,642 |
| Unique listing IDs | 574,642 |
| Unique source + candidate keys | 574,642 |
| Raw child lines retained | 574,642 (100%) |
| Source timestamps present | 573,834 (99.86%) |
| Missing source timestamps | 808 |
| Seller names present | 0 |
| Seller phones present | 0 |
| Dealer identities present | 0 |
| Image URLs present | 0 |
| Rows missing brand | 15 |

`candidate_index` is accepted by the audit as a legacy alias. The staging
contract should expose it as `child_index` without renumbering any child.

## Exact lineage reconciliation

| Check | Result |
| --- | ---: |
| Parent raw-message rows | 50,000 |
| Mapping rows | 574,642 |
| Parent joins | 574,642 (100%) |
| Exact raw-line containment | 574,642 (100%) |
| Mapping joins | 574,642 (100%) |
| Comparable source-date agreement | 100% |

The lineage gate passed. That proves which parent and source line each child
belongs to; it does not prove that the normalized fields are correct.

## Normalization blockers

The deterministic parser/catalog canary inspected the first 1,000 child rows:

| Finding | Count |
| --- | ---: |
| Explicit raw dial conflicts with exported dial | 186 |
| Catalog identity not exactly confirmed | 679 |
| Catalog-confirmed identities | 321 |
| Proposed dial not catalog-confirmed | 107 |
| Exported intent conflicts with isolated-line parse | 58 |

Representative failure:

```text
Raw line: 15202bc salmon 2019 used full set 855k hkd
Exported dial: Black
Explicit raw dial: Salmon
```

The full parent reconciliation found a broader inherited-intent defect:

| Child intent | Count |
| --- | ---: |
| WTS | 537,094 |
| WTB | 37,340 |
| WITHDRAWN | 208 |

There are 23,598 children marked WTS/WITHDRAWN beneath a usable WTB parent
whose child line does not restate the parent header. Parent intent must be
carried into child normalization unless the child line contains explicit
contradictory intent. Ninety-seven children have a parent intent labeled
`GARBAGE` and remain manual-review only.

## Human Review changes

- `/review-queue` is restricted to authenticated `reviewer` and `admin` roles.
- The queue API now enforces the same roles before returning raw evidence.
- The Admin shortcut opens the HashRouter-compatible `/#/review-queue` URL.
- Every expanded review item displays exact catalog reference, brand, model,
  match type, catalog source, and allowed dial values.
- The Approve action remains available only for server-computed
  `READY_FOR_HUMAN_APPROVAL` rows.
- AI assistance is authenticated, quota-bounded, and uses Gemini only as an
  advisory interpretation of raw text. It cannot confirm the catalog, enable
  approval, write market fields, or publish a listing.
- The review UI no longer presents invented client-side confidence percentages
  as if they were approval evidence.

## Next safe canary

The local-only 1,000-row canary builder is now available through
`npm run stage:unbundled-canary`. It writes `rows.jsonl`, `review-ready.jsonl`,
`held.jsonl`, and `report.json` under
`audit-output/unbundled/batch-001-canary`; it has no database client and cannot
write to production.

The first corrected canary produced:

| Review disposition | Rows |
| --- | ---: |
| Ready for Human Review | 180 |
| Requires Human Correction | 7 |
| Blocked by Catalog | 758 |
| Blocked by Lineage/Context | 55 |

The principal blockers were 531 partial catalog matches, 148 catalog misses,
107 catalog dial conflicts, and 55 unusable parent intents. Eighteen child
intents were corrected from parent context. All rows remain unapproved.

1. Build a corrected 1,000-row staging cohort from batch 001 and its parent
   file; preserve the stable listing ID and raw child line.
2. Inherit WTB/WTS context from the parent, allowing a child override only when
   the child line explicitly supports it.
3. Prefer explicit raw dial evidence over the exported dial and route every
   conflict to Human Review.
4. Keep catalog misses and catalog dial conflicts blocked. Catalog matching is
   required for approval, not assumed.
5. Join seller, phone, dealer, original date, and `front_image` only from the
   legacy source export. Do not infer these fields from free text.
6. Stage the 1,000 rows outside `watch_records`, review the blocked/ready split,
   then publish only individually approved rows through the audited RPC.
7. Reconcile Trading Floor and Price Research counts before expanding beyond
   the canary. WTB children must never enter WTS asking-price analytics.

## Verification

- Changed-file ESLint: pass.
- Production build: pass.
- Normalization suite: 104/104 pass.
- Human-review/security suite: 10/10 pass.
- CSV audit tests: pass.
- Repository-wide lint still has 153 pre-existing errors in unrelated legacy
  components; this remains a separate debt stream.
