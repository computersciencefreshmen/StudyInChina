import type { D1Database } from './types'
import type {
  ApplicationState,
  FieldMetaDto,
  LocalizedValue,
  OfficialSourceDto,
} from './sql-types'

export type RecordAuditRow = {
  record_id: string
  record_verified_at: string | null
  record_review_after: string | null
}

type LocalizedRow = {
  record_id: string
  locale: string
  field_name: string
  text_value: string
}

type FieldRow = {
  record_id: string
  field_path: string
  locale: string
  field_status: FieldMetaDto['status']
  value_json: string | null
  verified_at: string | null
  review_after: string | null
}

type SourceRow = {
  record_id: string
  field_path: string
  locale: string
  source_id: string
  url: string
  title: string
  publisher: string
  language_code: string
  authority_level: 'primary_official' | 'secondary_official'
  checked_at: string
}

export class CatalogQueryError extends Error {}
export class InvalidSearchQueryError extends Error {}

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1_000

export function chinaCalendarDate(now = new Date()) {
  return new Date(now.getTime() + CHINA_TIME_OFFSET_MS).toISOString().slice(0, 10)
}

export async function queryAll<T>(
  database: D1Database,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await database.prepare(sql).bind(...values).all<T>()
  if (!result.success) throw new CatalogQueryError(result.error ?? 'Catalog D1 query failed.')
  return result.results ?? []
}

export async function queryFirst<T>(
  database: D1Database,
  sql: string,
  values: unknown[] = [],
): Promise<T | null> {
  return database.prepare(sql).bind(...values).first<T>()
}

export function placeholders(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new CatalogQueryError('Invalid D1 placeholder count.')
  }
  return Array.from({ length: count }, () => '?').join(', ')
}

export function fts5Query(value: string) {
  const terms = value.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
  if (terms.length === 0 || terms.length > 20) {
    throw new InvalidSearchQueryError('Invalid search query.')
  }
  return terms.map((term) => `"${term}"*`).join(' AND ')
}

export function normalizeLanguageFilter(value: string) {
  const normalized = value.trim().toLocaleLowerCase()
  if (normalized === 'english') return 'en'
  if (normalized === 'chinese' || normalized === 'mandarin chinese') return 'zh'
  return normalized
}

export function applicationState(
  opensOn: string | null,
  closesOn: string | null,
  rolling: boolean | null,
  today: string,
): ApplicationState {
  if (rolling) return 'rolling'
  if (opensOn === null && closesOn === null) return 'not-announced'
  if (closesOn !== null && closesOn < today) return 'closed'
  if (opensOn !== null && opensOn > today) return 'upcoming'
  return 'open'
}

function uniqueSources(rows: SourceRow[]): OfficialSourceDto[] {
  const found = new Map<string, OfficialSourceDto>()
  for (const row of rows) {
    found.set(row.source_id, {
      id: row.source_id,
      url: row.url,
      title: row.title,
      publisher: row.publisher,
      languageCode: row.language_code,
      authorityLevel: row.authority_level,
      checkedAt: row.checked_at,
    })
  }
  return [...found.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export class RecordDecorations {
  constructor(
    private readonly localizedRows: LocalizedRow[],
    private readonly fieldRows: FieldRow[],
    private readonly sourceRows: SourceRow[],
  ) {}

  localized(recordId: string, fieldName: string): LocalizedValue | null {
    const values: LocalizedValue = {}
    for (const row of this.localizedRows) {
      if (row.record_id === recordId && row.field_name === fieldName) {
        values[row.locale] = row.text_value
      }
    }
    return Object.keys(values).length > 0 ? values : null
  }

  field(recordId: string, paths: readonly string[]) {
    return this.fieldRows.find((row) =>
      row.record_id === recordId && row.locale === '' && paths.includes(row.field_path),
    ) ?? this.fieldRows.find((row) =>
      row.record_id === recordId && paths.includes(row.field_path),
    ) ?? null
  }

  value<T>(recordId: string, paths: readonly string[]): T | null {
    const row = this.field(recordId, paths)
    if (!row || row.field_status !== 'known' || row.value_json === null) return null
    return JSON.parse(row.value_json) as T
  }

  sources(recordId: string): OfficialSourceDto[] {
    return uniqueSources(this.sourceRows.filter((row) => row.record_id === recordId))
  }

  meta(
    record: RecordAuditRow,
    paths: readonly string[],
    identity = false,
  ): FieldMetaDto {
    const field = identity ? null : this.field(record.record_id, paths)
    const matchingSources = this.sourceRows.filter((row) =>
      row.record_id === record.record_id
      && (row.field_path === '*' || paths.includes(row.field_path)),
    )
    const sources = uniqueSources(matchingSources)
    const fallbackSource = sources[0] ?? uniqueSources(
      this.sourceRows.filter((row) => row.record_id === record.record_id),
    )[0]
    const status = identity
      ? (fallbackSource ? 'known' : 'source_unavailable')
      : (field?.field_status ?? 'source_unavailable')
    return {
      status,
      officialUrl: fallbackSource?.url ?? '',
      sourceTitle: fallbackSource?.title ?? 'Official source unavailable',
      checkedAt: fallbackSource?.checkedAt
        ?? field?.verified_at
        ?? record.record_verified_at
        ?? '',
      verifiedAt: field?.verified_at ?? (identity ? record.record_verified_at : null),
      reviewAfter: field?.review_after ?? (identity ? record.record_review_after : null),
      sourceIds: sources.map((source) => source.id),
    }
  }
}

export async function loadRecordDecorations(
  database: D1Database,
  releaseId: string,
  recordIds: string[],
) {
  const ids = [...new Set(recordIds)]
  if (ids.length === 0) return new RecordDecorations([], [], [])
  const slots = placeholders(ids.length)
  const values = [releaseId, ...ids]
  const [localizedRows, fieldRows, sourceRows] = await Promise.all([
    queryAll<LocalizedRow>(database, `
      SELECT record_id, locale, field_name, text_value
      FROM current_localized_content
      WHERE release_id = ? AND record_id IN (${slots})
      ORDER BY record_id, field_name, locale
    `, values),
    queryAll<FieldRow>(database, `
      SELECT record_id, field_path, locale, field_status, value_json, verified_at, review_after
      FROM current_record_field_statuses
      WHERE release_id = ? AND record_id IN (${slots})
      ORDER BY record_id, field_path, locale
    `, values),
    queryAll<SourceRow>(database, `
      SELECT
        binding.record_id,
        binding.field_path,
        binding.locale,
        source.source_id,
        source.url,
        source.title,
        source.publisher,
        source.language_code,
        source.authority_level,
        source.checked_at
      FROM current_record_sources AS binding
      JOIN current_source_summaries AS source
        ON source.release_id = binding.release_id
       AND source.source_id = binding.source_id
      WHERE binding.release_id = ? AND binding.record_id IN (${slots})
      ORDER BY binding.record_id, source.source_id
    `, values),
  ])
  return new RecordDecorations(localizedRows, fieldRows, sourceRows)
}
