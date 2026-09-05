# Zero-Hallucination Data-Quality Audit — 2026-07-23

Evidence-only external audit of all 117,744 supplied listing rows in
`public/parsedWatches.json` against the repo's own contracts
(AGENTS.md, NORMALIZATION_CONTRACT.md, CURRENCY_RULES.md,
CATALOG_RECONCILIATION.md, ANALYTICS_RULES.md,
EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md).

**No production system, source record, code, or deployment was modified.**
This branch contains only audit documentation and the deterministic audit
tooling used to produce it.

## Contents

- `WATCHFACTS_AUDIT_REPORT.md` — final audit report (19 sections + appendices)
- `engine.py` — deterministic zero-hallucination listing parser (zh-audit-engine v1.3)
- `runner.py` — stored-vs-evidence comparison, recommendations, CSV contract (38 columns)
- `run_audit.py` — batch orchestrator (5 × 25k rows, checkpointed, reconciled)
- `aggregate.py` — eligibility sensitivity + 1.5×IQR outlier pass + aggregates
- `images_audit.py` — image lineage + live URL reachability (5,000 records)
- `xlsx_check.py` — XLSX export drift cross-check

## Regeneration

```bash
git clone --branch codex/zero-hallucination-normalization --depth 1 https://github.com/Pablodd1/wf.git /tmp/wf
cp audit/2026-07-23/{engine,runner,run_audit,aggregate,images_audit,xlsx_check}.py /tmp/
cd /tmp && python3 run_audit.py && python3 aggregate.py && python3 images_audit.py && python3 xlsx_check.py
```

Expected reconciliation: 117,744 input rows = 117,744 output rows + 0 errors.
Expected headline distribution (2026-07-23 run):
DUPLICATE_REVIEW 49,074 · HUMAN_REVIEW 34,740 · REJECT_CANDIDATE 22,157 ·
APPLY_CANDIDATE 8,218 · SPLIT_REQUIRED 1,504 · DEFER_AMBIGUOUS 1,142 · KEEP 909.
Price-Research-eligible (strict): 1 row; deterministic-clean intent-waived: 1,900.

The full generated CSV artifacts (master/images/errors/batch summaries) are
delivered out-of-band with the report; they are regenerable byte-for-byte
from the scripts above.
