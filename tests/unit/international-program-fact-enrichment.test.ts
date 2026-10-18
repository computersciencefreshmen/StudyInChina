import { describe, expect, it } from 'vitest'

import {
  extractGroundedFacts,
  stageFactCandidates,
} from '../../scripts/ingestion/enrich-international-program-facts'
import { isCurrentVerifiedRecord } from '../../src/lib/data/freshness'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle, Program } from '../../src/lib/data/types'

const record = {
  institutionId: 'uni-example',
  programNameOriginal: '计算机科学与技术',
  programNameEn: 'Computer Science and Technology',
  degreeLevel: 'bachelor',
  programType: 'degree',
  intake: 'Autumn 2027',
  applicationOpen: null,
  deadline: null,
  officialUrl: 'https://example.edu.cn/program',
  checkedAt: '2026-07-27',
}

const CHECKED_AT = '2026-10-17'

function catalogueFixture(status: Program['status'] = 'stale'): DataBundle {
  const audit = {
    sourceIds: ['official'], verifiedAt: '2026-06-01', reviewAfter: '2026-06-30',
    status: 'verified' as const,
  }
  return bundleSchema.parse({
    sources: [{ id: 'official', url: record.officialUrl, title: 'Official program',
      publisher: 'Example University', kind: 'program', language: 'en', official: true,
      accessedAt: '2026-06-01' }],
    cities: [{ ...audit, id: 'city-example', slug: 'example', name: { en: 'City' },
      province: null, region: null, coordinates: null, overview: null, climate: null,
      foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: record.institutionId, slug: 'example',
      name: { en: 'Example University' }, cityId: 'city-example', region: null,
      officialUrl: 'https://example.edu.cn', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, status, id: 'program-example', slug: 'computer-science',
      universityId: record.institutionId, name: { en: record.programNameEn },
      degreeLevel: 'bachelor', discipline: 'engineering', teachingLanguages: ['English'],
      durationMonths: 36, programUrl: record.officialUrl,
      applyUrl: 'https://example.edu.cn/apply',
      languageRequirements: [{ test: 'IELTS', minimum: '6.5' }], verificationScope: 'facts' }],
    admissionCycles: [{ ...audit, status: 'stale', id: 'cycle-old',
      programId: 'program-example', academicYear: '2026-2027', intake: 'autumn',
      opensOn: '2026-01-01', closesOn: '2026-04-30', dateStatus: 'published',
      tuitionCny: 20_000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed',
      applicationFeeCny: 400, evidenceBasis: 'cycle-specific', factScope: 'complete' }],
    scholarships: [],
  })
}

function stage(bundle: DataBundle, text: string, identityConfirmed = true) {
  return stageFactCandidates(bundle, [{
    record, program: bundle.programs[0]!,
    facts: extractGroundedFacts(text, record), identityConfirmed,
  }], CHECKED_AT)
}

describe('international program fact enrichment', () => {
  it('extracts grounded duration, tuition, fee, and deadline facts', () => {
    const facts = extractGroundedFacts(`
      Computer Science and Technology
      Program duration: 4 years.
      Tuition fee: CNY 30,000 per academic year.
      Application fee: RMB 600.
      Application deadline: June 30, 2027.
    `, record)

    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'durationMonths', value: 48 }),
      expect.objectContaining({ field: 'tuitionCny', value: 30_000 }),
      expect.objectContaining({ field: 'tuitionPeriod', value: 'academic-year' }),
      expect.objectContaining({ field: 'applicationFeeCny', value: 600 }),
      expect.objectContaining({ field: 'closesOn', value: '2027-06-30' }),
    ]))
  })

  it('rejects conflicting amounts and unrelated shared-page facts', () => {
    const conflicting = extractGroundedFacts(`
      Computer Science and Technology
      Tuition fee: CNY 30,000 per year.
      Tuition fee: CNY 40,000 per year.
    `, record)
    expect(conflicting.some((fact) => fact.field === 'tuitionCny')).toBe(false)

    const unrelated = extractGroundedFacts(
      'Another program. Tuition fee: CNY 20,000 per year.',
      record,
      3,
    )
    expect(unrelated).toHaveLength(0)
  })

  it('supports Chinese duration, tuition, and date evidence', () => {
    const facts = extractGroundedFacts(`
      计算机科学与技术
      学制：4年
      学费：30000元/学年
      申请费：600元
      申请截止日期：2027年6月30日
    `, record)
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'durationMonths', value: 48 }),
      expect.objectContaining({ field: 'tuitionCny', value: 30_000 }),
      expect.objectContaining({ field: 'applicationFeeCny', value: 600 }),
      expect.objectContaining({ field: 'closesOn', value: '2027-06-30' }),
    ]))
  })
  it('separates application ranges and treats 即日起至 as a deadline', () => {
    const rangeFacts = extractGroundedFacts(`
      Computer Science and Technology
      Application period: November 1, 2026 to June 15, 2027.
    `, record)
    expect(rangeFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'opensOn', value: '2026-11-01' }),
      expect.objectContaining({ field: 'closesOn', value: '2027-06-15' }),
    ]))

    const deadlineFacts = extractGroundedFacts(`
      计算机科学与技术
      申请时间：即日起至2027年6月30日
    `, record)
    expect(deadlineFacts).toContainEqual(expect.objectContaining({
      field: 'closesOn',
      value: '2027-06-30',
    }))
    expect(deadlineFacts.some((fact) => fact.field === 'opensOn')).toBe(false)
  })

  it.each(['stale', 'draft', 'archived', 'verified'] as const)(
    'never renews a %s program or its old cycle from a name-only match',
    (status) => {
      const bundle = catalogueFixture(status)
      const before = structuredClone(bundle)
      const result = stage(bundle, record.programNameEn)

      expect(result.bundle).toEqual(before)
      expect(bundle).toEqual(before)
      expect(isCurrentVerifiedRecord(result.bundle.programs[0]!, CHECKED_AT)).toBe(false)
      expect(result.proposals[0]).toMatchObject({
        status: 'draft', publicationEligible: false, identityConfirmed: true, facts: [],
      })
      expect(result.proposals[0]).not.toHaveProperty('verifiedAt')
      expect(result.proposals[0]).not.toHaveProperty('reviewAfter')
    },
  )

  it('stages duration-only evidence without renewing language, fees or other claims', () => {
    const bundle = catalogueFixture('verified')
    const before = structuredClone(bundle)
    const result = stage(bundle, `${record.programNameEn}. Program duration: 4 years.`)

    expect(result.bundle).toEqual(before)
    expect(result.bundle.programs[0]).toMatchObject({
      durationMonths: 36, teachingLanguages: ['English'],
      verifiedAt: '2026-06-01', reviewAfter: '2026-06-30',
    })
    expect(result.proposals[0]!.facts).toEqual([
      expect.objectContaining({ field: 'durationMonths', value: 48 }),
    ])
    expect(result.proposals[0]!.status).toBe('draft')
  })

  it('keeps an old cycle and its fees unchanged when a different intake has new dates', () => {
    const bundle = catalogueFixture()
    const before = structuredClone(bundle)
    const result = stage(bundle, `${record.programNameEn}.
      Application period: November 1, 2026 to June 15, 2027.`)

    expect(result.bundle).toEqual(before)
    expect(result.bundle.admissionCycles[0]).toMatchObject({
      academicYear: '2026-2027', closesOn: '2026-04-30', tuitionCny: 20_000,
      applicationFeeCny: 400, status: 'stale', verifiedAt: '2026-06-01',
    })
    expect(result.proposals[0]!.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'closesOn', value: '2027-06-15' }),
    ]))
    expect(result.proposals[0]!.facts.some(fact => (
      fact.field === 'tuitionCny' || fact.field === 'applicationFeeCny'
    ))).toBe(false)
    expect(result.proposals[0]).not.toHaveProperty('academicYear')
  })

  it('does not copy review-queue dates or create a verified cycle from fee-only evidence', () => {
    const bundle = catalogueFixture()
    bundle.admissionCycles = []
    const queued = { ...record, applicationOpen: '2026-11-01', deadline: '2027-06-15' }
    const result = stageFactCandidates(bundle, [{ record: queued, program: bundle.programs[0]!,
      facts: extractGroundedFacts('Application fee: RMB 600.', queued),
      identityConfirmed: false }], CHECKED_AT)

    expect(result.bundle.admissionCycles).toEqual([])
    expect(result.proposals[0]!.facts).toEqual([
      expect.objectContaining({ field: 'applicationFeeCny', value: 600 }),
    ])
    expect(result.proposals[0]).not.toHaveProperty('opensOn')
    expect(result.proposals[0]).not.toHaveProperty('closesOn')
    expect(result.proposals[0]).not.toHaveProperty('academicYear')
  })

  it('retains an expired deadline only as a historical draft and never advances its year', () => {
    const bundle = catalogueFixture()
    const before = structuredClone(bundle)
    const result = stage(bundle, `${record.programNameEn}.
      Application deadline: July 31, 2026. Tuition fee: CNY 30,000 per year.`)

    expect(result.bundle).toEqual(before)
    expect(result.proposals[0]).toMatchObject({ status: 'draft', publicationEligible: false })
    expect(result.proposals[0]!.facts).toContainEqual(expect.objectContaining({
      field: 'closesOn', value: '2026-07-31',
    }))
    expect(result.proposals[0]!.issues).toContainEqual(expect.stringMatching(/Expired deadline/))
    expect(result.proposals[0]!.facts.some(fact => fact.value === '2027-07-31')).toBe(false)
  })

  it.each([
    'Application deadline: 2027-02-30.',
    'Application deadline: 2027-13-01.',
    '申请截止日期：2027年2月29日',
    'Application deadline: April 31, 2027.',
    'Application period: June 30, 2027 to June 1, 2027.',
    'Application period: 2027-11-01 to 2027-06-15.',
    'Application period: 2027-01-01 to 2027-02-30.',
  ])('rejects invalid or negative-length application dates: %s', (text) => {
    expect(extractGroundedFacts(text, record).filter(fact => (
      fact.field === 'opensOn' || fact.field === 'closesOn'
    ))).toEqual([])
  })
})
