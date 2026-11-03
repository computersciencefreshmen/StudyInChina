import type { AuditMeta, Source } from '@/lib/data/types'
import type { FactStatus, FieldMeta, OfficialSourceLink } from './types'

type RecordWithAudit = AuditMeta & { sourceIds: string[]; discovery?: { currentFieldPaths: string[]; fieldMeta?: Record<string, FieldMeta> } }

function isStale(record: RecordWithAudit, today: string) {
  return record.status === 'stale' || record.reviewAfter < today
}

export function officialSourcesFor(sourceIds: string[], sources: Source[]): OfficialSourceLink[] {
  const wanted = new Set(sourceIds)
  return sources
    .filter((source) => source.official && wanted.has(source.id))
    .map((source) => ({
      url: source.url,
      title: source.title,
      checkedAt: source.accessedAt,
    }))
}

export function fieldMetaFor(
  record: RecordWithAudit,
  sources: Source[],
  fallback: { url: string; title: string },
  value: unknown,
  today: string,
  emptyStatus: FactStatus = 'officially_not_announced',
  staleSensitive = true,
  fieldPath?: string,
): FieldMeta {
  return fieldMetaWithSource(record, sources.find(
    source => source.official && record.sourceIds.includes(source.id),
  ), fallback, value, today, emptyStatus, staleSensitive, fieldPath)
}

function fieldMetaWithSource(
  record: RecordWithAudit,
  officialSource: Source | undefined,
  fallback: { url: string; title: string },
  value: unknown,
  today: string,
  emptyStatus: FactStatus = 'officially_not_announced',
  staleSensitive = true,
  fieldPath?: string,
): FieldMeta {
  const verifiedField = fieldPath && staleSensitive && record.discovery?.currentFieldPaths.includes(fieldPath)
    ? record.discovery.fieldMeta?.[fieldPath] : undefined
  if (verifiedField) return verifiedField
  const officialUrl = officialSource?.url ?? fallback.url
  const sourceTitle = officialSource?.title ?? fallback.title
  const checkedAt = officialSource?.accessedAt ?? record.verifiedAt

  let status: FactStatus
  if (!officialSource || !officialUrl) status = 'source_unavailable'
  else if (staleSensitive && isStale(record, today)) status = 'stale'
  else if (value === null || value === undefined || value === '') status = emptyStatus
  else status = 'known'

  return { status, officialUrl, sourceTitle, checkedAt }
}

export function fieldMetaMap(
  record: RecordWithAudit,
  sources: Source[],
  fallback: { url: string; title: string },
  fields: Record<string, unknown>,
  today: string,
  emptyStatuses: Partial<Record<string, FactStatus>> = {},
  staleSensitive = true,
): Record<string, FieldMeta> {
  // Source precedence belongs to the record, not the individual field. Resolve
  // it once while retaining each field's independent receipt/freshness gate.
  const officialSource = sources.find(source => source.official && record.sourceIds.includes(source.id))
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      fieldMetaWithSource(
        record,
        officialSource,
        fallback,
        value,
        today,
        emptyStatuses[field],
        staleSensitive,
        field,
      ),
    ]),
  )
}
