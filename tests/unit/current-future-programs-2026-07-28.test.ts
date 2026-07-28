import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { selectPublishedData } from '@/lib/data/publication'
import { bundleSchema } from '@/lib/data/schema'

const data = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})

const expandedProgramIds = [
  'program-xmu-long-term-chinese-language-spring-2027',
  'program-dhu-winter-chinese-2027',
  'program-bfsu-general-chinese-training-spring-2027',
  'program-uibe-international-foundation-spring-2027',
  'program-xju-iclt-one-semester-spring-2027',
  'program-snnu-iclt-one-semester-spring-2027',
  'program-blcu-iclt-one-semester-spring-2027',
  'program-dhu-iclt-one-semester-spring-2027',
  'program-shu-iclt-one-semester-spring-2027',
  'program-tianjin-university-one-semester-chinese-language-study-spring-language',
  'program-nankai-iclt-one-semester-spring-2027',
  'program-bfsu-iclt-one-semester-spring-2027',
] as const

describe('current future program expansion on 2026-07-28', () => {
  it('publishes all twelve grounded future program identities', () => {
    const published = selectPublishedData(data, '2026-07-28')
    const publishedIds = new Set(published.programs.map((item) => item.id))

    for (const id of expandedProgramIds) {
      const program = data.programs.find((item) => item.id === id)
      expect(program, id).toBeDefined()
      expect(publishedIds.has(id), id).toBe(true)
      expect(
        data.sources.some(
          (source) => source.official
            && source.kind === 'program'
            && source.url === program?.programUrl
            && program.sourceIds.includes(source.id),
        ),
        id,
      ).toBe(true)
      expect(program?.name.en).toBeTruthy()
      expect(program?.name.zh).toBeTruthy()
      expect(program?.name.ru).toBeTruthy()
    }
  })

  it('publishes three newly represented universities and Urumqi map data', () => {
    const expected = new Map([
      ['uni-xinjiang-university', 'city-urumqi'],
      ['uni-shaanxi-normal-university', 'city-xian'],
      ['uni-beijing-language-university', 'city-beijing'],
    ])

    for (const [id, cityId] of expected) {
      const university = data.universities.find((item) => item.id === id)
      expect(university?.cityId).toBe(cityId)
      expect(university?.name.en).toBeTruthy()
      expect(university?.name.zh).toBeTruthy()
      expect(university?.name.ru).toBeTruthy()
    }

    const urumqi = data.cities.find((item) => item.id === 'city-urumqi')
    expect(urumqi?.coordinates).toEqual({ lat: 43.8256, lng: 87.6168 })
    expect(urumqi?.region).toBe('northwest')
  })

  it('keeps exact fees and future deadlines for paid language programs', () => {
    const xmu = data.admissionCycles.find(
      (item) => item.id === 'cycle-xmu-long-term-chinese-language-spring-2027',
    )
    expect(xmu).toMatchObject({
      closesOn: '2026-12-30',
      tuitionCny: 13000,
      tuitionPeriod: 'semester',
      applicationFeeCny: 400,
      evidenceBasis: 'cycle-specific',
    })

    const dhu = data.admissionCycles.find(
      (item) => item.id === 'cycle-dhu-winter-chinese-2027',
    )
    expect(dhu).toMatchObject({
      opensOn: '2026-07-10',
      closesOn: '2026-11-30',
      tuitionCny: 3600,
      tuitionPeriod: 'program',
      applicationFeeCny: 600,
      evidenceBasis: 'cycle-specific',
    })
  })

  it('labels annual-rule dates as recurring evidence instead of cycle-specific claims', () => {
    const bfsu = data.admissionCycles.find(
      (item) => item.id === 'cycle-bfsu-general-chinese-training-spring-2027',
    )
    expect(bfsu).toMatchObject({
      closesOn: '2026-12-15',
      tuitionCny: 12000,
      applicationFeeCny: 800,
      evidenceBasis: 'recurring-official-rule',
    })
    expect(bfsu?.notes?.en).toContain('each year')

    const uibe = data.admissionCycles.find(
      (item) => item.id === 'cycle-uibe-international-foundation-spring-2027',
    )
    expect(uibe).toMatchObject({
      opensOn: '2026-10-01',
      closesOn: '2026-12-31',
      tuitionCny: 15600,
      applicationFeeCny: 660,
      evidenceBasis: 'recurring-official-rule',
    })
    expect(uibe?.notes?.en).toContain('may close earlier')
  })

  it('models directions inside one ICLT program per university', () => {
    const cases = [
      ['uni-xinjiang-university', 'Chinese Philosophy'],
      ['uni-shaanxi-normal-university', 'Chinese Philosophy'],
      ['uni-beijing-language-university', 'Chinese Language and Literature'],
      ['uni-shanghai-university', 'Traditional Chinese Medicine'],
      ['uni-tianjin-university', 'Taiji Culture'],
      ['uni-nankai-university', 'Chinese History'],
    ] as const

    for (const [universityId, expectedDirection] of cases) {
      const items = data.programs.filter(
        (item) => item.universityId === universityId
          && item.name.en?.startsWith('International Chinese Language Teachers Scholarship'),
      )
      expect(items).toHaveLength(1)
      const cycle = data.admissionCycles.find((item) => item.programId === items[0].id)
      expect(cycle?.notes?.en).toContain(expectedDirection)
    }
  })

  it('publishes nine school-specific future scholarships without treating coverage as list-price tuition', () => {
    const octoberScholarshipIds = new Set([
      'scholarship-xmu-iclt-one-semester-spring-2027',
      'scholarship-xju-iclt-one-semester-spring-2027',
      'scholarship-snnu-iclt-one-semester-spring-2027',
      'scholarship-blcu-iclt-one-semester-spring-2027',
      'scholarship-dhu-iclt-one-semester-spring-2027',
      'scholarship-shu-iclt-one-semester-spring-2027',
      'scholarship-tianjin-university-one-semester-chinese-language-study-spring-language',
      'scholarship-nankai-iclt-one-semester-spring-2027',
    ])
    const futureScholarships = data.scholarships.filter(
      (item) => octoberScholarshipIds.has(item.id),
    )
    expect(futureScholarships).toHaveLength(octoberScholarshipIds.size)

    const bfsu = data.scholarships.find(
      (item) => item.id === 'scholarship-bfsu-iclt-one-semester-spring-2027',
    )
    expect(bfsu?.deadline).toBe('2026-12-30')

    for (const item of [...futureScholarships, bfsu!]) {
      expect(item.coverage).toEqual({
        tuition: 'full',
        accommodation: 'full',
        insurance: true,
        stipendCnyPerMonth: 2500,
      })
      const cycle = data.admissionCycles.find(
        (candidate) => candidate.programId === item.programIds[0],
      )
      if (item.id === 'scholarship-xmu-iclt-one-semester-spring-2027') {
        expect(cycle?.tuitionCny).toBe(13000)
      } else {
        expect(cycle?.tuitionCny).toBeNull()
      }
    }
  })

  it('preserves the existing Tianjin cycle identity while enriching its facts', () => {
    const cycles = data.admissionCycles.filter(
      (item) => item.programId
        === 'program-tianjin-university-one-semester-chinese-language-study-spring-language',
    )
    expect(cycles).toHaveLength(1)
    expect(cycles[0].id).toBe('cycle-2026-de698abe4893')
    expect(cycles[0].opensOn).toBe('2026-03-01')
    expect(cycles[0].closesOn).toBe('2026-10-31')
  })

  it('uses the harvest manifest count instead of a fixed R2 object total', () => {
    const workflow = readFileSync(
      resolve('.github/workflows/official-catalog-harvest.yml'),
      'utf8',
    )
    expect(workflow).toContain('expected_upload_count')
    expect(workflow).toContain('from the manifest')
    expect(workflow).not.toContain('-ne 64')
    expect(workflow).not.toContain('exactly 64 verified')
  })
})
