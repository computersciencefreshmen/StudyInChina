import type { Locale } from '@/i18n/config'

export type LocalizedText = { en: string } & Partial<Record<Exclude<Locale, 'en'>, string>>
export type ContentStatus = 'draft' | 'verified' | 'stale' | 'archived'
export type Region = 'north' | 'northeast' | 'east' | 'south' | 'central' | 'southwest' | 'northwest'
export type DegreeLevel = 'bachelor' | 'master' | 'language' | 'foundation'
export type Discipline = 'engineering' | 'business' | 'medicine' | 'chinese-education' | 'humanities' | 'law-ir' | 'science' | 'art-design'

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
  kind: 'university' | 'program' | 'admissions' | 'scholarship' | 'government' | 'city'
  language: 'zh' | 'en' | 'ru' | 'other'
  official: boolean
  accessedAt: string
}

export type City = AuditMeta & {
  id: string
  slug: string
  name: LocalizedText
  province: LocalizedText
  region: Region
  coordinates: { lat: number; lng: number }
  overview: LocalizedText
  climate: LocalizedText
  foodHighlights: LocalizedText[]
  sights: LocalizedText[]
}

export type University = AuditMeta & {
  id: string
  slug: string
  name: LocalizedText
  cityId: string
  region: Region
  officialUrl: string
  admissionsUrl: string
  summary: LocalizedText
  featured: boolean
}

export type LanguageRequirement = {
  test: 'HSK' | 'IELTS' | 'TOEFL' | 'other'
  minimum: string | null
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
  programUrl: string
  applyUrl: string
  languageRequirements: LanguageRequirement[]
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
  applicationUrl: string
  summary: LocalizedText
}

export type DataBundle = {
  sources: Source[]
  cities: City[]
  universities: University[]
  programs: Program[]
  admissionCycles: AdmissionCycle[]
  scholarships: Scholarship[]
}
