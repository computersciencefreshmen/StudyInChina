import {
  admissionCycleSchema,
  programSchema,
  scholarshipSchema,
  universitySchema,
} from '@/lib/data/schema'
import type {
  AdmissionCycle,
  DegreeLevel,
  LocalizedText,
  Program,
  Scholarship,
  University,
} from '@/lib/data/types'
import { parseCatalogReleaseInfo } from './release'
import {
  CatalogRepositoryError,
  type CatalogInstitutionCity,
  type CatalogInstitutionListItem,
  type CatalogInstitutionListPage,
  type CatalogListOption,
  type CatalogProgramListItem,
  type CatalogProgramListPage,
  type CatalogScholarshipCurrentCycle,
  type CatalogScholarshipListItem,
  type CatalogScholarshipListPage,
} from './types'

type UnknownRecord = Record<string, unknown>

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message: string, cause?: unknown): never {
  throw new CatalogRepositoryError('INVALID_LIST_RESPONSE', message, { cause })
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function localized(value: unknown, fallback: string): LocalizedText {
  if (!isObject(value)) return { en: fallback }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === 'string' && entry[1].length > 0
  ))
  return entries.length > 0 ? Object.fromEntries(entries) : { en: fallback }
}

function sourceIds(value: UnknownRecord): string[] {
  if (Array.isArray(value.sourceIds)) {
    const ids = value.sourceIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
    if (ids.length > 0) return ids
  }
  if (Array.isArray(value.sources)) {
    const ids = value.sources.flatMap((item) => {
      if (!isObject(item)) return []
      const id = stringValue(item.id)
      return id ? [id] : []
    })
    if (ids.length > 0) return ids
  }
  return ['remote-catalog-source']
}

function dateOnly(value: unknown, fallback: string): string {
  const candidate = stringValue(value)?.slice(0, 10)
  return candidate && /^\d{4}-\d{2}-\d{2}$/u.test(candidate) ? candidate : fallback
}

function fieldAudit(value: UnknownRecord, today: string) {
  const fieldMeta = isObject(value.fieldMeta) ? value.fieldMeta : {}
  const name = isObject(fieldMeta.name) ? fieldMeta.name : {}
  const verifiedAt = dateOnly(value.verifiedAt ?? name.verifiedAt ?? name.checkedAt, today)
  const reviewAfter = dateOnly(value.reviewAfter ?? name.reviewAfter, today)
  const stale = value.status === 'stale' || name.status === 'stale' || reviewAfter < today
  return {
    sourceIds: sourceIds(value).sort(),
    verifiedAt,
    reviewAfter,
    status: stale ? 'stale' as const : 'verified' as const,
  }
}

function durationMonths(value: unknown, unit: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const factor = unit === 'academic_years' ? 12 : unit === 'semesters' ? 6 : unit === 'months' ? 1 : null
  if (factor === null) return null
  return Math.min(120, Math.max(1, Math.round(value * factor)))
}

function degreeLevel(value: unknown, programType?: unknown): DegreeLevel {
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

function safeHttps(value: unknown): string | null {
  const candidate = stringValue(value)
  if (!candidate) return null
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : null
  } catch {
    return null
  }
}

function normalizeUniversity(
  value: unknown,
  programUrl: string,
  today: string,
): University {
  const parsed = universitySchema.safeParse(value)
  if (parsed.success) return parsed.data
  if (!isObject(value)) invalid('Program list item is missing its institution relationship.')
  const id = stringValue(value.id)
  const slug = stringValue(value.slug)
  if (!id || !slug || !/^[a-z0-9-]+$/u.test(slug)) invalid('Program institution identity is invalid.')
  return universitySchema.parse({
    ...fieldAudit(value, today),
    id,
    slug,
    name: localized(value.name, slug),
    cityId: 'remote-catalog-city',
    region: null,
    officialUrl: safeHttps(value.officialUrl) ?? programUrl,
    admissionsUrl: safeHttps(value.admissionsUrl),
    summary: null,
    featured: false,
  })
}

function normalizeProgramCycle(
  value: unknown,
  program: Program,
  today: string,
): AdmissionCycle | null {
  if (value === null || value === undefined) return null
  const parsed = admissionCycleSchema.safeParse(value)
  if (parsed.success) return parsed.data
  if (!isObject(value)) return null
  const attributes = isObject(value.attributes) ? value.attributes : value
  const application = isObject(attributes.application) ? attributes.application : attributes
  const tuition = isObject(attributes.tuition) ? attributes.tuition : null
  const academicYear = stringValue(attributes.academicYear)
  if (!academicYear || !/^\d{4}-\d{4}$/u.test(academicYear)) return null
  const state = stringValue(application.state)
  const intakeValue = stringValue(attributes.intake)
  const intake = intakeValue === 'spring' || intakeValue === 'autumn' ? intakeValue : 'other'
  const exponent = typeof tuition?.currencyExponent === 'number' ? tuition.currencyExponent : 0
  const amountMinor = typeof tuition?.amountMinimumMinor === 'number' ? tuition.amountMinimumMinor : null
  const tuitionCny = amountMinor === null ? null : amountMinor / (10 ** exponent)
  const candidate = {
    ...fieldAudit(value, today),
    id: stringValue(value.id) ?? `remote:${program.id}:${academicYear}:${intake}`,
    programId: program.id,
    academicYear,
    intake,
    opensOn: stringValue(application.opensOn),
    closesOn: stringValue(application.closesOn),
    dateStatus: state === 'rolling'
      ? 'rolling'
      : state === 'not-announced'
        ? 'not-announced'
        : 'published',
    tuitionCny,
    tuitionPeriod: stringValue(tuition?.period) === 'academic_year'
      ? 'academic-year'
      : stringValue(tuition?.period),
    tuitionStatus: tuitionCny === null ? null : 'confirmed',
    applicationFeeCny: null,
  }
  const normalized = admissionCycleSchema.safeParse(candidate)
  return normalized.success ? normalized.data : null
}

function normalizeProgram(value: unknown, today: string): CatalogProgramListItem {
  if (!isObject(value)) invalid('Catalog API returned an invalid program list item.')
  if (isObject(value.program)) {
    const parsedProgram = programSchema.safeParse(value.program)
    if (!parsedProgram.success) invalid('Catalog API returned an invalid normalized program.', parsedProgram.error)
    return {
      program: parsedProgram.data,
      university: normalizeUniversity(value.university, parsedProgram.data.programUrl, today),
      currentCycle: normalizeProgramCycle(value.currentCycle, parsedProgram.data, today),
    }
  }

  const attributes = isObject(value.attributes) ? value.attributes : value
  const relationships = isObject(value.relationships) ? value.relationships : {}
  const relatedUniversity = isObject(relationships.institution)
    ? relationships.institution
    : isObject(value.university)
      ? value.university
      : null
  const id = stringValue(value.id)
  const slug = stringValue(value.slug)
  const officialUrl = safeHttps(attributes.officialUrl ?? value.programUrl)
  if (!id || !slug || !officialUrl || !relatedUniversity) {
    invalid('Catalog API program identity is incomplete.')
  }
  const duration = isObject(attributes.duration) ? attributes.duration : {}
  const languages = Array.isArray(attributes.teachingLanguageCodes)
    ? attributes.teachingLanguageCodes
    : Array.isArray(value.teachingLanguages)
      ? value.teachingLanguages
      : []
  const minimumDuration = durationMonths(
    duration.minimum ?? value.durationMonths,
    duration.unit ?? (value.durationMonths === undefined ? undefined : 'months'),
  )
  const maximumDuration = durationMonths(
    duration.maximum ?? value.durationMonthsMax,
    duration.unit ?? (value.durationMonthsMax === undefined ? undefined : 'months'),
  )
  const university = normalizeUniversity(relatedUniversity, officialUrl, today)
  const program = programSchema.parse({
    ...fieldAudit(value, today),
    id,
    slug,
    universityId: university.id,
    name: localized(attributes.name ?? value.name, slug),
    degreeLevel: degreeLevel(attributes.degreeLevel ?? value.degreeLevel, attributes.programType ?? value.programType),
    discipline: stringValue(value.discipline) ?? 'other',
    teachingLanguages: languages.filter((item): item is string => typeof item === 'string').map(teachingLanguage),
    durationMonths: minimumDuration,
    durationMonthsMax: maximumDuration,
    programUrl: officialUrl,
    applyUrl: safeHttps(attributes.applyUrl ?? value.applyUrl),
    languageRequirements: Array.isArray(value.languageRequirements) ? value.languageRequirements : [],
    verificationScope: 'identity',
  })
  return {
    program,
    university,
    currentCycle: normalizeProgramCycle(value.currentCycle, program, today),
  }
}

function scholarshipCycle(
  scholarship: Scholarship,
  today: string,
): CatalogScholarshipCurrentCycle {
  const deadline = scholarship.deadline
  const todayValue = Date.parse(`${today}T00:00:00.000Z`)
  const deadlineValue = deadline ? Date.parse(`${deadline}T00:00:00.000Z`) : Number.NaN
  const daysRemaining = Number.isNaN(todayValue) || Number.isNaN(deadlineValue)
    ? null
    : Math.ceil((deadlineValue - todayValue) / 86_400_000)
  return {
    id: `legacy:${scholarship.id}`,
    scholarshipId: scholarship.id,
    academicYear: null,
    opensOn: null,
    closesOn: deadline,
    deadline,
    deadlineState: deadline === null ? 'not-announced' : deadline < today ? 'closed' : 'future',
    daysRemaining,
    legacy: true,
  }
}

function providerType(value: unknown): Scholarship['providerType'] {
  if (value === 'csc' || value === 'university' || value === 'province' || value === 'city') return value
  if (value === 'government') return 'csc'
  return 'other'
}

function normalizeScholarship(value: unknown, today: string): CatalogScholarshipListItem {
  if (!isObject(value)) invalid('Catalog API returned an invalid scholarship list item.')
  if (isObject(value.scholarship)) {
    const parsedScholarship = scholarshipSchema.safeParse(value.scholarship)
    if (!parsedScholarship.success) invalid('Catalog API returned an invalid normalized scholarship.', parsedScholarship.error)
    const universities = Array.isArray(value.universities)
      ? value.universities.flatMap((item) => {
        const parsed = universitySchema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
      : []
    const programs = Array.isArray(value.programs)
      ? value.programs.flatMap((item) => {
        const parsed = programSchema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
      : []
    return {
      scholarship: parsedScholarship.data,
      universities,
      programs,
      currentCycle: isObject(value.currentCycle)
        ? { ...scholarshipCycle(parsedScholarship.data, today), ...value.currentCycle }
        : scholarshipCycle(parsedScholarship.data, today),
    }
  }

  const attributes = isObject(value.attributes) ? value.attributes : value
  const scope = isObject(attributes.scope) ? attributes.scope : {}
  const coverage = isObject(attributes.coverage) ? attributes.coverage : isObject(value.coverage) ? value.coverage : {}
  const id = stringValue(value.id)
  const slug = stringValue(value.slug)
  const officialUrl = safeHttps(attributes.officialUrl ?? value.applicationUrl)
  if (!id || !slug || !officialUrl) invalid('Catalog API scholarship identity is incomplete.')
  const universityIds = Array.isArray(scope.institutionIds)
    ? scope.institutionIds.filter((item): item is string => typeof item === 'string')
    : Array.isArray(value.universityIds)
      ? value.universityIds.filter((item): item is string => typeof item === 'string')
      : []
  const programIds = Array.isArray(scope.programIds)
    ? scope.programIds.filter((item): item is string => typeof item === 'string')
    : Array.isArray(value.programIds)
      ? value.programIds.filter((item): item is string => typeof item === 'string')
      : []
  const relationships = isObject(value.relationships) ? value.relationships : {}
  const provider = isObject(relationships.provider) ? relationships.provider : {}
  const scholarship = scholarshipSchema.parse({
    ...fieldAudit(value, today),
    id,
    slug,
    name: localized(attributes.name ?? value.name, slug),
    providerType: providerType(value.providerType ?? attributes.schemeType ?? provider.organizationType),
    universityIds,
    programIds,
    coverage: {
      tuition: coverage.tuition === 'full' || coverage.tuition === 'partial' || coverage.tuition === 'none'
        ? coverage.tuition
        : 'unknown',
      accommodation: coverage.accommodation === 'full' || coverage.accommodation === 'partial' || coverage.accommodation === 'none'
        ? coverage.accommodation
        : 'unknown',
      insurance: typeof coverage.insurance === 'boolean' ? coverage.insurance : 'unknown',
      stipendCnyPerMonth: typeof coverage.stipendCnyPerMonth === 'number'
        ? coverage.stipendCnyPerMonth
        : null,
    },
    deadline: stringValue(attributes.deadline ?? value.deadline),
    applicationUrl: safeHttps(value.applicationUrl ?? officialUrl),
    summary: attributes.summary === null || value.summary === null
      ? null
      : localized(attributes.summary ?? value.summary, slug),
  })
  return {
    scholarship,
    universities: [],
    programs: [],
    currentCycle: scholarshipCycle(scholarship, today),
  }
}

function option(value: unknown): CatalogListOption | null {
  if (!isObject(value)) return null
  const optionValue = stringValue(value.value ?? value.slug ?? value.id)
  if (!optionValue) return null
  return { value: optionValue, name: localized(value.name, optionValue) }
}

function envelopeParts(payload: unknown): {
  rows: unknown[]
  meta: UnknownRecord
  facets: UnknownRecord
} {
  if (!isObject(payload)) invalid('Catalog API list response must be an object.')
  const meta = isObject(payload.meta) ? payload.meta : {}
  if (Array.isArray(payload.data)) return { rows: payload.data, meta, facets: isObject(meta.facets) ? meta.facets : {} }
  if (isObject(payload.data) && Array.isArray(payload.data.items)) {
    return {
      rows: payload.data.items,
      meta,
      facets: isObject(payload.data.facets) ? payload.data.facets : isObject(meta.facets) ? meta.facets : {},
    }
  }
  invalid('Catalog API list response data must be an array.')
}

function pageMeta(meta: UnknownRecord) {
  const nextCursor = meta.nextCursor === null ? null : stringValue(meta.nextCursor)
  const total = Number.isInteger(meta.total) && (meta.total as number) >= 0 ? meta.total as number : null
  const release = meta.release === undefined ? null : parseCatalogReleaseInfo(meta.release)
  return { nextCursor, total, release }
}

function regionValue(value: unknown): University['region'] {
  return value === 'north'
    || value === 'northeast'
    || value === 'east'
    || value === 'south'
    || value === 'central'
    || value === 'southwest'
    || value === 'northwest'
    ? value
    : null
}

function relationshipCount(
  value: UnknownRecord,
  relationshipName: 'programs' | 'scholarships',
  fallbackName: 'programCount' | 'scholarshipCount',
): number {
  const relationships = isObject(value.relationships) ? value.relationships : {}
  const relationship = isObject(relationships[relationshipName])
    ? relationships[relationshipName]
    : {}
  const count = relationship.count ?? value[fallbackName]
  if (!Number.isInteger(count) || (count as number) < 0) {
    invalid(`Institution list item has an invalid ${fallbackName}.`)
  }
  return count as number
}

function institutionDisciplines(value: UnknownRecord): string[] {
  const attributes = isObject(value.attributes) ? value.attributes : {}
  const candidate = Array.isArray(attributes.disciplineCodes)
    ? attributes.disciplineCodes
    : Array.isArray(value.disciplines)
      ? value.disciplines
      : []
  return [...new Set(candidate.filter((item): item is string => (
    typeof item === 'string' && item.length > 0
  )))].sort()
}

function normalizeInstitutionCity(value: unknown): CatalogInstitutionCity | null {
  if (value === null || value === undefined) return null
  if (!isObject(value)) invalid('Institution location relationship is invalid.')
  const id = stringValue(value.id)
  const slug = stringValue(value.slug) ?? id
  if (!id || !slug) invalid('Institution location identity is invalid.')
  return {
    id,
    slug,
    name: localized(value.name, slug),
    region: regionValue(value.region ?? value.regionCode),
  }
}

function normalizeInstitution(value: unknown, today: string): CatalogInstitutionListItem {
  if (!isObject(value)) invalid('Catalog API returned an invalid institution list item.')
  const nestedInstitution = isObject(value.institution) ? value.institution : value
  const parsedInstitution = universitySchema.safeParse(nestedInstitution)
  const relationships = isObject(value.relationships) ? value.relationships : {}
  const cityValue = value.city ?? relationships.location

  if (parsedInstitution.success) {
    return {
      institution: parsedInstitution.data,
      city: normalizeInstitutionCity(cityValue),
      programCount: relationshipCount(value, 'programs', 'programCount'),
      scholarshipCount: relationshipCount(value, 'scholarships', 'scholarshipCount'),
      disciplines: institutionDisciplines(value),
    }
  }

  const attributes = isObject(value.attributes) ? value.attributes : value
  const city = normalizeInstitutionCity(cityValue)
  const id = stringValue(value.id)
  const slug = stringValue(value.slug)
  const officialUrl = safeHttps(attributes.officialUrl)
  if (!id || !slug || !/^[a-z0-9-]+$/u.test(slug) || !officialUrl || !city) {
    invalid('Catalog API institution identity is incomplete.')
  }
  const summary = attributes.summary === null || attributes.summary === undefined
    ? null
    : localized(attributes.summary, slug)
  const institution = universitySchema.parse({
    ...fieldAudit(value, today),
    id,
    slug,
    name: localized(attributes.name, slug),
    cityId: city.id,
    region: regionValue(attributes.region ?? city.region),
    officialUrl,
    admissionsUrl: safeHttps(attributes.admissionsUrl),
    summary,
    featured: attributes.featured === true,
  })
  return {
    institution,
    city,
    programCount: relationshipCount(value, 'programs', 'programCount'),
    scholarshipCount: relationshipCount(value, 'scholarships', 'scholarshipCount'),
    disciplines: institutionDisciplines(value),
  }
}

export function parseD1InstitutionList(
  payload: unknown,
  today: string,
): CatalogInstitutionListPage {
  const { rows, meta, facets } = envelopeParts(payload)
  const items = rows.map((row) => normalizeInstitution(row, today))
  const cities = Array.isArray(facets.cities)
    ? facets.cities.flatMap((item) => option(item) ?? [])
    : items.flatMap((item) => (
      item.city ? [{ value: item.city.slug, name: item.city.name }] : []
    ))
  return {
    items,
    ...pageMeta(meta),
    facets: {
      cities: [...new Map(cities.map((item) => [item.value, item])).values()],
    },
  }
}


export function parseD1ProgramList(payload: unknown, today: string): CatalogProgramListPage {
  const { rows, meta, facets } = envelopeParts(payload)
  const items = rows.map((row) => normalizeProgram(row, today))
  const universities = Array.isArray(facets.universities)
    ? facets.universities.flatMap((item) => option(item) ?? [])
    : items.map(({ university }) => ({ value: university.slug, name: university.name }))
  const cities = Array.isArray(facets.cities)
    ? facets.cities.flatMap((item) => option(item) ?? [])
    : []
  return {
    items,
    ...pageMeta(meta),
    facets: {
      universities: [...new Map(universities.map((item) => [item.value, item])).values()],
      cities: [...new Map(cities.map((item) => [item.value, item])).values()],
    },
  }
}

export function parseD1ScholarshipList(payload: unknown, today: string): CatalogScholarshipListPage {
  const { rows, meta, facets } = envelopeParts(payload)
  const items = rows.map((row) => normalizeScholarship(row, today))
  const universities = Array.isArray(facets.universities)
    ? facets.universities.flatMap((item) => option(item) ?? [])
    : items.flatMap((item) => item.universities.map(({ slug, name }) => ({ value: slug, name })))
  return {
    items,
    ...pageMeta(meta),
    facets: {
      universities: [...new Map(universities.map((item) => [item.value, item])).values()],
    },
  }
}
