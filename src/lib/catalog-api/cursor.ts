import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

export type CursorResource = 'institutions' | 'programs' | 'scholarships'

type CursorPayload = {
  v: 2
  resource: CursorResource
  queryFingerprint: string
  sortKey: string
  id: string
}

type CursorBinding = Pick<CursorPayload, 'resource' | 'queryFingerprint'>

const RESOURCE_SET = new Set<CursorResource>(['institutions', 'programs', 'scholarships'])
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/u

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

function canonicalQueryValue(resource: CursorResource, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (key === 'sort' && value === 'default') return undefined

  if (typeof value === 'string') {
    if (key === 'q') {
      const normalized = value.trim().toLocaleLowerCase()
      if (resource !== 'institutions') return normalized || undefined
      const terms = normalized.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
      return [...new Set(terms)].sort().join('\u001f') || undefined
    }
    if (key === 'language') return value.toLocaleLowerCase()
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidCursorError()
    return value
  }
  if (typeof value === 'boolean') return value
  throw new InvalidCursorError()
}

export function cursorQueryFingerprint(resource: CursorResource, query: object): string {
  const entries = Object.entries(query)
    .filter(([key]) => key !== 'cursor' && key !== 'limit')
    .map(([key, value]) => [key, canonicalQueryValue(resource, key, value)] as const)
    .filter((entry): entry is readonly [string, string | number | boolean] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))

  return createHash('sha256')
    .update(JSON.stringify([resource, entries]), 'utf8')
    .digest('base64url')
}

function bindingFor(resource: CursorResource, query: object): CursorBinding {
  return { resource, queryFingerprint: cursorQueryFingerprint(resource, query) }
}

export function encodeCursor(
  resource: CursorResource,
  query: object,
  sortKey: string,
  id: string,
): string {
  const payload: CursorPayload = {
    v: 2,
    ...bindingFor(resource, query),
    sortKey,
    id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(
  value: string,
  resource: CursorResource,
  query: object,
): Pick<CursorPayload, 'sortKey' | 'id'> {
  if (value.length === 0 || value.length > 1_024 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new InvalidCursorError()
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      v?: unknown
      resource?: unknown
      queryFingerprint?: unknown
      sortKey?: unknown
      id?: unknown
    }
    const expected = bindingFor(resource, query)
    if (
      parsed.v !== 2
      || typeof parsed.resource !== 'string'
      || !RESOURCE_SET.has(parsed.resource as CursorResource)
      || parsed.resource !== expected.resource
      || typeof parsed.queryFingerprint !== 'string'
      || !FINGERPRINT_PATTERN.test(parsed.queryFingerprint)
      || parsed.queryFingerprint !== expected.queryFingerprint
      || typeof parsed.sortKey !== 'string'
      || parsed.sortKey.length === 0
      || parsed.sortKey.length > 320
      || typeof parsed.id !== 'string'
      || parsed.id.length === 0
      || parsed.id.length > 200
    ) {
      throw new InvalidCursorError()
    }
    return { sortKey: parsed.sortKey, id: parsed.id }
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error
    throw new InvalidCursorError()
  }
}

export function paginateBySlug<
  T extends { id: string; slug: string },
  Q extends { cursor?: string; limit?: number },
>(
  records: T[],
  resource: CursorResource,
  options: Q,
): { items: T[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100)
  const sorted = [...records].sort((left, right) =>
    left.slug.localeCompare(right.slug) || left.id.localeCompare(right.id),
  )
  const cursor = options.cursor ? decodeCursor(options.cursor, resource, options) : null
  const start = cursor
    ? sorted.findIndex((item) => item.slug === cursor.sortKey && item.id === cursor.id) + 1
    : 0

  if (cursor && start === 0) throw new InvalidCursorError()

  const items = sorted.slice(start, start + limit)
  const hasMore = start + items.length < sorted.length
  const last = items.at(-1)

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(resource, options, last.slug, last.id) : null,
  }
}
