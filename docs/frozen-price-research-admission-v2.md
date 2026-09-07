# Frozen Price Research admission

The browse feed now displays unique qualified WTS offers admitted by the same
exact-cohort plausibility and 3.0×IQR policy used for market analysis. Trading
Floor retains eligible singles, including reposts and price outliers. Missing
source dates remain null in display payloads; a separate internal snapshot key
orders them last without manufacturing a date.

Each new Price Research snapshot keeps all candidate payloads privately and
records admission separately. Browse pagination, totals and facets consult that
frozen admission. Statistics retain candidate evidence so their original
quartiles do not change merely because an excluded card disappeared. Expired
traversals can reuse the same immutable payload and admission without copying
the publication. A cursor identifying an excluded member is invalid.

The deterministic offer key uses the existing explicit duplicate group when
provided by reviewed canonical evidence. Otherwise it uses the source poster
identity, normalized brand/reference-or-model/dial/condition, stated year and
exact USD amount. An unknown poster falls back to the listing's source identity;
equal public names cannot merge offers. Decimal scale does not change numeric
identity, while distinct cents and years stay separate. This identifies repeated
offers under the stated policy; it does not establish physical-watch ownership
or a serial-number identity.

Admission calculates a separate plausibility floor and quartiles for each
brand/reference-or-model/dial/condition cohort. A single priced observation can
remain browsable; insufficient evidence never produces a market rating. Missing
dial or condition prevents an IQR admission judgment from an unresolved cohort.
Broad-filter exclusion counts sum these decisions instead of pooling unrelated
references into one price distribution. A broad filter has no single reported
plausibility floor.

The private `publication_research_outcomes_v2` ledger retains each publication's
source hash, payload hash and decision after pagination caches expire. It has no
ordinary service-role table access. Snapshot admission, normalized proposals,
materialized versions and raw evidence remain distinct records. Publication and
rollback still run only through the reviewed owner gate and mutation journals.

## Executed disposable evidence

PostgreSQL 15 and 18 each replay 257 migrations, retaining the six documented
historical bootstrap supplements and four SHA-bound compatibility overlays.
These are qualified replay results, not an untouched-history pass.

Actual Supabase/PostgREST page sizes 1, 7, 12, 49 and 50 exhaust the same 22
admitted IDs from 24 synthetic candidates. One repost and one outlier remain
excluded; the exact Patek fixture cohort preserves five deduplicated candidates,
quartiles USD 95,000/105,000, fences USD 65,000/135,000, and four included offers
averaging USD 97,500. All 50 synthetic singles remain on Trading Floor, with
10 WTB records separate from WTS research. Unknown-date cursor codec tests,
expired traversal reuse, exclusion-ledger survival after rolled-back cache
deletion, source/dealer/privacy APIs and atomic publication/rollback pass.

The 1.5-million-row synthetic retest completed with exact counts. Admission
prewarm took 479.487 seconds after a function-scoped planner correction.
Cached count and first-50 reads took 0.124 and 0.136 seconds; exact 150-offer
statistics took 0.157 seconds. The broad summary still took 390.444 seconds,
so publication now prepares an immutable private summary receipt once. Its
separate full-volume preparation took 270.599 seconds; public cached summary
reads took 0.191 seconds and filtered summaries 1.253 seconds. Missing receipts
fail closed. Summary and decision receipts survive snapshot-cache removal.
The combined full-scale publication transaction with both preparation phases
has not been rerun. Stored bytes include retained prior snapshots and aborted
benchmark tuple bloat, and cannot be quoted as one live publication's footprint.

These tests use synthetic data only. Final exact browser acceptance, remaining
test reconciliation, actual production capacity/discovery and the real
canary/full rollout are still release gates.
