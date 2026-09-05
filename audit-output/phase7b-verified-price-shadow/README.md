# Phase 7B verified Price Research shadow

Status: `NOT_READY` until the canonical-QNSA workflow completes and its sanitized output is reviewed.

This directory is the destination for the generated `report.md`, `audit.json`, and `artifact.json` from the private Phase 7B shadow run. Those generated files are deliberately not pre-populated with Phase 7A upper bounds or synthetic data.

The implementation:

- preserves all existing normalized prices and immutable raw records;
- classifies legacy Rolex and Patek WTS observations through parser-v5 evidence;
- independently resolves foreign-currency USD-per-source-unit rates from the official ECB historical dataset using the immutable source date and previous-published-day contract (maximum seven-day lookback);
- materializes exact-reference inventory and analytics in a private parallel schema;
- retains the existing 3.0x IQR and minimum-comparable rules;
- computes price-rating impact without changing customer cards;
- uses bounded pages, immutable batch hashes, checkpoints, idempotent replay, and exact-reference materialization;
- does not switch any customer endpoint or modify UI/UX.

Run `.github/workflows/qnsa-phase7b-verified-price-shadow.yml` only after review, with the exact confirmation and a stable `phase7b-*` run key. Reuse that run key after an interruption.

The GitHub `Production` environment currently has no reviewer protection rules, so the explicit confirmation and stable run key are the operative dispatch gates. No automatic trigger is configured.
