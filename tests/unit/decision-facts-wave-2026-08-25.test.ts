import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { getApplicationState } from '../../src/lib/data/admission'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-25'
const LOCALES = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const
const data = bundleSchema.parse({ admissionCycles, cities, programs, scholarships, sources, universities })
const sourceById = new Map(data.sources.map((source) => [source.id, source]))

const ZJU_PROGRAMS = [
  ['program-zhejiang-university-clinical-medicine-mbbs-bachelor', 72, 42800, 'academic-year'],
  ['program-zhejiang-university-biomedical-engineering-bachelor', 48, 42800, 'academic-year'],
  ['program-zhejiang-university-china-studies-mcs-master', 24, 66000, 'academic-year'],
  ['program-zhejiang-university-business-administration-master', 24, 218000, 'program'],
  ['program-zhejiang-university-finance-imf-master', 24, 180000, 'program'],
  ['program-zhejiang-university-data-science-imds-master', 36, 50000, 'academic-year'],
] as const

const HDU_PROGRAMS = [
  'prog-gap-prog-hdu-artificial-intelligence-bachelor-2026',
  'prog-gap-prog-hdu-business-management-bachelor-2026',
  'prog-gap-prog-hdu-computer-science-bachelor-2026',
  'prog-gap-prog-hdu-digital-economy-bachelor-2026',
  'prog-gap-prog-hdu-mechanical-bachelor-2026',
  'program-hangzhou-dianzi-university-software-engineering-bachelor',
  'program-hangzhou-dianzi-university-mechanical-engineering-master',
  'program-hangzhou-dianzi-university-international-chinese-language-education-master',
  'program-hangzhou-dianzi-university-chinese-language-program-language',
] as const

function expectSixLanguages(name: Partial<Record<typeof LOCALES[number], string>>, label: string) {
  for (const locale of LOCALES) expect(name[locale]?.trim(), `${label}:${locale}`).toBeTruthy()
}

function expectCurrentOfficialEvidence(sourceIds: string[], label: string) {
  expect(sourceIds.length, label).toBeGreaterThan(0)
  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId)
    expect(source, `${label}:${sourceId}`).toBeDefined()
    expect(source?.official, `${label}:${sourceId}`).toBe(true)
    expect(source?.accessedAt, `${label}:${sourceId}`).toBe(TODAY)
  }
}

describe('decision-fact depth wave on 2026-08-25', () => {
  it('publishes six grounded ZJU identities and closed 2026 fee cycles', () => {
    for (const [programId, duration, tuition, period] of ZJU_PROGRAMS) {
      const program = data.programs.find((item) => item.id === programId)
      const cycle = data.admissionCycles.find((item) => item.programId === programId && item.academicYear === '2026-2027')
      expect(program?.status, programId).toBe('verified')
      expect(program?.durationMonths, programId).toBe(duration)
      expect(program?.teachingLanguages, programId).toContain('English')
      expect(program?.applyUrl, programId).toBe('https://intlstudent.zju.edu.cn/')
      expectSixLanguages(program?.name ?? {}, programId)
      expectCurrentOfficialEvidence(program?.sourceIds ?? [], programId)

      expect(cycle, programId).toMatchObject({
        status: 'verified',
        closesOn: '2026-05-31',
        dateStatus: 'published',
        tuitionCny: tuition,
        tuitionPeriod: period,
        tuitionStatus: 'confirmed',
        applicationFeeCny: 800,
      })
      expect(getApplicationState(cycle, TODAY), programId).toBe('closed')
      expectCurrentOfficialEvidence(cycle?.sourceIds ?? [], `${programId}:cycle`)
    }

    expect(data.admissionCycles.some((item) => item.id === 'cycle-2027-zhejiang-university-business-administration-master')).toBe(false)
    const hai = data.scholarships.find((item) => item.id === 'scholarship-zju-zibs-hai-2026')
    expect(hai?.deadline).toBe('2026-05-31')
    expect(hai?.programIds).toEqual(ZJU_PROGRAMS.slice(2).map(([id]) => id))
    expect(hai?.coverage.tuition).toBe('unknown')
  })

  it('turns the HUTB fee references into verified closed cycles without misclassifying registration fees', () => {
    const expected = new Map([
      ['prog-gap-wave8-2-hutb-international-business-master', 24000],
      ['prog-gap-wave8-2-hutb-chinese-language', 11000],
    ])
    for (const [programId, tuition] of expected) {
      const program = data.programs.find((item) => item.id === programId)
      const cycle = data.admissionCycles.find((item) => item.programId === programId && item.academicYear === '2026-2027')
      expectSixLanguages(program?.name ?? {}, programId)
      expect(cycle).toMatchObject({
        status: 'verified', closesOn: '2026-06-30', dateStatus: 'published',
        tuitionCny: tuition, tuitionStatus: 'confirmed', applicationFeeCny: null,
      })
      expect(cycle?.notes?.en).toContain('registration fee, not an application fee')
      expect(getApplicationState(cycle, TODAY), programId).toBe('closed')
    }

    const internationalBusiness = data.programs.find((item) => item.id === 'prog-gap-wave8-2-hutb-international-business-master')
    expect(internationalBusiness?.languageRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ test: 'IELTS', minimum: '5.5' }),
      expect.objectContaining({ test: 'TOEFL', minimum: '50' }),
    ]))
    const inclusive = data.scholarships.find((item) => item.id === 'scholarship-hutb-international-students-inclusive')
    expect(inclusive?.programIds).toHaveLength(2)
    expect(inclusive?.coverage.tuition).toBe('partial')
    expect(inclusive?.deadline).toBeNull()
  })

  it('completes the HDU nine-program pack while keeping unknown graduate and language durations null', () => {
    expect(new Set(HDU_PROGRAMS).size).toBe(9)
    for (const programId of HDU_PROGRAMS) {
      const program = data.programs.find((item) => item.id === programId)
      const cycle = data.admissionCycles.find((item) => item.programId === programId && item.academicYear === '2026-2027')
      expect(program?.status, programId).toBe('verified')
      expect(program?.applyUrl, programId).toBe('https://lxsgl.hdu.edu.cn/')
      expectSixLanguages(program?.name ?? {}, programId)
      expect(cycle).toMatchObject({
        status: 'verified', closesOn: '2026-06-15', dateStatus: 'published',
        tuitionStatus: 'confirmed', applicationFeeCny: null,
      })
      expect(cycle?.notes?.en).toContain('registration charge is not an application fee')
      expect(getApplicationState(cycle, TODAY), programId).toBe('closed')
    }

    for (const programId of HDU_PROGRAMS.slice(0, 6)) {
      expect(data.programs.find((item) => item.id === programId)?.durationMonths, programId).toBe(48)
    }
    for (const programId of HDU_PROGRAMS.slice(6)) {
      expect(data.programs.find((item) => item.id === programId)?.durationMonths, programId).toBeNull()
    }
    const sonis = data.scholarships.find((item) => item.id === 'sch-gap-wave8-hdu-sonis-scholarship-2026')
    expect(sonis?.programIds).toHaveLength(8)
    expect(sonis?.programIds).not.toContain('program-hangzhou-dianzi-university-chinese-language-program-language')
    expect(sonis?.coverage).toMatchObject({ tuition: 'full', accommodation: 'partial' })
    expect(sonis?.deadline).toBeNull()
  })

  it('represents GZHU tuition as a range note and preserves the email-only application route', () => {
    const programId = 'program-guangzhou-university-public-administration-smart-governance-bachelor'
    const program = data.programs.find((item) => item.id === programId)
    const cycle = data.admissionCycles.find((item) => item.programId === programId)
    expect(program).toMatchObject({
      durationMonths: 48, durationMonthsMax: 84, teachingLanguages: ['Chinese'], applyUrl: null,
    })
    expect(program?.languageRequirements).toContainEqual({ test: 'HSK', minimum: 'Level 4 or higher; some Chinese-taught disciplines may require Level 5' })
    expectSixLanguages(program?.name ?? {}, programId)
    expect(cycle).toMatchObject({
      status: 'verified', closesOn: '2026-04-30', tuitionCny: null,
      tuitionPeriod: null, tuitionStatus: null, applicationFeeCny: 0,
    })
    expect(cycle?.notes?.en).toContain('18,000–20,000')
    expect(getApplicationState(cycle, TODAY)).toBe('closed')

    const scholarship = data.scholarships.find((item) => item.id === 'sch-gap-wave6-gzhu-international-student-scholarship-2026')
    expect(scholarship).toMatchObject({ deadline: '2026-04-30', coverage: { tuition: 'partial', insurance: 'unknown', stipendCnyPerMonth: 1000 } })
    expect(scholarship?.programIds).toEqual([programId])
  })
})
