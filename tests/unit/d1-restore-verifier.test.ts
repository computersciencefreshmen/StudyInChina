// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { unstable_splitSqlQuery } from 'wrangler'
import { prepareAccountMigrationD1, tableLogicalSummaries, trustedSchema } from '../../scripts/cloudflare/prepare-account-migration-d1.mjs'

const verifier = join(process.cwd(), 'scripts/cloudflare/verify-restored-d1.mjs')
// The shared DOM cleanup hook runs for every suite; this native SQLite suite
// has no DOM. Supply only the cleanup capability rather than a browser runtime.
vi.stubGlobal('window', { localStorage: { clear() {} } })
afterAll(() => vi.unstubAllGlobals())
const roots: string[] = [], now = '2026-11-13T00:00:00.000Z', hash = 'a'.repeat(64)
const scope = (count: number) => JSON.parse(readFileSync(`content/maintenance/scope-${count}.v${count === 272 ? 1 : 2}.json`, 'utf8'))
function fixture(kind: 'catalog' | 'pipeline') {
  const root = mkdtempSync(join(tmpdir(), 'studyinchina-d1-migration-')); roots.push(root)
  const db = new DatabaseSync(join(root, `${kind}.sqlite`)), trusted = trustedSchema(kind)
  for (const migration of trusted.migrations) db.exec(migration.sql)
  trusted.database.close()
  return { root, db, trusted }
}
function withoutTriggers(f: ReturnType<typeof fixture>, insert: () => void) {
  for (const trigger of f.trusted.triggers) f.db.exec(`DROP TRIGGER "${trigger.name}"`)
  f.db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=TRUE;'); insert(); f.db.exec('COMMIT;')
  for (const trigger of f.trusted.triggers) f.db.exec(trigger.sql)
  if (f.trusted.tables.includes('search_documents')) f.db.exec("INSERT INTO search_fts(search_fts) VALUES('rebuild')")
}
function catalogFixture(declaredCycles = 0) {
  const f = fixture('catalog')
  withoutTriggers(f, () => {
    f.db.prepare(`INSERT INTO catalog_releases(release_id,data_version,schema_version,release_status,data_date,generated_at,source_pipeline_run_id,content_sha256,counts_json,activated_at)
      VALUES('release-1',1,1,'active','2026-11-13',?,'original-run',?,?,?)`).run(now, hash,
      JSON.stringify({ sources: 0, cities: 1, universities: 1, programs: 1, admissionCycles: declaredCycles, scholarships: 1 }), now)
    for (const [id, kind] of [['city', 'location'], ['school', 'organization'], ['program', 'program'], ['award', 'scholarship']]) {
      f.db.prepare("INSERT INTO catalog_records(release_id,record_id,record_kind,gate_status,content_sha256) VALUES('release-1',?,?,'withheld',?)").run(id, kind, hash)
    }
    f.db.exec(`INSERT INTO locations(release_id,location_id,location_type) VALUES('release-1','city','city');
      INSERT INTO organizations VALUES('release-1','school','university','https://school.edu.cn');
      INSERT INTO institutions VALUES('release-1','school','city','comprehensive','https://school.edu.cn/apply',0);
      INSERT INTO programs(release_id,program_id,institution_id,program_type,degree_level,attendance_mode,delivery_mode,official_url) VALUES('release-1','program','school','degree','bachelor','full_time','on_campus','https://school.edu.cn/program');
      INSERT INTO scholarships VALUES('release-1','award','school','university','https://school.edu.cn/award');
      UPDATE release_pointer SET current_release_id='release-1',updated_by='original-operator';`)
    f.db.prepare("INSERT INTO search_documents(release_id,record_id,locale,record_kind,title,body,filter_text) VALUES('release-1','program','en','program',?,?,?)")
      .run('Computing', 'Original body; DROP TABLE records; 中文', 'unchanged filter')
  })
  f.db.close(); return f
}
function pipelineFixture(count = 272) {
  const f = fixture('pipeline'), registry = scope(count)
  f.db.prepare('INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,seed_complete,targets_complete,revision,updated_at) VALUES(1,?,?,?,?,1,1,8,?)')
    .run(registry.sha256, hash, hash, hash, now)
  for (const school of registry.schools) f.db.prepare("INSERT INTO maintenance_schools VALUES(?,'{}','{}',?,NULL)").run(school.universityId, registry.sha256)
  f.db.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES('source','https://test.edu.cn','[\"test.edu.cn\"]','current_guide',1,168,?)").run(now)
  f.db.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at) VALUES('job','source','maintain','unknown',?,?,?)").run(now, now, now)
  f.db.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,'attempt','source',?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(hash, hash, hash, now)
  const ack = JSON.stringify({ batchId: 'published-batch', outcome: 'published', sourceCommit: 'b'.repeat(40), receiptSha256: hash,
    newInputCatalogSha256: hash, acceptedProposalIds: ['proposal'], heldProposalIds: [], deploymentId: 'dpl_verified', stableProofSha256: hash })
  f.db.prepare("INSERT INTO maintenance_exports VALUES('published-batch',?,?,?,?,?,'published',?,?)")
    .run(hash, registry.sha256, 'maintenance/exports/proof.json', hash, now, createHash('sha256').update(ack).digest('hex'), ack)
  f.db.close(); return f
}
function runVerifier(root: string, kind = 'pipeline') {
  const env = { ...process.env }
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_BACKUP_TOKEN', 'CLOUDFLARE_D1_RESTORE_TOKEN']) delete env[key]
  return spawnSync(process.execPath, ['--no-warnings', verifier, root, kind], { encoding: 'utf8', env })
}
function mutate(f: ReturnType<typeof fixture>, fn: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(join(f.root, f.trusted.tables.includes('records') ? 'pipeline.sqlite' : 'catalog.sqlite'))
  try { fn(db) } finally { db.close() }
}
function dump(f: ReturnType<typeof fixture>, suffix = '') {
  const path = join(f.root, 'data.sql'), statements = ['PRAGMA defer_foreign_keys=TRUE;']
  mutate(f, db => {
    for (const table of f.trusted.tables) {
      const columns = f.trusted.columns[table].filter(column => !column.hidden).map(column => column.name)
      const sql = db.prepare(`SELECT * FROM "${table}"`); sql.setReadBigInts(true)
      for (const row of sql.iterate()) {
        const values = columns.map(column => row[column]).map(value => value === null ? 'NULL' : typeof value === 'string'
          ? `'${value.replaceAll("'", "''")}'` : typeof value === 'bigint' ? value.toString() : String(value))
        statements.push(`INSERT INTO "${table}"(${columns.map(column => `"${column}"`).join(',')}) VALUES(${values.join(',')});`)
      }
    }
  })
  writeFileSync(path, statements.join('\n') + suffix); return path
}
// D1 can commit separate import chunks. A pragma in one file cannot defer
// a later chunk's constraints, so deliberately enforce immediate FKs for
// every generated statement instead of hiding ordering bugs in one transaction.
function executeIndependent(database: DatabaseSync, sql: string) {
  for (const statement of unstable_splitSqlQuery(sql)) {
    database.exec('PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=FALSE;')
    database.exec(statement)
  }
}
function executeDataPlan(database: DatabaseSync, output: string, take = Infinity) {
  const sql = unstable_splitSqlQuery(readFileSync(join(output, '03-data.sql'), 'utf8')).filter(statement => /^INSERT\s/iu.test(statement.trim()))
  const bound = readFileSync(join(output, '03-data-bindings.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const plan = readFileSync(join(output, '03-data-plan.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  for (const entry of plan.slice(0, take)) {
    database.exec('PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=FALSE;')
    if (entry.lane === 'sql') database.exec(sql[entry.sqlStatement - 1])
    else {
      const row = bound[entry.boundLine - 1]
      database.prepare(row.sql).run(...row.params.map(([type, value]: [string, string?]) => type === 'null' ? null : type === 'blob' ? Buffer.from(value!, 'hex') : value!))
    }
  }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('complete D1 restore and account migration', () => {
  it.each([272, 295])('recognizes exact versioned %i-school scope and preserves revision 8, unknown reservations and receipts', count => {
    const f = pipelineFixture(count), result = runVerifier(f.root)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).maintenance).toMatchObject({ seedComplete: true, schools: count, expectedSchoolCount: count,
      scopeRegistrySha256: scope(count).sha256, jobs: [{ status: 'unknown', count: 1 }], modelAttempts: [{ status: 'unknown', count: 1 }],
      exports: [{ status: 'published', count: 1 }], resumable: false, evidenceObjectsVerified: false, durableObjectReservationsVerified: false })
    mutate(f, db => expect(db.prepare('SELECT revision FROM maintenance_control').get()?.revision).toBe(8))
    expect(JSON.parse(result.stdout).logicalTables).toHaveLength(106)
  })
  it('accepts a fully migrated empty maintenance subsystem without claiming execution recovery', () => {
    const f = fixture('pipeline'); f.db.close()
    const result = runVerifier(f.root); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).maintenance).toMatchObject({ state: 'not_initialized', resumable: false })
  })
  it.each(['missing-table', 'missing-index', 'missing-trigger', 'extra-trigger', 'wrong-school', 'unknown-scope', 'bad-ack', 'orphan'] as const)('rejects %s instead of accepting a partial migration', mode => {
    const f = pipelineFixture()
    mutate(f, db => {
      if (mode === 'missing-table') db.exec('DROP TABLE maintenance_scope_upgrades')
      if (mode === 'missing-index') db.exec('DROP INDEX idx_ingestion_sources_school_source')
      if (mode === 'missing-trigger') db.exec('DROP TRIGGER trg_claim_acceptance_requires_official_evidence')
      if (mode === 'extra-trigger') db.exec("CREATE TRIGGER operator_added AFTER INSERT ON maintenance_events BEGIN UPDATE maintenance_jobs SET status='done'; END")
      if (mode === 'wrong-school') db.exec("UPDATE maintenance_schools SET university_id='substituted-school' WHERE rowid=(SELECT MIN(rowid) FROM maintenance_schools)")
      if (mode === 'unknown-scope') db.prepare('UPDATE maintenance_control SET scope_sha256=?').run(hash)
      if (mode === 'bad-ack') db.prepare('UPDATE maintenance_exports SET acknowledgement_sha256=?').run(hash)
      if (mode === 'orphan') db.exec('DELETE FROM maintenance_control')
    })
    const result = runVerifier(f.root); expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/missing core table|trusted schema object differs|untrusted schema object|different scope|scope registry|acknowledgement failed|state exists without/)
  })
  it.each([0, 1])('checks complete catalog schema and original release count contract (%i cycles)', cycles => {
    const result = runVerifier(catalogFixture(cycles).root, 'catalog')
    expect(result.status, result.stderr).toBe(cycles ? 1 : 0)
    if (!cycles) expect(JSON.parse(result.stdout)).toMatchObject({ currentRelease: { id: 'release-1', institutions: 1, programs: 1, programCycles: 0, scholarships: 1 }, search: { documents: 1, indexedDocuments: 1 } })
    else expect(result.stderr).toContain('program_cycles count mismatch')
  })
  it('round-trips trusted phases without rewriting Unicode, embedded SQL text, IDs or search body', async () => {
    const f = catalogFixture(), output = join(f.root, 'prepared')
    const manifest = await prepareAccountMigrationD1({ kind: 'catalog', dataOnlyPath: dump(f), outputDirectory: output })
    expect(manifest.tables).toHaveLength(38); expect(manifest.requiresBoundData).toBe(false)
    for (const file of manifest.files) expect(createHash('sha256').update(readFileSync(join(output, file.name))).digest('hex')).toBe(file.sha256)
    const target = new DatabaseSync(':memory:')
    try {
      target.exec(readFileSync(join(output, '01-schema.sql'), 'utf8'))
      executeIndependent(target, readFileSync(join(output, '02-before-data.sql'), 'utf8')); executeDataPlan(target, output)
      executeIndependent(target, readFileSync(join(output, '04-after-data.sql'), 'utf8'))
      expect(tableLogicalSummaries(target, f.trusted.tables)).toEqual(manifest.tables)
      expect(target.prepare('SELECT body FROM search_documents').get()?.body).toBe('Original body; DROP TABLE records; 中文')
      expect(target.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(target.prepare('SELECT COUNT(*) count FROM search_fts').get()?.count).toBe(1)
    } finally { target.close() }
  })
  it('uses an explicit typed bound lane for long JSON and cannot claim SQL alone is complete', async () => {
    const f = pipelineFixture(), payload = JSON.stringify({ original: '中文'.repeat(20000), literal: "'; DROP TABLE records; --" })
    mutate(f, db => db.prepare('UPDATE maintenance_model_attempts SET quota_json=?').run(payload))
    const output = join(f.root, 'prepared'), manifest = await prepareAccountMigrationD1({ kind: 'pipeline', dataOnlyPath: dump(f), outputDirectory: output })
    expect(manifest.requiresBoundData).toBe(true); expect(manifest.boundRows).toBe(1); expect(manifest.execution.allLanesRequired).toBe(true)
    const bound = readFileSync(join(output, '03-data-bindings.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(bound[0].table).toBe('maintenance_model_attempts'); expect(bound[0].params).toContainEqual(['text', payload])
    expect(Buffer.byteLength(bound[0].sql)).toBeLessThan(90000)
    for (const statement of unstable_splitSqlQuery(readFileSync(join(output, '03-data.sql'), 'utf8'))) expect(Buffer.byteLength(statement)).toBeLessThanOrEqual(90000)
    expect(JSON.stringify(manifest)).not.toContain(payload)
    const target = new DatabaseSync(':memory:')
    try {
      target.exec(readFileSync(join(output, '01-schema.sql'), 'utf8'))
      executeIndependent(target, readFileSync(join(output, '02-before-data.sql'), 'utf8')); executeDataPlan(target, output)
      executeIndependent(target, readFileSync(join(output, '04-after-data.sql'), 'utf8'))
      expect(tableLogicalSummaries(target, f.trusted.tables)).toEqual(manifest.tables)
      expect(target.prepare('SELECT quota_json,status FROM maintenance_model_attempts').get()).toEqual({ quota_json: payload, status: 'unknown' })
    } finally { target.close() }
  })
  it('preserves a staged additive upgrade separately from the current 272-school control scope', () => {
    const f = pipelineFixture(), previous = scope(272), next = scope(295), originalIds = new Set(previous.schools.map((school: { universityId: string }) => school.universityId))
    mutate(f, db => {
      db.prepare("INSERT INTO maintenance_scope_upgrades VALUES(?,?,?,7,8,?,?,'[]',1,1,'maintenance/plan.json',?,10,3,'staged',NULL,NULL,?)").run(hash, previous.sha256, next.sha256, hash, hash, hash, now)
      for (const school of next.schools.filter((school: { universityId: string }) => !originalIds.has(school.universityId))) db.prepare("INSERT INTO maintenance_schools VALUES(?,'{}','{}',?,NULL)").run(school.universityId, next.sha256)
    })
    const result = runVerifier(f.root); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).maintenance).toMatchObject({ schools: 272, stagedSchools: 23, expectedSchoolCount: 272, resumable: false })
  })
  it('records the proven 36-table source version and initializes only the two trusted new catalog tables', async () => {
    const f = catalogFixture(), data = dump(f), initialized = ['admin_release_rollbacks', 'release_pointer_revision']
    const sql = unstable_splitSqlQuery(readFileSync(data, 'utf8')).filter(statement => !/^INSERT INTO "release_pointer_revision"/u.test(statement.trim())).join(';\n') + ';'
    writeFileSync(data, sql)
    const metadata = { format: 'studyinchina.account-migration-d1-export', version: 1, kind: 'catalog',
      tables: f.trusted.tables.filter(table => !initialized.includes(table)), bytes: Buffer.byteLength(sql), sha256: createHash('sha256').update(sql).digest('hex'), sourceWritersFrozen: false, cutoverReady: false }
    const sourceMetadataPath = join(f.root, 'export.json'); writeFileSync(sourceMetadataPath, JSON.stringify(metadata))
    const manifest = await prepareAccountMigrationD1({ kind: 'catalog', dataOnlyPath: data, sourceMetadataPath, outputDirectory: join(f.root, 'prepared') })
    expect(manifest.sourceSchema).toMatchObject({ initializedTables: initialized, sourceWritersFrozen: false, cutoverReady: false, initializedRows: 1 })
    expect(manifest.sourceSchema.tables).toHaveLength(36); expect(manifest.tables).toHaveLength(38)
    expect(manifest.rows).toBe(manifest.importRows + 1)
    expect(manifest.targetBaseline.find(table => table.table === 'release_pointer')?.ignoredMigrationClockColumns).toEqual(['updated_at'])
    const target = new DatabaseSync(':memory:'), output = join(f.root, 'prepared')
    try {
      target.exec(readFileSync(join(output, '01-schema.sql'), 'utf8'))
      executeIndependent(target, readFileSync(join(output, '02-before-data.sql'), 'utf8')); executeDataPlan(target, output)
      executeIndependent(target, readFileSync(join(output, '04-after-data.sql'), 'utf8'))
      expect(tableLogicalSummaries(target, f.trusted.tables)).toEqual(manifest.tables)
      expect(target.prepare('SELECT revision FROM release_pointer_revision').get()?.revision).toBe(0)
    } finally { target.close() }
    for (const tables of [metadata.tables.filter(table => table !== 'programs'), [...metadata.tables, 'operator_invented_table']]) {
      writeFileSync(sourceMetadataPath, JSON.stringify({ ...metadata, tables }))
      await expect(prepareAccountMigrationD1({ kind: 'catalog', dataOnlyPath: data, sourceMetadataPath, outputDirectory: join(f.root, 'rejected') })).rejects.toThrow(/metadata_invalid|schema_version_unsupported/)
    }
  })
  it('orders self-reference parents before lexical children and safely retries a partial or complete isolated target', async () => {
    const f = pipelineFixture(), output = join(f.root, 'prepared')
    mutate(f, db => {
      db.exec("INSERT INTO records(id,public_id,kind) VALUES('z-parent','pub-parent','location'),('a-child','pub-child','location'),('own','pub-own','location')")
      db.exec("INSERT INTO locations(record_id,location_type) VALUES('z-parent','country'); INSERT INTO locations(record_id,parent_location_id,location_type) VALUES('a-child','z-parent','city'),('own','own','country')")
    })
    const manifest = await prepareAccountMigrationD1({ kind: 'pipeline', dataOnlyPath: dump(f), outputDirectory: output })
    expect(manifest.execution).toMatchObject({ independentTransactionsValidated: true, independentResetValidated: true, foreignKeysPreserved: true, newTargetOnly: true })
    const target = new DatabaseSync(':memory:'), before = readFileSync(join(output, '02-before-data.sql'), 'utf8'), after = readFileSync(join(output, '04-after-data.sql'), 'utf8')
    try {
      target.exec(readFileSync(join(output, '01-schema.sql'), 'utf8'))
      executeIndependent(target, before)
      const plan = readFileSync(join(output, '03-data-plan.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
      const childOrdinal = plan.findLastIndex(row => row.table === 'locations') + 1
      executeDataPlan(target, output, childOrdinal)
      expect(target.prepare('SELECT COUNT(*) count FROM locations').get()?.count).toBe(3)
      executeIndependent(target, before)
      expect(target.prepare('SELECT COUNT(*) count FROM records').get()?.count).toBe(0)
      executeDataPlan(target, output); executeIndependent(target, after)
      expect(tableLogicalSummaries(target, f.trusted.tables)).toEqual(manifest.tables)
      expect(target.prepare('SELECT status FROM maintenance_jobs').get()?.status).toBe('unknown')
      executeIndependent(target, before); executeDataPlan(target, output); executeIndependent(target, after)
      expect(tableLogicalSummaries(target, f.trusted.tables)).toEqual(manifest.tables)
      expect(target.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { target.close() }
  })
  it('holds a genuine multi-row self-reference cycle instead of emitting a chunk-unsafe migration', async () => {
    const f = pipelineFixture(), output = join(f.root, 'rejected')
    mutate(f, db => {
      db.exec("INSERT INTO records(id,public_id,kind) VALUES('a','pub-a','location'),('b','pub-b','location'); BEGIN; PRAGMA defer_foreign_keys=TRUE; INSERT INTO locations(record_id,parent_location_id,location_type) VALUES('a','b','city'),('b','a','city'); COMMIT;")
    })
    await expect(prepareAccountMigrationD1({ kind: 'pipeline', dataOnlyPath: dump(f), outputDirectory: output })).rejects.toThrow('migration_self_reference_cycle_requires_atomic_plan:locations')
    expect(() => readFileSync(join(output, 'manifest.json'))).toThrow()
  })
  it('accepts official replace/char newline encoding and its CLI completes without a circular top-level await', () => {
    const f = pipelineFixture(), data = dump(f, `\nINSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,error_code) VALUES('linebreak','source','capture','held','${now}','${now}','${now}',replace('first\\nsecond','\\n',char(10)));`)
    const prepared = spawnSync(process.execPath, ['--no-warnings', 'scripts/cloudflare/prepare-account-migration-d1.mjs', '--kind', 'pipeline', '--data-only', data, '--output', join(f.root, 'prepared')], { encoding: 'utf8' })
    expect(prepared.status, prepared.stderr).toBe(0)
    expect(JSON.parse(prepared.stdout)).toMatchObject({ kind: 'pipeline', tables: 106, requiresBoundData: false })
    const sql = readFileSync(join(f.root, 'prepared/03-data.sql'), 'utf8')
    expect(sql).toContain("'first\nsecond'")
  })
  it.each(['DROP TABLE records;', "ATTACH DATABASE ':memory:' AS injected;", "UPDATE maintenance_jobs SET status='done';", 'BEGIN;', "INSERT INTO maintenance_events VALUES('bad','bad','bad',printf('%s','bad'));" ])('rejects dump instructions without producing an accepted manifest: %s', async statement => {
    const f = pipelineFixture(), output = join(f.root, 'rejected')
    await expect(prepareAccountMigrationD1({ kind: 'pipeline', dataOnlyPath: dump(f, '\n' + statement), outputDirectory: output })).rejects.toThrow()
    expect(() => readFileSync(join(output, 'manifest.json'))).toThrow()
  })
  it('refuses oversized values and a nonempty output directory without exposing payload or changing the source', async () => {
    const f = pipelineFixture(), output = join(f.root, 'prepared')
    mutate(f, db => db.prepare('UPDATE maintenance_model_attempts SET quota_json=?').run(JSON.stringify({ original: 'x'.repeat(2000000) })))
    await expect(prepareAccountMigrationD1({ kind: 'pipeline', dataOnlyPath: dump(f), outputDirectory: output })).rejects.toThrow(/migration_value_exceeds_limit:maintenance_model_attempts:[a-f0-9]{64}/)
    expect(() => readFileSync(join(output, 'manifest.json'))).toThrow()
    mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'operator-file'), 'preserve')
    await expect(prepareAccountMigrationD1({ kind: 'pipeline', dataOnlyPath: dump(f), outputDirectory: output })).rejects.toThrow('must_be_empty')
    expect(readFileSync(join(output, 'operator-file'), 'utf8')).toBe('preserve')
  })
})
