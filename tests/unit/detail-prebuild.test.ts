import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  selectCityPrebuildSlugs,
  selectProgramPrebuildSlugs,
  selectScholarshipPrebuildSlugs,
  selectUniversityPrebuildSlugs,
} from '../../src/lib/data/detail-prebuild'
import type {
  AdmissionCycle,
  City,
  DataBundle,
  Program,
  Scholarship,
  University,
} from '../../src/lib/data/types'

const audit = {
  sourceIds: ['source-official'],
  verifiedAt: '2026-08-01',
  reviewAfter: '2026-09-01',
  status: 'verified' as const,
}

function program(id: string, overrides: Partial<Program> = {}): Program {
  return {
    ...audit,
    id,
    slug: id,
    universityId: 'university-a',
    name: { en: id },
    degreeLevel: 'master',
    discipline: 'engineering',
    teachingLanguages: ['English'],
    durationMonths: 24,
    programUrl: `https://example.edu/${id}`,
    applyUrl: 'https://apply.example.edu',
    languageRequirements: [{ test: 'IELTS', minimum: '6.5' }],
    ...overrides,
  }
}

function cycle(programId: string, overrides: Partial<AdmissionCycle> = {}): AdmissionCycle {
  return {
    ...audit,
    id: `cycle-${programId}`,
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn: '2026-07-01',
    closesOn: '2026-10-01',
    dateStatus: 'published',
    tuitionCny: 30_000,
    applicationFeeCny: 800,
    ...overrides,
  }
}

function university(id: string, overrides: Partial<University> = {}): University {
  return {
    ...audit,
    id,
    slug: id,
    name: { en: id },
    cityId: 'city-a',
    region: 'east',
    officialUrl: `https://${id}.edu.cn`,
    admissionsUrl: `https://${id}.edu.cn/admissions`,
    summary: { en: id },
    featured: false,
    ...overrides,
  }
}

function scholarship(id: string, overrides: Partial<Scholarship> = {}): Scholarship {
  return {
    ...audit,
    id,
    slug: id,
    name: { en: id },
    providerType: 'university',
    universityIds: ['university-a'],
    programIds: [],
    coverage: {
      tuition: 'full',
      accommodation: 'full',
      insurance: true,
      stipendCnyPerMonth: 3_000,
    },
    deadline: '2026-10-01',
    applicationUrl: 'https://apply.example.edu/scholarship',
    summary: { en: id },
    ...overrides,
  }
}

function city(id: string, overrides: Partial<City> = {}): City {
  return {
    ...audit,
    id,
    slug: id,
    name: { en: id },
    province: { en: 'Province' },
    region: 'east',
    coordinates: { lat: 30, lng: 120 },
    overview: { en: id },
    climate: null,
    foodHighlights: [],
    sights: [],
    ...overrides,
  }
}

function bundle(): DataBundle {
  return {
    sources: [],
    cities: [city('city-a'), city('city-z', { coordinates: null, overview: null })],
    universities: [
      university('university-a', { featured: true }),
      university('university-z', {
        cityId: 'city-z',
        admissionsUrl: null,
        summary: null,
      }),
    ],
    programs: [
      program('program-open'),
      program('program-thin', {
        universityId: 'university-z',
        status: 'stale',
        teachingLanguages: [],
        durationMonths: null,
        applyUrl: null,
        languageRequirements: [],
      }),
    ],
    admissionCycles: [
      cycle('program-open'),
      cycle('program-thin', {
        opensOn: null,
        closesOn: null,
        dateStatus: 'not-announced',
        tuitionCny: null,
      }),
    ],
    scholarships: [
      scholarship('scholarship-current'),
      scholarship('scholarship-thin', {
        status: 'stale',
        universityIds: [],
        coverage: {
          tuition: 'unknown',
          accommodation: 'unknown',
          insurance: 'unknown',
          stipendCnyPerMonth: null,
        },
        deadline: null,
        applicationUrl: null,
        summary: null,
      }),
    ],
  }
}

describe('detail-page prebuild selection', () => {
  it('prioritizes complete, actionable records and obeys deterministic limits', () => {
    const data = bundle()
    expect(selectProgramPrebuildSlugs(data, '2026-08-06', 1)).toEqual(['program-open'])
    expect(selectScholarshipPrebuildSlugs(data, '2026-08-06', 1)).toEqual([
      'scholarship-current',
    ])
    expect(selectUniversityPrebuildSlugs(data, 1)).toEqual(['university-a'])
    expect(selectCityPrebuildSlugs(data, 1)).toEqual(['city-a'])
    expect(selectProgramPrebuildSlugs(data, '2026-08-06', 0)).toEqual([])
  })

  it('uses slug ordering as the stable tie-breaker', () => {
    const data = bundle()
    data.programs = [program('program-b'), program('program-a')]
    data.admissionCycles = []
    expect(selectProgramPrebuildSlugs(data, '2026-08-06', 2)).toEqual([
      'program-a',
      'program-b',
    ])
  })

  it('keeps beta locales out of build-time detail expansion', () => {
    const detailPages = [
      'src/app/[locale]/programs/[slug]/page.tsx',
      'src/app/[locale]/scholarships/[slug]/page.tsx',
      'src/app/[locale]/universities/[slug]/page.tsx',
      'src/app/[locale]/cities/[slug]/page.tsx',
    ]
    for (const path of detailPages) {
      const source = readFileSync(path, 'utf8')
      expect(source).toContain('indexedLocales')
      expect(source).toContain('export const dynamicParams = true')
      expect(source).not.toContain('launchLocales')
    }
  })
})
