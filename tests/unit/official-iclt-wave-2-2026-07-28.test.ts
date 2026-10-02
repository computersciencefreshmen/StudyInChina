import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

type JsonRecord = Record<string, unknown>

function load(fileName: string): JsonRecord[] {
  return JSON.parse(
    readFileSync(resolve('content/data', fileName), 'utf8'),
  ) as JsonRecord[]
}

const keys = [
  'sisu-iclt-one-semester-spring-2027',
  'tjnu-iclt-one-semester-spring-2027',
  'zcmu-iclt-one-semester-spring-2027',
  'shutcm-iclt-one-semester-spring-2027',
  'neu-iclt-one-semester-spring-2027',
  'hust-iclt-one-semester-spring-2027',
]

describe('second official ICLT wave 2026-07-28', () => {
  const sources = load('sources.json')
  const universities = load('universities.json')
  const programs = load('programs.json')
  const cycles = load('admission-cycles.json')
  const scholarships = load('scholarships.json')
  // Reproduce the maintenance rollover without making this regression depend on the wall clock.
  const rolloverDate = '2026-10-02'
  const published = selectPublishedData(bundleSchema.parse({
    sources,
    cities: load('cities.json'),
    universities,
    programs,
    admissionCycles: cycles,
    scholarships,
  }), rolloverDate)

  it('adds Tianjin Normal and Zhejiang Chinese Medical University', () => {
    for (const id of [
      'uni-tianjin-normal-university',
      'uni-zhejiang-chinese-medical-university',
    ]) {
      const item = universities.find((candidate) => candidate.id === id)
      expect(item?.status).toBe('verified')
      const name = item?.name as JsonRecord
      expect(name.en).toBeTruthy()
      expect(name.zh).toBeTruthy()
      expect(name.ru).toBeTruthy()
    }
  })

  it('retains each school route and follows its latest official recheck without refreshing other routes', () => {
    for (const key of keys) {
      const programId = `program-${key}`
      const isReverified = key === 'sisu-iclt-one-semester-spring-2027'
      const expectedStatus = isReverified ? 'verified' : 'stale'
      const program = programs.find((item) => item.id === programId)
      const recheckedAt = String(program?.verifiedAt)
      const nextReview = new Date(recheckedAt + 'T00:00:00Z')
      nextReview.setUTCDate(nextReview.getUTCDate() + 7)
      const expectedReviewAfter = isReverified ? nextReview.toISOString().slice(0, 10) : '2026-08-27'
      // Dates and funding receive a shorter three-day review window than profile facts.
      nextReview.setUTCDate(nextReview.getUTCDate() - 4)
      const expectedDynamicReviewAfter = isReverified ? nextReview.toISOString().slice(0, 10) : '2026-08-27'
      if (isReverified) {
        const primarySource = sources.find((source) => source.url === program?.programUrl)
        expect(primarySource?.accessedAt).toBe(recheckedAt)
        expect(recheckedAt.localeCompare('2026-08-25')).toBeGreaterThanOrEqual(0)
      }
      expect(program?.status).toBe(expectedStatus)
      expect(program?.reviewAfter).toBe(expectedReviewAfter)
      const cycle = cycles.find((item) => item.programId === programId)
      const expectedDynamicStatus = expectedDynamicReviewAfter < rolloverDate ? 'stale' : expectedStatus
      expect(cycle?.status).toBe(expectedDynamicStatus)
      expect(cycle?.reviewAfter).toBe(expectedDynamicReviewAfter)
      expect(cycle?.closesOn).toBe('2026-10-31')
      const scholarship = scholarships.find(
        (item) => item.id === `scholarship-${key}`,
      )
      expect(scholarship?.status).toBe(expectedDynamicStatus)
      expect(scholarship?.reviewAfter).toBe(expectedDynamicReviewAfter)
      expect(scholarship?.deadline).toBe('2026-10-31')
      if (expectedDynamicStatus === 'stale') {
        expect(published.admissionCycles.some((item) => item.id === cycle?.id)).toBe(false)
        const publicScholarship = published.scholarships.find((item) => item.id === scholarship?.id)
        expect(publicScholarship).toMatchObject({
          status: 'stale',
          deadline: null,
          applicationUrl: null,
          summary: null,
          coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null },
        })
        expect(publicScholarship?.sourceIds).toEqual(scholarship?.sourceIds)
      }
    }
  })

  it('does not copy ordinary self-funded fees into scholarship cycles', () => {
    for (const key of keys) {
      const cycle = cycles.find(
        (item) => item.id === `cycle-${key}`,
      )
      expect(cycle?.tuitionCny).toBeNull()
      expect(cycle?.applicationFeeCny).toBeNull()
      expect(cycle?.factScope).toBe('dates-only')
    }
  })

  it('makes the NEU bilingual HSK conflict visible without choosing a score', () => {
    const program = programs.find(
      (item) => item.id === 'program-neu-iclt-one-semester-spring-2027',
    )
    const requirements = program?.languageRequirements as JsonRecord[]
    expect(requirements).toHaveLength(1)
    expect(requirements[0]?.minimum).toContain('conflict')
    expect(requirements[0]?.minimum).not.toMatch(/\b(?:180|270)\b/u)
    const cycle = cycles.find(
      (item) => item.id === 'cycle-neu-iclt-one-semester-spring-2027',
    )
    expect((cycle?.notes as JsonRecord).en).toContain('conflict')
  })

  it('keeps program evidence specific and official', () => {
    const sourceById = new Map(sources.map((item) => [item.id, item]))
    for (const key of keys) {
      const program = programs.find((item) => item.id === `program-${key}`)
      const sourceIds = program?.sourceIds as string[]
      expect(sourceIds).toContain('src-clec-iclt-2026-standard')
      const matching = sourceIds
        .map((id) => sourceById.get(id))
        .find((source) => source?.url === program?.programUrl)
      expect(matching?.official).toBe(true)
      expect(matching?.kind).toBe('program')
    }
  })
})
