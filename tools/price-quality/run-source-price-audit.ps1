param(
  [string]$OutputDirectory = "C:\Users\jasme\Documents\Codex\2026-07-12\review\outputs\source-price-cohorts-canary",
  [int]$BatchRows = 30000,
  [int]$PauseSeconds = 5
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$checkpoint = Join-Path $OutputDirectory 'checkpoint.json'
$log = Join-Path $OutputDirectory 'runner.log'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Set-Location $repo

function Get-ScannedCount {
  if (-not (Test-Path $checkpoint)) { return 0 }
  $json = node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.state.scanned));" $checkpoint
  return [int]$json
}

while ($true) {
  $before = Get-ScannedCount
  $env:SOURCE_PRICE_AUDIT_MAX_ROWS = "$BatchRows"
  $env:SOURCE_PRICE_AUDIT_PAGE_SIZE = '1000'
  $env:SOURCE_PRICE_AUDIT_CHECKPOINT_ROWS = '25000'
  $env:SOURCE_PRICE_AUDIT_SAMPLE_LIMIT = '100'
  $env:SOURCE_PRICE_AUDIT_OUTPUT = $OutputDirectory

  $stamp = Get-Date -Format o
  "[$stamp] Starting from scanned=$before" | Tee-Object -FilePath $log -Append
  railway run node tools/price-quality/audit-source-price-cohorts.cjs 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) {
    "[$(Get-Date -Format o)] Stopped after Railway command exit code $LASTEXITCODE" | Tee-Object -FilePath $log -Append
    exit $LASTEXITCODE
  }

  $after = Get-ScannedCount
  if ($after -le $before) {
    "[$(Get-Date -Format o)] Complete: no additional source rows." | Tee-Object -FilePath $log -Append
    break
  }
  "[$(Get-Date -Format o)] Checkpoint advanced to scanned=$after" | Tee-Object -FilePath $log -Append
  Start-Sleep -Seconds $PauseSeconds
}
