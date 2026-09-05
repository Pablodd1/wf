# Implementation Plan

## Phase 1: Audit And Documentation

Complete:

- Create `AGENTS.md`.
- Create master spec and audit docs.
- Run `npm ci`, `npm run lint`, and `npm run build`.
- Identify confirmed risks.

## Phase 2: Safe Foundations

Recommended PR sequence:

1. Security cleanup and secret scanning.
2. Regression fixtures for HKD, multi-watch, WTB, malformed price, and dual-currency examples.
3. Canonical normalization contract types.
4. Currency/context parser correction.
5. Message segmentation/context blocks.
6. Catalog reconciliation service.
7. Unified state machine.
8. Server-side Trading Floor pagination/search/counts.
9. Admin live statistics.
10. Price Research cohort/outlier correction.
11. Migration control plane inventory scripts.
12. Raw-message import.
13. Media manifest and verification.
14. Historical normalization workers.
15. Green API shadow mode.

## 30/60/90 Day Roadmap

### 30 Days

- Rotate secrets.
- Stop committing env files.
- Add regression fixtures.
- Correct currency/context behavior.
- Add migration inventory scripts.
- Add live Admin count endpoints.

### 60 Days

- Implement raw-message migration and verification.
- Add media manifest.
- Replace static Admin data.
- Replace Trading Floor client-only filtering with server-side pagination.
- Unify parser contracts.

### 90 Days

- Normalize historical archive.
- Build robust Price Research cohorts.
- Add Green API shadow mode.
- Add production observability and review-queue SLAs.

