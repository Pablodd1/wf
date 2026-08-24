# WATCHFACTS Phase 7B — implementation gate report

Decision: **NOT_READY**

The private verified-price shadow architecture is implemented for review, but it has not been installed or executed on canonical QNSA. Therefore, Rolex/Patek verified counts, exact-reference census results, rating impact, extremes, hashes, checkpoints, performance, and controlled-switch references remain **UNKNOWN**. Phase 7A stored-evidence values remain upper bounds and are not promoted into Phase 7B results.

## Implemented architecture

- Private `price_research_shadow` schema with service-role-only access and no customer RLS policies.
- Immutable-evidence observation ledger containing the required lineage, parser, source price/currency, FX, qualification, and exclusion fields.
- All required legacy evidence classifications, including explicit broken-lineage exclusions.
- Customer-safe Rolex/Patek catalog foundation and one explicit Trading Floor publication contract.
- Per-reference Total Listings, WTS, WTB, priced, image-linked, legacy PR, verified PR, review, and excluded counts.
- Current versus verified-only analytics under the unchanged 3.0x IQR and minimum-two-comparables rules.
- Reference-relative extreme-value evidence and Trading Floor price-rating shadow impact.
- Bounded 250-row pages, maximum-500 ingest contract, batch hashes, checkpoints, idempotent replay, stable run keys, exact-reference materialization, and bounded query benchmarks.
- Sanitized report/artifact generation with no raw-message payload retention.

## Production gate

The workflow is manual, canonical-QNSA-pinned, production-environment protected, migration-hash pinned, and atomically verifies private access plus unchanged customer surfaces and source-row counts. It must be reviewed on the focused PR before it can exist on the default branch and be manually dispatched.

## Original product requirements

| Original requirement | Status |
| --- | --- |
| Currency/price recognition | Implemented in shadow; production verification pending |
| Price Research accuracy | NOT READY — production shadow results unknown |
| Multi-location selection | Unchanged; outside Phase 7B scope |
| Complete location facet | Unchanged; outside Phase 7B scope |
| Total listings per reference | Implemented in shadow; production counts unknown |
| WTS/WTB counts per reference | Implemented in shadow; production counts unknown |
| Raw message preserved/collapsed | Preserved; UI unchanged |
| Quick-scroll navigation | Unchanged; outside Phase 7B scope |
| Price rating accuracy | Implemented in shadow; production impact unknown |
| Brand/model/reference correction workflow | Exact-reference foundation implemented; production validation pending |

## Next step

Review the focused PR. After approval, manually dispatch the private workflow with a stable `phase7b-*` run key, review the generated aggregate-only report, and only then reassess `CANARY_READY`. No endpoint switch is part of this phase.

**NO EXISTING NORMALIZED PRICE WAS MODIFIED.**

**NO RAW DATA WAS MODIFIED.**

**NO CUSTOMER-FACING DATA SOURCE WAS SWITCHED.**

**NO UI/UX WAS MODIFIED.**

**NO EVIDENCE STANDARD WAS RELAXED.**
