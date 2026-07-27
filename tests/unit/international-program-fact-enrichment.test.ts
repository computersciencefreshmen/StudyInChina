import { describe, expect, it } from 'vitest'

import {
  extractGroundedFacts,
} from '../../scripts/ingestion/enrich-international-program-facts'

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
})
