const encoder = new TextEncoder()

export async function sha256Hex(value: ArrayBuffer | ArrayBufferView | string): Promise<string> {
  let bytes: Uint8Array
  if (typeof value === 'string') {
    bytes = encoder.encode(value)
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  } else {
    bytes = new Uint8Array(value)
  }

  // Copy into a fresh ArrayBuffer so the DOM BufferSource overload cannot see
  // a SharedArrayBuffer-backed ArrayBufferLike from an arbitrary view.
  const digestInput = new Uint8Array(bytes.byteLength)
  digestInput.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function stableJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

export function normalizeCanonicalText(
  input: string,
  options: { ignorePatterns?: string[]; collapseWhitespace?: boolean } = {},
): string {
  let output = input.normalize('NFKC').replace(/\r\n?/g, '\n')
  for (const pattern of options.ignorePatterns ?? []) {
    if (pattern.length === 0 || pattern.length > 500) continue
    try {
      output = output.replace(new RegExp(pattern, 'giu'), '')
    } catch {
      // Invalid trusted configuration is reported by manifest validation. This
      // guard keeps canonicalization deterministic if a stale manifest slips in.
    }
  }
  if (options.collapseWhitespace !== false) {
    output = output.replace(/[\t\f\v ]+/g, ' ').replace(/\n{3,}/g, '\n\n')
  }
  return output.trim()
}

export function contentTypeExtension(contentType: string): string {
  const normalized = contentType.toLowerCase().split(';', 1)[0]?.trim()
  const extensions: Record<string, string> = {
    'text/html': 'html',
    'application/xhtml+xml': 'html',
    'application/json': 'json',
    'application/ld+json': 'json',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/xml': 'xml',
    'application/xml': 'xml',
    'application/rss+xml': 'xml',
    'application/atom+xml': 'xml',
  }
  return extensions[normalized] ?? 'bin'
}

function safeSourceSegment(sourceId: string): string {
  const normalized = sourceId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized.replace(/^-+|-+$/g, '').slice(0, 120) || 'source'
}

export function snapshotObjectKey(
  sourceId: string,
  rawSha256: string,
  contentType: string,
): string {
  if (!/^[a-f0-9]{64}$/.test(rawSha256)) throw new Error('Invalid SHA-256 digest')
  return `snapshots/${rawSha256.slice(0, 2)}/${safeSourceSegment(sourceId)}/${rawSha256}.${contentTypeExtension(contentType)}`
}

export function extractionTextObjectKey(sourceId: string, rawSha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(rawSha256)) throw new Error('Invalid SHA-256 digest')
  return `derived/${rawSha256.slice(0, 2)}/${safeSourceSegment(sourceId)}/${rawSha256}.extraction.txt`
}
