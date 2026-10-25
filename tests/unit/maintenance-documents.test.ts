import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptDocumentDerivative, listPendingDocuments } from '../../workers/catalog-maintenance/src/documents'
import { extractPdfDocument, parsePdfPageCount, processMaintenanceDocuments, type CommandRunner } from '../../scripts/automation/process-maintenance-documents'
import type { MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'
import type { MaintenanceEnv } from '../../workers/catalog-maintenance/src/types'

const mocks = vi.hoisted(() => ({ source: vi.fn(), queue: vi.fn(), control: vi.fn(), snapshot: vi.fn() }))
vi.mock('../../workers/catalog-maintenance/src/repository', () => ({ source: mocks.source, queueExtraction: mocks.queue, control: mocks.control }))
vi.mock('../../workers/catalog-maintenance/src/capture', () => ({ loadSnapshot: mocks.snapshot }))
beforeAll(() => { vi.stubGlobal('crypto', webcrypto) })
beforeEach(() => { vi.clearAllMocks() })
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const raw = new TextEncoder().encode('%PDF-1.7\nfixture-pdf-bytes')
const sourceId = 'a'.repeat(64), rawSha256 = sha(raw)
const rawKey = `maintenance/snapshots/${sourceId}/${rawSha256}.bin`
const snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha256}.json`
const checkedAt = '2026-10-24T00:00:00.000Z'

function environment() {
  const data = new Map<string, unknown>()
  const bucket = new Map<string, string | Uint8Array>([[rawKey, raw]])
  const queries: string[] = []
  mocks.source.mockResolvedValue({ source_id: sourceId, enabled: 1, raw_sha256: rawSha256, snapshot_key: snapshotKey })
  mocks.control.mockResolvedValue({ seed_complete: 1, canary_json: '[]' })
  mocks.snapshot.mockResolvedValue({ version: 1, sourceId, rawSha256, rawKey, checkedAt,
    sourceUrl: 'https://example.edu.cn/catalogue.pdf', finalUrl: 'https://example.edu.cn/catalogue.pdf', contentType: 'application/pdf' })
  const env = { PIPELINE_DB: { prepare: (sql: string) => {
    queries.push(sql)
    let args: unknown[] = []
    const statement = {
      bind: (...values: unknown[]) => { args = values; return statement },
      first: async () => sql.includes('document_derivatives') ? data.get('derivative') ?? null : null,
      all: async () => ({ results: [{ source_id: sourceId, raw_sha256: rawSha256, snapshot_key: snapshotKey }] }),
      run: async () => {
        if (sql.includes('INSERT OR IGNORE INTO maintenance_document_derivatives')) data.set('derivative', { text_key: args[4], text_sha256: args[5], parser: args[6], page_count: args[7] })
        if (sql.includes('maintenance_document_failures')) data.set('failure', args)
        return { success: true }
      },
    }; return statement
  } }, SNAPSHOTS_BUCKET: {
    get: async (key: string) => bucket.has(key) ? { size: typeof bucket.get(key) === 'string' ? String(bucket.get(key)).length : (bucket.get(key) as Uint8Array).byteLength,
      arrayBuffer: async () => { const value = bucket.get(key)!; return typeof value === 'string' ? new TextEncoder().encode(value).buffer : value.buffer }, text: async () => String(bucket.get(key)) } : null,
    put: async (key: string, body: string) => { bucket.set(key, body) },
  } } as unknown as MaintenanceEnv
  const text = 'First page\fSecond page\f'
  const payload = { sourceId, rawSha256, rawKey, snapshotKey, text, textSha256: sha(text), parser: 'poppler', pageCount: 2, processedAt: '2026-10-24T01:00:00.000Z' }
  return { env, payload, bucket, data, queries }
}

describe('immutable PDF handoff and bounded local processing', () => {
  it('accepts checksum-bound text and queues processing without renewing capture time', async () => {
    const fixture = environment()
    expect(await acceptDocumentDerivative(fixture.env, fixture.payload)).toMatchObject({ ok: true, reused: false, checkedAt })
    expect(mocks.queue).toHaveBeenCalledWith(fixture.env, expect.anything(), rawSha256, snapshotKey)
    expect(fixture.bucket.get(`maintenance/text/${sourceId}/${fixture.payload.textSha256}.txt`)).toBe(fixture.payload.text)
    expect(await acceptDocumentDerivative(fixture.env, fixture.payload)).toMatchObject({ reused: true, checkedAt })
  })
  it('rejects a changed current snapshot, altered bytes, or fabricated text checksum', async () => {
    const first = environment(); mocks.source.mockResolvedValueOnce({ enabled: 1, raw_sha256: '0'.repeat(64), snapshot_key: snapshotKey })
    await expect(acceptDocumentDerivative(first.env, first.payload)).rejects.toThrow('document_source_changed')
    const second = environment(); second.bucket.set(rawKey, new TextEncoder().encode('different'))
    await expect(acceptDocumentDerivative(second.env, second.payload)).rejects.toThrow('document_raw_checksum_invalid')
    const third = environment(); third.payload.textSha256 = '0'.repeat(64)
    await expect(acceptDocumentDerivative(third.env, third.payload)).rejects.toThrow('document_text_checksum_or_size_invalid')
  })
  it('excludes failed exact-byte documents from subsequent pending selection', async () => {
    const fixture = environment()
    await acceptDocumentDerivative(fixture.env, { outcome: 'held', sourceId, rawSha256, reason: 'document_encrypted_not_supported', reportedAt: '2026-10-24T01:00:00.000Z' })
    expect(fixture.data.has('failure')).toBe(true)
    await listPendingDocuments(fixture.env)
    expect(fixture.queries.find(query => query.includes('ORDER BY'))).toContain('maintenance_document_failures')
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it('uses text extraction without OCR for an already readable PDF', async () => {
    const commands: string[] = []
    const runner: CommandRunner = async binary => { commands.push(binary); return binary === 'pdfinfo' ? 'Pages: 2\nEncrypted: no\n' : 'Page one\fPage two\f' }
    const result = await extractPdfDocument(raw, rawSha256, { runner })
    expect(result).toMatchObject({ text: 'Page one\fPage two\f', parser: 'poppler', pageCount: 2 })
    expect(commands).toEqual(['pdfinfo', 'pdftotext'])
  })
  it('OCRs only empty pages and preserves the complete document page sequence', async () => {
    const calls: Array<{ binary: string; args: string[] }> = []
    const runner: CommandRunner = async (binary, args) => { calls.push({ binary, args }); return binary === 'pdfinfo' ? 'Pages: 2\nEncrypted: no\n'
      : binary === 'pdftotext' ? 'Page one\f\f' : binary === 'tesseract' ? 'Scanned page two' : '' }
    expect(await extractPdfDocument(raw, rawSha256, { runner })).toMatchObject({ text: 'Page one\fScanned page two\f', parser: 'tesseract' })
    expect(calls.find(call => call.binary === 'pdftoppm')!.args.slice(0, 4)).toEqual(['-f', '2', '-l', '2'])
    expect(calls.filter(call => call.binary === 'tesseract')).toHaveLength(1)
  })
  it('rejects encrypted, oversized and more-than-100-page PDFs before rasterization', async () => {
    expect(() => parsePdfPageCount('Pages: 101')).toThrow('document_page_limit_or_info_invalid')
    expect(() => parsePdfPageCount('Pages: 1\nEncrypted: yes')).toThrow('document_encrypted_not_supported')
    const runner = vi.fn<CommandRunner>()
    await expect(extractPdfDocument(raw, '0'.repeat(64), { runner })).rejects.toThrow('document_download_checksum_or_size_invalid')
    await expect(extractPdfDocument(new Uint8Array(10 * 1024 * 1024 + 1), '0'.repeat(64), { runner })).rejects.toThrow('document_download_checksum_or_size_invalid')
    expect(runner).not.toHaveBeenCalled()
  })
  it('sends derivatives through the authenticated existing client and never fetches a university', async () => {
    const document = { sourceId, rawSha256, rawKey, snapshotKey, checkedAt, sourceUrl: 'https://example.edu.cn/catalogue.pdf', finalUrl: 'https://example.edu.cn/catalogue.pdf', contentType: 'application/pdf' }
    const json = vi.fn().mockResolvedValueOnce({ documents: [document] }).mockResolvedValue({ ok: true })
    const client: MaintenanceClient = { json, artifact: vi.fn().mockResolvedValue(raw) }
    const extract = vi.fn<typeof extractPdfDocument>().mockResolvedValue({ text: 'Text\f', textSha256: sha('Text\f'), parser: 'poppler', pageCount: 1 })
    expect(await processMaintenanceDocuments(client, { extract })).toMatchObject({ processed: 1, held: 0 })
    expect(json.mock.calls[1][0]).toBe('/documents')
    expect(json.mock.calls[1][2]).not.toHaveProperty('checkedAt')
    expect(extract).toHaveBeenCalledWith(raw, rawSha256, expect.anything())
  })
  it('does not download an artifact key belonging to another snapshot or a traversal path', async () => {
    const client: MaintenanceClient = { json: vi.fn().mockResolvedValue({ documents: [{ sourceId, rawSha256,
      rawKey: 'maintenance/snapshots/../other.bin', snapshotKey, checkedAt, contentType: 'application/pdf' }] }), artifact: vi.fn() }
    const result = await processMaintenanceDocuments(client)
    expect(result.results).toEqual([{ sourceId, status: 'held', reason: 'document_pending_binding_invalid' }])
    expect(client.artifact).not.toHaveBeenCalled()
  })
})
