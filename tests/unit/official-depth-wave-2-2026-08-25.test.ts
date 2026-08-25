import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-25'
const LOCALES = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const

const SISU_PROGRAM_IDS = [
  'program-shanghai-international-studies-university-international-relations-master',
  'program-shanghai-international-studies-university-translation-bachelor',
  'prog-gap-shisu-2026-bachelor-tcsol',
  'prog-gap-shisu-2026-master-icle',
  'program-sisu-iclt-one-semester-spring-2027',
] as const

const AHU_PROGRAM_IDS = [
  'program-anhui-university-international-economics-and-trade-bachelor',
  'program-anhui-university-computer-science-and-technology-bachelor',
] as const

const CQU_PROGRAM_IDS = [
  'program-chongqing-university-civil-engineering-bachelor',
  'program-chongqing-university-electrical-engineering-and-automation-bachelor',
  'program-chongqing-university-materials-engineering-bachelor',
] as const

const HISTORICAL_CYCLE_IDS = [
  'cycle-sisu-international-relations-autumn-2026-historical',
  'cycle-sisu-translation-autumn-2026-historical',
  'cycle-sisu-international-chinese-education-master-autumn-2026-historical',
  'cycle-cqu-civil-engineering-autumn-2026-historical',
  'cycle-cqu-electrical-engineering-and-automation-autumn-2026-historical',
  'cycle-cqu-materials-engineering-autumn-2026-historical',
] as const

const EXPIRED_SCHOLARSHIP_IDS = [
  'scholarship-sisu-shanghai-government-2026',
  'scholarship-anhui-university-csc-high-level-postgraduate-2026-2027',
  'scholarship-chongqing-university-president-2026',
  'scholarship-chongqing-mayor',
] as const

const dataDir = process.env.STUDYINCHINA_DATA_DIR
  ? path.resolve(process.env.STUDYINCHINA_DATA_DIR)
  : path.join(process.cwd(), 'content', 'data')
const read = (name: string): unknown => JSON.parse(
  fs.readFileSync(path.join(dataDir, name), 'utf8'),
)
const admissionCycles = read('admission-cycles.json')
const cities = read('cities.json')
const programs = read('programs.json')
const scholarships = read('scholarships.json')
const sources = read('sources.json')
const universities = read('universities.json')
const data = bundleSchema.parse({
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
})
const published = selectPublishedData(data, TODAY)
const sourceById = new Map(data.sources.map((source) => [source.id, source]))

function expectSixLanguages(
  value: Partial<Record<typeof LOCALES[number], string>>,
  label: string,
): void {
  for (const locale of LOCALES) {
    expect(value[locale]?.trim(), `${label}:${locale}`).toBeTruthy()
  }
}

function expectOfficialHttps(sourceIds: string[], label: string): void {
  expect(sourceIds.length, label).toBeGreaterThan(0)
  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId)
    expect(source, `${label}:${sourceId}`).toBeDefined()
    expect(source?.official, `${label}:${sourceId}`).toBe(true)
    expect(source?.accessedAt, `${label}:${sourceId}`).toBe(
      sourceId === 'src-clec-iclt-2026-standard' ? '2026-07-28' : TODAY,
    )
    expect(new URL(source?.url ?? 'http://invalid.local').protocol, `${label}:${sourceId}`).toBe('https:')
  }
}

describe('SISU, AHU and CQU official depth wave on 2026-08-25', () => {
  it('enriches ten existing program identities without changing their IDs or slugs', () => {
    const expectedDurations = new Map<string, number>([
      [SISU_PROGRAM_IDS[0], 24],
      [SISU_PROGRAM_IDS[1], 48],
      [SISU_PROGRAM_IDS[2], 48],
      [SISU_PROGRAM_IDS[3], 24],
      [SISU_PROGRAM_IDS[4], 5],
      ...AHU_PROGRAM_IDS.map((id) => [id, 48] as const),
      ...CQU_PROGRAM_IDS.map((id) => [id, 48] as const),
    ])

    expect(expectedDurations.size).toBe(10)
    for (const [id, duration] of expectedDurations) {
      const program = data.programs.find((item) => item.id === id)
      expect(program, id).toBeDefined()
      expect(program?.slug, id).toBe(program?.slug)
      expect(program?.status, id).toBe('verified')
      expect(program?.durationMonths, id).toBe(duration)
      expect(program?.verificationScope, id).toBe('facts')
      expectSixLanguages(program?.name ?? {}, id)
      expectOfficialHttps(program?.sourceIds ?? [], id)
      expect(published.programs.some((item) => item.id === id), id).toBe(true)
    }
  })

  it('keeps the SISU TCSOL campus conflict out of a synthetic cycle', () => {
    const program = data.programs.find((item) => item.id === SISU_PROGRAM_IDS[2])
    expect(program?.durationMonths).toBe(48)
    expect(program?.teachingLanguages).toEqual(['Chinese'])
    expect(program?.languageRequirements).toEqual([])
    expect(program?.applyUrl).toBeNull()
    expect(data.admissionCycles.filter((cycle) => cycle.programId === program?.id)).toEqual([])
  })

  it('withholds undated AHU fee, application-fee, HSK and unhealthy portal claims', () => {
    for (const id of AHU_PROGRAM_IDS) {
      const program = data.programs.find((item) => item.id === id)
      expect(program?.durationMonths, id).toBe(48)
      expect(program?.applyUrl, id).toBeNull()
      expect(program?.languageRequirements, id).toEqual([])
      expect(program?.sourceIds, id).toContain('source-ahu-undated-international-admission-reference')
      expect(data.admissionCycles.some((cycle) => cycle.programId === id), id).toBe(false)
    }
  })

  it('retains six closed 2026 rounds only as non-public historical references', () => {
    const expectedTuition = new Map<string, number>([
      [HISTORICAL_CYCLE_IDS[0], 26000],
      [HISTORICAL_CYCLE_IDS[1], 24800],
      [HISTORICAL_CYCLE_IDS[2], 26000],
      [HISTORICAL_CYCLE_IDS[3], 25000],
      [HISTORICAL_CYCLE_IDS[4], 25000],
      [HISTORICAL_CYCLE_IDS[5], 28000],
    ])

    for (const [id, tuition] of expectedTuition) {
      const cycle = data.admissionCycles.find((item) => item.id === id)
      expect(cycle, id).toBeDefined()
      expect(cycle?.status, id).toBe('stale')
      expect(cycle?.dateStatus, id).toBe('previous-cycle-reference')
      expect(cycle?.tuitionCny, id).toBe(tuition)
      expect(cycle?.tuitionStatus, id).toBe('confirmed')
      expect(cycle?.closesOn?.localeCompare(TODAY), id).toBeLessThan(0)
      expectOfficialHttps(cycle?.sourceIds ?? [], id)
      expect(published.admissionCycles.some((item) => item.id === id), id).toBe(false)
    }
  })

  it('keeps the SISU spring 2027 route upcoming with no invented opening date', () => {
    const program = data.programs.find(
      (item) => item.id === 'program-sisu-iclt-one-semester-spring-2027',
    )
    expect(program?.sourceIds).toEqual([
      'src-sisu-iclt-2026',
      'src-clec-iclt-2026-standard',
    ])

    const cycle = data.admissionCycles.find(
      (item) => item.id === 'cycle-sisu-iclt-one-semester-spring-2027',
    )
    expect(cycle?.status).toBe('verified')
    expect(cycle?.opensOn).toBeNull()
    expect(cycle?.closesOn).toBe('2026-10-31')
    expect(cycle?.tuitionCny).toBeNull()
    expect(cycle?.applicationFeeCny).toBeNull()
    expect(published.admissionCycles.some((item) => item.id === cycle?.id)).toBe(true)

    const scholarship = data.scholarships.find(
      (item) => item.id === 'scholarship-sisu-iclt-one-semester-spring-2027',
    )
    expect(scholarship?.coverage).toEqual({
      tuition: 'full',
      accommodation: 'partial',
      insurance: true,
      stipendCnyPerMonth: 2500,
    })
    expect(scholarship?.deadline).toBe('2026-10-31')
    expectSixLanguages(scholarship?.name ?? {}, scholarship?.id ?? 'missing-sisu-iclt')
    expect(published.scholarships.some((item) => item.id === scholarship?.id)).toBe(true)
  })

  it('stores expired scholarship facts without leaking them as current opportunities', () => {
    for (const id of EXPIRED_SCHOLARSHIP_IDS) {
      const scholarship = data.scholarships.find((item) => item.id === id)
      expect(scholarship, id).toBeDefined()
      expect(scholarship?.status, id).toBe('stale')
      expect(scholarship?.deadline?.localeCompare(TODAY), id).toBeLessThan(0)
      expectSixLanguages(scholarship?.name ?? {}, id)
      expectOfficialHttps(scholarship?.sourceIds ?? [], id)
      expect(published.scholarships.some((item) => item.id === id), id).toBe(false)
    }

    const sisuSgs = data.scholarships.find(
      (item) => item.id === 'scholarship-sisu-shanghai-government-2026',
    )
    expect(sisuSgs?.programIds).toEqual([
      SISU_PROGRAM_IDS[0],
      SISU_PROGRAM_IDS[1],
    ])

    const ahuCsc = data.scholarships.find(
      (item) => item.id === 'scholarship-anhui-university-csc-high-level-postgraduate-2026-2027',
    )
    expect(ahuCsc?.programIds).toEqual([])
    expect(ahuCsc?.coverage).toEqual({
      tuition: 'unknown',
      accommodation: 'unknown',
      insurance: 'unknown',
      stipendCnyPerMonth: null,
    })

    const cquPresident = data.scholarships.find(
      (item) => item.id === 'scholarship-chongqing-university-president-2026',
    )
    expect(cquPresident?.coverage.insurance).toBe('unknown')
    expect(cquPresident?.sourceIds).toContain('source-cqu-president-scholarship-insurance-conflict')

    const cquMayor = data.scholarships.find(
      (item) => item.id === 'scholarship-chongqing-mayor',
    )
    expect(cquMayor?.universityIds).toEqual(['uni-chongqing-university'])
  })

  it('publishes the CQU March 2027 deadline without claiming the route is open', () => {
    const scholarship = data.scholarships.find(
      (item) => item.id === 'scholarship-cqu-iclt-2026',
    )
    expect(scholarship?.status).toBe('verified')
    expect(scholarship?.deadline).toBe('2026-10-31')
    expect(scholarship?.applicationUrl).toBeNull()
    expect(scholarship?.programIds).toEqual([])
    expect(scholarship?.coverage.stipendCnyPerMonth).toBeNull()
    expect(scholarship?.summary?.en).toContain('no opening date')
    expectSixLanguages(scholarship?.name ?? {}, scholarship?.id ?? 'missing-cqu-iclt')
    expectOfficialHttps(scholarship?.sourceIds ?? [], scholarship?.id ?? 'missing-cqu-iclt')
    expect(published.scholarships.some((item) => item.id === scholarship?.id)).toBe(true)
  })
})
