# Rolex/Patek raw-first audit

Status: `NOT_READY_RAW_SOURCE_GAPS` until the canonical QNSA SELECT-only scan
completes and every selected immutable source post reconciles to an explicit
disposition.

This lane starts from `public.raw_message_versions` and deliberately does not
require catalog membership to retain a legitimate source observation. It reads
the existing completed Phase 7B result only for comparison and never begins,
resumes, or mutates a Phase 7B run.

Generated outputs are intentionally absent before the canonical run:

- `summary.json`
- `rolex-manifest.jsonl.gz`
- `patek-philippe-manifest.jsonl.gz`
- `remaining-queues.jsonl.gz`
- `manifest-sha256.json`

Safety contract:

- Management API queries are syntactically restricted to one `WITH`/`SELECT`
  statement and submitted with `read_only: true`.
- No database object, row, endpoint, catalog, UI, or release control is changed.
- Raw text and lineage fields are copied into private audit artifacts unchanged.
- Ambiguous prices and parent media are never assigned to multiple children.
- The run returns `RAW_FIRST_READY` only when the source-post accounting is
  exact and all source-brand/multi-watch blocking queues are empty.

Local validation, which requires no credentials:

```powershell
node tools/audit/raw-first-rolex-patek-audit.cjs --validate-only
node --test tests/raw-first-rolex-patek-audit.test.cjs
```
