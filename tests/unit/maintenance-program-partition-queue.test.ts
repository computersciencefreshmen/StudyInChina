import { createHash, webcrypto } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SqliteD1 } from '../../scripts/maintenance/local-runtime'
import { canonicalJson } from '../../scripts/maintenance/contracts'
import { registerProgramPartitions, promoteProgramPartitions } from '../../workers/catalog-maintenance/src/program-partition-queue'
import type { MaintenanceEnv } from '../../workers/catalog-maintenance/src/types'

const roots: string[] = [], databases: SqliteD1[] = []
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
beforeAll(() => vi.stubGlobal('crypto', webcrypto))
afterAll(() => vi.unstubAllGlobals())
afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('maintenance-partition-queue-')) throw new Error('Unexpected cleanup target')
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'maintenance-partition-queue-')); roots.push(directory)
  const db = new SqliteD1(join(directory, 'pipeline.sqlite')); databases.push(db)
  const sourceId = hash('https://example.edu.cn/official.pdf'), rawSha256 = hash('original PDF bytes')
  const snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha256}.json`
  const context = 'Master programmes for international students. '
  const rows = ['Accounting', 'Computing', 'Physics', 'Economics', 'Mathematics']
  const text = context + rows.join('\n'), textSha = hash(text)
  const specs = rows.map((name, index) => {
    const start = text.indexOf(name), content = { kind: 'program-identity-partition-v1', fullTextSha256: textSha,
      page: 1, rowNumbers: [index + 1], contextRanges: [{ start: 0, end: context.length }], targetRanges: [{ start, end: start + name.length }] }
    return { ...content, sha256: hash(canonicalJson(content)) }
  })
  const snapshot = { version: 1, sourceId, rawSha256, rawKey: 'maintenance/raw.pdf', textKey: 'maintenance/text.txt', textSha256: textSha }
  const objects = new Map([[snapshotKey, JSON.stringify(snapshot)], ['maintenance/text.txt', text]])
  const env = { PIPELINE_DB: db, SNAPSHOTS_BUCKET: { get: async (key: string) => {
    const value = objects.get(key); return value === undefined ? null : { text: async () => value, size: new TextEncoder().encode(value).length }
  } } } as unknown as MaintenanceEnv
  db.sqlite.prepare(`INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,snapshot_key)
    VALUES(?,?,'["example.edu.cn"]','masters_catalog',1,168,?,?,?)`).run(sourceId, 'https://example.edu.cn/official.pdf', '2026-10-26T00:00:00.000Z', rawSha256, snapshotKey)
  const input = { sourceId, rawSha256, snapshotKey, specs }
  const jobs = () => db.sqlite.prepare("SELECT * FROM maintenance_jobs WHERE stage='extract' ORDER BY job_id").all()
  const legacyJob = (index: number, status: string) => db.sqlite.prepare(`INSERT INTO maintenance_jobs
    (job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,snapshot_key,target_ids_json,error_code)
    VALUES(?,?,'extract',?,'2026-10-26T00:00:00.000Z','2026-10-26T00:00:00.000Z','2026-10-26T00:00:00.000Z',?,?,?,'historical')`)
    .run(`original-${index}`, sourceId, status, rawSha256, snapshotKey, JSON.stringify(specs[index]))
  const attempt = (status: string, snapshot = rawSha256) => db.sqlite.prepare(`INSERT INTO maintenance_model_attempts
    (reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json)
    VALUES(?,?,?,?,?,'request','MiniMax-M3',?,'2026-10-26T00:00:00.000Z','{}')`)
    .run(`reservation-${status}`, `attempt-${status}`, sourceId, snapshot, 'primary', status)
  return { env, db, input, jobs, legacyJob, attempt, objects }
}

describe('durable one-active programme partition queue', () => {
  it('registers every valid part inactive and reports actual inserted rows on idempotent replay', async () => {
    const f = await fixture()
    const first = await registerProgramPartitions(f.env, f.input)
    expect(first).toMatchObject({ inserted: 5, reused: 0 })
    expect(f.jobs()).toHaveLength(5)
    expect(f.jobs().every(job => job.status === 'held' && job.error_code === 'program_partition_waiting')).toBe(true)
    expect(await registerProgramPartitions(f.env, f.input)).toEqual({ inserted: 0, reused: 5, jobIds: first.jobIds })
    expect(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_transaction_guards').get()).toEqual({ count: 0 })
  })

  it('reuses historical scopes with older IDs, without modifying done, unknown, active jobs or guards', async () => {
    const f = await fixture()
    f.legacyJob(0, 'done'); f.legacyJob(1, 'unknown'); f.legacyJob(2, 'queued')
    f.db.sqlite.prepare(`INSERT INTO maintenance_legacy_guards(guard_id,source_id,scope_json,state,artifact_sha256,reason)
      VALUES('legacy',?,'{}','unknown','proof','saved unknown request')`).run(f.input.sourceId)
    const original = f.jobs(), guards = f.db.sqlite.prepare('SELECT * FROM maintenance_legacy_guards').all()
    expect(await registerProgramPartitions(f.env, f.input)).toMatchObject({ inserted: 2, reused: 3,
      jobIds: [ 'original-0', 'original-1', 'original-2', expect.any(String), expect.any(String) ] })
    expect(f.jobs().filter(job => String(job.job_id).startsWith('original-'))).toEqual(original)
    expect(f.db.sqlite.prepare('SELECT * FROM maintenance_legacy_guards').all()).toEqual(guards)
  })

  it('validates the whole plan and captured binding before writing any partition', async () => {
    const f = await fixture()
    await expect(registerProgramPartitions(f.env, { ...f.input, specs: [...f.input.specs.slice(0, 4), { ...f.input.specs[4], sha256: '0'.repeat(64) }] }))
      .rejects.toThrow('program_partition_checksum_mismatch')
    expect(f.jobs()).toEqual([])
    await expect(registerProgramPartitions(f.env, { ...f.input, specs: [f.input.specs[0], f.input.specs[0]] })).rejects.toThrow('program_partition_duplicate_scope')
    await expect(registerProgramPartitions(f.env, { ...f.input, rawSha256: '0'.repeat(64) })).rejects.toThrow('program_partition_source_changed')
    expect(f.jobs()).toEqual([])
  })

  it('atomically promotes one part per source and advances after completion without a no-op loop', async () => {
    const f = await fixture(); await registerProgramPartitions(f.env, f.input)
    const calls = await Promise.all([promoteProgramPartitions(f.env, [f.input.sourceId]), promoteProgramPartitions(f.env, [f.input.sourceId])])
    expect(calls.reduce((sum, result) => sum + result.promoted, 0)).toBe(1)
    const active = f.jobs().find(job => job.status === 'queued')!
    expect(await promoteProgramPartitions(f.env, [f.input.sourceId])).toEqual({ promoted: 0, jobIds: [] })
    f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='done',error_code='saved completion' WHERE job_id=?").run(active.job_id)
    const finished = f.jobs().find(job => job.job_id === active.job_id)
    const next = await promoteProgramPartitions(f.env, [f.input.sourceId, f.input.sourceId])
    expect(next.promoted).toBe(1); expect(next.jobIds[0]).not.toBe(active.job_id)
    expect(f.jobs().find(job => job.job_id === active.job_id)).toEqual(finished)
    expect(f.jobs().filter(job => job.status === 'queued')).toHaveLength(1)
  })

  it.each(['queued', 'running', 'retry'])('does not promote beside an existing %s extract job', async status => {
    const f = await fixture(); f.legacyJob(0, status); await registerProgramPartitions(f.env, f.input)
    expect(await promoteProgramPartitions(f.env, [f.input.sourceId])).toEqual({ promoted: 0, jobIds: [] })
  })

  it.each(['reserved', 'send_started', 'unknown'])('blocks the whole source snapshot when a model attempt is %s', async status => {
    const f = await fixture(); await registerProgramPartitions(f.env, f.input); f.attempt(status)
    const before = f.jobs(), attempts = f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all()
    expect(await promoteProgramPartitions(f.env, [f.input.sourceId])).toEqual({ promoted: 0, jobIds: [] })
    expect(f.jobs()).toEqual(before)
    expect(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all()).toEqual(attempts)
  })

  it('keeps a standalone unknown job blocked and holds partitions when the saved source changes', async () => {
    const f = await fixture(); f.legacyJob(0, 'unknown'); await registerProgramPartitions(f.env, f.input)
    expect((await promoteProgramPartitions(f.env, [f.input.sourceId])).promoted).toBe(0)
    const other = await fixture(); await registerProgramPartitions(other.env, other.input)
    other.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run('0'.repeat(64), other.input.sourceId)
    expect((await promoteProgramPartitions(other.env, [other.input.sourceId])).promoted).toBe(0)
  })

  it('does not treat completed attempts or another snapshot as an unknown request for this snapshot', async () => {
    const f = await fixture(); await registerProgramPartitions(f.env, f.input)
    f.attempt('completed'); f.attempt('unknown', '0'.repeat(64))
    expect((await promoteProgramPartitions(f.env, [f.input.sourceId])).promoted).toBe(1)
  })
})
