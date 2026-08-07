import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import northWest from '../../quality/official-gap-wave-2026-07-30/wave3-north-west.json'
import { getApplicationState } from '../../src/lib/data/admission'
import { isWithinPostDeadlineGrace } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import type { DataBundle } from '../../src/lib/data/types'

const TODAY = '2026-07-31'

const data = {
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
} as unknown as DataBundle
const wavePrograms = data.programs.filter((item) =>
  item.id.startsWith('prog-gap-wave3-'))
const waveScholarships = data.scholarships.filter((item) =>
  item.id.startsWith('sch-gap-wave3-'))
const waveSources = data.sources.filter((item) => item.id.includes('wave3'))

function isTrilingual(value: Partial<Record<'en' | 'zh' | 'ru', string>> | null | undefined): boolean {
  return (['en', 'zh', 'ru'] as const).every((locale) =>
    Boolean(value?.[locale]?.trim()))
}

function normalizedName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '')
}

describe('official coverage wave 3 on 2026-07-31', () => {
  it('keeps the expected formal breadth and source-backed language coverage', () => {
    expect(wavePrograms).toHaveLength(70)
    expect(waveScholarships).toHaveLength(40)
    expect(waveSources).toHaveLength(172)
    expect(wavePrograms.every((item) => isTrilingual(item.name))).toBe(true)
    expect(waveScholarships.every((item) =>
      isTrilingual(item.name) && isTrilingual(item.summary))).toBe(true)

    for (const source of waveSources) {
      const hostname = new URL(source.url).hostname
      expect(
        hostname.endsWith('.edu.cn') || hostname === 'www.chinadaily.com.cn',
      ).toBe(true)
      expect(source.official).toBe(true)
      if (hostname === 'www.chinadaily.com.cn') {
        expect(source.title).toContain('official-portal-linked PDF')
      }
    }
  })

  it('reuses the formal XISU entity and preserves route-specific bindings', () => {
    expect(northWest.universities.some((item) =>
      item.slug === 'xian-international-studies-university')).toBe(false)

    const custAward = waveScholarships.find((item) =>
      item.id === 'sch-gap-wave3-sch-cust-software-engineering-partial')
    expect(custAward?.programIds).toEqual([
      'prog-gap-wave3-cust-b-software-engineering-en',
    ])

    const programById = new Map(data.programs.map((item) => [item.id, item]))
    for (const scholarship of waveScholarships) {
      for (const programId of scholarship.programIds) {
        expect(programById.get(programId)?.universityId)
          .toBe(scholarship.universityIds[0])
      }
    }
  })

  it('keeps program and scholarship semantic identities unique', () => {
    const programKeys = wavePrograms.map((item) => [
      item.universityId,
      item.degreeLevel,
      normalizedName(item.name.en ?? item.name.zh),
    ].join('|'))
    const scholarshipKeys = waveScholarships.map((item) => [
      [...item.universityIds].sort().join(','),
      normalizedName(item.name.en ?? item.name.zh),
    ].join('|'))

    expect(new Set(programKeys).size).toBe(programKeys.length)
    expect(new Set(scholarshipKeys).size).toBe(scholarshipKeys.length)
  })

  it('publishes only safe current, grace-period, or date-free wave-3 cycles', () => {
    const programIds = new Set(wavePrograms.map((item) => item.id))
    const published = selectPublishedData(data, TODAY)
    const rawCycles = data.admissionCycles.filter((cycle) =>
      programIds.has(cycle.programId))
    const cycles = published.admissionCycles.filter((cycle) =>
      programIds.has(cycle.programId))

    expect(rawCycles.length).toBeGreaterThan(0)
    expect(cycles.filter((cycle) =>
      cycle.status !== 'verified' || cycle.reviewAfter < TODAY)).toEqual([])
    expect(cycles.filter((cycle) =>
      cycle.closesOn !== null
      && !isWithinPostDeadlineGrace(cycle.closesOn, TODAY))).toEqual([])

    const datedCycles = cycles.filter((cycle) =>
      cycle.opensOn !== null || cycle.closesOn !== null)
    const datedClosedCycles = datedCycles.filter((cycle) =>
      getApplicationState(cycle, TODAY) === 'closed')
    for (const cycle of datedClosedCycles) {
      expect(cycle.closesOn).not.toBeNull()
      expect(isWithinPostDeadlineGrace(cycle.closesOn, TODAY)).toBe(true)
      expect(['open', 'rolling']).not.toContain(
        getApplicationState(cycle, TODAY),
      )
    }

    const dateFreeCycles = cycles.filter((cycle) =>
      cycle.opensOn === null && cycle.closesOn === null)
    for (const cycle of dateFreeCycles) {
      if (cycle.id.includes('fee-reference')) {
        expect(cycle.dateStatus).toBe('not-announced')
        expect(cycle.tuitionCny).not.toBeNull()
        expect(cycle.tuitionStatus).toBe('reference')
        continue
      }
      expect(cycle.dateStatus).toBe('not-announced')
      expect(cycle.factScope).toBe('dates-only')
      expect(cycle.tuitionCny).toBeNull()
      expect(cycle.applicationFeeCny).toBeNull()
    }
  })

  it('deepens the four existing universities in the production selector', () => {
    const published = selectPublishedData(data, TODAY)
    const expected = new Map([
      ['northeast-normal-university', 6],
      ['yunnan-university', 5],
      ['china-university-of-geosciences-beijing', 5],
      ['sichuan-agricultural-university', 4],
    ])

    for (const [slug, count] of expected) {
      const university = published.universities.find((item) => item.slug === slug)
      expect(published.programs.filter((item) =>
        item.universityId === university?.id).length).toBeGreaterThanOrEqual(count)
    }
  })

  it('keeps YNU primary evidence on its university domain', () => {
    const sourceById = new Map(data.sources.map((item) => [item.id, item]))
    const yunnan = data.universities.find((item) => item.slug === 'yunnan-university')
    const yunnanPrograms = wavePrograms.filter((item) =>
      item.universityId === yunnan?.id)

    for (const program of yunnanPrograms) {
      expect(new URL(program.programUrl).hostname).toBe('english.ynu.edu.cn')
      const evidence = program.sourceIds.map((id) => sourceById.get(id))
      expect(evidence.some((source) =>
        source && new URL(source.url).hostname === 'english.ynu.edu.cn')).toBe(true)
    }
  })
})
