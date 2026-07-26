function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

