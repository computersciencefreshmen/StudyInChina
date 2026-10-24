import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { candidateArtifactKeys, downloadMaintenanceExport, maintenanceClientFromEnvironment, recoverPendingMaintenancePublication } from '../../scripts/automation/catalog-maintenance-client'
import { canonicalJson, maintenanceCandidateExportSchema } from '../../scripts/maintenance/contracts'

const token = 'test-only-secret-that-is-never-a-real-account-token'
const environment = { CATALOG_MAINTENANCE_URL: 'https://maintenance-fixture.example.workers.dev', CATALOG_MAINTENANCE_TOKEN: token }

describe('maintenance bridge HTTP boundary', () => {
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
