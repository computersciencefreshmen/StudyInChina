import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'

type JsonRecord = Record<string, unknown>

export const RECONCILIATION_CATEGORIES = [
  'international_admissions_home',
  'catalog_anchor',
  'university_scholarship',
] as const

export type ReconciliationCategory = (typeof RECONCILIATION_CATEGORIES)[number]
export type ReconciliationStatus =
  | 'verified_official'
  | 'source_unavailable'
  | 'officially_not_provided'

export type ReconciledSourceCategory = {
  sourceCategory: ReconciliationCategory
  status: ReconciliationStatus
  officialUrl: string | null
  evidenceUrl: string
  note: string
  checkedAt: string
}

export type ReconciledInstitution = {
  institutionNameZh: string
  checkedAt: string
  categories: ReconciledSourceCategory[]
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function dateOnly(value: unknown, label: string): string {
  const normalized = string(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${label} must use YYYY-MM-DD`)
  }
  const [year, month, day] = normalized.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must be a real date`)
  }
  return normalized
}

function httpsUrl(value: unknown, label: string): string {
  let parsed: URL
  try {
    parsed = new URL(string(value, label))
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL`)
  }
  parsed.hash = ''
  return parsed.href
}

function normalizedStatus(value: unknown, label: string): ReconciliationStatus {
  if (value === 'known' || value === 'verified_official') return 'verified_official'
  if (value === 'source_unavailable' || value === 'officially_not_provided') return value
  throw new Error(`${label} is unsupported`)
}

function normalizeDocument(value: unknown, fileName: string): ReconciledInstitution[] {
  const root = record(value, fileName)
  if (
    (
      root.format !== 'studyinchina.source-reconciliation'
      && root.format !== 'studyinchina.official-source-reconciliation'
    )
    || root.formatVersion !== 1
  ) {
    throw new Error(`${fileName} must use studyinchina.source-reconciliation v1`)
  }
  const checkedAt = dateOnly(root.checkedAt, `${fileName}.checkedAt`)
  const rawInstitutions = root.institutions ?? root.schools
  if (!Array.isArray(rawInstitutions) || rawInstitutions.length === 0) {
    throw new Error(`${fileName} must contain institutions or schools`)
  }
  return rawInstitutions.map((rawInstitution, institutionIndex) => {
    const label = `${fileName}.institutions[${institutionIndex}]`
    const institution = record(rawInstitution, label)
    const institutionNameZh = string(
      institution.officialNameZh ?? institution.institutionNameZh,
      `${label}.institutionNameZh`,
    )
    const rawCategories = institution.categories ?? institution.sources
    if (!Array.isArray(rawCategories)) {
      throw new Error(`${label}.categories must be an array`)
    }
    if (rawCategories.length !== RECONCILIATION_CATEGORIES.length) {
      throw new Error(`${label} must reconcile exactly three categories`)
    }
    const categories = rawCategories.map((rawCategory, categoryIndex) => {
      const categoryLabel = `${label}.categories[${categoryIndex}]`
      const category = record(rawCategory, categoryLabel)
      const sourceCategory = string(
        category.sourceCategory ?? category.category,
        `${categoryLabel}.sourceCategory`,
      ) as ReconciliationCategory
      if (!RECONCILIATION_CATEGORIES.includes(sourceCategory)) {
        throw new Error(`${categoryLabel}.sourceCategory is unsupported`)
      }
      const status = normalizedStatus(category.status, `${categoryLabel}.status`)
      const rawOfficialUrl = category.officialUrl
      const officialUrl = rawOfficialUrl === null
        ? null
        : httpsUrl(rawOfficialUrl, `${categoryLabel}.officialUrl`)
      if (status === 'verified_official' && !officialUrl) {
        throw new Error(`${categoryLabel} verified sources require officialUrl`)
      }
      if (status !== 'verified_official' && officialUrl !== null) {
        throw new Error(`${categoryLabel} unavailable sources require null officialUrl`)
      }
      const categoryCheckedAt = dateOnly(
        category.checkedAt,
        `${categoryLabel}.checkedAt`,
      )
      if (categoryCheckedAt !== checkedAt) {
        throw new Error(`${categoryLabel}.checkedAt conflicts with its document`)
      }
      const note = string(category.note, `${categoryLabel}.note`)
      if (note.length > 2_000) throw new Error(`${categoryLabel}.note is too long`)
      return {
        sourceCategory,
        status,
        officialUrl,
        evidenceUrl: httpsUrl(category.evidenceUrl, `${categoryLabel}.evidenceUrl`),
        note,
        checkedAt: categoryCheckedAt,
      }
    }).sort((left, right) => (
      RECONCILIATION_CATEGORIES.indexOf(left.sourceCategory)
      - RECONCILIATION_CATEGORIES.indexOf(right.sourceCategory)
    ))
    if (new Set(categories.map((category) => category.sourceCategory)).size !== 3) {
      throw new Error(`${label}.categories contains duplicates`)
    }
    return { institutionNameZh, checkedAt, categories }
  })
}

export function loadSourceReconciliations(
  directory: string,
): ReconciledInstitution[] {
  if (!existsSync(directory)) return []
  const institutions = readdirSync(directory)
    .filter((name) => name.endsWith('.v1.json'))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .flatMap((fileName) => normalizeDocument(
      JSON.parse(readFileSync(join(directory, fileName), 'utf8')) as unknown,
      fileName,
    ))
  const names = new Set<string>()
  for (const institution of institutions) {
    if (names.has(institution.institutionNameZh)) {
      throw new Error(`Duplicate reconciled institution ${institution.institutionNameZh}`)
    }
    names.add(institution.institutionNameZh)
  }
  return institutions.sort((left, right) => left.institutionNameZh.localeCompare(
    right.institutionNameZh,
    'zh-CN',
  ))
}
