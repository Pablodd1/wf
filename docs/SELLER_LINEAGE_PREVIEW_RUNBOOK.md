# Seller Lineage Preview Runbook

This runbook is read-first. It does not permit a full cohort write until the
private schema and 100-parent canary are verified.

## Verify without writing

Set temporary Preview credentials in the shell:

```powershell
$env:SUPABASE_URL = "https://<preview-project>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<temporary-preview-service-role-key>"
npm run verify:seller-lineage-schema
```

Both tables must report `reachable: true`:

- `seller_listing_lineage_staging`
- `seller_child_lineage_staging`

If either returns `404` or `PGRST205`, stop and apply only these migrations:

```text
20260720220000_seller_listing_lineage_staging.sql
20260721120000_seller_child_lineage_staging.sql
```

## Dry-run the 100-parent canary

```powershell
$env:SELLER_LINEAGE_MANIFEST = "<repo>\audit-output\dealer-lineage\seller-lineage\canary-100.jsonl"
$env:SELLER_LINEAGE_STAGE_MAX_ROWS = "100"
$env:APPLY_SELLER_LINEAGE_STAGING = "false"
node tools/dealer-lineage/stage-seller-lineage-manifest.cjs
```

Expected result: `write=false`, `persisted=0`, and `publicRowsMutated=0`.

## Preview-only write

Only after the schema check and dry-run pass, set
`APPLY_SELLER_LINEAGE_STAGING=true` and keep the maximum at 100. Review each
canary row against the raw message, seller identity, original date, intent,
and image filename before increasing the limit.

Seller staging does not verify a dealer, publish contact information, attach
an image to a child, suppress duplicates, or approve a market record. Those
remain separate gates.
