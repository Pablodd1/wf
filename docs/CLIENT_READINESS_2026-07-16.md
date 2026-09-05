# Client Readiness Pass - 2026-07-16

## Scope

This pass addresses customer-facing trust and performance without changing production data or the historical normalization pipeline.

## Corrections

- Trading Floor excludes `RECYCLE` records in every customer mode.
- The default view shows recent dated inventory so undated legacy imports do not dominate page one.
- `Include undated` and explicit search still expose all non-recycle inventory.
- Database verdicts no longer imply market readiness when required fields are incomplete.
- Numeric dial values are hidden from customer presentation and remain available for review/remediation.
- Availability actions are offered only for approved records with required market fields.
- Availability requests open the Curated Luxury front desk with listing identity prefilled.
- Random analytics is redirected to source-backed Analytics.
- The obsolete Review route redirects to the controlled Review Queue.
- Dead Study navigation redirects to the supported manual-cleaning surface.
- Navigation no longer advertises stale record counts or duplicate legacy tools.
- Navbar throughput and latency render only when source-backed values are supplied.
- Price Research retains full aggregate calculations while limiting response evidence to 250 comparable and 100 excluded rows.
- The mobile front-desk control is reduced to a safe-area-aware icon so it does not cover landing-page actions.

## Verification

- Focused ESLint check for all changed TypeScript/React files.
- 62 normalization, catalog, promotion, and review-policy tests pass.
- 3 Trading Floor visibility regression tests pass.
- Production TypeScript/Vite build passes.
- Desktop and 390x844 browser smoke tests pass without horizontal overflow.

## Known Existing Debt

Repository-wide ESLint currently reports legacy errors in older demo and UI modules. Those failures predate this pass and are outside the client-readiness branch. Changed files pass focused lint.

## After The Client Meeting

1. Remediate shifted `WATCHES_FINAL_V2` fields in resumable source-specific batches.
2. Consolidate Dashboard, Admin, Analytics, and Review ownership.
3. Add a dedicated paginated Price Research evidence endpoint.
4. Build the matching `created_at DESC NULLS LAST` production index before changing global ordering.
5. Continue catalog/dial remediation and controlled promotion.
6. Resume Mission Images from its isolated branch after data contracts are approved.
