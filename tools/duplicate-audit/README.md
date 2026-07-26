# Duplicate Audit

This tool is read-only. It scans `watch_records`, produces local reports, and never updates or deletes Supabase rows.

## Prerequisite

Run `tools/duplicate-audit/create-indexes.sql` manually in the production SQL editor outside peak traffic. Do not wrap it in a transaction. The `(brand, id)` index is required for reliable keyset pagination on the production archive.

## Patek Pilot

```powershell
$env:DUPLICATE_AUDIT_BRAND = "Patek Philippe"
$env:DUPLICATE_AUDIT_MAX_ROWS = "1000"
$env:DUPLICATE_AUDIT_PAGE_SIZE = "250"
railway run npm run audit:duplicates
```

## Full Brand

```powershell
$env:DUPLICATE_AUDIT_BRAND = "Patek Philippe"
Remove-Item Env:DUPLICATE_AUDIT_MAX_ROWS -ErrorAction SilentlyContinue
$env:DUPLICATE_AUDIT_PAGE_SIZE = "500"
railway run npm run audit:duplicates
```

Reports are written under `audit-output/duplicates/<brand>/` and are intentionally ignored by Git because they contain production record IDs. The Markdown summary redacts dealer identity with a one-way hash.

The scanner checkpoints its in-memory signature index to a local binary state
file every 25 pages by default, so an interrupted full-brand scan resumes
without rebuilding previous pages. Set `DUPLICATE_AUDIT_CHECKPOINT_PAGES` to
change that interval. Set `DUPLICATE_AUDIT_RESET=true` only when intentionally
starting a fresh report.

Audit format v2 selects the canonical observation from a valid immutable
`listing_date`; `created_at` is used only when the source date is unavailable
and is labeled `CREATED_AT_FALLBACK` in the CSV. Because older checkpoint state
does not contain `listing_date`, it must be restarted once with
`DUPLICATE_AUDIT_RESET=true` rather than mixed into a v2 report.

## Interpretation

- `suppress_from_analytics=true` is a proposal, not an applied production decision.
- Bundle rows are segmented into line-level candidates before comparison.
- Matches involving a split candidate are always review-only until lineage is approved.
- Price updates remain in historical Price Research.
- Matching inventory from different dealers is never auto-collapsed.
