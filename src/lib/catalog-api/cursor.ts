import { Buffer } from 'node:buffer'

type CursorPayload = {
  v: 1
  sortKey: string
  id: string
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

export function encodeCursor(sortKey: string, id: string): string {
  const payload: CursorPayload = { v: 1, sortKey, id }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(value: string): CursorPayload {
  if (value.length > 1024) throw new InvalidCursorError()
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorPayload>
    if (parsed.v !== 1 || typeof parsed.sortKey !== 'string' || typeof parsed.id !== 'string') {
      throw new InvalidCursorError()
    }
    return parsed as CursorPayload
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error
    throw new InvalidCursorError()
  }
}

export function paginateBySlug<T extends { id: string; slug: string }>(
  records: T[],
  options: { cursor?: string; limit?: number },
): { items: T[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100)
  const sorted = [...records].sort((left, right) =>
    left.slug.localeCompare(right.slug) || left.id.localeCompare(right.id),
  )
  const cursor = options.cursor ? decodeCursor(options.cursor) : null
  const start = cursor
    ? sorted.findIndex((item) => item.slug === cursor.sortKey && item.id === cursor.id) + 1
    : 0

  if (cursor && start === 0) throw new InvalidCursorError()

  const items = sorted.slice(start, start + limit)
  const hasMore = start + items.length < sorted.length
  const last = items.at(-1)

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.slug, last.id) : null,
  }
}
