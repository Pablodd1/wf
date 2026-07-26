param(
  [Parameter(Mandatory = $true)]
  [string]$DataRoot,

  [string]$Repository = '',

  [ValidateRange(1, 8)]
  [int]$Workers = 4,

  [ValidateRange(100, 50000)]
  [int]$ShardSize = 50000
)

$ErrorActionPreference = 'Stop'
if (-not $Repository) {
  $Repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
}
$auditPath = Join-Path $DataRoot 'unbundled-collection-audit-20260725.json'
$normalizer = Join-Path $Repository 'tools/multilisting/normalize-unbundled-batch.cjs'
$validator = Join-Path $Repository 'tools/multilisting/validate-normalized-unbundled-batch.cjs'
$progressPath = Join-Path $DataRoot 'direct-normalization-20260726-progress.json'
$resultPath = Join-Path $DataRoot 'direct-normalization-20260726-result.json'

if (-not (Test-Path -LiteralPath $auditPath)) {
  throw "Missing collection audit: $auditPath"
}
if (-not (Test-Path -LiteralPath $normalizer)) {
  throw "Missing normalizer: $normalizer"
}
if (-not (Test-Path -LiteralPath $validator)) {
  throw "Missing validator: $validator"
}

function Write-AtomicJson {
  param([string]$Path, [object]$Value)
  $temporary = "$Path.partial"
  $backup = "$Path.backup"
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding utf8
  for ($attempt = 1; $attempt -le 8; $attempt += 1) {
    try {
      if (Test-Path -LiteralPath $Path) {
        if (Test-Path -LiteralPath $backup) {
          Remove-Item -LiteralPath $backup -Force
        }
        [System.IO.File]::Replace($temporary, $Path, $backup, $true)
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
      } else {
        [System.IO.File]::Move($temporary, $Path)
      }
      return
    } catch [System.IO.IOException], [System.UnauthorizedAccessException] {
      if ($attempt -eq 8) {
        throw
      }
      Start-Sleep -Milliseconds (100 * $attempt)
    }
  }
}

function Get-OutputPath {
  param([string]$Batch)
  if ($Batch -eq '001') {
    return Join-Path $DataRoot 'direct-normalization-20260726-batch001-50k-v4'
  }
  return Join-Path $DataRoot "direct-normalization-20260726-batch${Batch}-v4"
}

function Add-CountMap {
  param([hashtable]$Target, [object]$Source)
  foreach ($property in $Source.PSObject.Properties) {
    $current = if ($Target.ContainsKey($property.Name)) {
      [int64]$Target[$property.Name]
    } else {
      [int64]0
    }
    $Target[$property.Name] = $current + [int64]$property.Value
  }
}

$audit = Get-Content -LiteralPath $auditPath -Raw | ConvertFrom-Json
$pending = [System.Collections.Generic.Queue[object]]::new()
$audit.batches |
  Sort-Object listingRows -Descending |
  ForEach-Object {
    $pending.Enqueue([pscustomobject]@{
      batch = [string]$_.batch
      expectedRows = [int64]$_.listingRows
      listings = [string]$_.files.listings.path
      parents = [string]$_.files.raw_messages.path
    })
  }

$active = [System.Collections.Generic.List[object]]::new()
$completed = [System.Collections.Generic.List[object]]::new()
$failures = [System.Collections.Generic.List[object]]::new()
$runStarted = Get-Date

while ($pending.Count -gt 0 -or $active.Count -gt 0) {
  while ($pending.Count -gt 0 -and $active.Count -lt $Workers) {
    $batch = $pending.Dequeue()
    $output = Get-OutputPath $batch.batch
    New-Item -ItemType Directory -Path $output -Force | Out-Null

    $existingReportPath = Join-Path $output 'report.json'
    $existingValidationPath = Join-Path $output 'validation.json'
    if ((Test-Path -LiteralPath $existingReportPath) -and (Test-Path -LiteralPath $existingValidationPath)) {
      $existingReport = Get-Content -LiteralPath $existingReportPath -Raw | ConvertFrom-Json
      $existingValidation = Get-Content -LiteralPath $existingValidationPath -Raw | ConvertFrom-Json
      if ([int64]$existingReport.processedRows -eq $batch.expectedRows -and $existingValidation.passed) {
        $completed.Add([pscustomobject]@{
          batch = $batch.batch
          processedRows = $batch.expectedRows
          output = $output
          resumed = $true
          skippedAsComplete = $true
        })
        continue
      }
    }

    $env:UNBUNDLED_CSV_PATH = $batch.listings
    $env:UNBUNDLED_PARENT_CSV_PATH = $batch.parents
    $env:UNBUNDLED_NORMALIZED_OUTPUT = $output
    $env:UNBUNDLED_SHARD_SIZE = [string]$ShardSize
    $env:UNBUNDLED_RESUME = 'true'
    Remove-Item Env:UNBUNDLED_MAX_ROWS -ErrorAction SilentlyContinue

    $stdout = Join-Path $output 'collection-worker.stdout.log'
    $stderr = Join-Path $output 'collection-worker.stderr.log'
    $process = Start-Process -FilePath 'node' `
      -ArgumentList @($normalizer) `
      -WorkingDirectory $Repository `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru `
      -WindowStyle Hidden

    $active.Add([pscustomobject]@{
      batch = $batch
      output = $output
      process = $process
      startedAt = Get-Date
      peakWorkingSetBytes = [int64]0
      stdout = $stdout
      stderr = $stderr
    })
  }

  Start-Sleep -Seconds 2

  for ($index = $active.Count - 1; $index -ge 0; $index -= 1) {
    $worker = $active[$index]
    $worker.process.Refresh()
    if ($worker.process.WorkingSet64 -gt $worker.peakWorkingSetBytes) {
      $worker.peakWorkingSetBytes = $worker.process.WorkingSet64
    }
    if (-not $worker.process.HasExited) {
      continue
    }

    $active.RemoveAt($index)
    $worker.process.WaitForExit()
    $reportPath = Join-Path $worker.output 'report.json'
    $report = if (Test-Path -LiteralPath $reportPath) {
      Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    } else {
      $null
    }
    if (($null -ne $worker.process.ExitCode -and $worker.process.ExitCode -ne 0) -or
        $null -eq $report -or
        [int64]$report.processedRows -ne $worker.batch.expectedRows) {
      $failures.Add([pscustomobject]@{
        batch = $worker.batch.batch
        stage = 'normalization'
        exitCode = $worker.process.ExitCode
        processedRows = if ($null -ne $report) { [int64]$report.processedRows } else { $null }
        expectedRows = $worker.batch.expectedRows
        stderr = $worker.stderr
      })
      continue
    }

    $env:UNBUNDLED_NORMALIZED_OUTPUT = $worker.output
    $env:UNBUNDLED_EXPECTED_ROWS = [string]$worker.batch.expectedRows
    $validationStdout = Join-Path $worker.output 'collection-validation.stdout.log'
    $validationStderr = Join-Path $worker.output 'collection-validation.stderr.log'
    $validationProcess = Start-Process -FilePath 'node' `
      -ArgumentList @($validator) `
      -WorkingDirectory $Repository `
      -RedirectStandardOutput $validationStdout `
      -RedirectStandardError $validationStderr `
      -PassThru `
      -Wait `
      -WindowStyle Hidden

    $validationPath = Join-Path $worker.output 'validation.json'
    $validation = if (Test-Path -LiteralPath $validationPath) {
      Get-Content -LiteralPath $validationPath -Raw | ConvertFrom-Json
    } else {
      $null
    }
    if (($null -ne $validationProcess.ExitCode -and $validationProcess.ExitCode -ne 0) -or
        $null -eq $validation -or
        -not $validation.passed) {
      $failures.Add([pscustomobject]@{
        batch = $worker.batch.batch
        stage = 'validation'
        exitCode = $validationProcess.ExitCode
        passed = if ($null -ne $validation) { [bool]$validation.passed } else { $false }
        stderr = $validationStderr
      })
      continue
    }

    $completed.Add([pscustomobject]@{
      batch = $worker.batch.batch
      processedRows = [int64]$report.processedRows
      output = $worker.output
      runtimeSeconds = [math]::Round(((Get-Date) - $worker.startedAt).TotalSeconds, 2)
      peakWorkingSetBytes = $worker.peakWorkingSetBytes
      resumed = Test-Path -LiteralPath (Join-Path $worker.output 'checkpoint.json')
      skippedAsComplete = $false
    })
  }

  $checkpointRows = [int64]0
  foreach ($batch in $audit.batches) {
    $checkpointPath = Join-Path (Get-OutputPath ([string]$batch.batch)) 'checkpoint.json'
    if (Test-Path -LiteralPath $checkpointPath) {
      try {
        $checkpointRows += [int64](Get-Content -LiteralPath $checkpointPath -Raw | ConvertFrom-Json).processedRows
      } catch {
        # A worker may be atomically replacing this file while progress is sampled.
      }
    }
  }

  Write-AtomicJson $progressPath ([ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    parserVersion = 'manual-unbundle-full-v4'
    workers = $Workers
    shardSize = $ShardSize
    totalRows = [int64]$audit.totals.listingRows
    checkpointRows = $checkpointRows
    percent = [math]::Round(100 * $checkpointRows / [int64]$audit.totals.listingRows, 2)
    completedBatches = $completed.Count
    failedBatches = $failures.Count
    activeBatches = @($active | ForEach-Object { $_.batch.batch })
    pendingBatches = $pending.Count
    runtimeSeconds = [math]::Round(((Get-Date) - $runStarted).TotalSeconds, 2)
    productionWrites = 0
  })
}

$aggregate = [ordered]@{
  status = @{}
  bucket = @{}
  intent = @{}
  blockers = @{}
  reviewReasons = @{}
  sellerCoverage = [ordered]@{ sellerName = [int64]0; sellerPhone = [int64]0; dealer = [int64]0 }
  validation = [ordered]@{
    rowsRead = [int64]0
    duplicateListingIds = [int64]0
    missingListingIds = [int64]0
    invalidBuckets = [int64]0
    lineageFailuresOutsideHold = [int64]0
    productionApprovedRows = [int64]0
    reviewReadyWtsWithoutPrice = [int64]0
    reviewReadyWtsWithoutCurrency = [int64]0
    reviewReadyCatalogFailures = [int64]0
    passedBatches = 0
  }
  outputBytes = [int64]0
}
foreach ($batch in $audit.batches) {
  $output = Get-OutputPath ([string]$batch.batch)
  $report = Get-Content -LiteralPath (Join-Path $output 'report.json') -Raw | ConvertFrom-Json
  $validation = Get-Content -LiteralPath (Join-Path $output 'validation.json') -Raw | ConvertFrom-Json
  Add-CountMap $aggregate.status $report.counts.status
  Add-CountMap $aggregate.bucket $report.counts.bucket
  Add-CountMap $aggregate.intent $report.counts.intent
  Add-CountMap $aggregate.blockers $report.counts.blockers
  Add-CountMap $aggregate.reviewReasons $report.counts.reviewReasons
  foreach ($field in @('sellerName', 'sellerPhone', 'dealer')) {
    $aggregate.sellerCoverage[$field] += [int64]$report.counts.sellerCoverage.$field
  }
  $aggregate.validation.rowsRead += [int64]$validation.rowsRead
  foreach ($field in @(
    'duplicateListingIds', 'missingListingIds', 'invalidBuckets',
    'lineageFailuresOutsideHold', 'productionApprovedRows',
    'reviewReadyWtsWithoutPrice', 'reviewReadyWtsWithoutCurrency',
    'reviewReadyCatalogFailures'
  )) {
    $aggregate.validation[$field] += [int64]$validation.$field
  }
  if ($validation.passed) {
    $aggregate.validation.passedBatches += 1
  }
  foreach ($file in $report.files) {
    $aggregate.outputBytes += [int64]$file.bytes
  }
}
$aggregate.bucketRows = [int64](($aggregate.bucket.Values | Measure-Object -Sum).Sum)
$aggregate.reconciled = $aggregate.bucketRows -eq [int64]$audit.totals.listingRows `
  -and $aggregate.validation.rowsRead -eq [int64]$audit.totals.listingRows `
  -and $aggregate.validation.passedBatches -eq $audit.batchCount

$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  parserVersion = 'manual-unbundle-full-v4'
  workers = $Workers
  shardSize = $ShardSize
  expectedRows = [int64]$audit.totals.listingRows
  completedRows = [int64](($completed | Measure-Object processedRows -Sum).Sum)
  completedBatches = $completed.Count
  failures = @($failures)
  results = @($completed | Sort-Object batch)
  aggregate = $aggregate
  runtimeSeconds = [math]::Round(((Get-Date) - $runStarted).TotalSeconds, 2)
  productionWrites = 0
}
Write-AtomicJson $resultPath $result
$result | ConvertTo-Json -Depth 12
if ($failures.Count -gt 0 -or $result.completedRows -ne $result.expectedRows) {
  exit 1
}
