import type {
  ReleaseArtifact,
  ReleaseTableName,
  SqlRow,
  SqlValue,
} from './types'
import { RELEASE_TABLES } from './types'

export class ReleaseValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ReleaseValidationError'
    this.code = code
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, child]) => [key, canonical(child)]),
    )
  }
  return value
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new ReleaseValidationError('invalid_json', `${label} is not valid JSON`)
  }
}

export function canonicalJsonText(value: string, label: string): string {
  return stableJson(parseJson(value, label))
}

export function isoDate(value: string, label: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new ReleaseValidationError('invalid_date', `${label} is not a valid date`)
  }
  return date.toISOString().slice(0, 10)
}

export function ensureSqlRow(value: unknown, label: string): SqlRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReleaseValidationError('invalid_artifact', `${label} must be an object`)
  }
  const result: SqlRow = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child !== null && typeof child !== 'string' && typeof child !== 'number') {
      throw new ReleaseValidationError(
        'invalid_artifact',
        `${label}.${key} is not a SQL scalar`,
      )
    }
    if (typeof child === 'number' && !Number.isFinite(child)) {
      throw new ReleaseValidationError(
        'invalid_artifact',
        `${label}.${key} is not finite`,
      )
    }
    result[key] = child as SqlValue
  }
  return result
}

export function sortRows(rows: SqlRow[]): SqlRow[] {
  return [...rows].sort((left, right) => stableJson(left).localeCompare(stableJson(right), 'en'))
}

export async function tableDigests(
  tables: Record<ReleaseTableName, SqlRow[]>,
): Promise<Record<ReleaseTableName, string>> {
  const entries = await Promise.all(
    RELEASE_TABLES.map(async (table) => [table, await sha256(stableJson(tables[table]))] as const),
  )
  return Object.fromEntries(entries) as Record<ReleaseTableName, string>
}

export async function parseArtifact(text: string): Promise<ReleaseArtifact> {
  const raw = parseJson(text, 'release artifact')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReleaseValidationError('invalid_artifact', 'release artifact must be an object')
  }
  const object = raw as Record<string, unknown>
  if (object.format !== 'studyinchina.catalog.release' || object.formatVersion !== 1) {
    throw new ReleaseValidationError('invalid_artifact', 'unsupported release artifact format')
  }
  if (!object.manifest || typeof object.manifest !== 'object' || Array.isArray(object.manifest)) {
    throw new ReleaseValidationError('invalid_artifact', 'artifact manifest is missing')
  }
  if (!object.tables || typeof object.tables !== 'object' || Array.isArray(object.tables)) {
    throw new ReleaseValidationError('invalid_artifact', 'artifact tables are missing')
  }
  if (!object.tableDigests || typeof object.tableDigests !== 'object') {
    throw new ReleaseValidationError('invalid_artifact', 'artifact table digests are missing')
  }

  const rawTables = object.tables as Record<string, unknown>
  const tables = {} as Record<ReleaseTableName, SqlRow[]>
  for (const table of RELEASE_TABLES) {
    const rows = rawTables[table]
    if (!Array.isArray(rows)) {
      throw new ReleaseValidationError('invalid_artifact', `artifact table ${table} is missing`)
    }
    tables[table] = rows.map((row, index) => ensureSqlRow(row, `${table}[${index}]`))
    const sorted = sortRows(tables[table])
    if (stableJson(sorted) !== stableJson(tables[table])) {
      throw new ReleaseValidationError('invalid_artifact', `artifact table ${table} is not sorted`)
    }
  }

  const digests = await tableDigests(tables)
  const declared = object.tableDigests as Record<string, unknown>
  for (const table of RELEASE_TABLES) {
    if (declared[table] !== digests[table]) {
      throw new ReleaseValidationError(
        'artifact_checksum_mismatch',
        `artifact table ${table} digest does not match`,
      )
    }
  }

  return {
    format: 'studyinchina.catalog.release',
    formatVersion: 1,
    manifest: object.manifest as ReleaseArtifact['manifest'],
    tableDigests: digests,
    tables,
  }
}
