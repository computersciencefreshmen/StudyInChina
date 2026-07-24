param(
  [Parameter(Mandatory = $true)]
  [string]$CatalogManifestPath,
  [Parameter(Mandatory = $true)]
  [string]$DependencyManifestPath,
  [switch]$Remote,
  [string]$OutputDirectory = ".pipeline-build/materialization-release"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$isWindowsPlatform = $env:OS -eq "Windows_NT"
$node = (Get-Command "node" -CommandType Application -ErrorAction Stop).Source
$localTsxName = if ($isWindowsPlatform) { "tsx.cmd" } else { "tsx" }
$localTsx = Join-Path $root (Join-Path "node_modules/.bin" $localTsxName)
$tsxExecutable = $null
$tsxPrefixArguments = @()
if (Test-Path -LiteralPath $localTsx -PathType Leaf) {
  $tsxExecutable = $localTsx
} else {
  $npxName = if ($isWindowsPlatform) { "npx.cmd" } else { "npx" }
  $tsxExecutable = (
    Get-Command $npxName -CommandType Application -ErrorAction Stop
  ).Source
  $tsxPrefixArguments = @("--no-install", "tsx")
}
$wrangler = Join-Path $root "node_modules/wrangler/bin/wrangler.js"
$generator = Join-Path $root (
  "scripts/ingestion/request-materialization-release.ts"
)
$config = Join-Path $root "workers/ingestion/wrangler.jsonc"
$targetFlag = if ($Remote) { "--remote" } else { "--local" }
$output = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
}

foreach ($path in @($tsxExecutable, $node, $wrangler, $generator, $config)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required file is missing: $path"
  }
}
[System.IO.Directory]::CreateDirectory($output) | Out-Null

function Invoke-Tsx {
  param([string[]]$Arguments)
  $lines = @(& $tsxExecutable @tsxPrefixArguments @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "tsx failed with exit code $LASTEXITCODE."
  }
  return $lines
}

function Invoke-Wrangler {
  param([string[]]$Arguments)
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $lines = @(& $node $wrangler @Arguments 2>&1 | ForEach-Object { "$_" })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  $text = ($lines -join "`n").Trim()
  if ($exitCode -ne 0) {
    throw "Wrangler failed: $($Arguments -join ' ')`n$text"
  }
  return $text
}

function Invoke-WranglerJson {
  param([string[]]$Arguments)
  $json = Invoke-Wrangler ($Arguments + @("--json"))
  try {
    $response = $json | ConvertFrom-Json
  } catch {
    throw "Wrangler returned invalid JSON.`n$json"
  }
  foreach ($result in @($response)) {
    if ($null -ne $result.success -and -not [bool]$result.success) {
      throw "Wrangler JSON response reported failure.`n$json"
    }
  }
  return $response
}

function Invoke-D1Command {
  param([string]$Sql)
  return Invoke-WranglerJson @(
    "d1", "execute", "INGESTION_DB", "--command", $Sql,
    "--config", $config, $targetFlag
  )
}

function Get-D1Rows {
  param([object]$Response)
  $rows = @()
  foreach ($result in @($Response)) {
    if ($null -ne $result.results) {
      $rows += @($result.results)
    }
  }
  return @($rows)
}

$generatorArguments = @(
  $generator,
  "--catalog-manifest", $CatalogManifestPath,
  "--dependency-manifest", $DependencyManifestPath,
  "--output", $output
)
if ($Remote) { $generatorArguments += "--remote-contract" }
$generatorOutput = @(Invoke-Tsx $generatorArguments)
$planPath = ([string]$generatorOutput[-1]).Trim()
if (-not (Test-Path -LiteralPath $planPath -PathType Leaf)) {
  throw "Release request plan is missing: $planPath"
}
$plan = Get-Content -Raw -LiteralPath $planPath | ConvertFrom-Json
if (
  [string]$plan.format -ne
    "studyinchina.pipeline.materialization-release-request" -or
  [int]$plan.formatVersion -ne 1 -or
  [string]$plan.catalog.batchPurpose -ne "catalog_entities" -or
  [string]$plan.dependency.batchPurpose -ne "dependencies" -or
  [int64]$plan.catalog.counts.programs -lt 1000 -or
  [int64]$plan.catalog.counts.scholarships -lt 50
) {
  throw "Generated release request plan failed strict validation."
}

Invoke-Wrangler @(
  "d1", "migrations", "apply", "INGESTION_DB", "--yes",
  "--config", $config, $targetFlag
) | Out-Null

$requestSql = [System.IO.File]::ReadAllText(
  [string]$plan.requestSqlPath
).Trim()
if (
  [System.Text.Encoding]::UTF8.GetByteCount($requestSql) -gt 24000 -or
  -not $requestSql.StartsWith(
    "INSERT OR IGNORE INTO materialization_release_requests"
  )
) {
  throw "Release request is not a bounded single INSERT statement."
}
Invoke-D1Command $requestSql | Out-Null

$verificationSql = [System.IO.File]::ReadAllText(
  [string]$plan.verificationSqlPath
).Trim()
$rows = @(Get-D1Rows (Invoke-D1Command $verificationSql))
if ($rows.Count -ne 1) {
  throw "Release request verification did not return exactly one row."
}
$row = $rows[0]
$expected = [ordered]@{
  request_id = [string]$plan.requestId
  catalog_batch_id = [string]$plan.catalog.batchId
  dependency_batch_id = [string]$plan.dependency.batchId
  publication_job_id = [string]$plan.publicationJobId
  catalog_release_id = [string]$plan.catalogReleaseId
  outbox_event_id = [string]$plan.outboxEventId
  event_type = "catalog.release.requested"
  aggregate_id = [string]$plan.publicationJobId
  source_change_set_ids_json = "[]"
  relational_contract_valid = 1
}
foreach ($item in $expected.GetEnumerator()) {
  if ("$($row.($item.Key))" -ne "$($item.Value)") {
    throw (
      "Release request verification failed at $($item.Key): expected " +
      "$($item.Value), received $($row.($item.Key))."
    )
  }
}
if (
  [string]$row.job_status -notin @(
    "queued", "building", "validated", "published", "failed", "cancelled"
  ) -or
  [string]$row.event_status -notin @(
    "pending", "processing", "delivered", "failed", "dead_letter"
  )
) {
  throw "Release request has an invalid downstream state."
}
$payload = ([string]$row.payload_json) | ConvertFrom-Json
$payloadExpected = [ordered]@{
  version = 1
  materializationRequestId = [string]$plan.requestId
  publicationJobId = [string]$plan.publicationJobId
  catalogReleaseId = [string]$plan.catalogReleaseId
  catalogBatchId = [string]$plan.catalog.batchId
  dependencyBatchId = [string]$plan.dependency.batchId
}
foreach ($item in $payloadExpected.GetEnumerator()) {
  if ("$($payload.($item.Key))" -ne "$($item.Value)") {
    throw "Release outbox payload failed at $($item.Key)."
  }
}
if ([string]$row.event_payload_json -ne [string]$row.payload_json) {
  throw "Release outbox payload differs from the immutable request payload."
}

Write-Output (
  (
    "Requested Catalog Release {0} from catalog batch {1} and " +
    "dependency batch {2}; publication job {3}, outbox {4}."
  ) -f
  $plan.catalogReleaseId,
  $plan.catalog.batchId,
  $plan.dependency.batchId,
  $plan.publicationJobId,
  $plan.outboxEventId
)

