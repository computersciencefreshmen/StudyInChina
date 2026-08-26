import { getApplicationState, selectAdmissionCycle } from '@/lib/data/admission'
import { getTodayDate } from '@/lib/data/freshness'
import { classifyProgramField, isProgramField, programSearchKeywords } from '@/lib/data/fields'
import { scholarshipAppliesToProgram } from '@/lib/data/scholarship-scope'
import { canonicalUniversitySlug } from '@/lib/data/slug-aliases'
import type {
  AdmissionCycle,
  AuditMeta,
  DataBundle,
  LocalizedText,
  Program,
  Scholarship,
} from '@/lib/data/types'
import { fieldMetaMap, officialSourcesFor } from './field-meta'
import { decodeCursor, encodeCursor, InvalidCursorError, paginateBySlug } from './cursor'
import type {
  AdmissionCycleRecord,
  ApiEnvelope,
  ApiMeta,
  InstitutionRecord,
  ProgramRecord,
  ProgramType,
  ReleaseInfo,
  ScholarshipCycleRecord,
  ScholarshipRecord,
} from './types'
import { AUTOMATED_COLLECTION_NOTICE } from './types'

export type ListOptions = { cursor?: string; limit?: number }

export type InstitutionSort = 'default' | 'name' | 'programs-desc' | 'scholarships-desc'

export type InstitutionQuery = ListOptions & {
  q?: string
  city?: string
  region?: string
  discipline?: string
  sort?: InstitutionSort
}

export type ProgramQuery = ListOptions & {
  q?: string
  institution?: string
  city?: string
  type?: string
  degree?: string
  discipline?: string
  language?: string
  academicYear?: string
  intake?: string
  tuitionMin?: number
  tuitionMax?: number
  applicationState?: string
  scholarship?: string
}

export type ScholarshipQuery = ListOptions & {
  q?: string
  provider?: string
  institution?: string
  program?: string
}

export class InvalidSearchQueryError extends Error {
  constructor() {
    super('Invalid search query.')
    this.name = 'InvalidSearchQueryError'
  }
}

function searchable(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(searchable).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(searchable).join(' ')
  return ''
}

function matchesQuery(values: unknown[], query?: string) {
  const normalized = query?.trim().toLocaleLowerCase()
  return !normalized || searchable(values).toLocaleLowerCase().includes(normalized)
}

function institutionSearchTerms(query?: string) {
  const normalized = query?.normalize('NFKC').trim()
  if (!normalized) return null
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  if (terms.length === 0 || terms.length > 20) throw new InvalidSearchQueryError()
  return terms.map((term) => term.toLocaleLowerCase())
}

function matchesInstitutionName(name: LocalizedText, query?: string) {
  const terms = institutionSearchTerms(query)
  if (!terms) return true
  const tokens = searchable(name)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []
  return terms.every((term) => tokens.some((token) => token.startsWith(term)))
}

function matchesIdentity(value: { id: string; slug: string }, expected?: string) {
  return !expected || value.id === expected || value.slug === expected
}

function institutionSortKey(record: InstitutionRecord, sort: InstitutionSort = 'default') {
  if (sort === 'name') return record.slug
  if (sort === 'programs-desc') {
    return `${String(999_999_999_999_999 - record.programCount).padStart(15, '0')}:${record.slug}`
  }
  if (sort === 'scholarships-desc') {
    return `${String(999_999_999_999_999 - record.scholarshipCount).padStart(15, '0')}:${record.slug}`
  }
  return record.slug
}

function paginateInstitutions(
  records: InstitutionRecord[],
  query: InstitutionQuery,
) {
  const limit = Math.min(Math.max(query.limit ?? 24, 1), 100)
  const key = (record: InstitutionRecord) => institutionSortKey(record, query.sort)
  const sorted = [...records].sort((left, right) =>
    institutionSortKey(left, query.sort).localeCompare(institutionSortKey(right, query.sort))
    || left.id.localeCompare(right.id),
  )
  const cursor = query.cursor ? decodeCursor(query.cursor, 'institutions', query) : null
  const start = cursor
    ? sorted.findIndex((item) => key(item) === cursor.sortKey && item.id === cursor.id) + 1
    : 0
  if (cursor && start === 0) throw new InvalidCursorError()

  const items = sorted.slice(start, start + limit)
  const hasMore = start + items.length < sorted.length
  const last = items.at(-1)
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor('institutions', query, key(last), last.id) : null,
  }
}
function matchesProgramDiscipline(program: Program, expected?: string) {
  if (!expected) return true
  return isProgramField(expected)
    ? classifyProgramField(program) === expected
    : program.discipline === expected
}

function hasCurrentFacts(record: AuditMeta, today: string) {
  return record.status === 'verified' && record.reviewAfter >= today
}

function knownValue<T>(
  meta: Record<string, { status: string }>,
  field: string,
  value: T,
): T | null {
  return meta[field]?.status === 'known' ? value : null
}

function deriveProgramType(program: Program): ProgramType {
  if (program.degreeLevel === 'language') return 'language'
  if (program.degreeLevel === 'foundation') return 'foundation'
  if (program.degreeLevel === 'other') return 'other'
  return 'degree'
}

function scholarshipFallback(scholarship: Scholarship, sources: DataBundle['sources']) {
  const officialSource = officialSourcesFor(scholarship.sourceIds, sources)[0]
  return {
    url: scholarship.applicationUrl ?? officialSource?.url ?? '',
    title: officialSource?.title ?? 'Official scholarship source',
  }
}

export class CatalogApiService {
  constructor(
    private readonly bundle: DataBundle,
    private readonly release: ReleaseInfo,
    private readonly today = getTodayDate(),
  ) {}

  private envelope<T>(
    data: T,
    page?: {
      pageSize: number
      nextCursor: string | null
      total?: number
      facets?: ApiMeta['facets']
    },
  ): ApiEnvelope<T> {
    return {
      data,
      meta: {
        release: this.release,
        notice: AUTOMATED_COLLECTION_NOTICE,
        ...(page
          ? {
              pageSize: page.pageSize,
              nextCursor: page.nextCursor,
              ...(page.total === undefined ? {} : { total: page.total }),
              ...(page.facets === undefined ? {} : { facets: page.facets }),
            }
          : {}),
      },
    }
  }

  private institutionRecord(university: DataBundle['universities'][number]): InstitutionRecord {
    const city = this.bundle.cities.find((item) => item.id === university.cityId) ?? null
    const relatedPrograms = this.bundle.programs.filter((item) => item.universityId === university.id)
    const disciplines = [...new Set(relatedPrograms
      .filter((item) => hasCurrentFacts(item, this.today))
      .map((item) => classifyProgramField(item)))].sort()
    const relatedScholarships = this.bundle.scholarships.filter((item) =>
      item.universityIds.includes(university.id),
    )
    const fallback = { url: university.admissionsUrl || university.officialUrl, title: 'Official university website' }
    const identityMeta = fieldMetaMap(university, this.bundle.sources, fallback, {
      id: university.id,
      slug: university.slug,
      name: university.name,
      cityId: university.cityId,
      region: university.region,
      officialUrl: university.officialUrl,
      admissionsUrl: university.admissionsUrl,
    }, this.today, {}, false)
    const dynamicMeta = fieldMetaMap(university, this.bundle.sources, fallback, {
      summary: university.summary,
    }, this.today)
    return {
      ...university,
      summary: knownValue(dynamicMeta, 'summary', university.summary),
      disciplines,
      city: city ? { id: city.id, slug: city.slug, name: city.name, province: city.province, region: city.region } : null,
      programCount: relatedPrograms.length,
      scholarshipCount: relatedScholarships.length,
      officialSources: officialSourcesFor(university.sourceIds, this.bundle.sources),
      fieldMeta: { ...identityMeta, ...dynamicMeta },
    }
  }

  private programRecord(program: Program): ProgramRecord | null {
    const university = this.bundle.universities.find((item) => item.id === program.universityId)
    if (!university) return null
    const fallback = { url: program.programUrl, title: 'Official program page' }
    const identityMeta = fieldMetaMap(program, this.bundle.sources, fallback, {
      id: program.id,
      slug: program.slug,
      universityId: program.universityId,
      name: program.name,
      programType: deriveProgramType(program),
      degreeLevel: program.degreeLevel,
      programUrl: program.programUrl,
    }, this.today, {}, false)
    const dynamicMeta = fieldMetaMap(program, this.bundle.sources, fallback, {
      discipline: program.discipline,
      teachingLanguages: program.teachingLanguages,
      durationMonths: program.durationMonths,
      durationMonthsMax: program.durationMonthsMax,
      applyUrl: program.applyUrl,
      languageRequirements: program.languageRequirements,
      details: program.details,
    }, this.today)
    return {
      ...program,
      discipline: knownValue(dynamicMeta, 'discipline', program.discipline),
      teachingLanguages: knownValue(dynamicMeta, 'teachingLanguages', program.teachingLanguages),
      durationMonths: knownValue(dynamicMeta, 'durationMonths', program.durationMonths),
      durationMonthsMax: knownValue(dynamicMeta, 'durationMonthsMax', program.durationMonthsMax ?? null),
      applyUrl: knownValue(dynamicMeta, 'applyUrl', program.applyUrl),
      languageRequirements: knownValue(dynamicMeta, 'languageRequirements', program.languageRequirements),
      details: knownValue(dynamicMeta, 'details', program.details ?? null),
      programType: deriveProgramType(program),
      university: { id: university.id, slug: university.slug, name: university.name },
      officialSources: officialSourcesFor(program.sourceIds, this.bundle.sources),
      fieldMeta: { ...identityMeta, ...dynamicMeta },
    }
  }

  private cycleRecord(cycle: AdmissionCycle, program: Program): AdmissionCycleRecord {
    const fallback = { url: program.programUrl, title: 'Official admissions page' }
    const identityMeta = fieldMetaMap(cycle, this.bundle.sources, fallback, {
      id: cycle.id,
      programId: cycle.programId,
      academicYear: cycle.academicYear,
      intake: cycle.intake,
    }, this.today, {}, false)
    const dynamicMeta = fieldMetaMap(cycle, this.bundle.sources, fallback, {
      opensOn: cycle.opensOn,
      closesOn: cycle.closesOn,
      dateStatus: cycle.dateStatus,
      tuitionCny: cycle.tuitionCny,
      tuitionPeriod: cycle.tuitionPeriod,
      tuitionStatus: cycle.tuitionStatus,
      evidenceBasis: cycle.evidenceBasis,
      applicationFeeCny: cycle.applicationFeeCny,
    }, this.today)
    const safeCycle = {
      ...cycle,
      opensOn: knownValue(dynamicMeta, 'opensOn', cycle.opensOn),
      closesOn: knownValue(dynamicMeta, 'closesOn', cycle.closesOn),
      dateStatus: knownValue(dynamicMeta, 'dateStatus', cycle.dateStatus),
      tuitionCny: knownValue(dynamicMeta, 'tuitionCny', cycle.tuitionCny),
      tuitionPeriod: knownValue(dynamicMeta, 'tuitionPeriod', cycle.tuitionPeriod ?? null),
      tuitionStatus: knownValue(dynamicMeta, 'tuitionStatus', cycle.tuitionStatus ?? null),
      evidenceBasis: knownValue(dynamicMeta, 'evidenceBasis', cycle.evidenceBasis ?? null),
      applicationFeeCny: knownValue(dynamicMeta, 'applicationFeeCny', cycle.applicationFeeCny),
    }
    return {
      ...safeCycle,
      applicationState: safeCycle.dateStatus === null
        ? 'not-announced'
        : getApplicationState({
          ...cycle,
          opensOn: safeCycle.opensOn,
          closesOn: safeCycle.closesOn,
          dateStatus: safeCycle.dateStatus,
        }, this.today),
      officialSources: officialSourcesFor(cycle.sourceIds, this.bundle.sources),
      fieldMeta: { ...identityMeta, ...dynamicMeta },
    }
  }

  private scholarshipRecord(scholarship: Scholarship): ScholarshipRecord {
    const fallback = scholarshipFallback(scholarship, this.bundle.sources)
    const identityMeta = fieldMetaMap(scholarship, this.bundle.sources, fallback, {
      id: scholarship.id,
      slug: scholarship.slug,
      name: scholarship.name,
      providerType: scholarship.providerType,
      applicationUrl: scholarship.applicationUrl,
    }, this.today, {}, false)
    const normalizedCoverage = {
      tuition: scholarship.coverage.tuition === 'unknown' ? null : scholarship.coverage.tuition,
      accommodation: scholarship.coverage.accommodation === 'unknown'
        ? null
        : scholarship.coverage.accommodation,
      insurance: scholarship.coverage.insurance === 'unknown' ? null : scholarship.coverage.insurance,
      stipendCnyPerMonth: scholarship.coverage.stipendCnyPerMonth,
    }
    const dynamicMeta = fieldMetaMap(scholarship, this.bundle.sources, fallback, {
      universityIds: scholarship.universityIds,
      programIds: scholarship.programIds,
      'coverage.tuition': normalizedCoverage.tuition,
      'coverage.accommodation': normalizedCoverage.accommodation,
      'coverage.insurance': normalizedCoverage.insurance,
      'coverage.stipendCnyPerMonth': normalizedCoverage.stipendCnyPerMonth,
      deadline: scholarship.deadline,
      summary: scholarship.summary,
    }, this.today)
    return {
      ...scholarship,
      universityIds: knownValue(dynamicMeta, 'universityIds', scholarship.universityIds),
      programIds: knownValue(dynamicMeta, 'programIds', scholarship.programIds),
      coverage: {
        tuition: knownValue(dynamicMeta, 'coverage.tuition', normalizedCoverage.tuition),
        accommodation: knownValue(dynamicMeta, 'coverage.accommodation', normalizedCoverage.accommodation),
        insurance: knownValue(dynamicMeta, 'coverage.insurance', normalizedCoverage.insurance),
        stipendCnyPerMonth: knownValue(
          dynamicMeta,
          'coverage.stipendCnyPerMonth',
          normalizedCoverage.stipendCnyPerMonth,
        ),
      },
      deadline: knownValue(dynamicMeta, 'deadline', scholarship.deadline),
      summary: knownValue(dynamicMeta, 'summary', scholarship.summary),
      officialSources: officialSourcesFor(scholarship.sourceIds, this.bundle.sources),
      fieldMeta: { ...identityMeta, ...dynamicMeta },
    }
  }

  listInstitutions(query: InstitutionQuery = {}): ApiEnvelope<InstitutionRecord[]> {
    const filtered = this.bundle.universities.filter((university) => {
      const city = this.bundle.cities.find((item) => item.id === university.cityId)
      const programs = this.bundle.programs.filter((item) => item.universityId === university.id)
      return matchesInstitutionName(university.name, query.q)
        && (!query.city || Boolean(city && matchesIdentity(city, query.city)))
        && (!query.region || university.region === query.region)
        && (!query.discipline || programs.some((item) =>
          hasCurrentFacts(item, this.today)
          && matchesProgramDiscipline(item, query.discipline)
        ))
    }).map((item) => this.institutionRecord(item))
    const cityIds = new Set(filtered.map((item) => item.city?.id).filter(Boolean))
    const cities = this.bundle.cities
      .filter((city) => cityIds.has(city.id))
      .sort((left, right) => left.slug.localeCompare(right.slug) || left.id.localeCompare(right.id))
      .map((city) => ({ value: city.slug || city.id, name: city.name }))
    const page = paginateInstitutions(filtered, query)
    return this.envelope(page.items, {
      pageSize: page.items.length,
      nextCursor: page.nextCursor,
      total: filtered.length,
      facets: { cities },
    })
  }

  getInstitution(slug: string): ApiEnvelope<InstitutionRecord> | null {
    const canonicalSlug = canonicalUniversitySlug(slug)
    const university = this.bundle.universities.find((item) => item.slug === canonicalSlug)
    return university ? this.envelope(this.institutionRecord(university)) : null
  }

  listPrograms(query: ProgramQuery = {}): ApiEnvelope<ProgramRecord[]> {
    const filtered = this.bundle.programs.filter((program) => {
      const university = this.bundle.universities.find((item) => item.id === program.universityId)
      const city = university ? this.bundle.cities.find((item) => item.id === university.cityId) : null
      if (!university) return false
      const cycles = this.bundle.admissionCycles.filter((item) => item.programId === program.id)
      const scholarships = this.bundle.scholarships.filter((item) =>
        hasCurrentFacts(item, this.today)
          && scholarshipAppliesToProgram(item, program),
      )
      const hasCycleFilters = Boolean(
        query.academicYear || query.intake || query.applicationState
        || query.tuitionMin !== undefined || query.tuitionMax !== undefined,
      )
      const matchesCycle = !hasCycleFilters || cycles.some((cycle) => {
        if (!hasCurrentFacts(cycle, this.today)) return false
        const tuition = cycle.tuitionStatus === 'confirmed'
          ? cycle.tuitionCny
          : null
        return (!query.academicYear || cycle.academicYear === query.academicYear)
          && (!query.intake || cycle.intake === query.intake)
          && (!query.applicationState || getApplicationState(cycle, this.today) === query.applicationState)
          && (query.tuitionMin === undefined || (tuition !== null && tuition >= query.tuitionMin))
          && (query.tuitionMax === undefined || (tuition !== null && tuition <= query.tuitionMax))
      })
      const programFacts = hasCurrentFacts(program, this.today)
        ? [program.discipline, program.teachingLanguages]
        : []
      return matchesQuery([program.name, university.name, programSearchKeywords(program), programFacts], query.q)
        && (!query.institution || matchesIdentity(university, query.institution))
        && (!query.city || Boolean(city && matchesIdentity(city, query.city)))
        && (!query.type || deriveProgramType(program) === query.type)
        && (!query.degree || program.degreeLevel === query.degree)
        && (!query.discipline || (hasCurrentFacts(program, this.today)
          && matchesProgramDiscipline(program, query.discipline)))
        && (!query.language || (hasCurrentFacts(program, this.today)
          && program.teachingLanguages.some((item) => item.toLocaleLowerCase() === query.language?.toLocaleLowerCase())))
        && (!query.scholarship
          || (query.scholarship === 'linked' && scholarships.length > 0)
          || scholarships.some((item) => matchesIdentity(item, query.scholarship)))
        && matchesCycle
    }).map((item) => this.programRecord(item)).filter((item): item is ProgramRecord => item !== null)
    const page = paginateBySlug(filtered, 'programs', query)
    return this.envelope(page.items, { pageSize: page.items.length, nextCursor: page.nextCursor })
  }

  getProgram(slug: string): ApiEnvelope<ProgramRecord> | null {
    const program = this.bundle.programs.find((item) => item.slug === slug)
    if (!program) return null
    const record = this.programRecord(program)
    return record ? this.envelope(record) : null
  }

  getProgramCycles(slug: string): ApiEnvelope<AdmissionCycleRecord[]> | null {
    const program = this.bundle.programs.find((item) => item.slug === slug)
    if (!program) return null
    const cycles = this.bundle.admissionCycles
      .filter((item) => item.programId === program.id)
      .map((item) => this.cycleRecord(item, program))
      .sort((left, right) => right.academicYear.localeCompare(left.academicYear) || left.intake.localeCompare(right.intake))
    return this.envelope(cycles)
  }

  comparePrograms(ids: string[]): ApiEnvelope<{
    items: Array<{
      program: ProgramRecord
      currentCycle: AdmissionCycleRecord | null
      linkedScholarshipCount: number
    }>
    missingIds: string[]
  }> {
    const uniqueIds = [...new Set(ids)]
    const programsById = new Map(this.bundle.programs.map((program) => [program.id, program]))
    const currentCycles = this.bundle.admissionCycles.filter(
      (cycle) => hasCurrentFacts(cycle, this.today),
    )
    const items = uniqueIds.flatMap((id) => {
      const program = programsById.get(id)
      if (!program) return []
      const record = this.programRecord(program)
      if (!record) return []
      const currentCycle = selectAdmissionCycle(currentCycles, program.id, this.today)
      const linkedScholarshipCount = this.bundle.scholarships.filter((scholarship) => (
        hasCurrentFacts(scholarship, this.today)
        && scholarshipAppliesToProgram(scholarship, program)
      )).length
      return [{
        program: record,
        currentCycle: currentCycle ? this.cycleRecord(currentCycle, program) : null,
        linkedScholarshipCount,
      }]
    })
    const returnedIds = new Set(items.map((item) => item.program.id))
    return this.envelope({
      items,
      missingIds: uniqueIds.filter((id) => !returnedIds.has(id)),
    })
  }

  listScholarships(query: ScholarshipQuery = {}): ApiEnvelope<ScholarshipRecord[]> {
    const filtered = this.bundle.scholarships.filter((scholarship) => {
      const factsAreCurrent = hasCurrentFacts(scholarship, this.today)
      const institutions = factsAreCurrent
        ? this.bundle.universities.filter((item) => scholarship.universityIds.includes(item.id))
        : []
      const programs = factsAreCurrent
        ? this.bundle.programs.filter((item) => scholarship.programIds.includes(item.id))
        : []
      return matchesQuery([
        scholarship.name,
        factsAreCurrent ? scholarship.summary : null,
        institutions.map((item) => item.name),
      ], query.q)
        && (!query.provider || scholarship.providerType === query.provider)
        && (!query.institution || institutions.some((item) => matchesIdentity(item, query.institution)))
        && (!query.program || programs.some((item) => matchesIdentity(item, query.program)))
    }).map((item) => this.scholarshipRecord(item))
    const page = paginateBySlug(filtered, 'scholarships', query)
    return this.envelope(page.items, { pageSize: page.items.length, nextCursor: page.nextCursor })
  }

  getScholarshipCycles(slug: string): ApiEnvelope<ScholarshipCycleRecord[]> | null {
    const scholarship = this.bundle.scholarships.find((item) => item.slug === slug)
    if (!scholarship) return null
    const fallback = scholarshipFallback(scholarship, this.bundle.sources)
    const identityMeta = fieldMetaMap(scholarship, this.bundle.sources, fallback, {
      id: `legacy:${scholarship.id}`,
      scholarshipId: scholarship.id,
      legacy: true,
    }, this.today, {}, false)
    const dynamicMeta = fieldMetaMap(scholarship, this.bundle.sources, fallback, {
      academicYear: null,
      intake: null,
      opensOn: null,
      closesOn: scholarship.deadline,
      deadline: scholarship.deadline,
    }, this.today, {
      academicYear: 'source_unavailable',
      intake: 'source_unavailable',
      opensOn: 'officially_not_announced',
    })
    const record: ScholarshipCycleRecord = {
      id: `legacy:${scholarship.id}`,
      scholarshipId: scholarship.id,
      academicYear: knownValue(
        dynamicMeta,
        'academicYear',
        null,
      ),
      intake: null,
      opensOn: null,
      closesOn: knownValue(dynamicMeta, 'closesOn', scholarship.deadline),
      deadline: knownValue(dynamicMeta, 'deadline', scholarship.deadline),
      legacy: true,
      officialSources: officialSourcesFor(scholarship.sourceIds, this.bundle.sources),
      fieldMeta: { ...identityMeta, ...dynamicMeta },
    }
    return this.envelope([record])
  }

  getCurrentRelease(): ApiEnvelope<ReleaseInfo> {
    return this.envelope(this.release)
  }
}

type ReleaseFromBundleOptions = {
  rawBundle?: DataBundle
  dataCheckedThrough?: string
  evaluatedForDate?: string
  activatedAt?: string
  catalogBackend?: ReleaseInfo['catalogBackend']
  deploymentSha?: string | null
}

function releaseRecordCounts(bundle: DataBundle): ReleaseInfo['recordCounts'] {
  return {
    sources: bundle.sources.length,
    cities: bundle.cities.length,
    universities: bundle.universities.length,
    programs: bundle.programs.length,
    admissionCycles: bundle.admissionCycles.length,
    scholarships: bundle.scholarships.length,
  }
}

export function releaseFromBundle(
  bundle: DataBundle,
  dataDate: string,
  options: ReleaseFromBundleOptions = {},
): ReleaseInfo {
  const generatedAt = `${dataDate}T00:00:00.000Z`
  const publicCounts = releaseRecordCounts(bundle)
  return {
    id: `json:${dataDate}`,
    dataDate,
    generatedAt,
    recordCounts: publicCounts,
    rawCounts: releaseRecordCounts(options.rawBundle ?? bundle),
    publicCounts,
    dataCheckedThrough: options.dataCheckedThrough ?? dataDate,
    evaluatedForDate: options.evaluatedForDate ?? getTodayDate(),
    activatedAt: options.activatedAt ?? generatedAt,
    catalogBackend: options.catalogBackend ?? 'json',
    deploymentSha: options.deploymentSha ?? null,
  }
}

export function localizeForSearch(value: LocalizedText): string {
  return Object.values(value).join(' ')
}
