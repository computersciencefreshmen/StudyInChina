const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024
const MAX_DOCUMENT_XML = 2 * 1024 * 1024
const MAX_PDF_PAGES = 20
const MAX_TEXT = 160_000
const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'])
const obsoleteWordText = new Set(['del', 'moveFrom'])

export type CVReadErrorCode = 'unsupported' | 'legacyWord' | 'tooLarge' | 'protectedPdf' | 'noText' | 'unreadable'
export class CVReadError extends Error {
  constructor(readonly code: CVReadErrorCode) { super(code) }
}

async function readPdf(data: Uint8Array) {
  const { getDocument } = await import('unpdf/pdfjs')
  const task = getDocument({ data, useWorkerFetch: false, useWasm: false, disableFontFace: true,
    useSystemFonts: false, isOffscreenCanvasSupported: false, stopAtErrors: true, verbosity: 0 })
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PDF_PAGES) throw new CVReadError('tooLarge')
    const pages: string[] = []
    let size = 0
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      try {
        const { items } = await page.getTextContent()
        const lines: string[] = []
        let line = '', previousY: number | undefined
        for (const item of items) {
          if (!('str' in item)) continue
          const y = item.transform[5]
          if (line && previousY !== undefined && Math.abs(previousY - y) > Math.max(2, item.height * 0.35)) {
            lines.push(line); line = ''
          }
          line += item.str
          if (item.hasEOL) { lines.push(line); line = '' }
          previousY = y
        }
        lines.push(line)
        const text = lines.join('\n')
        size += text.length
        if (size > MAX_TEXT) throw new CVReadError('tooLarge')
        pages.push(text)
      } finally { page.cleanup() }
    }
    return pages.join('\n\n')
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new CVReadError('protectedPdf')
    throw error
  } finally { await task.destroy() }
}

async function readWord(data: Uint8Array) {
  const { unzipSync } = await import('fflate')
  const documentXml = unzipSync(data, { filter: entry => {
    if (entry.name !== 'word/document.xml') return false
    if (entry.originalSize > MAX_DOCUMENT_XML) throw new CVReadError('tooLarge')
    return true
  } })['word/document.xml']
  if (!documentXml || documentXml.byteLength > MAX_DOCUMENT_XML) throw new CVReadError('unreadable')
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(documentXml)
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new CVReadError('unreadable')
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  const root = dom.documentElement
  if (root.localName !== 'document' || !root.namespaceURI || !wordNamespaces.has(root.namespaceURI)) throw new CVReadError('unreadable')
  const ns = root.namespaceURI
  const body = root.getElementsByTagNameNS(ns, 'body')[0]
  if (!body) throw new CVReadError('unreadable')
  return Array.from(body.getElementsByTagNameNS(ns, 'p'), paragraph => {
    for (let parent = paragraph.parentElement; parent && parent !== body; parent = parent.parentElement) {
      if (parent.namespaceURI === ns && obsoleteWordText.has(parent.localName)) return ''
    }
    const fragments: string[] = []
    const walker = dom.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT, node => {
      const element = node as Element
      if (element.namespaceURI === ns && (element.localName === 'p' || obsoleteWordText.has(element.localName))) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node as Element
      if (element.namespaceURI !== ns) continue
      if (element.localName === 't') fragments.push(element.textContent || '')
      if (element.localName === 'tab') fragments.push(' ')
      if (element.localName === 'br' || element.localName === 'cr') fragments.push('\n')
    }
    return fragments.join('')
  }).join('\n')
}

/** This reader takes local bytes and returns plain text. */
export async function readCVDocument(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'doc') throw new CVReadError('legacyWord')
  if (!file.name.includes('.') || (extension !== 'txt' && extension !== 'pdf' && extension !== 'docx')) throw new CVReadError('unsupported')
  if (file.size > (extension === 'txt' ? MAX_TEXT_BYTES - 1 : MAX_DOCUMENT_BYTES)) throw new CVReadError('tooLarge')
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = extension === 'pdf' ? await readPdf(bytes) : extension === 'docx' ? await readWord(bytes)
      : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.length > MAX_TEXT) throw new CVReadError('tooLarge')
    if (!/[\p{L}\p{N}]/u.test(text)) throw new CVReadError('noText')
    return text
  } catch (error) {
    if (error instanceof CVReadError) throw error
    throw new CVReadError('unreadable')
  }
}
