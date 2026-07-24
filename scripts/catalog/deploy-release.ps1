param(
  [switch]$Remote,
  [string]$OutputDirectory = ".catalog-build"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$tsx = Join-Path $root "node_modules\.bin\tsx.cmd"
$wrangler = Join-Path $root "node_modules\.bin\wrangler.cmd"
$config = Join-Path $root "workers\catalog-api\wrangler.jsonc"
$output = Join-Path $root $OutputDirectory
$targetFlag = if ($Remote) { "--remote" } else { "--local" }

if (-not (Test-Path -LiteralPath $tsx)) { throw "tsx is not installed. Run npm ci first." }
if (-not (Test-Path -LiteralPath $wrangler)) { throw "wrangler is not installed. Run npm ci first." }

$manifestPath = (& $tsx (Join-Path $root "scripts\catalog\build-release.ts") --output $output | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0) { throw "Release build failed." }
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Release manifest was not generated." }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$actualEnvelopeHash = (Get-FileHash -LiteralPath $manifest.envelopePath -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedEnvelopeHash = ([string]$manifest.contentSha256).ToLowerInvariant()
if ($actualEnvelopeHash -ne $expectedEnvelopeHash) {
  throw "Compatibility envelope checksum mismatch; the release was not uploaded or activated."
}

& $wrangler d1 migrations apply CATALOG_DB --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Catalog D1 migration failed." }

$objectPath = "studyinchina-releases/$($manifest.r2Key)"
& $wrangler r2 object put $objectPath --file $manifest.envelopePath --content-type "application/json" --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Compatibility envelope upload failed; the release was not activated." }

& $wrangler d1 execute CATALOG_DB --file $manifest.sqlPath --config $config $targetFlag | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Catalog release import failed." }

& $wrangler d1 execute CATALOG_DB --command "SELECT release_id, data_date, generated_at, release_status FROM current_release;" --config $config $targetFlag
if ($LASTEXITCODE -ne 0) { throw "Catalog release verification failed." }

Write-Output "Activated catalog release $($manifest.id) ($targetFlag)."
