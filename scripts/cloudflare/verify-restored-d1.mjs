import { readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

const [stateDirectory, kind] = process.argv.slice(2)

if (!stateDirectory || !['catalog', 'pipeline'].includes(kind)) {
  throw new Error('Usage: node verify-restored-d1.mjs <local-state-directory> <catalog|pipeline>')
}

function sqliteFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sqliteFiles(path))
    if (entry.isFile() && entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') {
      files.push(path)
    }
  }
  return files
}

const requiredTables =
  kind === 'catalog'
    ? [
        'catalog_releases',
        'release_pointer',
        'catalog_records',
        'institutions',
        'programs',
        'program_cycles',
        'scholarships',
      ]
    : [
        'records',
        'source_documents',
        'claims',
        'ingestion_sources',
        'ingestion_jobs',
        'ingestion_snapshots',
        'ingestion_candidates',
        'maintenance_control',
        'maintenance_schools',
        'maintenance_sources',
        'maintenance_source_schools',
        'maintenance_jobs',
        'maintenance_observations',
        'maintenance_robots',
        'maintenance_document_derivatives',
        'maintenance_document_failures',
        'maintenance_legacy_guards',
        'maintenance_model_attempts',
        'maintenance_proposals',
        'maintenance_record_targets',
        'maintenance_target_sources',
        'maintenance_target_refreshes',
        'maintenance_exports',
        'maintenance_events',
        'maintenance_transaction_guards',
      ]

const markerTable = requiredTables[0]
const matches = []
for (const path of sqliteFiles(resolve(stateDirectory))) {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const marker = database
      .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(markerTable)
    if (marker.count === 1) matches.push({ path, database })
    else database.close()
  } catch (error) {
    database.close()
    throw error
  }
}

if (matches.length !== 1) {
  for (const match of matches) match.database.close()
  throw new Error(`Expected one restored ${kind} SQLite file, found ${matches.length}`)
}

const [{ path, database }] = matches
try {
  const tablePlaceholders = requiredTables.map(() => '?').join(', ')
  const actualTables = database
    .prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${tablePlaceholders}) ORDER BY name`,
    )
    .all(...requiredTables)
    .map((row) => row.name)
  const missingTables = requiredTables.filter((table) => !actualTables.includes(table))
  if (missingTables.length > 0) {
    throw new Error(`${kind} restore is missing core table(s): ${missingTables.join(', ')}`)
  }

  const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyViolations.length > 0) {
    throw new Error(`${kind} restore has ${foreignKeyViolations.length} foreign-key violation(s)`)
  }

  const integrityRows = database.prepare('PRAGMA integrity_check').all()
  const integrityMessages = integrityRows.flatMap((row) => Object.values(row).map(String))
  if (integrityMessages.length !== 1 || integrityMessages[0] !== 'ok') {
    throw new Error(`${kind} restore failed integrity_check: ${integrityMessages.join('; ')}`)
  }

  const { count: triggerCount } = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger'")
    .get()
  if (triggerCount < 1) throw new Error(`${kind} validation triggers were not restored`)

  const report = {
    databaseFile: basename(path),
    foreignKeyViolations: 0,
    integrityCheck: 'ok',
    coreTables: requiredTables,
    triggerCount,
  }

  if (kind === 'catalog') {
    const releases = database
      .prepare(`
        SELECT
          rp.current_release_id AS release_id,
          cr.release_status,
          cr.data_date,
          cr.generated_at,
          cr.counts_json,
          (SELECT COUNT(*) FROM institutions WHERE release_id = rp.current_release_id) AS institutions,
          (SELECT COUNT(*) FROM programs WHERE release_id = rp.current_release_id) AS programs,
          (SELECT COUNT(*) FROM program_cycles WHERE release_id = rp.current_release_id) AS program_cycles,
          (SELECT COUNT(*) FROM scholarships WHERE release_id = rp.current_release_id) AS scholarships
        FROM release_pointer rp
        JOIN catalog_releases cr ON cr.release_id = rp.current_release_id
        WHERE rp.singleton_id = 1
      `)
      .all()
    if (releases.length !== 1) {
      throw new Error('Catalog restore does not have exactly one current release pointer')
    }
    const release = releases[0]
    if (release.release_status !== 'active') throw new Error('Catalog current release is not active')

    let declaredCounts
    try {
      declaredCounts = JSON.parse(release.counts_json)
    } catch {
      throw new Error('Catalog current release has invalid counts_json')
    }
    const countContracts = [
      ['institutions', 'universities'],
      ['programs', 'programs'],
      ['program_cycles', 'admissionCycles'],
      ['scholarships', 'scholarships'],
    ]
    for (const [actualName, declaredName] of countContracts) {
      const actual = Number(release[actualName])
      const declared = Number(declaredCounts[declaredName])
      if (!Number.isSafeInteger(declared) || declared < 0) {
        throw new Error(`Catalog current release has invalid declared ${declaredName} count`)
      }
      if (actual !== declared) {
        throw new Error(
          `Catalog current release ${actualName} count mismatch: expected ${declared}, restored ${actual}`,
        )
      }
    }
    for (const countName of ['institutions', 'programs', 'scholarships']) {
      if (release[countName] <= 0) {
        throw new Error(`Catalog current release has no ${countName} rows`)
      }
    }

    const fts = database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM search_documents) AS documents,
          (SELECT COUNT(*) FROM search_fts) AS indexed_documents
      `)
      .get()
    if (fts.documents !== fts.indexed_documents) {
      throw new Error(
        `Catalog FTS row count mismatch: ${fts.documents} documents, ${fts.indexed_documents} indexed`,
      )
    }

    report.currentRelease = {
      id: release.release_id,
      status: release.release_status,
      dataDate: release.data_date,
      generatedAt: release.generated_at,
      institutions: release.institutions,
      programs: release.programs,
      programCycles: release.program_cycles,
      scholarships: release.scholarships,
    }
    report.search = {
      documents: fts.documents,
      indexedDocuments: fts.indexed_documents,
    }
  } else {
    const counts = database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM ingestion_sources) AS ingestion_sources,
          (SELECT COUNT(*) FROM ingestion_jobs) AS ingestion_jobs,
          (SELECT COUNT(*) FROM ingestion_snapshots) AS ingestion_snapshots,
          (SELECT COUNT(*) FROM ingestion_candidates) AS ingestion_candidates
      `)
      .get()
    report.runtimeCounts = {
      ingestionSources: counts.ingestion_sources,
      ingestionJobs: counts.ingestion_jobs,
      ingestionSnapshots: counts.ingestion_snapshots,
      ingestionCandidates: counts.ingestion_candidates,
    }
    const controls = database.prepare('SELECT * FROM maintenance_control').all()
    if (!controls.length) {
      const hasState = requiredTables.filter(table => table.startsWith('maintenance_'))
        .some(table => database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count > 0)
      if (hasState) throw new Error('Pipeline maintenance state exists without its control checkpoint')
      report.maintenance = { state: 'not_initialized', resumable: false, checkpointValidated: false,
        evidenceObjectsVerified: false, durableObjectReservationsVerified: false }
    } else {
      if (controls.length !== 1 || controls[0].singleton !== 1) throw new Error('Pipeline maintenance restore has no unique control checkpoint')
      const control = controls[0], hash = /^[a-f0-9]{64}$/u
      for (const field of ['scope_sha256', 'input_catalog_sha256', 'seed_sha256', 'legacy_guard_sha256']) {
        if (!hash.test(control[field])) throw new Error(`Pipeline maintenance control has invalid ${field}`)
      }
      const schools = database.prepare('SELECT university_id,scope_sha256 FROM maintenance_schools').all()
      if (control.seed_complete && (schools.length !== 272 || schools.some(row => row.scope_sha256 !== control.scope_sha256)
          || control.seed_offset !== control.seed_total)) throw new Error('Pipeline completed maintenance seed is incomplete or has a different scope')
      let canary
      try { canary = JSON.parse(control.canary_json) } catch { throw new Error('Pipeline maintenance canary is invalid JSON') }
      if (!Array.isArray(canary) || new Set(canary).size !== canary.length || canary.some(id => !schools.some(school => school.university_id === id))) {
        throw new Error('Pipeline maintenance canary is outside the restored school scope')
      }
      const invalidJobs = database.prepare("SELECT COUNT(*) count FROM maintenance_jobs WHERE (status='running' AND (lease_token IS NULL OR lease_until IS NULL)) OR (status<>'running' AND (lease_token IS NOT NULL OR lease_until IS NOT NULL))").get().count
      if (invalidJobs) throw new Error('Pipeline maintenance jobs have inconsistent lease state')
      const invalidAttempts = database.prepare("SELECT COUNT(*) count FROM maintenance_model_attempts WHERE status='completed' AND (output_key IS NULL OR output_sha256 IS NULL)").get().count
      if (invalidAttempts) throw new Error('Pipeline completed model attempts have missing immutable artifact references')
      if (database.prepare('SELECT COUNT(*) count FROM maintenance_transaction_guards').get().count) throw new Error('Pipeline maintenance transaction fences were not cleanly committed')
      for (const row of database.prepare("SELECT * FROM maintenance_exports WHERE status IN('applied','published','rejected')").all()) {
        let ack
        try { ack = JSON.parse(row.acknowledgement_json) } catch { throw new Error('Pipeline maintenance publication acknowledgement is invalid JSON') }
        const checksum = createHash('sha256').update(row.acknowledgement_json ?? '').digest('hex')
        if (!ack || checksum !== row.acknowledgement_sha256 || ack.batchId !== row.batch_id || ack.outcome !== row.status
            || !/^([a-f0-9]{40}|[a-f0-9]{64})$/u.test(ack.sourceCommit ?? '') || !hash.test(ack.receiptSha256 ?? '')
            || !hash.test(ack.newInputCatalogSha256 ?? '') || !Array.isArray(ack.acceptedProposalIds) || !Array.isArray(ack.heldProposalIds)
            || row.status === 'published' && (!/^dpl_[a-zA-Z0-9]{1,100}$/u.test(ack.deploymentId ?? '') || !hash.test(ack.stableProofSha256 ?? ''))) {
          throw new Error('Pipeline maintenance publication acknowledgement failed its checksum or publication contract')
        }
      }
      report.maintenance = {
        state: 'checkpoint_validated', resumable: false, checkpointValidated: true,
        seedComplete: Boolean(control.seed_complete), schools: schools.length,
        jobs: database.prepare('SELECT status,COUNT(*) count FROM maintenance_jobs GROUP BY status').all(),
        modelAttempts: database.prepare('SELECT status,COUNT(*) count FROM maintenance_model_attempts GROUP BY status').all(),
        exports: database.prepare('SELECT status,COUNT(*) count FROM maintenance_exports GROUP BY status').all(),
        legacyGuards: database.prepare('SELECT COUNT(*) count FROM maintenance_legacy_guards').get().count,
        evidenceObjectsVerified: false, durableObjectReservationsVerified: false,
        safety: 'Unknown and send_started reservations are preserved; do not replay them after restore.',
      }
    }
  }

  process.stdout.write(JSON.stringify(report))
} finally {
  database.close()
}
