# Model names in cards and filters

Existing model projection fills missing models but keeps every nonempty legacy
model value. This exposes conflicting and foreign-brand names in the Trading
Floor and Price Research menus. For example, a Rolex 126610LN carrying a legacy
Serpenti model claim keeps that claim despite its exact catalog match.

V2 first uses the existing unique, source-backed manufacturer/reference catalog
map. Without an exact reference match, it retains a model name only when that
name exists under the same manufacturer in that map. Otherwise the display
model is null and the listing remains available through its brand, reference,
raw text and the Reference-only listings option.

The response preserves the original frozen model in source_model and records
model_source and model_review_reason. Model-name support without an exact
reference match is explicitly distinguished from exact-reference evidence.
Raw messages, prices, currencies, image URLs, candidate/member payloads and
listing identity are unchanged. No partial reference expansion is added.

The complete current published-cache audit found 1,441 Trading Floor cards
whose existing model differs from the exact catalog family, 1,495 label
variants, 88 foreign-brand-only model claims and 4,731 other unvalidated model
claims without an exact reference match. Price Research contains 104 exact
model conflicts and one foreign model claim. These surfaces overlap; these
are current card counts, not a count of all unresolved raw messages.

## Release order

Migration 370 creates a separate immutable V2 helper. Migration 380 builds its
index concurrently, outside a transaction. Migration 390 atomically switches
the thirteen existing filter/browse functions while preserving their grants
and configuration. Keep the V1 function and index intact through preparation
so an existing expression index is never used with changed helper semantics.
The API response projection and SQL switch must be verified in the coordinated
final release. These migrations have not been applied to production.

Do not edit a parser or replace any bound original catalog source. Future
changes to the immutable V2 mapping require rebuilding its expression index.

## Validation

- Six JS tests cover conflicts, missing models, exact matches, unvalidated names,
  unchanged raw/price/image values, and rejection of partial reference repairs.
- PostgreSQL 17.6: 19,492 JS/SQL comparisons covering all catalog pairs and
  current grouped discrepancies; 22 model menu/count comparisons on the
  existing 500k physical fixture; concurrent index creation; exact function,
  privilege and cache rollback; total membership and zero raw rows unchanged.
- Application build passed.

Local gate receipt SHA256:
aa806282f0f9632d74cd4ffd19af99f61337cccad9d58ecdca98cbeac0689e0c.
Current published-cache audit SHA256:
d5a8e22ebfd90d88b7cc515ae65b997524925604e02464f78d245f4b3e332ea1.

Earlier local gate attempts exposed two fixture assumptions: its cached seed
counts predated appended physical copies, and research member count included
an excluded row per seed. The final gate rebuilds only its local cache inside
the rollback transaction and compares qualified totals with their pre-change
values. No source or production change was made by those attempts.
