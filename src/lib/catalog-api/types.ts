import type {
  AdmissionCycle,
  City,
  Program,
  Scholarship,
  University,
} from '@/lib/data/types'

export type FactStatus =
  | 'known'
  | 'officially_not_announced'
  | 'not_applicable'
  | 'source_unavailable'
  | 'conflict'
  | 'stale'

export type FieldMeta = {
  status: FactStatus
  officialUrl: string
  sourceTitle: string
  checkedAt: string
}

export type OfficialSourceLink = {
  url: string
  title: string
  checkedAt: string
}

export type ReleaseInfo = {
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

export type ProgramType =
  | 'degree'
  | 'language'
  | 'foundation'
  | 'exchange'
  | 'visiting'
  | 'short_term'

  | 'other'
export type InstitutionRecord = Omit<University, 'summary'> & {
  summary: University['summary'] | null
  city: Pick<City, 'id' | 'slug' | 'name' | 'province' | 'region'> | null
  programCount: number
  scholarshipCount: number
  officialSources: OfficialSourceLink[]
  fieldMeta: Record<string, FieldMeta>
}

export type ProgramRecord = Omit<
  Program,
  | 'discipline'
  | 'teachingLanguages'
  | 'durationMonths'
  | 'durationMonthsMax'
  | 'applyUrl'
  | 'languageRequirements'
  | 'details'
> & {
  discipline: Program['discipline'] | null
  teachingLanguages: Program['teachingLanguages'] | null
  durationMonths: Program['durationMonths']
  durationMonthsMax: Program['durationMonthsMax'] | null
  applyUrl: Program['applyUrl'] | null
  languageRequirements: Program['languageRequirements'] | null
  details: Program['details'] | null
  programType: ProgramType
  university: Pick<University, 'id' | 'slug' | 'name'>
  officialSources: OfficialSourceLink[]
  fieldMeta: Record<string, FieldMeta>
}

export type AdmissionCycleRecord = Omit<
  AdmissionCycle,
  | 'opensOn'
  | 'closesOn'
  | 'dateStatus'
  | 'tuitionCny'
  | 'tuitionPeriod'
  | 'tuitionStatus'
  | 'evidenceBasis'
  | 'applicationFeeCny'
> & {
  opensOn: AdmissionCycle['opensOn']
  closesOn: AdmissionCycle['closesOn']
  dateStatus: AdmissionCycle['dateStatus'] | null
  tuitionCny: AdmissionCycle['tuitionCny']
  tuitionPeriod: AdmissionCycle['tuitionPeriod'] | null
  tuitionStatus: AdmissionCycle['tuitionStatus'] | null
  evidenceBasis: AdmissionCycle['evidenceBasis'] | null
  applicationFeeCny: AdmissionCycle['applicationFeeCny']
  applicationState:
    | 'open'
    | 'upcoming'
    | 'closed'
    | 'rolling'
    | 'dates-published'
    | 'not-announced'
    | 'previous-cycle'
  officialSources: OfficialSourceLink[]
  fieldMeta: Record<string, FieldMeta>
}

export type ScholarshipRecord = Omit<
  Scholarship,
  'universityIds' | 'programIds' | 'coverage' | 'deadline' | 'summary'
> & {
  universityIds: Scholarship['universityIds'] | null
  programIds: Scholarship['programIds'] | null
  coverage: {
    tuition: Exclude<Scholarship['coverage']['tuition'], 'unknown'> | null
    accommodation: Exclude<Scholarship['coverage']['accommodation'], 'unknown'> | null
    insurance: Exclude<Scholarship['coverage']['insurance'], 'unknown'> | null
    stipendCnyPerMonth: number | null
  }
  deadline: Scholarship['deadline']
  summary: Scholarship['summary'] | null
  officialSources: OfficialSourceLink[]
  fieldMeta: Record<string, FieldMeta>
}

export type ScholarshipCycleRecord = {
  id: string
  scholarshipId: string
  academicYear: string | null
  intake: string | null
  opensOn: string | null
  closesOn: string | null
  deadline: string | null
  legacy: boolean
  officialSources: OfficialSourceLink[]
  fieldMeta: Record<string, FieldMeta>
}

export type ApiMeta = {
  release: ReleaseInfo
  pageSize?: number
  nextCursor?: string | null
  notice: string
}

export type ApiEnvelope<T> = {
  data: T
  meta: ApiMeta
}

export const AUTOMATED_COLLECTION_NOTICE =
  '信息由自动化系统收录并定期更新；申请条件、费用与截止日期以学校或奖学金官方网站实际情况为准。'
