# Legacy Lint And Performance Backlog - 2026-07-19

## Current baseline

`npm run lint` reports 154 errors and 2 warnings. The production TypeScript/Vite
build still succeeds. These findings predate the data-canary work and were not
mass-edited in the normalization branch.

### P0 legacy route defect

`api/clean-analyze.js` declares `catalogConfirmed` twice in the same function
(around lines 1203 and 1400). ESLint reports a parsing error, and that legacy
serverless route cannot be considered deployable until the second value is given
a distinct name and its verdict-gate tests pass. The active deterministic
normalization/research tests do not invoke this older route, which is why the
main client build and 104-test normalization suite can still pass.

Common categories include:

- explicit `any` types in legacy dashboards and catalog helpers;
- React hook dependency and static-component findings;
- components declared during render;
- unused values and older UI helper patterns.

## Performance baseline

The production build succeeds, but two optional dependency chunks are large:

- `vendor-charts`: approximately 427 KB before gzip;
- `vendor-xlsx`: approximately 429 KB before gzip.

The current route-level chunks for Trading Floor and Price Research are
approximately 35 KB and 62 KB before gzip respectively. Server-side pagination
already prevents the browser from loading millions of listings.

## Separate remediation plan

1. Create a dedicated `codex/legacy-lint-performance` branch from the approved
   customer baseline.
2. Fix and regression-test the `clean-analyze.js` duplicate declaration first.
3. Fix lint by module, beginning with runtime APIs and customer routes, then
   admin/demo components.
4. Add route-focused smoke tests before changing hooks or component lifecycles.
5. Load XLSX export code only when an operator requests an export.
6. Audit chart imports and keep charting limited to Price Research/admin routes.
7. Compare route chunks and mobile interaction timings before and after.

This work must not be combined with price, dial, bundle, dealer, or image
promotion commits.
