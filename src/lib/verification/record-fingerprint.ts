import { createHash } from 'node:crypto'

function businessValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(businessValue)
  if (!value || typeof value !== 'object') return value
  const auditFields = new Set(['status', 'verifiedAt', 'reviewAfter', 'accessedAt'])
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !auditFields.has(key)).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, businessValue(entry)]))
}

/** Status changes do not replay comparisons; changed facts or source identity invalidate them. */
export function minimaxRecordFingerprint(record: Record<string, unknown>, sources: readonly Record<string, unknown>[]): string {
  const sourceIds = Array.isArray(record.sourceIds) ? record.sourceIds : []
  const referenced = sources.filter(source => sourceIds.includes(source.id)).sort((left, right) => String(left.id).localeCompare(String(right.id)))
  return createHash('sha256').update(JSON.stringify(businessValue({ record, sources: referenced }))).digest('hex')
}
