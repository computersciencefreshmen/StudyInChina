import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { maintenanceClientFromEnvironment, type MaintenanceClient } from './catalog-maintenance-client'
import {
  DOCUMENT_BATCH_LIMIT, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES, MAX_DOCUMENT_TEXT_BYTES,
  type PendingDocument,
} from '../../workers/catalog-maintenance/src/documents'

const execFileAsync = promisify(execFile)
export type DocumentTools = { pdfinfo: string; pdftotext: string; pdftoppm: string; tesseract: string; languages: string }
export type CommandRunner = (binary: string, args: string[], timeoutMs: number) => Promise<string>
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const defaultTools: DocumentTools = { pdfinfo: 'pdfinfo', pdftotext: 'pdftotext', pdftoppm: 'pdftoppm', tesseract: 'tesseract', languages: 'eng+chi_sim' }
const runCommand: CommandRunner = async (binary, args, timeout) => {
  try { return (await execFileAsync(binary, args, { timeout, maxBuffer: MAX_DOCUMENT_TEXT_BYTES, windowsHide: true })).stdout }
  catch (error) {
    const commandError = error as NodeJS.ErrnoException & { killed?: boolean }
    if (commandError.killed || commandError.code === 'ETIMEDOUT') throw new Error('document_processing_timeout')
    throw error
  }
}

export function parsePdfPageCount(info: string): number {
  const match = /^Pages:\s+(\d+)\s*$/imu.exec(info)
  const pages = match ? Number(match[1]) : 0
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_DOCUMENT_PAGES) throw new Error('document_page_limit_or_info_invalid')
  if (/^Encrypted:\s+yes/imu.test(info)) throw new Error('document_encrypted_not_supported')
  return pages
}

/** Local standard tools parse immutable downloaded bytes. No model or university request occurs here. */
export async function extractPdfDocument(bytes: Uint8Array, expectedSha256: string, options: {
  tools?: Partial<DocumentTools>; runner?: CommandRunner; timeoutMs?: number; temporaryRoot?: string;
} = {}): Promise<{ text: string; textSha256: string; parser: 'poppler' | 'tesseract'; pageCount: number }> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES || digest(bytes) !== expectedSha256
    || !new TextDecoder().decode(bytes.slice(0, 5)).startsWith('%PDF-')) throw new Error('document_download_checksum_or_size_invalid')
  const tools = { ...defaultTools, ...options.tools }, runner = options.runner ?? runCommand
  const root = resolve(options.temporaryRoot ?? tmpdir()), workspace = await mkdtemp(join(root, 'studyinchina-documents-'))
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 180_000, 180_000)
  const remaining = (limit: number) => { const time = Math.min(limit, deadline - Date.now()); if (time <= 0) throw new Error('document_processing_timeout'); return time }
  try {
    const file = join(workspace, 'source.pdf'); await writeFile(file, bytes, { flag: 'wx' })
    const pageCount = parsePdfPageCount(await runner(tools.pdfinfo, [file], remaining(15_000)))
    const extracted = await runner(tools.pdftotext, ['-layout', '-enc', 'UTF-8', file, '-'], remaining(45_000))
    // Poppler separates pages with form feeds; retain those positions through OCR.
    const pages = extracted.split('\f')
    if (pages.length > pageCount && !pages.at(-1)?.trim()) pages.pop()
    if (pages.length > pageCount) throw new Error('document_extracted_page_count_invalid')
    while (pages.length < pageCount) pages.push('')
    const emptyPages = pages.flatMap((text, index) => text.trim() ? [] : [index + 1])
    for (const page of emptyPages) {
      const prefix = join(workspace, `page-${page}`)
      await runner(tools.pdftoppm, ['-f', String(page), '-l', String(page), '-scale-to', '1600', '-singlefile', '-png', file, prefix], remaining(30_000))
      const filename = `${prefix}.png`
      // Existence is enforced by real Tesseract. Mock command runners may create no raster file.
      pages[page - 1] = await runner(tools.tesseract, [filename, 'stdout', '-l', tools.languages], remaining(30_000))
    }
    const text = `${pages.join('\f')}\f`
    if (!text.replace(/\s/gu, '') || Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_TEXT_BYTES) throw new Error('document_empty_or_oversize_text')
    // The raster list is bounded by one page at a time and one image per page.
    if ((await readdir(workspace)).length > MAX_DOCUMENT_PAGES + 1) throw new Error('document_raster_limit_exceeded')
    return { text, textSha256: digest(text), parser: emptyPages.length ? 'tesseract' : 'poppler', pageCount }
  } finally {
    const absolute = resolve(workspace)
    if (dirname(absolute) !== root || !basename(absolute).startsWith('studyinchina-documents-')) throw new Error('document_cleanup_target_invalid')
    await rm(absolute, { recursive: true, force: true })
  }
}

export async function processMaintenanceDocuments(client: MaintenanceClient, options: {
  limit?: number; extract?: typeof extractPdfDocument; tools?: Partial<DocumentTools>;
} = {}) {
  const limit = options.limit ?? DOCUMENT_BATCH_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > DOCUMENT_BATCH_LIMIT) throw new Error('document_batch_limit_invalid')
  const response = await client.json(`/documents?limit=${limit}`) as { documents?: PendingDocument[] }
  if (!Array.isArray(response.documents) || response.documents.length > limit) throw new Error('document_pending_response_invalid')
  const results: Array<{ sourceId: string; status: 'processed' | 'held'; reason?: string }> = []
  for (const document of response.documents) {
    try {
      if (!/^[a-f0-9]{64}$/u.test(document.sourceId) || !/^[a-f0-9]{64}$/u.test(document.rawSha256)
        || document.rawKey !== `maintenance/snapshots/${document.sourceId}/${document.rawSha256}.bin`
        || document.snapshotKey !== `maintenance/snapshots/${document.sourceId}/${document.rawSha256}.json`) throw new Error('document_pending_binding_invalid')
      const bytes = await client.artifact(document.rawKey)
      const extracted = await (options.extract ?? extractPdfDocument)(bytes, document.rawSha256, { tools: options.tools })
      await client.json('/documents', 'POST', { sourceId: document.sourceId, rawSha256: document.rawSha256,
        rawKey: document.rawKey, snapshotKey: document.snapshotKey, ...extracted, processedAt: new Date().toISOString() })
      results.push({ sourceId: document.sourceId, status: 'processed' })
    } catch (error) {
      const message = error instanceof Error && /^document_[a-z_]+$/u.test(error.message) ? error.message : 'document_processing_failed'
      // Persist an exact-byte failure so five unsupported documents cannot starve the entire queue.
      // Transport/configuration failures remain retryable; they say nothing about this document.
      if (/^document_(?:page_limit_or_info_invalid|encrypted_not_supported|empty_or_oversize_text|extracted_page_count_invalid|processing_timeout|raster_limit_exceeded)$/u.test(message)) {
        await client.json('/documents', 'POST', { outcome: 'held', sourceId: document.sourceId,
          rawSha256: document.rawSha256, reason: message, reportedAt: new Date().toISOString() })
      }
      results.push({ sourceId: document.sourceId, status: 'held', reason: message })
    }
  }
  return { processed: results.filter(result => result.status === 'processed').length, held: results.filter(result => result.status === 'held').length, results }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), index = args.indexOf('--limit')
  if (args.some(arg => arg.startsWith('--') && arg !== '--limit')) throw new Error('document_argument_invalid')
  const result = await processMaintenanceDocuments(maintenanceClientFromEnvironment(process.env), {
    limit: index >= 0 ? Number(args[index + 1]) : DOCUMENT_BATCH_LIMIT,
    tools: { pdfinfo: process.env.PDFINFO_PATH ?? 'pdfinfo', pdftotext: process.env.PDFTOTEXT_PATH ?? 'pdftotext',
      pdftoppm: process.env.PDFTOPPM_PATH ?? 'pdftoppm', tesseract: process.env.TESSERACT_PATH ?? 'tesseract', languages: process.env.TESSERACT_LANGUAGES ?? 'eng+chi_sim' },
  })
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error && /^document_|^maintenance_/u.test(error.message) ? error.message : 'document_command_failed'); process.exitCode = 1 })
}
