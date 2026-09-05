# WatchFacts E2E Test Infrastructure Documentation

## Overview
This document specifies the architecture, philosophy, feature coverage matrix, directory layout, execution procedures, and real-world scenario definitions for the WatchFacts End-to-End (E2E) Test Suite.

## Test Philosophy
- **Opaque-Box Testing**: All test cases evaluate observable behavior, data contracts, API payloads, mathematical formulas, and interface guarantees without relying on private implementation details.
- **Requirement-Driven**: Tests map directly to requirements R1 through R5 and Acceptance Criteria defined in `ORIGINAL_REQUEST.md` and `orchestrator/plan.md`.
- **Progressive & Self-Contained**: Each test case sets up its own isolated data, executes synchronously or asynchronously, performs explicit assertions, and cleans up without side effects.
- **Authoritative Verification**: Expected outputs are derived strictly from documented requirements, domain rules (e.g. 3.0x IQR fence formula, 2-observation display threshold, count reconciliation formula), and standard interface contracts.

---

## Runner & Execution Commands

### Primary Test Runner
- Command: `npm run test:e2e`
- Direct Command: `node tests/e2e/e2e-test-runner.cjs`

### Runner Features
- Discovers and executes all `.test.cjs` files under `tests/e2e/`.
- Measures execution duration per test case and overall suite execution time.
- Displays per-tier pass/fail breakdowns and comprehensive summary output.
- Exits with status code `0` when all test cases pass and `1` if any test fails.

---

## Directory Layout

```
tests/e2e/
├── test-harness.cjs              # Shared test registry, assertion wrapper, and tier manager
├── e2e-test-runner.cjs           # Test runner script discovering and running all e2e tests
├── tier1-feature-coverage.test.cjs  # Happy-path isolation tests for Features 1-7 (35 tests)
├── tier2-boundary-corner.test.cjs   # Boundary, edge case, and extreme input tests (35 tests)
├── tier3-cross-feature.test.cjs     # Multi-feature interaction & pairwise tests (7 tests)
└── tier4-real-world.test.cjs        # Full user application workflow scenarios (5 tests)
```

---

## Feature Inventory Checklist & Coverage Table

| # | Feature | Description | Tier 1 (Happy Path) | Tier 2 (Boundary/Edge) | Tier 3 (Cross-Feature) | Tier 4 (Real World) | Total Tests |
|---|---------|-------------|---------------------|------------------------|------------------------|---------------------|-------------|
| F1 | Data Consistency | Reconcile total watch counts (`Total = Qualified WTS + WTB Demand + Excluded`) across Trading Floor and Price Research | 5 | 5 | 2 | 1 | **13** |
| F2 | WTB Demand Integration | Separate WTB listings into "Demand Signals" section; isolate WTS ask price averages | 5 | 5 | 2 | 1 | **13** |
| F3 | Seller Contacts & Raw Messages | Display unredacted raw source messages ('oceandigital' untouched), seller name, phone, WhatsApp link, dealer stats | 5 | 5 | 2 | 1 | **13** |
| F4 | Relaxed Outlier Filters | IQR fence expanded to 3.0x; chart display threshold lowered to min 2 observations | 5 | 5 | 3 | 1 | **14** |
| F5 | Navigation UX | TopNav bar visibility (`/trading`, `/price-research`, `/telegram-test`, `/dealer-login`), breadcrumbs, back navigation | 5 | 5 | 2 | 1 | **13** |
| F6 | Image & Vision Rules | Bundle listings image handling (omit image), AI vision fallback for missing dial colors | 5 | 5 | 2 | 0 | **12** |
| F7 | Build & Deployment Integrity | `npm run build` verification, TS config, package scripts, env fallback checks | 5 | 5 | 1 | 0 | **11** |
| **Total** | **All Features (F1-F7)** | **Full Coverage E2E Suite** | **35** | **35** | **7** | **5** | **82** |

---

## Real-World Application Scenarios (Tier 4 Details)

| Scenario # | Title | User Role | Description & Workflow Steps |
|------------|-------|-----------|------------------------------|
| 1 | Rolex Daytona Search | Buyer | Searches for `116500LN` on Trading Floor -> verifies total N listings -> navigates to Price Research for `116500LN` -> confirms count reconciliation formula -> filters by White Dial. |
| 2 | Patek Philippe Nautilus Liquidity | Dealer | Reviews Patek Philippe Nautilus `5711/1A-010` -> views side-by-side WTS asking price distribution ($105k-$115k, avg $110k) and WTB demand signals (5 buyers, avg target $98.75k) -> verifies WTB signals do not pull down WTS ask stats. |
| 3 | Listing Inspection & Contact Reveal | Buyer / Collector | Clicks on watch listing card -> views untouched 'oceandigital' raw source message -> views seller contact name, phone, and formatted WhatsApp URL -> checks dealer activity stats (14 WTS, 4 WTB). |
| 4 | Low-Volume Reference Trend Graphics | Analyst | Queries rare reference `15407ST.OO.1220ST.01` with only 2 comparable observations -> under 3.0x IQR fence and lowered threshold of 2, system marks `analytics_ready = true` and renders price trend stats cleanly. |
| 5 | Full Site Navigation Flow | Visitor / Dealer | Starts on `/trading` -> TopNav to `/price-research` -> searches `116500LN` -> opens contact modal -> breadcrumb back to `/price-research` -> TopNav to `/telegram-test` -> TopNav to `/dealer-login` -> Back button returns to `/telegram-test`. |
