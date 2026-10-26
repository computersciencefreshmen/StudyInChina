import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MaintenanceEnv } from '../../workers/catalog-maintenance/src/types'

const mocked = vi.hoisted(() => ({ open: vi.fn(), quota: vi.fn(), seed: vi.fn(), control: vi.fn(), controls: vi.fn(), process: vi.fn(), prepare: vi.fn(), read: vi.fn(), promote: vi.fn() }))
vi.mock('../../scripts/maintenance/local-runtime', () => ({ openLocalRuntime: mocked.open }))
vi.mock('../../scripts/ingestion/minimax-quota', () => ({ getCcSwitchQuotaConfig: mocked.quota }))
vi.mock('../../workers/catalog-maintenance/src/repository', () => ({ seed: mocked.seed, control: mocked.control, setControls: mocked.controls }))
vi.mock('../../workers/catalog-maintenance/src/index', () => ({ processMessage: mocked.process }))
vi.mock('../../workers/catalog-maintenance/src/exports', () => ({ prepareExport: mocked.prepare, readExport: mocked.read }))
vi.mock('../../workers/catalog-maintenance/src/program-partition-queue', () => ({ promoteProgramPartitions: mocked.promote }))
import { runLocalMaintenance } from '../../scripts/maintenance/run-local-maintenance'

const roots: string[] = [], hash = (value: string) => createHash('sha256').update(value).digest('hex'), pin = 'a'.repeat(64)
async function fixture() {
  vi.resetAllMocks()
  const directory = await mkdtemp(join(tmpdir(), 'maintenance-runner-options-')); roots.push(directory)
  const scope = JSON.parse(readFileSync('content/maintenance/scope-272.v1.json', 'utf8')), school = scope.schools[0]
  const sourceUrl = `https://${school.officialHosts[0]}/fixture-programme-catalogue`, sourceId = hash(sourceUrl)
  const sourceFile = join(directory, 'sources.json'), seedFile = join(directory, 'seed.json')
  await writeFile(sourceFile, JSON.stringify({ sources: [{ id: sourceId, universityId: school.universityId, url: sourceUrl,
    allowedHosts: [school.officialHosts[0]], sourceCategory: 'current_guide', entityType: 'program', enabled: true, registration: 'catalogue_official' }] }))
  await writeFile(seedFile, JSON.stringify({ scopeRegistrySha256: scope.sha256, schools: Array.from({ length: 272 }, () => ({})), legacyGuards: { entries: [{}] } }))
  const cfg = { input_catalog_sha256: pin, seed_sha256: pin, legacy_guard_sha256: pin, enabled: 1, models_enabled: 1,
    revision: 1, canary_json: JSON.stringify([school.universityId]) }
  const jobs = ['capture', 'award', 'extract', 'maintain'].map(stage => ({ job_id: `fixture-${stage}`, stage, source_id: sourceId, status: 'queued' }))
  const runtime = { db: { sqlite: { prepare: () => ({ get: () => undefined }) }, prepare: (sql: string) => {
    let args: unknown[] = []
    const query = { bind: (...values: unknown[]) => { args = values; return query },
      run: async () => ({ success: true }),
      first: async () => {
        if (sql.includes('SELECT job_id,stage,source_id')) return jobs.find(job => job.status === 'queued'
          && (!sql.includes("AND stage IN('capture','extract')") || ['capture', 'extract'].includes(job.stage))) ?? null
        if (sql.includes('SELECT stage,status,error_code')) return jobs.find(job => job.job_id === args[0]) ?? null
        if (sql.includes('COUNT(*) count FROM maintenance_proposals')) return { count: 2 }
        return null
      }, all: async () => ({ results: sql.includes('maintenance_proposals') ? [{ status: 'ready', count: 2 }] : [] }) }
    return query
  } }, bucket: { list: async () => [] }, queue: {}, storage: {}, close: vi.fn(async () => {}) }
  mocked.open.mockResolvedValue(runtime)
  mocked.quota.mockReturnValue({ model: 'MiniMax-M3', endpoint: 'https://api.minimaxi.com/anthropic', key: 'fixture-key-not-an-account-credential' })
  mocked.control.mockResolvedValue(cfg)
  mocked.process.mockImplementation(async (_env: MaintenanceEnv, message: { jobId: string }) => { jobs.find(job => job.job_id === message.jobId)!.status = 'done' })
  mocked.prepare.mockResolvedValue({ batchId: 'fixture-export', proposalCount: 2, sha256: pin })
  mocked.read.mockResolvedValue({ batchId: 'fixture-export', proposals: [] })
  mocked.promote.mockResolvedValue({ promoted: 0, jobIds: [] })
  let fence: Record<string, unknown> | null = null
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/artifacts') return Response.json({ seedSha256: pin, scopeRegistrySha256: scope.sha256 })
    if (url.pathname === '/offline-fence/acquire') {
      const value = JSON.parse(String(init?.body)); fence = { ...value, tokenSha256: hash(value.token), phase: 'active' }
      return Response.json({ ok: true, fence })
    }
    if (url.pathname === '/offline-fence') return Response.json({ ok: true, fence })
    throw new Error('unexpected_fixture_network_endpoint')
  })
  vi.stubGlobal('fetch', fetcher); vi.spyOn(console, 'log').mockImplementation(() => {})
  return { directory, jobs, runtime, fetcher, options: { directory, seedFile, sourceFile,
    workerUrl: 'https://studyinchina-catalog-maintenance.13022037121.workers.dev', adminToken: 'fixture-admin'.repeat(3), execute: true } }
}
afterEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('maintenance-runner-options-')) throw new Error('Unexpected cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})

describe('explicit local programme batch options', () => {
  it('forwards v2, processes only capture/extract and leaves ready proposals without claiming an export', async () => {
    const f = await fixture()
    const report = await runLocalMaintenance({ ...f.options, programExtractionContractVersion: '2', programsOnly: true, deferExport: true })
    expect(mocked.process.mock.calls.map(([, message]) => message.jobId)).toEqual(['fixture-capture', 'fixture-extract'])
    expect(mocked.process.mock.calls.every(([env]) => env.PROGRAM_EXTRACTION_CONTRACT_VERSION === '2')).toBe(true)
    expect(f.jobs.filter(job => job.status === 'queued').map(job => job.stage)).toEqual(['award', 'maintain'])
    expect(mocked.prepare).not.toHaveBeenCalled()
    expect(mocked.read).not.toHaveBeenCalled()
    expect(existsSync(join(f.directory, 'download'))).toBe(false)
    expect(report).toMatchObject({ processed: 2, proposals: [{ status: 'ready', count: 2 }], canonicalPublished: false })
    expect(f.runtime.close).toHaveBeenCalledOnce()
  })

  it('preserves the default stages, v1 environment and existing export behavior', async () => {
    const f = await fixture(); const report = await runLocalMaintenance(f.options)
    expect(mocked.process.mock.calls.map(([, message]) => message.jobId)).toEqual(['fixture-capture', 'fixture-award', 'fixture-extract', 'fixture-maintain'])
    expect(mocked.process.mock.calls.every(([env]) => env.PROGRAM_EXTRACTION_CONTRACT_VERSION === undefined)).toBe(true)
    expect(mocked.prepare).toHaveBeenCalledOnce()
    expect(mocked.read).toHaveBeenCalledOnce()
    expect(report.processed).toBe(4)
    expect(mocked.promote).not.toHaveBeenCalled()
    expect(existsSync(join(f.directory, 'download/export.json'))).toBe(true)
  })

  it('keeps export deferral independent of stage selection and preserves frozen batch guards', async () => {
    const f = await fixture(); await runLocalMaintenance({ ...f.options, deferExport: true })
    expect(mocked.process).toHaveBeenCalledTimes(4)
    expect(mocked.prepare).not.toHaveBeenCalled()
    await writeFile(join(f.directory, 'handoff.json'), '{}')
    await expect(runLocalMaintenance({ ...f.options, programsOnly: true, deferExport: true })).rejects.toThrow('offline_batch_frozen_for_handoff')
    expect(mocked.process).toHaveBeenCalledTimes(4)
  })

  it('rejects an unknown contract selection before opening state or reading a real credential', async () => {
    const f = await fixture()
    await expect(runLocalMaintenance({ ...f.options, programExtractionContractVersion: 'invalid' })).rejects.toThrow('invalid_program_extraction_contract_version')
    expect(mocked.open).not.toHaveBeenCalled()
    expect(mocked.quota).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
  })

  it('resumes waiting programme parts only when explicitly enabled, and stops when nothing is runnable', async () => {
    const f = await fixture()
    const report = await runLocalMaintenance({ ...f.options, resumeProgramPartitions: true, programsOnly: true, deferExport: true })
    expect(report.processed).toBe(2)
    expect(mocked.promote).toHaveBeenCalledTimes(3)
    expect(mocked.promote.mock.calls.every(([, ids]) => ids.length === 1 && ids[0] === f.jobs[0].source_id)).toBe(true)
    expect(mocked.process).toHaveBeenCalledTimes(2)
  })
})
