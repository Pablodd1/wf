# Scope: E2E Testing Track

## Architecture
- **Framework**: Node.js test runner harness (`tests/e2e/e2e-test-runner.cjs`) exercising WatchFacts web components, API endpoints, data models, and navigation logic.
- **Approach**: Opaque-box, requirement-driven, zero external binary dependency (runs natively with Node test runner or `npm run test:e2e`).
- **Target Surfaces**:
  - Trading Floor & Price Research count reconciliation (Feature 1)
  - WTB Demand Signals in Price Research (Feature 2)
  - Raw messages ('oceandigital' untouched), seller contacts, WhatsApp buttons, dealer stats (Feature 3)
  - Outlier filter 3.0×IQR and min 2 observations threshold (Feature 4)
  - TopNav bar navigation & breadcrumbs (Feature 5)
  - Bundle listings (no image) and AI vision fallback for missing dial colors (Feature 6)
  - Build & deployment integrity check (Feature 7)

## Feature Inventory
| # | Feature | Description | Requirement | Tier 1 (Min 5) | Tier 2 (Min 5) | Tier 3 (Min 1/pair) | Tier 4 (Min 1/scen) | Status |
|---|---------|-------------|-------------|:--------------:|:--------------:|:------------------:|:------------------:|--------|
| 1 | Data Consistency | Reconcile total watch counts & search results across Trading Floor & Price Research | R1 | 5 | 5 | ✓ | ✓ | PLANNED |
| 2 | WTB Demand Integration | Separate WTB listings into "Demand Signals" section in Price Research side-by-side with WTS | R2 | 5 | 5 | ✓ | ✓ | PLANNED |
| 3 | Seller Contact & Raw Messages | Display unredacted raw source messages ('oceandigital' untouched), seller name, phone, WhatsApp link, dealer stats | R3 | 5 | 5 | ✓ | ✓ | PLANNED |
| 4 | Relaxed Outlier Filters | Relax IQR fence from 1.5x to 3.0x; lower chart display threshold from 5 to 2 observations | R4 | 5 | 5 | ✓ | ✓ | PLANNED |
| 5 | Navigation UX | Persistent 1-click TopNav bar (`/trading`, `/price-research`, `/telegram-test`, `/dealer-login`) & breadcrumbs | R5 | 5 | 5 | ✓ | ✓ | PLANNED |
| 6 | Image & Vision Rules | Handle bundle listings (no image attached) and AI vision fallback for missing dial colors with image | R3, R4 | 5 | 5 | ✓ | ✓ | PLANNED |
| 7 | Build & Deployment Integrity | Zero TS build errors (`npm run build`), `git push origin main`, Vercel deployment check | Acceptance | 5 | 5 | ✓ | ✓ | PLANNED |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | E2E Test Suite Creation | Build test runner & Tiers 1-4 test scripts (>=82 test cases total) | None | DONE |
| M2 | Test Infrastructure Artifacts | Generate `TEST_INFRA.md` and `TEST_READY.md` at project root | M1 | DONE |
| M3 | Execution & Verification | Run full E2E test suite and build verification via subagent | M1, M2 | DONE |

## Interface Contracts
- **Test Runner Entry Point**: `node tests/e2e/e2e-test-runner.cjs`
- **npm Script**: `npm run test:e2e` (to be added to `package.json` by test writer worker)
- **Root Artifacts**: `TEST_INFRA.md`, `TEST_READY.md`
