import type {
  AdmissionCycleRecord,
  ApiEnvelope,
  FactStatus,
  FieldMeta,
  OfficialSourceLink,
  ProgramRecord,
} from '@/lib/catalog-api/types'
import type { DegreeLevel, Discipline, LocalizedText } from '@/lib/data/types'
import { CatalogRepositoryError } from './types'
import { parseCatalogReleaseInfo } from './release'

type UnknownRecord = Record<string, unknown>

export type CatalogProgramComparison = ApiEnvelope<{
  items: Array<{
    program: ProgramRecord
    currentCycle: AdmissionCycleRecord | null
    linkedScholarshipCount: number
  }>
  missingIds: string[]
}>

const FACT_STATUSES = new Set<FactStatus>([
  'known',
  'officially_not_announced',
  'not_applicable',
  'source_unavailable',
  'conflict',
  'stale',
])
const APPLICATION_STATES = new Set<AdmissionCycleRecord['applicationState']>([
  'open',
  'upcoming',
  'closed',
  'rolling',
  'dates-published',
  'not-announced',
  'previous-cycle',
])
const DISCIPLINES = new Set<Discipline>([
  'engineering',
  'business',
  'medicine',
  'chinese-education',
  'humanities',
  'law-ir',
  'science',
  'art-design',
  'other',
])

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new CatalogRepositoryError('INVALID_COMPARE_RESPONSE', message)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function dateOnly(value: unknown, fallback: string): string {
  const candidate = text(value)?.slice(0, 10)
  return candidate && /^\d{4}-\d{2}-\d{2}$/u.test(candidate) ? candidate : fallback
}

function safeHttps(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

function localized(value: unknown, fallback: string): LocalizedText {
  if (!isObject(value)) return { en: fallback }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === 'string' && entry[1].length > 0
  ))
  return entries.length > 0 ? Object.fromEntries(entries) : { en: fallback }
}

function sources(value: unknown, fallbackUrl: string, today: string): OfficialSourceLink[] {
  const parsed = Array.isArray(value) ? value.flatMap((source) => {
    if (!isObject(source)) return []
    const url = safeHttps(source.url)
    if (!url) return []
    return [{
      url,
      title: text(source.title) ?? 'Official source',
      checkedAt: dateOnly(source.checkedAt, today),
    }]
  }) : []
  return parsed.length > 0
    ? parsed
    : [{ url: fallbackUrl, title: 'Official program source', checkedAt: today }]
}

function sourceIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.flatMap((source) => {
    if (!isObject(source)) return []
    const id = text(source.id)
    return id ? [id] : []
  }))].sort() : []
}

function fieldMeta(
  value: unknown,
  fallbackUrl: string,
  fallbackTitle: string,
  today: string,
): FieldMeta {
  const record = isObject(value) ? value : {}
  const status = FACT_STATUSES.has(record.status as FactStatus)
    ? record.status as FactStatus
    : 'source_unavailable'
  return {
    status,
    officialUrl: safeHttps(record.officialUrl) ?? fallbackUrl,
    sourceTitle: text(record.sourceTitle) ?? fallbackTitle,
    checkedAt: dateOnly(record.checkedAt, today),
  }
}

function fields(
  value: unknown,
  fallbackUrl: string,
  fallbackTitle: string,
  today: string,
): Record<string, FieldMeta> {
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    fieldMeta(item, fallbackUrl, fallbackTitle, today),
  ]))
}

function aliasFields(
  source: Record<string, FieldMeta>,
  aliases: Readonly<Record<string, readonly string[]>>,
): Record<string, FieldMeta> {
  const result = { ...source }
  for (const [target, candidates] of Object.entries(aliases)) {
    const match = candidates.map((candidate) => source[candidate]).find(Boolean)
    if (match) result[target] = match
  }
  return result
}

function audit(
  rawMeta: unknown,
  officialSources: OfficialSourceLink[],
  today: string,
) {
  const meta = isObject(rawMeta) ? rawMeta : {}
  const identity = isObject(meta.name) ? meta.name : {}
  const verifiedAt = dateOnly(identity.verifiedAt ?? identity.checkedAt ?? officialSources[0]?.checkedAt, today)
  const reviewAfter = dateOnly(identity.reviewAfter, today)
  return {
    verifiedAt,
    reviewAfter,
    status: reviewAfter < today ? 'stale' as const : 'verified' as const,
  }
}

function durationMonths(value: unknown, unit: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const factor = unit === 'academic_years' ? 12 : unit === 'semesters' ? 6 : unit === 'months' ? 1 : null
  return factor === null ? null : Math.min(120, Math.max(1, Math.round(value * factor)))
}

function degreeLevel(value: unknown, programType: unknown): DegreeLevel {
  if (value === 'bachelor' || value === 'master' || value === 'doctorate') return value
  if (programType === 'language') return 'language'
  if (programType === 'foundation') return 'foundation'
  return 'other'
}

function teachingLanguage(value: string): string {
  const normalized = value.toLocaleLowerCase()
  if (normalized === 'zh' || normalized === 'zho' || normalized === 'chinese') return 'Chinese'
  if (normalized === 'en' || normalized === 'eng' || normalized === 'english') return 'English'
  if (normalized === 'bilingual') return 'Bilingual'
  return value
}

function moneyCny(value: unknown): number | null {
  if (!isObject(value) || value.currencyCode !== 'CNY') return null
  const amount = typeof value.amountMinimumMinor === 'number'
    ? value.amountMinimumMinor
    : typeof value.amountMaximumMinor === 'number'
      ? value.amountMaximumMinor
      : null
  const exponent = Number.isInteger(value.currencyExponent) ? Number(value.currencyExponent) : 2
  return amount === null || exponent < 0 || exponent > 6 ? null : amount / (10 ** exponent)
}

function tuitionPeriod(value: unknown): AdmissionCycleRecord['tuitionPeriod'] {
  if (value === 'program' || value === 'semester' || value === 'month' || value === 'other') return value
  if (value === 'academic_year') return 'academic-year'
  return null
}

function cycleRecord(
  value: unknown,
  programId: string,
  programUrl: string,
  today: string,
): { record: AdmissionCycleRecord | null; applyUrl: string | null } {
  if (value === null || value === undefined) return { record: null, applyUrl: null }
  if (!isObject(value)) invalid('Catalog compare cycle must be an object or null.')
  const attributes = isObject(value.attributes) ? value.attributes : {}
  const application = isObject(attributes.application) ? attributes.application : {}
  const id = text(value.id)
  const academicYear = text(attributes.academicYear)
  if (!id || !academicYear || !/^\d{4}-\d{4}$/u.test(academicYear)) {
    invalid('Catalog compare cycle identity is invalid.')
  }
  const state = APPLICATION_STATES.has(application.state as AdmissionCycleRecord['applicationState'])
    ? application.state as AdmissionCycleRecord['applicationState']
    : 'not-announced'
  const intake = attributes.intake === 'spring' || attributes.intake === 'autumn'
    ? attributes.intake
    : 'other'
  const officialSources = sources(value.sources, programUrl, today)
  const rawFields = fields(value.fieldMeta, programUrl, officialSources[0]!.title, today)
  const mappedFields = aliasFields(rawFields, {
    opensOn: ['application.opensOn'],
    closesOn: ['application.closesOn'],
    dateStatus: ['application.state', 'application.rolling'],
    tuitionCny: ['tuition'],
    tuitionPeriod: ['tuition'],
    tuitionStatus: ['tuition'],
    applicationFeeCny: ['applicationFee'],
  })
  const tuitionCny = moneyCny(attributes.tuition)
  const applicationFeeCny = moneyCny(attributes.applicationFee)
  const record: AdmissionCycleRecord = {
    ...audit(value.fieldMeta, officialSources, today),
    id,
    programId,
    academicYear,
    intake,
    opensOn: text(application.opensOn),
    closesOn: text(application.closesOn),
    dateStatus: state === 'rolling'
      ? 'rolling'
      : state === 'not-announced'
        ? 'not-announced'
        : state === 'previous-cycle'
          ? 'previous-cycle-reference'
          : 'published',
    tuitionCny,
    tuitionPeriod: tuitionPeriod(isObject(attributes.tuition) ? attributes.tuition.period : null),
    tuitionStatus: tuitionCny === null ? null : 'confirmed',
    evidenceBasis: null,
    applicationFeeCny,
    applicationState: state,
    sourceIds: sourceIds(value.sources),
    officialSources,
    fieldMeta: mappedFields,
  }
  return { record, applyUrl: safeHttps(application.applyUrl) }
}

function programItem(
  value: unknown,
  today: string,
): CatalogProgramComparison['data']['items'][number] | null {
  if (!isObject(value) || !isObject(value.program)) invalid('Catalog compare item is invalid.')
  const rawProgram = value.program
  const attributes = isObject(rawProgram.attributes) ? rawProgram.attributes : {}
  const relationships = isObject(rawProgram.relationships) ? rawProgram.relationships : {}
  const institution = isObject(relationships.institution) ? relationships.institution : null
  const id = text(rawProgram.id)
  const slug = text(rawProgram.slug)
  const institutionId = institution ? text(institution.id) : null
  const institutionSlug = institution ? text(institution.slug) : null
  const programUrl = safeHttps(attributes.officialUrl)
  if (!id || !slug || !institutionId || !institutionSlug || !programUrl) return null

  const officialSources = sources(rawProgram.sources, programUrl, today)
  const rawFields = fields(rawProgram.fieldMeta, programUrl, officialSources[0]!.title, today)
  const mappedFields = aliasFields(rawFields, {
    universityId: ['institution'],
    programUrl: ['officialUrl'],
    discipline: ['disciplineCodes'],
    teachingLanguages: ['teachingLanguageCodes'],
    durationMonths: ['duration.minimum'],
    durationMonthsMax: ['duration.maximum'],
  })
  const duration = isObject(attributes.duration) ? attributes.duration : {}
  const codes = Array.isArray(attributes.disciplineCodes)
    ? attributes.disciplineCodes.filter((item): item is string => typeof item === 'string')
    : []
  const discipline = codes.find((code): code is Discipline => DISCIPLINES.has(code as Discipline)) ?? null
  const programType = attributes.programType === 'degree'
    || attributes.programType === 'language'
    || attributes.programType === 'foundation'
    || attributes.programType === 'exchange'
    || attributes.programType === 'visiting'
    || attributes.programType === 'short_term'
    || attributes.programType === 'other'
    ? attributes.programType
    : 'other'
  const current = cycleRecord(value.currentCycle, id, programUrl, today)
  const applyUrl = safeHttps(attributes.applyUrl) ?? current.applyUrl
  const languages = Array.isArray(attributes.teachingLanguageCodes)
    ? attributes.teachingLanguageCodes
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .map(teachingLanguage)
    : null
  const minimumDuration = durationMonths(duration.minimum, duration.unit)
  const maximumDuration = durationMonths(duration.maximum, duration.unit)
  const programSourceIds = sourceIds(rawProgram.sources)

  const program: ProgramRecord = {
    ...audit(rawProgram.fieldMeta, officialSources, today),
    id,
    slug,
    universityId: institutionId,
    name: localized(attributes.name, slug),
    degreeLevel: degreeLevel(attributes.degreeLevel, programType),
    discipline,
    teachingLanguages: languages,
    durationMonths: minimumDuration,
    durationMonthsMax: maximumDuration,
    programUrl,
    applyUrl,
    languageRequirements: null,
    verificationScope: 'identity',
    details: null,
    sourceIds: programSourceIds,
    programType,
    university: {
      id: institutionId,
      slug: institutionSlug,
      name: localized(institution?.name, institutionSlug),
    },
    officialSources,
    fieldMeta: mappedFields,
  }
  const linkedScholarshipCount = value.linkedScholarshipCount
  if (!Number.isInteger(linkedScholarshipCount) || Number(linkedScholarshipCount) < 0) {
    invalid('Catalog compare scholarship count is invalid.')
  }
  return { program, currentCycle: current.record, linkedScholarshipCount: Number(linkedScholarshipCount) }
}

export function parseD1ProgramComparison(
  value: unknown,
  requestedIds: readonly string[],
  today: string,
): CatalogProgramComparison {
  if (!isObject(value) || !isObject(value.data) || !isObject(value.meta)) {
    invalid('Catalog compare response must be an API envelope.')
  }
  if (!Array.isArray(value.data.items)) invalid('Catalog compare items are missing.')
  const release = parseCatalogReleaseInfo(value.meta.release)
  const requested = [...new Set(requestedIds)]
  const requestedSet = new Set(requested)
  const parsed = value.data.items.flatMap((item) => {
    const result = programItem(item, today)
    return result && requestedSet.has(result.program.id) ? [result] : []
  })
  const byId = new Map(parsed.map((item) => [item.program.id, item]))
  const items = requested.flatMap((id) => byId.get(id) ? [byId.get(id)!] : [])
  return {
    data: {
      items,
      missingIds: requested.filter((id) => !byId.has(id)),
    },
    meta: {
      release,
      notice: text(value.meta.notice)
        ?? '信息由自动化系统收录并定期更新；申请条件、费用与截止日期以学校或奖学金官方网站实际情况为准。',
    },
  }
}
