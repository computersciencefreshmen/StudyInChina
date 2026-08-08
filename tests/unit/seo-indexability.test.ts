import { describe, expect, it } from 'vitest'

import {
  isIndexableCity,
  isIndexableProgram,
  isIndexableScholarship,
} from '@/lib/seo/indexability'
import type {
  AdmissionCycle,
  City,
  Program,
  Scholarship,
  University,
} from '@/lib/data/types'

const audit = {
  sourceIds: ['source-1'],
  verifiedAt: '2026-08-01',
  reviewAfter: '2026-09-01',
  status: 'verified' as const,
}

const program: Program = {
  ...audit,
  id: 'program-1',
  slug: 'verified-program',
  universityId: 'university-1',
  name: { en: 'Verified program' },
  degreeLevel: 'master',
  discipline: 'engineering',
  teachingLanguages: ['English'],
  durationMonths: 24,
  programUrl: 'https://example.edu/program',
  applyUrl: 'https://example.edu/apply',
  languageRequirements: [],
  verificationScope: 'complete',
  details: {
    faculty: { en: 'Engineering' },
    overview: { en: 'A source-backed overview.' },
    qualification: { en: 'Master degree' },
    studyMode: 'full-time',
    languagePolicy: { en: 'English taught' },
    curriculumHighlights: [{ en: 'Research methods' }],
    eligibility: [{ en: 'Bachelor degree' }],
    applicationMaterials: [{ en: 'Transcript' }],
  },
}

const cycle: AdmissionCycle = {
  ...audit,
  id: 'cycle-1',
  programId: program.id,
  academicYear: '2026-2027',
  intake: 'autumn',
  opensOn: '2026-08-01',
  closesOn: '2026-12-01',
  dateStatus: 'published',
  tuitionCny: 30_000,
  tuitionPeriod: 'academic-year',
  applicationFeeCny: 600,
}

const scholarship: Scholarship = {
  ...audit,
  id: 'scholarship-1',
  slug: 'verified-scholarship',
  name: { en: 'Verified scholarship' },
  providerType: 'university',
  universityIds: ['university-1'],
  programIds: [],
  coverage: {
    tuition: 'full',
    accommodation: 'unknown',
    insurance: 'unknown',
    stipendCnyPerMonth: null,
  },
  deadline: null,
  applicationUrl: 'https://example.edu/scholarship',
  summary: { en: 'Official funding opportunity.' },
}

const city: City = {
  ...audit,
  id: 'city-1',
  slug: 'example-city',
  name: { en: 'Example City' },
  province: { en: 'Example Province' },
  region: 'east',
  coordinates: { lat: 31, lng: 121 },
  overview: { en: 'A verified city overview.' },
  climate: null,
  foodHighlights: [],
  sights: [],
}

const university: University = {
  ...audit,
  id: 'university-1',
  slug: 'example-university',
  name: { en: 'Example University' },
  cityId: city.id,
  region: 'east',
  officialUrl: 'https://example.edu',
  admissionsUrl: 'https://example.edu/admissions',
  summary: { en: 'A verified university.' },
  featured: false,
}

describe('SEO indexability policy', () => {
  it('indexes only a program with complete decision context and a current cycle', () => {
    expect(isIndexableProgram(program, [cycle], '2026-08-08')).toBe(true)
    expect(isIndexableProgram({ ...program, details: undefined }, [cycle], '2026-08-08')).toBe(false)
    expect(isIndexableProgram({ ...program, verificationScope: 'identity' }, [cycle], '2026-08-08')).toBe(false)
    expect(isIndexableProgram(program, [], '2026-08-08')).toBe(false)
  })

  it('requires an actionable, scoped scholarship summary', () => {
    expect(isIndexableScholarship(scholarship)).toBe(true)
    expect(isIndexableScholarship({
      ...scholarship,
      universityIds: [],
      coverage: {
        tuition: 'unknown',
        accommodation: 'unknown',
        insurance: 'unknown',
        stipendCnyPerMonth: null,
      },
    })).toBe(false)
    expect(isIndexableScholarship({
      ...scholarship,
      universityIds: ['university-1'],
      deadline: null,
      coverage: {
        tuition: 'unknown',
        accommodation: 'unknown',
        insurance: 'unknown',
        stipendCnyPerMonth: null,
      },
    })).toBe(false)
  })

  it('indexes a city only when place context and a public university are present', () => {
    expect(isIndexableCity(city, [university])).toBe(true)
    expect(isIndexableCity({ ...city, coordinates: null }, [university])).toBe(false)
    expect(isIndexableCity(city, [])).toBe(false)
  })
})
