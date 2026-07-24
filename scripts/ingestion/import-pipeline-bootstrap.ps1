param(
  [switch]$Remote,
  [string]$OutputDirectory = ".pipeline-build",
  [int]$StartChunk = 1,
  [int]$MaxChunkAttempts = 3
)

$ErrorActionPreference = "Stop"
if ($StartChunk -lt 1) { throw "StartChunk must be at least 1." }
if ($MaxChunkAttempts -lt 1 -or $MaxChunkAttempts -gt 10) {
  throw "MaxChunkAttempts must be between 1 and 10."
}
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$tsx = Join-Path $root "node_modules\.bin\tsx.cmd"
$wrangler = Join-Path $root "node_modules\.bin\wrangler.cmd"
$commandRunner = Join-Path $root "scripts\cloudflare\execute-d1-command-file.mjs"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$config = Join-Path $root "workers\ingestion\wrangler.jsonc"
$output = Join-Path $root $OutputDirectory
$targetFlag = if ($Remote) { "--remote" } else { "--local" }
$maxChunkLength = 24000

if (-not (Test-Path -LiteralPath $tsx)) { throw "tsx is not installed. Run npm ci first." }
if (-not (Test-Path -LiteralPath $wrangler)) { throw "wrangler is not installed. Run npm ci first." }
if (-not (Test-Path -LiteralPath $commandRunner)) { throw "D1 command runner is missing." }

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
  if ($chunk.Length -gt 0 -and ($chunk.Length + $statement.Length) -gt $maxChunkLength) {
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

for ($chunkIndex = 0; $chunkIndex -lt $chunkPaths.Count; $chunkIndex += 1) {
  $chunkNumber = $chunkIndex + 1
  if ($chunkNumber -lt $StartChunk) { continue }
  $chunkPath = $chunkPaths[$chunkIndex]
  Write-Output "Importing Pipeline bootstrap chunk $chunkNumber/$($chunkPaths.Count)..."
  for ($attempt = 1; $attempt -le $MaxChunkAttempts; $attempt += 1) {
    if ($Remote) {
      & $node $commandRunner $chunkPath $config $targetFlag
    } else {
      & $wrangler d1 execute INGESTION_DB --file $chunkPath --config $config $targetFlag
    }
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) { break }
    if (-not $Remote -or $attempt -eq $MaxChunkAttempts) {
      throw "Pipeline bootstrap import failed for $chunkPath after $attempt attempt(s)."
    }
    Start-Sleep -Seconds ([Math]::Min(10, $attempt * 2))
  }
}

$verification = "SELECT " +
  "(SELECT COUNT(*) FROM records WHERE kind = 'location') AS locations, " +
  "(SELECT COUNT(*) FROM institutions) AS institutions, " +
  "(SELECT COUNT(*) FROM ingestion_sources) AS ingestion_sources, " +
  "(SELECT COUNT(*) FROM promotion_source_bindings WHERE enabled = 1) AS enabled_source_bindings, " +
  "(SELECT COUNT(*) FROM programs) AS programs;"
& $wrangler d1 execute INGESTION_DB --command $verification --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Pipeline bootstrap verification failed." }

Write-Output (
  (
    "Imported stable Pipeline bootstrap: {0} locations, {1} institutions, " +
    "{2} ingestion sources, {3} enabled official bindings; excluded {4} draft program templates ({5})."
  ) -f
  $manifest.locations,
  $manifest.institutions,
  $manifest.ingestionSources,
  $manifest.sourceBindings,
  $manifest.excludedDraftPrograms,
  $targetFlag
)
