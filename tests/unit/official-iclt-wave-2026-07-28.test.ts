import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

type JsonRecord = Record<string, unknown>

function load(fileName: string): JsonRecord[] {
  return JSON.parse(
    readFileSync(resolve('content/data', fileName), 'utf8'),
  ) as JsonRecord[]
}

const expectedProgramIds = [
  'program-hznu-iclt-one-semester-spring-2027',
  'program-sjtu-iclt-one-semester-spring-2027',
  'program-hunnu-iclt-one-semester-spring-2027',
  'program-imnu-chinese-tourism-management-spring-2027',
]

describe('official ICLT wave 2026-07-28', () => {
  const sources = load('sources.json')
  const universities = load('universities.json')
  const programs = load('programs.json')
  const cycles = load('admission-cycles.json')
  const scholarships = load('scholarships.json')

  it('adds two regionally useful universities with complete public translations', () => {
    const ids = new Set(universities.map((item) => item.id))
    expect(ids).toContain('uni-hangzhou-normal-university')
    expect(ids).toContain('uni-inner-mongolia-normal-university')

    for (const id of [
      'uni-hangzhou-normal-university',
      'uni-inner-mongolia-normal-university',
    ]) {
      const university = universities.find((item) => item.id === id)
      expect(university?.status).toBe('verified')
      const name = university?.name as JsonRecord
      expect(name.en).toBeTruthy()
      expect(name.zh).toBeTruthy()
      expect(name.ru).toBeTruthy()
    }
  })

  it('publishes four distinct Spring 2027 program identities and cycles', () => {
    for (const id of expectedProgramIds) {
      const program = programs.find((item) => item.id === id)
      expect(program?.status).toBe('verified')
      expect(program?.durationMonths).toBe(5)
      expect(program?.verificationScope).toBe('facts')
      expect(program?.programUrl).toMatch(/^https:\/\//u)

      const cycle = cycles.find((item) => item.programId === id)
      expect(cycle?.status).toBe('verified')
      expect(cycle?.intake).toBe('spring')
      expect(cycle?.closesOn).toBe('2026-10-31')
      expect(cycle?.evidenceBasis).toBe('cycle-specific')
    }
  })

  it('keeps every current opportunity tied to school and central official evidence', () => {
    const sourceIds = new Set(sources.map((item) => item.id))
    for (const id of expectedProgramIds) {
      const program = programs.find((item) => item.id === id)
      const refs = program?.sourceIds as string[]
      expect(refs).toContain('src-clec-iclt-2026-standard')
      expect(refs.length).toBeGreaterThanOrEqual(2)
      refs.forEach((sourceId) => expect(sourceIds).toContain(sourceId))
    }
  })

  it('adds matching school-specific scholarships without inventing tuition prices', () => {
    for (const programId of expectedProgramIds) {
      const scholarship = scholarships.find((item) => (
        Array.isArray(item.programIds)
        && (item.programIds as string[]).includes(programId)
      ))
      expect(scholarship?.status).toBe('verified')
      expect(scholarship?.deadline).toBe('2026-10-31')
      expect((scholarship?.coverage as JsonRecord).tuition).toBe('full')

      const cycle = cycles.find((item) => item.programId === programId)
      expect(cycle?.tuitionCny).toBeNull()
      expect(cycle?.tuitionStatus).toBeNull()
    }
  })

  it('represents the BFSU annual and award-tier rules without a fabricated date or tier', () => {
    const scholarship = scholarships.find(
      (item) => item.id === 'scholarship-bfsu-beijing-government-annual',
    )
    expect(scholarship?.status).toBe('verified')
    expect(scholarship?.deadline).toBeNull()
    expect((scholarship?.coverage as JsonRecord).tuition).toBe('unknown')
    expect((scholarship?.summary as JsonRecord).en).toContain('November 30')
    expect((scholarship?.summary as JsonRecord).en).toContain('no single tier')
  })

  it('does not introduce duplicate ids or slugs', () => {
    for (const collection of [sources, universities, programs, cycles, scholarships]) {
      const ids = collection.map((item) => String(item.id))
      expect(new Set(ids).size).toBe(ids.length)
    }

    for (const collection of [universities, programs, scholarships]) {
      const slugs = collection.map((item) => String(item.slug))
      expect(new Set(slugs).size).toBe(slugs.length)
    }
  })
})
