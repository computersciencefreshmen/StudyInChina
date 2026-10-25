import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { deserialize } from 'node:v8'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalJson, type MaintenanceProposal, type SourceSeed } from '../../scripts/maintenance/contracts'
import { continueLocalMaintenance } from '../../scripts/maintenance/continue-local-maintenance'
import { openLocalRuntime } from '../../scripts/maintenance/local-runtime'
import { stageLocalHandoff } from '../../scripts/maintenance/stage-local-handoff'

const base = resolve('.pipeline-build'), roots: string[] = [], pin = 'a'.repeat(64), token = 'b'.repeat(64), stamp = '2026-10-25T00:00:00.000Z'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function fixture() {
  mkdirSync(base, { recursive: true })
  const root = await mkdtemp(join(base, 'continuation-test-')); roots.push(root)
  const parent = join(root, 'parent'), target = join(root, 'next'), runtime = await openLocalRuntime({ directory: parent })
  const url = 'https://example.edu.cn/catalog', id = hash(url), raw = 'Example Programme for international students', rawSha = hash(raw)
  const oldSources: SourceSeed[] = [
    { id, universityId: 'uni-old', url, allowedHosts: ['example.edu.cn'], sourceCategory: 'masters_catalog', entityType: 'program', enabled: true, registration: 'catalogue_official' },
    { id: hash('disabled'), universityId: 'uni-old', url: 'https://example.edu.cn/disabled', allowedHosts: ['example.edu.cn'], sourceCategory: 'current_guide', entityType: 'program', enabled: false, registration: 'candidate' },
  ]
  const oldText = JSON.stringify({ sources: oldSources })
  await writeFile(join(parent, 'source-manifest.json'), oldText)
  await writeFile(join(parent, 'fence-private.json'), JSON.stringify({ batchId: 'offline-fixture', token, scopeRegistrySha256: pin,
    inputCatalogSha256: pin, seedSha256: pin, legacyGuardSha256: pin, sourceManifestSha256: hash(oldText) }))
  runtime.db.sqlite.prepare('INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,seed_complete,targets_complete,updated_at) VALUES(1,?,?,?,?,1,1,?)').run(pin, pin, pin, pin, stamp)
  for (const school of ['uni-old', 'uni-new']) runtime.db.sqlite.prepare('INSERT INTO maintenance_schools VALUES(?,?,?,?,NULL)').run(school, '{}', JSON.stringify({ sourceSeeds: [{ allowedHosts: ['example.edu.cn'] }] }), pin)
  runtime.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at) VALUES(?,?,?,'masters_catalog','[\"masters_catalog\"]',1,168,?)").run(id, url, '["example.edu.cn"]', stamp)
  runtime.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(id, 'uni-old')
  runtime.db.sqlite.prepare('INSERT INTO maintenance_legacy_guards VALUES(?,NULL,NULL,NULL,?,?,?, ?,NULL)').run('legacy-original', '"*"', 'stop', pin, 'Preserved original guard')
  const rawKey = `maintenance/snapshots/${id}/${rawSha}.bin`; await runtime.bucket.put(rawKey, raw)
  for (let i = 0; i < 6; i++) {
    const request = hash(`request-${i}`), artifact = canonicalJson({ attemptId: `attempt-${i}`, output: { programs: [] } }), outputSha = hash(artifact)
    const outputKey = `maintenance/models/${request}/${outputSha}.json`; await runtime.bucket.put(outputKey, artifact)
    runtime.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,completed_at,output_key,output_sha256,quota_json) VALUES(?,?,?,?,'primary',?,'MiniMax-M3','completed',?,?,?,?,'{}')").run(request, `attempt-${i}`, id, rawSha, pin, stamp, stamp, outputKey, outputSha)
    await runtime.storage.put(`request:${request}`, { state: 'completed', attemptId: `attempt-${i}`, requestSha256: pin, result: { exactCachedMarker: i }, attemptCount: 1 })
  }
  const exportKey = `maintenance/exports/prepared-fixture/${hash('{}')}.json`; await runtime.bucket.put(exportKey, '{}')
  runtime.db.sqlite.prepare("INSERT INTO maintenance_exports(batch_id,input_catalog_sha256,scope_sha256,object_key,sha256,created_at,status) VALUES('prepared-fixture',?,?,?,?,?,'prepared')").run(pin, pin, exportKey, hash('{}'), stamp)
  for (let i = 0; i < 12; i++) {
    const proposal: MaintenanceProposal = { id: `proposal-${i}`, universityId: 'uni-old', entityType: 'program', recordId: null, operation: 'create', fields: {},
      source: { id, url, snapshotSha256: rawSha, objectKey: rawKey, checkedAt: stamp, contentType: 'text/plain', locator: 'text:document', quote: raw },
      fieldEvidence: [{ sourceId: id, url, snapshotSha256: rawSha, objectKey: rawKey, locator: 'text:document', quote: raw, fieldPath: 'name.en' }],
      scope: { year: null, intake: null }, status: 'ready', warnings: [] }
    runtime.db.sqlite.prepare("INSERT INTO maintenance_proposals VALUES(?,?,?,?,'exported',?,?,'prepared-fixture',NULL)").run(proposal.id, 'uni-old', id, rawSha, JSON.stringify(proposal), stamp)
  }
  await runtime.queue.send({ version: 1, jobId: hash('queued') })
  await runtime.close()
  await stageLocalHandoff({ directory: parent, sourceFile: join(parent, 'source-manifest.json'), workerUrl: '', adminToken: '', upload: false })
  const newSourceFile = join(root, 'new-sources.json'), next = { ...oldSources[0], id: hash('https://example.edu.cn/new'), universityId: 'uni-new', url: 'https://example.edu.cn/new' }
  await writeFile(newSourceFile, JSON.stringify({ sources: [...oldSources, next] }))
  return { parent, target, newSourceFile, oldSources, options: { fromDirectory: parent, toDirectory: target, newSourceFile, execute: true } }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== base || !basename(root).startsWith('continuation-test-')) throw new Error('Unexpected cleanup target')
    await rm(root, { recursive: true, force: true })
  }
})

describe('durable local continuation copy', () => {
  it('backs up all four databases and preserves completed paid state, guards, prepared export and frozen provenance', async () => {
    const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const original = readFileSync(join(f.parent, 'handoff.json')), oldFence = readFileSync(join(f.parent, 'fence-private.json'))
    // Keep committed state in WAL with another connection open: file copying alone would lose it.
    const wal = new DatabaseSync(join(f.parent, 'pipeline.sqlite'))
    wal.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO maintenance_events VALUES('wal-proof','test','2026-10-25T00:00:00.000Z','{}')")
    try {
      const result = await continueLocalMaintenance(f.options), copied = new DatabaseSync(join(f.target, 'pipeline.sqlite'), { readOnly: true })
      if (!result.prepared) throw new Error('Expected a prepared continuation')
      try {
        expect(copied.prepare("SELECT COUNT(*) count FROM maintenance_model_attempts WHERE status='completed'").get()?.count).toBe(6)
        expect(copied.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='exported'").get()?.count).toBe(12)
        expect(copied.prepare('SELECT COUNT(*) count FROM maintenance_legacy_guards').get()?.count).toBe(1)
        expect(copied.prepare("SELECT status FROM maintenance_exports WHERE batch_id='prepared-fixture'").get()?.status).toBe('prepared')
        expect(copied.prepare("SELECT COUNT(*) count FROM maintenance_events WHERE event_id='wal-proof'").get()?.count).toBe(1)
      } finally { copied.close() }
      const durable = new DatabaseSync(join(f.target, 'durable.sqlite'), { readOnly: true })
      try { const values = durable.prepare("SELECT value FROM local_durable_values WHERE key LIKE 'request:%'").all(); expect(values).toHaveLength(6)
        expect(values.map(value => deserialize(value.value as Uint8Array).result.exactCachedMarker).sort()).toEqual([0, 1, 2, 3, 4, 5])
      } finally { durable.close() }
      expect(result).toMatchObject({ prepared: true, cloudReopenRequired: true, networkPerformed: false, modelsExecuted: false })
      expect(Object.keys(result.backups)).toHaveLength(4)
      expect(readFileSync(join(f.parent, 'handoff.json')).equals(original)).toBe(true)
      expect(readFileSync(join(f.parent, 'fence-private.json')).equals(oldFence)).toBe(true)
      expect(readFileSync(join(f.target, 'continuation-parent/handoff.json')).equals(original)).toBe(true)
      const newFence = JSON.parse(readFileSync(join(f.target, 'fence-private.json'), 'utf8'))
      expect(Object.keys(newFence).sort()).toEqual(Object.keys(JSON.parse(oldFence.toString())).sort())
      expect(newFence.token).toBe(token)
      expect(existsSync(join(f.target, 'handoff.json'))).toBe(false)
      expect(existsSync(join(f.target, 'continuation-incomplete.json'))).toBe(false)
      expect(fetcher).not.toHaveBeenCalled()
    } finally { wal.close() }
  })

  it('provides a non-mutating plan and rejects removing a parent source or changing an old category', async () => {
    const f = await fixture()
    expect(await continueLocalMaintenance({ ...f.options, execute: false })).toMatchObject({ prepared: false, cloudReopenRequired: true })
    expect(existsSync(f.target)).toBe(false)
    await writeFile(f.newSourceFile, JSON.stringify({ sources: [{ ...f.oldSources[0], sourceCategory: 'current_guide' }] }))
    await expect(continueLocalMaintenance(f.options)).rejects.toThrow('continuation_removed_or_changed_parent_source')
  })

  it('rejects overwrite, paths outside pipeline-build, symlinks and excess enabled sources', async () => {
    const f = await fixture()
    await expect(continueLocalMaintenance({ ...f.options, toDirectory: f.parent })).rejects.toThrow('continuation_target_exists')
    await expect(continueLocalMaintenance({ ...f.options, toDirectory: resolve('outside-build') })).rejects.toThrow('continuation_outside_pipeline_build')
    const linked = join(dirname(f.parent), 'linked'); await symlink(f.parent, linked, 'junction')
    await expect(continueLocalMaintenance({ ...f.options, fromDirectory: linked })).rejects.toThrow('continuation_symlink_rejected')
    const many = Array.from({ length: 20 }, (_, i) => ({ ...f.oldSources[0], id: hash(`extra-${i}`), url: `https://example.edu.cn/extra-${i}` }))
    await writeFile(f.newSourceFile, JSON.stringify({ sources: [...f.oldSources, ...many] }))
    await expect(continueLocalMaintenance(f.options)).rejects.toThrow('continuation_source_limit_exceeded')
  })
})
