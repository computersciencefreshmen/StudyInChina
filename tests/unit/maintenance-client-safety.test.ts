import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { candidateArtifactKeys, downloadMaintenanceExport, maintenanceClientFromEnvironment, maintenanceRuntimeGate, recoverPendingMaintenancePublication } from '../../scripts/automation/catalog-maintenance-client'
import { canonicalJson, maintenanceCandidateExportSchema } from '../../scripts/maintenance/contracts'

const token = 'test-only-secret-that-is-never-a-real-account-token'
const environment = { CATALOG_MAINTENANCE_URL: 'https://maintenance-fixture.example.workers.dev', CATALOG_MAINTENANCE_TOKEN: token }
const gateFixture = { format: 'studyinchina.cloud-maintenance-runtime-gate', version: 1, fullHealthChecked: false, scopeMatches: true,
  backend: { state: 'ready' }, enabled: true, control: { scope_sha256: 'a'.repeat(64), input_catalog_sha256: 'b'.repeat(64),
    seed_sha256: 'c'.repeat(64), legacy_guard_sha256: 'd'.repeat(64), revision: 1, seed_complete: 1, targets_complete: 1 } }

describe('maintenance bridge HTTP boundary', () => {
  it.each(['/offline-fence', '/offline-handoff?batchId=offline-fixture_2026'])('allows the authenticated read-only status path %s', async path => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'))
    const client = maintenanceClientFromEnvironment(environment, fetcher)
    expect(await client.json(path)).toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe(`${environment.CATALOG_MAINTENANCE_URL}${path}`)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error' })
  })

  it('rejects handoff traversal, extra query parameters and mutation methods before sending credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(), client = maintenanceClientFromEnvironment(environment, fetcher)
    for (const path of ['/offline-fence/../controls', '/offline-fence?extra=1', '/offline-fence/acquire',
      '/offline-fence/release', '/offline-handoff', '/offline-handoff?batchId=', '/offline-handoff?batchId=../controls',
      '/offline-handoff?batchId=%2e%2e%2fcontrols', '/offline-handoff?batchId=ok&extra=1',
      '/offline-handoff?batchId=ok&batchId=other', '/offline-handoff?batchId=ok#fragment',
      `/offline-handoff?batchId=${'a'.repeat(102)}`]) {
      await expect(client.json(path)).rejects.toThrow('maintenance_endpoint_rejected')
    }
    for (const path of ['/offline-fence', '/offline-handoff?batchId=ok']) {
      await expect(client.json(path, 'POST')).rejects.toThrow('maintenance_endpoint_rejected')
      await expect(client.json(path, 'GET', {})).rejects.toThrow('maintenance_endpoint_rejected')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps normal quota and seed waits quiet while refusing an unknown backend failure', async () => {
    const client = { json: vi.fn(), artifact: vi.fn() }
    client.json.mockResolvedValue({ ...gateFixture, backend: { state: 'quota_wait' }, control: null })
    expect(await maintenanceRuntimeGate(client)).toMatchObject({ canStart: false, canRecover: false, reason: 'quota_wait' })
    client.json.mockResolvedValue({ ...gateFixture, control: null })
    expect(await maintenanceRuntimeGate(client)).toMatchObject({ canStart: false, canRecover: false, reason: 'seed_not_ready' })
    client.json.mockResolvedValue({ ...gateFixture, backend: { state: 'backend_unavailable' } })
    await expect(maintenanceRuntimeGate(client)).rejects.toThrow('maintenance_backend_unavailable')
  })
  it('allows prior publication recovery during an operator pause but blocks new work and unfinished targets', async () => {
    const client = { json: vi.fn().mockResolvedValue({ ...gateFixture, enabled: false }), artifact: vi.fn() }
    expect(await maintenanceRuntimeGate(client)).toMatchObject({ canRecover: true, canStart: false, reason: 'operator_pause' })
    client.json.mockResolvedValue({ ...gateFixture, control: { ...gateFixture.control, targets_complete: 0 } })
    expect(await maintenanceRuntimeGate(client)).toMatchObject({ canStart: false, reason: 'targets_not_ready' })
  })
  it('uses only the singleton gate, rejects wrong scope and never silently falls back to full status', async () => {
    const client = { json: vi.fn().mockResolvedValue(gateFixture), artifact: vi.fn() }
    expect(await maintenanceRuntimeGate(client)).toEqual({ canRecover: true, canStart: true, reason: 'ready' })
    expect(client.json).toHaveBeenCalledExactlyOnceWith('/runtime-gate')
    client.json.mockResolvedValue({ ...gateFixture, scopeMatches: false })
    expect(await maintenanceRuntimeGate(client)).toEqual({ canRecover: false, canStart: false, reason: 'scope_pin_mismatch' })
    client.json.mockRejectedValue(new Error('gate_unavailable'))
    await expect(maintenanceRuntimeGate(client)).rejects.toThrow('gate_unavailable')
    expect(client.json.mock.calls.every(([path]) => path === '/runtime-gate')).toBe(true)
  })
  it('allows only a fixed GET for the runtime gate and rejects old full-status payloads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(gateFixture)))
    const client = maintenanceClientFromEnvironment(environment, fetcher)
    expect(await client.json('/runtime-gate')).toEqual(gateFixture)
    for (const path of ['/runtime-gate?extra=1', '/runtime-gate/../controls', '/runtime-gate#fragment']) {
      await expect(client.json(path)).rejects.toThrow('maintenance_endpoint_rejected')
    }
    await expect(client.json('/runtime-gate', 'POST')).rejects.toThrow('maintenance_endpoint_rejected')
    await expect(client.json('/runtime-gate', 'GET', {})).rejects.toThrow('maintenance_endpoint_rejected')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(maintenanceRuntimeGate({ json: vi.fn().mockResolvedValue({ format: 'studyinchina.cloud-maintenance-status' }), artifact: vi.fn() })).rejects.toThrow('maintenance_runtime_status_invalid')
  })
  it('treats an empty 204 export queue as normal and never creates a fake batch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const client = maintenanceClientFromEnvironment(environment, fetcher)
    expect(await downloadMaintenanceExport(client, 'unused-no-export-directory')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
  })

  it('never follows a redirect and returns a secret-free error even if the transport error contains a token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`Transport log ${token}`))
    const client = maintenanceClientFromEnvironment(environment, fetcher)
    await expect(client.json('/status')).rejects.toThrow('maintenance_request_failed')
    try { await client.json('/status') } catch (error) { expect(String(error)).not.toContain(token) }
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
    const redirected = new Response('{}'); Object.defineProperty(redirected, 'redirected', { value: true })
    const second = maintenanceClientFromEnvironment(environment, vi.fn<typeof fetch>().mockResolvedValue(redirected))
    await expect(second.json('/status')).rejects.toThrow('maintenance_request_failed')
  })

  it('rejects external origins, arbitrary endpoints and artifact traversal before sending credentials', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(() => maintenanceClientFromEnvironment({ ...environment, CATALOG_MAINTENANCE_URL: 'https://attacker.example' }, fetcher)).toThrow('maintenance_configuration_unavailable')
    const client = maintenanceClientFromEnvironment(environment, fetcher)
    await expect(client.json('//attacker.example/status')).rejects.toThrow('maintenance_endpoint_rejected')
    await expect(client.artifact('maintenance/snapshots/../credential')).rejects.toThrow('maintenance_artifact_key_rejected')
    await expect(client.artifact('maintenance//credential')).rejects.toThrow('maintenance_artifact_key_rejected')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('checks response length and malformed JSON without dumping a response body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('secret response body', { headers: { 'content-length': String(9 * 1024 * 1024) } }))
      .mockResolvedValueOnce(new Response(`not JSON ${token}`))
    const client = maintenanceClientFromEnvironment(environment, fetcher)
    await expect(client.json('/status')).rejects.toThrow('maintenance_response_too_large')
    await expect(client.json('/status')).rejects.toThrow('maintenance_json_invalid')
  })

  it('accepts the bounded PDF handoff endpoints while rejecting an oversized batch query', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"documents":[]}'))
    const client = maintenanceClientFromEnvironment(environment, fetcher)
    expect(await client.json('/documents?limit=5')).toEqual({ documents: [] })
    await expect(client.json('/documents?limit=6')).rejects.toThrow('maintenance_endpoint_rejected')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('recovers the original applied commit only when its receipt and exact proposal partition match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maintenance-recovery-test-'))
    try {
      const content = { batchId: 'recover-batch', inputCatalogSha256: 'a'.repeat(64), outputCatalogSha256: 'b'.repeat(64),
        scopeRegistrySha256: 'c'.repeat(64), acceptedProposalIds: ['accepted-one'], held: [{ proposalId: 'held-one', reason: 'needs-review' }] }
      const sha256 = createHash('sha256').update(canonicalJson(content)).digest('hex')
      const directory = join(root, 'quality', 'maintenance', 'batches', content.batchId); mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'canonical-receipt.json'), JSON.stringify({ ...content, sha256 }))
      const pending = { batchId: content.batchId, inputCatalogSha256: content.inputCatalogSha256, scopeRegistrySha256: content.scopeRegistrySha256,
        status: 'applied', acknowledgement: { batchId: content.batchId, sourceCommit: 'd'.repeat(40), receiptSha256: sha256,
          newInputCatalogSha256: content.outputCatalogSha256, acceptedProposalIds: ['accepted-one'], heldProposalIds: ['held-one'] } }
      const client = { json: vi.fn().mockResolvedValue({ publications: [pending] }), artifact: vi.fn() }
      expect(await recoverPendingMaintenancePublication(client, root)).toMatchObject({ batchId: content.batchId, sourceCommit: 'd'.repeat(40), receiptPath: join(directory, 'canonical-receipt.json') })
      pending.acknowledgement.heldProposalIds = []
      await expect(recoverPendingMaintenancePublication(client, root)).rejects.toThrow('maintenance_publication_receipt_changed')
      expect(client.artifact).not.toHaveBeenCalled()
    } finally {
      const absolute = resolve(root)
      if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('maintenance-recovery-test-')) throw new Error('Unexpected cleanup path')
      rmSync(absolute, { recursive: true, force: true })
    }
  })
  it('downloads both a PDF derivative and separate institution evidence for the same approved package', () => {
    const batch = maintenanceCandidateExportSchema.parse({
      format: 'studyinchina.maintenance-candidate-export', formatVersion: 1, batchId: 'artifact-fixture',
      inputCatalogSha256: 'a'.repeat(64), scopeRegistrySha256: 'b'.repeat(64), createdAt: '2026-10-24T00:00:00.000Z', sha256: 'c'.repeat(64),
      proposals: [{ id: 'award-identity', universityId: 'uni-example', entityType: 'scholarship', recordId: null, operation: 'create',
        fields: { internationalAdmissionsEvidence: { objectKey: 'maintenance/raw-admissions.bin' }, institutionEvidence: { objectKey: 'maintenance/raw-institution.bin' } },
        source: { id: 'source-fixture', url: 'https://example.edu.cn/guide.pdf', snapshotSha256: 'd'.repeat(64), objectKey: 'maintenance/raw-guide.bin',
          checkedAt: '2026-10-24T00:00:00.000Z', contentType: 'application/pdf', locator: 'page 1', quote: 'Official evidence',
          textArtifact: { objectKey: 'maintenance/guide-text.txt', sha256: 'e'.repeat(64), rawSnapshotSha256: 'd'.repeat(64), parser: 'poppler' } },
        fieldEvidence: [{ sourceId: 'source-fixture', url: 'https://example.edu.cn/guide.pdf', snapshotSha256: 'd'.repeat(64), objectKey: 'maintenance/raw-guide.bin', locator: 'page 1', quote: 'Official evidence', fieldPath: 'name.en' }],
        scope: { year: null, intake: null }, status: 'held', warnings: [] }],
    })
    expect(candidateArtifactKeys(batch)).toEqual(['maintenance/guide-text.txt', 'maintenance/raw-admissions.bin', 'maintenance/raw-guide.bin', 'maintenance/raw-institution.bin'])
  })
})
