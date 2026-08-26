import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import {
  buildDecisionGapReport,
  DECISION_FACT_ORDER,
} from '../../scripts/quality/build-decision-gap-report'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle, Program } from '../../src/lib/data/types'

const TODAY = '2026-08-26'

const audit = {
  sourceIds: ['source-official'],
  verifiedAt: '2026-08-20',
  reviewAfter: '2026-09-30',
  status: 'verified' as const,
}

function program(
  id: string,
  universityId: string,
  overrides: Partial<Program> = {},
): Program {
  return {
    ...audit,
    id,
    slug: id,
    universityId,
    name: { en: id, zh: id },
    degreeLevel: 'bachelor',
    discipline: 'business',
    teachingLanguages: ['English'],
    durationMonths: 48,
    programUrl: `https://official.example.edu.cn/programs/${id}`,
    applyUrl: 'https://official.example.edu.cn/apply',
    languageRequirements: [{ test: 'IELTS', minimum: '6.5' }],
    verificationScope: 'facts',
    ...overrides,
  }
}

function fixture(): DataBundle {
  return {
    sources: [
      {
        id: 'source-official',
        url: 'https://official.example.edu.cn/admissions',
        title: 'Official admissions',
        publisher: 'Example University',
        kind: 'admissions',
        language: 'en',
        official: true,
        accessedAt: TODAY,
      },
      {
        id: 'source-unofficial',
        url: 'https://example.invalid/apply',
        title: 'Unofficial route',
        publisher: 'Unknown',
        kind: 'other',
        language: 'en',
        official: false,
        accessedAt: TODAY,
      },
    ],
    cities: [{
      ...audit,
      id: 'city-example',
      slug: 'example',
      name: { en: 'Example', zh: '示例' },
      province: null,
      region: 'east',
      coordinates: null,
      overview: null,
      climate: null,
      foodHighlights: [],
      sights: [],
    }],
    universities: [
      {
        ...audit,
        id: 'university-one',
        slug: 'university-one',
        name: { en: 'University One', zh: '大学一' },
        cityId: 'city-example',
        region: 'east',
        officialUrl: 'https://one.example.edu.cn',
        admissionsUrl: 'https://one.example.edu.cn/admissions',
        summary: null,
        featured: false,
      },
      {
        ...audit,
        id: 'university-two',
        slug: 'university-two',
        name: { en: 'University Two', zh: '大学二' },
        cityId: 'city-example',
        region: 'east',
        officialUrl: 'https://two.example.edu.cn',
        admissionsUrl: 'https://two.example.edu.cn/admissions',
        summary: null,
        featured: false,
      },
    ],
    programs: [
      program('program-a', 'university-one', {
        durationMonths: null,
        languageRequirements: [],
      }),
      program('program-b', 'university-one'),
      program('program-c', 'university-two', {
        sourceIds: ['source-unofficial'],
      }),
    ],
    admissionCycles: [
      {
        ...audit,
        id: 'cycle-a-fresh-disposition',
        programId: 'program-a',
        academicYear: '2026-2027',
        intake: 'autumn',
        opensOn: null,
        closesOn: null,
        dateStatus: 'not-announced',
        tuitionCny: null,
        tuitionPeriod: null,
        tuitionStatus: null,
        applicationFeeCny: null,
      },
      {
        ...audit,
        id: 'cycle-a-historical-reference',
        programId: 'program-a',
        academicYear: '2025-2026',
        intake: 'autumn',
        opensOn: null,
        closesOn: null,
        dateStatus: 'previous-cycle-reference',
        tuitionCny: 99_999,
        tuitionPeriod: 'academic-year',
        tuitionStatus: 'reference',
        applicationFeeCny: null,
      },
      {
        ...audit,
        id: 'cycle-b-confirmed-tuition',
        programId: 'program-b',
        academicYear: '2026-2027',
        intake: 'autumn',
        opensOn: null,
        closesOn: null,
        dateStatus: 'rolling',
        tuitionCny: 30_000,
        tuitionPeriod: 'academic-year',
        tuitionStatus: 'confirmed',
        applicationFeeCny: 500,
        verifiedAt: '2026-07-01',
      },
    ],
    scholarships: [],
  }
}

describe('decision-fact gap report', () => {
  it('uses production visibility and never treats historical reference tuition as current', () => {
    const data = fixture()
    const report = buildDecisionGapReport(data, {
      today: TODAY,
      priorityLimit: 2,
    })
    const programA = report.programs.find((item) => item.programId === 'program-a')
    const programB = report.programs.find((item) => item.programId === 'program-b')
    const programC = report.programs.find((item) => item.programId === 'program-c')

    expect(programA?.availability).toMatchObject({
      duration: false,
      currentConfirmedTuition: false,
      officialApplyRoute: true,
      teachingLanguage: true,
      requirements: false,
      freshDisposition: true,
    })
    expect(programA?.evidence.currentConfirmedTuitionCycleIds).toEqual([])
    expect(programA?.missingFacts).toEqual([
      'currentConfirmedTuition',
      'requirements',
      'duration',
    ])

    expect(programB?.availability.currentConfirmedTuition).toBe(true)
    expect(programB?.evidence.currentConfirmedTuitionCycleIds).toEqual([
      'cycle-b-confirmed-tuition',
    ])
    expect(programB?.availability.freshDisposition).toBe(false)

    expect(programC?.availability.officialApplyRoute).toBe(false)
    expect(programC?.evidence.officialApplyRouteSourceIds).toEqual([])
    expect(report.priorityPrograms).toHaveLength(2)
    expect(report.priorityPrograms[0]).toMatchObject({
      rank: 1,
      programId: 'program-c',
    })
    expect(report.priorityUniversities[0]).toMatchObject({
      rank: 1,
      universityId: 'university-two',
      recommendedProgramIds: ['program-c'],
    })
  })

  it('is byte-for-byte deterministic for the same bundle, date and limit', () => {
    const data = fixture()
    const first = buildDecisionGapReport(data, { today: TODAY, priorityLimit: 30 })
    const second = buildDecisionGapReport(data, { today: TODAY, priorityLimit: 30 })

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.deterministicGeneratedAt).toBe('2026-08-26T00:00:00.000Z')
  })

  it('profiles the current formal catalog and derives every tuition flag from public confirmed cycles', () => {
    const data = bundleSchema.parse({
      admissionCycles,
      cities,
      programs,
      scholarships,
      sources,
      universities,
    })
    const published = selectPublishedData(data, TODAY)
    const report = buildDecisionGapReport(data, { today: TODAY })
    const cyclesByProgram = new Map<string, typeof published.admissionCycles>()
    for (const cycle of published.admissionCycles) {
      const records = cyclesByProgram.get(cycle.programId) ?? []
      records.push(cycle)
      cyclesByProgram.set(cycle.programId, records)
    }

    expect(report.summary.publicUniversities).toBe(published.universities.length)
    expect(report.summary.publicPrograms).toBe(published.programs.length)
    expect(report.priorityUniversities).toHaveLength(30)
    expect(report.priorityPrograms).toHaveLength(30)
    expect(report.priorityUniversities.map((item) => item.rank)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    )
    expect(report.priorityPrograms.map((item) => item.rank)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    )

    for (const item of report.programs) {
      const expectedCurrentConfirmedTuition = (cyclesByProgram.get(item.programId) ?? [])
        .some((cycle) => (
          cycle.tuitionCny !== null
          && cycle.tuitionStatus === 'confirmed'
        ))
      expect(
        item.availability.currentConfirmedTuition,
        item.programId,
      ).toBe(expectedCurrentConfirmedTuition)
      expect(item.missingFacts).toEqual(
        DECISION_FACT_ORDER.filter((fact) => !item.availability[fact]),
      )
    }

    for (const item of report.priorityPrograms) {
      expect(item.missingFacts.length, item.programId).toBeGreaterThan(0)
    }
  })
})
