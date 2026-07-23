export type FactStatus =
  | 'known'
  | 'officially_not_announced'
  | 'not_applicable'
  | 'source_unavailable'
  | 'conflict'
  | 'stale'

export type LocalizedValue = Record<string, string>

export type OfficialSourceDto = {
  id: string
  url: string
  title: string
  publisher: string
  languageCode: string
  authorityLevel: 'primary_official' | 'secondary_official'
  checkedAt: string
}

export type FieldMetaDto = {
  status: FactStatus
  officialUrl: string
  sourceTitle: string
  checkedAt: string
  verifiedAt: string | null
  reviewAfter: string | null
  sourceIds: string[]
}

export type ReleaseInfoDto = {
  id: string
  dataDate: string
  generatedAt: string
  recordCounts: {
    sources: number
    cities: number
    universities: number
    programs: number
    admissionCycles: number
    scholarships: number
  }
}

export type ApiMetaDto = {
  apiVersion: 'v1'
  release: ReleaseInfoDto
  notice: string
  pageSize?: number
  nextCursor?: string | null
}

export type ApiEnvelopeDto<T> = {
  data: T
  meta: ApiMetaDto
}

export type RecordDto<
  Kind extends string,
  Attributes extends object,
  Relationships extends object,
> = {
  type: Kind
  id: string
  slug: string | null
  attributes: Attributes
  relationships: Relationships
  sources: OfficialSourceDto[]
  fieldMeta: Record<string, FieldMetaDto>
}

export type LocationSummaryDto = {
  id: string
  slug: string | null
  name: LocalizedValue
  countryCode: string
  regionCode: string | null
}

export type InstitutionDto = RecordDto<
  'institution',
  {
    name: LocalizedValue
    summary: LocalizedValue | null
    institutionType: string
    officialUrl: string
    admissionsUrl: string
    featured: boolean
  },
  {
    location: LocationSummaryDto
    programs: { count: number }
    scholarships: { count: number }
  }
>

export type ProgramType =
  | 'degree'
  | 'language'
  | 'foundation'
  | 'exchange'
  | 'visiting'
  | 'short_term'
  | 'other'

export type DegreeLevel = 'bachelor' | 'master' | 'doctorate' | null

export type DurationDto = {
  minimum: number | null
  maximum: number | null
  unit: 'days' | 'weeks' | 'months' | 'semesters' | 'academic_years' | null
}

export type InstitutionSummaryDto = {
  id: string
  slug: string | null
  name: LocalizedValue
}

export type ProgramDto = RecordDto<
  'program',
  {
    name: LocalizedValue
    programType: ProgramType
    degreeLevel: DegreeLevel
    credentialType: string | null
    attendanceMode: 'full_time' | 'part_time' | 'hybrid'
    deliveryMode: 'on_campus' | 'online' | 'hybrid'
    duration: DurationDto
    disciplineCodes: string[]
    teachingLanguageCodes: string[]
    officialUrl: string
    applyUrl: string | null
  },
  {
    institution: InstitutionSummaryDto
  }
>

export type ApplicationState =
  | 'open'
  | 'upcoming'
  | 'closed'
  | 'rolling'
  | 'dates-published'
  | 'not-announced'
  | 'previous-cycle'

export type MoneyDto = {
  amountMinimumMinor: number | null
  amountMaximumMinor: number | null
  currencyCode: string | null
  currencyExponent: number | null
  period: string | null
}

export type ApplicationDto = {
  routeType: string | null
  accessMode: string | null
  applyUrl: string | null
  opensOn: string | null
  closesOn: string | null
  rolling: boolean | null
  state: ApplicationState
}

export type ProgramCycleDto = RecordDto<
  'program_cycle',
  {
    academicYear: string
    intake: string
    sequence: number
    cycleStatus: string
    startsOn: string | null
    endsOn: string | null
    application: ApplicationDto
    tuition: MoneyDto | null
    applicationFee: MoneyDto | null
  },
  {
    program: { id: string; slug: string | null }
  }
>

export type ScholarshipScopeDto = {
  institutionIds: string[] | null
  programIds: string[] | null
  degreeLevels: string[] | null
  disciplineCodes: string[] | null
  nationalities: string[] | null
}

export type ScholarshipCoverageDto = {
  tuition: string | null
  accommodation: string | null
  insurance: boolean | string | null
  stipendCnyPerMonth: number | null
}

export type ScholarshipDto = RecordDto<
  'scholarship',
  {
    name: LocalizedValue
    summary: LocalizedValue | null
    schemeType: string
    officialUrl: string
    deadline: string | null
    scope: ScholarshipScopeDto
    coverage: ScholarshipCoverageDto
  },
  {
    provider: {
      id: string
      slug: string | null
      organizationType: string
      officialUrl: string
    }
  }
>

export type ScholarshipCoverageItemDto = {
  id: string
  coverageType: string
  coverageMode: string | null
  amount: MoneyDto | null
  maximumDuration: number | null
  maximumDurationUnit: string | null
}

export type ScholarshipCycleDto = RecordDto<
  'scholarship_cycle',
  {
    academicYear: string | null
    intake: string | null
    sequence: number
    cycleStatus: string
    legacyProjection: boolean
    application: ApplicationDto
    institutionScope: string | null
    programScope: string | null
    degreeScope: string | null
    nationalityScope: string | null
    coverage: ScholarshipCoverageItemDto[]
  },
  {
    scholarship: { id: string; slug: string | null }
  }
>

export type ListOptions = {
  cursor?: string
  limit?: number
}

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
