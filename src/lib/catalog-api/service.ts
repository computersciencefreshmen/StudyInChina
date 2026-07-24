import { getApplicationState } from '@/lib/data/admission'
import type {
  AdmissionCycle,
  AuditMeta,
  DataBundle,
  LocalizedText,
  Program,
  Scholarship,
} from '@/lib/data/types'
import { fieldMetaMap, officialSourcesFor } from './field-meta'
import { paginateBySlug } from './cursor'
import type {
  AdmissionCycleRecord,
  ApiEnvelope,
  InstitutionRecord,
  ProgramRecord,
  ProgramType,
  ReleaseInfo,
  ScholarshipCycleRecord,
  ScholarshipRecord,
} from './types'
import { AUTOMATED_COLLECTION_NOTICE } from './types'

export type ListOptions = { cursor?: string; limit?: number }

export type InstitutionQuery = ListOptions & {
  q?: string
  city?: string
  region?: string
  discipline?: string
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

function matchesIdentity(value: { id: string; slug: string }, expected?: string) {
  return !expected || value.id === expected || value.slug === expected
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
    private readonly today = new Date().toISOString().slice(0, 10),
  ) {}

  private envelope<T>(data: T, page?: { pageSize: number; nextCursor: string | null }): ApiEnvelope<T> {
    return {
      data,
      meta: {
        release: this.release,
        notice: AUTOMATED_COLLECTION_NOTICE,
        ...(page ? { pageSize: page.pageSize, nextCursor: page.nextCursor } : {}),
      },
    }
  }

  private institutionRecord(university: DataBundle['universities'][number]): InstitutionRecord {
    const city = this.bundle.cities.find((item) => item.id === university.cityId) ?? null
    const relatedPrograms = this.bundle.programs.filter((item) => item.universityId === university.id)
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
      const currentSummary = hasCurrentFacts(university, this.today) ? university.summary : null
      return matchesQuery([university.name, currentSummary, city?.name, programs.map((item) => item.name)], query.q)
        && (!query.city || Boolean(city && matchesIdentity(city, query.city)))
        && (!query.region || university.region === query.region)
        && (!query.discipline || programs.some((item) => item.discipline === query.discipline))
    }).map((item) => this.institutionRecord(item))
    const page = paginateBySlug(filtered, query)
    return this.envelope(page.items, { pageSize: page.items.length, nextCursor: page.nextCursor })
  }

  getInstitution(slug: string): ApiEnvelope<InstitutionRecord> | null {
    const university = this.bundle.universities.find((item) => item.slug === slug)
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
          && (item.programIds.includes(program.id) || item.universityIds.includes(program.universityId)),
      )
      const hasCycleFilters = Boolean(
        query.academicYear || query.intake || query.applicationState
        || query.tuitionMin !== undefined || query.tuitionMax !== undefined,
      )
      const matchesCycle = !hasCycleFilters || cycles.some((cycle) => {
        if (!hasCurrentFacts(cycle, this.today)) return false
        const tuition = cycle.tuitionCny
        return (!query.academicYear || cycle.academicYear === query.academicYear)
          && (!query.intake || cycle.intake === query.intake)
          && (!query.applicationState || getApplicationState(cycle, this.today) === query.applicationState)
          && (query.tuitionMin === undefined || (tuition !== null && tuition >= query.tuitionMin))
          && (query.tuitionMax === undefined || (tuition !== null && tuition <= query.tuitionMax))
      })
      const programFacts = hasCurrentFacts(program, this.today)
        ? [program.discipline, program.teachingLanguages]
        : []
      return matchesQuery([program.name, university.name, programFacts], query.q)
        && (!query.institution || matchesIdentity(university, query.institution))
        && (!query.city || Boolean(city && matchesIdentity(city, query.city)))
        && (!query.type || deriveProgramType(program) === query.type)
        && (!query.degree || program.degreeLevel === query.degree)
        && (!query.discipline || (hasCurrentFacts(program, this.today) && program.discipline === query.discipline))
        && (!query.language || (hasCurrentFacts(program, this.today)
          && program.teachingLanguages.some((item) => item.toLocaleLowerCase() === query.language?.toLocaleLowerCase())))
        && (!query.scholarship || scholarships.some((item) => matchesIdentity(item, query.scholarship)))
        && matchesCycle
    }).map((item) => this.programRecord(item)).filter((item): item is ProgramRecord => item !== null)
    const page = paginateBySlug(filtered, query)
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
    const page = paginateBySlug(filtered, query)
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

export function releaseFromBundle(bundle: DataBundle, dataDate: string): ReleaseInfo {
  return {
    id: `json:${dataDate}`,
    dataDate,
    generatedAt: `${dataDate}T00:00:00.000Z`,
    recordCounts: {
      sources: bundle.sources.length,
      cities: bundle.cities.length,
      universities: bundle.universities.length,
      programs: bundle.programs.length,
      admissionCycles: bundle.admissionCycles.length,
      scholarships: bundle.scholarships.length,
    },
  }
}

export function localizeForSearch(value: LocalizedText): string {
  return Object.values(value).join(' ')
}
