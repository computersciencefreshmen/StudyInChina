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

$manifestPath = (& $tsx (Join-Path $root "scripts\ingestion\build-pipeline-bootstrap.ts") --output $output | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0) { throw "Pipeline bootstrap build failed." }
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Pipeline bootstrap metadata was not generated." }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $manifest.sqlPath)) { throw "Pipeline bootstrap SQL was not generated." }

& $wrangler d1 migrations apply INGESTION_DB --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Pipeline D1 migration failed." }

$sqlText = Get-Content -Raw -LiteralPath $manifest.sqlPath
$statements = [regex]::Split($sqlText, "(?m)(?<=;)\r?\n") | Where-Object { $_.Trim().Length -gt 0 }
$chunkPaths = @()
$chunk = New-Object System.Text.StringBuilder
$chunkNumber = 0
foreach ($statement in $statements) {
  if ($chunk.Length -gt 0 -and ($chunk.Length + $statement.Length) -gt 180000) {
    $chunkNumber += 1
    $chunkPath = Join-Path $output ("pipeline-bootstrap.chunk-{0:D2}.sql" -f $chunkNumber)
    [System.IO.File]::WriteAllText($chunkPath, $chunk.ToString())
    $chunkPaths += $chunkPath
    $chunk.Clear() | Out-Null
  }
  $chunk.AppendLine($statement) | Out-Null
}
if ($chunk.Length -gt 0) {
  $chunkNumber += 1
  $chunkPath = Join-Path $output ("pipeline-bootstrap.chunk-{0:D2}.sql" -f $chunkNumber)
  [System.IO.File]::WriteAllText($chunkPath, $chunk.ToString())
  $chunkPaths += $chunkPath
}

foreach ($chunkPath in $chunkPaths) {
  & $wrangler d1 execute INGESTION_DB --file $chunkPath --config $config $targetFlag
  if ($LASTEXITCODE -ne 0) { throw "Pipeline bootstrap import failed for $chunkPath." }
}

$verification = @"
SELECT
  (SELECT COUNT(*) FROM records WHERE kind = 'location') AS locations,
  (SELECT COUNT(*) FROM institutions) AS institutions,
  (SELECT COUNT(*) FROM ingestion_sources) AS ingestion_sources,
  (SELECT COUNT(*) FROM promotion_source_bindings WHERE enabled = 1) AS enabled_source_bindings,
  (SELECT COUNT(*) FROM programs) AS programs;
"@
& $wrangler d1 execute INGESTION_DB --command $verification --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Pipeline bootstrap verification failed." }

Write-Output (
  "Imported stable Pipeline bootstrap: {0} locations, {1} institutions, " +
  "{2} ingestion sources, {3} enabled official bindings; excluded {4} draft program templates ({5})." -f
  $manifest.locations,
  $manifest.institutions,
  $manifest.ingestionSources,
  $manifest.sourceBindings,
  $manifest.excludedDraftPrograms,
  $targetFlag
)
