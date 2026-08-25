$ErrorActionPreference = 'Stop'

foreach ($name in 'PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'EXPECTED_NORMALIZED_LF_MIGRATION_SHA256') {
  if (-not (Get-Item -LiteralPath "Env:$name").Value) { throw "$name is unavailable." }
}

$headers = @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" }
$uri = "https://api.supabase.com/v1/projects/$env:PROJECT_REF/database/query"

function Invoke-ManagementQuery {
  param(
    [Parameter(Mandatory)][string]$Query,
    [Parameter(Mandatory)][bool]$ReadOnly
  )
  $body = @{ query = $Query; read_only = $ReadOnly } | ConvertTo-Json -Depth 4
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body
}

function ConvertTo-SnapshotJson {
  param([Parameter(Mandatory)]$Value)
  ConvertTo-Json -InputObject @($Value) -Compress -Depth 20
}

function Get-CustomerSurfaceSnapshot {
  ConvertTo-SnapshotJson (Invoke-ManagementQuery -ReadOnly $true -Query @'
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind,
  encode(extensions.digest(convert_to(COALESCE(pg_get_viewdef(c.oid, true), ''), 'UTF8'), 'sha256'), 'hex') AS definition_sha256
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('price_research_verified_source', 'price_research_view')
ORDER BY n.nspname, c.relname, c.relkind;
'@)
}

function Get-CustomerFunctionSnapshot {
  ConvertTo-SnapshotJson (Invoke-ManagementQuery -ReadOnly $true -Query @'
SELECT p.oid::regprocedure::text AS function_identity,
  encode(extensions.digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex') AS definition_sha256
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('qnsa_market_feed_page_rows', 'qnsa_bounded_price_research_rows')
ORDER BY p.oid::regprocedure::text;
'@)
}

function Get-PublicationSnapshot {
  ConvertTo-SnapshotJson (Invoke-ManagementQuery -ReadOnly $true -Query @'
SELECT 'qnsa_market_feed_control'::text object_name, count(*)::text row_count,
  encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), ''), 'UTF8'), 'sha256'), 'hex') state_sha256
FROM public.qnsa_market_feed_control t
UNION ALL
SELECT 'qnsa_two_brand_release_control', count(*)::text,
  encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), ''), 'UTF8'), 'sha256'), 'hex')
FROM public.qnsa_two_brand_release_control t
ORDER BY object_name;
'@)
}

function Get-SourceSnapshot {
  param([Parameter(Mandatory)][ValidateSet('staging.listings', 'public.raw_messages', 'public.raw_message_versions')][string]$Table)
  $query = "SELECT count(*)::text AS row_count, COALESCE(sum(hashtextextended(concat_ws('|',id::text,xmin::text),0)::numeric),0)::text AS row_version_signature FROM $Table;"
  ConvertTo-SnapshotJson (Invoke-ManagementQuery -ReadOnly $true -Query $query)
}

function Assert-SameSnapshot {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Before, [Parameter(Mandatory)][string]$After)
  if ($Before -cne $After) { throw "$Name changed during the private Phase 7B installation." }
}

$migrationPath = 'supabase/migrations/20260824190000_phase7b_verified_price_research_shadow.sql'
$migration = Get-Content -LiteralPath $migrationPath -Raw
$normalized = $migration.Replace("`r`n", "`n")
$actualSha = [Convert]::ToHexString(
  [Security.Cryptography.SHA256]::HashData([Text.UTF8Encoding]::new($false).GetBytes($normalized))
).ToLowerInvariant()
if ($actualSha -cne $env:EXPECTED_NORMALIZED_LF_MIGRATION_SHA256) {
  throw 'Pinned normalized-LF Phase 7B migration SHA-256 mismatch.'
}
$migration = $migration -replace '(?im)^\s*BEGIN\s*;\s*$', ''
$migration = $migration -replace '(?im)^\s*COMMIT\s*;\s*$', ''

$installedCheck = Invoke-ManagementQuery -ReadOnly $true -Query @'
SELECT count(*)::integer AS function_count
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'begin_phase7b_verified_price_shadow','phase7b_verified_price_source_page',
  'ingest_phase7b_verified_price_shadow_batch','materialize_phase7b_verified_reference',
  'complete_phase7b_verified_price_shadow','phase7b_verified_reference_snapshot',
  'phase7b_verified_shadow_report');
'@
$installed = [int]$installedCheck[0].function_count -eq 7

if (-not $installed) {
  # Keep each exact source checksum in its own bounded Management API request. The former
  # combined transaction exceeded the gateway deadline before any private DDL could commit.
  $customerSurfaceBefore = Get-CustomerSurfaceSnapshot
  $customerFunctionBefore = Get-CustomerFunctionSnapshot
  $publicationBefore = Get-PublicationSnapshot
  $listingsBefore = Get-SourceSnapshot 'staging.listings'
  $rawMessagesBefore = Get-SourceSnapshot 'public.raw_messages'
  $rawVersionsBefore = Get-SourceSnapshot 'public.raw_message_versions'

  $installSql = "BEGIN;`nSET LOCAL lock_timeout='5s';`nSET LOCAL statement_timeout='120s';`n$migration`nCOMMIT;"
  Invoke-ManagementQuery -ReadOnly $false -Query $installSql | Out-Null

  Assert-SameSnapshot 'Customer view definitions' $customerSurfaceBefore (Get-CustomerSurfaceSnapshot)
  Assert-SameSnapshot 'Customer function definitions' $customerFunctionBefore (Get-CustomerFunctionSnapshot)
  Assert-SameSnapshot 'Publication controls' $publicationBefore (Get-PublicationSnapshot)
  Assert-SameSnapshot 'staging.listings rows or row versions' $listingsBefore (Get-SourceSnapshot 'staging.listings')
  Assert-SameSnapshot 'public.raw_messages rows or row versions' $rawMessagesBefore (Get-SourceSnapshot 'public.raw_messages')
  Assert-SameSnapshot 'public.raw_message_versions rows or row versions' $rawVersionsBefore (Get-SourceSnapshot 'public.raw_message_versions')
}

$privateContract = Invoke-ManagementQuery -ReadOnly $true -Query @'
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='price_research_shadow' AND c.relkind='r')::integer AS table_count,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='price_research_shadow' AND c.relkind='r' AND c.relrowsecurity)::integer AS rls_table_count,
  (SELECT count(*) FROM pg_policies WHERE schemaname='price_research_shadow')::integer AS policy_count,
  (SELECT count(*) FROM pg_publication_tables WHERE schemaname='price_research_shadow')::integer AS publication_count,
  (has_schema_privilege('anon','price_research_shadow','USAGE')
    OR has_schema_privilege('authenticated','price_research_shadow','USAGE')) AS customer_schema_usage,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE ((n.nspname='public' AND p.proname LIKE '%phase7b_verified%')
      OR (n.nspname='price_research_shadow' AND p.proname='price_stats'))
      AND (has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE')))::integer AS exposed_function_count;
'@
$contract = $privateContract[0]
if ([int]$contract.table_count -ne 6 -or [int]$contract.rls_table_count -ne 6) {
  throw 'Expected six private Phase 7B tables with RLS enabled.'
}
if ([int]$contract.policy_count -ne 0 -or [int]$contract.publication_count -ne 0 -or
    [bool]$contract.customer_schema_usage -or [int]$contract.exposed_function_count -ne 0) {
  throw 'Private Phase 7B access contract failed.'
}

Write-Output "{`"private_shadow_schema_ready`":true,`"preexisting`":$($installed.ToString().ToLowerInvariant()),`"migration_sha256`":`"$actualSha`",`"customer_source_switches`":0}"
