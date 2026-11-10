import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import manifest from '../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import { reconcileMaintenanceHead, requireTrustedReconciliationRunner, uploadReconciliationTargets, type verifyReconciliationHistory } from '../../scripts/automation/reconcile-maintenance-head'
import type { MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'
import { buildMaintenanceTargets } from '../../scripts/automation/build-maintenance-bootstrap'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { canonicalJson, maintenanceScopeSchema } from '../../scripts/maintenance/contracts'

// Contract parsing/hashing has its own suites. These fixtures represent the
// validated response so these tests isolate ordering, CAS and failure recovery.
vi.mock('../../scripts/maintenance/contracts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../scripts/maintenance/contracts')>()
  return { ...actual, maintenanceCandidateExportSchema: { parse: (value: unknown) => value },
    exportContentSha256: async (value: { sha256: string }) => value.sha256 }
})

const originalControl = () => ({ input_catalog_sha256: manifest.oldInputCatalogSha256, scope_sha256: manifest.scopeRegistrySha256,
  seed_sha256: manifest.seedSha256, legacy_guard_sha256: manifest.legacyGuardSha256, enabled: 1 as 0 | 1, models_enabled: 1 as 0 | 1,
  seed_complete: 1 as 0 | 1, targets_complete: 1 as 0 | 1, canary_json: '["uni-peking-university"]', revision: 1, updated_at: '2026-11-10T04:00:00Z' })
type Control = ReturnType<typeof originalControl>
type Snapshot = { format: string; control: Control; deployment: { maintenanceEnabled: boolean; subscriptionConfigured: boolean }; reconciliation: { manifestSha256: string;
  paused: { originalControl: Control; pausedRevision: number; proofSha256: string } | null;
  advanced: { reconciledRevision: number; proofSha256: string } | null;
  resumed: { restoredRevision: number } | null } }
const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
const outputDirectory = async () => {
  const base = resolve('.tmp/maintenance-reconcile-client-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(resolve(base, 'run-')); directories.push(directory); return directory
}
const verifyHistory = vi.fn<typeof verifyReconciliationHistory>().mockResolvedValue({ operationId: manifest.operationId, manifestSha256: manifest.sha256,
  oldCommit: manifest.oldCommit, bridgeCommit: manifest.bridgeCommit, sourceCommit: manifest.sourceCommit, currentCommit: manifest.sourceCommit,
  nativeReceiptCount: 61, acceptedCount: 198, archivedPaths: 133, currentCatalogSha256: manifest.newInputCatalogSha256, reviewedFilesCommitted: true, limitation: 'test fixture' })

function fixture(options: { holdTargets?: boolean; operatorChange?: boolean; loseAckResponse?: boolean; badExport?: boolean } = {}) {
  const state: Snapshot = { format: 'studyinchina.maintenance-control', control: originalControl(),
    deployment: { maintenanceEnabled: false, subscriptionConfigured: true },
    reconciliation: { manifestSha256: manifest.sha256, paused: null, advanced: null, resumed: null } }
  const requests: Array<{ path: string; method: string; body?: unknown }> = []
  let rejected = false, lostReply = false
  const clone = () => structuredClone(state)
  const client: MaintenanceClient = {
    artifact: async () => { throw new Error('Unexpected artifact read') },
    async json(path, method = 'GET', body) {
      requests.push({ path, method, body: structuredClone(body) })
      if (path === '/control') return clone()
      if (path === `/exports/${manifest.preparedExport.batchId}`) return {
        batchId: manifest.preparedExport.batchId, sha256: options.badExport ? 'f'.repeat(64) : manifest.preparedExport.sha256,
        inputCatalogSha256: manifest.oldInputCatalogSha256, scopeRegistrySha256: manifest.scopeRegistrySha256,
        proposals: manifest.preparedExport.proposalIds.map(id => ({ id })),
      }
      if (path === '/ack') {
        if (!rejected) { rejected = true; state.control.revision++ }
        if (options.loseAckResponse && !lostReply) { lostReply = true; throw new Error('maintenance_request_failed') }
        return { ok: true, outcome: 'rejected' }
      }
      if (path === '/head-reconcile') {
        const request = body as { phase: string; expectedRevision: number; manifestSha256: string }
        expect(request.manifestSha256).toBe(manifest.sha256)
        expect(request.expectedRevision).toBe(state.control.revision)
        if (request.phase === 'pause') {
          const original = structuredClone(state.control)
          state.control.enabled = 0; state.control.models_enabled = 0; state.control.revision++
          state.reconciliation.paused = { originalControl: original, pausedRevision: state.control.revision, proofSha256: '1'.repeat(64) }
        } else if (request.phase === 'advance') {
          expect(rejected).toBe(true)
          state.control.input_catalog_sha256 = manifest.newInputCatalogSha256; state.control.targets_complete = 0; state.control.revision++
          state.reconciliation.advanced = { reconciledRevision: state.control.revision, proofSha256: '2'.repeat(64) }
        } else if (request.phase === 'resume') {
          expect(state.control.targets_complete).toBe(1)
          const original = state.reconciliation.paused!.originalControl
          state.control.enabled = original.enabled; state.control.models_enabled = original.models_enabled; state.control.canary_json = original.canary_json; state.control.revision++
          state.reconciliation.resumed = { restoredRevision: state.control.revision }
        } else throw new Error('Unknown phase')
        return clone()
      }
      throw new Error(`Unexpected route: ${path}`)
    },
  }
  const uploadTargets = async (bytes: Uint8Array<ArrayBuffer>, expectedRevision: number) => {
    requests.push({ path: '/head-reconcile-targets', method: 'POST', body: { byteLength: bytes.byteLength, expectedRevision } })
    expect(bytes.byteLength).toBe(manifest.targetUpload.byteLength)
    expect(expectedRevision).toBe(state.control.revision)
    if (!options.holdTargets) { state.control.targets_complete = 1; state.control.revision++ }
    if (options.operatorChange) state.control.revision++
    return { ok: true, pending: true, validation: 'pending-queue' }
  }
  const run = async (action: 'prepare' | 'resume' = 'prepare', maxPolls = 1) => reconcileMaintenanceHead({ root: process.cwd(), output: await outputDirectory(), client, uploadTargets, action, verifyHistory, wait: async () => {}, maxPolls })
  return { state, requests, run, allowModelLane() { state.deployment.maintenanceEnabled = true }, completeTargets() { state.control.targets_complete = 1; state.control.revision++ } }
}

describe('pinned native Git head repair client', () => {
  it('prepares with controls off, then restores original controls only on a separate explicit resume', async () => {
    const context = fixture(), original = structuredClone(context.state.control)
    await context.run()
    expect(context.state.control).toMatchObject({ revision: 5, targets_complete: 1, enabled: 0, models_enabled: 0 })
    expect(context.state.reconciliation.resumed).toBeNull()
    context.allowModelLane()
    await context.run('resume')
    expect(context.state.control).toMatchObject({ input_catalog_sha256: manifest.newInputCatalogSha256, revision: 6, targets_complete: 1,
      enabled: original.enabled, models_enabled: original.models_enabled, canary_json: original.canary_json })
    const ack = context.requests.find(request => request.path === '/ack')!.body as Record<string, unknown>
    expect(ack).toMatchObject({ outcome: 'rejected', receiptSha256: manifest.preparedExport.rejectionReview.sha256,
      newInputCatalogSha256: manifest.oldInputCatalogSha256, acceptedProposalIds: [], unchangedProposalIds: [] })
    expect(ack.heldProposalIds).toEqual([...manifest.preparedExport.proposalIds].sort())
    expect(context.requests.filter(request => request.path === '/head-reconcile').map(request => (request.body as { phase: string }).phase)).toEqual(['pause', 'advance', 'resume'])
    expect(context.requests.findIndex(request => request.path === '/ack')).toBeLessThan(context.requests.findIndex(request => request.path === '/head-reconcile' && (request.body as { phase: string }).phase === 'advance'))
    expect(context.requests.some(request => request.path === '/tick' || request.path.includes('model'))).toBe(false)
    expect(context.requests.some(request => request.path === '/targets')).toBe(false)
    expect(context.requests.filter(request => request.path === '/head-reconcile-targets')).toHaveLength(1)
  })
  it('holds safely on a changed immutable export, without an acknowledgement or resume', async () => {
    const context = fixture({ badExport: true })
    await expect(context.run()).rejects.toThrow('prepared_export_changed')
    expect(context.state.control.enabled).toBe(0)
    expect(context.requests.some(request => request.path === '/ack' || request.path === '/head-reconcile-targets')).toBe(false)
    expect(context.state.reconciliation.advanced).toBeNull()
  })
  it('recovers a lost rejection reply by reusing the same deterministic acknowledgement', async () => {
    const context = fixture({ loseAckResponse: true })
    await expect(context.run()).rejects.toThrow('maintenance_request_failed')
    expect(context.state.control).toMatchObject({ enabled: 0, models_enabled: 0, revision: 3 })
    await context.run()
    const acknowledgements = context.requests.filter(request => request.path === '/ack')
    expect(acknowledgements).toHaveLength(2)
    expect(acknowledgements[0].body).toEqual(acknowledgements[1].body)
    expect(context.state.control.revision).toBe(5)
    expect(context.state.control.enabled).toBe(0)
  })
  it('does not resume while target processing is incomplete, and can retry after its exact completion', async () => {
    const context = fixture({ holdTargets: true })
    await expect(context.run('prepare', 0)).rejects.toThrow('targets_waiting_keep_paused')
    expect(context.state.control).toMatchObject({ enabled: 0, models_enabled: 0, revision: 4, targets_complete: 0 })
    expect(context.state.reconciliation.resumed).toBeNull()
    context.completeTargets()
    await context.run()
    expect(context.state.control.revision).toBe(5)
    expect(context.state.reconciliation.resumed).toBeNull()
    expect(context.requests.filter(request => request.path === '/ack')).toHaveLength(1)
  })
  it('refuses to restore controls after an operator revision change', async () => {
    const context = fixture({ operatorChange: true })
    await expect(context.run()).rejects.toThrow('completion_revision_changed')
    expect(context.state.control).toMatchObject({ enabled: 0, models_enabled: 0 })
    expect(context.state.reconciliation.resumed).toBeNull()
  })
  it('does not mutate an already completed operation on a later invocation', async () => {
    const context = fixture()
    await context.run()
    context.allowModelLane()
    await context.run('resume')
    const writes = context.requests.filter(request => request.method === 'POST').length
    const retry = await context.run('resume')
    expect(retry.alreadyCompleted).toBe(true)
    expect(context.requests.filter(request => request.method === 'POST')).toHaveLength(writes)
  })
  it('preserves an originally disabled lane instead of assuming it should be enabled', async () => {
    const context = fixture()
    context.state.control.enabled = 0; context.state.control.models_enabled = 0
    await context.run()
    context.allowModelLane()
    await context.run('resume')
    expect(context.state.control).toMatchObject({ enabled: 0, models_enabled: 0, targets_complete: 1, revision: 6 })
  })
  it('cannot use the resume action to skip an unprepared operation', async () => {
    const context = fixture()
    await expect(context.run('resume')).rejects.toThrow('not_paused')
    expect(context.requests.some(request => request.method === 'POST')).toBe(false)
  })
  it('does not upload or mutate again when prepare is retried after exact target completion', async () => {
    const context = fixture()
    await context.run()
    const writes = context.requests.filter(request => request.method === 'POST').length
    const repeated = await context.run()
    expect(repeated.prepared).toBe(true)
    expect(context.requests.filter(request => request.method === 'POST')).toHaveLength(writes)
    expect(context.state.control).toMatchObject({ enabled: 0, models_enabled: 0, revision: 5, targets_complete: 1 })
  })
  it('prepares under a disabled deployment gate and refuses resume until a separate environment review', async () => {
    const context = fixture()
    await context.run()
    const writes = context.requests.filter(request => request.method === 'POST').length
    await expect(context.run('resume')).rejects.toThrow('resume_configuration_unavailable')
    expect(context.requests.filter(request => request.method === 'POST')).toHaveLength(writes)
    expect(context.state.control).toMatchObject({ enabled: 0, models_enabled: 0, revision: 5, targets_complete: 1 })
  })
})

describe('pinned native known-length target upload', () => {
  const environment = { CATALOG_MAINTENANCE_URL: 'https://studyinchina-test.example.workers.dev', CATALOG_MAINTENANCE_TOKEN: 'test-only-not-a-real-token-0000000000000000' }
  let bytes: Uint8Array<ArrayBuffer>
  const receipt = () => ({ ok: true, pending: true, validation: 'pending-queue', bodySha256: manifest.targetUpload.sha256,
    byteLength: manifest.targetUpload.byteLength, uploadKey: 'maintenance/reconciliation/test/targets.json', expectedRevision: 4, modelCallsPerformed: false })
  beforeAll(async () => {
    const scope = maintenanceScopeSchema.parse(JSON.parse(await readFile(resolve('content/maintenance/scope-272.v1.json'), 'utf8')))
    bytes = new TextEncoder().encode(canonicalJson({ inputCatalogSha256: manifest.newInputCatalogSha256, recordTargets: buildMaintenanceTargets(loadMaintenanceBundle(process.cwd()), scope) }))
  })
  it('sends pinned raw bytes with exact Content-Length, digest and CAS revision, without a query', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(receipt())))
    await expect(uploadReconciliationTargets(environment, bytes, 4, fetcher)).resolves.toMatchObject({ pending: true, modelCallsPerformed: false })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0], headers = new Headers(init?.headers)
    expect(String(url)).toBe('https://studyinchina-test.example.workers.dev/head-reconcile-targets')
    expect(init?.body).toBe(bytes)
    expect(init?.redirect).toBe('error')
    expect(headers.get('content-length')).toBe(String(manifest.targetUpload.byteLength))
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-maintenance-reconcile-sha256')).toBe(manifest.sha256)
    expect(headers.get('x-maintenance-targets-sha256')).toBe(manifest.targetUpload.sha256)
    expect(headers.get('x-maintenance-expected-revision')).toBe('4')
  })
  it('rejects different bytes and unsafe origins before sending a credential', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(uploadReconciliationTargets(environment, new Uint8Array([1, 2]), 4, fetcher)).rejects.toThrow('target_upload_pin')
    await expect(uploadReconciliationTargets({ ...environment, CATALOG_MAINTENANCE_URL: 'http://example.com/' }, bytes, 4, fetcher)).rejects.toThrow('maintenance_configuration_unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('accepts an exact already-completed upload receipt without claiming new queue work', async () => {
    const response = { ok: true, pending: false, targetsComplete: true, reused: true, bodySha256: manifest.targetUpload.sha256,
      byteLength: manifest.targetUpload.byteLength, expectedRevision: 4, modelCallsPerformed: false }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response)))
    await expect(uploadReconciliationTargets(environment, bytes, 4, fetcher)).resolves.toEqual(response)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('refuses a mismatched queue-validation receipt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), bodySha256: 'f'.repeat(64) })))
    await expect(uploadReconciliationTargets(environment, bytes, 4, fetcher)).rejects.toThrow('target_upload_receipt')
  })
  it('bounds even a headerless response before reading JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(17 * 1024)))
    await expect(uploadReconciliationTargets(environment, bytes, 4, fetcher)).rejects.toThrow('target_upload_response_size')
  })
})

describe('manual owner main runner boundary', () => {
  const valid = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'computersciencefreshmen/StudyInChina', GITHUB_ACTOR: 'computersciencefreshmen',
    GITHUB_TRIGGERING_ACTOR: 'computersciencefreshmen', GITHUB_SHA: 'a'.repeat(40), RECONCILIATION_OPERATION: manifest.operationId, RECONCILIATION_ACTION: 'prepare' }
  it('accepts the exact owner-dispatched committed main invocation', () => expect(() => requireTrustedReconciliationRunner(valid, valid.GITHUB_SHA)).not.toThrow())
  it.each([['GITHUB_ACTIONS', 'false'], ['GITHUB_EVENT_NAME', 'schedule'], ['GITHUB_REF', 'refs/heads/codex/other'],
    ['GITHUB_ACTOR', 'someone-else'], ['GITHUB_TRIGGERING_ACTOR', 'someone-else'], ['GITHUB_REPOSITORY', 'other/StudyInChina'],
    ['GITHUB_SHA', 'b'.repeat(40)], ['RECONCILIATION_OPERATION', 'another-operation'], ['RECONCILIATION_ACTION', 'all']])('refuses %s=%s', (key, value) => {
    expect(() => requireTrustedReconciliationRunner({ ...valid, [key]: value }, valid.GITHUB_SHA)).toThrow('trusted_main_owner_required')
  })
})
