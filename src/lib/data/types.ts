import type { Locale } from '@/i18n/config'

export type LocalizedText = Partial<Record<Locale, string>>
export type ContentStatus = 'draft' | 'verified' | 'stale' | 'archived'
export type Region = 'north' | 'northeast' | 'east' | 'south' | 'central' | 'southwest' | 'northwest'
export type DegreeLevel = 'bachelor' | 'master' | 'doctorate' | 'language' | 'foundation' | 'other'
export type Discipline = 'engineering' | 'business' | 'medicine' | 'chinese-education' | 'humanities' | 'law-ir' | 'science' | 'art-design' | 'other'

export type AuditMeta = {
  sourceIds: string[]
  verifiedAt: string
  reviewAfter: string
  status: ContentStatus
}

export type Source = {
  id: string
  url: string
  title: string
  publisher: string
  kind: 'university' | 'program' | 'admissions' | 'scholarship' | 'government' | 'city' | 'other'
  language: 'zh' | 'en' | 'ru' | 'other'
  official: boolean
  accessedAt: string
}

export type City = AuditMeta & {
  id: string
  slug: string
  name: LocalizedText
  province: LocalizedText | null
  region: Region | null
  coordinates: { lat: number; lng: number } | null
  overview: LocalizedText | null
  climate: LocalizedText | null
  foodHighlights: LocalizedText[]
  sights: LocalizedText[]
}

export type University = AuditMeta & {
  id: string
  slug: string
  name: LocalizedText
  cityId: string
  region: Region | null
  officialUrl: string
  admissionsUrl: string | null
  summary: LocalizedText | null
  featured: boolean
}

export type LanguageRequirement = {
  test: 'HSK' | 'IELTS' | 'TOEFL' | 'other'
  minimum: string | null
}

export type ProgramDetails = {
  faculty: LocalizedText
  overview: LocalizedText
  qualification: LocalizedText
  studyMode: 'full-time' | 'part-time' | 'hybrid'
  languagePolicy: LocalizedText
  curriculumHighlights: LocalizedText[]
  eligibility: LocalizedText[]
  applicationMaterials: LocalizedText[]
  campus?: LocalizedText
}

export type Program = AuditMeta & {
  id: string
  slug: string
  universityId: string
  name: LocalizedText
  degreeLevel: DegreeLevel
  discipline: Discipline
  teachingLanguages: string[]
  durationMonths: number | null
  durationMonthsMax?: number | null
  programUrl: string
  applyUrl: string | null
  languageRequirements: LanguageRequirement[]
  details?: ProgramDetails
}

export type AdmissionCycle = AuditMeta & {
  id: string
  programId: string
  academicYear: string
  intake: 'spring' | 'autumn' | 'other'
  opensOn: string | null
  closesOn: string | null
  dateStatus: 'published' | 'rolling' | 'not-announced' | 'previous-cycle-reference'
  tuitionCny: number | null
  tuitionPeriod?: 'program' | 'semester' | 'academic-year' | 'month' | 'other' | null
  tuitionStatus?: 'confirmed' | 'reference' | null
  evidenceBasis?: 'cycle-specific' | 'recurring-official-rule'
  applicationFeeCny: number | null
}

export type Scholarship = AuditMeta & {
  id: string
  slug: string
  name: LocalizedText
  providerType: 'csc' | 'university' | 'province' | 'city' | 'other'
  universityIds: string[]
  programIds: string[]
  coverage: {
    tuition: 'full' | 'partial' | 'none' | 'unknown'
    accommodation: 'full' | 'partial' | 'none' | 'unknown'
    insurance: boolean | 'unknown'
    stipendCnyPerMonth: number | null
  }
  deadline: string | null
  applicationUrl: string | null
  summary: LocalizedText | null
}

export type DataBundle = {
  sources: Source[]
  cities: City[]
  universities: University[]
  programs: Program[]
  admissionCycles: AdmissionCycle[]
  scholarships: Scholarship[]
}
