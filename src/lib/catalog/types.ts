import type {
  AdmissionCycle,
  City,
  DataBundle,
  LocalizedText,
  Program,
  Scholarship,
  University,
} from '@/lib/data/types'

export const CATALOG_COLLECTIONS = [
  'sources',
  'cities',
  'universities',
  'programs',
  'admissionCycles',
  'scholarships',
] as const

export type CatalogCollection = (typeof CATALOG_COLLECTIONS)[number]
export type CatalogBackendMode = 'json' | 'd1' | 'shadow'

export type CatalogRecordCounts = Record<CatalogCollection, number>

export const CATALOG_LIST_DEFAULT_LIMIT = 24
export const CATALOG_LIST_MAX_LIMIT = 100

export type CatalogListOption = {
  value: string
  name: LocalizedText
}

export type CatalogListPage<T, Facets> = {
  items: T[]
  nextCursor: string | null
  /** Exact for JSON and APIs that expose a count; null for cursor-only APIs. */
  total: number | null
  facets: Facets
  release: CatalogRelease | null
}

export type CatalogInstitutionListSort =
  | 'default'
  | 'name'
  | 'programs-desc'
  | 'scholarships-desc'

export type CatalogInstitutionListQuery = {
  q?: string
  city?: string
  region?: string
  discipline?: string
  sort?: CatalogInstitutionListSort
  cursor?: string
  limit?: number
  today?: string
}

export type CatalogInstitutionCity = Pick<
  City,
  'id' | 'slug' | 'name' | 'region'
>

export type CatalogInstitutionListItem = {
  institution: University
  city: CatalogInstitutionCity | null
  programCount: number
  scholarshipCount: number
  disciplines: string[]
}

export type CatalogInstitutionListFacets = {
  cities: CatalogListOption[]
}

export type CatalogInstitutionListPage = CatalogListPage<
  CatalogInstitutionListItem,
  CatalogInstitutionListFacets
>

export type CatalogProgramListQuery = {
  q?: string
  institution?: string
  city?: string
  type?: string
  degree?: string
  discipline?: string
  language?: string
  academicYear?: string
  intake?: string
  tuition?: string
  tuitionMin?: number
  tuitionMax?: number
  applicationState?: string
  scholarship?: string
  sort?: string
  cursor?: string
  limit?: number
  today?: string
}

export type CatalogProgramListItem = {
  program: Program
  university: University
  currentCycle: AdmissionCycle | null
  latestTuitionReference?: AdmissionCycle | null
}

export type CatalogProgramListFacets = {
  universities: CatalogListOption[]
  cities: CatalogListOption[]
}

export type CatalogProgramListPage = CatalogListPage<
  CatalogProgramListItem,
  CatalogProgramListFacets
>

export type CatalogScholarshipListQuery = {
  q?: string
  provider?: string
  institution?: string
  program?: string
  degree?: string
  funding?: string
  deadline?: string
  sort?: string
  cursor?: string
  limit?: number
  today?: string
}

export type CatalogScholarshipCurrentCycle = {
  id: string
  scholarshipId: string
  academicYear: string | null
  opensOn: string | null
  closesOn: string | null
  deadline: string | null
  deadlineState: 'future' | 'closed' | 'not-announced'
  daysRemaining: number | null
  legacy: boolean
}

export type CatalogScholarshipListItem = {
  scholarship: Scholarship
  universities: University[]
  programs: Program[]
  currentCycle: CatalogScholarshipCurrentCycle
}

export type CatalogScholarshipListFacets = {
  universities: CatalogListOption[]
}

export type CatalogScholarshipListPage = CatalogListPage<
  CatalogScholarshipListItem,
  CatalogScholarshipListFacets
>

export type CatalogRelease = {
  id: string
  dataDate: string
  generatedAt: string
  recordCounts: CatalogRecordCounts
  rawCounts: CatalogRecordCounts
  publicCounts: CatalogRecordCounts
  dataCheckedThrough: string
  evaluatedForDate: string
  activatedAt: string
  catalogBackend: CatalogBackendMode
  deploymentSha: string | null
}

export interface CatalogRepository {
  readonly mode: CatalogBackendMode
  getBundle(): Promise<DataBundle>
  getRelease(): Promise<CatalogRelease>
  /** Runtime release truth; remote backends may read the live Worker endpoint. */
  getOperationalRelease?(): Promise<CatalogRelease>
  /** Optional lightweight API projection that must not load the compatibility bundle. */
  comparePrograms?(ids: string[]): Promise<unknown>
  listInstitutions(query?: CatalogInstitutionListQuery): Promise<CatalogInstitutionListPage>
  listPrograms(query?: CatalogProgramListQuery): Promise<CatalogProgramListPage>
  listScholarships(query?: CatalogScholarshipListQuery): Promise<CatalogScholarshipListPage>
}

export type CatalogBundleLoader = () => unknown | Promise<unknown>
export type CatalogFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export class CatalogRepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CatalogRepositoryError'
  }
}
