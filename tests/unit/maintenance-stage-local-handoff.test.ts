import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalJson } from '../../scripts/maintenance/contracts'
import { openLocalRuntime } from '../../scripts/maintenance/local-runtime'
import { stageLocalHandoff } from '../../scripts/maintenance/stage-local-handoff'
import { OFFLINE_TABLES, offlineHandoffSchema } from '../../workers/catalog-maintenance/src/offline-handoff-contract'

const roots: string[] = [], hash = (value: string) => createHash('sha256').update(value).digest('hex')
const stamp = '2026-10-25T00:00:00.000Z', pin = 'a'.repeat(64), token = 'b'.repeat(64)
const workerUrl = 'https://studyinchina-catalog-maintenance.13022037121.workers.dev'
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'maintenance-stage-handoff-')); roots.push(directory)
  const runtime = await openLocalRuntime({ directory }), url = 'https://example.edu.cn/catalog', sourceId = hash(url)
  const sourceFile = join(directory, 'sources.json')
  const source = { id: sourceId, universityId: 'uni-example', url, allowedHosts: ['example.edu.cn'], sourceCategory: 'masters_catalog',
    entityType: 'program', enabled: true, registration: 'catalogue_official' }
  const sourceText = JSON.stringify({ sources: [source] })
  await writeFile(sourceFile, sourceText)
  await writeFile(join(directory, 'fence-private.json'), JSON.stringify({ batchId: 'offline-fixture', token,
    scopeRegistrySha256: pin, inputCatalogSha256: pin, seedSha256: pin, legacyGuardSha256: pin, sourceManifestSha256: hash(sourceText) }))
  runtime.db.sqlite.prepare('INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,seed_complete,targets_complete,updated_at) VALUES(1,?,?,?,?,1,1,?)').run(pin, pin, pin, pin, stamp)
  runtime.db.sqlite.prepare('INSERT INTO maintenance_schools VALUES(?,?,?,?,NULL)').run('uni-example', '{"en":"Example University"}', '{}', pin)
  for (const [id, page] of [[sourceId, url], [hash('other'), 'https://example.edu.cn/other']]) {
    runtime.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at) VALUES(?,?,?,'masters_catalog','[\"masters_catalog\"]',1,168,?)").run(id, page, '["example.edu.cn"]', stamp)
    runtime.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(id, 'uni-example')
  }
  const raw = 'official captured evidence', rawHash = hash(raw), objectKey = `maintenance/text/${sourceId}/${rawHash}.txt`
  await runtime.bucket.put(objectKey, raw)
  await runtime.bucket.put(`maintenance/bootstrap/${pin}.json`, '{}')
  const requestKey = 'c'.repeat(64)
  runtime.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json,error_code) VALUES(?,'attempt-fixture',?,?,'primary',?,'MiniMax-M3','unknown',?,'{}','model_outcome_unknown')").run(requestKey, sourceId, rawHash, pin, stamp)
  await runtime.storage.put(`request:${requestKey}`, { state: 'unknown', attemptId: 'attempt-fixture', requestSha256: pin,
    result: { excluded: 'MUST-NOT-LEAVE-LOCAL-RESULT' } })
  await runtime.close()
  return { directory, sourceFile, objectKey, sourceId, options: { directory, sourceFile, workerUrl, adminToken: 'fixture-admin'.repeat(3), upload: false } }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('maintenance-stage-handoff-')) throw new Error('Unexpected cleanup target')
    await rm(root, { recursive: true, force: true })
  }
})

describe('local handoff packing and transport checkpoints', () => {
  it('freezes canonical evidence and all nine source-scoped tables without a network/model request', async () => {
    const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const result = await stageLocalHandoff(f.options), text = await readFile(result.manifestPath, 'utf8')
    const manifest = offlineHandoffSchema.parse(JSON.parse(text))
    expect(Object.keys(manifest.tableRows).sort()).toEqual(Object.keys(OFFLINE_TABLES).sort())
    expect(manifest.tableRows.maintenance_sources.map(row => row.source_id)).toEqual([f.sourceId])
    expect(manifest.artifacts.map(artifact => artifact.objectKey)).toEqual([f.objectKey])
    expect(manifest.requestReservations).toEqual([{ reservationKey: 'c'.repeat(64), state: 'unknown', attemptId: 'attempt-fixture', requestSha256: pin }])
    expect(text).toBe(canonicalJson(manifest))
    expect(text).not.toContain(token)
    expect(text).not.toContain('MUST-NOT-LEAVE-LOCAL-RESULT')
    expect(await stageLocalHandoff(f.options)).toEqual(result)
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.canonicalPublished).toBe(false)
  })

  it('fails before freezing an unexpected artifact namespace or missing durable no-replay state', async () => {
    const f = await fixture(), runtime = await openLocalRuntime({ directory: f.directory })
    await runtime.bucket.put('maintenance/control/unsafe.json', '{}'); await runtime.close()
    await expect(stageLocalHandoff(f.options)).rejects.toThrow('handoff_unexpected_artifact_namespace')
    await expect(readFile(join(f.directory, 'handoff.json'))).rejects.toThrow()
    const g = await fixture(), runtime2 = await openLocalRuntime({ directory: g.directory })
    await runtime2.storage.delete(`request:${'c'.repeat(64)}`); await runtime2.close()
    await expect(stageLocalHandoff(g.options)).rejects.toThrow('Every model reservation requires its durable no-replay state')
  })

  it('rejects changed source inputs and running jobs rather than clearing leases for upload', async () => {
    const f = await fixture(); await writeFile(f.sourceFile, '{"sources":[]}')
    await expect(stageLocalHandoff(f.options)).rejects.toThrow('handoff_source_manifest_changed')
    const g = await fixture(), runtime = await openLocalRuntime({ directory: g.directory })
    runtime.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,lease_token,lease_until) VALUES('running',?,'extract','running',?,?,?,'lease',?)").run(g.sourceId, stamp, stamp, stamp, stamp)
    await runtime.close()
    await expect(stageLocalHandoff(g.options)).rejects.toThrow('handoff_local_jobs_still_running')
  })

  it('resumes acknowledged artifact uploads after a manifest transport failure using the same frozen bytes', async () => {
    const f = await fixture(), calls: Array<{ path: string; hash: string | null; body: Uint8Array }> = []
    let failManifest = true
    vi.stubGlobal('fetch', vi.fn(async (input: URL, init: RequestInit) => {
      const url = new URL(input), headers = new Headers(init.headers), body = init.body as Uint8Array
      // TextEncoder may return a Uint8Array from a different Vitest realm.
      expect(ArrayBuffer.isView(body)).toBe(true)
      expect(Object.prototype.toString.call(body)).toBe('[object Uint8Array]')
      const expectedBytes = url.pathname.endsWith('/artifact') ? Buffer.from('official captured evidence')
        : await readFile(join(f.directory, 'handoff.json'))
      expect(body.byteLength).toBe(expectedBytes.byteLength)
      expect(Buffer.from(body)).toEqual(expectedBytes)
      const header = url.pathname.endsWith('/artifact') ? 'x-artifact-sha256' : 'x-manifest-sha256'
      expect(headers.get(header)).toBe(createHash('sha256').update(expectedBytes).digest('hex'))
      // Native fetch adds framing after this mocked application boundary.
      const explicitLength = headers.get('content-length')
      if (explicitLength !== null) expect(explicitLength).toBe(String(body.byteLength))
      calls.push({ path: url.pathname, hash: headers.get('x-artifact-sha256') ?? headers.get('x-manifest-sha256'), body })
      if (url.pathname.endsWith('/artifact')) return Response.json({ ok: true, staged: true, verified: false, objectKey: f.objectKey, sha256: hash('official captured evidence') })
      if (failManifest) { failManifest = false; throw new Error('fixture interrupted transport') }
      return Response.json({ ok: true, staged: true, validation: 'pending-queue', released: false, batchId: 'offline-fixture', manifestSha256: hash(Buffer.from(body).toString()) })
    }))
    await expect(stageLocalHandoff({ ...f.options, upload: true })).rejects.toThrow('fixture interrupted transport')
    const frozen = await readFile(join(f.directory, 'handoff.json'), 'utf8')
    const resumed = await stageLocalHandoff({ ...f.options, upload: true })
    expect(calls.filter(call => call.path.endsWith('/artifact'))).toHaveLength(1)
    expect(calls.filter(call => call.path.endsWith('/manifest')).map(call => Buffer.from(call.body).toString())).toEqual([frozen, frozen])
    expect(resumed).toMatchObject({ artifactsReused: 1, artifactsUploaded: 0, manifestUploaded: true, cloudValidationComplete: false, canonicalPublished: false })
    const final = await stageLocalHandoff({ ...f.options, upload: true })
    expect(final.manifestUploaded).toBe(false)
    expect(calls).toHaveLength(3)
  })

  it('rejects an unexpected upload origin before sending a private fence or admin credential', async () => {
    const f = await fixture(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(stageLocalHandoff({ ...f.options, upload: true, workerUrl: 'https://example.com/' })).rejects.toThrow('unexpected_maintenance_service')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
