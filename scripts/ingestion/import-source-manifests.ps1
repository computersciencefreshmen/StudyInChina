param(
  [switch]$Remote,
  [string]$OutputDirectory = ".pipeline-build"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$tsx = Join-Path $root "node_modules\.bin\tsx.cmd"
$wrangler = Join-Path $root "node_modules\.bin\wrangler.cmd"
$config = Join-Path $root "workers\ingestion\wrangler.jsonc"
$output = Join-Path $root $OutputDirectory
$targetFlag = if ($Remote) { "--remote" } else { "--local" }

if (-not (Test-Path -LiteralPath $tsx)) { throw "tsx is not installed. Run npm ci first." }
if (-not (Test-Path -LiteralPath $wrangler)) { throw "wrangler is not installed. Run npm ci first." }

$manifestPath = (& $tsx (Join-Path $root "scripts\ingestion\build-source-import.ts") --output $output | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0) { throw "Source Manifest build failed." }
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Source Manifest import metadata was not generated." }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

& $wrangler d1 migrations apply INGESTION_DB --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Pipeline D1 migration failed." }

foreach ($sqlPath in $manifest.sqlPaths) {
  & $wrangler d1 execute INGESTION_DB --file $sqlPath --config $config $targetFlag | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Source Manifest import failed for $sqlPath." }
}

$verification = "WITH pilot_institutions AS (SELECT DISTINCT json_extract(manifest_json, '$.institutionId') AS institution_id FROM ingestion_sources WHERE json_extract(manifest_json, '$.sourceCategory') = 'international_admissions_home') SELECT COUNT(*) AS sources, SUM(enabled) AS enabled_sources, COUNT(DISTINCT json_extract(manifest_json, '$.institutionId')) AS institutions FROM ingestion_sources WHERE json_extract(manifest_json, '$.institutionId') IN (SELECT institution_id FROM pilot_institutions);"
& $wrangler d1 execute INGESTION_DB --command $verification --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Source Manifest verification failed." }

Write-Output "Imported $($manifest.sources) sources for $($manifest.institutions) institutions ($targetFlag)."
