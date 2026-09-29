param(
  [string]$Scope = "henry-yangs-projects-c9706eac",
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

Push-Location $root
try {
  # Use Vercel's actual collector, not a second implementation of its ignore rules.
  $raw = & $npx --yes vercel@58.0.0 deploy --dry --format=json --scope $Scope
  if ($LASTEXITCODE -ne 0) { throw "Vercel input collection failed." }
  $manifest = ($raw -join "`n") | ConvertFrom-Json
  $files = @($manifest.files | Where-Object { ($_.mode -band 61440) -eq 32768 })
  if ($files.Count -eq 0) { throw "Vercel did not return any regular deployment files." }
  $paths = @($files | ForEach-Object { $_.path.Replace('\', '/') })

  foreach ($required in @(
    "package.json", "package-lock.json", "tsconfig.json",
    "content/data/programs.json", "src/app/[locale]/page.tsx",
    "scripts/automation/operations-health.ts",
    "scripts/quality/comprehensive-data-audit.ts"
  )) {
    if ($paths -notcontains $required) { throw "Missing required deployment input: $required" }
  }
  foreach ($path in $paths) {
    if ($path -match '(^|/)(quality|\.tmp)/' -and $path -notmatch '^scripts/quality/') {
      throw "Audit artifacts or temporary bundles entered the deployment: $path"
    }
    if ($path -match '(^|/)\.env($|\.)' -and $path -ne '.env.example') {
      throw "An environment file entered the deployment: $path"
    }
  }

  $output = Join-Path $root (".pipeline-build\vercel-package-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $output | Out-Null
  $manifestPath = Join-Path $output "input-manifest.json"
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  $packageRoot = Join-Path $output "source"
  New-Item -ItemType Directory -Path $packageRoot | Out-Null

  foreach ($file in $files) {
    $relative = $file.path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $source = [IO.Path]::GetFullPath((Join-Path $root $relative))
    $destination = [IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
    if (-not $source.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not $destination.StartsWith($packageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Deployment input escaped the verified package directory."
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
    if ($file.sha -and (Get-FileHash -LiteralPath $destination -Algorithm SHA1).Hash -ne $file.sha) {
      throw "Deployment input changed after Vercel collected it; rerun against a stable checkout: $($file.path)"
    }
  }

  Write-Output "Verified $($files.Count) deployment files; exported exact Vercel inputs to $packageRoot"
  if ($Build) {
    Push-Location $packageRoot
    try {
      & $npm ci
      if ($LASTEXITCODE -ne 0) { throw "Clean deployment dependency installation failed." }
      & $npm run build
      if ($LASTEXITCODE -ne 0) { throw "Build from actual Vercel deployment inputs failed." }
    } finally { Pop-Location }
  }
} finally { Pop-Location }
