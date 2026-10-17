import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { DataBundle } from '@/lib/data/types'
import { buildUniversityMaintenancePlan, maintenanceDigest } from '@/lib/maintenance/university-coverage'
import { ingestUniversityMaintenanceLedger, parseUniversityLedgerArguments, syncUniversityMaintenanceDb } from '../../scripts/automation/sync-university-maintenance-db'

const roots: string[] = [], databases: DatabaseSync[] = [], TODAY = '2026-10-17'
const audit = { sourceIds: ['official'], verifiedAt: '2026-10-15', reviewAfter: '2026-11-13', status: 'verified' as const }
function fixture(): DataBundle {
  const school = { ...audit, id: 'uni-a', slug: 'uni-a', name: { en: 'University' }, cityId: 'city', region: 'south' as const, officialUrl: 'https://university.test/', admissionsUrl: 'https://university.test/admissions', summary: null, featured: false }
  return { sources: [{ id: 'official', url: 'https://university.test/catalog', title: 'Catalogue', publisher: 'University', kind: 'admissions', language: 'en', official: true, accessedAt: '2026-10-15' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: 'south', coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [school, { ...school, id: 'uni-b', slug: 'uni-b' }, { ...school, id: 'uni-hidden', slug: 'uni-hidden', reviewAfter: '2026-10-16' }], programs: [], admissionCycles: [], scholarships: [] }
}
const plan = () => buildUniversityMaintenancePlan(fixture(), { today: TODAY, limit: 2 })
const database = () => { const db = new DatabaseSync(':memory:'); databases.push(db); return db }
const tally = (db: DatabaseSync) => ['maintenance_runs', 'university_coverage', 'coverage_history', 'source_observations', 'university_attempts'].map(table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n)
async function evidence() {
  const root = await mkdtemp(join(tmpdir(), 'maintenance-db-')); roots.push(root)
  const bytes = Buffer.from('<h1>Private original source bytes remain outside SQLite</h1>'), rawFile = 'raw/source.bin'
  await mkdir(join(root, 'raw')); await writeFile(join(root, rawFile), bytes)
  const p = plan(), report = { format: 'studyinchina.university-source-capture', version: 1, planSha256: p.planSha256, today: TODAY,
    policy: { maximumUrlsPerUniversity: 2, maximumConcurrentSchools: 2, minimumDomainIntervalMs: 5000, maximumResponseBytes: 2 * 1024 * 1024, requestDeadlineMs: 20_000, paidCalls: 0, canonicalWrites: 0, factsVerified: 0, publicationPerformed: false },
    results: p.selectedUniversityIds.map(universityId => ({ universityId, processingStatus: 'captured_pending_review', attemptedAt: '2026-10-17T01:00:01Z', sources: [{ requestedUrl: 'https://university.test/admissions', finalUrl: 'https://university.test/admissions', startedAt: '2026-10-17T01:00:00Z', completedAt: '2026-10-17T01:00:01Z', httpStatus: 200, outcome: 'captured', errorCode: null, rawSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, rawFile, contentType: 'text/html', completeBody: true, candidates: [] }] })) }
  return { root, p, report, options: { evidence: { root, directory: root }, now: '2026-10-17T02:00:00Z' } }
}
afterEach(async () => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('queryable university maintenance SQLite ledger', () => {
  it('mirrors every visible and hidden school, and idempotently ingests exact source evidence', async () => {
    const db = database(), e = await evidence()
    await ingestUniversityMaintenanceLedger(db, e.p)
    await ingestUniversityMaintenanceLedger(db, e.p, e.report, e.options)
    const before = tally(db)
    await ingestUniversityMaintenanceLedger(db, e.p, e.report, e.options)
    await ingestUniversityMaintenanceLedger(db, e.p)
    expect(tally(db)).toEqual(before)
    expect(before).toEqual([1, 3, 3, 2, 2])
    expect(db.prepare('SELECT status FROM maintenance_runs').get()?.status).toBe('captured_pending_review')
    expect(db.prepare("SELECT active,raw_program_count,current_program_count FROM university_coverage WHERE university_id='uni-hidden'").get()).toMatchObject({ active: 0, raw_program_count: null, current_program_count: 0 })
    expect(JSON.stringify(db.prepare('SELECT * FROM source_observations').all())).not.toContain('Private original source bytes')
  })
  it('rejects plan/report scope and raw evidence changes without writing rows', async () => {
    const db = database(), e = await evidence(); await ingestUniversityMaintenanceLedger(db, e.p)
    const before = tally(db)
    await expect(ingestUniversityMaintenanceLedger(db, { ...e.p, today: '2026-10-18' })).rejects.toThrow('SHA-256')
    await expect(ingestUniversityMaintenanceLedger(db, e.p, { ...e.report, planSha256: '0'.repeat(64) }, e.options)).rejects.toThrow('exact plan')
    const outside = structuredClone(e.report); outside.results[0].universityId = 'uni-hidden'
    await expect(ingestUniversityMaintenanceLedger(db, e.p, outside, e.options)).rejects.toThrow('scope')
    await writeFile(join(e.root, 'raw/source.bin'), 'changed')
    await expect(ingestUniversityMaintenanceLedger(db, e.p, e.report, e.options)).rejects.toThrow('hash or size')
    expect(tally(db)).toEqual(before)
  })
  it('rolls back the entire new snapshot if an insert fails midway', async () => {
    const db = database(), data = fixture(); await ingestUniversityMaintenanceLedger(db, plan())
    db.exec("CREATE TRIGGER reject_new_school BEFORE INSERT ON university_coverage WHEN NEW.university_id='uni-new' BEGIN SELECT RAISE(ABORT,'test_transaction_failure'); END;")
    data.universities.push({ ...data.universities[0], id: 'uni-new', slug: 'uni-new' })
    const before = tally(db)
    await expect(ingestUniversityMaintenanceLedger(db, buildUniversityMaintenancePlan(data, { today: '2026-10-18' }))).rejects.toThrow('test_transaction_failure')
    expect(tally(db)).toEqual(before)
    expect(db.prepare('SELECT COUNT(*) AS n FROM university_coverage WHERE active=1').get()?.n).toBe(2)
  })
  it('reconciles visibility without deleting history, and keeps older snapshots from replacing the head', async () => {
    const db = database(), data = fixture(), first = plan(); await ingestUniversityMaintenanceLedger(db, first)
    data.universities = data.universities.filter(row => row.id !== 'uni-b')
    await ingestUniversityMaintenanceLedger(db, buildUniversityMaintenancePlan(data, { today: '2026-10-18' }))
    expect(db.prepare("SELECT active,visibility FROM university_coverage WHERE university_id='uni-b'").get()).toMatchObject({ active: 0, visibility: 'removed' })
    const summary = await ingestUniversityMaintenanceLedger(db, first)
    expect(summary.coverageHeadUpdated).toBe(false)
    expect(db.prepare("SELECT active FROM university_coverage WHERE university_id='uni-b'").get()?.active).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM coverage_history').get()?.n).toBe(5)
  })
  it('rejects immutable report replacement and future schema versions', async () => {
    const db = database(), e = await evidence(); await ingestUniversityMaintenanceLedger(db, e.p, e.report, e.options)
    const changed = structuredClone(e.report); changed.results[0].attemptedAt = '2026-10-17T02:00:00Z'
    await expect(ingestUniversityMaintenanceLedger(db, e.p, changed, e.options)).rejects.toThrow('immutable report')
    db.exec('PRAGMA user_version=2')
    await expect(ingestUniversityMaintenanceLedger(db, e.p)).rejects.toThrow('schema version')
  })
  it('validates circular source offsets and preserves separate attempt completion time', async () => {
    const db = database(), e = await evidence()
    const rotated = { ...e.p, universities: e.p.universities.map(school => ({ ...school,
      scheduling: { ...school.scheduling, sourceOffset: 2 },
      official: { ...school.official, sources: [...school.official.sources, { id: 'extra', url: 'https://university.test/extra-programmes', checkedAt: TODAY }, { id: 'extra-two', url: 'https://university.test/extra-admissions', checkedAt: TODAY }] },
    })) }
    rotated.planSha256 = maintenanceDigest(Object.fromEntries(Object.entries(rotated).filter(([key]) => key !== 'planSha256')))
    const stale = { ...e.report, planSha256: rotated.planSha256 }
    await expect(ingestUniversityMaintenanceLedger(db, rotated, stale, e.options)).rejects.toThrow('capture scope')
    const report = { ...stale, results: stale.results.map(school => ({ ...school, completedAt: '2026-10-18T00:00:00Z',
      sources: school.sources.map(source => ({ ...source, requestedUrl: 'https://university.test/extra-programmes', finalUrl: 'https://university.test/extra-programmes' })),
    })) }
    await ingestUniversityMaintenanceLedger(db, rotated, report, e.options)
    expect(db.prepare('SELECT completed_at FROM university_attempts LIMIT 1').get()?.completed_at).toBe('2026-10-18T00:00:00Z')
  })
  it('closes a standalone non-WAL database and can reopen its durable query data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maintenance-db-cli-')); roots.push(root); await mkdir(join(root, '.tmp'), { recursive: true })
    await writeFile(join(root, '.tmp/plan.json'), JSON.stringify(plan()))
    const options = parseUniversityLedgerArguments(['--plan', '.tmp/plan.json'], root)
    expect(await syncUniversityMaintenanceDb(options)).toMatchObject({ counts: { active_map_universities: 2, hidden_universities: 1 } })
    const reopened = new DatabaseSync(options.database, { readOnly: true })
    try { expect(reopened.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('delete'); expect(reopened.prepare('SELECT COUNT(*) AS n FROM university_coverage').get()?.n).toBe(3) } finally { reopened.close() }
    await expect(readFile(`${options.database}-wal`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not accept a rehashed plan with duplicate scope or credential-bearing URLs', async () => {
    const db = database(), invalid = plan(); invalid.universities.push(invalid.universities[0]); const body = Object.fromEntries(Object.entries(invalid).filter(([key]) => key !== 'planSha256')); invalid.planSha256 = maintenanceDigest(body)
    await expect(ingestUniversityMaintenanceLedger(db, invalid)).rejects.toThrow('scope')
    const credentials = plan(); credentials.universities[0].official.admissions = 'https://university.test/admissions?token=private'; const credentialBody = Object.fromEntries(Object.entries(credentials).filter(([key]) => key !== 'planSha256')); credentials.planSha256 = maintenanceDigest(credentialBody)
    await expect(ingestUniversityMaintenanceLedger(db, credentials)).rejects.toThrow('Credential-bearing')
  })
  it.each([[], ['--plan'], ['--plan', '../outside.json'], ['--plan', '.tmp/p.json', '--database', 'content/data/catalog.sqlite'], ['--plan', '.tmp/p.json', '--unknown', 'x']])('rejects unsafe CLI arguments %j', (...args) => expect(() => parseUniversityLedgerArguments(args)).toThrow())
})
