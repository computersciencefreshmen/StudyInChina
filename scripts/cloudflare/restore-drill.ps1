param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory,

  [ValidateSet('all', 'catalog', 'pipeline')]
  [string]$Database = 'all',

  [string]$WorkRoot,

  [string]$ReportPath,

  [long]$MaxUncompressedBytes = 12GB,

  [switch]$KeepWorkDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '..') '..'))
$backupRoot = (Resolve-Path -LiteralPath $BackupDirectory).Path
if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
  throw "BackupDirectory is not a directory: $BackupDirectory"
}

if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
  $WorkRoot = Join-Path $repositoryRoot '.restore-drill'
}
$workRootFull = [System.IO.Path]::GetFullPath($WorkRoot)
[System.IO.Directory]::CreateDirectory($workRootFull) | Out-Null

$runId = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'), ([guid]::NewGuid().ToString('N').Substring(0, 12))
$runDirectory = [System.IO.Path]::GetFullPath((Join-Path $workRootFull "drill-$runId"))
$workRootPrefix = $workRootFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $runDirectory.StartsWith($workRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to create a restore drill outside WorkRoot.'
}
[System.IO.Directory]::CreateDirectory($runDirectory) | Out-Null

$isWindows = [System.IO.Path]::DirectorySeparatorChar -eq '\'
$wranglerName = if ($isWindows) { 'wrangler.cmd' } else { 'wrangler' }
$wranglerBin = Join-Path (Join-Path $repositoryRoot 'node_modules') '.bin'
$wrangler = Join-Path $wranglerBin $wranglerName
if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) {
  throw 'Wrangler is not installed. Run npm ci first.'
}
$node = (Get-Command node -ErrorAction Stop).Source
$localVerifier = Join-Path (Join-Path (Join-Path $repositoryRoot 'scripts') 'cloudflare') 'verify-restored-d1.mjs'
if (-not (Test-Path -LiteralPath $localVerifier -PathType Leaf)) {
  throw 'Local D1 verifier is missing.'
}

# Keep all Wrangler state inside the disposable drill directory. The script has
# no remote mode and every D1 invocation below includes --local explicitly.
$env:XDG_CONFIG_HOME = Join-Path $runDirectory 'xdg-config'
$stateDirectory = Join-Path $runDirectory 'd1-state'
$configPath = Join-Path $runDirectory 'wrangler.restore.json'

$selectedDatabases = if ($Database -eq 'all') {
  @('catalog', 'pipeline')
} else {
  @($Database)
}

$databaseDefinitions = foreach ($databaseName in $selectedDatabases) {
  $binding = if ($databaseName -eq 'catalog') { 'CATALOG_RESTORE' } else { 'PIPELINE_RESTORE' }
  [ordered]@{
    kind = $databaseName
    binding = $binding
    databaseName = "studyinchina-restore-drill-$databaseName-$($runId.Substring($runId.Length - 12))"
    databaseId = [guid]::NewGuid().ToString()
  }
}

$wranglerConfig = [ordered]@{
  name = "studyinchina-restore-drill-$($runId.Substring($runId.Length - 12))"
  compatibility_date = '2026-07-20'
  d1_databases = @(
    $databaseDefinitions | ForEach-Object {
      [ordered]@{
        binding = $_.binding
        database_name = $_.databaseName
        database_id = $_.databaseId
      }
    }
  )
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  $configPath,
  ($wranglerConfig | ConvertTo-Json -Depth 8),
  $utf8WithoutBom
)

function Read-ChecksumManifest {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Checksum manifest is missing: $Path"
  }

  $checksums = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -notmatch '^([a-fA-F0-9]{64})\s+\*?([^\\/]+)$') {
      throw "Invalid checksum manifest line: $line"
    }
    $fileName = $Matches[2].Trim()
    if ($checksums.ContainsKey($fileName)) {
      throw "Duplicate checksum entry: $fileName"
    }
    $checksums[$fileName] = $Matches[1].ToLowerInvariant()
  }
  return $checksums
}

function Expand-GzipBounded {
  param(
    [string]$InputPath,
    [string]$OutputPath,
    [long]$MaximumBytes
  )

  $inputStream = [System.IO.File]::OpenRead($InputPath)
  try {
    $gzipStream = New-Object System.IO.Compression.GZipStream(
      $inputStream,
      [System.IO.Compression.CompressionMode]::Decompress
    )
    try {
      $outputStream = [System.IO.File]::Create($OutputPath)
      try {
        $buffer = New-Object byte[] (1024 * 1024)
        [long]$totalBytes = 0
        while (($read = $gzipStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $totalBytes += $read
          if ($totalBytes -gt $MaximumBytes) {
            throw "Uncompressed backup exceeds the $MaximumBytes byte safety limit."
          }
          $outputStream.Write($buffer, 0, $read)
        }
        return $totalBytes
      } finally {
        $outputStream.Dispose()
      }
    } finally {
      $gzipStream.Dispose()
    }
  } finally {
    $inputStream.Dispose()
  }
}

function Invoke-Wrangler {
  param([string[]]$Arguments)

  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $wrangler @Arguments 2>&1 | ForEach-Object { "$_" })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  if ($exitCode -ne 0) {
    throw "Wrangler failed: $($Arguments -join ' ')`n$($output -join "`n")"
  }
  return ($output -join "`n").Trim()
}

function Invoke-D1Query {
  param(
    [string]$Binding,
    [string]$Sql
  )

  # Windows .cmd shims split literal newlines in an argument. D1 receives the
  # same SQL semantics when query newlines are normalized to spaces.
  $commandSql = $Sql.Replace("`r", ' ').Replace("`n", ' ').Trim()
  $json = Invoke-Wrangler @(
    'd1', 'execute', $Binding,
    '--local',
    '--persist-to', $stateDirectory,
    '--config', $configPath,
    '--command', $commandSql,
    '--json'
  )
  try {
    $response = $json | ConvertFrom-Json
  } catch {
    throw "Wrangler returned invalid JSON for query: $Sql`n$json"
  }

  $rows = @()
  foreach ($result in @($response)) {
    if ($null -ne $result.success -and -not [bool]$result.success) {
      throw "D1 query reported failure: $Sql"
    }
    if ($null -ne $result.results) {
      $rows += @($result.results)
    }
  }
  return @($rows)
}

function Initialize-IsolatedSchema {
  param(
    [string]$Binding,
    [string]$Kind
  )

  $migrationDirectory = Join-Path (Join-Path (Join-Path (Join-Path $repositoryRoot 'infra') 'd1') $Kind) 'migrations'
  $migrationFiles = @(
    Get-ChildItem -LiteralPath $migrationDirectory -File -Filter '*.sql' |
      Sort-Object -Property Name
  )
  if ($migrationFiles.Count -eq 0) {
    throw "No migrations found for $Kind."
  }
  foreach ($migration in $migrationFiles) {
    Invoke-Wrangler @(
      'd1', 'execute', $Binding,
      '--local',
      '--persist-to', $stateDirectory,
      '--config', $configPath,
      '--file', $migration.FullName,
      '--yes'
    ) | Out-Null
  }

  # A data-only export may contain rows that would correctly be rejected by
  # live-write transition triggers (for example an already accepted claim).
  # Capture the trusted migration-created triggers, remove them only in this
  # disposable database, import with deferred foreign keys, then recreate them.
  $triggerRows = @(Invoke-D1Query $Binding @'
SELECT name, sql
FROM sqlite_schema
WHERE type = 'trigger' AND sql IS NOT NULL
ORDER BY name;
'@)
  if ($triggerRows.Count -eq 0) {
    throw "$Kind schema contains no validation triggers."
  }

  $dropTriggerPath = Join-Path $runDirectory "$Kind.drop-triggers.sql"
  $dropSql = ($triggerRows | ForEach-Object {
    $escapedName = ([string]$_.name).Replace('"', '""')
    "DROP TRIGGER IF EXISTS `"$escapedName`";"
  }) -join "`n"
  [System.IO.File]::WriteAllText($dropTriggerPath, $dropSql, $utf8WithoutBom)
  Invoke-Wrangler @(
    'd1', 'execute', $Binding,
    '--local',
    '--persist-to', $stateDirectory,
    '--config', $configPath,
    '--file', $dropTriggerPath,
    '--yes'
  ) | Out-Null

  if ($Kind -eq 'catalog') {
    Invoke-D1Query $Binding "DELETE FROM release_pointer WHERE singleton_id = 1 AND current_release_id IS NULL AND updated_by = 'migration';" | Out-Null
  }

  return @($triggerRows)
}

function Restore-IsolatedTriggersAndSearch {
  param(
    [string]$Binding,
    [string]$Kind,
    [object[]]$TriggerRows
  )

  if ($Kind -eq 'catalog') {
    Invoke-D1Query $Binding "UPDATE search_documents SET body = '', filter_text = '';" | Out-Null
    Invoke-D1Query $Binding "INSERT INTO search_fts(search_fts) VALUES ('rebuild');" | Out-Null
  }

  $restoreTriggerPath = Join-Path $runDirectory "$Kind.restore-triggers.sql"
  $triggerSql = ($TriggerRows | ForEach-Object { "$([string]$_.sql);" }) -join "`n"
  [System.IO.File]::WriteAllText($restoreTriggerPath, $triggerSql, $utf8WithoutBom)
  Invoke-Wrangler @(
    'd1', 'execute', $Binding,
    '--local',
    '--persist-to', $stateDirectory,
    '--config', $configPath,
    '--file', $restoreTriggerPath,
    '--yes'
  ) | Out-Null
}

function Invoke-LocalDatabaseVerifier {
  param([string]$Kind)

  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $node --no-warnings $localVerifier $stateDirectory $Kind 2>&1 | ForEach-Object { "$_" })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  $json = ($output -join "`n").Trim()
  if ($exitCode -ne 0) {
    throw "Local SQLite verification failed for $Kind`n$json"
  }
  try {
    return $json | ConvertFrom-Json
  } catch {
    throw "Local SQLite verifier returned invalid JSON for $Kind`n$json"
  }
}

function Test-RestoredDatabase {
  param([System.Collections.IDictionary]$Definition)

  $kind = [string]$Definition.kind
  $binding = [string]$Definition.binding
  $archiveName = "$kind.sql.gz"
  $archivePath = Join-Path $backupRoot $archiveName
  if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    throw "Backup archive is missing: $archiveName"
  }
  if (-not $script:checksums.ContainsKey($archiveName)) {
    throw "Checksum manifest has no entry for $archiveName"
  }

  $expectedSha256 = [string]$script:checksums[$archiveName]
  $actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "SHA-256 mismatch for $archiveName"
  }

  $sqlPath = Join-Path $runDirectory "$kind.sql"
  $uncompressedBytes = Expand-GzipBounded $archivePath $sqlPath $MaxUncompressedBytes
  if ($uncompressedBytes -le 0) {
    throw "Backup archive is empty after decompression: $archiveName"
  }

  $triggerRows = @(Initialize-IsolatedSchema $binding $kind)
  Invoke-Wrangler @(
    'd1', 'execute', $binding,
    '--local',
    '--persist-to', $stateDirectory,
    '--config', $configPath,
    '--file', $sqlPath,
    '--yes'
  ) | Out-Null
  Restore-IsolatedTriggersAndSearch $binding $kind $triggerRows

  # D1 deliberately blocks integrity_check through its query API. The verifier
  # opens only Wrangler's isolated local SQLite file in read-only mode so both
  # integrity_check and foreign_key_check can still be executed exactly.
  $verification = Invoke-LocalDatabaseVerifier $kind
  $databaseReport = [ordered]@{
    kind = $kind
    isolatedDatabaseName = [string]$Definition.databaseName
    archive = $archiveName
    sha256 = $actualSha256
    uncompressedBytes = $uncompressedBytes
    databaseFile = [string]$verification.databaseFile
    foreignKeyViolations = [long]$verification.foreignKeyViolations
    integrityCheck = [string]$verification.integrityCheck
    coreTables = @($verification.coreTables)
    triggerCount = [long]$verification.triggerCount
  }

  if ($kind -eq 'catalog') {
    $databaseReport['currentRelease'] = [ordered]@{
      id = [string]$verification.currentRelease.id
      status = [string]$verification.currentRelease.status
      dataDate = [string]$verification.currentRelease.dataDate
      generatedAt = [string]$verification.currentRelease.generatedAt
      institutions = [long]$verification.currentRelease.institutions
      programs = [long]$verification.currentRelease.programs
      programCycles = [long]$verification.currentRelease.programCycles
      scholarships = [long]$verification.currentRelease.scholarships
    }
    $databaseReport['search'] = [ordered]@{
      documents = [long]$verification.search.documents
      indexedDocuments = [long]$verification.search.indexedDocuments
    }
  } else {
    $databaseReport['runtimeCounts'] = [ordered]@{
      ingestionSources = [long]$verification.runtimeCounts.ingestionSources
      ingestionJobs = [long]$verification.runtimeCounts.ingestionJobs
      ingestionSnapshots = [long]$verification.runtimeCounts.ingestionSnapshots
      ingestionCandidates = [long]$verification.runtimeCounts.ingestionCandidates
    }
  }

  return $databaseReport
}

$startedAt = (Get-Date).ToUniversalTime()
$report = [ordered]@{
  version = 1
  runId = $runId
  mode = 'local-isolated'
  status = 'running'
  startedAt = $startedAt.ToString('o')
  completedAt = $null
  elapsedSeconds = $null
  databases = @()
  error = $null
}
$failure = $null

try {
  $checksumsPath = Join-Path $backupRoot 'backup-sha256.txt'
  $script:checksums = Read-ChecksumManifest $checksumsPath
  foreach ($definition in $databaseDefinitions) {
    $report.databases += @(Test-RestoredDatabase $definition)
  }
  $report.status = 'passed'
} catch {
  $failure = $_
  $report.status = 'failed'
  $report.error = $_.Exception.Message
} finally {
  $completedAt = (Get-Date).ToUniversalTime()
  $report.completedAt = $completedAt.ToString('o')
  $report.elapsedSeconds = [math]::Round(($completedAt - $startedAt).TotalSeconds, 3)

  if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
    $reportPathFull = [System.IO.Path]::GetFullPath($ReportPath)
    $reportDirectory = [System.IO.Path]::GetDirectoryName($reportPathFull)
    if (-not [string]::IsNullOrWhiteSpace($reportDirectory)) {
      [System.IO.Directory]::CreateDirectory($reportDirectory) | Out-Null
    }
    [System.IO.File]::WriteAllText(
      $reportPathFull,
      ($report | ConvertTo-Json -Depth 12),
      $utf8WithoutBom
    )
  }

  if (-not $KeepWorkDirectory -and (Test-Path -LiteralPath $runDirectory)) {
    $resolvedRunDirectory = (Resolve-Path -LiteralPath $runDirectory).Path
    if (-not $resolvedRunDirectory.StartsWith($workRootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not ([System.IO.Path]::GetFileName($resolvedRunDirectory)).StartsWith('drill-', [System.StringComparison]::Ordinal)) {
      throw 'Refusing to remove an unverified restore drill directory.'
    }
    Remove-Item -LiteralPath $resolvedRunDirectory -Recurse -Force
  }
}

if ($null -ne $failure) {
  throw "Restore drill failed: $($failure.Exception.Message)"
}

Write-Output ($report | ConvertTo-Json -Depth 12)
