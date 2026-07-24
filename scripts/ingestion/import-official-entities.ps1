param(
  [string[]]$InputPath = @(),
  [string]$InputDirectory,
  [string]$ManifestPath,
  [switch]$Remote,
  [string]$OutputDirectory = ".pipeline-build/materialized",
  [ValidateSet("auto", "file", "command_chunks")]
  [string]$Transport = "auto",
  [int]$MaxChunkAttempts = 3
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($MaxChunkAttempts -lt 1 -or $MaxChunkAttempts -gt 10) {
  throw "MaxChunkAttempts must be between 1 and 10."
}
if ($InputPath.Count -gt 0 -and $InputDirectory) {
  throw "-InputPath and -InputDirectory are mutually exclusive."
}
if ($ManifestPath -and ($InputPath.Count -gt 0 -or $InputDirectory)) {
  throw "-ManifestPath cannot be combined with input paths."
}
if (-not $ManifestPath -and $InputPath.Count -eq 0 -and -not $InputDirectory) {
  throw "Provide -ManifestPath, -InputPath, or -InputDirectory."
}

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
$materializer = Join-Path $root "scripts/ingestion/materialize-official-entities.ts"
$packager = Join-Path $root "scripts/ingestion/package-official-entity-import.ts"
$config = Join-Path $root "workers/ingestion/wrangler.jsonc"
$output = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
}
$targetFlag = if ($Remote) { "--remote" } else { "--local" }

foreach ($path in @(
  $tsxExecutable, $node, $wrangler, $materializer, $packager, $config
)) {
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

function Invoke-D1Query {
  param([string]$Sql)
  $command = $Sql.Replace("`r", " ").Replace("`n", " ").Trim()
  $response = Invoke-WranglerJson @(
    "d1", "execute", "INGESTION_DB", "--command", $command,
    "--config", $config, $targetFlag
  )
  $rows = @()
  foreach ($result in @($response)) {
    if ($null -ne $result.results) { $rows += @($result.results) }
  }
  return @($rows)
}

function Invoke-D1File {
  param([string]$Path, [switch]$Command)
  if ($Command) {
    # Direct node invocation preserves one multiline argv value. Flattening
    # would let a SQL -- line comment swallow every later statement.
    $sql = [System.IO.File]::ReadAllText($Path).Trim()
    if ([System.Text.Encoding]::UTF8.GetByteCount($sql) -gt 24000) {
      throw "D1 command exceeds 24KB: $Path"
    }
    Invoke-WranglerJson @(
      "d1", "execute", "INGESTION_DB", "--command", $sql,
      "--config", $config, $targetFlag
    ) | Out-Null
  } else {
    Invoke-WranglerJson @(
      "d1", "execute", "INGESTION_DB", "--file", $Path, "--yes",
      "--config", $config, $targetFlag
    ) | Out-Null
  }
}

function Sql-Literal {
  param([string]$Value)
  return $Value.Replace("'", "''")
}

function Get-Batch {
  param([string]$BatchId)
  $id = Sql-Literal $BatchId
  $rows = @(Invoke-D1Query @"
SELECT batch_id, batch_status, provenance_status, materializer_version,
package_digest, batch_purpose, expected_chunks, expected_records,
expected_programs, expected_scholarships, expected_organizations,
expected_locations, expected_claims, expected_canonical_fields,
expected_evidence_fragments, expected_source_documents
FROM materialization_batches WHERE batch_id='$id';
"@)
  if ($rows.Count -gt 1) { throw "Duplicate batch rows returned." }
  if ($rows.Count -eq 0) { return $null }
  return $rows[0]
}

function Get-Chunks {
  param([string]$BatchId)
  $id = Sql-Literal $BatchId
  return @(Invoke-D1Query @"
SELECT chunk_number, package_digest, chunk_sha256, statement_count
FROM materialization_batch_chunks WHERE batch_id='$id' ORDER BY chunk_number;
"@)
}

function Test-Chunk {
  param([object[]]$Rows, [object]$Chunk, [string]$PackageDigest, [switch]$MissingAllowed)
  $match = @($Rows | Where-Object { [int64]$_.chunk_number -eq [int64]$Chunk.chunkNumber })
  if ($match.Count -eq 0) {
    if ($MissingAllowed) { return $false }
    throw "Missing server marker for chunk $($Chunk.chunkNumber)."
  }
  if (
    $match.Count -ne 1 -or
    [string]$match[0].package_digest -ne $PackageDigest -or
    [string]$match[0].chunk_sha256 -ne [string]$Chunk.chunkSha256 -or
    [int64]$match[0].statement_count -ne [int64]$Chunk.statementCount
  ) {
    throw "Server marker conflicts with chunk $($Chunk.chunkNumber)."
  }
  return $true
}

function Assert-BatchIdentity {
  param([object]$Batch, [object]$Package)
  if ($null -eq $Batch) { return }
  $expected = [ordered]@{
    batch_id = [string]$Package.batchId
    provenance_status = "complete"
    materializer_version = [string]$Package.materializerVersion
    package_digest = [string]$Package.packageDigest
    batch_purpose = [string]$Package.batchPurpose
    expected_records = [int64]$Package.counts.records
    expected_programs = [int64]$Package.counts.programs
    expected_scholarships = [int64]$Package.counts.scholarships
    expected_organizations = [int64]$Package.counts.organizations
    expected_locations = [int64]$Package.counts.locations
    expected_claims = [int64]$Package.counts.claims
    expected_canonical_fields = [int64]$Package.counts.canonicalFields
    expected_evidence_fragments = [int64]$Package.counts.sourceFragments
    expected_source_documents = [int64]$Package.counts.sourceDocuments
  }
  foreach ($item in $expected.GetEnumerator()) {
    if ("$($Batch.($item.Key))" -ne "$($item.Value)") {
      throw "Existing batch conflicts at $($item.Key)."
    }
  }
  if ([string]$Batch.batch_status -in @("failed", "superseded")) {
    throw "Failed or superseded batches cannot be implicitly resumed."
  }
}

function Assert-TransportCompatibility {
  param([object]$Batch, [int]$ExpectedChunks)
  if ($null -ne $Batch -and [int64]$Batch.expected_chunks -ne [int64]$ExpectedChunks) {
    throw "Existing batch belongs to another transport package."
  }
}

function Assert-LocalChunk {
  param([object]$Package, [object]$Chunk)
  $result = @(Invoke-Tsx @($packager, "--verify-chunk", [string]$Chunk.path))
  if ($result.Count -eq 0) { throw "Chunk verification returned no result." }
  try {
    $verified = ([string]$result[-1]).Trim() | ConvertFrom-Json
  } catch {
    throw "Chunk verification returned invalid JSON."
  }
  $expected = [ordered]@{
    batchId = [string]$Package.batchId
    packageDigest = [string]$Package.packageDigest
    chunkNumber = [int64]$Chunk.chunkNumber
    chunkSha256 = [string]$Chunk.chunkSha256
    statementCount = [int64]$Chunk.statementCount
    payloadBytes = [int64]$Chunk.payloadBytes
    transportBytes = [int64]$Chunk.transportBytes
  }
  foreach ($item in $expected.GetEnumerator()) {
    if ("$($verified.($item.Key))" -ne "$($item.Value)") {
      throw "Local chunk conflicts at $($item.Key)."
    }
  }
}

function Sync-R2 {
  param([object]$Package, [switch]$Applied)
  $verifyDirectory = Join-Path $output ".r2-verify"
  [System.IO.Directory]::CreateDirectory($verifyDirectory) | Out-Null
  foreach ($artifact in @($Package.sourceArtifacts)) {
    $uri = [string]$artifact.artifactUri
    $artifactSha = [string]$artifact.artifactSha256
    if ($uri -notlike "r2://studyinchina-source-snapshots/*") { throw "Unsafe R2 URI: $uri" }
    $object = $uri.Substring(5)
    if (-not $object.Contains($artifactSha)) {
      throw "R2 object key is not bound to the full artifact SHA-256: $object"
    }
    if ($Remote -and ([bool]$artifact.isFixture -or [string]$artifact.captureMode -ne "live")) {
      throw "Remote import requires live, non-fixture source artifacts."
    }
    $local = [System.IO.Path]::GetFullPath([string]$artifact.localPath)
    if (-not (Test-Path -LiteralPath $local -PathType Leaf)) { throw "Source artifact is missing: $local" }
    $file = Get-Item -LiteralPath $local
    $sha = (Get-FileHash $local -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sha -ne $artifactSha -or [int64]$file.Length -ne [int64]$artifact.byteLength) {
      throw "Source artifact changed after packaging: $local"
    }
    $download = Join-Path $verifyDirectory ("$artifactSha-$([System.IO.Path]::GetFileName($local))")
    if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
    $exists = $false
    try {
      Invoke-Wrangler @("r2", "object", "get", $object, "--file", $download, "--config", $config, $targetFlag) | Out-Null
      $exists = $true
    } catch {
      if (-not $_.Exception.Message.Contains("The specified key does not exist.")) {
        throw
      }
    }
    if (-not $exists) {
      if ($Applied) { throw "Applied batch is missing immutable R2 object: $object" }
      Invoke-Wrangler @(
        "r2", "object", "put", $object, "--file", $local,
        "--content-type", [string]$artifact.contentType,
        "--config", $config, $targetFlag
      ) | Out-Null
      Invoke-Wrangler @("r2", "object", "get", $object, "--file", $download, "--config", $config, $targetFlag) | Out-Null
    }
    $downloadFile = Get-Item -LiteralPath $download
    $downloadSha = (Get-FileHash $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadSha -ne $artifactSha -or [int64]$downloadFile.Length -ne [int64]$artifact.byteLength) {
      throw "R2 byte/hash verification failed for $object."
    }
  }
}

function Import-Transport {
  param(
    [object]$Package,
    [ValidateSet("file", "command_chunks")][string]$Mode
  )
  $definition = if ($Mode -eq "file") { $Package.transports.file } else { $Package.transports.commandChunks }
  $chunks = @($definition.chunks)
  $count = [int]$definition.expectedChunks
  if ($chunks.Count -ne $count -or $count -lt 1) { throw "Invalid $Mode package chunk count." }
  $batch = Get-Batch ([string]$Package.batchId)
  Assert-BatchIdentity $batch $Package
  Assert-TransportCompatibility $batch $count
  if ($null -ne $batch -and [string]$batch.batch_status -eq "applied") { return $Mode }
  foreach ($chunk in $chunks) {
    if (Test-Chunk (Get-Chunks ([string]$Package.batchId)) $chunk ([string]$Package.packageDigest) -MissingAllowed) { continue }
    $lastError = $null
    for ($attempt = 1; $attempt -le $MaxChunkAttempts; $attempt += 1) {
      try {
        Assert-LocalChunk $Package $chunk
        Invoke-D1File ([string]$chunk.path) -Command:($Mode -eq "command_chunks")
        $lastError = $null
        break
      } catch {
        $lastError = $_
        if (Test-Chunk (Get-Chunks ([string]$Package.batchId)) $chunk ([string]$Package.packageDigest) -MissingAllowed) {
          $lastError = $null
          break
        }
        if ($attempt -lt $MaxChunkAttempts) { Start-Sleep -Seconds ([Math]::Min(10, $attempt * 2)) }
      }
    }
    if ($null -ne $lastError) { throw $lastError }
    Test-Chunk (Get-Chunks ([string]$Package.batchId)) $chunk ([string]$Package.packageDigest) | Out-Null
  }
  return $Mode
}

function Assert-Counts {
  param(
    [object]$Row,
    [object]$Package,
    [int]$ExpectedChunks,
    [switch]$Applied
  )
  $expected = [ordered]@{
    batch_id = [string]$Package.batchId
    provenance_status = "complete"
    materializer_version = [string]$Package.materializerVersion
    package_digest = [string]$Package.packageDigest
    manifest_batch_id = [string]$Package.batchId
    manifest_package_digest = [string]$Package.packageDigest
    manifest_source_sql_sha256 = [string]$Package.sourceSqlSha256
    manifest_source_artifact_count = [int64]$Package.counts.sourceDocuments
    expected_chunks = $ExpectedChunks
    batch_purpose = [string]$Package.batchPurpose
    expected_records = [int64]$Package.counts.records
    expected_programs = [int64]$Package.counts.programs
    expected_scholarships = [int64]$Package.counts.scholarships
    expected_claims = [int64]$Package.counts.claims
    expected_organizations = [int64]$Package.counts.organizations
    expected_locations = [int64]$Package.counts.locations
    expected_canonical_fields = [int64]$Package.counts.canonicalFields
    expected_evidence_fragments = [int64]$Package.counts.sourceFragments
    expected_source_documents = [int64]$Package.counts.sourceDocuments
    actual_chunks = $ExpectedChunks
    foreign_package_chunks = 0
    actual_intents = [int64]$Package.counts.records
    unmatched_intents = 0
    actual_records = [int64]$Package.counts.records
    actual_programs = [int64]$Package.counts.programs
    actual_scholarships = [int64]$Package.counts.scholarships
    actual_claims = [int64]$Package.counts.claims
    actual_canonical_fields = [int64]$Package.counts.canonicalFields
    actual_organizations = [int64]$Package.counts.organizations
    actual_locations = [int64]$Package.counts.locations
    actual_evidence_fragments = [int64]$Package.counts.sourceFragments
    actual_source_documents = [int64]$Package.counts.sourceDocuments
    canonical_claims_without_batch_primary_evidence = 0
    unbatched_primary_evidence = 0
    unused_source_artifacts = 0
    artifact_identity_mismatches = 0
    associated_program_cycles = 0
    associated_scholarship_cycles = 0
  }
  foreach ($item in $expected.GetEnumerator()) {
    if ("$($Row.($item.Key))" -ne "$($item.Value)") {
      throw (
        "Batch verification failed at $($item.Key): expected " +
        "$($item.Value), received $($Row.($item.Key))."
      )
    }
  }
  if (
    -not $Applied -and
    [int64]$Row.ready_records -ne [int64]$Package.counts.records
  ) {
    throw "Batch records are not all validated before finalization."
  }
  if ($Applied -and (
    [string]$Row.batch_status -ne "applied" -or
    [int64]$Row.applied_records -ne [int64]$Package.counts.records
  )) {
    throw "Batch did not apply every mapped record."
  }
  if (-not $Applied -and [string]$Row.batch_status -notin @("importing", "applied")) {
    throw "Batch is not ready for finalization."
  }
}

if (-not $ManifestPath) {
  $arguments = @($materializer, "--output", $output)
  if ($InputDirectory) {
    $arguments += @("--input-directory", $InputDirectory)
  } else {
    foreach ($path in $InputPath) { $arguments += @("--input", $path) }
  }
  $result = @(Invoke-Tsx $arguments)
  $ManifestPath = ([string]$result[-1]).Trim()
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  throw "Materialization manifest is missing: $ManifestPath"
}

$arguments = @(
  $packager, "--manifest", $ManifestPath, "--output", $output
)
if ($Remote) { $arguments += "--remote" }
$result = @(Invoke-Tsx $arguments)
$packagePath = ([string]$result[-1]).Trim()
$verificationResult = @(Invoke-Tsx @($packager, "--verify-package", $packagePath))
if ($verificationResult.Count -eq 0) { throw "Import package verification returned no result." }
try {
  $verifiedPackage = ([string]$verificationResult[-1]).Trim() | ConvertFrom-Json
} catch {
  throw "Import package verification returned invalid JSON."
}
$package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
if (
  [string]$package.format -ne "studyinchina.pipeline.materialization-import-package" -or
  [string]$package.provenanceStatus -ne "complete" -or
  [string]$package.batchPurpose -notin @("catalog_entities", "dependencies") -or
  [string]$verifiedPackage.batchId -ne [string]$package.batchId -or
  [string]$verifiedPackage.packageDigest -ne [string]$package.packageDigest -or
  [int64]$package.counts.programCycles -ne 0 -or
  [int64]$package.counts.scholarshipCycles -ne 0
) {
  throw "Import package failed strict validation."
}

Invoke-Wrangler @(
  "d1", "migrations", "apply", "INGESTION_DB", "--yes",
  "--config", $config, $targetFlag
) | Out-Null

# Auto mode deliberately selects the resumable transport before the batch is
# created. It never creates a file-mode identity and then falls back to chunks.
$used = if ($Transport -eq "file") { "file" } else { "command_chunks" }
$selected = if ($used -eq "file") { $package.transports.file } else { $package.transports.commandChunks }
$expectedChunks = [int]$selected.expectedChunks

# Check an existing immutable batch identity before any R2 write decision.
$serverBatch = Get-Batch ([string]$package.batchId)
Assert-BatchIdentity $serverBatch $package
Assert-TransportCompatibility $serverBatch $expectedChunks
$isApplied = $null -ne $serverBatch -and [string]$serverBatch.batch_status -eq "applied"

# Existing immutable objects are fetched and verified first. Applied replays
# never issue an R2 PUT.
Sync-R2 $package -Applied:$isApplied
$used = Import-Transport $package $used

$verifySql = [System.IO.File]::ReadAllText([string]$package.verificationSqlPath)
$rows = @(Invoke-D1Query $verifySql)
if ($rows.Count -ne 1) { throw "Batch verification returned no exact row." }
if ([string]$rows[0].batch_status -eq "applied") {
  Assert-Counts $rows[0] $package $expectedChunks -Applied
} else {
  Assert-Counts $rows[0] $package $expectedChunks
  $verificationResult = @(Invoke-Tsx @($packager, "--verify-package", $packagePath))
  if ($verificationResult.Count -eq 0) { throw "Pre-finalization package verification returned no result." }
  $reverified = ([string]$verificationResult[-1]).Trim() | ConvertFrom-Json
  if ([string]$reverified.packageDigest -ne [string]$package.packageDigest) {
    throw "Package identity changed before finalization."
  }
  Invoke-D1File ([string]$package.finalizationSqlPath) -Command
  $rows = @(Invoke-D1Query $verifySql)
  if ($rows.Count -ne 1) { throw "Final verification returned no exact row." }
  Assert-Counts $rows[0] $package $expectedChunks -Applied
}

Write-Output (
  (
    "Applied verified batch {0} ({1}): {2} identities ({3} programs, " +
    "{4} scholarships), {5} accepted claims, {6} private artifacts, " +
    "0 associated cycles, via {7}."
  ) -f
  $package.batchId,
  $package.packageDigest,
  $package.counts.records,
  $package.counts.programs,
  $package.counts.scholarships,
  $package.counts.claims,
  $package.counts.sourceDocuments,
  $used
)
