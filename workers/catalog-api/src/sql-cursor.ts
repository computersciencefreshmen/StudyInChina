type CursorResource = 'institutions' | 'programs' | 'scholarships'

type CursorPayload = {
  v: 3
  resource: CursorResource
  releaseId: string
  context: string
  sortKey: string
  id: string
  pageIndex: number | null
}

type DecodedCursor = Pick<CursorPayload, 'sortKey' | 'id' | 'pageIndex'>

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor.')
    this.name = 'InvalidCursorError'
  }
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new InvalidCursorError()
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

export function encodeCursor(
  resource: CursorResource,
  releaseId: string,
  sortKey: string,
  id: string,
  context = 'default',
  pageIndex: number | null = null,
) {
  if (pageIndex !== null && (!Number.isSafeInteger(pageIndex) || pageIndex < 2)) {
    throw new InvalidCursorError()
  }
  return toBase64Url(JSON.stringify({
    v: 3, resource, releaseId, context, sortKey, id, pageIndex,
  } satisfies CursorPayload))
}

export function decodeCursor(
  value: string,
  resource: CursorResource,
  releaseId: string,
  context = 'default',
): DecodedCursor {
  if (value.length > 1_024) throw new InvalidCursorError()
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as {
      v?: unknown
      resource?: unknown
      releaseId?: unknown
      context?: unknown
      sortKey?: unknown
      id?: unknown
      pageIndex?: unknown
    }
    if (
      parsed.resource !== resource
      || parsed.releaseId !== releaseId
      || typeof parsed.sortKey !== 'string'
      || typeof parsed.id !== 'string'
      || parsed.sortKey.length > 320
      || parsed.id.length === 0
      || parsed.id.length > 200
    ) throw new InvalidCursorError()
    const { sortKey, id } = parsed

    if (parsed.v === 1) {
      if (context !== 'default') throw new InvalidCursorError()
      return { sortKey, id, pageIndex: null }
    }

    if (
      (parsed.v !== 2 && parsed.v !== 3)
      || parsed.context !== context
      || typeof parsed.context !== 'string'
      || parsed.context.length === 0
      || parsed.context.length > 80
    ) {
      throw new InvalidCursorError()
    }
    if (parsed.v === 2) return { sortKey, id, pageIndex: null }
    if (
      parsed.pageIndex !== null
      && (!Number.isSafeInteger(parsed.pageIndex) || Number(parsed.pageIndex) < 2)
    ) {
      throw new InvalidCursorError()
    }
    return {
      sortKey,
      id,
      pageIndex: parsed.pageIndex === null ? null : Number(parsed.pageIndex),
    }
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error
    throw new InvalidCursorError()
  }
}

