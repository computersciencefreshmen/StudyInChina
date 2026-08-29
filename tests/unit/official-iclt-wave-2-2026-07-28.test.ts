import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

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

  it('retains one program, one cycle and one scholarship per school route with current freshness', () => {
    for (const key of keys) {
      const programId = `program-${key}`
      const isReverified = key === 'sisu-iclt-one-semester-spring-2027'
      const expectedStatus = isReverified ? 'verified' : 'stale'
      const expectedReviewAfter = isReverified ? '2026-09-01' : '2026-08-27'
      const program = programs.find((item) => item.id === programId)
      expect(program?.status).toBe(expectedStatus)
      expect(program?.reviewAfter).toBe(expectedReviewAfter)
      const cycle = cycles.find((item) => item.programId === programId)
      expect(cycle?.status).toBe(expectedStatus)
      expect(cycle?.reviewAfter).toBe(expectedReviewAfter)
      expect(cycle?.closesOn).toBe('2026-10-31')
      const scholarship = scholarships.find(
        (item) => item.id === `scholarship-${key}`,
      )
      expect(scholarship?.status).toBe(expectedStatus)
      expect(scholarship?.reviewAfter).toBe(expectedReviewAfter)
      expect(scholarship?.deadline).toBe('2026-10-31')
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
