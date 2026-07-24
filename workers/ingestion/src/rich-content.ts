import { readBoundedBody } from './body'
import { IngestionError } from './errors'

export type BrowserQuickActionInput = {
  url: string
  userAgent?: string
  gotoOptions: {
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
  }
  waitForSelector?: string
  allowRequestPattern: string[]
  rejectResourceTypes: Array<'image' | 'media' | 'font'>
}

export interface BrowserRunBinding {
  quickAction(
    action: 'content' | 'markdown',
    input: BrowserQuickActionInput,
  ): Promise<Response>
}

export type MarkdownConversionResult = {
  id?: string
  name?: string
  format: 'markdown' | 'text' | 'error'
  mimetype?: string
  tokens?: number
  data?: string
  error?: string
}

export interface WorkersAiBinding {
  toMarkdown(
    document: { name: string; blob: Blob },
    options?: { output?: { format?: 'markdown' | 'text' } },
  ): Promise<MarkdownConversionResult | MarkdownConversionResult[]>
}

export type BrowserRenderOptions = {
  url: string
  allowedHosts: string[]
  userAgent?: string
  waitUntil?: BrowserQuickActionInput['gotoOptions']['waitUntil']
  waitForSelector?: string
  timeoutMs: number
  maxBytes: number
  action?: 'content' | 'markdown'
}

const DOCUMENT_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
])

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp'])

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function allowedRequestPattern(hosts: string[]): string {
  const alternatives = [...new Set(hosts.map((host) => host.trim().toLowerCase()))]
    .filter(Boolean)
    .map(escapeRegex)
  if (alternatives.length === 0) {
    throw new IngestionError('Browser rendering requires an explicit host allowlist', 'browser_hosts_missing', false)
  }
  return `/^https:\\/\\/(?:${alternatives.join('|')})(?::443)?(?:\\/|$)/i`
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  code: string,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new IngestionError(message, code, true)), timeoutMs)
  })
  try {
    return await Promise.race([operation, deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function isConvertibleDocument(contentType: string, sourceUrl: string): boolean {
  const normalizedType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (DOCUMENT_CONTENT_TYPES.has(normalizedType)) return true
  try {
    const pathname = new URL(sourceUrl).pathname.toLowerCase()
    return [...DOCUMENT_EXTENSIONS].some((extension) => pathname.endsWith(extension))
  } catch {
    return false
  }
}

export async function renderBrowserPage(
  browser: BrowserRunBinding | undefined,
  options: BrowserRenderOptions,
): Promise<string> {
  if (!browser) {
    throw new IngestionError('Browser Run binding is not configured', 'browser_not_configured', false)
  }
  if (options.waitForSelector && options.waitForSelector.length > 200) {
    throw new IngestionError('Browser wait selector is too long', 'browser_selector_invalid', false)
  }

  const response = await withDeadline(
    browser.quickAction(options.action ?? 'content', {
      url: options.url,
      userAgent: options.userAgent,
      gotoOptions: { waitUntil: options.waitUntil ?? 'networkidle2' },
      ...(options.waitForSelector ? { waitForSelector: options.waitForSelector } : {}),
      allowRequestPattern: [allowedRequestPattern(options.allowedHosts)],
      rejectResourceTypes: ['image', 'media', 'font'],
    }),
    options.timeoutMs,
    'browser_timeout',
    'Browser rendering timed out',
  )
  if (!response.ok) {
    throw new IngestionError(
      `Browser rendering returned HTTP ${response.status}`,
      `browser_http_${response.status}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const bytes = await readBoundedBody(response, options.maxBytes, controller.signal)
    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch {
      throw new IngestionError('Browser rendering returned invalid JSON', 'browser_invalid_response', false)
    }
    if (!payload || typeof payload !== 'object') {
      throw new IngestionError('Browser rendering response is not an object', 'browser_invalid_response', false)
    }
    const envelope = payload as Record<string, unknown>
    if (envelope.success !== true || typeof envelope.result !== 'string' || !envelope.result.trim()) {
      throw new IngestionError('Browser rendering produced no usable text', 'browser_empty_result', false)
    }
    return envelope.result
  } finally {
    clearTimeout(timeout)
  }
}

export function renderBrowserMarkdown(
  browser: BrowserRunBinding | undefined,
  options: BrowserRenderOptions,
): Promise<string> {
  return renderBrowserPage(browser, { ...options, action: 'markdown' })
}

function documentName(sourceUrl: string, contentType: string): string {
  try {
    const segment = new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1)
    if (segment) return decodeURIComponent(segment).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
  } catch {
    // Fall through to a deterministic safe name.
  }
  return contentType.toLowerCase().includes('pdf') ? 'official-source.pdf' : 'official-source.png'
}

export async function convertDocumentToText(
  ai: WorkersAiBinding | undefined,
  bytes: ArrayBuffer,
  contentType: string,
  sourceUrl: string,
  options: { timeoutMs: number; maxCharacters: number },
): Promise<string> {
  if (!ai) {
    throw new IngestionError('Workers AI document conversion is not configured', 'document_conversion_not_configured', false)
  }
  const result = await withDeadline(
    ai.toMarkdown(
      {
        name: documentName(sourceUrl, contentType),
        blob: new Blob([bytes], { type: contentType }),
      },
      { output: { format: 'text' } },
    ),
    options.timeoutMs,
    'document_conversion_timeout',
    'Document conversion timed out',
  )
  if (Array.isArray(result) || result.format === 'error' || typeof result.data !== 'string') {
    const detail = Array.isArray(result) ? 'unexpected result list' : result.error ?? 'empty result'
    throw new IngestionError(`Document conversion failed: ${detail}`, 'document_conversion_failed', true)
  }
  if (!result.data.trim()) {
    throw new IngestionError('Document conversion produced no text', 'document_conversion_empty', false)
  }
  if (result.data.length > options.maxCharacters) {
    throw new IngestionError(
      `Converted document exceeds ${options.maxCharacters} characters`,
      'document_conversion_too_large',
      false,
    )
  }
  return result.data
}
