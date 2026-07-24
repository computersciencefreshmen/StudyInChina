import type { AuditMeta, Source } from '@/lib/data/types'
import type { FactStatus, FieldMeta, OfficialSourceLink } from './types'

type RecordWithAudit = AuditMeta & { sourceIds: string[] }

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
): FieldMeta {
  const officialSource = sources.find(
    (source) => source.official && record.sourceIds.includes(source.id),
  )
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
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      fieldMetaFor(
        record,
        sources,
        fallback,
        value,
        today,
        emptyStatuses[field],
        staleSensitive,
      ),
    ]),
  )
}
